import { getRedisClient } from "../../../services/redis-client.js";
import { getSuperflixIds } from "../../../services/superflix-ids.js";
import { getEnv, getSiteUrl } from "../../../services/env-adapter.js";
import { fetchWithTimeout } from "../../../services/fetch-util.js";
import { supabaseAdmin } from "../../../services/supabase.js";
import { axiomService } from "../../../services/axiom-service.js";
import { postTweet, buildTweetText } from "../../../services/twitterService.js";

export const prerender = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text) {
    if (!text) return "";
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "")
        .replace(/\-\-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
}

function isRecent(dateStr, daysLimit = 7) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = (now - date) / (1000 * 60 * 60 * 24);
    return diffDays <= daysLimit;
}

function getCanonicalSiteOrigin(requestUrl) {
    return getSiteUrl(requestUrl);
}

function buildWebhookWaitUrl(webhookUrl) {
    const parsed = new URL(webhookUrl);
    parsed.searchParams.set('wait', 'true');
    return parsed.toString();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Catálogo Superflix: via endpoint interno (cron/Node) ou direto (dentro do Worker) ────
// O cron roda como script Node puro (GitHub Actions), sem acesso ao binding real do KV da
// Cloudflare (só existe dentro do runtime do Worker). Batendo direto no Superflix a cada
// execução (15 em 15 min) sem cache algum, os domínios passaram a devolver 429 (rate limit)
// e o catálogo ficava vazio, silenciando as notificações. Por isso, no ambiente do cron,
// buscamos os IDs já cacheados via HTTP no próprio endpoint interno (que roda no Worker e
// tem acesso real ao KV) em vez de repetir o fetch bruto ao Superflix.
async function getCatalogIds(isNodeEnv, siteOrigin, secret) {
    if (!isNodeEnv) {
        return getSuperflixIds();
    }

    try {
        const res = await fetchWithTimeout(`${siteOrigin}/api/internal/superflix-ids?secret=${encodeURIComponent(secret)}`, {
            timeout: 10000
        });
        if (!res.ok) throw new Error(`Endpoint interno retornou ${res.status}`);
        const data = await res.json();
        return {
            movies: new Set((data.movies || []).map(Number)),
            series: new Set((data.series || []).map(Number)),
            anime: new Set((data.anime || []).map(Number)),
            doramas: new Set((data.doramas || []).map(Number))
        };
    } catch (e) {
        console.error('⚠️ [Cron] Falha ao buscar catálogo via endpoint interno, usando fallback direto:', e.message);
        return getSuperflixIds();
    }
}

// ─── Deduplication via Supabase (primary) + Redis (acceleration cache) ───────
// Supabase é a fonte de verdade. Redis acelera o lookup mas não é obrigatório.

async function hasBeenNotified(key, redis, isRedisHealthy) {
    // 1. Redis fast-path (se saudável)
    if (isRedisHealthy) {
        try {
            const hit = await redis.get(key);
            if (hit) return true;
        } catch { /* continua para Supabase */ }
    }

    // 2. Supabase como fonte de verdade
    try {
        const { data, error } = await supabaseAdmin
            .from('notified_releases')
            .select('key')
            .eq('key', key)
            .maybeSingle();

        if (error) {
            console.error('[Cron] Supabase SELECT falhou:', error.message);
            // Contingência segura: assume não notificado para não silenciar tudo
            return false;
        }
        return !!data;
    } catch (e) {
        console.error('[Cron] Falha ao consultar notified_releases:', e.message);
        return false;
    }
}

async function markNotified(key, redis, isRedisHealthy) {
    // 1. Supabase como registro persistente (primário)
    try {
        const { error } = await supabaseAdmin
            .from('notified_releases')
            .upsert({ key });
        if (error) console.error('[Cron] Supabase UPSERT falhou:', error.message);
    } catch (e) {
        console.error('[Cron] Falha ao salvar no Supabase:', e.message);
    }

    // 2. Redis como cache de aceleração (secundário, opcional)
    if (isRedisHealthy) {
        try {
            await redis.set(key, "true", "EX", 2592000); // 30 dias
        } catch { /* não crítico */ }
    }
}

// ─── Discord Autopublish ──────────────────────────────────────────────────────
// NOTA: O crosspost só funciona em canais do tipo "Announcement" (News Channel).
// Para ativar: Discord → Configurações do canal → Tipo = "Announcement Channel".
// NOTE: Crosspost only works on Discord Announcement (News) channels, not regular text channels.

async function tryAutoPublishDiscordMessage(message, botToken, state = {}) {
    if (!botToken || !message?.id || !message?.channel_id) return { attempted: false };

    const now = Date.now();
    if (state.cooldownUntil && state.cooldownUntil > now) {
        return { attempted: false, skipped: true, reason: 'cooldown', cooldownMsLeft: state.cooldownUntil - now };
    }

    const endpoint = `https://discord.com/api/v10/channels/${message.channel_id}/messages/${message.id}/crosspost`;

    try {
        const res = await fetchWithTimeout(endpoint, {
            timeout: 6000,
            method: 'POST',
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (res.ok) {
            return { attempted: true, ok: true };
        }

        const bodyText = await res.text().catch(() => '');
        let bodyJson = {};
        try { bodyJson = JSON.parse(bodyText || '{}'); } catch {}

        // Rate limit handling
        if (res.status === 429) {
            const retryAfterMs = Math.ceil((Number(bodyJson?.retry_after || 0)) * 1000);
            if (retryAfterMs > 0) state.cooldownUntil = Date.now() + retryAfterMs;
            return { attempted: true, ok: false, status: 429, retryAfterMs };
        }

        // 400 = canal não é do tipo Announcement — erro permanente, não retenta
        if (res.status === 400) {
            console.error(`❌ [Cron AutoPublish] Falha 400 — O canal provavelmente não é do tipo Announcement (News Channel). Configure em: Discord → Canal → Editar → Tipo de canal. Body: ${bodyText}`);
            return { attempted: true, ok: false, status: 400, permanent: true };
        }

        console.warn(`⚠️ [Cron AutoPublish] Falha ${res.status}: ${bodyText}`);
        return { attempted: true, ok: false, status: res.status, body: bodyText };

    } catch (error) {
        console.error('[Cron AutoPublish] Erro de rede:', error?.message || String(error));
        return { attempted: true, ok: false, error: error?.message };
    }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET({ request }) {
    const TMDB_API_KEY = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    const DISCORD_WEBHOOK = getEnv('DISCORD_WEBHOOK_LAUNCHES') || getEnv('DISCORD_WEBHOOK') || getEnv('DISCORD_WEBHOOK_URL');
    const DISCORD_BOT_TOKEN = getEnv('DISCORD_BOT_TOKEN') || getEnv('DISCORD_AUTOPUBLISH_BOT_TOKEN');

    let redis = null;
    const authHeader = request.headers.get('authorization');
    const urlObj = new URL(request.url);
    const siteOrigin = getCanonicalSiteOrigin(request.url);
    const secretParam = urlObj.searchParams.get('secret');
    const supabaseUrl = getEnv('PUBLIC_SUPABASE_URL');
    const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    // Obtém a chave secreta do cron do ambiente (Pilar 3: Nomes Significativos)
    // Retrieve the cron secret token from the environment (Pilar 3: Meaningful Names)
    const secret = getEnv('CRON_SECRET');

    console.log(`[Cron] Verificando autorização... Secret recebido: ${!!secretParam}, Secret esperado: ${!!secret}`);

    if (!secret) {
        console.error('❌ [Cron] CRON_SECRET não está configurado no ambiente.');
        return new Response('Configuração de segurança pendente (CRON_SECRET).', { status: 500 });
    }

    if (authHeader !== `Bearer ${secret}` && secretParam !== secret) {
        console.warn(`⚠️ [Cron] Tentativa de acesso não autorizado.`);
        return new Response('Não autorizado.', { status: 401 });
    }

    // Garantia absoluta de conexão persistente de deduplicação (Pilar 2: À Prova de Falhas)
    // Absolute guarantee of persistent deduplication connection (Pilar 2: Fail-Safe)
    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ [Cron] Credenciais do Supabase ausentes. O cron exige conexão persistente ativa para evitar repetição de posts.');
        return new Response('Configurações do Supabase ausentes (PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).', { status: 500 });
    }

    if (!TMDB_API_KEY || !DISCORD_WEBHOOK) {
        console.error(`❌ [Cron] Configurações ausentes. TMDB: ${!!TMDB_API_KEY}, Discord: ${!!DISCORD_WEBHOOK}`);
        return new Response('Configurações ausentes (TMDB/Discord).', { status: 500 });
    }

    try {
        const webhookWithWait = buildWebhookWaitUrl(DISCORD_WEBHOOK);
        redis = await getRedisClient();

        // Redis health check (não crítico — apenas acelera lookups)
        let isRedisHealthy = false;
        if (redis) {
            try {
                await redis.set('cron:healthcheck', 'ok', 'EX', 5);
                isRedisHealthy = (await redis.get('cron:healthcheck')) === 'ok';
            } catch { isRedisHealthy = false; }
        }

        if (!isRedisHealthy) {
            console.warn('⚠️ [Cron] Redis indisponível/esgotado. Deduplicação via Supabase (notified_releases).');
        }

        // Lock global via Supabase para evitar execuções simultâneas
        if (isRedisHealthy) {
            const isLocked = await redis.get('lock:cron:notificar');
            if (isLocked) {
                return new Response(JSON.stringify({ success: false, message: 'Cron já está em execução.' }), { status: 429 });
            }
            await redis.set('lock:cron:notificar', 'true', 'EX', 600);
        }

        const agora = new Date();
        const hoje = agora.toISOString().split('T')[0];
        const seteDiasAtras = new Date(agora.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const trintaDiasAtras = new Date(agora.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const sessentaDiasAtras = new Date(agora.getTime() - (60 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

        const isNodeEnv = typeof process !== 'undefined' && (process.env.GITHUB_ACTIONS || process.env.CRON_NODE === 'true' || process.env.NODE_ENV === 'development');

        const idsDisponiveis = await getCatalogIds(isNodeEnv, siteOrigin, secret);
        console.log(`🔍 [Cron] ${idsDisponiveis.movies.size} filmes e ${idsDisponiveis.series.size} séries disponíveis.`);

        const fetchTMDB = (urlStr) => fetchWithTimeout(urlStr, {
            timeout: 8000,
            headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
        });

        // Busca expandida: 3 páginas de TV discovery + on_the_air + airing_today + 3 páginas de filmes
        const [tvPages, moviePages] = await Promise.all([
            Promise.all([
                fetchTMDB(`https://api.themoviedb.org/3/discover/tv?air_date.gte=${seteDiasAtras}&air_date.lte=${hoje}&page=1&sort_by=popularity.desc`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/discover/tv?air_date.gte=${seteDiasAtras}&air_date.lte=${hoje}&page=2&sort_by=popularity.desc`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/discover/tv?air_date.gte=${trintaDiasAtras}&air_date.lte=${hoje}&page=3&sort_by=popularity.desc`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/tv/on_the_air?page=1`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/tv/on_the_air?page=2`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/tv/airing_today?page=1`).then(r => r.json()),
            ]),
            Promise.all([
                fetchTMDB(`https://api.themoviedb.org/3/discover/movie?primary_release_date.gte=${sessentaDiasAtras}&primary_release_date.lte=${hoje}&page=1&with_runtime.gte=60&sort_by=popularity.desc`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/discover/movie?primary_release_date.gte=${sessentaDiasAtras}&primary_release_date.lte=${hoje}&page=2&with_runtime.gte=60&sort_by=popularity.desc`).then(r => r.json()),
                fetchTMDB(`https://api.themoviedb.org/3/discover/movie?primary_release_date.gte=${sessentaDiasAtras}&primary_release_date.lte=${hoje}&page=3&with_runtime.gte=60&sort_by=popularity.desc`).then(r => r.json()),
            ])
        ]);

        const tvResults = tvPages.flatMap(p => p.results || []);
        const movieResults = moviePages.flatMap(p => p.results || []);

        // Deduplica candidatos por id+media_type
        const candidates = [
            ...tvResults.map(i => ({ ...i, media_type: 'tv' })),
            ...movieResults.map(i => ({ ...i, media_type: 'movie' }))
        ].filter((v, i, a) => a.findIndex(t => t.id === v.id && t.media_type === v.media_type) === i);

        // Filtra apenas o que está no catálogo MultiCanaisHD
        const availableCandidates = candidates.filter(item => {
            const id = Number(item.id);
            if (item.media_type === 'movie') return idsDisponiveis.movies.has(id);
            if (item.media_type === 'tv') return idsDisponiveis.series.has(id) || idsDisponiveis.anime.has(id) || idsDisponiveis.doramas.has(id);
            return false;
        });

        // Execution deadline: Cloudflare Workers hard limit is 30s. We stop at 20s to leave 10s buffer.
        // Prazo de execução: o limite do Cloudflare Worker é 30s. Paramos em 20s para ter 10s de folga.
        const EXEC_DEADLINE_MS = isNodeEnv ? 300_000 : 20_000;
        const cronStartTime = Date.now();

        const maxNotifications = isNodeEnv ? 60 : 20;
        const candidateReviewLimit = Math.min(availableCandidates.length, isNodeEnv ? 240 : 20);

        const itemsToProcess = availableCandidates.slice(0, candidateReviewLimit);
        console.log(`[Cron] Disponiveis no catalogo: ${availableCandidates.length}. Revisando ${itemsToProcess.length} para enviar ate ${maxNotifications} novidades.`);

        let notifiedCount = 0;
        let skippedCount = 0;
        let reviewedCount = 0;
        let autoPublishedCount = 0;
        let deadlineReached = false;
        const autoPublishState = { cooldownUntil: 0 };

        for (const item of itemsToProcess) {
            if (notifiedCount >= maxNotifications) break;

            // Guard: abort loop before Cloudflare's hard limit is hit.
            // Guarda: aborta o loop antes de atingir o limite do Cloudflare.
            if (Date.now() - cronStartTime >= EXEC_DEADLINE_MS - 5000) {
                console.warn(`⚠️ [Cron] Deadline de execução atingido após ${Date.now() - cronStartTime}ms. Encerrando loop antecipadamente.`);
                deadlineReached = true;
                break;
            }

            reviewedCount++;

            const originalTitle = item.name || item.title;
            let displayTitle = originalTitle;
            let subtitle = "";
            let emoji = "🚀";
            let specificKey = "";

            if (item.media_type === 'tv') {
                // Busca em EN-US para dados numéricos confiáveis (sem delay de tradução)
                const detailRes = await fetchTMDB(`https://api.themoviedb.org/3/tv/${item.id}?language=en-US`);
                if (!detailRes.ok) { skippedCount++; continue; }
                const detail = await detailRes.json();

                let lastEp = detail.last_episode_to_air;
                const nextEp = detail.next_episode_to_air;
                if (nextEp && nextEp.air_date === hoje) lastEp = nextEp;

                // Título e sinopse em PT-BR para o embed
                const detailPTRes = await fetchTMDB(`https://api.themoviedb.org/3/tv/${item.id}?language=pt-BR`);
                const detailPT = detailPTRes.ok ? await detailPTRes.json() : detail;
                item.name = detailPT.name || detail.name;
                item.overview = detailPT.overview || detail.overview;

                if (detail.number_of_seasons === 1 && detail.first_air_date && isRecent(detail.first_air_date, 30)) {
                    // Estreia de série nova
                    emoji = "🔥";
                    displayTitle = `Estreia de Série: ${item.name}`;
                    subtitle = "Primeira temporada disponível!";
                    specificKey = "premiere";
                } else if (lastEp) {
                    // Novo episódio — sem filtro de janela de tempo; a deduplicação via Supabase já evita spam
                    emoji = "📺";
                    const s = lastEp.season_number.toString().padStart(2, '0');
                    const e = lastEp.episode_number.toString().padStart(2, '0');
                    subtitle = `Novo Episódio: **S${s}E${e}**`;
                    specificKey = `S${s}E${e}`;
                } else {
                    skippedCount++;
                    continue;
                }
            } else {
                // Filme: título e sinopse em PT-BR
                const moviePTRes = await fetchTMDB(`https://api.themoviedb.org/3/movie/${item.id}?language=pt-BR`);
                if (moviePTRes.ok) {
                    const moviePT = await moviePTRes.json();
                    item.title = moviePT.title || item.title;
                    item.overview = moviePT.overview || item.overview;
                }
                emoji = "🎬";
            }

            const finalOriginalTitle = item.name || item.title;
            const finalDisplayTitle = displayTitle || finalOriginalTitle;
            const redisKey = `notified:${item.media_type}:${item.id}${specificKey ? `:${specificKey}` : ''}`;

            // Deduplicação: Supabase como fonte de verdade + Redis como cache
            const alreadyNotified = await hasBeenNotified(redisKey, redis, isRedisHealthy);
            if (alreadyNotified) {
                skippedCount++;
                continue;
            }

            // Monta link com season+episode para séries
            const slug = slugify(finalOriginalTitle) || "assistir";
            const pathType = item.media_type === 'movie' ? 'filme' : 'serie';
            let link = `${siteOrigin}/${pathType}/${item.id}-${slug}`;
            if (item.media_type === 'tv' && specificKey.includes("S")) {
                const match = subtitle.match(/S(\d+)E(\d+)/);
                if (match) link += `?season=${parseInt(match[1])}&episode=${parseInt(match[2])}`;
            }

            const embed = {
                title: `${emoji} ${finalDisplayTitle}`,
                description: `${subtitle}\n\n${item.overview ? (item.overview.substring(0, 450) + '...') : 'Sem sinopse disponível.'}`,
                url: link,
                color: item.media_type === 'tv' ? 0x5865F2 : 0xFF5555,
                fields: [
                    { name: "Nota", value: item.vote_average ? `⭐ ${item.vote_average.toFixed(1)}` : '🆕', inline: true },
                    { name: "Categoria", value: item.media_type === 'tv' ? 'Série/Anime' : 'Filme', inline: true }
                ],
                image: { url: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null },
                footer: { text: "MultiCanaisHD Bot • Notificador de Estreias" },
                timestamp: new Date().toISOString()
            };

            let contentMsg = '';
            if (item.media_type === 'tv') {
                contentMsg = specificKey === 'premiere'
                    ? `🔥 **Nova Série:** ${finalOriginalTitle} acabou de estrear!`
                    : `📺 Novo episódio de **${finalOriginalTitle}** disponível! (${subtitle.match(/S\d+E\d+/)?.[0] ?? specificKey})`;
            } else {
                contentMsg = `🎬 **Filme Novo:** ${finalOriginalTitle} já está disponível!`;
            }

            console.log(`📤 [Cron] Enviando: ${finalOriginalTitle} (${redisKey})`);

            // ?wait=true faz o Discord confirmar a entrega antes de responder, o que é
            // inerentemente mais lento que um post normal — por isso timeout maior (10s) aqui.
            // Try/catch dedicado: um timeout/erro de rede num item NÃO pode derrubar o loop
            // inteiro (antes, uma exceção aqui matava o cron e nenhum item seguinte era
            // processado — foi o que causou o autopublish "sumido" visto no Actions).
            let discordRes;
            try {
                discordRes = await fetchWithTimeout(webhookWithWait, {
                    timeout: 10000,
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: contentMsg, embeds: [embed] })
                });
            } catch (fetchErr) {
                console.error(`❌ [Cron] Erro/timeout ao enviar para Discord (${finalOriginalTitle}):`, fetchErr.message);
                // Discord pode ter processado a mensagem mesmo com nosso fetch expirando —
                // não marcamos como notificado pra tentar de novo (e reconfirmar) no próximo ciclo.
                skippedCount++;
                continue;
            }

            if (!discordRes.ok) {
                console.error(`❌ [Cron] Falha ao enviar para Discord: ${discordRes.status} ${discordRes.statusText}`);
                // Não marca como notificado — tenta de novo no próximo ciclo
                skippedCount++;
                continue;
            }

            // Auto-publish da mensagem no canal Announcement
            if (DISCORD_BOT_TOKEN) {
                try {
                    console.log(`[Cron] Token do bot detectado. Tentando parse do Webhook...`);
                    const messageBody = await discordRes.json().catch(e => {
                        console.error('[Cron] Falha ao parsear resposta do Webhook:', e);
                        return null;
                    });
                    console.log(`[Cron] Mensagem Webhook recebida: ID=${messageBody?.id}, Channel=${messageBody?.channel_id}`);
                    const autoPublish = await tryAutoPublishDiscordMessage(messageBody, DISCORD_BOT_TOKEN, autoPublishState);
                    if (autoPublish?.ok) {
                        autoPublishedCount++;
                        console.log(`✅ [Cron AutoPublish] Publicado (crosspost) para ${finalOriginalTitle}`);
                    } else if (autoPublish?.skipped && autoPublish?.reason === 'cooldown') {
                        console.warn(`⏳ [Cron AutoPublish] Pulado por cooldown de rate limit do Discord para ${finalOriginalTitle} (aguardando ${autoPublish.cooldownMsLeft}ms). Mensagem foi postada no canal, mas NÃO foi amplificada pros seguidores.`);
                    } else if (autoPublish?.attempted) {
                        console.warn(`⚠️ [Cron AutoPublish] Falha/Permissão negada para ${finalOriginalTitle}:`, JSON.stringify(autoPublish));
                    } else if (!messageBody?.id || !messageBody?.channel_id) {
                        console.warn(`⚠️ [Cron AutoPublish] Webhook não retornou ID/Channel válidos para ${finalOriginalTitle}. Payload:`, JSON.stringify(messageBody));
                    } else {
                        console.warn(`⚠️ [Cron AutoPublish] Não tentou publicar para ${finalOriginalTitle} por motivo desconhecido:`, JSON.stringify(autoPublish));
                    }
                } catch (autoPublishErr) {
                    // A mensagem já foi postada no canal com sucesso (discordRes.ok acima) — uma
                    // falha aqui é só do crosspost, não pode reverter a notificação nem matar o loop.
                    console.error(`❌ [Cron AutoPublish] Erro inesperado ao tentar crosspost para ${finalOriginalTitle}:`, autoPublishErr.message);
                }
            } else {
                console.log(`[Cron] DISCORD_BOT_TOKEN não configurado. Pulando autopublish.`);
            }

            // Cross-post no Twitter/X: reaproveita o mesmo texto do Discord. Try/catch dedicado
            // pelo mesmo motivo do autopublish acima — uma falha aqui não pode reverter a
            // notificação do Discord nem derrubar o loop.
            try {
                const tweetText = buildTweetText({ emoji, title: finalDisplayTitle, subtitle, link });
                const tweetRes = await postTweet(tweetText);
                if (tweetRes.ok) {
                    console.log(`✅ [Cron Twitter] Tweet postado para ${finalOriginalTitle} (id=${tweetRes.id})`);
                } else if (!tweetRes.skipped) {
                    console.warn(`⚠️ [Cron Twitter] Falha ao postar tweet para ${finalOriginalTitle}:`, JSON.stringify(tweetRes));
                }
            } catch (tweetErr) {
                console.error(`❌ [Cron Twitter] Erro inesperado ao postar tweet para ${finalOriginalTitle}:`, tweetErr.message);
            }

            // Marca como notificado no Supabase (e Redis se disponível)
            await markNotified(redisKey, redis, isRedisHealthy);

            notifiedCount++;
            // Respeita o rate limit do webhook (1500ms entre mensagens)
            await sleep(1500);
        }

        console.log(`✅ [Cron] Concluído. Notificados: ${notifiedCount}, AutoPublicados: ${autoPublishedCount}, Skipped: ${skippedCount}${deadlineReached ? ' | ⚠️ Deadline atingido' : ''}`);

        return new Response(JSON.stringify({
            success: true,
            notified: notifiedCount,
            autoPublished: autoPublishedCount,
            skipped: skippedCount,
            reviewed: reviewedCount,
            maxNotifications,
            checked: availableCandidates.length,
            origin: siteOrigin,
            deadlineReached
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ [Cron] Erro fatal:', error);
        axiomService.logError(error, { rota: "/api/cron/notificar" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    } finally {
        if (redis) {
            try {
                await redis.del('lock:cron:notificar');
                await redis.quit();
            } catch (e) { redis.disconnect?.(); }
        }
    }
}

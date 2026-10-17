// src/services/channelsService.js
import { getConfig } from './configService.js';
import { supabase, supabaseAdmin } from './supabase.js';
import { slugify } from '../utils/slugify.js';
import { getRedisClient } from './redis-client.js';
import { axiomService } from './axiom-service.js';

// v7: a fonte dos canais mudou de embedtv.lat para a nossa API (streambetter.shop) e os IDs
// passaram a ser slugs nossos. Reaproveitar o blob v6 serviria canais mortos com IDs que não
// existem mais. / Cache key bumped because channel IDs changed with the provider swap.
const REDIS_CANAIS_CACHE_KEY = 'multicanaishd_canais_cache_v7';
const REDIS_CACHE_TTL = 180; // 3 minutos

// Nossa API. Chaves de config novas (e não as antigas TV_CHANNELS_API_URL/LIVE_SPORTS_API_URL)
// porque aquelas já têm valor da EmbedTV salvo no painel — reusá-las faria o valor gravado
// sobrescrever o novo default e continuar apontando pro provedor antigo.
const SB_CHANNELS_URL_KEY = 'SB_CHANNELS_API_URL';
const SB_GAMES_URL_KEY = 'SB_GAMES_API_URL';
const SB_EPG_URL_KEY = 'SB_EPG_API_URL';
const SB_CHANNELS_PAGE_SIZE = 100; // teto documentado da nossa API

async function saveCanaisToRedis(canais) {
    if (!canais || canais.length === 0) return;
    try {
        const redis = await getRedisClient();
        if (redis) {
            await redis.set(REDIS_CANAIS_CACHE_KEY, JSON.stringify(canais), "EX", REDIS_CACHE_TTL);
            console.log(`💾 [Service] Canais salvos no cache Redis (${canais.length} canais).`);
        }
    } catch (err) {
        console.warn('⚠️ [Service] Falha ao salvar canais no Redis:', err.message);
    }
}

// True Global State (persiste entre re-evaluations do Vite)
if (!globalThis._bf_channels_state) {
    globalThis._bf_channels_state = {
        canaisCache: null,
        cacheTimestamp: 0,
        currentFetchPromise: null,
        isUpdatingBackground: false,
        vipChannelsCache: null,
        vipCacheTimestamp: 0,
        currentVipFetchPromise: null,
        version: 'v7'
    };
} else if (globalThis._bf_channels_state.version !== 'v7') {
    // Invalida cache antigo mantendo a estrutura para os testes unitários
    globalThis._bf_channels_state.canaisCache = null;
    globalThis._bf_channels_state.cacheTimestamp = 0;
    globalThis._bf_channels_state.currentFetchPromise = null;
    globalThis._bf_channels_state.version = 'v7';
}
const state = globalThis._bf_channels_state;
const CACHE_TTL = 900000; // 15 minutos
const VIP_CACHE_TTL = 1800000; // 30 minutos (Canais VIP mudam raramente)

// Tetos do SSR para as duas buscas que sustentam as rotas de canal.
//
// Os races internos de cada uma (8s/8.5s) NÃO se mostraram suficientes em produção: medido
// em /canal/*, 11 de 20 requisições nunca respondiam e a Cloudflare devolvia 524 depois de
// ~125s (confirmado: status=524 time=125,4s). O efeito no SEO é o pior possível — 5xx em
// massa é justamente o que faz o Google cortar o crawl budget (.agents/rules/code.md §4.2).
// Pior ainda: cada busca é cacheada num global do isolate
// (`currentFetchPromise`/`currentVipFetchPromise`), então UMA promise que não assentava
// envenenava todas as requisições seguintes daquele isolate.
//
// Com o teto, o pior caso passa a ser a última lista conhecida (ou vazio) — nunca um 5xx.
// 7s espelha o PER_SOURCE_TIMEOUT_MS da home; 5s é folgado pro VIP, que é só o selo/cadeado.
const CANAIS_FETCH_CEILING_MS = 7000;
const VIP_FETCH_CEILING_MS = 5000;

/**
 * Teto rígido pra qualquer promise: resolve com `fallback` se estourar, nunca rejeita.
 *
 * Existe porque AbortController + timeout de fetch NÃO são suficientes no caminho de SSR:
 * um `await` sem teto dentro de um componente renderizado em streaming não trava só a
 * requisição, ele deixa a resposta HTTP aberta pra sempre (HTML sem `</html>`) — foi
 * exatamente o que derrubou a home e o /canais pro Googlebot. Use isso em todo `await`
 * que rode durante o render, não só nos fetches.
 */
export function withCeiling(promise, ms, fallback = null) {
    return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
    ]);
}

/**
 * Faz uma requisição JSON à nossa API com teto de tempo obrigatório.
 * JSON request against our own API with a mandatory time ceiling.
 */
async function fetchNossaApi(url, timeoutMs) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        // Só depois do res.json(): o AbortController é o único teto que cobre a leitura do corpo.
        clearTimeout(tid);
    }
}

function normalizeTimestamp(ts) {
    if (!ts) return 0;
    const num = Number(ts);
    return num > 9999999999 ? Math.floor(num / 1000) : num;
}

export async function fetchJogos() {
    try {
        const isDev = import.meta.env?.DEV || false;
        const JOGOS_TIMEOUT = isDev ? 3000 : 6000;

        // Sem os proxies CORS (codetabs/allorigins) que existiam pra contornar bloqueio da
        // EmbedTV: a API é nossa, o fetch é server-side e cada proxy era mais uma requisição
        // paga a terceiro em toda montagem de cache. / Our own API needs no CORS proxies.
        const baseApiUrl = await getConfig(SB_GAMES_URL_KEY, 'https://streambetter.shop/api/games');
        const apiUrl = `${baseApiUrl}${baseApiUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

        const payload = await fetchNossaApi(apiUrl, JOGOS_TIMEOUT);
        const finalData = Array.isArray(payload?.games) ? payload.games : [];

        if (finalData.length === 0) {
            console.warn('⚠️ [Jogos] Nenhuma partida ao vivo retornada pela nossa API.');
            return [];
        }

        const mapped = finalData.map(j => ({
            // ID limpo e seguro
            id: `jogo_${j.title?.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-').replace(/[^\w-]/g, '') || 'unknown'}`,
            nome: j.title,
            title: j.title, // Compatibilidade com LiveGamesSection.astro
            imagem: j.image,
            image: j.image, // Compatibilidade total
            url: Array.isArray(j.players) ? j.players[0] : (j.players || ""),
            categoria: "⚽ Jogos Ao Vivo",
            hora_inicio: j.data?.timer?.start ? normalizeTimestamp(j.data.timer.start) : null,
            hora_fim: j.data?.timer?.end ? normalizeTimestamp(j.data.timer.end) : null,
            data: j.data || j // Garante que o LiveGamesSection encontre teams/timer
        }));

        console.log(`✅ [Jogos] ${mapped.length} partidas sintonizadas da fonte.`);
        return mapped;
    } catch (e) {
        if (e.name === 'AbortError') {
            // Timeout aqui é esperado e inofensivo: a lista de jogos é opcional, os canais
            // continuam sendo servidos e o próximo ciclo tenta de novo. Não vai pro Axiom pra
            // não afogar o alerta de erro real em ruído recorrente.
            // Expected, harmless: games are optional and retried on the next cycle.
            console.warn('⚠️ [Jogos] Timeout atingido (API de jogos lenta).');
            return [];
        }

        if (e.message?.includes('fetch failed')) {
            console.warn('⚠️ [Jogos] Sem conexão com a API de partidas (Erro de Conexão local).');
        } else {
            console.warn('⚠️ [Jogos] Falha ao sintonizar partidas:', e.message || e.name);
        }
        axiomService.logError(e, { servico: "channelsService", funcao: "fetchJogos" }).catch(() => {});
        return [];
    }
}

export async function fetchCanais(forceFreshJogos = false) {
    const agora = Date.now();
    const isDev = import.meta.env?.DEV || false;
    const ttl = isDev ? 10000 : CACHE_TTL; // 10s em dev, 15m em prod

    // Para jogos ao vivo, se for forçado ou se o cache estiver velho (mais de 2.5 minutos), atualiza sincronamente
    const needsFreshJogos = forceFreshJogos || (agora - state.cacheTimestamp >= 150000);

    // 1. OTIMIZAÇÃO EXTREMA: Se temos cache e NÃO precisamos de jogos frescos, retorna IMEDIDAMENTE
    if (state.canaisCache && !needsFreshJogos) {
        return state.canaisCache;
    }

    // 2. Se não temos cache na memória (Cold Start) ou se precisamos de jogos frescos, tentamos obter primeiro do Redis
    if (!state.canaisCache) {
        try {
            const redis = await getRedisClient();
            if (redis) {
                const cachedStr = await redis.get(REDIS_CANAIS_CACHE_KEY);
                if (cachedStr) {
                    const cachedCanais = JSON.parse(cachedStr);
                    if (Array.isArray(cachedCanais) && cachedCanais.length > 0) {
                        state.canaisCache = cachedCanais;
                        state.cacheTimestamp = agora;
                        console.log(`✅ [Service] Canais recuperados com sucesso do cache Redis (${cachedCanais.length} canais).`);
                        
                        // Se não precisamos de jogos super frescos, retorna imediatamente
                        if (!needsFreshJogos) {
                            return state.canaisCache;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('⚠️ [Service] Falha ao ler canais do Redis:', err.message);
        }
    }

    // 3. Se temos cache mas precisamos de jogos frescos, busca e mescla de forma síncrona (seguro para Serverless!)
    if (state.canaisCache && needsFreshJogos) {
        console.log('📡 [Service] Buscando jogos frescos para sincronização ao vivo...');
        try {
            const freshJogos = await fetchJogos();
            if (freshJogos && freshJogos.length > 0) {
                const staticCanais = state.canaisCache.filter(c => c.categoria !== '⚽ Jogos Ao Vivo');
                state.canaisCache = [...staticCanais, ...freshJogos];
                state.cacheTimestamp = agora; // Atualiza o timestamp do cache
                console.log(`✅ [Service] Jogos frescos mesclados no cache: ${freshJogos.length} jogos.`);
                
                // Salva no Redis de forma assíncrona
                saveCanaisToRedis(state.canaisCache);
            }
        } catch (e) {
            console.warn('⚠️ [Service] Falha ao atualizar jogos frescos sincronamente:', e.message);
        }
        return state.canaisCache;
    }

    // 4. Stale-While-Revalidate tradicional para os canais normais se o cache geral expirou
    if (state.canaisCache) {
        if (agora - state.cacheTimestamp >= ttl && !state.isUpdatingBackground) {
            console.log('📡 [Service] Cache de canais expirado. Disparando atualização em background...');
            state.isUpdatingBackground = true;
            (async () => {
                try {
                    const [nossosCanais, jogosCanais] = await Promise.all([
                        fetchNossosCanais().catch(() => []),
                        fetchJogos().catch(() => [])
                    ]);

                    if (nossosCanais.length > 0) {
                        const oldJogos = state.canaisCache ? state.canaisCache.filter(c => c.categoria === '⚽ Jogos Ao Vivo') : [];
                        const finalJogos = jogosCanais.length > 0 ? jogosCanais : oldJogos;

                        state.canaisCache = [...nossosCanais, ...finalJogos];
                        state.cacheTimestamp = Date.now();
                        console.log(`✅ [Service] Cache em background atualizado: ${state.canaisCache.length} canais.`);

                        // Salva no Redis em background
                        saveCanaisToRedis(state.canaisCache);
                    }
                } catch (e) {
                    console.error("❌ [Service] Falha na atualização de background:", e.message);
                } finally {
                    state.isUpdatingBackground = false;
                }
            })();
        }
        return state.canaisCache;
    }

    // 5. Se NÃO temos cache inicial de forma alguma (Cold Start + Cache Miss no Redis), busca com timeout
    if (state.currentFetchPromise) {
        return state.currentFetchPromise;
    }

    console.log('📡 [Service] Sem cache inicial e Redis vazio. Buscando de forma síncrona com timeout estrito de 8.5 segundos...');

    const buscaInicial = (async () => {
        let timeoutId;
        try {
            const canaisPromise = fetchNossosCanais().catch(() => []);
            const jogosPromise = fetchJogos().catch(() => []);

            const fetchAllPromise = Promise.all([canaisPromise, jogosPromise]);
            const timeoutPromise = new Promise((_, reject) => {
                // 8.5s (não 4s) pra caber o timeout real de fetchNossosCanais (8s) — com 4s
                // esse timeout disparava quase sempre, mesmo quando a API respondia normal
                // dentro do próprio limite dela, só um pouco mais devagar que 4s.
                timeoutId = setTimeout(() => {
                    const err = new Error('Timeout geral de busca excedido');
                    err.code = 'CHANNELS_FETCH_TIMEOUT';
                    reject(err);
                }, 8500);
            });

            const [nossosCanais, jogosCanais] = await Promise.race([fetchAllPromise, timeoutPromise]);
            clearTimeout(timeoutId);

            const validCanais = nossosCanais || [];
            const validJogos = (jogosCanais && jogosCanais.length > 0) ? jogosCanais : [];

            // Zero canais aqui é falha da fonte, não uma grade vazia de verdade. O caminho de
            // background (acima) já se protege com `if (nossosCanais.length > 0)`; este aqui não
            // se protegia, e como no Worker todo isolate novo é cold start, um único momento ruim
            // da API bastava pra gravar no Redis uma lista só com jogos. Aí TODO isolate que lesse
            // o Redis servia "0 de 0 canais" pelo TTL inteiro, mesmo com a API já respondendo.
            // `saveCanaisToRedis` só barra o array totalmente vazio — com jogos dentro ele passava.
            if (validCanais.length === 0) {
                console.warn('⚠️ [Service] Nenhum canal veio da fonte. Não vou cachear isso: a próxima requisição tenta de novo.');
                axiomService.logError(new Error('Busca inicial sem nenhum canal'), { servico: "channelsService", funcao: "fetchCanais", jogos: validJogos.length }).catch(() => {});
                // Sem carimbar `cacheTimestamp`: o cache segue "frio" e a próxima requisição
                // refaz a busca em vez de servir a grade capenga até o TTL vencer.
                return [...validJogos];
            }

            state.canaisCache = [...validCanais, ...validJogos];
            state.cacheTimestamp = Date.now();
            console.log(`✅ [Service] Cache inicial criado: ${state.canaisCache.length} items (${validJogos.length} jogos).`);

            // Salva no Redis de forma assíncrona
            saveCanaisToRedis(state.canaisCache);

            return state.canaisCache;
        } catch (e) {
            if (timeoutId) clearTimeout(timeoutId);
            console.error("❌ [Service] Falha crítica ou timeout ao sintonizar APIs no início:", e.message || e.name);
            axiomService.logError(e, { servico: "channelsService", funcao: "fetchCanais" }).catch(() => {});
            if (!state.canaisCache) {
                state.canaisCache = [];
            }
            return state.canaisCache;
        }
    })();

    // O `finally { state.currentFetchPromise = null }` que existia aqui saiu de propósito:
    // com o teto, quem libera o singleton é a promise RACEADA, que sempre assenta. Mantendo o
    // `finally` interno, uma busca travada nunca liberava o singleton e o isolate inteiro
    // ficava servindo a mesma promise pendurada (o 524 medido em /canal/*).
    const promessa = withCeiling(buscaInicial, CANAIS_FETCH_CEILING_MS, state.canaisCache || []);
    state.currentFetchPromise = promessa;
    const liberar = () => {
        if (state.currentFetchPromise === promessa) state.currentFetchPromise = null;
    };
    promessa.then(liberar, liberar);
    return promessa;
}

/**
 * Traduz um canal da nossa API para o formato interno usado no site inteiro
 * ({ id, nome, imagem, url, categoria }). O `id` é o slug da nossa API — é ele que casa com
 * as chaves do EPG e com a URL /canal/{slug}.
 * Maps one channel from our API into the site-wide internal shape.
 */
function mapNossoCanal(c) {
    // `categories` vem vazio e as categorias reais chegam em `category_names` (um canal pode
    // ter várias; a primeira é a principal, ex: "24 Horas" antes de "Séries").
    const categoria = (Array.isArray(c?.category_names) && c.category_names[0])
        || (typeof c?.category === 'string' ? c.category.split(',')[0].trim() : '')
        || 'Geral';

    return {
        id: String(c?.id || slugify(c?.name || '')),
        nome: c?.name || 'Canal TV',
        imagem: c?.image || '/placeholder.jpg',
        url: c?.url || '',
        categoria
    };
}

async function fetchNossosCanaisPagina(apiUrl, page, timeoutMs) {
    const separador = apiUrl.includes('?') ? '&' : '?';
    const url = `${apiUrl}${separador}page=${page}&limit=${SB_CHANNELS_PAGE_SIZE}`;
    const payload = await fetchNossaApi(url, timeoutMs);
    return {
        canais: (Array.isArray(payload?.channels) ? payload.channels : []).map(mapNossoCanal),
        totalPages: Number(payload?.pagination?.totalPages) || 1
    };
}

async function fetchNossosCanais() {
    const FETCH_TIMEOUT = 8000;
    // Teto de páginas: a API pagina em no máximo 100 por vez e hoje são ~135 canais. O limite
    // impede que uma paginação inconsistente vire um laço infinito dentro do SSR.
    const MAX_PAGES = 5;
    const apiUrl = await getConfig(SB_CHANNELS_URL_KEY, 'https://streambetter.shop/api/channels');

    try {
        const primeira = await fetchNossosCanaisPagina(apiUrl, 1, FETCH_TIMEOUT);
        if (primeira.canais.length === 0) throw new Error('Sem canais válidos');

        const canais = [...primeira.canais];
        const ultimaPagina = Math.min(primeira.totalPages, MAX_PAGES);

        // Páginas restantes em paralelo: em série, 5 páginas a 8s de teto cada somariam 40s e
        // estourariam sozinhas o teto de 8,5s de quem chama. / Remaining pages in parallel.
        const restantes = [];
        for (let page = 2; page <= ultimaPagina; page++) restantes.push(page);

        const paginas = await Promise.all(
            restantes.map((page) => fetchNossosCanaisPagina(apiUrl, page, FETCH_TIMEOUT).catch(() => null))
        );
        for (const pagina of paginas) {
            if (pagina?.canais?.length) canais.push(...pagina.canais);
        }

        console.log(`✅ [Canais] ${canais.length} canais carregados da nossa API.`);
        return canais;
    } catch (e) {
        console.warn('⚠️ [Canais] Falha ao buscar canais da nossa API:', e.message);
        axiomService.logError(e, { servico: "channelsService", funcao: "fetchNossosCanais" }).catch(() => {});
        return [];
    }
}

// --- EPG (Guia de Programação) — mesma fonte/slugs da nossa API de canais ---

if (!globalThis._bf_epg_state) {
    globalThis._bf_epg_state = {
        gridCache: null,
        gridFetchedAt: 0,
        currentFetchPromise: null,
        failedAt: 0,
        failStreak: 0
    };
}
const epgState = globalThis._bf_epg_state;
const EPG_MEM_TTL = 60 * 60 * 1000; // 1 hora
const EPG_FETCH_TIMEOUT = 8000;
// Espera depois de uma falha, dobrando a cada tentativa frustrada. Só o sucesso zera.
const EPG_FAIL_BACKOFF_BASE = 60 * 1000;      // 1 min
const EPG_FAIL_BACKOFF_MAX = 15 * 60 * 1000;  // 15 min
// Janela pedida à nossa API. A grade é chaveada pelo mesmo slug que vira o `id` do canal,
// então o casamento com getNowPlayingBulk é direto, sem tabela de-para.
const EPG_HOURS_PAST = 6;
const EPG_HOURS_FUTURE = 36;

async function fetchEpgAll() {
    try {
        const epgBase = await getConfig(SB_EPG_URL_KEY, 'https://streambetter.shop/api/epg');
        const separador = epgBase.includes('?') ? '&' : '?';
        const epgUrl = `${epgBase}${separador}channel=all&hoursPast=${EPG_HOURS_PAST}&hoursFuture=${EPG_HOURS_FUTURE}`;

        const raw = await fetchNossaApi(epgUrl, EPG_FETCH_TIMEOUT);
        if (!raw?.channels || typeof raw.channels !== 'object') {
            throw new Error('Formato de resposta inesperado');
        }

        return parseEpgAll(raw.channels);
    } catch (e) {
        console.warn('⚠️ [EPG] Falha ao buscar guia de programação:', e.message);
        axiomService.logError(e, { servico: 'channelsService', funcao: 'fetchEpgAll' }).catch(() => {});
        return null;
    }
}

/**
 * Nossa API já entrega início E fim de cada programa (em segundos), então não há mais o
 * chute de duração que o provedor antigo obrigava — só a conversão para milissegundos.
 * Our API returns both start and stop per program, so no duration guessing is needed.
 */
function parseEpgAll(channels) {
    const byChannel = {};

    for (const [slug, programas] of Object.entries(channels)) {
        if (!slug || !Array.isArray(programas) || programas.length === 0) continue;

        const schedule = programas
            .map((p) => ({
                title: p?.title || 'Sem título',
                start: Number(p?.startAt) * 1000,
                stop: Number(p?.stopAt) * 1000
            }))
            .filter((p) => !isNaN(p.start) && !isNaN(p.stop) && p.stop > p.start)
            .sort((a, b) => a.start - b.start);

        if (schedule.length > 0) byChannel[slug] = schedule;
    }

    return byChannel;
}

// Quanto esperar antes de tentar de novo, dado o número de falhas seguidas.
function epgFailBackoffMs() {
    const streak = epgState.failStreak || 0;
    if (streak <= 0) return 0;
    return Math.min(EPG_FAIL_BACKOFF_BASE * 2 ** (streak - 1), EPG_FAIL_BACKOFF_MAX);
}

async function getEpgGrid() {
    const now = Date.now();
    if (epgState.gridCache && now - epgState.gridFetchedAt < EPG_MEM_TTL) {
        return epgState.gridCache;
    }
    if (epgState.currentFetchPromise) return epgState.currentFetchPromise;

    // Backoff depois de falhar. Sem isto, só o SUCESSO atualizava `gridFetchedAt`, então uma
    // origem devolvendo 429 fazia cada requisição seguinte tentar de novo na hora — o rate
    // limit se alimentava sozinho e nunca saía dele. Aqui a grade velha (ou vazia) é servida
    // sem tocar na origem até a janela passar; a busca é espaçada, não sacrificada.
    const backoff = epgFailBackoffMs();
    if (backoff > 0 && now - (epgState.failedAt || 0) < backoff) {
        return epgState.gridCache || {};
    }

    epgState.currentFetchPromise = (async () => {
        try {
            // Teto próprio, acima do timeout do fetch. Sem ele, uma única busca pendurada
            // ficava cacheada aqui e TODA requisição seguinte no mesmo isolate herdava a
            // mesma promise travada — o `finally` nunca rodava, então o isolate servia
            // páginas penduradas até morrer. Com o teto, o pior caso é uma grade vazia.
            const data = await withCeiling(fetchEpgAll(), EPG_FETCH_TIMEOUT + 1000, null);
            if (data && Object.keys(data).length > 0) {
                epgState.gridCache = data;
                epgState.gridFetchedAt = Date.now();
                epgState.failedAt = 0;
                epgState.failStreak = 0;
            } else {
                epgState.failedAt = Date.now();
                epgState.failStreak = (epgState.failStreak || 0) + 1;
            }
            return epgState.gridCache || {};
        } finally {
            epgState.currentFetchPromise = null;
        }
    })();

    return epgState.currentFetchPromise;
}

function calcCurrentProgram(schedule, now) {
    if (!Array.isArray(schedule) || schedule.length === 0) return null;

    let currentProg = schedule.find((p) => now >= p.start && now <= p.stop);
    if (!currentProg) {
        currentProg = [...schedule].reverse().find((p) => now >= p.start) || null;
    }
    if (!currentProg) return null;

    const currentIndex = schedule.indexOf(currentProg);
    const nextProgs = schedule.slice(currentIndex + 1, currentIndex + 6); // até 5 próximos
    const duration = currentProg.stop - currentProg.start;
    const progress = duration > 0 ? Math.round(((now - currentProg.start) / duration) * 100) : 0;

    return {
        title: currentProg.title,
        start: currentProg.start,
        stop: currentProg.stop,
        progress: Math.min(Math.max(progress, 0), 100),
        next: nextProgs.map((p) => ({ title: p.title, start: p.start, stop: p.stop }))
    };
}

/**
 * Retorna a programação atual (+ próximos programas) de múltiplos canais de uma vez.
 */
export async function getNowPlayingBulk(channelIds) {
    if (!channelIds || channelIds.length === 0) return {};
    try {
        const now = Date.now();
        const grid = await getEpgGrid();
        const results = {};
        for (const id of channelIds) {
            const schedule = grid[id];
            if (!schedule) continue;
            const info = calcCurrentProgram(schedule, now);
            if (info) results[id] = info;
        }
        return results;
    } catch (e) {
        console.warn('⚠️ [EPG] Erro ao calcular programação atual:', e.message);
        return {};
    }
}

// Funções auxiliares baseadas na nova estrutura
export async function getCanalById(id) {
    const canais = await fetchCanais();
    let found = canais.find(c => c.id === String(id));
    if (!found && id) {
        // Fallback robusto por slug/nome para evitar erros de ID dinâmico (Superflix vs Estático)
        const cleanId = String(id).toLowerCase().replace(/^expired_/, '').replace(/^jogo_/, '');
        found = canais.find(c => 
            slugify(c.nome) === cleanId || 
            String(c.id).toLowerCase() === cleanId ||
            String(c.id).toLowerCase().replace(/^jogo_/, '') === cleanId
        );
    }
    return found || null;
}

export async function getCategoriasUnicas() {
    const canais = await fetchCanais();
    const categorias = [...new Set(canais.map(c => c.categoria))].filter(Boolean);
    return categorias.sort();
}

/**
 * Busca a lista de IDs de canais que necessitam de VIP com lógica Stale-While-Revalidate.
 */
export async function fetchVipChannels(forceFresh = false) {
    const agora = Date.now();
    const isDev = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || 
                  (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') || 
                  false;
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    const ttl = (isDev && !isTest) ? 0 : 10000; // 0s em dev, 10s em prod/testes para permitir teste de cache HIT

    if (!forceFresh && state.vipChannelsCache && (agora - state.vipCacheTimestamp < ttl)) {
        return state.vipChannelsCache;
    }

    if (state.currentVipFetchPromise) return state.currentVipFetchPromise;

    const buscaVip = (async () => {
        let timeoutId;
        try {
            const fetchPromise = supabaseAdmin.from('vip_channels').select('channel_id');
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Timeout de 8 segundos excedido')), 8000);
            });

            const { data, error } = await Promise.race([
                fetchPromise.then(res => { clearTimeout(timeoutId); return res; }),
                timeoutPromise
            ]);

            if (error) throw error;
            
            const vipIds = (data || []).map(r => String(r.channel_id));
            state.vipChannelsCache = vipIds;
            state.vipCacheTimestamp = Date.now();
            return state.vipChannelsCache;
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            console.warn(`⚠️ [Service] Falha ao sintonizar VIPs da Supabase:`, err.message);
            return state.vipChannelsCache || [];
        }
    })();

    // Mesmo teto e mesma razão do fetchCanais acima. Aqui o sintoma era ainda mais direto de
    // medir: os endpoints que SÓ chamam esta função devolviam 524 em cerca de metade das
    // requisições. E como o singleton é global do isolate, a busca travada contaminava
    // também /canal/* (que monta o cadeado VIP aqui).
    const promessa = withCeiling(buscaVip, VIP_FETCH_CEILING_MS, state.vipChannelsCache || []);
    state.currentVipFetchPromise = promessa;
    const liberar = () => {
        if (state.currentVipFetchPromise === promessa) state.currentVipFetchPromise = null;
    };
    promessa.then(liberar, liberar);
    return promessa;
}


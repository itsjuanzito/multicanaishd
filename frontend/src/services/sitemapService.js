import { genres } from "../utils/genres";
import { LIGAS } from "../utils/futebolLigas.js";
import { fetchTrending } from "./trendingService";
import { fetchCanais } from "./channelsService.js";
import { getSuperflixIds } from "./superflix-ids.js";
import { getEnv, getSiteUrl } from "./env-adapter.js";
import { slugify } from "../utils/slugify.js";
import { slugCanonicoPt, slugCanonicoEn, slugSemPrefixoId } from "../utils/canonicalSlug.js";
import { getContentList } from "./content-lists.js";
import { getEnrichedCatalogEntries } from "./catalogEnrichmentService.js";
import { syncRotationsCache } from "./urlRotationService.js";
import { axiomService } from "./axiom-service.js";
import { renderUrlset, renderIndex, supportsEnglishAlternate, escapeXml, TMDB_SITEMAP_PAGES, SITEMAP_FETCH_TIMEOUT } from "./sitemapXml.js";
import { chaveDeMidia, gravarPares, chavePares } from "./contentSlugPairs.js";
import { coletarEntradasDeEpisodios } from "./sitemapEpisodios.js";
import { getTMDBDetails, getTMDBSeasonDetails } from "./tmdb.js";

// Desativamos o prerender para que o sitemap reflita novos itens em tempo real (SSR)
// NUCLEAR CACHE: Cache em memória RAM para sobrevivência a falhas de API (Pilar 4)
globalThis._sitemap_cache = globalThis._sitemap_cache || { xml: null, timestamp: 0, host: '' };


const dedupeEntriesByPath = (entries) => {
    const seen = new Set();
    return entries.filter((entry) => {
        if (!entry?.path || seen.has(entry.path)) return false;
        seen.add(entry.path);
        return true;
    });
};


export async function coletarEntradas(context) {
    const site = context.site;
    const locals = context.locals;

    // Garante que o ambiente de runtime esteja populado (Pilar 3)
    try {
        if (locals?.runtime?.env) {
            const { setRuntimeEnv } = await import("./env-adapter.js");
            setRuntimeEnv(locals.runtime.env);
        }
    } catch (e) {
        console.error("❌ [Sitemap] Erro ao configurar runtime env:", e);
    }

    const siteUrl = getSiteUrl(context.url);
    const kv = getEnv('SESSION');
    // Mapa id -> { pt, en } preenchido no laço abaixo e gravado junto com os lotes. Consumido
    // pelas páginas de conteúdo para emitir hreflang (ver contentSlugPairs.js).
    const paresDeSlug = {};
    // A chave carrega o DOMINIO. Sem isso, uma troca de dominio continuava servindo por 6h o
    // XML antigo — com 22 mil URLs do dominio velho, todas respondendo 301 — e o Search
    // Console do dominio novo recusava o sitemap inteiro por conter URLs de outra
    // propriedade. Foi exatamente o que aconteceu na migracao pro .cfd.
    const hostCache = (() => {
        try {
            return new URL(siteUrl).hostname;
        } catch {
            return 'desconhecido';
        }
    })();

    const buildDate = new Date().toISOString().split('T')[0];
    const staticPages = [
        "",
        "/filmes-online",
        "/series-online",
        "/animes-online",
        "/doramas-online",
        "/explorar",
        "/canais",
        // Hubs de futebol: as páginas de partida (/canal/{time-x-time}) continuam fora do
        // sitemap por serem efêmeras, mas os hubs são perenes e é por eles que o crawler
        // alcança os jogos do dia.
        ...LIGAS.map((liga) => `/${liga.slug}`),
        "/calendario",
        "/changelog",
        "/vip",
        "/ranking"
    ];

    const genrePages = genres.map(g => `/genero/${g.slug || g.id}`);

    let dynamicEntries = [];
    try {
        const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
        
        // id TMDB -> nome em inglês. Preenchido por fetchMassiveTMDB e consumido na hora de
        // montar o slug /en (ver canonicalSlug.js).
        const enNamesById = new Map();

        const fetchMassiveTMDB = async () => {
            if (!apiKey) return [];
            let availableIds = { movies: new Set(), series: new Set(), anime: new Set() };
            try { availableIds = await getSuperflixIds() || availableIds; } catch (e) {}

            const fetchPage = async (type, endpoint, page, language = 'pt-BR') => {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT);
                    const res = await fetch(`https://api.themoviedb.org/3/${endpoint}?language=${language}&page=${page}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    if (!res.ok) return [];
                    const data = await res.json();
                    // `fonte` marca de QUAL lista o item veio. Sem isso, os candidatos a
                    // episódio (só séries no ar) teriam que ser inferidos pela posição do
                    // item no array de resultados — frágil e impossível de ler.
                    return (data.results || []).map(item => ({...item, media_type: type, fonte: endpoint}));
                } catch (e) {
                    return [];
                }
            };

            const promises = [];
            const PAGES_TO_FETCH = TMDB_SITEMAP_PAGES;
            const tmdbSources = [
                ['movie', 'movie/popular'],
                ['movie', 'movie/top_rated'],
                ['movie', 'movie/now_playing'],
                ['tv', 'tv/popular'],
                ['tv', 'tv/top_rated'],
                ['tv', 'tv/on_the_air']
            ];
            
            // As mesmas listas são buscadas também em en-US. Não é redundância: o slug canônico
            // de /en/* cai no NOME EM INGLÊS quando o título original é não-latino (coreano,
            // japonês, chinês — que transliteração barata não resolve, ver slugify.js), e esse
            // campo simplesmente não existe na resposta pt-BR. Sem ele o sitemap chutava o
            // título original e anunciava ao crawler uma URL que a rota /en 301-ava na hora.
            // Custa 1 fetch a mais por página de lista, uma vez a cada 6h (TTL do cache).
            const enPromises = [];
            for (let i = 1; i <= PAGES_TO_FETCH; i++) {
                for (const [type, endpoint] of tmdbSources) {
                    promises.push(fetchPage(type, endpoint, i));
                    enPromises.push(fetchPage(type, endpoint, i, 'en-US'));
                }
            }

            const [results, enResults] = await Promise.all([
                Promise.all(promises),
                Promise.all(enPromises).catch(() => [])
            ]);
            enResults.flat().forEach(item => {
                const enName = item.title || item.name;
                if (enName) enNamesById.set(Number(item.id), enName);
            });
            let allItems = results.flat();

            // Filtro de Qualidade de Conteúdo TMDB (poster_path !== null e vote_count >= 30) (Pilar 4)
            // Quality filter for TMDB content (poster_path !== null and vote_count >= 30)
            allItems = allItems.filter(item => {
                const hasPoster = !!item.poster_path;
                const hasMinVotes = item.vote_count !== undefined ? item.vote_count >= 30 : true;
                return hasPoster && hasMinVotes;
            });

            const hasIds = availableIds.movies.size > 0 || availableIds.series.size > 0;
            if (hasIds) {
                allItems = allItems.filter(item => {
                    const id = Number(item.id);
                    if (item.media_type === 'movie') return availableIds.movies.has(id);
                    if (item.media_type === 'tv') return availableIds.series.has(id) || availableIds.anime.has(id);
                    return false;
                });
            }

            // Candidatos a episódio: SÓ as séries da lista `tv/on_the_air`, e extraídos ANTES
            // do dedupe por id — uma série que também está em tv/popular perderia a marca
            // `fonte` do on_the_air, já que o dedupe mantém a primeira ocorrência.
            const candidatosEpisodios = Array.from(
                new Set(allItems.filter(item => item.fonte === 'tv/on_the_air').map(item => Number(item.id)))
            );

            const uniqueMap = new Map();
            allItems.forEach(item => { if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item); });
            return { itens: Array.from(uniqueMap.values()), candidatosEpisodios };
        };

        const [tmdbMassivo, canais, animesList, doramasList, enrichedCatalog, rotationsMap] = await Promise.all([
            // `.catch(() => [])` sozinho já custou caro: foi ele que escondeu o ReferenceError
            // das constantes não importadas e deixou o sitemap sem a fonte TMDB por completo,
            // sem um único log. Falha de fonte agora aparece.
            fetchMassiveTMDB().catch((e) => {
                console.error("[Sitemap] Falha ao buscar listas do TMDB:", e?.message || e);
                return { itens: [], candidatosEpisodios: [] };
            }),
            fetchCanais().catch(() => []),
            getContentList('animes', 'pt').catch(() => ({ results: [] })),
            getContentList('doramas', 'pt').catch(() => ({ results: [] })),
            getEnrichedCatalogEntries().catch(() => []),
            syncRotationsCache().catch(() => new Map())
        ]);

        const allMedia = [...(tmdbMassivo?.itens || [])];
        const candidatosEpisodios = tmdbMassivo?.candidatosEpisodios || [];
        const animeResults = animesList?.results || [];
        const doramaResults = doramasList?.results || [];

        // Dedup por chave "tipo:id" em O(1) — antes usava .some() dentro de forEach (O(n²))
        // sobre arrays que podem ter centenas/milhares de itens, custando CPU real a cada
        // miss do cache de 6h deste sitemap.
        const seenMediaKeys = new Set(allMedia.map(m => `${m.media_type || 'movie'}:${Number(m.id)}`));

        // Catálogo real enriquecido em background (ver catalogEnrichmentService.js) — cobre
        // títulos disponíveis no site que não aparecem nas listas "popular/top_rated" do TMDB.
        (enrichedCatalog || []).forEach(entry => {
            const key = `${entry.type}:${Number(entry.id)}`;
            if (!seenMediaKeys.has(key)) {
                seenMediaKeys.add(key);
                allMedia.push({
                    id: entry.id,
                    media_type: entry.type,
                    title: entry.title,
                    name: entry.title,
                    original_title: entry.originalTitle,
                    original_name: entry.originalTitle,
                    poster_path: entry.posterPath,
                    release_date: entry.type === 'movie' ? entry.date : undefined,
                    first_air_date: entry.type === 'tv' ? entry.date : undefined
                });
            }
        });

        animeResults.forEach(item => {
            const mediaType = item.media_type || 'tv';
            const key = `${mediaType}:${Number(item.id)}`;
            if (!seenMediaKeys.has(key)) {
                seenMediaKeys.add(key);
                allMedia.push({ ...item, media_type: mediaType });
            }
        });

        doramaResults.forEach(item => {
            const mediaType = item.media_type || 'tv';
            const key = `${mediaType}:${Number(item.id)}`;
            if (!seenMediaKeys.has(key)) {
                seenMediaKeys.add(key);
                allMedia.push({ ...item, media_type: mediaType });
            }
        });

        // Anti-DMCA: uma obra com rotação ativa precisa aparecer no sitemap MESMO que não
        // esteja em nenhuma das listas acima — enrichCatalogBatch já exclui título com menos
        // de 30 votos ou sem poster no TMDB (MIN_VOTE_COUNT em catalogEnrichmentService.js), e
        // é exatamente esse tipo de título menos popular que costuma ser alvo de notificação
        // Lumen/DMCA. Sem isto, a rotação era gravada no banco e o 301 funcionava, mas a nova
        // URL nunca chegava a ser anunciada ao Googlebot — a rotação "não fazia nada" na prática.
        if (rotationsMap && typeof rotationsMap.forEach === 'function') {
            rotationsMap.forEach((rot) => {
                const mediaType = rot.media_type === 'series' ? 'tv' : 'movie';
                const key = `${mediaType}:${Number(rot.media_id)}`;
                if (seenMediaKeys.has(key)) return;
                seenMediaKeys.add(key);
                allMedia.push({
                    id: rot.media_id,
                    media_type: mediaType,
                    title: rot.media_title,
                    name: rot.media_title,
                });
            });
        }

        allMedia.forEach(item => {
            const title = item.title || item.name;
            // Guard: sem título nenhum não há o que indexar.
            if (!title) return;
            // Slug pela MESMA função que a rota de destino usa pra decidir seu canônico
            // (canonicalSlug.js). Divergir daqui significa anunciar ao crawler uma URL que
            // responde 301 — era 46% de todo o tráfego do site.
            const base = `/${item.media_type === 'movie' ? 'filme' : 'serie'}`;
            const ptSlug = slugCanonicoPt(item);
            const standardSlug = `${item.id}-${ptSlug}`;
            // Anti-DMCA: Se houver rotação ativa cadastrada, o sitemap anuncia a nova URL diretamente pro Googlebot
            const rotKey = `${item.media_type === 'tv' ? 'series' : (item.media_type || 'movie')}:${item.id}`;
            const activeRot = rotationsMap?.get ? rotationsMap.get(rotKey) : null;
            const finalSlug = activeRot?.current_slug || standardSlug;
            const path = `${base}/${finalSlug}`;

            const enName = enNamesById.get(Number(item.id)) || null;
            // Anti-DMCA por idioma: current_slug_en guarda o slug EN rotacionado COMPLETO (com o
            // id). `paresDeSlug` e as páginas trabalham com o sufixo sem id (`${id}-${par.en}`),
            // então o prefixo é removido aqui — o mesmo valor serve pro sitemap e pro hreflang.
            const enSlugRotacionado = slugSemPrefixoId(item.id, activeRot?.current_slug_en);
            const enSlug = slugCanonicoEn(item, enName);
            const enFinalSlug = enSlugRotacionado || enSlug;
            const enPath = `${base}/${item.id}-${enFinalSlug}`;
            // Quem decide o canônico de /en é o nome em inglês (ver slugCanonicoEn). Sem ele —
            // itens que vêm só das listas pt de anime/dorama/catálogo enriquecido — não há como
            // prever o canônico, e qualquer chute vira 301 na cara do crawler. Nesses casos
            // omitimos o alternate: melhor não anunciar do que anunciar URL que redireciona.
            // Exceção: rotação EN cadastrada JÁ é o canônico confirmado desse idioma.
            const enUnknown = !enName && !enSlugRotacionado;

            // Mapa que as PÁGINAS usam para emitir hreflang correto (ver contentSlugPairs.js).
            // É o mesmo cálculo que acabou de ser feito aqui para o sitemap — só que agora
            // persistido, para a rota não precisar de uma segunda chamada ao TMDB em inglês
            // por pageview só para descobrir o slug do outro idioma.
            const chavePar = chaveDeMidia(item.media_type, item.id);
            if (chavePar) paresDeSlug[chavePar] = { pt: ptSlug, en: enUnknown ? null : enFinalSlug };

            const image = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
            
            // Usa a data de lançamento real como lastmod para que o GoogleBot priorize conteúdo recente
            // Use actual release date as lastmod so GoogleBot prioritizes recent content
            //
            // Menos a anterior a 1970: o Google recusa lastmod antes da época Unix e marca a
            // entrada como "Data inválida" no Search Console (eram 319, todas de clássicos —
            // Branca de Neve de 1938, Django de 1966). Sem data que sirva, omitir a tag em vez
            // de inventar uma, mesma regra das páginas estáticas logo abaixo.
            const itemDate = item.release_date || item.first_air_date;
            const diaLancamento = itemDate ? itemDate.split('T')[0] : null;
            const itemLastmod = diaLancamento
                ? (diaLancamento >= '1970-01-01' ? diaLancamento : null)
                : buildDate;
            
            dynamicEntries.push({ path, enPath, enUnknown, image, title, priority: '0.8', changefreq: 'weekly', lastmod: itemLastmod });

        });

        // URLs de episódio das séries NO AR (ver services/sitemapEpisodios.js para os tetos e
        // o porquê de não entrar todo episódio de toda série). Roda depois do laço acima de
        // propósito: o mapa `paresDeSlug` precisa estar completo, porque é dele que sai o slug
        // canônico usado na URL do episódio — improvisar aqui produziria a URL que a rota
        // responde 301.
        const entradasDeEpisodios = await coletarEntradasDeEpisodios({
            candidatos: candidatosEpisodios,
            paresDeSlug,
            obterDetalhes: (serieId) => getTMDBDetails(serieId, 'tv', 'pt'),
            obterTemporada: (serieId, temporada) => getTMDBSeasonDetails(serieId, temporada, 'pt'),
        });
        dynamicEntries.push(...entradasDeEpisodios);
        if (entradasDeEpisodios.length > 0) {
            console.warn(`[Sitemap] ${entradasDeEpisodios.length} URLs de episódio incluídas (teto: SITEMAP_EPISODIOS_MAX_SERIES/SITEMAP_EPISODIOS_POR_SERIE).`);
        }

        // Canais perenes de TV vão pro sitemap; jogos dinâmicos são omitidos pois expiram após a partida.
        // Permanent TV channels go to sitemap; dynamic game events are omitted as they expire after the match.
        (canais || []).filter(c => !String(c.id).startsWith('jogo_')).forEach(c => {
            const path = `/canal/${slugify(c.nome)}`;
            dynamicEntries.push({ path, image: c.imagem, title: c.nome, priority: '0.7', changefreq: 'daily' });
        });


    } catch (e) {
        console.error("Erro ao gerar sitemap dinâmico:", e);
        const logPromise = axiomService.logError(e, { rota: "/sitemap.xml" });
        if (locals?.runtime?.waitUntil) {
            locals.runtime.waitUntil(logPromise);
        } else {
            logPromise.catch(() => {});
        }
    }

    // Sem lastmod real para páginas estáticas/gênero: omitir a tag em vez de mandar
    // a data de hoje a cada request, que o Google passa a ignorar por não ser confiável.
    const staticEntries = staticPages.map(p => ({
        path: p === '' ? '/' : p,
        image: `${siteUrl}/og-image.jpg`,
        title: 'MultiCanaisHD',
        priority: '1.0',
        changefreq: 'daily'
    }));

    const genreEntries = genrePages.map(p => ({
        path: p,
        image: `${siteUrl}/og-image.jpg`,
        title: 'Explorar Gêneros',
        priority: '0.6',
        changefreq: 'weekly'
    }));

    // Ordena as entradas dinâmicas por lastmod decrescente para que as novidades e
    // lançamentos mais recentes fiquem priorizados logo no Lote 1 (sitemap-1.xml).
    dynamicEntries.sort((a, b) => {
        const da = a.lastmod || '1970-01-01';
        const db = b.lastmod || '1970-01-01';
        return db.localeCompare(da);
    });

    const allEntries = dedupeEntriesByPath([...staticEntries, ...genreEntries, ...dynamicEntries]);

    // Guarda de segurança: o protocolo de sitemap limita 50k <url> por arquivo.
    // Cada entrada pode virar até 2 <url> (pt+en), então soamos o alarme bem antes do limite
    // para dar tempo de migrar para um sitemap index antes de gerar um XML inválido.
    if (allEntries.length * 2 > 40000) {
        console.error(`⚠️ [Sitemap] ${allEntries.length} entradas — perto do limite de 50k URLs do protocolo. Migrar para sitemap index.`);
    }

    // Sem dados dinamicos: sinaliza degradado pra rota decidir (servir cache velho do
    // mesmo dominio e melhor que servir sitemap vazio).
    const degradado = dynamicEntries.length === 0;


    // buildDate defined at the top

    return { entries: allEntries, siteUrl, hostCache, kv, degradado, paresDeSlug };
}


// ============================================================================
// INDICE DE SITEMAPS
//
// O sitemap era um arquivo unico de 22 mil entradas e 8,7 MB. Dentro do limite do
// protocolo (50 mil URLs / 50 MB), mas o Google recusava com "nao foi possivel buscar".
// O padrao que funciona -- e que o outro projeto ja usava -- e um indice apontando pra
// lotes menores.
//
// Aqui os lotes NAO sao resolviveis sozinhos como no streambetter (que fatia por faixa de
// id no banco): as entradas vem de dezenas de chamadas a TMDB montadas na hora. Entao a
// geracao roda uma vez, grava cada lote no KV, e as requisicoes seguintes leem so o seu
// pedaco -- em vez de refazer o catalogo inteiro pra servir 1/5 dele.
// ============================================================================

/** Entradas por lote. Cada uma vira ate 2 <url> (pt+en), entao ~10 mil URLs por arquivo. */
export const ENTRADAS_POR_LOTE = 5000;

const KV_TTL_SEGUNDOS = 21600; // 6h, igual ao cache anterior

// v5: o blob v4 foi gerado com lastmod anterior a 1970, que o Google recusa ("Data invalida",
// 319 entradas no Search Console). Reaproveita-lo serviria o XML invalido ate o TTL de 6h
// vencer, mesmo com a correcao ja no ar — e nao ha como apagar a chave sem credencial de
// producao. Versionar a chave e o jeito do projeto de descartar cache cujo CONTEUDO mudou
// (ver o mesmo v7 em channelsService.js); as chaves v4 somem sozinhas pelo expirationTtl.
const chaveLote = (host, n) => `sitemap_v5:${host}:lote:${n}`;
const chaveTotal = (host) => `sitemap_v5:${host}:total`;


/**
 * Gera tudo, grava os lotes no KV e devolve { total, xmlDoLotePedido }. Chamado no miss de
 * qualquer uma das rotas — a primeira que chegar paga a geracao e as outras leem do KV.
 *
 * `loteDesejado` evita guardar XML que ninguém vai devolver: a rota /sitemap-N.xml só precisa
 * do lote N, e o índice só precisa do total.
 */
export async function gerarEGravarLotes(context, loteDesejado = null) {
    const { entries, siteUrl, hostCache, kv, degradado, paresDeSlug } = await coletarEntradas(context);
    const total = Math.max(1, Math.ceil(entries.length / ENTRADAS_POR_LOTE));

    // Geração degradada (nenhuma entrada dinâmica: TMDB/Supabase fora, tudo caiu nos
    // `.catch` de coletarEntradas) GRAVAVA no KV assim mesmo e substituía por 6h um sitemap
    // bom por um com as ~25 páginas estáticas. O `degradado` era calculado desde sempre e
    // nunca consumido — a rota ia "decidir" e nunca decidiu.
    //
    // Não gravar é a correção conservadora: o blob bom anterior continua sendo servido até o
    // TTL vencer, e o pior caso (KV vazio) é regenerar por requisição em vez de anunciar ao
    // Google um catálogo pela metade.
    const podeGravar = !degradado && kv && typeof kv.put === "function";
    if (degradado) {
        console.error("[Sitemap] Geração degradada (sem entradas dinâmicas) — KV preservado, cache não sobrescrito.");
    }

    // Renderiza e grava UM lote por vez. Antes, TODOS os XMLs eram montados em memória
    // (`.map(renderUrlset)`) antes do primeiro `put`: com os ~43 mil títulos que o
    // getSuperflixIds() reporta — e que o enriquecimento agora vai alcançar, já que o cron
    // voltou a rodar — são dezenas de MB de string seguradas de uma vez contra o limite de
    // 128 MB do Worker. Era o caminho para o sitemap começar a falhar justamente quando
    // ficasse completo.
    let xmlDoLotePedido = null;
    let houveFalhaAoGravar = false;

    for (let n = 1; n <= total; n++) {
        const fatia = entries.slice((n - 1) * ENTRADAS_POR_LOTE, n * ENTRADAS_POR_LOTE);
        const xml = renderUrlset(fatia, siteUrl);

        if (podeGravar) {
            try {
                await kv.put(chaveLote(hostCache, n), xml, { expirationTtl: KV_TTL_SEGUNDOS });
            } catch (e) {
                houveFalhaAoGravar = true;
                console.error(`[Sitemap] Falha ao gravar o lote ${n} no KV:`, e.message);
            }
        }

        if (loteDesejado === n) xmlDoLotePedido = xml;
    }

    // `chaveTotal` é gravada por ÚLTIMO e só quando todos os lotes foram gravados: ela é o
    // ponteiro que o índice usa para montar a lista de filhos, então publicá-la com um lote
    // faltando faria o índice anunciar um /sitemap-N.xml que responde 404 — pior que servir a
    // geração anterior inteira por mais 6h.
    if (podeGravar && !houveFalhaAoGravar) {
        try {
            await Promise.all([
                kv.put(chaveTotal(hostCache), String(total), { expirationTtl: KV_TTL_SEGUNDOS }),
                // Mesmo TTL dos lotes: é o mapa que as páginas leem para o hreflang.
                gravarPares(kv, hostCache, paresDeSlug),
            ]);
        } catch (e) {
            console.error("[Sitemap] Falha ao gravar o total/par de slugs no KV:", e.message);
        }
    }

    return { total, xmlDoLotePedido, siteUrl, hostCache, degradado };
}

/** Le do KV, ou gera. Devolve { total, siteUrl }. */
export async function obterTotalDeLotes(context) {
    const siteUrl = getSiteUrl(context.url);
    const host = (() => {
        try {
            return new URL(siteUrl).hostname;
        } catch {
            return "desconhecido";
        }
    })();
    const kv = getEnv("SESSION");

    if (kv && typeof kv.get === "function") {
        try {
            const total = Number(await kv.get(chaveTotal(host)));
            if (total > 0) return { total, siteUrl, cache: "HIT" };
        } catch (e) {
            console.error("[Sitemap] Falha ao ler total do KV:", e.message);
        }
    }

    const gerado = await gerarEGravarLotes(context);
    return { total: gerado.total, siteUrl, cache: "MISS" };
}

/**
 * XML de um lote (1-indexado) e de onde ele veio: { xml, cache }. `xml` é null se o numero
 * estiver fora da faixa.
 *
 * O `cache` é devolvido junto porque quem responde a requisicao nao tem como saber se o KV
 * respondeu — e sem isso o header X-Sitemap-Cache saia fixo em "MISS" em toda resposta,
 * dizendo "acabei de gerar" justamente quando o XML era o cacheado. Isso ja custou tempo de
 * depuracao: um sitemap corrigido em deploy continuava servindo o conteudo velho do KV e o
 * header afirmava o contrario.
 */
export async function obterLote(context, numero) {
    const siteUrl = getSiteUrl(context.url);
    const host = (() => {
        try {
            return new URL(siteUrl).hostname;
        } catch {
            return "desconhecido";
        }
    })();
    const kv = getEnv("SESSION");

    if (kv && typeof kv.get === "function") {
        try {
            const xml = await kv.get(chaveLote(host, numero));
            if (xml) return { xml, cache: "HIT" };
        } catch (e) {
            console.error("[Sitemap] Falha ao ler lote do KV:", e.message);
        }
    }

    const gerado = await gerarEGravarLotes(context, numero);
    return { xml: gerado.xmlDoLotePedido || null, cache: "MISS" };
}

/**
 * Derruba o cache do sitemap pro host atual, pra uma rotacao Anti-DMCA (ou o cron de
 * enriquecimento) não ficar esperando até 6h (KV_TTL_SEGUNDOS) pra aparecer pro Googlebot.
 *
 * Antes, `enrich-catalog.js` tentava fazer isso apagando uma chave (`sitemap_xml_cache_v2`)
 * que nunca existiu — o cache de verdade é fatiado por host em `sitemap_v4:<host>:lote:N` —
 * então a invalidação era um no-op silencioso e o sitemap ficava até 6h desatualizado depois
 * de toda rotação, exatamente o motivo mais provável de "rotacionei e não reindexou".
 *
 * `siteUrlHint` é opcional: fora do contexto de uma requisição (o cron do enrich-catalog não
 * tem `Astro.url`) getSiteUrl() já cai pro env var/domínio padrão sozinho.
 */
export async function invalidarCacheSitemap(siteUrlHint) {
    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function' || typeof kv.delete !== 'function') return;

    const siteUrl = getSiteUrl(siteUrlHint);
    let host = 'desconhecido';
    try {
        host = new URL(siteUrl).hostname;
    } catch (e) {}

    try {
        const total = Number(await kv.get(chaveTotal(host))) || 0;
        // O mapa de slugs pt/en sai junto: ele é gerado na MESMA passada dos lotes, então
        // deixá-lo para trás faria as páginas emitirem hreflang a partir de um catálogo velho.
        const deletes = [kv.delete(chaveTotal(host)), kv.delete(chavePares(host))];
        for (let i = 1; i <= total; i++) {
            deletes.push(kv.delete(chaveLote(host, i)));
        }
        await Promise.all(deletes);
    } catch (e) {
        console.error("[Sitemap] Falha ao invalidar cache após rotação/enriquecimento:", e.message);
    }
}

/** Cabecalhos comuns dos sitemaps. */
export function respostaSitemap(xml, cache = "MISS") {
    return new Response(xml, {
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=14400, s-maxage=86400, stale-while-revalidate=604800",
            "X-Sitemap-Cache": cache,
        },
    });
}

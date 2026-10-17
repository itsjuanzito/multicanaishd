import { getEnv } from './env-adapter.js';
import { fetchWithTimeout } from './fetch-util.js';
import { getCached, setCached, getStaleCached, setStaleCached, getKVCached, setKVCached, KV_TTL_SEASON_S, KV_TTL_SEASON_ENCERRADA_S, KV_CACHE_TTL_TEMPORADA_S, L1_TTL_L2_HIDRATADO_MS } from './cache.js';
import { getRedisClient } from './redis-client.js';

const getApiKey = () => getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');

async function fetchTMDB(urlPath, searchParams = {}, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("TMDB API Key missing");
    }

    const url = new URL(`https://api.themoviedb.org/3/${urlPath}`);
    
    for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value.toString());
        }
    }

    const headers = { ...options.headers };
    headers['Accept'] = 'application/json';

    if (apiKey.length < 50) {
        url.searchParams.set('api_key', apiKey);
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const timeout = options.timeout || 10000;
    const res = await fetchWithTimeout(url, {
        ...options,
        headers,
        timeout
    });

    return res;
}

// Helper para mapear locale do Astro para TMDB
function getTMDBLang(lang) {
    const map = {
        'pt': 'pt-BR',
        'en': 'en-US'
    };
    return map[lang] || 'pt-BR';
}

// Helper para limpar dados pesados de detalhes
function minifyDetails(data, type) {
    if (!data) return null;
    const min = {
        id: data.id,
        title: data.title || data.name,
        // Sem estes dois campos, TODA rota que calcula slug canônico decidia com informação
        // que este minify tinha jogado fora — o código pedia "título original, senão o
        // traduzido" e recebia sempre undefined no primeiro. O sitemap, que lê o item cru da
        // TMDB, tinha o original e usava: a divergência virava um 301 por acesso.
        // Se algum dia precisar cortar payload daqui, NÃO cortem estes: bump o cacheKey e
        // rode tests/unit/canonicalSlug.test.js antes.
        original_title: data.original_title || null,
        original_name: data.original_name || null,
        overview: data.overview,
        poster_path: data.poster_path,
        backdrop_path: data.backdrop_path,
        vote_average: data.vote_average,
        release_date: data.release_date || data.first_air_date,
        genres: data.genres?.map(g => ({ id: g.id, name: g.name })) || [],
        imdb_id: data.imdb_id || data.external_ids?.imdb_id || null,
        images: {
            backdrops: data.images?.backdrops?.slice(0, 6).map(img => ({ file_path: img.file_path })) || []
        },
        credits: {
            cast: data.credits?.cast?.slice(0, 10).map(c => ({
                id: c.id, name: c.name, character: c.character, profile_path: c.profile_path
            })) || []
        },
        trailer_key: data.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer')?.key || 
                     data.videos?.results?.find(v => v.site === 'YouTube')?.key || null
    };
    if (type === 'tv') {
        min.number_of_seasons = data.number_of_seasons;
        min.number_of_episodes = data.number_of_episodes;
        min.in_production = data.in_production;
        min.seasons = data.seasons?.map(s => ({
            id: s.id, season_number: s.season_number, name: s.name, episode_count: s.episode_count, poster_path: s.poster_path
        })) || [];
        min.next_episode_to_air = data.next_episode_to_air ? {
            air_date: data.next_episode_to_air.air_date,
            episode_number: data.next_episode_to_air.episode_number,
            name: data.next_episode_to_air.name,
            season_number: data.next_episode_to_air.season_number
        } : null;
    }
    return min;
}

// Helper para limpar dados de temporada
function minifySeason(data) {
    if (!data) return null;
    return {
        id: data.id,
        name: data.name,
        season_number: data.season_number,
        episodes: data.episodes?.map(ep => ({
            id: ep.id,
            name: ep.name,
            overview: ep.overview,
            episode_number: ep.episode_number,
            still_path: ep.still_path,
            air_date: ep.air_date
        })) || []
    };
}

export async function buscarNoTMDB(query, lang = 'pt') {
    if (!query) return { results: [] };
    const tmdbLang = getTMDBLang(lang);
    const cacheKey = `search_${tmdbLang}_${query.toLowerCase().trim()}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        // Buscamos as 3 primeiras páginas do TMDB em paralelo para obter até 60 resultados potenciais (Pilar 4: Otimização Extrema)
        const fetchPage = async (page) => {
            try {
                const res = await fetchTMDB('search/multi', {
                    query,
                    language: tmdbLang,
                    page: page.toString()
                }, { timeout: 6000 });
                
                if (res && res.ok) {
                    const data = await res.json();
                    return data.results || [];
                }
                return [];
            } catch (err) {
                console.error(`⚠️ [TMDB Search Page ${page} Failure]:`, err.message);
                return [];
            }
        };

        const pagesResults = await Promise.all([
            fetchPage(1),
            fetchPage(2),
            fetchPage(3),
            fetchPage(4),
            fetchPage(5)
        ]);

        const allResults = pagesResults.flat();
        
        // Deduplicar resultados pelo ID de forma resiliente (Pilar 2)
        const uniqueMap = new Map();
        for (const item of allResults) {
            if (item && item.id) {
                uniqueMap.set(item.id, item);
            }
        }

        const data = { results: Array.from(uniqueMap.values()) };
        setCached(cacheKey, data);
        return data;
    } catch (error) {
        console.error("❌ [TMDB Search Failure]:", error.message);
        return { results: [] };
    }
}


// Banco de dados estático de fallback premium em caso de queda total de rede ou API (Pilar 2: À Prova de Falhas)
const STATIC_GENRE_FALLBACKS = {
    "28": [ // Ação e Aventura
        { id: 299534, title: "Vingadores: Ultimato", poster_path: "/or06FN3Dka5tukK1e9sl16pB3iy.jpg", media_type: "movie", vote_average: 8.3 },
        { id: 634649, title: "Homem-Aranha: Sem Volta para Casa", poster_path: "/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg", media_type: "movie", vote_average: 8.0 },
        { id: 299536, title: "Vingadores: Guerra Infinita", poster_path: "/mDfJG3LC3Dqb67AZ52x3Z0jU0uB.jpg", media_type: "movie", vote_average: 8.3 },
        { id: 118340, title: "Guardiões da Galáxia", poster_path: "/uLtVbjvS1O7gXL8lUOwsFOH4man.jpg", media_type: "movie", vote_average: 7.9 }
    ],
    "35": [ // Comédia
        { id: 293660, title: "Deadpool", poster_path: "/3E53WEZJqP6oM84D89qJ4tLHiJD.jpg", media_type: "movie", vote_average: 7.6 },
        { id: 105, title: "De Volta para o Futuro", poster_path: "/fNOH9f1aA7XhizlUrsO0H89J47o.jpg", media_type: "movie", vote_average: 8.3 },
        { id: 18785, title: "Se Beber, Não Case!", poster_path: "/eshEkiG7NmU4ekA8CtpIdYiYufZ.jpg", media_type: "movie", vote_average: 7.3 }
    ],
    "27": [ // Terror e Suspense
        { id: 138843, title: "Invocação do Mal", poster_path: "/wT1MXkgjUq6yQhM6a2F0m3H9L7d.jpg", media_type: "movie", vote_average: 7.5 },
        { id: 346364, title: "It: A Coisa", poster_path: "/9E2y5Q7WlCVNEhP5GiVTjhEhx1o.jpg", media_type: "movie", vote_average: 7.2 },
        { id: 507089, title: "Five Nights at Freddy's", poster_path: "/j9mH1pr3IahtraTWxVEMANmPSGR.jpg", media_type: "movie", vote_average: 7.8 }
    ],
    "10751": [ // Família
        { id: 1022789, title: "Divertida Mente 2", poster_path: "/lWVwWRLqpS1OaNg7KT0ZecSW0PK.jpg", media_type: "movie", vote_average: 8.5 },
        { id: 502356, title: "Super Mario Bros. O Filme", poster_path: "/qNBAXBIQlnOThrVvA6mA2B5ggV6.jpg", media_type: "movie", vote_average: 7.8 }
    ]
};

export async function descobrirPorGenero(genreId, startPage = 1, maxPages = 3, lang = 'pt') {
    const tmdbLang = getTMDBLang(lang);
    const genreCacheKey = `genre_${genreId}_${tmdbLang}_${startPage}_${maxPages}_v6`;

    // 1. L1 Memory Cache (Mais rápido do que qualquer coisa)
    const genreCached = getCached(genreCacheKey);
    if (genreCached) return genreCached;

    // 2. L2 Redis Cache (Evita hits no TMDB durante Cold Starts)
    let redis = null;
    try {
        redis = await getRedisClient();
        if (redis) {
            const cached = await redis.get(genreCacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                setCached(genreCacheKey, data);
                return data;
            }
        }
    } catch (e) {
        console.error("Redis read error in descobrirPorGenero:", e);
    }

    let resultsArray = [];

    const fetchPage = async (page) => {
        const fetchType = async (type) => {
            try {
                const res = await fetchTMDB(`discover/${type}`, {
                    language: tmdbLang,
                    sort_by: 'popularity.desc',
                    with_genres: genreId,
                    page: page.toString()
                }, { timeout: 3000 });
                if (res && res.ok) {
                    const data = await res.json();
                    return (data.results || []).map(item => ({ ...item, media_type: type }));
                }
                return [];
            } catch (e) { 
                return []; 
            }
        };
        const [movies, tv] = await Promise.all([fetchType('movie'), fetchType('tv')]);
        return [...movies, ...tv];
    };

    try {
        // ESTRATÉGIA FRESHNESS: Se for a página 1 (Home), busca a página 1 e embaralha (Otimizado para evitar gargalo)
        if (startPage === 1) {
            const pages = await Promise.all([fetchPage(1)]);
            resultsArray = pages.flat().sort(() => Math.random() - 0.5);
        } else {
            resultsArray = (await Promise.all([fetchPage(startPage)])).flat();
        }
    } catch (e) {
        console.error(`[TMDB Genre Fetch Failure] erro ao consultar gênero ${genreId}:`, e);
    }

    // 3. Fallback Master (Pilar 2: À Prova de Falhas)
    if (resultsArray.length === 0) {
        console.warn(`⚠️ [Genre Fallback Activated] Categoria de gênero ${genreId} falhou ao carregar do TMDB. Iniciando rotas alternativas...`);
        
        const staticItems = STATIC_GENRE_FALLBACKS[genreId] || [];
        if (staticItems.length > 0) {
            console.log(`✅ [Fallback Success] Carregado catálogo estático premium para o gênero ${genreId}`);
            const data = { results: staticItems };
            setCached(genreCacheKey, data);
            return data;
        }
    }

    const result = { results: resultsArray };

    // 4. Salva os caches na memória e no Redis
    if (resultsArray.length > 0) {
        setCached(genreCacheKey, result);
        try {
            if (redis) {
                await redis.set(genreCacheKey, JSON.stringify(result), "EX", 600); // 10 minutos de TTL
            }
        } catch (e) {
            console.error("Redis write error in descobrirPorGenero:", e);
        }
    }

    return result;
}

export async function getTMDBDetails(id, type, lang = 'pt') {
    if (!id || !type) return null;
    const tmdbLang = getTMDBLang(lang);
    // v7: passou a incluir original_title/original_name. O KV guarda isto por 7 DIAS — sem o
    // bump, título já aquecido continuaria voltando sem esses campos e o slug canônico da rota
    // seguiria divergindo do sitemap por uma semana inteira.
    const cacheKey = `details_${type}_${id}_${tmdbLang}_v7`;
    const l1 = getCached(cacheKey);
    if (l1) return l1;

    // L2 (KV): evita reconsultar a TMDB do zero a cada isolate novo pra títulos já vistos
    // recentemente por outro isolate — o Map do L1 acima não é compartilhado entre eles.
    const l2 = await getKVCached(cacheKey);
    if (l2) {
        // TTL longo no L1: este dado fica 7 dias parado no KV, então expirá-lo da RAM em 5min
        // só comprava uma leitura de KV paga a cada 5min por título quente, sem ganhar frescor.
        setCached(cacheKey, l2, L1_TTL_L2_HIDRATADO_MS);
        return l2;
    }

    try {
        const res = await fetchTMDB(`${type}/${id}`, {
            language: tmdbLang,
            append_to_response: 'credits,videos,external_ids,images',
            include_video_language: `${tmdbLang},pt-BR,pt,en-US,en`,
            include_image_language: `${tmdbLang},null`
        }, { timeout: 12000 });

        if (!res || !res.ok) {
            // 404 real do TMDB = conteúdo não existe. Qualquer outro status
            // (429 rate-limit, 5xx, etc.) é falha transitória, não "não encontrado".
            if (res && res.status === 404) {
                const notFoundResult = { notFound: true };
                setCached(cacheKey, notFoundResult, 60 * 1000); // TTL curto: TMDB pode corrigir o id
                return notFoundResult;
            }
            throw new Error(`TMDB details request failed with status: ${res?.status}`);
        }
        const rawData = await res.json();
        
        // Verificação extra: Se não veio nenhum vídeo, tenta buscar especificamente os vídeos em inglês
        if (!rawData.videos?.results?.length) {
            try {
                const videoRes = await fetchTMDB(`${type}/${id}/videos`, {}, { timeout: 8000 });
                if (videoRes && videoRes.ok) {
                    const videoData = await videoRes.json();
                    if (videoData.results) {
                        rawData.videos = videoData;
                    }
                }
            } catch (ve) {}
        }

        const data = minifyDetails(rawData, type);

        if (data) {
            // Se o idioma original for pt e a sinopse vier vazia, busca em inglês para preencher a sinopse principal (Pilar 2)
            if (lang === 'pt' && !data.overview) {
                try {
                    console.log(`🔍 [TMDB Details] Sinopse em PT vazia para ${type} ${id}. Buscando fallback em EN...`);
                    const enData = await getTMDBDetails(id, type, 'en');
                    if (enData?.overview) {
                        data.overview = enData.overview;
                    }
                } catch (enErr) {
                    console.warn(`⚠️ [TMDB Details Fallback] Falha ao preencher sinopse em inglês para ${type} ${id}:`, enErr.message);
                }
            }
            setCached(cacheKey, data);
            setStaleCached(cacheKey, data);
            setKVCached(cacheKey, data);
            return data;
        } else {
            throw new Error("Minify details returned null");
        }
    } catch (e) {
        console.error(`[TMDB Details Fetch Failure] Error fetching ${type} ${id} (lang: ${lang}):`, e.message);
        if (lang !== 'en') {
            console.log(`[TMDB Details Fallback] Retrying with English (en-US) for ${type} ${id}...`);
            return getTMDBDetails(id, type, 'en');
        }
        // Falha transitória (timeout, rate-limit, 5xx, chave sumida) sem 404 real do TMDB:
        // serve o último dado bom conhecido em vez de derrubar a página em 404 pro Googlebot.
        const stale = getStaleCached(cacheKey);
        if (stale) {
            console.warn(`[TMDB Details Fallback] Servindo cache stale para ${type} ${id} após falha transitória.`);
            return stale;
        }
        return null;
    }
}

// Margem depois do último episódio a partir da qual a temporada é considerada encerrada.
// 21 dias cobre o caso de a TMDB só preencher still/sinopse de um episódio alguns dias
// depois da exibição, sem prender a temporada no TTL curto pra sempre.
const MARGEM_TEMPORADA_ENCERRADA_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * TTL de KV pra uma temporada. Encerrada -> longo (dado não muda mais); em exibição, sem
 * data de exibição conhecida, ou formato inesperado -> curto (o comportamento antigo).
 * Na dúvida devolve o TTL curto: errar pra frescor custa escrita, errar pro outro lado
 * esconde episódio novo do usuário.
 */
export function ttlDeTemporada(data) {
    const episodios = Array.isArray(data?.episodes) ? data.episodes : [];
    if (!episodios.length) return KV_TTL_SEASON_S;

    let ultimaExibicao = 0;
    for (const ep of episodios) {
        // Episódio sem data é episódio ainda não exibido (ou dado incompleto na TMDB):
        // a temporada não pode ser tratada como encerrada.
        if (!ep?.air_date) return KV_TTL_SEASON_S;
        const t = Date.parse(ep.air_date);
        if (Number.isNaN(t)) return KV_TTL_SEASON_S;
        if (t > ultimaExibicao) ultimaExibicao = t;
    }

    const encerrada = Date.now() - ultimaExibicao > MARGEM_TEMPORADA_ENCERRADA_MS;
    return encerrada ? KV_TTL_SEASON_ENCERRADA_S : KV_TTL_SEASON_S;
}

export async function getTMDBSeasonDetails(id, season, lang = 'pt') {
    if (!id || !season) return null;
    const tmdbLang = getTMDBLang(lang);
    const cacheKey = `season_${id}_${season}_${tmdbLang}`;
    const l1 = getCached(cacheKey);
    if (l1) return l1;

    const l2 = await getKVCached(cacheKey, KV_CACHE_TTL_TEMPORADA_S);
    if (l2) {
        // Não perde frescor: o dado de temporada já está limitado pelo TTL do KV (6h para
        // temporada em exibição), então segurar 30min na RAM não deixa nada mais velho do
        // que a própria fonte que ele espelha — só evita reler a mesma coisa.
        setCached(cacheKey, l2, L1_TTL_L2_HIDRATADO_MS);
        return l2;
    }

    try {
        const res = await fetchTMDB(`tv/${id}/season/${season}`, {
            language: tmdbLang
        }, { timeout: 15000 });

        if (!res || !res.ok) {
            // 404 é INFORMAÇÃO, não falha: o TMDB está dizendo que essa temporada não existe.
            // Antes isso era um throw igual a um timeout, e o chamador (episodioService) não
            // tinha como distinguir — então a página de episódio respondia 200 com lista vazia
            // e título "Episódio N" para temporada inexistente. Como o guard de params só
            // limita 1..200 por 1..20000, eram milhões de URLs de soft 404 por série.
            // Marcar aqui é o que permite responder 404 de verdade só no caso certo.
            if (res && res.status === 404) {
                const naoExiste = { notFound: true, episodes: [] };
                setCached(cacheKey, naoExiste, 60 * 1000); // TTL curto: o TMDB pode corrigir
                return naoExiste;
            }
            throw new Error(`TMDB season request failed with status: ${res?.status}`);
        }
        const rawData = await res.json();
        const data = minifySeason(rawData);

        if (data && data.episodes && data.episodes.length > 0) {
            // Se algum episódio não tiver sinopse (overview) ou nome válido, e o idioma for pt, tenta buscar em inglês para mesclar (Pilar 2)
            if (lang === 'pt' && data.episodes.some(ep => !ep.overview || !ep.name)) {
                try {
                    console.log(`🔍 [TMDB Season Details] Encontrados episódios sem sinopse/nome em pt para série ${id} temp ${season}. Buscando fallback em inglês...`);
                    const enData = await getTMDBSeasonDetails(id, season, 'en');
                    if (enData && enData.episodes) {
                        data.episodes = data.episodes.map(ep => {
                            const enEp = enData.episodes.find(e => e.episode_number === ep.episode_number);
                            return {
                                ...ep,
                                name: ep.name || enEp?.name || `Episódio ${ep.episode_number}`,
                                overview: ep.overview || enEp?.overview || ""
                            };
                        });
                    }
                } catch (enErr) {
                    console.warn(`⚠️ [TMDB Season Fallback] Falha ao mesclar sinopses de episódios em inglês para série ${id} temp ${season}:`, enErr.message);
                }
            }
            setCached(cacheKey, data);
            // TTL curto só pra temporada em exibição, que ganha episódio novo e não pode
            // esperar. Temporada encerrada é imutável e vai com TTL longo — com o TTL curto
            // aplicado a todas, cada chave era regravada 4x por dia sem mudar nada, e isso
            // dominava as KV Write Operations da conta (ver ttlDeTemporada acima).
            setKVCached(cacheKey, data, ttlDeTemporada(data));
            return data;
        } else {
            throw new Error("Season data is empty or invalid");
        }
    } catch (e) {
        console.error(`[TMDB Season Fetch Failure] Error fetching season ${season} of TV ${id} (lang: ${lang}):`, e.message);
        if (lang !== 'en') {
            console.log(`[TMDB Season Fallback] Retrying with English (en-US) for season ${season} of TV ${id}...`);
            return getTMDBSeasonDetails(id, season, 'en');
        }
        return null;
    }
}

export async function getTMDBRecommendations(id, type, lang = 'pt') {
    if (!id || !type) return { results: [] };
    const tmdbLang = getTMDBLang(lang);
    const cacheKey = `recommendations_${type}_${id}_${tmdbLang}`;
    const l1 = getCached(cacheKey);
    if (l1) return l1;

    const tmdbType = type === 'anime' ? 'tv' : type;

    try {
        const res = await fetchTMDB(`${tmdbType}/${id}/recommendations`, {
            language: tmdbLang,
            page: '1'
        }, { timeout: 10000 });
        const data = await res.json();
        const results = (data.results || []).slice(0, 15).map(item => ({
            id: item.id, title: item.title || item.name, poster_path: item.poster_path, media_type: item.media_type || tmdbType,
            vote_average: item.vote_average, release_date: item.release_date || item.first_air_date
        }));

        const responseData = { results };
        setCached(cacheKey, responseData);
        return responseData;
    } catch (e) { return { results: [] }; }
}
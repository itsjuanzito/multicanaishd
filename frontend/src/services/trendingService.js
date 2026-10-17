import { getSuperflixIds } from "./superflix-ids.js";
import { getRedisClient } from "./redis-client.js";
import { getEnv } from "./env-adapter.js";


// L1 Cache (Memória do Processo)
const memoryCache = new Map();
const MEMORY_TTL = 300 * 1000; // 5 minutos em memória local

const TRENDING_TTL = 3600; // 1 hora no Redis

const isDev = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') || false;
const TMDB_TIMEOUT = isDev ? 12000 : 5000;
// Teto somado de todas as tentativas — precisa caber com folga dentro do teto da home.
const TMDB_TOTAL_BUDGET = isDev ? 14000 : 6000;

/**
 * Função auxiliar para fetch com retry e timeout
 */
async function fetchWithRetry(url, apiKey, retries = 2) {
    // Orçamento TOTAL, não por tentativa. Antes, 2 tentativas de 5s + 400ms de espera
    // podiam somar 10,4s — acima do teto de 9s da home, que então renderizava sem dados.
    // Com o orçamento, a última tentativa encurta pra caber no que sobrou.
    const deadline = Date.now() + TMDB_TOTAL_BUDGET;

    for (let i = 0; i < retries; i++) {
        const restante = deadline - Date.now();
        if (restante <= 0) break;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Math.min(TMDB_TIMEOUT, restante));

        try {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
                signal: controller.signal
            });

            if (res.status === 404) return null;
            // O clearTimeout fica no finally, depois do res.json(): o abort é o único teto
            // que cobre a leitura do corpo (mesmo motivo do fetch-util.js).
            if (res.ok) return await res.json();

            // Esperar brevemente antes de tentar de novo
            if (i < retries - 1) await new Promise(r => setTimeout(r, 400));
        } catch (err) {
            if (i === retries - 1) throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
    return null;
}

export async function fetchTrending(type = 'all', timeWindow = 'week', lang = 'pt') {
    const tmdbLang = lang === 'en' ? 'en-US' : 'pt-BR';
    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    if (!apiKey) return [];

    const cacheKey = `trending_v6_${type}_${timeWindow}_${lang}`;
    const now = Date.now();

    // 1. Tentar L1 Cache (Memória)
    if (memoryCache.has(cacheKey)) {
        const entry = memoryCache.get(cacheKey);
        if (now - entry.time < MEMORY_TTL) {
            return entry.data;
        }
    }

    try {
        let redis = null;
        try {
            // 2. Tentar L2 Cache (Redis)
            redis = await getRedisClient();
            if (redis) {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const data = JSON.parse(cached);
                    memoryCache.set(cacheKey, { data, time: now });
                    return data;
                }
            }
        } catch (e) { }

        console.log(`⏳ [Trending] Cache MISS. Buscando TMDB para ${type}...`);

        const fetchTrendingPage = async (page) => {
            const tmdbUrl = `https://api.themoviedb.org/3/trending/${type === 'anime' ? 'tv' : type}/${timeWindow}?language=${tmdbLang}&page=${page}`;
            try {
                const data = await fetchWithRetry(tmdbUrl, apiKey);
                return data?.results || [];
            } catch (e) {
                console.error(`❌ Falha ao buscar página ${page} do trending:`, e.message);
                return [];
            }
        };

        const [resultsMatrix, idsDisponiveis] = await Promise.all([
            Promise.all([1, 2].map(page => fetchTrendingPage(page))),
            // §2.2: sem o catch, uma falha de getSuperflixIds() derruba o Promise.all inteiro,
            // cai no catch da linha 138 e devolve [] — ou seja, home sem hero e sem Top 10 por
            // causa de um filtro opcional. `idsDisponiveis || ...` logo abaixo já trata null.
            getSuperflixIds().catch(() => null)
        ]);

        const raw = resultsMatrix.flat();
        if (raw.length === 0) {
            return memoryCache.get(cacheKey)?.data || [];
        }

        const { movies, series, anime } = idsDisponiveis || { movies: new Set(), series: new Set(), anime: new Set() };
        const idsAvailable = movies.size + series.size + anime.size > 0;

        let filtered = raw;
        if (idsAvailable) {
            filtered = raw.filter(item => {
                const id = Number(item.id);
                const mType = item.media_type || (type === 'anime' ? 'tv' : type);
                if (mType === 'movie') return movies.has(id);
                if (mType === 'tv') return series.has(id) || anime.has(id);
                return false;
            }).map(item => {
                let finalType = item.media_type || (type === 'anime' ? 'tv' : type);
                if (finalType === 'tv' && anime.has(Number(item.id))) finalType = 'anime';
                return { ...item, media_type: finalType };
            });
        }

        const uniqueItems = Array.from(new Map(filtered.map(item => [item.id, item])).values()).slice(0, 20);

        if (uniqueItems.length > 0) {
            memoryCache.set(cacheKey, { data: uniqueItems, time: now });
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(uniqueItems), "EX", TRENDING_TTL);
            }
        }

        return uniqueItems;

    } catch (error) {
        console.error('🔥 Erro Crítico Trending Service:', error);
        return memoryCache.get(cacheKey)?.data || [];
    }
}

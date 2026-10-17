import { getSuperflixIds } from "./superflix-ids.js";
import { getRedisClient } from "./redis-client.js";
import { getEnv } from "./env-adapter.js";

const LIST_CACHE_TTL = 600; // 10 minutos

// Cache L1 em memória (Dura apenas o tempo de vida do Worker ou 5 minutos)
let l1Cache = {};
let l1Time = {};
let pendingRequests = {}; 

const STATIC_FALLBACKS = {
    animes: [
        { id: 60625, title: "Rick and Morty", poster_path: "/eqgIO0T6JtN71u5w9lQJj60D3c5.jpg", media_type: "tv", vote_average: 8.7 },
        { id: 95479, title: "Jujutsu Kaisen", poster_path: "/aI1fm7H2rhfRxnwWIdVACR3k1fO.jpg", media_type: "tv", vote_average: 8.6 },
        { id: 31911, title: "Fullmetal Alchemist: Brotherhood", poster_path: "/52AfXSvcg9J9e6u1T61Y1V1tGvU.jpg", media_type: "tv", vote_average: 8.7 },
        { id: 85937, title: "Demon Slayer", poster_path: "/xUfRZu2mi8jH6ZeQJPexvx7G7b3.jpg", media_type: "tv", vote_average: 8.6 },
    ],
    doramas: [
        { id: 93405, title: "Squid Game", poster_path: "/dDlE91J8M4ZlP9VpD5G1t9gL5pA.jpg", media_type: "tv", vote_average: 7.8 },
        { id: 99966, title: "All of Us Are Dead", poster_path: "/pB8BM7pdSpqUqThYQ1H4r145g1R.jpg", media_type: "tv", vote_average: 8.3 },
        { id: 135157, title: "Alchemy of Souls", poster_path: "/1ler3feLLg4QRxlIdaXTGIdWXr1.jpg", media_type: "tv", vote_average: 8.7 },
        { id: 136283, title: "The Glory", poster_path: "/iu5zBMCRKZECC78flUGd10tuQVT.jpg", media_type: "tv", vote_average: 8.4 },
    ]
};

export async function getContentList(category, lang = "pt") {
    const now = Date.now();
    const cacheKey = `api_cache_list_v6_${category}_${lang}`; // Cache v6 (Filtro relaxado)
    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');

    if (!apiKey) {
        console.error(`[Diagnostic] API Key faltante para categoria: ${category}`);
        const fallback = STATIC_FALLBACKS[category] || STATIC_FALLBACKS[category === 'anime' ? 'animes' : ''] || [];
        return { results: fallback };
    }

    // 1. L1 Cache (Memória RAM do Worker) - Instantâneo
    if (l1Cache[category] && (now - l1Time[category] < 300000)) {
        try {
            return JSON.parse(l1Cache[category]);
        } catch (e) {
            delete l1Cache[category];
        }
    }

    // 2. Singleton: Se já existe uma busca em curso para este mesmo pedido, reutiliza a promessa
    const requestKey = `${category}_${lang}`;
    if (pendingRequests[requestKey]) {
        return pendingRequests[requestKey];
    }

    pendingRequests[requestKey] = (async () => {
        try {
            let redis = null;
            try {
                redis = await getRedisClient();
                if (redis) {
                    const cached = await redis.get(cacheKey);
                    if (cached) {
                        l1Cache[category] = cached;
                        l1Time[category] = now;
                        return JSON.parse(cached);
                    }
                }
            } catch (e) {}

            const tmdbLang = lang === 'en' ? 'en-US' : 'pt-BR';
            const currentYear = new Date().getFullYear();
            const oneYearAgo = `${currentYear - 1}-01-01`;

            // 1. Definição da função de busca (Fetch)
            const fetchBatch = async (page) => {
                let url = "";
                if (category === 'animes' || category === 'anime') {
                    url = `https://api.themoviedb.org/3/discover/tv?language=${tmdbLang}&with_genres=16&with_original_language=ja&sort_by=popularity.desc&air_date.gte=${oneYearAgo}&page=${page}`;
                } else if (category === 'doramas') {
                    url = `https://api.themoviedb.org/3/discover/tv?language=${tmdbLang}&with_original_language=ko&sort_by=popularity.desc&air_date.gte=${oneYearAgo}&page=${page}`;
                } else {
                    url = `https://api.themoviedb.org/3/trending/all/week?language=${tmdbLang}&page=${page}`;
                }

                const headers = { 'Accept': 'application/json' };
                if (apiKey.length < 50) {
                    url += (url.includes('?') ? '&' : '?') + `api_key=${apiKey}`;
                } else {
                    headers['Authorization'] = `Bearer ${apiKey}`;
                }

                let res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) }).catch(() => null);
                if (!res || !res.ok) {
                    const backupUrl = url.split('&air_date.gte=')[0];
                    res = await fetch(backupUrl, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null);
                }

                if (res && res.ok) {
                    const data = await res.json();
                    return data.results || [];
                }
                return [];
            };

            // 2. [MASTER PARALLELIZATION] Busca tudo ao mesmo tempo para vencer o Cold Start (Pilar 4)
            const [idsResult, page1Result, page2Result] = await Promise.allSettled([
                getSuperflixIds().catch(() => ({ anime: new Set(), doramas: new Set() })),
                fetchBatch(1),
                fetchBatch(2)
            ]);

            const idsDisponiveis = idsResult.status === 'fulfilled' ? idsResult.value : { anime: new Set(), doramas: new Set() };
            const rawItems = [
                ...(page1Result.status === 'fulfilled' ? page1Result.value : []),
                ...(page2Result.status === 'fulfilled' ? page2Result.value : [])
            ];
            
            const idSet = (category === 'animes' || category === 'anime') ? idsDisponiveis?.anime : (category === 'doramas' ? idsDisponiveis?.doramas : new Set());
            
            let validResults = [];
            if (rawItems.length > 0) {
                // [FIX PRODUÇÃO] Não filtramos mais de forma destrutiva para a Home.
                validResults = rawItems.map(item => ({
                    id: item.id,
                    title: item.title || item.name,
                    poster_path: item.poster_path,
                    backdrop_path: item.backdrop_path,
                    media_type: item.media_type || 'tv',
                    vote_average: item.vote_average,
                    hasPlayer: idSet?.has(Number(item.id)) ?? true
                }));

                // Ordem DETERMINÍSTICA. Antes era `.sort(() => Math.random() - 0.5).slice(0, 16)`:
                // com TTL L1 de 5 min (linha 39), cada recrawl do Googlebot via um conjunto
                // DIFERENTE de 16 títulos na mesma URL — conteúdo instável, pior que duplicado,
                // porque nenhum sinal de relevância se acumula entre rastreamentos.
                // Prioriza quem tem player e, em seguida, a nota — estável e relevante.
                validResults = validResults
                    .sort((a, b) => (Number(b.hasPlayer) - Number(a.hasPlayer)) || ((b.vote_average || 0) - (a.vote_average || 0)))
                    .slice(0, 16);
            }

            if (validResults.length === 0) {
                console.warn(`⚠️ [Category Fallback Activated] Categoria ${category} falhou ou retornou resultados vazios do TMDB. Usando fallback estático.`);
                const fallback = STATIC_FALLBACKS[category] || STATIC_FALLBACKS[category === 'anime' ? 'animes' : ''] || [];
                return { results: fallback };
            }

            const finalData = { results: validResults };
            const finalString = JSON.stringify(finalData);

            try {
                if (redis) await redis.set(cacheKey, finalString, "EX", 300);
            } catch (e) {}
            l1Cache[category] = finalString;
            l1Time[category] = now;

            return finalData;
        } catch (error) {
            console.error(`Erro ao carregar lista de ${category}:`, error);
            const fallback = STATIC_FALLBACKS[category] || STATIC_FALLBACKS[category === 'anime' ? 'animes' : ''] || [];
            return { results: fallback };
        } finally {
            delete pendingRequests[requestKey];
        }
    })();

    return pendingRequests[requestKey];
}

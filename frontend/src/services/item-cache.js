import { getRedisClient } from "./redis-client.js";
import { getEnv } from "./env-adapter.js";

const l1Cache = new Map();
const ITEM_TTL = 3600 * 24; // 24 horas para detalhes de itens (raramente mudam)

/**
 * Busca detalhes de um item (TV ou Movie) com cache no Redis para performance extrema.
 */
export async function getCachedItemDetails(id, type = 'tv', lang = 'pt') {
    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    const cacheKey = `item_detail_v2_${type}_${id}_${lang}`;
    
    // 1. Tenta L1 Cache (Memória RAM do Node)
    const local = l1Cache.get(cacheKey);
    if (local && local.expires > Date.now()) return local.value;
    let redisClient = null;
    try {
        redisClient = await getRedisClient();
        if (redisClient) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                l1Cache.set(cacheKey, { value: data, expires: Date.now() + (30 * 60 * 1000) });
                return data;
            }
        }
    } catch (e) {
        console.warn(`⚠️ Erro ao ler cache para item ${id}:`, e.message);
    }

    // Se não tem no cache, busca no TMDB
    try {
        const tmdbLang = lang === 'en' ? 'en-US' : 'pt-BR';
        let url = `https://api.themoviedb.org/3/${type}/${id}?language=${tmdbLang}`;
        
        // Se for uma chave v3 curta, injeta na URL. Se for JWT, vai no header.
        const headers = { 'Accept': 'application/json' };
        if (apiKey.length < 50) {
            url += (url.includes('?') ? '&' : '?') + `api_key=${apiKey}`;
        } else {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });

        if (!res.ok) return null;
        const data = await res.json();

        const result = {
            id: data.id,
            title: data.name || data.title || data.original_name || data.original_title,
            poster_path: data.poster_path,
            backdrop_path: data.backdrop_path,
            media_type: type,
            vote_average: data.vote_average
        };

        // Salva nos caches
        l1Cache.set(cacheKey, { value: result, expires: Date.now() + (30 * 60 * 1000) });
        if (redisClient) {
            await redisClient.set(cacheKey, JSON.stringify(result), "EX", ITEM_TTL).catch(() => null);
        }

        return result;
    } catch (error) {
        console.error(`❌ Erro ao buscar item ${id} no TMDB:`, error.message);
        return null;
    }
}

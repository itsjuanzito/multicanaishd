import { fetchTrending } from "../../services/trendingService";
import { getRedisClient } from "../../services/redis-client";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all';
    const timeWindow = url.searchParams.get('time_window') || 'week';
    const lang = url.searchParams.get('lang') || 'pt';

    const cacheKey = `trending_api_v1_${type}_${timeWindow}_${lang}`;
    let redis = null;

    try {
        // Tentar Cache Redis
        redis = await getRedisClient();
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return new Response(cached, {
                        status: 200,
                        headers: { 
                            "Content-Type": "application/json", 
                            "X-Cache": "HIT",
                            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
                        }
                    });
                }
            } catch (re) {}
        }

        const results = await fetchTrending(type, timeWindow, lang);
        if (!results || results.length === 0) {
             return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        
        const responseData = JSON.stringify({ results });

        // Salvar Cache (1 hora) se disponível
        if (redis && results.length > 0) {
            try {
                await redis.set(cacheKey, responseData, "EX", 3600);
            } catch (se) {}
        }

        return new Response(responseData, {
            status: 200,
            headers: { 
                "Content-Type": "application/json", 
                "X-Cache": "MISS",
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
            }
        });

    } catch (error) {
        console.error('Erro Trending API:', error);
        return new Response(JSON.stringify({ results: [] }), { status: 500 });
    }
}

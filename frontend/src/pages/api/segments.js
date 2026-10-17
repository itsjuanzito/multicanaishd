// src/pages/api/segments.js
export const prerender = false;

// Cache L1 em memória para evitar requisições redundantes a recursos estáticos
// L1 memory cache to avoid redundant requests for static resources
if (!globalThis._bf_segments_cache) {
    globalThis._bf_segments_cache = new Map();
}
const cache = globalThis._bf_segments_cache;

export async function GET({ request }) {
    const url = new URL(request.url);
    const imdbId = url.searchParams.get('imdb_id');
    const season = url.searchParams.get('season') || '1';
    const episode = url.searchParams.get('episode') || '1';

    if (!imdbId) {
        return new Response(JSON.stringify({ error: 'Missing imdb_id' }), { status: 400 });
    }

    const cacheKey = `${imdbId}_s${season}_e${episode}`;
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*'
    };

    // Tentar L1 Cache
    // Try L1 Cache
    if (cache.has(cacheKey)) {
        console.log(`⚡ [Segments API] HIT L1 Cache: ${cacheKey}`);
        return new Response(cache.get(cacheKey), { status: 200, headers });
    }

    const targetUrl = `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`;
    let timeoutId;

    try {
        const controller = new AbortController();
        // Reduzido para 5s (SLA mais ágil)
        // Reduced to 5s (Faster SLA)
        timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'MultiCanaisHD/2.0',
                'Accept': 'application/json',
            },
            signal: controller.signal
        });

        if (!res.ok) {
            return new Response(null, { status: res.status });
        }

        // Ler como texto/JSON completo em vez de retornar ReadableStream direto (previne travamentos no worker)
        // Read as full text/JSON instead of returning direct ReadableStream (prevents worker hangs)
        const data = await res.text();
        
        // Armazena no cache L1 se a resposta for válida
        // Store in L1 cache if the response is valid
        if (data) {
            cache.set(cacheKey, data);
        }

        return new Response(data, { status: 200, headers });
    } catch (e) {
        console.error(`[Segments Proxy Error]: ${e.message || e.name}`);
        return new Response(JSON.stringify({ error: e.message || 'Timeout' }), { status: 500 });
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}


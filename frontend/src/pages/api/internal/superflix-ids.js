// src/pages/api/internal/superflix-ids.js
// Endpoint interno: roda dentro do Worker da Cloudflare (acesso real ao KV via locals.runtime.env),
// permitindo que o cron (GitHub Actions, ambiente Node sem KV) consuma o catálogo já em cache
// em vez de bater direto nos domínios do Superflix a cada execução.
import { getSuperflixIds } from "../../../services/superflix-ids.js";
import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";

export const prerender = false;

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const secret = getEnv('CRON_SECRET');
    const urlObj = new URL(request.url);
    const secretParam = urlObj.searchParams.get('secret');
    const authHeader = request.headers.get('authorization');

    if (!secret || (authHeader !== `Bearer ${secret}` && secretParam !== secret)) {
        return new Response('Não autorizado.', { status: 401 });
    }

    try {
        const ids = await getSuperflixIds();
        return new Response(JSON.stringify({
            movies: Array.from(ids.movies),
            series: Array.from(ids.series),
            anime: Array.from(ids.anime),
            doramas: Array.from(ids.doramas)
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

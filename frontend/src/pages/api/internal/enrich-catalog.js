// src/pages/api/internal/enrich-catalog.js
// Endpoint interno chamado periodicamente (GitHub Actions) pra enriquecer, aos poucos,
// o catálogo real do site (ver getSuperflixIds) com metadados TMDB — usado pelo sitemap.xml
// pra listar o catálogo inteiro, não só o que cruza com as listas "popular/top_rated".
import { enrichCatalogBatch } from "../../../services/catalogEnrichmentService.js";
import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { invalidarCacheSitemap } from "../../../services/sitemapService.js";

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
        const result = await enrichCatalogBatch({ batchSize: 80 });

        // Títulos novos não devem esperar até 6h (TTL do cache do sitemap) pra aparecer —
        // invalida o cache aqui pra próxima requisição ao sitemap.xml regenerar na hora.
        if (result.processed > 0) {
            await invalidarCacheSitemap();
        }

        return new Response(JSON.stringify({ success: true, ...result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

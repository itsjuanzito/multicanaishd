// src/pages/api/internal/warm-sitemap.js
// Invalida E regenera o cache do sitemap. Chamado pelo cron (`sitemap-warm`).
//
// Por que não basta bater em `/sitemap.xml`: com o cache quente, aquela rota responde do KV e
// NÃO renova o TTL (o `expirationTtl` só é reescrito quando há geração). O ciclo ficava assim:
// grava em T, o cron passa em T+5h (HIT, não renova), expira em T+6h, e o próximo cron só vem
// em T+10h — ou seja, até 4h de cache FRIA expostas, justamente para o Googlebot pagar a
// geração. Invalidação explícita aqui é o que faz o job cumprir o que promete.
import { invalidarCacheSitemap, obterTotalDeLotes } from "../../../services/sitemapService.js";
import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";

export const prerender = false;

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const secret = getEnv('CRON_SECRET');
    const urlObj = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const autorizado = secret && (authHeader === `Bearer ${secret}` || urlObj.searchParams.get('secret') === secret);

    if (!autorizado) {
        return new Response('Não autorizado.', { status: 401 });
    }

    try {
        await invalidarCacheSitemap(request.url);
        // Regenera na hora para o cache não ficar vazio esperando a próxima requisição —
        // o motivo de existir este endpoint é nenhum crawler pagar a geração.
        const { total, cache } = await obterTotalDeLotes({ url: request.url });

        return new Response(JSON.stringify({ success: true, total, cache }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' },
        });
    } catch (error) {
        console.error('[warm-sitemap] Falha ao regenerar o sitemap:', error?.message || error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

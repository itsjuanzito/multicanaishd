// src/pages/api/internal/dmca-watch.js
// Endpoint interno do cron (`dmca-watch`, a cada 10min): lê os 451 recentes da Analytics API
// do Cloudflare e rotaciona o slug das obras cujo canônico está bloqueado.
//
// Sempre 200: quem chama é o cron, e um 5xx aqui vira job "quebrado" no dispatcher sem
// nenhuma informação útil. Falha vai no corpo como `ok: false` + `motivo`.
import { executarDmcaWatch } from '../../../services/dmcaWatchService.js';
import { invalidarCacheSitemap } from '../../../services/sitemapService.js';
import { getEnv, setRuntimeEnv } from '../../../services/env-adapter.js';

export const prerender = false;

function responder(payload) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' },
    });
}

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
        const resultado = await executarDmcaWatch();

        // Slug novo tem que aparecer no sitemap: sem isto o sitemap continua anunciando a URL
        // antiga (que agora responde 301) até o TTL de 6h vencer. É o mesmo comportamento da
        // rotação manual em /api/admin/url-rotations.
        if (resultado?.rotacionados > 0) {
            try {
                await invalidarCacheSitemap(request.url);
            } catch (e) {
                // Falhar aqui não invalida a rotação, que já foi gravada.
                console.error('[dmca-watch] Falha ao invalidar o cache do sitemap:', e?.message || e);
            }
        }

        return responder(resultado);
    } catch (error) {
        // Safety net: `executarDmcaWatch` já não lança, mas o endpoint não pode devolver 5xx.
        console.error('[dmca-watch] Falha inesperada:', error?.message || error);
        return responder({
            ok: false,
            motivo: 'falha_endpoint',
            erro: String(error?.message || error),
        });
    }
}

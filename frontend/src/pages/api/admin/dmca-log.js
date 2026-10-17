// src/pages/api/admin/dmca-log.js
// Histórico do detector de 451 + estado do liga/desliga, para a seção "Detecção
// automática (451)" do /moderacao. Auth idêntica a /api/admin/config.js.
import { getEnv, setRuntimeEnv } from '../../../services/env-adapter.js';
import { getAllConfigs } from '../../../services/configService.js';
import { lerLogDmca, tokenAnalyticsConfigurado } from '../../../services/dmcaWatchService.js';

export const prerender = false;

const SEM_ENTRADAS = [];

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const token = new URL(request.url).searchParams.get('token');
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    try {
        // force: o painel precisa refletir o KV de verdade, não a cópia em RAM do isolate.
        const configs = await getAllConfigs({ force: true }).catch(() => ({}));
        const entradas = await lerLogDmca();
        return new Response(JSON.stringify({
            entradas,
            autoRotate: configs?.DMCA_AUTO_ROTATE === 'off' ? 'off' : 'on',
            // `configurado: false` = sem CLOUDFLARE_ANALYTICS_TOKEN no ambiente. O painel
            // mostra o aviso em vez de um log eternamente vazio.
            configurado: tokenAnalyticsConfigurado(),
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        console.error('[dmca-log] Falha ao ler o log:', error?.message || error);
        // Um painel que não carrega é pior que um painel vazio: devolve 200 sem entradas.
        return new Response(JSON.stringify({
            entradas: SEM_ENTRADAS,
            autoRotate: 'on',
            configurado: tokenAnalyticsConfigurado(),
            erro: String(error?.message || error),
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
    }
}

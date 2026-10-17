// src/pages/api/internal/check-status.js
// Endpoint interno chamado periodicamente (GitHub Actions) para forçar a checagem de status
// mesmo sem visitas humanas em /status — garante que os alertas do Discord disparem em tempo hábil.
import { checkSystemStatus } from "../../../services/statusService.js";
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
        const results = await checkSystemStatus(true);
        return new Response(JSON.stringify({ success: true, results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

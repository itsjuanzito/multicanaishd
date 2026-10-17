import { getEnv } from "../../../services/env-adapter.js";
import { getAllConfigs, setConfig } from "../../../services/configService.js";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        // force: o painel tem que refletir o KV de verdade, não a cópia em RAM do isolate.
        // Sem isto, com o TTL de 60s, salvar um toggle e recarregar podia cair num isolate
        // com cache velho e mostrar o valor antigo, parecendo que a gravação falhou.
        const configs = await getAllConfigs({ force: true });
        return new Response(JSON.stringify({ configs }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

export async function POST({ request }) {
    try {
        const body = await request.json();
        const { token, key, value } = body;
        const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        if (!key || value === undefined) {
            return new Response(JSON.stringify({ error: "Missing key or value" }), { status: 400 });
        }

        const result = await setConfig(key, value);

        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: result.message || "Failed to update config" }), { status: 500 });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

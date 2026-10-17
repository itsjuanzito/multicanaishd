import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { supabaseAdmin } from "../../../services/supabase";
import { fetchVipChannels } from "../../../services/channelsService.js";
import { axiomService } from "../../../services/axiom-service.js";

export const prerender = false;

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const { data: vipChannels, error } = await supabaseAdmin
            .from('vip_channels')
            .select('channel_id');

        if (error) throw error;

        return new Response(JSON.stringify({ vipChannels: vipChannels.map(c => c.channel_id) }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[Admin API] Fetch VIP channels error:", error);
        axiomService.logError(error, { rota: "/api/admin/channels-admin", method: "GET" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    try {
        const body = await request.json();
        const { channelId, action, token } = body;
        const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        if (!channelId || !action) {
            return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
        }

        if (action === 'activate') {
            const { error } = await supabaseAdmin
                .from('vip_channels')
                .upsert({ channel_id: channelId });
            if (error) throw error;
        } else if (action === 'remove') {
            const { error } = await supabaseAdmin
                .from('vip_channels')
                .delete()
                .eq('channel_id', channelId);
            if (error) throw error;
        }

        // Força refresh imediato do cache na memória local do servidor
        try {
            await fetchVipChannels(true);
        } catch (cacheErr) {
            console.warn("[Admin API] Falha ao invalidar cache VIP na memoria:", cacheErr);
        }
 
        return new Response(JSON.stringify({ success: true, action }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[Admin API] Update channel VIP status error:", error);
        axiomService.logError(error, { rota: "/api/admin/channels-admin", method: "POST" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

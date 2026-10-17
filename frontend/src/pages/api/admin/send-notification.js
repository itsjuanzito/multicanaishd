import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { supabaseAdmin } from "../../../services/supabase";

export const prerender = false;

function invalidateNotificationsCache() {
    if (globalThis._bf_notifications_cache) {
        globalThis._bf_notifications_cache.lastFetch = 0;
    }
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return new Response(JSON.stringify({ error: "Corpo da requisição inválido" }), { status: 400 });
    }

    const title = (body?.title || "").trim();
    const message = (body?.message || "").trim();
    const link = (body?.link || "").trim() || null;

    if (!title || title.length > 100) {
        return new Response(JSON.stringify({ error: "Título obrigatório (máx. 100 caracteres)" }), { status: 400 });
    }
    if (!message || message.length > 500) {
        return new Response(JSON.stringify({ error: "Mensagem obrigatória (máx. 500 caracteres)" }), { status: 400 });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('site_notifications')
            .insert({ title, message, link })
            .select()
            .single();

        if (error) {
            console.error("❌ [Admin] Erro ao criar notificação:", error);
            return new Response(JSON.stringify({ error: "Erro ao salvar notificação" }), { status: 500 });
        }

        invalidateNotificationsCache();
        return new Response(JSON.stringify({ success: true, notification: data }), { status: 200 });
    } catch (e) {
        console.error("❌ [Admin] Erro inesperado ao criar notificação:", e);
        return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
    }
}

export async function DELETE({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const id = url.searchParams.get("id");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (!id) {
        return new Response(JSON.stringify({ error: "ID obrigatório" }), { status: 400 });
    }

    try {
        const { error } = await supabaseAdmin
            .from('site_notifications')
            .delete()
            .eq('id', id);

        if (error) {
            console.error("❌ [Admin] Erro ao apagar notificação:", error);
            return new Response(JSON.stringify({ error: "Erro ao apagar notificação" }), { status: 500 });
        }

        invalidateNotificationsCache();
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (e) {
        console.error("❌ [Admin] Erro inesperado ao apagar notificação:", e);
        return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
    }
}

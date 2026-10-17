import { setRuntimeEnv } from "../../services/env-adapter.js";
import { getSupabase } from "../../services/supabase.js";

export const prerender = false;

const CACHE_TTL = 30000; // 30 segundos

if (!globalThis._bf_notifications_cache) {
    globalThis._bf_notifications_cache = { data: null, lastFetch: 0 };
}
const cache = globalThis._bf_notifications_cache;

export async function GET({ locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const now = Date.now();
    if (cache.data && (now - cache.lastFetch < CACHE_TTL)) {
        return new Response(JSON.stringify({ notifications: cache.data }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                // Resposta idêntica pra todo mundo (não é por usuário) — deixa a borda da
                // Cloudflare responder repetições dentro da janela sem acordar o Worker.
                "Cache-Control": "public, max-age=30"
            }
        });
    }

    try {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from('site_notifications')
            .select('id, title, message, link, created_at')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error("❌ [Notifications] Erro ao buscar notificações:", error);
            return new Response(JSON.stringify({ notifications: cache.data || [] }), { status: 200 });
        }

        cache.data = data || [];
        cache.lastFetch = now;

        return new Response(JSON.stringify({ notifications: cache.data }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                // Resposta idêntica pra todo mundo (não é por usuário) — deixa a borda da
                // Cloudflare responder repetições dentro da janela sem acordar o Worker.
                "Cache-Control": "public, max-age=30"
            }
        });
    } catch (e) {
        console.error("❌ [Notifications] Erro inesperado:", e);
        return new Response(JSON.stringify({ notifications: cache.data || [] }), { status: 200 });
    }
}

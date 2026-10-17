// src/pages/api/auth/check-nickname.js
import { supabaseAdmin } from "../../../services/supabase";
import { setRuntimeEnv } from "../../../services/env-adapter.js";

export const prerender = false;

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    try {
        const url = new URL(request.url);
        const nickname = url.searchParams.get("nickname") || "";
        const excludeUserId = url.searchParams.get("excludeUserId") || "";

        // 1. Sanitização Proativa
        const sanitized = nickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

        if (sanitized.length < 3 || sanitized.length > 20) {
            return new Response(JSON.stringify({ 
                success: false, 
                available: false, 
                error: "O nickname deve ter entre 3 e 20 caracteres e conter apenas letras, números e sublinhados (_)." 
            }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        // 2. Consulta de unicidade utilizando a chave JSON _nickname
        let query = supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("watched_episodes->>_nickname", sanitized);

        if (excludeUserId) {
            query = query.neq("id", excludeUserId);
        }

        const { data, error } = await query;

        if (error) {
            console.error("❌ [Check Nickname API] Erro ao consultar banco:", error.message);
            throw error;
        }

        const isAvailable = !data || data.length === 0;

        return new Response(JSON.stringify({
            success: true,
            available: isAvailable,
            nickname: sanitized
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        });

    } catch (err) {
        console.error("❌ [Check Nickname API] Erro:", err.message);
        return new Response(JSON.stringify({ success: false, available: false, error: err.message }), { status: 500 });
    }
}

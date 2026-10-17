// src/pages/api/watch/heartbeat.js
import { supabaseAdmin, supabase } from "../../../services/supabase";

export const prerender = false;

// Intervalo mínimo (50s) e teto por ping são aplicados dentro da RPC increment_watch_time
// (migrations/ranking_watch_time_protection.sql) — aqui não há estado para checar isso.

export async function POST({ request }) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const token = authHeader.split(" ")[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });

        // Chamada atômica via RPC para evitar condições de corrida (Pilar 2)
        const { data, error } = await supabaseAdmin.rpc('increment_watch_time', {
            p_user_id: user.id,
            p_seconds: 60
        });

        if (error) throw error;

        return new Response(JSON.stringify({ 
            success: true, 
            activeSeconds: data
        }), { 
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        });

    } catch (error) {
        console.error("❌ [Watch Heartbeat API] Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// src/pages/api/heartbeat.js
import { supabaseAdmin } from "../../services/supabase";

export const prerender = false;

// Sessões antigas (Service Worker/PWA de antes do deploy que removeu o SW, ver kill-switch
// em BaseLayout.astro) ainda chamam esse endpoint com GET/OPTIONS em vez de POST — sem esses
// handlers, isso vira 404 permanentemente até o cliente renovar sozinho. Só engolimos a
// chamada sem fazer nada (não há presença real pra registrar sem o body de POST).
export async function GET() {
    return new Response(null, { status: 204 });
}

export async function OPTIONS() {
    return new Response(null, { status: 204 });
}

export async function POST({ request }) {
    try {
        const body = await request.json();
        const { sessionId, path, userId } = body;

        if (!sessionId) {
            return new Response(JSON.stringify({ error: "Missing sessionId" }), { status: 400 });
        }

        const lastSeen = new Date().toISOString();
        const record = { session_id: sessionId, last_seen: lastSeen };
        if (path) record.current_path = path;
        if (userId) record.user_id = userId;

        // Tolera a migration de current_path/user_id ainda não ter sido aplicada — se o
        // upsert completo falhar por coluna inexistente, cai pro upsert mínimo original.
        let { error } = await supabaseAdmin
            .from('online_presence')
            .upsert(record, { onConflict: 'session_id' });

        if (error) {
            ({ error } = await supabaseAdmin
                .from('online_presence')
                .upsert({ session_id: sessionId, last_seen: lastSeen }, { onConflict: 'session_id' }));
        }

        if (error) throw error;

        // Cleanup: Remove sessions inactive for more than 1 hour (Optional, to keep DB lean)
        // Note: In a high-traffic site, this cleanup should be a separate cron job
        // but for now, we'll keep it simple.

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        // Silent error to not disrupt user experience
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

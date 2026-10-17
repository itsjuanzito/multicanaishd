import { getEnv } from "../../../services/env-adapter.js";
import { fetchCanais } from "../../../services/channelsService";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const channels = await fetchCanais();
        return new Response(JSON.stringify({ channels }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[Admin API] Proxy Channels error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

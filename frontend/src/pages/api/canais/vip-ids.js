// src/pages/api/canais/vip-ids.js
import { fetchVipChannels } from "../../../services/channelsService.js";

export const prerender = false;

export async function GET() {
    try {
        const vipIds = await fetchVipChannels();
        return new Response(JSON.stringify(vipIds), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300'
            }
        });
    } catch (e) {
        return new Response(JSON.stringify([]), { status: 500 });
    }
}

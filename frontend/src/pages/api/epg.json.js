import { fetchCanais, getNowPlayingBulk } from "../../services/channelsService.js";
import { setRuntimeEnv } from "../../services/env-adapter.js";

export const prerender = false;

export async function GET(context) {
    if (context?.locals?.runtime?.env) {
        setRuntimeEnv(context.locals.runtime.env);
    }

    try {
        const requestUrl = new URL(context.request.url);
        const idsParam = requestUrl.searchParams.get("ids");

        let channelIds;
        if (idsParam) {
            channelIds = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
        } else {
            const canais = await fetchCanais();
            channelIds = canais.map((c) => c.id);
        }

        const nowPlaying = await getNowPlayingBulk(channelIds);

        return new Response(JSON.stringify(nowPlaying), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
            },
        });
    } catch (e) {
        console.error("Erro no endpoint /api/epg.json:", e);
        return new Response(JSON.stringify({
            error: "Falha ao buscar programação",
            message: e.message,
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}

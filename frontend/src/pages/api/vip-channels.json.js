import { fetchVipChannels } from "../../services/channelsService.js";
import { setRuntimeEnv } from "../../services/env-adapter.js";

export const prerender = false;

export async function GET(context) {
    if (context?.locals?.runtime?.env) {
        setRuntimeEnv(context.locals.runtime.env);
    }
    try {
        const vipChannels = await fetchVipChannels();
        return new Response(JSON.stringify(vipChannels || []), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=60",
                "Access-Control-Allow-Origin": "*"
            }
        });
    } catch (e) {
        return new Response(JSON.stringify([]), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
}

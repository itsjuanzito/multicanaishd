import { setRuntimeEnv } from "../../services/env-adapter.js";
import { axiomService } from "../../services/axiom-service.js";

export const prerender = false;

const VALID_TRIGGERS = ["action", "button", "link"];

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    try {
        const body = await request.json().catch(() => ({}));
        const trigger = VALID_TRIGGERS.includes(body?.trigger) ? body.trigger : "unknown";
        const path = typeof body?.path === "string" ? body.path.slice(0, 300) : "";

        const p = axiomService.ingest({
            _time: new Date().toISOString(),
            type: "smartlink_open",
            trigger,
            path,
            platform: "multicanaishd-web"
        });

        if (locals?.runtime?.waitUntil) {
            locals.runtime.waitUntil(p);
        } else {
            p.catch(() => {});
        }
    } catch (e) {
        // Silencioso: telemetria nunca pode quebrar a navegação do usuário.
    }

    return new Response(null, { status: 204 });
}

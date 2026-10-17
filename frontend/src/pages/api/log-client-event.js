// src/pages/api/log-client-event.js
import { axiomService } from "../../services/axiom-service.js";

export const prerender = false;

// Endpoint de telemetria mínima para eventos do navegador (ex.: fallback lento do player)
// que nunca chegariam ao Axiom via logs de servidor.
export async function POST({ request }) {
    try {
        const body = await request.json();
        const { type, channelId, stage, durationMs, domain } = body || {};
        if (!type) return new Response(null, { status: 204 });

        await axiomService.ingest({
            _time: new Date().toISOString(),
            type,
            channelId: channelId ? String(channelId).slice(0, 100) : undefined,
            stage: stage ? String(stage).slice(0, 50) : undefined,
            durationMs: typeof durationMs === "number" ? durationMs : undefined,
            domain: domain ? String(domain).slice(0, 100) : undefined,
            platform: "multicanaishd-web-client"
        });
    } catch (e) {
        console.error("[LogClientEvent] Erro ao registrar evento:", e.message);
    }

    return new Response(null, { status: 204 });
}

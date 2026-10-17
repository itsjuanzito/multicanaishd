import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { axiomService } from "../../../services/axiom-service.js";
import { checkSystemStatus } from "../../../services/statusService.js";

export const prerender = false;

async function fetchRecentErrors(dataset) {
    try {
        const result = await axiomService.query(
            `['${dataset}'] | where type == 'error' | order by _time desc | limit 30`
        );
        const table = result?.tables?.[0];
        if (!table) return [];
        return Array.from(table.events());
    } catch (e) {
        console.error("[Monitoring Stats API] Falha ao buscar erros recentes:", e.message);
        return [];
    }
}

async function fetchRecentRequests(dataset) {
    try {
        const result = await axiomService.query(
            `['${dataset}'] | where type == 'http_request' | order by _time desc | limit 50`
        );
        const table = result?.tables?.[0];
        if (!table) return [];
        return Array.from(table.events());
    } catch (e) {
        console.error("[Monitoring Stats API] Falha ao buscar requests recentes:", e.message);
        return [];
    }
}

async function fetchServerErrorCount(dataset) {
    try {
        const result = await axiomService.query(
            `['${dataset}'] | where type == 'http_request' and status >= 500 and _time > ago(1h) | count`
        );
        const table = result?.tables?.[0];
        const row = table ? Array.from(table.events())[0] : null;
        return row?.count ?? 0;
    } catch (e) {
        console.error("[Monitoring Stats API] Falha ao contar erros 5xx:", e.message);
        return 0;
    }
}

async function fetchInfraHealth() {
    try {
        return await checkSystemStatus(false);
    } catch (e) {
        console.error("[Monitoring Stats API] Falha ao checar saúde de infraestrutura:", e.message);
        return null;
    }
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const redis = await import("../../../services/redis-client.js").then(m => m.getRedisClient());
        const CACHE_KEY = "admin:monitoring-stats:v1";

        const nocache = url.searchParams.get("nocache") === "true";
        if (redis && !nocache) {
            const cached = await redis.get(CACHE_KEY);
            if (cached) {
                return new Response(cached, {
                    status: 200,
                    headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
                });
            }
        }

        const dataset = getEnv('AXIOM_DATASET', 'multicanaishd');

        const [health, recentErrors, recentRequests, serverErrorCount5xx] = await Promise.all([
            fetchInfraHealth(),
            fetchRecentErrors(dataset),
            fetchRecentRequests(dataset),
            fetchServerErrorCount(dataset)
        ]);

        const monitoringData = {
            health,
            recentErrors,
            recentRequests,
            serverErrorCount5xx,
            generatedAt: new Date().toISOString()
        };

        const responseBody = JSON.stringify(monitoringData);

        if (redis) {
            await redis.set(CACHE_KEY, responseBody, "EX", 60);
        }

        return new Response(responseBody, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "MISS" }
        });
    } catch (error) {
        console.error("[Monitoring Stats API] Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

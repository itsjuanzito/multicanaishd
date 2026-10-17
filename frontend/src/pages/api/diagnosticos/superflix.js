import { getConfig } from "../../../services/configService.js";
import { getSuperflixIds } from "../../../services/superflix-ids.js";

export const prerender = false;

if (!globalThis._bf_superflix_diagnostic_cache) {
    globalThis._bf_superflix_diagnostic_cache = {
        timestamp: 0,
        data: null,
    };
}

const diagnosticCache = globalThis._bf_superflix_diagnostic_cache;
const DIAGNOSTIC_TTL = 1000 * 60 * 5;

export async function GET({ url }) {
    const forceLiveCheck = url?.searchParams?.get("live") === "1";

    try {
        if (!forceLiveCheck) {
            const now = Date.now();
            if (diagnosticCache.data && now - diagnosticCache.timestamp < DIAGNOSTIC_TTL) {
                return json(diagnosticCache.data, 200, "public, max-age=60, s-maxage=300");
            }

            const ids = await getSuperflixIds();
            const counts = {
                movies: ids?.movies?.size || 0,
                series: ids?.series?.size || 0,
                anime: ids?.anime?.size || 0,
                doramas: ids?.doramas?.size || 0,
            };
            const total = counts.movies + counts.series + counts.anime + counts.doramas;

            diagnosticCache.data = {
                status: total > 0 ? "ok" : "warming",
                source: "cache",
                message: total > 0
                    ? "Cache interno do Superflix possui IDs disponiveis."
                    : "Cache interno ainda aquecendo; esta rota nao consulta o Superflix diretamente para evitar rate limit.",
                counts,
                total,
            };
            diagnosticCache.timestamp = now;

            return json(diagnosticCache.data, 200, "public, max-age=60, s-maxage=300");
        }

        const baseDomain = await getConfig("SOURCE_S1_URL", "https://superflixapi.online");
        const res = await fetch(`${baseDomain}/lista?category=movie&format=json&type=tmdb`, {
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            throw new Error(`Superflix retornou status ${res.status}`);
        }

        return json({
            status: "ok",
            source: "live",
            message: "Superflix API esta enviando IDs.",
        }, 200, "no-store");
    } catch (e) {
        return json({
            status: "error",
            source: forceLiveCheck ? "live" : "cache",
            reason: e.message,
        }, forceLiveCheck ? 503 : 200, forceLiveCheck ? "no-store" : "public, max-age=60, s-maxage=300");
    }
}

function json(payload, status, cacheControl) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": cacheControl,
        },
    });
}

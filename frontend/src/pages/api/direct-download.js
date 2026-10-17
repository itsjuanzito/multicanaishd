// src/pages/api/direct-download.js
import { getDirectDownloadForMovie, getDirectDownloadForEpisode } from "../../services/directDownloadService.js";
import { setRuntimeEnv } from "../../services/env-adapter.js";
import { axiomService } from "../../services/axiom-service.js";

export const prerender = false;

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    try {
        const url = new URL(request.url);
        const tmdbId = url.searchParams.get("tmdb_id");
        const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
        const season = url.searchParams.get("season");
        const episode = url.searchParams.get("episode");

        if (!tmdbId) {
            return new Response(JSON.stringify({ found: false }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const result = type === "tv"
            ? await getDirectDownloadForEpisode(tmdbId, season, episode)
            : await getDirectDownloadForMovie(tmdbId);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        axiomService.logError(error, { servico: "direct-download-api", etapa: "get" }).catch(() => {});
        return new Response(JSON.stringify({ found: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
}

import { fetchRecents, parseRecentsParams, respostaFalhaRecents, headersRecents } from "../../../services/recentsService.js";

export const prerender = false;

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const params = parseRecentsParams(url);
        const result = await fetchRecents("movies", params);

        return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: headersRecents(result, params),
        });
    } catch (error) {
        return respostaFalhaRecents(error, "/api/recents/movies");
    }
}


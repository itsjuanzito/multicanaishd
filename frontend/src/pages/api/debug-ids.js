import { getSuperflixIds } from "../../services/superflix-ids";

export const prerender = false;

export async function GET() {
    try {
        const ids = await getSuperflixIds();
        return new Response(JSON.stringify({
            status: 'ok',
            movies_count: ids.movies.size,
            series_count: ids.series.size,
            anime_count: ids.anime.size,
            doramas_count: ids.doramas.size,
            // Retorna os primeiros 5 IDs de cada para ver se estão corretos
            sample_movies: Array.from(ids.movies).slice(0, 5),
            sample_series: Array.from(ids.series).slice(0, 5),
            sample_anime: Array.from(ids.anime).slice(0, 5)
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', reason: e.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

import { buscarNoTMDB } from "../../services/tmdb";
import { getSuperflixIds } from "../../services/superflix-ids";
import { isKidsRequest, ehItemInfantil, headersSemCacheInfantil } from "../../services/kidsProfile.js";
import { reforcarComClassificacao } from "../../services/contentRating.js";

export async function GET({ url, request }) {
    const kids = isKidsRequest(request);
    const query = url.searchParams.get('q');
    const lang = url.searchParams.get('lang') || 'pt';
    const isPt = lang === 'pt';
    
    if (!query || query.length < 2) {
        return new Response(JSON.stringify([]), { status: 200 });
    }

    try {
        const [tmdbResults, idsDisponiveis] = await Promise.all([
            buscarNoTMDB(query, lang),
            getSuperflixIds(),
        ]);

        if (!tmdbResults || !tmdbResults.results || !idsDisponiveis) {
            return new Response(JSON.stringify([]), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { movies, series, anime, doramas } = idsDisponiveis;
        const idsAvailable = movies.size + series.size + anime.size + (doramas?.size || 0) > 0;

        const filtradosPorGenero = tmdbResults.results.filter(item => {
            if (item.media_type === 'person') return false;
            if (kids && !ehItemInfantil(item)) return false;
            if (!idsAvailable) return item.media_type === 'movie' || item.media_type === 'tv';
            const contentId = Number(item.id);
            if (item.media_type === 'movie') return movies.has(contentId);
            if (item.media_type === 'tv') return series.has(contentId) || anime.has(contentId) || doramas.has(contentId);
            return false;
        });

        const filtradosFinal = kids
            ? await reforcarComClassificacao(filtradosPorGenero)
            : filtradosPorGenero;

        const tmdbItems = filtradosFinal
            .map(item => {
                const title = item.title || item.name;
                const date = item.release_date || item.first_air_date || "";
                const year = date ? date.split("-")[0] : "";
                
                let category = item.media_type;
                if (item.media_type === 'tv' && anime.has(Number(item.id))) category = 'anime';
                
                return {
                    id: item.id,
                    title: title,
                    year: year,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : null,
                    type: category === 'movie' ? (isPt ? 'Filme' : 'Movie') : (category === 'anime' ? 'Anime' : (isPt ? 'Série' : 'Series')),
                    linkType: item.media_type === 'movie' ? 'movie' : 'tv'
                };
            });

        const results = tmdbItems.slice(0, 8);

        const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600'
        };

        return new Response(JSON.stringify(results), {
            status: 200,
            headers: kids ? headersSemCacheInfantil(headers) : headers
        });

    } catch (error) {
        console.error('❌ Quick Search API Error:', error);
        return new Response(JSON.stringify([]), { status: 500 });
    }
}

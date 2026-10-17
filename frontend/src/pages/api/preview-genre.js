import { descobrirPorGenero } from "../../services/tmdb";
import { getSuperflixIds } from "../../services/superflix-ids";
import { getRedisClient } from "../../services/redis-client";
import { isKidsRequest, ehGeneroInfantil, filtrarItensInfantis } from "../../services/kidsProfile.js";
import { reforcarComClassificacao } from "../../services/contentRating.js";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const genreId = url.searchParams.get('id');
    const lang = url.searchParams.get('lang') || 'pt';

    if (!genreId) return new Response(JSON.stringify({ results: [] }), { status: 400 });

    // No perfil infantil um gênero não liberado devolve lista vazia em vez de conteúdo:
    // a fileira some sozinha, e nenhuma URL montada à mão fura o filtro.
    const kids = isKidsRequest(request);
    if (kids && !ehGeneroInfantil(genreId)) {
        return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" }
        });
    }

    // O sufixo separa as duas versões: sem ele a resposta podada de um gênero infantil
    // sobrescreveria no Redis a versão completa vista por todo mundo.
    const cacheKey = `preview_genre_v1_${genreId}_${lang}${kids ? '_kids' : ''}`;
    let redis = null;

    try {
        redis = await getRedisClient();
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return new Response(cached, {
                        status: 200,
                        headers: { 
                        "Content-Type": "application/json", 
                        "X-Cache": "HIT",
                        "Cache-Control": kids ? "private, no-store" : "public, s-maxage=3600, stale-while-revalidate=86400"
                    }
                    });
                }
            } catch (re) {}
        }

        const [tmdbData, idsDisponiveis] = await Promise.all([
            descobrirPorGenero(genreId, 1, 4, lang), 
            getSuperflixIds()
        ]);

        const bruto = tmdbData?.results || [];
        const raw = kids ? await reforcarComClassificacao(filtrarItensInfantis(bruto)) : bruto;

        if (!idsDisponiveis || (idsDisponiveis.movies.size === 0 && idsDisponiveis.series.size === 0)) {
            const fallbackResults = raw.slice(0, 15).map(minifyItem);
            return new Response(JSON.stringify({ results: fallbackResults }), {
                status: 200, headers: { "Content-Type": "application/json", "X-Fallback": "true" }
            });
        }

        const { movies, series, anime, doramas } = idsDisponiveis;
        
        const filtered = raw.filter(item => {
            const id = Number(item.id);
            return movies.has(id) || series.has(id) || anime.has(id) || (doramas && doramas.has(id));
        }).map(minifyItem);

        const finalResults = filtered.length > 0 ? filtered.slice(0, 20) : raw.slice(0, 6).map(minifyItem);
        const responseData = JSON.stringify({ results: finalResults });

        if (redis && finalResults.length > 0) {
            try {
                await redis.set(cacheKey, responseData, "EX", 3600);
            } catch (se) {}
        }

        return new Response(responseData, {
            status: 200, headers: {
                "Content-Type": "application/json",
                "X-Cache": "MISS",
                "Cache-Control": kids ? "private, no-store" : "public, s-maxage=3600, stale-while-revalidate=86400"
            }
        });

    } catch (error) {
        console.error("Preview Genre Error:", error);
        return new Response(JSON.stringify({ results: [] }), { status: 500 });
    }
}

// Função auxiliar para remover dados pesados que não são usados em prévias (CARDS)
function minifyItem(item) {
    return {
        id: item.id,
        title: item.title || item.name,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        vote_average: item.vote_average,
        release_date: item.release_date || item.first_air_date,
        media_type: item.media_type || (item.title ? 'movie' : 'tv')
    };
}
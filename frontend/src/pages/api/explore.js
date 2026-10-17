// src/pages/api/explore.js
import { getSuperflixIds } from "../../services/superflix-ids";
import { getEnv } from "../../services/env-adapter.js";
import { isKidsRequest, filtrarItensInfantis, KIDS_DISCOVER_GENRES, headersSemCacheInfantil } from "../../services/kidsProfile.js";
import { reforcarComClassificacao } from "../../services/contentRating.js";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const kids = isKidsRequest(request);
    const type = url.searchParams.get('type') || 'all'; // movie, tv, all
    const genreId = url.searchParams.get('genreId');
    const year = url.searchParams.get('year');
    const rating = url.searchParams.get('rating');
    const page = parseInt(url.searchParams.get('page') || '1');
    const lang = url.searchParams.get('lang') || 'pt';

    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    if (!apiKey) return new Response(JSON.stringify([]), { status: 500 });

    try {
        const fetchType = async (mType, pageNum = page) => {
            const tmdbUrl = new URL(`https://api.themoviedb.org/3/discover/${mType}`);
            const tmdbLang = lang === 'en' ? 'en-US' : 'pt-BR';
            tmdbUrl.searchParams.set('language', tmdbLang);
            tmdbUrl.searchParams.set('sort_by', 'popularity.desc');
            tmdbUrl.searchParams.set('page', pageNum.toString());
            tmdbUrl.searchParams.set('include_adult', 'false');

            if (type === 'anime') {
                tmdbUrl.searchParams.set('with_original_language', 'ja');
                tmdbUrl.searchParams.set('with_genres', genreId ? `16,${genreId}` : '16');
            } else if (type === 'dorama') {
                tmdbUrl.searchParams.set('with_original_language', 'ko');
                if (genreId) tmdbUrl.searchParams.set('with_genres', genreId);
            } else if (genreId) {
                tmdbUrl.searchParams.set('with_genres', genreId);
            }

            // No perfil infantil o corte começa já na consulta ao TMDB: filtrar só o
            // resultado devolveria páginas quase vazias, porque a maior parte do que vem
            // ordenado por popularidade seria descartado depois.
            if (kids) {
                tmdbUrl.searchParams.set('with_genres', KIDS_DISCOVER_GENRES);
                tmdbUrl.searchParams.delete('with_original_language');
            }

            if (year) {
                if (mType === 'movie') tmdbUrl.searchParams.set('primary_release_year', year);
                if (mType === 'tv') tmdbUrl.searchParams.set('first_air_date_year', year);
            }
            if (rating) {
                tmdbUrl.searchParams.set('vote_average.gte', rating);
                tmdbUrl.searchParams.set('vote_count.gte', '10');
            }

            const res = await fetch(tmdbUrl, {
                headers: { 
                    'Authorization': `Bearer ${apiKey}`, 
                    'Accept': 'application/json',
                    'Accept-Encoding': 'identity'
                }
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map(item => ({ ...item, media_type: mType }));
        };

        const fetchPromises = [];
        if (type === 'all' || type === 'movie') fetchPromises.push(fetchType('movie', page));
        
        if (type === 'anime' || type === 'dorama') {
            // Para animes/doramas, buscamos 5 páginas simultâneas para garantir que a grade fique cheia,
            // já que filtramos pelo que está disponível em nosso catálogo.
            for (let i = 1; i <= 5; i++) {
                fetchPromises.push(fetchType('tv', (page - 1) * 5 + i));
            }
        } else if (type === 'all' || type === 'tv') {
            fetchPromises.push(fetchType('tv', page));
        }

        const [resultsMatrix, idsDisponiveis] = await Promise.all([
            Promise.all(fetchPromises),
            // `.catch(() => null)` é obrigatório (code.md §2.2): sem ele, uma falha de
            // getSuperflixIds() rejeita o Promise.all inteiro e a rota responde 500 num
            // endpoint público que o Googlebot rastreia. `null` já tem caminho definido na
            // linha abaixo (resposta vazia) e no fallback "sem filtro" mais adiante.
            getSuperflixIds().catch(() => null)
        ]);

        if (!idsDisponiveis) return new Response(JSON.stringify([]), { status: 200 });

        // Segunda peneira: o `with_genres` do TMDB é um OR, então ainda passa animação
        // adulta (terror/suspense com o gênero 16 junto).
        const bruto = resultsMatrix.flat().sort((a, b) => b.popularity - a.popularity);
        // Terceira peneira: classificação indicativa real do título (ver contentRating.js)
        // — pega o que passou pelo gênero mas é classificado acima de 10 anos.
        const raw = kids ? await reforcarComClassificacao(filtrarItensInfantis(bruto)) : bruto;
        const { movies, series, anime, doramas } = idsDisponiveis;

        // Se todos os Sets estiverem vazios (Redis/KV indisponível), exibe resultados do TMDB sem filtrar
        const idsAvailable = (movies?.size || 0) + (series?.size || 0) + (anime?.size || 0) > 0;

        let filtered;
        if (!idsAvailable) {
            // Fallback sem filtro: mostra resultados populares do TMDB diretamente
            filtered = raw.map(item => {
                let finalType = item.media_type;
                return {
                    id: item.id,
                    title: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    type: finalType,
                    vote: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
                };
            });
        } else {
            filtered = raw.filter(item => {
                const id = Number(item.id);
                const isMovie = item.media_type === 'movie';
                const isTV = item.media_type === 'tv';

                if (type === 'anime') return isTV && anime.has(id);
                if (type === 'dorama') return isTV && doramas && doramas.has(id);
                if (type === 'movie') return isMovie && movies.has(id);
                if (type === 'tv') return isTV && (series.has(id) || anime.has(id) || (doramas && doramas.has(id)));

                // type === 'all'
                if (isMovie) return movies.has(id);
                if (isTV) return series.has(id) || anime.has(id) || (doramas && doramas.has(id));
                return false;
            }).map(item => {
                 let finalType = item.media_type;
                 if(finalType === 'tv' && anime.has(Number(item.id))) finalType = 'anime';
                 else if(finalType === 'tv' && doramas && doramas.has(Number(item.id))) finalType = 'dorama';
                 // Standardize poster for frontend
                 return { 
                     id: item.id,
                     title: item.title || item.name,
                     poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                     type: finalType,
                     vote: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
                 }; 
            });
        }

        // Deduplicate
        const uniqueItems = Array.from(new Map(filtered.map(item => [item.id, item])).values());

        const headers = {
            "Content-Type": "application/json",
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
        };

        return new Response(JSON.stringify(uniqueItems), {
            status: 200,
            headers: kids ? headersSemCacheInfantil(headers) : headers
        });

    } catch (error) {
        console.error('Erro Explore API:', error);
        return new Response(JSON.stringify([]), { status: 500 });
    }
}

// src/pages/api/discover.js
import { descobrirPorGenero } from "../../services/tmdb";
import { getSuperflixIds } from "../../services/superflix-ids";
import { getEnv } from "../../services/env-adapter.js";

export const prerender = false;

export async function GET({ request }) {
    const url = new URL(request.url);
    const genreId = url.searchParams.get('genreId'); // Pode ser 'anime' ou número
    const page = parseInt(url.searchParams.get('page') || '1');
    const nextPage = parseInt(url.searchParams.get('nextPage') || page.toString()); // Suporte aos dois nomes

    const targetPage = nextPage > 1 ? nextPage : page;

    if (!genreId) return new Response(JSON.stringify({ error: 'Gênero obrigatório' }), { status: 400 });

    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');

    try {
        // --- CASO ESPECIAL: ANIME (Paginação via Lista Superflix) ---
        if (genreId === 'anime') {
            const idsDisponiveis = await getSuperflixIds();
            
            if (!idsDisponiveis || !idsDisponiveis.anime) {
                return new Response(JSON.stringify([]), { status: 200 });
            }

            // 1. Pega lista total invertida (novos primeiro)
            const allAnimeIds = Array.from(idsDisponiveis.anime).reverse();

            // 2. Calcula a "fatia" (Slice) baseada na página
            // Página 1 = 0 a 20. Página 2 = 20 a 40.
            const itemsPerPage = 20;
            const start = (targetPage - 1) * itemsPerPage;
            const end = start + itemsPerPage;
            const pageIds = allAnimeIds.slice(start, end);

            if (pageIds.length === 0) return new Response(JSON.stringify([]), { status: 200 });

            // 3. Busca detalhes desses IDs no TMDB
            const detailsPromises = pageIds.map(async (animeId) => {
                try {
                    const res = await fetch(`https://api.themoviedb.org/3/tv/${animeId}?language=pt-BR`, {
                        headers: { 
                            'Authorization': `Bearer ${apiKey}`, 
                            'Accept': 'application/json',
                            'Accept-Encoding': 'identity'
                        }
                    });
                    if (!res.ok) return null;
                    const data = await res.json();
                    return { ...data, media_type: 'tv', categoria: 'anime' };
                } catch (e) { return null; }
            });

            const results = await Promise.all(detailsPromises);
            const validResults = results.filter(r => r !== null);

            return new Response(JSON.stringify(validResults), { 
                status: 200,
                headers: { 
                    "Content-Type": "application/json",
                    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
                }
            });
        }

        // --- CASO PADRÃO: FILMES E SÉRIES (Via TMDB Discover) ---
        
        // Se for "Carregar Mais", usamos batch menor (1 página) para ser rápido, 
        // ou mantemos o batch de 5 se quiser garantir resultado. 
        // Vamos buscar 2 páginas por vez no botão para garantir.
        const [tmdbData, idsDisponiveis] = await Promise.all([
            descobrirPorGenero(genreId, targetPage, 2), 
            // §2.2: sem o catch, uma falha aqui rejeita o Promise.all e a rota devolve 500
            // para o Googlebot. `null` cai no caminho já existente da linha seguinte.
            getSuperflixIds().catch(() => null)
        ]);

        if (!idsDisponiveis) return new Response(JSON.stringify([]), { status: 200 });

        const resultadosRaw = tmdbData?.results || [];
        const { movies, series, anime } = idsDisponiveis;

        // Se todos os Sets estiverem vazios (Redis/KV indisponível), exibe resultados do TMDB sem filtrar
        const idsAvailable = (movies?.size || 0) + (series?.size || 0) + (anime?.size || 0) > 0;

        const resultadosFiltrados = idsAvailable
            ? resultadosRaw
                .filter(item => {
                    const id = Number(item.id);
                    if (item.media_type === 'movie') return movies.has(id);
                    if (item.media_type === 'tv') return series.has(id) || anime.has(id);
                    return false;
                })
                .map(item => {
                    let categoria = 'movie';
                    const id = Number(item.id);
                    if (item.media_type === 'tv') {
                        categoria = anime.has(id) ? 'anime' : 'serie';
                    }
                    return { ...item, categoria };
                })
            : resultadosRaw.map(item => ({
                ...item,
                categoria: item.media_type === 'tv' ? 'serie' : 'movie'
            }));

        return new Response(JSON.stringify(resultadosFiltrados), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
            }
        });

    } catch (error) {
        console.error('Erro API Discover:', error);
        return new Response(JSON.stringify([]), { status: 500 });
    }
}
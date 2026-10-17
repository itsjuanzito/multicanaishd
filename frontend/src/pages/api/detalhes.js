import { getTMDBDetails } from "../../services/tmdb.js";
import { getSeriesSeasonEpisodes } from "../../services/streambetterCatalogService.js";

export const prerender = false;

export async function GET({ request }) {
  try {
    const url = new URL(request.url);
    const rawId = url.searchParams.get("id");
    const id = rawId ? rawId.replace(/^(tv|movie)_/, "") : null;
    const rawType = url.searchParams.get("type");
    const type = (rawType === "tv" || rawType === "series" || rawType === "anime") ? "tv" : rawType;
    const season = url.searchParams.get("season");
    const lang = url.searchParams.get("lang") || "pt";

    if (!id || !type) return new Response(JSON.stringify({ error: 'Faltam parâmetros', success: false }), { status: 400 });

    let data;
    if (type === 'tv' && season) {
      data = await getSeriesSeasonEpisodes(id, season, lang);
    } else {
      data = await getTMDBDetails(id, type, lang);
    }

    if (!data) return new Response(JSON.stringify({ error: 'Erro ao buscar detalhes', success: false }), { status: 500 });
    if (data.notFound) return new Response(JSON.stringify({ error: 'Não encontrado', success: false }), { status: 404 });

    return new Response(JSON.stringify({ ...data, success: true }), { 
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
      }
    });

  } catch (error) {
    console.error('❌ Erro API Detalhes:', error.message);
    return new Response(JSON.stringify({ error: 'Erro interno', success: false }), { status: 500 });
  }
}
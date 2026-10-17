import { getSuperflixIds } from "../../services/superflix-ids.js";

export async function GET() {
    try {
        console.log('📡 [API superflix-ids] Obtendo IDs através do serviço resiliente...');
        const catalogData = await getSuperflixIds();

        // Formata os Sets do serviço para Arrays retornados no JSON
        // Format the service Sets into Arrays for JSON response
        const responseData = {
            movies: Array.from(catalogData.movies || []),
            series: Array.from(catalogData.series || []),
            anime: Array.from(catalogData.anime || []),
            animes: Array.from(catalogData.anime || []), // Suporte a múltiplos padrões / support multiple patterns
            doramas: Array.from(catalogData.doramas || []),
            total: (catalogData.movies?.size || 0) + 
                   (catalogData.series?.size || 0) + 
                   (catalogData.anime?.size || 0) + 
                   (catalogData.doramas?.size || 0),
            timestamp: new Date().toISOString()
        };

        return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600, s-maxage=7200"
            }
        });

    } catch (error) {
        console.error('❌ Erro no endpoint superflix-ids:', error);
        
        return new Response(JSON.stringify({
            movies: [],
            series: [],
            anime: [],
            animes: [],
            doramas: [],
            total: 0,
            timestamp: new Date().toISOString()
        }), {
            status: 200, // Retorna status amigável com fallback vazio
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache"
            }
        });
    }
}
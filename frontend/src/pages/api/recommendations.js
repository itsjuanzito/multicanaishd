// src/pages/api/recommendations.js
import { getTMDBRecommendations } from "../../services/tmdb.js";

export const prerender = false;

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        const type = url.searchParams.get('type'); 
        const lang = url.searchParams.get('lang') || 'pt';
        
        if (!id || !type) return new Response(JSON.stringify({ results: [] }), { status: 200 });

        const data = await getTMDBRecommendations(id, type, lang);
        
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "public, s-maxage=7200, stale-while-revalidate=86400"
            }
        });

    } catch (error) {
        console.error('🔥 CRASH API Rec:', error);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
}
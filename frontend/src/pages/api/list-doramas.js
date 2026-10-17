import { getContentList } from "../../services/content-lists";

export const prerender = false;

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const lang = url.searchParams.get('lang') || 'pt';
        const data = await getContentList('doramas', lang);
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" 
            }
        });
    } catch (error) {
        console.error('Erro API Doramas:', error);
        return new Response(JSON.stringify({ results: [] }), { status: 500 });
    }
}

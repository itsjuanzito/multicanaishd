export const prerender = false;

import { getEnv } from "../../services/env-adapter.js";

export async function GET({ request }) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const type = url.searchParams.get('type') || 'movie';

    if (!id) return new Response(JSON.stringify({ key: null }), { status: 400 });

    const apiKey = getEnv('KEY_API_TMDB');
    if (!apiKey) return new Response(JSON.stringify({ key: null }), { status: 500 });

    try {
        const mType = type === "anime" ? "tv" : type;

        // Tenta PT-BR primeiro
        let vidRes = await fetch(`https://api.themoviedb.org/3/${mType}/${id}/videos?language=pt-BR`, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`, 
                'Accept': 'application/json',
                'Accept-Encoding': 'identity'
            }
        });
        let vidData = await vidRes.json();
        let trailer = vidData.results?.find((v) => v.type === "Trailer" && v.site === "YouTube");

        if (!trailer && vidData.results?.length > 0) {
            trailer = vidData.results.find((v) => v.site === "YouTube");
        }

        // Se não achar, tenta EN-US
        if (!trailer) {
            vidRes = await fetch(`https://api.themoviedb.org/3/${mType}/${id}/videos?language=en-US`, {
                headers: { 
                    'Authorization': `Bearer ${apiKey}`, 
                    'Accept': 'application/json',
                    'Accept-Encoding': 'identity'
                }
            });
            vidData = await vidRes.json();
            trailer = vidData.results?.find((v) => (v.type === "Trailer" || v.type === "Teaser") && v.site === "YouTube");
        }

        if (trailer) {
            return new Response(JSON.stringify({ key: trailer.key }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400, s-maxage=86400" } // Cache 24h
            });
        }

        return new Response(JSON.stringify({ key: null }), { status: 200 });

    } catch (error) {
        console.error('Erro Trailer API:', error);
        return new Response(JSON.stringify({ key: null }), { status: 500 });
    }
}

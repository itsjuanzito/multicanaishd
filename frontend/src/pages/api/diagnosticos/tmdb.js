import { getEnv } from "../../../services/env-adapter";
export const prerender = false;
export async function GET() {
    try {
        const TMDB_API_KEY = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
        if (!TMDB_API_KEY) throw new Error('Chave TMDB ausente');

        const res = await fetch('https://api.themoviedb.org/3/configuration', {
            headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
        });

        if (res.ok) {
            return new Response(JSON.stringify({ status: 'ok', message: 'TMDB está respondendo corretamente' }), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        throw new Error(`TMDB retornou status ${res.status}`);
    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', reason: e.message }), { 
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

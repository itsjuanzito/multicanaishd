import { getCanalById } from "../../../../services/channelsService.js";
import { getConfig } from "../../../../services/configService.js";

export const prerender = false;

export async function GET({ params }) {
    const { id } = params;
    
    try {
        const canal = await getCanalById(id);
        if (!canal || !canal.imagem) {
            console.error(`Canal ou imagem não encontrada para ID: ${id}`);
            return new Response(null, { status: 404 });
        }

        // Recupera o domínio configurado na moderação
        const baseDomain = await getConfig('SOURCE_S1_URL', 'https://superflixapi.online');
        const referer = baseDomain.endsWith('/') ? baseDomain : `${baseDomain}/`;

        // Busca a imagem original
        const response = await fetch(canal.imagem, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Referer": referer
            }
        });

        if (!response.ok) {
            return new Response(null, { status: response.status });
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get("Content-Type") || "image/png";

        return new Response(buffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=31536000, immutable", // Cache agressivo (1 ano)
                "Access-Control-Allow-Origin": "*"
            }
        });
    } catch (e) {
        console.error("Erro no proxy de imagem de canais:", e);
        return new Response(null, { status: 500 });
    }
}

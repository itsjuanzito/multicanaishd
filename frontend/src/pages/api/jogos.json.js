import { fetchAllRelevantGames } from "../../services/liveGamesService.js";
import { buildEmbedUrl } from "../../services/streamEmbedService.js";
import { slugify } from "../../utils/slugify.js";

export const prerender = false;

export async function GET(context) {
    try {
        const request = context.request;
        const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
        const protocol = request.headers.get("x-forwarded-proto") || (request.url.startsWith("https") ? "https" : "http");
        const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;
        const url = new URL(request.url);
        const directSource = url.searchParams.get("source") === "direct";

        const games = await fetchAllRelevantGames();

        const normalizeTimestamp = (ts) => {
            if (!ts) return 0;
            const num = Number(ts);
            return num > 9999999999 ? Math.floor(num / 1000) : num;
        };

        const jogosFormatados = games.map((j) => {
            const gameId = j.id || `jogo_${j.title?.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, "-").replace(/[^\w-]/g, "") || Math.random()}`;
            const playerUrl = Array.isArray(j.players) ? j.players[0] : (j.players || j.url || "");
            return {
                id: gameId,
                nome: j.title || j.nome,
                imagem: j.image || j.imagem || `${origin}/api/canais/imagem/${gameId}`,
                categoria: "⚽ Jogos Ao Vivo",
                url: directSource
                    ? playerUrl
                    : buildEmbedUrl({ kind: "game", slug: slugify(j.title || j.nome) }),
                hora_inicio: j.data?.timer?.start ? normalizeTimestamp(j.data.timer.start) : null,
                hora_fim: j.data?.timer?.end ? normalizeTimestamp(j.data.timer.end) : null,
                times: j.data?.teams || null,
                data: j.data || j,
            };
        });

        return new Response(JSON.stringify(jogosFormatados), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
            },
        });
    } catch (e) {
        console.error("Erro no endpoint /api/jogos.json:", e);
        return new Response(JSON.stringify({
            error: "Falha ao buscar jogos",
            message: e.message,
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}

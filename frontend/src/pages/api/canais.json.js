import { fetchCanais } from "../../services/channelsService.js";
import { setRuntimeEnv } from "../../services/env-adapter.js";
import { buildEmbedUrl } from "../../services/streamEmbedService.js";
import { slugify } from "../../utils/slugify.js";

export const prerender = false;

export async function GET(context) {
    if (context?.locals?.runtime?.env) {
        setRuntimeEnv(context.locals.runtime.env);
    }

    try {
        const request = context.request;
        const requestUrl = new URL(request.url);
        const directSource = requestUrl.searchParams.get("source") === "direct";

        const canais = await fetchCanais();

        const canaisFormatados = canais.map((c) => ({
            id: c.id,
            nome: c.nome,
            imagem: c.imagem,
            categoria: c.categoria,
            url: directSource
                ? c.url
                : buildEmbedUrl({ kind: "channel", slug: slugify(c.nome) }),
        }));

        return new Response(JSON.stringify(canaisFormatados), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
            },
        });
    } catch (e) {
        console.error("Erro no endpoint /api/canais.json:", e);
        return new Response(JSON.stringify({
            error: "Falha ao buscar canais",
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

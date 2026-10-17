// src/pages/sitemap-[lote].xml.js
// Um lote do sitemap (1-indexado, igual ao nome do arquivo no indice).
import { obterLote, respostaSitemap } from "../services/sitemapService.js";
import { setRuntimeEnv } from "../services/env-adapter.js";

export const prerender = false;

export async function GET(context) {
    try {
        if (context.locals?.runtime?.env) {
            setRuntimeEnv(context.locals.runtime.env);
        }
    } catch (e) {
        console.error("[Sitemap] Erro ao configurar runtime env:", e);
    }

    const numero = Number(context.params.lote);

    // Lote fora da faixa responde 404, nunca um XML vazio: sitemap vazio e resposta VALIDA
    // pro Google, entao um erro de numeracao passaria despercebido em vez de aparecer no
    // Search Console.
    if (!Number.isInteger(numero) || numero < 1) {
        return new Response("Not found", { status: 404 });
    }

    const { xml, cache } = await obterLote(context, numero);
    if (!xml) {
        return new Response("Not found", { status: 404 });
    }

    return respostaSitemap(xml, cache);
}

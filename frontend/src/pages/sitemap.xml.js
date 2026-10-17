// src/pages/sitemap.xml.js
// Passou a ser o INDICE. Era um arquivo unico de 22 mil entradas e 8,7 MB, que o Google
// recusava com "nao foi possivel buscar o sitemap" — dentro do limite do protocolo, mas
// grande demais na pratica. A geracao vive em services/sitemapService.js.
import { obterTotalDeLotes, respostaSitemap } from "../services/sitemapService.js";
import { renderIndex } from "../services/sitemapXml.js";
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

    const { total, siteUrl, cache } = await obterTotalDeLotes(context);
    return respostaSitemap(renderIndex(siteUrl, total), cache);
}

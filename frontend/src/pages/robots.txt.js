// src/pages/robots.txt.js
// Era um arquivo estático em public/robots.txt, com a linha Sitemap: apontando pro domínio
// chumbado. Depois da migração pro .cfd ele continuou anunciando o sitemap do .lat — um
// sitemap de OUTRA propriedade, que o Search Console do domínio novo não aceita.
//
// Agora a linha Sitemap sai de getSiteUrl(), então acompanha SITE_URL sozinha. O resto das
// regras é idêntico ao arquivo anterior.
import { setRuntimeEnv, getSiteUrl } from "../services/env-adapter.js";

export const prerender = false;

const BOTS_BLOQUEADOS = [
    "GPTBot",
    "ChatGPT-User",
    "CCBot",
    "DotBot",
    "BLEXBot",
    "MJ12bot",
    "Bytespider",
    "PetalBot",
];

export async function GET(context) {
    try {
        if (context.locals?.runtime?.env) {
            setRuntimeEnv(context.locals.runtime.env);
        }
    } catch (e) {
        console.error("[robots.txt] Erro ao configurar runtime env:", e);
    }

    const siteUrl = getSiteUrl(context.url);

    const corpo = [
        "User-agent: *",
        "Allow: /",
        "",
        "# Search engines must be able to crawl duplicate/internal URLs so they can see",
        "# canonical tags and X-Robots-Tag headers. Index control lives in page metadata.",
        "",
        ...BOTS_BLOQUEADOS.flatMap((bot) => [`User-agent: ${bot}`, "Disallow: /", ""]),
        `Sitemap: ${siteUrl}/sitemap.xml`,
        "",
    ].join("\n");

    return new Response(corpo, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            // Curto de propósito: numa migração de domínio, robots.txt cacheado por um dia
            // continuaria apontando o sitemap errado depois da correção.
            "Cache-Control": "public, max-age=300",
        },
    });
}

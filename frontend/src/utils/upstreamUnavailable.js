// src/utils/upstreamUnavailable.js

/**
 * Resposta para "a origem (TMDB) falhou de forma transitória", em páginas de conteúdo cuja
 * URL é válida e está no sitemap.
 *
 * Por que 200 + noindex e não 404 nem 503:
 * - 404 diz ao Google que a URL não existe mais. Um timeout de 8s do TMDB desindexava uma
 *   página real, e o dano sobrevive ao incidente por muito tempo. Era o comportamento antigo.
 * - 503 seria o sinal tecnicamente correto (o Google só volta depois), mas §4.2 das regras do
 *   projeto proíbe qualquer 5xx a crawler — 3.506 deles já paralisaram a indexação por semanas.
 * - 200 + noindex mantém a URL viva: sai do índice enquanto a origem está fora e volta sozinha
 *   no próximo rastreamento bem-sucedido, sem sinal de remoção permanente.
 *
 * Só use quando a origem falhou. Conteúdo que o TMDB confirma não existir (`{ notFound: true }`)
 * continua sendo 404 de verdade.
 */
export function upstreamUnavailableResponse(lang = "pt") {
    const isPt = lang !== "en";
    const titulo = isPt ? "Conteúdo temporariamente indisponível" : "Content temporarily unavailable";
    const corpo = isPt
        ? "Não conseguimos carregar os dados deste título agora. Tente novamente em instantes."
        : "We couldn't load this title's data right now. Please try again in a moment.";
    const voltar = isPt ? "Voltar ao Início" : "Back to Home";
    const inicio = isPt ? "/" : "/en";

    return new Response(
        `<!DOCTYPE html><html lang="${isPt ? "pt-BR" : "en"}"><head><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
            `<title>${titulo} - MultiCanaisHD</title><meta name="robots" content="noindex, follow">` +
            `</head><body style="background:#060911;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">` +
            `<div style="text-align:center;padding:24px"><h1 style="font-size:1.5rem;margin:0 0 12px">${titulo}</h1>` +
            `<p style="color:#9ca3af;margin:0 0 20px">${corpo}</p>` +
            `<a href="${inicio}" style="color:#DF0912;font-weight:700">${voltar}</a></div></body></html>`,
        {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "X-Robots-Tag": "noindex, follow",
                // Impede que CDN/browser guardem o estado degradado depois que a origem voltar.
                "Cache-Control": "no-store",
            },
        }
    );
}

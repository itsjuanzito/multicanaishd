// src/utils/hreflang.js
//
// Decide os três <link rel="alternate"> de uma página. Existe como função pura porque a regra
// tem uma sutileza que já produziu bug em produção uma vez:
//
//   - `alternates` AUSENTE (undefined/null) → a rota não sabe os slugs do outro idioma (hub,
//     gênero, canal, página estática). O path é o mesmo nos dois idiomas, então espelhar
//     (trocar o prefixo /en) está CORRETO.
//   - `alternates` PRESENTE com os dois lados nulos → é uma rota de conteúdo, cujo slug
//     canônico depende do idioma, e ela CONFIRMA que não conhece o par. Aqui o alternate é
//     OMITIDO. Espelhar apontaria para uma URL que responde 301, e o Google descarta o par de
//     idiomas inteiro (é o "Página com redirecionamento" em massa no Search Console).
//
// A diferença entre "undefined" e "objeto com nulls" é a regra inteira. Sem ela, a página de
// conteúdo sem mapa de slugs volta silenciosamente ao espelhamento quebrado.

/**
 * @param {object} args
 * @param {{pt?: string|null, en?: string|null}|null|undefined} args.alternates
 * @param {string} args.ptUrl URL absoluta da versão PT calculada por espelhamento de path
 * @param {string} args.enUrl URL absoluta da versão EN calculada por espelhamento de path
 * @param {boolean} args.indexavel falso em página noindex (não emite hreflang nenhum)
 * @returns {{pt: string|null, en: string|null, xDefault: string|null}}
 */
export function resolverHreflang({ alternates, ptUrl, enUrl, indexavel }) {
    const vazio = { pt: null, en: null, xDefault: null };
    if (!indexavel) return vazio;

    const rotaInformaOsSlugs = alternates !== undefined && alternates !== null;

    const pt = rotaInformaOsSlugs ? (alternates.pt || null) : (ptUrl || null);
    const en = rotaInformaOsSlugs ? (alternates.en || null) : (enUrl || null);

    // x-default precisa apontar para uma URL que existe: o PT quando declarado, senão o EN.
    // Declarar x-default para uma URL que não foi declarada é pior do que não declarar nada.
    return { pt, en, xDefault: pt || en };
}

// src/utils/canonicalSlug.js
//
// FONTE ÚNICA DE VERDADE do slug canônico de conteúdo (/filme/:id-slug, /serie/:id-slug).
//
// Por que existe: a mesma decisão estava duplicada em cinco lugares (sitemap.xml.js, as rotas
// PT de /filme e /serie, as rotas /en/* e o slugCanonico.js do redirect de idioma), cada uma
// com uma ordem de candidatos ligeiramente diferente. Qualquer divergência entre "o slug que
// o sitemap anuncia" e "o slug que a página considera canônico" vira um 301 por acesso —
// e como quem consome o sitemap é crawler, isso queimava crawl budget em escala: o Axiom
// mostrou 301 respondendo por 46% de todas as requisições (2.440 em 3h), sendo ~98% de bots.
//
// Regra: TODO cálculo de slug canônico passa por aqui. Não recrie a cadeia de candidatos
// inline em rota nova — importe.
import { contentSlug } from './slugify.js';

/**
 * Slug canônico da versão PT: título traduzido, caindo pro original.
 * @param {object} d  detalhes TMDB (ou item de lista TMDB em pt-BR — os campos batem)
 */
export function slugCanonicoPt(d) {
    return contentSlug(d?.name || d?.title, d?.original_name, d?.original_title);
}

/**
 * Slug canônico da versão EN: NOME EM INGLÊS, caindo pro título original.
 *
 * A ordem não é preferência estética, é a realidade do dado: minifyDetails() (tmdb.js) não
 * copia original_title/original_name pro objeto que as rotas recebem, então o canônico que
 * /en/* calcula sempre foi — na prática — o nome em inglês, mesmo com o código dizendo o
 * contrário. O sitemap, que lê itens crus da TMDB, tinha o original e o usava: era essa a
 * divergência que fazia CADA `/en/*` do sitemap responder 301.
 *
 * Por isso `enName` é parâmetro explícito: o sitemap busca os itens em pt-BR, onde esse campo
 * não existe, e precisa buscá-lo à parte em vez de fingir que o título original serve.
 *
 * @param {object} d        detalhes/item TMDB
 * @param {string} [enName] nome em inglês (lista/details com language=en), quando conhecido
 */
export function slugCanonicoEn(d, enName = null) {
    return contentSlug(
        enName,
        d?.original_title || d?.original_name,
        d?.name,
        d?.title
    );
}

/**
 * Despacha pelo idioma da URL.
 * @param {object} d
 * @param {'pt'|'en'} lang
 * @param {string} [enName]
 */
export function slugCanonicoPorIdioma(d, lang, enName = null) {
    return lang === 'en' ? slugCanonicoEn(d, enName) : slugCanonicoPt(d);
}

/**
 * `${id}-${slug}` pronto pra comparar com Astro.params.slug, para quem buscou os detalhes NO
 * IDIOMA DA URL — que é o caso de toda rota (getTMDBDetails(id, type, lang)).
 *
 * Aqui o nome em inglês não precisa ser passado: quando lang é 'en', ele É o d.title/d.name.
 * Esta função existe justamente pra ninguém esquecer disso — a versão que aceitava enName
 * opcional já produziu um 301 em "/en/filme/598-city-of-god", onde o original ("Cidade de
 * Deus") ganhou do nome em inglês por falta do argumento.
 *
 * O sitemap NÃO usa esta função: os itens dele vêm em pt-BR, então d.title é o título em
 * português e o nome em inglês tem que vir de fora (ver slugCanonicoEn).
 */
export function slugDeDetalhes(id, d, lang) {
    return `${id}-${slugCanonicoPorIdioma(d, lang, d?.title || d?.name)}`;
}

/**
 * Tira o prefixo `${id}-` de um slug ROTACIONADO (Anti-DMCA).
 *
 * As colunas `original_slug_en` / `current_slug_en` de url_rotations guardam o slug COMPLETO,
 * porque nascem de slugDeDetalhes — que já inclui o id. O sitemap e o mapa de hreflang montam a
 * URL concatenando `\${id}-\${slug}` por fora, então sem esta normalização a URL anunciada
 * sairia com o id duplicado (`/filme/603-603-the-matrix-1`), ou seja, um 404/301 por acesso.
 *
 * @param {string|number} id
 * @param {string|null|undefined} slug
 * @returns {string|null} null quando não há slug (nada a anunciar).
 */
export function slugSemPrefixoId(id, slug) {
    if (!slug) return null;
    const texto = String(slug);
    const prefixo = `${id}-`;
    return texto.startsWith(prefixo) ? texto.slice(prefixo.length) : texto;
}

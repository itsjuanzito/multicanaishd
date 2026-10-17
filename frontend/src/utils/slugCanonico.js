// src/utils/slugCanonico.js
//
// Slug canônico de um título NO IDIOMA DE DESTINO, para uso no redirect de locale.
//
// Por que existe: o redirect de idioma (visitante estrangeiro que cai numa URL /pt, ou
// lusófono que cai numa /en) reaproveitava o slug do idioma de ORIGEM e deixava a página de
// destino se autocorrigir com um segundo redirect. O resultado era uma cadeia de três
// requisições pra uma visita só — 302 (troca de idioma) -> 301 (conserta o slug) -> 200.
// O Axiom registrou 16.964 respostas 301 e 5.752 302 em 24h, ~12% de todo o tráfego, com
// pares simétricos denunciando o padrão:
//   /en/serie/75768-deus-salve-o-rei  -> 301 -> /en/serie/75768-god-save-the-king
//   /serie/75768-god-save-the-king    -> 301 -> /serie/75768-deus-salve-o-rei
// Cada hop extra é uma invocação inteira de Worker (CPU + subrequisições) e, pro visitante,
// um round-trip a mais antes de ver a página.
//
// Resolvendo o slug do destino aqui, o redirect de idioma já aponta pra URL final.
import { slugCanonicoPorIdioma } from './canonicalSlug.js';
import { getTMDBDetails } from '../services/tmdb.js';

/**
 * @param {string|number} id  ID TMDB já extraído do slug
 * @param {'tv'|'movie'} type
 * @param {'pt'|'en'} locale  idioma de DESTINO do redirect
 * @param {string} slugAtual  usado como fallback se a TMDB falhar
 * @returns {Promise<string>} slug completo (ex: "75768-god-save-the-king")
 */
export async function slugCanonicoParaIdioma(id, type, locale, slugAtual) {
    if (!id) return slugAtual;
    try {
        const d = await getTMDBDetails(id, type, locale);
        if (!d) return slugAtual;

        // Antes esta cadeia de candidatos era reescrita à mão aqui, "replicando de propósito" a
        // das rotas de destino. Ela derivou (pra filme, o `d.name || d.title` do ramo 'en'
        // fazia o título em inglês ganhar do original, ao contrário de /en/filme), e cada
        // divergência é um 301 extra — exatamente o custo que este módulo existe pra eliminar.
        // Agora todo mundo chama a mesma função. `d` veio de getTMDBDetails(locale), então o
        // nome em inglês pro fallback é o próprio d.name/d.title.
        const alvo = slugCanonicoPorIdioma(d, locale, d.name || d.title);

        return alvo ? `${id}-${alvo}` : slugAtual;
    } catch (e) {
        // Falha da TMDB não pode impedir a troca de idioma: cai no comportamento antigo
        // (redireciona com o slug de origem e deixa o destino corrigir com mais um hop).
        return slugAtual;
    }
}

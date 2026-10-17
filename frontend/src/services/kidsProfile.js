// src/services/kidsProfile.js
// Fonte única do "este aparelho está num perfil infantil?".
//
// O estado nasce no cliente (authStore, ao trocar de perfil) e viaja por cookie porque o
// site é SSR: middleware e páginas precisam decidir o que renderizar ANTES de qualquer
// JavaScript rodar. Esconder conteúdo só depois da hidratação deixaria a rota acessível
// por URL direta e ainda causaria um flash do conteúdo adulto.
//
// Não é credencial: só diz em qual perfil da própria conta o aparelho está, e tudo que
// ele filtra é conteúdo público no resto do site.

export const KIDS_COOKIE = 'bf_kids';

/** Aceita tanto o `Astro` de uma página quanto o `context` do middleware. */
export function isKidsProfile(contextOrAstro) {
    try {
        return contextOrAstro?.cookies?.get(KIDS_COOKIE)?.value === '1';
    } catch (e) {
        return false;
    }
}

/**
 * Versão para rotas de API, que recebem o `Request` cru (e, em `explorar.astro`, são
 * chamadas direto com `{ request }` — sem o objeto `cookies` do Astro).
 */
export function isKidsRequest(request) {
    try {
        const header = request?.headers?.get?.('cookie') || '';
        return header.split(';').some((p) => p.trim() === `${KIDS_COOKIE}=1`);
    } catch (e) {
        return false;
    }
}

/**
 * Uma resposta filtrada para criança NÃO pode ficar no cache compartilhado da borda: a
 * chave de cache da Cloudflare é a URL, então a mesma URL devolveria o catálogo infantil
 * para adultos (e o contrário, pior ainda).
 */
export function headersSemCacheInfantil(headers) {
    return { ...headers, "Cache-Control": "private, no-store" };
}

// Gêneros TMDB liberados no perfil infantil: Família (10751), Animação (16) e o
// equivalente de séries, Kids (10762).
export const KIDS_GENRE_IDS = ['10751', '16', '10762'];

// Formato aceito pelo `with_genres` do /discover: OR entre os gêneros liberados.
export const KIDS_DISCOVER_GENRES = KIDS_GENRE_IDS.join('|');

// Animação sozinha não é garantia de conteúdo infantil (existe anime adulto), então
// qualquer um destes gêneros elimina o título mesmo que ele também seja animação:
// Terror, Suspense, Crime, Guerra, Faroeste e Mistério.
const GENEROS_BLOQUEADOS = [27, 53, 80, 10752, 37, 9648];

const paraNumeros = (lista) => (Array.isArray(lista) ? lista.map(Number).filter((n) => !isNaN(n)) : []);

/**
 * Um item pode servir a uma criança? Precisa carregar algum gênero infantil, nenhum
 * gênero bloqueado e não ser adulto.
 *
 * Itens SEM `genre_ids` são reprovados de propósito: sem a informação não dá para
 * afirmar que é infantil, e o erro seguro aqui é esconder a mais.
 */
export function ehItemInfantil(item) {
    if (!item || item.adult === true) return false;
    const generos = paraNumeros(item.genre_ids || item.genres?.map?.((g) => g.id));
    if (generos.length === 0) return false;
    if (generos.some((g) => GENEROS_BLOQUEADOS.includes(g))) return false;
    return generos.some((g) => KIDS_GENRE_IDS.includes(String(g)));
}

/** Aplica `ehItemInfantil` a uma lista, tolerando entradas nulas. */
export function filtrarItensInfantis(itens) {
    if (!Array.isArray(itens)) return [];
    return itens.filter(ehItemInfantil);
}

/** O gênero pedido é um dos liberados no perfil infantil? */
export function ehGeneroInfantil(genreId) {
    return KIDS_GENRE_IDS.includes(String(genreId));
}

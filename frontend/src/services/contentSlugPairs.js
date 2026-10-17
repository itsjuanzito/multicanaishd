// src/services/contentSlugPairs.js
//
// Mapa "id do TMDB -> slug canônico em pt e em en", usado para emitir hreflang correto nas
// páginas de conteúdo.
//
// Por que existe: o SEO.astro montava os <link rel="alternate" hreflang> espelhando o MESMO
// slug e só trocando o prefixo /en. Só que o slug canônico de /filme e /serie depende do
// idioma: em pt-BR é o título traduzido, em en é o nome em inglês. Para boa parte do catálogo
// os dois diferem, então o alternate do outro idioma apontava para uma URL que responde 301
// ("Página com redirecionamento" no Search Console, e o Google descarta o par de idiomas).
// O sitemap já resolvia isso — buscando o nome em inglês por item — e omitia o alternate
// quando não sabia; a página fazia o oposto.
//
// Quem escreve este mapa é a geração do sitemap (que já calcula os dois slugs para cada item,
// em lote, de 6 em 6 horas). Um blob só, uma leitura só por isolate. Se o mapa não existir,
// a página OMITE o alternate — mesmo critério conservador do sitemap: melhor não anunciar do
// que anunciar uma URL que redireciona.
//
// Nada aqui pode lançar dentro do SSR: falha vira "sem mapa", e sem mapa a página só não
// emite hreflang.
import { getEnv, getSiteUrl } from './env-adapter.js';

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h — acompanha o expirationTtl dos lotes do sitemap
const RECUO_APOS_FALHA = 60000;

if (!globalThis._bf_slug_pairs) {
    globalThis._bf_slug_pairs = {
        host: null,
        porId: new Map(),
        lastFetch: 0,
        nextAttemptAt: 0,
        avisou: false,
    };
}
const cache = globalThis._bf_slug_pairs;

export const chavePares = (host) => `slug_pairs_v1:${host}`;

export function chaveDeMidia(mediaType, mediaId) {
    if (mediaId === null || mediaId === undefined || mediaId === '') return '';
    const tipo = mediaType === 'tv' || mediaType === 'series' || mediaType === 'serie' ? 'tv' : 'movie';
    return `${tipo}:${Number(mediaId)}`;
}

function hostDe(siteUrlHint) {
    try {
        return new URL(getSiteUrl(siteUrlHint)).hostname;
    } catch {
        return 'desconhecido';
    }
}

/** Índices em memória a partir do objeto gravado pelo sitemap. Puro — exportado para teste. */
export function indexarPares(objeto, destino = new Map()) {
    destino.clear();
    for (const [chave, valor] of Object.entries(objeto || {})) {
        if (!valor) continue;
        const pt = typeof valor.pt === 'string' && valor.pt ? valor.pt : null;
        const en = typeof valor.en === 'string' && valor.en ? valor.en : null;
        if (!pt && !en) continue;
        destino.set(chave, { pt, en });
    }
    return destino;
}

/**
 * Par de slugs de uma obra, do cache L1. Devolve null quando não há mapa carregado ou o item
 * não está nele — e o chamador deve OMITIR o alternate nesse caso.
 * @returns {{pt: string|null, en: string|null}|null}
 */
export async function obterParDeSlugs(mediaId, mediaType, siteUrlHint) {
    try {
        const chave = chaveDeMidia(mediaType, mediaId);
        if (!chave) return null;
        await carregarPares(siteUrlHint);
        return cache.porId.get(chave) || null;
    } catch (e) {
        console.warn('[contentSlugPairs] Falha ao ler par de slugs:', e?.message || e);
        return null;
    }
}

/** Carrega o blob do KV para a memória. Nunca lança. */
export async function carregarPares(siteUrlHint, force = false) {
    const host = hostDe(siteUrlHint);
    const agora = Date.now();

    // Troca de domínio invalida o cache na hora: o blob é por host e ficaria servindo slugs
    // do domínio antigo (mesmo motivo da chave versionada por host nos lotes do sitemap).
    if (cache.host && cache.host !== host) {
        cache.porId.clear();
        cache.lastFetch = 0;
        cache.host = host;
    }

    if (!force) {
        if (cache.lastFetch && agora - cache.lastFetch < CACHE_TTL) return cache.porId;
        if (agora < cache.nextAttemptAt) return cache.porId;
    }

    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function') return cache.porId;

    try {
        const bruto = await kv.get(chavePares(host));
        if (bruto) {
            indexarPares(typeof bruto === 'string' ? JSON.parse(bruto) : bruto, cache.porId);
            cache.lastFetch = agora;
            cache.nextAttemptAt = 0;
            cache.avisou = false;
        } else {
            // Sem blob: não marca lastFetch, mas também não tenta de novo a cada página.
            cache.nextAttemptAt = agora + RECUO_APOS_FALHA;
            if (!cache.avisou) {
                console.warn('[contentSlugPairs] Mapa de slugs pt/en ausente no KV — hreflang de conteúdo será omitido até a próxima geração do sitemap.');
                cache.avisou = true;
            }
        }
    } catch (e) {
        cache.nextAttemptAt = agora + RECUO_APOS_FALHA;
        if (!cache.avisou) {
            console.warn('[contentSlugPairs] Falha ao ler o mapa de slugs pt/en:', e?.message || e);
            cache.avisou = true;
        }
    }

    cache.host = host;
    return cache.porId;
}

/** Grava o mapa (chamado pela geração do sitemap). Silencioso em falha. */
export async function gravarPares(kv, host, pares) {
    if (!kv || typeof kv.put !== 'function') return false;
    try {
        await kv.put(chavePares(host), JSON.stringify(pares), { expirationTtl: Math.round(CACHE_TTL / 1000) });
        return true;
    } catch (e) {
        console.error('[contentSlugPairs] Falha ao gravar o mapa de slugs pt/en:', e?.message || e);
        return false;
    }
}

/** Só para teste: injeta um mapa e finge que está fresco. */
export function __definirParesParaTeste(objeto, host = 'teste.local') {
    indexarPares(objeto, cache.porId);
    cache.host = host;
    cache.lastFetch = Date.now();
    cache.nextAttemptAt = 0;
    return cache.porId;
}

/** Monta as URLs de alternate a partir do par, resolvendo o slug rotacionado do PT. */
export function urlsDeAlternate({ siteUrl, rota, id, par, slugPtRotacionado }) {
    const ptSlug = slugPtRotacionado || (par?.pt ? `${id}-${par.pt}` : null);
    const enSlug = par?.en ? `${id}-${par.en}` : null;
    return {
        pt: ptSlug ? `${siteUrl}/${rota}/${ptSlug}` : null,
        en: enSlug ? `${siteUrl}/en/${rota}/${enSlug}` : null,
    };
}

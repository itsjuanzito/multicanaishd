// src/services/cache.js
// In-memory micro-cache with 5-minute TTL for TMDB API responses

import { getEnv, getRuntimeWaitUntil } from './env-adapter.js';

const cache = new Map();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

// L2 via Cloudflare KV (binding 'SESSION', mesmo usado em configService): sobrevive a cold start de isolate, diferente do Map acima que é só RAM
// local. Detalhes de filme/série na TMDB raramente mudam, então um TTL de horas é seguro
// e evita bater na API da TMDB de novo a cada isolate novo — isso era uma causa real do
// SSR lento em páginas de série (p95 de 6-8s visto no Axiom).
// 7 dias (era 6h). Detalhes de filme/série na TMDB (título, sinopse, poster, elenco) quase
// não mudam, mas com TTL de 6h cada uma das ~15 mil chaves `tmdb_cache:*` expirava e era
// regravada 4x por dia SÓ por causa do relógio — dezenas de milhares de escritas diárias
// sem nenhuma mudança de dado. Era a maior fatia das KV Write Operations da conta.
// ATENÇÃO: este TTL é pro cache de DETALHES. Dados de temporada usam KV_TTL_SEASON_S abaixo,
// que é curto de propósito — série em exibição ganha episódio novo e não pode ficar uma
// semana sem aparecer.
const KV_TTL_S = 7 * 24 * 60 * 60; // 7 dias

// 6h: SÓ para temporada que ainda está em exibição — episódio novo não pode esperar.
export const KV_TTL_SEASON_S = 6 * 60 * 60;

// Temporada encerrada (último episódio já foi ao ar faz tempo) é dado IMUTÁVEL: título,
// sinopse e still de episódio de série finalizada não mudam mais. Com o TTL de 6h aplicado a
// TODAS as temporadas, cada uma das dezenas de milhares de chaves `season_*` expirava e era
// regravada 4x por dia só por causa do relógio, sem nenhuma mudança de dado — exatamente o
// mesmo bug que já tinha sido corrigido no TTL de DETALHES (ver KV_TTL_S acima), mas que
// continuou vivo aqui. Era o que sobrou como maior fatia das KV Write Operations da conta.
// Ver `ttlDeTemporada()` em tmdb.js para o critério de "encerrada".
export const KV_TTL_SEASON_ENCERRADA_S = 30 * 24 * 60 * 60; // 30 dias

// Teto de tempo pra leitura no KV. Esta função roda no caminho crítico do SSR de toda
// página de filme/série, e era a única consumidora de KV do projeto sem timeout (config,
// status e xtream já tinham) — uma leitura lenta pendurava o render inteiro esperando um
// CACHE, que por definição é opcional. Era a origem provável dos picos de latência de KV.
// Estourar o teto é tratado como cache miss: a página segue e busca na TMDB.
const KV_READ_TIMEOUT_MS = 800;
const KV_TIMEOUT = Symbol('kv-timeout');

// Chaves cuja LEITURA falhou por timeout/erro nesta janela. Um timeout de leitura não
// significa que a chave não existe — significa que o KV está lento. Tratar os dois casos
// como "miss" fazia o SSR rebuscar na TMDB e REESCREVER uma chave que provavelmente já
// estava lá, e isso se auto-alimentava: quanto mais carga, mais timeout, mais escrita,
// mais lentidão. Era o multiplicador principal da conta de KV Write Operations.
// Aqui a leitura ainda degrada pra miss (a página não pode travar esperando cache), mas a
// escrita subsequente é suprimida por um tempinho.
const SUPPRESS_WRITE_MS = 60 * 1000;
globalThis._bf_kv_read_failed = globalThis._bf_kv_read_failed || new Map();

function marcarLeituraFalha(key) {
    const mapa = globalThis._bf_kv_read_failed;
    mapa.set(key, Date.now() + SUPPRESS_WRITE_MS);
    if (mapa.size > 500) {
        const primeira = mapa.keys().next().value;
        mapa.delete(primeira);
    }
}

function leituraFalhouRecentemente(key) {
    const ate = globalThis._bf_kv_read_failed.get(key);
    if (!ate) return false;
    if (Date.now() > ate) {
        globalThis._bf_kv_read_failed.delete(key);
        return false;
    }
    return true;
}

// `cacheTtl` do kv.get(): quanto tempo o colo da Cloudflare pode servir a chave do cache
// local dele em vez de ir até a camada de KV. É o lever que faltava aqui — o L1 em RAM é por
// isolate e tem teto de 800 entradas, então com o catálogo sendo varrido por crawler a taxa
// de miss é estruturalmente alta e cada miss virava uma ida ao KV. O cache do colo é
// compartilhado por todos os isolates daquele datacenter, ou seja, pega justamente o caso
// que o L1 não cobre.
// O default do kv.get() é 60s, curtíssimo para dado que fica 7 dias parado no KV.
const KV_CACHE_TTL_DETALHES_S = 6 * 60 * 60; // 6h — dado com KV_TTL_S de 7 dias
// Temporada tem KV TTL de 6h quando está em exibição; segurar o cache do colo por 1h no
// máximo mantém a janela de episódio novo dentro do que o próprio KV_TTL_SEASON_S promete.
export const KV_CACHE_TTL_TEMPORADA_S = 60 * 60;

export async function getKVCached(key, cacheTtl = KV_CACHE_TTL_DETALHES_S) {
    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function') return null;
    try {
        const raw = await Promise.race([
            kv.get(`tmdb_cache:${key}`, { cacheTtl }),
            new Promise((resolve) => setTimeout(() => resolve(KV_TIMEOUT), KV_READ_TIMEOUT_MS))
        ]);
        if (raw === KV_TIMEOUT) {
            console.warn(`[Cache] Timeout de ${KV_READ_TIMEOUT_MS}ms lendo KV para ${key} — seguindo como miss (escrita suprimida).`);
            marcarLeituraFalha(key);
            return null;
        }
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        marcarLeituraFalha(key);
        return null;
    }
}

export function setKVCached(key, data, ttlSeconds = KV_TTL_S) {
    const kv = getEnv('SESSION');
    if (!kv || typeof kv.put !== 'function') return;

    // A leitura desta chave acabou de falhar por timeout — o dado provavelmente já está no
    // KV e regravá-lo só gastaria uma escrita (a mais cara das duas operações) justamente
    // no momento em que o KV está sobrecarregado. O L1 em RAM já cobre esta requisição.
    if (leituraFalhouRecentemente(key)) {
        return;
    }

    const writePromise = kv.put(`tmdb_cache:${key}`, JSON.stringify(data), { expirationTtl: ttlSeconds })
        .catch((e) => console.error("[Cache] Falha ao gravar cache KV do TMDB:", e.message));

    // Registra no waitUntil real do Worker — sem isso a Cloudflare pode encerrar o isolate
    // assim que a resposta é enviada, matando essa escrita em background antes de terminar.
    const waitUntil = getRuntimeWaitUntil();
    if (waitUntil) waitUntil(writePromise);
}

// Cache "stale" de longa duração: guarda o último dado bom conhecido para
// servir como fallback quando a fonte upstream falhar de forma transitória
// (timeout, rate-limit, 5xx), evitando 404 falso para o Googlebot.
const staleCache = new Map();
const STALE_TTL = 24 * 60 * 60 * 1000; // 24 horas

export function getStaleCached(key) {
    const entry = staleCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        staleCache.delete(key);
        return null;
    }
    return entry.data;
}

export function setStaleCached(key, data) {
    staleCache.set(key, { data, expiry: Date.now() + STALE_TTL });
    if (staleCache.size > 200) {
        const firstKey = staleCache.keys().next().value;
        staleCache.delete(firstKey);
    }
}

/**
 * Get a cached value by key. Returns null if expired or not found.
 * @param {string} key
 * @returns {any|null}
 */
export function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }
    // LRU: relê-la a move pro fim da ordem de inserção do Map, que é por onde a expulsão
    // abaixo escolhe a vítima. Sem isto a política era FIFO pura — um título quente era
    // descartado por ser antigo enquanto um título frio, inserido depois, sobrevivia. Com
    // teto de 200 entradas e um catálogo de dezenas de milhares varrido por bots, isso
    // mantinha o L1 em thrashing e jogava quase todo acesso no KV (leitura paga).
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
}

/**
 * Set a value in cache with optional TTL (default 5 min).
 * @param {string} key
 * @param {any} data
 * @param {number} [ttl] - Time to live in ms
 */
export function setCached(key, data, ttl = DEFAULT_TTL) {
    // `Map.set` numa chave que já existe NÃO move a posição dela na ordem de inserção, então
    // sem o delete a reescrita de uma chave quente não a protegia da expulsão.
    cache.delete(key);
    cache.set(key, { data, expiry: Date.now() + ttl });

    // Teto de entradas. 200 era conservador demais: com um catálogo de dezenas de milhares
    // varrido por bots, o cache girava inteiro o tempo todo e cada miss custava uma leitura
    // de KV (paga) MAIS um JSON.parse do payload (CPU pura, e CPU tambem é faturada).
    // O número saiu de medição, não de chute — as entradas são o objeto JÁ minificado por
    // minifyDetails/minifySeason, não o payload cru da TMDB:
    //   detalhes de filme ~3,3KB | detalhes de série ~5,0KB | temporada de 24 ep ~18,2KB
    // A temporada é que dita o pior caso. Com fator ~3x de overhead de objeto vivo sobre a
    // string JSON, 800 entradas dão ~42MB no pior caso absoluto (todas sendo temporadas
    // longas) e ~15MB na mistura real — folga confortável nos 128MB do isolate. 2000 daria
    // ~107MB, perto demais do limite: não vale trocar centavos de KV por 503 no SSR.
    while (cache.size > 800) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
}

// TTL do L1 para dados que o L2 (KV) guarda por dias. Reidratar o Map a partir do KV com os
// 5 min padrão fazia um título quente pagar uma LEITURA de KV a cada 5 min por isolate, mesmo
// com o dado parado no KV por 7 dias. Não há motivo pro cache de RAM ser mais curto que a
// fonte que ele espelha; o teto de entradas é que limita a memória, não o TTL.
export const L1_TTL_L2_HIDRATADO_MS = 30 * 60 * 1000;

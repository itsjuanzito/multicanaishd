// src/services/contentRating.js
// Reforço do filtro infantil: classificação indicativa real, por título, além do
// gênero já aplicado em kidsProfile.js.
//
// Por que não é o filtro principal: a TMDB não devolve certification junto de
// discover/search/trending — é uma chamada por título (`/release_dates` ou
// `/content_ratings`). Usar isso como primeira linha de defesa multiplicaria as
// chamadas à API por item exibido. Aqui ele entra como uma segunda peneira, sobre uma
// lista que o filtro de gênero já reduziu.
//
// Cache em memória (não Redis — cota da Upstash está esgotada, ver [[project_redis_exhausted]]):
// a classificação de um título não muda, então um TTL longo é seguro e evita bater na
// TMDB de novo a cada visita.

import { fetchWithTimeout } from './fetch-util.js';
import { getEnv } from './env-adapter.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — classificação não muda de um dia pro outro.
const PER_ITEM_TIMEOUT_MS = 1500;

// Singleton em globalThis, mesmo padrão do L1 cache de redis-client.js: sobrevive a
// múltiplas requisições na mesma isolate do Worker, mas não sobrevive ao cold start.
function getCache() {
    if (!globalThis._bf_certification_cache) {
        globalThis._bf_certification_cache = new Map();
    }
    return globalThis._bf_certification_cache;
}

// Só liberamos livre e 10 anos para o perfil infantil (opção "L, 10" escolhida pelo
// usuário). Cobre BR (numérica + "L") e cai pro selo americano quando o Brasil não tem
// dado cadastrado, que é comum para catálogo menor/mais antigo.
const PERMITIDAS_BR = new Set(['L', '0', '10']);
const PERMITIDAS_US_FILME = new Set(['G', 'PG']);
const PERMITIDAS_US_SERIE = new Set(['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG']);

async function buscarCertificacaoFilme(id, apiKey) {
    const url = `https://api.themoviedb.org/3/movie/${id}/release_dates`;
    const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: PER_ITEM_TIMEOUT_MS
    });
    if (!res.ok) return null;
    const data = await res.json();
    const paises = data?.results || [];

    const br = paises.find((p) => p.iso_3166_1 === 'BR');
    const certBr = br?.release_dates?.find((r) => r.certification)?.certification;
    if (certBr) return { pais: 'BR', certification: certBr };

    const us = paises.find((p) => p.iso_3166_1 === 'US');
    const certUs = us?.release_dates?.find((r) => r.certification)?.certification;
    if (certUs) return { pais: 'US', certification: certUs };

    return null;
}

async function buscarCertificacaoSerie(id, apiKey) {
    const url = `https://api.themoviedb.org/3/tv/${id}/content_ratings`;
    const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: PER_ITEM_TIMEOUT_MS
    });
    if (!res.ok) return null;
    const data = await res.json();
    const paises = data?.results || [];

    const br = paises.find((p) => p.iso_3166_1 === 'BR' && p.rating);
    if (br) return { pais: 'BR', certification: br.rating };

    const us = paises.find((p) => p.iso_3166_1 === 'US' && p.rating);
    if (us) return { pais: 'US', certification: us.rating };

    return null;
}

/**
 * Classificação de um título, com cache em memória. Devolve `null` quando a TMDB não
 * tem o dado cadastrado ou a chamada falha — ausência de dado, não "adulto".
 */
export async function getCertificacao(id, mediaType) {
    const chave = `${mediaType}_${id}`;
    const cache = getCache();
    const cached = cache.get(chave);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.valor;
    }

    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    if (!apiKey) return null;

    try {
        const valor = mediaType === 'movie'
            ? await buscarCertificacaoFilme(id, apiKey)
            : await buscarCertificacaoSerie(id, apiKey);
        cache.set(chave, { valor, timestamp: Date.now() });
        return valor;
    } catch (e) {
        return null;
    }
}

function certificacaoPermitida(mediaType, info) {
    if (!info) return null; // "não sabemos" — decidido por quem chama, não aqui.
    if (info.pais === 'BR') return PERMITIDAS_BR.has(info.certification.toUpperCase());
    const permitidas = mediaType === 'movie' ? PERMITIDAS_US_FILME : PERMITIDAS_US_SERIE;
    return permitidas.has(info.certification.toUpperCase());
}

/**
 * Segunda peneira do perfil infantil: recebe uma lista JÁ filtrada por gênero e remove
 * o que tiver classificação indicativa acima de 10 anos.
 *
 * Falha aberta por design: título sem dado de classificação (comum — a cobertura da
 * TMDB é parcial) OU falha na chamada mantém o item, confiando no filtro de gênero que
 * já rodou antes. A alternativa (bloquear por padrão) esvaziaria bairros inteiros do
 * catálogo infantil por falta de metadado, não por conteúdo impróprio.
 *
 * Timeout total curto e concorrência limitada: isto roda no caminho crítico do SSR
 * (home, busca, explorar), então uma TMDB lenta não pode virar uma home lenta — melhor
 * devolver a lista com o filtro de gênero sozinho do que travar a página.
 */
export async function reforcarComClassificacao(itens, opts = {}) {
    if (!Array.isArray(itens) || itens.length === 0) return itens;
    const budgetMs = opts.budgetMs ?? 2500;

    const comTeto = (promise) => Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), budgetMs))
    ]);

    try {
        const checagens = await comTeto(Promise.allSettled(
            itens.map((item) => {
                const mediaType = item.media_type === 'movie' || item.type === 'movie' ? 'movie' : 'tv';
                const id = item.id;
                return getCertificacao(id, mediaType).then((info) => ({ id, mediaType, info }));
            })
        ));

        if (checagens === 'timeout') return itens; // orçamento estourou: mantém o que o gênero já filtrou.

        const bloqueados = new Set();
        checagens.forEach((r) => {
            if (r.status !== 'fulfilled') return;
            const { id, mediaType, info } = r.value;
            const permitida = certificacaoPermitida(mediaType, info);
            if (permitida === false) bloqueados.add(id);
        });

        return itens.filter((item) => !bloqueados.has(item.id));
    } catch (e) {
        return itens;
    }
}

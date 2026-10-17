// Enriquece incrementalmente o catálogo REAL do site (todos os IDs disponíveis via
// getSuperflixIds — não só as listas "popular/top_rated" do TMDB) com metadados TMDB
// (título, poster, data), pra que o sitemap.xml consiga listar o catálogo inteiro em
// vez de só o que cruza com as listas de trending. Processa em lotes via cron
// (api/internal/enrich-catalog.js) e persiste o resultado no Cloudflare KV.
import { getSuperflixIds } from "./superflix-ids.js";
import { getEnv } from "./env-adapter.js";

const KV_KEY = 'catalog_enrichment_v1';
const KV_TTL = 60 * 60 * 24 * 30; // 30 dias — o cron continua re-enriquecendo/atualizando bem antes disso
const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 14; // reprocessa entradas com mais de 14 dias (título pode mudar, etc.)
const TMDB_TIMEOUT = 5000;
const MIN_VOTE_COUNT = 30;

async function fetchDetails(type, id, apiKey) {
    const endpoint = type === 'movie' ? 'movie' : 'tv';
    const url = `https://api.themoviedb.org/3/${endpoint}/${id}?language=pt-BR`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT);
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

function buildAllIdsList(idSets) {
    const list = [];
    (idSets.movies || new Set()).forEach(id => list.push({ id, type: 'movie' }));
    // Séries, animes e doramas viram páginas /serie/ no site — mesmo media_type pro sitemap
    for (const set of [idSets.series, idSets.anime, idSets.doramas]) {
        (set || new Set()).forEach(id => list.push({ id, type: 'tv' }));
    }
    return list;
}

async function loadState(kv) {
    if (!kv || typeof kv.get !== 'function') return { entries: {} };
    try {
        const raw = await kv.get(KV_KEY);
        if (!raw) return { entries: {} };
        const parsed = JSON.parse(raw);
        return { entries: parsed?.entries || {} };
    } catch (e) {
        return { entries: {} };
    }
}

async function saveState(kv, state) {
    if (!kv || typeof kv.put !== 'function') return;
    await kv.put(KV_KEY, JSON.stringify(state), { expirationTtl: KV_TTL });
}

/**
 * Processa um lote de IDs do catálogo real que ainda não foram enriquecidos (ou estão
 * velhos), busca detalhes no TMDB, e persiste no KV. Chamado pelo cron interno.
 */
export async function enrichCatalogBatch({ batchSize = 80 } = {}) {
    const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
    if (!apiKey) return { processed: 0, reason: 'missing_tmdb_key' };

    const kv = getEnv('SESSION');
    const idSets = await getSuperflixIds();
    const allIds = buildAllIdsList(idSets);
    if (allIds.length === 0) return { processed: 0, reason: 'empty_catalog' };

    const state = await loadState(kv);
    const now = Date.now();

    const pending = allIds.filter(({ id, type }) => {
        const entry = state.entries[`${type}-${id}`];
        if (!entry) return true;
        return (now - (entry.checkedAt || 0)) > STALE_AFTER_MS;
    });

    const batch = pending.slice(0, batchSize);
    if (batch.length === 0) return { processed: 0, total: allIds.length, reason: 'nothing_pending' };

    const results = await Promise.all(batch.map(async ({ id, type }) => {
        const data = await fetchDetails(type, id, apiKey);
        return { id, type, data };
    }));

    for (const { id, type, data } of results) {
        const key = `${type}-${id}`;
        if (!data) {
            // Marca como checado mesmo em falha, pra não martelar o mesmo ID toda hora — será
            // reprocessado naturalmente quando a entrada ficar "stale" de novo.
            state.entries[key] = { checkedAt: now, skip: true };
            continue;
        }

        const title = data.title || data.name;
        const hasPoster = !!data.poster_path;
        const hasMinVotes = data.vote_count !== undefined ? data.vote_count >= MIN_VOTE_COUNT : true;

        if (!title || !hasPoster || !hasMinVotes) {
            state.entries[key] = { checkedAt: now, skip: true };
            continue;
        }

        state.entries[key] = {
            checkedAt: now,
            skip: false,
            id,
            type,
            title,
            originalTitle: data.original_title || data.original_name || title,
            posterPath: data.poster_path,
            date: data.release_date || data.first_air_date || null
        };
    }

    await saveState(kv, state);

    return { processed: batch.length, total: allIds.length, pendingBefore: pending.length };
}

/**
 * Lê o catálogo já enriquecido do KV, no formato pronto para o sitemap.xml consumir.
 */
export async function getEnrichedCatalogEntries() {
    const kv = getEnv('SESSION');
    const state = await loadState(kv);
    return Object.values(state.entries).filter(e => e && e.skip === false);
}

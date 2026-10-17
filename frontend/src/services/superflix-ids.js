import { fetchWithTimeout } from "./fetch-util.js";
import { getEnv, getRuntimeWaitUntil } from "./env-adapter.js";
import { axiomService } from "./axiom-service.js";
import { getShopUrl } from "./streamEmbedService.js";

// Endpoint da StreamBetter com TODOS os tmdb_id do catálogo numa resposta só (~100 KB gzip),
// separados por categoria. Substitui a varredura de ~320 páginas de /api/filmes|series|...,
// que levava minutos (120 req/min por IP) e, quando falhava no meio, gravava categorias
// vazias no KV. Ver streambetter.shop/docs.
const IDS_PATH = '/api/titles/ids';
const CATEGORY_KEYS = { movies: 'movie', series: 'tv', anime: 'anime', doramas: 'dorama' };

// Usar globalThis para persistir o estado entre execuções do Worker (warm start)
if (!globalThis._bf_superflix_cache) {
    globalThis._bf_superflix_cache = {
        data: null,
        timestamp: 0,
        promise: null,
        isUpdating: false
    };
}
const state = globalThis._bf_superflix_cache;

// Cache de memória de 5 minutos
const MEMORY_TTL = 1000 * 60 * 5;
// Cache do KV: 8 horas. Era 2h quando isso vinha de 1 request por categoria (mirrors do
// Superflix); agora são até ~300 páginas ao todo pra cobrir o catálogo inteiro da
// StreamBetter, e refazer isso a cada 2h competia por rede/CPU com o resto do site toda
// vez que expirava. O catálogo de "o que está disponível" não muda tão rápido a ponto de
// precisar de um refresh completo tão frequente — 8h é um meio-termo seguro.
// Cache do KV: 2 horas. Com a chamada única o refresh é barato (1 request), então não
// precisa mais do TTL de 8h que existia pra amortizar a varredura paginada.
const KV_TTL = 1000 * 60 * 60 * 2;

/**
 * Baixa o catálogo e valida que veio inteiro. Qualquer resposta suspeita lança erro — quem
 * consome esses Sets filtra de forma DESTRUTIVA (busca, prateleiras, sitemap), então uma lista
 * vazia/truncada gravada no KV some com títulos disponíveis por horas (já aconteceu: filmes
 * zerados e "resident evil" mostrando só 2 séries). Na falha, o snapshot anterior é mantido.
 */
async function fetchCatalogIds() {
    const res = await fetchWithTimeout(`${getShopUrl()}${IDS_PATH}`, { timeout: 15000 });
    if (!res.ok) throw new Error(`Not ok (${res.status})`);
    const json = await res.json();
    if (!json || json.success !== true || !json.ids || !json.counts) throw new Error('Invalid data');

    const result = {};
    for (const [key, apiKey] of Object.entries(CATEGORY_KEYS)) {
        const ids = json.ids[apiKey];
        if (!Array.isArray(ids) || ids.length !== json.counts[apiKey]) {
            throw new Error(`Categoria ${apiKey} incompleta`);
        }
        result[key] = ids.map(Number);
    }
    if (result.movies.length === 0 || result.series.length === 0) throw new Error('Catálogo vazio');
    return result;
}

/**
 * Dispara de forma assíncrona (Background) a atualização de IDs sem bloquear o request do usuário
 */
function triggerBackgroundUpdate() {
    if (state.isUpdating && state.updatePromise) return state.updatePromise; // Já tem uma atualização em andamento

    state.isUpdating = true;
    state.updatePromise = (async () => {
        const kv = getEnv('SESSION');
        const kvKey = 'superflix_ids_cache_v2';

        try {
            const ids = await fetchCatalogIds();
            state.data = {
                movies: new Set(ids.movies),
                series: new Set(ids.series),
                anime: new Set(ids.anime),
                doramas: new Set(ids.doramas)
            };
            state.timestamp = Date.now();
            console.log(`✅ [Background IDs] Catálogo carregado (${ids.movies.length} filmes, ${ids.series.length} séries)`);

            if (kv && typeof kv.put === 'function') {
                await kv.put(kvKey, JSON.stringify({ timestamp: state.timestamp, ...ids }), { expirationTtl: 86400 })
                    .catch(e => console.error("Erro ao salvar no KV:", e.message));
            }
        } catch (error) {
            console.error("⚠️ [Background IDs] Falha ao atualizar, mantendo snapshot anterior:", error.message);
            axiomService.logError(error, { servico: "superflix-ids", etapa: "background-update" }).catch(() => {});
        } finally {
            state.isUpdating = false;
        }
    })();

    // Registra a promessa com o ctx.waitUntil real do Worker (se disponível). Sem isso, a
    // Cloudflare pode encerrar o isolate assim que a resposta é enviada, antes de gravar no KV.
    const waitUntil = getRuntimeWaitUntil();
    if (waitUntil) {
        waitUntil(state.updatePromise.catch(() => {}));
    }

    return state.updatePromise;
}

export async function getSuperflixIds() {
    const agora = Date.now();
    const isCron = typeof process !== 'undefined' && process.env.CRON_NODE === 'true';
    
    // 1. Camada 1: Cache em Memória fresco
    if (state.data && (agora - state.timestamp < MEMORY_TTL)) {
        return state.data;
    }
    
    // Se temos dados em memória e expiraram (stale), retorna e atualiza em segundo plano
    if (state.data) {
        if (isCron) {
            console.log('📥 [IDs] CRON detectado: aguardando revalidação STALE...');
            await triggerBackgroundUpdate();
        } else {
            triggerBackgroundUpdate();
        }
        return state.data;
    }

    // 2. Singleton: Se já tem uma busca SÍNCRONA ativa em andamento, aguarda ela
    if (state.promise) return state.promise;

    state.promise = (async () => {
        const kv = getEnv('SESSION');
        const kvKey = 'superflix_ids_cache_v2';

        try {
            // 3. Camada 2: Cloudflare KV (Persistente Global)
            if (kv && typeof kv.get === 'function') {
                try {
                    const kvDataStr = await kv.get(kvKey);
                    if (kvDataStr) {
                        const kvParsed = JSON.parse(kvDataStr);
                        if (kvParsed) {
                            const loadedData = {
                                movies: new Set(kvParsed.movies || []),
                                series: new Set(kvParsed.series || []),
                                anime: new Set(kvParsed.anime || []),
                                doramas: new Set(kvParsed.doramas || [])
                            };

                            // Se estiver fresco (menos de KV_TTL), excelente!
                            if (kvParsed.timestamp && (agora - kvParsed.timestamp < KV_TTL)) {
                                console.log('⚡ [IDs] Cache HIT fresco no Cloudflare KV.');
                                state.data = loadedData;
                                state.timestamp = kvParsed.timestamp;
                                state.promise = null;
                                return state.data;
                            } else {
                                // STALE-WHILE-REVALIDATE: Os dados estão expirados, mas existem!
                                if (isCron) {
                                    console.log('⚡ [IDs] Cache STALE no KV (CRON). Aguardando atualização síncrona...');
                                    state.data = loadedData;
                                    state.timestamp = kvParsed.timestamp;
                                    await triggerBackgroundUpdate();
                                    return state.data;
                                } else {
                                    console.log('⚡ [IDs] Cache STALE no Cloudflare KV. Retornando imediatamente e atualizando em background...');
                                    state.data = loadedData;
                                    state.timestamp = kvParsed.timestamp; // mantém o timestamp antigo por enquanto
                                    
                                    triggerBackgroundUpdate();
                                    return state.data;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Erro ao ler KV:", e.message);
                }
            }

            if (isCron) {
                console.log('📥 [IDs] KV vazio/expirado em CRON. Aguardando download completo síncrono para garantir notificações...');
                await triggerBackgroundUpdate();
                if (state.data) {
                    state.promise = null;
                    return state.data;
                }
            } else {
                console.log('📥 Cache KV vazio/expirado. Retornando conjuntos vazios imediatamente e atualizando no background para evitar bloqueios...');
                triggerBackgroundUpdate();
            }

            state.data = {
                movies: new Set(),
                series: new Set(),
                anime: new Set(),
                doramas: new Set()
            };
            state.timestamp = agora;
            state.promise = null;
            return state.data;
        } catch (error) {
            console.error("⚠️ Falha ao processar IDs:", error.name);
            axiomService.logError(error, { servico: "superflix-ids", etapa: "get-ids" }).catch(() => {});
            state.promise = null;
            
            // Retorna dados antigos (Stale) se tiver
            if (state.data) return state.data;
            
            return { movies: new Set(), series: new Set(), anime: new Set(), doramas: new Set() };
        }
    })();

    return state.promise;
}
// src/services/liveGamesService.js
// Serviço para buscar jogos ao vivo da nossa API (streambetter.lol)
import { getConfig } from './configService.js';
import { getRedisClient } from './redis-client.js';

// Inicializa o estado global na memória RAM do servidor para evitar timeouts de SSR
if (!globalThis._bf_games_state) {
    globalThis._bf_games_state = {
        gamesCache: null,
        cacheTimestamp: 0,
        currentFetchPromise: null,
        isUpdatingBackground: false,
    };
}
const state = globalThis._bf_games_state;
const SERVER_CACHE_TTL = 3 * 60 * 1000; // 3 minutos no servidor

const CACHE_KEY = "multicanaishd_live_games_cache";
const CLIENT_CACHE_TTL = 60 * 1000; // 1 minuto no cliente (sessionStorage)

/**
 * Busca todos os jogos da API com cache L1 resiliente em RAM no servidor
 * @returns {Promise<Array>} Lista de jogos
 */
export async function fetchAllGames() {
    const agora = Date.now();
    const isBrowser = typeof window !== "undefined" && typeof sessionStorage !== "undefined";

    // --- LÓGICA DO CLIENTE (BROWSER) ---
    if (isBrowser) {
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (agora - timestamp < CLIENT_CACHE_TTL) {
                    return data;
                }
            }
        } catch (e) {}
    }

    // --- LÓGICA DO SERVIDOR (SSR) - OTIMIZAÇÃO EXTREMA ---
    // 1. Se temos cache na memória e ele ainda é válido, retorna IMEDIATAMENTE (0ms)
    if (!isBrowser && state.gamesCache && (agora - state.cacheTimestamp < SERVER_CACHE_TTL)) {
        return state.gamesCache;
    }

    // 1.5. Se não temos cache em memória (Cold Start), tentar cache do Redis (L2)
    if (!isBrowser && !state.gamesCache) {
        try {
            const redis = await getRedisClient();
            if (redis) {
                const cached = await redis.get(CACHE_KEY);
                if (cached) {
                    const data = JSON.parse(cached);
                    state.gamesCache = data;
                    state.cacheTimestamp = agora;
                    return data;
                }
            }
        } catch (e) {
            console.error("Redis read error in liveGamesService:", e);
        }
    }

    // 2. Se o cache expirou mas ainda temos dados antigos, retorna os dados antigos e atualiza em background (SWR)
    if (!isBrowser && state.gamesCache) {
        if (!state.isUpdatingBackground) {
            state.isUpdatingBackground = true;
            console.log('📡 [LiveGamesService] Cache expirado. Disparando atualização de jogos em background...');
            (async () => {
                try {
                    const freshData = await executeFetchAllGames();
                    if (freshData && freshData.length > 0) {
                        state.gamesCache = freshData;
                        state.cacheTimestamp = Date.now();
                        console.log(`✅ [LiveGamesService] Cache de background atualizado: ${freshData.length} jogos.`);
                        
                        try {
                            const redis = await getRedisClient();
                            if (redis) {
                                await redis.set(CACHE_KEY, JSON.stringify(freshData), "EX", 180);
                            }
                        } catch (re) {}
                    }
                } catch (e) {
                    console.warn("⚠️ [LiveGamesService] Falha na atualização em background:", e.message);
                } finally {
                    state.isUpdatingBackground = false;
                }
            })();
        }
        return state.gamesCache;
    }

    // 3. Se não temos cache (Cold Start), ou se estamos no browser com cache expirado, buscamos com tempo limite curto
    if (!isBrowser && state.currentFetchPromise) {
        return state.currentFetchPromise;
    }

    const fetchPromise = executeFetchAllGames();
    
    if (!isBrowser) {
        state.currentFetchPromise = fetchPromise.then(async (data) => {
            if (data && data.length > 0) {
                state.gamesCache = data;
                state.cacheTimestamp = Date.now();
                
                try {
                    const redis = await getRedisClient();
                    if (redis) {
                        await redis.set(CACHE_KEY, JSON.stringify(data), "EX", 180);
                    }
                } catch (re) {}
            }
            return state.gamesCache || [];
        }).catch(err => {
            console.error("❌ [LiveGamesService] Falha crítica de busca inicial:", err.message);
            return state.gamesCache || [];
        }).finally(() => {
            state.currentFetchPromise = null;
        });
        return state.currentFetchPromise;
    }

    // Para o cliente, resolve diretamente
    try {
        const data = await fetchPromise;
        if (isBrowser && data && data.length > 0) {
            sessionStorage.setItem(
                CACHE_KEY,
                JSON.stringify({ data, timestamp: agora })
            );
        }
        return data;
    } catch (e) {
        return [];
    }
}

/**
 * Função interna para executar a chamada HTTP com timeouts estritos e proxies redundantes
 */
async function executeFetchAllGames() {
    try {
        const API_URL = await getConfig('SB_GAMES_API_URL', 'https://streambetter.lol/api/games');
        const busterUrl = `${API_URL}${API_URL.includes('?') ? '&' : '?'}t=${Date.now()}`;

        // A fonte agora libera CORS direto pra gente, então os proxies (codetabs/allorigins)
        // que existiam só pra contornar o bloqueio da API antiga saíram — eram latência e
        // pontos de falha extra sem função nenhuma.
        const FETCH_TIMEOUT = 4000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        let json;
        try {
            const response = await fetch(busterUrl, {
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            json = await response.json();
        } finally {
            clearTimeout(timeoutId);
        }

        if (!json || !(Array.isArray(json) || json.games || json.data)) return [];

        // Nossa API entrega { success, games: [...] }; o formato legado ({ data: [...] } ou
        // array cru) continua aceito para não quebrar um rollback de URL pelo painel.
        return Array.isArray(json) ? json : (json.games || json.data || []);
    } catch (error) {
        console.warn("[LiveGamesService] Falha ao consultar API de esportes:", error.message || error);
        return [];
    }
}

const normalizeTimestamp = (ts) => {
    if (!ts) return 0;
    const num = Number(ts);
    return num > 9999999999 ? Math.floor(num / 1000) : num;
};

// A API não manda mais `timer.end` (a fonte só informa o início). Sem isso, assumimos
// 2h30 de duração a partir do início — mesmo fallback já usado no recovery client-side,
// pra SSR e browser nunca discordarem sobre quando um jogo "acabou".
const DEFAULT_GAME_DURATION = 9000;

const resolveGameEnd = (startRaw, endRaw) => {
    const start = normalizeTimestamp(startRaw);
    const end = normalizeTimestamp(endRaw);
    if (end) return end;
    return start ? start + DEFAULT_GAME_DURATION : 0;
};

/**
 * Verifica se um jogo está ao vivo agora
 * @param {Object} game - Objeto do jogo
 * @returns {boolean} True se está ao vivo
 */
export function isGameLive(game) {
    const startRaw = game?.data?.timer?.start;
    if (!startRaw) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const start = normalizeTimestamp(startRaw);
    const end = resolveGameEnd(startRaw, game?.data?.timer?.end);

    return now >= start && now <= end;
}

/**
 * Busca apenas jogos ao vivo
 * @returns {Promise<Array>} Lista de jogos ao vivo
 */
export async function fetchLiveGames() {
    const games = await fetchAllGames();
    return games.filter(isGameLive);
}

/**
 * Verifica se um jogo é relevante para hoje (ao vivo, próximo ou acabou recentemente)
 * @param {Object} game - Objeto do jogo
 * @returns {boolean} True se é relevante
 */
export function isGameRelevantToday(game) {
    const startRaw = game?.data?.timer?.start;
    if (!startRaw) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const start = normalizeTimestamp(startRaw);
    const end = resolveGameEnd(startRaw, game?.data?.timer?.end);

    // AO VIVO: agora entre início e fim, sem tolerância — jogos encerrados somem na hora
    if (now >= start && now <= end) {
        return true;
    }

    // PRÓXIMOS: Começa hoje, mas ainda não começou
    if (now < start) {
        const gameDate = new Date(start * 1000).toLocaleDateString('en-CA');
        const todayDate = new Date().toLocaleDateString('en-CA');
        
        // Se for hoje, é relevante
        if (gameDate === todayDate) {
            return true;
        }
    }

    // ENCERRADOS: O usuário pediu para remover
    return false;
}

/**
 * Busca jogos relevantes do dia (ao vivo + próximos + recentes)
 * @returns {Promise<Array>} Lista de jogos relevantes
 */
export async function fetchTodayRelevantGames() {
    const games = await fetchAllGames();
    const filtered = games.filter(isGameRelevantToday);

    // Ordenação Master (Zero-Delay logic):
    // 1. Ao Vivo primeiro
    // 2. Próximos por ordem de chegada
    return filtered.sort((a, b) => {
        const aLive = isGameLive(a);
        const bLive = isGameLive(b);

        if (aLive && !bLive) return -1;
        if (!aLive && bLive) return 1;

        // Se ambos são do mesmo tipo (ambos ao vivo ou ambos próximos),
        // ordena pelo tempo de início
        return normalizeTimestamp(a.data?.timer?.start) - normalizeTimestamp(b.data?.timer?.start);
    });
}

/**
 * Busca todos os jogos disponíveis na fonte, sem filtrar por dia (ao vivo + futuros de qualquer data)
 * @returns {Promise<Array>} Lista de todos os jogos, ao vivo primeiro
 */
export async function fetchAllRelevantGames() {
    const games = await fetchAllGames();

    return [...games].sort((a, b) => {
        const aLive = isGameLive(a);
        const bLive = isGameLive(b);

        if (aLive && !bLive) return -1;
        if (!aLive && bLive) return 1;

        return normalizeTimestamp(a.data?.timer?.start) - normalizeTimestamp(b.data?.timer?.start);
    });
}

/**
 * Formata o tempo restante do jogo
 * @param {Object} game - Objeto do jogo
 * @returns {string} Tempo formatado (ex: "45'", "FINAL")
 */
export function getGameTimeStatus(game) {
    const startRaw = game?.data?.timer?.start;
    if (!startRaw) {
        return "";
    }

    const now = Math.floor(Date.now() / 1000);
    const start = normalizeTimestamp(startRaw);
    const end = resolveGameEnd(startRaw, game?.data?.timer?.end);

    if (now > end) {
        return "FINAL";
    }

    if (now < start) {
        const diff = Math.ceil((start - now) / 60);
        if (diff > 60) {
            const date = new Date(start * 1000);
            return date.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false,
                timeZone: 'America/Sao_Paulo'
            });
        }
        return `EM ${diff}MIN`;
    }

    // Jogo ao vivo - calcula minutos decorridos
    const elapsed = Math.floor((now - start) / 60);

    // Futebol tem 90 minutos + acréscimos
    if (elapsed <= 45) {
        return `${elapsed}'`;
    } else if (elapsed <= 60) {
        return "INTERVALO";
    } else if (elapsed <= 105) {
        return `${elapsed - 15}'`;
    } else {
        return `${elapsed - 15}+`;
    }
}

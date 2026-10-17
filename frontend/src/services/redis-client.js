import { fetchWithTimeout } from './fetch-util.js';
import { getEnv } from './env-adapter.js';
import { axiomService } from './axiom-service.js';

const isDev = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') || false;
const REDIS_TIMEOUT = isDev ? 5000 : 2500;

let config = null;
const l1Cache = new Map();
let circuitBrokenUntil = 0; // Timestamp de quando podemos tentar de novo

function getConfigs() {
    if (config?.url && config?.token) return config;
    const resolved = {
        url: getEnv('UPTASH_REDIS_URL_KV_REST_API_URL'),
        token: getEnv('UPTASH_REDIS_URL_KV_REST_API_TOKEN')
    };
    // Só cacheia se ambas as credenciais foram resolvidas com sucesso
    if (resolved.url && resolved.token) config = resolved;
    return resolved;
}

// Bypass global do Redis se a variável DISABLE_REDIS estiver ativa (cota esgotada).
// Precisa ser lida a cada chamada (não como const de módulo): no Cloudflare Workers
// o módulo é avaliado uma única vez quando a isolate sobe, antes de setRuntimeEnv()
// injetar as env vars da requisição — uma const aqui sempre veria o valor "vazio".
function isRedisDisabled() {
    return getEnv('DISABLE_REDIS') === 'true' || getEnv('DISABLE_REDIS') === '1';
}

function isCircuitBroken() {
    return isRedisDisabled() || Date.now() < circuitBrokenUntil;
}

function breakCircuit() {
    // 3 minutes: recovery time reduced from 10min to avoid extended periods without cache.
    // 3 minutos: tempo de recuperação reduzido de 10min para evitar longos períodos sem cache.
    const recoveryMs = 3 * 60 * 1000;
    circuitBrokenUntil = Date.now() + recoveryMs;
    const recoveryTime = new Date(circuitBrokenUntil).toLocaleTimeString('pt-BR');
    console.error(`🚨 [Redis] Cota esgotada ou falha crítica! Desativando Redis por 3 minutos. Recuperação prevista: ${recoveryTime}.`);
    axiomService.logError(new Error("Redis circuit breaker aberto"), { servico: "redis-client", recoveryTime }).catch(() => {});
}

/**
 * Auxiliar genérico para executar comandos no Upstash com detecção proativa de erro/limite
 */
async function executeCommand(commandArrayOrPath, isPath = false) {
    if (isCircuitBroken()) return null;
    const { url, token } = getConfigs();
    if (!url || !token) return null;

    try {
        const fetchUrl = isPath ? `${url}${commandArrayOrPath}` : url;
        const fetchOptions = {
            method: isPath ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${token}` },
            timeout: REDIS_TIMEOUT,
            silent: true
        };
        if (!isPath) {
            fetchOptions.body = JSON.stringify(commandArrayOrPath);
        }

        const res = await fetchWithTimeout(fetchUrl, fetchOptions);
        
        // Detecção proativa de limite de requisições / cota esgotada (403 ou 429)
        if (res.status === 403 || res.status === 429) {
            breakCircuit();
            return null;
        }

        const text = await res.text();
        if (!res.ok || text.includes('limit exceeded') || text.includes('quota') || text.includes('forbidden')) {
            breakCircuit();
            return null;
        }

        try {
            const data = JSON.parse(text);
            if (data.error?.includes('limit exceeded') || data.error?.includes('quota')) {
                breakCircuit();
                return null;
            }
            return data;
        } catch (parseError) {
            // Se o status da requisição é bom mas não retornou JSON, retorna null sem quebrar
            return null;
        }
    } catch (e) {
        // Erro de rede ou timeout: não necessariamente esgotado, mas não queremos travar o app
        return null;
    }
}

export async function getRedisClient() {
    const { url, token } = getConfigs();
    if (!url || !token) return null;

    return {
        status: 'ready',
        get: async (key) => {
            if (isCircuitBroken()) return null;
            const local = l1Cache.get(key);
            if (local && local.expires > Date.now()) return local.value;

            const data = await executeCommand(`/get/${key}`, true);
            const value = data?.result;

            if (value) {
                l1Cache.set(key, { value, expires: Date.now() + (5 * 60 * 1000) });
            }
            return value;
        },
        mget: async (keys) => {
            if (isCircuitBroken()) return keys.map(() => null);
            if (!keys || keys.length === 0) return [];
            
            const results = keys.map(k => {
                const local = l1Cache.get(k);
                return (local && local.expires > Date.now()) ? local.value : null;
            });

            if (results.every(r => r !== null)) return results;

            const data = await executeCommand(["mget", ...keys]);
            const values = data?.result || [];
            
            values.forEach((val, i) => {
                if (val) l1Cache.set(keys[i], { value: val, expires: Date.now() + (5 * 60 * 1000) });
            });
            
            return values;
        },
        set: async (key, value, mode, ttl) => {
            if (isCircuitBroken()) return null;
            if (ttl) l1Cache.set(key, { value, expires: Date.now() + (ttl * 1000) });
            
            const command = ["set", key, value];
            if (mode === "EX") command.push("EX", ttl);
            
            const data = await executeCommand(command);
            return data ? 'OK' : null;
        },
        lpush: async (key, value) => {
            if (isCircuitBroken()) return null;
            const data = await executeCommand(["lpush", key, value]);
            return data?.result;
        },
        lrange: async (key, start, stop) => {
            if (isCircuitBroken()) return [];
            const cacheKey = `lrange:${key}:${start}:${stop}`;
            const local = l1Cache.get(cacheKey);
            if (local && local.expires > Date.now()) return local.value;

            const data = await executeCommand(["lrange", key, start, stop]);
            const result = data?.result || [];
            l1Cache.set(cacheKey, { value: result, expires: Date.now() + (30 * 1000) });
            return result;
        },
        ltrim: async (key, start, stop) => {
            if (isCircuitBroken()) return null;
            const data = await executeCommand(["ltrim", key, start, stop]);
            return data ? 'OK' : null;
        },
        lrem: async (key, count, value) => {
            if (isCircuitBroken()) return null;
            const data = await executeCommand(["lrem", key, count, value]);
            return data?.result;
        },
        scan: async (cursor, pattern, count) => {
            if (isCircuitBroken()) return ["0", []];
            const data = await executeCommand(["scan", cursor, "MATCH", pattern, "COUNT", count]);
            return data?.result || ["0", []];
        },
        hget: async (key, field) => {
            if (isCircuitBroken()) return null;
            const data = await executeCommand(["hget", key, field]);
            return data?.result;
        },
        hset: async (key, fieldValues) => {
            if (isCircuitBroken()) return null;
            const command = ["hset", key];
            for (const [f, v] of Object.entries(fieldValues)) {
                command.push(f, v);
            }
            const data = await executeCommand(command);
            return data?.result;
        },
        del: async (key) => {
            if (isCircuitBroken()) return null;
            l1Cache.delete(key);
            const data = await executeCommand(["del", key]);
            return data?.result;
        },
        expire: async (key, seconds) => {
            if (isCircuitBroken()) return null;
            const data = await executeCommand(["expire", key, seconds]);
            return data?.result;
        },
        hkeys: async (key) => {
            if (isCircuitBroken()) return [];
            const data = await executeCommand(["hkeys", key]);
            return data?.result || [];
        },
        hmget: async (key, fields) => {
            if (isCircuitBroken()) return [];
            const data = await executeCommand(["hmget", key, ...fields]);
            return data?.result || [];
        },
        quit: async () => {} 
    };
}


// src/services/configService.js
import { getEnv } from './env-adapter.js';

// KV do Cloudflare (mesmo binding 'SESSION' usado em superflix-ids.js/sitemap.xml.js/calendario.js).
// Antes usava Redis (Upstash), mas com a cota do Redis esgotada o toggle de config (ex: AD_PROVIDER)
// não persistia de forma confiável entre isolates/cold starts — KV resolve isso sem depender de cota externa.
const SYSTEM_CONFIG_KV_KEY = 'system_config';

// Cache em memória persistente (Node-level)
if (!globalThis._bf_system_config) {
    globalThis._bf_system_config = {
        data: {},
        lastFetch: 0,
        nextAttemptAt: 0
    };
}
const state = globalThis._bf_system_config;

// 60s (era 10s). getConfig roda no BaseLayout, ou seja, em TODA página do site, e o custo
// real é uma leitura de KV a cada TTL por isolate — com muitos isolates isso virava uma
// fatia grande das leituras diárias de KV, para um blob que muda quando alguém mexe no
// /moderacao (dias ou semanas). O preço é o toggle do painel levar até 1min pra propagar
// nos isolates já aquecidos; o próprio painel não sofre, ele lê com force (ver getAllConfigs).
const CONFIG_CACHE_TTL = 60000;

// Recuo após falha de KV. Sem isto, `lastFetch` só era atualizado no caminho de sucesso,
// então enquanto o KV estivesse lento ou fora TODA chamada de getConfig tentava de novo,
// sem espera nenhuma: o volume de leitura subia justamente quando o KV estava pior.
const KV_FAILURE_BACKOFF_MS = 5000;

// Teto curto pra leitura/escrita do KV: essa função roda no caminho de renderização de
// quase toda página, então uma KV lenta não pode segurar o SSR indefinidamente (503).
const KV_TIMEOUT_MS = Number(getEnv("CONFIG_KV_TIMEOUT_MS", "500"));

// Escrita (setConfig) NÃO roda no caminho de renderização — só no /moderacao, sob ação
// explícita do admin. Um `kv.put` do Cloudflare custa bem mais que um `get` (propagação
// global, sem cache de borda), e passa de 500ms com frequência: com o teto do SSR o painel
// mostrava "Timeout escrevendo no KV" mesmo quando a gravação ia se completar. Aqui o que
// importa é confirmar a persistência, não a latência, então o orçamento é folgado.
const KV_WRITE_TIMEOUT_MS = Number(getEnv("CONFIG_KV_WRITE_TIMEOUT_MS", "10000"));
// Cache do colo da Cloudflare: o TTL de 60s acima é por isolate, e são muitos isolates. O
// cache do colo é compartilhado dentro do datacenter, então cobre justamente o que o TTL em
// RAM não cobre. Mesmo teto de 60s pra não atrasar mais a propagação do toggle do painel —
// que lê com force e não passa por este caminho.
const KV_CACHE_TTL_S = 60;
const KV_TIMEOUT = Symbol('kv-timeout');
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(KV_TIMEOUT), ms))
    ]);
}

// Valores Hardcoded (Fallbacks Seguros)
const CONFIG_DEFAULTS = {
    'SOURCE_S1_URL': 'https://superflixapi.pro',
    // Nossa API (streambetter.lol) — fonte oficial de canais de TV, jogos ao vivo e EPG.
    'SB_CHANNELS_API_URL': 'https://streambetter.lol/api/channels',
    'SB_GAMES_API_URL': 'https://streambetter.lol/api/games',
    'SB_EPG_API_URL': 'https://streambetter.lol/api/epg',
    'SUPERFLIX_DOMAINS': 'https://superflixapi.pro,https://superflixapi.online,https://superflixapi.buzz,https://superflixapi.asia',
    'AD_PROVIDER': 'adsterra',
    // Base da função Supabase (redetoons.lol trocou de site próprio pra Supabase Edge
    // Functions — a API antiga em redetoons.cards/api/player foi desativada).
    'DIRECT_DOWNLOAD_BASE_URL': 'https://xgkkldquttqobprpjghc.supabase.co/functions/v1',
    // Header Origin exigido pela Edge Function da redetoons (allow-list de origem). O site
    // deles já migrou de domínio antes (era redetoons.lol) — se rotacionarem de novo, dá pra
    // atualizar aqui sem precisar de deploy.
    'DIRECT_DOWNLOAD_ORIGIN': 'https://redetoons.cc',
    // JSON stringified: { embed: { priceCents, startsAt, endsAt } | null, direct: { ... } | null }
    'B2B_PROMO': '{}',
    // Consumido pelo BaseLayout em TODA página. Ficou fora daqui por meses e isso, somado ao
    // getAllConfigs que ignorava o TTL, fazia cada render pagar uma leitura de KV: uma chave
    // ausente de CONFIG_DEFAULTS nunca entra em state.data, então o cache em RAM nunca
    // acertava e o passo 2 ia ao KV sempre. Toda chave lida por getConfig PRECISA estar aqui.
    'AD_SOCIAL_BAR': 'on',
    // Liga/desliga da auto-rotação disparada pelo detector de 451 (dmcaWatchService.js).
    // Precisa estar aqui: getAllConfigs() só devolve chaves listadas neste objeto, então uma
    // chave gravada no KV sem entrar nesta lista nunca chegaria ao getConfig — o toggle do
    // painel salvaria e nada mudaria no cron.
    'DMCA_AUTO_ROTATE': 'on'
};

// A tabela de provedores vive em adSettings.js (dados puros, importáveis também no
// cliente). Re-exportada aqui pra não quebrar quem já importa daqui — são 11 arquivos.
import { AD_SETTINGS, AD_PROVIDERS, normalizeAdProvider, getAdSettings as resolveAdSettings, PERSISTENT_ADS } from './adSettings.js';

export { AD_SETTINGS, AD_PROVIDERS, normalizeAdProvider, PERSISTENT_ADS };

export function getAdSettings(provider = null) {
    return resolveAdSettings(provider, CONFIG_DEFAULTS.AD_PROVIDER);
}

/**
 * Recupera uma configuração do sistema com cache de alto desempenho.
 */
export async function getConfig(key, defaultValue = null) {
    const fallback = defaultValue || getEnv(key) || CONFIG_DEFAULTS[key] || '';

    // 1. Tenta Memória (Acesso ultra-rápido)
    // `in` e não truthiness: valor legítimo porém falsy ('' ou '0') caía fora do cache e
    // mandava a requisição pro KV, o mesmo furo que a chave ausente causava.
    const agora = Date.now();
    if ((key in state.data) && (agora - state.lastFetch < CONFIG_CACHE_TTL)) {
        return state.data[key];
    }

    // 2. Tenta KV (busca em lote — todos os configs ficam num único blob)
    try {
        const all = await getAllConfigs();
        if (all && (key in all)) return all[key];
    } catch (e) {
        // Silencioso por padrão para evitar ruído no SSR
    }

    // 3. Fallback Seguro
    return fallback;
}

/**
 * Recupera múltiplas configurações de uma vez (Otimizado)
 */
export async function getAllConfigs({ force = false } = {}) {
    const keys = Object.keys(CONFIG_DEFAULTS);
    const temCache = Object.keys(state.data).length > 0;

    // O TTL vivia só no getConfig, e o caminho que mais importa (chave que o cache em RAM não
    // cobria) entrava por aqui direto — logo, leitura de KV por requisição. O freio tem que
    // estar na função que fala com o KV, não só em quem a chama.
    if (!force && temCache && (Date.now() - state.lastFetch < CONFIG_CACHE_TTL)) {
        return state.data;
    }

    // `force` existe para o painel /moderacao: ele precisa mostrar o estado real do KV,
    // nunca uma cópia em RAM — senão o admin salva um toggle, a tela recarrega, cai num
    // isolate com cache velho e parece que a gravação falhou.
    // O recuo NÃO depende de haver cache: o pior caso é justamente isolate novo com o KV
    // fora, quando não há cópia em RAM nenhuma e cada requisição tentaria uma leitura.
    // Sem dado bom conhecido servimos os defaults, que é o que a falha devolveria de todo jeito.
    if (!force && Date.now() < (state.nextAttemptAt || 0)) {
        return temCache ? state.data : CONFIG_DEFAULTS;
    }

    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function') return CONFIG_DEFAULTS;

    try {
        const raw = await withTimeout(kv.get(SYSTEM_CONFIG_KV_KEY, { cacheTtl: KV_CACHE_TTL_S }), KV_TIMEOUT_MS);
        if (raw === KV_TIMEOUT) {
            state.nextAttemptAt = Date.now() + KV_FAILURE_BACKOFF_MS;
            return temCache ? state.data : CONFIG_DEFAULTS;
        }

        const stored = raw ? JSON.parse(raw) : {};
        const result = {};

        keys.forEach((key) => {
            result[key] = stored[key] || CONFIG_DEFAULTS[key];
            state.data[key] = result[key];
        });

        state.lastFetch = Date.now();
        state.nextAttemptAt = 0;
        return result;
    } catch (e) {
        state.nextAttemptAt = Date.now() + KV_FAILURE_BACKOFF_MS;
        return temCache ? state.data : CONFIG_DEFAULTS;
    }
}

/**
 * Atualiza uma configuração (Admin Only no API level).
 * Retorna `true` apenas se a escrita no KV foi confirmada — o painel /moderacao depende
 * disso para não mostrar sucesso quando o toggle na verdade não persistiu.
 */
export async function setConfig(key, value) {
    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
        const message = `KV indisponível — não foi possível salvar ${key}.`;
        console.error(`[ConfigService] ${message}`);
        return { success: false, message };
    }

    try {
        const raw = await withTimeout(kv.get(SYSTEM_CONFIG_KV_KEY), KV_WRITE_TIMEOUT_MS);
        if (raw === KV_TIMEOUT) {
            const message = `Timeout lendo KV — não foi possível salvar ${key}.`;
            console.error(`[ConfigService] ${message}`);
            return { success: false, message };
        }
        const stored = raw ? JSON.parse(raw) : {};
        stored[key] = value;

        const putResult = await withTimeout(kv.put(SYSTEM_CONFIG_KV_KEY, JSON.stringify(stored)), KV_WRITE_TIMEOUT_MS);
        if (putResult === KV_TIMEOUT) {
            // A escrita pode ainda se completar no KV; por isso "não confirmada" e não "não salvou".
            const message = `Timeout escrevendo no KV — gravação de ${key} não confirmada. Recarregue o painel antes de tentar de novo.`;
            console.error(`[ConfigService] ${message}`);
            return { success: false, message };
        }

        state.data[key] = value;
        state.lastFetch = Date.now();
        state.nextAttemptAt = 0; // gravação confirmada: some qualquer recuo pendente
        return { success: true };
    } catch (e) {
        console.error(`[ConfigService] Erro ao salvar ${key}:`, e.message);
        return { success: false, message: e.message };
    }
}


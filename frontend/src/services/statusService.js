// src/services/statusService.js
import { supabase } from './supabase.js';
import { getEnv } from './env-adapter.js';
import { getShopUrl } from './streamEmbedService.js';

// KV do Cloudflare (mesmo binding 'SESSION' usado em configService.js/superflix-ids.js/sitemap.xml.js).
// serviceHistory/downtimeSince precisam sobreviver entre isolates/cold starts do Worker — o cron do
// GitHub Actions chama o endpoint a cada 5min e cada chamada pode cair num isolate novo, então guardar
// isso só em globalThis fazia o alerta nunca disparar (sempre virava "primeira execução"). Redis está
// com cota esgotada, então usamos KV em vez dele.
const STATUS_HISTORY_KV_KEY = 'status_service_history';
const KV_TIMEOUT_MS = Number(getEnv("STATUS_KV_TIMEOUT_MS", "800"));
const KV_TIMEOUT = Symbol('kv-timeout');
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(KV_TIMEOUT), ms))
    ]);
}

// Inicializa o estado na memória como cache L1 rápido (evita ler o KV a cada requisição dentro do mesmo isolate)
if (!globalThis._bf_status_state) {
    globalThis._bf_status_state = {
        lastResults: null,
        lastFetch: 0,
        serviceHistory: {}, // Salva o último estado conhecido de cada serviço para notificar apenas em mudanças
        downtimeSince: {}, // Timestamp de quando cada serviço caiu, para calcular a duração no aviso de recuperação
        historyLoaded: false, // Se já buscamos o histórico persistido do KV neste isolate
        lastPersistedPayload: null, // Último payload gravado no KV, para não regravar quando nada mudou
    };
}
const state = globalThis._bf_status_state;
const CACHE_TTL = 60000; // Cache de 60 segundos

// Timeout para cada fetch de ping
const PING_TIMEOUT = 3000;

// Nomes amigáveis exibidos em /status, reaproveitados aqui para os alertas do Discord
// em vez da chave interna crua (ex: "fembed" -> "Player Secundário").
const SERVICE_DISPLAY_NAMES = {
    supabase: 'Banco de Dados',
    tmdb: 'API de Metadados',
    streambetter: 'Player de Streaming',
    canais: 'API de Canais e Jogos',
};

async function loadPersistedHistory() {
    if (state.historyLoaded) return;
    state.historyLoaded = true; // marca antes de esperar pra não disparar leituras concorrentes no mesmo isolate

    const kv = getEnv('SESSION');
    if (!kv || typeof kv.get !== 'function') return;

    try {
        const raw = await withTimeout(kv.get(STATUS_HISTORY_KV_KEY), KV_TIMEOUT_MS);
        if (raw === KV_TIMEOUT || !raw) return;

        const stored = JSON.parse(raw);
        state.serviceHistory = stored.serviceHistory || {};
        state.downtimeSince = stored.downtimeSince || {};
        state.lastPersistedPayload = raw;
    } catch (e) {
        // Silencioso: sem histórico persistido ainda, segue com o estado vazio
    }
}

async function persistHistory() {
    const kv = getEnv('SESSION');
    if (!kv || typeof kv.put !== 'function') return;

    const payload = JSON.stringify({
        serviceHistory: state.serviceHistory,
        downtimeSince: state.downtimeSince
    });

    // Evita gastar a cota de escrita do KV (limite diário baixo no plano free) quando
    // nada mudou desde a última persistência — a checagem roda a cada 5min via cron,
    // mas o status dos serviços normalmente fica estável por horas.
    if (payload === state.lastPersistedPayload) return;

    try {
        await withTimeout(kv.put(STATUS_HISTORY_KV_KEY, payload), KV_TIMEOUT_MS);
        state.lastPersistedPayload = payload;
    } catch (e) {
        // Silencioso: falha ao persistir não deve derrubar a checagem de status
    }
}

async function pingUrl(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const start = performance.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal,
            ...options
        });
        clearTimeout(id);
        const duration = Math.round(performance.now() - start);
        return {
            status: response.ok ? 'online' : 'instavel',
            latency: duration,
            statusCode: response.status
        };
    } catch (e) {
        clearTimeout(id);
        const duration = Math.round(performance.now() - start);
        return {
            status: 'offline',
            latency: duration,
            error: e.message || 'Timeout'
        };
    }
}

// Formata uma duração em ms para um texto legível (ex: "2h 5min", "45s")
function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}min`);
    if (hours === 0 && seconds > 0) parts.push(`${seconds}s`);

    return parts.length > 0 ? parts.join(' ') : '0s';
}

async function sendDiscordWebhook(serviceName, oldStatus, newStatus, latency, detail = '', downtimeMs = null) {
    const webhookUrl = getEnv('DISCORD_STATUS_WEBHOOK_URL');
    if (!webhookUrl) return;

    // Tradução simples de status para ícones
    const statusMap = {
        'online': '🟢 Online',
        'instavel': '🟡 Instável',
        'offline': '🔴 Offline'
    };

    const oldLabel = statusMap[oldStatus] || 'Desconhecido';
    const newLabel = statusMap[newStatus] || 'Desconhecido';

    let color = 0x22c55e; // Verde
    if (newStatus === 'offline') color = 0xef4444; // Vermelho
    if (newStatus === 'instavel') color = 0xeab308; // Amarelo

    const isRecovery = newStatus === 'online' && oldStatus !== 'online';

    const embed = {
        title: isRecovery ? `✅ Serviço Recuperado: ${serviceName}` : `🚨 Alerta de Status: ${serviceName}`,
        description: isRecovery ? `O serviço voltou a operar normalmente.` : `O status do serviço foi alterado.`,
        color: color,
        fields: [
            { name: 'Status Anterior', value: oldLabel, inline: true },
            { name: 'Novo Status', value: newLabel, inline: true },
            { name: 'Latência', value: `${latency}ms`, inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'MultiCanaisHD Monitoramento' }
    };

    if (isRecovery && downtimeMs != null) {
        embed.fields.push({ name: 'Tempo Fora do Ar', value: formatDuration(downtimeMs), inline: true });
    }

    if (detail) {
        embed.fields.push({ name: 'Detalhe/Erro', value: detail, inline: false });
    }

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (err) {
        console.error(`[StatusService] Falha ao enviar alerta para o Discord:`, err.message);
    }
}

export async function checkSystemStatus(force = false) {
    const agora = Date.now();
    
    // Retorna cache L1 se ainda estiver dentro do TTL
    if (!force && state.lastResults && (agora - state.lastFetch < CACHE_TTL)) {
        return state.lastResults;
    }

    await loadPersistedHistory();

    const testPromises = {
        supabase: (async () => {
            const start = performance.now();
            try {
                // Ping ultra rápido no banco
                const { error } = await supabase.from('profiles').select('count', { count: 'exact', head: true });
                const duration = Math.round(performance.now() - start);
                if (error) throw error;
                return { status: 'online', latency: duration };
            } catch (err) {
                const duration = Math.round(performance.now() - start);
                return { status: 'offline', latency: duration, error: err.message };
            }
        })(),

        tmdb: (async () => {
            const apiKey = getEnv('KEY_API_TMDB') || getEnv('TMDB_API_KEY');
            if (!apiKey) return { status: 'instavel', latency: 0, error: 'Chave TMDB ausente no servidor' };
            
            return pingUrl('https://api.themoviedb.org/3/configuration', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
        })(),

        streambetter: pingUrl(getShopUrl()),

        canais: pingUrl(`${getShopUrl()}/api/games`)
    };

    const keys = Object.keys(testPromises);
    const resolvedResults = await Promise.allSettled(keys.map(k => testPromises[k]));

    const results = {};
    const alertPromises = [];

    keys.forEach((key, idx) => {
        const res = resolvedResults[idx];
        let val = { status: 'offline', latency: 0, error: 'Erro inesperado na thread' };
        
        if (res.status === 'fulfilled') {
            val = res.value;
        } else {
            val.error = res.reason?.message || 'Rejeitado';
        }

        results[key] = val;

        // Lógica de alerta baseada em mudança de estado
        const lastKnown = state.serviceHistory[key];
        const current = val.status;

        if (lastKnown && lastKnown !== current) {
            const isRecovery = current === 'online' && lastKnown !== 'online';
            const downtimeMs = isRecovery && state.downtimeSince[key] ? (agora - state.downtimeSince[key]) : null;

            // Dispara alertas no Discord em background
            alertPromises.push(
                sendDiscordWebhook(
                    SERVICE_DISPLAY_NAMES[key] || key.toUpperCase(),
                    lastKnown,
                    current,
                    val.latency,
                    val.error || '',
                    downtimeMs
                )
            );
        }

        // Marca o início da queda para calcular a duração quando o serviço voltar
        if (current !== 'online') {
            if (!state.downtimeSince[key]) state.downtimeSince[key] = agora;
        } else {
            delete state.downtimeSince[key];
        }

        // Salva estado para a próxima comparação
        state.serviceHistory[key] = current;
    });

    // Se é a primeira execução, inicializa o histórico sem alertar para evitar falsos alertas no boot
    if (Object.keys(state.serviceHistory).length === 0) {
        keys.forEach(k => {
            state.serviceHistory[k] = results[k].status;
        });
    }

    if (alertPromises.length > 0) {
        // Roda alertas em background
        Promise.all(alertPromises).catch(err => {
            console.error('[StatusService] Erro ao disparar alertas no Discord:', err);
        });
    }

    // Persiste o histórico no KV para sobreviver ao próximo isolate (não bloqueia a resposta)
    persistHistory().catch(() => {});

    state.lastResults = results;
    state.lastFetch = agora;

    return results;
}

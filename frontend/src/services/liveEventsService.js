// src/services/liveEventsService.js
// Eventos ao vivo cadastrados na StreamBetter (live_items, kind = 'event'): lutas, shows,
// transmissões especiais. Diferente dos jogos, não vêm de fonte externa — é conteúdo nosso.
import { getShopUrl } from './streamEmbedService.js';

// Só cache L1 em RAM (sem Redis/KV): a lista é minúscula, a API já filtra o que encerrou
// e 3 min de defasagem num evento cadastrado à mão não machuca ninguém.
if (!globalThis._bf_events_state) {
    globalThis._bf_events_state = { cache: null, timestamp: 0, inflight: null };
}
const state = globalThis._bf_events_state;
const CACHE_TTL = 3 * 60 * 1000;
const FETCH_TIMEOUT = 3500;
// Sem término cadastrado, a API esconde o evento 3h depois do início; replicamos aqui
// para o cache não segurar um evento que já saiu da lista.
const EVENT_WINDOW_MS = 3 * 60 * 60 * 1000;

async function executeFetch() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        const res = await fetch(`${getShopUrl()}/api/events`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return Array.isArray(json?.events) ? json.events : [];
    } finally {
        clearTimeout(timeoutId);
    }
}

export function isEventActive(event, now = Date.now()) {
    if (!event?.starts_at) return true;
    const start = new Date(event.starts_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(event.starts_at) ? '' : 'Z')).getTime();
    if (!start) return true;
    return now <= start + EVENT_WINDOW_MS;
}

/** Eventos ao vivo/próximos, na ordem da API (início crescente). Nunca lança. */
export async function fetchLiveEvents() {
    const now = Date.now();
    if (state.cache && now - state.timestamp < CACHE_TTL) {
        return state.cache.filter((e) => isEventActive(e, now));
    }
    if (!state.inflight) {
        state.inflight = executeFetch()
            .then((events) => {
                state.cache = events;
                state.timestamp = Date.now();
                return events;
            })
            .catch((e) => {
                console.warn('[LiveEventsService] Falha ao consultar eventos:', e.message || e);
                return state.cache || [];
            })
            .finally(() => { state.inflight = null; });
    }
    const events = await state.inflight;
    return events.filter((e) => isEventActive(e, Date.now()));
}

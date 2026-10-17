// src/services/directDownloadService.js
import { fetchWithTimeout } from "./fetch-util.js";
import { axiomService } from "./axiom-service.js";
import { getConfig } from "./configService.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — metadados do filme raramente mudam

if (!globalThis._bf_direct_download_cache) {
    globalThis._bf_direct_download_cache = new Map();
}
const cache = globalThis._bf_direct_download_cache;

// A API da redetoons bloqueia requisições sem User-Agent de navegador (retorna {"error":"ua_blocked"}
// com status 200). O fetch padrão do Cloudflare Worker não manda um UA de browser, então precisamos
// forjar um pra não cair sempre em found:false.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// A redetoons migrou de API própria (redetoons.cards/api/player) pra uma Supabase Edge
// Function servida em redetoons.lol. O endpoint exige a mesma apikey (anon key pública do
// projeto Supabase deles) e o header x-rt-client que o front-end deles manda — sem os dois
// a função devolve 403 antes de sequer olhar o tmdbId. Ambos vêm do bundle JS público do
// site (não são segredo deles, são enviados a todo visitante), mas quebram sem aviso se a
// redetoons rotacionar a key ou o client id — não tem forma de evitar isso, só reagir.
const REDETOONS_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhna2tsZHF1dHRxb2JwcnBqZ2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzMwMjYsImV4cCI6MjEwMDcwOTAyNn0.U7KpckNTtQ0bl68YFn-Awm3zOefR5gxL2OScdsZfRIs";
const REDETOONS_CLIENT_HEADER = "rt-web-2026";

async function buildDownloadHeaders() {
    const origin = await getConfig('DIRECT_DOWNLOAD_ORIGIN');
    return {
        "User-Agent": BROWSER_UA,
        "apikey": REDETOONS_ANON_KEY,
        "x-rt-client": REDETOONS_CLIENT_HEADER,
        "Origin": origin
    };
}

// O filename devolvido pela redetoons vem com a marca deles embutida (ex:
// "Homem.de.Ferro.redetoons.mp4"). TorrentModal.astro usa esse título pra montar o nome do
// arquivo final ("... by MultiCanaisHD.mp4") — sem isso, o download saía com "redetoons" no nome.
function stripRedetoonsBranding(filename) {
    if (!filename) return "";
    return filename.replace(/\.mp4$/i, "").replace(/redetoons/gi, "").replace(/\.+$/, "").trim();
}

/**
 * Chama get-download-link. Resposta de sucesso: {url, filename, expiresAt}.
 * Resposta de falha (não encontrado, tipo inválido etc.): {error} com status 4xx.
 */
async function fetchDownloadLink({ tmdbId, type, season, episode }) {
    const baseUrl = await getConfig('DIRECT_DOWNLOAD_BASE_URL');
    const url = new URL(`${baseUrl}/get-download-link`);
    url.searchParams.set('tmdbId', tmdbId);
    url.searchParams.set('type', type);
    if (type === 'tv') {
        url.searchParams.set('season', String(season));
        url.searchParams.set('episode', String(episode));
    }

    const res = await fetchWithTimeout(url.toString(), { timeout: 6000, silent: true, headers: await buildDownloadHeaders() });
    if (!res.ok) return null;

    const json = await res.json();
    if (json?.error || !json?.url) return null;

    return { streamUrl: json.url, title: stripRedetoonsBranding(json.filename) };
}

/**
 * Busca o link de download direto (.mp4) para um filme via API externa redetoons.
 * @param {string} tmdbId
 * @returns {Promise<{found: boolean, streamUrl?: string, title?: string}>}
 */
export async function getDirectDownloadForMovie(tmdbId) {
    if (!tmdbId) return { found: false };

    const cached = cache.get(tmdbId);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const link = await fetchDownloadLink({ tmdbId, type: 'movie' });
        const data = link ? { found: true, ...link } : { found: false };
        cache.set(tmdbId, { ts: Date.now(), data });
        return data;
    } catch (error) {
        axiomService.logError(error, { servico: "directDownloadService", etapa: "get-direct-download" }).catch(() => {});
        return { found: false };
    }
}

if (!globalThis._bf_direct_download_series_cache) {
    globalThis._bf_direct_download_series_cache = new Map();
}
const seriesCache = globalThis._bf_direct_download_series_cache;

/**
 * Busca o link de download direto (.mp4) para um episódio de série via API externa redetoons.
 * Diferente da API antiga (que devolvia o mapa de episódios da série inteira numa chamada),
 * a Edge Function atual resolve um episódio por vez — cacheia por tmdbId+temporada+episódio.
 * @param {string} tmdbId
 * @param {string|number} season
 * @param {string|number} episode
 * @returns {Promise<{found: boolean, streamUrl?: string, title?: string}>}
 */
export async function getDirectDownloadForEpisode(tmdbId, season, episode) {
    if (!tmdbId || !season || !episode) return { found: false };

    const cacheKey = `${tmdbId}-${season}-${episode}`;
    const cached = seriesCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const link = await fetchDownloadLink({ tmdbId, type: 'tv', season, episode });
        const data = link ? { found: true, ...link } : { found: false };
        seriesCache.set(cacheKey, { ts: Date.now(), data });
        return data;
    } catch (error) {
        axiomService.logError(error, { servico: "directDownloadService", etapa: "get-direct-download-episode" }).catch(() => {});
        return { found: false };
    }
}

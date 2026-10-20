import { getEnv } from "../../services/env-adapter";
import { fetchWithTimeout } from "../../services/fetch-util.js";

// Cache em memória
let cacheData = null;
let cacheTimestamp = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutos

const SB_CALENDAR_URL = "https://streambetter.lol/api/calendario";
const MAX_PAGES = 3; // limite de páginas buscadas (100 itens cada) por segurança

async function fetchCalendarPage(page) {
    try {
        const url = `${SB_CALENDAR_URL}?page=${page}&limit=100`;
        const res = await fetchWithTimeout(url, { timeout: 12000, headers: { Accept: "application/json" } });
        if (!res.ok) return { releases: [], pagination: null };
        return await res.json();
    } catch (error) {
        console.error("Erro ao buscar página do calendário StreamBetter:", error);
        return { releases: [], pagination: null };
    }
}

async function fetchAllReleases() {
    const first = await fetchCalendarPage(1);
    const releases = [...(first.releases || [])];
    const totalPages = Math.min(first.pagination?.totalPages || 1, MAX_PAGES);

    if (totalPages > 1) {
        const pagePromises = [];
        for (let p = 2; p <= totalPages; p++) pagePromises.push(fetchCalendarPage(p));
        const rest = await Promise.all(pagePromises);
        rest.forEach((r) => releases.push(...(r.releases || [])));
    }
    return releases;
}

function mapRelease(item) {
    return {
        kind: item.kind,
        tmdb_id: item.tmdb_id,
        season: item.season_number,
        number: item.episode_number,
        title: item.release_title,
        episode_name: item.episode_title,
        poster_path: item.poster_path,
        air_date: item.air_date,
        hasLaunched: !!item.has_source,
    };
}

function tmdbHeaders(apiKey) {
    return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

async function fetchStillPathFallback(item, apiKey) {
    try {
        const urlEn = `https://api.themoviedb.org/3/tv/${item.tmdb_id}/season/${item.season}/episode/${item.number}?language=en-US`;
        const resEn = await fetch(urlEn, { headers: tmdbHeaders(apiKey) });
        if (!resEn.ok) return null;
        const detailsEn = await resEn.json();
        return detailsEn.still_path || null;
    } catch (error) {
        console.error("Erro ao resgatar still_path global:", error);
        return null;
    }
}

async function enrichEpisode(item, apiKey) {
    try {
        const urlPt = `https://api.themoviedb.org/3/tv/${item.tmdb_id}/season/${item.season}/episode/${item.number}?language=pt-BR`;
        const resPt = await fetch(urlPt, { headers: tmdbHeaders(apiKey) });
        if (!resPt.ok) return item;
        const details = await resPt.json();

        if (!details.still_path) {
            details.still_path = await fetchStillPathFallback(item, apiKey);
        }

        return {
            ...item,
            still_path: details.still_path,
            overview: details.overview,
            episode_name: details.name || item.episode_name,
            vote_average: details.vote_average,
        };
    } catch (error) {
        return item;
    }
}

async function enrichMovie(item, apiKey) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${item.tmdb_id}?language=pt-BR`;
        const res = await fetch(url, { headers: tmdbHeaders(apiKey) });
        if (!res.ok) return item;
        const details = await res.json();
        return {
            ...item,
            overview: details.overview,
            vote_average: details.vote_average,
            // Cards de filme usam formato paisagem (16:9): backdrop em vez do pôster vertical
            backdrop_path: details.backdrop_path ? `https://image.tmdb.org/t/p/w780${details.backdrop_path}` : null,
            poster_path: item.poster_path || (details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null),
        };
    } catch (error) {
        return item;
    }
}

function removeDuplicatas(lista) {
    const seen = new Set();
    return lista.filter((item) => {
        const key = item.kind === "movie" ? `movie-${item.tmdb_id}` : `${item.tmdb_id}-${item.season}-${item.number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

const ENRICH_LIMIT = 16;

async function enrichTop(lista, apiKey) {
    const top = lista.slice(0, ENRICH_LIMIT);
    const resto = lista.slice(ENRICH_LIMIT);
    const enriquecidos = await Promise.all(
        top.map((item) => (item.kind === "movie" ? enrichMovie(item, apiKey) : enrichEpisode(item, apiKey)))
    );
    return [...enriquecidos, ...resto];
}

function splitByDate(items) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const listaHoje = [];
    const listaProximos = [];
    items.forEach((item) => {
        const airDate = new Date(item.air_date + "T00:00:00");
        if (airDate.toDateString() === hoje.toDateString()) listaHoje.push(item);
        else if (airDate > hoje) listaProximos.push(item);
    });

    const porData = (a, b) => new Date(a.air_date) - new Date(b.air_date);
    return {
        hoje: removeDuplicatas(listaHoje).sort(porData),
        proximos: removeDuplicatas(listaProximos).sort(porData),
    };
}

async function buildCalendario() {
    const rawReleases = await fetchAllReleases();
    const items = rawReleases.map(mapRelease);
    const { hoje, proximos } = splitByDate(items);

    const apiKey = getEnv("KEY_API_TMDB") || getEnv("TMDB_API_KEY");
    const calendario = { hoje, proximos, total: 0 };

    if (apiKey) {
        calendario.hoje = await enrichTop(hoje, apiKey);
        calendario.proximos = await enrichTop(proximos, apiKey);
    }

    calendario.proximos.sort((a, b) => new Date(a.air_date) - new Date(b.air_date));
    calendario.total = calendario.hoje.length + calendario.proximos.length;
    return calendario;
}

export async function GET() {
    const now = Date.now();
    if (cacheData && cacheTimestamp && now - cacheTimestamp < CACHE_DURATION) {
        return new Response(JSON.stringify(cacheData), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", "X-Cache-Status": "HIT" },
        });
    }

    try {
        const calendario = await buildCalendario();
        cacheData = calendario;
        cacheTimestamp = now;

        return new Response(JSON.stringify(calendario), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
                "X-Cache-Status": "MISS",
            },
        });
    } catch (error) {
        console.error("❌ ERRO API Calendário:", error);
        if (cacheData) {
            return new Response(JSON.stringify({ ...cacheData, erro: "Dados em cache (Fallback)" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({ hoje: [], proximos: [], total: 0, erro: "API temporariamente indisponível" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
}

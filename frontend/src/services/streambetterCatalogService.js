// src/services/streambetterCatalogService.js
// Metadados de episódios (temporada) vindos do TMDB, usados por serie/[slug].astro.
// A resolução de fonte de stream (findStreamSource, findChannelSource, etc.) foi removida
// junto com o sistema antigo de fontes do player — o player agora embeda direto o player
// público da StreamBetter (ver services/streamEmbedService.js).
import { getTMDBSeasonDetails } from './tmdb.js';

function normalizeTmdbId(tmdbId) {
    return tmdbId ? String(tmdbId).replace(/^(tv|movie)_/, '') : '';
}

function mapTmdbEpisodes(tmdbEpisodes, tmdbId, seasonNum, lang) {
    return tmdbEpisodes.map(ep => ({
        id: ep.id || `${tmdbId}_${seasonNum}_${ep.episode_number}`,
        episode_number: Number(ep.episode_number),
        name: ep.name || `Episodio ${ep.episode_number}`,
        overview: ep.overview || (lang === 'pt' ? 'Sem sinopse disponivel.' : 'No overview available.'),
        still_path: ep.still_path || null,
        air_date: ep.air_date || null
    }));
}

export async function getSeriesSeasonEpisodes(tmdbId, seasonNum, lang = 'pt') {
    const cleanTmdbId = normalizeTmdbId(tmdbId);
    try {
        const tmdbSeason = await getTMDBSeasonDetails(cleanTmdbId, seasonNum, lang).catch(e => {
            console.warn(`[StreamBetter Catalog] Falha ao carregar temporada TMDB ${seasonNum}:`, e.message);
            return null;
        });

        if (!tmdbSeason?.episodes?.length) return { episodes: [], notFound: true };

        return {
            id: cleanTmdbId,
            name: tmdbSeason.name || '',
            season_number: Number(seasonNum),
            episodes: mapTmdbEpisodes(tmdbSeason.episodes, cleanTmdbId, seasonNum, lang),
            source: 'streambetter'
        };
    } catch (e) {
        console.error(`[StreamBetter Catalog] Erro ao obter episodios da temporada ${seasonNum}:`, e);
        return { episodes: [], error: true };
    }
}

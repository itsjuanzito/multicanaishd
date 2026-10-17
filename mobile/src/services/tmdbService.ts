import { Platform } from 'react-native';
import {
  FALLBACK_HEROES,
  FALLBACK_MOVIES,
  FALLBACK_SERIES,
  FALLBACK_ANIMES,
  FALLBACK_DORAMAS,
  FALLBACK_COMEDY,
  FALLBACK_HORROR,
  FALLBACK_KDRAMAS,
  FALLBACK_FAMILY
} from './tmdbFallbacks';

const TMDB_READ_TOKEN = process.env.EXPO_PUBLIC_KEY_API_TMDB || '';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMedia {
  id: string;
  title: string;
  category: string;
  rating: string;
  banner: string; // Backdrop image for Hero
  poster: string; // Cover image for lists
  overview: string;
  year: string;
  type?: 'movie' | 'tv' | 'series';
}

// Map de IDs de Gêneros do TMDB para strings amigáveis
const GENRE_MAP: { [key: number]: string } = {
  28: 'Ação', 12: 'Aventura', 16: 'Anime / Animação', 35: 'Comédia', 80: 'Crime',
  99: 'Documentário', 18: 'Drama', 10751: 'Família', 14: 'Fantasia',
  36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério',
  10749: 'Romance', 878: 'Ficção Científica', 10770: 'Cinema TV', 53: 'Suspense',
  10752: 'Guerra', 37: 'Faroeste', 10759: 'Ação & Aventura', 10765: 'Sci-Fi & Fantasy'
};

const getCategoryFromGenres = (genreIds?: number[]): string => {
  if (!genreIds || genreIds.length === 0) return 'Geral';
  return GENRE_MAP[genreIds[0]] || 'Destaque';
};

// Cache L1 em RAM para poupar limites de banda e evitar timeouts repetitivos (Pilar 4)
const cache: { [key: string]: any } = (globalThis as any).tmdbCache || {};
(globalThis as any).tmdbCache = cache;

interface SuperflixIds {
  movies: Set<number>;
  series: Set<number>;
  anime: Set<number>;
  doramas: Set<number>;
}

// Caching layer para os IDs do Superflix para evitar chamadas excessivas (Pilar 4)
const MEMORY_TTL = 1000 * 60 * 5; // 5 minutos de cache em memória
let cachedSuperflixIds: SuperflixIds | null = null;
let superflixIdsTimestamp = 0;
let superflixIdsPromise: Promise<SuperflixIds> | null = null;

/**
 * Recupera os IDs de conteúdos que estão ativos/disponíveis no catálogo do Superflix,
 * disparando downloads paralelos com fallbacks em cascata nos múltiplos domínios ativos.
 */
export async function getSuperflixIds(): Promise<SuperflixIds> {
  const agora = Date.now();
  if (cachedSuperflixIds && (agora - superflixIdsTimestamp < MEMORY_TTL)) {
    return cachedSuperflixIds;
  }
  if (superflixIdsPromise) return superflixIdsPromise;

  superflixIdsPromise = (async () => {
    const domains = [
      'https://superflixapi.online',
      'https://superflixapi.best',
      'https://superflixapi.buzz',
      'https://superflixapi.asia'
    ];

    const fetchList = async (category: string): Promise<number[]> => {
      const fetchFromDomain = async (domain: string): Promise<number[]> => {
        const url = `${domain}/lista?category=${category}&format=json&type=tmdb`;
        const res = await fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }, 8000);
        if (!res.ok) throw new Error('Not ok');
        const data = await res.json();
        if (data && Array.isArray(data)) {
          return data.map((item: any) => Number(item));
        }
        throw new Error('Invalid data format');
      };

      // Tenta de forma sequencial nos domínios ativos caso o principal falhe
      for (const domain of domains) {
        try {
          const list = await fetchFromDomain(domain);
          if (list && list.length > 0) return list;
        } catch (e) {
          // Continua para o próximo domínio disponível
        }
      }
      return [];
    };

    try {
      const [movies, series, anime, doramas] = await Promise.all([
        fetchList('movie'),
        fetchList('serie'),
        fetchList('anime'),
        fetchList('dorama')
      ]);

      cachedSuperflixIds = {
        movies: new Set(movies),
        series: new Set(series),
        anime: new Set(anime),
        doramas: new Set(doramas)
      };
      
      superflixIdsTimestamp = Date.now();
      superflixIdsPromise = null;
      return cachedSuperflixIds;
    } catch (error) {
      console.warn('⚠️ [TMDBService] Erro ao carregar IDs do Superflix:', error);
      superflixIdsPromise = null;
      return {
        movies: new Set(),
        series: new Set(),
        anime: new Set(),
        doramas: new Set()
      };
    }
  })();

  return superflixIdsPromise;
}

/**
 * Helper to fetch with a generous timeout to prevent slow network hanging on mobile (Pilar 4)
 * Aumentado para 12 segundos para dar estabilidade no 3G/4G brasileiro
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export async function getTrendingMedia(): Promise<TMDBMedia[]> {
  if (cache['trending']) return cache['trending'];

  if (!TMDB_READ_TOKEN) {
    console.warn('[TMDBService] Sem TOKEN_API. Usando fallbacks.');
    return FALLBACK_HEROES;
  }

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/trending/all/week?language=pt-BR`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();
    
    if (!data?.results || data.results.length === 0) return FALLBACK_HEROES;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.title || item.name || 'Título sem nome',
      category: getCategoryFromGenres(item.genre_ids),
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.5',
      banner: item.backdrop_path 
        ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` 
        : 'https://image.tmdb.org/t/p/w780/xOMXRj7vXFw56oKStJ96kr4zT4C.jpg',
      poster: item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}` 
        : 'https://image.tmdb.org/t/p/w500/czembWD5dBD452g5uC4UKe5g4uN.jpg',
      overview: item.overview || 'Sinopse não disponível em português para este conteúdo.',
      year: (item.release_date || item.first_air_date || '').split('-')[0] || '2026',
      type: item.media_type === 'movie' ? 'movie' : 'tv'
    }));

    cache['trending'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getTrendingMedia, utilizando fallbacks:', error);
    return cache['trending'] || FALLBACK_HEROES;
  }
}

export async function getPopularMovies(): Promise<TMDBMedia[]> {
  if (cache['popularMovies']) return cache['popularMovies'];

  if (!TMDB_READ_TOKEN) return FALLBACK_MOVIES;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/movie/popular?language=pt-BR&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_MOVIES;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.title || 'Filme Popular',
      category: getCategoryFromGenres(item.genre_ids),
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.0',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/74xTEgt7R361n5N6su5Jj9Q732I.jpg',
      overview: item.overview || '',
      year: (item.release_date || '').split('-')[0] || '2025',
      type: 'movie'
    }));

    cache['popularMovies'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getPopularMovies, utilizando fallbacks:', error);
    return cache['popularMovies'] || FALLBACK_MOVIES;
  }
}

export async function getPopularSeries(): Promise<TMDBMedia[]> {
  if (cache['popularSeries']) return cache['popularSeries'];

  if (!TMDB_READ_TOKEN) return FALLBACK_SERIES;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/tv/popular?language=pt-BR&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_SERIES;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.name || 'Série Popular',
      category: getCategoryFromGenres(item.genre_ids),
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.0',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/uKVKSj6n58nZCu5e7hm4t1rjT5F.jpg',
      overview: item.overview || '',
      year: (item.first_air_date || '').split('-')[0] || '2025',
      type: 'tv'
    }));

    cache['popularSeries'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getPopularSeries, utilizando fallbacks:', error);
    return cache['popularSeries'] || FALLBACK_SERIES;
  }
}

export async function getAnimes(): Promise<TMDBMedia[]> {
  if (cache['animes']) return cache['animes'];

  if (!TMDB_READ_TOKEN) return FALLBACK_ANIMES;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/tv?with_genres=16&with_original_language=ja&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_ANIMES;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.name || 'Anime Popular',
      category: 'Anime',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.5',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/xBHvZ22ZjGx46547Zwkgab548C6.jpg',
      overview: item.overview || '',
      year: (item.first_air_date || '').split('-')[0] || '2025',
      type: 'tv'
    }));

    cache['animes'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getAnimes, utilizando fallbacks:', error);
    return cache['animes'] || FALLBACK_ANIMES;
  }
}

export async function getDoramas(): Promise<TMDBMedia[]> {
  if (cache['doramas']) return cache['doramas'];

  if (!TMDB_READ_TOKEN) return FALLBACK_DORAMAS;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/tv?with_original_language=ko&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_DORAMAS;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.name || 'Dorama Popular',
      category: 'Dorama',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.5',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/9kMug5dBD452g5uC4UKe5g4uN.jpg',
      overview: item.overview || '',
      year: (item.first_air_date || '').split('-')[0] || '2025',
      type: 'tv'
    }));

    cache['doramas'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getDoramas, utilizando fallbacks:', error);
    return cache['doramas'] || FALLBACK_DORAMAS;
  }
}

export async function getComedy(): Promise<TMDBMedia[]> {
  if (cache['comedy']) return cache['comedy'];

  if (!TMDB_READ_TOKEN) return FALLBACK_COMEDY;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/movie?with_genres=35&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_COMEDY;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.title || 'Comédia Popular',
      category: 'Comédia',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.0',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/8cdWjvZpa84YrV5Np9SIFF4t2WM.jpg',
      overview: item.overview || '',
      year: (item.release_date || '').split('-')[0] || '2025',
      type: 'movie'
    }));

    cache['comedy'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getComedy, utilizando fallbacks:', error);
    return cache['comedy'] || FALLBACK_COMEDY;
  }
}

export async function getHorrorThriller(): Promise<TMDBMedia[]> {
  if (cache['horrorThriller']) return cache['horrorThriller'];

  if (!TMDB_READ_TOKEN) return FALLBACK_HORROR;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/movie?with_genres=27,53&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_HORROR;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.title || 'Terror/Suspense Popular',
      category: 'Terror / Suspense',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '7.5',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/A5XZ6ZLPHOOK3n5C7keXtEZo8vI.jpg',
      overview: item.overview || '',
      year: (item.release_date || '').split('-')[0] || '2025',
      type: 'movie'
    }));

    cache['horrorThriller'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getHorrorThriller, utilizando fallbacks:', error);
    return cache['horrorThriller'] || FALLBACK_HORROR;
  }
}

export async function getKDramas(): Promise<TMDBMedia[]> {
  if (cache['kdramas']) return cache['kdramas'];

  if (!TMDB_READ_TOKEN) return FALLBACK_KDRAMAS;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/tv?with_original_language=ko&with_genres=18&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_KDRAMAS;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.name || 'K-Drama Popular',
      category: 'K-Drama',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.0',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/9kMug5dBD452g5uC4UKe5g4uN.jpg',
      overview: item.overview || '',
      year: (item.first_air_date || '').split('-')[0] || '2025',
      type: 'tv'
    }));

    cache['kdramas'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getKDramas, utilizando fallbacks:', error);
    return cache['kdramas'] || FALLBACK_KDRAMAS;
  }
}

export async function getFamily(): Promise<TMDBMedia[]> {
  if (cache['family']) return cache['family'];

  if (!TMDB_READ_TOKEN) return FALLBACK_FAMILY;

  try {
    const response = await fetchWithTimeout(`${TMDB_BASE_URL}/discover/tv?with_genres=10751&language=pt-BR&sort_by=popularity.desc&page=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (!data?.results || data.results.length === 0) return FALLBACK_FAMILY;

    const results = data.results.map((item: any) => ({
      id: String(item.id),
      title: item.name || 'Família Popular',
      category: 'Família',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '7.8',
      banner: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmFJpZxOFVnLTYO5Ka.jpg',
      overview: item.overview || '',
      year: (item.first_air_date || '').split('-')[0] || '2025',
      type: 'tv'
    }));

    cache['family'] = results;
    return results;
  } catch (error) {
    console.warn('⚠️ Falha getFamily, utilizando fallbacks:', error);
    return cache['family'] || FALLBACK_FAMILY;
  }
}

export interface CastActor {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface Episode {
  id: number;
  name: string;
  episodeNumber: number;
  overview: string;
  stillPath: string | null;
}

export interface Season {
  id: number;
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export async function getMediaCreditsAndRecommendations(id: string, type: 'movie' | 'tv' | 'series'): Promise<{ cast: CastActor[], similar: TMDBMedia[] }> {
  if (!TMDB_READ_TOKEN) {
    return { cast: [], similar: [] };
  }

  const tmdbType = type === 'series' || type === 'tv' ? 'tv' : 'movie';

  try {
    const [creditsRes, recsRes] = await Promise.all([
      fetchWithTimeout(`${TMDB_BASE_URL}/${tmdbType}/${id}/credits?language=pt-BR`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TMDB_READ_TOKEN}`,
          Accept: 'application/json',
        },
      }).then(r => r.ok ? r.json() : null).catch(() => null),
      
      fetchWithTimeout(`${TMDB_BASE_URL}/${tmdbType}/${id}/recommendations?language=pt-BR&page=1`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TMDB_READ_TOKEN}`,
          Accept: 'application/json',
        },
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const cast: CastActor[] = (creditsRes?.cast || []).slice(0, 8).map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
    }));

    const similar: TMDBMedia[] = (recsRes?.results || []).slice(0, 10).map((item: any) => ({
      id: String(item.id),
      title: item.title || item.name || 'Título sem nome',
      category: getCategoryFromGenres(item.genre_ids),
      rating: item.vote_average ? item.vote_average.toFixed(1) : '8.5',
      banner: item.backdrop_path 
        ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` 
        : '',
      poster: item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}` 
        : 'https://image.tmdb.org/t/p/w500/czembWD5dBD452g5uC4UKe5g4uN.jpg',
      overview: item.overview || '',
      year: (item.release_date || item.first_air_date || '').split('-')[0] || '2026',
      type: tmdbType
    }));

    return { cast, similar };
  } catch (error) {
    console.warn(`[TMDB] Erro ao buscar créditos e recomendações para ${tmdbType} ${id}:`, error);
    return { cast: [], similar: [] };
  }
}

export async function getTVShowSeasons(id: string): Promise<Season[]> {
  if (!TMDB_READ_TOKEN) return [];

  try {
    const res = await fetchWithTimeout(`${TMDB_BASE_URL}/tv/${id}?language=pt-BR`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    const data = await res.json();

    const seasons: Season[] = (data.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({
        id: s.id,
        seasonNumber: s.season_number,
        name: s.name || `Temporada ${s.season_number}`,
        episodeCount: s.episode_count
      }));

    return seasons;
  } catch (error) {
    console.warn(`[TMDB] Erro ao buscar temporadas para TV ${id}:`, error);
    return [];
  }
}

export async function getTVShowSeasonEpisodes(id: string, seasonNumber: number): Promise<Episode[]> {
  if (!TMDB_READ_TOKEN) return [];

  try {
    const res = await fetchWithTimeout(`${TMDB_BASE_URL}/tv/${id}/season/${seasonNumber}?language=pt-BR`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    const data = await res.json();

    const episodes: Episode[] = (data.episodes || []).map((e: any) => ({
      id: e.id,
      name: e.name || `Episódio ${e.episode_number}`,
      episodeNumber: e.episode_number,
      overview: e.overview || 'Sem sinopse disponível.',
      stillPath: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null
    }));

    return episodes;
  } catch (error) {
    console.warn(`[TMDB] Erro ao buscar episódios para TV ${id} Temp ${seasonNumber}:`, error);
    return [];
  }
}

export async function searchMedia(query: string): Promise<TMDBMedia[]> {
  if (!query || query.trim() === '') return [];

  try {
    // 1. Dispara a busca no TMDB e a carga de IDs do Superflix em paralelo (Pilar 4: Parallelization)
    const [response, idsDisponiveis] = await Promise.all([
      TMDB_READ_TOKEN 
        ? fetchWithTimeout(`${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&language=pt-BR&page=1`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${TMDB_READ_TOKEN}`,
              Accept: 'application/json',
            },
          })
        : Promise.resolve(null),
      getSuperflixIds()
    ]);

    // Caso o token do TMDB não esteja configurado, buscamos estaticamente e filtramos pelos IDs se houverem
    if (!response) {
      const allStatic = [
        ...FALLBACK_HEROES,
        ...FALLBACK_MOVIES,
        ...FALLBACK_SERIES,
        ...FALLBACK_ANIMES,
        ...FALLBACK_DORAMAS
      ];
      let filteredStatic = allStatic.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
      if (idsDisponiveis.movies.size > 0 || idsDisponiveis.series.size > 0) {
        filteredStatic = filteredStatic.filter(item => {
          const contentId = Number(item.id);
          if (item.type === 'movie') return idsDisponiveis.movies.has(contentId);
          return idsDisponiveis.series.has(contentId) || idsDisponiveis.anime.has(contentId) || idsDisponiveis.doramas.has(contentId);
        });
      }
      return filteredStatic;
    }

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();
    
    if (!data?.results) return [];

    // 2. Filtra os resultados para reter APENAS os conteúdos disponíveis no Superflix (Pilar 2)
    // Se os IDs falharem totalmente (ex: offline), pulamos a filtragem para manter resiliência e evitar tela em branco.
    const hasIds = idsDisponiveis.movies.size > 0 || idsDisponiveis.series.size > 0;

    return data.results
      .filter((item: any) => {
        if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
        
        if (hasIds) {
          const contentId = Number(item.id);
          if (item.media_type === 'movie') {
            return idsDisponiveis.movies.has(contentId);
          }
          if (item.media_type === 'tv') {
            return idsDisponiveis.series.has(contentId) || 
                   idsDisponiveis.anime.has(contentId) || 
                   idsDisponiveis.doramas.has(contentId);
          }
        }
        return true;
      })
      .map((item: any) => ({
        id: String(item.id),
        title: item.title || item.name || 'Título sem nome',
        category: getCategoryFromGenres(item.genre_ids),
        rating: item.vote_average ? item.vote_average.toFixed(1) : '8.5',
        banner: item.backdrop_path 
          ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` 
          : 'https://image.tmdb.org/t/p/w780/xOMXRj7vXFw56oKStJ96kr4zT4C.jpg',
        poster: item.poster_path 
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}` 
          : 'https://image.tmdb.org/t/p/w500/czembWD5dBD452g5uC4UKe5g4uN.jpg',
        overview: item.overview || 'Sinopse não disponível.',
        year: (item.release_date || item.first_air_date || '').split('-')[0] || '2026',
        type: item.media_type === 'movie' ? 'movie' : 'tv'
      }));
  } catch (error) {
    console.warn('⚠️ Falha searchMedia, utilizando fallbacks locais:', error);
    return [];
  }
}

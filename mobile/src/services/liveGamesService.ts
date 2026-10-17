// mobile/src/services/liveGamesService.ts
// Service for fetching live sports and games from embedtv.lat API

export interface Team {
  name: string;
  image?: string;
}

export interface GameTimer {
  start: number; // Unix timestamp
  end: number;   // Unix timestamp
}

export interface GameData {
  timer: GameTimer;
  teams: {
    home: Team;
    away: Team;
  };
  league: string;
}

export interface LiveGame {
  title: string;
  url?: string;
  data: GameData;
}

const API_URL = "https://embedtv.lat/api/jogos";

// Map de logos oficiais de alta resolução via API-Sports (Totalmente públicos, transparentes e sem bloqueio de User-Agent)
const LOGO_MAP: { [key: string]: string } = {
  'vasco': 'https://media.api-sports.io/football/teams/1004.png',
  'athletico': 'https://media.api-sports.io/football/teams/1018.png',
  'napoli': 'https://media.api-sports.io/football/teams/492.png',
  'bologna': 'https://media.api-sports.io/football/teams/500.png',
  'tottenham': 'https://media.api-sports.io/football/teams/47.png',
  'leeds': 'https://media.api-sports.io/football/teams/63.png',
  'rayo': 'https://media.api-sports.io/football/teams/728.png',
  'girona': 'https://media.api-sports.io/football/teams/547.png',
  'palmeiras': 'https://media.api-sports.io/football/teams/1023.png',
  'flamengo': 'https://media.api-sports.io/football/teams/1024.png',
  'real madrid': 'https://media.api-sports.io/football/teams/541.png',
  'bayern': 'https://media.api-sports.io/football/teams/157.png',
};

/**
 * Retorna a logo correta injetando fallback de alta qualidade se necessário
 */
function getTeamLogo(name: string, providedUrl?: string): string {
  const normalized = name.toLowerCase();
  for (const key of Object.keys(LOGO_MAP)) {
    if (normalized.includes(key)) {
      return LOGO_MAP[key];
    }
  }
  return providedUrl || '';
}

/**
 * Parses team image paths to be cloudfront/web optimized.
 */
function optimizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.includes('cloudfront.net')) {
    return `${url}?w=96&h=96&fit=max`;
  }
  return url;
}

/**
 * Checks if game is currently live
 */
export function isGameLive(game: LiveGame): boolean {
  if (!game?.data?.timer?.start || !game?.data?.timer?.end) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return now >= game.data.timer.start && now <= game.data.timer.end;
}

/**
 * Helper to check relevance today
 */
export function isGameRelevantToday(game: LiveGame): boolean {
  if (!game?.data?.timer?.start || !game?.data?.timer?.end) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const start = game.data.timer.start;
  const end = game.data.timer.end;

  // REQUISITO: Se o jogo já acabou, NÃO exibe mais nos cards em hipótese alguma!
  if (now > end) {
    return false;
  }

  // Se estiver ao vivo agora, é relevante
  if (now >= start && now <= end) {
    return true;
  }

  // Se começa hoje, é relevante (alinhado com a regra oficial do site)
  const gameDate = new Date(start * 1000).toLocaleDateString('en-CA');
  const todayDate = new Date().toLocaleDateString('en-CA');
  
  if (gameDate === todayDate) {
    return true;
  }

  return false;
}

/**
 * Returns formatted time or live badge string
 */
export function getGameTimeStatus(game: LiveGame): { type: 'live' | 'upcoming' | 'ended'; label: string } {
  const start = Number(game?.data?.timer?.start);
  const end = Number(game?.data?.timer?.end);

  if (!start || !end) {
    return { type: 'upcoming', label: 'AGUARDANDO' };
  }

  const now = Math.floor(Date.now() / 1000);

  if (now >= start && now <= end) {
    return { type: 'live', label: 'AO VIVO' };
  }

  if (now < start) {
    const diffMin = Math.ceil((start - now) / 60);

    if (diffMin > 60) {
      const date = new Date(start * 1000);
      const timeStr = date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo'
      });
      return { type: 'upcoming', label: `ÀS ${timeStr}` };
    }

    return { type: 'upcoming', label: `EM ${diffMin} MIN` };
  }

  return { type: 'ended', label: 'ENCERRADO' };
}

/**
 * Fetches all relevant games for today
 */
export async function fetchTodayRelevantGames(): Promise<LiveGame[]> {
  try {
    const busterUrl = `${API_URL}?t=${Date.now()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(busterUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    clearTimeout(timeoutId);

    let apiGames: LiveGame[] = [];

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        apiGames = data.map((game: any) => {
          const homeName = game.data?.teams?.home?.name || "Time Casa";
          const awayName = game.data?.teams?.away?.name || "Time Fora";
          
          return {
            title: game.title,
            url: Array.isArray(game.players) ? game.players[0] : (game.players || game.url || ""),
            data: {
              league: game.data?.league || "Campeonato",
              timer: {
                start: Number(game.data?.timer?.start || 0),
                end: Number(game.data?.timer?.end || 0)
              },
              teams: {
                home: {
                  name: homeName,
                  image: getTeamLogo(homeName, optimizeImageUrl(game.data?.teams?.home?.image))
                },
                away: {
                  name: awayName,
                  image: getTeamLogo(awayName, optimizeImageUrl(game.data?.teams?.away?.image))
                }
              }
            }
          };
        });
      }
    }

    // Filtra apenas os jogos relevantes e ativos de hoje (Pilar 2 & 5)
    const activeGames = apiGames.filter(isGameRelevantToday);

    return sortGames(activeGames);

  } catch (error) {
    console.warn("[LiveGamesService] Failed to fetch live games:", error);
    // Em caso de erro de conexão ou API fora do ar, retorna vazio seguindo a regra
    // de que "se não tiver nenhum, não exibe nada" em vez de crashar a tela (Pilar 2)
    return [];
  }
}

function stripDiacritics(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) || 0;
    // Faixa Unicode dos marcadores diacriticos combinantes (acentos, til, cedilha, etc.)
    if (code >= 0x0300 && code <= 0x036f) continue;
    result += char;
  }
  return result;
}

function normalizeVipKey(value: string): string {
  return stripDiacritics(value.toLowerCase().trim().normalize('NFD'))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Gera o mesmo ID sintético usado pelo site para jogos sem canal fixo
 * (ex: "jogo_flamengo-x-vasco"), usado para casar com `vip_channels`.
 */
function generateCanalId(title: string): string {
  if (!title) return 'jogo_unknown';
  return `jogo_${normalizeVipKey(title)}`;
}

/**
 * Um jogo é VIP quando seu ID sintético (ou o slug do título) está presente
 * no mesmo conjunto de IDs VIP usado pelos canais de TV (tabela `vip_channels`),
 * espelhando a lógica de `frontend/src/pages/components/LiveGamesSection.astro`.
 */
export function isGameVIP(game: LiveGame, vipChannelIds: Set<string>): boolean {
  if (!vipChannelIds || vipChannelIds.size === 0) return false;

  const canalId = generateCanalId(game.title);
  const candidates = [canalId, normalizeVipKey(canalId), normalizeVipKey(game.title)];

  return candidates.some(candidate => vipChannelIds.has(candidate));
}

/**
 * Sort helper: Live first, then upcoming
 */
function sortGames(gamesList: LiveGame[]): LiveGame[] {
  return gamesList.sort((a, b) => {
    const aLive = isGameLive(a);
    const bLive = isGameLive(b);

    if (aLive && !bLive) return -1;
    if (!aLive && bLive) return 1;

    return a.data.timer.start - b.data.timer.start;
  });
}

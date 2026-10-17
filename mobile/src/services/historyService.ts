// mobile/src/services/historyService.ts
// Continuar Assistindo — lê o mesmo histórico usado pelo site (tabela `profiles`)
import { supabase } from './supabase';

export interface ContinueWatchingItem {
  id: string;
  title: string;
  type: 'movie' | 'tv';
  poster: string;
  backdrop: string;
  timestamp: string;
  progress: number; // 0-100
  watchedCount: number; // episódios assistidos (0 para filme)
  totalEps: number; // total de episódios da série (0 para filme/desconhecido)
}

// Mangás ficam fora por enquanto (sem suporte no app ainda) e o carrossel só
// mostra o que está realmente "em andamento" — não a vida inteira do usuário.
const MAX_CONTINUE_WATCHING_ITEMS = 12;

interface HistoryEntry {
  id: string | number;
  title: string;
  type: 'movie' | 'tv' | 'manga';
  poster?: string;
  backdrop?: string;
  timestamp: string;
  totalEps?: number;
}

/**
 * Busca o histórico ("Continuar Assistindo") do usuário logado direto do Supabase,
 * calculando o progresso de séries a partir de `watched_episodes`.
 */
export async function getContinueWatching(userId: string): Promise<ContinueWatchingItem[]> {
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('history, watched_episodes')
      .eq('id', userId)
      .single();

    if (error || !data) return [];

    const history: HistoryEntry[] = Array.isArray(data.history) ? data.history : [];
    const watchedEpisodes: Record<string, string[]> = data.watched_episodes || {};

    const items: ContinueWatchingItem[] = history
      .filter((entry): entry is HistoryEntry & { type: 'movie' | 'tv' } =>
        entry.type === 'movie' || entry.type === 'tv'
      )
      .map((entry) => {
        let progress = 0;
        let watchedCount = 0;
        if (entry.type === 'tv') {
          watchedCount = watchedEpisodes[String(entry.id)]?.length || 0;
          if (entry.totalEps) {
            progress = Math.min(100, Math.round((watchedCount / entry.totalEps) * 100));
          }
        }

        return {
          id: String(entry.id),
          title: entry.title,
          type: entry.type,
          poster: entry.poster || '',
          backdrop: entry.backdrop || entry.poster || '',
          timestamp: entry.timestamp,
          progress,
          watchedCount,
          totalEps: entry.totalEps || 0
        };
      })
      // Série já concluída não é mais "continuar assistindo"
      .filter((item) => !(item.type === 'tv' && item.progress >= 100));

    // Mais recente primeiro, limitado a um carrossel curto (não a vida inteira do usuário)
    return items
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, MAX_CONTINUE_WATCHING_ITEMS);
  } catch (e) {
    console.warn('[Service] Falha ao buscar Continuar Assistindo:', e);
    return [];
  }
}

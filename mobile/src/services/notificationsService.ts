// mobile/src/services/notificationsService.ts
// Notificações globais — mesma tabela `site_notifications` usada pelo site
// (frontend/src/pages/api/notifications.js). Sem realtime: o site também só
// faz polling a cada 60s, e "lido" é 100% local (sem estado no servidor).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface SiteNotification {
  id: string;
  title: string;
  message: string;
  link: string | null;
  created_at: string;
}

const LAST_SEEN_KEY = 'bf_last_seen_notification';
const CACHE_TTL = 30000; // 30s, mesmo TTL do endpoint do site

let cache: SiteNotification[] | null = null;
let cacheTimestamp = 0;
let currentFetchPromise: Promise<SiteNotification[]> | null = null;

/**
 * Busca as últimas 20 notificações globais, mesma query do site.
 */
export async function getNotifications(): Promise<SiteNotification[]> {
  const now = Date.now();

  if (cache && now - cacheTimestamp < CACHE_TTL) {
    return cache;
  }

  if (currentFetchPromise) {
    return currentFetchPromise;
  }

  currentFetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('site_notifications')
        .select('id, title, message, link, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      cache = data || [];
      cacheTimestamp = Date.now();
      return cache;
    } catch (e) {
      console.warn('[Service] Falha ao buscar notificações:', e);
      return cache || [];
    } finally {
      currentFetchPromise = null;
    }
  })();

  return currentFetchPromise;
}

export async function getLastSeenTimestamp(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export async function markNotificationsSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
  } catch {
    // Silencioso: pior caso, badge continua contando na próxima abertura
  }
}

export function countUnread(notifications: SiteNotification[], lastSeen: string | null): number {
  if (!lastSeen) return notifications.length;
  const lastSeenTime = new Date(lastSeen).getTime();
  return notifications.filter(n => new Date(n.created_at).getTime() > lastSeenTime).length;
}

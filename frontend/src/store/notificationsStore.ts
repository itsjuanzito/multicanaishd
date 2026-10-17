import { map } from 'nanostores';

export interface SiteNotification {
    id: string;
    title: string;
    message: string;
    link: string | null;
    created_at: string;
}

export interface NotificationsState {
    items: SiteNotification[];
    unreadCount: number;
    loading: boolean;
}

const LAST_SEEN_KEY = 'bf_last_seen_notification';
const POLL_INTERVAL = 180000;
const GLOBAL_STORE_KEY = '_multicanaishd_notifications_store';

if (!(globalThis as any)[GLOBAL_STORE_KEY]) {
    (globalThis as any)[GLOBAL_STORE_KEY] = map<NotificationsState>({
        items: [],
        unreadCount: 0,
        loading: false
    });
}

export const notificationsStore = (globalThis as any)[GLOBAL_STORE_KEY];

function getLastSeen(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(LAST_SEEN_KEY);
    } catch (e) {
        return null;
    }
}

function computeUnreadCount(items: SiteNotification[]): number {
    const lastSeen = getLastSeen();
    if (!lastSeen) return items.length;
    const lastSeenTime = new Date(lastSeen).getTime();
    return items.filter(n => new Date(n.created_at).getTime() > lastSeenTime).length;
}

export async function fetchNotifications() {
    notificationsStore.setKey('loading', true);
    try {
        const res = await fetch('/api/notifications');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: SiteNotification[] = data?.notifications || [];
        notificationsStore.set({
            items,
            unreadCount: computeUnreadCount(items),
            loading: false
        });
    } catch (e) {
        console.error("❌ [Notifications] Erro ao buscar notificações:", e);
        notificationsStore.setKey('loading', false);
    }
}

export function markNotificationsRead() {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch (e) {}
    notificationsStore.setKey('unreadCount', 0);
}

let pollStarted = false;
export function startNotificationsPolling() {
    if (pollStarted || typeof window === 'undefined') return;
    pollStarted = true;
    fetchNotifications();

    let intervalId: ReturnType<typeof setInterval> | null = setInterval(fetchNotifications, POLL_INTERVAL);

    // Pausa o polling com a aba em background — evita gastar cota/CPU do Worker
    // checando notificações de abas que ninguém está olhando.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        } else if (!intervalId) {
            fetchNotifications();
            intervalId = setInterval(fetchNotifications, POLL_INTERVAL);
        }
    });
}

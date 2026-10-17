import { atom } from 'nanostores';
import { authStore, updateCloudStats } from './authStore';

const GLOBAL_FAV_KEY = '_multicanaishd_favorites_store';

if (!globalThis[GLOBAL_FAV_KEY]) {
    globalThis[GLOBAL_FAV_KEY] = atom([]);
}

export const favoritesStore = globalThis[GLOBAL_FAV_KEY];

if (typeof window !== 'undefined') {
    let internalChange = false;

    // 1. Sincroniza Nuvem -> Store Local
    authStore.subscribe((state) => {
        if (!state.initialized || state.loading) return;
        
        // [ANTI-LOOP] Ignora atualizações se houver ação local recente no sistema
        const syncState = (globalThis as any)._bf_sync_state;
        if (syncState?.lastLocalAction && (Date.now() - syncState.lastLocalAction < 2000)) {
            return;
        }

        const stateFavs = state.favorites || [];
        
        // Evita loop infinito de subscrição
        if (JSON.stringify(stateFavs) !== JSON.stringify(favoritesStore.get())) {
            internalChange = true;
            favoritesStore.set(stateFavs);
            setTimeout(() => { internalChange = false; }, 50);
        }
    });

    // 2. Sincroniza Store Local -> Nuvem
    favoritesStore.subscribe((favorites) => {
        const authState = authStore.get();
        if (authState.initialized && !authState.loading && !internalChange && authState.user) {
            updateCloudStats({ favorites });
        }
    });
}

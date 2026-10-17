// src/services/mainProfileConsumption.js
import { supabaseAdmin } from "./supabase";

// Desde os perfis múltiplos, histórico/favoritos/assistidos são gravados na linha do perfil
// ativo (account_profiles), e as colunas de `profiles` ficaram congeladas no dia da migração.
// Telas públicas (perfil, ranking) mostram o perfil principal da conta; sem ele, caem nas
// colunas antigas de `profiles`.
const CONSUMPTION_COLUMNS = "account_id, history, favorites, watched_movies, watched_episodes";

export async function fetchMainProfileConsumption(accountIds) {
    const map = new Map();
    const ids = (accountIds || []).filter(Boolean);
    if (!ids.length) return map;

    try {
        const { data, error } = await supabaseAdmin
            .from("account_profiles")
            .select(CONSUMPTION_COLUMNS)
            .eq("is_main", true)
            .in("account_id", ids);

        if (error) {
            console.warn("⚠️ [MainProfileConsumption] Falha ao ler account_profiles:", error.message);
            return map;
        }
        (data || []).forEach((row) => map.set(row.account_id, row));
    } catch (err) {
        console.warn("⚠️ [MainProfileConsumption] Erro inesperado:", err?.message);
    }
    return map;
}

export function resolveConsumption(profile, mainProfile) {
    return {
        history: mainProfile?.history || profile.history || [],
        favorites: mainProfile?.favorites || profile.favorites || [],
        watchedMovies: mainProfile?.watched_movies || profile.watched_movies || [],
        watchedEpisodes: mainProfile?.watched_episodes || profile.watched_episodes || {},
    };
}

export function countEpisodes(watchedEpisodes) {
    let total = 0;
    Object.keys(watchedEpisodes || {}).forEach((key) => {
        if (!key.startsWith("_") && Array.isArray(watchedEpisodes[key])) {
            total += watchedEpisodes[key].length;
        }
    });
    return total;
}

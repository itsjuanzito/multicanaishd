// src/pages/api/user/get-profile.js
import { supabaseAdmin } from "../../../services/supabase";
import { resolvePlano } from "../../../services/vipPlans.js";
import { fetchMainProfileConsumption, resolveConsumption, countEpisodes } from "../../../services/mainProfileConsumption.js";

export const prerender = false;

export async function GET({ request }) {
    try {
        const url = new URL(request.url);
        const searchVal = url.searchParams.get("u") || url.searchParams.get("username") || url.searchParams.get("user");

        if (!searchVal || searchVal.trim() === "") {
            return new Response(JSON.stringify({ error: "Missing user identifier parameter 'u'" }), { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        let queryValue = searchVal.trim();
        if (queryValue.startsWith('@')) {
            queryValue = queryValue.substring(1);
        }

        // 1. Try exact lookup by lowercase Nickname (Gold Standard)
        const { data: profilesByNick, error: nickError } = await supabaseAdmin
            .from('profiles')
            .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds, history, favorites')
            .eq('watched_episodes->>_nickname', queryValue.toLowerCase());

        if (nickError) {
            console.error("❌ [Get Profile API] Error querying nickname:", nickError.message);
        }

        let profile = null;
        if (profilesByNick && profilesByNick.length > 0) {
            profile = profilesByNick[0];
        }

        // 2. Fallback lookup by Display Name (ilike username)
        if (!profile) {
            const { data: profilesByName, error: nameError } = await supabaseAdmin
                .from('profiles')
                .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds, history, favorites')
                .ilike('username', queryValue);

            if (nameError) {
                console.error("❌ [Get Profile API] Error querying username:", nameError.message);
            }

            if (profilesByName && profilesByName.length > 0) {
                profile = profilesByName[0];
            }
        }

        // 3. Fallback lookup by short BetterID (if matching substring of UUID)
        if (!profile && queryValue.length === 8) {
            const { data: allIds, error: idError } = await supabaseAdmin
                .from('profiles')
                .select('id');

            if (idError) {
                console.error("❌ [Get Profile API] Error fetching IDs list:", idError.message);
            } else if (allIds) {
                const match = allIds.find(p => p.id.substring(0, 8).toUpperCase() === queryValue.toUpperCase());
                if (match) {
                    const { data: fullProfile, error: profileErr } = await supabaseAdmin
                        .from('profiles')
                        .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds, history, favorites')
                        .eq('id', match.id)
                        .maybeSingle();
                    if (profileErr) {
                        console.error("❌ [Get Profile API] Error fetching full profile by ID:", profileErr.message);
                    } else {
                        profile = fullProfile;
                    }
                }
            }
        }

        if (!profile) {
            return new Response(JSON.stringify({ error: "Member not found" }), { 
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 4. Calculate VIP Plan with high performance (Pilar 4)
        const isVIP = profile.is_vip === true && (!profile.vip_until || new Date(profile.vip_until) > new Date());
        let vipPlan = null;

        if (isVIP) {
            if (!profile.vip_until) {
                vipPlan = 'vitalicio';
            } else {
                // Fetch latest payment to get correct plan level
                const { data: latestPayment } = await supabaseAdmin
                    .from('payments')
                    .select('amount')
                    .eq('user_id', profile.id)
                    .eq('status', 'paid')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                // resolvePlano em vez do mapa de valores repetido aqui: esta cópia não
                // conhecia os valores do Black e rebaixava todo assinante Black pra 'mensal'.
                vipPlan = resolvePlano(profile, latestPayment?.amount || null);
            }
        }

        // 5. Consumo vem do perfil principal (account_profiles); nickname continua na conta.
        const watchedEpsObj = profile.watched_episodes || {};
        const mainProfiles = await fetchMainProfileConsumption([profile.id]);
        const consumption = resolveConsumption(profile, mainProfiles.get(profile.id));

        // 6. Return secure, public elements only (Strict Privacy & Pilar 2)
        const secureProfile = {
            id: profile.id.substring(0, 8).toUpperCase(), // BetterID
            username: profile.username || "Membro MultiCanaisHD",
            nickname: watchedEpsObj._nickname || null,
            avatar: profile.avatar || '1',
            isVIP,
            vipPlan,
            activeSeconds: profile.active_seconds || 0,
            rankingActiveSeconds: profile.ranking_active_seconds !== undefined && profile.ranking_active_seconds !== null ? profile.ranking_active_seconds : (profile.active_seconds || 0),
            moviesCount: consumption.watchedMovies.length,
            episodesCount: countEpisodes(consumption.watchedEpisodes),
            watchedMovies: consumption.watchedMovies,
            watchedEpisodes: { ...consumption.watchedEpisodes, _nickname: watchedEpsObj._nickname },
            history: consumption.history,
            favorites: consumption.favorites
        };

        return new Response(JSON.stringify({ profile: secureProfile }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        });

    } catch (error) {
        console.error("❌ [Get Profile API] Critical Error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

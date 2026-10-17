import { supabaseAdmin } from "../../services/supabase";
import { resolvePlano } from "../../services/vipPlans.js";
import { fetchMainProfileConsumption, resolveConsumption, countEpisodes } from "../../services/mainProfileConsumption.js";

export const prerender = false;

const CACHE_TTL_MS = 15000; // 15 seconds memory cache — 5s era agressivo demais pro tráfego atual, recomputava o ranking (sort/map sobre até 200 perfis) com frequência desnecessária

async function fetchAndComputeRankings() {
    console.log("⚙️ [Ranking API] Fetching and calculating rankings from DB...");
    
    // Otimização Crítica: Ordenar no Banco de Dados para garantir que os Top Maratonsistas apareçam primeiro (Pilar 4)
    // Se a coluna ranking_active_seconds não existir (antes de rodar o SQL), o Supabase retornará erro e usaremos o fallback.
    let query = supabaseAdmin
        .from('profiles')
        .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds')
        .order('ranking_active_seconds', { ascending: false, nullsFirst: false })
        .limit(200); // Pegamos os top 200 para o ranking para máxima performance

    let { data: profiles, error } = await query;

    if (error && (error.message.includes('ranking_active_seconds') || error.message.includes('active_seconds'))) {
        console.warn("⚠️ [Ranking API] Coluna ranking_active_seconds ausente. Usando fallback de busca por active_seconds...");
        const fallbackQuery = await supabaseAdmin
            .from('profiles')
            .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds')
            .order('active_seconds', { ascending: false, nullsFirst: false })
            .limit(200); 
            
        profiles = fallbackQuery.data;
        error = fallbackQuery.error;
        
        if (error) {
            console.warn("⚠️ [Ranking API] Coluna active_seconds também ausente. Usando fallback de busca lenta total...");
            const ultimateFallback = await supabaseAdmin
                .from('profiles')
                .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until')
                .limit(500);
            profiles = ultimateFallback.data;
            error = ultimateFallback.error;
        }
    }

    if (error) {
        throw error;
    }

    // Buscar os pagamentos aprovados para mapear o plano VIP de cada um de forma ultra performática (Pilar 4)
    const profileIds = (profiles || []).map(p => p.id);
    const { data: payments, error: paymentsError } = await supabaseAdmin
        .from('payments')
        .select('user_id, amount')
        .eq('status', 'paid')
        .in('user_id', profileIds)
        .order('created_at', { ascending: false });

    // Filmes/episódios vêm do perfil principal: as colunas de `profiles` congelaram nos perfis múltiplos.
    const mainProfiles = await fetchMainProfileConsumption(profileIds);

    const paymentMap = {};
    if (!paymentsError && payments) {
        payments.forEach(p => {
            if (p.user_id && !paymentMap[p.user_id]) {
                paymentMap[p.user_id] = p.amount;
            }
        });
    }

    const calculated = (profiles || []).map(p => {
        const watchedMoviesList = p.watched_movies || [];
        const watchedEpisodesObj = p.watched_episodes || {};
        
        let totalHours = 0;
        if (p.ranking_active_seconds !== undefined && p.ranking_active_seconds !== null) {
            totalHours = p.ranking_active_seconds / 3600;
        } else if (p.active_seconds !== undefined && p.active_seconds !== null) {
            totalHours = p.active_seconds / 3600;
        } else {
            // Pilar 2: Fallback para watched_episodes._active_seconds se a coluna física não existir ainda
            const fallbackSecs = parseInt(watchedEpisodesObj._active_seconds?.[0] || "0", 10);
            if (fallbackSecs > 0) {
                totalHours = fallbackSecs / 3600;
            } else {
                // Semente de transição elegante: usuários legados que ainda não iniciaram o novo player
                // mantêm a contagem antiga como ponto de partida inicial.
                let episodesCount = 0;
                Object.values(watchedEpisodesObj).forEach(eps => {
                    if (eps !== null && eps !== undefined && eps !== watchedEpisodesObj._active_seconds && Array.isArray(eps)) {
                        episodesCount += eps.length;
                    }
                });
                totalHours = (watchedMoviesList.length * 1.6) + (episodesCount * 0.7);
            }
        }

        // Active VIP status check
        const isVIP = p.is_vip === true && (!p.vip_until || new Date(p.vip_until) > new Date());
        
        // resolvePlano em vez do mapa de valores repetido aqui: esta cópia não conhecia os
        // valores do Black, então todo assinante Black caía no 'mensal' do fallback e o
        // ranking o exibia como VIP Básico.
        const vipPlan = resolvePlano(p, paymentMap[p.id] || null);

        const consumption = resolveConsumption(p, mainProfiles.get(p.id));

        const nickname = watchedEpisodesObj._nickname || null;

        return {
            id: p.id.substring(0, 8).toUpperCase(), // Public short BetterID
            // Sem username, cai pro nickname antes do genérico — senão o pódio virava uma
            // disputa entre vários "Membro MultiCanaisHD" idênticos e anônimos.
            username: p.username || nickname || "Membro MultiCanaisHD",
            nickname,
            avatar: p.avatar || '1',
            isVIP,
            vipPlan,
            moviesCount: consumption.watchedMovies.length,
            episodesCount: countEpisodes(consumption.watchedEpisodes),
            totalHours: Math.round(totalHours * 10) / 10 // Round to 1 decimal place
        };
    });

    // Sort by watch time descending
    calculated.sort((a, b) => b.totalHours - a.totalHours);

    return calculated;
}

export async function GET({ request }) {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "15", 10), 1), 50);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);

    try {
        const now = Date.now();
        const searchUser = url.searchParams.get("u");
        
        // --- SINGLETON / GLOBAL STATE LOCK (Pilar 4: Avoid Race Conditions) ---
        if (!globalThis._rankingPromise || !globalThis._rankingCacheTime || (now - globalThis._rankingCacheTime > CACHE_TTL_MS)) {
            globalThis._rankingCacheTime = now;
            globalThis._rankingPromise = fetchAndComputeRankings().catch(err => {
                globalThis._rankingPromise = null;
                globalThis._rankingCacheTime = null;
                throw err;
            });
        }

        const rankings = await globalThis._rankingPromise;

        // Find specific user rank if requested
        let myRank = null;
        if (searchUser) {
            const searchLower = searchUser.toLowerCase();
            const index = rankings.findIndex(r => 
                r.username.toLowerCase() === searchLower || 
                r.id.toLowerCase() === searchLower
            );

            if (index !== -1) {
                myRank = {
                    ...rankings[index],
                    position: index + 1
                };
            } else {
                // FALLBACK: User not in top 200, find them specifically
                console.log(`🔍 [Ranking API] User ${searchUser} not in Top 200. Fetching specific rank...`);
                
                // 1. Get user profile and active_seconds
                const { data: userProfile } = await supabaseAdmin
                    .from('profiles')
                    .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds')
                    .or(`username.ilike.${searchUser},id.ilike.${searchUser.substring(0,8)}%`)
                    .maybeSingle();

                if (userProfile) {
                    const isUsingRankingCol = userProfile.ranking_active_seconds !== undefined && userProfile.ranking_active_seconds !== null;
                    const activeSecs = isUsingRankingCol ? userProfile.ranking_active_seconds : (userProfile.active_seconds || 0);
                    
                    // 2. Count how many users have more active_seconds
                    const { count } = await supabaseAdmin
                        .from('profiles')
                        .select('*', { count: 'exact', head: true })
                        .gt(isUsingRankingCol ? 'ranking_active_seconds' : 'active_seconds', activeSecs);
                    
                    const position = (count || 0) + 1;

                    // 3. Re-use the computation logic (simplified for one user)
                    const watchedEpisodesObj = userProfile.watched_episodes || {};
                    const userMain = await fetchMainProfileConsumption([userProfile.id]);
                    const userConsumption = resolveConsumption(userProfile, userMain.get(userProfile.id));

                    const isVIP = userProfile.is_vip === true && (!userProfile.vip_until || new Date(userProfile.vip_until) > new Date());
                    const userNickname = watchedEpisodesObj._nickname || null;

                    myRank = {
                        id: userProfile.id.substring(0, 8).toUpperCase(),
                        username: userProfile.username || userNickname || "Membro MultiCanaisHD",
                        nickname: userNickname,
                        avatar: userProfile.avatar || '1',
                        isVIP,
                        moviesCount: userConsumption.watchedMovies.length,
                        episodesCount: countEpisodes(userConsumption.watchedEpisodes),
                        totalHours: Math.round((activeSecs / 3600) * 10) / 10,
                        position
                    };
                }
            }
        }

        // Slice pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedItems = rankings.slice(startIndex, endIndex);

        return new Response(JSON.stringify({
            rankings: paginatedItems,
            myRank,
            page,
            limit,
            totalUsers: rankings.length,
            hasMore: endIndex < rankings.length
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        });

    } catch (error) {
        console.error("❌ [Ranking API] Error loading rankings:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

import { supabaseAdmin } from "../../../services/supabase";

export const prerender = false;

const CACHE_TTL_MS = 60000;

async function fetchLastSeasonWinners() {
    const { data: latest, error: latestError } = await supabaseAdmin
        .from('ranking_winners')
        .select('season_label')
        .order('season_label', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (latestError) throw latestError;
    if (!latest) return { seasonLabel: null, winners: [] };

    const { data: winners, error } = await supabaseAdmin
        .from('ranking_winners')
        .select('position, user_id, username, nickname, avatar, is_vip, vip_plan, total_hours, movies_count, episodes_count')
        .eq('season_label', latest.season_label)
        .order('position', { ascending: true });

    if (error) throw error;

    return { seasonLabel: latest.season_label, winners: winners || [] };
}

export async function GET() {
    try {
        const now = Date.now();
        if (!globalThis._rankingWinnersPromise || !globalThis._rankingWinnersCacheTime || (now - globalThis._rankingWinnersCacheTime > CACHE_TTL_MS)) {
            globalThis._rankingWinnersCacheTime = now;
            globalThis._rankingWinnersPromise = fetchLastSeasonWinners().catch(err => {
                globalThis._rankingWinnersPromise = null;
                globalThis._rankingWinnersCacheTime = null;
                throw err;
            });
        }

        const result = await globalThis._rankingWinnersPromise;

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        });
    } catch (error) {
        console.error("❌ [Ranking Winners API] Error loading winners:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

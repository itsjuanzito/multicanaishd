import { getEnv } from '../../../services/env-adapter.js';
import { supabaseAdmin } from '../../../services/supabase';

export const prerender = false;

const SEASON_WINNERS_LIMIT = 3;

// Salva um "retrato" do Top 10 atual em ranking_winners antes de zerar o ranking,
// para que a página /ranking possa exibir os ganhadores da temporada que acabou de terminar.
async function snapshotSeasonWinners() {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, username, avatar, watched_movies, watched_episodes, is_vip, vip_until, active_seconds, ranking_active_seconds')
        .order('ranking_active_seconds', { ascending: false, nullsFirst: false })
        .limit(SEASON_WINNERS_LIMIT);

    if (error) throw error;
    if (!profiles || profiles.length === 0) return;

    const now = new Date();
    // O reset roda no início da nova temporada, mas o snapshot é da temporada que ACABOU de terminar
    // (mês anterior ao reset), então o label precisa recuar um mês em relação a `now`.
    const endedSeason = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const seasonLabel = `${endedSeason.getFullYear()}-${String(endedSeason.getMonth() + 1).padStart(2, '0')}`;

    const rows = profiles.map((p, index) => {
        const watchedMoviesList = p.watched_movies || [];
        const watchedEpisodesObj = p.watched_episodes || {};
        let episodesCountClean = 0;
        Object.keys(watchedEpisodesObj).forEach(key => {
            if (key !== '_active_seconds' && Array.isArray(watchedEpisodesObj[key])) {
                episodesCountClean += watchedEpisodesObj[key].length;
            }
        });

        const activeSecs = p.ranking_active_seconds ?? p.active_seconds ?? 0;
        const isVIP = p.is_vip === true && (!p.vip_until || new Date(p.vip_until) > now);
        const nickname = watchedEpisodesObj._nickname || null;

        return {
            season_label: seasonLabel,
            position: index + 1,
            user_id: p.id,
            // Sem username, cai pro nickname antes do genérico — senão o histórico de
            // temporada vira vários "Membro MultiCanaisHD" idênticos e anônimos.
            username: p.username || nickname || "Membro MultiCanaisHD",
            nickname,
            avatar: p.avatar || '1',
            is_vip: isVIP,
            total_hours: Math.round((activeSecs / 3600) * 10) / 10,
            movies_count: watchedMoviesList.length,
            episodes_count: episodesCountClean
        };
    }).filter(r => r.total_hours > 0);

    if (rows.length === 0) return;

    await supabaseAdmin.from('ranking_winners').delete().eq('season_label', seasonLabel);
    const { error: insertError } = await supabaseAdmin.from('ranking_winners').insert(rows);
    if (insertError) throw insertError;
}

export async function POST({ request }) {
    try {
        const body = await request.json();
        const { token } = body;

        // Verify basic mod token auth
        const MASTER_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');
        if (!MASTER_TOKEN || token !== MASTER_TOKEN) {
            return new Response(JSON.stringify({ error: "Acesso Negado." }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            await snapshotSeasonWinners();
        } catch (snapshotError) {
            console.error('[Admin] Erro ao salvar ganhadores da temporada:', snapshotError);
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ ranking_active_seconds: 0 })
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to target all rows

        if (error) {
            console.error('[Admin] Erro ao resetar ranking:', error);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('[Admin] Erro no catch do reset-ranking:', err);
        return new Response(JSON.stringify({ error: "Erro interno no servidor" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

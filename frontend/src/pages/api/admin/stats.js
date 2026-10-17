import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { supabaseAdmin } from "../../../services/supabase";

export const prerender = false;

const VIP_PLAN_BUCKETS = {
    1000: "vip10Count",
    2500: "vip25Count",
    8000: "vip80Count",
    1990: "vipDiamond19Count",
    4990: "vipDiamond49Count",
    14990: "vipDiamond149Count",
    // MultiCanaisHD VIP Black — ver vipPricingService.js para a fonte única destes valores.
    5000: "vipBlack50Count",
    12500: "vipBlack125Count",
    50000: "vipBlack500Count"
};

function normalizeAmount(amount) {
    return Math.round(Number(amount));
}

async function fetchProfilesById(userIds) {
    const { data } = await supabaseAdmin.from('profiles').select('id, username, email').in('id', userIds);
    return Object.fromEntries((data || []).map(p => [p.id, p]));
}

// Lista as sessões ativas com página atual + identificação (quando logado), pro painel
// mostrar não só a contagem mas o que cada usuário está vendo agora.
async function buildOnlineUsersList(fiveMinsAgo) {
    try {
        const { data: presenceRows } = await supabaseAdmin
            .from('online_presence')
            .select('session_id, last_seen, current_path, user_id')
            .gt('last_seen', fiveMinsAgo)
            .order('last_seen', { ascending: false })
            .limit(200);

        const userIds = [...new Set((presenceRows || []).map(r => r.user_id).filter(Boolean))];
        const profilesById = userIds.length > 0 ? await fetchProfilesById(userIds) : {};

        // `externo` separa quem esta assistindo no dominio de player externo de quem esta
        // dentro do site. A marca e o current_path, gravado por api/redirect/report.
        return (presenceRows || []).map(r => ({
            sessionId: r.session_id,
            lastSeen: r.last_seen,
            path: r.current_path || null,
            externo: typeof r.current_path === 'string' && r.current_path.startsWith('/redirect/'),
            label: profilesById[r.user_id]?.username || profilesById[r.user_id]?.email || null
        }));
    } catch (e) {
        console.warn("[Stats API] Falha ao montar lista de usuários online (migration pendente?):", e.message);
        return [];
    }
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const redis = await import("../../../services/redis-client.js").then(m => m.getRedisClient());
        const CACHE_KEY = "admin:stats:summary:v7";
        
        // 1. Tenta Cache (TTL 5 mins para painel administrativo)
        const nocache = url.searchParams.get("nocache") === "true";
        if (redis && !nocache) {
            const cached = await redis.get(CACHE_KEY);
            if (cached) {
                return new Response(cached, {
                    status: 200,
                    headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
                });
            }
        }

        const now = new Date();
        // 12 min: heartbeat do cliente é a cada 10 min (BaseLayout.astro)
        const fiveMinsAgo = new Date(now.getTime() - 12 * 60 * 1000).toISOString();

        const [
            { count: totalUsers },
            { count: vipUsers },
            { count: onlineNow },
            { data: apiUsage },
            { data: activeLicenses },
            onlineUsers
        ] = await Promise.all([
            supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('is_vip', true).gt('vip_until', now.toISOString()),
            supabaseAdmin.from('online_presence').select('*', { count: 'exact', head: true }).gt('last_seen', fiveMinsAgo),
            supabaseAdmin.from('api_usage').select('*').order('hits', { ascending: false }).limit(300),
            supabaseAdmin.from('developer_licenses').select('allowed_domain, plan').eq('status', 'active'),
            buildOnlineUsersList(fiveMinsAgo)
        ]);

        // Mapa dominio (normalizado) -> plano da licença B2B, para taguear cada site
        // monitorado como "Free" ou "Embed"/"Direct" — mesma normalização usada em
        // api/player.astro (sem www., minúsculo) para casar com o allowed_domain salvo.
        const domainKeyTypes = {};
        for (const license of activeLicenses || []) {
            if (!license.allowed_domain) continue;
            const domains = license.allowed_domain.split(',').map(d => d.trim().replace(/^www\./, '').toLowerCase());
            for (const d of domains) {
                if (!d || d === 'app' || d.startsWith('app:')) continue;
                domainKeyTypes[d] = license.plan === 'direct' ? 'direct' : 'embed';
            }
        }

        // Sinais de sandbox restritivo por domínio (tabela criada via migration manual —
        // tolera ausência da tabela sem quebrar o resto do endpoint).
        let adIntegrity = [];
        try {
            const { data } = await supabaseAdmin
                .from('embed_ad_integrity')
                .select('domain, sandbox_blocked_count, last_detected');
            adIntegrity = data || [];
        } catch (e) {
            console.warn("[Stats API] Tabela embed_ad_integrity indisponível:", e.message);
        }

        const domainAdIntegrity = {};
        for (const row of adIntegrity) {
            try {
                const hostname = (row.domain.startsWith('http://') || row.domain.startsWith('https://'))
                    ? new URL(row.domain).hostname
                    : row.domain;
                const normalized = hostname.replace(/^www\./, '').toLowerCase();
                if (!domainAdIntegrity[normalized]) {
                    domainAdIntegrity[normalized] = { sandboxBlockedCount: 0, lastDetected: row.last_detected };
                }
                domainAdIntegrity[normalized].sandboxBlockedCount += row.sandbox_blocked_count || 0;
                if (new Date(row.last_detected) > new Date(domainAdIntegrity[normalized].lastDetected)) {
                    domainAdIntegrity[normalized].lastDetected = row.last_detected;
                }
            } catch (_) {}
        }

        // Buscar todos os perfis que são VIPs ativos para classificar por categoria de plano
        const { data: activeVips } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('is_vip', true)
            .gt('vip_until', now.toISOString());

        const activeVipIds = activeVips ? activeVips.map(v => v.id) : [];

        let vip10Count = 0;
        let vip25Count = 0;
        let vip80Count = 0;
        let vipDiamond19Count = 0;
        let vipDiamond49Count = 0;
        let vipDiamond149Count = 0;
        let vipBlack50Count = 0;
        let vipBlack125Count = 0;
        let vipBlack500Count = 0;
        let vipManualCount = 0;

        if (activeVipIds.length > 0) {
            // Buscar os pagamentos aprovados desses usuários
            const { data: vipPayments } = await supabaseAdmin
                .from('payments')
                .select('user_id, amount, created_at')
                .in('user_id', activeVipIds)
                .eq('status', 'paid')
                .order('created_at', { ascending: false });

            // Mapear cada usuário para o seu último pagamento registrado
            const userLatestPaymentMap = {};
            if (vipPayments) {
                for (const p of vipPayments) {
                    const amount = normalizeAmount(p.amount);
                    if (!VIP_PLAN_BUCKETS[amount]) continue;
                    if (!userLatestPaymentMap[p.user_id]) {
                        userLatestPaymentMap[p.user_id] = amount;
                    }
                }
            }

            // Categorizar cada VIP ativo
            for (const vipId of activeVipIds) {
                const amount = userLatestPaymentMap[vipId];
                if (amount === 1000) {
                    vip10Count++;
                } else if (amount === 2500) {
                    vip25Count++;
                } else if (amount === 8000) {
                    vip80Count++;
                } else if (amount === 1990) {
                    vipDiamond19Count++;
                } else if (amount === 4990) {
                    vipDiamond49Count++;
                } else if (amount === 14990) {
                    vipDiamond149Count++;
                } else if (amount === 5000) {
                    vipBlack50Count++;
                } else if (amount === 12500) {
                    vipBlack125Count++;
                } else if (amount === 50000) {
                    vipBlack500Count++;
                } else {
                    vipManualCount++;
                }
            }
        }

        const statsData = {
            totalUsers: totalUsers || 0,
            vipUsers: vipUsers || 0,
            vip10Count,
            vip25Count,
            vip80Count,
            vipDiamond19Count,
            vipDiamond49Count,
            vipDiamond149Count,
            vipBlack50Count,
            vipBlack125Count,
            vipBlack500Count,
            vipManualCount,
            onlineNow: onlineNow || 0,
            onlineUsers,
            apiUsage: apiUsage || [],
            domainKeyTypes,
            domainAdIntegrity,
            generatedAt: now.toISOString()
        };

        const responseBody = JSON.stringify(statsData);

        // 2. Salva no Cache
        if (redis) {
            await redis.set(CACHE_KEY, responseBody, "EX", 300);
        }

        return new Response(responseBody, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "MISS" }
        });
    } catch (error) {
        console.error("[Stats API] Error fetching metrics:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

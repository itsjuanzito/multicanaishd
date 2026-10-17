import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { supabaseAdmin } from "../../../services/supabase";
import { axiomService } from "../../../services/axiom-service.js";

export const prerender = false;

const VIP_PLAN_LABELS = {
    1000: "1 Mês (R$ 10)",
    2500: "3 Meses (R$ 25)",
    8000: "1 Ano (R$ 80)",
    1990: "Diamond 1 Mês (R$ 19,90)",
    4990: "Diamond 3 Meses (R$ 49,90)",
    14990: "Diamond 1 Ano (R$ 149,90)",
    // MultiCanaisHD VIP Black — ver vipPricingService.js para a fonte única destes valores.
    5000: "Black 1 Mês (R$ 50)",
    12500: "Black 3 Meses (R$ 125)",
    50000: "Black 1 Ano (R$ 500)"
};

function getVipPlanLabel(amount) {
    const normalizedAmount = Math.round(Number(amount));
    return VIP_PLAN_LABELS[normalizedAmount] || null;
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const url = new URL(request.url);
    let query = url.searchParams.get("query"); // Email ou ID (opcional)
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    if (query) {
        query = query.trim();
        if (query.startsWith('#')) {
            query = query.substring(1).trim();
        }
    }

    try {
        const now = new Date().toISOString();
        let supabaseQuery;
        
        if (query) {
            // Busca flexível: BetterID (prefixo do ID), UUID exato ou e-mail
            const isShortId = query.length === 8 && /^[0-9a-fA-F]+$/.test(query);
            supabaseQuery = supabaseAdmin.from('profiles').select('*');
            if (isShortId) {
                const q = query.toLowerCase();
                const lowerBound = `${q}-0000-0000-0000-000000000000`;
                const upperBound = `${q}-ffff-ffff-ffff-ffffffffffff`;
                supabaseQuery = supabaseQuery.gte('id', lowerBound).lte('id', upperBound);
            } else {
                supabaseQuery = supabaseQuery.or(`email.ilike.%${query}%,username.ilike.%${query}%,watched_episodes->>_nickname.ilike.%${query}%,id.eq.${query.length === 36 ? query : '00000000-0000-0000-0000-000000000000'}`);
            }
        } else {
            // Se não houver query, listar todos os VIPs ativos
            supabaseQuery = supabaseAdmin
                .from('profiles')
                .select('*')
                .eq('is_vip', true)
                .gt('vip_until', now)
                .order('vip_until', { ascending: true });
        }

        const { data: users, error } = await supabaseQuery;

        if (error) throw error;

        // Buscar pagamentos para identificar os planos e datas de aquisição dos usuários encontrados
        let usersWithPlans = users || [];
        if (users && users.length > 0) {
            const userIds = users.map(u => u.id);
            const { data: payments } = await supabaseAdmin
                .from('payments')
                .select('user_id, amount, created_at')
                .in('user_id', userIds)
                .eq('status', 'paid')
                .order('created_at', { ascending: false });

            const userPaymentMap = {};
            if (payments) {
                for (const p of payments) {
                    if (!userPaymentMap[p.user_id] && getVipPlanLabel(p.amount)) {
                        userPaymentMap[p.user_id] = p;
                    }
                }
            }

            usersWithPlans = users.map(u => {
                const payment = userPaymentMap[u.id];
                const amount = payment ? payment.amount : null;
                const acquiredAt = payment ? payment.created_at : null;

                const planCategory = getVipPlanLabel(amount) || "Manual";

                return {
                    ...u,
                    nickname: u.watched_episodes?._nickname || u.username || null,
                    planCategory,
                    acquiredAt
                };
            });

            // Ordenar do mais recente (data de aquisição/criação decrescente) para o mais antigo
            usersWithPlans.sort((a, b) => {
                const dateA = a.acquiredAt ? new Date(a.acquiredAt).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
                const dateB = b.acquiredAt ? new Date(b.acquiredAt).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
                return dateB - dateA;
            });
        }

        return new Response(JSON.stringify({ users: usersWithPlans }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[Admin API] Search error:", error);
        axiomService.logError(error, { rota: "/api/admin/user-admin", method: "GET" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    try {
        const body = await request.json();
        const { userId, action, token } = body;
        const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        if (!userId || !action) {
            return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
        }

        let updateData = {};
        if (action === 'activate') {
            const planType = body.planType || 'basic'; // 'basic', 'diamond' ou 'black'
            const duration = body.duration || 'mensal'; // 'mensal', 'trimestral', 'anual'

            // Valores em centavos — mesma tabela de vipPricingService.js (fonte única do checkout).
            const AMOUNTS_BY_PLAN = {
                basic: { mensal: 1000, trimestral: 2500, anual: 8000 },
                diamond: { mensal: 1990, trimestral: 4990, anual: 14990 },
                black: { mensal: 5000, trimestral: 12500, anual: 50000 }
            };

            const days = duration === 'trimestral' ? 90 : (duration === 'anual' ? 365 : 30);
            const amount = (AMOUNTS_BY_PLAN[planType] || AMOUNTS_BY_PLAN.basic)[duration] || AMOUNTS_BY_PLAN.basic.mensal;

            // Busca o perfil atual para acumular dias se já for VIP
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('vip_until, is_vip')
                .eq('id', userId)
                .maybeSingle();

            let until = new Date();
            if (profile?.vip_until && profile.is_vip) {
                const currentVipUntil = new Date(profile.vip_until);
                if (currentVipUntil > until) {
                    until = currentVipUntil;
                }
            }
            until.setDate(until.getDate() + days);
            updateData = { 
                is_vip: true, 
                vip_until: until.toISOString()
            };

            // Registra um pagamento de cortesia para garantir que o sistema de faturamento e estatísticas computem perfeitamente
            const { error: paymentError } = await supabaseAdmin.from('payments').insert({
                user_id: userId,
                amount: amount,
                status: 'paid',
                livepix_reference: `MANUAL_${userId}_${Date.now()}`,
                livepix_id: `MANUAL_${Date.now()}`
            });
            if (paymentError) console.error("Error inserting manual grant payment:", paymentError);
        } else if (action === 'extend') {
            // Dias avulsos sobre o VIP vigente — sem registro em payments, não é receita.
            const days = Math.floor(Number(body.days));
            if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 3650) {
                return new Response(JSON.stringify({ error: "Invalid days" }), { status: 400 });
            }
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('vip_until, is_vip')
                .eq('id', userId)
                .maybeSingle();
            if (!profile?.is_vip || !profile?.vip_until) {
                return new Response(JSON.stringify({ error: "User is not VIP" }), { status: 400 });
            }
            const base = new Date(profile.vip_until);
            const until = base > new Date() ? base : new Date();
            until.setDate(until.getDate() + days);
            // Subtração que vence o VIP é revogação — exige o botão explícito de remover.
            if (days < 0 && until <= new Date()) {
                return new Response(JSON.stringify({ error: "Would expire VIP" }), { status: 400 });
            }
            updateData = { is_vip: true, vip_until: until.toISOString() };
        } else {
            updateData = { is_vip: false, vip_until: null };
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update(updateData)
            .eq('id', userId);

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, action }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[Admin API] Update error:", error);
        axiomService.logError(error, { rota: "/api/admin/user-admin", method: "POST" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

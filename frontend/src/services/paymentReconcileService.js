// src/services/paymentReconcileService.js
//
// Rede de segurança do crédito de VIP: reconfirma direto na API da VeloraPay
// todo pagamento que ficou `pending` no nosso banco e ativa o VIP se ele
// estiver pago.
//
// Por que existe (herdado da era LivePix, motivo continua valendo): a
// ativação nunca pode depender só do webhook chegar. Ele pode não chegar por
// motivo nenhum relacionado ao gateway em si (filtro anti-bot do middleware
// devolvendo 403, migração de domínio deixando a URL velha apontando pra um
// 301, etc.) — e o sintoma é mudo: o cliente paga, nada acontece, e só se
// descobre quando ele reclama.
//
// A regra é a mesma do webhook: o que credita é a consulta à API da
// VeloraPay, nunca o que está gravado localmente. Aqui só muda QUEM decide
// checar — é tempo decorrido, em vez de um POST deles chegando.
import { supabaseAdmin } from "./supabase";
import { verifyPayment } from "./velorapay.js";
import { vipPlanForPriceCents, vipDurationDays } from "./vipPricingService.js";

// Margem pro webhook chegar primeiro quando ele estiver funcionando; menor
// que o intervalo do cron (10min), senão o disparo seguinte pula o pagamento
// por alguns segundos de idade.
const MIN_AGE_MS = 3 * 60 * 1000;

// Acima disto a compra já é tratada como abandonada — reconciliar reabriria
// como paga uma cobrança que o próprio cliente desistiu de concluir.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Teto por disparo: cada pagamento custa pelo menos uma chamada à API deles,
// e pagamento é raro. Sem teto, uma tabela cheia de pendentes antigos viraria
// uma rajada contra a VeloraPay.
const MAX_PER_RUN = 20;

/** Data de expiração do VIP, sempre somando sobre o que o usuário já tinha. */
function nextVipUntil(currentVipUntil, days) {
    const base = new Date();
    const atual = currentVipUntil ? new Date(currentVipUntil) : null;
    if (atual && atual > base) base.setTime(atual.getTime());
    base.setDate(base.getDate() + days);
    return base;
}

/**
 * Ativa o VIP de um pagamento já confirmado como pago.
 *
 * Compartilhada com o webhook de propósito: duas cópias da regra de crédito é
 * exatamente como o mapa de planos ficou desatualizado quando o Black entrou.
 * A duração vem sempre do vipPricingService, nunca de valores recopiados.
 */
export async function activateVipForPayment(dbPayment) {
    const plano = vipPlanForPriceCents(dbPayment.amount);
    const days = plano ? vipDurationDays(plano.duration) : 30;

    const { data: perfil } = await supabaseAdmin
        .from("profiles").select("email, vip_until").eq("id", dbPayment.user_id).single();

    const vipUntil = nextVipUntil(perfil?.vip_until, days);

    const { error } = await supabaseAdmin
        .from("profiles")
        .update({ is_vip: true, vip_until: vipUntil.toISOString() })
        .eq("id", dbPayment.user_id);
    if (error) throw error;

    await supabaseAdmin.from("payments").update({ status: "paid" }).eq("id", dbPayment.id);

    return { email: perfil?.email || "Usuário Desconhecido", days, vipUntil, plano };
}

/** Pendentes dentro da janela [MIN_AGE, MAX_AGE], mais antigos primeiro. */
async function fetchPendingPayments() {
    const agora = Date.now();
    const { data, error } = await supabaseAdmin
        .from("payments")
        .select("id, user_id, amount, livepix_reference, created_at")
        .eq("status", "pending")
        .lte("created_at", new Date(agora - MIN_AGE_MS).toISOString())
        .gte("created_at", new Date(agora - MAX_AGE_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(MAX_PER_RUN);

    if (error) throw error;
    // Ativação manual não tem referência na VeloraPay pra consultar.
    return (data || []).filter((p) => p.livepix_reference && !p.livepix_reference.startsWith("MANUAL_"));
}

/** Reconcilia um pagamento. Devolve o resultado da ativação, ou null se não está pago. */
async function reconcileOne(pagamento) {
    const check = await verifyPayment({ reference: pagamento.livepix_reference, expectedAmountCents: pagamento.amount });
    if (!check.ok) return null;
    return activateVipForPayment(pagamento);
}

/**
 * Varre os pendentes e ativa o que estiver pago. Nunca lança: um pagamento
 * que falhe não pode impedir os outros do mesmo disparo de serem creditados.
 */
export async function reconcilePendingPayments() {
    const pendentes = await fetchPendingPayments();
    const ativados = [];

    for (const pagamento of pendentes) {
        try {
            const resultado = await reconcileOne(pagamento);
            if (resultado) ativados.push({ ...resultado, reference: pagamento.livepix_reference });
        } catch (error) {
            console.error(`[Reconcile] Falha no pagamento ${pagamento.livepix_reference}:`, error?.message || error);
        }
    }

    return { checked: pendentes.length, activated: ativados };
}

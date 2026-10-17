// src/pages/api/payment-status/[reference].js
//
// Polling da página /pagamento/[reference]: reconfirma UM pagamento contra a
// VeloraPay (nunca confia em estado local) e credita se estiver pago — mesma
// regra do webhook, só que disparada pelo navegador do próprio comprador em
// vez de um POST deles chegando.
import { supabase, supabaseAdmin } from "../../../services/supabase";
import { verifyPayment, paymentExpiresAt } from "../../../services/velorapay.js";
import { activateVipForPayment } from "../../../services/paymentReconcileService.js";
import { setRuntimeEnv } from "../../../services/env-adapter.js";
import { vipPlanForPriceCents } from "../../../services/vipPricingService.js";
import { CRYPTO_CURRENCIES } from "../../../services/cryptoCurrencies.js";

export const prerender = false;

/** Dados de exibição (QR/copia-e-cola ou endereço cripto) — a página os usa uma vez no load; o polling seguinte só olha `status`. */
function paymentDetails(dbPayment) {
    const plano = vipPlanForPriceCents(dbPayment.amount);
    const isCrypto = dbPayment.method === "crypto";
    return {
        amount: dbPayment.amount,
        method: dbPayment.method || "pix",
        planLabel: plano ? `${plano.planName.replace("vip_", "").toUpperCase()} — ${plano.duration}` : null,
        pixQrBase64: dbPayment.pix_qr_base64 || null,
        pixCopyPaste: dbPayment.pix_copy_paste || null,
        cryptoPayAddress: dbPayment.crypto_pay_address || null,
        cryptoPayAmount: dbPayment.crypto_pay_amount || null,
        cryptoCurrencyLabel: isCrypto ? (CRYPTO_CURRENCIES.find((c) => c.code === dbPayment.crypto_pay_currency)?.label || dbPayment.crypto_pay_currency) : null,
        cryptoExpiresAt: dbPayment.crypto_expires_at || null,
        expiresAt: paymentExpiresAt(dbPayment)
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

export async function GET({ params, request, locals }) {
    if (locals?.runtime?.env) setRuntimeEnv(locals.runtime.env);

    try {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ success: false, error: "Não autorizado" }, 401);

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return json({ success: false, error: "Usuário não autenticado" }, 401);

        const reference = String(params.reference || "");

        // Exige a MESMA sessão que criou a cobrança: sem isso, qualquer um que
        // adivinhasse a URL de outra pessoa poderia ficar checando o pagamento
        // dela — não creditaria nada indevido (quem credita é sempre o dono da
        // linha), mas vazaria status de pagamento de terceiro.
        const { data: dbPayment, error: paymentError } = await supabaseAdmin
            .from("payments")
            .select("*")
            .eq("livepix_reference", reference)
            .eq("user_id", user.id)
            .single();

        if (paymentError || !dbPayment) return json({ success: false, error: "Pagamento não encontrado." }, 404);

        if (dbPayment.status !== "pending") {
            return json({ success: true, status: dbPayment.status, ...paymentDetails(dbPayment) });
        }

        try {
            const check = await verifyPayment({ reference, expectedAmountCents: dbPayment.amount });
            if (check.ok) {
                await activateVipForPayment(dbPayment);
                return json({ success: true, status: "paid", ...paymentDetails(dbPayment) });
            }
        } catch (error) {
            console.error("[payment-status] Falha ao reconfirmar pagamento:", error);
        }

        return json({ success: true, status: "pending", ...paymentDetails(dbPayment) });
    } catch (error) {
        console.error("[payment-status] Erro:", error);
        return json({ success: false, error: error.message }, 500);
    }
}

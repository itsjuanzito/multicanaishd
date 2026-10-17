// src/pages/api/webhooks/velorapay.js
import { supabaseAdmin } from "../../../services/supabase";
import { isValidWebhookSignature, verifyPayment } from "../../../services/velorapay.js";
import { activateVipForPayment } from "../../../services/paymentReconcileService.js";
import { axiomService } from "../../../services/axiom-service.js";
import { notifyVipDiscord } from "../../../services/vipNotifyService.js";
import { setRuntimeEnv } from "../../../services/env-adapter.js";

export const prerender = false;

// A VeloraPay assina o corpo com HMAC-SHA256 (header `x-velorapay-signature`,
// prefixo `sha256=`) — SEMPRE validado antes de olhar o payload. Mesmo assim
// quem credita é a reconfirmação via GET /payments/:id (verifyPayment), nunca
// o payload em si: assinatura provada não é o mesmo que "o pagamento
// realmente aconteceu", é defesa em profundidade.
export async function POST({ request, locals }) {
    if (locals?.runtime?.env) setRuntimeEnv(locals.runtime.env);

    const rawBody = await request.text();

    try {
        const signature = request.headers.get("x-velorapay-signature");
        const validSignature = await isValidWebhookSignature(rawBody, signature);
        if (!validSignature) {
            await notifyVipDiscord("⚠️ Webhook VeloraPay recebido com assinatura inválida.", "warning");
            return new Response(JSON.stringify({ error: "Assinatura inválida" }), { status: 401 });
        }

        let body;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return new Response(JSON.stringify({ error: "Payload inválido" }), { status: 400 });
        }

        // A doc pode embrulhar em `data` ou mandar direto — cobre os dois.
        const transactionId = body?.data?.transactionId || body?.transactionId || body?.data?.id || body?.id;

        if (!transactionId) {
            await notifyVipDiscord("⚠️ Webhook VeloraPay sem transactionId no payload.", "warning");
            // 200 de propósito: um payload sem transactionId nunca vai ficar
            // "correto" numa reentrega — devolver 4xx só faz a VeloraPay
            // reentregar o mesmo evento quebrado.
            return new Response(JSON.stringify({ message: "Payload sem transactionId" }), { status: 200 });
        }

        // 3. Localizar no banco
        const { data: dbPayment, error: paymentError } = await supabaseAdmin
            .from("payments")
            .select("*")
            .eq("livepix_reference", transactionId)
            .single();

        if (paymentError || !dbPayment) {
            // 200 de propósito, mesmo raciocínio: reentrega não cria o registro
            // que falta. O usuário pode ter fechado a aba antes do registro
            // local existir, ou o evento é de outro projeto na mesma conta.
            return new Response(JSON.stringify({ message: "Referência não encontrada" }), { status: 200 });
        }

        if (dbPayment.status === "paid") {
            return new Response(JSON.stringify({ message: "VIP já processado" }), { status: 200 });
        }

        // 4. Reconfirmar DIRETO com a VeloraPay antes de creditar qualquer coisa.
        const check = await verifyPayment({ reference: transactionId, expectedAmountCents: dbPayment.amount });
        if (!check.ok) {
            await notifyVipDiscord(`Webhook VeloraPay para \`${transactionId}\`: pagamento ainda não confirmado (${check.reason}).`, "info");
            return new Response(JSON.stringify({ message: `Pagamento não confirmado (${check.reason})` }), { status: 200 });
        }

        // 5. Ativação do VIP — mesma regra usada pela reconciliação por cron/polling.
        const resultado = await activateVipForPayment(dbPayment);

        const planoTexto = resultado.plano ? `${resultado.plano.planName} ${resultado.plano.duration}` : "valor não reconhecido";
        await notifyVipDiscord(
            `**VIP Ativado via Webhook VeloraPay!**\n\n` +
            `**Usuário:** ${resultado.email}\n**Plano:** ${planoTexto} (+${resultado.days} Dias)\n` +
            `**Expira em:** ${resultado.vipUntil.toLocaleDateString("pt-BR")}\n**Ref:** \`${transactionId}\``,
            "success"
        );

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
        console.error("[Webhook VeloraPay Error]:", error);
        axiomService.logError(error, { rota: "/api/webhooks/velorapay" }).catch(() => {});
        await notifyVipDiscord(`❌ **Falha crítica no processamento do webhook VeloraPay:**\n\`${error.message}\``, "error").catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

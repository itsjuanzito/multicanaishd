// src/pages/api/internal/reconcile-payments.js
//
// Chamado pelo cron-worker a cada 10 minutos. Reconfirma na API da VeloraPay
// os pagamentos que ficaram `pending` e ativa o VIP de quem já pagou — ver o
// cabeçalho de paymentReconcileService.js pro porquê de não depender só do
// webhook.
import { reconcilePendingPayments } from "../../../services/paymentReconcileService.js";
import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { notifyVipDiscord } from "../../../services/vipNotifyService.js";

export const prerender = false;

function isAuthorized(request) {
    const secret = getEnv('CRON_SECRET');
    if (!secret) return false;
    const secretParam = new URL(request.url).searchParams.get('secret');
    return request.headers.get('authorization') === `Bearer ${secret}` || secretParam === secret;
}

/** Avisa no Discord só quando algo foi ativado — disparo vazio a cada 10min viraria ruído. */
async function notifyActivations(ativados) {
    for (const vip of ativados) {
        const plano = vip.plano ? `${vip.plano.planName} ${vip.plano.duration}` : "valor não reconhecido";
        await notifyVipDiscord(
            `**VIP Ativado (reconciliação, não pelo webhook)**\n\n` +
            `**Usuário:** ${vip.email}\n**Plano:** ${plano} (+${vip.days} dias)\n` +
            `**Expira em:** ${vip.vipUntil.toLocaleDateString('pt-BR')}\n**Ref:** \`${vip.reference}\``,
            "success"
        ).catch(() => {});
    }
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) setRuntimeEnv(locals.runtime.env);

    if (!isAuthorized(request)) {
        return new Response('Não autorizado.', { status: 401 });
    }

    try {
        const resultado = await reconcilePendingPayments();
        await notifyActivations(resultado.activated);

        return new Response(JSON.stringify({
            success: true,
            checked: resultado.checked,
            activated: resultado.activated.length
        }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' } });
    } catch (error) {
        console.error("[Reconcile] Falha geral:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// src/services/vipNotifyService.js
//
// Avisos de pagamento/VIP no Discord. Extraído do webhook do LivePix porque
// agora existe um segundo caminho que credita VIP (paymentReconcileService, via
// /api/internal/reconcile-payments) e os dois precisam avisar no mesmo canal —
// um caminho que credita em silêncio é justamente o que fez a quebra do webhook
// passar dias sem ser notada.
import { getEnv } from "./env-adapter";
import { fetchWithTimeout } from "./fetch-util";
import { axiomService } from "./axiom-service.js";

const CORES = { info: 0x3498db, success: 0x2ecc71, error: 0xe74c3c, warning: 0xf1c40f };
const TITULOS = {
    info: "ℹ️ Webhook Log",
    success: "✅ VIP Ativado",
    error: "❌ Erro Webhook",
    warning: "⚠️ Aviso Webhook"
};

/**
 * Manda um aviso ao canal de VIP. Nunca lança: uma falha de notificação não pode
 * derrubar o fluxo de quem já teve (ou não) o VIP creditado.
 */
export async function notifyVipDiscord(message, type = "info") {
    const webhookUrl = getEnv('DISCORD_WEBHOOK_VIP');
    if (!webhookUrl) {
        // Sem esta var o aviso fica MUDO: uma falha de ativação de VIP vira silêncio
        // total. Registra no Axiom pra que a ausência seja detectável em algum lugar.
        axiomService.logError(new Error("DISCORD_WEBHOOK_VIP não configurada"), { origem: "vipNotifyService" }).catch(() => {});
        return;
    }

    try {
        await fetchWithTimeout(webhookUrl, {
            timeout: 5000,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: TITULOS[type] || TITULOS.info,
                    description: message,
                    color: CORES[type] || CORES.info,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (error) {
        console.error("Erro ao notificar Discord:", error);
    }
}

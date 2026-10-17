// src/services/velorapay.js
// Integração com a VeloraPay (velorapay.com.br/docs) — substitui LivePix +
// Ko-fi + NOWPayments (2026-09). Auth é `x-api-key`/`x-api-secret` fixos, sem
// OAuth — não há token pra cachear/renovar como no LivePix.
//
// Duas diferenças importantes em relação ao LivePix que moldam este módulo:
// - Não existe checkout hospedado pra cobrança criada via API (só existe pra
//   Links de Pagamento, que exigem sessão de painel, não API key). Por isso
//   `/api/vip/checkout.js` monta a PRÓPRIA página (`/pagamento/[reference]`)
//   pra mostrar QR/copia-e-cola ou endereço cripto.
// - `GET /payments/:id` NÃO devolve o QR/copia-e-cola de volta — só o status.
//   Por isso o dado de exibição (QR, copia-e-cola, endereço cripto) precisa
//   ser persistido no momento da criação, não recalculado depois.
//
// Lida via getEnv() de env-adapter.js — que já resolve o problema do
// `import.meta.env` fixado em build: ele prioriza o env injetado pelo
// middleware a partir de `Astro.locals.runtime.env` (lido em CADA
// requisição), caindo pra `import.meta.env` só como último recurso local.
import { getEnv } from "./env-adapter.js";

const API_BASE = "https://api.velorapay.com.br";

function apiKey() {
    return getEnv("VELORAPAY_API_KEY");
}

function apiSecret() {
    return getEnv("VELORAPAY_API_SECRET");
}

export function isVeloraPayConfigured() {
    return Boolean(apiKey() && apiSecret());
}

async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "x-api-key": apiKey(),
            "x-api-secret": apiSecret(),
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.error || body?.message || "";
        throw new Error(`VeloraPay ${options.method || "GET"} ${path} falhou: ${response.status} ${message}`.trim());
    }

    return body;
}

/**
 * Cria uma cobrança PIX. `amountCents` deve vir SEMPRE do catálogo do
 * servidor (vipPricingService), nunca do corpo do request.
 *
 * `callbackUrl` é opcional: a VeloraPay notifica essa URL específica da
 * transação (independente da URL única cadastrada no painel da conta, que já
 * aponta pro projeto irmão StreamBetter). Em dev local (`localhost`/interno)
 * a VeloraPay recusa esse campo com 400 (proteção anti-SSRF) — quem chama
 * decide se manda ou não.
 */
export async function createPayment({ amountCents, payerName, payerDocument, description, callbackUrl, idempotencyKey }) {
    const result = await apiFetch("/payments/create", {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify({
            amount: Number((amountCents / 100).toFixed(2)),
            payerName,
            payerDocument,
            description,
            ...(callbackUrl ? { callbackUrl } : {})
        })
    });

    const data = result?.data || result;
    if (!data?.transactionId || !data?.copyPaste) {
        throw new Error("VeloraPay não devolveu transactionId/copyPaste na criação da cobrança.");
    }

    // A doc mostra o exemplo já como data URI, mas o sandbox real devolve só
    // o base64 cru (confirmado no streambetter, o projeto irmão que já fez
    // esta mesma migração). Normaliza aqui pra quem consome (`<img src>` da
    // página de pagamento) nunca precisar saber dessa diferença.
    let qrCodeBase64 = data.qrCodeBase64 || null;
    if (qrCodeBase64 && !qrCodeBase64.startsWith("data:")) {
        qrCodeBase64 = `data:image/png;base64,${qrCodeBase64}`;
    }

    return {
        reference: data.transactionId,
        qrCodeBase64,
        copyPaste: data.copyPaste
    };
}

/**
 * Cria uma cobrança em CRIPTO (cash-in): o cliente paga em cripto pro
 * `payAddress` devolvido, e o valor é creditado em REAIS na carteira da
 * VeloraPay assim que a rede confirmar — a conversão é toda do lado deles,
 * nunca lidamos com carteira/custódia cripto nenhuma.
 */
export async function createCryptoPayment({ amountCents, payCurrency, payerName, payerDocument, description, callbackUrl, idempotencyKey }) {
    const result = await apiFetch("/crypto/payment", {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify({
            amount: Number((amountCents / 100).toFixed(2)),
            payCurrency,
            payerName,
            payerDocument,
            description,
            ...(callbackUrl ? { callbackUrl } : {})
        })
    });

    const data = result?.data || result;
    if (!data?.transactionId || !data?.payAddress) {
        throw new Error("VeloraPay não devolveu transactionId/payAddress na criação da cobrança cripto.");
    }

    return {
        reference: data.transactionId,
        payAddress: data.payAddress,
        payAmount: data.payAmount,
        payCurrency: data.payCurrency,
        network: data.network,
        expiresAt: data.expiresAt
    };
}

export async function getPayment(transactionId) {
    const result = await apiFetch(`/payments/${encodeURIComponent(transactionId)}`);
    return result?.data || result || null;
}

/**
 * Confirma, FALANDO COM A VELORAPAY, que a cobrança foi paga e pelo valor
 * certo — nunca confia no corpo do webhook nem no que está gravado
 * localmente. `status: 'COMPLETED'` é o sinal de pago.
 */
export async function verifyPayment({ reference, expectedAmountCents }) {
    let payment = null;

    try {
        if (reference) payment = await getPayment(reference);
    } catch (error) {
        console.error("[velorapay] Falha ao consultar pagamento:", error);
        return { ok: false, reason: "lookup_failed" };
    }

    if (!payment) return { ok: false, reason: "not_found" };
    if (payment.status !== "COMPLETED") return { ok: false, reason: "not_paid" };

    // Valor pago (reais, decimal) precisa cobrir o cobrado (centavos). `<` e
    // não `!==` de propósito: pagar a mais é problema do cliente, pagar a
    // menos não pode liberar o plano.
    const paidCents = Math.round(Number(payment.amount) * 100);
    if (!Number.isFinite(paidCents) || paidCents < Number(expectedAmountCents)) {
        return { ok: false, reason: "amount_mismatch" };
    }

    return { ok: true, payment };
}

/**
 * Assinatura HMAC-SHA256 do webhook (header `x-velorapay-signature`,
 * prefixo `sha256=`) sobre o corpo CRU. `crypto.subtle` funciona tanto em
 * Workers/Pages quanto em Node moderno, sem depender de `node:crypto`.
 *
 * Validar a assinatura não é o mesmo que "o pagamento realmente aconteceu" —
 * é defesa em profundidade. Quem credita de fato é sempre verifyPayment().
 */
export async function isValidWebhookSignature(rawBody, signatureHeader) {
    const secret = getEnv("VELORAPAY_WEBHOOK_SECRET");
    if (!secret) {
        console.warn("[velorapay] VELORAPAY_WEBHOOK_SECRET não configurado — assinatura não verificada.");
        return true;
    }

    const provided = String(signatureHeader || "").replace(/^sha256=/, "");
    if (!provided) return false;

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    if (provided.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

// Prazo mostrado ao cliente pra pagar o PIX antes de considerar o QR velho o
// bastante pra valer a pena gerar outro. A VeloraPay não devolve nenhum
// `expiresAt`/TTL pra PIX (confirmado contra produção: a resposta de
// `POST /payments/create` só tem transactionId/externalId/amount/fee/
// netAmount/status/qrCodeBase64/qrcodeUrl/copyPaste) — então isto é decisão
// nossa de UX, não algo que o gateway imponha. Cripto usa o `expiresAt` real
// que a API devolve na criação (ver createCryptoPayment).
export const PIX_DISPLAY_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Prazo de exibição do pagamento: `expiresAt` real da VeloraPay pra cripto,
 * ou `created_at + PIX_DISPLAY_EXPIRY_MS` pra PIX. Só de exibição — quem
 * decide "expirou de verdade" continua sendo verifyPayment() contra a API.
 */
export function paymentExpiresAt(dbPayment) {
    if (dbPayment?.method === "crypto") return dbPayment.crypto_expires_at || null;
    const created = new Date(dbPayment?.created_at).getTime();
    if (!Number.isFinite(created)) return null;
    return new Date(created + PIX_DISPLAY_EXPIRY_MS).toISOString();
}

/**
 * Origem pública de verdade (não localhost/interna) — a VeloraPay recusa
 * `callbackUrl` apontando pra endereço interno/reservado com 400 (proteção
 * anti-SSRF), o que inclui `localhost` em dev local.
 */
export function isPublicOrigin(origin) {
    try {
        const host = new URL(origin).hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
        if (host.endsWith(".local")) return false;
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

// src/pages/api/vip/checkout.js
import { supabase, supabaseAdmin } from "../../../services/supabase";
import { createPayment, createCryptoPayment, isVeloraPayConfigured, isPublicOrigin } from "../../../services/velorapay.js";
import { isValidCryptoCurrency, findCryptoCurrency, DEFAULT_CRYPTO_CURRENCY } from "../../../services/cryptoCurrencies.js";
import { setRuntimeEnv } from "../../../services/env-adapter.js";
import { axiomService } from "../../../services/axiom-service.js";
import { vipPlanForPriceCents, isKnownVipPriceCents } from "../../../services/vipPricingService.js";

export const prerender = false;

// A VeloraPay exige `payerDocument` (CPF/CNPJ) pra criar a cobrança, mas só
// valida o FORMATO — testado contra o sandbox: CPF "00000000000" é aceito,
// só documento vazio/ausente é recusado. Não vale a pena pedir CPF de
// verdade do cliente só pra satisfazer um campo que o gateway não confere;
// um CPF de teste com checksum válido resolve sem fricção na compra.
const PLACEHOLDER_DOCUMENT = "11144477735";

function describePlan(amountCents) {
    const plano = vipPlanForPriceCents(amountCents);
    if (!plano) return `Assinatura MultiCanaisHD VIP (${amountCents} centavos)`;
    return `MultiCanaisHD VIP ${plano.planName.replace("vip_", "").toUpperCase()} — ${plano.duration}`;
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    const jsonHeaders = { "Content-Type": "application/json" };

    try {
        // 1. Verificar se o usuário está logado (pegando o token do Header)
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
        if (!token) {
            return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: jsonHeaders });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Usuário não autenticado" }), { status: 401, headers: jsonHeaders });
        }

        // 2. Extrair o gateway e o plano selecionado do body (Padrão: pix e R$ 10,00)
        let gateway = "pix";
        let amount = 1000; // Padrão: 1000 centavos = R$ 10,00
        let payCurrency = DEFAULT_CRYPTO_CURRENCY;
        try {
            const body = await request.clone().json();
            // Compat: telas antigas ainda podem mandar "livepix" — trata como "pix".
            gateway = body.gateway === "livepix" ? "pix" : (body.gateway || "pix");
            if (body.payCurrency) payCurrency = String(body.payCurrency);

            // Segurança Proativa: Whitelist estrita para impedir fraude de alteração de preço
            if (body.amount) {
                const parsedAmount = parseInt(body.amount, 10);
                if (isKnownVipPriceCents(parsedAmount)) {
                    amount = parsedAmount;
                }
            }
        } catch (e) {}

        const origin = new URL(request.url).origin;

        if (gateway === "lemonsqueezy") {
            const productUrl = locals.runtime?.env?.LEMONSQUEEZY_CHECKOUT_URL || import.meta.env.LEMONSQUEEZY_CHECKOUT_URL || "https://multicanaishd.lemonsqueezy.com/checkout/buy/default";

            const checkoutUrl = new URL(productUrl);
            checkoutUrl.searchParams.set("checkout[custom][user_id]", user.id);
            checkoutUrl.searchParams.set("checkout[email]", user.email);

            console.log(`[Checkout API] Gerado link Lemon Squeezy para o usuário ${user.id}`);

            return new Response(JSON.stringify({
                success: true,
                checkoutUrl: checkoutUrl.toString()
            }), { status: 200, headers: jsonHeaders });
        }

        // Gateway padrão: VeloraPay (PIX ou cripto), com valor dinâmico seguro.
        if (gateway !== "pix" && gateway !== "crypto") {
            return new Response(JSON.stringify({ error: "Método de pagamento inválido." }), { status: 400, headers: jsonHeaders });
        }

        if (gateway === "crypto" && !isValidCryptoCurrency(payCurrency)) {
            return new Response(JSON.stringify({ error: "Moeda cripto inválida." }), { status: 400, headers: jsonHeaders });
        }

        // Abaixo do mínimo da moeda a VeloraPay responde 502 sem mensagem; sem
        // esta checagem o cliente veria só um erro genérico.
        if (gateway === "crypto" && amount < findCryptoCurrency(payCurrency).minCents) {
            const currency = findCryptoCurrency(payCurrency);
            const minReais = (currency.minCents / 100).toFixed(2).replace(".", ",");
            return new Response(JSON.stringify({ error: `${currency.label} aceita a partir de R$ ${minReais}. Escolha outra moeda.` }), { status: 400, headers: jsonHeaders });
        }

        if (!isVeloraPayConfigured()) {
            return new Response(JSON.stringify({ error: "Pagamento indisponível no momento." }), { status: 503, headers: jsonHeaders });
        }

        // 1. Criar registro pendente no nosso banco para obtermos um ID interno
        const { data: dbPayment, error: dbError } = await supabaseAdmin
            .from("payments")
            .insert({
                user_id: user.id,
                amount: amount,
                status: "pending",
                method: gateway
            })
            .select()
            .single();

        if (dbError) throw dbError;

        // Sem callbackUrl em dev local: a VeloraPay recusa (400, anti-SSRF)
        // qualquer URL que resolva pra endereço interno/reservado. Em produção,
        // aponta pro NOSSO webhook — a única URL cadastrada no painel da conta
        // já pertence a outro projeto (StreamBetter), então cada transação
        // precisa carregar a própria URL de notificação.
        const callbackUrl = isPublicOrigin(origin) ? `${origin}/api/webhooks/velorapay` : undefined;
        const description = describePlan(amount);
        const idempotencyKey = `vip-checkout-${user.id}-${amount}-${gateway}-${dbPayment.id}`;

        try {
            let reference;
            let extraFields = {};

            if (gateway === "crypto") {
                const result = await createCryptoPayment({
                    amountCents: amount,
                    payCurrency,
                    payerName: user.user_metadata?.username || user.email,
                    payerDocument: PLACEHOLDER_DOCUMENT,
                    description,
                    callbackUrl,
                    idempotencyKey
                });
                reference = result.reference;
                extraFields = {
                    crypto_pay_address: result.payAddress,
                    crypto_pay_amount: result.payAmount,
                    crypto_pay_currency: result.payCurrency,
                    crypto_expires_at: result.expiresAt || null
                };
            } else {
                const result = await createPayment({
                    amountCents: amount,
                    payerName: user.user_metadata?.username || user.email,
                    payerDocument: PLACEHOLDER_DOCUMENT,
                    description,
                    callbackUrl,
                    idempotencyKey
                });
                reference = result.reference;
                extraFields = {
                    pix_qr_base64: result.qrCodeBase64,
                    pix_copy_paste: result.copyPaste
                };
            }

            await supabaseAdmin
                .from("payments")
                .update({
                    livepix_reference: reference,
                    livepix_id: reference,
                    ...extraFields
                })
                .eq("id", dbPayment.id);

            const checkoutUrl = `${origin}/pagamento/${encodeURIComponent(reference)}`;

            return new Response(JSON.stringify({
                success: true,
                checkoutUrl
            }), { status: 200, headers: jsonHeaders });
        } catch (gatewayError) {
            // Cobrança nunca chegou a existir na VeloraPay: não deixa uma linha
            // `pending` órfã pra a reconciliação tentar consultar pra sempre.
            await supabaseAdmin.from("payments").delete().eq("id", dbPayment.id);
            throw gatewayError;
        }
    } catch (error) {
        console.error("[Checkout API Error]:", error);
        axiomService.logError(error, { rota: "/api/vip/checkout" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
}

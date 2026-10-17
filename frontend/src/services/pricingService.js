// src/services/pricingService.js
// Fonte única de verdade para os preços das licenças B2B (antes duplicado em
// checkout.js, pay-pending-key.js e renew-key.js) e para promoções temporárias
// configuráveis via /moderacao — sem precisar de deploy/código novo a cada promoção.
import { getConfig } from "./configService.js";

export const PLAN_PRICES_CENTS = {
    embed: 10000,  // R$ 100,00
    direct: 20000  // R$ 200,00
};

function normalizePlan(plan) {
    return plan === "direct" ? "direct" : "embed";
}

function parsePromoBlob(raw) {
    try {
        const parsed = JSON.parse(raw || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
        return {};
    }
}

/**
 * Retorna a promoção ativa para o plano (ou null se não houver/expirou).
 * A expiração é checada na leitura — não precisa de nenhum job de limpeza para
 * "voltar ao normal", basta o horário passar.
 */
export async function getActivePromo(plan) {
    const normalizedPlan = normalizePlan(plan);
    const raw = await getConfig("B2B_PROMO", "{}");
    const blob = parsePromoBlob(raw);
    const promo = blob[normalizedPlan];

    if (!promo || !promo.priceCents || !promo.endsAt) return null;

    const now = Date.now();
    const startsAt = promo.startsAt ? new Date(promo.startsAt).getTime() : 0;
    const endsAt = new Date(promo.endsAt).getTime();

    if (Number.isNaN(endsAt) || now >= endsAt) return null;
    if (startsAt && now < startsAt) return null;

    return promo;
}

/**
 * Preço efetivo em centavos para o plano, já considerando promoção ativa.
 */
export async function getEffectivePriceCents(plan) {
    const normalizedPlan = normalizePlan(plan);
    const promo = await getActivePromo(normalizedPlan);
    return promo ? promo.priceCents : PLAN_PRICES_CENTS[normalizedPlan];
}

/**
 * Todos os valores em centavos que o webhook da LivePix deve reconhecer como
 * pagamento B2B legítimo (preços normais + qualquer promoção configurada, mesmo
 * que já tenha expirado no momento da checagem — pagamento pode ter sido iniciado
 * um pouco antes do fim da promoção e confirmado logo depois).
 */
export async function getAllKnownPriceCentsForOrphanCheck() {
    const raw = await getConfig("B2B_PROMO", "{}");
    const blob = parsePromoBlob(raw);
    const promoAmounts = Object.values(blob)
        .map((p) => p?.priceCents)
        .filter((v) => typeof v === "number" && v > 0);

    return [...new Set([...Object.values(PLAN_PRICES_CENTS), ...promoAmounts])];
}

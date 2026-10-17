// src/services/vipPricingService.js
// Fonte única de verdade dos planos VIP: o valor em centavos define o plano e a duração.
// Antes esse mapa vivia duplicado como uma cadeia de if em /api/vip/checkout.js, enquanto o
// webhook da NowPayments lia plano e duração de uma string vinda no corpo da requisição.

export const VIP_PLANS_BY_PRICE_CENTS = {
    1000:  { planName: "vip_basico",  duration: "mensal" },
    1990:  { planName: "vip_diamond", duration: "mensal" },
    2500:  { planName: "vip_basico",  duration: "trimestral" },
    4990:  { planName: "vip_diamond", duration: "trimestral" },
    8000:  { planName: "vip_basico",  duration: "anual" },
    14990: { planName: "vip_diamond", duration: "anual" },
    // MultiCanaisHD VIP Black — plano no topo da tabela, lançado em 2026-09-05. Mantido com valor
    // redondo (R$ 50/125/500) propositalmente distante dos centavos ,90 do Diamond acima
    // pra nunca colidir com eles nem no futuro.
    5000:  { planName: "vip_black",   duration: "mensal" },
    12500: { planName: "vip_black",   duration: "trimestral" },
    50000: { planName: "vip_black",   duration: "anual" }
};

export const VIP_DURATION_DAYS = {
    mensal: 30,
    trimestral: 90,
    anual: 365
};

/** Valores aceitos no checkout — impede fraude de alteração de preço no body. */
export function isKnownVipPriceCents(cents) {
    return Object.prototype.hasOwnProperty.call(VIP_PLANS_BY_PRICE_CENTS, cents);
}

/**
 * Plano correspondente ao valor efetivamente pago, ou null se o valor não bate com
 * nenhum plano. O webhook usa isto para NUNCA deduzir o plano de dados que o
 * chamador mandou — só do dinheiro que o gateway confirmou ter recebido.
 */
export function vipPlanForPriceCents(cents) {
    return VIP_PLANS_BY_PRICE_CENTS[cents] || null;
}

export function vipDurationDays(duration) {
    return VIP_DURATION_DAYS[duration] || VIP_DURATION_DAYS.mensal;
}

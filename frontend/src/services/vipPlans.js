// src/services/vipPlans.js
// Fonte única da regra "quanto o usuário pagou -> qual plano ele tem".
//
// Por que não sai do banco: NÃO EXISTE coluna `profiles.vip_plan`. Três lugares já
// tentaram lê-la e o Postgres respondia `column profiles.vip_plan does not exist`, o que
// derruba o SELECT inteiro — não só aquela coluna. O efeito foi grave e silencioso:
// `resolveTierFromSupabaseToken` recebia profile null e classificava TODO assinante como
// free (403 nas fontes VIP), e `api/user/update-profile` respondia "Perfil não encontrado"
// em toda troca de nickname. Se um dia a coluna for criada, este módulo é o único ponto
// que precisa passar a preferi-la.
//
// O webhook de pagamento grava `is_vip` e `vip_until`; o plano fica implícito no valor
// pago, então é dele que a regra deriva.

// Valores em centavos, como estão em `payments.amount`.
export const PLANO_POR_VALOR = {
    14990: "diamond_anual",
    4990: "diamond_trimestral",
    1990: "diamond_mensal",
    8000: "anual",
    2500: "trimestral",
    // MultiCanaisHD VIP Black — ver vipPricingService.js para o motivo dos valores redondos.
    50000: "black_anual",
    12500: "black_trimestral",
    5000: "black_mensal"
};

export const PLANO_PADRAO = "mensal";
export const PLANO_VITALICIO = "vitalicio";

/**
 * VIP ativo? `vip_until` nulo significa vitalício, não expirado.
 */
export function isVipAtivo(profile) {
    if (!profile) return false;
    return profile.is_vip === true &&
        (!profile.vip_until || new Date(profile.vip_until) > new Date());
}

/**
 * Plano do usuário. `latestPaymentAmount` é o valor (centavos) do pagamento pago mais
 * recente; sem um valor reconhecido assume o plano mais barato, nunca Diamond.
 * Devolve null pra quem não tem VIP ativo.
 */
export function resolvePlano(profile, latestPaymentAmount = null) {
    if (!isVipAtivo(profile)) return null;
    if (!profile.vip_until) return PLANO_VITALICIO;
    return PLANO_POR_VALOR[latestPaymentAmount] || PLANO_PADRAO;
}

/**
 * Diamond e Black (o tier acima, que herda tudo do Diamond) dão acesso à fonte sem
 * anúncios e a alterações ilimitadas de nickname.
 */
export function isPlanoDiamond(plano) {
    const normalizado = String(plano || "").toLowerCase();
    return normalizado.includes("diamond") || normalizado.includes("black") || normalizado === PLANO_VITALICIO;
}

/** Teto de perfis por conta — espelhado no trigger de account_profiles.sql. */
export const MAX_PERFIS_POR_CONTA = 5;

/**
 * Só o Black libera múltiplos perfis (e o perfil infantil). Vitalício entra junto
 * porque é uma cortesia manual que historicamente vale como tier máximo.
 */
export function podeCriarPerfis(plano) {
    const normalizado = String(plano || "").toLowerCase();
    return normalizado.includes("black") || normalizado === PLANO_VITALICIO;
}

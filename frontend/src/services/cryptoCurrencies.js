// Moedas que a VeloraPay aceita em `/crypto/payment` (cash-in), com o valor
// MÍNIMO de cada uma em centavos. Lista curada, não uma chamada ao vivo de
// `GET /crypto/currencies` (evita gastar uma requisição server-to-server só pra
// popular um <select>). `code` é o valor exato que `payCurrency` espera.
//
// Existem dois mínimos, medidos contra a API de produção em 2026-09-23:
// - o da própria VeloraPay, R$ 10 pra qualquer moeda (400 com a mensagem
//   "Valor abaixo do limite mínimo de depósito");
// - o da rede/processador de cada moeda, bem maior na maioria (~US$ 12).
//   Abaixo dele a VeloraPay responde 502 SEM mensagem nenhuma — foi isso que
//   pareceu "cripto quebrada" nos primeiros testes, com cobrança pequena.
//
// O segundo oscila com a cotação, por isso há folga de R$ 5 sobre o valor
// medido (exceto nas que só têm o piso fixo de R$ 10). Se uma moeda voltar a
// dar 502 num valor acima do mínimo daqui, meça de novo e ajuste.
//
// Fora da lista de propósito: `usdttrc20` (502 em qualquer valor), `avax` e
// `atom` (nenhuma cobrança criada até R$ 200).
export const CRYPTO_CURRENCIES = [
  { code: 'btc', label: 'Bitcoin', minCents: 7500 },
  { code: 'eth', label: 'Ethereum', minCents: 7000 },
  { code: 'usdterc20', label: 'USDT (Ethereum / ERC20)', minCents: 8000 },
  { code: 'usdtbsc', label: 'USDT (BNB Smart Chain)', minCents: 1000 },
  { code: 'usdtsol', label: 'USDT (Solana)', minCents: 7000 },
  { code: 'usdcbsc', label: 'USDC (BNB Smart Chain)', minCents: 7000 },
  { code: 'usdcsol', label: 'USDC (Solana)', minCents: 7000 },
  { code: 'usdcmatic', label: 'USDC (Polygon)', minCents: 7000 },
  { code: 'bnbbsc', label: 'BNB (BNB Smart Chain)', minCents: 7000 },
  { code: 'sol', label: 'Solana', minCents: 7000 },
  { code: 'trx', label: 'TRON', minCents: 7000 },
  { code: 'xrp', label: 'XRP (XRP Ledger)', minCents: 7000 },
  { code: 'ltc', label: 'Litecoin', minCents: 1000 },
  { code: 'doge', label: 'Dogecoin', minCents: 7500 },
  { code: 'ada', label: 'Cardano', minCents: 7000 },
  { code: 'matic', label: 'Polygon (POL)', minCents: 7500 },
  { code: 'ton', label: 'Toncoin', minCents: 7000 },
  { code: 'link', label: 'Chainlink', minCents: 7500 },
  { code: 'dai', label: 'DAI', minCents: 8000 },
  { code: 'bch', label: 'Bitcoin Cash', minCents: 7000 },
  { code: 'xlm', label: 'Stellar', minCents: 7000 },
  { code: 'shib', label: 'Shiba Inu', minCents: 7500 },
  { code: 'pepe', label: 'Pepe', minCents: 7500 },
  { code: 'xmr', label: 'Monero', minCents: 10000 },
  { code: 'zec', label: 'Zcash', minCents: 15000 },
  { code: 'dash', label: 'Dash', minCents: 7000 },
  { code: 'xtz', label: 'Tezos', minCents: 7000 },
  { code: 'etc', label: 'Ethereum Classic', minCents: 7000 },
  { code: 'near', label: 'NEAR Protocol', minCents: 7000 },
  { code: 'algo', label: 'Algorand', minCents: 7000 },
  { code: 'apt', label: 'Aptos', minCents: 7000 }
];

// Aceita a partir de R$ 10 — a única que serve até pro plano mais barato.
export const DEFAULT_CRYPTO_CURRENCY = 'usdtbsc';

export function isValidCryptoCurrency(code) {
  return CRYPTO_CURRENCIES.some((c) => c.code === code);
}

export function findCryptoCurrency(code) {
  return CRYPTO_CURRENCIES.find((c) => c.code === code) || null;
}

// Texto curto pro <select>: "Bitcoin · mín. R$ 75".
export function cryptoOptionLabel(c) {
  return `${c.label} · mín. R$ ${Math.round(c.minCents / 100)}`;
}

// Deixa no <select> só as moedas que aceitam `amountCents` (cada <option>
// precisa de `data-min` com o mínimo em centavos). Chamado a cada troca de
// plano/período: mensal barato mostra poucas moedas, trimestral e anual
// liberam as demais. Se a moeda escolhida sumiu, cai na primeira que sobrou.
export function syncCryptoOptions(select, amountCents) {
  if (!select) return;
  for (const option of select.options) {
    const tooLow = Number(option.dataset.min || 0) > amountCents;
    option.hidden = tooLow;
    option.disabled = tooLow;
  }
  if (select.selectedOptions[0]?.disabled) {
    const firstValid = [...select.options].find((o) => !o.disabled);
    if (firstValid) select.value = firstValid.value;
  }
}

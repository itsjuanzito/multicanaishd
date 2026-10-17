// Regressão: o redirect de idioma por país capturava verificadores server-side.
//
// A verificação de domínio do Profiton falhava com "Error getting domain main page tags".
// A causa: o robô roda fora de país lusófono e o UA ("Profiton/1.0") não casa com nenhum
// termo do CRAWLER_UA_REGEX, então "/" respondia 302 pra "/en". Cliente HTTP de script
// normalmente não segue redirect — ele lia corpo vazio e concluía que não havia meta tag.
//
// O guard sempre teve a intenção de redirecionar SÓ humano ("Apenas para humanos em
// caminhos errados"); o que faltava era um teste de humano confiável. Browser sempre manda
// `Accept: text/html`; biblioteca HTTP manda `*/*` ou nada.
import { describe, it, expect } from "vitest";
import { detectLocale } from "../../src/utils/localeDetection.js";

const ACCEPT_BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const fakeAstro = ({ pais = "US", ua = "Mozilla/5.0", accept = ACCEPT_BROWSER, cookies = {} } = {}) => ({
    cookies: { get: (nome) => (cookies[nome] ? { value: cookies[nome] } : undefined) },
    url: new URL("https://multicanaishd.lol/"),
    request: {
        headers: {
            get: (nome) => {
                const mapa = {
                    "user-agent": ua,
                    "cf-ipcountry": pais,
                    accept,
                };
                return mapa[nome.toLowerCase()] ?? null;
            },
        },
    },
});

describe("detectLocale — verificadores server-side", () => {
    it("NÃO manda pra /en um verificador de rede de anúncio fora do Brasil", () => {
        // O caso real: UA que não parece bot, país não lusófono, Accept de biblioteca HTTP.
        const r = detectLocale(fakeAstro({ pais: "US", ua: "Profiton/1.0", accept: "*/*" }));

        expect(r.isBrowserNavigation).toBe(false);
        expect(r.activeLocale).toBe("pt"); // sem troca de idioma => sem 302
    });

    it("trata requisição sem header Accept como não-browser", () => {
        const r = detectLocale(fakeAstro({ pais: "DE", ua: "python-requests/2.31.0", accept: "" }));

        expect(r.isBrowserNavigation).toBe(false);
        expect(r.activeLocale).toBe("pt");
    });

    it("continua mandando humano de fora do Brasil pra /en", () => {
        // A regressão a evitar na direção oposta: a correção não pode desligar a detecção
        // de idioma pra visitante de verdade.
        const r = detectLocale(fakeAstro({ pais: "US", ua: "Mozilla/5.0", accept: ACCEPT_BROWSER }));

        expect(r.isBrowserNavigation).toBe(true);
        expect(r.activeLocale).toBe("en");
    });

    it("mantém humano de país lusófono em pt", () => {
        const r = detectLocale(fakeAstro({ pais: "BR" }));
        expect(r.activeLocale).toBe("pt");
    });

    it("respeita a escolha manual de idioma mesmo em browser", () => {
        const r = detectLocale(
            fakeAstro({
                pais: "US",
                cookies: { multicanaishd_locale: "pt", multicanaishd_locale_manual: "true" },
            }),
        );
        expect(r.activeLocale).toBe("pt");
    });

    it("crawler declarado segue sem redirect, como antes", () => {
        const r = detectLocale(fakeAstro({ pais: "US", ua: "Googlebot/2.1" }));
        expect(r.isCrawler).toBe(true);
        expect(r.activeLocale).toBe("pt");
    });
});

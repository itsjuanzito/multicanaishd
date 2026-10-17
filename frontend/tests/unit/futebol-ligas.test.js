// A API de jogos entrega `data.league` como texto livre e o rótulo muda sem aviso
// ("Brasileirão Série A", "BRASILEIRAO SERIE A", "CONMEBOL Libertadores"...). O casamento
// por substring normalizada existe pra que uma troca de rótulo na origem não esvazie a
// página da liga — página de campeonato vazia é pior do que uma com um jogo a mais.
import { describe, it, expect } from "vitest";
import { obterLiga, jogoPertenceALiga, normalizarLiga, LIGAS } from "../../src/utils/futebolLigas.js";

const jogoDaLiga = (league) => ({ title: "Time A x Time B", data: { league } });

describe("normalizarLiga", () => {
    it("remove acento, caixa e pontuação", () => {
        expect(normalizarLiga("Brasileirão Série A")).toBe("brasileirao serie a");
        expect(normalizarLiga("CONMEBOL - Libertadores")).toBe("conmebol libertadores");
    });

    it("aceita valor ausente sem explodir", () => {
        expect(normalizarLiga(null)).toBe("");
        expect(normalizarLiga(undefined)).toBe("");
    });
});

describe("jogoPertenceALiga", () => {
    it("o hub geral aceita qualquer campeonato", () => {
        const hub = obterLiga("futebol-ao-vivo");
        expect(jogoPertenceALiga(jogoDaLiga("Copa do Nordeste"), hub)).toBe(true);
        expect(jogoPertenceALiga(jogoDaLiga(null), hub)).toBe(true);
    });

    it("casa o Brasileirão em variações de rótulo da origem", () => {
        const brasileirao = obterLiga("brasileirao");
        expect(jogoPertenceALiga(jogoDaLiga("Brasileirão Série A"), brasileirao)).toBe(true);
        expect(jogoPertenceALiga(jogoDaLiga("BRASILEIRAO SERIE B"), brasileirao)).toBe(true);
        expect(jogoPertenceALiga(jogoDaLiga("Campeonato Brasileiro"), brasileirao)).toBe(true);
    });

    it("não mistura ligas diferentes", () => {
        const brasileirao = obterLiga("brasileirao");
        expect(jogoPertenceALiga(jogoDaLiga("UEFA Champions League"), brasileirao)).toBe(false);
        expect(jogoPertenceALiga(jogoDaLiga("CONMEBOL Libertadores"), brasileirao)).toBe(false);
    });

    it("liga específica descarta jogo sem campeonato informado", () => {
        expect(jogoPertenceALiga(jogoDaLiga(null), obterLiga("libertadores"))).toBe(false);
    });
});

describe("catálogo de ligas", () => {
    it("toda liga tem slug único e copy nos dois idiomas", () => {
        const slugs = LIGAS.map((l) => l.slug);
        expect(new Set(slugs).size).toBe(slugs.length);

        for (const liga of LIGAS) {
            for (const idioma of ["pt", "en"]) {
                expect(liga[idioma]?.titulo, `${liga.slug}.${idioma}.titulo`).toBeTruthy();
                expect(liga[idioma]?.descricao, `${liga.slug}.${idioma}.descricao`).toBeTruthy();
                expect(liga[idioma]?.heading, `${liga.slug}.${idioma}.heading`).toBeTruthy();
            }
        }
    });

    it("slug desconhecido devolve null em vez de estourar", () => {
        expect(obterLiga("nao-existe")).toBeNull();
    });
});

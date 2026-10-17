// Regressão de indexação da rota de episódio.
//
// Dois riscos concretos cobertos aqui:
//
// 1. O resolver decide 301 / 404 / indisponível — e a diferença entre 404 e "indisponível"
//    é o que já custou ao site 3.506 erros no Search Console: falha transitória de origem
//    NUNCA pode virar 404, senão o Google desindexa conteúdo que existe.
// 2. O slug canônico do episódio tem que bater com o da rota de série. Divergir significa
//    anunciar ao crawler uma URL que responde 301 — o mesmo bug que já respondeu por 46%
//    do tráfego do site.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getTMDBDetails = vi.fn();
const getTMDBSeasonDetails = vi.fn();

vi.mock("../../src/services/tmdb.js", () => ({
    getTMDBDetails: (...args) => getTMDBDetails(...args),
    getTMDBSeasonDetails: (...args) => getTMDBSeasonDetails(...args),
}));

const { resolverEpisodio } = await import("../../src/services/episodioService.js");

const SERIE = { id: 1396, title: "Breaking Bad", original_name: "Breaking Bad" };
const temporadaCom = (...numeros) => ({
    episodes: numeros.map((n) => ({ episode_number: n, name: `Episódio ${n}`, overview: "", air_date: "2010-03-21" })),
});

beforeEach(() => {
    getTMDBDetails.mockReset();
    getTMDBSeasonDetails.mockReset();
});

describe("resolverEpisodio", () => {
    it("resolve um episódio existente com o slug canônico", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue(temporadaCom(1, 2, 3, 4, 5));

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "3", episodio: "5" }, "pt");

        expect(r.tipo).toBe("ok");
        expect(r.dados.numeroTemporada).toBe(3);
        expect(r.dados.episodioAtual?.episode_number).toBe(5);
        expect(r.dados.caminhoCanonico).toBe("/serie/1396-breaking-bad/temporada-3/episodio-5");
    });

    it("301 quando o slug da URL diverge do canônico", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue(temporadaCom(1, 2, 3, 4, 5));

        const r = await resolverEpisodio({ slug: "1396-errado", temporada: "3", episodio: "5" }, "pt");

        expect(r.tipo).toBe("redirect");
        expect(r.destino).toBe("/serie/1396-breaking-bad/temporada-3/episodio-5");
    });

    it("404 quando o episódio não existe na temporada carregada", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue(temporadaCom(1, 2, 3));

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "1", episodio: "99" }, "pt");

        expect(r.tipo).toBe("notFound");
        expect(r.motivo).toBe("episode_not_in_season");
    });

    it("404 para params fora de faixa, sem sequer consultar a TMDB", async () => {
        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "1", episodio: "999999" }, "pt");

        expect(r.tipo).toBe("notFound");
        expect(getTMDBDetails).not.toHaveBeenCalled();
    });

    it("404 quando a TMDB confirma que a série não existe", async () => {
        getTMDBDetails.mockResolvedValue({ notFound: true });
        getTMDBSeasonDetails.mockResolvedValue(null);

        const r = await resolverEpisodio({ slug: "999999-nao-existe", temporada: "1", episodio: "1" }, "pt");

        expect(r.tipo).toBe("notFound");
        expect(r.motivo).toBe("tmdb_not_found");
    });

    it("falha transitória de origem vira 'unavailable', NUNCA 404", async () => {
        getTMDBDetails.mockResolvedValue(null); // timeout/429/5xx, não um 404 real
        getTMDBSeasonDetails.mockResolvedValue(null);

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "1", episodio: "1" }, "pt");

        expect(r.tipo).toBe("unavailable");
    });

    it("temporada que não carregou não derruba a página em 404", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue(null); // falha só da temporada

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "3", episodio: "5" }, "pt");

        // 'unavailable' responde 200 + noindex (utils/upstreamUnavailable.js): mantém a URL
        // viva sem indexar uma página vazia. Antes devolvia 'ok', que renderizava 200
        // INDEXÁVEL com título "Episódio 5" e lista vazia — soft 404. A intenção do teste
        // (nunca 404 numa falha transitória) continua a mesma; o que mudou é o tipo devolvido.
        expect(r.tipo).toBe("unavailable");
        expect(r.tipo).not.toBe("notFound");
    });

    it("404 quando o TMDB confirma que a TEMPORADA não existe", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue({ notFound: true, episodes: [] });

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "99", episodio: "1" }, "pt");

        // 404 real, não 'unavailable': o TMDB respondeu, a temporada não existe. Antes este
        // caso era indistinguível de um timeout e renderizava 200 indexável com lista vazia —
        // e como o guard só limita 1..200 por 1..20000, eram milhões de URLs por série.
        expect(r.tipo).toBe("notFound");
        expect(r.motivo).toBe("season_not_found");
    });

    it("usa o prefixo de idioma no caminho canônico em /en", async () => {
        getTMDBDetails.mockResolvedValue(SERIE);
        getTMDBSeasonDetails.mockResolvedValue(temporadaCom(1));

        const r = await resolverEpisodio({ slug: "1396-breaking-bad", temporada: "1", episodio: "1" }, "en");

        expect(r.tipo).toBe("ok");
        expect(r.dados.caminhoCanonico).toBe("/en/serie/1396-breaking-bad/temporada-1/episodio-1");
    });
});

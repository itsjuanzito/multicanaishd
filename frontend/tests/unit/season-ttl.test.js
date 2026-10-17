// Regressão de custo: o TTL de 6h era aplicado a TODA chave `season_*` do KV, então cada
// uma das dezenas de milhares de temporadas do catálogo expirava e era regravada 4x por dia
// só porque o relógio virou — sem nenhum dado ter mudado. Era a maior fatia restante das KV
// Write Operations da conta (~$10 num ciclo). Temporada encerrada é dado imutável e agora
// vai com TTL longo; só temporada em exibição mantém o TTL curto.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ttlDeTemporada } from "../../src/services/tmdb.js";
import { KV_TTL_SEASON_S, KV_TTL_SEASON_ENCERRADA_S } from "../../src/services/cache.js";

afterEach(() => {
    vi.useRealTimers();
});

const congelarEm = (isoUtc) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoUtc));
};

const temporadaCom = (...datas) => ({ episodes: datas.map((air_date) => ({ air_date })) });

describe("ttlDeTemporada", () => {
    it("dá TTL longo para temporada encerrada há tempo", () => {
        congelarEm("2026-08-14T12:00:00Z");
        const encerrada = temporadaCom("2019-01-07", "2019-01-14", "2019-01-21");
        expect(ttlDeTemporada(encerrada)).toBe(KV_TTL_SEASON_ENCERRADA_S);
    });

    it("mantém TTL curto para temporada em exibição", () => {
        congelarEm("2026-08-14T12:00:00Z");
        // Último episódio foi ao ar há 3 dias: a série ainda está no ar e vai ganhar mais.
        const noAr = temporadaCom("2026-07-31", "2026-08-07", "2026-08-11");
        expect(ttlDeTemporada(noAr)).toBe(KV_TTL_SEASON_S);
    });

    it("mantém TTL curto quando algum episódio ainda não tem data", () => {
        // Episódio sem `air_date` é episódio não exibido: tratar como encerrada esconderia
        // a estreia por até 30 dias.
        congelarEm("2026-08-14T12:00:00Z");
        const comEpisodioFuturo = { episodes: [{ air_date: "2019-01-07" }, { air_date: null }] };
        expect(ttlDeTemporada(comEpisodioFuturo)).toBe(KV_TTL_SEASON_S);
    });

    it("na dúvida devolve TTL curto: sem episódios, data inválida ou payload estranho", () => {
        congelarEm("2026-08-14T12:00:00Z");
        expect(ttlDeTemporada(null)).toBe(KV_TTL_SEASON_S);
        expect(ttlDeTemporada({})).toBe(KV_TTL_SEASON_S);
        expect(ttlDeTemporada({ episodes: [] })).toBe(KV_TTL_SEASON_S);
        expect(ttlDeTemporada(temporadaCom("data-que-nao-existe"))).toBe(KV_TTL_SEASON_S);
    });

    it("respeita a margem: recém-encerrada continua no TTL curto", () => {
        // A margem existe porque a TMDB às vezes só preenche still/sinopse dias depois da
        // exibição — congelar por 30 dias logo no fim da temporada perderia esse acerto.
        congelarEm("2026-08-14T12:00:00Z");
        const semanaPassada = temporadaCom("2026-08-07");
        expect(ttlDeTemporada(semanaPassada)).toBe(KV_TTL_SEASON_S);

        const doisMesesAtras = temporadaCom("2026-06-14");
        expect(ttlDeTemporada(doisMesesAtras)).toBe(KV_TTL_SEASON_ENCERRADA_S);
    });
});

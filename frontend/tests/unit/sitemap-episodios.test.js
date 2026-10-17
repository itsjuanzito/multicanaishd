// tests/unit/sitemap-episodios.test.js
// Regressão de duas decisões que, se invertidas, produzem URL que responde 301 ou sitemap
// anunciando página que não existe:
//   1. o alternate EN só sai quando o slug canônico em inglês é CONHECIDO;
//   2. a temporada escolhida é a mais recente "normal" — temporada 0 (extras) nunca.
// Ver src/services/sitemapEpisodios.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getEnv = vi.fn(() => null);
vi.mock('../../src/services/env-adapter.js', () => ({
    getEnv: (...a) => getEnv(...a),
}));

const {
    temporadaMaisRecente,
    montarEntradasDeEpisodios,
    coletarEntradasDeEpisodios,
    lerLimite,
} = await import('../../src/services/sitemapEpisodios.js');

const episodios = (...nums) =>
    nums.map((n) => ({ episode_number: n, name: `Ep ${n}`, still_path: `/s${n}.jpg`, air_date: '2026-01-05' }));

beforeEach(() => {
    getEnv.mockReturnValue(null);
});

describe('temporadaMaisRecente', () => {
    it('escolhe a maior temporada normal', () => {
        const detalhes = { seasons: [{ season_number: 1 }, { season_number: 3 }, { season_number: 2 }] };
        expect(temporadaMaisRecente(detalhes)).toBe(3);
    });

    it('ignora temporada 0 (extras) mesmo sendo listada', () => {
        const detalhes = { seasons: [{ season_number: 0 }, { season_number: 2 }] };
        expect(temporadaMaisRecente(detalhes)).toBe(2);
    });

    it('devolve null quando só existe temporada 0 ou nenhuma', () => {
        expect(temporadaMaisRecente({ seasons: [{ season_number: 0 }] })).toBeNull();
        expect(temporadaMaisRecente({ seasons: [] })).toBeNull();
        expect(temporadaMaisRecente(null)).toBeNull();
    });
});

describe('montarEntradasDeEpisodios', () => {
    it('monta a URL do episódio com o slug canônico e lastmod da data de exibição', () => {
        const [primeiro] = montarEntradasDeEpisodios({
            id: 1396,
            ptSlug: 'breaking-bad',
            enSlug: 'breaking-bad',
            temporada: 5,
            episodios: episodios(1),
        });
        expect(primeiro.path).toBe('/serie/1396-breaking-bad/temporada-5/episodio-1');
        expect(primeiro.enPath).toBe('/serie/1396-breaking-bad/temporada-5/episodio-1');
        expect(primeiro.enUnknown).toBe(false);
        expect(primeiro.lastmod).toBe('2026-01-05');
    });

    it('OMITE o alternate quando o slug em inglês é desconhecido (nunca chuta)', () => {
        const [primeiro] = montarEntradasDeEpisodios({
            id: 1396,
            ptSlug: 'breaking-bad',
            enSlug: null,
            temporada: 5,
            episodios: episodios(1),
        });
        expect(primeiro.enUnknown).toBe(true);
        expect(primeiro.enPath).toBeNull();
    });

    it('não emite lastmod antes de 1970 nem data ausente', () => {
        const entradas = montarEntradasDeEpisodios({
            id: 1,
            ptSlug: 'x',
            enSlug: 'x',
            temporada: 1,
            episodios: [
                { episode_number: 1, air_date: '1966-01-01' },
                { episode_number: 2, air_date: null },
            ],
        });
        expect(entradas.every((e) => e.lastmod === null)).toBe(true);
    });

    it('ordena por número de episódio e descarta número inválido', () => {
        const entradas = montarEntradasDeEpisodios({
            id: 1,
            ptSlug: 'x',
            enSlug: 'x',
            temporada: 1,
            episodios: [
                { episode_number: 3 },
                { episode_number: null },
                { episode_number: 2 },
                { episode_number: 0 },
            ],
        });
        expect(entradas.map((e) => e.path.split('episodio-')[1])).toEqual(['2', '3']);
    });

    it('respeita o teto de episódios por série vindo do ambiente', () => {
        getEnv.mockImplementation((chave) => (chave === 'SITEMAP_EPISODIOS_POR_SERIE' ? '2' : null));
        const entradas = montarEntradasDeEpisodios({
            id: 1,
            ptSlug: 'x',
            enSlug: 'x',
            temporada: 1,
            episodios: episodios(1, 2, 3, 4, 5),
        });
        expect(entradas).toHaveLength(2);
    });

    it('devolve vazio sem id, sem slug ou sem temporada válida', () => {
        expect(montarEntradasDeEpisodios({ id: null, ptSlug: 'x', temporada: 1, episodios: episodios(1) })).toEqual([]);
        expect(montarEntradasDeEpisodios({ id: 1, ptSlug: '', temporada: 1, episodios: episodios(1) })).toEqual([]);
        expect(montarEntradasDeEpisodios({ id: 1, ptSlug: 'x', temporada: null, episodios: episodios(1) })).toEqual([]);
    });
});

describe('coletarEntradasDeEpisodios', () => {
    const deps = () => ({
        obterDetalhes: vi.fn().mockResolvedValue({ seasons: [{ season_number: 1 }] }),
        obterTemporada: vi.fn().mockResolvedValue({ episodes: episodios(1, 2) }),
    });

    it('pula a série quando o mapa não tem o slug canônico PT', async () => {
        const d = deps();
        const r = await coletarEntradasDeEpisodios({ candidatos: [1396], paresDeSlug: {}, ...d });
        expect(r).toEqual([]);
        expect(d.obterDetalhes).not.toHaveBeenCalled();
    });

    it('coleta quando o mapa tem o par', async () => {
        const d = deps();
        const r = await coletarEntradasDeEpisodios({
            candidatos: [1396],
            paresDeSlug: { 'tv:1396': { pt: 'breaking-bad', en: 'breaking-bad' } },
            ...d,
        });
        expect(r).toHaveLength(2);
        expect(r[0].path).toBe('/serie/1396-breaking-bad/temporada-1/episodio-1');
    });

    it('uma série com erro não derruba as outras (§2.2)', async () => {
        const d = deps();
        d.obterDetalhes = vi.fn()
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValue({ seasons: [{ season_number: 1 }] });
        const r = await coletarEntradasDeEpisodios({
            candidatos: [1, 2],
            paresDeSlug: { 'tv:1': { pt: 'a', en: 'a' }, 'tv:2': { pt: 'b', en: 'b' } },
            ...d,
        });
        expect(r).toHaveLength(2);
    });

    it('desliga quando o teto é 0', async () => {
        getEnv.mockImplementation((chave) => (chave === 'SITEMAP_EPISODIOS_MAX_SERIES' ? '0' : null));
        const d = deps();
        const r = await coletarEntradasDeEpisodios({
            candidatos: [1396],
            paresDeSlug: { 'tv:1396': { pt: 'x', en: 'x' } },
            ...d,
        });
        expect(r).toEqual([]);
        expect(d.obterDetalhes).not.toHaveBeenCalled();
    });

    it('série sem temporada válida não gera entrada', async () => {
        const d = deps();
        d.obterDetalhes = vi.fn().mockResolvedValue({ seasons: [{ season_number: 0 }] });
        const r = await coletarEntradasDeEpisodios({
            candidatos: [1396],
            paresDeSlug: { 'tv:1396': { pt: 'x', en: 'x' } },
            ...d,
        });
        expect(r).toEqual([]);
    });
});

describe('lerLimite', () => {
    it('usa o padrão quando a env é vazia ou inválida', () => {
        getEnv.mockReturnValue('');
        expect(lerLimite('X', 25)).toBe(25);
        getEnv.mockReturnValue('abc');
        expect(lerLimite('X', 25)).toBe(25);
        getEnv.mockReturnValue('-3');
        expect(lerLimite('X', 25)).toBe(25);
    });

    it('aceita 0 (desligar) e valores positivos', () => {
        getEnv.mockReturnValue('0');
        expect(lerLimite('X', 25)).toBe(0);
        getEnv.mockReturnValue('7');
        expect(lerLimite('X', 25)).toBe(7);
    });
});

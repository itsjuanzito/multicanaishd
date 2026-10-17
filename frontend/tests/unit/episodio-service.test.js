// tests/unit/episodio-service.test.js
// Regressão: temporada que o TMDB confirma NÃO existir caía no mesmo caminho de uma falha
// transitória, então a rota de episódio respondia 200 (self-canonical, título "Episódio N",
// lista vazia) em vez de 404 — soft 404 em massa, já que o guard de params só limita 1..200 de
// temporada por 1..20000 de episódio. Ver src/services/episodioService.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getTMDBDetails = vi.fn();
const getTMDBSeasonDetails = vi.fn();
const resolveRotatedSlug = vi.fn();

vi.mock('../../src/services/tmdb.js', () => ({
    getTMDBDetails: (...a) => getTMDBDetails(...a),
    getTMDBSeasonDetails: (...a) => getTMDBSeasonDetails(...a),
}));

vi.mock('../../src/services/urlRotationService.js', () => ({
    resolveRotatedSlug: (...a) => resolveRotatedSlug(...a),
}));

const { resolverEpisodio } = await import('../../src/services/episodioService.js');

const SERIE = { id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad' };
const params = { slug: '1396-breaking-bad', temporada: '1', episodio: '1' };

beforeEach(() => {
    vi.clearAllMocks();
    getTMDBDetails.mockResolvedValue(SERIE);
    resolveRotatedSlug.mockImplementation(async (_id, _tipo, fallback) => fallback);
});

describe('resolverEpisodio — temporada inexistente vs origem fora', () => {
    it('404 quando o TMDB confirma que a temporada não existe', async () => {
        getTMDBSeasonDetails.mockResolvedValue({ notFound: true, episodes: [] });
        const r = await resolverEpisodio(params, 'pt');
        expect(r.tipo).toBe('notFound');
        expect(r.motivo).toBe('season_not_found');
    });

    it('unavailable (200 + noindex) quando a temporada falhou de forma transitória', async () => {
        getTMDBSeasonDetails.mockResolvedValue(null);
        const r = await resolverEpisodio(params, 'pt');
        expect(r.tipo).toBe('unavailable');
    });

    it('404 quando a temporada existe mas o episódio não está nela', async () => {
        getTMDBSeasonDetails.mockResolvedValue({ episodes: [{ episode_number: 1 }] });
        const r = await resolverEpisodio({ ...params, episodio: '99' }, 'pt');
        expect(r.tipo).toBe('notFound');
        expect(r.motivo).toBe('episode_not_in_season');
    });

    it('ok quando o episódio existe', async () => {
        getTMDBSeasonDetails.mockResolvedValue({ episodes: [{ episode_number: 1, name: 'Pilot' }] });
        const r = await resolverEpisodio(params, 'pt');
        expect(r.tipo).toBe('ok');
        expect(r.dados.episodioAtual.name).toBe('Pilot');
    });

    it('404 de série inexistente continua vindo do TMDB, não do guard de params', async () => {
        getTMDBDetails.mockResolvedValue({ notFound: true });
        const r = await resolverEpisodio(params, 'pt');
        expect(r.tipo).toBe('notFound');
        expect(r.motivo).toBe('tmdb_not_found');
    });

    it('params fora do teto nunca chegam ao TMDB', async () => {
        const r = await resolverEpisodio({ ...params, temporada: '999' }, 'pt');
        expect(r.tipo).toBe('notFound');
        expect(r.motivo).toBe('invalid_episode_params');
        expect(getTMDBDetails).not.toHaveBeenCalled();
    });
});

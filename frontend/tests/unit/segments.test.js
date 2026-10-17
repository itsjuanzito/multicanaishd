import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as segmentsAPI } from '../../src/pages/api/segments.js';

describe('Segments API (Unit Tests)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        if (globalThis._bf_segments_cache) {
            globalThis._bf_segments_cache.clear();
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('Deve falhar com status 400 se imdb_id estiver ausente', async () => {
        const mockReq = { url: 'http://localhost/api/segments?season=1&episode=1' };
        const res = await segmentsAPI({ request: mockReq });
        
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Missing imdb_id');
    });

    it('Deve buscar da API externa no primeiro acesso (Cache MISS) e salvar no cache L1', async () => {
        const mockReq = { url: 'http://localhost/api/segments?imdb_id=tt0944947&season=1&episode=1' };
        const mockData = { intro: [10, 40], outro: [3000, 3120] };

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(mockData)
        });

        const res = await segmentsAPI({ request: mockReq });
        expect(res.status).toBe(200);
        const data = await res.json();
        
        expect(data).toStrictEqual(mockData);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Verifica se foi gravado no Cache L1
        const cacheKey = 'tt0944947_s1_e1';
        expect(globalThis._bf_segments_cache.has(cacheKey)).toBe(true);
        expect(JSON.parse(globalThis._bf_segments_cache.get(cacheKey))).toStrictEqual(mockData);
    });

    it('Deve servir do cache L1 nas requisições subsequentes (Cache HIT) sem invocar fetch', async () => {
        const mockReq = { url: 'http://localhost/api/segments?imdb_id=tt0944947&season=1&episode=1' };
        const mockData = { intro: [10, 40], outro: [3000, 3120] };

        // Popula cache manualmente
        const cacheKey = 'tt0944947_s1_e1';
        globalThis._bf_segments_cache.set(cacheKey, JSON.stringify(mockData));

        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const res = await segmentsAPI({ request: mockReq });
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data).toStrictEqual(mockData);
        expect(fetchSpy).toHaveBeenCalledTimes(0); // Não deve bater na rede
    });

    it('Deve ser resiliente a falhas e timeouts retornando status 500', async () => {
        const mockReq = { url: 'http://localhost/api/segments?imdb_id=tt0944947&season=1&episode=1' };

        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'));

        const res = await segmentsAPI({ request: mockReq });
        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toBe('Timeout');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContentList } from '../../src/services/content-lists';
import * as redisClient from '../../src/services/redis-client';
import * as superflixIds from '../../src/services/superflix-ids';
import * as fetchUtil from '../../src/services/fetch-util';
import * as itemCache from '../../src/services/item-cache';

// Mock Modules
vi.mock('../../src/services/redis-client');
vi.mock('../../src/services/superflix-ids');
vi.mock('../../src/services/fetch-util');
vi.mock('../../src/services/item-cache');
vi.mock('../../src/services/env-adapter', () => {
    return {
        getEnv: (key) => {
            if (key === 'KEY_API_TMDB' || key === 'TMDB_API_KEY') return 'fake_tmdb_api_key_for_testing_123';
            return undefined;
        }
    };
});

describe('Content Lists Service (Integration Mock)', () => {
    let mockTime = Date.now();
    
    beforeEach(() => {
        vi.resetAllMocks();
        mockTime = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => mockTime);
    });

    it('Deve cair no Fallback do TMDB se falhar o mapeamento de IDs do Superflix', async () => {
        // Simulando banco Superflix quebrado/vazio
        superflixIds.getSuperflixIds.mockResolvedValue({ anime: new Set(), doramas: new Set() });
        
        // Simulando resposta TMDB Mockada via global fetch (apenas na página 1)
        let callCount = 0;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
            callCount++;
            const currentCall = callCount;
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    results: currentCall === 1 ? [
                        { id: 101, title: "Anime Teste", poster_path: "/img.jpg", vote_average: 9.5 }
                    ] : []
                })
            });
        });

        // Executa
        const response = await getContentList('animes');

        // Validations
        expect(response.results).toBeDefined();
        expect(response.results.length).toBe(1);
        expect(response.results[0].title).toBe("Anime Teste");
        // Verifica se TMDB foi chamado
        expect(fetchSpy).toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('Deve usar IDs do Superflix e o Redis se os dados estiverem disponíveis', async () => {
        // Avança no tempo para furar o Cache L1 do teste anterior (11 mins)
        mockTime += 11 * 60 * 1000; 

        // IDs disponíveis (Golden Path)
        superflixIds.getSuperflixIds.mockResolvedValue({ 
            anime: new Set([123, 456]), 
            doramas: new Set() 
        });

        // Mock do Redis para retornar dados nos IDs passados
        const mockRedis = {
            get: vi.fn().mockResolvedValue(null), // Força a passar do cache L2 Global
            set: vi.fn()
        };
        redisClient.getRedisClient.mockResolvedValue(mockRedis);

        // Mocking global fetch for TMDB that returns the items on page 1 only
        let callCount = 0;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
            callCount++;
            const currentCall = callCount;
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    results: currentCall === 1 ? [
                        { id: 123, title: 'Superflix Return', poster_path: "/img1.jpg", vote_average: 8.0 },
                        { id: 456, title: 'Item Fallback DB', poster_path: "/img2.jpg", vote_average: 7.0 }
                    ] : []
                })
            });
        });

        const response = await getContentList('animes');

        // Validations
        expect(response.results.length).toBe(2);
        // Os resultados podem ser embaralhados pelo sort(() => Math.random() - 0.5) em getContentList.
        // Verificamos os títulos de forma independente de ordenação.
        const titles = response.results.map(r => r.title);
        expect(titles).toContain('Superflix Return');
        expect(titles).toContain('Item Fallback DB');
        expect(fetchSpy).toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('Deve ser Resiliente (Empty State) em caso de Explosão do Redis e Falha Global', async () => {
        // Avança tempo para matar o L1 Cache
        mockTime += 11 * 60 * 1000; 
        
        // Silencia transitoriamente o console.error para não poluir nosso Log Verde
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Simula Exceção Crítica no Código (Simulando indisponibilidade Cloud)
        redisClient.getRedisClient.mockRejectedValue(new Error('Redis Timeout Connection Refused'));
        
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network Failure'));

        // Tenta executar mesmo com a infra caindo
        const response = await getContentList('doramas');

        // Resultado Defensivo Exigido na Regra 2 do MultiCanaisHD (Fallback Premium Estático)
        expect(response.results).toBeDefined();
        expect(response.results.length).toBeGreaterThan(0);
        expect(response.results[0].title).toBe("Squid Game");
        
        // Restaura
        consoleSpy.mockRestore();
        fetchSpy.mockRestore();
    }, 10000);
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock do Redis Client
vi.mock('../../src/services/redis-client.js', () => {
    const mockClient = {
        get: vi.fn(),
        set: vi.fn(),
        hmget: vi.fn(),
        hget: vi.fn(),
        hkeys: vi.fn(),
        expire: vi.fn()
    };
    return {
        getRedisClient: vi.fn().mockResolvedValue(mockClient)
    };
});

// Mock do Config Service
vi.mock('../../src/services/configService.js', () => ({
    getConfig: vi.fn().mockResolvedValue('https://mock-domain.com')
}));

// Mock do Supabase
vi.mock('../../src/services/supabase.js', () => {
    const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null })
    });
    return {
        supabase: {
            auth: {
                getSession: vi.fn().mockResolvedValue({ data: { session: null } })
            }
        },
        supabaseAdmin: {
            from: mockFrom
        }
    };
});

import { fetchCanais } from '../../src/services/channelsService';
import { getRedisClient } from '../../src/services/redis-client';

describe('MultiCanaisHD Cache & Performance (Unit Tests)', () => {
    let redis;

    beforeEach(async () => {
        vi.clearAllMocks();
        redis = await getRedisClient();
        
        // Mock do fetch global para evitar requisições de rede reais e timeouts
        globalThis.fetch = vi.fn().mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([])
            })
        );

        // Limpar caches globais de Canais
        if (globalThis._bf_channels_state) {
            globalThis._bf_channels_state.canaisCache = null;
            globalThis._bf_channels_state.cacheTimestamp = 0;
            globalThis._bf_channels_state.currentFetchPromise = null;
        }
    });

    describe('Channels Service Caching', () => {
        it('deve usar o cache Redis se disponível no Cold Start do Worker', async () => {
            const mockRedisData = [
                { id: '1', nome: 'Globo RJ', categoria: 'Abertos', imagem: '/logo.png', url: 'https://stream.com' }
            ];

            redis.get.mockResolvedValue(JSON.stringify(mockRedisData));

            // Executa fetchCanais (sem cache na memória)
            const result = await fetchCanais();

            // Deve bater no Redis e retornar
            expect(redis.get).toHaveBeenCalledWith('multicanaishd_canais_cache_v7');
            expect(result).toEqual(mockRedisData);
        });

        it('deve salvar o novo resultado combinado no Redis se houver cache miss', async () => {
            // Simula Redis vazio (cache miss) e a API EmbedTV retornando canais válidos
            redis.get.mockResolvedValue(null);
            globalThis.fetch = vi.fn().mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        categories: [{ id: 0, name: 'Todos' }, { id: 6, name: 'Abertos' }],
                        channels: [{ id: 'globorj', name: 'Globo RJ', image: '/logo.png', url: 'https://stream.com', categories: [0, 6] }]
                    })
                })
            );

            // Executa fetchCanais
            const result = await fetchCanais();

            // Como deu miss no Redis, deve disparar a gravação no Redis em background
            // Usamos setTimeout no teste para dar tempo da promise em background gravar
            await new Promise(r => setTimeout(r, 50));

            expect(redis.set).toHaveBeenCalled();
            expect(redis.set.mock.calls[0][0]).toBe('multicanaishd_canais_cache_v7');
            expect(redis.set.mock.calls[0][2]).toBe('EX');
            expect(redis.set.mock.calls[0][3]).toBe(180); // 3 minutos
            expect(result.length).toBeGreaterThan(0);
        });
    });
});

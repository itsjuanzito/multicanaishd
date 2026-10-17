import { describe, it, expect, beforeAll, vi } from 'vitest';

describe('TMDB Search Multi-Page Service (Unit Tests)', () => {
    
    beforeAll(() => {
        // Mock global fetch para simular retornos do TMDB
        globalThis.fetch = vi.fn().mockImplementation((url) => {
            const urlStr = url.toString();
            
            // Simula o endpoint de busca search/multi
            if (urlStr.includes('search/multi')) {
                const searchParams = new URL(urlStr).searchParams;
                const page = searchParams.get('page') || '1';
                const query = searchParams.get('query') || '';
                
                if (query === 'ErrorQuery') {
                    return Promise.reject(new Error('Network Fail'));
                }
                
                if (page === '1') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            results: [
                                { id: 101, title: 'Obsessão 1', media_type: 'movie' },
                                { id: 102, title: 'Obsessão 2', media_type: 'tv' }
                            ]
                        })
                    });
                }
                
                if (page === '2') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            results: [
                                { id: 103, title: 'Obsessão 3', media_type: 'movie' },
                                { id: 104, title: 'Obsessão 4', media_type: 'tv' },
                                // Simula item duplicado para validar a deduplicação
                                { id: 101, title: 'Obsessão 1', media_type: 'movie' }
                            ]
                        })
                    });
                }
                
                if (page === '3') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            results: [
                                { id: 105, title: 'Obsessão 5', media_type: 'movie' }
                            ]
                        })
                    });
                }
                
                if (page === '4' || page === '5') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            results: []
                        })
                    });
                }
            }
            
            return Promise.resolve({
                ok: false,
                status: 404,
                json: () => Promise.resolve({})
            });
        });
    });

    it('should query first 3 pages of TMDB in parallel and deduplicate results by ID', async () => {
        const { buscarNoTMDB } = await import('../../src/services/tmdb.js');
        const query = 'Obsessão';
        
        const data = await buscarNoTMDB(query, 'pt');
        
        expect(data).toBeDefined();
        expect(data.results).toBeInstanceOf(Array);
        // Esperamos 5 itens únicos (101, 102, 103, 104, 105)
        expect(data.results.length).toBe(5);
        
        // Verifica se o id 101 não está duplicado
        const ids = data.results.map(item => item.id);
        const uniqueIds = Array.from(new Set(ids));
        expect(ids.length).toBe(uniqueIds.length);
        
        // Verifica a presença de itens específicos das páginas 1, 2 e 3
        expect(ids).toContain(101);
        expect(ids).toContain(103);
        expect(ids).toContain(105);
    });

    it('should read from L1 memory cache on subsequent calls for the same query', async () => {
        const { buscarNoTMDB } = await import('../../src/services/tmdb.js');
        const query = 'Obsessão';
        
        // Limpa a chamada do fetch mock
        vi.mocked(globalThis.fetch).mockClear();
        
        // Segunda chamada (deve dar cache hit)
        const cachedData = await buscarNoTMDB(query, 'pt');
        
        expect(cachedData.results.length).toBe(5);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should handle API failures gracefully and return empty array', async () => {
        const { buscarNoTMDB } = await import('../../src/services/tmdb.js');
        const query = 'ErrorQuery';
        
        const data = await buscarNoTMDB(query, 'pt');
        
        expect(data).toBeDefined();
        expect(data.results).toEqual([]);
    });
});

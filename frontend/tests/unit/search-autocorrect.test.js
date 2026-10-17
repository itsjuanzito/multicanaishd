import { describe, it, expect, beforeAll, vi } from 'vitest';
import { GET } from '../../src/pages/api/search.js';
import { setRuntimeEnv } from '../../src/services/env-adapter.js';

describe('Search Autocorrect / Did You Mean Fallback (Unit/Integration Tests)', () => {
    beforeAll(() => {
        // Configure TMDB API key in test runtime env
        setRuntimeEnv({
            KEY_API_TMDB: 'test-api-key'
        });

        // Mock global fetch
        globalThis.fetch = vi.fn().mockImplementation((url) => {
            const urlStr = url.toString();

            // 1. Google suggest queries API
            if (urlStr.includes('suggestqueries.google.com')) {
                const searchParams = new URL(urlStr).searchParams;
                const query = searchParams.get('q') || '';
                
                if (query === 'dhurandar') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve([
                            'dhurandar',
                            ['dhurandhar', 'dhurandhar filme', 'dhurandhar elenco']
                        ])
                    });
                }
                
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([query, []])
                });
            }

            // 2. TMDB search/multi API
            if (urlStr.includes('search/multi')) {
                const searchParams = new URL(urlStr).searchParams;
                const query = searchParams.get('query') || '';

                if (query === 'matrix') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            page: 1,
                            results: [
                                { id: 603, title: 'The Matrix', media_type: 'movie' }
                            ],
                            total_pages: 1,
                            total_results: 1
                        })
                    });
                }

                if (query === 'dhurandhar') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            page: 1,
                            results: [
                                { id: 1291608, title: 'Dhurandhar', media_type: 'movie' }
                            ],
                            total_pages: 1,
                            total_results: 1
                        })
                    });
                }

                // If query is "dhurandar", return 0 results initially
                if (query === 'dhurandar') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            page: 1,
                            results: [],
                            total_pages: 1,
                            total_results: 0
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

    it('should return TMDB results directly when query is spelled correctly', async () => {
        const req = new Request('https://multicanaishd.lol/api/search?q=matrix&lang=pt');
        const res = await GET({ request: req });
        
        expect(res.status).toBe(200);
        const data = await res.json();
        
        expect(data.results.length).toBe(1);
        expect(data.results[0].title).toBe('The Matrix');
        expect(data.exibindoSugestao).toBe(false);
    });

    it('should trigger Google suggest fallback and return corrected results on spelling errors', async () => {
        const req = new Request('https://multicanaishd.lol/api/search?q=dhurandar&lang=pt');
        const res = await GET({ request: req });
        
        expect(res.status).toBe(200);
        const data = await res.json();
        
        expect(data.results.length).toBe(1);
        expect(data.results[0].title).toBe('Dhurandhar');
        expect(data.results[0].id).toBe(1291608);
        expect(data.exibindoSugestao).toBe(true);
        expect(data.sugestaoQuery).toBe('dhurandhar');
    });
});

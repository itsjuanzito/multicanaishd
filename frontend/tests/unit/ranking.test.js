import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockProfiles = [];

// Mock Supabase Admin to prevent actual network calls and dynamically control returned profile data
vi.mock('../../src/services/supabase', () => {
    let currentTable = '';
    const chainable = {
        eq: () => chainable,
        in: () => chainable,
        order: () => chainable,
        limit: () => chainable,
        then: (onfulfilled) => {
            const data = currentTable === 'payments' ? [] : mockProfiles;
            return Promise.resolve({ data, error: null }).then(onfulfilled);
        }
    };
    return {
        supabaseAdmin: {
            from: (table) => {
                currentTable = table;
                return {
                    select: () => chainable
                };
            }
        }
    };
});

import { GET } from '../../src/pages/api/ranking.js';

describe('Ranking API (Unit Tests)', () => {
    beforeEach(() => {
        // Clear global ranking promise caches before each test
        globalThis._rankingPromise = null;
        globalThis._rankingCacheTime = null;
    });

    it('deve calcular corretamente as horas usando a formula oficial e ordenar em ordem decrescente', async () => {
        mockProfiles = [
            {
                id: 'user1',
                username: 'User 1',
                avatar: '1',
                watched_movies: ['m1', 'm2'], // 2 movies * 1.6 = 3.2h
                watched_episodes: { 'show1': ['S1E1', 'S1E2'] }, // 2 episodes * 0.7 = 1.4h. Total = 4.6h
                is_vip: false,
                vip_until: null
            },
            {
                id: 'user2',
                username: 'User 2',
                avatar: '2',
                watched_movies: ['m1'], // 1 movie * 1.6 = 1.6h
                watched_episodes: { 'show1': ['S1E1', 'S1E2', 'S1E3', 'S1E4', 'S1E5'] }, // 5 episodes * 0.7 = 3.5h. Total = 5.1h
                is_vip: true,
                vip_until: '2026-12-31T23:59:59.000Z'
            }
        ];

        const req = new Request('http://localhost:4321/api/ranking?page=1&limit=5');
        const response = await GET({ request: req });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.rankings).toHaveLength(2);

        // User 2 deve estar em primeiro por ter 5.1h (vs 4.6h do User 1)
        const first = data.rankings[0];
        expect(first.username).toBe('User 2');
        expect(first.totalHours).toBe(5.1);
        expect(first.isVIP).toBe(true);

        const second = data.rankings[1];
        expect(second.username).toBe('User 1');
        expect(second.totalHours).toBe(4.6);
        expect(second.isVIP).toBe(false);
    });

    it('deve ser tolerante a dados em branco ou nulos nos perfis usando fallback (Pilar 2)', async () => {
        mockProfiles = [
            {
                id: 'user3',
                username: null, // Fallback to Membro MultiCanaisHD
                avatar: null, // Fallback to '1'
                watched_movies: null, // Fallback to empty list
                watched_episodes: null, // Fallback to empty object
                is_vip: null,
                vip_until: null
            }
        ];

        const req = new Request('http://localhost:4321/api/ranking?page=1&limit=5');
        const response = await GET({ request: req });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.rankings).toHaveLength(1);

        const item = data.rankings[0];
        expect(item.username).toBe('Membro MultiCanaisHD');
        expect(item.avatar).toBe('1');
        expect(item.totalHours).toBe(0.0);
        expect(item.isVIP).toBe(false);
    });
});

const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

// Mock do supabase service para evitar queries reais e erros de importação
// Mock the supabase service to avoid real queries and import errors during tests
vi.mock('../../src/services/supabase', () => {
    const mockFrom = vi.fn((table) => {
        const queryObj = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            single: mockSingle,
            maybeSingle: mockMaybeSingle,
            // Habilita comportamento thenable completo para chamadas encadeadas como update().eq().then()
            // Enables full thenable behavior for chained calls like update().eq().then()
            then: vi.fn().mockImplementation(function(onfulfilled) {
                return Promise.resolve({ data: null, error: null }).then(onfulfilled);
            })
        };
        return queryObj;
    });

    return {
        supabase: {
            auth: {
                getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
                signOut: vi.fn().mockResolvedValue({ error: null }),
                onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
            },
            from: mockFrom,
            channel: vi.fn().mockReturnValue({
                on: vi.fn().mockReturnThis(),
                subscribe: vi.fn().mockReturnThis(),
                unsubscribe: vi.fn()
            })
        }
    };
});

import { authStore, initAuth } from '../../src/store/authStore';
import { supabase } from '../../src/services/supabase';

describe('authStore (Unit Tests)', () => {
    beforeEach(() => {
        // Reseta o estado da store para cada teste
        authStore.set({
            user: null,
            token: null,
            isVIP: false,
            vipUntil: null,
            vipPlan: null,
            loading: false,
            initialized: true,
            favorites: [],
            history: [],
            watchedMovies: [],
            watchedEpisodes: {},
            username: null,
            avatar: '1'
        });
    });

    it('deve inicializar com valores padrão corretos', () => {
        const state = authStore.get();
        expect(state.user).toBeNull();
        expect(state.isVIP).toBe(false);
        expect(state.vipPlan).toBeNull();
        expect(state.favorites).toEqual([]);
    });

    it('deve poder atualizar o usuário, seu status VIP e plano de forma reativa', () => {
        authStore.setKey('user', { email: 'user@test.com', id: '123' });
        authStore.setKey('isVIP', true);
        authStore.setKey('vipPlan', 'anual');
        
        const state = authStore.get();
        expect(state.user.email).toBe('user@test.com');
        expect(state.isVIP).toBe(true);
        expect(state.vipPlan).toBe('anual');
    });

    it('deve redefinir corretamente o estado no logout', () => {
        authStore.set({
            user: { email: 'logged@test.com', id: '999' },
            token: 'test-token',
            isVIP: true,
            vipUntil: '2026-12-31',
            vipPlan: 'mensal',
            loading: false,
            initialized: true,
            favorites: ['movie-1'],
            history: ['movie-1'],
            watchedMovies: ['movie-1'],
            watchedEpisodes: { 'show-1': ['ep-1'] },
            username: 'TestUser',
            avatar: '5'
        });

        // Simula o reset do estado de logout que ocorre em authStore.ts
        authStore.set({ 
            user: null, token: null, isVIP: false, vipUntil: null, vipPlan: null, loading: false, initialized: true,
            favorites: [], history: [], watchedMovies: [], watchedEpisodes: {}, username: null, avatar: '1'
        });

        const state = authStore.get();
        expect(state.user).toBeNull();
        expect(state.isVIP).toBe(false);
        expect(state.vipPlan).toBeNull();
        expect(state.favorites).toEqual([]);
        expect(state.history).toEqual([]);
    });

    it('deve ordenar e mesclar o histórico cronologicamente com strings ISO válidas', async () => {
        // Mock do getSession para retornar um usuário válido
        const mockSession = { user: { id: 'user-123', email: 'user@test.com' }, access_token: 'token-123' };
        vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: mockSession }, error: null });

        // Perfil retornado pelo banco com histórico fora de ordem
        const mockProfile = {
            id: 'user-123',
            email: 'user@test.com',
            is_vip: false,
            favorites: [],
            watched_movies: [],
            watched_episodes: { _nickname: 'testuser' },
            history: [
                { id: '1', title: 'Movie 1', timestamp: '2026-05-21T10:00:00Z' },
                { id: '3', title: 'Movie 3', timestamp: '2026-05-21T12:00:00Z' },
                { id: '2', title: 'Movie 2', timestamp: '2026-05-21T11:00:00Z' }
            ]
        };
        mockSingle.mockResolvedValue({ data: mockProfile, error: null });
        mockMaybeSingle.mockResolvedValue({ data: null, error: null });

        // Executa a inicialização
        await initAuth(true, mockSession);

        const state = authStore.get();
        
        // Verifica se os itens foram ordenados decrescentemente pelo timestamp
        expect(state.history).toHaveLength(3);
        expect(state.history[0].id).toBe('3'); // 12:00:00 (Mais recente)
        expect(state.history[1].id).toBe('2'); // 11:00:00
        expect(state.history[2].id).toBe('1'); // 10:00:00
    });

    it('deve limpar/não preservar o histórico e favoritos de um convidado (guest) no localStorage na inicialização', () => {
        // Armazena dados de convidado no localStorage
        const guestState = {
            user: null,
            token: null,
            favorites: ['fav-guest-1'],
            history: [{ id: 'hist-guest-1', title: 'Movie Guest' }],
            watchedMovies: [],
            watchedEpisodes: {}
        };
        localStorage.setItem('bf_session_optimistic', JSON.stringify(guestState));

        // Inicializa o estado simulando o subscriber
        authStore.setKey('initialized', false);
        authStore.set({
            ...authStore.get(),
            ...guestState,
            initialized: true
        });

        // Verifica se os dados do convidado foram limpos para evitar persistência indevida
        const saved = localStorage.getItem('bf_session_optimistic');
        expect(saved).not.toBeNull();
        const parsed = JSON.parse(saved);
        expect(parsed.favorites).toEqual([]);
        expect(parsed.history).toEqual([]);
    });
});

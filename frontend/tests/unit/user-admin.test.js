import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../../src/pages/api/admin/user-admin.js';
import { supabaseAdmin } from '../../src/services/supabase.js';

vi.mock('../../src/services/env-adapter.js', () => {
    return {
        getEnv: (key) => {
            if (key === 'ADMIN_MODERATION_TOKEN') return 'valid-mod-token';
            return undefined;
        }
    };
});

vi.mock('../../src/services/supabase.js', () => {
    const mockSupabase = {
        from: vi.fn()
    };
    return {
        supabaseAdmin: mockSupabase
    };
});

describe('User Admin API Endpoint (Unit Tests)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deve rejeitar requisições sem token de moderador válido', async () => {
        const request = {
            url: 'http://localhost/api/admin/user-admin?query=test&token=invalid-token'
        };

        const response = await GET({ request });
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe("Unauthorized");
    });

    it('deve buscar perfis incluindo busca por nickname (username)', async () => {
        // Mocking do Supabase query builder chain
        const mockGte = vi.fn();
        const mockLte = vi.fn();
        const mockOr = vi.fn().mockResolvedValue({
            data: [
                { id: 'user-id-1', email: 'john@example.com', username: 'johnny', watched_episodes: { _nickname: 'johnny' }, is_vip: true, vip_until: new Date(Date.now() + 100000).toISOString() }
            ],
            error: null
        });

        // Mock para consulta de pagamentos
        const mockIn = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockOrder = vi.fn().mockResolvedValue({
            data: [
                { user_id: 'user-id-1', amount: 1000, created_at: new Date().toISOString() }
            ],
            error: null
        });

        const mockSelect = vi.fn().mockImplementation((fields) => {
            if (fields.includes('amount')) {
                // É a query de pagamentos
                return {
                    in: mockIn,
                    eq: mockEq,
                    order: mockOrder
                };
            }
            // É a query de perfis
            return {
                or: mockOr,
                gte: mockGte,
                lte: mockLte
            };
        });

        supabaseAdmin.from.mockReturnValue({
            select: mockSelect
        });

        const request = {
            url: 'http://localhost/api/admin/user-admin?query=johnny&token=valid-mod-token'
        };

        const response = await GET({ request });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.users.length).toBe(1);
        expect(data.users[0].nickname).toBe('johnny');

        // Verificar se a consulta do Supabase filtrou por email, nickname e id
        expect(supabaseAdmin.from).toHaveBeenCalledWith('profiles');
        expect(mockSelect).toHaveBeenCalledWith('*');
        
        // Verificar se o or() inclui a pesquisa por nickname (username)
        const orCallArg = mockOr.mock.calls[0][0];
        expect(orCallArg).toContain('username.ilike.%johnny%');
        expect(orCallArg).toContain('watched_episodes->>_nickname.ilike.%johnny%');
        expect(orCallArg).toContain('email.ilike.%johnny%');
        expect(orCallArg).toContain('id.eq.');
    });

    it('deve conceder VIP acumulando dias se o usuário já for VIP (let instead of const)', async () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 10); // Expira em 10 dias
        const vipUntilStr = futureDate.toISOString();

        const mockMaybeSingle = vi.fn().mockResolvedValue({
            data: { id: 'user-id-existing', is_vip: true, vip_until: vipUntilStr },
            error: null
        });

        const mockEqUpdate = vi.fn().mockResolvedValue({ error: null });
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqUpdate });

        const mockEqSelect = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEqSelect });
        
        const mockInsert = vi.fn().mockResolvedValue({ error: null });

        supabaseAdmin.from.mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: mockSelect,
                    update: mockUpdate
                };
            }
            if (table === 'payments') {
                return {
                    insert: mockInsert
                };
            }
        });

        const request = {
            json: async () => ({
                userId: 'user-id-existing',
                action: 'activate',
                planType: 'diamond',
                duration: 'mensal',
                token: 'valid-mod-token'
            })
        };

        const response = await POST({ request });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.action).toBe('activate');

        // Verifica se update foi chamado com o novo vip_until (VIP anterior + 30 dias)
        expect(mockUpdate).toHaveBeenCalled();
        const updateArg = mockUpdate.mock.calls[0][0];
        expect(updateArg.is_vip).toBe(true);
        
        const updatedDate = new Date(updateArg.vip_until);
        const expectedDate = new Date(vipUntilStr);
        expectedDate.setDate(expectedDate.getDate() + 30);
        
        expect(updatedDate.getDate()).toBe(expectedDate.getDate());
    });
});

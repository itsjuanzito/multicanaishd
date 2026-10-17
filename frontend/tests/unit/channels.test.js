import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchVipChannels } from '../../src/services/channelsService';
import { supabase, supabaseAdmin } from '../../src/services/supabase';

// Mockar o cliente Supabase para isolamento total do teste unitário
vi.mock('../../src/services/supabase', () => {
    const mockFrom = vi.fn();
    return {
        supabase: {
            from: mockFrom
        },
        supabaseAdmin: {
            from: mockFrom
        }
    };
});

describe('Channels Resilient VIP Service (Unit Tests)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Resetar o estado do cache global antes de cada teste
        if (globalThis._bf_channels_state) {
            globalThis._bf_channels_state.vipChannelsCache = null;
            globalThis._bf_channels_state.vipCacheTimestamp = 0;
            globalThis._bf_channels_state.currentVipFetchPromise = null;
        }
    });

    it('deve buscar os canais VIP com sucesso do Supabase', async () => {
        // Configura o mock do Supabase para retornar dados normais
        const mockData = [
            { channel_id: 'sportv-1' },
            { channel_id: 'premiere-2' }
        ];

        supabaseAdmin.from.mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: mockData, error: null })
        });

        const vipChannels = await fetchVipChannels();

        expect(supabaseAdmin.from).toHaveBeenCalledWith('vip_channels');
        expect(vipChannels).toEqual(['sportv-1', 'premiere-2']);
    });

    it('deve usar o cache em memória em chamadas consecutivas (HIT)', async () => {
        const mockData = [{ channel_id: 'combate-hd' }];
        const selectMock = vi.fn().mockResolvedValue({ data: mockData, error: null });
        supabaseAdmin.from.mockReturnValue({ select: selectMock });

        // Primeira chamada - deve bater no mock (MISS)
        const res1 = await fetchVipChannels();
        expect(res1).toEqual(['combate-hd']);
        expect(selectMock).toHaveBeenCalledTimes(1);

        // Segunda chamada - deve vir do cache em memória (HIT)
        const res2 = await fetchVipChannels();
        expect(res2).toEqual(['combate-hd']);
        // O mock da query ao banco não deve ter sido incrementado (continua 1)
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('deve ativar o timeout fail-safe (Promise.race) se a conexão demorar mais de 8 segundos', async () => {
        // O timeout foi ampliado de 3s para 8s (commit 7eeef32) para evitar falsos
        // negativos de VIP em cold starts lentos do Supabase — simulamos uma
        // conexão mais lenta que esse novo limite para validar o fail-safe.
        const slowSelect = vi.fn().mockImplementation(() => {
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve({ data: [{ channel_id: 'demorado' }], error: null });
                }, 9000);
            });
        });

        supabaseAdmin.from.mockReturnValue({ select: slowSelect });

        const startTime = Date.now();
        const vipChannels = await fetchVipChannels();
        const duration = Date.now() - startTime;

        // O teste deve finalizar antes de 8.5 segundos (SLA de 8 segundos de timeout)
        expect(duration).toBeLessThan(8500);
        // Deve retornar um fallback de array vazio ao invés de estourar
        expect(vipChannels).toEqual([]);
    }, 9000); // Timeout do teste configurado em 9s (margem para o race de 8s expirar)

    it('deve isolar falhas/erros de banco de dados e retornar array vazio amigavelmente', async () => {
        // Simular rejeição de conexão ou erro de sintaxe
        supabaseAdmin.from.mockReturnValue({
            select: vi.fn().mockRejectedValue(new Error('PostgrestError: Connection refused'))
        });

        const vipChannels = await fetchVipChannels();

        // Não deve estourar erro, deve retornar array vazio amigavelmente
        expect(vipChannels).toEqual([]);
    });
});

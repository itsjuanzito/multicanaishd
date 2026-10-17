import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCanais, fetchVipChannels } from '../../src/services/channelsService';
import { supabaseAdmin } from '../../src/services/supabase';

// Regressão do bug que derrubava a indexação: /canal/* devolvia 524.
//
// Medido em produção, 11 de 20 requisições a /canal/* NUNCA respondiam — a resposta HTTP
// ficava aberta e a Cloudflare devolvia 524 (confirmado: status=524 time=125,4s). 5xx em
// massa é justamente o que faz o Google cortar o crawl budget (§4.2 das regras do projeto).
//
// A causa não era o `.catch()` que já existia: catch pega REJEIÇÃO, não pega TRAVAMENTO. E
// como cada busca é cacheada num global do isolate, uma promise que não assentava
// envenenava todas as requisições seguintes daquele isolate — por isso o sintoma era
// intermitente (isolates novos respondiam, isolates contaminados travavam).
//
// Estes testes travam a garantia que interessa: por pior que esteja o upstream, a função
// SEMPRE devolve, dentro do teto.

vi.mock('../../src/services/supabase', () => {
    const mockFrom = vi.fn();
    return {
        supabase: { from: mockFrom },
        supabaseAdmin: { from: mockFrom }
    };
});

// Espelham CANAIS_FETCH_CEILING_MS / VIP_FETCH_CEILING_MS (channelsService.js).
const TETO_CANAIS_MS = 7000;
const TETO_VIP_MS = 5000;

const NUNCA_ASSENTA = () => new Promise(() => {});

function resetarEstadoGlobal() {
    const estado = globalThis._bf_channels_state;
    if (!estado) return;
    estado.canaisCache = null;
    estado.cacheTimestamp = 0;
    estado.currentFetchPromise = null;
    estado.vipChannelsCache = null;
    estado.vipCacheTimestamp = 0;
    estado.currentVipFetchPromise = null;
}

describe('Channels — teto rígido contra travamento no SSR (regressão do 524)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetarEstadoGlobal();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        resetarEstadoGlobal();
    });

    it('fetchVipChannels devolve (não pendura) quando o Supabase nunca responde', async () => {
        supabaseAdmin.from.mockReturnValue({ select: NUNCA_ASSENTA });

        vi.useFakeTimers();
        const promessa = fetchVipChannels(true);
        await vi.advanceTimersByTimeAsync(TETO_VIP_MS + 50);

        await expect(promessa).resolves.toEqual([]);
    });

    it('fetchVipChannels degrada para a última lista conhecida em vez de vazio', async () => {
        supabaseAdmin.from.mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [{ channel_id: 'sportv-1' }], error: null })
        });
        await expect(fetchVipChannels(true)).resolves.toEqual(['sportv-1']);

        supabaseAdmin.from.mockReturnValue({ select: NUNCA_ASSENTA });

        vi.useFakeTimers();
        const promessa = fetchVipChannels(true);
        await vi.advanceTimersByTimeAsync(TETO_VIP_MS + 50);

        await expect(promessa).resolves.toEqual(['sportv-1']);
    });

    it('fetchVipChannels libera o singleton global mesmo quando a busca trava', async () => {
        supabaseAdmin.from.mockReturnValue({ select: NUNCA_ASSENTA });

        vi.useFakeTimers();
        const primeira = fetchVipChannels(true);
        await vi.advanceTimersByTimeAsync(TETO_VIP_MS + 50);
        await primeira;

        // O singleton que sustentava o envenenamento do isolate precisa ter sido liberado.
        expect(globalThis._bf_channels_state.currentVipFetchPromise).toBe(null);
    });

    it('fetchCanais devolve (não pendura) quando a API de canais nunca responde', async () => {
        vi.stubGlobal('fetch', NUNCA_ASSENTA);

        vi.useFakeTimers();
        const promessa = fetchCanais();
        await vi.advanceTimersByTimeAsync(TETO_CANAIS_MS + 50);

        await expect(promessa).resolves.toEqual([]);
        expect(globalThis._bf_channels_state.currentFetchPromise).toBe(null);
    });
});

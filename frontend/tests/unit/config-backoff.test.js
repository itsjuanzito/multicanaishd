// tests/unit/config-backoff.test.js
// Regressão: state.lastFetch só era atualizado no caminho de sucesso, então enquanto o KV
// estivesse lento/fora TODA chamada de getConfig tentava de novo sem espera — o volume de
// leitura subia justamente quando o KV estava pior. Ver src/services/configService.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const makeKV = (impl) => ({ get: vi.fn(impl), put: vi.fn(async () => {}) });

let kvAtual = null;

vi.mock('../../src/services/env-adapter.js', () => ({
    getEnv: (key, defaultValue = null) => (key === 'SESSION' ? kvAtual : defaultValue)
}));

const carregarServico = async () => {
    vi.resetModules();
    globalThis._bf_system_config = { data: {}, lastFetch: 0, nextAttemptAt: 0 };
    return import('../../src/services/configService.js');
};

describe('configService — recuo após falha de KV', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        kvAtual = null;
    });

    it('não martela o KV enquanto ele está falhando', async () => {
        kvAtual = makeKV(async () => {
            throw new Error('KV fora');
        });
        const { getAllConfigs } = await carregarServico();

        await getAllConfigs();
        const depoisDaPrimeira = kvAtual.get.mock.calls.length;
        await getAllConfigs();
        await getAllConfigs();
        await getAllConfigs();

        // Sem o recuo, cada chamada geraria uma leitura nova.
        expect(kvAtual.get.mock.calls.length).toBe(depoisDaPrimeira);
    });

    it('volta a tentar depois que a janela de recuo passa', async () => {
        kvAtual = makeKV(async () => {
            throw new Error('KV fora');
        });
        const { getAllConfigs } = await carregarServico();

        await getAllConfigs();
        const antes = kvAtual.get.mock.calls.length;
        await getAllConfigs();
        expect(kvAtual.get.mock.calls.length).toBe(antes);

        vi.advanceTimersByTime(6000); // recuo é de 5s
        await getAllConfigs();
        expect(kvAtual.get.mock.calls.length).toBeGreaterThan(antes);
    });

    it('serve o último valor bom conhecido durante a falha, não o default', async () => {
        let deveFalhar = false;
        kvAtual = makeKV(async () => {
            if (deveFalhar) throw new Error('KV fora');
            return JSON.stringify({ AD_PROVIDER: 'monetag' });
        });
        const { getAllConfigs } = await carregarServico();

        const bom = await getAllConfigs();
        expect(bom.AD_PROVIDER).toBe('monetag');

        deveFalhar = true;
        vi.advanceTimersByTime(120000); // expira o TTL normal
        const durante = await getAllConfigs();
        expect(durante.AD_PROVIDER).toBe('monetag'); // não regride pro default 'adsterra'
    });

    it('force ignora o recuo — o painel /moderacao precisa ver o KV real', async () => {
        kvAtual = makeKV(async () => {
            throw new Error('KV fora');
        });
        const { getAllConfigs } = await carregarServico();

        await getAllConfigs();
        const antes = kvAtual.get.mock.calls.length;
        await getAllConfigs({ force: true });

        expect(kvAtual.get.mock.calls.length).toBeGreaterThan(antes);
    });
});

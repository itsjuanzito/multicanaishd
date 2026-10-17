// Regressão de custo: o L1 em RAM escolhia a vítima da expulsão pela ordem de INSERÇÃO do
// Map. Como `Map.set` numa chave existente não move a posição dela, a política era FIFO pura:
// um título quente era descartado por ser antigo enquanto um título frio, inserido depois,
// sobrevivia. Com um catálogo de dezenas de milhares varrido por bots, o L1 vivia em
// thrashing, e cada miss custava DUAS coisas faturadas: uma leitura de KV ($0,50/milhão) e um
// JSON.parse do payload (CPU, $0,02/milhão de ms).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/env-adapter.js', () => ({
    getEnv: () => undefined,
    getRuntimeWaitUntil: () => null,
}));

let getCached;
let setCached;

beforeEach(async () => {
    vi.resetModules();
    // O Map do L1 é escopo de módulo, então `resetModules` já entrega um cache limpo.
    ({ getCached, setCached } = await import('../../src/services/cache.js'));
});

// Espelha o teto de `setCached`. Os testes derivam tudo daqui pra não descalibrarem
// silenciosamente se o teto mudar de novo — com números fixos, um teto maior faria a
// expulsão nunca acontecer e os testes passariam sem exercitar nada.
const TETO = 800;

describe('L1 — política de expulsão', () => {
    // O que a mudança altera é QUAL posição uma chave ocupa: sob FIFO ela fica presa na de
    // inserção; sob LRU o acesso a promove. Os números abaixo são escolhidos pra que a
    // expulsão atinja exatamente a faixa que separa as duas políticas.
    it('lê-la promove a chave quente na frente das frias anteriores', () => {
        setCached('quente', { v: 1 });
        for (let i = 0; i < TETO - 50; i++) setCached(`frio_${i}`, { v: i });

        // Acesso que deve renovar a posição de 'quente' na fila de expulsão.
        expect(getCached('quente')).toEqual({ v: 1 });

        // Total inserido passa do teto, então algumas chaves precisam sair.
        for (let i = 0; i < 100; i++) setCached(`enchimento_${i}`, { v: i });

        // Sob FIFO puro 'quente' era a mais antiga e seria a PRIMEIRA a sair. Sob LRU ela foi
        // promovida pra depois das frias, então quem sai são as frias.
        expect(getCached('quente')).toEqual({ v: 1 });
        expect(getCached('frio_0')).toBeNull();
    });

    it('reescrever uma chave também renova a posição dela', () => {
        setCached('regravada', { v: 1 });
        for (let i = 0; i < TETO - 50; i++) setCached(`frio_${i}`, { v: i });

        setCached('regravada', { v: 2 });
        for (let i = 0; i < 100; i++) setCached(`enchimento_${i}`, { v: i });

        expect(getCached('regravada')).toEqual({ v: 2 });
        expect(getCached('frio_0')).toBeNull();
    });

    it('a chave genuinamente fria é a que sai', () => {
        setCached('fria', { v: 1 });
        // Nunca mais tocada. Enche o cache bem além do teto.
        for (let i = 0; i < TETO * 2; i++) setCached(`enchimento_${i}`, { v: i });

        expect(getCached('fria')).toBeNull();
    });

    it('respeita o teto de entradas', () => {
        const total = TETO * 3;
        for (let i = 0; i < total; i++) setCached(`k_${i}`, { v: i });

        const vivas = Array.from({ length: total }, (_, i) => getCached(`k_${i}`)).filter(Boolean);
        expect(vivas.length).toBeLessThanOrEqual(TETO + 1);
        // E o teto precisa estar sendo mesmo aproveitado, não colapsado pra um punhado.
        expect(vivas.length).toBeGreaterThan(TETO / 2);
    });

    it('TTL expirado continua valendo, mesmo para chave lida com frequência', () => {
        vi.useFakeTimers();
        setCached('expira', { v: 1 }, 1000);
        expect(getCached('expira')).toEqual({ v: 1 });

        vi.advanceTimersByTime(1500);
        expect(getCached('expira')).toBeNull();
        vi.useRealTimers();
    });
});

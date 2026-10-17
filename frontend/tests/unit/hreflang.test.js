// tests/unit/hreflang.test.js
// Regressão de duas armadilhas reais:
//  1. página de conteúdo espelhando o path e trocando /en → alternate apontando para um 301;
//  2. rota de conteúdo SEM o mapa de slugs caindo silenciosamente no espelhamento de novo,
//     porque `null` (rota não informa) e `{pt:null,en:null}` (rota informa que não sabe)
//     eram tratados igual.
import { describe, it, expect } from 'vitest';
import { resolverHreflang } from '../../src/utils/hreflang.js';

const PT = 'https://multicanaishd.lol/filme/603-matrix';
const EN = 'https://multicanaishd.lol/en/filme/603-the-matrix';

describe('resolverHreflang', () => {
    it('espelha o path quando a rota NÃO informa alternates (hub, gênero, canal, estática)', () => {
        expect(resolverHreflang({ alternates: undefined, ptUrl: PT, enUrl: EN, indexavel: true }))
            .toEqual({ pt: PT, en: EN, xDefault: PT });
    });

    it('OMITE tudo quando a rota informa que não conhece os slugs (dois nulls)', () => {
        expect(resolverHreflang({ alternates: { pt: null, en: null }, ptUrl: PT, enUrl: EN, indexavel: true }))
            .toEqual({ pt: null, en: null, xDefault: null });
    });

    it('usa os alternates explícitos quando a rota conhece os dois slugs', () => {
        const enReal = 'https://multicanaishd.lol/en/filme/603-the-matrix';
        expect(resolverHreflang({
            alternates: { pt: PT, en: enReal },
            ptUrl: 'https://multicanaishd.lol/filme/603-slug-errado',
            enUrl: 'https://multicanaishd.lol/en/filme/603-slug-errado',
            indexavel: true,
        })).toEqual({ pt: PT, en: enReal, xDefault: PT });
    });

    it('declara só o PT quando o lado EN é desconhecido, e mantém x-default nele', () => {
        expect(resolverHreflang({ alternates: { pt: PT, en: null }, ptUrl: PT, enUrl: EN, indexavel: true }))
            .toEqual({ pt: PT, en: null, xDefault: PT });
    });

    it('nunca usa o espelhamento para preencher o lado que a rota marcou como desconhecido', () => {
        const r = resolverHreflang({ alternates: { pt: null, en: EN }, ptUrl: PT, enUrl: EN, indexavel: true });
        expect(r.pt).toBeNull();
        expect(r.en).toBe(EN);
        expect(r.xDefault).toBe(EN); // sem PT, x-default cai no EN em vez de apontar para nada
    });

    it('não emite hreflang nenhum em página noindex', () => {
        expect(resolverHreflang({ alternates: undefined, ptUrl: PT, enUrl: EN, indexavel: false }))
            .toEqual({ pt: null, en: null, xDefault: null });
        expect(resolverHreflang({ alternates: { pt: PT, en: EN }, ptUrl: PT, enUrl: EN, indexavel: false }))
            .toEqual({ pt: null, en: null, xDefault: null });
    });
});

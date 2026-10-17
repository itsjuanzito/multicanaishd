// tests/unit/content-slug-pairs.test.js
// Regressão: o hreflang de /filme, /serie e episódio espelhava o path e trocava /en, apontando
// para uma URL que a rota de destino responde 301 (o slug canônico muda de idioma para idioma).
// Ver src/services/contentSlugPairs.js.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    chaveDeMidia,
    indexarPares,
    obterParDeSlugs,
    urlsDeAlternate,
    __definirParesParaTeste,
} from '../../src/services/contentSlugPairs.js';

describe('chaveDeMidia', () => {
    it('trata tv/series/serie como a mesma coisa (a origem do dado é o TMDB)', () => {
        expect(chaveDeMidia('tv', 1396)).toBe('tv:1396');
        expect(chaveDeMidia('series', '1396')).toBe('tv:1396');
        expect(chaveDeMidia('serie', 1396)).toBe('tv:1396');
    });

    it('trata movie/filme como a mesma coisa', () => {
        expect(chaveDeMidia('movie', 603)).toBe('movie:603');
        expect(chaveDeMidia('filme', '603')).toBe('movie:603');
    });

    it('devolve string vazia sem id, para o chamador omitir o alternate', () => {
        expect(chaveDeMidia('movie', null)).toBe('');
        expect(chaveDeMidia('movie', '')).toBe('');
        expect(chaveDeMidia('movie', undefined)).toBe('');
    });
});

describe('indexarPares', () => {
    it('indexa os pares válidos e ignora entradas sem slug nenhum', () => {
        const mapa = indexarPares({
            'movie:603': { pt: 'matrix', en: 'the-matrix' },
            'tv:1396': { pt: 'breaking-bad', en: null },
            'movie:999': { pt: null, en: null },
            'movie:1000': null,
        });
        expect(mapa.size).toBe(2);
        expect(mapa.get('movie:603')).toEqual({ pt: 'matrix', en: 'the-matrix' });
        expect(mapa.get('tv:1396')).toEqual({ pt: 'breaking-bad', en: null });
    });

    it('aceita objeto vazio sem explodir', () => {
        expect(indexarPares({}).size).toBe(0);
        expect(indexarPares(undefined).size).toBe(0);
    });
});

describe('obterParDeSlugs', () => {
    beforeEach(() => {
        // O host precisa bater com o do hint: carregarPares() limpa o cache L1 quando o host
        // muda (troca de domínio), e é isso que os testes abaixo usam de propósito.
        __definirParesParaTeste(
            { 'movie:603': { pt: 'matrix', en: 'the-matrix' } },
            'multicanaishd.lol',
        );
    });

    it('devolve o par quando o item está no mapa', async () => {
        await expect(obterParDeSlugs(603, 'movie', 'https://multicanaishd.lol/')).resolves.toEqual({
            pt: 'matrix',
            en: 'the-matrix',
        });
    });

    it('devolve null quando o item NÃO está no mapa — quem chama omite o alternate', async () => {
        await expect(obterParDeSlugs(99999, 'movie', 'https://multicanaishd.lol/')).resolves.toBeNull();
    });

    it('devolve null sem id, em vez de lançar', async () => {
        await expect(obterParDeSlugs(null, 'movie', 'https://multicanaishd.lol/')).resolves.toBeNull();
    });

    it('limpa o cache quando o domínio da requisição muda', async () => {
        // Host DIFERENTE do semeado no beforeEach de propósito: é a troca de host que
        // invalida o cache L1 (o blob é por domínio). Se este host fosse igual ao semeado,
        // o teste passaria a afirmar o contrário do que existe para provar.
        await expect(obterParDeSlugs(603, 'movie', 'https://outro-dominio.example/')).resolves.toBeNull();
    });
});

describe('urlsDeAlternate', () => {
    const base = { siteUrl: 'https://multicanaishd.lol', rota: 'serie', id: '1396' };

    it('usa o slug rotacionado do PT quando ele existe', () => {
        const r = urlsDeAlternate({
            ...base,
            par: { pt: 'breaking-bad', en: 'breaking-bad' },
            slugPtRotacionado: '1396-breaking-bad-2',
        });
        expect(r.pt).toBe('https://multicanaishd.lol/serie/1396-breaking-bad-2');
        expect(r.en).toBe('https://multicanaishd.lol/en/serie/1396-breaking-bad');
    });

    it('omite o alternate EN quando o slug em inglês é desconhecido', () => {
        const r = urlsDeAlternate({ ...base, par: { pt: 'dorama-coreano', en: null } });
        expect(r.pt).toBe('https://multicanaishd.lol/serie/1396-dorama-coreano');
        expect(r.en).toBeNull();
    });

    it('devolve os dois lados nulos sem par nenhum', () => {
        expect(urlsDeAlternate({ ...base, par: null })).toEqual({ pt: null, en: null });
    });
});

// tests/unit/url-rotation-lang.test.js
// Regressão da MELHORIA 1 (rotação Anti-DMCA por idioma): o painel precisa conseguir mover a
// URL /en/ quando o Cloudflare aplica 451 nela. Aqui ficam as garantias de que cada idioma usa
// as SUAS colunas e o SEU slug canônico (TMDB no idioma), e de que o fallback nunca inventa
// rotação. Ver src/services/urlRotationService.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getTMDBDetails = vi.fn();
const upserts = [];
let rotacaoExistente = null;

vi.mock('../../src/services/tmdb.js', () => ({
    getTMDBDetails: (...a) => getTMDBDetails(...a),
}));

// Stub mínimo do encadeamento usado pelo service:
//   buscarRotacao: .from().select('*').eq().eq().maybeSingle()
//   salvarRotacao: .from().upsert(registro, opts).select().single()
vi.mock('../../src/services/supabase.js', () => ({
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: rotacaoExistente }) }),
                }),
            }),
            upsert: (registro) => {
                upserts.push(registro);
                return { select: () => ({ single: async () => ({ data: registro, error: null }) }) };
            },
        }),
    },
}));

const {
    resolverIdioma,
    erroDeColunaAusente,
    resolveRotatedSlug,
    rotateMediaUrl,
} = await import('../../src/services/urlRotationService.js');

const MATRIX_PT = { id: 603, title: 'Matrix' };
const MATRIX_EN = { id: 603, title: 'The Matrix' };
const BREAKING_PT = { id: 1396, name: 'Breaking Bad' };
const BREAKING_EN = { id: 1396, name: 'Breaking Bad' };

// Simula a diferença real do TMDB: o título vem no idioma pedido.
const DETALHES_POR_ID = {
    '603': { pt: MATRIX_PT, en: MATRIX_EN },
    '1396': { pt: BREAKING_PT, en: BREAKING_EN },
};

beforeEach(() => {
    vi.clearAllMocks();
    upserts.length = 0;
    rotacaoExistente = null;
    getTMDBDetails.mockImplementation(async (id, _tipo, lang) => {
        const porIdioma = DETALHES_POR_ID[String(id)] || DETALHES_POR_ID['603'];
        return lang === 'en' ? porIdioma.en : porIdioma.pt;
    });
});

describe('resolverIdioma', () => {
    it('aceita pt e en explícitos', () => {
        expect(resolverIdioma('pt', '/en/filme/603-x')).toBe('pt');
        expect(resolverIdioma('en', '/filme/603-x')).toBe('en');
    });

    it('detecta en pelo /en/ da entrada quando o parâmetro é omitido', () => {
        expect(resolverIdioma(undefined, 'https://multicanaishd.lol/en/filme/603-the-matrix')).toBe('en');
        expect(resolverIdioma(undefined, 'https://multicanaishd.lol/filme/603-matrix')).toBe('pt');
        expect(resolverIdioma(undefined, '603-matrix')).toBe('pt');
    });

    it('cai em pt para idioma desconhecido (nunca rotaciona no idioma errado)', () => {
        expect(resolverIdioma('es', '/en/filme/603-x')).toBe('pt');
        expect(resolverIdioma('EN', '/filme/603-x')).toBe('en');
        expect(resolverIdioma('', '')).toBe('pt');
    });
});

describe('erroDeColunaAusente', () => {
    it('reconhece o erro de coluna/schema cache do PostgREST', () => {
        expect(erroDeColunaAusente({ code: 'PGRST204', message: 'x' })).toBe(true);
        expect(erroDeColunaAusente({ code: '42703', message: 'x' })).toBe(true);
        expect(erroDeColunaAusente({ message: "column 'current_slug_en' does not exist" })).toBe(true);
    });

    it('não confunde erro alheio com migração pendente', () => {
        expect(erroDeColunaAusente({ code: '42P01', message: 'relation does not exist' })).toBe(false);
        expect(erroDeColunaAusente(null)).toBe(false);
    });
});

describe('resolveRotatedSlug por idioma', () => {
    it('devolve o slug rotacionado do idioma pedido', async () => {
        globalThis._bf_url_rotations.byMedia.set('movie:9001', {
            media_id: '9001',
            media_type: 'movie',
            original_slug: '9001-filme',
            current_slug: '9001-filme-2',
            original_slug_en: '9001-movie',
            current_slug_en: '9001-the-movie-1',
        });

        expect(await resolveRotatedSlug(9001, 'movie', '9001-filme')).toBe('9001-filme-2');
        expect(await resolveRotatedSlug(9001, 'movie', '9001-the-movie', 'en')).toBe('9001-the-movie-1');
        // Idioma inválido = comportamento PT (nunca "sem rotação").
        expect(await resolveRotatedSlug(9001, 'movie', '9001-the-movie', 'es')).toBe('9001-filme-2');
    });

    it('cai no fallback quando o idioma ainda não tem rotação própria', async () => {
        globalThis._bf_url_rotations.byMedia.set('series:9002', {
            media_id: '9002',
            media_type: 'series',
            original_slug: '9002-serie',
            current_slug: '9002-serie-1',
            original_slug_en: null,
            current_slug_en: null,
        });

        expect(await resolveRotatedSlug(9002, 'series', '9002-the-series', 'en')).toBe('9002-the-series');
        expect(await resolveRotatedSlug(9002, 'series', '9002-serie')).toBe('9002-serie-1');
    });
});

describe('rotateMediaUrl — colunas por idioma', () => {
    it('pt grava nas colunas históricas e devolve URL em pt', async () => {
        const r = await rotateMediaUrl({ input: 'https://multicanaishd.lol/filme/603-matrix', lang: 'pt' });

        expect(upserts).toHaveLength(1);
        expect(upserts[0].original_slug).toBe('603-matrix');
        expect(upserts[0].current_slug).toBe('603-matrix-1');
        expect(upserts[0].rotation_count).toBe(1);
        expect(upserts[0].current_slug_en).toBeUndefined();
        expect(r.fullUrl).toBe('/filme/603-matrix-1');
        expect(r.lang).toBe('pt');
    });

    it('en grava nas colunas _en com o slug do TMDB em inglês e devolve URL /en/', async () => {
        const r = await rotateMediaUrl({
            input: 'https://multicanaishd.lol/en/filme/603-the-matrix',
            lang: 'en',
        });

        expect(getTMDBDetails).toHaveBeenCalledWith('603', 'movie', 'en');
        expect(upserts).toHaveLength(1);
        expect(upserts[0].original_slug_en).toBe('603-the-matrix');
        expect(upserts[0].current_slug_en).toBe('603-the-matrix-1');
        expect(upserts[0].rotation_count_en).toBe(1);
        // Colunas PT existentes/nulas não podem ser apagadas nem apontar para o slug EN.
        expect(upserts[0].current_slug).not.toBe('603-the-matrix-1');
        expect(r.fullUrl).toBe('/en/filme/603-the-matrix-1');
        expect(r.lang).toBe('en');
    });

    it('detecta en pela URL quando lang não é enviado', async () => {
        await rotateMediaUrl({ input: 'https://multicanaishd.lol/en/serie/1396-breaking-bad' });

        expect(getTMDBDetails).toHaveBeenCalledWith('1396', 'tv', 'en');
        expect(upserts[0].current_slug_en).toBe('1396-breaking-bad-1');
        expect(upserts[0].media_type).toBe('series');
    });

    it('não sobrescreve a rotação do outro idioma já existente', async () => {
        rotacaoExistente = {
            media_id: '603',
            media_type: 'movie',
            original_slug: '603-matrix',
            current_slug: '603-matrix-4',
            rotation_count: 4,
            original_slug_en: '603-the-matrix',
            current_slug_en: '603-the-matrix-2',
            rotation_count_en: 2,
        };

        const r = await rotateMediaUrl({ input: '603-matrix', lang: 'pt' });

        expect(upserts[0].current_slug).toBe('603-matrix-5');
        expect(upserts[0].current_slug_en).toBeUndefined();
        expect(r.newSlug).toBe('603-matrix-5');
        expect(r.previousSlug).toBe('603-matrix-4');
    });

    it('en sem linha prévia semeia as colunas PT com o canônico PT (evita laço de 301)', async () => {
        const r = await rotateMediaUrl({ input: '/en/filme/603-the-matrix', lang: 'en' });

        expect(upserts[0].current_slug).toBe('603-matrix');
        expect(upserts[0].rotation_count).toBe(0);
        expect(r.newSlug).toBe('603-the-matrix-1');
    });

    it('slug personalizado herda o prefixo do id nos dois idiomas', async () => {
        await rotateMediaUrl({ input: 'filme/603-matrix', customSlug: 'matrix-especial', lang: 'pt' });
        expect(upserts[0].current_slug).toBe('603-matrix-especial');
    });
});

// tests/unit/url-checker.test.js
// Checagem sob demanda de URLs soltas (MELHORIA 2): parser de entrada, guarda de SSRF e o
// contrato de que NADA derruba a resposta inteira — item com falha vira { status: 0, erro }.
// Ver src/services/urlCheckerService.js e src/pages/api/admin/check-urls.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    prepararAlvo,
    hostBloqueado,
    checarUrls,
    MAX_URLS_POR_CHAMADA,
} from '../../src/services/urlCheckerService.js';

const ORIGEM = 'https://multicanaishd.lol';

describe('prepararAlvo', () => {
    it('aceita URL absoluta http/https', () => {
        expect(prepararAlvo('https://multicanaishd.lol/en/filme/603-the-matrix', ORIGEM).pathname)
            .toBe('/en/filme/603-the-matrix');
        expect(prepararAlvo('http://exemplo.com/x', ORIGEM).protocol).toBe('http:');
    });

    it('resolve caminho relativo contra a origem do painel', () => {
        expect(prepararAlvo('/serie/1396-breaking-bad', ORIGEM).href)
            .toBe('https://multicanaishd.lol/serie/1396-breaking-bad');
    });

    it('rejeita lixo, vazio e esquemas não-http', () => {
        expect(prepararAlvo('', ORIGEM)).toBeNull();
        expect(prepararAlvo(null, ORIGEM)).toBeNull();
        expect(prepararAlvo('   ', ORIGEM)).toBeNull();
        expect(prepararAlvo('isso não é url', ORIGEM)).toBeNull();
        expect(prepararAlvo('file:///etc/passwd', ORIGEM)).toBeNull();
        expect(prepararAlvo('javascript:alert(1)', ORIGEM)).toBeNull();
    });

    it('remove a ofuscação hxxp:// (colada do Lumen)', () => {
        expect(prepararAlvo('hxxps://multicanaishd.lol/filme/603-matrix', ORIGEM)).toBeNull();
    });
});

describe('hostBloqueado (SSRF)', () => {
    it('bloqueia rede interna e localhost', () => {
        for (const host of [
            'http://localhost:8080/x',
            'http://127.0.0.1/x',
            'http://10.0.0.5/x',
            'http://192.168.0.1/x',
            'http://169.254.169.254/latest/meta-data',
            'http://172.20.1.1/x',
            'http://servico.internal/x',
        ]) {
            expect(hostBloqueado(new URL(host))).toBe(true);
        }
    });

    it('libera host público', () => {
        expect(hostBloqueado(new URL('https://multicanaishd.lol/filme/603-matrix'))).toBe(false);
        expect(hostBloqueado(new URL('https://172.15.0.1/x'))).toBe(false);
    });
});

describe('checarUrls', () => {
    const fetchOriginal = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = fetchOriginal;
    });

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    const resposta = (status, location = null) => ({
        status,
        headers: { get: (nome) => (nome.toLowerCase() === 'location' ? location : null) },
    });

    it('usa HEAD e devolve status + location', async () => {
        const chamadas = [];
        globalThis.fetch = vi.fn(async (url, opts) => {
            chamadas.push(opts.method);
            return resposta(301, '/serie/1396-breaking-bad-1');
        });

        const [r] = await checarUrls(['https://multicanaishd.lol/serie/1396-breaking-bad'], ORIGEM);

        expect(chamadas).toEqual(['HEAD']);
        expect(r.status).toBe(301);
        expect(r.location).toBe('/serie/1396-breaking-bad-1');
        expect(r.url).toBe('https://multicanaishd.lol/serie/1396-breaking-bad');
    });

    it('repete com GET quando o HEAD devolve 405 (o status reportado é o do GET)', async () => {
        const chamadas = [];
        globalThis.fetch = vi.fn(async (url, opts) => {
            chamadas.push(opts.method);
            return opts.method === 'HEAD' ? resposta(405) : resposta(451);
        });

        const [r] = await checarUrls(['https://multicanaishd.lol/en/filme/603-the-matrix'], ORIGEM);

        expect(chamadas).toEqual(['HEAD', 'GET']);
        expect(r.status).toBe(451);
    });

    it('falha de rede vira status 0 + erro, sem derrubar os outros itens', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('quebrada')) throw new Error('ECONNRESET');
            return resposta(200);
        });

        const resultados = await checarUrls([
            'https://multicanaishd.lol/quebrada',
            'https://multicanaishd.lol/filme/603-matrix',
        ], ORIGEM);

        expect(resultados).toHaveLength(2);
        expect(resultados[0]).toMatchObject({ status: 0, erro: 'ECONNRESET' });
        expect(resultados[1].status).toBe(200);
    });

    it('não faz fetch de host interno nem de URL inválida', async () => {
        globalThis.fetch = vi.fn(async () => resposta(200));

        const resultados = await checarUrls([
            'http://169.254.169.254/latest/meta-data',
            'não é url',
            'https://multicanaishd.lol/filme/603-matrix',
        ], ORIGEM);

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        // Os válidos vêm primeiro (na ordem do fetch); inválidos/bloqueados vão para o fim.
        expect(resultados.map((r) => r.status)).toEqual([200, 0, 0]);
        expect(resultados[1].erro).toMatch(/interno/);
        expect(resultados[2].erro).toMatch(/inválida/i);
    });

    it('deduplica e respeita o teto de URLs por chamada', async () => {
        globalThis.fetch = vi.fn(async () => resposta(200));

        const repetidas = Array.from({ length: 80 }, (_, i) => `https://multicanaishd.lol/filme/${i}-x`);
        repetidas.push('https://multicanaishd.lol/filme/0-x');

        const resultados = await checarUrls(repetidas, ORIGEM);

        expect(resultados).toHaveLength(MAX_URLS_POR_CHAMADA);
        expect(new Set(resultados.map((r) => r.url)).size).toBe(MAX_URLS_POR_CHAMADA);
    });

    it('envia User-Agent de Googlebot e redirect manual', async () => {
        let cabecalhos = null;
        let modoRedirect = null;
        globalThis.fetch = vi.fn(async (url, opts) => {
            cabecalhos = opts.headers;
            modoRedirect = opts.redirect;
            return resposta(451);
        });

        await checarUrls(['https://multicanaishd.lol/en/filme/603-the-matrix'], ORIGEM);

        expect(cabecalhos['User-Agent']).toMatch(/Googlebot/);
        expect(modoRedirect).toBe('manual');
    });
});

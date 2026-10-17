// tests/unit/upstream-unavailable.test.js
// Regressão: falha transitória do TMDB devolvia 404 em /filme/* e /serie/*, desindexando
// URLs válidas que estão no sitemap. Ver src/utils/upstreamUnavailable.js.
import { describe, it, expect } from 'vitest';
import { upstreamUnavailableResponse } from '../../src/utils/upstreamUnavailable.js';

describe('upstreamUnavailableResponse', () => {
    it('nunca responde 404 — 404 sinalizaria remoção permanente de uma URL válida', () => {
        expect(upstreamUnavailableResponse('pt').status).not.toBe(404);
    });

    it('nunca responde 5xx a crawler (regra §4.2 do projeto)', () => {
        const status = upstreamUnavailableResponse('pt').status;
        expect(status).toBeLessThan(500);
        expect(status).toBe(200);
    });

    it('marca noindex no header e na meta tag, pra sair do índice sem sinal de remoção', async () => {
        const res = upstreamUnavailableResponse('pt');
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow');
        await expect(res.text()).resolves.toContain('content="noindex, follow"');
    });

    it('não deixa o estado degradado ser cacheado depois que a origem voltar', () => {
        expect(upstreamUnavailableResponse('pt').headers.get('Cache-Control')).toBe('no-store');
    });

    it('respeita o idioma da página', async () => {
        await expect(upstreamUnavailableResponse('pt').text()).resolves.toContain('temporariamente indisponível');
        await expect(upstreamUnavailableResponse('en').text()).resolves.toContain('temporarily unavailable');
    });

    it('aponta o link de volta pro início do idioma correto', async () => {
        // "/en", não "/en/": com trailingSlash: "never" (astro.config.mjs) a barra final
        // responde 301, então o link de socorro do próprio estado degradado cairia num
        // redirect interno. Este teste trava isso.
        await expect(upstreamUnavailableResponse('en').text()).resolves.toContain('href="/en"');
        await expect(upstreamUnavailableResponse('en').text()).resolves.not.toContain('href="/en/"');
        await expect(upstreamUnavailableResponse('pt').text()).resolves.toContain('href="/"');
    });
});

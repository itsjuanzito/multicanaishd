import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TMDB_SITEMAP_PAGES, SITEMAP_FETCH_TIMEOUT, renderUrlset } from '../../src/services/sitemapXml.js';

// Regressão do bug que esvaziou a fonte TMDB do sitemap.
//
// As duas constantes viviam como `const` module-private em sitemapXml.js enquanto o
// sitemapService.js (que monta o catálogo) as usava sem importar. O `ReferenceError`
// resultante era engolido pelo `.catch(() => [])` da chamada, então NADA aparecia: o
// sitemap seguia respondendo 200, só que sem nenhum título das listas popular/top_rated/
// now_playing do TMDB e sem os nomes em inglês — e sem eles o hreflang de todas as entradas
// /en/filme/* e /en/serie/* também sumia (ver `enUnknown` em sitemapService.js).
//
// Medido em produção antes da correção: 19.515 URLs no sitemap e apenas 426 com hreflang,
// com zero /en/filme/* e /en/serie/* — sendo que as páginas /en respondiam 200.
//
// Um erro desses não quebra build nem teste: ele só reduz silenciosamente o que o Google
// consegue descobrir. Por isso o teste olha as duas coisas — o contrato do módulo e o
// vínculo entre os dois arquivos.
describe('Sitemap — constantes compartilhadas com o sitemapService', () => {
    it('exporta TMDB_SITEMAP_PAGES e SITEMAP_FETCH_TIMEOUT como números positivos', () => {
        expect(typeof TMDB_SITEMAP_PAGES).toBe('number');
        expect(TMDB_SITEMAP_PAGES).toBeGreaterThan(0);
        expect(typeof SITEMAP_FETCH_TIMEOUT).toBe('number');
        expect(SITEMAP_FETCH_TIMEOUT).toBeGreaterThan(0);
    });

    it('sitemapService.js importa as duas constantes de sitemapXml.js', () => {
        // `process.cwd()` (e não import.meta.url): o ambiente de teste é jsdom, onde o
        // import.meta.url não é um file URL.
        const caminho = resolve(process.cwd(), 'src/services/sitemapService.js');
        const fonte = readFileSync(caminho, 'utf8');

        const importacao = fonte.match(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*sitemapXml\.js["']/);
        expect(importacao, 'sitemapService.js deve importar de sitemapXml.js').toBeTruthy();

        const nomesImportados = importacao[1].split(',').map((n) => n.trim());
        expect(nomesImportados).toContain('TMDB_SITEMAP_PAGES');
        expect(nomesImportados).toContain('SITEMAP_FETCH_TIMEOUT');
    });

    it('renderUrlset continua produzindo um <urlset> válido', () => {
        const xml = renderUrlset(
            [{ path: '/filme/1-teste', title: 'Teste', priority: '0.8', changefreq: 'weekly' }],
            'https://multicanaishd.lol'
        );

        expect(xml).toContain('<urlset');
        expect(xml).toContain('<loc>https://multicanaishd.lol/filme/1-teste</loc>');
    });

    it('não emite image:loc relativo (o Search Console rejeita como URL inválido)', () => {
        const xml = renderUrlset(
            [{ path: '/canal/sem-logo', title: 'Sem logo', image: '/placeholder.jpg', priority: '0.7', changefreq: 'daily' }],
            'https://multicanaishd.lol'
        );

        expect(xml).not.toContain('<image:loc>/placeholder.jpg</image:loc>');
        expect(xml).not.toContain('<image:image>');
    });
});

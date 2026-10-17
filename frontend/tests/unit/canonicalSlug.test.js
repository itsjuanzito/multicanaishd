import { describe, it, expect } from 'vitest';
import { slugCanonicoPt, slugCanonicoEn, slugDeDetalhes, slugSemPrefixoId } from '../../src/utils/canonicalSlug.js';
import { contentSlug } from '../../src/utils/slugify.js';

// A invariante que importa: o slug que o SITEMAP anuncia tem que ser idêntico ao que a ROTA
// considera canônico. Qualquer divergência vira 301 por acesso — foi o que levou 301 a 46%
// de todas as requisições do site.
// Item cru de lista TMDB (o que o sitemap enxerga): tem os campos original_*.
const itemPtDaLista = (o) => ({ title: o.pt, name: o.pt, original_title: o.orig, original_name: o.orig });
// O que a ROTA enxerga, via minifyDetails() (tmdb.js). Ele DESCARTAVA original_title/
// original_name, e essa assimetria com o item cru acima era o coração do bug: o sitemap
// decidia o slug com um dado que a rota não tinha. Se alguém voltar a cortá-los do minify,
// os casos de "sitemap == rota" abaixo quebram — é de propósito.
const detailsDaRota = (o, lang) => ({
    title: lang === 'en' ? o.en : o.pt,
    name: lang === 'en' ? o.en : o.pt,
    original_title: o.orig,
    original_name: o.orig
});

describe('slug canônico PT', () => {
    it('usa o título traduzido', () => {
        expect(slugCanonicoPt({ title: 'O Poderoso Chefão', original_title: 'The Godfather' }))
            .toBe('o-poderoso-chefao');
    });

    it('cai no original quando não há tradução', () => {
        expect(slugCanonicoPt({ title: '', original_title: 'The Wire' })).toBe('the-wire');
    });

    it('translitera cirílico em vez de cair no genérico "assistir"', () => {
        const slug = slugCanonicoPt({ name: 'Мужское / Женское', original_name: 'Мужское / Женское' });
        expect(slug).not.toBe('assistir');
        expect(slug).toMatch(/^[a-z0-9-]+$/);
    });

    it('mantém "assistir" para script sem transliteração barata (CJK)', () => {
        expect(slugCanonicoPt({ name: 'サザエさん', original_name: 'サザエさん' })).toBe('assistir');
    });
});

describe('slug canônico EN', () => {
    // O canônico de /en/* é o NOME EM INGLÊS. Era o que as rotas já faziam na prática (por
    // acidente, já que minifyDetails descartava os campos original_*), enquanto o sitemap
    // publicava o título original — a divergência que virou 301 em massa.
    it('usa o nome em inglês, não o título original latino', () => {
        expect(slugCanonicoEn({ title: 'La vita è bella', original_title: 'La vita è bella' }, 'Life Is Beautiful'))
            .toBe('life-is-beautiful');
    });

    it('usa o nome em inglês também quando o original é não-latino', () => {
        expect(slugCanonicoEn({ name: '지붕 뚫고 하이킥', original_name: '지붕 뚫고 하이킥' }, 'High Kick Revenge of the Short Legged'))
            .toBe('high-kick-revenge-of-the-short-legged');
    });

    it('não deixa título original curto sequestrar o slug (Re:Zero)', () => {
        expect(slugCanonicoEn({ original_name: 'Re:ゼロから始める異世界生活' }, 'Re:Zero Starting Life in Another World'))
            .toBe('rezero-starting-life-in-another-world');
    });
});

describe('sitemap e rota concordam (sem 301)', () => {
    const casos = [
        { pt: 'O Poderoso Chefão', en: 'The Godfather', orig: 'The Godfather' },
        { pt: 'A Família Robinson', en: 'The Swiss Family Robinson', orig: 'The Swiss Family Robinson' },
        { pt: '', en: 'Euronews Today', orig: 'Euronews Hoje' },
        { pt: 'Мужское / Женское', en: 'Male Female', orig: 'Мужское / Женское' },
        // Original latino MAS diferente do nome em inglês: o caso que passava despercebido
        // porque parecia "sem problema de script".
        { pt: 'A Vida é Bela', en: 'Life Is Beautiful', orig: 'La vita è bella' },
        { pt: 'O Clone', en: 'The Clone', orig: 'O Clone' }
    ];

    it.each(casos)('pt: sitemap == rota para "$orig"', (caso) => {
        const doSitemap = slugCanonicoPt(itemPtDaLista(caso));
        const daRota = slugCanonicoPt(detailsDaRota(caso, 'pt'));
        expect(doSitemap).toBe(daRota);
    });

    it.each(casos)('en: sitemap (com nome em inglês) == rota para "$orig"', (caso) => {
        const doSitemap = slugCanonicoEn(itemPtDaLista(caso), caso.en);
        const daRota = slugCanonicoEn(detailsDaRota(caso, 'en'), caso.en);
        expect(doSitemap).toBe(daRota);
    });

    it('slugDeDetalhes prefixa o id', () => {
        expect(slugDeDetalhes(603, { title: 'Matrix', original_title: 'The Matrix' }, 'pt')).toBe('603-matrix');
        // lang='en' com detalhes buscados em inglês: o nome em inglês vence o original.
        expect(slugDeDetalhes(598, { title: 'City of God', original_title: 'Cidade de Deus' }, 'en')).toBe('598-city-of-god');
    });

    // Rotação por idioma: as colunas *_en guardam o slug COMPLETO e o sitemap concatena o id por
    // fora. Sem tirar o prefixo, a URL anunciada sairia "603-603-the-matrix-1" (301/404 de graça).
    it('slugSemPrefixoId remove só o prefixo do próprio id', () => {
        expect(slugSemPrefixoId(603, '603-the-matrix-1')).toBe('the-matrix-1');
        expect(slugSemPrefixoId('603', '603-2049-blade-runner-2')).toBe('2049-blade-runner-2');
        expect(slugSemPrefixoId(603, 'outro-slug')).toBe('outro-slug');
    });

    it('slugSemPrefixoId devolve null quando não há rotação EN', () => {
        expect(slugSemPrefixoId(603, null)).toBeNull();
        expect(slugSemPrefixoId(603, undefined)).toBeNull();
        expect(slugSemPrefixoId(603, '')).toBeNull();
    });
});

describe('contentSlug preserva o comportamento latino', () => {
    it('não translitera o que já era latino', () => {
        expect(contentSlug('Café com Leite')).toBe('cafe-com-leite');
    });

    it('é determinístico', () => {
        const a = contentSlug('Мужское / Женское');
        const b = contentSlug('Мужское / Женское');
        expect(a).toBe(b);
    });
});

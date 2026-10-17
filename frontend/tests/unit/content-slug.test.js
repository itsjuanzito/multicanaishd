// tests/unit/content-slug.test.js
// Regressão: título em script não-latino fazia slugify() devolver string vazia, gerando
// '/serie/153485-'. O guard da página 404ava essa URL, e quem chegava pela URL boa era
// redirecionado 301 de volta pra quebrada — armadilha circular vista no Axiom.
import { describe, it, expect } from 'vitest';
import { slugify, contentSlug } from '../../src/utils/slugify.js';

describe('slugify (comportamento existente preservado)', () => {
    it('normaliza acentos e espaços', () => {
        expect(slugify('Cidade de Deus')).toBe('cidade-de-deus');
        expect(slugify('Coração Valente')).toBe('coracao-valente');
    });

    it('ainda devolve vazio para script totalmente não-latino', () => {
        // Este é o comportamento que motivou contentSlug — documentado, não corrigido aqui,
        // porque slugify() é usado tambem para canais/generos onde '' é aceitavel.
        expect(slugify('サザエさん')).toBe('');
    });
});

describe('contentSlug', () => {
    it('nunca devolve vazio, que era a raiz do /serie/153485-', () => {
        expect(contentSlug('サザエさん')).not.toBe('');
        expect(contentSlug('')).not.toBe('');
        expect(contentSlug(null, undefined)).not.toBe('');
    });

    it('nunca devolve algo que o guard de slug invalido rejeitaria', () => {
        for (const entrada of ['サザエさん', '海賊王', '', null, '---', '!!!']) {
            const s = contentSlug(entrada);
            expect(s).toBeTruthy();
            expect(s).not.toBe('-');
        }
    });

    it('prefere o primeiro candidato utilizavel', () => {
        expect(contentSlug('Sazae-san', 'サザエさん')).toBe('sazae-san');
    });

    it('cai no titulo original quando o traduzido nao sobrevive', () => {
        expect(contentSlug('サザエさん', 'Sazae-san')).toBe('sazae-san');
    });

    it('e deterministico — alvo do redirect e expectativa da pagina tem que bater', () => {
        const a = contentSlug('サザエさん', '海賊王');
        const b = contentSlug('サザエさん', '海賊王');
        expect(a).toBe(b);
    });
});

import { describe, it, expect } from 'vitest';
import { getGenreByIdOrSlug, getGenreName } from '../../src/utils/genres';

describe('Genres Mapper (Unit Tests)', () => {

    describe('getGenreByIdOrSlug', () => {
        
        it('deve retornar o gênero correto passando o ID numérico', () => {
            const genre = getGenreByIdOrSlug(28);
            expect(genre).toBeDefined();
            expect(genre.name).toBe('Ação');
        });

        it('deve retornar o gênero correto passando o ID como string', () => {
            const genre = getGenreByIdOrSlug('16');
            expect(genre).toBeDefined();
            expect(genre.name).toBe('Animação');
        });

        it('deve retornar o gênero correto pelo Slug (String)', () => {
            const genre = getGenreByIdOrSlug('documentario');
            expect(genre).toBeDefined();
            expect(genre.id).toBe(99);
        });

        it('deve retornar undefined se o ID ou Slug não existir', () => {
            const genre = getGenreByIdOrSlug('not-exist-at-all');
            expect(genre).toBeUndefined();
        });

        it('deve retornar null se valor for nulo/inválido', () => {
            const genre1 = getGenreByIdOrSlug(null);
            const genre2 = getGenreByIdOrSlug(undefined);
            expect(genre1).toBeNull();
            expect(genre2).toBeNull();
        });
    });

    describe('getGenreName', () => {
        it('deve retornar o nome amigável do gênero por ID válido', () => {
            const name = getGenreName(80);
            expect(name).toBe('Crime');
        });

        it('deve possuir fallback protetor "Gênero" para ID inválido', () => {
            const name = getGenreName(1234567);
            expect(name).toBe('Gênero'); // Fallback Requirement
        });
    });
});

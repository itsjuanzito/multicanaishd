import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isMatchSlug = (slug) => slug.toLowerCase().includes('-x-') || slug.toLowerCase().startsWith('jogo-');
const shouldNoindex = (isExpiredEvent, slug) => isExpiredEvent && isMatchSlug(slug);

describe('SEO Indexability Classification for Channels', () => {
    it('should NOT apply noindex to permanent TV channels even if they are temporarily offline (isExpiredEvent = true)', () => {
        const slug = 'espn-canal-5';
        const isExpiredEvent = true; // temporarily offline or Superflix hiccup
        
        const noindex = shouldNoindex(isExpiredEvent, slug);
        expect(noindex).toBe(false); // should remain indexable
    });

    it('should NOT apply noindex to permanent TV channels when online (isExpiredEvent = false)', () => {
        const slug = 'sportv-2';
        const isExpiredEvent = false;
        
        const noindex = shouldNoindex(isExpiredEvent, slug);
        expect(noindex).toBe(false);
    });

    it('should apply noindex to expired sports events containing -x-', () => {
        const slug = 'fluminense-x-bolivar';
        const isExpiredEvent = true;
        
        const noindex = shouldNoindex(isExpiredEvent, slug);
        expect(noindex).toBe(true); // should be excluded from index
    });

    it('should apply noindex to expired events starting with jogo-', () => {
        const slug = 'jogo-inexistente-teste';
        const isExpiredEvent = true;
        
        const noindex = shouldNoindex(isExpiredEvent, slug);
        expect(noindex).toBe(true); // should be excluded from index
    });

    it('should NOT apply noindex to active sports events when online', () => {
        const slug = 'fluminense-x-bolivar';
        const isExpiredEvent = false;
        
        const noindex = shouldNoindex(isExpiredEvent, slug);
        expect(noindex).toBe(false); // active matches are indexable
    });
});

// As cinco asserções acima reimplementam a regra dentro do teste — e foi exatamente por isso
// que a divergência passou batido: a página fazia `shouldNoindex = isExpiredEvent`, sem a
// condição de slug, e todo canal permanente virava `noindex` quando a lista de canais do
// upstream voltava vazia. O teste continuava verde porque testava a própria cópia.
//
// Este bloco amarra a regra ao ARQUIVO de verdade, que é o que o Search Console enxerga.
describe('SEO Indexability — a pagina de canal implementa a regra', () => {
    it('shouldNoindex em canal/[slug].astro exige tambem o slug efemero', () => {
        const caminho = resolve(process.cwd(), 'src/pages/canal/[slug].astro');
        const fonte = readFileSync(caminho, 'utf8');

        const declaracao = fonte.match(/const shouldNoindex = ([^;]+);/);
        expect(declaracao, 'canal/[slug].astro deve declarar shouldNoindex').toBeTruthy();

        const expressao = declaracao[1].replace(/\s+/g, '');
        expect(expressao).toBe('isExpiredEvent&&isMatchSlug');
    });
});

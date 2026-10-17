// tests/unit/dmca-watch.test.js
// Detecção automática de bloqueio legal (451) com auto-rotação: parser de caminho, guarda
// anti-loop (a parte que impede rotacionar a mesma obra para sempre), falhas silenciosas
// (token/zona ausentes) e resiliência a erro de rotação por item.
// Ver src/services/dmcaWatchService.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const estado = {
    env: {},
    kv: null,
    canonico: null,
    rotacao: null,
    tmdb: null,
    autoRotate: 'on',
    rotacoes: [],
    rotateResult: { newSlug: '603-matrix-2' },
    rotateErro: null,
};

vi.mock('../../src/services/env-adapter.js', () => ({
    getEnv: (chave, padrao = null) => (chave === 'SESSION' ? estado.kv : (estado.env[chave] ?? padrao)),
    getSiteUrl: () => 'https://multicanaishd.lol',
}));

vi.mock('../../src/services/configService.js', () => ({
    getConfig: async () => estado.autoRotate,
}));

vi.mock('../../src/services/urlRotationService.js', () => ({
    resolveRotatedSlug: async () => estado.canonico,
    getActiveRotation: async () => estado.rotacao,
    rotateMediaUrl: async (args) => {
        estado.rotacoes.push(args);
        if (estado.rotateErro) throw new Error(estado.rotateErro);
        // Espelha o efeito real: rotateMediaUrl atualiza o cache L1, então o canônico da obra
        // passa a ser o slug novo já nesta execução.
        estado.canonico = estado.rotateResult.newSlug;
        return estado.rotateResult;
    },
}));

vi.mock('../../src/services/tmdb.js', () => ({
    getTMDBDetails: async () => estado.tmdb,
}));

const {
    parseCaminhoBloqueado,
    montarJanela,
    canonicoAtual,
    resolverZoneId,
    executarDmcaWatch,
    lerLogDmca,
    CHAVE_LOG,
    PREFIXO_ZONA,
} = await import('../../src/services/dmcaWatchService.js');

const ZONA = 'zone-teste';
const TOKEN = 'token-teste';

function criarKv(inicial = {}) {
    const dados = new Map(Object.entries(inicial));
    return {
        get: vi.fn(async (chave) => dados.get(chave) ?? null),
        put: vi.fn(async (chave, valor) => { dados.set(chave, valor); }),
        dados,
    };
}

function stubFetch(rotas) {
    const chamadas = [];
    const fn = vi.fn(async (url, opcoes = {}) => {
        const alvo = String(url);
        chamadas.push({ url: alvo, opcoes });
        const rota = rotas.find(([trecho]) => alvo.includes(trecho));
        if (!rota) throw new Error(`fetch inesperado: ${alvo}`);
        return { ok: true, status: 200, json: async () => rota[1] };
    });
    vi.stubGlobal('fetch', fn);
    return chamadas;
}

const respostaZona = (id = ZONA) => ({ result: id ? [{ id }] : [] });
const respostaGraphql = (grupos) => ({
    data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: grupos }] } },
});

function grupo(path, count = 1) {
    return { count, dimensions: { clientRequestPath: path } };
}

/** Zona já cacheada no KV — evita uma perna de fetch na maioria dos testes. */
function kvComZona(id = ZONA) {
    return criarKv({ [`${PREFIXO_ZONA}multicanaishd.lol`]: id });
}

beforeEach(() => {
    estado.env = {};
    estado.kv = null;
    estado.canonico = null;
    estado.rotacao = null;
    estado.tmdb = null;
    estado.autoRotate = 'on';
    estado.rotacoes = [];
    estado.rotateResult = { newSlug: '603-matrix-2' };
    estado.rotateErro = null;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('parseCaminhoBloqueado', () => {
    it('lê filme em PT', () => {
        expect(parseCaminhoBloqueado('/filme/603-matrix')).toEqual({
            path: '/filme/603-matrix',
            mediaId: '603',
            mediaType: 'movie',
            lang: 'pt',
            slug: '603-matrix',
        });
    });

    it('lê série em PT', () => {
        const alvo = parseCaminhoBloqueado('/serie/1396-breaking-bad');
        expect(alvo.mediaType).toBe('series');
        expect(alvo.lang).toBe('pt');
        expect(alvo.mediaId).toBe('1396');
    });

    it('lê filme e série com o prefixo /en', () => {
        expect(parseCaminhoBloqueado('/en/filme/1491920-kung-fu-soccer')).toMatchObject({
            mediaType: 'movie',
            lang: 'en',
            mediaId: '1491920',
        });
        expect(parseCaminhoBloqueado('/en/serie/230923-lovely-runner')).toMatchObject({
            mediaType: 'series',
            lang: 'en',
            mediaId: '230923',
        });
    });

    it('preserva o sufixo de rotação no slug', () => {
        expect(parseCaminhoBloqueado('/serie/31724-code-geass-1').slug).toBe('31724-code-geass-1');
    });

    it('lê episódio de série em PT e extrai a SÉRIE como alvo', () => {
        expect(parseCaminhoBloqueado('/serie/1396-breaking-bad/temporada-2/episodio-5')).toEqual({
            path: '/serie/1396-breaking-bad/temporada-2/episodio-5',
            mediaId: '1396',
            mediaType: 'series',
            lang: 'pt',
            slug: '1396-breaking-bad',
            ehEpisodio: true,
        });
    });

    it('lê episódio de série em EN preservando o sufixo de rotação da série', () => {
        expect(
            parseCaminhoBloqueado('/en/serie/230923-lovely-runner-2/temporada-1/episodio-12')
        ).toEqual({
            path: '/en/serie/230923-lovely-runner-2/temporada-1/episodio-12',
            mediaId: '230923',
            mediaType: 'series',
            lang: 'en',
            slug: '230923-lovely-runner-2',
            ehEpisodio: true,
        });
    });

    it('ignora canal, gênero, estáticos, filme com sub-caminho e lixo', () => {
        for (const path of [
            '/canal/123-globo',
            '/genero/acao',
            '/filme/abc-sem-id',
            '/en/filme/abc-sem-id',
            '/api/internal/dmca-watch',
            '/filme/603-matrix/extra',
            '/serie/1396-breaking-bad/temporada-2',
            '/serie/1396-breaking-bad/temporada-2/episodio-5/extra',
            '/',
            '',
        ]) {
            expect(parseCaminhoBloqueado(path)).toBeNull();
        }
        expect(parseCaminhoBloqueado(null)).toBeNull();
        expect(parseCaminhoBloqueado(undefined)).toBeNull();
    });
});

describe('montarJanela', () => {
    it('cobre os últimos 120 minutos', () => {
        const agora = Date.parse('2026-10-17T12:00:00.000Z');
        const janela = montarJanela(agora);
        expect(janela.until).toBe('2026-10-17T12:00:00.000Z');
        expect(janela.since).toBe('2026-10-17T10:00:00.000Z');
    });
});

describe('canonicoAtual', () => {
    it('usa o original_slug da rotação como base canônica', async () => {
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-3' };
        estado.canonico = '603-matrix-3';

        await expect(canonicoAtual('603', 'movie', 'pt')).resolves.toBe('603-matrix-3');
        expect(estado.tmdb).toBeNull(); // não foi ao TMDB
    });

    it('cai no TMDB quando não há rotação, e devolve null sem base alguma', async () => {
        estado.tmdb = { title: 'Matrix' };
        estado.canonico = '603-matrix';
        await expect(canonicoAtual('603', 'movie', 'pt')).resolves.toBe('603-matrix');

        estado.tmdb = null;
        await expect(canonicoAtual('603', 'movie', 'pt')).resolves.toBeNull();
    });
});

describe('resolverZoneId', () => {
    it('resolve pelo nome do host e cacheia no KV por 24h', async () => {
        estado.kv = criarKv();
        const chamadas = stubFetch([['/zones?name=multicanaishd.lol', respostaZona()]]);

        await expect(resolverZoneId({ token: TOKEN, host: 'multicanaishd.lol' })).resolves.toBe(ZONA);
        expect(chamadas).toHaveLength(1);
        expect(estado.kv.put).toHaveBeenCalledWith(
            `${PREFIXO_ZONA}multicanaishd.lol`,
            ZONA,
            { expirationTtl: 86400 }
        );
    });

    it('reaproveita a zona cacheada sem chamar a API', async () => {
        estado.kv = criarKv({ [`${PREFIXO_ZONA}multicanaishd.lol`]: 'zona-cacheada' });
        const chamadas = stubFetch([]);

        await expect(resolverZoneId({ token: TOKEN, host: 'multicanaishd.lol' }))
            .resolves.toBe('zona-cacheada');
        expect(chamadas).toHaveLength(0);
    });

    it('devolve null sem token ou sem host', async () => {
        await expect(resolverZoneId({ token: '', host: 'multicanaishd.lol' })).resolves.toBeNull();
        await expect(resolverZoneId({ token: TOKEN, host: '' })).resolves.toBeNull();
    });
});

describe('executarDmcaWatch — guarda anti-loop', () => {
    it('rotaciona quando o caminho bloqueado É o canônico atual', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-1' };
        estado.canonico = '603-matrix-1';
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/603-matrix-1', 7)])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({
            ok: true,
            caminhos: 1,
            rotacionados: 1,
            ignorados: 0,
            erros: 0,
            autoRotate: true,
        });
        expect(estado.rotacoes).toEqual([
            { input: '603-matrix-1', forcedType: 'movie', lang: 'pt' },
        ]);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({
            path: '/filme/603-matrix-1',
            count: 7,
            acao: 'rotacionado',
            mediaId: '603',
            mediaType: 'movie',
            lang: 'pt',
            novoSlug: '603-matrix-2',
        });
    });

    it('ignora quando o caminho é um slug ANTIGO (canônico já mudou)', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-2' };
        estado.canonico = '603-matrix-2';
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/603-matrix', 5)])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ ok: true, rotacionados: 0, ignorados: 1, erros: 0 });
        expect(estado.rotacoes).toHaveLength(0);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({ acao: 'ignorado', motivo: 'slug_antigo' });
    });

    it('rotaciona a SÉRIE quando o gatilho é um episódio dela (guarda pelo slug da série)', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '1396-breaking-bad', current_slug: '1396-breaking-bad-3' };
        estado.canonico = '1396-breaking-bad-3';
        estado.rotateResult = { newSlug: '1396-breaking-bad-4' };
        stubFetch([['/graphql', respostaGraphql([
            grupo('/serie/1396-breaking-bad-3/temporada-1/episodio-5', 9),
        ])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ caminhos: 1, rotacionados: 1, ignorados: 0 });
        expect(estado.rotacoes).toEqual([
            { input: '1396-breaking-bad-3', forcedType: 'series', lang: 'pt' },
        ]);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({
            path: '/serie/1396-breaking-bad-3/temporada-1/episodio-5',
            count: 9,
            acao: 'rotacionado',
            mediaId: '1396',
            mediaType: 'series',
            lang: 'pt',
            ehEpisodio: true,
            novoSlug: '1396-breaking-bad-4',
        });
    });

    it('episódio em EN rotaciona a série com forcedType series e lang en', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = {
            original_slug: '230923-lovely-runner',
            original_slug_en: '230923-lovely-runner',
            current_slug_en: '230923-lovely-runner-2',
        };
        estado.canonico = '230923-lovely-runner-2';
        estado.rotateResult = { newSlug: '230923-lovely-runner-3' };
        stubFetch([['/graphql', respostaGraphql([
            grupo('/en/serie/230923-lovely-runner-2/temporada-1/episodio-12', 4),
        ])]]);

        await executarDmcaWatch();

        expect(estado.rotacoes).toEqual([
            { input: '230923-lovely-runner-2', forcedType: 'series', lang: 'en' },
        ]);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({ ehEpisodio: true, lang: 'en', acao: 'rotacionado' });
    });

    it('episódio de um slug ANTIGO da série é ignorado sem rotacionar', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '1396-breaking-bad', current_slug: '1396-breaking-bad-3' };
        estado.canonico = '1396-breaking-bad-3';
        stubFetch([['/graphql', respostaGraphql([
            grupo('/serie/1396-breaking-bad/temporada-1/episodio-5', 6),
        ])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ rotacionados: 0, ignorados: 1 });
        expect(estado.rotacoes).toHaveLength(0);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({
            path: '/serie/1396-breaking-bad/temporada-1/episodio-5',
            acao: 'ignorado',
            motivo: 'slug_antigo',
            ehEpisodio: true,
        });
    });

    it('página da série + episódio dela na MESMA execução rotacionam só uma vez', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '1396-breaking-bad', current_slug: '1396-breaking-bad-3' };
        estado.canonico = '1396-breaking-bad-3';
        estado.rotateResult = { newSlug: '1396-breaking-bad-4' };
        stubFetch([['/graphql', respostaGraphql([
            grupo('/serie/1396-breaking-bad-3/temporada-1/episodio-5', 8),
            grupo('/serie/1396-breaking-bad-3', 3),
        ])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ caminhos: 2, rotacionados: 1, ignorados: 1, erros: 0 });
        expect(estado.rotacoes).toHaveLength(1);
        const log = await lerLogDmca();
        const entradasDaSerie = log.filter((e) => e.mediaId === '1396');
        expect(entradasDaSerie.map((e) => e.acao).sort()).toEqual(['ignorado', 'rotacionado']);
        expect(entradasDaSerie.find((e) => e.acao === 'ignorado')).toMatchObject({
            motivo: 'slug_antigo',
        });
    });

    it('não rotaciona duas vezes a mesma obra em ciclos seguidos', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-1' };
        estado.canonico = '603-matrix-1';
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/603-matrix-1')])]]);

        await executarDmcaWatch(); // 1º ciclo: rotaciona
        estado.canonico = '603-matrix-2'; // rotação gravou o slug novo
        const segundo = await executarDmcaWatch(); // 2º ciclo: mesmo 451 no relatório

        expect(segundo).toMatchObject({ rotacionados: 0, ignorados: 1 });
        expect(estado.rotacoes).toHaveLength(1);
    });

    it('rotaciona série em inglês com forcedType series e lang en', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = {
            original_slug: '1396-breaking-bad',
            original_slug_en: '1396-breaking-bad',
            current_slug_en: '1396-breaking-bad-3',
        };
        estado.canonico = '1396-breaking-bad-3';
        stubFetch([['/graphql', respostaGraphql([grupo('/en/serie/1396-breaking-bad-3', 2)])]]);

        await executarDmcaWatch();

        expect(estado.rotacoes).toEqual([
            { input: '1396-breaking-bad-3', forcedType: 'series', lang: 'en' },
        ]);
    });

    it('sem canônico determinado, ignora com motivo sem_canonico', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/999999-desconhecido')])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ ok: true, rotacionados: 0, ignorados: 1 });
        expect(estado.rotacoes).toHaveLength(0);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({ acao: 'ignorado', motivo: 'sem_canonico' });
    });

    it('registra caminho fora do escopo como informativo, sem rotacionar', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        stubFetch([['/graphql', respostaGraphql([grupo('/canal/123-globo')])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ ok: true, rotacionados: 0, ignorados: 0, erros: 0 });
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({ acao: 'informativo', motivo: 'fora_de_escopo' });
    });

    it('com auto-rotação desligada, registra mas não move o slug', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.autoRotate = 'off';
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-1' };
        estado.canonico = '603-matrix-1';
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/603-matrix-1')])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo.autoRotate).toBe(false);
        expect(estado.rotacoes).toHaveLength(0);
        const log = await lerLogDmca();
        expect(log[0]).toMatchObject({ acao: 'informativo', motivo: 'auto_rotate_desligado' });
    });

    it('erro de rotação em um caminho não derruba o laço', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-1' };
        estado.canonico = '603-matrix-1'; // canônico igual para os dois caminhos
        estado.rotateErro = 'falha no Supabase';
        stubFetch([['/graphql', respostaGraphql([
            grupo('/filme/603-matrix-1'),
            grupo('/serie/603-matrix-1'),
        ])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo.ok).toBe(true);
        expect(resumo.erros).toBe(2);
        expect(estado.rotacoes).toHaveLength(2);
    });
});

describe('executarDmcaWatch — falhas silenciosas', () => {
    it('token ausente devolve ok:false sem exceção e sem chamar a API', async () => {
        const chamadas = stubFetch([]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toEqual({ ok: false, motivo: 'token_ausente' });
        expect(chamadas).toHaveLength(0);
    });

    it('zona não resolvida devolve ok:false sem exceção', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = criarKv();
        const chamadas = stubFetch([['/zones?name=multicanaishd.lol', respostaZona(null)]]);

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ ok: false, motivo: 'zona_nao_resolvida' });
        expect(chamadas.some((c) => c.url.includes('/graphql'))).toBe(false);
    });

    it('falha de rede na consulta vira ok:false com motivo, nunca throw', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = kvComZona();
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('rede fora');
        }));

        const resumo = await executarDmcaWatch();

        expect(resumo).toMatchObject({ ok: false, motivo: 'falha_execucao' });
    });

    it('log de KV indisponível não derruba a execução', async () => {
        estado.env.CLOUDFLARE_ANALYTICS_TOKEN = TOKEN;
        estado.kv = {
            get: vi.fn(async (chave) => {
                if (chave === CHAVE_LOG) throw new Error('KV fora');
                return ZONA;
            }),
            put: vi.fn(async () => { throw new Error('KV fora'); }),
        };
        estado.rotacao = { original_slug: '603-matrix', current_slug: '603-matrix-1' };
        estado.canonico = '603-matrix-1';
        stubFetch([['/graphql', respostaGraphql([grupo('/filme/603-matrix-1')])]]);

        const resumo = await executarDmcaWatch();

        expect(resumo.ok).toBe(true);
        expect(resumo.rotacionados).toBe(1);
    });
});

// Substitui o antigo `temp-test.test.js`, que era andaime de depuração: fazia parse manual
// do .env, chamava o Supabase de VERDADE pela rede (flaky — estourava o timeout de 5s sob
// carga da suíte) e imprimia o ADMIN_MODERATION_TOKEN em texto puro via console.log, ou seja
// vazava o segredo pra qualquer log de CI. Também só cobria o caminho feliz.
//
// Aqui o Supabase é mockado, não há rede nem segredo, e o foco é o portão de autorização —
// que é a parte do endpoint onde um erro custa caro (exposição da listagem de licenças B2B).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOKEN_CORRETO = 'token-de-teste-nao-e-segredo';

let tokenConfigurado = TOKEN_CORRETO;
let respostas = {};

vi.mock('../../src/services/env-adapter.js', () => ({
    getEnv: (nome) => (nome === 'ADMIN_MODERATION_TOKEN' ? tokenConfigurado : undefined),
    setRuntimeEnv: () => {},
}));

vi.mock('../../src/services/axiom-service.js', () => ({
    axiomService: { ingest: vi.fn(async () => {}), logError: vi.fn(async () => {}) },
}));

// Construtor encadeável mínimo do supabase-js: cada método devolve o próprio objeto, que é
// "thenable" — assim tanto `await ...in(...)` quanto `await ...order(...)` resolvem.
function criarChain(tabela) {
    const chain = {
        select: () => chain,
        or: () => chain,
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        insert: () => chain,
        update: () => chain,
        delete: () => chain,
        single: () => chain,
        maybeSingle: () => chain,
        then: (aoResolver, aoRejeitar) =>
            Promise.resolve(respostas[tabela] ?? { data: [], error: null }).then(aoResolver, aoRejeitar),
    };
    return chain;
}

vi.mock('../../src/services/supabase.js', () => ({
    supabase: {},
    supabaseAdmin: { from: (tabela) => criarChain(tabela) },
}));

function requisicaoGet(token) {
    const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
    return { url: `http://localhost:4321/api/admin/b2b-admin${query}` };
}

function requisicaoPost(corpo) {
    return { json: async () => corpo };
}

beforeEach(() => {
    tokenConfigurado = TOKEN_CORRETO;
    respostas = {
        developer_licenses: {
            data: [{ id: 'lic-1', user_id: 'user-1', license_key: 'bf_dev_abc', status: 'active' }],
            error: null,
        },
        profiles: {
            data: [{ id: 'user-1', email: 'dev@exemplo.com', username: 'dev' }],
            error: null,
        },
    };
});

describe('/api/admin/b2b-admin — portão de autorização', () => {
    it('GET sem token responde 401', async () => {
        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await GET({ request: requisicaoGet(undefined) });
        expect(res.status).toBe(401);
    });

    it('GET com token errado responde 401', async () => {
        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await GET({ request: requisicaoGet('token-errado') });
        expect(res.status).toBe(401);
    });

    // Sem esta guarda, um deploy que esquecesse de definir ADMIN_MODERATION_TOKEN deixaria
    // a listagem de licenças aberta pra quem mandasse um token vazio.
    it('GET não autoriza quando ADMIN_MODERATION_TOKEN não está configurado', async () => {
        tokenConfigurado = undefined;
        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');

        expect((await GET({ request: requisicaoGet('') })).status).toBe(401);
        expect((await GET({ request: requisicaoGet(undefined) })).status).toBe(401);
    });

    it('POST com token errado responde 401 sem tocar no banco', async () => {
        const { POST } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await POST({ request: requisicaoPost({ action: 'revoke', licenseId: 'lic-1', token: 'errado' }) });
        expect(res.status).toBe(401);
    });
});

describe('/api/admin/b2b-admin — listagem', () => {
    it('GET autorizado devolve as licenças com o perfil anexado', async () => {
        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await GET({ request: requisicaoGet(TOKEN_CORRETO) });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.licenses)).toBe(true);
        expect(data.licenses[0].license_key).toBe('bf_dev_abc');
        expect(data.licenses[0].profile.email).toBe('dev@exemplo.com');
    });

    it('licença órfã (sem perfil correspondente) não quebra a listagem', async () => {
        respostas.developer_licenses = {
            data: [{ id: 'lic-2', user_id: 'user-fantasma', license_key: 'bf_dev_xyz' }],
            error: null,
        };
        respostas.profiles = { data: [], error: null };

        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');
        const data = await (await GET({ request: requisicaoGet(TOKEN_CORRETO) })).json();

        expect(data.licenses[0].profile).toEqual({ email: 'Anônimo', username: 'anonimo' });
    });

    it('erro do banco vira 500, não uma listagem vazia silenciosa', async () => {
        respostas.developer_licenses = { data: null, error: new Error('conexão recusada') };

        const { GET } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await GET({ request: requisicaoGet(TOKEN_CORRETO) });

        expect(res.status).toBe(500);
    });
});

describe('/api/admin/b2b-admin — ações', () => {
    it('ação desconhecida responde 400', async () => {
        const { POST } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await POST({
            request: requisicaoPost({ action: 'acao-inventada', licenseId: 'lic-1', token: TOKEN_CORRETO }),
        });
        expect(res.status).toBe(400);
    });

    it('ação sem licenseId responde 400', async () => {
        const { POST } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await POST({ request: requisicaoPost({ action: 'revoke', token: TOKEN_CORRETO }) });
        expect(res.status).toBe(400);
    });

    it('revoke autorizado responde 200', async () => {
        const { POST } = await import('../../src/pages/api/admin/b2b-admin.js');
        const res = await POST({
            request: requisicaoPost({ action: 'revoke', licenseId: 'lic-1', token: TOKEN_CORRETO }),
        });
        expect(res.status).toBe(200);
    });
});

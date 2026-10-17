import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock env-adapter to control env vars dynamically
vi.mock('../../src/services/env-adapter.js', () => {
    const envs = {};
    const getEnv = (key, defaultValue = null) => {
        return envs[key] !== undefined ? envs[key] : defaultValue;
    };
    return {
        getEnv,
        getSiteUrl: (requestUrl) => {
            const envOrigin = getEnv('SITE_URL') || getEnv('PUBLIC_SITE_URL');
            if (envOrigin) {
                try { return new URL(/^https?:\/\//i.test(envOrigin) ? envOrigin : `https://${envOrigin}`).origin; } catch { }
            }
            try { return new URL(requestUrl).origin; } catch { return 'https://multicanaishd.lol'; }
        },
        setMockEnv: (key, val) => {
            envs[key] = val;
        },
        clearMockEnvs: () => {
            for (const key in envs) delete envs[key];
        }
    };
});

// We import the mock controller from the mocked module path
import { getEnv, setMockEnv, clearMockEnvs } from '../../src/services/env-adapter.js';

// Mock Supabase to bypass real requests
vi.mock('../../src/services/supabase', () => {
    return {
        supabaseAdmin: {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null })
        }
    };
});

// Mock Redis client helper
vi.mock('../../src/services/redis-client.js', () => {
    return {
        getRedisClient: vi.fn().mockResolvedValue(null)
    };
});

// Mock catalog/Superflix IDs fetcher
vi.mock('../../src/services/superflix-ids.js', () => {
    return {
        getSuperflixIds: vi.fn().mockResolvedValue({
            movies: new Set(),
            series: new Set(),
            anime: new Set(),
            doramas: new Set()
        })
    };
});

// Mock fetch to prevent actual outgoing HTTP calls during test initialization
const fetchSpy = vi.spyOn(globalThis, 'fetch');

import { GET as notificarAPI } from '../../src/pages/api/cron/notificar.js';

describe('Notificar Cron API (Unit Tests)', () => {
    beforeEach(() => {
        // @ts-ignore
        clearMockEnvs();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('Deve falhar com status 500 se CRON_SECRET nao estiver configurado', async () => {
        // @ts-ignore
        setMockEnv('PUBLIC_SUPABASE_URL', 'https://mock.supabase.co');
        // @ts-ignore
        setMockEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key');

        const mockReq = {
            url: 'http://localhost/api/cron/notificar',
            headers: {
                get: () => null
            }
        };

        // @ts-ignore
        const res = await notificarAPI({ request: mockReq });
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toContain('Configuração de segurança pendente (CRON_SECRET)');
    });

    it('Deve falhar com status 401 se nao houver autorizacao valida', async () => {
        // @ts-ignore
        setMockEnv('CRON_SECRET', 'super-secret');
        // @ts-ignore
        setMockEnv('PUBLIC_SUPABASE_URL', 'https://mock.supabase.co');
        // @ts-ignore
        setMockEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key');

        const mockReq = {
            url: 'http://localhost/api/cron/notificar',
            headers: {
                get: () => 'Bearer invalid-secret'
            }
        };

        // @ts-ignore
        const res = await notificarAPI({ request: mockReq });
        expect(res.status).toBe(401);
        const text = await res.text();
        expect(text).toContain('Não autorizado');
    });

    it('Deve falhar com status 500 se as credenciais do Supabase estiverem ausentes', async () => {
        // @ts-ignore
        setMockEnv('CRON_SECRET', 'super-secret');
        // PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ausentes

        const mockReq = {
            url: 'http://localhost/api/cron/notificar',
            headers: {
                get: () => 'Bearer super-secret'
            }
        };

        // @ts-ignore
        const res = await notificarAPI({ request: mockReq });
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toContain('Configurações do Supabase ausentes');
    });

    it('Deve falhar com status 500 se TMDB ou Discord Webhook estiverem ausentes', async () => {
        // @ts-ignore
        setMockEnv('CRON_SECRET', 'super-secret');
        // @ts-ignore
        setMockEnv('PUBLIC_SUPABASE_URL', 'https://mock.supabase.co');
        // @ts-ignore
        setMockEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key');
        // TMDB e Discord ausentes

        const mockReq = {
            url: 'http://localhost/api/cron/notificar?secret=super-secret',
            headers: {
                get: () => null
            }
        };

        // @ts-ignore
        const res = await notificarAPI({ request: mockReq });
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toContain('Configurações ausentes (TMDB/Discord)');
    });
});

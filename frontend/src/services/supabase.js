import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env-adapter.js';

const isBrowser = typeof window !== 'undefined' && !globalThis.process?.versions?.node;

// --- CLIENTE PÚBLICO ---
export const getSupabase = () => {
    const url = getEnv('PUBLIC_SUPABASE_URL');
    const key = getEnv('PUBLIC_SUPABASE_ANON_KEY');

    if (isBrowser) {
        if (!globalThis._supabase) {
            if (!url || !key || url.includes('placeholder')) return null;
            globalThis._supabase = createClient(url, key, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
                realtime: {
                    logger: (kind, msg, data) => {
                        console.log(`%c[Realtime ${kind}] ${msg}`, "color: #a855f7; font-weight: bold;", data || "");
                    }
                }
            });
        }
        return globalThis._supabase;
    }
    
    if (!url || !key) return null;

    // Servidor: cacheia por isolate, igual ao cliente admin logo abaixo.
    // `supabase` é exportado como um Proxy cujo trap `get` chama esta função a CADA acesso de
    // propriedade, então sem cache um simples `supabase.from(...)` construía um cliente
    // inteiro (auth + postgrest + realtime + storage) do zero, por acesso, por requisição.
    //
    // `persistSession: false` é parte da correção, não detalhe: o padrão é `true`, e num
    // Worker sem localStorage isso cai num storage EM MEMÓRIA. Enquanto o cliente era
    // recriado a cada acesso isso era inócuo (nascia vazio e morria em seguida); ao cachear
    // por isolate, um único signIn server-side passaria a deixar sessão residente,
    // compartilhada por todas as requisições seguintes daquele isolate. Hoje nada faz login
    // no servidor, mas o padrão seguro não pode depender disso continuar verdade.
    if (!globalThis._supabaseServer || globalThis._supabaseServerUrl !== url || globalThis._supabaseServerKey !== key) {
        globalThis._supabaseServerUrl = url;
        globalThis._supabaseServerKey = key;
        globalThis._supabaseServer = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
    }

    return globalThis._supabaseServer;
};

// --- CLIENTE ADMIN ---
export const getSupabaseAdmin = () => {
    if (isBrowser) return null;
    
    const url = getEnv('PUBLIC_SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceKey || url.includes('placeholder') || serviceKey === 'undefined' || serviceKey === 'null' || serviceKey === '') {
        if (!globalThis._warned_admin_init) {
            console.warn(`⚠️ [Supabase] Não é possível inicializar o Cliente Admin. URL: ${url ? 'presente' : 'ausente'}, Key: ${serviceKey ? 'presente (mas pode ser inválida, vazia ou placeholder)' : 'ausente'}`);
            globalThis._warned_admin_init = true;
        }
        return null;
    }

    // Cache apenas se for válido e idêntico
    if (!globalThis._supabaseAdmin || globalThis._supabaseAdminUrl !== url || globalThis._supabaseAdminKey !== serviceKey) {
        const maskedKey = serviceKey.substring(0, 10) + "...";
        console.log(`🔑 [Supabase] Inicializando/Atualizando Cliente Admin: ${url} (Key: ${maskedKey})`);
        globalThis._supabaseAdminUrl = url;
        globalThis._supabaseAdminKey = serviceKey;
        globalThis._supabaseAdmin = createClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
    }
    
    return globalThis._supabaseAdmin;
};

// Função auxiliar de mock recursiva e indestrutível para evitar erros se o admin não inicializar
const createMockChain = () => {
    const mockFn = (...args) => {
        return createMockChain();
    };
    
    mockFn.then = (onFulfilled) => {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled);
    };
    
    mockFn.single = () => {
        return Promise.resolve({ data: null, error: null });
    };

    mockFn.maybeSingle = () => {
        return Promise.resolve({ data: null, error: null });
    };

    return new Proxy(mockFn, {
        get: (target, prop) => {
            if (prop === 'then') return target.then;
            if (prop === 'single') return target.single;
            if (prop === 'maybeSingle') return target.maybeSingle;
            return createMockChain();
        }
    });
};

// Exportamos como Proxy para garantir que ele sempre tente inicializar
export const supabaseAdmin = new Proxy({}, {
    get: (target, prop) => {
        const admin = getSupabaseAdmin();
        if (!admin) {
            console.warn(`⚠️ [Supabase] Chamada a '${prop.toString()}' ignorada: Cliente Admin não inicializado.`);
            return createMockChain();
        }
        const value = admin[prop];
        return typeof value === 'function' ? value.bind(admin) : value;
    }
});

// Exportamos como Proxy para garantir que ele só inicialize no primeiro uso (Otimização PageSpeed)
export const supabase = new Proxy({}, {
    get: (target, prop) => {
        const client = getSupabase();
        if (!client) {
            console.warn(`⚠️ [Supabase] Chamada a '${prop.toString()}' no cliente público ignorada: Cliente não inicializado.`);
            if (prop === 'auth') {
                return {
                    getSession: async () => ({ data: { session: null }, error: null }),
                    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
                    getUser: async () => ({ data: { user: null }, error: null }),
                    signUp: async () => ({ data: { user: null, session: null }, error: new Error("Supabase não inicializado") }),
                    signInWithPassword: async () => ({ data: { user: null, session: null }, error: new Error("Supabase não inicializado") }),
                    signOut: async () => ({ error: null }),
                };
            }
            return createMockChain();
        }
        const value = client[prop];
        return typeof value === 'function' ? value.bind(client) : value;
    }
});

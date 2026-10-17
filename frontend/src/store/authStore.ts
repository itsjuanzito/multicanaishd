import { map } from 'nanostores';
import { resolvePlano, podeCriarPerfis } from '../services/vipPlans.js';
import { loadProfiles, getMainProfile, setActiveProfile, clearActiveProfile, profilesStore } from './profilesStore';
// Importação estática removida para otimizar PageSpeed
// import { supabase } from '../services/supabase';

let _supabaseCache: any = null;
async function getSupabase() {
    if (_supabaseCache) return _supabaseCache;
    // @ts-ignore
    const { supabase } = await import('../services/supabase');
    _supabaseCache = supabase;
    return _supabaseCache;
}

export interface AuthState {
    user: any | null;
    token: string | null;
    isVIP: boolean;
    vipUntil: string | null;
    vipPlan: string | null;
    loading: boolean;
    initialized: boolean;
    // Cloud Sync Stats
    favorites: any[];
    history: any[];
    watchedMovies: any[];
    watchedEpisodes: Record<string, string[]>;
    username: string | null;
    avatar: string | null;
    activeSeconds: number;
    rankingActiveSeconds: number;
    nickname: string | null;
    nicknameChanges: number;
    // Perfil ativo (account_profiles). Favorites/history/watched* acima são os DELE, não
    // os da conta — por isso nenhuma tela precisou saber que perfis existem.
    activeProfileId: string | null;
    isKidsProfile: boolean;
}

const GLOBAL_STORE_KEY = '_multicanaishd_auth_store';
const LOCAL_STORAGE_KEY = 'bf_session_optimistic';

const hasSupabaseSessionMarker = () => {
    if (typeof window === 'undefined') return false;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase.auth.token'))) {
                return true;
            }
        }
    } catch (e) {}
    return false;
};

const getInitialState = (): AuthState => {
    const base = {
        user: null,
        token: null,
        isVIP: false,
        vipUntil: null,
        vipPlan: null,
        loading: true, 
        initialized: false,
        favorites: [],
        history: [],
        watchedMovies: [],
        watchedEpisodes: {},
        username: null,
        avatar: '1',
        activeSeconds: 0,
        rankingActiveSeconds: 0,
        moviesCount: 0,
        nickname: null,
        nicknameChanges: 0,
        activeProfileId: null,
        isKidsProfile: false
    };

    if (typeof window !== 'undefined') {
        try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                const isGuest = !parsed?.user && !parsed?.token;

                if (isGuest) {
                    return {
                        ...base,
                        ...parsed,
                        favorites: [],
                        history: [],
                        watchedMovies: [],
                        watchedEpisodes: {},
                        loading: true,
                        initialized: false
                    };
                }

                return {
                    ...base,
                    ...parsed,
                    loading: true,
                    initialized: false
                };
            }
        } catch (e) {}
    }
    return base;
};

if (!globalThis[GLOBAL_STORE_KEY]) {
    globalThis[GLOBAL_STORE_KEY] = map<AuthState>(getInitialState());
}

export const authStore = globalThis[GLOBAL_STORE_KEY];

// Token de verdade pra chamadas autenticadas ao backend.
//
// `authStore.get().token` NÃO serve pra isso: o snapshot otimista do localStorage é
// restaurado de forma síncrona no primeiro paint e carrega o access_token da última
// sessão salva — que expira em 1h. Quem reabre o site no dia seguinte tem `isVIP: true`
// em cache (player libera) e um JWT morto no mesmo objeto; o `supabaseAdmin.auth.getUser`
// do servidor rejeita, o tier cai pra free e as fontes VIP devolvem 403.
//
// `getSession()` do Supabase renova o token quando está vencido, então é ele quem
// responde. O token do store fica só como último recurso (ex.: falha de rede na
// renovação), e a resposta é escrita de volta no store pra manter tudo coerente.
let _freshTokenInFlight: Promise<string | null> | null = null;

export async function getFreshAccessToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    if (_freshTokenInFlight) return _freshTokenInFlight;

    _freshTokenInFlight = (async () => {
        try {
            const supabase = await getSupabase();
            const { data, error } = await supabase.auth.getSession();
            const token = data?.session?.access_token || null;
            if (!error && token) {
                if (authStore.get()?.token !== token) {
                    authStore.setKey('token', token);
                }
                return token;
            }
        } catch (e) {
            console.warn('[Auth] Falha ao renovar access_token:', (e as Error)?.message);
        }
        return authStore.get()?.token || null;
    })();

    try {
        return await _freshTokenInFlight;
    } finally {
        _freshTokenInFlight = null;
    }
}

/**
 * Headers de autenticação para fetches que dependem de plano (fontes VIP do player).
 * Devolve `{}` pra visitante — o backend trata ausência de header como tier free.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getFreshAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

if (typeof window !== 'undefined') {
    authStore.subscribe((state) => {
        // Persistência otimista (apenas se tivermos um usuário ou se formos explicitamente convidados inicializados)
        if (state.initialized) {
            try {
                if (!state.user && !state.token) {
                    // Para convidados (guests), NÃO devemos salvar histórico, favoritos, etc.
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                        user: null,
                        token: null,
                        isVIP: false,
                        vipUntil: null,
                        vipPlan: null,
                        favorites: [],
                        history: [],
                        watchedMovies: [],
                        watchedEpisodes: {},
                        username: null,
                        avatar: state.avatar || '1',
                        activeSeconds: 0,
                        rankingActiveSeconds: 0,
                        moviesCount: 0,
                        nickname: null,
                        nicknameChanges: 0,
                        activeProfileId: null,
                        isKidsProfile: false
                    }));
                    return;
                }

                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                    user: state.user,
                    token: state.token,
                    isVIP: state.isVIP,
                    vipUntil: state.vipUntil,
                    vipPlan: state.vipPlan,
                    favorites: state.favorites,
                    history: state.history,
                    watchedMovies: state.watchedMovies,
                    watchedEpisodes: state.watchedEpisodes,
                    username: state.username,
                    avatar: state.avatar,
                    activeSeconds: state.activeSeconds,
                    rankingActiveSeconds: state.rankingActiveSeconds,
                    moviesCount: state.moviesCount,
                    nickname: state.nickname,
                    nicknameChanges: state.nicknameChanges,
                    activeProfileId: state.activeProfileId,
                    isKidsProfile: state.isKidsProfile
                }));
            } catch (e) {}
        }
    });
}

let isInitializing = false;
let initPromise: Promise<void> | null = null;

// Compartilhados entre bundles via globalThis para evitar race conditions de pacotes isolados
if (!(globalThis as any)._bf_sync_state) {
    (globalThis as any)._bf_sync_state = {
        timeout: null,
        lastUpdate: 0,
        pendingStats: {},
        lastWait: 1000,
        channel: null,
        profileChannel: null,
        profileChannelId: null,
        isCloudSynced: false, // TRAVA DE SEGURANÇA SAFESYNC
        tabId: Math.random().toString(36).substring(7),
        lastLocalAction: 0
    };
}
const syncState = (globalThis as any)._bf_sync_state;

// Monitoramento Realtime (Sincronização Atmosférica)
let isRealtimeSetup = false;
async function setupRealtime(userId: string) {
    if (isRealtimeSetup) return;
    isRealtimeSetup = true;
    
    if (syncState.channel) syncState.channel.unsubscribe();

    console.log(`%c📡 [Realtime] Conectando (Tab: ${syncState.tabId})`, "color: #a855f7; font-weight: bold;");
    
    const supabase = await getSupabase();
    syncState.channel = supabase
        .channel(`profile_sync_${userId}`)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'profiles', 
            filter: `id=eq.${userId}` 
        }, (payload) => {
            const newData = payload.new;

            if (!shouldApplyRealtime(newData)) return;

            console.log("%c✨ [Realtime] Sincronizando conta com outra tela...", "color: #a855f7; font-weight: bold;");

            // Marca como evento externo para que outras stores saibam que não devem bloquear
            (globalThis as any)._is_realtime_event = true;
            try {
                const current = authStore.get();
                // Só campos de CONTA: favoritos/histórico/episódios agora vivem na linha do
                // perfil ativo e chegam pela assinatura de account_profiles abaixo. Aplicar
                // as colunas legadas de `profiles` aqui sobrescreveria o perfil com dados
                // congelados de antes da migração.
                authStore.set({
                    ...current,
                    username: newData.username !== undefined ? newData.username : current.username,
                    vipPlan: newData.vipPlan !== undefined ? newData.vipPlan : current.vipPlan,
                    activeSeconds: newData.active_seconds !== undefined ? (newData.active_seconds || 0) : current.activeSeconds,
                    rankingActiveSeconds: newData.ranking_active_seconds !== undefined ? (newData.ranking_active_seconds || 0) : current.rankingActiveSeconds,
                    moviesCount: newData.moviesCount !== undefined ? newData.moviesCount : current.moviesCount,
                    nickname: newData.watched_episodes?._nickname !== undefined ? newData.watched_episodes._nickname : current.nickname,
                    nicknameChanges: newData.watched_episodes?._nickname_changes_count !== undefined ? parseInt(newData.watched_episodes._nickname_changes_count || "0", 10) : current.nicknameChanges
                });
            } finally {
                setTimeout(() => { (globalThis as any)._is_realtime_event = false; }, 100);
            }
        })
        .subscribe();
}

/** Mesmas travas anti-eco/anti-flicker que o Realtime da conta sempre teve. */
function shouldApplyRealtime(row: any): boolean {
    const now = Date.now();
    // [ANTI-FLICKER] Ignora se houve uma ação local recente (últimos 2.5s) para evitar
    // que o "eco" da nuvem sobrescreva a UI otimista do usuário.
    if (syncState.lastLocalAction && now - syncState.lastLocalAction < 2500) {
        console.log("🛡️ [Realtime] Ignorando atualização externa para preservar ação local recente.");
        return false;
    }
    // Ignora eco da própria aba
    if (row?.last_update_by === syncState.tabId) return false;
    return true;
}

// Assinatura da linha do PERFIL ativo. Separada da conta porque troca junto com o perfil:
// ao mudar de perfil, a antiga é derrubada e uma nova sobe pro perfil novo.
async function setupProfileRealtime(profileId: string) {
    if (!profileId) return;
    if (syncState.profileChannelId === profileId) return;

    const supabase = await getSupabase();
    if (syncState.profileChannel) {
        syncState.profileChannel.unsubscribe();
        syncState.profileChannel = null;
    }
    syncState.profileChannelId = profileId;

    syncState.profileChannel = supabase
        .channel(`account_profile_sync_${profileId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'account_profiles',
            filter: `id=eq.${profileId}`
        }, (payload: any) => {
            const row = payload.new;
            if (!shouldApplyRealtime(row)) return;

            console.log("%c✨ [Realtime] Sincronizando perfil com outra tela...", "color: #a855f7; font-weight: bold;");
            (globalThis as any)._is_realtime_event = true;
            try {
                const current = authStore.get();
                // Guarda: um eco atrasado da linha antiga não pode sobrescrever o perfil
                // que o usuário acabou de abrir.
                if (current.activeProfileId !== row.id) return;
                authStore.set({
                    ...current,
                    favorites: row.favorites || [],
                    history: row.history || [],
                    watchedMovies: row.watched_movies || [],
                    watchedEpisodes: mergeAccountKeys(row.watched_episodes, current.watchedEpisodes)
                });
            } finally {
                setTimeout(() => { (globalThis as any)._is_realtime_event = false; }, 100);
            }
        })
        .subscribe();
}

/**
 * Espelha "o perfil ativo é infantil?" num cookie.
 *
 * O gate de conteúdo ao vivo roda no middleware, ou seja, no servidor — e o servidor não
 * enxerga nanostores nem localStorage. Sem o cookie, a criança chegaria em /canais
 * digitando a URL. Não é credencial: só diz em qual perfil da própria conta o aparelho
 * está, e tudo que ele bloqueia é público no resto do site.
 */
function syncKidsCookie(isKids: boolean) {
    if (typeof document === 'undefined') return;
    const base = 'bf_kids=; path=/; SameSite=Lax';
    document.cookie = isKids
        ? `bf_kids=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
        : `${base}; max-age=0`;
}

/**
 * Remove as chaves "_" de watched_episodes antes de gravar no perfil.
 *
 * `watched_episodes` faz papel duplo desde antes dos perfis: além dos episódios vistos,
 * guarda nickname e contadores de troca (`_nickname`, `_nickname_changes_count`, ...).
 * Isso é identidade da CONTA — se fosse junto pro perfil, cada perfil teria um nickname
 * próprio e o contador de trocas reiniciaria a cada perfil novo.
 */
function stripAccountKeys(episodes: any): any {
    const clean: any = {};
    Object.entries(episodes || {}).forEach(([key, value]) => {
        if (!key.startsWith('_')) clean[key] = value;
    });
    return clean;
}

/**
 * Inverso de stripAccountKeys: junta os episódios do perfil com as chaves "_" da conta,
 * que continuam vindo de `profiles`. Sem isso, trocar de perfil derrubaria o nickname
 * (e os contadores de troca) do estado, e a tela de perfil mostraria tudo vazio.
 */
function mergeAccountKeys(profileEpisodes: any, currentEpisodes: any): any {
    const merged: any = stripAccountKeys(profileEpisodes);
    Object.entries(currentEpisodes || {}).forEach(([key, value]) => {
        if (key.startsWith('_')) merged[key] = value;
    });
    return merged;
}

export async function updateCloudStats(stats: Partial<Pick<AuthState, 'favorites' | 'history' | 'watchedMovies' | 'watchedEpisodes' | 'activeSeconds' | 'rankingActiveSeconds' | 'moviesCount'>>) {
    const state = authStore.get();
    
    // Se o usuário não está logado, ignoramos a atualização de histórico, favoritos, etc.
    if (!state.user) {
        console.log("🛡️ [Auth] Usuário não logado. Ignorando persistência de histórico/favoritos/atividades.");
        return;
    }

    const now = Date.now();

    // Marca o momento da ação local para blindar o Realtime
    syncState.lastLocalAction = now;
    
    // 1. Atualização Otimista Imediata (UI reage sub-segundo)
    authStore.set({ ...state, ...stats });
    syncState.lastUpdate = now;
    
    // Acumula alterações para o debounce
    Object.assign(syncState.pendingStats, stats);

    // [SAFESYNC] Bloqueia escrita na nuvem se ainda não carregamos o perfil inicial
    // para evitar que o estado inicial 'vazio' do navegador apague a conta real.
    if (!syncState.isCloudSynced) {
        console.warn("🛡️ [SafeSync] Escrita bloqueada. Aguardando carga inicial da nuvem...");
        return;
    }

    if (!state.user) {
        const supabase = await getSupabase();
        const { data } = await supabase.auth.getSession();
        if (!data.session?.user) return;
    }

    // 2. Debounce com tratamento de Erro 429 (Rate Limit)
    if (syncState.timeout) clearTimeout(syncState.timeout);
    
    const currentWait = syncState.lastWait || 1000;
    
    syncState.timeout = setTimeout(async () => {
        const currentData = authStore.get();
        if (!currentData.user) return;

        const pending = { ...syncState.pendingStats };

        // O que é consumo vai pra linha do perfil ativo; o que é da conta (segundos de
        // ranking, contagem de filmes) continua em `profiles` — ranking é por conta pra
        // ninguém farmar horas em 5 perfis ao mesmo tempo.
        const profileObj: any = {};
        if (pending.favorites !== undefined) profileObj.favorites = pending.favorites;
        if (pending.history !== undefined) profileObj.history = pending.history;
        if (pending.watchedMovies !== undefined) profileObj.watched_movies = pending.watchedMovies;
        if (pending.watchedEpisodes !== undefined) profileObj.watched_episodes = stripAccountKeys(pending.watchedEpisodes);

        const accountObj: any = {
            id: currentData.user.id, // Obrigatório para UPSERT
            email: currentData.user.email // Obrigatório para a restrição NOT NULL do profiles
        };
        // active_seconds / ranking_active_seconds / moviesCount NÃO são enviados: só o servidor
        // (heartbeat via increment_watch_time) altera, e o banco ignora escrita do cliente
        // (migrations/ranking_watch_time_protection.sql). Aceitar do cliente permitia inflar o ranking.

        // Sem perfil ativo (migração ainda não rodou) o consumo volta a ser gravado nas
        // colunas da conta — o mesmo lugar de onde ele foi lido no fallback do initAuth.
        // Descartar a escrita aqui perderia favoritos e progresso de verdade.
        const modoLegado = !currentData.activeProfileId;
        if (modoLegado) {
            Object.assign(accountObj, profileObj);
            // Na conta, watched_episodes precisa manter as chaves "_": é lá que o nickname
            // mora. Gravar a versão sem elas apagaria a identidade do usuário.
            if (pending.watchedEpisodes !== undefined) accountObj.watched_episodes = pending.watchedEpisodes;
        }

        const hasProfileWrite = Object.keys(profileObj).length > 0 && !modoLegado;
        const hasAccountWrite = Object.keys(accountObj).length > 2;
        if (!hasProfileWrite && !hasAccountWrite) return;

        console.log("%c☁️ [Auth] Sincronizando (UPSERT)...", "color: #3b82f6; font-weight: bold;");

        const supabase = await getSupabase();
        let error: any = null;

        if (hasProfileWrite) {
            profileObj.last_update_by = syncState.tabId;
            const res = await supabase
                .from('account_profiles')
                .update(profileObj)
                .eq('id', currentData.activeProfileId);
            error = res.error;
        }

        if (!error && hasAccountWrite) {
            const res = await supabase.from('profiles').upsert(accountObj);
            error = res.error;
        }

        if (error) {
            console.error("%c❌ [Auth] Erro na Sincronização:", "color: #ef4444; font-weight: bold;", error.message);
            
            // Tratamento de Rate Limit 429
            if (error.message.includes("429") || error.code === '429') {
                syncState.lastWait = Math.min(currentWait * 2, 10000); // Backoff exponencial até 10s
                console.warn(`🕒 [Auth] Rate limit atingido. Próxima tentativa em ${syncState.lastWait/1000}s`);
            }
            
            // Devolve pro acumulador para tentar novamente no próximo clique ou ciclo
            Object.assign(syncState.pendingStats, pending);
        } else {
            syncState.pendingStats = {}; // Limpa apenas se tiver sucesso real
            syncState.lastWait = 1000;   // Reseta o wait
            console.log("%c✅ [Auth] Nuvem sincronizada.", "color: #10b981; font-weight: bold;");
        }
    }, currentWait);
}

/**
 * Descobre com qual perfil a sessão deve abrir.
 *
 * Quem não tem Black é forçado ao perfil principal: os extras continuam salvos no banco
 * (nada é apagado quando a assinatura vence), apenas deixam de ser selecionáveis.
 */
async function resolveActiveProfile(user: any, profileRow: any, vipPlan: string | null) {
    const seed = {
        username: profileRow?.username,
        email: user?.email,
        avatar: profileRow?.avatar,
        favorites: profileRow?.favorites,
        history: profileRow?.history,
        watchedMovies: profileRow?.watched_movies,
        watchedEpisodes: profileRow?.watched_episodes
    };

    let active = await loadProfiles(user.id, seed);
    if (!podeCriarPerfis(vipPlan) && active && !active.is_main) {
        const main = getMainProfile();
        if (main) {
            setActiveProfile(main.id);
            active = main;
        }
    }
    return active;
}

/**
 * Descarrega o que estava no debounce na linha do perfil informado.
 *
 * Usado antes de trocar de perfil: sem isso, a escrita atrasada dispararia já com o
 * perfil novo ativo e gravaria o consumo do perfil antigo em cima do outro.
 */
async function flushPendingStats(profileId: string | null) {
    if (syncState.timeout) {
        clearTimeout(syncState.timeout);
        syncState.timeout = null;
    }
    const pending = { ...syncState.pendingStats };
    syncState.pendingStats = {};
    if (!profileId || Object.keys(pending).length === 0) return;

    const update: any = { last_update_by: syncState.tabId };
    if (pending.favorites !== undefined) update.favorites = pending.favorites;
    if (pending.history !== undefined) update.history = pending.history;
    if (pending.watchedMovies !== undefined) update.watched_movies = pending.watchedMovies;
    if (pending.watchedEpisodes !== undefined) update.watched_episodes = stripAccountKeys(pending.watchedEpisodes);
    if (Object.keys(update).length === 1) return;

    try {
        const supabase = await getSupabase();
        await supabase.from('account_profiles').update(update).eq('id', profileId);
    } catch (e: any) {
        console.error('❌ [Auth] Falha ao gravar pendências antes da troca de perfil:', e?.message);
    }
}

/**
 * Troca o perfil ativo e recarrega os dados de consumo no authStore.
 * Toda a UI existente lê favoritos/histórico do authStore, então ela se atualiza sozinha.
 */
export async function switchProfile(profileId: string) {
    const state = authStore.get();
    if (!state.user) return { success: false, error: 'Usuário não autenticado.' };
    if (state.activeProfileId === profileId) return { success: true };

    const target = profilesStore.get().profiles.find((p: any) => p.id === profileId);
    if (!target) return { success: false, error: 'Perfil não encontrado.' };
    if (!target.is_main && !podeCriarPerfis(state.vipPlan)) {
        return { success: false, error: 'Múltiplos perfis são exclusivos do MultiCanaisHD VIP Black.' };
    }

    await flushPendingStats(state.activeProfileId);
    setActiveProfile(profileId);

    // Relê a linha em vez de confiar no cache: outra aba ou aparelho pode ter mexido
    // neste perfil desde que a lista foi carregada.
    let row = target;
    try {
        const supabase = await getSupabase();
        const { data } = await supabase
            .from('account_profiles')
            .select('id, account_id, name, avatar, is_kids, is_main, favorites, history, watched_movies, watched_episodes')
            .eq('id', profileId)
            .single();
        if (data) row = data;
    } catch (e) {}

    const current = authStore.get();
    syncState.lastLocalAction = Date.now();
    authStore.set({
        ...current,
        favorites: row.favorites || [],
        history: row.history || [],
        watchedMovies: row.watched_movies || [],
        watchedEpisodes: mergeAccountKeys(row.watched_episodes, current.watchedEpisodes),
        activeProfileId: row.id,
        isKidsProfile: row.is_kids === true
    });

    syncKidsCookie(row.is_kids === true);
    setupProfileRealtime(row.id);
    return { success: true };
}

export async function initAuth(force = false, sessionOverride = null) {
    // Singleton pattern rigoroso (Fase 15 - Performance)
    if (isInitializing && initPromise && !force && !sessionOverride) {
        return initPromise;
    }
    if (initPromise && !force) return initPromise;
    
    const currentState = authStore.get();
    if (currentState.initialized && !force && !sessionOverride) return;

    isInitializing = true;
    initPromise = new Promise(async (resolve) => {
        const state = authStore.get();
        if (state.loading && !force && state.initialized) {
            isInitializing = false;
            return resolve();
        }
        authStore.setKey('loading', true);

        let resolved = false;
        const doResolve = () => {
            if (resolved) return;
            resolved = true;
            isInitializing = false;
            resolve();
        };

        // Safety fallback: 7s para liberar a UI caso o Supabase trave
        const safetyTimeout = setTimeout(() => {
            const current = authStore.get();
            if (current.loading) {
                console.warn("%c🕒 [Auth] Timeout atingido (7s). Forçando liberação da UI...", "color: #f59e0b; font-weight: bold;");
                authStore.setKey('loading', false);
                authStore.setKey('initialized', true);
                syncState.isCloudSynced = true; 
            }
            doResolve();
        }, 7000);

        try {
            console.log("%c📡 [Auth] Iniciando Supabase Client...", "color: #8b5cf6;");
            const supabase = await getSupabase();
            
            if (!supabase) {
                console.error("❌ [Auth] Erro: Cliente Supabase nulo (Keys ausentes?)");
                throw new Error("Supabase client not initialized");
            }

            let session = sessionOverride;
            if (!session) {
                const { data, error: sessionErr } = await supabase.auth.getSession();
                if (sessionErr) throw sessionErr;
                session = data.session;
            }
            
            if (!session?.user) {
                console.log("%cℹ️ [Auth] Nenhuma sessão ativa encontrada.", "color: #6b7280;");
                const current = authStore.get();
                
                if (current.user !== null) {
                    authStore.set({ 
                        ...current,
                        user: null, token: null, isVIP: false, loading: false, initialized: true,
                        favorites: [], history: [], watchedMovies: [], watchedEpisodes: {}, username: null,
                        nickname: null, nicknameChanges: 0
                    });
                } else {
                    authStore.setKey('loading', false);
                    authStore.setKey('initialized', true);
                }
                syncState.isCloudSynced = true;
                return doResolve();
            }

            console.log(`%c👤 [Auth] Usuário: ${session.user.email} (Syncing Profile & Payments...)`, "color: #8b5cf6; font-weight: bold;");
            
            const profilePromise = supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

            const paymentPromise = supabase
                .from('payments')
                .select('amount')
                .eq('user_id', session.user.id)
                .eq('status', 'paid')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
                .then(res => res?.data || null)
                .catch(err => {
                    console.warn("%c⚠️ [Auth] Falha ao ler pagamentos (RLS ou Tabela?):", "color: #f59e0b;", err);
                    return null;
                });

            const [{ data: profile, error: profileError }, latestPayment] = await Promise.all([
                profilePromise,
                paymentPromise
            ]);

            if (profileError) {
                console.warn("%c⚠️ [Auth] Perfil não encontrado ou erro na query:", "color: #f59e0b;", profileError.message);
                syncState.isCloudSynced = true; 
                authStore.set({
                    ...authStore.get(),
                    user: session.user,
                    token: session.access_token,
                    vipPlan: null,
                    loading: false,
                    initialized: true
                });
                return doResolve();
            }

            const isVIP = profile?.is_vip === true && (!profile?.vip_until || new Date(profile.vip_until) > new Date());
            const currentMem = authStore.get();
            const isSameUser = currentMem.user?.id === session.user.id;

            if (!isSameUser) {
                console.log("🛡️ [Auth] Diferente usuário detectado. Descartando dados em memória do usuário anterior.");
                syncState.pendingStats = {};
            }

            // Carrega os perfis ANTES de liberar o SafeSync: enquanto não sabemos qual é o
            // perfil ativo, uma escrita não teria linha de destino e cairia no vazio.
            const vipPlanForProfiles = resolvePlano(profile, latestPayment?.amount ?? null);
            const activeProfile = await resolveActiveProfile(session.user, profile, vipPlanForProfiles);

            syncState.isCloudSynced = true; // LIBERA SAFESYNC

            const pending = syncState.pendingStats;
            const dbHistory = (activeProfile?.history || profile?.history) || [];
            const memHistory = isSameUser && pending.history !== undefined ? pending.history : (isSameUser ? (currentMem.history || []) : []);
            
            const historyMap = new Map();
            dbHistory.forEach(item => { if (item && item.id) historyMap.set(item.id, item); });
            
            const parseTime = (val: any) => {
                if (!val) return 0;
                const t = new Date(val).getTime();
                return isNaN(t) ? 0 : t;
            };

            memHistory.forEach(item => {
                if (item && item.id) {
                    const existing = historyMap.get(item.id);
                    if (!existing || parseTime(item.timestamp) >= parseTime(existing.timestamp)) {
                        historyMap.set(item.id, item);
                    }
                }
            });
            const smartHistory = Array.from(historyMap.values()).sort((a, b) => parseTime(b.timestamp) - parseTime(a.timestamp));
            
            // Consumo vem do PERFIL ativo; as colunas equivalentes em `profiles` viraram
            // legado depois da migração de account_profiles.
            //
            // `fonte` cai de volta na conta quando não há perfil: é o caso de o código
            // subir antes de account_profiles.sql rodar (ou da tabela ficar indisponível).
            // Sem esse fallback, todo usuário abriria o site com lista e histórico zerados
            // — que é indistinguível de perda de dados para quem está olhando.
            const fonte = activeProfile || {
                favorites: profile?.favorites,
                history: profile?.history,
                watched_movies: profile?.watched_movies,
                watched_episodes: profile?.watched_episodes
            };

            const mergedData = {
                favorites: isSameUser && pending.favorites !== undefined ? pending.favorites : (fonte.favorites || []),
                history: smartHistory,
                watchedMovies: isSameUser && pending.watchedMovies !== undefined ? pending.watchedMovies : (fonte.watched_movies || []),
                watchedEpisodes: isSameUser && pending.watchedEpisodes !== undefined
                    ? pending.watchedEpisodes
                    : mergeAccountKeys(fonte.watched_episodes, profile?.watched_episodes),
            };

            // Mesma regra que o servidor aplica no gate das fontes VIP — importada de
            // services/vipPlans.js pra que cliente e servidor não possam divergir.
            const vipPlan = vipPlanForProfiles;

            let avatar = profile?.avatar || '1';
            const isCustomAvatar = avatar.startsWith('http') || avatar.includes('supabase') || avatar.includes('/');
            const isVipOnlyAvatar = ['6', '7', '8', '9', '10'].includes(avatar);

            // Sem VIP o avatar exclusivo deixa de ser EXIBIDO, mas continua gravado.
            //
            // Antes daqui saía um UPDATE gravando '1' no banco. Como `isVIP` também fica
            // falso em qualquer leitura transitoriamente ruim do perfil, uma única carga
            // infeliz apagava a URL da foto customizada de forma irreversível — o arquivo
            // seguia no bucket, mas o endereço dele sumia da conta. Reverter só na
            // apresentação devolve a foto sozinha quando a assinatura volta.
            if (!isVIP && (isCustomAvatar || isVipOnlyAvatar)) {
                avatar = '1';
            }

            let activeSeconds = profile?.active_seconds || 0;
            if (activeSeconds === 0) {
                if (profile?.watched_episodes?._active_seconds?.[0]) {
                    activeSeconds = parseInt(profile.watched_episodes._active_seconds[0], 10);
                } else {
                    const moviesCount = Array.isArray(profile?.watched_movies) ? profile.watched_movies.length : 0;
                    let episodesCount = 0;
                    if (profile?.watched_episodes && typeof profile.watched_episodes === 'object') {
                        Object.entries(profile.watched_episodes).forEach(([key, eps]) => {
                             if (key !== '_active_seconds' && Array.isArray(eps)) {
                                 episodesCount += eps.length;
                             }
                        });
                    }
                    if (moviesCount > 0 || episodesCount > 0) {
                        activeSeconds = Math.round(((moviesCount * 1.6) + (episodesCount * 0.7)) * 3600);
                    } else {
                        activeSeconds = 1; // Novo usuário: inicializa com 1 segundo para travar o fallback do ranking
                    }
                }
            }

            // A semente calculada fica só no estado local: o banco não aceita mais que o cliente
            // grave active_seconds (ver migrations/ranking_watch_time_protection.sql).

            let watchedEpisodes = { ...(mergedData.watchedEpisodes || {}) } as any;
            // Espelho do que vai pra `profiles`: só identidade da conta. `watchedEpisodes`
            // acima carrega junto os episódios do perfil ativo, e gravar aquilo aqui
            // colaria o consumo de um perfil na linha da conta.
            const accountEpisodes = { ...(profile?.watched_episodes || {}) } as any;

            // Busca metadados da sessão (especialmente úteis no fluxo de cadastro imediato)
            // Retrieve session user metadata (critical for instant signup sync without race conditions)
            const metaNickname = session.user?.user_metadata?.nickname || session.user?.raw_user_meta_data?.nickname || null;
            const metaDisplayName = session.user?.user_metadata?.display_name || session.user?.raw_user_meta_data?.display_name || null;

            let nickname = watchedEpisodes._nickname || metaNickname || null;
            if (nickname && !watchedEpisodes._nickname) {
                watchedEpisodes._nickname = nickname;
                if (!watchedEpisodes._nickname_changes_count) watchedEpisodes._nickname_changes_count = "0";
                if (!watchedEpisodes._vip_nickname_changes_count) watchedEpisodes._vip_nickname_changes_count = "0";
                accountEpisodes._nickname = watchedEpisodes._nickname;
                accountEpisodes._nickname_changes_count = watchedEpisodes._nickname_changes_count;
                accountEpisodes._vip_nickname_changes_count = watchedEpisodes._vip_nickname_changes_count;
            }

            // Contadores separados por contexto de plano
            // Separate counters per plan context: standard vs VIP
            const standardChanges = parseInt(watchedEpisodes._nickname_changes_count || "0", 10);
            const vipChanges = parseInt(watchedEpisodes._vip_nickname_changes_count || "0", 10);
            const currentIsVip = profile?.is_vip === true && (!profile?.vip_until || new Date(profile.vip_until) > new Date());
            // O limite correto é aplicado contra o contador do contexto atual
            // Correct limit is applied against the counter of the current context
            let nicknameChanges = currentIsVip ? vipChanges : standardChanges;

            // Se o usuário estiver logado e não possuir um nickname (nem no banco nem nos metadados), gera um automático e salva
            // If logged in and has absolutely no nickname (DB or metadata), generate a generic one
            if (session.user && !nickname) {
                const emailPrefix = (session.user.email || "").split("@")[0] || "user";
                let baseNickname = emailPrefix.toLowerCase().replace(/[^a-z0-9_]/g, "");
                if (baseNickname.length < 3) baseNickname = "user_" + baseNickname;
                if (baseNickname.length > 15) baseNickname = baseNickname.substring(0, 15);

                let uniqueNickname = baseNickname;
                let isTaken = true;
                let suffix = 0;

                while (isTaken && suffix < 10) {
                    const testNick = suffix === 0 ? uniqueNickname : `${uniqueNickname}_${suffix}`;
                    const { data: existing } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('watched_episodes->>_nickname', testNick);

                    if (!existing || existing.length === 0) {
                        uniqueNickname = testNick;
                        isTaken = false;
                    } else {
                        suffix++;
                    }
                }

                if (isTaken) {
                    uniqueNickname = `${baseNickname}_${Math.floor(1000 + Math.random() * 9000)}`;
                }

                nickname = uniqueNickname;
                nicknameChanges = 0;

                watchedEpisodes._nickname = nickname;
                watchedEpisodes._nickname_changes_count = "0";
                accountEpisodes._nickname = nickname;
                accountEpisodes._nickname_changes_count = "0";

                console.log(`✨ [Auth] Nickname único gerado automaticamente para ${session.user.email}: @${nickname}`);

                await supabase
                    .from('profiles')
                    .update({ watched_episodes: accountEpisodes })
                    .eq('id', session.user.id);
            } else if (session.user && metaNickname && !profile?.watched_episodes?._nickname) {
                // Se usamos o metaNickname do cadastro, mas ele ainda não estava persistido na coluna watched_episodes, garante salvamento
                // If we fell back to metaNickname but it wasn't saved in profiles yet, persist it now
                await supabase
                    .from('profiles')
                    .update({
                        watched_episodes: accountEpisodes,
                        ...(metaDisplayName && !profile?.username ? { username: metaDisplayName } : {})
                    })
                    .eq('id', session.user.id);
            }

            authStore.set({
                user: session.user,
                token: session.access_token,
                ...mergedData,
                watchedEpisodes, // usa o objeto atualizado
                isVIP: isVIP,
                vipUntil: profile?.vip_until ?? null,
                vipPlan: vipPlan,
                username: profile?.username || metaDisplayName || null,
                avatar: avatar,
                activeSeconds: activeSeconds,
                rankingActiveSeconds: profile?.ranking_active_seconds !== undefined && profile?.ranking_active_seconds !== null ? profile.ranking_active_seconds : activeSeconds,
                moviesCount: profile?.moviesCount || 0,
                nickname: nickname,
                nicknameChanges: nicknameChanges,
                activeProfileId: activeProfile?.id || null,
                isKidsProfile: activeProfile?.is_kids === true,
                loading: false,
                initialized: true
            });

            console.log("%c✅ [Auth] Perfil sincronizado com sucesso.", "color: #10b981; font-weight: bold;");
            syncKidsCookie(activeProfile?.is_kids === true);
            setupRealtime(session.user.id);
            if (activeProfile?.id) setupProfileRealtime(activeProfile.id);
        } catch (e) {
            console.error("%c❌ [Auth] Erro Crítico durante Inicialização:", "color: #ef4444; font-weight: bold;", e);
            authStore.setKey('loading', false);
            authStore.setKey('initialized', true);
        } finally {
            clearTimeout(safetyTimeout);
            doResolve();
        }

    });

    return initPromise;
}

if (typeof window !== 'undefined') {
    let lastEvent = '';
    let lastUserId = '';
    let initialSessionNullTimeout: any = null;

    // Registramos o listener de estado apenas UMA vez por sessão do navegador
    if (!(window as any)._bf_auth_listener_registered) {
        (window as any)._bf_auth_listener_registered = true;
        
        async function startSupabaseListener() {
            // Bloqueia para crawlers para economizar JS no PageSpeed
            const ua = navigator.userAgent.toLowerCase();
            if (/bot|googlebot|google-inspectiontool|googleother|crawler|spider|robot|crawling|lighthouse|pagespeed|chrome-lighthouse/i.test(ua)) return;

            const supabase = await getSupabase();
            supabase.auth.onAuthStateChange(async (event: any, session: any) => {
                const userId = session?.user?.id || 'none';
                if (event === lastEvent && userId === lastUserId && event !== 'TOKEN_REFRESHED') return;
                
                console.log(`🔄 [Auth] Evento: ${event}`);
                lastEvent = event;
                lastUserId = userId;

                // Cancela timeout se temos uma sessão ativa
                if (session) {
                    if (initialSessionNullTimeout) {
                        clearTimeout(initialSessionNullTimeout);
                        initialSessionNullTimeout = null;
                    }
                }

                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                    initAuth(true, session);
                } else if (event === 'INITIAL_SESSION') {
                    if (session) {
                        initAuth(true, session);
                    } else {
                        // INITIAL_SESSION com session nula: pode ser um estado transiente (Supabase inicializando).
                        // Debouncamos para evitar flicker se SIGNED_IN vier logo em seguida.
                        if (initialSessionNullTimeout) clearTimeout(initialSessionNullTimeout);
                        initialSessionNullTimeout = setTimeout(async () => {
                            const { data } = await supabase.auth.getSession();
                            if (!data?.session) {
                                initAuth(true, null);
                            }
                            initialSessionNullTimeout = null;
                        }, 1500);
                    }
                } else if (event === 'SIGNED_OUT') {
                    if (initialSessionNullTimeout) {
                        clearTimeout(initialSessionNullTimeout);
                        initialSessionNullTimeout = null;
                    }
                    if (syncState.channel) {
                        syncState.channel.unsubscribe();
                        syncState.channel = null;
                    }
                    if (syncState.profileChannel) {
                        syncState.profileChannel.unsubscribe();
                        syncState.profileChannel = null;
                        syncState.profileChannelId = null;
                    }
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    clearActiveProfile();
                    syncKidsCookie(false);
                    authStore.set({
                        user: null, token: null, isVIP: false, vipUntil: null, vipPlan: null, loading: false, initialized: true,
                        favorites: [], history: [], watchedMovies: [], watchedEpisodes: {}, username: null, avatar: '1',
                        activeProfileId: null, isKidsProfile: false
                    });
                }
            });
        }

        // Inicializa o listener real do Supabase imediatamente para evitar flickers e race conditions (Fase 15)
        startSupabaseListener();

        // MULTI-TAB SYNC
        window.addEventListener('storage', (e) => {
            if (e.key === LOCAL_STORAGE_KEY) {
                if (!e.newValue) {
                    authStore.set({ 
                        user: null, token: null, isVIP: false, vipUntil: null, vipPlan: null, loading: false, initialized: true,
                        favorites: [], history: [], watchedMovies: [], watchedEpisodes: {}, username: null, avatar: '1'
                    });
                    return;
                }
                try {
                    const parsed = JSON.parse(e.newValue);
                    const current = authStore.get();
                    
                    // Se ambos os estados representam usuários deslogados, não há o que sincronizar e evitamos loops
                    if (!parsed.user && !current.user) return;
                    
                    // Compara apenas chaves críticas para evitar loops ou re-renders inúteis
                    const hasChanged = parsed.user?.id !== current.user?.id ||
                                     parsed.isVIP !== current.isVIP ||
                                     parsed.activeSeconds !== current.activeSeconds ||
                                     JSON.stringify(parsed.history || []) !== JSON.stringify(current.history || []) ||
                                     JSON.stringify(parsed.watchedEpisodes || {}) !== JSON.stringify(current.watchedEpisodes || {});

                    if (hasChanged) {
                        authStore.set({ ...current, ...parsed });
                    }
                } catch(err){}
            }
        });

        // GARANTIA: Removido auto-init para deixar o Nuclear Loader controlar a carga (Otimização PageSpeed)
        // setTimeout(() => initAuth(false), 10);
    }

    // Exposições Globais
    (window as any)._authStore = authStore;
    (window as any)._updateCloudStats = updateCloudStats;
}

/**
 * Limpa o histórico tanto local quanto na nuvem
 */
export function clearCloudHistory() {
    const state = authStore.get();
    
    // Limpa local storage legado
    localStorage.removeItem("multicanaishd_history");
    localStorage.removeItem("bf_history");
    
    if (state.user) {
        updateCloudStats({ history: [] });
    } else {
        authStore.setKey("history", []);
    }
}

/**
 * Remove um item específico do histórico tanto local quanto na nuvem
 */
export function removeFromHistory(id: string) {
    const state = authStore.get();
    const sId = id?.toString() || "";
    
    const newHistory = (state.history || []).filter(item => item?.id?.toString() !== sId);
    
    if (state.user) {
        updateCloudStats({ history: newHistory });
    } else {
        authStore.setKey("history", newHistory);
    }
}

/**
 * Atualiza o nome de exibição (username) do usuário, garantindo sanitização e tratando unicidade
 */
export async function updateUsername(username: string): Promise<{ success: boolean; error?: string }> {
    // 1. Sanitização Proativa (Pilar 2)
    // Permite letras (com acentos), números, espaços e sublinhados.
    const sanitized = username.trim().replace(/[^a-zA-Z0-9áéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ_ ]/g, '');
    
    // 2. Validação de Tamanho
    if (sanitized.length < 2 || sanitized.length > 25) {
        return { 
            success: false, 
            error: typeof window !== 'undefined' && (window as any)._multicanaishd_lang === 'en'
                ? "Display name must be between 2 and 25 characters."
                : "O nome de exibição deve ter entre 2 e 25 caracteres."
        };
    }

    const state = authStore.get();
    if (!state.user) {
        return { 
            success: false, 
            error: "Usuário não autenticado." 
        };
    }

    try {
        const supabase = await getSupabase();

        // 3. Verificar unicidade — nenhum outro usuário pode ter o mesmo nome de exibição
        // Check uniqueness — no other user can have the same display name
        const { data: existing, error: checkError } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', sanitized)
            .neq('id', state.user.id)
            .maybeSingle();

        if (checkError) {
            console.error("❌ [AuthStore] Erro ao verificar unicidade do nome de exibição:", checkError);
        }

        if (existing) {
            const isEn = typeof window !== 'undefined' && (window as any)._multicanaishd_lang === 'en';
            return {
                success: false,
                error: isEn
                    ? "This display name is already taken by another user."
                    : "Este nome de exibição já está sendo usado por outro usuário."
            };
        }
        
        // Salva a atualização no profiles do usuário (coluna 'username')
        // Persist the update on the user's profile (username column)
        const { error } = await supabase
            .from('profiles')
            .update({ username: sanitized })
            .eq('id', state.user.id);

        if (error) {
            console.error("❌ [AuthStore] Erro ao atualizar nome de exibição:", error);
            return { success: false, error: error.message };
        }

        // Sucesso: Atualiza o estado local do authStore reativamente
        authStore.set({
            ...state,
            username: sanitized
        });

        return { success: true };
    } catch (err: any) {
        console.error("❌ [AuthStore] Erro inesperado ao salvar nome de exibição:", err);
        return { success: false, error: err.message || "Erro inesperado." };
    }
}

/**
 * Atualiza o índice do avatar escolhido pelo usuário no seu perfil
 */
export async function updateAvatar(avatarIndex: string): Promise<{ success: boolean; error?: string }> {
    const state = authStore.get();
    if (!state.user) {
        return { 
            success: false, 
            error: "Usuário não autenticado." 
        };
    }

    try {
        const supabase = await getSupabase();
        
        // Faz a atualização diretamente no profiles do usuário (coluna 'avatar')
        const { error } = await supabase
            .from('profiles')
            .update({ avatar: avatarIndex })
            .eq('id', state.user.id);

        if (error) {
            console.error("❌ [AuthStore] Erro ao atualizar avatar:", error);
            return { success: false, error: error.message };
        }

        // Sucesso: Atualiza o estado local do authStore reativamente
        authStore.set({
            ...state,
            avatar: avatarIndex
        });

        return { success: true };
    } catch (err: any) {
        console.error("❌ [AuthStore] Erro inesperado ao salvar avatar:", err);
        return { success: false, error: err.message || "Erro inesperado." };
    }
}

/**
 * Atualiza o nickname exclusivo do usuário, respeitando limites e restrições de plano
 * Updates the user's unique nickname, respecting plan limits and restrictions
 */
export async function updateNickname(newNickname: string): Promise<{ success: boolean; error?: string }> {
    // 1. Sanitização Proativa (apenas letras minúsculas, números e sublinhados)
    const sanitized = newNickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    // 2. Validação de Tamanho
    if (sanitized.length < 3 || sanitized.length > 20) {
        return {
            success: false,
            error: typeof window !== 'undefined' && (window as any)._multicanaishd_lang === 'en'
                ? "Nickname must be between 3 and 20 characters (only lowercase letters, numbers, and underscores)."
                : "O nickname deve ter entre 3 e 20 caracteres (apenas letras minúsculas, números e sublinhados)."
        };
    }

    const state = authStore.get();
    if (!state.user) {
        return { success: false, error: "Usuário não autenticado." };
    }

    const isPt = typeof window !== 'undefined' && (window as any)._multicanaishd_lang !== 'en';

    // 3. Verificação de Limites — contadores separados por plano
    // Limit check — separate counters per plan context
    const isVip = state.isVIP;
    const planLower = String(state.vipPlan || '').toLowerCase();
    const isDiamond = isVip && (planLower.includes('diamond') || planLower.includes('black') || planLower === 'vitalicio');
    const changesCount = state.nicknameChanges; // já é o contador correto para o plano atual

    let limit = 1; // Membro standard
    if (isVip) {
        limit = isDiamond ? Infinity : 5; // Diamond = ilimitado, VIP Básico = 5
    }

    if (changesCount >= limit) {
        const errorMsg = !isVip
            ? (isPt
                ? "Membros Standard podem alterar o nickname apenas 1 vez. Adquira o VIP para liberar mais alterações!"
                : "Standard members can change their nickname only once. Upgrade to VIP for more changes!")
            : (isPt
                ? `Você já atingiu o limite de ${limit} alterações para o plano VIP Básico. Faça upgrade para o Diamond para alterações ilimitadas!`
                : `You have reached the limit of ${limit} changes for the Basic VIP plan. Upgrade to Diamond for unlimited changes!`);
        return { success: false, error: errorMsg };
    }

    try {
        // 4. Verificação de Unicidade via API server-side (supabaseAdmin contorna RLS)
        // Uniqueness check via server-side API (supabaseAdmin bypasses RLS)
        // O cliente Supabase normal só enxerga a própria row por causa do RLS —
        // por isso usamos o endpoint dedicado que roda com service role key.
        // The normal Supabase client only sees its own row due to RLS policies,
        // so we delegate to the dedicated endpoint running with the service role key.
        const checkUrl = `/api/auth/check-nickname?nickname=${encodeURIComponent(sanitized)}&excludeUserId=${encodeURIComponent(state.user.id)}`;
        const checkRes = await fetch(checkUrl);

        if (!checkRes.ok) {
            console.error("❌ [AuthStore] Falha na verificação de unicidade do nickname:", checkRes.status);
            return { success: false, error: isPt ? "Erro ao verificar disponibilidade do nickname." : "Failed to verify nickname availability." };
        }

        const checkData = await checkRes.json();
        if (!checkData.available) {
            return {
                success: false,
                error: isPt
                    ? "Este nickname já está sendo usado por outro usuário."
                    : "This nickname is already taken by another user."
            };
        }

        const supabase = await getSupabase();

        // 5. Prepara o objeto watched_episodes atualizado, com o contador correto por plano
        // Prepare updated watched_episodes, incrementing the right counter per plan
        const currentEpisodes = { ...(state.watchedEpisodes as any || {}) };
        const standardCount = parseInt(currentEpisodes._nickname_changes_count || "0", 10);
        const vipCount = parseInt(currentEpisodes._vip_nickname_changes_count || "0", 10);

        const nicknameKeys = {
            _nickname: sanitized,
            // Incrementa apenas o contador do plano atual
            // Only increment the counter of the current plan context
            _nickname_changes_count: String(isVip ? standardCount : standardCount + 1),
            _vip_nickname_changes_count: String(isVip ? vipCount + 1 : vipCount),
        };
        const updatedEpisodes = { ...currentEpisodes, ...nicknameKeys };

        // Grava apenas as chaves de identidade na conta. `currentEpisodes` traz junto os
        // episódios do perfil ativo, que não têm nada que fazer na linha da conta.
        const { data: accountRow } = await supabase
            .from('profiles')
            .select('watched_episodes')
            .eq('id', state.user.id)
            .single();

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ watched_episodes: { ...(accountRow?.watched_episodes || {}), ...nicknameKeys } })
            .eq('id', state.user.id);

        if (updateError) {
            console.error("❌ [AuthStore] Erro ao salvar nickname:", updateError);
            return { success: false, error: updateError.message };
        }

        // 6. Atualiza o estado local reativamente
        authStore.set({
            ...state,
            watchedEpisodes: updatedEpisodes,
            nickname: sanitized,
            nicknameChanges: changesCount + 1
        });

        return { success: true };

    } catch (err: any) {
        console.error("❌ [AuthStore] Erro inesperado ao atualizar nickname:", err);
        return { success: false, error: err.message || "Erro inesperado." };
    }
}


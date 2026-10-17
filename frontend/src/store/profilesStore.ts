import { map } from 'nanostores';
import { MAX_PERFIS_POR_CONTA } from '../services/vipPlans.js';

// Perfis por conta (benefício do MultiCanaisHD VIP Black). Este store cuida só da LISTA e de
// QUAL perfil está ativo; os dados de consumo do perfil ativo (favoritos, histórico,
// episódios vistos) continuam no authStore — assim nenhuma tela precisou mudar pra
// passar a enxergar o perfil em vez da conta.
//
// Não importa o authStore de propósito: quem chama passa o accountId. Dependência em
// mão única evita ciclo de import entre os dois stores.

let _supabaseCache: any = null;
async function getSupabase() {
    if (_supabaseCache) return _supabaseCache;
    // @ts-ignore
    const { supabase } = await import('../services/supabase');
    _supabaseCache = supabase;
    return _supabaseCache;
}

export interface AccountProfile {
    id: string;
    account_id: string;
    name: string;
    avatar: string;
    is_kids: boolean;
    is_main: boolean;
    favorites: any[];
    history: any[];
    watched_movies: any[];
    watched_episodes: Record<string, any>;
}

export interface ProfilesState {
    profiles: AccountProfile[];
    activeId: string | null;
    loading: boolean;
    initialized: boolean;
}

const GLOBAL_KEY = '_multicanaishd_profiles_store';
// Qual perfil está ativo é escolha do APARELHO, não da conta: a TV da sala pode ficar no
// perfil das crianças enquanto o celular fica no do adulto. Por isso localStorage, e não
// uma coluna no banco.
const ACTIVE_KEY = 'bf_active_profile';

if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = map<ProfilesState>({
        profiles: [],
        activeId: null,
        loading: false,
        initialized: false
    });
}

export const profilesStore = globalThis[GLOBAL_KEY];

const PROFILE_COLUMNS = 'id, account_id, name, avatar, is_kids, is_main, favorites, history, watched_movies, watched_episodes';

function readStoredActiveId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(ACTIVE_KEY);
    } catch (e) {
        return null;
    }
}

function persistActiveId(id: string | null) {
    if (typeof window === 'undefined') return;
    try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
}

export function getActiveProfile(): AccountProfile | null {
    const { profiles, activeId } = profilesStore.get();
    if (!profiles.length) return null;
    return profiles.find(p => p.id === activeId) || profiles.find(p => p.is_main) || profiles[0];
}

/**
 * Cria o perfil principal de uma conta que ainda não tem nenhum, semeado com os dados
 * que já estavam nas colunas de `profiles`.
 *
 * Existe pra cobrir a janela entre o deploy e a execução do backfill de
 * account_profiles.sql (e contas criadas depois dele): sem a semente, quem entrasse
 * nessa janela veria lista e histórico zerados, que parece perda de dados.
 */
async function createMainProfile(accountId: string, seed: any): Promise<AccountProfile | null> {
    const supabase = await getSupabase();
    const episodes = { ...(seed?.watchedEpisodes || {}) };
    // Chaves "_" são identidade da conta (nickname e contadores) e ficam só em `profiles`.
    Object.keys(episodes).forEach(key => { if (key.startsWith('_')) delete episodes[key]; });

    const { data, error } = await supabase
        .from('account_profiles')
        .insert({
            account_id: accountId,
            name: seed?.username || seed?.email?.split('@')[0] || 'Perfil 1',
            avatar: seed?.avatar || '1',
            is_main: true,
            favorites: seed?.favorites || [],
            history: seed?.history || [],
            watched_movies: seed?.watchedMovies || [],
            watched_episodes: episodes
        })
        .select(PROFILE_COLUMNS)
        .single();

    if (error) {
        console.error('❌ [Profiles] Falha ao criar perfil principal:', error.message);
        return null;
    }
    return data;
}

/**
 * Carrega os perfis da conta e resolve qual fica ativo. `seed` só é usado quando a conta
 * ainda não tem nenhum perfil — ver createMainProfile.
 */
export async function loadProfiles(accountId: string, seed: any = null): Promise<AccountProfile | null> {
    if (!accountId) return null;
    profilesStore.setKey('loading', true);

    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('account_profiles')
            .select(PROFILE_COLUMNS)
            .eq('account_id', accountId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        let profiles: AccountProfile[] = data || [];
        if (profiles.length === 0) {
            const created = await createMainProfile(accountId, seed);
            if (created) profiles = [created];
        }

        const storedId = readStoredActiveId();
        const active = profiles.find(p => p.id === storedId)
            || profiles.find(p => p.is_main)
            || profiles[0]
            || null;

        profilesStore.set({
            profiles,
            activeId: active?.id || null,
            loading: false,
            initialized: true
        });
        if (active) persistActiveId(active.id);
        return active;
    } catch (e: any) {
        console.error('❌ [Profiles] Falha ao carregar perfis:', e?.message);
        profilesStore.set({ profiles: [], activeId: null, loading: false, initialized: true });
        return null;
    }
}

/**
 * Perfil que a conta usa quando não tem (ou perdeu) o direito a múltiplos perfis.
 * Os extras continuam salvos no banco, só deixam de ser selecionáveis.
 */
export function getMainProfile(): AccountProfile | null {
    const { profiles } = profilesStore.get();
    return profiles.find(p => p.is_main) || profiles[0] || null;
}

/** Esquece o perfil escolhido neste aparelho — chamado no logout. */
export function clearActiveProfile() {
    persistActiveId(null);
    profilesStore.set({ profiles: [], activeId: null, loading: false, initialized: false });
}

export function setActiveProfile(id: string) {
    const { profiles } = profilesStore.get();
    if (!profiles.some(p => p.id === id)) return;
    persistActiveId(id);
    profilesStore.setKey('activeId', id);
}

export async function createProfile(accountId: string, input: { name: string; avatar?: string; isKids?: boolean }) {
    const { profiles } = profilesStore.get();
    if (profiles.length >= MAX_PERFIS_POR_CONTA) {
        return { success: false, error: `Limite de ${MAX_PERFIS_POR_CONTA} perfis por conta atingido.` };
    }

    const name = sanitizeProfileName(input.name);
    if (!name) return { success: false, error: 'O nome do perfil deve ter entre 2 e 20 caracteres.' };

    try {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('account_profiles')
            .insert({
                account_id: accountId,
                name,
                avatar: input.avatar || '1',
                is_kids: input.isKids === true
            })
            .select(PROFILE_COLUMNS)
            .single();

        if (error) throw error;
        profilesStore.setKey('profiles', [...profiles, data]);
        return { success: true, profile: data };
    } catch (e: any) {
        const isLimit = String(e?.message || '').includes('PROFILE_LIMIT_REACHED');
        return {
            success: false,
            error: isLimit ? `Limite de ${MAX_PERFIS_POR_CONTA} perfis por conta atingido.` : (e?.message || 'Erro ao criar perfil.')
        };
    }
}

export async function updateProfile(id: string, patch: { name?: string; avatar?: string; isKids?: boolean }) {
    const { profiles } = profilesStore.get();
    const update: any = {};

    if (patch.name !== undefined) {
        const name = sanitizeProfileName(patch.name);
        if (!name) return { success: false, error: 'O nome do perfil deve ter entre 2 e 20 caracteres.' };
        update.name = name;
    }
    if (patch.avatar !== undefined) update.avatar = patch.avatar;
    if (patch.isKids !== undefined) update.is_kids = patch.isKids;
    if (Object.keys(update).length === 0) return { success: true };

    try {
        const supabase = await getSupabase();
        const { error } = await supabase.from('account_profiles').update(update).eq('id', id);
        if (error) throw error;

        profilesStore.setKey('profiles', profiles.map(p => (p.id === id ? { ...p, ...update } : p)));
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || 'Erro ao salvar perfil.' };
    }
}

export async function deleteProfile(id: string) {
    const { profiles, activeId } = profilesStore.get();
    const target = profiles.find(p => p.id === id);
    if (!target) return { success: false, error: 'Perfil não encontrado.' };
    if (target.is_main) return { success: false, error: 'O perfil principal não pode ser excluído.' };

    try {
        const supabase = await getSupabase();
        const { error } = await supabase.from('account_profiles').delete().eq('id', id);
        if (error) throw error;

        const remaining = profiles.filter(p => p.id !== id);
        profilesStore.setKey('profiles', remaining);
        // Apagar o perfil aberto no momento cairia num estado sem perfil ativo: volta pro principal.
        if (activeId === id) {
            const fallback = remaining.find(p => p.is_main) || remaining[0];
            if (fallback) setActiveProfile(fallback.id);
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || 'Erro ao excluir perfil.' };
    }
}

function sanitizeProfileName(raw: string): string | null {
    const clean = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (clean.length < 2) return null;
    return clean;
}

if (typeof window !== 'undefined') {
    (window as any)._profilesStore = profilesStore;
}

// mobile/src/services/channelsService.ts
// Service for fetching, caching, and validating live TV channels

import { supabase } from './supabase';

export interface Channel {
  id: string;
  nome: string;
  imagem: string;
  url: string;
  categoria: string;
  isVIP?: boolean;
}

// Caching global para otimização extrema no mobile (SWR: Stale-While-Revalidate)
interface ChannelsState {
  canaisCache: Channel[] | null;
  cacheTimestamp: number;
  isUpdatingBackground: boolean;
  currentFetchPromise: Promise<Channel[]> | null;
  vipChannelsCache: string[] | null;
  vipCacheTimestamp: number;
  currentVipFetchPromise: Promise<string[]> | null;
}

// Singleton global para persistência em desenvolvimento/hot-reloads
const globalStateKey = '_bf_mobile_channels_state';
const getGlobalState = (): ChannelsState => {
  const g = globalThis as any;
  if (!g[globalStateKey]) {
    g[globalStateKey] = {
      canaisCache: null,
      cacheTimestamp: 0,
      isUpdatingBackground: false,
      currentFetchPromise: null,
      vipChannelsCache: null,
      vipCacheTimestamp: 0,
      currentVipFetchPromise: null
    };
  }
  return g[globalStateKey];
};

const state = getGlobalState();
const CACHE_TTL = 900000; // 15 minutos em milissegundos
const VIP_CACHE_TTL = 1800000; // 30 minutos (IDs VIP mudam raramente)

/**
 * Busca a lista de canais VIP do Supabase
 */
export async function fetchVipChannels(): Promise<string[]> {
  const agora = Date.now();
  
  // 1. OTIMIZAÇÃO EXTREMA: Retorna cache imediatamente se disponível e válido
  if (state.vipChannelsCache) {
    if (agora - state.vipCacheTimestamp >= VIP_CACHE_TTL && !state.isUpdatingBackground) {
      state.isUpdatingBackground = true;
      (async () => {
        try {
          const { data } = await supabase.from('vip_channels').select('channel_id');
          if (data && data.length > 0) {
            state.vipChannelsCache = data.map(r => String(r.channel_id));
            state.vipCacheTimestamp = Date.now();
          }
        } catch (e) {
          console.warn('[Service] Falha silenciosa na atualização de VIP em background:', e);
        } finally {
          state.isUpdatingBackground = false;
        }
      })();
    }
    return state.vipChannelsCache;
  }

  // Evita múltiplas chamadas concorrentes voltando a promessa atual
  if (state.currentVipFetchPromise) {
    return state.currentVipFetchPromise;
  }

  state.currentVipFetchPromise = (async () => {
    try {
      // Timeout de 10s: a Home dispara essa busca em paralelo com TMDB, canais e o
      // guia EPG (arquivo grande), então a conexão do celular pode ficar disputada.
      const fetchPromise = supabase.from('vip_channels').select('channel_id');
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout Supabase VIP')), 10000)
      );

      const result = await Promise.race([fetchPromise, timeoutPromise]);
      const data = (result as any).data;
      const error = (result as any).error;

      if (error) throw error;

      const vipIds = (data || []).map((r: any) => String(r.channel_id));
      state.vipChannelsCache = vipIds;
      state.vipCacheTimestamp = Date.now();
      return vipIds;
    } catch (err: any) {
      console.warn('⚠️ [Service] Falha ao sintonizar IDs VIPs. Usando fallback vazio:', err.message || err);
      return state.vipChannelsCache || [];
    } finally {
      state.currentVipFetchPromise = null;
    }
  })();

  return state.currentVipFetchPromise;
}

/**
 * Busca canais de um dos domínios da Superflix
 */
async function fetchSuperflixCanais(): Promise<Channel[]> {
  const domains = [
    'https://superflixapi.pro',
    'https://superflixapi.online',
    'https://superflixapi.buzz',
    'https://superflixapi.asia'
  ];

  const categories = ['canais', 'channels', 'channel', 'canal'];

  // Para o mobile, tentamos os domínios em sequência. Em caso de sucesso, paramos
  for (const domain of domains) {
    for (const cat of categories) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const url = `${domain}/lista?category=${cat}&format=json`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 MultiCanaisHDMobile'
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const responseData = await response.json();
          let rawItems: any[] = [];

          if (Array.isArray(responseData)) rawItems = responseData;
          else if (responseData && Array.isArray(responseData.data)) rawItems = responseData.data;
          else if (responseData && Array.isArray(responseData.channels)) rawItems = responseData.channels;
          else if (responseData && Array.isArray(responseData.canais)) rawItems = responseData.canais;
          else if (responseData && Array.isArray(responseData.list)) rawItems = responseData.list;

          if (rawItems.length > 0) {
            const formatted = rawItems
              .filter(c => c.is_active !== false)
              .map(c => ({
                id: String(c.id || c.channel_id || Math.random()),
                nome: String(c.name || c.nome || "Canal TV"),
                imagem: String(c.logo_url || c.logo || c.imagem || "https://superflixapi.online/placeholder.jpg"),
                url: String(c.embed_url || c.embed || c.url || ""),
                categoria: String(c.category || c.categoria || "Geral")
              }));

            if (formatted.length > 0) {
              console.log(`✅ [Service] Canais recuperados de ${domain} (${cat}): ${formatted.length} itens.`);
              return formatted;
            }
          }
        }
      } catch (e: any) {
        // Silencioso para tentar o próximo domínio/categoria
      }
    }
  }

  throw new Error('Nenhum canal recuperado da API');
}

/**
 * Busca a lista completa de canais (API com fallback estático)
 */
export async function fetchCanais(): Promise<Channel[]> {
  const agora = Date.now();

  // 1. Stale-While-Revalidate: Se temos cache, retorna na hora e atualiza em background!
  if (state.canaisCache) {
    if (agora - state.cacheTimestamp >= CACHE_TTL && !state.isUpdatingBackground) {
      state.isUpdatingBackground = true;
      (async () => {
        try {
          const apiCanais = await fetchSuperflixCanais();
          if (apiCanais && apiCanais.length > 0) {
            state.canaisCache = apiCanais;
            state.cacheTimestamp = Date.now();
            console.log(`📡 [Service] Cache atualizado em background: ${apiCanais.length} canais.`);
          }
        } catch (e) {
          console.warn('[Service] Falha silenciosa de atualização em background:', e);
        } finally {
          state.isUpdatingBackground = false;
        }
      })();
    }
    return state.canaisCache;
  }

  // Evita chamadas de inicialização simultâneas
  if (state.currentFetchPromise) {
    return state.currentFetchPromise;
  }

  console.log('📡 [Service] Cold Start. Buscando canais de TV ao vivo com timeout estrito...');

  state.currentFetchPromise = (async () => {
    try {
      // Dispara a busca
      const apiCanais = await fetchSuperflixCanais();
      
      state.canaisCache = apiCanais;
      state.cacheTimestamp = Date.now();
      return apiCanais;
    } catch (e: any) {
      console.warn('⚠️ [Service] Falha crítica nas APIs de Canais:', e.message || e);
      // Sem fallback estático: propaga o erro para a UI tratar (estado de erro + retry)
      throw e;
    } finally {
      state.currentFetchPromise = null;
    }
  })();

  return state.currentFetchPromise;
}

/**
 * Retorna um canal específico pelo ID
 */
export async function getCanalById(id: string): Promise<Channel | null> {
  const canais = await fetchCanais();
  return canais.find(c => String(c.id) === String(id)) || null;
}

/**
 * Retorna as categorias únicas encontradas na lista de canais
 */
export function getCategoriasUnicas(channels: Channel[]): string[] {
  const categoriasSet = new Set<string>();
  
  channels.forEach(c => {
    if (c.categoria) {
      const trimmed = c.categoria.trim();
      // Não inclui a categoria de Jogos Ao Vivo se misturada
      if (trimmed.toLowerCase() !== "⚽ jogos ao vivo" && trimmed.toLowerCase() !== "jogos ao vivo") {
        categoriasSet.add(trimmed);
      }
    }
  });

  return Array.from(categoriasSet).sort();
}

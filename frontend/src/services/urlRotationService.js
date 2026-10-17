// src/services/urlRotationService.js
import { supabaseAdmin } from './supabase.js';
import { getTMDBDetails } from './tmdb.js';
import { slugDeDetalhes } from '../utils/canonicalSlug.js';

// Cache em memória RAM L1 para evitar consultas excessivas no SSR
if (!globalThis._bf_url_rotations) {
    globalThis._bf_url_rotations = {
        byMedia: new Map(), // key: `${type}:${id}` -> { activeSlug, mediaTitle, ... }
        lastFetch: 0
    };
}
const cache = globalThis._bf_url_rotations;
const CACHE_TTL = 30000; // 30s

/**
 * SQL de criação/migração da tabela caso não exista.
 *
 * Os `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ficam no MESMO script do CREATE de propósito:
 * o projeto NÃO tem canal de DDL em runtime (supabase-js não executa DDL e não existe RPC de
 * exec_sql), então a única superfície de migração é o SQL Editor do Supabase — e é exatamente
 * este texto que o painel /moderacao exibe. Rodar o script numa tabela que já existe é seguro
 * e idempotente, então instalações antigas ganham as colunas de EN no mesmo comando.
 */
export const URL_ROTATIONS_SQL = `
CREATE TABLE IF NOT EXISTS url_rotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
    media_title TEXT,
    original_slug TEXT NOT NULL,
    current_slug TEXT NOT NULL,
    rotation_count INTEGER DEFAULT 1,
    original_slug_en TEXT,
    current_slug_en TEXT,
    rotation_count_en INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migração de instalações anteriores à rotação por idioma (idempotente).
ALTER TABLE url_rotations ADD COLUMN IF NOT EXISTS original_slug_en TEXT;
ALTER TABLE url_rotations ADD COLUMN IF NOT EXISTS current_slug_en TEXT;
ALTER TABLE url_rotations ADD COLUMN IF NOT EXISTS rotation_count_en INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_url_rotations_media 
ON url_rotations (media_id, media_type);

CREATE INDEX IF NOT EXISTS idx_url_rotations_current_slug 
ON url_rotations (current_slug);

CREATE INDEX IF NOT EXISTS idx_url_rotations_current_slug_en 
ON url_rotations (current_slug_en);
`;

// Colunas que a MELHORIA 1 introduziu. Usado para reconhecer o erro do PostgREST quando a
// migração acima ainda não rodou no Supabase (PGRST204 / 42703).
const COLUNAS_IDIOMA = ['original_slug_en', 'current_slug_en', 'rotation_count_en'];

/** Normaliza o idioma: parâmetro explícito ganha, valor desconhecido cai em pt, omitido detecta pela URL. */
export function resolverIdioma(lang, input = '') {
    const explicito = typeof lang === 'string' ? lang.trim().toLowerCase() : '';
    if (explicito === 'pt' || explicito === 'en') return explicito;
    // Valor presente mas inválido nunca vira rotação "aleatória": cai no idioma padrão.
    if (explicito) return 'pt';
    return /\/en\//i.test(String(input || '')) ? 'en' : 'pt';
}

/** O erro é "coluna de idioma ausente"? Então falta rodar o SQL de migração. */
export function erroDeColunaAusente(error) {
    if (error?.code === '42703' || error?.code === 'PGRST204') return true;
    const mensagem = String(error?.message || '');
    return COLUNAS_IDIOMA.some((coluna) => mensagem.includes(coluna));
}

function erroComMigracao(error) {
    if (!erroDeColunaAusente(error)) return error;
    const aviso = new Error("Colunas de rotação por idioma ausentes em 'url_rotations'. Rode o SQL exibido no painel.");
    aviso.needMigration = true;
    aviso.cause = error;
    return aviso;
}

/**
 * A tabela já aceita as colunas de EN? Conferido uma vez por isolate com um select barato, para
 * o painel avisar o operador ANTES de ele tentar rotacionar uma URL inglesa e falhar.
 * Nunca lança e nunca converte erro alheio (tabela ausente, rede) em erro de migração.
 */
export async function colunasIdiomaProntas() {
    if (globalThis._bf_url_rotations_lang !== undefined) return globalThis._bf_url_rotations_lang;
    try {
        const { error } = await supabaseAdmin
            .from('url_rotations')
            .select('current_slug_en, rotation_count_en')
            .limit(1);
        if (!error) {
            globalThis._bf_url_rotations_lang = true;
            return true;
        }
        if (!erroDeColunaAusente(error)) return true;
        globalThis._bf_url_rotations_lang = false;
        return false;
    } catch (e) {
        return true;
    }
}

/**
 * Normaliza uma URL ou slug inserido pelo usuário
 * Extrai media_id, media_type (movie/series), slug base
 */
export function parseInputUrlOrSlug(input) {
    if (!input || typeof input !== 'string') return null;
    let clean = input.trim();
    if (!clean) return null;

    // Normalização de formatos de ofuscação comuns do Google/Lumen Database:
    // 1. hxxps:// ou hxxp:// -> https:// ou http://
    clean = clean.replace(/^hxxp(s?):\/\//i, 'http$1://');
    // 2. dom[.]com ou dom(.)com -> dom.com
    clean = clean.replace(/\[\.\]/g, '.').replace(/\(\.\)/g, '.');
    // 3. Entidades HTML em query params: &amp; -> &
    clean = clean.replace(/&amp;/g, '&');

    let path = clean;
    try {
        if (clean.startsWith('http://') || clean.startsWith('https://')) {
            const parsed = new URL(clean);
            path = parsed.pathname;
        } else if (clean.includes('?')) {
            path = clean.split('?')[0];
        }
    } catch (e) {
        path = clean.split('?')[0];
    }

    // Remove hash e query params residuais
    path = path.split('#')[0].split('?')[0];

    // Remove prefixo de idioma se existir (ex: /en/filme/...)
    path = path.replace(/^\/en\//, '/').replace(/^\/+/, '');

    // Formato com rota: filme/123-nome ou serie/123-nome
    let mediaType = null;
    let slugPart = path;

    if (path.startsWith('filme/') || path.startsWith('movie/')) {
        mediaType = 'movie';
        slugPart = path.replace(/^(filme|movie)\//, '');
    } else if (path.startsWith('serie/') || path.startsWith('series/') || path.startsWith('tv/')) {
        mediaType = 'series';
        slugPart = path.replace(/^(serie|series|tv)\//, '');
    }

    // Extrair ID numérico do início do slug (ex: 1234-matrix-1)
    const match = slugPart.match(/^(\d+)(?:-(.*))?$/);
    if (!match) {
        // Se só passou o ID
        if (/^\d+$/.test(slugPart)) {
            return {
                mediaId: slugPart,
                mediaType: mediaType || 'movie',
                slug: slugPart,
                tail: ''
            };
        }
        return null;
    }

    const mediaId = match[1];
    const tail = match[2] || '';

    return {
        mediaId,
        mediaType: mediaType || 'movie', // default movie se não especificado na URL
        slug: slugPart,
        tail
    };
}

/**
 * Carrega todas as rotações ativas para a memória (L1 Cache)
 */
export async function syncRotationsCache(force = false) {
    const now = Date.now();
    if (!force && cache.lastFetch && (now - cache.lastFetch < CACHE_TTL)) {
        return cache.byMedia;
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('url_rotations')
            .select('*')
            .order('updated_at', { ascending: false });

        if (!error && Array.isArray(data)) {
            cache.byMedia.clear();
            for (const item of data) {
                cache.byMedia.set(`${item.media_type}:${item.media_id}`, item);
            }
            cache.lastFetch = now;
        }
    } catch (e) {
        console.warn('[urlRotationService] Erro ao sincronizar cache L1:', e.message);
    }

    return cache.byMedia;
}

/**
 * Consulta se há rotação ativa para a mídia (usado nas rotas /filme/[slug] e /serie/[slug])
 */
export async function getActiveRotation(mediaId, mediaType) {
    if (!mediaId || !mediaType) return null;
    const typeKey = mediaType === 'tv' ? 'series' : mediaType;
    const key = `${typeKey}:${mediaId}`;

    // Tenta cache L1
    if (cache.byMedia.has(key)) {
        return cache.byMedia.get(key);
    }

    // Se cache expirou ou item não está em cache, tenta sincronizar
    await syncRotationsCache();
    return cache.byMedia.get(key) || null;
}

/**
 * Resolve o slug canônico de uma mídia considerando rotação Anti-DMCA ativa — usado em toda
 * rota/lista que gera um link interno (página, links de episódio, recomendações) pra nunca
 * apontar de volta pro slug que foi denunciado/removido.
 */
export async function resolveRotatedSlug(mediaId, mediaType, fallbackSlug, lang = 'pt') {
    try {
        const activeRotation = await getActiveRotation(mediaId, mediaType);
        if (resolverIdioma(lang) === 'en') {
            return activeRotation?.current_slug_en || fallbackSlug;
        }
        return activeRotation?.current_slug || fallbackSlug;
    } catch (e) {
        return fallbackSlug;
    }
}

function rotaDoTipo(mediaType) {
    return mediaType === 'series' ? 'serie' : 'filme';
}

/** Detalhes do TMDB no idioma pedido — falha nunca aborta a rotação (só perde o título canônico). */
async function detalhesDoIdioma(mediaId, tmdbType, idioma) {
    try {
        return await getTMDBDetails(mediaId, tmdbType, idioma);
    } catch (e) {
        console.warn(`[urlRotationService] Erro ao buscar TMDB (${idioma}) para ${mediaId}:`, e.message);
        return null;
    }
}

function slugBaseCanonico(mediaId, tmdbInfo, idioma, fallbackSlug) {
    return tmdbInfo ? slugDeDetalhes(mediaId, tmdbInfo, idioma) : fallbackSlug;
}

function normalizarCustomSlug(customSlug, mediaId) {
    let clean = customSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    // Sem o prefixo do ID a rota não consegue mais extrair a obra do slug.
    if (!clean.startsWith(`${mediaId}-`)) clean = `${mediaId}-${clean}`;
    return clean;
}

async function buscarRotacao(mediaId, mediaType) {
    try {
        const { data } = await supabaseAdmin
            .from('url_rotations')
            .select('*')
            .eq('media_id', String(mediaId))
            .eq('media_type', mediaType)
            .maybeSingle();
        return data || null;
    } catch (e) {
        return null;
    }
}

/** Base/contador do idioma que está sendo rotacionado (cada idioma tem seu próprio contador). */
function estadoDoIdioma(idioma, existente, baseCanonicalSlug) {
    if (idioma === 'en') {
        return {
            originalSlug: existente?.original_slug_en || baseCanonicalSlug,
            previousSlug: existente?.current_slug_en || baseCanonicalSlug,
            rotationCount: (existente?.rotation_count_en || 0) + 1,
        };
    }
    return {
        originalSlug: existente?.original_slug || baseCanonicalSlug,
        previousSlug: existente?.current_slug || baseCanonicalSlug,
        rotationCount: (existente?.rotation_count || 0) + 1,
    };
}

/**
 * Base canônica do PT para gravar na linha.
 *
 * Numa rotação EN sem linha prévia, original_slug/current_slug são NOT NULL e precisam receber o
 * canônico PT DE VERDADE — chutar o slug que veio na entrada criaria um current_slug diferente
 * do canônico da rota /filme|/serie, e a página passaria a fazer 301 contra si mesma (laço).
 */
async function baseCanonicaPt({ idioma, existente, mediaId, tmdbType, baseCanonicalSlug, fallbackSlug }) {
    if (idioma === 'pt') return baseCanonicalSlug;
    if (existente?.original_slug) return existente.original_slug;
    const infoPt = await detalhesDoIdioma(mediaId, tmdbType, 'pt');
    return slugBaseCanonico(mediaId, infoPt, 'pt', fallbackSlug);
}

function montarRegistro({ mediaId, mediaType, title, idioma, existente, campos, nextSlug, basePt }) {
    const registro = {
        media_id: String(mediaId),
        media_type: mediaType,
        media_title: title,
        // Colunas PT: reinterpretadas quando o idioma é pt, preservadas quando é en.
        original_slug: existente?.original_slug || basePt,
        current_slug: existente?.current_slug || basePt,
        rotation_count: existente?.rotation_count || 0,
        updated_at: new Date().toISOString(),
    };
    if (idioma === 'en') {
        registro.original_slug_en = campos.originalSlug;
        registro.current_slug_en = nextSlug;
        registro.rotation_count_en = campos.rotationCount;
        return registro;
    }
    registro.original_slug = campos.originalSlug;
    registro.current_slug = nextSlug;
    registro.rotation_count = campos.rotationCount;
    return registro;
}

async function salvarRotacao(registro) {
    try {
        const { data, error } = await supabaseAdmin
            .from('url_rotations')
            .upsert(registro, { onConflict: 'media_id,media_type' })
            .select()
            .single();
        if (error) throw error;
        return data;
    } catch (error) {
        throw erroComMigracao(error);
    }
}

/**
 * Executa a rotação de uma obra. `lang` decide QUAL idioma rotaciona: 'pt' mexe nas colunas
 * originais, 'en' nas colunas _en (slug calculado a partir do título em inglês do TMDB).
 * O upsert continua por (media_id, media_type) — a obra tem uma linha só, com os dois idiomas.
 */
export async function rotateMediaUrl({ input, customSlug, forcedType = null, lang }) {
    const parsed = parseInputUrlOrSlug(input);
    if (!parsed) {
        throw new Error(`Entrada inválida: "${input}". Envie a URL da obra ou o slug com ID (ex: 603-matrix).`);
    }

    const idioma = resolverIdioma(lang, input);
    const mediaId = parsed.mediaId;
    const mediaType = forcedType || parsed.mediaType || 'movie';
    const tmdbType = mediaType === 'series' ? 'tv' : 'movie';

    const tmdbInfo = await detalhesDoIdioma(mediaId, tmdbType, idioma);
    const title = tmdbInfo?.title || tmdbInfo?.name || `Mídia ${mediaId}`;
    const baseCanonicalSlug = slugBaseCanonico(mediaId, tmdbInfo, idioma, parsed.slug);
    const existente = await buscarRotacao(mediaId, mediaType);
    const campos = estadoDoIdioma(idioma, existente, baseCanonicalSlug);

    // Sempre a partir do slug ORIGINAL + contador de rotação — nunca faz parsing do sufixo
    // numérico do slug anterior. Título com número (Blade Runner 2049, 1917, Stranger Things 4)
    // faria esse parsing incrementar o próprio ano/número do título em vez de anexar um sufixo.
    const nextSlug = customSlug?.trim()
        ? normalizarCustomSlug(customSlug, mediaId)
        : `${campos.originalSlug}-${campos.rotationCount}`;

    const basePt = await baseCanonicaPt({
        idioma, existente, mediaId, tmdbType, baseCanonicalSlug, fallbackSlug: parsed.slug,
    });
    const registro = montarRegistro({ mediaId, mediaType, title, idioma, existente, campos, nextSlug, basePt });
    const saved = await salvarRotacao(registro);

    // Upsert grava o objeto inteiro: o cache L1 precisa do `saved` (linha completa) pra não
    // perder as colunas do outro idioma depois de uma rotação.
    cache.byMedia.set(`${mediaType}:${mediaId}`, saved || registro);

    const prefixo = idioma === 'en' ? '/en' : '';
    return {
        success: true,
        mediaId,
        mediaType,
        mediaTitle: title,
        lang: idioma,
        previousSlug: campos.previousSlug,
        newSlug: nextSlug,
        rotationCount: campos.rotationCount,
        fullUrl: `${prefixo}/${rotaDoTipo(mediaType)}/${nextSlug}`
    };
}

/**
 * Lista o histórico recente de rotações
 */
export async function listRotations() {
    const { data, error } = await supabaseAdmin
        .from('url_rotations')
        .select('*')
        .order('updated_at', { ascending: false });

    if (error) {
        throw error;
    }

    return data || [];
}

/**
 * Remove / reverte uma rotação
 */
export async function deleteRotation(id) {
    // Buscar antes para limpar cache
    const { data: item } = await supabaseAdmin
        .from('url_rotations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    const { error } = await supabaseAdmin
        .from('url_rotations')
        .delete()
        .eq('id', id);

    if (error) throw error;

    if (item) {
        cache.byMedia.delete(`${item.media_type}:${item.media_id}`);
    }

    return true;
}

/**
 * Limpa todo o histórico de rotações
 */
export async function clearAllRotations() {
    const { error } = await supabaseAdmin
        .from('url_rotations')
        .delete()
        .neq('media_id', '0'); // remove all

    if (error) throw error;

    cache.byMedia.clear();
    cache.lastFetch = Date.now();
    return true;
}

// src/services/env-adapter.js

/**
 * Esse adaptador resolve um problema comum da Cloudflare Pages + Astro:
 * As variáveis de ambiente definidas no painel da Cloudflare ficam presas no 
 * contexto da requisição (Astro.locals) e não são visíveis para serviços (arquivos .js/.ts puros).
 */

const runtimeEnv = {
    data: {}
};

function isValidEnvValue(val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') {
        const clean = val.replace(/^["']|["']$/g, '').trim();
        return clean !== '' && clean !== 'undefined' && clean !== 'null' && !clean.includes('placeholder');
    }
    return true;
}

export function setRuntimeEnv(env) {
    if (env && typeof env === 'object') {
        runtimeEnv.data = { ...runtimeEnv.data, ...env };
        if (typeof globalThis !== 'undefined') {
            globalThis._bf_runtime_env = { ...(globalThis._bf_runtime_env || {}), ...env };
        }
    }
}

// Permite que serviços fora do contexto da requisição (ex: superflix-ids.js) registrem
// promessas em background com o waitUntil real do Worker. Sem isso, a Cloudflare pode
// encerrar o isolate assim que a resposta é enviada, matando updates de cache "fire-and-forget"
// antes de terminarem — o catálogo nunca chegava a ser regravado no KV depois de expirar.
let runtimeWaitUntil = null;

export function setRuntimeWaitUntil(fn) {
    if (typeof fn === 'function') runtimeWaitUntil = fn;
}

export function getRuntimeWaitUntil() {
    return runtimeWaitUntil;
}

export function getEnv(key, defaultValue = null) {
    let value = null;

    // 1. Tenta process.env (Mais confiável em ambiente Node/Windows Dev)
    try {
        if (typeof process !== 'undefined' && process.env && process.env[key]) {
            const val = process.env[key];
            if (isValidEnvValue(val)) value = val;
        }
    } catch (e) {}

    // 2. Tenta o ambiente injetado pelo middleware (Runtime Cloudflare)
    if (!isValidEnvValue(value) && runtimeEnv.data[key]) {
        const val = runtimeEnv.data[key];
        if (isValidEnvValue(val)) value = val;
    }

    // 3. Tenta o ambiente global compartilhado (Cloudflare Workers Advanced / Isolates)
    if (!isValidEnvValue(value) && typeof globalThis !== 'undefined' && globalThis._bf_runtime_env && globalThis._bf_runtime_env[key]) {
        const val = globalThis._bf_runtime_env[key];
        if (isValidEnvValue(val)) value = val;
    }

    // 4. Tenta import.meta.env (Build-time / Local Dev fallback)
    if (!isValidEnvValue(value) && typeof import.meta !== 'undefined' && import.meta.env) {
        let val = null;
        if (key === 'PUBLIC_SUPABASE_URL') {
            val = import.meta.env.PUBLIC_SUPABASE_URL;
        } else if (key === 'PUBLIC_SUPABASE_ANON_KEY') {
            val = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
        } else if (key === 'PUBLIC_CLOUDFLARE_BEACON_TOKEN') {
            val = import.meta.env.PUBLIC_CLOUDFLARE_BEACON_TOKEN;
        } else if (key === 'KEY_API_TMDB') {
            val = import.meta.env.KEY_API_TMDB;
        } else if (key === 'TMDB_API_KEY') {
            val = import.meta.env.TMDB_API_KEY;
        } else if (key === 'REDIS_URL') {
            val = import.meta.env.REDIS_URL;
        } else {
            val = import.meta.env[key];
        }
        if (isValidEnvValue(val)) value = val;
    }

    // 5. Tenta Global puro fallback
    if (!isValidEnvValue(value) && typeof globalThis !== 'undefined' && globalThis[key]) {
        const val = globalThis[key];
        if (isValidEnvValue(val)) value = val;
    }

    // Sanitização final
    if (typeof value === 'string') {
        value = value.replace(/^["']|["']$/g, '').trim();
    }

    return isValidEnvValue(value) ? value : defaultValue;
}

const DEFAULT_SITE_URL = 'https://multicanaishd.lol';

/**
 * Fonte única de verdade para a origin canônica do site (usada em canonical/hreflang,
 * JSON-LD, sitemap, indexação, links de afiliado, etc). Centralizado aqui para que uma
 * futura troca de domínio exija mudar só a env var SITE_URL, não ~25 arquivos.
 */
export function getSiteUrl(requestUrl) {
    const envOriginRaw =
        getEnv('SITE_URL') ||
        getEnv('PUBLIC_SITE_URL') ||
        getEnv('APP_URL') ||
        getEnv('CANONICAL_SITE_URL') ||
        getEnv('MULTICANAISHD_SITE_URL');

    const normalize = (value) => {
        if (!value) return '';
        const raw = String(value).trim();
        if (!raw) return '';
        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try { return new URL(withProtocol).origin; } catch { return ''; }
    };

    const fromEnv = normalize(envOriginRaw);
    if (fromEnv) return fromEnv;

    if (!requestUrl) return DEFAULT_SITE_URL;

    let fromReq = '';
    try { fromReq = new URL(requestUrl).origin; } catch { fromReq = ''; }
    if (!fromReq) return DEFAULT_SITE_URL;

    try {
        const host = new URL(fromReq).hostname.toLowerCase();
        if (
            host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
            host.endsWith('.local') || host.endsWith('.pages.dev')
        ) return DEFAULT_SITE_URL;
    } catch {}

    return fromReq;
}


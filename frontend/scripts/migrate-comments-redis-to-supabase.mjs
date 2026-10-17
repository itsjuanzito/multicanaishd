// Script one-off: migra comentários antigos do Redis (Upstash) para a tabela `comments` do Supabase.
// Uso: node scripts/migrate-comments-redis-to-supabase.mjs
// Lê credenciais de .env / .env.local na pasta frontend/.

import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(path) {
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadEnvFile(new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
loadEnvFile(new URL('../.env.local', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const REDIS_URL = process.env.UPTASH_REDIS_URL_KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPTASH_REDIS_URL_KV_REST_API_TOKEN;
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!REDIS_URL || !REDIS_TOKEN) {
    console.error('Faltam UPTASH_REDIS_URL_KV_REST_API_URL / UPTASH_REDIS_URL_KV_REST_API_TOKEN no .env');
    process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
}

const MAX_RETRIES = 6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function redisCommand(command, attempt = 1) {
    const res = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
        body: JSON.stringify(command)
    });
    const data = await res.json();

    if (data.error) {
        const isQuotaError = /max requests limit|quota/i.test(data.error);
        if (attempt >= MAX_RETRIES) {
            throw new Error(`Redis error após ${attempt} tentativas: ${data.error}`);
        }
        const delayMs = Math.min(5000 * 2 ** (attempt - 1), 5 * 60 * 1000); // até 5 minutos
        console.warn(
            `${isQuotaError ? 'Cota do Redis excedida' : 'Erro no Redis'} (tentativa ${attempt}/${MAX_RETRIES}). ` +
            `Tentando novamente em ${Math.round(delayMs / 1000)}s...`
        );
        await sleep(delayMs);
        return redisCommand(command, attempt + 1);
    }

    return data.result;
}

async function scanAllKeys(pattern) {
    let cursor = '0';
    const keys = [];
    do {
        const result = await redisCommand(['scan', cursor, 'MATCH', pattern, 'COUNT', 100]);
        cursor = result[0];
        keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
    console.log('Buscando chaves comments:* no Redis...');
    const keys = await scanAllKeys('comments:*');
    console.log(`Encontradas ${keys.length} chaves (uma por contentId).`);

    // Redis lpush prepend cada mensagem, então geramos ids -> uuid mapeados para preservar threads (parentId antigo -> novo id)
    const idMap = new Map();
    const rowsToInsert = [];

    for (const key of keys) {
        const contentId = key.replace(/^comments:/, '');
        const raw = await redisCommand(['lrange', key, 0, -1]);
        for (const item of raw) {
            let parsed;
            try { parsed = JSON.parse(item); } catch (e) { continue; }
            rowsToInsert.push({ contentId, parsed });
        }
    }

    console.log(`Total de ${rowsToInsert.length} comentários a migrar.`);
    if (rowsToInsert.length === 0) {
        console.log('Nada para migrar.');
        return;
    }

    // Insere pais primeiro (parentId null), depois replies, para poder remapear parent_id -> uuid novo
    rowsToInsert.sort((a, b) => (a.parsed.parentId ? 1 : 0) - (b.parsed.parentId ? 1 : 0));

    let migrated = 0, skipped = 0;
    for (const { contentId, parsed } of rowsToInsert) {
        const newParentId = parsed.parentId ? (idMap.get(parsed.parentId) || null) : null;

        const { data, error } = await supabase
            .from('comments')
            .insert({
                content_id: contentId,
                user_name: (parsed.user || 'Anônimo').substring(0, 30),
                text: (parsed.text || '').substring(0, 1000),
                parent_id: newParentId,
                page_url: parsed.pageUrl || null,
                created_at: parsed.date || new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error(`Falha ao inserir comentário antigo id=${parsed.id} (contentId=${contentId}):`, error.message);
            skipped++;
            continue;
        }

        idMap.set(parsed.id, data.id);
        migrated++;
    }

    console.log(`Concluído. Migrados: ${migrated}. Ignorados por erro: ${skipped}.`);
}

main().catch(err => {
    console.error('Erro fatal na migração:', err);
    process.exit(1);
});

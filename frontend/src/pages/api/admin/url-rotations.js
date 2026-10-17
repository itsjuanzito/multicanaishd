// src/pages/api/admin/url-rotations.js
import { setRuntimeEnv } from "../../../services/env-adapter.js";
import { 
    rotateMediaUrl, 
    listRotations, 
    deleteRotation, 
    clearAllRotations,
    syncRotationsCache,
    colunasIdiomaProntas,
    URL_ROTATIONS_SQL 
} from "../../../services/urlRotationService.js";
import { getEnv } from "../../../services/env-adapter.js";
import { invalidarCacheSitemap } from "../../../services/sitemapService.js";

export const prerender = false;

// Verificação de Autorização (Padrão 4 Camadas / Token de Moderação)
function checkAuth(request, urlObj) {
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');
    const token = request.headers.get("Authorization")?.replace("Bearer ", "") || urlObj.searchParams.get("token");
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return false;
    }
    return true;
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const urlObj = new URL(request.url);
    if (!checkAuth(request, urlObj)) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 });
    }

    try {
        const forceSync = urlObj.searchParams.get("sync") === "true";
        if (forceSync) {
            await syncRotationsCache(true);
        }

        const rotations = await listRotations();
        // A rotação por idioma depende de colunas criadas por ALTER TABLE, e não há canal de DDL
        // em runtime (ver URL_ROTATIONS_SQL). Se a migração ainda não rodou, o painel precisa
        // mostrar o SQL ANTES de o operador tentar rotacionar uma URL inglesa e falhar.
        const langReady = await colunasIdiomaProntas();
        return new Response(JSON.stringify({ 
            success: true, 
            rotations: rotations || [],
            needLangMigration: !langReady,
            sql: langReady ? undefined : URL_ROTATIONS_SQL.trim()
        }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    } catch (error) {
        // Se a tabela ainda não existir no Supabase, retorna instrução amigável de SQL
        if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
            return new Response(JSON.stringify({ 
                error: "Tabela 'url_rotations' não existe no banco de dados.",
                needMigration: true,
                sql: URL_ROTATIONS_SQL.trim()
            }), { 
                status: 200, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        console.error("[URL Rotations API] Error GET:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const urlObj = new URL(request.url);
    if (!checkAuth(request, urlObj)) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 });
    }

    try {
        const body = await request.json();
        const { input, customSlug, forcedType, batch, lang } = body;

        // Se for processamento em lote
        if (Array.isArray(batch) && batch.length > 0) {
            const results = [];
            const errors = [];

            for (const item of batch) {
                const line = typeof item === 'string' ? item.trim() : (item?.url || '').trim();
                if (!line) continue;
                try {
                    const res = await rotateMediaUrl({
                        input: line,
                        customSlug: item?.customSlug || '',
                        forcedType: item?.type || forcedType || null,
                        // Idioma por item (lote misto pt/en) com o do lote como padrão. Sem
                        // nenhum dos dois, rotateMediaUrl detecta pelo /en/ da entrada.
                        lang: item?.lang || lang || undefined
                    });
                    results.push(res);
                } catch (err) {
                    errors.push({ input: line, error: err.message });
                }
            }

            // Sem isto, a nova URL só chegava ao sitemap depois de até 6h (TTL do cache) —
            // tempo de sobra pro Google já ter recrawleado o sitemap velho e não achar nada.
            if (results.length > 0) await invalidarCacheSitemap(request.url);

            return new Response(JSON.stringify({
                success: true,
                batch: true,
                total: batch.length,
                rotated: results.length,
                results,
                errors
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Rotação individual
        if (!input) {
            return new Response(JSON.stringify({ error: "Parâmetro 'input' (URL ou slug) é obrigatório." }), { status: 400 });
        }

        const result = await rotateMediaUrl({
            input,
            customSlug,
            forcedType,
            lang
        });

        // Idem: invalida o cache do sitemap na hora, pra rotação não ficar até 6h invisível
        // pro Googlebot antes de a nova URL sequer ser anunciada.
        await invalidarCacheSitemap(request.url);

        return new Response(JSON.stringify({
            success: true,
            result
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        // Coluna de idioma ausente = a migração (ALTER TABLE) ainda não rodou. Devolve o script
        // com 200 em vez de 5xx/erro cru, para o painel exibir a caixa de migração.
        if (error.needMigration) {
            return new Response(JSON.stringify({
                error: error.message,
                needMigration: true,
                sql: URL_ROTATIONS_SQL.trim()
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
            return new Response(JSON.stringify({ 
                error: "Tabela 'url_rotations' não existe no banco de dados.",
                needMigration: true,
                sql: URL_ROTATIONS_SQL.trim()
            }), { 
                status: 200, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        console.error("[URL Rotations API] Error POST:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export async function DELETE({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const urlObj = new URL(request.url);
    if (!checkAuth(request, urlObj)) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const { id, clearAll } = body;

        if (clearAll) {
            await clearAllRotations();
            await invalidarCacheSitemap(request.url);
            return new Response(JSON.stringify({ success: true, message: "Histórico limpo com sucesso." }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (!id) {
            return new Response(JSON.stringify({ error: "ID da rotação não informado." }), { status: 400 });
        }

        await deleteRotation(id);
        await invalidarCacheSitemap(request.url);
        return new Response(JSON.stringify({ success: true, message: "Rotação removida." }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("[URL Rotations API] Error DELETE:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

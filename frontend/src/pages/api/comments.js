import { supabaseAdmin, supabase } from "../../services/supabase.js";
import { fetchWithTimeout } from "../../services/fetch-util";
import { getEnv } from "../../services/env-adapter.js";

const DISCORD_WEBHOOK = getEnv('DISCORD_WEBHOOK_COMMENTS') || getEnv('DISCORD_WEBHOOK_URL');

export const prerender = false;

// SQL da migração — a coluna user_id é o que amarra o comentário a uma conta real. Sem ela o
// comentário guardava só um nome digitado à mão, que qualquer um podia forjar.
export const COMMENTS_IDENTITY_SQL = `
ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments (user_id);
`;

function isMissingColumnError(error) {
    const msg = String(error?.message || '');
    return error?.code === '42703' || error?.code === 'PGRST204' || msg.includes('user_id');
}

function toClientShape(row) {
    return {
        id: row.id,
        // `user` continua sendo o nome de exibição, mas agora vem do perfil quando o
        // comentário tem dono; user_name fica como retrato pra comentários legados.
        user: row.user_name,
        userId: row.user_id || null,
        nickname: null,
        avatar: null,
        isLegacy: !row.user_id,
        text: row.text,
        date: row.created_at,
        parentId: row.parent_id,
        pageUrl: row.page_url,
        contentId: row.content_id
    };
}

/**
 * Preenche nome, @nickname e avatar a partir do perfil ATUAL de quem comentou.
 *
 * Os dados de identidade não são copiados para a linha do comentário de propósito: quem troca
 * de avatar ou de nome de exibição espera que isso valha para tudo que já postou. O custo é
 * uma consulta a mais por listagem, sobre o conjunto de autores distintos (não por comentário).
 */
async function attachAuthorIdentity(comments) {
    const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))];
    if (userIds.length === 0) return comments;

    let profiles = [];
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, username, avatar, watched_episodes')
            .in('id', userIds);
        if (error) throw error;
        profiles = data || [];
    } catch (e) {
        console.warn("[Comments] Falha ao carregar identidade dos autores:", e.message);
        return comments;
    }

    const byId = new Map();
    for (const p of profiles) {
        // O nickname mora dentro do JSONB watched_episodes._nickname (mesmo lugar que o
        // ranking e o perfil leem).
        const nickname = p.watched_episodes?._nickname || null;
        byId.set(p.id, {
            user: p.username || nickname || "Membro MultiCanaisHD",
            nickname,
            avatar: p.avatar || '1'
        });
    }

    return comments.map((c) => {
        const profile = c.userId ? byId.get(c.userId) : null;
        return profile ? { ...c, ...profile } : c;
    });
}

export async function GET({ request }) {
    const url = new URL(request.url);
    const contentId = url.searchParams.get("contentId");
    const isModeration = url.searchParams.get("moderation") === "true";
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

    if (!isModeration && !contentId) {
        return new Response(JSON.stringify({ error: "contentId is required" }), { status: 400 });
    }

    if (isModeration) {
        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        try {
            const { data, error } = await supabaseAdmin
                .from('comments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) throw error;

            const shaped = await attachAuthorIdentity((data || []).map(toClientShape));
            return new Response(JSON.stringify({ comments: shaped }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
            });
        } catch (error) {
            console.error("GET Comments (moderation) Supabase Error:", error.message);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('comments')
            .select('*')
            .eq('content_id', contentId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const shaped = await attachAuthorIdentity((data || []).map(toClientShape));

        return new Response(JSON.stringify({ comments: shaped }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                // Antes era no-store absoluto, o que é forte demais pra uma lista de
                // comentários: cada visita repetida ao mesmo título ia até o Supabase. Uma
                // janela curta é invisível pro usuário — e quem acabou de comentar não
                // depende dela, o cliente refaz a busca com cache-buster nesse caso
                // (ver load(true) em scripts/BetterComments.js).
                "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
            }
        });
    } catch (error) {
        console.error("GET Comments Supabase Error:", error.message);
        return new Response(JSON.stringify({ comments: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    }
}

export async function POST({ request }) {
    const jsonHeaders = { "Content-Type": "application/json" };

    try {
        const body = await request.json();
        const { contentId, text, hp, parentId } = body;

        if (hp) return new Response(JSON.stringify({ message: "Bot detected" }), { status: 200 });

        if (!contentId || !text) {
            return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: jsonHeaders });
        }

        // Identidade vem do token, NUNCA do corpo da requisição. Antes o nome era um campo de
        // texto livre sem nenhuma verificação no servidor: o gate de VIP existia só no cliente
        // (escondia o formulário), então bastava um POST direto pra publicar com o nome de
        // qualquer pessoa.
        const authHeader = request.headers.get('Authorization');
        const accessToken = authHeader?.replace(/^Bearer\s+/i, '').trim();
        if (!accessToken) {
            return new Response(JSON.stringify({ error: "É preciso entrar na conta para comentar." }), { status: 401, headers: jsonHeaders });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Sessão inválida ou expirada." }), { status: 401, headers: jsonHeaders });
        }

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, username, avatar, watched_episodes, is_vip, vip_until')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: "Perfil não encontrado." }), { status: 404, headers: jsonHeaders });
        }

        const isVIP = profile.is_vip === true && (!profile.vip_until || new Date(profile.vip_until) > new Date());
        if (!isVIP) {
            return new Response(JSON.stringify({ error: "Comentários são exclusivos para assinantes VIP." }), { status: 403, headers: jsonHeaders });
        }

        const nickname = profile.watched_episodes?._nickname || null;
        const displayName = profile.username || nickname || "Membro MultiCanaisHD";
        const cleanText = text.substring(0, 1000).replace(/[<>]/g, "");
        const currentUrl = request.headers.get("referer") || "";

        let insertedRow;
        try {
            const { data, error } = await supabaseAdmin
                .from('comments')
                .insert({
                    content_id: contentId,
                    user_id: profile.id,
                    user_name: displayName,
                    text: cleanText,
                    parent_id: parentId || null,
                    page_url: currentUrl
                })
                .select()
                .single();

            if (error) throw error;
            insertedRow = data;
        } catch (error) {
            if (isMissingColumnError(error)) {
                return new Response(JSON.stringify({
                    error: "A coluna 'user_id' ainda não existe na tabela comments.",
                    needMigration: true,
                    sql: COMMENTS_IDENTITY_SQL.trim()
                }), { status: 500, headers: jsonHeaders });
            }
            console.error("POST Comments Supabase Insert Error:", error.message);
            return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
        }

        if (DISCORD_WEBHOOK) {
            try {
                await fetchWithTimeout(DISCORD_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        embeds: [{
                            title: "💬 Novo Comentário",
                            color: 16733525,
                            fields: [
                                { name: "Usuário", value: nickname ? `${displayName} (@${nickname})` : displayName, inline: true },
                                { name: "Conteúdo", value: contentId, inline: true },
                                { name: "Texto", value: cleanText },
                                { name: "Link", value: currentUrl }
                            ],
                            timestamp: new Date().toISOString()
                        }]
                    }),
                    timeout: 5000
                });
            } catch (discordError) {}
        }

        const comment = {
            ...toClientShape(insertedRow),
            user: displayName,
            nickname,
            avatar: profile.avatar || '1'
        };

        return new Response(JSON.stringify({ success: true, comment }), {
            status: 200,
            headers: jsonHeaders
        });
    } catch (error) {
        console.error("POST Comments Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
}

export async function DELETE({ request }) {
    try {
        const body = await request.json();
        const { contentId, commentId, token } = body;
        const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        if (!contentId || !commentId) {
            return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('comments')
            .delete()
            .eq('id', commentId)
            .eq('content_id', contentId)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return new Response(JSON.stringify({ error: "Comment not found" }), { status: 404 });
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
        console.error("DELETE Comments Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

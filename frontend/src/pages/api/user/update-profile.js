import { supabaseAdmin } from "../../../services/supabase.js";
import { setRuntimeEnv } from "../../../services/env-adapter.js";
import { isVipAtivo, resolvePlano, isPlanoDiamond } from "../../../services/vipPlans.js";

export const prerender = false;

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
    });

const sanitizeUsername = (value) =>
    String(value || "").trim().replace(/[^a-zA-Z0-9áéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ_ ]/g, "");

const sanitizeNickname = (value) =>
    String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }

    try {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
        if (!token) {
            return json({ success: false, error: "Não autorizado." }, 401);
        }

        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return json({ success: false, error: "Sessão inválida." }, 401);
        }

        const body = await request.json().catch(() => ({}));
        const action = body?.action;

        if (action === "username") {
            const username = sanitizeUsername(body.username);
            if (username.length < 2 || username.length > 25) {
                return json({ success: false, error: "O nome de exibição deve ter entre 2 e 25 caracteres." }, 400);
            }

            const { data: existing, error: checkError } = await supabaseAdmin
                .from("profiles")
                .select("id")
                .ilike("username", username)
                .neq("id", user.id)
                .limit(1);

            if (checkError) throw checkError;
            if (existing?.length) {
                return json({ success: false, error: "Este nome de exibição já está sendo usado por outro usuário." }, 409);
            }

            const { error: updateError } = await supabaseAdmin
                .from("profiles")
                .update({ username })
                .eq("id", user.id);

            if (updateError) throw updateError;
            return json({ success: true, username });
        }

        if (action === "nickname") {
            const nickname = sanitizeNickname(body.nickname);
            if (nickname.length < 3 || nickname.length > 20) {
                return json({ success: false, error: "O nickname deve ter entre 3 e 20 caracteres (apenas letras minúsculas, números e sublinhados)." }, 400);
            }

            const { data: profile, error: profileError } = await supabaseAdmin
                .from("profiles")
                // `vip_plan` não existe: pedi-la fazia este SELECT falhar por inteiro e
                // toda troca de nickname respondia "Perfil não encontrado".
                .select("id, watched_episodes, is_vip, vip_until")
                .eq("id", user.id)
                .single();

            if (profileError || !profile) {
                return json({ success: false, error: "Perfil não encontrado." }, 404);
            }

            const { data: existing, error: checkError } = await supabaseAdmin
                .from("profiles")
                .select("id")
                .eq("watched_episodes->>_nickname", nickname)
                .neq("id", user.id)
                .limit(1);

            if (checkError) throw checkError;
            if (existing?.length) {
                return json({ success: false, error: "Este nickname já está sendo usado por outro usuário." }, 409);
            }

            const watchedEpisodes = profile.watched_episodes && typeof profile.watched_episodes === "object"
                ? { ...profile.watched_episodes }
                : {};

            const isVipActive = isVipAtivo(profile);

            // O plano vem do último pagamento aprovado (ver services/vipPlans.js).
            let latestPaymentAmount = null;
            try {
                const { data: latestPayment } = await supabaseAdmin
                    .from("payments")
                    .select("amount")
                    .eq("user_id", user.id)
                    .eq("status", "paid")
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                latestPaymentAmount = latestPayment?.amount ?? null;
            } catch (payErr) {
                console.warn("[UpdateProfile] Falha ao ler pagamentos:", payErr.message);
            }

            const isDiamond = isPlanoDiamond(resolvePlano(profile, latestPaymentAmount));
            const standardCount = Number.parseInt(watchedEpisodes._nickname_changes_count || "0", 10) || 0;
            const vipCount = Number.parseInt(watchedEpisodes._vip_nickname_changes_count || "0", 10) || 0;
            const currentCount = isVipActive ? vipCount : standardCount;
            const limit = isVipActive ? (isDiamond ? Infinity : 5) : 1;

            if (currentCount >= limit) {
                const error = !isVipActive
                    ? "Membros Standard podem alterar o nickname apenas 1 vez. Adquira o VIP para liberar mais alterações!"
                    : `Você já atingiu o limite de ${limit} alterações para o plano VIP Básico. Faça upgrade para o Diamond para alterações ilimitadas!`;
                return json({ success: false, error }, 403);
            }

            const updatedEpisodes = {
                ...watchedEpisodes,
                _nickname: nickname,
                _nickname_changes_count: String(isVipActive ? standardCount : standardCount + 1),
                _vip_nickname_changes_count: String(isVipActive ? vipCount + 1 : vipCount),
            };

            const { error: updateError } = await supabaseAdmin
                .from("profiles")
                .update({ watched_episodes: updatedEpisodes })
                .eq("id", user.id);

            if (updateError) throw updateError;

            return json({
                success: true,
                nickname,
                watchedEpisodes: updatedEpisodes,
                nicknameChanges: currentCount + 1,
            });
        }

        return json({ success: false, error: "Ação inválida." }, 400);
    } catch (err) {
        console.error("[Update Profile API] Error:", err);
        return json({ success: false, error: err?.message || "Erro inesperado." }, 500);
    }
}

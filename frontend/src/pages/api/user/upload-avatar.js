import { supabaseAdmin } from "../../../services/supabase";
import { resolvePlano, isPlanoDiamond, podeCriarPerfis } from "../../../services/vipPlans.js";

export const prerender = false;

export async function POST({ request }) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const token = formData.get('token');

        if (!file || !token) {
            return new Response(JSON.stringify({ error: "Missing file or token" }), { status: 400 });
        }

        // 1. Validar Token de Autenticação do Usuário
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
        }

        // 2. Buscar perfil para validar nível de acesso VIP
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404 });
        }

        // Validar VIP Ativo
        const isVIP = profile.is_vip && (!profile.vip_until || new Date(profile.vip_until) > new Date());
        if (!isVIP) {
            return new Response(JSON.stringify({ error: "MultiCanaisHD VIP membership required." }), { status: 403 });
        }

        // Validar se é plano DIAMOND através do último pagamento aprovado
        const { data: latestPayment } = await supabaseAdmin
            .from('payments')
            .select('amount')
            .eq('user_id', user.id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // A regra sai de vipPlans.js e não de uma lista de valores escrita aqui: quando o
        // Black entrou, esta comparação ainda listava só os três valores do Diamond e
        // rejeitava com 403 justamente o tier mais caro do site.
        const plano = resolvePlano(profile, latestPayment?.amount ?? null);
        if (!isPlanoDiamond(plano)) {
            return new Response(JSON.stringify({ error: "O upload de fotos e GIFs customizados é exclusivo do MultiCanaisHD VIP Diamond! 💎" }), { status: 403 });
        }

        // Upload para um perfil da conta (MultiCanaisHD VIP Black) em vez do avatar da conta.
        // A dona da linha é conferida no banco — o profileId chega do cliente.
        const profileId = formData.get('profileId');
        let alvoPerfil = null;
        if (profileId) {
            if (!podeCriarPerfis(plano)) {
                return new Response(JSON.stringify({ error: "Múltiplos perfis são exclusivos do MultiCanaisHD VIP Black." }), { status: 403 });
            }
            const { data: linha } = await supabaseAdmin
                .from('account_profiles')
                .select('id, avatar')
                .eq('id', profileId)
                .eq('account_id', user.id)
                .maybeSingle();
            if (!linha) {
                return new Response(JSON.stringify({ error: "Perfil não encontrado." }), { status: 404 });
            }
            alvoPerfil = linha;
        }

        // 3. Validar arquivo (Tamanho e Tipo)
        const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return new Response(JSON.stringify({ error: "Tipo de arquivo não suportado. Use PNG, JPG, WEBP ou GIF." }), { status: 400 });
        }

        const sizeLimit = 10 * 1024 * 1024; // 10MB
        if (file.size > sizeLimit) {
            return new Response(JSON.stringify({ error: "O arquivo excede o limite permitido de 10MB." }), { status: 400 });
        }

        // 4. Upload para o Supabase Storage usando o service role (Bypass RLS)
        const arrayBuffer = await file.arrayBuffer();
        const extension = file.name.split('.').pop() || 'png';
        const fileName = `custom/${user.id}-${Date.now()}.${extension}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from('avatars')
            .upload(fileName, arrayBuffer, {
                contentType: file.type,
                cacheControl: '3600',
                upsert: true
            });

        if (uploadError) throw uploadError;

        // 5. Obter URL pública
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('avatars')
            .getPublicUrl(fileName);

        const publicUrl = publicUrlData?.publicUrl;
        if (!publicUrl) {
            throw new Error("Failed to get public URL of uploaded file");
        }

        // 6. Remover a foto/GIF customizada antiga do bucket (se existir) para liberar espaço de armazenamento e economizar custos de nuvem
        const oldAvatarUrl = alvoPerfil ? alvoPerfil.avatar : profile.avatar;
        if (oldAvatarUrl && oldAvatarUrl.includes('/storage/v1/object/public/avatars/')) {
            try {
                const parts = oldAvatarUrl.split('/avatars/');
                if (parts.length > 1) {
                    const oldFilePath = parts[1];
                    console.log(`🧹 [Storage Cleanup] Removendo arquivo de avatar antigo do bucket: ${oldFilePath}`);
                    const { error: removeError } = await supabaseAdmin.storage
                        .from('avatars')
                        .remove([oldFilePath]);
                    if (removeError) {
                        console.warn("⚠️ [Storage Cleanup] Alerta ao remover arquivo antigo do bucket:", removeError.message);
                    } else {
                        console.log("✅ [Storage Cleanup] Arquivo antigo removido com sucesso!");
                    }
                }
            } catch (cleanupErr) {
                console.warn("⚠️ [Storage Cleanup] Erro não-bloqueante na limpeza de arquivos antigos:", cleanupErr);
            }
        }

        // 7. Atualizar a coluna avatar (da conta ou do perfil escolhido)
        const { error: updateError } = alvoPerfil
            ? await supabaseAdmin
                .from('account_profiles')
                .update({ avatar: publicUrl })
                .eq('id', alvoPerfil.id)
                .eq('account_id', user.id)
            : await supabaseAdmin
                .from('profiles')
                .update({ avatar: publicUrl })
                .eq('id', user.id);

        if (updateError) throw updateError;

        return new Response(JSON.stringify({ success: true, publicUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error("❌ [Upload API] Error processing upload:", e);
        return new Response(JSON.stringify({ error: e.message || "Internal server error" }), { status: 500 });
    }
}

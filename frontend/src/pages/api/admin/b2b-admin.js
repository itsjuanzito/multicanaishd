// src/pages/api/admin/b2b-admin.js
import { getEnv, setRuntimeEnv } from "../../../services/env-adapter.js";
import { supabaseAdmin } from "../../../services/supabase.js";
import { axiomService } from "../../../services/axiom-service.js";
import { isValidWhitelistEntry } from "../../../services/b2bLicenseService.js";

export const prerender = false;

// Função robusta de sanitização de domínio e aplicativo móvel (Pilar 2 & 3)
function sanitizeDomain(domain) {
    if (!domain) return "";
    let clean = domain.trim().toLowerCase();
    
    // Se for um link/esquema completo de app móvel (ex: android-app://com.company.app)
    if (clean.includes('://')) {
        const parts = clean.split('://');
        const scheme = parts[0];
        const body = parts[1].split('/')[0].split(':')[0];
        if (['android-app', 'capacitor', 'ionic', 'app'].includes(scheme)) {
            const sanitizedBody = body.replace(/[^a-z0-9.-]/g, '');
            return sanitizedBody ? `app:${sanitizedBody}` : '';
        }
    }
    
    // Se começar com prefixo explícito de app:
    let isApp = false;
    if (clean.startsWith('app:')) {
        isApp = true;
        clean = clean.substring(4);
    }
    
    // Tratar como domínio normal
    clean = clean
        .replace(/^(https?:\/\/)?(www\.)?/, '')
        .split('/')[0]
        .split(':')[0]
        .replace(/[^a-z0-9.-]/g, '');
        
    if (!clean) return "";
    return isApp ? `app:${clean}` : clean;
}

export async function GET({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() || "";
    const token = url.searchParams.get("token");
    const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');
    const jsonHeaders = { "Content-Type": "application/json" };

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
    }

    try {
        let userIds = [];
        let profilesMap = {};

        // 1. Resolver perfis se houver uma consulta
        if (query) {
            // Busca por e-mail ou username no profiles
            const { data: matchedProfiles } = await supabaseAdmin
                .from('profiles')
                .select('id, email, username')
                .or(`email.ilike.%${query}%,username.ilike.%${query}%,id.eq.${query.length === 36 ? query : '00000000-0000-0000-0000-000000000000'}`);

            if (matchedProfiles && matchedProfiles.length > 0) {
                userIds = matchedProfiles.map(p => p.id);
                for (const p of matchedProfiles) {
                    profilesMap[p.id] = p;
                }
            }
        }

        // 2. Construir query em developer_licenses
        let licensesQuery = supabaseAdmin.from('developer_licenses').select('*');

        if (query) {
            if (userIds.length > 0) {
                // Se encontramos usuários, busca por user_id ou por chave de licença / domínios
                licensesQuery = licensesQuery.or(`user_id.in.(${userIds.map(id => `"${id}"`).join(',')}),license_key.ilike.%${query}%,allowed_domain.ilike.%${query}%`);
            } else {
                // Senão, busca apenas por chave de licença ou domínio diretamente
                licensesQuery = licensesQuery.or(`license_key.ilike.%${query}%,allowed_domain.ilike.%${query}%`);
            }
        }

        const { data: licenses, error: dbError } = await licensesQuery.order('created_at', { ascending: false });

        if (dbError) throw dbError;

        // 3. Preencher perfis ausentes para mapear na listagem (Pilar 4 - Paralelização Inteligente)
        const missingUserIds = (licenses || [])
            .map(lic => lic.user_id)
            .filter(id => id && !profilesMap[id]);

        if (missingUserIds.length > 0) {
            const { data: extraProfiles } = await supabaseAdmin
                .from('profiles')
                .select('id, email, username')
                .in('id', missingUserIds);

            if (extraProfiles) {
                for (const p of extraProfiles) {
                    profilesMap[p.id] = p;
                }
            }
        }

        // Mapear resultado completo
        const licensesWithProfiles = (licenses || []).map(lic => ({
            ...lic,
            profile: profilesMap[lic.user_id] || { email: "Anônimo", username: "anonimo" }
        }));

        return new Response(JSON.stringify({ success: true, licenses: licensesWithProfiles }), { status: 200, headers: jsonHeaders });

    } catch (error) {
        console.error("❌ [B2B Admin API] GET Error:", error);
        axiomService.logError(error, { rota: "/api/admin/b2b-admin", method: "GET" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
}

export async function POST({ request, locals }) {
    if (locals?.runtime?.env) {
        setRuntimeEnv(locals.runtime.env);
    }
    const jsonHeaders = { "Content-Type": "application/json" };

    try {
        const body = await request.json();
        const { action, token } = body;
        const ADMIN_TOKEN = getEnv('ADMIN_MODERATION_TOKEN');

        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
        }

        // --- AÇÃO: CRIAR/CONCEDER LICENÇA ATIVA MANUALMENTE ---
        if (action === 'create') {
            const { emailOrId, allowed_domains, plan: planInput } = body;
            const plan = planInput === 'direct' ? 'direct' : 'embed';

            if (!emailOrId || !allowed_domains) {
                return new Response(JSON.stringify({ error: "E-mail/ID do usuário e domínios são obrigatórios." }), { status: 400, headers: jsonHeaders });
            }

            // 1. Localizar o perfil do usuário
            const { data: profile, error: findProfileError } = await supabaseAdmin
                .from('profiles')
                .select('id, email')
                .or(`email.eq.${emailOrId.trim()},id.eq.${emailOrId.trim().length === 36 ? emailOrId.trim() : '00000000-0000-0000-0000-000000000000'}`)
                .maybeSingle();

            if (findProfileError || !profile) {
                return new Response(JSON.stringify({ error: "Usuário não encontrado. Certifique-se de que ele já possui cadastro no site." }), { status: 404, headers: jsonHeaders });
            }

            // 2. Sanitizar os domínios/apps
            const cleanedList = allowed_domains
                .split(',')
                .map(sanitizeDomain)
                .filter(isValidWhitelistEntry);

            if (cleanedList.length === 0) {
                return new Response(JSON.stringify({ error: "Por favor, insira ao menos um domínio válido." }), { status: 400, headers: jsonHeaders });
            }

            const finalAllowedDomains = cleanedList.join(', ');

            // 3. Gerar a chave criptograficamente segura (Web Crypto API resiliente)
            const randomBytesArray = new Uint8Array(12);
            if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
                globalThis.crypto.getRandomValues(randomBytesArray);
            } else {
                for (let i = 0; i < 12; i++) {
                    randomBytesArray[i] = Math.floor(Math.random() * 256);
                }
            }
            const generatedLicenseKey = `bf_dev_${Array.from(randomBytesArray).map(b => b.toString(16).padStart(2, '0')).join('')}`;

            // 4. Inserir no banco
            const { data: newLicense, error: insertError } = await supabaseAdmin
                .from('developer_licenses')
                .insert({
                    user_id: profile.id,
                    license_key: generatedLicenseKey,
                    allowed_domain: finalAllowedDomains,
                    status: 'active',
                    plan,
                    expires_at: null // manual/vitalício por padrão
                })
                .select()
                .single();

            if (insertError) {
                console.error("❌ [B2B Admin API] Erro ao inserir licença:", insertError.message);
                return new Response(JSON.stringify({ error: "Erro interno ao cadastrar licença no banco." }), { status: 500, headers: jsonHeaders });
            }

            return new Response(JSON.stringify({
                success: true,
                message: "Licença B2B gerada ativamente com sucesso!",
                license: { ...newLicense, profile }
            }), { status: 201, headers: jsonHeaders });
        }

        // --- AÇÕES COM LICENÇAS EXISTENTES ---
        const { licenseId } = body;
        if (!licenseId) {
            return new Response(JSON.stringify({ error: "ID da licença ausente." }), { status: 400, headers: jsonHeaders });
        }

        if (action === 'revoke') {
            const { error: deleteError } = await supabaseAdmin
                .from('developer_licenses')
                .delete()
                .eq('id', licenseId);

            if (deleteError) throw deleteError;

            return new Response(JSON.stringify({ success: true, message: "Licença revogada e excluída permanentemente." }), { status: 200, headers: jsonHeaders });
        }

        if (action === 'suspend') {
            const { error: updateError } = await supabaseAdmin
                .from('developer_licenses')
                .update({ status: 'suspended' })
                .eq('id', licenseId);

            if (updateError) throw updateError;

            return new Response(JSON.stringify({ success: true, message: "Licença suspensa com sucesso." }), { status: 200, headers: jsonHeaders });
        }

        if (action === 'activate') {
            // Se estiver pendente, removemos o prefixo PEND_PAY do domínio
            const { data: currentLic } = await supabaseAdmin
                .from('developer_licenses')
                .select('allowed_domain')
                .eq('id', licenseId)
                .single();

            let realDomains = currentLic?.allowed_domain || "";
            if (realDomains.startsWith('PEND_PAY:')) {
                const parts = realDomains.split(':');
                realDomains = parts.slice(2).join(':') || '';
            }

            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30); // 30 dias se ativado manualmente

            const { error: updateError } = await supabaseAdmin
                .from('developer_licenses')
                .update({ 
                    status: 'active',
                    allowed_domain: realDomains,
                    expires_at: expiresAt.toISOString()
                })
                .eq('id', licenseId);

            if (updateError) throw updateError;

            return new Response(JSON.stringify({ success: true, message: "Licença ativada com sucesso." }), { status: 200, headers: jsonHeaders });
        }

        if (action === 'edit_domains') {
            const { allowed_domains } = body;
            if (!allowed_domains) {
                return new Response(JSON.stringify({ error: "Os domínios autorizados são obrigatórios." }), { status: 400, headers: jsonHeaders });
            }

            const cleanedList = allowed_domains
                .split(',')
                .map(sanitizeDomain)
                .filter(isValidWhitelistEntry);

            if (cleanedList.length === 0) {
                return new Response(JSON.stringify({ error: "Por favor, insira ao menos um domínio válido." }), { status: 400, headers: jsonHeaders });
            }

            const finalAllowedDomains = cleanedList.join(', ');

            const { error: updateError } = await supabaseAdmin
                .from('developer_licenses')
                .update({ allowed_domain: finalAllowedDomains })
                .eq('id', licenseId);

            if (updateError) throw updateError;

            return new Response(JSON.stringify({ success: true, message: "Domínios da licença atualizados pelo administrador." }), { status: 200, headers: jsonHeaders });
        }

        return new Response(JSON.stringify({ error: "Ação desconhecida." }), { status: 400, headers: jsonHeaders });

    } catch (error) {
        console.error("❌ [B2B Admin API] POST Error:", error);
        axiomService.logError(error, { rota: "/api/admin/b2b-admin", method: "POST" }).catch(() => {});
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
}

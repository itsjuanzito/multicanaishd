-- Migration: profile_identity_protection
-- Description:
-- A policy "Users can insert/update own profile" libera todas as colunas de profiles para o
-- próprio usuário, então dava pra pular /api/user/update-profile (que checa unicidade e limite
-- de trocas) e gravar direto via PostgREST:
--   - username / watched_episodes._nickname iguais aos de outra pessoa (impersonação nos
--     comentários e sequestro do link de perfil, que pega o primeiro match);
--   - _nickname_changes_count zerado (trocas ilimitadas sem VIP).
--
-- Regra para anon/authenticated:
--   - identidade já definida → preserva OLD (troca só via API, que usa service_role);
--   - identidade vazia → pode definir UMA vez (cadastro / nickname automático do primeiro login),
--     se válida e não usada por outro perfil; contadores sempre começam em '0'.
--
-- Execute este script no Supabase Dashboard → SQL Editor.

CREATE OR REPLACE FUNCTION public.protect_profile_identity_fields()
RETURNS TRIGGER AS $$
DECLARE
    v_old_eps JSONB := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.watched_episodes::jsonb, '{}'::jsonb) ELSE '{}'::jsonb END;
    v_new_eps JSONB := COALESCE(NEW.watched_episodes::jsonb, '{}'::jsonb);
    v_old_nick TEXT := NULLIF(v_old_eps->>'_nickname', '');
    v_new_nick TEXT := lower(NULLIF(v_new_eps->>'_nickname', ''));
    v_old_username TEXT := CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(OLD.username, '') ELSE NULL END;
    v_identity_keys TEXT[] := ARRAY['_nickname', '_nickname_changes_count', '_vip_nickname_changes_count', '_active_seconds'];
BEGIN
    IF (current_setting('role', true) NOT IN ('authenticated', 'anon')) THEN
        RETURN NEW;
    END IF;

    -- Chaves de identidade saem do que o cliente mandou e são reconstruídas abaixo.
    v_new_eps := v_new_eps - v_identity_keys;

    IF v_old_nick IS NOT NULL THEN
        v_new_eps := v_new_eps || jsonb_strip_nulls(jsonb_build_object(
            '_nickname', v_old_eps->'_nickname',
            '_nickname_changes_count', v_old_eps->'_nickname_changes_count',
            '_vip_nickname_changes_count', v_old_eps->'_vip_nickname_changes_count',
            '_active_seconds', v_old_eps->'_active_seconds'
        ));
    ELSIF v_new_nick IS NOT NULL
        AND v_new_nick ~ '^[a-z0-9_]{3,20}$'
        AND NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id <> NEW.id AND lower(p.watched_episodes->>'_nickname') = v_new_nick
        ) THEN
        v_new_eps := v_new_eps || jsonb_build_object(
            '_nickname', v_new_nick,
            '_nickname_changes_count', '0',
            '_vip_nickname_changes_count', '0'
        );
    END IF;

    NEW.watched_episodes := v_new_eps;

    -- Primeira definição do username (nome de exibição) fica livre: o cadastro nunca exigiu
    -- unicidade dele e já há nomes repetidos legítimos. A identidade única é o @nickname.
    IF v_old_username IS NOT NULL THEN
        NEW.username := OLD.username;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_profile_identity_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_identity_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_identity_fields();

-- Função de trigger não deve ser chamável via rpc().
REVOKE EXECUTE ON FUNCTION public.protect_profile_identity_fields() FROM PUBLIC, anon, authenticated;

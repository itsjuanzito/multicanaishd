-- Migration: ranking_watch_time_protection
-- Description:
-- Fecha três falhas que permitiam inflar o tempo do ranking (caso "Membro MultiCanaisHD" com 277.8h):
-- 1. O cliente (chave anon/authenticated) conseguia gravar active_seconds / ranking_active_seconds
--    direto na tabela profiles via PostgREST.
-- 2. increment_watch_time é SECURITY DEFINER e recebia p_user_id/p_seconds livres — qualquer um
--    podia chamar via rpc() com qualquer valor para qualquer usuário.
-- 3. O heartbeat não tinha intervalo mínimo: spam de POST somava 60s a cada chamada.
--
-- Execute este script no Supabase Dashboard → SQL Editor.

-- =========================================================================
-- PART 1: Colunas de tempo só podem ser alteradas pelo servidor (service_role)
-- =========================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_watch_heartbeat_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.protect_profile_watch_time_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF (current_setting('role', true) IN ('authenticated', 'anon')) THEN
        IF (TG_OP = 'INSERT') THEN
            NEW.active_seconds := NULL;
            NEW.ranking_active_seconds := NULL;
            NEW.last_watch_heartbeat_at := NULL;
        ELSIF (TG_OP = 'UPDATE') THEN
            -- Preserva silenciosamente em vez de dar erro, pra não derrubar o sync de
            -- favoritos/histórico de clientes antigos que ainda mandam esses campos.
            NEW.active_seconds := OLD.active_seconds;
            NEW.ranking_active_seconds := OLD.ranking_active_seconds;
            NEW.last_watch_heartbeat_at := OLD.last_watch_heartbeat_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_watch_time_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_watch_time_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_watch_time_fields();

-- =========================================================================
-- PART 2: increment_watch_time com intervalo mínimo e só executável pelo servidor
-- =========================================================================

CREATE OR REPLACE FUNCTION public.increment_watch_time(p_user_id UUID, p_seconds INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_active_seconds INT;
BEGIN
    -- Teto por ping + intervalo mínimo de 50s: spam de requisições não soma nada.
    UPDATE profiles
    SET
        active_seconds = COALESCE(active_seconds, 0) + LEAST(GREATEST(p_seconds, 0), 60),
        ranking_active_seconds = COALESCE(ranking_active_seconds, 0) + LEAST(GREATEST(p_seconds, 0), 60),
        last_watch_heartbeat_at = now()
    WHERE id = p_user_id
      AND (last_watch_heartbeat_at IS NULL OR last_watch_heartbeat_at <= now() - INTERVAL '50 seconds')
    RETURNING active_seconds INTO v_new_active_seconds;

    IF v_new_active_seconds IS NULL THEN
        SELECT active_seconds INTO v_new_active_seconds FROM profiles WHERE id = p_user_id;
    END IF;

    RETURN v_new_active_seconds;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_watch_time(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_watch_time(UUID, INT) TO service_role;

-- Desfaz o grant antigo de scratch/supabase_ranking_update.sql
REVOKE UPDATE (ranking_active_seconds) ON public.profiles FROM authenticated;

-- Migration: security_fixes_vip_and_rate_limit
-- Description: 
-- 1. Prevents standard clients (using anon/authenticated keys) from self-escalating to VIP.
-- 2. Implements a database-level signup rate limiter to prevent bulk account creation.
--
-- Run this script in the Supabase Dashboard → SQL Editor.
-- Execute este script no Supabase Dashboard → SQL Editor.

-- =========================================================================
-- PART 1: Protect VIP columns in public.profiles
-- =========================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_vip_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if request is coming from a client-facing role (anon or authenticated)
    -- In Supabase, standard client requests operate under these roles.
    IF (current_setting('role', true) IN ('authenticated', 'anon')) THEN
        IF (TG_OP = 'INSERT') THEN
            -- Force new profiles to have VIP fields set to false/null
            NEW.is_vip := FALSE;
            NEW.vip_until := NULL;
        ELSIF (TG_OP = 'UPDATE') THEN
            -- Prevent changing VIP fields (preserve existing values)
            NEW.is_vip := OLD.is_vip;
            NEW.vip_until := OLD.vip_until;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply trigger to public.profiles table
DROP TRIGGER IF EXISTS trg_protect_profile_vip_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_vip_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_vip_fields();


-- =========================================================================
-- PART 2: Database-level Signup Rate Limiter on auth.users
-- =========================================================================

-- Create a table in public schema to track signup attempts by IP address
CREATE TABLE IF NOT EXISTS public.signup_rate_limits (
    ip_address TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 1,
    last_attempt TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on the rate limits tracker table for safety
ALTER TABLE public.signup_rate_limits ENABLE ROW LEVEL SECURITY;

-- Allow read-only/no operations for standard roles on the rate limits tracker table
DROP POLICY IF EXISTS "signup_rate_limits_service_role_only" ON public.signup_rate_limits;
CREATE POLICY "signup_rate_limits_service_role_only" ON public.signup_rate_limits
    FOR ALL
    TO service_role
    USING (true);


-- Trigger function to check signup rate limit based on client IP
CREATE OR REPLACE FUNCTION public.check_signup_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_ip TEXT;
    v_count INTEGER;
    v_last TIMESTAMPTZ;
BEGIN
    -- 1. Extract IP address from request headers exposed by PostgREST
    BEGIN
        v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
        -- Fallback to Cloudflare client IP if available
        IF v_ip IS NULL THEN
            v_ip := current_setting('request.headers', true)::json->>'cf-connecting-ip';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_ip := 'unknown';
    END;

    -- If the IP contains a comma (due to multiple proxies), get the first IP in the chain
    IF v_ip LIKE '%,%' THEN
        v_ip := split_part(v_ip, ',', 1);
        v_ip := trim(v_ip);
    END IF;

    -- 2. Skip rate limiting if IP is unknown or context is administrative (service_role)
    IF v_ip IS NULL OR v_ip = 'unknown' OR current_setting('role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- 3. Clean up expired limit records (older than 1 hour) to keep the table small
    DELETE FROM public.signup_rate_limits WHERE last_attempt < now() - INTERVAL '1 hour';

    -- 4. Check if client IP already has attempts recorded
    SELECT attempts, last_attempt INTO v_count, v_last
    FROM public.signup_rate_limits
    WHERE ip_address = v_ip;

    IF v_count IS NOT NULL THEN
        -- Limit rule: Max 5 signups per hour per IP address
        IF v_count >= 5 THEN
            RAISE EXCEPTION 'Limite de cadastro excedido. Tente novamente mais tarde (máx. 5 cadastros por hora por IP).' 
                USING ERRCODE = 'check_violation';
        ELSE
            -- Increment attempts and refresh last attempt timestamp
            UPDATE public.signup_rate_limits
            SET attempts = attempts + 1, last_attempt = now()
            WHERE ip_address = v_ip;
        END IF;
    ELSE
        -- Insert new record for IP address
        INSERT INTO public.signup_rate_limits (ip_address, attempts, last_attempt)
        VALUES (v_ip, 1, now());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users table (BEFORE INSERT)
DROP TRIGGER IF EXISTS trg_signup_rate_limit ON auth.users;
CREATE TRIGGER trg_signup_rate_limit
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.check_signup_rate_limit();

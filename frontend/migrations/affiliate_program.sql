-- Migration: affiliate_program
-- Adds affiliate/referral program support to MultiCanaisHD profiles and payments.
-- Adiciona suporte ao programa de afiliados nos perfis e pagamentos do MultiCanaisHD.
--
-- Run this in the Supabase Dashboard → SQL Editor.
-- Execute no Supabase Dashboard → SQL Editor.

-- 1. Affiliate code column on profiles
-- Coluna de código de afiliado nos perfis
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS affiliate_code TEXT UNIQUE;

-- 2. Fast lookup index for affiliate code
-- Índice de lookup rápido para código de afiliado
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_affiliate_code
    ON profiles (affiliate_code);

-- 3. Referral code column on payments (for webhook attribution)
-- Coluna de código de referral nos pagamentos (para atribuição via webhook)
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- 4. Referrals tracking table
-- Tabela de rastreamento de indicações
CREATE TABLE IF NOT EXISTS referrals (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    referred_id  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
    payment_id   TEXT,                     -- Unique payment reference for idempotency
    status       TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'converted' | 'rewarded'
    days_granted INTEGER     DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT now(),
    converted_at TIMESTAMPTZ
);

-- 5. Performance indexes
-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_payment_id  ON referrals (payment_id);

-- 6. Row Level Security: users can only read their own referrals
-- RLS: usuários só podem ler as próprias indicações
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_own" ON referrals;
CREATE POLICY "referrals_select_own" ON referrals
    FOR SELECT
    USING (auth.uid() = referrer_id);

-- Note: INSERT/UPDATE are only done server-side via supabaseAdmin (service role key),
-- so no write policies are needed here.
-- Nota: INSERT/UPDATE são feitos apenas server-side via supabaseAdmin (service role key),
-- portanto não são necessárias políticas de escrita aqui.

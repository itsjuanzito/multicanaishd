-- Migration: velorapay_payment_fields
-- Description:
-- Colunas novas em public.payments pra suportar a VeloraPay (substitui
-- LivePix + Ko-fi + NOWPayments, 2026-09). A VeloraPay NÃO devolve o
-- QR/copia-e-cola (PIX) nem o endereço de carteira (cripto) num GET
-- posterior — só na criação da cobrança — então precisam ser persistidos
-- pra a página /pagamento/[reference] poder exibi-los depois de um reload.
--
-- `livepix_reference`/`livepix_id` (colunas já existentes) continuam
-- guardando o `transactionId` da VeloraPay — não foram renomeadas de
-- propósito, pra evitar o risco de uma migração de coluna só por clareza de
-- nome (mesma decisão tomada no projeto irmão StreamBetter).
--
-- Run this script in the Supabase Dashboard → SQL Editor.
-- Execute este script no Supabase Dashboard → SQL Editor.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'pix';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS pix_qr_base64 TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS crypto_pay_address TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS crypto_pay_amount TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS crypto_pay_currency TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS crypto_expires_at TIMESTAMPTZ;

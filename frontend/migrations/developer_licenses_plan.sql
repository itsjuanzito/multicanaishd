-- Migration: developer_licenses_plan
-- Adds the "plan" column to differentiate B2B license tiers:
--   'embed'  (R$ 100) — entrega o player embed do MultiCanaisHD (/player/xtream), como já funcionava.
--   'direct' (R$ 200) — entrega em JSON o link direto do stream (MegaEmbed), sem wrapper de player.
--
-- Run this in the Supabase Dashboard → SQL Editor.

ALTER TABLE developer_licenses
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'embed';

ALTER TABLE developer_licenses
    ADD CONSTRAINT developer_licenses_plan_check CHECK (plan IN ('embed', 'direct'));

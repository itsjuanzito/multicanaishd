-- Migration: notified_releases
-- Deduplication table used by the notification cron when Redis is unavailable.
-- Tabela de deduplicação usada pelo cron de notificações quando o Redis está esgotado.
--
-- Run this in the Supabase Dashboard → SQL Editor.

CREATE TABLE IF NOT EXISTS notified_releases (
    key        TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup queries (optional, good practice)
CREATE INDEX IF NOT EXISTS idx_notified_releases_created_at
    ON notified_releases (created_at);

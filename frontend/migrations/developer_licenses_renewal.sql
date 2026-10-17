-- Migration: developer_licenses_renewal
-- Adds the "pending_renewal_payment_id" column, used to track a renewal (+30 days)
-- checkout that is in-flight for an already active license — without touching
-- its allowed_domain/status like the initial PEND_PAY: prefix flow does.
--
-- Run this in the Supabase Dashboard → SQL Editor.

-- TEXT (not UUID) because the checkout fallback path can assign mock IDs like
-- "pay_mock_999" when the LivePix integration is unavailable (see checkout.js).
ALTER TABLE developer_licenses
    ADD COLUMN IF NOT EXISTS pending_renewal_payment_id TEXT DEFAULT NULL;

-- Rastreia domínios externos (embed da API) que tentam restringir o iframe de forma
-- proposital via atributo `sandbox` (sem allow-same-origin/allow-popups) para bloquear
-- os anúncios do plano gratuito (smartlink/popunder). Diferente de adblock do visitante
-- (fora do nosso controle) — isso só acontece se o dono do site que embeda configurou
-- o <iframe> assim de propósito.

CREATE TABLE IF NOT EXISTS embed_ad_integrity (
    id BIGSERIAL PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    sandbox_blocked_count INTEGER NOT NULL DEFAULT 0,
    first_detected TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_detected TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION increment_ad_integrity(p_domain TEXT, p_last_detected TIMESTAMPTZ)
RETURNS void AS $$
BEGIN
    INSERT INTO embed_ad_integrity (domain, sandbox_blocked_count, first_detected, last_detected)
    VALUES (p_domain, 1, p_last_detected, p_last_detected)
    ON CONFLICT (domain)
    DO UPDATE SET
        sandbox_blocked_count = embed_ad_integrity.sandbox_blocked_count + 1,
        last_detected = p_last_detected;
END;
$$ LANGUAGE plpgsql;

-- +migrate Up
-- Full Activation hardening: scope provider request idempotency to the provider.
--
-- The original constraint was UNIQUE(idempotency_key) GLOBAL, so a client reusing one
-- Idempotency-Key across different providers/capabilities would collide — the second call would
-- be deduped against the first provider's row and return that (wrong) outcome. Scoping the unique
-- key to (provider_id, idempotency_key) lets the same key be reused across providers while still
-- deduping repeats to the SAME provider. The execution framework's dedupe lookup filters by
-- provider_id to match. Additive + reversible; the ledger stays append-only.

DO $$
DECLARE cname text;
BEGIN
  -- Drop whatever named the old single-column UNIQUE(idempotency_key), regardless of its name.
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'provider_request_attempts'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (idempotency_key)';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE provider_request_attempts DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE provider_request_attempts
  ADD CONSTRAINT provider_request_attempts_provider_idem_key UNIQUE (provider_id, idempotency_key);

DROP INDEX IF EXISTS idx_provider_attempts_idem;
CREATE INDEX IF NOT EXISTS idx_provider_attempts_idem
  ON provider_request_attempts(provider_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- +migrate Down
ALTER TABLE provider_request_attempts DROP CONSTRAINT IF EXISTS provider_request_attempts_provider_idem_key;
ALTER TABLE provider_request_attempts
  ADD CONSTRAINT provider_request_attempts_idempotency_key_key UNIQUE (idempotency_key);
DROP INDEX IF EXISTS idx_provider_attempts_idem;
CREATE INDEX IF NOT EXISTS idx_provider_attempts_idem
  ON provider_request_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;

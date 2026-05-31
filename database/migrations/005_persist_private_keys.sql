-- +migrate Up

-- Add private_key_pem column to public_keys for cross-restart persistence
-- Note: In production, this would be encrypted with a KMS-managed key.
-- For this local prototype deployment, we store the PEM for test consistency.
ALTER TABLE public_keys ADD COLUMN private_key_pem TEXT;

-- +migrate Down
-- SQLite does not support DROP COLUMN directly on older versions.
-- This is a non-destructive additive migration; no rollback action needed.
SELECT 1;

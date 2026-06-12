-- Phase 7B: password storage for /api/auth/login.
--
-- Until now the users table had no password column, so login could only
-- match by email. backend/utils/passwordAuth.js stores scrypt hashes in
-- the format 'scrypt:<salt-hex>:<hash-hex>'. Accounts with a NULL hash
-- are legacy/dev accounts: they can only authenticate where passwordless
-- login is explicitly allowed (never in production).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

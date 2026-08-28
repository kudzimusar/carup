-- +migrate Up
-- =============================================================================
-- ISSUE #158 — REMOVE PLAINTEXT PRIVATE-KEY PERSISTENCE FROM public_keys
--
-- Private signing material moves out of ordinary application storage. The runtime
-- derives stakeholder signing keys inside the configured custody boundary and stores
-- only public material plus an opaque key reference/version.
-- =============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.public_keys') IS NULL THEN
    RAISE EXCEPTION '[issue-158] public.public_keys is absent';
  END IF;
END
$pre$;

ALTER TABLE public.public_keys
  ADD COLUMN IF NOT EXISTS key_ref TEXT,
  ADD COLUMN IF NOT EXISTS key_version TEXT,
  ADD COLUMN IF NOT EXISTS custody_provider TEXT;

-- Exactly one ACTIVE public key may represent one stakeholder. If historical drift
-- already contains multiple ACTIVE rows with DIFFERENT public keys, fail closed for
-- manual review rather than silently choosing a cryptographic identity. Duplicate
-- ACTIVE rows carrying the SAME public key are safe to collapse deterministically.
DO $active_key_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.public_keys
     WHERE status='ACTIVE'
     GROUP BY user_id
    HAVING count(*) > 1
       AND count(DISTINCT public_key_pem) > 1
  ) THEN
    RAISE EXCEPTION
      '[issue-158] multiple distinct ACTIVE public keys exist for at least one user; manual custody reconciliation is required before uniqueness can be enforced'
      USING ERRCODE='23514';
  END IF;
END
$active_key_preflight$;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.public_keys
   WHERE status='ACTIVE'
)
UPDATE public.public_keys p
   SET status='REVOKED',
       revoked_at=coalesce(p.revoked_at, clock_timestamp()::text)
  FROM ranked r
 WHERE p.id=r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_keys_one_active_per_user
  ON public.public_keys(user_id)
  WHERE status='ACTIVE';

-- Destructive only to prohibited secret material; public verification material remains.
UPDATE public.public_keys
   SET private_key_pem = NULL
 WHERE private_key_pem IS NOT NULL;

ALTER TABLE public.public_keys
  DROP CONSTRAINT IF EXISTS public_keys_private_material_absent;
ALTER TABLE public.public_keys
  ADD CONSTRAINT public_keys_private_material_absent
  CHECK (private_key_pem IS NULL);

-- Least privilege: service_role can no longer SELECT/INSERT/UPDATE the private column.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.public_keys FROM service_role;
GRANT SELECT (
  id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
  key_ref,key_version,custody_provider
) ON public.public_keys TO service_role;
GRANT INSERT (
  id,user_id,public_key_pem,key_type,status,created_at,
  key_ref,key_version,custody_provider
) ON public.public_keys TO service_role;
GRANT UPDATE (
  status,revoked_at,key_ref,key_version,custody_provider
) ON public.public_keys TO service_role;

-- API roles remain default-denied from the earlier Issue #101 hardening.
REVOKE ALL ON TABLE public.public_keys FROM anon, authenticated;
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;

-- +migrate Down
-- Forward-only security boundary. Re-introducing plaintext private-key persistence is prohibited.

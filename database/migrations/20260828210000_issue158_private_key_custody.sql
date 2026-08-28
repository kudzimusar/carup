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

-- Atomic activation/rotation. Each time a previously used key becomes active again it
-- gets a NEW row/incarnation, preserving historical validity intervals. The table lock
-- is intentionally narrow but global: stakeholder key rotation is rare, and correctness
-- is more important than parallelism in this custody boundary.
CREATE OR REPLACE FUNCTION public.blockchain_activate_public_key_atomic(
  p_candidate_id TEXT,
  p_user_id TEXT,
  p_public_key_pem TEXT,
  p_key_type TEXT,
  p_created_at TEXT,
  p_key_ref TEXT,
  p_key_version TEXT,
  p_custody_provider TEXT
)
RETURNS TABLE (
  id TEXT,
  user_id TEXT,
  public_key_pem TEXT,
  key_type TEXT,
  status TEXT,
  created_at TEXT,
  revoked_at TEXT,
  key_ref TEXT,
  key_version TEXT,
  custody_provider TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $activate$
DECLARE
  v_active public.public_keys%ROWTYPE;
BEGIN
  IF nullif(btrim(p_candidate_id),'') IS NULL
     OR nullif(btrim(p_user_id),'') IS NULL
     OR nullif(btrim(p_public_key_pem),'') IS NULL
     OR nullif(btrim(p_created_at),'') IS NULL
     OR nullif(btrim(p_key_ref),'') IS NULL
     OR nullif(btrim(p_key_version),'') IS NULL
     OR nullif(btrim(p_custody_provider),'') IS NULL THEN
    RAISE EXCEPTION 'complete public-key activation metadata is required'
      USING ERRCODE='22023';
  END IF;

  LOCK TABLE public.public_keys IN SHARE ROW EXCLUSIVE MODE;

  SELECT p.* INTO v_active
    FROM public.public_keys p
   WHERE p.user_id=p_user_id
     AND p.status='ACTIVE'
   FOR UPDATE;

  IF FOUND AND v_active.public_key_pem = p_public_key_pem THEN
    UPDATE public.public_keys p
       SET key_ref=p_key_ref,
           key_version=p_key_version,
           custody_provider=p_custody_provider
     WHERE p.id=v_active.id;

    RETURN QUERY
    SELECT p.id,p.user_id,p.public_key_pem,p.key_type,p.status,p.created_at,p.revoked_at,
           p.key_ref,p.key_version,p.custody_provider
      FROM public.public_keys p
     WHERE p.id=v_active.id;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.public_keys p
       SET status='REVOKED',
           revoked_at=coalesce(p.revoked_at,p_created_at)
     WHERE p.id=v_active.id;
  END IF;

  -- Always create a fresh incarnation. Reusing a historical row would erase its
  -- revoked_at boundary and make old key-version intervals overlap.
  INSERT INTO public.public_keys(
    id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
    key_ref,key_version,custody_provider
  ) VALUES(
    p_candidate_id,p_user_id,p_public_key_pem,coalesce(nullif(p_key_type,''),'secp256k1'),
    'ACTIVE',p_created_at,NULL,p_key_ref,p_key_version,p_custody_provider
  );

  RETURN QUERY
  SELECT p.id,p.user_id,p.public_key_pem,p.key_type,p.status,p.created_at,p.revoked_at,
         p.key_ref,p.key_version,p.custody_provider
    FROM public.public_keys p
   WHERE p.id=p_candidate_id;
END
$activate$;

REVOKE ALL ON FUNCTION public.blockchain_activate_public_key_atomic(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.blockchain_activate_public_key_atomic(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO service_role;

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

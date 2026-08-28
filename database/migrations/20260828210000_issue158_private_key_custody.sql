-- +migrate Up
-- =============================================================================
-- ISSUE #158 — PREPARE PRIVATE-KEY CUSTODY CUTOVER
--
-- This automatic migration is deliberately additive. It prepares custody metadata,
-- uniqueness and atomic activation, but DOES NOT erase legacy private material yet.
-- That destructive step lives in a separately protected finalizer and may run only
-- after the old writer fleet has been drained. This makes rolling deployment safe.
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

-- Rollout state is private DB control-plane metadata. New runtime instances read it
-- only through the SECURITY DEFINER scalar below. PREPARED means old runtime writers
-- may still exist, so deterministic-key activation must remain disabled.
CREATE TABLE IF NOT EXISTS public.blockchain_custody_rollout (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  state TEXT NOT NULL DEFAULT 'PREPARED'
    CHECK (state IN ('PREPARED','FINALIZED')),
  old_writers_drained BOOLEAN NOT NULL DEFAULT FALSE,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finalized_at TIMESTAMPTZ,
  CHECK (
    (state='PREPARED' AND finalized_at IS NULL)
    OR (state='FINALIZED' AND finalized_at IS NOT NULL)
  )
);

INSERT INTO public.blockchain_custody_rollout(singleton,state,old_writers_drained)
VALUES (TRUE,'PREPARED',FALSE)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.blockchain_custody_rollout
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.blockchain_custody_rollout_state()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $state$
  SELECT state
    FROM public.blockchain_custody_rollout
   WHERE singleton=TRUE
$state$;

REVOKE ALL ON FUNCTION public.blockchain_custody_rollout_state()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.blockchain_custody_rollout_state()
  TO service_role;

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
  IF coalesce((
    SELECT state
      FROM public.blockchain_custody_rollout
     WHERE singleton=TRUE
  ),'PREPARED') <> 'FINALIZED' THEN
    RAISE EXCEPTION 'blockchain custody cutover is not finalized; key activation is disabled'
      USING ERRCODE='55000';
  END IF;

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

-- Browser roles remain default-denied. Service-role table privileges are intentionally
-- unchanged in PREPARED mode so the still-running old application can continue using
-- its legacy key path until the protected cutover is explicitly authorized.
REVOKE ALL ON TABLE public.public_keys FROM anon, authenticated;
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;

-- IMPORTANT: private_key_pem is intentionally untouched here.
-- Protected finalization:
--   1. deploy this PREPARED migration while old runtime is still active;
--   2. deploy the new runtime, which fails closed for stakeholder signing in PREPARED;
--   3. drain all old runtime writers;
--   4. record the drain with database/scripts/issue158_mark_old_writers_drained.sql;
--   5. run database/scripts/issue158_private_key_custody_finalize.sql.
-- The finalizer takes an ACCESS EXCLUSIVE lock, erases private material, removes
-- service-role direct key writes, marks FINALIZED, and only then enables new-runtime
-- deterministic key activation.

-- +migrate Down
-- Forward-only security boundary. Re-introducing plaintext private-key persistence is prohibited.

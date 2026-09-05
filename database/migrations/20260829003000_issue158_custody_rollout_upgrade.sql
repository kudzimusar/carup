-- +migrate Up
-- =============================================================================
-- ISSUE #158 — CUSTODY ROLLOUT UPGRADE / MIXED-RUNTIME GENERATION AUTHORITY
--
-- This migration has a NEW identity on purpose. Databases that already recorded the
-- earlier monolithic 20260828210000 migration must still receive this compatibility
-- upgrade instead of treating a missing rollout RPC as evidence of finalization.
-- =============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.public_keys') IS NULL THEN
    RAISE EXCEPTION '[issue-158] public.public_keys is absent';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.blockchain_custody_rollout (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  state TEXT NOT NULL DEFAULT 'PREPARED'
    CHECK (state IN ('PREPARED','FINALIZED')),
  old_writers_drained BOOLEAN NOT NULL DEFAULT FALSE,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finalized_at TIMESTAMPTZ,
  authorized_generation TEXT,
  CHECK (
    (state='PREPARED' AND finalized_at IS NULL)
    OR (state='FINALIZED' AND finalized_at IS NOT NULL)
  )
);

ALTER TABLE public.blockchain_custody_rollout
  ADD COLUMN IF NOT EXISTS authorized_generation TEXT;

INSERT INTO public.blockchain_custody_rollout(singleton,state,old_writers_drained)
VALUES (TRUE,'PREPARED',FALSE)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.blockchain_custody_rollout
  FROM PUBLIC,anon,authenticated,service_role;

-- A database that already has the old monolithic private-material constraint has
-- already erased legacy secrets. Its old runtime can no longer safely write keys, so
-- close direct service-role DML immediately and enter explicit PREPARED maintenance.
DO $legacy_monolith$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid='public.public_keys'::regclass
       AND conname='public_keys_private_material_absent'
  ) THEN
    UPDATE public.blockchain_custody_rollout
       SET state='PREPARED',
           old_writers_drained=FALSE,
           finalized_at=NULL
     WHERE singleton=TRUE;

    REVOKE SELECT,INSERT,UPDATE,DELETE ON TABLE public.public_keys FROM service_role;
    GRANT SELECT (
      id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
      key_ref,key_version,custody_provider
    ) ON public.public_keys TO service_role;
  END IF;
END
$legacy_monolith$;

CREATE OR REPLACE FUNCTION public.blockchain_custody_rollout_contract()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $contract$
  SELECT jsonb_build_object(
    'state',state,
    'authorized_generation',authorized_generation
  )
    FROM public.blockchain_custody_rollout
   WHERE singleton=TRUE
$contract$;

REVOKE ALL ON FUNCTION public.blockchain_custody_rollout_contract()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.blockchain_custody_rollout_contract()
  TO service_role;

-- Database-owner-only control plane for initial authorization and later key-generation
-- rotations. No application/browser role may advance this authority.
CREATE OR REPLACE FUNCTION public.blockchain_authorize_custody_generation(
  p_generation TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $authorize$
DECLARE
  v_rollout public.blockchain_custody_rollout%ROWTYPE;
BEGIN
  IF nullif(btrim(p_generation),'') IS NULL THEN
    RAISE EXCEPTION 'custody generation is required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_rollout
    FROM public.blockchain_custody_rollout
   WHERE singleton=TRUE
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'custody rollout state is absent' USING ERRCODE='55000';
  END IF;

  -- Serialize generation authority changes against public-key activation.
  LOCK TABLE public.public_keys IN SHARE ROW EXCLUSIVE MODE;

  UPDATE public.blockchain_custody_rollout
     SET authorized_generation=p_generation
   WHERE singleton=TRUE;

  RETURN p_generation;
END
$authorize$;

REVOKE ALL ON FUNCTION public.blockchain_authorize_custody_generation(TEXT)
  FROM PUBLIC,anon,authenticated,service_role;

-- Retire the old eight-argument activation contract. A superseded intermediate runtime
-- must fail closed rather than bypass custody-generation authority after rollout.
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
  id TEXT,user_id TEXT,public_key_pem TEXT,key_type TEXT,status TEXT,
  created_at TEXT,revoked_at TEXT,key_ref TEXT,key_version TEXT,custody_provider TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $obsolete$
BEGIN
  RAISE EXCEPTION
    'obsolete custody activation contract; deploy current runtime and complete protected rollout'
    USING ERRCODE='55000';
END
$obsolete$;

REVOKE ALL ON FUNCTION public.blockchain_activate_public_key_atomic(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated,service_role;

-- Current activation authority. Both rollout state and the owner-authorized custody
-- generation must match. This prevents old/new key versions or master secrets from
-- oscillating the ACTIVE key during a rolling configuration cutover.
CREATE OR REPLACE FUNCTION public.blockchain_activate_public_key_atomic(
  p_candidate_id TEXT,
  p_user_id TEXT,
  p_public_key_pem TEXT,
  p_key_type TEXT,
  p_created_at TEXT,
  p_key_ref TEXT,
  p_key_version TEXT,
  p_custody_provider TEXT,
  p_custody_generation TEXT
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
  v_rollout public.blockchain_custody_rollout%ROWTYPE;
BEGIN
  IF nullif(btrim(p_candidate_id),'') IS NULL
     OR nullif(btrim(p_user_id),'') IS NULL
     OR nullif(btrim(p_public_key_pem),'') IS NULL
     OR nullif(btrim(p_created_at),'') IS NULL
     OR nullif(btrim(p_key_ref),'') IS NULL
     OR nullif(btrim(p_key_version),'') IS NULL
     OR nullif(btrim(p_custody_provider),'') IS NULL
     OR nullif(btrim(p_custody_generation),'') IS NULL THEN
    RAISE EXCEPTION 'complete public-key activation metadata is required'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_rollout
    FROM public.blockchain_custody_rollout
   WHERE singleton=TRUE
   FOR SHARE;

  IF NOT FOUND OR v_rollout.state <> 'FINALIZED' THEN
    RAISE EXCEPTION 'blockchain custody cutover is not finalized; key activation is disabled'
      USING ERRCODE='55000';
  END IF;

  IF v_rollout.authorized_generation IS DISTINCT FROM p_custody_generation THEN
    RAISE EXCEPTION
      'stakeholder signer custody generation is not authorized'
      USING ERRCODE='42501';
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
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.blockchain_activate_public_key_atomic(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO service_role;

-- +migrate Down
-- Forward-only security boundary. Do not restore obsolete activation authority.

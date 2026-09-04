-- +migrate Up
-- =============================================================================
-- ISSUE #158 — TERMINAL LEDGER UNIQUENESS + RECOVERABLE TERMINAL ACTIVATION
--
-- This migration has a NEW identity on purpose. The terminal uniqueness invariant was
-- established after 20260829020000 had already been published, so it must not be
-- delivered by editing that filename: a database that has recorded 20260829020000 would
-- silently miss it. This migration is therefore SELF-SUFFICIENT for every terminal
-- invariant such a database could otherwise lack — it creates the uniqueness index and
-- re-publishes the activation contract in its corrected form.
--
-- Two properties are delivered here.
--
-- 1. AT MOST ONE TERMINAL EVENT PER SIGNER.
--    The terminal instant (the last representable millisecond) is the only boundary the
--    custody contract may ever re-issue, so it is the only instant at which two
--    competing writes can hold the same timestamp at once. Each computes its
--    previous_hash before either insert lands, so without a database-side identity both
--    could persist and fork the hash chain. A barrier-controlled concurrency test
--    reproduced exactly that.
--
-- 2. THE TERMINAL BOUNDARY MAY BE RE-ISSUED FOR THE SAME ACTIVE KEY EVEN AFTER THE
--    TERMINAL EVENT HAS PERSISTED.
--    Previously the activation contract refused once persistence was observable, which
--    killed a legitimate lost-response retry inside activation, before the runtime could
--    classify the conflict. Safety no longer depends on that refusal: the unique index
--    below guarantees only one row can ever persist per signer, and the runtime accepts
--    a conflict as idempotent only for the same logical write. Rotation remains
--    impossible at the terminal instant because re-issue still requires the requested
--    public key to equal the active one.
--
-- OPERATIONAL NOTE — index build cost, stated honestly:
-- the partial predicate keeps the FINISHED index tiny and its ordinary-path maintenance
-- negligible, but PostgreSQL still scans public.blockchain_events once to build it, and
-- a plain CREATE UNIQUE INDEX holds a lock that blocks concurrent writes to that table
-- for the duration. CREATE INDEX CONCURRENTLY is deliberately NOT used because it
-- cannot run inside a transaction block and this repository's migration runner applies
-- each migration transactionally. The protected Issue #158 rollout already requires a
-- maintenance window in which old writers are drained, so the blocking build is
-- acceptable there; it should not be applied casually to a live ledger outside one.
-- =============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.public_keys') IS NULL THEN
    RAISE EXCEPTION '[issue-158] public.public_keys is absent';
  END IF;
  IF to_regclass('public.blockchain_signing_watermarks') IS NULL THEN
    RAISE EXCEPTION '[issue-158] boundary-hardening migration (20260829020000) must be applied first';
  END IF;
END
$pre$;

DO $terminal_unique$
BEGIN
  IF to_regclass('public.blockchain_events') IS NOT NULL THEN
    EXECUTE $ix$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_terminal_signer
        ON public.blockchain_events (split_part(signature,':',1))
        WHERE "timestamp" = '9999-12-31T23:59:59.999Z'
    $ix$;
  END IF;
END
$terminal_unique$;

-- Re-published activation authority. Identical to 20260829020000 except that terminal
-- re-issue no longer depends on the terminal event being unpersisted, so a lost-response
-- retry can reach runtime conflict classification. Every other guarantee is unchanged:
-- DB-owned monotonic boundary, no caller clock, half-open validity, generation
-- authority, and no re-issue across a key rotation.
CREATE OR REPLACE FUNCTION public.blockchain_activate_public_key_boundary(
  p_candidate_id TEXT,
  p_user_id TEXT,
  p_public_key_pem TEXT,
  p_key_type TEXT,
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
  custody_provider TEXT,
  event_timestamp TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $activate$
#variable_conflict use_column
DECLARE
  c_max_boundary CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '9999-12-31 23:59:59.999+00';
  v_active public.public_keys%ROWTYPE;
  v_has_active BOOLEAN;
  v_rollout public.blockchain_custody_rollout%ROWTYPE;
  v_watermark TIMESTAMPTZ;
  v_key_floor TIMESTAMPTZ;
  v_floor TIMESTAMPTZ;
  v_boundary TIMESTAMPTZ;
  v_boundary_text TEXT;
BEGIN
  IF nullif(btrim(p_candidate_id),'') IS NULL
     OR nullif(btrim(p_user_id),'') IS NULL
     OR nullif(btrim(p_public_key_pem),'') IS NULL
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

  SELECT w.last_authorized_at INTO v_watermark
    FROM public.blockchain_signing_watermarks w
   WHERE w.user_id=p_user_id
   FOR UPDATE;

  SELECT max(f.t) INTO v_key_floor
    FROM (
      SELECT public.blockchain_boundary_parse_ts(p.created_at) AS t
        FROM public.public_keys p
       WHERE p.user_id=p_user_id
      UNION ALL
      SELECT public.blockchain_boundary_parse_ts(p.revoked_at) AS t
        FROM public.public_keys p
       WHERE p.user_id=p_user_id
    ) f;

  v_floor := GREATEST(v_watermark,v_key_floor);
  v_boundary := date_trunc('milliseconds', clock_timestamp());
  IF v_floor IS NOT NULL AND v_boundary <= v_floor THEN
    v_boundary := date_trunc('milliseconds', v_floor) + interval '1 millisecond';
  END IF;

  SELECT p.* INTO v_active
    FROM public.public_keys p
   WHERE p.user_id=p_user_id
     AND p.status='ACTIVE'
   FOR UPDATE;
  v_has_active := FOUND;

  -- Terminal handling. The boundary may be re-issued at the last representable instant
  -- for the SAME active cryptographic key, so a retry whose ledger write failed OR whose
  -- response was lost can reach runtime conflict classification. This is safe because
  -- uq_blockchain_events_terminal_signer admits at most one terminal event per signer
  -- and the runtime accepts a conflict as idempotent only for the same logical write.
  -- Rotation is still impossible here: re-issue requires the requested public key to
  -- equal the active one, so no new incarnation can consume the terminal instant.
  IF v_boundary > c_max_boundary THEN
    IF v_floor IS NOT NULL
       AND date_trunc('milliseconds', v_floor) = c_max_boundary
       AND v_has_active
       AND v_active.public_key_pem = p_public_key_pem THEN
      v_boundary := c_max_boundary;
    ELSE
      RAISE EXCEPTION
        'custody activation boundary exceeds the representable timestamp range for this stakeholder'
        USING ERRCODE='22008';
    END IF;
  END IF;

  v_boundary_text := to_char(v_boundary AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
  VALUES (p_user_id,v_boundary)
  ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at;

  IF v_has_active AND v_active.public_key_pem = p_public_key_pem THEN
    UPDATE public.public_keys p
       SET key_ref=p_key_ref,
           key_version=p_key_version,
           custody_provider=p_custody_provider
     WHERE p.id=v_active.id;

    RETURN QUERY
    SELECT p.id,p.user_id,p.public_key_pem,p.key_type,p.status,p.created_at,p.revoked_at,
           p.key_ref,p.key_version,p.custody_provider,v_boundary_text
      FROM public.public_keys p
     WHERE p.id=v_active.id;
    RETURN;
  END IF;

  IF v_has_active THEN
    UPDATE public.public_keys p
       SET status='REVOKED',
           revoked_at=v_boundary_text
     WHERE p.id=v_active.id;
  END IF;

  INSERT INTO public.public_keys(
    id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
    key_ref,key_version,custody_provider
  ) VALUES(
    p_candidate_id,p_user_id,p_public_key_pem,coalesce(nullif(p_key_type,''),'secp256k1'),
    'ACTIVE',v_boundary_text,NULL,p_key_ref,p_key_version,p_custody_provider
  );

  RETURN QUERY
  SELECT p.id,p.user_id,p.public_key_pem,p.key_type,p.status,p.created_at,p.revoked_at,
         p.key_ref,p.key_version,p.custody_provider,v_boundary_text
    FROM public.public_keys p
   WHERE p.id=p_candidate_id;
END
$activate$;

REVOKE ALL ON FUNCTION public.blockchain_activate_public_key_boundary(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.blockchain_activate_public_key_boundary(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO service_role;

-- +migrate Down
-- Forward-only security boundary. Do not drop the terminal uniqueness invariant.

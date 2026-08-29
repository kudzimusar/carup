-- +migrate Up
-- =============================================================================
-- ISSUE #158 — ACTIVATION BOUNDARY HARDENING / MONOTONIC KEY VALIDITY AUTHORITY
--
-- This migration has a NEW identity on purpose: the already-evidenced
-- 20260829003000 rollout upgrade must stay byte-stable, and databases that have
-- recorded it still receive this later forward-only hardening.
--
-- Problem being closed: rotation previously stamped the old key's revoked_at and
-- the new key's created_at from a CALLER-supplied wall-clock timestamp. Two
-- runtimes activating within the same millisecond — or with skewed clocks — could
-- produce colliding or inverted validity boundaries, making signature verification
-- ambiguous about which key incarnation owns an event timestamp.
--
-- Authority model after this migration:
--   * the database owns a per-stakeholder, millisecond-resolution, strictly
--     monotonic authorization watermark;
--   * every successful generation-authorized signing check advances that
--     watermark and returns it as the authoritative event timestamp;
--   * rotation chooses a boundary strictly greater than the previous watermark,
--     writes old.revoked_at = boundary and new.created_at = boundary, so key
--     validity intervals are half-open [created_at, revoked_at) and partition
--     time with no overlap and no gap at the boundary instant;
--   * the runtime uses the DB-returned event timestamp, never its own clock.
-- =============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.public_keys') IS NULL THEN
    RAISE EXCEPTION '[issue-158] public.public_keys is absent';
  END IF;
  IF to_regclass('public.blockchain_custody_rollout') IS NULL THEN
    RAISE EXCEPTION '[issue-158] custody rollout upgrade migration (20260829003000) must be applied first';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='blockchain_custody_rollout'
       AND column_name='authorized_generation'
  ) THEN
    RAISE EXCEPTION '[issue-158] custody generation authority column is absent; apply 20260829003000 first';
  END IF;
END
$pre$;

-- DB-owned signing/activation watermark. Private control-plane state: no
-- application or browser role may read or write it directly.
CREATE TABLE IF NOT EXISTS public.blockchain_signing_watermarks (
  user_id TEXT PRIMARY KEY,
  last_authorized_at TIMESTAMPTZ NOT NULL
);

REVOKE ALL ON TABLE public.blockchain_signing_watermarks
  FROM PUBLIC,anon,authenticated,service_role;

-- Historical key/event timestamps are TEXT written by superseded runtimes; a single
-- malformed value must not abort the upgrade, so parsing fails soft to NULL. Private
-- helper: no application or browser role may execute it.
--
-- A successful cast is NOT sufficient. PostgreSQL accepts 'infinity'/'-infinity' and
-- finite values up to 294276 AD, none of which this code path can represent: the
-- boundary is emitted through to_char with a four-digit year and parsed by the runtime
-- with Date.parse. Persisting one as a watermark is not a cosmetic problem — the
-- boundary then formats to NULL, the activation RPC returns no event timestamp, and
-- the runtime raises on every subsequent signing attempt for that stakeholder. Values
-- outside the representable window are therefore treated exactly like unparseable ones.
CREATE OR REPLACE FUNCTION public.blockchain_boundary_parse_ts(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $parse$
DECLARE
  -- Exact bounds of the emitted 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"' representation.
  -- 9999-12-31T23:59:59.999Z is the last instant that both this format and the
  -- runtime's Date.parse admit, so the whole final day is legitimate history and must
  -- not be discarded. Headroom is NOT taken here: a boundary that would run past the
  -- last representable millisecond is refused where it is issued, in
  -- blockchain_activate_public_key_boundary, so saturation is an explicit error rather
  -- than a silently unparseable timestamp.
  c_min CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '0001-01-01 00:00:00+00';
  c_max CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '9999-12-31 23:59:59.999+00';
  v_parsed TIMESTAMPTZ;
BEGIN
  IF nullif(btrim(p_value),'') IS NULL THEN
    RETURN NULL;
  END IF;

  v_parsed := p_value::timestamptz;

  IF NOT isfinite(v_parsed) THEN
    RETURN NULL;
  END IF;

  IF v_parsed < c_min OR v_parsed > c_max THEN
    RETURN NULL;
  END IF;

  RETURN v_parsed;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$parse$;

REVOKE ALL ON FUNCTION public.blockchain_boundary_parse_ts(TEXT)
  FROM PUBLIC,anon,authenticated,service_role;

-- WATERMARK RESEED — the upgrade must not rewind time.
--
-- The superseded contract stamped key validity from the APPLICATION caller clock and
-- never persisted same-key signing checks, so a database can hold key rows and ledger
-- events dated AHEAD of this database's clock (a forward-skewed application host). If a
-- boundary came from clock_timestamp() alone it could land before that history,
-- producing an event that predates its own active key, or a revoked_at that
-- retroactively excludes an already-signed old-key event under the half-open rule.
--
-- This is deliberately a callable function rather than an inline block: it runs once
-- here at upgrade time, and AGAIN inside the protected finalizer after old writers are
-- confirmed drained. The PREPARED window intentionally keeps legacy runtimes alive, and
-- a legacy runtime can append a forward-clock stakeholder event AFTER this upgrade while
-- reusing its existing ACTIVE key — which moves no key edge and so would otherwise be
-- invisible to every later boundary.
--
-- The ledger source is locked while the reseed is taken so a concurrent legacy insert
-- cannot land between the scan and the watermark write. Lock order is public_keys then
-- blockchain_events at every call site, matching the runtime's own order.
CREATE OR REPLACE FUNCTION public.blockchain_reseed_signing_watermarks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $reseed$
BEGIN
  IF to_regclass('public.blockchain_events') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.blockchain_events IN SHARE MODE';
  END IF;

  INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
  SELECT k.user_id,max(k.ts)
    FROM (
      SELECT p.user_id,public.blockchain_boundary_parse_ts(p.created_at) AS ts
        FROM public.public_keys p
      UNION ALL
      SELECT p.user_id,public.blockchain_boundary_parse_ts(p.revoked_at) AS ts
        FROM public.public_keys p
    ) k
   WHERE k.ts IS NOT NULL
     AND nullif(btrim(k.user_id),'') IS NOT NULL
   GROUP BY k.user_id
  ON CONFLICT (user_id) DO UPDATE
     SET last_authorized_at=GREATEST(
       public.blockchain_signing_watermarks.last_authorized_at,
       EXCLUDED.last_authorized_at
     );

  -- Stakeholder ledger events carry the timestamps that verification actually binds
  -- to, and they may postdate every key row. Signatures are '<signerId>:<hex>'; the
  -- system HMAC signer owns no stakeholder key.
  IF to_regclass('public.blockchain_events') IS NOT NULL THEN
    EXECUTE $events$
      INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
      SELECT s.signer,max(s.ts)
        FROM (
          SELECT split_part(e.signature,':',1) AS signer,
                 public.blockchain_boundary_parse_ts(e."timestamp") AS ts
            FROM public.blockchain_events e
           WHERE e.signature LIKE '%:%'
        ) s
       WHERE s.ts IS NOT NULL
         AND nullif(btrim(s.signer),'') IS NOT NULL
         AND s.signer <> 'system'
       GROUP BY s.signer
      ON CONFLICT (user_id) DO UPDATE
         SET last_authorized_at=GREATEST(
           public.blockchain_signing_watermarks.last_authorized_at,
           EXCLUDED.last_authorized_at
         )
    $events$;
  END IF;
END
$reseed$;

REVOKE ALL ON FUNCTION public.blockchain_reseed_signing_watermarks()
  FROM PUBLIC,anon,authenticated,service_role;

-- Upgrade-time bootstrap. The protected finalizer repeats this after the drain.
SELECT public.blockchain_reseed_signing_watermarks();

-- Current activation authority. Takes NO caller timestamp: the boundary is
-- established inside the transaction, under the same lock that serializes key
-- activation, strictly after every previously authorized signing check.
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
-- OUT columns (user_id, ...) must never shadow table columns inside the body's
-- SQL — every variable here is p_/v_ prefixed, so column resolution is safe.
#variable_conflict use_column
DECLARE
  -- Last instant the emitted format and the runtime can both represent. One
  -- millisecond further, to_char yields a five-digit year and Date.parse returns NaN
  -- with no error anywhere, so the boundary must never be allowed to cross it.
  c_max_boundary CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '9999-12-31 23:59:59.999+00';
  v_active public.public_keys%ROWTYPE;
  v_has_active BOOLEAN;
  v_rollout public.blockchain_custody_rollout%ROWTYPE;
  v_watermark TIMESTAMPTZ;
  v_key_floor TIMESTAMPTZ;
  v_floor TIMESTAMPTZ;
  v_boundary TIMESTAMPTZ;
  v_boundary_text TEXT;
  v_terminal_text TEXT;
  v_terminal_persisted BOOLEAN;
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

  -- Host wall clocks are advisory only. The boundary is millisecond-resolution
  -- (matching the runtime's timestamp parsing) and strictly greater than every
  -- previously authorized signing check for this stakeholder, even if the host
  -- clock collides on the same millisecond or runs backwards.
  SELECT w.last_authorized_at INTO v_watermark
    FROM public.blockchain_signing_watermarks w
   WHERE w.user_id=p_user_id
   FOR UPDATE;

  -- Defence in depth for pre-hardening history the bootstrap could not have seen
  -- (rows written between the upgrade and this call, or by any superseded path):
  -- never issue a boundary at or before an existing validity edge for this
  -- stakeholder, or an event would predate its own key / a revocation would
  -- retroactively exclude an already-signed event.
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

  -- GREATEST ignores NULLs, so an absent watermark or an empty key history is fine.
  v_floor := GREATEST(v_watermark,v_key_floor);
  v_boundary := date_trunc('milliseconds', clock_timestamp());
  IF v_floor IS NOT NULL AND v_boundary <= v_floor THEN
    v_boundary := date_trunc('milliseconds', v_floor) + interval '1 millisecond';
  END IF;

  -- The active key is read BEFORE the terminal decision below, because recovering the
  -- last representable millisecond is permitted only for the SAME cryptographic
  -- authority and never for a rotation. FOUND is captured because later statements
  -- (the watermark upsert) would otherwise reset it.
  SELECT p.* INTO v_active
    FROM public.public_keys p
   WHERE p.user_id=p_user_id
     AND p.status='ACTIVE'
   FOR UPDATE;
  v_has_active := FOUND;

  -- Monotonic counters saturate. Past the last representable millisecond the emitted
  -- timestamp silently becomes unparseable rather than raising, so it must never be
  -- issued.
  --
  -- Allocation and persistence are separate operations: this function commits the
  -- boundary, and the runtime signs and inserts the ledger row afterwards. A transient
  -- insert failure at the terminal instant would otherwise consume the signer's only
  -- remaining representable boundary forever. The ledger itself proves which case this
  -- is -- stakeholder events carry '<signerId>:<hex>' and the exact boundary text --
  -- so a terminal allocation that was reserved but never persisted may be re-issued.
  --
  -- The recovery is narrow by construction: same stakeholder, same active public key
  -- (never a rotation), only at exactly the terminal instant, and only while no event
  -- bearing that instant exists for this signer. It becomes unavailable the moment
  -- persistence is observable. If the ledger is absent we cannot prove non-persistence
  -- and therefore fail closed.
  --
  -- Race note: activations for one stakeholder serialize on the watermark row lock and
  -- the public_keys table lock, so the observe-then-reissue pair is atomic per signer.
  -- Two concurrent retries that both observe "not persisted" could each persist an
  -- event at the terminal instant; both are genuine writes by the same key at the same
  -- instant, so key validity is unaffected and both verify. Rotation cannot occur on
  -- this path, so no validity interval can be made ambiguous by it.
  IF v_boundary > c_max_boundary THEN
    v_terminal_text := to_char(c_max_boundary AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    IF to_regclass('public.blockchain_events') IS NULL THEN
      v_terminal_persisted := TRUE;
    ELSE
      EXECUTE $persisted$
        SELECT EXISTS (
          SELECT 1
            FROM public.blockchain_events e
           WHERE e."timestamp" = $1
             AND split_part(e.signature,':',1) = $2
        )
      $persisted$
      INTO v_terminal_persisted
      USING v_terminal_text, p_user_id;
    END IF;

    IF v_floor IS NOT NULL
       AND date_trunc('milliseconds', v_floor) = c_max_boundary
       AND v_has_active
       AND v_active.public_key_pem = p_public_key_pem
       AND NOT v_terminal_persisted THEN
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
    -- Half-open rotation boundary: the superseded key's validity interval ends at
    -- exactly the instant the new incarnation begins. [created_at, revoked_at)
    -- assigns the boundary instant to the new key and excludes the old one, so no
    -- two incarnations are ever simultaneously eligible for one event timestamp.
    UPDATE public.public_keys p
       SET status='REVOKED',
           revoked_at=v_boundary_text
     WHERE p.id=v_active.id;
  END IF;

  -- Always create a fresh incarnation. Reusing a historical row would erase its
  -- revoked_at boundary and make old key-version intervals overlap.
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

-- Retire the superseded nine-argument app-callable contract. Its caller-supplied
-- p_created_at is exactly the ambiguity this migration removes; an intermediate
-- runtime still calling it must fail closed rather than write ambiguous validity
-- boundaries.
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
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated,service_role;

-- +migrate Down
-- Forward-only security boundary. Do not restore caller-clock activation authority.

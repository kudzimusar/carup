-- +migrate Up
-- =============================================================================
-- ISSUE #101 — public_keys P0 CLOSURE
-- =============================================================================
--
-- WHAT THIS CLOSES. Production run 31774496416 measured public.public_keys and found
-- anon AND authenticated each holding all eight privileges — SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — on the table that stores
-- cryptographic key material, including a private_key_pem column that is really there.
--
-- RLS is already ENABLED on it in production with ZERO policies, so ordinary DML by
-- those roles is default-denied today. That is exactly one control, and it is not
-- enough: RLS NEVER GOVERNS TRUNCATE. The TRUNCATE bit both API roles hold is live and
-- ungoverned. REVOKE is the only control for it.
--
-- public_keys was NOT one of #155's fourteen — it was discovered later, as the referent
-- of signature_verification_logs' foreign key — so #155 does not touch it and this
-- migration is what closes it.
--
-- SCOPE IS ONE RELATION. No other table, view, sequence, role or policy is named. This
-- is not a key-management redesign: no rotation, no encryption, no envelope, no new
-- table. Removing plaintext private-key persistence is Issue #158 and is NOT solved
-- here — private_key_pem is deliberately left in place, because current application
-- code expects the production schema.
--
-- NO DATA IS READ OR CHANGED. Catalog and privilege changes only. Not one row is
-- selected, inserted, updated, deleted or truncated, and no key material is read,
-- copied or logged. The preconditions below inspect information_schema and pg_catalog
-- exclusively.
--
-- IDEMPOTENT BY CONSTRUCTION. Governed staging already reached this exact posture
-- through the P2 parity migration, so applying this there is a confirmation rather than
-- a change: ENABLE ROW LEVEL SECURITY on an RLS-enabled table is a no-op, and
-- REVOKE-then-GRANT converges on the same ACL from either starting point.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 0 — service_role MUST exist and MUST bypass RLS.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- The backend reaches Postgres exclusively through the service-role client. With RLS on
-- and zero policies, service_role can only read and write this table because it bypasses
-- RLS. Without that, the grants below would leave the table unusable by the application.
DO $pk_service_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      '[issue-101-pk] service_role is absent or lacks BYPASSRLS; with RLS on and zero policies the backend could not read or write public_keys. Refusing to change any privilege.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$pk_service_role$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 1 — public_keys MUST match the MEASURED production shape.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- The whole point of this migration is that it is narrow. Narrow is only safe if the
-- object in front of us is the object that was measured. The expected string below is
-- the exact column list from run 31774496416 — name, type, nullability and default, in
-- ordinal order — so a renamed column, a reordered column, a changed type, a dropped
-- NOT NULL or an added column all fail here, before any privilege moves.
--
-- private_key_pem at ordinal 4 is part of the assertion. It is what distinguishes the
-- deploy-hardening-schema.js lineage production actually has from the 004+005 lineage,
-- which appends that column last. Applying a narrow hardening to the wrong lineage is
-- precisely the mistake this refuses to make.
DO $pk_shape$
DECLARE
  v_expected text :=
    'id:text:NO:;'
    'user_id:text:NO:;'
    'public_key_pem:text:NO:;'
    'private_key_pem:text:YES:;'
    'key_type:text:YES:''secp256k1''::text;'
    'status:text:YES:''ACTIVE''::text;'
    'created_at:text:NO:;'
    'revoked_at:text:YES:';
  v_actual text;
BEGIN
  IF to_regclass('public.public_keys') IS NULL THEN
    RAISE EXCEPTION
      '[issue-101-pk] public.public_keys does not exist. This migration hardens an existing measured relation and never creates one.'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT string_agg(
           column_name || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''),
           ';' ORDER BY ordinal_position)
    INTO v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_keys';

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      '[issue-101-pk] public_keys shape does not match the measured production structure (run 31774496416). Refusing to apply a narrow hardening to an unrecognised table. expected=[%] actual=[%]',
      v_expected, v_actual
      USING ERRCODE = 'datatype_mismatch';
  END IF;
END
$pk_shape$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 2 — the constraints and BOTH cascades MUST already be in place.
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration must not silently run against a table whose referential behaviour
-- differs from production's. Both cascades are asserted as COMPLETE ENDPOINT SIGNATURES:
--
--   public.public_keys(user_id)                     -> public.users(id)
--   public.signature_verification_logs(public_key_id) -> public.public_keys(id)
--   both: ON DELETE c (CASCADE), ON UPDATE a (NO ACTION), MATCH s (SIMPLE)
--
-- Name plus referenced-relation is NOT sufficient and is not what is checked. conkey and
-- confkey are resolved through pg_attribute to real column NAMES, so a constraint with
-- the right name, the right referent and the right on-delete action but the WRONG
-- endpoint columns is refused. conrelid is asserted explicitly on both, so the incoming
-- check cannot be satisfied by a same-named foreign key attached to some other relation.
-- Arity is pinned too: a multi-column key with a matching first column is refused.
--
-- ON UPDATE and MATCH come from the same production receipt as ON DELETE and are part of
-- the signature, so a constraint that merely cascades on delete is not mistaken for the
-- measured one.
--
-- Neither cascade is altered below. They are asserted because withholding DELETE from
-- service_role is only safe while they behave as measured — a referential action runs
-- with the referencing table's OWNER privileges, not the caller's, so the cascades keep
-- working. The transition harness proves that behaviourally rather than trusting it.
DO $pk_constraints$
DECLARE
  v_missing  text[] := ARRAY[]::text[];
  v_expected text;
  v_actual   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.public_keys'::regclass
       AND conname = 'public_keys_pkey' AND contype = 'p'
  ) THEN v_missing := v_missing || 'public_keys_pkey (PRIMARY KEY)'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.public_keys'::regclass
       AND conname = 'public_keys_status_check' AND contype = 'c'
  ) THEN v_missing := v_missing || 'public_keys_status_check (CHECK)'; END IF;

  -- ── OUTGOING: public_keys.user_id -> users.id
  v_expected := 'public.public_keys(user_id) -> public.users(id) ON DELETE c ON UPDATE a MATCH s';
  SELECT rn.nspname || '.' || rc.relname
         || '(' || (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) || ')'
         || ' -> ' || fn.nspname || '.' || fc.relname
         || '(' || (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                      FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) || ')'
         || ' ON DELETE ' || c.confdeltype::text
         || ' ON UPDATE ' || c.confupdtype::text
         || ' MATCH ' || c.confmatchtype::text
    INTO v_actual
    FROM pg_constraint c
    JOIN pg_class rc ON rc.oid = c.conrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    JOIN pg_class fc ON fc.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = fc.relnamespace
   WHERE c.conname = 'public_keys_user_id_fkey'
     AND c.contype = 'f'
     AND c.conrelid = 'public.public_keys'::regclass
     AND array_length(c.conkey, 1) = 1
     AND array_length(c.confkey, 1) = 1;

  IF v_actual IS NULL THEN
    v_missing := v_missing || format('public_keys_user_id_fkey absent, or not a single-column FK on public.public_keys; expected %L', v_expected);
  ELSIF v_actual <> v_expected THEN
    v_missing := v_missing || format('public_keys_user_id_fkey is %L, expected %L', v_actual, v_expected);
  END IF;

  -- ── INCOMING: signature_verification_logs.public_key_id -> public_keys.id
  -- conrelid is pinned here, so a same-named constraint on another relation cannot
  -- satisfy this check.
  v_expected := 'public.signature_verification_logs(public_key_id) -> public.public_keys(id) ON DELETE c ON UPDATE a MATCH s';
  v_actual := NULL;
  SELECT rn.nspname || '.' || rc.relname
         || '(' || (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) || ')'
         || ' -> ' || fn.nspname || '.' || fc.relname
         || '(' || (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                      FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) || ')'
         || ' ON DELETE ' || c.confdeltype::text
         || ' ON UPDATE ' || c.confupdtype::text
         || ' MATCH ' || c.confmatchtype::text
    INTO v_actual
    FROM pg_constraint c
    JOIN pg_class rc ON rc.oid = c.conrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    JOIN pg_class fc ON fc.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = fc.relnamespace
   WHERE c.conname = 'signature_verification_logs_public_key_id_fkey'
     AND c.contype = 'f'
     AND c.conrelid = 'public.signature_verification_logs'::regclass
     AND c.confrelid = 'public.public_keys'::regclass
     AND array_length(c.conkey, 1) = 1
     AND array_length(c.confkey, 1) = 1;

  IF v_actual IS NULL THEN
    v_missing := v_missing || format('signature_verification_logs_public_key_id_fkey absent, or not a single-column FK on public.signature_verification_logs referencing public.public_keys; expected %L', v_expected);
  ELSIF v_actual <> v_expected THEN
    v_missing := v_missing || format('signature_verification_logs_public_key_id_fkey is %L, expected %L', v_actual, v_expected);
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      '[issue-101-pk] expected constraint(s) absent or altered: %. Refusing to harden a relation whose referential behaviour differs from the measurement.',
      array_to_string(v_missing, '; ')
      USING ERRCODE = 'undefined_object';
  END IF;
END
$pk_constraints$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HARDENING — two controls, one transaction.
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS closes ordinary SELECT/INSERT/UPDATE/DELETE for anon and authenticated. It is
-- already enabled in production, so this statement is a confirming no-op there; it is
-- restated so the end state is stated in one place rather than assumed from history.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT touched. It constrains the table OWNER
-- rather than ordinary roles, it is false on every production table today, and changing
-- it is a separate decision with its own blast radius.
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated policy is created. Default-deny is the intended end state:
-- there is no public consumer of key material, and a policy here would be a way in.

-- REVOKE is the ONLY control for TRUNCATE, which RLS does not govern and which both API
-- roles currently hold in production.
REVOKE ALL ON TABLE public.public_keys FROM anon, authenticated;

-- service_role is revoked FIRST and then granted exactly what the application uses.
-- This ordering is not decoration: Supabase projects carry permissive ALTER DEFAULT
-- PRIVILEGES, so service_role may already hold ALL, and a GRANT alone would narrow
-- nothing. Revoking first makes the resulting ACL exactly what is written here,
-- whatever the starting point was.
--
-- SELECT, INSERT and UPDATE are what backend/services/blockchain/blockchainService.js
-- actually calls. DELETE and TRUNCATE are withheld. That does NOT break either cascade,
-- because a referential action executes with the referencing table's owner privileges
-- rather than those of the role that issued the DELETE.
REVOKE ALL ON TABLE public.public_keys FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.public_keys TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- POSTCONDITION — prove the end state before the transaction may commit.
-- ─────────────────────────────────────────────────────────────────────────────
-- A half-applied privilege change is worse than a failed one. If any assertion here
-- fails, the whole transaction rolls back and public_keys keeps whatever posture it
-- had, rather than a partial mixture of old and new.
DO $pk_postcondition$
DECLARE
  v_rls      boolean;
  v_policies integer;
  v_api      integer;
  v_svc      text;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c WHERE c.oid = 'public.public_keys'::regclass;

  SELECT count(*) INTO v_policies
    FROM pg_policy WHERE polrelid = 'public.public_keys'::regclass;

  SELECT count(*) INTO v_api
    FROM unnest(ARRAY['anon', 'authenticated']) AS r(role),
         unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
   WHERE has_table_privilege(r.role, 'public.public_keys', p.priv);

  SELECT coalesce(string_agg(p.priv, ',' ORDER BY p.priv), 'none') INTO v_svc
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p(priv)
   WHERE has_table_privilege('service_role', 'public.public_keys', p.priv);

  IF NOT v_rls THEN
    RAISE EXCEPTION '[issue-101-pk] RLS is not enabled on public_keys after hardening';
  END IF;
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '[issue-101-pk] expected 0 policies on public_keys, found %', v_policies;
  END IF;
  IF v_api <> 0 THEN
    RAISE EXCEPTION
      '[issue-101-pk] % anon/authenticated privilege(s) survive on public_keys; expected 0 (TRUNCATE included, since RLS does not govern it)',
      v_api;
  END IF;
  IF v_svc <> 'INSERT,SELECT,UPDATE' THEN
    RAISE EXCEPTION
      '[issue-101-pk] service_role privileges are "%", expected exactly "INSERT,SELECT,UPDATE" (DELETE and TRUNCATE withheld)',
      v_svc;
  END IF;
END
$pk_postcondition$;

-- +migrate Down
-- Reversing this would re-grant anon and authenticated full DML — including the
-- ungoverned TRUNCATE — on a table holding cryptographic key material. That is the
-- exposure this migration exists to close, so reversal is a DELIBERATE OPERATOR ACTION
-- rather than an executable Down.
--
-- The reverse shape, for reference only:
--   GRANT ALL ON TABLE public.public_keys TO anon, authenticated;  -- re-opens the exposure
--   GRANT ALL ON TABLE public.public_keys TO service_role;
--   -- RLS was already enabled BEFORE this migration in production; do NOT disable it.
--
-- The pre-change ACL is recorded in the committed receipt
-- database/parity/receipts/production-public-keys-run31774496416.json, which is the
-- rollback source of truth. Forward-fix is preferred: every statement above is
-- catalog-only and individually reversible with a targeted GRANT.
SELECT 1;

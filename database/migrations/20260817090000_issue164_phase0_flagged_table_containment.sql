-- +migrate Up
-- =============================================================================
-- ISSUE #164 — CANONICAL VEHICLE TRUTH CLOSURE, PHASE 0
-- Containment of the 23 public tables that carry RLS DISABLED together with
-- full anon + authenticated DML.
-- =============================================================================
--
-- MEASURED EVIDENCE THIS CLOSES (staging ref eoyenigwevnxwwhyhaer, PostgreSQL 17.6):
--   23 tables in the public schema have rowsecurity = false AND grant
--   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER to BOTH
--   anon and authenticated. Those two roles are the Supabase Data API roles, so
--   the grants are reachable by anyone holding the publishable (browser) key.
--   Row counts are small (0-7), which bounds the disclosure but NOT the write
--   exposure: an empty kyc_profiles is still an insertable, truncatable table.
--
-- TWO CONTROLS ARE REQUIRED PER TABLE, NOT ONE. Enabling RLS closes ordinary
-- SELECT/INSERT/UPDATE/DELETE for anon and authenticated, but RLS NEVER GOVERNS
-- TRUNCATE — and all 23 carry the TRUNCATE bit for both roles. REVOKE is the only
-- control for it. Both run in ONE transaction (the runner wraps each migration in
-- BEGIN/COMMIT), so no window exists where one is applied without the other.
--
-- WHY EACH GRANT CLASS IS REMOVED:
--   SELECT     — discloses identity, credential and tenant data to any browser key.
--   INSERT     — lets an unauthenticated caller forge compliance, KYC and fraud rows.
--   UPDATE     — lets a caller rewrite verification verdicts and role assignments.
--   DELETE     — lets a caller erase audit and claim history.
--   TRUNCATE   — destroys a whole table in one statement and is NOT governed by RLS.
--   REFERENCES — lets a caller attach foreign keys that pin rows against deletion.
--   TRIGGER    — lets a caller attach executable code to a table the backend writes.
--   MAINTAIN   — PostgreSQL 17 adds it; information_schema cannot report it, so an
--                enumerated revoke would silently leave it behind. REVOKE ALL takes it.
--
-- PUBLIC IS REVOKED ALONGSIDE WHICHEVER DATA API ROLES EXIST, and that is load-bearing
-- rather than decorative: a privilege held by PUBLIC is held by every role, so revoking
-- only anon and authenticated would leave the exposure open through inheritance and would
-- make the postcondition below unsatisfiable. PUBLIC is unconditional — it is a built-in
-- pseudo-role that is always present, so it never depends on the role probe below.
--
-- ZERO POLICIES ARE CREATED, AND THAT IS THE CORRECT END STATE — DO NOT "FIX" IT.
-- The CarUp backend reaches PostgreSQL exclusively through the service-role client
-- (backend/db/supabase.js), and service_role BYPASSES RLS, so every backend read and
-- write on these tables continues to work with no policy present. No live product
-- surface reads any of the 23 with the browser anon key: web/, mobile/ and shared/
-- contain zero references to any of them, and the single live anon-key call in the
-- frontend is a token-based signed-URL storage upload that no table grant affects.
-- A permissive policy added here would therefore not restore a broken feature — it
-- would re-open the exposure this migration exists to close. The Supabase advisor's
-- "RLS enabled, no policy" warning is expected on all 23 and is the intended posture.
-- Any table that later needs a genuine authenticated-actor policy is named in
-- docs/canonical-vehicle-truth/RLS_AUDIT.md and is Phase 6/8 work, not a hotfix.
--
-- FORCE ROW LEVEL SECURITY IS DELIBERATELY OMITTED. It constrains the table OWNER
-- rather than the API roles, and the API roles are the entire threat here. Forcing it
-- with zero policies would deny the owner (postgres) as well, breaking owner-rights
-- views, SECURITY DEFINER functions and dump/restore, while buying no containment
-- against anon or authenticated. This matches the standing decision recorded in
-- 20260814090000_issue101_p0_rls_and_view_hardening.sql.
--
-- service_role is explicitly re-granted on every table touched. It already holds these
-- privileges; BYPASSRLS defeats row security but does NOT confer table grants, so
-- restating them is what makes this migration self-evidently non-breaking. Narrowing
-- service_role is out of scope: this change contains the API roles, it does not
-- re-scope the backend.
--
-- FORWARD-ONLY AND CATALOG-ONLY. No table is created or dropped, no row is read,
-- written, rewritten or truncated. Every statement is a privilege or flag change.
--
-- IDEMPOTENT BY CONSTRUCTION. ENABLE ROW LEVEL SECURITY on an already-enabled table is
-- a no-op, REVOKE converges on the same ACL from any starting point, and a table that
-- is absent is skipped with a NOTICE rather than an error — so a fresh database and
-- staging both apply cleanly.
--
-- ANON AND AUTHENTICATED ARE RESOLVED INDEPENDENTLY, NEVER AS A PAIR. A database may hold
-- both, either or neither, and naming an absent role in REVOKE or has_table_privilege is a
-- hard ERROR rather than a no-op — so a probe that only asks "does at least one exist?"
-- would admit a single-role database and then abort mid-migration on the missing one.
-- Every statement below is built from the roles pg_catalog.pg_roles actually reports, so a
-- database carrying one of the two is fully contained for that one and skips the other.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 0 — the role model must be the one that was measured.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- Three distinct situations, deliberately handled differently:
--
--   · anon and authenticated BOTH absent — there is no Supabase Data API in front of
--     this database, so there is no exposure to contain. Enabling RLS on 23 tables
--     whose access model we cannot see would be a change with no security benefit and
--     a non-zero chance of denying some other non-owner role. Skip the whole migration.
--
--   · exactly ONE of them present — a real state for a partially provisioned or
--     locally-bootstrapped database. That one role is a live Data API identity and is
--     contained in full; the absent one is not an exposure and is not named in any
--     statement. This is a NOTICE, not a failure.
--
--   · at least one Data API role exists — then service_role MUST exist and MUST bypass
--     RLS, because that bypass is the only reason enabling RLS with zero policies leaves
--     the backend working. This runs BEFORE any change, so a failure leaves no table
--     partially contained.
DO $issue164_roles$
DECLARE
  v_api_roles text[];
BEGIN
  SELECT array_agg(rolname::text ORDER BY rolname)
    INTO v_api_roles
    FROM pg_catalog.pg_roles
   WHERE rolname IN ('anon', 'authenticated');

  IF v_api_roles IS NULL THEN
    RAISE NOTICE '[issue-164-p0] anon and authenticated are both absent — no Supabase Data API to contain; nothing to do.';
    RETURN;
  END IF;

  IF array_length(v_api_roles, 1) < 2 THEN
    RAISE NOTICE '[issue-164-p0] only one Data API role is present (%) — containing that role alone; the other is absent and is not named in any statement.',
      array_to_string(v_api_roles, ', ');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      '[issue-164-p0] service_role is absent or lacks BYPASSRLS; with RLS enabled and zero policies the backend could not read or write these tables. Refusing to change any privilege.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$issue164_roles$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTAINMENT — revoke the API-role grants, enable RLS, restate service_role.
-- ─────────────────────────────────────────────────────────────────────────────
DO $issue164_contain$
DECLARE
  -- The 23 measured relations, grouped by WHY each cohort is contained. The applied
  -- containment is identical for all 23; the grouping is the reviewable rationale, and
  -- it is what docs/canonical-vehicle-truth/RLS_AUDIT.md rows up against.
  c_targets text[] := ARRAY[
    -- Identity, session and device trust. kyc_profiles alone holds national_id_number,
    -- date_of_birth, legal names and address; trusted_devices holds device_fingerprint.
    -- Raw identity must never be reachable by a browser key.
    'kyc_profiles', 'device_sessions', 'trusted_devices', 'role_switch_logs',
    -- Tenant control plane. tenant_api_keys holds key_hash — a credential store. Flags
    -- and branding decide what a tenant may do and what a customer is shown, so write
    -- access is an authorization and impersonation break, not a cosmetic one.
    'tenant_api_keys', 'tenant_branding', 'tenant_feature_flags',
    -- Organization directory and RBAC. organization_users/roles/permissions ARE the
    -- authorization model; anon UPDATE on them is privilege escalation by definition.
    'organization_profiles', 'organization_roles', 'organization_users',
    'organization_permissions', 'organization_branches', 'organization_departments',
    'organization_settings', 'organization_ai_agents',
    -- Regulated financial and insurance records, and the counterparty profiles the
    -- trust and finance engines read. Forged rows here become real money decisions.
    'insurance_records', 'insurance_claims', 'stakeholder_profiles',
    -- Compliance, fraud and registry evidence. These carry verification verdicts; a
    -- caller who can write them can manufacture a clean vehicle or bury a fraud alert.
    'compliance_reports', 'fraud_alerts', 'registry_verifications',
    -- Operational telemetry. No consumer outside the backend, and vehicle_telemetry is
    -- vehicle-linked movement data.
    'server_health', 'vehicle_telemetry'
  ];
  v_table     text;
  v_oid       regclass;
  v_absent    text[] := ARRAY[]::text[];
  v_applied   integer := 0;
  v_api_roles text[];
  -- The revocation target list, assembled from roles that exist. PUBLIC always leads it.
  v_revokees  text;
BEGIN
  SELECT array_agg(rolname::text ORDER BY rolname)
    INTO v_api_roles
    FROM pg_catalog.pg_roles
   WHERE rolname IN ('anon', 'authenticated');

  IF v_api_roles IS NULL THEN
    RETURN;
  END IF;

  SELECT 'PUBLIC' || string_agg(', ' || quote_ident(r), '' ORDER BY r)
    INTO v_revokees
    FROM unnest(v_api_roles) AS r;

  FOREACH v_table IN ARRAY c_targets LOOP
    v_oid := to_regclass('public.' || quote_ident(v_table));

    -- A fresh database has not created every one of these yet. Absence is a legitimate
    -- state, not a failure: there is nothing to contain, so record it and move on.
    IF v_oid IS NULL THEN
      v_absent := v_absent || v_table;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    -- %s, not %I: v_revokees is a pre-quoted list, and PUBLIC is a keyword that must NOT
    -- be quoted or it would name an ordinary role. Its only inputs are the literals
    -- 'anon' and 'authenticated' as filtered from pg_roles above.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', v_table, v_revokees);
    -- REVOKE ALL at table level also clears any column-level grant on that table, so no
    -- separate column sweep is needed; the postcondition proves it rather than assumes it.
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);

    v_applied := v_applied + 1;
  END LOOP;

  IF array_length(v_absent, 1) > 0 THEN
    RAISE NOTICE '[issue-164-p0] % of 23 target table(s) absent — skipped: %',
      array_length(v_absent, 1), array_to_string(v_absent, ', ');
  END IF;
  RAISE NOTICE '[issue-164-p0] contained % table(s): RLS enabled, grants removed from %.',
    v_applied, v_revokees;
END
$issue164_contain$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POSTCONDITION — prove the end state before the transaction may commit.
-- ─────────────────────────────────────────────────────────────────────────────
-- A half-applied privilege change is worse than a failed one. If any assertion here
-- fails, the whole transaction rolls back and all 23 keep whatever posture they had,
-- rather than a partial mixture of old and new.
DO $issue164_postcondition$
DECLARE
  c_targets text[] := ARRAY[
    'kyc_profiles', 'device_sessions', 'trusted_devices', 'role_switch_logs',
    'tenant_api_keys', 'tenant_branding', 'tenant_feature_flags',
    'organization_profiles', 'organization_roles', 'organization_users',
    'organization_permissions', 'organization_branches', 'organization_departments',
    'organization_settings', 'organization_ai_agents',
    'insurance_records', 'insurance_claims', 'stakeholder_profiles',
    'compliance_reports', 'fraud_alerts', 'registry_verifications',
    'server_health', 'vehicle_telemetry'
  ];
  -- MAINTAIN exists only from PostgreSQL 17. has_table_privilege RAISES on an
  -- unrecognised privilege name, so asking for it on an older engine would turn a
  -- passing migration into an error unrelated to the exposure.
  c_privs text[] := CASE
    WHEN current_setting('server_version_num')::int >= 170000
      THEN ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
      ELSE ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  END;
  -- Only these four can be held at column level; the rest are table-only.
  c_col_privs text[] := ARRAY['SELECT','INSERT','UPDATE','REFERENCES'];
  -- has_table_privilege and has_column_privilege RAISE on a role name that does not
  -- exist, so the assertions below iterate the roles this database actually has. Every
  -- role present is checked; a role that is absent holds no privilege to survive.
  v_api_roles text[];
  v_open_rls  text;
  v_api       text;
  v_api_cols  text;
  v_policies  text;
  v_svc_lost  text;
BEGIN
  SELECT array_agg(rolname::text ORDER BY rolname)
    INTO v_api_roles
    FROM pg_catalog.pg_roles
   WHERE rolname IN ('anon', 'authenticated');

  IF v_api_roles IS NULL THEN
    RETURN;
  END IF;

  -- 1. RLS is on for every target that exists.
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_open_rls
    FROM unnest(c_targets) AS t(name)
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
   WHERE NOT c.relrowsecurity;

  -- 2. Not one privilege survives for any API role present, across every class the engine
  --    tracks. has_table_privilege resolves inherited PUBLIC grants too, so this also
  --    proves the PUBLIC revoke landed.
  SELECT string_agg(t.name || '.' || r.role || '.' || p.priv, ', ' ORDER BY t.name, r.role, p.priv)
    INTO v_api
    FROM unnest(c_targets) AS t(name)
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
   CROSS JOIN unnest(v_api_roles) AS r(role)
   CROSS JOIN unnest(c_privs) AS p(priv)
   WHERE has_table_privilege(r.role, c.oid, p.priv);

  -- 3. No column-level residue either. A table-level REVOKE ALL clears these, but a
  --    column grant is invisible to every table-level check, so it is proven directly.
  SELECT string_agg(DISTINCT t.name || '.' || a.attname || '.' || r.role, ', ')
    INTO v_api_cols
    FROM unnest(c_targets) AS t(name)
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   CROSS JOIN unnest(v_api_roles) AS r(role)
   CROSS JOIN unnest(c_col_privs) AS p(priv)
   WHERE has_column_privilege(r.role, c.oid, a.attnum, p.priv);

  -- 4. Default-deny is the intended end state. A policy on any of these would mean
  --    someone re-opened a read path the header explicitly forbids re-opening.
  SELECT string_agg(t.name || ':' || pol.polname, ', ' ORDER BY t.name, pol.polname)
    INTO v_policies
    FROM unnest(c_targets) AS t(name)
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
    JOIN pg_policy pol ON pol.polrelid = c.oid;

  -- 5. The backend must be able to keep working. Thirteen of the 23 carry live
  --    service-role table calls in backend/, and losing a grant here would be an outage.
  SELECT string_agg(t.name || '.' || p.priv, ', ' ORDER BY t.name, p.priv)
    INTO v_svc_lost
    FROM unnest(c_targets) AS t(name)
    JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
   CROSS JOIN unnest(c_privs) AS p(priv)
   WHERE NOT has_table_privilege('service_role', c.oid, p.priv);

  IF v_open_rls IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p0] RLS is still disabled after containment on: %', v_open_rls
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_api IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p0] anon/authenticated privilege(s) survive (expected none, across every class including TRUNCATE and MAINTAIN): %', v_api
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_api_cols IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p0] column-level anon/authenticated grant(s) survive: %', v_api_cols
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_policies IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p0] policy(ies) present on contained table(s): %. Default-deny with zero policies is the intended end state — see this migration''s header before adding one.', v_policies
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_svc_lost IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164-p0] service_role LOST required privilege(s): %. The backend reads and writes these tables through the service-role client.', v_svc_lost
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$issue164_postcondition$;

-- +migrate Down
-- Reversing this would re-grant anon and authenticated full DML — including the
-- ungoverned TRUNCATE — on tables holding national identity numbers, hashed tenant API
-- keys, device fingerprints and the organization authorization model. That is the
-- exposure this migration exists to close, so reversal is a DELIBERATE OPERATOR ACTION
-- rather than an executable Down.
--
-- The reverse shape, for reference only:
--   ALTER TABLE public.<each of the 23> DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON TABLE public.<each of the 23> TO anon, authenticated;  -- re-opens it
--
-- Capture the pre-change grant matrix with the read-only inventory query in
-- docs/canonical-vehicle-truth/RLS_AUDIT.md BEFORE applying, and use that receipt as the
-- rollback source of truth. Forward-fix is preferred: every statement above is
-- catalog-only and individually reversible with a targeted GRANT.
SELECT 1;

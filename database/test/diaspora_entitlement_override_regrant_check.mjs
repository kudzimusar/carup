/**
 * Diaspora ledger #26 — entitlement override re-grant, verified by EXECUTING the RPCs on real
 * PostgreSQL 17.5 (PGlite). Issue #127.
 *
 * The claim under test is not "the function runs". It is that a REVOKED override can be granted
 * again — which was impossible, on real Postgres, for a reason no in-memory mock can be trusted to
 * reproduce: `uq_diaspora_user_override UNIQUE (tenant_id, user_id, feature_key)` has no
 * `WHERE deleted_at IS NULL`, so a soft-deleted row keeps the unique slot forever. So this harness
 * first REPRODUCES the failure against the real constraint (a raw INSERT after a soft delete must
 * raise SQLSTATE 23505), and only then shows ledger #26 turning that same situation into a restore.
 *
 * Also verified, because each is a way the fix could be hollow:
 *   · atomicity — the row change and its audit row roll back together;
 *   · the ON CONFLICT path specifically, which is what survives the race the FOR UPDATE lock cannot
 *     cover (two first-grants, where there is no row to lock);
 *   · tenant scoping — an apply/revoke naming tenant A never touches tenant B's override;
 *   · the ACL contract, under the Supabase DEFAULT PRIVILEGES hazard. Postgres grants EXECUTE on new
 *     functions to PUBLIC by default AND Supabase adds default grants for anon/authenticated, so a
 *     migration that merely creates a SECURITY DEFINER function ships it executable by every client
 *     role. The bootstrap installs those default grants deliberately, so a missing REVOKE fails here.
 *
 * Harness shim: PGlite has no pgcrypto, so extensions.digest() is stubbed. No assertion depends on
 * the seal being cryptographic.
 *
 * Run:  node database/test/diaspora_entitlement_override_regrant_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGERS = {
  12: '20260621120000_diaspora_phase8_subscription_entitlements.sql',
  26: '20260731090000_diaspora_entitlement_override_regrant.sql',
};

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};

function sectionOf(file, which = 'up') {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  const body = which === 'up'
    ? (idx >= 0 ? raw.slice(0, idx) : raw)
    : (idx >= 0 ? raw.slice(idx) : '');
  return body
    .replace('-- +migrate Up', '')
    .replace('-- +migrate Down', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- [harness] pgcrypto stubbed');
}
const sha12 = (file) => createHash('sha256').update(readFileSync(join(MIG, file), 'utf-8')).digest('hex').slice(0, 12);

async function exec(db, label, sql, expectPass = true) {
  try { await db.exec(sql); return record(label, expectPass); }
  catch (e) { return record(label, !expectPass, String(e.message || e)); }
}

/** Run SQL expecting a specific SQLSTATE. Returns true when that exact code was raised. */
async function expectSqlState(db, label, sql, params, code) {
  try {
    await db.query(sql, params);
    return record(label, false, `expected SQLSTATE ${code}, statement succeeded`);
  } catch (e) {
    const got = e?.cause?.code || e?.code || null;
    return record(label, got === code, `expected ${code}, got ${got ?? 'none'}: ${String(e.message || e)}`);
  }
}

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;

  -- Supabase's DEFAULT PRIVILEGES hazard, installed on purpose. New public-schema tables AND
  -- functions arrive already granted to the client roles, so a migration that forgets to REVOKE
  -- ships a service-role-only RPC that anon can call. Vanilla Postgres would hide that.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea
    LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1 || ':' || $2, 'UTF8') $$;
  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;

  CREATE TABLE IF NOT EXISTS public.users (id text PRIMARY KEY, role text);
  CREATE TABLE IF NOT EXISTS public.tenant_users (user_id text, tenant_id uuid);
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_current_user_id()
  RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '') $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_platform_admin(
    actor_id text DEFAULT public.diaspora_trade_os_current_user_id()
  ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT actor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u
      WHERE u.id = actor_id AND lower(coalesce(u.role,'')) IN ('admin','platform_admin','super_admin')) $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_users tu WHERE tu.user_id = actor_id AND tu.tenant_id = requested_tenant_id) $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_can_access_row(
    row_tenant_id uuid, row_created_by text, row_updated_by text DEFAULT NULL::text
  ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT public.diaspora_trade_os_is_platform_admin()
      OR public.diaspora_trade_os_current_user_id() = row_created_by
      OR public.diaspora_trade_os_current_user_id() = row_updated_by
      OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), row_tenant_id) $$;

  CREATE TABLE IF NOT EXISTS public.diaspora_import_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, tenant_id uuid, actor_id text,
    action text, resource_type text, resource_id text, previous_state jsonb, new_state jsonb,
    metadata jsonb, cryptographic_seal text, created_at timestamptz DEFAULT now());
`;

const db = new PGlite();
console.log('Diaspora ledger #26 — entitlement override re-grant, real-Postgres behaviour');
for (const [n, f] of Object.entries(LEDGERS)) console.log(`  ledger #${n} sha256:12 = ${sha12(f)}`);
console.log('');

await exec(db, 'bootstrap: Supabase-compat env (incl. DEFAULT PRIVILEGES hazard)', BOOTSTRAP);
await exec(db, 'ledger #12 applies (the table + the constraint that causes this)', sectionOf(LEDGERS[12]));
if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER = 'user-x';
const FEATURE = 'diaspora.audit.export';
const ADMIN = 'admin-1';

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => Number((await one(sql, params)).n);

// ── The premise: the constraint really does not exempt soft-deleted rows ────────────────────────
{
  const idx = await one(`
    SELECT i.indisunique, (i.indpred IS NULL) AS unconditional
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_diaspora_user_override'`);
  record('uq_diaspora_user_override is UNIQUE', idx?.indisunique === true);
  record('uq_diaspora_user_override has NO deleted_at predicate (this is the bug)',
    idx?.unconditional === true);

  const lookup = await one(`
    SELECT i.indisunique
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_diaspora_overrides_tenant_user'`);
  record('idx_diaspora_overrides_tenant_user is a plain index and enforces nothing',
    lookup?.indisunique === false);
}

// ── Reproduce the original failure on real Postgres, pre-#26 ────────────────────────────────────
{
  await db.query(
    `INSERT INTO public.diaspora_user_entitlement_overrides (tenant_id, user_id, feature_key, value, created_by, updated_by)
     VALUES ($1,$2,$3,'true'::jsonb,$4,$4)`, [TENANT_A, USER, FEATURE, ADMIN]);
  await db.query(
    `UPDATE public.diaspora_user_entitlement_overrides SET deleted_at = now()
      WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3`, [TENANT_A, USER, FEATURE]);

  record('pre-#26: the revoked override is invisible to a deleted_at IS NULL read',
    (await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides
                   WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3 AND deleted_at IS NULL`,
    [TENANT_A, USER, FEATURE])) === 0);

  // Exactly what applyAdminOverride used to do next. This 23505 became a DatabaseError 500, and the
  // capability was ungrantable for that user and feature from then on.
  await expectSqlState(db,
    'pre-#26: re-granting via INSERT raises 23505 — the override can never come back',
    `INSERT INTO public.diaspora_user_entitlement_overrides (tenant_id, user_id, feature_key, value, created_by, updated_by)
     VALUES ($1,$2,$3,'true'::jsonb,$4,$4)`, [TENANT_A, USER, FEATURE, ADMIN], '23505');

  // Clean slate for the post-#26 assertions.
  await db.query(`DELETE FROM public.diaspora_user_entitlement_overrides`);
  await db.query(`DELETE FROM public.diaspora_import_audit_log`);
}

await exec(db, 'ledger #26 applies', sectionOf(LEDGERS[26]));
if (!results.ok) {
  console.log('\nLEDGER #26 DID NOT APPLY:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

// ── Grant → revoke → re-grant, through the RPCs ─────────────────────────────────────────────────
let firstId = null;
{
  const granted = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,'pilot','corr-1') AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  firstId = granted.override.id;
  record('grant: outcome is GRANTED', granted.outcome === 'GRANTED');
  record('grant: audit row is ENTITLEMENT_OVERRIDE_GRANTED',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_OVERRIDE_GRANTED'`)) === 1);
  record('grant: the audit row carries the correlation id',
    (await one(`SELECT metadata->>'correlationId' AS c FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_OVERRIDE_GRANTED'`)).c === 'corr-1');

  const revoked = (await one(
    `SELECT public.diaspora_revoke_entitlement_override_atomic($1::uuid,$2,$3,$4,'pilot ended','corr-2') AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  record('revoke: outcome is REVOKED', revoked.outcome === 'REVOKED');
  record('revoke: deleted_at is stamped (soft delete, not a DELETE)', Boolean(revoked.override.deleted_at));
  record('revoke: audit row is ENTITLEMENT_OVERRIDE_REVOKED',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_OVERRIDE_REVOKED'`)) === 1);

  // THE assertion this ledger exists for.
  const regranted = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,'pilot resumed','corr-3') AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  record('re-grant: succeeds where the raw INSERT raised 23505', regranted.outcome === 'REGRANTED');
  record('re-grant: restores the SAME logical row', regranted.override.id === firstId);
  record('re-grant: deleted_at is cleared', regranted.override.deleted_at === null);
  record('re-grant: still exactly one row for the triple',
    (await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides
                   WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3`, [TENANT_A, USER, FEATURE])) === 1);
  record('re-grant: audited as REGRANTED, distinguishable from an ordinary edit',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_OVERRIDE_REGRANTED'`)) === 1);

  const regrantAudit = await one(
    `SELECT previous_state, new_state FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_OVERRIDE_REGRANTED'`);
  record('re-grant: the audit row records that it revived a revoked override',
    regrantAudit.previous_state?.revoked === true && regrantAudit.new_state?.revoked === false);

  const updated = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'false'::jsonb,$4,NULL,NULL) AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  record('update: changing a live value is UPDATED, not REGRANTED', updated.outcome === 'UPDATED');

  const unchanged = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'false'::jsonb,$4,NULL,NULL) AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  record('re-apply: an identical value reports UNCHANGED', unchanged.outcome === 'UNCHANGED');
}

// ── The ON CONFLICT path: the race the row lock cannot cover ────────────────────────────────────
{
  // When no row exists there is nothing to take FOR UPDATE, so two first-grants serialise on the
  // unique index instead. The loser reaches the INSERT with the row already present — this is that
  // caller's exact statement, and it must resolve rather than raise.
  const U2 = 'user-race';
  await db.query(
    `INSERT INTO public.diaspora_user_entitlement_overrides (tenant_id, user_id, feature_key, value, created_by, updated_by)
     VALUES ($1,$2,$3,'true'::jsonb,'someone-else','someone-else')`, [TENANT_A, U2, FEATURE]);
  const loser = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,NULL,NULL) AS r`,
    [TENANT_A, U2, FEATURE, ADMIN])).r;
  record('race: a first-grant that loses the insert race resolves to an update, not 23505',
    Boolean(loser?.override?.id));
  record('race: the loser did not create a second row',
    (await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides
                   WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3`, [TENANT_A, U2, FEATURE])) === 1);

  // Repeated re-grants converge: one row, still live, every time.
  await db.query(`SELECT public.diaspora_revoke_entitlement_override_atomic($1::uuid,$2,$3,$4,NULL,NULL)`,
    [TENANT_A, U2, FEATURE, ADMIN]);
  for (let i = 0; i < 5; i += 1) {
    await db.query(`SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,NULL,NULL)`,
      [TENANT_A, U2, FEATURE, ADMIN]);
  }
  const converged = await one(
    `SELECT count(*)::int AS n, bool_and(deleted_at IS NULL) AS live
       FROM public.diaspora_user_entitlement_overrides WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3`,
    [TENANT_A, U2, FEATURE]);
  record('race: five repeated re-grants converge on one live row',
    Number(converged.n) === 1 && converged.live === true);
}

// ── Atomicity: the row change and its audit row are one unit ────────────────────────────────────
{
  const U3 = 'user-atomic';
  const auditBefore = await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`);
  const rowsBefore = await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides`);
  try {
    await db.exec('BEGIN');
    await db.query(`SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,NULL,NULL)`,
      [TENANT_A, U3, FEATURE, ADMIN]);
    const midAudit = await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`);
    const midRows = await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides`);
    record('atomicity: both writes are visible INSIDE the open transaction',
      midAudit === auditBefore + 1 && midRows === rowsBefore + 1);
    await db.exec('ROLLBACK');
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    record('atomicity: both writes are visible INSIDE the open transaction', false, String(e.message || e));
  }
  const afterAudit = await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`);
  const afterRows = await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides`);
  record('atomicity: on ROLLBACK the override and its audit row vanish TOGETHER',
    afterAudit === auditBefore && afterRows === rowsBefore);
}

// ── Tenant scoping ──────────────────────────────────────────────────────────────────────────────
{
  await db.query(
    `INSERT INTO public.diaspora_user_entitlement_overrides (tenant_id, user_id, feature_key, value, created_by, updated_by)
     VALUES ($1,$2,$3,'true'::jsonb,'admin-b','admin-b')`, [TENANT_B, USER, FEATURE]);

  // Same user, same feature, different tenant: the apply must create tenant A's own row and leave B alone.
  await db.query(`DELETE FROM public.diaspora_user_entitlement_overrides WHERE tenant_id=$1 AND user_id=$2`,
    [TENANT_A, USER]);
  const scoped = (await one(
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'false'::jsonb,$4,NULL,NULL) AS r`,
    [TENANT_A, USER, FEATURE, ADMIN])).r;
  record('tenant scoping: the new row belongs to the tenant named in the call',
    scoped.override.tenant_id === TENANT_A);
  const b = await one(`SELECT value, deleted_at FROM public.diaspora_user_entitlement_overrides
                        WHERE tenant_id=$1 AND user_id=$2 AND feature_key=$3`, [TENANT_B, USER, FEATURE]);
  record("tenant scoping: tenant B's override for the same user+feature is untouched",
    b.value === true && b.deleted_at === null);

  // Revoking in a tenant with no such override must be a clean, named failure — not a silent success
  // and not a reach into whichever tenant happens to have one.
  await expectSqlState(db,
    'tenant scoping: revoking a triple that does not exist raises OVERRIDE_NOT_FOUND',
    `SELECT public.diaspora_revoke_entitlement_override_atomic($1::uuid,'ghost',$2,$3,NULL,NULL)`,
    [TENANT_A, FEATURE, ADMIN], 'P0001');
}

// ── Revoke idempotency ──────────────────────────────────────────────────────────────────────────
{
  const U4 = 'user-idem';
  await db.query(`SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,$4,NULL,NULL)`,
    [TENANT_A, U4, FEATURE, ADMIN]);
  const first = (await one(`SELECT public.diaspora_revoke_entitlement_override_atomic($1::uuid,$2,$3,$4,NULL,NULL) AS r`,
    [TENANT_A, U4, FEATURE, ADMIN])).r;
  const second = (await one(`SELECT public.diaspora_revoke_entitlement_override_atomic($1::uuid,$2,$3,$4,NULL,NULL) AS r`,
    [TENANT_A, U4, FEATURE, ADMIN])).r;
  record('revoke idempotency: the second call reports ALREADY_REVOKED',
    second.outcome === 'ALREADY_REVOKED' && second.idempotentReplay === true);
  record('revoke idempotency: deleted_at is NOT rewritten (it records when access was withdrawn)',
    second.override.deleted_at === first.override.deleted_at);
  record('revoke idempotency: no second audit row for a no-op',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log
                   WHERE action='ENTITLEMENT_OVERRIDE_REVOKED' AND resource_id=$1`, [first.override.id])) === 1);
}

// ── Input guards: an override is a security decision, so it must be attributable ────────────────
{
  await expectSqlState(db, 'guard: an override with no actor is refused',
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,'true'::jsonb,NULL,NULL,NULL)`,
    [TENANT_A, 'user-guard', FEATURE], 'P0001');
  await expectSqlState(db, 'guard: an override with no tenant is refused',
    `SELECT public.diaspora_apply_entitlement_override_atomic(NULL,$1,$2,'true'::jsonb,$3,NULL,NULL)`,
    ['user-guard', FEATURE, ADMIN], 'P0001');
  await expectSqlState(db, 'guard: an override with no value is refused',
    `SELECT public.diaspora_apply_entitlement_override_atomic($1::uuid,$2,$3,NULL,$4,NULL,NULL)`,
    [TENANT_A, 'user-guard', FEATURE, ADMIN], 'P0001');
}

// ── ACL + search_path contract, under the DEFAULT PRIVILEGES hazard ─────────────────────────────
{
  const FNS = [
    'diaspora_apply_entitlement_override_atomic',
    'diaspora_revoke_entitlement_override_atomic',
  ];
  for (const fn of FNS) {
    const acl = await one(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
             p.prosecdef AS secdef,
             array_to_string(p.proconfig, ',') AS cfg
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname=$1`, [fn]);
    record(`${fn}: anon has NO execute`, acl.anon === false);
    record(`${fn}: authenticated has NO execute`, acl.authed === false);
    record(`${fn}: service_role CAN execute`, acl.svc === true);
    record(`${fn}: is SECURITY DEFINER`, acl.secdef === true);
    record(`${fn}: search_path is pinned and includes extensions`,
      typeof acl.cfg === 'string' && acl.cfg.includes('search_path=') && acl.cfg.includes('extensions'));
  }

  const pub = await all(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname = ANY($1)
       AND has_function_privilege('public', p.oid, 'EXECUTE')`, [FNS]);
  record('neither function is executable by PUBLIC', pub.length === 0);
}

// ── Down script ─────────────────────────────────────────────────────────────────────────────────
{
  await exec(db, 'ledger #26 down script drops both functions', sectionOf(LEDGERS[26], 'down'));
  const left = await count(`
    SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('diaspora_apply_entitlement_override_atomic','diaspora_revoke_entitlement_override_atomic')`);
  record('after down: neither function remains', left === 0);
  const rows = await count(`SELECT count(*)::int n FROM public.diaspora_user_entitlement_overrides`);
  record('after down: ledger #12 data is untouched (the down drops functions only)', rows > 0);
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
const passed = results.checks.filter((c) => c.status === 'PASS').length;
console.log('');
for (const c of results.checks) {
  console.log(`  ${c.status === 'PASS' ? '✓' : '✗'} ${c.label}${c.detail && c.status === 'FAIL' ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${passed}/${results.checks.length} checks passed`);
await db.close();
process.exit(results.ok ? 0 : 1);

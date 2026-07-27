/**
 * Diaspora go-to-market activation — real-Postgres migration + ACL contract verification (Issue #127).
 *
 * Runs against PGlite (real PostgreSQL 17.5 compiled to WASM) — no daemon, no Docker, no Supabase,
 * and never a production connection string. PG17 is what matters here: it is the version that added
 * the MAINTAIN table privilege, which `information_schema.role_table_grants` CANNOT report. An
 * information_schema-based gate would therefore pass while `anon` still held invisible maintenance
 * rights — the exact class of gap that required compensating ledgers #17, #19 and #20. Every
 * privilege assertion below uses has_table_privilege(), which reports EFFECTIVE rights (including
 * privileges inherited through PUBLIC).
 *
 * What this proves for ledger #21:
 *   1. It applies cleanly ON TOP of Supabase's ALTER DEFAULT PRIVILEGES (modelled faithfully: new
 *      public-schema tables are granted directly to anon/authenticated/service_role, which is the
 *      real reason #17/#19/#20 were needed).
 *   2. The ACL contract holds for every new table: PUBLIC=NONE, anon=NONE, authenticated=NONE,
 *      service_role=ALL — across all EIGHT PG17 table privileges, plus column-level ACLs.
 *   3. RLS is ENABLED with ZERO policies (default-deny) on every new table.
 *   4. The money-safety and secret-safety invariants are enforced by the SCHEMA, not by application
 *      code: self-approval is unrepresentable, a token-shaped vault reference is rejected, and every
 *      idempotency/provider-reference uniqueness guard actually holds under a concurrent-style
 *      duplicate insert.
 *   5. Up → Down → Up is clean, and Up applied twice is a no-op (true idempotency).
 *
 * Run:  node database/test/diaspora_gtm_migration_check.mjs
 * Exit: 0 = every assertion passed; 1 = at least one failed (fail-closed).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRATION_FILE = '20260727120000_diaspora_gtm_activation_foundation.sql';

// Every table ledger #21 creates. All eight are service-role-only ledgers.
const NEW_TABLES = [
  'diaspora_safetrade_provider_events',
  'diaspora_safetrade_operations',
  'diaspora_safetrade_approvals',
  'diaspora_workbook_import_confirmations',
  'diaspora_workbook_import_receipts',
  'diaspora_credential_references',
  'diaspora_drive_sync_attempts',
  'diaspora_billing_reconciliation_runs',
];

// PG17's complete table-privilege set. MAINTAIN is the one information_schema cannot see.
const PG17_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const CLIENT_ROLES = ['anon', 'authenticated'];

const results = { checks: [], ok: true };

function record(label, passed, detail = null) {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
}

async function expectReject(db, label, sql, expectedFragment) {
  try {
    await db.exec(sql);
    record(label, false, 'statement was ACCEPTED but should have been rejected');
  } catch (e) {
    const msg = String(e.message || e);
    const matched = !expectedFragment || msg.toLowerCase().includes(expectedFragment.toLowerCase());
    record(label, matched, matched ? null : `rejected, but not for the expected reason: ${msg}`);
  }
}

async function expectAccept(db, label, sql) {
  try {
    await db.exec(sql);
    record(label, true);
  } catch (e) {
    record(label, false, String(e.message || e));
  }
}

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down, raw };
}

// ── Supabase-compatible bootstrap ────────────────────────────────────────────
// The ALTER DEFAULT PRIVILEGES block is the whole point: it reproduces the platform behaviour that
// silently grants every newly created public-schema table to anon and authenticated. Ledger #21 is
// only correct if it closes that grant in the same transaction that creates the tables.
const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;

  -- Supabase's platform default privileges (the root cause behind ledgers #17/#19/#20).
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

  -- Prerequisite from ledger #3 (Phase 1B): the shared updated_at trigger helper.
  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;

  -- Prerequisite from ledger #12 (Phase 8): the billing event ledger #21 adds columns to.
  CREATE TABLE IF NOT EXISTS public.diaspora_billing_provider_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature_verified boolean NOT NULL DEFAULT false,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_diaspora_billing_event UNIQUE (provider, event_id)
  );
`;

const db = new PGlite();
const { up, down, raw } = splitMigration(MIGRATION_FILE);

// The exact checksum the ledger row and the staging applier freeze on.
const checksum = createHash('sha256').update(raw).digest('hex').slice(0, 12);

console.log(`Diaspora ledger #21 — ${MIGRATION_FILE}`);
console.log(`sha256:12 = ${checksum}`);
console.log(`PGlite = real PostgreSQL (server_version reported below)\n`);

await expectAccept(db, 'bootstrap: Supabase-compat roles + ALTER DEFAULT PRIVILEGES + prerequisites', BOOTSTRAP);

const pgVersion = (await db.query('SHOW server_version')).rows[0].server_version;
record('postgres major version is 17+ (MAINTAIN privilege exists)', parseInt(pgVersion, 10) >= 17, `server_version=${pgVersion}`);

// ── Prove the default-privilege hazard is REAL in this harness ───────────────
// If this check fails, the harness is not actually modelling Supabase and every ACL assertion below
// would be vacuously true.
await expectAccept(db, 'control: create a table with NO explicit grants', `
  CREATE TABLE public.__acl_control (id int);
`);
{
  const leaked = [];
  for (const role of CLIENT_ROLES) {
    for (const priv of PG17_TABLE_PRIVS) {
      const { rows } = await db.query('SELECT has_table_privilege($1, $2, $3) AS h', [role, 'public.__acl_control', priv]);
      if (rows[0].h) leaked.push(`${role}:${priv}`);
    }
  }
  record(
    'control: an ungranted table DOES leak privileges to anon/authenticated (harness models Supabase)',
    leaked.length > 0,
    `leaked=${leaked.join(',') || 'NONE — harness is not modelling Supabase default privileges'}`,
  );
}
await db.exec('DROP TABLE public.__acl_control;');

// ── 1. Apply Up ──────────────────────────────────────────────────────────────
await expectAccept(db, 'ledger #21 Up applies cleanly', up);

// ── 2. Every table exists ────────────────────────────────────────────────────
for (const t of NEW_TABLES) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
  record(`table exists: ${t}`, rows.length === 1);
}

// ── 3. ACL contract, all EIGHT PG17 privileges, via has_table_privilege ──────
for (const t of NEW_TABLES) {
  const held = { PUBLIC: [], anon: [], authenticated: [], service_role: [] };
  for (const priv of PG17_TABLE_PRIVS) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query('SELECT has_table_privilege($1, $2, $3) AS h', [role, `public.${t}`, priv]);
      if (rows[0].h) held[role].push(priv);
    }
    // PUBLIC is not a role has_table_privilege accepts; read it out of the ACL directly.
    const { rows: aclRows } = await db.query(
      `SELECT coalesce(array_to_string(relacl, ','), '') AS acl FROM pg_class
       WHERE oid = $1::regclass`, [`public.${t}`]);
    if (/(^|,)=[a-zA-Z]/.test(aclRows[0].acl)) held.PUBLIC.push(priv);
  }
  record(`ACL ${t}: PUBLIC = NONE`, held.PUBLIC.length === 0, `held=${held.PUBLIC.join(',')}`);
  record(`ACL ${t}: anon = NONE (incl. MAINTAIN)`, held.anon.length === 0, `held=${held.anon.join(',')}`);
  record(`ACL ${t}: authenticated = NONE (incl. MAINTAIN)`, held.authenticated.length === 0, `held=${held.authenticated.join(',')}`);
  record(`ACL ${t}: service_role = ALL 8`, held.service_role.length === PG17_TABLE_PRIVS.length, `held=${held.service_role.join(',')}`);
}

// ── 4. Column-level ACLs — a column grant would survive a table-level REVOKE ──
{
  const { rows } = await db.query(
    `SELECT c.relname, a.attname, a.attacl::text AS acl
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY($1) AND a.attacl IS NOT NULL`, [NEW_TABLES]);
  record('no column-level ACLs on any new table', rows.length === 0,
    rows.map((r) => `${r.relname}.${r.attname}=${r.acl}`).join(' | '));
}

// ── 5. RLS enabled, ZERO policies (default-deny) ─────────────────────────────
for (const t of NEW_TABLES) {
  const { rows: rls } = await db.query(
    `SELECT relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1`, [t]);
  record(`RLS enabled: ${t}`, rls[0]?.enabled === true);
  const { rows: pol } = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t]);
  record(`RLS zero policies (default-deny): ${t}`, pol[0].n === 0, `policies=${pol[0].n}`);
}

// ── 6. Additive columns landed on the pre-existing billing ledger ────────────
for (const col of ['occurred_at', 'provider_sequence', 'superseded']) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='diaspora_billing_provider_events' AND column_name=$1`, [col]);
  record(`additive column diaspora_billing_provider_events.${col}`, rows.length === 1);
}

// ── 7. Money-safety invariants enforced by the SCHEMA ────────────────────────
const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
// Actor identities are TEXT throughout the Diaspora schema (tenants are uuid) — ledger #21
// matches that convention so real ids like 'user-reviewer' are storable.
const U1 = 'user-evaluator';
const U2 = 'user-approver';
const TXN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ST-3 item 2 — maker-checker: the evaluator can NEVER approve their own release.
await expectReject(db, 'maker-checker: self-approval is rejected by the DB', `
  INSERT INTO public.diaspora_safetrade_approvals
    (tenant_id, transaction_id, decision_type, requested_by, approved_by, approved_at, state)
  VALUES ('${T1}', '${TXN}', 'release', '${U1}', '${U1}', now(), 'approved');
`, 'no_self_approve');

await expectAccept(db, 'maker-checker: a DIFFERENT approver is accepted', `
  INSERT INTO public.diaspora_safetrade_approvals
    (tenant_id, transaction_id, decision_type, requested_by, approved_by, approved_at, state)
  VALUES ('${T1}', '${TXN}', 'release', '${U1}', '${U2}', now(), 'approved');
`);

await expectReject(db, 'maker-checker: state=approved without an approver is rejected', `
  INSERT INTO public.diaspora_safetrade_approvals
    (tenant_id, transaction_id, decision_type, requested_by, state)
  VALUES ('${T1}', '${TXN}', 'refund', '${U1}', 'approved');
`, 'shape');

// ST-3 item 4 — durable webhook de-duplication.
await expectAccept(db, 'webhook ledger: first delivery of an event is accepted', `
  INSERT INTO public.diaspora_safetrade_provider_events (provider, event_id, event_type, signature_verified)
  VALUES ('sandbox', 'evt_1', 'release.succeeded', true);
`);
await expectReject(db, 'webhook ledger: duplicate (provider, event_id) is rejected', `
  INSERT INTO public.diaspora_safetrade_provider_events (provider, event_id, event_type, signature_verified)
  VALUES ('sandbox', 'evt_1', 'release.succeeded', true);
`, 'uq_diaspora_safetrade_provider_event');

// ST-3 item 3 — operation idempotency + provider-reference uniqueness.
await expectAccept(db, 'operation ledger: first operation is accepted', `
  INSERT INTO public.diaspora_safetrade_operations (tenant_id, operation, idempotency_key, provider, provider_ref, amount, currency)
  VALUES ('${T1}', 'release', 'idem-1', 'sandbox', 'sbx_rel_1', 100.00, 'USD');
`);
await expectReject(db, 'operation ledger: duplicate idempotency key in the same tenant is rejected', `
  INSERT INTO public.diaspora_safetrade_operations (tenant_id, operation, idempotency_key, provider)
  VALUES ('${T1}', 'release', 'idem-1', 'sandbox');
`, 'uq_diaspora_safetrade_operation_idem');
await expectAccept(db, 'operation ledger: the SAME idempotency key in a DIFFERENT tenant is allowed', `
  INSERT INTO public.diaspora_safetrade_operations (tenant_id, operation, idempotency_key, provider)
  VALUES ('${T2}', 'release', 'idem-1', 'sandbox');
`);
await expectReject(db, 'operation ledger: a provider reference cannot be claimed twice', `
  INSERT INTO public.diaspora_safetrade_operations (tenant_id, operation, idempotency_key, provider, provider_ref)
  VALUES ('${T2}', 'refund', 'idem-2', 'sandbox', 'sbx_rel_1');
`, 'uq_diaspora_safetrade_operation_provider_ref');
await expectReject(db, 'operation ledger: a negative amount is rejected', `
  INSERT INTO public.diaspora_safetrade_operations (tenant_id, operation, idempotency_key, provider, amount)
  VALUES ('${T2}', 'refund', 'idem-3', 'sandbox', -1);
`, 'amount');

// Deliverable B — a confirmation is bound to the workbook checksum + revision.
const BATCH = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
await expectAccept(db, 'confirmed import: a pending confirmation is accepted', `
  INSERT INTO public.diaspora_workbook_import_confirmations
    (tenant_id, batch_id, workbook_checksum, dry_run_revision, confirmed_by, expires_at, idempotency_key)
  VALUES ('${T1}', '${BATCH}', 'sha256:abc', 1, '${U1}', now() + interval '15 min', 'confirm-1');
`);
await expectReject(db, 'confirmed import: a second LIVE confirmation for the same checksum+revision is rejected', `
  INSERT INTO public.diaspora_workbook_import_confirmations
    (tenant_id, batch_id, workbook_checksum, dry_run_revision, confirmed_by, expires_at, idempotency_key)
  VALUES ('${T1}', '${BATCH}', 'sha256:abc', 1, '${U1}', now() + interval '15 min', 'confirm-2');
`, 'uq_diaspora_workbook_confirmation_live');
await expectAccept(db, 'confirmed import: a CHANGED workbook (new checksum) gets its own confirmation', `
  INSERT INTO public.diaspora_workbook_import_confirmations
    (tenant_id, batch_id, workbook_checksum, dry_run_revision, confirmed_by, expires_at, idempotency_key)
  VALUES ('${T1}', '${BATCH}', 'sha256:CHANGED', 1, '${U1}', now() + interval '15 min', 'confirm-3');
`);
await expectReject(db, 'confirmed import: duplicate submit (same idempotency key) is rejected', `
  INSERT INTO public.diaspora_workbook_import_confirmations
    (tenant_id, batch_id, workbook_checksum, dry_run_revision, confirmed_by, expires_at, idempotency_key)
  VALUES ('${T1}', '${BATCH}', 'sha256:other', 2, '${U1}', now() + interval '15 min', 'confirm-1');
`, 'uq_diaspora_workbook_confirmation_idem');

// Deliverable C — the credential store cannot hold a credential.
const SECRET_SHAPES = [
  ['google refresh token', '1//0eXaMpLeReFrEsHtOkEnNotReal'],
  ['google access token', 'ya29.a0ExAmPlEnOtReAl'],
  ['provider live key', 'sk_live_exampleNotARealKey00'],
  ['provider test key', 'sk_test_exampleNotARealKey00'],
  ['webhook signing secret', 'whsec_exampleNotARealSecret0'],
  ['google api key', 'AIzaExampleNotARealKey000000'],
  ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig'],
  ['pem private key', '-----BEGIN PRIVATE KEY-----'],
];
for (const [label, value] of SECRET_SHAPES) {
  await expectReject(db, `vault refs: a ${label} is rejected as a vault reference`, `
    INSERT INTO public.diaspora_credential_references (tenant_id, purpose, vault_backend, vault_reference)
    VALUES ('${T1}', 'google_drive', 'gcp_secret_manager', '${value.replace(/'/g, "''")}');
  `, 'not_a_secret');
}
await expectAccept(db, 'vault refs: an opaque vault handle is accepted', `
  INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference, scopes)
  VALUES ('${T1}', '${U1}', 'google_drive', 'gcp_secret_manager',
          'gcpsm://projects/carup/secrets/diaspora-drive-t1-u1', ARRAY['drive.file']);
`);
await expectReject(db, 'vault refs: a second ACTIVE credential for the same (tenant,user,purpose) is rejected', `
  INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference)
  VALUES ('${T1}', '${U1}', 'google_drive', 'gcp_secret_manager', 'gcpsm://projects/carup/secrets/other');
`, 'uq_diaspora_credential_active');
await expectAccept(db, 'vault refs: a REVOKED credential does not block a new active one (history preserved)', `
  UPDATE public.diaspora_credential_references SET status='revoked', revoked_at=now()
   WHERE tenant_id='${T1}' AND user_id='${U1}' AND purpose='google_drive';
  INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference)
  VALUES ('${T1}', '${U1}', 'google_drive', 'gcp_secret_manager', 'gcpsm://projects/carup/secrets/rotated');
`);

// Deliverable C — Drive sync attempt idempotency.
await expectAccept(db, 'drive sync: first attempt is accepted', `
  INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key)
  VALUES ('${T1}', 'upload', 'drive-idem-1');
`);
await expectReject(db, 'drive sync: duplicate idempotency key in the same tenant is rejected', `
  INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key)
  VALUES ('${T1}', 'upload', 'drive-idem-1');
`, 'uq_diaspora_drive_attempt_idem');

// Deliverable B — per-row receipts are unique per (batch, row, attempt).
await expectAccept(db, 'receipts: a row receipt is accepted', `
  INSERT INTO public.diaspora_workbook_import_receipts (tenant_id, batch_id, row_number, outcome)
  VALUES ('${T1}', '${BATCH}', 1, 'accepted');
`);
await expectReject(db, 'receipts: a duplicate (batch,row,attempt) receipt is rejected', `
  INSERT INTO public.diaspora_workbook_import_receipts (tenant_id, batch_id, row_number, outcome)
  VALUES ('${T1}', '${BATCH}', 1, 'compensated');
`, 'uq_diaspora_workbook_receipt_row');
await expectAccept(db, 'receipts: a retry (attempt 2) of the same row is accepted', `
  INSERT INTO public.diaspora_workbook_import_receipts (tenant_id, batch_id, row_number, attempt, outcome)
  VALUES ('${T1}', '${BATCH}', 1, 2, 'accepted');
`);
await expectReject(db, 'receipts: an unknown outcome is rejected', `
  INSERT INTO public.diaspora_workbook_import_receipts (tenant_id, batch_id, row_number, attempt, outcome)
  VALUES ('${T1}', '${BATCH}', 9, 1, 'totally-imported-honest');
`, 'outcome');

// ── 8. updated_at triggers fire ──────────────────────────────────────────────
{
  await db.exec(`UPDATE public.diaspora_safetrade_operations SET state='reconciling' WHERE idempotency_key='idem-1' AND tenant_id='${T1}';`);
  const { rows } = await db.query(
    `SELECT (updated_at >= created_at) AS ok FROM public.diaspora_safetrade_operations
      WHERE idempotency_key='idem-1' AND tenant_id='${T1}'`);
  record('updated_at trigger fires on diaspora_safetrade_operations', rows[0]?.ok === true);
}

// ── 9. Idempotency: Up applied a SECOND time is a clean no-op ────────────────
await expectAccept(db, 'ledger #21 Up is idempotent (re-applied on top of itself)', up);
{
  // Re-application must not have wiped the rows inserted above. Exactly two operation inserts were
  // ACCEPTED earlier (tenant-1 idem-1, tenant-2 idem-1); the other three were correctly rejected.
  const { rows } = await db.query('SELECT count(*)::int AS n FROM public.diaspora_safetrade_operations');
  record('idempotent re-apply preserved existing rows', rows[0].n === 2, `rows=${rows[0].n}`);
  // …nor re-opened the grants.
  const leaked = [];
  for (const t of NEW_TABLES) {
    for (const role of CLIENT_ROLES) {
      for (const priv of PG17_TABLE_PRIVS) {
        const { rows: r } = await db.query('SELECT has_table_privilege($1, $2, $3) AS h', [role, `public.${t}`, priv]);
        if (r[0].h) leaked.push(`${t}:${role}:${priv}`);
      }
    }
  }
  record('idempotent re-apply did not re-open client grants', leaked.length === 0, leaked.join(','));
}

// ── 10. Down → clean, then Up again → clean (rollback safety) ────────────────
await expectAccept(db, 'ledger #21 Down applies cleanly', down);
{
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
    [NEW_TABLES]);
  record('Down removed every table it created', rows[0].n === 0, `remaining=${rows[0].n}`);
  const { rows: cols } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='diaspora_billing_provider_events'
        AND column_name IN ('occurred_at','provider_sequence','superseded')`);
  record('Down removed the additive billing columns', cols[0].n === 0, `remaining=${cols[0].n}`);
  const { rows: pre } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name='diaspora_billing_provider_events'`);
  record('Down left the pre-existing ledger #12 table intact', pre[0].n === 1);
}
await expectAccept(db, 'ledger #21 Up re-applies cleanly after Down', up);
{
  const leaked = [];
  for (const t of NEW_TABLES) {
    for (const role of CLIENT_ROLES) {
      for (const priv of PG17_TABLE_PRIVS) {
        const { rows } = await db.query('SELECT has_table_privilege($1, $2, $3) AS h', [role, `public.${t}`, priv]);
        if (rows[0].h) leaked.push(`${t}:${role}:${priv}`);
      }
    }
  }
  record('ACL contract still holds after Down→Up (grants closed at CREATE time)', leaked.length === 0, leaked.join(','));
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  console.log('');
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
  console.log('');
}
console.log(JSON.stringify({ migration: MIGRATION_FILE, checksum, pgVersion, ok: results.ok, total: results.checks.length, failed: failed.length }, null, 2));
process.exit(results.ok ? 0 : 1);

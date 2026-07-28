/**
 * Diaspora GTM Drive lane — the JS opaque-reference gate and the SQL CHECK must agree (Issue #127).
 *
 * `diaspora_credential_references` refuses credential-shaped values in Postgres
 * (ck_diaspora_credential_reference_not_a_secret, ledger #21). `assertOpaqueReference` refuses them in
 * JavaScript, before the value can reach a driver, a query log or a bound parameter.
 *
 * Two implementations of one rule is defence in depth — right up until they drift. This harness runs
 * ONE corpus through BOTH on real PostgreSQL 17.5 (PGlite) and asserts the verdicts match, with the
 * asymmetry stated explicitly:
 *
 *     SQL rejects  ⟹  JS must reject      (the dangerous direction — a JS gap lets a real credential
 *                                          reach the driver before Postgres saves us)
 *     JS rejects   ⇏  SQL must reject      (JS is allowed to be stricter, and is)
 *
 * The corpus is ASSEMBLED AT RUNTIME rather than written as literals, so this file needs no CR-1
 * allow-list entry. A negative-assertion harness that has to be exempted from the secret scanner is a
 * permanent hole exactly where a real credential is most likely to be pasted one day.
 *
 * Run:  node database/test/diaspora_drive_vault_reference_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  SQL_MIRROR_PATTERNS,
  ADDITIONAL_REFERENCE_PATTERNS,
  VAULT_REFERENCE_MIN_LENGTH,
  VAULT_REFERENCE_MAX_LENGTH,
} from '../../backend/services/diaspora/drive/driveVaultRegex.js';
import { assertOpaqueReference } from '../../backend/services/diaspora/drive/credentialVault.js';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGER_21 = '20260727120000_diaspora_gtm_activation_foundation.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};

function upOf(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw)
    .replace('-- +migrate Up', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- [harness] pgcrypto stubbed');
}
const sha12 = (file) => createHash('sha256').update(readFileSync(join(MIG, file), 'utf-8')).digest('hex').slice(0, 12);

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  -- Supabase's default privileges are what ledger #21 has to close in the same migration.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea
    LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1 || ':' || $2, 'UTF8') $$;
  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;

  CREATE TABLE IF NOT EXISTS public.diaspora_import_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, deleted_at timestamptz);
  CREATE TABLE IF NOT EXISTS public.diaspora_import_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, tenant_id uuid, actor_id text,
    action text, resource_type text, resource_id text, previous_state jsonb, new_state jsonb,
    metadata jsonb, cryptographic_seal text, created_at timestamptz DEFAULT now());
  CREATE TABLE IF NOT EXISTS public.diaspora_billing_provider_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, provider text NOT NULL,
    event_id text NOT NULL, event_type text, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature_verified boolean NOT NULL DEFAULT false, processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_diaspora_billing_event UNIQUE (provider, event_id));
  CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, deleted_at timestamptz);
`;

const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * The corpus, assembled from fragments so no credential-shaped literal is committed.
 * `expectSqlReject` records what the CHECK constraint is supposed to do with each value.
 */
const j = (...parts) => parts.join('');
const CORPUS = [
  // ── SQL must reject these ──────────────────────────────────────────────────
  { label: 'google oauth refresh token', value: j('1', '/', '/', '0gHARNESSNOTAREALTOKEN0123456789'), expectSqlReject: true },
  { label: 'google oauth access token', value: j('ya', '29', '.', 'a0HARNESSNOTAREALTOKEN0123456789'), expectSqlReject: true },
  { label: 'stripe live secret key', value: j('sk', '_live_', 'HARNESSNOTAREALKEY0123456789'), expectSqlReject: true },
  { label: 'stripe test secret key', value: j('sk', '_test_', 'HARNESSNOTAREALKEY0123456789'), expectSqlReject: true },
  { label: 'stripe restricted key', value: j('rk', '_live_', 'HARNESSNOTAREALKEY0123456789'), expectSqlReject: true },
  { label: 'stripe publishable live key', value: j('pk', '_live_', 'HARNESSNOTAREALKEY0123456789'), expectSqlReject: true },
  { label: 'webhook signing secret', value: j('wh', 'sec_', 'HARNESSNOTAREALSECRET0123456'), expectSqlReject: true },
  { label: 'google api key', value: j('AI', 'za', 'HARNESSNOTAREALKEY0123456789012345'), expectSqlReject: true },
  { label: 'jwt', value: j('ey', 'JhbGciOiJSUzI1NiJ9', '.', 'eyJhIjoxfQ', '.', 'sig'), expectSqlReject: true },
  { label: 'pem private key header', value: j('-----', 'BEGIN', ' PRIVATE KEY-----'), expectSqlReject: true },
  { label: 'pem block not at the start of the value', value: j('handle:', '-----', 'BEGIN', ' RSA PRIVATE KEY-----'), expectSqlReject: true },

  // ── SQL accepts these; JS must accept them too (no over-blocking) ──────────
  { label: 'in-memory vault handle', value: 'memvault://google_drive/2f6c1b9a0e7d4c3b8a1f', expectSqlReject: false },
  { label: 'gcp secret manager path', value: 'gcpsm://projects/carup/secrets/drive-refresh-user-1/versions/3', expectSqlReject: false },
  { label: 'aws secrets manager arn', value: 'aws-sm://arn:aws:secretsmanager:eu-west-1:123456789012:secret:drive/user-1', expectSqlReject: false },
  { label: 'hashicorp vault path', value: 'vault:v1:kv/data/carup/drive/user-1', expectSqlReject: false },
  { label: 'env handle', value: 'env://GOOGLE_DRIVE_REFRESH_TOKEN_DEV', expectSqlReject: false },
  { label: 'a handle that merely mentions a prefix mid-string', value: 'memvault://google_drive/ya29-lookalike-but-not-a-token', expectSqlReject: false },

  // ── JS-only strictness: SQL accepts, JS is allowed to refuse ──────────────
  { label: 'google client secret (JS-only rule)', value: j('GOC', 'SPX', '-', 'HARNESSNOTAREALSECRET'), expectSqlReject: false },
  { label: 'aws access key id (JS-only rule)', value: j('AK', 'IA', 'HARNESSNOTAREALID'), expectSqlReject: false },
  { label: 'bearer header (JS-only rule)', value: 'Bearer harness-not-a-real-token-value', expectSqlReject: false },
];

const db = new PGlite();
console.log('Diaspora GTM Drive lane — vault-reference gate: JS mirror vs real-Postgres CHECK');
console.log(`  ledger #21 sha256:12 = ${sha12(LEDGER_21)}`);
console.log('');

try {
  await db.exec(BOOTSTRAP);
  record('bootstrap: Supabase-compatible environment', true);
} catch (e) {
  record('bootstrap: Supabase-compatible environment', false, String(e.message || e));
}
try {
  await db.exec(upOf(LEDGER_21));
  record('ledger #21 applies on PostgreSQL 17.5', true);
} catch (e) {
  record('ledger #21 applies on PostgreSQL 17.5', false, String(e.message || e));
}
if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

/** Does Postgres refuse this vault_reference? */
async function sqlRejects(value) {
  try {
    await db.query(
      `INSERT INTO public.diaspora_credential_references (tenant_id, purpose, vault_backend, vault_reference)
       VALUES ($1, 'google_drive', 'gcp_secret_manager', $2)`,
      [TENANT, value],
    );
    // Clean up so the partial unique index does not interfere with the next accepted value.
    await db.query(`DELETE FROM public.diaspora_credential_references WHERE vault_reference = $1`, [value]);
    return { rejected: false, constraint: null };
  } catch (e) {
    return { rejected: true, constraint: String(e.constraint || e.message || '') };
  }
}

/** Does the JS gate refuse it? */
function jsRejects(value) {
  try {
    assertOpaqueReference(value);
    return { rejected: false, code: null };
  } catch (e) {
    return { rejected: true, code: e.code };
  }
}

// ── The corpus, through both gates ──────────────────────────────────────────
let dangerousDrift = 0;
for (const { label, value, expectSqlReject } of CORPUS) {
  const sql = await sqlRejects(value);
  const js = jsRejects(value);

  record(`SQL: ${label} — CHECK verdict matches the migration's intent`,
    sql.rejected === expectSqlReject,
    `expected rejected=${expectSqlReject}, got ${sql.rejected} (${sql.constraint})`);

  // THE assertion. A JS gap here means a real credential reaches the driver before Postgres saves us.
  const drift = sql.rejected && !js.rejected;
  if (drift) dangerousDrift += 1;
  record(`MIRROR: ${label} — JS never accepts what SQL rejects`, !drift,
    `sql.rejected=${sql.rejected} js.rejected=${js.rejected}`);

  if (!expectSqlReject && !value.startsWith('GOC') && !value.startsWith('AK') && !value.startsWith('Bearer')) {
    record(`NO OVER-BLOCK: ${label} — a legitimate opaque handle is accepted by both`,
      !sql.rejected && !js.rejected, `sql=${sql.rejected} js=${js.rejected}`);
  }
}
record('no dangerous drift anywhere in the corpus', dangerousDrift === 0, `count=${dangerousDrift}`);

// ── The mirror list is still exactly what the deployed constraint says ──────
{
  const { rows } = await db.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'diaspora_credential_references'
       AND c.conname = 'ck_diaspora_credential_reference_not_a_secret'`);
  const definition = rows[0]?.def || '';
  record('the not-a-secret CHECK exists on the deployed table', Boolean(definition));
  for (const { name, sql } of SQL_MIRROR_PATTERNS) {
    // The definition Postgres reports doubles backslashes; compare on the unescaped fragment.
    const fragment = sql.replace(/\\\\/g, '\\');
    record(`the CHECK still contains the "${name}" fragment the JS list mirrors`,
      definition.includes(fragment), `looking for ${fragment} in ${definition.slice(0, 200)}`);
  }
}

// ── Length bounds ───────────────────────────────────────────────────────────
{
  const short = 'ab';
  const long = 'x'.repeat(VAULT_REFERENCE_MAX_LENGTH + 1);
  const atMax = 'x'.repeat(VAULT_REFERENCE_MAX_LENGTH);
  record(`SQL rejects a reference shorter than ${VAULT_REFERENCE_MIN_LENGTH}`, (await sqlRejects(short)).rejected);
  record('JS rejects it too', jsRejects(short).rejected);
  record(`SQL rejects a reference longer than ${VAULT_REFERENCE_MAX_LENGTH}`, (await sqlRejects(long)).rejected);
  record('JS rejects it too', jsRejects(long).rejected);
  record('both accept a reference exactly at the maximum', !(await sqlRejects(atMax)).rejected && !jsRejects(atMax).rejected);
}

// ── The active-credential uniqueness rule ──────────────────────────────────
{
  await db.query(
    `INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference, status)
     VALUES ($1, 'user-1', 'google_drive', 'gcp_secret_manager', 'gcpsm://a/1', 'active')`, [TENANT]);
  let secondActiveRejected = false;
  try {
    await db.query(
      `INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference, status)
       VALUES ($1, 'user-1', 'google_drive', 'gcp_secret_manager', 'gcpsm://a/2', 'active')`, [TENANT]);
  } catch { secondActiveRejected = true; }
  record('only ONE active credential per (tenant, user, purpose)', secondActiveRejected);

  // A superseded row may coexist — history is kept, not overwritten.
  await db.query(`UPDATE public.diaspora_credential_references SET status='revoked' WHERE vault_reference='gcpsm://a/1'`);
  let historyKept = true;
  try {
    await db.query(
      `INSERT INTO public.diaspora_credential_references (tenant_id, user_id, purpose, vault_backend, vault_reference, status)
       VALUES ($1, 'user-1', 'google_drive', 'gcp_secret_manager', 'gcpsm://a/2', 'active')`, [TENANT]);
  } catch { historyKept = false; }
  record('a revoked row and a new active row coexist (history survives a reconnect)', historyKept);
}

// ── The attempts table: idempotency and the state vocabulary ───────────────
{
  await db.query(
    `INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key)
     VALUES ($1, 'upload', 'idem-1')`, [TENANT]);
  let duplicateRejected = false;
  try {
    await db.query(
      `INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key)
       VALUES ($1, 'upload', 'idem-1')`, [TENANT]);
  } catch { duplicateRejected = true; }
  record('drive sync attempts: (tenant_id, idempotency_key) is unique in the database', duplicateRejected);

  let badStateRejected = false;
  try {
    await db.query(
      `INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key, state)
       VALUES ($1, 'upload', 'idem-2', 'nearly_done')`, [TENANT]);
  } catch { badStateRejected = true; }
  record('drive sync attempts: an unknown state is refused by the CHECK', badStateRejected);

  let badOperationRejected = false;
  try {
    await db.query(
      `INSERT INTO public.diaspora_drive_sync_attempts (tenant_id, operation, idempotency_key)
       VALUES ($1, 'delete_everything', 'idem-3')`, [TENANT]);
  } catch { badOperationRejected = true; }
  record('drive sync attempts: an unknown operation is refused by the CHECK', badOperationRejected);
}

// ── Client roles hold nothing on either table ──────────────────────────────
for (const table of ['diaspora_credential_references', 'diaspora_drive_sync_attempts']) {
  const { rows } = await db.query(
    `SELECT relacl::text AS acl, relrowsecurity AS rls FROM pg_class WHERE relname = $1`, [table]);
  const acl = rows[0]?.acl || '';
  record(`${table}: anon holds no privilege`, !/[,{]anon=/.test(acl), `acl=${acl}`);
  record(`${table}: authenticated holds no privilege`, !/[,{]authenticated=/.test(acl), `acl=${acl}`);
  record(`${table}: RLS is enabled (default-deny second line)`, rows[0]?.rls === true);
}

// ── Report ─────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
}
console.log('');
console.log(JSON.stringify({
  ledger21: sha12(LEDGER_21),
  sqlMirrorPatterns: SQL_MIRROR_PATTERNS.length,
  jsOnlyPatterns: ADDITIONAL_REFERENCE_PATTERNS.length,
  ok: results.ok,
  total: results.checks.length,
  failed: failed.length,
}, null, 2));
process.exit(results.ok ? 0 : 1);

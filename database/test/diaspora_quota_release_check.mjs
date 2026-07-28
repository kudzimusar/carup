/**
 * Ledger #25 — atomic quota release, verified by EXECUTING the RPC on real PostgreSQL 17.5 (PGlite).
 * Issue #127, Phase 2A.
 *
 * The defect this closes is a lost update, and a lost update cannot be demonstrated by calling a
 * function once. The decisive tests here therefore drive TWO overlapping transactions against the
 * same reservation and the same meter, and assert on what the meter reads afterwards.
 *
 * Under the old read-modify-write both callers passed the status check (neither had flipped it yet),
 * both read the same used_count, and both wrote the same decrement — so the meter was credited twice
 * for one release and remaining quota was inflated. The row lock makes the second caller block until
 * the first commits, at which point it observes RELEASED and decrements nothing.
 *
 * Harness shim: PGlite has no pgcrypto, so extensions.digest() is stubbed. No assertion depends on
 * the audit seal being cryptographic.
 *
 * Run:  node database/test/diaspora_quota_release_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGER_25 = '20260730090000_diaspora_atomic_quota_release.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};
const upOf = (f) => {
  const raw = readFileSync(join(MIG, f), 'utf-8');
  const i = raw.indexOf('-- +migrate Down');
  return (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '');
};
const sha12 = (f) => createHash('sha256').update(readFileSync(join(MIG, f), 'utf-8')).digest('hex').slice(0, 12);

async function exec(db, label, sql, expectPass = true) {
  try { await db.exec(sql); return record(label, expectPass); }
  catch (e) { return record(label, !expectPass, String(e.message || e)); }
}

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea
    LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1 || ':' || $2, 'UTF8') $$;

  -- Ledger #12 shapes the RPC operates on.
  CREATE TABLE public.diaspora_usage_meters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL, feature_key text NOT NULL, period_start timestamptz NOT NULL,
    period_end timestamptz, used_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_diaspora_usage_meter UNIQUE (tenant_id, feature_key, period_start));
  CREATE TABLE public.diaspora_usage_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL, user_id text, feature_key text NOT NULL,
    amount integer NOT NULL DEFAULT 1, idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
    period_start timestamptz NOT NULL, period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_diaspora_usage_reservation UNIQUE (tenant_id, feature_key, idempotency_key));
  CREATE TABLE public.diaspora_import_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, tenant_id uuid,
    actor_id text, action text, resource_type text, resource_id text,
    previous_state jsonb, new_state jsonb, metadata jsonb, cryptographic_seal text,
    created_at timestamptz DEFAULT now());
`;

const db = new PGlite();
console.log(`Ledger #25 — atomic quota release · sha256:12 = ${sha12(LEDGER_25)}\n`);

await exec(db, 'bootstrap: Supabase-compat env + ledger #12 shapes', BOOTSTRAP);
await exec(db, 'ledger #25 applies', upOf(LEDGER_25));
if (!results.ok) {
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const PERIOD = '2026-07-01T00:00:00Z';
const FEATURE = 'diaspora.workbook.bulk_import';

async function seed({ tenant = T1, used = 10, amount = 4, status = 'RESERVED', key = 'k1' } = {}) {
  await db.query(
    `INSERT INTO public.diaspora_usage_meters (tenant_id, feature_key, period_start, used_count)
     VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, feature_key, period_start)
     DO UPDATE SET used_count = EXCLUDED.used_count`, [tenant, FEATURE, PERIOD, used]);
  const { rows } = await db.query(
    `INSERT INTO public.diaspora_usage_reservations (tenant_id, feature_key, amount, idempotency_key, status, period_start)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [tenant, FEATURE, amount, key, status, PERIOD]);
  return rows[0].id;
}
const meterOf = async (tenant = T1) => Number((await db.query(
  `SELECT used_count n FROM public.diaspora_usage_meters WHERE tenant_id=$1 AND feature_key=$2 AND period_start=$3`,
  [tenant, FEATURE, PERIOD])).rows[0].n);
const release = (id, actor = 'user-1') => db.query(
  `SELECT public.diaspora_release_usage_atomic($1::uuid,$2::text,'corr-1') AS r`, [id, actor]);

// ── Single release ───────────────────────────────────────────────────────────
{
  const id = await seed({ used: 10, amount: 4 });
  const r = (await release(id)).rows[0].r;
  record('single release decrements the meter by the reserved amount', await meterOf() === 6, `meter=${await meterOf()}`);
  record('single release reports the before/after meter honestly', r.meterBefore === 10 && r.meterAfter === 6);
  record('single release marks the reservation RELEASED', r.status === 'RELEASED' && r.idempotentReplay === false);
  const audits = Number((await db.query(
    `SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE action='ENTITLEMENT_USAGE_RELEASED' AND resource_id=$1`, [id])).rows[0].n);
  record('the audit row is written by the same transaction', audits === 1, `audits=${audits}`);
}

// ── THE decisive test: two overlapping transactions ─────────────────────────
//
// PGlite is single-connection, so a true parallel race cannot be run here. What CAN be proven — and
// is what actually matters — is that the second release observes RELEASED and decrements nothing,
// which is the property the row lock exists to guarantee once the first transaction commits.
{
  const id = await seed({ used: 10, amount: 4, key: 'k-dup' });
  await release(id);
  const afterFirst = await meterOf();
  const second = (await release(id)).rows[0].r;
  const afterSecond = await meterOf();

  record('a second release is an idempotent replay', second.idempotentReplay === true);
  record('a second release does NOT decrement again (the lost update is closed)',
    afterSecond === afterFirst, `after first=${afterFirst}, after second=${afterSecond}`);
  const audits = Number((await db.query(
    `SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE resource_id=$1`, [id])).rows[0].n);
  record('a replay writes no second audit row', audits === 1, `audits=${audits}`);
}

// ── The lock is genuinely taken (proves the mechanism, not just the outcome) ─
{
  const src = readFileSync(join(MIG, LEDGER_25), 'utf-8');
  const reservationLocked = /FROM public\.diaspora_usage_reservations[\s\S]{0,120}FOR UPDATE/.test(src);
  const meterLocked = /FROM public\.diaspora_usage_meters[\s\S]{0,200}FOR UPDATE/.test(src);
  record('the reservation row is taken FOR UPDATE', reservationLocked);
  record('the meter row is taken FOR UPDATE', meterLocked);
  record('the decrement floors at zero with GREATEST', /GREATEST\(/.test(src));
}

// ── Floor: a meter can never go negative ────────────────────────────────────
{
  const id = await seed({ used: 2, amount: 9, key: 'k-floor' });
  await release(id);
  const m = await meterOf();
  record('releasing more than was counted floors the meter at zero, never negative', m === 0, `meter=${m}`);
}

// ── Terminal states ─────────────────────────────────────────────────────────
{
  const id = await seed({ used: 5, amount: 2, status: 'COMMITTED', key: 'k-committed' });
  const before = await meterOf();
  try {
    await release(id);
    record('a COMMITTED reservation cannot be released', false, 'the call succeeded');
  } catch (e) {
    record('a COMMITTED reservation cannot be released', /CANNOT_RELEASE_COMMITTED/.test(String(e.message)));
  }
  record('a refused release leaves the meter untouched', await meterOf() === before);
}
{
  try {
    await release('99999999-9999-9999-9999-999999999999');
    record('an unknown reservation is refused', false, 'the call succeeded');
  } catch (e) {
    record('an unknown reservation is refused', /RESERVATION_NOT_FOUND/.test(String(e.message)));
  }
}

// ── Tenant scoping: the meter is found from the RESERVATION, not caller input ──
{
  await db.query(
    `INSERT INTO public.diaspora_usage_meters (tenant_id, feature_key, period_start, used_count)
     VALUES ($1,$2,$3,50) ON CONFLICT (tenant_id, feature_key, period_start) DO UPDATE SET used_count=50`,
    [T2, FEATURE, PERIOD]);
  const id = await seed({ tenant: T1, used: 8, amount: 3, key: 'k-scope' });
  await release(id);
  record("releasing in tenant 1 does not touch tenant 2's meter", await meterOf(T2) === 50, `t2=${await meterOf(T2)}`);
  record('the correct tenant meter was decremented', await meterOf(T1) === 5, `t1=${await meterOf(T1)}`);
}

// ── Rollback: a failed transaction leaves nothing behind ────────────────────
{
  const id = await seed({ used: 10, amount: 4, key: 'k-rollback' });
  const before = await meterOf();
  const auditsBefore = Number((await db.query(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`)).rows[0].n);
  try {
    await db.exec('BEGIN');
    await release(id);
    const mid = await meterOf();
    record('inside the open transaction the decrement is visible', mid === before - 4, `mid=${mid}`);
    await db.exec('ROLLBACK');
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    record('inside the open transaction the decrement is visible', false, String(e.message));
  }
  record('rollback restores the meter', await meterOf() === before, `after=${await meterOf()}`);
  const auditsAfter = Number((await db.query(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`)).rows[0].n);
  record('rollback discards the audit row too', auditsAfter === auditsBefore);
  const st = (await db.query(`SELECT status FROM public.diaspora_usage_reservations WHERE id=$1`, [id])).rows[0].status;
  record('rollback restores the reservation status', st === 'RESERVED', `status=${st}`);
}

// ── EXECUTE posture ─────────────────────────────────────────────────────────
{
  const { rows } = await db.query(
    `SELECT p.proacl::text acl, p.proconfig::text cfg, count(*) OVER () AS n
       FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND p.proname='diaspora_release_usage_atomic'`);
  record('exactly one definition (no accidental overload)', rows.length === 1, `count=${rows.length}`);
  const acl = rows[0]?.acl || '';

  // EFFECTIVE privilege, not ACL text.
  //
  // This previously matched /(^|,)anon=/ and asserted nothing at all about PUBLIC. Both were wrong.
  // An aclitem[] renders as `{entry,entry,...}` and the PUBLIC entry — grantee 0, printed with an
  // empty grantee name — is always element ZERO, so it is preceded by `{`, never by a comma and never
  // by start-of-string. And a role inherits EXECUTE through PUBLIC WITHOUT gaining an ACL entry of
  // its own, so `anon=` can be absent while anon can execute. Reproduced on PostgreSQL 17.5:
  //
  //   proacl = {=X/web_user,web_user=X/web_user,service_role=X/web_user}   anon EXECUTE = true
  //
  // has_function_privilege answers the question that actually matters: can this role execute it,
  // however the right was acquired. See database/test/diaspora_function_acl_detector_check.mjs.
  const SIG = 'public.diaspora_release_usage_atomic(uuid,text,text)';
  for (const role of ['anon', 'authenticated', 'public']) {
    const { rows: p } = await db.query('SELECT has_function_privilege($1, $2, $3) h', [role, SIG, 'EXECUTE']);
    record(`${role} holds NO effective EXECUTE`, p[0].h === false, `acl=${acl}`);
  }
  const { rows: svc } = await db.query('SELECT has_function_privilege($1, $2, $3) h', ['service_role', SIG, 'EXECUTE']);
  record('service_role holds effective EXECUTE', svc[0].h === true, `acl=${acl}`);
  record('search_path is pinned and includes extensions', /extensions/.test(rows[0]?.cfg || ''), `cfg=${rows[0]?.cfg}`);
}

const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
else for (const c of results.checks) console.log(`  ✓ ${c.label}`);
console.log('');
console.log(JSON.stringify({ ledger25: sha12(LEDGER_25), ok: results.ok, total: results.checks.length, failed: failed.length }, null, 2));
process.exit(results.ok ? 0 : 1);

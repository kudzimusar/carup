/**
 * Diaspora ledger #22 — SafeTrade ST-3 closure, verified by EXECUTING the replaced RPC on real
 * PostgreSQL 17.5 (PGlite). Issue #127.
 *
 * DDL that merely parses proves nothing about a money boundary. This harness applies the real
 * ledger #13 (Phase 9 SafeTrade), #21 (activation foundation) and #22 (ST-3 closure), then drives
 * the authoritative transition RPC through the exact scenarios ST-3 exists to prevent:
 *
 *   ST-3 #1  auxiliary events are written INSIDE the transition transaction (transactional outbox)
 *            and vanish with it on rollback — the property a best-effort after-commit append can
 *            never have;
 *   ST-3 #2  an evaluator cannot authorize the money movement their own evaluation blessed, and a
 *            HIGH-risk release additionally requires a recorded, single-use, second-human approval;
 *   ST-3 #3  a durable operation row is only marked ledger_applied by the committing transaction,
 *            so provider state cannot lead the authoritative ledger;
 *   plus     the outbox is append-only, and the live-money path is still fail-closed.
 *
 * Harness shim: PGlite has no pgcrypto, so `extensions.digest()` is stubbed with a deterministic
 * non-cryptographic stand-in. It exists ONLY so the RPC's audit-seal expression resolves; no
 * assertion below depends on the seal's cryptographic properties. Everything else is the real
 * migration text, unmodified.
 *
 * Run:  node database/test/diaspora_st3_migration_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGER_13 = '20260621130000_diaspora_phase9_safetrade.sql';
const LEDGER_21 = '20260727120000_diaspora_gtm_activation_foundation.sql';
const LEDGER_22 = '20260727130000_diaspora_safetrade_st3_closure.sql';

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
    // HARNESS SHIM: PGlite cannot install extensions. pgcrypto is present on Supabase (in the
    // `extensions` schema) and is stubbed in BOOTSTRAP below; neutralising the CREATE EXTENSION line
    // is the only edit made to any migration text in this file.
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- [harness] CREATE EXTENSION pgcrypto (stubbed)');
}
const sha12 = (file) => createHash('sha256').update(readFileSync(join(MIG, file), 'utf-8')).digest('hex').slice(0, 12);

async function exec(db, label, sql, bucketPass = true) {
  try { await db.exec(sql); return record(label, bucketPass); }
  catch (e) { return record(label, !bucketPass, String(e.message || e)); }
}

/** Call the RPC and return { ok, error }. Never throws. */
async function callTransition(db, args) {
  const a = {
    p_milestone_id: null, p_evaluation_id: null, p_payment_provider: 'sandbox', p_live_payment: false,
    p_idempotency_key: null, p_reason: null, p_metadata: {}, p_correlation_id: null, p_source: 'test', ...args,
  };
  try {
    const { rows } = await db.query(
      `SELECT public.diaspora_safetrade_transition_atomic(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::boolean,$6::text,$7::uuid,$8::text,$9::boolean,
         $10::text,$11::text,$12::jsonb,$13::text,$14::text) AS r`,
      [a.p_transaction_id, a.p_milestone_id, a.p_actor_id, a.p_tenant_id, a.p_actor_is_privileged,
       a.p_target_status, a.p_evaluation_id, a.p_payment_provider, a.p_live_payment,
       a.p_idempotency_key, a.p_reason, JSON.stringify(a.p_metadata), a.p_correlation_id, a.p_source]);
    return { ok: true, result: rows[0].r };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const expectRpcError = async (db, label, args, fragment) => {
  const r = await callTransition(db, args);
  if (r.ok) return record(label, false, 'RPC SUCCEEDED but should have been refused');
  const matched = r.error.includes(fragment);
  return record(label, matched, matched ? null : `refused for the wrong reason: ${r.error}`);
};
const expectRpcOk = async (db, label, args) => {
  const r = await callTransition(db, args);
  return record(label, r.ok, r.ok ? null : r.error);
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;

  -- Supabase platform default privileges (the hazard ledgers #17/#19/#20 had to compensate for).
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

  -- HARNESS SHIM ONLY: PGlite has no pgcrypto. This makes the RPC's audit-seal expression resolve.
  -- No assertion in this file depends on the seal being cryptographic.
  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea
    LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1 || ':' || $2, 'UTF8') $$;

  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;

  -- Ledger #3 prerequisites the Phase 9 migration builds on. The four authorization helpers are the
  -- REAL ledger #3 definitions (copied verbatim), not stubs, so the RLS policies ledger #13 creates
  -- bind to the same predicates they bind to in production.
  CREATE TABLE IF NOT EXISTS public.users (id text PRIMARY KEY, role text);
  CREATE TABLE IF NOT EXISTS public.tenant_users (user_id text, tenant_id uuid);

  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_current_user_id()
  RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')
  $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_platform_admin(
    actor_id text DEFAULT public.diaspora_trade_os_current_user_id()
  ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT actor_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.id = actor_id AND lower(coalesce(u.role, '')) IN ('admin','platform_admin','super_admin'))
  $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_users tu WHERE tu.user_id = actor_id AND tu.tenant_id = requested_tenant_id)
  $$;
  CREATE OR REPLACE FUNCTION public.diaspora_trade_os_can_access_row(
    row_tenant_id uuid, row_created_by text, row_updated_by text DEFAULT NULL::text
  ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT public.diaspora_trade_os_is_platform_admin()
      OR public.diaspora_trade_os_current_user_id() = row_created_by
      OR public.diaspora_trade_os_current_user_id() = row_updated_by
      OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), row_tenant_id)
  $$;

  CREATE TABLE IF NOT EXISTS public.diaspora_import_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text,
    deleted_at timestamptz, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.diaspora_import_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_order_id uuid, tenant_id uuid, actor_id text, action text,
    resource_type text, resource_id text, previous_state jsonb, new_state jsonb,
    metadata jsonb, cryptographic_seal text, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.diaspora_import_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, deleted_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS public.diaspora_payment_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, deleted_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS public.diaspora_billing_provider_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, provider text NOT NULL,
    event_id text NOT NULL, event_type text, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature_verified boolean NOT NULL DEFAULT false, processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_diaspora_billing_event UNIQUE (provider, event_id)
  );
`;

const db = new PGlite();
console.log('Diaspora ST-3 closure — real-Postgres RPC behaviour verification');
console.log(`ledger #21 sha256:12 = ${sha12(LEDGER_21)}`);
console.log(`ledger #22 sha256:12 = ${sha12(LEDGER_22)}\n`);

await exec(db, 'bootstrap: Supabase-compat env + ledger #3 prerequisites', BOOTSTRAP);
await exec(db, 'ledger #13 (Phase 9 SafeTrade) applies', upOf(LEDGER_13));
await exec(db, 'ledger #21 (activation foundation) applies', upOf(LEDGER_21));
await exec(db, 'ledger #22 (ST-3 closure) applies', upOf(LEDGER_22));

// Fail fast: every behavioural assertion below is meaningless if the schema did not land.
if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

// The replaced function must be a REPLACEMENT, not a new overload — an overload would make every
// Supabase named-argument RPC call ambiguous at runtime.
{
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='diaspora_safetrade_transition_atomic'`);
  record('transition RPC replaced in place (exactly one overload)', rows[0].n === 1, `overloads=${rows[0].n}`);
  const { rows: sp } = await db.query(
    `SELECT p.proconfig::text AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='diaspora_safetrade_transition_atomic'`);
  record('ledger #18 search_path pin preserved (public, extensions, pg_temp)',
    /extensions/.test(sp[0]?.cfg || ''), `proconfig=${sp[0]?.cfg}`);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
const TENANT = '11111111-1111-1111-1111-111111111111';
const BUYER = 'user-buyer';
const EVALUATOR = 'user-evaluator';
const REVIEWER = 'user-reviewer';
const APPROVER = 'user-approver';
const MAKER = 'user-maker';

const seed = async (status, riskLevel) => {
  const { rows } = await db.query(`
    INSERT INTO public.diaspora_import_orders (tenant_id, status) VALUES ($1, 'ACTIVE') RETURNING id`, [TENANT]);
  const orderId = rows[0].id;
  const { rows: t } = await db.query(`
    INSERT INTO public.diaspora_safetrade_transactions
      (tenant_id, import_order_id, buyer_id, status, policy_version, total_amount, currency, created_by, updated_by)
    VALUES ($1,$2,$3,$4,'v1',1000,'USD',$3,$3) RETURNING id`, [TENANT, orderId, BUYER, status]);
  const txnId = t[0].id;
  const { rows: e } = await db.query(`
    INSERT INTO public.diaspora_safetrade_release_evaluations
      (tenant_id, transaction_id, eligible, requires_reviewer, risk_level, policy_version, evaluated_by, evaluated_at, created_by, updated_by)
    VALUES ($1,$2,true,true,$3,'v1',$4,now(),$4,$4) RETURNING id`, [TENANT, txnId, riskLevel, EVALUATOR]);
  return { txnId, evalId: e[0].id };
};

// ── ST-3 #2: maker-checker ───────────────────────────────────────────────────
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'MEDIUM');
  await expectRpcError(db, 'ST-3 #2: the EVALUATOR cannot authorize their own release',
    { p_transaction_id: txnId, p_actor_id: EVALUATOR, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId },
    'EVALUATOR_SELF_APPROVAL');
  await expectRpcOk(db, 'ST-3 #2: a DIFFERENT privileged reviewer can authorize a MEDIUM-risk release',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId });
}
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'HIGH');
  await expectRpcError(db, 'ST-3 #2: a HIGH-risk release with NO recorded approval is refused',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId },
    'APPROVAL_REQUIRED');

  // A pending (un-approved) approval is not enough.
  await db.query(`INSERT INTO public.diaspora_safetrade_approvals
    (tenant_id, transaction_id, decision_type, evaluation_id, risk_level, requested_by, state)
    VALUES ($1,$2,'release',$3,'HIGH',$4,'pending')`, [TENANT, txnId, evalId, MAKER]);
  await expectRpcError(db, 'ST-3 #2: a PENDING approval does not bless a HIGH-risk release',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId },
    'APPROVAL_REQUIRED');

  await db.query(`UPDATE public.diaspora_safetrade_approvals
    SET state='approved', approved_by=$1, approved_at=now() WHERE transaction_id=$2`, [APPROVER, txnId]);
  await expectRpcOk(db, 'ST-3 #2: an APPROVED second-human approval unblocks the HIGH-risk release',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId });

  const { rows } = await db.query(
    `SELECT state FROM public.diaspora_safetrade_approvals WHERE transaction_id=$1`, [txnId]);
  record('ST-3 #2: the approval is CONSUMED (single-use, cannot bless a second release)',
    rows[0]?.state === 'consumed', `state=${rows[0]?.state}`);
}

// ── ST-3 #1: transactional outbox ────────────────────────────────────────────
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'MEDIUM');
  const r = await callTransition(db, {
    p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
    p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId, p_correlation_id: 'corr-1',
    p_metadata: { auxEvents: [
      { eventType: 'SAFETRADE_DELIVERY_WINDOW_CLOSED', payload: { window: 'expired' } },
      { eventType: 'SAFETRADE_REPUTATION_ELIGIBLE', payload: { eligible: true } },
    ] },
  });
  record('ST-3 #1: a transition carrying aux events succeeds', r.ok, r.error);
  const { rows } = await db.query(
    `SELECT event_type, correlation_id FROM public.diaspora_safetrade_outbox WHERE transaction_id=$1 ORDER BY event_type`, [txnId]);
  record('ST-3 #1: both aux events landed in the outbox', rows.length === 2, `rows=${rows.length}`);
  record('ST-3 #1: outbox rows carry the request correlation id', rows.every((x) => x.correlation_id === 'corr-1'));
}

// The property a best-effort after-commit append can never have: the events roll back WITH the
// transition when the surrounding transaction aborts.
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'MEDIUM');
  try {
    await db.exec('BEGIN');
    await db.query(
      `SELECT public.diaspora_safetrade_transition_atomic($1::uuid,NULL,$2::text,$3::uuid,true,'RELEASE_AUTHORIZED',$4::uuid,'sandbox',false,NULL,NULL,$5::jsonb,NULL,'test')`,
      [txnId, REVIEWER, TENANT, evalId, JSON.stringify({ auxEvents: [{ eventType: 'SHOULD_VANISH', payload: {} }] })]);
    const mid = await db.query(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox WHERE transaction_id=$1`, [txnId]);
    record('ST-3 #1: aux events are visible INSIDE the open transaction', mid.rows[0].n === 1, `n=${mid.rows[0].n}`);
    await db.exec('ROLLBACK');
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    record('ST-3 #1: aux events are visible INSIDE the open transaction', false, String(e.message || e));
  }
  const after = await db.query(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox WHERE transaction_id=$1`, [txnId]);
  record('ST-3 #1: aux events VANISH with the rolled-back transition (atomic, not best-effort)',
    after.rows[0].n === 0, `n=${after.rows[0].n}`);
  const st = await db.query(`SELECT status FROM public.diaspora_safetrade_transactions WHERE id=$1`, [txnId]);
  record('ST-3 #1: the transition itself also rolled back', st.rows[0].status === 'RELEASE_REVIEW', `status=${st.rows[0].status}`);
}

// Outbox immutability.
{
  const { rows } = await db.query(`SELECT id FROM public.diaspora_safetrade_outbox LIMIT 1`);
  const id = rows[0].id;
  await exec(db, 'outbox: worker delivery bookkeeping IS updatable',
    `UPDATE public.diaspora_safetrade_outbox SET status='dispatched', attempts=1, dispatched_at=now() WHERE id='${id}'`);
  await exec(db, 'outbox: event content is IMMUTABLE',
    `UPDATE public.diaspora_safetrade_outbox SET payload='{"tampered":true}'::jsonb WHERE id='${id}'`, false);
  await exec(db, 'outbox: DELETE is refused (append-only)',
    `DELETE FROM public.diaspora_safetrade_outbox WHERE id='${id}'`, false);
}

// ── ST-3 #3: the operation row is only applied by the committing transaction ──
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'MEDIUM');
  const { rows: op } = await db.query(`
    INSERT INTO public.diaspora_safetrade_operations
      (tenant_id, transaction_id, operation, idempotency_key, provider, state)
    VALUES ($1,$2,'release','op-idem-1','sandbox','provider_dispatched') RETURNING id`, [TENANT, txnId]);
  const opId = op[0].id;
  await expectRpcOk(db, 'ST-3 #3: a transition bound to an operation succeeds',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId, p_metadata: { operationId: opId } });
  const { rows: after } = await db.query(`SELECT state, applied_at FROM public.diaspora_safetrade_operations WHERE id=$1`, [opId]);
  record('ST-3 #3: the operation is ledger_applied by the committing transaction',
    after[0].state === 'ledger_applied' && after[0].applied_at != null, `state=${after[0].state}`);

  // An operation belonging to a DIFFERENT tenant must not be advanced by this tenant's transition.
  const { rows: foreign } = await db.query(`
    INSERT INTO public.diaspora_safetrade_operations
      (tenant_id, operation, idempotency_key, provider, state)
    VALUES ('22222222-2222-2222-2222-222222222222','release','op-idem-foreign','sandbox','provider_dispatched')
    RETURNING id`);
  const { txnId: t2, evalId: e2 } = await seed('RELEASE_REVIEW', 'MEDIUM');
  await callTransition(db, { p_transaction_id: t2, p_actor_id: REVIEWER, p_tenant_id: TENANT,
    p_actor_is_privileged: true, p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: e2,
    p_metadata: { operationId: foreign[0].id } });
  const { rows: fAfter } = await db.query(`SELECT state FROM public.diaspora_safetrade_operations WHERE id=$1`, [foreign[0].id]);
  record('ST-3 #3: a NEIGHBOURING tenant\'s operation is not advanced (tenant-scoped)',
    fAfter[0].state === 'provider_dispatched', `state=${fAfter[0].state}`);
}

// ── Real money is still fail-closed at the database boundary ─────────────────
{
  const { txnId, evalId } = await seed('RELEASE_REVIEW', 'MEDIUM');
  await expectRpcError(db, 'live money remains fail-closed: p_live_payment=true is refused',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId, p_live_payment: true },
    'EXTERNAL_ACTIVATION_REQUIRED');
  await expectRpcError(db, 'live money remains fail-closed: a non-sandbox provider is refused',
    { p_transaction_id: txnId, p_actor_id: REVIEWER, p_tenant_id: TENANT, p_actor_is_privileged: true,
      p_target_status: 'RELEASE_AUTHORIZED', p_evaluation_id: evalId, p_payment_provider: 'stripe' },
    'EXTERNAL_ACTIVATION_REQUIRED');
}

// ── The outbox ACL contract ──────────────────────────────────────────────────
{
  const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  const leaked = [];
  for (const role of ['anon', 'authenticated']) {
    for (const p of PRIVS) {
      const { rows } = await db.query('SELECT has_table_privilege($1,$2,$3) h', [role, 'public.diaspora_safetrade_outbox', p]);
      if (rows[0].h) leaked.push(`${role}:${p}`);
    }
  }
  record('outbox ACL: anon = NONE, authenticated = NONE (incl. MAINTAIN)', leaked.length === 0, leaked.join(','));
  const svc = [];
  for (const p of PRIVS) {
    const { rows } = await db.query('SELECT has_table_privilege($1,$2,$3) h', ['service_role', 'public.diaspora_safetrade_outbox', p]);
    if (rows[0].h) svc.push(p);
  }
  record('outbox ACL: service_role = ALL 8', svc.length === PRIVS.length, svc.join(','));
  const { rows: rls } = await db.query(
    `SELECT relrowsecurity e FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='diaspora_safetrade_outbox'`);
  record('outbox RLS enabled', rls[0].e === true);
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
}
console.log('');
console.log(JSON.stringify({
  ledger21: sha12(LEDGER_21), ledger22: sha12(LEDGER_22),
  ok: results.ok, total: results.checks.length, failed: failed.length,
}, null, 2));
process.exit(results.ok ? 0 : 1);

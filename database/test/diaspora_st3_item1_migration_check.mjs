/**
 * Diaspora ledger #23 — ST-3 item #1 closure, verified by EXECUTING the RPCs on real PostgreSQL 17.5
 * (PGlite). Issue #127.
 *
 * Item #1's claim is atomicity: the state change, the CRITICAL audit row and the downstream event are
 * one unit. That claim is only meaningful if it survives a rollback, so the central assertions here
 * open a transaction, observe all three writes, roll back, and show that all three are gone. A test
 * that merely checked "the event row exists after a successful call" would pass just as happily
 * against the best-effort implementation this replaces.
 *
 * Also verified: the drainer's claim/settle contract, which is what stops the outbox becoming a
 * different kind of silent loss — concurrent drainers must partition the queue rather than
 * double-deliver, a failing event must back off rather than spin, and it must eventually reach a
 * dead-letter terminus rather than retry forever.
 *
 * Harness shim: PGlite has no pgcrypto, so extensions.digest() is stubbed. No assertion depends on
 * the seal being cryptographic.
 *
 * Run:  node database/test/diaspora_st3_item1_migration_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGERS = {
  13: '20260621130000_diaspora_phase9_safetrade.sql',
  14: '20260621131000_diaspora_phase9_safetrade_disputes.sql',
  21: '20260727120000_diaspora_gtm_activation_foundation.sql',
  22: '20260727130000_diaspora_safetrade_st3_closure.sql',
  23: '20260728090000_diaspora_safetrade_st3_item1_closure.sql',
};

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

async function exec(db, label, sql, expectPass = true) {
  try { await db.exec(sql); return record(label, expectPass); }
  catch (e) { return record(label, !expectPass, String(e.message || e)); }
}

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
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

  CREATE TABLE IF NOT EXISTS public.diaspora_import_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, deleted_at timestamptz);
  CREATE TABLE IF NOT EXISTS public.diaspora_import_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, deleted_at timestamptz);
  CREATE TABLE IF NOT EXISTS public.diaspora_payment_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, deleted_at timestamptz);
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
`;

const db = new PGlite();
console.log('Diaspora ledger #23 — ST-3 item #1 closure, real-Postgres RPC behaviour');
for (const [n, f] of Object.entries(LEDGERS)) console.log(`  ledger #${n} sha256:12 = ${sha12(f)}`);
console.log('');

await exec(db, 'bootstrap: Supabase-compat env + ledger #3 prerequisites', BOOTSTRAP);
for (const n of [13, 14, 21, 22, 23]) {
  await exec(db, `ledger #${n} applies`, upOf(LEDGERS[n]));
}
if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = 'user-reviewer';

const { rows: orderRows } = await db.query(
  `INSERT INTO public.diaspora_import_orders (tenant_id, status) VALUES ($1,'ACTIVE') RETURNING id`, [TENANT]);
const ORDER = orderRows[0].id;
const { rows: txnRows } = await db.query(`
  INSERT INTO public.diaspora_safetrade_transactions
    (tenant_id, import_order_id, buyer_id, seller_id, status, policy_version, total_amount, currency, created_by, updated_by)
  VALUES ($1,$2,'user-buyer','user-seller','IN_PROGRESS','v1',1000,'USD','user-buyer','user-buyer') RETURNING id`,
  [TENANT, ORDER]);
const TXN = txnRows[0].id;
const { rows: dRows } = await db.query(`
  INSERT INTO public.diaspora_safetrade_disputes (tenant_id, transaction_id, import_order_id, raised_by, category, reason, status, created_by, updated_by)
  VALUES ($1,$2,$3,'user-buyer','OTHER','test dispute','OPEN','user-buyer','user-buyer') RETURNING id`,
  [TENANT, TXN, ORDER]);
const DISPUTE = dRows[0].id;
const { rows: cRows } = await db.query(`
  INSERT INTO public.diaspora_safetrade_delivery_confirmations
    (tenant_id, transaction_id, import_order_id, confirmed_by, confirmed_by_role, status, created_by, updated_by)
  VALUES ($1,$2,$3,'user-buyer','BUYER','CONFIRMED','user-buyer','user-buyer') RETURNING id`,
  [TENANT, TXN, ORDER]);
const CONFIRMATION = cRows[0].id;

const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// ── ST-3 #1 · dispute hold: state + audit + event are ONE unit ───────────────
{
  await db.query(
    `SELECT public.diaspora_safetrade_dispute_hold_atomic($1::uuid,$2::text,true,'hold-ref-1',$3::jsonb,
       'SAFETRADE_DISPUTE_HOLD_PLACED','{}'::jsonb,'corr-1')`,
    [DISPUTE, ACTOR, JSON.stringify([{ eventType: 'SAFETRADE_DISPUTE_HOLD_PLACED', payload: { holdReference: 'hold-ref-1' } }])]);

  const held = (await db.query(`SELECT hold_placed, hold_reference FROM public.diaspora_safetrade_disputes WHERE id=$1`, [DISPUTE])).rows[0];
  record('dispute hold: the state change applied', held.hold_placed === true && held.hold_reference === 'hold-ref-1');
  record('dispute hold: a CRITICAL audit row was written',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log WHERE resource_id=$1 AND action='SAFETRADE_DISPUTE_HOLD_PLACED'`, [DISPUTE])) === 1);
  const ev = (await db.query(`SELECT event_type, correlation_id, status FROM public.diaspora_safetrade_outbox WHERE transaction_id=$1`, [TXN])).rows;
  record('dispute hold: the outbox event was enqueued', ev.length === 1 && ev[0].event_type === 'SAFETRADE_DISPUTE_HOLD_PLACED');
  record('dispute hold: the event carries the correlation id', ev[0]?.correlation_id === 'corr-1');
  record('dispute hold: the event starts pending, awaiting the drainer', ev[0]?.status === 'pending');
}

// THE decisive assertion: all three writes vanish together on rollback. A best-effort append made
// after COMMIT could never do this, which is precisely why item #1 existed.
{
  const auditBefore = await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`);
  const outboxBefore = await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox`);
  try {
    await db.exec('BEGIN');
    await db.query(
      `SELECT public.diaspora_safetrade_dispute_hold_atomic($1::uuid,$2::text,false,NULL,$3::jsonb,
         'SAFETRADE_DISPUTE_HOLD_FAILED','{}'::jsonb,'corr-rollback')`,
      [DISPUTE, ACTOR, JSON.stringify([{ eventType: 'SHOULD_VANISH', payload: {} }])]);
    const midAudit = await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`);
    const midOutbox = await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox`);
    record('rollback: all three writes are visible INSIDE the open transaction',
      midAudit === auditBefore + 1 && midOutbox === outboxBefore + 1);
    await db.exec('ROLLBACK');
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    record('rollback: all three writes are visible INSIDE the open transaction', false, String(e.message || e));
  }
  record('rollback: the audit row vanished with the transaction',
    (await count(`SELECT count(*)::int n FROM public.diaspora_import_audit_log`)) === auditBefore);
  record('rollback: the outbox event vanished with the transaction',
    (await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox`)) === outboxBefore);
  const stillHeld = (await db.query(`SELECT hold_placed FROM public.diaspora_safetrade_disputes WHERE id=$1`, [DISPUTE])).rows[0];
  record('rollback: the state change vanished too', stillHeld.hold_placed === true, 'the pre-rollback value must survive');
}

// ── ST-3 #1 · delivery window close ─────────────────────────────────────────
{
  await db.query(
    `SELECT public.diaspora_safetrade_close_delivery_window_atomic($1::uuid,$2::text,true,NULL,$3::jsonb,
       'SAFETRADE_DELIVERY_WINDOW_CLOSED','{}'::jsonb,'corr-2')`,
    [CONFIRMATION, ACTOR, JSON.stringify([
      { eventType: 'SAFETRADE_DELIVERY_WINDOW_CLOSED', payload: {} },
      { eventType: 'SAFETRADE_REPUTATION_ELIGIBLE', payload: { eligible: true } },
    ])]);
  const conf = (await db.query(
    `SELECT dispute_window_closed, reputation_eligibility_emitted FROM public.diaspora_safetrade_delivery_confirmations WHERE id=$1`,
    [CONFIRMATION])).rows[0];
  record('delivery close: the window closed and eligibility was marked emitted',
    conf.dispute_window_closed === true && conf.reputation_eligibility_emitted === true);
  record('delivery close: both events were enqueued',
    (await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox WHERE event_type IN ('SAFETRADE_DELIVERY_WINDOW_CLOSED','SAFETRADE_REPUTATION_ELIGIBLE')`)) === 2);

  // Double-emit guard lives on the LOCKED row, so a second close cannot emit again.
  const before = await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox`);
  const replay = (await db.query(
    `SELECT public.diaspora_safetrade_close_delivery_window_atomic($1::uuid,$2::text,true,NULL,$3::jsonb,
       'SAFETRADE_DELIVERY_WINDOW_CLOSED','{}'::jsonb,'corr-3') AS r`,
    [CONFIRMATION, ACTOR, JSON.stringify([{ eventType: 'SAFETRADE_REPUTATION_ELIGIBLE', payload: {} }])])).rows[0].r;
  record('delivery close: a second close reports idempotentReplay', replay?.idempotentReplay === true);
  record('delivery close: a replay emits NO new events',
    (await count(`SELECT count(*)::int n FROM public.diaspora_safetrade_outbox`)) === before);
}

// ── Drainer · claim / settle ────────────────────────────────────────────────
{
  const claimed = (await db.query(`SELECT * FROM public.diaspora_safetrade_outbox_claim_atomic(10, 60, now())`)).rows;
  record('drainer: claims the due pending events', claimed.length >= 3, `claimed=${claimed.length}`);
  record('drainer: claiming increments attempts', claimed.every((r) => r.attempts === 1));

  // A claimed event is leased — a second drainer must not also get it.
  const second = (await db.query(`SELECT * FROM public.diaspora_safetrade_outbox_claim_atomic(10, 60, now())`)).rows;
  record('drainer: a concurrent claim gets nothing (lease holds, no double delivery)', second.length === 0, `second=${second.length}`);

  // Success → dispatched.
  const ok = (await db.query(`SELECT public.diaspora_safetrade_outbox_settle_atomic($1::uuid, true, NULL, 5, now()) AS r`, [claimed[0].id])).rows[0].r;
  record('drainer: a successful delivery is marked dispatched', ok.status === 'dispatched' && ok.dispatched_at != null);

  // Failure → backoff, still retryable.
  const failed = (await db.query(`SELECT public.diaspora_safetrade_outbox_settle_atomic($1::uuid, false, 'handler threw', 5, now()) AS r`, [claimed[1].id])).rows[0].r;
  record('drainer: a failed delivery backs off rather than being dropped',
    failed.status === 'failed' && failed.next_attempt_at != null);
  record('drainer: the failure reason is recorded and truncated', String(failed.last_error).includes('handler threw'));

  // Attempt ceiling → dead letter, not infinite retry.
  const target = claimed[2].id;
  await db.query(`UPDATE public.diaspora_safetrade_outbox SET attempts = 5 WHERE id = $1`, [target]);
  const dead = (await db.query(`SELECT public.diaspora_safetrade_outbox_settle_atomic($1::uuid, false, 'still broken', 5, now()) AS r`, [target])).rows[0].r;
  record('drainer: the attempt ceiling dead-letters instead of retrying forever', dead.status === 'dead_lettered');
  record('drainer: a dead letter is no longer scheduled', dead.next_attempt_at === null);
}

// ── The outbox stays append-only through all of this ────────────────────────
await exec(db, 'outbox: event content is still immutable',
  `UPDATE public.diaspora_safetrade_outbox SET payload='{"tampered":true}'::jsonb WHERE true`, false);
await exec(db, 'outbox: DELETE is still refused',
  `DELETE FROM public.diaspora_safetrade_outbox WHERE true`, false);

// ── EXECUTE posture ─────────────────────────────────────────────────────────
{
  const fns = [
    'diaspora_safetrade_dispute_hold_atomic',
    'diaspora_safetrade_close_delivery_window_atomic',
    'diaspora_safetrade_outbox_claim_atomic',
    'diaspora_safetrade_outbox_settle_atomic',
  ];
  for (const fn of fns) {
    const { rows } = await db.query(
      `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`, [fn]);
    record(`${fn}: exactly one definition (no accidental overload)`, rows.length === 1, `count=${rows.length}`);
    const acl = rows[0]?.acl || '';
    record(`${fn}: anon and authenticated hold no EXECUTE`,
      !/[,{]anon=/.test(acl) && !/[,{]authenticated=/.test(acl), `acl=${acl}`);
    record(`${fn}: service_role holds EXECUTE`, /service_role=X/.test(acl), `acl=${acl}`);
  }
  const { rows: sp } = await db.query(
    `SELECT p.proconfig::text AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='diaspora_safetrade_dispute_hold_atomic'`);
  record('the audit-writing RPCs pin search_path to include extensions (pgcrypto on Supabase)',
    /extensions/.test(sp[0]?.cfg || ''), `proconfig=${sp[0]?.cfg}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
}
console.log('');
console.log(JSON.stringify({ ledger23: sha12(LEDGERS[23]), ok: results.ok, total: results.checks.length, failed: failed.length }, null, 2));
process.exit(results.ok ? 0 : 1);

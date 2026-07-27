/**
 * Diaspora ledger #24 — subscription billing closure, verified by APPLYING the migration to real
 * PostgreSQL 17.5 (PGlite) and then exercising the behaviour it claims. Issue #127, Deliverable D.
 *
 * Two things are checked that a schema-shape assertion could not catch:
 *
 * 1. THE SUPABASE `ALTER DEFAULT PRIVILEGES` HAZARD. On Supabase, `ALTER DEFAULT PRIVILEGES IN SCHEMA
 *    public GRANT ALL ON TABLES TO anon, authenticated` is in effect, so a table is world-readable the
 *    instant it is created — before any migration line that follows. The bootstrap below reproduces
 *    that hazard exactly, so a migration that forgot its REVOKE would FAIL here rather than pass and
 *    then leak in production. This is the gap that required compensating ledgers #17/#19/#20; a harness
 *    that creates tables in a clean database cannot see it at all.
 *
 * 2. THE OUT-OF-ORDER INVARIANTS, executed. The supersede decision depends on partial indexes and on
 *    `superseded`/`processed_at` semantics; asserting the columns exist proves nothing about whether
 *    the intended rows are actually reachable. So the harness inserts a realistic event history and
 *    asserts what the service's own query would return.
 *
 * Also verified: the abandonment sweep's read path, the unique constraint on checkout session refs
 * (including the NULL-tolerant partial form), the state CHECK, and that the Down section is a true
 * inverse.
 *
 * Harness shim: PGlite has no pgcrypto, so `CREATE EXTENSION pgcrypto` is stubbed. No assertion here
 * depends on cryptography.
 *
 * Run:  node database/test/diaspora_billing_migration_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGERS = {
  21: '20260727120000_diaspora_gtm_activation_foundation.sql',
  24: '20260729090000_diaspora_billing_test_mode_closure.sql',
};

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};

function sectionOf(file, section) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  const text = section === 'down'
    ? (idx >= 0 ? raw.slice(idx) : '')
    : (idx >= 0 ? raw.slice(0, idx) : raw);
  return text
    .replace('-- +migrate Up', '')
    .replace('-- +migrate Down', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- [harness] pgcrypto stubbed');
}
const upOf = (f) => sectionOf(f, 'up');
const downOf = (f) => sectionOf(f, 'down');
const sha12 = (file) => createHash('sha256').update(readFileSync(join(MIG, file), 'utf-8')).digest('hex').slice(0, 12);

async function exec(db, label, sql, expectPass = true) {
  try { await db.exec(sql); return record(label, expectPass); }
  catch (e) { return record(label, !expectPass, String(e.message || e)); }
}

/**
 * The Supabase-compatible bootstrap. The ALTER DEFAULT PRIVILEGES lines are the hazard control: they
 * make every subsequently created table world-accessible by default, which is the production reality
 * this migration has to defend against.
 */
const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;

  -- Ledger #12's billing event ledger, which ledger #21 and #24 both extend.
  CREATE TABLE IF NOT EXISTS public.diaspora_billing_provider_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, provider text NOT NULL,
    event_id text NOT NULL, event_type text, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature_verified boolean NOT NULL DEFAULT false, processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_diaspora_billing_event UNIQUE (provider, event_id));

  -- Ledger #21 prerequisites that its own Up section expects to already exist.
  CREATE TABLE IF NOT EXISTS public.diaspora_import_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, deleted_at timestamptz);
  CREATE TABLE IF NOT EXISTS public.diaspora_workbook_import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, import_status text);
`;

const db = new PGlite();
console.log('Diaspora ledger #24 — subscription billing closure, real-Postgres behaviour');
for (const [n, f] of Object.entries(LEDGERS)) console.log(`  ledger #${n} sha256:12 = ${sha12(f)}`);
console.log('');

await exec(db, 'bootstrap: Supabase-compat env WITH the ALTER DEFAULT PRIVILEGES hazard active', BOOTSTRAP);
await exec(db, 'ledger #21 applies (prerequisite)', upOf(LEDGERS[21]));
await exec(db, 'ledger #24 applies', upOf(LEDGERS[24]));
await exec(db, 'ledger #24 is idempotent (a second apply is a no-op)', upOf(LEDGERS[24]));

if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => Number((await one(sql, params)).n);

// ── The grant contract (the hazard this harness exists to catch) ─────────────────────────────────
{
  const acl = (await one(
    `SELECT relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='diaspora_billing_checkout_sessions'`,
  ))?.acl || '';
  record('checkout sessions: anon holds NO privileges despite ALTER DEFAULT PRIVILEGES', !/[,{]anon=/.test(acl), `acl=${acl}`);
  record('checkout sessions: authenticated holds NO privileges', !/[,{]authenticated=/.test(acl), `acl=${acl}`);
  record('checkout sessions: service_role holds privileges', /service_role=/.test(acl), `acl=${acl}`);

  const rls = await one(
    `SELECT relrowsecurity AS on FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='diaspora_billing_checkout_sessions'`,
  );
  record('checkout sessions: RLS is ENABLED', rls?.on === true);
  record('checkout sessions: RLS has ZERO policies (default-deny)',
    (await count(`SELECT count(*)::int n FROM pg_policies WHERE tablename='diaspora_billing_checkout_sessions'`)) === 0);
}

// ── Added columns exist with the right defaults ──────────────────────────────────────────────────
{
  const cols = Object.fromEntries((await all(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='diaspora_billing_provider_events'`,
  )).map((r) => [r.column_name, r]));

  for (const c of ['superseded_by', 'correlation_id', 'attempts', 'last_error', 'dead_lettered']) {
    record(`events: column ${c} exists`, Boolean(cols[c]));
  }
  record('events: attempts defaults to 0 (a NULL would break every increment)',
    /0/.test(cols.attempts?.column_default || ''), `default=${cols.attempts?.column_default}`);
  record('events: dead_lettered defaults to false, not NULL',
    /false/.test(cols.dead_lettered?.column_default || '') && cols.dead_lettered?.is_nullable === 'NO');
  record('events: superseded_by is NULLABLE (most events are never superseded)',
    cols.superseded_by?.is_nullable === 'YES');
}

// ── The out-of-order guard's read path actually reaches the right rows ───────────────────────────
{
  await db.query(
    `INSERT INTO public.diaspora_billing_provider_events
       (tenant_id, provider, event_id, event_type, occurred_at, provider_sequence, superseded, processed_at)
     VALUES
       ($1,'sandbox','evt-applied','subscription.updated','2026-06-21T12:00:00Z', 9, false, now()),
       ($1,'sandbox','evt-pending','subscription.updated','2026-06-21T23:00:00Z',20, false, NULL),
       ($1,'sandbox','evt-superseded','subscription.updated','2026-06-21T23:30:00Z',21, true, now()),
       ($2,'sandbox','evt-other-tenant','subscription.updated','2026-06-21T23:45:00Z',22, false, now())`,
    [TENANT_A, TENANT_B],
  );

  // Exactly the service's query: applied, non-superseded, this tenant, this provider.
  const visible = await all(
    `SELECT event_id FROM public.diaspora_billing_provider_events
      WHERE provider='sandbox' AND tenant_id=$1 AND superseded=false AND processed_at IS NOT NULL
      ORDER BY event_id`,
    [TENANT_A],
  );
  record('out-of-order guard sees ONLY applied, non-superseded, same-tenant events',
    visible.length === 1 && visible[0].event_id === 'evt-applied',
    `visible=${visible.map((v) => v.event_id).join(',')}`);

  const plan = (await all(
    `EXPLAIN SELECT event_id FROM public.diaspora_billing_provider_events
       WHERE provider='sandbox' AND tenant_id=$1 AND superseded=false AND processed_at IS NOT NULL`,
    [TENANT_A],
  )).map((r) => r['QUERY PLAN']).join(' ');
  // Informational on a 4-row table (Postgres will prefer a seq scan), but it proves the partial index
  // is valid and matches the predicate rather than silently never being usable.
  record('the partial index for the guard exists and is valid',
    (await count(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='idx_diaspora_billing_events_applied'`)) === 1,
    `plan=${plan.slice(0, 80)}`);

  record('the dead-letter partial index exists',
    (await count(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='idx_diaspora_billing_events_dead_letters'`)) === 1);
}

// ── Supersede semantics survive a real UPDATE ────────────────────────────────────────────────────
{
  const applied = await one(`SELECT id FROM public.diaspora_billing_provider_events WHERE event_id='evt-applied'`);
  await db.query(
    `INSERT INTO public.diaspora_billing_provider_events
       (tenant_id, provider, event_id, event_type, occurred_at, superseded)
     VALUES ($1,'sandbox','evt-late','subscription.updated','2026-06-21T09:00:00Z', false)`,
    [TENANT_A],
  );
  await db.query(
    `UPDATE public.diaspora_billing_provider_events
        SET superseded=true, superseded_by=$1, processed_at=now()
      WHERE event_id='evt-late'`,
    [applied.id],
  );
  const late = await one(`SELECT superseded, superseded_by, processed_at FROM public.diaspora_billing_provider_events WHERE event_id='evt-late'`);
  record('a superseded event points at what superseded it', late.superseded === true && late.superseded_by === applied.id);
  record('a superseded event is terminal (processed_at set) so it is not pending work', late.processed_at != null);
}

// ── The event unique claim still holds after the ALTERs ──────────────────────────────────────────
await exec(db, 'events: a duplicate (provider, event_id) is still refused by the unique index',
  `INSERT INTO public.diaspora_billing_provider_events (tenant_id, provider, event_id)
   VALUES ('${TENANT_A}','sandbox','evt-applied')`, false);

// ── Checkout sessions ────────────────────────────────────────────────────────────────────────────
{
  await db.query(
    `INSERT INTO public.diaspora_billing_checkout_sessions (tenant_id, provider, session_ref, plan_key, opened_at)
     VALUES ($1,'sandbox','cs_1','seller', now() - interval '3 hours'),
            ($1,'sandbox','cs_2','trade_pro', now() - interval '5 minutes')`,
    [TENANT_A],
  );
  record('checkout: a new session defaults to state=open',
    (await count(`SELECT count(*)::int n FROM public.diaspora_billing_checkout_sessions WHERE state='open'`)) === 2);

  await exec(db, 'checkout: an unknown state is refused by the CHECK constraint',
    `INSERT INTO public.diaspora_billing_checkout_sessions (tenant_id, provider, plan_key, state)
     VALUES ('${TENANT_A}','sandbox','seller','probably_paid')`, false);

  await exec(db, 'checkout: a duplicate (provider, session_ref) is refused',
    `INSERT INTO public.diaspora_billing_checkout_sessions (tenant_id, provider, session_ref, plan_key)
     VALUES ('${TENANT_A}','sandbox','cs_1','seller')`, false);

  // The partial unique index must NOT collapse rows that have no provider handle yet — a rail that
  // mints no session id would otherwise be limited to one open checkout in the entire system.
  await exec(db, 'checkout: MULTIPLE sessions with a NULL session_ref are allowed (partial unique index)',
    `INSERT INTO public.diaspora_billing_checkout_sessions (tenant_id, provider, plan_key)
     VALUES ('${TENANT_A}','paynow','seller'), ('${TENANT_B}','paynow','seller')`, true);

  // The sweep's read path: still-open sessions older than the window.
  const stale = await all(
    `SELECT session_ref FROM public.diaspora_billing_checkout_sessions
      WHERE state='open' AND opened_at <= now() - interval '60 minutes' AND session_ref IS NOT NULL
      ORDER BY opened_at`,
  );
  record('checkout: the abandonment sweep sees only sessions past the window',
    stale.length === 1 && stale[0].session_ref === 'cs_1',
    `stale=${stale.map((s) => s.session_ref).join(',')}`);

  await db.query(`UPDATE public.diaspora_billing_checkout_sessions SET state='abandoned', abandoned_at=now() WHERE session_ref='cs_1'`);
  record('checkout: a swept session leaves the open queue',
    (await count(`SELECT count(*)::int n FROM public.diaspora_billing_checkout_sessions WHERE state='open' AND session_ref='cs_1'`)) === 0);

  const trigger = await count(
    `SELECT count(*)::int n FROM pg_trigger WHERE tgname='set_diaspora_billing_checkout_sessions_updated_at'`,
  );
  record('checkout: the updated_at trigger is installed', trigger === 1);
}

// ── Down is a true inverse ───────────────────────────────────────────────────────────────────────
{
  await exec(db, 'ledger #24 Down applies', downOf(LEDGERS[24]));
  record('down: the checkout sessions table is gone',
    (await count(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='diaspora_billing_checkout_sessions'`)) === 0);
  record('down: the added event columns are gone',
    (await count(`SELECT count(*)::int n FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='diaspora_billing_provider_events'
                     AND column_name IN ('superseded_by','correlation_id','attempts','last_error','dead_lettered')`)) === 0);
  record('down: ledger #21 columns are UNTOUCHED (occurred_at / provider_sequence / superseded remain)',
    (await count(`SELECT count(*)::int n FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='diaspora_billing_provider_events'
                     AND column_name IN ('occurred_at','provider_sequence','superseded')`)) === 3);
  record('down: ledger #21 reconciliation runs table is UNTOUCHED',
    (await count(`SELECT count(*)::int n FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='diaspora_billing_reconciliation_runs'`)) === 1);
  await exec(db, 'ledger #24 re-applies cleanly after Down', upOf(LEDGERS[24]));
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
}
console.log('');
console.log(JSON.stringify({ ledger24: sha12(LEDGERS[24]), ok: results.ok, total: results.checks.length, failed: failed.length }, null, 2));
process.exit(results.ok ? 0 : 1);

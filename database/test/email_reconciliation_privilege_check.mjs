/**
 * Email 1.0 — REAL-GRANTS proof for the private reconciliation work queue (PGlite, no daemon).
 *
 * The second scheduler design failed precisely here: it stored work flags on public.users, whose
 * table-level UPDATE grants to anon/authenticated made a column-level revoke inert. So this check
 * does not trust migration text. It boots real PostgreSQL, emulates Supabase's default privileges
 * (ALTER DEFAULT PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role — the exact trap:
 * the work table would be born world-writable), applies the Email hardening migration, and then
 * proves with SET ROLE and has_*_privilege():
 *
 *   - anon/authenticated hold NO privilege on communication_reconciliation_work and cannot
 *     SELECT/INSERT/UPDATE/DELETE it even though the default privileges granted them ALL;
 *   - neither can EXECUTE the trigger functions;
 *   - service_role (BYPASSRLS, as in Supabase) retains full access — the worker still works;
 *   - the triggers enqueue work on the REAL transitions and only those: NULL->NOT NULL
 *     verification, material trust change; a timestamp-only recompute enqueues nothing;
 *   - pre-existing verified users and trust vehicles produce ZERO rows at migration time;
 *   - generation/fingerprint semantics hold, including A->B->A (fingerprint returns, generation
 *     does not);
 *   - a client-role write to users (the PRE-EXISTING staging grant) still routes through the
 *     SECURITY DEFINER trigger without gaining any read/write on the queue itself.
 *
 * Run:  node database/test/email_reconciliation_privilege_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRATION = readFileSync(join(MIG, '20260826120000_email_1_0_hardening.sql'), 'utf8');

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push({ name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`);
}

const db = new PGlite();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const asRole = async (role, sql) => {
  await db.exec(`SET ROLE ${role};`);
  try { return { ok: true, rows: (await db.query(sql)).rows }; }
  catch (error) { return { ok: false, error: String(error.message || error) }; }
  finally { await db.exec('RESET ROLE;'); }
};

// ── 1. Supabase-compat bootstrap ────────────────────────────────────────────────────────────────
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  -- The trap this check exists to spring: every NEW public table is born fully granted.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

  CREATE TABLE public.users (
    id text PRIMARY KEY, email text, name text, email_verified_at timestamptz
  );
  CREATE TABLE public.vehicles (
    vin text PRIMARY KEY, owner_id text,
    trust_score real, trust_band text, trust_confidence text,
    trust_evidence_basis jsonb, trust_known_limitations jsonb,
    trust_calculation_version text, trust_evaluated_at timestamptz
  );
  CREATE TABLE public.domain_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text, attempts int, tenant_id text, dedupe_key text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX idx_domain_events_dedupe_key ON public.domain_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE TABLE public.email_reply_tokens (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version int NOT NULL DEFAULT 1, token_hash text NOT NULL UNIQUE
  );
  CREATE INDEX idx_email_reply_tokens_hash ON public.email_reply_tokens (token_hash);
  -- The staging reality the second design tripped over, reproduced deliberately.
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon, authenticated;
`);

// Pre-existing (historical) state — verified users and evaluated vehicles BEFORE the migration.
await db.exec(`
  INSERT INTO public.users (id, email, email_verified_at) VALUES
    ('hist-1', 'h1@example.test', now() - interval '30 days'),
    ('hist-2', 'h2@example.test', now() - interval '20 days'),
    ('hist-3', 'h3@example.test', now() - interval '10 days'),
    ('new-1',  'n1@example.test', NULL),
    ('anon-1', 'a1@example.test', NULL);
  INSERT INTO public.vehicles (vin, owner_id, trust_score, trust_band, trust_evaluated_at) VALUES
    ('HISTVIN000000001', 'hist-1', 60, 'moderate', now() - interval '30 days'),
    ('HISTVIN000000002', 'hist-2', 70, 'moderate', now() - interval '20 days'),
    ('NEWVIN0000000001', 'hist-3', 60, 'moderate', now() - interval '5 days');
`);

// ── 2. Apply the Email hardening migration ─────────────────────────────────────────────────────
await db.exec(MIGRATION);
console.log('migration applied');

// ── 3. Historical baseline: ZERO work rows exist after apply ───────────────────────────────────
const afterApply = await q('SELECT count(*)::int AS n FROM public.communication_reconciliation_work');
check('historical users and vehicles enqueue ZERO work at migration time', afterApply[0].n === 0, `found ${afterApply[0].n}`);

// ── 4. Grants: the queue is service-only despite default privileges ────────────────────────────
for (const role of ['anon', 'authenticated']) {
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const [{ has }] = await q(
      `SELECT has_table_privilege($1, 'public.communication_reconciliation_work', $2) AS has`, [role, priv],
    );
    check(`${role} holds NO ${priv} on the work queue`, has === false, 'privilege still granted');
  }
  for (const fn of ['enqueue_email_welcome_reconciliation', 'enqueue_trust_presentation_reconciliation', 'communication_domain_event_dedupe_key']) {
    const [{ has }] = await q(`SELECT has_function_privilege($1, 'public.${fn}()', 'EXECUTE') AS has`, [role]);
    check(`${role} cannot EXECUTE ${fn}`, has === false, 'EXECUTE still granted');
  }
}
for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
  const [{ has }] = await q(
    `SELECT has_table_privilege('service_role', 'public.communication_reconciliation_work', $1) AS has`, [priv],
  );
  check(`service_role RETAINS ${priv} (the worker still works)`, has === true, 'service privilege lost');
}
const [rls] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.communication_reconciliation_work'::regclass`);
check('RLS is ENABLED and FORCED on the work queue', rls.relrowsecurity === true && rls.relforcerowsecurity === true);

// ...and not just catalog flags: the denials are real under SET ROLE.
const anonSelect = await asRole('anon', 'SELECT * FROM public.communication_reconciliation_work');
check('SET ROLE anon: SELECT on the queue is DENIED', !anonSelect.ok && /permission denied/i.test(anonSelect.error), anonSelect.error || 'select succeeded');
const anonInsert = await asRole('anon', `INSERT INTO public.communication_reconciliation_work (work_type, subject_id) VALUES ('user_email_verified', 'forged')`);
check('SET ROLE anon: INSERT (forging work) is DENIED', !anonInsert.ok && /permission denied/i.test(anonInsert.error), anonInsert.error || 'insert succeeded');
const authDelete = await asRole('authenticated', 'DELETE FROM public.communication_reconciliation_work');
check('SET ROLE authenticated: DELETE (suppressing work) is DENIED', !authDelete.ok && /permission denied/i.test(authDelete.error), authDelete.error || 'delete succeeded');

// ── 5. R1 trigger semantics ────────────────────────────────────────────────────────────────────
await db.exec(`UPDATE public.users SET email_verified_at = now() WHERE id = 'new-1';`);
let work = await q(`SELECT work_type, subject_id, generation FROM public.communication_reconciliation_work ORDER BY id`);
check('a NULL -> NOT NULL verification enqueues exactly one welcome work row',
  work.length === 1 && work[0].work_type === 'user_email_verified' && work[0].subject_id === 'new-1', JSON.stringify(work));

await db.exec(`UPDATE public.users SET name = 'renamed' WHERE id = 'new-1';`);
await db.exec(`UPDATE public.users SET email_verified_at = now() WHERE id = 'new-1';`);
work = await q(`SELECT count(*)::int AS n FROM public.communication_reconciliation_work WHERE work_type = 'user_email_verified'`);
check('unrelated updates and re-verification enqueue NOTHING further', work[0].n === 1, `found ${work[0].n}`);

await db.exec(`UPDATE public.users SET name = 'still historical' WHERE id = 'hist-1';`);
work = await q(`SELECT count(*)::int AS n FROM public.communication_reconciliation_work WHERE subject_id = 'hist-1'`);
check('updating a HISTORICAL verified user enqueues NOTHING', work[0].n === 0, `found ${work[0].n}`);

// The pre-existing staging reality: a client role CAN write public.users. The SECURITY DEFINER
// trigger still records the work — and the client still cannot see or touch the queue.
const anonVerify = await asRole('anon', `UPDATE public.users SET email_verified_at = now() WHERE id = 'anon-1'`);
check('a client-role verification write still fires the trigger (SECURITY DEFINER)', anonVerify.ok, anonVerify.error || '');
work = await q(`SELECT count(*)::int AS n FROM public.communication_reconciliation_work WHERE subject_id = 'anon-1'`);
check('...and its work row exists', work[0].n === 1, `found ${work[0].n}`);
const anonPeek = await asRole('anon', `SELECT * FROM public.communication_reconciliation_work`);
check('...while anon STILL cannot read the queue it just fed', !anonPeek.ok, 'anon read the queue');

// ── 6. R5 trigger semantics ────────────────────────────────────────────────────────────────────
await db.exec(`UPDATE public.vehicles SET trust_score = 78 WHERE vin = 'NEWVIN0000000001';`);
let trust = await q(`SELECT generation, work_fingerprint FROM public.communication_reconciliation_work WHERE work_type = 'vehicle_trust_presentation' AND subject_id = 'NEWVIN0000000001'`);
check('a material trust change enqueues generation 1 with a fingerprint',
  trust.length === 1 && Number(trust[0].generation) === 1 && /^[0-9a-f]{64}$/.test(trust[0].work_fingerprint), JSON.stringify(trust));
const F1 = trust[0]?.work_fingerprint;

await db.exec(`UPDATE public.vehicles SET trust_evaluated_at = now() WHERE vin = 'NEWVIN0000000001';`);
trust = await q(`SELECT generation, work_fingerprint FROM public.communication_reconciliation_work WHERE subject_id = 'NEWVIN0000000001'`);
check('a TIMESTAMP-ONLY recompute changes NOTHING (P1-D at the database layer)',
  Number(trust[0].generation) === 1 && trust[0].work_fingerprint === F1, JSON.stringify(trust));

await db.exec(`UPDATE public.vehicles SET trust_score = 91, trust_band = 'strong' WHERE vin = 'NEWVIN0000000001';`);
trust = await q(`SELECT generation, work_fingerprint FROM public.communication_reconciliation_work WHERE subject_id = 'NEWVIN0000000001'`);
check('a second material change UPSERTS generation 2 with a new fingerprint',
  Number(trust[0].generation) === 2 && trust[0].work_fingerprint !== F1, JSON.stringify(trust));
const F2 = trust[0]?.work_fingerprint;

await db.exec(`UPDATE public.vehicles SET trust_score = 78, trust_band = 'moderate' WHERE vin = 'NEWVIN0000000001';`);
trust = await q(`SELECT generation, work_fingerprint FROM public.communication_reconciliation_work WHERE subject_id = 'NEWVIN0000000001'`);
check('A->B->A: the fingerprint returns to F1 but the generation ADVANCES to 3',
  Number(trust[0].generation) === 3 && trust[0].work_fingerprint === F1 && F2 !== F1, JSON.stringify(trust));

await db.exec(`UPDATE public.vehicles SET trust_evaluated_at = now() WHERE vin = 'HISTVIN000000001';`);
trust = await q(`SELECT count(*)::int AS n FROM public.communication_reconciliation_work WHERE subject_id = 'HISTVIN000000001'`);
check('a historical vehicle recomputed timestamp-only enqueues NOTHING', trust[0].n === 0, `found ${trust[0].n}`);

// ── 7. The conditional retire primitive, against real SQL ──────────────────────────────────────
const [row] = await q(`SELECT id, generation, work_fingerprint FROM public.communication_reconciliation_work WHERE subject_id = 'NEWVIN0000000001'`);
// A stale worker holds (G-1, F2): both guards must hold independently.
let del = await q(`DELETE FROM public.communication_reconciliation_work WHERE id = $1 AND generation = $2 AND work_fingerprint = $3 RETURNING id`, [row.id, Number(row.generation) - 1, row.work_fingerprint]);
check('retire with a STALE GENERATION affects zero rows', del.length === 0, `deleted ${del.length}`);
del = await q(`DELETE FROM public.communication_reconciliation_work WHERE id = $1 AND generation = $2 AND work_fingerprint = $3 RETURNING id`, [row.id, Number(row.generation), 'not-the-fingerprint']);
check('retire with a WRONG FINGERPRINT affects zero rows', del.length === 0, `deleted ${del.length}`);
del = await q(`DELETE FROM public.communication_reconciliation_work WHERE id = $1 AND generation = $2 AND work_fingerprint = $3 RETURNING id`, [row.id, Number(row.generation), row.work_fingerprint]);
check('retire with the EXACT generation and fingerprint succeeds', del.length === 1, `deleted ${del.length}`);

console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
await db.close();
// Explicit: the PGlite WASM runtime otherwise leaves the process exiting non-zero even on success.
process.exit(failures.length ? 1 : 0);

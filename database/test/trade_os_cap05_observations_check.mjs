/**
 * Trade OS T11-CAP-05 — shipment observations (and estimate history), on a REAL Postgres (PGlite).
 *
 * An observation is something a provider or an operator SAYS about a shipment: a revised estimate, a
 * port event, a position. It is an input, not a fact CarUp has verified, and it must never be able to
 * rewrite the shipment. So this table is append-only evidence with a small, closed state machine:
 *
 *     RECEIVED  ──►  ACCEPTED  ──►  SUPERSEDED
 *        └────────►  REJECTED
 *
 * What was observed — its provider, its event id, its kind, its time, its content — can never change
 * once recorded. Only the decision about it can, once. An accepted observation is never deleted or
 * edited; a later one supersedes it, and the history stays.
 *
 * Idempotency is a database constraint, not a hope: the same provider event cannot be recorded twice.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260921090000_trade_os_cap05_shipment_observations.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});

const SHIP = 'aaaa0000-0000-0000-0000-000000000001';
const LEG = 'cccc0000-0000-0000-0000-000000000001';
const OBS = 'dddd0000-0000-0000-0000-000000000001';
const OBS2 = 'dddd0000-0000-0000-0000-000000000002';
const RCV = 'dddd0000-0000-0000-0000-000000000003';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  -- Supabase grants every new public table to these roles by default; a bare Postgres does not, which
  -- would make the REVOKE in the migration untestable.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('operator-1'), ('operator-2');
  CREATE TABLE public.tenants (id uuid PRIMARY KEY);
  CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'PLANNED',
    departure_date timestamptz NULL, estimated_arrival_date timestamptz NULL, actual_arrival_date timestamptz NULL);
  -- Explicit UTC: a bare date is read in the session's timezone, which would make the "the shipment's
  -- own estimate is unchanged" comparison below depend on the machine it runs on.
  INSERT INTO public.diaspora_shipments (id, estimated_arrival_date) VALUES ('${SHIP}', '2026-09-18T00:00:00Z');
  CREATE TABLE public.diaspora_shipment_legs (id uuid PRIMARY KEY);
  -- Present so the structural check ("observations are not wired to the movement timeline") has a
  -- timeline to be wired to; without it a mutation adding such a link would crash instead of failing.
  CREATE TABLE public.diaspora_shipment_stage_events (id uuid PRIMARY KEY);
  INSERT INTO public.diaspora_shipment_legs (id) VALUES ('${LEG}');
`);

await check('the migration applies', async () => { await db.exec(up); });

// ── A recorded observation ────────────────────────────────────────────────

await check('an operator-declared estimate revision is recorded as ACCEPTED, attributed', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_observations
    (id, shipment_id, provider_id, provider_event_id, kind, observed_at, payload, status, decided_by, decided_at, created_by)
    VALUES ('${OBS}', '${SHIP}', 'OPERATOR_DECLARED', 'evt-1', 'ETA_REVISION', '2026-09-01T00:00:00Z',
            '{"estimated_arrival":"2026-09-25T00:00:00Z","reason":"Vessel rescheduled by the carrier"}'::jsonb,
            'ACCEPTED', 'operator-1', now(), 'operator-1');`);
  const r = await db.query(`SELECT received_at, status FROM public.diaspora_shipment_observations WHERE id='${OBS}';`);
  if (!r.rows[0].received_at) throw new Error('received_at was not stamped by the database');
});

await check('an observation that nobody has decided on is RECEIVED, and counts for nothing yet', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_observations
    (id, shipment_id, leg_id, provider_id, provider_event_id, kind, observed_at, payload)
    VALUES ('${RCV}', '${SHIP}', '${LEG}', 'FUTURE_PROVIDER', 'evt-9', 'PORT_EVENT', now(), '{"port":"Somewhere"}'::jsonb);`);
  const r = await db.query(`SELECT status, decided_at FROM public.diaspora_shipment_observations WHERE id='${RCV}';`);
  if (r.rows[0].status !== 'RECEIVED' || r.rows[0].decided_at) throw new Error('an undecided observation was not RECEIVED');
});

// ── What an observation must look like ────────────────────────────────────

await refuses('an ESTIMATE REVISION must carry an estimated arrival',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, payload)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x1', 'ETA_REVISION', now(), '{"reason":"no date"}'::jsonb);`, /eta_payload|check/i);

await refuses('the estimated arrival must be text, not a number',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, payload)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x2', 'ETA_REVISION', now(), '{"estimated_arrival":20260925}'::jsonb);`, /eta_payload|check/i);

await refuses('an unknown kind of observation is refused',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x3', 'RUMOUR', now());`, /kind|check/i);

await refuses('an unknown status is refused',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, status)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x4', 'PORT_EVENT', now(), 'TRUSTED');`, /status|check/i);

await refuses('an observation must say when it was observed',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x5', 'PORT_EVENT');`, /observed_at|null/i);

await refuses('the same provider event cannot be recorded twice — idempotency is a constraint',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-1', 'PORT_EVENT', now());`, /uq_|unique|duplicate/i);

await check('the same event id from a DIFFERENT provider is a different event', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at)
    VALUES ('${SHIP}', 'ANOTHER_PROVIDER', 'evt-1', 'PORT_EVENT', now());`);
});

await refuses('an undecided observation cannot carry a decision',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, status, decided_at)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x6', 'PORT_EVENT', now(), 'RECEIVED', now());`, /decision|check/i);

await refuses('a decided observation must say who decided it',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, status, decided_at)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x7', 'PORT_EVENT', now(), 'ACCEPTED', now());`, /decision|check/i);

await refuses('a source reference is bounded',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at, source_reference)
   VALUES ('${SHIP}', 'OPERATOR_DECLARED', 'evt-x8', 'PORT_EVENT', now(), '${'x'.repeat(501)}');`, /source_reference|check/i);

await refuses('an observation cannot belong to a shipment that does not exist',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, provider_id, provider_event_id, kind, observed_at)
   VALUES ('aaaa0000-0000-0000-0000-0000000000ff', 'OPERATOR_DECLARED', 'evt-x9', 'PORT_EVENT', now());`, /foreign key|violates/i);

await refuses('an observation cannot point at a leg that does not exist',
  `INSERT INTO public.diaspora_shipment_observations (shipment_id, leg_id, provider_id, provider_event_id, kind, observed_at)
   VALUES ('${SHIP}', 'cccc0000-0000-0000-0000-0000000000ff', 'OPERATOR_DECLARED', 'evt-x10', 'PORT_EVENT', now());`, /foreign key|violates/i);

// ── What was observed cannot be rewritten ─────────────────────────────────

for (const [label, set] of [
  ['the PAYLOAD (what was said)', `payload = '{"estimated_arrival":"2027-01-01T00:00:00Z"}'::jsonb`],
  ['WHEN it was observed', `observed_at = now() - interval '9 days'`],
  ['WHEN it was received', `received_at = now() - interval '9 days'`],
  ['WHO provided it', `provider_id = 'SOMEONE_ELSE'`],
  ['its provider EVENT ID', `provider_event_id = 'evt-rewritten'`],
  ['its KIND', `kind = 'PORT_EVENT'`],
  ['the SHIPMENT it is about', `shipment_id = 'aaaa0000-0000-0000-0000-000000000002'`],
  ['the LEG it is about', `leg_id = '${LEG}'`],
  ['its SOURCE REFERENCE', `source_reference = 'rewritten'`],
  ['who RECORDED it', `created_by = 'operator-2'`],
  ['when it was RECORDED', `created_at = now() - interval '9 days'`],
]) {
  await refuses(`${label} cannot be rewritten`,
    `UPDATE public.diaspora_shipment_observations SET ${set} WHERE id='${OBS}';`, /append-only|cannot be rewritten|immutable/i);
}

// ── The state machine ─────────────────────────────────────────────────────

await check('POSITIVE CONTROL: a RECEIVED observation can be ACCEPTED, with who and why', async () => {
  await db.exec(`UPDATE public.diaspora_shipment_observations SET status='ACCEPTED', decided_by='operator-2', decided_at=now(),
    decision_reason='Checked against the carrier notice' WHERE id='${RCV}';`);
  const r = await db.query(`SELECT status, decided_by, decision_reason FROM public.diaspora_shipment_observations WHERE id='${RCV}';`);
  if (r.rows[0].status !== 'ACCEPTED' || r.rows[0].decided_by !== 'operator-2') throw new Error('the decision did not record');
});

await check('POSITIVE CONTROL: an accepted observation can be SUPERSEDED, and both rows remain', async () => {
  await db.exec(`UPDATE public.diaspora_shipment_observations SET status='SUPERSEDED' WHERE id='${OBS}';`);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipment_observations WHERE shipment_id='${SHIP}' AND kind='ETA_REVISION';`);
  if (r.rows[0].n !== 1) throw new Error('the superseded revision was lost');
});

await refuses('a SUPERSEDED observation cannot be revived',
  `UPDATE public.diaspora_shipment_observations SET status='ACCEPTED' WHERE id='${OBS}';`, /transition|cannot/i);

await check('POSITIVE CONTROL: a RECEIVED observation can be REJECTED, and rejection is final', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_observations (id, shipment_id, provider_id, provider_event_id, kind, observed_at)
    VALUES ('${OBS2}', '${SHIP}', 'FUTURE_PROVIDER', 'evt-10', 'EXCEPTION', now());`);
  await db.exec(`UPDATE public.diaspora_shipment_observations SET status='REJECTED', decided_by='operator-1', decided_at=now(),
    decision_reason='Does not match the carrier notice' WHERE id='${OBS2}';`);
});

await refuses('a REJECTED observation cannot be accepted later',
  `UPDATE public.diaspora_shipment_observations SET status='ACCEPTED' WHERE id='${OBS2}';`, /transition|cannot/i);

await refuses('an undecided observation cannot be called superseded',
  `INSERT INTO public.diaspora_shipment_observations (id, shipment_id, provider_id, provider_event_id, kind, observed_at)
   VALUES ('dddd0000-0000-0000-0000-000000000009', '${SHIP}', 'FUTURE_PROVIDER', 'evt-11', 'EXCEPTION', now());
   UPDATE public.diaspora_shipment_observations SET status='SUPERSEDED' WHERE id='dddd0000-0000-0000-0000-000000000009';`, /transition|cannot/i);

await refuses('a decision cannot be re-attributed after it was made',
  `UPDATE public.diaspora_shipment_observations SET decided_by='operator-1' WHERE id='${RCV}';`, /append-only|cannot be rewritten|immutable|decision/i);

await refuses('an accepted observation cannot be quietly sent back to RECEIVED',
  `UPDATE public.diaspora_shipment_observations SET status='RECEIVED' WHERE id='${RCV}';`, /transition|cannot|check|decision/i);

// ── No erasing ────────────────────────────────────────────────────────────

await refuses('an observation cannot be DELETED — evidence is not erasable',
  `DELETE FROM public.diaspora_shipment_observations WHERE id='${OBS}';`, /cannot be deleted/i);

await refuses('the whole table cannot be emptied either',
  `DELETE FROM public.diaspora_shipment_observations;`, /cannot be deleted/i);

// ── An observation never rewrites the shipment ───────────────────────────

await check('STRUCTURE + BEHAVIOUR: recording and accepting observations leaves the shipment exactly as it was', async () => {
  const r = await db.query(`SELECT status, departure_date, estimated_arrival_date, actual_arrival_date FROM public.diaspora_shipments WHERE id='${SHIP}';`);
  const s = r.rows[0];
  if (s.status !== 'PLANNED' || s.departure_date || s.actual_arrival_date) throw new Error('an observation moved the shipment');
  if (new Date(s.estimated_arrival_date).toISOString() !== '2026-09-18T00:00:00.000Z') throw new Error('an observation rewrote the shipment\'s own estimate');
  const fks = await db.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint
    WHERE conrelid='public.diaspora_shipment_observations'::regclass AND contype='f' ORDER BY 1;`);
  const targets = fks.rows.map((x) => x.target);
  for (const t of targets) if (/stage_events/.test(t)) throw new Error('observations are wired to the movement timeline');
});

// ── Governed access ───────────────────────────────────────────────────────

await check('the browser cannot reach the table at all', async () => {
  const r = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='diaspora_shipment_observations';`);
  if (!r.rows[0].relrowsecurity || !r.rows[0].relforcerowsecurity) throw new Error('not FORCE RLS');
  const g = await db.query(`SELECT has_table_privilege('anon','public.diaspora_shipment_observations','SELECT') AS a,
                                   has_table_privilege('authenticated','public.diaspora_shipment_observations','INSERT') AS b,
                                   has_table_privilege('authenticated','public.diaspora_shipment_observations','UPDATE') AS c;`);
  if (g.rows[0].a || g.rows[0].b || g.rows[0].c) throw new Error('anon/authenticated still hold privileges');
});

await check('Down removes the table and leaves the shipments and legs untouched', async () => {
  await db.exec(down);
  const gone = await db.query(`SELECT to_regclass('public.diaspora_shipment_observations') AS t;`);
  if (gone.rows[0].t) throw new Error('the table is still there after Down');
  const a = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipments;`);
  const b = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipment_legs;`);
  if (a.rows[0].n !== 1 || b.rows[0].n !== 1) throw new Error('Down touched the shipments or legs');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);

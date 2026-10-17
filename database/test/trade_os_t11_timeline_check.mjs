/**
 * Trade OS T11.1 — the movement timeline, on a REAL Postgres (PGlite).
 *
 * The audit found stage events append-only by CONVENTION: nothing in today's codebase rewrites one.
 * That is a statement about today's callers, not a property of the data — and a timeline whose
 * immutability depends on everybody continuing to behave is one that will eventually be edited by
 * somebody fixing a typo. A movement history that can be rewritten afterwards is not evidence.
 *
 * So the guard is exercised by trying to break it, and the correction path is proven to still work:
 * a mistaken event is SUPERSEDED and attributed, never erased.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260915090000_trade_os_t11_timeline_append_only.sql', import.meta.url), 'utf-8');
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

const EVENT = 'bbbb0000-0000-0000-0000-000000000001';
const SHIPMENT = 'aaaa0000-0000-0000-0000-000000000001';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('operator-1'), ('operator-2');

  CREATE TABLE public.diaspora_shipment_stage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NULL,
    shipment_id uuid NOT NULL,
    import_order_id uuid NULL,
    stage text NOT NULL,
    notes text NULL,
    location text NULL,
    event_time timestamptz NOT NULL DEFAULT now(),
    verification_status text NOT NULL DEFAULT 'PENDING_REVIEW',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by text NULL REFERENCES public.users(id),
    updated_by text NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz NULL
  );
`);

await check('the migration applies', async () => { await db.exec(up); });

await check('an event can be recorded', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_stage_events
    (id, shipment_id, stage, location, notes, event_time, created_by)
    VALUES ('${EVENT}', '${SHIPMENT}', 'IN_TRANSIT', 'Durban', 'Vessel departed', now(), 'operator-1');`);
});

// ── What happened cannot be rewritten ──────────────────────────────────────

await refuses('the STAGE cannot be rewritten — that would change what happened',
  `UPDATE public.diaspora_shipment_stage_events SET stage='ARRIVED' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('the EVENT TIME cannot be rewritten — that would change when it happened',
  `UPDATE public.diaspora_shipment_stage_events SET event_time = now() - interval '5 days' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('the LOCATION cannot be rewritten — that would change where it happened',
  `UPDATE public.diaspora_shipment_stage_events SET location='Beira' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('the AUTHOR cannot be rewritten — that would change who says so',
  `UPDATE public.diaspora_shipment_stage_events SET created_by='operator-2' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('the NOTES cannot be rewritten — the operator\'s own words stand',
  `UPDATE public.diaspora_shipment_stage_events SET notes='Actually it did not' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('the SHIPMENT cannot be reassigned — an event cannot be moved to another journey',
  `UPDATE public.diaspora_shipment_stage_events SET shipment_id='aaaa0000-0000-0000-0000-000000000002' WHERE id='${EVENT}';`,
  /append-only/);

await refuses('metadata cannot be rewritten — provenance is part of what happened',
  `UPDATE public.diaspora_shipment_stage_events SET metadata='{"source":"invented"}'::jsonb WHERE id='${EVENT}';`,
  /append-only/);

await refuses('an event cannot be DELETED — an erasable history is not evidence',
  `DELETE FROM public.diaspora_shipment_stage_events WHERE id='${EVENT}';`,
  /cannot be deleted/);

await refuses('the whole table cannot be emptied either',
  `DELETE FROM public.diaspora_shipment_stage_events;`,
  /cannot be deleted/);

// ── …but a correction is still possible ────────────────────────────────────

await check('POSITIVE CONTROL: a mistaken event can be SUPERSEDED, attributably', async () => {
  await db.exec(`UPDATE public.diaspora_shipment_stage_events
    SET deleted_at = now(), updated_by = 'operator-2', updated_at = now() WHERE id='${EVENT}';`);
  const r = await db.query(`SELECT deleted_at, updated_by, stage, created_by FROM public.diaspora_shipment_stage_events WHERE id='${EVENT}';`);
  if (!r.rows[0].deleted_at) throw new Error('the event was not superseded');
  if (r.rows[0].updated_by !== 'operator-2') throw new Error('the correction is not attributed');
  // The original fact and its author survive the correction.
  if (r.rows[0].stage !== 'IN_TRANSIT') throw new Error('the original stage was lost');
  if (r.rows[0].created_by !== 'operator-1') throw new Error('the original author was lost');
});

await check('POSITIVE CONTROL: the correction is a NEW event, and both rows remain', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_stage_events
    (shipment_id, stage, location, notes, event_time, created_by)
    VALUES ('${SHIPMENT}', 'IN_TRANSIT', 'Beira', 'Corrected: departed from Beira, not Durban', now(), 'operator-2');`);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipment_stage_events WHERE shipment_id='${SHIPMENT}';`);
  if (r.rows[0].n !== 2) throw new Error(`${r.rows[0].n} rows, expected both the original and the correction`);
});

// ── Governed access ────────────────────────────────────────────────────────

await check('the browser cannot reach the table at all', async () => {
  const r = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='diaspora_shipment_stage_events';`);
  if (!r.rows[0].relrowsecurity || !r.rows[0].relforcerowsecurity) throw new Error('not FORCE RLS');
  const g = await db.query(`SELECT has_table_privilege('anon','public.diaspora_shipment_stage_events','SELECT') AS a,
                                   has_table_privilege('authenticated','public.diaspora_shipment_stage_events','UPDATE') AS b,
                                   has_table_privilege('authenticated','public.diaspora_shipment_stage_events','DELETE') AS c;`);
  if (g.rows[0].a || g.rows[0].b || g.rows[0].c) throw new Error('anon/authenticated still hold privileges');
});

await check('Down removes the guards without destroying the history', async () => {
  await db.exec(down);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipment_stage_events;`);
  if (r.rows[0].n !== 2) throw new Error('events were lost by Down');
  // With the guards gone the rows are mutable again — which is exactly why the guards exist.
  await db.exec(`UPDATE public.diaspora_shipment_stage_events SET stage='ARRIVED' WHERE id='${EVENT}';`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);

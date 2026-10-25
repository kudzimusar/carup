/**
 * T11-CAP-LR01 — the staging convergence harness, rehearsed on a staging-shaped PGlite world.
 *
 * The harness writes to a SHARED database, so the test of it is mostly about what it must refuse, what it must
 * leave alone, and what it must notice:
 *
 *   · it applies exactly three reviewed migrations, atomically with their ledger rows, and is idempotent;
 *   · it refuses anything that is not approved staging, anything read-only, and any migration that is not the
 *     reviewed bytes;
 *   · it STOPS on a partial state rather than guessing, and resumes a clean prefix;
 *   · a migration that changes the SHARED dedupe function is rolled back before it can commit — the tripwire for
 *     the defect the first CAP-08 design had;
 *   · the verify step notices tampering, and the expected manifest cannot drift from the migrations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MANIFEST, DEFAULT_MIGRATIONS_DIR, EXPECTED_STAGING_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF, HarnessStop, LEDGER_CREATED_BY,
  MIGRATIONS, apply, catalogSnapshot, ensureStagingDbUrl, loadMigration, makeDb, preflight, verify,
} from '../scripts/t11-cap-stg-converge.mjs';
import { stagingWorld } from './helpers/capStagingWorld.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 't11-cap-stg-converge.mjs');
const FILES = MIGRATIONS.map((m) => m.file);
const VERSIONS = FILES; // the ledger contract: the version is the full filename

const fresh = async (opts) => { const world = await stagingWorld(opts); return { world, db: makeDb(world) }; };
const ledger = async (db) => (await db.query(`select version, name, created_by from supabase_migrations.schema_migrations where created_by = $1 order by version`, [LEDGER_CREATED_BY])).rows;
const sharedMd5 = async (db) => (await db.query(`select md5(prosrc) as h from pg_proc where proname = 'communication_domain_event_dedupe_key'`)).rows[0].h;
const keyOf = async (world, type, payload) => {
  const r = await world.query(`INSERT INTO public.domain_events (event_type, payload) VALUES ($1, $2::jsonb) RETURNING id, dedupe_key`, [type, JSON.stringify(payload)]);
  await world.query(`DELETE FROM public.domain_events WHERE id = $1`, [r.rows[0].id]);
  return r.rows[0].dedupe_key;
};
const rejects = async (fn, code) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, 'the harness accepted what it must refuse');
  assert.ok(err instanceof HarnessStop, `expected a HarnessStop, got ${err?.stack || err}`);
  assert.equal(err.code, code);
  return err;
};

// ── The whole run, on a staging-shaped world ──────────────────────────────────────────────────────

test('T11-CAP-STG: a clean staging is READY_TO_APPLY, and the three migrations apply with their ledger rows', async () => {
  const { world, db } = await fresh();
  const pre = await preflight(db);
  assert.equal(pre.verdict, 'READY_TO_APPLY');
  assert.deepEqual(pre.ledger_rows, []);
  const out = await apply(db, { productSha: 'test-sha' });
  assert.deepEqual(out.applied.map((a) => a.action), ['applied', 'applied', 'applied']);
  const rows = await ledger(db);
  assert.deepEqual(rows.map((r) => r.version), VERSIONS);
  assert.deepEqual(rows.map((r) => r.name), MIGRATIONS.map((m) => m.name));
  assert.ok(rows.every((r) => r.created_by === LEDGER_CREATED_BY));
  const v = await verify(db, { sharedMd5: out.shared_function_md5 });
  assert.equal(v.verdict, 'CATALOG_MATCHES_EXPECTED', v.problems.join(' | '));
  await world.close();
});

test('T11-CAP-STG: the ledger version is the FULL FILENAME — the repo\'s documented contract — not a timestamp prefix', async () => {
  const { world, db } = await fresh();
  await apply(db);
  for (const row of await ledger(db)) assert.match(row.version, /^\d{14}_.+\.sql$/);
  await world.close();
});

test('T11-CAP-STG: the SHARED dedupe function is byte-for-byte untouched, and every other lineage\'s branch still answers', async () => {
  const { world, db } = await fresh();
  const before = await sharedMd5(db);
  await apply(db);
  assert.equal(await sharedMd5(db), before);
  assert.equal(await keyOf(world, 'service.case.accepted', { serviceCaseId: 'c-1' }), 'service.case.accepted:c-1');
  assert.equal(await keyOf(world, 'garage.estimate.sent', { notificationKey: 'k-1' }), 'garage.estimate.sent:k-1');
  assert.equal(await keyOf(world, 'marketplace.inquiry.created', { inquiryId: 'i-1' }), 'marketplace.inquiry.created:i-1');
  await world.close();
});

test('T11-CAP-STG: after applying, a Journey alert has a database identity and a duplicate is refused', async () => {
  const { world, db } = await fresh();
  assert.equal(await keyOf(world, 'diaspora.journey.alert', { alertKey: 'DEPARTED:o:u:e' }), null, 'precondition: no identity before');
  await apply(db);
  assert.equal(await keyOf(world, 'diaspora.journey.alert', { alertKey: 'DEPARTED:o:u:e' }), 'diaspora.journey.alert:DEPARTED:o:u:e');
  await world.query(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '{"alertKey":"A:o:u:e"}')`);
  await assert.rejects(() => world.query(`INSERT INTO public.domain_events (event_type, payload) VALUES ('diaspora.journey.alert', '{"alertKey":"A:o:u:e"}')`), /duplicate key|idx_domain_events_dedupe_key/);
  await world.close();
});

test('T11-CAP-STG: another programme\'s events and other triggers on domain_events are untouched', async () => {
  const { world, db } = await fresh();
  await apply(db);
  const names = (await world.query(`select tgname from pg_trigger where not tgisinternal and tgrelid = 'public.domain_events'::regclass order by 1`)).rows.map((r) => r.tgname);
  assert.deepEqual(names, ['trg_domain_events_communication_dedupe', 'trg_domain_events_journey_alert_dedupe', 'trg_minimize_referral_bridge_outbox_payload']);
  await world.close();
});

// ── Idempotency, resume, and refusing to guess ────────────────────────────────────────────────────

test('T11-CAP-STG: running again is a no-op — ALREADY_APPLIED, no second ledger row, nothing re-run', async () => {
  const { world, db } = await fresh();
  await apply(db);
  const before = await ledger(db);
  const again = await apply(db);
  assert.deepEqual(again.applied, []);
  assert.equal((await preflight(db)).verdict, 'ALREADY_APPLIED');
  assert.deepEqual(await ledger(db), before);
  await world.close();
});

test('T11-CAP-STG: a clean prefix is resumed — the applied migration is skipped, the rest are applied', async () => {
  const { world, db } = await fresh();
  // simulate a run that stopped after the first migration: apply it by hand with its ledger row
  const first = loadMigration(MIGRATIONS[0]);
  await world.exec('BEGIN');
  await world.exec(first.up);
  await world.query(`insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, $3::text[], $4)`, [first.version, first.name, ['x'], LEDGER_CREATED_BY]);
  await world.exec('COMMIT');
  assert.equal((await preflight(db)).verdict, 'RESUME_PREFIX_APPLIED');
  const out = await apply(db);
  assert.deepEqual(out.applied.map((a) => a.action), ['skipped_already_in_ledger', 'applied', 'applied']);
  assert.equal((await verify(db, {})).verdict, 'CATALOG_MATCHES_EXPECTED');
  await world.close();
});

test('T11-CAP-STG: objects that exist WITHOUT a ledger row are a STOP — it will not guess, and it changes nothing', async () => {
  const { world, db } = await fresh();
  await world.exec(`CREATE TABLE public.diaspora_shipment_observations (id uuid PRIMARY KEY)`);
  await rejects(() => preflight(db), 'STOP_PARTIAL_STATE');
  await rejects(() => apply(db), 'STOP_PARTIAL_STATE');
  assert.deepEqual(await ledger(db), []);
  await world.close();
});

test('T11-CAP-STG: a ledger row WITHOUT its objects is a STOP', async () => {
  const { world, db } = await fresh();
  await world.query(`insert into supabase_migrations.schema_migrations (version, name, created_by) values ($1, 'x', $2)`, [VERSIONS[0], LEDGER_CREATED_BY]);
  await rejects(() => preflight(db), 'STOP_PARTIAL_STATE');
  await world.close();
});

test('T11-CAP-STG: a ledger with a later migration but not an earlier one (not a prefix) is a STOP', async () => {
  const { world, db } = await fresh();
  const third = loadMigration(MIGRATIONS[2]);
  await world.exec(third.up);
  await world.query(`insert into supabase_migrations.schema_migrations (version, name, created_by) values ($1, 'x', $2)`, [third.version, LEDGER_CREATED_BY]);
  const err = await rejects(() => preflight(db), 'STOP_PARTIAL_STATE');
  assert.match(err.message, /not a prefix/);
  await world.close();
});

// ── What it refuses ───────────────────────────────────────────────────────────────────────────────

test('T11-CAP-STG: a missing prerequisite blocks it, naming what is missing', async () => {
  const { world, db } = await fresh();
  await world.exec(`DROP TABLE public.communication_template_versions`);
  const err = await rejects(() => preflight(db), 'BLOCKED_PREREQUISITES');
  assert.match(err.message, /communication_template_versions/);
  await world.close();
});

test('T11-CAP-STG: a missing prerequisite table that has no column check is still caught, by name', async () => {
  // diaspora_shipment_stage_events is a prerequisite table with no column-type check, so nothing else can catch it
  const { world, db } = await fresh();
  await world.exec(`DROP TABLE public.diaspora_shipment_stage_events`);
  const err = await rejects(() => preflight(db), 'BLOCKED_PREREQUISITES');
  assert.match(err.message, /prerequisite tables absent: diaspora_shipment_stage_events/);
  await world.close();
});

test('T11-CAP-STG: a prerequisite column of the wrong type blocks it — the foreign keys depend on the types', async () => {
  const { world, db } = await fresh();
  await world.exec(`ALTER TABLE public.users ALTER COLUMN id TYPE uuid USING gen_random_uuid()`);
  const err = await rejects(() => preflight(db), 'BLOCKED_PREREQUISITES');
  assert.match(err.message, /users\.id/);
  await world.close();
});

test('T11-CAP-STG: no dedupe unique index, or no shared function, blocks it', async () => {
  const a = await fresh();
  await a.world.exec(`DROP INDEX public.idx_domain_events_dedupe_key`);
  assert.match((await rejects(() => preflight(a.db), 'BLOCKED_PREREQUISITES')).message, /idx_domain_events_dedupe_key/);
  await a.world.close();
  const b = await fresh({ sharedFunction: false });
  assert.match((await rejects(() => preflight(b.db), 'BLOCKED_PREREQUISITES')).message, /communication_domain_event_dedupe_key/);
  await b.world.close();
});

test('T11-CAP-STG: a missing ledger table blocks it', async () => {
  const { world, db } = await fresh();
  await world.exec(`DROP TABLE supabase_migrations.schema_migrations`);
  await rejects(() => preflight(db), 'BLOCKED_PREREQUISITES');
  await world.close();
});

test('T11-CAP-STG: a read-only connection cannot apply, and nothing is changed', async () => {
  const { world, db } = await fresh();
  await world.exec(`SET default_transaction_read_only = on`);
  await rejects(() => apply(db), 'READ_ONLY');
  await world.exec(`SET default_transaction_read_only = off`);
  assert.deepEqual(await ledger(db), []);
  assert.equal((await world.query(`select to_regclass('public.diaspora_shipment_legs') as r`)).rows[0].r, null);
  await world.close();
});

test('T11-CAP-STG: only the approved STAGING project is accepted — production is refused by name', () => {
  const ok = `postgresql://u:p@db.${EXPECTED_STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
  assert.equal(ensureStagingDbUrl(ok), ok);
  for (const bad of [
    '', `postgresql://u:p@db.${FORBIDDEN_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
    'postgresql://u:p@db.someotherprojectref.supabase.co:5432/postgres', `postgresql://u:p@${FORBIDDEN_PRODUCTION_PROJECT_REF}.pooler/${EXPECTED_STAGING_PROJECT_REF}`,
  ]) assert.throws(() => ensureStagingDbUrl(bad), (e) => e instanceof HarnessStop && ['NO_DATABASE_URL', 'NOT_APPROVED_STAGING'].includes(e.code), `accepted: ${bad}`);
});

test('T11-CAP-STG: the production ref is refused even when the staging ref is also present', () => {
  const both = `postgresql://u:p@db.${EXPECTED_STAGING_PROJECT_REF}.supabase.co/${FORBIDDEN_PRODUCTION_PROJECT_REF}`;
  assert.throws(() => ensureStagingDbUrl(both), (e) => e.code === 'NOT_APPROVED_STAGING');
});

test('T11-CAP-STG: the pinned blobs are the committed migrations — an edit without a re-pin is refused', () => {
  for (const m of MIGRATIONS) assert.doesNotThrow(() => loadMigration(m), m.file);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mig-'));
  for (const f of FILES) fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
  fs.appendFileSync(path.join(dir, FILES[1]), '\n-- an unreviewed edit\n');
  assert.throws(() => loadMigration(MIGRATIONS[1], dir), (e) => e.code === 'BLOB_MISMATCH');
});

test('T11-CAP-STG: an unreviewed migration is refused BEFORE anything is written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mig-'));
  for (const f of FILES) fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
  fs.appendFileSync(path.join(dir, FILES[2]), '\n-- an unreviewed edit\n');
  const { world, db } = await fresh();
  await rejects(() => apply(db, { migrationsDir: dir }), 'BLOB_MISMATCH');
  assert.deepEqual(await ledger(db), [], 'a migration was applied although a later one was unreviewed');
  assert.equal((await world.query(`select to_regclass('public.diaspora_shipment_legs') as r`)).rows[0].r, null);
  await world.close();
});

// ── Atomicity and the tripwire ────────────────────────────────────────────────────────────────────

/** The same plan with different SQL behind a file name, and the blob re-pinned to match — to rehearse a bad migration. */
function planWith(replacements) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mig-'));
  for (const f of FILES) fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
  for (const [file, sql] of Object.entries(replacements)) fs.writeFileSync(path.join(dir, file), sql);
  const migrations = MIGRATIONS.map((m) => {
    const buffer = fs.readFileSync(path.join(dir, m.file));
    return { ...m, blob: crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex') };
  });
  return { dir, migrations };
}

test('T11-CAP-STG: THE TRIPWIRE — a migration that re-states the shared dedupe function is rolled back before it commits', async () => {
  const restate = `-- +migrate Up
CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RETURN NEW; END; $$;
-- +migrate Down
SELECT 1;
`;
  const { dir, migrations } = planWith({ [FILES[2]]: restate });
  const { world, db } = await fresh();
  const before = await sharedMd5(db);
  await rejects(() => apply(db, { migrationsDir: dir, migrations }), 'SHARED_FUNCTION_CHANGED');
  assert.equal(await sharedMd5(db), before, 'the shared function was changed and kept');
  assert.equal(await keyOf(world, 'service.case.accepted', { serviceCaseId: 'c-9' }), 'service.case.accepted:c-9', 'another lineage\'s branch was lost');
  assert.deepEqual((await ledger(db)).map((r) => r.version), [VERSIONS[0], VERSIONS[1]], 'the offending migration was recorded');
  await world.close();
});

test('T11-CAP-STG: a migration that fails mid-way is rolled back whole — no half-built table, no ledger row — and the earlier ones stand', async () => {
  const broken = `-- +migrate Up
CREATE TABLE public.diaspora_shipment_observations (id uuid PRIMARY KEY);
SELECT this_function_does_not_exist();
-- +migrate Down
SELECT 1;
`;
  const { dir, migrations } = planWith({ [FILES[1]]: broken });
  const { world, db } = await fresh();
  await rejects(() => apply(db, { migrationsDir: dir, migrations }), 'APPLY_FAILED');
  assert.equal((await world.query(`select to_regclass('public.diaspora_shipment_observations') as r`)).rows[0].r, null, 'a half-built table was left behind');
  assert.deepEqual((await ledger(db)).map((r) => r.version), [VERSIONS[0]]);
  assert.notEqual((await world.query(`select to_regclass('public.diaspora_shipment_legs') as r`)).rows[0].r, null, 'the earlier migration was lost');
  // and a re-run after the fault is fixed resumes cleanly
  const out = await apply(db);
  assert.deepEqual(out.applied.map((a) => a.action), ['skipped_already_in_ledger', 'applied', 'applied']);
  await world.close();
});

test('T11-CAP-STG: the ledger row is ATOMIC with its migration — if the ledger cannot be written, the schema change is undone', async () => {
  const { world, db } = await fresh();
  // a ledger that refuses this harness's rows: the DDL has already run inside the transaction when the insert fails
  await world.exec(`ALTER TABLE supabase_migrations.schema_migrations ADD CONSTRAINT never_for_cap CHECK (created_by <> '${LEDGER_CREATED_BY}')`);
  await rejects(() => apply(db), 'APPLY_FAILED');
  assert.equal((await world.query(`select to_regclass('public.diaspora_shipment_legs') as r`)).rows[0].r, null, 'the table survived although its ledger row could not be written');
  assert.equal((await world.query(`select count(*)::int as n from pg_proc where proname like 'carup_shipment_leg_%'`)).rows[0].n, 0);
  await world.close();
});

test('T11-CAP-STG: a migration refused by the tripwire does not poison a later correct run', async () => {
  const restate = `-- +migrate Up
CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
-- +migrate Down
SELECT 1;
`;
  const { dir, migrations } = planWith({ [FILES[2]]: restate });
  const { world, db } = await fresh();
  await rejects(() => apply(db, { migrationsDir: dir, migrations }), 'SHARED_FUNCTION_CHANGED');
  const out = await apply(db);
  assert.deepEqual(out.applied.map((a) => a.action), ['skipped_already_in_ledger', 'skipped_already_in_ledger', 'applied']);
  assert.equal((await verify(db, {})).verdict, 'CATALOG_MATCHES_EXPECTED');
  await world.close();
});

// ── Verify notices tampering ──────────────────────────────────────────────────────────────────────

async function applied() { const w = await fresh(); const out = await apply(w.db); return { ...w, sharedMd5: out.shared_function_md5 }; }
const problemsAfter = async (mutate) => {
  const w = await applied();
  await mutate(w.world);
  const v = await verify(w.db, { sharedMd5: w.sharedMd5 });
  await w.world.close();
  return v.problems.join(' | ');
};

test('T11-CAP-STG: verify notices a missing Journey trigger', async () => {
  assert.match(await problemsAfter((w) => w.exec(`DROP TRIGGER trg_domain_events_journey_alert_dedupe ON public.domain_events`)), /trigger missing: domain_events\.trg_domain_events_journey_alert_dedupe/);
});

test('T11-CAP-STG: verify notices an altered function body', async () => {
  assert.match(await problemsAfter((w) => w.exec(`CREATE OR REPLACE FUNCTION public.communication_journey_alert_dedupe_key() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$ BEGIN RETURN NEW; END; $$`)), /function body differs/);
});

test('T11-CAP-STG: verify notices row-level security switched off, and browser grants', async () => {
  // asserted by the message only the explicit check produces — the manifest comparison also notices, and must not be what hides a removal of it
  assert.match(await problemsAfter((w) => w.exec(`ALTER TABLE public.diaspora_shipment_legs NO FORCE ROW LEVEL SECURITY`)), /does not have FORCE RLS/);
  assert.match(await problemsAfter((w) => w.exec(`ALTER TABLE public.diaspora_shipment_legs DISABLE ROW LEVEL SECURITY`)), /does not have FORCE RLS/);
  assert.match(await problemsAfter((w) => w.exec(`GRANT SELECT ON public.diaspora_shipment_observations TO anon`)), /reachable by the browser roles/);
});

test('T11-CAP-STG: verify notices the Journey function made executable by the browser', async () => {
  assert.match(await problemsAfter((w) => w.exec(`GRANT EXECUTE ON FUNCTION public.communication_journey_alert_dedupe_key() TO anon`)), /executable by the browser or PUBLIC/);
  assert.match(await problemsAfter((w) => w.exec(`GRANT EXECUTE ON FUNCTION public.communication_journey_alert_dedupe_key() TO PUBLIC`)), /executable by the browser or PUBLIC/);
});

test('T11-CAP-STG: verify notices one of its triggers appearing where it does not belong', async () => {
  const problems = await problemsAfter((w) => w.exec(`CREATE TRIGGER trg_shipment_leg_guard BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_leg_guard()`));
  assert.match(problems, /unexpected trigger: tenants\.trg_shipment_leg_guard/);
});

test('T11-CAP-STG: verify notices a missing or altered governed template', async () => {
  assert.match(await problemsAfter((w) => w.exec(`UPDATE public.communication_template_versions SET body_template = '{{reference}}'`)), /governed template/);
  assert.match(await problemsAfter((w) => w.exec(`UPDATE public.communication_templates SET status = 'retired' WHERE template_key = 'journey_update_v1'`)), /governed template/);
});

test('T11-CAP-STG: verify notices a changed shared dedupe function, and a removed domain_events trigger', async () => {
  assert.match(await problemsAfter((w) => w.exec(`CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`)), /the shared dedupe function changed/);
  assert.match(await problemsAfter((w) => w.exec(`DROP TRIGGER trg_minimize_referral_bridge_outbox_payload ON public.domain_events`)), /domain_events trigger missing: trg_minimize_referral_bridge_outbox_payload/);
});

test('T11-CAP-STG: verify notices a missing ledger row', async () => {
  assert.match(await problemsAfter((w) => w.exec(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '${VERSIONS[1]}'`)), /ledger row missing/);
});

// ── The manifest cannot drift ─────────────────────────────────────────────────────────────────────

test('T11-CAP-STG: the committed manifest is exactly what the migrations produce on the rehearsal world', async () => {
  const w = await applied();
  const snap = await catalogSnapshot(w.db);
  await w.world.close();
  const expected = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'));
  const { domain_events_triggers_must_include: must, ...rest } = expected;
  assert.deepEqual(snap, rest, 'the expected manifest is stale — regenerate it from the rehearsal and review the diff');
  assert.deepEqual(must, ['trg_domain_events_communication_dedupe', 'trg_domain_events_journey_alert_dedupe', 'trg_minimize_referral_bridge_outbox_payload']);
});

test('T11-CAP-STG: the manifest covers exactly the objects the three migrations own', () => {
  const m = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'));
  assert.deepEqual(m.tables.map((t) => t.name).sort(), ['diaspora_shipment_legs', 'diaspora_shipment_observations']);
  assert.deepEqual(m.functions.map((f) => f.name).sort(), ['carup_shipment_leg_guard', 'carup_shipment_leg_no_delete', 'carup_shipment_observation_guard', 'carup_shipment_observation_no_delete', 'communication_journey_alert_dedupe_key']);
  assert.equal(m.triggers.length, 5);
  assert.ok(m.tables.every((t) => t.rls && t.force_rls && !t.anon_any && !t.authenticated_any));
});

// ── The command line ──────────────────────────────────────────────────────────────────────────────

const cli = (env, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, DIASPORA_STAGING_DATABASE_URL: '', ...env } });

test('T11-CAP-STG: the CLI refuses with no database URL — loudly, exit 2, never a silent no-op', () => {
  // this repository lives in a path with a space; a main-guard that compared raw URLs would print nothing and exit 0
  const r = cli({}, '--mode=preflight');
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /BLOCKED: DIASPORA_STAGING_DATABASE_URL is not configured/);
});

test('T11-CAP-STG: the CLI refuses a production URL by name, and refuses an unknown mode', () => {
  const prod = cli({ DIASPORA_STAGING_DATABASE_URL: `postgresql://u:p@db.${FORBIDDEN_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres` }, '--mode=apply');
  assert.equal(prod.status, 2);
  assert.match(prod.stderr, /REFUSING T11-CAP CONVERGENCE OUTSIDE APPROVED STAGING/);
  const mode = cli({}, '--mode=nuke');
  assert.equal(mode.status, 2);
  assert.match(mode.stderr, /unsupported --mode=nuke/);
});

test('T11-CAP-STG: the harness never targets production by construction — the production ref appears only as a refusal', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const uses = [...source.matchAll(new RegExp(FORBIDDEN_PRODUCTION_PROJECT_REF, 'g'))].length;
  assert.equal(uses, 1, 'the production project ref must appear exactly once: as the constant that is refused');
  assert.match(source, /value\.includes\(FORBIDDEN_PRODUCTION_PROJECT_REF\) \|\| !value\.includes\(EXPECTED_STAGING_PROJECT_REF\)/);
});

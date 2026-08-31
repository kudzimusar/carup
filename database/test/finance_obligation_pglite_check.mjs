/**
 * Behavioural verification of 20260901120000_vehicle_finance_obligation_authority.sql against a
 * REAL PostgreSQL (PGlite 17.5, WASM) — no daemon, no staging, no production.
 *
 * WHY THIS FILE EXISTS. `migration_pglite_check.mjs` carries an explicit NEW_MIGRATIONS list that
 * stops at 20260810120000, so a migration added after that date is never executed by any gate in
 * this repo: `migration-integrity.test.js` only parses the file and checks its markers. Shipping on
 * that alone would mean the first execution of this DDL happens on a real database.
 *
 * That is not hypothetical for this migration in particular. The design this file implements was
 * adversarially reviewed, and the review found a FATAL defect of exactly the class only an apply
 * can catch: the original draft re-emitted `passport_transition_ownership_transfer_atomic` with
 * `RETURNS public.vehicle_ownership_transfers`, a type resolved at CREATE FUNCTION parse time,
 * against an environment where that table does not exist — which would have aborted the entire
 * migration file, including the R24 trigger it relied on as its own mitigation. The remedy was to
 * drop the RPC re-emission entirely and enforce R24 on `vehicles.owner_id` directly. This harness
 * is how that remedy is proven rather than asserted.
 *
 * It applies Up, exercises the INVARIANTS behaviourally, applies Down, and re-applies Up.
 *
 * Run:  node database/test/finance_obligation_pglite_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE = '20260901120000_vehicle_finance_obligation_authority.sql';

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf8');
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down };
}

/**
 * The PRE-EXISTING schema this migration builds on, reduced to exactly the objects it references.
 * Column types are taken from the real migrations so a type mismatch would surface here:
 * vehicles.tenant_id is UUID, vehicles.owner_id/users.id are TEXT, and the three FK targets
 * (lender_profiles, provider_registry, vehicle_evidence) are UUID.
 */
const BOOTSTRAP = `
-- PGlite (PG17) carries gen_random_uuid() in core; the pgcrypto EXTENSION is unavailable here and
-- is not needed, exactly as migration_pglite_check.mjs records.
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE vehicles (
  vin TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  tenant_id UUID,
  publication_status TEXT DEFAULT 'draft',
  seller_finance_disclosure JSONB
);
CREATE TABLE lender_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), active BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE provider_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_type TEXT NOT NULL CHECK (capability_type IN ('government_source','insurance','finance','escrow')),
  activation_mode TEXT NOT NULL DEFAULT 'not_configured',
  kill_switch_enabled BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE vehicle_evidence (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vin TEXT, verification_status TEXT DEFAULT 'unverified');
CREATE TABLE disclosure_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT,
  claim_type TEXT,
  CONSTRAINT disclosure_claims_claim_type_check CHECK (claim_type IN (
    'no_accident_history','original_paint','no_major_repairs','genuine_mileage',
    'single_owner','recently_inspected','never_imported','component_present',
    'defect_disclosed','other'))
);

CREATE OR REPLACE FUNCTION governance_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'Append-only table %: % is not permitted', TG_TABLE_NAME, TG_OP; END; $$;
`;

const db = new PGlite();
const results = { overall: 'PASS', up: [], invariants: {}, down: [], reup: [], failures: [] };

function fail(label, detail) {
  results.overall = 'FAIL';
  results.failures.push({ label, detail });
}

async function exec(label, sql, bucket) {
  try {
    await db.exec(sql);
    if (bucket) bucket.push({ label, ok: true });
    return true;
  } catch (e) {
    if (bucket) bucket.push({ label, ok: false, error: e.message });
    fail(label, e.message);
    return false;
  }
}

/** Run SQL that MUST be rejected. Returns the error message, or records a failure if it succeeded. */
async function mustReject(label, sql) {
  try {
    await db.exec(sql);
    fail(label, 'expected a rejection but the statement SUCCEEDED');
    return null;
  } catch (e) {
    results.invariants[label] = { rejected: true, message: e.message.slice(0, 160) };
    return e.message;
  }
}

async function mustAccept(label, sql) {
  try {
    await db.exec(sql);
    results.invariants[label] = { accepted: true };
    return true;
  } catch (e) {
    fail(label, `expected success but was rejected: ${e.message}`);
    results.invariants[label] = { accepted: false, error: e.message.slice(0, 160) };
    return false;
  }
}

async function q(sql) {
  try { return (await db.query(sql)).rows; } catch (e) { return [{ _err: e.message }]; }
}

const { up, down } = splitMigration(FILE);

// ── 1. bootstrap + Up ────────────────────────────────────────────────────────────────────────
await exec('bootstrap', BOOTSTRAP, results.up);
await exec(`${FILE} (Up)`, up, results.up);

// Seed the actors the invariants need.
await exec('seed', `
  INSERT INTO users(id) VALUES ('u_owner'), ('u_admin'), ('u_new_owner');
  INSERT INTO vehicles(vin, owner_id) VALUES ('VINCLEAN','u_owner'), ('VINENC','u_owner'), ('VINDOC','u_owner'), ('VINSUP','u_owner'), ('VINFREE','u_owner');
  INSERT INTO lender_profiles(id, active) VALUES ('11111111-1111-1111-1111-111111111111', true);
`, results.up);

// ── 2. INVARIANTS ────────────────────────────────────────────────────────────────────────────

// M17/INV-18 — settlement_context is a CLOSED SHAPE, not a ban list. `?|` only inspects top-level
// keys, so a ban list is defeated by one level of nesting; an allow-list cannot be.
await mustReject('settlement_context rejects an unlisted key', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by, recorded_reason, settlement_context)
  VALUES ('VINCLEAN','admin_recorded','bank_loan','u_admin','recorded for test','{"apr": 21.5}'::jsonb)`);

await mustReject('settlement_context rejects a private term nested under an allowed key', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by, recorded_reason, settlement_context)
  VALUES ('VINCLEAN','admin_recorded','bank_loan','u_admin','recorded for test','{"notes_internal_ref": {"apr": 21.5}}'::jsonb)`);

await mustAccept('settlement_context accepts the closed allow-listed shape', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by, recorded_reason, settlement_context)
  VALUES ('VINCLEAN','admin_recorded','bank_loan','u_admin','recorded for test','{"notes_internal_ref": "ref-1"}'::jsonb)`);

// Provenance must actually carry its proof.
await mustReject('lender_attested without a lender_profile_id is refused', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, attestation_reference)
  VALUES ('VINCLEAN','lender_attested','bank_loan','REF-1')`);

await mustReject('admin_recorded without a recorded_reason is refused', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by)
  VALUES ('VINCLEAN','admin_recorded','bank_loan','u_admin')`);

// There is no seller_asserted member — a Seller statement never enters this governed table.
await mustReject('seller_asserted is not a member of source_authority', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by)
  VALUES ('VINCLEAN','seller_asserted','bank_loan','u_owner')`);

// R26 — the valuation-at-origination group is all-or-nothing.
await mustReject('a partial valuation-at-origination group is refused', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by, recorded_reason, origination_valuation_amount)
  VALUES ('VINCLEAN','admin_recorded','bank_loan','u_admin','r',12000)`);

// R24 — a GOVERNED, blocking obligation stops an ownership transfer, enforced on vehicles.owner_id
// directly so it holds no matter which ownership-transfer RPC (if any) is installed.
await exec('record a governed blocking obligation on VINENC', `
  SELECT finance_obligation_record_atomic('VINENC','lender_attested','vehicle_finance','active','u_admin','admin',
    jsonb_build_object('lender_profile_id','11111111-1111-1111-1111-111111111111','attestation_reference','ATT-1'))`, results.up);

await mustReject('R24: owner_id cannot change while a governed obligation is unreleased', `
  UPDATE vehicles SET owner_id='u_new_owner' WHERE vin='VINENC'`);

// VINFREE, not VINCLEAN: the settlement_context acceptance check above legitimately left an
// admin_recorded (governed, active) obligation on VINCLEAN, so VINCLEAN is genuinely encumbered and
// R24 correctly refuses it. The control case has to be a vehicle that never received one.
await mustAccept('R24: an unencumbered vehicle transfers normally', `
  UPDATE vehicles SET owner_id='u_new_owner' WHERE vin='VINFREE'`);

// ANTI-VACUITY for the control above: prove the guard is actually armed on the vehicle it just
// let through, rather than passing because the trigger is inert.
await mustReject('R24: the same vehicle is refused once a governed obligation exists on it', `
  INSERT INTO vehicle_finance_obligations(vin, source_authority, obligation_kind, recorded_by, recorded_reason)
  VALUES ('VINFREE','admin_recorded','bank_loan','u_admin','arming the guard');
  UPDATE vehicles SET owner_id='u_owner' WHERE vin='VINFREE'`);

// document_extracted is recorded but NEVER governed/blocking — an unverified upload must not be
// able to freeze a legal ownership transfer.
await exec('record a document_extracted obligation on VINDOC', `
  INSERT INTO vehicle_evidence(id, vin) VALUES ('22222222-2222-2222-2222-222222222222','VINDOC');
  SELECT finance_obligation_record_atomic('VINDOC','document_extracted','bank_loan','active','u_admin','admin',
    jsonb_build_object('evidence_id','22222222-2222-2222-2222-222222222222'))`, results.up);

await mustAccept('document_extracted does NOT block ownership transfer', `
  UPDATE vehicles SET owner_id='u_new_owner' WHERE vin='VINDOC'`);

// The terminal-state authorization rule is enforced at GENESIS too, not only on transition —
// otherwise a row could be created directly at 'released' and bypass the rule entirely.
await mustReject('genesis at released requires a governance/lender actor role', `
  SELECT finance_obligation_record_atomic('VINSUP','admin_recorded','bank_loan','released','u_owner','owner',
    jsonb_build_object('recorded_reason','r','release_reference','REL-1'))`);

await mustReject('genesis at released still requires a release reference', `
  SELECT finance_obligation_record_atomic('VINSUP','admin_recorded','bank_loan','released','u_admin','admin',
    jsonb_build_object('recorded_reason','r'))`);

// R25/R26 — origination truth is immutable; a correction is a NEW superseding row.
{
  const rows = await q(`SELECT id FROM vehicle_finance_obligations WHERE vin='VINENC' LIMIT 1`);
  const id = rows[0]?.id;
  results.invariants.obligation_id = id || null;

  await mustReject('R26: the valuation-at-origination cannot be UPDATEd in place',
    `UPDATE vehicle_finance_obligations SET origination_valuation_amount=1 WHERE id='${id}'`);
  await mustReject('R25: the obligation row cannot be DELETEd',
    `DELETE FROM vehicle_finance_obligations WHERE id='${id}'`);
  await mustReject('R25: the event ledger cannot be UPDATEd',
    `UPDATE vehicle_finance_obligation_events SET reason='x' WHERE obligation_id='${id}'`);
  await mustReject('R25: the event ledger cannot be DELETEd',
    `DELETE FROM vehicle_finance_obligation_events WHERE obligation_id='${id}'`);

  // 'released' is reachable ONLY from 'settled_pending_release': settlement and lender release are
  // two different facts and must not collapse into one.
  await mustReject('released is not reachable directly from active',
    `SELECT finance_obligation_transition_atomic('${id}','released','u_admin','admin',NULL,NULL,'REL-1')`);
  await mustAccept('active -> settled_pending_release is permitted for a governance actor',
    `SELECT finance_obligation_transition_atomic('${id}','settled_pending_release','u_admin','admin',NULL,NULL,NULL)`);
  await mustReject('a non-governance actor may not record the lender release',
    `SELECT finance_obligation_transition_atomic('${id}','released','u_owner','owner',NULL,NULL,'REL-1')`);
  await mustAccept('settled_pending_release -> released with a reference is permitted',
    `SELECT finance_obligation_transition_atomic('${id}','released','u_admin','admin',NULL,NULL,'REL-1')`);

  // R24 lifts once the lender interest is released — the block has a real exit, not a deadlock.
  await mustAccept('R24: transfer proceeds once the obligation is released',
    `UPDATE vehicles SET owner_id='u_new_owner' WHERE vin='VINENC'`);

  // R25: clearing finance does not erase the earlier finance history.
  const events = await q(`SELECT to_state FROM vehicle_finance_obligation_events WHERE obligation_id='${id}' ORDER BY id`);
  results.invariants.durable_event_trail = events.map((r) => r.to_state);
  if (events.length < 3) fail('R25 durable trail', `expected the full transition trail, got ${JSON.stringify(events)}`);
  const stillThere = await q(`SELECT count(*)::int AS n FROM vehicle_finance_obligations WHERE id='${id}'`);
  if (stillThere[0]?.n !== 1) fail('R25 row durability', 'the settled obligation row did not survive');
}

// M16 — the additive claim_type value the existing disclosure engine needs.
await mustAccept('M16: no_finance_outstanding is now a legal claim_type',
  `INSERT INTO disclosure_claims(vin, claim_type) VALUES ('VINENC','no_finance_outstanding')`);
await mustReject('M16: the claim_type vocabulary is still closed',
  `INSERT INTO disclosure_claims(vin, claim_type) VALUES ('VINENC','totally_made_up')`);

// ── 3. Down, then re-Up ──────────────────────────────────────────────────────────────────────
// The Down must not fail on rows this migration made legal — including the disclosure_claims row
// inserted above, which the narrowed CHECK would reject if the Down did not account for it.
await exec('cleanup rows the narrowed Down CHECK would reject',
  `DELETE FROM disclosure_claims WHERE claim_type='no_finance_outstanding'`, results.down);
await exec(`${FILE} (Down)`, down, results.down);

{
  const left = await q(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'vehicle_finance_obligation%'`);
  results.invariants.tables_after_down = left[0]?.n ?? null;
  if (left[0]?.n !== 0) fail('Down reversal', `expected 0 finance-obligation tables after Down, found ${left[0]?.n}`);

  // And the R24 trigger must be gone with it, or a rolled-back migration would keep blocking
  // transfers using a table that no longer exists.
  const trg = await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_block_encumbered_owner_change'`);
  results.invariants.r24_trigger_after_down = trg[0]?.n ?? null;
  if (trg[0]?.n !== 0) fail('Down reversal', 'trg_block_encumbered_owner_change survived the Down');
}

await exec(`${FILE} (re-Up)`, up, results.reup);
{
  const back = await q(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'vehicle_finance_obligation%'`);
  results.invariants.tables_after_reup = back[0]?.n ?? null;
  if (back[0]?.n !== 2) fail('re-Up', `expected 2 tables after re-Up, found ${back[0]?.n}`);
}

console.log(JSON.stringify(results, null, 2));
process.exit(results.overall === 'PASS' ? 0 : 1);

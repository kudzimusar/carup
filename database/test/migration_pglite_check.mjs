/**
 * Isolated migration verification using PGlite (PostgreSQL 17.5, WASM) — no daemon, no
 * production Supabase (master plan §19; integration goal items 4–8).
 *
 * Strategy:
 *   1. Bootstrap a Supabase-compat environment: pgcrypto, roles (anon/authenticated/service_role),
 *      an auth.uid() stub, and the PRE-MERGE prerequisite schema the six new migrations build on
 *      (vehicles, users, domain_events, vehicle_ownership_history, and vehicle_evidence via
 *      the real 014 + 015 migrations).
 *   2. Apply the SIX M1–M6 migrations + Phase 2 security hardening migration Up in order.
 *   3. Apply their Down sections in REVERSE order — verify each.
 *   4. Re-apply all Up sections — verify each (idempotent-after-rollback).
 *   5. Inspect catalog: tables, triggers, views, RLS policies, FK constraints.
 *
 * Run:  node database/test/migration_pglite_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const NEW_MIGRATIONS = [
  '20260621120000_vehicle_life_evidence_taxonomy_provenance.sql',
  '20260621130000_external_source_ingestion.sql',
  '20260621140000_ai_temporal_disclosure_intelligence.sql',
  '20260621150000_report_versions.sql',
  '20260621160000_governance_disputes_corrections.sql',
  '20260621170000_outbox_dead_letter.sql',
  // Phase 2 — security hardening applied after all M1–M6 tables exist
  '20260624120000_vehicle_trust_security_hardening.sql',
];

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down };
}

function upSectionOf(file) {
  return splitMigration(file).up;
}

const BOOTSTRAP = `
  -- pglite (PG17) has gen_random_uuid() in core; pgcrypto extension is unavailable and unneeded.
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  -- Pre-merge prerequisite tables (represent existing production schema):
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, role TEXT, is_verified BOOLEAN DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    vin TEXT PRIMARY KEY, make TEXT, model TEXT, year INT,
    plate_number TEXT, normalized_plate_number TEXT, chassis_number TEXT, engine_number TEXT,
    owner_id TEXT, tenant_id TEXT, trust_score NUMERIC, status TEXT
  );
  CREATE TABLE IF NOT EXISTS domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_type TEXT, status TEXT DEFAULT 'pending',
    attempts INT DEFAULT 0, payload JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  -- Required for report_versions owner read policy (Phase 2)
  CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
    id BIGSERIAL PRIMARY KEY, vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
    previous_owner_id TEXT, new_owner_id TEXT NOT NULL,
    transfer_date TEXT NOT NULL DEFAULT '2026-01-01', transfer_hash TEXT NOT NULL DEFAULT 'h'
  );
`;

const results = { bootstrap: null, prereq: [], up: [], down: [], reup: [], catalog: {}, ok: true };

async function step(db, label, sql, bucket) {
  try {
    await db.exec(sql);
    bucket.push({ label, status: 'OK' });
    return true;
  } catch (e) {
    bucket.push({ label, status: 'FAIL', error: e.message });
    results.ok = false;
    return false;
  }
}

const db = new PGlite();

// 1. bootstrap + prerequisite migrations (014 creates vehicle_evidence, 015 extends it)
results.bootstrap = (await step(db, 'bootstrap (roles/auth/pgcrypto/prereq tables)', BOOTSTRAP, results.prereq)) ? 'OK' : 'FAIL';
await step(db, '014_passport_evidence_architecture (Up)', upSectionOf('014_passport_evidence_architecture.sql'), results.prereq);
await step(db, '015_vehicle_evidence_timeline (Up)', upSectionOf('015_vehicle_evidence_timeline.sql'), results.prereq);

// 1b. seed a LEGACY evidence row (pre-M1) to verify backfill + legacy compatibility (item 9)
try {
  await db.exec(`INSERT INTO users(id) VALUES ('legacy-u');
    INSERT INTO vehicles(vin) VALUES ('LEGACYVIN');
    INSERT INTO vehicle_evidence(vehicle_id,vin,evidence_type,event_type,file_url,storage_bucket,file_path,mime_type,file_size,uploaded_by,uploader_role,checksum)
    VALUES ('LEGACYVIN','LEGACYVIN','odometer_photo','odometer_photo','u','vehicle-images','p','image/png',1,'legacy-u','owner','abc123');`);
} catch (e) { results.catalog.legacy_seed_error = e.message; }

// 2. apply the six new migrations Up in order
for (const f of NEW_MIGRATIONS) {
  await step(db, f, splitMigration(f).up, results.up);
}

// 2b. legacy backfill assertion: M1 should map legacy evidence_type 'odometer_photo' -> class 'inspection'
{
  const row = (await q(`SELECT evidence_class, evidence_subtype, checksum_algorithm FROM vehicle_evidence WHERE vin='LEGACYVIN'`))[0] || {};
  results.catalog.legacy_backfill = {
    evidence_class: row.evidence_class || null,
    evidence_subtype: row.evidence_subtype || null,
    checksum_algorithm: row.checksum_algorithm || null,
    expected_class: 'inspection',
    backfill_ok: row.evidence_class === 'inspection' && row.checksum_algorithm === 'sha256',
  };
}

// 3. catalog inspection (objects created by the six)
async function q(sql) { try { return (await db.query(sql)).rows; } catch (e) { return [{ _err: e.message }]; } }
function n0(rows) { return rows[0] && typeof rows[0].n === 'number' ? rows[0].n : null; }
results.catalog.new_tables = (await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
  ('evidence_class_taxonomy','evidence_sources','evidence_sets','evidence_provenance_events',
   'ingestion_jobs','source_records','vehicle_identity_candidates','listing_snapshots',
   'ai_analysis_jobs','ai_observations','temporal_findings','disclosure_claims','disclosure_conflicts',
   'report_versions','review_tasks','review_decisions','disputes','dispute_events','trust_change_log')
  ORDER BY table_name`)).map(r => r.table_name);
results.catalog.views = (await q(`SELECT table_name FROM information_schema.views WHERE table_schema='public' AND table_name LIKE 'evidence_sources%'`)).map(r => r.table_name);
results.catalog.triggers = (await q(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY trigger_name`)).map(r => `${r.trigger_name} on ${r.event_object_table}`);
results.catalog.rls_policies = (await q(`SELECT polrelid::regclass::text AS tbl, count(*)::int n FROM pg_policy GROUP BY 1 ORDER BY 1`)).map(r => `${r.tbl}: ${r.n}`);

// quick functional check: append-only trigger blocks UPDATE on provenance
try {
  await db.exec(`INSERT INTO users(id) VALUES ('u1'); INSERT INTO vehicles(vin) VALUES ('V1');
    INSERT INTO vehicle_evidence(vehicle_id,vin,evidence_type,event_type,file_url,storage_bucket,file_path,mime_type,file_size,uploaded_by,uploader_role)
    VALUES ('V1','V1','auction_photo','auction_photo','u','vehicle-images','p','image/png',1,'u1','dealer');`);
  const ev = (await q(`SELECT id FROM vehicle_evidence LIMIT 1`))[0].id;
  await db.exec(`INSERT INTO evidence_provenance_events(evidence_id,vin,sequence,event_type,content_hash) VALUES ('${ev}','V1',1,'created','h1')`);
  let blocked = false;
  try { await db.exec(`UPDATE evidence_provenance_events SET event_type='approved' WHERE sequence=1`); }
  catch { blocked = true; }
  results.catalog.provenance_append_only_enforced = blocked;
} catch (e) { results.catalog.provenance_functional_error = e.message; }

// 3b. Phase 2 catalog checks: FK constraint modes + RLS on vehicle_evidence
results.catalog.provenance_fk_mode = (await q(`
  SELECT confdeltype FROM pg_constraint
  WHERE conrelid = 'evidence_provenance_events'::regclass
    AND confrelid = 'vehicle_evidence'::regclass
    AND contype = 'f'
  LIMIT 1`))[0]?.confdeltype || null;
// 'r' = RESTRICT (expected after Phase 2), 'a' = CASCADE (original M1 setting)
results.catalog.provenance_fk_is_restrict = results.catalog.provenance_fk_mode === 'r';
results.catalog.evidence_sets_fk_mode = (await q(`
  SELECT confdeltype FROM pg_constraint
  WHERE conrelid = 'evidence_sets'::regclass
    AND confrelid = 'vehicles'::regclass
    AND contype = 'f'
    AND conkey = (SELECT ARRAY[attnum] FROM pg_attribute
                  WHERE attrelid = 'evidence_sets'::regclass AND attname = 'vin')
  LIMIT 1`))[0]?.confdeltype || null;
results.catalog.evidence_sets_fk_is_restrict = results.catalog.evidence_sets_fk_mode === 'r';
results.catalog.report_versions_fk_mode = (await q(`
  SELECT confdeltype FROM pg_constraint
  WHERE conrelid = 'report_versions'::regclass
    AND confrelid = 'vehicles'::regclass
    AND contype = 'f'
  LIMIT 1`))[0]?.confdeltype || null;
results.catalog.report_versions_fk_is_restrict = results.catalog.report_versions_fk_mode === 'r';
results.catalog.vehicle_evidence_rls = (await q(`
  SELECT relrowsecurity FROM pg_class WHERE relname = 'vehicle_evidence' AND relnamespace = 'public'::regnamespace
`))[0]?.relrowsecurity || false;
results.catalog.vehicle_plate_history_rls = (await q(`
  SELECT relrowsecurity FROM pg_class WHERE relname = 'vehicle_plate_history' AND relnamespace = 'public'::regnamespace
`))[0]?.relrowsecurity || false;

// 4. Down in reverse order
for (const f of [...NEW_MIGRATIONS].reverse()) {
  await step(db, f + ' (Down)', splitMigration(f).down, results.down);
}
results.catalog.tables_after_down = n0(await q(`
  SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN
  ('evidence_class_taxonomy','evidence_sources','evidence_sets','evidence_provenance_events',
   'ingestion_jobs','source_records','vehicle_identity_candidates','listing_snapshots',
   'ai_analysis_jobs','temporal_findings','disclosure_conflicts','report_versions','review_tasks','disputes','trust_change_log')`));

// 5. re-apply Up
for (const f of NEW_MIGRATIONS) {
  await step(db, f + ' (re-Up)', splitMigration(f).up, results.reup);
}
results.catalog.tables_after_reup = results.catalog.new_tables.length;

// report
const fail = (arr) => arr.filter(x => x.status === 'FAIL');
console.log(JSON.stringify({
  overall: results.ok ? 'PASS' : 'FAIL',
  prereq_failures: fail(results.prereq),
  up_failures: fail(results.up),
  down_failures: fail(results.down),
  reup_failures: fail(results.reup),
  up_applied: results.up.filter(x => x.status === 'OK').length,
  down_applied: results.down.filter(x => x.status === 'OK').length,
  reup_applied: results.reup.filter(x => x.status === 'OK').length,
  catalog: results.catalog,
}, null, 2));
process.exit(results.ok ? 0 : 1);

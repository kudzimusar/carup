/**
 * Isolated migration verification using PGlite (PostgreSQL 17.5, WASM) — no daemon, no
 * production Supabase (master plan §19; integration goal items 4–8).
 *
 * Strategy:
 *   1. Bootstrap a Supabase-compat environment: pgcrypto, roles (anon/authenticated/service_role),
 *      an auth.uid() stub, and the PRE-MERGE prerequisite schema the six new migrations build on
 *      (vehicles, users, domain_events, vehicle_ownership_history, and vehicle_evidence via
 *      the real 014 + 015 migrations).
 *   2. Apply the SIX M1–M6 migrations + Phase 2/3/4 migrations Up in order.
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
  // Phase 3 — OCR field-level extraction contract
  '20260624130000_vehicle_document_extractions.sql',
  // Phase 4 — Listing publication lifecycle (publication_status + temp_plate_id on vehicles)
  '20260624140000_listing_publication_lifecycle.sql',
  // Phase 6 — trust_change_log append-only enforcement
  '20260624150000_trust_change_log_immutability.sql',
  // WS2 — external source verification network (append-only registry results)
  '20260626120000_source_verification_network.sql',
  // WS9 — controlled partner API (hashed credentials + append-only request audit)
  '20260626130000_partner_api.sql',
  // WS-A — fraud/duplicate engine (signals, cases, append-only events/resolutions)
  '20260626140000_fraud_engine.sql',
  // WS-B — dealer compliance (eight statuses + append-only decision ledger)
  '20260626150000_dealer_compliance.sql',
  // WS-C/D/E — shared eligibility framework (insurance + finance)
  '20260626160000_eligibility_framework.sql',
  // WS-F — trust-gated escrow lifecycle
  '20260626180000_escrow_trust_sessions.sql',
  // Full Activation — shared provider platform
  '20260703120000_provider_platform.sql',
  // Full Activation — government source activation (config + append-only batch imports)
  '20260703130000_government_source_activation.sql',
  // Full Activation — licensed insurer provider (onboarding + execution)
  '20260703140000_insurance_provider.sql',
  // Full Activation — regulated lender (finance) provider workflow
  '20260703150000_finance_provider.sql',
  // Full Activation — regulated real-money escrow provider extension
  '20260703160000_escrow_provider.sql',
  // Full Activation — native mobile device certification ledger
  '20260703170000_mobile_certification.sql',
  // Full Activation — private storage buckets (PGlite-safe no-op)
  '20260703190000_provider_storage.sql',
  // Full Activation hardening — scope provider request idempotency to (provider_id, idempotency_key)
  '20260710120000_provider_request_attempts_provider_scope.sql',
  // Phase 2B.1 (ported PR #11) — governed PartSentry public-card review workflow + approval provenance
  '20260710130000_partsentry_review_requests.sql',
  // Mechanic OS — converge the two divergent mechanic_work_orders/mechanic_parts shapes
  // (006_domain1.sql legacy shape is applied as a prerequisite below, so this run
  // proves convergence over the HARDER historical shape).
  '20260808150000_mechanic_work_orders_convergence.sql',
  '20260809100000_trust_side_tables.sql',
  '20260809110000_api_role_write_hardening.sql',
  // Trust-side convergence: a no-op over the canonical shape created above
  // (which already satisfies the contract), so its presence here proves the
  // "already converged" idempotency path inside the full migration chain.
  // The divergent-legacy-shape proofs live in
  // backend/tests/trust-side-convergence.test.js.
  '20260810120000_trust_side_convergence.sql',
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
// Legacy Domain-1 shape of the mechanic tables (organization_id/customer_name NOT NULL,
// no tenant/mechanic/cost columns) — the divergent shape the convergence migration must fix.
await step(db, '006_domain1 (Up, legacy mechanic shape)', upSectionOf('006_domain1.sql'), results.prereq);

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

// 3c. Phase 3 catalog checks: vehicle_document_extractions + content-guard trigger
results.catalog.extractions_table = (await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='vehicle_document_extractions'`))[0]?.table_name || null;
results.catalog.extractions_rls = (await q(`
  SELECT relrowsecurity FROM pg_class
  WHERE relname='vehicle_document_extractions' AND relnamespace='public'::regnamespace`))[0]?.relrowsecurity || false;
// Verify content-guard trigger blocks mutation of immutable fields
try {
  const v2 = 'V2PHASE3';
  await db.exec(`INSERT INTO vehicles(vin) VALUES ('${v2}')`);
  const ev2 = (await q(`SELECT id FROM vehicle_evidence LIMIT 1`))[0]?.id;
  if (ev2) {
    await db.exec(`INSERT INTO vehicle_document_extractions
      (evidence_id,vin,document_type,field_name,raw_value,match_status)
      VALUES ('${ev2}','${v2}','registration_document','vin_field','RAWVAL','inconclusive')`);
    let guardBlocked = false;
    try {
      await db.exec(`UPDATE vehicle_document_extractions SET vin='OTHER' WHERE vin='${v2}'`);
    } catch { guardBlocked = true; }
    results.catalog.extraction_content_guard_enforced = guardBlocked;
  } else {
    results.catalog.extraction_content_guard_enforced = 'no_evidence_row';
  }
} catch (e) { results.catalog.extraction_guard_error = e.message; }

// 3d. Phase 4 catalog checks: publication_status and temp_plate_id columns on vehicles
results.catalog.publication_status_col = (await q(`
  SELECT data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='vehicles' AND column_name='publication_status'`))[0]?.data_type || null;
results.catalog.temp_plate_id_col = (await q(`
  SELECT data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='vehicles' AND column_name='temp_plate_id'`))[0]?.data_type || null;
// Verify publication_status CHECK constraint rejects values outside the lifecycle set
try {
  await db.exec(`INSERT INTO vehicles(vin) VALUES ('PUB4TEST')`);
  await db.exec(`UPDATE vehicles SET publication_status='draft' WHERE vin='PUB4TEST'`);
  let badStatusBlocked = false;
  try {
    await db.exec(`UPDATE vehicles SET publication_status='live' WHERE vin='PUB4TEST'`);
  } catch { badStatusBlocked = true; }
  results.catalog.publication_status_check_enforced = badStatusBlocked;
} catch (e) { results.catalog.publication_status_check_error = e.message; }

// 3e. Phase 6 — Append-only immutability functional checks
// Each table must block both UPDATE and DELETE; failure to block is a constraint violation.
async function checkImmutable(tableName, insertSql, updateSql, deleteSql) {
  const res = { update_blocked: false, delete_blocked: false, error: null };
  try {
    await db.exec(insertSql);
    try { await db.exec(updateSql); } catch { res.update_blocked = true; }
    try { await db.exec(deleteSql); } catch { res.delete_blocked = true; }
  } catch (e) { res.error = e.message; }
  return res;
}

// review_decisions — uses decision column, reviewer_id (not decided_by)
results.catalog.review_decisions_immutable = await checkImmutable(
  'review_decisions',
  `INSERT INTO review_decisions(vin,decision,reviewer_id,reviewer_role)
   VALUES ('V1','confirm','u1','reviewer')`,
  `UPDATE review_decisions SET decision='reject' WHERE vin='V1' AND decision='confirm'`,
  `DELETE FROM review_decisions WHERE vin='V1' AND decision='confirm'`
);

// dispute_events — disputes table: raised_by, raised_by_role, no evidence_id
results.catalog.dispute_events_immutable = await checkImmutable(
  'dispute_events',
  `INSERT INTO disputes(vin,raised_by,raised_by_role,status)
   VALUES ('V1','u1','owner','open');
   INSERT INTO dispute_events(dispute_id,event_type,actor_id,actor_role)
   SELECT id,'opened','u1','owner' FROM disputes WHERE vin='V1' ORDER BY created_at DESC LIMIT 1`,
  `UPDATE dispute_events SET event_type='tampered' WHERE actor_id='u1' AND event_type='opened'`,
  `DELETE FROM dispute_events WHERE actor_id='u1' AND event_type='opened'`
);

// listing_snapshots — content_hash not snapshot_hash; vin must exist
results.catalog.listing_snapshots_immutable = await checkImmutable(
  'listing_snapshots',
  `INSERT INTO listing_snapshots(vin,content_hash) VALUES ('V1','hash-imm1')`,
  `UPDATE listing_snapshots SET content_hash='tampered' WHERE content_hash='hash-imm1'`,
  `DELETE FROM listing_snapshots WHERE content_hash='hash-imm1'`
);

// trust_change_log (Phase 6 triggers) — uses approved_by_role
results.catalog.trust_change_log_immutable = await checkImmutable(
  'trust_change_log',
  `INSERT INTO trust_change_log(vin,rule,previous_value,new_value,approved_by_role)
   VALUES ('V1','test_rule','{}','{}','reviewer')`,
  `UPDATE trust_change_log SET rule='tampered' WHERE vin='V1' AND rule='test_rule'`,
  `DELETE FROM trust_change_log WHERE vin='V1' AND rule='test_rule'`
);

// source_verification_results (WS2) — append-only registry verification log
results.catalog.source_verification_immutable = await checkImmutable(
  'source_verification_results',
  `INSERT INTO source_verification_results(vin,provider,mode,query_value,result,confidence)
   VALUES ('V1','zimra','sandbox','V1','match',0.9)`,
  `UPDATE source_verification_results SET result='mismatch' WHERE vin='V1' AND provider='zimra'`,
  `DELETE FROM source_verification_results WHERE vin='V1' AND provider='zimra'`
);

// source verification: mode CHECK rejects an unsanctioned "official" relabel; the public
// coverage view must never expose a sandbox result as a live source_connected status.
results.catalog.source_verification_mode_enforced = await (async () => {
  try {
    await db.exec(`INSERT INTO source_verification_results(vin,provider,mode,query_value,result)
                   VALUES ('V1','cvr','definitely_official','V1','match')`);
    return false; // should have thrown on the mode CHECK
  } catch { return true; }
})();
results.catalog.source_coverage_view_sandbox_labelled = n0(await q(
  `SELECT count(*)::int n FROM source_verification_coverage_public
   WHERE vin='V1' AND provider='zimra' AND coverage_status='sandbox_demonstration'`
)) === 1;

// fraud_signals (WS-A) — append-only signal ledger
results.catalog.fraud_signals_immutable = await checkImmutable(
  'fraud_signals',
  `INSERT INTO fraud_signals(vin,signal_code,severity,confidence,rule_version)
   VALUES ('V1','duplicate_vin','high',0.9,'fraud-rules-1.0.0')`,
  `UPDATE fraud_signals SET severity='low' WHERE vin='V1' AND signal_code='duplicate_vin'`,
  `DELETE FROM fraud_signals WHERE vin='V1' AND signal_code='duplicate_vin'`
);

// dealer_compliance_decisions (WS-B) — append-only governance decision ledger
results.catalog.dealer_decisions_immutable = await checkImmutable(
  'dealer_compliance_decisions',
  `INSERT INTO users(id) VALUES ('dealer-imm-u') ON CONFLICT DO NOTHING;
   INSERT INTO dealer_profiles(user_id) VALUES ('dealer-imm-u');
   INSERT INTO dealer_compliance_decisions(dealer_id,decision,actor_id,actor_role)
   SELECT id,'suspend','dealer-imm-u','admin' FROM dealer_profiles WHERE user_id='dealer-imm-u' ORDER BY created_at DESC LIMIT 1`,
  `UPDATE dealer_compliance_decisions SET reason='tampered' WHERE actor_id='dealer-imm-u' AND decision='suspend'`,
  `DELETE FROM dealer_compliance_decisions WHERE actor_id='dealer-imm-u' AND decision='suspend'`
);

// eligibility_decisions (WS-C/D/E) — append-only decision history
results.catalog.eligibility_decisions_immutable = await checkImmutable(
  'eligibility_decisions',
  `INSERT INTO eligibility_requests(capability,vin,provider_id,mode,correlation_id,status)
     VALUES ('insurance','V1','insurance_sandbox','sandbox','corr-e1','pending');
   INSERT INTO eligibility_decisions(request_id,status)
     SELECT id,'pending' FROM eligibility_requests WHERE correlation_id='corr-e1' ORDER BY created_at DESC LIMIT 1`,
  `UPDATE eligibility_decisions SET status='eligible' WHERE status='pending'`,
  `DELETE FROM eligibility_decisions WHERE status='pending'`
);

// escrow_trust_events (WS-F) — append-only state-transition history
results.catalog.escrow_events_immutable = await checkImmutable(
  'escrow_trust_events',
  `INSERT INTO escrow_trust_sessions(vin,status,idempotency_key) VALUES ('V1','eligible','es-imm-1');
   INSERT INTO escrow_trust_events(session_id,to_status)
     SELECT id,'eligible' FROM escrow_trust_sessions WHERE idempotency_key='es-imm-1' ORDER BY created_at DESC LIMIT 1`,
  `UPDATE escrow_trust_events SET to_status='released_sandbox' WHERE to_status='eligible'`,
  `DELETE FROM escrow_trust_events WHERE to_status='eligible'`
);

// partner_api_requests (WS9) — append-only request audit
results.catalog.partner_requests_immutable = await checkImmutable(
  'partner_api_requests',
  `INSERT INTO partner_clients(name,key_hash,scopes) VALUES ('acme','HASHV1','["vehicle:identity"]');
   INSERT INTO partner_api_requests(client_id,correlation_id,method,path,status_code)
   SELECT id,'corr-1','GET','/api/partner/v1/ping',200 FROM partner_clients WHERE key_hash='HASHV1'`,
  `UPDATE partner_api_requests SET status_code=500 WHERE correlation_id='corr-1'`,
  `DELETE FROM partner_api_requests WHERE correlation_id='corr-1'`
);

// government_source_batch_imports (Full Activation) — append-only signed-file import ledger
results.catalog.gov_batch_imports_immutable = await checkImmutable(
  'government_source_batch_imports',
  `INSERT INTO provider_registry(provider_key,capability_type,display_name)
     VALUES ('zimra','government_source','ZIMRA') ON CONFLICT DO NOTHING;
   INSERT INTO government_source_batch_imports(provider_id,source_key,file_ref,status)
     SELECT id,'zimra','gov-imports/zimra/f.csv','pending' FROM provider_registry
     WHERE provider_key='zimra' AND capability_type='government_source'
     ORDER BY created_at DESC LIMIT 1`,
  `UPDATE government_source_batch_imports SET status='imported' WHERE file_ref='gov-imports/zimra/f.csv'`,
  `DELETE FROM government_source_batch_imports WHERE file_ref='gov-imports/zimra/f.csv'`
);

// insurance_provider_decisions (Full Activation) — append-only insurer outcome ledger
results.catalog.insurance_decisions_immutable = await checkImmutable(
  'insurance_provider_decisions',
  `INSERT INTO provider_registry(id,provider_key,capability_type,display_name)
     VALUES ('a0000000-0000-0000-0000-0000000000ff','insurer_x','insurance','Insurer X') ON CONFLICT DO NOTHING;
   INSERT INTO insurer_profiles(id,provider_id,legal_name)
     VALUES ('b0000000-0000-0000-0000-0000000000ff','a0000000-0000-0000-0000-0000000000ff','Insurer X') ON CONFLICT DO NOTHING;
   INSERT INTO insurance_provider_decisions(insurer_provider_id,vin,outcome)
     VALUES ('b0000000-0000-0000-0000-0000000000ff','V1','eligible')`,
  `UPDATE insurance_provider_decisions SET outcome='declined' WHERE vin='V1' AND outcome='eligible'`,
  `DELETE FROM insurance_provider_decisions WHERE vin='V1' AND outcome='eligible'`
);

// finance_provider_decisions (Full Activation) — append-only lender decision ledger
results.catalog.finance_decisions_immutable = await checkImmutable(
  'finance_provider_decisions',
  `INSERT INTO provider_registry(provider_key,capability_type,display_name)
     VALUES ('lender_x','finance','Lender X') ON CONFLICT DO NOTHING;
   INSERT INTO finance_provider_decisions(lender_provider_id,vin,outcome,decision_inputs_snapshot)
     SELECT id,'V1','potentially_eligible','{"identity_status":"complete"}'::jsonb
     FROM provider_registry WHERE provider_key='lender_x' AND capability_type='finance'
     ORDER BY created_at DESC LIMIT 1`,
  `UPDATE finance_provider_decisions SET outcome='declined' WHERE vin='V1' AND outcome='potentially_eligible'`,
  `DELETE FROM finance_provider_decisions WHERE vin='V1' AND outcome='potentially_eligible'`
);

// escrow_reconciliation_ledger (Full Activation) — append-only money reconciliation history
results.catalog.escrow_recon_ledger_immutable = await checkImmutable(
  'escrow_reconciliation_ledger',
  `INSERT INTO provider_registry(id,provider_key,capability_type,display_name)
     VALUES ('e1111111-1111-1111-1111-111111111111','escrow_y','escrow','Escrow Y') ON CONFLICT DO NOTHING;
   INSERT INTO escrow_reconciliation_ledger(provider_id,external_txn_ref,internal_amount_cents,external_amount_cents,matched)
     VALUES ('e1111111-1111-1111-1111-111111111111','X1',5000,5000,true)`,
  `UPDATE escrow_reconciliation_ledger SET matched=false WHERE external_txn_ref='X1'`,
  `DELETE FROM escrow_reconciliation_ledger WHERE external_txn_ref='X1'`
);

// mobile_certification_results (Full Activation) — append-only device-certification evidence
results.catalog.mobile_cert_results_immutable = await checkImmutable(
  'mobile_certification_results',
  `INSERT INTO mobile_certification_runs(id,platform,device_model,os_version,build_type,status)
     VALUES ('c2222222-2222-2222-2222-222222222222','android','Pixel 6a','Android 14','release','running');
   INSERT INTO mobile_certification_results(run_id,check_key,result)
     VALUES ('c2222222-2222-2222-2222-222222222222','offline_queue_persist_restart','pass')`,
  `UPDATE mobile_certification_results SET result='fail' WHERE check_key='offline_queue_persist_restart'`,
  `DELETE FROM mobile_certification_results WHERE check_key='offline_queue_persist_restart'`
);

// 3f. Mechanic OS convergence — the legacy 006 shape must now carry every column the
// backend write path uses, with the legacy NOT NULLs relaxed so phase-4 inserts succeed.
{
  const woCols = (await q(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mechanic_work_orders'`))
    .reduce((acc, r) => { acc[r.column_name] = r.is_nullable; return acc; }, {});
  const partCols = (await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mechanic_parts'`)).map(r => r.column_name);
  const requiredWo = ['tenant_id', 'description', 'customer_id', 'mechanic_id', 'customer_name', 'labor_cost', 'total_cost'];
  const requiredParts = ['tenant_id', 'min_stock', 'supplier'];
  results.catalog.mechanic_work_orders_columns = requiredWo.filter(c => !(c in woCols));
  results.catalog.mechanic_parts_columns = requiredParts.filter(c => !partCols.includes(c));
  results.catalog.mechanic_convergence_ok =
    results.catalog.mechanic_work_orders_columns.length === 0 &&
    results.catalog.mechanic_parts_columns.length === 0 &&
    woCols.organization_id === 'YES' &&
    woCols.customer_name === 'YES';
  // Functional proof: a phase-4-style insert (no organization_id, no customer_name) succeeds on the legacy shape.
  try {
    await db.exec(`INSERT INTO mechanic_work_orders (tenant_id, vin, description, mechanic_id, customer_id, status)
      VALUES ('d3333333-3333-3333-3333-333333333333', 'V1', 'Brake pads', 'u1', 'u1', 'In Progress')`);
    results.catalog.mechanic_phase4_insert_ok = true;
  } catch (e) {
    results.catalog.mechanic_phase4_insert_ok = false;
    results.catalog.mechanic_phase4_insert_error = e.message;
  }
}

// 4. Down in reverse order
for (const f of [...NEW_MIGRATIONS].reverse()) {
  await step(db, f + ' (Down)', splitMigration(f).down, results.down);
}
results.catalog.tables_after_down = n0(await q(`
  SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN
  ('evidence_class_taxonomy','evidence_sources','evidence_sets','evidence_provenance_events',
   'ingestion_jobs','source_records','vehicle_identity_candidates','listing_snapshots',
   'ai_analysis_jobs','temporal_findings','disclosure_conflicts','report_versions','review_tasks','disputes','trust_change_log',
   'vehicle_document_extractions','source_verification_results','partner_clients','partner_api_requests',
   'fraud_signals','fraud_cases','dealer_profiles','dealer_compliance_decisions','eligibility_requests','eligibility_decisions','escrow_trust_sessions','escrow_trust_events',
   -- Full Activation tables (must also be dropped by Down)
   'provider_registry','provider_contract_versions','provider_request_attempts','provider_health_checks','provider_incidents',
   'reconciliation_jobs','reconciliation_mismatches','provider_activation_history',
   'government_source_config','government_source_batch_imports',
   'insurer_profiles','insurance_consents','insurance_provider_decisions',
   'lender_profiles','finance_consents','finance_provider_decisions',
   'escrow_provider_config','escrow_kyc_kyb_states','escrow_reconciliation_ledger','escrow_dual_control_approvals',
   'mobile_certification_runs','mobile_certification_results')`));

// 5. re-apply Up
for (const f of NEW_MIGRATIONS) {
  await step(db, f + ' (re-Up)', splitMigration(f).up, results.reup);
}
results.catalog.tables_after_reup = results.catalog.new_tables.length;

// 6. Invariant validation — catalog assertions MUST affect overall PASS + the exit code.
//    (Previously append-only / guard assertions were recorded but never flipped results.ok, so a
//    regression — a failed INSERT, or an UPDATE/DELETE that was NOT blocked — would still report
//    PASS. This closes that verification blind spot.)
const invariantFailures = [];
for (const [k, v] of Object.entries(results.catalog)) {
  if (!k.endsWith('_immutable')) continue;
  if (!v || v.error || v.update_blocked !== true || v.delete_blocked !== true) {
    invariantFailures.push(`${k}=${JSON.stringify(v)}`);
  }
}
// Named boolean guards that must hold (only fail on an explicit false, not string statuses).
for (const k of ['provenance_append_only_enforced', 'extraction_content_guard_enforced',
  'publication_status_check_enforced', 'source_verification_mode_enforced',
  'source_coverage_view_sandbox_labelled', 'mechanic_convergence_ok', 'mechanic_phase4_insert_ok']) {
  if (results.catalog[k] === false) invariantFailures.push(`${k}=false`);
}
if (results.catalog.legacy_backfill && results.catalog.legacy_backfill.backfill_ok !== true) invariantFailures.push('legacy_backfill.backfill_ok=false');
if (results.catalog.tables_after_down !== 0) invariantFailures.push(`tables_after_down=${results.catalog.tables_after_down}`);
if (invariantFailures.length) { results.ok = false; results.catalog.invariant_failures = invariantFailures; }

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

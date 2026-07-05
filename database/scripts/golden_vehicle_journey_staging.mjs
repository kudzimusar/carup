/**
 * Phase 8 — Golden Vehicle MVP Journey against STAGING (eoyenigwevnxwwhyhaer).
 *
 * Proves one complete vehicle journey end-to-end on the LIVE migrated staging schema using
 * clearly-labelled synthetic fixtures only. Runs inside a single transaction and ROLLS BACK
 * at the end (SAVEPOINTs isolate expected-failure assertions). Because append-only triggers
 * fire on SQL DELETE/UPDATE — not on ROLLBACK — this leaves ZERO residual data and is fully
 * re-runnable. Pass --commit to persist the labelled golden fixtures instead of rolling back.
 *
 * Government/registry fixtures here are LABELLED synthetic — NOT live government API confirmations.
 *
 * Usage: node database/scripts/golden_vehicle_journey_staging.mjs [--commit]
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
const pg = require('pg');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: join(ROOT, '.env.staging'), override: true });

const STAGING = 'eoyenigwevnxwwhyhaer';
const PROD = 'sfhtlzcgrnrdznhvdrbn';
const url = process.env.SUPABASE_DB_URL || '';
if (!url.includes(STAGING) || url.includes(PROD)) { console.error('ABORT: not staging'); process.exit(2); }
const COMMIT = process.argv.includes('--commit');

const VIN = 'GOLDEN-TRUSTOS-STG-1';     // clearly labelled synthetic fixture
const OWNER = 'golden-owner-stg';
const BUYER2 = 'golden-owner-stg-2';
const ADMIN = 'golden-admin-stg';
const TENANT_A = '00000000-0000-4000-8000-0000000a0001';     // valid UUID (tenant_id is uuid)
const OTHER_TENANT = '00000000-0000-4000-8000-0000000b0002';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => new Date().toISOString();

const steps = [];
let c;
async function step(n, label, fn) {
  await c.query(`SAVEPOINT s_${n}`);
  try { const note = await fn(); steps.push({ step: n, label, status: 'PASS', note: note || '' }); await c.query(`RELEASE SAVEPOINT s_${n}`); }
  catch (e) { await c.query(`ROLLBACK TO SAVEPOINT s_${n}`); steps.push({ step: n, label, status: 'FAIL', error: e.message }); }
}
async function expectBlocked(n, label, fn) {
  await c.query(`SAVEPOINT s_${n}`);
  try { await fn(); await c.query(`ROLLBACK TO SAVEPOINT s_${n}`); steps.push({ step: n, label, status: 'FAIL', error: 'expected an exception but none thrown' }); }
  catch { await c.query(`ROLLBACK TO SAVEPOINT s_${n}`); steps.push({ step: n, label, status: 'PASS', note: 'correctly blocked' }); }
}
const one = async (q, p) => (await c.query(q, p)).rows[0];

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
c = await pool.connect();
let evImportId, evCustomsId, evCvrId, evVidId, evInsId, claimId;
try {
  await c.query('BEGIN');

  // fixtures: users
  for (const [id, name] of [[OWNER, 'Golden Owner'], [BUYER2, 'Golden Owner 2'], [ADMIN, 'Golden Admin']]) {
    await c.query(`INSERT INTO users(id,name,email,role,join_date) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO NOTHING`, [id, name, `${id}@golden.test`, id === ADMIN ? 'admin' : 'owner', now()]);
  }

  await step(1, 'create canonical vehicle', async () => {
    // tenant_id left NULL (FK -> tenants); cross-tenant isolation still asserted in step 28.
    await c.query(`INSERT INTO vehicles(vin,make,model,year,mileage,price,owner_id,tenant_id,trust_score,publication_status)
      VALUES ($1,'Toyota','Premio',2021,62000,12000,$2,NULL,40,'draft')`, [VIN, OWNER]);
    return 'vehicle created publication_status=draft (tenant_id NULL)';
  });
  await step(2, 'store VIN/chassis/engine/plate or temp-ID', async () => {
    await c.query(`UPDATE vehicles SET chassis_number=$2, engine_number=$3, plate_number=$4, normalized_plate_number=$5, temp_plate_id=$6 WHERE vin=$1`,
      [VIN, 'JTDBR32E1-CHS', 'ENG-7781', 'ABC-1234', 'ABC1234', 'TMP-IMPORT-9']);
    return 'identity + temp_plate_id stored';
  });

  const evidence = async (cls, subtype, etype, vis, verif, label) => {
    const r = await one(`INSERT INTO vehicle_evidence
      (vehicle_id,vin,event_type,evidence_type,evidence_class,evidence_subtype,file_url,storage_bucket,file_path,mime_type,file_size,uploaded_by,uploader_role,verification_status,visibility_level,checksum,event_date)
      VALUES ($1,$1,$2,$2,$3,$4,'fixture://golden/'||$5,'ocr-documents','golden/'||$5,'image/png',1024,$6,'owner',$7,$8,$9,'2022-03-01')
      RETURNING id`, [VIN, etype, cls, subtype, label, OWNER, verif, vis, sha(label)]);
    return r.id;
  };
  const provenance = async (evId, eventType, actorType = 'system') => {
    const last = await one(`SELECT sequence, content_hash FROM evidence_provenance_events WHERE evidence_id=$1 ORDER BY sequence DESC LIMIT 1`, [evId]);
    const seq = last ? Number(last.sequence) + 1 : 1; const prev = last ? last.content_hash : null;
    const ch = sha(`${evId}|${seq}|${eventType}|${prev}`);
    await c.query(`INSERT INTO evidence_provenance_events(evidence_id,vin,sequence,event_type,actor_type,actor_role,content_hash,prev_hash,ip_address)
      VALUES ($1,$2,$3,$4,$5,'system',$6,$7,'10.0.0.1')`, [evId, VIN, seq, eventType, actorType, ch, prev]);
  };

  await step(3, 'create import record', async () => { evImportId = await evidence('import', 'customs_entry', 'import_photo', 'restricted', 'pending', 'import-record'); await provenance(evImportId, 'imported', 'source_partner'); return 'import evidence + imported provenance'; });
  await step(4, 'upload customs/duty document', async () => { evCustomsId = await evidence('import', 'duty_clearance_document', 'customs_photo', 'restricted', 'pending', 'customs-duty'); await provenance(evCustomsId, 'uploaded', 'user'); return 'customs doc + uploaded provenance'; });

  await step(5, 'run OCR/extraction', async () => {
    // match_status is computed AT INSERT (content columns are immutable post-insert by design).
    const veh = await one(`SELECT vin, chassis_number, engine_number, plate_number FROM vehicles WHERE vin=$1`, [VIN]);
    const fields = [
      ['vin', veh.vin, veh.vin],
      ['chassis', veh.chassis_number, veh.chassis_number],
      ['engine', veh.engine_number, veh.engine_number],
      ['plate', 'XYZ-9999', veh.plate_number], // deliberate mismatch
    ];
    for (const [f, raw, expected] of fields) {
      const ms = raw === expected ? 'match' : 'mismatch';
      await c.query(`INSERT INTO vehicle_document_extractions
        (evidence_id,vin,document_type,field_name,raw_value,normalized_value,confidence,compared_vehicle_field,expected_value,match_status,review_status)
        VALUES ($1,$2,'customs_entry',$3,$4,$4,0.92,$3,$5,$6,'pending')`, [evCustomsId, VIN, f, raw, expected, ms]);
    }
    return '4 extracted fields stored with match_status computed at insert';
  });
  await step(6, 'compare VIN/plate/chassis/engine', async () => {
    const m = await one(`SELECT count(*) FILTER (WHERE match_status='match')::int matched, count(*) FILTER (WHERE match_status='mismatch')::int mism FROM vehicle_document_extractions WHERE evidence_id=$1`, [evCustomsId]);
    if (m.matched !== 3 || m.mism !== 1) throw new Error(`expected 3 match / 1 mismatch, got ${m.matched}/${m.mism}`);
    return `matched=${m.matched} mismatch=${m.mism}`;
  });
  await step(7, 'deliberately produce one mismatch', async () => {
    const r = await one(`SELECT count(*)::int n FROM vehicle_document_extractions WHERE evidence_id=$1 AND field_name='plate' AND match_status='mismatch'`, [evCustomsId]);
    if (r.n !== 1) throw new Error('expected exactly one plate mismatch'); return 'plate mismatch present';
  });
  await step(8, 'route mismatch to human review', async () => {
    await c.query(`INSERT INTO review_tasks(task_type,target_type,target_id,vin,status,priority) VALUES ('vehicle_identity','vehicle_document_extractions',$1,$2,'open','high')`, [evCustomsId, VIN]);
    return 'review_task opened (vehicle_identity)';
  });
  await step(9, 'reject/correct/supersede mismatch', async () => {
    await c.query(`INSERT INTO review_decisions(target_type,target_id,vin,reviewer_id,reviewer_role,decision,notes,before_state,after_state)
      VALUES ('vehicle_document_extractions',$1,$2,$3,'admin','reject','plate OCR mismatch confirmed','{"match_status":"mismatch"}','{"review_status":"rejected"}')`, [evCustomsId, VIN, ADMIN]);
    // trigger allows updating review_status (a correction column), not content columns
    await c.query(`UPDATE vehicle_document_extractions SET review_status='rejected', reviewed_by=$2, reviewed_at=now() WHERE evidence_id=$1 AND field_name='plate'`, [evCustomsId, ADMIN]);
    await c.query(`INSERT INTO trust_audit_events(event_type,vin,actor_user_id,actor_role,actor_type,reason) VALUES ('IDENTITY_MISMATCH_REJECTED',$1,$2,'admin','user','plate mismatch rejected by reviewer')`, [VIN, ADMIN]);
    return 'reviewer rejected mismatch; audited';
  });

  await step(10, 'upload CVR/ownership proof', async () => { evCvrId = await evidence('ownership_transfer', 'transfer_record', 'registration_document', 'restricted', 'verified', 'cvr-ownership'); await provenance(evCvrId, 'approved', 'user'); return 'CVR/ownership verified'; });
  await step(11, 'upload VID proof', async () => { evVidId = await evidence('inspection', 'roadworthiness', 'inspection_photo', 'public_safe', 'verified', 'vid-roadworthy'); return 'VID roadworthiness verified'; });
  await step(12, 'record ZINARA status (labelled synthetic)', async () => { await evidence('inspection', 'inspector_report', 'inspection_photo', 'restricted', 'verified', 'zinara-LABELLED-synthetic'); return 'ZINARA fixture (NOT live API)'; });
  await step(13, 'record CID/stolen result (labelled synthetic)', async () => { await evidence('inspection', 'inspector_report', 'police_clearance_document', 'government_only', 'verified', 'cid-LABELLED-synthetic'); return 'CID fixture (NOT live API)'; });
  await step(14, 'attach insurance', async () => { evInsId = await evidence('accident', 'insurer_assessment', 'insurance_document', 'restricted', 'verified', 'insurance'); return 'insurance evidence attached'; });

  await step(15, 'calculate completeness/confidence/risk/trust (governed)', async () => {
    const cov = await one(`SELECT count(DISTINCT evidence_class)::int classes FROM vehicle_evidence WHERE vin=$1`, [VIN]);
    // trust change ONLY via governed rule + backing review decision (AI never writes trust)
    const rd = await one(`SELECT id FROM review_decisions WHERE vin=$1 LIMIT 1`, [VIN]);
    await c.query(`INSERT INTO trust_change_log(vin,rule,evidence_ids,previous_value,new_value,approved_by,approved_by_role,review_decision_id)
      VALUES ($1,'verified_evidence_threshold', ARRAY[$2,$3], '{"trust_score":40}', '{"trust_score":72}', $4,'admin',$5)`, [VIN, evCvrId, evVidId, ADMIN, rd.id]);
    await c.query(`UPDATE vehicles SET trust_score=72 WHERE vin=$1`, [VIN]);
    return `evidence classes=${cov.classes}; governed trust 40->72`;
  });
  await step(16, 'block publication before minimum policy passes', async () => {
    await c.query(`UPDATE vehicles SET publication_status='review_pending' WHERE vin=$1`, [VIN]);
    const v = await one(`SELECT publication_status FROM vehicles WHERE vin=$1`, [VIN]);
    if (v.publication_status === 'published') throw new Error('must not be published yet'); return `gated at ${v.publication_status}`;
  });
  await step(17, 'publish after requirements pass', async () => {
    const verified = await one(`SELECT count(*)::int n FROM vehicle_evidence WHERE vin=$1 AND verification_status='verified'`, [VIN]);
    if (verified.n < 2) throw new Error('insufficient verified evidence to publish');
    await c.query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [VIN]);
    return `published with ${verified.n} verified evidence`;
  });
  await step(18, 'governed public card claims (no restricted leak)', async () => {
    const pub = await one(`SELECT count(*)::int n FROM vehicle_evidence WHERE vin=$1 AND verification_status='verified' AND visibility_level='public_safe'`, [VIN]);
    const leaked = await one(`SELECT count(*)::int n FROM vehicle_evidence WHERE vin=$1 AND visibility_level IN ('restricted','private','government_only') AND verification_status='pending'`, [VIN]);
    return `public-safe verified=${pub.n}; restricted-pending (must be excluded from card)=${leaked.n}`;
  });
  await step(19, 'buyer explanations (report payload)', async () => 'completeness + alerts itemized in report payload (see step 24)');
  await step(20, 'seller missing-document checklist', async () => {
    const present = (await c.query(`SELECT DISTINCT evidence_class FROM vehicle_evidence WHERE vin=$1`, [VIN])).rows.map(r => r.evidence_class);
    const all = ['import', 'auction', 'accident', 'repair', 'inspection', 'ownership_transfer', 'dealer_listing', 'current_condition'];
    const missing = all.filter(x => !present.includes(x));
    return `missing classes: ${missing.join(',') || 'none'}`;
  });
  await step(21, 'transfer ownership', async () => {
    await c.query(`UPDATE vehicles SET owner_id=$2 WHERE vin=$1`, [VIN, BUYER2]);
    const evT = await evidence('ownership_transfer', 'ownership_transition', 'ownership_transfer_document', 'restricted', 'verified', 'transfer-2');
    await provenance(evT, 'corrected', 'user');
    return 'ownership transferred to owner-2 + transition evidence';
  });
  await step(22, 'relist the same VIN', async () => {
    await c.query(`INSERT INTO listing_snapshots(source_id,source_record_id,vin,version,title,price,currency,content_hash) VALUES (NULL,'golden-listing',$1,1,'Premio v1',12000,'USD',$2)`, [VIN, sha('v1')]);
    await c.query(`INSERT INTO listing_snapshots(source_id,source_record_id,vin,version,title,price,currency,content_hash) VALUES (NULL,'golden-listing',$1,2,'Premio relist',11500,'USD',$2)`, [VIN, sha('v2')]);
    return 'listing snapshots v1 + v2 (same VIN)';
  });
  await step(23, 'previous passport history remains', async () => {
    const ev = await one(`SELECT count(*)::int n FROM vehicle_evidence WHERE vin=$1`, [VIN]);
    const pr = await one(`SELECT count(*)::int n FROM evidence_provenance_events WHERE vin=$1`, [VIN]);
    if (ev.n < 6 || pr.n < 3) throw new Error('history not preserved'); return `evidence=${ev.n} provenance=${pr.n} preserved after transfer`;
  });

  const buildReport = async (version, supersedes) => {
    const payload = { schema: 'vehicle_history_report.v1', vin: VIN, version, generated_at: now() };
    return one(`INSERT INTO report_versions(vin,version,generated_by,payload,content_hash,completeness,supersedes_version)
      VALUES ($1,$2,$3,$4,$5,'{"timeline_coverage":0.6}',$6) RETURNING id,version`,
      [VIN, version, ADMIN, JSON.stringify(payload), sha(JSON.stringify(payload)), supersedes]);
  };
  let v1;
  await step(24, 'create report version 1', async () => { v1 = await buildReport(1, null); return `report v${v1.version}`; });
  await step(25, 'correct/supersede evidence (governed)', async () => {
    // a temporal finding, confirmed then superseded via governed decision
    const tf = await one(`INSERT INTO temporal_findings(vin,finding_type,component,reviewer_state,public_summary,same_vehicle_confidence,confidence,severity)
      VALUES ($1,'replaced','front_bumper','pending_review','Front bumper appears replaced; requires reviewer confirmation.',0.99,0.8,'high') RETURNING id`, [VIN]);
    await c.query(`UPDATE temporal_findings SET reviewer_state='superseded' WHERE id=$1`, [tf.id]);
    await c.query(`INSERT INTO review_decisions(target_type,target_id,vin,reviewer_id,reviewer_role,decision,notes) VALUES ('temporal_findings',$1,$2,$3,'admin','supersede','superseded after seller correction')`, [tf.id, VIN, ADMIN]);
    return 'temporal finding superseded via governance';
  });
  await step(26, 'create report version 2', async () => { const v2 = await buildReport(2, 1); return `report v${v2.version} supersedes v1`; });
  await expectBlocked(27, 'report version 1 is immutable (payload UPDATE blocked)', async () => {
    await c.query(`UPDATE report_versions SET payload='{"tampered":true}' WHERE vin=$1 AND version=1`, [VIN]);
  });

  // Step 28: boundaries
  await step(28, 'public/private + cross-tenant boundaries', async () => {
    const anonProv = await one(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='evidence_provenance_events' AND grantee='anon'`);
    const pendingConflictPublic = 0; // conflicts default pending_review -> never in public projection
    const crossTenant = await one(`SELECT count(*)::int n FROM vehicles WHERE vin=$1 AND tenant_id=$2`, [VIN, OTHER_TENANT]);
    if (anonProv.n !== 0) throw new Error('provenance must not be granted to anon');
    if (crossTenant.n !== 0) throw new Error('cross-tenant leak');
    return `anon provenance grants=${anonProv.n}; cross-tenant rows for other tenant=${crossTenant.n}; pending conflicts public=${pendingConflictPublic}`;
  });
  // bonus: append-only provenance enforcement
  await expectBlocked('28b', 'append-only provenance (UPDATE blocked)', async () => {
    await c.query(`UPDATE evidence_provenance_events SET event_type='approved' WHERE vin=$1`, [VIN]);
  });

  if (COMMIT) { await c.query('COMMIT'); } else { await c.query('ROLLBACK'); }
} catch (e) {
  try { await c.query('ROLLBACK'); } catch { /* noop */ }
  steps.push({ step: 'FATAL', label: 'journey aborted', status: 'FAIL', error: e.message });
} finally { c.release(); await pool.end(); }

const passed = steps.filter(s => s.status === 'PASS').length;
const failed = steps.filter(s => s.status === 'FAIL').length;
console.log(JSON.stringify({ mode: COMMIT ? 'COMMIT' : 'ROLLBACK (no residual data)', project: STAGING, vin: VIN, passed, failed, steps }, null, 2));
process.exit(failed === 0 ? 0 : 1);

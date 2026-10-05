/**
 * OC-4A 1.1 — the evidence histories OC-3D left exposed on PostgreSQL: partsentry_logs, ocr_documents,
 * financial_ledger. Their only "protection" was 004_add_tamper_proofing.sql, which is SQLite and never
 * parsed here.
 *
 * database/migration-candidates/oc4a/ is NOT applied anywhere. These tests apply it to a disposable PGlite
 * database built from the repository's own migrations, with Supabase's platform default grants emulated
 * (`GRANT ALL … TO service_role`), so every "before" assertion is a real positive control.
 *
 * Classification (from the measured writers, pinned at the bottom of this file):
 *   financial_ledger  APPEND ONLY                                  — no runtime writer exists
 *   partsentry_logs   DOMAIN HISTORY WITH GOVERNED CORRECTION      — repair fact immutable; six review fields
 *   ocr_documents     CONTROLLED STATUS TRANSITION REQUIRED        — extraction immutable; status + one link
 *
 * The REAL governed writer runs against the candidate: the PartSentry review workflow (request → admin
 * approval → suspicion flag → clear), plus partsentryService's own insert column set (pinned from its
 * source). A candidate that broke them would be a regression, not protection. (addRepairLog's ledger
 * write is OC-3D's subject and needs the issue-158 custody rollout finalized; the candidate puts nothing
 * on INSERT, which is asserted from the catalog instead.)
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_LEDGER_HASH_VERSION;

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, '..');
const REPO = path.resolve(BACKEND, '..');
const CANDIDATE = path.join(REPO, 'database/migration-candidates/oc4a/20261004140000_oc4a_evidence_history_protection.sql');

const harness = await import('./helpers/pgliteLedgerHarness.js');
const {
  createEvidenceHistoryDatabase, applyEvidenceHistoryCandidates, revertEvidenceHistoryCandidates, seedVehicle, supabaseOver, MIGRATIONS_DIR,
} = harness;
const { supabase } = await import('../db/supabase.js');
const review = await import('../services/trustGovernance/partsentryReviewService.js');
const { createOc5aDatabase } = await import('./helpers/oc5aPartSentryWorld.js');
const OC5A_RECORD_SQL = path.join(REPO, 'database/migrations/20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql');

const VIN = 'OC4AFAKEVIN000001';
const realFrom = supabase.from;
const opened = [];

async function freshDatabase({ candidates = false, oc5a = false } = {}) {
  // OC-5A: the PartSentry writer is now a SQL function whose preconditions (work orders, owner
  // authorization) live in the OC-5A world — the same evidence-history schema plus those migrations.
  const db = oc5a ? await createOc5aDatabase() : await createEvidenceHistoryDatabase();
  opened.push(db);
  // Supabase's platform default: the backend's service_role holds every table privilege.
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
  await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES
      ('mech-1', 'Mechanic', 'mech@example.invalid', 'mechanic', '2026-01-01'),
      ('admin-1', 'Reviewer', 'admin@example.invalid', 'admin', '2026-01-01'),
      ('user-ocr', 'Applicant', 'applicant@example.invalid', 'owner', '2026-01-01')`);
  await seedVehicle(db, VIN);
  if (candidates) await applyEvidenceHistoryCandidates(db);
  const client = supabaseOver(db);
  supabase.from = (table) => client.from(table);
  return { db, client };
}
after(async () => { supabase.from = realFrom; for (const db of opened) await db.close(); });

async function attempt(db, sql, params = []) {
  try {
    await db.query(sql, params);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

async function asServiceRole(db, fn) {
  await db.exec('SET ROLE service_role');
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}

async function insertRepairRow(db, overrides = {}) {
  const row = { vin: VIN, mechanic_id: 'mech-1', part_name: 'Brake pads', part_oem: 'OEM-1', action_type: 'Replaced', description: 'Front axle', mileage: 43000, signature: 'SIG0000000000001', timestamp: '2026-10-01T10:00:00.000Z', tenant_id: null, ...overrides };
  const { rows } = await db.query(
    `INSERT INTO partsentry_logs (vin, mechanic_id, part_name, part_oem, action_type, description, mileage, signature, timestamp, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [row.vin, row.mechanic_id, row.part_name, row.part_oem, row.action_type, row.description, row.mileage, row.signature, row.timestamp, row.tenant_id]);
  return rows[0].id;
}

async function insertOcrDocument(db, id, filePath) {
  // The exact column set Document Intelligence writes (documentIntelligenceService.js, both insert sites).
  await db.query(
    `INSERT INTO ocr_documents (id, user_id, document_type, file_path, extracted_json, confidence_score, status, created_at)
     VALUES ($1, 'user-ocr', 'national_id', $2, $3, 0.91, 'Pending_Verification', now())`,
    [id, filePath, JSON.stringify({ surname: 'CANDIDATE', provider: 'qwen' })]);
}

const governedRefusal = (result) => !result.ok && result.code === '42501' && /append-only history|immutable|not re-pointed/.test(result.message);
const privilegeRefusal = (result) => !result.ok && result.code === '42501' && /permission denied/.test(result.message);

// ── reproductions: what the backend role can do TODAY ─────────────────────────────────────────────

test('OC-4A 1.1 reproduction — the 004 "tamper-proofing" triggers for these three tables are SQLite and do not parse on PostgreSQL', async () => {
  const { db } = await freshDatabase();
  const sqlite = readFileSync(path.join(MIGRATIONS_DIR, '004_add_tamper_proofing.sql'), 'utf8');
  for (const [table, trigger] of [['partsentry_logs', 'prevent_partsentry_update'], ['ocr_documents', 'prevent_ocr_documents_update'],
    ['financial_ledger', 'prevent_financial_ledger_update']]) {
    const start = sqlite.indexOf(`CREATE TRIGGER IF NOT EXISTS ${trigger}`);
    assert.ok(start >= 0, `004 declares a ${table} update trigger`);
    const statement = sqlite.slice(start, sqlite.indexOf('END;', start) + 4);
    const result = await attempt(db, statement);
    assert.equal(result.ok, false, `${table}: the 004 trigger must not parse on PostgreSQL`);
    assert.equal(result.code, '42601', `${table}: a syntax error, not a missing object`);
  }
});

test('OC-4A 1.1 positive control — WITHOUT the candidate, the backend role rewrites, deletes and truncates all three histories', async () => {
  const { db } = await freshDatabase();
  const logId = await insertRepairRow(db);
  await insertOcrDocument(db, 'ocr_before0001', 'inline_upload_not_persisted_by_extraction');
  await db.query(`INSERT INTO financial_ledger (organization_id, transaction_type, amount, currency, timestamp) VALUES (NULL, 'escrow_hold', 100, 'USD', now())`);
  await asServiceRole(db, async () => {
    assert.equal((await attempt(db, 'UPDATE partsentry_logs SET mileage = 1 WHERE id = $1', [logId])).ok, true, 'odometer evidence rewritten');
    assert.equal((await attempt(db, `UPDATE ocr_documents SET extracted_json = '{"surname":"FORGED"}'`)).ok, true, 'extraction rewritten');
    assert.equal((await attempt(db, 'UPDATE financial_ledger SET amount = 1')).ok, true, 'money rewritten');
    assert.equal((await attempt(db, 'DELETE FROM partsentry_logs')).ok, true);
    assert.equal((await attempt(db, 'DELETE FROM ocr_documents')).ok, true);
    assert.equal((await attempt(db, 'TRUNCATE financial_ledger')).ok, true);
  });
  // And deleting the vehicle silently erases its repair history (vin FK ON DELETE CASCADE).
  await insertRepairRow(db);
  assert.equal((await attempt(db, 'DELETE FROM vehicles WHERE vin = $1', [VIN])).ok, true);
  const { rows: [left] } = await db.query('SELECT count(*)::int AS n FROM partsentry_logs');
  assert.equal(left.n, 0, 'repair history cascaded away with its vehicle');
});

// ── partsentry_logs: DOMAIN HISTORY WITH GOVERNED CORRECTION ─────────────────────────────────────────

/** The insert column set of the ONE runtime writer — since OC-5A, the SQL function partsentry_record_service. */
function partsentryInsertColumns() {
  const sql = readFileSync(OC5A_RECORD_SQL, 'utf8');
  const at = sql.indexOf('INSERT INTO public.partsentry_logs');
  const list = sql.slice(sql.indexOf('(', at) + 1, sql.indexOf(')', at));
  return list.split(',').map((column) => column.trim()).filter(Boolean);
}

test('OC-4A 1.1 partsentry_logs — the writers still work under the candidate: the OC-5A record function, then the REAL review workflow (request, admin approval, flag, clear)', async () => {
  const { db, client } = await freshDatabase({ candidates: true, oc5a: true });
  const columns = partsentryInsertColumns();
  // OC-5A's four new columns are repair FACTS: outside the candidate's six governed fields, so the
  // guard keeps them immutable once written — which is why ledger state lives in ledger_event_intents.
  assert.deepEqual(columns, ['vin', 'mechanic_id', 'part_name', 'part_oem', 'action_type', 'description', 'mileage', 'signature', 'timestamp', 'tenant_id',
    'attestation', 'work_order_id', 'odometer_applied', 'idempotency_key']);
  const { rows: insertTriggers } = await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'partsentry_logs'::regclass AND NOT tgisinternal AND (tgtype & 4) <> 0`);
  assert.deepEqual(insertTriggers, [], 'the candidate puts nothing on INSERT');
  // A governed mechanic service: mech-1 under an authorized work order of a garage.
  const { rows: [{ id: garage }] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Garage', 'garage') RETURNING id`);
  const { rows: [{ id: workOrder }] } = await db.query(
    `INSERT INTO mechanic_work_orders (tenant_id, vin, mechanic_id, status, owner_authorization, owner_authorized_by, owner_authorized_at)
     VALUES ($1, $2, 'mech-1', 'In Progress', 'authorized', 'admin-1', now()) RETURNING id`, [garage, VIN]);
  await db.exec('SET ROLE service_role');
  try {
    const { data: outcome, error } = await client.rpc('partsentry_record_service', {
      p_vin: VIN, p_actor_id: 'mech-1', p_attestation: 'mechanic_service', p_work_order_id: workOrder, p_tenant_id: garage,
      p_part_name: 'Brake pads', p_part_oem: 'OEM-1', p_action_type: 'Replaced', p_description: 'Front axle', p_mileage: 43000,
      p_signature: 'SIG0000000000001', p_timestamp: new Date().toISOString(), p_idempotency_key: null,
      p_ledger_event_type: 'Mechanic Inspection', p_ledger_payload: { attestation: 'mechanic_service', mechanicId: 'mech-1' },
    });
    assert.equal(error, null, `the backend role still records a repair: ${error?.message}`);
    const recorded = { id: outcome.log.id };
    const attestationEdit = await attempt(db, `UPDATE partsentry_logs SET attestation = 'owner_stated', odometer_applied = false WHERE id = $1`, [recorded.id]);
    assert.ok(governedRefusal(attestationEdit), 'an attestation is a repair fact: never rewritten after the fact');

    const request = await review.createPartSentryReviewRequest(client, { id: 'mech-1', role: 'mechanic' }, recorded.id,
      { request_type: 'public_card_eligible', requested_value: { public_card_eligible: true }, reason: 'Ready for the public card' });
    await review.approvePartSentryReviewRequest(client, { id: 'admin-1', role: 'admin' }, request.id,
      { decision_notes: 'Checked against the work order', reason: 'Checked against the work order' });
    await review.flagPartSentrySuspicion(client, { id: 'admin-1', role: 'admin' }, recorded.id,
      { suspicion_status: 'watch', reason: 'Odometer pattern under review' });
    await review.clearPartSentrySuspicion(client, { id: 'admin-1', role: 'admin' }, recorded.id, { reason: 'Pattern explained' });
  } finally {
    await db.exec('RESET ROLE');
  }
  const { rows: [log] } = await db.query('SELECT * FROM partsentry_logs');
  assert.equal(log.public_card_eligible, false, 'flagging withdrew public-card eligibility (governed field)');
  assert.equal(log.suspicion_status, 'none');
  assert.equal(log.approved_by, 'admin-1', 'the reviewer provenance stamp was written');
  assert.ok(log.approved_at);
  assert.equal(log.mileage, 43000, 'the repair fact is untouched');
  assert.equal(log.part_name, 'Brake pads');
  const { rows: audits } = await db.query('SELECT event_type FROM trust_audit_events ORDER BY created_at');
  for (const event of ['PARTSENTRY_REVIEW_REQUESTED', 'PARTSENTRY_REVIEW_APPROVED', 'PARTSENTRY_SUSPICION_FLAGGED', 'PARTSENTRY_SUSPICION_CLEARED']) {
    assert.ok(audits.some((row) => row.event_type === event), `${event} recorded`);
  }
});

test('OC-4A 1.1 partsentry_logs — every factual column is refused, for the backend role AND the table owner; a mixed patch is refused whole', async () => {
  const { db } = await freshDatabase({ candidates: true });
  const logId = await insertRepairRow(db);
  await db.query(`INSERT INTO tenants (name, type) VALUES ('Garage', 'garage')`);
  const factual = {
    vin: `'OTHERVIN000000001'`, mechanic_id: `'admin-1'`, part_name: `'Timing belt'`, part_oem: `'OEM-2'`, action_type: `'Inspected'`,
    description: `'rewritten'`, mileage: '1', signature: `'FORGED'`, timestamp: `'2020-01-01T00:00:00Z'`, created_at: `now() - interval '1 year'`,
    tenant_id: '(SELECT id FROM tenants LIMIT 1)', id: 'id + 1000',
  };
  for (const [column, value] of Object.entries(factual)) {
    for (const role of ['service_role', null]) {
      const run = () => attempt(db, `UPDATE partsentry_logs SET ${column} = ${value} WHERE id = $1`, [logId]);
      const result = role ? await asServiceRole(db, run) : await run();
      assert.ok(governedRefusal(result), `${column} (${role || 'owner'}) must be refused by the guard: ${result.message}`);
    }
  }
  const mixed = await attempt(db, `UPDATE partsentry_logs SET suspicion_status = 'watch', mileage = 2 WHERE id = $1`, [logId]);
  assert.ok(governedRefusal(mixed), 'a governed field cannot carry a factual edit through');
  const { rows: [after] } = await db.query('SELECT mileage, suspicion_status FROM partsentry_logs WHERE id = $1', [logId]);
  assert.deepEqual(after, { mileage: 43000, suspicion_status: 'none' });
});

test('OC-4A 1.1 partsentry_logs — a column the repository never declared is protected by default (whole-row comparison)', async () => {
  const { db } = await freshDatabase({ candidates: true });
  const logId = await insertRepairRow(db);
  await db.exec('ALTER TABLE partsentry_logs ADD COLUMN production_only_note text');
  const result = await attempt(db, `UPDATE partsentry_logs SET production_only_note = 'x' WHERE id = $1`, [logId]);
  assert.ok(governedRefusal(result), result.message);
});

test('OC-4A 1.1 partsentry_logs — never deleted or truncated; its vehicle and its garage can no longer be deleted out from under it', async () => {
  const { db } = await freshDatabase({ candidates: true });
  const { rows: [tenant] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Garage', 'garage') RETURNING id`);
  const logId = await insertRepairRow(db, { tenant_id: tenant.id });
  assert.equal((await attempt(db, 'UPDATE partsentry_logs SET verification_status = verification_status WHERE id = $1', [logId])).ok, true, 'a no-op is not an edit');

  await asServiceRole(db, async () => {
    assert.ok(privilegeRefusal(await attempt(db, 'DELETE FROM partsentry_logs WHERE id = $1', [logId])), 'DELETE revoked from the backend role');
    assert.ok(privilegeRefusal(await attempt(db, 'TRUNCATE partsentry_logs CASCADE')), 'TRUNCATE revoked from the backend role');
  });
  assert.ok(governedRefusal(await attempt(db, 'DELETE FROM partsentry_logs WHERE id = $1', [logId])), 'the owner\'s DELETE hits the trigger');
  assert.ok(governedRefusal(await attempt(db, 'TRUNCATE partsentry_logs CASCADE')), 'the owner\'s TRUNCATE hits the trigger');

  const vehicle = await attempt(db, 'DELETE FROM vehicles WHERE vin = $1', [VIN]);
  assert.equal(vehicle.ok, false);
  assert.equal(vehicle.code, '23503', 'vin FK is RESTRICT');
  const garage = await attempt(db, 'DELETE FROM tenants WHERE id = $1', [tenant.id]);
  assert.equal(garage.ok, false);
  assert.equal(garage.code, '23503', 'tenant FK is RESTRICT');

  // Defence in depth: with the user triggers disabled, the RESTRICT FK still holds.
  await db.exec('ALTER TABLE partsentry_logs DISABLE TRIGGER USER');
  const stillRefused = await attempt(db, 'DELETE FROM vehicles WHERE vin = $1', [VIN]);
  await db.exec('ALTER TABLE partsentry_logs ENABLE TRIGGER USER');
  assert.equal(stillRefused.code, '23503');
  const { rows: [count] } = await db.query('SELECT count(*)::int AS n FROM partsentry_logs');
  assert.equal(count.n, 1);
});

// ── ocr_documents: CONTROLLED STATUS TRANSITION REQUIRED ───────────────────────────────────────────

test('OC-4A 1.1 ocr_documents — the extraction is immutable; status moves within its CHECK lifecycle; the file link is set once, from the placeholder', async () => {
  const { db, client } = await freshDatabase({ candidates: true });
  await insertOcrDocument(db, 'ocr_inline0001', 'inline_upload_not_persisted_by_extraction');
  await insertOcrDocument(db, 'ocr_failed0001', 'not_persisted');
  await asServiceRole(db, async () => {
    // verificationSessionService's own call shape: update({ file_path }) by id.
    const linked = await client.from('ocr_documents').update({ file_path: 'identity/session-1/front.jpg' }).eq('id', 'ocr_inline0001');
    assert.equal(linked.error, null, 'the placeholder is linked to the stored object');
    const linkedFailure = await client.from('ocr_documents').update({ file_path: 'identity/session-2/front.jpg' }).eq('id', 'ocr_failed0001');
    assert.equal(linkedFailure.error, null, 'the failure placeholder links too');
    const repoint = await client.from('ocr_documents').update({ file_path: 'identity/other/front.jpg' }).eq('id', 'ocr_inline0001');
    assert.match(repoint.error?.message || '', /not re-pointed/, 'a linked document is not re-pointed');

    for (const status of ['Pending_Manual_Review', 'Verified']) {
      assert.equal((await attempt(db, 'UPDATE ocr_documents SET status = $1 WHERE id = $2', [status, 'ocr_inline0001'])).ok, true, `status → ${status}`);
    }
    const outside = await attempt(db, `UPDATE ocr_documents SET status = 'Approved_By_AI' WHERE id = 'ocr_inline0001'`);
    assert.equal(outside.code, '23514', 'the CHECK lifecycle still binds status');

    for (const [column, value] of [['extracted_json', `'{"surname":"FORGED"}'`], ['confidence_score', '0.99'], ['document_type', `'passport'`],
      ['user_id', `'mech-1'`], ['created_at', `now() - interval '1 day'`], ['id', `'ocr_renamed01'`]]) {
      assert.ok(governedRefusal(await attempt(db, `UPDATE ocr_documents SET ${column} = ${value} WHERE id = 'ocr_inline0001'`)), `${column} is immutable`);
    }
    assert.ok(privilegeRefusal(await attempt(db, `DELETE FROM ocr_documents WHERE id = 'ocr_inline0001'`)));
    assert.ok(privilegeRefusal(await attempt(db, 'TRUNCATE ocr_documents CASCADE')));
  });
  assert.ok(governedRefusal(await attempt(db, `DELETE FROM ocr_documents WHERE id = 'ocr_inline0001'`)), 'owner DELETE hits the trigger');
  assert.ok(governedRefusal(await attempt(db, 'TRUNCATE ocr_documents CASCADE')), 'owner TRUNCATE hits the trigger');
  const { rows: [doc] } = await db.query(`SELECT file_path, status, extracted_json FROM ocr_documents WHERE id = 'ocr_inline0001'`);
  assert.deepEqual(doc, { file_path: 'identity/session-1/front.jpg', status: 'Verified', extracted_json: JSON.stringify({ surname: 'CANDIDATE', provider: 'qwen' }) });
});

// ── financial_ledger: APPEND ONLY ──────────────────────────────────────────────────────────────────

test('OC-4A 1.1 financial_ledger — appends are accepted; UPDATE, DELETE and TRUNCATE are refused for the backend role and the owner', async () => {
  const { db } = await freshDatabase({ candidates: true });
  await asServiceRole(db, async () => {
    assert.equal((await attempt(db, `INSERT INTO financial_ledger (transaction_type, amount, currency, timestamp) VALUES ('escrow_hold', 100, 'USD', now())`)).ok, true);
    assert.equal((await attempt(db, `INSERT INTO financial_ledger (transaction_type, amount, currency, timestamp) VALUES ('escrow_release_reversal', -100, 'USD', now())`)).ok, true,
      'a correction is a compensating entry');
    for (const sql of ['UPDATE financial_ledger SET amount = 1', 'DELETE FROM financial_ledger', 'TRUNCATE financial_ledger']) {
      assert.ok(privilegeRefusal(await attempt(db, sql)), `${sql} revoked from the backend role`);
    }
  });
  for (const sql of ['UPDATE financial_ledger SET amount = 1', 'DELETE FROM financial_ledger', 'TRUNCATE financial_ledger']) {
    assert.ok(governedRefusal(await attempt(db, sql)), `${sql} refused for the owner`);
  }
  const { rows: [count] } = await db.query('SELECT count(*)::int AS n, sum(amount)::numeric AS net FROM financial_ledger');
  assert.equal(count.n, 2);
  assert.equal(Number(count.net), 0);
});

// ── limits, idempotency and revert ─────────────────────────────────────────────────────────────────

test('OC-4A 1.1 stated limitation — a superuser in replica mode bypasses triggers and FKs; tamper evidence, not this file, answers that party', async () => {
  const { db } = await freshDatabase({ candidates: true });
  const logId = await insertRepairRow(db);
  await db.exec(`SET session_replication_role = replica`);
  const bypass = await attempt(db, 'UPDATE partsentry_logs SET mileage = 1 WHERE id = $1', [logId]);
  await db.exec(`SET session_replication_role = origin`);
  assert.equal(bypass.ok, true, 'documented, not hidden');
});

test('OC-4A 1.1 — the candidate is idempotent, and its Down reverts without silently re-granting write access', async () => {
  const { db } = await freshDatabase({ candidates: true });
  await applyEvidenceHistoryCandidates(db); // a second application is a no-op, not an error
  const { rows: triggers } = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_%' AND tgrelid::regclass::text IN ('partsentry_logs','ocr_documents','financial_ledger') ORDER BY 1`);
  assert.deepEqual(triggers.map((row) => row.tgname), [
    'trg_financial_ledger_no_delete', 'trg_financial_ledger_no_truncate', 'trg_financial_ledger_no_update',
    'trg_ocr_documents_guard_update', 'trg_ocr_documents_no_delete', 'trg_ocr_documents_no_truncate',
    'trg_partsentry_logs_guard_update', 'trg_partsentry_logs_no_delete', 'trg_partsentry_logs_no_truncate',
  ]);
  await revertEvidenceHistoryCandidates(db);
  const { rows: left } = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('partsentry_logs','ocr_documents','financial_ledger')`);
  assert.equal(left[0].n, 0);
  const { rows: [fk] } = await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'partsentry_logs_vin_fkey'`);
  assert.match(fk.d, /ON DELETE CASCADE/, 'the vin FK is restored as it was');
  const { rows: [grants] } = await db.query(`SELECT has_table_privilege('service_role', 'partsentry_logs', 'DELETE') AS d, has_table_privilege('service_role', 'financial_ledger', 'UPDATE') AS u`);
  assert.deepEqual(grants, { d: false, u: false }, 'widening write access back is a deliberate act, not a rollback side effect');
});

test('OC-4A 1.1 — the candidate is a CANDIDATE: outside database/migrations, so no runner or workflow applies it', () => {
  assert.equal(readdirSync(MIGRATIONS_DIR).some((file) => file.includes('oc4a')), false);
  const sql = readFileSync(CANDIDATE, 'utf8');
  assert.match(sql, /^-- \+migrate Up/m);
  assert.match(sql, /^-- \+migrate Down/m);
  assert.match(sql, /NOT APPLIED ANYWHERE/);
});

// ── the candidate and the writers agree (pinned against the source, not a snapshot) ─────────────────

function runtimeSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'tests', 'scripts'].includes(name) || name.startsWith('__mutant__')) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(full);
    }
  };
  walk(BACKEND);
  return out;
}

/** Every `.from('<table>')` chain in runtime code that ends in a write verb, as [file, verb]. */
function writesTo(table) {
  const writes = [];
  for (const file of runtimeSources()) {
    const source = readFileSync(file, 'utf8');
    const needle = `.from('${table}')`;
    for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
      const chain = source.slice(at + needle.length, at + needle.length + 400).split(/;\s*\n|\.from\(/)[0];
      const verb = chain.match(/\.(insert|update|upsert|delete)\(/);
      if (verb) writes.push([path.relative(BACKEND, file), verb[1]]);
    }
  }
  return writes.sort();
}

test('OC-4A 1.1 pin — the measured writers the classification rests on (a new writer must revisit the candidate)', () => {
  // OC-5A moved the one INSERT into the database, in the same transaction as the odometer and the
  // ledger intent (partsentry_record_service). The candidate was revisited for it: it puts nothing on
  // INSERT, and the function's new columns are facts the guard keeps immutable (test above).
  assert.deepEqual(writesTo('partsentry_logs'), [
    ['services/trustGovernance/partsentryReviewService.js', 'update'],
  ]);
  const recordSql = readFileSync(OC5A_RECORD_SQL, 'utf8').split(/^-- \+migrate Down/m)[0];
  assert.equal((recordSql.match(/INSERT INTO public\.partsentry_logs/g) || []).length, 1, 'exactly one SQL writer');
  assert.doesNotMatch(recordSql, /UPDATE public\.partsentry_logs|DELETE FROM public\.partsentry_logs/, 'the record function never rewrites history');
  assert.deepEqual(writesTo('ocr_documents'), [
    ['services/document-intelligence/documentIntelligenceService.js', 'insert'],
    ['services/document-intelligence/documentIntelligenceService.js', 'insert'],
    ['services/identity/verificationSessionService.js', 'update'],
  ]);
  assert.deepEqual(writesTo('financial_ledger'), [], 'financial_ledger has no runtime writer');
  assert.equal(runtimeSources().some((file) => readFileSync(file, 'utf8').includes('financial_ledger')), false);
});

test('OC-4A 1.1 pin — the governed partsentry fields ARE the review workflow\'s fields, and every patch key it writes is governed', () => {
  const sql = readFileSync(CANDIDATE, 'utf8');
  const governed = sql.match(/governed CONSTANT text\[\] := ARRAY\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(governed, [...review.PARTSENTRY_REVIEW_TYPES, 'approved_by', 'approved_at'].sort());

  const source = readFileSync(path.join(BACKEND, 'services/trustGovernance/partsentryReviewService.js'), 'utf8');
  const keys = new Set();
  for (const [, key] of source.matchAll(/\b(?:logPatch|patch)\.([a-z_]+)\s*=/g)) keys.add(key);
  for (const [, body] of source.matchAll(/const (?:logPatch|patch) = \{([^}]*)\}/g)) for (const [, key] of body.matchAll(/([a-z_]+)\s*:/g)) keys.add(key);
  for (const fn of ['patchForApproval', 'patchForRevocation']) {
    const body = source.slice(source.indexOf(`function ${fn}(`), source.indexOf('\n}\n', source.indexOf(`function ${fn}(`)));
    for (const [, literal] of body.matchAll(/return \{([^}]*)\}/g)) for (const [, key] of literal.matchAll(/([a-z_]+)\s*:/g)) keys.add(key);
  }
  assert.ok(keys.size >= 6, `anti-vacuity: found ${[...keys]}`);
  for (const key of keys) assert.ok(governed.includes(key), `${key} is written by the review workflow but not governed by the candidate`);
});

test('OC-4A 1.1 pin — the one-time link placeholders ARE Document Intelligence\'s placeholders, and the session service links only file_path', () => {
  const sql = readFileSync(CANDIDATE, 'utf8');
  const allowed = sql.match(/OLD\.file_path NOT IN \(([^)]*)\)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)).sort();
  const di = readFileSync(path.join(BACKEND, 'services/document-intelligence/documentIntelligenceService.js'), 'utf8');
  const written = [...di.matchAll(/file_path:\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(allowed, written);
  const session = readFileSync(path.join(BACKEND, 'services/identity/verificationSessionService.js'), 'utf8');
  const link = session.slice(session.indexOf(".from('ocr_documents')"), session.indexOf(".from('ocr_documents')") + 200);
  assert.match(link, /\.update\(\{ file_path: session\.front_storage_path \}\)/);
});

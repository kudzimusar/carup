/**
 * OC-3D 4F/4G — the append-only and retention MIGRATION CANDIDATES, proven on real PostgreSQL.
 *
 * database/migration-candidates/oc3d/ is NOT applied anywhere (no runner globs that directory). These
 * tests apply it to a disposable PGlite database built from the repository's ledger migrations, with
 * Supabase's platform default grants emulated (`GRANT ALL … TO service_role`) — so the "before" state
 * is a real positive control: the backend role CAN rewrite the ledger today, and the candidate is what
 * takes that away.
 *
 * Stated limitation, proven below: triggers and grants bind the application roles. The table owner /
 * a superuser can still bypass them (session_replication_role = replica). That party is answered by
 * tamper EVIDENCE — the hash chain verified from genesis — not by this migration.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_LEDGER_HASH_VERSION;

const harness = await import('./helpers/pgliteLedgerHarness.js');
const { createLedgerDatabase, applyLedgerCandidates, revertLedgerCandidates, seedVehicle, seedEvidence, supabaseOver, MIGRATIONS_DIR } = harness;
const { supabase } = await import('../db/supabase.js');
const { addEvent, verifyChain } = await import('../services/blockchain/blockchainService.js');

const realFrom = supabase.from;
const opened = [];
async function freshDatabase({ candidates = false } = {}) {
  const db = await createLedgerDatabase();
  opened.push(db);
  // Supabase's platform default: the backend's service_role holds every table privilege.
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;');
  if (candidates) await applyLedgerCandidates(db);
  const client = supabaseOver(db);
  supabase.from = (table) => client.from(table);
  return db;
}
after(async () => { supabase.from = realFrom; for (const db of opened) await db.close(); });

async function outcome(db, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return { ok: true, affected: result.affectedRows };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

test('OC-3D 4F reproduction — the 004 "tamper-proofing" triggers are SQLite, and do not even parse on PostgreSQL', async () => {
  const db = await freshDatabase();
  const sqlite = readFileSync(`${MIGRATIONS_DIR}/004_add_tamper_proofing.sql`, 'utf8');
  const trigger = sqlite.slice(sqlite.indexOf('CREATE TRIGGER'), sqlite.indexOf('END;', sqlite.indexOf('CREATE TRIGGER')) + 4);
  assert.match(trigger, /RAISE\(FAIL/, 'anti-vacuity: this is the SQLite trigger the repository relied on');
  const result = await outcome(db, trigger);
  assert.equal(result.ok, false, 'a protection that cannot be created protects nothing');
});

test('OC-3D 4F positive control — WITHOUT the candidate, the backend role can rewrite, delete and truncate the ledger', async () => {
  const db = await freshDatabase();
  await seedVehicle(db, 'OC3DAPPEND0000001');
  await addEvent('OC3DAPPEND0000001', 'NOTE', { a: 1 });
  await db.exec('SET ROLE service_role');
  try {
    assert.equal((await outcome(db, `UPDATE blockchain_events SET event_type = 'X' WHERE vin = 'OC3DAPPEND0000001'`)).ok, true);
    await db.exec('BEGIN');
    assert.equal((await outcome(db, 'TRUNCATE blockchain_events CASCADE')).ok, true);
    await db.exec('ROLLBACK');
    assert.equal((await outcome(db, `DELETE FROM blockchain_events WHERE vin = 'OC3DAPPEND0000001'`)).ok, true);
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('OC-3D 4F — WITH the candidate, the backend role can still append and verify, but never rewrite', async () => {
  const db = await freshDatabase({ candidates: true });
  const vin = 'OC3DAPPEND0000002';
  await seedVehicle(db, vin);
  await db.exec('SET ROLE service_role');
  try {
    // The canonical writer, running AS the backend role, is unaffected.
    for (let i = 0; i < 10; i += 1) await addEvent(vin, 'NOTE', { i });
    const report = await verifyChain(vin);
    assert.equal(report.verified, true);
    assert.equal(report.checkpoint, 'consistent', 'the rolling checkpoint (an ordinary table) is still maintained');
    for (const [label, sql] of [
      ['UPDATE', `UPDATE blockchain_events SET event_type = 'X' WHERE vin = '${vin}'`],
      ['DELETE', `DELETE FROM blockchain_events WHERE vin = '${vin}'`],
      ['TRUNCATE', 'TRUNCATE blockchain_events'],
      ['provenance TRUNCATE', 'TRUNCATE evidence_provenance_events'],
    ]) {
      const result = await outcome(db, sql);
      assert.equal(result.ok, false, `${label} must be refused for service_role`);
      assert.equal(result.code, '42501', `${label}: insufficient privilege (${result.message})`);
    }
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('OC-3D 4F — WITH the candidate, the triggers refuse even the table owner\'s ordinary UPDATE / DELETE / TRUNCATE', async () => {
  const db = await freshDatabase({ candidates: true });
  const vin = 'OC3DAPPEND0000003';
  await seedVehicle(db, vin);
  await addEvent(vin, 'NOTE', { a: 1 });
  for (const sql of [
    `UPDATE blockchain_events SET event_type = 'X' WHERE vin = '${vin}'`,
    `DELETE FROM blockchain_events WHERE vin = '${vin}'`,
    'TRUNCATE blockchain_events CASCADE',
    'TRUNCATE evidence_provenance_events CASCADE',
  ]) {
    const result = await outcome(db, sql);
    assert.equal(result.ok, false, sql);
    assert.match(result.message, /append-only/, sql);
  }
});

test('OC-3D 4F stated limitation — a superuser can bypass triggers; the hash chain is what still detects it', async () => {
  const db = await freshDatabase({ candidates: true });
  const vin = 'OC3DAPPEND0000004';
  await seedVehicle(db, vin);
  await addEvent(vin, 'NOTE', { a: 1 });
  await addEvent(vin, 'NOTE', { a: 2 });
  await db.exec("SET session_replication_role = 'replica'");
  try {
    const bypass = await outcome(db, `UPDATE blockchain_events SET payload = '"{\\"a\\":99}"'::jsonb WHERE vin = '${vin}' AND id = (SELECT min(id) FROM blockchain_events WHERE vin = '${vin}')`);
    assert.equal(bypass.ok, true, 'database ownership is not cryptographic immutability');
  } finally {
    await db.exec("SET session_replication_role = 'origin'");
  }
  assert.equal((await verifyChain(vin)).verified, false, 'tamper EVIDENCE survives the bypass');
});

test('OC-3D 4F — the fork guard: two events can no longer claim the same predecessor', async () => {
  const db = await freshDatabase({ candidates: true });
  const vin = 'OC3DAPPEND0000005';
  await seedVehicle(db, vin);
  await addEvent(vin, 'NOTE', { a: 1 });
  const { rows: [tail] } = await db.query('SELECT current_hash FROM blockchain_events WHERE vin = $1', [vin]);
  const insert = (hash) => outcome(db, 'INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
    [tail.current_hash, hash, vin, 'NOTE', JSON.stringify('{}'), new Date().toISOString(), 'SYSTEM_SIGNATURE']);
  assert.equal((await insert('c'.repeat(64))).ok, true);
  const fork = await insert('d'.repeat(64));
  assert.equal(fork.ok, false);
  assert.equal(fork.code, '23505', 'unique (vin, previous_hash)');
});

test('OC-3D 4F — the fork-guard candidate REFUSES to run over a ledger that is already forked', async () => {
  const db = await createLedgerDatabase();
  opened.push(db);
  await seedVehicle(db, 'OC3DAPPEND0000006');
  for (const hash of ['e'.repeat(64), 'f'.repeat(64)]) {
    await db.query('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
      ['0'.repeat(64), hash, 'OC3DAPPEND0000006', 'NOTE', JSON.stringify('{}'), new Date().toISOString(), 'SYSTEM_SIGNATURE']);
  }
  await assert.rejects(() => applyLedgerCandidates(db), /forked chain link/);
});

test('OC-3D 4G — retention: a vehicle (or evidence) with audit history can no longer be deleted out from under it', async () => {
  const db = await freshDatabase({ candidates: true });
  const vin = 'OC3DAPPEND0000007';
  await seedVehicle(db, vin);
  await addEvent(vin, 'NOTE', { a: 1 });
  const refused = await outcome(db, 'DELETE FROM vehicles WHERE vin = $1', [vin]);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, '23503', 'ON DELETE RESTRICT');
  // Positive control: a vehicle WITHOUT history is still deletable.
  await seedVehicle(db, 'OC3DAPPEND0000008');
  assert.equal((await outcome(db, 'DELETE FROM vehicles WHERE vin = $1', ['OC3DAPPEND0000008'])).ok, true);
  // Evidence with provenance: RESTRICT, not a cascade into an append-only table.
  const evidenceId = await seedEvidence(db, vin);
  await db.query(`INSERT INTO evidence_provenance_events (evidence_id, vin, sequence, event_type, content_hash) VALUES ($1, $2, 1, 'created', $3)`, [evidenceId, vin, `v2:${'1'.repeat(64)}`]);
  const evidenceDelete = await outcome(db, 'DELETE FROM vehicle_evidence WHERE id = $1', [evidenceId]);
  assert.equal(evidenceDelete.ok, false);
  assert.equal(evidenceDelete.code, '23503');
});

test('OC-3D 4F — new hashes must be v1 or v2 shaped (NOT VALID: history is not re-judged)', async () => {
  const db = await freshDatabase({ candidates: true });
  await seedVehicle(db, 'OC3DAPPEND0000009');
  const insert = (prev, current) => outcome(db, 'INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
    [prev, current, 'OC3DAPPEND0000009', 'NOTE', JSON.stringify('{}'), new Date().toISOString(), null]);
  assert.equal((await insert('0'.repeat(64), 'not-a-hash')).code, '23514');
  assert.equal((await insert('0'.repeat(64), '1'.repeat(64))).ok, true, 'v1 shape');
  assert.equal((await insert('1'.repeat(64), `v2:${'2'.repeat(64)}`)).ok, true, 'v2 shape');
});

test('OC-3D 4F — the candidates revert cleanly (Down), without silently re-granting write access', async () => {
  const db = await freshDatabase({ candidates: true });
  await revertLedgerCandidates(db);
  const { rows: triggers } = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'blockchain_events'::regclass`);
  assert.deepEqual(triggers, []);
  const { rows: [fk] } = await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'blockchain_events'::regclass AND contype = 'f'`);
  assert.match(fk.d, /ON DELETE CASCADE/);
  const { rows: [grant] } = await db.query(`SELECT has_table_privilege('service_role', 'blockchain_events', 'UPDATE') AS can_update`);
  assert.equal(grant.can_update, false, 'restoring write access to an audit store is a deliberate act, not a rollback side effect');
});

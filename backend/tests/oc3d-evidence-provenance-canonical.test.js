/**
 * OC-3D 4I — evidence provenance hashing survives a real PostgreSQL round trip.
 *
 * THE DEFECT (OC-3A, reproduced here on the repository's own schema). recordProvenanceEvent hashed
 * `JSON.stringify(record)` — JavaScript insertion order — and stored `details` as JSONB, which
 * PostgreSQL re-orders (shortest key first, then bytewise). verifyProvenanceChain re-serialized what
 * the database returned. So the SHIPPED writer and the SHIPPED verifier disagreed about untouched
 * history: any event whose `details` had keys in a different order than JSONB's was reported as
 * `content_hash_mismatch` — tampering — when nothing had been altered.
 *
 * THE FIX. Writer and verifier share the canonical serialization (v2, stored 'v2:…'). Historical v1
 * rows are verified as written; a v1 row that cannot be reproduced is `legacy_hash_unverifiable` —
 * neither proven tampered nor accepted — and a real break anywhere outranks it.
 *
 * Base-compatible on purpose: the v1 algorithm is written out here, so this suite is also the
 * failing-first proof against the pre-OC-3D code.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createLedgerDatabase, seedVehicle, seedEvidence, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { recordProvenanceEvent, verifyProvenanceChain } = await import('../services/evidence/provenanceService.js');

let db;
let client;
before(async () => {
  db = await createLedgerDatabase();
  client = supabaseOver(db);
  await seedVehicle(db, 'OC3DPROV000000001');
});
after(async () => { await db?.close(); });

/** The historical v1 algorithm, as it was written before OC-3D. */
function v1Hash({ evidence_id, sequence, event_type, actor_user_id, actor_role, actor_type, details, prev_hash }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    evidence_id: evidence_id || null, sequence, event_type, actor_user_id: actor_user_id || null,
    actor_role: actor_role || null, actor_type: actor_type || 'user', details: details || {}, prev_hash: prev_hash || null,
  })).digest('hex');
}

async function insertRaw(row) {
  await db.query(`INSERT INTO evidence_provenance_events (evidence_id, vin, sequence, event_type, actor_user_id, actor_role, actor_type, details, content_hash, prev_hash)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
  [row.evidence_id, 'OC3DPROV000000001', row.sequence, row.event_type, row.actor_user_id ?? null, row.actor_role ?? null, row.actor_type ?? 'user', JSON.stringify(row.details), row.content_hash, row.prev_hash ?? null]);
}

async function asSuperuserBypassingTriggers(fn) {
  await db.exec("SET session_replication_role = 'replica'");
  try { return await fn(); } finally { await db.exec("SET session_replication_role = 'origin'"); }
}

test('OC-3D 4I reproduction — the shipped writer + verifier now agree after a REAL JSONB round trip', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  // Insertion orders PostgreSQL JSONB will change (it stores shortest keys first).
  const detailsSeries = [
    { checksum_algorithm: 'sha256', size: 10 },
    { reviewer_note: 'clear photo', decision: 'approved', at: '2026-10-04T00:00:00.000Z' },
    { nested: { zebra: 1, ox: [{ long_key: 1, k: 2 }] }, v: 1 },
  ];
  for (const [i, details] of detailsSeries.entries()) {
    await recordProvenanceEvent(client, { evidenceId, vin: 'OC3DPROV000000001', eventType: ['created', 'approved', 'transformed'][i], actorUserId: 'user-1', actorRole: 'owner', details });
  }
  const { rows: stored } = await db.query('SELECT details FROM evidence_provenance_events WHERE evidence_id = $1 ORDER BY sequence', [evidenceId]);
  assert.deepEqual(Object.keys(stored[1].details), ['at', 'decision', 'reviewer_note'], 'anti-vacuity: PostgreSQL really re-ordered the keys');
  const chain = await verifyProvenanceChain(client, evidenceId);
  assert.deepEqual({ valid: chain.valid, reason: chain.reason }, { valid: true, reason: null },
    'before OC-3D this untouched history was reported as content_hash_mismatch (tampering)');
});

test('OC-3D 4I — a v1 row JSONB re-ordered is legacy_hash_unverifiable: never "tampered", never "valid"', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  const row = { evidence_id: evidenceId, sequence: 1, event_type: 'created', actor_user_id: 'user-1', details: { alpha: 1, zeta: 2 }, prev_hash: null };
  await insertRaw({ ...row, content_hash: v1Hash(row) });
  const chain = await verifyProvenanceChain(client, evidenceId);
  assert.equal(chain.valid, false);
  assert.equal(chain.reason, 'legacy_hash_unverifiable', 'JSONB re-ordering is not evidence of tampering');
  assert.equal(chain.legacyUnverifiable, 1);
});

test('OC-3D 4I positive control — a v1 row whose details survive storage unchanged still verifies as written', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  const row = { evidence_id: evidenceId, sequence: 1, event_type: 'created', actor_user_id: 'user-1', details: { a: 1 }, prev_hash: null };
  await insertRaw({ ...row, content_hash: v1Hash(row) });
  const chain = await verifyProvenanceChain(client, evidenceId);
  assert.equal(chain.valid, true, 'v1 history is verified as it was written, not reinterpreted');
});

test('OC-3D 4I — a v2 row altered under the triggers is content_hash_mismatch, and outranks a legacy row', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  const legacy = { evidence_id: evidenceId, sequence: 1, event_type: 'created', actor_user_id: 'user-1', details: { alpha: 1, zeta: 2 }, prev_hash: null };
  await insertRaw({ ...legacy, content_hash: v1Hash(legacy) });
  await recordProvenanceEvent(client, { evidenceId, vin: 'OC3DPROV000000001', eventType: 'approved', actorUserId: 'user-1', details: { decision: 'approved' } });
  const { rows: [second] } = await db.query('SELECT id, content_hash FROM evidence_provenance_events WHERE evidence_id = $1 AND sequence = 2', [evidenceId]);
  assert.match(second.content_hash, /^v2:[0-9a-f]{64}$/, 'the writer now writes v2');
  await asSuperuserBypassingTriggers(() => db.query(`UPDATE evidence_provenance_events SET details = '{"decision":"rejected"}'::jsonb WHERE id = $1`, [second.id]));
  const chain = await verifyProvenanceChain(client, evidenceId);
  assert.equal(chain.valid, false);
  assert.equal(chain.reason, 'content_hash_mismatch', 'a proven alteration is reported as such, even after an unverifiable legacy row');
  assert.equal(chain.brokenAt, 2);
});

test('OC-3D 4I — a removed event breaks the provenance links', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  for (const eventType of ['created', 'validated', 'approved']) {
    await recordProvenanceEvent(client, { evidenceId, vin: 'OC3DPROV000000001', eventType, actorUserId: 'user-1', details: {} });
  }
  await asSuperuserBypassingTriggers(() => db.query('DELETE FROM evidence_provenance_events WHERE evidence_id = $1 AND sequence = 2', [evidenceId]));
  const chain = await verifyProvenanceChain(client, evidenceId);
  assert.equal(chain.valid, false);
  assert.equal(chain.reason, 'prev_hash_break');
});

test('OC-3D 4I — the shipped append-only triggers already refuse ordinary UPDATE / DELETE of provenance', async () => {
  const evidenceId = await seedEvidence(db, 'OC3DPROV000000001');
  await recordProvenanceEvent(client, { evidenceId, vin: 'OC3DPROV000000001', eventType: 'created', actorUserId: 'user-1', details: {} });
  await assert.rejects(() => db.query(`UPDATE evidence_provenance_events SET event_type = 'approved' WHERE evidence_id = $1`, [evidenceId]), /append-only/);
  await assert.rejects(() => db.query('DELETE FROM evidence_provenance_events WHERE evidence_id = $1', [evidenceId]), /append-only/);
});

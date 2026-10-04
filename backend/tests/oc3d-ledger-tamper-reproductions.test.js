/**
 * OC-3D 4B/4C — the OC-3A tamper findings, reproduced on the REAL ledger schema and pinned.
 *
 * Every event below is written by the SHIPPED canonical writer (blockchainService.addEvent) into
 * PostgreSQL (PGlite) built from the repository's own migrations (helpers/pgliteLedgerHarness.js),
 * then attacked with raw SQL — exactly what any party with write access to the table can do today:
 * the repository's PostgreSQL DDL gives blockchain_events no trigger at all.
 *
 * This suite deliberately uses only APIs that existed before OC-3D (addEvent, verifyChain,
 * calculateHash, toLedgerIntegrityReport), so running it against the pre-OC-3D code is the failing-first
 * proof. Findings that were DEFECTS of the old verifier (checkpoint trust root, signature downgrade,
 * erased history read as "empty") fail there; attacks the old verifier already caught are kept as
 * regression guards and labelled so.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_LEDGER_HASH_VERSION;

const { createLedgerDatabase, seedVehicle, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { supabase } = await import('../db/supabase.js');
const { addEvent, verifyChain, calculateHash } = await import('../services/blockchain/blockchainService.js');
const { toLedgerIntegrityReport } = await import('../services/blockchain/ledgerIntegrityProjection.js');

let db;
const realFrom = supabase.from;
before(async () => {
  db = await createLedgerDatabase();
  const client = supabaseOver(db);
  supabase.from = (table) => client.from(table);
});
after(async () => { supabase.from = realFrom; await db?.close(); });

let seq = 0;
let vin;
beforeEach(async () => {
  seq += 1;
  vin = `OC3DREPRO${String(seq).padStart(8, '0')}`;
  await seedVehicle(db, vin);
});

async function writeChain(n, payloadOf = (i) => ({ service: `oil change ${i}`, odometer: 1000 * (i + 1) })) {
  for (let i = 0; i < n; i += 1) await addEvent(vin, 'SERVICE_LOG', payloadOf(i));
}
const rows = async () => (await db.query('SELECT id, previous_hash, current_hash, event_type, payload, timestamp, signature FROM blockchain_events WHERE vin = $1 ORDER BY id', [vin])).rows;
const sql = (text, params = []) => db.query(text, params);

/** Rewrite rows in place as an attacker would: forge content and recompute the v1 chain. */
async function rewriteChain(forge, signature) {
  let prev = '0'.repeat(64);
  for (const row of await rows()) {
    const payload = forge(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
    const current = calculateHash(prev, vin, row.event_type, row.timestamp, payload);
    await sql('UPDATE blockchain_events SET payload = $1::jsonb, previous_hash = $2, current_hash = $3, signature = $4 WHERE id = $5',
      [JSON.stringify(JSON.stringify(payload)), prev, current, signature, row.id]);
    prev = current;
  }
}

test('OC-3D baseline: an honest chain written by the canonical writer verifies, and every event is authenticated', async () => {
  await writeChain(3);
  const report = await verifyChain(vin);
  assert.equal(report.verified, true);
  assert.equal(report.count, 3);
  assert.equal(report.authenticated, true, 'every event carries a verified system HMAC');
  assert.equal(toLedgerIntegrityReport(vin, report).authenticated, true);
});

test('OC-3D repro — full unsigned chain rewrite: forged history with placeholder signatures is NOT authenticated', async () => {
  await writeChain(3);
  await rewriteChain((payload) => ({ ...payload, odometer: 1 }), 'SYSTEM_SIGNATURE');
  const report = await verifyChain(vin);
  // The hash links were recomputed, so they are intact — a v1 chain cannot prove more than that.
  // What must not survive is the claim that this history is authenticated: before OC-3D the verifier
  // ignored any signature without "signer:" form and answered verified:true with nothing else to say.
  assert.equal(report.verified, true);
  assert.equal(report.authenticated, false, 'a placeholder is not a signature');
  assert.equal(report.signatures.legacy_unverified, 3);
  assert.equal(toLedgerIntegrityReport(vin, report).authenticated, false);
  // And a rewrite that keeps the signer:proof form cannot forge the HMAC: it breaks the chain.
  await rewriteChain((payload) => ({ ...payload, odometer: 2 }), `system:${'0'.repeat(64)}`);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D repro — checkpoint trust-root bypass: tampering BEFORE the automatic checkpoint is detected', async () => {
  await writeChain(11); // addEvent writes a rolling checkpoint at the 10th event
  const { rows: [checkpoint] } = await sql('SELECT last_verified_event_id, rolling_hash FROM rolling_integrity_checkpoints WHERE vin = $1', [vin]);
  assert.ok(checkpoint, 'the canonical writer created a checkpoint');
  const third = (await rows())[2];
  await sql('UPDATE blockchain_events SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(JSON.stringify({ service: 'never happened', odometer: 1 })), third.id]);
  // Before OC-3D verification STARTED at the checkpoint and never looked at events 1–10 again.
  const report = await verifyChain(vin);
  assert.equal(report.verified, false, 'a rewrite before the checkpoint must be found');
  assert.equal(report.tamperIndex, 2);
});

test('OC-3D repro — checkpoint relocation: pointing the checkpoint at the tail does not launder earlier tampering', async () => {
  await writeChain(4);
  const all = await rows();
  await sql('UPDATE blockchain_events SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(JSON.stringify({ service: 'forged' })), all[0].id]);
  await sql(`INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at) VALUES ($1, $2, $3, 'x')
             ON CONFLICT (vin) DO UPDATE SET last_verified_event_id = EXCLUDED.last_verified_event_id, rolling_hash = EXCLUDED.rolling_hash`,
    [vin, all.at(-1).id, all.at(-1).current_hash]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D repro — a checkpoint witness that disagrees with history is evidence, not something to skip', async () => {
  await writeChain(3);
  const all = await rows();
  await sql('INSERT INTO rolling_integrity_checkpoints (vin, last_verified_event_id, rolling_hash, verified_at) VALUES ($1, $2, $3, $4)',
    [vin, all[1].id, 'f'.repeat(64), 'x']);
  const report = await verifyChain(vin);
  assert.equal(report.verified, false, 'the old verifier silently fell back to genesis and said verified');
  assert.match(report.reason, /witness/);
});

test('OC-3D repro — erased history: a checkpoint left behind after the events were deleted is not an "empty" ledger', async () => {
  await writeChain(10); // checkpoint at event 10
  await sql('DELETE FROM blockchain_events WHERE vin = $1', [vin]);
  const report = await verifyChain(vin);
  assert.equal(report.verified, false, 'before OC-3D this answered { verified: true, count: 0 }');
  assert.equal(toLedgerIntegrityReport(vin, report).integrity, 'broken');
});

test('OC-3D repro — tail truncation: deleting events the checkpoint witnessed is detected', async () => {
  await writeChain(10);
  const all = await rows();
  await sql('DELETE FROM blockchain_events WHERE id = $1', [all.at(-1).id]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D repro — single-event signature downgrade to the placeholder is reported, not absorbed', async () => {
  await writeChain(3);
  const all = await rows();
  await sql('UPDATE blockchain_events SET signature = $1 WHERE id = $2', ['SYSTEM_SIGNATURE', all[1].id]);
  const report = await verifyChain(vin);
  assert.equal(report.verified, true);
  assert.equal(report.authenticated, false);
  assert.equal(report.chain[1].signature_status, 'legacy_unverified');
});

// ── Regression guards: attacks the old verifier already caught, kept so they stay caught ────────

test('OC-3D guard — payload edit without re-hashing breaks the chain', async () => {
  await writeChain(3);
  const all = await rows();
  await sql('UPDATE blockchain_events SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(JSON.stringify({ service: 'x' })), all[1].id]);
  const report = await verifyChain(vin);
  assert.equal(report.verified, false);
  assert.equal(report.tamperIndex, 1);
});

test('OC-3D guard — hash edit breaks the chain', async () => {
  await writeChain(3);
  const all = await rows();
  await sql('UPDATE blockchain_events SET current_hash = $1 WHERE id = $2', ['a'.repeat(64), all[2].id]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D guard — a forged system signature is invalid and breaks the chain', async () => {
  await writeChain(2);
  const all = await rows();
  await sql('UPDATE blockchain_events SET signature = $1 WHERE id = $2', [`system:${'b'.repeat(64)}`, all[0].id]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D guard — deleting a middle event breaks the links', async () => {
  await writeChain(4);
  const all = await rows();
  await sql('DELETE FROM blockchain_events WHERE id = $1', [all[1].id]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D guard — inserting or re-ordering events breaks the links', async () => {
  await writeChain(3);
  const all = await rows();
  // Reorder: swap the content of two events' rows.
  await sql(`UPDATE blockchain_events SET previous_hash = $1, current_hash = $2 WHERE id = $3`, [all[2].previous_hash, all[2].current_hash, all[1].id]);
  assert.equal((await verifyChain(vin)).verified, false);
});

test('OC-3D guard — a forked chain (two events claiming the same predecessor) is broken', async () => {
  await writeChain(2);
  const all = await rows();
  // What two concurrent writers produce: a second event linked to the same tail.
  await sql('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)',
    [all[0].current_hash, 'c'.repeat(64), vin, 'SERVICE_LOG', JSON.stringify('{}'), new Date().toISOString(), 'SYSTEM_SIGNATURE']);
  assert.equal((await verifyChain(vin)).verified, false);
});

// ── Mutability and deletion on the schema as the repository defines it today ───────────────────

test('OC-3D repro — the repository schema lets any writer UPDATE, DELETE and TRUNCATE the ledger', async () => {
  await writeChain(1);
  const { rows: triggers } = await sql(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'blockchain_events'::regclass`);
  assert.deepEqual(triggers, [], 'no append-only trigger exists on blockchain_events (the 004 SQLite triggers never ran on PostgreSQL)');
  const updated = await sql('UPDATE blockchain_events SET event_type = $1 WHERE vin = $2', ['REWRITTEN', vin]);
  assert.equal(updated.affectedRows, 1, 'UPDATE succeeded');
});

test('OC-3D repro — deleting a vehicle CASCADES away its entire audit history', async () => {
  await writeChain(3);
  await sql('DELETE FROM vehicles WHERE vin = $1', [vin]);
  const { rows: [{ n }] } = await sql('SELECT count(*)::int AS n FROM blockchain_events WHERE vin = $1', [vin]);
  assert.equal(n, 0, 'ON DELETE CASCADE erased the ledger with the vehicle');
  // and what remains reads as an empty ledger, not as erased history:
  assert.equal(toLedgerIntegrityReport(vin, await verifyChain(vin)).integrity, 'empty');
});

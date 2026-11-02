/**
 * OC-3D 4D/4E/4H — one canonical serialization, versioned hashes, and what a signature proves.
 *
 * 4D: canonicalSerialize is the ONE primitive for hash inputs: key order (any depth) cannot change
 *     it, arrays keep order, and it normalizes exactly as JSON persistence does.
 * 4E: v1 (historical concatenation hash) is verified as written and never reinterpreted; v2 is a
 *     domain-separated canonical hash carrying its version in-band ('v2:'). New events are v2 only
 *     when the deployment switches it on (CARUP_LEDGER_HASH_VERSION=2); chains may mix v1 then v2.
 * 4H: each event's signature is classified verified | absent | legacy_unverified | invalid; v2 events
 *     must carry a verified one.
 * Writes and attacks run on the real ledger schema in PGlite (helpers/pgliteLedgerHarness.js).
 */
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createLedgerDatabase, seedVehicle, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { supabase } = await import('../db/supabase.js');
const canonical = await import('../services/blockchain/ledgerCanonicalSerialization.js');
const ledger = await import('../services/blockchain/blockchainService.js');
const { signSystemLedgerHash } = await import('../services/blockchain/blockchainKeyCustodyService.js');

const { canonicalSerialize, canonicalDigest, hashVersionOf } = canonical;
const { addEvent, verifyChain, calculateHash, calculateHashV2, ledgerWriteHashVersion } = ledger;

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
  vin = `OC3DHASH${String(seq).padStart(9, '0')}`;
  await seedVehicle(db, vin);
});
afterEach(() => { delete process.env.CARUP_LEDGER_HASH_VERSION; });
const rows = async () => (await db.query('SELECT * FROM blockchain_events WHERE vin = $1 ORDER BY id', [vin])).rows;

// ── 4D: the primitive ────────────────────────────────────────────────────────────────────────────

test('OC-3D canonical: key order is irrelevant at every depth; arrays keep their order', () => {
  const a = { z: 1, a: { y: [3, { d: 1, c: 2 }], b: null }, m: 'x' };
  const b = { m: 'x', a: { b: null, y: [3, { c: 2, d: 1 }] }, z: 1 };
  assert.equal(canonicalSerialize(a), canonicalSerialize(b));
  assert.equal(canonicalSerialize(a), '{"a":{"b":null,"y":[3,{"c":2,"d":1}]},"m":"x","z":1}', 'golden canonical form');
  assert.notEqual(canonicalSerialize([1, 2]), canonicalSerialize([2, 1]));
});

test('OC-3D canonical: every value type, normalized as JSON persistence normalizes it', () => {
  assert.equal(canonicalSerialize(null), 'null');
  assert.equal(canonicalSerialize(true), 'true');
  assert.equal(canonicalSerialize('é\n"q"'), JSON.stringify('é\n"q"'));
  assert.equal(canonicalSerialize(-0), '0');
  assert.equal(canonicalSerialize(1e21), '1e+21');
  assert.equal(canonicalSerialize(0.1 + 0.2), '0.30000000000000004');
  assert.equal(canonicalSerialize(new Date('2026-10-04T05:06:07.890Z')), '"2026-10-04T05:06:07.890Z"', 'a timestamp is its ISO-8601 string');
  assert.equal(canonicalSerialize({ at: new Date(Date.UTC(2026, 0, 2)), skip: undefined }), '{"at":"2026-01-02T00:00:00.000Z"}');
  assert.equal(canonicalSerialize([undefined, () => 1, NaN, Infinity]), '[null,null,null,null]');
  assert.throws(() => canonicalSerialize(undefined), /not JSON-persistable/);
  assert.throws(() => canonicalSerialize({ big: 10n }), TypeError, 'a BigInt has no JSON form');
  // Keys order by UTF-16 code units (RFC 8785): uppercase before lowercase, accented after ASCII.
  assert.equal(canonicalSerialize({ b: 1, B: 2, é: 3, a: 4 }), '{"B":2,"a":4,"b":1,"é":3}');
  // Unicode is not normalized: NFC and NFD are different values.
  assert.notEqual(canonicalSerialize('é'.normalize('NFC')), canonicalSerialize('é'.normalize('NFD')));
});

test('OC-3D canonical: digests are domain-separated, and the stored version is read from the hash itself', () => {
  assert.notEqual(canonicalDigest('carup.ledger.event.v2', { a: 1 }), canonicalDigest('carup.provenance.event.v2', { a: 1 }));
  assert.equal(hashVersionOf('a'.repeat(64)), 1);
  assert.equal(hashVersionOf(`v2:${'a'.repeat(64)}`), 2);
  assert.equal(hashVersionOf(null), 1);
});

// ── 4E: v1 weaknesses, v2 fixes, versions kept apart ────────────────────────────────────────────

test('OC-3D v1 weakness — field boundaries can shift (bare concatenation); v2 cannot collide that way', () => {
  const prev = '0'.repeat(64);
  const t = '2026-01-01T00:00:00.000Z';
  assert.equal(calculateHash(prev, 'VINAB', 'C', t, {}), calculateHash(prev, 'VINA', 'BC', t, {}), 'v1: two different events, one hash');
  assert.notEqual(calculateHashV2(prev, 'VINAB', 'C', t, {}), calculateHashV2(prev, 'VINA', 'BC', t, {}));
});

test('OC-3D v1 weakness — a payload stored as a JSONB OBJECT is re-ordered by PostgreSQL and cannot re-verify; v2 can', async () => {
  const t = new Date().toISOString();
  // PostgreSQL JSONB stores object keys shortest-first, then bytewise: { alpha, zeta } reads back as
  // { zeta, alpha }, so JSON.stringify of what the database returns differs from what was hashed.
  const payload = { alpha: 2, zeta: 1 };
  const v1 = calculateHash('0'.repeat(64), vin, 'NOTE', t, payload);
  await db.query('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
    ['0'.repeat(64), v1, vin, 'NOTE', JSON.stringify(payload), t, `system:${signSystemLedgerHash(v1)}`]);
  const [stored] = await rows();
  assert.deepEqual(Object.keys(stored.payload), ['zeta', 'alpha'], 'PostgreSQL re-ordered the object keys');
  assert.equal((await verifyChain(vin)).verified, false, 'v1 over JSON insertion order: an untouched row no longer verifies');

  seq += 1; vin = `OC3DHASH${String(seq).padStart(9, '0')}`; await seedVehicle(db, vin);
  const v2 = calculateHashV2('0'.repeat(64), vin, 'NOTE', t, payload);
  await db.query('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
    ['0'.repeat(64), v2, vin, 'NOTE', JSON.stringify(payload), t, `system:${signSystemLedgerHash(v2)}`]);
  const report = await verifyChain(vin);
  assert.equal(report.verified, true, 'v2 is computed over the canonical form, so the store\'s key order does not matter');
  assert.equal(report.authenticated, true);
});

test('OC-3D v2 is a deployment switch: v1 by default, v2 only when CARUP_LEDGER_HASH_VERSION=2', async () => {
  assert.equal(ledgerWriteHashVersion({}), 1);
  assert.equal(ledgerWriteHashVersion({ CARUP_LEDGER_HASH_VERSION: '1' }), 1);
  assert.equal(ledgerWriteHashVersion({ CARUP_LEDGER_HASH_VERSION: 'two' }), 1);
  assert.equal(ledgerWriteHashVersion({ CARUP_LEDGER_HASH_VERSION: ' 2 ' }), 2);
  await addEvent(vin, 'SERVICE_LOG', { n: 1 });
  process.env.CARUP_LEDGER_HASH_VERSION = '2';
  await addEvent(vin, 'SERVICE_LOG', { n: 2 });
  await addEvent(vin, 'SERVICE_LOG', { b: 2, a: 1 });
  const stored = await rows();
  assert.equal(hashVersionOf(stored[0].current_hash), 1);
  assert.match(stored[1].current_hash, /^v2:[0-9a-f]{64}$/);
  assert.equal(stored[1].previous_hash, stored[0].current_hash, 'a v2 event links to the v1 history before it');
  const report = await verifyChain(vin);
  assert.equal(report.verified, true, 'a mixed v1 → v2 chain verifies, each event with its own scheme');
  assert.deepEqual(report.hash_versions, { v1: 1, v2: 2 });
  assert.equal(report.authenticated, true);
});

test('OC-3D v2 tampering is detected, and a v1 hash cannot be relabelled as v2', async () => {
  process.env.CARUP_LEDGER_HASH_VERSION = '2';
  await addEvent(vin, 'SERVICE_LOG', { n: 1 });
  await addEvent(vin, 'SERVICE_LOG', { n: 2 });
  const stored = await rows();
  await db.query('UPDATE blockchain_events SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(JSON.stringify({ n: 99 })), stored[0].id]);
  assert.equal((await verifyChain(vin)).verified, false);

  delete process.env.CARUP_LEDGER_HASH_VERSION;
  seq += 1; vin = `OC3DHASH${String(seq).padStart(9, '0')}`; await seedVehicle(db, vin);
  await addEvent(vin, 'SERVICE_LOG', { n: 1 });
  const [v1] = await rows();
  await db.query('UPDATE blockchain_events SET current_hash = $1 WHERE id = $2', [`v2:${v1.current_hash}`, v1.id]);
  assert.equal((await verifyChain(vin)).verified, false, 'v1 history is never reinterpreted as v2');
});

// ── 4H: what a signature proves ─────────────────────────────────────────────────────────────────

test('OC-3D signatures — every form is classified for what it proves', async () => {
  for (const [signature, expected] of [
    [null, 'absent'],
    ['', 'absent'],
    ['SYSTEM_SIGNATURE', 'legacy_unverified'],
    ['opaque-token-without-signer', 'legacy_unverified'],
    ['stakeholder-without-key-history:abcdef', 'legacy_unverified'],
  ]) {
    seq += 1; vin = `OC3DHASH${String(seq).padStart(9, '0')}`; await seedVehicle(db, vin);
    const t = new Date().toISOString();
    const hash = calculateHash('0'.repeat(64), vin, 'NOTE', t, { a: 1 });
    await db.query('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
      ['0'.repeat(64), hash, vin, 'NOTE', JSON.stringify(JSON.stringify({ a: 1 })), t, signature]);
    const report = await verifyChain(vin);
    assert.equal(report.verified, true, `${JSON.stringify(signature)}: a v1 chain with an unproven signature still has intact links`);
    assert.equal(report.chain[0].signature_status, expected, JSON.stringify(signature));
    assert.equal(report.authenticated, false, `${JSON.stringify(signature)}: not authenticated`);
  }
  // A verified system HMAC — positive control.
  await addEvent(vin, 'NOTE', { a: 2 });
  assert.equal((await verifyChain(vin)).chain.at(-1).signature_status, 'verified');
});

test('OC-3D signatures — a v2 event without a VERIFIED signature breaks the chain', async () => {
  for (const signature of [null, 'SYSTEM_SIGNATURE', 'stakeholder-without-key-history:abcdef']) {
    seq += 1; vin = `OC3DHASH${String(seq).padStart(9, '0')}`; await seedVehicle(db, vin);
    const t = new Date().toISOString();
    const hash = calculateHashV2('0'.repeat(64), vin, 'NOTE', t, { a: 1 });
    await db.query('INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)',
      ['0'.repeat(64), hash, vin, 'NOTE', JSON.stringify(JSON.stringify({ a: 1 })), t, signature]);
    const report = await verifyChain(vin);
    assert.equal(report.verified, false, JSON.stringify(signature));
    assert.match(report.reason, /Unauthenticated v2 event/);
  }
});

/**
 * Issue #158 rotation-boundary truth (Codex P1: colliding/skewed activation clocks).
 *
 * Exercises REAL addEvent() signing and verifyChain() verification across key
 * rotations whose host wall clock is frozen on one millisecond and then skewed
 * backwards. The supabase test double implements the same DB-authoritative
 * monotonic boundary contract as blockchain_activate_public_key_boundary:
 *   - the caller supplies NO timestamp;
 *   - every authorized signing check advances a per-stakeholder watermark;
 *   - rotation writes old.revoked_at = new.created_at = boundary, strictly after
 *     every previously authorized event timestamp, regardless of the host clock.
 *
 * Proven here:
 *   1. two generations activated in the SAME millisecond still get distinct,
 *      strictly ordered validity boundaries;
 *   2. a backwards-skewed host clock cannot fold the boundary back;
 *   3. an old-generation event authorized BEFORE a rotation still verifies with
 *      the old key even though its row persists AFTER the rotation;
 *   4. an event stamped exactly on the rotation boundary verifies with the NEW
 *      key (half-open [created_at, revoked_at) — the old key is excluded);
 *   5. a forgery signed with the old key at the boundary instant is rejected;
 *   6. no two key incarnations are simultaneously eligible for any timestamp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const { addEvent, verifyChain, calculateHash, getOrCreateKeypair } = await import('../services/blockchain/blockchainService.js');
const { custodyGeneration, deriveStakeholderKey, signLedgerHash } = await import('../services/blockchain/blockchainKeyCustodyService.js');

const VIN = 'VINBOUNDARY000001';
const SIGNER = 'boundary-mech';
const T0 = Date.parse('2026-08-29T01:00:00.000Z');
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ── In-memory supabase double with a DB-owned monotonic boundary ────────────────
const db = { public_keys: [], blockchain_events: [], rolling_integrity_checkpoints: [] };
let eventSeq = 0;
let stubClockMs = T0;          // the "host wall clock" the fake DB would observe
let watermarkMs = null;        // per-signer watermark (single signer in this suite)
let authorizedGeneration = null;

function builder(table) {
  const st = { table, op: 'select', filters: [], gt: null, order: null, limit: null, single: false, maybe: false, head: false, payload: null };
  const chain = {
    select(_cols, opts) { if (opts?.head) st.head = true; return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    eq(k, v) { st.filters.push([k, v]); return chain; },
    gt(k, v) { st.gt = [k, v]; return chain; },
    order(k, opts) { st.order = [k, opts?.ascending !== false]; return chain; },
    limit(n) { st.limit = n; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { return Promise.resolve(run(st)).then(res, rej); },
  };
  return chain;
}

function run(st) {
  const rows = db[st.table] || [];
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const inserted = list.map((p) => ({ id: ++eventSeq, ...p }));
    rows.push(...inserted);
    return { data: inserted, error: null };
  }
  let out = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
  if (st.gt) out = out.filter((r) => r[st.gt[0]] > st.gt[1]);
  if (st.order) {
    const [key, asc] = st.order;
    out = [...out].sort((a, b) => {
      const av = key === 'id' ? a[key] : Date.parse(a[key]);
      const bv = key === 'id' ? b[key] : Date.parse(b[key]);
      return asc ? av - bv : bv - av;
    });
  }
  if (st.limit != null) out = out.slice(0, st.limit);
  if (st.head) return { count: out.length, data: null, error: null };
  if (st.maybe) return { data: out[0] || null, error: null };
  if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'No rows found' } };
  return { data: out, error: null };
}

supabase.from = (t) => builder(t);
supabase.rpc = async (name, args) => {
  if (name === 'blockchain_custody_rollout_contract') {
    return { data: { state: 'FINALIZED', authorized_generation: authorizedGeneration }, error: null };
  }
  if (name !== 'blockchain_activate_public_key_boundary') {
    return { data: null, error: { message: `unsupported test RPC: ${name}` } };
  }
  if (args.p_custody_generation !== authorizedGeneration) {
    return { data: null, error: { message: 'stakeholder signer custody generation is not authorized' } };
  }

  // DB-authoritative boundary: strictly after the watermark, whatever the clock says.
  let boundaryMs = stubClockMs;
  if (watermarkMs !== null && boundaryMs <= watermarkMs) boundaryMs = watermarkMs + 1;
  watermarkMs = boundaryMs;
  const boundary = new Date(boundaryMs).toISOString();

  const active = db.public_keys.find((r) => r.user_id === args.p_user_id && r.status === 'ACTIVE');
  if (active?.public_key_pem === args.p_public_key_pem) {
    Object.assign(active, {
      key_ref: args.p_key_ref,
      key_version: args.p_key_version,
      custody_provider: args.p_custody_provider,
    });
    return { data: [{ ...active, event_timestamp: boundary }], error: null };
  }
  if (active) {
    active.status = 'REVOKED';
    active.revoked_at = boundary;
  }
  const activated = {
    id: args.p_candidate_id,
    user_id: args.p_user_id,
    public_key_pem: args.p_public_key_pem,
    key_type: args.p_key_type,
    status: 'ACTIVE',
    created_at: boundary,
    revoked_at: null,
    key_ref: args.p_key_ref,
    key_version: args.p_key_version,
    custody_provider: args.p_custody_provider,
  };
  db.public_keys.push(activated);
  return { data: [{ ...activated, event_timestamp: boundary }], error: null };
};

function useKeyVersion(version) {
  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = version;
  authorizedGeneration = custodyGeneration();
}

test('Issue #158: colliding and skewed clocks cannot blur key validity boundaries for real signed events', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
  });

  // Phase 1 — bv1 event at the frozen instant T0.
  useKeyVersion('bv1');
  const e1 = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'first bv1 event' });
  assert.equal(Date.parse(e1.timestamp), T0);

  // An authorized bv1 signing check happens BEFORE any rotation; its event row will
  // only be persisted afterwards (in-flight write).
  const inflightKey = await getOrCreateKeypair(SIGNER);
  const tInflight = inflightKey.eventTimestamp;
  assert.equal(Date.parse(tInflight), T0 + 1, 'same-millisecond check advances the DB watermark');

  // Phase 2 — rotate to bv2 with the host clock STILL frozen on T0.
  useKeyVersion('bv2');
  const e2 = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'bv2 event, colliding clock' });
  const t2 = e2.timestamp;
  assert.equal(Date.parse(t2), T0 + 2, 'rotation boundary is strictly after every authorized check despite clock collision');

  const k1 = db.public_keys.find((r) => r.key_version === 'bv1' && r.status === 'REVOKED');
  const k2 = db.public_keys.find((r) => r.key_version === 'bv2');
  assert.ok(k1 && k2);
  assert.equal(k1.revoked_at, t2, 'old key validity ends exactly at the rotation boundary');
  assert.equal(k2.created_at, t2, 'new key validity begins exactly at the rotation boundary');

  // Persist the in-flight bv1 event AFTER the rotation, timestamped at its own
  // pre-rotation authorized check.
  const lastHash = db.blockchain_events[db.blockchain_events.length - 1].current_hash;
  const inflightPayload = { mechanicId: SIGNER, note: 'bv1 in-flight write persisted after rotation' };
  const inflightHash = calculateHash(lastHash, VIN, 'Mechanic Inspection', tInflight, inflightPayload);
  const inflightSigned = signLedgerHash(SIGNER, inflightHash, { version: 'bv1' });
  assert.equal(inflightSigned.publicKeyPem, k1.public_key_pem);
  db.blockchain_events.push({
    id: ++eventSeq,
    previous_hash: lastHash,
    current_hash: inflightHash,
    vin: VIN,
    event_type: 'Mechanic Inspection',
    payload: JSON.stringify(inflightPayload),
    timestamp: tInflight,
    signature: `${SIGNER}:${inflightSigned.signatureHex}`,
  });

  // Phase 3 — roll back to bv1 while the host clock is skewed BACKWARDS a minute.
  stubClockMs = T0 - 60_000;
  useKeyVersion('bv1');
  const e3 = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'bv1 rollback, backwards clock' });
  assert.equal(Date.parse(e3.timestamp), T0 + 3, 'a backwards host clock cannot fold the boundary back');

  const k3 = db.public_keys.find((r) => r.key_version === 'bv1' && r.status === 'ACTIVE');
  assert.ok(k3, 'rollback creates a fresh incarnation');
  assert.notEqual(k3.id, k1.id, 'the historical bv1 row is never reused');
  assert.equal(k2.revoked_at, e3.timestamp);
  assert.equal(k3.created_at, e3.timestamp);
  assert.equal(k1.revoked_at, t2, 'historical validity intervals are preserved');

  // The full chain — including the boundary-instant bv2 event and the in-flight
  // bv1 event persisted after rotation — verifies with real ECDSA.
  const verified = await verifyChain(VIN);
  assert.equal(verified.verified, true, verified.reason || 'chain must verify');
  assert.equal(verified.count, 4);
  assert.ok(verified.chain.every((entry) => !entry.note), 'every signature must bind to exactly one eligible key');

  // Half-open partition: at every event instant exactly ONE key incarnation is
  // eligible — including t2, where the old key ends and the new key begins.
  for (const ts of [T0, T0 + 1, T0 + 2, T0 + 3]) {
    const eligible = db.public_keys.filter((key) => {
      const created = Date.parse(key.created_at);
      const revoked = key.revoked_at ? Date.parse(key.revoked_at) : Number.POSITIVE_INFINITY;
      return created <= ts && ts < revoked;
    });
    assert.equal(eligible.length, 1, `exactly one key must own instant ${new Date(ts).toISOString()}`);
  }

  // A forgery signed with the SUPERSEDED key exactly on the rotation boundary must
  // fail verification: the boundary instant belongs to the new key alone.
  const tailHash = db.blockchain_events[db.blockchain_events.length - 1].current_hash;
  const forgedPayload = { mechanicId: SIGNER, note: 'old key forgery at the boundary instant' };
  const forgedHash = calculateHash(tailHash, VIN, 'Mechanic Inspection', t2, forgedPayload);
  const forgedSigned = signLedgerHash(SIGNER, forgedHash, { version: 'bv1' });
  db.blockchain_events.push({
    id: ++eventSeq,
    previous_hash: tailHash,
    current_hash: forgedHash,
    vin: VIN,
    event_type: 'Mechanic Inspection',
    payload: JSON.stringify(forgedPayload),
    timestamp: t2,
    signature: `${SIGNER}:${forgedSigned.signatureHex}`,
  });

  const forged = await verifyChain(VIN);
  assert.equal(forged.verified, false, 'old-key signature at the boundary instant must be rejected');
  assert.match(forged.reason, /Invalid signature/);

  db.blockchain_events.pop();
  const clean = await verifyChain(VIN);
  assert.equal(clean.verified, true);
});

test('Issue #158: a revoked key does not own its own revocation instant', async () => {
  // Behavioural half-open proof that does not depend on a successor key winning a sort:
  // when a key is revoked with NO successor, an event stamped at exactly revoked_at must
  // NOT be honoured by that key. Under inclusive [created_at, revoked_at] semantics the
  // revoked key would still verify it.
  const VIN2 = 'VINREVOKEDEDGE001';
  const signer = 'revoked-edge-signer';
  const created = '2026-08-29T04:00:00.000Z';
  const revoked = '2026-08-29T05:00:00.000Z';

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'rv1';
  const key = deriveStakeholderKey(signer);
  db.public_keys.push({
    id: 'key-revoked-no-successor',
    user_id: signer,
    public_key_pem: key.publicKeyPem,
    key_type: 'secp256k1',
    status: 'REVOKED',
    created_at: created,
    revoked_at: revoked,
    key_ref: key.keyRef,
    key_version: 'rv1',
    custody_provider: key.custodyProvider,
  });

  const payloadInside = { mechanicId: signer, note: 'inside the validity interval' };
  const insideAt = '2026-08-29T04:30:00.000Z';
  const insideHash = calculateHash(GENESIS_HASH, VIN2, 'Mechanic Inspection', insideAt, payloadInside);
  const insideSig = signLedgerHash(signer, insideHash);
  db.blockchain_events.push({
    id: ++eventSeq,
    previous_hash: GENESIS_HASH,
    current_hash: insideHash,
    vin: VIN2,
    event_type: 'Mechanic Inspection',
    payload: JSON.stringify(payloadInside),
    timestamp: insideAt,
    signature: `${signer}:${insideSig.signatureHex}`,
  });

  const payloadEdge = { mechanicId: signer, note: 'exactly at the revocation instant' };
  const edgeHash = calculateHash(insideHash, VIN2, 'Mechanic Inspection', revoked, payloadEdge);
  const edgeSig = signLedgerHash(signer, edgeHash);
  db.blockchain_events.push({
    id: ++eventSeq,
    previous_hash: insideHash,
    current_hash: edgeHash,
    vin: VIN2,
    event_type: 'Mechanic Inspection',
    payload: JSON.stringify(payloadEdge),
    timestamp: revoked,
    signature: `${signer}:${edgeSig.signatureHex}`,
  });

  const result = await verifyChain(VIN2);
  assert.equal(result.count, 2);
  // The event strictly inside the interval is cryptographically verified.
  assert.ok(!result.chain[0].note, 'an event inside the validity interval must verify');
  // The event ON the revocation instant is outside the half-open interval: the revoked
  // key must not be selected for it.
  assert.equal(
    result.chain[1].note,
    'PUBLIC_KEY_RECORD_POSTDATES_OR_EXCLUDES_EVENT',
    'a revoked key must not own its revocation instant',
  );
});

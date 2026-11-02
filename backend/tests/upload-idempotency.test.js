/**
 * Workstream G — backend upload idempotency tests (node --test). (#208's version, ported by OC-5C with
 * its double switched to the two parameterized reads.)
 *
 * J-2: the collision domain is (ACTOR, key), so every call here supplies the acting user — a raw
 * client key on its own identifies no operation safely. The final test pins the deliberate
 * fail-open when a key arrives with no actor to scope it to.
 *
 * Proves: same idempotencyKey + same actor ⇒ same evidence id and createFn runs ONCE;
 * different keys ⇒ distinct ids; sequential "concurrent-ish" retries dedupe;
 * the Supabase-metadata fallback finds a prior row (warming the in-memory cache);
 * and a missing key fails open (always creates).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withUploadIdempotency,
  lookupBySupabase,
  __clearUploadIdempotencyStore,
  idempotencyScopeKey,
} from '../services/evidence/uploadIdempotency.js';

/** The acting user. A client-supplied key only identifies an operation within its actor. */
const ACTOR = 'actor-1';

/**
 * Minimal in-memory supabase-like mock supporting exactly what the service uses (OC-5C): two
 * PARAMETERIZED reads — `.eq('uploaded_by', actor).eq('idempotency_key', key)` for the canonical column,
 * then `.eq('uploaded_by', actor).eq('metadata->>idempotency_key', key)` for the mirror — resolved via a
 * thenable over a shared `rows` array. There is no `.or()`: #208 pasted the client key into PostgREST
 * filter syntax there, and this double refuses a lookup that is not actor-scoped.
 */
function makeSupabaseMock(rows) {
  function chain() {
    const state = { column: null, filterKey: null, actorId: undefined };
    const obj = {
      select() { return obj; },
      eq(col, val) {
        if (col === 'idempotency_key' || col === 'metadata->>idempotency_key') { state.column = col; state.filterKey = val; }
        // J-2: the lookup is actor-scoped, so the double must apply that filter too — a mock that
        // ignores it would let an unscoped (leaking) lookup pass as if it were correct.
        if (col === 'uploaded_by') state.actorId = val;
        return obj;
      },
      limit() { return obj; },
      then(resolve) {
        if (state.actorId === undefined) {
          return resolve({ data: null, error: { message: 'lookup was not actor-scoped' } });
        }
        const matched = rows.filter((r) => (
          (r.uploaded_by ?? state.actorId) === state.actorId
          && (state.column === 'idempotency_key'
            ? r.idempotency_key === state.filterKey
            : Boolean(r.metadata) && r.metadata.idempotency_key === state.filterKey)
        )).map((r) => ({ uploaded_by: state.actorId, ...r }));
        return resolve({ data: matched, error: null });
      },
    };
    return obj;
  }
  return { from: () => chain() };
}

test('same idempotency key returns the same evidence id and never creates a duplicate', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let creations = 0;
  const createFn = async () => {
    creations += 1;
    return { id: `ev-${creations}`, vin: 'VINSAME' };
  };

  const first = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store, actorId: ACTOR });
  const second = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store, actorId: ACTOR });
  const third = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store, actorId: ACTOR });

  assert.equal(first.evidenceId, 'ev-1');
  assert.equal(second.evidenceId, 'ev-1');
  assert.equal(third.evidenceId, 'ev-1');
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(third.deduped, true);
  assert.equal(creations, 1, 'createFn must run exactly once for a repeated key');
});

test('different idempotency keys create distinct evidence ids', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let counter = 0;
  const createFn = async () => ({ id: `ev-${++counter}`, vin: 'VIN1' });

  const a = await withUploadIdempotency('key-1', 'VIN1', createFn, { store, actorId: ACTOR });
  const b = await withUploadIdempotency('key-2', 'VIN1', createFn, { store, actorId: ACTOR });
  const c = await withUploadIdempotency('key-3', 'VIN1', createFn, { store, actorId: ACTOR });

  assert.notEqual(a.evidenceId, b.evidenceId);
  assert.notEqual(b.evidenceId, c.evidenceId);
  assert.equal(counter, 3, 'three distinct keys ⇒ three creations');
});

test('concurrent-ish (sequential) retries of one capture dedupe to a single record', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let creations = 0;
  const createFn = async () => {
    // simulate async work
    await Promise.resolve();
    creations += 1;
    return { id: `ev-retry-${creations}`, vin: 'VINRETRY' };
  };

  // Five retries of the SAME capture, awaited in sequence (the single-node gateway
  // processes requests serially) — only the first should create.
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(await withUploadIdempotency('retry-key', 'VINRETRY', createFn, { store, actorId: ACTOR }));
  }

  const ids = new Set(results.map((r) => r.evidenceId));
  assert.equal(ids.size, 1, 'all retries collapse to one evidence id');
  assert.equal([...ids][0], 'ev-retry-1');
  assert.equal(creations, 1);
  assert.equal(results.filter((r) => r.deduped).length, 4);
});

test('supabase metadata fallback finds a prior evidence row and warms the cache', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  // A row already exists in the DB (e.g. created before a process restart).
  const rows = [
    { id: 'ev-existing-9', vin: 'VINDB', metadata: { idempotency_key: 'db-key' } },
  ];
  const supabase = makeSupabaseMock(rows);

  // Direct lookup helper works.
  const found = await lookupBySupabase(supabase, 'db-key', { actorId: ACTOR });
  assert.equal(found.evidenceId, 'ev-existing-9');
  assert.equal(found.vin, 'VINDB');
  // K2 — the hit carries the canonical operation identity so a re-used key can be compared against
  // the upload it was first used for, not merely against the vehicle.
  // OC-5C: the STORED row's checksum provenance is never read back — whether a checksum may outrank
  // the location is decided from the CURRENT request (inline bytes), so the hit carries no
  // `checksum_source` at all (#208 read one out of client-writable metadata).
  assert.deepEqual(Object.keys(found.operation).sort(),
    ['checksum', 'evidence_class', 'evidence_subtype', 'evidence_type', 'remote_ref'],
    'L1 added the remote reference; no stored provenance is part of a hit');

  // Through the guard: createFn must NOT run because the DB already has it.
  let creations = 0;
  const createFn = async () => { creations += 1; return { id: 'should-not-happen' }; };
  const res = await withUploadIdempotency('db-key', 'VINDB', createFn, { store, supabase, actorId: ACTOR });

  assert.equal(res.evidenceId, 'ev-existing-9');
  assert.equal(res.deduped, true);
  assert.equal(creations, 0, 'existing DB row must short-circuit creation');
  assert.equal(store.get(idempotencyScopeKey(ACTOR, 'db-key')).evidenceId, 'ev-existing-9', 'cache warmed from DB, under the ACTOR-scoped key');
});

test('a brand-new key with a supabase miss creates once and records the mapping', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  const rows = []; // empty DB
  const supabase = makeSupabaseMock(rows);

  let creations = 0;
  const createFn = async () => { creations += 1; return { id: 'ev-fresh', vin: 'VINFRESH' }; };

  const res = await withUploadIdempotency('fresh-key', 'VINFRESH', createFn, { store, supabase, actorId: ACTOR });
  assert.equal(res.evidenceId, 'ev-fresh');
  assert.equal(res.deduped, false);
  assert.equal(creations, 1);

  // Second call now hits the warmed cache, not createFn.
  const again = await withUploadIdempotency('fresh-key', 'VINFRESH', createFn, { store, supabase, actorId: ACTOR });
  assert.equal(again.evidenceId, 'ev-fresh');
  assert.equal(again.deduped, true);
  assert.equal(creations, 1);
});

test('missing idempotency key fails open and always creates (never blocks upload)', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let creations = 0;
  const createFn = async () => ({ id: `ev-open-${++creations}`, vin: 'VINOPEN' });

  const a = await withUploadIdempotency(null, 'VINOPEN', createFn, { store, actorId: ACTOR });
  const b = await withUploadIdempotency(undefined, 'VINOPEN', createFn, { store, actorId: ACTOR });
  const c = await withUploadIdempotency('', 'VINOPEN', createFn, { store, actorId: ACTOR });

  assert.equal(creations, 3, 'no key ⇒ each upload is treated as unique');
  assert.notEqual(a.evidenceId, b.evidenceId);
  assert.notEqual(b.evidenceId, c.evidenceId);
  assert.equal(a.deduped, false);
});

test('createFn returning a bare id string is supported', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  const res = await withUploadIdempotency('str-key', 'VINSTR', async () => 'ev-string-id', { store, actorId: ACTOR });
  assert.equal(res.evidenceId, 'ev-string-id');
  const again = await withUploadIdempotency('str-key', 'VINSTR', async () => 'ev-other', { store, actorId: ACTOR });
  assert.equal(again.evidenceId, 'ev-string-id');
  assert.equal(again.deduped, true);
});

test('J-2: a key with NO actor to scope it to fails OPEN rather than deduping globally', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let creations = 0;
  const createFn = async () => ({ id: `ev-noactor-${++creations}`, vin: 'VINX' });

  const a = await withUploadIdempotency('shared-key', 'VINX', createFn, { store });
  const b = await withUploadIdempotency('shared-key', 'VINX', createFn, { store });

  assert.equal(creations, 2, 'an unscoped key must never be deduplicated across an unknown namespace');
  assert.notEqual(a.evidenceId, b.evidenceId);
  assert.equal(b.deduped, false);
});

test('J-2: two ACTORS sharing one raw key never see each other\'s evidence', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  const rows = [{ id: 'ev-mine', vin: 'VIN-A', uploaded_by: ACTOR, idempotency_key: 'SHARED' }];
  const supabase = makeSupabaseMock(rows);

  const mine = await withUploadIdempotency('SHARED', 'VIN-A', async () => ({ id: 'unused' }), { store, supabase, actorId: ACTOR });
  assert.equal(mine.evidenceId, 'ev-mine');
  assert.equal(mine.deduped, true);

  let created = 0;
  const theirs = await withUploadIdempotency('SHARED', 'VIN-B', async () => { created += 1; return { id: 'ev-theirs', vin: 'VIN-B' }; },
    { store, supabase, actorId: 'actor-2' });
  assert.equal(created, 1, 'the second actor is not suppressed by the first actor\'s key');
  assert.equal(theirs.evidenceId, 'ev-theirs');
  assert.equal(theirs.deduped, false);
});

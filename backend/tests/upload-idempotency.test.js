/**
 * Workstream G — backend upload idempotency tests (node --test).
 *
 * Proves: same idempotencyKey ⇒ same evidence id and createFn runs ONCE;
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
} from '../services/evidence/uploadIdempotency.js';

/**
 * Minimal in-memory supabase-like mock supporting exactly what the service uses:
 * from('vehicle_evidence').select(...).eq('metadata->>idempotency_key', key).limit(n)
 * resolved via a thenable. Backed by a shared `rows` array the test controls.
 */
function makeSupabaseMock(rows) {
  function chain() {
    const state = { filterKey: null };
    const obj = {
      select() { return obj; },
      eq(col, val) {
        if (col === 'metadata->>idempotency_key') state.filterKey = val;
        return obj;
      },
      limit() { return obj; },
      then(resolve) {
        const matched = rows.filter(
          (r) => r.metadata && r.metadata.idempotency_key === state.filterKey,
        );
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

  const first = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store });
  const second = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store });
  const third = await withUploadIdempotency('key-A', 'VINSAME', createFn, { store });

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

  const a = await withUploadIdempotency('key-1', 'VIN1', createFn, { store });
  const b = await withUploadIdempotency('key-2', 'VIN1', createFn, { store });
  const c = await withUploadIdempotency('key-3', 'VIN1', createFn, { store });

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
    results.push(await withUploadIdempotency('retry-key', 'VINRETRY', createFn, { store }));
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
  const found = await lookupBySupabase(supabase, 'db-key');
  assert.deepEqual(found, { evidenceId: 'ev-existing-9', vin: 'VINDB' });

  // Through the guard: createFn must NOT run because the DB already has it.
  let creations = 0;
  const createFn = async () => { creations += 1; return { id: 'should-not-happen' }; };
  const res = await withUploadIdempotency('db-key', 'VINDB', createFn, { store, supabase });

  assert.equal(res.evidenceId, 'ev-existing-9');
  assert.equal(res.deduped, true);
  assert.equal(creations, 0, 'existing DB row must short-circuit creation');
  assert.equal(store.get('db-key').evidenceId, 'ev-existing-9', 'cache warmed from DB');
});

test('a brand-new key with a supabase miss creates once and records the mapping', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  const rows = []; // empty DB
  const supabase = makeSupabaseMock(rows);

  let creations = 0;
  const createFn = async () => { creations += 1; return { id: 'ev-fresh', vin: 'VINFRESH' }; };

  const res = await withUploadIdempotency('fresh-key', 'VINFRESH', createFn, { store, supabase });
  assert.equal(res.evidenceId, 'ev-fresh');
  assert.equal(res.deduped, false);
  assert.equal(creations, 1);

  // Second call now hits the warmed cache, not createFn.
  const again = await withUploadIdempotency('fresh-key', 'VINFRESH', createFn, { store, supabase });
  assert.equal(again.evidenceId, 'ev-fresh');
  assert.equal(again.deduped, true);
  assert.equal(creations, 1);
});

test('missing idempotency key fails open and always creates (never blocks upload)', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  let creations = 0;
  const createFn = async () => ({ id: `ev-open-${++creations}`, vin: 'VINOPEN' });

  const a = await withUploadIdempotency(null, 'VINOPEN', createFn, { store });
  const b = await withUploadIdempotency(undefined, 'VINOPEN', createFn, { store });
  const c = await withUploadIdempotency('', 'VINOPEN', createFn, { store });

  assert.equal(creations, 3, 'no key ⇒ each upload is treated as unique');
  assert.notEqual(a.evidenceId, b.evidenceId);
  assert.notEqual(b.evidenceId, c.evidenceId);
  assert.equal(a.deduped, false);
});

test('createFn returning a bare id string is supported', async () => {
  __clearUploadIdempotencyStore();
  const store = new Map();
  const res = await withUploadIdempotency('str-key', 'VINSTR', async () => 'ev-string-id', { store });
  assert.equal(res.evidenceId, 'ev-string-id');
  const again = await withUploadIdempotency('str-key', 'VINSTR', async () => 'ev-other', { store });
  assert.equal(again.evidenceId, 'ev-string-id');
  assert.equal(again.deduped, true);
});

/**
 * CA-OWNER-02-R3 (D3) — the shared Corporate management snapshot: fresh for 60 s, then served from the last valid read while
 * ONE background refresh runs, and never older than its maximum age. Every answer says how old it is and whether a refresh
 * is running, so a page can state it — a stale snapshot is never presented as a fresh one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createSnapshotCache } = await import('../services/corporate/management/managementSnapshotCache.js');

function clock(start = Date.parse('2026-10-18T00:00:00.000Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const flush = () => new Promise((r) => setImmediate(r));

function harness() {
  const c = clock();
  const computations = [];
  const kept = [];
  const cache = createSnapshotCache({
    compute: (key) => { const d = deferred(); computations.push({ key, d, startedAt: c.now() }); return d.promise; },
    ttlMs: 60_000, maxStaleMs: 600_000, now: c.now, keepAlive: (p) => kept.push(p),
  });
  const snap = (n) => ({ n, now: new Date(c.now()) });
  return { c, computations, kept, cache, snap };
}

test('cold: the first request computes the snapshot; concurrent requests share the one computation', async () => {
  const { computations, cache, snap } = harness();
  const a = cache.get('staging');
  const b = cache.get('staging');
  assert.equal(computations.length, 1);
  computations[0].d.resolve(snap(1));
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.value.n, 1);
  assert.equal(rb.value.n, 1);
  assert.deepEqual({ stale: ra.meta.stale, refreshing: ra.meta.refreshing }, { stale: false, refreshing: false });
});

test('warm: within 60 s the cached snapshot is served at once, with its age', async () => {
  const { c, computations, cache, snap } = harness();
  const first = cache.get('staging');
  computations[0].d.resolve(snap(1));
  await first;
  c.advance(30_000);
  const warm = await cache.get('staging');
  assert.equal(computations.length, 1, 'no recomputation inside the TTL');
  assert.equal(warm.meta.ageMs, 30_000);
  assert.equal(warm.meta.stale, false);
});

test('stale: after 60 s the last valid snapshot is served at once while ONE refresh runs in the background, kept alive', async () => {
  const { c, computations, kept, cache, snap } = harness();
  const first = cache.get('staging');
  computations[0].d.resolve(snap(1));
  await first;
  c.advance(90_000);
  const stale = await cache.get('staging');
  assert.equal(stale.value.n, 1);
  assert.deepEqual({ stale: stale.meta.stale, refreshing: stale.meta.refreshing, ageMs: stale.meta.ageMs }, { stale: true, refreshing: true, ageMs: 90_000 });
  await cache.get('staging');
  assert.equal(computations.length, 2, 'one background refresh, not one per request');
  assert.equal(kept.length, 1, 'the refresh is handed to the runtime to keep alive past the response');
  computations[1].d.resolve(snap(2));
  await flush();
  const fresh = await cache.get('staging');
  assert.equal(fresh.value.n, 2);
  assert.deepEqual({ stale: fresh.meta.stale, refreshing: fresh.meta.refreshing }, { stale: false, refreshing: false });
});

test('a failed background refresh keeps the last valid snapshot (still marked stale) and the next request tries again', async () => {
  const { c, computations, cache, snap } = harness();
  const first = cache.get('staging');
  computations[0].d.resolve(snap(1));
  await first;
  c.advance(90_000);
  await cache.get('staging');
  computations[1].d.reject(new Error('read failed'));
  await flush();
  const after = await cache.get('staging');
  assert.equal(after.value.n, 1);
  assert.equal(after.meta.stale, true);
  assert.equal(computations.length, 3, 'a new refresh is started after the failed one');
});

test('too old: past the maximum age the snapshot is not served — the request waits for a new read', async () => {
  const { c, computations, cache, snap } = harness();
  const first = cache.get('staging');
  computations[0].d.resolve(snap(1));
  await first;
  c.advance(700_000);
  const pending = cache.get('staging');
  let settled = false;
  pending.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, 'an over-age snapshot is never handed out');
  computations[1].d.resolve(snap(2));
  const result = await pending;
  assert.equal(result.value.n, 2);
  assert.equal(result.meta.stale, false);
});

test('a snapshot for one host is never served for another', async () => {
  const { computations, cache, snap } = harness();
  const a = cache.get('carup-backend-staging-a');
  computations[0].d.resolve(snap(1));
  await a;
  const b = cache.get('carup-backend-staging-b');
  assert.equal(computations.length, 2);
  assert.equal(computations[1].key, 'carup-backend-staging-b');
  computations[1].d.resolve(snap(2));
  assert.equal((await b).value.n, 2);
});

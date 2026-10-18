/**
 * CA-OWNER-02-R3 (D3) — a slow source read at most once per TTL and waited for at most a budget per request.
 *
 * Measured on staging: get_communication_scheduler_health() scans cron.job_run_details (178,835 rows, 264 MB) three times,
 * so one read can take longer than the whole Corporate read budget. The database function cannot be changed in this lane,
 * so the APPLICATION bounds how often it is read and how long a page waits for it — and never invents a value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createBoundedSource, BoundedSourcePending } = await import('../services/corporate/management/boundedSource.js');

function clock(start = Date.parse('2026-10-18T00:00:00.000Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test('a fresh value is served from the cache: the slow source is read once per TTL, with its own read time', async () => {
  const c = clock();
  let reads = 0;
  const source = createBoundedSource(async () => { reads += 1; return { ok: reads }; }, { ttlMs: 300_000, budgetMs: 50, now: c.now });
  const first = await source.get();
  assert.deepEqual(first.value, { ok: 1 });
  assert.equal(first.readAt.toISOString(), '2026-10-18T00:00:00.000Z');
  c.advance(120_000);
  const second = await source.get();
  assert.deepEqual(second.value, { ok: 1 }, 'within the TTL nothing is re-read');
  assert.equal(second.readAt.toISOString(), '2026-10-18T00:00:00.000Z', 'the value keeps the time it was really read');
  assert.equal(reads, 1);
});

test('a read slower than the budget does not hold the caller — it finishes in the background and fills the cache', async () => {
  const c = clock();
  const slow = deferred();
  const source = createBoundedSource(() => slow.promise, { ttlMs: 300_000, budgetMs: 20, now: c.now });
  await assert.rejects(source.get(), (err) => err instanceof BoundedSourcePending, 'no value yet: the caller is told the read is still running');
  c.advance(5_000);
  slow.resolve({ healthy: true });
  await new Promise((r) => setImmediate(r));
  const later = await source.get();
  assert.deepEqual(later.value, { healthy: true });
  assert.equal(later.readAt.toISOString(), '2026-10-18T00:00:05.000Z', 'the read time is when the read completed');
});

test('after the TTL a slow re-read serves the last value with its old read time — only within the maximum age — and is never duplicated', async () => {
  const c = clock();
  let calls = 0;
  let next = deferred();
  const source = createBoundedSource(() => { calls += 1; return next.promise; }, { ttlMs: 300_000, budgetMs: 20, maxAgeMs: 1_800_000, now: c.now });
  const first = source.get();
  next.resolve({ run: 1 });
  assert.deepEqual((await first).value, { run: 1 });
  next = deferred();
  c.advance(400_000); // past the TTL
  const stale = await source.get();
  assert.deepEqual(stale.value, { run: 1 });
  assert.equal(stale.refreshing, true);
  assert.equal(stale.readAt.toISOString(), '2026-10-18T00:00:00.000Z');
  await source.get();
  assert.equal(calls, 2, 'one re-read in flight at a time');
  c.advance(1_500_000); // now older than the maximum age, and the re-read still has not finished
  await assert.rejects(source.get(), (err) => err instanceof BoundedSourcePending, 'too old to serve: no value rather than a stale one');
});

test('a failed read is never cached as a value and never an unhandled rejection; the next request tries again', async () => {
  const c = clock();
  let calls = 0;
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const source = createBoundedSource(async () => { calls += 1; if (calls === 1) throw new Error('rpc failed'); return { ok: true }; }, { ttlMs: 300_000, budgetMs: 50, now: c.now });
    await assert.rejects(source.get(), /rpc failed/);
    const second = await source.get();
    assert.deepEqual(second.value, { ok: true });
    assert.equal(calls, 2);
    // A background read that fails after the caller stopped waiting must not crash the process.
    const late = deferred();
    const lateSource = createBoundedSource(() => late.promise, { ttlMs: 300_000, budgetMs: 5, now: c.now });
    await assert.rejects(lateSource.get(), (err) => err instanceof BoundedSourcePending);
    late.reject(new Error('late failure'));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

/**
 * Milestone 6 — Pluggable rate-limit store tests.
 *
 * Exercises the default in-memory store directly: window counting, limit
 * enforcement semantics, window rollover/reset, and the createRateLimitStore
 * factory fallback behavior (REDIS_URL without an injected client -> in-memory).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitStore,
} = await import('../middleware/rateLimitStore.js');

test('in-memory store counts hits within a window', async () => {
  const store = new InMemoryRateLimitStore();
  const a = await store.hit('ip-1', 1000);
  const b = await store.hit('ip-1', 1000);
  const c = await store.hit('ip-1', 1000);
  assert.equal(a.count, 1);
  assert.equal(b.count, 2);
  assert.equal(c.count, 3);
  // windowStart stays stable within the window
  assert.equal(a.windowStart, c.windowStart);
});

test('in-memory store isolates counts per key', async () => {
  const store = new InMemoryRateLimitStore();
  await store.hit('ip-a', 1000);
  await store.hit('ip-a', 1000);
  const b = await store.hit('ip-b', 1000);
  assert.equal(b.count, 1);
});

test('limit enforcement: count crosses a max threshold deterministically', async () => {
  const store = new InMemoryRateLimitStore();
  const max = 3;
  let blocked = 0;
  let allowed = 0;
  for (let i = 0; i < 5; i++) {
    const { count } = await store.hit('client', 60000);
    if (count > max) blocked++;
    else allowed++;
  }
  assert.equal(allowed, 3); // hits 1,2,3 allowed
  assert.equal(blocked, 2); // hits 4,5 blocked
});

test('window rollover resets the counter when the window elapses', async () => {
  const store = new InMemoryRateLimitStore();
  const windowMs = 50;
  const first = await store.hit('roller', windowMs);
  assert.equal(first.count, 1);
  await store.hit('roller', windowMs);
  // Wait for the window to fully elapse.
  await new Promise((r) => setTimeout(r, windowMs + 20));
  const afterRollover = await store.hit('roller', windowMs);
  assert.equal(afterRollover.count, 1, 'counter resets in a fresh window');
  assert.ok(afterRollover.windowStart > first.windowStart);
});

test('explicit reset(key) clears a single key', async () => {
  const store = new InMemoryRateLimitStore();
  await store.hit('k', 1000);
  await store.hit('k', 1000);
  await store.reset('k');
  const after = await store.hit('k', 1000);
  assert.equal(after.count, 1);
});

test('clear() drops all keys', async () => {
  const store = new InMemoryRateLimitStore();
  await store.hit('x', 1000);
  await store.hit('y', 1000);
  await store.clear();
  assert.equal((await store.hit('x', 1000)).count, 1);
  assert.equal((await store.hit('y', 1000)).count, 1);
});

test('sweep evicts only keys older than maxAge', async () => {
  const store = new InMemoryRateLimitStore();
  await store.hit('stale', 10);
  await new Promise((r) => setTimeout(r, 30));
  await store.hit('fresh', 10);
  store.sweep(20);
  // 'stale' opened >20ms ago -> evicted (counter restarts at 1)
  assert.equal((await store.hit('stale', 10)).count, 1);
  // 'fresh' opened recently -> retained (counter continues)
  assert.equal((await store.hit('fresh', 10)).count, 2);
});

test('createRateLimitStore defaults to in-memory when REDIS_URL is unset', () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const store = createRateLimitStore();
    assert.ok(store instanceof InMemoryRateLimitStore);
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
  }
});

test('createRateLimitStore falls back to in-memory when REDIS_URL set but no client injected', () => {
  let warned = false;
  const store = createRateLimitStore({
    redisUrl: 'redis://localhost:6379',
    warn: () => { warned = true; },
  });
  assert.ok(store instanceof InMemoryRateLimitStore);
  assert.ok(warned, 'a fallback warning is emitted');
});

test('createRateLimitStore uses a Redis store when a client is injected', async () => {
  // Minimal fake redis client implementing the command surface the store uses.
  const data = new Map();
  const fakeRedis = {
    async incr(k) { const n = (data.get(k) || 0) + 1; data.set(k, n); return n; },
    async set(k, v) { data.set(k, v); },
    async get(k) { return data.has(k) ? String(data.get(k)) : null; },
    async pexpire() { /* no-op for the fake */ },
    async del(k) { data.delete(k); },
  };
  const store = createRateLimitStore({
    redisUrl: 'redis://localhost:6379',
    redisClient: fakeRedis,
  });
  assert.ok(store instanceof RedisRateLimitStore);
  const a = await store.hit('rk', 1000);
  const b = await store.hit('rk', 1000);
  assert.equal(a.count, 1);
  assert.equal(b.count, 2);
  assert.equal(a.windowStart, b.windowStart);
});

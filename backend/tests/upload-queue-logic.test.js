/**
 * Workstream G — PURE upload-queue logic tests (node --test).
 *
 * These import the dependency-free logic module that the RN Zustand store
 * (mobile/store/uploadQueueStore.ts) also uses, so the durable-queue invariants
 * are proven here without a React Native runtime:
 *   - computeIdempotencyKey is deterministic AND collision-free across distinct
 *     inputs (incl. delimiter-injection attempts that could otherwise alias)
 *   - nextBackoffMs grows exponentially and caps
 *   - selectReady respects nextRetryAt + status
 *   - isAccountOwned / filterOwned isolate by userId+tenantId
 *   - hasLiveItemForKey blocks a duplicate live capture (clearForLogout empties is
 *     asserted at the store level; here we prove the predicate it relies on)
 *
 * The .js logic module is intentionally plain JS so `node --test` can import it
 * directly (no TS loader is configured for the backend test runner).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdempotencyKey,
  nextBackoffMs,
  selectReady,
  isAccountOwned,
  filterOwned,
  hasLiveItemForKey,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
} from '../../mobile/utils/uploadQueueLogic.js';

const base = { userId: 'u1', vin: 'VIN1', evidenceType: 'odometer_photo', checksum: 'abc123' };

test('computeIdempotencyKey is deterministic for identical inputs', () => {
  const k1 = computeIdempotencyKey(base);
  const k2 = computeIdempotencyKey({ ...base });
  assert.equal(k1, k2);
  assert.match(k1, /^uq_[0-9a-f]{8}_u1_VIN1$/);
});

test('computeIdempotencyKey differs when any identity field changes', () => {
  const k = computeIdempotencyKey(base);
  assert.notEqual(k, computeIdempotencyKey({ ...base, userId: 'u2' }));
  assert.notEqual(k, computeIdempotencyKey({ ...base, vin: 'VIN2' }));
  assert.notEqual(k, computeIdempotencyKey({ ...base, evidenceType: 'damage_photo' }));
  assert.notEqual(k, computeIdempotencyKey({ ...base, checksum: 'def456' }));
});

test('computeIdempotencyKey resists delimiter-injection aliasing', () => {
  // Without escaping, ('a|b','c',...) and ('a','b|c',...) could join to the same
  // canonical string. The escape of '|' must keep them distinct.
  const a = computeIdempotencyKey({ userId: 'a|b', vin: 'c', evidenceType: 't', checksum: 's' });
  const b = computeIdempotencyKey({ userId: 'a', vin: 'b|c', evidenceType: 't', checksum: 's' });
  assert.notEqual(a, b);
});

test('computeIdempotencyKey has no collisions across a matrix of distinct inputs', () => {
  const seen = new Set();
  const users = ['u1', 'u2', 'u3'];
  const vins = ['VIN1', 'VIN2', 'VIN3'];
  const types = ['odometer_photo', 'damage_photo', 'registration_document'];
  const sums = ['c1', 'c2', 'c3'];
  let count = 0;
  for (const userId of users)
    for (const vin of vins)
      for (const evidenceType of types)
        for (const checksum of sums) {
          const key = computeIdempotencyKey({ userId, vin, evidenceType, checksum });
          assert.ok(!seen.has(key), `collision on ${key}`);
          seen.add(key);
          count += 1;
        }
  assert.equal(seen.size, count); // 3*3*3*3 = 81 unique keys
  assert.equal(count, 81);
});

test('nextBackoffMs grows exponentially from the base', () => {
  const now = 1_000_000;
  assert.equal(nextBackoffMs(0, now, DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS), now + DEFAULT_BASE_BACKOFF_MS);
  assert.equal(nextBackoffMs(1, now, DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS), now + DEFAULT_BASE_BACKOFF_MS * 2);
  assert.equal(nextBackoffMs(2, now, DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS), now + DEFAULT_BASE_BACKOFF_MS * 4);
  assert.equal(nextBackoffMs(3, now, DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS), now + DEFAULT_BASE_BACKOFF_MS * 8);
});

test('nextBackoffMs caps at maxMs and never goes infinite for huge retry counts', () => {
  const now = 0;
  const capped = nextBackoffMs(1000, now, DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS);
  assert.equal(capped, now + DEFAULT_MAX_BACKOFF_MS);
  assert.ok(Number.isFinite(capped));
  // A small custom cap is honored.
  assert.equal(nextBackoffMs(10, 0, 1000, 4000), 4000);
});

test('nextBackoffMs treats negative/garbage retryCount as 0', () => {
  const now = 500;
  assert.equal(nextBackoffMs(-5, now, 1000, 99999), now + 1000);
  assert.equal(nextBackoffMs(NaN, now, 1000, 99999), now + 1000);
});

test('selectReady returns queued/failed items whose nextRetryAt<=now', () => {
  const now = 10_000;
  const items = [
    { localId: 'a', status: 'queued', nextRetryAt: null },          // ready (no schedule)
    { localId: 'b', status: 'failed', nextRetryAt: 9_000 },         // ready (due)
    { localId: 'c', status: 'failed', nextRetryAt: 20_000 },        // NOT ready (future)
    { localId: 'd', status: 'uploading', nextRetryAt: null },       // NOT ready (in flight)
    { localId: 'e', status: 'uploaded', nextRetryAt: null },        // NOT ready (terminal)
    { localId: 'f', status: 'cancelled', nextRetryAt: null },       // NOT ready (terminal)
    { localId: 'g', status: 'queued', nextRetryAt: 10_000 },        // ready (exactly due)
  ];
  const ready = selectReady(items, now).map((i) => i.localId);
  assert.deepEqual(ready, ['a', 'b', 'g']);
});

test('selectReady preserves order and tolerates non-array input', () => {
  assert.deepEqual(selectReady(null, 1), []);
  assert.deepEqual(selectReady(undefined, 1), []);
  const items = [
    { localId: '1', status: 'queued', nextRetryAt: null },
    { localId: '2', status: 'queued', nextRetryAt: null },
  ];
  assert.deepEqual(selectReady(items, 1).map((i) => i.localId), ['1', '2']);
});

test('isAccountOwned isolates strictly by userId AND tenantId', () => {
  const item = { userId: 'uA', tenantId: 'tA' };
  assert.equal(isAccountOwned(item, 'uA', 'tA'), true);
  assert.equal(isAccountOwned(item, 'uB', 'tA'), false); // wrong user
  assert.equal(isAccountOwned(item, 'uA', 'tB'), false); // wrong tenant
  assert.equal(isAccountOwned(item, 'uB', 'tB'), false);
  assert.equal(isAccountOwned(null, 'uA', 'tA'), false);
});

test('filterOwned never leaks account A items to account B', () => {
  const items = [
    { localId: '1', userId: 'A', tenantId: 'tA' },
    { localId: '2', userId: 'B', tenantId: 'tB' },
    { localId: '3', userId: 'A', tenantId: 'tA' },
    { localId: '4', userId: 'A', tenantId: 'tB' }, // same user, different tenant
  ];
  const forA = filterOwned(items, 'A', 'tA').map((i) => i.localId);
  assert.deepEqual(forA, ['1', '3']);
  const forB = filterOwned(items, 'B', 'tB').map((i) => i.localId);
  assert.deepEqual(forB, ['2']);
  // Account B must see NONE of A's items.
  assert.equal(forB.includes('1'), false);
  assert.equal(forB.includes('3'), false);
});

test('hasLiveItemForKey blocks duplicate live captures but allows re-enqueue after terminal', () => {
  const key = computeIdempotencyKey(base);
  const queued = [{ idempotencyKey: key, status: 'queued' }];
  assert.equal(hasLiveItemForKey(queued, key), true);

  const uploading = [{ idempotencyKey: key, status: 'uploading' }];
  assert.equal(hasLiveItemForKey(uploading, key), true);

  const uploaded = [{ idempotencyKey: key, status: 'uploaded' }];
  assert.equal(hasLiveItemForKey(uploaded, key), true);

  // A cancelled-only row is NOT live → re-enqueue allowed.
  const cancelled = [{ idempotencyKey: key, status: 'cancelled' }];
  assert.equal(hasLiveItemForKey(cancelled, key), false);

  // Unknown key → not present.
  assert.equal(hasLiveItemForKey(queued, 'other-key'), false);
  // clearForLogout empties the queue → predicate over [] is false (proxy for empty store).
  assert.equal(hasLiveItemForKey([], key), false);
});

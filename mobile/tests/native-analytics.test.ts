/**
 * Native navigation analytics client — CSRF / flush tests.
 *
 * Pure, DB-free, import-only (no Expo/react-native runtime). Run with:
 *   npx tsx tests/native-analytics.test.ts
 * (matches how tests/native-navigation.test.ts runs).
 *
 * Proves the native analytics batch flush carries a session-bound CSRF token so
 * it survives the global csrfMiddleware (no more silent 403 drop), retries ONCE
 * on a 403 with a force-refreshed token (bounded), drops safely when the header
 * provider throws, clears its queue on a 202, and keeps `track()` sync/void.
 */
import { strict as assert } from 'node:assert';

// EXPO_PUBLIC_API_URL must resolve for apiUrl('/api/analytics/navigation').
process.env.EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.example.test';

import { NativeNavigationAnalytics } from '../utils/navigationAnalytics';

let PASSED = 0;
let FAILED = 0;
const FAILURES: { name: string; error: unknown }[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`[PASS] ${name}`);
      PASSED++;
    })
    .catch((error) => {
      console.error(`[FAIL] ${name}`);
      FAILED++;
      FAILURES.push({ name, error });
    });
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  method?: string;
}

/** A scriptable fake fetch that records calls and returns queued statuses. */
function makeFetch(statuses: number[]) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method });
    const status = statuses[Math.min(i, statuses.length - 1)];
    i++;
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const event = {
  event_type: 'navigation_item_selected' as const,
  surface: 'bottom_tabs' as const,
  feature_id: 'product.marketplace',
};

console.log('\n=== NATIVE ANALYTICS CSRF FLUSH TEST ===\n');

const run = async () => {
  // 1. Happy path: POST carries x-csrf-token + x-session-token; 202 clears queue.
  await test('flush POSTs with CSRF + session header and a 202 clears the queue', async () => {
    let headerCalls = 0;
    const { fetchImpl, calls } = makeFetch([202]);
    const a = new NativeNavigationAnalytics({
      fetchImpl,
      getHeaders: async (_force: boolean) => {
        headerCalls++;
        return {
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-abc',
          'x-session-token': 'sess-xyz',
        };
      },
    });
    a.track(event);
    assert.equal(a.pendingCount, 1, 'event should be queued');
    await a.flush();
    assert.equal(calls.length, 1, 'exactly one POST');
    assert.equal(calls[0].headers['x-csrf-token'], 'csrf-abc');
    assert.equal(calls[0].headers['x-session-token'], 'sess-xyz');
    assert.equal(calls[0].method, 'POST');
    assert.equal(headerCalls, 1, 'getHeaders called once (no refresh)');
    assert.equal(a.pendingCount, 0, '202 must clear the queue (not requeue)');
  });

  // 2. A 403 triggers a getHeaders(true) refresh + exactly one retry, then stops.
  await test('403 forces a CSRF refresh and ONE retry, then stops (bounded)', async () => {
    const forceFlags: boolean[] = [];
    const { fetchImpl, calls } = makeFetch([403, 403, 403]); // always 403
    const a = new NativeNavigationAnalytics({
      fetchImpl,
      getHeaders: async (force: boolean) => {
        forceFlags.push(force);
        return { 'Content-Type': 'application/json', 'x-csrf-token': force ? 'fresh' : 'stale' };
      },
    });
    a.track(event);
    await a.flush();
    // First POST (stale) → 403 → refresh(force=true) → second POST (fresh) → 403 → stop.
    assert.equal(calls.length, 2, 'exactly two POSTs (initial + one retry)');
    assert.equal(calls[0].headers['x-csrf-token'], 'stale');
    assert.equal(calls[1].headers['x-csrf-token'], 'fresh');
    assert.deepEqual(forceFlags, [false, true], 'one normal + one forced header build');
    assert.equal(a.pendingCount, 0, 'batch dropped after exhausting the 403 retry');
  });

  // 3. A header-provider throw drops the batch safely, no throw, no POST.
  await test('header-provider throw drops the batch without throwing or POSTing', async () => {
    const { fetchImpl, calls } = makeFetch([202]);
    const a = new NativeNavigationAnalytics({
      fetchImpl,
      getHeaders: async () => {
        throw new Error('csrf endpoint unreachable');
      },
    });
    a.track(event);
    // Must not throw.
    await a.flush();
    assert.equal(calls.length, 0, 'no POST attempted when headers cannot be built');
    assert.equal(a.pendingCount, 0, 'batch dropped (not requeued unboundedly)');
  });

  // 4. track() is synchronous and returns void (never blocks nav).
  await test('track() is sync/void and never throws', () => {
    const { fetchImpl } = makeFetch([202]);
    const a = new NativeNavigationAnalytics({ fetchImpl, getHeaders: async () => ({}) });
    const result = a.track(event);
    assert.equal(result, undefined, 'track returns void');
    assert.equal(a.pendingCount, 1);
  });

  // 5. Transient network failure retries within bounds, then drops (no CSRF refresh).
  await test('offline/transient failure retries up to bound then drops (no extra header build)', async () => {
    let headerCalls = 0;
    // fetchImpl throws (offline) every time.
    const calls: number[] = [];
    const fetchImpl = (async () => {
      calls.push(1);
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    const a = new NativeNavigationAnalytics({
      fetchImpl,
      getHeaders: async () => {
        headerCalls++;
        return { 'x-csrf-token': 'c' };
      },
    });
    a.track(event);
    await a.flush();
    // MAX_RETRIES = 2 ⇒ attempts 0,1,2 ⇒ 3 fetch attempts; headers built once.
    assert.equal(calls.length, 3, 'bounded retry: 3 attempts');
    assert.equal(headerCalls, 1, 'no CSRF refresh on transient failures');
    assert.equal(a.pendingCount, 0, 'dropped after exhausting retries');
  });
};

run().then(() => {
  console.log(`\n${PASSED} passed, ${FAILED} failed.`);
  if (FAILED > 0) {
    for (const f of FAILURES) {
      console.error(`\n--- ${f.name} ---`);
      console.error(f.error);
    }
    process.exit(1);
  }
  console.log('\nALL NATIVE ANALYTICS CSRF FLUSH TESTS PASSED');
});

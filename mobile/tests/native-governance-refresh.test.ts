/**
 * Feature governance store — clear-stale-state-on-identity-change tests.
 *
 * Pure, DB-free, import-only (no Expo/react-native runtime). Run with:
 *   npx tsx tests/native-governance-refresh.test.ts
 *
 * Proves that when the auth identity changes (e.g. switching into a denied
 * tenant), `refresh()` clears the previously published `effectiveStates` AT THE
 * START of the fetch — so consumers fall back to conservative static defaults
 * instead of briefly reading the prior identity's accessible:true map — while a
 * same-identity refresh keeps the map (no flicker). Drives the SAME pure helpers
 * (computeRefreshStart / currentIdentityKey) the store uses, plus a small store
 * simulation with a mocked fetchEffectiveStates + auth identity.
 */
import { strict as assert } from 'node:assert';
import {
  currentIdentityKey,
  computeRefreshStart,
} from '../store/featureGovernanceRefresh';
import type { NativeEffectiveStateMap, NativeEffectiveState } from '../navigation/types';

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

function eff(featureId: string, overrides: Partial<NativeEffectiveState> = {}): NativeEffectiveState {
  return {
    featureId,
    state: 'active',
    enabled: true,
    visible: true,
    accessible: true,
    beta: false,
    ...overrides,
  };
}

/**
 * Minimal stand-in for the zustand governance store that runs the EXACT
 * start-of-refresh decision the production store runs (computeRefreshStart),
 * with an injectable async fetch + identity so we can observe state at refresh
 * start vs. after the fetch resolves.
 */
function makeStoreSim(opts: {
  identity: () => { user: { id: string | null } | null; token: string | null };
  fetchStates: () => Promise<NativeEffectiveStateMap>;
}) {
  let state: {
    effectiveStates: NativeEffectiveStateMap;
    loading: boolean;
    loadedForKey: string | null;
  } = { effectiveStates: {}, loading: false, loadedForKey: null };

  const set = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
  };

  const refresh = async () => {
    const { user, token } = opts.identity();
    const requestedKey = currentIdentityKey(user, token);
    set(computeRefreshStart(state.loadedForKey, requestedKey));
    const map = await opts.fetchStates();
    const after = opts.identity();
    const currentKey = currentIdentityKey(after.user, after.token);
    if (currentKey !== requestedKey) {
      set({ loading: false });
      return;
    }
    set({ effectiveStates: map, loadedForKey: requestedKey, loading: false });
  };

  return { get: () => state, refresh };
}

console.log('\n=== NATIVE GOVERNANCE REFRESH (CLEAR-ON-IDENTITY-CHANGE) TEST ===\n');

const run = async () => {
  // ── Pure helper coverage ────────────────────────────────────────────────
  await test('computeRefreshStart clears the map + loadedForKey on identity change', () => {
    const patch = computeRefreshStart('A|tok', 'B|tok');
    assert.equal(patch.loading, true);
    assert.deepEqual(patch.effectiveStates, {});
    assert.equal(patch.loadedForKey, null);
  });

  await test('computeRefreshStart keeps the map on a same-identity refresh', () => {
    const patch = computeRefreshStart('A|tok', 'A|tok');
    assert.equal(patch.loading, true);
    assert.equal('effectiveStates' in patch, false, 'must NOT clear on same identity (no flicker)');
    assert.equal('loadedForKey' in patch, false);
  });

  await test('currentIdentityKey distinguishes users and tokens', () => {
    assert.notEqual(currentIdentityKey({ id: 'A' }, 't'), currentIdentityKey({ id: 'B' }, 't'));
    assert.notEqual(currentIdentityKey({ id: 'A' }, 't1'), currentIdentityKey({ id: 'A' }, 't2'));
    assert.equal(currentIdentityKey(null, null), 'anon|');
  });

  // ── Store simulation: identity A loaded → switch to B ────────────────────
  await test('switching identity A→B clears A\'s map at refresh start until B resolves', async () => {
    const aMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace', { accessible: true }) };
    const bMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace', { accessible: false }) };

    let identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };

    // Controllable B-fetch so we can inspect state DURING the in-flight fetch.
    let resolveB: (m: NativeEffectiveStateMap) => void = () => {};
    const bPending = new Promise<NativeEffectiveStateMap>((res) => { resolveB = res; });

    let nextFetch: () => Promise<NativeEffectiveStateMap> = async () => aMap;

    const store = makeStoreSim({
      identity: () => identity,
      fetchStates: () => nextFetch(),
    });

    // 1. Load identity A.
    await store.refresh();
    assert.deepEqual(store.get().effectiveStates, aMap, 'A map loaded');
    assert.equal(store.get().loadedForKey, currentIdentityKey(identity.user, identity.token));

    // 2. Switch to identity B (denied tenant) and start a refresh whose fetch is in-flight.
    identity = { user: { id: 'B' }, token: 'tokB' };
    nextFetch = () => bPending;
    const refreshPromise = store.refresh();

    // 3. AT refresh start (B's fetch still pending): A's map must already be GONE.
    assert.deepEqual(store.get().effectiveStates, {}, 'A\'s accessible map cleared at refresh start');
    assert.equal(store.get().loadedForKey, null, 'loadedForKey nulled until B resolves');
    assert.equal(store.get().loading, true);

    // 4. Resolve B's fetch → B's (denied) map is published for B.
    resolveB(bMap);
    await refreshPromise;
    assert.deepEqual(store.get().effectiveStates, bMap, 'B map applied after resolve');
    assert.equal(store.get().loadedForKey, currentIdentityKey(identity.user, identity.token));
    assert.equal(store.get().effectiveStates['product.marketplace'].accessible, false);
  });

  await test('same-identity refresh keeps the existing map (no flicker) during fetch', async () => {
    const aMap: NativeEffectiveStateMap = { 'owner.garage': eff('owner.garage') };
    const identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };

    let resolve2: (m: NativeEffectiveStateMap) => void = () => {};
    const pending2 = new Promise<NativeEffectiveStateMap>((res) => { resolve2 = res; });
    let nextFetch: () => Promise<NativeEffectiveStateMap> = async () => aMap;

    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // load A
    assert.deepEqual(store.get().effectiveStates, aMap);

    // Refresh again for the SAME identity with an in-flight fetch.
    nextFetch = () => pending2;
    const p = store.refresh();
    assert.deepEqual(store.get().effectiveStates, aMap, 'map preserved during same-identity refresh');
    assert.equal(store.get().loadedForKey, currentIdentityKey(identity.user, identity.token));
    resolve2(aMap);
    await p;
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
  console.log('\nALL NATIVE GOVERNANCE REFRESH TESTS PASSED');
});

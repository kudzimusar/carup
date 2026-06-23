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
 *
 * Also covers the fail-CLOSED identity-transition readiness contract
 * (isGovernanceReadyForIdentity): an A→B transition blocks (loading); B is ready
 * ONLY after B loads; a denied B never sees A's map; a FAILED B load is safe +
 * retryable (error, loadedForKey stays null — never treated as loaded); a
 * same-identity transient failure keeps the last-good map; a stale in-flight A
 * result is discarded; logout (→ anon) clears protected access until reload;
 * tenant + role switches both block; and a never-loaded cold start uses the
 * documented static fallback.
 */
import { strict as assert } from 'node:assert';
import {
  currentIdentityKey,
  computeRefreshStart,
  isGovernanceReadyForIdentity,
} from '../store/featureGovernanceRefresh';
import type { NativeEffectiveStateMap, NativeEffectiveState } from '../navigation/types';

/** Discriminated fetch result, mirroring utils/featureGovernanceApi. */
type FetchResult =
  | { ok: true; map: NativeEffectiveStateMap }
  | { ok: false; map: NativeEffectiveStateMap };

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
  fetchStates: () => Promise<FetchResult>;
}) {
  let state: {
    effectiveStates: NativeEffectiveStateMap;
    loading: boolean;
    error: boolean;
    loadedForKey: string | null;
  } = { effectiveStates: {}, loading: false, error: false, loadedForKey: null };

  const set = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
  };

  // Mirrors the production store's refresh() fail-closed contract exactly.
  const refresh = async () => {
    const { user, token } = opts.identity();
    const requestedKey = currentIdentityKey(user, token);
    set({ ...computeRefreshStart(state.loadedForKey, requestedKey), error: false });
    const result = await opts.fetchStates();
    const after = opts.identity();
    const currentKey = currentIdentityKey(after.user, after.token);
    if (currentKey !== requestedKey) {
      set({ loading: false });
      return;
    }
    if (!result.ok) {
      // FAIL CLOSED: never set loadedForKey on a failed load.
      set({ loading: false, error: true });
      return;
    }
    set({ effectiveStates: result.map, loadedForKey: requestedKey, loading: false, error: false });
  };

  return { get: () => state, refresh };
}

/** Sugar so existing tests can keep returning a bare map (success). */
function ok(map: NativeEffectiveStateMap): FetchResult {
  return { ok: true, map };
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
    let resolveB: (m: FetchResult) => void = () => {};
    const bPending = new Promise<FetchResult>((res) => { resolveB = res; });

    let nextFetch: () => Promise<FetchResult> = async () => ok(aMap);

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
    resolveB(ok(bMap));
    await refreshPromise;
    assert.deepEqual(store.get().effectiveStates, bMap, 'B map applied after resolve');
    assert.equal(store.get().loadedForKey, currentIdentityKey(identity.user, identity.token));
    assert.equal(store.get().effectiveStates['product.marketplace'].accessible, false);
  });

  await test('same-identity refresh keeps the existing map (no flicker) during fetch', async () => {
    const aMap: NativeEffectiveStateMap = { 'owner.garage': eff('owner.garage') };
    const identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };

    let resolve2: (m: FetchResult) => void = () => {};
    const pending2 = new Promise<FetchResult>((res) => { resolve2 = res; });
    let nextFetch: () => Promise<FetchResult> = async () => ok(aMap);

    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // load A
    assert.deepEqual(store.get().effectiveStates, aMap);

    // Refresh again for the SAME identity with an in-flight fetch.
    nextFetch = () => pending2;
    const p = store.refresh();
    assert.deepEqual(store.get().effectiveStates, aMap, 'map preserved during same-identity refresh');
    assert.equal(store.get().loadedForKey, currentIdentityKey(identity.user, identity.token));
    resolve2(ok(aMap));
    await p;
  });

  // ── Pure readiness selector (isGovernanceReadyForIdentity) ───────────────
  await test('readiness: loaded for the current identity ⇒ ready', () => {
    const r = isGovernanceReadyForIdentity('B|tokB', 'B|tokB', false, false);
    assert.deepEqual(r, { ready: true, reason: 'ready' });
  });

  await test('readiness: A→B transition (loadedForKey cleared, loading) ⇒ blocked/loading', () => {
    // computeRefreshStart cleared loadedForKey→null + loading→true on the switch.
    const r = isGovernanceReadyForIdentity('B|tokB', null, true, false);
    assert.deepEqual(r, { ready: false, reason: 'loading' });
  });

  await test('readiness: B ready ONLY after B load (still loading is not ready)', () => {
    const loadingR = isGovernanceReadyForIdentity('B|tokB', null, true, false);
    assert.equal(loadingR.ready, false);
    const readyR = isGovernanceReadyForIdentity('B|tokB', 'B|tokB', false, false);
    assert.equal(readyR.ready, true);
  });

  await test('readiness: denied-B never evaluates against A (A key is not B ⇒ not ready)', () => {
    // While A is still the loaded key but we are asking for B, B must NOT be
    // ready off A's map. If loading we block; if a stale A key lingers w/o
    // loading/error we stay blocked (defensive 'error').
    assert.equal(isGovernanceReadyForIdentity('B|tokB', 'A|tokA', true, false).ready, false);
    assert.deepEqual(
      isGovernanceReadyForIdentity('B|tokB', 'A|tokA', false, false),
      { ready: false, reason: 'error' },
    );
  });

  await test('readiness: failed-B load ⇒ safe + retryable (error, loadedForKey still null)', () => {
    const r = isGovernanceReadyForIdentity('B|tokB', null, false, true);
    assert.deepEqual(r, { ready: false, reason: 'error' });
  });

  await test('readiness: cold-start (never loaded, idle) ⇒ ready via static fallback', () => {
    const r = isGovernanceReadyForIdentity('anon|', null, false, false);
    assert.deepEqual(r, { ready: true, reason: 'cold-start' });
  });

  await test('readiness: loading takes precedence over error and cold-start', () => {
    assert.equal(isGovernanceReadyForIdentity('B|tokB', null, true, true).reason, 'loading');
  });

  // ── Store sim: failed identity-B load fails CLOSED (never marked loaded) ──
  await test('failed identity-B load: error set, loadedForKey stays null, blocked then retryable', async () => {
    const aMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace') };
    const bMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace', { accessible: false }) };
    let identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };
    let nextFetch: () => Promise<FetchResult> = async () => ok(aMap);
    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // load A
    const aKey = currentIdentityKey(identity.user, identity.token);
    assert.equal(store.get().loadedForKey, aKey);

    // Switch to B; B's fetch FAILS.
    identity = { user: { id: 'B' }, token: 'tokB' };
    const bKey = currentIdentityKey(identity.user, identity.token);
    nextFetch = async () => ({ ok: false, map: {} });
    await store.refresh();

    // FAIL CLOSED: error true, loadedForKey NOT set to B (still null), map cleared.
    assert.equal(store.get().error, true, 'error flagged on failed B load');
    assert.equal(store.get().loadedForKey, null, 'failed B load must NOT be treated as loaded');
    assert.deepEqual(store.get().effectiveStates, {}, 'A map already cleared on the identity switch');

    // Readiness for B ⇒ blocked + retryable.
    let r = isGovernanceReadyForIdentity(bKey, store.get().loadedForKey, store.get().loading, store.get().error);
    assert.deepEqual(r, { ready: false, reason: 'error' });

    // Retry succeeds → B becomes ready with B's (denied) map.
    nextFetch = async () => ok(bMap);
    await store.refresh();
    assert.equal(store.get().error, false);
    assert.equal(store.get().loadedForKey, bKey);
    r = isGovernanceReadyForIdentity(bKey, store.get().loadedForKey, store.get().loading, store.get().error);
    assert.deepEqual(r, { ready: true, reason: 'ready' });
    assert.equal(store.get().effectiveStates['product.marketplace'].accessible, false);
  });

  await test('same-identity transient failure keeps the last-good map (still loaded)', async () => {
    const aMap: NativeEffectiveStateMap = { 'owner.garage': eff('owner.garage') };
    const identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };
    let nextFetch: () => Promise<FetchResult> = async () => ok(aMap);
    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // load A
    const aKey = currentIdentityKey(identity.user, identity.token);

    // Same-identity refresh FAILS → keep the prior map, still loaded for A.
    nextFetch = async () => ({ ok: false, map: {} });
    await store.refresh();
    assert.deepEqual(store.get().effectiveStates, aMap, 'same-identity failure retains last-good map');
    assert.equal(store.get().loadedForKey, aKey, 'still loaded for the same identity');
    assert.equal(store.get().error, true, 'error flagged so a retry is offered');
    // Readiness: loadedForKey === currentKey ⇒ ready (retains last-good map).
    const r = isGovernanceReadyForIdentity(aKey, store.get().loadedForKey, store.get().loading, store.get().error);
    assert.deepEqual(r, { ready: true, reason: 'ready' });
  });

  await test('stale in-flight A result is discarded when identity switched mid-flight', async () => {
    const aMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace') };
    let identity = { user: { id: 'A' as string | null }, token: 'tokA' as string | null };
    let resolveA: (m: FetchResult) => void = () => {};
    const aPending = new Promise<FetchResult>((res) => { resolveA = res; });
    let nextFetch: () => Promise<FetchResult> = () => aPending;
    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    // Start A's refresh (in flight), then switch identity to B before it resolves.
    const p = store.refresh();
    identity = { user: { id: 'B' }, token: 'tokB' };
    resolveA(ok(aMap)); // A's late result arrives — but identity is now B.
    await p;

    // The stale A result must be dropped (identity guard); loadedForKey not A.
    const aKey = 'A|tokA';
    assert.notEqual(store.get().loadedForKey, aKey, 'stale A result must not be applied');
    assert.deepEqual(store.get().effectiveStates, {}, 'no stale A map applied for B');
  });

  await test('logout (identity → anon) clears protected access until reload', async () => {
    const aMap: NativeEffectiveStateMap = { 'owner.garage': eff('owner.garage') };
    let identity: { user: { id: string | null } | null; token: string | null } = {
      user: { id: 'A' },
      token: 'tokA',
    };
    let nextFetch: () => Promise<FetchResult> = async () => ok(aMap);
    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // authed A
    assert.deepEqual(store.get().effectiveStates, aMap);

    // Logout: identity → anon. Refresh clears A's map at the start (identity change).
    identity = { user: null, token: null };
    let resolveAnon: (m: FetchResult) => void = () => {};
    const anonPending = new Promise<FetchResult>((res) => { resolveAnon = res; });
    nextFetch = () => anonPending;
    const p = store.refresh();
    // During the in-flight anon load, A's protected map is already gone.
    assert.deepEqual(store.get().effectiveStates, {}, 'A protected map cleared on logout');
    assert.equal(store.get().loadedForKey, null);
    const anonKey = currentIdentityKey(null, null);
    assert.equal(
      isGovernanceReadyForIdentity(anonKey, store.get().loadedForKey, store.get().loading, store.get().error).ready,
      false,
      'anon protected access blocked until reload',
    );
    resolveAnon(ok({}));
    await p;
    assert.equal(store.get().loadedForKey, anonKey);
  });

  await test('tenant switch and role switch both block until the new identity loads', async () => {
    // Role/tenant switches change the auth token (and/or user) ⇒ a distinct key.
    const baseMap: NativeEffectiveStateMap = { 'product.marketplace': eff('product.marketplace') };
    let identity = { user: { id: 'A' as string | null }, token: 'tok-owner' as string | null };
    let resolveNext: (m: FetchResult) => void = () => {};
    let pending = new Promise<FetchResult>((res) => { resolveNext = res; });
    let nextFetch: () => Promise<FetchResult> = async () => ok(baseMap);
    const store = makeStoreSim({ identity: () => identity, fetchStates: () => nextFetch() });

    await store.refresh(); // owner role loaded

    // Role switch → new token. The map clears + we block until the new role loads.
    identity = { user: { id: 'A' }, token: 'tok-dealer' };
    pending = new Promise<FetchResult>((res) => { resolveNext = res; });
    nextFetch = () => pending;
    let p = store.refresh();
    const dealerKey = currentIdentityKey(identity.user, identity.token);
    assert.equal(
      isGovernanceReadyForIdentity(dealerKey, store.get().loadedForKey, store.get().loading, store.get().error).ready,
      false,
      'role switch blocks until the new role state loads',
    );
    resolveNext(ok(baseMap));
    await p;
    assert.equal(store.get().loadedForKey, dealerKey);

    // Tenant switch → user id (active tenant) changes ⇒ new key, same blocking.
    identity = { user: { id: 'A-tenant2' }, token: 'tok-dealer' };
    pending = new Promise<FetchResult>((res) => { resolveNext = res; });
    nextFetch = () => pending;
    p = store.refresh();
    const tenant2Key = currentIdentityKey(identity.user, identity.token);
    assert.equal(
      isGovernanceReadyForIdentity(tenant2Key, store.get().loadedForKey, store.get().loading, store.get().error).ready,
      false,
      'tenant switch blocks until the new tenant state loads',
    );
    resolveNext(ok(baseMap));
    await p;
    assert.equal(store.get().loadedForKey, tenant2Key);
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

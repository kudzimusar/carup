/**
 * Milestone A — native navigation governance tests.
 *
 * Pure, DB-free, import-only (no Expo runtime). Run with:
 *   npx tsx tests/native-navigation.test.ts
 * (matches how tests/verification-api.test.ts runs).
 *
 * Proves native navigation consumes the same governed feature truth as web:
 * manifest validation, route matching, role-scoped tabs (no fabricated
 * screens), backend kill-switches, and the route-access decision order.
 */
import { strict as assert } from 'node:assert';
import type { UserRole } from '@shared/types';
import {
  FEATURE_MANIFEST,
  validateManifest,
  getFeatureByRoute,
} from '../navigation/featureManifest';
import {
  getNativeTabs,
  getNativeDrawer,
  findUnownedNativeEntries,
  findDeadNativeRoutes,
  KNOWN_NATIVE_ROUTES,
} from '../navigation/nativeNavigationManifest';
import { evaluateNativeRouteAccess } from '../navigation/evaluateNativeRouteAccess';
import type {
  NativeEffectiveStateMap,
  NativeEffectiveState,
  NativeNavContext,
} from '../navigation/types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    PASSED++;
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    FAILED++;
    FAILURES.push({ name, error });
  }
}

let PASSED = 0;
let FAILED = 0;
const FAILURES: { name: string; error: unknown }[] = [];

function ctx(
  role: UserRole | null,
  effectiveStates: NativeEffectiveStateMap = {},
): NativeNavContext {
  return {
    isAuthenticated: role !== null,
    role,
    environment: 'production',
    effectiveStates,
  };
}

function eff(
  featureId: string,
  overrides: Partial<NativeEffectiveState> = {},
): NativeEffectiveState {
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

function labels(entries: { label: string }[]): string[] {
  return entries.map((e) => e.label);
}

console.log('\n=== MILESTONE A — NATIVE NAVIGATION TEST ===\n');

// ── Manifest ────────────────────────────────────────────────────────────────
test('manifest validates and loads (>50 entries)', () => {
  assert.ok(Array.isArray(FEATURE_MANIFEST));
  assert.ok(FEATURE_MANIFEST.length > 50, `expected >50 entries, got ${FEATURE_MANIFEST.length}`);
});

test('validateManifest returns empty list (no throw) on invalid input', () => {
  assert.deepEqual(validateManifest('not-an-array' as unknown), []);
  assert.deepEqual(validateManifest([{ id: 'x' }] as unknown), []);
});

test('getFeatureByRoute matches /marketplace exactly', () => {
  const f = getFeatureByRoute('/marketplace');
  assert.equal(f?.id, 'product.marketplace');
});

test('getFeatureByRoute matches a :param route', () => {
  const f = getFeatureByRoute('/marketplace/ABC123VIN');
  assert.equal(f?.id, 'public.vehicle-detail');
});

// ── Tab selection per role (no fabricated screens) ───────────────────────────
test('owner tabs: Dashboard + Marketplace + Garage + Messages, ≤4 before More', () => {
  const tabs = getNativeTabs(ctx('owner'));
  const l = labels(tabs);
  assert.ok(tabs.length <= 4);
  assert.ok(l.includes('Dashboard'));
  assert.ok(l.includes('Marketplace'));
  assert.ok(l.includes('Garage'));
  assert.ok(l.includes('Messages'));
  assert.ok(!l.includes('Referrals'), 'Referrals lives in the drawer to preserve the More-tab budget');
  // Owner dashboard resolves to owner.overview (no fabricated owner).
  const dash = tabs.find((t) => t.label === 'Dashboard');
  assert.equal(dash?.resolvedFeatureId, 'owner.overview');
});

test('anonymous tabs: only public Marketplace', () => {
  const tabs = getNativeTabs(ctx(null));
  assert.deepEqual(labels(tabs), ['Marketplace']);
  assert.equal(tabs[0].resolvedFeatureId, 'product.marketplace');
});

test('dealer tabs: Dashboard + Marketplace only (no owner-only / no fabricated dealer screen)', () => {
  const tabs = getNativeTabs(ctx('dealer'));
  const l = labels(tabs);
  assert.ok(l.includes('Dashboard'));
  assert.ok(l.includes('Marketplace'));
  assert.ok(!l.includes('Garage'), 'dealer must not see owner-only Garage');
  assert.ok(!l.includes('Referrals'), 'dealer must not see owner-only Referrals');
  // Dashboard resolves to the dealer's own overview — a real manifest feature.
  const dash = tabs.find((t) => t.label === 'Dashboard');
  assert.equal(dash?.resolvedFeatureId, 'dealer.overview');
});

test('disabling product.marketplace (enabled:false) removes Marketplace from tabs', () => {
  const states = { 'product.marketplace': eff('product.marketplace', { enabled: false }) };
  const tabs = getNativeTabs(ctx('owner', states));
  assert.ok(!labels(tabs).includes('Marketplace'));
});

test('planned/hidden owner.garage removes the Garage tab', () => {
  const planned = getNativeTabs(ctx('owner', { 'owner.garage': eff('owner.garage', { state: 'planned' }) }));
  assert.ok(!labels(planned).includes('Garage'));
  const hidden = getNativeTabs(ctx('owner', { 'owner.garage': eff('owner.garage', { state: 'hidden' }) }));
  assert.ok(!labels(hidden).includes('Garage'));
});

test('owner drawer surfaces SafePay (owner.listings)', () => {
  const drawer = getNativeDrawer(ctx('owner'));
  const safepay = drawer.find((d) => d.label === 'SafePay');
  assert.ok(safepay, 'expected SafePay drawer entry for owner');
  assert.equal(safepay?.resolvedFeatureId, 'owner.listings');
});

test('owner drawer surfaces Referrals (owner.referrals)', () => {
  const drawer = getNativeDrawer(ctx('owner'));
  const referrals = drawer.find((d) => d.label === 'Referrals');
  assert.ok(referrals, 'expected Referrals drawer entry for owner');
  assert.equal(referrals?.resolvedFeatureId, 'owner.referrals');
});

// ── Route access decisions ───────────────────────────────────────────────────
test('redirect-auth for a protected route when anonymous', () => {
  const d = evaluateNativeRouteAccess({
    route: '/dashboard/garage',
    featureId: 'owner.garage',
    isBootstrapping: false,
    isAuthenticated: false,
    role: null,
    effectiveStates: {},
    hasNativeScreen: true,
  });
  assert.equal(d.kind, 'redirect-auth');
});

test('redirect-role for a wrong-role protected route', () => {
  const d = evaluateNativeRouteAccess({
    route: '/dashboard/garage',
    featureId: 'owner.garage',
    isBootstrapping: false,
    isAuthenticated: true,
    role: 'dealer',
    effectiveStates: {},
    hasNativeScreen: true,
  });
  assert.equal(d.kind, 'redirect-role');
});

test('native-unavailable when hasNativeScreen=false', () => {
  const d = evaluateNativeRouteAccess({
    route: '/dealer',
    featureId: 'dealer.overview',
    isBootstrapping: false,
    isAuthenticated: true,
    role: 'dealer',
    effectiveStates: {},
    hasNativeScreen: false,
  });
  assert.equal(d.kind, 'native-unavailable');
});

test('disabled on backend enabled:false', () => {
  const d = evaluateNativeRouteAccess({
    route: '/marketplace',
    featureId: 'product.marketplace',
    isBootstrapping: false,
    isAuthenticated: false,
    role: null,
    effectiveStates: { 'product.marketplace': eff('product.marketplace', { enabled: false }) },
    hasNativeScreen: true,
  });
  assert.equal(d.kind, 'disabled');
});

test('render on an active public route', () => {
  const d = evaluateNativeRouteAccess({
    route: '/marketplace',
    featureId: 'product.marketplace',
    isBootstrapping: false,
    isAuthenticated: false,
    role: null,
    effectiveStates: {},
    hasNativeScreen: true,
  });
  assert.equal(d.kind, 'render');
});

test('loading while bootstrapping', () => {
  const d = evaluateNativeRouteAccess({
    route: '/marketplace',
    featureId: 'product.marketplace',
    isBootstrapping: true,
    isAuthenticated: false,
    role: null,
    effectiveStates: {},
    hasNativeScreen: true,
  });
  assert.equal(d.kind, 'loading');
});

// ── Structural validators ────────────────────────────────────────────────────
test('findUnownedNativeEntries() returns [] (every entry owns a feature)', () => {
  assert.deepEqual(findUnownedNativeEntries(), []);
});

test('findDeadNativeRoutes(known) returns [] (no dead routes)', () => {
  assert.deepEqual(findDeadNativeRoutes(KNOWN_NATIVE_ROUTES), []);
});

console.log(`\n${PASSED} passed, ${FAILED} failed.`);
if (FAILED > 0) {
  for (const f of FAILURES) {
    console.error(`\n--- ${f.name} ---`);
    console.error(f.error);
  }
  process.exit(1);
}
console.log('\nALL MILESTONE A NATIVE NAVIGATION TESTS PASSED');

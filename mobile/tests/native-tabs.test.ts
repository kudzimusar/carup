/**
 * Milestone B — governed role-aware bottom tabs tests.
 *
 * Pure, DB-free, import-only (no Expo / RN runtime). Run with:
 *   npx tsx tests/native-tabs.test.ts
 * (mirrors tests/native-navigation.test.ts).
 *
 * Proves the `_layout.tsx` tab plan (`resolveTabBar`) maps governed feature
 * truth → tab visibility/beta for the real native tab screens, with no fabricated
 * screens, the ≤5 cap, and `escrow` always drawer-only.
 */
import { strict as assert } from 'node:assert';
import type { UserRole } from '@shared/types';
import { resolveTabBar } from '../navigation/nativeNavigationManifest';
import type {
  NativeEffectiveStateMap,
  NativeEffectiveState,
  NativeNavContext,
} from '../navigation/types';

let PASSED = 0;
let FAILED = 0;
const FAILURES: { name: string; error: unknown }[] = [];

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

/** Names of screens marked visible in the tab bar. */
function visibleNames(c: NativeNavContext): string[] {
  return resolveTabBar(c)
    .filter((t) => t.visible)
    .map((t) => t.name);
}

/** All real screens are always declared (regardless of visibility). */
const ALL_SCREENS = ['index', 'garage', 'escrow', 'marketplace', 'referral', 'communications'];
const NON_OWNER_ROLES: UserRole[] = [
  'dealer',
  'mechanic',
  'bank',
  'insurance',
  'government',
  'admin',
];

console.log('\n=== MILESTONE B — GOVERNED ROLE-AWARE TABS TEST ===\n');

// ── Plan shape ───────────────────────────────────────────────────────────────
test('resolveTabBar always returns a row for each real tab screen', () => {
  const plan = resolveTabBar(ctx('owner'));
  assert.equal(plan.length, ALL_SCREENS.length);
  assert.deepEqual(plan.map((p) => p.name).sort(), [...ALL_SCREENS].sort());
});

test('escrow is ALWAYS hidden in the tab bar (drawer-only)', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    const escrow = resolveTabBar(ctx(role)).find((t) => t.name === 'escrow');
    assert.ok(escrow);
    assert.equal(escrow!.visible, false, `escrow must be hidden for role=${role ?? 'anon'}`);
  }
});

test('never more than 5 visible tabs for any role', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    assert.ok(visibleNames(ctx(role)).length <= 5);
  }
});

// ── Owner ────────────────────────────────────────────────────────────────────
test('owner: index + marketplace + garage + referral + communications visible, escrow hidden, ≤5', () => {
  const names = visibleNames(ctx('owner'));
  assert.ok(names.includes('index'));
  assert.ok(names.includes('marketplace'));
  assert.ok(names.includes('garage'));
  assert.ok(names.includes('referral'));
  assert.ok(names.includes('communications'));
  assert.ok(!names.includes('escrow'), 'escrow is drawer-only');
  assert.ok(names.length <= 5);
});

// ── Non-owner authenticated roles ────────────────────────────────────────────
for (const role of NON_OWNER_ROLES) {
  test(`${role}: ONLY index + marketplace visible (no fabricated garage/referral/escrow)`, () => {
    const names = visibleNames(ctx(role)).sort();
    assert.deepEqual(names, ['index', 'marketplace']);
  });
}

// ── Anonymous ────────────────────────────────────────────────────────────────
test('anonymous: ONLY marketplace visible (index/garage/referral/escrow hidden)', () => {
  const names = visibleNames(ctx(null));
  assert.deepEqual(names, ['marketplace']);
});

// ── Backend kill-switch ──────────────────────────────────────────────────────
test('disabling product.marketplace (enabled:false) hides the marketplace tab', () => {
  const states = { 'product.marketplace': eff('product.marketplace', { enabled: false }) };
  assert.ok(!visibleNames(ctx('owner', states)).includes('marketplace'));
});

test('visible:false on product.marketplace hides the marketplace tab', () => {
  const states = { 'product.marketplace': eff('product.marketplace', { visible: false }) };
  assert.ok(!visibleNames(ctx('owner', states)).includes('marketplace'));
});

// ── Lifecycle gates ──────────────────────────────────────────────────────────
test('planned owner.garage hides the garage tab', () => {
  const states = { 'owner.garage': eff('owner.garage', { state: 'planned' }) };
  assert.ok(!visibleNames(ctx('owner', states)).includes('garage'));
});

test('hidden owner.garage hides the garage tab', () => {
  const states = { 'owner.garage': eff('owner.garage', { state: 'hidden' }) };
  assert.ok(!visibleNames(ctx('owner', states)).includes('garage'));
});

// ── Beta indicator ───────────────────────────────────────────────────────────
test('beta owner (state:beta) marks the tab beta=true while still visible', () => {
  const states = { 'owner.referrals': eff('owner.referrals', { state: 'beta', beta: true }) };
  const referral = resolveTabBar(ctx('owner', states)).find((t) => t.name === 'referral');
  assert.ok(referral);
  assert.equal(referral!.beta, true);
  assert.equal(referral!.visible, true, 'beta is still visible');
});

test('non-beta owner marks beta=false', () => {
  const referral = resolveTabBar(ctx('owner')).find((t) => t.name === 'referral');
  assert.equal(referral!.beta, false);
});

// ── Icon / title wiring ──────────────────────────────────────────────────────
test('each plan row carries an iconName and title', () => {
  for (const item of resolveTabBar(ctx('owner'))) {
    assert.ok(item.iconName.length > 0, `${item.name} missing iconName`);
    assert.ok(item.title.length > 0, `${item.name} missing title`);
  }
});

console.log(`\n${PASSED} passed, ${FAILED} failed.`);
if (FAILED > 0) {
  for (const f of FAILURES) {
    console.error(`\n--- ${f.name} ---`);
    console.error(f.error);
  }
  process.exit(1);
}
console.log('\nALL MILESTONE B GOVERNED TABS TESTS PASSED');

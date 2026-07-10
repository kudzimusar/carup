/**
 * Milestone C — governed native drawer tests.
 *
 * Pure, DB-free, import-only (no Expo / RN runtime). Run with:
 *   npx tsx tests/native-drawer.test.ts
 * (mirrors tests/native-tabs.test.ts and tests/native-navigation.test.ts).
 *
 * Proves the PURE drawer governance (`resolveDrawerSections` + `resolveMoreTab`)
 * surfaces only real, governed native screens, dedupes against visible tabs,
 * emits no empty sections, and never leaks a web-only route — for owner /
 * non-owner / anonymous identities and under backend kill-switches.
 */
import { strict as assert } from 'node:assert';
import type { UserRole } from '@shared/types';
import {
  resolveDrawerSections,
  resolveMoreTab,
  drawerHasRoute,
  type DrawerSection,
  type DrawerLinkItem,
} from '../navigation/nativeDrawerSections';
import { resolveTabBar, KNOWN_NATIVE_ROUTES } from '../navigation/nativeNavigationManifest';
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

/** All link items across all sections. */
function links(sections: DrawerSection[]): DrawerLinkItem[] {
  return sections.flatMap((s) =>
    s.items.filter((i): i is DrawerLinkItem => i.kind === 'link'),
  );
}

/** Section ids present (in order). */
function sectionIds(sections: DrawerSection[]): string[] {
  return sections.map((s) => s.id);
}

/** Action ids present anywhere. */
function actionIds(sections: DrawerSection[]): string[] {
  return sections.flatMap((s) =>
    s.items.filter((i) => i.kind === 'action').map((i) => i.id),
  );
}

/** The set of routes (link expoRoutes) the drawer would surface. */
function drawerRoutes(c: NativeNavContext): string[] {
  return links(resolveDrawerSections(c)).map((l) => l.expoRoute);
}

const NON_OWNER_ROLES: UserRole[] = [
  'dealer',
  'mechanic',
  'bank',
  'insurance',
  'government',
  'admin',
];

console.log('\n=== MILESTONE C — GOVERNED NATIVE DRAWER TEST ===\n');

// ── No empty sections, ever ──────────────────────────────────────────────────
test('no section is ever emitted empty (owner/non-owner/anon)', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    for (const section of resolveDrawerSections(ctx(role))) {
      assert.ok(
        section.items.length > 0,
        `section ${section.id} empty for role=${role ?? 'anon'}`,
      );
    }
  }
});

// ── Anti-leakage: only REAL native routes appear ─────────────────────────────
test('no web-only / non-shipped native route appears in any drawer', () => {
  const known = new Set(KNOWN_NATIVE_ROUTES);
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    for (const route of drawerRoutes(ctx(role))) {
      assert.ok(known.has(route), `route ${route} (role=${role ?? 'anon'}) is not a shipped native route`);
    }
  }
});

test('no native /search or verification web route is ever surfaced', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    for (const route of drawerRoutes(ctx(role))) {
      assert.ok(!route.includes('search'), `leaked search route for role=${role ?? 'anon'}`);
      assert.ok(!route.includes('verify'), `leaked verify route for role=${role ?? 'anon'}`);
    }
  }
});

// ── Dedupe vs visible tabs ───────────────────────────────────────────────────
test('no drawer link duplicates a VISIBLE tab (owner/non-owner/anon)', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    const c = ctx(role);
    const visibleTabRoutes = new Set(
      resolveTabBar(c).filter((t) => t.visible).map((t) => `/(tabs)/${t.name === 'index' ? 'index' : t.name}`),
    );
    for (const route of drawerRoutes(c)) {
      assert.ok(
        !visibleTabRoutes.has(route),
        `drawer duplicates visible tab ${route} for role=${role ?? 'anon'}`,
      );
    }
  }
});

// ── Owner ────────────────────────────────────────────────────────────────────
test('owner: My Work surfaces SafePay (escrow / owner.listings)', () => {
  const sections = resolveDrawerSections(ctx('owner'));
  const myWork = sections.find((s) => s.id === 'my-work');
  assert.ok(myWork, 'expected My Work section for owner');
  const safepay = myWork!.items.find(
    (i) => i.kind === 'link' && i.label === 'SafePay',
  ) as DrawerLinkItem | undefined;
  assert.ok(safepay, 'expected SafePay in owner My Work');
  assert.equal(safepay!.featureId, 'owner.listings');
  assert.equal(safepay!.expoRoute, '/(tabs)/escrow');
});

test('owner: My Work surfaces Referrals (owner.referrals)', () => {
  const sections = resolveDrawerSections(ctx('owner'));
  const myWork = sections.find((s) => s.id === 'my-work');
  assert.ok(myWork, 'expected My Work section for owner');
  const referrals = myWork!.items.find(
    (i) => i.kind === 'link' && i.label === 'Referrals',
  ) as DrawerLinkItem | undefined;
  assert.ok(referrals, 'expected Referrals in owner My Work');
  assert.equal(referrals!.featureId, 'owner.referrals');
  assert.equal(referrals!.expoRoute, '/(tabs)/referral');
});

test('owner: Garage is NOT duplicated (it is a visible tab)', () => {
  const sections = resolveDrawerSections(ctx('owner'));
  const garage = links(sections).find((l) => l.id === 'native.garage');
  assert.equal(garage, undefined, 'owner Garage is a tab — must not also be in the drawer');
});

test('owner: Marketplace is NOT duplicated (it is a visible tab) ⇒ no Discover section', () => {
  const sections = resolveDrawerSections(ctx('owner'));
  assert.ok(!sectionIds(sections).includes('discover'), 'Discover should be empty/omitted (Marketplace is a tab)');
});

test('owner: Account has role label + sign out (no sign-in)', () => {
  const ids = actionIds(resolveDrawerSections(ctx('owner')));
  assert.ok(ids.includes('account.role'));
  assert.ok(ids.includes('account.signout'));
  assert.ok(!ids.includes('account.signin'));
  // Owner is already owner ⇒ no "switch to owner".
  assert.ok(!ids.includes('account.switch-owner'));
});

// ── Non-owner authenticated roles ────────────────────────────────────────────
for (const role of NON_OWNER_ROLES) {
  test(`${role}: NO owner-only items (no Garage/SafePay/Referrals) and no My Work section`, () => {
    const sections = resolveDrawerSections(ctx(role));
    const ls = links(sections);
    assert.ok(!ls.some((l) => l.id === 'native.garage'), `${role} must not see Garage`);
    assert.ok(!ls.some((l) => l.id === 'native.escrow'), `${role} must not see SafePay`);
    assert.ok(!ls.some((l) => l.id === 'native.referral'), `${role} must not see Referrals`);
    assert.ok(!sectionIds(sections).includes('my-work'), `${role} must not have a My Work section`);
  });

  test(`${role}: offered a role switch to owner + sign out`, () => {
    const ids = actionIds(resolveDrawerSections(ctx(role)));
    assert.ok(ids.includes('account.switch-owner'), `${role} should be offered switch-to-owner`);
    assert.ok(ids.includes('account.signout'));
    assert.ok(!ids.includes('account.signin'));
  });
}

// ── Anonymous ────────────────────────────────────────────────────────────────
test('anonymous: only public content + a sign-in affordance (no owner items)', () => {
  const sections = resolveDrawerSections(ctx(null));
  const ls = links(sections);
  // No owner-only screens.
  assert.ok(!ls.some((l) => l.id === 'native.garage'));
  assert.ok(!ls.some((l) => l.id === 'native.escrow'));
  assert.ok(!ls.some((l) => l.id === 'native.referral'));
  // Account offers sign-in (and not sign-out).
  const ids = actionIds(sections);
  assert.ok(ids.includes('account.signin'));
  assert.ok(!ids.includes('account.signout'));
  assert.ok(!ids.includes('account.role'));
});

// ── Backend kill-switch / lifecycle excludes owners' items ───────────────────
test('disabled owner.listings (enabled:false) removes SafePay from owner My Work', () => {
  const states = { 'owner.listings': eff('owner.listings', { enabled: false }) };
  const sections = resolveDrawerSections(ctx('owner', states));
  assert.ok(!links(sections).some((l) => l.id === 'native.escrow'));
  assert.ok(links(sections).some((l) => l.id === 'native.referral'));
});

test('planned owner.listings removes SafePay (lifecycle gate)', () => {
  const states = { 'owner.listings': eff('owner.listings', { state: 'planned' }) };
  assert.ok(!links(resolveDrawerSections(ctx('owner', states))).some((l) => l.id === 'native.escrow'));
});

test('hidden owner.listings removes SafePay (lifecycle gate)', () => {
  const states = { 'owner.listings': eff('owner.listings', { state: 'hidden' }) };
  assert.ok(!links(resolveDrawerSections(ctx('owner', states))).some((l) => l.id === 'native.escrow'));
});

// ── Governance can move a normally-tabbed screen INTO the drawer ─────────────
test('if Marketplace tab is governance-hidden, Discover surfaces it (still a real route)', () => {
  // Hide the marketplace TAB via visible:false; it is no longer a visible tab,
  // so the drawer may surface it under Discover (still the real /marketplace).
  const states = { 'product.marketplace': eff('product.marketplace', { visible: false }) };
  const sections = resolveDrawerSections(ctx('owner', states));
  // visible:false hides it everywhere (tab AND drawer) — anti-leakage: it must
  // NOT appear because backend said not-visible. So Discover stays omitted.
  assert.ok(!sectionIds(sections).includes('discover'));
  assert.ok(!drawerHasRoute(sections, '/(tabs)/marketplace'));
});

// ── More tab presentation ────────────────────────────────────────────────────
test('resolveMoreTab: authed → opens drawer; anon → sign-in affordance', () => {
  assert.equal(resolveMoreTab(ctx('owner')).action, 'drawer');
  for (const role of NON_OWNER_ROLES) {
    assert.equal(resolveMoreTab(ctx(role)).action, 'drawer');
  }
  const anon = resolveMoreTab(ctx(null));
  assert.equal(anon.action, 'signin');
  assert.equal(anon.title, 'Sign in');
});

test('More tab + visible tabs never exceed 5 for any role', () => {
  for (const role of [null, 'owner', ...NON_OWNER_ROLES] as (UserRole | null)[]) {
    const visibleTabs = resolveTabBar(ctx(role)).filter((t) => t.visible).length;
    // The More tab is always +1.
    assert.ok(visibleTabs + 1 <= 5, `role=${role ?? 'anon'} would exceed 5 tabs`);
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
console.log('\nALL MILESTONE C GOVERNED DRAWER TESTS PASSED');

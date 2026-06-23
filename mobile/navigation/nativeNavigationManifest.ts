/**
 * Native navigation manifest + selectors (Milestone A).
 *
 * The ONLY place that declares which real native screens are surfaced, and the
 * governed feature that owns each. Every tab/drawer entry MUST resolve to a
 * manifest feature owner — there are NO fabricated screens. Selectors filter by
 * role eligibility AND lifecycle/backend visibility, so native navigation
 * consumes the same feature truth as web.
 *
 * Native screen reality (only these exist; see milestone brief):
 *   (tabs)/index, (tabs)/garage, (tabs)/escrow, (tabs)/marketplace,
 *   (tabs)/referral, vehicle/[vin], (auth)/*.
 * There are NO native dealer/mechanic/insurance/government/bank work areas and
 * NO native /search screen — so none are declared here.
 */
import type { UserRole } from '@shared/types';
import type {
  NativeNavEntry,
  NativeNavContext,
  NativeEffectiveStateMap,
  NativeLifecycleState,
} from './types';
import { getFeatureById, getStaticLifecycle } from './featureManifest';

/** A nav entry whose owning feature id has been resolved for the active role. */
export interface ResolvedNativeEntry extends NativeNavEntry {
  resolvedFeatureId: string;
}

/**
 * The native navigation manifest. Owner feature ids are grounded in the shared
 * manifest. The role dashboard resolves its owner at selector time (per role).
 */
export const NATIVE_NAV: NativeNavEntry[] = [
  {
    id: 'native.dashboard',
    expoRoute: '/(tabs)/index',
    resolveFeatureId: (role) => `${role ?? 'owner'}.overview`,
    label: 'Dashboard',
    iconName: 'Home',
    placement: 'tab',
    order: 10,
  },
  {
    id: 'native.marketplace',
    expoRoute: '/(tabs)/marketplace',
    featureId: 'product.marketplace',
    label: 'Marketplace',
    iconName: 'ShoppingCart',
    placement: 'tab',
    order: 20,
  },
  {
    id: 'native.garage',
    expoRoute: '/(tabs)/garage',
    featureId: 'owner.garage',
    label: 'Garage',
    iconName: 'Car',
    placement: 'tab',
    order: 30,
  },
  {
    id: 'native.referral',
    expoRoute: '/(tabs)/referral',
    featureId: 'owner.referrals',
    label: 'Referrals',
    iconName: 'Gift',
    placement: 'tab',
    order: 40,
  },
  {
    // SafePay area. There is no dedicated registered "escrow" feature, so it is
    // governed by the safepay-domain owner.listings owner (see brief).
    id: 'native.escrow',
    expoRoute: '/(tabs)/escrow',
    featureId: 'owner.listings',
    label: 'SafePay',
    iconName: 'Shield',
    placement: 'drawer',
    section: 'SafePay',
    order: 50,
  },
  {
    // Deep-link / route-boundary only — never a tab or drawer item.
    id: 'native.vehicle-detail',
    expoRoute: '/vehicle/[vin]',
    featureId: 'product.marketplace',
    label: 'Vehicle',
    iconName: 'Car',
    placement: 'none',
    order: 60,
  },
];

/** All Expo routes the native app actually ships (for dead-route detection). */
export const KNOWN_NATIVE_ROUTES: string[] = NATIVE_NAV.map((e) => e.expoRoute);

/** Resolve the owning feature id for an entry under a given role. */
export function resolveEntryOwner(entry: NativeNavEntry, role: UserRole | null): string {
  if (entry.resolveFeatureId) return entry.resolveFeatureId(role);
  return entry.featureId ?? '';
}

function effectiveLifecycle(
  featureId: string,
  effectiveStates: NativeEffectiveStateMap,
): NativeLifecycleState | null {
  const feature = getFeatureById(featureId);
  if (!feature) return null;
  return effectiveStates[featureId]?.state ?? getStaticLifecycle(feature);
}

/** Lifecycle states that should never surface a nav entry. */
const NON_VISIBLE_LIFECYCLES: NativeLifecycleState[] = [
  'planned',
  'hidden',
  'disabled',
  'deprecated',
];

/**
 * Is this entry eligible + visible for the given context? Combines:
 *  - role eligibility (manifest defaultRoles; empty ⇒ public/any),
 *  - auth requirement,
 *  - lifecycle visibility (planned/hidden/disabled/deprecated hide it),
 *  - backend effective state (enabled !== false AND visible !== false).
 */
function isEntryVisible(entry: NativeNavEntry, ctx: NativeNavContext): boolean {
  const featureId = resolveEntryOwner(entry, ctx.role);
  const feature = getFeatureById(featureId);
  if (!feature) return false; // unowned ⇒ never surface

  // Auth requirement.
  if (feature.requiresAuth && !ctx.isAuthenticated) return false;

  // Role eligibility. Empty defaultRoles ⇒ public (any/anonymous allowed).
  if (feature.defaultRoles.length > 0) {
    if (!ctx.role || !feature.defaultRoles.includes(ctx.role)) return false;
  }

  // Lifecycle visibility (effective overlay over static default).
  const lifecycle = effectiveLifecycle(featureId, ctx.effectiveStates);
  if (lifecycle && NON_VISIBLE_LIFECYCLES.includes(lifecycle)) return false;

  // Backend kill-switch / visibility overrides.
  const eff = ctx.effectiveStates[featureId];
  if (eff) {
    if (eff.enabled === false) return false;
    if (eff.visible === false) return false;
  }

  return true;
}

function resolved(entry: NativeNavEntry, role: UserRole | null): ResolvedNativeEntry {
  return { ...entry, resolvedFeatureId: resolveEntryOwner(entry, role) };
}

const MAX_TABS = 5;

/** Visible TAB entries for the context (eligibility + lifecycle + backend), capped at 5. */
export function getNativeTabs(ctx: NativeNavContext): ResolvedNativeEntry[] {
  return NATIVE_NAV.filter((e) => e.placement === 'tab')
    .filter((e) => isEntryVisible(e, ctx))
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_TABS)
    .map((e) => resolved(e, ctx.role));
}

/** Visible DRAWER entries for the context. */
export function getNativeDrawer(ctx: NativeNavContext): ResolvedNativeEntry[] {
  return NATIVE_NAV.filter((e) => e.placement === 'drawer')
    .filter((e) => isEntryVisible(e, ctx))
    .sort((a, b) => a.order - b.order)
    .map((e) => resolved(e, ctx.role));
}

/** A structural-validation violation. */
export interface NativeNavViolation {
  entryId: string;
  reason: string;
}

/**
 * Every tab/drawer entry must resolve to a real manifest feature owner under
 * the roles it can appear for. Entries with a static featureId are checked
 * directly; role-resolving entries are checked across every role.
 */
export function findUnownedNativeEntries(): NativeNavViolation[] {
  const roles: (UserRole | null)[] = [
    'owner',
    'dealer',
    'mechanic',
    'bank',
    'insurance',
    'government',
    'admin',
    null,
  ];
  const violations: NativeNavViolation[] = [];
  for (const entry of NATIVE_NAV) {
    if (entry.placement === 'none') continue; // deep-link boundaries are route-only
    if (entry.featureId) {
      if (!getFeatureById(entry.featureId)) {
        violations.push({ entryId: entry.id, reason: `unknown featureId ${entry.featureId}` });
      }
      continue;
    }
    if (entry.resolveFeatureId) {
      for (const role of roles) {
        const id = entry.resolveFeatureId(role);
        if (!getFeatureById(id)) {
          violations.push({
            entryId: entry.id,
            reason: `resolved owner ${id} (role=${role ?? 'anon'}) is not a manifest feature`,
          });
        }
      }
      continue;
    }
    violations.push({ entryId: entry.id, reason: 'no featureId and no resolveFeatureId' });
  }
  return violations;
}

/**
 * Any declared native route that is not in the set of routes the app actually
 * ships is a dead route. Returns the offending entries.
 */
export function findDeadNativeRoutes(knownRoutes: string[]): NativeNavViolation[] {
  const known = new Set(knownRoutes);
  return NATIVE_NAV.filter((e) => !known.has(e.expoRoute)).map((e) => ({
    entryId: e.id,
    reason: `expoRoute ${e.expoRoute} is not a shipped native route`,
  }));
}

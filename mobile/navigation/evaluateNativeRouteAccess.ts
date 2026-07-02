/**
 * Native route-access evaluator (Milestone A).
 *
 * The single auditable decision for a native route — drives both navigation
 * visibility and direct/deep-link access so a hidden tab and a typed route
 * resolve the same way. Mirrors the evaluation ORDER of web's `routeAccess.ts`,
 * with two native-specific additions:
 *   - `native-unavailable` when no real native screen backs the route, and
 *   - an empty effective-state map ⇒ fall back to STATIC defaults (we do NOT
 *     report `backend-inaccessible` merely because the map is empty; an empty
 *     map is the normal "static defaults" state).
 *
 * It NEVER replaces backend authorization — it only decides what native renders
 * / where it safely redirects.
 */
import type { UserRole } from '@shared/types';
import type {
  NativeRouteDecision,
  NativeEffectiveStateMap,
  NativeLifecycleState,
} from './types';
import {
  getFeatureById,
  getFeatureByRoute,
  getStaticLifecycle,
} from './featureManifest';

export interface NativeRouteAccessInput {
  /** Concrete route being evaluated (e.g. `/marketplace`, `/dashboard`). */
  route: string;
  /** Explicit owning feature id (preferred); falls back to route lookup. */
  featureId?: string;
  /** Auth still restoring/validating the session. */
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  role: UserRole | null;
  /** Backend-derived states; empty map ⇒ static defaults. */
  effectiveStates: NativeEffectiveStateMap;
  /** Does a real native screen back this route? */
  hasNativeScreen: boolean;
}

/** Where a wrong-role user is safely redirected (their own dashboard). */
function dashboardRouteForRole(role: UserRole | null): string {
  if (!role) return '/(tabs)/index';
  return '/(tabs)/index';
}

export function evaluateNativeRouteAccess(input: NativeRouteAccessInput): NativeRouteDecision {
  const {
    route,
    featureId,
    isBootstrapping,
    isAuthenticated,
    role,
    effectiveStates,
    hasNativeScreen,
  } = input;

  // 1. Never decide while the session is still bootstrapping.
  if (isBootstrapping) return { kind: 'loading' };

  // 2. Resolve the owning feature (by explicit id first, else by route).
  const feature = featureId ? getFeatureById(featureId) : getFeatureByRoute(route);

  // No native screen backs this route ⇒ unavailable (even if the feature is
  // governed/active on web). Checked before deeper gates so we never imply a
  // screen exists that doesn't.
  if (!hasNativeScreen) return { kind: 'native-unavailable' };

  // Unregistered route with a native screen: render (the router owns it).
  if (!feature) return { kind: 'render' };

  const eff = effectiveStates[feature.id];
  const lifecycle: NativeLifecycleState = eff?.state ?? getStaticLifecycle(feature);

  // 3. Runtime kill-switch blocks DIRECT access too.
  if (eff?.enabled === false) return { kind: 'disabled' };

  // 4. Lifecycle gates that apply regardless of authentication.
  if (lifecycle === 'planned') return { kind: 'planned' };
  if (lifecycle === 'hidden') return { kind: 'hidden' };
  if (lifecycle === 'disabled') return { kind: 'disabled' };
  if (lifecycle === 'deprecated') {
    const to = eff?.deprecatedTo;
    return { kind: 'deprecated', to };
  }

  // 5. Authentication + role for PROTECTED features.
  if (feature.requiresAuth) {
    if (!isAuthenticated || !role) return { kind: 'redirect-auth' };
    if (feature.defaultRoles.length > 0 && !feature.defaultRoles.includes(role)) {
      return { kind: 'redirect-role', to: dashboardRouteForRole(role) };
    }
  }

  // 6. Effective accessibility (tenant/env/time denial) — applies to every
  // registered feature once eligibility above has passed.
  if (eff && eff.accessible === false) return { kind: 'disabled' };

  // 7. Beta → render with a notice.
  if (lifecycle === 'beta' || eff?.beta === true) {
    return { kind: 'render-beta', message: eff?.betaMessage };
  }

  // 8. Active ⇒ render.
  return { kind: 'render' };
}

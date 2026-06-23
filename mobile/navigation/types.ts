/**
 * Native navigation type contracts (Milestone A).
 *
 * These mirror the governed feature truth that web consumes (shared manifest +
 * backend effective states) but are native-safe: no react-dom / lucide / DOM
 * imports. The native app renders only screens that actually exist; this layer
 * decides what is shown and how a direct route resolves, in agreement with web.
 */
import type { UserRole } from '@shared/types';

/** Lifecycle a feature may be in (mirror of the shared manifest + backend). */
export type NativeLifecycleState =
  | 'active'
  | 'beta'
  | 'planned'
  | 'hidden'
  | 'disabled'
  | 'deprecated';

/** One entry of the shared feature manifest (`shared/navigation/feature-manifest.json`). */
export interface NativeFeatureManifestEntry {
  id: string;
  domain: string;
  route: string;
  defaultLifecycle: NativeLifecycleState;
  defaultRoles: string[];
  immutableRoles: string[];
  requiresAuth: boolean;
  betaCapable: boolean;
}

/**
 * Backend-derived effective state for a feature (sanitized — no internal admin
 * notes). Mirror of `EffectiveFeatureState` on web / backend featureGovernance.
 */
export interface NativeEffectiveState {
  featureId: string;
  state: NativeLifecycleState;
  enabled: boolean;
  visible: boolean;
  accessible: boolean;
  beta: boolean;
  deprecatedTo?: string;
  betaMessage?: string;
}

/** Effective states keyed by feature id (empty map ⇒ use static defaults). */
export type NativeEffectiveStateMap = Record<string, NativeEffectiveState>;

/** Where a native nav entry surfaces. `none` = route boundary only (deep link). */
export type NativePlacement = 'tab' | 'drawer' | 'none';

/**
 * A native navigation entry. Maps an Expo Router route to its owning governed
 * feature. Ownership is mandatory: either a static `featureId` OR a
 * role-resolving `resolveFeatureId` (e.g. the role dashboard) must be provided,
 * so every surfaced entry is traceable to a manifest feature.
 */
export interface NativeNavEntry {
  id: string;
  expoRoute: string;
  featureId?: string;
  resolveFeatureId?: (role: UserRole | null) => string;
  label: string;
  iconName: string;
  placement: NativePlacement;
  section?: string;
  order: number;
}

/** Inputs the selectors evaluate eligibility/visibility against. */
export interface NativeNavContext {
  isAuthenticated: boolean;
  role: UserRole | null;
  environment: string;
  effectiveStates: NativeEffectiveStateMap;
}

/**
 * The single auditable decision for a native route — drives both navigation
 * visibility and direct/deep-link access so a hidden tab and a typed route
 * resolve the same way. Discriminated union on `kind`.
 */
export type NativeRouteDecision =
  | { kind: 'loading' }
  | { kind: 'render' }
  | { kind: 'render-beta'; message?: string }
  | { kind: 'redirect-auth' }
  | { kind: 'redirect-role'; to: string }
  | { kind: 'planned' }
  | { kind: 'hidden' }
  | { kind: 'disabled' }
  | { kind: 'deprecated'; to?: string }
  | { kind: 'backend-inaccessible' }
  | { kind: 'native-unavailable' };

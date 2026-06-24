/**
 * Pure, framework-neutral route-access evaluator (Milestone 5).
 *
 * This is the single auditable decision used by BOTH navigation visibility and
 * direct route access, so a link you cannot see and a URL you type resolve the
 * same way. It NEVER replaces backend authorization — it only decides what the
 * frontend renders / where it safely redirects.
 *
 * Evaluation order:
 *   1. auth still bootstrapping?      → loading (never premature redirect)
 *   2. route registered?              → unregistered public renders; unregistered protected → login
 *   3. lifecycle planned/disabled?    → planned / disabled page (regardless of auth)
 *   4. lifecycle deprecated + target? → redirect to deprecation target
 *   5. requires auth + no user?       → login with sanitized return-to
 *   6. requires auth + wrong role?    → safe redirect to the user's own dashboard
 *   7. lifecycle beta?                → render with beta notice
 *   8. otherwise                      → render
 */
import type { UserRole } from '@shared/types'
import {
  getFeatureByRoute,
  getFeatureById,
  isPublicRoute,
  matchRoutePattern,
  getStaticLifecycle,
  getDashboardRoute,
  type FeatureRegistryItem,
  type EffectiveFeatureState,
  type FeatureLifecycleState,
} from '@/config/featureRegistry'
import { safeReturnTo } from '@/lib/returnTo'

/**
 * Legacy `/marketplace/*` sub-routes that App.tsx wires directly to the
 * VehicleDetail page but that the Feature Registry does NOT model as their own
 * first-class, governed feature. They must inherit the Marketplace product's
 * effective lifecycle/enabled/accessibility so a disabled or tenant-denied
 * Marketplace cannot still render vehicle detail by typing (or refreshing) the
 * URL — keeping direct route access in agreement with navigation visibility.
 *
 * This is a deterministic, ORDERED resolution table (most specific first):
 *   - `/marketplace/listing/:id` is genuinely unregistered, so it resolves
 *     before `/marketplace/:id`.
 *   - `/marketplace/:id` happens to also match the placeholder
 *     `public.vehicle-detail` registry entry, which has no independent
 *     governance intent of its own; binding it here makes the Marketplace
 *     product its single authoritative owner (no duplicate competing active
 *     feature is introduced).
 *
 * Crucially this is consulted only AFTER `getFeatureByRoute`, and only for
 * routes that are either unregistered or the un-governed vehicle-detail
 * placeholder. Genuinely-registered siblings — `/marketplace/parts`
 * (product.marketplace-parts) and `/marketplace/services`
 * (product.marketplace-services) — resolve to their OWN features and never fall
 * through here. Unrelated dynamic routes (e.g. `/dashboard/garage/:id`) are not
 * listed and therefore never bound to Marketplace.
 */
const LEGACY_ROUTE_OWNERS: ReadonlyArray<{ pattern: string; featureId: string }> = [
  { pattern: '/marketplace/listing/:id', featureId: 'product.marketplace' },
  { pattern: '/marketplace/:id', featureId: 'product.marketplace' },
]

/**
 * Feature ids that, although present in the registry, are un-governed legacy
 * placeholders deferring to a legacy owner (see {@link LEGACY_ROUTE_OWNERS}).
 * When `getFeatureByRoute` resolves to one of these, the legacy table — not the
 * placeholder — decides governance.
 */
const LEGACY_PLACEHOLDER_FEATURE_IDS: ReadonlySet<string> = new Set(['public.vehicle-detail'])

/**
 * Resolve the legacy owning feature for a route, or undefined when none applies.
 * Deterministic and ordered (most specific pattern first). Returns the OWNING
 * registry feature so the SAME gate logic that runs for a registered feature can
 * be reused against the owner's id (static lifecycle + `effectiveStates[ownerId]`).
 */
function resolveLegacyOwner(route: string): FeatureRegistryItem | undefined {
  for (const { pattern, featureId } of LEGACY_ROUTE_OWNERS) {
    if (matchRoutePattern(pattern, route)) return getFeatureById(featureId)
  }
  return undefined
}

export type RouteDecision =
  | { kind: 'loading' }
  | { kind: 'render' }
  | { kind: 'render-beta'; message?: string }
  | { kind: 'redirect'; to: string; reason: 'auth' | 'role' | 'deprecated' }
  | { kind: 'planned' }
  | { kind: 'disabled' }

export interface RouteAccessInput {
  /** Current pathname (no query). */
  route: string
  /** Auth still restoring/validating the session. */
  isBootstrapping: boolean
  isAuthenticated: boolean
  role: UserRole | null
  /** Backend-derived effective states keyed by feature id (optional; static defaults otherwise). */
  effectiveStates?: Record<string, EffectiveFeatureState>
  /**
   * Enforce authentication/role redirects (default true). The public layout
   * passes `false` to do lifecycle-only gating without changing existing
   * public-page behavior; the dashboard layout passes `true`.
   */
  enforceAuth?: boolean
}

/** Build a safe login redirect that preserves a sanitized return-to. */
export function loginWithReturnTo(route: string): string {
  const safe = safeReturnTo(route, '')
  return safe ? `/login?returnTo=${encodeURIComponent(safe)}` : '/login'
}

function effectiveState(
  featureId: string,
  fallback: FeatureLifecycleState,
  effectiveStates?: Record<string, EffectiveFeatureState>,
): FeatureLifecycleState {
  return effectiveStates?.[featureId]?.state ?? fallback
}

export function evaluateRouteAccess(input: RouteAccessInput): RouteDecision {
  const { route, isBootstrapping, isAuthenticated, role, effectiveStates } = input
  const enforceAuth = input.enforceAuth ?? true

  // 1. Never decide an AUTH outcome while the session is bootstrapping. Public
  // (lifecycle-only) evaluation does not wait — public content renders at once.
  if (isBootstrapping && enforceAuth) return { kind: 'loading' }

  const direct = getFeatureByRoute(route)

  // 2a. Legacy `/marketplace/*` vehicle-detail sub-routes (see LEGACY_ROUTE_OWNERS)
  // are NOT modeled as their own governed feature, so bind them to their owning
  // product (product.marketplace) and evaluate them with the EXACT same gates as
  // a registered feature. This is consulted only when the direct match is either
  // unregistered (e.g. `/marketplace/listing/:id`) or the un-governed
  // vehicle-detail placeholder (`/marketplace/:id`) — registered siblings like
  // `/marketplace/parts` and `/marketplace/services` keep their own behavior.
  const feature =
    !direct || LEGACY_PLACEHOLDER_FEATURE_IDS.has(direct.id)
      ? resolveLegacyOwner(route) ?? direct
      : direct

  // 2b. Still-unregistered route: public renders (router owns it); protected → login.
  if (!feature) {
    return isPublicRoute(route)
      ? { kind: 'render' }
      : { kind: 'redirect', to: loginWithReturnTo(route), reason: 'auth' }
  }

  const state = effectiveState(feature.id, getStaticLifecycle(feature), effectiveStates)

  // 3. Lifecycle gates that apply regardless of authentication.
  // A runtime kill-switch (override enabled:false) blocks DIRECT access too, so a
  // link removed from navigation cannot still be reached by typing the URL. The
  // `enabled` flag is role-independent in the sanitized effective state; tenant
  // gating remains BACKEND-authoritative (tenant lists are intentionally not sent
  // to the client, so the SPA cannot — and must not — re-derive them).
  if (effectiveStates?.[feature.id]?.enabled === false) return { kind: 'disabled' }
  if (state === 'planned') return { kind: 'planned' }
  if (state === 'disabled') return { kind: 'disabled' }

  // 4. Deprecated with a destination → safe redirect (prevent self-loop).
  if (state === 'deprecated') {
    const to = effectiveStates?.[feature.id]?.deprecatedTo ?? feature.deprecatedTo
    if (to && to !== route) return { kind: 'redirect', to, reason: 'deprecated' }
    // deprecated without a target renders normally (a notice can be shown by the UI).
  }

  // 5. Authentication + role for PROTECTED features (when enforcing).
  if (enforceAuth && feature.requiresAuth) {
    if (!isAuthenticated || !role) {
      return { kind: 'redirect', to: loginWithReturnTo(route), reason: 'auth' }
    }
    if (!feature.roles.includes(role)) {
      return { kind: 'redirect', to: getDashboardRoute(role), reason: 'role' }
    }
  }

  // 6. Effective accessibility — applies to EVERY registered feature, PUBLIC or
  // protected (this is the fix: the check is no longer skipped for public
  // routes). For a protected feature the auth/role gate above has already run, so
  // reaching here means eligible and a remaining `accessible:false` is a tenant /
  // env / time denial → unavailable. For a PUBLIC feature there is no auth gate,
  // so this is the sole place its effective accessibility is enforced — keeping
  // direct route access in agreement with navigation visibility. A protected
  // feature under a lifecycle-only boundary (enforceAuth=false) is left to
  // backend authority (its auth/role was intentionally not gated here).
  const eff = effectiveStates?.[feature.id]
  if (eff && eff.accessible === false && (!feature.requiresAuth || enforceAuth)) {
    return { kind: 'disabled' }
  }

  // 7. Beta → render with a notice. The admin-configured banner text is carried
  // by the sanitized `betaMessage` field (`reasonCode` is internal and stripped).
  if (state === 'beta') {
    return { kind: 'render-beta', message: effectiveStates?.[feature.id]?.betaMessage }
  }

  // 8. Active / hidden / deprecated-without-target → render.
  return { kind: 'render' }
}

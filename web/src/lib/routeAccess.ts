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
  isPublicRoute,
  getStaticLifecycle,
  getDashboardRoute,
  type EffectiveFeatureState,
  type FeatureLifecycleState,
} from '@/config/featureRegistry'
import { safeReturnTo } from '@/lib/returnTo'

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

  const feature = getFeatureByRoute(route)

  // 2. Unregistered route: public renders (router owns it); protected → login.
  if (!feature) {
    return isPublicRoute(route)
      ? { kind: 'render' }
      : { kind: 'redirect', to: loginWithReturnTo(route), reason: 'auth' }
  }

  const state = effectiveState(feature.id, getStaticLifecycle(feature), effectiveStates)

  // 3. Lifecycle gates that apply regardless of authentication.
  if (state === 'planned') return { kind: 'planned' }
  if (state === 'disabled') return { kind: 'disabled' }

  // 4. Deprecated with a destination → safe redirect (prevent self-loop).
  if (state === 'deprecated') {
    const to = effectiveStates?.[feature.id]?.deprecatedTo ?? feature.deprecatedTo
    if (to && to !== route) return { kind: 'redirect', to, reason: 'deprecated' }
    // deprecated without a target renders normally (a notice can be shown by the UI).
  }

  // 5/6. Authentication + role (frontend gate mirroring — backend remains authoritative).
  if (enforceAuth && feature.requiresAuth) {
    if (!isAuthenticated || !role) {
      return { kind: 'redirect', to: loginWithReturnTo(route), reason: 'auth' }
    }
    if (!feature.roles.includes(role)) {
      return { kind: 'redirect', to: getDashboardRoute(role), reason: 'role' }
    }
  }

  // 7. Beta → render with a notice.
  if (state === 'beta') {
    return { kind: 'render-beta', message: effectiveStates?.[feature.id]?.reasonCode }
  }

  // 8. Active / hidden / deprecated-without-target → render.
  return { kind: 'render' }
}

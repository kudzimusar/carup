/**
 * CA-K3-01 — Corporate Admin access foundation.
 *
 * TEMPORARY COMPATIBILITY BRIDGE (documented per CA-K3-01 §6, CA-RBAC-01 §19 Phase 0):
 *
 *   Corporate Admin opens ONLY for a person whom the existing, server-derived `/admin` route decision
 *   would admit (feature `admin.overview`, roles ['admin'] — the narrowest existing platform check;
 *   backend `admin` / `platform_admin` / `super_admin` normalise to it). Government, reviewer, tenant
 *   and every other role are refused exactly as `/admin` refuses them.
 *
 *   That bridge yields a READ-ONLY navigation grant (`*.read` / aggregate capabilities only — never
 *   manage / act / approve / export). It is not a Corporate membership or a permission assignment and
 *   it says so wherever it is shown. Backend authorization remains authoritative for every request.
 *
 * The grant is the seam the future Corporate permission evaluator replaces: navigation visibility is
 * decided only from `grant.capabilities`, never from a title, name, label or client-selected context.
 * If authority cannot be established, the grant is empty and everything fails closed.
 */
import type { UserRole } from '@shared/types'
import { evaluateRouteAccess, type RouteDecision } from '@/lib/routeAccess'
import type { ActiveTenantScope, EffectiveFeatureState } from '@/config/featureRegistry'
import { CORPORATE_DESTINATIONS, type CorporateDestination } from '@/config/corporate/navigation'

/** The ONLY route decision the bridge consults. */
export const CORPORATE_COMPATIBILITY_GATE_ROUTE = '/admin'

export type CorporateGrantSource = 'legacy_admin_compatibility_bridge' | 'none'

export interface CorporateGrant {
  source: CorporateGrantSource
  capabilities: ReadonlySet<string>
  /** Human statement of where authority came from, for the account affordance. */
  explanation: string
}

export const EMPTY_GRANT: CorporateGrant = Object.freeze({
  source: 'none',
  capabilities: new Set<string>(),
  explanation: 'No Corporate Admin authority.',
}) as CorporateGrant

/** Read-only capabilities for the ten destinations — no manage/act/approve/export/publish. */
const BRIDGE_READ_CAPABILITIES: readonly string[] = Object.freeze(
  Array.from(new Set(CORPORATE_DESTINATIONS.flatMap((d) => d.navCapabilities))),
)

export interface CorporateAccessInput {
  isBootstrapping: boolean
  isAuthenticated: boolean
  /** Server-derived platform role from the authenticated session (AuthContext). */
  role: UserRole | string | null
  activeTenant?: ActiveTenantScope | null
  effectiveStates?: Record<string, EffectiveFeatureState>
}

export type CorporateAccessDecision =
  | { kind: 'loading' }
  | { kind: 'redirect'; to: string; reason: 'auth' | 'role' | 'deprecated' }
  | { kind: 'unavailable'; detail: 'planned' | 'disabled' }
  | { kind: 'render'; grant: CorporateGrant }

/**
 * Decide Corporate access from the SAME route-access decision `/admin` uses. Only an explicit
 * `render` admits; every other outcome — loading, redirect, planned, disabled — denies.
 */
export function resolveCorporateAccess(input: CorporateAccessInput): CorporateAccessDecision {
  const decision: RouteDecision = evaluateRouteAccess({
    route: CORPORATE_COMPATIBILITY_GATE_ROUTE,
    isBootstrapping: input.isBootstrapping,
    isAuthenticated: input.isAuthenticated,
    role: (input.role as UserRole) ?? null,
    activeTenant: input.activeTenant ?? null,
    effectiveStates: input.effectiveStates,
    enforceAuth: true,
  })
  switch (decision.kind) {
    case 'loading':
      return { kind: 'loading' }
    case 'redirect':
      return decision.reason === 'auth'
        // Return the person to the Corporate page they asked for, not to /admin.
        ? { kind: 'redirect', to: '/login', reason: 'auth' }
        : { kind: 'redirect', to: decision.to, reason: decision.reason }
    case 'planned':
    case 'disabled':
      return { kind: 'unavailable', detail: decision.kind }
    case 'render':
    case 'render-beta':
      return {
        kind: 'render',
        grant: {
          source: 'legacy_admin_compatibility_bridge',
          capabilities: new Set(BRIDGE_READ_CAPABILITIES),
          explanation:
            'Access via the legacy Admin compatibility bridge (platform administrator). This is not a Corporate membership or a permission assignment; read-only navigation only.',
        },
      }
    default:
      return { kind: 'redirect', to: '/', reason: 'role' }
  }
}

/** Navigation visibility: a destination is shown only when the grant holds one of its capabilities. */
export function canSeeDestination(grant: CorporateGrant, destination: Pick<CorporateDestination, 'navCapabilities'>): boolean {
  return destination.navCapabilities.some((c) => grant.capabilities.has(c))
}

export function visibleDestinations(grant: CorporateGrant): CorporateDestination[] {
  return CORPORATE_DESTINATIONS.filter((d) => canSeeDestination(grant, d))
}

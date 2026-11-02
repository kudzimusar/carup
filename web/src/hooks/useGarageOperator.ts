import { useAuth } from '@/context/AuthContext'
import { FEATURE_REGISTRY, activeTenantScopeOf, isFeatureRoleEligible } from '@/config/featureRegistry'

/**
 * Is the person signed in here acting as garage staff? (R5)
 *
 * Owner UAT: a garage tenant-member signing in landed on the OWNER dashboard — a screen about
 * selling their own car — because the browser had no way to tell the two apart. Public registration
 * only ever creates an `owner`, so garage staff who signed up through the product are platform-role
 * `owner` with a garage membership: exactly the case a role check cannot see.
 *
 * This still does not decide anything. The SERVER decides: OC-5D's session carries the organisation
 * the person SELECTED (PUT /api/auth/active-tenant), re-verified on every request, with its type and
 * the person's role inside it. A person who belongs to a garage but is acting for themselves is not
 * operating as the garage — they are offered it (ActiveOrganisationPrompt), never moved into it.
 * And "staff" means the registry's own workshop rule, so a garage 'member' outside the workspace is
 * not sent to a workspace every API route would refuse them.
 *
 * `checking` still exists and still moves nobody: a session that has not finished bootstrapping has
 * no selection yet, and routing someone on an answer that has not arrived is how a person ends up
 * bounced between two dashboards.
 */
export type GarageOperatorState = 'checking' | 'garage' | 'not_garage' | 'unknown'

const WORKSHOP = FEATURE_REGISTRY.find((f) => f.id === 'garage.workshop')

export function useGarageOperator(): { state: GarageOperatorState; garageName: string | null } {
  const { user, loading } = useAuth()

  if (loading) return { state: 'checking', garageName: null }
  if (!user) return { state: 'not_garage', garageName: null }

  const activeTenant = activeTenantScopeOf(user)
  const isGarage = Boolean(user.active_tenant_id && WORKSHOP && activeTenant)
    && isFeatureRoleEligible({ ...WORKSHOP!, roles: [] }, { activeTenant })
  return {
    state: isGarage ? 'garage' : 'not_garage',
    garageName: isGarage ? (user.active_tenant?.name ?? null) : null,
  }
}

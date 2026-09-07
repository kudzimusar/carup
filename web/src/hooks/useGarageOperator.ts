import { useAuth } from '@/context/AuthContext'

/**
 * Is the person signed in here garage staff? (R5)
 *
 * Owner UAT: a garage tenant-member signing in landed on the OWNER dashboard — a screen about
 * selling their own car — because the browser had no way to tell the two apart. Public registration
 * only ever creates an `owner`, so garage staff who signed up through the product are platform-role
 * `owner` with a garage membership: exactly the case a role check cannot see.
 *
 * This still does not decide anything. The SERVER decides: `/auth/me` and `/auth/login` report the
 * caller's verified `tenant_users` membership, including what kind of tenant it is, and this reads
 * that answer. It used to ask the same question over the network with a `/api/garage/profile` probe;
 * the answer now arrives with the session, so the probe was a round trip on every dashboard load
 * plus a failure mode of its own, for a fact already in hand.
 *
 * `unknown` still exists and still moves nobody. A session that has not finished bootstrapping has
 * no membership yet, and routing someone on the strength of an answer that has not arrived is how a
 * person ends up bounced between two dashboards.
 */
export type GarageOperatorState = 'checking' | 'garage' | 'not_garage' | 'unknown'

export function useGarageOperator(): { state: GarageOperatorState; garageName: string | null } {
  const { user, loading } = useAuth()

  if (loading) return { state: 'checking', garageName: null }
  if (!user) return { state: 'not_garage', garageName: null }

  // A membership of any other kind of tenant is not a garage, and says so.
  const isGarage = user.active_tenant_type === 'garage' && Boolean(user.active_tenant_id)
  return {
    state: isGarage ? 'garage' : 'not_garage',
    garageName: isGarage ? (user.active_tenant_name ?? null) : null,
  }
}

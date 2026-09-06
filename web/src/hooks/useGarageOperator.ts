import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Is the person signed in here garage staff? (R5)
 *
 * Owner UAT: a garage tenant-member signing in landed on the OWNER dashboard — a screen about
 * selling their own car — because the browser has no way to tell the two apart. `AuthUser` carries
 * a platform role and an `active_tenant_id`, and nothing about what that tenant IS. Public
 * registration always creates an `owner`, so garage staff who signed up through the product are
 * platform-role `owner` with a garage membership: exactly the case the role check cannot see.
 *
 * So this asks the server rather than guessing. `GET /api/garage/profile` runs `requireTenantContext`
 * and `assertGarageTenant`, which is precisely the question "are you garage staff", already
 * certified and already the authority. The browser does not decide; it reads the answer.
 *
 * A user with no tenant at all is answered without a request — an ordinary car owner never pays for
 * this probe. A failed probe answers `unknown`, never `garage`: an unreachable server must not
 * route someone into a workspace, and must not route garage staff out of one.
 */
export type GarageOperatorState = 'checking' | 'garage' | 'not_garage' | 'unknown'

export function useGarageOperator(): { state: GarageOperatorState; garageName: string | null } {
  const { user } = useAuth()
  const { fetchMyGarageProfile } = useCarUpApi()
  // Only the PROBE holds state. Whether someone can even be garage staff is a fact about the
  // session, so it is derived below rather than written into state from inside an effect.
  const [probe, setProbe] = useState<GarageOperatorState>('checking')
  const [garageName, setGarageName] = useState<string | null>(null)

  const tenantId = user?.active_tenant_id ?? null
  const couldBeGarage = Boolean(user && tenantId)

  useEffect(() => {
    let mounted = true
    // No user, or no tenant membership: no garage, and no request made.
    if (!couldBeGarage) return () => { mounted = false }
    fetchMyGarageProfile()
      .then((res) => {
        if (!mounted) return
        setGarageName(res?.profile?.display_name ?? res?.tenant?.name ?? null)
        setProbe('garage')
      })
      .catch((err: unknown) => {
        if (!mounted) return
        const message = err instanceof Error ? err.message : ''
        // A refusal is a real answer: this tenant is not a garage, or this person may not act for
        // it. Anything else (network, 500) is unknown — and unknown never moves anybody.
        setProbe(/not a garage|forbidden|not permitted|requires|tenant/i.test(message) ? 'not_garage' : 'unknown')
      })
    return () => { mounted = false }
  }, [couldBeGarage, fetchMyGarageProfile])

  return { state: couldBeGarage ? probe : 'not_garage', garageName }
}

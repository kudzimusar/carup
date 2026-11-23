/**
 * Dealership 1.0 — canonical, server-enforced operational workspace authority.
 *
 * SINGLE SOURCE OF TRUTH for "is this session an active, independently approved
 * dealership organization owner with confirmed canonical owner membership?"
 * Both the legacy `DealerCanonicalWorkspaceLayout` and the S1-4B unified
 * `WorkspaceDealerUnifiedShell` consume this hook, so the exact same server
 * call (`GET /dealer/operational-workspace`) and the exact same eligibility
 * decision gate both presentations. Authorization semantics are NOT altered,
 * copied or weakened here: the backend remains authoritative, the eligibility
 * checks are identical to the pre-S1-4B layout, and route changes revalidate
 * (a previously accepted session cannot reuse a prior URL's result).
 *
 * No role promotion, seller listing, payments or public approval is performed.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import { isNetworkFailure } from '@/components/trade/core/readFailure'

export interface VerifiedDealerWorkspace {
  actor_id: string
  operational: boolean
  owner_membership_confirmed: boolean
  tenant_id: string
  organization_id: string
  dealer_profile_id: string
  profile: { legal_name?: string; trading_name?: string }
}

export type DealerWorkspaceStatus =
  | 'bootstrapping'   // auth session still restoring — never redirect prematurely
  | 'guest'           // no session — caller renders the canonical login redirect
  | 'verifying'       // session exists; server workspace check in flight
  | 'unauthorized'    // server returned no eligible workspace — NOT operating-authorized
  | 'check-failed'    // RX06-LR06: the check could not be done — NOT a decision about the dealership
  | 'ready'           // server-verified workspace available

/**
 * RX06-LR06 (Owner decision N2) — why a dealership status check failed when the failure is NOT the server's answer
 * that this session has no approved dealership. Authorization is unchanged: every one of these still renders no
 * dealer data; only the words differ, so an approved dealership is never told it is unapproved because its status
 * request failed.
 */
export type DealerStatusCheckFailure =
  | 'unavailable'     // the server could not answer (5xx or an unexpected answer)
  | 'throttled'       // 429: too many requests from this connection
  | 'offline'         // no answer reached this device
  | 'session'         // 401: the session has ended
  | 'denied'          // 403 for a reason other than an inactive dealership authority
  | 'multiple'        // 409: more than one dealership is linked and the workspace cannot choose

/** The server's own "no approved dealership" answers (dealerVerifiedWorkspaceService.js). */
const GENUINELY_NOT_APPROVED = new Set(['NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP', 'CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE'])

/** null = the server answered that this session has no approved, active dealership (the existing "unavailable" state). */
export function classifyDealerStatusFailure(err: unknown): DealerStatusCheckFailure | null {
  const e = (err ?? {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown }
  const status = typeof e.status === 'number' ? e.status : undefined
  const message = typeof e.message === 'string' ? e.message : ''
  const code = typeof e.code === 'string' && e.code ? e.code : message
  if (GENUINELY_NOT_APPROVED.has(code) || status === 404) return null
  if (status === 409) return 'multiple'
  if (status === 401 || e.name === 'SessionExpiredError') return 'session'
  if (status === 403) return 'denied'
  if (status === 429) return 'throttled'
  if (isNetworkFailure(status, message)) return 'offline'
  return 'unavailable'
}

export interface DealerWorkspaceState {
  status: DealerWorkspaceStatus
  /** Present only when status === 'ready' (server-verified, never client-invented). */
  workspace: VerifiedDealerWorkspace | null
  /** Present only when status === 'check-failed'. */
  failure?: DealerStatusCheckFailure
  /** Ask the server again (same request, same eligibility rule). */
  retry?: () => void
}

const API = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname,
)

/**
 * Canonical dealership operations destinations. Both the legacy canonical
 * layout nav and the unified workspace rail project from this one list, so the
 * two surfaces can never drift apart. These are NAVIGATION only — each target
 * route keeps its own existing guard.
 */
export const DEALER_OPERATION_LINKS: ReadonlyArray<{ id: string; label: string; href: string }> = [
  { id: 'dashboard', label: 'Dashboard', href: '/dealer/dashboard' },
  { id: 'operating-details', label: 'Operating details', href: '/dealers/operating-details' },
  { id: 'staff', label: 'Staff', href: '/dealers/staff' },
  { id: 'stock', label: 'Inventory', href: '/dealers/stock' },
  { id: 'inquiries', label: 'Buyer inquiries', href: '/dealers/inquiries' },
  { id: 'billing', label: 'Billing readiness', href: '/dealers/billing' },
]

export function useDealerOperationalWorkspace(): DealerWorkspaceState {
  const { user, token, loading } = useAuth()
  const location = useLocation()
  // Route changes must revalidate active legal/tenant authority. A previously
  // accepted session cannot reuse a prior URL's authorization result.
  // RX06-LR06: a retry asks again under a new key, so it shows "verifying" instead of the previous answer.
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])
  const subject = user?.id && token ? user.id + ':' + token + ':' + location.pathname + '#' + attempt : null
  const [access, setAccess] = useState<{ subject: string; workspace: VerifiedDealerWorkspace | null; failure: DealerStatusCheckFailure | null }>({
    subject: '',
    workspace: null,
    failure: null,
  })

  useEffect(() => {
    if (!user?.id || !token || !subject) return
    let mounted = true
    const authHeaders: AuthHeaders = { 'x-session-token': token, 'x-user-id': user.id }
    apiRequest<{ workspace: VerifiedDealerWorkspace }>({
      baseUrl: API,
      path: '/dealer/operational-workspace',
      authHeaders,
    })
      .then(result => {
        if (!mounted) return
        const workspace = result.workspace
        const eligible =
          workspace?.operational === true &&
          workspace.owner_membership_confirmed === true &&
          workspace.actor_id === user.id &&
          Boolean(workspace.tenant_id && workspace.organization_id && workspace.dealer_profile_id)
        setAccess({ subject, workspace: eligible ? workspace : null, failure: null })
      })
      .catch(err => {
        // Fail closed either way (no workspace); remember WHY, so a failed check is never worded as "not approved".
        if (mounted) setAccess({ subject, workspace: null, failure: classifyDealerStatusFailure(err) })
      })
    return () => {
      mounted = false
    }
  }, [subject, user?.id, token])

  if (loading) return { status: 'bootstrapping', workspace: null }
  if (!user || !token) return { status: 'guest', workspace: null }
  if (access.subject !== subject) return { status: 'verifying', workspace: null }
  if (!access.workspace && access.failure) return { status: 'check-failed', workspace: null, failure: access.failure, retry }
  if (!access.workspace) return { status: 'unauthorized', workspace: null }
  return { status: 'ready', workspace: access.workspace }
}

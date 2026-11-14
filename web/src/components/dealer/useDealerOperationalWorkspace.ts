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
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'

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
  | 'ready'           // server-verified workspace available

export interface DealerWorkspaceState {
  status: DealerWorkspaceStatus
  /** Present only when status === 'ready' (server-verified, never client-invented). */
  workspace: VerifiedDealerWorkspace | null
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
  const subject = user?.id && token ? user.id + ':' + token + ':' + location.pathname : null
  const [access, setAccess] = useState<{ subject: string; workspace: VerifiedDealerWorkspace | null }>({
    subject: '',
    workspace: null,
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
        setAccess({ subject, workspace: eligible ? workspace : null })
      })
      .catch(() => {
        if (mounted) setAccess({ subject, workspace: null })
      })
    return () => {
      mounted = false
    }
  }, [subject, user?.id, token])

  if (loading) return { status: 'bootstrapping', workspace: null }
  if (!user || !token) return { status: 'guest', workspace: null }
  if (access.subject !== subject) return { status: 'verifying', workspace: null }
  if (!access.workspace) return { status: 'unauthorized', workspace: null }
  return { status: 'ready', workspace: access.workspace }
}

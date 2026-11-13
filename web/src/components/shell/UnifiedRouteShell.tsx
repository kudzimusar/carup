/**
 * RX-02A S1-4B — Route-family presentation switch (DEFAULT-OFF candidate).
 *
 * Wraps a route family and renders the approved unified shell chrome AROUND
 * the real page (`<Outlet />`) when — and only when — the isolated presentation
 * flag is opted in. When the flag is off (the default in every environment),
 * it renders the preserved legacy layout unchanged, so existing users see
 * exactly what they see today.
 *
 * CRITICAL: the legacy fallback here is the SAME element the route used before
 * (e.g. <MainLayout /> / <DealerCanonicalWorkspaceLayout />). Authorization is
 * never owned by this wrapper:
 *   - Public + Focused + personal-Workspace render the page directly and rely
 *     on the page / RegistryRouteBoundary for any access decision (unchanged).
 *   - Dealer workspace RE-WRAPS the canonical guard: <DealerCanonicalWorkspaceLayout>
 *     is rendered INSIDE the workspace chrome, so its server-side tenant /
 *     compliance / owner-membership check still runs and still gates the page.
 *     The shell only changes chrome around an already-authorized surface; it
 *     never bypasses the guard.
 *
 * Rollback is presentation-only: flag off ⇒ legacy layout, zero data effect.
 */
import type { ReactElement } from 'react'
import { Outlet, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import DealerCanonicalWorkspaceLayout from '@/components/dealer/DealerCanonicalWorkspaceLayout'
import { PublicShell } from './PublicShell'
import type { PublicIdentity } from './PublicShell'
import { WorkspaceShell } from './WorkspaceShell'
import { FocusedShell } from './FocusedShell'
import { isUnifiedUiEnabled } from './unifiedFlag'
import type { ShellNavSection, ShellObjectIdentity, ShellPrimaryAction } from './contracts'

type Family = 'public' | 'focused' | 'workspace-personal' | 'workspace-dealer'

function useIdentity(): { displayName: string; isAuthenticated: boolean } {
  const { user, isAuthenticated } = useAuth()
  return {
    displayName: user?.name ?? 'Visitor',
    isAuthenticated,
  }
}

/** Public showroom chrome: real marketplace / vehicle pages render beneath. */
function PublicUnifiedShell() {
  const identity = useIdentity()
  const location = useLocation()
  const publicIdentity: PublicIdentity = {
    displayName: identity.displayName,
    isAuthenticated: identity.isAuthenticated,
  }
  return (
    <PublicShell identity={publicIdentity} currentPath={location.pathname}>
      <Outlet />
    </PublicShell>
  )
}

/** Focused chrome for auth / account-recovery: the page's own form renders beneath. */
function FocusedUnifiedShell({ title, stepLabel }: { title: string; stepLabel?: string }) {
  const identity = useIdentity()
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <FocusedShell
      identity={{ displayName: identity.displayName, roleTitle: identity.isAuthenticated ? 'Signed in' : 'Visitor' }}
      title={title}
      stepLabel={stepLabel}
      onExit={() => navigate(safeReturnTarget(location))}
    >
      <Outlet />
    </FocusedShell>
  )
}

function safeReturnTarget(location: Location): string {
  // Prefer going back to where the user was headed; never invent an external URL.
  return location.state && typeof location.state === 'object' && 'from' in location.state
    ? String((location.state as { from?: unknown }).from ?? '/')
    : '/'
}

/** Personal workspace chrome (My CarUp). The page renders beneath; access is unchanged. */
function WorkspacePersonalUnifiedShell() {
  const identity = useIdentity()
  const location = useLocation()
  const object: ShellObjectIdentity = {
    title: 'My CarUp',
    reference: 'personal',
    statusLabel: 'Signed in',
    statusTone: 'neutral',
  }
  const primaryAction: ShellPrimaryAction = {
    label: 'Overview',
    onSelect: () => {
      /* navigation handled by rail; a no-op primary keeps ONE-action contract */
    },
  }
  return (
    <WorkspaceShell
      family="personal"
      identity={{ displayName: identity.displayName, roleTitle: 'My CarUp' }}
      currentPath={location.pathname}
      object={object}
      primaryAction={primaryAction}
      overviewHref="/dashboard"
    >
      <Outlet />
    </WorkspaceShell>
  )
}

/**
 * Dealer workspace chrome. The canonical, server-enforcing dealer guard is
 * rendered INSIDE the workspace chrome so tenant / compliance / owner-membership
 * authorization is fully preserved — the shell never gates or bypasses it.
 */
function WorkspaceDealerUnifiedShell() {
  return (
    <WorkspaceShell
      family="dealer"
      identity={{ displayName: 'Dealer', roleTitle: 'Dealer OS' }}
      currentPath={typeof window !== 'undefined' ? window.location.pathname : '/dealer/dashboard'}
      object={{ title: 'Dealership operations', reference: 'dealer', statusLabel: 'Authorized', statusTone: 'neutral' }}
      primaryAction={{ label: 'Dashboard', onSelect: () => {} }}
      railSections={DEALER_RAIL}
      overviewHref="/dealer/dashboard"
    >
      <DealerCanonicalWorkspaceLayout />
    </WorkspaceShell>
  )
}

/** Dealer rail projected from the canonical dealer operations nav (paths only, no access change). */
const DEALER_RAIL: ShellNavSection[] = [
  {
    title: 'Operations',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: '/dealer/dashboard', planned: false },
      { id: 'operating-details', label: 'Operating details', href: '/dealers/operating-details', planned: false },
      { id: 'staff', label: 'Staff', href: '/dealers/staff', planned: false },
      { id: 'stock', label: 'Inventory', href: '/dealers/stock', planned: false },
      { id: 'inquiries', label: 'Buyer inquiries', href: '/dealers/inquiries', planned: false },
      { id: 'billing', label: 'Billing readiness', href: '/dealers/billing', planned: false },
    ],
  },
]

/**
 * The single switch every first-slice route family uses. `legacy` is the exact
 * element the route rendered before this change; when the flag is off we return
 * it untouched.
 */
export function UnifiedRouteShell({
  family,
  legacy,
  focusedTitle,
  focusedStepLabel,
}: {
  family: Family
  legacy: ReactElement
  focusedTitle?: string
  focusedStepLabel?: string
}): ReactElement {
  if (!isUnifiedUiEnabled()) return legacy

  switch (family) {
    case 'public':
      return <PublicUnifiedShell />
    case 'focused':
      return <FocusedUnifiedShell title={focusedTitle ?? 'Sign in'} stepLabel={focusedStepLabel} />
    case 'workspace-personal':
      return <WorkspacePersonalUnifiedShell />
    case 'workspace-dealer':
      return <WorkspaceDealerUnifiedShell />
  }
}

/**
 * RX-02A S1-4B (R2) — Route-family presentation switch (DEFAULT-OFF + guarded).
 *
 * Wraps a route family and renders the approved unified shell chrome AROUND
 * the real page when — and only when — the isolated NONPRODUCTION presentation
 * flag is opted in (see unifiedFlag.ts: production/staging builds can never
 * enable it). When off, it returns the preserved legacy layout element
 * unchanged, so existing users see exactly what they see today.
 *
 * SCOPE (R2-3): the unified presentation covers ONLY the approved first-slice
 * routes. Every other route — Trade/diaspora, admin, reviewer, Garage, KYC,
 * seller and any other nonpilot path — renders its preserved legacy layout even
 * inside an opted-in session. All 139 registered routes keep their existing
 * elements; this switch changes chrome only, never route ownership.
 *
 * GUARDS (P0-A / P0-B): the unified flows REUSE the canonical boundaries —
 * nothing is copied or re-derived:
 *   - Public + Focused render their page through
 *     `<RegistryRouteBoundary enforceAuth={false}>`, the SAME lifecycle-only
 *     boundary (`evaluateRouteAccess`: planned/disabled/deprecated/beta) the
 *     legacy `MainLayout` uses. URL query/session opt-in cannot bypass it.
 *   - The personal workspace renders through `<RegistryRouteBoundary>`
 *     (enforceAuth), the SAME centralized guard the legacy `DashboardLayout`
 *     uses (loading → auth redirect with returnTo → wrong-role redirect →
 *     planned/disabled pages).
 *   - The dealer workspace renders through the SHARED
 *     `useDealerOperationalWorkspace` hook — the exact server-enforced
 *     tenant/compliance/owner-membership check the canonical layout uses —
 *     and renders exactly ONE workspace chrome (no nested legacy header).
 *
 * Rollback is presentation-only: flag off ⇒ legacy layout, zero data effect.
 */
import type { ReactElement } from 'react'
import { matchPath, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import { getFeatureByRoute, getRoleMetadata } from '@/config/featureRegistry'
import { loginWithReturnTo } from '@/lib/routeAccess'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { useDealerOperationalWorkspace } from '@/components/dealer/useDealerOperationalWorkspace'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { PublicShell } from './PublicShell'
import type { PublicIdentity } from './PublicShell'
import { WorkspaceShell } from './WorkspaceShell'
import { FocusedShell } from './FocusedShell'
import { safeReturnTarget } from './safeReturn'
import { FocusedEmbedContext } from './FocusedEmbedContext'
import { isUnifiedUiEnabled } from './unifiedFlag'
import { projectDealerOperationsRail } from './navProjection'
import type { ShellIdentity, ShellObjectIdentity } from './contracts'
import type { UserRole } from '@shared/types'

type Family = 'public' | 'focused' | 'workspace-personal' | 'workspace-dealer'

function useIdentity(): { displayName: string; isAuthenticated: boolean; role: UserRole | null; bootstrapping: boolean } {
  const { user, isAuthenticated, loading } = useAuth()
  return {
    displayName: user?.name ?? 'Visitor',
    isAuthenticated,
    // C4 — the REAL session role (never assumed 'owner'); null while unknown.
    role: user?.role ?? null,
    bootstrapping: loading,
  }
}

/* ── R2-3 first-slice allowlists ─────────────────────────────────────────── */

/** Literal /marketplace/* segments owned by OTHER pages (must not match :id). */
const MARKETPLACE_NON_VEHICLE = new Set(['compare', 'parts', 'services'])

function isPublicSlicePath(pathname: string): boolean {
  if (matchPath('/', pathname)) return true
  if (matchPath('/marketplace', pathname)) return true
  if (matchPath('/marketplace/listing/:id', pathname)) return true
  const m = matchPath('/marketplace/:id', pathname)
  if (m && !MARKETPLACE_NON_VEHICLE.has(m.params.id ?? '')) return true
  return false
}

/** Focused first slice: pure auth journeys only (KYC etc. stay legacy). */
const FOCUSED_TITLES: ReadonlyArray<{ pattern: string; title: string }> = [
  { pattern: '/login', title: 'Sign in to CarUp' },
  { pattern: '/register', title: 'Create your CarUp account' },
  { pattern: '/auth/forgot-password', title: 'Recover your password' },
  { pattern: '/auth/reset-password', title: 'Choose a new password' },
  { pattern: '/auth/verify-email', title: 'Verify your email' },
]

function focusedTitleFor(pathname: string): string | null {
  for (const entry of FOCUSED_TITLES) {
    if (matchPath(entry.pattern, pathname)) return entry.title
  }
  return null
}

/**
 * R4-1 — Personal-family first-slice allowlist (route-authority register).
 * These are the owner routes whose unified chrome is IN SCOPE for this slice.
 * `/dashboard/sell-vehicle` is deliberately ABSENT: register row R076 assigns
 * the seller claim flow to its own `FocusedShell (seller-claim)` composition,
 * so it must never enter the unified personal WorkspaceShell (the deferred
 * seller redesign is NOT implemented here — the route keeps its exact legacy
 * element, unchanged, when the opt-in is on).
 */
const PERSONAL_SLICE_PATTERNS: ReadonlyArray<string> = [
  '/dashboard',
  '/dashboard/garage',
  '/dashboard/garage/:id',
  '/dashboard/evidence',
  '/dashboard/service-history',
  '/dashboard/insurance',
  '/dashboard/partsentry',
  '/dashboard/listings',
  '/dashboard/saved',
  '/dashboard/ai',
  '/dashboard/referrals',
  '/dashboard/communications',
  '/dashboard/intelligence',
]

function isPersonalSlicePath(pathname: string): boolean {
  return PERSONAL_SLICE_PATTERNS.some(pattern => matchPath(pattern, pathname))
}

/** Public showroom chrome over the first-slice public pages. */
function PublicUnifiedShell({ legacy }: { legacy: ReactElement }) {
  const identity = useIdentity()
  const location = useLocation()
  // R2-3: off-slice public paths keep the preserved legacy composition.
  if (!isPublicSlicePath(location.pathname)) return legacy
  const publicIdentity: PublicIdentity = {
    displayName: identity.displayName,
    isAuthenticated: identity.isAuthenticated,
    role: identity.role,
    bootstrapping: identity.bootstrapping,
  }
  return (
    <PublicShell identity={publicIdentity} currentPath={location.pathname}>
      {/* P0-A: same lifecycle-only boundary as legacy MainLayout. */}
      <RegistryRouteBoundary enforceAuth={false}>
        <Outlet />
      </RegistryRouteBoundary>
    </PublicShell>
  )
}

/** Focused single-task chrome for the auth first slice. */
function FocusedUnifiedShell({ legacy }: { legacy: ReactElement }) {
  const identity = useIdentity()
  const navigate = useNavigate()
  const location = useLocation()
  const title = focusedTitleFor(location.pathname)
  // R2-3/R2-5: routes outside the focused first slice keep legacy chrome.
  if (!title) return legacy
  return (
    <FocusedShell
      identity={{
        displayName: identity.displayName,
        roleTitle: identity.isAuthenticated ? 'Signed in' : 'Visitor',
      }}
      title={title}
      onExit={() => navigate(safeReturnTarget(location))}
    >
      <FocusedEmbedContext.Provider value={true}>
        {/* P0-A: lifecycle-only boundary, same as legacy hideNav MainLayout. */}
        <RegistryRouteBoundary enforceAuth={false}>
          <Outlet />
        </RegistryRouteBoundary>
      </FocusedEmbedContext.Provider>
    </FocusedShell>
  )
}

/**
 * Personal workspace chrome (My CarUp). P0-B: the WHOLE shell sits behind the
 * SAME centralized `RegistryRouteBoundary` guard the legacy DashboardLayout
 * uses — guest → /login?returnTo=…, wrong role → own dashboard, planned /
 * disabled → canonical state pages, bootstrapping → loading. Object context is
 * projected from the canonical feature registry for the CURRENT route, so the
 * header names the real governed feature; no inert primary action is rendered.
 */
function WorkspacePersonalUnifiedShell() {
  const identity = useIdentity()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const feature = getFeatureByRoute(location.pathname)
  const object: ShellObjectIdentity = {
    title: feature?.label ?? 'My CarUp',
    reference: feature?.id ?? 'personal',
    statusLabel: 'Signed in',
    statusTone: 'neutral',
  }
  const shellIdentity: ShellIdentity = {
    displayName: identity.displayName,
    // C4 — the role title is the REAL session role's registry metadata, never
    // a hard-coded label.
    roleTitle: identity.role ? getRoleMetadata(identity.role).title : 'My CarUp',
  }
  return (
    <WorkspaceShell
      family="personal"
      identity={shellIdentity}
      currentPath={location.pathname}
      object={object}
      overviewHref="/dashboard"
      // C2 — sign-out uses the EXISTING safe session mechanism (AuthContext
      // logout, which clears client auth state + stored session only); no new
      // backend API, no storage nuking of unrelated user data.
      onSignOut={() => {
        logout()
        navigate('/')
      }}
    >
      <Outlet />
    </WorkspaceShell>
  )
}

/**
 * Dealer workspace chrome (R2-1/R2-2). Uses the SHARED server-enforced
 * `useDealerOperationalWorkspace` hook — the exact canonical eligibility check —
 * and renders exactly ONE workspace chrome after verification: no nested
 * legacy header. Identity, tenant label and status come ONLY from the
 * server-verified workspace (never client-invented). Unauthorized/loading
 * states render explicitly and imply no permission.
 */
function WorkspaceDealerUnifiedShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { status, workspace } = useDealerOperationalWorkspace()
  // R4-2 — canonical loaded feature effective states for rail governance
  // (hook order is fixed: before any conditional return).
  const effectiveStates = useFeatureEffectiveStates()

  if (status === 'bootstrapping' || status === 'verifying') return <AuthBootstrapLoading />
  if (status === 'guest') {
    // Canonical guest behavior: login with sanitized return-to (same as legacy).
    return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  }
  if (status === 'unauthorized' || !workspace) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12" data-testid="dealer-workspace-unavailable">
        <h1 className="text-2xl font-semibold">Dealership operating access unavailable</h1>
        <p className="mt-4 text-carup-text-2">
          Your session does not currently have an active, independently approved
          dealership organization and canonical owner membership. A submitted or
          approved research claim alone is not operating authorization.
        </p>
      </main>
    )
  }

  const dealerName = workspace.profile.trading_name || workspace.profile.legal_name || 'Approved dealer'
  // R4-2 — the rail is projected through the CANONICAL feature visibility /
  // effective-state resolver: no forced `planned: false`, no advertising
  // legacy destinations as active unified actions. Destinations outside the
  // approved unified slice render truthfully as non-navigating "Soon" entries
  // (they remain reachable in the legacy chrome they actually live in).
  const rail = projectDealerOperationsRail({ effectiveStates })
  const identity: ShellIdentity = {
    displayName: user?.name ?? dealerName,
    roleTitle: 'Dealer OS',
    tenantLabel: dealerName,
  }
  // C2 — dealer sign-out uses the same existing safe session mechanism.
  const onSignOut = () => {
    logout()
    navigate('/')
  }
  const object: ShellObjectIdentity = {
    title: dealerName,
    reference: `tenant ${workspace.tenant_id}`,
    statusLabel: 'Operating',
    statusTone: 'success',
    meta: [`org ${workspace.organization_id}`],
  }
  return (
    <WorkspaceShell
      family="dealer"
      identity={identity}
      currentPath={location.pathname}
      object={object}
      // R4-2 — no primary action is rendered: the only candidate ("review
      // inquiries") navigates outside the approved slice, and the shell never
      // ships an action that leaves the unified experience.
      railSections={rail}
      overviewHref="/dealer/dashboard"
      onSignOut={onSignOut}
    >
      <Outlet />
    </WorkspaceShell>
  )
}

/**
 * R4-1 — Personal-family scope switch. Routes inside the approved personal
 * slice render behind the SAME centralized guard the legacy DashboardLayout
 * uses; routes outside it (the seller claim flow) keep their exact assigned
 * legacy element, so an opted-in nonproduction session cannot pull an
 * out-of-scope seller flow into the unified WorkspaceShell.
 */
function WorkspacePersonalSwitch({ legacy }: { legacy: ReactElement }) {
  const location = useLocation()
  if (!isPersonalSlicePath(location.pathname)) return legacy
  return (
    <RegistryRouteBoundary>
      <WorkspacePersonalUnifiedShell />
    </RegistryRouteBoundary>
  )
}

/**
 * The single switch every first-slice route family uses. `legacy` is the exact
 * element the route rendered before this change; when the flag is off (or the
 * build is production) we return it untouched.
 */
export function UnifiedRouteShell({
  family,
  legacy,
}: {
  family: Family
  legacy: ReactElement
}): ReactElement {
  if (!isUnifiedUiEnabled()) return legacy

  switch (family) {
    case 'public':
      return <PublicUnifiedShell legacy={legacy} />
    case 'focused':
      return <FocusedUnifiedShell legacy={legacy} />
    case 'workspace-personal':
      // R4-1: slice-gated — off-slice personal paths (seller claim) keep the
      // exact legacy element; in-slice paths get the centralized guard.
      return <WorkspacePersonalSwitch legacy={legacy} />
    case 'workspace-dealer':
      return <WorkspaceDealerUnifiedShell />
  }
}

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
import { useEffect, useState, type ReactElement } from 'react'
import { matchPath, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { RegistryRouteBoundary } from '@/components/routing/RegistryRouteBoundary'
import { getRoleMetadata } from '@/config/featureRegistry'
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
import { DEALER_UNIFIED_SLICE, projectDealerOperationsGroups, projectTradeOrderTabs, projectTradeRail } from './navProjection'
import { pickActiveHref } from './activeNav'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import type { DiasporaImportOrder } from '@/types'
import { isShowroomChromeEnabled } from '@/lib/presentationFlags'
import { focusedTaskFor } from './focusedTitles'
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

/* Focused first slice: the five account routes (KYC etc. stay legacy) — titles live in focusedTitles.ts. */

/**
 * R4-1 — Personal-family first-slice allowlist (route-authority register).
 * These are the owner routes whose unified chrome is IN SCOPE for this slice.
 * `/dashboard/sell-vehicle` is deliberately ABSENT: register row R076 assigns
 * the seller claim flow to its own `FocusedShell (seller-claim)` composition,
 * so it must never enter the unified personal WorkspaceShell. RX04-D implements
 * that composition (FocusedSellerStudioShell, behind the same guard).
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

/**
 * RX03-P2 — routes registered under MainLayout whose authority-register shell is
 * a WORKSPACE (or the focused import flow). When opted in, the public family
 * hands them to that workspace instead of the public chrome. URLs, route
 * elements and every server-side check are unchanged.
 */
function isDealerOpsSlicePath(pathname: string): boolean {
  // R017–R021 → WorkspaceShell(dealer); /dealer/dashboard has its own family.
  return pathname !== '/dealer/dashboard' && DEALER_UNIFIED_SLICE.has(pathname)
}

const TRADE_WORKSPACE_PATTERNS: ReadonlyArray<string> = [
  '/diaspora/imports', // R038
  '/diaspora/imports/:id', // R040
  '/diaspora/imports/:id/documents', // R041
  '/diaspora/imports/:id/shipment', // R042
  '/diaspora/imports/:id/passport', // R043
]

/** The import order id of a Trade workspace path, '' for the list, null when off-slice. */
function tradeWorkspaceOrderId(pathname: string): string | null {
  if (matchPath('/diaspora/imports/new', pathname)) return null // R039 is the focused flow
  for (const pattern of TRADE_WORKSPACE_PATTERNS) {
    const m = matchPath(pattern, pathname)
    if (m) return m.params.id ?? ''
  }
  return null
}

/** Public showroom chrome over the first-slice public pages. */
function PublicUnifiedShell({ legacy }: { legacy: ReactElement }) {
  const identity = useIdentity()
  const location = useLocation()
  const pathname = location.pathname
  // RX03-P2 — workspace-registered routes that are routed under MainLayout.
  if (isDealerOpsSlicePath(pathname)) return <WorkspaceDealerUnifiedShell lifecycleBoundary />
  if (matchPath('/diaspora/imports/new', pathname)) return <FocusedImportFlowShell legacy={legacy} />
  if (matchPath('/sell', pathname)) return <FocusedSellerStudioShell exitTo="/" />
  const orderId = tradeWorkspaceOrderId(pathname)
  if (orderId !== null) return <WorkspaceTradeUnifiedShell legacy={legacy} orderId={orderId || null} />
  // R2-3: off-slice public paths keep the preserved legacy composition.
  if (!isPublicSlicePath(pathname)) return legacy
  // RX03-P2 — the Owner-accepted RX-03 showroom chrome (P1b navigation) IS the
  // public grammar whenever its own presentation switch is on; the RX-02
  // PublicShell prototype chrome must not replace it in a connected session.
  if (isShowroomChromeEnabled()) return legacy
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
  const task = focusedTaskFor(location.pathname)
  // R2-3/R2-5: routes outside the focused first slice keep legacy chrome.
  if (!task) return legacy
  return (
    <FocusedShell
      identity={{
        displayName: identity.displayName,
        roleTitle: identity.isAuthenticated ? 'Signed in' : 'Visitor',
      }}
      title={task.title}
      mode="auth"
      wide={task.wide}
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

/** RX03-P2-R4 — the owner's four most frequent places, one tap away on phones. */
const PERSONAL_TASKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'My CarUp', href: '/dashboard' },
  { label: 'Garage', href: '/dashboard/garage' },
  { label: 'Saved', href: '/dashboard/saved' },
  { label: 'Gutu AI', href: '/dashboard/ai' },
]

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
  const bottomActive = pickActiveHref(location.pathname, PERSONAL_TASKS.map(t => t.href))
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
      overviewHref="/dashboard"
      // RX03-P2-R4 — pages own their heading (no second title); phones get a task bar.
      bottomNav={PERSONAL_TASKS.map(t => ({ ...t, active: t.href === bottomActive }))}
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
function WorkspaceDealerUnifiedShell({ lifecycleBoundary = false }: { lifecycleBoundary?: boolean } = {}) {
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
  const rail = projectDealerOperationsGroups({ effectiveStates })
  // RX03-P2-R4 — one identity hierarchy: CarUp (brand, masthead) → Dealer OS (product) → the
  // dealership as context text. The dealership's own profile card on the page is its single large
  // identity, so the shell adds no second title row and no raw organisation UUIDs.
  const identity: ShellIdentity = {
    displayName: user?.name ?? dealerName,
    roleTitle: 'Dealer OS',
    tenantLabel: `${dealerName} · Operating`,
  }
  // C2 — dealer sign-out uses the same existing safe session mechanism.
  const onSignOut = () => {
    logout()
    navigate('/')
  }
  const live = rail.flatMap(s => s.items).filter(i => !i.planned)
  const dealerTasks = ['/dealer/dashboard', '/dealers/stock', '/dealers/inquiries']
    .map(href => live.find(i => i.href === href))
    .filter((i): i is NonNullable<typeof i> => !!i)
  const dealerTaskActive = pickActiveHref(location.pathname, dealerTasks.map(t => t.href))
  return (
    <WorkspaceShell
      family="dealer"
      identity={identity}
      currentPath={location.pathname}
      // R4-2 — no primary action is rendered: the only candidate ("review
      // inquiries") navigates outside the approved slice, and the shell never
      // ships an action that leaves the unified experience.
      railSections={rail}
      navStyle="tabs"
      overviewHref="/dealer/dashboard"
      homeLabel="Dashboard"
      accountLinks={[{ label: 'Dealer OS home', href: '/dealer/dashboard' }]}
      bottomNav={dealerTasks.map(t => ({ label: t.label === 'Buyer inquiries' ? 'Inquiries' : t.label, href: t.href, active: t.href === dealerTaskActive }))}
      onSignOut={onSignOut}
    >
      {lifecycleBoundary ? (
        // RX03-P2 — the /dealers/* operations pages keep the SAME lifecycle-only
        // boundary their legacy MainLayout parent applied (planned/disabled/beta).
        <RegistryRouteBoundary enforceAuth={false}>
          <Outlet />
        </RegistryRouteBoundary>
      ) : (
        <Outlet />
      )}
    </WorkspaceShell>
  )
}

/**
 * RX03-P2 — Trade workspace (register R038, R040–R043: WorkspaceShell(trade)).
 * The import-order pages keep the SAME lifecycle-only boundary their legacy
 * MainLayout parent applied; every order read/write stays server-authorized
 * (import-order participant/role checks). Guests keep the exact legacy
 * composition, so signed-out behaviour is unchanged.
 */
function tradeLabel(value?: string | null): string {
  if (!value) return 'Not set'
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function orderTitle(order: DiasporaImportOrder): string {
  if (order.order_type !== 'vehicle') return `${tradeLabel(order.order_type)} import`
  const name = [order.requested_make, order.requested_model].filter(Boolean).join(' ')
  return name || 'Vehicle import'
}

type ConfirmedOrder = { id: string; state: 'loading' | 'ready' | 'refused'; order: DiasporaImportOrder | null }

function WorkspaceTradeUnifiedShell({ legacy, orderId }: { legacy: ReactElement; orderId: string | null }) {
  const identity = useIdentity()
  const { user, token, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const effectiveStates = useFeatureEffectiveStates()
  const [confirmed, setConfirmed] = useState<ConfirmedOrder | null>(null)
  const userId = user?.id
  const userRole = user?.role
  const tenantId = (user as { active_tenant_id?: string | null } | null)?.active_tenant_id ?? null
  // RX03-P2-R4 — the order header and its section tabs come ONLY from the order the server returns
  // to this session (the same participant-checked read the order pages use). A URL id alone never
  // produces order navigation, so a refused or unknown order shows no actionable order links.
  useEffect(() => {
    if (!orderId || !identity.isAuthenticated) return
    let active = true
    setConfirmed(current => (current && current.id === orderId && current.state === 'ready' ? current : { id: orderId, state: 'loading', order: null }))
    // Same identity headers and endpoint as useCarUpApi().fetchDiasporaImportOrder.
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (userId) authHeaders['x-user-id'] = userId
    if (userRole) authHeaders['x-stakeholder-role'] = userRole
    if (tenantId) authHeaders['x-tenant-id'] = tenantId
    Promise.resolve()
      .then(() => apiRequest<DiasporaImportOrder>({
        baseUrl: resolveApiBaseUrl(import.meta.env.VITE_API_URL, typeof window === 'undefined' ? undefined : window.location.hostname),
        path: `/diaspora/import-orders/${encodeURIComponent(orderId)}`,
        authHeaders,
      }))
      .then(order => {
        if (!active) return
        setConfirmed(order && order.id === orderId ? { id: orderId, state: 'ready', order } : { id: orderId, state: 'refused', order: null })
      })
      .catch(() => { if (active) setConfirmed({ id: orderId, state: 'refused', order: null }) })
    return () => { active = false }
  }, [orderId, identity.isAuthenticated, token, userId, userRole, tenantId, location.pathname])

  if (identity.bootstrapping) return <AuthBootstrapLoading />
  if (!identity.isAuthenticated) return legacy
  const role = identity.role ?? undefined
  const familySections = projectTradeRail({ role, effectiveStates })
  const current = orderId && confirmed?.id === orderId ? confirmed : null
  const order = current?.state === 'ready' ? current.order : null
  const object: ShellObjectIdentity | undefined = !orderId
    ? undefined
    : order
      ? {
          title: orderTitle(order),
          reference: `Order ${order.id.slice(0, 8)}`,
          statusLabel: tradeLabel(order.status),
          statusTone: 'info',
          meta: [[order.origin_country, order.destination_country].filter(Boolean).join(' → ')].filter(Boolean),
        }
      : current?.state === 'refused'
        ? { title: 'Import order unavailable', reference: '', statusLabel: 'Not available to this account', statusTone: 'warning' }
        : { title: 'Import order', reference: '', statusLabel: 'Checking access…', statusTone: 'neutral' }
  const objectTabs = order ? projectTradeOrderTabs({ role, effectiveStates, orderId: order.id }) : undefined
  return (
    <WorkspaceShell
      family="trade"
      identity={{
        displayName: identity.displayName,
        roleTitle: identity.role ? getRoleMetadata(identity.role).title : 'Trade',
      }}
      currentPath={location.pathname}
      object={object}
      objectTabs={objectTabs}
      railSections={familySections}
      navStyle="tabs"
      overviewHref="/diaspora/imports"
      homeLabel="Import orders"
      onSignOut={() => {
        logout()
        navigate('/')
      }}
    >
      <RegistryRouteBoundary enforceAuth={false}>
        <Outlet />
      </RegistryRouteBoundary>
    </WorkspaceShell>
  )
}

/**
 * RX03-P2 — the import request as a Focused flow (register R039:
 * FocusedShell, mode "flow": one goal per view, save-and-exit). Same
 * lifecycle-only boundary as legacy; guests keep the legacy composition.
 */
function FocusedImportFlowShell({ legacy }: { legacy: ReactElement }) {
  const identity = useIdentity()
  const navigate = useNavigate()
  if (identity.bootstrapping) return <AuthBootstrapLoading />
  if (!identity.isAuthenticated) return legacy
  return (
    <FocusedShell
      identity={{ displayName: identity.displayName, roleTitle: 'Signed in' }}
      title="Start an import order"
      onExit={() => navigate('/diaspora/imports')}
    >
      <RegistryRouteBoundary enforceAuth={false}>
        <Outlet />
      </RegistryRouteBoundary>
    </FocusedShell>
  )
}

/**
 * RX04-D — Seller Studio (register R003 guest `/sell`, R076 `/dashboard/sell-vehicle`):
 * FocusedShell mode "seller-claim". Guest Sell keeps its lifecycle-only boundary
 * (anyone may start a browser draft); the account flow sits behind the SAME
 * centralized guard the legacy DashboardLayout uses, applied by the caller.
 */
function FocusedSellerStudioShell({ exitTo }: { exitTo: string }) {
  const identity = useIdentity()
  const navigate = useNavigate()
  return (
    <FocusedShell
      identity={{
        displayName: identity.displayName,
        roleTitle: identity.isAuthenticated ? 'Signed in' : 'Visitor',
      }}
      title="Seller Studio"
      mode="seller-claim"
      onExit={() => navigate(exitTo)}
    >
      <RegistryRouteBoundary enforceAuth={false}>
        <Outlet />
      </RegistryRouteBoundary>
    </FocusedShell>
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
  if (matchPath('/dashboard/sell-vehicle', location.pathname)) {
    return (
      <RegistryRouteBoundary>
        <FocusedSellerStudioShell exitTo="/dashboard/listings" />
      </RegistryRouteBoundary>
    )
  }
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

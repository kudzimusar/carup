import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate, Navigate } from 'react-router-dom'
import CompactBottomNav from './CompactBottomNav'
import { isRecentShellSignOut, useShellSignOut } from './useShellSignOut'
import {
  Car,
  Bell,
  Search,
  LogOut,
  Menu,
  X,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import {
  getRoleMetadata,
  normalizeFrontendRole,
  resolveFeatureVisibility,
  type FeatureRegistryItem,
  type NavigationContext, getDashboardItemsFor, activeTenantScopeOf } from '@/config/featureRegistry'
import { resolveFeatureIcon } from '@/config/featureIcons'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import {
  AuthBootstrapLoading,
  RegistryRouteBoundary,
} from '@/components/routing/RegistryRouteBoundary'
import { FeaturePlannedPage, FeatureDisabledPage } from '@/components/routing/FeatureStatePages'
import { OwnerNotificationBell } from '@/components/owner/OwnerNotificationBell'
import { ActiveOrganisationPrompt, OrganisationBadge } from '@/components/layout/OrganisationSwitcher'
import type { UserRole } from '@shared/types'

/** Resolves a FeatureRegistryItem to its icon component (shared resolver) */
function resolveIcon(item: FeatureRegistryItem): React.ElementType {
  return resolveFeatureIcon(item.icon)
}

export default function DashboardLayout({ role }: { role: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ownerSearch, setOwnerSearch] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  // Compact drawer: Escape closes it, focus moves into it on open and returns to whatever opened it
  // (the header menu button or the bottom bar's More) on close.
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const openSidebar = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSidebarOpen(true)
  }, [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  useEffect(() => {
    if (!sidebarOpen) {
      openerRef.current?.focus?.()
      openerRef.current = null
      return
    }
    closeButtonRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const signOut = useShellSignOut(closeSidebar)

  // Sidebar visibility must agree with direct access (the invariant this layout already keeps for
  // effective states). A garage tenant-member can REACH the garage surfaces, so they must also be
  // able to SEE them. OC-5D: the items come from ONE rule — this layout's platform role satisfies
  // `roles`, the SELECTED, verified organisation satisfies a feature's tenant scope (#197 merged in
  // the dashboard of the tenant role, as if it were a platform role — F4).
  const activeTenant = activeTenantScopeOf(user)
  const registryItems = getDashboardItemsFor({ role: role as UserRole, activeTenant })
  const roleInfo = getRoleMetadata(role as UserRole)
  const effectiveStates = useFeatureEffectiveStates()

  // Filter the sidebar through the SAME shared effective-visibility logic the
  // route boundary uses, so disabled / hidden / tenant-denied / role-denied
  // items never render in the primary nav (sidebar visibility ⇄ direct access).
  const sidebarContext: NavigationContext = {
    isAuthenticated: !!user,
    // Operations M6: platform_admin/super_admin present as admin in the UI.
    role: normalizeFrontendRole(user?.role) ?? null,
    activeTenant,
    environment: import.meta.env.MODE,
    effectiveStates,
  }
  const visibleItems = registryItems
    .map((item) => ({ item, vis: resolveFeatureVisibility(item, sidebarContext) }))
    .filter(({ vis }) => vis.visible)

  // Operations M6 — grouped information architecture. Items carrying a
  // sidebarGroup render under labelled sections (order of first appearance);
  // ungrouped items keep their position at the top. Presentation only.
  const groupedNav: Array<{ group: string | null; items: typeof visibleItems }> = []
  for (const entry of visibleItems) {
    const group = entry.item.sidebarGroup ?? null
    const bucket = groupedNav.find((g) => g.group === group)
    if (bucket) bucket.items.push(entry)
    else groupedNav.push({ group, items: [entry] })
  }

  // Centralized, lifecycle-aware route boundary — the SAME decision navigation
  // uses (loading gate → auth → role → planned/disabled/deprecated). Backend
  // authorization remains authoritative.
  const decision = evaluateRouteAccess({
    route: location.pathname,
    isBootstrapping: loading,
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    // A garage employee is an `owner` platform-wide and a `mechanic` inside their garage; both
    // facts are true and the route gate needs both — in their own namespaces (OC-5D).
    activeTenant,
    effectiveStates,
  })
  if (decision.kind === 'loading') return <AuthBootstrapLoading />
  if (decision.kind === 'redirect') {
    // A person who just signed out goes to the public home, not to a sign-in that would return the
    // next visitor into this workspace; every other anonymous visit keeps its returnTo.
    const to = decision.reason === 'auth' && isRecentShellSignOut() ? '/' : decision.to
    return <Navigate to={to} replace />
  }
  if (decision.kind === 'planned') return <FeaturePlannedPage />
  if (decision.kind === 'disabled') return <FeatureDisabledPage />

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Overlay — above the compact bottom bar (z-50), so an open drawer is the ONE surface:
          the bar can neither cover the drawer's account actions nor be tapped through the overlay. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[55] lg:hidden"
          onClick={closeSidebar}
          data-testid="sidebar-overlay"
        />
      )}

      {/* Sidebar. On compact widths it is a drawer sized to the VISIBLE viewport (100dvh, falling back
          to 100vh): `h-screen` alone is taller than a phone's visible area while the browser chrome
          shows, which pushed Settings / Sign Out under the bottom bar or off-screen. Header, identity
          and account actions never shrink; only the navigation list between them scrolls. */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-[60] h-screen w-64 max-w-[85vw] bg-white border-r flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ height: '100dvh' }}
        data-testid="dashboard-sidebar"
        data-open={sidebarOpen ? 'true' : 'false'}
      >
        {/* Sidebar Header */}
        <div className="h-16 shrink-0 flex items-center justify-between px-4 border-b">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold">
              Car<span className="text-orange-500">Up</span>
            </span>
          </Link>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={closeSidebar}
            aria-label="Close sidebar menu"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </Button>
        </div>

        {/* User Info. The active portal is stated, not offered as a catalogue: the server lets a
            session assume only its own platform role (or one an active organisation lends, chosen
            through the organisation switcher), so listing every platform role offered switches that
            were always refused. */}
        <div className="p-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <img
              src={user?.avatar || '/images/avatars/owner-1.jpg'}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{user?.name || 'User'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Active portal</p>
              <p className="flex items-center gap-1.5 mt-0.5 text-xs font-medium text-gray-700" data-testid="active-portal">
                <span className={`w-2 h-2 rounded-full shrink-0 ${roleInfo.color}`} aria-hidden="true" />
                {roleInfo.title}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation — grouped Operations information architecture (M6). `min-h-0` lets it scroll
            inside the column instead of pushing the account actions out of the drawer. */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1" aria-label="Dashboard navigation">
          {groupedNav.map(({ group, items }) => (
            <div key={group ?? '__ungrouped'} className="space-y-1">
              {group && (
                <p
                  className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
                  data-testid={`nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                >
                  {group}
                </p>
              )}
              {items.map(({ item, vis }) => {
            const isActive = location.pathname === item.route
              || (item.route !== '/dashboard' && location.pathname.startsWith(`${item.route}/`))
            const navIdMap: Record<string, string> = {
              'Overview': 'nav-dashboard',
              'My Garage': 'nav-garage',
              'Inventory': 'nav-inventory',
              'Claims': 'nav-claims',
              'Work Orders': 'nav-workorders',
              'Registry Verification': 'nav-registry',
              'Import Orders': 'nav-diaspora-imports',
              'Start Import Order': 'nav-diaspora-new-import',
              'Diaspora Compliance': 'nav-diaspora-compliance',
              'Workbook Console': 'diaspora-workbook-console-nav-link',
              'Communications': role === 'admin' ? 'nav-admin-communications' : 'nav-communications',
            }
            const IconComponent = resolveIcon(item)
            return (
              <Link
                key={item.id}
                to={item.route}
                onClick={closeSidebar}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-orange-50 text-orange-700 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-orange-500'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                data-testid={navIdMap[item.label]}
              >
                <IconComponent className={`w-5 h-5 ${isActive ? 'text-orange-500' : 'text-gray-400'}`} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {vis.beta && (
                  <Badge className="text-[10px] h-5 px-1.5 bg-blue-100 text-blue-700">Beta</Badge>
                )}
                {item.badge && (
                  <Badge variant={isActive ? 'default' : 'secondary'} className="text-[10px] h-5 px-1.5">
                    {item.badge}
                  </Badge>
                )}
              </Link>
            )
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer — account actions. Never shrinks; padded for the home-indicator safe area.
            There is no general account-settings product yet (GENERAL ACCOUNT SETTINGS — PRODUCT
            GAP), so no Settings entry is offered: it used to link to /settings, which has no route. */}
        <div className="shrink-0 p-3 border-t space-y-1 pb-[max(env(safe-area-inset-bottom),0.75rem)]" data-testid="sidebar-account-actions">
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
            data-testid="logout-button"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b h-16 flex items-center px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden mr-2"
            onClick={openSidebar}
            aria-label="Open sidebar menu"
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </Button>

          {/* Owner quick-search. Forwards the owner's ACTUAL query to the real /search route rather
              than dropping it — the same intent-preserving handoff Phase 8 applied on Landing. */}
          {user?.role === 'owner' ? (
            <form
              className="flex-1 max-w-md mx-4 hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault()
                const q = ownerSearch.trim()
                navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
              }}
              role="search"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="search"
                  value={ownerSearch}
                  onChange={(e) => setOwnerSearch(e.target.value)}
                  placeholder="Search vehicles by make, model or VIN..."
                  aria-label="Search vehicles"
                  data-testid="owner-topbar-search"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:bg-white"
                />
              </div>
            </form>
          ) : (
            <div className="flex-1" />
          )}

          {/* OBS-14: the form above is `hidden sm:block`, so on a phone an owner had no search at
              all. Search is part of the owner shell, so mobile gets an equivalent affordance rather
              than a cramped duplicate input — this opens the real /search page, where the full
              control lives. */}
          {user?.role === 'owner' && (
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label="Search vehicles"
              data-testid="owner-topbar-search-mobile"
              onClick={() => navigate('/search')}
            >
              <Search className="w-5 h-5" aria-hidden="true" />
            </Button>
          )}

          <div className="flex items-center gap-2">
            {/* Owners get the real notification bell (canonical /notifications/me). Other roles keep
                the plain link until their own notification contract is wired. */}
            {user?.role === 'owner' ? (
              <OwnerNotificationBell />
            ) : (
              <Button variant="ghost" size="icon" className="relative" asChild>
                {/* This portal's own home — `/dashboard` is the owner overview, which only bounced
                    every other role back to where they started. */}
                <Link to={roleInfo.dashboardRoute} aria-label="Dashboard notifications">
                  <Bell className="w-5 h-5" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <OrganisationBadge />
            <Button variant="ghost" size="sm" asChild>
              <Link to="/" className="gap-1">
                <Store className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Site</span>
              </Link>
            </Button>
          </div>
        </header>
        <ActiveOrganisationPrompt />

        {/* Page Content — boundary shows a beta notice above beta features.
            The bottom padding on compact widths is the height of the compact nav plus the safe-area
            inset: without it the bar covers the last control on the page, which DESIGN.md §10
            ("primary CTA stays discoverable") forbids. */}
        <main className="p-4 lg:p-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6">
          <RegistryRouteBoundary>
            <Outlet />
          </RegistryRouteBoundary>
        </main>
      </div>

      {/* The one compact navigation bar, in the AUTHENTICATED shell.
          It was previously mounted only in MainLayout, so every signed-in workspace on a phone had
          the hamburger drawer and nothing else — no persistent way to reach the work. "More" opens
          that same drawer rather than adding a second secondary surface. */}
      <CompactBottomNav onOpenMore={openSidebar} />
    </div>
  )
}

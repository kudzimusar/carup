import { useState } from 'react'
import { toast } from 'sonner'
import { Outlet, Link, useLocation, useNavigate, Navigate } from 'react-router-dom'
import {
  Car,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import {
  getDashboardItems,
  getDashboardRoute,
  getRoleMetadata,
  getAllRoles,
  resolveFeatureVisibility,
  type FeatureRegistryItem,
  type NavigationContext,
} from '@/config/featureRegistry'
import { resolveFeatureIcon } from '@/config/featureIcons'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import {
  AuthBootstrapLoading,
  RegistryRouteBoundary,
} from '@/components/routing/RegistryRouteBoundary'
import { FeaturePlannedPage, FeatureDisabledPage } from '@/components/routing/FeatureStatePages'
import type { UserRole } from '@shared/types'

/** Resolves a FeatureRegistryItem to its icon component (shared resolver) */
function resolveIcon(item: FeatureRegistryItem): React.ElementType {
  return resolveFeatureIcon(item.icon)
}

export default function DashboardLayout({ role }: { role: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole, loading } = useAuth()

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as Parameters<typeof switchRole>[0])
      navigate(getDashboardRoute(newRole as UserRole))
    } catch (err) {
      console.error('Failed to switch stakeholder role:', err)
      toast.error('Could not switch portal role. Please try again.')
    }
  }

  const registryItems = getDashboardItems(role as UserRole)
  const roleInfo = getRoleMetadata(role as UserRole)
  const effectiveStates = useFeatureEffectiveStates()

  // Filter the sidebar through the SAME shared effective-visibility logic the
  // route boundary uses, so disabled / hidden / tenant-denied / role-denied
  // items never render in the primary nav (sidebar visibility ⇄ direct access).
  const sidebarContext: NavigationContext = {
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    environment: import.meta.env.MODE,
    effectiveStates,
  }
  const visibleItems = registryItems
    .map((item) => ({ item, vis: resolveFeatureVisibility(item, sidebarContext) }))
    .filter(({ vis }) => vis.visible)

  // Centralized, lifecycle-aware route boundary — the SAME decision navigation
  // uses (loading gate → auth → role → planned/disabled/deprecated). Backend
  // authorization remains authoritative.
  const decision = evaluateRouteAccess({
    route: location.pathname,
    isBootstrapping: loading,
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    effectiveStates,
  })
  if (decision.kind === 'loading') return <AuthBootstrapLoading />
  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace />
  if (decision.kind === 'planned') return <FeaturePlannedPage />
  if (decision.kind === 'disabled') return <FeatureDisabledPage />

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-white border-r flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold">
              Car<span className="text-orange-500">Up</span>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar menu"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </Button>
        </div>

        {/* User Info */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <img
              src={user?.avatar || '/images/avatars/owner-1.jpg'}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{user?.name || 'User'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Active portal</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${roleInfo.color}`} />
                <select
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  aria-label="Switch active portal role"
                  className="text-xs text-gray-600 bg-transparent border-none p-0 focus:ring-0 cursor-pointer font-medium hover:text-gray-900 transition-colors"
                >
                  {getAllRoles().map((r) => (
                    <option key={r} value={r}>{getRoleMetadata(r).title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleItems.map(({ item, vis }) => {
            const isActive = location.pathname === item.route
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
                onClick={() => setSidebarOpen(false)}
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
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t space-y-1">
          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Settings className="w-5 h-5 text-gray-400" />
            Settings
          </Link>
          <Link
            to="/"
            onClick={() => {
              localStorage.clear()
              window.location.href = '/'
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
            data-testid="logout-button"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </Link>
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
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar menu"
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative" asChild>
              <Link to="/dashboard">
                <Bell className="w-5 h-5" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/" className="gap-1">
                <Store className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Site</span>
              </Link>
            </Button>
          </div>
        </header>

        {/* Page Content — boundary shows a beta notice above beta features */}
        <main className="p-4 lg:p-6">
          <RegistryRouteBoundary>
            <Outlet />
          </RegistryRouteBoundary>
        </main>
      </div>
    </div>
  )
}

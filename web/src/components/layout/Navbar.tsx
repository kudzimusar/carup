import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import {
  Car,
  Menu,
  X,
  ShoppingCart,
  Bell,
  LayoutDashboard,
  LogOut,
  Settings,
  ChevronDown,
  Shield,
  Wrench,
  Building2,
  MessageSquare,
  Package,
  MoreHorizontal
} from 'lucide-react'
import { useApp } from '@/App'
import { useAuth } from '@/context/AuthContext'
import { notifications } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { getDashboardRoute, getRoleMetadata, getAllRoles, getPublicNavigationItems } from '@/config/featureRegistry'
import type { NavigationContext, MarketplaceCoverageResponse } from '@/config/featureRegistry'
import { getDesktopMegaMenu, type ResolvedNavSection } from '@/config/navigationManifest'
import type { NavCoverageResponse } from '@/types'
import type { UserRole } from '@shared/types'

/**
 * Desktop mega-menu — registry-driven. Active/beta items render as links;
 * planned items render as muted, non-navigating "Soon" entries (truthful, no
 * working filter promised). Hidden/disabled/deprecated items are excluded by
 * the selector before reaching this component.
 */
function CommerceMenu({
  label,
  icon: Icon,
  sections,
  testId,
  menuTestId,
}: {
  label: string
  icon: typeof ShoppingCart
  sections: ResolvedNavSection[]
  testId: string
  menuTestId: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          data-testid={testId}
        >
          <Icon className="h-4 w-4" />
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[760px] max-w-[calc(100vw-2rem)] p-5" data-testid={menuTestId}>
        <div className="grid gap-5 md:grid-cols-4">
          {sections.map(section => (
            <div key={section.title}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{section.title}</p>
              <div className="space-y-1">
                {section.items.map(item => item.active ? (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link
                      to={item.href}
                      data-testid={`navitem-${item.id}`}
                      title={item.description}
                      className="flex items-center justify-between cursor-pointer rounded-md px-2 py-1.5 text-sm"
                    >
                      <span>{item.label}</span>
                      {item.beta && <Badge className="ml-2 bg-blue-100 text-blue-700 text-[10px]">Beta</Badge>}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <div
                    key={item.id}
                    data-testid={`navitem-${item.id}`}
                    data-planned="true"
                    aria-disabled="true"
                    title={item.description ?? 'Coming soon'}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-gray-400 cursor-not-allowed select-none"
                  >
                    <span>{item.label}</span>
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-300">Soon</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole, logout } = useAuth()
  const { currency, setCurrency } = useApp()
  const { fetchMarketplaceNavCoverage } = useCarUpApi()
  const [navCoverage, setNavCoverage] = useState<NavCoverageResponse | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchMarketplaceNavCoverage().then(c => { if (!cancelled) setNavCoverage(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [fetchMarketplaceNavCoverage])
  const unreadCount = notifications.filter(n => !n.read).length

  const activeDashboardPath = getDashboardRoute((user?.role || 'owner') as UserRole)
  const sellerPath = user ? '/dashboard/sell-vehicle' : '/register'

  // Registry-driven mega-menus. Coverage gating, lifecycle visibility and
  // auth/role-aware destinations are resolved by the navigation manifest — no
  // hardcoded menu arrays remain in this component.
  const navContext: NavigationContext = {
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    environment: import.meta.env.MODE,
    coverage: (navCoverage as MarketplaceCoverageResponse | null) ?? null,
  }
  const buyMenu = getDesktopMegaMenu('navbar-mega-buy', navContext)
  const sellMenu = getDesktopMegaMenu('navbar-mega-sell', navContext)
  const verifyMenu = getDesktopMegaMenu('navbar-mega-verify', navContext)
  const partsMenu = getDesktopMegaMenu('navbar-mega-parts', navContext)
  const moreMenu = getDesktopMegaMenu('navbar-more', navContext)

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as any)
      navigate(getDashboardRoute(newRole as UserRole))
    } catch (err) {
      console.error('Failed to switch stakeholder role:', err)
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="section-padding mx-auto max-w-[1440px]">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mr-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Car<span className="text-orange-500">Up</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1" data-testid="public-primary-nav">
            <CommerceMenu label="Buy" icon={ShoppingCart} sections={buyMenu} testId="nav-buy" menuTestId="nav-buy-menu" />
            <CommerceMenu label="Sell" icon={Car} sections={sellMenu} testId="nav-sell" menuTestId="nav-sell-menu" />
            <CommerceMenu label="Verify" icon={Shield} sections={verifyMenu} testId="nav-verify" menuTestId="nav-verify-menu" />
            <CommerceMenu label="Parts" icon={Package} sections={partsMenu} testId="nav-parts" menuTestId="nav-parts-menu" />
            {getPublicNavigationItems().map((link) => {
              const testId = `nav-${link.label.toLowerCase()}`
              return (
                <Link
                  key={link.route}
                  to={link.route}
                  data-testid={testId}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === link.route
                      ? 'bg-orange-50 text-orange-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
            <CommerceMenu label="More" icon={MoreHorizontal} sections={moreMenu} testId="nav-more" menuTestId="nav-more-menu" />
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            {/* Currency Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="hidden md:flex gap-1 text-xs">
                  {currency} <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {['USD', 'ZiG', 'ZAR', 'BWP'].map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setCurrency(c as any)}>
                    {c} {currency === c && '✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-orange-500 text-[10px]">
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="px-3 py-2 font-semibold text-sm border-b">Notifications</div>
                {notifications.slice(0, 5).map((n) => (
                  <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1 p-3 cursor-pointer">
                    <div className="flex items-center gap-2 w-full">
                      <span className={`w-2 h-2 rounded-full ${n.read ? 'bg-gray-300' : 'bg-orange-500'}`} />
                      <span className="font-medium text-sm flex-1">{n.title}</span>
                    </div>
                    <p className="text-xs text-gray-500 ml-4 line-clamp-2">{n.message}</p>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" className="text-center text-orange-600 text-sm cursor-pointer">
                    View All Notifications
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Menu */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                    <span className="hidden md:inline text-sm">{user.name.split(' ')[0]}</span>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-3 py-2 border-b">
                    <p className="font-medium text-sm">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email} ({user.role?.toUpperCase()})</p>
                  </div>
                  <DropdownMenuItem asChild>
                    <Link to={activeDashboardPath} className="cursor-pointer">
                      <LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard/garage" className="cursor-pointer">
                      <Car className="w-4 h-4 mr-2" /> My Garage
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard/ai" className="cursor-pointer">
                      <MessageSquare className="w-4 h-4 mr-2" /> Gutu AI
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={activeDashboardPath} className="cursor-pointer">
                      <Settings className="w-4 h-4 mr-2" /> Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-3 py-1.5 text-[10px] text-gray-400 font-bold uppercase tracking-wider">Switch Portal Role</div>
                  {getAllRoles().map((r) => {
                    if (r === user.role) return null;
                    return (
                      <DropdownMenuItem key={r} onClick={() => handleRoleChange(r)} className="cursor-pointer text-xs">
                        Change to {getRoleMetadata(r).title}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600 cursor-pointer" onClick={() => {
                    logout()
                    window.location.href = '/'
                  }} data-testid="logout-button">
                    <LogOut className="w-4 h-4 mr-2" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/login">Sign In</Link>
                </Button>
                <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
                  <Link to={sellerPath} data-testid="nav-sell-cta">Sell Your Car</Link>
                </Button>
              </div>
            )}

            {/* Mobile Menu */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              data-testid="mobile-menu-button"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="lg:hidden border-t bg-white">
          <div className="section-padding py-4 space-y-1">
            {[
              { label: 'Buy', href: '/marketplace', icon: ShoppingCart },
              { label: 'Sell', href: sellerPath, icon: Car },
              { label: 'Verify', href: '/search', icon: Shield },
              { label: 'Parts', href: '/marketplace/parts', icon: Package },
              { label: 'Dealers', href: '/dealers', icon: Building2 },
              { label: 'Garages & Services', href: '/marketplace/services', icon: Wrench },
            ].map((link) => (
              <Link
                key={`${link.label}-${link.href}`}
                to={link.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  location.pathname === link.href
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
            <div className="border-t pt-2">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">More</p>
              {(moreMenu[0]?.items ?? []).filter(link => link.active).map(link => (
                <Link
                  key={link.id}
                  to={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="pt-2 border-t mt-2">
              {user ? (
                <>
                  <Link to={activeDashboardPath} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600">
                    <LayoutDashboard className="w-4 h-4" /> Dashboard
                  </Link>
                  <button onClick={() => {
                    logout()
                    window.location.href = '/'
                  }} className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 w-full" data-testid="logout-button">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <div className="flex gap-2 px-3">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link to="/login" onClick={() => setMobileOpen(false)}>Sign In</Link>
                  </Button>
                  <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600" asChild>
                    <Link to={sellerPath} onClick={() => setMobileOpen(false)}>Sell Your Car</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
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
  ShoppingCart,
  Bell,
  LayoutDashboard,
  LogOut,
  Settings,
  ChevronDown,
  Shield,
  MessageSquare,
  Package,
  MoreHorizontal
} from 'lucide-react'
import MobileNavDrawer from '@/components/layout/MobileNavDrawer'
import { useApp } from '@/App'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { getDashboardRoute, getRoleMetadata, getVisiblePublicNavigationItems } from '@/config/featureRegistry'
import type { NavigationContext, MarketplaceCoverageResponse } from '@/config/featureRegistry'
import { getDesktopMegaMenu, type ResolvedNavSection } from '@/config/navigationManifest'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { trackNav } from '@/lib/navigationAnalytics'
import { getAuthorizedPortalRoles } from '@/lib/authorizedPortalRoles'
import { presentUserNotifications, type PresentedUserNotification } from '@/lib/userNotifications'
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
    <DropdownMenu onOpenChange={(open) => { if (open) trackNav({ event_type: 'navigation_surface_opened', surface: 'mega_menu', node_id: menuTestId }) }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 data-[state=open]:bg-orange-50 data-[state=open]:text-orange-700"
          data-testid={testId}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
          <ChevronDown className="h-3 w-3 transition-transform duration-200" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-[760px] max-w-[calc(100vw-2rem)] p-5" data-testid={menuTestId}>
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-4">
          {sections.map(section => (
            <div key={section.title} className="min-w-0">
              <p className="mb-2 pb-1.5 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-400">{section.title}</p>
              <div className="space-y-0.5">
                {section.items.map(item => item.active ? (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link
                      to={item.href}
                      data-testid={`navitem-${item.id}`}
                      title={item.description}
                      onClick={() => trackNav({ event_type: 'navigation_item_selected', surface: 'mega_menu', feature_id: item.id, node_id: item.id, destination_route_pattern: item.href })}
                      className="flex min-h-[34px] items-center justify-between gap-2 cursor-pointer rounded-md px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-700 focus-visible:bg-orange-50 focus-visible:text-orange-700"
                    >
                      <span className="truncate">{item.label}</span>
                      {item.beta && <Badge className="shrink-0 bg-blue-100 text-blue-700 text-[10px]">Beta</Badge>}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <div
                    key={item.id}
                    data-testid={`navitem-${item.id}`}
                    data-planned="true"
                    aria-disabled="true"
                    title={item.description ?? 'Coming soon'}
                    className="flex min-h-[34px] items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 cursor-not-allowed select-none"
                  >
                    <span className="truncate">{item.label}</span>
                    <Badge variant="outline" className="shrink-0 border-gray-200 bg-transparent text-[10px] font-semibold uppercase tracking-wide text-gray-400">Soon</Badge>
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

function NotificationPreview({ notification }: { notification: PresentedUserNotification }) {
  return (
    <div className="flex w-full flex-col items-start gap-1">
      <div className="flex w-full items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-gray-300' : 'bg-orange-500'}`} />
        <span className="flex-1 truncate text-sm font-medium">{notification.displayTitle}</span>
        {notification.reference && <Badge variant="outline" className="max-w-24 truncate text-[10px]">{notification.reference}</Badge>}
      </div>
      <p className="ml-4 line-clamp-2 text-xs text-gray-500">{notification.displayMessage}</p>
      <time className="ml-4 text-[10px] text-gray-400" dateTime={notification.created_at || undefined}>{notification.displayTimestamp}</time>
    </div>
  )
}

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole, logout } = useAuth()
  const { currency, setCurrency } = useApp()
  const { fetchMarketplaceNavCoverage, fetchNotifications } = useCarUpApi()
  const [navCoverage, setNavCoverage] = useState<NavCoverageResponse | null>(null)
  const [userNotifications, setUserNotifications] = useState<PresentedUserNotification[]>([])

  useEffect(() => {
    let cancelled = false
    fetchMarketplaceNavCoverage().then(c => { if (!cancelled) setNavCoverage(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [fetchMarketplaceNavCoverage])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetchNotifications()
      .then(rows => { if (!cancelled) setUserNotifications(presentUserNotifications(rows)) })
      .catch(() => { if (!cancelled) setUserNotifications([]) })
    return () => { cancelled = true }
  }, [fetchNotifications, user])

  const visibleUserNotifications = user ? userNotifications : []
  const unreadCount = visibleUserNotifications.filter(notification => !notification.read).length
  const switchableRoles = user
    ? getAuthorizedPortalRoles(user).filter(role => role !== user.role)
    : []

  const activeDashboardPath = getDashboardRoute((user?.role || 'owner') as UserRole)
  const sellerPath = user ? '/dashboard/sell-vehicle' : '/register'

  // Registry-driven mega-menus. Coverage gating, lifecycle visibility and
  // auth/role-aware destinations are resolved by the navigation manifest — no
  // hardcoded menu arrays remain in this component.
  const effectiveStates = useFeatureEffectiveStates()
  const navContext: NavigationContext = {
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    environment: import.meta.env.MODE,
    coverage: (navCoverage as MarketplaceCoverageResponse | null) ?? null,
    effectiveStates,
  }
  const buyMenu = getDesktopMegaMenu('navbar-mega-buy', navContext)
  const sellMenu = getDesktopMegaMenu('navbar-mega-sell', navContext)
  const verifyMenu = getDesktopMegaMenu('navbar-mega-verify', navContext)
  const partsMenu = getDesktopMegaMenu('navbar-mega-parts', navContext)
  const moreMenu = getDesktopMegaMenu('navbar-more', navContext)

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as UserRole)
      navigate(getDashboardRoute(newRole as UserRole))
    } catch (err) {
      console.error('Failed to switch stakeholder role:', err)
      toast.error('Could not switch portal role. Please try again.')
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
            {getVisiblePublicNavigationItems(navContext).map((link) => {
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
                <Button variant="ghost" size="sm" className="hidden md:flex gap-1 text-xs" aria-label={`Currency: ${currency}. Change currency`}>
                  {currency} <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {['USD', 'ZiG', 'ZAR', 'BWP'].map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setCurrency(c as 'USD' | 'ZiG' | 'ZAR' | 'BWP')}>
                    {c} {currency === c && '✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                  data-testid="notification-menu-trigger"
                >
                  <Bell className="w-5 h-5" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center bg-orange-500 text-[10px]" aria-hidden="true" data-testid="notification-unread-count">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="px-3 py-2 font-semibold text-sm border-b">Notifications</div>
                {!user && (
                  <div className="px-3 py-5 text-center text-sm text-gray-500">Sign in to see account notifications.</div>
                )}
                {user && visibleUserNotifications.length === 0 && (
                  <div className="px-3 py-5 text-center text-sm text-gray-500" data-testid="notification-menu-empty">No notifications yet.</div>
                )}
                {visibleUserNotifications.slice(0, 5).map((notification) => notification.href ? (
                  <DropdownMenuItem key={notification.id} asChild>
                    <Link to={notification.href} className="cursor-pointer p-3" data-testid="notification-menu-item">
                      <NotificationPreview notification={notification} />
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={notification.id} className="p-3" data-testid="notification-menu-item">
                    <NotificationPreview notification={notification} />
                  </DropdownMenuItem>
                ))}
                {user && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/notifications" className="text-center text-orange-600 text-sm cursor-pointer" data-testid="notification-center-link">
                        View All Notifications
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Menu */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2" aria-label={`Account menu for ${user.name}`}>
                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                    <span className="hidden md:inline text-sm">{user.name.split(' ')[0]}</span>
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
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
                  {switchableRoles.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-3 py-1.5 text-[10px] text-gray-400 font-bold uppercase tracking-wider">Switch Portal Role</div>
                      {switchableRoles.map((role) => (
                        <DropdownMenuItem key={role} onClick={() => handleRoleChange(role)} className="cursor-pointer text-xs" data-testid={`roleswitch-${role}`}>
                          Change to {getRoleMetadata(role).title}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
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

            {/* Mobile Menu — registry-driven drawer with focus trap (Milestone 4) */}
            <MobileNavDrawer />
          </div>
        </div>
      </div>
    </header>
  )
}

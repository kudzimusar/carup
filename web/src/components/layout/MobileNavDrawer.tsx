import { useState } from 'react'
import { toast } from 'sonner'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signInHrefFor } from '@/lib/signInHref'
import { Menu, LogOut, LayoutDashboard, UserCog, LogIn, Car, CircleUserRound, ChevronDown } from 'lucide-react'
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import { resolveShowroomNavigation, resolveShowroomSupport } from '@/config/showroomNavigation'
import { isLaunchPreviewEnabled } from '@/lib/presentationFlags'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { getMobileNavigation, type ResolvedNavItem } from '@/config/navigationManifest'
import { getAllRoles, getRoleMetadata, getDashboardRoute, type NavigationContext } from '@/config/featureRegistry'
import { resolveFeatureIcon } from '@/config/featureIcons'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import type { UserRole } from '@shared/types'

// Hoisted to module scope so its identity is stable across renders (a component
// declared inside the parent's render body would be recreated every render).

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">{children}</p>
  )
}

/**
 * Registry-driven mobile navigation drawer (Milestone 4).
 *
 * Built on the Radix Dialog-backed Sheet, which provides aria-modal, focus
 * trapping, Escape-to-close, overlay-click-close and focus return to the
 * trigger. All items come from getMobileNavigation() — the same registry used
 * by desktop — so there is no hardcoded mobile route array and no cross-role
 * leakage. Active route is marked with aria-current.
 */
export default function MobileNavDrawer({ showroom = false }: { showroom?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole, logout } = useAuth()

  const effectiveStates = useFeatureEffectiveStates()
  const ctx: NavigationContext = {
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    environment: import.meta.env.MODE,
    effectiveStates,
  }
  const nav = getMobileNavigation(ctx)
  const showroomContext = { isAuthenticated: !!user, role: (user?.role as UserRole) ?? null, effectiveStates, launchPreview: showroom && isLaunchPreviewEnabled() }
  const showroomGroups = showroom ? resolveShowroomNavigation(showroomContext) : []
  const showroomSupport = showroom ? resolveShowroomSupport(showroomContext) : []
  const close = () => setOpen(false)

  const isActive = (href: string) => {
    const path = href.split('?')[0]
    return location.pathname === path
  }

  const handleRoleChange = async (role: UserRole) => {
    try {
      await switchRole(role as never)
      close()
      navigate(getDashboardRoute(role))
    } catch (err) {
      // Do NOT navigate — the switch failed. Announce it accessibly (sonner
      // renders an aria-live region) instead of failing silently.
      console.error('Failed to switch stakeholder role:', err)
      toast.error('Could not switch portal role. Please try again.')
    }
  }

  const handleLogout = () => {
    logout()
    close()
    navigate('/')
  }

  const DrawerLink = ({ item, testid }: { item: ResolvedNavItem; testid?: string }) => {
    const Icon = item.icon ? resolveFeatureIcon(item.icon) : null
    const active = isActive(item.href)
    return (
      <Link
        to={item.href}
        onClick={close}
        data-testid={testid ?? `mobile-navitem-${item.id}`}
        aria-current={active ? 'page' : undefined}
        className={showroom
          ? `flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${active ? 'bg-[#09122A] text-white' : 'text-[#09122A] hover:bg-[#F1EFEA]'}`
          : `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
          active
            ? 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100'
            : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
        }`}
      >
        {Icon && <Icon className={showroom ? `h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-slate-500'}` : `w-4 h-4 shrink-0 ${active ? 'text-orange-500' : 'text-gray-400'}`} aria-hidden="true" />}
        <span className="flex-1">{item.label}</span>
        {item.beta && <Badge className="bg-blue-100 text-blue-700 text-[10px]">Beta</Badge>}
      </Link>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={showroom ? 'h-11 w-11 rounded-full text-[#09122A] hover:bg-[#F1EFEA] lg:hidden' : 'lg:hidden'}
          data-testid="mobile-menu-button"
          aria-label={showroom ? 'Profile and menu' : 'Open menu'}
        >
          {showroom ? <CircleUserRound className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" /> : <Menu className="w-5 h-5" />}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={showroom ? 'right' : 'left'}
        className="w-[310px] max-w-[85vw] overflow-y-auto p-0"
        data-testid="mobile-nav-drawer"
      >
        <SheetHeader className="px-4 pt-4 pb-3 text-left border-b">
          {showroom ? (
            <SheetTitle className="flex items-center">
              <BrandIdentity role="stacked" surface="light" height={44} />
            </SheetTitle>
          ) : (
            <SheetTitle className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <Car className="w-4 h-4 text-white" aria-hidden="true" />
              </span>
              <span className="text-lg font-bold tracking-tight">
                Car<span className="text-orange-700">Up</span>
              </span>
            </SheetTitle>
          )}
          {user ? (
            <p className="text-xs text-gray-500">
              {user.name.split(' ')[0]} · {getRoleMetadata(user.role as UserRole).title}
            </p>
          ) : (
            <p className="text-xs text-gray-500">Browse, verify and buy with clearer trust signals.</p>
          )}
          <SheetDescription className="sr-only">Site and account navigation</SheetDescription>
        </SheetHeader>

        {showroom ? (
          <nav className="space-y-1 px-2 pb-8" aria-label="Profile and navigation">
            {/* RX03 R3: Profile first. Signed out: sign in / create account. Signed in: dashboard,
                role items (incl. Communications — the Inbox), then everything not already a tab. */}
            {user ? (
              nav.dashboardRoot && (
                <section aria-label="Your dashboard" className="pt-2">
                  <SectionLabel>Your CarUp</SectionLabel>
                  <Link
                    to={nav.dashboardRoot.href}
                    onClick={close}
                    data-testid="mobile-dashboard-root"
                    aria-current={isActive(nav.dashboardRoot.href) ? 'page' : undefined}
                    className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${isActive(nav.dashboardRoot.href) ? 'bg-[#09122A] text-white' : 'text-[#09122A] hover:bg-[#F1EFEA]'}`}
                  >
                    <LayoutDashboard className={`h-[18px] w-[18px] shrink-0 ${isActive(nav.dashboardRoot.href) ? 'text-white' : 'text-slate-500'}`} aria-hidden="true" />
                    <span className="flex-1">{nav.dashboardRoot.label}</span>
                  </Link>
                  {nav.roleItems.map(item => <DrawerLink key={item.id} item={item} />)}
                </section>
              )
            ) : (
              <section aria-label="Account" className="flex flex-col gap-2 px-2 pt-4">
                <Button asChild className="h-11 w-full justify-center gap-2 rounded-full bg-[#09122A] text-[15px] font-semibold text-white hover:bg-[#111D3D]" data-testid="mobile-signin">
                  <Link to={signInHrefFor(location)} onClick={close}>
                    <LogIn className="h-4 w-4" aria-hidden="true" /> Sign In
                  </Link>
                </Button>
                <Button variant="outline" asChild className="h-11 w-full justify-center rounded-full border-slate-300 text-[15px] font-semibold text-[#09122A]" data-testid="mobile-register">
                  <Link to="/register" onClick={close}>Create account</Link>
                </Button>
              </section>
            )}

            {/* RX03 Addendum 05: the same purpose-grouped taxonomy as the desktop masthead
                (config/showroomNavigation), one collapsible section per purpose. */}
            {showroomGroups.map(group => (
              <details key={group.id} className="group/sec mt-2 border-t border-slate-200 pt-1" data-testid={`sheet-group-${group.id}`}>
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-[#09122A]">{group.label}</span>
                    <span className="block truncate text-[12px] text-slate-500">{group.summary}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open/sec:rotate-180" aria-hidden="true" />
                </summary>
                <div className="pb-2">
                  {group.columns.flatMap(column => column.links).map(link => (
                    <Link
                      key={link.id}
                      to={link.href}
                      onClick={close}
                      data-testid={`sheet-link-${link.id}`}
                      aria-current={isActive(link.href) ? 'page' : undefined}
                      className={`flex min-h-[44px] flex-col justify-center gap-0.5 rounded-xl px-3 py-2 text-[15px] transition-colors ${isActive(link.href) ? 'bg-[#09122A] font-semibold text-white' : 'text-[#09122A] hover:bg-[#F1EFEA]'}`}
                    >
                      <span>{link.label}</span>
                      {link.description && <span className={`text-[12px] ${isActive(link.href) ? 'text-white/70' : 'text-slate-600'}`}>{link.description}</span>}
                    </Link>
                  ))}
                </div>
              </details>
            ))}

            {showroomSupport.length > 0 && (
              <section aria-label="Help and contact" className="mt-2 border-t border-slate-200 pt-1">
                <SectionLabel>Help &amp; contact</SectionLabel>
                {showroomSupport.map(link => (
                  <Link
                    key={link.id}
                    to={link.href}
                    onClick={close}
                    data-testid={`sheet-link-${link.id}`}
                    className="flex min-h-[44px] items-center rounded-xl px-3 py-2 text-[15px] text-[#09122A] hover:bg-[#F1EFEA]"
                  >
                    {link.label}
                  </Link>
                ))}
              </section>
            )}

            {/* No role-switch list: the server authorises no switch from this list (audit A1), so it
                is not advertised. The accepted drawer is unchanged. */}
            {user && (
              <section aria-label="Account" className="mt-3 border-t border-slate-200 pt-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  data-testid="mobile-signout"
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-red-700 hover:bg-red-50"
                >
                  <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-left">Sign Out</span>
                </button>
              </section>
            )}
          </nav>
        ) : (
          <nav className="px-2 pb-6 space-y-1" aria-label="Mobile navigation">
            {/* Primary public links */}
            <section aria-label="Browse">
              <SectionLabel>Browse</SectionLabel>
              {nav.primary.map(item => <DrawerLink key={item.id} item={item} />)}
            </section>

            {/* Authenticated dashboard + role-specific items */}
            {user && nav.dashboardRoot && (
              <section aria-label="Your dashboard" className="border-t mt-2 pt-1">
                <SectionLabel>Your Dashboard</SectionLabel>
                <Link
                  to={nav.dashboardRoot.href}
                  onClick={close}
                  data-testid="mobile-dashboard-root"
                  aria-current={isActive(nav.dashboardRoot.href) ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
                    isActive(nav.dashboardRoot.href)
                      ? 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100'
                      : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
                  }`}
                >
                  <LayoutDashboard className={`w-4 h-4 shrink-0 ${isActive(nav.dashboardRoot.href) ? 'text-orange-500' : 'text-gray-400'}`} aria-hidden="true" />
                  <span className="flex-1">{nav.dashboardRoot.label}</span>
                </Link>
                {nav.roleItems.map(item => <DrawerLink key={item.id} item={item} />)}
              </section>
            )}

            {/* Secondary / More */}
            {nav.secondary.length > 0 && (
              <section aria-label="More" className="border-t mt-2 pt-1">
                <SectionLabel>More</SectionLabel>
                {nav.secondary.map(item => <DrawerLink key={item.id} item={item} />)}
              </section>
            )}

            {/* Account */}
            <section aria-label="Account" className="border-t mt-2 pt-2">
              {user ? (
                <>
                  <SectionLabel>Switch Portal Role</SectionLabel>
                  {getAllRoles().filter(r => r !== user.role).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleRoleChange(r)}
                      data-testid={`mobile-roleswitch-${r}`}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 min-h-[44px]"
                    >
                      <UserCog className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 text-left">Change to {getRoleMetadata(r).title}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleLogout}
                    data-testid="mobile-signout"
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-600 hover:bg-red-50 min-h-[44px]"
                  >
                    <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left">Sign Out</span>
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2 px-2 pt-1">
                  <Button variant="outline" asChild className="w-full justify-start gap-2" data-testid="mobile-signin">
                    <Link to="/login" onClick={close}>
                      <LogIn className="w-4 h-4" /> Sign In
                    </Link>
                  </Button>
                  <Button asChild className="w-full justify-start gap-2 bg-orange-500 hover:bg-orange-600" data-testid="mobile-register">
                    <Link to="/register" onClick={close}>Create account</Link>
                  </Button>
                </div>
              )}
            </section>
          </nav>
        )}
      </SheetContent>
    </Sheet>
  )
}

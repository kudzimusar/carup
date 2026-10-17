import { useCallback, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, LogOut, LayoutDashboard, LogIn, Car } from 'lucide-react'
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
import { getRoleMetadata, normalizeFrontendRole, type NavigationContext } from '@/config/featureRegistry'
import { resolveFeatureIcon } from '@/config/featureIcons'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { useShellSignOut } from './useShellSignOut'
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
export default function MobileNavDrawer() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { user } = useAuth()

  const effectiveStates = useFeatureEffectiveStates()
  const ctx: NavigationContext = {
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    environment: import.meta.env.MODE,
    effectiveStates,
  }
  const nav = getMobileNavigation(ctx)
  const close = useCallback(() => setOpen(false), [])
  const handleLogout = useShellSignOut(close)
  const portalRole = normalizeFrontendRole(user?.role)

  const isActive = (href: string) => {
    const path = href.split('?')[0]
    return location.pathname === path
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
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
          active
            ? 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100'
            : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
        }`}
      >
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-orange-500' : 'text-gray-400'}`} aria-hidden="true" />}
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
          className="xl:hidden"
          data-testid="mobile-menu-button"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[310px] max-w-[85vw] overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)]"
        data-testid="mobile-nav-drawer"
      >
        <SheetHeader className="px-4 pt-4 pb-3 text-left border-b">
          <SheetTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-4 h-4 text-white" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              Car<span className="text-orange-500">Up</span>
            </span>
          </SheetTitle>
          {user ? (
            <p className="text-xs text-gray-500" data-testid="mobile-active-portal">
              {user.name.split(' ')[0]} · {getRoleMetadata((portalRole ?? user.role) as UserRole).title}
            </p>
          ) : (
            <p className="text-xs text-gray-500">Browse, verify and buy with clearer trust signals.</p>
          )}
          <SheetDescription className="sr-only">Site and account navigation</SheetDescription>
        </SheetHeader>

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
                {/* PC01-K1: the active portal is stated, never offered as a catalogue of every
                    platform role — the server refuses all but the session's own (an organisation
                    is chosen through the account menu's verified organisation section). */}
                <SectionLabel>Account</SectionLabel>
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
                {/* PC01-J-R1: 44 px touch targets — these rendered 36 px tall on a phone. */}
                <Button variant="outline" asChild className="min-h-11 w-full justify-start gap-2" data-testid="mobile-signin">
                  <Link to="/login" onClick={close}>
                    <LogIn className="w-4 h-4" /> Sign In
                  </Link>
                </Button>
                <Button asChild className="min-h-11 w-full justify-start gap-2 bg-orange-500 hover:bg-orange-600" data-testid="mobile-register">
                  <Link to="/register" onClick={close}>Create account</Link>
                </Button>
              </div>
            )}
          </section>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

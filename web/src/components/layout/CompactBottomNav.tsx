import { Link, useLocation } from 'react-router-dom'
import { CarFront, CircleUserRound, Home, Menu, Search, Tag, type LucideIcon } from 'lucide-react'
import * as Icons from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { COMPACT_NAV_MAX, resolveCompactDestinations, resolveCompactHome, type CompactDestination } from './compactNavDestinations'

/**
 * The single compact (mobile) navigation bar for CarUp.
 *
 * There is ONE of these. `GarageBottomNav`, `MechanicBottomNav` and friends would be competing
 * systems, and CarUp has already paid for one fact being decided in several places — seven times, in
 * this exact area. Destinations come from the feature registry and are filtered by the same
 * `resolveFeatureVisibility` the sidebar, drawer and route boundary use, so what the bar offers and
 * what a route admits cannot disagree.
 *
 * Signed out it stays the public wayfinding bar (Home / Market / Verify / Sell / Account) — the
 * behaviour it has always had. Signed in it becomes the operating context's bar, with "More" opening
 * the existing drawer rather than introducing a second secondary-navigation surface.
 */

/** The registry stores an icon NAME; resolve it without letting a bad name crash the bar. */
function iconFor(name: string): LucideIcon {
  const candidate = (Icons as unknown as Record<string, LucideIcon>)[name]
  return candidate ?? CircleUserRound
}

export default function CompactBottomNav({ onOpenMore }: { onOpenMore?: () => void } = {}) {
  const location = useLocation()
  const { user, isAuthenticated } = useAuth()
  const effectiveStates = useFeatureEffectiveStates()

  const ctx = {
    isAuthenticated,
    role: user?.role ?? null,
    // A garage employee is `owner` platform-wide and `mechanic` in their garage. The bar follows the
    // role they are OPERATING as; without this it offered a garage operator their own car.
    tenantRole: (user?.active_tenant_role ?? null) as never,
    environment: import.meta.env.MODE,
    effectiveStates,
  }

  const authedDestinations: CompactDestination[] = isAuthenticated ? resolveCompactDestinations(ctx) : []

  const items = isAuthenticated && authedDestinations.length
    ? [
      ...authedDestinations.map((d) => ({
        label: d.label,
        href: d.href,
        icon: iconFor(d.icon),
        // Longest-prefix match, so /garage/customers marks Customers rather than also marking the
        // Workshop at /garage — DESIGN.md §6.3: one item, one destination, one active state.
        active: location.pathname === d.href
          || (location.pathname.startsWith(`${d.href}/`)
            && !authedDestinations.some((o) => o !== d && o.href.length > d.href.length
              && (location.pathname === o.href || location.pathname.startsWith(`${o.href}/`)))),
        onClick: undefined as (() => void) | undefined,
      })),
      {
        label: 'More',
        href: resolveCompactHome(ctx),
        icon: Menu,
        active: false,
        // "More" opens the drawer that already holds every secondary destination. Without a drawer
        // to open (no handler passed) it falls back to being a link, so it is never a dead control.
        onClick: onOpenMore,
      },
    ].slice(0, COMPACT_NAV_MAX)
    : [
      { label: 'Home', href: '/', icon: Home, active: location.pathname === '/', onClick: undefined },
      { label: 'Market', href: '/marketplace', icon: CarFront, active: location.pathname.startsWith('/marketplace'), onClick: undefined },
      { label: 'Verify', href: '/search', icon: Search, active: location.pathname.startsWith('/search'), onClick: undefined },
      { label: 'Sell', href: '/sell', icon: Tag, active: location.pathname === '/sell', onClick: undefined },
      { label: 'Account', href: isAuthenticated ? resolveCompactHome(ctx) : '/login', icon: CircleUserRound, active: location.pathname.startsWith('/login') || location.pathname.startsWith('/register'), onClick: undefined },
    ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden"
      aria-label="Compact app navigation"
      data-testid="compact-bottom-nav"
      data-context={isAuthenticated ? (user?.active_tenant_role ?? user?.role ?? 'authenticated') : 'public'}
    >
      <div
        className="mx-auto grid max-w-xl"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ label, href, icon: Icon, active, onClick }) => {
          const className = `flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition ${active ? 'text-orange-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`
          const body = (
            <>
              <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : ''}`} aria-hidden="true" />
              <span className="truncate w-full text-center">{label}</span>
            </>
          )
          return onClick
            ? (
              <button
                key={label} type="button" onClick={onClick} className={className}
                data-testid="compact-nav-item" data-label={label}
              >
                {body}
              </button>
            )
            : (
              <Link
                key={label} to={href} className={className}
                aria-current={active ? 'page' : undefined}
                data-testid="compact-nav-item" data-label={label}
              >
                {body}
              </Link>
            )
        })}
      </div>
    </nav>
  )
}

import { Link, useLocation } from 'react-router-dom'
import { Box, CarFront, CircleUserRound, Home, Search, ShieldCheck, Tag } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useHonourBottomBarClaim } from '@/lib/bottomBarClaim'
import { isShowroomChromeEnabled } from '@/lib/presentationFlags'

const ROLE_HOME: Record<string, string> = {
  owner: '/dashboard',
  dealer: '/dealer',
  mechanic: '/mechanic',
  bank: '/bank',
  insurance: '/insurance-dash',
  government: '/government',
  admin: '/admin',
}

export default function CompactBottomNav() {
  const location = useLocation()
  const { user, isAuthenticated } = useAuth()
  const showroomChrome = isShowroomChromeEnabled()
  // RX03-P1b (behind the independent chrome presentation): one bottom bar at a time — a page's own
  // action bar (Vehicle Detail contact) takes the slot. With the presentation off the bar is unchanged.
  const yielded = useHonourBottomBarClaim(showroomChrome)

  const sellHref = !isAuthenticated
    ? '/sell'
    : user?.role === 'dealer'
      ? '/dealer/inventory'
      : user?.role === 'owner'
        ? '/dashboard/sell-vehicle'
        : ROLE_HOME[user?.role ?? ''] || '/'

  const accountHref = isAuthenticated ? (ROLE_HOME[user?.role ?? ''] || '/') : '/login'

  // RX03 R3 (chrome on): the Owner's binding primary journeys — Home | Buy | Verify | Sell | Trade
  // (native IA amendment, 13 Oct 2026). Account moves to the header Profile control. Trade opens the
  // governed Diaspora Trade gateway (product.diaspora, /diaspora); its route guard owns lifecycle.
  const showroomItems = [
    { label: 'Home', href: '/', icon: Home, active: location.pathname === '/' },
    // Same icon vocabulary as the native tab bar (mobile/navigation/nativeShell.ts @88bffa50):
    // search · shield-checkmark · pricetag · cube.
    { label: 'Buy', href: '/marketplace', icon: Search, active: location.pathname.startsWith('/marketplace') },
    { label: 'Verify', href: '/search', icon: ShieldCheck, active: location.pathname.startsWith('/search') },
    { label: 'Sell', href: sellHref, icon: Tag, active: location.pathname === '/sell' || location.pathname.includes('sell-vehicle') || location.pathname.includes('/inventory') },
    { label: 'Trade', href: '/diaspora', icon: Box, active: location.pathname.startsWith('/diaspora') },
  ]

  const acceptedItems = [
    { label: 'Home', href: '/', icon: Home, active: location.pathname === '/' },
    { label: 'Market', href: '/marketplace', icon: CarFront, active: location.pathname.startsWith('/marketplace') },
    { label: 'Verify', href: '/search', icon: Search, active: location.pathname.startsWith('/search') },
    { label: 'Sell', href: sellHref, icon: Tag, active: location.pathname === '/sell' || location.pathname.includes('sell-vehicle') || location.pathname.includes('/inventory') },
    { label: 'Account', href: accountHref, icon: CircleUserRound, active: location.pathname.startsWith('/login') || location.pathname.startsWith('/register') || (isAuthenticated && location.pathname === accountHref) },
  ]

  const items = showroomChrome ? showroomItems : acceptedItems

  if (yielded) return null

  return (
    <nav
      className={showroomChrome
        ? 'fixed inset-x-0 bottom-0 z-50 border-t border-slate-200/70 bg-white/92 px-2 pb-[max(env(safe-area-inset-bottom),0.4rem)] pt-1 backdrop-blur-xl lg:hidden'
        : 'fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden'}
      data-chrome={showroomChrome ? 'showroom' : 'accepted'}
      aria-label="Compact app navigation"
      data-testid="compact-bottom-nav"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {items.map(({ label, href, icon: Icon, active }) => (
          <Link
            key={label}
            to={href}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 ${showroomChrome ? 'text-[11px]' : 'text-[10px]'} font-medium transition ${showroomChrome
              ? (active ? 'font-semibold text-[#09122A]' : 'text-slate-600 hover:text-[#09122A]')
              : (active ? 'text-orange-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900')}`}
            aria-current={active ? 'page' : undefined}
          >
            {showroomChrome ? (
              <>
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? 'bg-[#09122A] text-white' : ''}`}>
                  <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.2 : 1.75} aria-hidden="true" />
                </span>
                <span>{label}</span>
              </>
            ) : (
              <>
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : ''}`} />
                <span>{label}</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  )
}

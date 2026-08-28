import { Link, useLocation } from 'react-router-dom'
import { CarFront, CircleUserRound, Home, Search, Tag } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

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

  const sellHref = !isAuthenticated
    ? '/sell'
    : user?.role === 'dealer'
      ? '/dealer/inventory'
      : user?.role === 'owner'
        ? '/dashboard/sell-vehicle'
        : ROLE_HOME[user?.role ?? ''] || '/'

  const accountHref = isAuthenticated ? (ROLE_HOME[user?.role ?? ''] || '/') : '/login'

  const items = [
    { label: 'Home', href: '/', icon: Home, active: location.pathname === '/' },
    { label: 'Market', href: '/marketplace', icon: CarFront, active: location.pathname.startsWith('/marketplace') },
    { label: 'Verify', href: '/search', icon: Search, active: location.pathname.startsWith('/search') },
    { label: 'Sell', href: sellHref, icon: Tag, active: location.pathname === '/sell' || location.pathname.includes('sell-vehicle') || location.pathname.includes('/inventory') },
    { label: 'Account', href: accountHref, icon: CircleUserRound, active: location.pathname.startsWith('/login') || location.pathname.startsWith('/register') || (isAuthenticated && location.pathname === accountHref) },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden"
      aria-label="Compact app navigation"
      data-testid="compact-bottom-nav"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {items.map(({ label, href, icon: Icon, active }) => (
          <Link
            key={label}
            to={href}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition ${active ? 'text-orange-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : ''}`} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

// @ts-nocheck
import { useState } from 'react'
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
  Search,
  ShoppingCart,
  Bell,
  User,
  LayoutDashboard,
  LogOut,
  Settings,
  ChevronDown,
  Shield,
  Wrench,
  Building2,
  FileText,
  MessageSquare
} from 'lucide-react'
import { useApp } from '@/App'
import { useAuth } from '@/context/AuthContext'
import { notifications } from '@/data/mockData'

const navLinks = [
  { label: 'Marketplace', href: '/marketplace', icon: ShoppingCart },
  { label: 'Search', href: '/search', icon: Search },
  { label: 'Dealers', href: '/dealers', icon: Building2 },
  { label: 'Garages', href: '/garages', icon: Wrench },
  { label: 'Insurance', href: '/insurance', icon: Shield },
  { label: 'Pricing', href: '/pricing', icon: FileText },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole, logout } = useAuth()
  const { currency, setCurrency } = useApp()
  const unreadCount = notifications.filter(n => !n.read).length

  const dashboardRoutes: Record<string, string> = {
    owner: '/dashboard',
    dealer: '/dealer',
    mechanic: '/mechanic',
    insurance: '/insurance-dash',
    government: '/government',
    admin: '/admin'
  }
  const activeDashboardPath = dashboardRoutes[user?.role || 'owner'] || '/dashboard'

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as any)
      navigate(dashboardRoutes[newRole] || '/dashboard')
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
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === link.href
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
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
                  {['owner', 'dealer', 'mechanic', 'insurance', 'government', 'admin'].map((r) => {
                    if (r === user.role) return null;
                    const labels: Record<string, string> = {
                      owner: 'Car Owner',
                      dealer: 'Dealer',
                      mechanic: 'Mechanic',
                      insurance: 'Insurance',
                      government: 'Government',
                      admin: 'Admin'
                    }
                    return (
                      <DropdownMenuItem key={r} onClick={() => handleRoleChange(r)} className="cursor-pointer text-xs">
                        Change to {labels[r]}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600 cursor-pointer" onClick={() => {
                    logout()
                    window.location.href = '/'
                  }}>
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
                  <Link to="/register">Get Started</Link>
                </Button>
              </div>
            )}

            {/* Mobile Menu */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
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
            {navLinks.map((link) => (
              <Link
                key={link.href}
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
            <div className="pt-2 border-t mt-2">
              {user ? (
                <>
                  <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600">
                    <LayoutDashboard className="w-4 h-4" /> Dashboard
                  </Link>
                  <button onClick={() => {
                    logout()
                    window.location.href = '/'
                  }} className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 w-full">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <div className="flex gap-2 px-3">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link to="/login" onClick={() => setMobileOpen(false)}>Sign In</Link>
                  </Button>
                  <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600" asChild>
                    <Link to="/register" onClick={() => setMobileOpen(false)}>Get Started</Link>
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
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

interface MenuItem {
  label: string
  href: string
}

interface MenuSection {
  title: string
  items: MenuItem[]
}

const buyMenu: MenuSection[] = [
  {
    title: 'Vehicles',
    items: [
      { label: 'Shop All Cars', href: '/marketplace' },
      { label: 'Brand New Cars', href: '/marketplace' },
      { label: 'Recently Imported', href: '/marketplace' },
      { label: 'Locally Used', href: '/marketplace' },
      { label: 'Second Hand Cars', href: '/marketplace' },
      { label: 'Dealer Verified Cars', href: '/marketplace' },
      { label: 'Passport Verified Cars', href: '/marketplace' },
    ],
  },
  {
    title: 'Popular Categories',
    items: [
      { label: 'SUVs', href: '/marketplace' },
      { label: 'Pickups', href: '/marketplace' },
      { label: 'Hatchbacks', href: '/marketplace' },
      { label: 'Sedans', href: '/marketplace' },
      { label: 'Toyota', href: '/marketplace' },
      { label: 'Honda', href: '/marketplace' },
      { label: 'Mazda', href: '/marketplace' },
      { label: 'Under $5,000', href: '/marketplace' },
      { label: 'Under $10,000', href: '/marketplace' },
    ],
  },
  {
    title: 'Buyer Tools',
    items: [
      { label: 'Verify Before You Buy', href: '/search' },
      { label: 'View Vehicle Passport', href: '/search' },
      { label: 'Compare Trust Scores', href: '/marketplace' },
      { label: 'PartSentry Checked Vehicles', href: '/marketplace' },
    ],
  },
  {
    title: 'Trust Guide',
    items: [
      { label: 'Brand New vs Imported vs Locally Used', href: '/marketplace' },
      { label: 'How to check a vehicle Passport before paying', href: '/search' },
    ],
  },
]

const partsMenu: MenuSection[] = [
  {
    title: 'Buy Parts',
    items: [
      { label: 'Browse Car Parts', href: '/garages' },
      { label: 'Verified Parts', href: '/garages' },
      { label: 'Engines', href: '/garages' },
      { label: 'Gearboxes', href: '/garages' },
      { label: 'ECUs', href: '/garages' },
      { label: 'Body Panels', href: '/garages' },
      { label: 'Lights', href: '/garages' },
      { label: 'Tyres & Wheels', href: '/garages' },
      { label: 'Batteries', href: '/garages' },
      { label: 'Accessories', href: '/garages' },
    ],
  },
  {
    title: 'Sell Parts',
    items: [
      { label: 'Sell a Part', href: '/register' },
      { label: 'List Accessories', href: '/register' },
      { label: 'Garage Parts Inventory', href: '/garages' },
      { label: 'Mechanic Parts Catalog', href: '/garages' },
    ],
  },
  {
    title: 'PartSentry',
    items: [
      { label: 'Verify Part Origin', href: '/search' },
      { label: 'Check Repair History', href: '/search' },
      { label: 'Report Stolen Part', href: '/search' },
      { label: 'Link Part to Vehicle Passport', href: '/search' },
      { label: 'Mechanic Work Orders', href: '/register' },
    ],
  },
  {
    title: 'Parts Trust Guide',
    items: [
      { label: 'How PartSentry protects parts buyers', href: '/search' },
      { label: 'Why verified parts matter for used cars', href: '/marketplace' },
    ],
  },
]

const moreMenu: MenuSection[] = [
  {
    title: 'More',
    items: [
      { label: 'Insurance', href: '/insurance' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'How It Works', href: '/' },
      { label: 'Trust & Safety', href: '/trust' },
      { label: 'Help', href: '/help' },
      { label: 'Contact', href: '/contact' },
      { label: 'Blog', href: '/blog' },
    ],
  },
]

function CommerceMenu({
  label,
  icon: Icon,
  sections,
  testId,
  menuTestId,
}: {
  label: string
  icon: typeof ShoppingCart
  sections: MenuSection[]
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
                {section.items.map(item => (
                  <DropdownMenuItem key={`${section.title}-${item.label}`} asChild>
                    <Link to={item.href} className="cursor-pointer rounded-md px-2 py-1.5 text-sm">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
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
  const sellerPath = user ? '/dashboard/sell-vehicle' : '/register'
  const evidencePath = user ? '/dashboard/garage' : '/register'

  const verifyMenu: MenuSection[] = [
    {
      title: 'Vehicle Verification',
      items: [
        { label: 'Verify by Plate', href: '/search' },
        { label: 'Verify by VIN', href: '/search' },
        { label: 'Verify by Chassis', href: '/search' },
        { label: 'Open Vehicle Passport', href: '/search' },
      ],
    },
    {
      title: 'Trust Checks',
      items: [
        { label: 'Ownership Privacy Summary', href: '/search' },
        { label: 'Evidence Timeline', href: user ? '/dashboard/garage' : '/search' },
        { label: 'ZIMRA / Duty Signals', href: '/search' },
        { label: 'CID / Theft Signals', href: '/search' },
        { label: 'Odometer / Mileage Signals', href: '/search' },
      ],
    },
    {
      title: 'PartSentry Verification',
      items: [
        { label: 'Check Part History', href: '/search' },
        { label: 'Check Repair Logs', href: '/search' },
        { label: 'Check Swapped Parts', href: '/search' },
        { label: 'Check Stolen/Suspicious Parts', href: '/search' },
      ],
    },
  ]

  const sellMenu: MenuSection[] = [
    {
      title: 'Sell Vehicles',
      items: [
        { label: 'Sell Your Car', href: sellerPath },
        { label: 'Create Vehicle Passport', href: '/register' },
        { label: 'Dealer Listing', href: '/register' },
        { label: 'Sell as Private Owner', href: '/register' },
      ],
    },
    {
      title: 'Seller Tools',
      items: [
        { label: 'Start with Plate / VIN', href: sellerPath },
        { label: 'Upload Vehicle Evidence', href: evidencePath },
        { label: 'Add Service History', href: '/register' },
        { label: 'SafePay / Reservation Ready', href: '/register' },
      ],
    },
    {
      title: 'Sell Parts & Accessories',
      items: [
        { label: 'Sell Car Parts', href: '/register' },
        { label: 'Sell Accessories', href: '/register' },
        { label: 'Mechanic / Garage Parts Listing', href: '/garages' },
      ],
    },
    {
      title: 'Seller Guide',
      items: [
        { label: 'How to sell with a verified Passport', href: '/register' },
        { label: 'How PartSentry protects honest sellers', href: '/search' },
      ],
    },
  ]

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
          <nav className="hidden lg:flex items-center gap-1" data-testid="public-primary-nav">
            <CommerceMenu label="Buy" icon={ShoppingCart} sections={buyMenu} testId="nav-buy" menuTestId="nav-buy-menu" />
            <CommerceMenu label="Sell" icon={Car} sections={sellMenu} testId="nav-sell" menuTestId="nav-sell-menu" />
            <CommerceMenu label="Verify" icon={Shield} sections={verifyMenu} testId="nav-verify" menuTestId="nav-verify-menu" />
            <CommerceMenu label="Parts" icon={Package} sections={partsMenu} testId="nav-parts" menuTestId="nav-parts-menu" />
            {[
              { label: 'Dealers', href: '/dealers', icon: Building2, testId: 'nav-dealers' },
              { label: 'Garages', href: '/garages', icon: Wrench, testId: 'nav-garages' },
            ].map((link) => (
              <Link
                key={link.href}
                to={link.href}
                data-testid={link.testId}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === link.href
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
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
              { label: 'Parts', href: '/garages', icon: Package },
              { label: 'Dealers', href: '/dealers', icon: Building2 },
              { label: 'Garages', href: '/garages', icon: Wrench },
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
              {moreMenu[0].items.map(link => (
                <Link
                  key={link.label}
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
                  <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600">
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

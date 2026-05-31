// @ts-nocheck
import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Car,
  LayoutDashboard,
  Gauge,
  Wrench,
  Shield,
  FileText,
  Heart,
  MessageSquare,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Users,
  BarChart3,
  Tag,
  ClipboardList,
  BookOpen,
  AlertTriangle,
  Building2,
  Search,
  CheckCircle,
  ShieldAlert,
  Brain,
  UserCog,
  Store,
  MapPin
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useApp } from '@/App'
import { useAuth } from '@/context/AuthContext'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: string | number
}

const roleNavItems: Record<string, NavItem[]> = {
  owner: [
    { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { label: 'My Garage', href: '/dashboard/garage', icon: Car },
    { label: 'Service History', href: '/dashboard/service-history', icon: Wrench },
    { label: 'Insurance', href: '/dashboard/insurance', icon: Shield },
    { label: 'PartSentry', href: '/dashboard/partsentry', icon: Gauge },
    { label: 'My Listings', href: '/dashboard/listings', icon: Tag },
    { label: 'Saved Cars', href: '/dashboard/saved', icon: Heart },
    { label: 'Gutu AI', href: '/dashboard/ai', icon: MessageSquare, badge: 'AI' },
  ],
  dealer: [
    { label: 'Overview', href: '/dealer', icon: LayoutDashboard },
    { label: 'Inventory', href: '/dealer/inventory', icon: Car },
    { label: 'Leads', href: '/dealer/leads', icon: Users, badge: 12 },
    { label: 'Promotions', href: '/dealer/promotions', icon: Tag },
    { label: 'Analytics', href: '/dealer/analytics', icon: BarChart3 },
  ],
  mechanic: [
    { label: 'Overview', href: '/mechanic', icon: LayoutDashboard },
    { label: 'Work Orders', href: '/mechanic/work-orders', icon: ClipboardList, badge: 8 },
    { label: 'Service Logs', href: '/mechanic/service-logs', icon: BookOpen },
    { label: 'Parts Tracking', href: '/mechanic/parts', icon: Gauge },
    { label: 'Customers', href: '/mechanic/customers', icon: Users },
  ],
  insurance: [
    { label: 'Overview', href: '/insurance-dash', icon: LayoutDashboard },
    { label: 'Claims', href: '/insurance-dash/claims', icon: FileText, badge: 12 },
    { label: 'Risk Analysis', href: '/insurance-dash/risk', icon: BarChart3 },
    { label: 'Fraud Alerts', href: '/insurance-dash/fraud', icon: AlertTriangle, badge: 3 },
  ],
  government: [
    { label: 'Overview', href: '/government', icon: LayoutDashboard },
    { label: 'Registry Verification', href: '/government/registry', icon: Search },
    { label: 'Compliance', href: '/government/compliance', icon: CheckCircle },
  ],
  admin: [
    { label: 'Overview', href: '/admin', icon: LayoutDashboard },
    { label: 'Users', href: '/admin/users', icon: UserCog },
    { label: 'AI Monitoring', href: '/admin/ai', icon: Brain },
    { label: 'Moderation', href: '/admin/moderation', icon: ShieldAlert },
  ],
  bank: [
    { label: 'Overview', href: '/bank', icon: LayoutDashboard },
    { label: 'Lending Queue', href: '/bank/applications', icon: ClipboardList, badge: 2 },
    { label: 'Collateral Map', href: '/bank/collateral', icon: MapPin },
    { label: 'Credit Risk Analysis', href: '/bank/risk', icon: BarChart3 },
  ],
}

const roleLabels: Record<string, { title: string; color: string }> = {
  owner: { title: 'Car Owner', color: 'bg-blue-500' },
  dealer: { title: 'Dealer', color: 'bg-purple-500' },
  mechanic: { title: 'Mechanic', color: 'bg-emerald-500' },
  insurance: { title: 'Insurance', color: 'bg-rose-500' },
  government: { title: 'Government', color: 'bg-amber-500' },
  admin: { title: 'Administrator', color: 'bg-red-500' },
  bank: { title: 'Banker', color: 'bg-indigo-600' },
}

export default function DashboardLayout({ role }: { role: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole } = useAuth()

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as any)
      
      const routes: Record<string, string> = {
        owner: '/dashboard',
        dealer: '/dealer',
        mechanic: '/mechanic',
        insurance: '/insurance-dash',
        government: '/government',
        admin: '/admin',
        bank: '/bank'
      }
      navigate(routes[newRole] || '/dashboard')
    } catch (err) {
      console.error('Failed to switch stakeholder role:', err)
    }
  }

  const navItems = roleNavItems[role] || []
  const roleInfo = roleLabels[role] || { title: 'Dashboard', color: 'bg-gray-500' }

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
          >
            <X className="w-5 h-5" />
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
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${roleInfo.color}`} />
                <select
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  className="text-xs text-gray-500 bg-transparent border-none p-0 focus:ring-0 cursor-pointer font-medium hover:text-gray-900 transition-colors"
                >
                  <option value="owner">Car Owner</option>
                  <option value="dealer">Dealer</option>
                  <option value="mechanic">Mechanic</option>
                  <option value="insurance">Insurance</option>
                  <option value="government">Government</option>
                  <option value="admin">Administrator</option>
                  <option value="bank">Bank Partner</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <item.icon className={`w-4.5 h-4.5 ${isActive ? 'text-orange-500' : 'text-gray-400'}`} />
                <span className="flex-1">{item.label}</span>
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
            <Settings className="w-4.5 h-4.5 text-gray-400" />
            Settings
          </Link>
          <Link
            to="/"
            onClick={() => {
              localStorage.clear()
              window.location.href = '/'
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="w-4.5 h-4.5" />
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
          >
            <Menu className="w-5 h-5" />
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

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
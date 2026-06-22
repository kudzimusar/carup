import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate, Navigate } from 'react-router-dom'
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
  Users,
  BarChart3,
  Tag,
  ClipboardList,
  BookOpen,
  AlertTriangle,
  Search,
  CheckCircle,
  ShieldAlert,
  Brain,
  UserCog,
  Store,
  MapPin,
  Building2,
  CreditCard
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import {
  getDashboardItems,
  getDashboardRoute,
  getRoleMetadata,
  getAllRoles,
  canRoleAccessRoute,
  type LucideIconName,
  type FeatureRegistryItem,
} from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

/** Maps LucideIconName strings from the registry to actual icon components */
const ICON_MAP: Record<LucideIconName, React.ElementType> = {
  LayoutDashboard,
  Car,
  FileText,
  Wrench,
  Shield,
  Gauge,
  ClipboardList,
  Tag,
  Heart,
  MessageSquare,
  Users,
  BarChart3,
  BookOpen,
  AlertTriangle,
  Search,
  CheckCircle,
  ShieldAlert,
  Brain,
  UserCog,
  MapPin,
  Building2,
  Settings,
  CreditCard,
}

/** Resolves a FeatureRegistryItem to its icon component */
function resolveIcon(item: FeatureRegistryItem): React.ElementType {
  return ICON_MAP[item.icon] || FileText
}

export default function DashboardLayout({ role }: { role: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, switchRole } = useAuth()

  const handleRoleChange = async (newRole: string) => {
    try {
      await switchRole(newRole as Parameters<typeof switchRole>[0])
      navigate(getDashboardRoute(newRole as UserRole))
    } catch (err) {
      console.error('Failed to switch stakeholder role:', err)
    }
  }

  const registryItems = getDashboardItems(role as UserRole)
  const roleInfo = getRoleMetadata(role as UserRole)

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Centralized route guard: verify that the user's current role matches the dashboard layout and has access to this route
  if (user.role !== role || !canRoleAccessRoute(user.role as UserRole, location.pathname)) {
    return <Navigate to={getDashboardRoute(user.role as UserRole)} replace />
  }

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
                  {getAllRoles().map((r) => (
                    <option key={r} value={r}>{getRoleMetadata(r).title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {registryItems.map((item) => {
            const isActive = location.pathname === item.route
            const navIdMap: Record<string, string> = {
              'Overview': 'nav-dashboard',
              'My Garage': 'nav-garage',
              'Inventory': 'nav-inventory',
              'Claims': 'nav-claims',
              'Work Orders': 'nav-workorders',
              'Registry Verification': 'nav-registry',
              'Import Orders': 'nav-diaspora-imports',
              'Start Import Order': 'nav-diaspora-new-import',
              'Diaspora Compliance': 'nav-diaspora-compliance',
              'Workbook Console': 'diaspora-workbook-console-nav-link',
            }
            const IconComponent = resolveIcon(item)
            return (
              <Link
                key={item.id}
                to={item.route}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                data-testid={navIdMap[item.label]}
              >
                <IconComponent className={`w-4.5 h-4.5 ${isActive ? 'text-orange-500' : 'text-gray-400'}`} />
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
            data-testid="logout-button"
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

/**
 * Centralized icon resolver for the Feature Registry & Navigation manifest.
 *
 * Every `LucideIconName` declared in featureRegistry.ts is mapped here exactly
 * once. `ICON_MAP` is typed `Record<LucideIconName, ...>` so TypeScript fails
 * the build if the union and the map ever drift. Navigation surfaces (Navbar
 * mobile drawer, Footer, DashboardLayout, mega-menus) resolve icons through
 * {@link resolveFeatureIcon} instead of importing lucide-react ad hoc.
 */
import {
  LayoutDashboard,
  Car,
  FileSearch,
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
  ShieldCheck,
  ShoppingCart,
  Package,
  Phone,
  Mail,
  DollarSign,
  Globe,
  Newspaper,
  HelpCircle,
  Info,
  Sparkles,
  Store,
  ScrollText,
  Lock,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideIconName } from './featureRegistry'

type IconComponent = ComponentType<{ className?: string; size?: number | string }>

/** Exhaustive map of registry icon names → lucide components. */
export const ICON_MAP: Record<LucideIconName, IconComponent> = {
  LayoutDashboard,
  Car,
  FileSearch,
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
  ShieldCheck,
  ShoppingCart,
  Package,
  Phone,
  Mail,
  DollarSign,
  Globe,
  Newspaper,
  HelpCircle,
  Info,
  Sparkles,
  Store,
  ScrollText,
  Lock,
}

/** Resolve an icon name to a component, falling back to FileText. */
export function resolveFeatureIcon(name?: LucideIconName | string | null): IconComponent {
  if (name && name in ICON_MAP) return ICON_MAP[name as LucideIconName]
  return FileText
}

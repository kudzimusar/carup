/**
 * CarUp Feature Registry — Centralized Navigation & Feature Discovery
 *
 * This module defines every discoverable product feature in the CarUp platform
 * exactly once. Navigation components (Navbar, DashboardLayout, mobile sidebar)
 * consume these registrations via selector helpers instead of maintaining their
 * own duplicate route/label/icon arrays.
 *
 * HOW TO ADD A NEW FEATURE:
 * 1. Add a FeatureRegistryItem to the FEATURE_REGISTRY array below.
 * 2. The feature will automatically appear in the correct sidebar/nav based on
 *    its `roles` and `placements` fields.
 * 3. Update the docs: docs/CARUP_FEATURE_REGISTRY_AND_NAVIGATION_MAP.md
 */

import type { UserRole } from '@shared/types'

// ── Domain taxonomy ────────────────────────────────────────────────────────
export type FeatureDomain =
  | 'commerce'
  | 'trust'
  | 'evidence'
  | 'safepay'
  | 'parts'
  | 'service'
  | 'insurance'
  | 'government'
  | 'diaspora'
  | 'admin'
  | 'finance'
  | 'info'

// ── Placement — where a feature appears in the UI ──────────────────────────
export type NavPlacement =
  | 'dashboard_sidebar'
  | 'header'
  | 'footer'
  | 'mobile_nav'
  | 'user_menu'

// ── Icon names — typed as lucide-react component names ─────────────────────
export type LucideIconName =
  | 'LayoutDashboard'
  | 'Car'
  | 'FileText'
  | 'Wrench'
  | 'Shield'
  | 'Gauge'
  | 'ClipboardList'
  | 'Tag'
  | 'Heart'
  | 'MessageSquare'
  | 'Users'
  | 'BarChart3'
  | 'BookOpen'
  | 'AlertTriangle'
  | 'Search'
  | 'CheckCircle'
  | 'ShieldAlert'
  | 'Brain'
  | 'UserCog'
  | 'MapPin'

// ── Core registry item ─────────────────────────────────────────────────────
export interface FeatureRegistryItem {
  /** Unique identifier, e.g. 'owner.garage' */
  id: string
  /** Display label in navigation */
  label: string
  /** Route path */
  route: string
  /** Product domain this feature belongs to */
  domain: FeatureDomain
  /** Which roles can access this feature */
  roles: UserRole[]
  /** Where this feature appears in the UI */
  placements: NavPlacement[]
  /** Whether authentication is required */
  requiresAuth: boolean
  /** Lucide icon component name */
  icon: LucideIconName
  /** Optional badge text or count */
  badge?: string | number
  /** Tooltip / accessibility description */
  description?: string
}

// ── Role metadata ──────────────────────────────────────────────────────────
export interface RoleMetadata {
  title: string
  color: string
  dashboardRoute: string
}

export const ROLE_METADATA: Record<UserRole, RoleMetadata> = {
  owner:      { title: 'Car Owner',      color: 'bg-blue-500',    dashboardRoute: '/dashboard' },
  dealer:     { title: 'Dealer',         color: 'bg-purple-500',  dashboardRoute: '/dealer' },
  mechanic:   { title: 'Mechanic',       color: 'bg-emerald-500', dashboardRoute: '/mechanic' },
  insurance:  { title: 'Insurance',      color: 'bg-rose-500',    dashboardRoute: '/insurance-dash' },
  government: { title: 'Government',     color: 'bg-amber-500',   dashboardRoute: '/government' },
  admin:      { title: 'Administrator',  color: 'bg-red-500',     dashboardRoute: '/admin' },
  bank:       { title: 'Banker',         color: 'bg-indigo-600',  dashboardRoute: '/bank' },
}

// ── The Registry ───────────────────────────────────────────────────────────
export const FEATURE_REGISTRY: FeatureRegistryItem[] = [
  // ─── Owner Dashboard ───────────────────────────────────────────────────
  {
    id: 'owner.overview',
    label: 'Overview',
    route: '/dashboard',
    domain: 'commerce',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'owner.garage',
    label: 'My Garage',
    route: '/dashboard/garage',
    domain: 'commerce',
    roles: ['owner'],
    placements: ['dashboard_sidebar', 'user_menu'],
    requiresAuth: true,
    icon: 'Car',
  },
  {
    id: 'owner.evidence-vault',
    label: 'Evidence Vault',
    route: '/dashboard/garage',
    domain: 'evidence',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
    badge: 'Upload',
    description: 'Upload and manage vehicle evidence photos and documents',
  },
  {
    id: 'owner.service-history',
    label: 'Service History',
    route: '/dashboard/service-history',
    domain: 'service',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Wrench',
  },
  {
    id: 'owner.insurance',
    label: 'Insurance',
    route: '/dashboard/insurance',
    domain: 'insurance',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Shield',
  },
  {
    id: 'owner.partsentry',
    label: 'PartSentry',
    route: '/dashboard/partsentry',
    domain: 'parts',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Gauge',
  },
  {
    id: 'owner.import-orders',
    label: 'Import Orders',
    route: '/diaspora/imports',
    domain: 'diaspora',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
  },
  {
    id: 'owner.start-import',
    label: 'Start Import Order',
    route: '/diaspora/imports/new',
    domain: 'diaspora',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ClipboardList',
  },
  {
    id: 'owner.listings',
    label: 'My Listings',
    route: '/dashboard/listings',
    domain: 'safepay',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
  },
  {
    id: 'owner.saved',
    label: 'Saved Cars',
    route: '/dashboard/saved',
    domain: 'commerce',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Heart',
  },
  {
    id: 'owner.ai',
    label: 'Gutu AI',
    route: '/dashboard/ai',
    domain: 'commerce',
    roles: ['owner'],
    placements: ['dashboard_sidebar', 'user_menu'],
    requiresAuth: true,
    icon: 'MessageSquare',
    badge: 'AI',
    description: 'AI-powered vehicle assistant',
  },

  // ─── Dealer Dashboard ──────────────────────────────────────────────────
  {
    id: 'dealer.overview',
    label: 'Overview',
    route: '/dealer',
    domain: 'commerce',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'dealer.inventory',
    label: 'Inventory',
    route: '/dealer/inventory',
    domain: 'commerce',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Car',
  },
  {
    id: 'dealer.leads',
    label: 'Leads',
    route: '/dealer/leads',
    domain: 'commerce',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Users',
    badge: 12,
  },
  {
    id: 'dealer.promotions',
    label: 'Promotions',
    route: '/dealer/promotions',
    domain: 'commerce',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
  },
  {
    id: 'dealer.analytics',
    label: 'Analytics',
    route: '/dealer/analytics',
    domain: 'commerce',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'BarChart3',
  },
  {
    id: 'dealer.evidence',
    label: 'Evidence Review',
    route: '/dealer/evidence',
    domain: 'evidence',
    roles: ['dealer'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
  },

  // ─── Mechanic Dashboard ────────────────────────────────────────────────
  {
    id: 'mechanic.overview',
    label: 'Overview',
    route: '/mechanic',
    domain: 'service',
    roles: ['mechanic'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'mechanic.work-orders',
    label: 'Work Orders',
    route: '/mechanic/work-orders',
    domain: 'service',
    roles: ['mechanic'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ClipboardList',
    badge: 8,
  },
  {
    id: 'mechanic.service-logs',
    label: 'Service Logs',
    route: '/mechanic/service-logs',
    domain: 'service',
    roles: ['mechanic'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'BookOpen',
  },
  {
    id: 'mechanic.parts',
    label: 'Parts Tracking',
    route: '/mechanic/parts',
    domain: 'parts',
    roles: ['mechanic'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Gauge',
  },
  {
    id: 'mechanic.customers',
    label: 'Customers',
    route: '/mechanic/customers',
    domain: 'service',
    roles: ['mechanic'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Users',
  },

  // ─── Insurance Dashboard ───────────────────────────────────────────────
  {
    id: 'insurance.overview',
    label: 'Overview',
    route: '/insurance-dash',
    domain: 'insurance',
    roles: ['insurance'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'insurance.claims',
    label: 'Claims',
    route: '/insurance-dash/claims',
    domain: 'insurance',
    roles: ['insurance'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
    badge: 12,
  },
  {
    id: 'insurance.risk',
    label: 'Risk Analysis',
    route: '/insurance-dash/risk',
    domain: 'insurance',
    roles: ['insurance'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'BarChart3',
  },
  {
    id: 'insurance.fraud',
    label: 'Fraud Alerts',
    route: '/insurance-dash/fraud',
    domain: 'insurance',
    roles: ['insurance'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'AlertTriangle',
    badge: 3,
  },

  // ─── Government Dashboard ──────────────────────────────────────────────
  {
    id: 'government.overview',
    label: 'Overview',
    route: '/government',
    domain: 'government',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'government.registry',
    label: 'Registry Verification',
    route: '/government/registry',
    domain: 'government',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Search',
  },
  {
    id: 'government.compliance',
    label: 'Compliance',
    route: '/government/compliance',
    domain: 'government',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'CheckCircle',
  },
  {
    id: 'government.diaspora-compliance',
    label: 'Diaspora Compliance',
    route: '/admin/diaspora/compliance',
    domain: 'diaspora',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
  },
  {
    id: 'government.evidence',
    label: 'Evidence Review',
    route: '/government/evidence',
    domain: 'evidence',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
  },
  {
    id: 'government.trust-review',
    label: 'Trust Review',
    route: '/government/trust-review',
    domain: 'trust',
    roles: ['government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
  },

  // ─── Admin Dashboard ───────────────────────────────────────────────────
  {
    id: 'admin.overview',
    label: 'Overview',
    route: '/admin',
    domain: 'admin',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'admin.users',
    label: 'Users',
    route: '/admin/users',
    domain: 'admin',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'UserCog',
  },
  {
    id: 'admin.ai',
    label: 'AI Monitoring',
    route: '/admin/ai',
    domain: 'admin',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Brain',
  },
  {
    id: 'admin.moderation',
    label: 'Moderation',
    route: '/admin/moderation',
    domain: 'admin',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
  },
  {
    id: 'admin.evidence',
    label: 'Evidence Review',
    route: '/admin/evidence',
    domain: 'evidence',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'FileText',
  },
  {
    id: 'admin.trust-review',
    label: 'Trust Review',
    route: '/admin/trust-review',
    domain: 'trust',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'CheckCircle',
  },
  {
    id: 'admin.diaspora-compliance',
    label: 'Diaspora Compliance',
    route: '/admin/diaspora/compliance',
    domain: 'diaspora',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
  },

  // ─── Bank Dashboard ────────────────────────────────────────────────────
  {
    id: 'bank.overview',
    label: 'Overview',
    route: '/bank',
    domain: 'finance',
    roles: ['bank'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'LayoutDashboard',
  },
  {
    id: 'bank.applications',
    label: 'Lending Queue',
    route: '/bank/applications',
    domain: 'finance',
    roles: ['bank'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ClipboardList',
    badge: 2,
  },
  {
    id: 'bank.collateral',
    label: 'Collateral Map',
    route: '/bank/collateral',
    domain: 'finance',
    roles: ['bank'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'MapPin',
  },
  {
    id: 'bank.risk',
    label: 'Credit Risk Analysis',
    route: '/bank/risk',
    domain: 'finance',
    roles: ['bank'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'BarChart3',
  },
]

// ── Selector helpers ───────────────────────────────────────────────────────

/** Get all features accessible to a given role */
export function getFeaturesByRole(role: UserRole): FeatureRegistryItem[] {
  return FEATURE_REGISTRY.filter(f => f.roles.includes(role))
}

/** Get all features placed in a specific UI area */
export function getFeaturesByPlacement(placement: NavPlacement): FeatureRegistryItem[] {
  return FEATURE_REGISTRY.filter(f => f.placements.includes(placement))
}

/** Get all features belonging to a domain */
export function getFeaturesByDomain(domain: FeatureDomain): FeatureRegistryItem[] {
  return FEATURE_REGISTRY.filter(f => f.domain === domain)
}

/** Get sidebar nav items for a role's dashboard — preserves original order */
export function getDashboardItems(role: UserRole): FeatureRegistryItem[] {
  return FEATURE_REGISTRY.filter(
    f => f.roles.includes(role) && f.placements.includes('dashboard_sidebar')
  )
}

/** Check if a role can access a specific feature by id */
export function canAccessFeature(featureId: string, role: UserRole): boolean {
  const feature = FEATURE_REGISTRY.find(f => f.id === featureId)
  return feature ? feature.roles.includes(role) : false
}

/** Get the dashboard root route for a role */
export function getDashboardRoute(role: UserRole): string {
  return ROLE_METADATA[role]?.dashboardRoute ?? '/dashboard'
}

/** Get role display metadata */
export function getRoleMetadata(role: UserRole): RoleMetadata {
  return ROLE_METADATA[role] ?? { title: 'Dashboard', color: 'bg-gray-500', dashboardRoute: '/dashboard' }
}

/** Get all registered roles */
export function getAllRoles(): UserRole[] {
  return Object.keys(ROLE_METADATA) as UserRole[]
}

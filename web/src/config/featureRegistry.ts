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

// ── Phase 8 feature flag ────────────────────────────────────────────────────
// Diaspora Subscription UI is OFF by default (fail closed). When OFF the nav entry is hidden
// (isHidden) AND the page renders an explicit unavailable state; the App.tsx route always exists so
// the feature works the moment the flag is turned ON. Distinct from the backend enforcement flag
// (DIASPORA_SUBSCRIPTION_ENFORCEMENT) and from any billing-live switch.
// Optional-chain `import.meta.env`: in the browser/Vite + Vitest it is defined; in the Playwright
// Node test runner (which imports this registry transitively) `import.meta.env` is undefined, so we
// must default to OFF (fail closed) instead of throwing at module-eval.
const SUBSCRIPTION_UI_ENABLED = import.meta.env?.VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED === 'true'

// ── Phase 9 feature flag ────────────────────────────────────────────────────
// Diaspora SafeTrade UI is OFF by default (fail closed). When OFF the nav entry is hidden (isHidden)
// AND the page renders an explicit unavailable state; the App.tsx routes always exist so the feature
// works the moment the flag is turned ON. Distinct from the backend master gate
// (DIASPORA_SAFETRADE_ENABLED) and the live-payment switch (DIASPORA_SAFETRADE_LIVE_PAYMENT) — it
// NEVER enables real money movement (SafeTrade is sandbox payment-state simulation only). Same
// optional-chain rationale as SUBSCRIPTION_UI_ENABLED (Playwright Node runner has no import.meta.env).
const SAFETRADE_UI_ENABLED = import.meta.env?.VITE_DIASPORA_SAFETRADE_UI_ENABLED === 'true'

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
  | 'referral'
  | 'info'

// ── Placement — where a feature appears in the UI (legacy coarse model) ────
export type NavPlacement =
  | 'dashboard_sidebar'
  | 'header'
  | 'footer'
  | 'mobile_nav'
  | 'user_menu'

// ── Feature lifecycle state ────────────────────────────────────────────────
/**
 * Truthful lifecycle of a feature. Supersedes the primitive `isPlanned` /
 * `isHidden` booleans (which are still honoured for backward compatibility via
 * {@link getStaticLifecycle}).
 *
 * Nav-visibility and direct-access semantics:
 *   active     → shown in nav · directly accessible
 *   beta       → shown in nav with beta notice · directly accessible
 *   planned    → NOT shown as active · direct access renders a "planned" page
 *   hidden     → absent from nav · directly accessible if role-eligible (unadvertised)
 *   disabled   → absent from nav · direct access renders an "unavailable" page
 *   deprecated → not promoted · direct access renders a notice or redirects to `deprecatedTo`
 */
export type FeatureLifecycleState =
  | 'active'
  | 'beta'
  | 'planned'
  | 'hidden'
  | 'disabled'
  | 'deprecated'

export const FEATURE_LIFECYCLE_STATES: FeatureLifecycleState[] = [
  'active',
  'beta',
  'planned',
  'hidden',
  'disabled',
  'deprecated',
]

// ── Navigation surfaces (fine-grained placement model) ─────────────────────
/**
 * Every concrete navigation region the registry can drive. Used by the
 * NAVIGATION manifest (see navigationManifest.ts) rather than stuffing
 * deep-links into FEATURE_REGISTRY (which would break the "no duplicate active
 * route" invariant, since many mega-menu links share /marketplace).
 */
export type NavigationSurface =
  | 'navbar-direct'
  | 'navbar-mega-buy'
  | 'navbar-mega-sell'
  | 'navbar-mega-verify'
  | 'navbar-mega-parts'
  | 'navbar-mega-services'
  | 'navbar-more'
  | 'footer-product'
  | 'footer-company'
  | 'footer-resources'
  | 'footer-stakeholders'
  | 'footer-legal'
  | 'footer-social'
  | 'dashboard-sidebar'
  | 'user-menu'
  | 'mobile-primary'
  | 'mobile-secondary'
  | 'mobile-account'

/**
 * Context used to resolve effective visibility/href for a navigation item or
 * route boundary. Only carries what selectors actually need; all fields
 * optional so server/static rendering can pass a partial context safely.
 */
export interface NavigationContext {
  /** Whether a user is authenticated */
  isAuthenticated?: boolean
  /** Authenticated role, if any */
  role?: UserRole | null
  /** Tenant id, when multi-tenant scoping applies */
  tenantId?: string | null
  /** Deployment environment */
  environment?: 'development' | 'staging' | 'production' | string
  /** Effective lifecycle overrides keyed by feature id (from backend governance) */
  effectiveStates?: Record<string, EffectiveFeatureState>
  /** Marketplace coverage response (coverage-gated nodes consult this) */
  coverage?: MarketplaceCoverageResponse | null
  /** Current time (only needed when time-windowed overrides are active) */
  now?: number
}

/** Minimal shape of the Marketplace coverage response consumed by nav. */
export interface MarketplaceCoverageResponse {
  threshold?: number
  categories?: Record<string, { count?: number; active?: boolean }>
  tags?: Record<string, { count?: number; active?: boolean }>
}

/**
 * Effective state for a feature after overlaying a backend rollout override on
 * the static default. Mirror of the backend evaluator output (sanitized — no
 * internal admin notes). See backend/services/featureGovernance.
 */
export interface EffectiveFeatureState {
  featureId: string
  state: FeatureLifecycleState
  enabled: boolean
  visible: boolean
  accessible: boolean
  beta: boolean
  reasonCode?: string
  deprecatedTo?: string
  betaMessage?: string
  /**
   * Current percentage rollout for this feature (admin/unsanitized view only —
   * the public sanitized payload stays subject-free; a bucketed-out subject is
   * already reflected via visible/accessible=false). Optional & additive.
   */
  rolloutPercentage?: number
}

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
  | 'Building2'
  | 'Settings'
  | 'CreditCard'
  | 'ShieldCheck'
  | 'ShoppingCart'
  | 'Package'
  | 'Phone'
  | 'Mail'
  | 'DollarSign'
  | 'Globe'
  | 'Newspaper'
  | 'HelpCircle'
  | 'Info'
  | 'Sparkles'
  | 'Store'
  | 'ScrollText'
  | 'Lock'

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
  /** Whether the route is planned/mocked but not yet implemented in App.tsx */
  isPlanned?: boolean
  /** Whether the route is hidden from standard route-mirroring assertions */
  isHidden?: boolean
  /**
   * Truthful lifecycle state. When omitted it is derived from the legacy
   * `isPlanned` / `isHidden` booleans via {@link getStaticLifecycle}. Setting
   * this is preferred for new features and for beta/disabled/deprecated states
   * that the booleans cannot express.
   */
  lifecycle?: FeatureLifecycleState
  /** Immutable upper bound on roles a runtime override may grant (defaults to `roles`). */
  immutableRoles?: UserRole[]
  /** Owning team, for governance attribution. */
  owner?: string
  /** When deprecated, the route a deprecation redirect should target. */
  deprecatedTo?: string
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
    // `isHidden` here means "exclude from duplicate-route validation" (it shares
    // /dashboard/garage with owner.garage) — NOT "hide from navigation". It is a
    // legitimately VISIBLE sidebar entry, so its lifecycle is explicitly active
    // (explicit lifecycle wins over the legacy boolean in getStaticLifecycle).
    lifecycle: 'active',
    isHidden: true,
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
  {
    id: 'owner.referrals',
    label: 'Refer & Earn',
    route: '/dashboard/referrals',
    domain: 'referral',
    roles: ['owner'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
    description: 'Your referral benefits, sharing, and disputes',
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
    id: 'admin.features',
    label: 'Feature Governance',
    route: '/admin/features',
    domain: 'admin',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
    description: 'Inspect the Feature Registry and manage runtime rollout overrides',
    owner: 'platform',
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
    id: 'admin.referrals',
    label: 'Referral Campaigns',
    route: '/admin/referrals',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
    description: 'Create and manage referral campaigns',
  },
  {
    id: 'admin.referral-codes',
    label: 'Codes & Coupons',
    route: '/admin/referrals/codes',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
    description: 'Codes, coupons, and share assets',
  },
  {
    id: 'admin.referral-local-leads',
    label: 'Local Leads',
    route: '/admin/referrals/local-leads',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Users',
    description: 'Local marketplace referral leads',
  },
  {
    id: 'admin.referral-import-routes',
    label: 'Import Routes',
    route: '/admin/referrals/import-routes',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'MapPin',
    description: 'Import routes, capacity, and container-space',
  },
  {
    id: 'admin.referral-marketing',
    label: 'Referral Marketing',
    route: '/admin/referrals/marketing',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'BookOpen',
    description: 'AI marketing assets, review and publish workflow',
  },
  {
    id: 'admin.referral-trust',
    label: 'Referral Trust',
    route: '/admin/referrals/trust',
    domain: 'referral',
    roles: ['admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
    description: 'Risk checks, review cases, disputes, and audit',
  },
  {
    id: 'diaspora.compliance',
    label: 'Diaspora Compliance',
    route: '/admin/diaspora/compliance',
    domain: 'diaspora',
    roles: ['admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldAlert',
  },
  {
    id: 'diaspora.workbook-operator-console',
    label: 'Workbook Console',
    route: '/admin/diaspora/workbooks',
    domain: 'diaspora',
    roles: ['admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ClipboardList',
  },
  {
    id: 'diaspora.workbook-dry-run',
    label: 'New Dry Run',
    route: '/admin/diaspora/workbooks/new',
    domain: 'diaspora',
    roles: ['admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ClipboardList',
  },
  {
    id: 'diaspora.stock-manager',
    label: 'Stock Manager',
    route: '/diaspora/stock',
    domain: 'diaspora',
    roles: ['dealer', 'admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Tag',
  },
  {
    id: 'diaspora.reverse-rfq',
    label: 'Reverse RFQ',
    route: '/diaspora/rfq',
    domain: 'diaspora',
    roles: ['owner', 'dealer', 'admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'MessageSquare',
  },
  {
    id: 'diaspora.ai-command-center',
    label: 'AI Command Center',
    route: '/diaspora/ai-commands',
    domain: 'diaspora',
    roles: ['dealer', 'admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Brain',
  },
  {
    id: 'diaspora.container-marketplace',
    label: 'Container Co-Loading',
    route: '/diaspora/containers',
    domain: 'diaspora',
    roles: ['owner', 'dealer', 'admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Gauge',
  },
  {
    id: 'diaspora.drive-connections',
    label: 'Drive Connections',
    route: '/diaspora/drive',
    domain: 'diaspora',
    roles: ['owner', 'dealer', 'admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'Building2',
  },
  {
    id: 'diaspora.subscription',
    label: 'Subscription',
    route: '/diaspora/subscription',
    domain: 'diaspora',
    roles: ['owner', 'dealer', 'admin'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'CreditCard',
    description: 'Diaspora plan, entitlements, usage and sandbox billing',
    // Flag OFF (default) hides the nav entry AND keeps route-validation green (activeFeatures filters
    // out isHidden). The /diaspora/subscription route in App.tsx always exists, so flipping the flag ON
    // (isHidden:false) surfaces the entry without adding a duplicate route.
    isHidden: !SUBSCRIPTION_UI_ENABLED,
  },
  {
    id: 'diaspora.safetrade',
    label: 'SafeTrade',
    route: '/diaspora/safetrade',
    domain: 'diaspora',
    roles: ['owner', 'dealer', 'admin', 'government'],
    placements: ['dashboard_sidebar'],
    requiresAuth: true,
    icon: 'ShieldCheck',
    description: 'SafeTrade assurance coordination + sandbox payment-state simulation (non-custodial)',
    // Flag OFF (default) hides the nav entry AND keeps route-validation green (activeFeatures filters
    // out isHidden). The /diaspora/safetrade route in App.tsx always exists, so flipping the flag ON
    // (isHidden:false) surfaces the entry without adding a duplicate route. The /:id detail route is
    // a sub-route (not a registry entry), matching the import-detail pattern.
    isHidden: !SAFETRADE_UI_ENABLED,
  },
  {
    id: 'shared.settings',
    label: 'Settings',
    route: '/settings',
    domain: 'info',
    roles: ['owner', 'dealer', 'mechanic', 'insurance', 'government', 'admin', 'bank'],
    placements: [],
    requiresAuth: true,
    icon: 'Settings',
    isPlanned: true,
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

  // ─── Public Main Pages (Dealers, Garages are direct Header links) ─────
  {
    id: 'public.home',
    label: 'Home',
    route: '/',
    domain: 'commerce',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'LayoutDashboard',
  },
  {
    id: 'product.marketplace',
    label: 'Buy Cars',
    route: '/marketplace',
    domain: 'commerce',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Car',
  },
  {
    id: 'product.marketplace-parts',
    label: 'Parts Marketplace',
    route: '/marketplace/parts',
    domain: 'parts',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Tag',
  },
  {
    id: 'product.marketplace-services',
    label: 'Garages & Services',
    route: '/marketplace/services',
    domain: 'service',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Wrench',
  },
  {
    id: 'product.verify',
    label: 'Verify Vehicle',
    route: '/search',
    domain: 'trust',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Shield',
  },
  {
    id: 'product.dealers',
    label: 'Dealers',
    route: '/dealers',
    domain: 'commerce',
    roles: [],
    placements: ['header', 'footer'],
    requiresAuth: false,
    icon: 'Building2',
  },
  {
    id: 'product.garages',
    label: 'Garages',
    route: '/garages',
    domain: 'commerce',
    roles: [],
    placements: ['header', 'footer'],
    requiresAuth: false,
    icon: 'Wrench',
  },
  {
    id: 'product.insurance',
    label: 'Insurance',
    route: '/insurance',
    domain: 'insurance',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Shield',
  },
  {
    id: 'product.pricing',
    label: 'Pricing',
    route: '/pricing',
    domain: 'commerce',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Tag',
  },
  {
    id: 'product.diaspora',
    label: 'Diaspora Trade',
    route: '/diaspora',
    domain: 'diaspora',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'FileText',
  },

  // ─── Company Pages (Footer) ──────────────────────────────────────────
  {
    id: 'company.about',
    label: 'About CarUp',
    route: '/about',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'FileText',
  },
  {
    id: 'company.contact',
    label: 'Contact Us',
    route: '/contact',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'MessageSquare',
  },
  {
    id: 'company.careers',
    label: 'Careers',
    route: '/careers',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Users',
  },
  {
    id: 'company.press',
    label: 'Press Kit',
    route: '/press',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'FileText',
  },
  {
    id: 'company.blog',
    label: 'Blog',
    route: '/blog',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'BookOpen',
  },

  // ─── Resources Pages (Footer) ────────────────────────────────────────
  {
    id: 'resources.help',
    label: 'Help Center',
    route: '/help',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'MessageSquare',
  },
  {
    id: 'resources.trust',
    label: 'Trust & Safety',
    route: '/trust',
    domain: 'trust',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'Shield',
  },
  {
    id: 'resources.privacy',
    label: 'Privacy Policy',
    route: '/privacy',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'FileText',
  },
  {
    id: 'resources.terms',
    label: 'Terms of Service',
    route: '/terms',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'FileText',
  },
  {
    id: 'resources.api-docs',
    label: 'API Documentation',
    route: '/api-docs',
    domain: 'info',
    roles: [],
    placements: ['footer'],
    requiresAuth: false,
    icon: 'BookOpen',
  },

  // ─── Auth / Registration Flow Routes ─────────────────────────────────
  {
    id: 'auth.login',
    label: 'Sign In',
    route: '/login',
    domain: 'admin',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'Users',
  },
  {
    id: 'auth.register',
    label: 'Register',
    route: '/register',
    domain: 'admin',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'Users',
  },
  {
    id: 'auth.verify-otp',
    label: 'OTP Verification',
    route: '/verify-otp',
    domain: 'admin',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'Users',
  },
  {
    id: 'auth.kyc',
    label: 'KYC Verification',
    route: '/kyc',
    domain: 'admin',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'Users',
  },

  // ─── Sub-pages / Detail Routes (not directly in sidebars/navs) ───────
  {
    id: 'public.vehicle-detail',
    label: 'Vehicle Detail',
    route: '/marketplace/:id',
    domain: 'commerce',
    roles: [],
    placements: [],
    requiresAuth: false,
    icon: 'Car',
  },
  {
    id: 'owner.garage-detail',
    label: 'Vehicle Profile',
    route: '/dashboard/garage/:id',
    domain: 'commerce',
    roles: ['owner'],
    placements: [],
    requiresAuth: true,
    icon: 'Car',
  },
  {
    id: 'owner.sell-vehicle',
    label: 'Sell Your Car',
    route: '/dashboard/sell-vehicle',
    domain: 'commerce',
    roles: ['owner'],
    placements: [],
    requiresAuth: true,
    icon: 'Car',
  },
  {
    id: 'owner.import-detail',
    label: 'Import Order Detail',
    route: '/diaspora/imports/:id',
    domain: 'diaspora',
    roles: ['owner'],
    placements: [],
    requiresAuth: true,
    icon: 'FileText',
  },
  {
    id: 'owner.import-documents',
    label: 'Import Documents',
    route: '/diaspora/imports/:id/documents',
    domain: 'diaspora',
    roles: ['owner'],
    placements: [],
    requiresAuth: true,
    icon: 'FileText',
  },
  {
    id: 'owner.import-shipment',
    label: 'Import Shipment',
    route: '/diaspora/imports/:id/shipment',
    domain: 'diaspora',
    roles: ['owner'],
    placements: [],
    requiresAuth: true,
    icon: 'FileText',
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

/** Find a registered feature by its stable id. */
export function getFeatureById(featureId: string): FeatureRegistryItem | undefined {
  return FEATURE_REGISTRY.find(f => f.id === featureId)
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

// ── Phase 2: Public Navigation & Access Guard Selector Helpers ──────────────

/** Get public primary header navigation items */
export function getPublicNavigationItems(): FeatureRegistryItem[] {
  return FEATURE_REGISTRY.filter(
    f => f.placements.includes('header') && !f.requiresAuth
  )
}

/**
 * Direct (registry-driven) public header nav items, filtered by effective
 * visibility — so a disabled / tenant-denied / hidden override removes the
 * direct link too. Uses the shared resolveFeatureVisibility (no per-component
 * logic). Static defaults render when no effective state exists.
 */
export function getVisiblePublicNavigationItems(ctx: NavigationContext = {}): FeatureRegistryItem[] {
  return getPublicNavigationItems().filter(f => resolveFeatureVisibility(f, ctx).visible)
}

/** Get public footer items classified by category section prefix */
export function getPublicFooterItems(section: 'Product' | 'Company' | 'Resources'): FeatureRegistryItem[] {
  const prefix = section.toLowerCase() + '.'
  return FEATURE_REGISTRY.filter(
    f => f.placements.includes('footer') && f.id.startsWith(prefix)
  )
}

/** Helper to match a path against a registered route pattern, handling parameterized paths (e.g. :id) */
export function matchRoutePattern(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('?')[0].split('/').filter(Boolean)
  const pathSegments = path.split('?')[0].split('/').filter(Boolean)

  if (patternSegments.length !== pathSegments.length) return false

  return patternSegments.every((segment, i) => {
    return segment.startsWith(':') || segment === pathSegments[i]
  })
}

/** Find a registered feature by its exact or parameterized route path */
export function getFeatureByRoute(route: string): FeatureRegistryItem | undefined {
  return FEATURE_REGISTRY.find(f => matchRoutePattern(f.route, route))
}

/** Check if a route path is classified as public (requires no login) */
export function isPublicRoute(route: string): boolean {
  const feature = getFeatureByRoute(route)
  if (feature) return !feature.requiresAuth

  // Safe fallback for unregistered/transient paths (public by default unless dashboard-prefixed)
  const protectedPrefixes = [
    '/dashboard',
    '/dealer',
    '/mechanic',
    '/insurance-dash',
    '/government',
    '/bank',
    '/admin',
  ]
  return !protectedPrefixes.some(prefix => route.startsWith(prefix))
}

/** Check if a route path is classified as protected (requires login) */
export function isProtectedRoute(route: string): boolean {
  return !isPublicRoute(route)
}

/** Get all allowed roles that have access to a given route */
export function getAllowedRolesForRoute(route: string): UserRole[] {
  const feature = getFeatureByRoute(route)
  if (!feature) {
    return isPublicRoute(route) ? getAllRoles() : []
  }
  return feature.requiresAuth ? feature.roles : getAllRoles()
}

/** Check if a specific role can access a given route */
export function canRoleAccessRoute(role: UserRole, route: string): boolean {
  if (isPublicRoute(route)) return true
  const feature = getFeatureByRoute(route)
  return feature ? feature.roles.includes(role) : false
}

/** Get the default dashboard route for a role */
export function getDefaultRouteForRole(role: UserRole): string {
  return getDashboardRoute(role)
}

// ── Lifecycle & effective-state helpers ─────────────────────────────────────

/**
 * Derive the static (code-defined) lifecycle of a feature. Explicit
 * `lifecycle` wins; otherwise legacy booleans are mapped deterministically.
 * Precedence when both booleans are set: hidden > planned > active.
 */
export function getStaticLifecycle(feature: Pick<FeatureRegistryItem, 'lifecycle' | 'isHidden' | 'isPlanned'>): FeatureLifecycleState {
  if (feature.lifecycle) return feature.lifecycle
  if (feature.isHidden) return 'hidden'
  if (feature.isPlanned) return 'planned'
  return 'active'
}

/** Whether a lifecycle state should be advertised in navigation surfaces. */
export function isLifecycleVisible(state: FeatureLifecycleState): boolean {
  return state === 'active' || state === 'beta'
}

/** Whether a lifecycle state permits direct route rendering (not planned/disabled). */
export function isLifecycleAccessible(state: FeatureLifecycleState): boolean {
  return state === 'active' || state === 'beta' || state === 'hidden' || state === 'deprecated'
}

export interface ResolvedFeatureVisibility {
  featureId: string
  /** Effective lifecycle after applying any runtime override from context. */
  state: FeatureLifecycleState
  /** Whether the user/role is eligible to access this feature at all. */
  roleEligible: boolean
  /** Shown in navigation surfaces (lifecycle-visible AND role-eligible). */
  visible: boolean
  /** Direct route access permitted (lifecycle-accessible AND role-eligible). */
  accessible: boolean
  /** Render a beta notice. */
  beta: boolean
  /** Deprecation redirect target, if any. */
  deprecatedTo?: string
}

/**
 * Resolve the effective visibility/accessibility of a feature for a given
 * context. Pure and side-effect free. Runtime `effectiveStates` overrides (from
 * backend governance) take precedence over static lifecycle; role eligibility
 * is ALWAYS enforced and can never be broadened by an override here (frontend
 * visibility never grants access — backend authorization remains authoritative).
 */
export function resolveFeatureVisibility(
  feature: FeatureRegistryItem,
  ctx: NavigationContext = {},
): ResolvedFeatureVisibility {
  const override = ctx.effectiveStates?.[feature.id]
  const state = override?.state ?? getStaticLifecycle(feature)

  // Role eligibility — public features are eligible for everyone; protected
  // features require an authenticated, listed role.
  let roleEligible: boolean
  if (!feature.requiresAuth) {
    roleEligible = true
  } else if (!ctx.isAuthenticated || !ctx.role) {
    roleEligible = false
  } else {
    roleEligible = feature.roles.includes(ctx.role)
  }

  const lifecycleVisible = isLifecycleVisible(state)
  const lifecycleAccessible = isLifecycleAccessible(state)
  // A runtime override may DISABLE but never force-enable beyond static policy.
  const enabledByOverride = override ? override.enabled : true
  // Honor the backend-computed visibility/access (incorporates tenant + time
  // windows the SPA cannot recompute). The loader identity-gates these, so they
  // always reflect the CURRENT user; absent an entry they default to permissive
  // and the local lifecycle/role computation governs.
  const backendVisible = override ? override.visible !== false : true
  const backendAccessible = override ? override.accessible !== false : true

  return {
    featureId: feature.id,
    state,
    roleEligible,
    visible: lifecycleVisible && roleEligible && enabledByOverride && backendVisible,
    accessible: lifecycleAccessible && roleEligible && enabledByOverride && backendAccessible,
    beta: state === 'beta',
    deprecatedTo: override?.deprecatedTo ?? feature.deprecatedTo,
  }
}

// ── Framework-neutral governance manifest ───────────────────────────────────

/**
 * The governance-relevant projection of the registry. This is the contract the
 * backend feature-governance service consumes (via the generated JSON at
 * shared/navigation/feature-manifest.json). Keep it pure data — no React, no
 * presentation fields — so frontend and backend cannot drift silently.
 */
export interface FeatureManifestEntry {
  id: string
  domain: FeatureDomain
  route: string
  defaultLifecycle: FeatureLifecycleState
  defaultRoles: UserRole[]
  /** Immutable upper bound on roles an override may grant. */
  immutableRoles: UserRole[]
  requiresAuth: boolean
  betaCapable: boolean
  deprecatedTo?: string
}

/** Build the deterministic, sorted governance manifest from the registry. */
export function buildFeatureManifest(): FeatureManifestEntry[] {
  return FEATURE_REGISTRY
    .map((f): FeatureManifestEntry => {
      const entry: FeatureManifestEntry = {
        id: f.id,
        domain: f.domain,
        route: f.route,
        defaultLifecycle: getStaticLifecycle(f),
        defaultRoles: [...f.roles].sort(),
        immutableRoles: [...(f.immutableRoles ?? f.roles)].sort(),
        requiresAuth: f.requiresAuth,
        betaCapable: true,
      }
      if (f.deprecatedTo) entry.deprecatedTo = f.deprecatedTo
      return entry
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

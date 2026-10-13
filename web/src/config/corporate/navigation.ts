/**
 * CA-K3-01 — the canonical Corporate Admin information architecture.
 *
 * Ten top-level destinations in the binding order (CA-K3-01 §2, CA-UX-01 §6), each owned by exactly one
 * management plane (CA-K3-01 §3). This is NOT the current /admin sidebar renamed: the current /admin
 * surfaces are reached from here only as explicit cross-plane "Operate" destinations
 * (see `operateLinks`), and /admin itself is untouched.
 *
 * `navCapabilities` names the stable capabilities (CA-RBAC-01 §6, `<plane>.<domain>.<resource>.<action>`)
 * a destination will require once the Corporate permission evaluator exists. Navigation never grants
 * authority: visibility is decided only from a server-derived grant (lib/corporate/access.ts), never
 * from a job title, and every direct route is re-checked.
 */

export type CorporatePlaneId = 'corporate_intelligence' | 'business_operations' | 'platform_security'

export interface CorporatePlane {
  id: CorporatePlaneId
  label: string
  /** Short marker for the rail; always paired with the full label for assistive technology. */
  marker: string
  purpose: string
}

export const CORPORATE_PLANES: Readonly<Record<CorporatePlaneId, CorporatePlane>> = Object.freeze({
  corporate_intelligence: {
    id: 'corporate_intelligence', label: 'Corporate Intelligence', marker: 'CI',
    purpose: 'Understand, compare, explain, review and report — aggregate and analytical.',
  },
  business_operations: {
    id: 'business_operations', label: 'Business Operations', marker: 'BO',
    purpose: 'Operate, review, decide, clear backlog and resolve exceptions.',
  },
  platform_security: {
    id: 'platform_security', label: 'Platform & Security', marker: 'PS',
    purpose: 'Administer the technical platform, its runtime, integrations, AI operations and security controls.',
  },
})

export type CorporateDestinationId =
  | 'overview' | 'business-units' | 'finance' | 'growth' | 'operations'
  | 'trust-risk' | 'data-intelligence' | 'people-access' | 'reports' | 'platform'

export interface CorporateDestination {
  id: CorporateDestinationId
  /** Canonical name — the binding wording. */
  label: string
  /** Compact rail label (CA-UX-01 wireframe). */
  shortLabel: string
  route: string
  plane: CorporatePlaneId
  /** The management question the page answers (CA-UX-01 §27). */
  question: string
  purpose: string
  /** Any-of: a grant holding one of these may see the destination. */
  navCapabilities: readonly string[]
  icon: string
}

export const CORPORATE_ROOT = '/corporate'

export const CORPORATE_DESTINATIONS: readonly CorporateDestination[] = Object.freeze([
  {
    id: 'overview', label: 'Corporate Overview', shortLabel: 'Overview', route: '/corporate', plane: 'corporate_intelligence',
    question: 'What changed, what needs attention and what is unavailable?',
    purpose: 'Cross-company state, change and attention.',
    navCapabilities: ['corporate.overview.read'], icon: 'LayoutDashboard',
  },
  {
    id: 'business-units', label: 'Business Units', shortLabel: 'Business Units', route: '/corporate/business-units', plane: 'corporate_intelligence',
    question: 'Which business unit is changing and where?',
    purpose: 'Compare and inspect management units.',
    navCapabilities: ['corporate.business_unit.read'], icon: 'Building2',
  },
  {
    id: 'finance', label: 'Finance', shortLabel: 'Finance', route: '/corporate/finance', plane: 'corporate_intelligence',
    question: 'What financial facts are authoritative now, and what is blocked?',
    purpose: 'Corporate Finance & Accounting state; future P&L and treasury; finance exceptions.',
    navCapabilities: ['corporate.finance.summary.read'], icon: 'Landmark',
  },
  {
    id: 'growth', label: 'Customers & Growth', shortLabel: 'Growth', route: '/corporate/growth', plane: 'corporate_intelligence',
    question: 'Where is qualified demand forming and where do journeys progress or stop?',
    purpose: 'Demand, acquisition association, linked journeys, geography and cohorts where governed.',
    navCapabilities: ['corporate.growth.aggregate.read', 'corporate.customer.aggregate.read'], icon: 'TrendingUp',
  },
  {
    id: 'operations', label: 'Operations', shortLabel: 'Operations', route: '/corporate/operations', plane: 'business_operations',
    question: 'What is waiting, aging, blocked or failing?',
    purpose: 'Queues, throughput, backlog, cycle time and domain work.',
    navCapabilities: ['corporate.operations.queue.read', 'corporate.operations.summary.read'], icon: 'Workflow',
  },
  {
    id: 'trust-risk', label: 'Trust / Risk / Compliance', shortLabel: 'Trust / Risk', route: '/corporate/trust-risk', plane: 'business_operations',
    question: 'What risk and compliance work exists and where is it aging?',
    purpose: 'Aggregate risk posture plus restricted review queues.',
    navCapabilities: ['corporate.risk.aggregate.read'], icon: 'ShieldCheck',
  },
  {
    id: 'data-intelligence', label: 'Data & Intelligence', shortLabel: 'Data / Intel', route: '/corporate/data-intelligence', plane: 'corporate_intelligence',
    question: 'Can management trust the number, and what does it mean?',
    purpose: 'Metric registry, provenance, quality, lineage, navigation and commercial intelligence.',
    navCapabilities: ['corporate.metric.registry.read', 'corporate.data.quality.read', 'corporate.intelligence.aggregate.read'], icon: 'Database',
  },
  {
    id: 'people-access', label: 'People & Access', shortLabel: 'People', route: '/corporate/people-access', plane: 'business_operations',
    question: 'Who has what authority, where, why and until when?',
    purpose: 'Accounts, membership, permissions, scope, delegation, sessions and access reviews.',
    navCapabilities: ['corporate.people.aggregate.read', 'corporate.people.access.read'], icon: 'Users',
  },
  {
    id: 'reports', label: 'Reports', shortLabel: 'Reports', route: '/corporate/reports', plane: 'corporate_intelligence',
    question: 'Which reports are due, in review, approved or published?',
    purpose: 'Management cadence, governed report lifecycle and publication.',
    navCapabilities: ['corporate.report.read'], icon: 'FileText',
  },
  {
    id: 'platform', label: 'Platform', shortLabel: 'Platform', route: '/corporate/platform', plane: 'platform_security',
    question: 'Is the platform technically governed, available and secure?',
    purpose: 'Feature, provider, AI/model, technical communications, runtime and security administration.',
    navCapabilities: ['platform.health.read', 'platform.feature.read'], icon: 'Server',
  },
] as const satisfies readonly CorporateDestination[])

export function destinationById(id: CorporateDestinationId): CorporateDestination {
  const d = CORPORATE_DESTINATIONS.find((x) => x.id === id)
  if (!d) throw new Error(`Unknown Corporate destination: ${id}`)
  return d
}

export function destinationForPath(pathname: string): CorporateDestination | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  // Most specific first: '/corporate' is a prefix of every other destination.
  const ordered = [...CORPORATE_DESTINATIONS].sort((a, b) => b.route.length - a.route.length)
  return ordered.find((d) => clean === d.route || clean.startsWith(`${d.route}/`)) ?? null
}

/**
 * An existing operational surface reached from a Corporate page. It always names the queue it opens
 * and the plane it lands in, so a queue never reads as a drill-down of an executive chart
 * (CA-UX-01 §5.4, OD-CAUX-021). Mutation controls stay on the destination; none are copied here.
 */
export interface OperateLink {
  label: string
  route: string
  /** The plane of the destination surface. */
  plane: CorporatePlaneId
  description: string
}

/** Current /admin surfaces, by the Corporate destination that will eventually own them (CA current-state map). */
export const OPERATE_LINKS: Readonly<Record<CorporateDestinationId, readonly OperateLink[]>> = Object.freeze({
  overview: [],
  'business-units': [
    { label: 'Open Marketplace moderation queue', route: '/admin/moderation', plane: 'business_operations', description: 'Marketplace & Vehicle Commerce — listing and inquiry moderation.' },
    { label: 'Open Diaspora compliance review', route: '/admin/diaspora/compliance', plane: 'business_operations', description: 'Diaspora Trade & Logistics — trade compliance review.' },
    { label: 'Open Diaspora data-intake workbooks', route: '/admin/diaspora/workbooks', plane: 'business_operations', description: 'Diaspora Trade & Logistics — governed data intake.' },
  ],
  finance: [],
  growth: [
    { label: 'Open referral campaign operations', route: '/admin/referrals', plane: 'business_operations', description: 'Referral campaigns, codes and rewards — operational surface.' },
    { label: 'Open local lead operations', route: '/admin/referrals/local-leads', plane: 'business_operations', description: 'Local marketplace lead handling.' },
    { label: 'Open communications inbox', route: '/admin/communications', plane: 'business_operations', description: 'Customer communications operations (inbox and follow-up).' },
  ],
  operations: [
    { label: 'Open Marketplace moderation queue', route: '/admin/moderation', plane: 'business_operations', description: 'Listings awaiting moderation decisions.' },
    { label: 'Open Marketplace inquiry queue', route: '/admin/moderation?tab=inquiries', plane: 'business_operations', description: 'Buyer inquiries awaiting handling.' },
    { label: 'Open communications inbox', route: '/admin/communications', plane: 'business_operations', description: 'Customer conversations and follow-up.' },
    { label: 'Open garage application queue', route: '/admin/garage-applications', plane: 'business_operations', description: 'Service Network onboarding decisions.' },
    { label: 'Open dealer compliance queue', route: '/admin/dealer-compliance', plane: 'business_operations', description: 'Dealer compliance decisions.' },
    { label: 'Open Diaspora compliance review', route: '/admin/diaspora/compliance', plane: 'business_operations', description: 'Trade and logistics compliance.' },
  ],
  'trust-risk': [
    { label: 'Open evidence review queue', route: '/admin/evidence', plane: 'business_operations', description: 'Vehicle evidence awaiting review.' },
    { label: 'Open identity verification cases', route: '/admin/verification', plane: 'business_operations', description: 'Identity verification case management.' },
    { label: 'Open trust review queue', route: '/admin/trust-review', plane: 'business_operations', description: 'Trust fact review.' },
    { label: 'Open fraud & duplicate queue', route: '/admin/fraud-queue', plane: 'business_operations', description: 'Fraud and duplicate investigations.' },
    { label: 'Open governance review queue', route: '/admin/governance-review', plane: 'business_operations', description: 'Governance review decisions.' },
    { label: 'Open dealer compliance queue', route: '/admin/dealer-compliance', plane: 'business_operations', description: 'Dealer compliance decisions.' },
    { label: 'Open referral trust review', route: '/admin/referrals/trust', plane: 'business_operations', description: 'Referral trust and abuse review.' },
  ],
  'data-intelligence': [],
  'people-access': [
    { label: 'Open User Management (compatibility surface)', route: '/admin/users', plane: 'business_operations', description: 'Account records and the legacy platform role field. Not the Corporate membership or permission model.' },
  ],
  reports: [],
  platform: [
    { label: 'Open Feature Governance', route: '/admin/features', plane: 'platform_security', description: 'Feature rollout and registry administration.' },
    { label: 'Open AI Monitoring', route: '/admin/ai', plane: 'platform_security', description: 'AI/model and provider runtime monitoring.' },
    { label: 'Open communications delivery controls', route: '/admin/communications', plane: 'platform_security', description: 'Technical delivery, worker and provider state within the Command Center.' },
  ],
})

/**
 * RX-06 Account — pure helpers for the plan & entitlements desk (/diaspora/subscription). No React.
 *
 * Plans, entitlements and usage are rendered only from GET /plans, /status, /entitlements and /usage
 * (the backend catalogue is config-driven; nothing here hardcodes a plan, a price or a limit). Billing is
 * a sandbox: no control here may read as a live checkout, a real charge or an active payment provider.
 */
import type {
  EffectiveEntitlementsEnvelope, EntitlementDenialCategory, Plan, StructuredEntitlementDenial, SubscriptionStatus, UsageResponse,
} from '@/types'
import { humanizeFeatureKey } from '@/components/diaspora/subscription/subscriptionHelpers'

/* ── Feature keys, grouped the way a trader thinks about them ──────────────────────────────── */

const AREAS: ReadonlyArray<[string, string]> = [
  ['rfq', 'Sourcing requests'],
  ['container', 'Shared containers'],
  ['safetrade', 'SafeTrade'],
  ['stock', 'Stock'],
  ['workbook', 'Workbooks'],
  ['ai', 'AI assistant'],
  ['drive', 'Drive'],
  ['graph', 'Trade graph'],
  ['audit', 'Audit export'],
  ['api', 'API access'],
]
const AREA_LABEL = new Map(AREAS)
const AREA_RANK = new Map(AREAS.map(([key], i) => [key, i]))

export interface FeatureParts { area: string; areaLabel: string; capability: string }

/** 'diaspora.rfq.max_open' → { area: 'rfq', areaLabel: 'Sourcing requests', capability: 'Max open' }. */
export function featureParts(featureKey: string): FeatureParts {
  const m = /^diaspora\.([a-z0-9]+)\.(.+)$/i.exec(featureKey)
  if (!m) return { area: 'other', areaLabel: 'Other', capability: humanizeFeatureKey(featureKey) }
  const area = m[1].toLowerCase()
  const capability = m[2].split(/[._]/).filter(Boolean).join(' ')
  return {
    area,
    areaLabel: AREA_LABEL.get(area) ?? humanizeFeatureKey(`diaspora.${area}`),
    capability: capability.charAt(0).toUpperCase() + capability.slice(1),
  }
}

/** Feature keys grouped by area (stable order: known areas first, then the rest alphabetically). */
export function groupFeatureKeys(keys: ReadonlyArray<string>): Array<{ area: string; label: string; keys: string[] }> {
  const groups = new Map<string, { area: string; label: string; keys: string[] }>()
  for (const key of [...new Set(keys)].sort()) {
    const parts = featureParts(key)
    const g = groups.get(parts.area) ?? { area: parts.area, label: parts.areaLabel, keys: [] }
    g.keys.push(key)
    groups.set(parts.area, g)
  }
  return [...groups.values()].sort((a, b) => {
    const ra = AREA_RANK.get(a.area) ?? Number.MAX_SAFE_INTEGER
    const rb = AREA_RANK.get(b.area) ?? Number.MAX_SAFE_INTEGER
    return ra === rb ? a.label.localeCompare(b.label) : ra - rb
  })
}

/* ── Why the plan could not be read ────────────────────────────────────────────────────────── */

export type PlanFailure = 'limited' | 'tenant' | 'denied' | 'unavailable' | 'plan' | 'failed'

/**
 * The parsed denial (category) plus the raw HTTP status the page captured. A 429 is the shared request
 * limit — never "not permitted" — and a missing tenant is its own state, not a refusal.
 */
export function planFailure(denial: StructuredEntitlementDenial | null, failure: { status: number | null; message: string | null } | null): PlanFailure | null {
  if (!denial && !failure) return null
  const status = failure?.status ?? null
  const message = String(failure?.message ?? '').toLowerCase()
  if (status === 429 || /too many requests|rate limit/.test(message)) return 'limited'
  if (denial?.category === 'tenant-context-missing') return 'tenant'
  if (status === 404) return 'unavailable'
  if (status === 403) return 'denied'
  if (denial && (denial.category === 'feature-unavailable-on-plan' || denial.category === 'quota-exhausted' || denial.category === 'inactive-subscription')) return 'plan'
  return 'failed'
}

/** Safe titles per denial category (same wording as the shared EntitlementDenialPanel). */
export const DENIAL_TITLE: Record<EntitlementDenialCategory, string> = {
  'feature-unavailable-on-plan': 'Feature not in your plan',
  'quota-exhausted': 'Usage limit reached',
  'inactive-subscription': 'Subscription not active',
  'tenant-context-missing': 'No tenant selected',
  'external-activation-unavailable': 'Action temporarily unavailable',
  'ordinary-authorization-failure': 'Not permitted',
  'network-or-server-failure': 'Could not reach the service',
}

/* ── View model ────────────────────────────────────────────────────────────────────────────── */

export interface SubscriptionDeskModel {
  flagEnabled: boolean
  authLoading: boolean
  signedIn: boolean
  role: string
  isManager: boolean
  plans: Plan[]
  status: SubscriptionStatus | null
  entitlements: EffectiveEntitlementsEnvelope | null
  usage: UsageResponse | null
  usageUnreadable: boolean
  loading: boolean
  answered: boolean
  loadError: StructuredEntitlementDenial | null
  loadFailure: { status: number | null; message: string | null } | null
  onRetry: () => void
  actionDenial: StructuredEntitlementDenial | null
  outcome: string | null
  onCheckout: (planKey: string) => void | Promise<void>
  onPortal: () => void | Promise<void>
  onChangePlan: (planKey: string) => void | Promise<void>
  onCancel: (atPeriodEnd: boolean) => void | Promise<void>
}

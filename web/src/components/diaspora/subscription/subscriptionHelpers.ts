/**
 * Phase 8 — Pure helpers for the Subscription UI (no React, no DOM).
 *
 * Every catalog/quota fact is DERIVED FROM THE API RESPONSE — never hardcoded. The backend is the
 * single source of truth for plan order, entitlements and usage (see backend/constants/diaspora and
 * diasporaEntitlementService.checkQuota). These helpers only classify/format what the API returns.
 */
import type { Plan, SubscriptionStatus, UsageEntry, PlanEntitlements } from '@/types'

/** Plans in the API's authoritative order. We NEVER re-sort by name/tier; we trust sortOrder ordering
 * as delivered, only stabilizing on sortOrder when a caller hands us an unsorted list. */
export function orderedPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

/** The plan whose key matches the current subscription, or null. */
export function currentPlan(plans: Plan[], status: SubscriptionStatus | null): Plan | null {
  if (!status) return null
  return plans.find((p) => p.planKey === status.planKey) ?? null
}

export type EntitlementKind = 'unavailable' | 'included' | 'metered' | 'limited'

export interface EntitlementCell {
  featureKey: string
  /** The raw entitlement value as delivered by the API. */
  value: boolean | number
  kind: EntitlementKind
  /** A truthful, color-independent label. */
  label: string
}

const METERED_FEATURE_KEYS = new Set<string>([
  'diaspora.workbook.bulk_import',
  'diaspora.ai.execute_medium',
])

/**
 * Classify a single plan entitlement TRUTHFULLY:
 *   - boolean false / numeric 0      → unavailable on this plan
 *   - boolean true                   → included (capability)
 *   - numeric > 0 on a metered key   → metered monthly quota (N / period)
 *   - numeric > 0 otherwise          → a fixed cap/limit (N)
 * We do NOT invent "unlimited" for plan entitlements: the catalog uses finite integers and booleans,
 * so claiming unlimited would be untruthful. (Usage rows may still be unlimited when limit is null.)
 */
export function classifyEntitlement(featureKey: string, value: boolean | number): EntitlementCell {
  if (value === false || value === 0 || value === null || value === undefined) {
    return { featureKey, value: value as boolean | number, kind: 'unavailable', label: 'Not included' }
  }
  if (value === true) {
    return { featureKey, value, kind: 'included', label: 'Included' }
  }
  if (typeof value === 'number') {
    if (METERED_FEATURE_KEYS.has(featureKey)) {
      return { featureKey, value, kind: 'metered', label: `${value} / month` }
    }
    return { featureKey, value, kind: 'limited', label: `Up to ${value}` }
  }
  return { featureKey, value: value as boolean | number, kind: 'unavailable', label: 'Not included' }
}

/** All entitlement cells for a plan, in stable key order (keys come from the API entitlements map). */
export function planEntitlementCells(entitlements: PlanEntitlements): EntitlementCell[] {
  return Object.keys(entitlements)
    .sort()
    .map((key) => classifyEntitlement(key, entitlements[key]))
}

/** Turn a canonical feature key into a readable feature name (no hardcoded catalog of values). */
export function humanizeFeatureKey(featureKey: string): string {
  return featureKey
    .replace(/^diaspora\./, '')
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export interface UsageView {
  featureKey: string
  featureName: string
  used: number
  reserved: number
  /** null/absent limit means unlimited. */
  limit: number | null
  remaining: number | null
  unlimited: boolean
  available: boolean
  /** 0..100, only meaningful when not unlimited and the feature is available. */
  percentUsed: number | null
  /** Truthful, color-independent status text for screen readers and sighted users. */
  statusText: string
}

/**
 * Normalize a backend usage row into a view model. The live backend (checkQuota) emits
 * { featureKey, planKey, limit:number, used, remaining, metered, periodStart }; a limit of 0 means
 * the feature has no quota on the plan (unavailable). The API contract also allows an absent/null
 * limit to mean unlimited and an explicit available:false flag — we honor all three truthfully.
 */
export function toUsageView(entry: UsageEntry): UsageView {
  const featureName = humanizeFeatureKey(entry.featureKey)
  const used = Number(entry.used) || 0
  const reserved = Number(entry.reserved) || 0

  // Unlimited: explicit flag OR a null/undefined limit.
  const unlimited = entry.unlimited === true || entry.limit === null || entry.limit === undefined

  // Availability: explicit flag wins; otherwise a finite limit of 0 means unavailable on this plan.
  const available =
    entry.available === false
      ? false
      : unlimited
        ? true
        : Number(entry.limit) > 0

  const limit = unlimited ? null : Number(entry.limit) || 0
  const remaining =
    !available ? 0 : unlimited ? null : entry.remaining !== null && entry.remaining !== undefined ? Number(entry.remaining) : Math.max((limit ?? 0) - used, 0)

  let percentUsed: number | null = null
  if (available && !unlimited && limit && limit > 0) {
    percentUsed = Math.min(100, Math.round((used / limit) * 100))
  }

  let statusText: string
  if (!available) {
    statusText = 'Not available on your plan'
  } else if (unlimited) {
    statusText = `Unlimited — ${used} used this period`
  } else {
    statusText = `${used} of ${limit} used (${remaining ?? 0} remaining)`
  }

  return { featureKey: entry.featureKey, featureName, used, reserved, limit, remaining, unlimited, available, percentUsed, statusText }
}

/** A short, color-independent status label for a subscription status string. */
export function statusLabel(status: SubscriptionStatus | null): string {
  if (!status) return 'No subscription'
  if (status.synthetic && status.planKey === 'free') return 'Free (no paid subscription)'
  const map: Record<string, string> = {
    active: 'Active',
    trialing: 'Trialing',
    grace_period: 'Active (grace period)',
    past_due: 'Past due',
    paused: 'Paused',
    cancelled: 'Cancelled',
    expired: 'Expired',
    incomplete: 'Incomplete',
    suspended: 'Suspended',
  }
  return map[status.status] ?? status.status
}

/** Format an ISO timestamp as a stable, locale-independent UTC date (no time-of-day noise). */
export function formatPeriodDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Frontend manager-visibility heuristic (NOT a security control — the backend 403 is authoritative).
 * Mirrors the backend's "trusted subscription manager" intent: a platform admin OR a tenant admin.
 * The web user only carries a single `role`; we treat the admin-class roles as manager-eligible and
 * accept forward-compatible server role strings defensively.
 */
const MANAGER_ROLES = new Set<string>([
  'admin',
  'administrator',
  'tenant_admin',
  'platform_admin',
  'super_admin',
])

export function canManageSubscriptionUi(role: string | null | undefined): boolean {
  return MANAGER_ROLES.has(String(role || '').toLowerCase())
}

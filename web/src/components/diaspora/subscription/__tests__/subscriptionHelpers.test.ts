import { describe, it, expect } from 'vitest'
import {
  orderedPlans,
  currentPlan,
  classifyEntitlement,
  planEntitlementCells,
  humanizeFeatureKey,
  toUsageView,
  statusLabel,
  formatPeriodDate,
  canManageSubscriptionUi,
} from '../subscriptionHelpers'
import type { Plan, SubscriptionStatus, UsageEntry } from '@/types'

// Mirrors the SHAPE of GET /plans (values come from the API; the UI never hardcodes the catalog).
const PLANS: Plan[] = [
  { planKey: 'seller', name: 'Seller / Supplier', tier: 'seller', sortOrder: 20, description: 'Seller', entitlements: { 'diaspora.stock.create': true, 'diaspora.stock.max_items': 250, 'diaspora.ai.execute_medium': 25, 'diaspora.api.access': false } },
  { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Free', entitlements: { 'diaspora.workbook.download': true, 'diaspora.stock.create': false, 'diaspora.ai.execute_medium': 0 } },
  { planKey: 'trade_pro', name: 'Trade Pro', tier: 'pro', sortOrder: 30, description: 'Pro', entitlements: { 'diaspora.workbook.bulk_import': 200 } },
]

describe('orderedPlans', () => {
  it('orders by the API sortOrder (never by name/tier)', () => {
    expect(orderedPlans(PLANS).map((p) => p.planKey)).toEqual(['free', 'seller', 'trade_pro'])
  })
  it('does not mutate the input array', () => {
    const copy = [...PLANS]
    orderedPlans(PLANS)
    expect(PLANS).toEqual(copy)
  })
})

describe('currentPlan selection', () => {
  const status = (planKey: string): SubscriptionStatus => ({
    tenantId: 't1', planKey, status: 'active', synthetic: false, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, active: true,
  })
  it('selects the plan whose key matches status.planKey', () => {
    expect(currentPlan(PLANS, status('seller'))?.planKey).toBe('seller')
  })
  it('returns null when no status', () => {
    expect(currentPlan(PLANS, null)).toBeNull()
  })
  it('returns null when the plan is not in the catalog', () => {
    expect(currentPlan(PLANS, status('nonexistent'))).toBeNull()
  })
})

describe('classifyEntitlement truthfulness', () => {
  it('boolean false → unavailable', () => {
    expect(classifyEntitlement('diaspora.api.access', false)).toMatchObject({ kind: 'unavailable', label: 'Not included' })
  })
  it('numeric 0 → unavailable (no false "unlimited")', () => {
    expect(classifyEntitlement('diaspora.ai.execute_medium', 0)).toMatchObject({ kind: 'unavailable' })
  })
  it('boolean true → included capability', () => {
    expect(classifyEntitlement('diaspora.stock.create', true)).toMatchObject({ kind: 'included', label: 'Included' })
  })
  it('metered key with a positive number → metered monthly quota', () => {
    expect(classifyEntitlement('diaspora.ai.execute_medium', 25)).toMatchObject({ kind: 'metered', label: '25 / month' })
  })
  it('non-metered positive number → a fixed cap', () => {
    expect(classifyEntitlement('diaspora.stock.max_items', 250)).toMatchObject({ kind: 'limited', label: 'Up to 250' })
  })
})

describe('planEntitlementCells', () => {
  it('produces one cell per entitlement key in stable order', () => {
    const cells = planEntitlementCells(PLANS[0].entitlements)
    expect(cells.map((c) => c.featureKey)).toEqual([
      'diaspora.ai.execute_medium', 'diaspora.api.access', 'diaspora.stock.create', 'diaspora.stock.max_items',
    ])
  })
})

describe('humanizeFeatureKey', () => {
  it('renders a readable name from a canonical key', () => {
    expect(humanizeFeatureKey('diaspora.workbook.bulk_import')).toBe('Workbook Bulk Import')
  })
})

describe('toUsageView quota calc + display states', () => {
  const base: UsageEntry = { featureKey: 'diaspora.ai.execute_medium', limit: 25, used: 10, remaining: 15 }

  it('computes used/limit/remaining/percent for a metered feature', () => {
    const v = toUsageView(base)
    expect(v).toMatchObject({ used: 10, limit: 25, remaining: 15, unlimited: false, available: true, percentUsed: 40 })
    expect(v.statusText).toBe('10 of 25 used (15 remaining)')
  })

  it('treats a null limit as unlimited (truthful)', () => {
    const v = toUsageView({ featureKey: 'diaspora.x', limit: null, used: 5, remaining: null })
    expect(v.unlimited).toBe(true)
    expect(v.available).toBe(true)
    expect(v.percentUsed).toBeNull()
    expect(v.statusText).toContain('Unlimited')
  })

  it('honors an explicit unlimited flag', () => {
    const v = toUsageView({ featureKey: 'diaspora.x', limit: 999, used: 5, remaining: 994, unlimited: true })
    expect(v.unlimited).toBe(true)
    expect(v.limit).toBeNull()
  })

  it('treats a finite limit of 0 as unavailable on the plan', () => {
    const v = toUsageView({ featureKey: 'diaspora.ai.execute_medium', limit: 0, used: 0, remaining: 0 })
    expect(v.available).toBe(false)
    expect(v.statusText).toBe('Not available on your plan')
  })

  it('honors an explicit available:false flag', () => {
    const v = toUsageView({ featureKey: 'diaspora.x', limit: 25, used: 0, remaining: 25, available: false })
    expect(v.available).toBe(false)
  })

  it('surfaces reserved usage when provided', () => {
    const v = toUsageView({ ...base, reserved: 3 })
    expect(v.reserved).toBe(3)
  })

  it('caps percentUsed at 100 even when used exceeds limit', () => {
    const v = toUsageView({ featureKey: 'diaspora.x', limit: 10, used: 25, remaining: 0 })
    expect(v.percentUsed).toBe(100)
  })
})

describe('statusLabel', () => {
  const s = (over: Partial<SubscriptionStatus>): SubscriptionStatus => ({
    tenantId: 't', planKey: 'free', status: 'active', synthetic: false, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, active: true, ...over,
  })
  it('labels a synthetic Free truthfully', () => {
    expect(statusLabel(s({ synthetic: true, planKey: 'free' }))).toContain('Free')
  })
  it('maps lifecycle states to text (color-independent)', () => {
    expect(statusLabel(s({ status: 'grace_period' }))).toBe('Active (grace period)')
    expect(statusLabel(s({ status: 'past_due' }))).toBe('Past due')
  })
})

describe('formatPeriodDate', () => {
  it('formats an ISO timestamp as a UTC date', () => {
    expect(formatPeriodDate('2026-06-01T00:00:00.000Z')).toBe('2026-06-01')
  })
  it('returns a dash for null/invalid', () => {
    expect(formatPeriodDate(null)).toBe('—')
    expect(formatPeriodDate('not-a-date')).toBe('—')
  })
})

describe('canManageSubscriptionUi (frontend heuristic only)', () => {
  it('treats admin-class roles as manager-eligible', () => {
    expect(canManageSubscriptionUi('admin')).toBe(true)
    expect(canManageSubscriptionUi('platform_admin')).toBe(true)
    expect(canManageSubscriptionUi('tenant_admin')).toBe(true)
    expect(canManageSubscriptionUi('super_admin')).toBe(true)
  })
  it('treats ordinary members as read-only', () => {
    expect(canManageSubscriptionUi('owner')).toBe(false)
    expect(canManageSubscriptionUi('dealer')).toBe(false)
    expect(canManageSubscriptionUi('government')).toBe(false)
    expect(canManageSubscriptionUi(null)).toBe(false)
    expect(canManageSubscriptionUi(undefined)).toBe(false)
  })
})

// @vitest-environment jsdom
/**
 * Pure-parser + patch coverage for the rollout-percentage field (P2 fix).
 *
 * Regression guard: a BLANK (or whitespace-only) percentage input must default
 * to 100% (full rollout) — it must NEVER silently become 0% (fully gated), which
 * is what `Number('') === 0` produced before this fix.
 */
import { describe, it, expect } from 'vitest'
import {
  parseRolloutPercentage,
  buildRolloutPatch,
  formFromRow,
} from './FeatureGovernanceConsole'
import type { AdminFeatureRow, FeatureOverrideRow } from '@/hooks/useFeatureGovernanceApi'

const STATIC_ROLES = ['owner', 'dealer']

function override(partial: Partial<FeatureOverrideRow>): FeatureOverrideRow {
  return {
    id: 'ov-1', feature_id: 'product.x', environment: 'staging',
    lifecycle_state: null, enabled: true,
    allowed_roles: null,
    allowed_tenant_ids: [], denied_tenant_ids: [],
    starts_at: null, ends_at: null, beta_message: null, reason: null,
    rollout_percentage: 100, rollout_seed: null,
    created_by: null, updated_by: null,
    created_at: '2026-06-23T00:00:00Z', updated_at: '2026-06-23T00:00:00Z', version: 3,
    ...partial,
  }
}

function row(ov: FeatureOverrideRow | null): AdminFeatureRow {
  return {
    id: 'product.x', route: '/x', domain: 'product',
    defaultLifecycle: 'active', defaultRoles: STATIC_ROLES, immutableRoles: STATIC_ROLES,
    requiresAuth: true, override: ov,
    effective: { featureId: 'product.x', state: 'active', enabled: true, visible: true, accessible: true, beta: false },
  }
}

describe('parseRolloutPercentage — pure parser', () => {
  it('blank → 100 (NOT 0): clearing the input defaults to full rollout', () => {
    expect(parseRolloutPercentage('')).toEqual({ ok: true, value: 100 })
  })

  it('whitespace-only → 100 (NOT 0)', () => {
    expect(parseRolloutPercentage('   ')).toEqual({ ok: true, value: 100 })
  })

  it("explicit '0' is a valid 0% (distinct from blank)", () => {
    expect(parseRolloutPercentage('0')).toEqual({ ok: true, value: 0 })
  })

  it("'25' → 25", () => {
    expect(parseRolloutPercentage('25')).toEqual({ ok: true, value: 25 })
  })

  it("'100' → 100", () => {
    expect(parseRolloutPercentage('100')).toEqual({ ok: true, value: 100 })
  })

  it("trims surrounding whitespace around a valid integer", () => {
    expect(parseRolloutPercentage('  42  ')).toEqual({ ok: true, value: 42 })
  })

  it("'-1' → error (negative)", () => {
    const r = parseRolloutPercentage('-1')
    expect(r.ok).toBe(false)
  })

  it("'101' → error (above 100)", () => {
    const r = parseRolloutPercentage('101')
    expect(r.ok).toBe(false)
  })

  it("'abc' → error (non-numeric)", () => {
    const r = parseRolloutPercentage('abc')
    expect(r.ok).toBe(false)
  })

  it("'12.5' → error (decimals unsupported)", () => {
    const r = parseRolloutPercentage('12.5')
    expect(r.ok).toBe(false)
  })

  it('error results carry an accessible, non-empty message', () => {
    for (const bad of ['-1', '101', 'abc', '12.5']) {
      const r = parseRolloutPercentage(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
    }
  })
})

describe('buildRolloutPatch — percentage uses the normalized value, preserves tri-state roles', () => {
  it("blank percentage builds a patch of 100% (NOT 0%)", () => {
    const r = row(override({ allowed_roles: null }))
    const f = { ...formFromRow(r), rollout_percentage: '' }
    expect(buildRolloutPatch('staging', r, f).rollout_percentage).toBe(100)
  })

  it("percentage edit on an override with allowed_roles:[] keeps [] and sets the normalized value", () => {
    const r = row(override({ allowed_roles: [] }))
    const f = { ...formFromRow(r), rollout_percentage: '25' }
    const patch = buildRolloutPatch('staging', r, f)
    expect(patch.allowed_roles).toEqual([])      // explicit deny-all preserved
    expect(patch.rollout_percentage).toBe(25)
  })

  it("percentage edit on a null (default) role override keeps null", () => {
    const r = row(override({ allowed_roles: null }))
    const f = { ...formFromRow(r), rollout_percentage: '40' }
    const patch = buildRolloutPatch('staging', r, f)
    expect(patch.allowed_roles).toBeNull()        // default (inherit) preserved
    expect(patch.rollout_percentage).toBe(40)
  })

  it("an unparseable raw value falls back to the safe 100% default in the patch", () => {
    const r = row(override({ allowed_roles: ['owner'] }))
    const f = { ...formFromRow(r), rollout_percentage: 'abc' }
    const patch = buildRolloutPatch('staging', r, f)
    expect(patch.rollout_percentage).toBe(100)
    expect(patch.allowed_roles).toEqual(['owner'])
  })
})

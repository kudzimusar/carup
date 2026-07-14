// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  formFromRow,
  buildRolloutPatch,
  rolesModeOf,
  allowedRolesValue,
  roleSummary,
} from './featureGovernanceConsole.helpers'
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

describe('FeatureGovernanceConsole — tri-state role override (null vs [] vs subset)', () => {
  it('rolesModeOf classifies null/[]/subset distinctly', () => {
    expect(rolesModeOf(null)).toBe('default')
    expect(rolesModeOf(undefined)).toBe('default')
    expect(rolesModeOf([])).toBe('none')
    expect(rolesModeOf(['owner'])).toBe('custom')
  })

  it('load null → save null (no override stays "default")', () => {
    const f = formFromRow(row(override({ allowed_roles: null })))
    expect(f.rolesMode).toBe('default')
    expect(buildRolloutPatch('staging', row(override({ allowed_roles: null })), f).allowed_roles).toBeNull()
  })

  it('load [] → save [] (explicit deny-all round-trips, NOT collapsed to null)', () => {
    const r = row(override({ allowed_roles: [] }))
    const f = formFromRow(r)
    expect(f.rolesMode).toBe('none')
    expect(buildRolloutPatch('staging', r, f).allowed_roles).toEqual([])
  })

  it('create explicit deny-all from scratch', () => {
    const r = row(null)
    const f = { ...formFromRow(r), rolesMode: 'none' as const }
    expect(buildRolloutPatch('staging', r, f).allowed_roles).toEqual([])
  })

  it('load a role subset and preserve it', () => {
    const r = row(override({ allowed_roles: ['owner'] }))
    const f = formFromRow(r)
    expect(f.rolesMode).toBe('custom')
    expect(f.allowed_roles).toEqual(['owner'])
    expect(buildRolloutPatch('staging', r, f).allowed_roles).toEqual(['owner'])
  })

  it('no override loads as "default" → save null (reset/static-default path)', () => {
    const f = formFromRow(row(null))
    expect(f.rolesMode).toBe('default')
    expect(buildRolloutPatch('staging', row(null), f).allowed_roles).toBeNull()
  })

  it('percentage/seed edits do NOT mutate an explicit empty role override', () => {
    const r = row(override({ allowed_roles: [], rollout_percentage: 100 }))
    const loaded = formFromRow(r)
    // user only changes the percentage + seed
    const edited = { ...loaded, rollout_percentage: '25', rollout_seed: 'wave-1' }
    const patch = buildRolloutPatch('staging', r, edited)
    expect(patch.allowed_roles).toEqual([])      // still deny-all, NOT restored to defaults
    expect(patch.rollout_percentage).toBe(25)
    expect(patch.rollout_seed).toBe('wave-1')
  })

  it('percentage/seed edits do NOT mutate a "default" (null) role override', () => {
    const r = row(override({ allowed_roles: null }))
    const edited = { ...formFromRow(r), rollout_percentage: '50' }
    expect(buildRolloutPatch('staging', r, edited).allowed_roles).toBeNull()
  })

  it('roleSummary distinguishes Default roles, No roles, and a subset (confirmation labels)', () => {
    expect(roleSummary(null, STATIC_ROLES)).toBe('Default roles (owner, dealer)')
    expect(roleSummary([], STATIC_ROLES)).toBe('No roles (deny all)')
    expect(roleSummary(['owner'], STATIC_ROLES)).toBe('owner')
  })

  it('allowedRolesValue yields the correct wire value per mode', () => {
    expect(allowedRolesValue({ rolesMode: 'default', allowed_roles: ['owner'] })).toBeNull()
    expect(allowedRolesValue({ rolesMode: 'none', allowed_roles: ['owner'] })).toEqual([])
    expect(allowedRolesValue({ rolesMode: 'custom', allowed_roles: ['owner'] })).toEqual(['owner'])
  })
})

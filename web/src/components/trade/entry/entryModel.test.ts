/**
 * RX-06 — the Trade entry offers exactly what the feature registry allows: released tools to guests
 * ("sign in"), the account's own tools as "available", governance-hidden built tools as "unreleased"
 * (same rule as the Trade rail), other roles' tools without a link, and never a switched-off tool.
 */
import { describe, expect, it } from 'vitest'
import { getFeatureByRoute, type EffectiveFeatureState } from '@/config/featureRegistry'
import { TRADE_CAPABILITIES, TRADE_INTENTIONS, offeredCapabilities } from './entryModel'

const state = (featureId: string, over: Partial<EffectiveFeatureState>): EffectiveFeatureState => ({
  featureId, state: 'active', enabled: true, visible: true, accessible: true, beta: false, ...over,
})

describe('offeredCapabilities', () => {
  it('every capability is a registered route', () => {
    for (const cap of TRADE_CAPABILITIES) expect(getFeatureByRoute(cap.route), cap.route).toBeTruthy()
  })
  it('a guest sees released tools with "sign in", even when the anonymous visibility map hides them', () => {
    const importsId = getFeatureByRoute('/diaspora/imports')!.id
    const offered = offeredCapabilities({ isAuthenticated: false, role: null, effectiveStates: { [importsId]: state(importsId, { visible: false, accessible: false }) } })
    expect(offered.find(c => c.route === '/diaspora/imports')?.availability).toBe('sign-in')
    expect(offered.every(c => c.availability === 'sign-in')).toBe(true)
    for (const c of offered) expect(getFeatureByRoute(c.route)!.isHidden).toBeFalsy()
  })
  it('an importer gets their tools; another role’s tool is listed without access; a switched-off one is not listed', () => {
    const offered = offeredCapabilities({ isAuthenticated: true, role: 'owner' })
    expect(offered.find(c => c.route === '/diaspora/imports/new')?.availability).toBe('available')
    expect(offered.find(c => c.route === '/diaspora/stock')?.availability).toBe('other-role')
    const hiddenByFlag = TRADE_CAPABILITIES.filter(c => getFeatureByRoute(c.route)!.isHidden).map(c => c.route)
    for (const route of hiddenByFlag) expect(offered.find(c => c.route === route)).toBeUndefined()
  })
  it('a built tool governance still hides, that this account may open, is "unreleased" (as in the rail)', () => {
    const id = getFeatureByRoute('/diaspora/trade-profile')!.id
    const offered = offeredCapabilities({ isAuthenticated: true, role: 'owner', effectiveStates: { [id]: state(id, { state: 'hidden', visible: false, accessible: true }) } })
    expect(offered.find(c => c.route === '/diaspora/trade-profile')?.availability).toBe('unreleased')
  })
})

describe('guest intentions copy (TF-71)', () => {
  it('"Source a vehicle for me" asks for the budget its request flow requires, and never calls it optional', () => {
    const source = TRADE_INTENTIONS.find(i => i.key === 'source')!
    const text = [source.lead, ...source.points].join(' ')
    expect(text).toMatch(/your budget/)
    expect(text).not.toMatch(/budget is optional|leave the budget out|if you add one/i)
    expect(source.primary?.href).toBe('/diaspora/imports/new')
  })
})

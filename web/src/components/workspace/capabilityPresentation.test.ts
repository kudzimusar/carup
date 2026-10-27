import { describe, expect, it } from 'vitest'
import type { VehicleCapabilities } from '@/types'
import { describeMarketplaceCapability, describeTradeImportCapability } from './capabilityPresentation'

const VEZEL = 'RU3-1316558'
const SERENA = 'GFC27-027051'
const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'

describe('Marketplace capability presentation', () => {
  it.each([
    ['published', 'Published on Marketplace', 'manage', 'Manage listing', '/dashboard/listings'],
    ['in_progress', 'Listing in progress', 'continue', 'Continue listing', `/dashboard/sell-vehicle?vin=${VEZEL}`],
    ['sold', 'Sold', 'view-listing', 'View listing', '/dashboard/listings'],
    ['not_listed', 'Not listed', 'sell', 'Sell this vehicle', `/dashboard/sell-vehicle?vin=${VEZEL}`],
  ] as const)('%s -> "%s" with one honest action', (state, label, kind, actionLabel, href) => {
    const view = describeMarketplaceCapability(VEZEL, { state })
    expect(view.label).toBe(label)
    expect(view.fault).toBe(false)
    expect(view.actions).toEqual([{ kind, label: actionLabel, href }])
  })

  it('a listing that could not be read is a fault with NO action — never "Not listed"', () => {
    const view = describeMarketplaceCapability(VEZEL, { state: 'unavailable' })
    expect(view.fault).toBe(true)
    expect(view.actions).toEqual([])
    expect(`${view.label} ${view.detail}`).not.toMatch(/^Not listed/)
    expect(view.detail).toMatch(/not a report that it is unlisted/)
  })

  it('encodes the VIN it routes with', () => {
    expect(describeMarketplaceCapability('A B/C', { state: 'not_listed' }).actions[0].href).toBe('/dashboard/sell-vehicle?vin=A%20B%2FC')
  })
})

describe('Trade & Imports capability presentation', () => {
  it('no readable import order -> no import view and so no CAP action (the Serena)', () => {
    expect(describeTradeImportCapability(SERENA, { state: 'none' })).toBeNull()
  })

  it('exactly one readable order -> View CAP goes straight to THAT order, with the order as a second link', () => {
    const view = describeTradeImportCapability(VEZEL, { state: 'single', order_id: ORDER })
    expect(view?.label).toBe('Import journey available')
    expect(view?.actions).toEqual([
      { kind: 'view-cap', label: 'View CAP', href: `/diaspora/journey/import_order/${ORDER}` },
      { kind: 'view-order', label: 'Import order', href: `/diaspora/imports/${ORDER}` },
    ])
  })

  it('a "single" that does not name its order is never guessed — it falls back to the vehicle chooser', () => {
    const view = describeTradeImportCapability(VEZEL, { state: 'single' })
    expect(view?.actions).toEqual([{ kind: 'choose-journey', label: 'View CAP', href: `/diaspora/journey/vehicle/${VEZEL}` }])
    expect(view?.actions.some((action) => action.href.includes('import_order'))).toBe(false)
  })

  it('several readable orders -> a chooser, never a pick (no order id appears in any link)', () => {
    const view = describeTradeImportCapability(VEZEL, { state: 'multiple', count: 2, order_id: ORDER })
    expect(view?.label).toBe('2 import journeys')
    expect(view?.actions).toEqual([{ kind: 'choose-journey', label: 'Choose import journey', href: `/diaspora/journey/vehicle/${VEZEL}` }])
    expect(JSON.stringify(view)).not.toContain(ORDER)
  })

  it('does not state a count it was not given', () => {
    expect(describeTradeImportCapability(VEZEL, { state: 'multiple' })?.label).toBe('Several import journeys')
  })

  it('a check that FAILED is a fault with no action and says it is not a report of "none"', () => {
    const view = describeTradeImportCapability(VEZEL, { state: 'unavailable' })
    expect(view?.fault).toBe(true)
    expect(view?.actions).toEqual([])
    expect(view?.detail).toMatch(/not a report that there are none/)
    expect(view?.label).not.toMatch(/no import|none/i)
  })

  it('the two capabilities are described independently of each other', () => {
    // Same Trade input, every Marketplace state: the Trade view is identical (publication never changes CAP).
    const trade: VehicleCapabilities['trade_import'] = { state: 'single', order_id: ORDER }
    const baseline = JSON.stringify(describeTradeImportCapability(VEZEL, trade))
    for (const state of ['published', 'in_progress', 'sold', 'not_listed', 'unavailable'] as const) {
      describeMarketplaceCapability(VEZEL, { state })
      expect(JSON.stringify(describeTradeImportCapability(VEZEL, trade))).toBe(baseline)
    }
    // And the reverse: the Marketplace view does not move with the import state.
    const market = JSON.stringify(describeMarketplaceCapability(VEZEL, { state: 'not_listed' }))
    for (const state of ['none', 'single', 'multiple', 'unavailable'] as const) {
      describeTradeImportCapability(VEZEL, { state })
      expect(JSON.stringify(describeMarketplaceCapability(VEZEL, { state: 'not_listed' }))).toBe(market)
    }
  })

  it('speaks customer language — no programme codes in any label or detail', () => {
    const views = [
      ...(['published', 'in_progress', 'sold', 'not_listed', 'unavailable'] as const).map((state) => describeMarketplaceCapability(VEZEL, { state })),
      describeTradeImportCapability(VEZEL, { state: 'single', order_id: ORDER }),
      describeTradeImportCapability(VEZEL, { state: 'multiple', count: 3 }),
      describeTradeImportCapability(VEZEL, { state: 'unavailable' }),
    ]
    for (const view of views) {
      const text = [view?.label, view?.detail, ...(view?.actions.map((action) => action.label) ?? [])].join(' ')
      expect(text).not.toMatch(/Trade OS|\bT\d{1,2}\b|LR01|compositor|Journey & arrival/i)
    }
  })
})

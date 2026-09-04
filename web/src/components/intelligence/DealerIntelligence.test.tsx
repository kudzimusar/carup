/**
 * CarUp Intelligence 1.0 — I8 Dealer Intelligence.
 *
 * Half of these test the component; half are source-level assertions that the
 * specific fabrications the I0 audit found on the dealer surfaces are GONE and
 * cannot quietly return. Source assertions are the right tool for "this literal
 * must not exist": a rendering test would only prove it is not visible today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import DealerIntelligence from './DealerIntelligence'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8')
const SALES_ANALYTICS = read('../../pages/dashboard/dealer/SalesAnalytics.tsx')
const DEALER_DASHBOARD = read('../../pages/dashboard/dealer/DealerDashboard.tsx')
const PROMOTIONS = read('../../pages/dashboard/dealer/Promotions.tsx')
const DEALER_INVENTORY = read('../../pages/dashboard/dealer/Inventory.tsx')

const fetchDealerIntelligence = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchDealerIntelligence }),
}))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const payload = {
  ok: true,
  availability: 'value',
  calculation_version: 'rollup@1',
  as_of: '2026-08-27T04:00:00.000Z',
  window_days: 30,
  metrics: {
    impressions: value(900),
    views: value(300),
    unique_viewers: { availability: 'value', value: 180, unit: 'count', basis: 'peak_day' },
    saves: value(40),
    shares_confirmed: value(12),
    inquiries: value(25),
    inspections: value(3),
  },
  conversion: { view_to_inquiry: value(8.3, 'percent') },
  coverage: { days_with_data: 30, days_requested: 30 },
}

beforeEach(() => {
  // Block body, NOT an implicit return: `mockReset()` returns the mock itself, and
  // vitest treats a function returned from beforeEach as a teardown callback — so
  // the one-liner form made the runner CALL the mock after every test, outside any
  // handler, surfacing the rejection as an unhandled test error.
  fetchDealerIntelligence.mockReset()
})

describe('the dealer sees their own tenant, measured', () => {
  it('renders the governed funnel', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-views-value')).toHaveTextContent('300')
    expect(screen.getByTestId('dealer-inquiries-value')).toHaveTextContent('25')
    expect(screen.getByTestId('dealer-view-to-lead')).toHaveTextContent('8.3%')
  })

  it('says whose numbers these are', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-scope-note')).toHaveTextContent(/Your dealership only/i)
  })

  it('requests the tenant projection with no tenant parameter to pass', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    render(<DealerIntelligence windowDays={30} />)
    await waitFor(() => expect(fetchDealerIntelligence).toHaveBeenCalledWith(30))
    // One argument only: the window. Scope comes from the verified session.
    expect(fetchDealerIntelligence.mock.calls[0]).toHaveLength(1)
  })

  it('qualifies a peak-day unique rather than implying a window total', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-unique_viewers')).toHaveTextContent(/busiest day/i)
  })
})

describe('sales are absent, and the absence is named', () => {
  it('states that no authoritative sales record exists', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    render(<DealerIntelligence />)
    const block = await screen.findByTestId('dealer-sales-unavailable')
    expect(block).toHaveTextContent(/no authoritative record of your completed sales/i)
    expect(block).toHaveTextContent(/not zero/i)
  })

  it('shows no revenue, units-sold or average-sale figure anywhere', async () => {
    fetchDealerIntelligence.mockResolvedValue(payload)
    const { container } = render(<DealerIntelligence />)
    await screen.findByTestId('dealer-intelligence')
    const text = container.textContent || ''
    expect(text).not.toMatch(/\$[\d,]/)
    expect(text).not.toMatch(/units sold/i)
  })
})

describe('a failed read is never zero', () => {
  it('says so when the request fails', async () => {
    fetchDealerIntelligence.mockRejectedValue(new Error('backend down'))
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-intelligence-message')).toHaveTextContent(/NOT zero/)
  })

  it('says so when the projection reports unavailable', async () => {
    fetchDealerIntelligence.mockResolvedValue({
      ok: true, availability: 'unavailable', reason: 'never_computed',
      message: 'Intelligence for this period could not be read. These figures are NOT zero.',
    })
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-intelligence-message')).toHaveTextContent(/NOT zero/)
    expect(screen.queryByTestId('dealer-funnel')).not.toBeInTheDocument()
  })

  it('reports a missing verified tenant rather than showing platform figures', async () => {
    // The projection refuses a tenant-less operator; the surface must relay that.
    fetchDealerIntelligence.mockRejectedValue(new Error('A verified tenant context is required'))
    render(<DealerIntelligence />)
    expect(await screen.findByTestId('dealer-intelligence-unavailable')).toBeInTheDocument()
  })
})

// ── The fabrications the I0 audit found must not be able to return ─────────

describe('SalesAnalytics no longer publishes a fiction', () => {
  it('has no hardcoded revenue, units or average-price seed', () => {
    expect(SALES_ANALYTICS).not.toContain('2090000')
    expect(SALES_ANALYTICS).not.toContain('39400')
    expect(SALES_ANALYTICS).not.toMatch(/unitsSold:\s*53/)
  })

  it('has no invented movement badges', () => {
    for (const delta of ["'+12%'", "'+8%'", "'-2%'", "'+0.2'"]) {
      expect(SALES_ANALYTICS).not.toContain(delta)
    }
  })

  it('shows no customer rating, because CarUp has no rating system', () => {
    expect(SALES_ANALYTICS).not.toMatch(/Customer Rating/i)
    expect(SALES_ANALYTICS).not.toContain("'4.8'")
  })

  it('has no static monthly-sales or category-split arrays', () => {
    expect(SALES_ANALYTICS).not.toContain('mockMonthlySales')
    expect(SALES_ANALYTICS).not.toContain('categorySplit')
  })

  it('no longer measures a dealer against the PUBLIC platform-wide vehicle list', () => {
    expect(SALES_ANALYTICS).not.toContain('fetchVehicles')
    expect(SALES_ANALYTICS).toContain('DealerIntelligence')
  })
})

describe('DealerDashboard no longer draws invented performance', () => {
  it('has no static sales series', () => {
    expect(DEALER_DASHBOARD).not.toContain('const salesData')
  })

  it('has no hardcoded inventory-aging bars', () => {
    expect(DEALER_DASHBOARD).not.toMatch(/Progress value=\{?(60|30|10)\}?/)
    expect(DEALER_DASHBOARD).toContain('days on market cannot be measured')
  })

  it('counts the dealer\'s OWN inventory, not the whole marketplace', () => {
    // `fetchVehicles` is the public, platform-wide, publication-gated read.
    expect(DEALER_DASHBOARD).not.toContain('fetchVehicles')
    expect(DEALER_DASHBOARD).toContain('fetchDealerInventory')
  })

  it('does not report a failed inventory read as a count of zero', () => {
    expect(DEALER_DASHBOARD).toMatch(/inventoryState === 'ready' \? liveInventory\.length : 'Not available'/)
  })
})

describe('Promotions no longer mixes mock data into real data', () => {
  it('has no seeded promotion list at all', () => {
    expect(PROMOTIONS).not.toContain('mockPromotions')
  })

  it('does not concatenate anything into a successful read', () => {
    expect(PROMOTIONS).not.toMatch(/\.\.\.formatted,\s*\.\.\./)
    expect(PROMOTIONS).toContain('setPromotions(formatted)')
  })

  it('has no hardcoded views or click-rate tiles', () => {
    expect(PROMOTIONS).not.toMatch(/>434</)
    expect(PROMOTIONS).not.toMatch(/>12\.2%</)
  })

  it('says views and clicks are not tracked instead of printing zero', () => {
    expect(PROMOTIONS).toContain('Views not tracked')
    expect(PROMOTIONS).toContain('Clicks not tracked')
  })

  it('distinguishes a failed load from having no promotions', () => {
    expect(PROMOTIONS).toContain('promotions-load-failed')
    expect(PROMOTIONS).toContain('This is not an empty list')
  })
})

describe('dealer Inventory renders only fields that exist', () => {
  it('no longer reads columns the endpoint does not return', () => {
    for (const field of ['vehicle.viewCount', 'vehicle.trustScore', 'vehicle.condition', 'vehicle.isVerified']) {
      expect(DEALER_INVENTORY).not.toContain(field)
    }
  })

  it('shows no stock photograph of somebody else\'s car', () => {
    expect(DEALER_INVENTORY).not.toContain('unsplash')
  })

  it('does not invent an "Available" status for an unrecorded one', () => {
    expect(DEALER_INVENTORY).not.toContain("vehicle.status || 'Available'")
    expect(DEALER_INVENTORY).toContain('Status not recorded')
  })

  it('distinguishes a failed load from an empty lot', () => {
    expect(DEALER_INVENTORY).toContain('loadFailed')
    expect(DEALER_INVENTORY).toContain('This is not an empty inventory')
  })
})

/** RX04-C — Seller insights (unified): measured values render; unmeasured stays words; car-by-car survives an unreadable rollup. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const m = (value: number | null, availability: 'value' | 'unavailable' = 'value') => ({ availability, value })
const vehicle = { vin: 'VIN00000000000001', year: 2018, make: 'Toyota', model: 'Hilux' }

function mockApi(pulse: unknown) {
  vi.doMock('@/hooks/useCarUpApi', () => {
    const api = {
      fetchSellerIntelligence: vi.fn().mockResolvedValue(pulse),
      fetchListingIntelligence: vi.fn().mockResolvedValue({ availability: 'value', metrics: { views: m(12), saves: m(3), inquiries: m(1) } }),
      fetchOwnedVehicles: vi.fn().mockResolvedValue([vehicle]),
      fetchMyMarketplaceInquiries: vi.fn().mockResolvedValue({ inquiries: [{ inquiry_type: 'price_question' }] }),
      fetchCommunicationThreads: vi.fn().mockResolvedValue({ threads: [] }),
    }
    return { useCarUpApi: () => api }
  })
}

beforeEach(() => { vi.resetModules(); (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi') })

describe('SellerIntelligence — unified', () => {
  it('shows measured values, the funnel and each car; an unmeasured metric is words, not zero', async () => {
    mockApi({
      availability: 'value',
      metrics: { active_listings: m(1), views: m(40), unique_viewers: m(null, 'unavailable'), saves: m(4), inquiries: m(2), impressions: m(200) },
      conversion: { view_to_save: m(0.1), view_to_inquiry: m(0.05) },
      series: [{ date: '2026-11-01', active_listings: 1, impressions: 20, views: 4, saves: 1, inquiries: 0, inspections: 0 }],
    })
    const { default: SellerIntelligence } = await import('./SellerIntelligence')
    render(<MemoryRouter><SellerIntelligence /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('seller-intelligence-kpi-band')).toBeInTheDocument())
    expect(screen.getByTestId('seller-intelligence-kpi-listing-views')).toHaveTextContent('40')
    expect(screen.getByTestId('seller-intelligence-kpi-unique-visitors')).not.toHaveTextContent(/^Unique visitors0/)
    expect(screen.getByTestId('seller-intelligence-time-series')).toBeInTheDocument()
    expect(screen.getByTestId('seller-intelligence-funnel')).toHaveTextContent('Sent an inquiry')
    expect(screen.getByTestId('seller-intelligence-listing-VIN00000000000001')).toHaveTextContent('12')
    expect(screen.getByTestId('seller-intelligence-inquiry-distribution')).toHaveTextContent('price question')
  })

  it('keeps the car-by-car view when the overall rollup is unavailable', async () => {
    mockApi({ availability: 'unavailable', message: 'Intelligence for this period could not be read.' })
    const { default: SellerIntelligence } = await import('./SellerIntelligence')
    render(<MemoryRouter><SellerIntelligence /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('seller-intelligence-listing-comparison')).toBeInTheDocument())
    expect(screen.queryByTestId('seller-intelligence-kpi-band')).toBeNull()
    expect(screen.getByTestId('seller-intelligence-listing-VIN00000000000001')).toBeInTheDocument()
  })
})

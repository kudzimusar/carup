/** RX04-C — My listings (unified): recorded states drive filters and actions; drafts explain why they cannot be removed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/components/listing/OwnerListingMedia', () => ({ OwnerListingMedia: () => <div>media</div> }))
vi.mock('@/components/marketplace/SellerInquiriesCard', () => ({ SellerInquiriesCard: () => <div>inquiries</div> }))
vi.mock('@/components/intelligence/ListingInsights', () => ({ default: () => <div>insights</div> }))

const car = (vin: string, publication_status: string, status = 'available', extra = {}) =>
  ({ vin, year: 2018, make: 'Toyota', model: 'Hilux', price: 18500, currency: 'USD', publication_status, status, ...extra })

beforeEach(() => {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  vi.doMock('@/hooks/useCarUpApi', () => {
    const api = {
      fetchOwnedVehicles: vi.fn().mockResolvedValue([car('LIVE0000000000001', 'published'), car('DRAFT000000000002', 'draft'), car('SOLD0000000000003', 'published', 'sold')]),
      fetchCommunicationThreads: vi.fn().mockRejectedValue(new Error('down')),
      updateVehicleStatus: vi.fn(), publishVehicleListing: vi.fn(), unpublishVehicleListing: vi.fn(), updateVehiclePrice: vi.fn(),
    }
    return { useCarUpApi: () => api }
  })
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi') })

describe('MyListings — unified', () => {
  it('filters by recorded state, keeps every action id, and never claims a draft can be deleted', async () => {
    const { default: MyListings } = await import('./MyListings')
    render(<MemoryRouter><MyListings /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('my-listing-card-LIVE0000000000001')).toBeInTheDocument())
    expect(screen.getByTestId('my-listings-filter-all')).toHaveTextContent('3')
    expect(screen.getByTestId('my-listings-filter-live')).toHaveTextContent('1')
    expect(screen.getByTestId('my-listings-filter-sold')).toHaveTextContent('1')
    // Conversations could not be read — said, not shown as zero.
    expect(screen.getByTestId('seller-listing-kpis')).toHaveTextContent('Could not be read')
    // Draft: continue, readiness, publish attempt, price, and an honest removal answer.
    expect(screen.getByTestId('listing-primary-DRAFT000000000002')).toHaveAttribute('href', '/dashboard/sell-vehicle?vin=DRAFT000000000002')
    expect(screen.getByTestId('publication-readiness-DRAFT000000000002')).toBeInTheDocument()
    expect(screen.getByTestId('publish-toggle-DRAFT000000000002')).toHaveTextContent('Publish to Marketplace')
    expect(screen.getByTestId('listing-remove-unavailable-DRAFT000000000002')).toHaveTextContent('cannot be removed here')
    expect(screen.queryByRole('button', { name: /delete|remove draft/i })).toBeNull()
    // Live: no removal note; sold: no sell-side actions.
    expect(screen.queryByTestId('listing-remove-unavailable-LIVE0000000000001')).toBeNull()
    expect(screen.queryByTestId('mark-sold-SOLD0000000000003')).toBeNull()
    fireEvent.click(screen.getByTestId('my-listings-filter-live'))
    expect(screen.queryByTestId('my-listing-card-DRAFT000000000002')).toBeNull()
    expect(screen.getByTestId('my-listing-card-LIVE0000000000001')).toBeInTheDocument()
  })
})

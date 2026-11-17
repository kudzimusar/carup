/** RX03-P2-R4 — My CarUp leads with the owner's vehicles and keeps every truthfulness marker. */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/components/intelligence/MarketplacePulse', () => ({ default: () => <div>pulse</div> }))
vi.mock('@/components/intelligence/NextBestActions', () => ({ default: () => <div>next best</div> }))
vi.mock('@/components/intelligence/PeriodicReport', () => ({ default: () => <div>report</div> }))
vi.mock('@/components/listing/OwnerListingMedia', () => ({ OwnerListingMedia: () => <div>media</div> }))

const base = {
  userName: 'Tendai',
  escrow: { status: 'ready' as const, usd: 0, count: 0 },
  notificationsState: 'ready' as const,
  recentNotifications: [],
  attentionItems: [],
  lowBandwidth: false,
  onToggleLowBandwidth: () => {},
}

describe('MyCarUpHome', () => {
  it('vehicles come before money/standing and market insights; truth markers are kept', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[{ vin: 'VIN1', year: 2015, make: 'Toyota', model: 'Hilux', mileage: 120000 } as never]} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, Tendai!')
    const order = ['mycarup-vehicles', 'mycarup-destinations', 'mycarup-standing', 'mycarup-insights'].map(id => screen.getByTestId(id))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByTestId('mycarup-vehicle-card')).toHaveAttribute('href', '/dashboard/garage/VIN1')
    expect(screen.getByTestId('wallet-usd-value')).toHaveTextContent('Not available')
    expect(screen.getByTestId('trust-index-value')).toHaveTextContent('Not calculated')
    expect(screen.getByTestId('trust-claim-state-VIN1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Saved cars/ })).toHaveAttribute('href', '/dashboard/saved')
  })
  it('a failed garage read is not an empty garage', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="unavailable" vehicles={[]} /></MemoryRouter>)
    expect(screen.getByTestId('mycarup-vehicles-unavailable')).toHaveTextContent('not an empty garage')
    expect(screen.queryByTestId('mycarup-vehicles-empty')).toBeNull()
  })
})

describe('MyCarUpHome — Today (RX04-C I-01)', () => {
  const car = (vin: string, publication_status: string | null, extra: Record<string, unknown> = {}) =>
    ({ vin, year: 2018, make: 'Toyota', model: 'Hilux', mileage: 120000, publication_status, status: 'active', ...extra }) as never

  it('turns recorded listing states into actions: ready to publish first, then drafts; live and unlisted cars are not "to do"', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[car('LIVE0000000000001', 'published'), car('DRAFT000000000002', 'draft'), car('READY000000000003', 'publishable'), car('NONE0000000000004', null)]} /></MemoryRouter>)
    const items = screen.getAllByTestId(/^mycarup-attention-listing-/).map(el => el.getAttribute('data-testid'))
    expect(items).toEqual(['mycarup-attention-listing-READY000000000003', 'mycarup-attention-listing-DRAFT000000000002'])
    expect(screen.getByTestId('mycarup-listing-state-LIVE0000000000001')).toHaveTextContent('Live listing')
    expect(screen.getByTestId('mycarup-today-summary')).toHaveTextContent('4 cars in your Garage · 2 things to do')
    // The Sell move points at the car that is not listed, with its Passport.
    expect(screen.getByTestId('mycarup-discover-sell')).toHaveAttribute('href', '/dashboard/sell-vehicle?vin=NONE0000000000004')
  })

  it('a listing under review is something to follow, not something to do', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[car('REVIEW00000000001', 'review_pending')]} /></MemoryRouter>)
    expect(screen.queryByTestId(/^mycarup-attention-listing-/)).toBeNull()
    expect(screen.getByTestId('mycarup-continue-review-REVIEW00000000001')).toHaveAttribute('href', '/dashboard/listings')
  })

  it('two or more saved cars become a shortlist to compare; an unread saved list is said, not hidden as empty', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    const listing = (vin: string) => ({ vin, make: 'Mazda', model: 'CX-5', year: 2019, price: 15000, currency: 'USD' }) as never
    const { unmount } = render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[]} savedState="ready" savedListings={[listing('SAVED000000000001'), listing('SAVED000000000002')]} /></MemoryRouter>)
    expect(screen.getByTestId('mycarup-continue-saved')).toHaveAttribute('href', '/marketplace/compare?vins=SAVED000000000001,SAVED000000000002')
    unmount()
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[]} savedState="unavailable" savedListings={[]} /></MemoryRouter>)
    expect(screen.getByTestId('mycarup-continue-saved-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('mycarup-continue-saved')).toBeNull()
  })

  it('documents are counted from the Passport rows read, never asserted as empty', async () => {
    const { MyCarUpHome } = await import('./MyCarUpHome')
    const { unmount } = render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="ready" vehicles={[car('DOC00000000000001', null, { counts: { verified_documents: 2, services: null, parts: null, active_insurance: null } })]} /></MemoryRouter>)
    expect(screen.getByTestId('mycarup-documents-count')).toHaveTextContent('2 verified documents across your cars')
    unmount()
    render(<MemoryRouter><MyCarUpHome {...base} vehiclesState="unavailable" vehicles={[]} /></MemoryRouter>)
    expect(screen.getByTestId('mycarup-documents-count')).toHaveTextContent('once your Garage has been read')
  })
})

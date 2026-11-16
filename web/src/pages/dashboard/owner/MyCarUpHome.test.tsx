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

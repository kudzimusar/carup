import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SellerWorkspaceHeader } from './SellerWorkspaceHeader'
import { getDashboardItems } from '@/config/featureRegistry'

const fetchOwnedVehicles = vi.fn()
let authenticated = false

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: authenticated, user: authenticated ? { role: 'owner' } : null }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchOwnedVehicles }),
}))

const { SellIntentRouter } = await import('@/components/sell/SellIntentRouter')

describe('Seller workspace orientation', () => {
  beforeEach(() => {
    fetchOwnedVehicles.mockReset()
    authenticated = false
  })

  it('keeps Garage and Evidence as distinct owner destinations', () => {
    const owner = getDashboardItems('owner')
    const garage = owner.find(item => item.id === 'owner.garage')
    const evidence = owner.find(item => item.id === 'owner.evidence-vault')
    expect(garage?.route).toBe('/dashboard/garage')
    expect(evidence?.route).toBe('/dashboard/evidence')
    expect(garage?.route).not.toBe(evidence?.route)
  })

  it('provides back/up, object identity, truthful status and one primary-action region', () => {
    render(
      <MemoryRouter>
        <SellerWorkspaceHeader
          title="Continue listing"
          description="Keep the vehicle thread intact."
          backHref="/dashboard/garage"
          backLabel="Back to My Garage"
          objectIdentity="UAT20260828SELL01"
          statusLabel="Draft workspace · not public"
          primaryAction={<a href="/dashboard/listings">My Listings</a>}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Back to My Garage' })).toHaveAttribute('href', '/dashboard/garage')
    expect(screen.getByTestId('seller-workspace-object')).toHaveTextContent('UAT20260828SELL01')
    expect(screen.getByTestId('seller-workspace-status')).toHaveTextContent('Draft workspace · not public')
    expect(screen.getAllByTestId('seller-workspace-primary-action')).toHaveLength(1)
  })

  it('shows authenticated Garage vehicles before asking for a blank new vehicle', async () => {
    authenticated = true
    fetchOwnedVehicles.mockResolvedValue([{
      vin: 'UAT20260828SELL01',
      year: 2021,
      make: 'Toyota',
      model: 'Hilux',
      publication_status: 'draft',
      status: 'available',
      listing_media: { state: 'none', items: [] },
    }])

    render(<MemoryRouter><SellIntentRouter hasLocalDraft={false} onResolve={vi.fn()} /></MemoryRouter>)

    await waitFor(() => expect(screen.getByTestId('sell-garage-vehicle-UAT20260828SELL01')).toBeTruthy())
    expect(screen.getByRole('link', { name: /Continue listing/i })).toHaveAttribute(
      'href',
      '/dashboard/sell-vehicle?vin=UAT20260828SELL01',
    )
    expect(screen.getByTestId('sell-intent-known')).toBeTruthy()
    expect(screen.getByTestId('sell-intent-new')).toBeTruthy()
  })

  it('signed-out entry offers known, new and sign-in paths without inventing ownership', () => {
    render(<MemoryRouter><SellIntentRouter hasLocalDraft={false} onResolve={vi.fn()} /></MemoryRouter>)
    expect(screen.getByTestId('sell-intent-known')).toBeTruthy()
    expect(screen.getByTestId('sell-intent-new')).toBeTruthy()
    expect(screen.getByTestId('sell-intent-sign-in')).toHaveAttribute('href', '/login?returnTo=%2Fsell')
    expect(screen.queryByTestId('sell-intent-garage')).toBeNull()
  })
})

/**
 * RX05-A — /dealers in the showroom presentation. The page keeps the same debounced read and
 * filters; the view shows honest standings, filters built only from returned values, a disclosed
 * illustration, and a retry after a failed read. Flag OFF keeps the accepted directory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DealerDirectory from '@/pages/DealerDirectory'

const fixture = vi.hoisted(() => ({
  showroom: true,
  fail: false,
  omitCategories: false,
  paths: [] as string[],
}))

vi.mock('@/lib/presentationFlags', () => ({ isShowroomPagesEnabled: () => fixture.showroom }))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async ({ path }: { path: string }) => {
    fixture.paths.push(path)
    if (fixture.fail) throw Object.assign(new Error('Too many requests'), { status: 429 })
    const city = new URLSearchParams(path.split('?')[1]).get('city')
    const all = [
      { tier: 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED', seed_dealer_id: 'ZW-DEAL-0001', slug: 'zw-deal-0001', name: 'FICTIONAL CAR DEALER 1', city: 'Harare', category: 'Vehicle sales (research category)', source_attribution: 'Fictional Source', reviewed_at: '2026-11-15T10:00:00Z', revision: 1, claimed: true, business_verified: false, label: 'Existing approved claim — No current independently verified storefront' },
      { tier: 'PRELISTED_UNCLAIMED', seed_dealer_id: 'ZW-DEAL-0003', slug: 'zw-deal-0003', name: 'FICTIONAL CAR DEALER 3', city: 'Bulawayo', category: 'Vehicle sales (research category)', source_attribution: 'Fictional Source', reviewed_at: '2026-11-15T10:00:00Z', revision: 1, claimed: false, business_verified: false, label: 'Unclaimed — Not independently business-verified' },
      // A contradictory row: verified flag without the approved tier must NOT read as approved.
      { tier: 'PRELISTED_UNCLAIMED', seed_dealer_id: 'ZW-DEAL-0009', slug: 'zw-deal-0009', name: 'FICTIONAL CONTRADICTION', city: 'Harare', category: 'Vehicle sales (research category)', source_attribution: 'Fictional Source', reviewed_at: '2026-11-15T10:00:00Z', revision: 2, claimed: false, business_verified: true, label: 'Unclaimed — Not independently business-verified' },
    ]
    const entries = city ? all.filter(entry => entry.city === city) : all
    return {
      entries,
      total: entries.length,
      page: 1,
      limit: 30,
      available_tiers: ['PRELISTED_UNCLAIMED', 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED', 'FULL_DEALER_APPROVED'],
      ...(fixture.omitCategories ? {} : { available_categories: ['Vehicle sales (research category)', 'Vehicle imports (research category)'] }),
    }
  },
}))

function renderDirectory() {
  return render(<MemoryRouter><DealerDirectory /></MemoryRouter>)
}

beforeEach(() => {
  fixture.showroom = true
  fixture.fail = false
  fixture.omitCategories = false
  fixture.paths = []
})

describe('DealerDirectory — showroom presentation', () => {
  it('renders the editorial directory with a disclosed illustration and honest standings', async () => {
    renderDirectory()
    expect(screen.getByTestId('dealer-directory-showroom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Dealerships, with the facts on the record.' })).toBeInTheDocument()
    expect(screen.getByTestId('showroom-floor-scene')).toBeInTheDocument()
    expect(screen.getByTestId('scene-disclosure')).toHaveTextContent('Illustration')

    const unclaimed = await screen.findByTestId('dealer-directory-card-ZW-DEAL-0003')
    expect(unclaimed).toHaveAttribute('data-standing', 'unclaimed')
    expect(within(unclaimed).getByTestId('dealer-directory-standing-ZW-DEAL-0003')).toHaveTextContent('Listed from public sources · not claimed')
    expect(within(unclaimed).getByRole('link', { name: 'Claim this dealership' })).toHaveAttribute('href', '/dealers/zw-deal-0003/claim')
    expect(within(unclaimed).getByRole('link', { name: 'FICTIONAL CAR DEALER 3' })).toHaveAttribute('href', '/dealers/zw-deal-0003')

    const claimed = screen.getByTestId('dealer-directory-card-ZW-DEAL-0001')
    expect(claimed).toHaveAttribute('data-standing', 'claimed')
    expect(within(claimed).getByText('Claimed · public display not yet approved')).toBeInTheDocument()
    expect(within(claimed).queryByRole('link', { name: 'Claim this dealership' })).toBeNull()

    // Fail closed: business_verified without the approved tier is never shown as approved.
    const contradiction = screen.getByTestId('dealer-directory-card-ZW-DEAL-0009')
    expect(contradiction).toHaveAttribute('data-standing', 'unclaimed')
    expect(within(contradiction).queryByText('Independently reviewed dealership')).toBeNull()
    expect(screen.getByTestId('dealer-directory-count')).toHaveTextContent('3 published profiles')
    expect(screen.getByTestId('dealer-unavailable-new-business')).toHaveTextContent('not available yet')
  })

  it('builds filters only from returned values and sends the exact city to the same read', async () => {
    renderDirectory()
    await screen.findByTestId('dealer-directory-card-ZW-DEAL-0003')
    const categories = within(screen.getByTestId('dealer-category-filter')).getAllByRole('option').map(option => option.textContent)
    expect(categories).toEqual(['All categories', 'Vehicle sales (research category)', 'Vehicle imports (research category)'])
    expect(screen.getByTestId('dealer-city-chip-Bulawayo')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('dealer-city-chip-Bulawayo'))
    await waitFor(() => expect(fixture.paths.some(path => path.includes('city=Bulawayo'))).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('dealer-directory-card-ZW-DEAL-0001')).toBeNull())
    expect(screen.getByTestId('dealer-city-chip-Bulawayo')).toHaveAttribute('aria-pressed', 'true')
    // The other city stays available after filtering (it came from an earlier response).
    expect(screen.getByTestId('dealer-city-chip-Harare')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('dealer-directory-clear-filters'))
    await screen.findByTestId('dealer-directory-card-ZW-DEAL-0001')
  })

  it('hides the category filter when the API returns no categories (no hard-coded fallback)', async () => {
    fixture.omitCategories = true
    renderDirectory()
    await screen.findByTestId('dealer-directory-card-ZW-DEAL-0003')
    expect(screen.queryByTestId('dealer-category-filter')).toBeNull()
  })

  it('says a failed read is not evidence of no dealers, and retries the same read', async () => {
    fixture.fail = true
    renderDirectory()
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByTestId('dealer-directory-empty')).toBeNull()
    const before = fixture.paths.length
    fixture.fail = false
    fireEvent.click(screen.getByTestId('dealer-directory-retry'))
    await screen.findByTestId('dealer-directory-card-ZW-DEAL-0003')
    expect(fixture.paths.length).toBeGreaterThan(before)
  })
})

describe('DealerDirectory — flag OFF', () => {
  it('keeps the accepted directory composition', async () => {
    fixture.showroom = false
    renderDirectory()
    expect(screen.getByRole('heading', { name: 'Zimbabwe Dealership Directory' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-directory-showroom')).toBeNull()
    expect(await screen.findAllByRole('link', { name: 'View researched profile' })).toHaveLength(3)
  })
})

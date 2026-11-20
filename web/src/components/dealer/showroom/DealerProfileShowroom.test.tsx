/**
 * RX05-A — /dealers/:seedId and /dealers/:seedId/claim in the showroom presentation. The page keeps
 * every read, the SEO tags and the claim POST; the view must never present a research listing as an
 * approved dealer, never show stock it was not given, and keep the claim-first flow intact.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DealerResearchProfile from '@/pages/DealerResearchProfile'

type Call = { path: string; method: string; body?: unknown }
const fixture = vi.hoisted(() => ({
  showroom: true,
  signedIn: false,
  failProfile: false,
  calls: [] as Call[],
  profiles: {} as Record<string, unknown>,
}))

const saveFns = vi.hoisted(() => ({
  saveMarketplaceListing: async () => ({}),
  unsaveMarketplaceListing: async () => ({}),
  fetchSavedMarketplaceListings: async () => ({ listings: [] }),
}))

vi.mock('@/lib/presentationFlags', () => ({ isShowroomPagesEnabled: () => fixture.showroom }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => saveFns }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => fixture.signedIn
    ? { user: { id: 'fictional-claimant', role: 'member', name: 'Fictional Claimant' }, token: 'synthetic-session' }
    : { user: null, token: null },
}))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async ({ path, options }: { path: string; options?: { method?: string; body?: string } }) => {
    const method = options?.method || 'GET'
    fixture.calls.push({ path, method, body: options?.body ? JSON.parse(options.body) : undefined })
    const match = path.match(/^\/dealership\/research\/(ZW-DEAL-\d{4})(\/.*)?$/)
    if (!match) throw new Error('unexpected path ' + path)
    const [, id, rest] = match
    if (!rest) {
      if (fixture.failProfile) throw Object.assign(new Error('unavailable'), { status: 503 })
      return { profile: fixture.profiles[id] ?? null }
    }
    if (rest === '/contact') return { contacts: { seed_dealer_id: id, reviewed_public_address: null, reviewed_public_phone: null, reviewed_public_website: null, source_checked_at: null, business_verified: false } }
    if (rest === '/inventory') return { inventory: { entries: [] } }
    if (rest === '/media') return { media: { items: [] } }
    if (rest === '/claim' && method === 'POST') return { claim: { claim_status: 'AWAITING_DOCUMENTARY_EVIDENCE' } }
    throw new Error('unexpected path ' + path)
  },
}))

const research = (id: string, extra: Record<string, unknown>) => ({
  seed_dealer_id: id,
  slug: id.toLowerCase(),
  name: 'FICTIONAL CAR DEALER ' + id.slice(-1),
  city: 'Harare',
  category: 'Vehicle sales (research category)',
  source_attribution: 'Fictional Research Source',
  reviewed_at: '2026-11-15T10:00:00Z',
  revision: 3,
  label: 'Unclaimed — Not independently business-verified',
  information_notice: 'CarUp research information may be outdated. This is not a dealer endorsement.',
  claimed: false,
  business_verified: false,
  tier: 'PRELISTED_UNCLAIMED',
  ...extra,
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dealers/:seedId" element={<DealerResearchProfile />} />
        <Route path="/dealers/:seedId/claim" element={<DealerResearchProfile claimMode />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fixture.showroom = true
  fixture.signedIn = false
  fixture.failProfile = false
  fixture.calls = []
  fixture.profiles = {
    'ZW-DEAL-0002': research('ZW-DEAL-0002', {}),
    'ZW-DEAL-0001': research('ZW-DEAL-0001', {
      claimed: true, tier: 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED',
      label: 'Existing approved claim — No current independently verified storefront',
      information_notice: 'A previously approved claimant exists, but current legal, operating or public-display approval cannot be inferred.',
    }),
    // Contradictory: verified flag, research tier → must not unlock the approved storefront view.
    'ZW-DEAL-0007': research('ZW-DEAL-0007', { business_verified: true, tier: 'PRELISTED_UNCLAIMED' }),
    'ZW-DEAL-0008': research('ZW-DEAL-0008', {
      claimed: true, business_verified: true, tier: 'FULL_DEALER_APPROVED',
      label: 'Independently reviewed legal dealership storefront',
      approved_branches: [{ branch_id: 'b1', name: 'Fictional Main Yard', address: '1 Fictional Road, Harare', display_reviewed: true, gps_verified: false }],
    }),
  }
})

describe('DealerResearchProfile — showroom presentation', () => {
  it('shows an unclaimed listing as listed-from-public-sources with a claim-first action and no stock', async () => {
    renderAt('/dealers/zw-deal-0002')
    const page = await screen.findByTestId('dealer-public-profile')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 2' })
    expect(page).toHaveAttribute('data-presentation', 'showroom')
    expect(page).toHaveAttribute('data-standing', 'unclaimed')
    expect(screen.getByTestId('dealer-showroom-standing')).toHaveTextContent('Listed from public sources · not claimed')
    expect(screen.getAllByRole('link', { name: /Claim this dealership/ })[0]).toHaveAttribute('href', '/dealers/zw-deal-0002/claim')
    // Illustration, disclosed, never presented as the premises.
    expect(screen.getByTestId('showroom-floor-scene')).toHaveAttribute('aria-label', expect.stringContaining('not this dealership'))
    expect(screen.getByTestId('scene-disclosure')).toHaveTextContent('Illustration')
    // No storefront: no inventory read, a truthful empty state.
    expect(screen.queryByTestId('dealer-storefront-inventory')).toBeNull()
    expect(screen.getByTestId('dealer-showroom-inventory-empty')).toHaveTextContent('no approved storefront')
    expect(fixture.calls.some(call => call.path.endsWith('/inventory'))).toBe(false)
    // Provenance comes only from returned fields.
    const provenance = screen.getByTestId('dealer-showroom-provenance')
    expect(provenance).toHaveTextContent('Unclaimed — Not independently business-verified')
    expect(provenance).toHaveTextContent('Fictional Research Source')
    expect(provenance).toHaveTextContent('Revision 3')
    expect(screen.getByTestId('dealer-showroom-about')).toHaveTextContent('has not claimed this listing')
    expect(screen.queryByText(/Independently reviewed dealership/)).toBeNull()
  })

  it('shows a claimed listing as not approved and closes the self-service claim', async () => {
    renderAt('/dealers/zw-deal-0001')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 1' })
    expect(screen.getByTestId('dealer-showroom-standing')).toHaveTextContent('Claimed · public display not yet approved')
    expect(screen.getByTestId('dealer-showroom-standing')).toHaveAttribute('data-tone', 'warning')
    expect(screen.queryByRole('link', { name: /Claim this dealership|Start a claim/ })).toBeNull()
    expect(screen.getAllByRole('link', { name: /Request correction, dispute or transfer/ })[0]).toHaveAttribute('href', '/dealers/zw-deal-0001/correction')
  })

  it('never unlocks the approved storefront on a contradictory payload', async () => {
    renderAt('/dealers/zw-deal-0007')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 7' })
    expect(screen.getByTestId('dealer-public-profile')).toHaveAttribute('data-standing', 'unclaimed')
    expect(screen.queryByTestId('dealer-storefront-inventory')).toBeNull()
  })

  it('shows an approved storefront with its reviewed branches and an empty-stock statement from the API', async () => {
    renderAt('/dealers/zw-deal-0008')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 8' })
    expect(screen.getByTestId('dealer-showroom-standing')).toHaveTextContent('Independently reviewed dealership')
    expect(screen.getByTestId('dealer-storefront-inventory')).toBeInTheDocument()
    expect(await screen.findByText('No vehicles from this dealership are currently published on CarUp Marketplace.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reviewed dealership branches' })).toBeInTheDocument()
    expect(screen.getByText('Fictional Main Yard')).toBeInTheDocument()
  })

  it('offers a retry when the profile read fails', async () => {
    fixture.failProfile = true
    renderAt('/dealers/zw-deal-0002')
    expect(await screen.findByRole('heading', { name: 'Dealership profile unavailable' })).toBeInTheDocument()
    fixture.failProfile = false
    fireEvent.click(screen.getByTestId('dealer-profile-retry'))
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 2' })
  })
})

describe('DealerResearchProfile — claim flow in the showroom presentation', () => {
  it('asks a guest to sign in before claiming', async () => {
    renderAt('/dealers/zw-deal-0002/claim')
    expect(await screen.findByTestId('dealer-claim-sign-in')).toHaveAttribute('href', expect.stringContaining('/login'))
    expect(screen.getByTestId('dealer-blank-intake-template')).toHaveAttribute('href', 'http://127.0.0.1:3001/api/dealership/intake/template')
    expect(screen.queryByRole('button', { name: 'Submit evidence-required claim request' })).toBeNull()
  })

  it('submits the same claim request and only says it is recorded, not approved', async () => {
    fixture.signedIn = true
    renderAt('/dealers/zw-deal-0002/claim')
    const form = await screen.findByTestId('dealer-showroom-claim')
    expect(within(form).getByTestId('dealer-unavailable-multi-branch-parent')).toHaveTextContent('Not available yet')
    fireEvent.change(within(form).getByLabelText('Your asserted relationship'), { target: { value: 'DIRECTOR' } })
    fireEvent.change(within(form).getByLabelText('Legal business name (as asserted)'), { target: { value: 'Fictional Car Dealer Ltd' } })
    fireEvent.change(within(form).getByLabelText('Explain your authority to represent the business'), { target: { value: 'I am a fictional director of this fictional test business for this test.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Submit evidence-required claim request' }))
    const recorded = await screen.findByTestId('dealer-showroom-claim-recorded')
    expect(recorded).toHaveTextContent('Request recorded, awaiting documentary proof and independent review.')
    expect(recorded).toHaveAttribute('data-testid', 'dealer-showroom-claim-recorded')
    expect(recorded.className).not.toMatch(/success/)
    const post = fixture.calls.find(call => call.method === 'POST')
    expect(post).toEqual({
      path: '/dealership/research/ZW-DEAL-0002/claim',
      method: 'POST',
      body: {
        claimed_scope: 'BRANCH', representative_relationship: 'DIRECTOR',
        asserted_legal_business_name: 'Fictional Car Dealer Ltd',
        claim_statement: 'I am a fictional director of this fictional test business for this test.',
      },
    })
    await waitFor(() => expect(within(recorded).getByRole('link', { name: 'Open My Claim Applications' })).toHaveAttribute('href', '/dealers/claims'))
  })

  it('shows no claim form for a business that is already claimed', async () => {
    fixture.signedIn = true
    renderAt('/dealers/zw-deal-0001/claim')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 1' })
    expect(screen.queryByTestId('dealer-showroom-claim')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit evidence-required claim request' })).toBeNull()
  })
})

describe('DealerResearchProfile — flag OFF', () => {
  it('keeps the accepted profile composition', async () => {
    fixture.showroom = false
    renderAt('/dealers/zw-deal-0002')
    await screen.findByRole('heading', { level: 1, name: 'FICTIONAL CAR DEALER 2' })
    expect(screen.getByTestId('dealer-public-profile')).not.toHaveAttribute('data-presentation')
    expect(screen.getByTestId('dealer-profile-about')).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-showroom-provenance')).toBeNull()
  })
})

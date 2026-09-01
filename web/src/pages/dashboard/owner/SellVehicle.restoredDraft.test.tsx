/**
 * PR #194 hardening — a seller resuming their OWN listing is never held hostage by the ADVISORY
 * public Passport lookup.
 *
 * Two different reads can say "this vehicle is yours":
 *
 *   1. `fetchOwnedVehicles()` — authenticated, governed, and scoped. If the identifier comes back
 *      inside the seller's own Seller/Garage scope, CarUp has already decided the question.
 *   2. `lookupVehiclePassport()` — the public, rate-limited, audience-gated check. It is advisory
 *      by design and answers only "CarUp holds a Passport", never "this is your vehicle".
 *
 * Before this change the restored-draft path still deferred to (2). While that public read was in
 * flight the seller was pinned at step 0 behind "Wait for the CarUp Passport check to finish", and
 * once it answered `passport_exists` they were offered an authority-claim panel whose buttons could
 * demote the `recognized` authority (1) had already established — after which `reuse_existing_passport`
 * went false and saving their own draft returned 409 until they reloaded the page.
 *
 * These tests hold the advisory lookup PENDING and then resolve it, which is exactly the condition
 * a slow or 429-throttled staging read produces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const lookupVehiclePassport = vi.fn()
const fetchOwnedVehicles = vi.fn()
const updateSellerDraft = vi.fn()
const requestSellerAuthorityClaim = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    lookupVehiclePassport,
    fetchOwnedVehicles,
    updateSellerDraft,
    requestSellerAuthorityClaim,
    createVehicleListing: vi.fn(),
    uploadVehicleImages: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'seller-1', role: 'owner' } }),
}))

vi.mock('@/components/VehicleCompletenessPanel', () => ({
  VehicleCompletenessPanel: () => null,
}))

vi.mock('@/components/seller/SellerWorkspaceHeader', () => ({
  SellerWorkspaceHeader: () => null,
}))

const SellVehicle = (await import('./SellVehicle')).default

const VIN = 'JTDKARFP0H3000731'

/** The seller's own vehicle, as the authenticated Seller scope read returns it. */
const ownedVehicle = {
  vin: VIN,
  make: 'Toyota',
  model: 'Aqua',
  year: 2017,
  color: 'Silver',
  publication_status: 'draft',
  status: 'Available',
  listing_media: { items: [] },
}

const renderResumed = () => render(
  <MemoryRouter initialEntries={[`/dashboard/sell-vehicle?vin=${VIN}`]}>
    <SellVehicle />
  </MemoryRouter>,
)

beforeEach(() => {
  lookupVehiclePassport.mockReset()
  fetchOwnedVehicles.mockReset()
  updateSellerDraft.mockReset()
  requestSellerAuthorityClaim.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  updateSellerDraft.mockResolvedValue({})
  fetchOwnedVehicles.mockResolvedValue([ownedVehicle])
})

describe('restored Seller draft vs the advisory Passport lookup', () => {
  it('does not hold the seller at step 0 while the advisory lookup is still in flight', { timeout: 30_000 }, async () => {
    // The public check never answers — a slow or rate-limited staging read.
    lookupVehiclePassport.mockReturnValue(new Promise(() => {}))

    renderResumed()

    // The authenticated scope read has established that this is the seller's vehicle.
    await waitFor(() => expect(screen.getByTestId('vehicle-vin-input')).toHaveValue(VIN), { timeout: 10_000 })

    const next = screen.getByRole('button', { name: /Next/i })
    expect(next).toBeEnabled()
    expect(next).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText(/Checking vehicle/i)).toBeNull()
    expect(screen.queryByText(/Wait for the CarUp Passport check to finish/i)).toBeNull()
  })

  it('never offers an authority-claim panel that could demote authority already proved', { timeout: 30_000 }, async () => {
    // The advisory lookup answers, correctly, that CarUp holds a Passport for this identifier —
    // it is the seller's OWN vehicle, so of course it does.
    lookupVehiclePassport.mockResolvedValue({
      vehicle: { vin: VIN, make: 'Toyota', model: 'Aqua', year: 2017 },
    })

    renderResumed()
    await waitFor(() => expect(screen.getByTestId('vehicle-vin-input')).toHaveValue(VIN), { timeout: 10_000 })

    // Wait for a POSITIVE signal that the advisory lookup has landed and rendered `passport_exists`
    // — asserting a negative straight away would pass simply by running before the state arrived.
    await screen.findByTestId('sell-vin-passport-confirmed', {}, { timeout: 10_000 })

    // Only now is the absence meaningful. The panel's buttons call requestSellerAuthorityClaim,
    // which on a non-recognized answer or a transport failure sets authorityState to
    // 'evidence_required'/'error'. Nothing restores 'recognized' without a page reload, so offering
    // it here could only ever take away authority the authenticated read had already proved.
    expect(screen.queryByTestId('seller-existing-passport-authority')).toBeNull()
    expect(requestSellerAuthorityClaim).not.toHaveBeenCalled()
  })

  it('still gates a vin the seller merely typed, where no governed scope exists', { timeout: 30_000 }, async () => {
    // The relaxation is scoped to the restored draft. A seller who types an identifier CarUp
    // already holds must still confirm it and declare their authority — that gate is the reason
    // duplicate Passports stopped being created, and it stays.
    fetchOwnedVehicles.mockResolvedValue([])
    lookupVehiclePassport.mockReturnValue(new Promise(() => {}))

    render(
      <MemoryRouter initialEntries={['/dashboard/sell-vehicle']}>
        <SellVehicle />
      </MemoryRouter>,
    )

    const input = await screen.findByTestId('vehicle-vin-input', {}, { timeout: 10_000 })
    expect(input).toBeEnabled()
    expect(input).toHaveValue('')
  })
})

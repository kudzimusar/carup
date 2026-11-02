/**
 * PC01-J-R1 (Owner Usability Checkpoint 1) — an explicit `?vin=` names a listing the account
 * already holds, and the account's copy is the authority for it.
 *
 * Every link that carries `?vin=` into the Seller workspace comes from a server-known vehicle: My
 * Listings, My Garage, the Vehicle Profile, the Passport and the post-save redirect. The browser,
 * meanwhile, keeps a crash-recovery copy of whatever was last on this form. Before this change that
 * copy won: the first visit to `/dashboard/sell-vehicle?vin=GFC27-027051` loaded the owner's Serena
 * from the account and then wrote it into the guest browser draft, so every reload or revisit
 * reopened it as "Your guest preview has been restored" — the account listing, its canonical
 * identity lock and its publication readiness all gone, with nothing to say why.
 *
 * The same write also carried the listing's private identifiers (engine, chassis and plate numbers)
 * into durable, unscoped browser storage that survives sign-out and is offered back on the public
 * Sell page. An account listing already has a governed home — the account — so it is not copied
 * into the guest draft at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  GUEST_SELL_DRAFT_KEY,
  GUEST_SELL_DURABLE_DRAFT_KEY,
  saveGuestSellDraft,
  saveGuestSellStep,
  type GuestSellDraft,
} from '@/lib/guestSellDraft'

const lookupVehiclePassport = vi.fn()
const fetchOwnedVehicles = vi.fn()
const updateSellerDraft = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    lookupVehiclePassport,
    fetchOwnedVehicles,
    updateSellerDraft,
    requestSellerAuthorityClaim: vi.fn(),
    createVehicleListing: vi.fn(),
    uploadVehicleImages: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'u_owner', role: 'owner' } }),
}))

vi.mock('@/components/VehicleCompletenessPanel', () => ({
  VehicleCompletenessPanel: () => null,
}))

vi.mock('@/components/seller/SellerWorkspaceHeader', () => ({
  SellerWorkspaceHeader: () => null,
}))

const SellVehicle = (await import('./SellVehicle')).default

const VIN = 'GFC27-027051'

/** The owner's listing exactly as the authenticated Seller scope read returns it. */
const accountListing = {
  vin: VIN,
  make: 'Nissan',
  model: 'Serena Highway Star',
  year: 2016,
  color: 'Maroon',
  mileage: 63000,
  price: 12800,
  currency: 'USD',
  status: 'Available',
  publication_status: 'publishable',
  engine_number: 'MR20-ENGINE-ON-ACCOUNT',
  chassis_number: VIN,
  listing_city: 'Harare',
  listing_media: { items: [] },
}

function browserDraft(overrides: Partial<GuestSellDraft>): GuestSellDraft {
  return {
    version: 1,
    saved_at: '2026-10-10T15:44:00.000Z',
    submissionId: '6f1c2b8e-1d2a-4c7e-9a51-6c0d6a3b1f00',
    make: '',
    model: '',
    year: '',
    vin: '',
    color: '',
    mileage: '',
    condition: '',
    category: '',
    fuelType: '',
    transmission: '',
    drivetrain: '',
    location: '',
    province: '',
    price: '',
    currency: 'USD',
    description: '',
    engineNumber: '',
    chassisNumber: '',
    plateNumber: '',
    tempPlateId: '',
    registrationStatus: '',
    features: [],
    images: [],
    imageLabels: [],
    coverImageIndex: null,
    historyPlan: {},
    existingPassportConfirmed: false,
    mediaExternalized: false,
    accidentDisclosure: null,
    insuranceDisclosure: null,
    financeDisclosure: null,
    ...overrides,
  }
}

const openListing = () => render(
  <MemoryRouter initialEntries={[`/dashboard/sell-vehicle?vin=${VIN}`]}>
    <SellVehicle />
  </MemoryRouter>,
)

beforeEach(() => {
  lookupVehiclePassport.mockReset()
  fetchOwnedVehicles.mockReset()
  updateSellerDraft.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  lookupVehiclePassport.mockReturnValue(new Promise(() => {}))
  updateSellerDraft.mockResolvedValue({})
  fetchOwnedVehicles.mockResolvedValue([accountListing])
})

describe('an explicit ?vin= opens the account listing, never a browser copy', () => {
  it('reopens the account listing when the browser holds a recovery copy of the SAME vehicle', { timeout: 30_000 }, async () => {
    // What the first visit left behind: the listing's own facts, written into the guest draft.
    await saveGuestSellDraft(browserDraft({ vin: VIN, make: 'Nissan', model: 'Serena Highway Star', year: '2016', price: '12800' }))
    saveGuestSellStep(2)

    openListing()

    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    expect(fetchOwnedVehicles).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('seller-guest-draft-loaded')).toBeNull()
    expect(screen.getByTestId('vehicle-vin-input')).toHaveValue(VIN)
  })

  it('reopens the requested listing when the browser holds a draft for ANOTHER vehicle', { timeout: 30_000 }, async () => {
    await saveGuestSellDraft(browserDraft({ vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Aqua', year: '2017' }))
    saveGuestSellStep(3)

    openListing()

    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    expect(screen.queryByTestId('seller-guest-draft-loaded')).toBeNull()
    expect(screen.getByTestId('vehicle-vin-input')).toHaveValue(VIN)
  })

  it('does not copy an account listing (or its private identifiers) into the guest browser draft', { timeout: 30_000 }, async () => {
    openListing()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })

    // The recovery writer debounces at 300 ms; give it well over that to have run if it is going to.
    await new Promise(resolve => setTimeout(resolve, 900))

    expect(localStorage.getItem(GUEST_SELL_DURABLE_DRAFT_KEY)).toBeNull()
    expect(sessionStorage.getItem(GUEST_SELL_DRAFT_KEY)).toBeNull()
    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(everything).not.toContain('MR20-ENGINE-ON-ACCOUNT')
  })

  it('says plainly when the account does not hold the requested vehicle', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([])
    // A browser copy for that identifier must not be presented as if it were the account listing.
    await saveGuestSellDraft(browserDraft({ vin: VIN, make: 'Nissan', model: 'Serena Highway Star' }))

    openListing()

    expect(await screen.findByText('Seller listing unavailable', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.queryByTestId('seller-guest-draft-loaded')).toBeNull()
  })
})

describe('the guest hand-off still restores a guest draft', () => {
  it('restores the browser draft when no listing is named', { timeout: 30_000 }, async () => {
    await saveGuestSellDraft(browserDraft({ vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Aqua', year: '2017' }))

    render(
      <MemoryRouter initialEntries={['/dashboard/sell-vehicle']}>
        <SellVehicle />
      </MemoryRouter>,
    )

    await screen.findByTestId('seller-guest-draft-loaded', {}, { timeout: 10_000 })
    expect(fetchOwnedVehicles).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('vehicle-vin-input')).toHaveValue('JTDKARFP0H3000731'))
  })
})

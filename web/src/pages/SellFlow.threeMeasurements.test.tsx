/**
 * Seller Journey 1.0 / S7 — three measurements, three blocks, never collapsed.
 *
 * Invariant 6: Publication Readiness ≠ Listing Quality ≠ Canonical Trust. Before S7 the seller saw
 * only Publication Readiness, so there was nothing to collapse — and the risk arrives with the
 * second block, because a percentage shown beside a car is read as a verdict on the car unless the
 * page says otherwise.
 *
 * These tests render the real post-save screen and hold the separation as something visible:
 * distinct blocks, each stating its own scope, with the Listing Quality block never borrowing
 * verification vocabulary and Canonical Trust never restated as a seller-side number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const createVehicleListing = vi.fn()
const uploadVehicleImages = vi.fn()
const lookupVehiclePassport = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ createVehicleListing, uploadVehicleImages, lookupVehiclePassport }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'seller-1', name: 'Seller', email: 'seller@carup.dev', role: 'owner' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
// The publication-requirements panel fetches its own governed data; this suite's subject is the
// SEPARATION of the blocks, not that panel's contents, which its own suite owns.
vi.mock('@/components/VehicleCompletenessPanel', () => ({
  VehicleCompletenessPanel: () => <div data-testid="post-save-completeness">Publication requirements</div>,
}))

const SellVehicle = (await import('./dashboard/owner/SellVehicle')).default

const VIN = 'JTDKARFP0H3000731'

function seedDraft() {
  sessionStorage.setItem('carup_guest_sell_draft_v1', JSON.stringify({
    version: 1,
    saved_at: new Date().toISOString(),
    make: 'Toyota', model: 'Hilux', year: '2021', vin: VIN, color: 'White',
    mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel',
    transmission: 'Automatic', drivetrain: '4WD', location: 'Harare', province: 'Harare',
    price: '28500', currency: 'USD', description: 'x'.repeat(60),
    engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
    features: [], images: [],
  }))
}

/** Walk the claimed draft through to the saved state where all three blocks render. */
async function reachSavedState() {
  seedDraft()
  render(<MemoryRouter><SellVehicle /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('sell-vin-no-carup-record')).toBeTruthy(), { timeout: 3000 })
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('seller-privacy-controls')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('submit-vehicle-button')).toBeTruthy())
  fireEvent.click(screen.getByTestId('submit-vehicle-button'))
  await waitFor(() => expect(screen.getByTestId('listing-quality-panel')).toBeTruthy())
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  sessionStorage.clear()
  lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
  uploadVehicleImages.mockResolvedValue({ urls: [] })
  createVehicleListing.mockResolvedValue({
    vin: VIN,
    submission_id_recorded: true,
    idempotent_replay: false,
  })
})

describe('S7 the three measurements stay three', () => {
  it('renders all three as distinct blocks', async () => {
    await reachSavedState()
    expect(screen.getByTestId('post-save-completeness')).toBeTruthy()
    expect(screen.getByTestId('listing-quality-panel')).toBeTruthy()
    expect(screen.getByTestId('canonical-trust-pointer')).toBeTruthy()
  })

  it('states what Listing Quality is and what it is not', async () => {
    await reachSavedState()
    const scope = screen.getByTestId('listing-quality-scope').textContent || ''
    expect(scope).toContain('How strong your advertisement is')
    expect(scope).toContain('separate from whether CarUp can publish')
    expect(scope).toContain('separate again from what CarUp has verified')
  })

  it('never lets Listing Quality borrow verification language', async () => {
    await reachSavedState()
    const panel = screen.getByTestId('listing-quality-panel').textContent || ''
    // "verified" appears only in the sentence that DISCLAIMS it; no badge, band or suggestion may
    // assert verification. The band is checked directly for the same reason.
    expect(screen.getByTestId('listing-quality-band').textContent?.toLowerCase())
      .not.toMatch(/verified|trusted|certified|gold/)
    expect(panel).not.toMatch(/CarUp has verified this vehicle|Trust score/)
  })

  it('points to Canonical Trust rather than restating it as a seller-side number', async () => {
    await reachSavedState()
    const trustBlock = screen.getByTestId('canonical-trust-pointer').textContent || ''
    expect(trustBlock).toContain('Canonical Trust is measured separately')
    expect(trustBlock).toContain('Neither block above is a Trust score')
    // A number here would be a second copy of a position that only canonicalTrustService may
    // publish, and a copy is how a score drifts from its own calculation_version.
    expect(trustBlock).not.toMatch(/\d+\s*%/)
    expect(trustBlock).not.toMatch(/\b(score|band)\s*[:=]/i)
  })

  it('marks quality suggestions as recommendations, distinct from publication blockers', async () => {
    await reachSavedState()
    // This listing has no photos and a short description, so suggestions must be present.
    const suggestions = screen.getByTestId('listing-quality-suggestions').textContent || ''
    expect(suggestions).toContain('These are recommendations. None of them blocks publication.')
  })
})

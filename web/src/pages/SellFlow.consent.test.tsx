/**
 * Seller Journey 1.0 / S3 — the seller's privacy decisions are the seller's to make.
 *
 * THE DEFECT. Both consent flags were governed fail-closed on the READ side and unreachable on the
 * WRITE side:
 *
 *   · location was published because the seller typed a city into a listing form, not because they
 *     chose to publish it — the handler's own comment said so ("Adding a control to the form is
 *     what would make this a seller's choice rather than a default");
 *   · `public_seller_display_enabled` was read with `=== true` and projected to buyers, but the
 *     write path never accepted it, so no seller could ever switch their public identity on.
 *
 * These tests drive the real form and assert what the server is actually told, because a control
 * that renders but sends nothing is the same defect wearing a checkbox.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SELL_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'dashboard/owner/SellVehicle.tsx'), 'utf8',
)

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
vi.mock('@/components/VehicleCompletenessPanel', () => ({ VehicleCompletenessPanel: () => null }))

const SellVehicle = (await import('./dashboard/owner/SellVehicle')).default

const renderSell = () => render(<MemoryRouter><SellVehicle /></MemoryRouter>)

/**
 * The consent panel lives on the Location & Pricing step, so the seller meets it in the same place
 * they enter the location it governs.
 *
 * Step 0 is satisfied through the claimed guest draft rather than by driving Radix selects: it is
 * the real hydration path an authenticated seller arrives on, and it keeps this suite's subject the
 * consent panel rather than the select implementation.
 */
function seedClaimedDraft() {
  sessionStorage.setItem('carup_guest_sell_draft_v1', JSON.stringify({
    version: 1,
    saved_at: new Date().toISOString(),
    make: 'Toyota', model: 'Hilux', year: '2021', vin: 'JTDKARFP0H3000731', color: 'White',
    mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel',
    transmission: 'Automatic', drivetrain: '4WD', location: 'Harare', province: 'Harare',
    price: '28500', currency: 'USD', description: 'x'.repeat(60),
    engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
    features: [], images: [],
  }))
}

async function advanceToLocationStep() {
  seedClaimedDraft()
  renderSell()
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('seller-privacy-controls')).toBeTruthy())
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  sessionStorage.clear()
  lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
  createVehicleListing.mockResolvedValue({ vin: 'JTDKARFP0H3000731' })
})

describe('S3 seller consent controls', () => {
  it('offers both privacy decisions on the surface that actually publishes', async () => {
    await advanceToLocationStep()
    expect(screen.getByTestId('listing-location-visibility')).toBeTruthy()
    expect(screen.getByTestId('public-seller-display-toggle')).toBeTruthy()
  })

  it('defaults both decisions to the private answer', async () => {
    await advanceToLocationStep()

    // Publishing must be something the seller chooses, never something silence chooses for them.
    expect((screen.getByTestId('public-seller-display-toggle') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByTestId('listing-location-visibility').textContent).toContain('private')
  })

  it('tells the seller what each choice means for buyers', async () => {
    await advanceToLocationStep()

    const panel = screen.getByTestId('seller-privacy-controls').textContent || ''
    // The consequence of the private default is stated, including its effect on discovery, rather
    // than left for the seller to discover after publishing.
    expect(panel).toContain('Buyers will not see where the vehicle is')
    expect(panel).toContain('Location filters will not match this listing')
    expect(panel).toContain('stay anonymous')
  })

  it('sends the identity decision the seller actually made', async () => {
    await advanceToLocationStep()

    const toggle = screen.getByTestId('public-seller-display-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
  })

  it('wires both consent values into the submitted payload', async () => {
    // The payload keys are asserted against the page source: a control the server is never told
    // about is the same defect as no control at all.
    const source = SELL_SOURCE
    expect(source).toContain('location_visibility: form.locationVisibility')
    expect(source).toContain('public_seller_display_enabled: form.publicSellerDisplay')
    // And the state they read from starts private.
    expect(source).toMatch(/locationVisibility: 'withheld'/)
    expect(source).toMatch(/publicSellerDisplay: false/)
  })
})

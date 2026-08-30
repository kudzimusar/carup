/**
 * Seller Journey 1.0 / S4 — Listing Media Studio: the cover photo is a seller's choice.
 *
 * THE DEFECT (S0-P0-09). The backend's media-primacy contract is exact: a bare URL string claims
 * nothing, `{ url, is_primary: true }` is the seller's explicit choice, and two claimants are
 * refused with a 400 rather than resolved by guessing. Its own comment records why — electing a
 * primary server-side "would be the same fabrication as `idx === 0`, just with more steps".
 *
 * The form then did exactly that fabrication in the other direction: it painted a **"Cover"** badge
 * on whichever photo happened to be first and submitted bare URL strings. So the seller was shown a
 * cover choice that was never made, never sent and never stored — the listing had no primary photo
 * at all, and the badge was a claim about CarUp's data that CarUp's data did not support.
 *
 * What this suite holds:
 *   - the seller picks the cover explicitly, and the picked photo is the one submitted as primary;
 *   - exactly one photo can claim primacy, matching the server's contract rather than testing a
 *     different one;
 *   - with no choice made, NOTHING claims primacy — the honest reading of a question not answered;
 *   - removing the chosen cover clears the choice instead of silently sliding it to another photo.
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

const PHOTOS = [
  'data:image/png;base64,front',
  'data:image/png;base64,rear',
  'data:image/png;base64,interior',
]

/** A complete draft plus photos, so the media step is reachable without driving Radix selects. */
function seedDraft(images: string[]) {
  sessionStorage.setItem('carup_guest_sell_draft_v1', JSON.stringify({
    version: 1,
    saved_at: new Date().toISOString(),
    make: 'Toyota', model: 'Hilux', year: '2021', vin: 'JTDKARFP0H3000731', color: 'White',
    mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel',
    transmission: 'Automatic', drivetrain: '4WD', location: 'Harare', province: 'Harare',
    price: '28500', currency: 'USD', description: 'x'.repeat(60),
    engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
    features: [], images,
  }))
}

async function advanceToMediaStep(images = PHOTOS) {
  seedDraft(images)
  render(<MemoryRouter><SellVehicle /></MemoryRouter>)
  // The first step intentionally waits for the existing-Passport lookup to resolve. The test's
  // no-record mock must therefore become visible before it asks the form to advance.
  await waitFor(() => expect(screen.getByTestId('sell-vin-no-carup-record')).toBeTruthy(), { timeout: 3000 })
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('seller-privacy-controls')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('listing-media-grid')).toBeTruthy())
}

/** Submit from the media step and return the images array the server was actually sent. */
async function submitAndReadImages() {
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await waitFor(() => expect(screen.getByTestId('submit-vehicle-button')).toBeTruthy())
  fireEvent.click(screen.getByTestId('submit-vehicle-button'))
  await waitFor(() => expect(createVehicleListing).toHaveBeenCalled())
  return createVehicleListing.mock.calls[0][0].images
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  sessionStorage.clear()
  lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
  // Echoes the order it was handed, as the real endpoint does: it maps each submitted image to a
  // URL in sequence. A mock returning a fixed array would silently defeat any ordering assertion.
  uploadVehicleImages.mockImplementation(async (_vin: string, images: string[]) => ({ urls: images }))
  createVehicleListing.mockResolvedValue({ vin: 'JTDKARFP0H3000731' })
})

describe('S4 seller-chosen cover photo', () => {
  it('claims no cover until the seller picks one', async () => {
    await advanceToMediaStep()
    // The badge that used to sit on photo 0 asserted a choice nobody made.
    expect(screen.queryByTestId('listing-media-cover-badge-0')).toBeNull()
    expect(screen.getByTestId('listing-media-grid').textContent).toContain('No cover photo chosen')
  })

  it('lets the seller choose the cover and marks only that photo', async () => {
    await advanceToMediaStep()
    fireEvent.click(screen.getByTestId('listing-media-choose-cover-1'))

    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-1')).toBeTruthy())
    expect(screen.queryByTestId('listing-media-cover-badge-0')).toBeNull()
    expect(screen.queryByTestId('listing-media-cover-badge-2')).toBeNull()
  })

  it('removing the chosen cover clears the choice rather than sliding it to another photo', async () => {
    await advanceToMediaStep()
    fireEvent.click(screen.getByTestId('listing-media-choose-cover-1'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('listing-media-remove-1'))

    await waitFor(() => expect(screen.getByTestId('listing-media-grid').textContent).toContain('No cover photo chosen'))
    // Sliding the badge onto whatever took index 1 would re-fabricate the choice.
    expect(screen.queryByTestId('listing-media-cover-badge-0')).toBeNull()
    expect(screen.queryByTestId('listing-media-cover-badge-1')).toBeNull()
  })

  it('submits exactly the chosen photo as primary, in the shape the server contract defines', async () => {
    await advanceToMediaStep()
    fireEvent.click(screen.getByTestId('listing-media-choose-cover-1'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-1')).toBeTruthy())

    const images = await submitAndReadImages()

    // The server reads `is_primary === true` as the claim and refuses two claimants with a 400, so
    // exactly one entry may carry it — and it must be the one the seller picked.
    const claimants = images.filter((entry: unknown) => typeof entry === 'object' && entry !== null && (entry as { is_primary?: unknown }).is_primary === true)
    expect(claimants).toHaveLength(1)
    expect(images[1]).toEqual({ url: PHOTOS[1], is_primary: true })
    // Unchosen photos stay bare URLs — a string claims nothing.
    expect(typeof images[0]).toBe('string')
    expect(typeof images[2]).toBe('string')
  })

  it('submits no primacy claim at all when the seller chose no cover', async () => {
    await advanceToMediaStep()
    const images = await submitAndReadImages()

    // A question the seller did not answer must not be answered for them on the way out.
    expect(images).toEqual(PHOTOS)
    expect(images.every((entry: unknown) => typeof entry === 'string')).toBe(true)
  })

  it('recommends the buyer shot list without turning a suggestion into a claim', async () => {
    await advanceToMediaStep()
    const guidance = screen.getByTestId('listing-media-guidance').textContent || ''
    for (const shot of ['Front', 'Rear', 'Odometer', 'Any known damage']) {
      expect(guidance).toContain(shot)
    }
    // Guidance must not read as a requirement, and must never imply CarUp verified any of it.
    expect(guidance).toContain('All optional')
    expect(guidance.toLowerCase()).not.toMatch(/verified|required|proof|certified/)
  })

  it('reorders photos with keyboard-operable controls, not mouse-only drag', async () => {
    await advanceToMediaStep()
    // Drag alone is not an accessible reorder. Buttons are operable by keyboard and by assistive
    // technology, and they are what this asserts on.
    const moveEarlier = screen.getByTestId('listing-media-move-earlier-1')
    expect(moveEarlier.getAttribute('aria-label')).toBeTruthy()
    fireEvent.click(moveEarlier)

    const images = await submitAndReadImages()
    // Photo 1 moved ahead of photo 0; stored order is the submitted array order.
    expect(images[0]).toBe(PHOTOS[1])
    expect(images[1]).toBe(PHOTOS[0])
    expect(images[2]).toBe(PHOTOS[2])
  })

  it('reordering carries the chosen cover with the photo, not with the position', async () => {
    await advanceToMediaStep()
    fireEvent.click(screen.getByTestId('listing-media-choose-cover-2'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-2')).toBeTruthy())

    // Move the covered photo one step earlier. The COVER must follow the photo.
    fireEvent.click(screen.getByTestId('listing-media-move-earlier-2'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-1')).toBeTruthy())
    expect(screen.queryByTestId('listing-media-cover-badge-2')).toBeNull()

    const images = await submitAndReadImages()
    // The seller's chosen photo is still the primary, at its new position.
    expect(images[1]).toEqual({ url: PHOTOS[2], is_primary: true })
    expect(typeof images[0]).toBe('string')
    expect(typeof images[2]).toBe('string')
  })

  it('moving an unrelated photo leaves the cover on the same photo', async () => {
    await advanceToMediaStep()
    fireEvent.click(screen.getByTestId('listing-media-choose-cover-0'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-0')).toBeTruthy())

    // Swap photos 1 and 2. Photo 0 is untouched, so the cover must not move.
    fireEvent.click(screen.getByTestId('listing-media-move-earlier-2'))
    await waitFor(() => expect(screen.getByTestId('listing-media-cover-badge-0')).toBeTruthy())

    const images = await submitAndReadImages()
    expect(images[0]).toEqual({ url: PHOTOS[0], is_primary: true })
  })

  it('offers no move control past either end', async () => {
    await advanceToMediaStep()
    expect(screen.queryByTestId('listing-media-move-earlier-0')).toBeNull()
    expect(screen.queryByTestId(`listing-media-move-later-${PHOTOS.length - 1}`)).toBeNull()
  })

  it('keeps every photo control reachable and unambiguous for a keyboard user', async () => {
    await advanceToMediaStep()
    // Each control names WHICH photo it acts on. Three buttons all reading "Make cover" would be
    // indistinguishable to a screen reader, which is the state this asserts against.
    expect(screen.getByTestId('listing-media-choose-cover-1').getAttribute('aria-label'))
      .toBe('Make photo 2 the cover photo')
    expect(screen.getByTestId('listing-media-remove-1').getAttribute('aria-label'))
      .toBe('Remove listing photo 2')

    // Hover-only visibility hides a focused control from the person using it. Every control in the
    // cluster must also reveal itself on focus.
    for (const testId of ['listing-media-choose-cover-1', 'listing-media-remove-1']) {
      expect(screen.getByTestId(testId).className).toContain('focus:opacity-100')
    }
    expect(screen.getByTestId('listing-media-move-earlier-1').parentElement?.className)
      .toContain('focus-within:opacity-100')
  })

  it('never fabricates primacy from a position', () => {
    // The defect this phase removed was a claim derived from an index. Guard the shape of the fix
    // itself so it cannot quietly return.
    expect(SELL_SOURCE).toMatch(/index === coverImageIndex/)
    expect(SELL_SOURCE).not.toMatch(/is_primary:\s*(index|i)\s*===\s*0/)
  })
})

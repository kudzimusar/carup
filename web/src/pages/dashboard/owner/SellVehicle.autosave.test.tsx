/**
 * T11-CAP-LR01-R3 (Moderator D-1) — VIEW != EDIT in the Seller Studio.
 *
 * THE DEFECT. Opening a listing the seller already had made the Studio PATCH the unchanged form back to the vehicle row 1200 ms
 * after it loaded, and the server stamped `seller_listing_recorded_at` / `listing_location_recorded_at` on that PATCH. Looking at
 * a vehicle recorded that its owner had "entered" a listing: the never-listed Honda Vezel acquired Seller business state that way.
 *
 * THE RULE (Moderator, D-1(a)). Opening an existing draft without changing Seller data performs ZERO Seller PATCH writes. The
 * comparison is between the autosave payload and what the server is known to hold — not mount state, not elapsed time, not
 * `serverDraftLoaded`, not "the first autosave". A successful save becomes the new baseline. The existing revision protection is
 * kept, and a guest or brand-new listing is untouched.
 *
 * These tests drive the real Studio with the real clock logic (only setTimeout is faked) and count the PATCHes the server would see.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 15_000 })

const api = vi.hoisted(() => ({
  createVehicleListing: vi.fn(),
  updateSellerDraft: vi.fn(),
  uploadVehicleImages: vi.fn(),
  requestSellerAuthorityClaim: vi.fn(),
  fetchOwnedVehicles: vi.fn(),
  fetchGovernedMedia: vi.fn(),
  lookupVehiclePassport: vi.fn(),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'seller-1', name: 'Kingston Musarurwa', email: 'seller@carup.dev', role: 'owner' }, isAuthenticated: true, loading: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/VehicleCompletenessPanel', () => ({ VehicleCompletenessPanel: () => null }))

const SellVehicle = (await import('./SellVehicle')).default

const SERENA_VIN = 'GFC27-027051'
const VEZEL_VIN = 'RU3-1316558'

/** A published Seller listing, shaped like the real row the garage read returns for it. */
const serena = (over: Record<string, unknown> = {}) => ({
  vin: SERENA_VIN, make: 'Nissan', model: 'Serena', year: 2016, color: 'White', mileage: 52000,
  seller_stated_condition: 'Used', body_style: 'Minivan', fuel_type: 'Hybrid', transmission: 'Automatic', drivetrain: '2WD',
  listing_city: 'Harare', listing_province: 'Harare', listing_location_visibility: 'public', public_seller_display_enabled: true,
  price: 12800, currency: 'USD', seller_description: 'A clean, well kept minivan. '.repeat(10), seller_features: ['Clean', 'Hybrid', '2016'],
  engine_number: 'ENG-1', chassis_number: SERENA_VIN, status: 'Available', publication_status: 'published', listing_media: { items: [] },
  ...over,
})

/** An import that was never listed: draft by column default, no price, no currency, no description, no features. */
const vezel = (over: Record<string, unknown> = {}) => ({
  vin: VEZEL_VIN, make: 'Honda', model: 'Vezel', year: 2018, color: 'Pearl', mileage: 40000,
  price: 0, currency: null, seller_description: null, seller_features: [], listing_city: null, listing_province: null,
  status: 'Pending', publication_status: 'draft', listing_media: { items: [] },
  ...over,
})

/** What the server echoes for an accepted autosave: exactly the fields it was sent. */
const accept = (payload: Record<string, unknown>) => ({
  success: true,
  draft: {
    description: '', features: [], body_style: '', seller_stated_condition: '', price: null, currency: '', location: '', province: '',
    listing_country: '', location_visibility: 'withheld', public_seller_display_enabled: false, ...payload,
  },
})

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

/**
 * Testing Library's own async helpers (findBy*, waitFor) finish by awaiting a REAL zero-delay timeout, which a faked setTimeout never
 * releases, so they would hang here. Promises are real, so polling through act reaches the same place.
 */
async function until(condition: () => unknown, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return
    await flush()
  }
  throw new Error('The Studio never reached the expected state.')
}

async function openStudio(row: Record<string, unknown>, query = '') {
  api.fetchOwnedVehicles.mockResolvedValue([row])
  render(
    <MemoryRouter initialEntries={[`/dashboard/sell-vehicle?vin=${encodeURIComponent(String(row.vin))}${query}`]}>
      <SellVehicle />
    </MemoryRouter>,
  )
  await until(() => screen.queryByTestId('seller-server-draft-loaded'))
  await flush()
}

const autosaveText = () => screen.getByTestId('seller-server-autosave-state').textContent
const IDLE = 'Account draft loaded. Changes will autosave after you pause.'
const SAVED = 'Commercial draft changes saved to your account.'

/** The Location & Pricing stage holds the seller's public-identity consent: a real Seller edit, one click. */
async function goToPrivacyControls() {
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  await flush()
  return screen.getByTestId('public-seller-display-toggle') as HTMLInputElement
}
const toggle = async (box: HTMLInputElement) => { fireEvent.click(box); await flush() }

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  // The Studio keeps a crash-recovery copy of what it shows in the BROWSER (session and local storage). A copy left by the previous test
  // would be picked up as a guest draft, and a guest draft takes precedence over loading the account's own — so clear both.
  sessionStorage.clear()
  localStorage.clear()
  // ONLY setTimeout/clearTimeout are faked, as in the other Sell tests: promises and React's scheduler stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  api.lookupVehiclePassport.mockRejectedValue(new Error('404 VIN not found'))
  api.fetchGovernedMedia.mockResolvedValue(null)
  api.updateSellerDraft.mockImplementation(async (_vin: string, payload: Record<string, unknown>) => accept(payload))
})
afterEach(() => { vi.useRealTimers() })

describe('opening a draft is a read', () => {
  it('a published Seller listing, opened and left alone, is never written to', async () => {
    await openStudio(serena())
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
    expect(autosaveText()).toBe(IDLE)
  })

  it('a never-listed import (the Vezel), opened and left alone, is never written to', async () => {
    await openStudio(vezel())
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
    expect(autosaveText()).toBe(IDLE)
  })

  it('moving between stages is not an edit', async () => {
    await openStudio(vezel())
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await advance(3_000)
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
  })

  it('arriving straight at the review stage is not an edit either', async () => {
    await openStudio(serena(), '&stage=review')
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['a price stored as text zero and a currency stored as an empty string', { price: '0', currency: '' }],
    ['null seller features and no listing-location columns at all', { seller_features: null, listing_city: undefined, listing_province: undefined }],
    ['a stored consent flag that is not a boolean', { public_seller_display_enabled: 'yes', listing_location_visibility: 'nonsense' }],
    ['disclosures that fail to parse (hydrated as unanswered, never repaired)', { seller_accident_disclosure: { garbage: true }, seller_insurance_disclosure: 7, seller_finance_disclosure: [] }],
    ['null mileage, null colour fallbacks and legacy aliases', { mileage: null, features: ['legacy'], description: 'legacy copy', location: 'Bulawayo', province: 'Bulawayo' }],
  ])('hydration of %s creates no false dirty state', async (_name, over) => {
    await openStudio(vezel(over))
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
  })

  it('a row that already carries legacy values and a stated price reads clean too', async () => {
    await openStudio(serena({ seller_description: null, description: 'legacy description', seller_features: undefined, features: ['Roof rails'], location: 'Mutare', listing_city: null }))
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
  })
})

describe('an edit is written — once, with what was changed', () => {
  it('a real edit produces exactly one PATCH carrying the intended payload', async () => {
    await openStudio(serena())
    const box = await goToPrivacyControls()
    expect(box.checked).toBe(true)
    await toggle(box)
    expect(autosaveText()).toBe(IDLE)
    await advance(1_199)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
    await advance(1)
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
    const [vin, payload] = api.updateSellerDraft.mock.calls[0]
    expect(vin).toBe(SERENA_VIN)
    expect(payload).toEqual({
      description: 'A clean, well kept minivan. '.repeat(10), features: ['Clean', 'Hybrid', '2016'], body_style: 'Minivan',
      seller_stated_condition: 'Used', price: 12800, currency: 'USD', location: 'Harare', province: 'Harare',
      location_visibility: 'public', public_seller_display_enabled: false,
    })
    await flush()
    expect(autosaveText()).toBe(SAVED)
  })

  it('the first edit of a never-listed import is written too — the guard never swallows a real edit', async () => {
    await openStudio(vezel())
    await toggle(await goToPrivacyControls())
    await advance(1_300)
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
    expect(api.updateSellerDraft.mock.calls[0][1]).toEqual({
      description: '', features: [], body_style: '', seller_stated_condition: '', location: '', province: '',
      location_visibility: 'withheld', public_seller_display_enabled: true,
    })
  })

  it('a change that is undone before the pause is no change at all', async () => {
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(500)
    await toggle(box)
    await advance(10_000)
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
    expect(autosaveText()).toBe(IDLE)
  })

  it('a successful save becomes the baseline: the unchanged payload is not sent again', async () => {
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(1_300)
    await flush()
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
    // Nothing the seller does that does not change a saved field writes again: stages, time.
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    await advance(10_000)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await advance(10_000)
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
  })

  it('after a save, a change that is undone before the pause is again no change — the baseline is what was saved', async () => {
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)            // true -> false
    await advance(1_300)
    await flush()
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
    await toggle(box)            // false -> true (differs from what was saved)…
    await advance(500)
    await toggle(box)            // …and back to false, before the pause: identical to what the server holds.
    await advance(10_000)
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(1)
  })

  it('and the baseline moves: undoing a SAVED edit is itself a write', async () => {
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(1_300)
    await flush()
    await toggle(box)
    await advance(1_300)
    await flush()
    expect(api.updateSellerDraft).toHaveBeenCalledTimes(2)
    expect(api.updateSellerDraft.mock.calls[1][1].public_seller_display_enabled).toBe(true)
    expect(autosaveText()).toBe(SAVED)
  })
})

describe('the revision protection is intact', () => {
  /** Hold a PATCH open so the test decides when (and whether) its response arrives. */
  const held = () => {
    const calls: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void; payload: Record<string, unknown> }> = []
    api.updateSellerDraft.mockImplementation((_vin: string, payload: Record<string, unknown>) => new Promise((resolve, reject) => {
      calls.push({ resolve, reject, payload })
    }))
    return calls
  }

  it('a slow earlier PATCH cannot mark a newer dirty form saved', async () => {
    const calls = held()
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(1_300)
    expect(calls).toHaveLength(1)
    // …a newer edit lands while the first PATCH is still travelling…
    await toggle(box)
    expect(autosaveText()).toBe(IDLE)
    // …and the older one finally comes back successful. It must not claim the newer state is saved.
    await act(async () => { calls[0].resolve(accept(calls[0].payload)) })
    expect(autosaveText()).not.toBe(SAVED)
  })

  it('undoing an edit whose PATCH is still in flight is itself written — the edit must not outlive its undo', async () => {
    const calls = held()
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(1_300)
    expect(calls).toHaveLength(1)
    expect(calls[0].payload.public_seller_display_enabled).toBe(false)
    // The seller changes their mind. The form now equals what was loaded — but the edited payload may already be on the server.
    await toggle(box)
    await advance(1_300)
    expect(calls).toHaveLength(2)
    expect(calls[1].payload.public_seller_display_enabled).toBe(true)
    // Both settle; only the current revision is believed.
    await act(async () => { calls[0].resolve(accept(calls[0].payload)); calls[1].resolve(accept(calls[1].payload)) })
    expect(autosaveText()).toBe(SAVED)
    await advance(10_000)
    expect(calls).toHaveLength(2)
  })

  it('a failed PATCH says so, does not storm, and the next change is written', async () => {
    const calls = held()
    await openStudio(serena())
    const box = await goToPrivacyControls()
    await toggle(box)
    await advance(1_300)
    await act(async () => { calls[0].reject(new Error('network')) })
    expect(autosaveText()).toContain('Account autosave is unavailable right now')
    await advance(10_000)
    expect(calls).toHaveLength(1)
    // The outcome of that write is unknown, so nothing is "clean": the next change is written.
    await toggle(box)
    await advance(1_300)
    expect(calls).toHaveLength(2)
  })

  it('a response the server rejects is an error, not a baseline', async () => {
    api.updateSellerDraft.mockResolvedValue({ success: false })
    await openStudio(serena())
    await toggle(await goToPrivacyControls())
    await advance(1_300)
    await flush()
    expect(autosaveText()).toContain('Account autosave is unavailable right now')
  })
})

describe('a guest or brand-new listing is unaffected', () => {
  it('writes nothing to the account, and reads nothing from it', async () => {
    sessionStorage.setItem('carup_guest_sell_draft_v1', JSON.stringify({
      version: 1, saved_at: new Date().toISOString(), make: 'Toyota', model: 'Hilux', year: '2021', vin: 'JTDKARFP0H3000731', color: 'White',
      mileage: '45000', condition: 'Used', category: 'Pickup', fuelType: 'Diesel', transmission: 'Automatic', drivetrain: '4WD',
      location: 'Harare', province: 'Harare', price: '28500', currency: 'USD', description: 'x'.repeat(60), features: [], images: [],
    }))
    render(<MemoryRouter initialEntries={['/dashboard/sell-vehicle']}><SellVehicle /></MemoryRouter>)
    await flush()
    await advance(10_000)
    // The browser keeps its own crash-recovery copy of what the seller typed — that is the guest flow working, and it never reaches the account.
    expect(localStorage.getItem('carup_guest_sell_draft_durable_v1')).toContain('JTDKARFP0H3000731')
    expect(api.updateSellerDraft).not.toHaveBeenCalled()
    expect(api.fetchOwnedVehicles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('seller-server-draft-loaded')).toBeNull()
  })
})

describe('the Vezel is the same Studio as the Serena', () => {
  it('renders the same product for both: same stage hero, same loaded notice, same locked canonical fields', async () => {
    await openStudio(serena())
    const serenaShape = ['seller-studio-stage-hero', 'seller-server-draft-loaded', 'seller-server-autosave-state', 'seller-canonical-fields-locked']
      .map((id) => Boolean(screen.queryByTestId(id)))
    cleanup()
    await openStudio(vezel())
    const vezelShape = ['seller-studio-stage-hero', 'seller-server-draft-loaded', 'seller-server-autosave-state', 'seller-canonical-fields-locked']
      .map((id) => Boolean(screen.queryByTestId(id)))
    expect(serenaShape).toEqual([true, true, true, true])
    expect(vezelShape).toEqual(serenaShape)
  })

  it('has no branch on where a vehicle came from: the Studio never reads import provenance', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'SellVehicle.tsx'), 'utf8')
    for (const provenance of ['import_source', 'diaspora_import', 'imported_from', 'is_import', 'isImport']) {
      expect(source).not.toContain(provenance)
    }
  })
})

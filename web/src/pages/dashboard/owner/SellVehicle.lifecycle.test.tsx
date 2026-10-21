/**
 * CARUP-MVP-STAB-01 F-006 / F-007 / F-009 — Seller Studio follows the listing's real lifecycle.
 *
 * Runtime proof (canonical staging, GFC27-027051): the owner's seller-draft PATCH returned 200 while
 * the listing was unpublished; the owner published it; the same PATCH then returned 409, and Studio
 * — still titled "Draft workspace · not public", with a "Buyer Preview — not public" link and a
 * "Save as Draft" button that would have unpublished it — told the owner "Account autosave is
 * unavailable right now". Nothing was broken: the listing was live, and Studio never looked.
 *
 * These render the real page against the account row and assert what the seller sees and what is
 * (and is not) sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionExpiredError } from '@/lib/apiClient'

const lookupVehiclePassport = vi.fn()
const fetchOwnedVehicles = vi.fn()
const updateSellerDraft = vi.fn()
const createVehicleListing = vi.fn()
const uploadVehicleImages = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    lookupVehiclePassport,
    fetchOwnedVehicles,
    updateSellerDraft,
    createVehicleListing,
    uploadVehicleImages,
    requestSellerAuthorityClaim: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'u_owner', role: 'owner' } }),
}))

vi.mock('@/components/VehicleCompletenessPanel', () => ({
  VehicleCompletenessPanel: () => null,
}))

const SellVehicle = (await import('./SellVehicle')).default

const VIN = 'GFC27-027051'
const DESCRIPTION = 'Family minivan, one careful owner, full service history, new tyres fitted last month.'
const PUBLISHED_NOTE = 'This listing is live on the CarUp Marketplace. Changes you save to the description, features, condition, location display and disclosures appear to buyers straight away. It stays published — to take it off the Marketplace, use Unpublish in My Listings. Photos and vehicle identity can\'t be changed while the listing is public.'
/** Longer than the 1200 ms autosave debounce, so "nothing was sent" means nothing would be. */
const PAST_DEBOUNCE_MS = 1700

function listing(overrides: Record<string, unknown> = {}) {
  return {
    vin: VIN,
    make: 'Nissan',
    model: 'Serena Highway Star',
    year: 2016,
    color: 'Maroon',
    mileage: 63000,
    price: 12800,
    currency: 'USD',
    status: 'Available',
    publication_status: 'published',
    seller_description: DESCRIPTION,
    seller_features: ['Air conditioning', 'Reverse camera'],
    body_style: 'Minivan',
    seller_stated_condition: 'Good',
    fuel_type: 'Petrol',
    transmission: 'Automatic',
    listing_city: 'Harare',
    listing_province: 'Harare',
    listing_location_visibility: 'province_only',
    public_seller_display_enabled: false,
    listing_media: { items: [{ url: 'https://cdn.carup.dev/front.jpg', seller_order: 0, is_primary: true, photo_label: 'Front' }] },
    ...overrides,
  }
}

/** A faithful server: the receipt is what it would store for this payload (trimmed text, JSONB key order). */
function storedReceipt(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const finance = payload.finance_disclosure as Record<string, unknown> | undefined
  return {
    success: true,
    vin: VIN,
    publication_status: payload.edit_scope === 'published_listing' ? 'published' : 'publishable',
    draft: {
      description: String(payload.description ?? '').trim(),
      features: payload.features,
      body_style: payload.body_style,
      seller_stated_condition: payload.seller_stated_condition,
      price: payload.price ?? null,
      currency: payload.currency ?? '',
      location: payload.location,
      province: payload.province,
      listing_country: '',
      location_visibility: payload.location_visibility,
      public_seller_display_enabled: payload.public_seller_display_enabled === true,
      ...(finance ? {
        accident_disclosure: null,
        insurance_disclosure: null,
        // Postgres JSONB order — not the order the browser sent.
        finance_disclosure: { state: finance.state, lender_name: finance.lender_name, finance_type: finance.finance_type },
      } : {}),
      ...overrides,
    },
  }
}

function lifecycleRefusal(code: string, data: Record<string, unknown>) {
  return Object.assign(new Error('Only an unpublished active Seller draft can be autosaved'), {
    status: 409,
    code,
    data: { error: 'Only an unpublished active Seller draft can be autosaved', code, ...data },
  })
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const openStudio = (search = `?vin=${VIN}`) => render(
  <MemoryRouter initialEntries={[`/dashboard/sell-vehicle${search}`]}>
    <SellVehicle />
  </MemoryRouter>,
)

/** Walk forward through the real wizard (each Next passes the page's own step validation). */
async function goToStage(target: number) {
  const hero = screen.getByTestId('seller-studio-stage-hero')
  const current = () => Number(/Stage (\d) of 4/.exec(hero.textContent || '')?.[1] || 0)
  while (current() < target) {
    const next = current() + 1
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
    await waitFor(() => expect(hero).toHaveTextContent(`Stage ${next} of 4`))
  }
}

beforeEach(() => {
  for (const mock of [lookupVehiclePassport, fetchOwnedVehicles, updateSellerDraft, createVehicleListing, uploadVehicleImages]) mock.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  lookupVehiclePassport.mockReturnValue(new Promise(() => {}))
  updateSellerDraft.mockImplementation(async (_vin: string, payload: Record<string, unknown>) => storedReceipt(payload))
})

describe('a PUBLISHED listing opens as a published listing', () => {
  it('says it is live, links to the public page and names the explicit save', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing()])
    openStudio(`?vin=${VIN}&stage=review`)
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })

    expect(screen.getByTestId('seller-workspace-status')).toHaveTextContent('Published · on the public Marketplace')
    expect(screen.getByTestId('seller-studio-stage-hero')).toHaveTextContent('Published listing')
    expect(screen.getByTestId('seller-studio-stage-hero')).not.toHaveTextContent('Private draft')
    expect(screen.getByTestId('seller-published-listing-note')).toHaveTextContent(PUBLISHED_NOTE)
    expect(screen.getByTestId('seller-published-listing-note')).toHaveAttribute('role', 'note')

    const publicLink = screen.getByRole('link', { name: /View public listing/ })
    expect(publicLink).toHaveAttribute('href', `/marketplace/${VIN}`)
    expect(screen.queryByText(/Buyer Preview — not public/)).toBeNull()
    expect(screen.queryByText(/Draft workspace · not public/)).toBeNull()

    expect(screen.getAllByText('Review & save changes').length).toBeGreaterThan(0)
    expect(screen.queryByText('Review & Save Draft')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save changes to public listing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).toBeNull()
  })

  it('never writes on its own — not after loading, not after an edit', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing()])
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await pause(PAST_DEBOUNCE_MS)
    expect(updateSellerDraft).not.toHaveBeenCalled()

    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    await pause(PAST_DEBOUNCE_MS)
    expect(updateSellerDraft).not.toHaveBeenCalled()
    expect(createVehicleListing).not.toHaveBeenCalled()
    expect(screen.getByTestId('seller-published-save-state')).toHaveTextContent(/not saved yet/i)
  })

  it('saves only when asked, with the published-listing scope, and says so only once the receipt matches', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing()])
    let respond: (value: unknown) => void = () => {}
    updateSellerDraft.mockImplementation((_vin: string, payload: Record<string, unknown>) => new Promise(resolve => {
      respond = () => resolve(storedReceipt(payload))
    }))
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    await goToStage(4)

    fireEvent.click(screen.getByRole('button', { name: 'Save changes to public listing' }))
    await waitFor(() => expect(updateSellerDraft).toHaveBeenCalledTimes(1))
    const [vin, payload] = updateSellerDraft.mock.calls[0]
    expect(vin).toBe(VIN)
    expect(payload).toMatchObject({ edit_scope: 'published_listing', description: `${DESCRIPTION} Edited.` })
    expect(createVehicleListing).not.toHaveBeenCalled()
    expect(screen.queryByText('Changes saved to your public listing.')).toBeNull()

    respond(undefined)
    expect(await screen.findByText('Changes saved to your public listing.')).toBeInTheDocument()
  })

  it('a receipt that does not hold the change is an error, never a success', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing()])
    updateSellerDraft.mockImplementation(async (_vin: string, payload: Record<string, unknown>) =>
      storedReceipt(payload, { description: DESCRIPTION }))
    openStudio(`?vin=${VIN}&stage=review`)
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    // Back to Location & Pricing to edit, then forward to review.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    await goToStage(4)

    fireEvent.click(screen.getByRole('button', { name: 'Save changes to public listing' }))
    expect(await screen.findByText(/could not confirm these changes/i)).toBeInTheDocument()
    expect(screen.queryByText('Changes saved to your public listing.')).toBeNull()
  })

  it('locks the photos while the listing is public', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing()])
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(3)

    expect(screen.getByTestId('seller-published-photos-locked')).toHaveTextContent(/can't be changed while the listing is public/)
    expect(document.querySelector('input[type="file"]')).toBeDisabled()
    expect(screen.queryByTestId('listing-media-remove-0')).toBeNull()
    expect(screen.queryByTestId('listing-media-choose-cover-0')).toBeNull()
    expect(screen.getByRole('combobox', { name: /Photo 1 angle or view/ })).toBeDisabled()
  })

  it('follows the listing to "sold" when an explicit save is refused as read-only', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles
      .mockResolvedValueOnce([listing()])
      .mockResolvedValueOnce([listing({ status: 'Sold' })])
    updateSellerDraft.mockRejectedValue(lifecycleRefusal('SELLER_LISTING_SOLD_READ_ONLY', { publication_status: 'published', status: 'Sold' }))
    openStudio(`?vin=${VIN}&stage=review`)
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes to public listing' }))
    expect(await screen.findByText('Sale completed — this listing is closed.')).toBeInTheDocument()
    expect(fetchOwnedVehicles).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  it('follows a listing that was unpublished elsewhere back to the draft Studio, and keeps the edit', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles
      .mockResolvedValueOnce([listing()])
      .mockResolvedValueOnce([listing({ publication_status: 'publishable' })])
    // The server's refusal names no published/sold state — only the code says the listing moved.
    updateSellerDraft.mockRejectedValueOnce(lifecycleRefusal('SELLER_LISTING_NOT_PUBLISHED', { publication_status: 'publishable', status: 'Available' }))
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    await goToStage(4)

    fireEvent.click(screen.getByRole('button', { name: 'Save changes to public listing' }))
    await waitFor(() => expect(screen.getByTestId('seller-workspace-status')).toHaveTextContent('Draft workspace · not public'))
    // Back in a draft, the unsaved edit is now an ordinary autosave — without the published scope.
    await waitFor(() => expect(updateSellerDraft).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    expect(updateSellerDraft.mock.calls[1][1]).not.toHaveProperty('edit_scope')
    expect(updateSellerDraft.mock.calls[1][1]).toMatchObject({ description: `${DESCRIPTION} Edited.` })
    expect(await screen.findByText('Commercial draft changes saved to your account.')).toBeInTheDocument()
    expect(screen.queryByText(/could not confirm these changes|Account autosave is unavailable/)).toBeNull()
  })
})

describe('a DRAFT keeps today\'s Studio, and autosaves only real edits', () => {
  it('keeps the draft copy, and sends nothing until the seller edits', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({ publication_status: 'publishable' })])
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })

    expect(screen.getByTestId('seller-workspace-status')).toHaveTextContent('Draft workspace · not public')
    expect(screen.getByTestId('seller-studio-stage-hero')).toHaveTextContent('Private draft')
    expect(screen.getByRole('link', { name: /Buyer Preview — not public/ })).toHaveAttribute('href', `/marketplace/${VIN}?mode=seller_preview`)
    expect(screen.getAllByText('Review & Save Draft').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('seller-published-listing-note')).toBeNull()

    await pause(PAST_DEBOUNCE_MS)
    expect(updateSellerDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('seller-server-autosave-state')).toHaveTextContent('Account draft loaded. Changes will autosave after you pause.')

    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    await waitFor(() => expect(updateSellerDraft).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    expect(updateSellerDraft.mock.calls[0][1]).not.toHaveProperty('edit_scope')
    expect(await screen.findByText('Commercial draft changes saved to your account.')).toBeInTheDocument()
  })

  it('calls a save saved when the server trimmed the text and Postgres reordered a disclosure', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({
      publication_status: 'draft',
      seller_finance_disclosure: { state: 'active', finance_type: 'bank_loan', lender_name: 'CBZ Bank' },
    })])
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.  ` } })

    await waitFor(() => expect(updateSellerDraft).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    expect(updateSellerDraft.mock.calls[0][1]).toMatchObject({
      description: `${DESCRIPTION} Edited.  `,
      finance_disclosure: { state: 'active', finance_type: 'bank_loan', lender_name: 'CBZ Bank' },
    })
    expect(await screen.findByText('Commercial draft changes saved to your account.')).toBeInTheDocument()
    expect(screen.queryByText(/Account autosave is unavailable/)).toBeNull()
  })

  it('still reports a genuine receipt mismatch', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({ publication_status: 'draft' })])
    updateSellerDraft.mockImplementation(async (_vin: string, payload: Record<string, unknown>) =>
      storedReceipt(payload, { description: 'Something the seller never wrote, at least fifty characters long.' }))
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    expect(await screen.findByText(/Account autosave is unavailable right now/, {}, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('switches to the published Studio when autosave meets a listing that went live — no "unavailable"', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles
      .mockResolvedValueOnce([listing({ publication_status: 'publishable' })])
      .mockResolvedValueOnce([listing({ publication_status: 'published' })])
    updateSellerDraft.mockRejectedValue(lifecycleRefusal('SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED', { publication_status: 'published', status: 'Available' }))
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })

    await waitFor(() => expect(screen.getByTestId('seller-workspace-status')).toHaveTextContent('Published · on the public Marketplace'), { timeout: 6_000 })
    expect(fetchOwnedVehicles).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('seller-published-listing-note')).toBeInTheDocument()
    expect(screen.queryByText(/Account autosave is unavailable/)).toBeNull()
    // The seller's edit is kept on the page for an explicit save, and autosave has stopped.
    expect(screen.getByTestId('seller-description-input')).toHaveValue(`${DESCRIPTION} Edited.`)
    expect(screen.getByTestId('seller-published-save-state')).toHaveTextContent(/not saved yet/i)
    await pause(PAST_DEBOUNCE_MS)
    expect(updateSellerDraft).toHaveBeenCalledTimes(1)
  })

  it('says the session ended when it did', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({ publication_status: 'draft' })])
    updateSellerDraft.mockRejectedValue(new SessionExpiredError())
    openStudio()
    await screen.findByTestId('seller-server-draft-loaded', {}, { timeout: 10_000 })
    await goToStage(2)
    fireEvent.change(screen.getByTestId('seller-description-input'), { target: { value: `${DESCRIPTION} Edited.` } })
    expect(await screen.findByText('Your session ended — sign in again to keep saving.', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.queryByText(/Account autosave is unavailable/)).toBeNull()
  })
})

describe('a SOLD listing is closed', () => {
  it('is read-only, points to the Passport and sends nothing', { timeout: 30_000 }, async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({ status: 'Sold', publication_status: 'published' })])
    openStudio()
    const closed = await screen.findByTestId('seller-sold-listing-closed', {}, { timeout: 10_000 })
    expect(closed).toHaveTextContent('Sale completed — this listing is closed.')
    expect(within(closed).getByRole('link', { name: /Vehicle Passport/ })).toHaveAttribute('href', `/dashboard/garage/${VIN}`)
    expect(screen.queryByTestId('seller-description-input')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
    await pause(PAST_DEBOUNCE_MS)
    expect(updateSellerDraft).not.toHaveBeenCalled()
    expect(createVehicleListing).not.toHaveBeenCalled()
  })
})

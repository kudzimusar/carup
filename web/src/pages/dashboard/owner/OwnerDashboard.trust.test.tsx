import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Issue #164 Phase 4 — the owner's own list surfaces tell the same trust truth as the passport.
 *
 * Phase 3 fixed VehicleDetail and VehicleProfile: a vehicle CarUp has never assessed publishes
 * `score: null` with `evaluation_state: 'not_evaluated'`, and those two pages render words rather
 * than a number. Four further surfaces were out of that phase's scope and kept reading the flat
 * `trust_score` into `<Progress value={...} />`. `progress.tsx` computes
 * `translateX(-${100 - (value || 0)}%)`, so a null score drew a track filled to exactly 0% beside
 * the text "Trust Index: %" — an unevaluated vehicle rendered as an evaluated worthless one, to
 * the person most likely to repeat the number.
 *
 * The four properties held here, per the brief:
 *   1. A null canonical score never renders as 0, and never as a 0%-filled bar.
 *   2. "Not evaluated" is textually AND visually distinct from a genuine low score.
 *   3. No invented tier vocabulary ('Excellent', 'Good', 'Fair', 'Verified', 'High Trust').
 *   4. The stored `trust_score` column is not a fallback — not on any of the four pages.
 *
 * Conventions follow VehicleDetail.trust.test.tsx, which does exactly this for the public pages.
 */

const VIN = 'JTDKARFP0H3000731'
const OTHER_VIN = 'WBA8E9C50HK000732'
const CALCULATION_VERSION = 'trust-decision-v2'

/** The unversioned stored column. Every fixture carries it; no surface may ever print it. */
const LEGACY_RAW_COLUMN_SCORE = 84
/** The deprecated 70-baseline trustGraph engine's number, under its old key set. */
const LEGACY_PASSPORT_ENGINE_SCORE = 90

const fetchSafePayEscrows = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchNotifications = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const unsaveMarketplaceListing = vi.fn()
const updateVehicleStatus = vi.fn()
const fetchCommunicationThreads = vi.fn()
const publishVehicleListing = vi.fn()
const unpublishVehicleListing = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications, fetchSavedMarketplaceListings,
    unsaveMarketplaceListing, updateVehicleStatus, fetchCommunicationThreads,
    publishVehicleListing, unpublishVehicleListing,
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', name: 'Owner', email: 'owner@staging.carup.local', role: 'owner' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// Fetches its own threads through the API hook; it is not what is under test here.
vi.mock('@/components/marketplace/SellerInquiriesCard', () => ({ SellerInquiriesCard: () => null }))

const OwnerDashboard = (await import('./OwnerDashboard')).default
const MyGarage = (await import('./MyGarage')).default
const MyListings = (await import('./MyListings')).default
const SavedCars = (await import('./SavedCars')).default

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Source assertions below target CODE, not prose. Each page documents the defect it removed by
 * quoting it (`value={vehicle.trust_score}`), and a comment naming a fault is the opposite of
 * committing it — so comments are stripped before matching.
 */
function code(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SOURCES = {
  OwnerDashboard: code(readFileSync(resolve(HERE, 'OwnerDashboard.tsx'), 'utf8')),
  MyGarage: code(readFileSync(resolve(HERE, 'MyGarage.tsx'), 'utf8')),
  MyListings: code(readFileSync(resolve(HERE, 'MyListings.tsx'), 'utf8')),
  SavedCars: code(readFileSync(resolve(HERE, 'SavedCars.tsx'), 'utf8')),
  VehicleSearch: code(readFileSync(resolve(HERE, '../../VehicleSearch.tsx'), 'utf8')),
} as const

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The canonical ten-field projection. Overrides let each test state one lifecycle exactly. */
function publicTrust(overrides: Record<string, unknown> = {}) {
  return {
    vin: VIN,
    score: null,
    band: null,
    evaluation_state: 'not_evaluated',
    confidence: 'not_evaluated',
    evidence_basis: null,
    calculation_version: null,
    evaluated_at: null,
    known_limitations: ['No canonical trust evaluation exists for this vehicle.'],
    source: 'cache',
    ...overrides,
  }
}

const evaluated = (score: number, band: string, extra: Record<string, unknown> = {}) => publicTrust({
  score,
  band,
  evaluation_state: 'evaluated',
  confidence: 'low',
  calculation_version: CALCULATION_VERSION,
  evaluated_at: '2026-08-17T00:00:00.000Z',
  known_limitations: [],
  ...extra,
})

/**
 * An owned-vehicle row exactly as `/api/vehicles/me` publishes it: `withCanonicalTrust` attaches
 * the projection on `trust`, and the row still carries the stored `trust_score` column — here
 * deliberately holding the unversioned 84, so any page reading it back fails.
 */
function ownedVehicle(trust: unknown, overrides: Record<string, unknown> = {}) {
  return {
    vin: VIN,
    year: 2018,
    make: 'Toyota',
    model: 'Corolla',
    color: 'Silver',
    mileage: 45000,
    price: 12500,
    status: 'Available',
    image_url: null,
    created_at: '2026-06-01T00:00:00.000Z',
    publication_status: 'published',
    trust_score: LEGACY_RAW_COLUMN_SCORE,
    trust,
    ...overrides,
  }
}

/** A saved marketplace listing summary, same rule: the column is present and must stay unread. */
function savedListing(trust: unknown, overrides: Record<string, unknown> = {}) {
  return {
    vin: VIN,
    make: 'Toyota',
    model: 'Corolla',
    year: 2018,
    price: 12500,
    currency: 'USD',
    mileage: 45000,
    status: 'Available',
    condition_category: 'local_used',
    marketplace_tags: [],
    trust_score: LEGACY_RAW_COLUMN_SCORE,
    trust,
    primary_image_url: null,
    plate_verified: false,
    passport_verified: false,
    evidence_count: 0,
    partsentry_checked: false,
    repair_history_count: 0,
    verified_parts_count: 0,
    duty_cleared: false,
    zimra_verified: false,
    cid_clear: false,
    seller_type: 'private',
    seller_display_label: 'Private seller',
    seller_public_profile_enabled: false,
    ...overrides,
  }
}

function renderDashboard() {
  return render(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
}
function renderGarage() {
  return render(<MemoryRouter><MyGarage /></MemoryRouter>)
}
function renderListings() {
  return render(<MemoryRouter><MyListings /></MemoryRouter>)
}
function renderSaved() {
  return render(<MemoryRouter><SavedCars /></MemoryRouter>)
}

/**
 * The three pages that render a per-vehicle trust claim, driven off `/api/vehicles/me`.
 *
 * `drawsBar` records which of them illustrate a published score with a `<Progress>` track.
 * MyListings shows its claim as one inline line and never drew a bar — so "the bar is present for
 * a real score" is asserted only where a bar is part of the design, while "there is NO bar for an
 * absent score" is asserted on all three, since that is the defect and it must not appear anywhere.
 */
const TRUST_SURFACES = [
  ['OwnerDashboard', renderDashboard, true],
  ['MyGarage', renderGarage, true],
  ['MyListings', renderListings, false],
] as const

/** Serve one owned vehicle carrying `trust`, to whichever surface is about to render. */
function serveOwned(trust: unknown, overrides: Record<string, unknown> = {}) {
  fetchOwnedVehicles.mockResolvedValue([ownedVehicle(trust, overrides)])
}

beforeEach(() => {
  vi.clearAllMocks()
  serveOwned(publicTrust())
  fetchSafePayEscrows.mockResolvedValue([])
  fetchNotifications.mockResolvedValue([])
  fetchCommunicationThreads.mockResolvedValue({ threads: [] })
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [savedListing(publicTrust())] })
})

// ────────────────────────────────────────────────────────────────────────────
describe('owner list surfaces — a null canonical score never renders as 0', () => {
  for (const [name, renderPage, drawsBar] of TRUST_SURFACES) {
    it(`${name}: prints no number and no percentage for a never-evaluated vehicle`, async () => {
      renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())

      // The score element exists ONLY when a score was published.
      expect(screen.queryByTestId(`trust-claim-score-${VIN}`)).toBeNull()
      const claim = screen.getByTestId(`trust-claim-${VIN}`)
      expect(claim.textContent).toMatch(/Not evaluated/i)
      // Nothing numeric may appear in the trust claim: not "0", not "0 / 100", not "0%".
      expect(claim.textContent).not.toMatch(/\d/)
      expect(claim.textContent).not.toContain('%')
    })

    it(`${name}: draws no progress bar at all — a 0%-filled track is a measurement of nothing`, async () => {
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())

      const claim = screen.getByTestId(`trust-claim-${VIN}`)
      expect(claim.querySelector('[role="progressbar"]')).toBeNull()
      expect(claim.querySelector('[data-slot="progress"]')).toBeNull()
      // And no bar anywhere else on the row either.
      expect(container.querySelector('[data-slot="progress-indicator"]')).toBeNull()
    })

    it(`${name}: never prints the stored trust_score column that sits on the same row`, async () => {
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())

      expect(container.textContent || '', 'the unversioned stored column must not reach the page')
        .not.toContain(String(LEGACY_RAW_COLUMN_SCORE))
    })

    it(`${name}: refuses a legacy-shaped trust report rather than republishing its score`, async () => {
      // A server that has not been updated still sends `{vin, trustScore: 90, metrics}`. That shape
      // carries no `evaluation_state`, so it is not a canonical projection and yields no claim.
      serveOwned({ vin: VIN, trustScore: LEGACY_PASSPORT_ENGINE_SCORE, metrics: { stolen_alert_active: false } })
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())

      expect(screen.queryByTestId(`trust-claim-score-${VIN}`)).toBeNull()
      expect(container.textContent || '').not.toContain(String(LEGACY_PASSPORT_ENGINE_SCORE))
      expect(screen.getByTestId(`trust-claim-${VIN}`).textContent).toMatch(/unavailable/i)
    })

    it(`${name}: renders the canonical score and band when one is actually published`, async () => {
      serveOwned(evaluated(37, 'low'))
      renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-score-${VIN}`)).toBeTruthy())

      const claim = screen.getByTestId(`trust-claim-${VIN}`)
      expect(screen.getByTestId(`trust-claim-score-${VIN}`).textContent).toContain('37')
      expect(claim.textContent).toMatch(/Low trust/)
      // A published score IS a measurement, so on the surfaces that illustrate one the bar is
      // correct and must be present — the fix is to remove the bar from absence, not from scoring.
      if (drawsBar) expect(claim.querySelector('[data-slot="progress"]')).toBeTruthy()
    })

    it(`${name}: fails closed — a score arriving under a stale state is still not printed`, async () => {
      // The contract makes this shape impossible. The page refuses it anyway, so a route that ever
      // published an ungoverned number shows the lifecycle state instead.
      serveOwned(publicTrust({
        evaluation_state: 'stale',
        score: LEGACY_RAW_COLUMN_SCORE,
        band: 'high',
        calculation_version: 'trust-decision-v1',
      }))
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())

      expect(screen.queryByTestId(`trust-claim-score-${VIN}`)).toBeNull()
      expect(container.textContent || '').not.toContain(String(LEGACY_RAW_COLUMN_SCORE))
      expect(screen.getByTestId(`trust-claim-${VIN}`).textContent).toMatch(/out of date/i)
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
describe('owner list surfaces — "not evaluated" is not a low score', () => {
  for (const [name, renderPage, drawsBar] of TRUST_SURFACES) {
    it(`${name}: reads differently, in words, from a genuinely low score`, async () => {
      serveOwned(publicTrust())
      const notEvaluated = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-state-${VIN}`)).toBeTruthy())
      const notEvaluatedText = screen.getByTestId(`trust-claim-${VIN}`).textContent
      notEvaluated.unmount()

      serveOwned(evaluated(9, 'low'))
      renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-score-${VIN}`)).toBeTruthy())
      const lowText = screen.getByTestId(`trust-claim-${VIN}`).textContent

      expect(lowText).not.toBe(notEvaluatedText)
      expect(lowText).toMatch(/Low trust/)
      expect(notEvaluatedText).toMatch(/Not evaluated/i)
      expect(notEvaluatedText).not.toMatch(/Low trust/)
    })

    it(`${name}: reads differently in the DOM too — the score and the absence are different elements`, async () => {
      serveOwned(publicTrust())
      const notEvaluated = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-${VIN}`)).toBeTruthy())
      expect(screen.getByTestId(`trust-claim-${VIN}`).querySelector('[data-slot="progress"]')).toBeNull()
      // The absence is marked by a different element, so it cannot be styled as a score by accident.
      expect(screen.getByTestId(`trust-claim-state-${VIN}`)).toBeTruthy()
      notEvaluated.unmount()

      serveOwned(evaluated(9, 'low'))
      renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-score-${VIN}`)).toBeTruthy())

      expect(screen.queryByTestId(`trust-claim-state-${VIN}`)).toBeNull()
      if (drawsBar) {
        expect(screen.getByTestId(`trust-claim-${VIN}`).querySelector('[data-slot="progress"]')).toBeTruthy()
      }
    })

    it(`${name}: an evaluated 0 is a measured result, told apart from an absent one`, async () => {
      // `insufficient_evidence` publishes a REAL 0. Suppressing it would be the mirror defect:
      // hiding a measurement because it looks like an absence.
      serveOwned(evaluated(0, 'insufficient_evidence'))
      renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-score-${VIN}`)).toBeTruthy())

      const claim = screen.getByTestId(`trust-claim-${VIN}`)
      expect(screen.getByTestId(`trust-claim-score-${VIN}`).textContent).toContain('0')
      expect(claim.textContent).toMatch(/Insufficient evidence/i)
      expect(claim.textContent).not.toMatch(/Not evaluated/i)
      if (drawsBar) expect(claim.querySelector('[data-slot="progress"]')).toBeTruthy()
    })
  }

  it('the two states are told apart per row, not per page', async () => {
    // One never-evaluated vehicle beside one low-scoring vehicle. A page that decided the state
    // once and reused it would pass every test above and still be wrong here.
    fetchOwnedVehicles.mockResolvedValue([
      ownedVehicle(publicTrust()),
      ownedVehicle(evaluated(11, 'low'), { vin: OTHER_VIN, make: 'BMW', model: '320i' }),
    ])
    renderGarage()
    await waitFor(() => expect(screen.getByTestId(`trust-claim-${OTHER_VIN}`)).toBeTruthy())

    expect(screen.queryByTestId(`trust-claim-score-${VIN}`)).toBeNull()
    expect(screen.getByTestId(`trust-claim-state-${VIN}`).textContent).toMatch(/Not evaluated/i)
    expect(screen.getByTestId(`trust-claim-score-${OTHER_VIN}`).textContent).toContain('11')
    expect(screen.queryByTestId(`trust-claim-state-${OTHER_VIN}`)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('owner list surfaces — no invented tier vocabulary', () => {
  const FORBIDDEN_TIERS = ['Excellent', 'High Trust', 'Featured', 'Verified Buyer']

  for (const [name, renderPage] of TRUST_SURFACES) {
    it(`${name}: renders no tier for a high canonical score`, async () => {
      serveOwned(evaluated(96, 'high', { confidence: 'high' }))
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByTestId(`trust-claim-score-${VIN}`)).toBeTruthy())

      const page = container.textContent || ''
      for (const tier of [...FORBIDDEN_TIERS, 'Good', 'Fair']) {
        expect(page, `no invented tier "${tier}" may appear`).not.toContain(tier)
      }
      // Only the authority's own band vocabulary is used as a label.
      expect(screen.getByTestId(`trust-claim-${VIN}`).textContent).toMatch(/High trust/)
    })
  }

  it('SavedCars makes no trust claim at all — the score-threshold "Verified" badge is gone', async () => {
    // The card rendered `trust_score > 80 && <Badge>Verified</Badge>`: a threshold set on this page,
    // over a number this page may not bucket, producing a verification claim from a trust score.
    fetchSavedMarketplaceListings.mockResolvedValue({
      listings: [savedListing(evaluated(96, 'high'), { trust_score: 96 })],
    })
    const { container } = renderSaved()
    await waitFor(() => expect(screen.getByTestId(`saved-price-${VIN}`)).toBeTruthy())

    const page = container.textContent || ''
    expect(page).not.toContain('Verified')
    expect(page).not.toMatch(/Trust/i)
  })

  it('no owner surface buckets a score client-side or falls back to the stored column', () => {
    // A threshold is a trust claim, and no page has the authority to set one.
    for (const [name, src] of Object.entries(SOURCES)) {
      expect(src, `${name} must not bucket a score client-side`).not.toMatch(/trust_score\s*[><]/)
      expect(src, `${name} must not bucket a score client-side`).not.toMatch(/trustScore\s*[><]=?/)
      expect(src, `${name} must not default a trust score to 0`).not.toMatch(/trust_score\s*(\|\||\?\?)\s*0/)
      expect(src, `${name} must not read the stored trust_score column`).not.toMatch(/\.trust_score/)
      expect(src, `${name} must not feed a bar from anything but a published score`)
        .not.toMatch(/Progress[^>]*value=\{(?!trust\.score)/)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('owner list surfaces — the other plausible defaults are gone too', () => {
  it('MyGarage names an absent price, mileage, colour, status and date instead of inventing them', async () => {
    serveOwned(publicTrust(), {
      price: undefined,
      mileage: undefined,
      color: undefined,
      status: undefined,
      created_at: undefined,
    })
    renderGarage()
    await waitFor(() => expect(screen.getByTestId(`vehicle-price-${VIN}`)).toBeTruthy())

    const card = screen.getByTestId(`vehicle-row-${VIN}`)
    expect(screen.getByTestId(`vehicle-price-${VIN}`).textContent).toMatch(/Price not recorded/i)
    expect(screen.getByTestId(`vehicle-price-${VIN}`).textContent).not.toMatch(/\$\s*0|N\/A/)
    expect(card.textContent).toMatch(/Mileage not recorded/i)
    expect(card.textContent).toMatch(/Colour not recorded/i)
    // 'Active' was invented for any vehicle without a status, under a green assurance badge.
    expect(screen.getByTestId(`vehicle-status-${VIN}`).textContent).toMatch(/Status not recorded/i)
    expect(screen.getByTestId(`vehicle-status-${VIN}`).textContent).not.toMatch(/Active/i)
    // `new Date('').toLocaleDateString()` printed the literal words "Invalid Date".
    expect(card.textContent).not.toContain('Invalid Date')
    expect(card.textContent).toMatch(/Date added not recorded/i)
  })

  it('MyGarage calls the asking price an asking price, not a valuation CarUp never made', () => {
    expect(SOURCES.MyGarage).not.toContain('Current Value')
    expect(SOURCES.MyGarage).toContain('Asking Price')
  })

  it('MyListings reports untracked views and an unrecorded listing date rather than 0 and today', async () => {
    serveOwned(publicTrust(), { viewCount: undefined, created_at: undefined, price: undefined, status: undefined })
    renderListings()
    await waitFor(() => expect(screen.getByTestId(`listing-views-${VIN}`)).toBeTruthy())

    expect(screen.getByTestId(`listing-views-${VIN}`).textContent).toMatch(/Views not tracked/i)
    expect(screen.getByTestId(`listing-views-${VIN}`).textContent).not.toMatch(/0 views/)
    expect(screen.getByTestId(`listing-price-${VIN}`).textContent).toMatch(/Price not recorded/i)
    const card = screen.getByTestId(`my-listing-card-${VIN}`)
    expect(card.textContent).toMatch(/Listing date not recorded/i)
    expect(card.textContent).not.toContain('Invalid Date')
    // An absent lifecycle state was published back to the seller as 'Available'.
    expect(card.textContent).toMatch(/Status not recorded/i)
  })

  it('MyListings still reports a real view count and a real zero, which are facts', async () => {
    serveOwned(publicTrust(), { viewCount: 0 })
    renderListings()
    await waitFor(() => expect(screen.getByTestId(`listing-views-${VIN}`)).toBeTruthy())

    expect(screen.getByTestId(`listing-views-${VIN}`).textContent).toMatch(/0 views/)
  })

  it('SavedCars states an absent location instead of putting "Zimbabwe" under every car', async () => {
    fetchSavedMarketplaceListings.mockResolvedValue({
      listings: [savedListing(publicTrust(), { location: undefined, price: undefined, mileage: undefined })],
    })
    renderSaved()
    await waitFor(() => expect(screen.getByTestId(`saved-location-${VIN}`)).toBeTruthy())

    expect(screen.getByTestId(`saved-location-${VIN}`).textContent).toMatch(/Location not recorded/i)
    expect(screen.getByTestId(`saved-location-${VIN}`).textContent).not.toMatch(/Zimbabwe/i)
    expect(screen.getByTestId(`saved-price-${VIN}`).textContent).toMatch(/Price not recorded/i)
    expect(screen.getByTestId(`saved-mileage-${VIN}`).textContent).toMatch(/Mileage not recorded/i)
    expect(screen.getByTestId(`saved-mileage-${VIN}`).textContent).not.toMatch(/0 km/)
  })

  it('a genuine zero mileage is recorded, not missing — 0 and false are facts', async () => {
    fetchSavedMarketplaceListings.mockResolvedValue({
      listings: [savedListing(publicTrust(), { mileage: 0, price: 0 })],
    })
    renderSaved()
    await waitFor(() => expect(screen.getByTestId(`saved-mileage-${VIN}`)).toBeTruthy())

    expect(screen.getByTestId(`saved-mileage-${VIN}`).textContent).toMatch(/0 km/)
    expect(screen.getByTestId(`saved-price-${VIN}`).textContent).toMatch(/\$0/)
  })

  it('no owner surface substitutes an unrelated stock car for a missing listing photo', () => {
    for (const [name, src] of Object.entries(SOURCES)) {
      expect(src, `${name} must not render an Unsplash stand-in vehicle`).not.toContain('images.unsplash.com')
    }
  })

  it('the dashboard no longer defaults an unlinked WhatsApp channel to verified', async () => {
    // `useState(true)` asserted, for every account, a channel status no endpoint reports; the
    // "Verify Now" button then set that flag locally and claimed a successful verification.
    expect(SOURCES.OwnerDashboard).not.toContain('whatsappLinked')
    expect(SOURCES.OwnerDashboard).not.toContain('Verify Now')

    const { container } = renderDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())
    expect(container.textContent || '').not.toMatch(/WhatsApp communication verified/i)
  })
})

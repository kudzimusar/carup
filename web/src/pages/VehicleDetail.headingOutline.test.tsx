import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The full public-listing render mounts every buyer panel; give jsdom room on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

/**
 * RX02-R6 FR-9 — Vehicle Detail has exactly one level-one heading.
 *
 * The showroom hero (`vehicle-detail-intelligence-hero`) and the info card each rendered the vehicle
 * title as an `<h1>`, so assistive technology announced two identical page titles and the info
 * card's own `<h3>` sections hung under a duplicate top-level heading. The hero keeps the page's
 * single `<h1>`; the info card's title is a level-two heading (same classes, same text).
 *
 * Runs on BOTH route variants, for a public listing and for a passport-only view. Identifiers are
 * fictional.
 */

const VIN = 'RX27TESTVIN000009'
const TITLE = '2018 Toyota Corolla'

const fetchVehicle = vi.fn()
const fetchVehiclePassport = vi.fn()
const lookupVehiclePassport = vi.fn()
const fetchMarketplaceListingDetail = vi.fn()
const fetchOwnedVehicles = vi.fn()
const saveMarketplaceListing = vi.fn()
const unsaveMarketplaceListing = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
const fetchTemporalFindings = vi.fn()
const fetchDisclosureConflicts = vi.fn()
const fetchVehicleReport = vi.fn()
const generateReportVersion = vi.fn()
const createReportShareLink = vi.fn()
const fetchVehicleTrustDecision = vi.fn()
const fetchVehicleEvidence = vi.fn()
const reserveVehicle = vi.fn()
const createSafePayEscrow = vi.fn()
const submitFinancing = vi.fn()
const fetchVehicleSourceCoverage = vi.fn()
const createMarketplaceInquiry = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport,
    lookupVehiclePassport, fetchMarketplaceListingDetail, fetchOwnedVehicles, saveMarketplaceListing,
    unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy,
    fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport,
    generateReportVersion, createReportShareLink, fetchVehicleTrustDecision, fetchVehicleEvidence,
    fetchVehicleSourceCoverage, createMarketplaceInquiry,
  }),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, loading: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

function httpError(status: number): Error {
  const err = new Error(`HTTP error! status: ${status}`) as Error & { status: number }
  err.status = status
  return err
}

function passportFixture() {
  return {
    vehicle: { vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000, features: [] },
    timeline: [],
    evidenceTimeline: [],
    evidenceVault: [],
    trustReport: undefined,
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin: VIN, identifiersRedacted: true },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1 },
  }
}

function listingFixture() {
  return {
    vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000,
    status: 'available', location: 'Harare', created_at: '2026-06-01T00:00:00.000Z',
    seller_summary: { display_label: 'Harare Motors', seller_type: 'dealer', public_profile_enabled: true },
    trust_summary: {
      trust_badges: [], public_badge_copy: [], evidence_status: 'none', vehicle_passport_available: true,
      identity_verified: false, dealer_verified: false, partsentry_public_status: 'not_applicable',
      suspicion_status: 'clear', risk_status: 'clear', risk_reasons: [], safe_public_copy: '',
    },
    verification_summary: {
      seller_verified: false, identity_status: 'unverified', vehicle_evidence_verified: false,
      part_provenance_verified: false, inspection_available: false, inspection_verified: false,
      verification_notes_public: [],
    },
    pricing_summary: {
      asking_price: 12500, asking_price_state: 'recorded', currency: null, currency_state: 'not_recorded',
      price_confidence: 'low', price_warnings: [], estimate_basis: 'deterministic',
    },
    reservation_summary: { state: 'none', reserved: false, reserved_at: null, expires_at: null, reason: null },
    safety_warnings: [],
  }
}

const ROUTE_VARIANTS = [
  ['/marketplace/:id', (id: string) => `/marketplace/${id}`],
  ['/marketplace/listing/:id', (id: string) => `/marketplace/listing/${id}`],
] as const

const SCENARIOS = [
  ['a public listing', () => fetchMarketplaceListingDetail.mockResolvedValue(listingFixture())],
  ['a passport-only view (no public listing)', () => fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))],
] as const

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/marketplace/:id" element={<VehicleDetail />} />
        <Route path="/marketplace/listing/:id" element={<VehicleDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Every rendered heading, in document order, as [level, text]. */
function headingOutline(root: HTMLElement): Array<[number, string]> {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => [
    Number(h.tagName.slice(1)),
    (h.textContent ?? '').replace(/\s+/g, ' ').trim(),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  lookupVehiclePassport.mockResolvedValue(passportFixture())
  fetchVehiclePassport.mockResolvedValue(passportFixture())
  fetchVehicle.mockRejectedValue(httpError(500))
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  fetchVehicleEvidence.mockResolvedValue([])
  fetchVehicleTrustDecision.mockResolvedValue({ decision: null })
  fetchOwnedVehicles.mockResolvedValue([])
  fetchVehicleSourceCoverage.mockRejectedValue(httpError(503))
})

describe.each(ROUTE_VARIANTS)('FR-9 Vehicle Detail heading outline — %s', (_pattern, pathFor) => {
  it.each(SCENARIOS)('%s: exactly one <h1>, and it is the showroom title', async (_label, serve) => {
    serve()
    const { container } = renderAt(pathFor(VIN))
    await screen.findByTestId('vehicle-detail-intelligence-hero', {}, { timeout: 15_000 })

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(TITLE)
    expect(within(screen.getByTestId('vehicle-detail-intelligence-hero')).getByRole('heading', { level: 1 })).toBe(h1s[0])

    // The info card still names the vehicle — as a section heading under the page title.
    expect(screen.getAllByRole('heading', { level: 2, name: TITLE })).toHaveLength(1)

    // Document order: nothing outranks or precedes-and-duplicates the page title.
    const outline = headingOutline(container)
    expect(outline.filter(([level]) => level === 1)).toEqual([[1, TITLE]])
  })
})

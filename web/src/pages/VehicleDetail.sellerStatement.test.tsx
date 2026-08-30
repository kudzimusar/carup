/**
 * Seller Journey 1.0 / S2 — the seller's own words reach the buyer, labelled as the seller's.
 *
 * THE DEFECT. The Sell form asks for a description, features, body style and condition. S0 gave all
 * four canonical columns and the Marketplace listing summary projects them. Vehicle Detail read
 * `vehicle.description` and `vehicle.features` — keys the passport projection never emitted, because
 * `PUBLIC_VEHICLE_FIELDS` did not carry them. So the description block and the Features block were
 * dead by construction, and the "Condition" tile read `vehicle.condition`, another key that does not
 * exist, so it rendered "Not recorded" for every vehicle on the platform.
 *
 * This is the same defect class the media suite in this directory documents: a page reading a key
 * its own projection does not publish.
 *
 * THE SECOND HALF IS THE LABEL. Publishing the seller's condition without saying it is the seller's
 * would turn a seller statement into what reads as a CarUp fact. `seller_stated_condition` and the
 * governed `vehicle_condition_category` are different questions and must never render as each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const VIN = 'JTDKARFP0H3000731'

const SELLER_DESCRIPTION = 'One careful owner. Full service history with the franchise dealer.'
const SELLER_FEATURES = ['Tow bar', 'Reverse camera', 'Leather seats']

const submitFinancing = vi.fn()
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
const fetchVehicleSourceCoverage = vi.fn()
const createMarketplaceInquiry = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    submitFinancing, fetchVehicle, fetchVehiclePassport,
    lookupVehiclePassport, fetchMarketplaceListingDetail, fetchOwnedVehicles, saveMarketplaceListing,
    unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy,
    fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport,
    generateReportVersion, createReportShareLink, fetchVehicleTrustDecision,
    fetchVehicleSourceCoverage, createMarketplaceInquiry,
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', name: 'Owner', email: 'owner@carup.dev', role: 'owner' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))
vi.mock('@/components/TrustDecisionPanel', () => ({ TrustDecisionPanel: () => null }))
vi.mock('@/components/SourceCoveragePanel', () => ({ SourceCoveragePanel: () => null }))
vi.mock('@/components/marketplace/TrustSummaryPanel', () => ({ TrustSummaryPanel: () => null }))
vi.mock('@/components/marketplace/AllInPricePanel', () => ({ AllInPricePanel: () => null }))
vi.mock('@/components/marketplace/SafetyWarnings', () => ({ SafetyWarnings: () => null }))
vi.mock('@/components/marketplace/InquiryModal', () => ({ InquiryModal: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

function passportFixture(vehicleOverrides: Record<string, unknown> = {}) {
  return {
    vehicle: {
      vin: VIN,
      make: 'Toyota',
      model: 'Hilux',
      year: 2021,
      price: 28500,
      currency: 'USD',
      mileage: 45000,
      transmission: 'Automatic',
      fuel_type: 'Diesel',
      created_at: '2026-06-01T00:00:00.000Z',
      ...vehicleOverrides,
    },
    timeline: [],
    evidenceTimeline: [],
    trustReport: {
      vin: VIN, score: null, band: null, evaluation_state: 'not_evaluated',
      confidence: 'not_evaluated', evidence_basis: null, calculation_version: null,
      evaluated_at: null, known_limitations: [], source: 'cache',
    },
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin: VIN, plateStatus: 'registered' },
    plateHistory: [],
    plateHistoryState: 'available',
    ownershipSummary: {
      previousOwnerCount: 1,
      previousOwnerCountState: 'available',
      previousOwnersPublicLabel: 'Redacted for privacy',
      ownerNamesRedacted: true,
      currentOwnerVisible: false,
    },
  }
}

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={[`/vehicle/${VIN}?mode=seller_preview`]}>
      <Routes><Route path="/vehicle/:id" element={<VehicleDetail />} /></Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  fetchOwnedVehicles.mockResolvedValue([{ vin: VIN }])
  fetchMarketplaceListingDetail.mockRejectedValue(new Error('not listed'))
  fetchSavedMarketplaceListings.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue([])
  fetchEvidenceSources.mockResolvedValue([])
  fetchTemporalFindings.mockResolvedValue([])
  fetchDisclosureConflicts.mockResolvedValue([])
  fetchVehicleReport.mockRejectedValue(new Error('no report'))
  fetchVehicleTrustDecision.mockRejectedValue(new Error('no decision'))
  fetchVehicleSourceCoverage.mockRejectedValue(new Error('no coverage'))
  fetchVehicle.mockRejectedValue(new Error('no vehicle'))
  fetchVehiclePassport.mockRejectedValue(new Error('no passport'))
})

describe('S2 seller statement reaches the buyer', () => {
  it("renders the seller's description from the field the projection actually publishes", async () => {
    lookupVehiclePassport.mockResolvedValue(
      passportFixture({ seller_description: SELLER_DESCRIPTION }),
    )
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('seller-description')).toBeTruthy())
    expect(screen.getByTestId('seller-description').textContent).toContain(SELLER_DESCRIPTION)
  })

  it("renders the seller's features from seller_features", async () => {
    lookupVehiclePassport.mockResolvedValue(passportFixture({ seller_features: SELLER_FEATURES }))
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('seller-features')).toBeTruthy())
    const rendered = screen.getByTestId('seller-features').textContent || ''
    for (const feature of SELLER_FEATURES) expect(rendered).toContain(feature)
  })

  it('labels the condition as the seller\'s statement, never as a CarUp finding', async () => {
    lookupVehiclePassport.mockResolvedValue(
      passportFixture({ seller_stated_condition: 'Used', vehicle_condition_category: 'local_used' }),
    )
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('spec-seller-condition')).toBeTruthy())
    const tile = screen.getByTestId('spec-seller-condition').textContent || ''
    expect(tile).toContain('Used')
    expect(tile.toLowerCase()).toContain('seller')
    // A seller statement may never borrow governance language.
    expect(tile.toLowerCase()).not.toMatch(/verified|certified|confirmed|inspected/)
  })

  it('renders the body style the seller stated', async () => {
    lookupVehiclePassport.mockResolvedValue(passportFixture({ body_style: 'Pickup' }))
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('spec-body-style')).toBeTruthy())
    expect(screen.getByTestId('spec-body-style').textContent).toContain('Pickup')
  })

  it('keeps missing missing — no fabricated description, features, condition or body style', async () => {
    lookupVehiclePassport.mockResolvedValue(passportFixture())
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('spec-body-style')).toBeTruthy())

    // Absent seller copy renders nothing at all rather than an invented placeholder.
    expect(screen.queryByTestId('seller-description')).toBeNull()
    expect(screen.queryByTestId('seller-features')).toBeNull()
    // Absent spec values say so explicitly instead of guessing.
    expect(screen.getByTestId('spec-body-style').textContent).toContain('Not recorded')
    expect(screen.getByTestId('spec-seller-condition').textContent).toContain('Not recorded')
  })
})

/**
 * PC01-J-R1 — a guest reads a public listing without the page calling session-only routes.
 *
 * TrustDecisionPanel (GET /api/vehicles/:vin/trust-decision) and SourceCoveragePanel
 * (GET /api/vehicles/:vin/sources/coverage) sit behind `authorizeRole()`. They rendered for guests
 * anyway, so every public listing fired two 401s and the coverage panel turned that refusal into
 * five "Not yet checked" rows — an auth failure presented as a fact about the car. The page's own
 * trust-decision read was already guest-gated; the two panels bypassed it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const VIN = 'JTDKARFP0H3000731'

const api = {
  submitFinancing: vi.fn(), fetchVehicle: vi.fn(), fetchVehiclePassport: vi.fn(), lookupVehiclePassport: vi.fn(),
  fetchMarketplaceListingDetail: vi.fn(), fetchOwnedVehicles: vi.fn(), saveMarketplaceListing: vi.fn(),
  unsaveMarketplaceListing: vi.fn(), fetchSavedMarketplaceListings: vi.fn(), fetchEvidenceTaxonomy: vi.fn(),
  fetchEvidenceSources: vi.fn(), fetchTemporalFindings: vi.fn(), fetchDisclosureConflicts: vi.fn(),
  fetchVehicleReport: vi.fn(), generateReportVersion: vi.fn(), createReportShareLink: vi.fn(),
  fetchVehicleTrustDecision: vi.fn(), fetchVehicleSourceCoverage: vi.fn(), createMarketplaceInquiry: vi.fn(),
}

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, loading: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))
vi.mock('@/components/marketplace/TrustSummaryPanel', () => ({ TrustSummaryPanel: () => null }))
vi.mock('@/components/marketplace/AllInPricePanel', () => ({ AllInPricePanel: () => null }))
vi.mock('@/components/marketplace/SafetyWarnings', () => ({ SafetyWarnings: () => null }))
vi.mock('@/components/marketplace/InquiryModal', () => ({ InquiryModal: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

const publicTrust = {
  vin: VIN, score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated',
  evidence_basis: null, calculation_version: null, evaluated_at: null, known_limitations: [], source: 'cache',
}
const passport = {
  vehicle: { vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000, features: [], created_at: '2026-06-01T00:00:00.000Z' },
  timeline: [], evidenceTimeline: [], evidenceVault: [], trustReport: publicTrust,
  chainVerification: { verified: true, count: 0, chain: [] },
  identity: { vin: VIN, plateStatus: 'registered' }, plateHistory: [], plateHistoryState: 'available',
  ownershipSummary: { previousOwnerCount: 1, previousOwnerCountState: 'available', previousOwnersPublicLabel: 'Redacted for privacy', ownerNamesRedacted: true, currentOwnerVisible: false },
}
const detail = {
  vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000,
  status: 'available', location: 'Harare', created_at: '2026-06-01T00:00:00.000Z', media: [],
  seller_summary: { display_label: 'A private seller', seller_type: 'private', public_profile_enabled: false },
  trust_summary: {}, verification_summary: {}, pricing_summary: {},
  reservation_summary: { state: 'none', reserved: false, reserved_at: null, expires_at: null, reason: null },
  safety_warnings: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.lookupVehiclePassport.mockResolvedValue(passport)
  api.fetchVehiclePassport.mockResolvedValue(passport)
  api.fetchVehicle.mockResolvedValue(passport.vehicle)
  api.fetchMarketplaceListingDetail.mockResolvedValue(detail)
  api.fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  api.fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  api.fetchEvidenceSources.mockResolvedValue({ sources: [] })
  api.fetchTemporalFindings.mockResolvedValue({ findings: [] })
  api.fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  api.fetchVehicleReport.mockResolvedValue(null)
  api.fetchVehicleTrustDecision.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
  api.fetchVehicleSourceCoverage.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
})

describe('a guest on a public listing', () => {
  it('gets a sign-in note instead of two session-only reads', async () => {
    render(
      <MemoryRouter initialEntries={[`/marketplace/${VIN}`]}>
        <Routes><Route path="/marketplace/:id" element={<VehicleDetail />} /></Routes>
      </MemoryRouter>,
    )

    const note = await screen.findByTestId('trust-detail-signin', {}, { timeout: 15_000 })
    expect(note.querySelector('a')?.getAttribute('href')).toBe(`/login?returnTo=${encodeURIComponent(`/marketplace/${VIN}`)}`)
    await waitFor(() => expect(screen.getByTestId('marketplace-detail-panels')).toBeTruthy())

    expect(api.fetchVehicleTrustDecision).not.toHaveBeenCalled()
    expect(api.fetchVehicleSourceCoverage).not.toHaveBeenCalled()
    expect(screen.queryByTestId('source-coverage-panel')).toBeNull()
    expect(screen.queryByText('Not yet checked')).toBeNull()
  })
})

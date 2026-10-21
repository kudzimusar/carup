import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * CARUP-MVP-STAB-01 — what a buyer reads next to a Trust number, and what the Verification tab
 * claims from absence.
 *
 *   F-012  The odometer row renders the backend's evidence state, never "Verified", and never
 *          falls back to the deprecated `odometer_consistent` boolean.
 *   F-013  Service records are "on file", not "Verified"/"signed"; an empty ledger is not verified.
 *
 * The Trust fixture is the exact public record staging served for Serena GFC27-027051.
 */

const VIN = 'GFC27-027051'

const fetchVehicle = vi.fn()
const fetchVehiclePassport = vi.fn()
const lookupVehiclePassport = vi.fn()
const fetchMarketplaceListingDetail = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
const fetchTemporalFindings = vi.fn()
const fetchDisclosureConflicts = vi.fn()
const fetchVehicleReport = vi.fn()
const fetchVehicleTrustDecision = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehicle, fetchVehiclePassport, lookupVehiclePassport, fetchMarketplaceListingDetail,
    fetchOwnedVehicles, saveMarketplaceListing: vi.fn(), unsaveMarketplaceListing: vi.fn(),
    fetchSavedMarketplaceListings, fetchEvidenceTaxonomy, fetchEvidenceSources, fetchTemporalFindings,
    fetchDisclosureConflicts, fetchVehicleReport, generateReportVersion: vi.fn(),
    createReportShareLink: vi.fn(), fetchVehicleTrustDecision, fetchVehicleEvidence: vi.fn().mockResolvedValue([]),
    fetchServiceHistory: vi.fn().mockResolvedValue([]),
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
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))
// Marketplace-detail panels fetch or read their own blocks and are covered by their own suites.
vi.mock('@/components/TrustDecisionPanel', () => ({ TrustDecisionPanel: () => null }))
vi.mock('@/components/SourceCoveragePanel', () => ({ SourceCoveragePanel: () => null }))
vi.mock('@/components/marketplace/TrustSummaryPanel', () => ({ TrustSummaryPanel: () => null }))
vi.mock('@/components/marketplace/AllInPricePanel', () => ({ AllInPricePanel: () => null }))
vi.mock('@/components/marketplace/SafetyWarnings', () => ({ SafetyWarnings: () => null }))
vi.mock('@/components/marketplace/InquiryModal', () => ({ InquiryModal: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

const SERENA_LIMITATIONS = [
  'No live government/partner source is connected for this vehicle yet.',
  'Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding.',
  'dealer compliance has not been evaluated for this vehicle.',
  'insurance eligibility has not been evaluated for this vehicle.',
  'finance eligibility has not been evaluated for this vehicle.',
  'escrow eligibility has not been evaluated for this vehicle.',
  'No governed vehicle fact is backed by an authoritative record.',
]

/** Staging's public Trust record for Serena GFC27-027051 (2026-10-21). */
const SERENA_TRUST = {
  vin: VIN,
  score: 60,
  band: 'moderate',
  evaluation_state: 'evaluated',
  confidence: 'low',
  evidence_basis: {
    governed_facts_total: 7,
    governed_facts_substantiated: 0,
    governed_facts_adverse: 0,
    connected_sources: 0,
    unbacked_legacy_claims: 0,
  },
  calculation_version: 'trust-decision-1.1.0',
  evaluated_at: '2026-10-20T00:00:00.000Z',
  known_limitations: SERENA_LIMITATIONS,
  source: 'cache',
}

const SERENA_SENTENCES = [
  'No government or partner record is connected for this vehicle yet.',
  'Zimbabwe registration is still in progress. This is not held against the vehicle.',
  'Dealer, insurance, finance and SafePay checks have not been done for this vehicle yet.',
  "None of this vehicle's facts has been confirmed against an official record yet.",
]

const SERENA_ROWS = [
  'Confidence: Low',
  'Evidence support: 0 of 7 vehicle facts independently confirmed',
  'Connected official sources: 0',
]

/** Serena's staging trust signals today: one current-listing mileage, no service-history readings. */
const SERENA_SIGNALS = {
  cvr_synced: false,
  zimra_duty: false,
  zrp_police_cleared: false,
  blockchain_audit_valid: true,
  odometer_consistent: true,
  odometer_evidence_state: 'not_evaluated',
  odometer_observation_count: 0,
  maintenance_logs_count: 0,
  stolen_alert_active: false,
  verified_evidence_count: 0,
  rejected_evidence_count: 0,
  signals_are_not_a_trust_score: true,
}

function passportFixture({
  trust = SERENA_TRUST as unknown,
  signals = SERENA_SIGNALS as unknown,
  chain = { verified: true, count: 0, chain: [] } as unknown,
} = {}) {
  return {
    vehicle: {
      vin: VIN, make: 'Nissan', model: 'Serena', year: 2018, price: 9800, currency: 'USD', mileage: 61000,
      images: [], features: [], created_at: '2026-06-01T00:00:00.000Z',
    },
    timeline: [],
    evidenceTimeline: [],
    evidenceVault: [],
    trustReport: trust,
    trustSignals: signals,
    chainVerification: chain,
    identity: { vin: VIN },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1, previousOwnersPublicLabel: '1 previous owner' },
  }
}

function servePassport(options: Parameters<typeof passportFixture>[0] = {}) {
  lookupVehiclePassport.mockResolvedValue(passportFixture(options))
  fetchVehiclePassport.mockResolvedValue(passportFixture(options))
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/marketplace/:id" element={<VehicleDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}
const renderPublic = () => renderAt(`/marketplace/${VIN}`)
const renderSellerPreview = () => renderAt(`/marketplace/${VIN}?mode=seller_preview`)

async function openTab(name: RegExp) {
  const trigger = screen.getByRole('tab', { name })
  await act(async () => {
    fireEvent.mouseDown(trigger, { button: 0 })
    fireEvent.focus(trigger)
  })
  await waitFor(() => expect(trigger.getAttribute('data-state')).toBe('active'))
}

async function verificationRow(label: RegExp) {
  await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())
  await openTab(/Verification/i)
  const rows = await screen.findAllByTestId('verification-item')
  const row = rows.find((element) => label.test(element.textContent || ''))
  if (!row) throw new Error(`no verification row matches ${label}`)
  return row.textContent || ''
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([{ vin: VIN, publication_status: 'draft' }])
  servePassport()
  fetchVehicle.mockResolvedValue(passportFixture().vehicle)
  fetchMarketplaceListingDetail.mockRejectedValue(new Error('not a marketplace listing'))
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  // A signed-in caller also receives the decision's raw reason codes. They must not reach this page.
  fetchVehicleTrustDecision.mockResolvedValue({
    decision: {
      vin: VIN,
      calculation_version: 'trust-decision-1.1.0',
      overall_trust: { status: 'moderate', value: 60 },
      dimensions: { evidence_confidence: { status: 'evaluated', value: 'low', reason_codes: ['EVIDENCE_THIN', 'no_connected_source'] } },
      known_limitations: [],
    },
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('F-012 — the odometer row renders the evidence state, never "Verified"', () => {
  const withOdometer = (state: Record<string, unknown>) => servePassport({ signals: { ...SERENA_SIGNALS, ...state } })

  it('no readings (Serena today): not evaluated — although the deprecated boolean still says true', async () => {
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('Not evaluated — no odometer readings are recorded in service history')
    expect(row).not.toMatch(/Verified/)
    expect(row).not.toMatch(/No inconsistency detected/)
  })

  it('one reading: not enough to judge consistency', async () => {
    withOdometer({ odometer_evidence_state: 'insufficient_evidence', odometer_observation_count: 1 })
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('One odometer reading on record — consistency needs at least two readings')
    expect(row).not.toMatch(/Verified/)
    expect(row).not.toMatch(/No inconsistency detected/)
  })

  it('POSITIVE — two or more readings without a rollback: "No inconsistency detected", with the count', async () => {
    withOdometer({ odometer_evidence_state: 'no_inconsistency_detected', odometer_observation_count: 3 })
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('No inconsistency detected')
    expect(row).toContain('No rollback found across 3 recorded readings')
    expect(row).not.toMatch(/Verified/)
  })

  it('NEGATIVE — a rollback is a warning to inspect the service history', async () => {
    withOdometer({ odometer_consistent: false, odometer_evidence_state: 'inconsistency_detected', odometer_observation_count: 2 })
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('Possible mileage inconsistency — inspect the service history')
    expect(row).toContain('Warning')
    expect(row).not.toMatch(/No inconsistency detected/)
  })

  it('a failed read could not be checked', async () => {
    withOdometer({ odometer_evidence_state: 'unavailable', odometer_observation_count: null })
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('Could not be checked')
    expect(row).not.toMatch(/Verified|No inconsistency detected|Warning/)
  })

  it('an older backend that sends only the boolean could not be checked — the boolean is never read', async () => {
    servePassport({ signals: { odometer_consistent: true, maintenance_logs_count: 0, stolen_alert_active: false } })
    renderPublic()
    const consistent = await verificationRow(/Odometer/)
    expect(consistent).toContain('Could not be checked')
    expect(consistent).not.toMatch(/Verified|No inconsistency detected/)
  })

  it('an older backend that sends only a false boolean is not turned into a finding either', async () => {
    servePassport({ signals: { odometer_consistent: false, maintenance_logs_count: 0, stolen_alert_active: false } })
    renderPublic()
    const row = await verificationRow(/Odometer/)
    expect(row).toContain('Could not be checked')
    expect(row).not.toMatch(/Possible mileage inconsistency|Warning/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('F-013 — service records and the ledger claim no verification', () => {
  it('service records are "on file", recorded — never "Verified" or "signed"', async () => {
    servePassport({ signals: { ...SERENA_SIGNALS, maintenance_logs_count: 2 } })
    renderPublic()
    const row = await verificationRow(/Service Records/)
    expect(row).toContain('2 service records on file')
    expect(row).toContain('Recorded')
    expect(row).not.toMatch(/Verified|signed/i)
  })

  it('one service record reads in the singular', async () => {
    servePassport({ signals: { ...SERENA_SIGNALS, maintenance_logs_count: 1 } })
    renderPublic()
    expect(await verificationRow(/Service Records/)).toContain('1 service record on file')
  })

  it('no service records: none on file, still no verification vocabulary', async () => {
    renderPublic()
    const row = await verificationRow(/Service Records/)
    expect(row).toContain('No service records on file')
    expect(row).not.toMatch(/Verified|signed/i)
  })

  it('the Market summary does not call the records mechanic-signed', async () => {
    servePassport({ signals: { ...SERENA_SIGNALS, maintenance_logs_count: 2 } })
    renderPublic()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())
    await openTab(/Market Analysis/i)
    const summary = screen.getByTestId('carup-data-summary').textContent || ''
    expect(summary).toContain('2 service records on file')
    expect(summary).not.toMatch(/signed|on the ledger/i)
  })

  it('an EMPTY ledger is not verified — the row and the ledger note say no entries are recorded', async () => {
    renderPublic()
    const row = await verificationRow(/Ledger/)
    expect(row).toContain('No ledger entries recorded yet')
    expect(row).not.toMatch(/verified|intact/i)
    const note = screen.getByTestId('ledger-integrity-note').textContent || ''
    expect(note).toContain('No ledger entries recorded yet')
    expect(note).not.toMatch(/verified|intact/i)
  })

  it('entries that pass the hash check are "intact" — about CarUp\'s record, never a vehicle verification', async () => {
    servePassport({ chain: { verified: true, count: 3, chain: [] } })
    renderPublic()
    const row = await verificationRow(/Ledger/)
    expect(row).toContain('Ledger entries intact')
    expect(row).not.toMatch(/verified/i)
    const note = screen.getByTestId('ledger-integrity-note').textContent || ''
    expect(note).toContain('Ledger entries intact')
    expect(note).not.toMatch(/verified/i)
  })

  it('a failed ledger check still says so', async () => {
    servePassport({ chain: { verified: false, chain: [] } })
    renderPublic()
    const row = await verificationRow(/Ledger/)
    expect(row).toMatch(/Ledger integrity check failed/)
    expect(screen.getByTestId('ledger-integrity-note').textContent).toMatch(/Ledger integrity unconfirmed/)
  })
})

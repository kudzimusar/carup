import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionExpiredError } from '@/lib/apiClient'
import { VEHICLE_DETAIL_SLOW_NOTICE_MS, VEHICLE_DETAIL_TIMEOUT_MS } from '@/lib/vehicleDetailReadOutcome'

/**
 * TI-27 — Vehicle Detail must tell the truth about a failed read (RX02-RS-R3 Workstream D).
 *
 * Runtime evidence (RX02-RS-UAT-UNBLOCK-LR02, rows S-G7-04/05/06/08) on a real public listing whose
 * identifier is a CHASSIS number, not a VIN:
 *   - details/passport/listing faulted (500 / 503 / connection refused) → "Sign in to look up by plate"
 *     (the guest lookup's policy refusal survived the outage and became the page's explanation);
 *   - every API call refused → "Vehicle Not Found — doesn't exist or has been removed".
 * And the inverse defect (S-G1-04 was non-discriminating): a genuine absence and an outage rendered
 * byte-identical pages.
 *
 * Every scenario runs on BOTH route variants: /marketplace/:id and /marketplace/listing/:id.
 * Identifiers below are fictional.
 */

const CHASSIS = 'ZRX27-104455'
const VIN = 'RX27TESTVIN000001'

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

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport,
    lookupVehiclePassport, fetchMarketplaceListingDetail, fetchOwnedVehicles, saveMarketplaceListing,
    unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy,
    fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport,
    generateReportVersion, createReportShareLink, fetchVehicleTrustDecision, fetchVehicleEvidence,
  }),
}))

const auth = { user: null as null | { id: string; role: string }, isAuthenticated: false, loading: false }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

/** The error `apiRequest` throws for a non-OK HTTP response. */
function httpError(status: number, code?: string): Error {
  const err = new Error(`HTTP error! status: ${status}`) as Error & { status: number; code?: string }
  err.status = status
  if (code) err.code = code
  return err
}
/** What fetch() rejects with when no HTTP response exists (refused / offline / DNS). */
const networkError = () => new TypeError('Failed to fetch')
const lookupPolicyRefusal = () => httpError(401, 'LOOKUP_REQUIRES_AUTHENTICATION')

function passportFixture(vin: string) {
  return {
    vehicle: { vin, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000, features: [] },
    timeline: [],
    evidenceTimeline: [],
    evidenceVault: [],
    trustReport: undefined,
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin, identifiersRedacted: true },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1 },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="probe-location">{location.pathname + location.search}</output>
}

const ROUTE_VARIANTS = [
  ['/marketplace/:id', (id: string) => `/marketplace/${id}`],
  ['/marketplace/listing/:id', (id: string) => `/marketplace/listing/${id}`],
] as const

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/marketplace/:id" element={<VehicleDetail />} />
        <Route path="/marketplace/listing/:id" element={<VehicleDetail />} />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/marketplace" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Wording that asserts the vehicle is gone, or blames the visitor, for a read that did not answer. */
function expectNoFalseAbsenceOrBlame() {
  expect(screen.queryByText(/doesn.t exist/i)).toBeNull()
  expect(screen.queryByText(/has been removed/i)).toBeNull()
  expect(screen.queryByText(/vehicle not found/i)).toBeNull()
  expect(screen.queryByRole('heading', { name: /sign in to look up/i })).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.isAuthenticated = false
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  fetchVehicleEvidence.mockResolvedValue([])
  fetchVehicleTrustDecision.mockResolvedValue({ decision: null })
  fetchOwnedVehicles.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe.each(ROUTE_VARIANTS)('TI-27 Vehicle Detail read truth — %s', (_pattern, pathFor) => {
  it.each([500, 503])('S-G7-04/05: a %i on the chassis listing is an outage, not a sign-in demand', async (status) => {
    lookupVehiclePassport.mockRejectedValue(lookupPolicyRefusal())
    fetchVehicle.mockRejectedValue(httpError(status))
    fetchVehiclePassport.mockRejectedValue(httpError(status))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(status))
    renderAt(pathFor(CHASSIS))

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-kind', 'unavailable')
    expect(failure).toHaveAttribute('data-failure-cause', 'server')
    expect(screen.getByRole('heading', { level: 1, name: /couldn.t load this listing/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/doesn.t mean the listing was removed/i)
    expect(screen.getByTestId('read-state-retry')).toBeInTheDocument()
    expectNoFalseAbsenceOrBlame()
  })

  it('S-G7-06: connection refused on the listing reads is an unreachable-service state', async () => {
    lookupVehiclePassport.mockRejectedValue(lookupPolicyRefusal())
    fetchVehicle.mockRejectedValue(networkError())
    fetchVehiclePassport.mockRejectedValue(networkError())
    fetchMarketplaceListingDetail.mockRejectedValue(networkError())
    renderAt(pathFor(CHASSIS))

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-cause', 'network')
    expect(screen.getByRole('heading', { level: 1, name: /can.t be reached/i })).toBeInTheDocument()
    expectNoFalseAbsenceOrBlame()
  })

  it('S-G7-08: a full outage never renders "doesn\'t exist or has been removed"', async () => {
    lookupVehiclePassport.mockRejectedValue(networkError())
    fetchVehicle.mockRejectedValue(networkError())
    fetchVehiclePassport.mockRejectedValue(networkError())
    fetchMarketplaceListingDetail.mockRejectedValue(networkError())
    renderAt(pathFor(VIN))

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-kind', 'unavailable')
    expect(failure).toHaveAttribute('data-failure-cause', 'network')
    expectNoFalseAbsenceOrBlame()
    // The ledger names what did not answer, in plain language.
    expect(within(screen.getByTestId('read-ledger-listing')).getByTestId('evidence-status')).toHaveTextContent('Unreachable')
  })

  it('S-G1-04: a genuine absence is said plainly — and differently from an outage', async () => {
    // /details answers 500 for a missing row (PostgREST .single()); the two governing reads say 404.
    lookupVehiclePassport.mockRejectedValue(httpError(404))
    fetchVehicle.mockRejectedValue(httpError(500))
    fetchVehiclePassport.mockRejectedValue(httpError(404))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    renderAt(pathFor(VIN))

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-kind', 'not-found')
    expect(screen.getByRole('heading', { level: 1, name: /no public listing at this address/i })).toBeInTheDocument()
    // Non-enumerable: no claim that the car does not exist, no retry for an answered question.
    expectNoFalseAbsenceOrBlame()
    expect(screen.queryByTestId('read-state-retry')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('S-G1-04b: an unknown non-VIN identifier offers sign-in to widen the search, carrying the full return path', async () => {
    lookupVehiclePassport.mockRejectedValue(lookupPolicyRefusal())
    fetchVehicle.mockRejectedValue(httpError(500))
    fetchVehiclePassport.mockRejectedValue(httpError(404))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    const path = `${pathFor(CHASSIS)}?ref=RX27&campaign=spring`
    renderAt(path)

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-kind', 'not-found')
    const signIn = screen.getByTestId('read-state-sign-in')
    expect(signIn).toHaveTextContent(/sign in to search by plate or temporary id/i)
    expect(signIn).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(path)}`)
    expectNoFalseAbsenceOrBlame()
  })

  it('403: a refused read is an access statement, never an absence', async () => {
    lookupVehiclePassport.mockRejectedValue(httpError(403))
    fetchVehicle.mockRejectedValue(httpError(403))
    fetchVehiclePassport.mockRejectedValue(httpError(403))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    renderAt(pathFor(VIN))

    const failure = await screen.findByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-kind', 'forbidden')
    expect(screen.getByRole('heading', { level: 1, name: /isn.t open to your account/i })).toBeInTheDocument()
    expect(screen.getByTestId('data-state')).toHaveAttribute('data-state', 'forbidden')
    expectNoFalseAbsenceOrBlame()
  })

  it('409: an ambiguous identifier asks for the VIN instead of guessing', async () => {
    auth.isAuthenticated = true
    auth.user = { id: 'member-1', role: 'owner' }
    lookupVehiclePassport.mockRejectedValue(httpError(409))
    fetchVehicle.mockRejectedValue(httpError(500))
    fetchVehiclePassport.mockRejectedValue(httpError(404))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    renderAt(pathFor(CHASSIS))

    expect(await screen.findByTestId('vehicle-detail-failure')).toHaveAttribute('data-failure-kind', 'ambiguous')
    expect(screen.getByText(/search by the full vin/i)).toBeInTheDocument()
  })

  it('an expired session mid-read is named, with a sign-in that returns here', async () => {
    lookupVehiclePassport.mockRejectedValue(new SessionExpiredError())
    fetchVehicle.mockRejectedValue(new SessionExpiredError())
    fetchVehiclePassport.mockRejectedValue(new SessionExpiredError())
    fetchMarketplaceListingDetail.mockRejectedValue(new SessionExpiredError())
    renderAt(pathFor(VIN))

    expect(await screen.findByTestId('vehicle-detail-failure')).toHaveAttribute('data-failure-kind', 'session-expired')
    expect(screen.getByTestId('read-state-sign-in')).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(pathFor(VIN))}`)
    expectNoFalseAbsenceOrBlame()
  })

  it('loading is a labelled skeleton stage; slow reads say so; a stalled read becomes a timeout, then recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let resolvePassport: (value: unknown) => void = () => {}
    lookupVehiclePassport.mockReturnValue(new Promise((resolve) => { resolvePassport = resolve }))
    fetchMarketplaceListingDetail.mockReturnValue(new Promise(() => {}))
    renderAt(pathFor(VIN))

    const loading = await screen.findByTestId('vehicle-detail-read-state')
    expect(loading).toHaveAttribute('data-read-state', 'loading')
    expect(screen.getByRole('status', { name: /loading — vehicle detail/i })).toBeInTheDocument()
    expect(screen.getByTestId('read-state-slow-notice')).toHaveTextContent('')

    await act(async () => { vi.advanceTimersByTime(VEHICLE_DETAIL_SLOW_NOTICE_MS + 10) })
    expect(screen.getByTestId('read-state-slow-notice')).toHaveTextContent(/nothing has been concluded/i)

    await act(async () => { vi.advanceTimersByTime(VEHICLE_DETAIL_TIMEOUT_MS) })
    const failure = screen.getByTestId('vehicle-detail-failure')
    expect(failure).toHaveAttribute('data-failure-cause', 'timeout')
    expect(screen.getByRole('heading', { level: 1, name: /taking longer than it should/i })).toBeInTheDocument()
    expectNoFalseAbsenceOrBlame()

    // The read that was still in flight answers late: the real page replaces the timeout state, with
    // an honest notice that the listing half (price, seller, buying actions) never answered.
    await act(async () => { resolvePassport(passportFixture(VIN)) })
    expect(await screen.findByTestId('vehicle-detail-partial')).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-detail-failure')).toBeNull()
  })

  it('Try again re-reads in place and renders the vehicle when the service recovers', async () => {
    lookupVehiclePassport.mockRejectedValueOnce(httpError(503))
    fetchVehicle.mockRejectedValueOnce(httpError(503))
    fetchVehiclePassport.mockRejectedValueOnce(httpError(503))
    fetchMarketplaceListingDetail.mockRejectedValueOnce(httpError(503))
    renderAt(`${pathFor(VIN)}?ref=RX27`)

    const retry = await screen.findByTestId('read-state-retry')
    expect(screen.getByTestId('vehicle-detail-failure')).toHaveAttribute('data-failure-cause', 'server')
    // The service recovers before the visitor presses Try again (act() flushes the re-read effects
    // synchronously inside the click, so the recovered responses must already be in place).
    lookupVehiclePassport.mockResolvedValue(passportFixture(VIN))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    fireEvent.click(retry)

    // Recovered: the failure stage is gone and the passport-only page renders (listing 404 is a
    // legitimate passport-only view, so no partial notice either).
    expect(await screen.findAllByText(/Toyota Corolla/)).not.toHaveLength(0)
    expect(screen.queryByTestId('vehicle-detail-failure')).toBeNull()
    expect(screen.queryByTestId('vehicle-detail-partial')).toBeNull()
    expect(lookupVehiclePassport).toHaveBeenCalledTimes(2)
    expect(fetchMarketplaceListingDetail).toHaveBeenCalledTimes(2)
  })

  it('a rendered vehicle whose listing read failed shows an honest partial notice with a retry', async () => {
    lookupVehiclePassport.mockResolvedValue(passportFixture(VIN))
    fetchMarketplaceListingDetail.mockRejectedValueOnce(httpError(503))
    renderAt(pathFor(VIN))

    const partial = await screen.findByTestId('vehicle-detail-partial')
    expect(within(partial).getByRole('alert')).toHaveTextContent(/price, seller and buying actions may be missing/i)
    expect(screen.queryByTestId('vehicle-detail-failure')).toBeNull()

    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    fireEvent.click(within(partial).getByRole('button', { name: /retry listing details/i }))
    expect(await screen.findAllByText(/Toyota Corolla/)).not.toHaveLength(0)
    expect(screen.queryByTestId('vehicle-detail-partial')).toBeNull()
  })

  it('with no in-app history, the way back is the Marketplace itself', async () => {
    lookupVehiclePassport.mockRejectedValue(httpError(404))
    fetchVehicle.mockRejectedValue(httpError(500))
    fetchVehiclePassport.mockRejectedValue(httpError(404))
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    renderAt(pathFor(VIN))

    const back = await screen.findByTestId('read-state-back')
    expect(back).toHaveTextContent(/browse the marketplace/i)
    expect(back).toHaveAttribute('href', '/marketplace')
  })
})

/**
 * RX02-R6 FR-4 — the owner Vehicle Passport must not render a definitive answer as an outage.
 *
 * Before this fix every rejected passport read (404 included) became "Vehicle Passport unavailable"
 * with a "Retry Passport" button: a definitive "CarUp holds no Passport for this identifier" was
 * presented as a transient outage the owner could retry their way out of. The page now reuses the
 * TI-27 read classifier (`classifyReadError`) so only non-answers (server error, unreachable, timed
 * out, rate-limited, uninterpretable) offer a retry, and answers say what they are.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionExpiredError } from '@/lib/apiClient'

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehiclePassport,
    fetchVehicleEvidence,
    fetchEvidenceTaxonomy,
    fetchEvidenceSources,
  }),
}))

const VIN = 'CARUPGLDNB0000002'
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'CARUPGLDNB0000002' }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

/** The error shape `apiRequest` throws for a non-session HTTP failure. */
function httpError(status: number, message = `HTTP error! status: ${status}`, code?: string) {
  const err = new Error(message) as Error & { status: number; code?: string }
  err.status = status
  if (code) err.code = code
  return err
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/garage/${VIN}`]}>
      <VehicleProfile />
    </MemoryRouter>,
  )
}

function rejectPassportWith(err: unknown) {
  fetchVehiclePassport.mockRejectedValue(err)
  fetchVehicleEvidence.mockRejectedValue(err)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
})

describe('FR-4 — a definitive answer is not rendered as a retryable outage', () => {
  it.each([404, 410, 400])('HTTP %i: says there is no Passport, offers My Garage, and offers no retry', async (status) => {
    rejectPassportWith(httpError(status, 'VIN not found'))

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'No Vehicle Passport found' })).toBeInTheDocument()
    expect(alert).toHaveTextContent('CarUp has no Vehicle Passport for this identifier')
    expect(alert).not.toHaveTextContent(/unavailable/i)
    expect(alert.closest('[data-passport-read]')).toHaveAttribute('data-passport-read', 'not-found')
    expect(screen.queryByRole('button', { name: 'Retry Passport' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Back to My Garage' })).toHaveAttribute('href', '/dashboard/garage')
    expect(fetchVehiclePassport).toHaveBeenCalledTimes(1)
  })

  it('HTTP 409: says more than one vehicle matches, without a retry', async () => {
    rejectPassportWith(httpError(409, 'Multiple vehicles match this identifier. Please search by VIN.'))

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'More than one vehicle matches' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Back to My Garage' })).toHaveAttribute('href', '/dashboard/garage')
  })

  it('HTTP 403: an access refusal is about the account, not the vehicle, and is not retryable', async () => {
    rejectPassportWith(httpError(403, 'Forbidden'))

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'This Passport isn’t open to your account' })).toBeInTheDocument()
    expect(alert).toHaveTextContent('a statement about access, not about the vehicle')
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Back to My Garage' })).toHaveAttribute('href', '/dashboard/garage')
  })

  it('an expired session asks the owner to sign in again (returning here), not to retry', async () => {
    rejectPassportWith(new SessionExpiredError())

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Your session ended' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      `/login?returnTo=${encodeURIComponent(`/dashboard/garage/${VIN}`)}`,
    )
  })

  it('the guest plate / temporary-ID refusal asks for sign-in and is never called an outage', async () => {
    rejectPassportWith(httpError(401, 'Sign in to search by plate', 'LOOKUP_REQUIRES_AUTHENTICATION'))

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Sign in to open this Passport' })).toBeInTheDocument()
    expect(alert).not.toHaveTextContent(/unavailable/i)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?returnTo=${encodeURIComponent(`/dashboard/garage/${VIN}`)}`,
    )
  })
})

describe('FR-4 — a non-answer keeps the honest outage and its retry', () => {
  it.each([
    ['HTTP 503', httpError(503, 'Service Unavailable')],
    ['HTTP 500', httpError(500, 'boom')],
    ['HTTP 504', httpError(504, 'Gateway Timeout')],
    ['HTTP 429', httpError(429, 'Too many requests')],
    ['no HTTP response', new TypeError('Failed to fetch')],
    ['an uninterpretable error', new Error('offline')],
  ])('%s: "Vehicle Passport unavailable" with Retry Passport', async (_label, err) => {
    rejectPassportWith(err)

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Vehicle Passport unavailable' })).toBeInTheDocument()
    expect(alert).toHaveTextContent('This does not mean the vehicle has no records.')
    expect(screen.getByRole('button', { name: 'Retry Passport' })).toBeInTheDocument()
  })

  it('a 503 followed by a successful retry renders the Passport', async () => {
    fetchVehiclePassport
      .mockRejectedValueOnce(httpError(503, 'Service Unavailable'))
      .mockResolvedValueOnce({
        vehicle: { vin: VIN, make: 'Nissan', model: 'NP200', year: 2017 },
        claims: {},
        timeline: [],
        evidenceTimeline: [],
        listing_media: { items: [] },
        trustReport: null,
        chainVerification: { verified: false },
      })
    fetchVehicleEvidence.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce([])

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Passport' }))
    await screen.findByRole('heading', { name: /2017 Nissan NP200/i })
    expect(fetchVehiclePassport).toHaveBeenCalledTimes(2)
  })

  it('a 404 after a 503 retry stops offering retry', async () => {
    fetchVehiclePassport
      .mockRejectedValueOnce(httpError(503, 'Service Unavailable'))
      .mockRejectedValueOnce(httpError(404, 'VIN not found'))
    fetchVehicleEvidence.mockRejectedValue(httpError(503))

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Passport' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'No Vehicle Passport found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry Passport' })).not.toBeInTheDocument()
  })
})

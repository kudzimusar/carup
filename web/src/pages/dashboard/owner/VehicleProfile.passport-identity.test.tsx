/**
 * OC-5R-REL-02 Stage A — the owner's loaded `/dashboard/garage/:vin` page is the canonical Vehicle
 * Passport surface, and it must SAY so. The deployed Seller lifecycle gate (spec 48) asserts that the
 * Passport survives commerce by finding "Vehicle Passport" on this page; before REL-02 the loaded page
 * never rendered those words (only its loading and error states did), so that assertion could not pass.
 *
 * The label is presentation only: it names the surface, adds no fact about the vehicle, and must not
 * leak into the loading or error states, which keep their own truthful words.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchServiceHistory = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehiclePassport,
    fetchVehicleEvidence,
    fetchEvidenceTaxonomy,
    fetchEvidenceSources,
    fetchOwnedVehicles,
    fetchServiceHistory,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'JTHLCCHR030628462' }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

function passport() {
  return {
    vehicle: { vin: 'JTHLCCHR030628462', make: 'Toyota', model: 'Hilux', year: 2020, mileage: 61000, color: 'Silver' },
    claims: {},
    timeline: [],
    evidenceTimeline: [],
    listing_media: { items: [] },
    trustReport: {
      score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated',
      calculation_version: null, evaluated_at: null, known_limitations: [],
    },
    chainVerification: { verified: false },
  }
}

const renderPage = () => render(<MemoryRouter><VehicleProfile /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchOwnedVehicles.mockResolvedValue([{ vin: 'JTHLCCHR030628462' }])
  fetchServiceHistory.mockResolvedValue([])
  fetchVehicleEvidence.mockResolvedValue([])
})

describe('REL-02 A — the loaded owner page identifies itself as the Vehicle Passport', () => {
  it('renders a visible "Vehicle Passport" label, then the vehicle heading, then its VIN', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    renderPage()

    const heading = await screen.findByRole('heading', { level: 1, name: '2020 Toyota Hilux' })
    const label = screen.getByTestId('vehicle-passport-label')
    expect(label).toHaveTextContent(/^Vehicle Passport$/)
    expect(label).toBeVisible()
    expect(label.className).not.toMatch(/\bsr-only\b|\bhidden\b|\binvisible\b/)
    // Composition: "Vehicle Passport" / "2020 Toyota Hilux" / "VIN: …", in reading order.
    expect(label.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const vinLine = screen.getByText('VIN: JTHLCCHR030628462')
    expect(heading.compareDocumentPosition(vinLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names the page landmark "Vehicle Passport" plus the vehicle, so the heading and label stay one accessible name', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    renderPage()

    const main = await screen.findByRole('main', { name: 'Vehicle Passport 2020 Toyota Hilux' })
    expect(within(main).getByTestId('vehicle-passport-label')).toBeInTheDocument()
    // The deployed spec reads the page body for /Vehicle Passport|Passport/i — it is now there.
    expect(document.body.textContent).toMatch(/Vehicle Passport/)
  })

  it('does not put the label on the loading state, which keeps its own announcement', () => {
    fetchVehiclePassport.mockReturnValue(new Promise(() => {}))
    fetchVehicleEvidence.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Loading Vehicle Passport')
    expect(screen.queryByTestId('vehicle-passport-label')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('does not put the label on the error state, which still says the Passport is unavailable', async () => {
    fetchVehiclePassport.mockRejectedValue(new Error('offline'))
    fetchVehicleEvidence.mockRejectedValue(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Vehicle Passport unavailable' })).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-passport-label')).toBeNull()
  })
})

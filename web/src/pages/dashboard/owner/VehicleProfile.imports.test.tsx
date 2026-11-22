/**
 * RX06-LR04 CAP S1c — the owner's Vehicle Passport (unified presentation) asks, once and by VIN, which import orders
 * carry the vehicle, and shows "Trade & imports" only when there is one to open, or when the check itself failed.
 * Fictional data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
const fetchDiasporaJourney = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources, fetchDiasporaJourney }),
}))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => true }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'FXVIN-0000001' }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default
const ORDER = 'fx000001-0000-4000-8000-000000000001'

function passport() {
  return {
    vehicle: { vin: 'FXVIN-0000001', make: 'Toyota', model: 'Fielder', year: 2017, mileage: 0, color: 'Silver', price: 0 },
    claims: {}, timeline: [], evidenceTimeline: [], listing_media: { items: [] },
    trustReport: { score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated', calculation_version: null, evaluated_at: null, known_limitations: [] },
    chainVerification: { verified: false },
  }
}
function journey(orderId: string | null, state = 'SHIPMENT_CREATED') {
  return {
    subject: { type: 'vehicle', id: 'FXVIN-0000001', order_id: orderId }, viewer: { kind: 'OWNER' }, state,
    sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
    asset: null, transaction: null, shipping: null, timeline: [], exceptions: [], contacts: null, sections: {}, provenance: {}, note: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchVehiclePassport.mockResolvedValue(passport())
  fetchVehicleEvidence.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
})

const renderPage = () => render(<MemoryRouter><VehicleProfile /></MemoryRouter>)

describe('Vehicle Passport › Trade & imports (CAP S1c)', () => {
  it('asks once, by VIN, and links the one import order and its journey', async () => {
    fetchDiasporaJourney.mockResolvedValue(journey(ORDER))
    renderPage()
    expect(await screen.findByTestId('passport-imports')).toHaveAttribute('data-state', 'single')
    expect(screen.getByTestId('passport-imports-journey')).toHaveAttribute('href', `/diaspora/imports/${ORDER}/shipment`)
    expect(fetchDiasporaJourney).toHaveBeenCalledWith('vehicle', 'FXVIN-0000001')
    expect(fetchDiasporaJourney).toHaveBeenCalledTimes(1)
  })

  it('shows nothing for a vehicle on no import order', async () => {
    fetchDiasporaJourney.mockResolvedValue(journey(null, 'NO_TRANSACTION'))
    renderPage()
    await screen.findByTestId('vehicle-passport-unified')
    await waitFor(() => expect(fetchDiasporaJourney).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByTestId('passport-imports')).not.toBeInTheDocument()
  })

  it('a failed check is said as unavailable, never as none', async () => {
    fetchDiasporaJourney.mockRejectedValue(Object.assign(new Error('Upstream down'), { status: 503 }))
    renderPage()
    expect(await screen.findByTestId('passport-imports-unavailable')).toHaveTextContent('This is not a report that there are none.')
  })

  it('a refusal (not this account\'s vehicle to open) shows nothing', async () => {
    fetchDiasporaJourney.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    renderPage()
    await screen.findByTestId('vehicle-passport-unified')
    await waitFor(() => expect(fetchDiasporaJourney).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByTestId('passport-imports')).not.toBeInTheDocument()
  })
})

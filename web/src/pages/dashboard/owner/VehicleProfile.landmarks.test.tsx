/**
 * RX06-LR04 — RX-04 gate correction: the unified Vehicle Passport renders inside the workspace shell, which already
 * provides the page's <main>. The Passport (and its loading/error state) is a labelled section, never a second main
 * landmark (axe: landmark-no-duplicate-main, landmark-main-is-top-level). Fictional data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources }),
}))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => true }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'FXVIN-0000001' }) }
})
const VehicleProfile = (await import('./VehicleProfile')).default

beforeEach(() => {
  vi.clearAllMocks()
  fetchVehicleEvidence.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
})

describe('Vehicle Passport landmarks (unified)', () => {
  it('the Passport is a labelled section, not a second <main>', async () => {
    fetchVehiclePassport.mockResolvedValue({
      vehicle: { vin: 'FXVIN-0000001', make: 'Toyota', model: 'Fielder', year: 2017, mileage: 0, color: 'Silver', price: 0 },
      claims: {}, timeline: [], evidenceTimeline: [], listing_media: { items: [] },
      trustReport: { score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated', calculation_version: null, evaluated_at: null, known_limitations: [] },
      chainVerification: { verified: false },
    })
    const { container } = render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
    const page = await screen.findByTestId('vehicle-passport-unified')
    expect(page.tagName).toBe('SECTION')
    expect(page).toHaveAttribute('aria-labelledby', 'vehicle-passport-title')
    expect(container.querySelector('main, [role="main"]')).toBeNull()
  })

  it('the loading state is not a <main> either', () => {
    fetchVehiclePassport.mockReturnValue(new Promise(() => {}))
    const { container } = render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
    expect(container.querySelector('main, [role="main"]')).toBeNull()
    expect(container.querySelector('section[aria-labelledby="passport-state-title"]')).not.toBeNull()
  })
})

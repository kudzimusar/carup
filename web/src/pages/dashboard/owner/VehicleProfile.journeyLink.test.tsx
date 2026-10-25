import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * T11-CAP-LR01-R1 — Journey & Arrival is reachable from the VEHICLE.
 *
 * Until now nothing in the product linked to the Journey page; it could only be opened from an
 * alert or a typed address. A vehicle's own page now offers it for ANY vehicle — one with a full
 * international journey, one with an order and no shipment, one with no Trade OS history at all —
 * because the Journey page itself says which of those it is. The link is the same for all of them.
 */

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources }),
}))

const route = vi.hoisted(() => ({ id: 'VIN-WITH/SLASH 1' }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: route.id }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

const passport = (vin: string) => ({
  vehicle: { vin, make: 'AnyMake', model: 'AnyModel', year: 2016, mileage: 63000, color: 'Maroon', price: 0 },
  claims: {}, timeline: [], evidenceTimeline: [], chainVerification: { verified: false },
  trustReport: {
    score: 50, band: 'moderate', evaluation_state: 'evaluated', confidence: 'low', calculation_version: 'trust-decision-1.0.0',
    evaluated_at: '2026-08-24T02:35:46.874+00:00', known_limitations: [],
    evidence_basis: { governed_facts_total: 0, governed_facts_substantiated: 0, governed_facts_adverse: 0, connected_sources: 0, unbacked_legacy_claims: 0 },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchVehicleEvidence.mockResolvedValue([])
})

describe('the vehicle page offers the vehicle’s Journey & arrival', () => {
  it('links to the vehicle subject by its own identifier, encoded', async () => {
    route.id = 'GEN-VIN-0001'
    fetchVehiclePassport.mockResolvedValue(passport('GEN-VIN-0001'))
    render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
    const link = await waitFor(() => screen.getByTestId('vehicle-journey-link'))
    expect(link.getAttribute('href')).toBe('/diaspora/journey/vehicle/GEN-VIN-0001')
    expect(link).toHaveTextContent(/journey & arrival/i)
  })

  it('does not depend on the vehicle: another identifier gets the same link shape, escaped', async () => {
    route.id = 'RA/9 9'
    fetchVehiclePassport.mockResolvedValue(passport('RA/9 9'))
    render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
    const link = await waitFor(() => screen.getByTestId('vehicle-journey-link'))
    expect(link.getAttribute('href')).toBe('/diaspora/journey/vehicle/RA%2F9%209')
  })
})

describe('an import order offers its Journey too', () => {
  it('links the order detail page to /diaspora/journey/import_order/<id>', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../diaspora/DiasporaTrade.tsx'), 'utf8')
    expect(src).toMatch(/data-testid="diaspora-open-journey-button"/)
    expect(src).toMatch(/to=\{`\/diaspora\/journey\/import_order\/\$\{encodeURIComponent\(order\.id\)\}`\}/)
  })
})

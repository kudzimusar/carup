/**
 * R4 — one service truth across Owner Service History and the Vehicle Passport.
 *
 * THE DEFECT THIS PINS. Owner UAT found the two surfaces describing the SAME completed service
 * differently:
 *
 *   Owner Service History   SN Cert Garage snz020359 · ZIG 250 · 91,000 km observed
 *   Vehicle Passport        Garage not recorded      · $0     · Mileage not recorded
 *
 * The Passport derived its own list from the lifecycle timeline filtered to legacy `workorder:`
 * events, which carry no provider, cost or mileage, then printed `$` + sum(cost ?? 0). That is the
 * "absent cost rendered as $0", "generic literal for provider" and "currency assumed USD" debt S6
 * exists to retire — reappearing on the surface a BUYER reads.
 *
 * Both surfaces now read the governed owner projection and format it through
 * `@/lib/ownerServiceHistory`. This test drives BOTH components from ONE fixture and asserts they
 * agree. Restoring the legacy timeline source in the Passport turns it red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ServiceHistory from './ServiceHistory'
import VehicleProfile from './VehicleProfile'

const VIN = 'SNCLOSE020359VIN1'

/** One governed completed service, exactly as `/api/service-history/me` returns it. */
const GOVERNED_SERVICE = {
  id: 'sr-1',
  vin: VIN,
  status: 'completed',
  description: null,
  issue_description: null,
  service_category: 'brakes',
  work_performed: 'Replaced front pads',
  provenance: 'garage_stated',
  provider: { known: true, display_name: 'SN Cert Garage snz020359', slug: 'sn-cert-snz020359' },
  cost: { recorded: true, amount: 250, currency: 'ZIG' },
  completed_at: '2026-09-05T14:00:00.000Z',
  performed_at: '2026-09-05T14:00:00.000Z',
  created_at: '2026-09-05T12:00:00.000Z',
  mileage_observation: { observed_mileage: 91000, observed_at: '2026-09-05T14:00:00.000Z', source: 'garage_stated' },
}

const fetchServiceHistory = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchServiceHistory,
    fetchOwnedVehicles,
    fetchVehiclePassport,
    fetchVehicleEvidence,
    fetchEvidenceTaxonomy,
    fetchEvidenceSources,
    user: { id: 'u_owner', role: 'owner' },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  fetchServiceHistory.mockResolvedValue([GOVERNED_SERVICE])
  fetchOwnedVehicles.mockResolvedValue([{ vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021 }])
  fetchVehicleEvidence.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue({ version: 'v1', classes: [] })
  fetchEvidenceSources.mockResolvedValue([])
  fetchVehiclePassport.mockResolvedValue({
    vehicle: { vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021, mileage: 41000, price: 24000 },
    // The legacy timeline still carries a work-order event with NO provider, cost or mileage.
    // The Passport must ignore it for service truth; if it regresses to reading this, the
    // assertions below fail.
    timeline: [
      { id: 'workorder:wo-1', event_source: 'service', label: 'Service — Completed', timestamp: '2026-09-05T14:00:00.000Z', details: {} },
    ],
    trustReport: { evaluation_state: 'not_evaluated', score: null, band: null, confidence: 'not_evaluated', calculation_version: null, evaluated_at: null, known_limitations: [] },
  })
})

/**
 * The Passport defaults to the Documents tab, so the service section is not mounted until the
 * "Service History" tab is activated — exactly as a user must click it.
 */
async function renderPassportOnServiceTab() {
  const view = render(
    <MemoryRouter initialEntries={[`/dashboard/garage/${VIN}`]}>
      <Routes><Route path="/dashboard/garage/:id" element={<VehicleProfile />} /></Routes>
    </MemoryRouter>,
  )
  const tab = await screen.findByRole('tab', { name: /Service History/i }, { timeout: 15000 })
  // Radix tabs activate on pointer-down, not on a bare click.
  fireEvent.mouseDown(tab)
  fireEvent.click(tab)
  return view
}

describe('R4 — Service History and Passport tell one story', () => {
  it('Owner Service History states the governed provider, cost and mileage', async () => {
    render(<MemoryRouter><ServiceHistory /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('service-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('entry-cost')).toHaveTextContent('ZIG 250')
    expect(screen.getByTestId('entry-provider')).toHaveTextContent('SN Cert Garage snz020359')
    expect(screen.getByTestId('entry-mileage')).toHaveTextContent('91,000 km observed')
    expect(screen.getByTestId('recorded-spend')).toHaveTextContent('ZIG 250')
  })

  it('the Passport states the SAME provider, cost and mileage', async () => {
    await renderPassportOnServiceTab()
    const entry = await screen.findByTestId('passport-service-entry', {}, { timeout: 15000 })
    expect(within(entry).getByTestId('passport-service-cost')).toHaveTextContent('ZIG 250')
    expect(within(entry).getByTestId('passport-service-meta')).toHaveTextContent('SN Cert Garage snz020359')
    expect(within(entry).getByTestId('passport-service-meta')).toHaveTextContent('91,000 km observed')
  }, 40000)

  it('the Passport never republishes the retired $0 / "Garage not recorded" / assumed-USD debts', async () => {
    await renderPassportOnServiceTab()
    await screen.findByTestId('passport-service-entry', {}, { timeout: 15000 })

    const spend = screen.getByTestId('passport-service-spend')
    expect(spend).toHaveTextContent('ZIG 250')
    expect(spend.textContent).not.toMatch(/\$/)

    const entry = screen.getByTestId('passport-service-entry')
    expect(entry.textContent).not.toMatch(/\$/)
    expect(entry.textContent).not.toMatch(/Garage not recorded/)
    expect(entry.textContent).not.toMatch(/Mileage not recorded/)
    expect(screen.getByTestId('passport-service-count')).toHaveTextContent('1')
  }, 40000)

  it('an unrecorded cost is stated as unrecorded on BOTH surfaces, never as zero', async () => {
    fetchServiceHistory.mockResolvedValue([
      { ...GOVERNED_SERVICE, cost: { recorded: false, amount: null, currency: null }, mileage_observation: null },
    ])

    const history = render(<MemoryRouter><ServiceHistory /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('entry-cost')).toHaveTextContent('Cost not recorded'))
    expect(screen.getByTestId('recorded-spend')).toHaveTextContent('Not recorded')
    history.unmount()

    await renderPassportOnServiceTab()
    const entry = await screen.findByTestId('passport-service-entry', {}, { timeout: 15000 })
    expect(within(entry).getByTestId('passport-service-cost')).toHaveTextContent('Cost not recorded')
    expect(screen.getByTestId('passport-service-spend')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('passport-service-spend').textContent).not.toMatch(/0/)
  }, 40000)

  it('a failed service read is reported as a failure, never as "no service recorded"', async () => {
    fetchServiceHistory.mockRejectedValue(new Error('network'))
    await renderPassportOnServiceTab()
    const err = await screen.findByTestId('passport-service-error', {}, { timeout: 15000 })
    expect(err).toHaveTextContent(/not a statement/i)
    expect(screen.queryByText(/No service records are available/i)).toBeNull()
  }, 40000)
})

/**
 * GMO-1 autosave (#209 37c96874's regression tests, ported by OC-5E onto this lineage's GarageSetup).
 *
 * The defect #209 fixed: a burst of edits faster than the debounce replaced the pending patch AND the
 * timer, so only the last field typed was ever saved. This lineage's GarageSetup already accumulates
 * the pending patch (and restores it when a save fails); #209's tests are what pin that it keeps doing
 * so. Real timers against the real 700 ms debounce — fake timers stall the initial load.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GarageSetup from './GarageSetup'

const fetchMyGarageApplication = vi.fn()
const saveGarageApplication = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyGarageApplication, startGarageApplication: vi.fn(), saveGarageApplication, submitGarageApplication: vi.fn(),
  }),
}))
vi.mock('./GarageEvidence', () => ({ default: () => <div data-testid="garage-evidence-stub" /> }))

const DRAFT = {
  id: 'app-auto', status: 'draft', trading_name: 'Mbare Motors', address_line: '1 Old Road', location_city: 'Harare',
  location_province: null, contact_phone: '+263771111111', contact_email: null, service_categories: [],
  applicant_relationship: 'owner', attestation_accepted_at: null, submitted_at: null, decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null, activated_tenant_id: null,
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  vi.clearAllMocks()
  fetchMyGarageApplication.mockResolvedValue({ application: DRAFT, blockers: [], editable: true })
  saveGarageApplication.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ application: { ...DRAFT, ...patch }, blockers: [] }))
})

describe('autosave keeps every edit, not just the last one', () => {
  it('a burst of edits saves ALL of them', async () => {
    render(<GarageSetup />)
    await screen.findByTestId('garage-c3-setup')
    // Faster than the debounce; values that DIFFER from the loaded application (an unchanged value
    // fires no onChange, so a test setting the same value would drive a form it never changed).
    fireEvent.change(screen.getByTestId('garage-field-trading_name'), { target: { value: 'Highfield Auto' } })
    fireEvent.change(screen.getByTestId('garage-field-location_city'), { target: { value: 'Bulawayo' } })
    fireEvent.change(screen.getByTestId('garage-field-address_line'), { target: { value: '9 Leopold Takawira' } })
    await settle(1100)
    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalled())
    const merged = Object.assign({}, ...saveGarageApplication.mock.calls.map((c) => c[1]))
    // Before #209's fix this was { address_line } alone.
    expect(merged).toMatchObject({ trading_name: 'Highfield Auto', location_city: 'Bulawayo', address_line: '9 Leopold Takawira' })
  }, 20000)

  it('a failed save keeps the edits pending rather than dropping them', async () => {
    saveGarageApplication.mockRejectedValueOnce(new Error('network'))
    render(<GarageSetup />)
    await screen.findByTestId('garage-c3-setup')
    fireEvent.change(screen.getByTestId('garage-field-location_city'), { target: { value: 'Mutare' } })
    await settle(1100)
    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalledTimes(1))
    // The next edit carries the failed one with it — one bad request must not lose an edit.
    fireEvent.change(screen.getByTestId('garage-field-contact_phone'), { target: { value: '+263779999999' } })
    await settle(1100)
    await waitFor(() => expect(saveGarageApplication).toHaveBeenCalledTimes(2))
    expect(saveGarageApplication.mock.calls[1][1]).toMatchObject({ location_city: 'Mutare', contact_phone: '+263779999999' })
  }, 20000)
})

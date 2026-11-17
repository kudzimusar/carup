/** RX04-C2 — Insurance (unified): records exactly as recorded; no dead policy controls; absence is named, not zeroed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = { fetchOwnedVehicles: vi.fn() }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi') })

async function renderPage() {
  const { default: InsuranceRecords } = await import('./InsuranceRecords')
  return render(<MemoryRouter><InsuranceRecords /></MemoryRouter>)
}

describe('InsuranceRecords — unified', () => {
  it('shows recorded policies without inventing currency, dates, warnings or a dead "Add policy"', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([
      {
        vin: 'POLICY00000000001', year: 2018, make: 'Toyota', model: 'Hilux',
        counts: { verified_documents: 0, services: null, parts: null, active_insurance: 0 },
        insurance_records: [{ id: 'p1', provider: 'Example Mutual', policy_number: 'EM-1', status: 'expired', premium: 40, start_date: '2025-01-01' }],
      },
      { vin: 'NOVIEW00000000002', year: 2014, make: 'Toyota', model: 'Vitz', counts: null },
    ])
    await renderPage()
    const policy = await screen.findByTestId('insurance-policy-p1')
    expect(policy).toHaveTextContent('Example Mutual')
    expect(policy).toHaveTextContent('Expired')
    expect(policy).toHaveTextContent('Currency not recorded')
    expect(policy).toHaveTextContent('Not recorded') // expiry absent
    expect(document.body).not.toHaveTextContent('Invalid Date')
    expect(document.body).not.toHaveTextContent(/\/mo\b/)
    expect(document.body).not.toHaveTextContent(/Renew/)
    expect(screen.queryByRole('button', { name: /Add Policy/i })).toBeNull()
    expect(screen.getByTestId('insurance-vehicle-POLICY00000000001')).toHaveTextContent('No active policy recorded')
    // Not carried by the read ≠ no policies.
    expect(screen.getByTestId('insurance-records-not-in-view-NOVIEW00000000002')).toHaveTextContent('not part of this view')
    expect(screen.getByTestId('insurance-vehicle-NOVIEW00000000002')).toHaveTextContent('Active policies not recorded')
  })

  it('when the read carries no policy rows at all, says so once and lists each car with its active count', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([
      { vin: 'ACTIVE00000000001', year: 2018, make: 'Toyota', model: 'Hilux', counts: { verified_documents: 0, services: null, parts: null, active_insurance: 1 } },
      { vin: 'UNREAD00000000002', year: 2014, make: 'Toyota', model: 'Vitz', counts: null },
    ])
    await renderPage()
    expect(await screen.findByTestId('insurance-records-not-in-view')).toHaveTextContent('not part of this view')
    expect(screen.getAllByText(/not part of this view/)).toHaveLength(1)
    expect(screen.getByTestId('insurance-vehicle-ACTIVE00000000001')).toHaveTextContent('1 active policy')
    expect(screen.getByTestId('insurance-vehicle-UNREAD00000000002')).toHaveTextContent('Active policies not recorded')
  })

  it('a failed read is an error with a retry, never "no insurance"', async () => {
    api.fetchOwnedVehicles.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([])
    await renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('not the same as having no insurance on record')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('insurance-empty')).toBeInTheDocument())
  })
})

/** RX04-C2 — PartSentry (unified): same ledger truth as the accepted page, in the new presentation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const toastError = vi.fn()
const toastSuccess = vi.fn()
const api = {
  addRepairLog: vi.fn(),
  verifyLedger: vi.fn(),
  fetchOwnedVehicles: vi.fn(),
  fetchRepairHistory: vi.fn(),
}
const CAR = { vin: 'VIN0000000000001', year: 2018, make: 'Toyota', model: 'Corolla' }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
  vi.doMock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
})
afterEach(() => {
  (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
  vi.doUnmock('@/hooks/useCarUpApi')
  vi.doUnmock('sonner')
})

async function renderPage() {
  const { default: PartSentry } = await import('./PartSentry')
  return render(<MemoryRouter><PartSentry /></MemoryRouter>)
}

describe('PartSentry — unified', () => {
  it('renders real rows with their review state; an absent review is "Unreviewed", never verified', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([CAR])
    api.fetchRepairHistory.mockResolvedValue([
      { id: 7, vin: CAR.vin, part_name: 'Radiator', part_oem: 'RAD-77', action_type: 'Replaced', mileage: 52000, timestamp: '2026-08-01T10:00:00Z' },
      { id: 8, vin: CAR.vin, part_name: 'Brakes', action_type: 'Inspected', mileage: 50000, timestamp: '2026-07-01T10:00:00Z', verification_status: 'verified' },
    ])
    api.verifyLedger.mockResolvedValue({ integrity: 'verified' })
    await renderPage()
    expect(await screen.findByTestId('part-row-7')).toHaveTextContent('Radiator')
    expect(screen.getByTestId('owner-parts-table')).toBeInTheDocument()
    expect(screen.getByTestId('part-row-7')).toHaveTextContent('Unreviewed')
    expect(screen.getByTestId('part-row-7')).toHaveTextContent('52,000 km')
    expect(screen.getByTestId('part-row-8')).toHaveTextContent('Verified')
    await waitFor(() => expect(screen.getByTestId('partsentry-integrity')).toHaveAttribute('data-state', 'verified'))
    expect(screen.getByTestId('partsentry-ledger-hero')).toHaveTextContent('2018 Toyota Corolla')
  })

  it('a failed integrity check shows "Verification unavailable", never a pass', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([CAR])
    api.fetchRepairHistory.mockResolvedValue([])
    api.verifyLedger.mockRejectedValue(new Error('ledger unavailable'))
    await renderPage()
    expect(await screen.findByText('Verification unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/Integrity check passed/)).toBeNull()
    expect(screen.getByTestId('parts-ledger-empty')).toBeInTheDocument()
  })

  it('a failed history read is an error state with a retry, not an empty ledger', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([CAR])
    api.fetchRepairHistory.mockRejectedValue(new Error('history unavailable'))
    api.verifyLedger.mockResolvedValue({ integrity: 'verified' })
    await renderPage()
    expect(await screen.findByTestId('parts-ledger-error')).toHaveTextContent('not an empty ledger')
    expect(screen.queryByTestId('owner-parts-table')).toBeNull()
    expect(screen.queryByTestId('parts-ledger-empty')).toBeNull()
  })

  it('a failed car read is an error, not "no cars"', async () => {
    api.fetchOwnedVehicles.mockRejectedValue(new Error('down'))
    await renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an empty ledger')
    expect(screen.queryByTestId('partsentry-no-cars')).toBeNull()
    expect(api.fetchRepairHistory).not.toHaveBeenCalled()
  })

  it('the log form keeps the ledger rules: no description, no write', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([CAR])
    api.fetchRepairHistory.mockResolvedValue([])
    api.verifyLedger.mockResolvedValue({ integrity: 'verified' })
    await renderPage()
    fireEvent.click(await screen.findByTestId('partsentry-log-open'))
    expect(await screen.findByTestId('partsentry-log-dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Vehicle VIN')).toHaveValue(CAR.vin)
    fireEvent.change(screen.getByLabelText(/Part name/), { target: { value: 'Radiator' } })
    fireEvent.change(screen.getByLabelText(/Odometer/), { target: { value: '52000' } })
    fireEvent.click(screen.getByTestId('partsentry-log-submit'))
    expect(toastError).toHaveBeenCalledWith('Describe the work done — this is the record a future buyer will rely on.')
    expect(api.addRepairLog).not.toHaveBeenCalled()
    // The action list is exactly the DB enum.
    expect([...(screen.getByLabelText(/What was done/) as HTMLSelectElement).options].map(o => o.value)).toEqual(['Replaced', 'Repaired', 'Inspected', 'Diagnosed'])
  })
})

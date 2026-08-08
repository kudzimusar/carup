import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Trust-spine audit P0 — the mechanic Service Logs page must offer exactly the
 * DB CHECK action_type values, never seed fabricated logs, and never send a
 * client-chosen mechanic id.
 */

const addRepairLog = vi.fn()
const fetchRepairHistory = vi.fn()

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ addRepairLog, fetchRepairHistory, loading: false }),
}))

const ServiceLogs = (await import('./ServiceLogs')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ServiceLogs.tsx'), 'utf8')

// Fabricated seed rows the audit flagged.
const FORBIDDEN_MOCK_LOGS = ['Toyota Corolla', 'BMW X5', 'Nissan NP300', 'Full Service', 'Timing Belt']

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ServiceLogs mechanic page truthfulness', () => {
  it('renders an honest empty state with no mock logs and no API calls on mount', () => {
    const { container } = render(<ServiceLogs />)

    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_MOCK_LOGS) {
      expect(text, `page must not fabricate "${forbidden}"`).not.toContain(forbidden)
    }
    expect(screen.getByText('No vehicle loaded')).toBeInTheDocument()
    expect(fetchRepairHistory).not.toHaveBeenCalled()
    expect(addRepairLog).not.toHaveBeenCalled()
  })

  it('offers exactly the DB CHECK action_type option values', async () => {
    render(<ServiceLogs />)
    fireEvent.click(screen.getByRole('button', { name: /Add Log/i }))

    const options = await screen.findAllByRole('option')
    const values = options.map(o => (o as HTMLOptionElement).value)
    expect(values).toEqual(['Replaced', 'Repaired', 'Inspected', 'Diagnosed'])
  })

  it('loads real history for an entered VIN and keys success off the returned id', async () => {
    fetchRepairHistory.mockResolvedValue([
      { id: 3, vin: 'VIN0000000000001', part_name: 'Alternator', part_oem: 'ALT-3', action_type: 'Repaired', mileage: 61000, timestamp: '2026-08-02T09:00:00Z' },
    ])

    render(<ServiceLogs />)
    fireEvent.change(screen.getByPlaceholderText(/Enter a vehicle VIN/i), { target: { value: 'VIN0000000000001' } })
    fireEvent.click(screen.getByRole('button', { name: /Load History/i }))

    await waitFor(() => expect(fetchRepairHistory).toHaveBeenCalledWith('VIN0000000000001'))
    expect(await screen.findByText(/Alternator/)).toBeInTheDocument()
  })

  it('treats a response without an id as a failure, never a fake success', async () => {
    addRepairLog.mockResolvedValue({})

    render(<ServiceLogs />)
    fireEvent.click(screen.getByRole('button', { name: /Add Log/i }))

    fireEvent.change(screen.getByPlaceholderText('e.g. JTD12345...'), { target: { value: 'VIN0000000000001' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Brake Pads'), { target: { value: 'Brake Pads' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. BP-TYT-001'), { target: { value: 'BP-01' } })
    fireEvent.change(screen.getByPlaceholderText('Details of the service performed'), { target: { value: 'Front pads' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit to PartSentry/i }))

    await waitFor(() => expect(addRepairLog).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    // The new signature never carries a client-chosen mechanic id.
    expect(addRepairLog).toHaveBeenCalledWith('VIN0000000000001', 'Brake Pads', 'BP-01', 'Replaced', 'Front pads', 0)
  })

  it('source: no mockLogs seed and no hardcoded mechanic id', () => {
    expect(SRC).not.toContain('mockLogs')
    expect(SRC).not.toContain('mech_1')
    expect(SRC).not.toMatch(/res\.success/)
  })
})

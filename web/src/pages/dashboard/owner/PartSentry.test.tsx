import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Trust-spine audit P0 — the owner PartSentry page must never present fabricated
 * parts, fabricated blockchain hashes, or a fake "Ledger Verified" status. Every
 * row must come from the real /partsentry/:vin history and every failure must
 * surface as an error, never as success.
 */

const addRepairLog = vi.fn()
const verifyLedger = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchRepairHistory = vi.fn()

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ addRepairLog, verifyLedger, fetchOwnedVehicles, fetchRepairHistory }),
}))

const PartSentry = (await import('./PartSentry')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'PartSentry.tsx'), 'utf8')

// The fabricated seed rows the 2026-08 audit flagged.
const FORBIDDEN_STATIC_PARTS = ['Engine Oil & Filter', 'Brake Pads (Front)', 'Air Filter', 'Toyota Genuine', 'Akebono', 'K&N Filters', 'AutoPro Bulawayo', 'Simbisa Garages']

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PartSentry owner page truthfulness', () => {
  it('renders an honest empty state with no static parts when the API returns nothing', async () => {
    fetchOwnedVehicles.mockResolvedValue([{ vin: 'VIN0000000000001', make: 'Toyota', model: 'Corolla' }])
    fetchRepairHistory.mockResolvedValue([])
    verifyLedger.mockResolvedValue({ integrity: 'verified' })

    const { container } = render(<PartSentry />)
    await waitFor(() => expect(fetchRepairHistory).toHaveBeenCalledWith('VIN0000000000001'))

    expect(await screen.findByTestId('parts-ledger-empty')).toBeInTheDocument()
    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_STATIC_PARTS) {
      expect(text, `page must not fabricate "${forbidden}"`).not.toContain(forbidden)
    }
  })

  it('renders an empty state without any API at all (every fetch fails)', async () => {
    fetchOwnedVehicles.mockRejectedValue(new Error('backend offline'))
    fetchRepairHistory.mockRejectedValue(new Error('backend offline'))
    verifyLedger.mockRejectedValue(new Error('backend offline'))

    const { container } = render(<PartSentry />)
    await waitFor(() => expect(fetchOwnedVehicles).toHaveBeenCalled())

    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_STATIC_PARTS) {
      expect(text, `offline page must not fabricate "${forbidden}"`).not.toContain(forbidden)
    }
    // No vehicle could load, so no history call and no fabricated ledger rows.
    expect(screen.queryByTestId('owner-parts-table')).not.toBeInTheDocument()
  })

  it('shows a ledger error instead of fake success when verification fails', async () => {
    fetchOwnedVehicles.mockResolvedValue([{ vin: 'VIN0000000000001', make: 'Toyota', model: 'Corolla' }])
    fetchRepairHistory.mockResolvedValue([])
    verifyLedger.mockRejectedValue(new Error('ledger unavailable'))

    render(<PartSentry />)
    await waitFor(() => expect(verifyLedger).toHaveBeenCalled())

    expect(await screen.findByText('Verification unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/Ledger Verified/)).not.toBeInTheDocument()
  })

  it('surfaces a history load failure as an error state, not fabricated rows', async () => {
    fetchOwnedVehicles.mockResolvedValue([{ vin: 'VIN0000000000001', make: 'Toyota', model: 'Corolla' }])
    fetchRepairHistory.mockRejectedValue(new Error('history unavailable'))
    verifyLedger.mockResolvedValue({ integrity: 'verified' })

    render(<PartSentry />)
    expect(await screen.findByTestId('parts-ledger-error')).toBeInTheDocument()
    expect(screen.queryByTestId('owner-parts-table')).not.toBeInTheDocument()
  })

  it('renders real repair history rows returned by the API', async () => {
    fetchOwnedVehicles.mockResolvedValue([{ vin: 'VIN0000000000001', make: 'Toyota', model: 'Corolla' }])
    fetchRepairHistory.mockResolvedValue([
      { id: 7, vin: 'VIN0000000000001', part_name: 'Radiator', part_oem: 'RAD-77', action_type: 'Replaced', mileage: 52000, timestamp: '2026-08-01T10:00:00Z' },
    ])
    verifyLedger.mockResolvedValue({ integrity: 'verified' })

    render(<PartSentry />)
    expect(await screen.findByTestId('part-row-7')).toBeInTheDocument()
    expect(screen.getByText('Radiator')).toBeInTheDocument()
    expect(screen.getByText('Replaced')).toBeInTheDocument()
  })

  it('source: no STATIC_PARTS seed, no hardcoded mechanic id, no fabricated hash, no verified-on-error fallback', () => {
    expect(SRC).not.toContain('STATIC_PARTS')
    expect(SRC).not.toMatch(/['"]u2['"]/)
    expect(SRC).not.toMatch(/Math\.random\(\)/)
    expect(SRC).not.toMatch(/catch\(\(\)\s*=>\s*setLedgerVerified\(true\)\)/)
    expect(SRC).not.toMatch(/setLedgerVerified\(true\)/)
  })

  it('source: action options are exactly the DB CHECK enum', () => {
    expect(SRC).toMatch(/const ACTION_TYPES = \['Replaced', 'Repaired', 'Inspected', 'Diagnosed'\] as const/)
    expect(SRC).not.toContain("'Upgraded'")
    expect(SRC).not.toContain("'Removed'")
  })
})

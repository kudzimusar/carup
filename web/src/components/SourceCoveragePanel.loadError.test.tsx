import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * RX-02 TI-13 — a failed source-coverage read is not "Not yet checked" for every registry.
 * On main the catch replaced the failure with an empty list, so all five registries rendered
 * "Not yet checked" — a statement about each registry that CarUp never received.
 */
vi.setConfig({ testTimeout: 30_000 })

const fetchVehicleSourceCoverage = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchVehicleSourceCoverage }) }))

const { SourceCoveragePanel } = await import('./SourceCoveragePanel')

beforeEach(() => { vi.clearAllMocks() })

describe('SourceCoveragePanel — failed read (TI-13)', () => {
  it('announces the failure and claims no per-registry status', async () => {
    fetchVehicleSourceCoverage.mockRejectedValue(new Error('HTTP 503'))
    render(<SourceCoveragePanel vin="TESTVIN0000000001" />)

    const alert = await screen.findByTestId('source-coverage-unavailable')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent).toMatch(/could not be loaded/i)
    expect(screen.queryByText('Not yet checked')).toBeNull()
    for (const p of ['zimra', 'cvr', 'zinara', 'vid', 'cid']) {
      expect(screen.queryByTestId(`source-row-${p}`)).toBeNull()
    }
  })

  it('a successful empty read still shows every registry as not yet checked', async () => {
    fetchVehicleSourceCoverage.mockResolvedValue({ coverage: [] })
    render(<SourceCoveragePanel vin="TESTVIN0000000001" />)

    await waitFor(() => expect(screen.getAllByText('Not yet checked')).toHaveLength(5))
    expect(screen.queryByTestId('source-coverage-unavailable')).toBeNull()
  })
})

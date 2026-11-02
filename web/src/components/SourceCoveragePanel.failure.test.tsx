/**
 * PC01-J-R1 — a failed source-coverage read is stated as a failure, never as "Not yet checked".
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const fetchVehicleSourceCoverage = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchVehicleSourceCoverage }) }))

const { SourceCoveragePanel } = await import('./SourceCoveragePanel')

describe('SourceCoveragePanel when the read fails', () => {
  it('says it could not load, and publishes no per-source status', async () => {
    fetchVehicleSourceCoverage.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    render(<SourceCoveragePanel vin="GFC27-027051" />)

    expect(await screen.findByTestId('source-coverage-unavailable')).toHaveTextContent('This is not a result about the vehicle.')
    expect(screen.queryByText('Not yet checked')).toBeNull()
    expect(screen.queryByTestId('source-row-zimra')).toBeNull()
  })

  it('still renders a genuinely empty coverage result as rows', async () => {
    fetchVehicleSourceCoverage.mockResolvedValue({ coverage: [] })
    render(<SourceCoveragePanel vin="GFC27-027051" />)
    expect(await screen.findByTestId('source-row-zimra')).toBeTruthy()
  })
})

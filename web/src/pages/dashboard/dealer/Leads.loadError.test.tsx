import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * RX-02 TI-13 — a failed dealer-leads read is not "No leads yet".
 * On main the catch was a no-op, so a dealer whose leads could not be read was told their
 * pipeline was empty.
 */
vi.setConfig({ testTimeout: 30_000 })

const fetchDealerLeads = vi.fn()
const fetchMyMarketplaceInquiries = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchDealerLeads, fetchMyMarketplaceInquiries, loading: false }),
}))

const Leads = (await import('./Leads')).default
const renderLeads = () => render(<MemoryRouter><Leads /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  fetchMyMarketplaceInquiries.mockResolvedValue({ inquiries: [] })
})

describe('dealer Leads — failed read (TI-13)', () => {
  it('announces the failure instead of the empty pipeline state', async () => {
    fetchDealerLeads.mockRejectedValue(new Error('HTTP 500'))
    renderLeads()

    const alert = await screen.findByTestId('dealer-leads-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent).toMatch(/could not be loaded/i)
    expect(screen.queryByTestId('dealer-leads-empty')).toBeNull()
    expect(screen.queryByText('No leads yet')).toBeNull()
  })

  it('a successful empty read keeps the honest "No leads yet" state', async () => {
    fetchDealerLeads.mockResolvedValue([])
    renderLeads()
    await waitFor(() => expect(screen.getByTestId('dealer-leads-empty').textContent).toContain('No leads yet'))
    expect(screen.queryByTestId('dealer-leads-error')).toBeNull()
  })
})

/**
 * O2-X5A — WorkbookTools page pins: the page renders ONLY the server-derived
 * catalogue; unavailable templates appear with honest reasons, never vanish.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WorkbookTools from './WorkbookTools'

const fetchWorkbookCatalogue = vi.fn()
const workspaceApi = {
  downloadWorkbookFile: vi.fn(), inspectWorkbook: vi.fn(), confirmWorkbookMappings: vi.fn(),
  runWorkbookDryRun: vi.fn(), executeVehicleWorkbookBatch: vi.fn(),
  fetchRecentWorkbookImports: vi.fn().mockResolvedValue({ imports: [] }),
  explainWorkbookField: vi.fn(), suggestWorkbookCorrections: vi.fn(),
}

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchWorkbookCatalogue, ...workspaceApi }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'seller-1', role: 'owner' } }),
}))

describe('WorkbookTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceApi.fetchRecentWorkbookImports.mockResolvedValue({ imports: [] })
    fetchWorkbookCatalogue.mockResolvedValue({
      available: [
        { template_key: 'seller_vehicles', label: 'My Vehicle Listings', version: 'v1', engine: 'registry', actions: ['template', 'export', 'import', 'recent_imports'], note: 'Imported vehicles are private DRAFTS under your own listing authority — publication stays a separate governed step.' },
      ],
      unavailable: [
        { template_key: 'dealer_vehicle_inventory', reason: 'business_context_required' },
        { template_key: 'garage_service_workbook', reason: 'service_network_reconciliation_required' },
        { template_key: 'insurer_decision_workbook', reason: 'provider_platform_is_the_integration_surface' },
      ],
    })
  })

  it('renders the server-derived catalogue, opens the workspace for the granted template, and keeps the drafts-only framing', async () => {
    render(<MemoryRouter><WorkbookTools /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('catalogue-available')).toBeTruthy())
    expect(screen.getAllByText('My Vehicle Listings').length).toBeGreaterThan(0)
    expect(screen.getByTestId('catalogue-available').textContent).toMatch(/private DRAFTS/)
    await waitFor(() => expect(screen.getByTestId('workbook-workspace')).toBeTruthy())
  })

  it('unavailable templates stay visible with honest reasons — deferred stays deferred', async () => {
    render(<MemoryRouter><WorkbookTools /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('catalogue-unavailable')).toBeTruthy())
    expect(screen.getByTestId('unavailable-dealer_vehicle_inventory').textContent).toMatch(/Needs a registered business context/)
    expect(screen.getByTestId('unavailable-garage_service_workbook').textContent).toMatch(/Service Network reconciliation required/)
    expect(screen.getByTestId('unavailable-insurer_decision_workbook').textContent).toMatch(/provider platform, not spreadsheets/)
  })
})

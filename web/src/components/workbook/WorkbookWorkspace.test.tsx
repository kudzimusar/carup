/**
 * O2-X5A — WorkbookWorkspace pins.
 *
 * The CarUp AI Workbook Assistant is VISIBLE; AI proposals are visually
 * distinct from deterministic matches; the dry run stays disabled until the
 * mapping is confirmed; the import executes only by explicit confirmation and
 * reports drafts (never publication); recent imports render scoped data.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WorkbookWorkspace from './WorkbookWorkspace'

const downloadWorkbookFile = vi.fn()
const inspectWorkbook = vi.fn()
const confirmWorkbookMappings = vi.fn()
const runWorkbookDryRun = vi.fn()
const executeVehicleWorkbookBatch = vi.fn()
const fetchRecentWorkbookImports = vi.fn()
const explainWorkbookField = vi.fn()
const suggestWorkbookCorrections = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    downloadWorkbookFile, inspectWorkbook, confirmWorkbookMappings, runWorkbookDryRun,
    executeVehicleWorkbookBatch, fetchRecentWorkbookImports, explainWorkbookField, suggestWorkbookCorrections,
  }),
}))

const INSPECTION = {
  checksum: 'c'.repeat(64),
  schema_version: '2026.09.x5a.vehicle-v1',
  sheets: [
    {
      sheet_name: 'VEHICLES', row_count: 2,
      headers: ['VIN / Vehicle Identifier', 'Reg Stage??', 'Mystery Column'],
      canonical_columns: ['vin', 'registration_status', 'make'],
      proposals: [
        { source: 'VIN / Vehicle Identifier', proposed_target: 'vin', confidence: 1, provider: 'deterministic' },
        { source: 'Reg Stage??', proposed_target: 'registration_status', confidence: 0.82, provider: 'ai' },
        { source: 'Mystery Column', proposed_target: null, confidence: null, provider: 'unmapped' },
      ],
    },
  ],
}

const DRY_RUN = {
  batchId: 'batch-1', canImport: true,
  totals: { vehicleCount: 2, acceptedVehicles: 2, blockedVehicles: 0, warningCount: 1, errorCount: 0 },
  summary: { headline: '2 vehicles ready to import · 1 note for your attention · 0 blocked', lines: ['0 authority decisions will be imported — verification, compliance, trust and publication are never part of a workbook.'] },
  attention: { count: 1, needs_attention: [{ sheet_name: 'VEHICLES', row: 2, field: 'transmission', severity: 'warning', code: 'VALUE_NORMALIZED', message: "'Auto' was recognized as 'Automatic'.", explanation: 'Converted to the canonical form — nothing to fix.' }] },
}

function pickAndInspect() {
  const file = new File(['fake'], 'stock.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  fireEvent.change(screen.getByTestId('wb-file'), { target: { files: [file] } })
  return waitFor(() => expect((screen.getByTestId('wb-inspect') as HTMLButtonElement).disabled).toBe(false))
    .then(() => fireEvent.click(screen.getByTestId('wb-inspect')))
}

describe('WorkbookWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectWorkbook.mockResolvedValue(INSPECTION)
    confirmWorkbookMappings.mockResolvedValue({ success: true, confirmed: 1 })
    runWorkbookDryRun.mockResolvedValue(DRY_RUN)
    executeVehicleWorkbookBatch.mockResolvedValue({ created: 2, failed: 0, importStatus: 'IMPORTED' })
    fetchRecentWorkbookImports.mockResolvedValue({ imports: [] })
  })

  it('shows the four actions and the NAMED CarUp AI Workbook Assistant, with proposal provenance visually distinct', async () => {
    render(<WorkbookWorkspace templateKey="seller_vehicles" />)
    for (const tab of ['tab-template', 'tab-export', 'tab-import', 'tab-recent']) {
      expect(screen.getByTestId(tab)).toBeTruthy()
    }
    expect(screen.getByTestId('assistant-panel').textContent).toMatch(/CarUp AI Workbook Assistant/)
    expect(screen.getByTestId('assistant-panel').textContent).toMatch(/It proposes — you decide/)

    await pickAndInspect()
    await waitFor(() => expect(screen.getByTestId('mapping-sheet-VEHICLES')).toBeTruthy())
    expect(screen.getByTestId('provider-deterministic').textContent).toBe('matched')
    expect(screen.getByTestId('provider-ai').textContent).toBe('AI PROPOSAL')
    expect(screen.getByTestId('provider-unmapped').textContent).toBe('unmapped')
  })

  it('gates the chain: dry run disabled until the mapping is confirmed; the confirm payload binds the exact checksum', async () => {
    render(<WorkbookWorkspace templateKey="seller_vehicles" />)
    await pickAndInspect()
    await waitFor(() => expect(screen.getByTestId('wb-dry-run')).toBeTruthy())
    expect((screen.getByTestId('wb-dry-run') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('target-VEHICLES-Mystery Column'), { target: { value: 'make' } })
    fireEvent.click(screen.getByTestId('wb-confirm-mapping'))
    await waitFor(() => expect(confirmWorkbookMappings).toHaveBeenCalledTimes(1))
    const payload = confirmWorkbookMappings.mock.calls[0][0]
    expect(payload.workbook_checksum).toBe('c'.repeat(64))
    expect(payload.sheets[0].mappings).toEqual([
      { source: 'VIN / Vehicle Identifier', target: 'vin' },
      { source: 'Reg Stage??', target: 'registration_status' },
      { source: 'Mystery Column', target: 'make' },
    ])
    await waitFor(() => expect((screen.getByTestId('wb-dry-run') as HTMLButtonElement).disabled).toBe(false))
  })

  it('dry run renders the summary (zero-authority line), the attention table, and executes only by explicit click — reporting DRAFTS', async () => {
    render(<WorkbookWorkspace templateKey="seller_vehicles" />)
    await pickAndInspect()
    await waitFor(() => expect(screen.getByTestId('wb-confirm-mapping')).toBeTruthy())
    fireEvent.click(screen.getByTestId('wb-confirm-mapping'))
    await waitFor(() => expect((screen.getByTestId('wb-dry-run') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('wb-dry-run'))
    await waitFor(() => expect(screen.getByTestId('wb-summary')).toBeTruthy())
    expect(screen.getByTestId('wb-summary').textContent).toMatch(/0 authority decisions will be imported/)
    expect(screen.getByTestId('wb-attention').textContent).toMatch(/Automatic/)
    expect(executeVehicleWorkbookBatch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('wb-execute'))
    await waitFor(() => expect(executeVehicleWorkbookBatch).toHaveBeenCalledWith('batch-1'))
    await waitFor(() => expect(screen.getByTestId('wb-executed').textContent).toMatch(/2 created as private drafts/))
    expect(screen.getByTestId('wb-executed').textContent).toMatch(/nothing is published by an import/)
  })

  it('the assistant explains a column from the registry on demand', async () => {
    explainWorkbookField.mockResolvedValue({
      header: 'Registration stage',
      explanation: 'Where the vehicle is in the Zimbabwe registration journey.',
      allowed_values: [{ label: 'Customs cleared — local registration pending' }],
    })
    render(<WorkbookWorkspace templateKey="seller_vehicles" />)
    await pickAndInspect()
    await waitFor(() => expect(screen.getByTestId('explain-VEHICLES-Reg Stage??')).toBeTruthy())
    fireEvent.click(screen.getByTestId('explain-VEHICLES-Reg Stage??'))
    await waitFor(() => expect(screen.getByTestId('assistant-explanation').textContent).toMatch(/Zimbabwe registration journey/))
    expect(screen.getByTestId('assistant-explanation').textContent).toMatch(/Customs cleared — local registration pending/)
  })

  it('Recent Imports lists this template\'s scoped batches', async () => {
    fetchRecentWorkbookImports.mockResolvedValue({
      imports: [
        { batch_id: 'b1', template_key: 'seller_vehicles', source_filename: 'stock.xlsx', uploaded_at: '2026-09-04T10:00:00Z', total_rows: 3, accepted_rows: 2, rejected_rows: 1, import_status: 'IMPORTED', can_execute: false },
        { batch_id: 'b2', template_key: 'dealer_vehicle_inventory', source_filename: 'other.xlsx', uploaded_at: '2026-09-04T09:00:00Z', total_rows: 1, accepted_rows: 1, rejected_rows: 0, import_status: 'VALIDATED', can_execute: true },
      ],
    })
    render(<WorkbookWorkspace templateKey="seller_vehicles" />)
    fireEvent.click(screen.getByTestId('tab-recent'))
    await waitFor(() => expect(screen.getByTestId('wb-recent').textContent).toMatch(/stock\.xlsx/))
    expect(screen.getByTestId('wb-recent').textContent).not.toMatch(/other\.xlsx/)
    expect(screen.getByTestId('wb-recent').textContent).toMatch(/2\/3 accepted/)
  })
})

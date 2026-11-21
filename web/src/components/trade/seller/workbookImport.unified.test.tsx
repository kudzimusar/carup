/**
 * RX-06 — /diaspora/workbook/import unified desk. Fictional data only.
 *
 * Proves: flag OFF keeps the legacy page; the UI flag fails closed; dry-run results come first and
 * values the summary did NOT carry are said to be missing (checksum, revision, quota) instead of being
 * defaulted into claims; with no checksum on screen Confirm stays disabled with the reason; Import is
 * locked until a confirmation is pending; a needs-operator result offers no retry; unreadable receipts
 * and an unreadable / tenant-less interrupted check are never "none"; load failures are classified.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  flagOn: true,
  summary: null as unknown,
  summaryError: null as unknown,
  receipts: [] as unknown[],
  receiptsError: null as unknown,
  interrupted: [] as unknown[],
  interruptedError: null as unknown,
  confirmation: null as unknown,
  execution: null as unknown,
  calls: { summary: 0, receipts: 0, interrupted: 0, confirm: 0, execute: 0 },
}))
const auth = vi.hoisted(() => ({
  user: { id: 'u1', role: 'dealer', active_tenant_id: 'tenant-1' } as { id: string; role: string; active_tenant_id?: string | null } | null,
  isAuthenticated: true,
  loading: false,
}))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/config/confirmedImportFlag', () => ({ workbookImportUiEnabled: () => fx.flagOn }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const methods = vi.hoisted(() => ({
  getWorkbookInterruptedImports: async () => { fx.calls.interrupted += 1; if (fx.interruptedError) throw fx.interruptedError; return fx.interrupted },
  getWorkbookImportReceipts: async () => { fx.calls.receipts += 1; if (fx.receiptsError) throw fx.receiptsError; return fx.receipts },
  getDiasporaWorkbookImportBatchSummary: async () => { fx.calls.summary += 1; if (fx.summaryError) throw fx.summaryError; return fx.summary },
  confirmWorkbookImport: async () => { fx.calls.confirm += 1; return { data: fx.confirmation, idempotentReplay: false } },
  executeWorkbookImport: async () => { fx.calls.execute += 1; return fx.execution },
}))
// Like the real hook: stable methods inside a FRESH object on every render.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: DiasporaConfirmedImport } = await import('@/pages/diaspora/DiasporaConfirmedImport')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const CHECKSUM = 'ab12'.repeat(16)

/** What GET /summary actually returns today: camelCase totals, no checksum, no revision, no quota. */
const realShapeSummary = () => ({
  batchId: 'batch-fixture-1', importStatus: 'VALIDATED', templateType: 'seller', totalRows: 3, acceptedRows: 3, warningRows: 0,
  rejectedRows: 0, errorCount: 0, warningCount: 0, rowsBySheet: { Stock: 3 }, rowsByValidationStatus: { ACCEPTED: 3 },
  rowsByTargetTable: { diaspora_stock_items: 3 }, rowsByActionType: { CREATE: 3 },
})
const fullSummary = () => ({ ...realShapeSummary(), checksum_sha256: CHECKSUM, dry_run_revision: 2, quotaAllowed: true })
const pendingConfirmation = () => ({
  id: 'conf-1', tenant_id: 'tenant-1', batch_id: 'batch-fixture-1', workbook_checksum: CHECKSUM, dry_run_revision: 2, confirmed_by: 'u1',
  confirmed_at: '2026-11-21T06:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', idempotency_key: 'k', state: 'pending', row_count: 3,
})
const receipt = (n: number, over: Record<string, unknown> = {}) => ({
  id: `r${n}`, batch_id: 'batch-fixture-1', row_number: n, sheet_name: 'Stock', outcome: 'accepted', entity_type: 'stock_item',
  entity_ref: `stk-fixture-${n}`, error_code: null, error_message: null, compensated_at: null, attempt: 1, created_at: '2026-11-21T06:01:00.000Z', ...over,
})

const renderPage = () => render(<MemoryRouter><DiasporaConfirmedImport /></MemoryRouter>)
async function loadBatch(id = 'batch-fixture-1') {
  fireEvent.change(await screen.findByTestId('wi-batch-input'), { target: { value: id } })
  fireEvent.click(screen.getByTestId('wi-load-submit'))
}

beforeEach(() => {
  fx.unified = true
  fx.flagOn = true
  fx.summary = realShapeSummary()
  fx.summaryError = null
  fx.receipts = []
  fx.receiptsError = null
  fx.interrupted = []
  fx.interruptedError = null
  fx.confirmation = pendingConfirmation()
  fx.execution = { imported: true, batchId: 'batch-fixture-1', confirmationId: 'conf-1', status: 'IMPORTED', appliedRows: 3, userMessage: 'All 3 rows were imported.' }
  fx.calls = { summary: 0, receipts: 0, interrupted: 0, confirm: 0, execute: 0 }
  auth.user = { id: 'u1', role: 'dealer', active_tenant_id: 'tenant-1' }
  auth.isAuthenticated = true
  auth.loading = false
})

describe('DiasporaConfirmedImport — unified desk: gating and first step', () => {
  it('flag OFF keeps the legacy page', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('confirmed-import-page')).toBeInTheDocument()
    expect(screen.queryByTestId('wi-desk')).toBeNull()
  })

  it('the workbook import UI flag fails closed and fetches nothing', async () => {
    fx.flagOn = false
    renderPage()
    expect(await screen.findByTestId('wi-unavailable')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(fx.calls.interrupted).toBe(0)
  })

  it('signed out → sign-in state', async () => {
    auth.isAuthenticated = false
    auth.user = null
    renderPage()
    expect(await screen.findByTestId('wi-signin')).toBeInTheDocument()
  })

  it('starts at step 1 and tells a dealer who produces a dry run (no operator-only links)', async () => {
    renderPage()
    expect(await screen.findByTestId('wi-step-load')).toHaveAttribute('data-state', 'current')
    const help = screen.getByTestId('wi-dryrun-help')
    expect(help).toHaveTextContent('CarUp operators run')
    expect(within(help).queryByRole('link')).toBeNull()
    expect(await screen.findByTestId('wi-interrupted-none')).toBeInTheDocument()
  })

  it('operators get the dry-run console links', async () => {
    auth.user = { id: 'op-1', role: 'admin', active_tenant_id: 'tenant-1' }
    renderPage()
    const help = await screen.findByTestId('wi-dryrun-help')
    expect(within(help).getByRole('link', { name: 'Start a dry run' })).toHaveAttribute('href', '/admin/diaspora/workbooks/new')
  })
})

describe('DiasporaConfirmedImport — unified desk: review → confirm → import', () => {
  it('the real summary shape carries no checksum: missing values are said, and Confirm stays disabled with the reason', async () => {
    renderPage()
    await loadBatch()
    expect(await screen.findByTestId('wi-review')).toBeInTheDocument()
    expect(screen.getByTestId('wi-checksum')).toHaveTextContent('Not included in this read')
    expect(screen.getByTestId('wi-revision')).toHaveTextContent('Not provided by this read (shown as 1 by default)')
    expect(screen.getByTestId('wi-quota')).toHaveTextContent('Plan capacity was not reported by this read')
    expect(screen.getByTestId('wi-breakdowns')).toHaveTextContent('Stock')
    expect(screen.getByTestId('wi-checksum-missing')).toHaveTextContent('Nothing about your workbook changed')
    const confirm = screen.getByTestId('wi-confirm-submit')
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(fx.calls.confirm).toBe(0)
    expect(screen.getByTestId('wi-execute')).toBeDisabled()
  })

  it('nothing imports without a pending confirmation; then the outcome and receipts render as returned', async () => {
    fx.summary = fullSummary()
    renderPage()
    await loadBatch()
    expect(await screen.findByTestId('wi-checksum')).toHaveTextContent(CHECKSUM)
    expect(screen.getByTestId('wi-revision')).toHaveTextContent('2')
    expect(screen.getByTestId('wi-quota')).toHaveTextContent('Your plan has capacity for this import.')
    const execute = screen.getByTestId('wi-execute')
    expect(execute).toBeDisabled()
    fireEvent.click(execute)
    expect(fx.calls.execute).toBe(0)

    fireEvent.click(screen.getByTestId('wi-confirm-submit'))
    expect(await screen.findByTestId('wi-confirmation')).toHaveTextContent('Confirmed by you for revision 2')
    expect(screen.getByTestId('wi-step-import')).toHaveAttribute('data-state', 'current')
    fx.receipts = [receipt(1), receipt(2), receipt(3)]
    fireEvent.click(screen.getByTestId('wi-execute'))
    expect(await screen.findByTestId('wi-outcome-success')).toHaveTextContent('All 3 rows were imported.')
    expect(fx.calls.execute).toBe(1)
    const table = await screen.findByTestId('wi-receipts-table')
    expect(within(table).getByRole('columnheader', { name: 'Row (order)' })).toBeInTheDocument()
    expect(within(table).getByTestId('wi-receipt-2')).toHaveTextContent('Imported')
    expect(screen.getByTestId('wi-download-csv')).toBeInTheDocument()
  })

  it('invalid rows block confirmation with the helper’s own reason', async () => {
    fx.summary = { ...fullSummary(), rejectedRows: 2, acceptedRows: 1 }
    renderPage()
    await loadBatch()
    expect(await screen.findByTestId('wi-confirm-blocked')).toHaveTextContent('Some rows failed validation')
    expect(screen.getByTestId('wi-confirm-submit')).toBeDisabled()
  })

  it('a needs-operator result says do not retry and offers no retry, confirm or import control', async () => {
    fx.summary = fullSummary()
    fx.execution = { imported: false, batchId: 'batch-fixture-1', confirmationId: 'conf-1', status: 'NEEDS_OPERATOR', compensationFailures: 1, userMessage: 'Part of this import could not be reversed.' }
    fx.receipts = [receipt(1, { outcome: 'compensated' }), receipt(2, { outcome: 'rejected', error_message: 'Bad price' })]
    renderPage()
    await loadBatch()
    fireEvent.click(await screen.findByTestId('wi-confirm-submit'))
    await screen.findByTestId('wi-confirmation')
    fireEvent.click(screen.getByTestId('wi-execute'))
    const outcome = await screen.findByTestId('wi-outcome-needs-operator')
    expect(within(outcome).getByTestId('wi-do-not-retry')).toHaveTextContent('Do not retry this import.')
    expect(screen.queryByTestId('wi-confirm-submit')).toBeNull()
    expect(screen.queryByTestId('wi-execute')).toBeNull()
    expect(screen.queryByTestId('wi-safe-to-retry')).toBeNull()
    expect(within(screen.getByTestId('wi-outcome')).queryByRole('button')).toBeNull()
  })

  it('unreadable receipts are not zero rows, and the rejected figure says it is not known', async () => {
    fx.summary = fullSummary()
    fx.execution = { imported: false, batchId: 'batch-fixture-1', confirmationId: 'conf-1', status: 'COMPENSATED', compensatedRows: 2, userMessage: 'Nothing was imported.' }
    renderPage()
    await loadBatch()
    fireEvent.click(await screen.findByTestId('wi-confirm-submit'))
    await screen.findByTestId('wi-confirmation')
    fx.receiptsError = httpError(500, 'boom')
    fireEvent.click(screen.getByTestId('wi-execute'))
    expect(await screen.findByTestId('wi-receipts-unreadable')).toHaveTextContent('This is not a report of zero rows.')
    expect(screen.getByTestId('wi-result-rejected')).toHaveTextContent('Not known')
    expect(screen.getByTestId('wi-safe-to-retry')).toBeInTheDocument()
  })
})

describe('DiasporaConfirmedImport — unified desk: failures and recovery', () => {
  it('load failures are classified: 404 explains visibility, 403 is denied', async () => {
    fx.summaryError = httpError(404, 'Workbook import batch not found')
    const { unmount } = renderPage()
    await loadBatch('nope')
    const failed = await screen.findByTestId('wi-load-failed')
    expect(failed).toHaveAttribute('data-state', 'unavailable')
    expect(failed).toHaveTextContent('No dry-run batch with this id is visible to this account')
    expect(screen.queryByTestId('wi-error')).toBeNull()
    unmount()
    fx.summaryError = httpError(403, 'Forbidden')
    renderPage()
    await loadBatch('nope')
    expect(await screen.findByTestId('wi-load-failed')).toHaveAttribute('data-state', 'denied')
  })

  it('an unreadable interrupted-import check is never "none", says why, and can be retried', async () => {
    fx.interruptedError = httpError(429, 'Too many requests. Please try again later.')
    renderPage()
    const unreadable = await screen.findByTestId('wi-interrupted-unreadable')
    expect(unreadable).toHaveTextContent('not confirmation that there are none')
    expect(within(unreadable).getByRole('alert')).toHaveAttribute('data-state', 'limited')
    expect(screen.queryByTestId('wi-interrupted-none')).toBeNull()
    fx.interruptedError = null
    const before = fx.calls.interrupted
    fireEvent.click(within(unreadable).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(fx.calls.interrupted).toBe(before + 1))
    await waitFor(() => expect(screen.queryByTestId('wi-interrupted-unreadable')).toBeNull())
  })

  it('with no organisation selected the empty interrupted check is not reported as none', async () => {
    auth.user = { id: 'u1', role: 'dealer', active_tenant_id: null }
    renderPage()
    expect(await screen.findByTestId('wi-interrupted-no-tenant')).toHaveTextContent('not confirmation that no import was interrupted')
    expect(screen.queryByTestId('wi-interrupted-none')).toBeNull()
  })

  it('interrupted imports needing a human say do not retry', async () => {
    fx.interrupted = [{ id: 'batch-stuck-1', tenantId: 'tenant-1', status: 'NEEDS_OPERATOR', totalRows: 4, updatedAt: '2026-11-20T10:00:00.000Z', confirmedImport: null, needsHuman: true }]
    renderPage()
    expect(await screen.findByTestId('wi-interrupted-needs-human-batch-stuck-1')).toHaveTextContent('do not retry')
    await waitFor(() => expect(fx.calls.interrupted).toBe(1))
  })
})

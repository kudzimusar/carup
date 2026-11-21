/**
 * RX-06 — /diaspora/stock unified seller desk. Fictional data only.
 *
 * Proves: flag OFF keeps the legacy page; the desk renders from the page's own reads; empty, failed,
 * refused (403), rate-limited (429) and role-denied are different states; the publish check is a
 * read-out (the Publish button still asks the server); quantities only change through a recorded
 * movement; supply-document reads that fail are never shown as "none"; and the list is read ONCE
 * (the pre-existing refetch loop stays fixed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DiasporaStockItem, DiasporaStockLedgerEntry, DiasporaSupplyDocument } from '@/types'

const fx = vi.hoisted(() => ({
  unified: true,
  role: 'dealer',
  items: [] as unknown[],
  docs: [] as unknown[],
  ledger: [] as unknown[],
  listError: null as unknown,
  docsError: null as unknown,
  ledgerError: null as unknown,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
}))
const auth = vi.hoisted(() => ({ user: { id: 'viewer-1', role: 'dealer' }, isAuthenticated: true, loading: false }))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const methods = vi.hoisted(() => {
  const log = (fn: string, args: unknown[]) => fx.calls.push({ fn, args })
  return {
    fetchDiasporaStockItems: async (...a: unknown[]) => { log('list', a); if (fx.listError) throw fx.listError; return fx.items },
    fetchDiasporaSupplyDocuments: async (...a: unknown[]) => { log('docs', a); if (fx.docsError) throw fx.docsError; return fx.docs },
    fetchDiasporaStockLedger: async (...a: unknown[]) => { log('ledger', a); if (fx.ledgerError) throw fx.ledgerError; return fx.ledger },
    appendDiasporaStockMovement: async (...a: unknown[]) => { log('move', a); return { ledgerEntry: {}, stockItem: fx.items[0] } },
    publishDiasporaStockItem: async (...a: unknown[]) => { log('publish', a); throw Object.assign(new Error('Cannot publish: missing required fields unit_price'), { status: 400 }) },
    unpublishDiasporaStockItem: async (...a: unknown[]) => { log('unpublish', a); return fx.items[0] },
    updateDiasporaStockItem: async (...a: unknown[]) => { log('update', a); return fx.items[0] },
    createDiasporaStockItem: async (...a: unknown[]) => { log('create', a); return fx.items[0] },
    createDiasporaSupplyDocument: async (...a: unknown[]) => { log('createDoc', a); return {} },
    publishDiasporaSupplyDocument: async (...a: unknown[]) => { log('publishDoc', a); return {} },
    unpublishDiasporaSupplyDocument: async (...a: unknown[]) => { log('unpublishDoc', a); return {} },
  }
})
// Like the real hook: stable methods inside a FRESH object on every render.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: DiasporaStockManager } = await import('@/pages/diaspora/DiasporaStockManager')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

const item = (over: Partial<DiasporaStockItem> = {}): DiasporaStockItem => ({
  id: 'stk-fixture-1', part_name: 'FICTIONAL brake pad set', sku: 'FX-BRK-001', part_number: null, oem_number: null,
  condition: 'NEW', unit_price: null, currency: 'USD', vehicle_make: 'Toyota', publication_status: 'PRIVATE',
  verification_status: 'UNVERIFIED', export_readiness_status: 'DRAFT', balances: { onHand: 10, reserved: 2, available: 8 },
  updated_at: '2026-11-20T09:00:00Z', ...over,
})
const ledgerRow = (over: Partial<DiasporaStockLedgerEntry> = {}): DiasporaStockLedgerEntry => ({
  id: 'led-1', stock_item_id: 'stk-fixture-1', action_type: 'ADD', quantity_delta: 10, quantity_before: 0, quantity_after: 10,
  notes: 'Opening balance', created_at: '2026-11-20T08:00:00Z', created_by: 'viewer-1',
  metadata: { reservedBefore: 0, reservedAfter: 0, availableAfter: 10 }, ...over,
})
const doc = (over: Partial<DiasporaSupplyDocument> = {}): DiasporaSupplyDocument => ({
  id: 'doc-1', document_number: 'FX-SUP-77', title: 'FICTIONAL supplier invoice', status: 'DRAFT', origin_country: 'JP', ...over,
})

const renderPage = () => render(<MemoryRouter><DiasporaStockManager /></MemoryRouter>)
const count = (fn: string) => fx.calls.filter((c) => c.fn === fn).length

beforeEach(() => {
  fx.unified = true
  fx.items = []
  fx.docs = []
  fx.ledger = []
  fx.listError = null
  fx.docsError = null
  fx.ledgerError = null
  fx.calls = []
  auth.user = { id: 'viewer-1', role: 'dealer' }
  auth.isAuthenticated = true
  auth.loading = false
})

describe('DiasporaStockManager — unified seller desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('diaspora-stock-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-stock-desk')).toBeNull()
  })

  it('renders the desk with a truthful empty state and reads the list exactly once', async () => {
    renderPage()
    expect(await screen.findByTestId('trade-stock-empty')).toHaveTextContent('No stock lines yet')
    expect(screen.getByRole('heading', { level: 1, name: 'Stock ledger' })).toBeInTheDocument()
    expect(screen.getByTestId('trade-stock-pulse-lines')).toHaveTextContent('0')
    await new Promise((r) => setTimeout(r, 150))
    expect(count('list')).toBe(1)
    expect(count('docs')).toBe(1)
  })

  it('the editorial still appears only on a successful empty read — with its disclosure, never beside stock data or a failure', async () => {
    const a = renderPage()
    expect(await screen.findByTestId('trade-stock-empty')).toBeInTheDocument()
    expect(screen.getByTestId('trade-still-dealerForecourt')).toBeInTheDocument()
    expect(screen.getByTestId('trade-still-disclosure')).toBeInTheDocument()
    a.unmount()
    fx.items = [item()]
    const b = renderPage()
    await screen.findByTestId('trade-stock-row-stk-fixture-1')
    expect(screen.queryByTestId('trade-still-dealerForecourt')).toBeNull()
    b.unmount()
    fx.items = []
    fx.listError = httpError(500, 'boom')
    renderPage()
    await screen.findByTestId('trade-stock-list-failed')
    expect(screen.queryByTestId('trade-still-dealerForecourt')).toBeNull()
  })

  it('a failed list read is a failure with a retry, never the empty state', async () => {
    fx.listError = httpError(503, 'Service temporarily unavailable')
    renderPage()
    const failed = await screen.findByTestId('trade-stock-list-failed')
    expect(failed).toHaveAttribute('data-state', 'failed')
    expect(failed).toHaveTextContent('This is not an empty result')
    expect(screen.queryByTestId('trade-stock-empty')).toBeNull()
    fx.listError = null
    fx.items = [item()]
    fireEvent.click(within(failed).getByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('trade-stock-row-stk-fixture-1')).toBeInTheDocument()
  })

  it('403, 404 and 429 are their own states', async () => {
    fx.listError = httpError(403, 'Forbidden')
    const { unmount } = renderPage()
    expect(await screen.findByTestId('trade-stock-list-failed')).toHaveAttribute('data-state', 'denied')
    unmount()
    fx.listError = httpError(429, 'Too many requests. Please try again later.')
    const second = renderPage()
    expect(await screen.findByTestId('trade-stock-list-failed')).toHaveAttribute('data-state', 'limited')
    second.unmount()
    fx.listError = httpError(404, 'Not found')
    renderPage()
    expect(await screen.findByTestId('trade-stock-list-failed')).toHaveAttribute('data-state', 'unavailable')
  })

  it('a role outside seller/reviewer gets the denied state and no read', async () => {
    auth.user = { id: 'viewer-2', role: 'member' }
    renderPage()
    expect(await screen.findByTestId('trade-stock-denied')).toHaveTextContent('Stock management is for seller and reviewer roles')
    expect(count('list')).toBe(0)
  })

  it('opening a line shows ledger balances, the publish read-out and the ledger exactly as returned', async () => {
    fx.items = [item()]
    fx.ledger = [ledgerRow(), ledgerRow({ id: 'led-2', action_type: 'RESERVE', quantity_delta: 0, quantity_before: 10, quantity_after: 10, notes: null, created_at: '2026-11-20T08:30:00Z', created_by: 'someone-else-0001', metadata: { reservedBefore: 0, reservedAfter: 2 } })]
    renderPage()
    fireEvent.click(await screen.findByTestId('trade-stock-row-stk-fixture-1'))
    const file = await screen.findByTestId('trade-stock-file')
    expect(within(file).getByTestId('trade-stock-balance-onhand')).toHaveTextContent('10')
    expect(within(file).getByTestId('trade-stock-balance-available')).toHaveTextContent('8')
    // Missing price → the next move is to complete details, and the read-out says what is missing.
    expect(within(file).getByTestId('trade-stock-next-move')).toHaveTextContent('Complete the details the publish check needs')
    const checks = within(file).getByTestId('trade-stock-publish-checks')
    expect(within(checks).getByText('Unit price above zero').closest('li')).toHaveAttribute('data-met', 'false')
    // Ledger rows: newest first, on-hand before → after and the reservation figures from metadata.
    const table = await within(file).findByTestId('trade-stock-ledger-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Reserve')
    expect(rows[0]).toHaveTextContent('0 → 2')
    expect(rows[0]).toHaveTextContent('Account someone-…')
    expect(rows[1]).toHaveTextContent('Opening balance')
    expect(rows[1]).toHaveTextContent('You')
    // No quantity can be typed over: there is no editable on-hand field.
    expect(within(file).queryByLabelText(/on hand/i)).toBeNull()
  })

  it('the Publish button still asks the server even when the read-out shows gaps, and shows its refusal', async () => {
    fx.items = [item()]
    renderPage()
    fireEvent.click(await screen.findByTestId('trade-stock-row-stk-fixture-1'))
    fireEvent.click(await screen.findByTestId('trade-stock-publish'))
    expect(await screen.findByTestId('trade-stock-publish-error')).toHaveTextContent('Cannot publish: missing required fields unit_price')
    expect(count('publish')).toBe(1)
  })

  it('an unreadable ledger is a failure with retry, not "no movements"', async () => {
    fx.items = [item()]
    fx.ledgerError = httpError(500, 'boom')
    renderPage()
    fireEvent.click(await screen.findByTestId('trade-stock-row-stk-fixture-1'))
    expect(await screen.findByTestId('trade-stock-ledger-failed')).toHaveTextContent('could not be loaded')
    expect(screen.queryByTestId('trade-stock-ledger-empty')).toBeNull()
  })

  it('records a movement through the ledger with the optional reason the API accepts', async () => {
    fx.items = [item()]
    renderPage()
    fireEvent.click(await screen.findByTestId('trade-stock-row-stk-fixture-1'))
    fireEvent.click(await screen.findByTestId('trade-stock-move-RESERVE'))
    fireEvent.change(screen.getByTestId('trade-stock-move-qty'), { target: { value: '3' } })
    expect(screen.getByTestId('trade-stock-move-preview')).toHaveTextContent('reserved 2 → 5')
    fireEvent.change(screen.getByTestId('trade-stock-move-reason'), { target: { value: 'Held for FICTIONAL order' } })
    fireEvent.click(screen.getByTestId('trade-stock-move-submit'))
    await waitFor(() => expect(count('move')).toBe(1))
    const [id, payload] = fx.calls.find((c) => c.fn === 'move')!.args as [string, Record<string, unknown>]
    expect(id).toBe('stk-fixture-1')
    expect(payload).toMatchObject({ action: 'RESERVE', quantity: 3, reason: 'Held for FICTIONAL order', source: 'ui' })
    expect(typeof payload.idempotencyKey).toBe('string')
  })

  it('supply documents: a failed read is never "none", and a published document can be unpublished', async () => {
    fx.docsError = httpError(500, 'boom')
    const { unmount } = renderPage()
    expect(await screen.findByTestId('trade-stock-supply-failed')).toHaveAttribute('data-state', 'failed')
    expect(screen.queryByTestId('trade-stock-supply-empty')).toBeNull()
    unmount()
    fx.docsError = null
    fx.docs = [doc({ id: 'doc-live', status: 'PUBLISHED' }), doc()]
    renderPage()
    fireEvent.click(await screen.findByTestId('trade-stock-supply-unpublish-doc-live'))
    await waitFor(() => expect(count('unpublishDoc')).toBe(1))
    expect(screen.getByTestId('trade-stock-supply-publish-doc-1')).toBeInTheDocument()
  })
})

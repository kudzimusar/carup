/**
 * RX-06 — /diaspora/stock/:id/passport unified provenance document. Fictional data only.
 *
 * Proves: flag OFF keeps the legacy passport; the document labels every fact with its source
 * (seller-entered vs recorded by CarUp) and says "Not recorded" instead of inventing; enrichment
 * reads that fail are failures (never "none"); the backbone's 404 / 403 / 429 / 5xx are distinct.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  item: null as unknown,
  itemError: null as unknown,
  ledger: [] as unknown[],
  ledgerError: null as unknown,
  docs: [] as unknown[],
  docsError: null as unknown,
  profile: null as unknown,
  profileError: null as unknown,
  calls: { item: 0 },
}))
const auth = vi.hoisted(() => ({ user: { id: 'viewer-1', role: 'dealer' }, isAuthenticated: true, loading: false }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
const methods = vi.hoisted(() => ({
  fetchDiasporaStockItem: async () => { fx.calls.item += 1; if (fx.itemError) throw fx.itemError; return fx.item },
  fetchDiasporaStockLedger: async () => { if (fx.ledgerError) throw fx.ledgerError; return fx.ledger },
  fetchDiasporaSupplyDocuments: async () => { if (fx.docsError) throw fx.docsError; return fx.docs },
  fetchDiasporaTradeProfile: async () => { if (fx.profileError) throw fx.profileError; return fx.profile },
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: DiasporaStockPassport } = await import('@/pages/diaspora/DiasporaStockPassport')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const ITEM = {
  id: 'stk-fixture-1', part_name: 'FICTIONAL alternator', sku: 'FX-ALT-9', part_number: null, oem_number: '27060-0L010',
  condition: 'REFURBISHED', unit_price: 180, currency: 'USD', vehicle_make: 'Toyota', vehicle_model: 'Hilux',
  publication_status: 'PUBLISHED', verification_status: 'UNVERIFIED', export_readiness_status: 'EXPORT_READY',
  supply_document_id: 'doc-1', seller_trade_profile_id: 'prof-1', balances: { onHand: 4, reserved: 1, available: 3 },
  created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/diaspora/stock/stk-fixture-1/passport']}>
    <Routes><Route path="/diaspora/stock/:id/passport" element={<DiasporaStockPassport />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  fx.unified = true
  fx.item = ITEM
  fx.itemError = null
  fx.ledger = [{ id: 'led-1', stock_item_id: 'stk-fixture-1', action_type: 'ADD', quantity_delta: 4, quantity_before: 0, quantity_after: 4, notes: 'Opening balance', created_at: '2026-11-18T10:00:00Z', created_by: 'viewer-1' }]
  fx.ledgerError = null
  fx.docs = [{ id: 'doc-1', document_number: 'FX-SUP-77', title: 'FICTIONAL supplier invoice', status: 'PUBLISHED', verification_status: 'PENDING' }]
  fx.docsError = null
  fx.profile = { id: 'prof-1', display_name: 'FICTIONAL Exports', profile_type: 'SELLER', verification_status: 'VERIFIED', trust_score: null }
  fx.profileError = null
  fx.calls = { item: 0 }
})

describe('DiasporaStockPassport — unified provenance document', () => {
  it('flag OFF keeps the legacy passport', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('stock-passport-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-passport')).toBeNull()
  })

  it('labels every fact with its source and never invents a missing one', async () => {
    renderPage()
    const doc = await screen.findByTestId('trade-passport')
    expect(within(doc).getByRole('heading', { level: 1, name: 'FICTIONAL alternator' })).toBeInTheDocument()
    const identity = within(doc).getByTestId('trade-passport-identity')
    expect(identity).toHaveTextContent('27060-0L010')
    expect(identity).toHaveTextContent('Seller-entered')
    // part_number is null → "Not recorded", not an invented value.
    expect(within(identity).getByText('Part number').parentElement).toHaveTextContent('Not recorded')
    // The item is UNVERIFIED: identity is seller-declared and never green.
    expect(within(doc).getByTestId('trade-passport-verification')).toHaveAttribute('data-tone', 'neutral')
    // Trust score null → "Not scored"; the profile's own verification is CarUp's record.
    const seller = within(doc).getByTestId('trade-passport-seller')
    expect(seller).toHaveTextContent('Not scored')
    expect(within(seller).getByTestId('trade-passport-seller-verification')).toHaveAttribute('data-tone', 'success')
    // Linked supply document as returned; photos honestly unsupported.
    expect(within(doc).getByTestId('trade-passport-supply')).toHaveTextContent('FX-SUP-77')
    expect(within(doc).getByTestId('trade-passport-photos')).toHaveTextContent('not supported')
    expect(within(doc).getByTestId('trade-passport-ledger')).toHaveTextContent('Opening balance')
  })

  it('failed enrichments are failures, never "none"', async () => {
    fx.ledgerError = httpError(500, 'boom')
    fx.docsError = httpError(500, 'boom')
    fx.profileError = httpError(500, 'boom')
    renderPage()
    expect(await screen.findByTestId('trade-passport-ledger-failed')).toHaveTextContent('not a report of an untouched ledger')
    expect(screen.getByTestId('trade-passport-supply-failed')).toBeInTheDocument()
    expect(screen.getByTestId('trade-passport-seller-failed')).toHaveTextContent('not a report that the seller has no profile')
    expect(screen.queryByTestId('trade-passport-ledger-empty')).toBeNull()
  })

  it('backbone 404, 403 and 429 are distinct states; a 5xx offers a retry that re-reads', async () => {
    fx.itemError = httpError(404, 'Stock item not found')
    const a = renderPage()
    expect(await screen.findByTestId('trade-passport-failed')).toHaveAttribute('data-kind', 'unavailable')
    expect(screen.getByText('This stock item was not found')).toBeInTheDocument()
    a.unmount()
    fx.itemError = httpError(403, 'You do not have access to this stock item')
    const b = renderPage()
    expect(await screen.findByTestId('trade-passport-failed')).toHaveAttribute('data-kind', 'denied')
    b.unmount()
    fx.itemError = httpError(429, 'Too many requests. Please try again later.')
    const c = renderPage()
    expect(await screen.findByTestId('trade-passport-failed')).toHaveAttribute('data-kind', 'limited')
    c.unmount()
    fx.itemError = httpError(503, 'Unavailable')
    renderPage()
    const failed = await screen.findByTestId('trade-passport-failed')
    expect(failed).toHaveAttribute('data-kind', 'failed')
    fx.itemError = null
    const before = fx.calls.item
    fireEvent.click(within(failed).getByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('trade-passport')).toBeInTheDocument()
    expect(fx.calls.item).toBe(before + 1)
  })

  it('has no edit affordance — the passport is read-only', async () => {
    renderPage()
    const doc = await screen.findByTestId('trade-passport')
    expect(within(doc).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(doc).queryByRole('button', { name: /save|edit|publish/i })).toBeNull()
  })
})

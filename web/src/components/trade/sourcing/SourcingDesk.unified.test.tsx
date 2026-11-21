/**
 * RX-06 — /diaspora/rfq unified sourcing desk: the same reads and handlers as the legacy page, honest
 * states (empty / failed / rate-limited / denied), only returned quote values, and accept behind a
 * confirmation. Flag OFF keeps the legacy page. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-buyer', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  fetchDiasporaBuyerOrders: vi.fn(),
  fetchDiasporaRfqs: vi.fn(),
  fetchDiasporaBuyerOrder: vi.fn(),
  fetchDiasporaOrderMatches: vi.fn(),
  createDiasporaBuyerOrder: vi.fn(),
  publishDiasporaRfq: vi.fn(),
  acceptDiasporaQuote: vi.fn(),
  createDiasporaQuote: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const published = {
  id: 'ord-fictional-0001', order_type: 'parts', origin_country: 'Japan', destination_country: 'Zimbabwe', status: 'QUOTE_ISSUED',
  requested_make: 'Toyota', requested_model: 'Aqua', created_at: '2026-11-17T09:00:00Z',
  metadata: { rfq: { published: true, publishedAt: '2026-11-18T09:00:00Z' } },
}
const draft = { ...published, id: 'ord-fictional-0002', requested_model: 'Hilux', status: 'IMPORT_REQUESTED', metadata: { rfq: { published: false } } }
const quotes = [
  { id: 'quo-fictional-a', import_order_id: published.id, quote_amount: 1450, quote_currency: 'USD', status: 'ISSUED', created_at: '2026-11-19T10:00:00Z' },
  { id: 'quo-fictional-b', import_order_id: published.id, quote_amount: 1200, quote_currency: 'USD', status: 'ISSUED', created_at: '2026-11-20T10:00:00Z', valid_until: '2026-12-01T00:00:00Z', metadata: { leadTimeDays: 10, shippingTerms: 'FOB' } },
]
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaReverseRfq')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { id: 'fictional-buyer', role: 'owner' }
  auth.isAuthenticated = true
  api.fetchDiasporaBuyerOrders.mockResolvedValue([published, draft])
  api.fetchDiasporaRfqs.mockResolvedValue([])
  api.fetchDiasporaBuyerOrder.mockResolvedValue({ ...published, quotes })
  api.fetchDiasporaOrderMatches.mockResolvedValue([{ stockItemId: 's1', partName: 'Fictional brake pad set', sku: 'FX-1', available: 4, score: 70, reasons: ['Make matches Toyota'] }])
  api.acceptDiasporaQuote.mockResolvedValue({})
  api.createDiasporaQuote.mockResolvedValue({ quote: {} })
  api.createDiasporaBuyerOrder.mockResolvedValue({})
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Sourcing requests — unified desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByTestId('diaspora-rfq-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-rfq')).toBeNull()
  })

  it('renders the desk from the same read, with the stage of each request', async () => {
    await mount()
    const list = await screen.findByTestId('trade-rfq-request-list')
    expect(within(list).getAllByTestId('trade-rfq-request-row')).toHaveLength(2)
    expect(screen.getByTestId('trade-rfq')).toHaveAttribute('data-presentation', 'trade-desk')
    expect(screen.getByTestId('trade-rfq-pulse')).toHaveTextContent('2requests')
    expect(within(list).getAllByTestId('trade-rfq-request-stage').map((n) => n.textContent)).toEqual(['Open to sellers', 'Draft · not published'])
    expect(screen.queryByTestId('trade-rfq-lanes')).toBeNull() // an owner has the buyer lane only
    expect(api.fetchDiasporaBuyerOrders).toHaveBeenCalledTimes(1)
    expect(api.fetchDiasporaRfqs).not.toHaveBeenCalled()
  })

  it('an empty list says what creates a request', async () => {
    api.fetchDiasporaBuyerOrders.mockResolvedValue([])
    await mount()
    expect(await screen.findByTestId('trade-rfq-requests-empty')).toHaveTextContent('stays a draft')
    expect(screen.getByTestId('trade-rfq-next')).toHaveTextContent('Compose your first parts request')
  })

  it('a failed read is never "none"; a 429 and a 403 are their own states', async () => {
    api.fetchDiasporaBuyerOrders.mockRejectedValueOnce(httpError(503, 'Service unavailable'))
    const first = await mount()
    expect(await screen.findByTestId('trade-rfq-requests-failed')).toHaveTextContent('This is not a report that there are none')
    expect(screen.queryByTestId('trade-rfq-requests-empty')).toBeNull()
    fireEvent.click(within(screen.getByTestId('trade-rfq-requests-failed')).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('trade-rfq-request-list')).toBeInTheDocument()
    expect(api.fetchDiasporaBuyerOrders).toHaveBeenCalledTimes(2)
    first.unmount()

    api.fetchDiasporaBuyerOrders.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    const second = await mount()
    const limited = await screen.findByTestId('trade-rfq-requests-failed')
    expect(limited).toHaveAttribute('data-state', 'limited')
    expect(limited).toHaveTextContent('Nothing is retried automatically')
    second.unmount()

    api.fetchDiasporaBuyerOrders.mockRejectedValueOnce(httpError(403, 'Forbidden'))
    await mount()
    const denied = await screen.findByTestId('trade-rfq-requests-failed')
    expect(denied).toHaveAttribute('data-state', 'denied')
    expect(within(denied).queryByRole('button')).toBeNull()
  })

  it('a role with neither lane is denied without any read', async () => {
    auth.user = { id: 'fictional-member', role: 'member' }
    await mount()
    expect(await screen.findByTestId('trade-rfq-denied')).toHaveTextContent('Member')
    expect(api.fetchDiasporaBuyerOrders).not.toHaveBeenCalled()
    expect(api.fetchDiasporaRfqs).not.toHaveBeenCalled()
  })

  it('shows only the values sellers entered and accepts one quote only after a confirmation', async () => {
    await mount()
    fireEvent.click((await screen.findAllByTestId('trade-rfq-request-open'))[0])
    const ledger = await screen.findByTestId('trade-rfq-quote-ledger')
    const rows = within(ledger).getAllByTestId('trade-rfq-quote-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('$1,450.00')
    expect(rows[0]).toHaveTextContent('Not stated') // no validity, lead time or terms were entered
    expect(rows[1]).toHaveTextContent('1 Dec 2026')
    expect(rows[1]).toHaveTextContent('10 days')
    expect(screen.getByTestId('trade-rfq-quote-spread')).toHaveTextContent('$1,200.00 – $1,450.00')
    expect(screen.getByTestId('trade-rfq-detail-next')).toHaveTextContent('Compare 2 submitted quotes and accept one')

    fireEvent.click(within(rows[1]).getByTestId('trade-rfq-quote-accept'))
    expect(api.acceptDiasporaQuote).not.toHaveBeenCalled()
    const confirm = await screen.findByTestId('trade-rfq-accept-confirm')
    expect(confirm).toHaveTextContent('rejects the other submitted quotes')
    expect(confirm).toHaveTextContent('No payment is taken')
    fireEvent.click(within(confirm).getByTestId('trade-rfq-accept-confirm-yes'))
    await waitFor(() => expect(api.acceptDiasporaQuote).toHaveBeenCalledWith(published.id, 'quo-fictional-b'))
  })

  it('a draft publishes through the same handler and matching waits for publication', async () => {
    api.fetchDiasporaBuyerOrder.mockResolvedValue({ ...draft, quotes: [] })
    api.publishDiasporaRfq.mockResolvedValue({})
    await mount()
    fireEvent.click((await screen.findAllByTestId('trade-rfq-request-open'))[1])
    const next = await screen.findByTestId('trade-rfq-detail-next')
    expect(next).toHaveTextContent('Publish this request so sellers can quote')
    expect(api.fetchDiasporaOrderMatches).not.toHaveBeenCalled()
    fireEvent.click(within(next).getByTestId('trade-rfq-detail-publish'))
    await waitFor(() => expect(api.publishDiasporaRfq).toHaveBeenCalledWith(draft.id))
  })

  it('composes a parts request through the same handler; the origin is required', async () => {
    await mount()
    fireEvent.click(await screen.findByTestId('trade-rfq-compose-submit'))
    expect(await screen.findByTestId('trade-rfq-notice')).toHaveTextContent('origin country')
    expect(api.createDiasporaBuyerOrder).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('trade-rfq-compose-origin'), { target: { value: 'Japan' } })
    fireEvent.change(screen.getByTestId('trade-rfq-compose-make'), { target: { value: 'Toyota' } })
    fireEvent.click(screen.getByTestId('trade-rfq-compose-submit'))
    await waitFor(() => expect(api.createDiasporaBuyerOrder).toHaveBeenCalledWith({ order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: undefined }))
  })

  it('a seller quotes in place through the same handler (USD, submitted)', async () => {
    auth.user = { id: 'fictional-dealer', role: 'dealer' }
    api.fetchDiasporaRfqs.mockResolvedValue([published])
    await mount()
    const row = await screen.findByTestId('trade-rfq-open-row')
    expect(api.fetchDiasporaBuyerOrders).not.toHaveBeenCalled()
    fireEvent.change(within(row).getByTestId('trade-rfq-open-amount'), { target: { value: '1500' } })
    fireEvent.click(within(row).getByTestId('trade-rfq-open-submit'))
    await waitFor(() => expect(api.createDiasporaQuote).toHaveBeenCalledWith(published.id, expect.objectContaining({ quote_amount: 1500, submit: true, idempotencyKey: expect.any(String) })))
    expect(await screen.findByTestId('trade-rfq-notice')).toHaveTextContent('$1,500.00')
  })

  it('an admin sees both lanes as tabs', async () => {
    auth.user = { id: 'fictional-admin', role: 'admin' }
    await mount()
    const lanes = await screen.findByTestId('trade-rfq-lanes')
    expect(within(lanes).getAllByRole('tab').map((t) => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Your requests'), expect.stringContaining('Quote on open requests')]))
  })
})

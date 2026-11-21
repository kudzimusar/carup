/**
 * LR02 — the order surface context (orderLinks.ts). Its DEFAULT leaves the real order pages exactly as they
 * were: the back link to the import-order ledger, "See shared containers" when no container is open, and
 * the compliance desk for operators. The sample surface sends the back link to the Trade entry and shows no
 * tool links, even to an operator. Fictional data only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ImportOrderView } from './ImportOrderView'
import { OrderSurfaceContext, REAL_ORDER_SURFACE, type OrderSurface } from './orderLinks'
import type { ImportOrderViewProps } from './orderViewTypes'
import type { Read, TradeOrder } from './orderModel'

const ORDER: TradeOrder = {
  id: 'fx000001-0000-4000-8000-000000000001', order_type: 'vehicle', origin_country: 'Japan', destination_country: 'Zimbabwe',
  requested_make: 'Toyota', requested_model: 'Aqua', status: 'DOCUMENTS_VERIFIED', buyer_id: 'fx-buyer',
  created_at: '2026-11-17T09:56:36Z', updated_at: '2026-11-17T09:56:36Z',
  diaspora_trade_documents: [], diaspora_import_quotes: [], diaspora_payment_milestones: [], diaspora_import_order_participants: [],
  diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
}
const ready = <T,>(data: T): Read<T> => ({ state: 'ready', data })
const NO_OPEN_CONTAINERS: ImportOrderViewProps['logistics'] = { reservations: ready([]), shipments: ready([]), containers: ready([]) }
const SAMPLE_LIKE: OrderSurface = { ledgerHref: '/diaspora', ledgerLabel: 'CarUp Trade', toolLinks: false }

function mount(props: Partial<ImportOrderViewProps>, surface?: OrderSurface) {
  const view = <ImportOrderView orderId={ORDER.id} mode="overview" order={ready(ORDER)} viewer={{ id: 'fx-buyer', role: 'owner' }} {...props} />
  const wrap = (node: ReactNode) => (surface ? <OrderSurfaceContext.Provider value={surface}>{node}</OrderSurfaceContext.Provider> : node)
  return render(<MemoryRouter>{wrap(view)}</MemoryRouter>)
}

afterEach(() => cleanup())

describe('the default surface: real order pages are unchanged', () => {
  it('is the import-order ledger with tool links on', () => {
    expect(REAL_ORDER_SURFACE).toEqual({ ledgerHref: '/diaspora/imports', ledgerLabel: 'Import orders', toolLinks: true })
  })

  it('back link to the ledger, on a ready order and on a refused one', () => {
    mount({})
    expect(screen.getByTestId('trade-order-back')).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.getByTestId('trade-order-back')).toHaveTextContent(/^\s*Import orders$/)
    cleanup()
    mount({ order: { state: 'denied' } })
    expect(screen.getByTestId('trade-order-back')).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.getByTestId('trade-order-back')).toHaveTextContent(/^\s*Import orders$/)
  })

  it('shipping: "See shared containers" when no container is open', () => {
    mount({ mode: 'shipping', logistics: NO_OPEN_CONTAINERS })
    const note = screen.getByTestId('diaspora-no-containers')
    expect(within(note).getByRole('link', { name: 'See shared containers' })).toHaveAttribute('href', '/diaspora/containers')
    expect(note.textContent).toBe('No open containers are currently accepting reservations. Check back once a coordinator opens booking. See shared containers')
  })

  it('customs: the compliance desk for an operator only', () => {
    mount({ mode: 'customs', viewer: { id: 'fx-operator', role: 'admin' } })
    expect(within(screen.getByTestId('trade-customs-reviews')).getByRole('link', { name: /Compliance desk/ })).toHaveAttribute('href', '/admin/diaspora/compliance')
    cleanup()
    mount({ mode: 'customs' })
    expect(within(screen.getByTestId('trade-customs-reviews')).queryByRole('link')).toBeNull()
  })
})

describe('a sample surface: back to the Trade entry, no tool links', () => {
  it('back link to the Trade entry, on a ready order and on a refused one', () => {
    mount({}, SAMPLE_LIKE)
    expect(screen.getByTestId('trade-order-back')).toHaveAttribute('href', '/diaspora')
    expect(screen.getByTestId('trade-order-back')).toHaveTextContent(/^\s*CarUp Trade$/)
    cleanup()
    mount({ order: { state: 'unavailable' } }, SAMPLE_LIKE)
    expect(screen.getByTestId('trade-order-back')).toHaveAttribute('href', '/diaspora')
  })

  it('no shared-containers link and no compliance desk, even for an operator', () => {
    mount({ mode: 'shipping', logistics: NO_OPEN_CONTAINERS }, SAMPLE_LIKE)
    const note = screen.getByTestId('diaspora-no-containers')
    expect(within(note).queryByRole('link')).toBeNull()
    expect(note.textContent).toBe('No open containers are currently accepting reservations. Check back once a coordinator opens booking.')
    cleanup()
    mount({ mode: 'customs', viewer: { id: 'fx-operator', role: 'admin' } }, SAMPLE_LIKE)
    expect(within(screen.getByTestId('trade-customs-reviews')).queryByRole('link')).toBeNull()
  })
})

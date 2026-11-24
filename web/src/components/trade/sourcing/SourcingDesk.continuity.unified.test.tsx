/**
 * RX06-EXIT02-LR01 (C2.1) — Trade sourcing-to-import-order continuity and recorded status presentation.
 * Verifies buyer continuity links to /diaspora/imports and /diaspora/imports/:id, exact server-recorded
 * order.status display in the request header across draft/open/accepted stages, seller-only hiding of
 * buyer-only import links, and unchanged flags-OFF legacy behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  user: { id: 'fictional-buyer', role: 'owner' } as { id: string; role: string },
  isAuthenticated: true,
  loading: false,
}))
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

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaReverseRfq')
  return render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { id: 'fictional-buyer', role: 'owner' }
  auth.isAuthenticated = true
  api.fetchDiasporaRfqs.mockResolvedValue([])
  api.fetchDiasporaOrderMatches.mockResolvedValue([])
})

afterEach(() => {
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
})

describe('SourcingDeskView — C2.1 trade/order continuity and recorded status', () => {
  it('exposes buyer Import orders header continuity and per-request recorded status + order workspace link across stages', async () => {
    const draftOrder = {
      id: 'ord-draft-901',
      order_type: 'parts',
      origin_country: 'Japan',
      destination_country: 'Zimbabwe',
      status: 'IMPORT_REQUESTED',
      requested_make: 'Nissan',
      requested_model: 'Navara',
      created_at: '2026-11-21T08:00:00Z',
      metadata: { rfq: { published: false } },
    }
    const transitOrder = {
      id: 'ord-transit-902',
      order_type: 'parts',
      origin_country: 'United Kingdom',
      destination_country: 'Zimbabwe',
      status: 'IN_TRANSIT',
      requested_make: 'Ford',
      requested_model: 'Ranger',
      created_at: '2026-11-18T08:00:00Z',
      metadata: { rfq: { published: true, acceptedQuoteId: 'quo-1', acceptedAt: '2026-11-19T12:00:00Z' } },
    }
    api.fetchDiasporaBuyerOrders.mockResolvedValue([draftOrder, transitOrder])
    api.fetchDiasporaBuyerOrder.mockImplementation(async (id: string) => {
      if (id === 'ord-draft-901') return { ...draftOrder, quotes: [] }
      return {
        ...transitOrder,
        quotes: [{ id: 'quo-1', import_order_id: transitOrder.id, quote_amount: 950, quote_currency: 'USD', status: 'ACCEPTED' }],
      }
    })

    await mount(true)

    const importsHeaderLink = await screen.findByTestId('trade-rfq-imports-link')
    expect(importsHeaderLink).toHaveAttribute('href', '/diaspora/imports')
    expect(importsHeaderLink.className).toContain('min-h-11')

    // Open draft request: shows recorded status "Request received" + direct /diaspora/imports/ord-draft-901 link
    const openButtons = await screen.findAllByTestId('trade-rfq-request-open')
    fireEvent.click(openButtons[0])
    expect(await screen.findByTestId('trade-rfq-detail-order-status')).toHaveTextContent('Order status: Request received')
    const draftWorkspaceLink = screen.getByTestId('trade-rfq-open-order-record')
    expect(draftWorkspaceLink).toHaveAttribute('href', '/diaspora/imports/ord-draft-901')
    expect(draftWorkspaceLink.className).toContain('min-h-11')

    // Open in-transit accepted request: shows recorded status "In transit" + workspace link
    fireEvent.click(openButtons[1])
    expect(await screen.findByTestId('trade-rfq-detail-order-status')).toHaveTextContent('Order status: In transit')
    expect(screen.getByTestId('trade-rfq-open-order-record')).toHaveAttribute('href', '/diaspora/imports/ord-transit-902')
  })

  it('surfaces Open import orders primary NextMove CTA when all buyer requests already have accepted quotes', async () => {
    const acceptedOnly = {
      id: 'ord-acc-301',
      order_type: 'parts',
      origin_country: 'Japan',
      destination_country: 'Zimbabwe',
      status: 'QUOTE_ACCEPTED',
      requested_make: 'Toyota',
      requested_model: 'Hilux',
      created_at: '2026-11-18T08:00:00Z',
      metadata: { rfq: { published: true, acceptedQuoteId: 'quo-301', acceptedAt: '2026-11-19T12:00:00Z' } },
    }
    api.fetchDiasporaBuyerOrders.mockResolvedValue([acceptedOnly])
    await mount(true)

    const nextImports = await screen.findByTestId('trade-rfq-next-imports')
    expect(nextImports).toHaveAttribute('href', '/diaspora/imports')
    expect(nextImports.className).toContain('min-h-11')
  })

  it('does not expose buyer-only Import orders header link to a seller-only dealer role, and leaves flags OFF untouched', async () => {
    auth.user = { id: 'fictional-dealer', role: 'dealer' }
    api.fetchDiasporaBuyerOrders.mockResolvedValue([])
    const sellerView = await mount(true)
    await screen.findByTestId('trade-rfq')
    expect(screen.queryByTestId('trade-rfq-imports-link')).toBeNull()
    sellerView.unmount()

    auth.user = { id: 'fictional-buyer', role: 'owner' }
    await mount(false)
    expect(await screen.findByTestId('diaspora-rfq-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-rfq-imports-link')).toBeNull()
  })
})

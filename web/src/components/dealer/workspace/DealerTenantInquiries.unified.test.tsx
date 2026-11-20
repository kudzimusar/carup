/**
 * RX05-C — /dealers/inquiries unified Dealer OS view: list → detail, next action from recorded
 * fields only, the same follow-up PATCH + receipt check, truthful empty and error states.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
  entries: [] as unknown[],
  failGet: false,
}))
// A STABLE auth object, like the real AuthContext (the page's effect depends on `user`).
const auth = vi.hoisted(() => ({ user: { id: 'fictional-owner', role: 'member' }, token: 'synthetic-session' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async (request: { path: string; options?: { method?: string; body?: string } }) => {
    const method = request.options?.method || 'GET'
    fx.requests.push({ path: request.path, method, body: request.options?.body ? JSON.parse(request.options.body) : null })
    if (request.path === '/dealer/operational-inquiries' && method === 'GET') {
      if (fx.failGet) { fx.failGet = false; throw Object.assign(new Error('HTTP 503'), { status: 503 }) }
      return { inquiries: { tenant_id: 't', entries: fx.entries, returned_visible_count: fx.entries.length, canonical_rows_read: fx.entries.length,
        total_available: null, data_scope: 'FIRST_100_SCOPED_MARKETPLACE_INQUIRIES', no_invented_leads_or_sales: true } }
    }
    if (request.path === '/dealer/operational-inquiries/inq-new/follow-up' && method === 'PATCH') {
      return { receipt: { inquiry_id: 'inq-new', status: 'contacted', seller_reported_only: true,
        buyer_contact_delivery_verified: false, payment_or_transaction_status_modified: false } }
    }
    throw Error('Unexpected request ' + method + ' ' + request.path)
  },
}))

const lead = (id: string, over: Record<string, unknown> = {}) => ({
  inquiry_id: id, vin: 'TEST0000000000001', inquiry_type: 'vehicle_purchase_interest', status: 'new',
  source_channel: 'web', created_at: '2026-11-16T13:40:00Z', customer_contact_available: true,
  contact_name: 'FICTIONAL TEST BUYER', contact_email: 'fictional-buyer@example.invalid', contact_phone: '+263 77 000 0000',
  message: 'CI-ONLY TEST INQUIRY', risk_state: 'SELLER_SAFE_READ_ONLY', buyer_transaction_verified: false,
  payment_authority_granted: false, allowed_followup_status: 'contacted', seller_followup_self_reported_only: true, ...over,
})
const ENTRIES = [
  lead('inq-new'),
  lead('inq-contacted', { status: 'contacted', allowed_followup_status: 'qualified', contact_name: 'SECOND FICTIONAL BUYER' }),
  lead('inq-held', { customer_contact_available: false, contact_name: null, contact_email: null, contact_phone: null, message: null, allowed_followup_status: null }),
]

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/DealerTenantInquiries')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}
beforeEach(() => { fx.requests = []; fx.entries = ENTRIES; fx.failGet = false })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('DealerTenantInquiries — unified Dealer OS view', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByRole('heading', { name: 'Marketplace buyer enquiries' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-ws-inquiries')).toBeNull()
  })

  it('lists enquiries and opens a detail whose next action comes only from recorded fields', async () => {
    await mount()
    expect(await screen.findByTestId('dealer-ws-inquiry-row-inq-new')).toBeInTheDocument()
    expect(screen.getByTestId('dealer-ws-inquiry-count')).toHaveTextContent('3 in this read')
    // First enquiry is the default detail on wide screens.
    const detail = screen.getByTestId('dealer-ws-inquiry-inq-new')
    expect(within(detail).getByTestId('dealer-ws-inquiry-next-contact')).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: /fictional-buyer@example.invalid/ })).toHaveAttribute('href', 'mailto:fictional-buyer@example.invalid')

    fireEvent.click(screen.getByTestId('dealer-ws-inquiry-row-inq-contacted'))
    const second = screen.getByTestId('dealer-ws-inquiry-inq-contacted')
    expect(within(second).getByTestId('dealer-ws-inquiry-next-qualify')).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: 'Record dealer-reported qualified enquiry' })).toBeInTheDocument()
    // A dealer-reported status is self-reported — never green.
    expect(within(second).getByTestId('dealer-ws-inquiry-status')).toHaveAttribute('data-tone', 'neutral')

    fireEvent.click(screen.getByTestId('dealer-ws-inquiry-row-inq-held'))
    const held = screen.getByTestId('dealer-ws-inquiry-inq-held')
    expect(within(held).getByTestId('dealer-ws-inquiry-next-withheld')).toBeInTheDocument()
    expect(within(held).getAllByText(/Contact withheld pending risk and eligibility confirmation/).length).toBeGreaterThan(0)
    expect(within(held).queryByRole('button', { name: /Record dealer-reported/ })).toBeNull()
    expect(within(held).queryByRole('link', { name: /@/ })).toBeNull()
    expect(document.querySelector('[data-tone="success"]')).toBeNull()
  })

  it('records the follow-up through the same verified PATCH and re-reads the inbox', async () => {
    await mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Record dealer-reported contact' }))
    expect(await screen.findByTestId('dealer-ws-inquiry-notice')).toHaveTextContent('No message or sale has been recorded by this action.')
    const patch = fx.requests.find(r => r.method === 'PATCH')!
    expect(patch.path).toBe('/dealer/operational-inquiries/inq-new/follow-up')
    expect(patch.body).toEqual({ next_status: 'contacted' })
    await waitFor(() => expect(fx.requests.filter(r => r.method === 'GET')).toHaveLength(2))
  })

  it('says what creates an enquiry when there are none', async () => {
    fx.entries = []
    await mount()
    const empty = await screen.findByTestId('dealer-ws-inquiries-empty')
    expect(empty).toHaveTextContent('No enquiries yet')
    expect(empty).toHaveTextContent('when a buyer contacts your dealership through the CarUp Marketplace')
  })

  it('treats a failed read as an outage, not an empty inbox, and retries it', async () => {
    fx.failGet = true
    await mount()
    const error = await screen.findByTestId('dealer-ws-inquiries-error')
    expect(error).toHaveTextContent('not proof that your dealership has no customers or enquiries')
    expect(screen.queryByTestId('dealer-ws-inquiries-empty')).toBeNull()
    fireEvent.click(within(error).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-ws-inquiry-row-inq-new')).toBeInTheDocument()
  })
})

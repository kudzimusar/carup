/**
 * RX-06 — the Trade pages with the unified presentation ON (and OFF): each page renders its new view
 * from its OWN reads and handlers, sends exactly the same requests as before, keeps failed / refused
 * reads distinct from empty ones, and falls back to the untouched legacy view when the flag is off.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'

const fx = vi.hoisted(() => ({
  unified: true,
  showroom: false,
  authenticated: true,
  user: { id: 'fx-buyer', role: 'owner', name: 'Fictional Buyer' } as { id: string; role: string; name: string },
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: fx.user, isAuthenticated: fx.authenticated, loading: false, token: 'synthetic' }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => fx.api }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/lib/presentationFlags', async importOriginal => ({ ...(await importOriginal<object>()), isShowroomPagesEnabled: () => fx.showroom }))
vi.mock('@/components/intelligence/TradeIntelligence', () => ({ default: () => <div data-testid="intel-stub" /> }))

const ORDER = {
  id: 'fx000001-0000-4000-8000-000000000001', order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare', requested_make: 'Toyota', requested_model: 'Aqua',
  requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD', status: 'IMPORT_REQUESTED',
  buyer_id: 'fx-buyer', created_at: '2026-11-17T09:56:36Z', updated_at: '2026-11-17T09:56:36Z',
  diaspora_trade_documents: [], diaspora_import_quotes: [], diaspora_payment_milestones: [], diaspora_import_order_participants: [],
  diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
}
const httpError = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status })

beforeEach(() => {
  fx.unified = true
  fx.showroom = false
  fx.authenticated = true
  fx.user = { id: 'fx-buyer', role: 'owner', name: 'Fictional Buyer' }
  sessionStorage.clear()
  fx.api = {
    fetchDiasporaImportOrders: vi.fn(async () => [ORDER]),
    fetchDiasporaImportOrder: vi.fn(async () => ORDER),
    createDiasporaImportOrder: vi.fn(async () => ({ id: 'fx-new-order' })),
    fetchDiasporaTradeDocuments: vi.fn(async () => []),
    uploadDiasporaDocument: vi.fn(async () => ({ storagePath: 'fx/private/path', docType: 'bill_of_lading', uploadedBy: 'fx-buyer' })),
    createDiasporaTradeDocument: vi.fn(async () => ({ id: 'fx-doc', document_type: 'bill_of_lading', verification_status: 'UPLOADED' })),
    fetchDiasporaOwnershipHandoffStatus: vi.fn(async () => ({ handedOff: false, vehicleVin: null, evidence: [] })),
    fetchDiasporaGovernmentFootprint: vi.fn(async () => [{ category: 'ZIMRA_CLEARANCE', status: 'MISSING', requiredForZimbabweReady: true }]),
    fetchDiasporaOrderAudit: vi.fn(async () => []),
    fetchDiasporaReservations: vi.fn(async () => []),
    fetchDiasporaShipments: vi.fn(async () => []),
    fetchDiasporaOpenContainers: vi.fn(async () => []),
    fetchDiasporaShipmentTimeline: vi.fn(async () => []),
    addDiasporaPaymentMilestone: vi.fn(async () => ({})),
  }
})
afterEach(() => cleanup())

async function at(path: string, routePath: string, element: ReactElement) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="/diaspora/imports/:id" element={<p data-testid="landed-on-order" />} />
        </Routes>
      </MemoryRouter>,
    )
  })
}
const pages = () => import('./DiasporaTrade')

describe('ledger (/diaspora/imports)', () => {
  it('lists the account’s orders as rows, with the phase from the core lifecycle', async () => {
    const { DiasporaImportList } = await pages()
    await at('/diaspora/imports', '/diaspora/imports', <DiasporaImportList />)
    const row = await screen.findByTestId('diaspora-import-row')
    expect(row).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}`)
    expect(row).toHaveTextContent('Phase 1 of 7 · Request & quotes')
    expect(row).toHaveTextContent('Usually with the seller')
    expect(screen.getByTestId('intel-stub')).toBeInTheDocument()
  })
  it('a failed read is not an empty ledger and can be retried; a refusal is its own state', async () => {
    fx.api.fetchDiasporaImportOrders.mockRejectedValueOnce(httpError(500, 'Too many requests'))
    const { DiasporaImportList } = await pages()
    await at('/diaspora/imports', '/diaspora/imports', <DiasporaImportList />)
    const failed = await screen.findByTestId('diaspora-import-list-error')
    expect(screen.queryByTestId('diaspora-import-list-empty')).toBeNull()
    fireEvent.click(within(failed).getByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('diaspora-import-row')).toBeInTheDocument()
    expect(fx.api.fetchDiasporaImportOrders).toHaveBeenCalledTimes(2)
    cleanup()
    fx.api.fetchDiasporaImportOrders.mockRejectedValueOnce(httpError(403, 'Forbidden'))
    await at('/diaspora/imports', '/diaspora/imports', <DiasporaImportList />)
    expect(await screen.findByTestId('diaspora-import-list-denied')).toBeInTheDocument()
  })
  it('flag OFF: the legacy list, unchanged', async () => {
    fx.unified = false
    const { DiasporaImportList } = await pages()
    await at('/diaspora/imports', '/diaspora/imports', <DiasporaImportList />)
    expect(await screen.findByTestId('diaspora-import-row')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-order-ledger')).toBeNull()
  })
})

describe('new import request (focused flow)', () => {
  async function fillFlow() {
    fireEvent.click(screen.getByTestId('trade-request-continue')) // cargo: vehicle (default)
    fireEvent.click(screen.getByTestId('trade-request-continue')) // vehicle step, empty → stays
    expect(screen.getByTestId('diaspora-import-validation-error')).toBeInTheDocument()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'vehicle')
    fireEvent.change(screen.getByTestId('diaspora-make-input'), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByTestId('diaspora-model-input'), { target: { value: 'Aqua' } })
    fireEvent.change(screen.getByTestId('diaspora-year-input'), { target: { value: '2018' } })
    fireEvent.click(screen.getByTestId('trade-request-continue'))
    fireEvent.change(screen.getByTestId('diaspora-origin-country-input'), { target: { value: 'Japan' } })
    fireEvent.change(screen.getByTestId('diaspora-origin-city-input'), { target: { value: 'Yokohama' } })
    fireEvent.change(screen.getByTestId('diaspora-destination-city-input'), { target: { value: 'Harare' } })
    fireEvent.click(screen.getByTestId('trade-request-continue'))
    fireEvent.change(screen.getByTestId('diaspora-budget-input'), { target: { value: '9000' } })
    fireEvent.click(screen.getByTestId('trade-request-continue'))
    expect(screen.getByTestId('trade-request-review')).toHaveTextContent('USD 9,000')
  }

  it('sends exactly the legacy request body, then opens the new order', async () => {
    const { NewDiasporaImportOrder } = await pages()
    await at('/diaspora/imports/new', '/diaspora/imports/new', <NewDiasporaImportOrder />)
    await fillFlow()
    expect(sessionStorage.getItem('carup-trade-import-draft')).toContain('Yokohama') // kept in this tab only
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-submit-import-button')) })
    expect(await screen.findByTestId('landed-on-order')).toBeInTheDocument()
    const unifiedBody = fx.api.createDiasporaImportOrder.mock.calls[0][0]
    expect(sessionStorage.getItem('carup-trade-import-draft')).toBeNull()

    // The same answers through the legacy form produce the identical body.
    cleanup()
    fx.unified = false
    await at('/diaspora/imports/new', '/diaspora/imports/new', <NewDiasporaImportOrder />)
    fireEvent.change(screen.getByTestId('diaspora-origin-country-input'), { target: { value: 'Japan' } })
    fireEvent.change(screen.getByTestId('diaspora-origin-city-input'), { target: { value: 'Yokohama' } })
    fireEvent.change(screen.getByTestId('diaspora-destination-city-input'), { target: { value: 'Harare' } })
    fireEvent.change(screen.getByTestId('diaspora-make-input'), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByTestId('diaspora-model-input'), { target: { value: 'Aqua' } })
    fireEvent.change(screen.getByTestId('diaspora-year-input'), { target: { value: '2018' } })
    fireEvent.change(screen.getByTestId('diaspora-budget-input'), { target: { value: '9000' } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-submit-import-button')) })
    await screen.findByTestId('landed-on-order')
    const legacyBody = fx.api.createDiasporaImportOrder.mock.calls[1][0]
    expect(unifiedBody).toEqual(legacyBody)
    expect(unifiedBody).toEqual({
      order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
      requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD',
    })
  })

  it('reaching the review step never reuses the clicked "Continue" element as the submit button', async () => {
    // Regression (found in a real browser): React re-rendered the SAME <button> from type="button" to
    // type="submit" during the click, and the browser's default action then sent the request without
    // the review step ever being seen. The two controls must be different elements.
    const { NewDiasporaImportOrder } = await pages()
    await at('/diaspora/imports/new', '/diaspora/imports/new', <NewDiasporaImportOrder />)
    for (let i = 0; i < 4; i++) {
      if (i === 1) {
        fireEvent.change(screen.getByTestId('diaspora-make-input'), { target: { value: 'Toyota' } })
        fireEvent.change(screen.getByTestId('diaspora-model-input'), { target: { value: 'Aqua' } })
        fireEvent.change(screen.getByTestId('diaspora-year-input'), { target: { value: '2018' } })
      }
      if (i === 2) {
        fireEvent.change(screen.getByTestId('diaspora-origin-country-input'), { target: { value: 'Japan' } })
        fireEvent.change(screen.getByTestId('diaspora-origin-city-input'), { target: { value: 'Yokohama' } })
        fireEvent.change(screen.getByTestId('diaspora-destination-city-input'), { target: { value: 'Harare' } })
      }
      if (i === 3) fireEvent.change(screen.getByTestId('diaspora-budget-input'), { target: { value: '9000' } })
      const cont = screen.getByTestId('trade-request-continue')
      fireEvent.click(cont)
      if (i === 3) {
        const send = screen.getByTestId('diaspora-submit-import-button')
        expect(send).not.toBe(cont)
        expect(cont.isConnected).toBe(false)
      }
    }
    expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
  })

  it('a server refusal keeps the answers and says the order was not created', async () => {
    fx.api.createDiasporaImportOrder.mockRejectedValueOnce(new Error('Request refused (fictional)'))
    const { NewDiasporaImportOrder } = await pages()
    await at('/diaspora/imports/new', '/diaspora/imports/new', <NewDiasporaImportOrder />)
    await fillFlow()
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-submit-import-button')) })
    expect(await screen.findByTestId('diaspora-import-form-error')).toHaveTextContent('Order not created')
    expect(screen.getByTestId('trade-request-review')).toHaveTextContent('Toyota Aqua 2018')
  })
})

describe('import order (/diaspora/imports/:id)', () => {
  it('a tab’s extra read runs only on that tab (?tab=customs reads the government footprint, nothing else)', async () => {
    const { DiasporaImportDetail } = await pages()
    await at(`/diaspora/imports/${ORDER.id}?tab=customs`, '/diaspora/imports/:id', <DiasporaImportDetail />)
    expect(await screen.findByTestId('trade-footprint-summary')).toHaveTextContent('0 of 1 required records verified')
    expect(fx.api.fetchDiasporaGovernmentFootprint).toHaveBeenCalledTimes(1)
    expect(fx.api.fetchDiasporaOrderAudit).not.toHaveBeenCalled()
    expect(fx.api.fetchDiasporaOwnershipHandoffStatus).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('trade-order-tabs')).getByRole('link', { name: 'Customs' })).toHaveAttribute('aria-current', 'page')
  })
  it('a refused order (403) and a missing one (404) are their own states', async () => {
    fx.api.fetchDiasporaImportOrder.mockRejectedValueOnce(httpError(403, 'You do not have access'))
    const { DiasporaImportDetail } = await pages()
    await at(`/diaspora/imports/${ORDER.id}`, '/diaspora/imports/:id', <DiasporaImportDetail />)
    expect(await screen.findByTestId('trade-order-denied')).toBeInTheDocument()
    cleanup()
    fx.api.fetchDiasporaImportOrder.mockRejectedValueOnce(httpError(404, 'Diaspora import order not found'))
    await at(`/diaspora/imports/${ORDER.id}`, '/diaspora/imports/:id', <DiasporaImportDetail />)
    expect(await screen.findByTestId('trade-order-unavailable')).toBeInTheDocument()
  })
  it('records a milestone with the same call and refreshes the order', async () => {
    const { DiasporaImportDetail } = await pages()
    await at(`/diaspora/imports/${ORDER.id}?tab=payments`, '/diaspora/imports/:id', <DiasporaImportDetail />)
    fireEvent.change(await screen.findByTestId('diaspora-milestone-amount'), { target: { value: '250' } })
    fireEvent.click(screen.getByTestId('diaspora-milestone-submit'))
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-milestone-submit')) })
    await waitFor(() => expect(fx.api.addDiasporaPaymentMilestone).toHaveBeenCalledTimes(1))
    expect(fx.api.addDiasporaPaymentMilestone.mock.calls[0][0]).toBe(ORDER.id)
    expect(fx.api.addDiasporaPaymentMilestone.mock.calls[0][1]).toMatchObject({ milestone_type: 'DEPOSIT', amount: 250, currency: 'USD' })
    await waitFor(() => expect(fx.api.fetchDiasporaImportOrder).toHaveBeenCalledTimes(2))
  })
})

describe('documents (/diaspora/imports/:id/documents)', () => {
  it('uploads with the same two calls as the legacy form', async () => {
    const { DiasporaImportDocuments } = await pages()
    await at(`/diaspora/imports/${ORDER.id}/documents`, '/diaspora/imports/:id/documents', <DiasporaImportDocuments />)
    fireEvent.change(await screen.findByTestId('diaspora-document-type-select'), { target: { value: 'bill_of_lading' } })
    const file = new File(['%PDF'], 'bl.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('diaspora-document-file-input'), { target: { files: [file] } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-document-upload-submit')) })
    await waitFor(() => expect(fx.api.createDiasporaTradeDocument).toHaveBeenCalledTimes(1))
    expect(fx.api.uploadDiasporaDocument).toHaveBeenCalledWith(file, 'bill_of_lading', ORDER.id)
    expect(fx.api.createDiasporaTradeDocument).toHaveBeenCalledWith(ORDER.id, { document_type: 'bill_of_lading', file_name: 'bl.pdf', storage_path: 'fx/private/path' })
    expect(await screen.findByTestId('trade-submission-row')).toHaveTextContent('Uploaded · not yet reviewed')
  })
})

describe('shipping & CAP (/diaspora/imports/:id/shipment)', () => {
  it('a failed reservations read is a failure in the unified view (the legacy view still shows its empty note)', async () => {
    fx.api.fetchDiasporaReservations.mockRejectedValue(httpError(500))
    const { DiasporaImportShipment } = await pages()
    await at(`/diaspora/imports/${ORDER.id}/shipment`, '/diaspora/imports/:id/shipment', <DiasporaImportShipment />)
    expect(await screen.findByTestId('trade-reservations-read-failed')).toBeInTheDocument()
    expect(screen.getByTestId('diaspora-shipment-empty')).toHaveTextContent('No shipment has been recorded')
    cleanup()
    fx.unified = false
    await at(`/diaspora/imports/${ORDER.id}/shipment`, '/diaspora/imports/:id/shipment', <DiasporaImportShipment />)
    expect(await screen.findByTestId('diaspora-reservation-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-order-view')).toBeNull()
  })
})

describe('Trade entry (/diaspora)', () => {
  it('showroom ON + signed in: the real start action and the account’s own orders, marked live', async () => {
    fx.showroom = true
    const { DiasporaLanding } = await pages()
    await at('/diaspora', '/diaspora', <DiasporaLanding />)
    expect(screen.getByTestId('diaspora-start-import-button')).toHaveAttribute('href', '/diaspora/imports/new')
    expect(await screen.findAllByTestId('trade-entry-order')).toHaveLength(1)
    expect(screen.getByTestId('trade-entry-desk')).toHaveTextContent('live from your account')
    expect(screen.getAllByTestId('diaspora-documents-preview-row')).toHaveLength(5)
  })
  it('showroom ON + guest: no account read, sign-in instead of orders', async () => {
    fx.showroom = true
    fx.authenticated = false
    const { DiasporaLanding } = await pages()
    await at('/diaspora', '/diaspora', <DiasporaLanding />)
    expect(screen.getByTestId('trade-entry-sign-in')).toHaveAttribute('href', '/login?returnTo=%2Fdiaspora%2Fimports')
    expect(screen.queryByTestId('trade-entry-desk')).toBeNull()
    expect(fx.api.fetchDiasporaImportOrders).not.toHaveBeenCalled()
  })
  it('showroom OFF: the legacy landing, and no extra read', async () => {
    const { DiasporaLanding } = await pages()
    await at('/diaspora', '/diaspora', <DiasporaLanding />)
    expect(screen.getByTestId('diaspora-landing-status-badge')).toBeInTheDocument()
    expect(fx.api.fetchDiasporaImportOrders).not.toHaveBeenCalled()
  })
})

describe('passport mode (/diaspora/imports/:id/passport)', () => {
  it('unified: the passport is a mode of the order; a failed enrichment says unavailable', async () => {
    fx.api.fetchDiasporaGovernmentFootprint.mockRejectedValue(httpError(500))
    const { default: DiasporaOrderPassport } = await import('./DiasporaOrderPassport')
    await at(`/diaspora/imports/${ORDER.id}/passport`, '/diaspora/imports/:id/passport', <DiasporaOrderPassport />)
    expect(await screen.findByTestId('order-passport-footprint-unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('trade-order-mode-switch')).toBeInTheDocument()
    expect(screen.getByTestId('trade-order-title')).toHaveTextContent('Toyota Aqua')
  })
  it('flag OFF: the legacy passport page', async () => {
    fx.unified = false
    const { default: DiasporaOrderPassport } = await import('./DiasporaOrderPassport')
    await at(`/diaspora/imports/${ORDER.id}/passport`, '/diaspora/imports/:id/passport', <DiasporaOrderPassport />)
    expect(await screen.findByTestId('order-passport-title')).toHaveTextContent('Import order passport')
    expect(screen.queryByTestId('trade-order-view')).toBeNull()
  })
})

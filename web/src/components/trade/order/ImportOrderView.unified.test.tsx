/**
 * RX-06 — the unified Import Order view (pure, props-fed). Proves the anchor layout, deep-linkable tabs,
 * the five read states, and the truth rules per tab: uploaded ≠ verified, no fabricated ETA or duty,
 * sandbox/live explicit, no quote action that does not exist, operator controls only for operators.
 * Fictional data only.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ImportOrderView } from './ImportOrderView'
import type { ImportOrderViewProps } from './orderViewTypes'
import type { Read, TradeOrder } from './orderModel'

const ORDER: TradeOrder = {
  id: 'fx000001-0000-4000-8000-000000000001', order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare', requested_make: 'Toyota', requested_model: 'Aqua',
  requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD', status: 'IMPORT_REQUESTED',
  buyer_id: 'fx-buyer', created_at: '2026-11-17T09:56:36Z', updated_at: '2026-11-17T09:56:36Z',
  diaspora_trade_documents: [], diaspora_import_quotes: [], diaspora_payment_milestones: [],
  diaspora_import_order_participants: [], diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
}
const ready = <T,>(data: T): Read<T> => ({ state: 'ready', data })

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname}{l.search}</output>
}

function mount(props: Partial<ImportOrderViewProps> & { mode?: ImportOrderViewProps['mode'] } = {}) {
  const all: ImportOrderViewProps = {
    orderId: ORDER.id, mode: 'overview', order: ready(ORDER), viewer: { id: 'fx-buyer', role: 'owner' }, ...props,
  }
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes><Route path="*" element={<><ImportOrderView {...all} /><Where /></>} /></Routes>
    </MemoryRouter>,
  )
}

describe('anchor layout', () => {
  it('one header with identity, monospace reference, status and route; lifecycle; next move; tabs as URLs', () => {
    mount()
    expect(screen.getByTestId('trade-order-title')).toHaveTextContent('Toyota Aqua2018')
    expect(screen.getByTestId('trade-order-reference')).toHaveTextContent('fx000001')
    expect(screen.getByTestId('trade-order-status')).toHaveTextContent('Request received')
    expect(screen.getByTestId('trade-route')).toHaveTextContent('Yokohama, Japan')
    expect(screen.getByTestId('trade-lifecycle')).toBeInTheDocument()
    expect(screen.getByTestId('trade-next-step')).toHaveTextContent('Add your trade documents')
    expect(screen.getByTestId('trade-usually-with')).toHaveTextContent('You')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const tabs = within(screen.getByTestId('trade-order-tabs'))
    expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByRole('link', { name: 'Quotes' })).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}?tab=quotes`)
    expect(tabs.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}/documents`)
    expect(tabs.getByRole('link', { name: 'Shipping & CAP' })).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}/shipment`)
    expect(screen.getByTestId('trade-order-passport-link')).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}/passport`)
  })

  it('loading, failed (with retry), denied and not-found are four different statements, with no order links', () => {
    const onRetry = vi.fn()
    const { unmount } = mount({ order: { state: 'loading' } })
    expect(screen.getByTestId('trade-order-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-order-tabs')).toBeNull()
    unmount()
    const failed = mount({ order: { state: 'failed', message: 'Too many requests', onRetry } })
    fireEvent.click(within(screen.getByTestId('trade-order-failed')).getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    failed.unmount()
    const denied = mount({ order: { state: 'denied' } })
    expect(screen.getByTestId('trade-order-denied')).toHaveTextContent('not available to this account')
    expect(screen.queryByTestId('trade-order-tabs')).toBeNull()
    denied.unmount()
    mount({ order: { state: 'unavailable' } })
    expect(screen.getByTestId('trade-order-unavailable')).toHaveTextContent('not found')
  })

  it('the order switch keeps the current tab', () => {
    const other = { ...ORDER, id: 'fx000002-0000-4000-8000-000000000002', requested_model: 'Hilux' }
    mount({ mode: 'customs', orders: ready([ORDER, other]) })
    fireEvent.change(within(screen.getByTestId('trade-order-switch')).getByRole('combobox'), { target: { value: other.id } })
    expect(screen.getByTestId('where')).toHaveTextContent(`/diaspora/imports/${other.id}?tab=customs`)
  })
})

describe('overview', () => {
  it('budget is the buyer’s stated figure, participants are honest when none, journey reads only records', () => {
    mount()
    expect(screen.getByTestId('diaspora-order-budget')).toHaveTextContent('USD 9,000')
    expect(screen.getByTestId('diaspora-order-budget')).toHaveTextContent('Stated by you')
    expect(screen.getByTestId('trade-order-participants-empty')).toBeInTheDocument()
    const rows = screen.getAllByTestId('diaspora-timeline-item')
    expect(rows).toHaveLength(7)
    expect(rows.filter(r => r.dataset.reached === 'true')).toHaveLength(1)
    expect(screen.getByTestId('trade-shipment-state')).toHaveTextContent('No container reservation is recorded.')
    expect(screen.getByTestId('trade-order-payments-mode')).toHaveTextContent('Live payments are off')
  })
  it('operator controls appear only for an operations role, and only for actions provided', () => {
    const actions = { assignSeller: vi.fn(async () => ({})), completeHandoff: vi.fn(async () => ({ idempotentReplay: true })) }
    const { unmount } = mount({ actions })
    expect(screen.queryByTestId('diaspora-order-reviewer-actions')).toBeNull()
    unmount()
    mount({ actions, viewer: { id: 'fx-op', role: 'admin' } })
    expect(screen.getByTestId('diaspora-order-reviewer-actions')).toBeInTheDocument()
    expect(screen.queryByTestId('diaspora-reviewer-link-vehicle')).toBeNull()
    fireEvent.click(screen.getByTestId('diaspora-reviewer-complete-handoff-start'))
    fireEvent.click(screen.getByTestId('diaspora-reviewer-complete-handoff'))
    return waitFor(() => expect(screen.getByTestId('diaspora-reviewer-result')).toHaveTextContent('idempotent replay'))
  })
})

describe('documents', () => {
  const docs = [
    { id: 'd1', document_type: 'passport', verification_status: 'UPLOADED', created_at: '2026-11-18T10:00:00Z', uploaded_by: 'fx-buyer' },
    { id: 'd2', document_type: 'bill_of_lading', verification_status: 'OCR_EXTRACTED', created_at: '2026-11-18T11:00:00Z', extractions: [{ id: 'x', trade_document_id: 'd2', extraction_provider: 'carup_ocr', confidence_score: 0.91, extracted_fields: { vessel: 'FICTIONAL' } }] },
    { id: 'd3', document_type: 'export_certificate', verification_status: 'VERIFIED', created_at: '2026-11-18T12:00:00Z', reviewed_at: '2026-11-19T12:00:00Z', reviewed_by: 'fx-reviewer' },
  ]
  it('uploaded and verified are separate facts; an automated read is a candidate, not a verification', () => {
    mount({ mode: 'documents', documents: ready(docs) })
    expect(screen.getByTestId('trade-required-status-0')).toHaveTextContent('Uploaded')
    expect(screen.getByTestId('trade-required-verified-0')).toHaveTextContent('No')
    expect(screen.getByTestId('trade-required-verified-2')).toHaveTextContent('Yes')
    const rows = screen.getAllByTestId('trade-submission-row')
    const ocrRow = rows.find(r => r.dataset.truth === 'in_review')!
    expect(within(ocrRow).getByTestId('trade-submission-status')).toHaveTextContent('fields read automatically, not verified')
    expect(within(ocrRow).getByTestId('trade-submission-verified')).toHaveTextContent('No')
    expect(within(ocrRow).getByTestId('trade-submission-ocr')).toHaveTextContent('Automated read · not verified')
    expect(screen.getByTestId('trade-next-step')).toHaveTextContent('This section is where it happens')
  })
  it('a failed documents read is a failure with retry, never "no documents"', () => {
    const onRetry = vi.fn()
    mount({ mode: 'documents', documents: { state: 'failed', message: 'HTTP 500', onRetry } })
    expect(screen.getByTestId('trade-documents-read-failed')).toHaveTextContent('not an empty record')
    expect(screen.queryByTestId('trade-submissions-empty')).toBeNull()
  })
  it('uploads through the provided action and says it is not verified yet', async () => {
    const created = { id: 'n1', document_type: 'bill_of_lading', verification_status: 'UPLOADED' }
    const uploadDocument = vi.fn(async (_f: File, _t: string, onProgress?: (m: string) => void) => { onProgress?.('Creating document record...'); return created })
    const onDocumentUploaded = vi.fn()
    mount({ mode: 'documents', documents: ready([]), actions: { uploadDocument, onDocumentUploaded } })
    fireEvent.change(screen.getByTestId('diaspora-document-type-select'), { target: { value: 'bill_of_lading' } })
    const file = new File(['%PDF'], 'bl.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('diaspora-document-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByTestId('diaspora-document-upload-submit'))
    await waitFor(() => expect(onDocumentUploaded).toHaveBeenCalledWith(created))
    expect(uploadDocument).toHaveBeenCalledWith(file, 'bill_of_lading', expect.any(Function))
    expect(screen.getByTestId('trade-document-upload-receipt')).toHaveTextContent('not verified yet')
  })
  it('reviewers see review controls; owners do not', () => {
    const { unmount } = mount({ mode: 'documents', documents: ready(docs), actions: { verifyDocument: vi.fn(), rejectDocument: vi.fn() } })
    expect(screen.queryByTestId('trade-review-toggle')).toBeNull()
    unmount()
    mount({ mode: 'documents', documents: ready(docs), viewer: { role: 'reviewer' }, actions: { verifyDocument: vi.fn(), rejectDocument: vi.fn() } })
    expect(screen.getAllByTestId('trade-review-toggle')).toHaveLength(2) // the verified one is terminal
  })
})

describe('shipping & CAP', () => {
  const logistics = (shipments: unknown[], reservations: Read<unknown[]> = ready([])) => ({
    reservations: reservations as never, shipments: ready(shipments) as never, containers: ready([]) as never,
  })
  it('no ETA from the carrier is said plainly; a recorded one is labelled as logistics’, never estimated', () => {
    const { unmount } = mount({ mode: 'shipping', logistics: logistics([{ id: 's1', status: 'IN_TRANSIT', carrier_name: 'Fictional Line' }]) })
    expect(screen.getByTestId('trade-shipment-eta')).toHaveTextContent('ETA not provided by the carrier')
    unmount()
    mount({ mode: 'shipping', logistics: logistics([{ id: 's1', status: 'IN_TRANSIT', estimated_arrival_date: '2026-12-20T00:00:00Z' }]) })
    expect(screen.getByTestId('trade-shipment')).toHaveTextContent('Recorded by logistics · not a CarUp estimate')
  })
  it('a failed reservations read is not "no space reserved", and the journey says those steps are not known', () => {
    mount({ mode: 'shipping', logistics: logistics([], { state: 'failed', message: 'x', onRetry: vi.fn() }) })
    expect(screen.getByTestId('trade-reservations-read-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('diaspora-reservation-empty')).toBeNull()
    expect(screen.getByTestId('trade-cap-reservations-unknown')).toBeInTheDocument()
  })
  it('an unrecognised status lights no CAP step', () => {
    mount({ mode: 'shipping', order: ready({ ...ORDER, status: 'TELEPORTED' }), logistics: logistics([]) })
    expect(screen.getAllByTestId('trade-cap-step').filter(s => s.dataset.reached === 'true')).toHaveLength(0)
  })
})

describe('quotes, customs, payments, activity', () => {
  it('quotes: shown as recorded, no accept/decline control that does not exist', () => {
    mount({ mode: 'quotes', order: ready({ ...ORDER, diaspora_import_quotes: [{ id: 'q1', quote_amount: 8450, quote_currency: 'USD', status: 'ISSUED', created_at: '2026-11-18T10:00:00Z' }] }) })
    expect(screen.getByTestId('trade-quote-row')).toHaveTextContent('USD 8,450')
    expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull()
    expect(screen.getByTestId('trade-quotes-actions-note')).toHaveTextContent('Quotes are accepted from Sourcing requests')
  })
  it('customs: no duty is inferred; a failed footprint read says so', () => {
    mount({ mode: 'customs', footprint: { state: 'failed', message: 'x', onRetry: vi.fn() } })
    expect(screen.getByTestId('trade-customs-duty-none')).toHaveTextContent('No duty amount is recorded')
    expect(screen.getByTestId('trade-customs-standing')).toHaveTextContent('Customs has not started')
    expect(screen.getByTestId('trade-footprint-read-failed')).toBeInTheDocument()
  })
  it('payments: live payments off and reference-only are explicit; a milestone needs an explicit confirm', async () => {
    const recordMilestone = vi.fn(async () => ({}))
    mount({ mode: 'payments', actions: { recordMilestone } })
    expect(screen.getByTestId('trade-payments-live')).toHaveTextContent('Live payments: off')
    expect(screen.getByTestId('trade-payments-recording')).toHaveTextContent('Reference records only')
    fireEvent.change(screen.getByTestId('diaspora-milestone-amount'), { target: { value: '1500' } })
    fireEvent.click(screen.getByTestId('diaspora-milestone-submit'))
    expect(recordMilestone).not.toHaveBeenCalled()
    expect(screen.getByTestId('diaspora-milestone-submit')).toHaveTextContent('Confirm USD 1500 Deposit')
    fireEvent.click(screen.getByTestId('diaspora-milestone-submit'))
    await waitFor(() => expect(recordMilestone).toHaveBeenCalledTimes(1))
    expect(recordMilestone.mock.calls[0][0]).toMatchObject({ milestone_type: 'DEPOSIT', amount: 1500, currency: 'USD' })
    expect(screen.getByTestId('diaspora-milestone-result')).toHaveTextContent('no payment was processed')
  })
  it('activity: the sealed audit leads; when it cannot be read the feed says it shows records only', () => {
    const { unmount } = mount({ mode: 'activity', audit: ready([{ id: 'a1', action: 'IMPORT_ORDER_CREATED', actor_id: 'fx-buyer', resource_id: ORDER.id, created_at: '2026-11-17T09:56:36Z', cryptographic_seal: 's' }]) })
    const events = screen.getAllByTestId('trade-activity-event')
    expect(events).toHaveLength(1)
    expect(events[0]).toHaveTextContent('Audit trail · sealed')
    expect(events[0]).toHaveTextContent('You')
    unmount()
    mount({ mode: 'activity', audit: { state: 'failed', message: 'x', onRetry: vi.fn() } })
    expect(screen.getByTestId('trade-activity-audit-failed')).toHaveTextContent('records only')
    expect(screen.getAllByTestId('trade-activity-event')[0]).toHaveTextContent('Order record')
  })
})

describe('passport mode', () => {
  it('is a read-only record of the same order; failed enrichments say unavailable, never none', () => {
    const fail: Read<never> = { state: 'failed', message: 'x' }
    mount({ mode: 'passport', footprint: fail, audit: fail, handoff: fail })
    expect(screen.getByTestId('order-passport-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-order-tabs')).toBeNull()
    expect(screen.getByTestId('trade-order-mode-switch')).toBeInTheDocument()
    expect(screen.getByTestId('order-passport-zim-ready')).toHaveAttribute('data-zim-ready', 'false')
    expect(screen.getByTestId('order-passport-footprint-unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('order-passport-audit-unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('order-passport-handoff-unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/storage|https?:\/\//i)).toBeNull()
  })
})

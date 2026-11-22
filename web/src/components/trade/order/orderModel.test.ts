/**
 * RX-06 — the Import Order model: deep links, honest read states, the required-document truth, the
 * activity feed (no double counting, nothing invented), the milestone cap and the CAP journey.
 * Fictional data only.
 */
import { describe, expect, it } from 'vitest'
import {
  mayOfferOperatorAction,
  buildActivity,
  buildShipmentTimeline,
  documentFileProblem,
  formatDay,
  governmentRecordStatus,
  milestonePayload,
  milestoneSummary,
  money,
  nextStepFor,
  orderHref,
  orderIdentifiers,
  readFromError,
  requiredDocumentTally,
  tabFromQuery,
  type TradeOrder,
} from './orderModel'

const ORDER: TradeOrder = {
  id: 'fx-order-0001-aaaa-bbbb', order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare', requested_make: 'Toyota', requested_model: 'Aqua',
  requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD', status: 'IMPORT_REQUESTED',
  buyer_id: 'fx-buyer', created_at: '2026-11-17T09:56:36Z', updated_at: '2026-11-17T09:56:36Z',
}

describe('deep links', () => {
  it('maps every tab and the passport mode to a URL without new routes', () => {
    expect(orderHref('abc', 'overview')).toBe('/diaspora/imports/abc')
    expect(orderHref('abc', 'documents')).toBe('/diaspora/imports/abc/documents')
    expect(orderHref('abc', 'shipping')).toBe('/diaspora/imports/abc/shipment')
    expect(orderHref('abc', 'passport')).toBe('/diaspora/imports/abc/passport')
    for (const tab of ['quotes', 'customs', 'payments', 'activity'] as const) expect(orderHref('abc', tab)).toBe(`/diaspora/imports/abc?tab=${tab}`)
  })
  it('reads only the query tabs from ?tab= (anything else is the overview)', () => {
    expect(tabFromQuery('customs')).toBe('customs')
    expect(tabFromQuery('ACTIVITY')).toBe('activity')
    expect(tabFromQuery('documents')).toBe('overview')
    expect(tabFromQuery(null)).toBe('overview')
  })
})

describe('read states', () => {
  it('403 is denied, 404 is unavailable, anything else is a failure with a retry', () => {
    const retry = () => undefined
    expect(readFromError(Object.assign(new Error('nope'), { status: 403 })).state).toBe('denied')
    expect(readFromError(Object.assign(new Error('gone'), { status: 404 })).state).toBe('unavailable')
    const failed = readFromError(new Error('Too many requests'), retry)
    expect(failed).toEqual({ state: 'failed', message: 'Too many requests', onRetry: retry })
  })
})

describe('absent values stay absent', () => {
  it('money/date return null instead of a placeholder value', () => {
    expect(money(null, 'USD')).toBeNull()
    expect(money('', 'USD')).toBeNull()
    expect(money(9000, 'usd')).toBe('USD 9,000')
    expect(formatDay(null)).toBeNull()
    expect(formatDay('not a date')).toBeNull()
  })
  it('lists only the identifiers recorded on the order', () => {
    expect(orderIdentifiers(ORDER)).toEqual([])
    expect(orderIdentifiers({ ...ORDER, vin: 'FXVIN0000000000001', auction_lot_number: 'LOT-7' }).map(i => i.label)).toEqual(['VIN', 'Auction lot'])
  })
})

describe('documents: uploaded is never verified', () => {
  const doc = (id: string, type: string, status: string) => ({ id, document_type: type, verification_status: status, created_at: '2026-11-10T10:00:00Z' })
  it('counts uploaded and verified separately', () => {
    const t = requiredDocumentTally([doc('a', 'passport', 'UPLOADED'), doc('b', 'bill_of_lading', 'VERIFIED'), doc('c', 'export_certificate', 'OCR_EXTRACTED')])
    expect(t).toMatchObject({ total: 5, uploaded: 3, verified: 1, rejected: 0 })
  })
  it('an OCR read is not a verification: the next step stays "with CarUp for review"', () => {
    const docs = ['passport', 'commercial_invoice', 'export_certificate', 'bill_of_lading', 'customs_declaration'].map((t, i) => doc(`d${i}`, t, 'OCR_EXTRACTED'))
    expect(nextStepFor({ ...ORDER, status: 'DOCUMENTS_PENDING' }, docs).title).toMatch(/with CarUp for review/)
  })
  it('keeps the legacy file rules', () => {
    expect(documentFileProblem({ type: 'text/plain', size: 10 })).toMatch(/Invalid file type/)
    expect(documentFileProblem({ type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/too large/)
    expect(documentFileProblem({ type: 'image/png', size: 1024 })).toBeNull()
  })
})

describe('activity feed', () => {
  it('uses the audit entry for a record it covers and never counts it twice', () => {
    const order: TradeOrder = { ...ORDER, diaspora_payment_milestones: [{ id: 'm1', import_order_id: ORDER.id, milestone_type: 'DEPOSIT', amount: 100, currency: 'USD', status: 'PENDING', created_at: '2026-11-18T08:00:00Z' }] }
    const audit = [
      { id: 'a1', action: 'IMPORT_ORDER_CREATED', actor_id: 'fx-buyer', resource_id: ORDER.id, created_at: '2026-11-17T09:56:36Z', cryptographic_seal: 'seal' },
    ]
    const events = buildActivity({ order, audit })
    expect(events.filter(e => e.title === 'Import request recorded')).toHaveLength(1)
    expect(events.find(e => e.title === 'Import request recorded')).toMatchObject({ source: 'audit', sealed: true })
    expect(events[0]).toMatchObject({ title: 'Payment milestone recorded', source: 'record' })
  })
  it('creates nothing that is not on record', () => {
    expect(buildActivity({ order: { ...ORDER, created_at: undefined, updated_at: undefined } }).map(e => e.title)).toEqual(['Import request recorded'])
    expect(buildActivity({ order: { ...ORDER, created_at: undefined, updated_at: undefined } })[0].at).toBeNull()
  })
})

describe('payment milestones', () => {
  it('caps on an accepted quote, else the budget, counting only pending/confirmed amounts', () => {
    const ms = [
      { id: '1', amount: 1000, currency: 'USD', status: 'PENDING' },
      { id: '2', amount: 500, currency: 'USD', status: 'CANCELLED' },
    ]
    expect(milestoneSummary(ms, [], 9000, 'USD')).toMatchObject({ cap: { amount: 9000, source: 'order budget' }, remaining: 8000 })
    expect(milestoneSummary(ms, [{ id: 'q', status: 'ACCEPTED', quote_amount: 8500, quote_currency: 'USD' }], 9000, 'USD')).toMatchObject({ cap: { amount: 8500, source: 'accepted quote' }, remaining: 7500 })
  })
  it('builds the legacy payload with a fresh idempotency key each time', () => {
    const a = milestonePayload({ milestoneType: 'DEPOSIT', amount: 50, currency: 'usd', reference: ' ' })
    const b = milestonePayload({ milestoneType: 'DEPOSIT', amount: 50, currency: 'usd', reference: ' ' })
    expect(a).toMatchObject({ milestone_type: 'DEPOSIT', amount: 50, currency: 'USD', external_reference: undefined })
    expect(a.idempotency_key).toBeTruthy()
    expect(a.idempotency_key).not.toBe(b.idempotency_key)
  })
})

describe('CAP journey (legacy semantics)', () => {
  it('reaches only what the status and reservations prove', () => {
    const steps = buildShipmentTimeline({ status: 'IMPORT_REQUESTED' }, [{ id: 'r', reservation_status: 'REQUESTED' }])
    expect(steps.filter(s => s.reached).map(s => s.key)).toEqual(['reservation_requested'])
    expect(steps[0].source).toBe('reservation')
    expect(buildShipmentTimeline({ status: 'TELEPORTED' }, []).some(s => s.reached)).toBe(false)
  })
})

describe('government records', () => {
  it('MISSING reads as "not recorded yet", never as a failure', () => {
    expect(governmentRecordStatus('MISSING')).toEqual({ label: 'Not recorded yet', tone: 'neutral' })
    expect(governmentRecordStatus('VERIFIED').tone).toBe('success')
  })
})

describe('operator actions offered per role (RX06-LR04, mirrors the server)', () => {
  it('platform reviewers are offered every action; a plain admin only the handoff; others nothing', () => {
    const actions = ['assignSeller', 'markZimbabweReady', 'linkVehicleRecord', 'completeHandoff', 'reviewDocuments'] as const
    for (const role of ['platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']) {
      for (const a of actions) expect(mayOfferOperatorAction(a, role), `${role} ${a}`).toBe(true)
    }
    expect(actions.filter(a => mayOfferOperatorAction(a, 'admin'))).toEqual(['completeHandoff'])
    for (const role of ['owner', 'dealer', 'seller', 'mechanic', '', null, undefined]) {
      expect(actions.filter(a => mayOfferOperatorAction(a, role)), String(role)).toEqual([])
    }
    // Role names are matched as the server stores them, case-insensitively.
    expect(mayOfferOperatorAction('assignSeller', 'Reviewer')).toBe(true)
  })
})

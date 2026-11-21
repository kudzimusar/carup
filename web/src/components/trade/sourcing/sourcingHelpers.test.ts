/**
 * RX-06 Sourcing — pure helper truth rules (desk kit, Reverse RFQ desk, container board).
 * Fictional values only.
 */
import { describe, expect, it } from 'vitest'
import type { DiasporaBuyerOrder, DiasporaQuote } from '@/types'
import { failureKind, formatAmount, formatDay, humanizeCode, shortRef } from './deskKit'
import { demandTitle, quoteRows, quoteSpread, requestNextMove, rfqStage, stageCounts, yearSpan } from './rfqDesk'
import { containerStatus, fillOf, formatCbm, pendingVolume, reservationStatus, trackIndex } from './containerBoard'

const order = (over: Partial<DiasporaBuyerOrder> = {}): DiasporaBuyerOrder => ({
  id: 'ord-fictional-0001', order_type: 'parts', origin_country: 'Japan', status: 'IMPORT_REQUESTED', ...over,
})
const quote = (over: Partial<DiasporaQuote> = {}): DiasporaQuote => ({
  id: 'quo-fictional-0001', import_order_id: 'ord-fictional-0001', quote_amount: 1200, quote_currency: 'USD', status: 'ISSUED', ...over,
})

describe('desk kit', () => {
  it('keeps a rate limit, a refusal, a missing feature and a missing tenant apart from an outage', () => {
    expect(failureKind({ status: 429 })).toBe('limited')
    expect(failureKind({ status: null, message: 'Too many requests. Please try again later.' })).toBe('limited')
    expect(failureKind({ status: 403, message: 'Forbidden' })).toBe('denied')
    expect(failureKind({ status: 404 })).toBe('missing')
    expect(failureKind({ status: 400, message: 'An x-tenant-id context is required for subscription operations' })).toBe('tenant')
    expect(failureKind({ status: 401 })).toBe('session')
    expect(failureKind({ status: 503 })).toBe('failed')
    expect(failureKind({ status: null, message: 'Failed to fetch' })).toBe('failed')
  })

  it('never turns an absent or unparseable amount into zero', () => {
    expect(formatAmount(null, 'USD')).toBeNull()
    expect(formatAmount('', 'USD')).toBeNull()
    expect(formatAmount('abc', 'USD')).toBeNull()
    expect(formatAmount(1200, 'USD')).toBe('$1,200.00')
    expect(formatAmount(5, 'ZZZ')).toMatch(/ZZZ/) // an unfamiliar code is shown as recorded, never converted
  })

  it('formats recorded dates in UTC and reports a missing one as missing', () => {
    expect(formatDay('2026-11-15T23:30:00Z')).toBe('15 Nov 2026')
    expect(formatDay(null)).toBeNull()
    expect(formatDay('not a date')).toBeNull()
    expect(humanizeCode('BOOKING_OPEN')).toBe('Booking open')
    expect(humanizeCode(null)).toBe('Not recorded')
    expect(shortRef('46d0a2be-ea74-41af')).toBe('46d0a2be')
  })
})

describe('Reverse RFQ desk', () => {
  it('reads the stage only from the recorded rfq metadata', () => {
    expect(rfqStage(order())).toBe('draft')
    expect(rfqStage(order({ metadata: { rfq: { published: true } } }))).toBe('open')
    expect(rfqStage(order({ metadata: { rfq: { published: true, acceptedQuoteId: 'q' } } }))).toBe('accepted')
    expect(stageCounts([order(), order({ metadata: { rfq: { published: true } } })])).toEqual({ draft: 1, open: 1, accepted: 0 })
  })

  it('names a demand from recorded fields only', () => {
    expect(demandTitle(order({ requested_make: 'Toyota', requested_model: 'Aqua' }))).toBe('Toyota Aqua')
    expect(demandTitle(order())).toBe('Parts request')
    expect(yearSpan(2018, 2018)).toBe('2018')
    expect(yearSpan(2016, 2019)).toBe('2016–2019')
    expect(yearSpan(null, null)).toBeNull()
  })

  it('keeps the legacy accept rule: only a submitted (ISSUED) quote, only while none is accepted', () => {
    const rows = quoteRows([quote({ id: 'a', status: 'ISSUED' }), quote({ id: 'b', status: 'DRAFT' })], undefined)
    expect(rows.find((r) => r.id === 'a')?.acceptable).toBe(true)
    expect(rows.find((r) => r.id === 'b')?.acceptable).toBe(false)
    const accepted = quoteRows([quote({ id: 'a', status: 'ACCEPTED' }), quote({ id: 'c', status: 'ISSUED' })], 'a')
    expect(accepted.find((r) => r.id === 'a')?.accepted).toBe(true)
    expect(accepted.find((r) => r.id === 'c')?.acceptable).toBe(false)
  })

  it('shows only values the seller entered: nothing invented for validity, lead time or terms', () => {
    const [row] = quoteRows([quote()], undefined)
    expect(row.validUntil).toBeNull()
    expect(row.leadTimeDays).toBeNull()
    expect(row.shippingTerms).toBeNull()
    const [full] = quoteRows([quote({ valid_until: '2026-12-01T00:00:00Z', metadata: { leadTimeDays: 14, shippingTerms: 'FOB' }, inclusions: ['Crating'] })], undefined)
    expect(full.validUntil).toBe('1 Dec 2026')
    expect(full.leadTimeDays).toBe(14)
    expect(full.shippingTerms).toBe('FOB')
    expect(full.inclusions).toEqual(['Crating'])
  })

  it('compares amounts within one currency only and counts an unpriced quote as unpriced', () => {
    const rows = quoteRows([
      quote({ id: '1', quote_amount: 1000, quote_currency: 'USD' }),
      quote({ id: '2', quote_amount: 1500, quote_currency: 'USD' }),
      quote({ id: '3', quote_amount: 900, quote_currency: 'ZAR' }),
      quote({ id: '4', quote_amount: '' as unknown as number }),
    ], undefined)
    const { spreads, unpriced } = quoteSpread(rows)
    expect(spreads).toHaveLength(2)
    expect(spreads.find((s) => s.currency === 'USD')).toMatchObject({ low: '$1,000.00', high: '$1,500.00', count: 2 })
    expect(spreads.find((s) => s.currency === 'ZAR')?.count).toBe(1)
    expect(unpriced).toBe(1)
  })

  it('orders quotes by when they were received', () => {
    const rows = quoteRows([
      quote({ id: 'late', created_at: '2026-11-20T10:00:00Z' }),
      quote({ id: 'early', created_at: '2026-11-18T10:00:00Z' }),
      quote({ id: 'undated' }),
    ], undefined)
    expect(rows.map((r) => r.id)).toEqual(['early', 'late', 'undated'])
  })

  it('derives the next move from the stage and the returned quotes', () => {
    expect(requestNextMove(order(), []).kind).toBe('publish')
    const open = order({ metadata: { rfq: { published: true } } })
    expect(requestNextMove(open, []).kind).toBe('wait')
    expect(requestNextMove(open, quoteRows([quote()], undefined))).toMatchObject({ kind: 'compare', usuallyWith: 'You' })
    const accepted = order({ status: 'SELLER_ASSIGNED', metadata: { rfq: { published: true, acceptedQuoteId: 'x' } } })
    expect(requestNextMove(accepted, [])).toMatchObject({ kind: 'accepted', usuallyWith: 'The seller' })
  })
})

describe('Container board', () => {
  it('computes fill from the recorded total and approved volume with the backend thresholds', () => {
    expect(fillOf({ total_capacity_volume: 0, used_capacity_volume: 0 }).recorded).toBe(false)
    const ready = fillOf({ total_capacity_volume: 60, used_capacity_volume: 54 })
    expect(ready).toMatchObject({ recorded: true, available: 6, readyToClose: true, full: false })
    expect(fillOf({ total_capacity_volume: 60, used_capacity_volume: 59 }).full).toBe(true)
  })

  it('reports requested volume separately — it is not counted until approved', () => {
    expect(pendingVolume([
      { reservation_status: 'REQUESTED', estimated_volume: 2.5 },
      { reservation_status: 'APPROVED', estimated_volume: 10 },
      { reservation_status: 'REJECTED', estimated_volume: 4 },
    ])).toBe(2.5)
    expect(formatCbm(12.5)).toBe('12.5 CBM')
  })

  it('labels every backend status and never places an unknown one on the track', () => {
    for (const s of ['DRAFT', 'BOOKING_OPEN', 'BOOKING_CLOSED', 'LOADING', 'SHIPPED', 'ARRIVED', 'COMPLETED', 'CANCELLED']) {
      expect(containerStatus(s).label).not.toMatch(/not recorded/i)
    }
    expect(trackIndex('BOOKING_OPEN')).toBe(1)
    expect(trackIndex('CANCELLED')).toBe(-1)
    expect(trackIndex('MYSTERY')).toBe(-1)
    expect(reservationStatus('APPROVED').tone).toBe('success')
    expect(reservationStatus('REQUESTED').tone).not.toBe('success')
  })
})

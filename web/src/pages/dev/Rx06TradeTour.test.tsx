/**
 * RX-06 — the DEV Trade fixture tour: every fixture sits in the phase it claims, carries "FIXTURE" in
 * every identifier, renders through the REAL Import Order view in every mode, shows no write control,
 * and never links to a real order route with a fixture id.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { positionOf, TRADE_PHASES } from '@/components/trade/core/importOrderLifecycle'
import { ORDER_TABS } from '@/components/trade/order/orderModel'
import Rx06TradeNorthStar from './Rx06TradeNorthStar'
import { FIXTURE_ORDERS } from './rx06TradeFixtures'

const SCHEMA = {
  document: ['MISSING', 'UPLOADED', 'OCR_EXTRACTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'FLAGGED'],
  quote: ['DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
  milestone: ['PENDING', 'CONFIRMED', 'FAILED', 'WAIVED', 'CANCELLED'],
  reservation: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  shipment: ['PLANNED', 'BOOKED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_HOLD', 'RELEASED', 'COMPLETED', 'EXCEPTION'],
  review: ['PENDING_REVIEW', 'APPROVED', 'FLAGGED', 'REJECTED'],
  participant: ['buyer', 'seller', 'exporter', 'agent', 'dealer', 'company', 'coordinator', 'customs_reviewer'],
}

const WRITE_WORDS = /\b(upload|verify|reject|record|assign|mark|link vehicle|complete|approve|cancel|create|update|submit|send|request space|save)\b/i

function tour(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/dev/rx06-trade?${query}`]}>
      <Rx06TradeNorthStar />
    </MemoryRouter>,
  )
}

describe('RX-06 Trade fixture tour — the fixtures', () => {
  it('holds one order in each of the seven phases, in lifecycle order, then the three exceptions', () => {
    const phases = FIXTURE_ORDERS.filter(f => !positionOf(f.order.status).exception)
    expect(phases.map(f => positionOf(f.order.status).phaseIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(phases.map(f => f.key)).toEqual(TRADE_PHASES.map(p => p.key))
    const exceptions = FIXTURE_ORDERS.filter(f => positionOf(f.order.status).exception)
    expect(exceptions.map(f => f.order.status).sort()).toEqual(['CANCELLED', 'DISPUTED', 'FLAGGED_FOR_REVIEW'])
  })

  it('uses only statuses the real schema allows', () => {
    for (const { order } of FIXTURE_ORDERS) {
      for (const d of order.diaspora_trade_documents ?? []) expect(SCHEMA.document).toContain(d.verification_status)
      for (const q of order.diaspora_import_quotes ?? []) expect(SCHEMA.quote).toContain(q.status)
      for (const m of order.diaspora_payment_milestones ?? []) expect(SCHEMA.milestone).toContain(m.status)
      for (const r of order.diaspora_cargo_reservations ?? []) expect(SCHEMA.reservation).toContain(r.reservation_status)
      for (const s of order.diaspora_shipments ?? []) expect(SCHEMA.shipment).toContain(s.status)
      for (const c of order.diaspora_compliance_reviews ?? []) expect(SCHEMA.review).toContain(c.status)
      for (const p of order.diaspora_import_order_participants ?? []) expect(SCHEMA.participant).toContain(p.participant_role)
    }
  })

  it('marks every identifier, reference, carrier and file as FIXTURE', () => {
    for (const { order, footprint } of FIXTURE_ORDERS) {
      for (const v of [order.vin, order.chassis_number, order.auction_lot_number, order.linked_vehicle_vin]) {
        if (v) expect(v).toMatch(/FIXTURE/)
      }
      for (const m of order.diaspora_payment_milestones ?? []) expect(m.external_reference).toMatch(/FIXTURE/)
      for (const s of order.diaspora_shipments ?? []) {
        expect(s.carrier_name).toMatch(/FIXTURE/)
        expect(s.tracking_number).toMatch(/FIXTURE/)
      }
      for (const d of order.diaspora_trade_documents ?? []) expect(d.file_name).toMatch(/FIXTURE/)
      expect(footprint.length).toBe(10)
    }
  })
})

describe('RX-06 Trade fixture tour — the page', () => {
  it('always shows the fixture banner', () => {
    tour('order=documents')
    expect(screen.getByTestId('rx06-tour-fixture-banner')).toHaveTextContent(/FIXTURE TOUR · DEV only/)
    expect(screen.getByTestId('trade-order-header')).toBeInTheDocument()
  })

  it('renders every fixture in every mode with no write control and no link to a real order route', () => {
    const modes = [...ORDER_TABS.map(t => t.key), 'passport']
    for (const f of FIXTURE_ORDERS) {
      for (const mode of modes) {
        tour(`order=${f.key}&mode=${mode}`)
        const order = screen.getByTestId('rx06-tour-order')
        expect(order.querySelector('input[type="file"]'), `${f.key}/${mode}: file input`).toBeNull()
        expect(order.querySelector('form'), `${f.key}/${mode}: form`).toBeNull()
        const writes = within(order).queryAllByRole('button').filter(b => WRITE_WORDS.test(b.textContent ?? ''))
        expect(writes.map(b => b.textContent), `${f.key}/${mode}: write buttons`).toEqual([])
        const realOrderLinks = [...order.querySelectorAll('a[href]')].map(a => a.getAttribute('href') ?? '').filter(h => /^\/diaspora\/imports\/fx/.test(h))
        expect(realOrderLinks, `${f.key}/${mode}: real-route links`).toEqual([])
        cleanup()
      }
    }
  }, 60_000)

  it('keeps the order tabs inside the tour', () => {
    tour('order=sea&mode=overview')
    const tabs = screen.getByTestId('rx06-tour-order').querySelectorAll('a[href^="/dev/rx06-trade?"]')
    expect(tabs.length).toBeGreaterThan(7)
  })

  it('answers each simulated read state with its own message, never an empty order', () => {
    tour('order=sea&read=denied')
    expect(screen.getByTestId('trade-order-denied')).toHaveTextContent(/not available to this account/)
    expect(screen.queryByTestId('trade-order-header')).toBeNull()
    cleanup()
    tour('order=sea&read=unavailable')
    expect(screen.getByTestId('trade-order-unavailable')).toHaveTextContent(/was not found/)
    cleanup()
    tour('order=sea&read=failed')
    expect(screen.getByTestId('trade-order-failed')).toHaveTextContent(/simulated failure/)
    cleanup()
    tour('order=sea&read=loading')
    expect(screen.getByTestId('trade-order-loading')).toBeInTheDocument()
  })
})

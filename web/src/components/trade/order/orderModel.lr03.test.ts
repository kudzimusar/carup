/**
 * RX06-LR03: the Import Order activity and failure wording against the RX06-BE-01 R2C redacted audit
 * timeline (no actor ids, no snapshots) and against session/permission/unknown failures. Fictional data.
 */
import { describe, expect, it } from 'vitest'
import { SessionExpiredError } from '@/lib/apiClient'
import { actionFailureText, activityActorLabel, buildActivity, isSessionEnded, readFromError, SESSION_ENDED_TEXT, type TradeOrder } from './orderModel'

const ORDER: TradeOrder = {
  id: 'fx-order-0003', order_type: 'vehicle', origin_country: 'Japan', destination_country: 'Zimbabwe', status: 'QUOTE_ISSUED',
  buyer_id: 'fx-buyer', created_at: '2026-11-22T01:00:00Z', updated_at: '2026-11-22T01:05:00Z',
  diaspora_import_quotes: [{ id: 'fx-quote-1', quote_amount: 17500, quote_currency: 'USD', created_at: '2026-11-22T01:05:00Z' }],
}
const redacted = [
  { id: 'a1', action: 'IMPORT_ORDER_CREATED', resource_type: 'diaspora_import_order', resource_id: ORDER.id, created_at: '2026-11-22T01:00:00Z', actor_relation: 'you' as const, sealed: true },
  { id: 'a2', action: 'QUOTE_ISSUED', resource_type: 'diaspora_import_quote', resource_id: 'fx-quote-1', created_at: '2026-11-22T01:05:00Z', actor_relation: 'other' as const, sealed: true },
  { id: 'a3', action: 'IMPORT_ORDER_STATUS_CHANGED', resource_type: 'diaspora_import_order', resource_id: ORDER.id, created_at: '2026-11-22T01:05:00Z', status_from: 'SELLER_ASSIGNED', status_to: 'QUOTE_ISSUED', actor_relation: 'other' as const, sealed: true },
]

describe('activity from the redacted audit timeline', () => {
  it('describes a status change from status_from/status_to', () => {
    const e = buildActivity({ order: ORDER, audit: redacted }).find(x => x.id === 'audit:a3')!
    expect(e.detail).toBe('Seller assigned → Quote issued')
  })
  it('describes a quote from the order\'s own quote record and does not list it twice', () => {
    const events = buildActivity({ order: ORDER, audit: redacted })
    expect(events.find(x => x.id === 'audit:a2')?.detail).toBe('USD 17,500')
    expect(events.filter(x => x.title === 'Quote recorded')).toHaveLength(1)
    expect(events.filter(x => x.title === 'Import request recorded')).toHaveLength(1)
  })
  it('says who acted without an identifier, and keeps the sealed mark', () => {
    const events = buildActivity({ order: ORDER, audit: redacted })
    expect(activityActorLabel(events.find(x => x.id === 'audit:a1')!, 'fx-buyer')).toBe('You')
    expect(activityActorLabel(events.find(x => x.id === 'audit:a2')!, 'fx-buyer')).toBe('Another participant')
    expect(activityActorLabel({ actorId: null, actorRelation: 'system' }, 'fx-buyer')).toBe('CarUp')
    expect(activityActorLabel({ actorId: null, actorRelation: null }, 'fx-buyer')).toBe('Not recorded')
    expect(events.find(x => x.id === 'audit:a2')?.sealed).toBe(true)
  })
  it('still reads raw rows (reviewers, older servers) exactly as before', () => {
    const raw = [{ id: 'r1', action: 'IMPORT_ORDER_STATUS_CHANGED', actor_id: 'fx-buyer', previous_state: { status: 'IMPORT_REQUESTED' }, new_state: { status: 'CANCELLED' }, cryptographic_seal: 'seal', created_at: '2026-11-22T02:00:00Z' }]
    const e = buildActivity({ order: ORDER, audit: raw }).find(x => x.id === 'audit:r1')!
    expect(e.detail).toBe('Request received → Cancelled')
    expect(activityActorLabel(e, 'fx-buyer')).toBe('You')
  })
})

describe('failures say what happened', () => {
  const err = (status: number | undefined, message = 'server said no') => Object.assign(new Error(message), status === undefined ? {} : { status })
  it('an ended session is never a retry', () => {
    const s = new SessionExpiredError()
    expect(s.status).toBe(401)
    expect(isSessionEnded(s)).toBe(true)
    expect(readFromError(s, () => {})).toEqual({ state: 'failed', message: SESSION_ENDED_TEXT })
    expect(actionFailureText(s, 'Blocked: ')).toMatch(/session has ended/)
  })
  it('only a business refusal carries the action prefix', () => {
    expect(actionFailureText(err(400, 'Zimbabwe Ready requires ZIMRA clearance'), 'Blocked: ')).toBe('Blocked: Zimbabwe Ready requires ZIMRA clearance')
    expect(actionFailureText(err(409), 'Blocked: ')).toBe('Blocked: server said no')
    expect(actionFailureText(err(403), 'Blocked: ')).toBe('Not permitted: server said no')
    expect(actionFailureText(err(404), 'Blocked: ')).toBe('Not found: server said no')
  })
  it('an unconfirmed outcome never claims nothing changed', () => {
    for (const e of [err(500), err(502), err(undefined, 'Failed to fetch')]) {
      const text = actionFailureText(e, 'Blocked: ')
      expect(text).toMatch(/Refresh to see the current state/)
      expect(text).not.toMatch(/Blocked|nothing (was )?changed/i)
    }
  })
})

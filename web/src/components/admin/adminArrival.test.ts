/**
 * CA-OWNER-02 (J) — every link from Corporate Admin into the operational Admin carries the same arrival marker, so the
 * operational Admin can say where the visit came from. The marker is navigation context only: it never grants anything.
 */
import { describe, expect, it } from 'vitest'
import { OPERATIONAL_ADMIN_FROM_CORPORATE, arrivedFromCorporate, withCorporateArrival } from './adminArrival'

describe('withCorporateArrival', () => {
  it('adds the marker to an operational Admin route, keeping its own query and fragment', () => {
    expect(withCorporateArrival('/admin/communications')).toBe('/admin/communications?from=corporate')
    expect(withCorporateArrival('/admin/moderation?tab=inquiries')).toBe('/admin/moderation?tab=inquiries&from=corporate')
    expect(withCorporateArrival('/admin/evidence#pending')).toBe('/admin/evidence?from=corporate#pending')
    expect(arrivedFromCorporate(withCorporateArrival('/admin/moderation?tab=inquiries').split('?')[1])).toBe(true)
  })

  it('is idempotent and agrees with the root transition link', () => {
    expect(withCorporateArrival('/admin')).toBe(OPERATIONAL_ADMIN_FROM_CORPORATE)
    expect(withCorporateArrival(OPERATIONAL_ADMIN_FROM_CORPORATE)).toBe(OPERATIONAL_ADMIN_FROM_CORPORATE)
  })

  it('leaves every route outside the operational Admin untouched', () => {
    for (const route of ['/corporate/finance', '/dashboard', '/administrator', 'https://example.invalid/admin']) {
      expect(withCorporateArrival(route)).toBe(route)
    }
  })
})

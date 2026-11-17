import { describe, expect, it } from 'vitest'
import { buildDealerActionQueue, daysUntil, type DealerQueueInput } from './dealerActionQueue'

// Noon UTC keeps calendar-day arithmetic identical in any CI timezone from UTC-11 to UTC+11.
const NOW = new Date('2026-11-18T12:00:00Z')

function input(over: Partial<DealerQueueInput> = {}): DealerQueueInput {
  return {
    now: NOW,
    profile: {
      identity_status: 'verified', compliance_review_state: 'passed', active_state: 'active',
      restriction_state: 'none', suspension_state: 'none', investigation_state: 'none',
      expiry_date: '2027-06-01T00:00:00Z',
    },
    attachedClaims: [],
    branches: [{ id: 'b1', name: 'Main yard', latitude: -17.8, longitude: 31.0, opening_hours_text: 'Mon–Fri' }],
    carryoverNeedsAttention: 0,
    inventory: { status: 'ready', entries: [{ vin: 'V1', make: 'Toyota', model: 'Hilux', year: 2020, recorded_marketplace_publication_state: 'published' }] },
    enquiries: { status: 'ready', entries: [] },
    media: { status: 'ready', items: [
      { media_category: 'COMPANY_COVER_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: '2026-11-01' },
      { media_category: 'COMPANY_PROFILE_IMAGE', review_status: 'APPROVED_PUBLIC_DISPLAY', created_at: '2026-11-01' },
    ] },
    staff: { status: 'ready', invitations: [] },
    ...over,
  }
}

describe('RX05-B Dealer Action Queue', () => {
  it('is empty and every area is clear only when every read succeeded and nothing needs attention', () => {
    const { items, areas } = buildDealerActionQueue(input())
    expect(items).toEqual([])
    expect(areas.every(a => a.state === 'clear')).toBe(true)
  })

  it('never reports all-clear for an area whose read failed', () => {
    const { items, areas } = buildDealerActionQueue(input({
      enquiries: { status: 'unavailable', entries: [] },
      inventory: { status: 'unavailable', entries: [] },
    }))
    expect(items.map(i => i.id)).toEqual(expect.arrayContaining(['enquiries-unread', 'inventory-unread']))
    expect(items.find(i => i.id === 'inventory-unread')?.detail).toMatch(/not proof of zero vehicles/)
    expect(areas.find(a => a.area === 'enquiries')?.state).toBe('unavailable')
    expect(areas.find(a => a.area === 'inventory')?.state).toBe('unavailable')
  })

  it('projects the real local claimant data: expiry in 9 days, a new enquiry, a blocked vehicle, no images', () => {
    const { items } = buildDealerActionQueue(input({
      profile: { ...input().profile, expiry_date: '2026-11-27T12:00:00Z' },
      inventory: { status: 'ready', entries: [{ vin: 'TEST0000000000001', make: 'FICTIONAL', model: 'CI-ONLY TEST VEHICLE', year: 2026,
        recorded_marketplace_publication_state: 'draft',
        listing_structural_precheck: { result: 'REQUIRES_DATA_CORRECTION', blocking_reason_codes: ['invalid_vin_format', 'invalid_price'] } }] },
      enquiries: { status: 'ready', entries: [{ inquiry_id: 'q1', status: 'new', created_at: '2026-11-16T04:40:09Z', allowed_followup_status: 'contacted' }] },
      media: { status: 'ready', items: [] },
    }))
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    expect(byId['legal-expiry']).toMatchObject({ tone: 'urgent', title: 'Legal review expires in 9 days' })
    expect(byId['enquiries-new']).toMatchObject({ tone: 'action', cta: { href: '/dealers/inquiries' } })
    expect(byId['inventory-correction'].title).toBe('2026 FICTIONAL CI-ONLY TEST VEHICLE needs data corrections before listing')
    expect(byId['inventory-correction'].detail).toBe('Listing checks flagged: invalid vin format, invalid price.')
    expect(byId['inventory-drafts']).toBeUndefined() // the blocked draft is not double-counted
    expect(byId['media-missing']).toMatchObject({ title: 'Add your cover and profile images', cta: { href: '/dealers/operating-details#dealer-profile-images' } })
    // Urgent first.
    expect(items[0].id).toBe('legal-expiry')
  })

  it('treats images awaiting review as waiting, never as approved, and asks for a missing one', () => {
    const { items, areas } = buildDealerActionQueue(input({ media: { status: 'ready', items: [
      { media_category: 'COMPANY_COVER_IMAGE', review_status: 'PENDING_INDEPENDENT_REVIEW', created_at: '2026-11-17' },
      { media_category: 'COMPANY_PROFILE_IMAGE', review_status: 'REJECTED', created_at: '2026-11-17' },
    ] } }))
    expect(items.find(i => i.id === 'media-pending')).toMatchObject({ tone: 'waiting', title: '1 image awaiting independent review' })
    expect(items.find(i => i.id === 'media-missing')?.title).toBe('Add a profile image')
    expect(items.find(i => i.id === 'media-rejected')?.tone).toBe('action')
    expect(areas.find(a => a.area === 'media')?.state).toBe('attention')
  })

  it('escalates suspension, expired legal review and revoked attached claims as urgent', () => {
    const { items } = buildDealerActionQueue(input({
      profile: { ...input().profile, suspension_state: 'temporary_hold', expiry_date: '2026-11-01T00:00:00Z' },
      attachedClaims: [{ attachment_id: 'a1', seed_dealer_id: 'ZW-DEAL-0002', effective_status: 'REVOKED', legal_expires_at: null }],
    }))
    const urgent = items.filter(i => i.tone === 'urgent').map(i => i.id)
    expect(urgent).toEqual(expect.arrayContaining(['suspension', 'legal-expired', 'attached-a1']))
  })

  it('offers the in-place branch editor for missing branch details and for a dealership with no branches', () => {
    const partial = buildDealerActionQueue(input({ branches: [{ id: 'b2', name: 'Second yard', latitude: null, longitude: null, opening_hours_text: null }] }))
    expect(partial.items[0]).toMatchObject({ editBranchId: 'b2', title: 'Add opening hours and map location for Second yard', tone: 'suggestion' })
    const none = buildDealerActionQueue(input({ branches: [] }))
    expect(none.items[0]).toMatchObject({ id: 'branches-none', addBranch: true })
  })

  it('separates staff invitations that are about to expire from those simply waiting', () => {
    const { items } = buildDealerActionQueue(input({ staff: { status: 'ready', invitations: [
      { invite_id: 'i1', status: 'PENDING', expires_at: '2026-11-19T12:00:00Z' },
      { invite_id: 'i2', status: 'PENDING', expires_at: '2026-12-10T00:00:00Z' },
      { invite_id: 'i3', status: 'REVOKED', expires_at: '2026-12-10T00:00:00Z' },
    ] } }))
    expect(items.find(i => i.id === 'staff-expiring')?.title).toBe('1 staff invitation about to expire')
    expect(items.find(i => i.id === 'staff-pending')?.title).toBe('1 staff invitation awaiting acceptance')
  })

  it('counts calendar days, treats an instant already passed as expired, and ignores unparseable dates', () => {
    expect(daysUntil('2026-11-27T12:00:00Z', NOW)).toBe(9)
    expect(daysUntil('2026-11-18T12:30:00Z', NOW)).toBe(0)
    expect(daysUntil('2026-11-18T11:00:00Z', NOW)).toBe(-1)
    expect(daysUntil('not a date', NOW)).toBeNull()
    expect(daysUntil(null, NOW)).toBeNull()
  })
})

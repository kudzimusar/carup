/**
 * T7.6 — a Trade OS conversation must say WHICH trade it is about.
 *
 * Found by opening the inbox after starting a conversation: every Trade OS thread is a
 * `marketplace` / `marketplace_inquiry` flow, so a customer with a sourcing request, a shipping
 * request and a container booking in flight saw three identical rows reading "Marketplace
 * conversation". A thread nobody can identify is a thread nobody can use.
 */
import { describe, it, expect } from 'vitest'
import { threadLabel } from './threadLabel'

const t = (over: Record<string, unknown> = {}) => ({
  business_workflow: 'marketplace', thread_type: 'marketplace_inquiry', ...over,
}) as never

describe('inbox thread labels', () => {
  it('names the sourcing request, not "Marketplace conversation"', () => {
    expect(threadLabel(t({ subject_type: 'diaspora_rfq', subject_id: '87b14d63-82f7-4f55-9c46-1c159b0b61a0:qa-supplier' })))
      .toBe('Sourcing request RFQ-87B14D63')
  })

  it('names the shipping request', () => {
    expect(threadLabel(t({ subject_type: 'diaspora_logistics_request', subject_id: 'f2505399-fce8-4be6-aaf0-8e3423387c63:u_prov' })))
      .toBe('Shipping request SHIP-F2505399')
  })

  it('names the container sailing', () => {
    expect(threadLabel(t({ subject_type: 'diaspora_container_booking', subject_id: '561adedf-ca7e-418b-98ec-77415d8e4fdb:u_buyer' })))
      .toBe('Container sailing SAIL-561ADEDF')
  })

  it('gives three different trades three different labels', () => {
    const labels = [
      threadLabel(t({ subject_type: 'diaspora_rfq', subject_id: 'aaaaaaaa-1111:x' })),
      threadLabel(t({ subject_type: 'diaspora_logistics_request', subject_id: 'bbbbbbbb-2222:y' })),
      threadLabel(t({ subject_type: 'diaspora_container_booking', subject_id: 'cccccccc-3333:z' })),
    ]
    expect(new Set(labels).size).toBe(3)
    expect(labels.some((l) => l === 'Marketplace conversation')).toBe(false)
  })

  it('leaves every non-Trade-OS thread exactly as it was', () => {
    expect(threadLabel(t({}))).toBe('Marketplace conversation')
    expect(threadLabel(t({ business_workflow: 'support', thread_type: 'support_ticket' }))).toBe('support')
  })
})

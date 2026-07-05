import { describe, expect, it } from 'vitest'
import { priorityVariant, threadRef, threadSla, threadTitle } from './threadPresentation'

describe('threadTitle', () => {
  it('title-cases the thread type and falls back to Conversation', () => {
    expect(threadTitle({ thread_type: 'marketplace_inquiry' })).toBe('Marketplace Inquiry')
    expect(threadTitle({ thread_type: 'support' })).toBe('Support')
    expect(threadTitle(null)).toBe('Conversation')
    expect(threadTitle({})).toBe('Conversation')
  })
})

describe('threadRef', () => {
  it('prefers business references, then subject, then a short key/id (never the full UUID)', () => {
    expect(threadRef({ marketplace_listing_id: 'LST-9', escrow_id: 'E-1' })).toBe('LST-9')
    expect(threadRef({ escrow_id: 'E-1' })).toBe('E-1')
    expect(threadRef({ subject_type: 'order', subject_id: '42' })).toBe('order:42')
    expect(threadRef({ thread_key: 'abcdefghijklmnopqrst' })).toBe('abcdefghijklmn')
    expect(threadRef({ id: '11111111-2222-3333-4444-555555555555' })).toBe('11111111')
    expect(threadRef(null)).toBe('')
  })
})

describe('priorityVariant', () => {
  it('maps priority to a badge variant', () => {
    expect(priorityVariant('urgent')).toBe('destructive')
    expect(priorityVariant('high')).toBe('destructive')
    expect(priorityVariant('low')).toBe('outline')
    expect(priorityVariant('normal')).toBe('secondary')
    expect(priorityVariant(undefined)).toBe('secondary')
  })
})

describe('threadSla', () => {
  const now = Date.parse('2026-07-05T12:00:00.000Z')
  it('classifies breach / due / ok and none for terminal or invalid', () => {
    expect(threadSla({ sla_due_at: '2026-07-05T11:00:00.000Z', status: 'open' }, now).level).toBe('breach')
    expect(threadSla({ sla_due_at: '2026-07-05T12:10:00.000Z', status: 'open' }, now).level).toBe('due')
    expect(threadSla({ sla_due_at: '2026-07-05T14:00:00.000Z', status: 'open' }, now).level).toBe('ok')
    expect(threadSla({ sla_due_at: '2026-07-05T11:00:00.000Z', status: 'resolved' }, now).level).toBe('none')
    expect(threadSla({ sla_due_at: 'garbage', status: 'open' }, now).level).toBe('none')
    expect(threadSla({ status: 'open' }, now).level).toBe('none')
  })
})

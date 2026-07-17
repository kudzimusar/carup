import { describe, expect, it } from 'vitest'
import { priorityVariant, threadPreview, threadRef, threadSla, threadTitle, threadUnreadCount } from './threadPresentation'

describe('threadTitle', () => {
  it('is identity-first: name, then masked address/handle, then type, then Conversation', () => {
    expect(threadTitle({ identity_display_name: 'Tariro M.', thread_type: 'support' })).toBe('Tariro M.')
    expect(threadTitle({ identity_address: '+263••••1234', thread_type: 'support' })).toBe('+263••••1234')
    expect(threadTitle({ identity_external_id: '@tariro', thread_type: 'support' })).toBe('@tariro')
    // No identity → friendly type (never a raw UUID/thread-key).
    expect(threadTitle({ thread_type: 'marketplace_inquiry' })).toBe('Marketplace Inquiry')
    expect(threadTitle({ thread_type: 'support' })).toBe('Support')
    expect(threadTitle(null)).toBe('Conversation')
    expect(threadTitle({})).toBe('Conversation')
  })
})

describe('threadPreview', () => {
  it('returns a whitespace-collapsed, truncated latest-message preview', () => {
    expect(threadPreview({ latest_message_text: '  Is the  Prado\nstill available? ' })).toBe('Is the Prado still available?')
    expect(threadPreview({})).toBe('')
    expect(threadPreview({ latest_message_text: 'x'.repeat(200) }, 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('threadUnreadCount', () => {
  it('returns a positive integer or 0', () => {
    expect(threadUnreadCount({ unread_count: 3 })).toBe(3)
    expect(threadUnreadCount({ unread_count: 0 })).toBe(0)
    expect(threadUnreadCount({})).toBe(0)
    expect(threadUnreadCount({ unread_count: -2 })).toBe(0)
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

  it('reports paused and lets it override a would-be breach (item 10)', () => {
    const paused = threadSla({ sla_due_at: '2026-07-05T11:00:00.000Z', sla_paused_at: '2026-07-05T10:00:00.000Z', status: 'open' }, now)
    expect(paused.level).toBe('paused')
    expect(paused.label).toBe('SLA paused')
    // Terminal still wins over paused.
    expect(threadSla({ sla_paused_at: '2026-07-05T10:00:00.000Z', status: 'resolved' }, now).level).toBe('none')
  })
})

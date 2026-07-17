import { describe, expect, it } from 'vitest'
import {
  auditActorLabel, auditEventLabel, auditEventTone, auditTechnicalRows,
} from './auditPresentation'

describe('auditPresentation', () => {
  it('labels known event types and falls back to title case', () => {
    expect(auditEventLabel('reply_sent')).toBe('Reply sent')
    expect(auditEventLabel('dead_lettered')).toBe('Dead-lettered')
    expect(auditEventLabel('some_custom_event')).toBe('Some Custom Event')
    expect(auditEventLabel(null)).toBe('Event')
  })

  it('assigns a semantic tone (critical for dead-letter, positive for delivery receipt)', () => {
    expect(auditEventTone('dead_lettered')).toBe('critical')
    expect(auditEventTone('delivery_receipt')).toBe('positive')
    expect(auditEventTone('escalated')).toBe('warning')
    expect(auditEventTone('unknown')).toBe('neutral')
  })

  it('renders actor labels without leaking full ids, and system/worker without id', () => {
    expect(auditActorLabel({ actor_type: 'admin', actor_id: '11111111-2222-3333' })).toBe('Admin 11111111…')
    expect(auditActorLabel({ actor_type: 'agent', actor_id: 'short' })).toBe('Agent short')
    expect(auditActorLabel({ actor_type: 'system', actor_id: null })).toBe('System')
    expect(auditActorLabel({ actor_type: 'worker', actor_id: 'w1' })).toBe('Worker')
    expect(auditActorLabel(null)).toBe('System')
  })

  it('builds technical rows from ids + metadata, skipping empty values', () => {
    const rows = auditTechnicalRows({
      id: 'a', event_type: 'delivery_attempt', correlation_id: 'corr-1', message_id: 'm-1',
      notification_id: null, metadata: { provider_message_id: 'wamid.X', attempt: 2, note: '' },
    })
    const keys = rows.map((r) => r.key)
    expect(keys).toContain('Correlation ID')
    expect(keys).toContain('Message ID')
    expect(keys).not.toContain('Notification ID') // null skipped
    expect(rows.find((r) => r.key === 'Provider Message Id')?.value).toBe('wamid.X')
    expect(rows.find((r) => r.key === 'Attempt')?.value).toBe('2')
    expect(keys).not.toContain('Note') // empty string skipped
  })
})

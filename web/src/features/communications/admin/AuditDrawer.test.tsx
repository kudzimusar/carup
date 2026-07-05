import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuditDrawer } from './AuditDrawer'
import type { AuditEvent } from './auditPresentation'

const events: AuditEvent[] = [
  {
    id: 'e1', event_type: 'reply_sent', actor_type: 'admin', actor_id: 'admin-123456789',
    channel: 'whatsapp', summary: 'Sent price to customer', correlation_id: 'corr-abc',
    message_id: 'msg-1', metadata: { provider_message_id: 'wamid.ABC' },
    created_at: '2026-07-05T10:00:00.000Z',
  },
  {
    id: 'e2', event_type: 'dead_lettered', actor_type: 'worker', actor_id: 'w1',
    channel: 'whatsapp', summary: 'Max retries exceeded', created_at: '2026-07-05T09:00:00.000Z',
    metadata: {},
  },
]

describe('AuditDrawer', () => {
  it('renders a timeline with visible exact timestamps, labels, actors and summaries', () => {
    const html = renderToStaticMarkup(<AuditDrawer events={events} timeZone="UTC" />)
    expect(html).toContain('Audit trail')
    expect(html).toContain('Reply sent')
    expect(html).toContain('Dead-lettered')
    expect(html).toContain('Sent price to customer')
    expect(html).toContain('Admin admin-12…')
    // Exact, visible timestamp (not hover-only) via a <time> element.
    expect(html).toContain('<time')
    expect(html).toContain('2026-07-05T10:00:00.000Z')
    expect(html).toContain('data-event-type="reply_sent"')
    expect(html).toContain('data-testid="audit-event"')
  })

  it('hides technical detail by default and reveals ids + metadata when showTechnical', () => {
    const plain = renderToStaticMarkup(<AuditDrawer events={events} timeZone="UTC" />)
    expect(plain).not.toContain('data-testid="audit-technical"')
    expect(plain).not.toContain('wamid.ABC')

    const tech = renderToStaticMarkup(<AuditDrawer events={events} timeZone="UTC" showTechnical />)
    expect(tech).toContain('data-testid="audit-technical"')
    expect(tech).toContain('corr-abc')
    expect(tech).toContain('wamid.ABC')
  })

  it('shows an empty state and a loading state', () => {
    expect(renderToStaticMarkup(<AuditDrawer events={[]} />)).toContain('No audit events recorded yet.')
    expect(renderToStaticMarkup(<AuditDrawer events={[]} loading />)).toContain('Loading audit trail…')
  })
})

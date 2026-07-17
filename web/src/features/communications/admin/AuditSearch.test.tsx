import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuditSearch } from './AuditSearch'
import type { AuditEvent } from './auditPresentation'

const events: AuditEvent[] = [
  {
    id: 'e1', event_type: 'reply_sent', actor_type: 'admin', actor_id: 'admin-123456789',
    summary: 'Sent price to customer', thread_id: 't-1', created_at: '2026-07-05T10:00:00.000Z',
  },
  {
    id: 'e2', event_type: 'dead_lettered', actor_type: 'worker', actor_id: 'w1',
    summary: 'Max retries exceeded', created_at: '2026-07-05T09:00:00.000Z',
  },
]

const noop = () => {}

describe('AuditSearch', () => {
  it('renders the fixed event-type filter chips and marks the active one', () => {
    const html = renderToStaticMarkup(
      <AuditSearch events={events} eventType="reply_sent" onEventTypeChange={noop} onOpenThread={noop} />,
    )
    expect(html).toContain('data-testid="audit-search"')
    expect(html).toContain('All')
    expect(html).toContain('Reply sent')
    expect(html).toContain('Assigned')
    expect(html).toContain('Escalated')
    expect(html).toContain('Resolved')
    expect(html).toContain('Dead-lettered')
    expect(html).toContain('Provider smoke test')
    // The active filter chip is flagged.
    expect(html).toContain('data-active="true"')
  })

  it('renders each event newest-first with a visible exact timestamp, label, actor and summary', () => {
    const html = renderToStaticMarkup(
      <AuditSearch events={events} eventType="" onEventTypeChange={noop} onOpenThread={noop} />,
    )
    expect(html).toContain('data-testid="audit-search-row"')
    expect(html).toContain('data-event-type="reply_sent"')
    expect(html).toContain('Admin admin-12…')
    expect(html).toContain('Sent price to customer')
    // Exact, visible timestamp via a <time> element carrying the ISO instant.
    expect(html).toContain('<time')
    expect(html).toContain('2026-07-05T10:00:00.000Z')
    // Preserves the given (newest-first) order — summaries are unique to rows.
    expect(html.indexOf('Sent price to customer')).toBeLessThan(html.indexOf('Max retries exceeded'))
  })

  it('offers "Open thread" only for events tied to a thread', () => {
    const html = renderToStaticMarkup(
      <AuditSearch events={events} eventType="" onEventTypeChange={noop} onOpenThread={noop} />,
    )
    // Only e1 carries a thread_id.
    expect((html.match(/Open thread/g) || []).length).toBe(1)
    expect(html).toContain('data-testid="audit-search-open-thread"')
  })

  it('shows the empty and loading states', () => {
    expect(
      renderToStaticMarkup(<AuditSearch events={[]} eventType="" onEventTypeChange={noop} onOpenThread={noop} />),
    ).toContain('No audit events found.')
    expect(
      renderToStaticMarkup(<AuditSearch events={[]} eventType="" onEventTypeChange={noop} onOpenThread={noop} loading />),
    ).toContain('Loading audit events…')
  })
})

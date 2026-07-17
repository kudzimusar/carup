import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationRow } from './ConversationRow'

describe('ConversationRow', () => {
  it('renders identity/context-first content with channel, status, priority and SLA', () => {
    const html = renderToStaticMarkup(
      <ConversationRow
        channel="whatsapp"
        title="Marketplace inquiry"
        reference="LST-9"
        statusLabel="Awaiting Human"
        priority="high"
        priorityVariant="destructive"
        unassigned
        slaLevel="breach"
        slaLabel="SLA overdue 5m"
        timeLabel="2m ago"
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('Marketplace inquiry')
    expect(html).toContain('LST-9')
    expect(html).toContain('Awaiting Human')
    expect(html).toContain('high')
    expect(html).toContain('Unassigned')
    expect(html).toContain('SLA overdue 5m')
    expect(html).toContain('2m ago')
    expect(html).toContain('data-channel="whatsapp"')
  })

  it('marks the selected row', () => {
    const html = renderToStaticMarkup(
      <ConversationRow title="t" statusLabel="Open" selected onSelect={() => {}} />,
    )
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('aria-current="true"')
  })

  it('omits optional bits gracefully', () => {
    const html = renderToStaticMarkup(<ConversationRow title="Bare" statusLabel="Open" onSelect={() => {}} />)
    expect(html).toContain('Bare')
    expect(html).not.toContain('Unassigned')
  })

  it('shows a latest-message preview and an unread badge when unread', () => {
    const html = renderToStaticMarkup(
      <ConversationRow
        title="Tariro M."
        statusLabel="Awaiting Human"
        preview="Is the Prado still available?"
        unreadCount={3}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('Is the Prado still available?')
    expect(html).toContain('data-testid="row-preview"')
    expect(html).toContain('data-testid="row-unread"')
    expect(html).toContain('aria-label="3 unread"')
    expect(html).toContain('data-unread="true"')
    expect(html).toContain('>3<')
  })

  it('caps the unread badge at 99+ and hides it when read', () => {
    const many = renderToStaticMarkup(<ConversationRow title="t" statusLabel="Open" unreadCount={250} onSelect={() => {}} />)
    expect(many).toContain('99+')
    const read = renderToStaticMarkup(<ConversationRow title="t" statusLabel="Open" unreadCount={0} preview="hi" onSelect={() => {}} />)
    expect(read).not.toContain('data-testid="row-unread"')
    expect(read).not.toContain('data-unread="true"')
  })
})

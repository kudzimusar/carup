import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationHeader } from './ConversationHeader'

describe('ConversationHeader', () => {
  it('shows identity, channel, status, priority, AI mode, owner and SLA', () => {
    const html = renderToStaticMarkup(
      <ConversationHeader
        channel="telegram"
        title="Escrow support"
        reference="ESC-42"
        statusLabel="Escalated"
        priority="urgent"
        priorityVariant="destructive"
        aiMode="draft_only"
        assignedLabel="Support"
        slaLevel="breach"
        slaLabel="SLA overdue 3m"
      />,
    )
    expect(html).toContain('Escrow support')
    expect(html).toContain('ESC-42')
    expect(html).toContain('Escalated')
    expect(html).toContain('urgent')
    expect(html).toContain('AI: draft_only')
    expect(html).toContain('Support')
    expect(html).toContain('SLA overdue 3m')
    expect(html).toContain('data-channel="telegram"')
  })

  it('renders a minimal header without optional fields', () => {
    const html = renderToStaticMarkup(<ConversationHeader title="Bare" statusLabel="Open" assignedLabel="Unassigned" />)
    expect(html).toContain('Bare')
    expect(html).toContain('Unassigned')
    expect(html).not.toContain('AI:')
  })
})

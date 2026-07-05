import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageBubble } from './MessageBubble'

const NOW = Date.parse('2026-07-05T12:00:00.000Z')

describe('MessageBubble', () => {
  it('renders an outbound message with delivery state and provider id', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{ id: 'm1', direction: 'outbound', channel: 'whatsapp', status: 'delivered', content_text: 'Hi there', created_at: '2026-07-05T11:59:00.000Z', provider_message_id: 'wamid.ABC' }}
        now={NOW}
      />,
    )
    expect(html).toContain('outbound')
    expect(html).toContain('Hi there')
    expect(html).toContain('Delivered')
    expect(html).toContain('wamid.ABC')
    expect(html).toContain('data-direction="outbound"')
  })

  it('marks an internal note as not sent to the user', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ id: 'm2', direction: 'internal', content_text: 'note to team', created_at: '2026-07-05T11:00:00.000Z' }} now={NOW} />,
    )
    expect(html).toContain('Internal note')
    expect(html).toContain('not sent to user')
    expect(html).toContain('note to team')
  })

  it('flags an outbound message stuck past the SLA', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{ id: 'm3', direction: 'outbound', channel: 'telegram', status: 'queued', content_text: 'pending', created_at: '2026-07-05T11:00:00.000Z' }}
        slaThresholdSeconds={60}
        now={NOW}
      />,
    )
    expect(html).toContain('past SLA')
  })

  it('never renders Invalid Date for a bad timestamp', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={{ id: 'm4', direction: 'inbound', channel: 'email', content_text: 'hello', created_at: 'not-a-date' }} now={NOW} />,
    )
    expect(html).not.toContain('Invalid Date')
    expect(html).toContain('hello')
  })
})

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageBubble } from './MessageBubble'

const NOW = Date.parse('2026-07-05T12:00:00.000Z')

describe('MessageBubble', () => {
  it('shows visible channel/label, direction, sender, exact date+time, delivery state; hides raw ids (P1.5)', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{ id: 'm1', direction: 'outbound', channel: 'whatsapp', status: 'delivered', content_text: 'Hi there', created_at: '2026-07-05T11:59:00.000Z', provider_message_id: 'wamid.ABC' }}
        senderLabel="Agent Tino"
        timeZone="UTC"
        now={NOW}
      />,
    )
    expect(html).toContain('Hi there')
    expect(html).toContain('WhatsApp')                 // friendly channel label
    expect(html).toContain('data-channel="whatsapp"')  // branded channel icon
    expect(html).toContain('Outbound')                 // visible direction
    expect(html).toContain('Agent Tino')               // sender identity
    expect(html).toContain('Delivered')                // delivery state
    expect(html).toContain('data-testid="message-stamp"')
    expect(html).toContain('<time')                    // exact date/time visible (not hover-only)
    expect(html).toMatch(/2026|Jul/)                   // human-readable calendar date is rendered
    expect(html).toContain('data-direction="outbound"')
    // Raw provider id belongs to the technical drawer, NOT the normal bubble.
    expect(html).not.toContain('wamid.ABC')
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

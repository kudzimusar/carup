import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageTechnicalDetails, type MessageTechnical } from './MessageTechnicalDetails'

const full: MessageTechnical = {
  id: 'm1',
  direction: 'outbound',
  channel: 'whatsapp',
  status: 'dead_letter',
  created_at: '2026-07-05T10:00:00.000Z',
  provider_message_id: 'wamid.HBgLMTIzNDU2Nzg5MAA',
  correlation_id: 'corr-abc-123',
  sender_user_id: 'user-987',
}

describe('MessageTechnicalDetails', () => {
  it('renders a compact metadata sheet with the raw ISO timestamp and every present field', () => {
    const html = renderToStaticMarkup(<MessageTechnicalDetails message={full} timeZone="UTC" />)
    expect(html).toContain('data-testid="message-technical"')
    // Raw ISO exposed both as visible text and as a machine-readable <time>.
    expect(html).toContain('<time')
    expect(html).toContain('2026-07-05T10:00:00.000Z')
    expect(html).toContain('Created at')
    // Raw technical values (no friendly relabelling).
    expect(html).toContain('Direction')
    expect(html).toContain('outbound')
    expect(html).toContain('Channel')
    expect(html).toContain('whatsapp')
    expect(html).toContain('Delivery status')
    expect(html).toContain('dead_letter')
    expect(html).toContain('Provider message id')
    expect(html).toContain('wamid.HBgLMTIzNDU2Nzg5MAA')
    expect(html).toContain('Correlation id')
    expect(html).toContain('corr-abc-123')
    expect(html).toContain('Sender user id')
    expect(html).toContain('user-987')
    // Mono values, break-all on long ids.
    expect(html).toContain('font-mono')
    expect(html).toContain('break-all')
  })

  it('renders only the fields that are present', () => {
    const partial: MessageTechnical = {
      id: 'm2',
      created_at: '2026-07-05T09:00:00.000Z',
      provider_message_id: 'wamid.ONLY',
    }
    const html = renderToStaticMarkup(<MessageTechnicalDetails message={partial} timeZone="UTC" />)
    expect(html).toContain('data-testid="message-technical"')
    expect(html).toContain('Created at')
    expect(html).toContain('wamid.ONLY')
    // Absent fields are not rendered at all.
    expect(html).not.toContain('Direction')
    expect(html).not.toContain('Channel')
    expect(html).not.toContain('Delivery status')
    expect(html).not.toContain('Correlation id')
    expect(html).not.toContain('Sender user id')
  })

  it('renders a placeholder line when the message has no technical metadata', () => {
    const empty: MessageTechnical = { id: 'm3' }
    const html = renderToStaticMarkup(<MessageTechnicalDetails message={empty} />)
    expect(html).toContain('No technical metadata.')
    // The <dl> is not rendered when every field is empty.
    expect(html).not.toContain('data-testid="message-technical"')
  })
})

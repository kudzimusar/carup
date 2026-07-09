import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReplyComposer } from './ReplyComposer'

const base = {
  reply: '',
  onReplyChange: () => {},
  internalNote: false,
  onInternalNoteChange: () => {},
  idempotencyKey: 'abcdef12-3456',
  onSend: () => {},
}

describe('ReplyComposer', () => {
  it('states the exact reply target for the channel', () => {
    const html = renderToStaticMarkup(<ReplyComposer {...base} channel="whatsapp" status="idle" />)
    expect(html).toContain('Reply via')
    expect(html).toContain('WhatsApp')
    expect(html).toContain('to the customer')
    expect(html).toContain('Send reply')
    expect(html).toContain('data-channel="whatsapp"')
  })

  it('switches to an internal-note target when the toggle is on', () => {
    const html = renderToStaticMarkup(<ReplyComposer {...base} channel="whatsapp" internalNote status="idle" />)
    expect(html).toContain('not sent to the customer')
    expect(html).toContain('Add internal note')
  })

  it('shows the correlation id and draft-preserved hint on failure', () => {
    const html = renderToStaticMarkup(
      <ReplyComposer {...base} channel="telegram" status="failed" error="Reply failed." correlationId="req-123" />,
    )
    expect(html).toContain('Reply failed.')
    expect(html).toContain('req-123')
    expect(html).toContain('draft was preserved')
  })
})

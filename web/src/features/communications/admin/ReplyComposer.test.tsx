import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

describe('ReplyComposer — reply channel (CC-REPLY-CHANNEL-01)', () => {
  it('offers exactly the deliverable channels and reports a pick', () => {
    const onChannelChange = vi.fn()
    render(<ReplyComposer {...base} reply="hi" channel="whatsapp" channels={['whatsapp', 'in_app']} onChannelChange={onChannelChange} status="idle" />)
    const group = screen.getByRole('radiogroup', { name: 'Reply channel' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((o) => o.getAttribute('data-channel-option'))).toEqual(['whatsapp', 'in_app'])
    expect(within(group).queryByText('Telegram')).toBeNull()
    expect(options[0]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'whatsapp')
    fireEvent.click(options[1])
    expect(onChannelChange).toHaveBeenCalledWith('in_app')
  })

  it('shows no selector when the thread has a single deliverable channel', () => {
    render(<ReplyComposer {...base} channel="in_app" channels={['in_app']} onChannelChange={() => {}} status="idle" />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByTestId('reply-target')).toHaveAttribute('data-reply-channel', 'in_app')
  })

  it('a thread with no deliverable channel cannot send a customer reply, but can take an internal note', () => {
    const { rerender } = render(<ReplyComposer {...base} reply="hi" channel={null} channels={[]} onChannelChange={() => {}} status="idle" />)
    expect(screen.getByTestId('reply-no-channel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send reply/ })).toBeDisabled()
    rerender(<ReplyComposer {...base} reply="hi" internalNote channel={null} channels={[]} onChannelChange={() => {}} status="idle" />)
    expect(screen.getByRole('button', { name: /Add internal note/ })).toBeEnabled()
  })

  it('hides the channel selector while writing an internal note', () => {
    render(<ReplyComposer {...base} internalNote channel="whatsapp" channels={['whatsapp', 'in_app']} onChannelChange={() => {}} status="idle" />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText(/not sent to the customer/)).toBeInTheDocument()
  })
})

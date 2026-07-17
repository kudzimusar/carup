import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecoveryView } from './RecoveryView'

const noop = () => {}

describe('RecoveryView', () => {
  it('renders each non-empty category with its items and retry affordances', () => {
    const html = renderToStaticMarkup(
      <RecoveryView
        categories={{
          dead_letter: [{ id: 'd1', notification_type: 'admin_reply', channel: 'whatsapp', last_error_code: 'invalid_recipient', last_error_message: 'bad number' }],
          retry_scheduled: [{ id: 'r1', notification_type: 'admin_reply', channel: 'telegram' }],
          queued_too_long: [],
        }}
        counts={{ total: 2, dead_letter: 1, retry_scheduled: 1 }}
        onRetry={noop} onCancel={noop} onRequeue={noop} onBulkRetry={noop}
      />,
    )
    expect(html).toContain('Delivery recovery')
    expect(html).toContain('data-testid="recovery-category-dead_letter"')
    expect(html).toContain('data-testid="recovery-category-retry_scheduled"')
    expect(html).not.toContain('recovery-category-queued_too_long') // empty category omitted
    expect(html).toContain('Admin Reply')
    expect(html).toContain('invalid_recipient')
    expect(html).toContain('data-channel="whatsapp"')
    expect(html).toContain('Requeue')       // dead-letter gets a requeue affordance
  })

  it('shows the empty state and hides the bulk bar with no selection', () => {
    const html = renderToStaticMarkup(
      <RecoveryView categories={{}} counts={{ total: 0 }} onRetry={noop} onCancel={noop} onRequeue={noop} onBulkRetry={noop} />,
    )
    expect(html).toContain('Nothing needs recovery.')
    expect(html).not.toContain('data-testid="recovery-bulk-bar"')
  })
})

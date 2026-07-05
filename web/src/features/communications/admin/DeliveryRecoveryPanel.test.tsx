import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeliveryRecoveryPanel } from './DeliveryRecoveryPanel'

describe('DeliveryRecoveryPanel', () => {
  it('shows an all-clear state when there are no failures', () => {
    const html = renderToStaticMarkup(<DeliveryRecoveryPanel items={[]} onRetry={() => {}} onCancel={() => {}} />)
    expect(html).toContain('No failed deliveries')
  })

  it('lists failed notifications with error context and retry/cancel', () => {
    const html = renderToStaticMarkup(
      <DeliveryRecoveryPanel
        items={[{ id: 'n1', notification_type: 'admin_reply', channel: 'whatsapp', last_error_code: 'invalid_credentials', last_error_message: 'token expired' }]}
        onRetry={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).toContain('Admin Reply')
    expect(html).toContain('whatsapp')
    expect(html).toContain('invalid_credentials')
    expect(html).toContain('token expired')
    expect(html).toContain('Retry')
    expect(html).toContain('Cancel')
  })

  it('caps the list and reports the overflow count', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, notification_type: 'push', last_error_code: 'x' }))
    const html = renderToStaticMarkup(<DeliveryRecoveryPanel items={items} max={5} onRetry={() => {}} onCancel={() => {}} />)
    expect(html).toContain('+3 more failed')
  })
})

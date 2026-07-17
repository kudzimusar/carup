import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeliveryStateBadge } from './DeliveryStateBadge'

describe('DeliveryStateBadge', () => {
  it('renders human labels for delivery states', () => {
    expect(renderToStaticMarkup(<DeliveryStateBadge status="delivered" />)).toContain('Delivered')
    expect(renderToStaticMarkup(<DeliveryStateBadge status="dead_letter" />)).toContain('Dead letter')
    expect(renderToStaticMarkup(<DeliveryStateBadge status="retry_scheduled" />)).toContain('Retry scheduled')
    expect(renderToStaticMarkup(<DeliveryStateBadge status="queued" />)).toContain('Queued')
  })

  it('renders nothing for an empty status', () => {
    expect(renderToStaticMarkup(<DeliveryStateBadge status="" />)).toBe('')
    expect(renderToStaticMarkup(<DeliveryStateBadge status={null} />)).toBe('')
  })

  it('is case-insensitive', () => {
    expect(renderToStaticMarkup(<DeliveryStateBadge status="SENT" />)).toContain('Sent')
  })
})

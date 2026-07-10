import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeliveryAttemptList, type DeliveryAttempt } from './DeliveryAttemptList'

const attempts: DeliveryAttempt[] = [
  {
    id: 'a2', attempt_number: 2, provider: 'twilio', channel: 'whatsapp', status: 'retry_scheduled',
    error_code: 'rate_limited', error_message: 'slow down', started_at: '2026-07-05T10:05:00.000Z',
    next_retry_at: '2026-07-05T10:10:00.000Z',
  },
  {
    id: 'a1', attempt_number: 1, provider: 'twilio', channel: 'whatsapp', status: 'failed',
    error_code: 'invalid_number', error_message: 'not reachable', provider_message_id: 'wamid.XYZ',
    started_at: '2026-07-05T10:00:00.000Z',
  },
]

describe('DeliveryAttemptList', () => {
  it('renders attempts sorted by number with provider, status badges and a visible exact timestamp', () => {
    const html = renderToStaticMarkup(<DeliveryAttemptList attempts={attempts} timeZone="UTC" />)
    expect(html).toContain('Delivery attempts')
    expect(html).toContain('data-testid="delivery-attempt-list"')
    expect(html).toContain('data-testid="delivery-attempt"')
    expect(html).toContain('Attempt 1')
    expect(html).toContain('Attempt 2')
    // Sorted ascending by attempt_number even though input is out of order.
    expect(html.indexOf('Attempt 1')).toBeLessThan(html.indexOf('Attempt 2'))
    expect(html).toContain('Twilio')
    // Exact, visible timestamp (not hover-only) via a <time> element.
    expect(html).toContain('<time')
    expect(html).toContain('2026-07-05T10:00:00.000Z')
    // Failed → destructive badge; retry_scheduled → secondary badge.
    expect(html).toContain('bg-destructive')
    expect(html).toContain('bg-secondary')
    expect(html).toContain('data-attempt-status="failed"')
    // Error context and retry line.
    expect(html).toContain('invalid_number')
    expect(html).toContain('not reachable')
    expect(html).toContain('Retry scheduled')
  })

  it('shows an empty state when there are no attempts', () => {
    const html = renderToStaticMarkup(<DeliveryAttemptList attempts={[]} />)
    expect(html).toContain('No delivery attempts recorded.')
    expect(html).not.toContain('data-testid="delivery-attempt"')
  })

  it('shows the provider message id by default and hides it in compact mode', () => {
    const full = renderToStaticMarkup(<DeliveryAttemptList attempts={attempts} timeZone="UTC" />)
    expect(full).toContain('wamid.XYZ')
    expect(full).toContain('font-mono')

    const compact = renderToStaticMarkup(<DeliveryAttemptList attempts={attempts} timeZone="UTC" compact />)
    expect(compact).not.toContain('wamid.XYZ')
    // Error context is still shown in compact mode.
    expect(compact).toContain('invalid_number')
  })

  it('caps the list at max and reports the overflow count', () => {
    const many: DeliveryAttempt[] = Array.from({ length: 6 }, (_, i) => ({
      id: `x${i}`, attempt_number: i + 1, provider: 'sendgrid', status: 'processing',
      started_at: `2026-07-05T10:0${i}:00.000Z`,
    }))
    const html = renderToStaticMarkup(<DeliveryAttemptList attempts={many} max={4} />)
    expect(html).toContain('+2 more attempts')
  })
})

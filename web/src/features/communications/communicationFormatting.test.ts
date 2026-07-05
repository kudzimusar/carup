import { describe, expect, it } from 'vitest'
import {
  dayGroup, deliveryLabel, deliveryTone, effectiveDeliveryState, formatExactDateTime,
  identityLabel, isValidDate, looksLikeUuid, maskEmail, maskPhone, relativeTime, workflowLabel,
} from './communicationFormatting'

describe('workflow vs delivery separation', () => {
  it('labels workflow states distinctly from delivery states', () => {
    expect(workflowLabel('awaiting_human')).toBe('Needs human')
    expect(workflowLabel('awaiting_user')).toBe('Awaiting customer')
    expect(deliveryLabel('dead_letter')).toBe('Dead letter')
    expect(deliveryLabel('retry_scheduled')).toBe('Retry scheduled')
  })

  it('classifies delivery tone', () => {
    expect(deliveryTone('delivered')).toBe('positive')
    expect(deliveryTone('queued')).toBe('pending')
    expect(deliveryTone('failed')).toBe('negative')
    expect(deliveryTone('retry_scheduled')).toBe('warning')
    expect(deliveryTone('internal_note')).toBe('neutral')
  })

  it('treats a bare DB insert as Queued, never Sent', () => {
    expect(effectiveDeliveryState('', false)).toBe('queued')
    expect(effectiveDeliveryState('pending', false)).toBe('queued')
    expect(effectiveDeliveryState('sent', true)).toBe('sent')
    expect(effectiveDeliveryState('received')).toBe('delivered')
  })
})

describe('identity-first labels', () => {
  it('never surfaces a raw UUID as the label', () => {
    expect(looksLikeUuid('11111111-2222-3333-4444-555555555555')).toBe(true)
    expect(identityLabel({ display_name: '11111111-2222-3333-4444-555555555555', normalized_address: '+818081201356' }))
      .toBe(maskPhone('+818081201356'))
    expect(identityLabel({ id: '11111111-2222-3333-4444-555555555555' })).toBe('Unknown contact')
  })

  it('prefers verified name, then provider name, then handle, then masked address', () => {
    expect(identityLabel({ display_name: 'Aiko Tanaka', verified: true })).toBe('Aiko Tanaka')
    expect(identityLabel({ provider_display_name: 'aiko_t' })).toBe('aiko_t')
    expect(identityLabel({ handle: 'aiko' })).toBe('@aiko')
    expect(identityLabel({ normalized_address: 'buyer@example.com' })).toBe(maskEmail('buyer@example.com'))
  })

  it('masks phones and emails', () => {
    expect(maskPhone('+818081201356')).toMatch(/^\+81•+56$/)
    expect(maskEmail('buyer@example.com')).toBe('b•••@e•••.com')
  })
})

describe('dates never render Invalid Date', () => {
  it('guards invalid input', () => {
    expect(isValidDate('not-a-date')).toBe(false)
    expect(isValidDate('')).toBe(false)
    expect(isValidDate(null)).toBe(false)
    expect(formatExactDateTime('not-a-date').valid).toBe(false)
    expect(formatExactDateTime('not-a-date').absolute).toBe('—')
    expect(relativeTime('garbage')).toBe('')
    expect(dayGroup('garbage')).toBe('')
  })

  it('formats a valid timestamp in a given timezone without Invalid Date', () => {
    const out = formatExactDateTime('2026-07-05T00:00:00.000Z', { timeZone: 'Asia/Tokyo' })
    expect(out.valid).toBe(true)
    expect(out.iso).toBe('2026-07-05T00:00:00.000Z')
    expect(out.absolute).not.toMatch(/Invalid/)
    expect(out.absolute.length).toBeGreaterThan(0)
  })

  it('falls back gracefully for an invalid timezone', () => {
    const out = formatExactDateTime('2026-07-05T00:00:00.000Z', { timeZone: 'Not/AZone' })
    expect(out.valid).toBe(true)
    expect(out.absolute).not.toMatch(/Invalid/)
  })

  it('groups Today and Yesterday relative to now', () => {
    const now = new Date('2026-07-05T12:00:00.000Z').getTime()
    expect(dayGroup('2026-07-05T09:00:00.000Z', { timeZone: 'UTC', now })).toBe('Today')
    expect(dayGroup('2026-07-04T09:00:00.000Z', { timeZone: 'UTC', now })).toBe('Yesterday')
    expect(dayGroup('2026-06-01T09:00:00.000Z', { timeZone: 'UTC', now })).not.toBe('Today')
  })

  it('computes relative time', () => {
    const now = new Date('2026-07-05T12:00:00.000Z').getTime()
    expect(relativeTime('2026-07-05T11:59:30.000Z', now)).toBe('just now')
    expect(relativeTime('2026-07-05T11:30:00.000Z', now)).toBe('30m ago')
    expect(relativeTime('2026-07-05T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTime('2026-07-03T12:00:00.000Z', now)).toBe('2d ago')
  })
})

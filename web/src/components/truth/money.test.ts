import { describe, expect, it } from 'vitest'
import { formatMoney, normalizeCurrency } from './money'

describe('formatMoney (MoneyDisplay authority)', () => {
  it('renders USD with the $ glyph', () => {
    expect(formatMoney(12500, 'USD')).toEqual({ kind: 'value', text: '$12,500', currency: 'USD' })
  })

  it('NEVER renders ZiG as "$"', () => {
    const result = formatMoney(9800, 'ZiG')
    expect(result).toEqual({ kind: 'value', text: 'ZiG 9,800', currency: 'ZiG' })
    if (result.kind === 'value') expect(result.text).not.toContain('$')
  })

  it('accepts the ISO 4217 code ZWG for Zimbabwe Gold', () => {
    expect(formatMoney(100, 'ZWG')).toEqual({ kind: 'value', text: 'ZiG 100', currency: 'ZiG' })
  })

  it('renders ZAR and BWP with explicit codes', () => {
    expect(formatMoney(45000, 'ZAR')).toEqual({ kind: 'value', text: 'ZAR 45,000', currency: 'ZAR' })
    expect(formatMoney(6000, 'BWP')).toEqual({ kind: 'value', text: 'BWP 6,000', currency: 'BWP' })
  })

  it('groups thousands and keeps decimals to 2 places', () => {
    expect(formatMoney(1234567.891, 'USD')).toEqual({ kind: 'value', text: '$1,234,567.89', currency: 'USD' })
  })

  it.each([
    ['null amount', null, 'USD'],
    ['undefined amount', undefined, 'USD'],
    ['NaN amount', NaN, 'USD'],
    ['Infinity amount', Infinity, 'USD'],
    ['unknown currency', 100, 'EUR'],
    ['missing currency', 100, null],
  ])('missing state for %s — never a fabricated figure', (_name, amount, currency) => {
    expect(formatMoney(amount, currency)).toEqual({ kind: 'missing' })
  })

  it('normalizeCurrency rejects non-strings and unknown codes', () => {
    expect(normalizeCurrency(42)).toBeNull()
    expect(normalizeCurrency('')).toBeNull()
    expect(normalizeCurrency('JPY')).toBeNull()
    expect(normalizeCurrency(' zig ')).toBe('ZiG')
    expect(normalizeCurrency('usd')).toBe('USD')
  })
})

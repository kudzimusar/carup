import { describe, expect, it } from 'vitest'
import { formatMoney, normalizeCurrency } from './money'

describe('formatMoney (MoneyDisplay authority)', () => {
  it('renders USD with the $ glyph AND a visible USD code (amountText carries only the figure)', () => {
    expect(formatMoney(12500, 'USD')).toEqual({ kind: 'value', amountText: '$12,500', currency: 'USD' })
  })

  it('NEVER renders ZiG as "$"', () => {
    const result = formatMoney(9800, 'ZiG')
    expect(result).toEqual({ kind: 'value', amountText: '9,800', currency: 'ZiG' })
    if (result.kind === 'value') expect(result.amountText).not.toContain('$')
  })

  it('accepts the ISO 4217 code ZWG for Zimbabwe Gold', () => {
    expect(formatMoney(100, 'ZWG')).toEqual({ kind: 'value', amountText: '100', currency: 'ZiG' })
  })

  it('renders ZAR and BWP with their explicit codes', () => {
    expect(formatMoney(45000, 'ZAR')).toEqual({ kind: 'value', amountText: '45,000', currency: 'ZAR' })
    expect(formatMoney(6000, 'BWP')).toEqual({ kind: 'value', amountText: '6,000', currency: 'BWP' })
  })

  it('groups thousands and keeps decimals to 2 places', () => {
    expect(formatMoney(1234567.891, 'USD')).toEqual({ kind: 'value', amountText: '$1,234,567.89', currency: 'USD' })
  })

  it.each([
    ['null amount', null, 'USD'],
    ['undefined amount', undefined, 'USD'],
    ['NaN amount', NaN, 'USD'],
    ['Infinity amount', Infinity, 'USD'],
    ['-Infinity amount', -Infinity, 'USD'],
  ])('missing state for %s — never a fabricated figure', (_name, amount, currency) => {
    expect(formatMoney(amount, currency)).toEqual({ kind: 'missing' })
  })

  it.each([
    ['unknown currency code', 100, 'EUR'],
    ['null currency', 100, null],
    ['undefined currency', 100, undefined],
    ['non-string currency', 100, 42],
  ])('unsupported-currency state for %s — amount preserved, differentiated from missing', (_name, amount, currency) => {
    const result = formatMoney(amount, currency)
    expect(result).toEqual({ kind: 'unsupported-currency', amountText: '100' })
  })

  it('an absent amount and an unsupported currency are DIFFERENT states — never conflated', () => {
    expect(formatMoney(null, 'EUR')).toEqual({ kind: 'missing' })
    expect(formatMoney(500, 'EUR')).toEqual({ kind: 'unsupported-currency', amountText: '500' })
    // The amount IS present in the unsupported-currency case; it must not be reported as absent.
    expect(formatMoney(500, 'EUR')).not.toEqual({ kind: 'missing' })
  })

  it('normalizeCurrency rejects non-strings and unknown codes', () => {
    expect(normalizeCurrency(42)).toBeNull()
    expect(normalizeCurrency('')).toBeNull()
    expect(normalizeCurrency('JPY')).toBeNull()
    expect(normalizeCurrency(' zig ')).toBe('ZiG')
    expect(normalizeCurrency('usd')).toBe('USD')
  })
})

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
    ['EUR', 'EUR'],
    ['eur (case-insensitive)', 'eur'],
    ['JPY', 'JPY'],
  ])('recorded-but-unsupported currency %s — amount preserved with the verbatim code', (_name, raw) => {
    expect(formatMoney(100, raw)).toEqual({ kind: 'unsupported-currency', amountText: '100', code: raw.trim().toUpperCase() })
  })

  it.each([
    ['null currency', null],
    ['undefined currency', undefined],
    ['blank currency', ''],
    ['whitespace currency', '   '],
    ['non-string currency', 42],
  ])('unrecorded currency (%s) with a finite amount — amount preserved, currency "not recorded"', (_name, currency) => {
    expect(formatMoney(100, currency)).toEqual({ kind: 'currency-not-recorded', amountText: '100' })
  })

  it('currency provenance is three-way distinct — supported / recorded-unsupported / unrecorded / missing — never conflated', () => {
    expect(formatMoney(500, 'USD')).toEqual({ kind: 'value', amountText: '$500', currency: 'USD' })
    expect(formatMoney(500, 'EUR')).toEqual({ kind: 'unsupported-currency', amountText: '500', code: 'EUR' })
    expect(formatMoney(500, null)).toEqual({ kind: 'currency-not-recorded', amountText: '500' })
    expect(formatMoney(null, 'EUR')).toEqual({ kind: 'missing' })
    expect(formatMoney(500, 'EUR')).not.toEqual({ kind: 'missing' })
    expect(formatMoney(500, 'EUR')).not.toEqual({ kind: 'currency-not-recorded', amountText: '500' })
  })

  it('no conversion or invented value: an unsupported currency never produces a converted figure', () => {
    const result = formatMoney(500, 'EUR')
    // Only the recorded amount may appear; no FX-derived figure is invented.
    if (result.kind === 'unsupported-currency') {
      expect(result.amountText).toBe('500')
      expect(result.code).toBe('EUR')
    }
  })

  it('normalizeCurrency rejects non-strings and unknown codes', () => {
    expect(normalizeCurrency(42)).toBeNull()
    expect(normalizeCurrency('')).toBeNull()
    expect(normalizeCurrency('JPY')).toBeNull()
    expect(normalizeCurrency(' zig ')).toBe('ZiG')
    expect(normalizeCurrency('usd')).toBe('USD')
  })
})

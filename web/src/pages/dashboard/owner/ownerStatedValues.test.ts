import { describe, expect, it } from 'vitest'
import { statedPrice, statedVehiclePrice } from './ownerStatedValues'

/**
 * T11-CAP-LR01-R2 — a vehicle record's `price` is NOT NULL, so 0 is how a record that was never priced says so. It is a placeholder, never a
 * purchase price: "$0" on a car someone imported is a fact CarUp does not hold.
 */
describe('statedVehiclePrice', () => {
  it('names an unpriced vehicle record instead of printing it as $0', () => {
    for (const currency of [null, undefined, '', '   ']) {
      expect(statedVehiclePrice(0, currency)).toBe('Price not recorded')
    }
    expect(statedVehiclePrice(0)).toBe('Price not recorded')
  })

  it('names an absent or non-numeric price', () => {
    for (const amount of [null, undefined, NaN, Infinity, '12500', {}]) {
      expect(statedVehiclePrice(amount, 'USD')).toBe('Price not recorded')
    }
  })

  it('still prints a recorded price exactly as before, with or without a stated currency', () => {
    expect(statedVehiclePrice(12500, 'USD')).toBe(statedPrice(12500))
    expect(statedVehiclePrice(12500, null)).toBe('$12,500')
    expect(statedVehiclePrice(12500)).toBe('$12,500')
  })

  it('a zero beside a STATED currency is a stated value and prints; the listing rule is unchanged', () => {
    expect(statedVehiclePrice(0, 'USD')).toBe('$0')
    expect(statedPrice(0)).toBe('$0')
    expect(statedPrice(undefined)).toBe('Price not recorded')
  })
})

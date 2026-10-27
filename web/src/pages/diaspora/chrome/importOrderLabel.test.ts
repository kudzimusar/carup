import { describe, it, expect } from 'vitest'
import { PENDING_ORDER_LABEL, importOrderLabel, settledOrderLabel } from './importOrderLabel'

const ID = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'

describe('importOrderLabel — an order is called by what the viewer may know, never by a UUID', () => {
  it('prefers the vehicle the order carries (named only to its owner)', () => {
    expect(importOrderLabel({ id: ID, linked_vehicle: { title: '2018 Honda Vezel' }, requested_make: 'Toyota', requested_model: 'Hilux' })).toBe('2018 Honda Vezel')
  })

  it('falls back to what the buyer asked for', () => {
    expect(importOrderLabel({ id: ID, requested_make: 'Toyota', requested_model: 'Hilux' })).toBe('Toyota Hilux')
    expect(importOrderLabel({ id: ID, requested_make: 'Toyota', requested_model: null })).toBe('Toyota')
    expect(importOrderLabel({ id: ID, requested_make: null, requested_model: 'Hilux' })).toBe('Hilux')
  })

  it('then to a short reference — not "Vehicle request", not "Import <uuid>"', () => {
    expect(importOrderLabel({ id: ID })).toBe('Import order 3E2B66A0')
    expect(importOrderLabel({ id: ID, linked_vehicle: null, requested_make: '  ', requested_model: '' })).toBe('Import order 3E2B66A0')
  })

  it('never prints the whole id', () => {
    expect(importOrderLabel({ id: ID })).not.toContain(ID)
    expect(importOrderLabel({ id: ID })).not.toContain('507f88016f71')
  })

  it('treats a vehicle with no title as no vehicle (the next-most-specific name wins)', () => {
    expect(importOrderLabel({ id: ID, linked_vehicle: { title: null }, requested_make: 'Honda' })).toBe('Honda')
    expect(importOrderLabel({ id: ID, linked_vehicle: { title: '   ' } })).toBe('Import order 3E2B66A0')
  })
})

describe('settledOrderLabel — an order still being read is called what it is, never by its reference', () => {
  it('pending: "Import order", with no reference in it, whatever the caller already holds', () => {
    expect(PENDING_ORDER_LABEL).toBe('Import order')
    expect(settledOrderLabel({ id: ID }, false)).toBe('Import order')
    expect(settledOrderLabel({ id: ID, requested_make: 'Toyota' }, false)).toBe('Import order')
    expect(settledOrderLabel({ id: ID }, false)).not.toMatch(/3E2B66A0/i)
  })

  it('answered: exactly what importOrderLabel says — the vehicle, the request, then the short reference', () => {
    expect(settledOrderLabel({ id: ID, linked_vehicle: { title: '2018 Honda Vezel' } }, true)).toBe('2018 Honda Vezel')
    expect(settledOrderLabel({ id: ID, requested_make: 'Toyota', requested_model: 'Hilux' }, true)).toBe('Toyota Hilux')
    expect(settledOrderLabel({ id: ID }, true)).toBe('Import order 3E2B66A0')
  })
})

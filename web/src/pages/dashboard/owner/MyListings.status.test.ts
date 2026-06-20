import { describe, expect, it } from 'vitest'
import {
  applyPersistedListingStatus,
  formatListingStatus,
  isSoldListingStatus,
  normalizeListingStatus,
} from './MyListings'
import type { Vehicle } from '@/types'

const listings: Vehicle[] = [
  { vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Corolla', year: 2018, status: 'Available' } as Vehicle,
  { vin: 'WBA8E9C50HK000732', make: 'BMW', model: '320i', year: 2020, status: 'Available' } as Vehicle,
]

describe('MyListings sold status handling', () => {
  it('normalizes backend status "Sold" for sold comparisons', () => {
    expect(normalizeListingStatus('Sold')).toBe('sold')
    expect(isSoldListingStatus('Sold')).toBe(true)
    expect(formatListingStatus('Sold')).toBe('Sold')
  })

  it('also treats backend status "sold" as sold', () => {
    expect(normalizeListingStatus('sold')).toBe('sold')
    expect(isSoldListingStatus('sold')).toBe(true)
    expect(formatListingStatus('sold')).toBe('Sold')
  })

  it('applies only the persisted status returned by the existing status API', () => {
    const next = applyPersistedListingStatus(listings, 'JTDKARFP0H3000731', 'Sold')
    expect(next[0].status).toBe('Sold')
    expect(next[1].status).toBe('Available')
    expect(isSoldListingStatus(next[0].status)).toBe(true)
  })
})

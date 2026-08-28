import { describe, expect, it } from 'vitest'
import {
  canRenderMarketplacePrimaryImage,
  isAdversePlateStatus,
  plateStatusLabel,
  primaryImageForListing,
} from './marketplacePresentation'

describe('marketplace buyer presentation guards', () => {
  it('fails closed when a URL disagrees with the canonical primary-image state', () => {
    expect(primaryImageForListing({ primary_image_state: 'none', primary_image_url: 'https://cdn.test/leak.jpg' })).toBeNull()
    expect(primaryImageForListing({ primary_image_state: 'not_loaded', primary_image_url: '/stale.jpg' })).toBeNull()
    expect(primaryImageForListing({ primary_image_state: 'seller_primary', primary_image_url: '/good.jpg' })).toBe('/good.jpg')
    expect(canRenderMarketplacePrimaryImage('first_published', 'https://cdn.test/good.jpg')).toBe(true)
  })

  it('gives adverse plate lifecycle state priority over a positive verification boolean', () => {
    expect(isAdversePlateStatus('Flagged')).toBe(true)
    expect(isAdversePlateStatus('Suspended')).toBe(true)
    expect(plateStatusLabel({ plate_status: 'Flagged', plate_verified: true })).toBe('Plate flagged')
    expect(plateStatusLabel({ plate_status: 'Suspended', plate_verified: true })).toBe('Plate suspended')
    expect(plateStatusLabel({ plate_status: 'Active', plate_verified: true })).toBe('Plate confirmed')
    expect(plateStatusLabel({ plate_status: 'Active', plate_verified: false })).toBe('Plate active')
  })
})

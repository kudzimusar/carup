import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, 'OwnerDashboard.tsx'), 'utf8')

describe('Seller master Phase O — Owner Dashboard convergence', () => {
  it('orders the dashboard around the seven documented owner/Seller priorities', () => {
    for (const id of [
      'owner-priority-attention',
      'owner-priority-vehicles',
      'owner-priority-buyer-activity',
      'owner-priority-trust',
      'owner-priority-operating-records',
      'owner-priority-communications',
      'owner-priority-intelligence',
    ]) expect(source).toContain(id)

    for (const label of [
      'Priority 1',
      'Priority 2',
      'Priority 3',
      'Priority 4',
      'Priority 5',
      'Priority 6',
      'Priority 7',
    ]) expect(source).toContain(label)
  })

  it('gives an existing draft a direct Continue listing route', () => {
    expect(source).toContain('draftSellerVehicle')
    expect(source).toContain('Continue listing')
    expect(source).toContain('/dashboard/sell-vehicle?vin=')
  })

  it('uses governed media and canonical Trust rather than decorative substitutes', () => {
    expect(source).toContain('primaryListingImageUrl(vehicle.listing_media)')
    expect(source).toContain('readOwnerTrustClaim(vehicle)')
    expect(source).not.toContain('images.unsplash.com')
    expect(source).not.toMatch(/trust_score\s*(?:\|\||\?\?)\s*0/)
  })

  it('removes legacy trend/widget prominence and demotes unsupported capabilities', () => {
    expect(source).not.toContain('<NextBestActions')
    expect(source).not.toContain('<PeriodicReport')
    expect(source).toContain('owner-unavailable-capabilities')
    expect(source).toContain('value-trend-unavailable')
    expect(source).toContain('Not available')
  })

  it('keeps Gutu AI secondary to the governed Seller Intelligence workspace', () => {
    expect(source).toContain('/dashboard/intelligence')
    expect(source).toContain('Seller Intelligence')
    expect(source).toContain('Gutu AI vehicle assistant')
    expect(source).not.toContain('Ask Gutu AI')
  })
})

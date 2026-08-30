import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const garage = readFileSync(resolve(here, 'MyGarage.tsx'), 'utf8')
const listings = readFileSync(resolve(here, 'MyListings.tsx'), 'utf8')
const studio = readFileSync(resolve(here, 'SellVehicle.tsx'), 'utf8')

describe('Seller master phases H-I-J — workspace convergence contract', () => {
  it('H: My Garage is a vehicle-story workspace with one contextual commerce CTA', () => {
    expect(garage).toContain('Vehicle workspace')
    expect(garage).toContain('relationshipLabel')
    expect(garage).toContain('publicationLabel')
    expect(garage).toContain('readOwnerTrustClaim')
    expect(garage).toContain('verified_documents')
    expect(garage).toContain('active_insurance')
    expect(garage).toContain('parts')
    expect(garage).toContain('Continue listing')
    expect(garage).toContain('Manage listing')
    expect(garage).toContain('Sell this vehicle')
    expect(garage).toContain('View Vehicle Passport')
    expect(garage).not.toContain('rounded-xl p-8 flex flex-col items-center justify-center')
  })

  it('I: My Listings has governed KPIs, one dominant action and secondary lifecycle controls', () => {
    expect(listings).toContain('seller-listing-kpis')
    expect(listings).toContain('publishedCount')
    expect(listings).toContain('draftsNeedingAction')
    expect(listings).toContain('Tracked views')
    expect(listings).toContain('Tracked saves')
    expect(listings).toContain('Mixed / incomplete')
    expect(listings).toContain('listing-primary-')
    expect(listings).toContain('Buyer Preview')
    expect(listings).toContain('Publication readiness')
    expect(listings).toContain('View on Marketplace')
    expect(listings).toContain('Change price')
    expect(listings).toContain('Unpublish')
    expect(listings).toContain('Mark sold')
  })

  it('J: Seller Studio separates Passport facts from editable Seller assertions', () => {
    expect(studio).toContain('seller-studio-stage-hero')
    expect(studio).toContain('Stage {step + 1} of {STEPS.length}')
    expect(studio).toContain('seller-canonical-fields-locked')
    expect(studio).toContain('Existing Seller listing loaded.')
    expect(studio).toContain('seller-server-autosave-state')
    expect(studio).toContain('Media readiness')
    expect(studio).toContain('Seller copy')
    expect(studio).toContain('Canonical Trust')
    expect(studio).toContain('Location:')
    expect(studio).toContain('Seller identity:')
    expect(studio).toContain('seller-studio-publication-readiness')
    expect(studio).toContain('Buyer Preview — not public')
    expect(studio).toContain('requestedStage')
  })
})

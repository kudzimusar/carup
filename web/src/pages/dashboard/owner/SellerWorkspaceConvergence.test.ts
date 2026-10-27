import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const garage = readFileSync(resolve(here, 'MyGarage.tsx'), 'utf8')
const listings = readFileSync(resolve(here, 'MyListings.tsx'), 'utf8')
const studio = readFileSync(resolve(here, 'SellVehicle.tsx'), 'utf8')
const capabilityPresentation = readFileSync(resolve(here, '../../../components/workspace/capabilityPresentation.ts'), 'utf8')

describe('Seller master phases H-I-J — workspace convergence contract', () => {
  it('H: My Garage is a vehicle-story workspace with one contextual commerce CTA', () => {
    // R3 (Moderator D-4): the workspace is named "My Vehicles"; the page title stays "My Garage".
    expect(garage).toContain('eyebrow="My Vehicles"')
    expect(garage).toContain('workspace="vehicles"')
    expect(garage).not.toContain('Vehicle workspace')
    expect(garage).toContain('relationshipLabel')
    expect(garage).toContain('readOwnerTrustClaim')
    expect(garage).toContain('verified_documents')
    expect(garage).toContain('active_insurance')
    expect(garage).toContain('parts')
    expect(garage).toContain('View Vehicle Passport')
    // R3: the commerce words (Continue listing / Manage listing / Sell this vehicle) now live in ONE shared description that the Garage and the
    // Vehicle Passport both read, so the two can never word or route one vehicle differently. The Garage's private heuristic is gone.
    expect(garage).toContain('describeMarketplaceCapability')
    expect(garage).toContain('describeTradeImportCapability')
    expect(garage).not.toContain('contextualAction')
    expect(garage).not.toContain('publicationLabel')
    for (const words of ['Continue listing', 'Manage listing', 'Sell this vehicle']) {
      expect(capabilityPresentation).toContain(words)
      expect(garage).not.toContain(`'${words}'`)
    }
    expect(garage).not.toContain('rounded-xl p-8 flex flex-col items-center justify-center')
  })

  it('R3: the three Seller pages name their workspace and use no Seller-only parent label', () => {
    expect(listings).toContain('workspace="marketplace"')
    expect(listings).toContain('eyebrow="Marketplace"')
    expect(listings).not.toContain('Commerce workspace')
    expect(studio).toContain('workspace="marketplace"')
    for (const source of [garage, listings, studio]) {
      expect(source).not.toContain('Seller / Owner home')
    }
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

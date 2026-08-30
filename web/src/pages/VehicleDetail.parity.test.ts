import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const detail = readFileSync(resolve(here, 'VehicleDetail.tsx'), 'utf8')
const trustSummary = readFileSync(resolve(here, '../components/marketplace/TrustSummaryPanel.tsx'), 'utf8')
const allInPrice = readFileSync(resolve(here, '../components/marketplace/AllInPricePanel.tsx'), 'utf8')
const sourceCoverage = readFileSync(resolve(here, '../components/SourceCoveragePanel.tsx'), 'utf8')
const studio = readFileSync(resolve(here, 'dashboard/owner/SellVehicle.tsx'), 'utf8')

describe('Seller master Phase L/M — shared detail parity and semantic separation', () => {
  it('keeps Seller-created and reference vehicles on one VehicleDetail architecture', () => {
    expect(detail).toContain("presentationMode === 'seller_preview'")
    expect(detail).toContain(": 'marketplace_public'")
    expect(detail).not.toContain("mockVehicles")
    expect(detail).not.toMatch(/referenceVehicle|goldenVehicle|seededVehicle/)
  })

  it('keeps the rich buyer information architecture available without copied fixture data', () => {
    expect(detail).toContain('data-testid="listing-media-block"')
    expect(detail).toContain('governedPrice(vehicle.price, vehicle.currency)')
    expect(detail).toContain('<SourceCoveragePanel')
    expect(detail).toContain('<AllInPricePanel')
    expect(detail).toContain('data-testid="verified-evidence-block"')
    expect(detail).toContain('data-testid="seller-description"')
    expect(detail).toContain('data-testid="history-timeline"')
    expect(detail).toContain('ownershipSummary')
    expect(detail).toContain('Service Records')
    expect(detail).toContain('insurance and service records')
    expect(trustSummary).toContain('PartSentry')
    expect(trustSummary).toContain('data-testid="marketplace-partsentry-status"')
    expect(allInPrice).toContain('All-in cost estimate')
  })

  it('keeps buyer actions on the same public detail and disables them only in Seller Preview', () => {
    expect(detail).toContain('aria-label="Save this vehicle"')
    expect(detail).toContain('data-testid="vehicle-detail-compare"')
    expect(detail).toContain('data-testid="vehicle-detail-share"')
    expect(detail).toContain('data-testid="marketplace-inquiry-open"')
    expect(detail).toContain('Request reservation')
    expect(detail).toContain('SafePay opens only after CarUp verifies transaction eligibility')
    expect(detail).toContain('detail && !isSellerPreview')
    expect(detail).toContain('data-testid="seller-preview-transactions-disabled"')
  })

  it('keeps missing states as explicit states instead of structural collapse or invented values', () => {
    for (const copy of [
      'Not recorded',
      'not evaluated',
      'Marketplace actions unavailable',
      'Vehicle lifecycle was not loaded',
      'History report unavailable',
    ]) {
      expect(detail.toLowerCase()).toContain(copy.toLowerCase())
    }
    expect(sourceCoverage).toContain("pending")
    expect(sourceCoverage).toContain('Not connected')
  })

  it('separates canonical Trust from publication readiness and listing completeness', () => {
    expect(studio).toContain('Governed publication readiness')
    expect(studio).toContain('Canonical Trust is measured separately')
    expect(studio).toContain('Neither block above is a Trust score')
    expect(studio).toContain('VehicleCompletenessPanel')
    expect(detail).toContain('readPublicTrust')
    expect(detail).not.toContain('completeness_percent} / 100')
  })

  it('keeps seller statements visibly distinct from governed facts', () => {
    expect(detail).toContain('Condition (seller-stated)')
    expect(detail).toContain('Features stated by the seller')
    expect(detail).toContain('Photos supplied by the seller to advertise this vehicle')
    expect(detail).toContain('Governed artifacts CarUp has reviewed')
  })

  it('keeps privacy a governed projection rather than a Seller Preview-only convention', () => {
    expect(detail).toContain('identifiersRedacted')
    expect(detail).toContain('Not shown publicly')
    expect(detail).toContain('The seller has not published a direct number')
    expect(studio).toContain("locationVisibility: 'withheld'")
    expect(studio).toContain('publicSellerDisplay: false')
    expect(studio).toContain("value=\"province_only\"")
  })
})

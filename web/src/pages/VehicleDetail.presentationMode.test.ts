import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const detail = readFileSync(resolve(here, 'VehicleDetail.tsx'), 'utf8')
const sell = readFileSync(resolve(here, 'dashboard/owner/SellVehicle.tsx'), 'utf8')
const listings = readFileSync(resolve(here, 'dashboard/owner/MyListings.tsx'), 'utf8')
const hook = readFileSync(resolve(here, '../hooks/useCarUpApi.ts'), 'utf8')
const route = readFileSync(resolve(here, '../../../backend/routes/marketplaceRoutes.js'), 'utf8')

describe('Seller Phase K — one buyer presentation, two governed modes', () => {
  it('routes Seller preview into the same VehicleDetail architecture', () => {
    expect(sell).toContain('?mode=seller_preview')
    expect(listings).toContain('?mode=seller_preview')
    expect(detail).toContain("? 'seller_preview'")
    expect(detail).toContain(": 'marketplace_public'")
    expect(detail).toContain('data-testid="seller-preview-banner"')
  })

  it('requires a real Seller scope for preview and a real public detail for Marketplace mode', () => {
    expect(detail).toContain('fetchOwnedVehicles()')
    expect(detail).toContain("sellerPreviewAuthorization !== 'allowed'")
    expect(detail).toContain('data-testid="marketplace-actions-unavailable"')
    expect(detail).not.toContain('data-testid="marketplace-listing-unavailable"')
  })

  it('keeps buyer transactions out of Seller Preview', () => {
    expect(detail).toContain('detail && !isSellerPreview')
    expect(detail).toContain('data-testid="seller-preview-transactions-disabled"')
    expect(detail).toContain('data-testid="seller-preview-sidebar-disabled"')
    expect(detail).toContain('{!isSellerPreview && (')
  })

  it('does not turn Seller Preview into a buyer-view analytics event', () => {
    expect(hook).toContain("presentation_mode?: 'seller_preview'")
    expect(route).toContain("req.query?.presentation_mode !== 'seller_preview'")
    expect(route).toContain('emitListingOpened')
  })

  it('preserves Seller-authored media label/order metadata in the shared gallery', () => {
    expect(detail).toContain('seller_order: number | null')
    expect(detail).toContain('photo_label: string | null')
    expect(detail).toContain('toSellerOrder(entry.seller_order)')
    expect(detail).toContain('toPhotoLabel(entry.photo_label)')
    expect(detail).toContain('data-testid="listing-media-photo-label"')
  })
})

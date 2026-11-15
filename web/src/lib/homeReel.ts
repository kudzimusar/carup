import type { ReelFrame } from '@/components/showroom/heroMode'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'
import { summaryLocationLine } from '@/lib/governedLocation'
import type { MarketplaceListingSummary } from '@/types'

function vehicleTitle(vehicle: MarketplaceListingSummary) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Marketplace vehicle'
}

/** Live photos for the reel: renderable seller media only, one per body style first for variety. */
export function reelFramesFrom(listings: MarketplaceListingSummary[]): ReelFrame[] {
  const withMedia = listings.filter(listing =>
    canRenderMarketplacePrimaryImage(listing.primary_image_state, listing.primary_image_url))
  const seen = new Set<string>()
  const varied: MarketplaceListingSummary[] = []
  const rest: MarketplaceListingSummary[] = []
  for (const listing of withMedia) {
    const key = (listing.body_style || listing.make || '').toLowerCase()
    if (key && !seen.has(key)) {
      seen.add(key)
      varied.push(listing)
    } else {
      rest.push(listing)
    }
  }
  return [...varied, ...rest].slice(0, 5).map(listing => ({
    id: listing.vin,
    src: (listing.primary_image_url as string).trim(),
    title: vehicleTitle(listing),
    subtitle: summaryLocationLine(listing.location, listing.location_state).label,
    badge: listing.primary_image_url?.includes('/marketplace-reference-synthetic/') ? 'Demo media' : undefined,
    href: `/marketplace/${encodeURIComponent(listing.vin)}`,
  }))
}

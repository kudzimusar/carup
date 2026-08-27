import { summaryLocationLine } from '@/lib/governedLocation'
import type { MarketplaceListingCardModel } from '@/components/marketplace/MarketplaceListingCard'
import type { MarketplaceListingSummary } from '@/types'

function titleCase(value: string | null | undefined) {
  if (!value) return null
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function sellerLabel(listing: MarketplaceListingSummary) {
  if (listing.seller_public_profile_enabled !== true) return 'Seller identity not published'
  const label = String(listing.seller_display_label || '').trim()
  return label || 'Seller name not recorded'
}

function plateStatusLabel(listing: MarketplaceListingSummary) {
  if (listing.plate_status) return `Plate ${String(listing.plate_status).toLowerCase()}`
  if (listing.plate_verified) return 'Plate confirmed'
  return 'Plate status not recorded'
}

export function marketplaceListingToCardModel(
  listing: MarketplaceListingSummary,
): MarketplaceListingCardModel {
  const labels = [
    titleCase(listing.condition_category),
    ...(listing.marketplace_tags || []).map(tag => titleCase(tag)),
  ].filter((value): value is string => Boolean(value))

  return {
    vin: listing.vin,
    name: [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'Vehicle',
    price: typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null,
    currency: typeof listing.currency === 'string' && listing.currency.trim() ? listing.currency : null,
    primaryImage: listing.primary_image_url || null,
    primaryImageState: listing.primary_image_state,
    mileage: typeof listing.mileage === 'number' && Number.isFinite(listing.mileage) ? listing.mileage : null,
    transmission: listing.transmission || null,
    fuel: listing.fuel_type || null,
    sellerLabel: sellerLabel(listing),
    locationLabel: summaryLocationLine(listing.location, listing.location_state).label,
    plateStatus: plateStatusLabel(listing),
    plateVerified: listing.plate_verified === true
      && !['flagged', 'suspended'].includes(String(listing.plate_status || '').toLowerCase()),
    reserved: listing.reservation_summary?.reserved === true,
    partSentryChecked: listing.partsentry_checked === true,
    labels: labels.length ? labels : ['Published listing'],
    trust: listing.trust || null,
    carupGold: listing.carup_gold?.state === 'qualified',
    syntheticDemo: Boolean(listing.primary_image_url?.includes('/marketplace-reference-synthetic/')),
  }
}

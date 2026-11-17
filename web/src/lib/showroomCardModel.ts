/**
 * RX04 — one mapping from a public Marketplace listing to the approved showroom listing card.
 *
 * Identical rules to the card mapping inside pages/showroom/ShowroomMarketplace.tsx (RX-03, left
 * untouched): the same condition labels, the same "Seller not disclosed" fallback, primary image only
 * when the media state allows it, a plate shown as verified only when the plate is verified AND the
 * plate status is not adverse, currency null when not recorded (never assumed), mileage null when not
 * a finite number. RX-04 pages (search, saved cars) reuse it so every public car looks and reads the
 * same wherever it appears.
 */
import type { ShowroomListingCardModel } from '@/components/showroom/ShowroomListingCard'
import { summaryLocationLine } from '@/lib/governedLocation'
import { isAdversePlateStatus, plateStatusLabel, primaryImageForListing } from '@/lib/marketplacePresentation'
import type { MarketplaceListingSummary } from '@/types'

const CONDITION_LABELS: Record<string, string> = {
  brand_new: 'Brand New',
  recently_imported: 'Recently Imported',
  locally_used: 'Locally Used',
  second_hand: 'Second Hand',
  certified_dealer: 'Certified Pre-Owned',
}

function humanizeTag(tag: string) {
  return tag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function showroomListingLabels(listing: MarketplaceListingSummary): string[] {
  const labels = new Set<string>()
  const condition = CONDITION_LABELS[listing.condition_category]
  if (condition) labels.add(condition)
  for (const tag of listing.marketplace_tags || []) labels.add(humanizeTag(tag))
  return Array.from(labels)
}

export function listingToShowroomCardModel(listing: MarketplaceListingSummary): ShowroomListingCardModel {
  const name = [listing.year, listing.make, listing.model].filter(value => value !== null && value !== undefined && value !== '').join(' ')
  const labels = showroomListingLabels(listing)
  return {
    vin: listing.vin,
    name: name || `${listing.make ?? ''} ${listing.model ?? ''}`.trim(),
    price: typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null,
    currency: typeof listing.currency === 'string' && listing.currency.trim() ? listing.currency : null,
    primaryImage: primaryImageForListing(listing),
    primaryImageState: listing.primary_image_state,
    mileage: typeof listing.mileage === 'number' && Number.isFinite(listing.mileage) ? listing.mileage : null,
    transmission: listing.transmission || null,
    fuel: listing.fuel_type || null,
    sellerLabel: listing.seller_display_label?.trim() || 'Seller not disclosed',
    locationLabel: summaryLocationLine(listing.location, listing.location_state).label,
    plateStatus: plateStatusLabel(listing),
    plateVerified: listing.plate_verified === true && !isAdversePlateStatus(listing.plate_status),
    reserved: listing.reservation_summary?.reserved === true,
    partSentryChecked: listing.partsentry_checked,
    labels: labels.length > 0 ? labels : ['Published listing'],
    trust: listing.trust || null,
    carupGold: listing.carup_gold?.state === 'qualified',
    syntheticDemo: Boolean(listing.primary_image_url?.includes('/marketplace-reference-synthetic/')),
    bodyStyle: typeof listing.body_style === 'string' && listing.body_style.trim() ? listing.body_style.trim() : null,
  }
}

/**
 * Seller Journey 1.0 / S6 — build the REAL Marketplace card model from a seller's draft.
 *
 * S6 forbids a separate approximate preview model: the seller must see the control buyers see. This
 * maps draft form values onto `MarketplaceListingCardModel` so `MarketplaceListingCard` itself does
 * the rendering, including its own honest missing states.
 *
 * Two rules govern every field here:
 *
 *   1. UNKNOWN IS NULL, NEVER ZERO. The preview this replaces printed "0 km" for a seller who had
 *      not entered mileage. A fabricated zero is indistinguishable from a real reading, which is
 *      what Invariant 8 exists to prevent.
 *
 *   2. A DRAFT BORROWS NO AUTHORITY. Nothing in a browser draft is verified, published,
 *      Trust-scored, plate-checked or reserved, so every one of those is carried as absent. A
 *      preview that flattered the listing would be a preview of a different listing.
 */
import { LOCATION_STATES, summaryLocationLine } from '@/lib/governedLocation'
import { plateStatusLabel } from '@/lib/marketplacePresentation'
import type { MarketplaceListingCardModel } from '@/components/marketplace/MarketplaceListingCard'

export interface SellerDraftPreviewInput {
  make: string
  model: string
  year: string
  color?: string
  mileage: string
  condition?: string
  category: string
  fuelType: string
  transmission: string
  drivetrain?: string
  location: string
  province?: string
  price: string
  currency: string
  images: string[]
}

/** A number the seller actually typed, or null. Blank, non-numeric and negative are all unknown. */
function enteredNumber(value: string | undefined): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Number(text)
  // A genuine 0 survives — 0 km is a real reading. NaN and negatives are not readings.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function enteredText(value: string | undefined): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

export function sellerDraftToCardModel(draft: SellerDraftPreviewInput): MarketplaceListingCardModel {
  const name = [enteredText(draft.year), enteredText(draft.make), enteredText(draft.model)]
    .filter(Boolean)
    .join(' ')

  return {
    // A draft has no VIN-addressable public listing yet; the card uses this only as a key.
    vin: '',
    name: name || 'Vehicle',
    price: enteredNumber(draft.price),
    currency: enteredText(draft.currency),
    primaryImage: draft.images?.[0] ?? null,
    // The seller is looking at their own local file, which is loaded by definition.
    primaryImageState: draft.images?.length ? 'listing_media' : 'none',
    mileage: enteredNumber(draft.mileage),
    transmission: enteredText(draft.transmission),
    fuel: enteredText(draft.fuelType),
    // S3 default: a draft has published no seller identity. The card says so in its own words.
    sellerLabel: 'Seller identity not published',
    // The state is passed explicitly because in a DRAFT the seller's own entry is the record: the
    // helper refuses to publish a location with no state, which is right for a governed listing and
    // wrong for a preview of what this seller just typed. `not_recorded` when they typed nothing —
    // the card then prints its own missing sentence rather than an empty line.
    locationLabel: summaryLocationLine(
      enteredText(draft.location),
      enteredText(draft.location) ? LOCATION_STATES.RECORDED : LOCATION_STATES.NOT_RECORDED,
    ).label,
    // Read through the shared helper rather than written here, so the preview says exactly what the
    // Marketplace says for a vehicle whose plate CarUp has not checked: "Plate status unknown".
    plateStatus: plateStatusLabel({}),
    // Every governed signal below is absent because a draft has earned none of them.
    plateVerified: false,
    reserved: false,
    partSentryChecked: false,
    labels: ['Draft preview'],
    trust: null,
    carupGold: false,
    syntheticDemo: false,
  }
}

/**
 * The facets a buyer could actually find this listing by, in the order the plan writes them:
 * `Toyota · Hilux · Pickup · Diesel · Automatic · Harare · 2021`.
 *
 * A facet the seller has not supplied is OMITTED rather than shown as a blank or a placeholder —
 * listing it would tell the seller their vehicle is discoverable by something it is not.
 */
export function sellerDiscoverabilityFacets(draft: SellerDraftPreviewInput): string[] {
  return [
    draft.make,
    draft.model,
    draft.category,
    draft.fuelType,
    draft.transmission,
    draft.drivetrain,
    draft.location,
    draft.year,
  ]
    .map(enteredText)
    .filter((value): value is string => value !== null)
}

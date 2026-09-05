/**
 * Seller Journey 1.0 / S7 — Listing Quality.
 *
 * ONE OF THREE MEASUREMENTS THAT MUST NEVER COLLAPSE (Invariant 6):
 *
 *   · Publication Readiness — MAY CarUp publish this?   → governed evidence requirements
 *   · Listing Quality       — is the ADVERTISEMENT strong? → this file
 *   · Canonical Trust       — what has CarUp VERIFIED?   → canonicalTrustService, never here
 *
 * Everything below is computed from what the SELLER supplied about their own advertisement. No
 * governed fact, no evidence state and no Trust position is an input, and none may become an
 * output. A seller who writes four hundred characters and uploads eight photos has a better
 * ADVERTISEMENT; CarUp has verified exactly as much as it had before — which is why nothing here
 * may borrow verification language, and why a perfect score cannot move a publication requirement.
 *
 * The thresholds are deliberately plain and few. A score that looks precise implies a measurement
 * CarUp is not making.
 */

export interface ListingQualityInput {
  images: string[]
  /** Whether the seller explicitly chose a cover photo (S4). Position is not a choice. */
  coverChosen: boolean
  description: string
  features: string[]
  /** The facets a buyer could actually search this listing by (S6). */
  discoverabilityFacets: string[]
}

export interface ListingQualityCheck {
  key: string
  label: string
  suggestion: string
  passes: (listing: ListingQualityInput) => boolean
}

/**
 * Each check is one concrete thing a seller can do. Wording is checked by test to carry no
 * verification vocabulary: a strong advertisement is not a verified vehicle.
 */
export const LISTING_QUALITY_CHECKS: ListingQualityCheck[] = [
  {
    key: 'photo_count',
    label: 'At least four photos',
    suggestion: 'Add more photos — listings with four or more get noticeably more enquiries.',
    passes: listing => listing.images.length >= 4,
  },
  {
    key: 'photo_depth',
    label: 'A fuller photo set',
    suggestion: 'Add more angles — interior, dashboard, odometer and tyres answer the questions buyers ask next.',
    passes: listing => listing.images.length >= 8,
  },
  {
    key: 'cover_chosen',
    label: 'A chosen cover photo',
    suggestion: 'Pick which photo buyers see first — otherwise your listing leads with whichever one uploaded first.',
    passes: listing => listing.coverChosen === true,
  },
  {
    key: 'description_written',
    label: 'A written description',
    suggestion: 'Describe the vehicle in your own words — condition, history and why you are selling.',
    passes: listing => listing.description.trim().length >= 120,
  },
  {
    key: 'description_detailed',
    label: 'A detailed description',
    suggestion: 'Say more — service history, recent work and any known faults save both sides a conversation.',
    passes: listing => listing.description.trim().length >= 300,
  },
  {
    key: 'features_listed',
    label: 'Features listed',
    suggestion: 'List the extras — buyers filter and compare on them.',
    passes: listing => listing.features.filter(entry => entry.trim()).length >= 3,
  },
  {
    key: 'discoverable',
    label: 'Complete search details',
    suggestion: 'Fill in the remaining vehicle details so more buyer filters match this listing.',
    passes: listing => listing.discoverabilityFacets.length >= 7,
  },
]

export interface ListingQualityResult {
  score: number
  band: 'Needs work' | 'Getting there' | 'Strong'
  passed: string[]
  suggestions: string[]
}

export function assessListingQuality(listing: ListingQualityInput): ListingQualityResult {
  const passed = LISTING_QUALITY_CHECKS.filter(check => check.passes(listing))
  const failed = LISTING_QUALITY_CHECKS.filter(check => !check.passes(listing))
  const score = Math.round((passed.length / LISTING_QUALITY_CHECKS.length) * 100)

  // Three bands, not a grade. "Strong" describes the advertisement and deliberately shares no
  // vocabulary with Trust ("verified", "trusted", "gold", "certified").
  const band: ListingQualityResult['band'] =
    score >= 85 ? 'Strong' : score >= 45 ? 'Getting there' : 'Needs work'

  return {
    score,
    band,
    passed: passed.map(check => check.label),
    suggestions: failed.map(check => check.suggestion),
  }
}

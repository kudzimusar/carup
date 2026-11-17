/**
 * RX04-D / I-03 — what a seller still needs to do, computed only from facts the Seller pages already
 * check. Nothing here is an assessment of the vehicle, an inspection, a Trust position or a verified
 * seller status, and nothing is a score:
 *
 *  - REQUIRED: the exact required-field rules each page already enforces before it lets the seller
 *    move on (the guest page and the signed-in page differ slightly; each profile mirrors its own page,
 *    so this module never tightens or loosens a business rule);
 *  - STRONGER: the existing deterministic listing-quality checks (lib/listingQuality.ts), unchanged;
 *  - Governed publication readiness (evidence review) is NOT computed here — the pages point to it.
 *
 * Every item names the step where the seller fixes it.
 */
import { LISTING_QUALITY_CHECKS } from '@/lib/listingQuality'
import { isCompleteVin } from '@/lib/sellerVehicleIdentification'
import { isValidVehicleYear } from '@/data/vehicleTaxonomy'

export type SellerProfile = 'guest' | 'account'

export interface SellerReadinessInput {
  make: string
  model: string
  year: string
  vin: string
  color: string
  mileage: string
  condition: string
  category: string
  fuelType: string
  transmission: string
  currency: string
  price: string
  location: string
  description: string
  features: string[]
  images: string[]
  coverChosen: boolean
  discoverabilityFacets: string[]
  /**
   * When the page's own identity rules still hold the seller on step 1 (Passport check running,
   * existing Passport not yet confirmed, seller authority pending), the page passes its message here.
   */
  identityBlocker?: string | null
}

export interface ReadinessItem {
  key: string
  label: string
  done: boolean
  /** 0-based step where the seller fills this in. */
  step: number
  /** The existing plain-language suggestion, where the rule already has one. */
  hint?: string
}

export interface SellerReadiness {
  required: ReadinessItem[]
  stronger: ReadinessItem[]
  requiredDone: number
  strongerDone: number
  /** True when every required item the current page enforces is satisfied. */
  readyToSave: boolean
}

const trimmed = (value: string | null | undefined) => Boolean(value && String(value).trim())
const truthy = (value: string | null | undefined) => Boolean(value)

/** Which step each listing-quality check is fixed in. */
const QUALITY_STEP: Record<string, number> = {
  photo_count: 2,
  photo_depth: 2,
  cover_chosen: 2,
  description_written: 1,
  description_detailed: 1,
  features_listed: 2,
  discoverable: 1,
}

export function sellerReadiness(input: SellerReadinessInput, profile: SellerProfile): SellerReadiness {
  const description = input.description ?? ''
  // Each page's own presence test: the guest page trims make/model/colour, the signed-in page does not.
  const has = profile === 'guest' ? trimmed : truthy
  const vinComplete = isCompleteVin(input.vin ?? '')
  const required: ReadinessItem[] = [
    { key: 'make_model', label: 'Make and model', done: has(input.make) && has(input.model), step: 0 },
    {
      key: 'year',
      label: profile === 'guest' ? 'A valid year' : 'Year',
      done: profile === 'guest' ? isValidVehicleYear(input.year) : truthy(input.year),
      step: 0,
    },
    {
      key: 'vin',
      label: vinComplete && input.identityBlocker ? input.identityBlocker : 'A complete vehicle identifier (VIN)',
      done: vinComplete && !input.identityBlocker,
      step: 0,
    },
    { key: 'color', label: 'Colour', done: has(input.color), step: 0 },
    {
      key: 'specs',
      label: 'Mileage, condition, category, fuel and gearbox',
      done: [input.mileage, input.condition, input.category, input.fuelType, input.transmission].every(truthy),
      step: 1,
    },
    {
      key: 'price',
      label: profile === 'account' ? 'A price of at least 100, with its currency' : 'A price, with its currency',
      // Mirrors the page exactly: the signed-in floor refuses only a number below 100.
      done: truthy(input.currency) && truthy(input.price) && (profile === 'guest' || !(parseFloat(input.price) < 100)),
      step: 1,
    },
    { key: 'location', label: 'Where the car is', done: truthy(input.location), step: 1 },
    {
      key: 'description',
      label: profile === 'account' ? 'A description of at least 50 characters' : 'A description of at least 30 characters',
      done: profile === 'account' ? description.length >= 50 : description.trim().length >= 30,
      step: 1,
    },
  ]

  const qualityInput = {
    images: input.images ?? [],
    coverChosen: input.coverChosen === true,
    description,
    features: input.features ?? [],
    discoverabilityFacets: input.discoverabilityFacets ?? [],
  }
  const stronger: ReadinessItem[] = LISTING_QUALITY_CHECKS.map(check => ({
    key: check.key,
    label: check.label,
    done: check.passes(qualityInput),
    step: QUALITY_STEP[check.key] ?? 2,
    hint: check.suggestion,
  }))

  const requiredDone = required.filter(item => item.done).length
  return {
    required,
    stronger,
    requiredDone,
    strongerDone: stronger.filter(item => item.done).length,
    readyToSave: requiredDone === required.length,
  }
}

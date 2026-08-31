/**
 * Seller Journey 1.0 / S1 — Seller Entry & Vehicle Identification.
 *
 * One shared identification contract for both Sell surfaces. Before S1 the seller only discovered
 * a duplicate from the submit-time 409, after every field and photo had already been supplied.
 *
 * This reuses the SAME public, rate-limited, audience-gated passport lookup that Verify already
 * calls. It opens no new exposure: a seller sees exactly what any public caller of that endpoint
 * would see for this identifier.
 *
 * Truth rules encoded here:
 *   - a hit says "CarUp already holds a Passport", never "this is your verified vehicle";
 *   - a miss is fail-closed — it is a statement about CarUp's records, never proof that the
 *     vehicle does not exist;
 *   - identification NEVER prefills seller-stated dimensions (colour, mileage, price, condition).
 *     A Passport is not a seller statement, and inheriting one would manufacture a seller-stated
 *     fact nobody asserted;
 *   - an unreachable check is advisory and must never block the seller.
 */

/** Identity/description carried purely so the seller can confirm "yes, that is my vehicle". */
export interface SellerIdentifiedVehicle {
  vin: string
  make?: string
  model?: string
  year?: number
}

export type SellerVehicleIdentificationState =
  /** Not enough characters yet — no lookup was attempted. */
  | 'incomplete'
  /** CarUp already holds a Vehicle Passport for this VIN. Reuse it; do not create a duplicate. */
  | 'passport_exists'
  /** CarUp holds no Passport for this VIN. Says nothing about the vehicle's real-world existence. */
  | 'no_carup_record'
  /** The check could not be completed. Advisory only — the seller continues either way. */
  | 'check_unavailable'

export interface SellerVehicleIdentification {
  state: SellerVehicleIdentificationState
  vin: string | null
  passportVehicle: SellerIdentifiedVehicle | null
}

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/

export function isCompleteVin(value: string): boolean {
  return VIN_PATTERN.test(String(value ?? '').trim().toUpperCase())
}

/**
 * "CarUp holds no Passport for this VIN" is a POSITIVE FACT, and only a positive answer may
 * produce it. Everything else is "we could not check".
 *
 * This used to be asked the other way round — `isTransportFailure`, defaulting to FALSE — so any
 * error whose message did not happen to match a network-ish word was classified as "no record".
 * A 500, a 503, a 401, a 429, or any failure whose body supplied its own message (the API client
 * throws `extractApiErrorMessage(body) || 'HTTP error! status: N'`) therefore told the seller CarUp
 * holds no Passport, and the copy for that state invites them to create one. That is a fabricated
 * negative fact, and its consequence is a duplicate Vehicle Passport.
 *
 * The API client attaches the real `status` to the thrown Error, so the question is answered from
 * the status code where one exists, and only falls back to the message when it does not.
 */
function indicatesNoCarUpRecord(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status === 404
  if (error instanceof TypeError) return false
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\b(404|not found)\b/i.test(message)
}

type PassportLookup = (identifier: string) => Promise<unknown>

export async function identifySellerVehicle(
  rawVin: string,
  lookupVehiclePassport: PassportLookup,
): Promise<SellerVehicleIdentification> {
  const vin = String(rawVin ?? '').trim().toUpperCase()
  if (!isCompleteVin(vin)) {
    return { state: 'incomplete', vin: null, passportVehicle: null }
  }

  try {
    const passport = (await lookupVehiclePassport(vin)) as { vehicle?: Record<string, unknown> } | null
    const vehicle = passport?.vehicle
    const foundVin = typeof vehicle?.vin === 'string' ? vehicle.vin : ''
    if (!foundVin) {
      return { state: 'no_carup_record', vin, passportVehicle: null }
    }

    // Identity and description only — deliberately narrow. Widening this projection would let an
    // existing record supply seller-stated dimensions this seller never asserted.
    const identified: SellerIdentifiedVehicle = { vin: foundVin }
    if (typeof vehicle?.make === 'string') identified.make = vehicle.make
    if (typeof vehicle?.model === 'string') identified.model = vehicle.model
    if (typeof vehicle?.year === 'number') identified.year = vehicle.year

    return { state: 'passport_exists', vin, passportVehicle: identified }
  } catch (error) {
    return {
      // FAIL CLOSED: anything that is not a positive "not found" is an unchecked VIN.
      state: indicatesNoCarUpRecord(error) ? 'no_carup_record' : 'check_unavailable',
      vin,
      passportVehicle: null,
    }
  }
}

/** Seller-facing copy. Kept beside the states so no surface invents its own wording. */
export function sellerIdentificationMessage(result: SellerVehicleIdentification): string | null {
  switch (result.state) {
    case 'passport_exists':
      return 'CarUp already holds a Vehicle Passport for this VIN. Confirm it is the same vehicle so CarUp reuses that Passport instead of creating a duplicate.'
    case 'no_carup_record':
      return 'CarUp holds no Passport for this VIN yet. Continuing will start one.'
    case 'check_unavailable':
      return 'CarUp could not check its Passport records right now. You can continue — the VIN is checked again on submit.'
    default:
      return null
  }
}

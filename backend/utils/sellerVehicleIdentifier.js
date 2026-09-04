/**
 * ONE definition of "is this a vehicle identifier CarUp will accept from a Seller".
 *
 * Owner UAT 2026-09-01: Zimbabwe import paperwork can legitimately identify a Japanese
 * domestic-market vehicle by manufacturer frame/chassis number rather than a 17-character ISO
 * VIN — Cotecna labels GFC27-027051 "Chassis/VIN Number". Seller intake therefore accepts 12–17
 * letters, numbers and hyphens.
 *
 * But widening the alphabet for frame identifiers must NOT widen it for real VINs. ISO 3779
 * excludes I, O and Q precisely so they can never be read as 1, 0 and 0. A 17-character
 * identifier with no hyphen is unambiguously a VIN, and accepting `...5987O34` for `...5987034`
 * lets one mistyped character mint a SECOND Passport for a vehicle CarUp already holds — the exact
 * duplicate the whole identification flow exists to prevent. Shorter or hyphenated identifiers are
 * not VINs and keep the wider alphabet.
 *
 * This is a SYNTAX gate only. Evidence, ownership and Passport review still decide authority and
 * provenance; nothing here asserts that a vehicle exists or that the submitter may sell it.
 *
 * It is duplicated, deliberately, in web/src/lib/sellerVehicleIdentification.ts because the two
 * run in different packages. They must agree on what counts as one vehicle, or duplicate detection
 * is decided by which end happened to ask — so backend/tests/seller-vehicle-identifier.test.js
 * asserts the two sources carry the same patterns rather than trusting this comment.
 */

export const SELLER_VEHICLE_IDENTIFIER_PATTERN = /^[A-Z0-9-]{12,17}$/i;
export const ISO_3779_VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

/**
 * WHY an identifier was refused, or null when it is acceptable.
 *
 * The caller needs this to say something true. "Must be 12 to 17 letters, numbers, or hyphens" is
 * a correct description of the shape rule and a FALSE statement about `JTELU9FJ9K5987O34`, which
 * satisfies it exactly and was refused for a different reason. A seller told that about an
 * identifier that plainly matches it has been given no way to find their own typo.
 *
 * @returns {'shape'|'vin_alphabet'|null}
 */
export function sellerVehicleIdentifierProblem(value) {
  if (value === null || value === undefined) return 'shape';
  const identifier = String(value).trim();
  if (identifier === '' || !SELLER_VEHICLE_IDENTIFIER_PATTERN.test(identifier)) return 'shape';
  if (identifier.length === 17 && !identifier.includes('-') && !ISO_3779_VIN_PATTERN.test(identifier)) {
    return 'vin_alphabet';
  }
  return null;
}

export function validSellerVehicleIdentifier(value) {
  return sellerVehicleIdentifierProblem(value) === null;
}

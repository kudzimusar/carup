/**
 * Frozen CarUp public identity for Email (owner gates B1/B2/B3, 2026-08-18).
 *
 * The single source for anything a customer reads as a claim about who CarUp is. Nothing else may
 * hardcode identity, and nothing here may be invented.
 *
 * Empty is a VALUE, not a gap to fill. The repository ships four contradictory legal entity names,
 * two contradictory postal addresses, a statutory DPO phone that is demo seed data, and an About
 * page whose "Founder & CEO" is seeded user `u1` reused as a mock seller avatar. A renderer that
 * quietly substituted any of those would put a fabricated claim in front of a customer, which is
 * why every unverified field below is `null` and every consumer must render conditionally.
 */

export const EMAIL_BRAND_IDENTITY = Object.freeze({
  productName: 'CarUp',
  legalEntity: 'CarUp Technologies',           // no Ltd / Pvt / suffix — none is verified
  corporateDescriptor: 'Automotive Intelligence & Trust Network',
  consumerTagline: 'Know the car. Trust the journey.',
  headquarters: 'Tokyo, Japan',
  regionalOffice: 'Harare, Zimbabwe',

  // DEFERRED_UNTIL_VERIFIED. A partial or fabricated statutory address is worse than none: it is a
  // false legal claim, and marketing production eligibility stays gated wherever a postal address
  // is legally or provider-required.
  registeredLegalAddress: null,

  // No headshot, no signature asset, no social links, and no CEO. The approved leadership title is
  // NOT CEO and must never be rendered as one.
  socialLinks: Object.freeze([]),
  leadership: Object.freeze({
    name: 'S.K Musarurwa',
    title: 'Co-Founder & Head of Development',
    replyTo: 'info@carup.dev',
    headshotUrl: null,
    signatureAssetUrl: null,
  }),

  // No CarUp logo artwork exists anywhere in the repository or its history — only a 24x24 favicon.
  // The wordmark below is rendered as text until artwork is approved.
  logoArtworkUrl: null,
});

/** Fields a footer must NOT render while unverified. Exported so tests can assert the whole set. */
export const DEFERRED_IDENTITY_FIELDS = Object.freeze([
  'registeredLegalAddress',
  'socialLinks',
  'logoArtworkUrl',
]);

/** True when a field carries a real, publishable value. */
export function identityAvailable(field) {
  const value = EMAIL_BRAND_IDENTITY[field];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

export default EMAIL_BRAND_IDENTITY;

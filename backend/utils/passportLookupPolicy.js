/**
 * PASSPORT LOOKUP POLICY — Issue #164, product-owner decision of 2026-08-17.
 *
 * The multi-identifier passport lookup resolved a plate, temporary id or chassis number to a VIN
 * for anonymous callers. Even after the passport body stopped returning those identifiers, the
 * route remained an ENUMERATION ORACLE: anyone could test whether a given plate existed in CarUp.
 * Marketplace search was closed to exactly this one file away.
 *
 * Governed decision:
 *   - EXACT VIN lookup stays public and anonymous. A buyer standing in front of a car reads the
 *     VIN off the windscreen; that is the intended public entry point.
 *   - Plate, temporary identifier and chassis lookup require verified CarUp authentication.
 *   - An unauthenticated restricted lookup must NOT reveal whether the identifier exists. Every
 *     such request gets the identical non-enumerable response.
 *   - Owner / admin / government access is unchanged: authentication decides whether the lookup
 *     RESOLVES; the existing role rules still decide what the passport BODY contains.
 *
 * Chassis number is restricted alongside plate and temporary id. The decision named plate and
 * temporary identifier explicitly; chassis is the same class of private identifier (it is in
 * PRIVATE_VEHICLE_FIELDS and carries the same cloning risk), and leaving it open would preserve
 * the oracle the decision exists to close.
 *
 * FUTURE SELLER OPT-IN — the reason this is a policy module and not an inline branch. A seller
 * may one day publish their plate deliberately (a dealer advertising a specific registration).
 * `resolveLookupAccess` already accepts `sellerOptIn`, and the resolver hook below is the single
 * place that would begin returning true. The default is closed, and adding opt-in therefore
 * cannot widen the default for vehicles that never asked for it.
 */

/** ISO 3779: 17 characters, no I/O/Q. An identifier of this shape is treated as a VIN. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const LOOKUP_KINDS = Object.freeze({
  VIN: 'vin',
  RESTRICTED: 'restricted',
});

/**
 * Identifier kinds an anonymous caller may resolve. Deliberately a list of ONE — a new public
 * kind has to be added here, in the open, rather than by loosening a condition somewhere.
 */
export const PUBLIC_LOOKUP_KINDS = Object.freeze([LOOKUP_KINDS.VIN]);

export const LOOKUP_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  REQUIRE_AUTHENTICATION: 'require_authentication',
  INVALID: 'invalid',
});

/**
 * The single response an unauthenticated restricted lookup receives, whatever the identifier is.
 * It is returned WITHOUT querying the database, so neither the body nor the response time can
 * distinguish a real plate from a fabricated one.
 */
export const NON_ENUMERABLE_LOOKUP_RESPONSE = Object.freeze({
  status: 401,
  body: Object.freeze({
    error: 'Sign in to look up a vehicle by plate or temporary identifier. Exact VIN lookup is open to everyone.',
    code: 'LOOKUP_REQUIRES_AUTHENTICATION',
  }),
});

/** Normalize a plate to the comparison form used by `normalized_plate_number`. */
export function normalizeLookupPlate(plate) {
  if (!plate) return '';
  return String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate and classify a lookup identifier.
 * Returns null when the identifier is malformed — the caller answers that the same way it always
 * has, since a malformed string reveals nothing about any vehicle.
 */
export function classifyLookupIdentifier(rawIdentifier) {
  const value = String(rawIdentifier || '').trim();
  if (value.length < 2 || value.length > 64) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(value)) return null;

  return {
    value,
    kind: VIN_PATTERN.test(value) ? LOOKUP_KINDS.VIN : LOOKUP_KINDS.RESTRICTED,
    normalizedPlate: normalizeLookupPlate(value),
  };
}

/**
 * Whether the request carries a verified CarUp identity. `optionalAuth()` populates
 * `req.userContext` only from a session row that is present, valid and unexpired, so a forged
 * header cannot satisfy this.
 */
export function isVerifiedActor(actor) {
  return Boolean(actor && actor.id);
}

/**
 * Decide whether a lookup may resolve.
 *
 * @param {object} args
 * @param {string} args.kind          LOOKUP_KINDS value from classifyLookupIdentifier
 * @param {object|null} args.actor    req.userContext, or null when anonymous
 * @param {boolean} [args.sellerOptIn] FUTURE: the vehicle's seller published this identifier.
 *                                     Always false today; see resolveSellerLookupOptIn.
 */
export function resolveLookupAccess({ kind, actor, sellerOptIn = false }) {
  if (kind !== LOOKUP_KINDS.VIN && kind !== LOOKUP_KINDS.RESTRICTED) {
    return { decision: LOOKUP_DECISIONS.INVALID, kind };
  }

  if (PUBLIC_LOOKUP_KINDS.includes(kind)) {
    return { decision: LOOKUP_DECISIONS.ALLOW, kind, reason: 'public_kind' };
  }

  if (isVerifiedActor(actor)) {
    return { decision: LOOKUP_DECISIONS.ALLOW, kind, reason: 'verified_actor' };
  }

  if (sellerOptIn === true) {
    return { decision: LOOKUP_DECISIONS.ALLOW, kind, reason: 'seller_opt_in' };
  }

  return { decision: LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION, kind, reason: 'restricted_kind' };
}

/**
 * Seller opt-in resolver — the extension point, deliberately closed.
 *
 * When opt-in ships, this is the only function that changes: it will consult the per-vehicle
 * publication flag and return true just for vehicles whose seller published the identifier. It
 * must keep returning false for every other vehicle, so the default cannot widen.
 *
 * It intentionally performs NO query today. Querying here would reintroduce the timing signal the
 * non-enumerable response exists to remove, for a feature that does not yet exist.
 */
export async function resolveSellerLookupOptIn(/* { identifier, kind } */) {
  return false;
}

/**
 * Which vehicle columns a lookup of this kind may search.
 *
 * A VIN lookup searches the VIN column ALONE. That is what makes exact-VIN lookup safe to leave
 * public: it can only confirm the identifier the caller already holds, and cannot be used to
 * discover a plate or chassis by supplying one.
 */
export function lookupColumnsForKind(kind) {
  if (kind === LOOKUP_KINDS.VIN) {
    return Object.freeze({ vehicles: ['vin'], plateHistory: [] });
  }
  return Object.freeze({
    vehicles: ['chassis_number', 'plate_number', 'normalized_plate_number', 'temporary_identification_number'],
    plateHistory: ['plate_number', 'normalized_plate_number'],
  });
}

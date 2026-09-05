import {
  LOOKUP_DECISIONS,
  classifyLookupIdentifier,
  resolveLookupAccess,
} from '../../utils/passportLookupPolicy.js';
import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

/**
 * V2 access composition.
 *
 * This module deliberately consumes capability/relationship facts that must be
 * established by canonical authentication/authorization upstream. It does not
 * inspect headers, sessions, roles, tenants or vehicle tables itself.
 */
export function resolvePassportAudienceFromCapabilities({
  governanceAccess = false,
  ownerRelationship = false,
  sellerRelationship = false,
  transactionAccess = false,
  serviceAccess = false,
  institutionalAccess = false,
} = {}) {
  if (governanceAccess === true) return PASSPORT_AUDIENCES.GOVERNANCE;
  if (ownerRelationship === true) return PASSPORT_AUDIENCES.OWNER;
  if (sellerRelationship === true) return PASSPORT_AUDIENCES.SELLER;
  if (serviceAccess === true) return PASSPORT_AUDIENCES.GARAGE;
  if (institutionalAccess === true) return PASSPORT_AUDIENCES.PARTNER;
  if (transactionAccess === true) return PASSPORT_AUDIENCES.BUYER;
  return PASSPORT_AUDIENCES.PUBLIC;
}

export function assertRequestedAudienceAllowed(requestedAudience, capabilities = {}) {
  assertPassportAudience(requestedAudience);
  const resolved = resolvePassportAudienceFromCapabilities(capabilities);

  if (requestedAudience === PASSPORT_AUDIENCES.PUBLIC) return requestedAudience;
  if (requestedAudience === resolved) return requestedAudience;

  // A more privileged capability may safely request a lower-risk projection.
  if (resolved === PASSPORT_AUDIENCES.GOVERNANCE) return requestedAudience;
  if (
    (resolved === PASSPORT_AUDIENCES.OWNER || resolved === PASSPORT_AUDIENCES.SELLER)
    && requestedAudience === PASSPORT_AUDIENCES.BUYER
  ) {
    return requestedAudience;
  }

  throw new Error(`Passport audience ${requestedAudience} is not authorized by resolved capability ${resolved}`);
}

/**
 * Reuse the canonical Issue #164 identifier lookup policy. No local VIN/plate
 * classifier or public-lookup rule is permitted here.
 */
export function resolvePassportLookupRequest({
  identifier,
  actor = null,
  sellerOptIn = false,
} = {}) {
  const classified = classifyLookupIdentifier(identifier);
  if (!classified) {
    return {
      classified: null,
      access: { decision: LOOKUP_DECISIONS.INVALID, kind: null },
      query_allowed: false,
    };
  }

  const access = resolveLookupAccess({
    kind: classified.kind,
    actor,
    sellerOptIn,
  });

  return {
    classified,
    access,
    query_allowed: access.decision === LOOKUP_DECISIONS.ALLOW,
  };
}

/**
 * Vehicle Passport / Trust Lifecycle 1.0 — foundation contract.
 *
 * This module defines Passport presentation/orchestration semantics only.
 * It is intentionally pure and owns no database reads, vehicle truth, Trust
 * calculation, conversation state, analytics truth, or ownership mutation.
 */

export const PASSPORT_SCHEMA_VERSION = 'vehicle-passport-read-model-1.0.0';

export const PASSPORT_AUDIENCES = Object.freeze({
  PUBLIC: 'public',
  BUYER: 'buyer',
  OWNER: 'owner',
  SELLER: 'seller',
  GARAGE: 'garage',
  PARTNER: 'partner',
  GOVERNANCE: 'governance',
});

export const PASSPORT_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  TRANSACTION: 'transaction',
  OWNER: 'owner',
  SERVICE_PARTNER: 'service_partner',
  INSTITUTIONAL: 'institutional',
  INTERNAL: 'internal',
});

export const PASSPORT_DATA_STATES = Object.freeze([
  'known',
  'partial',
  'unknown',
  'unavailable',
  'not_evaluated',
  'withheld',
  'not_applicable',
  'conflicting',
  'pending',
  'expired',
  'rejected',
]);

const AUDIENCE_SCOPES = Object.freeze({
  [PASSPORT_AUDIENCES.PUBLIC]: new Set([PASSPORT_VISIBILITY.PUBLIC]),
  [PASSPORT_AUDIENCES.BUYER]: new Set([
    PASSPORT_VISIBILITY.PUBLIC,
    PASSPORT_VISIBILITY.TRANSACTION,
  ]),
  [PASSPORT_AUDIENCES.OWNER]: new Set([
    PASSPORT_VISIBILITY.PUBLIC,
    PASSPORT_VISIBILITY.TRANSACTION,
    PASSPORT_VISIBILITY.OWNER,
  ]),
  [PASSPORT_AUDIENCES.SELLER]: new Set([
    PASSPORT_VISIBILITY.PUBLIC,
    PASSPORT_VISIBILITY.TRANSACTION,
    PASSPORT_VISIBILITY.OWNER,
  ]),
  [PASSPORT_AUDIENCES.GARAGE]: new Set([
    PASSPORT_VISIBILITY.PUBLIC,
    PASSPORT_VISIBILITY.SERVICE_PARTNER,
  ]),
  [PASSPORT_AUDIENCES.PARTNER]: new Set([
    PASSPORT_VISIBILITY.PUBLIC,
    PASSPORT_VISIBILITY.INSTITUTIONAL,
  ]),
  [PASSPORT_AUDIENCES.GOVERNANCE]: new Set(Object.values(PASSPORT_VISIBILITY)),
});

export const PUBLIC_FORBIDDEN_KEYS = Object.freeze([
  'owner_id',
  'tenant_id',
  'current_seller_id',
  'seller_user_id',
  'engine_number',
  'chassis_number',
  'temp_plate_id',
  'national_id',
  'email',
  'phone',
  'phone_number',
  'ip_address',
  'reviewer_id',
  'internal_explanation',
  'provider_credentials',
  'storage_path',
]);

export function assertPassportAudience(audience) {
  if (!Object.values(PASSPORT_AUDIENCES).includes(audience)) {
    throw new Error(`Unsupported Passport audience: ${audience}`);
  }
  return audience;
}

export function assertPassportDataState(state) {
  if (!PASSPORT_DATA_STATES.includes(state)) {
    throw new Error(`Unsupported Passport data state: ${state}`);
  }
  return state;
}

export function canAudienceSee(visibility, audience) {
  assertPassportAudience(audience);
  if (!Object.values(PASSPORT_VISIBILITY).includes(visibility)) return false;
  return AUDIENCE_SCOPES[audience].has(visibility);
}

/**
 * Preserve "missing stays missing". This helper never substitutes zero/false/
 * empty-string or a plausible business default for an absent fact.
 */
export function governedValue(value, {
  state = value === null || value === undefined ? 'unknown' : 'known',
  source = null,
} = {}) {
  assertPassportDataState(state);
  return {
    value: value === undefined ? null : value,
    state,
    source,
  };
}

export function assertPublicSafeObject(value, path = 'passport') {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicSafeObject(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (PUBLIC_FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`Public Passport projection contains forbidden key at ${path}.${key}`);
    }
    assertPublicSafeObject(child, `${path}.${key}`);
  }
}

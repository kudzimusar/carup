/**
 * Real marketplace listing eligibility (Navigation Intelligence — onboarding foundation).
 *
 * PURE, READ-ONLY validation. No DB access, no side effects. Defines the single contract for what
 * makes a vehicle a *real, public, marketplace-eligible* listing (vs a fixture/demo, an incomplete
 * row, or a governed trust claim). Reuses the merged fixture detector (getFixtureExclusion) so there
 * is one source of truth for "is this a fixture".
 *
 * Wired into POST /api/vehicles/add via buildVehicleListingCandidate() + getListingEligibility() —
 * see docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md.
 *
 * Reason codes (stable, testable):
 *   invalid_vin_format, fixture_excluded, placeholder_make, placeholder_model, invalid_year,
 *   invalid_price, non_public_status, missing_owner_for_private_listing, seed_owner_id,
 *   missing_tenant_for_dealer_listing, seed_tenant_id, invalid_import_source,
 *   missing_registration_country, unknown_seller_type
 */
import { isPublicVehicleStatus, normalizeVehicleStatus } from '../../utils/vehicleStatus.js';
import {
  getFixtureExclusion,
  isRealImportSource,
  isLocalSafeImportSource,
  SEED_OWNER_IDS,
  SEED_TENANT_IDS,
} from './marketplaceClassificationRules.js';

const VALID_VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i; // 17 chars, no I/O/Q, no underscore (per ISO 3779)
const SYNTHETIC_VIN_RE = /^(vin|test|demo|seed|fixture|sample|mock|dummy)/i;
const SEED_OWNER_RE = /^u\d+$/;

const PLACEHOLDER_TEXT = new Set([
  '', 'test', 'testing', 'demo', 'sample', 'seed', 'dummy', 'placeholder', 'mock',
  'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'tbd', 'xxx', 'string', 'foo', 'bar',
]);
const ALLOWED_SELLER_TYPES = new Set(['private owner', 'private', 'dealer', 'dealership']);

const MIN_LISTING_YEAR = 1980;

function norm(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

/** A structurally valid 17-char VIN with no synthetic/test prefix. */
export function isStructurallyValidVin(vin) {
  const v = String(vin ?? '').trim();
  if (!VALID_VIN_RE.test(v)) return false;
  if (SYNTHETIC_VIN_RE.test(v)) return false; // belt-and-suspenders for "VIN…"/test prefixes
  return true;
}

function isPlaceholderText(value) {
  return PLACEHOLDER_TEXT.has(norm(value));
}

/** Status that is publicly listable (Available/Reserved + normalized aliases). */
export function isAllowedMarketplaceStatus(status) {
  return isPublicVehicleStatus(status);
}

/** import_source acceptable for a real listing: local-safe/absent OR a real import source; never poisoned/junk. */
export function isAllowedImportSource(importSource) {
  return isLocalSafeImportSource(importSource) || isRealImportSource(importSource);
}

function isAllowedSellerType(sellerType) {
  return ALLOWED_SELLER_TYPES.has(norm(sellerType));
}

function isDealerListing(vehicle = {}) {
  const t = norm(vehicle.current_seller_type);
  if (t === 'dealer' || t === 'dealership') return true;
  // A tenant link with a non-private seller type implies a dealer listing.
  if (norm(vehicle.tenant_id) !== '' && t !== 'private owner' && t !== 'private') return true;
  return false;
}

function sellerIdentityReasons(vehicle = {}) {
  const reasons = [];
  const owner = norm(vehicle.owner_id);
  const tenant = norm(vehicle.tenant_id);
  const ownerIsSeed = owner !== '' && (SEED_OWNER_IDS.has(owner) || SEED_OWNER_RE.test(owner));
  const tenantIsSeed = tenant !== '' && SEED_TENANT_IDS.has(tenant);

  if (isDealerListing(vehicle)) {
    if (tenant === '') reasons.push('missing_tenant_for_dealer_listing');
    else if (tenantIsSeed) reasons.push('seed_tenant_id');
  } else {
    if (owner === '') reasons.push('missing_owner_for_private_listing');
    else if (ownerIsSeed) reasons.push('seed_owner_id');
  }
  // Seed identities are never eligible, regardless of the private/dealer path.
  if (ownerIsSeed && !reasons.includes('seed_owner_id')) reasons.push('seed_owner_id');
  if (tenantIsSeed && !reasons.includes('seed_tenant_id')) reasons.push('seed_tenant_id');
  return reasons;
}

/** True when the seller identity (owner_id for private, tenant_id for dealer) is real and non-seed. */
export function isRealSellerIdentity(vehicle = {}) {
  return sellerIdentityReasons(vehicle).length === 0;
}

/** Normalize raw listing input into a consistent shape (trimmed strings, numeric year/price, canonical status). */
export function normalizeListingInput(input = {}) {
  const str = (v) => (v == null ? null : String(v).trim());
  return {
    vin: input.vin == null ? null : String(input.vin).trim().toUpperCase(),
    make: str(input.make),
    model: str(input.model),
    year: input.year == null || input.year === '' ? null : Number(input.year),
    price: input.price == null || input.price === '' ? null : Number(input.price),
    currency: str(input.currency) || 'USD',
    status: input.status == null ? null : normalizeVehicleStatus(input.status),
    import_source: str(input.import_source),
    registration_country: str(input.registration_country),
    owner_id: str(input.owner_id),
    tenant_id: str(input.tenant_id),
    current_seller_type: str(input.current_seller_type),
  };
}

/** All ineligibility reason codes for a vehicle (empty array = eligible). Order is stable. */
export function getListingIneligibilityReasons(vehicle = {}, opts = {}) {
  const reasons = [];
  const maxYear = opts.maxYear ?? (new Date().getFullYear() + 1);

  if (!isStructurallyValidVin(vehicle.vin)) reasons.push('invalid_vin_format');
  if (getFixtureExclusion(vehicle) !== null) reasons.push('fixture_excluded');
  if (isPlaceholderText(vehicle.make)) reasons.push('placeholder_make');
  if (isPlaceholderText(vehicle.model)) reasons.push('placeholder_model');

  const year = Number(vehicle.year);
  if (!Number.isInteger(year) || year < MIN_LISTING_YEAR || year > maxYear) reasons.push('invalid_year');

  if (!(Number(vehicle.price) > 0)) reasons.push('invalid_price');
  if (!isAllowedMarketplaceStatus(vehicle.status)) reasons.push('non_public_status');

  for (const r of sellerIdentityReasons(vehicle)) reasons.push(r);

  if (!isAllowedImportSource(vehicle.import_source)) reasons.push('invalid_import_source');
  if (norm(vehicle.registration_country) === '') reasons.push('missing_registration_country');
  if (!isAllowedSellerType(vehicle.current_seller_type)) reasons.push('unknown_seller_type');

  return reasons;
}

function collectWarnings(vehicle = {}) {
  const warnings = [];
  if (norm(vehicle.import_source) === '') warnings.push('import_source_absent_assumed_local');
  if (norm(vehicle.tenant_id) !== '' && (norm(vehicle.current_seller_type) === 'private owner' || norm(vehicle.current_seller_type) === 'private')) {
    warnings.push('tenant_on_private_listing');
  }
  return warnings;
}

/**
 * Structured eligibility result for a vehicle/listing input.
 * @returns {{ eligible: boolean, reasons: string[], warnings: string[], normalized: object }}
 */
export function getListingEligibility(vehicle = {}, opts = {}) {
  const reasons = getListingIneligibilityReasons(vehicle, opts);
  return {
    eligible: reasons.length === 0,
    reasons,
    warnings: collectWarnings(vehicle),
    normalized: normalizeListingInput(vehicle),
  };
}

/** Throw a MARKETPLACE_INELIGIBLE error if the vehicle is not eligible; otherwise return the result. */
export function assertMarketplaceEligible(vehicle = {}, opts = {}) {
  const result = getListingEligibility(vehicle, opts);
  if (!result.eligible) {
    const err = new Error(`Vehicle is not marketplace-eligible: ${result.reasons.join(', ')}`);
    err.code = 'MARKETPLACE_INELIGIBLE';
    err.reasons = result.reasons;
    throw err;
  }
  return result;
}

/**
 * Build the normalized candidate row for POST /api/vehicles/add from the request body + auth context,
 * BEFORE insert, so eligibility is evaluated against exactly what will be stored. Pure (no DB).
 *
 * Ownership mapping (from req.userContext.role):
 *  - owner  -> owner_id = userContext.id; tenant_id = null; current_seller_type = 'Private Owner'
 *  - dealer -> tenant_id = userContext.tenantId; owner_id = null; current_seller_type = 'Dealer'
 *  - admin/other -> owner_id / tenant_id / current_seller_type taken from the body (tenant falls back
 *    to context); if neither a real owner nor a real tenant is supplied, eligibility rejects it
 *    (no orphan public listings).
 *
 * import_source defaults to 'Local' only when omitted; registration_country defaults to 'ZW' (the
 * existing DB default) only when omitted. status is always 'Available' (creation lists as available).
 */
export function buildVehicleListingCandidate({ body = {}, userContext = {} } = {}) {
  const role = norm(userContext.role ?? userContext.effectiveRole);
  const userId = userContext.id ?? userContext.userId ?? null;
  const ctxTenant = userContext.tenantId ?? null;

  let owner_id = null;
  let tenant_id = null;
  let current_seller_type = null;

  if (role === 'owner') {
    owner_id = userId;
    tenant_id = null;
    current_seller_type = 'Private Owner';
  } else if (role === 'dealer') {
    owner_id = null;
    tenant_id = ctxTenant;
    current_seller_type = 'Dealer';
  } else {
    owner_id = body.owner_id ?? null;
    tenant_id = body.tenant_id ?? ctxTenant ?? null;
    current_seller_type = body.current_seller_type ?? (owner_id ? 'Private Owner' : (tenant_id ? 'Dealer' : null));
  }

  const hasText = (v) => v != null && String(v).trim() !== '';
  return {
    vin: body.vin ?? null,
    make: body.make ?? null,
    model: body.model ?? null,
    year: hasText(body.year) ? Number(body.year) : 2020,
    price: hasText(body.price) ? Number(body.price) : null,
    status: 'Available',
    owner_id,
    tenant_id,
    current_seller_type,
    import_source: hasText(body.import_source) ? String(body.import_source).trim() : 'Local',
    registration_country: hasText(body.registration_country) ? String(body.registration_country).trim() : 'ZW',
  };
}

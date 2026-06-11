/**
 * Marketplace classification rules (Navigation Intelligence — backfill readiness).
 *
 * PURE, READ-ONLY rules. No DB access, no side effects. Used by the read-only dry-run
 * (scripts/marketplace-classification-dryrun.js) to show what a SAFE marketplace classification
 * backfill WOULD do, before any data is changed.
 *
 * Hard rules (see docs/CARUP_MARKETPLACE_CLASSIFICATION_BACKFILL_PLAN.md):
 *  - Only `locally_used` and `recently_imported` may be PROPOSED automatically, and only from
 *    trustworthy source fields (`registration_country`, a curated real-import allowlist).
 *  - `brand_new` and `second_hand` are NEVER auto-classified — governed/manual review only.
 *  - `passport_verified` and `partsentry_checked` are NEVER inferred — governed approval only.
 *  - `import_source = 'test'` (and other seed/junk values) is POISONED and excluded.
 */

export const CONDITION_CATEGORIES = [
  'brand_new',
  'recently_imported',
  'locally_used',
  'second_hand',
  'certified_dealer',
  'unknown',
]

/** Categories that may NEVER be inferred automatically by the dry-run (governed/manual only). */
export const GOVERNED_ONLY_CATEGORIES = ['brand_new', 'second_hand']

/** Tags that may NEVER be inferred automatically (governed approval / verified state only). */
export const GOVERNED_ONLY_TAGS = ['passport_verified', 'partsentry_checked']

/**
 * Curated allowlist of REAL foreign import sources (normalized, lowercased). Extend ONLY with
 * explicit real country/source values confirmed in live data. `local`/`test`/null are never here.
 */
export const REAL_IMPORT_SOURCES = new Set([
  'japan',
  'uk',
  'united kingdom',
  'england',
  'south africa',
  'sa',
  'singapore',
  'thailand',
  'germany',
  'usa',
  'united states',
  'dubai',
  'uae',
  'united arab emirates',
])

/** Explicitly local-safe import sources (a ZW-registered, non-imported car). */
export const LOCAL_SAFE_IMPORT_SOURCES = new Set(['local', 'domestic', 'zimbabwe', 'zw'])

/** Poisoned / seed / junk values that must never drive a classification. */
export const POISONED_VALUES = new Set([
  'test', 'testing', 'demo', 'sample', 'seed', 'dummy', 'placeholder',
  'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'tbd', 'xxx',
])

function norm(value) {
  return value == null ? '' : String(value).trim().toLowerCase()
}

/** True when a value is a poisoned/seed/junk marker that must be excluded from classification. */
export function isPoisonedSeedValue(value) {
  return POISONED_VALUES.has(norm(value))
}

/** True only when import_source is a curated REAL foreign source (not local, not poisoned). */
export function isRealImportSource(importSource) {
  const s = norm(importSource)
  if (!s || s === 'local' || isPoisonedSeedValue(s)) return false
  return REAL_IMPORT_SOURCES.has(s)
}

/** True when import_source is explicitly local-safe OR absent (empty/null) — and not poisoned/foreign. */
export function isLocalSafeImportSource(importSource) {
  const s = norm(importSource)
  if (isPoisonedSeedValue(s)) return false
  if (isRealImportSource(s)) return false
  return s === '' || LOCAL_SAFE_IMPORT_SOURCES.has(s)
}

/** True when registration_country is Zimbabwe (zw / zimbabwe), case-insensitive. */
export function isLocalRegistration(registrationCountry) {
  const s = norm(registrationCountry)
  return s === 'zw' || s === 'zimbabwe'
}

/**
 * Seed / demo / integration FIXTURE detection (provenance hardening).
 *
 * The locally_used candidate provenance review found all 35 candidates were fixtures (synthetic VINs,
 * placeholder owner_id, nil/default tenant_id, cloned rows). Real production rows must clear these
 * signals before they can be classified OR written by the backfill — even if allowlisted.
 */
export const SEED_OWNER_IDS = new Set(['u1', 'u2', 'u3', 'u4', 'u5', 'test', 'demo', 'seed', 'admin'])
export const SEED_TENANT_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
])
/** VIN encodes an integration/QA fixture (only checked for VINs that are not structurally valid). */
const INTEGRATION_VIN_RE = /(^|[_-])(int|integ|integration|trans|e2e|smoke|qa)([_-]|\d|$)/i
/** Obviously synthetic VIN (starts with the literal letters "VIN" or a test/demo prefix). */
const SYNTHETIC_VIN_RE = /^(vin|test|demo|seed|fixture|sample|mock|dummy)/i
/** Structurally valid 17-char VIN (no I/O/Q, per ISO 3779). Real VINs never contain "_" or "I". */
const VALID_VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

/**
 * Return a fixture/seed/demo exclusion reason for a vehicle, or null when it looks like real data.
 * Pure. Used to keep demo/integration rows out of automatic classification AND out of backfill writes.
 * @returns {string|null} one of: integration_fixture_vin / synthetic_vin_prefix / invalid_vin_format /
 *   seed_owner_id / seed_tenant_id, each with the offending value, or null.
 */
export function getFixtureExclusion(vehicle = {}) {
  const vin = String(vehicle.vin ?? '').trim()
  const owner = norm(vehicle.owner_id ?? vehicle.seller_id ?? vehicle.user_id)
  const tenant = norm(vehicle.tenant_id)

  if (vin && !VALID_VIN_RE.test(vin)) {
    if (INTEGRATION_VIN_RE.test(vin)) return `integration_fixture_vin(${vin})`
    if (SYNTHETIC_VIN_RE.test(vin) || vin.includes('_')) return `synthetic_vin_prefix(${vin})`
    return `invalid_vin_format(${vin})`
  }
  if (owner && (SEED_OWNER_IDS.has(owner) || /^u\d+$/.test(owner))) return `seed_owner_id(${owner})`
  if (tenant && SEED_TENANT_IDS.has(tenant)) return `seed_tenant_id(${tenant})`
  return null
}

/**
 * Decide a PROPOSED vehicle_condition_category for a vehicle, or exclude it with a reason.
 * Only ever proposes 'recently_imported' or 'locally_used'. Never brand_new/second_hand.
 *
 * @returns {{ proposed: string|null, included: boolean, reason: string, confidence: string,
 *             risk: string, current: string, sourceFields?: object }}
 */
export function classifyVehicleConditionCandidate(vehicle = {}) {
  const current = norm(vehicle.vehicle_condition_category ?? vehicle.condition_category) || 'unknown'
  const importSource = vehicle.import_source
  const regCountry = vehicle.registration_country

  // Already classified -> not a candidate.
  if (current && current !== 'unknown') {
    return { proposed: null, included: false, reason: 'already_classified', confidence: 'n/a', risk: 'none', current }
  }

  // Seed/demo/integration fixture rows must never become candidates (provenance hardening).
  const fixtureReason = getFixtureExclusion(vehicle)
  if (fixtureReason) {
    return { proposed: null, included: false, reason: fixtureReason, confidence: 'none', risk: 'high', current }
  }

  // Poisoned seed import source -> cannot trust it for ANY classification.
  if (isPoisonedSeedValue(importSource)) {
    return {
      proposed: null, included: false,
      reason: `poisoned_seed_value(import_source=${JSON.stringify(norm(importSource))})`,
      confidence: 'none', risk: 'high', current,
    }
  }

  // Real foreign import -> recently_imported (takes precedence over local registration).
  if (isRealImportSource(importSource)) {
    return {
      proposed: 'recently_imported', included: true,
      reason: `real_foreign_import_source(${norm(importSource)})`,
      confidence: 'high', risk: 'low', current,
      sourceFields: { import_source: importSource },
    }
  }

  // Local registration + local-safe/absent import -> locally_used.
  if (isLocalRegistration(regCountry) && isLocalSafeImportSource(importSource)) {
    return {
      proposed: 'locally_used', included: true,
      reason: `local_registration(${norm(regCountry)})+local_or_absent_import`,
      confidence: 'high', risk: 'low', current,
      sourceFields: { registration_country: regCountry, import_source: importSource ?? null },
    }
  }

  // A non-local, non-real, non-poison import_source = unrecognized junk -> exclude (don't guess).
  if (norm(importSource) && !isLocalSafeImportSource(importSource) && !isRealImportSource(importSource)) {
    return {
      proposed: null, included: false,
      reason: `unrecognized_import_source(${norm(importSource)})_not_in_allowlist`,
      confidence: 'none', risk: 'medium', current,
    }
  }

  // No local registration and no usable import source -> insufficient.
  return {
    proposed: null, included: false,
    reason: 'insufficient_data(no_local_registration,no_real_import_source)',
    confidence: 'none', risk: 'none', current,
  }
}

/** passport_verified: never auto. Report current flag only; governed-review-only. */
export function passportVerifiedStatus(vehicle = {}) {
  return {
    tag: 'passport_verified',
    current: vehicle.passport_verified === true,
    autoBackfill: false,
    classification: 'governed-review-only',
    requires: 'approved trust-fact request over verified registration/ownership evidence (admin/government)',
  }
}

/**
 * partsentry_checked: never auto. A log only counts when it is fully governed-verified:
 * verification_status='verified' AND part_verification_status='verified' AND public_card_eligible
 * AND suspicion_status in (none, cleared). Self-approval (mechanic approving own log) disqualifies.
 */
export function partsentryCheckedStatus(partsentryLogs = []) {
  const eligible = (partsentryLogs || []).filter(l =>
    norm(l.verification_status) === 'verified' &&
    norm(l.part_verification_status) === 'verified' &&
    (l.public_card_eligible === true || norm(l.public_card_eligible) === 'true') &&
    ['none', 'cleared'].includes(norm(l.suspicion_status)) &&
    // self-approval guard: only applied when approver data is present
    !(l.approved_by != null && l.mechanic_id != null && String(l.approved_by) === String(l.mechanic_id)),
  )
  return {
    tag: 'partsentry_checked',
    eligibleLogCount: eligible.length,
    isChecked: eligible.length > 0,
    autoBackfill: false,
    classification: 'governed-review-only',
    requires: 'verified PartSentry review + part verification + public_card_eligible + suspicion none/cleared + no self-approval',
  }
}

/**
 * Full proposal for one vehicle: condition candidate + governed-only tag statuses.
 * @param {object} vehicle
 * @param {{ partsentryLogs?: object[] }} relatedRows
 */
export function deriveMarketplaceClassificationProposal(vehicle = {}, relatedRows = {}) {
  const condition = classifyVehicleConditionCandidate(vehicle)
  return {
    vin: vehicle.vin ?? null,
    condition,
    governedTags: {
      passport_verified: passportVerifiedStatus(vehicle),
      partsentry_checked: partsentryCheckedStatus(relatedRows.partsentryLogs || []),
    },
    governedOnlyCategories: GOVERNED_ONLY_CATEGORIES,
  }
}

/** Reason a vehicle is NOT an automatic condition candidate, or null when it is included. */
export function getExcludedReason(vehicle = {}) {
  const c = classifyVehicleConditionCandidate(vehicle)
  return c.included ? null : c.reason
}

/** Build a stable dry-run row object for the report (machine + human output). */
export function buildClassificationDryRunRow(vehicle = {}, currentState = 'unknown', proposedState = null, reason = null, extra = {}) {
  return {
    vin: vehicle.vin ?? null,
    current_category: currentState ?? 'unknown',
    proposed_category: proposedState ?? null,
    included: Boolean(proposedState),
    source_fields: {
      import_source: vehicle.import_source ?? null,
      registration_country: vehicle.registration_country ?? null,
      year: vehicle.year ?? null,
      mileage: vehicle.mileage ?? null,
      current_seller_type: vehicle.current_seller_type ?? null,
    },
    reason: reason ?? null,
    confidence: extra.confidence ?? (proposedState ? 'high' : 'none'),
    risk: extra.risk ?? (proposedState ? 'low' : 'none'),
    governed_only: extra.governed_only ?? false,
  }
}

/** Navigation promotion threshold: a category/tag needs >= this many live listings to be wired. */
export const NAV_PROMOTION_THRESHOLD = 3

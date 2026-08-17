import { isPublicVehicleStatus, isPubliclyVisiblePublication } from '../../utils/vehicleStatus.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';

/**
 * THE TRUST NUMBER ON A LISTING COMES FROM THE CANONICAL AUTHORITY, NEVER FROM THE ROW.
 *
 * `vehicles.trust_score` is a materialized cache with several unversioned writers (Issue #164
 * principle 2). Reading it here is how a hand-set 84 reached the public marketplace while the
 * trust-decision route published 50 for the same VIN. Every trust figure below therefore comes from
 * `getCanonicalTrustBatch()` -> `toPublicTrust()` in
 * backend/services/trustDecision/canonicalTrustService.js, and a listing with no fresh cache entry
 * publishes the honest `not_evaluated` / `score: null` — it does NOT fall back to the column.
 *
 * The authority is loaded LAZILY on purpose: canonicalTrustService instantiates the service-role
 * Supabase client at module scope, which throws without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
 * This module is otherwise pure and credential-free (its consumers include the public-projection
 * guard suite), so the dependency is taken only on the async read paths that were going to talk to
 * a database anyway. If that load or that read fails, the listing carries NO projection and NO
 * score — `trust: null`, `trust_score: null` — which is the one honest answer available when the
 * authority could not be consulted. There is no branch in which the stored column takes its place.
 */
let canonicalTrustModulePromise = null;
function loadCanonicalTrustAuthority() {
  if (canonicalTrustModulePromise === null) {
    canonicalTrustModulePromise = import('../trustDecision/canonicalTrustService.js');
  }
  return canonicalTrustModulePromise;
}

/**
 * The canonical public trust projection for each VIN, as a Map (vin -> 10-field public shape).
 *
 * ONE query for the whole page and ZERO recomputes: `getCanonicalTrustBatch` is cache-only by
 * construction, and it returns an entry for EVERY requested VIN, so no caller is left with a gap it
 * might be tempted to fill from `vehicle.trust_score`.
 */
export async function fetchCanonicalTrustByVin(supabaseClient, vins = []) {
  const out = new Map();
  const wanted = (vins || []).filter(Boolean);
  if (!wanted.length) return out;
  try {
    const { getCanonicalTrustBatch, toPublicTrust } = await loadCanonicalTrustAuthority();
    const records = await getCanonicalTrustBatch(wanted, { client: supabaseClient });
    for (const [vin, record] of records) out.set(vin, toPublicTrust(record));
  } catch (error) {
    // "We could not consult the authority" is not "these vehicles have no evaluation", and it is
    // certainly not "use the stored number". The map stays empty, every listing publishes a null
    // score, and the failure is logged rather than absorbed into a number.
    console.warn('Marketplace summary could not read the canonical trust authority:', error.message);
  }
  return out;
}

/**
 * The canonical score a listing may be ranked, filtered or published by: a number ONLY when the
 * authority published one for this listing. It reads `summary.trust.score` and nothing else —
 * there is deliberately no `?? summary.trust_score` second chance, because that is precisely the
 * shape a fallback takes when someone later hands this function a summary carrying a legacy number.
 * An unversioned value is not a smaller number here; it is an absence.
 */
export function canonicalListingScore(summary) {
  const score = summary?.trust?.score ?? null;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

export const CONDITION_CATEGORIES = [
  'brand_new',
  'recently_imported',
  'locally_used',
  'second_hand',
  'certified_dealer',
  'unknown',
];

export const MARKETPLACE_TAGS = [
  'passport_verified',
  'plate_verified',
  'evidence_available',
  'duty_cleared',
  'zimra_verified',
  'cid_clear',
  'low_mileage',
  'fresh_import',
  'one_owner',
  'dealer_verified',
  'private_sale',
  'safe_pay_ready',
  'inspection_ready',
  'recent_service',
  'partsentry_checked',
  'repair_history_available',
  'verified_parts',
];

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;
const RECENT_SERVICE_DAYS = 365;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTag(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function daysSince(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (1000 * 60 * 60 * 24);
}

function safeLimit(value) {
  const parsed = Math.floor(numericValue(value, DEFAULT_LIMIT));
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function toRecordMap(rows, key = 'vin') {
  return (rows || []).reduce((acc, row) => {
    const id = row?.[key];
    if (!id) return acc;
    if (!acc.has(id)) acc.set(id, []);
    acc.get(id).push(row);
    return acc;
  }, new Map());
}

export function deriveConditionCategory(vehicle = {}) {
  const explicit = normalizeTag(vehicle.vehicle_condition_category || vehicle.condition_category);
  if (CONDITION_CATEGORIES.includes(explicit)) return explicit;

  const condition = normalizeText(vehicle.condition);
  const sellerType = normalizeText(vehicle.current_seller_type || vehicle.seller_type || vehicle.sellerType);
  const importSource = normalizeText(vehicle.import_source);
  const registrationCountry = normalizeText(vehicle.registration_country);

  if (condition === 'new' || condition === 'brand new') return 'brand_new';
  if (condition.includes('certified') || sellerType.includes('certified')) return 'certified_dealer';
  if (condition === 'used' || condition.includes('second')) return 'second_hand';
  if (importSource && importSource !== 'local') return 'recently_imported';
  if (registrationCountry === 'zw' || registrationCountry === 'zimbabwe') return 'locally_used';
  return 'unknown';
}

export function sellerSummaryForVehicle(vehicle = {}) {
  const sellerTypeText = normalizeText(vehicle.current_seller_type || vehicle.seller_type || vehicle.sellerType);
  const tenantName = vehicle.tenant?.name || vehicle.tenant_name || null;
  const publicProfileEnabled = boolValue(vehicle.public_seller_display_enabled);
  const isDealer = sellerTypeText.includes('dealer') || sellerTypeText.includes('dealership') || Boolean(tenantName);

  if (isDealer) {
    return {
      seller_type: 'dealer',
      seller_display_label: publicProfileEnabled && tenantName ? tenantName : 'Verified dealer',
      seller_public_profile_enabled: publicProfileEnabled,
    };
  }

  return {
    seller_type: 'private',
    seller_display_label: 'Private seller',
    seller_public_profile_enabled: false,
  };
}

export function summarizeEvidence(rows = []) {
  const publicVerified = rows.filter(row =>
    row?.verification_status === 'verified' &&
    (row?.visibility_level || 'public_safe') === 'public_safe'
  );

  return {
    evidence_count: publicVerified.length,
  };
}

/**
 * Suspicion handling is FAIL-CLOSED via an allowlist of known-safe states (ports PR #11 governance
 * into the read path: main's summary fetched suspicion_status but ignored it). A log may contribute a
 * public PartSentry claim ONLY when its suspicion_status is one of the known non-suspicious values
 * (empty/absent is treated as non-suspicious for legacy rows without the column). ANY other value —
 * including watch/flagged AND any future/unknown enum value (e.g. 'under_review') — suppresses ALL
 * PartSentry signals for the vehicle. Allowlist, not denylist, so new states never silently publish.
 */
const NON_SUSPICIOUS_PARTSENTRY_STATUSES = ['none', 'cleared', ''];
function isSuspiciousPartSentryRow(row) {
  return !NON_SUSPICIOUS_PARTSENTRY_STATUSES.includes(normalizeText(row?.suspicion_status));
}

/** Self-approval guard: a mechanic approving their own log can never produce a public claim. */
function isSelfApprovedPartSentry(row) {
  return row?.approved_by != null && row?.mechanic_id != null && String(row.approved_by) === String(row.mechanic_id);
}

/** Map raw PartSentry log state to the public-card status enum (not_applicable|suppressed|eligible|review_required|ineligible). */
function derivePartSentryPublicStatus(allRows, { suppressed, eligibleVerifiedCount, approvalProvenanceUnavailable }) {
  if (!allRows.length) return 'not_applicable';
  if (suppressed) return 'suppressed';
  if (eligibleVerifiedCount > 0) return 'eligible';
  if (approvalProvenanceUnavailable) return 'review_required';
  const reviewPending = allRows.some(row =>
    ['pending', 'pending_review', 'review_required'].includes(normalizeText(row?.verification_status)) ||
    ['pending', 'pending_review', 'review_required'].includes(normalizeText(row?.part_verification_status))
  );
  return reviewPending ? 'review_required' : 'ineligible';
}

export function summarizePartSentry(rows = []) {
  const all = rows || [];
  // Fail-closed suppression: any row whose suspicion_status is not in the non-suspicious allowlist
  // (watch/flagged or any unknown/future value) hides every PartSentry claim for the vehicle.
  const suppressed = all.some(isSuspiciousPartSentryRow);
  const approvalProvenanceUnavailable = all.some(row => row?.approval_provenance_available === false);
  // Governed public-card eligibility: opt-in flag + non-suspicious + approver provenance + not self-approved.
  const eligibleRows = suppressed
    ? []
    : all.filter(row =>
        boolValue(row?.public_card_eligible) &&
        !isSuspiciousPartSentryRow(row) &&
        row?.approval_provenance_available !== false &&
        !isSelfApprovedPartSentry(row)
      );

  const verifiedRows = eligibleRows.filter(row => normalizeText(row?.verification_status) === 'verified');
  const verifiedPartRows = eligibleRows.filter(row => normalizeText(row?.part_verification_status) === 'verified');
  const repairRows = eligibleRows.filter(row => ['Repaired', 'Replaced', 'Inspected', 'Diagnosed'].includes(row?.action_type));
  const recentService = repairRows.some(row => daysSince(row?.timestamp || row?.created_at) <= RECENT_SERVICE_DAYS);

  return {
    partsentry_checked: verifiedRows.length > 0,
    repair_history_count: repairRows.length,
    verified_parts_count: verifiedPartRows.length,
    recent_service: recentService,
    suppressed,
    approval_provenance_available: !approvalProvenanceUnavailable,
    public_status: derivePartSentryPublicStatus(all, { suppressed, eligibleVerifiedCount: verifiedRows.length, approvalProvenanceUnavailable }),
  };
}

export function deriveMarketplaceTags(vehicle, evidenceSummary, partSentrySummary, ownershipCount = 0) {
  const tags = new Set();
  const conditionCategory = deriveConditionCategory(vehicle);
  const seller = sellerSummaryForVehicle(vehicle);
  const mileage = numericValue(vehicle?.mileage);

  if (boolValue(vehicle?.passport_verified)) tags.add('passport_verified');
  if (vehicle?.plate_verified_at || normalizeText(vehicle?.plate_status) === 'verified') tags.add('plate_verified');
  if (evidenceSummary.evidence_count > 0) tags.add('evidence_available');
  if (boolValue(vehicle?.duty_paid)) tags.add('duty_cleared');
  if (boolValue(vehicle?.zimra_verified)) tags.add('zimra_verified');
  if (boolValue(vehicle?.police_verified)) tags.add('cid_clear');
  if (mileage > 0 && mileage <= 50000) tags.add('low_mileage');
  if (conditionCategory === 'recently_imported') tags.add('fresh_import');
  if (ownershipCount === 1 || boolValue(vehicle?.one_owner)) tags.add('one_owner');
  if (seller.seller_type === 'dealer') tags.add('dealer_verified');
  if (seller.seller_type === 'private') tags.add('private_sale');
  if (boolValue(vehicle?.safe_pay_ready)) tags.add('safe_pay_ready');
  if (boolValue(vehicle?.inspection_ready)) tags.add('inspection_ready');
  if (partSentrySummary.recent_service) tags.add('recent_service');
  if (partSentrySummary.partsentry_checked) tags.add('partsentry_checked');
  if (partSentrySummary.repair_history_count > 0) tags.add('repair_history_available');
  if (partSentrySummary.verified_parts_count > 0) tags.add('verified_parts');

  return Array.from(tags).filter(tag => MARKETPLACE_TAGS.includes(tag));
}

/**
 * @param {object} args
 * @param {object|null} [args.canonicalTrust] the VIN's entry from `fetchCanonicalTrustByVin()` — the
 *   10-field public trust projection. `null` means the caller did not consult the authority on this
 *   path, which publishes `trust: null` + `trust_score: null`: no number, and no pretence that the
 *   absence of one was a finding about the vehicle. There is deliberately no fallback branch that
 *   reads `vehicle.trust_score`.
 */
export function buildMarketplaceListingSummary({
  vehicle,
  evidenceRows = [],
  partSentryRows = [],
  ownershipCount = 0,
  imageRows = [],
  canonicalTrust = null,
}) {
  const conditionCategory = deriveConditionCategory(vehicle);
  const evidenceSummary = summarizeEvidence(evidenceRows);
  const partSentrySummary = summarizePartSentry(partSentryRows);
  const seller = sellerSummaryForVehicle(vehicle);
  const marketplaceTags = deriveMarketplaceTags(vehicle, evidenceSummary, partSentrySummary, ownershipCount);
  const primaryImage = [...imageRows].sort((a, b) => {
    if (boolValue(a?.is_primary) !== boolValue(b?.is_primary)) return boolValue(a?.is_primary) ? -1 : 1;
    return numericValue(a?.display_order) - numericValue(b?.display_order);
  })[0]?.image_url || null;

  return {
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    year: numericValue(vehicle.year),
    price: numericValue(vehicle.price),
    currency: vehicle.currency || 'USD',
    mileage: numericValue(vehicle.mileage),
    fuel_type: vehicle.fuel_type || null,
    transmission: vehicle.transmission || null,
    status: vehicle.status || 'Available',
    condition_category: conditionCategory,
    marketplace_tags: marketplaceTags,
    // The canonical projection, verbatim, or null when the authority was not consulted. It carries
    // evaluation_state, calculation_version, confidence and known_limitations, so a card can tell
    // "evaluated and low" from "never evaluated" — which no score and no band can express.
    trust: canonicalTrust ?? null,
    // Kept as the stable key for existing consumers, but it is now the CANONICAL number and it is
    // null whenever there is nothing canonical to publish. It is never `numericValue(...)` of the
    // raw column: that read is what published an unfounded 84 to the marketplace.
    trust_score: canonicalTrust?.score ?? null,
    primary_image_url: primaryImage,
    plate_verified: marketplaceTags.includes('plate_verified'),
    plate_status: vehicle.plate_status || null,
    passport_verified: marketplaceTags.includes('passport_verified'),
    evidence_count: evidenceSummary.evidence_count,
    partsentry_checked: partSentrySummary.partsentry_checked,
    repair_history_count: partSentrySummary.repair_history_count,
    verified_parts_count: partSentrySummary.verified_parts_count,
    duty_cleared: boolValue(vehicle.duty_paid),
    zimra_verified: boolValue(vehicle.zimra_verified),
    cid_clear: boolValue(vehicle.police_verified),
    seller_type: seller.seller_type,
    seller_display_label: seller.seller_display_label,
    seller_public_profile_enabled: seller.seller_public_profile_enabled,
    location: 'Zimbabwe',
    created_at: vehicle.created_at || null,
  };
}

/**
 * Anonymous free-text search. Plate and chassis are absent by design: matching on them would make
 * this endpoint an identifier oracle (confirm/deny a plate or chassis) even though the value is no
 * longer echoed. Registry-identifier lookup belongs to authenticated/owner paths only.
 */
function summaryMatchesSearch(summary, query) {
  if (!query) return true;
  const normalized = normalizeText(query);
  const haystack = [
    summary.vin,
    summary.make,
    summary.model,
    summary.condition_category,
    summary.seller_type,
    summary.seller_display_label,
    summary.marketplace_tags.join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(normalized);
}

/** Single mutually-exclusive condition/category match (NOT trust tags). */
function summaryMatchesCondition(summary, condition) {
  if (!condition || condition === 'all') return true;
  return summary.condition_category === condition;
}

/** AND semantics: a listing must carry EVERY requested trust tag to qualify. */
function summaryMatchesTags(summary, tags) {
  if (!tags || !tags.length) return true;
  return tags.every(tag => summary.marketplace_tags.includes(tag));
}

/**
 * Parse a `tag` filter into a deduped list of normalized trust slugs. Accepts a repeated-param array
 * (Express yields an array for `?tag=a&tag=b`) OR a CSV string (`?tag=a,b`). 'all'/empty are dropped.
 */
function parseTagList(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag && tag !== 'all' && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function byNewest(a, b) {
  return Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
}

/**
 * RANKING IS A CLAIM. Ordering the public marketplace by an unversioned legacy number puts the
 * hand-set 84 back on top of the page even when no surface prints it, so `sort=trust` ranks ONLY
 * listings the canonical authority actually scored. A listing with no canonical score is not
 * ranked at zero and not ranked by the stored column — it sorts after every scored listing and
 * keeps the default newest-first order among its peers.
 *
 * Today that means `sort=trust` degenerates to newest-first until the cache is populated by
 * `refreshCanonicalTrust`, because every legacy row is unversioned. `describeTrustRanking()` below
 * reports exactly that on the response rather than letting the page imply a trust ordering it does
 * not have.
 */
function sortSummaries(summaries, sort) {
  const copy = [...summaries];
  switch (sort) {
    case 'price-low':
      return copy.sort((a, b) => a.price - b.price);
    case 'price-high':
      return copy.sort((a, b) => b.price - a.price);
    case 'trust':
      return copy.sort((a, b) => {
        const left = canonicalListingScore(a);
        const right = canonicalListingScore(b);
        if (left === null && right === null) return byNewest(a, b);
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      });
    case 'newest':
    default:
      return copy.sort(byNewest);
  }
}

/**
 * What the ordering actually is, stated on the response. `ranked` counts the listings the requested
 * sort could order; for `sort=trust`, `unranked` counts the ones with no canonical score, which are
 * appended in newest-first order. A consumer can therefore tell "ranked by trust" from "trust
 * ranking unavailable", instead of assuming the first card is the most trustworthy.
 */
function describeTrustRanking(summaries, sort) {
  if (sort !== 'trust') return { requested: sort || 'newest', applied: sort || 'newest' };
  const ranked = summaries.filter((summary) => canonicalListingScore(summary) !== null).length;
  const unranked = summaries.length - ranked;
  return {
    requested: 'trust',
    applied: ranked === 0 ? 'newest' : 'trust',
    ranked_by_canonical_score: ranked,
    unranked_no_canonical_score: unranked,
    note: ranked === 0
      ? 'No listing on this page carries a canonical trust evaluation, so this page is not ordered by trust. The stored trust_score column is unversioned and is never used to rank.'
      : 'Listings with a canonical trust evaluation are ordered by it; the rest follow in newest-first order and are not ranked by the unversioned stored score.',
  };
}

async function maybeFetchRows(supabaseClient, table, select, vins, order) {
  if (!vins.length) return [];
  try {
    let query = supabaseClient.from(table).select(select).in('vin', vins);
    if (order) query = query.order(order.column, { ascending: order.ascending });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn(`Marketplace summary skipped ${table}:`, error.message);
    return [];
  }
}

const PARTSENTRY_GOVERNED_SELECT =
  'vin, action_type, timestamp, created_at, verification_status, part_verification_status, suspicion_status, public_card_eligible, approved_by, mechanic_id';
const PARTSENTRY_LEGACY_SELECT =
  'vin, action_type, timestamp, created_at, verification_status, part_verification_status, suspicion_status, public_card_eligible, mechanic_id';

function isMissingApprovedByError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('approved_by');
}

function withApprovalProvenance(rows, available) {
  return (rows || []).map(row => ({
    ...row,
    approval_provenance_available: available,
  }));
}

async function fetchPartSentryRows(supabaseClient, vins) {
  if (!vins.length) return [];
  const run = async (select) => {
    const { data, error } = await supabaseClient
      .from('partsentry_logs')
      .select(select)
      .in('vin', vins)
      .order('timestamp', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  try {
    return withApprovalProvenance(await run(PARTSENTRY_GOVERNED_SELECT), true);
  } catch (error) {
    if (!isMissingApprovedByError(error)) {
      console.warn('Marketplace summary skipped partsentry_logs:', error.message);
      return [];
    }
    console.warn('Marketplace summary using legacy partsentry_logs projection: approved_by unavailable.');
    try {
      return withApprovalProvenance(await run(PARTSENTRY_LEGACY_SELECT), false);
    } catch (legacyError) {
      console.warn('Marketplace summary skipped partsentry_logs legacy projection:', legacyError.message);
      return [];
    }
  }
}

/**
 * Read-time fixture visibility control (Navigation Intelligence — Option A).
 * Production HIDES seed/demo/integration fixtures from the public marketplace by default. Set
 * MARKETPLACE_SHOW_FIXTURES=true (dev/test/demo only) to include them. Fixture detection reuses the
 * merged getFixtureExclusion() (synthetic/invalid VINs, seed owner_id, nil/default tenant_id).
 */
export function shouldShowFixtures(env = process.env) {
  const v = String(env?.MARKETPLACE_SHOW_FIXTURES ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Keep only public, non-fixture vehicles (fixtures retained only when showFixtures is true). */
export function filterVisibleVehicles(vehicles, { showFixtures } = {}) {
  const show = showFixtures ?? shouldShowFixtures();
  return (vehicles || [])
    .filter(vehicle => isPublicVehicleStatus(vehicle.status))
    .filter(vehicle => isPubliclyVisiblePublication(vehicle.publication_status))
    .filter(vehicle => show || getFixtureExclusion(vehicle) === null);
}

/** Columns selected for a marketplace listing. owner_id/tenant_id are fetched ONLY for fixture
 *  filtering + seller derivation and are NEVER echoed in the public summary. Registry identifiers
 *  (plate_number, normalized_plate_number, chassis_number — see PRIVATE_VEHICLE_FIELDS in
 *  utils/publicVehicleProjection.js) are not selected at all: no derivation here reads them, so the
 *  row that reaches every marketplace consumer cannot carry them. plate_status/plate_verified_at are
 *  status signals, not identifiers, and stay.
 *
 *  `trust_score` is absent for the same mechanical reason. The listing's trust number now comes
 *  from the canonical authority (see the header), so no derivation here reads the raw column — and
 *  because the row never carries it, no later edit can quietly restore the fallback that published
 *  a hand-set 84. A cached score reaches a listing ONLY through getCanonicalTrustBatch, which
 *  refuses to publish one that is not stamped with the running calculation_version. */
export const LISTING_SELECT_COLUMNS = `
      vin,
      owner_id,
      tenant_id,
      publication_status,
      make,
      model,
      year,
      mileage,
      fuel_type,
      transmission,
      import_source,
      duty_paid,
      police_verified,
      status,
      price,
      currency,
      created_at,
      plate_status,
      registration_country,
      plate_verified_at,
      current_seller_type,
      public_seller_display_enabled,
      vehicle_condition_category,
      passport_verified,
      zimra_verified,
      safe_pay_ready,
      inspection_ready,
      tenant:tenants(name, type, status)
    `;

/**
 * Fetch the evidence/partsentry/ownership/image rows for a set of VINs and return them grouped by VIN.
 * Shared by the list and detail paths so the trust pipeline reads identical inputs.
 */
export async function fetchListingRelatedRows(supabaseClient, vins = []) {
  const [evidenceRows, partSentryRows, ownershipRows, imageRows] = await Promise.all([
    maybeFetchRows(supabaseClient, 'vehicle_evidence', 'vin, verification_status, visibility_level', vins),
    // approved_by/mechanic_id are fetched ONLY for the in-memory self-approval guard; never echoed publicly.
    fetchPartSentryRows(supabaseClient, vins),
    maybeFetchRows(supabaseClient, 'vehicle_ownership_history', 'vin', vins),
    maybeFetchRows(supabaseClient, 'listing_images', 'vin, image_url, is_primary, display_order', vins, { column: 'display_order', ascending: true }),
  ]);
  return {
    evidenceByVin: toRecordMap(evidenceRows),
    partSentryByVin: toRecordMap(partSentryRows),
    ownershipByVin: toRecordMap(ownershipRows),
    imagesByVin: toRecordMap(imageRows),
  };
}

export async function listMarketplaceListings(supabaseClient, params = {}) {
  const limit = safeLimit(params.limit);
  const minPrice = params.minPrice !== undefined ? numericValue(params.minPrice) : null;
  const maxPrice = params.maxPrice !== undefined ? numericValue(params.maxPrice) : null;

  // QA Round 4: ONE mutually-exclusive condition/category + MANY stackable trust tags (AND).
  const requestedTags = parseTagList(params.tag);
  const categorySlug = normalizeTag(params.category);
  // Condition comes from explicit `condition`, else from `category` when it names a real condition.
  const requestedCondition = (() => {
    const explicit = normalizeTag(params.condition);
    if (explicit && CONDITION_CATEGORIES.includes(explicit)) return explicit;
    if (categorySlug && CONDITION_CATEGORIES.includes(categorySlug)) return categorySlug;
    return '';
  })();
  // Backward-compat: a legacy `category=<trust-slug>` folds into the AND tag list.
  if (categorySlug && !CONDITION_CATEGORIES.includes(categorySlug)
    && MARKETPLACE_TAGS.includes(categorySlug) && !requestedTags.includes(categorySlug)) {
    requestedTags.push(categorySlug);
  }

  let query = supabaseClient
    .from('vehicles')
    .select(LISTING_SELECT_COLUMNS);

  if (params.make) query = query.eq('make', params.make);
  if (minPrice !== null) query = query.gte('price', minPrice);
  if (maxPrice !== null) query = query.lte('price', maxPrice);
  if (requestedCondition && CONDITION_CATEGORIES.includes(requestedCondition)) {
    query = query.eq('vehicle_condition_category', requestedCondition);
  }

  const { data: vehicles, error } = await query;
  if (error) throw error;

  const publicVehicles = filterVisibleVehicles(vehicles);
  const vins = publicVehicles.map(vehicle => vehicle.vin).filter(Boolean);
  const [related, trustByVin] = await Promise.all([
    fetchListingRelatedRows(supabaseClient, vins),
    // ONE cache-only query for the whole page — a 48-card list costs 1 read and 0 recomputes.
    fetchCanonicalTrustByVin(supabaseClient, vins),
  ]);
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } = related;

  const summaries = publicVehicles.map(vehicle => buildMarketplaceListingSummary({
    vehicle,
    evidenceRows: evidenceByVin.get(vehicle.vin) || [],
    partSentryRows: partSentryByVin.get(vehicle.vin) || [],
    ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
    imageRows: imagesByVin.get(vehicle.vin) || [],
    canonicalTrust: trustByVin.get(vehicle.vin) || null,
  }));

  const filtered = summaries
    .filter(summary => summaryMatchesSearch(summary, params.q))
    .filter(summary => summaryMatchesCondition(summary, requestedCondition))
    .filter(summary => summaryMatchesTags(summary, requestedTags));

  const sorted = sortSummaries(filtered, params.sort);

  return {
    listings: sorted.slice(0, limit),
    total: filtered.length,
    limit,
    // The ordering describes itself, so "first card" is never mistaken for "most trusted".
    ranking: describeTrustRanking(filtered, params.sort),
  };
}

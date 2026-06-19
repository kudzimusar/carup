import { isPublicVehicleStatus } from '../../utils/vehicleStatus.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';

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

export function buildMarketplaceListingSummary({
  vehicle,
  evidenceRows = [],
  partSentryRows = [],
  ownershipCount = 0,
  imageRows = [],
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
    trust_score: numericValue(vehicle.trust_score),
    primary_image_url: primaryImage,
    plate_number: vehicle.plate_number || null,
    normalized_plate_number: vehicle.normalized_plate_number || null,
    chassis_number: vehicle.chassis_number || null,
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

function summaryMatchesSearch(summary, query) {
  if (!query) return true;
  const normalized = normalizeText(query);
  const haystack = [
    summary.vin,
    summary.plate_number,
    summary.normalized_plate_number,
    summary.chassis_number,
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

function sortSummaries(summaries, sort) {
  const copy = [...summaries];
  switch (sort) {
    case 'price-low':
      return copy.sort((a, b) => a.price - b.price);
    case 'price-high':
      return copy.sort((a, b) => b.price - a.price);
    case 'trust':
      return copy.sort((a, b) => b.trust_score - a.trust_score);
    case 'newest':
    default:
      return copy.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));
  }
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
    .filter(vehicle => show || getFixtureExclusion(vehicle) === null);
}

/** Columns selected for a marketplace listing. owner_id/tenant_id are fetched ONLY for fixture
 *  filtering + seller derivation and are NEVER echoed in the public summary. */
export const LISTING_SELECT_COLUMNS = `
      vin,
      owner_id,
      tenant_id,
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
      trust_score,
      price,
      currency,
      created_at,
      plate_number,
      normalized_plate_number,
      plate_status,
      chassis_number,
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
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } =
    await fetchListingRelatedRows(supabaseClient, vins);

  const summaries = publicVehicles.map(vehicle => buildMarketplaceListingSummary({
    vehicle,
    evidenceRows: evidenceByVin.get(vehicle.vin) || [],
    partSentryRows: partSentryByVin.get(vehicle.vin) || [],
    ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
    imageRows: imagesByVin.get(vehicle.vin) || [],
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
  };
}

import { isPublicVehicleStatus, isPubliclyVisiblePublication } from '../../utils/vehicleStatus.js';
import {
  FIELD_STATES,
  LISTING_CLAIM_COLUMNS,
  attestedValue,
  isMissingListingClaimColumnError,
  isRecordedValue,
  toListingClaims,
  toRegistrationClaim,
  toSellerClaim,
} from '../../utils/publicVehicleProjection.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';
import { resolveBodyStyle, resolveColor, resolveFuelType, resolveTransmission, resolveVehicleMake, resolveVehicleModel, resolveVehicleYear } from '../taxonomy/vehicleTaxonomyService.js';
/**
 * THE ONE DEFINITION OF "A PUBLISHABLE LISTING PHOTO" — Issue #164 Phase 5 convergence.
 *
 * This module used to hold a second one. `primary_image_url` was elected by
 * `[...imageRows].sort(...)[0]?.image_url || null`, which asks only whether the column is
 * TRUTHY. Measured before the change, feeding four rows whose `image_url` values were
 * `data:image/png;base64,AAAA`, `javascript:alert(1)`, `photo.jpg` and one real https URL
 * published `data:image/png;base64,AAAA` as the card's cover image — a string the canonical
 * contract classifies as unpublishable, on a key that `VehicleSearch.tsx:284`,
 * `SavedCars.tsx:85` and `MarketplaceCompare.tsx:89` put straight into an `<img src>` with no
 * re-classification of any kind (`ListingImage` branches on `src` being truthy — that is the
 * whole test it applies).
 *
 * So the marketplace held the PERMISSIVE definition of publishable and the canonical contract
 * held the strict one, on the same three rows of the same table. Two definitions is the defect
 * Issue #164 exists to eliminate, and it is not closed by making them agree today — it is closed
 * by there being only one function that decides.
 */
import { MEDIA_BLOCK_STATES, toListingMediaBlock } from '../../utils/vehicleMediaProjection.js';
import { projectCarUpGold } from './carUpGoldService.js';

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

/**
 * PUBLIC GOVERNMENT-APPROVAL CLAIMS WITH NO LEGITIMATE WRITER.
 *
 * `trustPermissionService` classifies `zimra_verified` and `cid_clear` as GOVERNMENT_APPROVAL_FACTS:
 * only a government authority may assert them. Measured over this repository, no authority ever does.
 *
 *   vehicles.duty_paid       — no writer sets it TRUE anywhere (server.js writes only `false`)
 *   vehicles.zimra_verified  — no writer at all, repo-wide
 *   vehicles.police_verified — written TRUE by exactly one place, securityService.js, where it
 *                              records "was reported stolen, then RECOVERED". Publishing that as
 *                              "Police (CID) clearance on record" inverts its meaning: the badge
 *                              claims a clean record on the strength of a theft report.
 *
 * So these tags could only ever have been true by accident. Until an authoritative source and a
 * provenance record exist, they are suppressed unconditionally — nothing true is lost, because
 * nothing in the platform can make them true.
 *
 * This is deliberately SUPPRESSION, not the full provenance gate. Restoring these badges requires
 * FACT_MODEL M4 — an authoritative source record satisfying the canonical public-claim gate. A
 * legacy boolean must never be sufficient to reactivate them on its own.
 */
export const UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS = Object.freeze([
  'duty_cleared',
  'zimra_verified',
  'cid_clear',
]);

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

/**
 * The card's condition category, or `'unknown'`.
 *
 * ── A CONDITION INFERRED FROM A FABRICATED DEFAULT IS ITSELF FABRICATED ──────────────────────
 * The `locally_used` branch below read `registration_country` as a bare column. That column carries
 * a DB DEFAULT of 'ZW' and, until this phase, /api/vehicles/add substituted 'ZW' for every
 * submission that omitted it — so 13 of 16 staging rows hold a country nobody stated. The branch
 * turned that substitute into a flat `condition_category` on every card AND into a human-readable
 * sentence on the detail page ("2019 Toyota Hilux — locally used"): one invented value, laundered
 * into a second one that no longer looks like a column at all.
 *
 * The branch now reads the CLAIM rather than the column. `toRegistrationClaim` publishes a country
 * only when the row carries both a value and a recognised `registration_country_source`, so an
 * inference can only be drawn from a country somebody actually asserted. When it was not asserted,
 * the claims block already reports `registration.country` as `not_recorded`, and this function must
 * agree with it — a card that says "locally used" beside a claim that says "we do not know where
 * this is registered" is the same body contradicting itself.
 *
 * Consequence, stated rather than hidden: `registration_country_source` does not exist on the table
 * until 20260818110000_issue164_listing_location_provenance.sql is applied AND
 * LISTING_SELECT_COLUMNS is widened to fetch it, so today this branch never fires and those rows
 * publish `unknown`. `unknown` is the honest reading of a value with no author. `buildShortDescription`
 * already drops the phrase for `unknown`, so the sentence loses the clause rather than gaining a lie.
 *
 * The `import_source` branch is deliberately untouched: it fires only for a NON-local source, which
 * is never what the write path substituted, so no fabricated default can reach it.
 */
export function deriveConditionCategory(vehicle = {}) {
  const explicit = normalizeTag(vehicle.vehicle_condition_category || vehicle.condition_category);
  if (CONDITION_CATEGORIES.includes(explicit)) return explicit;

  const condition = normalizeText(vehicle.condition);
  const sellerType = normalizeText(vehicle.current_seller_type || vehicle.seller_type || vehicle.sellerType);
  const importSource = normalizeText(vehicle.import_source);
  // The country as the canonical claim contract publishes it — provenance-gated — never the raw
  // column. `''` on every non-recorded state, which matches no branch below.
  const registrationCountryClaim = toRegistrationClaim(vehicle).country;
  const registrationCountry = registrationCountryClaim.state === FIELD_STATES.RECORDED
    ? normalizeText(registrationCountryClaim.value)
    : '';

  if (condition === 'new' || condition === 'brand new') return 'brand_new';
  if (condition.includes('certified') || sellerType.includes('certified')) return 'certified_dealer';
  if (condition === 'used' || condition.includes('second')) return 'second_hand';
  if (importSource && importSource !== 'local') return 'recently_imported';
  if (registrationCountry === 'zw' || registrationCountry === 'zimbabwe') return 'locally_used';
  return 'unknown';
}

/**
 * THE SELLER TYPE IS A RECORDED FACT, NOT AN INFERENCE FROM A JOIN.
 *
 * The rule this replaces was `sellerType.includes('dealer') || Boolean(tenantName)`, so ANY listing
 * whose row joined a `tenants` record was published as a dealer sale regardless of what
 * `current_seller_type` said. A tenant link means an organisation exists on the row, not that this
 * particular car is being sold by a dealership.
 *
 * The other half of that rule was worse: everything not classified a dealer fell through to the
 * `private` branch, so a listing with NO recorded seller type was published as a private sale.
 * There is now a third outcome — `null`, "we have not recorded what kind of seller this is" — and
 * it is the outcome for an absent value and for any value outside the recognised vocabulary.
 *
 * ── ONE BODY, ONE ANSWER (Issue #164 Phase 4 enforceability pass) ────────────────────────────
 * This function USED TO READ THE COLUMN UNGATED, on the reasoning that the marketplace tag
 * vocabulary (`dealer_verified` / `private_sale`) was not this phase's to change. That reasoning
 * confused the VOCABULARY with the EVIDENCE for using it. The result was a card that answered the
 * same question twice and differently in one response body:
 *
 *     seller_type:              "private"                                  <- this function
 *     claims.seller.seller_type {value: null, state: "not_recorded"}       <- the governed claim
 *     marketplace_tags:         [..., "private_sale"]                      <- derived from this one
 *
 * A consumer reading the wrong one cannot even tell it disagreed with the other, and `private_sale`
 * printed on a card is not a smaller assertion than the flat field — it is the same assertion in a
 * badge. Measured: 13 of 16 staging rows hold the column DEFAULT 'Private Owner' (3 hold the
 * writer's 'private' slug), so for most listings the badge said "private sale" on the DDL's say-so.
 *
 * It now reads the SAME leaf the body publishes — `toSellerClaim(...).seller_type`, provenance-gated
 * — so there is exactly one answer and the tags follow it. `null` is returned for an unprovenanced
 * value, and a listing that earns no seller-type claim earns neither seller-type tag. The tag
 * vocabulary is genuinely untouched: no tag was added, removed or renamed, and the three genuine
 * 'private' slugs publish again the moment `current_seller_type_source` is written for them.
 *
 * Deliberately routed through `toSellerClaim` rather than re-deriving with `attestedValue` here: if
 * the contract's gating ever changes, this must change with it rather than drift into a second,
 * quieter rule for the same fact.
 *
 * @param {object} vehicle raw row
 * @param {{value: *, state: string, source: string|null}|null} [sellerTypeClaim] the already-built
 *   `claims.seller.seller_type` leaf, when the caller has one — same value, computed once.
 */
export function recordedSellerType(vehicle = {}, sellerTypeClaim = null) {
  const claim = sellerTypeClaim ?? toSellerClaim(vehicle).seller_type;
  if (claim.state !== FIELD_STATES.RECORDED) return null;
  const declared = normalizeText(claim.value);
  if (declared.includes('dealer')) return 'dealer';
  if (declared.includes('private') || declared.includes('owner')) return 'private';
  return null;
}

/**
 * The listing's currency as a provenance-gated claim: `{value, state, source}`.
 *
 * ── THE FABRICATION THAT MOVED FROM THE APPLICATION INTO THE SCHEMA ──────────────────────────
 * `currency || 'USD'` was deleted from this file and from the write path, which looked like a
 * closure and was not: `public.vehicles.currency` carries its own DB DEFAULT, so the value went on
 * being manufactured one layer down where no code review would ever see it again. Measured on
 * staging: currency = 'USD' on 16 of 16 rows, one distinct value, zero NULLs — the exact signature
 * §1 of the contract names, and the same one that convicted `registration_authority` and
 * `plate_status`. Deleting the app-level substitution while the DEFAULT stood simply changed WHO
 * was doing the inventing.
 *
 * So currency gets the treatment registration already has: a value is a claim only when something
 * recorded who asserted it. No `currency_source`, no published currency — whatever the column
 * holds. This is NOT a shape test: 'USD' is not rejected for being the default's value (§1 forbids
 * exactly that reasoning, and a seller who genuinely trades in USD must be able to say so). It is
 * rejected for having no author.
 *
 * `price` is deliberately NOT gated the same way, and the asymmetry is the point rather than an
 * oversight: `price` has no DB default and is written from the submitted body on every insert
 * (`/api/vehicles/add` 400s without it), so a price in the column IS an application-recorded fact.
 * Currency was the one half of the pair the database was answering for.
 *
 * TODAY THIS REPORTS `not_recorded` FOR EVERY ROW, exactly as `claims.registration.*` does, because
 * `currency_source` does not exist yet. Closing it end-to-end needs three changes in files this lane
 * does not own — see the note on LISTING_SELECT_COLUMNS below.
 */
export function currencyClaim(vehicle = {}) {
  return attestedValue(vehicle.currency, vehicle.currency_source);
}

/**
 * The seller's OWN published name, or null. `tenant.name` is the only name this read path resolves —
 * there is no join to a private seller's profile — so a private listing has no name to publish and
 * does NOT acquire a category label in its place.
 */
function publishedSellerName(vehicle = {}) {
  const name = vehicle.tenant?.name ?? vehicle.tenant_name ?? null;
  return isRecordedValue(name) ? String(name).trim() : null;
}

/**
 * The row handed to the canonical claim contract.
 *
 * `toSellerClaim` decides a seller is LINKED by looking at `current_seller_id`, which is the
 * passport's column: /api/vehicles/add has never written it and LISTING_SELECT_COLUMNS does not
 * fetch it (it is in PRIVATE_VEHICLE_FIELDS). On this surface the seller link is `owner_id` or
 * `tenant_id`, which the query already fetches for fixture filtering. Only the BOOLEAN crosses over
 * — `relationship` publishes `true`, never an id — and neither id is echoed in the summary.
 */
function toClaimRow(vehicle = {}) {
  const sellerLinked = isRecordedValue(vehicle.owner_id) || isRecordedValue(vehicle.tenant_id);
  return { ...vehicle, current_seller_id: sellerLinked || null };
}

/**
 * The canonical listing claim contract for one marketplace row (utils/publicVehicleProjection.js).
 *
 * `publishedContactChannels` is deliberately left unresolved, so `seller.contact_channel` is
 * `not_recorded`: this path resolves no contact channels at all, and Phase 0 removed a fabricated
 * phone number from a surface that had invented one to fill exactly this gap.
 *
 * NOTE FOR THE CONVERGENCE STAGE: `location` reads `listing_city` / `listing_province` /
 * `listing_country` / `listing_location_source` / `listing_location_visibility`, which
 * 20260818110000_issue164_listing_location_provenance.sql adds and which LISTING_SELECT_COLUMNS
 * therefore does NOT yet fetch — PostgREST fails an entire select on a column the table does not
 * have, so widening this query before the migration is applied would take the public marketplace
 * down. Until then every listing honestly reports its location as `not_recorded`. Add
 * LISTING_CLAIM_COLUMNS to LISTING_SELECT_COLUMNS in the same change that applies the migration;
 * nothing else here has to move.
 */
export function listingClaimsForVehicle(vehicle = {}) {
  return toListingClaims(toClaimRow(vehicle), { sellerDisplayName: publishedSellerName(vehicle) });
}

/**
 * The flat seller fields the marketplace card and detail payloads carry.
 *
 * `seller_display_label` is the seller's own published name or NULL — never 'Verified dealer'
 * (dealer registration is not verification, as Marketplace.tsx:141 already says in its own comment)
 * and never a generic private-seller label. `seller_display_label_state` says WHY it is null, so a
 * consumer can tell "this seller has not published a name" from "a name exists and is withheld"
 * without either answer being invented for it.
 */
export function sellerSummaryForVehicle(vehicle = {}, claims = null) {
  const seller = (claims ?? listingClaimsForVehicle(vehicle)).seller;
  return {
    // The SAME leaf `claims.seller.seller_type` publishes, collapsed to the card's dealer/private
    // vocabulary — never a second, ungated reading of the column beside it. See recordedSellerType.
    seller_type: recordedSellerType(vehicle, seller.seller_type),
    seller_type_state: seller.seller_type.state,
    seller_display_label: seller.display_label.value,
    seller_display_label_state: seller.display_label.state,
    // `=== true`, not a coercion: a string, a 1 or an absent flag is not a seller's consent to be
    // named, and a coercing read of a consent flag is how a listing publishes a name nobody agreed to.
    seller_public_profile_enabled: vehicle.public_seller_display_enabled === true,
  };
}

/**
 * The one-line location a card prints, assembled from the RECORDED parts only, or null.
 *
 * There is no fallback: not the registration country, not the seller's profile, not a country
 * literal. A listing with a recorded city and an unrecorded country reads "Harare" and stops there,
 * which is the whole of what is known.
 */
export function composeLocationLabel(locationClaim) {
  const parts = [locationClaim?.city, locationClaim?.province, locationClaim?.country]
    .filter(leaf => leaf?.state === FIELD_STATES.RECORDED)
    .map(leaf => String(leaf.value).trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * One state for the composed location line. `withheld` outranks `not_recorded` for the same reason
 * it does on a single field: collapsing them would make "we hold nothing" and "you may not see it"
 * render identically, and absence would start reading as proof.
 */
export function deriveLocationState(locationClaim) {
  const leaves = [locationClaim?.city, locationClaim?.province, locationClaim?.country];
  if (leaves.some(leaf => leaf?.state === FIELD_STATES.RECORDED)) return FIELD_STATES.RECORDED;
  if (leaves.some(leaf => leaf?.state === FIELD_STATES.WITHHELD)) return FIELD_STATES.WITHHELD;
  return FIELD_STATES.NOT_RECORDED;
}

/** A column value as a number, or null. `0` is a number; `''`, whitespace and NaN are not values. */
function recordedNumber(value) {
  if (!isRecordedValue(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// `recordedText()` lived here: "a column value as trimmed text, or null". It was removed rather
// than left unused, because it is the shape of the defect this pass closed. Its two callers were
// `currency` and `plate_status`, and in both places it did exactly what it said — it proved the
// column was non-blank and published it as a fact. Non-blank is not provenance. Every remaining
// governed text field on this summary comes from `attestedValue`/the claim contract, and leaving a
// convenience helper here that turns any column into a published string is an invitation to route
// the next one around that contract.

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
  // The tag vocabulary is not this phase's to change, so `dealer_verified` / `private_sale` still
  // follow the recorded seller type — but that is now the PROVENANCE-GATED claim, so a listing
  // whose seller type nobody asserted earns NEITHER tag. Previously it fell through to
  // `private_sale` on the strength of a column DEFAULT, which published "private sale" as a fact
  // on the card while `claims.seller.seller_type` in the same body reported not_recorded.
  const sellerType = recordedSellerType(vehicle);
  const mileage = numericValue(vehicle?.mileage);
  // `plate_status` read as a bare column here for the same reason it was published bare on the
  // card. The DEFAULT is 'Active' rather than 'verified' so this branch never fired FROM the
  // default — but "the fabricated value happens not to match my comparison" is luck, not a gate,
  // and it would stop being true the day the default changed. The claim is the gate.
  const plateStatusClaim = toRegistrationClaim(vehicle).plate_status;
  const attestedPlateStatus = plateStatusClaim.state === FIELD_STATES.RECORDED
    ? normalizeText(plateStatusClaim.value)
    : '';

  if (boolValue(vehicle?.passport_verified)) tags.add('passport_verified');
  // `plate_verified_at` is a timestamp the verification path writes, so it is its own provenance;
  // the status string is only believed once something says who asserted it.
  if (vehicle?.plate_verified_at || attestedPlateStatus === 'verified') tags.add('plate_verified');
  if (evidenceSummary.evidence_count > 0) tags.add('evidence_available');

  // GOVERNMENT-APPROVAL TAGS ARE SUPPRESSED. See UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS below.
  //
  //   duty_cleared   <- vehicles.duty_paid
  //   zimra_verified <- vehicles.zimra_verified
  //   cid_clear      <- vehicles.police_verified
  //
  // These three lines used to read the raw column with `boolValue(...)`, ungated, sitting between
  // neighbours that ARE provenance-gated (`plate_verified` above; `dealer_verified`/`private_sale`
  // below). The physical UAT caught the consequence: a public card rendered "Zimra Verified" while
  // the SAME response's canonical trust block said the flag "is not supported by any authoritative
  // record and is not published".
  //
  // They are not gated on provenance here because there is no provenance to gate on — see the
  // constant's comment for why suppression, not plumbing, is the correct step now.
  if (mileage > 0 && mileage <= 50000) tags.add('low_mileage');
  if (conditionCategory === 'recently_imported') tags.add('fresh_import');
  if (ownershipCount === 1 || boolValue(vehicle?.one_owner)) tags.add('one_owner');
  if (sellerType === 'dealer') tags.add('dealer_verified');
  if (sellerType === 'private') tags.add('private_sale');
  if (boolValue(vehicle?.safe_pay_ready)) tags.add('safe_pay_ready');
  if (boolValue(vehicle?.inspection_ready)) tags.add('inspection_ready');
  if (partSentrySummary.recent_service) tags.add('recent_service');
  if (partSentrySummary.partsentry_checked) tags.add('partsentry_checked');
  if (partSentrySummary.repair_history_count > 0) tags.add('repair_history_available');
  if (partSentrySummary.verified_parts_count > 0) tags.add('verified_parts');

  // Fail-closed belt-and-braces: even if a future edit re-adds one of the three above, it cannot
  // reach a public surface through this function.
  return Array.from(tags)
    .filter(tag => MARKETPLACE_TAGS.includes(tag))
    .filter(tag => !UNSUPPORTED_GOVERNMENT_APPROVAL_TAGS.includes(tag));
}

/**
 * The card's cover image, and the state that says WHERE IT CAME FROM.
 *
 * Sourced from `toListingMediaBlock` — the one definition — so a value the canonical contract will
 * not publish can no longer reach a card. The ELECTION is unchanged: the canonical block already
 * sorts primary-claimants first, then by `display_order`, then by input order, so `items[0]` is the
 * same row `[...imageRows].sort(...)[0]` used to pick. Only the publishability gate is new.
 *
 * `primary_image_state` exists because the KEY NAME asserts something the data often cannot
 * support. Verified on the shipped code before this change: with two rows neither of which claims
 * `is_primary`, `primary_image_url` was still the lower-`display_order` one — a "primary" nobody
 * chose. Rule 6 says primacy is the seller's choice or it does not exist. Deleting the key would
 * blank every card that has photos but no primary claim, so the fact is not withdrawn — it is
 * LABELLED, in the `*_state` idiom Phase 4 established for `location` and `currency`:
 *
 *   `seller_primary`  — a row claims `is_primary`. This is the seller's own choice.
 *   `first_published` — nobody claimed primacy; this is merely the first publishable photo in
 *                       display order. A consumer must not describe it as the seller's main photo.
 *   `none`            — the source was consulted and holds nothing publishable.
 *   `not_loaded`      — the source was NOT consulted (Rule 1). `primary_image_url` is null here for
 *                       the same reason it is null under `none`, and the two are different facts.
 *
 * `primary_image_unpublishable_count` keeps `none` honest: without it, "three photos we could not
 * render" and "the seller added none" would both read as `none` with a null URL — which is Rule 5's
 * silent drop, one layer up from where it was found.
 */
function electPrimaryImage(imageRows) {
  const block = toListingMediaBlock(imageRows);
  const first = block.items[0] ?? null;
  const state = block.state === MEDIA_BLOCK_STATES.NOT_LOADED ? 'not_loaded'
    : first === null ? 'none'
      : first.is_primary ? 'seller_primary'
        : 'first_published';
  return {
    primary_image_url: first?.url ?? null,
    primary_image_state: state,
    primary_image_unpublishable_count: block.unpublishable_count,
  };
}

/**
 * @param {object} args
 * @param {object|null} [args.canonicalTrust] the VIN's entry from `fetchCanonicalTrustByVin()` — the
 *   10-field public trust projection. `null` means the caller did not consult the authority on this
 *   path, which publishes `trust: null` + `trust_score: null`: no number, and no pretence that the
 *   absence of one was a finding about the vehicle. There is deliberately no fallback branch that
 *   reads `vehicle.trust_score`.
 * @param {Array<object>|null} [args.imageRows] raw `listing_images` rows. THE DEFAULT IS `null`, NOT
 *   `[]`, and the difference is Rule 1: a caller that passes no rows did not consult
 *   `listing_images`, and a path that never looked may not publish a negative about what it would
 *   have found. `[]` means the caller looked and the vehicle has none. Both produce
 *   `primary_image_url: null`; only `primary_image_state` tells them apart.
 */
export function buildMarketplaceListingSummary({
  vehicle,
  evidenceRows = [],
  partSentryRows = [],
  ownershipCount = 0,
  imageRows = null,
  canonicalTrust = null,
}) {
  const claims = listingClaimsForVehicle(vehicle);
  const currency = currencyClaim(vehicle);
  const conditionCategory = deriveConditionCategory(vehicle);
  const evidenceSummary = summarizeEvidence(evidenceRows);
  const partSentrySummary = summarizePartSentry(partSentryRows);
  const seller = sellerSummaryForVehicle(vehicle, claims);
  const marketplaceTags = deriveMarketplaceTags(vehicle, evidenceSummary, partSentrySummary, ownershipCount);
  const primaryImage = electPrimaryImage(imageRows);

  return {
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    color: isRecordedValue(vehicle.color) ? String(vehicle.color).trim() : null,
    // EVERY BUSINESS FACT BELOW IS THE COLUMN OR IT IS NULL. `numericValue(x, 0)` published a
    // fabricated 0 for an unrecorded year, price and odometer — a $0, 0 km, year-0 listing that a
    // shopper cannot tell from a real one — and `|| 'USD'` / `|| 'Available'` stated a currency and
    // a sale status the row never held. A genuine 0 survives: `isRecordedValue(0)` is true.
    year: recordedNumber(vehicle.year),
    price: recordedNumber(vehicle.price),
    // PROVENANCE-GATED, not merely non-blank. `recordedText(vehicle.currency)` published the column
    // verbatim, and that column is filled by a DB DEFAULT on 16 of 16 staging rows — so removing
    // `|| 'USD'` from this line and from the write path moved the fabrication into the schema
    // instead of ending it. `currency_source` is carried alongside so a consumer (and the pricing
    // estimator below) can re-derive the same claim rather than trust a flattened state.
    currency: currency.value,
    currency_state: currency.state,
    currency_source: currency.source,
    mileage: claims.specification.mileage.value,
    fuel_type: claims.specification.fuel_type.value,
    transmission: claims.specification.transmission.value,
    drivetrain: claims.specification.drivetrain.value,
    // Seller-stated commercial facts are deliberately separate from governed condition_category.
    body_style: isRecordedValue(vehicle.body_style) ? String(vehicle.body_style).trim() : null,
    seller_stated_condition: isRecordedValue(vehicle.seller_stated_condition) ? String(vehicle.seller_stated_condition).trim() : null,
    seller_description: isRecordedValue(vehicle.seller_description) ? String(vehicle.seller_description).trim() : null,
    seller_features: Array.isArray(vehicle.seller_features) ? vehicle.seller_features.filter(isRecordedValue).map(value => String(value).trim()) : [],
    taxonomy_version: isRecordedValue(vehicle.taxonomy_version) ? String(vehicle.taxonomy_version).trim() : null,
    make_taxon_id: isRecordedValue(vehicle.make_taxon_id) ? String(vehicle.make_taxon_id).trim() : null,
    model_taxon_id: isRecordedValue(vehicle.model_taxon_id) ? String(vehicle.model_taxon_id).trim() : null,
    color_taxon_id: isRecordedValue(vehicle.color_taxon_id) ? String(vehicle.color_taxon_id).trim() : null,
    fuel_taxon_id: isRecordedValue(vehicle.fuel_taxon_id) ? String(vehicle.fuel_taxon_id).trim() : null,
    transmission_taxon_id: isRecordedValue(vehicle.transmission_taxon_id) ? String(vehicle.transmission_taxon_id).trim() : null,
    drivetrain_taxon_id: isRecordedValue(vehicle.drivetrain_taxon_id) ? String(vehicle.drivetrain_taxon_id).trim() : null,
    body_style_taxon_id: isRecordedValue(vehicle.body_style_taxon_id) ? String(vehicle.body_style_taxon_id).trim() : null,
    status: claims.publication.listing_status.value,
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
    // A premium tier is a backend-governed qualification, not a frontend score colour.
    // It deliberately remains null for today's low-confidence staging population.
    carup_gold: projectCarUpGold(canonicalTrust),
    // Same key, same election, ONE definition of publishable — plus the two facts that keep it
    // honest. See `electPrimaryImage`.
    ...primaryImage,
    plate_verified: marketplaceTags.includes('plate_verified'),
    // ── PUBLISH THE GOVERNED CLAIM, OR WITHHOLD — NOT BOTH ────────────────────────────────────
    // This line was `recordedText(vehicle.plate_status)`: the raw column, kept because
    // issue164-phase0-public-projection.test.js:873 pins it as publishable. Keeping it made the
    // card answer one question twice —
    //     plate_status:                      "Active"                              (this key)
    //     claims.registration.plate_status   {value: null, state: "not_recorded"}  (same body)
    // — and the comment justifying it recorded the contradiction rather than resolving it. Being
    // "non-identifying" is a privacy property; it is not provenance, and it was never the reason
    // the other three registration columns were withdrawn. Measured: 'Active' on 16 of 16 staging
    // rows, one distinct value, ZERO application writers — the DDL is the only thing that has ever
    // said a plate is active.
    //
    // It is now the same leaf, so the two can no longer disagree, and `plate_status_state` says
    // WHY it is null. FLAGGED FOR THE TEST LANE: this contradicts that assertion by construction —
    // it is not weakened here, it is reported. `LISTING_SELECT_COLUMNS` still fetches the column
    // (the assertion at :853 covers that, and the trust tags still consult the claim built from it).
    plate_status: claims.registration.plate_status.value,
    plate_status_state: claims.registration.plate_status.state,
    passport_verified: marketplaceTags.includes('passport_verified'),
    evidence_count: evidenceSummary.evidence_count,
    partsentry_checked: partSentrySummary.partsentry_checked,
    repair_history_count: partSentrySummary.repair_history_count,
    verified_parts_count: partSentrySummary.verified_parts_count,
    // The SECOND publication route for the same three claims. Suppressing only the tag array would
    // have left the assertion reachable here, where consumers derive their own badge labels from it.
    // Reported as `false` rather than removed: the keys are part of the published shape, and a
    // missing key would read as "unknown" when the honest answer is "CarUp does not assert this".
    duty_cleared: false,
    zimra_verified: false,
    cid_clear: false,
    seller_type: seller.seller_type,
    seller_type_state: seller.seller_type_state,
    seller_display_label: seller.seller_display_label,
    seller_display_label_state: seller.seller_display_label_state,
    seller_public_profile_enabled: seller.seller_public_profile_enabled,
    // `location: 'Zimbabwe'` was a literal on every card. There is no location column on the
    // vehicle for it to have gone stale from — the string was printed because /api/vehicles/add
    // accepted `location`/`province` from the seller and had nowhere to put them. Both ends are
    // closed now: the write path records them with their provenance, and this reads what was
    // recorded or says, in a state a consumer can branch on, that nothing was.
    location: composeLocationLabel(claims.location),
    location_state: deriveLocationState(claims.location),
    // The canonical listing claim contract, verbatim. Every leaf is a {value, state[, source]}
    // pair, so a consumer can tell a fact from an absence from a withholding without any surface
    // having to guess — and a governed value can no longer reach a card as a bare string.
    claims,
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
    summary.year,
    summary.color,
    summary.condition_category,
    summary.body_style,
    summary.seller_stated_condition,
    summary.seller_description,
    ...(summary.seller_features || []),
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

/** Exact-match a canonical public text facet. Missing values never match. */
export function summaryMatchesTextFacet(summary, value, field) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const actual = summary?.[field];
  if (!isRecordedValue(actual)) return false;
  return normalizeText(actual) === normalizeText(value);
}

export function summaryMatchesColorFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const wanted = resolveColor(value);
  const actual = resolveColor(summary?.color);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.color) === normalizeText(value);
}

export function summaryMatchesMakeFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const wanted = resolveVehicleMake(value);
  const actual = resolveVehicleMake(summary?.make);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.make) === normalizeText(value);
}

export function summaryMatchesModelFacet(summary, value, requestedMake = null) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const makeContext = requestedMake || summary?.make;
  const wanted = resolveVehicleModel(makeContext, value);
  const actual = resolveVehicleModel(summary?.make, summary?.model);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.model) === normalizeText(value);
}

export function summaryMatchesFuelFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const wanted = resolveFuelType(value);
  const actual = resolveFuelType(summary?.fuel_type);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.fuel_type) === normalizeText(value);
}

export function summaryMatchesTransmissionFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const wanted = resolveTransmission(value);
  const actual = resolveTransmission(summary?.transmission);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.transmission) === normalizeText(value);
}

export function summaryMatchesBodyStyleFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  const wanted = resolveBodyStyle(value);
  const actual = resolveBodyStyle(summary?.body_style);
  if (wanted.canonical_id && actual.canonical_id) return wanted.canonical_id === actual.canonical_id;
  return normalizeText(summary?.body_style) === normalizeText(value);
}

/**
 * Location is provenance-gated. Match only recorded canonical location leaves, never a
 * raw registration/seller fallback. A composed full label may also match exactly.
 */
export function summaryMatchesLocationFacet(summary, value) {
  if (value === undefined || value === null || normalizeText(value) === '' || normalizeText(value) === 'all') return true;
  if (summary?.location_state !== FIELD_STATES.RECORDED) return false;
  const wanted = normalizeText(value);
  if (normalizeText(summary?.location) === wanted) return true;
  const leaves = Object.values(summary?.claims?.location || {});
  return leaves.some(leaf => leaf?.state === FIELD_STATES.RECORDED && normalizeText(leaf?.value) === wanted);
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
/**
 * A listing with no recorded price cannot be ordered by price. It is NOT ordered as zero — that is
 * the $0 fabrication reappearing in the sort comparator, where no surface prints it and every
 * shopper still sees its effect — and it is not dropped either: it follows every priced listing in
 * newest-first order, the same rule `sort=trust` already applies to an unscored listing.
 */
function comparePrice(a, b, direction) {
  const left = a.price;
  const right = b.price;
  if (left === null && right === null) return byNewest(a, b);
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

function sortSummaries(summaries, sort) {
  const copy = [...summaries];
  switch (sort) {
    case 'price-low':
      return copy.sort((a, b) => comparePrice(a, b, 1));
    case 'price-high':
      return copy.sort((a, b) => comparePrice(a, b, -1));
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
 *  refuses to publish one that is not stamped with the running calculation_version.
 *
 *  The listing LOCATION and PROVENANCE columns (LISTING_CLAIM_COLUMNS in
 *  utils/publicVehicleProjection.js) are absent for a mechanical reason, not an oversight: they do
 *  not exist on public.vehicles until 20260818110000_issue164_listing_location_provenance.sql is
 *  applied, and PostgREST fails an entire select when it names a column the table does not have.
 *  Widening this list before the migration lands would 500 every public marketplace read. Add them
 *  in the change that applies the migration — see listingClaimsForVehicle().
 *
 *  `currency_source` is absent for the same mechanical reason AND FOR ONE MORE: it does not exist
 *  even in the authored migration. `currencyClaim()` above gates on it, so today every listing
 *  publishes `currency_state: 'not_recorded'` — the honest reading of a column the DDL filled on
 *  16 of 16 rows. THREE CHANGES OUTSIDE THIS LANE CLOSE IT, and they must land together:
 *    1. 20260818110000_issue164_listing_location_provenance.sql — add `currency_source text` with
 *       the same CLAIM_SOURCES CHECK the other `*_source` columns get. The migration already drops
 *       `currency`'s DEFAULT (it is the sixth entry in `c_defaulted`), so the fabricating half is
 *       handled and only the attesting half is missing.
 *    2. utils/publicVehicleProjection.js — add `currency_source` to LISTING_CLAIM_COLUMNS, so the
 *       convergence stage moves it into the select with the other ten.
 *    3. backend/server.js `/api/vehicles/add` — write `currency_source: claimSource` beside the
 *       `currency` it already requires and stores verbatim. Without this, the endpoint 400s a
 *       submission that omits a currency, stores the one it is given, and then nothing can publish
 *       it: a genuinely stated currency would be permanently unpublishable, which is the
 *       under-reporting failure mode, not the fabricating one, but still a failure mode. */
/**
 * The ALWAYS-SAFE column set: every name here exists on `public.vehicles` in every environment.
 *
 * The twelve provenance columns the claim contract gates on (`LISTING_CLAIM_COLUMNS`) are NOT here,
 * because PostgREST fails an ENTIRE select when it names a column the table does not have — an
 * unknown name errors the whole request rather than yielding null for that one field. Naming them
 * unconditionally would take down every marketplace read on any database where
 * `20260818110000_issue164_listing_location_provenance.sql` has not yet been applied.
 *
 * `selectListingRows` below asks for them anyway and falls back to this set when the database says
 * they are missing — the same degrade the write path already performs in `/api/vehicles/add`. So a
 * migrated database publishes provenance-backed location/currency/seller-type/registration claims,
 * and an unmigrated one keeps serving cards instead of erroring.
 */
export const LISTING_SELECT_COLUMNS = `
      vin,
      owner_id,
      tenant_id,
      publication_status,
      make,
      model,
      year,
      color,
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
 * The same set PLUS the twelve provenance columns the claim contract gates on. Used first; if the
 * database has not had the listing-provenance migration applied, the read degrades to the narrow set.
 */
export const LISTING_SELECT_COLUMNS_WITH_CLAIMS = `${LISTING_SELECT_COLUMNS},
      ${LISTING_CLAIM_COLUMNS.join(',\n      ')}
    `;

export const SELLER_TAXONOMY_LISTING_COLUMNS = Object.freeze([
  'seller_description',
  'seller_features',
  'body_style',
  'seller_stated_condition',
  'make_taxon_id',
  'model_taxon_id',
  'color_taxon_id',
  'fuel_taxon_id',
  'transmission_taxon_id',
  'drivetrain_taxon_id',
  'body_style_taxon_id',
  'taxonomy_version',
]);

export const LISTING_SELECT_COLUMNS_WITH_SELLER_TAXONOMY = `${LISTING_SELECT_COLUMNS_WITH_CLAIMS},
      ${SELLER_TAXONOMY_LISTING_COLUMNS.join(',\n      ')}
    `;

function isMissingSchemaColumnError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  if (code === 'PGRST204' || code === '42703') return true;
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  return text.includes('could not find') || text.includes('does not exist') || text.includes('schema cache');
}

/**
 * Run a listing-row read that PREFERS provenance and degrades instead of failing.
 *
 * `shape(query)` receives a fresh `from('vehicles').select(...)` builder and applies the caller's
 * filters. A builder cannot be replayed, so the fallback re-shapes a new one. Callers never name
 * columns themselves — the canonical lists live here and only here.
 *
 * Why this exists: the claim contract publishes a location, currency, seller type or registration
 * fact only when the row also carries its `*_source`. Reading without those columns made the gate
 * withhold facts that ARE governed — every card showed `currency: null` and `location: null` even
 * where the governed write path had recorded both. Failing closed is right; failing closed because
 * the reader never looked is not. Asking for them unconditionally is equally wrong: PostgREST errors
 * the whole select on an unknown column, so on an unmigrated database that is an outage rather than
 * a degradation. Preferring them and falling back gives correct claims where the migration has
 * landed and working cards where it has not.
 */
export async function selectListingRows(client, shape = (query) => query) {
  // Prefer the complete Seller S0 + claim projection. During controlled migration, degrade one
  // schema generation at a time rather than taking Marketplace down or pretending new fields exist.
  const sellerWide = await shape(client.from('vehicles').select(LISTING_SELECT_COLUMNS_WITH_SELLER_TAXONOMY));
  if (!sellerWide?.error) return sellerWide;
  if (!isMissingSchemaColumnError(sellerWide.error)) return sellerWide;

  const claimsWide = await shape(client.from('vehicles').select(LISTING_SELECT_COLUMNS_WITH_CLAIMS));
  if (!claimsWide?.error) return claimsWide;
  if (isMissingListingClaimColumnError(claimsWide.error)) {
    return shape(client.from('vehicles').select(LISTING_SELECT_COLUMNS));
  }
  return claimsWide;
}



/**
 * The `listing_images` read, kept SEPARATE from `maybeFetchRows` because the two differ on the one
 * question Rule 1 turns on: DID WE LOOK.
 *
 * `maybeFetchRows` catches, warns and returns `[]`. For most callers that is a fine degradation; for
 * listing media it is the original defect. `[]` is a FINDING — "the seller added no photos" — and a
 * read that threw has found nothing of the sort. Returning `[]` there makes a failed query
 * indistinguishable from an empty table, which is exactly what "No verified images uploaded yet"
 * did one layer up.
 *
 * `ok: false` therefore propagates as `null` rows, which `toListingMediaBlock` renders as
 * `not_loaded` with `empty_statement: null` — nothing claimed in either direction.
 *
 * The select carries `id` because the projection publishes it as `media_id` (Rule 6b). Selecting
 * fewer columns than the projection publishes is a silent way to turn every row unpublishable, so
 * the convergence test asserts this string names `id`.
 */
async function readListingImages(supabaseClient, vins) {
  if (!vins.length) return { ok: true, rows: [] };
  try {
    const { data, error } = await supabaseClient
      .from('listing_images')
      .select('id, vin, image_url, is_primary, display_order')
      .in('vin', vins)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return { ok: true, rows: data || [] };
  } catch (error) {
    console.warn('Marketplace summary could not read listing_images:', error.message);
    return { ok: false, rows: null };
  }
}

/**
 * Fetch the evidence/partsentry/ownership/image rows for a set of VINs and return them grouped by VIN.
 * Shared by the list and detail paths so the trust pipeline reads identical inputs.
 *
 * `listingImagesRead` is the Rule 1 discriminator: `true` means `listing_images` was consulted (and
 * `imagesByVin` is a finding), `false` means the query did not resolve and NO negative about listing
 * media may be published from this result.
 */
export async function fetchListingRelatedRows(supabaseClient, vins = []) {
  const [evidenceRows, partSentryRows, ownershipRows, imageRead] = await Promise.all([
    maybeFetchRows(supabaseClient, 'vehicle_evidence', 'vin, verification_status, visibility_level', vins),
    // approved_by/mechanic_id are fetched ONLY for the in-memory self-approval guard; never echoed publicly.
    fetchPartSentryRows(supabaseClient, vins),
    maybeFetchRows(supabaseClient, 'vehicle_ownership_history', 'vin', vins),
    readListingImages(supabaseClient, vins),
  ]);
  return {
    evidenceByVin: toRecordMap(evidenceRows),
    partSentryByVin: toRecordMap(partSentryRows),
    ownershipByVin: toRecordMap(ownershipRows),
    imagesByVin: toRecordMap(imageRead.rows || []),
    listingImagesRead: imageRead.ok,
  };
}

/**
 * The listing-image rows for ONE vin, in the shape `toListingMediaBlock` takes: an array when the
 * read happened, `null` when it did not. Every marketplace caller goes through this so that "did we
 * look" is answered in one place rather than re-derived per call site.
 */
export function listingImageRowsForVin(related, vin) {
  if (!related || related.listingImagesRead === false) return null;
  return related.imagesByVin?.get(vin) || [];
}

export async function listMarketplaceListings(supabaseClient, params = {}) {
  const limit = safeLimit(params.limit);
  const minPrice = params.minPrice !== undefined ? numericValue(params.minPrice) : null;
  const maxPrice = params.maxPrice !== undefined ? numericValue(params.maxPrice) : null;
  const yearResolution = resolveVehicleYear(params.year);
  const validYear = yearResolution.state === 'canonical' ? yearResolution.canonical_year : null;

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

  // Provenance-preferred: build the same filtered query for whichever column set the database
  // supports, so claims are published where the migration has landed and cards still render where
  // it has not.
  const shapeListQuery = (query) => {
    let q = query;
    // Make/model aliases may exist on historical rows, so canonical filtering happens over the
    // full eligible population below. Year is numeric and safe to prefilter.
    if (validYear !== null) q = q.eq('year', validYear);
    if (params.color) q = q.eq('color', params.color);
    if (minPrice !== null) q = q.gte('price', minPrice);
    if (maxPrice !== null) q = q.lte('price', maxPrice);
    if (requestedCondition && CONDITION_CATEGORIES.includes(requestedCondition)) {
      q = q.eq('vehicle_condition_category', requestedCondition);
    }
    return q;
  };

  const { data: vehicles, error } = await selectListingRows(supabaseClient, shapeListQuery);
  if (error) throw error;

  const publicVehicles = filterVisibleVehicles(vehicles);
  const vins = publicVehicles.map(vehicle => vehicle.vin).filter(Boolean);
  const [related, trustByVin] = await Promise.all([
    fetchListingRelatedRows(supabaseClient, vins),
    // ONE cache-only query for the whole page — a 48-card list costs 1 read and 0 recomputes.
    fetchCanonicalTrustByVin(supabaseClient, vins),
  ]);
  const { evidenceByVin, partSentryByVin, ownershipByVin } = related;

  const summaries = publicVehicles.map(vehicle => buildMarketplaceListingSummary({
    vehicle,
    evidenceRows: evidenceByVin.get(vehicle.vin) || [],
    partSentryRows: partSentryByVin.get(vehicle.vin) || [],
    ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
    // `null` when the listing_images read did not resolve, so every card on the page says
    // `not_loaded` rather than each one announcing that its seller uploaded nothing.
    imageRows: listingImageRowsForVin(related, vehicle.vin),
    canonicalTrust: trustByVin.get(vehicle.vin) || null,
  }));

  // All buyer-facing facets operate on canonical public summaries BEFORE sort/limit. This avoids
  // the first-page bug where a valid vehicle outside the initial 48 could never be discovered.
  const filtered = summaries
    .filter(summary => summaryMatchesSearch(summary, params.q))
    .filter(summary => summaryMatchesMakeFacet(summary, params.make))
    .filter(summary => summaryMatchesModelFacet(summary, params.model, params.make))
    .filter(summary => validYear === null || summary.year === validYear)
    .filter(summary => summaryMatchesColorFacet(summary, params.color))
    .filter(summary => summaryMatchesBodyStyleFacet(summary, params.bodyStyle ?? params.body_style ?? params.body))
    .filter(summary => summaryMatchesCondition(summary, requestedCondition))
    .filter(summary => summaryMatchesTags(summary, requestedTags))
    .filter(summary => summaryMatchesLocationFacet(summary, params.location))
    .filter(summary => summaryMatchesFuelFacet(summary, params.fuel))
    .filter(summary => summaryMatchesTransmissionFacet(summary, params.transmission));

  const sorted = sortSummaries(filtered, params.sort);

  return {
    listings: sorted.slice(0, limit),
    total: filtered.length,
    limit,
    // The ordering describes itself, so "first card" is never mistaken for "most trusted".
    ranking: describeTrustRanking(filtered, params.sort),
  };
}

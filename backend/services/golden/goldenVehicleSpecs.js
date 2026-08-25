/**
 * Issue #164 Phase 7 — Golden Reference Vehicle Dataset: deterministic specifications.
 *
 * This module holds ONLY declarative, deterministic fixture data — no I/O, no service calls, no
 * derived conclusions. It is the single source of truth for WHAT the two Golden Vehicles are, so the
 * bootstrap (create), verify (assert) and cleanup (remove) operations all agree on identity, and so a
 * re-run is byte-for-byte the same set of rows.
 *
 * HARD Phase 7 invariants encoded here:
 *   · Every identifier is deterministic (no randomUUID, no Date.now) so bootstrap is idempotent and
 *     cleanup is exact.
 *   · Every record is unmistakably a CarUp Phase 7 synthetic test fixture: users carry the
 *     `@carup-staging.test` marker email, every fixture row that owns a metadata/jsonb column carries
 *     GOLDEN_MARKER, and every evidence/document asset is stamped SYNTHETIC_DOCUMENT_MARKER. No record
 *     impersonates ZRP / ZIMRA / ZINARA / VID / an insurer / a bank / a dealer / a registry / a real
 *     person — a synthetic record may MODEL those categories but is always marked test-only.
 *   · NO trust/verification CONCLUSION is declared here. Specs seed INPUTS and PROVENANCE only
 *     (identity fields, which documents exist, which are submitted for review). Whether a document
 *     ends up verified is a governed review decision the fixture performs through the real path, and
 *     the trust score is DERIVED by refreshCanonicalTrust — never written from this file.
 *
 * VIN constraint (marketplaceListingEligibility.isStructurallyValidVin): exactly 17 chars from
 * [A-HJ-NPR-Z0-9] (no I/O/Q) and NOT beginning with a synthetic prefix word (vin|test|demo|seed|
 * fixture|sample|mock|dummy). The VIN must therefore be structurally real; the fixture's synthetic
 * nature is carried by the marker email, metadata tag and document stamps above — not by a fake VIN.
 */

// ── Fixture-ownership markers ────────────────────────────────────────────────
export const GOLDEN_PROGRAMME = 'issue164-phase7-golden-vehicles';
export const GOLDEN_MARKER = 'CARUP_PHASE7_GOLDEN';
export const FIXTURE_EMAIL_DOMAIN = 'carup-staging.test';
export const SYNTHETIC_DOCUMENT_MARKER = 'CARUP SYNTHETIC TEST RECORD — PHASE 7 GOLDEN VEHICLE — NOT AN OFFICIAL DOCUMENT';

// A stable, human-legible metadata block stamped on every fixture-owned row that has a jsonb column.
export function goldenMetadata(extra = {}) {
  return { [GOLDEN_MARKER]: true, programme: GOLDEN_PROGRAMME, synthetic: true, ...extra };
}

const email = (id) => `${id}@${FIXTURE_EMAIL_DOMAIN}`;

// ── Synthetic identities (deterministic ids; users.id is TEXT) ────────────────
// Roles are validated by the runner against the real users role catalogue before any write.
export const GOLDEN_USERS = Object.freeze([
  { id: 'golden-a-owner-stg',    role: 'owner',      name: 'Golden A Owner [phase7]',      email: email('golden-a-owner-stg') },
  { id: 'golden-a-buyer-stg',    role: 'owner',      name: 'Golden A Buyer [phase7]',      email: email('golden-a-buyer-stg') },
  { id: 'golden-b-owner-stg',    role: 'owner',      name: 'Golden B Owner [phase7]',      email: email('golden-b-owner-stg') },
  { id: 'golden-b-buyer-stg',    role: 'owner',      name: 'Golden B Buyer [phase7]',      email: email('golden-b-buyer-stg') },
  { id: 'golden-reviewer-stg',   role: 'government', name: 'Golden Reviewer [phase7]',     email: email('golden-reviewer-stg') },
  { id: 'golden-bank-stg',       role: 'bank',       name: 'Golden Bank [phase7]',         email: email('golden-bank-stg') },
  { id: 'golden-insurer-stg',    role: 'insurance',  name: 'Golden Insurer [phase7]',      email: email('golden-insurer-stg') },
  { id: 'golden-mechanic-stg',   role: 'mechanic',   name: 'Golden Mechanic [phase7]',     email: email('golden-mechanic-stg') },
]);

// Evidence types must be legal under vehicle_evidence_evidence_type_check AND meaningful to the
// completeness evaluator: registration_document is the single BLOCKING ownership document; the rest
// are ADVISORY (shown, never gate publication). `submitForReview` documents are uploaded pending and
// then verified through the governed review path; `leavePending` ones are uploaded and deliberately
// NOT reviewed (Golden B's honest incompleteness).
const evidence = (type, opts = {}) => ({
  type,
  category: opts.category || 'document',
  // The fixture uploads this as pending, then (unless leavePending) drives the governed verify.
  reviewOutcome: opts.leavePending ? 'pending' : (opts.reviewOutcome || 'verified'),
  marker: SYNTHETIC_DOCUMENT_MARKER,
});

// ── Golden Vehicle A — complete / healthy (must EARN its trust) ───────────────
export const GOLDEN_A = Object.freeze({
  key: 'A',
  vin: 'CARUPGLDNA0000001',
  make: 'Toyota',
  model: 'Hilux',
  year: 2019,
  color: 'Silver',
  mileage: 78450,
  fuel_type: 'Diesel',
  transmission: 'Manual',
  drivetrain: '4WD',
  price: 21500,
  currency: 'USD',
  // Full identity so the identity dimension resolves `complete` (vin+chassis+engine+plate present).
  chassis_number: 'CARUPGLDNA-CHS-0001',
  engine_number: 'CARUPGLDNA-ENG-0001',
  plate_number: 'GLDA0001',
  location: { city: 'Bulawayo', province: 'Bulawayo Metropolitan', country: 'Zimbabwe' },
  ownerId: 'golden-a-owner-stg',
  buyerId: 'golden-a-buyer-stg',
  sellerType: 'private',
  publishTarget: 'published',            // A reaches published because it becomes publishable
  // Blocking ownership document is VERIFIED; advisories model police/inspection/insurance sources as
  // governed synthetic evidence (NOT fabricated registry rows).
  evidence: [
    evidence('registration_document'),                 // blocking → verified
    evidence('police_clearance_document'),             // advisory → verified (models a CID/police source)
    evidence('inspection_photo'),                      // advisory → verified (models a VID inspection source)
    evidence('insurance_document'),                    // advisory → verified (models an insurance source)
  ],
  // Source coverage (source_verification_results) and escrow sessions (escrow_trust_events) are
  // DELIBERATELY excluded: both are governance APPEND-ONLY tables (governance_block_mutation blocks
  // DELETE) with FK chains to the vehicle, so populating them would permanently pin this fixture VIN
  // and break the Phase 7 "removable" invariant. Golden A earns its trust from completeness + identity
  // + governed evidence review (all removable) and models the transaction relationship through the
  // buyer inquiry + a finance intent (both removable). See the Phase 7 doc's "Append-only constraint".
  sourceCoverage: [],
  insurance: { provider_name: 'CARUP SYNTHETIC INSURER [phase7]', policy_number: 'PH7-GLDA-INS-0001', coverage_type: 'comprehensive' },
  listingImageCount: 5,                  // exterior/interior/dashboard/engine/disclosed — listing MEDIA only
  finance: { requestedAmount: 15000 },   // buyer requests financing from the synthetic bank (removable)
  // Mileage must be >= the vehicle's current odometer (78450); addRepairLog rejects a lower reading.
  partSentry: { part_name: 'Front brake pads', part_oem: 'PH7-OEM-BRK-001', action_type: 'Replaced', mileage: 78450 },
  inquiry: true,                         // buyer purchase-interest inquiry (server-authoritative, removable)
});

// ── Golden Vehicle B — intentionally incomplete / pending ─────────────────────
export const GOLDEN_B = Object.freeze({
  key: 'B',
  vin: 'CARUPGLDNB0000002',
  make: 'Nissan',
  model: 'NP200',
  year: 2017,
  color: 'White',
  mileage: 132900,
  fuel_type: 'Petrol',
  transmission: 'Manual',
  drivetrain: 'RWD',
  price: 9800,
  currency: 'USD',
  // Identity fields present, but the ownership document stays PENDING and there is no insurance/
  // coverage — so evidence_completeness is incomplete and the listing is NOT publishable. B must
  // remain honestly pending; nothing here fabricates a conclusion.
  chassis_number: 'CARUPGLDNB-CHS-0002',
  engine_number: 'CARUPGLDNB-ENG-0002',
  plate_number: 'GLDB0002',
  location: { city: 'Gweru', province: 'Midlands', country: 'Zimbabwe' },
  ownerId: 'golden-b-owner-stg',
  buyerId: 'golden-b-buyer-stg',
  sellerType: 'private',
  publishTarget: 'draft',                // B cannot and must not publish
  evidence: [
    evidence('registration_document', { leavePending: true }),  // uploaded, deliberately NOT verified
  ],
  sourceCoverage: [],                    // no source connected — honest gap
  insurance: null,                       // no insurance evidence — honest gap
  listingImageCount: 2,
  finance: null,
  partSentry: null,
  inquiry: false,                        // no buyer inquiry — B is not transacting
});

export const GOLDEN_VEHICLES = Object.freeze([GOLDEN_A, GOLDEN_B]);

const LISTING_IMAGE_FACETS = Object.freeze([
  'exterior-front', 'interior', 'dashboard', 'engine-bay', 'disclosed-condition', 'exterior-rear',
]);

/** The deterministic facet names for a spec's listing MEDIA (never evidence). */
export function listingImageFacets(spec) {
  return Array.from({ length: spec.listingImageCount }, (_, i) => LISTING_IMAGE_FACETS[i] || `image-${i}`);
}

// ── LEGACY locators (Phase 7) — retained ONLY so bootstrap can recognise and repair them ──────────
//
// Phase 7 wrote these strings straight into `listing_images.image_url` and `vehicle_evidence.file_url`.
// `.test` is reserved by RFC 2606 and never resolves, so every Golden image was broken on every
// surface and every evidence file was unopenable — the physical UAT saw ERR_NAME_NOT_RESOLVED.
// Phase 8 uploads real synthetic bytes through the canonical storage contract instead
// (goldenSyntheticAssets.js + storageService.uploadToStorage) and rewrites these rows IN PLACE.
//
// These helpers must not be used to author new rows. They exist so the reconciliation in
// goldenVehicleFixture.js can find the old rows and repair them rather than inserting duplicates
// beside them, which would break Golden A's governed media count.

export function legacyListingImageUrls(spec) {
  return listingImageFacets(spec).map(
    (facet) => `https://media.carup-staging.test/phase7-golden/${spec.vin}/${facet}.jpg`);
}

export function legacyEvidenceFileUrl(spec, type) {
  return `https://evidence.carup-staging.test/phase7-golden/${spec.vin}/${type}.pdf`;
}

/** The bucket Phase 7 recorded on evidence rows. It has never existed in any Supabase project. */
export const LEGACY_EVIDENCE_BUCKET = 'phase7-golden';

// All fixture-owned user ids and vehicle VINs — the exact set cleanup is allowed to touch.
export function fixtureUserIds() { return GOLDEN_USERS.map((u) => u.id); }
export function fixtureVins() { return GOLDEN_VEHICLES.map((v) => v.vin); }

export default {
  GOLDEN_PROGRAMME, GOLDEN_MARKER, FIXTURE_EMAIL_DOMAIN, SYNTHETIC_DOCUMENT_MARKER,
  goldenMetadata, GOLDEN_USERS, GOLDEN_A, GOLDEN_B, GOLDEN_VEHICLES,
  listingImageFacets, legacyListingImageUrls, legacyEvidenceFileUrl, LEGACY_EVIDENCE_BUCKET,
  fixtureUserIds, fixtureVins,
};

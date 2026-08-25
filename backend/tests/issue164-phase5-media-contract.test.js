/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 5 permanent guard.
 *
 * Phase 5 separates two things that had been collapsed into one control: LISTING MEDIA (the
 * seller's marketing photos, unverified, whose job is to show the car) and VERIFIED EVIDENCE
 * (governed artifacts carrying provenance and a review decision). Vehicle Detail must compose both
 * and must never let one be read as the other.
 *
 * What each section is watching for:
 *
 *   1. THE SHAPE IS CLOSED. Two blocks, one uniform envelope, and item field sets that share NOT
 *      ONE key name. Disjointness is asserted on the declared lists AND re-asserted on built
 *      payloads, so it survives a change to either projector.
 *   2. A LISTING IMAGE CANNOT BECOME EVIDENCE, AND EVIDENCE CANNOT BECOME A GALLERY SLOT. Both
 *      directions are fed the wrong table's rows and must publish nothing, without throwing and
 *      without a special case.
 *   3. EVIDENCE NEVER LEAKS ITS INTERNAL IDENTITY. Phase 0's allow-list is reused, not forked, and
 *      `uploaded_by`/`verified_by`/`tenant_id`/`source_id`/`file_path`/`storage_bucket`/
 *      `verification_notes`/`metadata` and the registry identifiers stay out FOR EVERY AUDIENCE.
 *   4. EACH EMPTY STATE IS ITS OWN. "no photos" and "no verified evidence" are different sentences,
 *      neither implies the other, and a block that was NEVER READ says neither — that third state
 *      is the original defect expressed as a state.
 *   5. LISTING MEDIA MAKES NO VERIFICATION CLAIM. A governance-vocabulary scan over everything the
 *      listing block authors, including its keys.
 *   6. A LISTING IMAGE PRESENT IN THE SOURCE IS PUBLISHED. The positive direction, run against the
 *      exact rows staging holds — because a contract that publishes nothing also passes 1-5.
 *   7. URL HONESTY. Forms classify the STRING; unpublishable values are counted, never silently
 *      dropped.
 *
 * ANTI-VACUITY. Four controls, because a scan that finds nothing and a scan that scans nothing are
 * the same green tick: the trust-language scanner is run against a planted violation and must flag
 * exactly it; the cross-contamination detector is run against a deliberately contaminated payload
 * and must catch both directions; the declared field lists are asserted non-trivial in size; and
 * the staging-shaped fixtures are asserted to actually produce items rather than empty blocks.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// The write-path suite at the foot of this file drives the SHIPPED POST /api/vehicles/add over real
// HTTP: the fabrication it guards was committed by a route, and a unit test of the projection can
// never see a route.
import http from 'node:http';

import {
  MEDIA_BLOCK_STATES,
  MEDIA_BLOCK_STATE_VALUES,
  MEDIA_URL_FORMS,
  MEDIA_URL_FORM_VALUES,
  MEDIA_BLOCK_ENVELOPE_FIELDS,
  LISTING_MEDIA_ITEM_FIELDS,
  EVIDENCE_MEDIA_ITEM_FIELDS,
  LISTING_MEDIA_EMPTY_STATEMENT,
  VERIFIED_EVIDENCE_EMPTY_STATEMENT,
  PUBLISHABLE_EVIDENCE_VISIBILITY,
  PUBLISHABLE_EVIDENCE_STATUS,
  TRUST_LANGUAGE,
  classifyMediaUrl,
  isPublishableMediaUrl,
  toMediaIdentity,
  isPublishableMediaIdentity,
  isMediaBlockState,
  isEvidenceRowClearedFor,
  isPublishableEvidenceRow,
  toListingMediaBlock,
  toVerifiedEvidenceBlock,
  toVehicleMedia,
  findTrustLanguage,
  findMediaBlockCrossContamination,
} from '../utils/vehicleMediaProjection.js';

import {
  PUBLIC_EVIDENCE_FIELDS,
  PRIVATE_VEHICLE_FIELDS,
  findPrivateFieldLeaks,
  projectVehicle,
  toPublicEvidence,
  toPublicPlateHistory,
  toPublicTimelineEvent,
  toListingClaims,
  attestedValue,
} from '../utils/publicVehicleProjection.js';

import { publiclyVisiblePublicationStatuses } from '../utils/vehicleStatus.js';

import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

/**
 * RULE 1b — EVERY FIXTURE IN THIS FILE IS A PUBLISHED LISTING, AND NOW SAYS SO.
 *
 * These tests are about the CONTRACT'S SHAPE, and every one of them always meant "a listing whose
 * gallery is publishable". That was previously left implicit because `toVehicleMedia` had no
 * publication input; it now has one and it DEFAULTS CLOSED, so leaving it implicit would silently
 * degrade every assertion below to the `not_loaded` path and stop exercising the gallery at all.
 * Stating it is what KEEPS these tests as strong as they were — it is not a concession to the gate.
 *
 * Read from `publiclyVisiblePublicationStatuses()` rather than written as a literal, so this file
 * cannot come to disagree with the marketplace filter about which status is public.
 */
const [PUBLISHED_LISTING_STATUS] = publiclyVisiblePublicationStatuses();

// ── FIXTURES: THE ROWS STAGING ACTUALLY HOLDS ────────────────────────────────────────────────
// Copied from a read-only query against staging (ref eoyenigwevnxwwhyhaer) at this SHA, not
// invented, so the positive assertions below are about real data shapes and the URL forms are the
// forms the live rows have. listing_images: 3 rows / 3 VINs, all `is_primary`, all display_order 0,
// all SITE-RELATIVE. vehicle_evidence: 1 row, absolute https on a host that does not resolve.

/** The three live `listing_images` rows, one per VIN. */
const STAGING_LISTING_IMAGE_ROWS = Object.freeze([
  Object.freeze({
    id: '6a4b5b86-fbf2-448e-856e-9fa14299c2d7',
    vin: 'JF1GPAL60J9UAT303',
    image_url: '/uat/owner/subaru-impreza.svg',
    is_primary: true,
    display_order: 0,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
  Object.freeze({
    id: '5596b493-f21a-40eb-aba5-947b26e76cd5',
    vin: 'JTNBU4EE0J9UAT101',
    image_url: '/uat/owner/toyota-corolla.svg',
    is_primary: true,
    display_order: 0,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
  Object.freeze({
    id: 'fb7b28c2-c6d5-443e-9758-0b7a790be6f2',
    vin: 'WBA8E9C50JNUAT202',
    image_url: '/uat/owner/bmw-320i.svg',
    is_primary: true,
    display_order: 0,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
]);

/**
 * The one live `vehicle_evidence` row, with every internal column present exactly as the table
 * carries it. It is deliberately NOT trimmed: the point of the leak assertions is that a raw
 * `select('*')` row can be handed to this projector safely.
 */
const STAGING_EVIDENCE_ROW = Object.freeze({
  id: '2a86d385-de18-45ef-9938-1b4f4808abc4',
  vin: 'WBA8E9C50HK000732',
  vehicle_id: 'WBA8E9C50HK000732',
  plate_number: 'ABC1234',
  normalized_plate_number: 'ABC1234',
  chassis_number: 'CHASSIS-73',
  engine_number: 'ENGINE-73',
  evidence_type: 'registration_document',
  evidence_class: 'ownership_transfer',
  evidence_subtype: null,
  event_type: 'ownership_transfer',
  event_date: null,
  event_date_precision: 'day',
  captured_at: '2026-08-16T00:00:00.000Z',
  uploaded_at: '2026-08-16T00:00:00.000Z',
  verified_at: '2026-08-16T00:00:00.000Z',
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
  verification_status: 'verified',
  visibility_level: 'public_safe',
  // The carry-forward defect: a fake domain that does not resolve, whose storage_bucket/file_path
  // also name an object that does not exist (`vehicle-images` holds 0 objects on staging).
  file_url: 'https://staging.carup.local/qa/evidence-73.jpg',
  storage_bucket: 'vehicle-images',
  file_path: 'qa/evidence-73.jpg',
  mime_type: 'image/jpeg',
  file_size: 1024,
  uploaded_by: 'qa-staging-seller-73',
  uploader_role: 'seller',
  verified_by: 'qa-staging-seller-73',
  tenant_id: 'tenant-73',
  source_id: '1ad79b2d-c99e-41be-90e3-576104be0c70',
  source_record_id: 'src-73',
  source_name: 'QA Staging Seed',
  source_reference: 'internal-ref-73',
  verification_notes: 'reviewer note naming ABC1234',
  metadata: { ai_ready: { vehicle_identity: { vin: 'WBA8E9C50HK000732', plate_number: 'ABC1234' } } },
  trust_impact: 5,
  trust_score_impact: 5,
  confidence_impact: 0,
  checksum: 'sha256:abc',
  image_hash: 'phash:abc',
  perceptual_hash: 'phash:abc',
  checksum_algorithm: 'sha256',
  odometer_value: null,
  odometer_unit: null,
  declared_condition: null,
  component_tags: null,
  linked_registry_event_id: null,
  timeline_event_id: null,
  capture_country: 'ZW',
  retention_class: 'standard',
  original_asset_id: null,
  evidence_set_id: null,
  received_at: null,
});

/**
 * An ad-hoc `listing_images` row for the focused cases below (ordering, primacy, url forms).
 *
 * CORRECTED FOR RULE 6b, NOT LOOSENED. These fixtures were originally written as bare
 * `{ image_url, is_primary, display_order }` literals, which the source table never produces: `id`
 * is `uuid NOT NULL DEFAULT gen_random_uuid()` and is the primary key, so every real row has one.
 * Now that identity is a publication requirement, an id-less literal is UNPUBLISHABLE — so leaving
 * these fixtures as they were would have quietly turned tests about ordering and primacy into tests
 * about empty blocks, which is the vacuity this suite exists to prevent. The assertions below are
 * unchanged; only the rows became faithful to the schema.
 *
 * Ids are sequential rather than random so a failure reproduces identically.
 */
let listingRowSeq = 0;
function listingRow(overrides = {}) {
  listingRowSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(listingRowSeq).padStart(12, '0')}`,
    vin: 'JF1GPAL60J9UAT303',
    is_primary: false,
    display_order: 0,
    ...overrides,
  };
}

/** Every internal column on the evidence row that must never reach a public body. */
const EVIDENCE_INTERNAL_COLUMNS = Object.freeze([
  'uploaded_by', 'uploader_role', 'verified_by', 'tenant_id', 'source_id', 'source_record_id',
  'source_reference', 'verification_notes', 'metadata', 'file_path', 'storage_bucket',
  'plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number',
  'vehicle_id', 'confidence_impact', 'perceptual_hash', 'checksum_algorithm',
  'capture_country', 'retention_class', 'original_asset_id', 'evidence_set_id',
  'received_at', 'updated_at',
]);

// ── 1. THE SHAPE IS CLOSED ───────────────────────────────────────────────────────────────────
describe('Phase 5 — the media contract shape is closed', () => {
  it('declares exactly three block states and validates them', () => {
    assert.deepEqual([...MEDIA_BLOCK_STATE_VALUES].sort(), ['none', 'not_loaded', 'published']);
    for (const state of MEDIA_BLOCK_STATE_VALUES) assert.equal(isMediaBlockState(state), true);
    for (const notAState of ['loaded', 'empty', 'missing', '', null, undefined, 0]) {
      assert.equal(isMediaBlockState(notAState), false);
    }
  });

  it('gives both blocks the SAME envelope keys — one protocol, read the same way', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.deepEqual(Object.keys(media).sort(), ['listing_media', 'verified_evidence']);
    for (const blockName of ['listing_media', 'verified_evidence']) {
      assert.deepEqual(
        Object.keys(media[blockName]).sort(),
        [...MEDIA_BLOCK_ENVELOPE_FIELDS].sort(),
        `${blockName} must carry exactly the declared envelope`,
      );
    }
  });

  it('gives the two ITEM shapes no key in common — the disjointness proof', () => {
    const overlap = LISTING_MEDIA_ITEM_FIELDS.filter((f) => EVIDENCE_MEDIA_ITEM_FIELDS.includes(f));
    assert.deepEqual(overlap, [], 'a shared key is a place a consumer can conflate the two blocks');
    // ANTI-VACUITY: two empty lists are also disjoint.
    assert.ok(LISTING_MEDIA_ITEM_FIELDS.length >= 4, 'listing item shape must be non-trivial');
    assert.ok(EVIDENCE_MEDIA_ITEM_FIELDS.length >= 20, 'evidence item shape must be non-trivial');
  });

  it('builds items that carry EXACTLY their declared fields, always all of them', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.ok(media.listing_media.items.length > 0);
    assert.ok(media.verified_evidence.items.length > 0);
    for (const item of media.listing_media.items) {
      assert.deepEqual(Object.keys(item).sort(), [...LISTING_MEDIA_ITEM_FIELDS].sort());
    }
    for (const item of media.verified_evidence.items) {
      assert.deepEqual(Object.keys(item).sort(), [...EVIDENCE_MEDIA_ITEM_FIELDS].sort());
    }
  });

  it('reuses Phase 0 PUBLIC_EVIDENCE_FIELDS rather than forking it', () => {
    // The evidence item is the allow-list verbatim plus exactly two DERIVED keys. If Phase 0 widens
    // or narrows its list, this contract follows automatically — which is the point of importing it.
    //
    // `file_availability` joined `file_url_form` when the block stopped discarding a verified row
    // whose artifact is private (Issue #164 D0/D2): the item now publishes the governed FACT and
    // states that the FILE is withheld, instead of the row vanishing into `unpublishable_count` and
    // the block reporting `state: 'none'` over four reviewed documents. Both keys are derived here
    // and neither is a database column, so the allow-list itself is unchanged — which is exactly
    // what the exact-match below still pins.
    const extras = EVIDENCE_MEDIA_ITEM_FIELDS.filter((f) => !PUBLIC_EVIDENCE_FIELDS.includes(f));
    assert.deepEqual(extras, ['file_url_form', 'file_availability']);
    for (const field of PUBLIC_EVIDENCE_FIELDS) {
      assert.ok(EVIDENCE_MEDIA_ITEM_FIELDS.includes(field), `${field} dropped from the evidence item`);
    }
  });

  it('freezes what it publishes, so a consumer cannot mutate the contract in place', () => {
    const media = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: STAGING_LISTING_IMAGE_ROWS, evidenceRows: [] });
    assert.throws(() => { media.listing_media = null; }, TypeError);
    assert.throws(() => { media.listing_media.items.push({}); }, TypeError);
    assert.throws(() => { media.listing_media.items[0].is_primary = false; }, TypeError);
  });
});

// ── 2. THE TWO SOURCES CANNOT CROSS ──────────────────────────────────────────────────────────
describe('Phase 5 — a listing image can never appear in the evidence block', () => {
  it('publishes NOTHING when listing_images rows are fed to the evidence projector', () => {
    const block = toVerifiedEvidenceBlock(STAGING_LISTING_IMAGE_ROWS);
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
    assert.deepEqual(block.items, []);
    // Not counted as unpublishable either: a listing row is not evidence we failed to render, it is
    // not evidence at all.
    assert.equal(block.unpublishable_count, 0);
  });

  it('refuses a listing row even when it is dressed up with a governance status', () => {
    // The realistic attack is not a raw listing row; it is a merge that stapled a status onto one.
    // It still has no `file_url`, so it still publishes nothing — the gate is the ordinary one.
    const dressed = STAGING_LISTING_IMAGE_ROWS.map((row) => ({
      ...row,
      verification_status: PUBLISHABLE_EVIDENCE_STATUS,
      visibility_level: PUBLISHABLE_EVIDENCE_VISIBILITY,
    }));
    const block = toVerifiedEvidenceBlock(dressed);
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
    assert.deepEqual(block.items, []);
    // These DID clear the audience gate and then had no URL, so they are our defect and counted.
    assert.equal(block.unpublishable_count, 3);
    for (const row of dressed) assert.equal(isPublishableEvidenceRow(row), false);
  });

  it('publishes NOTHING when evidence rows are fed to the listing projector', () => {
    const block = toListingMediaBlock([STAGING_EVIDENCE_ROW]);
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
    assert.deepEqual(block.items, []);
    assert.equal(block.unpublishable_count, 1);
    assert.equal(block.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
  });

  it('keeps both blocks distinct on a built payload, both populated', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.deepEqual(findMediaBlockCrossContamination(media), []);
  });

  it('ANTI-VACUITY: the cross-contamination detector catches a planted violation in BOTH directions', () => {
    const contaminated = {
      listing_media: {
        // A listing item that has grown a verification status — the conflation this phase forbids.
        items: [{ url: '/a.jpg', url_form: 'site_relative', position: 0, is_primary: true, verification_status: 'verified' }],
      },
      verified_evidence: {
        // An evidence item that has grown gallery ordering — governed proof turned into a carousel.
        items: [{ id: 'e1', file_url: 'https://x/y.jpg', position: 0, is_primary: true }],
      },
    };
    assert.deepEqual(findMediaBlockCrossContamination(contaminated), [
      'listing_media.items[0].verification_status',
      'verified_evidence.items[0].is_primary',
      'verified_evidence.items[0].position',
    ]);
  });

  it('does NOT deduplicate a URL that legitimately appears in both blocks', () => {
    // One file can be a seller's marketing photo AND, separately, a reviewed artifact. Both claims
    // are real and each belongs to its own block; suppressing either would delete a fact.
    const shared = 'https://cdn.example.test/vehicle-images/shared.jpg';
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: [listingRow({ image_url: shared, is_primary: true })],
      evidenceRows: [{ ...STAGING_EVIDENCE_ROW, file_url: shared }],
    });
    assert.equal(media.listing_media.items[0].url, shared);
    assert.equal(media.verified_evidence.items[0].file_url, shared);
    assert.deepEqual(findMediaBlockCrossContamination(media), []);
  });

  it('keeps a dealer_listing evidence row in the EVIDENCE block and out of the gallery', () => {
    // The taxonomy permits evidence_class 'dealer_listing' / evidence_type 'dealer_listing_photo':
    // a governed record OF a marketing photo. It is evidence about an advertisement, so it stays
    // evidence — and it is never copied into the seller's current gallery.
    const advert = {
      ...STAGING_EVIDENCE_ROW,
      evidence_type: 'dealer_listing_photo',
      evidence_class: 'dealer_listing',
      evidence_subtype: 'listing_photograph',
    };
    const media = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: [], evidenceRows: [advert] });
    assert.equal(media.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(media.verified_evidence.items[0].evidence_class, 'dealer_listing');
    assert.equal(media.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.deepEqual(media.listing_media.items, []);
  });
});

// ── 3. EVIDENCE NEVER LEAKS ITS INTERNAL IDENTITY ────────────────────────────────────────────
describe('Phase 5 — evidence keeps its Phase 0 allow-list, for every audience', () => {
  for (const audience of ['public', 'owner']) {
    it(`emits no internal identity for audience=${audience}`, () => {
      const block = toVerifiedEvidenceBlock([STAGING_EVIDENCE_ROW], { audience });
      assert.equal(block.items.length, 1);
      const item = block.items[0];
      for (const column of EVIDENCE_INTERNAL_COLUMNS) {
        assert.equal(column in item, false, `${column} leaked into the ${audience} evidence item`);
      }
      assert.deepEqual(findPrivateFieldLeaks(block), []);
    });
  }

  it('carries no registry identifier at any depth, including through metadata', () => {
    // The staging row's `metadata.ai_ready.vehicle_identity` holds the plate and VIN. The item is
    // ASSEMBLED from named fields, never spread, so metadata has no way up.
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.deepEqual(findPrivateFieldLeaks(media), []);
    const serialized = JSON.stringify(media);
    for (const secret of ['ABC1234', 'CHASSIS-73', 'ENGINE-73', 'qa-staging-seller-73', 'tenant-73', 'reviewer note']) {
      assert.ok(!serialized.includes(secret), `${secret} reached the public media contract`);
    }
    // ANTI-VACUITY: the private vocabulary the leak-finder walks is non-empty and the payload is
    // big enough to have been worth walking.
    assert.ok(PRIVATE_VEHICLE_FIELDS.length >= 5);
    assert.ok(serialized.length > 400);
  });

  it('widens WHICH ROWS for an owner, never WHICH FIELDS', () => {
    const pending = { ...STAGING_EVIDENCE_ROW, verification_status: 'pending', visibility_level: 'private' };
    assert.equal(isEvidenceRowClearedFor(pending, 'public'), false);
    assert.equal(isEvidenceRowClearedFor(pending, 'owner'), true);

    const publicBlock = toVerifiedEvidenceBlock([pending], { audience: 'public' });
    const ownerBlock = toVerifiedEvidenceBlock([pending], { audience: 'owner' });
    assert.equal(publicBlock.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(ownerBlock.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.deepEqual(Object.keys(ownerBlock.items[0]).sort(), [...EVIDENCE_MEDIA_ITEM_FIELDS].sort());
  });

  it('never counts a row the audience may not see — absence must not prove existence', () => {
    // Reporting "1 withheld" to an anonymous caller answers the question the gate exists to refuse.
    const restricted = { ...STAGING_EVIDENCE_ROW, visibility_level: 'government_only' };
    const block = toVerifiedEvidenceBlock([restricted], { audience: 'public' });
    assert.equal(block.unpublishable_count, 0);
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
    // Byte-identical to a vehicle that genuinely holds no evidence at all.
    assert.deepEqual(block, toVerifiedEvidenceBlock([], { audience: 'public' }));
  });

  it('re-applies the gate even when the caller forgot the SQL filter', () => {
    for (const bad of [
      { ...STAGING_EVIDENCE_ROW, verification_status: 'pending' },
      { ...STAGING_EVIDENCE_ROW, verification_status: 'rejected' },
      { ...STAGING_EVIDENCE_ROW, verification_status: 'disputed' },
      { ...STAGING_EVIDENCE_ROW, visibility_level: 'restricted' },
      { ...STAGING_EVIDENCE_ROW, visibility_level: 'private' },
      { ...STAGING_EVIDENCE_ROW, visibility_level: undefined },
      { ...STAGING_EVIDENCE_ROW, verification_status: undefined },
    ]) {
      assert.equal(isPublishableEvidenceRow(bad), false);
      assert.equal(toVerifiedEvidenceBlock([bad]).state, MEDIA_BLOCK_STATES.NONE);
    }
  });
});

// ── 4. EACH EMPTY STATE IS ITS OWN ───────────────────────────────────────────────────────────
describe('Phase 5 — the empty states are distinct and neither implies the other', () => {
  it('says two different sentences, and neither mentions the other concept', () => {
    assert.notEqual(LISTING_MEDIA_EMPTY_STATEMENT, VERIFIED_EVIDENCE_EMPTY_STATEMENT);
    // The shipped sentence, "No verified images uploaded yet", is the one thing the gallery may not
    // say: it answers an evidence question with a listing control. The guard is that the listing
    // statement contains no governance word at all.
    assert.deepEqual(findTrustLanguage({ empty_statement: LISTING_MEDIA_EMPTY_STATEMENT }), []);
    // And the evidence statement must actually be about evidence, or it is not saying its own thing.
    assert.ok(VERIFIED_EVIDENCE_EMPTY_STATEMENT.toLowerCase().includes('verified evidence'));
  });

  it('reports "no photos" and "no verified evidence" independently, four ways round', () => {
    const photosNoEvidence = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: STAGING_LISTING_IMAGE_ROWS, evidenceRows: [] });
    assert.equal(photosNoEvidence.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(photosNoEvidence.listing_media.empty_statement, null);
    assert.equal(photosNoEvidence.verified_evidence.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(photosNoEvidence.verified_evidence.empty_statement, VERIFIED_EVIDENCE_EMPTY_STATEMENT);

    const evidenceNoPhotos = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: [], evidenceRows: [STAGING_EVIDENCE_ROW] });
    assert.equal(evidenceNoPhotos.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(evidenceNoPhotos.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.equal(evidenceNoPhotos.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(evidenceNoPhotos.verified_evidence.empty_statement, null);

    const neither = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: [], evidenceRows: [] });
    assert.equal(neither.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.equal(neither.verified_evidence.empty_statement, VERIFIED_EVIDENCE_EMPTY_STATEMENT);

    const both = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.equal(both.listing_media.empty_statement, null);
    assert.equal(both.verified_evidence.empty_statement, null);
  });

  it('says NOTHING for a block this read path never consulted — the original defect as a state', () => {
    // This is the passport path: it reads vehicle_evidence and has never heard of listing_images.
    // Under the shipped code that produced a confident "No verified images uploaded yet". Here it
    // produces `not_loaded` with a NULL statement, so a surface has nothing to render.
    const passportShaped = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, evidenceRows: [STAGING_EVIDENCE_ROW] });
    assert.equal(passportShaped.listing_media.state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(passportShaped.listing_media.empty_statement, null);
    assert.deepEqual(passportShaped.listing_media.items, []);
    assert.equal(passportShaped.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED);

    // And the mirror: a marketplace-shaped path that loads images and not evidence must not claim
    // the vehicle has no verified evidence.
    const marketplaceShaped = toVehicleMedia({ listingPublicationStatus: PUBLISHED_LISTING_STATUS, listingImageRows: STAGING_LISTING_IMAGE_ROWS });
    assert.equal(marketplaceShaped.verified_evidence.state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(marketplaceShaped.verified_evidence.empty_statement, null);
  });

  it('distinguishes not_loaded from none by the caller passing an ARRAY, including an empty one', () => {
    assert.equal(toListingMediaBlock(undefined).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toListingMediaBlock(null).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toListingMediaBlock([]).state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(toVerifiedEvidenceBlock(undefined).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toVerifiedEvidenceBlock(null).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toVerifiedEvidenceBlock([]).state, MEDIA_BLOCK_STATES.NONE);
    // A non-array (a PostgREST error object, say) is "we did not get rows", not "there are none".
    assert.equal(toListingMediaBlock({ error: 'boom' }).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toVerifiedEvidenceBlock({ error: 'boom' }).state, MEDIA_BLOCK_STATES.NOT_LOADED);
  });
});

// ── 5. LISTING MEDIA MAKES NO VERIFICATION CLAIM ─────────────────────────────────────────────
describe('Phase 5 — listing media carries no trust language', () => {
  it('authors no governance word anywhere in the listing block, keys included', () => {
    for (const rows of [STAGING_LISTING_IMAGE_ROWS, [], undefined]) {
      assert.deepEqual(findTrustLanguage(toListingMediaBlock(rows)), []);
    }
  });

  it('does not flag a seller filename — we govern what WE say, not what a file is called', () => {
    // Firing here would make the guard a data check rather than a contract check, and a seller
    // would be able to break the build by naming a photo.
    const block = toListingMediaBlock([listingRow({ image_url: '/photos/verified-dealer-stock.jpg', is_primary: true })]);
    assert.equal(block.items[0].url, '/photos/verified-dealer-stock.jpg');
    assert.deepEqual(findTrustLanguage(block), []);
  });

  it('ANTI-VACUITY: the scanner flags exactly the planted violations and nothing else', () => {
    const planted = {
      state: 'published',
      empty_statement: 'No verified images uploaded yet',      // the shipped sentence
      items: [{
        url: '/ok.jpg',                                        // seller data, skipped
        url_form: 'site_relative',                             // clean
        position: 0,
        is_primary: true,
        trust_badge: 'inspected',                              // key AND value both offend
      }],
      unpublishable_count: 0,
    };
    assert.deepEqual(findTrustLanguage(planted), [
      'empty_statement',
      'items[0].trust_badge',
    ]);
    // And the vocabulary it scans with is non-empty.
    assert.ok(TRUST_LANGUAGE.length >= 10);
    assert.ok(TRUST_LANGUAGE.includes('verif'));
  });

  it('lets the EVIDENCE block speak the language that is its job', () => {
    // Symmetry check: the guard is scoped to the listing block on purpose. Pointed at the evidence
    // block it must NOT be silent, or it would be measuring nothing there either.
    const evidenceBlock = toVerifiedEvidenceBlock([STAGING_EVIDENCE_ROW]);
    assert.ok(findTrustLanguage(evidenceBlock).length > 0);
    assert.ok(findTrustLanguage(evidenceBlock).includes('items[0].verification_status'));
  });

  it('publishes no evidence-shaped key on a listing item', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    for (const item of block.items) {
      for (const forbidden of ['verification_status', 'visibility_level', 'evidence_class', 'verified_at', 'checksum', 'trust_score_impact']) {
        assert.equal(forbidden in item, false, `${forbidden} must not exist on a listing photo`);
      }
    }
  });

  it('does not publish listing_images.created_at as if it were a capture time', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    for (const item of block.items) {
      assert.equal('created_at' in item, false);
      assert.equal('captured_at' in item, false);
      assert.ok(!JSON.stringify(item).includes('2026-08-16'));
    }
  });
});

// ── 6. THE POSITIVE DIRECTION ────────────────────────────────────────────────────────────────
describe('Phase 5 — a listing image present in the source IS published', () => {
  it('publishes the live staging rows, one item each, with their real URLs', () => {
    // The whole defect in one assertion: source data exists, therefore the gallery block is
    // populated. A contract that quietly published nothing would satisfy every guard above.
    for (const row of STAGING_LISTING_IMAGE_ROWS) {
      const block = toListingMediaBlock([row]);
      assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
      assert.equal(block.items.length, 1);
      assert.equal(block.items[0].url, row.image_url);
      assert.equal(block.items[0].url_form, MEDIA_URL_FORMS.SITE_RELATIVE);
      assert.equal(block.items[0].position, 0);
      assert.equal(block.items[0].is_primary, true);
      assert.equal(block.unpublishable_count, 0);
      assert.equal(block.empty_statement, null);
    }
  });

  it('publishes an absolute storage URL of the kind the upload path produces', () => {
    // mediaRouter uploads to the public `vehicle-images` bucket and stores getPublicUrl()'s output.
    const uploaded = 'https://eoyenigwevnxwwhyhaer.supabase.co/storage/v1/object/public/vehicle-images/VIN/1.webp';
    const block = toListingMediaBlock([listingRow({ image_url: uploaded })]);
    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(block.items[0].url_form, MEDIA_URL_FORMS.ABSOLUTE_HTTPS);
  });

  it('orders by primary, then display_order, then insertion — densely, from 0', () => {
    const block = toListingMediaBlock([
      listingRow({ image_url: '/c.jpg', display_order: 2 }),
      listingRow({ image_url: '/p.jpg', is_primary: true, display_order: 9 }),
      listingRow({ image_url: '/a.jpg', display_order: 0 }),
      listingRow({ image_url: '/b.jpg', display_order: 1 }),
    ]);
    assert.deepEqual(block.items.map((i) => i.url), ['/p.jpg', '/a.jpg', '/b.jpg', '/c.jpg']);
    assert.deepEqual(block.items.map((i) => i.position), [0, 1, 2, 3]);
  });

  it('honours ONE primary claim and demotes the rest, and invents none when nobody claims', () => {
    const twoPrimaries = toListingMediaBlock([
      listingRow({ image_url: '/x.jpg', is_primary: true, display_order: 1 }),
      listingRow({ image_url: '/y.jpg', is_primary: true, display_order: 0 }),
    ]);
    assert.equal(twoPrimaries.items.filter((i) => i.is_primary).length, 1);
    assert.equal(twoPrimaries.items[0].url, '/y.jpg', 'the lower display_order wins the tie');

    const noPrimary = toListingMediaBlock([
      listingRow({ image_url: '/x.jpg', display_order: 0 }),
      listingRow({ image_url: '/y.jpg', display_order: 1 }),
    ]);
    // Ordering still works; primacy is simply not asserted. Electing items[0] would publish a
    // seller choice nobody made — the same fabrication family Phase 4 removed from seller labels.
    assert.equal(noPrimary.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.deepEqual(noPrimary.items.map((i) => i.is_primary), [false, false]);
    assert.deepEqual(noPrimary.items.map((i) => i.position), [0, 1]);
  });

  it('treats only a literal true as a primacy claim', () => {
    for (const notTrue of ['true', 1, 'yes', {}, null, undefined]) {
      const block = toListingMediaBlock([listingRow({ image_url: '/x.jpg', is_primary: notTrue })]);
      assert.equal(block.items[0].is_primary, false);
    }
  });

  it('publishes no primary_url mirror — one fact lives in one place', () => {
    // Phase 4's plate_status answered one question twice in one body, with two different answers.
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    for (const key of ['primary_url', 'primary_image_url', 'cover_url', 'thumbnail_url']) {
      assert.equal(key in block, false);
    }
  });
});

// ── 7. URL HONESTY ───────────────────────────────────────────────────────────────────────────
describe('Phase 5 — url_form describes the string, never the asset', () => {
  it('classifies each declared form, and every form is reachable', () => {
    const cases = [
      ['https://cdn.example.test/a.jpg', MEDIA_URL_FORMS.ABSOLUTE_HTTPS],
      ['HTTPS://CDN.EXAMPLE.TEST/A.JPG', MEDIA_URL_FORMS.ABSOLUTE_HTTPS],
      ['http://cdn.example.test/a.jpg', MEDIA_URL_FORMS.ABSOLUTE_HTTP],
      // Looks site-relative, resolves to a FOREIGN host. Classified apart precisely for that.
      ['//cdn.example.test/a.jpg', MEDIA_URL_FORMS.PROTOCOL_RELATIVE],
      ['/uat/owner/subaru-impreza.svg', MEDIA_URL_FORMS.SITE_RELATIVE],
      ['  /uat/owner/bmw-320i.svg  ', MEDIA_URL_FORMS.SITE_RELATIVE],
    ];
    for (const [url, expected] of cases) assert.equal(classifyMediaUrl(url), expected);
    // ANTI-VACUITY: the corpus exercises every declared form.
    const produced = new Set(cases.map(([, form]) => form));
    assert.deepEqual([...produced].sort(), [...MEDIA_URL_FORM_VALUES].sort());
  });

  it('refuses values that are not media references', () => {
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo=',
      'blob:https://carup.dev/1234',
      'javascript:alert(1)',
      'file:///etc/passwd',
      // Path-relative: on /marketplace/<VIN> this resolves to /marketplace/photo.jpg.
      'photo.jpg',
      './photo.jpg',
      '../photo.jpg',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
      ['/a.jpg'],
    ]) {
      assert.equal(classifyMediaUrl(bad), null);
      assert.equal(isPublishableMediaUrl(bad), false);
    }
  });

  it('counts what it could not publish instead of dropping it silently', () => {
    const block = toListingMediaBlock([
      listingRow({ image_url: '/good.jpg', is_primary: true, display_order: 0 }),
      listingRow({ image_url: 'data:image/png;base64,x', display_order: 1 }),
      listingRow({ image_url: '', display_order: 2 }),
      listingRow({ image_url: null, display_order: 3 }),
    ]);
    // A block that quietly dropped three would report the same shape as a listing that only ever
    // had one photo, which is the same lie as the sentence this phase removes, one layer down.
    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(block.items.length, 1);
    assert.equal(block.unpublishable_count, 3);

    const allBad = toListingMediaBlock([listingRow({ image_url: 'data:image/png;base64,x' })]);
    assert.equal(allBad.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(allBad.unpublishable_count, 1);
    // The sentence is still the honest one for a shopper; the count is the operator's signal that
    // "none published" and "none exists" are not the same here.
    assert.equal(allBad.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
  });

  it('classifies the live evidence URL and asserts nothing about whether it resolves', () => {
    // The carry-forward defect: https://staging.carup.local/... is a well-formed absolute URL on a
    // host that does not exist, and its storage_bucket/file_path name an object that does not exist
    // either. The contract publishes the string and its FORM, and claims nothing more — which is
    // exactly what "url honesty" has to mean when the recorded value is this bad.
    const block = toVerifiedEvidenceBlock([STAGING_EVIDENCE_ROW]);
    assert.equal(block.items[0].file_url, 'https://staging.carup.local/qa/evidence-73.jpg');
    assert.equal(block.items[0].file_url_form, MEDIA_URL_FORMS.ABSOLUTE_HTTPS);
    assert.equal('storage_bucket' in block.items[0], false);
    assert.equal('file_path' in block.items[0], false);
  });

  it('emits no signed URL, no token and no expiry', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    const serialized = JSON.stringify(media);
    for (const marker of ['token=', 'X-Amz-Signature', 'expires_at', 'expiresIn', 'signedUrl', 'signed_url']) {
      assert.ok(!serialized.includes(marker), `${marker} implies an access guarantee this contract does not make`);
    }
  });
});

// ── 8. STABLE MEDIA IDENTITY ─────────────────────────────────────────────────────────────────
/**
 * WHY THIS SECTION EXISTS, AND WHY URL EQUALITY IS NOT ENOUGH.
 *
 * Phase 5's continuity was first proven by comparing URL STRINGS across list / detail / passport.
 * That proves three surfaces printed the same characters. It does not prove they showed the same
 * photograph, and the gap is not theoretical in either direction:
 *
 *   · A URL may be rewritten between surfaces — CDN host, origin swap, a signature, a resize
 *     suffix — and still be the same picture. String comparison calls that a discontinuity.
 *   · Two DIFFERENT photographs may collide on a site-relative path. There is no unique index and
 *     no CHECK on `listing_images.image_url` (finding 3), and 3 of 3 staging rows are exactly such
 *     paths. String comparison calls that a match.
 *
 * `media_id` is the row's own uuid primary key, so it answers "which photograph" directly. The
 * assertions below are therefore about STABILITY (same row, same identity, across independent
 * projections and across re-orderings) rather than about equality of rendered strings.
 *
 * ANTI-VACUITY IS BUILT IN: several tests assert that `position` DOES move while `media_id` does
 * not, so an implementation that made the identity index-derived would fail them rather than
 * satisfy them. A test that passes for both a stable and an unstable identity proves nothing.
 */
describe('Phase 5 — listing media carries a stable opaque identity', () => {
  it('publishes media_id on EVERY published item, as a lowercase canonical uuid', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(block.items.length, 3, 'anti-vacuity: a block with no items also has no bad ids');
    for (const item of block.items) {
      assert.equal(typeof item.media_id, 'string');
      assert.match(
        item.media_id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        'media_id must be a lowercase canonical uuid and nothing else',
      );
    }
  });

  it('carries the ROW id, not a value derived from order or position', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    const byUrl = new Map(block.items.map((i) => [i.url, i.media_id]));
    for (const row of STAGING_LISTING_IMAGE_ROWS) {
      assert.equal(
        byUrl.get(row.image_url), row.id,
        `${row.image_url} must publish its own listing_images.id`,
      );
    }
  });

  it('is STABLE: two independent projections of the same rows agree item for item', () => {
    const first = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    const second = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS.map((r) => ({ ...r })));
    assert.deepEqual(
      first.items.map((i) => i.media_id),
      second.items.map((i) => i.media_id),
    );
    // Not the same object graph — a shared frozen reference would make this trivially true.
    assert.notEqual(first.items[0], second.items[0]);
  });

  it('is STABLE UNDER RE-ORDERING, where position deliberately is not', () => {
    // The identity must survive the one event that breaks every index-derived scheme: the same
    // photograph arriving in a different slot. `position` SHOULD move here; `media_id` must not.
    const rows = STAGING_LISTING_IMAGE_ROWS.map((r) => ({ ...r, is_primary: false }));
    const forward = toListingMediaBlock(rows);
    const reversed = toListingMediaBlock([...rows].reverse());

    const target = rows[0];
    const inForward = forward.items.find((i) => i.url === target.image_url);
    const inReversed = reversed.items.find((i) => i.url === target.image_url);

    assert.equal(inForward.media_id, inReversed.media_id, 'identity must not depend on arrival order');
    assert.equal(inForward.media_id, target.id);
    // ANTI-VACUITY: prove the re-order actually moved this photograph. If position were equal too,
    // the stability assertion above would be measuring nothing.
    assert.equal(inForward.position, 0);
    assert.equal(inReversed.position, 2);
    assert.notEqual(inForward.position, inReversed.position);
  });

  it('is STABLE when the row is read alongside different siblings', () => {
    const [first, second, third] = STAGING_LISTING_IMAGE_ROWS;
    const alone = toListingMediaBlock([third]);
    const crowded = toListingMediaBlock([first, second, third]);
    const inAlone = alone.items.find((i) => i.url === third.image_url);
    const inCrowded = crowded.items.find((i) => i.url === third.image_url);

    assert.equal(inAlone.media_id, inCrowded.media_id);
    // ANTI-VACUITY: the surrounding set genuinely changed the slot.
    assert.equal(inAlone.position, 0);
    assert.equal(inCrowded.position, 2);
  });

  it('is DISTINCT per item — the identities never collide within a block', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    const ids = block.items.map((i) => i.media_id);
    assert.equal(new Set(ids).size, ids.length, 'two items sharing an identity can never be told apart');
    assert.equal(ids.length, 3);
  });

  it('normalises case, so the same row compares equal with === however it was serialised', () => {
    const upper = { ...STAGING_LISTING_IMAGE_ROWS[0], id: STAGING_LISTING_IMAGE_ROWS[0].id.toUpperCase() };
    const [item] = toListingMediaBlock([upper]).items;
    assert.equal(item.media_id, STAGING_LISTING_IMAGE_ROWS[0].id);
  });

  it('NEVER publishes a private locator as an identity — the uuid grammar is the guard', () => {
    // Every one of these is a real private locator from the two media tables, or a shape that could
    // carry one. None may survive `toMediaIdentity`, so no future row can smuggle a storage path
    // into the public body through the `id` slot.
    const LOCATORS = [
      'qa/evidence-73.jpg',                        // vehicle_evidence.file_path, live on staging
      'vehicle-images',                            // vehicle_evidence.storage_bucket, live on staging
      'vehicle-images/qa/evidence-73.jpg',
      'ocr-documents/private/passport.pdf',
      '/uat/owner/subaru-impreza.svg',             // an image_url
      'https://staging.carup.local/qa/evidence-73.jpg',
      'qa-staging-seller-73',                      // uploaded_by
      'tenant-73',                                 // tenant_id
      'sha256:abc',                                // checksum
      '6a4b5b86-fbf2-448e-856e-9fa14299c2d7.jpg',  // a uuid WITH an extension: still a filename
      '../6a4b5b86-fbf2-448e-856e-9fa14299c2d7',
      '', '   ', null, undefined, 42, {}, [],
    ];
    for (const locator of LOCATORS) {
      assert.equal(
        toMediaIdentity(locator), null,
        `${JSON.stringify(locator)} is a locator or a non-identity and must never be published as media_id`,
      );
      assert.equal(isPublishableMediaIdentity(locator), false);
    }
    // ANTI-VACUITY: the guard is not simply rejecting everything.
    assert.equal(toMediaIdentity(STAGING_LISTING_IMAGE_ROWS[0].id), STAGING_LISTING_IMAGE_ROWS[0].id);
    assert.equal(isPublishableMediaIdentity(STAGING_LISTING_IMAGE_ROWS[0].id), true);
  });

  it('publishes no substring of any private locator anywhere in a built block', () => {
    const block = toListingMediaBlock(STAGING_LISTING_IMAGE_ROWS);
    const serialized = JSON.stringify(block);
    for (const secret of ['vehicle-images', 'ocr-documents', 'qa/evidence', 'tenant-', 'uploaded_by', 'file_path', 'storage_bucket']) {
      assert.ok(!serialized.includes(secret), `${secret} reached the listing block`);
    }
  });

  it('treats a row with NO usable identity as unpublishable, and COUNTS it', () => {
    // Fail closed, and loudly. An item published with a null identity would collide with every
    // other identity-less item the moment a consumer keyed anything on it.
    const rows = [
      { ...STAGING_LISTING_IMAGE_ROWS[0] },
      { vin: 'X', image_url: '/a.jpg', is_primary: false, display_order: 1 },            // no id at all
      { id: null, vin: 'X', image_url: '/b.jpg', is_primary: false, display_order: 2 },
      { id: 'not-a-uuid', vin: 'X', image_url: '/c.jpg', is_primary: false, display_order: 3 },
      { id: 'qa/evidence-73.jpg', vin: 'X', image_url: '/d.jpg', is_primary: false, display_order: 4 },
    ];
    const block = toListingMediaBlock(rows);
    assert.equal(block.items.length, 1, 'only the row with a real uuid may be published');
    assert.equal(block.items[0].media_id, STAGING_LISTING_IMAGE_ROWS[0].id);
    assert.equal(block.unpublishable_count, 4, 'the four identity-less rows must be counted, not dropped');
    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    for (const item of block.items) assert.notEqual(item.media_id, null);
  });

  it('counts a REPEATED identity instead of publishing two items that cannot be told apart', () => {
    const dup = STAGING_LISTING_IMAGE_ROWS[0];
    const block = toListingMediaBlock([
      { ...dup, image_url: '/first.jpg', display_order: 0 },
      { ...dup, image_url: '/second.jpg', display_order: 1 },
    ]);
    assert.equal(block.items.length, 1, 'first occurrence wins');
    assert.equal(block.items[0].url, '/first.jpg');
    assert.equal(block.unpublishable_count, 1);
    assert.equal(new Set(block.items.map((i) => i.media_id)).size, block.items.length);
  });

  it('keeps identity OUT of the not_loaded and none states — nothing is invented', () => {
    assert.deepEqual(toListingMediaBlock(undefined).items, []);
    assert.deepEqual(toListingMediaBlock([]).items, []);
  });

  it('does NOT break the disjointness proof: media_id belongs to one item shape only', () => {
    assert.ok(LISTING_MEDIA_ITEM_FIELDS.includes('media_id'));
    assert.equal(
      EVIDENCE_MEDIA_ITEM_FIELDS.includes('media_id'), false,
      'media_id must never appear on an evidence item',
    );
    // It is spelled `media_id` PRECISELY because evidence already publishes `id`.
    assert.ok(PUBLIC_EVIDENCE_FIELDS.includes('id'), 'evidence has published a row id since Phase 0');
    assert.equal(
      LISTING_MEDIA_ITEM_FIELDS.includes('id'), false,
      'keying the listing identity as `id` would collapse the disjointness proof',
    );
    const overlap = LISTING_MEDIA_ITEM_FIELDS.filter((f) => EVIDENCE_MEDIA_ITEM_FIELDS.includes(f));
    assert.deepEqual(overlap, []);

    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.deepEqual(findMediaBlockCrossContamination(media), []);
    assert.ok(media.listing_media.items.length > 0 && media.verified_evidence.items.length > 0);
  });

  it('leaves the Phase 0 private-field leak scan empty, and authors no trust language', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.deepEqual(findPrivateFieldLeaks(media.listing_media), []);
    assert.deepEqual(findTrustLanguage(media.listing_media), []);
    // ANTI-VACUITY: the scanners are live on this payload, not silently skipping it.
    assert.ok(PRIVATE_VEHICLE_FIELDS.length >= 5);
    assert.ok(media.listing_media.items.length > 0);
  });

  it('SYMMETRY: both item shapes now carry an identity, each under its own key', () => {
    const media = toVehicleMedia({
      listingPublicationStatus: PUBLISHED_LISTING_STATUS,
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    // This is the justification for the field existing at all: evidence was addressable and the
    // gallery was not. Both are now, and neither borrowed the other's key name.
    assert.equal(media.verified_evidence.items[0].id, STAGING_EVIDENCE_ROW.id);
    assert.equal(media.listing_media.items[0].media_id, STAGING_LISTING_IMAGE_ROWS[0].id);
    assert.equal('media_id' in media.verified_evidence.items[0], false);
    assert.equal('id' in media.listing_media.items[0], false);
  });
});

// ── 9. THE WIRING — buildVehiclePassport ACTUALLY COMPOSES THE CONTRACT ───────────────────────
/**
 * WHY THIS SECTION EXISTS. Everything above tests the MODULE. An independent certifier mutated the
 * WIRING and found the fix for the defect that named this phase completely untested — three
 * mutations survived the entire 3749-test backend suite:
 *
 *   M1  delete the `listing_images` read from buildVehiclePassport   -> 0 tests died
 *   M2  delete the `...(vehicleMedia ?? {})` spread from the body     -> 0 tests died
 *   M3  the routes stop passing `toVehicleMedia` as the 6th argument  -> 0 tests died
 *
 * The cause was structural: `toVehicleMedia` appeared in exactly one test file, which exercised the
 * module and never the passport, while all four passport-executing suites call the builder with <= 5
 * arguments — so `mediaContract` defaulted to `null` and they asserted the UNWIRED shape and were
 * right to. A silent revert therefore reopened the original defect invisibly.
 *
 * That is not academic. For a VIN carrying `listing_images` rows but NO public marketplace listing,
 * the passport is the ONLY transport — marketplace detail 404s — so an unwired passport is an empty
 * gallery with no fallback.
 *
 * These tests execute the SHIPPED buildVehiclePassport SOURCE against stub collaborators, with the
 * 6th argument supplied, so the read, the composition and the spread are all on the executed path.
 */

function sliceBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced braces');
}

function buildVehiclePassportSource() {
  const declIdx = serverSrc.indexOf('async function buildVehiclePassport');
  assert.ok(declIdx > -1, 'buildVehiclePassport must still exist in server.js');
  const braceIdx = serverSrc.indexOf('{', serverSrc.indexOf(')', declIdx));
  return serverSrc.slice(declIdx, braceIdx) + sliceBalanced(serverSrc, braceIdx);
}

/**
 * The SAME fixed 11-name dependency list the Phase 0 and Phase 4 harnesses use. Kept identical on
 * purpose: `mediaContract` is a PARAMETER, not a free module-scope name, precisely so this list does
 * not grow — and if it ever must, all three harnesses fail together rather than one silently.
 */
const PASSPORT_DEPENDENCIES = [
  'supabase', 'getVehicleTimeline', 'normalizeEvidenceRecord', 'mergeEventsWithEvidence',
  'computeVehicleTrustScore', 'verifyChain', 'projectVehicle', 'toPublicEvidence',
  'toPublicPlateHistory', 'toPublicTimelineEvent', 'PASSPORT_PRIVILEGED_ROLES',
];

const WIRED_VIN = 'JF1GPAL60J9UAT303';

function passportVehicleRow() {
  return {
    vin: WIRED_VIN, make: 'Subaru', model: 'Impreza', generation: null, trim: null, year: 2018,
    color: 'Blue', mileage: 78000, fuel_type: 'Petrol', transmission: 'Automatic', drivetrain: 'AWD',
    price: 9500, currency: 'USD', currency_source: 'seller_declared',
    status: 'Available', publication_status: 'published', created_at: '2026-06-09T04:30:41Z',
    import_source: 'local', vehicle_condition_category: 'unknown',
    duty_paid: false, police_verified: false, zimra_verified: false, passport_verified: false,
    inspection_ready: false, safe_pay_ready: false,
    public_seller_display_enabled: false,
    owner_id: 'owner-1', tenant_id: null, current_seller_id: null,
    plate_number: 'ABC1234', normalized_plate_number: 'ABC1234',
    chassis_number: 'CH-9', engine_number: 'EN-9',
    temp_plate_id: null, temporary_identification_number: null, trust_score: 84,
  };
}

/**
 * Instantiate the shipped passport with a supabase stub whose `listing_images` table serves
 * `listingImageRows`. `listingImagesFails` reproduces a failed gallery read, which must degrade to
 * `not_loaded` rather than to a false "no photos".
 */
function instantiateWiredPassport({ listingImageRows = [], evidenceRows = [], listingImagesFails = false } = {}) {
  // The stub HONOURS `.select()`, projecting each row to exactly the named columns — as PostgREST
  // does. That is what makes this harness catch a narrowed query BEHAVIOURALLY: drop `id` from the
  // gallery read and the rows arrive without one, every item becomes unpublishable for want of an
  // identity, and the gallery empties. A stub that ignored the column list would hand the projection
  // an `id` the real query never asked for, and the test would pass over a dead surface.
  const queryStub = (data, error = null) => {
    let columns = null;
    const project = (row) => {
      if (!columns || !row || typeof row !== 'object') return row;
      return Object.fromEntries(columns.map((c) => [c, row[c]]));
    };
    const projected = () => (Array.isArray(data) ? data.map(project) : project(data));
    const builder = {
      select: (cols) => {
        columns = typeof cols === 'string' && cols !== '*'
          ? cols.split(',').map((c) => c.trim())
          : null;
        return builder;
      },
      eq: () => builder, order: () => builder,
      single: async () => ({ data: projected(), error }),
      then: (resolve, reject) => Promise.resolve({ data: projected(), error }).then(resolve, reject),
    };
    return builder;
  };
  const supabase = {
    from(table) {
      switch (table) {
        case 'vehicles': return queryStub(passportVehicleRow());
        case 'users': return queryStub({ name: 'Jane Owner' });
        case 'vehicle_evidence': return queryStub(evidenceRows);
        case 'listing_images':
          return listingImagesFails
            ? queryStub(null, { message: 'permission denied for table listing_images' })
            : queryStub(listingImageRows);
        default: return queryStub([]);
      }
    },
  };
  const factory = new Function(...PASSPORT_DEPENDENCIES, `return (${buildVehiclePassportSource()});`);
  return factory(
    supabase,
    async () => [],
    (record) => record,
    (events) => events,
    async () => ({ metrics: null }),
    async () => ({ verified: false, count: 0, chain: [] }),
    projectVehicle, toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent,
    new Set(['admin', 'government']),
  );
}

/** Anonymous caller, with the media contract WIRED as the 6th argument — as the routes do. */
const buildWiredPassport = (opts) =>
  instantiateWiredPassport(opts)(WIRED_VIN, {}, null, toListingClaims, attestedValue, toVehicleMedia);

describe('Phase 5 — the passport is wired to the media contract (kills M1/M2/M3)', () => {
  it('M1/M2 GUARD: reads listing_images and publishes it as listing_media with real identities', async () => {
    const rows = STAGING_LISTING_IMAGE_ROWS.filter((r) => r.vin === WIRED_VIN);
    assert.equal(rows.length, 1, 'anti-vacuity: the fixture must actually carry a row for this VIN');

    const passport = await buildWiredPassport({ listingImageRows: rows });

    // M2: the spread must put the key on the BODY.
    assert.ok('listing_media' in passport, 'the passport body must carry listing_media');
    assert.ok('verified_evidence' in passport, 'the passport body must carry verified_evidence');
    // M1: the read must have happened and produced the row's own url AND its own identity.
    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(passport.listing_media.items.length, 1);
    assert.equal(passport.listing_media.items[0].url, '/uat/owner/subaru-impreza.svg');
    assert.equal(passport.listing_media.items[0].media_id, rows[0].id);
    assert.deepEqual(Object.keys(passport.listing_media.items[0]).sort(), [...LISTING_MEDIA_ITEM_FIELDS].sort());
  });

  it('M1 GUARD: identity survives the passport transport unchanged, and is not position', async () => {
    // Two rows, so `position` has somewhere to move and cannot masquerade as an identity.
    const rows = [
      { ...STAGING_LISTING_IMAGE_ROWS[0], vin: WIRED_VIN, is_primary: false, display_order: 1 },
      { ...STAGING_LISTING_IMAGE_ROWS[1], vin: WIRED_VIN, is_primary: false, display_order: 0 },
    ];
    const forward = await buildWiredPassport({ listingImageRows: rows });
    const reversed = await buildWiredPassport({ listingImageRows: [...rows].reverse() });

    const idOf = (p, url) => p.listing_media.items.find((i) => i.url === url).media_id;
    const posOf = (p, url) => p.listing_media.items.find((i) => i.url === url).position;
    const url = STAGING_LISTING_IMAGE_ROWS[0].image_url;

    assert.equal(idOf(forward, url), STAGING_LISTING_IMAGE_ROWS[0].id);
    assert.equal(idOf(forward, url), idOf(reversed, url), 'identity must be stable across two passport reads');
    // ANTI-VACUITY: `display_order` fixes the slot, so position is stable here too; assert instead
    // that identity and position are simply different values, so one cannot be standing in for the
    // other. The re-ordering proof itself lives in the projection suite above.
    assert.notEqual(String(idOf(forward, url)), String(posOf(forward, url)));
    assert.equal(new Set(forward.listing_media.items.map((i) => i.media_id)).size, 2);
  });

  it('M1 GUARD: a FAILED listing_images read degrades to not_loaded, never to "no photos"', async () => {
    const passport = await buildWiredPassport({ listingImagesFails: true });
    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(passport.listing_media.empty_statement, null,
      'a read that failed may not publish a negative about the seller');
    assert.deepEqual(passport.listing_media.items, []);
  });

  it('M1 GUARD: an EMPTY listing_images read says "no photos", which is a different fact', async () => {
    const passport = await buildWiredPassport({ listingImageRows: [] });
    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(passport.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    // The two media blocks answer independently — the original defect was one sentence for both.
    assert.equal(passport.verified_evidence.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(passport.verified_evidence.empty_statement, VERIFIED_EVIDENCE_EMPTY_STATEMENT);
    assert.notEqual(passport.listing_media.empty_statement, passport.verified_evidence.empty_statement);
  });

  it('M2 GUARD: an UNWIRED passport publishes NEITHER key — absence is not an empty gallery', async () => {
    // The 6th argument omitted, exactly as the four pre-existing passport suites call it. This is
    // the shape those suites legitimately assert, pinned here so the DIFFERENCE between wired and
    // unwired is itself under test rather than inferred.
    const unwired = await instantiateWiredPassport({
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
    })(WIRED_VIN, {}, null, toListingClaims, attestedValue);
    assert.equal('listing_media' in unwired, false);
    assert.equal('verified_evidence' in unwired, false);
  });

  it('M3 GUARD: every route that builds a passport passes the media contract', () => {
    // The routes call supabase directly and cannot be instantiated here, so this is asserted on the
    // shipped source. It is the mutation stated literally: a call site that stops passing
    // `toVehicleMedia` fails this test by name.
    const callSites = [...serverSrc.matchAll(/await buildVehiclePassport\(([^;]*?)\);/gs)];
    assert.ok(callSites.length >= 2, `expected the passport route and the lookup route, found ${callSites.length}`);
    for (const [whole, args] of callSites) {
      assert.ok(
        args.includes('toVehicleMedia'),
        `a buildVehiclePassport call site does not pass the media contract, so its gallery is dead:\n${whole}`,
      );
    }
    // ANTI-VACUITY: the matcher finds real call sites, and the module-scope import backing them.
    //
    // CORRECTED IN LANE B, because it had become false. This asserted the import as an EXACT LINE,
    // `import { toVehicleMedia } from './utils/vehicleMediaProjection.js';`. That line now carries a
    // second name — `isPublishableMediaUrl`, which `POST /api/vehicles/add` gates writes on so that
    // ONE definition of publishable governs the writer and the reader alike. The exact-string form
    // made "import anything else from the canonical module" a test failure, which is a constraint
    // this guard was never about and nobody intended.
    //
    // The GUARANTEE is unchanged and is stated directly instead: `toVehicleMedia` — the name every
    // call site above passes — is imported at module scope FROM THE CANONICAL MODULE. Deleting the
    // import, or satisfying the call sites from some other module, still fails here by name.
    const mediaImport = serverSrc.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/utils\/vehicleMediaProjection\.js';/);
    assert.ok(mediaImport, 'server.js must import from the canonical media projection module');
    assert.ok(
      mediaImport[1].split(',').map((name) => name.trim()).includes('toVehicleMedia'),
      'the contract every call site passes must be the canonical one, not a local stand-in',
    );
    assert.equal(callSites.length, 2);
  });

  it('M1 GUARD: the listing_images read selects the identity column it publishes', () => {
    const fnSrc = buildVehiclePassportSource();
    assert.ok(
      fnSrc.includes("from('listing_images')"),
      'buildVehiclePassport must still read listing_images — this is the defect this phase closed',
    );
    assert.ok(
      /\.select\('id, image_url, is_primary, display_order'\)/.test(fnSrc),
      'the gallery read must select `id`, or every item becomes unpublishable for want of an identity',
    );
    assert.ok(
      !/\.select\('[^']*created_at[^']*'\)[\s\S]{0,80}listing_images/.test(fnSrc),
      'listing_images.created_at is an INSERT time and must not be read as a capture time',
    );
  });

  it('publishes no private locator anywhere in a WIRED passport body', async () => {
    const passport = await buildWiredPassport({
      listingImageRows: STAGING_LISTING_IMAGE_ROWS,
      evidenceRows: [STAGING_EVIDENCE_ROW],
    });
    assert.ok(passport.listing_media.items.length > 0, 'anti-vacuity: the block must be populated');
    assert.deepEqual(findPrivateFieldLeaks(passport.listing_media), []);
    assert.deepEqual(findTrustLanguage(passport.listing_media), []);
    assert.deepEqual(findMediaBlockCrossContamination(passport), []);
    const serialized = JSON.stringify(passport.listing_media);
    for (const secret of ['storage_bucket', 'file_path', 'vehicle-images', 'tenant-73', 'qa-staging-seller-73']) {
      assert.ok(!serialized.includes(secret), `${secret} reached listing_media on the passport body`);
    }
  });
});

// ===========================================================================================
// THE WRITE PATH — WHERE THE FABRICATION WAS ACTUALLY COMMITTED
//
// Everything above governs what the READ path is allowed to publish. It cannot govern what the
// column holds, and Rule 6 was being violated one layer underneath all of it: `POST /api/vehicles/
// add` wrote `is_primary: idx === 0`, MANUFACTURING the seller's main-photo choice out of the order
// of a JSON array and persisting it where no reader can distinguish it from a real choice. That is
// what made `primary_image_state: 'seller_primary'` — a label whose entire purpose is to say "the
// seller picked this one" — untruthful for every listing this route ever created.
//
// Reproduced against the shipped handler before the fix, over real HTTP, and each defect is pinned
// by a named test below:
//
//   B1a  two ordinary photos, no primacy expressed anywhere in the request
//          -> row 0 written with `is_primary: true`
//   B1b  five images including `javascript:alert(document.cookie)`, `data:…`, `'   '`, `photo.jpg`
//          -> all five stored verbatim; four of them unpublishable by this very contract; and the
//             `javascript:` one stored AS THE PRIMARY PHOTO, the two defects compounding
//   B1c  the `listing_images` insert fails
//          -> console.error, zero rows stored, and the caller still receives 201 `success: true`
//             with no key in the body mentioning photographs at all
//
// THE SELLER EXPRESSED NOTHING BECAUSE NOTHING ASKS THEM. `SellVehicle.tsx` builds
// `uploadedImageUrls: string[]` and posts it as `images`; the form has no "main photo" control. So
// on 100% of real traffic the correct recording of primacy is ABSENCE — which is what Rule 6 means
// by "the seller's or it does not exist", and what `first_published` exists to label.
// ===========================================================================================
describe('Phase 5 — the write path records the seller`s media, and invents none of it', () => {
  let server;
  let baseUrl;
  let listingImages;
  let vehicles;
  let failImageInsert;

  const OWNER_ID = 'usr-1001';
  const BASE_BODY = { make: 'Toyota', model: 'Hilux', year: 2021, price: 25000, currency: 'USD', mileage: 42000 };

  function reset() { listingImages = []; vehicles = []; failImageInsert = false; }

  function handle(op) {
    if (op.table === 'users') {
      return { data: { id: OWNER_ID, name: 'Jane Owner', role: 'owner', is_verified: true }, error: null };
    }
    if (op.table === 'tenant_users') return { data: { role: 'owner' }, error: null };
    if (op.table === 'listing_images') {
      if (op.action === 'insert') {
        if (failImageInsert) {
          return { data: null, error: { code: '23503', message: 'violates foreign key constraint' } };
        }
        for (const row of (Array.isArray(op.payload) ? op.payload : [op.payload])) listingImages.push({ ...row });
        return { data: null, error: null };
      }
      return { data: listingImages, error: null, count: listingImages.length };
    }
    if (op.table === 'vehicles') {
      if (op.action === 'insert') {
        vehicles.push({ ...(Array.isArray(op.payload) ? op.payload[0] : op.payload) });
        return { data: null, error: null };
      }
      if (op.action === 'update') return { data: null, error: null };
      const matched = vehicles.filter((row) => Object.entries(op.filters).every(([k, v]) => row[k] === v));
      if (op.single) {
        return matched.length ? { data: matched[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: matched, error: null, count: matched.length };
    }
    if (op.single) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: [], error: null, count: 0 };
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';
    reset();
    const { app } = await import('../server.js');
    const { supabase } = await import('../db/supabase.js');
    supabase.from = (table) => {
      const op = { table, action: 'select', filters: {}, payload: null, single: false };
      const declared = {
        select() { return proxy; },
        insert(payload) { op.action = 'insert'; op.payload = payload; return proxy; },
        upsert(payload) { op.action = 'insert'; op.payload = payload; return proxy; },
        update(payload) { op.action = 'update'; op.payload = payload; return proxy; },
        delete() { op.action = 'delete'; return proxy; },
        eq(key, value) { op.filters[key] = value; return proxy; },
        maybeSingle() { op.single = true; return proxy; },
        single() { op.single = true; return proxy; },
        then(f, r) { return Promise.resolve(handle(op)).then(f, r); },
      };
      const proxy = new Proxy(declared, {
        get(target, property) {
          if (property in target) return target[property];
          if (typeof property === 'symbol') return undefined;
          return () => proxy;
        },
      });
      return proxy;
    };
    await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
  beforeEach(reset);

  let vinCounter = 0;
  /** A distinct legal VIN per call — the handler 409s on a VIN it has already seen. */
  const nextVin = () => `1HGBH41JXMN1091${String(80 + (vinCounter += 1)).slice(-2)}`;

  async function addVehicle(body) {
    const response = await fetch(`${baseUrl}/api/vehicles/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bypass-rate-limit': 'true', 'x-user-id': OWNER_ID },
      body: JSON.stringify({ ...BASE_BODY, vin: nextVin(), ...body }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  // -- B1a: PRIMACY -----------------------------------------------------------------------------

  it('B1a: a request that expresses NO primacy writes NO primacy', async () => {
    const { status, body } = await addVehicle({ images: ['https://cdn.carup.dev/a.jpg', 'https://cdn.carup.dev/b.jpg'] });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(listingImages.length, 2, 'anti-vacuity: both photos must actually have been written');
    assert.deepEqual(listingImages.map((row) => row.is_primary), [false, false],
      '`is_primary: idx === 0` fabricated the seller`s choice from array order. A bare URL string '
      + 'expresses no primacy — which is what every real client sends, because the form has no '
      + '"main photo" control — so absence must be recorded as absence.');
    assert.equal(body.images_primary_recorded, false);
  });

  it('B1a: the projection then reports first_published, and the DISPLAYED photo is unchanged', async () => {
    await addVehicle({ images: ['https://cdn.carup.dev/a.jpg', 'https://cdn.carup.dev/b.jpg'] });
    const written = listingImages.map((row, i) => ({ ...row, id: `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${i + 1}` }));
    const block = toListingMediaBlock(written);

    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(block.items.some((item) => item.is_primary), false, 'nobody claimed, so nobody is primary');
    // THE POINT: withdrawing the fabricated claim does not move the picture. The block sorts
    // claimants first and then by `display_order`, and image 0 still carries `display_order: 0`.
    assert.equal(block.items[0].url, 'https://cdn.carup.dev/a.jpg',
      'the same photograph is still shown first — only the LABEL on it stops asserting a choice');
    assert.equal(block.items[0].position, 0);
  });

  it('B1a: a primacy the seller REALLY expressed is recorded verbatim', async () => {
    // The defect was the invention, not the column. An explicit choice still travels end to end.
    const { status, body } = await addVehicle({
      images: [
        { url: 'https://cdn.carup.dev/a.jpg' },
        { url: 'https://cdn.carup.dev/b.jpg', is_primary: true },
      ],
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.deepEqual(listingImages.map((row) => row.is_primary), [false, true],
      'the SECOND image is the seller`s choice, and array order must not override it');
    assert.equal(body.images_primary_recorded, true);
  });

  it('B1a: only `is_primary === true` is a claim — truthy-ish values are not consent', async () => {
    await addVehicle({
      images: [
        { url: 'https://cdn.carup.dev/a.jpg', is_primary: 'yes' },
        { url: 'https://cdn.carup.dev/b.jpg', is_primary: 1 },
      ],
    });
    assert.deepEqual(listingImages.map((row) => row.is_primary), [false, false],
      'primacy must not be acquirable by accident from a loosely-typed client');
  });

  it('B1a: TWO primaries is a contradiction and is refused before anything is written', async () => {
    const { status, body } = await addVehicle({
      images: [
        { url: 'https://cdn.carup.dev/a.jpg', is_primary: true },
        { url: 'https://cdn.carup.dev/b.jpg', is_primary: true },
      ],
    });

    assert.equal(status, 400, JSON.stringify(body));
    assert.match(body.error, /one image may be marked is_primary/i);
    assert.equal(vehicles.length, 0, 'the refusal must come BEFORE the vehicle row, not leave a half-made listing');
    assert.equal(listingImages.length, 0);
  });

  // -- B1b: URL VALIDATION AT THE DOOR ----------------------------------------------------------

  it('B1b: a URL this contract will not publish is never stored', async () => {
    const { status, body } = await addVehicle({
      images: [
        'javascript:alert(document.cookie)',
        'data:image/png;base64,AAAA',
        '   ',
        'photo.jpg',
        'https://cdn.carup.dev/real.jpg',
      ],
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(listingImages.length, 1, 'exactly the one publishable image is stored');
    assert.equal(listingImages[0].image_url, 'https://cdn.carup.dev/real.jpg');
    for (const row of listingImages) {
      assert.ok(isPublishableMediaUrl(row.image_url),
        'the write path must gate on the SAME definition the read path publishes by — one definition, imported');
    }
    // The compounding defect: the refused value used to be stored AND elected as the main photo.
    assert.equal(listingImages.some((row) => String(row.image_url).startsWith('javascript:')), false);
  });

  it('B1b: refused URLs are COUNTED to the caller, never silently discarded', async () => {
    const { body } = await addVehicle({
      images: ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://cdn.carup.dev/real.jpg'],
    });

    assert.equal(body.images_unpublishable_count, 2,
      'silently dropping them is the same lie as "no photos" for a read that failed — Rule 5, one layer up');
    assert.equal(body.images_recorded, true);
    assert.equal(body.images_recorded_count, 1);
  });

  it('B1b: display_order stays dense over the images that were actually stored', async () => {
    await addVehicle({
      images: ['javascript:alert(1)', 'https://cdn.carup.dev/a.jpg', 'data:image/png;base64,AA', 'https://cdn.carup.dev/b.jpg'],
    });
    assert.deepEqual(listingImages.map((row) => row.display_order), [0, 1],
      'a refused URL must not leave a hole in the running order');
  });

  it('B1b: a listing whose photos are ALL unpublishable is still created, and says so', async () => {
    const { status, body } = await addVehicle({ images: ['javascript:alert(1)', 'photo.jpg'] });
    assert.equal(status, 201, 'a bad photo URL does not void a real vehicle listing');
    assert.equal(listingImages.length, 0);
    assert.equal(body.images_recorded, false);
    assert.equal(body.images_unpublishable_count, 2);
  });

  // -- B1c: HONESTY ON FAILURE ------------------------------------------------------------------

  it('B1c: a failed image insert is REPORTED, not just logged', async () => {
    failImageInsert = true;
    const { status, body } = await addVehicle({ images: ['https://cdn.carup.dev/a.jpg', 'https://cdn.carup.dev/b.jpg'] });

    assert.equal(status, 201, 'the VEHICLE was created, so 500 would be its own untruth');
    assert.equal(listingImages.length, 0, 'anti-vacuity: the insert really did fail');
    assert.equal(body.images_recorded, false,
      'the shipped handler console.error`d this and returned success:true — the seller was told their '
      + 'listing was saved and reasonably understood that to include the photographs they had uploaded');
    assert.equal(body.images_recorded_count, 0);
    assert.equal(body.images_primary_recorded, false);
  });

  it('B1c: it follows Phase 4`s location_recorded idiom rather than inventing one', async () => {
    failImageInsert = true;
    const { body } = await addVehicle({ images: ['https://cdn.carup.dev/a.jpg'], location: 'Harare' });
    // Both sub-facts of the same 201 report themselves the same way, in the same body.
    assert.equal(typeof body.location_recorded, 'boolean');
    assert.equal(typeof body.images_recorded, 'boolean');
    assert.equal(body.images_recorded, false);
  });

  it('B1c: a successful write reports what was stored', async () => {
    const { body } = await addVehicle({ images: ['https://cdn.carup.dev/a.jpg', 'https://cdn.carup.dev/b.jpg'] });
    assert.equal(body.images_recorded, true);
    assert.equal(body.images_recorded_count, 2);
    assert.equal(body.images_unpublishable_count, 0);
  });

  it('B1c: a listing with no photos at all reports no photos, and does not fail', async () => {
    const { status, body } = await addVehicle({});
    assert.equal(status, 201);
    assert.equal(body.images_recorded, false);
    assert.equal(body.images_recorded_count, 0);
    assert.equal(body.images_unpublishable_count, 0);
  });

  // -- THE SOURCE-LEVEL PIN ---------------------------------------------------------------------

  it('the fabricating line is GONE from the shipped source, and one definition governs both sides', () => {
    // Scanned over CODE, not prose. The handler now carries a comment quoting the defect verbatim
    // (`is_primary: idx === 0`) to explain why primacy is recorded the way it is, and a scan that
    // could not tell a comment from a statement would force that explanation to be deleted in order
    // to satisfy the rule it explains — measured: this assertion failed against the fixed source
    // until the stripper was added.
    const executable = serverSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    assert.equal(/is_primary:\s*idx\s*===\s*0/.test(executable), false,
      'the fabrication, as it was written');
    assert.equal(/is_primary:\s*(?:index|i)\s*===\s*0/.test(executable), false,
      'and it must not come back under a different loop variable');
    // Anti-vacuity for the stripper itself: it must not have eaten the whole file.
    assert.ok(executable.includes("app.post('/api/vehicles/add'"), 'the stripped source must still contain the handler');
    assert.ok(executable.includes('is_primary: entry.claimsPrimary'), 'and the corrected line must be present in CODE');
    assert.ok(/import\s*\{[^}]*isPublishableMediaUrl[^}]*\}\s*from\s*'\.\/utils\/vehicleMediaProjection\.js'/.test(serverSrc),
      'the write path must gate on the CANONICAL definition of publishable, imported rather than restated — '
      + 'a second copy of that rule is how the reader and the writer drift apart');
  });
});

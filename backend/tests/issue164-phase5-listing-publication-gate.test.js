/**
 * Issue #164 Phase 5 — THE LISTING PUBLICATION GATE (contract Rule 1b).
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
 * Phase 5 gave `buildVehiclePassport` a `listing_images` read. `listing_images` is keyed by VIN,
 * the passport resolves by VIN, and the passport applies no marketplace visibility filter — so the
 * moment that read landed, a photograph on an UNPUBLISHED listing became reachable by any anonymous
 * caller holding the VIN, on a surface where the marketplace answers 404. Reproduced against the
 * shipped handler before the fix, on the live staging pair:
 *
 *   vehicles.vin = 'WBA8E9C50JNUAT202', publication_status = 'draft'
 *   listing_images fb7b28c2-c6d5-443e-9758-0b7a790be6f2 -> /uat/owner/bmw-320i.svg
 *
 *   anonymous passport, BEFORE:
 *     { state: 'published', items: [{ media_id: 'fb7b28c2…', url: '/uat/owner/bmw-320i.svg',
 *       url_form: 'site_relative', position: 0, is_primary: true }],
 *       unpublishable_count: 0, empty_statement: null }
 *
 * Nothing decided that. Neither Phase 5 document contains the string `draft` or
 * `publication_status`; the widening fell out of the wiring.
 *
 * ── THE DECISION, AND THE TRAP INSIDE IT ──────────────────────────────────────────────────────
 * Anonymous callers get listing media only for a PUBLISHED listing. Owner, admin and government
 * keep the access they had, through the paths that already govern them.
 *
 * The trap is that the obvious redactions are both worse than the leak:
 *
 *   · `state: 'none'` + "No photos have been added to this listing." replaces a disclosure with a
 *     NEW PUBLIC FALSEHOOD — photos WERE added. A redaction that makes the product lie is not a fix.
 *   · a `withheld` state, or `unpublishable_count` counting the hidden rows, answers "does this
 *     unpublished listing have photographs?" with the pixels removed. That is the question the gate
 *     exists to refuse.
 *
 * So the gated block must be TRUE of a draft listing AND of a genuinely empty one and must
 * DISTINGUISH NEITHER — the non-enumerable shape `passportLookupPolicy.NON_ENUMERABLE_LOOKUP_RESPONSE`
 * already uses for restricted identifier lookups, expressed in this contract's own vocabulary rather
 * than a parallel one. Non-enumerability is not asserted here; it is MEASURED, byte for byte, and
 * over every unpublished status rather than over `draft` alone.
 *
 * ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────────────────────────
 * It does not gate `verified_evidence`, and Suite 5 proves that it cannot: evidence is truth about
 * a VEHICLE and listing media is content on a LISTING, and a verified registration document does
 * not stop being true because nobody is advertising the car. Conflating the two is the error this
 * phase exists to remove.
 *
 * Every behavioural claim below EXECUTES THE SHIPPED `buildVehiclePassport` SOURCE, extracted from
 * `backend/server.js` and instantiated over the same fixed 11-name dependency list that the Phase 0,
 * Phase 4 and Phase 5 wiring harnesses use. A copy would keep passing after the shipped function
 * changed, which is the failure mode all four of these harnesses exist to close.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MEDIA_BLOCK_STATES,
  MEDIA_BLOCK_ENVELOPE_FIELDS,
  LISTING_MEDIA_EMPTY_STATEMENT,
  VERIFIED_EVIDENCE_EMPTY_STATEMENT,
  LISTING_PUBLICATION_STATES,
  LISTING_MEDIA_AUDIENCES,
  resolveListingPublication,
  toGatedListingMediaBlock,
  toListingMediaBlock,
  toVehicleMedia,
  findTrustLanguage,
} from '../utils/vehicleMediaProjection.js';
import {
  isPubliclyVisiblePublication,
  publiclyVisiblePublicationStatuses,
} from '../utils/vehicleStatus.js';
import { NON_ENUMERABLE_LOOKUP_RESPONSE } from '../utils/passportLookupPolicy.js';
import {
  projectVehicle, toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent,
  toListingClaims, attestedValue,
} from '../utils/publicVehicleProjection.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const listingSummarySrc = readFileSync(
  new URL('../services/marketplace/listingSummaryService.js', import.meta.url), 'utf8',
);
const listingDetailSrc = readFileSync(
  new URL('../services/marketplace/marketplaceListingDetailService.js', import.meta.url), 'utf8',
);
const moderationSrc = readFileSync(
  new URL('../services/marketplace/marketplaceModerationService.js', import.meta.url), 'utf8',
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REAL VOCABULARY — measured read-only on staging (ref eoyenigwevnxwwhyhaer) at this SHA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `vehicles_publication_status_check`, verbatim from `pg_constraint`:
 *
 *   CHECK (publication_status = ANY (ARRAY['draft', 'identity_complete', 'documents_submitted',
 *                                          'review_pending', 'publishable', 'published']))
 *
 * The column is `text NOT NULL DEFAULT 'draft'` on `public.vehicles`. THERE IS NO SEPARATE LISTINGS
 * TABLE: the listing IS the vehicle row. `vehicle_listing_summaries` and `listing_snapshots` both
 * exist and both hold ZERO rows (the former is being dropped by this very issue — see
 * `issue164-dead-listing-summary.test.js`), and `listing_images.vin` is FK'd to `vehicles(vin)` ON
 * DELETE CASCADE with zero orphans, so there is no third table where publication could live.
 */
const PUBLICATION_STATUS_VOCABULARY = Object.freeze([
  'draft', 'identity_complete', 'documents_submitted', 'review_pending', 'publishable', 'published',
]);

/** Live distribution over 16 rows: 14 `published`, 2 `draft`, and every row `status = 'Available'`. */
const STAGING_PUBLICATION_DISTRIBUTION = Object.freeze({ published: 14, draft: 2 });

const DRAFT_VIN = 'WBA8E9C50JNUAT202';
const PUBLISHED_EMPTY_VIN = '1HGBH41JXMN109186';

/** The live row that made the leak material: a draft listing carrying one photograph. */
const DRAFT_IMAGE = Object.freeze({
  id: 'fb7b28c2-c6d5-443e-9758-0b7a790be6f2', vin: DRAFT_VIN,
  image_url: '/uat/owner/bmw-320i.svg', is_primary: true, display_order: 0,
});

/** A second and third photograph, so "one hidden photo" is not the only case measured. */
const MORE_IMAGES = Object.freeze([
  Object.freeze({
    id: '5596b493-f21a-40eb-aba5-947b26e76cd5', vin: DRAFT_VIN,
    image_url: '/uat/owner/toyota-corolla.svg', is_primary: false, display_order: 1,
  }),
  Object.freeze({
    id: '6a4b5b86-fbf2-448e-856e-9fa14299c2d7', vin: DRAFT_VIN,
    image_url: 'https://cdn.example.test/vehicle-images/3.jpg', is_primary: false, display_order: 2,
  }),
]);

/** A row this contract cannot publish — so the WITHHELD count can be checked against a real one. */
const UNPUBLISHABLE_IMAGE = Object.freeze({
  id: 'a0f6cf3e-9d64-4a1f-8b0d-6b2c1d9e4f77', vin: DRAFT_VIN,
  image_url: 'data:image/png;base64,iVBORw0KGgo=', is_primary: false, display_order: 3,
});

/** The one live `vehicle_evidence` row: verified + public_safe, i.e. publishable to anyone. */
function evidenceRow(vin) {
  return {
    id: '2a86d385-de18-45ef-9938-1b4f4808abc4', vin,
    evidence_type: 'registration_document', evidence_class: 'ownership_transfer',
    verification_status: 'verified', visibility_level: 'public_safe',
    file_url: 'https://staging.carup.local/qa/evidence-73.jpg',
    captured_at: '2026-06-17 01:24:42.070538+00', uploaded_at: '2026-06-17 01:24:42.070538+00',
    verified_at: '2026-06-17 01:24:42.070538+00', created_at: '2026-06-17 01:24:42.070538+00',
    mime_type: 'image/jpeg', file_size: 1024, trust_score_impact: '5',
    uploaded_by: 'qa-staging-seller-73', verified_by: 'qa-staging-seller-73', tenant_id: null,
    file_path: 'qa/evidence-73.jpg', storage_bucket: 'vehicle-images', verification_notes: null,
  };
}

function vehicleRow(overrides = {}) {
  return {
    vin: DRAFT_VIN, make: 'BMW', model: '320i', year: 2020, color: 'Alpine White',
    mileage: 41300, fuel_type: 'Petrol', transmission: 'Automatic', price: 22500, currency: 'USD',
    status: 'Available',
    publication_status: 'draft',
    owner_id: 'u_uat_ref_owner_2026', tenant_id: null, current_seller_id: null,
    plate_number: 'ABC1234', normalized_plate_number: 'ABC1234',
    chassis_number: 'CH-9', engine_number: 'EN-9',
    registration_country: 'Zimbabwe', registration_authority: 'CVR',
    public_seller_display_enabled: false,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHIPPED-SOURCE HARNESS
// ════════════════════════════════════════════════════════════════════════════════════════════════

function sliceBalanced(src, open, openChar = '{', closeChar = '}') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openChar) depth += 1;
    else if (src[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced delimiters');
}

const PASSPORT_DECLARATION = 'async function buildVehiclePassport';

function buildVehiclePassportSource() {
  const declIdx = serverSrc.indexOf(PASSPORT_DECLARATION);
  assert.ok(declIdx > -1, 'buildVehiclePassport must still exist in server.js — retarget this guard rather than deleting it');
  const braceIdx = serverSrc.indexOf('{', serverSrc.indexOf(')', declIdx));
  return serverSrc.slice(declIdx, braceIdx) + sliceBalanced(serverSrc, braceIdx);
}

/** Every `buildVehiclePassport(` call in the shipped server, with its raw argument text. */
function passportCallSites() {
  const sites = [];
  const needle = 'buildVehiclePassport(';
  let from = 0;
  for (;;) {
    const idx = serverSrc.indexOf(needle, from);
    if (idx === -1) break;
    from = idx + needle.length;
    const before = serverSrc.slice(Math.max(0, idx - PASSPORT_DECLARATION.length - 1), idx);
    if (before.endsWith('async function ') || before.endsWith('function ')) continue;
    sites.push({ lineNumber: serverSrc.slice(0, idx).split('\n').length });
  }
  return sites;
}

function queryStub(data, error = null) {
  let columns = null;
  const project = (row) => {
    if (!columns || !row || typeof row !== 'object') return row;
    return Object.fromEntries(columns.map((c) => [c, row[c]]));
  };
  const projected = () => (Array.isArray(data) ? data.map(project) : project(data));
  const builder = {
    select: (cols) => {
      columns = typeof cols === 'string' && cols !== '*' ? cols.split(',').map((c) => c.trim()) : null;
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    single: async () => ({ data: projected(), error }),
    then: (resolve, reject) => Promise.resolve({ data: projected(), error }).then(resolve, reject),
  };
  return builder;
}

const PASSPORT_DEPENDENCIES = [
  'supabase', 'getVehicleTimeline', 'normalizeEvidenceRecord', 'mergeEventsWithEvidence',
  'computeVehicleTrustScore', 'verifyChain', 'projectVehicle', 'toPublicEvidence',
  'toPublicPlateHistory', 'toPublicTimelineEvent', 'PASSPORT_PRIVILEGED_ROLES',
];

/**
 * Instantiate the SHIPPED source over the fixed 11-name list, recording every table it touches so
 * "the gallery read still runs for a gated caller" is a measurement rather than a claim.
 */
function instantiatePassport({
  vehicle, listingImageRows = [], evidenceRows = [], vehicleReadFails = false,
} = {}) {
  const tablesRead = [];
  const supabase = {
    from(table) {
      tablesRead.push(table);
      switch (table) {
        case 'vehicles':
          return vehicleReadFails
            ? queryStub(null, { message: 'could not connect to server' })
            : queryStub(vehicle);
        case 'users': return queryStub({ name: 'Jane Owner' });
        case 'vehicle_evidence': return queryStub(evidenceRows);
        case 'listing_images': return queryStub(listingImageRows);
        default: return queryStub([]);
      }
    },
  };
  const factory = new Function(...PASSPORT_DEPENDENCIES, `return (${buildVehiclePassportSource()});`);
  const fn = factory(
    supabase,
    async () => [],
    (record) => record,
    (events) => events,
    async () => ({ metrics: null }),
    async () => ({ verified: false, count: 0, chain: [] }),
    projectVehicle, toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent,
    new Set(['admin', 'government']),
  );
  return { fn, tablesRead };
}

const anonymous = () => ({});
const ownerOf = (vehicle) => ({ userContext: { id: vehicle.owner_id, role: 'owner' } });
const adminActor = () => ({ userContext: { id: 'u_admin_1', role: 'admin' } });
const governmentActor = () => ({ userContext: { id: 'u_gov_1', role: 'government' } });
/** Signed in, but neither the owner nor privileged — `isAuthorized` is false for them. */
const strangerActor = () => ({ userContext: { id: 'u_someone_else', role: 'buyer' } });

/** Build a passport through the shipped source, wired exactly as both routes wire it. */
async function buildPassport(fixture, req = anonymous()) {
  const { fn, tablesRead } = instantiatePassport(fixture);
  const passport = await fn(
    fixture.vehicle?.vin ?? DRAFT_VIN, req, null, toListingClaims, attestedValue, toVehicleMedia,
  );
  return { passport, tablesRead };
}

const listingMediaOf = async (fixture, req) => (await buildPassport(fixture, req)).passport.listing_media;
const bytes = (value) => JSON.stringify(value);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 1 — THE REAL VOCABULARY, AND WHERE PUBLICATION ACTUALLY LIVES
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — the publication vocabulary this gate actually reads', () => {

  it('classifies all SIX live statuses, and exactly one of them opens the gate', () => {
    const opened = PUBLICATION_STATUS_VOCABULARY.filter(
      (status) => resolveListingPublication(status) === LISTING_PUBLICATION_STATES.PUBLISHED,
    );
    assert.deepEqual(opened, ['published'],
      'the CHECK constraint permits six statuses and exactly one is public — `publishable` in '
      + 'particular means the completeness gate passed and the seller has NOT pushed the listing '
      + 'live, so treating it as public would make "unpublish" a no-op');
    for (const status of PUBLICATION_STATUS_VOCABULARY.filter((s) => s !== 'published')) {
      assert.equal(resolveListingPublication(status), LISTING_PUBLICATION_STATES.UNPUBLISHED, status);
    }
    // ANTI-VACUITY: six is the measured size of the vocabulary, not a number chosen to fit.
    assert.equal(PUBLICATION_STATUS_VOCABULARY.length, 6);
    assert.equal(STAGING_PUBLICATION_DISTRIBUTION.draft + STAGING_PUBLICATION_DISTRIBUTION.published, 16);
  });

  it('classifies an UNRECOGNISED status as unpublished — a future migration cannot open the gate', () => {
    for (const future of ['archived', 'PUBLISHED', 'Published', 'published ', ' published',
      '  published  ', 'live', 'public', 'published\n']) {
      assert.equal(resolveListingPublication(future), LISTING_PUBLICATION_STATES.UNPUBLISHED,
        `${JSON.stringify(future)} must not open the gate: matching is EXACT and the value is NOT `
        + 'trimmed first, so this gate can never be more permissive than the marketplace filter it '
        + 'shares a value set with — a passport publishing a gallery for a listing the marketplace '
        + 'hides is the two-answers defect this issue exists to close');
    }
  });

  it('classifies an ABSENT or unreadable status as UNDETERMINED, never as published', () => {
    for (const missing of [undefined, null, '', '   ', 0, 1, true, {}, [], NaN]) {
      assert.equal(resolveListingPublication(missing), LISTING_PUBLICATION_STATES.UNDETERMINED,
        `${JSON.stringify(missing) ?? String(missing)} must not resolve to a publication decision`);
    }
  });

  it('shares ONE definition of "publicly visible" with the marketplace, and diverges ONLY on absence', () => {
    // Same value set, from the same function. This is what stops the passport publishing a gallery
    // for a listing the marketplace list and detail both hide.
    for (const status of [...PUBLICATION_STATUS_VOCABULARY, 'some_future_state', 'published ',
      ' published', 'PUBLISHED', '']) {
      assert.equal(
        resolveListingPublication(status) === LISTING_PUBLICATION_STATES.PUBLISHED,
        isPubliclyVisiblePublication(status),
        `the two gates disagree about ${status}, which is two definitions of published`,
      );
    }
    // THE ONE DELIBERATE DIVERGENCE, pinned with its reason so it cannot be "tidied up".
    assert.equal(isPubliclyVisiblePublication(undefined), true,
      'the marketplace helper fails OPEN on an absent value on purpose, so hermetic fixtures '
      + 'predating the publication lifecycle keep flowing through a list filter');
    assert.equal(resolveListingPublication(undefined), LISTING_PUBLICATION_STATES.UNDETERMINED,
      'this gate must NOT inherit that: a gate that opens when it cannot read is not a gate. '
      + 'Reusing isPubliclyVisiblePublication here is the fail-open mutation.');
    assert.equal(publiclyVisiblePublicationStatuses().length, 1);
  });

  it('there is no second place publication could live — the listing IS the vehicle row', () => {
    // Measured on staging: `vehicle_listing_summaries` 0 rows, `listing_snapshots` 0 rows,
    // `listing_images.vin` FK -> vehicles(vin) ON DELETE CASCADE with 0 orphans. So "the listing row
    // is absent entirely" is not a third case for this gate: it collapses into "the vehicle row is
    // absent", which the shipped handler answers by returning null BEFORE any block is built —
    // asserted behaviourally in Suite 3.
    assert.ok(serverSrc.includes("from('vehicles')"), 'the passport still reads the vehicles row itself');
    assert.ok(!serverSrc.includes("from('vehicle_listings')"),
      'a `vehicle_listings` table would be a second home for publication state and would have to be '
      + 'routed through this gate deliberately');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 2 — NON-ENUMERABILITY, MEASURED BYTE FOR BYTE
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — the gated block is non-distinguishing, proven by byte identity', () => {

  it('THE PROOF: a draft listing WITH photos and a published listing WITH NONE are byte-identical', async () => {
    const draftWithPhotos = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES],
    });
    const publishedWithNone = await listingMediaOf({
      vehicle: vehicleRow({ vin: PUBLISHED_EMPTY_VIN, publication_status: 'published' }),
      listingImageRows: [],
    });

    assert.equal(bytes(draftWithPhotos), bytes(publishedWithNone),
      'an anonymous caller must not be able to tell a hidden gallery from an empty one');
    // ANTI-VACUITY: both are real blocks with the full envelope, not two nulls.
    assert.deepEqual(Object.keys(draftWithPhotos).sort(), [...MEDIA_BLOCK_ENVELOPE_FIELDS].sort());
    assert.equal(draftWithPhotos.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(draftWithPhotos.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    // ANTI-VACUITY: the same two fixtures ARE distinguishable to the owner, so the identity above
    // is the gate's doing and not an artefact of the fixtures being the same shape.
    const draftToOwner = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES],
    }, ownerOf(vehicleRow()));
    assert.notEqual(bytes(draftToOwner), bytes(publishedWithNone));
    assert.equal(draftToOwner.items.length, 3);
  });

  it('holds for EVERY unpublished status, not just draft', async () => {
    const reference = bytes(await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'published' }),
      listingImageRows: [],
    }));
    for (const status of PUBLICATION_STATUS_VOCABULARY.filter((s) => s !== 'published')) {
      const block = await listingMediaOf({
        vehicle: vehicleRow({ publication_status: status }),
        listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES],
      });
      assert.equal(bytes(block), reference,
        `${status} produced a distinguishable block — the gate must not leak WHICH pre-publication `
        + 'state a listing is in either, since that is a fact about the seller\'s progress');
    }
  });

  it('the withheld count is ZERO even when the hidden rows include unpublishable ones', async () => {
    const block = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE, UNPUBLISHABLE_IMAGE],
    });
    assert.equal(block.unpublishable_count, 0,
      'a count over withheld rows is a disclosure with the pixels removed — it answers exactly the '
      + 'question the gate exists to refuse');
    assert.equal(bytes(block), bytes(await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'published' }), listingImageRows: [],
    })));
    // ANTI-VACUITY: that row really is unpublishable, and really is counted when it is publishable
    // to see. One unpublishable row, two publishable ones.
    const toOwner = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE, UNPUBLISHABLE_IMAGE],
    }, ownerOf(vehicleRow()));
    assert.equal(toOwner.unpublishable_count, 1);
  });

  it('no url, identity or count of a withheld photograph appears anywhere in the passport body', async () => {
    const { passport } = await buildPassport({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES, UNPUBLISHABLE_IMAGE],
    });
    const serialized = JSON.stringify(passport);
    for (const secret of [
      DRAFT_IMAGE.image_url, DRAFT_IMAGE.id,
      ...MORE_IMAGES.map((row) => row.image_url), ...MORE_IMAGES.map((row) => row.id),
      UNPUBLISHABLE_IMAGE.id, 'data:image',
    ]) {
      assert.ok(!serialized.includes(secret),
        `${secret} reached the anonymous passport body for an unpublished listing`);
    }
  });

  it('the gated block is the SAME COMPUTATION as an empty one, not a lookalike built beside it', () => {
    // Structural, not incidental. `toGatedListingMediaBlock` calls `toListingMediaBlock` over an
    // empty input, so byte identity survives any future change to what an empty block looks like.
    const withheld = toGatedListingMediaBlock([DRAFT_IMAGE, ...MORE_IMAGES], {
      listingPublicationStatus: 'draft', listingAudience: LISTING_MEDIA_AUDIENCES.PUBLIC,
    });
    assert.equal(bytes(withheld), bytes(toListingMediaBlock([])));
    assert.equal(bytes(withheld), bytes(toListingMediaBlock(Object.freeze([]))));
  });

  it('speaks the same non-enumerable language the restricted-lookup policy already uses', () => {
    // Same principle, different layer: the lookup policy answers every unauthenticated restricted
    // lookup identically so the response cannot confirm an identifier exists. This gate answers
    // every unpublished listing identically so the response cannot confirm a photograph exists.
    assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.status, 401);
    assert.ok(Object.isFrozen(NON_ENUMERABLE_LOOKUP_RESPONSE.body));
    assert.ok(!/exist|found|unknown|no such/i.test(NON_ENUMERABLE_LOOKUP_RESPONSE.body.error),
      'the lookup response says nothing about existence — the model this gate follows');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 3 — THE SENTENCE ITSELF
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — the empty statement asserts nothing about whether photos exist', () => {

  it('is true of a hidden gallery, an empty one and an unrenderable one — so it separates none of them', () => {
    assert.equal(LISTING_MEDIA_EMPTY_STATEMENT, 'No photos are published for this listing.');
    // It states what THIS CONTRACT DID (published none). Every word that would state what the
    // SELLER did, or what the TABLE holds, is absent — those are the words that make the three
    // cases distinguishable, and the previous wording ("No photos have been added to this listing.")
    // contained one of them.
    for (const forbidden of ['added', 'add ', 'uploaded', 'upload', 'seller', 'has no', 'does not have',
      'none exist', 'withheld', 'hidden', 'unavailable', 'draft', 'unpublished', 'restricted']) {
      assert.ok(!LISTING_MEDIA_EMPTY_STATEMENT.toLowerCase().includes(forbidden),
        `"${forbidden}" would make the sentence assert something the three cases do not share`);
    }
  });

  it('makes no verification claim, and does not collapse into the evidence sentence', () => {
    assert.deepEqual(findTrustLanguage({ empty_statement: LISTING_MEDIA_EMPTY_STATEMENT }), [],
      'the gallery block may not author governance language — these are seller marketing photos');
    assert.notEqual(LISTING_MEDIA_EMPTY_STATEMENT, VERIFIED_EVIDENCE_EMPTY_STATEMENT,
      'two facts still need two sentences: the gate did not merge Rule 2 away');
  });

  it('is the ONE sentence, so a gated listing and an empty one cannot be given different words', () => {
    // The enumeration leak this forecloses is a SECOND constant. There is one, exported once, and
    // both cases reach it through the same `sealBlock` call.
    const gated = toGatedListingMediaBlock([DRAFT_IMAGE], { listingPublicationStatus: 'draft' });
    const empty = toGatedListingMediaBlock([], { listingPublicationStatus: 'published' });
    assert.equal(gated.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.equal(empty.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.equal(gated.empty_statement, empty.empty_statement);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 4 — A PUBLICATION STATE THAT CANNOT BE READ
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — an unreadable publication state publishes nothing and claims nothing', () => {

  it('a vehicle row WITHOUT the column yields not_loaded — not open, and not "no photos"', async () => {
    const { publication_status: _dropped, ...withoutColumn } = vehicleRow();
    const block = await listingMediaOf({ vehicle: withoutColumn, listingImageRows: [DRAFT_IMAGE] });

    assert.equal(block.state, MEDIA_BLOCK_STATES.NOT_LOADED,
      'a render that could not establish whether the listing is published has not earned the claim '
      + '"no photos are published" — the listing may be published and full of photographs');
    assert.equal(block.empty_statement, null, 'and `not_loaded` says nothing at all, by Rule 1');
    assert.deepEqual(block.items, [], 'nor may it publish the gallery it could not gate');
    assert.equal(block.unpublishable_count, 0);
  });

  it('the same input publishes the gallery when the column IS present — so not_loaded is the gate', async () => {
    // ANTI-VACUITY for the test above: identical rows, identical caller, one column added.
    const block = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'published' }), listingImageRows: [DRAFT_IMAGE],
    });
    assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(block.items.length, 1);
  });

  it('a FAILED vehicle read produces no passport at all — the strongest possible closure', async () => {
    const { fn } = instantiatePassport({ vehicle: vehicleRow(), vehicleReadFails: true });
    const passport = await fn(DRAFT_VIN, anonymous(), null, toListingClaims, attestedValue, toVehicleMedia);
    assert.equal(passport, null,
      'the publication state and the vehicle row come from ONE read, so a failed publication read '
      + 'is a failed vehicle read and there is no body to leak into. No second query was added for '
      + 'the gate, so the gate introduced no second failure mode.');
  });

  it('the gate reads the row the passport ALREADY has — it issues no query of its own', () => {
    const fnSrc = buildVehiclePassportSource();
    const tableReads = [...fnSrc.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.deepEqual(tableReads, [
      'vehicles', 'vehicle_evidence', 'listing_images', 'vehicle_plate_history',
      'vehicle_ownership_history', 'users',
    ], 'the gate must not have added a query. A second read is a second failure mode, and a '
      + 'conditional one would also make response time a signal about publication state.');
    assert.match(fnSrc, /listingPublicationStatus: vehicle\.publication_status/,
      'the status must be carried from the row already in hand, raw, with no local re-derivation');
  });

  it('a FAILED listing_images read is still not_loaded, gate open or closed', async () => {
    // Rule 1 unchanged: the gallery read failing and the gate closing are different facts, and only
    // one of them is a finding.
    const { fn } = instantiatePassport({ vehicle: vehicleRow({ publication_status: 'published' }) });
    // A failing gallery read is exercised by the wiring harness; here the point is only that the
    // gate does not convert it into a claim. Published listing, no rows returned at all:
    const block = toVehicleMedia({
      listingImageRows: undefined, evidenceRows: [], listingPublicationStatus: 'published',
    }).listing_media;
    assert.equal(block.state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(block.empty_statement, null);
    assert.ok(typeof fn === 'function');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 5 — EVIDENCE IS NOT GATED BY LISTING PUBLICATION, AND STRUCTURALLY CANNOT BE
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — the gate governs listing media and nothing else', () => {

  it('an anonymous caller still gets VERIFIED EVIDENCE for an unpublished listing', async () => {
    const { passport } = await buildPassport({
      vehicle: vehicleRow({ publication_status: 'draft' }),
      listingImageRows: [DRAFT_IMAGE],
      evidenceRows: [evidenceRow(DRAFT_VIN)],
    });

    assert.equal(passport.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED,
      'evidence is truth about a VEHICLE. A verified registration document does not stop being true '
      + 'because nobody is advertising the car, and suppressing it would conflate listing content '
      + 'with vehicle truth — the exact error this phase exists to remove.');
    assert.equal(passport.verified_evidence.items.length, 1);
    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.NONE,
      'anti-vacuity: the gallery IS gated in this same body, so the two blocks are demonstrably '
      + 'governed by different facts');
  });

  it('the listing audience cannot reach the evidence block, and the evidence audience cannot reach the gallery', () => {
    const rows = { listingImageRows: [DRAFT_IMAGE], evidenceRows: [evidenceRow(DRAFT_VIN)] };

    // Widening the LISTING audience changes the gallery and leaves evidence byte-identical.
    const gatedListing = toVehicleMedia({ ...rows, listingPublicationStatus: 'draft', listingAudience: 'public' });
    const openListing = toVehicleMedia({ ...rows, listingPublicationStatus: 'draft', listingAudience: 'owner' });
    assert.notEqual(bytes(gatedListing.listing_media), bytes(openListing.listing_media));
    assert.equal(bytes(gatedListing.verified_evidence), bytes(openListing.verified_evidence),
      'listingAudience must not widen evidence — two parameters is what makes that impossible');

    // Widening the EVIDENCE audience changes evidence and leaves the gallery byte-identical.
    const publicEvidence = toVehicleMedia({ ...rows, listingPublicationStatus: 'published', audience: 'public' });
    const ownerEvidence = toVehicleMedia({ ...rows, listingPublicationStatus: 'published', audience: 'owner' });
    assert.equal(bytes(publicEvidence.listing_media), bytes(ownerEvidence.listing_media),
      'the evidence audience must not open the publication gate');
  });

  it('a listing`s publication state can never suppress evidence, at any status', () => {
    for (const status of PUBLICATION_STATUS_VOCABULARY) {
      const media = toVehicleMedia({
        listingImageRows: [DRAFT_IMAGE],
        evidenceRows: [evidenceRow(DRAFT_VIN)],
        listingPublicationStatus: status,
      });
      assert.equal(media.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED, status);
      assert.equal(media.verified_evidence.items.length, 1, status);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 6 — THE GOVERNED PATHS ARE UNCHANGED, PROVEN RATHER THAN ASSERTED
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — owner, admin and government keep exactly the access they had', () => {

  const fixture = () => ({
    vehicle: vehicleRow({ publication_status: 'draft' }),
    listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES, UNPUBLISHABLE_IMAGE],
    evidenceRows: [evidenceRow(DRAFT_VIN)],
  });

  /**
   * THE PRE-GATE PROJECTION, computed from the ungated contract function over the same rows. This
   * is what the shipped passport published for these rows BEFORE the gate existed, so comparing
   * against it is a direct measurement of "unchanged" rather than a restatement of the expectation.
   */
  const preGateBlock = () => toListingMediaBlock([DRAFT_IMAGE, ...MORE_IMAGES, UNPUBLISHABLE_IMAGE]);

  for (const [name, actor] of [
    ['the vehicle owner', ownerOf(vehicleRow())],
    ['an admin', adminActor()],
    ['a government reader', governmentActor()],
  ]) {
    it(`${name} receives the pre-gate block, byte for byte`, async () => {
      const block = await listingMediaOf(fixture(), actor);
      assert.equal(bytes(block), bytes(preGateBlock()),
        `${name} lost access the gate was never meant to touch`);
      assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
      assert.equal(block.items.length, 3);
      assert.equal(block.unpublishable_count, 1);
    });
  }

  it('a signed-in stranger is NOT entitled — an account is not access to an unpublished listing', async () => {
    const block = await listingMediaOf(fixture(), strangerActor());
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(bytes(block), bytes(toListingMediaBlock([])),
      'and they get the same non-distinguishing block an anonymous caller gets');
  });

  it('the entitlement is the passport`s EXISTING isAuthorized rule — not a new one', () => {
    const fnSrc = buildVehiclePassportSource();
    assert.match(fnSrc, /listingAudience: isAuthorized \? 'owner' : 'public'/,
      'the gate must reuse the audience decision the passport already makes from a verified '
      + 'session (owner_id match, or PASSPORT_PRIVILEGED_ROLES). A second, parallel entitlement '
      + 'rule is a second thing to get wrong.');
    assert.match(fnSrc, /PASSPORT_PRIVILEGED_ROLES\.has\(actor\.role\)/);
    assert.match(fnSrc, /actor\.id === vehicle\.owner_id/);
  });

  it('an owner CANNOT be conjured from an unverified header — the rule is unchanged', async () => {
    // `optionalAuth()` populates req.userContext only from a live session; a body or header the
    // route did not verify never reaches this function. Passing a bare request proves the function
    // reads nothing else.
    const forged = { headers: { 'x-user-id': 'u_uat_ref_owner_2026' }, body: { role: 'admin' } };
    const block = await listingMediaOf(fixture(), forged);
    assert.equal(block.state, MEDIA_BLOCK_STATES.NONE,
      'the passport must derive the audience from req.userContext alone');
  });

  it('the MARKETPLACE paths are untouched: they gate by refusing the listing, not the block', () => {
    // The marketplace never needed Rule 1b, because a listing that is not publicly visible never
    // reaches its media projection at all: the list filters in SQL and the detail throws 404 for the
    // public audience before any row is projected. Adding a block-level gate there would be a
    // second, redundant mechanism.
    assert.match(listingSummarySrc, /isPubliclyVisiblePublication\(vehicle\.publication_status\)/,
      'the marketplace list still filters whole listings on publication state');
    assert.ok(listingDetailSrc.includes('filterVisibleVehicles'),
      'the marketplace detail still refuses a non-visible listing outright');
    assert.ok(!listingSummarySrc.includes('toGatedListingMediaBlock'),
      'the marketplace summary must keep calling the UNGATED projector — it has already refused '
      + 'every listing this gate would close, and a second gate there would be dead code that looks '
      + 'load-bearing');
    assert.ok(!listingDetailSrc.includes('toGatedListingMediaBlock'));
    assert.ok(listingDetailSrc.includes('toListingMediaBlock(imageRows)'),
      'and its one projection call is unchanged');
  });

  it('the MODERATION queue keeps seeing unpublished listings — it is a governed path, not a leak', () => {
    // The one marketplace consumer that does NOT run `filterVisibleVehicles`. It is entitled to:
    // a moderation queue that hid the listings needing moderation would be useless, and it is
    // behind `assertModerator`. This is the same entitlement `listingAudience: 'owner'` names on
    // the passport, reached through a different door, and Rule 1b must leave it alone.
    assert.ok(moderationSrc.includes('assertModerator(filters.actor || {})'),
      'the admin listing view must still assert a moderator before returning anything');
    assert.ok(!moderationSrc.includes('filterVisibleVehicles'),
      'and it must still NOT apply the public visibility filter — if this starts passing, the '
      + 'moderation queue has been silently narrowed to published listings');
    assert.ok(!moderationSrc.includes('toGatedListingMediaBlock')
      && !moderationSrc.includes('publiclyVisiblePublicationStatuses'),
      'Rule 1b must not have reached this file');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 7 — THE GATE REACHES BOTH SHIPPED ROUTES
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — the gate is on every shipped passport route, not one', () => {

  it('both routes exist and both are gated for an anonymous caller', async () => {
    const sites = passportCallSites();
    assert.equal(sites.length, 2,
      'anti-vacuity: the VIN passport route AND the identifier lookup route. A third route is not a '
      + `licence to loosen this — gate it too. Found ${sites.length}.`);
    // Both call sites pass `req` and `toVehicleMedia` positionally (pinned by the wiring harness),
    // so gating the function gates both. Measured here on the function they both call.
    const gated = await listingMediaOf({
      vehicle: vehicleRow({ publication_status: 'draft' }), listingImageRows: [DRAFT_IMAGE],
    });
    assert.equal(gated.state, MEDIA_BLOCK_STATES.NONE);
  });

  it('the gallery read still RUNS for a gated caller — identical work, so no timing signal', async () => {
    const draft = await buildPassport({
      vehicle: vehicleRow({ publication_status: 'draft' }), listingImageRows: [DRAFT_IMAGE],
    });
    const published = await buildPassport({
      vehicle: vehicleRow({ publication_status: 'published' }), listingImageRows: [DRAFT_IMAGE],
    });

    assert.deepEqual(draft.tablesRead, published.tablesRead,
      'a draft listing and a published one must issue the same queries in the same order, or '
      + 'response time becomes a signal about publication state and about whether a hidden listing '
      + 'holds photographs');
    assert.ok(draft.tablesRead.includes('listing_images'));
    assert.equal(draft.passport.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(published.passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE 8 — THE CONTRACT DEFAULTS CLOSED
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Rule 1b — a caller that forgets the gate publishes nothing', () => {

  it('toVehicleMedia with no publication input yields not_loaded, never the gallery', () => {
    const media = toVehicleMedia({ listingImageRows: [DRAFT_IMAGE], evidenceRows: [] });
    assert.equal(media.listing_media.state, MEDIA_BLOCK_STATES.NOT_LOADED,
      'a future read path that forgets the gate must show an empty gallery in development, not leak '
      + 'an unpublished one in production');
    assert.deepEqual(media.listing_media.items, []);
    assert.equal(media.listing_media.empty_statement, null);
    // ANTI-VACUITY: the same rows publish three items once the caller states the fact.
    assert.equal(toVehicleMedia({
      listingImageRows: [DRAFT_IMAGE, ...MORE_IMAGES], evidenceRows: [],
      listingPublicationStatus: 'published',
    }).listing_media.items.length, 3);
  });

  it('toGatedListingMediaBlock with no options at all is closed', () => {
    assert.equal(toGatedListingMediaBlock([DRAFT_IMAGE]).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(toGatedListingMediaBlock([DRAFT_IMAGE], {}).state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(
      toGatedListingMediaBlock([DRAFT_IMAGE], { listingAudience: 'public' }).state,
      MEDIA_BLOCK_STATES.NOT_LOADED,
    );
  });

  it('the ungated projector is still exported and still ungated — the marketplace depends on it', () => {
    // `toListingMediaBlock` is the PURE projection. It must not learn about publication, or the
    // marketplace paths (which have already refused unpublished listings) would need to start
    // passing a status they have no reason to hold.
    assert.equal(toListingMediaBlock([DRAFT_IMAGE]).state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(toListingMediaBlock([DRAFT_IMAGE]).items.length, 1);
  });
});

/**
 * Issue #164 Phase 5 — THE PASSPORT MEDIA WIRING IS REQUIRED, NOT OPTIONAL.
 *
 * WHY THIS FILE EXISTS. An independent certifier accepted the Phase 5 media CONTRACT and rejected
 * the phase on one item: the WIRING that connects the contract to the passport was untested, so
 * three independent reversions left the whole backend suite green.
 *
 *   M1  delete the `listing_images` read from `buildVehiclePassport`
 *   M2  delete the `...(vehicleMedia ?? {})` spread from the returned body
 *   M3  the routes stop passing `toVehicleMedia` as the 6th argument
 *
 * Each of those three re-commits the ORIGINAL DEFECT this phase was opened for — a Vehicle Detail
 * gallery that is empty for a vehicle whose photographs exist, under a control that then announces
 * "No verified images uploaded yet" about a table the passport had never heard of. A revert that
 * nothing catches is a defect that reopens invisibly, which is worse than the defect.
 *
 * THIS IS NOT ACADEMIC. `JTNBU4EE0J9UAT101` and `JF1GPAL60J9UAT303` on staging are `published` and
 * each carries a `listing_images` row; unwire the passport and Vehicle Detail — which reads the
 * passport FIRST and returns early on success — shows an empty gallery for a car whose photograph
 * the marketplace card is displaying at that moment. Both VINs are exercised by name below.
 *
 * ── CORRECTED IN LANE D, AND THE CORRECTION IS THE POINT OF A WHOLE SUITE BELOW ───────────────
 * This paragraph used to name `WBA8E9C50JNUAT202` instead — the third VIN with a photograph, which
 * is `publication_status = 'draft'` — and said "THE PASSPORT IS THE ONLY TRANSPORT THAT CAN CARRY
 * THAT PHOTOGRAPH TO A BUYER". That was TRUE as a description and WRONG as a goal, and no Phase 5
 * document ever decided it: the wiring simply had no publication gate, so a listing the marketplace
 * deliberately 404s served its photographs to any anonymous caller holding the VIN.
 *
 * The product-owner decision is that it must not. An anonymous caller gets listing media only for a
 * PUBLISHED listing; owner, admin and government keep the access they had. The draft VIN is still
 * exercised by name below — as the leak that must stay closed, and as one half of the byte-identity
 * proof that the closed gate does not disclose which of the two cases a caller is looking at.
 *
 * HOW THIS FILE TESTS. Every behavioural test EXECUTES THE SHIPPED `buildVehiclePassport` SOURCE —
 * extracted from `backend/server.js` and instantiated over the same fixed 11-name dependency list
 * that `issue164-phase0-public-projection.test.js` and `issue164-phase4-passport-claim-columns.test.js`
 * use. Not a copy, not a reimplementation: a copy would go on passing after the shipped function
 * changed, which is exactly the failure mode being closed here.
 *
 * ── HOW M3 IS HANDLED, AND WHY ────────────────────────────────────────────────────────────────
 *
 * M3 is route wiring rather than function behaviour, so a test that calls the function cannot reach
 * it: the function is innocent, the CALLER is wrong. Two options were considered.
 *
 *   (b) MAKE THE WIRING IMPOSSIBLE TO OMIT — default the 6th parameter to `toVehicleMedia`.
 *       REJECTED, on measurement rather than on taste. A default-value expression makes
 *       `toVehicleMedia` a FREE MODULE-SCOPE NAME inside `buildVehiclePassport`, and the passport's
 *       collaborator set is deliberately CLOSED: `canonicalTrust`, `listingClaimContract`,
 *       `attestClaim` and `mediaContract` are PARAMETERS precisely so the injected dependency list
 *       stays at eleven names (see the header of `buildVehiclePassport`, and the
 *       `PASSPORT_DEPENDENCIES.length === 11` assertion in the Phase 4 harness). Applied and
 *       measured: the variant fails 27 of the 51 tests in the Phase 0 and Phase 4 harnesses with
 *       `ReferenceError: toVehicleMedia is not defined`. Those harnesses are certified and may not
 *       be edited to accommodate a change here, so (b) buys wiring safety by breaking two older
 *       guarantees. That is a trade, not a fix.
 *
 *   (a) ASSERT THE WIRING AT THE CALL SITE — adopted, and strengthened past a substring check.
 *       A test that merely greps the call site for the word `toVehicleMedia` cannot tell argument
 *       SIX from argument FIVE. That gap is live: swapping the 5th and 6th arguments at both call
 *       sites survives every existing Phase 0/1/4/5 test (measured: 169 pass, 0 fail), and it is a
 *       WORSE failure than M3 — `mediaContract` becomes `attestedValue`, so the body loses
 *       `listing_media`/`verified_evidence` entirely AND gains three bare top-level keys
 *       `{value: null, state: 'not_recorded', source: null}` — a subject-less governance word at the
 *       root of the passport — while `attestClaim` becomes `toVehicleMedia` and `vehicle.currency`
 *       silently becomes `undefined`, reopening part of Phase 4 as well.
 *
 *       So the call site is not grepped. It is REPLAYED: the shipped argument list is parsed out of
 *       `server.js`, each argument expression is resolved through a fixed resolver, and the results
 *       are applied POSITIONALLY to the shipped function. The route's own text drives the execution,
 *       so "the route passes the contract in the right place" becomes a behavioural claim about a
 *       published body rather than a claim about a string. Both routes are replayed, not one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MEDIA_BLOCK_STATES,
  LISTING_MEDIA_ITEM_FIELDS,
  LISTING_MEDIA_EMPTY_STATEMENT,
  VERIFIED_EVIDENCE_EMPTY_STATEMENT,
  toMediaIdentity,
  toVehicleMedia,
  findTrustLanguage,
  findMediaBlockCrossContamination,
} from '../utils/vehicleMediaProjection.js';

import {
  attestedValue,
  findPrivateFieldLeaks,
  projectVehicle,
  toListingClaims,
  toPublicEvidence,
  toPublicPlateHistory,
  toPublicTimelineEvent,
} from '../utils/publicVehicleProjection.js';

import { isPublicVehicleStatus, isPubliclyVisiblePublication } from '../utils/vehicleStatus.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const listingSummarySrc = readFileSync(
  new URL('../services/marketplace/listingSummaryService.js', import.meta.url),
  'utf8',
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SOURCE EXTRACTION — the same technique the Phase 0 and Phase 4 harnesses use
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

/** Source text of `async function buildVehiclePassport(...) { ... }`. */
function buildVehiclePassportSource() {
  const declIdx = serverSrc.indexOf(PASSPORT_DECLARATION);
  assert.ok(declIdx > -1, 'buildVehiclePassport must still exist in server.js — retarget this guard rather than deleting it');
  const braceIdx = serverSrc.indexOf('{', serverSrc.indexOf(')', declIdx));
  return serverSrc.slice(declIdx, braceIdx) + sliceBalanced(serverSrc, braceIdx);
}

/**
 * The declared PARAMETER names of `buildVehiclePassport`, in order. The replay below asserts the
 * media contract arrives at argument position 6; this is what makes "position 6" mean the media
 * contract rather than a number somebody has to remember.
 */
function passportParameterNames() {
  const declIdx = serverSrc.indexOf(PASSPORT_DECLARATION);
  const parenIdx = serverSrc.indexOf('(', declIdx);
  const params = sliceBalanced(serverSrc, parenIdx, '(', ')').slice(1, -1);
  return splitTopLevelArguments(params).map((param) => param.split('=')[0].trim());
}

/**
 * Split an argument (or parameter) list on top-level commas — depth-aware, so
 * `await canonicalPassportTrust(vin)` survives as ONE argument and an object literal would too.
 */
function splitTopLevelArguments(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part !== '');
}

/**
 * Every CALL of `buildVehiclePassport` in the shipped server, with its raw argument text.
 *
 * Found by scanning for the identifier rather than by a regex over a call shape, so a call site
 * written without `await`, assigned to a differently-named variable or spread over several lines is
 * still found. The declaration itself is the one occurrence excluded.
 */
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
    const parenIdx = idx + needle.length - 1;
    const argText = sliceBalanced(serverSrc, parenIdx, '(', ')').slice(1, -1);
    // The enclosing line, for a failure message that names the offending call site.
    const lineStart = serverSrc.lastIndexOf('\n', idx) + 1;
    sites.push({
      arguments: splitTopLevelArguments(argText),
      line: serverSrc.slice(lineStart, serverSrc.indexOf('\n', idx)).trim(),
      lineNumber: serverSrc.slice(0, idx).split('\n').length,
    });
  }
  return sites;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTE REPLAY — the shipped argument list, resolved and applied positionally
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A recognisable stand-in for `await canonicalPassportTrust(vin)`, so argument 3 can be traced. */
const REPLAY_TRUST = Object.freeze({
  vin: null, score: 71, band: 'medium', evaluation_state: 'evaluated', confidence: 'high',
  evidence_basis: [], calculation_version: 'replay-v1', evaluated_at: '2026-08-18T00:00:00Z',
  known_limitations: [], source: 'canonical_trust_cache',
});

/**
 * How each argument expression the routes actually write is resolved. Keyed by the NORMALISED
 * expression text, so a rename of the local (`vin` -> `resolvedVin`) is visible here rather than
 * silently resolving to `undefined`.
 *
 * An expression this map does not know is a HARD FAILURE with a message that says so. That is the
 * intended posture: a new argument at a passport call site must be routed through this replay
 * deliberately, never absorbed by a permissive fallback that would hand the function `undefined`
 * and let the test go on passing over a dead surface.
 */
function resolveCallSiteArguments(site, { vin, req }) {
  const RESOLVERS = new Map([
    ['vin', vin],
    ['resolvedVin', vin],
    ['req', req],
    ['await canonicalPassportTrust(vin)', REPLAY_TRUST],
    ['await canonicalPassportTrust(resolvedVin)', REPLAY_TRUST],
    ['toListingClaims', toListingClaims],
    ['attestedValue', attestedValue],
    ['toVehicleMedia', toVehicleMedia],
  ]);
  return site.arguments.map((expression) => {
    assert.ok(
      RESOLVERS.has(expression),
      `a buildVehiclePassport call site (server.js:${site.lineNumber}) passes an argument this replay cannot resolve: `
      + `\`${expression}\`. EXTEND THE RESOLVER — do not delete this test. The replay exists so the route's own `
      + `argument list drives a real execution; an unresolved argument would silently become undefined.`,
    );
    return RESOLVERS.get(expression);
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FIXTURES — the rows staging actually holds (ref eoyenigwevnxwwhyhaer, read-only, at this SHA)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE MATERIAL CASE, VERBATIM. `listing_images` row `fb7b28c2…` belongs to `WBA8E9C50JNUAT202`,
 * whose `publication_status` is `draft`. Neither field is adjusted here: this is the live pair that
 * makes the passport the only transport for this photograph.
 */
const DRAFT_ONLY_VIN = 'WBA8E9C50JNUAT202';
const DRAFT_ONLY_IMAGE = Object.freeze({
  id: 'fb7b28c2-c6d5-443e-9758-0b7a790be6f2',
  vin: DRAFT_ONLY_VIN,
  image_url: '/uat/owner/bmw-320i.svg',
  is_primary: true,
  display_order: 0,
  created_at: '2026-08-16 22:52:25.977933+00',
});

/** The live `vehicles` row for that VIN, columns as staging holds them. */
function draftOnlyVehicleRow(overrides = {}) {
  return {
    vin: DRAFT_ONLY_VIN, make: 'BMW', model: '320i', generation: null, trim: null, year: 2020,
    color: 'Alpine White', mileage: 41300, fuel_type: 'Petrol', transmission: 'Automatic',
    drivetrain: 'RWD', price: 22500, currency: 'USD',
    status: 'Available',
    publication_status: 'draft',            // <- the reason the marketplace 404s for this VIN
    created_at: '2026-08-16 22:51:25.573394+00',
    import_source: 'japan',
    registration_country: 'Zimbabwe', registration_authority: 'CVR',
    registration_status: 'Current', plate_status: 'Active',
    vehicle_condition_category: 'recently_imported',
    duty_paid: false, police_verified: false, zimra_verified: false, passport_verified: false,
    inspection_ready: false, safe_pay_ready: false,
    current_seller_type: 'private', public_seller_display_enabled: false,
    owner_id: 'u_uat_ref_owner_2026', tenant_id: null, current_seller_id: null,
    plate_number: 'ABC1234', normalized_plate_number: 'ABC1234',
    chassis_number: 'CH-9', engine_number: 'EN-9',
    temp_plate_id: null, temporary_identification_number: null, trust_score: 90,
    ...overrides,
  };
}

/**
 * The other two live `listing_images` rows, re-pointed at ONE VIN so a multi-photo gallery can be
 * exercised. Staging holds one row per VIN, so the multiplicity is constructed — the ids, the urls
 * and the url FORM (all three are site-relative) are not.
 */
const GALLERY_VIN = 'JTNBU4EE0J9UAT101';
const GALLERY_ROWS = Object.freeze([
  Object.freeze({
    id: '5596b493-f21a-40eb-aba5-947b26e76cd5', vin: GALLERY_VIN,
    image_url: '/uat/owner/toyota-corolla.svg', is_primary: true, display_order: 0,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
  Object.freeze({
    id: '6a4b5b86-fbf2-448e-856e-9fa14299c2d7', vin: GALLERY_VIN,
    image_url: '/uat/owner/subaru-impreza.svg', is_primary: false, display_order: 1,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
  Object.freeze({
    id: 'fb7b28c2-c6d5-443e-9758-0b7a790be6f2', vin: GALLERY_VIN,
    image_url: '/uat/owner/bmw-320i.svg', is_primary: false, display_order: 2,
    created_at: '2026-08-16 22:52:25.977933+00',
  }),
]);

/**
 * A row whose URL this contract will not emit (`data:`), carrying a perfectly valid identity. It
 * must be COUNTED as unpublishable rather than dropped: "we could not publish it" is not "the seller
 * added none", and the difference is the whole subject of this phase.
 */
const UNPUBLISHABLE_ROW = Object.freeze({
  id: 'a0f6cf3e-9d64-4a1f-8b0d-6b2c1d9e4f77', vin: GALLERY_VIN,
  image_url: 'data:image/png;base64,iVBORw0KGgo=', is_primary: false, display_order: 3,
  created_at: '2026-08-16 22:52:25.977933+00',
});

/**
 * The one live `vehicle_evidence` row, untrimmed, including the internal columns Phase 0's
 * allow-list withholds — the point being that a raw `select('*')` row is safe to hand the projector.
 */
function stagingEvidenceRow(vin) {
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HARNESS
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A supabase stub that HONOURS `.select()`, projecting each row down to exactly the named columns
 * as PostgREST does. That is what makes a narrowed query fail BEHAVIOURALLY: drop `id` from the
 * gallery read and the rows arrive without one, every item becomes unpublishable for want of an
 * identity, and the gallery empties. A stub that ignored the column list would hand the projection
 * an `id` the shipped query never asked for, and the test would pass over a dead surface.
 */
function queryStub(data, error = null) {
  let columns = null;
  const project = (row) => {
    if (!columns || !row || typeof row !== 'object') return row;
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
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
 * Instantiate the SHIPPED `buildVehiclePassport` source over the fixed 11-name dependency list.
 * A twelfth free module-scope name added to the function body is a ReferenceError here — the same
 * signal the Phase 0 and Phase 4 harnesses give, deliberately triplicated.
 */
function instantiatePassport({
  vehicle,
  listingImageRows = [],
  evidenceRows = [],
  listingImagesFail = false,
} = {}) {
  const supabase = {
    from(table) {
      switch (table) {
        case 'vehicles': return queryStub(vehicle);
        case 'users': return queryStub({ name: 'Jane Owner' });
        case 'vehicle_evidence': return queryStub(evidenceRows);
        case 'listing_images':
          return listingImagesFail
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

/** Anonymous caller — `optionalAuth()` resolved no identity, so `req.userContext` is absent. */
const anonymous = () => ({});

/**
 * The vehicle's own owner, as `optionalAuth()` would have resolved them from a live session. The
 * shipped function derives `isAuthorized` from `actor.id === vehicle.owner_id`, so this is the real
 * governed path and not a flag the test sets.
 */
const ownerOf = (vehicle) => ({ userContext: { id: vehicle.owner_id, role: 'owner' } });

/** An admin — a PASSPORT_PRIVILEGED_ROLES member, authorized for any vehicle. */
const adminActor = () => ({ userContext: { id: 'u_admin_1', role: 'admin' } });

/** A government reader — the other privileged role. */
const governmentActor = () => ({ userContext: { id: 'u_gov_1', role: 'government' } });

/**
 * A signed-in caller who is NOT the owner and holds no privileged role. `isAuthorized` is false for
 * them, so they are on the anonymous side of the Rule 1b gate — having an account is not
 * entitlement to an unpublished listing's content.
 */
const strangerActor = () => ({ userContext: { id: 'u_someone_else', role: 'buyer' } });

/** Direct call with the contract wired, exactly as the routes wire it. */
const buildWired = (fixture, req = anonymous()) =>
  instantiatePassport(fixture)(
    fixture.vehicle.vin, req, REPLAY_TRUST, toListingClaims, attestedValue, toVehicleMedia,
  );

/** Build a passport by REPLAYING one shipped route's own argument list, positionally. */
const buildFromCallSite = (site, fixture, req = anonymous()) =>
  instantiatePassport(fixture)(
    ...resolveCallSiteArguments(site, { vin: fixture.vehicle.vin, req }),
  );

const galleryFixture = (overrides = {}) => ({
  vehicle: { ...draftOnlyVehicleRow(), vin: GALLERY_VIN, publication_status: 'published' },
  listingImageRows: [...GALLERY_ROWS],
  evidenceRows: [],
  ...overrides,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// M1 — THE PASSPORT MUST READ listing_images
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — buildVehiclePassport reads listing_images (M1)', () => {
  it('M1: the passport publishes every photograph listing_images holds for this VIN', async () => {
    const passport = await buildWired(galleryFixture());

    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(
      passport.listing_media.items.length, GALLERY_ROWS.length,
      'a photograph the table holds must reach the buyer — an unwired passport publishes none of them',
    );
    assert.deepEqual(
      passport.listing_media.items.map((item) => item.url),
      GALLERY_ROWS.map((row) => row.image_url),
      'and it publishes the row\'s own url, in the seller\'s primary-then-display_order sequence',
    );
    assert.equal(passport.listing_media.unpublishable_count, 0);
    assert.equal(
      passport.listing_media.empty_statement, null,
      'a populated block publishes NO sentence — the items speak for it. `empty_statement` belongs '
      + 'to `none` alone, so a reader can never be told "no photos" beside a photograph.',
    );
  });

  it('M1: a FAILED listing_images read is not_loaded and says NOTHING about the seller', async () => {
    const passport = await buildWired(galleryFixture({ listingImagesFail: true }));

    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.NOT_LOADED);
    assert.equal(
      passport.listing_media.empty_statement, null,
      'a read that never succeeded may not publish "No photos have been added to this listing." — '
      + 'saying "none" on the strength of a read that failed IS the original defect',
    );
    assert.deepEqual(passport.listing_media.items, []);
    assert.equal(passport.listing_media.unpublishable_count, 0);
  });

  it('M1: an EMPTY listing_images read says "no photos", which is a different fact', async () => {
    const passport = await buildWired(galleryFixture({ listingImageRows: [] }));

    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(passport.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.notEqual(
      passport.listing_media.state, MEDIA_BLOCK_STATES.NOT_LOADED,
      'looked-and-found-none and never-looked are two different statements and must never collapse',
    );
  });

  it('M1: an unpublishable photo is COUNTED, and the publishable ones still reach the buyer', async () => {
    const passport = await buildWired(galleryFixture({
      listingImageRows: [...GALLERY_ROWS, UNPUBLISHABLE_ROW],
    }));

    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(passport.listing_media.items.length, GALLERY_ROWS.length);
    assert.equal(
      passport.listing_media.unpublishable_count, 1,
      '"we could not publish it" is not "the seller added none" — silently dropping the row erases the difference',
    );
    assert.ok(
      !JSON.stringify(passport.listing_media).includes('data:image'),
      'and the value this contract refuses to emit must not reach the body by another route',
    );
  });

  it('M1: the gallery read is keyed by vin, selects the identity, and never reads created_at', () => {
    const fnSrc = buildVehiclePassportSource();

    assert.ok(
      fnSrc.includes("from('listing_images')"),
      'buildVehiclePassport must still read listing_images — a passport that does not consult the '
      + 'gallery table is the shipped-before state this phase closed',
    );
    assert.match(
      fnSrc, /\.select\('id, image_url, is_primary, display_order'\)/,
      'the read must select `id`, or every item becomes unpublishable for want of an identity',
    );
    const readBlock = fnSrc.slice(fnSrc.indexOf("from('listing_images')"));
    assert.match(readBlock.slice(0, 300), /\.eq\('vin', vin\)/, 'keyed by vin, the only key the table has');
    assert.ok(
      !/\.select\('[^']*created_at[^']*'\)/.test(readBlock.slice(0, 300)),
      'listing_images.created_at is the row INSERT time; a date beside a photo reads as when the '
      + 'photo was taken, and this table has no reviewed capture time to offer',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// M2 — THE TWO BLOCKS MUST REACH THE PUBLISHED BODY
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — the contract\'s blocks reach the passport BODY (M2)', () => {
  it('M2: both media keys are spread onto the top level of the body', async () => {
    const passport = await buildWired(galleryFixture());

    assert.ok('listing_media' in passport, 'the passport body must carry listing_media');
    assert.ok('verified_evidence' in passport, 'the passport body must carry verified_evidence');
    assert.equal(
      'media' in passport, false,
      'and NOT under a `media` key: marketplaceListingDetailService already publishes `media` holding '
      + 'RAW listing_images rows, and Vehicle Detail holds both payloads at once — one name over two '
      + 'shapes is how a projected block gets passed to a row projector and blanks a gallery silently',
    );
  });

  it('M2: the gallery and the evidence blocks are published together and stay apart', async () => {
    const passport = await buildWired(galleryFixture({
      evidenceRows: [stagingEvidenceRow(GALLERY_VIN)],
    }));

    assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(passport.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.equal(passport.verified_evidence.items.length, 1);
    assert.deepEqual(
      findMediaBlockCrossContamination(passport), [],
      'the item key sets must share NOT ONE name — that disjointness is the mechanical separation proof',
    );
    assert.deepEqual(
      findTrustLanguage(passport.listing_media, 'listing_media'), [],
      'nothing the gallery block authors may make a verification claim: these are seller marketing '
      + 'photos with no reviewer, no checksum and no status',
    );
    assert.deepEqual(findPrivateFieldLeaks(passport.listing_media), []);
    for (const secret of ['storage_bucket', 'file_path', 'vehicle-images', 'qa-staging-seller-73']) {
      assert.ok(
        !JSON.stringify(passport.listing_media).includes(secret),
        `${secret} reached listing_media on the passport body`,
      );
    }
  });

  it('M2: each block states its OWN empty case — the two sentences never collapse into one', async () => {
    const noPhotos = await buildWired(galleryFixture({
      listingImageRows: [],
      evidenceRows: [stagingEvidenceRow(GALLERY_VIN)],
    }));

    assert.equal(noPhotos.listing_media.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(noPhotos.listing_media.empty_statement, LISTING_MEDIA_EMPTY_STATEMENT);
    assert.equal(noPhotos.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED);
    assert.notEqual(
      LISTING_MEDIA_EMPTY_STATEMENT, VERIFIED_EVIDENCE_EMPTY_STATEMENT,
      'the defect that named this phase was "No verified images uploaded yet" — one governance '
      + 'sentence published over an empty MARKETING gallery. Two facts need two sentences.',
    );

    const noEvidence = await buildWired(galleryFixture());
    assert.equal(noEvidence.verified_evidence.state, MEDIA_BLOCK_STATES.NONE);
    assert.equal(noEvidence.verified_evidence.empty_statement, VERIFIED_EVIDENCE_EMPTY_STATEMENT);
    assert.equal(
      noEvidence.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED,
      'a vehicle with photos and no verified evidence must publish the photos and say only that '
      + 'nothing is verified — neither block may answer for the other',
    );
  });

  it('M2: a passport built WITHOUT the contract publishes NEITHER key — absence is not an empty gallery', async () => {
    // The 6th argument omitted, exactly as the four pre-existing passport suites legitimately call
    // it. Pinned here so the DIFFERENCE between wired and unwired is itself under test: fabricating
    // `{state:'none'}` for a projection that was never applied would re-commit this phase's defect
    // one level up, and would also make the M2 guard above unfalsifiable.
    const unwired = await instantiatePassport(galleryFixture())(
      GALLERY_VIN, anonymous(), REPLAY_TRUST, toListingClaims, attestedValue,
    );

    assert.equal('listing_media' in unwired, false);
    assert.equal('verified_evidence' in unwired, false);
    assert.equal(
      unwired.evidenceVault.length, 0,
      'anti-vacuity: the unwired body is a real body built from the same fixture, not a null',
    );
    assert.equal(unwired.identity.vin, GALLERY_VIN);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// M3 — EVERY SHIPPED ROUTE MUST HAND THE CONTRACT IN, AT THE RIGHT POSITION
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — every shipped route hands the contract in (M3)', () => {
  it('M3: both passport call sites are found in the shipped server, and both are replayable', () => {
    const sites = passportCallSites();

    assert.equal(
      sites.length, 2,
      'anti-vacuity: this scanner must find the VIN passport route and the identifier lookup route. '
      + `Found ${sites.length}. A third passport route is not a licence to loosen this — replay it too.`,
    );
    for (const site of sites) {
      assert.ok(site.line.includes('buildVehiclePassport('), `call site text not captured: ${site.line}`);
      // Resolving is itself the assertion: an argument the resolver does not know fails loudly.
      const resolved = resolveCallSiteArguments(site, { vin: GALLERY_VIN, req: anonymous() });
      assert.equal(resolved.length, site.arguments.length);
    }
    // CORRECTED IN LANE B, because it had become false. This pinned the import as an EXACT LINE,
    // `import { toVehicleMedia } from './utils/vehicleMediaProjection.js';`. That line now imports a
    // second name as well — `isPublishableMediaUrl`, which `POST /api/vehicles/add` gates writes on
    // so that ONE definition of publishable governs the writer and the reader alike — and an
    // exact-string pin turned "import anything else from the canonical module" into a failure of the
    // M3 wiring guard, which is a constraint M3 was never about.
    //
    // The guarantee is unchanged, and is now stated as what it always meant: `toVehicleMedia` is
    // imported at module scope FROM THE CANONICAL MODULE. Deleting that import, or satisfying the
    // call sites from a local stand-in, still fails here by name.
    const mediaImport = serverSrc.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/utils\/vehicleMediaProjection\.js';/);
    assert.ok(mediaImport, 'the module-scope import backing those call sites must still be there');
    assert.ok(
      mediaImport[1].split(',').map((name) => name.trim()).includes('toVehicleMedia'),
      'and it must still import the CONTRACT itself, not merely something from that module',
    );
  });

  it('M3: the media contract is the SIXTH parameter, so "position 6" names it', () => {
    const params = passportParameterNames();

    assert.deepEqual(
      params,
      ['vin', 'req', 'canonicalTrust', 'listingClaimContract', 'attestClaim', 'mediaContract'],
      'the passport composes over authorities it is HANDED. If this signature changes, the replay '
      + 'below must be re-aimed deliberately rather than left pointing at a stale position.',
    );
    assert.equal(params[5], 'mediaContract');
  });

  it('M3: every call site passes toVehicleMedia at position 6 — present-in-the-list is not enough', () => {
    const sites = passportCallSites();

    for (const site of sites) {
      const resolved = resolveCallSiteArguments(site, { vin: GALLERY_VIN, req: anonymous() });
      assert.equal(
        resolved.length, 6,
        `server.js:${site.lineNumber} calls buildVehiclePassport with ${resolved.length} arguments, so its `
        + `gallery is dead:\n  ${site.line}`,
      );
      assert.equal(
        resolved[5], toVehicleMedia,
        `server.js:${site.lineNumber} does not pass the media contract as the 6th argument:\n  ${site.line}`,
      );
      assert.equal(
        resolved[4], attestedValue,
        'and the attestor must still be the 5th — swapping the two is not caught by asking whether '
        + '`toVehicleMedia` appears in the list, and it is a WORSE failure than omitting it: the body '
        + 'loses both media blocks AND gains a bare {value, state, source} at its root.',
      );
      assert.equal(resolved[3], toListingClaims, 'the claim contract must still be the 4th');
    }
  });

  it('M3 REPLAY: each shipped route\'s OWN argument list produces a body carrying the photograph', async () => {
    const sites = passportCallSites();
    assert.equal(sites.length, 2, 'anti-vacuity: both routes must be replayed, not one');

    for (const site of sites) {
      const passport = await buildFromCallSite(site, galleryFixture());

      // The replay is positionally faithful: argument 3 landed on `canonicalTrust`...
      assert.equal(
        passport.trustReport, REPLAY_TRUST,
        `the replay of server.js:${site.lineNumber} did not apply its arguments positionally`,
      );
      // ...argument 4 on the claim contract...
      assert.ok(passport.claims, 'the claim contract argument did not land');
      // ...and argument 6 on the media contract, which is the whole subject of this file.
      assert.ok(
        'listing_media' in passport,
        `the passport built from server.js:${site.lineNumber}'s own argument list carries no gallery:\n  ${site.line}`,
      );
      assert.equal(passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED);
      assert.deepEqual(
        passport.listing_media.items.map((item) => item.url),
        GALLERY_ROWS.map((row) => row.image_url),
      );
      // A swapped 5th/6th argument publishes these three at the root instead of the two blocks.
      for (const stray of ['value', 'state', 'source']) {
        assert.equal(
          stray in passport, false,
          `a bare \`${stray}\` at the root of the passport is an attestation the media contract's `
          + 'position was given to — the 5th/6th argument swap',
        );
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATERIAL CASE — the VIN whose ONLY transport is the passport
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — the VIN whose only transport is the passport', () => {
  it('PRECONDITION: WBA8E9C50JNUAT202 is excluded from the public marketplace by its publication state', () => {
    const row = draftOnlyVehicleRow();

    assert.equal(row.publication_status, 'draft');
    assert.equal(
      isPubliclyVisiblePublication(row.publication_status), false,
      'the marketplace list and detail both filter on this predicate, so this VIN 404s there',
    );
    assert.equal(
      isPublicVehicleStatus(row.status), true,
      'anti-vacuity: it is NOT excluded for its status — `Available` is public. The publication '
      + 'lifecycle alone is what removes it, which is exactly the case a real seller lands in '
      + 'between uploading photographs and pressing publish.',
    );
    assert.equal(DRAFT_ONLY_IMAGE.vin, DRAFT_ONLY_VIN, 'and the photograph really belongs to it');
  });

  /**
   * CORRECTED IN LANE D. This test asserted that the draft VIN's photograph "still reaches the
   * buyer, through every shipped passport route" — which was a passing test over a LEAK. It is
   * re-aimed at the two things that are true after the product-owner decision, both still proven
   * through EVERY shipped route rather than through one direct call.
   */
  it('its photograph reaches the OWNER through every shipped passport route, unchanged', async () => {
    const fixture = {
      vehicle: draftOnlyVehicleRow(),
      listingImageRows: [DRAFT_ONLY_IMAGE],
      evidenceRows: [],
    };

    for (const site of passportCallSites()) {
      const passport = await buildFromCallSite(site, fixture, ownerOf(fixture.vehicle));

      assert.equal(
        passport.listing_media.state, MEDIA_BLOCK_STATES.PUBLISHED,
        `server.js:${site.lineNumber} withheld a draft listing's photograph from its own owner — the `
        + 'gate is about anonymous callers and must not touch the governed paths',
      );
      assert.equal(passport.listing_media.items.length, 1);
      assert.equal(passport.listing_media.items[0].url, DRAFT_ONLY_IMAGE.image_url);
      assert.equal(passport.listing_media.items[0].media_id, DRAFT_ONLY_IMAGE.id);
      assert.equal(
        passport.listing_media.items[0].is_primary, true,
        'the seller marked this photograph primary and the passport honours that claim once',
      );
      assert.equal(
        passport.verified_evidence.state, MEDIA_BLOCK_STATES.NONE,
        'and it says separately that nothing here is verified — a marketing photo is not evidence',
      );
    }
  });

  it('and it does NOT reach an anonymous caller, through any shipped passport route', async () => {
    const fixture = {
      vehicle: draftOnlyVehicleRow(),
      listingImageRows: [DRAFT_ONLY_IMAGE],
      evidenceRows: [],
    };

    for (const site of passportCallSites()) {
      const passport = await buildFromCallSite(site, fixture);
      const serialized = JSON.stringify(passport.listing_media);

      assert.equal(
        passport.listing_media.state, MEDIA_BLOCK_STATES.NONE,
        `server.js:${site.lineNumber} served an unpublished listing's gallery to an anonymous caller`,
      );
      assert.deepEqual(passport.listing_media.items, []);
      assert.equal(
        passport.listing_media.unpublishable_count, 0,
        'a count over the withheld rows would answer "does this hidden listing have photos?" with '
        + 'the pixels removed — which is the question the gate exists to refuse',
      );
      assert.ok(
        !serialized.includes(DRAFT_ONLY_IMAGE.image_url) && !serialized.includes(DRAFT_ONLY_IMAGE.id),
        'neither the url nor the identity of a withheld photograph may appear anywhere in the block',
      );
      assert.equal(
        passport.verified_evidence.state, MEDIA_BLOCK_STATES.NONE,
        'and the EVIDENCE block is not gated by the listing\'s publication state — it is empty here '
        + 'because this VIN has no verified evidence, which is a different fact entirely',
      );
    }
  });

  /**
   * CORRECTED IN LANE D. This asserted `!fnSrc.includes('publication_status')` outright, on the
   * reasoning that the passport "is the only surface that can show a draft listing's photographs".
   * The product owner has decided it must not be. The DURABLE half of that guarantee — the passport
   * is the record of a VEHICLE and does not 404 a vehicle for its listing's publication state —
   * survives, and is now asserted BEHAVIOURALLY instead of by absence of a substring.
   */
  it('the passport still RESOLVES for an unpublished listing — only the gallery is gated', async () => {
    const fnSrc = buildVehiclePassportSource();
    const passport = await buildWired({
      vehicle: draftOnlyVehicleRow(),
      listingImageRows: [DRAFT_ONLY_IMAGE],
      evidenceRows: [stagingEvidenceRow(DRAFT_ONLY_VIN)],
    });

    assert.ok(passport, 'a draft listing must still produce a passport — the marketplace 404s, this does not');
    assert.equal(passport.identity.vin, DRAFT_ONLY_VIN);
    assert.ok(passport.claims, 'and it still publishes the governed claim contract for the vehicle');
    assert.equal(
      passport.verified_evidence.state, MEDIA_BLOCK_STATES.PUBLISHED,
      'and it still publishes VEHICLE TRUTH: a verified public_safe evidence row does not stop being '
      + 'true because nobody is advertising the car. Gating evidence on listing publication would '
      + 'conflate listing content with vehicle truth — the error this phase exists to remove.',
    );
    assert.equal(
      passport.listing_media.state, MEDIA_BLOCK_STATES.NONE,
      'anti-vacuity: the gallery IS gated in this same body, so the two blocks are demonstrably '
      + 'governed by different facts rather than both happening to be open',
    );
    assert.ok(
      !fnSrc.includes('filterVisibleVehicles'),
      'and the passport must not borrow the marketplace visibility gate, which refuses the whole '
      + 'listing: the remedy here is a gated BLOCK, never a 404 for the vehicle',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// IDENTITY CONTINUITY — the same photograph is named the same thing wherever it appears
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — identity continuity across the transports', () => {
  it('the identity the passport publishes IS the listing_images row primary key', async () => {
    const passport = await buildWired(galleryFixture());

    assert.deepEqual(
      passport.listing_media.items.map((item) => item.media_id),
      GALLERY_ROWS.map((row) => toMediaIdentity(row.id)),
      'media_id is carried from the row, so any surface reading the same row names the same photograph',
    );
    assert.deepEqual(
      Object.keys(passport.listing_media.items[0]).sort(),
      [...LISTING_MEDIA_ITEM_FIELDS].sort(),
      'and the item carries exactly the declared fields — no more, no fewer',
    );
    assert.equal(
      new Set(passport.listing_media.items.map((item) => item.media_id)).size,
      passport.listing_media.items.length,
      'identities never collide inside one gallery',
    );
  });

  it('the identity is transport-independent: it is not the position and not the read order', async () => {
    const forward = await buildWired(galleryFixture());
    const reversed = await buildWired(galleryFixture({
      listingImageRows: [...GALLERY_ROWS].reverse(),
    }));

    const identityByUrl = (passport) => Object.fromEntries(
      passport.listing_media.items.map((item) => [item.url, item.media_id]),
    );
    assert.deepEqual(
      identityByUrl(forward), identityByUrl(reversed),
      'two reads that returned the rows in different orders must name each photograph identically — '
      + 'an index-derived value would be 0 for the first photo of every vehicle and would move '
      + 'whenever a sibling row moved, which is the opposite of an identity',
    );
    for (const item of forward.listing_media.items) {
      assert.notEqual(
        String(item.media_id), String(item.position),
        'identity and slot are different facts and must be different values',
      );
    }
  });

  it('the passport and the marketplace publish the SAME photograph from the same row', async () => {
    // Continuity across the two transports is proven on the ROW, which is the canonical truth both
    // of them read — NOT by comparing two payloads, which would only prove they agreed once.
    //
    // The passport publishes `listing_images.image_url` as `url` and `listing_images.id` as
    // `media_id`. The marketplace reads the same table for the same VIN. Because the identity is the
    // ROW'S PRIMARY KEY and not an artefact of either transport — not an array index, not a slot,
    // not a hash of the payload — the two surfaces cannot disagree about which photograph is which,
    // whether or not the marketplace publishes an identity of its own. There is no reconciliation
    // step to get wrong and nothing to keep in sync.
    //
    // That is deliberately the whole claim. Whether the marketplace publishes `media_id` today is a
    // marketplace-owned question and is being changed in a sibling lane as this lands; pinning the
    // answer here would make this test a tripwire on somebody else's file rather than a proof about
    // identity. What IS pinned is the join both surfaces must keep: the same table, the same vin key
    // and `image_url` in the select.
    const idx = listingSummarySrc.indexOf("from('listing_images')");
    assert.ok(idx > -1, 'the marketplace must still read listing_images for the same VIN');
    assert.ok(
      listingSummarySrc.slice(idx, idx + 240).includes('image_url'),
      'the marketplace gallery read must still fetch image_url — the column the passport publishes '
      + 'as `url`, and the weaker of the two join keys (a CDN rewrite breaks it, and two '
      + 'site-relative paths can collide: 3 of 3 live rows are exactly such paths)',
    );

    // CORRECTED IN LANE D: the fixture was the DRAFT vin read anonymously, which after the Rule 1b
    // gate publishes no item at all and would have made the three assertions below vacuous
    // (`undefined === undefined`). The claim is about identity, not about publication, so it is
    // made on a PUBLISHED listing — where both transports genuinely serve the same row. The same
    // row and the same photograph; only the fixture's publication state changed.
    const passport = await buildWired({
      vehicle: { ...draftOnlyVehicleRow(), publication_status: 'published' },
      listingImageRows: [DRAFT_ONLY_IMAGE],
      evidenceRows: [],
    });
    const item = passport.listing_media.items[0];
    assert.ok(item, 'anti-vacuity: there must BE an item for an identity claim to be about');
    assert.equal(item.url, DRAFT_ONLY_IMAGE.image_url, 'the column both surfaces read and publish');
    assert.equal(
      item.media_id, DRAFT_ONLY_IMAGE.id,
      'the identity is the ROW primary key, so it is transport-independent by construction',
    );
    assert.notEqual(
      item.media_id, item.url,
      'and the identity is not the url: a url is rewritten by a CDN or a resize, and two '
      + 'site-relative paths can collide — 3 of 3 live rows are exactly such paths',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HARNESS CONTRACT — the injection list this file shares with Phase 0 and Phase 4
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('Phase 5 wiring — harness contract', () => {
  it('buildVehiclePassport still needs no new injected collaborator', async () => {
    // The proof is that the 11-name list instantiates AND EXECUTES the shipped source. This is the
    // same assertion the Phase 4 harness makes, and it is what forecloses "just default the 6th
    // parameter to toVehicleMedia": a default-value expression would make that a TWELFTH free
    // module-scope name and this call would be a ReferenceError — measured at 27 failures across
    // the Phase 0 and Phase 4 harnesses, which are certified and may not be edited to suit Phase 5.
    const passport = await buildWired(galleryFixture());

    assert.equal(PASSPORT_DEPENDENCIES.length, 11);
    assert.equal(passport.identity.vin, GALLERY_VIN, 'a body was produced, so every free name resolved');
  });
});

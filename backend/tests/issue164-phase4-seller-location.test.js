/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 4 permanent guard.
 *
 * Phase 4 declares the contract for the facts CarUp was inventing: who the seller is, where the
 * vehicle is, what registered it, and what is actually known about its specification. The
 * fabrications were not rendering bugs — three of them were column DEFAULTs, measured at 16 of 16
 * rows on staging with zero application writers behind them — so the guarantees below are about
 * PROVENANCE, not about formatting.
 *
 * What each section is watching for:
 *
 *   1. THE SHAPE IS CLOSED. Five blocks, each carrying exactly its declared fields, always all of
 *      them. A block that can grow a field per caller is not a contract.
 *   2. STATES ARE EXHAUSTIVE AND MUTUALLY EXCLUSIVE. Every leaf carries exactly one state from the
 *      closed four-state vocabulary, and `value !== null` if and only if that state is `recorded`.
 *      There is no fifth way to be unknown and no way to be two things at once.
 *   3. NO PROVENANCE, NO CLAIM. A value with no `*_source`, or with an unrecognised one, is
 *      `not_recorded` — whatever the column holds. This is the whole phase in one rule.
 *   4. WITHHELD ≠ UNRECORDED. The two are distinguishable by a consumer and indistinguishable
 *      from each other's presence: a withheld leaf looks identical whether or not a value exists
 *      behind it, or the response answers the question the withholding exists to refuse.
 *   5. NO PLAUSIBLE DEFAULT SURVIVES. A missing value never acquires a substitute, and a genuine
 *      `0`/`false` is never demoted to missing while an empty string is never promoted to a fact.
 *   6. THE MODULE ITSELF HOLDS NO FABRICATED-DEFAULT LITERAL. A source scan over its STRING
 *      LITERALS (comments deliberately excluded — the documentation must be free to name the
 *      fabrications it removes) proves the sentinels are gone from the code.
 *   7. THE MIGRATION DOES NOT BACKFILL, and its provenance vocabulary is the module's.
 *
 * ANTI-VACUITY. Three controls, because a scan that finds nothing and a scan that scans nothing
 * are the same green tick: the literal reader is asserted to extract a non-trivial corpus from the
 * real module; it is run against a synthetic source where a sentinel is planted in a comment, in a
 * longer word, inside a regex, and in one real literal, and must flag exactly the last; and
 * `findBareClaims` is run against a payload with a planted bare value and must catch it.
 */
import test, { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIELD_STATES,
  FIELD_STATE_VALUES,
  CLAIM_SOURCES,
  CLAIM_VISIBILITY,
  CONDITION_ABSENCE_MARKER,
  LISTING_CLAIM_BLOCKS,
  LISTING_CLAIM_COLUMNS,
  isClaimSource,
  isStatedValue,
  attestedValue,
  statedValue,
  sealClaimBlock,
  findBareClaims,
  assertContactChannelKinds,
  toListingClaims,
  toSellerClaim,
  toLocationClaim,
  toRegistrationClaim,
  toSpecificationClaim,
  toPublicationClaim,
} from '../utils/publicVehicleProjection.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'backend', 'utils', 'publicVehicleProjection.js');
const MIGRATION_PATH = path.join(
  REPO_ROOT, 'database', 'migrations',
  '20260818110000_issue164_listing_location_provenance.sql',
);

const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf8');
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, 'utf8');

/**
 * Every migration that DEFINES the listing-location visibility constraint, oldest first. Seller
 * Journey S3 widened the vocabulary with `province_only`, so the constraint in force is no longer
 * declared by this phase's migration alone. The invariant below is unchanged and still checked
 * against the DATABASE's effective vocabulary — it simply now reads every statement that sets it,
 * because pinning only the first migration would have let a later one drift unnoticed.
 */
const VISIBILITY_MIGRATION_PATHS = [
  '20260818110000_issue164_listing_location_provenance.sql',
  '20260828160000_seller_s3_location_visibility_province_only.sql',
].map((name) => path.join(REPO_ROOT, 'database', 'migrations', name));

const SOURCE = CLAIM_SOURCES[0];

/**
 * A row exactly as staging holds one today: every fabricated default present, not one provenance
 * column. This is the input the whole phase exists to answer correctly.
 */
const FABRICATED_ROW = Object.freeze({
  vin: '1HGCM82633A004352',
  registration_country: 'ZW',
  registration_authority: 'CVR',
  registration_status: 'Current',
  plate_status: 'Active',
  current_seller_type: 'Private Owner',
  current_seller_id: 'seller-1',
  public_seller_display_enabled: false,
  fuel_type: 'Petrol',
  transmission: 'Automatic',
  drivetrain: 'RWD',
  color: 'White',
  mileage: 0,
  vehicle_condition_category: 'unknown',
  publication_status: 'published',
  status: 'Available',
});

/** Walk every leaf of a claim payload as `[dottedName, statedPair]`. */
function claimLeaves(claims) {
  const out = [];
  for (const [block, fields] of Object.entries(LISTING_CLAIM_BLOCKS)) {
    for (const field of fields) out.push([`${block}.${field}`, claims[block][field]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The shape is closed
// ---------------------------------------------------------------------------

test('the contract declares five blocks and every block is frozen', () => {
  assert.deepEqual(Object.keys(LISTING_CLAIM_BLOCKS).sort(), [
    'location', 'publication', 'registration', 'seller', 'specification',
  ]);
  assert.ok(Object.isFrozen(LISTING_CLAIM_BLOCKS));
  for (const [block, fields] of Object.entries(LISTING_CLAIM_BLOCKS)) {
    assert.ok(Object.isFrozen(fields), `${block} field list must be frozen`);
    assert.ok(fields.length > 0, `${block} must declare at least one field`);
    assert.equal(new Set(fields).size, fields.length, `${block} declares a duplicate field`);
  }
});

test('every block carries exactly its declared fields — always all of them, never more', () => {
  const claims = toListingClaims(FABRICATED_ROW);
  assert.deepEqual(Object.keys(claims).sort(), Object.keys(LISTING_CLAIM_BLOCKS).sort());
  for (const [block, fields] of Object.entries(LISTING_CLAIM_BLOCKS)) {
    assert.deepEqual(
      Object.keys(claims[block]).sort(),
      [...fields].sort(),
      `${block} must carry exactly its declared fields — a missing key is not a third way to say unknown`,
    );
  }
});

test('an empty row still yields the full contract rather than an absent one', () => {
  // The failure this prevents: a surface that omits the whole block when it has nothing, so the
  // consumer cannot tell "no data" from "this endpoint does not report location".
  for (const empty of [{}, null, undefined]) {
    const claims = toListingClaims(empty);
    for (const [name, leaf] of claimLeaves(claims)) {
      assert.ok(isStatedValue(leaf), `${name} must be a stated pair even for an empty row`);
    }
  }
});

test('no block carries a trust field — Phase 3 remains the only authority on trust', () => {
  const forbidden = ['trust', 'trust_score', 'score', 'band', 'confidence', 'evaluation_state'];
  for (const [block, fields] of Object.entries(LISTING_CLAIM_BLOCKS)) {
    for (const field of fields) {
      assert.ok(
        !forbidden.includes(field),
        `${block}.${field} restates a trust field; canonicalTrustService.toPublicTrust() is the only shape that speaks for trust`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. States are exhaustive and mutually exclusive
// ---------------------------------------------------------------------------

test('every leaf of every projection carries exactly one declared state', () => {
  const rows = [
    FABRICATED_ROW,
    {},
    { ...FABRICATED_ROW, registration_country_source: SOURCE, current_seller_type_source: SOURCE },
    {
      ...FABRICATED_ROW,
      listing_city: 'Mutare', listing_province: 'Manicaland', listing_country: 'ZW',
      listing_location_source: SOURCE, listing_location_visibility: CLAIM_VISIBILITY.PUBLIC,
    },
    { ...FABRICATED_ROW, public_seller_display_enabled: true },
    { current_seller_id: null, mileage: 0, fuel_type: '' },
  ];
  const audiences = ['public', 'owner'];

  for (const row of rows) {
    for (const audience of audiences) {
      const claims = toListingClaims(row, {
        audience,
        sellerDisplayName: 'Kudzi Motors',
        publishedContactChannels: [],
      });
      for (const [name, leaf] of claimLeaves(claims)) {
        assert.ok(FIELD_STATE_VALUES.includes(leaf.state), `${name} state ${leaf.state} is outside the vocabulary`);
        // Mutual exclusivity, stated as the one invariant that makes the states meaningful:
        // a value is present exactly when the state says it is.
        assert.equal(
          leaf.value !== null,
          leaf.state === FIELD_STATES.RECORDED,
          `${name}: value presence and state disagree (${JSON.stringify(leaf)})`,
        );
        if ('source' in leaf && leaf.state !== FIELD_STATES.RECORDED) {
          assert.equal(leaf.source, null, `${name}: a non-recorded leaf must not disclose a source`);
        }
      }
    }
  }
});

test('all four states are reachable through the provenance primitive', () => {
  const reached = new Set([
    attestedValue('x', SOURCE).state,
    attestedValue(null, SOURCE).state,
    attestedValue('x', SOURCE, { withheld: true }).state,
    attestedValue('x', SOURCE, { notApplicable: true }).state,
  ]);
  assert.deepEqual([...reached].sort(), [...FIELD_STATE_VALUES].sort());
});

test('not_applicable outranks withheld, and withheld outranks provenance', () => {
  assert.equal(
    attestedValue('x', SOURCE, { withheld: true, notApplicable: true }).state,
    FIELD_STATES.NOT_APPLICABLE,
  );
  // Withheld must win even with NO provenance, or a caller could learn from the state alone that
  // the field it is being refused has never been recorded.
  assert.equal(attestedValue('x', null, { withheld: true }).state, FIELD_STATES.WITHHELD);
});

// ---------------------------------------------------------------------------
// 3. No provenance, no claim
// ---------------------------------------------------------------------------

test('the row exactly as staging holds it publishes NOT ONE registration or seller-type claim', () => {
  // 16 of 16 staging rows carry these values; every one was placed by a column DEFAULT and no
  // code path writes any of them. This is the assertion the phase exists for.
  const { registration, seller } = toListingClaims(FABRICATED_ROW);
  for (const [name, leaf] of [
    ['registration.country', registration.country],
    ['registration.authority', registration.authority],
    ['registration.status', registration.status],
    ['registration.plate_status', registration.plate_status],
    ['seller.seller_type', seller.seller_type],
  ]) {
    assert.equal(leaf.state, FIELD_STATES.NOT_RECORDED, `${name} must not be published without provenance`);
    assert.equal(leaf.value, null, `${name} must carry no value`);
    assert.equal(leaf.source, null);
  }
});

test('provenance is what promotes a value to a claim', () => {
  const attested = toRegistrationClaim({
    ...FABRICATED_ROW,
    registration_authority_source: 'registry_verified',
  });
  assert.deepEqual(attested.authority, {
    value: 'CVR', state: FIELD_STATES.RECORDED, source: 'registry_verified',
  });
  // ...and only for the column whose provenance was recorded.
  assert.equal(attested.country.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(attested.status.state, FIELD_STATES.NOT_RECORDED);
});

test('an unrecognised source fails closed rather than manufacturing a claim', () => {
  for (const bogus of ['registry-verified', 'REGISTRY_VERIFIED', 'trust_me', '', ' ', 0, true, null, undefined, {}]) {
    assert.equal(isClaimSource(bogus), false, `${String(bogus)} must not pass as a claim source`);
    const leaf = attestedValue('X', bogus);
    assert.equal(leaf.state, FIELD_STATES.NOT_RECORDED, `source ${String(bogus)} must not record a claim`);
    assert.equal(leaf.value, null);
  }
  assert.ok(Object.isFrozen(CLAIM_SOURCES) && CLAIM_SOURCES.length > 0);
  for (const source of CLAIM_SOURCES) assert.ok(isClaimSource(source));
});

test('provenance without a value is still not a claim', () => {
  for (const empty of [null, undefined, '', '   ']) {
    const leaf = attestedValue(empty, SOURCE);
    assert.equal(leaf.state, FIELD_STATES.NOT_RECORDED);
    assert.equal(leaf.value, null);
    assert.equal(leaf.source, null, 'a source with nothing behind it must not be published either');
  }
});

// ---------------------------------------------------------------------------
// 4. Location: no canonical source means unknown, never a plausible place
// ---------------------------------------------------------------------------

test('a listing with no recorded location publishes unknown, not a country or a capital', () => {
  const location = toLocationClaim(FABRICATED_ROW);
  for (const field of LISTING_CLAIM_BLOCKS.location) {
    assert.equal(location[field].state, FIELD_STATES.NOT_RECORDED);
    assert.equal(location[field].value, null, `location.${field} must not carry a substitute`);
  }
});

test('location never falls back to registration_country or to the seller profile', () => {
  const location = toLocationClaim({
    registration_country: 'ZW',
    registration_country_source: SOURCE,
    users_location: 'Harare',
    tenant: { name: 'Harare Motors', location: 'Harare' },
  });
  assert.equal(location.country.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(location.country.value, null,
    'where a car is registered is not where it is; the substitution that produced the hardcoded card location');
  assert.equal(location.city.value, null);
});

test('a recorded, published location is projected verbatim with its provenance', () => {
  const location = toLocationClaim({
    listing_city: 'Bulawayo',
    listing_province: 'Bulawayo Province',
    listing_country: 'ZW',
    listing_location_source: 'seller_declared',
    listing_location_visibility: CLAIM_VISIBILITY.PUBLIC,
  });
  assert.deepEqual(location.city, { value: 'Bulawayo', state: FIELD_STATES.RECORDED, source: 'seller_declared' });
  assert.equal(location.country.value, 'ZW');
});

test('a partially recorded location reports each component separately', () => {
  // The failure this prevents: filling a missing province from the city, or suppressing a real
  // city because the province is unknown.
  const location = toLocationClaim({
    listing_city: 'Gweru',
    listing_province: null,
    listing_country: '',
    listing_location_source: 'seller_declared',
    listing_location_visibility: CLAIM_VISIBILITY.PUBLIC,
  });
  assert.equal(location.city.state, FIELD_STATES.RECORDED);
  assert.equal(location.province.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(location.country.state, FIELD_STATES.NOT_RECORDED, 'an empty string carries no fact');
});

// ---------------------------------------------------------------------------
// 5. Withheld and unrecorded are distinguishable — and withheld leaks nothing
// ---------------------------------------------------------------------------

test('an undeclared location visibility withholds — absence is not permission', () => {
  const row = {
    listing_city: 'Mutare', listing_province: 'Manicaland', listing_country: 'ZW',
    listing_location_source: 'seller_declared',
  };
  const location = toLocationClaim(row);
  for (const field of LISTING_CLAIM_BLOCKS.location) {
    assert.equal(location[field].state, FIELD_STATES.WITHHELD);
    assert.equal(location[field].value, null);
    assert.equal(location[field].source, null, 'a withheld leaf must not disclose where the value came from');
  }
});

test('a withheld location is byte-identical whether or not a value exists behind it', () => {
  const withValue = toLocationClaim({
    listing_city: 'Mutare', listing_location_source: 'seller_declared',
    listing_location_visibility: CLAIM_VISIBILITY.WITHHELD,
  });
  const withoutValue = toLocationClaim({
    listing_city: null, listing_location_source: 'seller_declared',
    listing_location_visibility: CLAIM_VISIBILITY.WITHHELD,
  });
  assert.deepEqual(withValue.city, withoutValue.city,
    'a response that differs here answers the question the withholding exists to refuse');
});

test('withheld and not_recorded are distinguishable by the consumer', () => {
  const withheld = toLocationClaim({ listing_city: 'Mutare', listing_location_source: 'seller_declared' });
  const unrecorded = toLocationClaim({});
  assert.equal(withheld.city.state, FIELD_STATES.WITHHELD);
  assert.equal(unrecorded.city.state, FIELD_STATES.NOT_RECORDED);
  assert.notEqual(withheld.city.state, unrecorded.city.state);
});

test('nothing recorded means nothing to withhold, for every audience', () => {
  // Otherwise "withheld" becomes a way of implying a location exists.
  for (const audience of ['public', 'owner']) {
    const location = toLocationClaim({ listing_city: 'Mutare' }, { audience });
    assert.equal(location.city.state, FIELD_STATES.NOT_RECORDED,
      'a city with no provenance is not a secret, it is not a fact');
  }
});

test('the owner audience lifts the withholding gates without inventing a claim', () => {
  const row = {
    current_seller_id: 'seller-1',
    public_seller_display_enabled: false,
    listing_city: 'Mutare',
    listing_location_source: 'seller_declared',
  };
  const asPublic = toListingClaims(row, { audience: 'public', sellerDisplayName: 'Kudzi Motors' });
  const asOwner = toListingClaims(row, { audience: 'owner', sellerDisplayName: 'Kudzi Motors' });

  assert.equal(asPublic.seller.display_label.state, FIELD_STATES.WITHHELD);
  assert.equal(asOwner.seller.display_label.state, FIELD_STATES.RECORDED);
  assert.equal(asOwner.seller.display_label.value, 'Kudzi Motors');
  assert.equal(asPublic.location.city.state, FIELD_STATES.WITHHELD);
  assert.equal(asOwner.location.city.value, 'Mutare');

  // The gate is about disclosure, never about provenance: the owner is entitled to see their own
  // unpublished data, not to be told a claim exists that never did.
  assert.equal(asOwner.registration.authority.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(asOwner.seller.seller_type.state, FIELD_STATES.NOT_RECORDED);
});

// ---------------------------------------------------------------------------
// 6. Seller: no generic label, no inferred type, no fabricated contact
// ---------------------------------------------------------------------------

test('a seller who has published no name has no name shown', () => {
  const seller = toSellerClaim(
    { current_seller_id: 'seller-1', public_seller_display_enabled: true },
    { sellerDisplayName: null },
  );
  assert.equal(seller.display_label.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(seller.display_label.value, null,
    'a category label filling the gap is the same fabrication in a smaller font');
});

test('consent to be named is the literal true, never a coerced value', () => {
  for (const notConsent of ['true', 1, 'yes', {}, [], 'TRUE']) {
    const seller = toSellerClaim(
      { current_seller_id: 'seller-1', public_seller_display_enabled: notConsent },
      { sellerDisplayName: 'Kudzi Motors' },
    );
    assert.equal(seller.display_label.state, FIELD_STATES.WITHHELD,
      `${JSON.stringify(notConsent)} is not a seller's consent to be named`);
  }
});

test('the seller relationship publishes that a seller exists, never who', () => {
  const linked = toSellerClaim({ current_seller_id: 'seller-1' });
  assert.deepEqual(linked.relationship, { value: true, state: FIELD_STATES.RECORDED });
  const unlinked = toSellerClaim({ current_seller_id: null });
  assert.deepEqual(unlinked.relationship, { value: null, state: FIELD_STATES.NOT_RECORDED });
  assert.equal(JSON.stringify(linked).includes('seller-1'), false, 'the seller id must never reach the claim');
  // No seller linked means no name was withheld — there was never a name.
  assert.equal(unlinked.display_label.state, FIELD_STATES.NOT_RECORDED);
});

test('a joined tenant does not make a seller a dealer', () => {
  const seller = toSellerClaim({
    current_seller_id: 'seller-1',
    current_seller_type: 'Private Owner',
    tenant: { name: 'Kudzi Motors', type: 'dealership', status: 'active' },
  });
  assert.equal(seller.seller_type.state, FIELD_STATES.NOT_RECORDED,
    'a joined tenants row means a tenant exists, not that the seller is a dealer');
});

test('contact availability distinguishes not-consulted, none-published and published', () => {
  const linked = { current_seller_id: 'seller-1' };
  assert.equal(toSellerClaim(linked).contact_channel.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(
    toSellerClaim(linked, { publishedContactChannels: [] }).contact_channel.state,
    FIELD_STATES.WITHHELD,
  );
  const published = toSellerClaim(linked, { publishedContactChannels: ['in_app_message', 'in_app_message'] });
  assert.equal(published.contact_channel.state, FIELD_STATES.RECORDED);
  assert.deepEqual(published.contact_channel.value, ['in_app_message'], 'kinds are deduped');
  // No seller at all: there is nothing to withhold.
  assert.equal(
    toSellerClaim({}, { publishedContactChannels: [] }).contact_channel.state,
    FIELD_STATES.NOT_RECORDED,
  );
});

test('a contact address cannot be published where a channel kind belongs', () => {
  for (const address of ['+263771234567', 'sales@example.com', 'https://wa.me/263771234567', '0771234567', 12345, null]) {
    assert.throws(
      () => assertContactChannelKinds([address]),
      /channel KIND/,
      `${String(address)} must be rejected as a contact channel`,
    );
  }
  assert.throws(() => assertContactChannelKinds('in_app_message'), /array of channel kinds/);
});

test('a rejected contact channel is never echoed into the error', () => {
  // The Phase 0 defect was a fabricated phone number reaching a surface; copying a real one into
  // an exception message (and from there into a log) would reintroduce it by another route.
  const secret = '+263771234567';
  assert.throws(() => assertContactChannelKinds([secret]), (error) => {
    assert.ok(!error.message.includes(secret), 'the rejected value must be described, not repeated');
    assert.ok(error.message.includes('length'), 'the shape is what gets reported');
    return true;
  });
});

// ---------------------------------------------------------------------------
// 6b. Seller display label: the FULL name x consent x linkage matrix
//
// THE COVERAGE HOLE THIS CLOSES. The tests above pin one axis each and never vary the others
// together: the "no published name" case fixes consent to `true` (so the consent gate is never
// exercised without a name) and the "consent is the literal true" case always supplies a name (so
// the name gate is never exercised without consent). The one combination neither reaches —
// A NAME IS ABSENT AND CONSENT IS ABSENT — is the combination 12 of 16 staging listings are in,
// and it shipped emitting `withheld`: "there is a seller name and you are not cleared to see it",
// asserted over a column that holds nothing. A fabricated WITHHOLDING is a fabricated claim; it
// tells a shopper a seller made a privacy choice that no seller ever made.
//
// So the matrix below is enumerated exhaustively and its expectations are written as LITERAL
// STATES rather than recomputed from the rule — a table that derives its own answers proves only
// that the code agrees with itself.
// ---------------------------------------------------------------------------

const { RECORDED: R, NOT_RECORDED: N, WITHHELD: W } = FIELD_STATES;

/** A linked seller, as the row expresses it. `relationship` publishes the boolean, never this id. */
const LINKAGE = Object.freeze({
  linked: Object.freeze({ current_seller_id: 'seller-1' }),
  unlinked: Object.freeze({ current_seller_id: null }),
});

/** Consent, including the case the column is simply not there — which is not consent. */
const CONSENT = Object.freeze({
  true: Object.freeze({ public_seller_display_enabled: true }),
  false: Object.freeze({ public_seller_display_enabled: false }),
  absent: Object.freeze({}),
});

/** The name the caller resolved for this seller, or the absence of one. */
const NAME = Object.freeze({ present: 'Kudzi Motors', absent: null });

/**
 * linkage | name | consent | expected state for `public` | expected state for `owner`
 *
 * Read the two `linked/absent/(false|absent)` rows first: those are D3. Both were `withheld`
 * before this rule landed, and `withheld` there is a claim about a decision, made over an empty
 * column, on the majority of live listings.
 */
const SELLER_DISPLAY_LABEL_MATRIX = Object.freeze([
  // A name exists and the seller published it — the only way a name is ever shown.
  Object.freeze(['linked', 'present', 'true', R, R]),
  // A name exists and the seller did not publish it: a real withholding, lifted for its owner.
  Object.freeze(['linked', 'present', 'false', W, R]),
  Object.freeze(['linked', 'present', 'absent', W, R]),
  // No name exists. Nothing recorded, so nothing to withhold — whatever consent says, and even
  // for the owner, whose gate lifts onto an empty column.
  Object.freeze(['linked', 'absent', 'true', N, N]),
  Object.freeze(['linked', 'absent', 'false', N, N]),
  Object.freeze(['linked', 'absent', 'absent', N, N]),
  // No seller is linked. There is no one for a name to belong to, so a resolved name is not
  // published and its absence is not withheld.
  Object.freeze(['unlinked', 'present', 'true', N, N]),
  Object.freeze(['unlinked', 'present', 'false', N, N]),
  Object.freeze(['unlinked', 'present', 'absent', N, N]),
  Object.freeze(['unlinked', 'absent', 'true', N, N]),
  Object.freeze(['unlinked', 'absent', 'false', N, N]),
  Object.freeze(['unlinked', 'absent', 'absent', N, N]),
]);

test('ANTI-VACUITY: the display-label matrix is exhaustive over linkage x name x consent', () => {
  const expected = [];
  for (const linkage of Object.keys(LINKAGE)) {
    for (const name of Object.keys(NAME)) {
      for (const consent of Object.keys(CONSENT)) expected.push(`${linkage}|${name}|${consent}`);
    }
  }
  const covered = SELLER_DISPLAY_LABEL_MATRIX.map(([l, n, c]) => `${l}|${n}|${c}`);
  assert.equal(covered.length, 12, 'the matrix is 2 linkages x 2 name states x 3 consent states');
  assert.deepEqual([...covered].sort(), expected.sort(), 'every combination appears exactly once');
  assert.equal(new Set(covered).size, covered.length, 'no combination is asserted twice');

  // The table must also be capable of disagreeing with the code: all three states must appear in
  // it, or "every cell matches" could be satisfied by a function that returns one constant.
  const states = new Set(SELLER_DISPLAY_LABEL_MATRIX.flatMap(([, , , pub, own]) => [pub, own]));
  assert.deepEqual([...states].sort(), [R, N, W].sort());
});

test('seller display_label: every cell of the matrix, for both audiences', () => {
  for (const [linkage, name, consent, publicState, ownerState] of SELLER_DISPLAY_LABEL_MATRIX) {
    const row = { ...LINKAGE[linkage], ...CONSENT[consent] };
    for (const [audience, expectedState] of [['public', publicState], ['owner', ownerState]]) {
      const where = `linked=${linkage} name=${name} consent=${consent} audience=${audience}`;
      const { display_label: leaf } = toSellerClaim(row, {
        audience,
        sellerDisplayName: NAME[name],
      });
      assert.equal(leaf.state, expectedState, `${where}: expected ${expectedState}, got ${leaf.state}`);
      assert.equal(
        leaf.value,
        expectedState === R ? NAME[name] : null,
        `${where}: a value is present exactly when the state is recorded, and it is the seller's OWN name`,
      );
      assert.ok(isStatedValue(leaf), `${where}: the leaf must remain a well-formed stated pair`);
    }
  }
});

test('a withholding is never published with nothing behind it — the D3 regression', () => {
  // Measured on staging: owner_linked=12, tenant_linked=1, consented=0. The marketplace read path
  // resolves a name only from the joined tenant, so those 12 owner-linked listings hand in `null`
  // and previously published "Seller identity not published" — a claim about a choice nobody made.
  for (const consent of [{}, { public_seller_display_enabled: false }, { public_seller_display_enabled: null }]) {
    for (const audience of ['public', 'owner']) {
      const leaf = toSellerClaim(
        { current_seller_id: 'owner-12', ...consent },
        { audience, sellerDisplayName: null },
      ).display_label;
      assert.equal(
        leaf.state, N,
        `consent=${JSON.stringify(consent)} audience=${audience}: with no name resolved there is nothing to withhold`,
      );
      assert.notEqual(leaf.state, W, 'a withholding asserts a fact exists; over an empty column that is a fabrication');
    }
  }
});

test('a blank or whitespace name is not a name, and its absence is not a secret', () => {
  // Rule 4 inherited unchanged: '' and whitespace carry no fact, so they cannot be withheld either.
  for (const blank of ['', '   ', '\t\n', null, undefined]) {
    const leaf = toSellerClaim(
      { current_seller_id: 'seller-1', public_seller_display_enabled: false },
      { sellerDisplayName: blank },
    ).display_label;
    assert.equal(leaf.state, N, `${JSON.stringify(blank)} is not a name to withhold`);
    assert.equal(leaf.value, null);
  }
});

test('a real withholding still discloses nothing about the name it hides', () => {
  // The rule now says a withheld label means a name exists — it must not also say WHICH, or how
  // long, or where it came from. Two different names must be byte-identical once withheld.
  const row = { current_seller_id: 'seller-1', public_seller_display_enabled: false };
  const short = toSellerClaim(row, { sellerDisplayName: 'A' }).display_label;
  const long = toSellerClaim(row, { sellerDisplayName: 'Kudzi Motors Bulawayo Branch' }).display_label;
  assert.deepEqual(short, long, 'a withheld label must not vary with the name behind it');
  assert.deepEqual(short, { value: null, state: W });
  assert.equal(JSON.stringify(short).includes('Kudzi'), false);
});

test('withheld, not_recorded and recorded remain three distinguishable answers here', () => {
  // If the D3 fix had collapsed `withheld` into `not_recorded` for the seller, the state would stop
  // carrying information and the consent gate would become unobservable. It must not.
  const linked = { current_seller_id: 'seller-1' };
  const named = { sellerDisplayName: 'Kudzi Motors' };
  const withheld = toSellerClaim({ ...linked, public_seller_display_enabled: false }, named).display_label;
  const unrecorded = toSellerClaim({ ...linked, public_seller_display_enabled: false }, { sellerDisplayName: null }).display_label;
  const recorded = toSellerClaim({ ...linked, public_seller_display_enabled: true }, named).display_label;
  assert.deepEqual([withheld.state, unrecorded.state, recorded.state], [W, N, R]);
  assert.equal(new Set([withheld.state, unrecorded.state, recorded.state]).size, 3);
});

test('the owner gate lifts disclosure, it does not conjure a name', () => {
  const asOwner = toSellerClaim(
    { current_seller_id: 'seller-1', public_seller_display_enabled: false },
    { audience: 'owner', sellerDisplayName: null },
  );
  assert.equal(asOwner.display_label.state, N,
    'an owner is entitled to see their own unpublished name, not to be told one exists that never did');
  assert.deepEqual(asOwner.relationship, { value: true, state: R },
    'the seller link is still a recorded fact — only the name is unknown');
});

test('the staging row publishes a seller relationship and no identity claim at all', () => {
  // The end-to-end shape of the defect, through the whole contract rather than one leaf.
  const { seller } = toListingClaims(
    { ...FABRICATED_ROW, public_seller_display_enabled: false },
    { sellerDisplayName: null },
  );
  assert.equal(seller.relationship.value, true);
  assert.equal(seller.display_label.state, N);
  assert.equal(seller.seller_type.state, N, 'still unprovenanced — Rule 1 is untouched by this fix');
  assert.equal(seller.contact_channel.state, N, 'this path resolves no channels');
  assert.deepEqual(findBareClaims({ claims: { seller } }), []);
});

// ---------------------------------------------------------------------------
// 7. Specification and publication: zero is a fact, blank is not
// ---------------------------------------------------------------------------

test('a genuine zero mileage is recorded and a blank specification is not', () => {
  const spec = toSpecificationClaim({
    mileage: 0,
    fuel_type: '',
    transmission: '   ',
    drivetrain: null,
    color: 'White',
  });
  assert.deepEqual(spec.mileage, { value: 0, state: FIELD_STATES.RECORDED },
    'a genuine zero mileage is data; treating it as missing is its own fabrication');
  assert.equal(spec.fuel_type.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(spec.transmission.state, FIELD_STATES.NOT_RECORDED, 'whitespace carries no fact');
  assert.equal(spec.drivetrain.state, FIELD_STATES.NOT_RECORDED);
  assert.equal(spec.color.value, 'White', 'a recorded colour stays recorded — the write path owns the substitution');
});

test('the condition category absence marker maps to not_recorded, not to a category', () => {
  assert.equal(
    toSpecificationClaim({ vehicle_condition_category: CONDITION_ABSENCE_MARKER }).condition_category.state,
    FIELD_STATES.NOT_RECORDED,
  );
  assert.deepEqual(
    toSpecificationClaim({ vehicle_condition_category: 'recently_imported' }).condition_category,
    { value: 'recently_imported', state: FIELD_STATES.RECORDED },
  );
});

test('a false boolean is a recorded fact, not a missing one', () => {
  assert.deepEqual(statedValue(false), { value: false, state: FIELD_STATES.RECORDED });
  assert.deepEqual(attestedValue(false, SOURCE), { value: false, state: FIELD_STATES.RECORDED, source: SOURCE });
});

test('publication state is reported as a stated pair like everything else', () => {
  const publication = toPublicationClaim({ publication_status: 'draft', status: 'Available' });
  assert.deepEqual(publication.publication_status, { value: 'draft', state: FIELD_STATES.RECORDED });
  assert.deepEqual(publication.listing_status, { value: 'Available', state: FIELD_STATES.RECORDED });
  assert.equal(toPublicationClaim({}).publication_status.state, FIELD_STATES.NOT_RECORDED);
});

// ---------------------------------------------------------------------------
// 8. The helper: a surface cannot emit a bare value
// ---------------------------------------------------------------------------

test('sealClaimBlock refuses a bare value', () => {
  assert.throws(
    () => sealClaimBlock('location', { city: 'Harare', province: statedValue(null), country: statedValue(null) }),
    /must be a stated pair/,
  );
  assert.throws(
    () => sealClaimBlock('location', { city: statedValue(null), province: statedValue(null) }),
    /country must be a stated pair/,
    'a block may not simply omit a field',
  );
  assert.throws(
    () => sealClaimBlock('location', {
      city: statedValue(null), province: statedValue(null), country: statedValue(null), region: statedValue('x'),
    }),
    /undeclared field/,
    'widening the contract is a reviewed change, not a per-caller addition',
  );
  assert.throws(() => sealClaimBlock('vehicle', {}), /Unknown listing claim block/);
});

test('sealClaimBlock refuses a malformed pair, including a value smuggled past a non-recorded state', () => {
  const cases = [
    { value: 'x', state: 'unknown' },
    { value: 'x', state: FIELD_STATES.WITHHELD },
    { value: 'x', state: FIELD_STATES.NOT_RECORDED },
    { value: 'x' },
    { state: FIELD_STATES.RECORDED },
    { value: 'x', state: FIELD_STATES.RECORDED, source: 'made_up' },
    { value: null, state: FIELD_STATES.WITHHELD, source: SOURCE },
    { value: 'x', state: FIELD_STATES.RECORDED, source: SOURCE, raw: 'x' },
  ];
  for (const bad of cases) {
    assert.equal(isStatedValue(bad), false, `${JSON.stringify(bad)} must not pass as a stated pair`);
    assert.throws(
      () => sealClaimBlock('publication', { publication_status: bad, listing_status: statedValue(null) }),
      /must be a stated pair/,
    );
  }
});

test('a sealed block is frozen, leaf and all', () => {
  const block = toLocationClaim({});
  assert.ok(Object.isFrozen(block));
  assert.ok(Object.isFrozen(block.city));
  assert.throws(() => { block.city = 'Harare'; }, TypeError);
});

test('findBareClaims is precise: it flags a planted bare claim and nothing else', () => {
  const clean = { data: { vehicle: toListingClaims(FABRICATED_ROW) } };
  assert.deepEqual(findBareClaims(clean), []);

  // ANTI-VACUITY: a scan that cannot fail is not a scan.
  const dirty = JSON.parse(JSON.stringify(clean));
  dirty.data.vehicle.location.city = 'Harare';
  dirty.data.vehicle.seller.display_label = 'Verified dealer';
  assert.deepEqual(findBareClaims(dirty), ['location.city', 'seller.display_label']);

  // An unrelated `country`/`color` elsewhere in a body is not a governed claim and must not be
  // mistaken for one, or the guard becomes noise a reviewer learns to ignore.
  assert.deepEqual(findBareClaims({ shipping: { country: 'ZW' }, paint: { color: 'White' } }), []);
});

test('findBareClaims survives a cyclic payload', () => {
  const payload = { vehicle: toListingClaims({}) };
  payload.self = payload;
  assert.deepEqual(findBareClaims(payload), []);
});

// ---------------------------------------------------------------------------
// 9. Fabricated-default sentinel scan over the module's string literals
// ---------------------------------------------------------------------------

/**
 * The plausible defaults this phase deleted, plus the ones adjacent to them. Matched
 * case-insensitively on a WORD boundary, so `Auto` does not fire on `Automotive` — a scanner that
 * cries wolf is one a future author routes around.
 */
const FABRICATED_DEFAULT_SENTINELS = Object.freeze([
  'Harare', 'Zimbabwe', 'ZW', 'CVR',
  'Petrol', 'Diesel', 'Auto', 'Automatic', 'Manual', 'RWD', 'White', 'Used',
  'Verified dealer', 'Private seller', 'Private Owner',
  'Active', 'Current', 'Available',
]);

/**
 * Extract JavaScript STRING LITERALS from source, skipping comments and regex literals.
 *
 * Comments are skipped deliberately rather than incidentally: the contract documentation must be
 * free to name the fabrications it removes, and a scan that cannot tell a `'CVR'` in prose from a
 * `'CVR'` in code would force the documentation to be vague about exactly the thing it exists to
 * be precise about. Regex literals are skipped because one may contain a quote character, which
 * would otherwise desynchronise the reader for the rest of the file.
 */
function extractStringLiterals(source) {
  const literals = [];
  // A `/` opens a regex only where a value may begin. After an identifier, a number or a closing
  // bracket it is division.
  const REGEX_MAY_FOLLOW = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return']);
  let index = 0;
  let previous = '';

  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (ch === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (ch === '/' && REGEX_MAY_FOLLOW.has(previous)) {
      index += 1;
      let inCharClass = false;
      while (index < source.length) {
        const c = source[index];
        if (c === '\\') { index += 2; continue; }
        if (c === '[') inCharClass = true;
        else if (c === ']') inCharClass = false;
        else if (c === '/' && !inCharClass) { index += 1; break; }
        else if (c === '\n') break;
        index += 1;
      }
      previous = '/';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      index += 1;
      let buffer = '';
      while (index < source.length) {
        const c = source[index];
        if (c === '\\') { buffer += source[index + 1] ?? ''; index += 2; continue; }
        if (c === quote) { index += 1; break; }
        buffer += c;
        index += 1;
      }
      literals.push(buffer);
      previous = quote;
      continue;
    }
    if (!/\s/.test(ch)) previous = ch;
    index += 1;
  }
  return literals;
}

/**
 * Literals that are MEMBERS OF A GOVERNED CLOSED VOCABULARY, not fabricated defaults.
 *
 * The sentinels exist to catch a DB default reappearing as a string in the canonical module —
 * `plate_status` 'Active' on 16 of 16 rows, `status` 'Available' on every listing. Those are
 * capitalized, because that is how the defaults were written.
 *
 * The finance-obligation authority later gave the same module two lowercase vocabulary members:
 * `FINANCE_DISCLOSURE_STATES` includes 'active', and the governed encumbrance projection publishes
 * `source_state: 'available'` to mean "a channel exists and the read succeeded". Both are the
 * OPPOSITE of a fabrication — they are the closed vocabulary that stops one — and neither can be
 * renamed to satisfy a scanner without changing a published contract.
 *
 * Exempting them by EXACT lowercase value keeps the scan's teeth: a capitalized 'Available' or
 * 'Active' — the actual fabricated-default form — still fires, as the anti-vacuity test below
 * proves. Only these two exact literals are exempt, and only in lowercase.
 */
const GOVERNED_VOCABULARY_LITERALS = new Set(['active', 'available']);

function sentinelsIn(literals) {
  const hits = new Set();
  for (const literal of literals) {
    if (GOVERNED_VOCABULARY_LITERALS.has(literal)) continue;
    for (const sentinel of FABRICATED_DEFAULT_SENTINELS) {
      const pattern = new RegExp(`(^|\\W)${sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (pattern.test(literal)) hits.add(sentinel);
    }
  }
  return [...hits].sort();
}

test('ANTI-VACUITY: the literal reader actually reads the module', () => {
  const literals = extractStringLiterals(MODULE_SOURCE);
  assert.ok(
    literals.length > 100,
    `expected the canonical projection's string literals, found only ${literals.length} — an empty extraction would make the sentinel scan below vacuously green`,
  );
  // It really is reading literals rather than whole lines: the field names are in there.
  assert.ok(literals.includes('registration_authority'));
  assert.ok(literals.includes('seller_declared'));
});

test('ANTI-VACUITY: the reader ignores comments and word-fragments, and catches a real literal', () => {
  const control = [
    "// a line comment naming Harare must not count as a literal",
    "/* nor a block comment naming Zimbabwe or CVR or Petrol */",
    "const word = 'Automotive';",
    "const re = /don't-match-Used-here/;",
    "const planted = 'Harare';",
  ].join('\n');
  assert.deepEqual(
    sentinelsIn(extractStringLiterals(control)),
    ['Harare'],
    'exactly the planted literal — a comment, a word-fragment and a regex must not fire, and the regex must not desynchronise the reader',
  );
});

test('ANTI-VACUITY: the governed-vocabulary exemption is exact, and the fabricated form still fires', () => {
  // The exemption must not become a hole. Only the two exact lowercase vocabulary members pass;
  // the capitalized DB-default form — the thing the sentinel exists to catch — must still fire,
  // and so must any literal that merely CONTAINS the exempt word.
  assert.deepEqual(sentinelsIn(['active', 'available']), [], 'the governed vocabulary members are exempt');
  assert.deepEqual(sentinelsIn(['Available']), ['Available'], 'the fabricated default form must still fire');
  assert.deepEqual(sentinelsIn(['Active']), ['Active'], 'the fabricated default form must still fire');
  assert.deepEqual(
    sentinelsIn(['status is active']), ['Active'],
    'the exemption is the whole literal, never a substring — a sentence containing the word still fires',
  );
});

test('the canonical projection module contains no fabricated-default literal', () => {
  const hits = sentinelsIn(extractStringLiterals(MODULE_SOURCE));
  assert.deepEqual(
    hits,
    [],
    `publicVehicleProjection.js holds fabricated-default literal(s): ${hits.join(', ')}. `
    + 'A default that reappears as a string in the canonical module is the fabrication returning through the contract itself.',
  );
});

// ---------------------------------------------------------------------------
// 10. The migration: additive, no backfill, one vocabulary
// ---------------------------------------------------------------------------

/** SQL with `--` comment lines removed, so an assertion talks about statements, not prose. */
function executableSql(sql) {
  return sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
}

const [MIGRATION_UP, MIGRATION_DOWN] = (() => {
  const marker = '-- +migrate Down';
  const at = MIGRATION_SOURCE.indexOf(marker);
  assert.ok(at > 0, 'the migration must declare a Down section');
  return [MIGRATION_SOURCE.slice(0, at), MIGRATION_SOURCE.slice(at)];
})();

test('the migration adds every column the contract reads, and nothing writes a row', () => {
  const up = executableSql(MIGRATION_UP);
  for (const column of LISTING_CLAIM_COLUMNS) {
    assert.ok(
      new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\b`).test(up),
      `${column} is read by the contract but not added by the migration`,
    );
  }
  assert.ok(!/\binsert\s+into\b/i.test(up), 'no INSERT: this migration must not write a row');
  assert.ok(!/\bupdate\s+public\.vehicles\b/i.test(up), 'no UPDATE: inventing a city for an existing listing is the fabrication this phase removes');
  assert.ok(!/\bdelete\s+from\b/i.test(up), 'no DELETE');
  assert.ok(!/\bset\s+default\b/i.test(up), 'the Up section must not create a default — that is the defect');
  assert.ok(/\bALTER COLUMN\b[\s\S]*\bDROP DEFAULT\b/i.test(up), 'the fabricating defaults must be dropped');
});

test('the migration owns location on the vehicle row and says why', () => {
  assert.ok(/ALTER TABLE public\.vehicles ADD COLUMN IF NOT EXISTS listing_city/.test(MIGRATION_UP));
  // The alternatives were checked rather than assumed; the header must show the work.
  for (const candidate of ['vehicle_listings', 'vehicle_listing_summaries', 'users.location', 'listing_images']) {
    assert.ok(MIGRATION_SOURCE.includes(candidate), `the header must justify the owner table against ${candidate}`);
  }
});

test('the migration and the module share one provenance vocabulary', () => {
  // Two copies of a vocabulary is how a database accepts a source the projection then ignores.
  const declared = MIGRATION_SOURCE.match(/c_sources\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
  assert.ok(declared, 'the migration must declare the claim-source vocabulary');
  const fromSql = [...declared[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...fromSql].sort(), [...CLAIM_SOURCES].sort());

  // The visibility vocabulary is declared by more than one migration since S3 widened it. Two
  // properties are checked, and together they are strictly stronger than pinning one file:
  //   1. the constraint IN FORCE — the last migration to define it — is exactly the module's list,
  //      so the database can never accept a visibility the projection does not understand;
  //   2. no migration ever declared a value the module does not carry.
  const declaredPerMigration = VISIBILITY_MIGRATION_PATHS.map((migrationPath) => {
    const match = readFileSync(migrationPath, 'utf8')
      .match(/c_visibility\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
    assert.ok(match, `${path.basename(migrationPath)} must declare the visibility vocabulary`);
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
  });

  const inForce = declaredPerMigration[declaredPerMigration.length - 1];
  assert.deepEqual(
    [...inForce].sort(),
    Object.values(CLAIM_VISIBILITY).sort(),
    'the constraint in force and the module must be one vocabulary, not two copies',
  );

  const everDeclared = [...new Set(declaredPerMigration.flat())];
  const unknown = everDeclared.filter((value) => !Object.values(CLAIM_VISIBILITY).includes(value));
  assert.deepEqual(unknown, [], `a migration allowed a visibility the projection ignores: ${unknown.join(', ')}`);
});

test('the migration proves it backfilled nothing and rewrote nothing', () => {
  assert.ok(/must not backfill/i.test(MIGRATION_SOURCE), 'the no-backfill postcondition must name itself');
  assert.ok(/existing vehicle data changed/i.test(MIGRATION_SOURCE), 'a pre/post digest assertion must exist');
  assert.ok(/RAISE EXCEPTION/.test(MIGRATION_UP), 'the guards must RAISE rather than warn');
});

test('the migration Down is documentation, not an executable reversal', () => {
  const down = executableSql(MIGRATION_DOWN).trim();
  assert.equal(down, 'SELECT 1;',
    'restoring the defaults would republish claims with no writer behind them; reversal is a deliberate operator action');
});

test('the new columns are declared to the read paths but kept out of the public select', () => {
  // PostgREST fails a whole select when it names an unknown column, so widening the canonical
  // select before this unapplied migration lands would take down every public vehicle read.
  // WAS `=== 11`. N3 added `currency_source` to the migration and to this list in one change: the
  // read path gates currency on provenance, so shipping the DEFAULT drop without the source column
  // would have made a genuinely stated currency permanently unpublishable — a fabricated
  // withholding. The count tracks a reviewed widening; it still bites as the tripwire below.
  assert.ok(Object.isFrozen(LISTING_CLAIM_COLUMNS) && LISTING_CLAIM_COLUMNS.length === 12);
  for (const column of LISTING_CLAIM_COLUMNS) {
    assert.ok(
      !new RegExp(`'${column}'`).test(MODULE_SOURCE.split('LISTING_CLAIM_COLUMNS')[0]),
      `${column} must not be in the canonical select until the migration is applied`,
    );
  }
});

// ===========================================================================================
// 11. THE WRITE PATH — POST /api/vehicles/add, driven for real
//
// Sections 1–10 govern what a read path may PUBLISH. They cannot govern what the write path
// STORES, and that is the half where a fabrication becomes permanent: a substituted 'Petrol', a
// coerced `mileage: 0` or a stored `''` is indistinguishable from a fact the moment it lands in
// the column, and no state on the way out can undo it. Phase 4 changed this live endpoint in five
// ways that nothing here was watching — two new 400s, four specification substitutions removed,
// provenance stamping added, location finally persisted, and a retry for the interval before the
// companion migration is applied.
//
// These drive the REAL shipped handler in backend/server.js over HTTP (NODE_ENV=test → no
// app.listen, and the x-user-id fallback stands in for a session) against an in-memory Supabase,
// exactly as backend/tests/auth-register-privilege.test.js does. Nothing here is asserted from
// source text: every assertion below is about a row the handler actually tried to write, or a
// response body it actually returned.
// ===========================================================================================

/** A structurally valid VIN (17 chars, no I/O/Q, no synthetic prefix) — eligibility rejects less. */
const WRITE_VIN = '1HGBH41JXMN109186';
const OWNER_ID = 'usr-1001';
const DEALER_ID = 'usr-2002';
const REAL_TENANT_ID = 'a1b2c3d4-1111-2222-3333-444455556666';

/** The minimum a submission needs to reach the insert; each test overrides what it is about. */
const BASE_SUBMISSION = Object.freeze({
  vin: WRITE_VIN, make: 'Toyota', model: 'Hilux', year: 2021, price: 25000,
  currency: 'USD', mileage: 42000,
});

describe('POST /api/vehicles/add — what a submitted fact is allowed to become', () => {
  let app;
  let supabase;
  let server;
  let baseUrl;

  /** Rows the handler successfully persisted, by table. */
  let store;
  /** EVERY `vehicles` insert the handler attempted, including ones the database rejected. */
  let vehicleInsertAttempts;
  /** Optional programmable failure: (row, attemptNumber) => postgrest-shaped error | null. */
  let vehicleInsertFailure;
  /** The platform role the mocked `users` row reports for the calling id. */
  let callerRole;

  function reset() {
    store = { vehicles: [], vehicle_ownership_history: [], listing_images: [] };
    vehicleInsertAttempts = [];
    vehicleInsertFailure = null;
    callerRole = 'owner';
  }

  function handle(op) {
    if (op.table === 'users') return { data: { role: callerRole, is_verified: true }, error: null };
    // A tenant membership for the dealer case; authorizeRole 403s without one.
    if (op.table === 'tenant_users') return { data: { role: callerRole }, error: null };
    if (op.table === 'vehicles') {
      if (op.action === 'insert') {
        const row = Array.isArray(op.payload) ? op.payload[0] : op.payload;
        vehicleInsertAttempts.push(row);
        const error = vehicleInsertFailure ? vehicleInsertFailure(row, vehicleInsertAttempts.length) : null;
        // A rejected single-row PostgREST insert writes nothing, so the store is only touched on
        // success — otherwise the retry assertions could not tell a rollback from a double write.
        if (error) return { data: null, error };
        store.vehicles.push({ ...row });
        return { data: null, error: null };
      }
      const found = store.vehicles.find((v) => v.vin === op.filters.vin) || null;
      if (found) return { data: found, error: null };
      // `.single()` and `.maybeSingle()` answer an empty result DIFFERENTLY, and modelling them the
      // same way made every handler that correctly uses `.maybeSingle()` look like it had thrown.
      // postgrest-js fetches a list and enforces cardinality client-side: with `isMaybeSingle` set,
      // zero rows resolve to `{ data: null, error: null }` and PGRST116 is raised only for MORE than
      // one row (PostgrestBuilder.ts). `.single()` alone reports "no rows" as an error.
      return op.maybeSingle
        ? { data: null, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    if (op.action === 'insert') {
      const rows = Array.isArray(op.payload) ? op.payload : [op.payload];
      (store[op.table] ||= []).push(...rows);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  function installSupabaseMock() {
    supabase.from = (table) => {
      const op = { table, action: 'select', filters: {}, payload: null, single: false };
      const chain = {
        select() { return chain; },
        insert(payload) { op.action = 'insert'; op.payload = payload; return chain; },
        update(payload) { op.action = 'update'; op.payload = payload; return chain; },
        delete() { op.action = 'delete'; return chain; },
        eq(key, value) { op.filters[key] = value; return chain; },
        in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
        maybeSingle() { op.single = true; op.maybeSingle = true; return chain; },
        single() { op.single = true; return chain; },
        then(onFulfilled, onRejected) { return Promise.resolve(handle(op)).then(onFulfilled, onRejected); },
      };
      return chain;
    };
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';
    reset();
    ({ app } = await import('../server.js'));
    ({ supabase } = await import('../db/supabase.js'));
    installSupabaseMock();
    await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
  beforeEach(reset);

  async function submit(body, { userId = OWNER_ID, tenantId = null } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'x-bypass-rate-limit': 'true',
      'x-user-id': userId,
    };
    if (tenantId) headers['x-tenant-id'] = tenantId;
    const response = await fetch(`${baseUrl}/api/vehicles/add`, {
      method: 'POST', headers, body: JSON.stringify({ ...BASE_SUBMISSION, ...body }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  /** The single row that reached the database, asserted to be single. */
  function persistedVehicle() {
    assert.equal(store.vehicles.length, 1, `exactly one vehicle row must have been written, found ${store.vehicles.length}`);
    return store.vehicles[0];
  }

  // -- a submitted location persists WITH its source and its visibility -----------------------

  it('a submitted location is stored with its provenance and its visibility, and the read contract then publishes it', async () => {
    const { status, body } = await submit({ location: 'Bulawayo', province: 'Bulawayo Province' });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.location_recorded, true, 'the response must state what was actually recorded');
    assert.equal(body.location_visibility, CLAIM_VISIBILITY.PUBLIC);

    const row = persistedVehicle();
    assert.equal(row.listing_city, 'Bulawayo');
    assert.equal(row.listing_province, 'Bulawayo Province');
    // Provenance is not decoration: without it the read contract refuses to publish the value at
    // all, so a location stored bare would be a silent discard wearing a column.
    assert.equal(row.listing_location_source, 'seller_declared', 'an owner listing their own car declared it');
    assert.equal(row.listing_location_visibility, CLAIM_VISIBILITY.PUBLIC);
    assert.ok(!Number.isNaN(Date.parse(row.listing_location_recorded_at)), 'the recording time must be a real timestamp');

    // ROUND TRIP: the row the write path produced, read back through the canonical contract.
    // Asserting the columns alone would pass even if the two halves disagreed about the vocabulary.
    const location = toLocationClaim(row);
    assert.deepEqual(location.city, { value: 'Bulawayo', state: FIELD_STATES.RECORDED, source: 'seller_declared' });
    assert.deepEqual(location.province, { value: 'Bulawayo Province', state: FIELD_STATES.RECORDED, source: 'seller_declared' });
  });

  it('an explicit non-public visibility is stored as withheld, and the read path then withholds it', async () => {
    const { status, body } = await submit({ location: 'Mutare', location_visibility: 'private' });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.location_visibility, CLAIM_VISIBILITY.WITHHELD,
      'anything other than an explicit "public" is not consent to publish');

    const row = persistedVehicle();
    assert.equal(row.listing_city, 'Mutare', 'the value is still RECORDED — withholding is about disclosure, not storage');
    assert.equal(row.listing_location_visibility, CLAIM_VISIBILITY.WITHHELD);

    assert.equal(toLocationClaim(row).city.state, FIELD_STATES.WITHHELD);
    assert.equal(toLocationClaim(row).city.value, null);
    assert.equal(toLocationClaim(row, { audience: 'owner' }).city.value, 'Mutare',
      'the person who recorded it may still see it — that is what makes withheld a real state');
  });

  // -- a blank location is not a fact -----------------------------------------------------------

  it('a blank / whitespace-only location is not stored as a recorded value and the response reports location_recorded false', async () => {
    const { status, body } = await submit({ location: '   ', province: '' });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.location_recorded, false, 'nothing was recorded, and the caller is told so at the moment it happened');
    assert.equal(body.location_visibility, null, 'there is no visibility decision about a location that does not exist');

    const row = persistedVehicle();
    // NOT `''`. A stored empty string is a recorded blank that no later read can tell from a real
    // value, and no state on the read side can undo it — unknown has to stay unknown on the way in.
    for (const column of ['listing_city', 'listing_province', 'listing_country', 'listing_location_source', 'listing_location_visibility']) {
      assert.equal(column in row, false, `${column} must not be written at all for a submission that stated no location`);
    }

    // Rule 2 end to end: nothing recorded means nothing to withhold, for either audience.
    for (const audience of ['public', 'owner']) {
      const location = toLocationClaim(row, { audience });
      for (const field of LISTING_CLAIM_BLOCKS.location) {
        assert.equal(location[field].state, FIELD_STATES.NOT_RECORDED,
          `location.${field} must be not_recorded for the ${audience} audience, never a fabricated withholding`);
      }
    }
  });

  // -- location is never inferred from registration ---------------------------------------------

  it('listing_country is never inferred from registration_country', async () => {
    const { status } = await submit({ registration_country: 'ZW', location: 'Gweru' });
    assert.equal(status, 201);
    const row = persistedVehicle();

    assert.equal(row.registration_country, 'ZW', 'the registration country is still stored — this is about not COPYING it');
    assert.equal(row.listing_country, null,
      'where a car is registered is not where it is; this substitution produced the hardcoded country on every card');

    const claims = toListingClaims(row);
    assert.equal(claims.registration.country.value, 'ZW');
    assert.equal(claims.location.country.state, FIELD_STATES.NOT_RECORDED);
    assert.equal(claims.location.city.value, 'Gweru',
      'and the city the seller DID state is unaffected — a partially known location reports each part separately');
  });

  it('ANTI-VACUITY: an explicitly submitted listing country IS stored, so the previous test measures inference and not an unwired column', async () => {
    const { status } = await submit({ registration_country: 'ZA', listing_country: 'ZW', location: 'Harare' });
    assert.equal(status, 201);
    const row = persistedVehicle();
    assert.equal(row.listing_country, 'ZW');
    assert.equal(row.registration_country, 'ZA', 'the two are independent facts and neither overwrites the other');
    assert.equal(toLocationClaim(row).country.value, 'ZW');
  });

  // -- mileage: a genuine zero is a fact, a missing one is refused ------------------------------

  it('a genuine mileage of 0 is accepted and stored as 0', async () => {
    const { status, body } = await submit({ mileage: 0 });
    assert.equal(status, 201, JSON.stringify(body));
    const row = persistedVehicle();
    assert.equal(row.mileage, 0);
    assert.equal(typeof row.mileage, 'number', '"0" as text is not the same fact as the number 0');
    assert.deepEqual(toSpecificationClaim(row).mileage, { value: 0, state: FIELD_STATES.RECORDED },
      'a delivery-mileage vehicle has a recorded odometer; demoting it to missing is its own fabrication');
  });

  it('a missing mileage is refused rather than coerced to 0, and nothing is written', async () => {
    // `vehicles.mileage` is NOT NULL with no default, so the column cannot hold "not known" and the
    // old `mileage || 0` resolved that by writing 0 km as a fact — a reading a shopper cannot tell
    // apart from the genuine zero asserted immediately above. Where a column cannot record unknown,
    // refusing the write is the only honest resolution.
    for (const missing of [undefined, null, '', '   ', 'not sure', {}, -1]) {
      reset();
      const { status, body } = await submit({ mileage: missing });
      assert.equal(status, 400, `mileage ${JSON.stringify(missing)} must be refused, got ${status}`);
      assert.match(body.error, /mileage/i, 'the caller must be told which field was refused');
      assert.equal(vehicleInsertAttempts.length, 0, 'a refused submission must not reach the database at all');
      assert.equal(store.vehicles.length, 0);
    }
  });

  it('a price with no currency is refused rather than stamped with a default currency', async () => {
    // `currency || 'USD'` stated a currency the seller never did, in a market that actively trades
    // in more than one. A number with no currency is not a price.
    for (const missing of [undefined, null, '', '  ']) {
      reset();
      const { status, body } = await submit({ currency: missing });
      assert.equal(status, 400, `currency ${JSON.stringify(missing)} must be refused, got ${status}`);
      assert.match(body.error, /currency/i);
      assert.equal(vehicleInsertAttempts.length, 0);
    }
    reset();
    const zwl = await submit({ currency: 'ZWG' });
    assert.equal(zwl.status, 201, 'a stated non-USD currency is a fact and must be stored verbatim');
    assert.equal(persistedVehicle().currency, 'ZWG');
  });

  // -- the specification substitutions are gone --------------------------------------------------

  it('an omitted or blank specification is stored as unknown, not as a plausible default', async () => {
    // The four the handler used to invent for every client that omitted them. A substituted value
    // lands in a column with NO provenance to gate on, so the read contract cannot tell it from a
    // fact — which is why this one is closed on the write side or not at all.
    const { status } = await submit({ color: '   ', fuel_type: '', transmission: undefined, drivetrain: null });
    assert.equal(status, 201);
    const row = persistedVehicle();
    for (const [column, fabricated] of [['color', 'White'], ['fuel_type', 'Petrol'], ['transmission', 'Automatic'], ['drivetrain', 'RWD']]) {
      assert.equal(row[column], null, `${column} must be stored as unknown, never as the old ${fabricated} substitute`);
    }
    // `''` is a recorded blank, not an unrecorded field — neither is collected by this endpoint.
    assert.equal(row.generation, null);
    assert.equal(row.trim, null);

    const specification = toSpecificationClaim(row);
    for (const field of ['color', 'fuel_type', 'transmission', 'drivetrain']) {
      assert.equal(specification[field].state, FIELD_STATES.NOT_RECORDED);
    }
    assert.equal(toSpecificationClaim({ ...row, color: 'White' }).color.value, 'White',
      'a colour the seller DID state is still recorded — the defect was the substitution, not the column');
  });

  // -- provenance stamping: who asserted it ------------------------------------------------------

  // ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 enforceability pass ──────────────────────────
  // This test used to be titled "…and the substituted registration country earns none" and its
  // second half asserted `substitutedRow.registration_country === 'ZW'` with the message "the
  // substitute still lands in the column". That was PHASE 4'S OWN TEST PINNING THE FABRICATION
  // PHASE 4 REMOVED. It was written against a half-closed design in which the write path kept
  // substituting 'ZW' and only the provenance stamp was withheld — leaving the invented country
  // sitting in `public.vehicles` for every other reader (a raw `select`, a report, a future read
  // path that has not been taught about provenance) to publish as fact. The eligibility lane then
  // closed the substitution itself in `buildVehicleListingCandidate`, and this assertion was left
  // demanding it back: a suite that REQUIRES the defect, which is worse than one that fails to
  // catch it.
  //
  // The corrected guarantee is asserted below, and it is a stronger one than the old pair: an
  // unstated registration country is not stored at all (explicit null), AND a stated one is stored
  // WITH `seller_declared` provenance so the read contract can publish it. Both halves are needed
  // — the first alone would pass if the column had simply been dropped from the insert.
  it('an unstated registration country is stored as null; a stated one is stored with its provenance', async () => {
    // HALF ONE — SUBMITTED. The seller said "ZW", so the value is a fact with an author.
    const stated = await submit({ registration_country: 'ZW', location: 'Kwekwe' });
    assert.equal(stated.status, 201);
    const statedRow = persistedVehicle();
    assert.equal(statedRow.registration_country, 'ZW', 'a stated country is stored verbatim');
    assert.equal(statedRow.registration_country_source, 'seller_declared',
      'and stamped with WHO stated it — without a source the read contract will not publish it at all');
    assert.equal(statedRow.current_seller_type_source, 'seller_declared');
    assert.deepEqual(toRegistrationClaim(statedRow).country,
      { value: 'ZW', state: FIELD_STATES.RECORDED, source: 'seller_declared' },
      'ROUND TRIP: the write path and the read contract must agree, or the storage assertion above proves nothing');

    // HALF TWO — NOT SUBMITTED. `buildVehicleListingCandidate` used to substitute 'ZW' here, and
    // 13 of 16 staging rows carry the country that produced. `vehicles.registration_country` is
    // NULLABLE, so the column CAN record "not known" and the honest write is NULL.
    reset();
    const unstated = await submit({ location: 'Kwekwe' });
    assert.equal(unstated.status, 201, 'an unstated registration country is not a reason to refuse the listing');
    const unstatedRow = persistedVehicle();
    // THE KEY MUST BE PRESENT AND NULL, NOT ABSENT. `registration_country` carries a column DEFAULT
    // of 'ZW', so an insert that omits it gets 'ZW' from PostgreSQL — the identical fabrication,
    // moved from the application into the schema where it is far harder to see. Asserting the value
    // alone would not catch that, because the mock store records the payload rather than the
    // default; asserting the key's presence is what holds the explicit NULL in place.
    assert.equal('registration_country' in unstatedRow, true,
      'the column must be written explicitly as null — omitting the key lets the DB DEFAULT ZW fill it back in');
    assert.equal(unstatedRow.registration_country, null, 'nobody stated a registration country, so none is stored');
    assert.equal(unstatedRow.registration_country_source, null, 'and there is no author to stamp on a value that does not exist');
    assert.deepEqual(toRegistrationClaim(unstatedRow).country,
      { value: null, state: FIELD_STATES.NOT_RECORDED, source: null },
      'the read contract publishes nothing, and says so in a state a consumer can branch on');

    // FOUR SEPARATE FACTS, AND THIS SUBMISSION MAKES THE POINT: the seller stated where the car IS
    // (Kwekwe) and said nothing about where it is REGISTERED. Back-filling one from the other would
    // re-create the substitution with an extra step, so neither the registration country nor the
    // listing country may be manufactured from the city that was stated.
    assert.equal(unstatedRow.listing_city, 'Kwekwe', 'the location the seller DID state is recorded');
    assert.equal(unstatedRow.listing_country, null,
      'a stated city is not a stated country — location geography is not invented from a city either');
    assert.equal(unstatedRow.import_source, null,
      'and import origin is a fourth, separate fact: an unstated one stays unstated rather than becoming "Local"');
  });

  it('a dealer submission is stamped dealer_declared, not seller_declared', async () => {
    callerRole = 'dealer';
    const { status, body } = await submit(
      { location: 'Harare', registration_country: 'ZW' },
      { userId: DEALER_ID, tenantId: REAL_TENANT_ID },
    );
    assert.equal(status, 201, JSON.stringify(body));
    const row = persistedVehicle();
    assert.equal(row.listing_location_source, 'dealer_declared');
    assert.equal(row.registration_country_source, 'dealer_declared');
    assert.equal(row.current_seller_type_source, 'dealer_declared');
    // A source records WHO said it, never how much we believe it — strength of evidence is the
    // Trust contract's business and is not restated by the provenance vocabulary.
    assert.ok(CLAIM_SOURCES.includes(row.listing_location_source));
  });

  // -- the unapplied migration degrades honestly, and a real violation still surfaces -------------

  /** The three shapes PostgREST/PostgreSQL use to say "that column is not on the table". */
  const MISSING_COLUMN_ERRORS = [
    { code: 'PGRST204', message: "Could not find the 'listing_city' column of 'vehicles' in the schema cache" },
    { code: '42703', message: 'column "listing_location_source" of relation "vehicles" does not exist' },
    // No code at all — the name-based fallback, which is the only one that can be got wrong.
    { message: "Could not find the 'listing_province' column of 'vehicles' in the schema cache" },
  ];

  for (const error of MISSING_COLUMN_ERRORS) {
    it(`the migration-not-applied path degrades honestly instead of 500-ing (${error.code ?? 'no code'})`, async () => {
      // 20260818110000 is authored but UNAPPLIED. Without this retry, adding the claim columns to
      // the payload would 500 every listing submission on production until it lands.
      vehicleInsertFailure = (row) => ('listing_city' in row || 'current_seller_type_source' in row ? error : null);
      const { status, body } = await submit({ location: 'Bulawayo' });

      assert.equal(status, 201, `a listing must still be created, got ${status}: ${JSON.stringify(body)}`);
      // HONESTLY, not silently: accepting a location and then dropping it without saying so is the
      // exact defect this phase closes, so the degraded path must confess in the response.
      assert.equal(body.location_recorded, false);
      assert.equal(body.location_visibility, null);

      assert.equal(vehicleInsertAttempts.length, 2, 'one attempt with the claim columns, one without');
      assert.equal('listing_city' in vehicleInsertAttempts[0], true);
      for (const column of LISTING_CLAIM_COLUMNS) {
        assert.equal(column in vehicleInsertAttempts[1], false,
          `the retry must name no claim column at all, ${column} survived`);
      }
      // A single-row PostgREST insert is atomic, so the rejected attempt wrote nothing and the
      // retry must not have produced a second listing.
      const row = persistedVehicle();
      assert.equal(row.vin, WRITE_VIN);
      assert.equal(row.mileage, 42000, 'the rest of the listing is unaffected by the degraded path');
    });
  }

  it('a real CHECK violation surfaces as an error instead of being misread as an old schema', async () => {
    // The trap: the migration's constraint names EMBED the claim column names
    // (`vehicles_listing_location_source_vocabulary`), so a name-only "is this column missing?"
    // test would read a vocabulary violation as "the migration has not landed", drop the location
    // and report success — hiding a bug in server.js behind the unapplied migration indefinitely.
    const violations = [
      {
        code: '23514',
        message: 'new row for relation "vehicles" violates check constraint "vehicles_listing_location_source_vocabulary"',
        details: 'Failing row contains (1HGBH41JXMN109186, Bulawayo, seller_declared).',
      },
      {
        code: '23514',
        message: 'new row for relation "vehicles" violates check constraint "vehicles_listing_location_requires_source"',
        details: null,
      },
      { code: '23502', message: 'null value in column "mileage" of relation "vehicles" violates not-null constraint' },
    ];

    for (const violation of violations) {
      reset();
      vehicleInsertFailure = () => violation;
      const { status, body } = await submit({ location: 'Bulawayo' });

      assert.notEqual(status, 201, `a rejected write must never report success (${violation.code})`);
      assert.equal(status, 500, `${violation.code} must surface as an error, got ${status}`);
      assert.match(body.error, /violates/i, 'the real database complaint must reach the caller, not a substitute');
      assert.equal(vehicleInsertAttempts.length, 1,
        'a constraint violation must NOT trigger the missing-column retry — retrying would swallow it');
      assert.equal(store.vehicles.length, 0, 'and no listing may exist after a refused insert');
    }
  });

  it('ANTI-VACUITY: the two paths are told apart by the error, not by luck — the same submission gives 201 and 500', async () => {
    // Both cases below submit an identical body and fail the identical first insert. Only the shape
    // of the error differs, which is the whole of what the guard is allowed to key on.
    vehicleInsertFailure = (row, attempt) => (attempt === 1
      ? { code: 'PGRST204', message: "Could not find the 'listing_city' column of 'vehicles' in the schema cache" }
      : null);
    const degraded = await submit({ location: 'Bulawayo' });

    reset();
    vehicleInsertFailure = () => ({
      code: '23514',
      message: 'new row for relation "vehicles" violates check constraint "vehicles_listing_city_vocabulary"',
    });
    const refused = await submit({ location: 'Bulawayo' });

    assert.equal(degraded.status, 201);
    assert.equal(refused.status, 500);
  });
});

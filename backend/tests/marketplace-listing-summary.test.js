import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketplaceListingSummary,
  deriveConditionCategory,
  deriveMarketplaceTags,
  fetchListingRelatedRows,
  summarizeEvidence,
  summarizePartSentry,
  filterVisibleVehicles,
  shouldShowFixtures
} from '../services/marketplace/listingSummaryService.js';
import { FIELD_STATES, isFieldState } from '../utils/publicVehicleProjection.js';

test('derives canonical vehicle condition categories without inventing unsupported states', () => {
  assert.equal(deriveConditionCategory({ vehicle_condition_category: 'brand_new' }), 'brand_new');
  assert.equal(deriveConditionCategory({ condition: 'Certified Pre-Owned' }), 'certified_dealer');
  assert.equal(deriveConditionCategory({ import_source: 'Japan' }), 'recently_imported');
  assert.equal(deriveConditionCategory({ condition: 'unknown label' }), 'unknown');
});

// ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────────────────
// WAS: a single line inside the test above —
//   `assert.equal(deriveConditionCategory({ registration_country: 'ZW' }), 'locally_used')`
//
// WHY THE OLD ASSERTION ENCODED A FABRICATION. It pinned an inference drawn from a BARE COLUMN.
// `vehicles.registration_country` carries a DB DEFAULT of 'ZW' and, until this phase, the write
// path substituted 'ZW' for every submission that omitted it — so 13 of 16 staging rows hold a
// country nobody stated. This branch turned that substitute into a flat `condition_category` on
// every card AND into a human sentence on the detail page ("2019 Toyota Hilux — locally used"):
// one invented value laundered into a second one that no longer even looks like a column. The
// assertion could not tell a stated country from a default, because at that point neither could
// the code.
//
// THE CORRECTED GUARANTEE, IN TWO HALVES THAT MUST BOTH HOLD. The inference is now GATED ON
// PROVENANCE (`toRegistrationClaim`), so it fires only for a country somebody actually asserted.
// Half one proves the bare column no longer infers anything; half two proves the inference was
// GATED AND NOT DELETED — a rewrite that simply removed the branch would pass half one alone, and
// would quietly cost every honestly-registered vehicle its category.
test('locally_used is inferred only from a PROVENANCED registration country, never from the bare column', () => {
  // HALF ONE — the unprovenanced column, which is what a fabricated DB default looks like.
  assert.equal(deriveConditionCategory({ registration_country: 'ZW' }), 'unknown',
    'a country with no author is not a statement about where this car is registered, so it supports no inference');
  assert.equal(deriveConditionCategory({ registration_country: 'ZW', registration_country_source: null }), 'unknown');
  assert.equal(deriveConditionCategory({ registration_country: 'ZW', registration_country_source: 'assumed' }), 'unknown',
    'an out-of-vocabulary source is not provenance; only the declared CLAIM_SOURCES vocabulary counts');

  // HALF TWO — the same country, asserted by a real source. The inference is intact.
  assert.equal(deriveConditionCategory({ registration_country: 'ZW', registration_country_source: 'seller_declared' }),
    'locally_used', 'a country the seller stated DOES support the inference — the gate is provenance, not deletion');
  assert.equal(deriveConditionCategory({ registration_country: 'Zimbabwe', registration_country_source: 'registry_verified' }),
    'locally_used');

  // FOUR SEPARATE FACTS: location, registration geography, condition category, import origin.
  // Each pair below would collapse two of them, and each must stay 'unknown' / stay put.
  assert.equal(
    deriveConditionCategory({ listing_city: 'Harare', listing_country: 'ZW', listing_location_source: 'seller_declared' }),
    'unknown',
    'WHERE THE CAR IS is not WHERE IT IS REGISTERED; a listing location must never stand in for registration geography',
  );
  assert.equal(
    deriveConditionCategory({ import_source: 'Japan', registration_country: 'ZW', registration_country_source: 'seller_declared' }),
    'recently_imported',
    'import origin is its own fact and outranks registration geography here; neither is re-derived from the other',
  );
  assert.equal(deriveConditionCategory({ registration_country_source: 'seller_declared' }), 'unknown',
    'provenance without a value is not a value — a source alone must not conjure a country');
});

test('counts only verified public evidence for marketplace cards', () => {
  const summary = summarizeEvidence([
    { verification_status: 'verified', visibility_level: 'public_safe' },
    { verification_status: 'verified', visibility_level: 'private' },
    { verification_status: 'rejected', visibility_level: 'public_safe' },
  ]);

  assert.equal(summary.evidence_count, 1);
});

test('requires explicit public PartSentry eligibility before showing card signals', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      public_card_eligible: false,
    },
    {
      action_type: 'Inspected',
      timestamp: new Date().toISOString(),
      verification_status: 'unverified',
      part_verification_status: 'unverified',
      public_card_eligible: true,
    },
  ]);

  assert.equal(summary.partsentry_checked, false);
  assert.equal(summary.verified_parts_count, 0);
  assert.equal(summary.repair_history_count, 1);
  assert.equal(summary.recent_service, true);
});

test('missing PartSentry approval provenance fails closed as review_required', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      public_card_eligible: true,
      suspicion_status: 'none',
      approval_provenance_available: false,
    },
  ]);

  assert.equal(summary.partsentry_checked, false);
  assert.equal(summary.verified_parts_count, 0);
  assert.equal(summary.repair_history_count, 0);
  assert.equal(summary.recent_service, false);
  assert.equal(summary.public_status, 'review_required');
});

test('suspicious PartSentry rows remain suppressed even when approval provenance is unavailable', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      public_card_eligible: true,
      suspicion_status: 'flagged',
      approval_provenance_available: false,
    },
  ]);

  assert.equal(summary.suppressed, true);
  assert.equal(summary.public_status, 'suppressed');
  assert.equal(summary.partsentry_checked, false);
});

test('fetchListingRelatedRows retries legacy PartSentry projection when approved_by is unavailable', async () => {
  const vin = '1HGBH41JXMN109186';
  const calls = [];
  const client = {
    from(table) {
      if (table !== 'partsentry_logs') {
        const builder = {
          select() {
            return builder;
          },
          in() {
            return builder;
          },
          order() {
            return builder;
          },
          then(onFulfilled, onRejected) {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      }

      return {
        select(columns) {
          calls.push(columns);
          return {
            in() {
              return {
                order() {
                  if (columns.includes('approved_by')) {
                    return Promise.resolve({ data: null, error: { message: 'column partsentry_logs.approved_by does not exist' } });
                  }
                  return Promise.resolve({
                    data: [{
                      vin,
                      action_type: 'Replaced',
                      timestamp: new Date().toISOString(),
                      verification_status: 'verified',
                      part_verification_status: 'verified',
                      public_card_eligible: true,
                      suspicion_status: 'none',
                      mechanic_id: 'mech-1',
                    }],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  const { partSentryByVin } = await fetchListingRelatedRows(client, [vin]);
  const rows = partSentryByVin.get(vin) || [];
  assert.equal(calls.length, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].approval_provenance_available, false);

  const summary = summarizePartSentry(rows);
  assert.equal(summary.partsentry_checked, false);
  assert.equal(summary.public_status, 'review_required');
});

test('builds a public-safe listing summary without owner PII or fake passport claims', () => {
  const summary = buildMarketplaceListingSummary({
    vehicle: {
      vin: 'VIN123',
      make: 'Toyota',
      model: 'Hilux',
      year: 2023,
      mileage: 19000,
      price: 42000,
      currency: 'USD',
      status: 'Available',
      trust_score: 91,
      condition: 'Used',
      duty_paid: true,
      police_verified: true,
      current_seller_type: 'Private Owner',
      // ── FIXTURE CHANGED DELIBERATELY, Issue #164 Phase 4 ────────────────────────────────────
      // `current_seller_type` used to stand alone here, and the assertion below then read as
      // "a bare column publishes a seller type". That is the fabrication the phase closed:
      // 'Private Owner' is this column's DB DEFAULT and it sits on 13 of 16 staging rows, so an
      // ungated read published "private sale" on the strength of the DDL. Provenance is added to
      // the fixture rather than the assertion being inverted, because THIS test is where the
      // RECORDED path has to be exercised — see the note on the assertion below.
      current_seller_type_source: 'seller_declared',
      sellerName: 'Private Person',
      sellerPhone: '+263772000000',
      passport_verified: false,
    },
    evidenceRows: [
      { verification_status: 'verified', visibility_level: 'public_safe' },
    ],
    partSentryRows: [
      {
        action_type: 'Replaced',
        timestamp: new Date().toISOString(),
        verification_status: 'verified',
        part_verification_status: 'verified',
        public_card_eligible: true,
      },
    ],
    ownershipCount: 1,
  });

  // ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 — RECORDED PATH, chosen on purpose ───────────
  // WAS: this same line, over a fixture that carried `current_seller_type` with NO `*_source`. It
  // therefore asserted that an UNPROVENANCED column publishes a seller type — and 'Private Owner'
  // is that column's DB DEFAULT, present on 13 of 16 staging rows. The card said "private sale"
  // because the DDL did.
  //
  // TWO REPAIRS WERE AVAILABLE and the choice is deliberate: (i) invert this to assert
  // null/not_recorded, or (ii) record provenance on the fixture and keep the positive assertion.
  // (ii) IS CHOSEN HERE, and (i) is taken in 'derives marketplace tags only from backed summary
  // fields' below, so both paths stay covered and neither can rot unobserved. Three reasons this
  // test is the one that must hold the RECORDED path:
  //   · It is the only test that runs the whole `buildMarketplaceListingSummary` seller pipeline
  //     end to end — claim -> `recordedSellerType` -> flat field -> `private_sale` tag. Inverting
  //     it would leave that chain proved nowhere, and a `recordedSellerType` that returned null
  //     unconditionally would pass a suite made entirely of absence assertions.
  //   · :284 below (`marketplace_tags` includes 'private_sale') already depends on this value, so
  //     (i) would have cascaded into inverting a second assertion and testing absence twice.
  //   · This test also carries the PII guarantees — see the execution note at the end of it.
  assert.equal(summary.seller_type, 'private',
    'a seller type the seller themself declared IS publishable; the gate this phase added is provenance, not silence');
  assert.equal(summary.seller_type_state, FIELD_STATES.RECORDED,
    'and the flat field agrees with the governed claim rather than answering the same question twice');
  assert.equal(summary.claims.seller.seller_type.value, 'Private Owner',
    'the claim publishes what the row holds, verbatim; the card publishes its dealer/private collapse of it');

  // ── REWRITTEN DELIBERATELY, Issue #164 Phase 4 ──────────────────────────────────────────────
  // This line used to read `assert.equal(summary.seller_display_label, 'Private seller')`, and it
  // was pinning a FABRICATION. The fixture above links no seller row, joins no tenant and leaves
  // `public_seller_display_enabled` unset, so nobody ever published a name for this listing —
  // 'Private seller' was a category word the read path invented to fill the empty space. That is
  // the same defect as the 'Verified dealer' label the phase removed, only in a smaller font
  // (publicVehicleProjection.js, Rule 3: "NO GENERIC SELLER LABEL"). Keeping the old assertion
  // would have made this suite the thing holding the fabrication in place.
  //
  // What replaces it is the GUARANTEE rather than today's particular output. The exact
  // non-recorded state an unnamed seller lands in is being settled separately (a withholding was
  // being fabricated for sellers who have no name to withhold), so pinning one member here would
  // just re-encode a passing accident. Three things must hold on every correct path:
  assert.equal(
    summary.seller_display_label, null,
    'a seller who published no name has no name to show; a category label filling the gap is a fabricated fact',
  );
  const displayLabelState = summary.seller_display_label_state;
  assert.ok(
    isFieldState(displayLabelState),
    `seller_display_label_state must be a FIELD_STATES member so a consumer can branch on it, got ${JSON.stringify(displayLabelState)}`,
  );
  assert.notEqual(
    displayLabelState, FIELD_STATES.RECORDED,
    'nothing was recorded, so nothing may be reported as recorded',
  );
  // Rule 2, "nothing recorded => nothing to withhold": there is no seller link and no published
  // name behind this listing, so there is no fact for a withholding to be protecting. `withheld`
  // here would be a fabricated withholding — the same invention as the old label, pointed the
  // other way, and it would tell a shopper a name exists that never did.
  assert.notEqual(
    displayLabelState, FIELD_STATES.WITHHELD,
    'a withholding with nothing behind it implies a name exists; unknown must stay unknown in both directions',
  );

  assert.equal(summary.passport_verified, false);
  assert.equal(summary.evidence_count, 1);
  assert.equal(summary.partsentry_checked, true);
  assert.equal(summary.verified_parts_count, 1);
  assert.ok(summary.marketplace_tags.includes('private_sale'));
  assert.ok(summary.marketplace_tags.includes('evidence_available'));
  assert.ok(summary.marketplace_tags.includes('partsentry_checked'));
  assert.equal(summary.marketplace_tags.includes('passport_verified'), false);
  // ── WHY THE FIRST ASSERTION IN THIS TEST MUST NOT BE LEFT RED ───────────────────────────────
  // Everything from the seller-type assertion down to this line is UNREACHABLE while that
  // assertion throws — measured: 1 of 14 assert calls executed, 13 skipped. Two of the skipped
  // ones are load-bearing and nothing else in the backend suite covers them:
  //   · the PII guard immediately below (`sellerPhone` must not survive into a public summary);
  //   · `summary.seller_display_label` above, which is the ONLY assertion anywhere in this suite
  //     on that field, and therefore the only thing standing between the read path and a restored
  //     generic "|| 'Private seller'" label.
  // A red test here is not bookkeeping that can wait for the next pass. It is a privacy guard and
  // a fabrication guard, both switched off, in a suite that still reports the file as "one
  // failure". That is why the repair above records provenance rather than deleting the assertion.
  assert.equal('sellerPhone' in summary, false);
});

// ── ADDED, Issue #164 Phase 4 enforceability pass ─────────────────────────────────────────────
// NOTHING IN THIS SUITE HELD THE DEFECT THAT NAMED THE PHASE SHUT. `buildMarketplaceListingSummary`
// carried a literal `location: 'Zimbabwe'` on every marketplace card, and no assertion anywhere
// read `summary.location` — so restoring the literal left the whole suite green. That is a closure
// nothing can hold: a description of today's tree rather than a guarantee about tomorrow's. The
// four cases below fail the moment a country literal, a fallback, or a cross-fact derivation is
// reintroduced.
test('the card location is the recorded location or nothing — never a country literal', () => {
  const base = { vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2023, price: 42000, status: 'Available' };

  // 1. NOTHING RECORDED. The row has no location columns (they do not exist on `public.vehicles`
  //    until migration 20260818110000 is applied), so the card must say nothing and must say WHY
  //    in a state a consumer can branch on. `'Zimbabwe'` here was the original defect.
  const unrecorded = buildMarketplaceListingSummary({ vehicle: { ...base } });
  assert.equal(unrecorded.location, null,
    'a listing whose location was never recorded has no location to print; a country literal is a fabricated fact on every card');
  assert.equal(unrecorded.location_state, FIELD_STATES.NOT_RECORDED);

  // 2. RECORDED AND PUBLIC. Proves case 1 measures the removed literal rather than a dead field —
  //    without this, deleting the location line entirely would also pass.
  const recorded = buildMarketplaceListingSummary({
    vehicle: {
      ...base,
      listing_city: 'Bulawayo', listing_province: 'Bulawayo Province', listing_country: 'ZW',
      listing_location_source: 'seller_declared', listing_location_visibility: 'public',
    },
  });
  assert.equal(recorded.location, 'Bulawayo, Bulawayo Province, ZW');
  assert.equal(recorded.location_state, FIELD_STATES.RECORDED);

  // 3. PARTIALLY RECORDED. A known city with an unknown country reads as the city and stops. No
  //    country is completed from anywhere — completing it is exactly how 'Zimbabwe' got printed.
  const partial = buildMarketplaceListingSummary({
    vehicle: { ...base, listing_city: 'Harare', listing_location_source: 'seller_declared', listing_location_visibility: 'public' },
  });
  assert.equal(partial.location, 'Harare');
  assert.equal(partial.location_state, FIELD_STATES.RECORDED);

  // 4. FOUR SEPARATE FACTS. A car REGISTERED in ZW, IMPORTED from Japan, of a known condition
  //    category, whose LOCATION nobody recorded. Three facts are present and the fourth is still
  //    unknown; any of them leaking into the location line would re-create the country literal by
  //    another route.
  const registeredNotLocated = buildMarketplaceListingSummary({
    vehicle: {
      ...base,
      registration_country: 'ZW', registration_country_source: 'seller_declared',
      import_source: 'Japan', vehicle_condition_category: 'recently_imported',
    },
  });
  assert.equal(registeredNotLocated.location, null,
    'where a car is REGISTERED is not where it IS; deriving one from the other is the substitution wearing a different column');
  assert.equal(registeredNotLocated.location_state, FIELD_STATES.NOT_RECORDED);
  assert.equal(registeredNotLocated.condition_category, 'recently_imported',
    'and the other three facts are unaffected — separating them must not cost any of them');
});

test('a withheld location is reported as withheld, not as absent', () => {
  // `withheld` and `not_recorded` must stay distinguishable, or absence starts reading as proof:
  // a shopper cannot tell "we hold nothing" from "you may not see it" if both render identically.
  const summary = buildMarketplaceListingSummary({
    vehicle: {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2023, price: 42000, status: 'Available',
      listing_city: 'Mutare', listing_location_source: 'seller_declared', listing_location_visibility: 'withheld',
    },
  });
  assert.equal(summary.location, null, 'a withheld value is not printed');
  assert.equal(summary.location_state, FIELD_STATES.WITHHELD, 'but the fact that something is being withheld is itself published');
});

test('does not infer one-owner status from missing ownership history', () => {
  const tags = deriveMarketplaceTags(
    { mileage: 60000, current_seller_type: 'Private Owner' },
    { evidence_count: 0 },
    { partsentry_checked: false, repair_history_count: 0, verified_parts_count: 0, recent_service: false },
    0
  );

  assert.equal(tags.includes('one_owner'), false);
});

test('derives marketplace tags only from backed summary fields', () => {
  const dealerRow = {
    mileage: 32000,
    duty_paid: true,
    police_verified: true,
    passport_verified: true,
    plate_verified_at: '2026-06-01T00:00:00Z',
    zimra_verified: true,
    safe_pay_ready: true,
    inspection_ready: true,
    // NOTE: no `current_seller_type_source`. That absence is the subject of the assertions below,
    // not an oversight — see the rewrite note.
    current_seller_type: 'Dealership',
    public_seller_display_enabled: true,
    tenant: { name: 'Harare Motors' },
    vehicle_condition_category: 'recently_imported',
  };
  const tags = deriveMarketplaceTags(
    dealerRow,
    { evidence_count: 2 },
    {
      partsentry_checked: true,
      repair_history_count: 2,
      verified_parts_count: 1,
      recent_service: true,
    },
    1
  );

  for (const tag of [
    'passport_verified',
    'plate_verified',
    'evidence_available',
    'duty_cleared',
    'zimra_verified',
    'cid_clear',
    'low_mileage',
    'fresh_import',
    'one_owner',
    // 'dealer_verified' WAS THIS LIST'S TENTH ENTRY, AND IT ENCODED A FABRICATION.
    // The row above states `current_seller_type: 'Dealership'` and names no author for it. Under
    // the old rule the tag fired anyway — in fact the rule it replaced was
    // `sellerType.includes('dealer') || Boolean(tenantName)`, so the joined `tenant` on this very
    // fixture would have produced the badge even with the seller type removed. A tenant link means
    // an organisation exists on the row; it is not a statement that THIS car is a dealer sale, and
    // `current_seller_type` is a DEFAULT-filled column on 13 of 16 staging rows. The badge printed
    // "dealer" while `claims.seller.seller_type` in the same body reported `not_recorded`.
    // Membership of this list therefore moved to the two assertions after the loop: one for the
    // ABSENCE path (this row) and one for the RECORDED path (the same row, attested). The tag is
    // gone from the list because it must NOT be present here — not because it stopped mattering.
    'safe_pay_ready',
    'inspection_ready',
    'recent_service',
    'partsentry_checked',
    'repair_history_available',
    'verified_parts',
  ]) {
    assert.ok(tags.includes(tag), `${tag} should be present`);
  }

  // ── THE ABSENCE PATH (repair (i), chosen for this test) ──────────────────────────────────────
  // Every OTHER tag above is backed by a column the application writes and nothing defaults — that
  // is what "backed summary fields" in this test's name has always meant. The seller-type tags were
  // the one pair that failed it. With no author for the seller type, a listing earns NEITHER badge:
  // not the dealer one it used to get for free, and not `private_sale` as a consolation fall-through.
  assert.equal(tags.includes('dealer_verified'), false,
    'a seller type nobody asserted cannot print a dealer badge — the DDL is not a seller');
  assert.equal(tags.includes('private_sale'), false,
    'and it must not fall through to the other badge either; an unknown seller type earns silence, not the opposite label');

  // ── THE RECORDED PATH, so repair (i) above is a gate and not a deletion ─────────────────────
  // Same row, now attested. Without this, deleting the `dealer_verified` branch from
  // deriveMarketplaceTags outright would satisfy every assertion above and would silently cost
  // every genuine dealership its badge.
  const attestedTags = deriveMarketplaceTags(
    { ...dealerRow, current_seller_type_source: 'dealer_declared' },
    { evidence_count: 2 },
    { partsentry_checked: true, repair_history_count: 2, verified_parts_count: 1, recent_service: true },
    1
  );
  assert.equal(attestedTags.includes('dealer_verified'), true,
    'a dealer who declared themselves a dealer still gets the badge — the gate is provenance, not the vocabulary');
  assert.equal(attestedTags.includes('private_sale'), false,
    'and exactly one of the two seller-type tags may ever fire');
});

// --- Read-time fixture visibility control (Option A) ---

const FIXTURE_VEHICLES = [
  { vin: 'VIN_REF_776997', status: 'Available', owner_id: 'u3', tenant_id: '00000000-0000-0000-0000-000000000001', make: 'Ford', import_source: 'local', registration_country: 'ZW' },
  { vin: 'VIN_INT_081059', status: 'Available', make: 'BMW' },
];
const REAL_VEHICLE = { vin: '1HGBH41JXMN109186', status: 'Available', owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: 'b2c3d4e5-1111-2222-3333-444455556666', make: 'Toyota', import_source: 'local', registration_country: 'ZW' };

test('hides fixtures from public listings when MARKETPLACE_SHOW_FIXTURES is off (default)', () => {
  const visible = filterVisibleVehicles([...FIXTURE_VEHICLES, REAL_VEHICLE], { showFixtures: false });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].vin, '1HGBH41JXMN109186');
});

test('includes fixtures only when MARKETPLACE_SHOW_FIXTURES is enabled', () => {
  const visible = filterVisibleVehicles([...FIXTURE_VEHICLES, REAL_VEHICLE], { showFixtures: true });
  assert.equal(visible.length, 3); // 2 fixtures + 1 real, all public
});

test('a real-looking valid row is still returned; non-public is removed regardless of flag', () => {
  const sold = { ...REAL_VEHICLE, vin: '1HGBH41JXMN100001', status: 'Sold' };
  const visible = filterVisibleVehicles([REAL_VEHICLE, sold], { showFixtures: false });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].status, 'Available');
});

test('shouldShowFixtures parses the env flag and defaults to hidden', () => {
  assert.equal(shouldShowFixtures({}), false);
  assert.equal(shouldShowFixtures({ MARKETPLACE_SHOW_FIXTURES: 'false' }), false);
  assert.equal(shouldShowFixtures({ MARKETPLACE_SHOW_FIXTURES: 'true' }), true);
  assert.equal(shouldShowFixtures({ MARKETPLACE_SHOW_FIXTURES: '1' }), true);
});

test('owner_id and tenant_id are never exposed in the public summary (even though selected for filtering)', () => {
  const summary = buildMarketplaceListingSummary({
    vehicle: { vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Hilux', year: 2023, price: 42000, status: 'Available', owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: 'b2c3d4e5-1111-2222-3333-444455556666' },
  });
  assert.equal('owner_id' in summary, false);
  assert.equal('tenant_id' in summary, false);
});

test('fixture filtering preserves surviving rows intact so existing filters still apply', () => {
  const visible = filterVisibleVehicles([FIXTURE_VEHICLES[0], REAL_VEHICLE], { showFixtures: false });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].make, 'Toyota'); // make/q/category filters downstream still have the data
  assert.equal(visible[0].registration_country, 'ZW');
});

test('empty / all-fixture input returns an empty list cleanly (no error)', () => {
  assert.deepEqual(filterVisibleVehicles([], { showFixtures: false }), []);
  assert.deepEqual(filterVisibleVehicles(undefined, { showFixtures: false }), []);
  assert.equal(filterVisibleVehicles(FIXTURE_VEHICLES, { showFixtures: false }).length, 0);
});

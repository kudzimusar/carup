/**
 * CarUp Intelligence 1.0 — I6 Listing Completeness (LC1) and Lost Opportunity (LO1).
 *
 * The gate for this phase is that completeness must never masquerade as Trust,
 * and that no group is scored from a field CarUp does not have. These tests pin
 * both, plus the rule that makes Lost Opportunity honest: a seller is only told
 * they missed a search they would otherwise have matched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  computeListingCompleteness,
  computeLostOpportunity,
  listingSatisfiesOtherFilters,
  nextBestActions,
  computeMediaFacts,
  fieldPresent,
  completenessGroups,
  NOT_MEASURABLE_GROUPS,
  TOTAL_WEIGHT,
  COMPLETENESS_VERSION,
  LOST_OPPORTUNITY_VERSION,
  LOST_OPPORTUNITY_NOT_YET_MEASURABLE,
} from '../services/intelligence/listingCompletenessService.js';

const completeVehicle = {
  vin: 'VIN1', make: 'Toyota', model: 'Hilux', year: 2021,
  price: 18000, currency: 'USD',
  mileage: 64000, transmission: 'automatic', fuel_type: 'diesel',
  vehicle_condition_category: 'locally_used',
  listing_city: 'Harare', listing_country: 'Zimbabwe',
  current_seller_type: 'private',
  safe_pay_ready: true, inspection_ready: false, publication_status: 'published',
};

const fullMedia = [
  { image_url: 'a', is_primary: true }, { image_url: 'b' }, { image_url: 'c' }, { image_url: 'd' },
];

// ── Field presence ──────────────────────────────────────────────────────────

test('an empty string is absent, and zero is present', () => {
  assert.equal(fieldPresent(''), false);
  assert.equal(fieldPresent('   '), false);
  assert.equal(fieldPresent(null), false);
  assert.equal(fieldPresent(undefined), false);
  // A price of 0 or a mileage of 0 is a real, recorded value.
  assert.equal(fieldPresent(0), true);
  assert.equal(fieldPresent('Toyota'), true);
  assert.equal(fieldPresent([]), false);
});

// ── Completeness is not Trust ───────────────────────────────────────────────

test('trust NEVER contributes to the completeness percentage', () => {
  const withoutTrust = computeListingCompleteness({
    vehicle: completeVehicle, imageRows: fullMedia, evidenceCount: 1, serviceCount: 1, trust: null,
  });
  const withHighTrust = computeListingCompleteness({
    vehicle: completeVehicle, imageRows: fullMedia, evidenceCount: 1, serviceCount: 1,
    trust: { state: 'evaluated', band: 'high', score: 92 },
  });
  assert.equal(withoutTrust.percent, withHighTrust.percent,
    'a trusted listing and an unevaluated one with identical information score identically');
});

test('an unevaluated listing reports not_evaluated, never 0 or "poor"', () => {
  const result = computeListingCompleteness({ vehicle: completeVehicle, trust: null });
  assert.equal(result.displayed_separately.trust.state, 'not_evaluated');
  assert.equal(result.displayed_separately.trust.score, null);
  assert.notEqual(result.displayed_separately.trust.score, 0);
});

test('trust and transaction readiness live outside the score block entirely', () => {
  const result = computeListingCompleteness({ vehicle: completeVehicle, imageRows: fullMedia });
  const scoredKeys = result.groups.map((g) => g.key);
  assert.ok(!scoredKeys.includes('trust'));
  assert.ok(!scoredKeys.includes('transaction_readiness'));
  assert.ok(result.displayed_separately.trust);
  assert.ok(result.displayed_separately.transaction_readiness);
});

// ── Every group maps to a field that exists ─────────────────────────────────

test('the three plan groups CarUp cannot measure are declared, not silently dropped', () => {
  const result = computeListingCompleteness({ vehicle: completeVehicle });
  const keys = result.not_measurable.map((g) => g.key).sort();
  assert.deepEqual(keys, ['description', 'exterior_media_coverage', 'interior_media_coverage']);
  // `vehicles` genuinely has no description column, so scoring one would be fabrication.
  assert.equal(result.not_measurable.find((g) => g.key === 'description').reason, 'no_description_field');
  for (const group of NOT_MEASURABLE_GROUPS) {
    assert.ok(group.detail && group.detail.length > 10, 'each unmeasurable group must explain itself');
  }
});

test('no scored group references a column that does not exist on vehicles', () => {
  // Columns verified against the live staging schema for `vehicles`.
  const REAL_COLUMNS = new Set([
    'vin', 'make', 'model', 'generation', 'trim', 'year', 'color', 'mileage', 'fuel_type',
    'drivetrain', 'transmission', 'import_source', 'duty_paid', 'police_verified', 'status',
    'trust_score', 'price', 'currency', 'created_at', 'tenant_id', 'owner_id', 'plate_number',
    'chassis_number', 'engine_number', 'vehicle_condition_category', 'publication_status',
    'listing_city', 'listing_province', 'listing_country', 'current_seller_type',
    'safe_pay_ready', 'inspection_ready',
  ]);
  for (const group of completenessGroups()) {
    for (const field of [...(group.fields || []), ...(group.optionalFields || [])]) {
      assert.ok(REAL_COLUMNS.has(field), `${group.key} scores "${field}", which is not a real vehicles column`);
    }
  }
});

test('the score publishes its own denominator so 100% cannot overstate', () => {
  const result = computeListingCompleteness({
    vehicle: completeVehicle, imageRows: fullMedia, evidenceCount: 1, serviceCount: 1,
  });
  assert.equal(result.percent, 100);
  assert.equal(result.total_points, TOTAL_WEIGHT);
  assert.ok(result.not_measurable.length > 0,
    'a 100% listing still shows what was not assessed');
});

// ── Scoring behaviour ───────────────────────────────────────────────────────

test('an empty listing scores 0 with every group explained', () => {
  const result = computeListingCompleteness({ vehicle: {}, imageRows: [] });
  assert.equal(result.percent, 0);
  for (const group of result.groups) {
    assert.equal(group.complete, false);
    assert.ok(group.guidance, `${group.key} must tell the seller what to do`);
  }
});

test('a partially filled group earns proportional credit, not all-or-nothing', () => {
  const partial = computeListingCompleteness({
    vehicle: { ...completeVehicle, transmission: null, fuel_type: null },
    imageRows: fullMedia, evidenceCount: 1, serviceCount: 1,
  });
  const specs = partial.groups.find((g) => g.key === 'specifications');
  assert.ok(specs.earned > 0, 'mileage alone still earns something');
  assert.ok(specs.earned < specs.weight);
  assert.deepEqual(specs.missing_fields, ['transmission', 'fuel_type']);
});

test('every point maps to a named missing field, so the score is explainable', () => {
  const result = computeListingCompleteness({ vehicle: { make: 'Toyota' }, imageRows: [] });
  const incomplete = result.groups.filter((g) => !g.complete);
  for (const group of incomplete) {
    assert.ok(group.missing_fields.length > 0, `${group.key} says it is incomplete but names nothing missing`);
  }
});

test('media scores presence, useful count and a main photo separately', () => {
  const none = computeListingCompleteness({ vehicle: completeVehicle, imageRows: [] });
  assert.deepEqual(none.groups.find((g) => g.key === 'media').missing_fields,
    ['at_least_one_photo', 'at_least_4_photos', 'main_photo']);

  const onlyOne = computeListingCompleteness({ vehicle: completeVehicle, imageRows: [{ image_url: 'a' }] });
  assert.deepEqual(onlyOne.groups.find((g) => g.key === 'media').missing_fields,
    ['at_least_4_photos', 'main_photo']);

  const full = computeListingCompleteness({ vehicle: completeVehicle, imageRows: fullMedia });
  assert.equal(full.groups.find((g) => g.key === 'media').complete, true);
});

test('a photo row with no url is not a photo', () => {
  const facts = computeMediaFacts([{ image_url: '' }, { image_url: null }, { image_url: 'real' }]);
  assert.equal(facts.image_count, 1);
  assert.equal(facts.has_primary, false);
});

test('the calculation version travels with the score', () => {
  const result = computeListingCompleteness({ vehicle: completeVehicle });
  assert.equal(result.calculation_version, COMPLETENESS_VERSION);
});

// ── Lost Opportunity honesty ────────────────────────────────────────────────

const search = (filters) => ({ metadata: { filters } });

test('a missing condition costs the condition searches the listing would have matched', () => {
  const vehicle = { ...completeVehicle, vehicle_condition_category: null };
  const result = computeLostOpportunity({
    vehicle,
    searchEvents: [
      search({ condition: 'locally_used', make: 'Toyota' }),
      search({ condition: 'recently_imported', make: 'Toyota' }),
      search({ condition: 'locally_used', make: 'Toyota', maxPrice: 20000 }),
    ],
  });
  assert.equal(result.total_missed_searches, 3);
  assert.equal(result.dimensions[0].missing_field, 'vehicle_condition_category');
  // The plan's phrasing: a statement about matching, never about lost sales.
  assert.match(result.dimensions[0].message, /could not be confidently matched/);
});

test('a search the listing would have FAILED anyway is never counted as lost', () => {
  const vehicle = { ...completeVehicle, vehicle_condition_category: null, make: 'Toyota', price: 18000 };
  const result = computeLostOpportunity({
    vehicle,
    searchEvents: [
      search({ condition: 'locally_used', make: 'Honda' }),          // wrong make
      search({ condition: 'locally_used', maxPrice: 10000 }),        // above budget
      search({ condition: 'locally_used', minPrice: 25000 }),        // below budget
    ],
  });
  assert.equal(result.total_missed_searches, 0,
    'telling a seller they lost a search they would have failed would be false');
});

test('nothing is claimed when the field is actually present', () => {
  const result = computeLostOpportunity({
    vehicle: completeVehicle,
    searchEvents: [search({ condition: 'locally_used', make: 'Toyota' })],
  });
  assert.equal(result.total_missed_searches, 0);
  assert.equal(result.dimensions.length, 0);
});

test('an unrecognised filter makes the search ineligible rather than assumed matching', () => {
  assert.equal(listingSatisfiesOtherFilters(completeVehicle, { mystery_filter: 'x' }, 'condition'), false,
    'we cannot prove a match against a filter we do not model, so we must not claim one');
});

test('price-range and make matching are evaluated correctly', () => {
  const v = { make: 'Toyota', price: 18000 };
  assert.equal(listingSatisfiesOtherFilters(v, { make: 'toyota' }, 'condition'), true, 'make is case-insensitive');
  assert.equal(listingSatisfiesOtherFilters(v, { make: 'Honda' }, 'condition'), false);
  assert.equal(listingSatisfiesOtherFilters(v, { minPrice: 15000, maxPrice: 20000 }, 'condition'), true);
  assert.equal(listingSatisfiesOtherFilters(v, { minPrice: 19000 }, 'condition'), false);
  assert.equal(listingSatisfiesOtherFilters(v, { maxPrice: 17000 }, 'condition'), false);
  // Sort and tags are not hard field matches, so they never disqualify.
  assert.equal(listingSatisfiesOtherFilters(v, { sort: 'price_asc', tag: 'trusted' }, 'condition'), true);
});

test('a listing with no price cannot claim a price-filtered search', () => {
  assert.equal(listingSatisfiesOtherFilters({ make: 'Toyota' }, { maxPrice: 20000 }, 'condition'), false);
});

test('location lost-opportunity is declared not-yet-measurable rather than omitted', () => {
  const result = computeLostOpportunity({ vehicle: completeVehicle, searchEvents: [] });
  const location = result.not_yet_measurable.find((d) => d.filter === 'location');
  assert.ok(location, 'the plan\'s flagship example must be accounted for, not quietly missing');
  assert.equal(location.reason, 'location_is_not_a_search_filter');
  assert.equal(LOST_OPPORTUNITY_NOT_YET_MEASURABLE.length, 1);
});

test('lost opportunity reports how many searches it considered', () => {
  const result = computeLostOpportunity({
    vehicle: completeVehicle,
    searchEvents: [search({ make: 'Toyota' }), search({ make: 'Honda' })],
  });
  assert.equal(result.searches_considered, 2);
  assert.equal(result.calculation_version, LOST_OPPORTUNITY_VERSION);
});

test('a malformed search event is skipped, not counted', () => {
  const vehicle = { ...completeVehicle, vehicle_condition_category: null };
  const result = computeLostOpportunity({
    vehicle,
    searchEvents: [{ metadata: null }, { metadata: { filters: null } }, {}],
  });
  assert.equal(result.total_missed_searches, 0);
});

// ── Next best action ordering ───────────────────────────────────────────────

test('observed missed searches outrank generic completeness advice', () => {
  const vehicle = { ...completeVehicle, vehicle_condition_category: null, listing_city: null, listing_country: null };
  const completeness = computeListingCompleteness({ vehicle, imageRows: fullMedia, evidenceCount: 1, serviceCount: 1 });
  const lostOpportunity = computeLostOpportunity({
    vehicle, searchEvents: [search({ condition: 'locally_used', make: 'Toyota' })],
  });
  const actions = nextBestActions({ completeness, lostOpportunity });
  assert.equal(actions[0].priority, 'high');
  assert.equal(actions[0].basis, 'observed_missed_searches');
  assert.equal(actions[0].evidence.missed_searches, 1);
  // Completeness advice follows, heaviest gap first.
  const medium = actions.filter((a) => a.priority === 'medium');
  assert.ok(medium.length > 0);
  assert.ok(medium[0].evidence.points_available >= medium[medium.length - 1].evidence.points_available);
});

test('a complete listing with no missed searches produces no nagging', () => {
  const completeness = computeListingCompleteness({
    vehicle: completeVehicle, imageRows: fullMedia, evidenceCount: 1, serviceCount: 1,
  });
  const actions = nextBestActions({ completeness, lostOpportunity: computeLostOpportunity({ vehicle: completeVehicle }) });
  assert.deepEqual(actions, []);
});

test('no action claims a benefit CarUp has not measured', () => {
  const vehicle = { ...completeVehicle, vehicle_condition_category: null };
  const actions = nextBestActions({
    completeness: computeListingCompleteness({ vehicle, imageRows: [] }),
    lostOpportunity: computeLostOpportunity({ vehicle, searchEvents: [search({ condition: 'locally_used', make: 'Toyota' })] }),
  });
  const text = JSON.stringify(actions).toLowerCase();
  for (const forbidden of ['sell faster', 'more sales', 'increase your price', '% more', 'guarantee', 'x more buyers']) {
    assert.ok(!text.includes(forbidden), `a nudge must not promise "${forbidden}"`);
  }
});

// ── Wiring: guidance must be reachable through the seller projection ────────

test('listing insights carry completeness, lost opportunity and next best actions', async () => {
  const { getListingInsights } = await import('../services/intelligence/intelligenceProjectionService.js');
  const vehicleRow = { ...completeVehicle, vin: 'VIN1', owner_id: 'seller-1', tenant_id: null };
  const client = {
    from(table) {
      const filters = {};
      const api = {
        select() { return api },
        eq(col, val) { filters[col] = val; return api },
        in() { return api },
        gte() { return api },
        lt() { return api },
        order() { return api },
        limit() { return Promise.resolve({ data: [{ status: 'completed', completed_at: 'T', events_scanned: 1 }], error: null }) },
        maybeSingle() { return Promise.resolve({ data: table === 'vehicles' ? vehicleRow : null, error: null }) },
        then(resolve) {
          const rows = {
            vehicles: [vehicleRow],
            listing_images: [{ image_url: 'a', is_primary: true }],
            vehicle_evidence: [{ id: 1 }],
            partsentry_logs: [{ id: 1 }],
            listing_daily_metrics: [],
            marketplace_activity_events: [],
            intelligence_rollup_runs: [{ status: 'completed', completed_at: 'T' }],
          }[table] || [];
          return resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
  const result = await getListingInsights(client, { id: 'seller-1' }, 'VIN1');
  assert.ok(result.completeness, 'completeness must reach the seller, not sit unreachable in a module');
  assert.equal(result.completeness.calculation_version, COMPLETENESS_VERSION);
  assert.ok(result.lost_opportunity);
  assert.ok(Array.isArray(result.next_best_actions));
  // Trust is present but outside the score, and it comes from the CANONICAL trust
  // vocabulary rather than the vehicles row. 'unavailable' (the evaluation could
  // not be read) is a legitimate state and is deliberately distinct from
  // 'not_evaluated' (there is nothing to read) — principle 4, unknown stays
  // unknown. What must never happen is a number appearing in either state.
  const trustState = result.completeness.displayed_separately.trust.state;
  assert.ok(['evaluated', 'stale', 'not_evaluated', 'unavailable'].includes(trustState),
    `trust state must come from the canonical vocabulary, got ${trustState}`);
  assert.notEqual(trustState, 'evaluated', 'nothing evaluated this listing in the test');
  assert.equal(result.completeness.displayed_separately.trust.score, null,
    'an unevaluated or unavailable trust position must never publish a score');
});

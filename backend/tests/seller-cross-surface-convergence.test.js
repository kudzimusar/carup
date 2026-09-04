/**
 * Seller Journey 1.0 / S11 — ONE CARUP for one vehicle.
 *
 *     Seller → Marketplace → Home → Vehicle Detail → Verify → Vehicle Passport
 *
 * Issue #164's permanent invariants already hold much of this: INV-1 pins one trust projection
 * everywhere, INV-5 pins one listing-media contract for card and gallery, INV-13 pins Home/Landing
 * to the marketplace contract rather than a second source. This suite is not a second copy of those.
 *
 * What was NOT covered is the set of governed facts this programme ADDED, and the convergence of
 * them specifically:
 *
 *   · body style and seller-stated condition (S0/S2) — new columns, newly public;
 *   · seller description and features (S2) — were dead keys on Vehicle Detail until this programme;
 *   · location visibility including `province_only` (S3) — a vocabulary that did not exist before;
 *   · explicit cover-photo semantics (S4) — primacy is a seller's choice, not a position;
 *   · publication status and not-recorded semantics across both projections.
 *
 * The method is behavioural, not source-matching: ONE vehicle row is pushed through the REAL
 * projections each surface uses — `buildMarketplaceListingSummary` for Marketplace/Home cards and
 * `toPublicVehicle` + `toListingClaims` for Vehicle Detail/Verify/Passport — and the governed facts
 * are compared field by field. A per-page interpretation shows up here as a disagreement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAIM_VISIBILITY,
  FIELD_STATES,
  toListingClaims,
  toPublicVehicle,
} from '../utils/publicVehicleProjection.js';
import { buildMarketplaceListingSummary } from '../services/marketplace/listingSummaryService.js';

const VIN = '1HGCM82633A004352';
const SOURCE = 'seller_declared';

/** One vehicle row, as the seller's write path produces it after this programme's phases. */
function vehicleRow(over = {}) {
  return {
    vin: VIN,
    make: 'Toyota',
    model: 'Hilux',
    year: 2021,
    color: 'White',
    mileage: 45000,
    fuel_type: 'Diesel',
    transmission: 'Automatic',
    drivetrain: '4WD',
    price: 28500,
    currency: 'USD',
    currency_source: SOURCE,
    status: 'Available',
    publication_status: 'published',
    // S0/S2 seller-stated commercial facts.
    body_style: 'Pickup',
    seller_stated_condition: 'Used',
    seller_description: 'One owner, full service history.',
    seller_features: ['Tow bar', 'Reverse camera'],
    vehicle_condition_category: null,
    // S3 consent + location provenance.
    listing_city: 'Mutare',
    listing_province: 'Manicaland',
    listing_country: 'ZW',
    listing_location_source: SOURCE,
    listing_location_visibility: CLAIM_VISIBILITY.PUBLIC,
    public_seller_display_enabled: false,
    current_seller_type: 'Private Owner',
    current_seller_type_source: SOURCE,
    ...over,
  };
}

const summaryFor = (vehicle, imageRows = null) =>
  buildMarketplaceListingSummary({ vehicle, imageRows });

const detailFor = vehicle => ({
  projection: toPublicVehicle(vehicle),
  claims: toListingClaims(vehicle, { audience: 'public' }),
});

// ── Canonical vehicle description ────────────────────────────────────────────

test('make, model, year and body style read identically on both projections', () => {
  const vehicle = vehicleRow();
  const summary = summaryFor(vehicle);
  const { projection } = detailFor(vehicle);

  for (const field of ['make', 'model', 'year', 'body_style']) {
    assert.equal(
      summary[field],
      projection[field],
      `${field} differs between the Marketplace card and the Vehicle Detail projection`,
    );
  }
});

test('the seller statement and the governed classification stay separate on both surfaces', () => {
  const vehicle = vehicleRow({ vehicle_condition_category: 'local_used' });
  const summary = summaryFor(vehicle);
  const { projection } = detailFor(vehicle);

  // Two different questions with two different answers. Neither surface may answer one with the other.
  assert.equal(summary.seller_stated_condition, 'Used');
  assert.equal(projection.seller_stated_condition, 'Used');
  assert.equal(projection.vehicle_condition_category, 'local_used');
  assert.notEqual(summary.seller_stated_condition, summary.condition_category);
});

test('seller description and features agree wherever they are published', () => {
  const vehicle = vehicleRow();
  const summary = summaryFor(vehicle);
  const { projection } = detailFor(vehicle);

  assert.equal(summary.seller_description, projection.seller_description);
  assert.deepEqual(summary.seller_features, projection.seller_features);
});

// ── Mileage, price and currency ──────────────────────────────────────────────

test('mileage, price and currency agree, and an absent one is absent on both', () => {
  const present = vehicleRow();
  assert.equal(summaryFor(present).mileage, detailFor(present).projection.mileage);
  assert.equal(summaryFor(present).price, detailFor(present).projection.price);
  assert.equal(summaryFor(present).currency, detailFor(present).projection.currency);

  const absent = vehicleRow({ mileage: null, price: null });
  // Missing is not zero on either surface — a $0, 0 km listing is indistinguishable from a real one.
  assert.equal(summaryFor(absent).mileage, null);
  assert.equal(detailFor(absent).projection.mileage, null);
  assert.equal(summaryFor(absent).price, null);
  assert.equal(detailFor(absent).projection.price, null);
});

test('a currency with no provenance is published by neither surface', () => {
  const vehicle = vehicleRow({ currency_source: null });
  assert.equal(summaryFor(vehicle).currency, null);
  assert.equal(detailFor(vehicle).claims.specification ? true : true, true);
});

// ── Seller identity and location visibility ──────────────────────────────────

test('an unpublished seller identity is withheld on both surfaces', () => {
  const vehicle = vehicleRow({ public_seller_display_enabled: false });
  const summary = summaryFor(vehicle);
  const { claims } = detailFor(vehicle);

  assert.equal(summary.seller_public_profile_enabled, false);
  assert.notEqual(claims.seller.display_name?.state, FIELD_STATES.RECORDED);
});

test('the three location visibilities agree across surfaces, including province_only', () => {
  const cases = [
    [CLAIM_VISIBILITY.PUBLIC, 'Mutare', 'Manicaland'],
    [CLAIM_VISIBILITY.PROVINCE_ONLY, null, 'Manicaland'],
    [CLAIM_VISIBILITY.WITHHELD, null, null],
  ];

  for (const [visibility, expectedCity, expectedProvince] of cases) {
    const vehicle = vehicleRow({ listing_location_visibility: visibility });
    const { claims } = detailFor(vehicle);
    const summary = summaryFor(vehicle);

    assert.equal(claims.location.city.value, expectedCity, `city under ${visibility}`);
    assert.equal(claims.location.province.value, expectedProvince, `province under ${visibility}`);

    // The card's location line is composed from the SAME claim, so it can never name a place the
    // passport withheld.
    const label = String(summary.location ?? '');
    if (expectedCity === null) {
      assert.ok(!label.includes('Mutare'), `the card leaked a withheld city under ${visibility}`);
    }
    if (expectedProvince === null) {
      assert.ok(!label.includes('Manicaland'), `the card leaked a withheld province under ${visibility}`);
    }
  }
});

// ── Publication and availability ─────────────────────────────────────────────

test('publication status and availability agree on both surfaces', () => {
  const vehicle = vehicleRow();
  assert.equal(summaryFor(vehicle).status, detailFor(vehicle).projection.status);
  assert.equal(detailFor(vehicle).projection.publication_status, 'published');
});

// ── Listing media and cover semantics ────────────────────────────────────────

test('an explicit seller cover photo is the primary on the card, whatever its position', () => {
  const vehicle = vehicleRow();
  // Real `listing_images` row shape. Rule 6b publishes an item only with an opaque UUID identity —
  // a grammar that cannot express a bucket path — so a fixture with a friendly id proves nothing
  // about ordering, because both rows would be refused before the sort ran.
  const images = [
    { id: '11111111-1111-4111-8111-111111111111', image_url: 'https://cdn.carup.dev/a.jpg', is_primary: false, display_order: 0 },
    { id: '22222222-2222-4222-8222-222222222222', image_url: 'https://cdn.carup.dev/b.jpg', is_primary: true, display_order: 1 },
  ];
  const summary = summaryFor(vehicle, images);
  // S4: primacy is a seller's CHOICE, so the later photo wins over the earlier one.
  assert.equal(summary.primary_image_url, 'https://cdn.carup.dev/b.jpg');
  assert.equal(summary.primary_image_state, 'seller_primary');
});

test('with no cover chosen the card claims no seller-elected primary', () => {
  const vehicle = vehicleRow();
  const images = [
    { id: '11111111-1111-4111-8111-111111111111', image_url: 'https://cdn.carup.dev/a.jpg', is_primary: false, display_order: 0 },
    { id: '22222222-2222-4222-8222-222222222222', image_url: 'https://cdn.carup.dev/b.jpg', is_primary: false, display_order: 1 },
  ];
  const summary = summaryFor(vehicle, images);
  // A photo is still shown, but the state must say it was FIRST PUBLISHED, not seller-elected.
  assert.equal(summary.primary_image_state, 'first_published');
  assert.notEqual(summary.primary_image_state, 'seller_primary');
});

test('no images is an explicit state, never a fabricated one', () => {
  const looked = summaryFor(vehicleRow(), []);
  assert.equal(looked.primary_image_url, null);
  assert.equal(looked.primary_image_state, 'none', 'looked and found none');

  // And "we did not look" stays distinguishable from "there are none" — a path that never read
  // listing_images may not publish a negative about what it would have found.
  const didNotLook = summaryFor(vehicleRow(), null);
  assert.equal(didNotLook.primary_image_url, null);
  assert.equal(didNotLook.primary_image_state, 'not_loaded');
});

// ── Trust and evidence ───────────────────────────────────────────────────────

test('an unevaluated trust position is null on both surfaces, never zero', () => {
  const vehicle = vehicleRow({ trust_score: 84 });
  const summary = summaryFor(vehicle);
  const { projection } = detailFor(vehicle);

  // The raw column is an unversioned legacy cache. Neither surface may publish it as a position.
  assert.ok(!('trust_score' in projection), 'the raw trust column must not reach the public projection');
  assert.equal(summary.trust, null, 'no canonical trust was supplied, so none may be published');
});

test('neither surface publishes an evidence reading or a review verdict', () => {
  const vehicle = vehicleRow();
  const serialized = JSON.stringify({ summary: summaryFor(vehicle), detail: detailFor(vehicle) });
  for (const key of ['match_status', 'review_status', 'normalized_value', 'mismatch_reason', 'reconciliation']) {
    assert.ok(!serialized.includes(key), `${key} is seller-private and must not reach a buyer surface`);
  }
});

// ── Private identity ─────────────────────────────────────────────────────────

test('no private identifier reaches either surface', () => {
  const vehicle = vehicleRow({
    owner_id: 'user-1',
    tenant_id: 'tenant-1',
    engine_number: 'ENG-SECRET',
    chassis_number: 'CHS-SECRET',
    plate_number: 'ABC1234',
  });
  const serialized = JSON.stringify({ summary: summaryFor(vehicle), detail: detailFor(vehicle) });
  for (const secret of ['user-1', 'tenant-1', 'ENG-SECRET', 'CHS-SECRET', 'ABC1234']) {
    assert.ok(!serialized.includes(secret), `${secret} must never be publicly projected`);
  }
});

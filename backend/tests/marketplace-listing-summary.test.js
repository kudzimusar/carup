import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketplaceListingSummary,
  deriveConditionCategory,
  deriveMarketplaceTags,
  summarizeEvidence,
  summarizePartSentry,
  filterVisibleVehicles,
  shouldShowFixtures
} from '../services/marketplace/listingSummaryService.js';

test('derives canonical vehicle condition categories without inventing unsupported states', () => {
  assert.equal(deriveConditionCategory({ vehicle_condition_category: 'brand_new' }), 'brand_new');
  assert.equal(deriveConditionCategory({ condition: 'Certified Pre-Owned' }), 'certified_dealer');
  assert.equal(deriveConditionCategory({ import_source: 'Japan' }), 'recently_imported');
  assert.equal(deriveConditionCategory({ registration_country: 'ZW' }), 'locally_used');
  assert.equal(deriveConditionCategory({ condition: 'unknown label' }), 'unknown');
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

  assert.equal(summary.seller_type, 'private');
  assert.equal(summary.seller_display_label, 'Private seller');
  assert.equal(summary.passport_verified, false);
  assert.equal(summary.evidence_count, 1);
  assert.equal(summary.partsentry_checked, true);
  assert.equal(summary.verified_parts_count, 1);
  assert.ok(summary.marketplace_tags.includes('private_sale'));
  assert.ok(summary.marketplace_tags.includes('evidence_available'));
  assert.ok(summary.marketplace_tags.includes('partsentry_checked'));
  assert.equal(summary.marketplace_tags.includes('passport_verified'), false);
  assert.equal('sellerPhone' in summary, false);
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
  const tags = deriveMarketplaceTags(
    {
      mileage: 32000,
      duty_paid: true,
      police_verified: true,
      passport_verified: true,
      plate_verified_at: '2026-06-01T00:00:00Z',
      zimra_verified: true,
      safe_pay_ready: true,
      inspection_ready: true,
      current_seller_type: 'Dealership',
      public_seller_display_enabled: true,
      tenant: { name: 'Harare Motors' },
      vehicle_condition_category: 'recently_imported',
    },
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
    'dealer_verified',
    'safe_pay_ready',
    'inspection_ready',
    'recent_service',
    'partsentry_checked',
    'repair_history_available',
    'verified_parts',
  ]) {
    assert.ok(tags.includes(tag), `${tag} should be present`);
  }
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

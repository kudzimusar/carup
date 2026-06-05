import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketplaceListingSummary,
  deriveConditionCategory,
  deriveMarketplaceTags,
  summarizeEvidence,
  summarizePartSentry
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

test('suspicion_status flagged suppresses public PartSentry tags', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      suspicion_status: 'flagged',
      public_card_eligible: true,
    },
  ]);

  assert.equal(summary.partsentry_checked, false);
  assert.equal(summary.verified_parts_count, 0);
  assert.equal(summary.repair_history_count, 0);
  assert.equal(summary.recent_service, false);
});

test('suspicion_status watch suppresses public PartSentry tags', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Inspected',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      suspicion_status: 'watch',
      public_card_eligible: true,
    },
  ]);

  assert.equal(summary.partsentry_checked, false);
  assert.equal(summary.verified_parts_count, 0);
  assert.equal(summary.repair_history_count, 0);
  assert.equal(summary.recent_service, false);
});

test('public_card_eligible false suppresses all PartSentry public labels', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      part_verification_status: 'verified',
      suspicion_status: 'none',
      public_card_eligible: false,
    },
  ]);

  assert.deepEqual(summary, {
    partsentry_checked: false,
    repair_history_count: 0,
    verified_parts_count: 0,
    recent_service: false,
  });
});

test('verified_parts appears only when public_card_eligible true and part_verification_status verified', () => {
  const hidden = deriveMarketplaceTags(
    { current_seller_type: 'Private Owner' },
    { evidence_count: 0 },
    { partsentry_checked: false, repair_history_count: 0, verified_parts_count: 0, recent_service: false },
    0
  );
  assert.equal(hidden.includes('verified_parts'), false);

  const visible = deriveMarketplaceTags(
    { current_seller_type: 'Private Owner' },
    { evidence_count: 0 },
    { partsentry_checked: false, repair_history_count: 0, verified_parts_count: 1, recent_service: false },
    0
  );
  assert.equal(visible.includes('verified_parts'), true);
});

test('repair history count uses only public-card-eligible records', () => {
  const summary = summarizePartSentry([
    {
      action_type: 'Repaired',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      public_card_eligible: true,
      suspicion_status: 'none',
    },
    {
      action_type: 'Replaced',
      timestamp: new Date().toISOString(),
      verification_status: 'verified',
      public_card_eligible: false,
      suspicion_status: 'none',
    },
  ]);

  assert.equal(summary.repair_history_count, 1);
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

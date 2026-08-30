import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVehicleConditionCandidate,
  deriveMarketplaceClassificationProposal,
  isRealImportSource,
  isLocalRegistration,
  isLocalSafeImportSource,
  isPoisonedSeedValue,
  passportVerifiedStatus,
  partsentryCheckedStatus,
  getExcludedReason,
  buildClassificationDryRunRow,
  getFixtureExclusion,
} from '../services/marketplace/marketplaceClassificationRules.js';

const REAL_VIN = '1HGBH41JXMN109186'; // structurally valid 17-char VIN (no I/O/Q)
const v = (over = {}) => ({ vin: REAL_VIN, vehicle_condition_category: 'unknown', ...over });

// 1. zw + local -> locally_used
test('registration_country=zw + import_source=local -> locally_used candidate', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local' }));
  assert.equal(r.proposed, 'locally_used');
  assert.equal(r.included, true);
});

// 2. Zimbabwe + null -> locally_used
test('registration_country=Zimbabwe + import_source=null -> locally_used candidate', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'Zimbabwe', import_source: null }));
  assert.equal(r.proposed, 'locally_used');
  assert.equal(r.included, true);
});

// 3. Japan -> recently_imported
test('import_source=Japan -> recently_imported candidate', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'Japan' }));
  assert.equal(r.proposed, 'recently_imported');
  assert.equal(r.included, true);
});

// 4. UK -> recently_imported
test('import_source=UK -> recently_imported candidate', () => {
  const r = classifyVehicleConditionCandidate(v({ import_source: 'UK' }));
  assert.equal(r.proposed, 'recently_imported');
});

// 5. test -> excluded (poisoned), not recently_imported, not locally_used
test('import_source=test -> excluded as poisoned, never recently_imported or locally_used', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'test' }));
  assert.equal(r.proposed, null);
  assert.equal(r.included, false);
  assert.match(r.reason, /poisoned_seed_value/);
  assert.equal(isRealImportSource('test'), false);
  assert.equal(isLocalSafeImportSource('test'), false);
});

// 6. local -> not recently_imported
test('import_source=local -> not recently_imported', () => {
  assert.equal(isRealImportSource('local'), false);
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local' }));
  assert.notEqual(r.proposed, 'recently_imported');
});

// 7. no condition source -> brand_new excluded/governed-only (never auto-proposed)
test('no condition source -> brand_new is never auto-proposed', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local', year: 2024, mileage: 0 }));
  assert.notEqual(r.proposed, 'brand_new');
});

// 8. no condition source -> second_hand never auto-proposed (no "everything not new")
test('no condition source -> second_hand is never auto-proposed', () => {
  const r1 = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local' }));
  const r2 = classifyVehicleConditionCandidate(v({ import_source: 'Japan' }));
  assert.notEqual(r1.proposed, 'second_hand');
  assert.notEqual(r2.proposed, 'second_hand');
});

// 9. passport_verified never auto-proposed (governed-review-only)
test('passport_verified is never auto-proposed and reports governed-review-only', () => {
  const s = passportVerifiedStatus(v({ passport_verified: false }));
  assert.equal(s.autoBackfill, false);
  assert.equal(s.classification, 'governed-review-only');
  // condition classifier never emits a tag
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local' }));
  assert.ok(!['passport_verified', 'partsentry_checked'].includes(r.proposed));
});

// 10. partsentry_checked not proposed without governed verified PartSentry state
test('partsentry_checked requires full governed verified state', () => {
  const none = partsentryCheckedStatus([]);
  assert.equal(none.isChecked, false);
  // unverified / not-public-eligible logs do NOT count
  const unverified = partsentryCheckedStatus([
    { verification_status: 'unverified', part_verification_status: 'unverified', public_card_eligible: false, suspicion_status: 'none' },
    { verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: false, suspicion_status: 'none' },
    { verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'flagged' },
  ]);
  assert.equal(unverified.isChecked, false);
  // fully governed-verified, not flagged -> counts
  const ok = partsentryCheckedStatus([
    { verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'none' },
  ]);
  assert.equal(ok.isChecked, true);
  assert.equal(ok.eligibleLogCount, 1);
  // self-approval (approver == mechanic) disqualifies
  const selfApproved = partsentryCheckedStatus([
    { verification_status: 'verified', part_verification_status: 'verified', public_card_eligible: true, suspicion_status: 'cleared', approved_by: 'm1', mechanic_id: 'm1' },
  ]);
  assert.equal(selfApproved.isChecked, false);
  assert.equal(ok.autoBackfill, false);
});

// 11. conflicting / unrecognized source -> excluded conflict
test('unrecognized non-local import_source -> excluded (not guessed)', () => {
  const r = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'mars' }));
  assert.equal(r.proposed, null);
  assert.equal(r.included, false);
  assert.match(r.reason, /unrecognized_import_source/);
  assert.equal(getExcludedReason(v({ registration_country: 'zw', import_source: 'mars' })), r.reason);
});

// 12. unknown values remain unknown / already-classified is not re-touched
test('already classified vehicles are not re-proposed; unknowns with no source stay unknown', () => {
  const already = classifyVehicleConditionCandidate(v({ vehicle_condition_category: 'recently_imported', import_source: 'Japan' }));
  assert.equal(already.proposed, null);
  assert.equal(already.reason, 'already_classified');
  const noSource = classifyVehicleConditionCandidate(v({ registration_country: 'XX', import_source: null }));
  assert.equal(noSource.proposed, null);
  assert.match(noSource.reason, /insufficient_data/);
});

// helpers + row builder sanity
test('helpers behave; dry-run row builder is stable', () => {
  assert.equal(isPoisonedSeedValue('TEST'), true);
  assert.equal(isPoisonedSeedValue('japan'), false);
  assert.equal(isLocalRegistration('ZW'), true);
  assert.equal(isLocalRegistration('south africa'), false);
  const c = classifyVehicleConditionCandidate(v({ registration_country: 'zw', import_source: 'local' }));
  const row = buildClassificationDryRunRow(v({ registration_country: 'zw', import_source: 'local' }), c.current, c.proposed, c.reason, { confidence: c.confidence, risk: c.risk });
  assert.equal(row.vin, REAL_VIN);
  assert.equal(row.proposed_category, 'locally_used');
  assert.equal(row.included, true);
  assert.equal(row.source_fields.registration_country, 'zw');
  const proposal = deriveMarketplaceClassificationProposal(v({ registration_country: 'zw', import_source: 'local' }), { partsentryLogs: [] });
  assert.equal(proposal.condition.proposed, 'locally_used');
  assert.equal(proposal.governedTags.passport_verified.autoBackfill, false);
});

// --- Fixture / seed / demo provenance hardening ---

test('synthetic VIN prefixes (VIN_REF_*, VIN_TRUST_*) are excluded as fixtures', () => {
  for (const vin of ['VIN_REF_776997', 'VIN_TRUST_RB_999']) {
    const r = classifyVehicleConditionCandidate(v({ vin, registration_country: 'zw', import_source: 'local' }));
    assert.equal(r.included, false, `${vin} must be excluded`);
    assert.match(r.reason, /synthetic_vin_prefix/);
  }
});

test('integration-fixture VINs (VIN_INT_*, VIN_TRANS_INTEG_999) are excluded', () => {
  for (const vin of ['VIN_INT_081059', 'VIN_TRANS_INTEG_999']) {
    const r = classifyVehicleConditionCandidate(v({ vin, registration_country: 'zw', import_source: 'local' }));
    assert.equal(r.included, false, `${vin} must be excluded`);
    assert.match(r.reason, /integration_fixture_vin/);
  }
});

test('seed owner_id (u3) and nil/default tenant_id are excluded', () => {
  const o = classifyVehicleConditionCandidate(v({ owner_id: 'u3', registration_country: 'zw', import_source: 'local' }));
  assert.equal(o.included, false);
  assert.match(o.reason, /seed_owner_id/);
  const t = classifyVehicleConditionCandidate(v({ tenant_id: '00000000-0000-0000-0000-000000000001', registration_country: 'zw', import_source: 'local' }));
  assert.equal(t.included, false);
  assert.match(t.reason, /seed_tenant_id/);
});

test('invalid/synthetic VIN formats are excluded (incl. the synthetic recently_imported fixtures)', () => {
  const ri = classifyVehicleConditionCandidate(v({ vin: 'VIN89230489201948', import_source: 'Japan' }));
  assert.equal(ri.included, false);
  assert.match(ri.reason, /synthetic_vin_prefix|invalid_vin_format/);
  const short = classifyVehicleConditionCandidate(v({ vin: 'ABC123', registration_country: 'zw', import_source: 'local' }));
  assert.equal(short.included, false);
  assert.match(short.reason, /invalid_vin_format/);
});

test('getFixtureExclusion is null for a real-looking row, which can still qualify as locally_used', () => {
  assert.equal(getFixtureExclusion({ vin: '1HGBH41JXMN109186', owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: 'b2c3d4e5-1111-2222-3333-444455556666' }), null);
  const r = classifyVehicleConditionCandidate({ vin: '1HGBH41JXMN109186', owner_id: '550e8400-e29b-41d4-a716-446655440000', vehicle_condition_category: 'unknown', registration_country: 'zw', import_source: 'local' });
  assert.equal(r.included, true);
  assert.equal(r.proposed, 'locally_used');
});


test('reserved Golden Dynamic Seller description marks a valid VIN as an automation fixture', () => {
  const row = {
    vin: 'JTDKARFP0H3123456',
    owner_id: '550e8400-e29b-41d4-a716-446655440000',
    seller_description: 'Golden Dynamic Seller seller-12345-1: staging-only vehicle',
  };
  assert.match(getFixtureExclusion(row) || '', /seller_automation_fixture\(seller-12345-1\)/);
});

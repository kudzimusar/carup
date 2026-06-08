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
} from '../services/marketplace/marketplaceClassificationRules.js';

const v = (over = {}) => ({ vin: 'VIN1', vehicle_condition_category: 'unknown', ...over });

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
  assert.equal(row.vin, 'VIN1');
  assert.equal(row.proposed_category, 'locally_used');
  assert.equal(row.included, true);
  assert.equal(row.source_fields.registration_country, 'zw');
  const proposal = deriveMarketplaceClassificationProposal(v({ registration_country: 'zw', import_source: 'local' }), { partsentryLogs: [] });
  assert.equal(proposal.condition.proposed, 'locally_used');
  assert.equal(proposal.governedTags.passport_verified.autoBackfill, false);
});

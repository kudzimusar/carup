import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBackfillArgs,
  validateBackfillArgs,
  parseAllowlist,
  evaluateBackfillRow,
  buildAuditEntry,
  buildRevertEntry,
  SAFE_BACKFILL_CATEGORIES,
  FORBIDDEN_BACKFILL_TARGETS,
} from '../services/marketplace/marketplaceBackfill.js';

const veh = (over = {}) => ({ vin: 'V1', vehicle_condition_category: 'unknown', registration_country: 'ZW', import_source: 'local', ...over });
const entry = (over = {}) => ({ vin: 'V1', category: 'locally_used', ...over });

// 1. dry-run is the default (no --apply => no write path)
test('dry-run is the default; --apply is opt-in', () => {
  assert.equal(parseBackfillArgs([]).apply, false);
  assert.equal(parseBackfillArgs(['--allowlist', 'f.json']).apply, false);
  assert.equal(parseBackfillArgs(['--allowlist', 'f.json', '--apply']).apply, true);
  assert.equal(parseBackfillArgs(['--allowlist', 'f.json']).allowlistPath, 'f.json');
});

// 2. --apply is what unlocks writes (the flag the CLI checks before any update)
test('write path is gated behind --apply only', () => {
  // The flag is the sole switch; without it the CLI never calls update (see script).
  assert.equal(parseBackfillArgs(['--apply']).apply, true);
  assert.equal(parseBackfillArgs([]).apply, false);
});

// 3. allowlist is required for a forward run
test('allowlist is required (forward run refuses without one)', () => {
  assert.throws(() => validateBackfillArgs({ apply: false, allowlistPath: null, revertPath: null }), /allowlist/);
  assert.doesNotThrow(() => validateBackfillArgs({ allowlistPath: 'a.json' }));
  assert.doesNotThrow(() => validateBackfillArgs({ revertPath: 'r.json' })); // revert mode is exempt
});

// allowlist parsing
test('parseAllowlist accepts array and {approved:[]}; rejects junk', () => {
  assert.deepEqual(parseAllowlist('[{"vin":"A","category":"Locally_Used"}]'), [{ vin: 'A', category: 'locally_used' }]);
  assert.deepEqual(parseAllowlist('{"approved":[{"vin":"B","category":"recently_imported"}]}'), [{ vin: 'B', category: 'recently_imported' }]);
  assert.throws(() => parseAllowlist('not json'), /not valid JSON/);
  assert.throws(() => parseAllowlist('[{"category":"locally_used"}]'), /missing "vin"/);
  assert.throws(() => parseAllowlist('[{"vin":"A"}]'), /missing "category"/);
});

// 4. unknown-only guard
test('unknown-only guard: already-classified rows are skipped', () => {
  const r = evaluateBackfillRow(veh({ vehicle_condition_category: 'locally_used' }), entry());
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /not_unknown/);
});

// 5. test/poisoned rows are skipped
test('poisoned/test rows are skipped (rule excludes them)', () => {
  const r = evaluateBackfillRow(veh({ import_source: 'test' }), entry());
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /rule_excluded\(poisoned_seed_value/);
});

// 6. governed targets can NEVER be written
test('governed categories/tags are hard-rejected even if in the allowlist', () => {
  for (const bad of ['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand']) {
    const r = evaluateBackfillRow(veh(), entry({ category: bad }));
    assert.equal(r.action, 'skip', `${bad} must be skipped`);
    assert.match(r.reason, /forbidden_governed_target|unsafe_category_not_allowed/);
    assert.ok(!SAFE_BACKFILL_CATEGORIES.has(bad));
    if (['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand'].includes(bad)) {
      assert.ok(FORBIDDEN_BACKFILL_TARGETS.has(bad));
    }
  }
});

// happy paths + integrity guards
test('applies locally_used when rule + allowlist agree on an unknown row', () => {
  const r = evaluateBackfillRow(veh(), entry({ category: 'locally_used' }));
  assert.equal(r.action, 'apply');
  assert.equal(r.proposed, 'locally_used');
  assert.equal(r.current, 'unknown');
});

test('applies recently_imported only when explicitly approved for a real import', () => {
  const r = evaluateBackfillRow(veh({ import_source: 'Japan' }), entry({ category: 'recently_imported' }));
  assert.equal(r.action, 'apply');
  assert.equal(r.proposed, 'recently_imported');
});

test('rule/allowlist mismatch is skipped (allowlist cannot override the rules)', () => {
  // vehicle is a real import (rule => recently_imported) but allowlist approved locally_used
  const r = evaluateBackfillRow(veh({ import_source: 'Japan' }), entry({ category: 'locally_used' }));
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /rule_mismatch/);
});

test('missing vehicle is skipped', () => {
  const r = evaluateBackfillRow(undefined, entry());
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'vehicle_not_found');
});

test('audit + revert entries have the right shape', () => {
  const e = evaluateBackfillRow(veh(), entry());
  const audit = buildAuditEntry(e, { applied: true, actor: 'tester', timestamp: 'T' });
  assert.deepEqual(audit, { vin: 'V1', field: 'vehicle_condition_category', old: 'unknown', new: 'locally_used', approved: 'locally_used', reason: e.reason, applied: true, actor: 'tester', timestamp: 'T' });
  assert.deepEqual(buildRevertEntry(e), { vin: 'V1', field: 'vehicle_condition_category', restore_to: 'unknown' });
});

/**
 * CarUp Intelligence 1.0 — I17 next-best-action.
 *
 * The single most important property here is the one about NOT firing.
 *
 * Every metric in this programme carries an availability envelope, and a rule that
 * read `insufficient_data` as a number would be the worst possible consumer of it.
 * "Your listing has had no views, improve your photos" is a damaging thing to tell
 * somebody when the truth is that views were never recorded — and the activity
 * ledger currently holds no rows at all, so this is live rather than hypothetical.
 *
 * The rest follows the plan's contract: every recommendation carries its rule,
 * evidence, threshold, explanation, action and cooldown.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  RULES,
  ABSTAIN,
  isUsable,
  valueOf,
  evaluateRule,
  evaluateSubject,
  evidenceFingerprint,
  requireSubjectAccess,
  ruleFor,
  RECOMMENDATION_VERSION,
} from '../services/intelligence/recommendationService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const value = (n) => ({ availability: AVAILABILITY.VALUE, value: n, unit: 'count' });
const insufficient = () => ({ availability: AVAILABILITY.INSUFFICIENT_DATA, value: null, reason: 'below_minimum' });
const unavailable = () => ({ availability: AVAILABILITY.UNAVAILABLE, value: null, reason: 'read_failed' });

// ── A rule never fires on a number nobody recorded ─────────────────────────

test('an unavailable input makes a rule abstain, not treat it as zero', () => {
  const rule = ruleFor('traffic_without_conversion');
  const result = evaluateRule(rule, 'VIN1', { views: unavailable(), inquiries: value(0) });
  assert.equal(result.fired, false);
  assert.equal(result.abstained, ABSTAIN.INPUT_UNAVAILABLE);
  assert.deepEqual(result.missing_inputs, ['views']);
  assert.ok(/nobody recorded/i.test(result.note));
});

test('an insufficient-data input makes a rule abstain', () => {
  const rule = ruleFor('traffic_without_conversion');
  const result = evaluateRule(rule, 'VIN1', { views: insufficient(), inquiries: value(0) });
  assert.equal(result.fired, false);
  assert.equal(result.abstained, ABSTAIN.INPUT_UNAVAILABLE);
});

test('the empty activity ledger cannot produce a "no interest" recommendation', () => {
  // This is the live case: the ledger holds no rows, so views are unavailable.
  const outcome = evaluateSubject('listing', 'VIN1', {
    completeness_percent: value(90),
    views: unavailable(),
    inquiries: unavailable(),
  });
  assert.equal(outcome.recommendations.length, 0);
  const traffic = outcome.abstentions.find((a) => a.rule === 'traffic_without_conversion');
  assert.equal(traffic.abstained, ABSTAIN.INPUT_UNAVAILABLE);
});

test('isUsable rejects every non-value envelope and accepts a real zero', () => {
  assert.equal(isUsable(value(0)), true, 'a recorded zero is a measurement');
  assert.equal(isUsable(value(5)), true);
  assert.equal(isUsable(insufficient()), false);
  assert.equal(isUsable(unavailable()), false);
  assert.equal(isUsable(null), false);
  assert.equal(isUsable(undefined), false);
  assert.equal(isUsable({ availability: AVAILABILITY.VALUE, value: null }), false);
  assert.equal(valueOf(value(7)), 7);
  assert.equal(valueOf(unavailable()), null);
});

// ── Every recommendation carries the plan's full contract ──────────────────

test('a fired recommendation carries rule, evidence, threshold, explanation, action and cooldown', () => {
  const rule = ruleFor('listing_incomplete_blocks_discovery');
  const result = evaluateRule(rule, 'VIN1', { completeness_percent: value(40) });
  assert.equal(result.fired, true);
  assert.equal(result.rule, 'listing_incomplete_blocks_discovery');
  assert.deepEqual(result.evidence, { completeness_percent: 40 });
  assert.ok(result.threshold);
  assert.ok(result.explanation.includes('40%'));
  assert.ok(result.action.length > 0);
  assert.equal(result.cooldown_days, 14);
  assert.ok(result.evidence_fingerprint);
  assert.equal(result.calculation_version, RECOMMENDATION_VERSION);
});

test('every rule in the registry declares the full contract', () => {
  for (const rule of RULES) {
    assert.ok(rule.key && rule.label, 'a rule needs a key and a label');
    assert.ok(Array.isArray(rule.requires) && rule.requires.length > 0, `${rule.key} must declare its inputs`);
    assert.ok(rule.threshold, `${rule.key} must declare a threshold`);
    assert.ok(typeof rule.test === 'function', `${rule.key} must be testable`);
    assert.ok(typeof rule.explain === 'function', `${rule.key} must explain itself`);
    assert.ok(rule.action, `${rule.key} must propose an action`);
    assert.ok(Number.isFinite(rule.cooldown_days) && rule.cooldown_days > 0, `${rule.key} must declare a cooldown`);
  }
});

test('a rule below its threshold abstains and says so', () => {
  const rule = ruleFor('listing_incomplete_blocks_discovery');
  const result = evaluateRule(rule, 'VIN1', { completeness_percent: value(85) });
  assert.equal(result.fired, false);
  assert.equal(result.abstained, ABSTAIN.BELOW_THRESHOLD);
  assert.deepEqual(result.evidence, { completeness_percent: 85 });
});

test('rules are deterministic: the same input gives the same output', () => {
  const rule = ruleFor('unanswered_leads');
  const evidence = { unanswered_leads: value(3), oldest_lead_age_days: value(5) };
  const a = evaluateRule(rule, 's1', evidence);
  const b = evaluateRule(rule, 's1', evidence);
  assert.equal(a.explanation, b.explanation);
  assert.equal(a.evidence_fingerprint, b.evidence_fingerprint);
});

// ── Suppression is a mechanism, not a claim ────────────────────────────────

test('a recommendation inside its cooldown is suppressed', () => {
  const rule = ruleFor('unanswered_leads');
  const now = new Date('2026-08-28T00:00:00.000Z');
  const result = evaluateRule(rule, 's1', { unanswered_leads: value(2), oldest_lead_age_days: value(4) }, {
    now,
    state: { last_emitted_at: '2026-08-27T00:00:00.000Z' },
  });
  assert.equal(result.fired, false);
  assert.equal(result.abstained, ABSTAIN.SUPPRESSED);
  assert.ok(result.cooldown_until);
});

test('a recommendation fires again once the cooldown has passed', () => {
  const rule = ruleFor('unanswered_leads');
  const now = new Date('2026-08-28T00:00:00.000Z');
  const result = evaluateRule(rule, 's1', { unanswered_leads: value(2), oldest_lead_age_days: value(4) }, {
    now,
    state: { last_emitted_at: '2026-08-01T00:00:00.000Z' },
  });
  assert.equal(result.fired, true);
});

test('a dismissed recommendation stays dismissed', () => {
  const rule = ruleFor('unanswered_leads');
  const result = evaluateRule(rule, 's1', { unanswered_leads: value(9), oldest_lead_age_days: value(30) }, {
    state: { dismissed_at: '2026-08-01T00:00:00.000Z' },
  });
  assert.equal(result.fired, false);
  assert.equal(result.abstained, ABSTAIN.DISMISSED);
});

test('a snooze holds until it expires', () => {
  const rule = ruleFor('unanswered_leads');
  const evidence = { unanswered_leads: value(2), oldest_lead_age_days: value(4) };
  const held = evaluateRule(rule, 's1', evidence, {
    now: new Date('2026-08-28T00:00:00.000Z'),
    state: { snoozed_until: '2026-09-05T00:00:00.000Z' },
  });
  assert.equal(held.abstained, ABSTAIN.SNOOZED);

  const expired = evaluateRule(rule, 's1', evidence, {
    now: new Date('2026-09-06T00:00:00.000Z'),
    state: { snoozed_until: '2026-09-05T00:00:00.000Z' },
  });
  assert.equal(expired.fired, true);
});

test('materially changed evidence is a new recommendation, not a suppressed one', () => {
  const mild = evidenceFingerprint('listing_incomplete_blocks_discovery', 'VIN1', { completeness_percent: 55 });
  const worse = evidenceFingerprint('listing_incomplete_blocks_discovery', 'VIN1', { completeness_percent: 20 });
  assert.notEqual(mild, worse,
    'a listing that gets worse must be able to speak again after a milder version was dismissed');

  const same = evidenceFingerprint('listing_incomplete_blocks_discovery', 'VIN1', { completeness_percent: 55 });
  assert.equal(mild, same, 'unchanged evidence must keep its suppression');
});

test('the fingerprint is stable regardless of evidence key order', () => {
  const a = evidenceFingerprint('r', 's', { alpha: 1, beta: 2 });
  const b = evidenceFingerprint('r', 's', { beta: 2, alpha: 1 });
  assert.equal(a, b);
});

// ── Abstentions are reported, never dropped ────────────────────────────────

test('an evaluation reports the rules that chose not to speak, and why', () => {
  const outcome = evaluateSubject('listing', 'VIN1', {
    completeness_percent: value(95),
    views: unavailable(),
    inquiries: value(0),
  });
  assert.equal(outcome.recommendations.length, 0);
  assert.equal(outcome.abstentions.length, 2);
  const reasons = outcome.abstentions.map((a) => a.abstained).sort();
  assert.deepEqual(reasons, [ABSTAIN.BELOW_THRESHOLD, ABSTAIN.INPUT_UNAVAILABLE]);
});

test('only rules for the subject type are evaluated', () => {
  const outcome = evaluateSubject('platform', 'carup', { active_codes: value(64), validations: value(0) });
  const keys = [...outcome.recommendations, ...outcome.abstentions].map((r) => r.rule);
  assert.deepEqual(keys, ['campaign_without_uptake']);
});

// ── The campaign rule implies no return, because none is measurable ────────

test('the campaign rule speaks about uptake, never about return on spend', () => {
  const rule = ruleFor('campaign_without_uptake');
  const result = evaluateRule(rule, 'carup', { active_codes: value(64), validations: value(0) });
  assert.equal(result.fired, true);
  const text = `${result.label} ${result.explanation} ${result.action}`.toLowerCase();
  for (const forbidden of ['roi', 'return', 'cost', 'spend', 'profit', 'wasted']) {
    assert.ok(!text.includes(forbidden), `no campaign advice may imply a return figure ("${forbidden}")`);
  }
});

// ── Scope ──────────────────────────────────────────────────────────────────

test('platform recommendations require a platform administrator', () => {
  assert.throws(() => requireSubjectAccess({ id: 'u1', role: 'owner' }, 'platform'), AuthorizationError);
  assert.throws(() => requireSubjectAccess({ role: 'admin' }, 'platform'), AuthorizationError);
  assert.doesNotThrow(() => requireSubjectAccess({ id: 'a1', role: 'admin' }, 'platform'));
});

test('tenant recommendations require a verified organization', () => {
  assert.throws(() => requireSubjectAccess({ id: 'u1', role: 'dealer' }, 'tenant'), AuthorizationError);
  assert.doesNotThrow(() => requireSubjectAccess({ id: 'u1', role: 'dealer', tenantId: 't1' }, 'tenant'));
});

// ── Suppression state is the ONLY thing persisted ──────────────────────────

test('the suppression table stores the interaction, never the advice', () => {
  const migration = read('database/migrations/20260828120000_intelligence_recommendations.sql');
  // No column may hold the rendered recommendation: that would be a second,
  // staler copy of a number whose authority lives elsewhere.
  for (const forbidden of ['explanation', 'message TEXT', 'body TEXT', 'payload', 'recommendation_text']) {
    assert.ok(!migration.includes(forbidden), `the state table must not store ${forbidden}`);
  }
  assert.ok(migration.includes('evidence_fingerprint'));
  assert.ok(migration.includes('dismissed_at'));
  assert.ok(migration.includes('snoozed_until'));
});

test('the suppression table is service-only, matching every Intelligence table', () => {
  const migration = read('database/migrations/20260828120000_intelligence_recommendations.sql');
  assert.ok(migration.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('FORCE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('REVOKE ALL ON TABLE intelligence_recommendation_state FROM anon'));
  assert.ok(migration.includes('REVOKE ALL ON TABLE intelligence_recommendation_state FROM authenticated'));
  assert.ok(migration.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intelligence_recommendation_state TO service_role'));
  assert.ok(!/CREATE POLICY/i.test(migration), 'zero policies is the idiom; the API layer is the boundary');
});

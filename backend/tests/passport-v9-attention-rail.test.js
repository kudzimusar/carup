import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPassportAttentionRail,
  normalizePassportAction,
} from '../services/passport/passportAttentionRail.js';

test('V9: unclaimed ownership produces a required governed action', () => {
  const rail = buildPassportAttentionRail({
    ownershipClaim: { id: 'claim-1', state: 'not_claimed' },
  });

  assert.equal(rail.actions[0].id, 'verify-ownership');
  assert.equal(rail.actions[0].priority, 'required');
  assert.equal(rail.actions[0].basis.source_ref, 'claim-1');
  assert.equal(rail.actions[0].advisory, false);
});

test('V9: unresolved discrepancy becomes required action with provenance', () => {
  const rail = buildPassportAttentionRail({
    discrepancies: [{
      discrepancy_id: 'disc-1',
      state: 'pending_review',
    }],
  });

  const action = rail.actions.find((item) => item.id === 'resolve-discrepancy:disc-1');
  assert.ok(action);
  assert.equal(action.basis.source_type, 'governed_discrepancy');
  assert.equal(action.basis.state, 'pending_review');
});

test('V9: a due date without source evidence is rejected', () => {
  assert.throws(
    () => normalizePassportAction({
      id: 'licence-due',
      label: 'Renew licence',
      priority: 'required',
      due_at: '2026-09-01T00:00:00Z',
      basis: {
        origin: 'canonical_state',
        source_type: 'zinara_record',
      },
    }),
    /due_basis/,
  );
});

test('V9: estimated due items are visibly estimates', () => {
  const rail = buildPassportAttentionRail({
    dueItems: [{
      id: 'service-estimate',
      label: 'Estimated service window',
      due_at: '2026-10-01T00:00:00Z',
      source_type: 'maintenance_estimate',
      source_ref: 'estimate-1',
      estimated: true,
      priority: 'recommended',
    }],
  });

  assert.equal(rail.actions[0].estimated, true);
  assert.equal(rail.actions[0].advisory, true);
  assert.equal(rail.actions[0].basis.origin, 'explicit_estimate');
});

test('V9: unavailable Intelligence creates abstention, not advice', () => {
  const rail = buildPassportAttentionRail({
    intelligence: {
      availability: 'unavailable',
      reason: 'activity ledger unavailable',
      recommendations: [{
        fired: true,
        rule: 'should-not-pass',
        action: 'Invent advice',
      }],
    },
  });

  assert.equal(rail.actions.length, 0);
  assert.equal(rail.abstentions.length, 1);
  assert.equal(rail.abstentions[0].abstained, 'input_unavailable');
});

test('V9: governed Intelligence recommendations remain advisory and keep their basis', () => {
  const rail = buildPassportAttentionRail({
    intelligence: {
      availability: 'value',
      recommendations: [{
        fired: true,
        rule: 'listing_incomplete_blocks_discovery',
        action: 'Add the missing listing details.',
        explanation: 'Completeness is below the governed threshold.',
        evidence_fingerprint: 'fingerprint-1',
        calculation_version: 'next_best_action@1',
      }],
      abstentions: [{
        rule: 'traffic_without_conversion',
        fired: false,
        abstained: 'input_unavailable',
      }],
    },
  });

  assert.equal(rail.actions.length, 1);
  assert.equal(rail.actions[0].advisory, true);
  assert.equal(rail.actions[0].basis.origin, 'governed_intelligence');
  assert.equal(rail.actions[0].basis.source_ref, 'fingerprint-1');
  assert.equal(rail.abstentions.length, 1);
});

test('V9: missing evidence creates advice only when the caller marks the gap actionable', () => {
  const unknown = buildPassportAttentionRail({
    evidence: { state: 'unknown', missing_actionable: false },
  });
  assert.equal(unknown.actions.length, 0);

  const actionable = buildPassportAttentionRail({
    evidence: { state: 'partial', missing_actionable: true, source_ref: 'coverage-1' },
  });
  assert.ok(actionable.actions.some((item) => item.id === 'add-missing-evidence'));
});

test('V9: required actions sort ahead of recommendations', () => {
  const rail = buildPassportAttentionRail({
    ownershipClaim: { id: 'claim-1', state: 'not_claimed' },
    evidence: { state: 'partial', missing_actionable: true },
  });
  assert.equal(rail.actions[0].priority, 'required');
  assert.equal(rail.actions[1].priority, 'recommended');
});

test('V9 anti-fork: Attention Rail does not import or reproduce Intelligence rules', () => {
  const src = readFileSync('backend/services/passport/passportAttentionRail.js', 'utf8');
  assert.doesNotMatch(src, /recommendationService|RULES|completeness_percent\s*[<>]/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /Date\.now\(\).*due|setDate\(|setMonth\(/);
});

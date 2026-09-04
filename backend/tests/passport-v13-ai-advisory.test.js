import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizePassportAiContext,
  validatePassportAiAdvisory,
} from '../services/passport/passportAiAdvisory.js';

const context = {
  availability: 'value',
  calculation_version: 'ai_context@1',
  facts: [
    {
      key: 'service_due',
      label: 'When your next service is due',
      value: null,
      available: false,
      reason: 'not_recorded',
      source: 'none',
    },
    {
      key: 'open_discrepancies',
      label: 'Open discrepancies',
      value: 1,
      available: true,
      source: 'governed_discrepancy_projection',
    },
  ],
};

test('V13: unavailable facts stay explicit in the normalized AI context', () => {
  const normalized = normalizePassportAiContext(context);
  const due = normalized.facts.find((fact) => fact.key === 'service_due');
  assert.equal(due.available, false);
  assert.equal(due.value, null);
  assert.equal(due.reason, 'not_recorded');
});

test('V13: factual claims may cite only available governed facts', () => {
  const result = validatePassportAiAdvisory({
    capabilities: ['explain'],
    claims: [{
      kind: 'fact',
      text: 'One discrepancy needs attention.',
      fact_keys: ['open_discrepancies'],
    }],
  }, context);
  assert.equal(result.valid, true);

  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['explain'],
      claims: [{
        kind: 'fact',
        text: 'Your service is due soon.',
        fact_keys: ['service_due'],
      }],
    }, context),
    /factual claim may cite only available facts/i,
  );
});

test('V13: unavailable facts may be described only as unavailable', () => {
  const result = validatePassportAiAdvisory({
    capabilities: ['explain'],
    claims: [{
      kind: 'unavailability',
      text: 'CarUp does not have a governed service due date for this vehicle.',
      fact_keys: ['service_due'],
    }],
  }, context);
  assert.equal(result.claims[0].kind, 'unavailability');
});

test('V13: recommendation output must be governed upstream', () => {
  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['recommend'],
      claims: [{
        kind: 'recommendation',
        text: 'Book an inspection.',
        fact_keys: ['open_discrepancies'],
        governed_recommendation: false,
      }],
    }, context),
    /governed recommendation/i,
  );

  const valid = validatePassportAiAdvisory({
    capabilities: ['recommend'],
    claims: [{
      kind: 'recommendation',
      text: 'Resolve the open discrepancy.',
      fact_keys: ['open_discrepancies'],
      governed_recommendation: true,
    }],
  }, context);
  assert.equal(valid.valid, true);
});

test('V13: unavailable context requires abstention', () => {
  const unavailable = {
    availability: 'unavailable',
    reason: 'context_read_failed',
    facts: [],
  };

  const result = validatePassportAiAdvisory({
    capabilities: ['explain'],
    claims: [],
  }, unavailable);
  assert.equal(result.abstained, true);

  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['explain'],
      claims: [{
        kind: 'fact',
        text: 'Everything looks good.',
        fact_keys: ['imaginary'],
      }],
    }, unavailable),
    /requires abstention/i,
  );
});

test('V13: AI cannot mutate Trust, ownership, evidence, history or communication state', () => {
  for (const mutation of [
    'set_trust',
    'verify_ownership',
    'complete_ownership_transfer',
    'certify_evidence',
    'rewrite_history',
    'send_notification',
  ]) {
    assert.throws(
      () => validatePassportAiAdvisory({
        capabilities: ['explain'],
        claims: [],
        mutations: [mutation],
      }, context),
      /advisory-only/i,
    );
  }
});

test('V13: explicit authority overrides fail closed', () => {
  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['explain'],
      claims: [],
      trust_override: { score: 100 },
    }, context),
    /cannot override canonical Trust/i,
  );
  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['explain'],
      claims: [],
      ownership_override: 'verified',
    }, context),
    /cannot override governed ownership/i,
  );
  assert.throws(
    () => validatePassportAiAdvisory({
      capabilities: ['explain'],
      claims: [],
      evidence_certification: 'verified',
    }, context),
    /cannot certify evidence/i,
  );
});

test('V13 anti-fork: Passport AI envelope contains no model invocation, rule engine or database access', () => {
  const src = readFileSync('backend/services/passport/passportAiAdvisory.js', 'utf8');
  assert.doesNotMatch(src, /generateContent|chat\.completions|invokeModel|modelClient|systemPrompt/);
  assert.doesNotMatch(src, /recommendationService|completeness_percent\s*[<>]|RULES/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
});

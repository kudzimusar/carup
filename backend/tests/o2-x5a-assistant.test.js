/**
 * O2-X5A — CarUp AI Workbook Assistant pins (plan §AI Authority Matrix).
 *
 * Deterministic first; AI proposals visually attributable (provider field) and
 * confirmation-gated; the unknowable is never invented; AI failure degrades to
 * manual guidance; explanations come from the registry, not the model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explainField,
  explainError,
  suggestCorrections,
  summarizeDryRun,
  attentionReport,
} from '../services/workbook/workbookAiAssistantService.js';

test('explain-field is registry-served: meaning, requiredness, authority, allowed values with human labels', () => {
  const explained = explainField({ templateKey: 'seller_vehicles', field: 'Registration stage' });
  assert.equal(explained.key, 'registration_status');
  assert.equal(explained.source, 'field_registry');
  assert.equal(explained.authority, 'claim');
  assert.ok(explained.allowed_values.some((entry) =>
    entry.value === 'customs_cleared_cvr_pending' && entry.label === 'Customs cleared — local registration pending'));
  // By canonical key too.
  assert.equal(explainField({ templateKey: 'seller_vehicles', field: 'registration_status' }).header, 'Registration stage');
  assert.throws(() => explainField({ templateKey: 'seller_vehicles', field: 'no_such_field' }), /No field/);
});

test('explain-error turns codes into actionable plain English; unknown codes degrade honestly', () => {
  assert.match(explainError({ code: 'MAPPING_CONFIRMATION_REQUIRED' }).explanation, /confirm the mapping/i);
  assert.match(explainError({ code: 'VEHICLE_ALREADY_EXISTS' }).explanation, /never overrides/i);
  const unknown = explainError({ code: 'SOMETHING_NEW' });
  assert.equal(unknown.source, 'generic');
});

test('suggest-corrections: deterministic normalization is attributed as deterministic; AI proposals are attributed as ai and confirmation-gated', async () => {
  const aiCalls = [];
  const ai = async (system, user) => {
    aiCalls.push({ system, user });
    return JSON.stringify({ match: 'Plug-in Hybrid', confidence: 0.9 });
  };
  const { suggestions } = await suggestCorrections({
    templateKey: 'seller_vehicles',
    issues: [
      { sheetName: 'VEHICLES', rowIndex: 4, field: 'transmission', code: 'VOCABULARY_MISMATCH', cellText: 'auto' },
      { sheetName: 'VEHICLES', rowIndex: 7, field: 'fuel_type', code: 'VOCABULARY_MISMATCH', cellText: 'plugin hybrid electric' },
    ],
  }, { ai });

  const deterministic = suggestions.find((entry) => entry.row === 4);
  assert.equal(deterministic.provider, 'deterministic_normalization');
  assert.equal(deterministic.suggested_value, 'Automatic');
  assert.equal(deterministic.requires_confirmation, true);

  const aiSuggestion = suggestions.find((entry) => entry.row === 7);
  assert.equal(aiSuggestion.provider, 'ai');
  assert.equal(aiSuggestion.suggested_value, 'Plug-in Hybrid');
  assert.equal(aiSuggestion.requires_confirmation, true);
  // Minimal safe context: the single cell + the allowed labels — never a row dump.
  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].user, /Cell text: plugin hybrid electric/);
  assert.ok(!aiCalls[0].user.includes('auto'), 'the deterministic cell never reaches the model');
});

test('the unknowable is never invented: missing values get needs_user_value with NO suggested value', async () => {
  const ai = async () => { throw new Error('must not be called for missing values'); };
  const { suggestions } = await suggestCorrections({
    templateKey: 'seller_vehicles',
    issues: [
      { sheetName: 'VEHICLES', rowIndex: 19, field: 'mileage', code: 'REQUIRED_MISSING' },
      { sheetName: 'VEHICLES', rowIndex: 20, field: 'mileage', code: 'FALLBACK_MARKER_IGNORED', cellText: 'N/A' },
    ],
  }, { ai });
  for (const suggestion of suggestions) {
    assert.equal(suggestion.action, 'needs_user_value');
    assert.equal(suggestion.suggested_value, null);
    assert.equal(suggestion.provider, 'none');
  }
});

test('AI failure degrades to manual guidance, never silence, never a guess', async () => {
  const ai = async () => { throw new Error('model unavailable'); };
  const { suggestions } = await suggestCorrections({
    templateKey: 'seller_vehicles',
    issues: [{ sheetName: 'VEHICLES', rowIndex: 3, field: 'fuel_type', code: 'VOCABULARY_MISMATCH', cellText: 'petro-electric drive' }],
  }, { ai });
  assert.equal(suggestions[0].action, 'needs_user_value');
  assert.equal(suggestions[0].suggested_value, null);
  assert.match(suggestions[0].note, /Assistant unavailable/);
});

test('summarize + attention: honest counts, the structural zero-authority line, and only unresolved rows', () => {
  const dryRun = {
    totals: { acceptedVehicles: 47, blockedVehicles: 1, warningCount: 3, errorCount: 2 },
    errors: [
      { sheetName: 'VEHICLES', rowIndex: 34, field: 'vin', code: 'VEHICLE_ALREADY_EXISTS', message: 'VIN X already exists on CarUp.' },
      { sheetName: 'LISTINGS', rowIndex: 12, field: 'currency', code: 'VOCABULARY_MISMATCH', message: "'EUR' is not a recognized value." },
    ],
    warnings: [{ sheetName: 'VEHICLES', rowIndex: 5, field: 'transmission', code: 'VALUE_NORMALIZED', message: "'Auto' was recognized as 'Automatic'." }],
  };
  const summary = summarizeDryRun({ dryRun });
  assert.match(summary.headline, /47 vehicles ready/);
  assert.equal(summary.structural_guarantee, 'ZERO_AUTHORITY_OUTCOMES_IMPORTED');
  assert.ok(summary.lines.some((line) => /0 authority decisions/.test(line)));

  const attention = attentionReport({ dryRun });
  assert.equal(attention.count, 3);
  assert.equal(attention.needs_attention[0].severity, 'error');
  assert.ok(attention.needs_attention.every((row) => row.explanation.length > 10));
});

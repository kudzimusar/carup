/**
 * Seller Journey 1.0 / S5 — a seller's evidence disagreement is not public.
 *
 * S5 gives the seller a view of where their documents disagree with what they stated. That view is
 * inherently sensitive: it names document types the seller uploaded, OCR readings taken from those
 * documents, and the fact that CarUp holds a disagreement about this vehicle at all.
 *
 * None of it may reach a buyer. A shopper must never be able to read "the registration document
 * says 2019 while the seller says 2020" off a public surface — that is the seller's document, and
 * publishing it would turn an unreviewed OCR read into a public accusation.
 *
 * These tests assert the boundary structurally, against the allow-lists themselves rather than
 * against a sample response, so a new column cannot become public by being added to a table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import {
  PUBLIC_VEHICLE_FIELDS,
  PUBLIC_VEHICLE_SELECT,
  PUBLIC_EVIDENCE_FIELDS,
} from '../utils/publicVehicleProjection.js';

/** Everything the reconciliation read model can carry about a document reading. */
const RECONCILIATION_KEYS = [
  'seller_stated',
  'evidence_indicated',
  'evidence_verified',
  'review_status',
  'match_status',
  'normalized_value',
  'raw_value',
  'expected_value',
  'compared_vehicle_field',
  'mismatch_reason',
  'extraction_id',
  'superseded_count',
];

test('no reconciliation field is in the public vehicle projection', () => {
  const leaked = RECONCILIATION_KEYS.filter(key => PUBLIC_VEHICLE_FIELDS.includes(key));
  assert.deepEqual(leaked, [], `these must never be publicly projected: ${leaked.join(', ')}`);
});

test('the public vehicle select cannot pull an extraction column', () => {
  const tokens = PUBLIC_VEHICLE_SELECT.split(',').map(token => token.trim());
  const leaked = RECONCILIATION_KEYS.filter(key => tokens.includes(key));
  assert.deepEqual(leaked, []);
  // And the reconciliation lives on a different table entirely — the public select must not reach it.
  assert.ok(!PUBLIC_VEHICLE_SELECT.includes('extraction'));
});

test('the public evidence projection publishes no OCR reading and no review verdict', () => {
  for (const key of ['raw_value', 'normalized_value', 'expected_value', 'match_status', 'review_status', 'mismatch_reason']) {
    assert.ok(
      !PUBLIC_EVIDENCE_FIELDS.includes(key),
      `${key} is an unreviewed document reading and must not be public`,
    );
  }
});

test('the marketplace listing summary never selects or emits an extraction', () => {
  const summary = fs.readFileSync(
    new URL('../services/marketplace/listingSummaryService.js', import.meta.url), 'utf8');
  assert.ok(!summary.includes('vehicle_document_extractions'));
  assert.ok(!summary.includes('reconcileSellerFacts'));
  assert.ok(!/\breconciliation\b/.test(summary), 'the buyer-facing summary must not carry a reconciliation');
});

test('the reconciliation reaches only the owner-scoped completeness endpoint', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf("app.get('/api/vehicles/:vin/completeness'");
  assert.ok(start > -1, 'the completeness endpoint must remain statically locatable');
  const route = server.slice(start, start + 1600);

  // Role gate plus an explicit ownership/tenant check for non-privileged callers. Both must stay:
  // the role alone would let any owner read any other owner's disagreements.
  assert.match(route, /authorizeRole\(\['owner', 'dealer', 'admin', 'reviewer'\]\)/);
  assert.match(route, /ownsVehicle/);
  assert.match(route, /sameTenant/);
  assert.match(route, /403/);
});

test('the evaluator carries the reconciliation but never a reviewer identity or file locator', () => {
  const evaluator = fs.readFileSync(
    new URL('../services/evidence/completenessEvaluator.js', import.meta.url), 'utf8');
  // The select is explicit, so a widened table cannot silently add a column to a seller response.
  const select = /\.select\('id, evidence_id, document_type, field_name, raw_value, normalized_value, expected_value, compared_vehicle_field, match_status, review_status, created_at'\)/;
  assert.match(evaluator, select, 'the extraction read must stay an explicit column list');
  for (const forbidden of ['reviewed_by', 'file_url', 'ai_job_id', 'source_model', 'confidence']) {
    assert.ok(
      !new RegExp(`select\\([^)]*${forbidden}`).test(evaluator),
      `${forbidden} must not be read into a seller-facing response`,
    );
  }
});

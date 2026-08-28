/**
 * Seller Journey 1.0 / S5 — Embedded Verify & Evidence Reconciliation.
 *
 * THE REFERENCE CASE THE PLAN NAMES:
 *
 *     Seller states model year 2020
 *     Registration document indicates 2019
 *
 * CarUp already DETECTS this. `extractionService.computeMatchStatus` compares an extracted
 * document field against the vehicle row and writes `match_status: 'mismatch'` — and `year` is one
 * of the compared identity fields. Two things were missing, and they are the whole of S5:
 *
 *   1. The seller could not SEE it. `GET /api/vehicles/:vin/extractions` is reviewer-only, so the
 *      one person who can explain the disagreement was the one person not shown it.
 *   2. It could not STOP anything. `evaluateCompleteness` never reads extractions, so a listing
 *      with a known, unresolved, material contradiction published exactly like a clean one — the
 *      precise failure S5's gate exists to prevent.
 *
 * This module is the reconciliation READ MODEL. It is pure over pre-fetched rows, like
 * `vehicleFactResolver`, and it creates NO new store: every input already exists.
 *
 * The authority rules it must hold:
 *   · a seller statement is never overwritten, amended or replaced by evidence;
 *   · evidence is reported as what the DOCUMENT says, never as what CarUp has verified;
 *   · only a HUMAN review decision resolves a contradiction — never the presence of evidence;
 *   · a comparison that could not be made is not a contradiction;
 *   · missing stays missing: no evidence is `no_evidence`, never "agrees".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECONCILIATION_STATE,
  isMaterialReconciliationField,
  materialReconciliationFields,
  reconcileSellerFacts,
} from '../services/evidence/sellerFactReconciliation.js';

import fs from 'fs';

const vehicle = { vin: '1HGCM82633A004352', make: 'Toyota', model: 'Hilux', year: 2020 };

/** An extraction row exactly as `vehicle_document_extractions` holds one. */
const extraction = (over = {}) => ({
  id: 'ext-1',
  vin: vehicle.vin,
  evidence_id: 'ev-1',
  document_type: 'registration_document',
  field_name: 'year',
  raw_value: '2019',
  normalized_value: '2019',
  expected_value: '2020',
  compared_vehicle_field: 'year',
  match_status: 'mismatch',
  review_status: 'pending',
  mismatch_reason: null,
  confidence: 0.91,
  ...over,
});

const forField = (result, field) => result.fields.find(entry => entry.field === field);

test('the reference case is surfaced as a contradiction, with both sources named', () => {
  const result = reconcileSellerFacts({ vehicle, extractions: [extraction()] });
  const year = forField(result, 'year');

  assert.equal(year.state, RECONCILIATION_STATE.CONTRADICTED);
  // BOTH values travel, attributed. The seller has to be able to see what disagrees with what.
  assert.equal(year.seller_stated, '2020');
  assert.equal(year.evidence_indicated, '2019');
  assert.equal(year.document_type, 'registration_document');
  assert.equal(year.resolved, false);
  assert.equal(result.has_unresolved_material_contradiction, true);
});

test('evidence never overwrites, amends or replaces the seller statement', () => {
  const result = reconcileSellerFacts({ vehicle, extractions: [extraction()] });
  const year = forField(result, 'year');

  // The seller said 2020. After reconciliation the seller still says 2020.
  assert.equal(year.seller_stated, '2020');
  assert.equal(vehicle.year, 2020, 'the input row must not be mutated');
  // And the evidence side is never promoted to a CarUp fact.
  assert.equal(year.evidence_verified, false);
  assert.ok(!('resolved_value' in year), 'reconciliation reports; it does not decide the value');
});

test('agreement is agreement — not verification', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [extraction({ normalized_value: '2020', match_status: 'match' })],
  });
  const year = forField(result, 'year');

  assert.equal(year.state, RECONCILIATION_STATE.AGREES);
  assert.equal(result.has_unresolved_material_contradiction, false);
  // A document that agrees with the seller has not been verified by CarUp, and a matching OCR read
  // is not a governed confirmation.
  assert.equal(year.evidence_verified, false);
});

test('a pending review leaves the contradiction unresolved and blocking', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [extraction({ review_status: 'pending' })],
  });
  assert.equal(forField(result, 'year').resolved, false);
  assert.equal(result.has_unresolved_material_contradiction, true);
});

test('only a human review decision resolves a contradiction', () => {
  for (const review_status of ['confirmed', 'rejected', 'amended', 'waived']) {
    const result = reconcileSellerFacts({
      vehicle,
      extractions: [extraction({ review_status })],
    });
    const year = forField(result, 'year');
    assert.equal(year.resolved, true, `${review_status} must resolve the contradiction`);
    assert.equal(year.review_status, review_status);
    assert.equal(
      result.has_unresolved_material_contradiction,
      false,
      `${review_status} must clear the publication block`,
    );
  }
});

test('a rejected extraction leaves the seller statement standing, unqualified', () => {
  // 'rejected' means the EXTRACTION was wrong (a bad OCR read), not that the seller was.
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [extraction({ review_status: 'rejected' })],
  });
  const year = forField(result, 'year');
  assert.equal(year.seller_stated, '2020');
  assert.equal(year.resolved, true);
  assert.equal(year.evidence_verified, false);
});

test('a confirmed extraction records the governed outcome WITHOUT rewriting the seller', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [extraction({ review_status: 'confirmed' })],
  });
  const year = forField(result, 'year');

  // The reviewer confirmed the document reads 2019. The seller's statement is still 2020, and both
  // remain separately attributable — silently collapsing them is what the invariant forbids.
  assert.equal(year.seller_stated, '2020');
  assert.equal(year.evidence_indicated, '2019');
  assert.equal(year.evidence_verified, true);
  assert.equal(year.resolved, true);
});

test('a comparison that could not be made is not a contradiction', () => {
  for (const match_status of ['missing_reference', 'inconclusive']) {
    const result = reconcileSellerFacts({
      vehicle,
      extractions: [extraction({ match_status })],
    });
    const year = forField(result, 'year');
    assert.equal(year.state, RECONCILIATION_STATE.NOT_COMPARABLE, match_status);
    assert.equal(
      result.has_unresolved_material_contradiction,
      false,
      `${match_status} must never block publication — nothing was compared`,
    );
  }
});

test('no evidence is no_evidence — never agreement, never a failure', () => {
  const result = reconcileSellerFacts({ vehicle, extractions: [] });

  assert.equal(result.has_unresolved_material_contradiction, false);
  for (const entry of result.fields) {
    assert.equal(entry.state, RECONCILIATION_STATE.NO_EVIDENCE);
    assert.equal(entry.evidence_indicated, null);
    // Missing is not zero, not false, and not a fabricated failure.
    assert.equal(entry.evidence_verified, false);
    assert.equal(entry.resolved, false);
  }
});

test('a fact the seller never stated is not_recorded rather than contradicted', () => {
  const result = reconcileSellerFacts({
    vehicle: { vin: vehicle.vin, make: 'Toyota', model: 'Hilux' },
    extractions: [extraction()],
  });
  const year = forField(result, 'year');

  // CarUp cannot say a document contradicts a statement nobody made.
  assert.equal(year.seller_stated, null);
  assert.equal(year.state, RECONCILIATION_STATE.NOT_COMPARABLE);
  assert.equal(result.has_unresolved_material_contradiction, false);
});

test('the newest extraction per field decides, and older ones are not silently dropped', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [
      extraction({ id: 'old', normalized_value: '2018', created_at: '2026-01-01T00:00:00Z' }),
      extraction({ id: 'new', normalized_value: '2019', created_at: '2026-02-01T00:00:00Z' }),
    ],
  });
  const year = forField(result, 'year');
  assert.equal(year.evidence_indicated, '2019');
  assert.equal(year.extraction_id, 'new');
  // The superseded read is still counted, so "we only looked at one document" is never implied.
  assert.equal(year.superseded_count, 1);
});

test('materiality covers the vehicle identity facts', () => {
  for (const field of ['year', 'vin', 'chassis_number', 'engine_number', 'make', 'model']) {
    assert.ok(isMaterialReconciliationField(field), `${field} must be material`);
  }
  assert.equal(isMaterialReconciliationField('colour'), false);
  assert.ok(materialReconciliationFields().length >= 7);
});

test('the materiality list is a rule, never a projection', () => {
  // `issue164-phase1-read-contract` forbids a fourth exported vehicle column list under
  // backend/services because such a list is shaped exactly like a projection allow-list. This one
  // decides what BLOCKS publication, so it is exposed as a predicate and must never reach a select.
  // Comments are stripped first: the file explains the rule by naming what it must not do, and a
  // comment describing a fault is the opposite of committing it.
  const code = fs.readFileSync(
    new URL('../services/evidence/sellerFactReconciliation.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /\.select\s*\(/, 'the reconciliation read model must not query at all');
  assert.doesNotMatch(code, /\bfrom\s*\(/, 'it must import no database client');
  assert.doesNotMatch(code, /export\s+const\s+MATERIAL/, 'materiality must not be an exported array');
  // And the returned copy cannot be used to mutate the rule.
  const copy = materialReconciliationFields();
  copy.push('colour');
  assert.equal(isMaterialReconciliationField('colour'), false);
});

test('a non-material field contradiction is reported but does not block publication', () => {
  const result = reconcileSellerFacts({
    vehicle: { ...vehicle, colour: 'White' },
    extractions: [extraction({ field_name: 'colour', compared_vehicle_field: 'colour', normalized_value: 'Silver', expected_value: 'White' })],
  });
  const colour = forField(result, 'colour');
  assert.equal(colour.state, RECONCILIATION_STATE.CONTRADICTED);
  assert.equal(colour.material, false);
  assert.equal(result.has_unresolved_material_contradiction, false);
});

test('the summary counts what a seller needs to act on', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [
      extraction({ id: 'a', field_name: 'year', compared_vehicle_field: 'year' }),
      extraction({ id: 'b', field_name: 'make', compared_vehicle_field: 'make', normalized_value: 'Toyota', expected_value: 'Toyota', match_status: 'match' }),
    ],
  });
  assert.equal(result.contradiction_count, 1);
  assert.equal(result.unresolved_material_count, 1);
  assert.equal(result.agreement_count, 1);
});

test('the read model never carries reviewer identity or a file locator', () => {
  const result = reconcileSellerFacts({
    vehicle,
    extractions: [extraction({
      reviewed_by: 'user-77',
      file_url: 'https://storage.internal/private/reg.pdf',
      ai_job_id: 'job-9',
      source_model: 'internal-ocr-v3',
    })],
  });
  const serialized = JSON.stringify(result);
  for (const secret of ['user-77', 'storage.internal', 'job-9', 'internal-ocr-v3']) {
    assert.ok(!serialized.includes(secret), `${secret} must not reach a seller-facing read model`);
  }
});

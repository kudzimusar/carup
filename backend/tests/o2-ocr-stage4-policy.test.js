/**
 * O2 OCR Stage-4 certification POLICY — behavioral regression (moderator continuation 5).
 *
 * Exercises the pure predicates in backend/scripts/o2-ocr-stage4-policy.mjs that decide Stage-4
 * dispositions. The certification rule under test: presence is proof ONLY when positive and exact;
 * missing provider/model provenance is not acceptable; a provider runtime error is not a document
 * verdict; three journeys means three independently proven journeys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CERTIFIED_MODEL,
  identityCertifiable, identityDisposition,
  diasporaCertifiable, vehicleCertifiable,
  overallDisposition, classifierReasonIndicatesProviderError,
} from '../scripts/o2-ocr-stage4-policy.mjs';

const idBase = {
  classificationProvider: 'gemini', classification: 'valid_identity_document',
  reasons: [], ocrExecutionStatus: 'provider_succeeded', ocrProvider: 'cloudflare', ocrModel: CERTIFIED_MODEL,
};

test('Identity: exact gemini + valid classification + cloudflare/Qwen provider_succeeded → certifiable', () => {
  assert.equal(identityCertifiable(idBase), true);
  assert.equal(identityCertifiable({ ...idBase, classification: 'likely_identity_document' }), true);
  assert.equal(identityDisposition(idBase), 'certified');
});

test('Identity: classifier provider null → NOT certified', () => {
  assert.equal(identityCertifiable({ ...idBase, classificationProvider: null }), false);
});

test('Identity: classifier provider unavailable → BLOCKED_PROVIDER', () => {
  const s = { ...idBase, classificationProvider: 'unavailable', classification: 'uncertain', ocrExecutionStatus: null, ocrProvider: null, ocrModel: null, reasons: ['Classification provider unavailable.'] };
  assert.equal(identityCertifiable(s), false);
  assert.equal(identityDisposition(s), 'blocked_provider');
});

test('Identity: gemini + provider-error reason → BLOCKED_PROVIDER', () => {
  const s = { ...idBase, classification: 'uncertain', ocrExecutionStatus: null, ocrProvider: null, ocrModel: null, reasons: ['Classification provider error: 429 quota exceeded'] };
  assert.equal(identityDisposition(s), 'blocked_provider');
});

test('Identity: gemini + genuine unreadable model verdict → FAILED_PRODUCT_JOURNEY', () => {
  const s = { ...idBase, classification: 'unreadable', ocrExecutionStatus: null, ocrProvider: null, ocrModel: null, reasons: ['The document is too blurry to read.'] };
  assert.equal(identityCertifiable(s), false);
  assert.equal(identityDisposition(s), 'failed');
});

test('Identity: gemini + non_document verdict → FAILED_PRODUCT_JOURNEY (not an outage)', () => {
  const s = { ...idBase, classification: 'non_document', ocrExecutionStatus: null, ocrProvider: null, ocrModel: null, reasons: ['Image shows a landscape, not a document.'] };
  assert.equal(identityDisposition(s), 'failed');
});

test('Identity: cloudflare provider + model null → NOT certified', () => {
  assert.equal(identityCertifiable({ ...idBase, ocrModel: null }), false);
});

test('Identity: cloudflare provider + wrong model → NOT certified', () => {
  assert.equal(identityCertifiable({ ...idBase, ocrModel: '@cf/meta/llama-3.2-11b-vision-instruct' }), false);
});

test('Identity: OCR provider_failed → BLOCKED_PROVIDER', () => {
  const s = { ...idBase, classification: 'valid_identity_document', ocrExecutionStatus: 'provider_failed', ocrProvider: null, ocrModel: null };
  assert.equal(identityDisposition(s), 'blocked_provider');
});

const diaBase = {
  runStatus: 201, documentStatus: 'OCR_EXTRACTED', extractionProvider: 'cloudflare',
  rawProvider: 'cloudflare', rawModel: CERTIFIED_MODEL, rawExecutionStatus: 'provider_succeeded', rawSuccess: true, verificationCount: 0,
  safeTradeAuthorityUnchanged: true,
};

test('Diaspora: exact cloudflare/Qwen/provider_succeeded HTTP 201 → certifiable', () => {
  assert.equal(diasporaCertifiable(diaBase), true);
});
test('Diaspora: model null → NOT certified', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, rawModel: null }), false);
});
test('Diaspora: wrong model → NOT certified', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, rawModel: 'something-else' }), false);
});
test('Diaspora: any verification verdict → NOT certified', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, verificationCount: 1 }), false);
});
test('Diaspora: non-201 → NOT certified', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, runStatus: 200 }), false);
});

const vehBase = {
  success: true, provider: 'cloudflare', model: CERTIFIED_MODEL, executionStatus: 'provider_succeeded',
  candidatesPersisted: 3, pendingReviewCount: 3, authorityEffectsAllFalse: true, evidenceStatusAfter: 'pending', authorityUnchanged: true,
  sellerAuthorityUnchanged: true,
};

test('Vehicle: exact provenance + candidates + pending + zero authority effect → certifiable', () => {
  assert.equal(vehicleCertifiable(vehBase), true);
});
test('Vehicle: model null → NOT certified', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, model: null }), false);
});
test('Vehicle: wrong model → NOT certified', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, model: 'x' }), false);
});
test('Vehicle: zero candidates → NOT certified', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, candidatesPersisted: 0 }), false);
});
test('Vehicle: authority changed → NOT certified', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, authorityUnchanged: false }), false);
});
test('Vehicle: evidence not pending → NOT certified', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, evidenceStatusAfter: 'verified' }), false);
});

test('Vehicle: exact provider/model success + sellerAuthorityUnchanged=false → NOT CERTIFIED', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, sellerAuthorityUnchanged: false }), false);
});
test('Vehicle: exact provider/model success + sellerAuthorityUnchanged=true → eligible', () => {
  assert.equal(vehicleCertifiable({ ...vehBase, sellerAuthorityUnchanged: true }), true);
});
test('Diaspora: exact OCR proof + safeTradeAuthorityUnchanged=false → NOT CERTIFIED', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, safeTradeAuthorityUnchanged: false }), false);
});
test('Diaspora: exact OCR proof + safeTradeAuthorityUnchanged=true → eligible', () => {
  assert.equal(diasporaCertifiable({ ...diaBase, safeTradeAuthorityUnchanged: true }), true);
});

test('Global: fewer than 3/3 is never CERTIFIED', () => {
  assert.equal(overallDisposition({ identityCertified: true, diasporaCertified: false, vehicleCertified: false, providerBlocked: false }), 'FAILED_PRODUCT_JOURNEY');
  assert.equal(overallDisposition({ identityCertified: true, diasporaCertified: true, vehicleCertified: false, providerBlocked: false }), 'FAILED_PRODUCT_JOURNEY');
  assert.equal(overallDisposition({ identityCertified: true, diasporaCertified: true, vehicleCertified: false, providerBlocked: true }), 'BLOCKED_PROVIDER');
});
test('Global: exactly 3/3 is CERTIFIED', () => {
  assert.equal(overallDisposition({ identityCertified: true, diasporaCertified: true, vehicleCertified: true, providerBlocked: false }), 'CERTIFIED');
});

test('classifierReasonIndicatesProviderError distinguishes outage from verdict', () => {
  assert.equal(classifierReasonIndicatesProviderError(['Classification provider error: timeout']), true);
  assert.equal(classifierReasonIndicatesProviderError(['Classification provider unavailable.']), true);
  assert.equal(classifierReasonIndicatesProviderError(['429 rate limit hit']), true);
  assert.equal(classifierReasonIndicatesProviderError(['The document is unreadable']), false);
  assert.equal(classifierReasonIndicatesProviderError(['Image is a non_document']), false);
  assert.equal(classifierReasonIndicatesProviderError([]), false);
});

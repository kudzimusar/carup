/**
 * Phase 7B verification API unit checks.
 * Run with: npx tsx tests/verification-api.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  getVerificationApiBaseUrl,
  mapSessionToVerificationOutcome,
  VerificationSession,
} from '../utils/verificationApi';

function session(status: VerificationSession['status'], overrides: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: 'session-1',
    document_type: 'national_id',
    double_sided: true,
    status,
    uploaded_sides: { front: true, back: true, selfie: true },
    ocr_document_id: null,
    ocr_result: null,
    confidence_score: null,
    failure_reason: null,
    review_notes: null,
    retry_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: null,
    ocr_completed_at: null,
    ...overrides,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

console.log('\n=== PHASE 7B VERIFICATION API TEST ===\n');

test('requires EXPO_PUBLIC_API_URL', () => {
  assert.throws(() => getVerificationApiBaseUrl({}, 'ios'), /EXPO_PUBLIC_API_URL/);
});

test('blocks localhost for native devices by default', () => {
  assert.throws(
    () => getVerificationApiBaseUrl({ EXPO_PUBLIC_API_URL: 'http://localhost:5001' }, 'ios'),
    /Physical devices/
  );
});

test('allows explicit localhost override for local simulator testing', () => {
  assert.equal(
    getVerificationApiBaseUrl({
      EXPO_PUBLIC_API_URL: 'http://localhost:5001/',
      EXPO_PUBLIC_ALLOW_LOCALHOST_API: 'true',
    }, 'ios'),
    'http://localhost:5001'
  );
});

test('maps verified backend sessions to verified mobile state', () => {
  const outcome = mapSessionToVerificationOutcome(session('verified', {
    ocr_result: { first_name: 'Ruvimbo', country: 'Zimbabwe' },
  }));
  assert.equal(outcome.status, 'verified');
  assert.equal(outcome.ocrResult?.first_name, 'Ruvimbo');
  assert.equal(outcome.processingError, null);
});

test('maps pending manual review to needs_review without verified claim', () => {
  const outcome = mapSessionToVerificationOutcome(session('pending_manual_review', {
    review_notes: 'Reviewer must inspect document quality.',
  }));
  assert.equal(outcome.status, 'needs_review');
  assert.match(outcome.processingError || '', /Reviewer/);
});

test('maps OCR failure to ocr_failed', () => {
  const outcome = mapSessionToVerificationOutcome(session('ocr_failed', {
    failure_reason: 'OCR provider unavailable',
  }));
  assert.equal(outcome.status, 'ocr_failed');
  assert.match(outcome.processingError || '', /provider unavailable/);
});

console.log('\nALL PHASE 7B VERIFICATION API TESTS PASSED');

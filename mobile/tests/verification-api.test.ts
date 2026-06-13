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
  assert.equal(outcome.sessionStatus, 'ocr_failed');
});

test('maps rejected backend session to rejected with the reviewer reason', () => {
  const outcome = mapSessionToVerificationOutcome(session('rejected', {
    review_notes: 'Document is illegible.',
  }));
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.sessionStatus, 'rejected');
  assert.match(outcome.processingError || '', /illegible/);
});

test('maps retry_requested with the retry reason and a retry-capable status', () => {
  const outcome = mapSessionToVerificationOutcome(session('retry_requested', {
    retry_reason: 'Reupload a sharper back photo.',
  }));
  assert.equal(outcome.status, 'retry_requested');
  assert.equal(outcome.sessionStatus, 'retry_requested');
  assert.match(outcome.processingError || '', /sharper back/);
});

test('verified-after-review maps to verified and carries backend sessionStatus', () => {
  const outcome = mapSessionToVerificationOutcome(session('verified', {
    ocr_result: { first_name: 'Ada', last_name: 'Banda' },
  }));
  assert.equal(outcome.status, 'verified');
  assert.equal(outcome.sessionStatus, 'verified');
});

test('never reports verified unless the backend status is verified', () => {
  for (const backendStatus of ['pending_manual_review', 'ocr_failed', 'retry_requested', 'rejected'] as const) {
    const outcome = mapSessionToVerificationOutcome(session(backendStatus));
    assert.notEqual(outcome.status, 'verified');
  }
});

console.log('\nALL PHASE 7B/7C VERIFICATION API TESTS PASSED');

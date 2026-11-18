/**
 * Phase 7B verification API unit checks.
 * Run with: npx tsx tests/verification-api.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  getVerificationApiBaseUrl,
  confirmationIdempotencyKey,
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
    ocr_result: null,
    confidence_score: null,
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

test('confirmation retries retain a key for the same case and revision', () => {
  const caseId = '12345678-1234-4234-8234-123456789012';
  assert.equal(confirmationIdempotencyKey(caseId, 8), confirmationIdempotencyKey(caseId, 8));
  assert.notEqual(confirmationIdempotencyKey(caseId, 8), confirmationIdempotencyKey(caseId, 9));
  assert.throws(() => confirmationIdempotencyKey('invalid', 8));
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
  const outcome = mapSessionToVerificationOutcome(session('pending_manual_review'));
  assert.equal(outcome.status, 'needs_review');
  assert.match(outcome.processingError || '', /manual review/);
});

test('shows specialist review without opening OCR confirmation for an escalated case', () => {
  const outcome = mapSessionToVerificationOutcome(session('pending_manual_review', {
    workflow_phase: 'escalated',
    ocr_result: { first_name: 'Synthetic' },
    ocr_execution_status: 'provider_succeeded',
  }));
  assert.equal(outcome.status, 'needs_review');
  assert.equal(outcome.needsConfirmation, false);
  assert.match(outcome.processingError || '', /specialist review/);
});

test('an interrupted draft, capture or upload offers an incomplete state', () => {
  for (const status of ['draft', 'captured', 'uploaded'] as const) {
    const outcome = mapSessionToVerificationOutcome(session(status));
    assert.equal(outcome.status, 'incomplete');
    assert.equal(outcome.sessionId, 'session-1');
  }
});

test('requests confirmation only for unconfirmed successful OCR', () => {
  const observed = { first_name: 'Ada' };
  assert.equal(mapSessionToVerificationOutcome(session('pending_manual_review', { ocr_result: observed, ocr_execution_status: 'provider_succeeded' })).needsConfirmation, true);
  assert.equal(mapSessionToVerificationOutcome(session('pending_manual_review', { ocr_result: observed, ocr_execution_status: 'provider_succeeded', ocr_confirmation_completed: true })).needsConfirmation, false);
  assert.equal(mapSessionToVerificationOutcome(session('pending_manual_review', { ocr_result: observed, ocr_execution_status: 'provider_failed' })).needsConfirmation, false);
});

test('maps OCR failure to ocr_failed', () => {
  const outcome = mapSessionToVerificationOutcome(session('ocr_failed'));
  assert.equal(outcome.status, 'ocr_failed');
  assert.match(outcome.processingError || '', /could not complete/);
  assert.equal(outcome.sessionStatus, 'ocr_failed');
});

test('maps rejected backend session to rejected with the reviewer reason', () => {
  const outcome = mapSessionToVerificationOutcome(session('rejected', { applicant_message: 'Document is illegible.' }));
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

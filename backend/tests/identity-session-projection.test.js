import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSession } from '../services/identity/sessionProjection.js';

test('applicant projection excludes internal reviewer data, provider errors and paths', () => {
  const actual = sanitizeSession({
    id: 'case', user_id: 'applicant', status: 'pending_manual_review',
    front_storage_path: 'private/front', ocr_document_id: 'private-document-id', review_notes: 'internal investigation',
    reviewer_identity: 'reviewer', failure_reason: 'secret provider exception',
    identity_binding_status: 'mismatch', extraction_trust_status: 'untrusted',
    ocr_result: { first_name: 'Test', private_note: 'secret', additional_fields: { expiry: '2030', private_note: 'secret' } },
  });
  for (const key of ['review_notes', 'reviewer_identity', 'failure_reason', 'front_storage_path', 'ocr_document_id', 'identity_binding_status', 'extraction_trust_status']) {
    assert.equal(Object.hasOwn(actual, key), false, key);
  }
  assert.deepEqual(actual.ocr_result, { first_name: 'Test', additional_fields: { expiry: '2030' } });
  assert.equal(actual.applicant_message, null);
});

test('only a recorded rejection decision exposes its applicant-facing message', () => {
  const row = { status: 'rejected', review_decision: 'reject', reviewed_by: 'reviewer', failure_reason: 'Please contact support.' };
  assert.equal(sanitizeSession(row).applicant_message, 'Please contact support.');
  assert.equal(sanitizeSession({ ...row, reviewed_by: null }).applicant_message, null);
  assert.equal(sanitizeSession({ ...row, status: 'ocr_failed' }).applicant_message, null);
});

test('passport and licence observations retain only their own schema-specific fields', () => {
  const passport = sanitizeSession({ document_type: 'passport', ocr_result: { first_name: 'Test', additional_fields: { passport_number: 'P123', nationality: 'ZW', expiry: '2030-01-01', licence_classes: 'B', secret: 'private' } } });
  assert.deepEqual(passport.ocr_result.additional_fields, { passport_number: 'P123', nationality: 'ZW', expiry: '2030-01-01' });
  assert.ok(passport.confirmation_fields.some(field => field.name === 'passport_number'));
  const licence = sanitizeSession({ document_type: 'driver_license', ocr_result: { additional_fields: { licence_number: 'L123', licence_classes: 'B', passport_number: 'P123' } } });
  assert.deepEqual(licence.ocr_result.additional_fields, { licence_number: 'L123', licence_classes: 'B' });
});

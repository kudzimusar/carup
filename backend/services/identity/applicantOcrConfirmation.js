import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { DOCUMENT_SCHEMAS, printedLabelsFor } from '../document-intelligence/documentSchemas.js';

const TYPES = Object.freeze({ national_id: 'national_id', passport: 'passport', driver_license: 'drivers_license', drivers_license: 'drivers_license' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identityConfirmationSchema(docType) {
  return Object.hasOwn(TYPES, docType) ? DOCUMENT_SCHEMAS[TYPES[docType]] : null;
}

export function identityConfirmationFields(docType) {
  const schema = identityConfirmationSchema(docType);
  if (!schema) return [];
  return Object.entries(schema.fields).map(([name, spec]) => ({
    name, label: printedLabelsFor(name) || name.replaceAll('_', ' '),
    required: schema.coreFields.includes(name), source: spec.target,
  }));
}

export function validateApplicantFields(docType, value) {
  const schema = identityConfirmationSchema(docType);
  if (!schema) throw new ValidationError('This document type does not support OCR confirmation.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Applicant fields are required.');
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(schema.fields, key) || typeof v !== 'string' || v.length > 160 || /[\u0000-\u001f\u007f]/.test(v)) throw new ValidationError('Invalid applicant field.');
    if (v.trim() && schema.fields[key].normalize(v).value === undefined) throw new ValidationError(`Invalid value for ${key}.`);
  }
  for (const key of schema.coreFields) if (!value[key]?.trim()) throw new ValidationError(`Required field missing: ${key}.`);
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, v.trim()]));
}

export async function confirmApplicantOcr(client, actor, sessionId, payload) {
  const userId = actor?.id || actor?.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  if (!UUID.test(String(payload?.idempotencyKey || '')) || !Number.isSafeInteger(payload?.revision) || payload.revision < 1) throw new ValidationError('A valid revision and idempotency key are required.');
  const query = await client.from('verification_sessions').select('id, user_id, document_type').eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (query.error) throw new Error('Verification service operation failed.');
  if (!query.data) throw new NotFoundError('Verification session not found.');
  const fields = validateApplicantFields(query.data.document_type, payload.fields);
  const response = await client.rpc('confirm_verification_ocr_fields', { p_session_id: sessionId, p_user_id: userId, p_expected_version: payload.revision, p_idempotency_key: payload.idempotencyKey, p_fields: fields });
  if (response.error || !response.data) throw new Error('Verification confirmation is unavailable.');
  if (response.data.code === 'NOT_FOUND') throw new NotFoundError('Verification session not found.');
  if (response.data.code !== 'OK') throw new ConflictError('Verification changed or cannot be confirmed. Refresh and try again.');
  return { id: response.data.id, revision: response.data.version, confirmed_at: response.data.created_at, replayed: response.data.replayed };
}

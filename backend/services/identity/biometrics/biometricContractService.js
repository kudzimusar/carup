import { getVeriffTestTransport, VERIFF_UUID } from './veriffTestTransport.js';
import { CarUpError, ConflictError, NotFoundError, ValidationError } from '../../../utils/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const OPERATIONS = new Set(['state', 'grant', 'withdraw', 'assess']);
const REQUEST_FIELDS = new Set(['requestId', 'revision', 'purposes', 'notice']);
const PURPOSES = new Set(['face_document_match', 'liveness']);

export async function biometricContract(client, actor, sessionId, operation, body = {}) {
  // Until approved consent copy and a provider lifecycle exist, only the
  // isolated test process may write this contract. No request runs inference.
  if (process.env.NODE_ENV !== 'test' || process.env.CARUP_IDV_TEST_BIOMETRIC_CONTRACT !== 'yes') {
    throw new CarUpError('Biometric consent and assessment are unavailable.', 503, 'BIOMETRIC_UNAVAILABLE');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(field => !REQUEST_FIELDS.has(field))) {
    throw new ValidationError('Invalid biometric contract request.');
  }
  const userId = actor?.id || actor?.userId;
  const { requestId, revision, purposes = [], notice } = body || {};
  if (!OPERATIONS.has(operation) || !userId || !UUID.test(sessionId) || !Array.isArray(purposes) || purposes.length > PURPOSES.size
    || purposes.some(purpose => !PURPOSES.has(purpose))
    || (operation !== 'state' && (!UUID.test(requestId || '') || !Number.isSafeInteger(revision) || revision < 1 || revision > 2_147_483_647))) {
    throw new ValidationError('Invalid biometric contract request.');
  }
  const { data, error } = await client.rpc('record_identity_biometric_contract', {
    p_session: sessionId, p_user: userId, p_operation: operation, p_request: requestId || null,
    p_revision: revision || null, p_purposes: purposes, p_notice: typeof notice === 'string' ? notice : null,
  });
  if (error || !data) throw new CarUpError('Biometric consent and assessment are unavailable.', 503, 'BIOMETRIC_UNAVAILABLE');
  if (data.code === 'NOT_FOUND') throw new NotFoundError('Verification session not found.');
  if (data.code === 'INVALID') throw new ValidationError('Invalid biometric contract request.');
  if (data.code !== 'OK') throw new ConflictError('Biometric contract cannot proceed. Refresh the verification case.');
  const { code, ...response } = data;
  return response;
}

function veriffUnavailable() {
  return new CarUpError('The Veriff test integration is unavailable.', 503, 'VERIFF_TEST_UNAVAILABLE');
}

async function veriffRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error || !data) throw veriffUnavailable();
  if (data.code === 'NOT_FOUND') throw new NotFoundError('Verification test attempt not found.');
  if (data.code === 'CONFLICT') throw new ConflictError('Verification test attempt cannot proceed. Refresh the case.');
  if (data.code === 'INVALID') throw new ValidationError('Invalid Veriff test metadata.');
  return data;
}

async function saveTestDecision(client, event) {
  if (!event) return { code: 'IGNORED' };
  return veriffRpc(client, 'record_identity_veriff_test_decision', {
    p_binding: event.binding, p_provider_session: event.providerSession, p_provider_attempt: event.providerAttempt,
    p_status: event.status, p_decision_at: event.decisionAt,
  });
}

export async function recordVeriffTestWebhook(client, rawBody, integrationKey, signature) {
  const event = getVeriffTestTransport().receive(rawBody, integrationKey, signature);
  const result = await saveTestDecision(client, event);
  return result.code.toLowerCase();
}

export async function veriffTestAttempt(client, actor, sessionId, requestId, operation, body) {
  const transport = getVeriffTestTransport();
  const userId = actor?.id || actor?.userId;
  if (!userId || !VERIFF_UUID.test(sessionId) || !VERIFF_UUID.test(requestId)) {
    throw new ValidationError('Invalid Veriff test request.');
  }
  const starting = operation === 'start';
  const { revision, purpose } = body ?? {};
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  if (starting
    ? (!keys || keys.length !== 3 || !keys.every(key => ['requestId', 'revision', 'purpose'].includes(key)) ||
        !Number.isSafeInteger(revision) || revision < 1 || revision > 2_147_483_647 || !PURPOSES.has(purpose))
    : (operation !== 'recover' || (body !== undefined && (!keys || keys.length > 0)))) {
    throw new ValidationError('Invalid Veriff test request.');
  }

  const registration = (action, providerSession = null) => veriffRpc(client, 'identity_veriff_test_registration', {
    p_session: sessionId, p_user: userId, p_request: requestId, p_operation: action,
    p_revision: starting ? revision : null, p_purpose: starting ? purpose : null, p_provider_session: providerSession,
  });
  let record = await registration(starting ? 'start' : 'read');
  if (record.registered) {
    // An ambiguous provider create is never retried with the same binding.
    record = await registration('bind', await transport.create(record.binding));
  } else if (!starting && record.provider_session && !['approved', 'declined', 'expired', 'abandoned'].includes(record.decision_status)) {
    const event = await transport.lookup(record.provider_session);
    if (event && (event.providerSession !== record.provider_session || event.binding !== record.binding)) {
      throw veriffUnavailable();
    }
    await saveTestDecision(client, event);
    record = await registration('read');
  }
  return {
    request_id: requestId, purpose: record.purpose, expires_at: record.expires_at,
    state: record.decision_status ? 'veriff_test_simulated' : record.provider_session ? 'awaiting_test_decision' : 'registration_pending',
    test_decision: record.decision_status ?? null, provenance: 'TEST_SIMULATED',
    face_match: 'not_run', liveness: 'not_run',
  };
}

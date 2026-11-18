import { CarUpError, ConflictError, NotFoundError, ValidationError } from '../../../utils/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const OPERATIONS = new Set(['state', 'grant', 'withdraw', 'assess']);
const PURPOSES = new Set(['face_document_match', 'liveness']);

export async function biometricContract(client, actor, sessionId, operation, body = {}) {
  // Until approved consent copy and a provider lifecycle exist, only the
  // isolated test process may write this contract. No request runs inference.
  if (process.env.NODE_ENV !== 'test' || process.env.CARUP_IDV_TEST_BIOMETRIC_CONTRACT !== 'yes') {
    throw new CarUpError('Biometric consent and assessment are unavailable.', 503, 'BIOMETRIC_UNAVAILABLE');
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

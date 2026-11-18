import { createHash, randomBytes } from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { verifyPassword } from '../../utils/passwordAuth.js';
import { CarUpError, ForbiddenError, ValidationError } from '../../utils/errors.js';

const ttlSeconds = 120;
const roles = new Set(['admin', 'platform_admin', 'super_admin']);
const operations = new Set([
  'case:detail', 'preview:front', 'preview:back', 'preview:selfie',
  'decision:approve', 'decision:reject', 'decision:request_resubmission',
  'decision:escalate', 'decision:add_internal_note',
]);
const aliases = { request_retry: 'request_resubmission', add_review_notes: 'add_internal_note', internal_note: 'add_internal_note' };
const digest = value => createHash('sha256').update(value).digest('hex');

export function reviewerDecisionOperation(body = {}) {
  const action = String(body.action || body.decision || '').trim().toLowerCase();
  return 'decision:' + (Object.hasOwn(aliases, action) ? aliases[action] : action);
}

function assertReviewer(actor) {
  if (actor?.authenticationMethod !== 'session' || !actor.authenticatedSessionId
      || !actor.userId || !roles.has(actor.platformRole) || !roles.has(actor.role)) {
    throw new ForbiddenError('An authenticated platform reviewer is required.');
  }
}

function unavailable() {
  return new CarUpError('Reviewer credential verification is unavailable.', 503, 'REVIEWER_STEP_UP_UNAVAILABLE');
}

export async function issueReviewerStepUp(actor, caseId, body = {}, client = supabase) {
  assertReviewer(actor);
  const { operation, password } = body;
  if (!operations.has(operation)) throw new ValidationError('Unsupported reviewer operation.');
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    throw new ForbiddenError('Enter your current account password.');
  }
  const { data: user, error: userError } = await client.from('users')
    .select('role, password_hash').eq('id', actor.userId).maybeSingle();
  if (userError) throw unavailable();
  if (!roles.has(user?.role) || !await verifyPassword(password, user?.password_hash)) {
    throw new ForbiddenError('Reviewer credential verification failed.');
  }
  const { data: record, error: caseError } = await client.from('verification_sessions')
    .select('user_id').eq('id', caseId).maybeSingle();
  if (caseError) throw unavailable();
  if (!record || String(record.user_id) === String(actor.userId)) {
    throw new ForbiddenError('This case cannot be reviewed by this account.');
  }
  const proof = randomBytes(32).toString('hex');
  const { error } = await client.from('identity_review_step_up').upsert({
    reviewer_id: actor.userId,
    auth_session_id: String(actor.authenticatedSessionId),
    case_id: caseId,
    operation,
    proof_digest: digest(proof),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    consumed_at: null,
  }, { onConflict: 'reviewer_id' });
  if (error) throw unavailable();
  return { proof, expiresInSeconds: ttlSeconds };
}

export async function consumeReviewerStepUp(actor, caseId, operation, proof, client = supabase) {
  assertReviewer(actor);
  if (!operations.has(operation)) throw new ValidationError('Unsupported reviewer operation.');
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) {
    throw new ForbiddenError('Recent reviewer credential verification is required.');
  }
  const { data, error } = await client.rpc('consume_identity_review_step_up', {
    p_reviewer_id: actor.userId,
    p_auth_session_id: String(actor.authenticatedSessionId),
    p_case_id: caseId,
    p_operation: operation,
    p_proof_digest: digest(proof),
  });
  if (error) throw unavailable();
  if (data !== true) throw new ForbiddenError('Reviewer verification expired or does not match this operation.');
}

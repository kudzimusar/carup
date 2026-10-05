/**
 * OC-5C — the verification-approval → identity-lifecycle hook is never silent.
 *
 * #208 called onVerificationApproved(...).catch(console.warn): an identity-history write whose failure
 * nobody would ever see. The approval itself is immutable history either way, so the hook cannot fail
 * the decision — but its outcome is now part of the decision's own answer:
 *   recorded        the lifecycle moved (verified / recovered)
 *   refused         a policy refusal (a revoked identity; evidence older than a restriction)
 *   failed          the lifecycle could not be written — logged as an error, lifecycle_recorded false
 *   not_applicable  not an approval
 * In every case the decision is durable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { VerificationDecisionRecorder } = await import('../services/identity/decisionRecorder.js');
const { DECISION_ACTION, WORKFLOW_PHASE } = await import('../services/identity/caseWorkflow.js');

const session = (overrides = {}) => ({
  id: 'vs-subject', version: 1, user_id: 'subject-1', status: 'pending_manual_review',
  workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED, document_type: 'national_id', double_sided: false,
  front_storage_path: 'path/front.jpg', ocr_result: { first_name: 'A', last_name: 'B' }, confidence_score: 0.5,
  created_at: '2026-10-04T10:00:00.000Z', updated_at: '2026-10-04T10:00:00.000Z', ...overrides,
});

function world(lifecycle = []) {
  return createSupabaseWorld({
    users: [{ id: 'subject-1', role: 'owner' }, { id: 'admin-1', role: 'admin' }],
    verification_sessions: [session()],
    verification_decisions: [],
    trust_audit_events: [],
    identity_lifecycle_events: lifecycle,
  });
}

const decide = (client, action = DECISION_ACTION.APPROVE, extra = {}) => VerificationDecisionRecorder.recordDecision(client, {
  session: session(), action, reasonCode: null, internalNote: null, applicantMessage: null,
  reviewerId: 'admin-1', reviewerRole: 'admin', currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED, req: null, ...extra,
});

test('a FIRST approval is the lifecycle already: verified from that very approval — reported unchanged, never a false refusal', async () => {
  // The recorder marks the session verified before it calls the hook, so the lifecycle derives
  // 'verified' from that history and there is nothing to append. #208 reported this as a refusal.
  const w = world();
  const result = await decide(w.client);
  assert.equal(result.decision.lifecycle_outcome, 'unchanged');
  assert.equal(result.decision.lifecycle_recorded, true);
  assert.equal(w.rows('identity_lifecycle_events').length, 0, 'nothing appended — the history already says verified');
  const { getCurrentIdentityLifecycle } = await import('../services/identity/identityLifecycleService.js');
  const current = await getCurrentIdentityLifecycle(w.client, 'subject-1');
  assert.deepEqual([current.state, current.historically_approved, current.capability_bearing], ['verified', true, true]);
});

test('an approval of evidence filed AFTER a reverification requirement moves the lifecycle — recorded, evidence named', async () => {
  const w = world([{ id: 'le-1', seq: 1, user_id: 'subject-1', previous_state: 'verified', next_state: 'reverification_required', reason_code: 'MATERIAL_IDENTITY_CHANGE',
    trigger_source: 'reviewer_action', actor_kind: 'user', actor_user_id: 'admin-2', policy_version: 'identity_lifecycle.v1', created_at: '2026-10-04T09:00:00.000Z' }]);
  const result = await decide(w.client);
  assert.equal(result.decision.lifecycle_outcome, 'recorded');
  assert.equal(result.decision.lifecycle_recorded, true);
  const event = w.rows('identity_lifecycle_events').find((e) => e.trigger_source === 'verification_approved');
  assert.equal(event.next_state, 'verified');
  assert.equal(event.evidence_reference, 'vs-subject');
});

test('an approval landing on a REVOKED identity is a recorded refusal — the decision stands, the lifecycle does not move', async () => {
  const w = world([{ id: 'le-1', seq: 1, user_id: 'subject-1', previous_state: 'verified', next_state: 'revoked', reason_code: 'GOVERNANCE_REVOCATION',
    trigger_source: 'reviewer_action', actor_kind: 'user', actor_user_id: 'admin-2', policy_version: 'identity_lifecycle.v1', created_at: '2026-10-04T09:00:00.000Z' }]);
  const result = await decide(w.client);
  assert.equal(result.decision.action, 'approve', 'the decision is durable');
  assert.equal(w.rows('verification_decisions').length, 1);
  assert.equal(result.decision.lifecycle_outcome, 'refused');
  assert.equal(result.decision.lifecycle_recorded, false);
  assert.equal(w.rows('identity_lifecycle_events').length, 1, 'no resurrection');
});

test('a lifecycle store that cannot be written is a FAILED outcome the decision reports — never silent, never a failed decision', async () => {
  const w = world();
  const client = {
    ...w.client,
    from: (table) => (table === 'identity_lifecycle_events'
      ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'relation "identity_lifecycle_events" does not exist' } }) }) }
      : w.client.from(table)),
  };
  const result = await decide(client);
  assert.equal(result.decision.action, 'approve');
  assert.equal(w.rows('verification_decisions').length, 1, 'the decision is durable');
  assert.equal(result.decision.lifecycle_outcome, 'failed');
  assert.equal(result.decision.lifecycle_recorded, false);
});

test('a decision that is not an approval does not touch the lifecycle', async () => {
  const w = world();
  const result = await decide(w.client, DECISION_ACTION.REJECT, { reasonCode: 'DOCUMENT_NOT_VISIBLE', applicantMessage: 'Please retake.' });
  assert.equal(result.decision.lifecycle_outcome, 'not_applicable');
  assert.equal(w.rows('identity_lifecycle_events').length, 0);
});

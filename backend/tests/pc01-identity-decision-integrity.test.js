/**
 * PC01-F F1 — a reviewer action can never relax a blocking reason the SYSTEM assigned.
 *
 * Found on #222 by the PC01-F semantic review and re-proved in source and on live staging (6 cases in
 * this exact state, none exploited): the identity approve gate reads the case's primary reason, and
 * VerificationDecisionRecorder used to write a reviewer's reason code over it on EVERY action, with
 * no validation for escalations and notes. A submission the classifier refused as a non-document
 * (DOCUMENT_NOT_VISIBLE — not approvable) could therefore be escalated with OTHER (approvable) and
 * then approved. That violates the Product Owner's ruling §12D: "NON_DOCUMENT → blocked even if text
 * was extracted" (invariant 4) and "fraud, tampering and hard biometric blockers remain blockers"
 * (invariant 9).
 *
 * The rule now: resubmission and rejection assign the reason (as before); an escalation or a note may
 * tighten a reason but never replace a blocking evidence fact with an approvable one; the reviewer's
 * own code is always kept on the immutable decision row; the reviewer's OWN marker
 * (SPECIALIST_REVIEW_REQUIRED) can still be lifted, so specialist resolution is unchanged; and an
 * unknown reason code is refused instead of silently becoming OTHER.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { VerificationDecisionRecorder } = await import('../services/identity/decisionRecorder.js');
const { DECISION_ACTION, WORKFLOW_PHASE } = await import('../services/identity/caseWorkflow.js');
const { REASON_CODES } = await import('../services/identity/reasonCodes.js');

const baseSession = (overrides = {}) => ({
  id: 'vs-f1', version: 1, user_id: 'subject-1', status: 'pending_manual_review',
  workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED, document_type: 'national_id', double_sided: false,
  front_storage_path: 'path/front.jpg', ocr_result: null, confidence_score: null,
  primary_reason_code: null, evidence_classification: null,
  created_at: '2026-10-10T08:00:00.000Z', updated_at: '2026-10-10T08:00:00.000Z', ...overrides,
});

function world(session) {
  return createSupabaseWorld({
    users: [{ id: 'subject-1', role: 'owner' }, { id: 'admin-1', role: 'admin' }],
    verification_sessions: [session],
    verification_decisions: [],
    trust_audit_events: [],
    identity_lifecycle_events: [],
  });
}

const current = (w) => w.rows('verification_sessions')[0];

function decide(w, action, reasonCode = null, extra = {}) {
  const s = current(w);
  return VerificationDecisionRecorder.recordDecision(w.client, {
    session: s, action, reasonCode, internalNote: extra.internalNote ?? null, applicantMessage: extra.applicantMessage ?? null,
    reviewerId: 'admin-1', reviewerRole: 'admin', currentWorkflowPhase: s.workflow_phase, req: null,
  });
}

// ── the exploit chain itself ────────────────────────────────────────────────────────────────────
test('F1: a classified non-document escalated with OTHER keeps its blocking reason — and approval is refused', async () => {
  const w = world(baseSession({ primary_reason_code: 'DOCUMENT_NOT_VISIBLE' }));
  await decide(w, DECISION_ACTION.ESCALATE, 'OTHER');
  assert.equal(current(w).workflow_phase, WORKFLOW_PHASE.ESCALATED, 'the escalation itself still happens');
  assert.equal(current(w).primary_reason_code, 'DOCUMENT_NOT_VISIBLE', 'the system-assigned blocker survives');
  assert.equal(w.rows('verification_decisions')[0].reason_code, 'OTHER', "the reviewer's own code is kept on the decision row");
  await assert.rejects(() => decide(w, DECISION_ACTION.APPROVE), /not allowed/i);
  assert.notEqual(current(w).status, 'verified');
  assert.equal(w.rows('verification_decisions').length, 1, 'no approval was recorded');
});

test('F1: an internal note with OTHER cannot relax the blocker either — approval still refused', async () => {
  const w = world(baseSession({ primary_reason_code: 'NON_DOCUMENT' }));
  await decide(w, DECISION_ACTION.ADD_INTERNAL_NOTE, 'OTHER', { internalNote: 'looks fine to me' });
  assert.equal(current(w).primary_reason_code, 'NON_DOCUMENT');
  await assert.rejects(() => decide(w, DECISION_ACTION.APPROVE), /not allowed/i);
});

// ── every system-assigned blocking category holds ───────────────────────────────────────────────
test('F1: no evidence/quality/document/extraction/identity/system/fraud/biometric blocker can be relaxed by a reviewer action', async () => {
  const approvable = Object.values(REASON_CODES).filter((r) => r.approveAllowed === true).map((r) => r.code);
  const systemBlockers = Object.values(REASON_CODES).filter((r) => r.approveAllowed === false && r.category !== 'escalation').map((r) => r.code);
  assert.ok(systemBlockers.length >= 20, 'the catalogue still holds its blockers');
  for (const blocker of systemBlockers) {
    for (const relaxing of approvable) {
      for (const action of [DECISION_ACTION.ESCALATE, DECISION_ACTION.ADD_INTERNAL_NOTE, DECISION_ACTION.APPROVE]) {
        assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(action, blocker, relaxing), false, `${action}: ${blocker} → ${relaxing}`);
      }
    }
  }
});

// ── what still works ────────────────────────────────────────────────────────────────────────────
test('F1: a reviewer may TIGHTEN — escalating a clean case for suspected fraud blocks approval', async () => {
  const w = world(baseSession({ primary_reason_code: null }));
  await decide(w, DECISION_ACTION.ESCALATE, 'SUSPECTED_FRAUD');
  assert.equal(current(w).primary_reason_code, 'SUSPECTED_FRAUD');
  await assert.rejects(() => decide(w, DECISION_ACTION.APPROVE), /not allowed/i);
});

test('F1: the specialist path is unchanged — a SPECIALIST_REVIEW_REQUIRED escalation can be lifted by a note, then approved', async () => {
  const w = world(baseSession({ primary_reason_code: null }));
  await decide(w, DECISION_ACTION.ESCALATE, 'SPECIALIST_REVIEW_REQUIRED');
  assert.equal(current(w).primary_reason_code, 'SPECIALIST_REVIEW_REQUIRED');
  await assert.rejects(() => decide(w, DECISION_ACTION.APPROVE), /not allowed/i, 'blocked while the marker stands');
  await decide(w, DECISION_ACTION.ADD_INTERNAL_NOTE, 'OTHER', { internalNote: 'specialist reviewed: genuine' });
  assert.equal(current(w).primary_reason_code, 'OTHER', 'the reviewer’s own marker is lifted');
  const result = await decide(w, DECISION_ACTION.APPROVE);
  assert.equal(result.decision.action, 'approve');
});

test('F1: resubmission and rejection still assign the reason they carry', () => {
  for (const action of [DECISION_ACTION.REQUEST_RESUBMISSION, DECISION_ACTION.REJECT]) {
    assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(action, 'DOCUMENT_NOT_VISIBLE', 'BLURRY'), true, action);
    assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(action, null, 'NON_DOCUMENT'), true, action);
  }
  assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(DECISION_ACTION.ESCALATE, null, 'OTHER'), true, 'an empty reason can take any code');
  assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(DECISION_ACTION.ESCALATE, 'OTHER', 'SUSPECTED_FRAUD'), true, 'approvable → blocking is tightening');
  assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(DECISION_ACTION.ESCALATE, 'BLURRY', 'SUSPECTED_FRAUD'), true, 'blocking → blocking stays blocked');
  assert.equal(VerificationDecisionRecorder.mayChangePrimaryReason(DECISION_ACTION.ESCALATE, 'BLURRY', null), false, 'no code, no change');
});

// ── unknown codes ───────────────────────────────────────────────────────────────────────────────
test('F1: an unknown reason code is refused on every action instead of silently becoming OTHER', async () => {
  for (const action of [DECISION_ACTION.ESCALATE, DECISION_ACTION.ADD_INTERNAL_NOTE, DECISION_ACTION.REJECT, DECISION_ACTION.REQUEST_RESUBMISSION]) {
    const w = world(baseSession({ primary_reason_code: 'DOCUMENT_NOT_VISIBLE' }));
    await assert.rejects(() => decide(w, action, 'TOTALLY_MADE_UP', { applicantMessage: 'retake' }), /Unknown reason code/, action);
    assert.equal(current(w).primary_reason_code, 'DOCUMENT_NOT_VISIBLE', action + ' left the case untouched');
    assert.equal(w.rows('verification_decisions').length, 0, action + ' recorded nothing');
  }
});

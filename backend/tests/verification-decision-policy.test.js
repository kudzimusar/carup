/**
 * Phase 7C — Decision policy engine tests.
 *
 * Exercises DecisionPolicyEngine rules, reason code validation, state
 * transitions, and the VerificationDecisionRecorder persistence path with
 * a mock supabase client.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { DecisionPolicyEngine } = await import('../services/identity/decisionPolicy.js');
const { VerificationDecisionRecorder } = await import('../services/identity/decisionRecorder.js');
import { ConflictError } from '../utils/errors.js';

const {
  DECISION_ACTION,
  WORKFLOW_PHASE,
  EVIDENCE_CLASSIFICATION,
  EXTRACTION_TRUST_STATUS,
  IDENTITY_BINDING_STATUS,
  FINAL_DISPOSITION,
  LEGACY_REVIEWABLE_STATUSES,
  decisionToLegacyStatus,
  decisionToPhase,
  decisionToDisposition,
} = await import('../services/identity/caseWorkflow.js');

// ---------------------------------------------------------------------------
// Helper — build an assessment from a partial descriptor
// ---------------------------------------------------------------------------
function assessment(overrides = {}) {
  return {
    workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    evidence_classification: EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT,
    extraction_trust_status: EXTRACTION_TRUST_STATUS.PARTIALLY_TRUSTED,
    identity_binding_status: IDENTITY_BINDING_STATUS.MATCH,
    primary_reason_code: null,
    risk_level: 'info',
    final_disposition: FINAL_DISPOSITION.NONE,
    selfie_check_status: 'not_submitted',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. NON_DOCUMENT forbids approve
// ---------------------------------------------------------------------------
test('NON_DOCUMENT classification forbids approve', () => {
  const a = assessment({ evidence_classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /No valid identity document detected/);
});

// ---------------------------------------------------------------------------
// 2. NON_DOCUMENT allows request_resubmission
// ---------------------------------------------------------------------------
test('NON_DOCUMENT allows request_resubmission', () => {
  const a = assessment({ evidence_classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.REQUEST_RESUBMISSION, a);
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// 3. NON_DOCUMENT allows escalation
// ---------------------------------------------------------------------------
test('NON_DOCUMENT allows escalation', () => {
  const a = assessment({ evidence_classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.ESCALATE, a);
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// 4. UNTRUSTED extraction forbids approve
// ---------------------------------------------------------------------------
test('UNTRUSTED extraction with reason code forbids approve', () => {
  const a = assessment({
    extraction_trust_status: EXTRACTION_TRUST_STATUS.UNTRUSTED,
    primary_reason_code: 'OCR_RESULT_UNTRUSTED',
  });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Approval is not permitted when the primary reason/);
});

// ---------------------------------------------------------------------------
// 5. ACCOUNT_DOCUMENT_MISMATCH forbids normal approval
// ---------------------------------------------------------------------------
test('ACCOUNT_DOCUMENT_MISMATCH forbids approve', () => {
  const a = assessment({
    identity_binding_status: IDENTITY_BINDING_STATUS.MISMATCH,
  });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /names do not match/);
});

// ---------------------------------------------------------------------------
// 6. valid document + trusted extraction + matching identity allows approve
// ---------------------------------------------------------------------------
test('valid document + partially trusted extraction + match allows approve', () => {
  const a = assessment();
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

// ---------------------------------------------------------------------------
// 7. internal note does not change workflow phase
// ---------------------------------------------------------------------------
test('ADD_INTERNAL_NOTE phase is null (no phase change)', () => {
  const phase = decisionToPhase(DECISION_ACTION.ADD_INTERNAL_NOTE);
  assert.equal(phase, null);
});

// ---------------------------------------------------------------------------
// 8. request_resubmission maps legacy status to retry_requested
// ---------------------------------------------------------------------------
test('request_resubmission maps legacy status to retry_requested', () => {
  const legacy = decisionToLegacyStatus(DECISION_ACTION.REQUEST_RESUBMISSION, 'pending_manual_review');
  assert.equal(legacy, 'retry_requested');
});

// ---------------------------------------------------------------------------
// 9. request_resubmission persists applicant message
// 10. request_resubmission persists reason code
// 11. request_resubmission creates an audit event
// ---------------------------------------------------------------------------
test('request_resubmission persists reason code, applicant message, and audit event', async () => {
  const decisions = [];
  const auditEvents = [];
  const sessions = [{
    id: 'vs-resub',
    version: 1,
    user_id: 'owner-1',
    status: 'pending_manual_review',
    workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    document_type: 'national_id',
    double_sided: true,
    front_storage_path: 'path/front.jpg',
    ocr_result: { first_name: 'Test', last_name: 'User' },
    confidence_score: 0.5,
    failure_reason: null,
    review_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    review_decision: null,
    retry_reason: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }];

  const client = makeMockClient({ decisions, auditEvents, sessions });

  const result = await VerificationDecisionRecorder.recordDecision(client, {
    session: sessions[0],
    action: DECISION_ACTION.REQUEST_RESUBMISSION,
    reasonCode: 'DOCUMENT_NOT_VISIBLE',
    internalNote: 'Blurry image',
    applicantMessage: 'Please retake with better lighting.',
    reviewerId: 'admin-1',
    reviewerRole: 'admin',
    currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    req: null,
  });

  // 9 — applicant message persisted in decision record
  assert.equal(result.decision.applicant_message, 'Please retake with better lighting.');

  // 10 — reason code persisted
  assert.equal(result.decision.reason_code, 'DOCUMENT_NOT_VISIBLE');

  // legacy fields populated
  assert.equal(result.session.retry_reason, 'Please retake with better lighting.');
  assert.equal(result.session.review_decision, 'request_retry');
  assert.equal(result.session.status, 'retry_requested');

  // 11 — audit event created
  assert.ok(auditEvents.some(e => e.event_type === 'VERIFICATION_REVIEW_RETRY_REQUESTED'));
});

// ---------------------------------------------------------------------------
// 12. reject requires a structured reason code
// ---------------------------------------------------------------------------
test('reject without reason code throws ValidationError', async () => {
  const sessions = [{
    id: 'vs-reject',
    version: 1,
    user_id: 'owner-1',
    status: 'pending_manual_review',
    workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    document_type: 'national_id',
    double_sided: false,
    front_storage_path: 'path/front.jpg',
    ocr_result: { first_name: 'T', last_name: 'U' },
    confidence_score: 0.5,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }];

  const client = makeMockClient({ decisions: [], auditEvents: [], sessions });

  await assert.rejects(
    () => VerificationDecisionRecorder.recordDecision(client, {
      session: sessions[0],
      action: DECISION_ACTION.REJECT,
      reasonCode: null,
      internalNote: null,
      applicantMessage: null,
      reviewerId: 'admin-1',
      reviewerRole: 'admin',
      currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
      req: null,
    }),
    /A reason code is required/,
  );
});

// ---------------------------------------------------------------------------
// 13. prohibited action returns current state, allowed actions, recommended action
// ---------------------------------------------------------------------------
test('prohibited approve on NON_DOCUMENT returns contextual error info', () => {
  const a = assessment({ evidence_classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);

  assert.equal(result.allowed, false);
  assert.match(result.reason, /No valid identity document detected/);
  assert.equal(result.recommendedAction, DECISION_ACTION.REQUEST_RESUBMISSION);
});

// ---------------------------------------------------------------------------
// 14. duplicate idempotency key creates one decision only
// ---------------------------------------------------------------------------
test('duplicate x-idempotency-key returns existing decision without side effects', async () => {
  const decisions = [];
  const auditEvents = [];

  function freshSession() {
    return {
      id: 'vs-idem',
      version: 1,
      user_id: 'owner-1',
      status: 'pending_manual_review',
      workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
      document_type: 'national_id',
      double_sided: false,
      front_storage_path: 'path/front.jpg',
      ocr_result: { first_name: 'A', last_name: 'B' },
      confidence_score: 0.5,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      // fields set by decision recorder
      status: undefined,
      review_decision: undefined,
      workflow_phase: undefined,
      final_disposition: undefined,
      primary_reason_code: undefined,
      reviewed_by: undefined,
      reviewed_at: undefined,
      failure_reason: undefined,
      review_notes: undefined,
      retry_reason: undefined,
    };
  }

  const client = makeMockClient({ decisions, auditEvents, sessions: [freshSession()] });

  // First call — should succeed
  const first = await VerificationDecisionRecorder.recordDecision(client, {
    session: freshSession(),
    action: DECISION_ACTION.REJECT,
    reasonCode: 'NON_DOCUMENT',
    internalNote: null,
    applicantMessage: 'Document not acceptable.',
    reviewerId: 'admin-1',
    reviewerRole: 'admin',
    currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    req: { headers: { 'x-idempotency-key': 'idem-1' } },
  });

  assert.equal(first.decision.reason_code, 'NON_DOCUMENT');
  assert.equal(decisions.length, 1);

  // Second call with same key — should return existing without creating duplicate
  const second = await VerificationDecisionRecorder.recordDecision(client, {
    session: freshSession(),
    action: DECISION_ACTION.REJECT,
    reasonCode: 'NON_DOCUMENT',
    internalNote: null,
    applicantMessage: 'Document not acceptable.',
    reviewerId: 'admin-1',
    reviewerRole: 'admin',
    currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    req: { headers: { 'x-idempotency-key': 'idem-1' } },
  });

  assert.equal(second.idempotent_replay, true);
  assert.equal(decisions.length, 1); // still only one decision row
});

// ---------------------------------------------------------------------------
// 15. stale session version returns 409
// ---------------------------------------------------------------------------
test('stale session version returns 409 Conflict', async () => {
  const decisions = [];
  const auditEvents = [];

  function makeSession(version) {
    return {
      id: 'vs-stale',
      version,
      user_id: 'owner-1',
      status: 'pending_manual_review',
      workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
      document_type: 'national_id',
      double_sided: false,
      front_storage_path: 'path/front.jpg',
      ocr_result: { first_name: 'A', last_name: 'B' },
      confidence_score: 0.5,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    };
  }

  // Row in the mock DB — starts at version 1
  const dbRow = makeSession(1);
  const sessions = [dbRow];

  const client = makeMockClient({ decisions, auditEvents, sessions });

  // First call with version 1 — succeeds and bumps row to version 2
  const first = await VerificationDecisionRecorder.recordDecision(client, {
    session: dbRow,
    action: DECISION_ACTION.APPROVE,
    reasonCode: null,
    internalNote: null,
    applicantMessage: null,
    reviewerId: 'admin-1',
    reviewerRole: 'admin',
    currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
    req: null,
  });
  assert.equal(first.decision.action, DECISION_ACTION.APPROVE);
  assert.equal(decisions.length, 1);

  // Second call with stale session (version 1) — should throw ConflictError
  const staleSession = makeSession(1); // still version 1 (stale)
  await assert.rejects(
    () => VerificationDecisionRecorder.recordDecision(client, {
      session: staleSession,
      action: DECISION_ACTION.APPROVE,
      reasonCode: null,
      internalNote: null,
      applicantMessage: null,
      reviewerId: 'admin-1',
      reviewerRole: 'admin',
      currentWorkflowPhase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
      req: null,
    }),
    (err) => {
      assert.ok(err instanceof ConflictError, `Expected ConflictError, got ${err.constructor.name}`);
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /stale/);
      return true;
    },
  );

  // Only one decision was created (first call only)
  assert.equal(decisions.length, 1);
});

// ---------------------------------------------------------------------------
// 16. provider_succeeded does not imply extraction_trusted
// ---------------------------------------------------------------------------
test('provider_succeeded does not imply extraction_trusted', () => {
  const a = assessment({
    ocr_execution_status: 'provider_succeeded',
    extraction_trust_status: EXTRACTION_TRUST_STATUS.UNTRUSTED,
    primary_reason_code: 'OCR_RESULT_UNTRUSTED',
  });
  const approveResult = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(approveResult.allowed, false);

  const resubmitResult = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.REQUEST_RESUBMISSION, a);
  assert.equal(resubmitResult.allowed, true);
});

// ---------------------------------------------------------------------------
// 17. identity binding is not_assessable when there is no valid document
// ---------------------------------------------------------------------------
test('identity binding is not_assessable when no valid document', () => {
  const a = assessment({
    evidence_classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT,
    identity_binding_status: IDENTITY_BINDING_STATUS.NOT_ASSESSABLE,
  });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /No valid identity document detected/);
});

// ---------------------------------------------------------------------------
// Additional: Reason code policy flags
// ---------------------------------------------------------------------------
test('SUSPECTED_FRAUD reason code disallows resubmission and blocks approve', async () => {
  const { getReasonConfig } = await import('../services/identity/reasonCodes.js');
  const cfg = getReasonConfig('SUSPECTED_FRAUD');
  assert.equal(cfg.approveAllowed, false);
  assert.equal(cfg.resubmissionAllowed, false);
  assert.equal(cfg.rejectionTerminal, true);

  const a = assessment({ primary_reason_code: 'SUSPECTED_FRAUD' });
  const approveResult = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(approveResult.allowed, false);

  const resubmitResult = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.REQUEST_RESUBMISSION, a);
  assert.equal(resubmitResult.allowed, false);
  assert.match(resubmitResult.reason, /Resubmission is not permitted/);
});

// ---------------------------------------------------------------------------
// Additional: Approve on already-resolved cases
// ---------------------------------------------------------------------------
test('approve on already-approved case is forbidden', () => {
  const a = assessment({ workflow_phase: WORKFLOW_PHASE.RESOLVED_APPROVED });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /already resolved/);
});

test('approve on already-rejected case is forbidden', () => {
  const a = assessment({ workflow_phase: WORKFLOW_PHASE.RESOLVED_REJECTED });
  const result = DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, a);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /already resolved/);
});

// ---------------------------------------------------------------------------
// Helper — mock supabase client
// ---------------------------------------------------------------------------
function makeMockClient({ decisions, auditEvents, sessions }) {
  return {
    sequence: 0,
    data: {
      verification_sessions: sessions,
      verification_decisions: decisions,
      trust_audit_events: auditEvents,
      organization_audit_logs: [],
    },
    from(table) {
      return new MockQuery(this, table);
    },
  };
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
    this.orderKey = null;
    this.orderAsc = true;
  }
  select() { return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  order(key, opts = {}) { this.orderKey = key; this.orderAsc = opts.ascending !== false; return this; }
  single() { return this.execute('single'); }
  maybeSingle() { return this.execute('maybeSingle'); }
  then(resolve, reject) { this.execute('list').then(resolve, reject); }

  matches(row) { return this.filters.every(f => row[f.key] === f.value); }
  rows() { return (this.client.data[this.table] ||= []); }

  async execute(mode) {
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map(r => ({ id: r.id || `row-${++this.client.sequence}`, ...JSON.parse(JSON.stringify(r)) }));

      // Simulate unique constraint on idempotency_key for verification_decisions
      if (this.table === 'verification_decisions') {
        const key = inserted[0].idempotency_key;
        if (key && this.rows().some(r => r.idempotency_key === key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }

      this.rows().push(...inserted);
      return mode === 'single'
        ? { data: JSON.parse(JSON.stringify(inserted[0])), error: null }
        : { data: JSON.parse(JSON.stringify(inserted)), error: null };
    }

    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) {
          Object.assign(row, JSON.parse(JSON.stringify(this.payload)));
          updated.push(JSON.parse(JSON.stringify(row)));
        }
      }
      if (mode === 'single') {
        return { data: updated[0] || null, error: updated.length ? null : { message: 'No rows updated' } };
      }
      if (mode === 'maybeSingle') return { data: updated[0] || null, error: null };
      return { data: updated, error: null };
    }

    let rows = this.rows().filter(r => this.matches(r)).map(r => JSON.parse(JSON.stringify(r)));
    if (this.orderKey) {
      rows.sort((a, b) => {
        const av = a[this.orderKey];
        const bv = b[this.orderKey];
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (this.orderAsc ? 1 : -1);
      });
    }
    if (mode === 'single') return { data: rows[0] || null, error: rows.length ? null : { message: 'No rows found' } };
    if (mode === 'maybeSingle') return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
}

/**
 * Milestone 5 — governance + dispute workflow tests (master plan §11.8).
 *
 * Service-level proofs over a table-aware in-memory Supabase mock:
 *   - unauthorized roles cannot apply decisions or raise disputes
 *   - every decision creates a review_decisions row AND a trust_audit_events row
 *   - applyDecision NEVER changes a trust score (no trust_change_log write)
 *   - trust changes ONLY via recordGovernedTrustChange (and require a backing decision)
 *   - disputed/superseded findings are never public-safe
 *   - resolving an upheld dispute supersedes the finding while history is retained
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listReviewQueue,
  applyDecision,
  recordGovernedTrustChange,
  publicSafeDisputeState,
} from '../services/governance/governanceService.js';
import {
  submitDispute,
  respondToDispute,
  assignIndependentReviewer,
  resolveDispute,
  appealDispute,
} from '../services/governance/disputeService.js';

function clone(v) { return JSON.parse(JSON.stringify(v)); }

class MockQuery {
  constructor(client, table) {
    this.client = client; this.table = table;
    this.filters = []; this.orderSpec = null; this.operation = 'select'; this.payload = null;
  }
  select() { return this; }
  insert(p) { this.operation = 'insert'; this.payload = p; return this; }
  update(p) { this.operation = 'update'; this.payload = p; return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  neq() { return this; }
  in() { return this; }
  is() { return this; }
  order(column, options = {}) { this.orderSpec = { column, ascending: options.ascending !== false }; return this; }
  limit() { return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }
  rows() { return this.client.data[this.table] || (this.client.data[this.table] = []); }
  matches(row) { return this.filters.every((f) => row[f.key] === f.value); }
  async execute({ single, maybe }) {
    if (this.table === 'trust_audit_events' && this.client.failAudit && this.operation === 'insert') {
      return { data: null, error: { message: 'trust_audit_events failed' } };
    }
    if (this.operation === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = list.map((row) => ({
        id: row.id || `${this.table}-${++this.client.sequence}`,
        created_at: row.created_at || new Date().toISOString(),
        ...clone(row),
      }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }
    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) if (this.matches(row)) { Object.assign(row, clone(this.payload)); updated.push(clone(row)); }
      if (single) return { data: updated[0] || null, error: updated.length || maybe ? null : { message: 'No rows updated' } };
      return { data: updated, error: null };
    }
    let rows = this.rows().filter((r) => this.matches(r)).map(clone);
    if (this.orderSpec) {
      rows.sort((a, b) => {
        const av = a[this.orderSpec.column] || ''; const bv = b[this.orderSpec.column] || '';
        return this.orderSpec.ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    if (single) return { data: rows[0] || null, error: rows.length || maybe ? null : { message: 'No rows found' } };
    return { data: rows, error: null };
  }
}

function createMockClient() {
  const data = {
    temporal_findings: [
      { id: 'tf1', vin: 'VIN1', reviewer_state: 'pending_review', public_summary: 'Front bumper differs', confidence: 0.6, severity: 'medium', created_at: '2026-06-01T00:00:00Z' },
      { id: 'tf2', vin: 'VIN1', reviewer_state: 'confirmed', public_summary: 'Repainted door', created_at: '2026-06-02T00:00:00Z' },
    ],
    disclosure_conflicts: [
      { id: 'dc1', vin: 'VIN1', reviewer_state: 'pending_review', classification: 'possible_conflict', public_summary: 'No-accident claim conflict', created_at: '2026-06-03T00:00:00Z' },
    ],
    vehicle_identity_candidates: [
      { id: 'ic1', vin: 'VIN1', status: 'pending', confidence: 0.4, created_at: '2026-06-04T00:00:00Z' },
    ],
    vehicle_evidence: [
      { id: 'ev1', vin: 'VIN1', verification_status: 'pending', created_at: '2026-06-05T00:00:00Z' },
    ],
    review_decisions: [],
    review_tasks: [],
    trust_audit_events: [],
    organization_audit_logs: [],
    organization_users: [],
    trust_change_log: [],
    disputes: [],
    dispute_events: [],
  };
  return {
    data, sequence: 0, failAudit: false,
    from(table) { if (!this.data[table]) this.data[table] = []; return new MockQuery(this, table); },
  };
}

const admin = { id: 'admin-1', role: 'admin' };
const reviewer = { id: 'rev-1', role: 'reviewer' };
const government = { id: 'gov-1', role: 'government' };
const owner = { id: 'owner-1', role: 'owner' };
const dealer = { id: 'dealer-1', role: 'dealer' };
const buyer = { id: 'buyer-1', role: 'buyer' };

test('review queue aggregates pending items across all sources', async () => {
  const client = createMockClient();
  const queue = await listReviewQueue(client, {});
  assert.equal(queue.length, 4); // tf1, dc1, ic1, ev1 (tf2 is confirmed, excluded)
  const types = queue.map((q) => q.task_type).sort();
  assert.deepEqual(types, ['disclosure_conflict', 'evidence_verification', 'temporal_finding', 'vehicle_identity']);
});

test('review queue can filter by task type', async () => {
  const client = createMockClient();
  const queue = await listReviewQueue(client, { taskType: 'temporal_finding' });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].target_id, 'tf1');
});

test('unauthorized role cannot apply a decision', async () => {
  const client = createMockClient();
  await assert.rejects(
    () => applyDecision(client, { targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'confirm', reviewer: owner, notes: 'x' }),
    /not permitted/
  );
  // No state change, no decision row.
  assert.equal(client.data.temporal_findings[0].reviewer_state, 'pending_review');
  assert.equal(client.data.review_decisions.length, 0);
});

test('confirm decision moves reviewer_state, writes review_decisions + trust_audit_events, but NEVER trust_change_log', async () => {
  const client = createMockClient();
  const decision = await applyDecision(client, {
    targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'confirm',
    reviewer: admin, notes: 'Confirmed via invoice', policyVersion: 'v1',
  });
  assert.equal(decision.decision, 'confirm');
  assert.equal(client.data.temporal_findings[0].reviewer_state, 'confirmed');
  // Accountability double-write
  assert.equal(client.data.review_decisions.length, 1);
  assert.equal(client.data.review_decisions[0].reviewer_id, 'admin-1');
  assert.ok(client.data.trust_audit_events.some((e) => e.event_type === 'GOVERNANCE_DECISION_APPLIED'));
  // The hard invariant: no trust change happened.
  assert.equal(client.data.trust_change_log.length, 0);
});

test('decision maps for each target table', async () => {
  const client = createMockClient();
  await applyDecision(client, { targetType: 'disclosure_conflicts', targetId: 'dc1', vin: 'VIN1', decision: 'reject', reviewer: government, notes: 'no conflict' });
  assert.equal(client.data.disclosure_conflicts[0].reviewer_state, 'rejected');

  await applyDecision(client, { targetType: 'vehicle_identity_candidates', targetId: 'ic1', vin: 'VIN1', decision: 'confirm', reviewer: admin, notes: 'matched' });
  assert.equal(client.data.vehicle_identity_candidates[0].status, 'confirmed');

  await applyDecision(client, { targetType: 'vehicle_evidence', targetId: 'ev1', vin: 'VIN1', decision: 'confirm', reviewer: admin, notes: 'verified' });
  assert.equal(client.data.vehicle_evidence[0].verification_status, 'verified');
});

test('escalate does not change reviewer_state but records a decision + escalates the task', async () => {
  const client = createMockClient();
  client.data.review_tasks.push({ id: 'task-1', task_type: 'temporal_finding', status: 'open' });
  const decision = await applyDecision(client, {
    targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'escalate',
    reviewer: reviewer, notes: 'needs senior review', reviewTaskId: 'task-1',
  });
  assert.equal(decision.decision, 'escalate');
  assert.equal(client.data.temporal_findings[0].reviewer_state, 'pending_review'); // unchanged
  assert.equal(client.data.review_tasks[0].status, 'escalated');
  assert.equal(client.data.trust_change_log.length, 0);
});

test('applyDecision on missing target returns not found', async () => {
  const client = createMockClient();
  await assert.rejects(
    () => applyDecision(client, { targetType: 'temporal_findings', targetId: 'nope', vin: 'VIN1', decision: 'confirm', reviewer: admin, notes: 'x' }),
    /not found/
  );
});

test('recordGovernedTrustChange is the only trust path and requires a backing decision', async () => {
  const client = createMockClient();
  await assert.rejects(
    () => recordGovernedTrustChange(client, { vin: 'VIN1', rule: 'verified_no_accident', previous: { score: 70 }, newValue: { score: 80 }, approvedBy: 'admin-1', approvedByRole: 'admin' }),
    /backing reviewDecisionId/
  );

  const decision = await applyDecision(client, { targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'confirm', reviewer: admin, notes: 'ok' });
  const change = await recordGovernedTrustChange(client, {
    vin: 'VIN1', rule: 'verified_no_accident', evidenceIds: ['ev1'],
    previous: { score: 70 }, newValue: { score: 80 }, approvedBy: 'admin-1', approvedByRole: 'admin',
    reviewDecisionId: decision.id,
  });
  assert.equal(client.data.trust_change_log.length, 1);
  assert.equal(change.review_decision_id, decision.id);
  assert.ok(client.data.trust_audit_events.some((e) => e.event_type === 'GOVERNED_TRUST_CHANGE'));
});

test('publicSafeDisputeState never renders disputed/superseded/pending as confirmed-public', () => {
  assert.equal(publicSafeDisputeState({ id: 'a', reviewer_state: 'confirmed', public_summary: 'ok' }).public_state, 'confirmed_public');
  assert.equal(publicSafeDisputeState({ id: 'b', reviewer_state: 'superseded', public_summary: 'leak?' }).public_state, 'not_public');
  assert.equal(publicSafeDisputeState({ id: 'c', reviewer_state: 'pending_review', public_summary: 'leak?' }).public_state, 'not_public');
  assert.equal(publicSafeDisputeState({ id: 'd', reviewer_state: 'confirmed', disputed: true, public_summary: 'leak?' }).public_state, 'not_public');
  // public_summary is stripped when not public
  assert.equal(publicSafeDisputeState({ id: 'b', reviewer_state: 'superseded', public_summary: 'leak?' }).public_summary, null);
});

// --- dispute lifecycle -------------------------------------------------------

test('only owner/dealer/admin can raise a dispute; each transition appends an immutable event', async () => {
  const client = createMockClient();
  await assert.rejects(
    () => submitDispute(client, buyer, { vin: 'VIN1', subjectType: 'temporal_finding', subjectId: 'tf2', reason: 'wrong' }),
    /not permitted/
  );

  const dispute = await submitDispute(client, owner, { vin: 'VIN1', subjectType: 'temporal_finding', subjectId: 'tf2', reason: 'wrong' });
  assert.equal(dispute.status, 'open');
  assert.ok(dispute.response_deadline);
  assert.equal(client.data.dispute_events.filter((e) => e.dispute_id === dispute.id).length, 1);

  await respondToDispute(client, owner, dispute.id, { response: 'Here is my invoice' });
  await assignIndependentReviewer(client, admin, dispute.id, { reviewerId: 'rev-1' });
  const events = client.data.dispute_events.filter((e) => e.dispute_id === dispute.id).map((e) => e.event_type);
  assert.deepEqual(events, ['dispute_opened', 'dispute_response', 'independent_reviewer_assigned']);
});

test('resolving an upheld dispute supersedes the finding via governed decision while retaining history', async () => {
  const client = createMockClient();
  // tf2 starts confirmed/public.
  assert.equal(client.data.temporal_findings[1].reviewer_state, 'confirmed');
  const dispute = await submitDispute(client, owner, { vin: 'VIN1', subjectType: 'temporal_findings', subjectId: 'tf2', reason: 'incorrect' });

  const resolved = await resolveDispute(client, admin, dispute.id, {
    resolution: 'Owner evidence accepted', outcome: 'upheld', targetType: 'temporal_findings', targetId: 'tf2',
  });
  assert.equal(resolved.status, 'resolved');
  // The finding is superseded (not deleted) — history retained.
  assert.equal(client.data.temporal_findings[1].reviewer_state, 'superseded');
  assert.ok(client.data.temporal_findings.find((f) => f.id === 'tf2'));
  // A governed decision backs the correction.
  assert.ok(client.data.review_decisions.some((d) => d.target_id === 'tf2' && d.decision === 'supersede'));
  // No trust score was changed by the correction itself.
  assert.equal(client.data.trust_change_log.length, 0);
  // It must not be public-safe anymore.
  assert.equal(publicSafeDisputeState(client.data.temporal_findings[1]).public_state, 'not_public');
});

test('independent reviewer cannot be the party who raised the dispute', async () => {
  const client = createMockClient();
  const dispute = await submitDispute(client, owner, { vin: 'VIN1', subjectType: 'temporal_findings', subjectId: 'tf2' });
  await assert.rejects(
    () => assignIndependentReviewer(client, admin, dispute.id, { reviewerId: 'owner-1' }),
    /cannot be the party/
  );
});

test('only a resolved dispute can be appealed and appeal is restricted', async () => {
  const client = createMockClient();
  const dispute = await submitDispute(client, dealer, { vin: 'VIN1', subjectType: 'temporal_findings', subjectId: 'tf2' });
  await assert.rejects(() => appealDispute(client, dealer, dispute.id, { reason: 'too soon' }), /resolved/);

  await resolveDispute(client, government, dispute.id, { resolution: 'no change' });
  await assert.rejects(() => appealDispute(client, buyer, dispute.id, { reason: 'unhappy' }), /not permitted/);
  const appealed = await appealDispute(client, dealer, dispute.id, { reason: 'new evidence' });
  assert.equal(appealed.status, 'appealed');
});

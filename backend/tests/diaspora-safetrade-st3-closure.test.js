/**
 * ST-3 closure — service-layer tests (Issue #127).
 *
 * The database-level proofs (constraints, RLS, ACLs, and the transition RPC's maker-checker and
 * transactional-outbox behaviour executed on real PostgreSQL 17.5) live in
 * database/test/diaspora_st3_migration_check.mjs. This file proves the JavaScript half: that the
 * services actually USE those guarantees, and that the specific failure modes ST-3 names cannot recur
 * in the code paths a request travels through.
 *
 * The in-memory client here deliberately ENFORCES the unique indexes from ledger #21. A mock that
 * accepts every insert would let a de-duplication test pass while the real system double-processes —
 * the constraint is the mechanism under test, so the fake has to have it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const eventLedger = await import('../services/diaspora/safetrade/diasporaSafeTradeEventLedgerService.js');
const operations = await import('../services/diaspora/safetrade/diasporaSafeTradeOperationService.js');
const approvals = await import('../services/diaspora/safetrade/diasporaSafeTradeApprovalService.js');

// ── A small Supabase-shaped fake that enforces ledger #21's unique indexes ───
// Unique indexes modelled (all from ledger #21):
//   diaspora_safetrade_provider_events  UNIQUE (provider, event_id)
//   diaspora_safetrade_operations       UNIQUE (tenant_id, idempotency_key)
//   diaspora_safetrade_approvals        CHECK  (approved_by <> requested_by)
const UNIQUES = {
  diaspora_safetrade_provider_events: [['provider', 'event_id']],
  diaspora_safetrade_operations: [['tenant_id', 'idempotency_key']],
};

function createLedgerClient(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let seq = 0;
  const ensure = (t) => (tables[t] ||= []);
  const uid = () => `row-${++seq}`;

  function violatesUnique(table, row) {
    for (const cols of UNIQUES[table] || []) {
      const clash = ensure(table).some((existing) => cols.every((c) => existing[c] === row[c]));
      if (clash) return cols;
    }
    return null;
  }

  function builder(table) {
    const state = { op: 'select', payload: null, eq: [], inList: null, selected: false };
    const api = {
      select() { state.selected = true; return api; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api; },
      update(payload) { state.op = 'update'; state.payload = payload; return api; },
      eq(col, val) { state.eq.push([col, val]); return api; },
      in(col, vals) { state.inList = [col, vals]; return api; },
      order() { return api; },
      limit() { return api; },
      match(rowsIn) { return rowsIn; },
      _rows() {
        let rows = ensure(table);
        for (const [c, v] of state.eq) rows = rows.filter((r) => r[c] === v);
        if (state.inList) rows = rows.filter((r) => state.inList[1].includes(r[state.inList[0]]));
        return rows;
      },
      async single() { return api._resolve('single'); },
      async maybeSingle() { return api._resolve('maybeSingle'); },
      then(resolve, reject) { return api._resolve('many').then(resolve, reject); },
      async _resolve(mode) {
        if (state.op === 'insert') {
          const row = { id: uid(), created_at: new Date().toISOString(), ...state.payload };
          const clash = violatesUnique(table, row);
          if (clash) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on (${clash.join(', ')})` } };
          }
          ensure(table).push(row);
          return { data: row, error: null };
        }
        if (state.op === 'update') {
          const rows = api._rows();
          for (const r of rows) Object.assign(r, state.payload);
          if (mode === 'many') return { data: rows, error: null };
          return { data: rows[0] || null, error: null };
        }
        const rows = api._rows();
        if (mode === 'single') return { data: rows[0] || null, error: rows.length ? null : { code: 'PGRST116', message: 'no rows' } };
        if (mode === 'maybeSingle') return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      },
    };
    return api;
  }

  return { from: (t) => builder(t), _tables: tables };
}

const TENANT = 'tenant-A';
const reviewer = { id: 'user-reviewer', role: 'reviewer', tenantId: TENANT };
const otherReviewer = { id: 'user-other-reviewer', role: 'admin', tenantId: TENANT };
const buyer = { id: 'user-buyer', role: 'owner', tenantId: TENANT };

// ─────────────────────────────────────────────────────────────────────────────
// ST-3 #4 — durable webhook de-duplication
// ─────────────────────────────────────────────────────────────────────────────

test('ST-3 #4: the first delivery of a provider event is claimed', async () => {
  const client = createLedgerClient();
  const r = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_1', eventType: 'release.succeeded',
    intentId: 'sbx_pi_1', signatureVerified: true, supabaseClient: client,
  });
  assert.equal(r.claimed, true);
  assert.equal(r.duplicate, false);
  assert.equal(r.superseded, false);
});

test('ST-3 #4: a duplicate delivery is a no-op, not a second application', async () => {
  const client = createLedgerClient();
  const args = { provider: 'sandbox', eventId: 'evt_1', signatureVerified: true, supabaseClient: client };
  await eventLedger.claimProviderEvent(args);
  const second = await eventLedger.claimProviderEvent(args);
  assert.equal(second.claimed, false);
  assert.equal(second.duplicate, true);
  assert.equal(client._tables.diaspora_safetrade_provider_events.length, 1);
});

test('ST-3 #4: the same event id from a DIFFERENT provider is a different event', async () => {
  const client = createLedgerClient();
  await eventLedger.claimProviderEvent({ provider: 'sandbox', eventId: 'evt_1', supabaseClient: client });
  const other = await eventLedger.claimProviderEvent({ provider: 'other', eventId: 'evt_1', supabaseClient: client });
  assert.equal(other.claimed, true);
});

test('ST-3 #4: a genuine database error is NOT swallowed as "already processed"', async () => {
  // A failure that is not a unique violation must surface. Reporting it as a duplicate would silently
  // drop a real provider event.
  const client = createLedgerClient();
  const broken = {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) }) }),
    }),
  };
  await assert.rejects(
    () => eventLedger.claimProviderEvent({ provider: 'sandbox', eventId: 'evt_x', supabaseClient: broken }),
    /connection failure/,
  );
  assert.equal((client._tables.diaspora_safetrade_provider_events || []).length, 0);
});

test('ST-3 #4: an out-of-order OLDER event is recorded but superseded, never applied backwards', async () => {
  const client = createLedgerClient();
  // A newer event was already applied for this intent.
  const newer = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_new', intentId: 'sbx_pi_1',
    payload: { occurred_at: '2026-06-21T12:00:00.000Z' }, supabaseClient: client,
  });
  await eventLedger.markEventApplied(newer.event.id, { supabaseClient: client });

  // A retry of an OLDER event overtakes it.
  const older = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_old', intentId: 'sbx_pi_1',
    payload: { occurred_at: '2026-06-21T11:00:00.000Z' }, supabaseClient: client,
  });
  assert.equal(older.claimed, true, 'the older event is still recorded for audit');
  assert.equal(older.superseded, true, 'but it is marked superseded rather than applied');
});

test('ST-3 #4: a NEWER event after an applied older one is applied normally', async () => {
  const client = createLedgerClient();
  const first = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_a', intentId: 'sbx_pi_1',
    payload: { occurred_at: '2026-06-21T11:00:00.000Z' }, supabaseClient: client,
  });
  await eventLedger.markEventApplied(first.event.id, { supabaseClient: client });
  const second = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_b', intentId: 'sbx_pi_1',
    payload: { occurred_at: '2026-06-21T12:00:00.000Z' }, supabaseClient: client,
  });
  assert.equal(second.superseded, false);
});

test('ST-3 #4: provider sequence numbers take precedence over timestamps for ordering', async () => {
  const client = createLedgerClient();
  const newer = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_seq_9', intentId: 'i1', payload: { sequence: 9 }, supabaseClient: client,
  });
  await eventLedger.markEventApplied(newer.event.id, { supabaseClient: client });
  const older = await eventLedger.claimProviderEvent({
    provider: 'sandbox', eventId: 'evt_seq_3', intentId: 'i1', payload: { sequence: 3 }, supabaseClient: client,
  });
  assert.equal(older.superseded, true);
});

test('ST-3 #4: the stored payload is redacted to an allowlist (no customer PII, no secrets)', () => {
  const redacted = eventLedger.redactEventPayload({
    id: 'evt_1',
    type: 'release.succeeded',
    amount: 100,
    // None of the following may ever be persisted into our event ledger.
    customer_email: 'buyer@example.com',
    customer_name: 'A Real Person',
    billing_address: { line1: '1 Somewhere St' },
    card: { last4: '4242', fingerprint: 'fp_abc' },
    webhook_secret: 'whsec_notreal',
    data: { intentId: 'sbx_pi_1', status: 'released', phone: '+263771234567' },
  });
  assert.equal(redacted.id, 'evt_1');
  assert.equal(redacted.amount, 100);
  assert.equal(redacted.data.intentId, 'sbx_pi_1');
  for (const forbidden of ['customer_email', 'customer_name', 'billing_address', 'card', 'webhook_secret']) {
    assert.equal(redacted[forbidden], undefined, `${forbidden} must not be persisted`);
  }
  assert.equal(redacted.data.phone, undefined, 'nested PII must not be persisted');
});

test('ST-3 #4: redaction drops unknown fields rather than passing them through', () => {
  // An allowlist means a field the provider adds next year is dropped by default. A denylist would
  // pass it straight into our ledger.
  const redacted = eventLedger.redactEventPayload({ id: 'e', some_future_pii_field: 'sensitive' });
  assert.deepEqual(Object.keys(redacted), ['id']);
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-3 #3 — provider-before-database ordering / reconciliation state machine
// ─────────────────────────────────────────────────────────────────────────────

test('ST-3 #3: an operation is reserved as pending BEFORE any provider call', async () => {
  const client = createLedgerClient();
  const { operation, replay } = await operations.reserveOperation({
    tenantId: TENANT, operation: 'release', idempotencyKey: 'idem-1',
    provider: 'sandbox', amount: 100, currency: 'USD', supabaseClient: client,
  });
  assert.equal(replay, false);
  assert.equal(operation.state, operations.OPERATION_STATE.PENDING);
});

test('ST-3 #3: replaying an idempotency key returns the SAME operation and signals replay', async () => {
  const client = createLedgerClient();
  const args = {
    tenantId: TENANT, operation: 'release', idempotencyKey: 'idem-1', provider: 'sandbox', supabaseClient: client,
  };
  const first = await operations.reserveOperation(args);
  const second = await operations.reserveOperation(args);
  assert.equal(second.replay, true, 'a retried release must not dispatch a second time');
  assert.equal(second.operation.id, first.operation.id);
  assert.equal(client._tables.diaspora_safetrade_operations.length, 1);
});

test('ST-3 #3: the same idempotency key in a different tenant is a different operation', async () => {
  const client = createLedgerClient();
  await operations.reserveOperation({ tenantId: TENANT, operation: 'release', idempotencyKey: 'k', provider: 'sandbox', supabaseClient: client });
  const other = await operations.reserveOperation({ tenantId: 'tenant-B', operation: 'release', idempotencyKey: 'k', provider: 'sandbox', supabaseClient: client });
  assert.equal(other.replay, false);
});

test('ST-3 #3: an unknown provider result goes to RECONCILING, never to failed or success', async () => {
  const client = createLedgerClient();
  const { operation } = await operations.reserveOperation({
    tenantId: TENANT, operation: 'release', idempotencyKey: 'idem-2', provider: 'sandbox', supabaseClient: client,
  });
  await operations.markDispatched(operation.id, { supabaseClient: client });
  const after = await operations.markUnknown(operation.id, 'gateway timeout', { supabaseClient: client });
  assert.equal(after.state, operations.OPERATION_STATE.RECONCILING);
  assert.notEqual(after.state, operations.OPERATION_STATE.FAILED,
    'a timeout is not a failure — the money may well have moved');
  assert.equal(after.last_error_code, 'PROVIDER_RESULT_UNKNOWN');
  assert.ok(after.next_attempt_at, 'it must be scheduled for another look');
});

test('ST-3 #3: an unresolved operation NEVER reports success to a user', async () => {
  for (const state of operations.UNRESOLVED_STATES) {
    const described = operations.describeOperationForUser({ state });
    assert.equal(described.settled, false, `${state} must not be presented as settled`);
    assert.doesNotMatch(described.userMessage, /completed|success/i,
      `${state} must not be described to a user as completed`);
  }
});

test('ST-3 #3: only ledger_applied is presented as completed', () => {
  const applied = operations.describeOperationForUser({ state: operations.OPERATION_STATE.LEDGER_APPLIED });
  assert.equal(applied.settled, true);
  assert.match(applied.userMessage, /Completed/);
});

test('ST-3 #3: a definite provider rejection is a clean failure that moved no funds', async () => {
  const client = createLedgerClient();
  const { operation } = await operations.reserveOperation({
    tenantId: TENANT, operation: 'release', idempotencyKey: 'idem-3', provider: 'sandbox', supabaseClient: client,
  });
  const after = await operations.markFailed(operation.id, { reason: 'insufficient funds', supabaseClient: client });
  assert.equal(after.state, operations.OPERATION_STATE.FAILED);
  const described = operations.describeOperationForUser(after);
  assert.match(described.userMessage, /No funds were moved/);
});

test('ST-3 #3: the reconciliation queue lists exactly the unresolved operations', async () => {
  const client = createLedgerClient({
    diaspora_safetrade_operations: [
      { id: 'o1', tenant_id: TENANT, state: 'pending', requested_at: '2026-06-21T10:00:00Z' },
      { id: 'o2', tenant_id: TENANT, state: 'reconciling', requested_at: '2026-06-21T10:01:00Z' },
      { id: 'o3', tenant_id: TENANT, state: 'ledger_applied', requested_at: '2026-06-21T10:02:00Z' },
      { id: 'o4', tenant_id: 'tenant-B', state: 'pending', requested_at: '2026-06-21T10:03:00Z' },
    ],
  });
  const queue = await operations.listReconciliationQueue({ tenantId: TENANT, supabaseClient: client });
  const ids = queue.map((r) => r.id).sort();
  assert.deepEqual(ids, ['o1', 'o2'], 'settled work and other tenants are excluded');
});

test('ST-3 #3: reserveOperation refuses an unknown operation name', async () => {
  await assert.rejects(
    () => operations.reserveOperation({ tenantId: TENANT, operation: 'drain_the_account', idempotencyKey: 'k', provider: 'sandbox', supabaseClient: createLedgerClient() }),
    /known operation/,
  );
});

test('ST-3 #3: reserveOperation refuses a missing idempotency key', async () => {
  await assert.rejects(
    () => operations.reserveOperation({ tenantId: TENANT, operation: 'release', provider: 'sandbox', supabaseClient: createLedgerClient() }),
    /idempotencyKey/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ST-3 #2 — maker-checker separation
// ─────────────────────────────────────────────────────────────────────────────

test('ST-3 #2: the requester of a high-risk decision cannot approve it', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release',
    userContext: reviewer, supabaseClient: client,
  });
  await assert.rejects(
    () => approvals.approve({ approvalId: approval.id, userContext: reviewer, supabaseClient: client }),
    /cannot approve it|maker-checker/i,
  );
});

test('ST-3 #2: a DIFFERENT privileged human can approve', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release',
    userContext: reviewer, supabaseClient: client,
  });
  const approved = await approvals.approve({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client });
  assert.equal(approved.state, approvals.APPROVAL_STATE.APPROVED);
  assert.equal(approved.approved_by, otherReviewer.id);
  assert.notEqual(approved.approved_by, approved.requested_by);
});

test('ST-3 #2: an unprivileged user can neither request nor approve', async () => {
  const client = createLedgerClient();
  await assert.rejects(
    () => approvals.requestApproval({ tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: buyer, supabaseClient: client }),
    /restricted to platform reviewers/,
  );
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client,
  });
  await assert.rejects(
    () => approvals.approve({ approvalId: approval.id, userContext: buyer, supabaseClient: client }),
    /restricted to platform reviewers/,
  );
});

test('ST-3 #2: the requester is taken from the session, not from the request body', async () => {
  // If the body could name the maker, one human could file as someone else and then approve as
  // themselves — defeating the separation entirely.
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release',
    requested_by: 'someone-else', requestedBy: 'someone-else',
    userContext: reviewer, supabaseClient: client,
  });
  assert.equal(approval.requested_by, reviewer.id);
});

test('ST-3 #2: an expired approval cannot be granted', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release',
    ttlMinutes: 60, userContext: reviewer, supabaseClient: client,
  });
  // Age it past its expiry.
  client._tables.diaspora_safetrade_approvals[0].expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(
    () => approvals.approve({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client }),
    /expired/,
  );
  assert.equal(client._tables.diaspora_safetrade_approvals[0].state, approvals.APPROVAL_STATE.EXPIRED);
});

test('ST-3 #2: an already-approved decision cannot be approved twice', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client,
  });
  await approvals.approve({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client });
  await assert.rejects(
    () => approvals.approve({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client }),
    /can no longer be approved/,
  );
});

test('ST-3 #2: a rejected decision cannot then be approved', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client,
  });
  await approvals.reject({ approvalId: approval.id, userContext: otherReviewer, reason: 'evidence insufficient', supabaseClient: client });
  await assert.rejects(
    () => approvals.approve({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client }),
    /can no longer be approved/,
  );
});

test('ST-3 #2: a rejection leaves approved_by NULL so "was this approved" stays unambiguous', async () => {
  const client = createLedgerClient();
  const approval = await approvals.requestApproval({
    tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client,
  });
  const rejected = await approvals.reject({ approvalId: approval.id, userContext: otherReviewer, supabaseClient: client });
  assert.equal(rejected.approved_by ?? null, null);
  assert.equal(rejected.metadata.rejectedBy, otherReviewer.id);
});

test('ST-3 #2: only HIGH risk requires the second human', () => {
  assert.equal(approvals.requiresMakerChecker({ riskLevel: 'HIGH' }), true);
  assert.equal(approvals.requiresMakerChecker({ riskLevel: 'high' }), true);
  assert.equal(approvals.requiresMakerChecker({ riskLevel: 'MEDIUM' }), false);
  assert.equal(approvals.requiresMakerChecker({ riskLevel: 'LOW' }), false);
  assert.equal(approvals.requiresMakerChecker({}), false);
});

test('ST-3 #2: an unknown decision type is refused', async () => {
  await assert.rejects(
    () => approvals.requestApproval({
      tenantId: TENANT, transactionId: 'txn-1', decisionType: 'transfer_everything',
      userContext: reviewer, supabaseClient: createLedgerClient(),
    }),
    /Unknown approval decision type/,
  );
});

test('ST-3 #2: the pending queue marks the viewer\'s own requests as not self-approvable', async () => {
  const client = createLedgerClient();
  await approvals.requestApproval({ tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client });
  await approvals.requestApproval({ tenantId: TENANT, transactionId: 'txn-2', decisionType: 'refund', userContext: otherReviewer, supabaseClient: client });

  const asReviewer = await approvals.listPendingApprovals({ tenantId: TENANT, userContext: reviewer, supabaseClient: client });
  const own = asReviewer.find((a) => a.requested_by === reviewer.id);
  const theirs = asReviewer.find((a) => a.requested_by === otherReviewer.id);
  assert.equal(own.canApprove, false);
  assert.equal(own.selfApprovalBlocked, true);
  assert.equal(theirs.canApprove, true);
});

test('ST-3 #2: the pending queue never returns another tenant\'s approvals', async () => {
  const client = createLedgerClient();
  await approvals.requestApproval({ tenantId: TENANT, transactionId: 'txn-1', decisionType: 'release', userContext: reviewer, supabaseClient: client });
  await approvals.requestApproval({ tenantId: 'tenant-B', transactionId: 'txn-9', decisionType: 'release', userContext: otherReviewer, supabaseClient: client });
  const list = await approvals.listPendingApprovals({ tenantId: TENANT, userContext: reviewer, supabaseClient: client });
  assert.equal(list.length, 1);
  assert.equal(list[0].transaction_id, 'txn-1');
});

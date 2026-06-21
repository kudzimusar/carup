/**
 * Phase 9 — JS reference implementations of the SafeTrade atomic RPCs, used ONLY by the in-memory
 * mock in tests. Each mirrors the invariants of the corresponding SQL function so service-level tests
 * exercise the SAME contract (authority, source->target allowlist, money/high-risk fail-closed guards,
 * idempotency replay, in-txn CRITICAL audit, all-or-nothing rollback on a simulated audit fault).
 *
 * Kept in lockstep with the SQL (mirrors it line-for-line where it matters):
 *   database/migrations/20260621130000_diaspora_phase9_safetrade.sql
 *     - diaspora_safetrade_transition_atomic   (§5.1 — locks, authority, allowlist, money/N5 guards,
 *                                                idempotency replay, in-txn CRITICAL audit)
 *     - diaspora_safetrade_record_milestone_atomic (§5.2 — single-currency total reconciliation,
 *                                                idempotency replay, DRAFT->INITIATED, in-txn audit)
 *
 * True row-locking concurrency (FOR UPDATE) is proven against a real PostgreSQL instance in the
 * staging integration suite; these references prove the contract sequentially, exactly like
 * backend/tests/helpers/diasporaRpcReference.js does for H1/H2/H3.
 *
 * A fixed timestamp is used (no Date.now()) so tests never depend on wall-clock time.
 */
import crypto from 'crypto';

// Fixed reference timestamp (mirrors the H1/H2/H3 JS references' fixed clock). Never Date.now().
const SAFETRADE_RPC_TS = new Date(2026, 5, 21, 13, 0, 0).toISOString();

function seal(actorId, action, resourceType, resourceId, ts) {
  return crypto
    .createHash('sha256')
    .update(`${actorId || 'system'}|${action}|${resourceType}|${resourceId}|${ts}`)
    .digest('hex');
}

function fail(message) {
  throw new Error(message);
}

// ── §5.1 transition allowlist (verbatim from the SQL CASE) ────────────────────
// Transaction lifecycle edges + milestone lifecycle edges, source -> [allowed targets].
const TXN_EDGES = {
  DRAFT: ['INITIATED', 'CANCELLED'],
  INITIATED: ['FUNDS_PENDING', 'CANCELLED'],
  FUNDS_PENDING: ['FUNDS_HELD', 'REFUND_REVIEW', 'DISPUTED'],
  FUNDS_HELD: ['IN_PROGRESS', 'REFUND_REVIEW', 'DISPUTED'],
  IN_PROGRESS: ['RELEASE_REVIEW', 'REFUND_REVIEW', 'DISPUTED'],
  RELEASE_REVIEW: ['RELEASE_AUTHORIZED', 'REFUND_REVIEW', 'DISPUTED'],
  RELEASE_AUTHORIZED: ['SETTLED', 'DISPUTED'],
  DISPUTED: ['IN_PROGRESS', 'FUNDS_HELD', 'REFUND_REVIEW', 'CANCELLED'],
  REFUND_REVIEW: ['REFUNDED', 'DISPUTED'],
};
const MILESTONE_EDGES = {
  PENDING: ['DUE', 'FUNDS_PENDING', 'WAIVED', 'CANCELLED'],
  DUE: ['FUNDS_PENDING', 'WAIVED', 'CANCELLED'],
  FUNDS_PENDING: ['FUNDED', 'HELD', 'FAILED', 'REFUND_REVIEW'],
  FUNDED: ['HELD', 'REFUND_REVIEW'],
  HELD: ['RELEASE_REVIEW', 'REFUND_REVIEW'],
  RELEASE_REVIEW: ['RELEASE_AUTHORIZED', 'REFUND_REVIEW'],
  RELEASE_AUTHORIZED: ['RELEASED'],
  REFUND_REVIEW: ['REFUNDED'],
};

const MONEY_TARGETS = new Set(['FUNDS_PENDING', 'FUNDED', 'HELD', 'FUNDS_HELD', 'RELEASE_AUTHORIZED', 'RELEASED', 'REFUNDED']);
const RELEASE_AUTHORIZE_TARGETS = new Set(['RELEASE_AUTHORIZED', 'RELEASED', 'REFUNDED']);

function isLegalEdge(source, target, isMilestone) {
  const edges = isMilestone ? MILESTONE_EDGES : TXN_EDGES;
  // The SQL OR-allowlist mixes txn + milestone edges; a milestone transition only validates against the
  // milestone table (source is a milestone status), a txn transition only against the txn table.
  const allowed = edges[source];
  return Array.isArray(allowed) && allowed.includes(target);
}

/**
 * Mirrors public.diaspora_safetrade_transition_atomic.
 * Params (p_*): p_transaction_id, p_milestone_id, p_actor_id, p_tenant_id, p_actor_is_privileged,
 *   p_target_status, p_evaluation_id, p_payment_provider, p_live_payment, p_idempotency_key,
 *   p_reason, p_metadata, p_correlation_id, p_source.
 */
export function safetradeTransitionAtomic(params, { table, nextId, faults }) {
  const ts = SAFETRADE_RPC_TS;
  const txns = table('diaspora_safetrade_transactions');
  const milestones = table('diaspora_safetrade_milestones');
  const evals = table('diaspora_safetrade_release_evaluations');
  const audit = table('diaspora_import_audit_log');

  if (params.p_actor_id == null) fail('DIASPORA_SAFETRADE/UNAUTHENTICATED');
  if (params.p_target_status == null) fail('DIASPORA_SAFETRADE/TARGET_REQUIRED');

  // 1. Lock the transaction.
  const txn = txns.find((t) => t.id === params.p_transaction_id && !t.deleted_at);
  if (!txn) fail('DIASPORA_SAFETRADE/NOT_FOUND_TXN');

  // 2. Optionally lock the milestone.
  let milestone = null;
  let resourceType;
  let resourceId;
  let source;
  if (params.p_milestone_id != null) {
    milestone = milestones.find((m) => m.id === params.p_milestone_id && !m.deleted_at);
    if (!milestone) fail('DIASPORA_SAFETRADE/NOT_FOUND_MILESTONE');
    if (String(milestone.transaction_id) !== String(params.p_transaction_id)) {
      fail('DIASPORA_SAFETRADE/MILESTONE_NOT_IN_TXN');
    }
    resourceType = 'diaspora_safetrade_milestone';
    resourceId = String(params.p_milestone_id);
    source = milestone.status;
  } else {
    resourceType = 'diaspora_safetrade_transaction';
    resourceId = String(params.p_transaction_id);
    source = txn.status;
  }

  // 3. Authority against the locked rows (defense-in-depth with the service authz layer).
  const authorized = params.p_actor_is_privileged
    || String(txn.buyer_id) === String(params.p_actor_id)
    || String(txn.created_by) === String(params.p_actor_id)
    || (params.p_tenant_id != null && String(txn.tenant_id ?? '') === String(params.p_tenant_id));
  if (!authorized) fail('DIASPORA_SAFETRADE/FORBIDDEN');

  // 4. Idempotency replay (last transition key recorded on the row metadata).
  if (params.p_idempotency_key != null) {
    const target = params.p_milestone_id != null ? milestone : txn;
    const priorKey = target?.metadata?.safetrade?.lastTransitionKey ?? null;
    const priorTarget = target?.metadata?.safetrade?.lastTransitionTarget ?? null;
    if (priorKey != null && priorKey === params.p_idempotency_key) {
      if (priorTarget !== params.p_target_status) fail('DIASPORA_SAFETRADE/IDEMPOTENCY_CONFLICT');
      return { transaction: { ...txn }, milestone: milestone ? { ...milestone } : null, idempotentReplay: true };
    }
  }

  // 5. Transition validity (explicit allowlist; same DAG as the SQL CASE).
  if (!isLegalEdge(source, params.p_target_status, params.p_milestone_id != null)) {
    fail(`DIASPORA_SAFETRADE/INVALID_TRANSITION: ${source} -> ${params.p_target_status}`);
  }

  // 6. NON-NEGOTIABLE money / high-risk guards (directive §5.2).
  const isMoney = MONEY_TARGETS.has(params.p_target_status);
  const isReleaseAuthorize = RELEASE_AUTHORIZE_TARGETS.has(params.p_target_status);

  if (isMoney) {
    // N1/N7: live money path always throws; only sandbox/fake providers proceed.
    if (params.p_live_payment === true
      || params.p_payment_provider == null
      || !['sandbox', 'fake'].includes(params.p_payment_provider)) {
      fail('DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED');
    }
  }

  if (isReleaseAuthorize) {
    // N5: release/refund authorization requires a privileged actor AND a passing prior evaluation.
    if (!params.p_actor_is_privileged) fail('DIASPORA_SAFETRADE/REVIEWER_REQUIRED');
    if (params.p_evaluation_id == null) fail('DIASPORA_SAFETRADE/EVALUATION_REQUIRED');
    const evalRow = evals.find(
      (e) => e.id === params.p_evaluation_id && String(e.transaction_id) === String(params.p_transaction_id) && !e.deleted_at,
    );
    if (!evalRow) fail('DIASPORA_SAFETRADE/EVALUATION_REQUIRED');
    if (params.p_milestone_id != null && evalRow.milestone_id != null
      && String(evalRow.milestone_id) !== String(params.p_milestone_id)) {
      fail('DIASPORA_SAFETRADE/EVALUATION_REQUIRED');
    }
    // N5 defense-in-depth (mirrors the SQL): the blessing evaluation must carry an EVALUATOR (a privileged
    // reviewer/admin recorded by the service-role evaluation path). A forged row with no evaluator must not
    // bless a money RELEASE even if eligible=true.
    if (evalRow.evaluated_by == null) fail('DIASPORA_SAFETRADE/EVALUATION_NOT_REVIEWED');
    if (evalRow.eligible !== true) fail('DIASPORA_SAFETRADE/NOT_ELIGIBLE');
    if ((evalRow.policy_version ?? null) !== (txn.policy_version ?? null)) {
      fail('DIASPORA_SAFETRADE/POLICY_VERSION_MISMATCH');
    }
  }

  // Transactional fault hook: a simulated audit failure aborts BEFORE any write (all-or-nothing, N6).
  if (faults.failSafeTradeAudit) fail('DIASPORA_SAFETRADE/AUDIT_FAILED');

  // 7. Apply the update on the locked row, stamping the idempotency key for future replays.
  const stamp = (row) => {
    row.metadata = {
      ...(row.metadata || {}),
      safetrade: {
        ...((row.metadata || {}).safetrade || {}),
        lastTransitionKey: params.p_idempotency_key ?? '',
        lastTransitionTarget: params.p_target_status,
      },
    };
    row.updated_by = params.p_actor_id;
    row.updated_at = ts;
  };

  if (params.p_milestone_id != null) {
    milestone.status = params.p_target_status;
    if (params.p_target_status === 'RELEASED') {
      milestone.released_by = params.p_actor_id;
      milestone.released_at = ts;
    }
    // Persist the sandbox provider reference/status carried in p_metadata so the milestone's money
    // lifecycle (HOLD -> CAPTURE -> RELEASE/REFUND) reuses the same intent across calls. (The SQL also
    // records these in the audit row's metadata; persisting them on the row is the behavior a real
    // implementation needs and keeps the reference faithful for cross-call money flows.)
    const meta = params.p_metadata || {};
    if (meta.providerReference != null) milestone.provider_reference = meta.providerReference;
    if (meta.providerStatus != null) milestone.provider_status = meta.providerStatus;
    stamp(milestone);
  } else {
    txn.status = params.p_target_status;
    if (isReleaseAuthorize) {
      txn.reviewer_id = params.p_actor_id;
      txn.reviewed_at = ts;
    }
    if (params.p_target_status === 'SETTLED') txn.settled_at = ts;
    stamp(txn);
  }

  // 8. CRITICAL audit row in the same transaction (rolls back with everything else on failure).
  audit.push({
    id: nextId('aud'),
    import_order_id: txn.import_order_id,
    tenant_id: txn.tenant_id,
    actor_id: params.p_actor_id,
    action: `SAFETRADE_${params.p_target_status}`,
    resource_type: resourceType,
    resource_id: resourceId,
    previous_state: { status: source },
    new_state: { status: params.p_target_status },
    metadata: {
      evaluationId: params.p_evaluation_id ?? null,
      provider: params.p_payment_provider ?? null,
      livePayment: params.p_live_payment === true,
      reason: params.p_reason ?? null,
      correlationId: params.p_correlation_id ?? null,
      source: params.p_source ?? 'ui',
      extra: params.p_metadata ?? {},
    },
    cryptographic_seal: seal(params.p_actor_id, `SAFETRADE_${params.p_target_status}`, resourceType, resourceId, ts),
    created_at: ts,
  });

  return {
    transaction: { ...txn },
    milestone: milestone ? { ...milestone } : null,
    idempotentReplay: false,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Mirrors public.diaspora_safetrade_record_milestone_atomic.
 * Params (p_*): p_transaction_id, p_actor_id, p_tenant_id, p_actor_is_privileged, p_milestones,
 *   p_idempotency_key, p_correlation_id, p_source.
 */
export function safetradeRecordMilestoneAtomic(params, { table, nextId, faults }) {
  const ts = SAFETRADE_RPC_TS;
  const txns = table('diaspora_safetrade_transactions');
  const milestones = table('diaspora_safetrade_milestones');
  const audit = table('diaspora_import_audit_log');

  if (params.p_actor_id == null) fail('DIASPORA_SAFETRADE/UNAUTHENTICATED');
  if (!Array.isArray(params.p_milestones)) fail('DIASPORA_SAFETRADE/MILESTONES_REQUIRED');

  // 1. Lock the transaction; only DRAFT/INITIATED may have their milestone set (re)defined.
  const txn = txns.find((t) => t.id === params.p_transaction_id && !t.deleted_at);
  if (!txn) fail('DIASPORA_SAFETRADE/NOT_FOUND_TXN');
  const authorized = params.p_actor_is_privileged
    || String(txn.buyer_id) === String(params.p_actor_id)
    || String(txn.created_by) === String(params.p_actor_id)
    || (params.p_tenant_id != null && String(txn.tenant_id ?? '') === String(params.p_tenant_id));
  if (!authorized) fail('DIASPORA_SAFETRADE/FORBIDDEN');
  if (!['DRAFT', 'INITIATED'].includes(txn.status)) fail('DIASPORA_SAFETRADE/MILESTONES_LOCKED');

  // 2. Idempotency replay.
  if (params.p_idempotency_key != null) {
    const priorKey = txn.metadata?.safetrade?.lastMilestoneKey ?? null;
    if (priorKey != null && priorKey === params.p_idempotency_key) {
      const existing = milestones
        .filter((m) => String(m.transaction_id) === String(params.p_transaction_id) && !m.deleted_at)
        .sort((a, b) => a.sequence - b.sequence)
        .map((m) => ({ ...m }));
      return { transaction: { ...txn }, milestones: existing, idempotentReplay: true };
    }
  }

  // 3/4. Validate each element + reconcile totals (single currency, numeric(_,2) scale).
  let sum = 0;
  let count = 0;
  for (const elem of params.p_milestones) {
    const type = elem.milestoneType ?? elem.milestone_type;
    const seq = elem.sequence != null ? Number(elem.sequence) : count;
    const amount = round2(elem.amount ?? 0);
    const currency = elem.currency ?? txn.currency;

    if (amount < 0) fail('DIASPORA_SAFETRADE/INVALID_AMOUNT');
    if (currency !== txn.currency) fail(`DIASPORA_SAFETRADE/CURRENCY_MISMATCH: milestone ${currency} txn ${txn.currency}`);

    milestones.push({
      id: nextId('stm'),
      tenant_id: txn.tenant_id ?? params.p_tenant_id ?? null,
      transaction_id: params.p_transaction_id,
      import_order_id: txn.import_order_id,
      legacy_payment_milestone_id: elem.legacyPaymentMilestoneId ?? null,
      milestone_type: type,
      sequence: seq,
      amount,
      currency,
      payer: elem.payer ?? null,
      payee: elem.payee ?? null,
      due_trigger: elem.dueTrigger ?? 'MANUAL',
      release_trigger: elem.releaseTrigger ?? 'REVIEWER_APPROVAL',
      status: 'PENDING',
      evidence_requirements: elem.evidenceRequirements ?? [],
      evidence_refs: [],
      provider_reference: null,
      provider_status: null,
      idempotency_key: elem.idempotencyKey ?? null,
      metadata: { correlationId: params.p_correlation_id ?? null, source: params.p_source ?? 'ui' },
      created_by: params.p_actor_id,
      updated_by: params.p_actor_id,
      created_at: ts,
      updated_at: ts,
    });

    // REFUND lines are informational and excluded from the reconciliation sum.
    if (type !== 'REFUND') sum = round2(sum + amount);
    count += 1;
  }

  if (count === 0) fail('DIASPORA_SAFETRADE/MILESTONES_REQUIRED');

  // Reconcile within half a cent at numeric(_,2) (effectively exact).
  if (Math.abs(sum - Number(txn.total_amount)) > 0.005) {
    fail(`DIASPORA_SAFETRADE/TOTALS_UNRECONCILED: sum ${sum} total ${txn.total_amount}`);
  }

  // Transactional fault hook: simulated in-txn audit failure aborts BEFORE the audit write succeeds.
  if (faults.failSafeTradeAudit) fail('DIASPORA_SAFETRADE/AUDIT_FAILED');

  // 5. Advance DRAFT -> INITIATED and stamp the milestone idempotency key.
  if (txn.status === 'DRAFT') txn.status = 'INITIATED';
  txn.initiated_at = txn.initiated_at ?? ts;
  txn.metadata = {
    ...(txn.metadata || {}),
    safetrade: { ...((txn.metadata || {}).safetrade || {}), lastMilestoneKey: params.p_idempotency_key ?? '' },
  };
  txn.updated_by = params.p_actor_id;
  txn.updated_at = ts;

  // 6. CRITICAL audit row in-txn.
  audit.push({
    id: nextId('aud'),
    import_order_id: txn.import_order_id,
    tenant_id: txn.tenant_id,
    actor_id: params.p_actor_id,
    action: 'SAFETRADE_MILESTONES_DEFINED',
    resource_type: 'diaspora_safetrade_transaction',
    resource_id: String(params.p_transaction_id),
    previous_state: null,
    new_state: { status: txn.status, milestoneCount: count },
    metadata: { total: txn.total_amount, sum, reconciled: true, correlationId: params.p_correlation_id ?? null, source: params.p_source ?? 'ui' },
    cryptographic_seal: seal(params.p_actor_id, 'SAFETRADE_MILESTONES_DEFINED', 'diaspora_safetrade_transaction', params.p_transaction_id, ts),
    created_at: ts,
  });

  const result = milestones
    .filter((m) => String(m.transaction_id) === String(params.p_transaction_id) && !m.deleted_at)
    .sort((a, b) => a.sequence - b.sequence)
    .map((m) => ({ ...m }));

  return {
    transaction: { ...txn },
    milestones: result,
    reconciliation: { total: txn.total_amount, sum, reconciled: true },
    idempotentReplay: false,
  };
}

export const SAFETRADE_RPCS = {
  diaspora_safetrade_transition_atomic: safetradeTransitionAtomic,
  diaspora_safetrade_record_milestone_atomic: safetradeRecordMilestoneAtomic,
};

/**
 * SafeTrade durable operation / reconciliation state machine (ST-3 item 3 — Issue #127).
 *
 * The failure this exists to prevent: calling the provider FIRST and writing our ledger AFTERWARDS.
 * If the process dies, the request times out, or the provider answers with something we do not
 * recognise, the money has moved at the provider and our ledger says nothing happened. The user is
 * told the release failed; the funds are gone. Retrying then double-releases.
 *
 * The order is therefore inverted and made durable:
 *
 *   1. reserve()   — write `pending` with an idempotency key BEFORE any network call. If this fails,
 *                    nothing was dispatched, so nothing can be orphaned.
 *   2. markDispatched()
 *   3. call the provider
 *   4. markProviderConfirmed() with the provider reference, or markUnknown() on a timeout/ambiguous
 *      answer — which puts the row in `reconciling`, NOT `failed`, because "we do not know" is not
 *      "it did not happen".
 *   5. the atomic transition RPC moves it to `ledger_applied` in the SAME transaction as the state
 *      change (ledger #22).
 *
 * A row that is not `ledger_applied` is money we cannot account for, and it stays in the operator
 * reconciliation queue until a human or the reconciler resolves it. Nothing here reports success to a
 * user on the strength of a provider response alone.
 */
import { resolveClient } from '../diasporaServiceUtils.js';

export const SAFETRADE_OPERATIONS_TABLE = 'diaspora_safetrade_operations';

export const OPERATION_STATE = Object.freeze({
  PENDING: 'pending',
  PROVIDER_DISPATCHED: 'provider_dispatched',
  PROVIDER_CONFIRMED: 'provider_confirmed',
  LEDGER_APPLIED: 'ledger_applied',
  RECONCILING: 'reconciling',
  FAILED: 'failed',
  COMPENSATED: 'compensated',
});

export const MONEY_OPERATIONS = Object.freeze([
  'create_intent', 'authorize_hold', 'capture', 'release', 'refund', 'partial_refund', 'cancel', 'status_probe',
]);

/** States that still owe an answer — the operator reconciliation queue. */
export const UNRESOLVED_STATES = Object.freeze([
  OPERATION_STATE.PENDING, OPERATION_STATE.PROVIDER_DISPATCHED, OPERATION_STATE.RECONCILING,
]);

const UNIQUE_VIOLATION = '23505';

/**
 * Reserve an operation BEFORE dispatching to the provider.
 *
 * Replaying the same idempotency key returns the EXISTING row with `replay:true` — the caller must
 * then not dispatch again. This is what makes a retried release safe.
 */
export async function reserveOperation({
  tenantId,
  transactionId = null,
  milestoneId = null,
  operation,
  idempotencyKey,
  provider,
  amount = null,
  currency = null,
  approvalId = null,
  requestedBy = null,
  metadata = {},
  supabaseClient = null,
} = {}) {
  if (!tenantId) throw new Error('reserveOperation requires a tenantId');
  if (!operation || !MONEY_OPERATIONS.includes(operation)) {
    throw new Error(`reserveOperation requires a known operation (got ${operation})`);
  }
  if (!idempotencyKey) throw new Error('reserveOperation requires an idempotencyKey');
  if (!provider) throw new Error('reserveOperation requires a provider');

  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_OPERATIONS_TABLE)
    .insert({
      tenant_id: tenantId,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      operation,
      idempotency_key: String(idempotencyKey),
      provider,
      amount,
      currency,
      approval_id: approvalId,
      requested_by: requestedBy,
      state: OPERATION_STATE.PENDING,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION || /duplicate key|uq_diaspora_safetrade_operation_idem/i.test(error.message || '')) {
      const existing = await findByIdempotencyKey(supabase, tenantId, idempotencyKey);
      if (existing) return { operation: existing, replay: true };
    }
    throw new Error(`Failed to reserve SafeTrade operation: ${error.message}`);
  }
  return { operation: data, replay: false };
}

async function findByIdempotencyKey(supabase, tenantId, idempotencyKey) {
  const { data, error } = await supabase
    .from(SAFETRADE_OPERATIONS_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', String(idempotencyKey))
    .maybeSingle();
  if (error) throw new Error(`Failed to read SafeTrade operation: ${error.message}`);
  return data || null;
}

async function patch(supabase, operationId, patchBody) {
  const { data, error } = await supabase
    .from(SAFETRADE_OPERATIONS_TABLE)
    .update({ ...patchBody, updated_at: new Date().toISOString() })
    .eq('id', operationId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update SafeTrade operation: ${error.message}`);
  return data;
}

export async function markDispatched(operationId, { supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  return patch(supabase, operationId, {
    state: OPERATION_STATE.PROVIDER_DISPATCHED,
    dispatched_at: new Date().toISOString(),
  });
}

/**
 * The provider gave a definite answer. `providerRef` is claimed under a partial unique index, so the
 * same provider reference can never be attached to two operations — that constraint is what makes a
 * duplicated provider callback unable to manufacture a second release.
 */
export async function markProviderConfirmed(operationId, { providerRef = null, providerStatus = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  try {
    return await patch(supabase, operationId, {
      state: OPERATION_STATE.PROVIDER_CONFIRMED,
      provider_ref: providerRef,
      provider_status: providerStatus,
      confirmed_at: new Date().toISOString(),
    });
  } catch (e) {
    if (/uq_diaspora_safetrade_operation_provider_ref|duplicate key/i.test(e.message || '')) {
      // Another operation already owns this provider reference. Do NOT fail silently and do NOT
      // pretend success: this is exactly the ambiguity a human must resolve.
      return markUnknown(operationId, 'provider reference already claimed by another operation', { supabaseClient });
    }
    throw e;
  }
}

/**
 * The provider's answer was lost, timed out, or was not recognised.
 *
 * This deliberately does NOT set `failed`. A timeout means the operation may well have succeeded at
 * the provider; treating it as failure is what causes double-spends on retry. It goes to
 * `reconciling` and the caller must surface an in-progress/needs-review state to the user, never
 * success and never a clean failure.
 */
export async function markUnknown(operationId, reason, { supabaseClient = null, retryInSeconds = 60 } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const next = new Date(Date.now() + Math.max(1, Number(retryInSeconds) || 60) * 1000).toISOString();
  const current = await getOperation(operationId, { supabaseClient: supabase });
  return patch(supabase, operationId, {
    state: OPERATION_STATE.RECONCILING,
    last_error_code: 'PROVIDER_RESULT_UNKNOWN',
    last_error: String(reason || 'provider result unknown').slice(0, 500),
    attempts: (current?.attempts || 0) + 1,
    next_attempt_at: next,
  });
}

/** A definite, safe failure: the provider explicitly refused and no money moved. */
export async function markFailed(operationId, { errorCode = 'PROVIDER_REJECTED', reason = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  return patch(supabase, operationId, {
    state: OPERATION_STATE.FAILED,
    last_error_code: errorCode,
    last_error: reason ? String(reason).slice(0, 500) : null,
  });
}

export async function markCompensated(operationId, { reason = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  return patch(supabase, operationId, {
    state: OPERATION_STATE.COMPENSATED,
    reconciled_at: new Date().toISOString(),
    last_error: reason ? String(reason).slice(0, 500) : null,
  });
}

export async function getOperation(operationId, { supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_OPERATIONS_TABLE).select('*').eq('id', operationId).maybeSingle();
  if (error) throw new Error(`Failed to read SafeTrade operation: ${error.message}`);
  return data || null;
}

/**
 * The operator reconciliation queue: every operation that has not reached `ledger_applied`.
 * Tenant-scoped — a tenant operator sees only their own; a platform operator may omit tenantId.
 */
export async function listReconciliationQueue({ tenantId = null, limit = 100, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SAFETRADE_OPERATIONS_TABLE)
    .select('id, tenant_id, transaction_id, milestone_id, operation, state, provider, provider_ref, provider_status, amount, currency, attempts, next_attempt_at, last_error_code, last_error, requested_at, dispatched_at, confirmed_at')
    .in('state', UNRESOLVED_STATES)
    .order('requested_at', { ascending: true })
    .limit(Math.min(Number(limit) || 100, 500));
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list the SafeTrade reconciliation queue: ${error.message}`);
  return data || [];
}

/**
 * Truthful user-facing state for one operation. The point of this mapping is that there is no path
 * from an unresolved operation to the word "success".
 */
export function describeOperationForUser(operation) {
  if (!operation) return { state: 'unknown', userMessage: 'This operation could not be found.', settled: false };
  switch (operation.state) {
    case OPERATION_STATE.LEDGER_APPLIED:
      return { state: operation.state, userMessage: 'Completed and recorded.', settled: true };
    case OPERATION_STATE.FAILED:
      return { state: operation.state, userMessage: 'Did not complete. No funds were moved.', settled: true };
    case OPERATION_STATE.COMPENSATED:
      return { state: operation.state, userMessage: 'Reversed. See the reconciliation record.', settled: true };
    case OPERATION_STATE.RECONCILING:
      return {
        state: operation.state,
        userMessage: 'Awaiting confirmation from the payment provider. Our team is reconciling this — do not retry.',
        settled: false,
      };
    default:
      return { state: operation.state, userMessage: 'In progress.', settled: false };
  }
}

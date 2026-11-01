/**
 * CARUP-PAY-03B-LR01 Work Unit 01 (F5) — operator surface for canonical payment reconciliation holds.
 *
 * The exception row (public.pay03b_payment_reconciliation_exceptions) is the durable operator alert. Operators can
 * read it, acknowledge it and resolve it. A resolution is never decided on stale or guessed evidence: the service
 * performs a FRESH provider read, then the canonical RPC re-checks that evidence against the outcome, the
 * administrator's identity (public.users), separation from the payer and freshness, and re-projects entitlements
 * in the same transaction. Every resolution is audited before the provider read (fail closed) and after.
 */
import { supabase } from '../../db/supabase.js';
import { requirePay01aSandbox } from './pay01aContract.js';
import { requirePay03bSimulator } from './pay03bLocalSimulator.js';
import { readPay01aProviderPaymentTruth } from './pay01aService.js';
import {
  Pay03bError, requireAdminActor, pay03bAuditSucceeded, recordPay03bAudit, pay03bRpcError,
} from './pay03bContract.js';

const TABLE = 'pay03b_payment_reconciliation_exceptions';
const COLUMNS = [
  'id', 'payment_reference', 'exception_type', 'status', 'severity', 'gateway', 'provider_payment_intent_id',
  'payment_amount_minor', 'currency', 'prior_payment_status', 'mismatch', 'detected_refunded_minor',
  'detected_pending_refund_minor', 'detected_refund_ids', 'detected_via', 'detection_event_type', 'first_detected_at',
  'observation_count', 'last_observed_status', 'last_observed_refunded_minor', 'last_observed_pending_refund_minor',
  'last_observed_via', 'last_observed_at', 'acknowledged_by', 'acknowledged_at', 'resolution', 'resolved_by',
  'resolution_note', 'resolved_at',
].join(', ');
const STATUS_FILTERS = new Set(['open', 'resolved', 'superseded', 'all']);
const RESOLUTIONS = new Set(['restore_access_provider_unrefunded', 'revoke_access_partial_refund_final']);
const SOURCE_OF_TRUTH = 'Money state: public.payment_transactions (canonical ledger). Evidence: fresh Stripe sandbox '
  + 'provider readback. Exceptions: public.pay03b_payment_reconciliation_exceptions (immutable once closed).';

/** The operator surface runs wherever canonical sandbox payments exist: PAY-01A sandbox or the PAY-03B UAT simulator. */
function requireOperatorRuntime(env) {
  try { return requirePay01aSandbox(env); } catch (err) {
    try { return requirePay03bSimulator(env); } catch { throw err; }
  }
}

function project(row) {
  if (!row) return null;
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    exceptionType: row.exception_type,
    status: row.status,
    severity: row.severity,
    gateway: row.gateway,
    providerPaymentIntentId: row.provider_payment_intent_id,
    paymentAmountMinor: Number(row.payment_amount_minor),
    currency: row.currency,
    priorPaymentStatus: row.prior_payment_status,
    mismatch: row.mismatch,
    detectedRefundedMinor: Number(row.detected_refunded_minor),
    detectedPendingRefundMinor: Number(row.detected_pending_refund_minor),
    detectedRefundIds: row.detected_refund_ids || [],
    detectedVia: row.detected_via,
    detectionEventType: row.detection_event_type || null,
    firstDetectedAt: row.first_detected_at,
    observationCount: Number(row.observation_count),
    lastObservedStatus: row.last_observed_status,
    lastObservedRefundedMinor: row.last_observed_refunded_minor === null ? null : Number(row.last_observed_refunded_minor),
    lastObservedPendingRefundMinor: row.last_observed_pending_refund_minor === null ? null : Number(row.last_observed_pending_refund_minor),
    lastObservedVia: row.last_observed_via,
    lastObservedAt: row.last_observed_at,
    acknowledgedBy: row.acknowledged_by || null,
    acknowledgedAt: row.acknowledged_at || null,
    resolution: row.resolution || null,
    resolvedBy: row.resolved_by || null,
    resolutionNote: row.resolution_note || null,
    resolvedAt: row.resolved_at || null,
  };
}

async function loadException(db, exceptionId) {
  if (typeof exceptionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(exceptionId)) {
    throw new Pay03bError('PAY03B_RECONCILIATION_EXCEPTION_ID_INVALID', 400);
  }
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq('id', exceptionId).maybeSingle();
  if (error) throw new Pay03bError('PAY03B_RECONCILIATION_READ_UNAVAILABLE', 503);
  if (!data) throw new Pay03bError('PAY03B_RECONCILIATION_EXCEPTION_NOT_FOUND', 404);
  return data;
}

/**
 * Fresh provider truth for the payment behind an exception: PAY-01A Checkout payments through the PAY-01A reader,
 * PAY-03B recurring-invoice payments through the subscription's own provider adapter.
 */
async function providerTruthFor(row, { db, env, stripe, provider = null }) {
  const reference = String(row.payment_reference);
  if (reference.startsWith('pay01a_')) return readPay01aProviderPaymentTruth({ reference, db, env, stripe });
  if (!reference.startsWith('pay03b_inv_')) throw new Pay03bError('PAY03B_RECONCILIATION_PROVIDER_READER_MISSING', 409);
  const { data: invoice, error } = await db.from('pay03b_subscription_invoices')
    .select('provider_payment_intent_id, amount_due_minor, currency, gateway').eq('payment_reference', reference).maybeSingle();
  if (error || !invoice) throw new Pay03bError('PAY03B_RECONCILIATION_READ_UNAVAILABLE', 503);
  const { resolvePay03bProvider } = await import('./pay03bSubscriptionService.js');
  const adapter = resolvePay03bProvider({ env, stripe, provider });
  if (adapter.gateway !== invoice.gateway) throw new Pay03bError('PAY03B_PROVIDER_GATEWAY_MISMATCH', 409);
  await adapter.verifyAccount();
  // Taken BEFORE the provider read (see readPay01aProviderPaymentTruth): superseded evidence is refused in SQL.
  const verifiedAt = new Date().toISOString();
  const truth = await adapter.getPaymentTruth({ paymentIntentId: invoice.provider_payment_intent_id,
    amountMinor: Number(invoice.amount_due_minor), currency: invoice.currency });
  return { reference, status: truth.status, intentId: truth.intentId, refundedMinor: truth.refundedMinor,
    pendingRefundMinor: truth.pendingRefundMinor, refundIds: truth.refundIds, mismatch: truth.mismatch, verifiedAt };
}

export async function listPay03bReconciliationExceptions({ status = 'open', db = supabase, env = process.env } = {}) {
  requireOperatorRuntime(env);
  if (!STATUS_FILTERS.has(status)) throw new Pay03bError('PAY03B_RECONCILIATION_STATUS_FILTER_INVALID', 400);
  let query = db.from(TABLE).select(COLUMNS);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query.order('first_detected_at', { ascending: false }).limit(100);
  if (error) throw new Pay03bError('PAY03B_RECONCILIATION_READ_UNAVAILABLE', 503);
  const exceptions = (data || []).map(project);
  const { data: openRows, error: openError } = await db.from(TABLE).select('id').eq('status', 'open');
  if (openError) throw new Pay03bError('PAY03B_RECONCILIATION_READ_UNAVAILABLE', 503);
  return { exceptions, openCount: (openRows || []).length, sourceOfFinancialTruth: SOURCE_OF_TRUTH };
}

export async function readPay03bReconciliationException({
  exceptionId, verify = false, db = supabase, env = process.env, stripe = null, provider = null,
} = {}) {
  requireOperatorRuntime(env);
  const row = await loadException(db, exceptionId);
  const providerTruth = verify ? await providerTruthFor(row, { db, env, stripe, provider }) : null;
  return { exception: project(row), providerTruth, sourceOfFinancialTruth: SOURCE_OF_TRUTH };
}

export async function acknowledgePay03bReconciliationException({
  exceptionId, adminActorId, adminActorRole = 'admin', sourceRoute = null, requestContext = null,
  db = supabase, env = process.env,
} = {}) {
  requireOperatorRuntime(env);
  const admin = requireAdminActor(adminActorId);
  await loadException(db, exceptionId);
  const { data, error } = await db.rpc('pay03b_acknowledge_payment_reconciliation_exception', {
    p_exception_id: exceptionId, p_actor_id: admin, p_actor_role: adminActorRole,
  });
  if (error) throw pay03bRpcError(error);
  await recordPay03bAudit(db, {
    eventType: 'PAY03B_RECONCILIATION_EXCEPTION_ACKNOWLEDGED', actorId: admin, actorRole: adminActorRole,
    sourceRoute, requestContext, reason: 'Administrator acknowledged a payment reconciliation alert.',
    subject: { exceptionId, paymentReference: data?.payment_reference || null },
  });
  return { exception: project(data) };
}

export async function resolvePay03bReconciliationException({
  exceptionId, resolution, note, adminActorId, adminActorRole = 'admin', sourceRoute = null, requestContext = null,
  db = supabase, env = process.env, stripe = null, provider = null,
} = {}) {
  requireOperatorRuntime(env);
  const admin = requireAdminActor(adminActorId);
  if (!RESOLUTIONS.has(resolution)) throw new Pay03bError('PAY03B_RESOLUTION_INVALID', 400);
  const reason = typeof note === 'string' ? note.trim() : '';
  if (reason.length < 10 || reason.length > 1000) throw new Pay03bError('PAY03B_RESOLUTION_NOTE_REQUIRED', 400);
  const before = await loadException(db, exceptionId);
  if (before.status !== 'open') throw new Pay03bError('PAY03B_RECONCILIATION_EXCEPTION_NOT_OPEN', 409);
  const subject = {
    exceptionId, paymentReference: before.payment_reference, resolution,
    detectedRefundedMinor: Number(before.detected_refunded_minor), paymentAmountMinor: Number(before.payment_amount_minor),
  };

  // Fail closed: nothing (not even the provider read) happens unless WHO asked is recorded first.
  const requested = await recordPay03bAudit(db, {
    eventType: 'PAY03B_RECONCILIATION_RESOLUTION_REQUESTED', actorId: admin, actorRole: adminActorRole,
    sourceRoute, requestContext, reason, subject,
  });
  if (!pay03bAuditSucceeded(requested)) throw new Pay03bError('PAY03B_RECONCILIATION_AUDIT_UNAVAILABLE', 503);

  let providerTruth;
  try {
    providerTruth = await providerTruthFor(before, { db, env, stripe, provider });
    const { data, error } = await db.rpc('pay03b_resolve_payment_reconciliation_exception', {
      p_exception_id: exceptionId,
      p_resolution: resolution,
      p_actor_id: admin,
      p_actor_role: adminActorRole,
      p_note: reason,
      p_verified_status: providerTruth.status,
      p_verified_refunded_minor: providerTruth.refundedMinor,
      p_verified_pending_refund_minor: providerTruth.pendingRefundMinor,
      p_verified_refund_ids: providerTruth.refundIds,
      p_verified_at: providerTruth.verifiedAt,
    });
    if (error) throw pay03bRpcError(error);
    const outcome = {
      exception: project(data.exception),
      paymentStatus: data.payment_status,
      entitlementStatus: data.sync?.report_entitlement_status ?? null,
      providerTruth,
      sourceOfFinancialTruth: SOURCE_OF_TRUTH,
    };
    const resultAudit = await recordPay03bAudit(db, {
      eventType: 'PAY03B_RECONCILIATION_RESOLUTION_RESULT', actorId: admin, actorRole: adminActorRole,
      sourceRoute, requestContext, reason,
      subject: { ...subject, outcome: 'resolved', paymentStatus: outcome.paymentStatus,
        entitlementStatus: outcome.entitlementStatus, verifiedStatus: providerTruth.status,
        verifiedRefundedMinor: providerTruth.refundedMinor, verifiedAt: providerTruth.verifiedAt },
    });
    if (!pay03bAuditSucceeded(resultAudit)) {
      console.warn('[pay03b] reconciliation RESULT audit write failed', { exceptionId });
    }
    return outcome;
  } catch (err) {
    await recordPay03bAudit(db, {
      eventType: 'PAY03B_RECONCILIATION_RESOLUTION_RESULT', actorId: admin, actorRole: adminActorRole,
      sourceRoute, requestContext, reason,
      subject: { ...subject, outcome: 'failed', errorCode: err?.code || 'PAY03B_RESOLUTION_FAILED',
        verifiedStatus: providerTruth?.status || null },
    });
    throw err;
  }
}

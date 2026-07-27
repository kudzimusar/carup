// Mounted by integrator inside /api/diaspora
//
// Phase 9 — SafeTrade escrow/assurance overlay routes (directive §48). This router is intentionally
// NOT mounted by this program: the integrator mounts it inside diasporaRoutes.js / server.js (e.g.
// `router.use('/safetrade', diasporaSafeTradeRoutes)`), exactly like the Phase 8 subscription routes.
//
// EVERY route is gated behind isSafeTradeEnabled() (DIASPORA_SAFETRADE_ENABLED, default OFF): when the
// flag is off the whole surface returns 404 (inert), so wiring this router has zero effect until the
// flag is set. Authorization uses the SAME server-derived authorizeRole middleware as diasporaRoutes.js
// (the client x-stakeholder-role can never escalate). Money never moves through a live provider: the
// services route every money op through the SANDBOX provider and the atomic RPC, which fail closed with
// EXTERNAL_ACTIVATION_REQUIRED on any live/non-sandbox path. The payment webhook is HMAC-signature
// verified + idempotent (no money is moved by a webhook; it only reconciles sandbox provider state).
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
import { isSafeTradeEnabled, SAFETRADE_POLICY_VERSION } from '../constants/diaspora/diasporaSafeTradeConstants.js';
import { requestCorrelationId } from '../services/diaspora/diasporaServiceUtils.js';
import {
  createTransaction,
  getTransaction,
  listTransactions,
  transition,
  getTimeline,
} from '../services/diaspora/safetrade/diasporaSafeTradeTransactionService.js';
import {
  createMilestones,
  listMilestones,
  recordMilestone,
} from '../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js';
import { evaluateEligibility } from '../services/diaspora/safetrade/diasporaSafeTradeEligibilityService.js';
import { evaluateRelease } from '../services/diaspora/safetrade/diasporaSafeTradeReleasePolicyService.js';
import {
  createDispute,
  listDisputes,
  addEvidence,
  listEvidence,
  resolveDispute,
} from '../services/diaspora/safetrade/diasporaSafeTradeDisputeService.js';
import { getSharedSandboxPaymentProvider } from '../services/diaspora/safetrade/safeTradePaymentProvider.js';
import { computeAvailableActions } from '../services/diaspora/safetrade/diasporaSafeTradeAvailableActions.js';
// ST-3 closure (Issue #127): durable provider-event ledger, maker-checker approvals and the operator
// reconciliation queue. These replace the process-memory webhook Set and add the second-human gate.
import {
  claimProviderEvent,
  markEventApplied,
  markEventFailed,
  listEventDeadLetters,
} from '../services/diaspora/safetrade/diasporaSafeTradeEventLedgerService.js';
import {
  requestApproval,
  approve as approveDecision,
  reject as rejectDecision,
  listPendingApprovals,
} from '../services/diaspora/safetrade/diasporaSafeTradeApprovalService.js';
import {
  listReconciliationQueue,
  describeOperationForUser,
} from '../services/diaspora/safetrade/diasporaSafeTradeOperationService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Server-derived role gate for SafeTrade REVIEWER routes (evaluate/approve release, resolve dispute).
// Gate S9-A: aligned exactly to the service boundary `isPrivileged` (isPlatformAdmin || isPlatformReviewer):
// `dealer` is REMOVED — it is NOT a platform reviewer/admin, the service already rejects it, and billing/
// release is not a dealer capability. government/government_reviewer/reviewer remain canonical reviewers.
const auth = authorizeRole();
const reviewerAuth = authorizeRole(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer']);

// Master feature gate: when DIASPORA_SAFETRADE_ENABLED is off the SafeTrade surface is inert.
// Returning 404 (not 403) keeps the feature undiscoverable while disabled. The guard is scoped to
// '/safetrade' so that, when this router is mounted at the diaspora root, requests for sibling
// routes (containers, shipments, OCR, reservations, …) fall through instead of being 404'd here.
router.use('/safetrade', (req, res, next) => {
  if (!isSafeTradeEnabled()) {
    return res.status(404).json({ error: 'SafeTrade is not enabled' });
  }
  return next();
});

function pagination(req) {
  return {
    limit: Math.min(Number(req.query.limit || 50), 100),
    offset: Number(req.query.offset || 0),
  };
}

// ── Transactions ─────────────────────────────────────────────────────────────

// GET /safetrade — list SafeTrade transactions (tenant + participant scoped in the service).
router.get('/safetrade', auth, asyncHandler(async (req, res) => {
  const data = await listTransactions(undefined, {
    tenantId: req.userContext.tenantId || null,
    status: req.query.status || null,
    importOrderId: req.query.importOrderId || null,
    userContext: req.userContext,
    ...pagination(req),
  });
  res.json({ data, pagination: pagination(req) });
}));

// POST /safetrade — create a DRAFT SafeTrade transaction (entitlement + eligibility gated in the service).
router.post('/safetrade', auth, asyncHandler(async (req, res) => {
  const data = await createTransaction(undefined, {
    importOrderId: req.body.importOrderId,
    sellerId: req.body.sellerId || null,
    currency: req.body.currency || 'USD',
    totalAmount: req.body.totalAmount,
    tenantId: req.userContext.tenantId || null,
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.status(201).json(data);
}));

// GET /safetrade/:id — participant/privileged scoped read.
router.get('/safetrade/:id', auth, asyncHandler(async (req, res) => {
  res.json(await getTransaction(undefined, { transactionId: req.params.id, userContext: req.userContext }));
}));

// GET /safetrade/:id/timeline — the SafeTrade audit trail for the transaction.
router.get('/safetrade/:id/timeline', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getTimeline(undefined, { transactionId: req.params.id, userContext: req.userContext }) });
}));

// GET /safetrade/:id/eligibility — explainable eligibility verdict for the linked order (read-only).
router.get('/safetrade/:id/eligibility', auth, asyncHandler(async (req, res) => {
  const txn = await getTransaction(undefined, { transactionId: req.params.id, userContext: req.userContext });
  const verdict = await evaluateEligibility(undefined, {
    importOrderId: txn.import_order_id,
    buyerContext: req.userContext,
    sellerId: txn.seller_id,
    tenantId: txn.tenant_id || req.userContext.tenantId || null,
    requestedCurrency: txn.currency,
    evaluatedAt: req.fixedTimestamp || null,
  });
  res.json(verdict);
}));

// GET /safetrade/:id/milestones — list the transaction's escrow milestones.
router.get('/safetrade/:id/milestones', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listMilestones(undefined, { transactionId: req.params.id, userContext: req.userContext }) });
}));

// GET /safetrade/:id/available-actions — server-derived, role/state/tenant-safe action projection.
// The UI renders action controls from THIS (it must not duplicate the 16-state transition table).
// getTransaction enforces participant/privileged read access (403s outsiders) before the pure projection.
router.get('/safetrade/:id/available-actions', auth, asyncHandler(async (req, res) => {
  const txn = await getTransaction(undefined, { transactionId: req.params.id, userContext: req.userContext });
  const [milestones, disputes] = await Promise.all([
    listMilestones(undefined, { transactionId: req.params.id, userContext: req.userContext }),
    listDisputes(undefined, { transactionId: req.params.id, userContext: req.userContext }),
  ]);
  res.json({ data: computeAvailableActions(txn, req.userContext, { milestones, dispute: disputes }) });
}));

// POST /safetrade/:id/milestones — define/seed the milestone set (atomic reconciliation RPC).
router.post('/safetrade/:id/milestones', auth, asyncHandler(async (req, res) => {
  const data = await createMilestones(undefined, {
    transactionId: req.params.id,
    milestones: req.body.milestones,
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.status(201).json(data);
}));

// POST /safetrade/:id/commit — dispatch a lifecycle transition (e.g. SELLER_COMMIT, HOLD_PAYMENT,
// SUBMIT_COMPLIANCE …). The service validates structural legality, authority and money fail-closed.
router.post('/safetrade/:id/commit', auth, asyncHandler(async (req, res) => {
  if (!req.body.event) throw new ValidationError('event is required');
  const data = await transition(undefined, {
    transactionId: req.params.id,
    event: req.body.event,
    reason: req.body.reason || null,
    metadata: req.body.metadata || {},
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.json(data);
}));

// POST /safetrade/:id/evaluate-release — run the release policy engine and RECORD an evaluation row
// (append-only; never moves money). Reviewer/admin only — it is the N5 approval surface.
router.post('/safetrade/:id/evaluate-release', reviewerAuth, asyncHandler(async (req, res) => {
  const txn = await getTransaction(undefined, { transactionId: req.params.id, userContext: req.userContext });
  const verdict = await evaluateRelease(undefined, {
    safeTradeId: req.params.id,
    milestoneId: req.body.milestoneId || null,
    actorContext: req.userContext,
    evaluatedAt: req.fixedTimestamp || null,
  });
  const evaluation = await recordReleaseEvaluation(req, { txn, verdict });
  res.status(201).json({ evaluation, verdict });
}));

// POST /safetrade/:id/request-release — request escrow release (drives the txn into RELEASE_REVIEW or
// performs a reviewer-gated milestone money staging op). Delegates to the transition/milestone service.
router.post('/safetrade/:id/request-release', auth, asyncHandler(async (req, res) => {
  if (req.body.milestoneId && req.body.operation) {
    const data = await recordMilestone(undefined, {
      transactionId: req.params.id,
      milestoneId: req.body.milestoneId,
      operation: req.body.operation,
      evaluationId: req.body.evaluationId || null,
      idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
      userContext: req.userContext,
      req,
    });
    return res.json(data);
  }
  const data = await transition(undefined, {
    transactionId: req.params.id,
    event: req.body.event || 'MARK_ARRIVED',
    reason: req.body.reason || 'release requested',
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  return res.json(data);
}));

// POST /safetrade/:id/approve-release — reviewer/admin authorizes release (RELEASE_ESCROW) with a
// passing prior evaluation, or performs the reviewer-gated milestone RELEASE money op. N5 enforced.
router.post('/safetrade/:id/approve-release', reviewerAuth, asyncHandler(async (req, res) => {
  if (req.body.milestoneId) {
    const data = await recordMilestone(undefined, {
      transactionId: req.params.id,
      milestoneId: req.body.milestoneId,
      operation: req.body.operation || 'RELEASE',
      evaluationId: req.body.evaluationId || null,
      idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
      userContext: req.userContext,
      req,
    });
    return res.json(data);
  }
  const data = await transition(undefined, {
    transactionId: req.params.id,
    event: 'RELEASE_ESCROW',
    evaluationId: req.body.evaluationId || null,
    reason: req.body.reason || 'release approved',
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  return res.json(data);
}));

// POST /safetrade/:id/cancel — cancel the transaction (CANCEL; forbidden from escrow-held states).
router.post('/safetrade/:id/cancel', auth, asyncHandler(async (req, res) => {
  const data = await transition(undefined, {
    transactionId: req.params.id,
    event: 'CANCEL',
    reason: req.body.reason || null,
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.json(data);
}));

// ── Disputes ─────────────────────────────────────────────────────────────────

// POST /safetrade/:id/disputes — open a dispute (drives DISPUTED + a temporary sandbox HOLD).
router.post('/safetrade/:id/disputes', auth, asyncHandler(async (req, res) => {
  const data = await createDispute(undefined, {
    transactionId: req.params.id,
    milestoneId: req.body.milestoneId || null,
    category: req.body.category || 'OTHER',
    reason: req.body.reason,
    evidence: req.body.evidence || null,
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.status(201).json(data);
}));

// GET /safetrade/:id/disputes — list disputes for the transaction (participant/privileged scoped).
router.get('/safetrade/:id/disputes', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listDisputes(undefined, { transactionId: req.params.id, userContext: req.userContext }) });
}));

// POST /safetrade/disputes/:id/evidence — append evidence/statement (participant-privacy redacted reads).
router.post('/safetrade/disputes/:id/evidence', auth, asyncHandler(async (req, res) => {
  const data = await addEvidence(undefined, {
    disputeId: req.params.id,
    evidenceType: req.body.evidenceType || 'STATEMENT',
    statement: req.body.statement || null,
    documentRef: req.body.documentRef || null,
    evidenceRefs: req.body.evidenceRefs || [],
    visibility: req.body.visibility || 'PARTICIPANTS',
    userContext: req.userContext,
    req,
  });
  res.status(201).json(data);
}));

// GET /safetrade/disputes/:id/evidence — read the dispute evidence timeline with SERVER-SIDE privacy
// redaction (ST-4B). listEvidence() denies non-participant/non-privileged callers (403), returns all
// rows to reviewers/admins, and for an ordinary participant filters out REVIEWERS_ONLY and other
// authors' AUTHOR_ONLY rows using the server-derived identity. The server is the privacy boundary; the
// client visibleEvidence() filter is defense-in-depth only. No storage paths/PII are added here.
router.get('/safetrade/disputes/:id/evidence', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listEvidence(undefined, { disputeId: req.params.id, userContext: req.userContext }) });
}));

// POST /safetrade/disputes/:id/resolve — reviewer/admin terminal resolution (sandbox refund/release).
router.post('/safetrade/disputes/:id/resolve', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await resolveDispute(undefined, {
    disputeId: req.params.id,
    resolution: req.body.resolution,
    milestoneId: req.body.milestoneId || null,
    evaluationId: req.body.evaluationId || null,
    notes: req.body.notes || null,
    idempotencyKey: req.body.idempotencyKey || req.headers['x-idempotency-key'] || null,
    userContext: req.userContext,
    req,
  });
  res.json(data);
}));

// ── Maker-checker approvals (ST-3 item 2 — Issue #127) ───────────────────────
//
// A high-risk release or refund needs two different humans. These routes are the MAKER's request and
// the CHECKER's approval. The transition RPC re-verifies both halves under its row lock and consumes
// the approval, so nothing here is the only thing standing between one human and the money.

// GET /safetrade/approvals — the pending queue for the caller's own tenant.
router.get('/safetrade/approvals', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await listPendingApprovals({
    tenantId: req.userContext.tenantId,
    userContext: req.userContext,
  });
  res.json({ data });
}));

// POST /safetrade/approvals — MAKER requests approval. The requester is the server-derived user; a
// body-supplied requester would let one human play both roles.
router.post('/safetrade/approvals', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await requestApproval({
    tenantId: req.userContext.tenantId,
    transactionId: req.body?.transactionId,
    milestoneId: req.body?.milestoneId || null,
    decisionType: req.body?.decisionType,
    evaluationId: req.body?.evaluationId || null,
    riskLevel: req.body?.riskLevel || 'HIGH',
    amount: req.body?.amount ?? null,
    currency: req.body?.currency || null,
    reason: req.body?.reason || null,
    userContext: req.userContext,
    req,
  });
  res.status(201).json({ data });
}));

// POST /safetrade/approvals/:id/approve — CHECKER approves. Self-approval is refused.
router.post('/safetrade/approvals/:id/approve', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await approveDecision({
    approvalId: req.params.id,
    userContext: req.userContext,
    notes: req.body?.notes || null,
    req,
  });
  res.json({ data });
}));

// POST /safetrade/approvals/:id/reject — CHECKER refuses.
router.post('/safetrade/approvals/:id/reject', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await rejectDecision({
    approvalId: req.params.id,
    userContext: req.userContext,
    reason: req.body?.reason || null,
    req,
  });
  res.json({ data });
}));

// ── Operator reconciliation queue (ST-3 item 3) ──────────────────────────────
//
// Every operation that has not reached `ledger_applied` is money we cannot yet account for. Making it
// visible is the difference between a reconciliation process and a silent discrepancy.
router.get('/safetrade/reconciliation', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await listReconciliationQueue({ tenantId: req.userContext.tenantId });
  res.json({ data: data.map((op) => ({ ...op, userState: describeOperationForUser(op) })) });
}));

// GET /safetrade/dead-letters — provider events that failed processing and need a human.
router.get('/safetrade/dead-letters', reviewerAuth, asyncHandler(async (req, res) => {
  const data = await listEventDeadLetters({ tenantId: req.userContext.tenantId });
  res.json({ data });
}));

// ── Payment webhook (signature-verified + DURABLY idempotent) ────────────────

// POST /safetrade/payment-webhook — verify the HMAC signature + anti-replay drift, then reconcile the
// provider event idempotently. No auth middleware (providers cannot present a user session); the HMAC
// signature IS the authentication. Returns 401 on a bad/late/missing signature.
//
// ST-3 item 4: de-duplication is now a UNIQUE (provider, event_id) row in Postgres, not a
// process-memory Set. The old Set was per-instance and per-deploy — under Fluid Compute each instance
// kept its own copy, so one event could be processed once per instance, and a redeploy wiped the
// memory entirely, making an hours-later duplicate look new. Out-of-order deliveries are recorded and
// marked superseded rather than applied backwards.
router.post('/safetrade/payment-webhook', express.json(), asyncHandler(async (req, res) => {
  const provider = getSharedSandboxPaymentProvider();
  const signature = req.headers['x-safetrade-signature'] || null;
  const timestamp = req.headers['x-safetrade-timestamp'] || null;
  // Prefer the exact bytes the provider signed; fall back to the parsed body only when no raw capture
  // is available (the signature check itself is unchanged either way).
  const rawBody = req.rawBody != null ? req.rawBody : req.body;

  const verified = await provider.verifyWebhook({
    rawBody,
    signature,
    timestamp: timestamp == null ? null : Number(timestamp),
    now: req.fixedTimestamp ? Date.parse(req.fixedTimestamp) : null,
  });
  if (!verified.verified) {
    return res.status(401).json({ error: 'invalid webhook signature' });
  }
  if (!verified.eventId) {
    // An event with no id cannot be de-duplicated, so it cannot be processed safely at all.
    return res.status(400).json({ error: 'webhook payload is missing an event id' });
  }

  const claim = await claimProviderEvent({
    provider: provider.name,
    eventId: verified.eventId,
    eventType: verified.eventType,
    intentId: verified.intentId,
    payload: verified.payload || {},
    signatureVerified: true,
    correlationId: requestCorrelationId(req),
  });

  if (claim.duplicate) {
    return res.json({ ok: true, idempotentReplay: true, eventId: verified.eventId });
  }
  if (claim.superseded) {
    // Durable and auditable, but deliberately not applied: newer state already won.
    return res.json({ ok: true, idempotentReplay: false, superseded: true, eventId: verified.eventId });
  }

  try {
    const effect = await provider.reconcileEvent({ event: verified });
    await markEventApplied(claim.event.id);
    return res.json({ ok: true, idempotentReplay: false, eventId: verified.eventId, effect });
  } catch (e) {
    // The event stays claimed (so a retry cannot double-apply) and lands in the dead-letter view.
    await markEventFailed(claim.event.id, e.message, { deadLetter: true });
    throw e;
  }
}));

/**
 * recordReleaseEvaluation — append-only insert of a release-evaluation row from a policy verdict. The
 * row is the N5 record the transition RPC re-reads inside its lock; reviewer-evaluated + eligible is the
 * high-risk approval gate. This NEVER moves money — it only records the decision.
 */
async function recordReleaseEvaluation(req, { txn, verdict }) {
  const { resolveClient } = await import('../services/diaspora/diasporaServiceUtils.js');
  const supabase = await resolveClient({});
  const { data, error } = await supabase
    .from('diaspora_safetrade_release_evaluations')
    .insert({
      tenant_id: txn.tenant_id || null,
      transaction_id: txn.id,
      milestone_id: req.body.milestoneId || null,
      eligible: Boolean(verdict.eligible),
      blockers: verdict.blockers || [],
      evidence_refs: verdict.evidenceRefs || [],
      requires_reviewer: Boolean(verdict.requiresApproval),
      risk_level: verdict.riskTier === 'HIGH' ? 'HIGH' : (verdict.riskTier === 'LOW' ? 'LOW' : 'MEDIUM'),
      policy_version: txn.policy_version || SAFETRADE_POLICY_VERSION,
      evaluated_by: req.userContext.id,
      evaluated_at: req.fixedTimestamp || verdict.evaluatedAt || new Date().toISOString(),
      metadata: { correlationId: requestCorrelationId(req) },
      created_by: req.userContext.id,
      updated_by: req.userContext.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to record release evaluation: ${error.message}`);
  return data;
}

// Surface the SafeTrade-disabled guard as a typed error for any code path that bypasses the router gate.
export function assertSafeTradeRouteEnabled() {
  if (!isSafeTradeEnabled()) throw new ForbiddenError('SafeTrade is disabled', { code: 'SAFETRADE_DISABLED' });
}

export default router;

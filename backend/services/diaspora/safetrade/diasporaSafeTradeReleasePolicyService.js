/**
 * Phase 9 — SafeTrade RELEASE POLICY engine (read-only, the last line before money moves).
 *
 * `evaluateRelease` is a PURE decision engine evaluating CURRENT authoritative state only — it re-reads
 * every row fresh, never trusts a cached/passed-in state, never trusts the creation-time eligibility
 * verdict. It NEVER mutates state, NEVER moves money, NEVER writes audit, NEVER calls a provider. It
 * returns an explainable verdict envelope:
 *   { eligible, blockers[], evidenceRefs[], policyVersion, evaluatedAt, requiresApproval, riskTier, providerMode }
 *
 * Money-safety guarantees (directive §5.2 / N1, N5):
 *  - eligible:true is returned ONLY when a held payment milestone exists (HELD/funded escrow) AND all
 *    BLOCK checks pass AND, if HIGH risk, a reviewer/admin approval record exists. There is NO override
 *    branch and NO path producing eligible:true without a held milestone in evidenceRefs.
 *  - HIGH risk ⇒ requiresApproval:true and a REVIEWER_APPROVAL_REQUIRED blocker until an approval row by
 *    a server-derived platform admin/reviewer exists, EVEN when every automated condition passes.
 *  - When DIASPORA_SAFETRADE_LIVE_PAYMENT is off, any non-sandbox provider on the transaction is a
 *    LIVE_PAYMENT_DISABLED blocker; the engine never activates a provider (that throw lives in the executor).
 * The whole surface is gated by DIASPORA_SAFETRADE_ENABLED (default OFF) — short-circuits with
 * SAFETRADE_DISABLED and reads no DB.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import {
  isSafeTradeEnabled,
  isSafeTradeLivePaymentEnabled,
  SAFETRADE_POLICY_VERSION,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import { SAFETRADE_RISK_TIERS } from '../../../constants/diaspora/diasporaSafeTradeStatuses.js';
import {
  isPlatformAdmin,
  isPlatformReviewer,
  normalizeId,
} from '../diasporaAuthorization.js';

export const SAFETRADE_RELEASE_BLOCKER_CODES = Object.freeze({
  SAFETRADE_DISABLED: 'SAFETRADE_DISABLED',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  PAYMENT_NOT_HELD: 'PAYMENT_NOT_HELD',
  TOTALS_UNRECONCILED: 'TOTALS_UNRECONCILED',
  COMPLIANCE_NOT_APPROVED: 'COMPLIANCE_NOT_APPROVED',
  DOCUMENTS_NOT_VERIFIED: 'DOCUMENTS_NOT_VERIFIED',
  SHIPMENT_MILESTONE_NOT_REACHED: 'SHIPMENT_MILESTONE_NOT_REACHED',
  DELIVERY_NOT_CONFIRMED: 'DELIVERY_NOT_CONFIRMED',
  ACTIVE_DISPUTE: 'ACTIVE_DISPUTE',
  SECURITY_HOLD: 'SECURITY_HOLD',
  ACTOR_NOT_AUTHORIZED: 'ACTOR_NOT_AUTHORIZED',
  LIVE_PAYMENT_DISABLED: 'LIVE_PAYMENT_DISABLED',
  REVIEWER_APPROVAL_REQUIRED: 'REVIEWER_APPROVAL_REQUIRED',
});

const BLK = SAFETRADE_RELEASE_BLOCKER_CODES;

// Milestone statuses that represent funds notionally held in (sandbox) escrow custody.
const HELD_MILESTONE_STATUSES = new Set(['FUNDED', 'HELD', 'RELEASE_REVIEW', 'RELEASE_AUTHORIZED']);

// Risk threshold: above this amount the transaction is HIGH risk (conservative default).
const HIGH_RISK_AMOUNT_THRESHOLD = 25000;

// Reconciliation tolerance at numeric(_,2) scale.
const RECONCILIATION_TOLERANCE = 0.005;

async function resolveSafeTradeClient(supabaseOrOptions, options = {}) {
  if (supabaseOrOptions && typeof supabaseOrOptions.from === 'function') return supabaseOrOptions;
  const injected = options.supabaseClient || supabaseOrOptions?.supabaseClient || null;
  return resolveClient(injected ? { supabaseClient: injected } : {});
}

function evidenceRef({ kind, table, recordId = null, observed = {}, satisfied }) {
  return { kind, table, recordId: recordId == null ? null : String(recordId), observed, satisfied };
}

function blocker({ code, message, evidence = null, remediation, policyClause = '§43' }) {
  return { code, message, severity: 'BLOCK', evidenceRef: evidence, remediation, policyClause };
}

/**
 * evaluateRelease — the strictest gate (directive §43). `evaluatedAt` uses an injected fixed timestamp
 * when provided (tests), else current ISO time.
 */
export async function evaluateRelease(supabaseOrOptions, {
  safeTradeId,
  milestoneId = null,
  actorContext = null,
  evaluatedAt = null,
  options = {},
} = {}) {
  const policyVersion = SAFETRADE_POLICY_VERSION;
  const at = evaluatedAt || new Date().toISOString();
  const providerMode = isSafeTradeLivePaymentEnabled() ? 'live' : 'sandbox';

  // Check 0 — feature flag (short-circuit, no DB read).
  if (!isSafeTradeEnabled()) {
    return {
      eligible: false,
      blockers: [blocker({ code: BLK.SAFETRADE_DISABLED, message: 'SafeTrade is disabled (DIASPORA_SAFETRADE_ENABLED is off).', remediation: 'Enable DIASPORA_SAFETRADE_ENABLED.', policyClause: '§N7' })],
      evidenceRefs: [],
      policyVersion,
      evaluatedAt: at,
      requiresApproval: true,
      riskTier: SAFETRADE_RISK_TIERS.HIGH,
      providerMode,
    };
  }

  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const blockers = [];
  const evidenceRefs = [];
  const add = (ev, blk = null) => { if (ev) evidenceRefs.push(ev); if (blk) blockers.push(blk); };

  // Load the SafeTrade transaction (authoritative anchor).
  let txn = null;
  if (safeTradeId) {
    const { data } = await supabase
      .from('diaspora_safetrade_transactions')
      .select('*')
      .eq('id', safeTradeId)
      .is('deleted_at', null)
      .maybeSingle();
    txn = data || null;
  }
  if (!txn) {
    return {
      eligible: false,
      blockers: [blocker({ code: BLK.TRANSACTION_NOT_FOUND, message: 'The SafeTrade transaction was not found.', remediation: 'Provide a valid safeTradeId.', policyClause: '§43.txn' })],
      evidenceRefs: [evidenceRef({ kind: 'safetrade_transaction', table: 'diaspora_safetrade_transactions', recordId: safeTradeId || null, observed: { found: false }, satisfied: false })],
      policyVersion,
      evaluatedAt: at,
      requiresApproval: true,
      riskTier: SAFETRADE_RISK_TIERS.HIGH,
      providerMode,
    };
  }
  evidenceRefs.push(evidenceRef({ kind: 'safetrade_transaction', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { status: txn.status, total_amount: txn.total_amount, payment_provider: txn.payment_provider, live_payment: txn.live_payment }, satisfied: true }));

  // Load milestones for the transaction.
  const { data: milestoneRows } = await supabase
    .from('diaspora_safetrade_milestones')
    .select('*')
    .eq('transaction_id', txn.id)
    .is('deleted_at', null);
  const milestones = (milestoneRows || []).filter((m) => (milestoneId ? m.id === milestoneId : true));

  // Check 1 — payment exists and is HELD (the hard money-safety precondition).
  const heldMilestone = milestones.find((m) => HELD_MILESTONE_STATUSES.has(m.status));
  const heldEv = evidenceRef({
    kind: 'safetrade_milestone',
    table: 'diaspora_safetrade_milestones',
    recordId: heldMilestone?.id ?? null,
    observed: { status: heldMilestone?.status ?? null, milestoneCount: milestones.length },
    satisfied: Boolean(heldMilestone),
  });
  if (!heldMilestone) {
    add(heldEv, blocker({ code: BLK.PAYMENT_NOT_HELD, message: 'No held (funded) escrow milestone exists for this transaction.', remediation: 'Capture/hold the escrow payment first.', policyClause: '§43.payment' }));
  } else {
    evidenceRefs.push(heldEv);
  }

  // Check 1b — totals reconcile to the transaction total (drift becomes a blocker, never auto-release).
  const milestoneSum = round2((milestoneRows || [])
    .filter((m) => m.milestone_type !== 'REFUND' && !['CANCELLED', 'WAIVED'].includes(m.status))
    .reduce((s, m) => s + Number(m.amount || 0), 0));
  const total = Number(txn.total_amount || 0);
  const reconciled = Math.abs(milestoneSum - total) <= RECONCILIATION_TOLERANCE;
  const reconEv = evidenceRef({ kind: 'reconciliation', table: 'diaspora_safetrade_milestones', recordId: txn.id, observed: { sum: milestoneSum, total, reconciled }, satisfied: reconciled });
  if (!reconciled && milestones.length > 0) {
    add(reconEv, blocker({ code: BLK.TOTALS_UNRECONCILED, message: `Milestone total (${milestoneSum}) does not reconcile to the transaction total (${total}).`, remediation: 'Re-balance the milestone plan to the transaction total.', policyClause: '§43.reconcile' }));
  } else {
    evidenceRefs.push(reconEv);
  }

  // Check 2 — required compliance approved (human decision; never auto-derived).
  const { data: reviews } = await supabase
    .from('diaspora_compliance_reviews')
    .select('*')
    .eq('import_order_id', txn.import_order_id);
  const reviewRows = reviews || [];
  const hasApproved = reviewRows.some((r) => r.status === 'APPROVED');
  const openFlag = reviewRows.find((r) => ['FLAGGED', 'REJECTED'].includes(r.status));
  const complianceSatisfied = hasApproved && !openFlag;
  const compEv = evidenceRef({ kind: 'compliance_review', table: 'diaspora_compliance_reviews', recordId: (reviewRows.find((r) => r.status === 'APPROVED') || openFlag)?.id ?? null, observed: { hasApproved, openFlag: openFlag?.status ?? null }, satisfied: complianceSatisfied });
  if (!complianceSatisfied) {
    add(compEv, blocker({ code: BLK.COMPLIANCE_NOT_APPROVED, message: openFlag ? `Compliance review is ${openFlag.status}.` : 'No APPROVED compliance review exists.', remediation: 'Obtain a human-approved compliance review with no open flags.', policyClause: '§43.compliance' }));
  } else {
    evidenceRefs.push(compEv);
  }

  // Check 3 — required documents verified.
  const { data: docs } = await supabase
    .from('vehicle_government_documents')
    .select('*')
    .eq('import_order_id', txn.import_order_id);
  const docRows = docs || [];
  const unverified = docRows.filter((d) => d.verification_status !== 'VERIFIED');
  const docsSatisfied = docRows.length > 0 && unverified.length === 0;
  const docEv = evidenceRef({ kind: 'government_document', table: 'vehicle_government_documents', recordId: unverified[0]?.id ?? null, observed: { total: docRows.length, unverified: unverified.length }, satisfied: docsSatisfied });
  if (!docsSatisfied) {
    add(docEv, blocker({ code: BLK.DOCUMENTS_NOT_VERIFIED, message: docRows.length === 0 ? 'No required documents are attached.' : `${unverified.length} required document(s) are not VERIFIED.`, remediation: 'Verify all required government documents.', policyClause: '§43.documents' }));
  } else {
    evidenceRefs.push(docEv);
  }

  // Check 5 — shipment milestone reached (observed from shipments; never auto-completed).
  const { data: shipments } = await supabase
    .from('diaspora_shipments')
    .select('*')
    .eq('import_order_id', txn.import_order_id);
  const shipmentRows = shipments || [];
  const arrived = shipmentRows.find((s) => ['ARRIVED', 'RELEASED', 'COMPLETED'].includes(s.status));
  const shipEv = evidenceRef({ kind: 'shipment', table: 'diaspora_shipments', recordId: arrived?.id ?? null, observed: { status: arrived?.status ?? null, count: shipmentRows.length }, satisfied: Boolean(arrived) });
  if (!arrived) {
    add(shipEv, blocker({ code: BLK.SHIPMENT_MILESTONE_NOT_REACHED, message: 'The shipment has not reached an ARRIVED/RELEASED milestone.', remediation: 'Wait until the shipment is observed arrived/released.', policyClause: '§43.shipment' }));
  } else {
    evidenceRefs.push(shipEv);
  }

  // Check 5b — buyer delivery confirmation flag (set by CONFIRM_DELIVERY on the transaction metadata).
  const deliveryConfirmed = Boolean(txn?.metadata?.safetrade?.deliveryConfirmed)
    || Boolean(txn?.metadata?.delivery?.buyerConfirmed);
  const delEv = evidenceRef({ kind: 'delivery_flag', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { deliveryConfirmed }, satisfied: deliveryConfirmed });
  if (!deliveryConfirmed) {
    add(delEv, blocker({ code: BLK.DELIVERY_NOT_CONFIRMED, message: 'Buyer delivery confirmation has not been recorded.', remediation: 'Record buyer (or reviewer override) delivery confirmation.', policyClause: '§43.delivery' }));
  } else {
    evidenceRefs.push(delEv);
  }

  // Check 6 — no active dispute (transaction state).
  const disputed = ['DISPUTED'].includes(txn.status);
  if (disputed) {
    add(
      evidenceRef({ kind: 'safetrade_transaction', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { status: txn.status }, satisfied: false }),
      blocker({ code: BLK.ACTIVE_DISPUTE, message: 'The transaction is currently DISPUTED.', remediation: 'Resolve the dispute before releasing.', policyClause: '§43.dispute' }),
    );
  }

  // Check 7 — no fraud/security hold (transaction metadata flag).
  const securityHold = Boolean(txn?.metadata?.safetrade?.securityHold) || txn.status === 'SUSPENDED';
  if (securityHold) {
    add(
      evidenceRef({ kind: 'security_hold', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { securityHold: true, status: txn.status }, satisfied: false }),
      blocker({ code: BLK.SECURITY_HOLD, message: 'A security/fraud hold is in place.', remediation: 'Clear the security hold (reviewer/admin).', policyClause: '§43.security' }),
    );
  }

  // Check 8 — actor authorized (server-derived). Only reviewer/admin may request/approve release.
  const actor = actorContext || {};
  const privileged = isPlatformAdmin(actor) || isPlatformReviewer(actor);
  if (!privileged) {
    add(
      evidenceRef({ kind: 'actor', table: 'auth', recordId: normalizeId(actor.id ?? actor.userId), observed: { platformRole: actor.platformRole ?? actor.platform_role ?? null, privileged: false }, satisfied: false }),
      blocker({ code: BLK.ACTOR_NOT_AUTHORIZED, message: 'Only a platform reviewer/admin may evaluate release.', remediation: 'Have a reviewer/admin perform the release.', policyClause: '§43.actor' }),
    );
  } else {
    evidenceRefs.push(evidenceRef({ kind: 'actor', table: 'auth', recordId: normalizeId(actor.id ?? actor.userId), observed: { privileged: true }, satisfied: true }));
  }

  // Check 10 — live-payment fail-closed: any non-sandbox provider while live is OFF is a blocker.
  const providerSandbox = ['sandbox', 'fake'].includes(String(txn.payment_provider || '').toLowerCase());
  if (!providerSandbox || txn.live_payment === true) {
    if (!isSafeTradeLivePaymentEnabled()) {
      add(
        evidenceRef({ kind: 'provider', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { payment_provider: txn.payment_provider, live_payment: txn.live_payment }, satisfied: false }),
        blocker({ code: BLK.LIVE_PAYMENT_DISABLED, message: 'A non-sandbox/live provider is set but live payment is disabled.', remediation: 'Use the sandbox provider until external activation.', policyClause: '§N1' }),
      );
    }
  }

  // Risk tiering (conservative; unknown → HIGH).
  const riskTier = computeRiskTier({ txn, milestones: milestoneRows || [] });
  const requiresApproval = riskTier === SAFETRADE_RISK_TIERS.HIGH;

  // Check 12 — HIGH risk requires a reviewer/admin approval record (even if everything else passes).
  if (requiresApproval) {
    const latestEval = await loadLatestApprovalEvaluation(supabase, { transactionId: txn.id, milestoneId });
    const approved = Boolean(latestEval && latestEval.eligible === true && latestEval.requires_reviewer !== false && latestEval.evaluated_by);
    const apprEv = evidenceRef({ kind: 'release_evaluation', table: 'diaspora_safetrade_release_evaluations', recordId: latestEval?.id ?? null, observed: { eligible: latestEval?.eligible ?? null, risk_level: latestEval?.risk_level ?? null, evaluated_by: latestEval?.evaluated_by ?? null }, satisfied: approved });
    if (!approved) {
      add(apprEv, blocker({ code: BLK.REVIEWER_APPROVAL_REQUIRED, message: 'High-risk release requires an explicit reviewer/admin approval record even when automated conditions pass.', remediation: 'Record a reviewer/admin approval evaluation for this release.', policyClause: '§43.highrisk' }));
    } else {
      evidenceRefs.push(apprEv);
    }
  }

  // eligible ONLY if no blockers (and, by construction, a held milestone is present and — if HIGH —
  // an approval record exists; both are encoded as blockers above).
  return {
    eligible: blockers.length === 0,
    blockers,
    evidenceRefs,
    policyVersion,
    evaluatedAt: at,
    requiresApproval,
    riskTier,
    providerMode,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Conservative risk tier from authoritative signals; unknown defaults to HIGH. */
export function computeRiskTier({ txn, milestones = [] } = {}) {
  if (!txn) return SAFETRADE_RISK_TIERS.HIGH;
  const amount = Number(txn.total_amount);
  if (!Number.isFinite(amount)) return SAFETRADE_RISK_TIERS.HIGH;
  if (amount >= HIGH_RISK_AMOUNT_THRESHOLD) return SAFETRADE_RISK_TIERS.HIGH;
  // Any failed/disputed milestone elevates to HIGH.
  if (milestones.some((m) => ['FAILED', 'REFUND_REVIEW'].includes(m.status))) return SAFETRADE_RISK_TIERS.HIGH;
  if (txn.status === 'DISPUTED' || txn.status === 'SUSPENDED') return SAFETRADE_RISK_TIERS.HIGH;
  if (amount <= 0) return SAFETRADE_RISK_TIERS.HIGH; // degenerate → conservative
  if (amount < 2500) return SAFETRADE_RISK_TIERS.LOW;
  return SAFETRADE_RISK_TIERS.STANDARD;
}

async function loadLatestApprovalEvaluation(supabase, { transactionId, milestoneId }) {
  let rows = [];
  try {
    const { data } = await supabase
      .from('diaspora_safetrade_release_evaluations')
      .select('*')
      .eq('transaction_id', transactionId)
      .is('deleted_at', null)
      .order('evaluated_at', { ascending: false });
    rows = data || [];
  } catch {
    return null;
  }
  const scoped = milestoneId ? rows.filter((r) => r.milestone_id === milestoneId || r.milestone_id == null) : rows;
  return scoped[0] || null;
}

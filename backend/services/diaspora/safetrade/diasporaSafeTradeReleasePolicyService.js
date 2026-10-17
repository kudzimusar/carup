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
  // T13 release-policy convergence: facts owned by T12, required only by the milestones they gate.
  CUSTOMS_ASSESSMENT_NOT_EVIDENCED: 'CUSTOMS_ASSESSMENT_NOT_EVIDENCED',
  DESTINATION_RELEASE_NOT_EVIDENCED: 'DESTINATION_RELEASE_NOT_EVIDENCED',
});

const BLK = SAFETRADE_RELEASE_BLOCKER_CODES;

// Milestone statuses that represent funds notionally held in (sandbox) escrow custody.
const HELD_MILESTONE_STATUSES = new Set(['FUNDED', 'HELD', 'RELEASE_REVIEW', 'RELEASE_AUTHORIZED']);

// Risk threshold: above this amount the transaction is HIGH risk (conservative default).
const HIGH_RISK_AMOUNT_THRESHOLD = 25000;

// Reconciliation tolerance at numeric(_,2) scale.
const RECONCILIATION_TOLERANCE = 0.005;

/**
 * ── T13 release-policy convergence ─────────────────────────────────────────
 *
 * Historically every release was evaluated as if it were the FINAL release of the whole transaction:
 * compliance, verified documents, an ARRIVED/RELEASED shipment and buyer delivery confirmation were
 * required for ANY milestone. That made a deposit unreleasable until the goods had been delivered, and
 * it read fulfilment facts from tables that are no longer their owners.
 *
 * Now the fulfilment facts are milestone-specific, and each is read from its frozen owner:
 *   T8  documents  → diaspora_trade_documents (current version: not deleted, not superseded)
 *   T11 movement   → diaspora_shipments.status, by the T11 stage rank
 *   T12 customs    → diaspora_customs_events on the order's live customs case(s)
 * SafeTrade reads these; it never writes them, and nothing here can make one of them true.
 *
 * Unchanged for EVERY milestone (SafeTrade's own assurance, not fulfilment): the milestone's own funds
 * held, totals reconciled, compliance approved, no active dispute, no security hold, a
 * reviewer/admin actor, the live-payment firewall, and — for HIGH risk — a recorded reviewer approval.
 *
 * Unknown is conservative: a milestone type not listed below, a REFUND line, or an evaluation with no
 * milestoneId is FINAL.
 */
export const SAFETRADE_RELEASE_CLASSES = Object.freeze({ EARLY: 'EARLY', INTERMEDIATE: 'INTERMEDIATE', FINAL: 'FINAL' });
const RC = SAFETRADE_RELEASE_CLASSES;

export const RELEASE_REQUIREMENTS = Object.freeze({
  DOCUMENTS_VERIFIED: 'DOCUMENTS_VERIFIED', // T8
  SHIPMENT_DEPARTED: 'SHIPMENT_DEPARTED', // T11 — IN_TRANSIT or later
  SHIPMENT_ARRIVED: 'SHIPMENT_ARRIVED', // T11 — ARRIVED or later
  CUSTOMS_ASSESSMENT_EVIDENCED: 'CUSTOMS_ASSESSMENT_EVIDENCED', // T12 — document-backed assessment
  DESTINATION_RELEASE_EVIDENCED: 'DESTINATION_RELEASE_EVIDENCED', // T12 — authority release document
  DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMED', // SafeTrade's own buyer acknowledgement
});
const RQ = RELEASE_REQUIREMENTS;

/** Milestone type → release class and the fulfilment facts it needs. Types mirror the DB CHECK. */
export const MILESTONE_RELEASE_POLICY = Object.freeze({
  DEPOSIT: { releaseClass: RC.EARLY, requires: [] },
  FEE: { releaseClass: RC.EARLY, requires: [] },
  INSURANCE: { releaseClass: RC.EARLY, requires: [] },
  PROGRESS: { releaseClass: RC.INTERMEDIATE, requires: [RQ.DOCUMENTS_VERIFIED] },
  SHIPMENT: { releaseClass: RC.INTERMEDIATE, requires: [RQ.DOCUMENTS_VERIFIED, RQ.SHIPMENT_DEPARTED] },
  CUSTOMS_DUTY: { releaseClass: RC.INTERMEDIATE, requires: [RQ.DOCUMENTS_VERIFIED, RQ.CUSTOMS_ASSESSMENT_EVIDENCED] },
  DELIVERY: { releaseClass: RC.FINAL, requires: [RQ.DOCUMENTS_VERIFIED, RQ.SHIPMENT_ARRIVED, RQ.DESTINATION_RELEASE_EVIDENCED, RQ.DELIVERY_CONFIRMED] },
  RELEASE: { releaseClass: RC.FINAL, requires: [RQ.DOCUMENTS_VERIFIED, RQ.SHIPMENT_ARRIVED, RQ.DESTINATION_RELEASE_EVIDENCED, RQ.DELIVERY_CONFIRMED] },
});
const FINAL_POLICY = MILESTONE_RELEASE_POLICY.RELEASE;

/** A milestone's release_trigger can ADD a requirement; it can never remove one. */
const RELEASE_TRIGGER_REQUIREMENTS = Object.freeze({
  ON_DOCUMENTS_VERIFIED_REVIEWED: [RQ.DOCUMENTS_VERIFIED],
  ON_DELIVERY_CONFIRMED_REVIEWED: [RQ.DELIVERY_CONFIRMED],
});

/** Pure: the class and requirement set for one milestone (or FINAL when unknown/absent). */
export function releaseRequirementsFor(milestone = null) {
  const policy = (milestone && MILESTONE_RELEASE_POLICY[milestone.milestone_type]) || FINAL_POLICY;
  const extra = (milestone && RELEASE_TRIGGER_REQUIREMENTS[milestone.release_trigger]) || [];
  return {
    releaseClass: policy.releaseClass,
    requires: [...new Set([...policy.requires, ...extra])],
  };
}

/** T11 stage rank (mirrors diasporaShipmentService STAGE_RANK). EXCEPTION is unranked: not progress. */
const T11_STAGE_RANK = Object.freeze({ PLANNED: 0, BOOKED: 1, LOADING: 2, IN_TRANSIT: 3, ARRIVED: 4, CUSTOMS_HOLD: 5, RELEASED: 6, COMPLETED: 7 });
const T11_IN_TRANSIT = T11_STAGE_RANK.IN_TRANSIT;
const T11_ARRIVED = T11_STAGE_RANK.ARRIVED;

/** T12 sources that rest on a document (an agent's word or a CarUp observation does not). */
const T12_DOCUMENT_SOURCES = new Set(['AUTHORITY_DOCUMENT', 'IMPORTER_DOCUMENT', 'THIRD_PARTY_DOCUMENT']);
/** Active dispute statuses (mirror SAFETRADE_ACTIVE_DISPUTE_STATUSES in the dispute service). */
const ACTIVE_DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFO'];

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

  // ── Milestone-specific fulfilment requirements (T13 release-policy convergence) ──────────────
  // The milestone being released decides which fulfilment facts apply. No milestoneId, or an unknown
  // type, is FINAL (strictest). Requirements are read from their frozen owners and only ever READ.
  const targetMilestone = milestoneId ? milestones.find((m) => m.id === milestoneId) || null : null;
  const { releaseClass, requires } = releaseRequirementsFor(targetMilestone);
  const needs = new Set(requires);
  evidenceRefs.push(evidenceRef({ kind: 'release_policy', table: 'diaspora_safetrade_milestones', recordId: targetMilestone?.id ?? null, observed: { milestoneType: targetMilestone?.milestone_type ?? null, releaseTrigger: targetMilestone?.release_trigger ?? null, releaseClass, requires }, satisfied: true }));

  // T8 — documents, judged the way T8 judges them (tradeDocumentWorkspaceService.projectRow):
  //   record  = diaspora_trade_documents, CURRENT version only (not deleted, not superseded);
  //   type    = trade_document_types by code, which says whether that kind of document needs a
  //             reviewer's verdict at all (verification_required);
  //   verdict = the latest diaspora_trade_document_verifications row for THAT document id.
  // The document row's own verification_status is not the verdict: OCR moves it to OCR_EXTRACTED,
  // and extraction is an observation, never a review. A verdict belongs to the version it was given
  // on, so a replacement starts unreviewed. vehicle_government_documents is not a T8 authority and
  // neither satisfies nor vetoes this gate. T8 defines no per-type "required documents" rule, so none
  // is invented here: the gate judges what was supplied, and fails closed only when nothing was.
  if (needs.has(RQ.DOCUMENTS_VERIFIED)) {
    const { data: tradeDocs } = await supabase
      .from('diaspora_trade_documents')
      .select('*')
      .eq('import_order_id', txn.import_order_id);
    const current = (tradeDocs || []).filter((d) => !d.deleted_at && !d.superseded_at);
    const docIds = current.map((d) => d.id);
    const typeCodes = [...new Set(current.map((d) => d.document_type).filter(Boolean))];
    const [{ data: types }, { data: verdicts }] = await Promise.all([
      typeCodes.length
        ? supabase.from('trade_document_types').select('*').in('code', typeCodes)
        : Promise.resolve({ data: [] }),
      docIds.length
        ? supabase.from('diaspora_trade_document_verifications').select('*').in('trade_document_id', docIds)
        : Promise.resolve({ data: [] }),
    ]);
    const typeByCode = new Map((types || []).filter((t) => !t.deleted_at).map((t) => [t.code, t]));
    const latestVerdict = new Map();
    for (const v of (verdicts || []).filter((row) => !row.deleted_at)) {
      const at = String(v.verified_at || v.created_at || '');
      const seen = latestVerdict.get(v.trade_document_id);
      if (!seen || at > String(seen.verified_at || seen.created_at || '')) latestVerdict.set(v.trade_document_id, v);
    }
    const assessed = current.map((doc) => {
      const type = typeByCode.get(doc.document_type) || null;
      const verdict = String(latestVerdict.get(doc.id)?.verification_status || '').toUpperCase();
      // An ungoverned type has no rule saying a verdict is unnecessary, so it is held to one.
      const verdictRequired = type ? Boolean(type.verification_required) : true;
      let state;
      if (verdict === 'REJECTED') state = 'REJECTED';
      else if (verdict === 'VERIFIED') state = 'VERIFIED';
      else if (verdictRequired) state = type ? 'AWAITING_REVIEW' : 'UNGOVERNED_TYPE_AWAITING_REVIEW';
      else state = 'SUPPLIED_VERIFICATION_NOT_REQUIRED';
      return { id: doc.id, documentType: doc.document_type ?? null, state };
    });
    const open = assessed.filter((a) => a.state === 'REJECTED' || a.state.endsWith('AWAITING_REVIEW'));
    const docsSatisfied = current.length > 0 && open.length === 0;
    const docEv = evidenceRef({
      kind: 'trade_document',
      table: 'diaspora_trade_documents',
      recordId: open[0]?.id ?? null,
      observed: {
        current: current.length,
        verified: assessed.filter((a) => a.state === 'VERIFIED').length,
        verificationNotRequired: assessed.filter((a) => a.state === 'SUPPLIED_VERIFICATION_NOT_REQUIRED').length,
        awaitingReview: assessed.filter((a) => a.state.endsWith('AWAITING_REVIEW')).length,
        rejected: assessed.filter((a) => a.state === 'REJECTED').length,
        documents: assessed,
      },
      satisfied: docsSatisfied,
    });
    if (!docsSatisfied) {
      const rejected = open.filter((a) => a.state === 'REJECTED').length;
      const awaiting = open.length - rejected;
      const message = current.length === 0
        ? 'No current trade document is attached to this order.'
        : [rejected ? `${rejected} document(s) were rejected by a reviewer` : null, awaiting ? `${awaiting} document(s) need a reviewer's verdict and have none` : null].filter(Boolean).join('; ') + '.';
      add(docEv, blocker({ code: BLK.DOCUMENTS_NOT_VERIFIED, message, remediation: 'Supply corrected documents and have those that need review verified in the documents workspace (T8).', policyClause: '§43.documents' }));
    } else {
      evidenceRefs.push(docEv);
    }
  }

  // T11 — movement. Read by stage rank; EXCEPTION has no rank and proves no progress.
  if (needs.has(RQ.SHIPMENT_DEPARTED) || needs.has(RQ.SHIPMENT_ARRIVED)) {
    const { data: shipments } = await supabase
      .from('diaspora_shipments')
      .select('*')
      .eq('import_order_id', txn.import_order_id);
    const shipmentRows = (shipments || []).filter((sh) => !sh.deleted_at);
    const furthest = shipmentRows.reduce((best, sh) => {
      const rank = T11_STAGE_RANK[sh.status];
      return rank !== undefined && (best === null || rank > T11_STAGE_RANK[best.status]) ? sh : best;
    }, null);
    const rank = furthest ? T11_STAGE_RANK[furthest.status] : -1;
    const minRank = needs.has(RQ.SHIPMENT_ARRIVED) ? T11_ARRIVED : T11_IN_TRANSIT;
    const shipSatisfied = rank >= minRank;
    const shipEv = evidenceRef({ kind: 'shipment', table: 'diaspora_shipments', recordId: furthest?.id ?? null, observed: { status: furthest?.status ?? null, count: shipmentRows.length, required: minRank === T11_ARRIVED ? 'ARRIVED' : 'IN_TRANSIT' }, satisfied: shipSatisfied });
    if (!shipSatisfied) {
      add(shipEv, blocker({ code: BLK.SHIPMENT_MILESTONE_NOT_REACHED, message: minRank === T11_ARRIVED ? 'The shipment has not been observed ARRIVED.' : 'The shipment has not been observed IN_TRANSIT.', remediation: 'Wait until the shipment timeline (T11) records the stage this milestone depends on.', policyClause: '§43.shipment' }));
    } else {
      evidenceRefs.push(shipEv);
    }
  }

  // T12 — customs. Read from the order's live customs case(s). A payment-evidence event is never
  // read here: customs payment is not SafeTrade settlement, and it satisfies nothing in this engine.
  if (needs.has(RQ.CUSTOMS_ASSESSMENT_EVIDENCED) || needs.has(RQ.DESTINATION_RELEASE_EVIDENCED)) {
    const { data: cases } = await supabase
      .from('diaspora_customs_cases')
      .select('*')
      .eq('import_order_id', txn.import_order_id);
    const liveCases = (cases || []).filter((c) => !c.deleted_at && c.status !== 'ABANDONED');
    let events = [];
    if (liveCases.length) {
      const { data: rows } = await supabase
        .from('diaspora_customs_events')
        .select('*')
        .in('case_id', liveCases.map((c) => c.id));
      events = (rows || []).filter((e) => !e.deleted_at);
    }
    if (needs.has(RQ.CUSTOMS_ASSESSMENT_EVIDENCED)) {
      const assessment = events.find((e) => e.event_type === 'ASSESSMENT_EVIDENCE_RECEIVED' && T12_DOCUMENT_SOURCES.has(e.source_kind));
      const ev = evidenceRef({ kind: 'customs_event', table: 'diaspora_customs_events', recordId: assessment?.id ?? null, observed: { cases: liveCases.length, assessmentEvidenced: Boolean(assessment), source_kind: assessment?.source_kind ?? null }, satisfied: Boolean(assessment) });
      if (!assessment) {
        add(ev, blocker({ code: BLK.CUSTOMS_ASSESSMENT_NOT_EVIDENCED, message: 'No document-backed customs assessment is recorded for this order.', remediation: 'Record the assessment with its document in the customs case (T12).', policyClause: '§43.customs' }));
      } else {
        evidenceRefs.push(ev);
      }
    }
    if (needs.has(RQ.DESTINATION_RELEASE_EVIDENCED)) {
      const release = events.find((e) => e.event_type === 'RELEASE_EVIDENCE_RECEIVED' && e.source_kind === 'AUTHORITY_DOCUMENT');
      const ev = evidenceRef({ kind: 'customs_event', table: 'diaspora_customs_events', recordId: release?.id ?? null, observed: { cases: liveCases.length, releaseEvidenced: Boolean(release) }, satisfied: Boolean(release) });
      if (!release) {
        add(ev, blocker({ code: BLK.DESTINATION_RELEASE_NOT_EVIDENCED, message: 'No authority release document is recorded for this order.', remediation: 'Attach the customs release document to the customs case (T12).', policyClause: '§43.customs' }));
      } else {
        evidenceRefs.push(ev);
      }
    }
  }

  // Buyer delivery acknowledgement (SafeTrade's own CONFIRM_DELIVERY flag). A T12 DELIVERY_OBSERVED is
  // a CarUp observation of a handoff and is deliberately NOT accepted as the buyer's acknowledgement.
  if (needs.has(RQ.DELIVERY_CONFIRMED)) {
    const deliveryConfirmed = Boolean(txn?.metadata?.safetrade?.deliveryConfirmed)
      || Boolean(txn?.metadata?.delivery?.buyerConfirmed);
    const delEv = evidenceRef({ kind: 'delivery_flag', table: 'diaspora_safetrade_transactions', recordId: txn.id, observed: { deliveryConfirmed }, satisfied: deliveryConfirmed });
    if (!deliveryConfirmed) {
      add(delEv, blocker({ code: BLK.DELIVERY_NOT_CONFIRMED, message: 'Buyer delivery confirmation has not been recorded.', remediation: 'Record buyer (or reviewer override) delivery confirmation.', policyClause: '§43.delivery' }));
    } else {
      evidenceRefs.push(delEv);
    }
  }

  // Check 6 — no active dispute: the transaction state OR any active dispute record for it. Either
  // blocks every milestone; the milestone policy above never reaches this check's outcome.
  const { data: disputeRows } = await supabase
    .from('diaspora_safetrade_disputes')
    .select('*')
    .eq('transaction_id', txn.id);
  const activeDispute = (disputeRows || []).find((d) => !d.deleted_at && ACTIVE_DISPUTE_STATUSES.includes(d.status));
  if (txn.status === 'DISPUTED' || activeDispute) {
    add(
      evidenceRef({ kind: 'safetrade_dispute', table: activeDispute ? 'diaspora_safetrade_disputes' : 'diaspora_safetrade_transactions', recordId: activeDispute?.id ?? txn.id, observed: { status: txn.status, disputeStatus: activeDispute?.status ?? null }, satisfied: false }),
      blocker({ code: BLK.ACTIVE_DISPUTE, message: activeDispute ? `A dispute is ${activeDispute.status}.` : 'The transaction is currently DISPUTED.', remediation: 'Resolve the dispute before releasing.', policyClause: '§43.dispute' }),
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
  // `eligible` is PERMISSION for the release path to proceed. It is not provider confirmation, not
  // ledger application and not funds released; nothing in this engine writes or moves anything.
  return {
    eligible: blockers.length === 0,
    blockers,
    evidenceRefs,
    policyVersion,
    evaluatedAt: at,
    requiresApproval,
    riskTier,
    providerMode,
    releaseClass,
    milestoneType: targetMilestone?.milestone_type ?? null,
    requirements: requires,
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

/**
 * Phase 9 — SafeTrade SERVER-DERIVED AVAILABLE-ACTIONS projection (PURE, read-only).
 *
 * `computeAvailableActions(txn, userContext, { milestones, dispute, eligibility })` returns an array of
 * SAFE action-metadata objects the UI consumes as the SINGLE SOURCE OF TRUTH for what a given caller may
 * do against a SafeTrade transaction in its CURRENT state. It does NOT duplicate the 16-state transition
 * table: every candidate is DERIVED from SAFETRADE_TRANSITION_TABLE (plus the dedicated non-transition
 * route actions), and the authority decision MIRRORS the services/transition-table EXACTLY — it never
 * invents or weakens a rule.
 *
 * Authority mirror (identical to the services):
 *   - party role is SERVER-DERIVED only (the client x-stakeholder-role is never read here):
 *       platform admin            -> 'ADMIN'      (privileged)
 *       platform reviewer         -> 'REVIEWER'   (privileged)
 *       tenant admin OF THE RECORD-> privileged, evaluated as 'ADMIN' (mirrors isPrivileged)
 *       buyer/creator id match    -> 'BUYER'
 *       seller id match           -> 'SELLER'
 *       neither                   -> null (unrelated; sees nothing permitted)
 *   - permitted === true ONLY when: the actor's role is in the action's actorRoles AND the txn's CURRENT
 *     design state is in the action's source states AND the dispute/live/eligibility/held-funds gates allow.
 *   - money/release/refund actions: sandboxOnly=true, reviewerRequired where the table says so, and
 *     permitted=false with disabledReasonCode='LIVE_PAYMENT_DISABLED' when the action would require a live
 *     money move while DIASPORA_SAFETRADE_LIVE_PAYMENT is off (fail-closed, identical to the release policy
 *     and the RPC's EXTERNAL_ACTIVATION_REQUIRED guard).
 *
 * Privacy (non-negotiable): the returned metadata NEVER contains internal SQL, policy secrets, raw risk
 * scores, provider credentials/references, or any other participant's private fields — only the safe
 * { actionKey, labelKey, permitted, disabledReasonCode, confirmationRequired, reviewerRequired,
 *   sandboxOnly, requiredEvidenceCategories } shape below. Raw ids (buyer_id/seller_id/etc.) are NOT
 * included in any action object. This module is PURE: no DB, no network, no env writes; it only READS the
 * feature flags via the constants helpers (the same flags the services read).
 */
import {
  SAFETRADE_STATES,
  SAFETRADE_TRANSITIONS,
  SAFETRADE_TRANSITION_TABLE,
  SAFETRADE_TERMINAL_STATES,
  SAFETRADE_ESCROW_HELD_STATES,
} from '../../../constants/diaspora/diasporaSafeTradeStatuses.js';
import {
  isSafeTradeEnabled,
  isSafeTradeLivePaymentEnabled,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import {
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';

const S = SAFETRADE_STATES;
const T = SAFETRADE_TRANSITIONS;

/**
 * Stable disabled-reason taxonomy (why an action is NOT permitted for this caller in this state).
 * null  -> permitted. Otherwise exactly one of these codes explains the block.
 */
export const SAFETRADE_DISABLED_REASON_CODES = Object.freeze({
  WRONG_ROLE: 'WRONG_ROLE', // the actor's server-derived party role is not in the action's actorRoles
  WRONG_STATE: 'WRONG_STATE', // the txn's current state is not a legal source for the action
  DISPUTE_ACTIVE: 'DISPUTE_ACTIVE', // an active dispute blocks this action (BLOCKED_WHILE_DISPUTED)
  NEEDS_EVALUATION: 'NEEDS_EVALUATION', // release authority requires a passing prior release evaluation
  NEEDS_REVIEWER: 'NEEDS_REVIEWER', // a reviewer/admin is required and the caller is not privileged
  LIVE_PAYMENT_DISABLED: 'LIVE_PAYMENT_DISABLED', // a live money move is required but live payment is off
  HELD_FUNDS_BOUNDARY: 'HELD_FUNDS_BOUNDARY', // forbidden once funds are (sandbox) held (e.g. CANCEL)
  NOT_ELIGIBLE: 'NOT_ELIGIBLE', // a supplied eligibility/release verdict says ineligible
  DISABLED: 'DISABLED', // the whole SafeTrade surface is disabled (DIASPORA_SAFETRADE_ENABLED off)
});

const R = SAFETRADE_DISABLED_REASON_CODES;

/**
 * The DB transaction status (the migration's CHECK enum) maps to the design's 16-state model so the
 * projection can reason about source states the same way the transition table does. This mirrors the
 * inverse of TRANSITION_TARGET_DB_STATUS in the transaction service. The coarse DB status DISPUTED maps
 * to the design DISPUTED escape hatch; SUSPENDED likewise. Unknown/legacy statuses fall back to the raw
 * value (treated as a non-matching source — fails closed to WRONG_STATE).
 */
const DB_STATUS_TO_DESIGN_STATE = Object.freeze({
  DRAFT: S.DRAFT,
  INITIATED: S.AWAITING_BUYER_COMMITMENT, // post eligibility-clear, awaiting buyer commit
  FUNDS_PENDING: S.PAYMENT_PENDING,
  FUNDS_HELD: S.PAYMENT_HELD,
  IN_PROGRESS: S.COMPLIANCE_REVIEW, // documents/compliance/shipment band (coarse)
  RELEASE_REVIEW: S.DELIVERY_CONFIRMATION_PENDING,
  RELEASE_AUTHORIZED: S.DELIVERY_CONFIRMATION_PENDING,
  SETTLED: S.COMPLETED,
  COMPLETED: S.COMPLETED,
  DISPUTED: S.DISPUTED,
  SUSPENDED: S.SUSPENDED,
  CANCELLED: S.CANCELLED,
  REFUND_REVIEW: S.REFUND_PENDING,
  REFUNDED: S.REFUNDED,
});

// The set of design states in which (sandbox) funds are notionally held — CANCEL is forbidden here
// (mirrors CANCEL_SOURCE_STATES in the transition table, i.e. the held-funds boundary §4.1).
const HELD_DESIGN_STATES = new Set(SAFETRADE_ESCROW_HELD_STATES);
const TERMINAL_DESIGN_STATES = new Set(SAFETRADE_TERMINAL_STATES);

/** Map a transaction's CURRENT authoritative DB status to its design state. */
function designStateOf(txn) {
  const status = String(txn?.status ?? '');
  return DB_STATUS_TO_DESIGN_STATE[status] ?? status;
}

/**
 * Derive the caller's transaction-scoped party role from SERVER-DERIVED signals only — identical to the
 * services' isPrivileged + deriveActorPartyRole. Returns one of 'ADMIN' | 'REVIEWER' | 'BUYER' | 'SELLER'
 * | null, plus a `privileged` flag (platform admin/reviewer OR tenant-admin-of-record). A privileged
 * tenant admin is evaluated against the table as 'ADMIN' (it is the same override the services apply).
 */
function deriveActorRole(txn, userContext = {}) {
  if (isPlatformAdmin(userContext)) return { role: 'ADMIN', privileged: true };
  if (isPlatformReviewer(userContext)) return { role: 'REVIEWER', privileged: true };
  if (isTenantAdminForRecord(txn || {}, userContext)) return { role: 'ADMIN', privileged: true };
  const actorId = normalizeId(userContext.id ?? userContext.userId);
  if (normalizeId(txn?.buyer_id) === actorId || normalizeId(txn?.created_by) === actorId) {
    return { role: 'BUYER', privileged: false };
  }
  if (normalizeId(txn?.seller_id) === actorId) return { role: 'SELLER', privileged: false };
  return { role: null, privileged: false };
}

/** Is there an ACTIVE dispute? Prefer an explicit boolean; else inspect a passed dispute record/array. */
function hasActiveDispute(dispute, designState) {
  if (designState === S.DISPUTED) return true; // the txn itself is parked in DISPUTED
  if (dispute == null) return false;
  if (typeof dispute === 'boolean') return dispute;
  const ACTIVE = new Set(['OPEN', 'UNDER_REVIEW', 'AWAITING_INFO']);
  const records = Array.isArray(dispute) ? dispute : [dispute];
  return records.some((d) => d && ACTIVE.has(String(d.status ?? '').toUpperCase()));
}

/**
 * Evaluate a single transition-table descriptor against the caller + state and return safe metadata.
 * The decision mirrors the services exactly:
 *   - WRONG_ROLE  : actor role not in descriptor.actorRoles (privileged ADMIN/REVIEWER counts as itself).
 *   - WRONG_STATE : current design state not in descriptor.from.
 *   - DISPUTE_ACTIVE : an active dispute + BLOCKED_WHILE_DISPUTED restriction.
 *   - NEEDS_REVIEWER : a reviewer/admin-only edge but the caller is a non-privileged party.
 *   - LIVE_PAYMENT_DISABLED : a money edge with a live gate while live payment is off.
 */
function evaluateTransitionAction({ actionKey, labelKey, event, descriptor, actorRole, privileged, designState, disputeActive, liveOff, txnRequiresLive }) {
  const isMoney = descriptor.moneyMovement != null; // HOLD / RELEASE / REFUND
  const reviewerRequired = descriptor.reviewerApprovalRequired === 'ALWAYS'
    || (descriptor.reviewerApprovalRequired === 'IF_HIGH_RISK');
  // An edge whose actorRoles exclude BOTH buyer and seller is reviewer/admin-only (mirrors the service's
  // reviewerOnly heuristic). SYSTEM-only edges are likewise not driveable by a human party.
  const partyRoles = descriptor.actorRoles.filter((r) => r === 'BUYER' || r === 'SELLER');
  const reviewerOnlyEdge = partyRoles.length === 0;

  const base = {
    actionKey,
    labelKey,
    confirmationRequired: deriveConfirmation(event, isMoney),
    reviewerRequired,
    sandboxOnly: isMoney, // money actions are sandbox-only until external activation (EB-4)
    requiredEvidenceCategories: requiredEvidenceFor(descriptor),
  };

  // 1. State legality.
  const stateOk = Array.isArray(descriptor.from) && descriptor.from.includes(designState);
  // 2. Role legality (privileged ADMIN/REVIEWER pass if the table admits ADMIN/REVIEWER; the services give
  //    privileged actors the override on party-only edges too, so a privileged actor satisfies any edge's
  //    actorRoles when ADMIN/REVIEWER is listed, OR when the edge is a participant edge they may override).
  const roleListed = actorRole != null && descriptor.actorRoles.includes(actorRole);
  const roleOk = roleListed || (privileged && reviewerOnlyEdge);

  // Decide the single disabledReasonCode, in the same precedence the services enforce.
  let disabledReasonCode = null;
  if (!stateOk) {
    // CANCEL is structurally forbidden once (sandbox) funds are held (§4.1 held-funds boundary). Surface
    // the more explainable HELD_FUNDS_BOUNDARY instead of the generic WRONG_STATE in that precise case.
    disabledReasonCode = (event === T.CANCEL && HELD_DESIGN_STATES.has(designState))
      ? R.HELD_FUNDS_BOUNDARY
      : R.WRONG_STATE;
  } else if (disputeActive && descriptor.disputeRestriction === 'BLOCKED_WHILE_DISPUTED') {
    disabledReasonCode = R.DISPUTE_ACTIVE;
  } else if (reviewerOnlyEdge && !privileged) {
    // Non-privileged actor on a reviewer/admin-only edge — the service rejects with REVIEWER_REQUIRED.
    disabledReasonCode = R.NEEDS_REVIEWER;
  } else if (!roleOk) {
    disabledReasonCode = R.WRONG_ROLE;
  } else if (isMoney && descriptor.liveGate && liveOff && txnRequiresLive) {
    // A money edge "would require live" only when the transaction itself carries a non-sandbox provider /
    // live flag while live payment is off — the exact condition the release policy raises
    // LIVE_PAYMENT_DISABLED for. With the platform fail-closed (sandbox, live_payment=false) money edges
    // run in sandbox and are permitted-but-sandboxOnly (NOT LIVE_PAYMENT_DISABLED).
    disabledReasonCode = R.LIVE_PAYMENT_DISABLED;
  }

  return { ...base, permitted: disabledReasonCode === null, disabledReasonCode };
}

function deriveConfirmation(event, isMoney) {
  // Money moves, irreversible/terminal and authority edges require an explicit confirmation step.
  const CONFIRM = new Set([
    T.RELEASE_ESCROW,
    T.INITIATE_REFUND,
    T.COMPLETE_REFUND,
    T.HOLD_PAYMENT,
    T.REQUEST_PAYMENT,
    T.CANCEL,
    T.RAISE_DISPUTE,
    T.SUSPEND,
    T.COMPLIANCE_FAIL,
    T.CONFIRM_DELIVERY,
  ]);
  return isMoney || CONFIRM.has(event);
}

/**
 * Safe evidence CATEGORIES (not secrets/refs) the action requires, derived from the descriptor's condition
 * arrays. These are coarse category labels the UI can prompt for — never raw evidence references.
 */
function requiredEvidenceFor(descriptor) {
  const categories = new Set();
  if (descriptor.documentConditions?.length) categories.add('DOCUMENTS');
  if (descriptor.complianceConditions?.length) categories.add('COMPLIANCE');
  if (descriptor.shipmentConditions?.length) categories.add('SHIPMENT');
  if (descriptor.releaseConditions?.length) {
    categories.add('DELIVERY_CONFIRMATION');
    categories.add('RELEASE_APPROVAL');
  }
  if (descriptor.requiredVerification?.length) categories.add('IDENTITY_VERIFICATION');
  return [...categories];
}

// ── Transition actions exposed to the UI (the canonical lifecycle verbs) ─────
const TRANSITION_ACTIONS = Object.freeze([
  { actionKey: 'run-eligibility', labelKey: 'safetrade.action.runEligibility', event: T.RUN_ELIGIBILITY },
  { actionKey: 'buyer-commit', labelKey: 'safetrade.action.buyerCommit', event: T.BUYER_COMMIT },
  { actionKey: 'seller-commit', labelKey: 'safetrade.action.sellerCommit', event: T.SELLER_COMMIT },
  { actionKey: 'request-payment', labelKey: 'safetrade.action.requestPayment', event: T.REQUEST_PAYMENT },
  { actionKey: 'hold-payment', labelKey: 'safetrade.action.holdPayment', event: T.HOLD_PAYMENT },
  { actionKey: 'attach-documents', labelKey: 'safetrade.action.attachDocuments', event: T.ATTACH_DOCUMENTS },
  { actionKey: 'submit-compliance', labelKey: 'safetrade.action.submitCompliance', event: T.SUBMIT_COMPLIANCE },
  { actionKey: 'compliance-pass', labelKey: 'safetrade.action.compliancePass', event: T.COMPLIANCE_PASS },
  { actionKey: 'compliance-fail', labelKey: 'safetrade.action.complianceFail', event: T.COMPLIANCE_FAIL },
  { actionKey: 'begin-shipment', labelKey: 'safetrade.action.beginShipment', event: T.BEGIN_SHIPMENT },
  { actionKey: 'mark-arrived', labelKey: 'safetrade.action.markArrived', event: T.MARK_ARRIVED },
  { actionKey: 'await-delivery', labelKey: 'safetrade.action.awaitDelivery', event: T.AWAIT_DELIVERY },
  { actionKey: 'confirm-delivery', labelKey: 'safetrade.action.confirmDelivery', event: T.CONFIRM_DELIVERY },
  { actionKey: 'release-escrow', labelKey: 'safetrade.action.releaseEscrow', event: T.RELEASE_ESCROW },
  { actionKey: 'suspend', labelKey: 'safetrade.action.suspend', event: T.SUSPEND },
  { actionKey: 'resume', labelKey: 'safetrade.action.resume', event: T.RESUME },
  { actionKey: 'cancel', labelKey: 'safetrade.action.cancel', event: T.CANCEL },
  { actionKey: 'initiate-refund', labelKey: 'safetrade.action.initiateRefund', event: T.INITIATE_REFUND },
  { actionKey: 'complete-refund', labelKey: 'safetrade.action.completeRefund', event: T.COMPLETE_REFUND },
]);

/**
 * computeAvailableActions — the single, safe, server-derived projection the UI consumes.
 *
 * @param {object} txn          The authoritative SafeTrade transaction row (server-fetched).
 * @param {object} userContext  The server-derived auth context (platformRole/tenantRole/id only).
 * @param {object} [opts]
 * @param {Array}  [opts.milestones]  The transaction's milestones (used only for held-funds / release gating).
 * @param {object|Array|boolean} [opts.dispute]  Active-dispute signal (record/array/boolean).
 * @param {object} [opts.eligibility]  An optional release/eligibility verdict ({ eligible }) used to gate
 *                                     release authority actions (NOT_ELIGIBLE / NEEDS_EVALUATION).
 * @returns {Array<object>} safe action metadata objects (see SAFETRADE_DISABLED_REASON_CODES).
 */
export function computeAvailableActions(txn, userContext = {}, { milestones = [], dispute = null, eligibility = null } = {}) {
  void milestones; // reserved for future fine-grained money gating; never leaked into the output.

  const enabled = isSafeTradeEnabled();
  const liveOff = !isSafeTradeLivePaymentEnabled();

  const designState = designStateOf(txn);
  const { role: actorRole, privileged } = deriveActorRole(txn, userContext);
  const disputeActive = hasActiveDispute(dispute, designState);

  // Whether THIS transaction would require a live money move (non-sandbox provider / live flag) while live
  // payment is off — the exact LIVE_PAYMENT_DISABLED condition the release policy raises.
  const providerSandbox = ['sandbox', 'fake'].includes(String(txn?.payment_provider ?? '').toLowerCase());
  const txnRequiresLive = (!providerSandbox || txn?.live_payment === true);

  // If the whole surface is disabled, NOTHING is permitted (a single safe shape per action with DISABLED).
  const disableAll = !enabled;

  const actions = [];

  // 1. Transition-derived actions.
  for (const spec of TRANSITION_ACTIONS) {
    const descriptor = SAFETRADE_TRANSITION_TABLE[spec.event];
    if (!descriptor) continue;
    const action = evaluateTransitionAction({
      actionKey: spec.actionKey,
      labelKey: spec.labelKey,
      event: spec.event,
      descriptor,
      actorRole,
      privileged,
      designState,
      disputeActive,
      liveOff,
      txnRequiresLive,
    });
    if (disableAll) { action.permitted = false; action.disabledReasonCode = R.DISABLED; }
    actions.push(action);
  }

  // 2. Non-transition route actions (the dedicated endpoints that are not raw state-machine edges).
  //    Each mirrors the route + service authority exactly.
  actions.push(
    evaluateEvaluateRelease({ privileged, disputeActive, disableAll }),
    evaluateApproveRelease({ privileged, designState, disputeActive, eligibility, liveOff, txnRequiresLive, disableAll }),
    evaluateRequestRelease({ actorRole, privileged, designState, disputeActive, disableAll }),
    evaluateOpenDispute({ actorRole, privileged, designState, disableAll }),
    evaluateAddEvidence({ actorRole, privileged, designState, disputeActive, disableAll }),
    evaluateResolveDispute({ privileged, disputeActive, disableAll }),
    evaluateDefineMilestone({ actorRole, privileged, designState, disputeActive, disableAll }),
  );

  return actions;
}

// ── Non-transition route action evaluators (mirror the routes + services) ────

// evaluate-release — reviewerAuth route + the release policy requires a platform reviewer/admin. Recording
// an evaluation is read-only money-wise (sandboxOnly=false: it never moves money), reviewerRequired=true.
function evaluateEvaluateRelease({ privileged, disputeActive, disableAll }) {
  const a = {
    actionKey: 'evaluate-release',
    labelKey: 'safetrade.action.evaluateRelease',
    confirmationRequired: false,
    reviewerRequired: true,
    sandboxOnly: false,
    requiredEvidenceCategories: [],
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (!privileged) reason = R.NEEDS_REVIEWER; // ordinary participant -> NEEDS_REVIEWER (route 403)
  // An active dispute does not stop EVALUATING (it will simply report ACTIVE_DISPUTE as a blocker), so we
  // do not block the evaluate action itself.
  void disputeActive;
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// approve-release — reviewerAuth route + RELEASE_ESCROW (reviewer/admin, evaluation-gated, money RELEASE).
function evaluateApproveRelease({ privileged, designState, disputeActive, eligibility, liveOff, txnRequiresLive, disableAll }) {
  const descriptor = SAFETRADE_TRANSITION_TABLE[T.RELEASE_ESCROW];
  const a = {
    actionKey: 'approve-release',
    labelKey: 'safetrade.action.approveRelease',
    confirmationRequired: true,
    reviewerRequired: true,
    sandboxOnly: true,
    requiredEvidenceCategories: requiredEvidenceFor(descriptor),
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (!privileged) reason = R.NEEDS_REVIEWER;
  else if (disputeActive) reason = R.DISPUTE_ACTIVE; // active dispute blocks release
  else if (!descriptor.from.includes(designState)) reason = R.WRONG_STATE;
  else if (liveOff && txnRequiresLive) reason = R.LIVE_PAYMENT_DISABLED;
  else if (eligibility && eligibility.eligible === false) reason = R.NOT_ELIGIBLE;
  else if (eligibility == null) reason = R.NEEDS_EVALUATION; // release authority needs a passing evaluation
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// request-release — auth route; drives MARK_ARRIVED (reviewer/admin/system) OR a reviewer-gated milestone
// money staging op. The bare transition (MARK_ARRIVED) is reviewer/admin-only, so for a participant this is
// NEEDS_REVIEWER unless the state admits a participant. Mirrors the route default (event MARK_ARRIVED).
function evaluateRequestRelease({ privileged, designState, disputeActive, disableAll }) {
  const descriptor = SAFETRADE_TRANSITION_TABLE[T.MARK_ARRIVED];
  const a = {
    actionKey: 'request-release',
    labelKey: 'safetrade.action.requestRelease',
    confirmationRequired: true,
    reviewerRequired: true,
    sandboxOnly: false,
    requiredEvidenceCategories: requiredEvidenceFor(descriptor),
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (disputeActive) reason = R.DISPUTE_ACTIVE;
  else if (!privileged) reason = R.NEEDS_REVIEWER; // MARK_ARRIVED actorRoles = REVIEWER/ADMIN/SYSTEM
  else if (!descriptor.from.includes(designState)) reason = R.WRONG_STATE;
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// open-dispute — auth route + RAISE_DISPUTE (buyer/seller/reviewer/admin) reachable from any active
// post-commit state. Mirrors the dispute service: a participant or privileged actor may open.
function evaluateOpenDispute({ actorRole, privileged, designState, disableAll }) {
  const descriptor = SAFETRADE_TRANSITION_TABLE[T.RAISE_DISPUTE];
  const a = {
    actionKey: 'open-dispute',
    labelKey: 'safetrade.action.openDispute',
    confirmationRequired: true,
    reviewerRequired: false,
    sandboxOnly: false,
    requiredEvidenceCategories: [],
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (!descriptor.from.includes(designState)) reason = R.WRONG_STATE;
  else if (!(privileged || (actorRole && descriptor.actorRoles.includes(actorRole)))) reason = R.WRONG_ROLE;
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// add-evidence — auth route; any participant or privileged actor on the txn may append evidence to a case.
// Requires an active dispute to attach to (else WRONG_STATE — no open case).
function evaluateAddEvidence({ actorRole, privileged, disputeActive, disableAll }) {
  const a = {
    actionKey: 'add-evidence',
    labelKey: 'safetrade.action.addEvidence',
    confirmationRequired: false,
    reviewerRequired: false,
    sandboxOnly: false,
    requiredEvidenceCategories: ['STATEMENT'],
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (!disputeActive) reason = R.WRONG_STATE; // nothing to attach to without an open case
  else if (!(privileged || actorRole === 'BUYER' || actorRole === 'SELLER')) reason = R.WRONG_ROLE;
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// resolve-dispute — reviewerAuth route + dispute service reviewer/admin-only terminal resolution.
function evaluateResolveDispute({ privileged, disputeActive, disableAll }) {
  const a = {
    actionKey: 'resolve-dispute',
    labelKey: 'safetrade.action.resolveDispute',
    confirmationRequired: true,
    reviewerRequired: true,
    sandboxOnly: true, // a REFUND/RELEASE resolution moves sandbox money
    requiredEvidenceCategories: [],
  };
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (!privileged) reason = R.NEEDS_REVIEWER; // ordinary participant -> route 403
  else if (!disputeActive) reason = R.WRONG_STATE; // no active case to resolve
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

// define-milestone — auth route; participant/privileged on a DRAFT/INITIATED txn may (re)define the set.
function evaluateDefineMilestone({ actorRole, privileged, designState, disputeActive, disableAll }) {
  const a = {
    actionKey: 'define-milestone',
    labelKey: 'safetrade.action.defineMilestone',
    confirmationRequired: false,
    reviewerRequired: false,
    sandboxOnly: false,
    requiredEvidenceCategories: [],
  };
  // Milestones may only be (re)defined while DRAFT or pre-commit (INITIATED -> design AWAITING_BUYER_COMMITMENT).
  const DEFINABLE = new Set([S.DRAFT, S.ELIGIBILITY_PENDING, S.AWAITING_BUYER_COMMITMENT]);
  let reason = null;
  if (disableAll) reason = R.DISABLED;
  else if (disputeActive) reason = R.DISPUTE_ACTIVE;
  else if (!DEFINABLE.has(designState)) reason = R.WRONG_STATE;
  else if (!(privileged || actorRole === 'BUYER' || actorRole === 'SELLER')) reason = R.WRONG_ROLE;
  return { ...a, permitted: reason === null, disabledReasonCode: reason };
}

export {
  deriveActorRole as deriveSafeTradeActorRole,
  designStateOf as safeTradeDesignStateOf,
  HELD_DESIGN_STATES as SAFETRADE_HELD_DESIGN_STATES,
  TERMINAL_DESIGN_STATES as SAFETRADE_TERMINAL_DESIGN_STATES,
};

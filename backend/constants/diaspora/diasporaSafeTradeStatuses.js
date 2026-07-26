/**
 * Phase 9 — SafeTrade canonical state machine + transition table (framework-neutral).
 *
 * SafeTrade is an ASSURANCE/ESCROW OVERLAY on top of the 23-state import-order DAG
 * (IMPORT_ORDER_STATUSES / IMPORT_ORDER_TRANSITIONS in diasporaStatuses.js). It does NOT
 * re-implement the logistics state machine: it references an import_order_id and DERIVES its
 * shipment/compliance/document gate conditions by reading existing rows. The three directive §39
 * logistics states READY_FOR_SHIPMENT / IN_TRANSIT / ARRIVED collapse into a single coarse
 * SHIPMENT_IN_PROGRESS state whose sub-progress is read-through from the import order.
 *
 * This module is pure frozen data + pure helpers — NO DB/network imports — so it is unit-testable
 * exactly like diasporaStatuses.js. It mirrors that file's shape (Object.freeze enums, a transition
 * map, terminal sets) and the canTransition/assertTransitionAllowed helpers of diasporaWorkflowService.
 *
 * NON-NEGOTIABLE invariants (directive §5.2 / 37-51) encoded in the transition descriptors:
 *   N1 No real money / no real escrow release — money edges carry moneyMovement + liveGate.
 *   N2 No auto compliance approval — COMPLIANCE_PASS requires REVIEWER/ADMIN + compliance.humanApproved.
 *   N3 No auto shipment/delivery completion — CONFIRM_DELIVERY requires buyer (or reviewer override).
 *   N4 No auto reputation — COMPLETE emits a reputation-ELIGIBLE event only; never writes reputation.
 *   N5 High-risk release needs reviewer/admin approval even when auto-conditions pass.
 *   N6 Critical transitions fail atomically if their audit row cannot be written (auditPolicy:'CRITICAL').
 *   N7 Everything gated behind DIASPORA_SAFETRADE_ENABLED; money behind DIASPORA_SAFETRADE_LIVE_PAYMENT
 *      (see diasporaSafeTradeConstants.js). This module is pure and flag-agnostic; the service applies flags.
 */

// ── 1. Canonical state enum (16 states) ──────────────────────────────────────
export const SAFETRADE_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  ELIGIBILITY_PENDING: 'ELIGIBILITY_PENDING',
  AWAITING_BUYER_COMMITMENT: 'AWAITING_BUYER_COMMITMENT',
  AWAITING_SELLER_COMMITMENT: 'AWAITING_SELLER_COMMITMENT',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_HELD: 'PAYMENT_HELD',
  DOCUMENTS_PENDING: 'DOCUMENTS_PENDING',
  COMPLIANCE_REVIEW: 'COMPLIANCE_REVIEW',
  // Collapses directive §39 READY_FOR_SHIPMENT + IN_TRANSIT + ARRIVED (read-through to import order).
  SHIPMENT_IN_PROGRESS: 'SHIPMENT_IN_PROGRESS',
  DELIVERY_CONFIRMATION_PENDING: 'DELIVERY_CONFIRMATION_PENDING',
  COMPLETED: 'COMPLETED', // terminal (happy path)
  DISPUTED: 'DISPUTED', // escape hatch (non-terminal)
  SUSPENDED: 'SUSPENDED', // escape hatch (non-terminal)
  CANCELLED: 'CANCELLED', // terminal
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED', // terminal
});

// ── 2. Canonical transition (event) names — the verbs the service dispatches ──
export const SAFETRADE_TRANSITIONS = Object.freeze({
  INITIATE: 'INITIATE',
  RUN_ELIGIBILITY: 'RUN_ELIGIBILITY',
  ELIGIBILITY_CLEARED: 'ELIGIBILITY_CLEARED',
  BUYER_COMMIT: 'BUYER_COMMIT',
  SELLER_COMMIT: 'SELLER_COMMIT',
  REQUEST_PAYMENT: 'REQUEST_PAYMENT',
  HOLD_PAYMENT: 'HOLD_PAYMENT',
  ATTACH_DOCUMENTS: 'ATTACH_DOCUMENTS',
  SUBMIT_COMPLIANCE: 'SUBMIT_COMPLIANCE',
  COMPLIANCE_PASS: 'COMPLIANCE_PASS',
  COMPLIANCE_FAIL: 'COMPLIANCE_FAIL',
  BEGIN_SHIPMENT: 'BEGIN_SHIPMENT',
  MARK_ARRIVED: 'MARK_ARRIVED',
  AWAIT_DELIVERY: 'AWAIT_DELIVERY',
  CONFIRM_DELIVERY: 'CONFIRM_DELIVERY',
  RELEASE_ESCROW: 'RELEASE_ESCROW',
  RAISE_DISPUTE: 'RAISE_DISPUTE',
  SUSPEND: 'SUSPEND',
  RESUME: 'RESUME',
  CANCEL: 'CANCEL',
  INITIATE_REFUND: 'INITIATE_REFUND',
  COMPLETE_REFUND: 'COMPLETE_REFUND',
});

const S = SAFETRADE_STATES;
const T = SAFETRADE_TRANSITIONS;

// ── 3. Terminal / escape-hatch / escrow-held sets ────────────────────────────
export const SAFETRADE_TERMINAL_STATES = Object.freeze([S.COMPLETED, S.CANCELLED, S.REFUNDED]);

export const SAFETRADE_ESCAPE_HATCH_STATES = Object.freeze([S.DISPUTED, S.SUSPENDED]);

// States in which sandbox funds are notionally held (used by guards / CANCEL-forbidden rule).
export const SAFETRADE_ESCROW_HELD_STATES = Object.freeze([
  S.PAYMENT_HELD,
  S.DOCUMENTS_PENDING,
  S.COMPLIANCE_REVIEW,
  S.SHIPMENT_IN_PROGRESS,
  S.DELIVERY_CONFIRMATION_PENDING,
  S.DISPUTED,
  S.SUSPENDED,
  S.REFUND_PENDING,
]);

// ── 4. Risk tiers for the release policy engine (N5) ─────────────────────────
export const SAFETRADE_RISK_TIERS = Object.freeze({ LOW: 'LOW', STANDARD: 'STANDARD', HIGH: 'HIGH' });

// Dispute-restriction vocabulary encoded per transition.
export const SAFETRADE_DISPUTE_RESTRICTIONS = Object.freeze({
  BLOCKED_WHILE_DISPUTED: 'BLOCKED_WHILE_DISPUTED',
  RESOLUTION_ONLY: 'RESOLUTION_ONLY',
  NONE: 'NONE',
});

// Money-movement vocabulary (null encoded as 'NONE' for table clarity; descriptor uses null).
export const SAFETRADE_MONEY_MOVEMENTS = Object.freeze({
  NONE: null,
  HOLD: 'HOLD',
  RELEASE: 'RELEASE',
  REFUND: 'REFUND',
});

// Active, non-terminal, non-hatch states — the source set escape hatches expand over.
const ACTIVE_NON_HATCH_STATES = Object.freeze([
  S.ELIGIBILITY_PENDING,
  S.AWAITING_BUYER_COMMITMENT,
  S.AWAITING_SELLER_COMMITMENT,
  S.PAYMENT_PENDING,
  S.PAYMENT_HELD,
  S.DOCUMENTS_PENDING,
  S.COMPLIANCE_REVIEW,
  S.SHIPMENT_IN_PROGRESS,
  S.DELIVERY_CONFIRMATION_PENDING,
  S.REFUND_PENDING,
]);

// RAISE_DISPUTE is reachable from any active POST-COMMITMENT state (funds path), per §4.1.
const DISPUTE_SOURCE_STATES = Object.freeze([
  S.PAYMENT_PENDING,
  S.PAYMENT_HELD,
  S.DOCUMENTS_PENDING,
  S.COMPLIANCE_REVIEW,
  S.SHIPMENT_IN_PROGRESS,
  S.DELIVERY_CONFIRMATION_PENDING,
  S.REFUND_PENDING,
]);

// SUSPEND (reviewer/admin freeze) is reachable from any active state, including pre-commitment.
const SUSPEND_SOURCE_STATES = ACTIVE_NON_HATCH_STATES;

// CANCEL is FORBIDDEN once funds are held (§4.1): only pre-hold active states + the escape hatches.
const CANCEL_SOURCE_STATES = Object.freeze([
  S.DRAFT,
  S.ELIGIBILITY_PENDING,
  S.AWAITING_BUYER_COMMITMENT,
  S.AWAITING_SELLER_COMMITMENT,
  S.PAYMENT_PENDING,
  S.DISPUTED,
  S.SUSPENDED,
]);

// INITIATE_REFUND is the only money-exit from escrow-held + escape-hatch states.
const REFUND_SOURCE_STATES = Object.freeze([
  S.PAYMENT_HELD,
  S.DOCUMENTS_PENDING,
  S.COMPLIANCE_REVIEW,
  S.SHIPMENT_IN_PROGRESS,
  S.DELIVERY_CONFIRMATION_PENDING,
  S.DISPUTED,
  S.SUSPENDED,
]);

// ── 5. THE transition table — one frozen descriptor per event (Section 4) ────
// Each *Conditions/actorRoles/requiredVerification array holds the condition keys from §2 so the
// service wires one resolver per key and the dispatcher just iterates the arrays (no per-edge code).
export const SAFETRADE_TRANSITION_TABLE = Object.freeze({
  [T.INITIATE]: Object.freeze({
    event: T.INITIATE,
    from: Object.freeze([]), // creation
    to: S.DRAFT,
    actorRoles: Object.freeze(['BUYER', 'ADMIN']),
    requiredEntitlement: 'diaspora.safetrade.create', // FEATURE_KEYS.SAFETRADE_CREATE (enforced when on)
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.NONE,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_INITIATED',
    notificationEvent: 'DIASPORA_SAFETRADE_INITIATED',
    idempotency: 'CREATE_BY_KEY',
    rollback: 'SOFT_DELETE',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.RUN_ELIGIBILITY]: Object.freeze({
    event: T.RUN_ELIGIBILITY,
    from: Object.freeze([S.DRAFT]),
    to: S.ELIGIBILITY_PENDING,
    actorRoles: Object.freeze(['BUYER', 'ADMIN', 'SYSTEM']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze(['compliance.noOpenFlags']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_ELIGIBILITY_STARTED',
    notificationEvent: 'DIASPORA_SAFETRADE_ELIGIBILITY',
    idempotency: 'IDEMPOTENT_NOOP',
    rollback: 'NOOP_REVERT',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.ELIGIBILITY_CLEARED]: Object.freeze({
    event: T.ELIGIBILITY_CLEARED,
    from: Object.freeze([S.ELIGIBILITY_PENDING]),
    to: S.AWAITING_BUYER_COMMITMENT,
    actorRoles: Object.freeze(['SYSTEM', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze(['verification.buyerVerified', 'verification.sellerVerified']),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze(['compliance.noOpenFlags']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_ELIGIBILITY_CLEARED',
    notificationEvent: 'DIASPORA_SAFETRADE_ELIGIBLE',
    idempotency: 'IDEMPOTENT_NOOP',
    rollback: 'NOOP_REVERT',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.BUYER_COMMIT]: Object.freeze({
    event: T.BUYER_COMMIT,
    from: Object.freeze([S.AWAITING_BUYER_COMMITMENT]),
    to: S.AWAITING_SELLER_COMMITMENT,
    actorRoles: Object.freeze(['BUYER']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze(['verification.buyerVerified']),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_BUYER_COMMITTED',
    notificationEvent: 'DIASPORA_SAFETRADE_BUYER_COMMITTED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.SELLER_COMMIT]: Object.freeze({
    event: T.SELLER_COMMIT,
    from: Object.freeze([S.AWAITING_SELLER_COMMITMENT]),
    to: S.PAYMENT_PENDING,
    actorRoles: Object.freeze(['SELLER']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze(['verification.sellerVerified']),
    paymentConditions: Object.freeze(['payment.milestonesReconcile']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_SELLER_COMMITTED',
    notificationEvent: 'DIASPORA_SAFETRADE_SELLER_COMMITTED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.REQUEST_PAYMENT]: Object.freeze({
    event: T.REQUEST_PAYMENT,
    from: Object.freeze([S.PAYMENT_PENDING]),
    to: S.PAYMENT_PENDING, // self; emits a sandbox payment intent
    actorRoles: Object.freeze(['BUYER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze(['verification.buyerVerified']),
    paymentConditions: Object.freeze(['payment.sandboxOnly', 'payment.milestonesReconcile']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: 'HOLD', // hold-intent only (no capture)
    liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_PAYMENT_REQUESTED',
    notificationEvent: 'DIASPORA_SAFETRADE_PAYMENT_REQUESTED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RELEASE_SANDBOX_HOLD',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.HOLD_PAYMENT]: Object.freeze({
    event: T.HOLD_PAYMENT,
    from: Object.freeze([S.PAYMENT_PENDING]),
    to: S.PAYMENT_HELD,
    actorRoles: Object.freeze(['BUYER', 'REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze(['verification.buyerVerified']),
    paymentConditions: Object.freeze(['payment.milestonesReconcile', 'payment.sandboxOnly']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: 'HOLD',
    liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',
    auditPolicy: 'CRITICAL', // atomic RPC
    auditAction: 'SAFETRADE_PAYMENT_HELD',
    notificationEvent: 'DIASPORA_SAFETRADE_PAYMENT_HELD',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RELEASE_SANDBOX_HOLD',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.ATTACH_DOCUMENTS]: Object.freeze({
    event: T.ATTACH_DOCUMENTS,
    from: Object.freeze([S.PAYMENT_HELD]),
    to: S.DOCUMENTS_PENDING,
    actorRoles: Object.freeze(['BUYER', 'SELLER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_DOCUMENTS_STAGE',
    notificationEvent: 'DIASPORA_SAFETRADE_DOCUMENTS_PENDING',
    idempotency: 'IDEMPOTENT_NOOP',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.SUBMIT_COMPLIANCE]: Object.freeze({
    event: T.SUBMIT_COMPLIANCE,
    from: Object.freeze([S.DOCUMENTS_PENDING]),
    to: S.COMPLIANCE_REVIEW,
    actorRoles: Object.freeze(['BUYER', 'SELLER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze(['documents.requiredVerified']),
    complianceConditions: Object.freeze(['compliance.noOpenFlags']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_COMPLIANCE_SUBMITTED',
    notificationEvent: 'DIASPORA_SAFETRADE_COMPLIANCE_REVIEW',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'NEVER',
  }),

  // N2 — REVIEWER/ADMIN only; requires a human-approved compliance row.
  [T.COMPLIANCE_PASS]: Object.freeze({
    event: T.COMPLIANCE_PASS,
    from: Object.freeze([S.COMPLIANCE_REVIEW]),
    to: S.SHIPMENT_IN_PROGRESS,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze(['documents.requiredVerified']),
    complianceConditions: Object.freeze(['compliance.humanApproved', 'compliance.noOpenFlags']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_COMPLIANCE_PASSED',
    notificationEvent: 'DIASPORA_SAFETRADE_COMPLIANCE_PASSED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'ALWAYS',
  }),

  [T.COMPLIANCE_FAIL]: Object.freeze({
    event: T.COMPLIANCE_FAIL,
    from: Object.freeze([S.COMPLIANCE_REVIEW]),
    to: S.DISPUTED,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_COMPLIANCE_FAILED',
    notificationEvent: 'DIASPORA_SAFETRADE_COMPLIANCE_FAILED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'COMPENSATING_ONLY',
    reviewerApprovalRequired: 'ALWAYS',
  }),

  [T.BEGIN_SHIPMENT]: Object.freeze({
    event: T.BEGIN_SHIPMENT,
    from: Object.freeze([S.SHIPMENT_IN_PROGRESS]),
    to: S.SHIPMENT_IN_PROGRESS, // self; records logistics start (observational)
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze(['compliance.humanApproved']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_SHIPMENT_BEGAN',
    notificationEvent: 'DIASPORA_SAFETRADE_SHIPMENT_STARTED',
    idempotency: 'IDEMPOTENT_NOOP',
    rollback: 'NOOP_REVERT',
    reviewerApprovalRequired: 'NEVER',
  }),

  // N3 — arrival is OBSERVED from the import order, never forced.
  [T.MARK_ARRIVED]: Object.freeze({
    event: T.MARK_ARRIVED,
    from: Object.freeze([S.SHIPMENT_IN_PROGRESS]),
    to: S.DELIVERY_CONFIRMATION_PENDING,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN', 'SYSTEM']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze(['compliance.humanApproved']),
    shipmentConditions: Object.freeze(['shipment.arrivedOrReleased']),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_SHIPMENT_ARRIVED',
    notificationEvent: 'DIASPORA_SAFETRADE_ARRIVED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'NEVER',
  }),

  // AWAIT_DELIVERY is a structural alias for entering the delivery-confirmation phase (self/no-op
  // from MARK_ARRIVED's target). Kept distinct so the service can emit an "awaiting buyer" prompt.
  [T.AWAIT_DELIVERY]: Object.freeze({
    event: T.AWAIT_DELIVERY,
    from: Object.freeze([S.DELIVERY_CONFIRMATION_PENDING]),
    to: S.DELIVERY_CONFIRMATION_PENDING, // self
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN', 'SYSTEM']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze(['shipment.arrivedOrReleased']),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'BEST_EFFORT',
    auditAction: 'SAFETRADE_AWAITING_DELIVERY',
    notificationEvent: 'DIASPORA_SAFETRADE_AWAITING_DELIVERY',
    idempotency: 'IDEMPOTENT_NOOP',
    rollback: 'NOOP_REVERT',
    reviewerApprovalRequired: 'NEVER',
  }),

  // N3 — buyer (or reviewer/admin override) explicitly confirms; this only sets a CONDITION FLAG.
  [T.CONFIRM_DELIVERY]: Object.freeze({
    event: T.CONFIRM_DELIVERY,
    from: Object.freeze([S.DELIVERY_CONFIRMATION_PENDING]),
    to: S.DELIVERY_CONFIRMATION_PENDING, // self; sets delivery.buyerConfirmed
    actorRoles: Object.freeze(['BUYER', 'REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze(['shipment.arrivedOrReleased']),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_DELIVERY_CONFIRMED',
    notificationEvent: 'DIASPORA_SAFETRADE_DELIVERY_CONFIRMED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'NOOP_REVERT',
    reviewerApprovalRequired: 'NEVER',
  }),

  // N4/N5 — REVIEWER/ADMIN release authority; buyer confirmation is a CONDITION not the actor.
  [T.RELEASE_ESCROW]: Object.freeze({
    event: T.RELEASE_ESCROW,
    from: Object.freeze([S.DELIVERY_CONFIRMATION_PENDING]),
    to: S.COMPLETED,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.allHeld', 'payment.sandboxOnly']),
    documentConditions: Object.freeze(['documents.requiredVerified']),
    complianceConditions: Object.freeze(['compliance.humanApproved']),
    shipmentConditions: Object.freeze(['shipment.arrivedOrReleased']),
    // Release policy conditions: delivery confirmed + policy eligible + high-risk reviewer approval.
    releaseConditions: Object.freeze([
      'delivery.buyerConfirmed',
      'release.policyEligible',
      'release.reviewerApprovedIfHighRisk',
    ]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.BLOCKED_WHILE_DISPUTED,
    moneyMovement: 'RELEASE',
    liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',
    auditPolicy: 'CRITICAL', // atomic RPC
    auditAction: 'SAFETRADE_ESCROW_RELEASED',
    notificationEvent: 'DIASPORA_SAFETRADE_COMPLETED',
    // N4 — completion ALSO emits a reputation-ELIGIBLE event only (no auto reputation write).
    additionalEvents: Object.freeze(['DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE']),
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'COMPENSATING_ONLY',
    reviewerApprovalRequired: 'IF_HIGH_RISK',
  }),

  [T.RAISE_DISPUTE]: Object.freeze({
    event: T.RAISE_DISPUTE,
    from: DISPUTE_SOURCE_STATES, // expanded: any active post-commit state
    to: S.DISPUTED,
    actorRoles: Object.freeze(['BUYER', 'SELLER', 'REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_DISPUTE_RAISED',
    notificationEvent: 'DIASPORA_SAFETRADE_DISPUTED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE', // records disputedFrom; funds frozen (sandbox)
    reviewerApprovalRequired: 'NEVER',
  }),

  [T.SUSPEND]: Object.freeze({
    event: T.SUSPEND,
    from: SUSPEND_SOURCE_STATES, // expanded: any active state
    to: S.SUSPENDED,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_SUSPENDED',
    notificationEvent: 'DIASPORA_SAFETRADE_SUSPENDED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE', // records suspendedFrom
    reviewerApprovalRequired: 'ALWAYS',
  }),

  // RESUME targets the recorded disputedFrom/suspendedFrom (dynamic target; service resolves it).
  [T.RESUME]: Object.freeze({
    event: T.RESUME,
    from: Object.freeze([S.DISPUTED, S.SUSPENDED]),
    to: null, // dynamic: recorded source (RESTORE_SOURCE), service supplies the concrete target
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze(['compliance.noOpenFlags']),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_RESUMED',
    notificationEvent: 'DIASPORA_SAFETRADE_RESUMED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'ALWAYS',
  }),

  [T.CANCEL]: Object.freeze({
    event: T.CANCEL,
    from: CANCEL_SOURCE_STATES, // FORBIDDEN from escrow-held states (§4.1)
    to: S.CANCELLED,
    actorRoles: Object.freeze(['BUYER', 'REVIEWER', 'ADMIN']), // BUYER only pre-hold (enforced via from-set)
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze([]),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: null,
    liveGate: null,
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_CANCELLED',
    notificationEvent: 'DIASPORA_SAFETRADE_CANCELLED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'SOFT_DELETE',
    reviewerApprovalRequired: 'NEVER',
  }),

  // N5 — REVIEWER/ADMIN release authority for the money-exit path.
  [T.INITIATE_REFUND]: Object.freeze({
    event: T.INITIATE_REFUND,
    from: REFUND_SOURCE_STATES,
    to: S.REFUND_PENDING,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.sandboxOnly']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: 'REFUND', // refund-intent
    liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',
    auditPolicy: 'CRITICAL',
    auditAction: 'SAFETRADE_REFUND_INITIATED',
    notificationEvent: 'DIASPORA_SAFETRADE_REFUND_PENDING',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'RESTORE_SOURCE',
    reviewerApprovalRequired: 'ALWAYS',
  }),

  [T.COMPLETE_REFUND]: Object.freeze({
    event: T.COMPLETE_REFUND,
    from: Object.freeze([S.REFUND_PENDING]),
    to: S.REFUNDED,
    actorRoles: Object.freeze(['REVIEWER', 'ADMIN']),
    requiredEntitlement: null,
    requiredVerification: Object.freeze([]),
    paymentConditions: Object.freeze(['payment.sandboxOnly']),
    documentConditions: Object.freeze([]),
    complianceConditions: Object.freeze([]),
    shipmentConditions: Object.freeze([]),
    disputeRestriction: SAFETRADE_DISPUTE_RESTRICTIONS.RESOLUTION_ONLY,
    moneyMovement: 'REFUND',
    liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',
    auditPolicy: 'CRITICAL', // atomic RPC
    auditAction: 'SAFETRADE_REFUNDED',
    notificationEvent: 'DIASPORA_SAFETRADE_REFUNDED',
    idempotency: 'REPLAY_BY_KEY',
    rollback: 'COMPENSATING_ONLY',
    reviewerApprovalRequired: 'ALWAYS',
  }),
});

// ── 6. Derived adjacency map (source state -> [allowed event names]) ─────────
// Computed from the table so canDispatch() works exactly like IMPORT_ORDER_TRANSITIONS lookups.
function buildAdjacency() {
  const adjacency = {};
  // Seed every state (terminals included) so lookups never return undefined.
  for (const state of Object.values(SAFETRADE_STATES)) adjacency[state] = [];
  for (const descriptor of Object.values(SAFETRADE_TRANSITION_TABLE)) {
    for (const source of descriptor.from) {
      if (!adjacency[source]) adjacency[source] = [];
      if (!adjacency[source].includes(descriptor.event)) adjacency[source].push(descriptor.event);
    }
  }
  for (const state of Object.keys(adjacency)) adjacency[state] = Object.freeze(adjacency[state]);
  return Object.freeze(adjacency);
}

export const SAFETRADE_STATE_ADJACENCY = buildAdjacency();

// ── 7. Pure helpers (mirror diasporaWorkflowService canTransition/assertTransitionAllowed) ───

/** Return the frozen descriptor for an event, or null. */
export function getTransition(eventName) {
  return SAFETRADE_TRANSITION_TABLE[eventName] || null;
}

/** Structural legality only: is `eventName` allowed out of `currentState`? */
export function canDispatch(currentState, eventName) {
  const allowed = SAFETRADE_STATE_ADJACENCY[currentState];
  return Array.isArray(allowed) && allowed.includes(eventName);
}

/**
 * Throw a ValidationError-shaped error if the structural transition is illegal. Conditions,
 * authorization, money gating and audit are enforced separately by the service (see §8).
 */
export function assertDispatchAllowed(currentState, eventName) {
  const descriptor = getTransition(eventName);
  if (!descriptor) {
    const err = new Error(`SAFETRADE/UNKNOWN_TRANSITION: ${eventName}`);
    err.code = 'SAFETRADE/UNKNOWN_TRANSITION';
    err.statusCode = 400;
    throw err;
  }
  if (!canDispatch(currentState, eventName)) {
    const err = new Error(`SAFETRADE/INVALID_TRANSITION: ${currentState} -> ${eventName}`);
    err.code = 'SAFETRADE/INVALID_TRANSITION';
    err.statusCode = 409;
    throw err;
  }
  return descriptor;
}

export function isTerminal(state) {
  return SAFETRADE_TERMINAL_STATES.includes(state);
}

export function isEscapeHatch(state) {
  return SAFETRADE_ESCAPE_HATCH_STATES.includes(state);
}

export function isEscrowHeld(state) {
  return SAFETRADE_ESCROW_HELD_STATES.includes(state);
}

/** All states reachable in one structural step from `currentState`. */
export function nextStates(currentState) {
  const events = SAFETRADE_STATE_ADJACENCY[currentState] || [];
  return events
    .map((event) => getTransition(event)?.to)
    .filter((target) => target != null);
}

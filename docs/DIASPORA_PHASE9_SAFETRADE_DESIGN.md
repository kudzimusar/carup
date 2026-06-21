# Diaspora Phase 9 SafeTrade — Design (workflow-produced, durable)

> Source: workflow wf_e1c66e58-9b4 (design phase complete; build interrupted by session limit).
> This is the BUILDABLE design spec for SafeTrade. Resume the build from these specs.
> Non-negotiables: sandbox-only payments (live throws EXTERNAL_ACTIVATION_REQUIRED), no auto
> money/escrow/compliance/shipment/delivery/reputation, high-risk release needs reviewer approval,
> critical transitions fail atomically without audit, gated behind DIASPORA_SAFETRADE_ENABLED (off).


---

## A. State machine + transition table

I now have full grounding in the codebase conventions: env-flag pattern (fail-closed), audit-inside-txn RPC, server-derived authorization, entitlement guard, existing 23-state import order DAG, payment milestones schema, compliance/shipment statuses, and notification/event shapes. I have everything needed to produce the complete buildable spec.

---

# SafeTrade State Machine + Transition Table — Buildable Design Spec (Phase 9)

## 0. Scope, grounding, and non-negotiables

This spec defines the **canonical SafeTrade transaction state machine** and its **transition table** as a framework-neutral constants module. It is a design document only — no files are written, no migrations applied, no providers called.

**Module to produce (the build target):** `backend/constants/diaspora/diasporaSafeTradeStatuses.js` (ESM, `import/export`, frozen objects — mirrors `backend/constants/diaspora/diasporaStatuses.js`).

**Reconciliation decision (do not duplicate):** SafeTrade is an **assurance/escrow overlay**, not a re-implementation of the 23-state import-order DAG in `diasporaStatuses.js`. The import order remains the logistics source of truth (`IMPORT_ORDER_STATUSES` / `IMPORT_ORDER_TRANSITIONS`). SafeTrade references an `import_order_id` and **derives** its shipment/compliance/document gate conditions by reading existing rows (`diaspora_import_orders.status`, `diaspora_compliance_reviews`, `vehicle_government_documents`, `diaspora_shipments`/`diaspora_shipment_stage_events`). Where the directive §39 names a state that the import DAG already owns, SafeTrade keeps a **distinct, coarser assurance state** and maps to/reads the import status rather than mirroring all 23 logistics states. Concretely:

| Directive §39 candidate | Decision |
|---|---|
| `DOCUMENTS_PENDING`, `COMPLIANCE_REVIEW` | **Keep** as SafeTrade gate states, but the *condition predicate* reads `vehicle_government_documents` / `diaspora_compliance_reviews` — SafeTrade does not own document/compliance records. |
| `READY_FOR_SHIPMENT`, `IN_TRANSIT`, `ARRIVED` | **Collapse** into a single SafeTrade `SHIPMENT_IN_PROGRESS` state whose sub-progress is *read from* `diaspora_shipments`/`IMPORT_ORDER_STATUSES`. SafeTrade does not re-run the LOADED→SHIPPED→ARRIVED_AT_BORDER→CUSTOMS→RELEASED chain; it observes it. |
| `PAYMENT_PENDING`, `PAYMENT_HELD` | **Keep** — these are the escrow-specific states the import DAG does *not* model. |
| All others (`DRAFT`, `ELIGIBILITY_PENDING`, commitments, `DELIVERY_CONFIRMATION_PENDING`, `COMPLETED`, `DISPUTED`, `SUSPENDED`, `CANCELLED`, `REFUND_PENDING`, `REFUNDED`) | **Keep** — SafeTrade-specific. |

**NON-NEGOTIABLE invariants enforced by every relevant transition (directive §5.2 / 37–51):**

- **N1 — No real money / no real escrow release.** Money-touching transitions (`HOLD_PAYMENT`, `RELEASE_ESCROW`, `REFUND`) route through a **payment provider abstraction whose default is SANDBOX/FAKE**. The live path **throws `EXTERNAL_ACTIVATION_REQUIRED`** unless an approved provider is wired. Mirrors `diasporaBillingConstants.js` `assertBillingProductionSafety()`.
- **N2 — No auto compliance approval.** `COMPLIANCE_PASS` requires a *human reviewer/admin* decision in `diaspora_compliance_reviews` (status `APPROVED`); SafeTrade never sets it.
- **N3 — No auto shipment/delivery completion.** `CONFIRM_DELIVERY` requires explicit buyer (or reviewer override) action; never time- or webhook-auto-fired.
- **N4 — No auto reputation.** `COMPLETE` emits a **reputation-eligibility event only** (`DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE`); it never writes `diaspora_reputation_records`.
- **N5 — High-risk release requires reviewer/admin approval even when automated conditions pass.** `RELEASE_ESCROW` from `PAYMENT_HELD` is gated by the release policy engine; if risk tier is high, a reviewer approval row is required in addition to all auto-conditions.
- **N6 — Critical transitions fail atomically if their audit row cannot be written.** Money/state-of-record transitions use `appendCriticalAudit` (fail-loud) or, preferably, an atomic RPC that writes the audit row inside the same transaction (pattern: `20260621090000_diaspora_h1_stock_movement_rpc.sql` step 8).
- **N7 — Everything gated behind `DIASPORA_SAFETRADE_ENABLED` (default OFF).** A separate `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF, fail-closed) governs real money; sandbox is selected unless live is enabled **and** an approved provider is configured.

---

## 1. States (canonical enum)

```
DRAFT
ELIGIBILITY_PENDING
AWAITING_BUYER_COMMITMENT
AWAITING_SELLER_COMMITMENT
PAYMENT_PENDING
PAYMENT_HELD
DOCUMENTS_PENDING
COMPLIANCE_REVIEW
SHIPMENT_IN_PROGRESS        // collapses READY_FOR_SHIPMENT + IN_TRANSIT + ARRIVED
DELIVERY_CONFIRMATION_PENDING
COMPLETED                   // terminal (happy path)
DISPUTED                    // escape hatch (non-terminal)
SUSPENDED                   // escape hatch (non-terminal)
CANCELLED                   // terminal
REFUND_PENDING
REFUNDED                    // terminal
```

**Why `SHIPMENT_IN_PROGRESS` instead of the three directive states:** the LOADED→SHIPPED→ARRIVED logistics granularity already lives in the import-order DAG and `diaspora_shipments`. SafeTrade stores the observed logistics phase in `metadata.shipmentPhase` (read-through), avoiding a duplicate 3-state machine and a double source of truth. The transition *out* of `SHIPMENT_IN_PROGRESS` (`MARK_ARRIVED`) is the only SafeTrade-meaningful event and is gated on the import order reaching an arrival/release status.

### 1.1 Terminal vs non-terminal classification

- **Terminal states (no outgoing transitions):** `COMPLETED`, `CANCELLED`, `REFUNDED`.
- **Universal escape hatches (non-terminal, reachable from nearly every active state):**
  - `DISPUTED` — buyer/seller/reviewer can raise from any active post-commitment state. Funds (sandbox) stay held; resolution routes to `RESUME` (back to source phase), `REFUND_PENDING`, or `CANCELLED`/`COMPLETED` by reviewer.
  - `SUSPENDED` — reviewer/admin-only freeze from any active state (fraud signal, compliance flag). Resolution routes back via `RESUME` to the recorded `suspendedFrom` state or onward to `DISPUTED`/`CANCELLED`/`REFUND_PENDING`.
- **Active (in-flight) states:** everything else.

The module must export:
```js
export const SAFETRADE_TERMINAL_STATES = Object.freeze([COMPLETED, CANCELLED, REFUNDED]);
export const SAFETRADE_ESCAPE_HATCH_STATES = Object.freeze([DISPUTED, SUSPENDED]);
export const SAFETRADE_ESCROW_HELD_STATES = Object.freeze([
  PAYMENT_HELD, DOCUMENTS_PENDING, COMPLIANCE_REVIEW, SHIPMENT_IN_PROGRESS,
  DELIVERY_CONFIRMATION_PENDING, DISPUTED, SUSPENDED, REFUND_PENDING,
]); // states in which sandbox funds are notionally held (used by guards)
```

---

## 2. Actors, roles, and condition vocabulary (server-derived only)

**Actor roles** (resolved via `diasporaAuthorization.js` — never trust `x-stakeholder-role`):
- `BUYER` — `isOrderOwner(order, ctx)` against the linked import order, or the SafeTrade `buyer_id`.
- `SELLER` — assigned participant (`isAssignedParticipant`) with a seller role, or SafeTrade `seller_id`.
- `REVIEWER` — `isPlatformReviewer(ctx)` (platform/government/reviewer).
- `ADMIN` — `isPlatformAdmin(ctx)` or `isTenantAdminForRecord(ctx)`.
- `SYSTEM` — internal, only for non-money observational transitions (e.g. recording an eligibility result). **Never** for money/compliance/delivery/reputation.

**Required-entitlement vocabulary:** the only entitlement gate is `FEATURE_KEYS.SAFETRADE_CREATE` (`'diaspora.safetrade.create'`, already in `diasporaEntitlements.js`), enforced via `requireFeature(supabase, { tenantId, userId, featureKey })` from `diasporaEntitlementGuard.js` **only when `isSubscriptionEnforcementEnabled()` is true** (no-op otherwise). It gates `INITIATE` (DRAFT creation/submission) only.

**Condition predicate vocabulary** (each is a named, explainable boolean the eligibility/guard engine evaluates; encoded as condition keys in the transition map so the build wires a resolver per key):

| Condition key | Meaning (read-through to existing domain) |
|---|---|
| `verification.buyerVerified` | buyer KYC/verification per trade profile |
| `verification.sellerVerified` | seller verification per `diaspora_trade_profiles` |
| `payment.milestonesReconcile` | sum of `diaspora_payment_milestones.amount` == SafeTrade total |
| `payment.allHeld` | all `escrow` milestones `status='CONFIRMED'` (sandbox) |
| `payment.sandboxOnly` | provider resolves to SANDBOX (N1/N7) |
| `documents.requiredVerified` | all required `vehicle_government_documents` `verification_status='VERIFIED'` (reuse `assertZimbabweReadyPrerequisites` logic) |
| `compliance.humanApproved` | a `diaspora_compliance_reviews` row `status='APPROVED'` exists, set by a human (N2) |
| `compliance.noOpenFlags` | no `diaspora_compliance_reviews` row in `FLAGGED`/`REJECTED` |
| `shipment.arrivedOrReleased` | linked `diaspora_import_orders.status` ∈ {ARRIVED_AT_BORDER…RELEASED…ZIMBABWE_READY} or `diaspora_shipments.status` ∈ {ARRIVED, RELEASED} (N3 — observed, not forced) |
| `delivery.buyerConfirmed` | buyer (or reviewer override) explicitly confirmed (N3) |
| `dispute.none` | SafeTrade not currently `DISPUTED` |
| `release.policyEligible` | release policy engine returns eligible (no blockers) |
| `release.reviewerApprovedIfHighRisk` | if risk tier high, a reviewer/admin approval record exists (N5) |

**Dispute restriction (global):** while state is `DISPUTED` or `SUSPENDED`, **no money transition and no forward progress transition is permitted** except the reviewer-driven resolution edges. Encoded per transition as `disputeRestriction: 'BLOCKED_WHILE_DISPUTED' | 'RESOLUTION_ONLY' | 'NONE'`.

---

## 3. Module shape (exact `diasporaSafeTradeStatuses.js` contract)

The build must produce these named exports (frozen, ESM):

```js
// 1. Canonical state enum
export const SAFETRADE_STATES = Object.freeze({ DRAFT:'DRAFT', /* …all 16… */ });

// 2. Canonical transition (event) names — the verbs the service dispatches
export const SAFETRADE_TRANSITIONS = Object.freeze({
  INITIATE:'INITIATE', RUN_ELIGIBILITY:'RUN_ELIGIBILITY', ELIGIBILITY_CLEARED:'ELIGIBILITY_CLEARED',
  BUYER_COMMIT:'BUYER_COMMIT', SELLER_COMMIT:'SELLER_COMMIT', REQUEST_PAYMENT:'REQUEST_PAYMENT',
  HOLD_PAYMENT:'HOLD_PAYMENT', ATTACH_DOCUMENTS:'ATTACH_DOCUMENTS', SUBMIT_COMPLIANCE:'SUBMIT_COMPLIANCE',
  COMPLIANCE_PASS:'COMPLIANCE_PASS', COMPLIANCE_FAIL:'COMPLIANCE_FAIL', BEGIN_SHIPMENT:'BEGIN_SHIPMENT',
  MARK_ARRIVED:'MARK_ARRIVED', AWAIT_DELIVERY:'AWAIT_DELIVERY', CONFIRM_DELIVERY:'CONFIRM_DELIVERY',
  RELEASE_ESCROW:'RELEASE_ESCROW', RAISE_DISPUTE:'RAISE_DISPUTE', SUSPEND:'SUSPEND', RESUME:'RESUME',
  CANCEL:'CANCEL', INITIATE_REFUND:'INITIATE_REFUND', COMPLETE_REFUND:'COMPLETE_REFUND',
});

// 3. Terminal / escape-hatch / escrow-held sets (Section 1.1)
export const SAFETRADE_TERMINAL_STATES, SAFETRADE_ESCAPE_HATCH_STATES, SAFETRADE_ESCROW_HELD_STATES;

// 4. Risk tiers for the release policy
export const SAFETRADE_RISK_TIERS = Object.freeze({ LOW:'LOW', STANDARD:'STANDARD', HIGH:'HIGH' });

// 5. THE transition table — array of transition descriptors keyed by SAFETRADE_TRANSITIONS
export const SAFETRADE_TRANSITION_TABLE = Object.freeze({ /* see Section 4, one entry per event */ });

// 6. Derived adjacency map (source state -> [allowed event names]) built from the table,
//    mirroring IMPORT_ORDER_TRANSITIONS so canTransition() works the same way.
export const SAFETRADE_STATE_ADJACENCY = Object.freeze(/* computed */);

// 7. Pure helpers (mirror diasporaWorkflowService canTransition/assertTransitionAllowed)
export function getTransition(eventName);                       // -> descriptor or null
export function canDispatch(currentState, eventName);           // structural legality only
export function assertDispatchAllowed(currentState, eventName); // throws ValidationError (illegal transition)
export function isTerminal(state); export function isEscapeHatch(state); export function isEscrowHeld(state);
```

### 3.1 Transition descriptor shape (every entry in `SAFETRADE_TRANSITION_TABLE`)

```js
[SAFETRADE_TRANSITIONS.HOLD_PAYMENT]: Object.freeze({
  event: 'HOLD_PAYMENT',
  from: [PAYMENT_PENDING],                       // source states
  to: PAYMENT_HELD,                              // target state
  actorRoles: ['BUYER', 'REVIEWER', 'ADMIN'],    // server-derived (Section 2)
  requiredEntitlement: null,                     // SAFETRADE_CREATE only on INITIATE
  requiredVerification: ['verification.buyerVerified'],
  paymentConditions: ['payment.milestonesReconcile', 'payment.sandboxOnly'],
  documentConditions: [],
  complianceConditions: [],
  shipmentConditions: [],
  disputeRestriction: 'BLOCKED_WHILE_DISPUTED',
  moneyMovement: 'HOLD',                          // null | 'HOLD' | 'RELEASE' | 'REFUND'
  liveGate: 'EXTERNAL_ACTIVATION_REQUIRED',       // throw key when live & unapproved (N1/N7)
  auditPolicy: 'CRITICAL',                        // 'CRITICAL' (appendCriticalAudit/atomic) | 'BEST_EFFORT'
  auditAction: 'SAFETRADE_PAYMENT_HELD',
  notificationEvent: 'DIASPORA_SAFETRADE_PAYMENT_HELD',
  idempotency: 'REPLAY_BY_KEY',                   // see Section 5
  rollback: 'RELEASE_SANDBOX_HOLD',               // see Section 6
  reviewerApprovalRequired: 'IF_HIGH_RISK',       // 'NEVER' | 'ALWAYS' | 'IF_HIGH_RISK'
})
```

`actorRoles`, `requiredVerification`, `paymentConditions`, etc. are **arrays of the condition keys from Section 2**, so the build wires one resolver function per key (the eligibility engine) and the dispatcher simply iterates the descriptor's condition arrays — no per-transition imperative code.

---

## 4. Full transition table

Legend — Money: `HOLD`/`RELEASE`/`REFUND`/`—`. Audit: `C`=CRITICAL (N6), `B`=best-effort. Idem: behavior key (Section 5). DisputeR: `BLK`=blocked while disputed/suspended, `RES`=resolution-only edge, `—`=none.

| # | Event | From → To | Actor roles | Entitlement | Verification | Payment cond. | Docs cond. | Compliance cond. | Shipment cond. | Money | DisputeR | Audit action | Notification event | Audit | Idem | Rollback / remediation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `INITIATE` | (none) → `DRAFT` | BUYER, ADMIN | **SAFETRADE_CREATE** (when enforced) | — | — | — | — | — | — | — | SAFETRADE_INITIATED | DIASPORA_SAFETRADE_INITIATED | B | `CREATE_BY_KEY` (idem key → return existing draft) | Soft-delete draft (`deleted_at`); release reserved quota |
| 2 | `RUN_ELIGIBILITY` | `DRAFT` → `ELIGIBILITY_PENDING` | BUYER, ADMIN, SYSTEM | — | — | — | — | `compliance.noOpenFlags` | — | — | BLK | SAFETRADE_ELIGIBILITY_STARTED | DIASPORA_SAFETRADE_ELIGIBILITY | B | `IDEMPOTENT_NOOP` | Return to `DRAFT` (no side effects) |
| 3 | `ELIGIBILITY_CLEARED` | `ELIGIBILITY_PENDING` → `AWAITING_BUYER_COMMITMENT` | SYSTEM, ADMIN | — | `verification.buyerVerified`, `verification.sellerVerified` | — | — | `compliance.noOpenFlags` | — | — | BLK | SAFETRADE_ELIGIBILITY_CLEARED | DIASPORA_SAFETRADE_ELIGIBLE | B | `IDEMPOTENT_NOOP` | Back to `ELIGIBILITY_PENDING`; eligibility result stored as explainable blockers |
| 4 | `BUYER_COMMIT` | `AWAITING_BUYER_COMMITMENT` → `AWAITING_SELLER_COMMITMENT` | BUYER | — | `verification.buyerVerified` | — | — | — | — | — | BLK | SAFETRADE_BUYER_COMMITTED | DIASPORA_SAFETRADE_BUYER_COMMITTED | C | `REPLAY_BY_KEY` | Revert to `AWAITING_BUYER_COMMITMENT`; clear commitment record |
| 5 | `SELLER_COMMIT` | `AWAITING_SELLER_COMMITMENT` → `PAYMENT_PENDING` | SELLER | — | `verification.sellerVerified` | `payment.milestonesReconcile` | — | — | — | — | BLK | SAFETRADE_SELLER_COMMITTED | DIASPORA_SAFETRADE_SELLER_COMMITTED | C | `REPLAY_BY_KEY` | Revert to `AWAITING_SELLER_COMMITMENT` |
| 6 | `REQUEST_PAYMENT` | `PAYMENT_PENDING` → `PAYMENT_PENDING` (self; emits payment intent) | BUYER, ADMIN | — | `verification.buyerVerified` | `payment.sandboxOnly`, `payment.milestonesReconcile` | — | — | — | **HOLD-intent** | BLK | SAFETRADE_PAYMENT_REQUESTED | DIASPORA_SAFETRADE_PAYMENT_REQUESTED | C | `REPLAY_BY_KEY` | Cancel sandbox intent; remains `PAYMENT_PENDING` |
| 7 | `HOLD_PAYMENT` | `PAYMENT_PENDING` → `PAYMENT_HELD` | BUYER, REVIEWER, ADMIN | — | `verification.buyerVerified` | `payment.milestonesReconcile`, `payment.sandboxOnly` | — | — | — | **HOLD** | BLK | SAFETRADE_PAYMENT_HELD | DIASPORA_SAFETRADE_PAYMENT_HELD | **C (atomic RPC)** | `REPLAY_BY_KEY` | `RELEASE_SANDBOX_HOLD`: reverse milestones to PENDING, back to `PAYMENT_PENDING` |
| 8 | `ATTACH_DOCUMENTS` | `PAYMENT_HELD` → `DOCUMENTS_PENDING` | BUYER, SELLER, ADMIN | — | — | `payment.allHeld` | — | — | — | — | BLK | SAFETRADE_DOCUMENTS_STAGE | DIASPORA_SAFETRADE_DOCUMENTS_PENDING | B | `IDEMPOTENT_NOOP` | Back to `PAYMENT_HELD` (funds remain held) |
| 9 | `SUBMIT_COMPLIANCE` | `DOCUMENTS_PENDING` → `COMPLIANCE_REVIEW` | BUYER, SELLER, ADMIN | — | — | `payment.allHeld` | `documents.requiredVerified` | `compliance.noOpenFlags` | — | — | BLK | SAFETRADE_COMPLIANCE_SUBMITTED | DIASPORA_SAFETRADE_COMPLIANCE_REVIEW | C | `REPLAY_BY_KEY` | Back to `DOCUMENTS_PENDING` |
| 10 | `COMPLIANCE_PASS` | `COMPLIANCE_REVIEW` → `SHIPMENT_IN_PROGRESS` | **REVIEWER, ADMIN only** (N2) | — | — | `payment.allHeld` | `documents.requiredVerified` | **`compliance.humanApproved`**, `compliance.noOpenFlags` | — | — | BLK | SAFETRADE_COMPLIANCE_PASSED | DIASPORA_SAFETRADE_COMPLIANCE_PASSED | **C** | `REPLAY_BY_KEY` | Back to `COMPLIANCE_REVIEW`; compliance row stays APPROVED (human record preserved) |
| 11 | `COMPLIANCE_FAIL` | `COMPLIANCE_REVIEW` → `DISPUTED` | REVIEWER, ADMIN | — | — | — | — | — | — | — | RES | SAFETRADE_COMPLIANCE_FAILED | DIASPORA_SAFETRADE_COMPLIANCE_FAILED | C | `REPLAY_BY_KEY` | Routes to dispute; funds stay held pending resolution |
| 12 | `BEGIN_SHIPMENT` | `SHIPMENT_IN_PROGRESS` (self; records logistics start) | REVIEWER, ADMIN | — | — | `payment.allHeld` | — | `compliance.humanApproved` | — | — | BLK | SAFETRADE_SHIPMENT_BEGAN | DIASPORA_SAFETRADE_SHIPMENT_STARTED | B | `IDEMPOTENT_NOOP` | No-op revert (observational) |
| 13 | `MARK_ARRIVED` | `SHIPMENT_IN_PROGRESS` → `DELIVERY_CONFIRMATION_PENDING` | REVIEWER, ADMIN, SYSTEM(read-through) | — | — | `payment.allHeld` | — | `compliance.humanApproved` | **`shipment.arrivedOrReleased`** (N3 — observed) | — | BLK | SAFETRADE_SHIPMENT_ARRIVED | DIASPORA_SAFETRADE_ARRIVED | C | `REPLAY_BY_KEY` | Back to `SHIPMENT_IN_PROGRESS` |
| 14 | `CONFIRM_DELIVERY` | `DELIVERY_CONFIRMATION_PENDING` → `DELIVERY_CONFIRMATION_PENDING` (self; sets `delivery.buyerConfirmed`) | **BUYER** (or REVIEWER/ADMIN override) (N3) | — | — | `payment.allHeld` | — | — | `shipment.arrivedOrReleased` | — | BLK | SAFETRADE_DELIVERY_CONFIRMED | DIASPORA_SAFETRADE_DELIVERY_CONFIRMED | **C** | `REPLAY_BY_KEY` | Clear confirmation flag; remains pending |
| 15 | `RELEASE_ESCROW` | `DELIVERY_CONFIRMATION_PENDING` → `COMPLETED` | **REVIEWER, ADMIN** (release authority); buyer confirmation is a *condition*, not the actor (N5) | — | — | `payment.allHeld`, `payment.sandboxOnly` | `documents.requiredVerified` | `compliance.humanApproved` | `shipment.arrivedOrReleased` | **RELEASE** | BLK | SAFETRADE_ESCROW_RELEASED | DIASPORA_SAFETRADE_COMPLETED + DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE (N4) | **C (atomic RPC)** | `REPLAY_BY_KEY` | Sandbox release is reversible only by reviewer compensating action → `DISPUTED`; never auto |
| 16 | `RAISE_DISPUTE` | {any active post-commit state} → `DISPUTED` | BUYER, SELLER, REVIEWER, ADMIN | — | — | — | — | — | — | — | RES | SAFETRADE_DISPUTE_RAISED | DIASPORA_SAFETRADE_DISPUTED | C | `REPLAY_BY_KEY` | Records `disputedFrom`; funds frozen (sandbox) |
| 17 | `SUSPEND` | {any active state} → `SUSPENDED` | **REVIEWER, ADMIN only** | — | — | — | — | — | — | — | RES | SAFETRADE_SUSPENDED | DIASPORA_SAFETRADE_SUSPENDED | C | `REPLAY_BY_KEY` | Records `suspendedFrom` |
| 18 | `RESUME` | `DISPUTED`/`SUSPENDED` → (recorded `disputedFrom`/`suspendedFrom`) | REVIEWER, ADMIN | — | — | — | — | `compliance.noOpenFlags` | — | — | RES | SAFETRADE_RESUMED | DIASPORA_SAFETRADE_RESUMED | C | `REPLAY_BY_KEY` | If source invalid, fall back to safe state (`ELIGIBILITY_PENDING` or `PAYMENT_HELD`) |
| 19 | `CANCEL` | {DRAFT … PAYMENT_PENDING, DISPUTED, SUSPENDED} → `CANCELLED` | BUYER (pre-hold only), REVIEWER, ADMIN | — | — | — | — | — | — | — | RES | SAFETRADE_CANCELLED | DIASPORA_SAFETRADE_CANCELLED | C | `REPLAY_BY_KEY` | Terminal; if funds were held → must route through `INITIATE_REFUND` first (cancel from held states is **forbidden**, see §4.1) |
| 20 | `INITIATE_REFUND` | {PAYMENT_HELD, DOCUMENTS_PENDING, COMPLIANCE_REVIEW, SHIPMENT_IN_PROGRESS, DELIVERY_CONFIRMATION_PENDING, DISPUTED, SUSPENDED} → `REFUND_PENDING` | REVIEWER, ADMIN (N5 release authority) | — | — | `payment.sandboxOnly` | — | — | — | **REFUND-intent** | RES | SAFETRADE_REFUND_INITIATED | DIASPORA_SAFETRADE_REFUND_PENDING | **C** | `REPLAY_BY_KEY` | Back to `disputedFrom`/source if refund aborted by reviewer |
| 21 | `COMPLETE_REFUND` | `REFUND_PENDING` → `REFUNDED` | REVIEWER, ADMIN | — | — | `payment.sandboxOnly` | — | — | — | **REFUND** | RES | SAFETRADE_REFUNDED | DIASPORA_SAFETRADE_REFUNDED | **C (atomic RPC)** | `REPLAY_BY_KEY` | Terminal; reversal only by reviewer compensating entry → `DISPUTED` |

### 4.1 Key structural rules baked into the table

- **No edge writes money outside sandbox.** Every `moneyMovement ∈ {HOLD, RELEASE, REFUND}` carries `liveGate:'EXTERNAL_ACTIVATION_REQUIRED'`: when `DIASPORA_SAFETRADE_LIVE_PAYMENT` is on **and** no approved provider is wired, the dispatcher throws `EXTERNAL_ACTIVATION_REQUIRED` (fail-closed, mirrors `assertBillingProductionSafety`). Default (live OFF) ⇒ sandbox provider ⇒ proceeds.
- **`CANCEL` is forbidden from escrow-held states.** Once funds are held you must go `INITIATE_REFUND → COMPLETE_REFUND` (then optionally `CANCELLED` is *not* used; `REFUNDED` is the terminal). This prevents "cancel" silently stranding held (sandbox) funds. Encoded by `from` excluding the `SAFETRADE_ESCROW_HELD_STATES`.
- **`COMPLIANCE_PASS`, `CONFIRM_DELIVERY`, `RELEASE_ESCROW`, `INITIATE_REFUND`, `COMPLETE_REFUND` are reviewer/admin-gated** (N2/N3/N5). Buyer "confirm delivery" sets a *condition flag* on a self-transition (#14); the actual escrow release (#15) is a separate reviewer/admin authority transition that *reads* `delivery.buyerConfirmed`. This cleanly separates "buyer says delivered" from "platform releases money" — the directive's hard line.
- **`RELEASE_ESCROW` honors `reviewerApprovalRequired:'IF_HIGH_RISK'`.** The release policy engine computes a risk tier (`SAFETRADE_RISK_TIERS`); `HIGH` requires a separate reviewer-approval record (`release.reviewerApprovedIfHighRisk`) even though all auto-conditions pass (N5). `STANDARD`/`LOW` still require a reviewer/admin actor but no second approval record.
- **Escape hatches are reachable from "any active state"** — the build expands `RAISE_DISPUTE`/`SUSPEND` `from` to all non-terminal, non-hatch states programmatically; resolution (`RESUME`, `INITIATE_REFUND`, `CANCEL`, `COMPLIANCE_FAIL`) are the only edges out, enforced by `disputeRestriction`.

---

## 5. Idempotency behavior (per descriptor `idempotency`)

Every state-changing dispatch takes an `idempotencyKey` (from `requestCorrelationId(req)` or client-supplied). The dispatcher persists it on the SafeTrade transaction-event row and on any payment-milestone mutation. Behaviors:

- **`CREATE_BY_KEY`** (`INITIATE`): a replay with the same key returns the existing draft, never creates a second SafeTrade transaction.
- **`REPLAY_BY_KEY`** (all critical money/state edges): a prior event with the same key and the **same source→target** is a replay → return the prior result; a **conflicting payload** (different target/amount) throws `SAFETRADE/IDEMPOTENCY_CONFLICT` — exactly the pattern in the H1 RPC (step 4: same key + changed action ⇒ `IDEMPOTENCY_CONFLICT`; else return `idempotentReplay:true`).
- **`IDEMPOTENT_NOOP`** (observational/self transitions): re-dispatch in the same state is a no-op success.

Money transitions (`HOLD_PAYMENT`, `RELEASE_ESCROW`, `INITIATE_REFUND`, `COMPLETE_REFUND`) implement idempotency **inside the atomic RPC** (the only safe place), so a retried release cannot double-release sandbox funds and cannot write a duplicate audit row.

---

## 6. Rollback / remediation policy (per descriptor `rollback`)

| Rollback key | Semantics |
|---|---|
| `RELEASE_SANDBOX_HOLD` | Reverse sandbox milestone confirmations back to `PENDING` and return to `PAYMENT_PENDING`. Atomic with audit (`SAFETRADE_PAYMENT_HOLD_REVERSED`). |
| `COMPENSATING_ONLY` (release/refund) | A completed sandbox release/refund is **never silently undone**; remediation is a reviewer-driven compensating transition that lands in `DISPUTED`, preserving the original audit chain. |
| `SOFT_DELETE` | DRAFT cancel sets `deleted_at`, releases reserved entitlement quota via the guard's `release()`. |
| `RESTORE_SOURCE` | `RESUME` restores `disputedFrom`/`suspendedFrom`; if the recorded source is no longer legal, fall back to the nearest safe state (`ELIGIBILITY_PENDING` pre-money, `PAYMENT_HELD` post-money). |
| `NOOP_REVERT` | Observational self-transitions revert by clearing the flag they set (e.g. `CONFIRM_DELIVERY` clears `delivery.buyerConfirmed`). |

**Atomicity (N6):** any transition with `auditPolicy:'CRITICAL'` must either (a) write its audit via `appendCriticalAudit` and roll back the state update on audit failure, or (b) preferably execute as an **atomic RPC** that updates the SafeTrade row + payment milestones + writes the sealed audit row in one transaction (pattern proven by `diaspora_append_stock_movement_atomic`, step 8). Money edges (#7, #15, #20, #21) **must** use (b).

---

## 7. Audit + notification catalog (build wires these)

- **Audit actions:** all prefixed `SAFETRADE_*` (column `resource_type='diaspora_safetrade_transaction'`), sealed via `buildAuditSeal` (`diasporaServiceUtils.js`). Critical edges fail loud; descriptive edges best-effort.
- **Notification events:** all prefixed `DIASPORA_SAFETRADE_*`, emitted via `emitDiasporaEvent` / `queueDiasporaNotification`. The completion edge additionally emits `DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE` — an **event only**, consumed by no auto-writer (N4); reputation creation remains a separate human/reviewer action.

---

## 8. Build directives (what the implementer does with this module)

1. Create `backend/constants/diaspora/diasporaSafeTradeStatuses.js` exactly per Sections 1, 3 — pure frozen data + pure helpers, **no DB/network imports** (testable like `diasporaStatuses.js`).
2. The SafeTrade service consumes `SAFETRADE_TRANSITION_TABLE`: for each dispatch it (a) `assertDispatchAllowed(current, event)`, (b) `requireFeature` if `requiredEntitlement` set and enforcement on, (c) evaluate every condition-key array via the eligibility resolver (explainable blockers), (d) check `disputeRestriction`, (e) for money edges call the sandbox provider + `liveGate`, (f) execute the atomic RPC (or `appendCriticalAudit`) per `auditPolicy`, (g) emit the notification, (h) apply `idempotency`/`rollback`.
3. Add `DIASPORA_SAFETRADE_ENABLED` (default OFF) and `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF, fail-closed) helpers — co-located in a SafeTrade constants/flags module mirroring `diasporaBillingConstants.js`. Do **not** edit `diasporaBillingConstants.js` (track-owned). When `DIASPORA_SAFETRADE_ENABLED` is OFF, all SafeTrade routes/services are inert.
4. Create a **new, unmounted** route file (e.g. `backend/routes/diasporaSafeTradeRoutes.js`); the integrator mounts it. Do not touch `diasporaRoutes.js`/`server.js`.
5. Migrations (authored, **not applied**): SafeTrade transaction table + atomic RPCs (`diaspora_safetrade_hold_payment_atomic`, `_release_escrow_atomic`, `_refund_atomic`) following `20260611061849` (RLS helper `diaspora_trade_os_can_access_row`, REVOKE PUBLIC + GRANT authenticated/service_role, SECURITY DEFINER + `SET search_path='public'`) and `20260621090000` (atomic + idempotency replay + CRITICAL audit inside txn + `-- +migrate Up/Down`).

---

## 9. Reference files (all absolute)

- Target module: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaSafeTradeStatuses.js` (to be created)
- State-machine pattern to mirror: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaStatuses.js`, `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaWorkflowService.js`
- Audit/idempotency: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaServiceUtils.js` (`appendCriticalAudit`/`appendBestEffortAudit`), `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql` (atomic + replay + in-txn audit)
- Authz: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaAuthorization.js`
- Entitlement gate: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaEntitlementGuard.js`, `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaEntitlements.js` (`SAFETRADE_CREATE`)
- Flag pattern to mirror (do not edit): `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaBillingConstants.js`
- Existing domain to connect to: `diaspora_payment_milestones` schema (`/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/013_diaspora_trade_schema.sql` lines 338–357; status enum PENDING/CONFIRMED/FAILED/WAIVED/CANCELLED), `diaspora_compliance_reviews` (lines 319–336; PENDING_REVIEW/APPROVED/FLAGGED/REJECTED), document gate logic in `diasporaWorkflowService.js` (`assertZimbabweReadyPrerequisites`)
- RLS/migration foundation: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260611061849_diaspora_trade_os_phase1b_foundation.sql`
- Gap map: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md` §5

This spec is complete and buildable: states (§1), module exports + descriptor shape (§3), the full transition table with all required attributes per transition (§4), idempotency (§5), rollback/remediation (§6), audit/notification catalog (§7), and build wiring (§8) — all consistent with the cited real conventions and enforcing every directive non-negotiable (N1–N7).

---

## B. Schema / migration design

I have everything I need. The conventions are fully captured. Producing the design now.

---

# SafeTrade Schema / Migration Plan (Phase 9) — Design

Read-only design. No files written, no migration applied, no network/provider called. All names, types, RLS predicates, grant blocks, `search_path`, idempotency/audit-in-txn, and `-- +migrate Up/Down` markers mirror the cited conventions verbatim so the build can transcribe directly.

## 0. Anchoring decisions (read this first)

1. **Use a SEPARATE `diaspora_safetrade_milestones` table; do NOT extend `diaspora_payment_milestones`.** Rationale: the existing `diaspora_payment_milestones` (013_diaspora_trade_schema.sql:338) is keyed only to `import_order_id`, has no `transaction_id`, no `payer/payee`, no `due_trigger`/`release_trigger`, no `idempotency_key`, no `provider_reference`, no evidence model, and its `status` CHECK is `('PENDING','CONFIRMED','FAILED','WAIVED','CANCELLED')` — a money-confirmation ledger, not a reviewed escrow state machine. Extending it would (a) overload one table with two incompatible state machines, (b) force `ALTER ... ADD CONSTRAINT` churn on a table other tracks may read, and (c) blur the audit story. A separate table keeps SafeTrade additive and lets the existing table remain the optional "raw payment-confirmation" record that a SafeTrade milestone can *reference* via `legacy_payment_milestone_id` (nullable FK, SET NULL). Note recorded in the migration header comment.

2. **Reuse `diaspora_import_audit_log` for SafeTrade audit; do NOT create a dedicated event table.** Rationale: every cited critical RPC (H1/H2/H3) writes its CRITICAL audit row into `diaspora_import_audit_log` *inside the transaction* with a SHA256 `cryptographic_seal`, and `appendCriticalAudit`/`appendBestEffortAudit` (diasporaServiceUtils.js) target the same table. SafeTrade transactions all hang off an `import_order_id`, so the existing `import_order_id`/`tenant_id`/`actor_id`/`resource_type`/`resource_id`/`previous_state`/`new_state`/`metadata`/`cryptographic_seal` columns fit without change. We distinguish SafeTrade rows by `resource_type IN ('diaspora_safetrade_transaction','diaspora_safetrade_milestone','diaspora_safetrade_release')` and `action` prefix `SAFETRADE_*`. Phase 10's projection (`domain_events`) remains the *separate* structured-event path; audit stays single-sourced. This avoids a second audit system, exactly as the cross-cutting conventions (doc §7) and Phase 10 note (doc §6, line 214) require.

3. **Release evaluation is BOTH a recorded table AND driven by a service, not a release-executing RPC.** `diaspora_safetrade_release_evaluations` is an append-only evaluation *record*. The eligibility computation lives in a **service** (`diasporaSafeTradeReleaseService.js`, build task — not this design) because it must read across compliance/document/shipment/payment services and produce explainable blockers; SQL is the wrong place for cross-service policy. Crucially, **evaluation NEVER releases money**. The only state-changing RPC for release is `diaspora_safetrade_transition_atomic` driving a milestone/transaction to a `*_RELEASE_AUTHORIZED` state, and it hard-requires `p_actor_is_privileged` (reviewer/admin) plus a passing prior evaluation reference — directive §5.2: high-risk release requires reviewer/admin approval even when automated conditions pass.

4. **Money is fail-closed twice.** `diaspora_safetrade_transition_atomic` accepts a `p_live_payment boolean` and a `p_payment_provider text`; if a transition is money-moving (`FUNDS_CAPTURE`, `FUNDS_RELEASE`, `REFUND`) and `p_live_payment = true` OR `p_payment_provider <> 'sandbox'`, it raises `DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED`. The service layer additionally gates on `DIASPORA_SAFETRADE_ENABLED` (default OFF) and `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF). The RPC fail-closed is defense-in-depth so even a mis-set env cannot move real money through the DB.

---

## 1. Migration file

- Path (build target, do **not** apply): `database/migrations/20260621130000_diaspora_phase9_safetrade.sql` (timestamp after phase8 `...120000...`; build picks a fresh `YYYYMMDDHHMMSS` greater than the latest).
- Top marker `-- +migrate Up`, bottom `-- +migrate Down`. Header comment notes: additive; separate-milestones decision; audit-reuse decision; "NOT applied to production by this program."
- Reuses existing helpers — no new trigger/RLS function needed: `set_diaspora_trade_os_updated_at()`, `diaspora_trade_os_can_access_row(uuid,text,text)`, `diaspora_trade_os_is_platform_admin()`, `diaspora_trade_os_current_user_id()`, `diaspora_trade_os_is_tenant_member(text,uuid)` (all from phase1b foundation). `pgcrypto` already created by phase1b (needed for `digest(...,'sha256')`).

---

## 2. Table: `diaspora_safetrade_transactions`

Canonical escrow/assurance transaction. One per accepted import order (optionally more via metadata, but unique active per (order, accepted quote)).

```
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
  accepted_quote_id uuid REFERENCES public.diaspora_import_quotes(id) ON DELETE SET NULL,
  buyer_id text,                       -- mirrors users.id text PK convention (no FK: keep additive/decoupled, like phase8)
  seller_id text,
  currency text NOT NULL DEFAULT 'USD',
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT',               -- created, not yet funded plan agreed
      'INITIATED',           -- milestones defined, totals reconciled
      'FUNDS_PENDING',       -- awaiting (sandbox) capture
      'FUNDS_HELD',          -- (sandbox) escrow held
      'IN_PROGRESS',         -- shipment/compliance underway
      'RELEASE_REVIEW',      -- evaluation eligible, awaiting reviewer
      'RELEASE_AUTHORIZED',  -- reviewer/admin approved release (sandbox)
      'SETTLED',             -- all milestones terminal
      'DISPUTED',
      'REFUND_REVIEW',
      'REFUNDED',
      'CANCELLED'
    )),
  payment_provider text NOT NULL DEFAULT 'sandbox',   -- 'sandbox' only until EB-4 activation
  live_payment boolean NOT NULL DEFAULT false,        -- fail-closed flag; true path is blocked downstream
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  reviewer_id text,                    -- last reviewer who authorized release/refund (set by privileged transition)
  reviewed_at timestamptz,
  initiated_at timestamptz,
  settled_at timestamptz,
  idempotency_key text,                -- creation idempotency
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_safetrade_txn_provider_chk
    CHECK (payment_provider IN ('sandbox','fake')),  -- live providers added only at EB-4
  CONSTRAINT diaspora_safetrade_txn_live_closed_chk
    CHECK (live_payment = false)                     -- DB-level fail-closed: live is forbidden until this CHECK is dropped by an activation migration
);

-- one active SafeTrade transaction per (order, accepted quote)
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_txn_order_quote
  ON public.diaspora_safetrade_transactions (import_order_id, accepted_quote_id)
  WHERE deleted_at IS NULL;

-- creation idempotency (mirrors phase8 reservation idempotency pattern)
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_txn_idem
  ON public.diaspora_safetrade_transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
```

Design notes:
- `total_amount numeric(14,2)` — wider than the `numeric(12,2)` used for orders/quotes/milestones to absorb fee/insurance line items in larger transactions while keeping 2-dp currency precision; reconciliation (§6) is in the same scale.
- `live_payment` carries a CHECK forcing it `false`. The activation migration (EB-4, owned by integrator/legal sign-off) is the *only* thing that drops `diaspora_safetrade_txn_live_closed_chk` and widens `diaspora_safetrade_txn_provider_chk`. This makes "real money disabled" a schema invariant, not just app logic.
- `buyer_id`/`seller_id`/`reviewer_id` are `text` with no FK, matching how phase8 decoupled `created_by/updated_by` (no `REFERENCES users`) to stay additive and avoid cross-table coupling; the older 013 schema used `REFERENCES users(id)` but the newer phase1b/phase8 convention drops the FK. We follow the **newer** convention.

---

## 3. Table: `diaspora_safetrade_milestones`

Separate from `diaspora_payment_milestones` (decision §0.1). Reviewed escrow milestone with payer/payee, triggers, evidence requirements, provider reference, idempotency.

```
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,  -- denormalized for audit/index
  legacy_payment_milestone_id uuid REFERENCES public.diaspora_payment_milestones(id) ON DELETE SET NULL, -- optional bridge to old table
  milestone_type text NOT NULL
    CHECK (milestone_type IN ('DEPOSIT','PROGRESS','SHIPMENT','CUSTOMS_DUTY','DELIVERY','RELEASE','INSURANCE','FEE','REFUND')),
  sequence integer NOT NULL CHECK (sequence >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payer text,                          -- party expected to fund: 'BUYER' | user id | role token
  payee text,                          -- party to receive on release: 'SELLER' | 'PLATFORM' | user id
  due_trigger text NOT NULL DEFAULT 'MANUAL'
    CHECK (due_trigger IN ('MANUAL','ON_INITIATION','ON_SHIPMENT_BOOKED','ON_LOADED','ON_ARRIVAL','ON_CUSTOMS_CLEARED','ON_DELIVERY_CONFIRMED')),
  release_trigger text NOT NULL DEFAULT 'REVIEWER_APPROVAL'
    CHECK (release_trigger IN ('REVIEWER_APPROVAL','ON_DELIVERY_CONFIRMED_REVIEWED','ON_DOCUMENTS_VERIFIED_REVIEWED','MANUAL_REVIEWER')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING','DUE','FUNDS_PENDING','FUNDED','HELD',
      'RELEASE_REVIEW','RELEASE_AUTHORIZED','RELEASED',
      'WAIVED','REFUND_REVIEW','REFUNDED','CANCELLED','FAILED'
    )),
  evidence_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{type:'DOCUMENT_VERIFIED', ref:'BILL_OF_LADING'}, ...]
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,          -- satisfied evidence pointers (document ids, shipment events)
  provider_reference text,             -- sandbox provider intent/charge id; NULL until (sandbox) capture
  provider_status text,                -- sandbox provider status mirror
  idempotency_key text,                -- per-milestone money-op idempotency
  released_by text,                    -- privileged actor who authorized release
  released_at timestamptz,
  due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT uq_diaspora_safetrade_milestone_seq
    UNIQUE (transaction_id, sequence),
  CONSTRAINT uq_diaspora_safetrade_milestone_type
    UNIQUE (transaction_id, milestone_type, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_milestone_idem
  ON public.diaspora_safetrade_milestones (transaction_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_milestones_txn_status
  ON public.diaspora_safetrade_milestones (transaction_id, status, sequence);
```

Design notes:
- Milestone `currency` must equal the transaction currency — enforced in the RPC (§5.2), not by a CHECK (cross-row), to keep reconciliation single-currency (§6).
- `evidence_requirements` vs `evidence_refs`: requirements are authored at definition time; refs are appended as gates are satisfied (document verified, shipment stage event). The release service compares them; missing requirements become explicit `blockers` in the evaluation record.
- `legacy_payment_milestone_id` is the *only* coupling to the old table and is nullable/SET NULL — pure bridge, no behavioral dependency.

---

## 4. Table: `diaspora_safetrade_release_evaluations`

Append-only, explainable release-readiness record. Never mutates money or state.

```
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_release_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.diaspora_safetrade_milestones(id) ON DELETE CASCADE,  -- NULL = whole-transaction eval
  eligible boolean NOT NULL DEFAULT false,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{code:'COMPLIANCE_NOT_APPROVED', message, ref}, ...]
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,   -- evidence the engine considered (document ids, shipment event ids)
  requires_reviewer boolean NOT NULL DEFAULT true,    -- high-risk always true (directive 5.2)
  risk_level text NOT NULL DEFAULT 'HIGH'
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  evaluated_by text,                                  -- actor or 'system' (engine run)
  evaluated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_evals_txn_milestone
  ON public.diaspora_safetrade_release_evaluations (transaction_id, milestone_id, evaluated_at DESC);
```

Design notes:
- No `UPDATE` semantics: each evaluation run inserts a new row, so the evaluation history is auditable and the latest (`ORDER BY evaluated_at DESC`) wins. `requires_reviewer` defaults `true`; the transition RPC requires the *latest* eval for the milestone/txn to be `eligible = true` AND a privileged actor — automated eligibility never auto-releases.
- `blockers` is the explainability surface required by doc §5 ("explainable blockers").

---

## 5. Atomic RPCs

### 5.1 `diaspora_safetrade_transition_atomic` — locks, validates source→target + guards, CRITICAL audit in-txn, idempotent, money fail-closed

Mirrors H1/H2/H3 exactly: `SECURITY INVOKER`, `SET search_path = public, pg_temp`, `SELECT ... FOR UPDATE`, idempotency replay, CRITICAL audit insert into `diaspora_import_audit_log` with SHA256 seal inside the txn, `REVOKE … FROM PUBLIC` + conditional `GRANT EXECUTE … TO service_role`, `-- +migrate Down DROP FUNCTION`.

Signature (exact types — needed verbatim in REVOKE/GRANT/DROP):

```
public.diaspora_safetrade_transition_atomic(
  p_transaction_id uuid,
  p_milestone_id   uuid,        -- NULL = transaction-level transition
  p_actor_id       text,
  p_tenant_id      uuid,
  p_actor_is_privileged boolean,
  p_target_status  text,
  p_evaluation_id  uuid    DEFAULT NULL,   -- required for *RELEASE*/*REFUND* targets
  p_payment_provider text  DEFAULT 'sandbox',
  p_live_payment   boolean DEFAULT false,
  p_idempotency_key text   DEFAULT NULL,
  p_reason         text    DEFAULT NULL,
  p_metadata       jsonb   DEFAULT '{}'::jsonb,
  p_correlation_id text    DEFAULT NULL,
  p_source         text    DEFAULT 'ui'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
```

In-function logic (ordered, all in one txn):
1. `p_actor_id IS NULL` → `RAISE EXCEPTION 'DIASPORA_SAFETRADE/UNAUTHENTICATED'`.
2. Lock the transaction: `SELECT * INTO v_txn FROM diaspora_safetrade_transactions WHERE id = p_transaction_id AND deleted_at IS NULL FOR UPDATE`; not found → `.../NOT_FOUND_TXN`. If `p_milestone_id` given, lock the milestone `FOR UPDATE` and assert `transaction_id = p_transaction_id` → else `.../MILESTONE_NOT_IN_TXN`.
3. **Authority** against the locked rows (defense-in-depth with service authz): allowed iff `p_actor_is_privileged OR v_txn.buyer_id = p_actor_id OR v_txn.created_by = p_actor_id OR (p_tenant_id IS NOT NULL AND v_txn.tenant_id IS NOT DISTINCT FROM p_tenant_id)` → else `.../FORBIDDEN`.
4. **Idempotency replay** (when `p_idempotency_key` set): a prior transition with the same key on this txn/milestone (stored in metadata `{safetrade,lastTransitionKey}` or a sibling transitions log) returns `idempotentReplay:true` with current state; conflicting target → `.../IDEMPOTENCY_CONFLICT`.
5. **Transition validity**: `v_source := COALESCE(v_milestone.status, v_txn.status)`. Validate `(v_source -> p_target_status)` against an allowlist `CASE` (the explicit DAG — same style as `IMPORT_ORDER_TRANSITIONS` in `diasporaWorkflowService.js`/`diasporaStatuses.js`, but enforced in SQL). Illegal edge → `.../INVALID_TRANSITION: % -> %`.
6. **Money / high-risk guards** (NON-NEGOTIABLE, directive §5.2):
   - If `p_target_status` ∈ money-moving set (`FUNDS_PENDING`→capture intent, `FUNDED`/`HELD`, `RELEASE_AUTHORIZED`, `RELEASED`, `REFUNDED`): require `p_payment_provider IN ('sandbox','fake')` AND `p_live_payment = false` → else `RAISE EXCEPTION 'DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED'` (live path always throws).
   - If `p_target_status` ∈ release/refund authorize set (`RELEASE_AUTHORIZED`, `REFUND_REVIEW`→`REFUNDED`): require `p_actor_is_privileged = true` → else `.../REVIEWER_REQUIRED`; AND require `p_evaluation_id` referencing a `diaspora_safetrade_release_evaluations` row for this txn/milestone with `eligible = true` and matching `policy_version` → else `.../EVALUATION_REQUIRED` / `.../NOT_ELIGIBLE`. Automated eligibility alone is never sufficient.
   - Compliance/shipment/delivery completion targets are **not** reachable by this RPC at all (those statuses live in the order/compliance/shipment tables owned by their services) — SafeTrade only references their verified outcomes via evidence; it never sets them. This satisfies "no auto compliance approval / no auto shipment-or-delivery completion / no auto reputation."
7. **Apply** the update on the locked row (`UPDATE ... SET status = p_target_status, updated_by = p_actor_id, updated_at = now()`, and on release set `released_by/released_at` or `reviewer_id/reviewed_at`).
8. **CRITICAL audit in the same transaction** (must fail the whole txn if it cannot be written): compute `v_seal := encode(digest(COALESCE(p_actor_id,'system') || '|SAFETRADE_' || p_target_status || '|' || COALESCE('diaspora_safetrade_milestone','diaspora_safetrade_transaction') || '|' || COALESCE(p_milestone_id,p_transaction_id)::text || '|' || v_ts::text, 'sha256'),'hex')` and `INSERT INTO public.diaspora_import_audit_log (import_order_id, tenant_id, actor_id, action, resource_type, resource_id, previous_state, new_state, metadata, cryptographic_seal) VALUES (v_txn.import_order_id, v_txn.tenant_id, p_actor_id, 'SAFETRADE_' || p_target_status, <resource_type>, <resource_id>, jsonb_build_object('status', v_source), jsonb_build_object('status', p_target_status), jsonb_build_object('evaluationId', p_evaluation_id, 'provider', p_payment_provider, 'livePayment', p_live_payment, 'reason', p_reason, 'correlationId', p_correlation_id, 'source', p_source), v_seal)`. (No best-effort fallback — this is the in-txn CRITICAL audit pattern from H1.)
9. Return `jsonb_build_object('transaction', to_jsonb(v_txn), 'milestone', to_jsonb(v_milestone), 'idempotentReplay', false)`.

Grants (verbatim pattern from H1/H2): `REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text) FROM PUBLIC;` then `DO $grant$ ... IF EXISTS (... 'service_role') THEN GRANT EXECUTE ... TO service_role; END IF; END; $grant$;`. `-- +migrate Down`: `DROP FUNCTION IF EXISTS public.diaspora_safetrade_transition_atomic(uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text);`.

### 5.2 `diaspora_safetrade_record_milestone_atomic` — define/seed milestones with total reconciliation, idempotent, in-txn audit

Purpose: insert (or idempotently replay) the milestone set for a transaction in one txn, enforcing that **Σ milestone amounts reconcile to `total_amount` within currency precision** and that all milestone currencies equal the transaction currency.

Signature:

```
public.diaspora_safetrade_record_milestone_atomic(
  p_transaction_id uuid,
  p_actor_id       text,
  p_tenant_id      uuid,
  p_actor_is_privileged boolean,
  p_milestones     jsonb,        -- [{milestoneType, sequence, amount, currency, payer, payee, dueTrigger, releaseTrigger, evidenceRequirements, idempotencyKey}, ...]
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  p_source         text DEFAULT 'ui'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
```

Logic:
1. Auth/lock the transaction `FOR UPDATE` (same authority predicate as §5.1); must be in `DRAFT` or `INITIATED` → else `.../MILESTONES_LOCKED`.
2. Idempotency replay on `p_idempotency_key` (return existing milestones + `idempotentReplay:true`; conflicting payload → `.../IDEMPOTENCY_CONFLICT`).
3. Validate each element: `amount >= 0`, `currency = v_txn.currency` (else `.../CURRENCY_MISMATCH`), `milestone_type`/`due_trigger`/`release_trigger` ∈ allowlists (else CHECK at insert), unique `sequence`.
4. **Reconciliation** (§6): `v_sum := SUM(amount)` over the payload (excluding `REFUND`/`WAIVED`-typed informational lines as defined by policy). Require `ABS(v_sum - v_txn.total_amount) <= 0.005` (half a cent at `numeric(_,2)` — see §6) → else `RAISE EXCEPTION 'DIASPORA_SAFETRADE/TOTALS_UNRECONCILED: sum % total %', v_sum, v_txn.total_amount`. Reconcile in the transaction's single currency only (mixed-currency milestone sets are rejected at step 3).
5. Insert milestones; if transaction was `DRAFT`, advance to `INITIATED` and stamp `initiated_at`.
6. CRITICAL audit row in-txn (`action = 'SAFETRADE_MILESTONES_DEFINED'`, `resource_type = 'diaspora_safetrade_transaction'`, seal as §5.1), failing the whole txn if unwritable.
7. Return milestones + reconciliation summary `{ total, sum, reconciled:true }`.

Grants/Down identical pattern with this signature's exact type list.

### 5.3 Release evaluation: **service, not RPC** (with a thin recorder)

Decision (§0.3): the *computation* is `diasporaSafeTradeReleaseService.js` (build task) because it must consult `diaspora_compliance_reviews` (status `APPROVED`), `diaspora_trade_documents` (`verification_status = 'VERIFIED'`), `diaspora_shipment_stage_events`/`diaspora_shipments`, and milestone funding state, then assemble explainable `blockers`. Writing the resulting evaluation row is a plain insert via the service (it's append-only, not a concurrency-critical lock), audited with `appendCriticalAudit` (action `SAFETRADE_RELEASE_EVALUATED`) because it gates money authorization. We deliberately do **not** make evaluation an RPC: an RPC cannot cleanly read cross-service policy, and keeping it out of SQL prevents anyone wiring "evaluate → auto-release" inside one transaction. The only RPC that consumes the evaluation is `diaspora_safetrade_transition_atomic` (§5.1, step 6), which re-reads the evaluation row inside its own lock and re-checks `eligible = true` — so the authoritative gate is still transactional even though scoring is in the service.

---

## 6. Total reconciliation within currency precision

- All money columns are `numeric(_,2)` (2-dp), single currency per transaction (milestone currency forced equal to txn currency in §5.2 step 3). Therefore reconciliation is a same-scale sum with no cross-currency conversion.
- Tolerance: `ABS(SUM(milestone.amount) - txn.total_amount) <= 0.005`. At `numeric(_,2)` exact storage this is effectively zero tolerance (half the smallest representable unit), so it accepts only genuinely balanced sets while being robust to any accidental 3rd-dp noise in the inbound JSONB before casting. Build casts payload amounts via `::numeric(14,2)` before summing so the comparison happens in storage scale.
- Reconciliation runs (a) at definition time in `diaspora_safetrade_record_milestone_atomic` (rejects unbalanced sets), and (b) optionally re-asserted in the release service before producing an `eligible` evaluation (a drifted total becomes a blocker `TOTALS_UNRECONCILED`, never an auto-release).

---

## 7. RLS, grants, triggers (all three new tables)

Per table, mirroring phase8/phase1b exactly:

- `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;`
- `updated_at` trigger: `DROP TRIGGER IF EXISTS set_<t>_updated_at ON public.<t>; CREATE TRIGGER set_<t>_updated_at BEFORE UPDATE ON public.<t> FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();`
- Policy (FOR ALL, TO authenticated) using the shared predicate:
  `CREATE POLICY <t>_tenant_access ON public.<t> FOR ALL TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by)) WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));`
  - For `diaspora_safetrade_release_evaluations`, additionally allow read where the actor is a tenant member even if not the creator (engine may run as `system`): keep the same `can_access_row` predicate (platform admin OR creator OR updater OR tenant member) — already covers it; no special-case needed.
- Table grants block (verbatim phase8 pattern):
  `REVOKE ALL ON TABLE public.<t> FROM PUBLIC;` for all three, then
  ```
  DO $grants$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT SELECT, INSERT, UPDATE ON TABLE public.diaspora_safetrade_transactions TO authenticated;
      GRANT SELECT, INSERT, UPDATE ON TABLE public.diaspora_safetrade_milestones TO authenticated;
      GRANT SELECT, INSERT ON TABLE public.diaspora_safetrade_release_evaluations TO authenticated; -- append-only
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT ALL ON TABLE public.diaspora_safetrade_transactions TO service_role;
      GRANT ALL ON TABLE public.diaspora_safetrade_milestones TO service_role;
      GRANT ALL ON TABLE public.diaspora_safetrade_release_evaluations TO service_role;
    END IF;
  END;
  $grants$;
  ```
  Note: `authenticated` gets no `DELETE` (soft-delete via `deleted_at` only); evaluations get no `UPDATE` (append-only). RLS still constrains every authenticated row.

---

## 8. `-- +migrate Down`

Reverse order, additive-safe. The new SafeTrade tables are *not* foundation history (unlike phase1b which omits Down), so provide a real Down for build/CI Up/Down sanity:

```
-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_safetrade_record_milestone_atomic(uuid, text, uuid, boolean, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.diaspora_safetrade_transition_atomic(uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text);
DROP TABLE IF EXISTS public.diaspora_safetrade_release_evaluations;
DROP TABLE IF EXISTS public.diaspora_safetrade_milestones;
DROP TABLE IF EXISTS public.diaspora_safetrade_transactions;
```
(Indexes/policies/triggers drop with their tables; functions dropped first because nothing references them.)

---

## 9. Service / route wiring (boundaries the build must respect — not built here)

- New service files (build): `diasporaSafeTradeService.js` (create txn → checks `requireFeature(supabase, { tenantId, userId, featureKey: 'diaspora.safetrade.create' })` from `diasporaEntitlementGuard.js` when `DIASPORA_SAFETRADE_ENABLED` is on), `diasporaSafeTradeMilestoneService.js` (calls `diaspora_safetrade_record_milestone_atomic`), `diasporaSafeTradeReleaseService.js` (evaluation engine + recorder), and a sandbox-only `diasporaSafeTradePaymentProvider.js` whose live branch throws `EXTERNAL_ACTIVATION_REQUIRED`.
- Env flags (fail-closed): `DIASPORA_SAFETRADE_ENABLED` (default OFF — feature gate), `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF — service refuses any non-sandbox provider; RPC also blocks at §5.1 step 6). Follow the `diasporaDriveConstants.js` env-driven, fail-closed-in-prod pattern (doc §7).
- New route file `backend/routes/diasporaSafeTradeRoutes.js` is created by the build but **NOT mounted** (integrator mounts in `diasporaRoutes.js`/`server.js`). Do not edit integration-owned files, `web/src/*`, `package.json`, workflows, docs, or any `*Entitlement*/*Subscription*/*billing*/*Workbook*` files.
- ESM import/export throughout; service tests use injected `options.supabaseClient` per `resolveClient` (diasporaServiceUtils.js).

## 10. Non-negotiable compliance map (directive §5.2 / 37-51)

| Rule | Where enforced |
|---|---|
| Never move real money / release real escrow | RPC §5.1 step 6 throws `EXTERNAL_ACTIVATION_REQUIRED` for any money target with `live_payment=true` or non-sandbox provider; table CHECK `live_payment=false`; provider live branch throws; env `DIASPORA_SAFETRADE_LIVE_PAYMENT` default OFF |
| No auto compliance approval | SafeTrade cannot write `diaspora_compliance_reviews`; only reads `status='APPROVED'` as evidence |
| No auto shipment/delivery completion | SafeTrade cannot set order/shipment statuses; reads `diaspora_shipment_stage_events` as evidence only |
| No auto reputation | No write path to `diaspora_reputation_records`; delivery-confirmed surfaces only an eligibility *event*, never a reputation row |
| High-risk release needs reviewer/admin even when conditions pass | RPC §5.1 step 6: `RELEASE_AUTHORIZED`/refund require `p_actor_is_privileged` AND an `eligible=true` evaluation row; evaluation `requires_reviewer` defaults true |
| Critical transitions fail atomically if audit can't be written | In-txn CRITICAL audit insert into `diaspora_import_audit_log` (no best-effort fallback) in both RPCs, rolling back on failure (H1 pattern) |
| Everything gated behind flags | `DIASPORA_SAFETRADE_ENABLED` (feature/route gate, default OFF) + separate `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF, fail-closed) |

### Reference files (absolute paths)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260611061849_diaspora_trade_os_phase1b_foundation.sql` (RLS helpers, trigger fn, policy/grant template)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql` (atomic RPC + lock + idempotency + in-txn CRITICAL audit + REVOKE/GRANT/Down template)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621091000_diaspora_h2_quote_acceptance_rpc.sql` (transition + idempotency-conflict pattern)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql` (privileged-reviewer authority guard)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621120000_diaspora_phase8_subscription_entitlements.sql` (table-grant DO block, partial-unique idempotency index, `numeric` money cols)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/013_diaspora_trade_schema.sql` (existing `diaspora_import_orders`/`_quotes`/`_payment_milestones`/`_compliance_reviews`/`_import_audit_log` to connect to, not duplicate)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaServiceUtils.js` (`appendCriticalAudit`/`appendBestEffortAudit`, `resolveClient`)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/services/diaspora/diasporaEntitlementGuard.js` (`requireFeature` with `diaspora.safetrade.create`)
- `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md` §5 (SafeTrade gap map), §7 (conventions), §8 EB-4 (real-money external boundary)

Proposed new migration target (build, do NOT apply): `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621130000_diaspora_phase9_safetrade.sql`.

---

## C. Eligibility + release-policy engine design

I now have a complete picture of the conventions. The accepted quote is recorded at `order.metadata.rfq.acceptedQuoteId` with quote status `ACCEPTED`; compliance reviews carry `status IN (PENDING_REVIEW, APPROVED, FLAGGED, REJECTED)`; payment milestones carry `status IN (PENDING, CONFIRMED, FAILED, WAIVED, CANCELLED)`; stock reservations use `diaspora_cargo_reservations` with `RESERVATION_STATUSES`; documents use `diaspora_trade_documents`/`vehicle_government_documents` with `verification_status`; the entitlement gate is `diaspora.safetrade.create`.

This is a read-only design task. Here is the complete design.

---

# SafeTrade Eligibility Engine + Release Policy Engine — Design

Worktree: `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10`. Two new pure-evaluation service modules, framework-neutral, ESM, injectable `supabaseClient` (first-arg convention from `diasporaServiceUtils.js` / `diasporaEntitlementGuard.js`). Both are **read-only decision engines**: they NEVER mutate state, NEVER move money, NEVER write audit, NEVER call a provider. They return an explainable verdict; the (separately-built) transition/release executor consumes the verdict, re-checks the flag, and is the only place a mutation/RPC happens.

## 0. Money-safety invariants (encoded as engine postconditions)

Directive §5.2 / 37–51 maps to four hard postconditions the release engine guarantees by construction:

1. `eligible === true` is returned **only if** a payment milestone authoritative row exists AND is in a HELD state (not merely PENDING/promised). No held payment row → `eligible:false` with blocker `PAYMENT_NOT_HELD`. There is no code path producing `eligible:true` without `evidenceRefs` containing a held `diaspora_payment_milestones` row.
2. For a high-risk release, `eligible:true` additionally requires an authoritative reviewer/admin approval record; absent it the engine returns `eligible:false, requiresApproval:true` with blocker `REVIEWER_APPROVAL_REQUIRED` **even when every automated condition passes**.
3. Live real-money path is fail-closed: the engine reports `providerMode` and, when `DIASPORA_SAFETRADE_LIVE_PAYMENT` is OFF, marks any non-sandbox provider event as a blocker (`LIVE_PAYMENT_DISABLED`). The engine never itself activates a provider — that throw (`EXTERNAL_ACTIVATION_REQUIRED`) lives in the executor; the engine only refuses to bless the release.
4. The whole SafeTrade surface is gated by `DIASPORA_SAFETRADE_ENABLED` (default OFF). When OFF both engines return a single explicit blocker `SAFETRADE_DISABLED` and evaluate nothing else (fail-closed, no DB reads).

The engines are advisory-but-authoritative: they cannot release anything (no mutation power), and the executor is contractually forbidden from releasing on anything other than a fresh `eligible:true` verdict computed against current authoritative state (re-evaluated inside the executor, not trusted from the client).

## 1. New env flags (add to `diasporaSafeTradeConstants.js`, new constants file — NOT billing constants, that's another track)

New file `backend/constants/diaspora/diasporaSafeTradeConstants.js`, mirroring the `isSubscriptionEnforcementEnabled()` pattern in `diasporaBillingConstants.js`:

```js
export function isSafeTradeEnabled() {
  return String(process.env.DIASPORA_SAFETRADE_ENABLED || '').toLowerCase() === 'true';
}
export function isSafeTradeLivePaymentEnabled() {
  return String(process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT || '').toLowerCase() === 'true';
}
export function safeTradeProviderMode() {
  // default 'sandbox'; live only honored when isSafeTradeLivePaymentEnabled()
  const live = isSafeTradeLivePaymentEnabled();
  return live ? (process.env.DIASPORA_SAFETRADE_PROVIDER || 'sandbox') : 'sandbox';
}
```

Both default OFF/sandbox. `safeTradeProviderMode()` is fail-closed: it returns `'sandbox'` whenever live is disabled regardless of `DIASPORA_SAFETRADE_PROVIDER`.

## 2. Policy version constants (single source of truth, both engines import)

In the same constants file:

```js
export const SAFETRADE_ELIGIBILITY_POLICY_VERSION = 'safetrade.eligibility.v1';
export const SAFETRADE_RELEASE_POLICY_VERSION = 'safetrade.release.v1';
```

String constants (not numbers) so they are stable, greppable, embeddable in audit `new_state`, and forward-compatible. Every verdict echoes its `policyVersion`; the executor records it in the audit row's `metadata.policyVersion` so a release decision is forever traceable to the exact ruleset that blessed it. Bump the string when blocker semantics change; never mutate a version's meaning in place.

## 3. Shared verdict + blocker contract (`diasporaSafeTradePolicyTypes.js` helper, or inline in eligibility module and re-exported)

Both engines return the identical envelope shape required by the task:

```
{
  eligible: boolean,
  blockers: Blocker[],          // empty iff eligible === true
  evidenceRefs: EvidenceRef[],  // authoritative rows consulted (positive AND negative)
  policyVersion: string,
  evaluatedAt: string (ISO),
  // release-only additions:
  requiresApproval: boolean,    // true when high-risk
  riskTier: 'STANDARD' | 'HIGH_RISK',
  providerMode: 'sandbox' | 'live',
}
```

**Blocker** (explainability is the contract — every blocker self-describes and points at the record that caused it):

```
Blocker = {
  code: string,            // stable machine code, e.g. 'PAYMENT_NOT_HELD'
  message: string,         // human-readable, plan-style explanation
  severity: 'BLOCK' | 'WARN',
  evidenceRef: EvidenceRef | null, // the authoritative row (or its absence) proving the blocker
  remediation: string,     // what must change for this blocker to clear
  policyClause: string,    // directive clause id, e.g. '§40.identity'
}
```

**EvidenceRef** — every blocker and every "pass" references an authoritative record by table + id + the fields read + the value observed, so a reviewer can reconstruct the decision without re-querying:

```
EvidenceRef = {
  kind: string,            // 'payment_milestone' | 'quote' | 'compliance_review' | ...
  table: string,           // real table name, e.g. 'diaspora_payment_milestones'
  recordId: string | null, // null encodes "required record absent" (itself authoritative)
  observed: object,        // the exact fields read, e.g. { status:'PENDING', amount, currency }
  satisfied: boolean,      // did this evidence satisfy its requirement
}
```

A `recordId: null, satisfied: false` evidence ref is how "no held payment exists" is represented authoritatively — absence is evidence. No blocker is ever emitted without an accompanying `evidenceRef` (the engine asserts this internally; a blocker with a null ref is only allowed for pure env/flag blockers like `SAFETRADE_DISABLED`).

A small frozen `SAFETRADE_BLOCKER_CODES` map (like `DENIAL_CODES` in `diasporaEntitlementService.js`) enumerates every code so callers/UI can switch on them exhaustively.

---

## 4. `diasporaSafeTradeEligibilityService.js` — ELIGIBILITY ENGINE (before activation, §40)

Module shape:

```js
// imports: resolveClient (diasporaServiceUtils), checkFeature (diasporaEntitlementService),
//   isSafeTradeEnabled / policy version (diasporaSafeTradeConstants), authorization helpers,
//   constants (RESERVATION_STATUSES, DOCUMENT_STATUSES, IMPORT_ORDER_STATUSES)

export const SAFETRADE_ELIGIBILITY_BLOCKER_CODES = Object.freeze({ ... });

export async function evaluateSafeTradeEligibility(
  supabaseOrOptions,
  {
    importOrderId,
    buyerContext,       // server-derived auth context (requireUserContext)
    sellerContext,      // server-derived (or sellerId resolved server-side)
    tenantId,
    requestedCurrency,
    requestedCountry,
    options = {},       // { policyProfile } selects identity/doc requirement set
  }
) { ... }  // returns the verdict envelope
```

It is a **pure aggregator of independent predicate checks**. Each check is its own small async function `(ctx) => { evidenceRef, blocker|null }`, run, then folded into `blockers[]`/`evidenceRefs[]`. The engine collects **all** blockers (does not short-circuit) so the buyer sees the full remediation list at once — except the flag gate, which short-circuits.

### Eligibility checks (each → one authoritative evidenceRef), §40

| # | Check | Authoritative record | Pass condition | Blocker code |
|---|-------|----------------------|----------------|--------------|
| 0 | Feature flag | env `DIASPORA_SAFETRADE_ENABLED` | on | `SAFETRADE_DISABLED` (short-circuits, no DB read) |
| 1 | Authenticated buyer | `buyerContext` via `requireUserContext` | id present | `BUYER_UNAUTHENTICATED` |
| 2 | Authenticated seller | `sellerContext` / order seller participant | id present, distinct from buyer | `SELLER_UNAUTHENTICATED` / `BUYER_SELLER_SAME` |
| 3 | Subscription entitlement | `checkFeature(supabase,{tenantId,userId,featureKey:'diaspora.safetrade.create'})` (reuses Phase 8) | `allowed === true` | `ENTITLEMENT_MISSING` (carries `requiredPlan` from the denial) |
| 4 | Verified identities per policy | `diaspora_trade_profiles` (buyer & seller), `verification_status` | both meet policy threshold | `IDENTITY_UNVERIFIED_BUYER` / `_SELLER` |
| 5 | Accepted quote present | `diaspora_import_orders.metadata.rfq.acceptedQuoteId` + `diaspora_import_quotes.status='ACCEPTED'` | accepted quote row exists & ACCEPTED | `NO_ACCEPTED_QUOTE` |
| 6 | Valid stock reservation | `diaspora_cargo_reservations` for the order, `status='APPROVED'` (RESERVATION_STATUSES) | approved, non-deleted reservation linked to order | `NO_VALID_RESERVATION` |
| 7 | Required stock verification | `diaspora_stock_ledger` RESERVE entry / stock item `verification` evidence | reservation backed by verified stock evidence | `STOCK_VERIFICATION_MISSING` |
| 8 | Required documents | `diaspora_trade_documents` + `vehicle_government_documents.verification_status='VERIFIED'` vs required set | all policy-required docs VERIFIED | `REQUIRED_DOCUMENTS_INCOMPLETE` (lists missing categories) |
| 9 | No sanctions / suspension | `diaspora_trade_profiles` flags / compliance hold | neither party suspended/sanctioned | `PARTY_SANCTIONED_OR_SUSPENDED` |
| 10 | Supported currency/country | `requestedCurrency`/`requestedCountry` vs `SAFETRADE_SUPPORTED_CURRENCIES`/`_COUNTRIES` allowlist | both in allowlist | `UNSUPPORTED_CURRENCY` / `UNSUPPORTED_COUNTRY` |
| 11 | No conflicting active SafeTrade | `diaspora_safetrade_transactions` (the Phase 9 canonical table the migration track adds) where order/parties overlap & state active | none active | `CONFLICTING_ACTIVE_SAFETRADE` |

Authorization uses **server-derived roles only** (`diasporaAuthorization.js` `requireUserContext`, `isOrderOwner`, `isAssignedParticipant`); the client `x-stakeholder-role` is never read here — consistent with the codebase rule. Check 11 references the canonical SafeTrade transaction table that the migration sub-track creates (this engine reads it; it does not define it). If that table is absent at runtime (engine shipped before migration), check 11 fails closed to a blocker, never silently passes.

Eligibility is `true` iff `blockers` is empty after all checks. It is the **pre-activation** gate: passing it authorizes the executor to *create* a SafeTrade transaction (which itself re-runs `requireFeature` via `diasporaEntitlementGuard`), but it authorizes **no money movement** — that is solely the release engine's domain.

---

## 5. `diasporaSafeTradeReleasePolicyService.js` — RELEASE POLICY ENGINE (§43)

Module shape:

```js
export const SAFETRADE_RELEASE_BLOCKER_CODES = Object.freeze({ ... });

export async function evaluateSafeTradeReleasePolicy(
  supabaseOrOptions,
  {
    safeTradeId,        // the canonical diaspora_safetrade_transactions id
    actorContext,       // server-derived; the actor requesting/approving release
    idempotencyKey,     // the release idempotency key (checked unused)
    options = {},
  }
) { ... } // returns verdict envelope incl. requiresApproval, riskTier, providerMode
```

This engine evaluates **current authoritative state only** — it re-reads every row fresh; it never trusts a cached/passed-in state, never trusts the eligibility verdict from creation time. It is the last line before money moves, so it is the strictest.

### Release checks (§43) — each → authoritative evidenceRef

| # | Check | Authoritative record | Pass condition | Blocker code |
|---|-------|----------------------|----------------|--------------|
| 0 | Feature flag | `DIASPORA_SAFETRADE_ENABLED` | on | `SAFETRADE_DISABLED` (short-circuit) |
| 1 | **Payment exists and is HELD** | `diaspora_payment_milestones` (deposit/escrow milestone) `status` in held-set | a held milestone covering the release amount exists | `PAYMENT_NOT_HELD` |
| 2 | Required compliance approved | `diaspora_compliance_reviews.status='APPROVED'` for required review types | all required reviews APPROVED (never auto-derived) | `COMPLIANCE_NOT_APPROVED` |
| 3 | Required documents verified | `diaspora_trade_documents`/`vehicle_government_documents` `verification_status='VERIFIED'` | required set all VERIFIED | `DOCUMENTS_NOT_VERIFIED` |
| 4 | Stock/vehicle evidence valid | stock ledger / `vehicle_government_documents` evidence | valid & current | `STOCK_EVIDENCE_INVALID` |
| 5 | Shipment milestone reached | `diaspora_shipments.status` / `diaspora_shipment_stage_events` | required release milestone reached (e.g. RELEASED/ARRIVED), never auto-completed | `SHIPMENT_MILESTONE_NOT_REACHED` |
| 6 | No active dispute | `diaspora_safetrade_disputes` / order status `DISPUTED` | none open | `ACTIVE_DISPUTE` |
| 7 | No fraud/security hold | security-hold flag on the SafeTrade row / trade profile | no hold | `SECURITY_HOLD` |
| 8 | Actor authorized | `actorContext` server-derived role | actor may request/approve release for this SafeTrade | `ACTOR_NOT_AUTHORIZED` |
| 9 | Entitlement active | `checkFeature(... 'diaspora.safetrade.create')` (or a release-scoped key) | active | `ENTITLEMENT_INACTIVE` |
| 10 | Provider event reconciled | `diaspora_safetrade_provider_events` matched to the held payment, `reconciled=true` | reconciled; AND if not sandbox, `LIVE_PAYMENT_DISABLED` unless live flag on | `PROVIDER_EVENT_UNRECONCILED` / `LIVE_PAYMENT_DISABLED` |
| 11 | Idempotency key unused | `diaspora_safetrade_release_attempts` (or RPC idempotency ledger) | key not previously consumed (replay → return prior verdict, not a new release) | `IDEMPOTENCY_KEY_REUSED` |
| 12 | **High-risk approval** | reviewer/admin approval row (`diaspora_safetrade_approvals.status='APPROVED'` by a `PLATFORM_ADMIN_ROLES`/`PLATFORM_REVIEW_ROLES` actor) | present when `riskTier==='HIGH_RISK'` | `REVIEWER_APPROVAL_REQUIRED` |

### Risk tiering and the high-risk approval gate (§43, non-negotiable)

`riskTier` is computed from authoritative signals (amount over a threshold, currency/country risk, first-trade between parties, any WARN-level signal, prior dispute history). The default is conservative: **unknown → HIGH_RISK**. When `riskTier === 'HIGH_RISK'`, check #12 is mandatory and **`eligible` cannot be `true` without an explicit reviewer/admin approval record even if checks #1–#11 all pass**. The engine sets `requiresApproval:true`; the verdict then carries blocker `REVIEWER_APPROVAL_REQUIRED` until that approval row exists. Approval authority is validated against server-derived `isPlatformAdmin`/`isPlatformReviewer` (`diasporaAuthorization.js`) — a buyer or seller can never self-approve a high-risk release.

### Money-safety guarantee (engine + executor contract)

- The engine returns `eligible:true` only when (held payment present) ∧ (all §43 BLOCK checks pass) ∧ (if HIGH_RISK, reviewer/admin approval present). This is the literal predicate; there is no override branch.
- The executor (separate, not this module) must: re-call `evaluateSafeTradeReleasePolicy` against live state, refuse on `eligible:false`, and only then call the atomic release RPC. The release RPC (migration sub-track, modeled on `diaspora_append_stock_movement_atomic`) re-checks the held-payment row `FOR UPDATE`, consumes the idempotency key inside the txn, writes a **CRITICAL audit row inside the same transaction** (so a release whose audit can't be written rolls back entirely — directive's atomic-audit rule), and in non-sandbox mode throws `EXTERNAL_ACTIVATION_REQUIRED` rather than calling any real provider. The engine and executor together make it structurally impossible to release without held payment + passed policy + (high-risk) approval.

---

## 6. Cross-cutting design properties

- **Pure / no side effects:** Neither engine writes audit, mutates rows, or calls providers. They are safe to call from a read API (e.g. a "why can't I release yet?" panel) and from the executor's pre-flight. Audit of the *decision* (if desired) is written by the caller via `appendBestEffortAudit` for evaluation telemetry and by the executor via the in-txn CRITICAL audit for the actual release.
- **Injectable client:** first arg may be a Supabase client or `{ supabaseClient }` resolved through `resolveClient(options)` from `diasporaServiceUtils.js`, so both engines are unit-testable with an in-memory mock (no DB) — matching every other diaspora service and `diasporaEntitlementGuard.js`.
- **Fail-closed everywhere:** missing tables, null contexts, unknown currency, or an absent canonical SafeTrade row all yield BLOCK blockers, never silent passes. A thrown DB fault propagates as `DatabaseError`; it is never swallowed into `eligible:true`.
- **Explainability is structural:** `blockers[]` + `evidenceRefs[]` are exhaustive and reference real tables/ids; UI and reviewers can render the full remediation path and audit can replay the exact authoritative state read at `evaluatedAt` under the named `policyVersion`.
- **Reuse, no duplication:** entitlement decisions reuse `checkFeature` (Phase 8); roles reuse `diasporaAuthorization.js`; statuses reuse `diasporaStatuses.js` (`RESERVATION_STATUSES`, `DOCUMENT_STATUSES`, `IMPORT_ORDER_STATUSES`); the accepted-quote pointer reuses the existing `order.metadata.rfq.acceptedQuoteId` convention from `diaspora_accept_quote_atomic`.

## 7. Files (design only — nothing written this task)

- New: `backend/constants/diaspora/diasporaSafeTradeConstants.js` — flags (`isSafeTradeEnabled`, `isSafeTradeLivePaymentEnabled`, `safeTradeProviderMode`), `SAFETRADE_ELIGIBILITY_POLICY_VERSION`, `SAFETRADE_RELEASE_POLICY_VERSION`, supported currency/country allowlists, held-payment status set.
- New: `backend/services/diaspora/diasporaSafeTradeEligibilityService.js` — `evaluateSafeTradeEligibility`, `SAFETRADE_ELIGIBILITY_BLOCKER_CODES`.
- New: `backend/services/diaspora/diasporaSafeTradeReleasePolicyService.js` — `evaluateSafeTradeReleasePolicy`, `SAFETRADE_RELEASE_BLOCKER_CODES`, risk-tier helper.
- New (build phase, not now): a NEW route file (unmounted; integrator mounts it), an atomic release RPC migration modeled on `20260621090000_diaspora_h1_stock_movement_rpc.sql` (FOR UPDATE on held payment, in-txn idempotency replay, in-txn CRITICAL audit, `-- +migrate Up/Down`, REVOKE PUBLIC + GRANT service_role, SECURITY DEFINER + `SET search_path='public'`), and the canonical `diaspora_safetrade_transactions`/`_approvals`/`_disputes`/`_provider_events`/`_release_attempts` tables (separate migration track). DO NOT mount routes, DO NOT apply migrations, DO NOT call providers.

Authoritative references consulted: `backend/services/diaspora/diasporaServiceUtils.js` (audit/idempotency helpers), `diasporaAuthorization.js` (server-derived roles), `diasporaEntitlementGuard.js` + `diasporaEntitlementService.js` (`checkFeature`, `DENIAL_CODES`, `explainDenial`), `backend/constants/diaspora/diasporaEntitlements.js` (`SAFETRADE_CREATE='diaspora.safetrade.create'`), `diasporaStatuses.js` (status/reservation/document constants), `diasporaBillingConstants.js` (flag-gating pattern), `database/migrations/013_diaspora_trade_schema.sql` (lines 319–375: compliance/payment-milestone/reputation schema; payment-milestone `status IN (PENDING,CONFIRMED,FAILED,WAIVED,CANCELLED)`), `20260621090000_diaspora_h1_stock_movement_rpc.sql` (atomic RPC + in-txn CRITICAL audit + idempotency replay pattern to mirror in the release RPC), `20260621091000_diaspora_h2_quote_acceptance_rpc.sql` (accepted-quote pointer at `order.metadata.rfq.acceptedQuoteId`, quote status `ACCEPTED`), `docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md` §5 (SafeTrade gap map + non-negotiables).

---

## D. Payment milestones + sandbox provider design

I now have all the grounding I need: the provider pattern (billing/drive), the atomic-RPC + idempotency + critical-audit pattern (H1), the RLS helper + REVOKE/GRANT convention (phase1b), the HMAC anti-replay webhook pattern (paymentRouter), the existing `diaspora_payment_milestones` schema, the entitlement guard, and the `SAFETRADE_CREATE` feature key. Here is the design.

---

# SafeTrade — Payment Milestones + Payment Provider Abstraction (Sandbox-only) — Design

Scope: design only. No files written, no migration applied, no network. Everything below is gated by `DIASPORA_SAFETRADE_ENABLED` (default OFF) and, for any money movement, `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF, fail-closed). The live provider path **throws `EXTERNAL_ACTIVATION_REQUIRED`** and never touches a network. This mirrors `backend/services/diaspora/billing/billingProvider.js` and `backend/services/diaspora/drive/googleDriveProvider.js`.

## 0. Guiding non-negotiables (directive §5.2 / 37–51) mapped to this design

- No real money / no real escrow release / no auto compliance approval / no auto shipment-or-delivery completion / no auto reputation. → The milestone service only ever drives a **SandboxPaymentProvider** in-memory ledger; releases of HIGH-risk milestones (`final release`, `delivery confirmation`, any milestone whose `release_trigger` is `MANUAL_REVIEW`) require an explicit reviewer/admin actor even when automated release conditions pass.
- Real-money operations use sandbox/fake only; live path throws `EXTERNAL_ACTIVATION_REQUIRED`. → `LivePaymentProvider` methods all throw; the factory fails closed.
- Critical transitions fail atomically if their audit row cannot be written. → Every milestone state change goes through an atomic RPC (`diaspora_safetrade_milestone_transition_atomic`) that writes the CRITICAL audit row **inside the same transaction** (H1 pattern), plus `appendCriticalAudit` for JS-orchestrated steps that are not the RPC itself.
- Totals reconcile to the transaction total. → Enforced in the RPC at create/activate time and re-checked on every mutation; a tolerance-bounded sum invariant that raises `DIASPORA_SAFETRADE/TOTALS_MISMATCH` on violation.

---

## 1. Environment flags / constants module

New constants file `backend/constants/diaspora/diasporaSafeTradeConstants.js` (modeled byte-for-byte on `diasporaBillingConstants.js` style — frozen maps, pure helpers, no import-time side effects, fail-closed in production).

```
PAYMENT_PROVIDERS = { SANDBOX:'sandbox', MANUAL:'manual', LIVE:'live' }   // LIVE = not implemented
APPROVED_LIVE_PAYMENT_PROVIDERS = Object.freeze([])  // empty → live always fails closed

isSafeTradeEnabled()        → process.env.DIASPORA_SAFETRADE_ENABLED === 'true'   (default false)
isSafeTradeLivePayment()    → process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT === 'true' (default false)
configuredPaymentProvider() → (process.env.DIASPORA_SAFETRADE_PAYMENT_PROVIDER||'').toLowerCase() || null
shouldUseSandboxPayment()   → !isSafeTradeLivePayment() || provider not in APPROVED_LIVE_PAYMENT_PROVIDERS
assertSafeTradePaymentSafety() → if live enabled and provider not approved/empty → throw (fail closed)
safeTradeWebhookSecret()    → process.env.DIASPORA_SAFETRADE_WEBHOOK_SECRET; required in prod, dev fallback constant
MILESTONE_AMOUNT_TOLERANCE  → 0.01  (cent-level reconciliation tolerance)
DEFAULT_CURRENCY            → 'USD'
```

Two separate gates exactly as directed: `isSafeTradeEnabled()` gates the **feature surface** (service/routes refuse with a disabled error when off); `isSafeTradeLivePayment()` gates **money movement** and is independently fail-closed via `assertSafeTradePaymentSafety()`. Mirrors the billing two-flag split (`DIASPORA_SUBSCRIPTION_ENFORCEMENT` vs `DIASPORA_BILLING_LIVE`).

Enumerations (frozen) also live here:

- `MILESTONE_TYPES`: `BUYER_COMMITMENT`, `BUYER_DEPOSIT`, `SELLER_PROCUREMENT_READINESS`, `EXPORT_DOCUMENT_APPROVAL`, `CONTAINER_LOADING`, `SHIPMENT_DEPARTURE`, `BORDER_CUSTOMS`, `DELIVERY_CONFIRMATION`, `FINAL_RELEASE`.
- `MILESTONE_STATUS`: `DRAFT`, `PENDING`, `INTENT_CREATED`, `AUTHORIZED` (held), `CAPTURED` (funded/in custody), `RELEASE_REQUESTED`, `RELEASE_APPROVED`, `RELEASED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `CANCELLED`, `WAIVED`, `FAILED`, `DISPUTED`, `ON_HOLD`. (Superset of the existing table CHECK; the migration relaxes/extends the CHECK additively — see §6.)
- `DUE_TRIGGER` and `RELEASE_TRIGGER`: `MANUAL`, `MANUAL_REVIEW`, `ON_DOCUMENT_APPROVAL`, `ON_COMPLIANCE_PASS`, `ON_SHIPMENT_STAGE`, `ON_DELIVERY_CONFIRMATION`, `ON_ORDER_STATE`, `SCHEDULED`. (Triggers are *conditions that become eligible*, never auto-execute money movement for HIGH-risk types.)
- `HIGH_RISK_MILESTONE_TYPES`: `FINAL_RELEASE`, `DELIVERY_CONFIRMATION` — release always requires reviewer/admin.
- `WEBHOOK_EVENT_TYPES`: `intent.created`, `hold.authorized`, `capture.succeeded`, `release.succeeded`, `refund.succeeded`, `partial_refund.succeeded`, `cancel.succeeded`, `payment.failed`.

---

## 2. Payment provider abstraction — `backend/services/diaspora/safetrade/safeTradePaymentProvider.js`

Module shape mirrors `billingProvider.js`: an error class, an abstract base interface, a deterministic in-memory sandbox, a live stub that throws `EXTERNAL_ACTIVATION_REQUIRED`, a process-shared sandbox singleton, and a fail-closed factory.

### 2.1 Error class

```
class PaymentProviderError extends Error { constructor(message, code='PAYMENT_PROVIDER_ERROR') }
```
Sanitized messages only — never include signatures, secrets, or raw provider payloads. Same discipline as `BillingProviderError`/`DriveProviderError`.

### 2.2 Interface `PaymentProvider` (§42 — the full surface)

Every method is `async`, takes a single options object, returns a plain serializable object, and on the base throws `'not implemented'`:

| Method | Purpose | Key inputs | Returns |
|---|---|---|---|
| `createPaymentIntent` | Create a provider intent for a milestone amount | `{ milestoneId, tenantId, amount, currency, payer, payee, idempotencyKey }` | `{ provider, intentId, status:'requires_authorization', amount, currency, live:false }` |
| `authorize` (a.k.a. hold) | Place a hold/authorization on funds | `{ intentId, idempotencyKey }` | `{ intentId, status:'authorized', holdRef, live:false }` |
| `capture` | Capture authorized funds into custody (not release to payee) | `{ intentId, amount?, idempotencyKey }` | `{ intentId, status:'captured', captureRef, capturedAmount, live:false }` |
| `release` | Release captured funds to payee | `{ intentId, idempotencyKey, approval }` | `{ intentId, status:'released', releaseRef, live:false }` |
| `refund` | Full refund to payer | `{ intentId, idempotencyKey }` | `{ intentId, status:'refunded', refundRef, refundedAmount, live:false }` |
| `partialRefund` | Partial refund | `{ intentId, amount, idempotencyKey }` | `{ intentId, status:'partially_refunded', refundRef, refundedAmount, remainingAmount, live:false }` |
| `cancel` | Cancel an un-captured intent/authorization | `{ intentId, idempotencyKey }` | `{ intentId, status:'cancelled', live:false }` |
| `retrieveStatus` | Read provider-side status (reconciliation source) | `{ intentId }` | `{ intentId, status, amount, capturedAmount, refundedAmount, live:false }` |
| `verifyWebhook` | HMAC-verify + parse a webhook | `{ rawBody, signature, timestamp }` | `{ verified, eventId, eventType, intentId, payload }` |
| `reconcileEvent` | Map a verified webhook/status into a normalized internal effect | `{ event }` | `{ intentId, normalizedStatus, amountDelta, terminal }` |

`get name()` on each provider returns its `PAYMENT_PROVIDERS` key (sandbox/live), matching the `billingProvider` `get name()` convention.

### 2.3 `SandboxPaymentProvider extends PaymentProvider` (deterministic, in-memory, no network)

- State: `Map intentId -> intent snapshot` (`{ status, amount, currency, capturedAmount, refundedAmount, holdRef, captureRef, releaseRef, milestoneId, payer, payee }`), plus a monotonic `_seq` for deterministic ids (`sbx_pi_1`, `sbx_hold_1`, …) exactly like `SandboxBillingProvider._next`.
- Deterministic clock: uses a fixed/injectable timestamp like the billing sandbox (`new Date('2026-06-21T…')`) so tests assert without wall-clock flakiness.
- State machine enforced inside the provider (defense in depth; the *authoritative* machine is in the RPC): `requires_authorization → authorized → captured → released`; refunds allowed from `captured`/`released`; `cancel` only from `requires_authorization`/`authorized`. Illegal jumps throw `PaymentProviderError('…','INVALID_STATE')`.
- **Idempotency at the provider layer**: each mutating method dedupes on `idempotencyKey` per intent — replay returns the prior snapshot with `idempotentReplay:true` and never advances state or double-counts amounts (parallels H1 `idempotentReplay`).
- `verifyWebhook`: HMAC-SHA256 over `${timestamp}.${rawBody}` with `safeTradeWebhookSecret()`, **timing-safe compare**, plus 5-minute anti-replay drift check — the exact composition of `paymentRouter.verifySignature` and `SandboxBillingProvider.verifyWebhook`. Returns `{verified:false}` (never throws) on bad signature/missing timestamp/excess drift so the router can answer 401 cleanly.
- `reconcileEvent`: pure mapping from event type → `{normalizedStatus, amountDelta, terminal}`; deterministic, no I/O.
- Crucially: **the sandbox `release()` moves only fake balances.** No real funds, no real escrow. `live:false` on every payload.

### 2.4 `LivePaymentProvider extends PaymentProvider` (external-activation stub)

Every method throws `PaymentProviderError('Live SafeTrade <op> requires an approved payment provider SDK and credentials (external activation pending)', 'EXTERNAL_ACTIVATION_REQUIRED')` — identical discipline to `GoogleDriveProvider` and `StripeBillingProvider`. No SDK import, no network.

### 2.5 Singleton + factory

```
getSharedSandboxPaymentProvider()  // process-shared, lazy — like getSharedSandboxProvider()
selectPaymentProvider(options={}) {
  if (options.paymentProvider) return options.paymentProvider;     // test injection
  assertSafeTradePaymentSafety();                                  // fail closed
  if (shouldUseSandboxPayment()) return getSharedSandboxPaymentProvider();
  // live requested + approved provider configured → construct LivePaymentProvider (still throws on use)
  if (isSafeTradeLivePayment()) {
    if (configuredPaymentProvider() === PAYMENT_PROVIDERS.LIVE) return new LivePaymentProvider();
    throw new PaymentProviderError(`Live payment provider '${configuredPaymentProvider()}' is not implemented`, 'EXTERNAL_ACTIVATION_REQUIRED');
  }
  return getSharedSandboxPaymentProvider();
}
```

Same fail-closed shape as `selectBillingProvider`: an "approved but unrecognized" provider in live mode must **throw**, never silently downgrade to sandbox.

---

## 3. Milestone service — `backend/services/diaspora/diasporaSafeTradeMilestoneService.js`

ESM, `import/export`, `resolveClient(options)` first-arg-injectable client (the `diasporaServiceUtils` convention), server-derived roles only via `diasporaAuthorization.js` (`requireUserContext`, `normalizeId`, `assertCan…`), audit via `appendCriticalAudit`/`appendBestEffortAudit`. Operates over the existing `diaspora_payment_milestones` table (connect, don't duplicate) keyed by `import_order_id` (the canonical SafeTrade transaction is the import order; see §5 of the discovery doc — no separate transaction table is invented here, the milestones hang off the order).

Every public function first calls a guard: `if (!isSafeTradeEnabled()) throw new ForbiddenError('SafeTrade is disabled', { code:'SAFETRADE_DISABLED' })` — except pure read/explain helpers used by the UI to render the "sandbox / not live" state.

### 3.1 Milestone configuration model (per §41)

Each milestone row carries (extending the existing columns + a structured `metadata`/new columns added additively in §6):

- `milestone_type` (from `MILESTONE_TYPES`)
- `amount` NUMERIC + `percentage` (optional; if set, `amount` is derived from the order total and stored, so totals always reconcile against stored `amount`)
- `currency`
- `payer` / `payee` (role-resolved: buyer, seller, platform — server-derived, never client-trusted)
- `due_trigger` / `release_trigger` (from the trigger enums)
- `hold_reason` (text; why funds are held)
- `evidence_requirements` (JSONB: required document types / compliance review / shipment stage that must be satisfied before the milestone may transition — wired to `diaspora_trade_documents`, `diaspora_compliance_reviews`, `diaspora_shipment_stage_events`)
- `status` (from `MILESTONE_STATUS`)
- `provider` + `provider_intent_ref` (provider reference)
- `idempotency_key`
- audit linkage via `diaspora_import_audit_log`.

A default **milestone template** (configurable, not hardcoded into logic) produced by `buildDefaultMilestonePlan({ orderTotal, currency, splits })`: e.g. deposit 20% → procurement readiness → export-doc approval → loading → departure → border → delivery → final release (remaining %). Splits are config-driven (passed in / read from order metadata), echoing the "config-driven, not hardcoded" rule used for the plan catalog.

### 3.2 Functions

- `planMilestones(client, { importOrderId, plan|template, actor, req })` — validate split sums to 100% / amounts to order total within `MILESTONE_AMOUNT_TOLERANCE`; returns a dry-run reconciliation report (no writes). Best-effort audit.
- `createMilestones(client, { importOrderId, milestones, idempotencyKey, actor, req })` — calls the atomic RPC `diaspora_safetrade_create_milestones_atomic` which inserts all rows **and** asserts totals reconcile **and** writes the CRITICAL audit row in one transaction; idempotent on `(import_order_id, idempotency_key)`; replay returns `idempotentReplay:true`. **SafeTrade creation entry point checks the entitlement** via `diasporaEntitlementGuard.requireFeature(client,{ tenantId, userId, featureKey: FEATURE_KEYS.SAFETRADE_CREATE })` (the `diaspora.safetrade.create` key already exists) — no-op when enforcement off, ForbiddenError with structured denial when on.
- `createIntentForMilestone(client, { milestoneId, idempotencyKey, actor, req })` — selects provider via `selectPaymentProvider`, calls `createPaymentIntent`, then persists `provider_intent_ref` + advances status `PENDING→INTENT_CREATED` through the transition RPC.
- `authorizeMilestone` / `captureMilestone` — provider `authorize`/`capture` then RPC transition (`INTENT_CREATED→AUTHORIZED→CAPTURED`). Capture = funds in sandbox custody, **not** released.
- `requestRelease(client, { milestoneId, evidence, actor, req })` — evaluates `release_trigger` eligibility against the wired domain (documents approved? compliance passed? shipment stage reached? delivery confirmed?) → status `CAPTURED→RELEASE_REQUESTED`. Returns an **explainable** result `{ eligible, blockers[], policyVersion, evaluatedAt }` (mirrors the entitlement `explainDenial` style). Never moves money.
- `approveRelease(client, { milestoneId, reviewerContext, idempotencyKey, actor, req })` — **requires reviewer/admin** (`assertCan…` privileged check); for `HIGH_RISK_MILESTONE_TYPES` this approval is mandatory even if `requestRelease` found zero blockers. Status `RELEASE_REQUESTED→RELEASE_APPROVED`. CRITICAL audit.
- `executeRelease(client, { milestoneId, idempotencyKey, actor, req })` — only from `RELEASE_APPROVED`; calls provider `release` (sandbox moves fake balance; live throws `EXTERNAL_ACTIVATION_REQUIRED`), then RPC transition `RELEASE_APPROVED→RELEASED`. On `DELIVERY_CONFIRMATION`/`FINAL_RELEASE` release, it **emits a reputation-eligibility domain event** (`SAFETRADE_DELIVERY_CONFIRMED` / `SAFETRADE_FINAL_RELEASED`) — it does **not** write reputation (no auto reputation).
- `refundMilestone` / `partialRefundMilestone` / `cancelMilestone` — provider call + RPC transition; partial refund updates `refunded_amount` and re-checks the reconciliation invariant.
- `reconcileMilestone(client, { milestoneId })` — calls provider `retrieveStatus`, compares to stored status, records drift via best-effort audit; surfaces mismatches for the reconciliation worker (never silently overwrites authoritative state).
- `getMilestones` / `explainMilestoneState` — read/explain for UI (returns `{ live:false, sandbox:true }` markers so the UI can show the explicit "sandbox / not live" label).

### 3.3 Reconciliation invariant

`assertTotalsReconcile(milestones, orderTotal)` — `Σ amount (non-WAIVED/CANCELLED) === orderTotal ± MILESTONE_AMOUNT_TOLERANCE`, else throw `DIASPORA_SAFETRADE/TOTALS_MISMATCH`. Enforced both in JS (pre-flight) and authoritatively inside the create/mutate RPC so a race cannot leave totals inconsistent.

---

## 4. Webhook idempotency model (reuse `paymentRouter.js` HMAC pattern + store events; reject replay)

A **new, unmounted** route file `backend/routes/diasporaSafeTradeRoutes.js` (the integrator mounts it — I do not edit `diasporaRoutes.js`/`server.js`). It exposes `POST /webhook/:provider` for SafeTrade payment events. Flow:

1. **Signature + anti-replay** (identical composition to `paymentRouter.verifySignature` and the sandbox `verifyWebhook`): HMAC-SHA256 over `${timestamp}.${rawBody}` with `safeTradeWebhookSecret()`, `crypto.timingSafeEqual`, 5-minute drift window. On failure → best-effort security audit (`SAFETRADE_WEBHOOK_REPLAY_OR_TAMPERING`) + `401`. Dev-only `dev-bypass-sig` escape exactly as the existing router (guarded by `NODE_ENV !== 'production'`).
2. **Event de-dup / replay rejection**: a new table `diaspora_safetrade_payment_events` with `UNIQUE (provider, event_id)` (and a secondary unique on `(provider, signature_hash)`). Insert-first; a unique-violation means **replay → respond `{status:'ignored', reason:'duplicate event'}`** without re-applying effects. This is the `paymentRouter` "duplicate `reference` → ignore" pattern made first-class and table-backed (and matches the idempotency convention: replay is a no-op, conflicting reuse rejected).
3. **Apply effect atomically**: `provider.reconcileEvent` → normalized effect → `diaspora_safetrade_apply_event_atomic(event_id, intent_ref, normalized_status, …)` which, in one transaction, (a) records the stored event row, (b) advances the milestone status only along legal transitions, (c) writes the CRITICAL audit row, (d) emits a `domain_events` outbox row for downstream projections. Any failure rolls all of it back (H1 guarantee). **A `release`-type event never auto-releases a HIGH-risk milestone** — it can at most move it to `RELEASE_REQUESTED`; human approval is still required.
4. **No live calls**: with `DIASPORA_SAFETRADE_LIVE_PAYMENT` off, the only producer of valid webhooks is the sandbox/test harness; the live provider cannot be activated to emit real events.

Stored-event row shape: `{ id, tenant_id, provider, event_id (unique), event_type, intent_ref, milestone_id, signature_hash, payload JSONB, received_at, processed_at, status }`.

---

## 5. Migration shape (design only — NOT applied)

A new additive migration `database/migrations/<ts>_diaspora_safetrade_payment_milestones.sql` following every convention from `20260621090000_diaspora_h1_stock_movement_rpc.sql` and `20260611061849_diaspora_trade_os_phase1b_foundation.sql`:

- `-- +migrate Up` / `-- +migrate Down`.
- **Additive ALTERs** to `diaspora_payment_milestones` (never destructive): add `percentage NUMERIC`, `payer TEXT`, `payee TEXT`, `due_trigger TEXT`, `release_trigger TEXT`, `hold_reason TEXT`, `evidence_requirements JSONB DEFAULT '{}'`, `provider TEXT`, `provider_intent_ref TEXT`, `idempotency_key TEXT`, `refunded_amount NUMERIC DEFAULT 0`, `released_at TIMESTAMPTZ`, `release_approved_by TEXT`. Extend the `status` CHECK to the `MILESTONE_STATUS` superset (drop-and-recreate the constraint additively). Add `UNIQUE (import_order_id, idempotency_key)` and `UNIQUE (import_order_id, milestone_type)` (one milestone per type per order, configurable later).
- New `diaspora_safetrade_payment_events` table with RLS enabled, policy via `public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by)`, and the unique constraints in §4.
- Three `SECURITY DEFINER` (or `SECURITY INVOKER` where RLS should apply, matching H1's `SECURITY INVOKER` choice for actor-context functions) RPCs with `SET search_path = public, pg_temp`: `diaspora_safetrade_create_milestones_atomic`, `diaspora_safetrade_milestone_transition_atomic`, `diaspora_safetrade_apply_event_atomic`. Each: validates the transition against an in-SQL allowlist, enforces idempotency inside the txn (replay returns `idempotentReplay:true`, conflict raises `…/IDEMPOTENCY_CONFLICT`), enforces totals reconciliation, and writes the CRITICAL `diaspora_import_audit_log` row with a SHA-256 `cryptographic_seal` **in the same transaction** (exact H1 audit-seal idiom: `encode(digest(actor||'|'||action||'|'||resource||'|'||resource_id||'|'||ts,'sha256'),'hex')`).
- Grants: `REVOKE ALL ON FUNCTION … FROM PUBLIC;` then `GRANT EXECUTE … TO service_role;` (and `authenticated` only where the phase1b helpers do). Same `DO $grant$ … IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')` guard as H1.
- Comment header notes: "Additive and backwards-compatible. NOT applied to production by this program. Sandbox-only; live payment disabled."

---

## 6. Milestone state machine (authoritative, reviewed)

```
DRAFT → PENDING → INTENT_CREATED → AUTHORIZED → CAPTURED → RELEASE_REQUESTED → RELEASE_APPROVED → RELEASED
                                        │            │              │
                                        ├─ CANCELLED ┤              ├─ (HIGH-risk: approval mandatory)
                                        └────────────┴─ REFUNDED / PARTIALLY_REFUNDED
any non-terminal → ON_HOLD / DISPUTED / WAIVED / FAILED  (with audited reason; DISPUTED blocks release)
```

Terminal: `RELEASED`, `REFUNDED`, `CANCELLED`, `WAIVED`. `RELEASE_APPROVED→RELEASED` is the only path that calls provider `release`; it requires a reviewer/admin actor for HIGH-risk types. The transition table is a frozen constant (`SAFETRADE_MILESTONE_TRANSITIONS`) in `diasporaSafeTradeConstants.js` and is the single source the RPC and the service both reference (the `IMPORT_ORDER_TRANSITIONS`/`diasporaWorkflowService` pattern).

---

## 7. Test surface (design — files the implementer adds, not mounted/integration-owned)

`backend/tests/diaspora-safetrade-payment.test.js` (node `--test`), mirroring `diaspora-drive.test.js`/billing tests: sandbox determinism; provider idempotent replay; illegal-state rejection; webhook HMAC verify (valid/invalid/expired/missing-timestamp); webhook replay rejection via unique `event_id`; totals reconciliation pass/fail; HIGH-risk release requires reviewer even with zero blockers; **live provider throws `EXTERNAL_ACTIVATION_REQUIRED`**; `assertSafeTradePaymentSafety` fails closed when live enabled without approved provider; entitlement guard no-op when enforcement off and ForbiddenError when on; audit-write-failure rolls back the transition (RPC rollback test like H1).

---

## 8. File manifest (paths returned for the integrator)

New (created by implementer, none mounted/edited by me):
- `backend/constants/diaspora/diasporaSafeTradeConstants.js` — flags, enums, transition table, webhook secret, fail-closed asserts.
- `backend/services/diaspora/safetrade/safeTradePaymentProvider.js` — `PaymentProvider` interface, `SandboxPaymentProvider`, `LivePaymentProvider` (throws `EXTERNAL_ACTIVATION_REQUIRED`), `selectPaymentProvider`, shared singleton.
- `backend/services/diaspora/diasporaSafeTradeMilestoneService.js` — milestone CRUD/plan/release/refund/reconcile over `diaspora_payment_milestones`, entitlement-gated `SAFETRADE_CREATE`, audit via `diasporaServiceUtils`.
- `backend/routes/diasporaSafeTradeRoutes.js` — NEW route file, **unmounted** (integrator mounts); webhook + milestone endpoints.
- `database/migrations/<ts>_diaspora_safetrade_payment_milestones.sql` — additive ALTERs + `diaspora_safetrade_payment_events` + 3 atomic RPCs (NOT applied).
- `backend/tests/diaspora-safetrade-payment.test.js`.

Files reused/connected (NOT edited): `backend/services/diaspora/diasporaServiceUtils.js`, `diasporaAuditService.js`, `diasporaAuthorization.js`, `diasporaEntitlementGuard.js` + `diasporaEntitlementService.js` (`FEATURE_KEYS.SAFETRADE_CREATE`), `diasporaWorkflowService.js` (order-state coupling), existing `diaspora_payment_milestones` table (`database/migrations/013_diaspora_trade_schema.sql`), `diaspora_trade_documents`/`diaspora_compliance_reviews`/`diaspora_shipment_stage_events` (release-trigger evidence), `domain_events` outbox (reputation-eligibility event).

Reference patterns cited: provider abstraction → `backend/services/diaspora/billing/billingProvider.js`, `backend/services/diaspora/drive/googleDriveProvider.js`; atomic RPC + idempotency + in-txn CRITICAL audit + Up/Down + REVOKE-PUBLIC/GRANT-service_role → `database/migrations/20260621090000_diaspora_h1_stock_movement_rpc.sql`; RLS helper `diaspora_trade_os_can_access_row` + SECURITY DEFINER + `SET search_path='public'` + grant model → `database/migrations/20260611061849_diaspora_trade_os_phase1b_foundation.sql`; HMAC + anti-replay + duplicate-reference idempotency webhook → `backend/services/payment/paymentRouter.js`; fail-loud vs fail-silent audit → `backend/services/diaspora/diasporaServiceUtils.js`.

---

**Key invariants enforced by this design:** real money disabled behind `DIASPORA_SAFETRADE_LIVE_PAYMENT` (default OFF, fail-closed); whole feature behind `DIASPORA_SAFETRADE_ENABLED` (default OFF); sandbox-only provider for all money operations with the live path throwing `EXTERNAL_ACTIVATION_REQUIRED`; HIGH-risk release requires reviewer/admin even when automated conditions pass; no auto compliance/shipment/delivery/reputation; milestone totals reconcile to the transaction total; every critical milestone transition fails atomically if its audit row cannot be written; webhook events are HMAC-verified, anti-replay-bounded, and idempotently de-duped via a unique stored-event key.

---

## E. Build stage 1 report (schema + state-machine constants — DONE on disk)

Everything verifies. The git status confirms only the three new files were created — no integration-owned or other-track files touched. The new route file was intentionally not created at this stage (the build directive for Stage 1 is schema + state machine; the route file is a separate later build task per §8/§9 of the designs, and the directive's "Create:" list for this stage contains only the migration + two constants files).

All artifacts pass. Final report below.

---

BUILD STAGE 1 COMPLETE — SafeTrade schema + state machine (Phase 9). All work inside the worktree `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10`. No DB applied, no network/provider called, no integration-owned or other-track files touched.

## Files created (absolute paths)
1. `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaSafeTradeStatuses.js` — 16-state enum, 22 transition events, full frozen transition table, terminal/escape-hatch/escrow-held sets, risk tiers, derived adjacency map, pure helpers (`getTransition`, `canDispatch`, `assertDispatchAllowed`, `isTerminal`, `isEscapeHatch`, `isEscrowHeld`, `nextStates`). Pure data, no DB/network imports.
2. `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/backend/constants/diaspora/diasporaSafeTradeConstants.js` — env flags `isSafeTradeEnabled()` (DIASPORA_SAFETRADE_ENABLED, default OFF), `isSafeTradeLivePaymentEnabled()` (DIASPORA_SAFETRADE_LIVE_PAYMENT, default OFF), `assertSafeTradeProductionSafety()` (fail-closed throw), `shouldUseSandboxEscrow()`, `resolveSafeTradeProvider()`; milestone types/triggers, policy version `safetrade-policy-v1`, empty approved-live-providers list.
3. `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10/database/migrations/20260621130000_diaspora_phase9_safetrade.sql` — additive, `-- +migrate Up/Down`, 3 RLS-enabled tables + 2 atomic RPCs.

Note: the unmounted route file is a LATER build task (designs §8/§9); Stage 1's create-list was migration + two constants modules only. Not created here by design.

## node --check results
- `diasporaSafeTradeStatuses.js` — OK
- `diasporaSafeTradeConstants.js` — OK
- ESM import smoke test: 16 states / 22 transitions / 22 table entries; `canDispatch(PAYMENT_HELD, CANCEL)` correctly false (CANCEL forbidden from escrow-held, §4.1); illegal transition throws `SAFETRADE/INVALID_TRANSITION`; flags default false; `resolveSafeTradeProvider()` returns `sandbox`; live-without-approved-provider throws.

## Migration sanity grep results (all PASS)
- `-- +migrate Up` line 1, `-- +migrate Down` line 650 — both present.
- `ENABLE ROW LEVEL SECURITY` ×3 (one per new table).
- `REVOKE ALL ... FROM PUBLIC` on all 3 tables + both functions.
- `GRANT ... TO authenticated` (SELECT/INSERT/UPDATE; evaluations append-only = no UPDATE) and `GRANT ... TO service_role` (ALL) present.
- RPCs: `SECURITY DEFINER` + `SET search_path = 'public'` ×2.
- `diaspora_trade_os_can_access_row` used in all 3 RLS policies (7 references total).
- NEGATIVE `GRANT ... TO PUBLIC` — NONE (good).
- Function EXECUTE grants → `service_role` only; no `GRANT EXECUTE ... authenticated`.
- Fail-closed twice: table `CHECK (live_payment = false)` + RPC `RAISE EXCEPTION 'DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED'`.
- In-txn CRITICAL audit inserts into `diaspora_import_audit_log` ×2 (one per RPC).
- Each RPC signature appears exactly 4× (CREATE/REVOKE/GRANT/DROP) — consistent.
- Down drops 2 functions then 3 tables (dependency-safe).
- Verified base-schema columns referenced all exist: `diaspora_import_orders(id, buyer_id)`, `diaspora_import_quotes(id)`, `diaspora_payment_milestones(id)`, and `diaspora_import_audit_log` columns (import_order_id, tenant_id, actor_id, action, resource_type, resource_id, previous_state, new_state, metadata, cryptographic_seal).

## Exact names for the next stage to build services against

Tables:
- `public.diaspora_safetrade_transactions` — cols: `id, tenant_id, import_order_id, accepted_quote_id, buyer_id, seller_id, currency, total_amount numeric(14,2), status, payment_provider, live_payment, policy_version, reviewer_id, reviewed_at, initiated_at, settled_at, idempotency_key, metadata, created_by, updated_by, created_at, updated_at, deleted_at`. status CHECK: `DRAFT, INITIATED, FUNDS_PENDING, FUNDS_HELD, IN_PROGRESS, RELEASE_REVIEW, RELEASE_AUTHORIZED, SETTLED, DISPUTED, REFUND_REVIEW, REFUNDED, CANCELLED`.
- `public.diaspora_safetrade_milestones` — cols: `id, tenant_id, transaction_id, import_order_id, legacy_payment_milestone_id, milestone_type, sequence, amount numeric(14,2), currency, payer, payee, due_trigger, release_trigger, status, evidence_requirements jsonb, evidence_refs jsonb, provider_reference, provider_status, idempotency_key, released_by, released_at, due_at, metadata, created_by, updated_by, created_at, updated_at, deleted_at`. status CHECK: `PENDING, DUE, FUNDS_PENDING, FUNDED, HELD, RELEASE_REVIEW, RELEASE_AUTHORIZED, RELEASED, WAIVED, REFUND_REVIEW, REFUNDED, CANCELLED, FAILED`. milestone_type CHECK: `DEPOSIT, PROGRESS, SHIPMENT, CUSTOMS_DUTY, DELIVERY, RELEASE, INSURANCE, FEE, REFUND`.
- `public.diaspora_safetrade_release_evaluations` — cols: `id, tenant_id, transaction_id, milestone_id, eligible, blockers jsonb, evidence_refs jsonb, requires_reviewer, risk_level, policy_version, evaluated_by, evaluated_at, metadata, created_by, updated_by, created_at, updated_at, deleted_at`. risk_level CHECK: `LOW, MEDIUM, HIGH`. Append-only (no UPDATE grant to authenticated).

RPCs (service_role EXECUTE only):
- `public.diaspora_safetrade_transition_atomic(p_transaction_id uuid, p_milestone_id uuid, p_actor_id text, p_tenant_id uuid, p_actor_is_privileged boolean, p_target_status text, p_evaluation_id uuid DEFAULT NULL, p_payment_provider text DEFAULT 'sandbox', p_live_payment boolean DEFAULT false, p_idempotency_key text DEFAULT NULL, p_reason text DEFAULT NULL, p_metadata jsonb DEFAULT '{}', p_correlation_id text DEFAULT NULL, p_source text DEFAULT 'ui') RETURNS jsonb` — returns `{ transaction, milestone, idempotentReplay }`. Error codes: `DIASPORA_SAFETRADE/{UNAUTHENTICATED, TARGET_REQUIRED, NOT_FOUND_TXN, NOT_FOUND_MILESTONE, MILESTONE_NOT_IN_TXN, FORBIDDEN, IDEMPOTENCY_CONFLICT, INVALID_TRANSITION, EXTERNAL_ACTIVATION_REQUIRED, REVIEWER_REQUIRED, EVALUATION_REQUIRED, NOT_ELIGIBLE, POLICY_VERSION_MISMATCH}`.
- `public.diaspora_safetrade_record_milestone_atomic(p_transaction_id uuid, p_actor_id text, p_tenant_id uuid, p_actor_is_privileged boolean, p_milestones jsonb, p_idempotency_key text DEFAULT NULL, p_correlation_id text DEFAULT NULL, p_source text DEFAULT 'ui') RETURNS jsonb` — milestone element keys: `milestoneType, sequence, amount, currency, payer, payee, dueTrigger, releaseTrigger, evidenceRequirements, legacyPaymentMilestoneId, idempotencyKey`. Returns `{ transaction, milestones, reconciliation:{total,sum,reconciled}, idempotentReplay }`. Error codes: `DIASPORA_SAFETRADE/{UNAUTHENTICATED, MILESTONES_REQUIRED, NOT_FOUND_TXN, FORBIDDEN, MILESTONES_LOCKED, INVALID_AMOUNT, CURRENCY_MISMATCH, TOTALS_UNRECONCILED}`.

Audit (reused `diaspora_import_audit_log`): actions `SAFETRADE_<TARGET_STATUS>` and `SAFETRADE_MILESTONES_DEFINED`; resource_type `diaspora_safetrade_transaction` / `diaspora_safetrade_milestone`; sealed SHA256 in-txn.

State-machine module exports for the service: `SAFETRADE_STATES, SAFETRADE_TRANSITIONS, SAFETRADE_TERMINAL_STATES, SAFETRADE_ESCAPE_HATCH_STATES, SAFETRADE_ESCROW_HELD_STATES, SAFETRADE_RISK_TIERS, SAFETRADE_DISPUTE_RESTRICTIONS, SAFETRADE_TRANSITION_TABLE, SAFETRADE_STATE_ADJACENCY, getTransition, canDispatch, assertDispatchAllowed, isTerminal, isEscapeHatch, isEscrowHeld, nextStates`. Constants module exports: `SAFETRADE_PAYMENT_PROVIDERS, SAFETRADE_APPROVED_LIVE_PROVIDERS, SAFETRADE_POLICY_VERSION, SAFETRADE_EXTERNAL_ACTIVATION_ERROR, SAFETRADE_MILESTONE_TYPES, SAFETRADE_DUE_TRIGGERS, SAFETRADE_RELEASE_TRIGGERS, SAFETRADE_RECONCILIATION_TOLERANCE, isProduction, isSafeTradeEnabled, isSafeTradeLivePaymentEnabled, configuredSafeTradeProvider, assertSafeTradeProductionSafety, shouldUseSandboxEscrow, resolveSafeTradeProvider`.

Non-negotiables N1–N7 enforced: money edges carry `moneyMovement`+`liveGate` and the RPC throws `EXTERNAL_ACTIVATION_REQUIRED` for live/non-sandbox (N1/N7); `COMPLIANCE_PASS` is REVIEWER/ADMIN-only requiring `compliance.humanApproved` (N2); `CONFIRM_DELIVERY` requires buyer/reviewer (N3); `RELEASE_ESCROW` emits `DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE` event only, no reputation write (N4); release/refund authorization requires privileged actor + eligible evaluation row, `IF_HIGH_RISK` reviewer approval (N5); all critical edges write audit inside the txn and roll back on failure (N6); both env flags default OFF, fail-closed (N7).

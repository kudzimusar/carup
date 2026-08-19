# Phase 6 transaction authority — certification candidate

Status: **ACTIVE / CANDIDATE — NOT CERTIFIED**

Parent certified Phase 5 SHA: `119aaa9bfcbb38942e5fc9acdc9bbda09a443ce3`.

Phase 6 is the server-authority closure for the chain:

```text
inquiry
  -> resolved buyer + current seller
  -> transaction intent
  -> canonical eligibility
  -> atomic reservation
  -> deposit eligibility
  -> PaymentProvider state
  -> inspection / release governance
  -> settlement | refund | cancellation
```

This document records the current candidate. It does **not** claim Phase 6 PASS. Final certification
must pin one exact head after CI, PostgreSQL proof, mutation/independent review and merged-tree
reconciliation.

## 1. Authority boundary now implemented

### Buyer / seller / inquiry

- buyer identity comes only from authenticated `userContext`;
- seller authority is `vehicles.current_seller_id` only — `owner_id` is never a seller fallback;
- a transaction requires a current, clear `vehicle_purchase_interest` inquiry binding the same
  VIN + buyer + current seller;
- buyer and seller must be distinct;
- stale/changed seller or inquiry lineage fails closed.

### Listing economics

- transaction amount comes from the listing row;
- currency is usable only with recognised `currency_source` provenance;
- the server snapshots amount/currency/source and a mutable-listing hash on the canonical
  `escrow_trust_sessions` row;
- the browser cannot choose amount, currency, seller, listing snapshot or idempotency identity.

### Eligibility

- Trust/identity/publication/fraud/evidence inputs come from canonical server reads;
- seller posture, participant authority and snapshot continuity are server-resolved transaction
  facts, not request booleans;
- missing/unknown gate evidence fails closed;
- gates are recomputed before initiation and release approval.

### State authority

Clients request named actions; they do not submit canonical transaction states.

Provider-neutral canonical states are:

```text
not_requested
pending_eligibility
eligible
initiated
funds_held
inspection_pending
release_approved
settled
disputed
refunded
cancelled
failed
```

Historical `funded_sandbox` / `released_sandbox` / `refunded_sandbox` values remain readable for
forward compatibility but new Phase 6 writes use provider-neutral states.

Authority is partitioned deliberately:

- **buyer** — may initiate its own eligible transaction;
- **participants** — may request cancellation/dispute where the state graph permits;
- **reviewer/admin** — owns release approval;
- **CarUp internal system/reviewer** — owns inspection/failure orchestration;
- **PaymentProvider/provider reconciliation** — owns provider-confirmed money states such as
  captured/held, released/settled, refunded and provider cancellation.

A provider/webhook cannot assert CarUp's `release_approved` governance state. A human/admin cannot
assert `funds_held`, `settled` or `refunded` without provider confirmation.

The generic direct-transition route and legacy direct SafePay status route fail closed.

## 2. Transaction and reservation persistence

The existing `escrow_trust_sessions` model remains the canonical transaction intent. No competing
Marketplace payment model was created.

Reservation authority is `vehicle_reservations`, not `vehicles.status`. The vehicle columns
`status`, `reserved_at`, `reserved_until` and `active_reservation_id` are materialized cache fields.

Reservation creation is PostgreSQL-atomic and proves:

- transaction intent exists and is eligible;
- authenticated actor is the transaction buyer;
- current seller still matches the transaction;
- current purchase inquiry still matches buyer/seller/VIN;
- publication is still governed/published;
- amount/currency/provenance still match the snapshotted transaction;
- only one active reservation may exist per VIN;
- retry is idempotent and cannot extend an existing hold;
- competing buyers cannot steal the active reservation.

### Expiry rule

A clock-expired reservation may become publicly available automatically **only before a provider
intent exists**. If a provider intent has been linked, clock expiry is not proof that a payment
authorization vanished. That state is `inconsistent` / manual-provider-reconciliation required,
never fabricated availability.

A read does not mutate expiry. Public reservation projection evaluates `expires_at` against current
time and reports one of exactly:

```text
active | expired | none | unavailable | inconsistent
```

`unavailable` and `inconsistent` carry `reserved: null`, not false.

Marketplace list and listing detail use the same projection. The list uses one batch reservation
read plus at most one transaction-enrichment read for elapsed active holds, avoiding N+1 queries.
No public reservation projection contains reservation id, transaction id, buyer/seller id, provider
or provider-intent identity.

## 3. Deposit policy and provider boundary

Deposit eligibility is server-derived after a fresh transaction-gate and active-reservation check.
The current policy is versioned as `marketplace-deposit-1.0.0`; the current supported synthetic
policy is USD 500. Unsupported currency fails closed rather than being converted/defaulted.

The browser cannot choose:

- provider;
- provider mode;
- payment intent id;
- payer/payee;
- deposit amount/currency;
- payment state.

Marketplace reuses the existing SafeTrade `PaymentProvider` abstraction. It does not create a
second payment-provider stack.

Provider-linked cancellation also goes through the bound PaymentProvider first; only a confirmed
provider `cancelled` result is reconciled into the canonical transaction. Post-capture reversal is
refund, not client cancellation.

Payment settlement may mark the listing Sold and complete its reservation cache, but it does **not**
rewrite legal `owner_id` or create ownership history. Payment confirmation is not title/registry
proof.

## 4. Payment capability registry — Phase 6B/6C

A payment-specific capability plane now sits above the existing provider control plane. The existing
`providerPlatform/providerRegistry.js` remains the authority for credentials references, activation
mode, health and kill switch; the payment registry answers only what payment behaviour has actually
been proven.

Canonical capability vocabulary:

```text
collect_payment
authorize_hold
capture
refund
partial_refund
cancel
retrieve_status
payout_to_seller
split_payment
regulated_escrow
delayed_release
webhook_verify
webhook_replay_resistant
polling_fallback
```

Critical semantics:

- candidate jurisdiction is discovery metadata, never support evidence;
- `supported_countries/currencies/methods = null` means unknown;
- capability `null` means unknown;
- collection does not imply regulated escrow, delayed release, split payment or payout;
- automated routing additionally requires an existing provider-control-plane row with escrow
  capability, kill switch off, automated activation mode and healthy state.

The deterministic SafeTrade sandbox is `test_only` and is the only currently proven callable
adapter. It explicitly does **not** claim regulated escrow or split-payment capability.

ContiPay, Paynow, PayPal, Stripe, Pesapal, Peach Payments, Stitch, Selcom and PayChangu remain
`candidate_unverified`; their support/legal/capability fields remain unknown. Even a healthy
kill-switch-off control-plane row cannot make one callable until test evidence records the missing
capabilities.

`SAFETRADE_APPROVED_LIVE_PROVIDERS` remains empty. No real-money rail is activated by Phase 6.

The existing SafeTrade sandbox provider already proves bad-signature rejection and idempotent
provider-event handling. Marketplace currently uses provider status reconciliation; a future adapter
that requires callbacks consumes the same `verifyWebhook` / `reconcileEvent` provider contract
rather than inventing a Marketplace webhook protocol.

## 5. Finance truth

The compatibility `/api/finance/pre-approve` URL is retained, but its semantics are corrected:

- `customerId` is ignored; applicant comes from authenticated context;
- selected lender must resolve to a real bank-role user;
- requested amount is an applicant request and is bounded by the current listing price;
- requested currency/source are server-resolved from the listing;
- submission status is `Pending`;
- no invented income, debt, fallback Trust score, APR or monthly payment is used to auto-approve;
- Approved/Rejected/Disbursed decisions require an attributable lender/platform decision source and
  timestamp;
- Approved/Disbursed require explicit lender APR and positive monthly payment terms;
- lender list reads canonical Trust cache/projection and its lifecycle/version, not raw unversioned
  `vehicles.trust_score`.

## 6. Legacy route containment

Historical inline handlers still exist in `backend/server.js`, but the canonical routers are mounted
first and terminate the same URLs before those handlers can execute. Permanent guards pin this route
order and prove that compatibility handlers do not read browser seller/amount/currency/customer/duration
truth.

This is **strict containment**, not a claim that the historical source has been physically deleted.
The large web compatibility hook also still carries obsolete authority-shaped function signatures;
the server ignores those fields. This remains a source-cleanup finding for certification and should
be removed when it can be done surgically without broad frontend churn. It is not permitted to
justify weakening the backend boundary.

Mobile escrow has already converged to the canonical participant-scoped transaction list and named
actions; it no longer computes Pending → Escrowed → Inspecting → Completed or exposes a client-side
"Release Funds" state machine.

## 7. Auth/grants plane

Transaction/reservation tables are service-only from the first Phase 6 migration onward. There is no
intermediate `authenticated SELECT` window.

The accumulated migration chain revokes direct `anon`/`authenticated` access to:

- `escrow_trust_sessions`;
- `escrow_trust_events`;
- `escrow_trust_webhook_events`;
- `vehicle_reservations`.

Backend participant-scoped projections are the read path.

## 8. Phase 6 migration chain — authored, unapplied

In dependency order:

1. `20260819100000_issue164_phase6_transaction_terms.sql`
2. `20260819110000_issue164_phase6_atomic_reservations.sql`
3. `20260819120000_issue164_phase6_deposit_payment_lifecycle.sql`
4. `20260819121000_issue164_phase6_atomic_session_actions.sql`
5. `20260819122000_issue164_phase6_atomic_transaction_intent.sql`
6. `20260819123000_issue164_phase6_finance_truth.sql`
7. `20260819124000_issue164_phase6_reservation_expiry_reconciliation.sql`
8. `20260819125000_issue164_phase6_provider_reconciliation_hardening.sql`

**None has been applied to staging or production.**

The chain is intentionally forward-only. It contains atomic DB authority for transaction intent,
reservation, human/server actions, deposit eligibility, payment linkage, provider reconciliation and
safe pre-payment expiry reconciliation.

## 9. PostgreSQL and regression evidence in the candidate

The blocking backend test glob (`node --test backend/tests/*.test.js`) discovers the Phase 6 tests.
The Phase 6 suite includes:

- seller/inquiry/economic authority guards;
- no client state/idempotency/gate authority;
- provider-vs-governance state partition;
- real PostgreSQL reservation race/idempotency proof;
- full ordered Phase 6 migration-chain proof on PGlite/PostgreSQL semantics;
- true audit from-state on eligibility/payment reconciliation;
- payment-linked expiry fail-closed proof;
- legal ownership non-mutation on settlement;
- finance request-vs-decision provenance proof;
- SafeTrade capability registry and live-provider freeze;
- provider-linked cancellation proof;
- Marketplace list/detail reservation convergence and no-N+1 proof;
- shared/mobile public reservation-contract proof;
- event-side-effect containment so the event bus is not a second transaction writer.

The repository's generic migration PGlite checker still has its historical fixed-list limitation, but
Phase 6 cannot pass vacuously through it because the ordered Phase 6 migration chain is executed by a
dedicated test under the blocking backend glob.

## 10. Remaining gates before Phase 6 PASS

Phase 6 remains **NOT CERTIFIED** until all of the following are true on one exact final head:

1. GitHub blocking CI completes green. Runner capacity/queued state is not a pass.
2. The full PostgreSQL Phase 6 chain executes green on that exact head.
3. Fresh independent review/certification is performed; the implementer does not certify its own
   implementation.
4. A mutation battery demonstrates the authority boundaries fail when deliberately regressed.
5. The exact candidate is reconciled against current `main` / PR merged-tree result.
6. Any certification finding about the stale web compatibility signatures is dispositioned without
   weakening server authority.

Only after those source gates pass does the programme perform the **single controlled staging truth
cutover**: positive staging-ref verification, before-state receipts, ordered accumulated migrations,
compatible deployment, canonical Trust refresh through its single writer, grant/RLS checks and
post-cutover receipts.

Phase 7 Golden vehicles remain blocked until that cutover completes.

No production action, real-money activation, staging DB write or merge is authorized by this document.

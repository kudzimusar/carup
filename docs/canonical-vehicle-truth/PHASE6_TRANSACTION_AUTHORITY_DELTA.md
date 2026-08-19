# Phase 6 transaction authority — certification candidate

Status: **ACTIVE / CANDIDATE — NOT CERTIFIED**

Parent certified Phase 5 SHA: `119aaa9bfcbb38942e5fc9acdc9bbda09a443ce3`.

Phase 6 is the server-authority closure for:

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

This document records the current candidate contract. It does **not** claim Phase 6 PASS. Final
certification must pin one exact head after blocking CI, ordered PostgreSQL proof, targeted mutation
proof, fresh independent review and merged-tree reconciliation.

## 1. Canonical transaction authority

### Buyer / seller / inquiry

- buyer identity comes only from authenticated `userContext`;
- seller authority is `vehicles.current_seller_id` only — `owner_id` is never a seller fallback;
- a transaction requires a current, clear `vehicle_purchase_interest` inquiry binding the same
  VIN + buyer + current seller;
- buyer and seller must be distinct;
- stale/changed seller or inquiry lineage fails closed.

### Listing economics and immutable transaction snapshot

- transaction amount comes from the listing row;
- currency is usable only with recognised `currency_source` provenance;
- the browser cannot choose amount, currency, seller, listing snapshot or transaction idempotency;
- the immutable listing snapshot contains seller/listing truth, not transaction-owned cache state;
- `vehicles.status` and broad `updated_at` are deliberately excluded from the immutable snapshot, so
  the reservation side effect (`Available -> Reserved`) cannot invalidate the transaction that caused it;
- seller, publication or listing-economic changes still change the snapshot.

### Eligibility

- Trust/identity/publication/fraud/evidence inputs come from canonical server reads;
- seller posture, participant authority and snapshot continuity are server-resolved transaction
  facts, not request booleans;
- missing/unknown gate evidence fails closed;
- gates are recomputed before initiation and release approval;
- participant actions require the recorded buyer/seller actor; governance rechecks preserve the
  buyer/seller/current-inquiry lineage without pretending a reviewer is a transaction participant.

## 2. State and reservation authority

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
forward compatibility; new Phase 6 writes use provider-neutral states.

Authority is partitioned:

- **buyer** — may initiate its own eligible transaction;
- **participants** — may request cancellation/dispute where the graph permits;
- **reviewer/admin** — owns release approval;
- **CarUp internal system/reviewer** — owns inspection/failure orchestration;
- **PaymentProvider/provider reconciliation** — owns provider-confirmed money states such as
  captured/held, released/settled, refunded and provider cancellation.

A provider cannot assert CarUp's `release_approved` governance state. A human/admin cannot assert
`funds_held`, `settled` or `refunded` without provider confirmation. Internal `system` is not payment
provider authority.

The generic direct-transition route and legacy direct SafePay status writer fail closed. Legacy
payment-gateway / duplicate SafePay paths are being retired or terminated behind the canonical
router rather than preserved as a second transaction universe.

### Reservation persistence and expiry

`vehicle_reservations` is reservation authority. `vehicles.status`, `reserved_at`, `reserved_until`
and `active_reservation_id` are materialized cache fields.

Reservation creation is PostgreSQL-atomic and checks the transaction, buyer, seller, current inquiry,
publication and snapshotted economics before creating or replaying one active hold.

A clock-expired reservation may become publicly available automatically **only before a provider
intent exists**. After provider linkage, wall-clock expiry is not proof that authorization vanished.
The hold remains active for provider reconciliation; public projection reports an explicit
inconsistent/unavailable posture instead of fabricated availability.

Marketplace list and listing detail consume the same public reservation projection. Private
reservation/transaction/participant/provider identifiers are not part of that projection.

## 3. Deposit and PaymentProvider boundary

Deposit eligibility is server-derived after a fresh transaction-gate and active-reservation check.
The current policy is versioned as `marketplace-deposit-1.0.0`; the current synthetic test policy is
USD 500. Unsupported currency fails closed rather than being silently converted/defaulted.

The browser cannot choose:

- provider or provider mode;
- provider intent id;
- payer/payee;
- deposit amount/currency;
- payment state.

Marketplace reuses the existing SafeTrade `PaymentProvider` abstraction. It does not create a
provider-specific transaction architecture.

### Durable synthetic sandbox

SafeTrade's historical `SandboxPaymentProvider` is process-local and remains appropriate for
isolated unit tests. A process-local Map is **not** used as persisted Marketplace payment authority.

Marketplace selects `DurableSandboxPaymentProvider` for synthetic test/staging transactions. That
adapter implements the existing `PaymentProvider` contract through the service-role-only PostgreSQL
sandbox ledger created by migration `1260`:

- `safetrade_sandbox_payment_intents` — durable synthetic provider intent/state;
- `safetrade_sandbox_payment_operations` — durable provider-operation idempotency/results;
- `issue164_sandbox_payment_action_atomic(...)` — serialized create/authorize/capture/release/
  refund/partial-refund/cancel/retrieve provider operation.

The durable sandbox is still synthetic and returns `live:false`. It does not claim regulated escrow
or real-money movement. `anon`/`authenticated` have no direct table/function authority.

Sandbox selection is fail-closed outside test/development/preview/staging. Deployment-specific
signals outrank weaker flags: an explicit Vercel production deployment cannot be reopened by a stale
`CARUP_ENV=staging` or development setting.

A governed UAT action exists at:

```text
POST /api/escrow/:id/sandbox/capture
```

It is runtime-gated to non-production environments, accepts no browser-authored provider state, and
may be used by the transaction buyer (or platform admin for controlled UAT) to drive the already-bound
synthetic provider through authorization/capture. Provider state is then reconciled through the same
canonical payment-state RPC as other adapters. Production returns the action unavailable before any
provider/transaction mutation.

Provider-linked cancellation also resolves the same durable Marketplace provider selector; it does
not fall back to the process-local sandbox on a new serverless worker.

## 4. Settlement serialization before provider payout

Release approval and provider payout are two authorities. The critical ordering is now:

```text
reviewer release approval
  -> PostgreSQL settlement operation claim
  -> provider.release(idempotency key)
  -> provider-confirmed released
  -> canonical reconciliation to settled
```

`issue164_begin_settlement_atomic(...)` locks the transaction/reservation/vehicle before provider
release and requires:

- reviewer/admin authority;
- `release_approved` transaction state;
- attributable captured provider funds;
- active canonical reservation;
- current seller still matching the approved transaction at claim time.

The claim records the operation id, actor, approved seller and provider intent. While the claim is
pending, conflicting human status rewrites are blocked; refund is also rejected by the service until
provider release is reconciled. Provider retries use the same idempotency key.

A confirmed provider release is reconciled from this durable approved lineage rather than rechecking
mutable vehicle-seller state **after** provider money has moved. This prevents the failure mode where
a dispute/seller edit races the provider call, the provider releases, and CarUp then refuses to record
that attributable money truth.

Settlement may mark the listing Sold and complete its reservation cache, but it does **not** rewrite
legal `owner_id` or create ownership history. Payment confirmation is not title/registry proof.

## 5. Payment capability registry — Phase 6B/6C

The existing `providerPlatform/providerRegistry.js` remains the control plane for credential refs,
activation mode, health and kill switch. The payment capability registry answers only what payment
behaviour has actually been proven.

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
- automated external routing also requires an existing control-plane row with escrow capability,
  kill switch off, automated activation mode and healthy state.

The SafeTrade sandbox is `test_only` and explicitly does **not** claim regulated escrow or split
payment. ContiPay, Paynow, PayPal, Stripe, Pesapal, Peach Payments, Stitch, Selcom and PayChangu
remain `candidate_unverified`; candidate metadata alone cannot make them callable.

`SAFETRADE_APPROVED_LIVE_PROVIDERS` remains empty. No real-money rail is activated by Phase 6.
External sandbox/provider proof remains separately gated by owner credentials/provider access.

## 6. Finance truth

The compatibility `/api/finance/pre-approve` URL is retained, but:

- `customerId` is ignored; applicant comes from authenticated context;
- selected lender must resolve to a real bank-role user;
- requested amount is an applicant request bounded by current listing price;
- requested currency/source are server-resolved from the listing;
- submission status is `Pending`;
- no invented income, debt, fallback Trust score, APR or monthly payment auto-approves a request;
- every resulting Approved/Rejected/Disbursed row requires attributable decision source/time;
- Approved/Disbursed rows require explicit APR and positive monthly-payment terms even on same-status
  updates;
- lender list reads canonical Trust lifecycle/version rather than using raw unversioned
  `vehicles.trust_score` as decision truth.

## 7. Grants / browser isolation

From the first Phase 6 migration onward, direct `anon`/`authenticated` transaction-table access is
revoked. The accumulated candidate also keeps the durable synthetic provider ledger service-only.

The blocking proofs cover browser-role absence on:

- `escrow_trust_sessions`;
- `escrow_trust_events`;
- `escrow_trust_webhook_events`;
- `vehicle_reservations`;
- `safetrade_sandbox_payment_intents`;
- `safetrade_sandbox_payment_operations`.

Backend participant-scoped/public-safe projections are the read path.

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
9. `20260819126000_issue164_phase6_payment_operation_hardening.sql`

**None has been applied to staging or production.**

The chain is intentionally forward-only. Migration `1260` adds only the synthetic provider ledger,
settlement-operation claim/guard and the corresponding provider-reconciliation hardening. It does not
activate a real provider or authorize production money movement.

## 9. PostgreSQL / regression candidate evidence

The blocking backend test glob is `node --test backend/tests/*.test.js`; new Phase 6 `*.test.js`
files are therefore discovered without a fixed-file allow-list.

The candidate tests include:

- seller/inquiry/economic authority and no-browser-state guards;
- provider-vs-governance state partition;
- atomic reservation race/idempotency proof;
- full ordered nine-migration Phase 6 chain on PGlite/PostgreSQL semantics;
- true audit from-state on eligibility/payment reconciliation;
- payment-linked expiry fail-closed and late-provider reconciliation proof;
- durable sandbox create/replay/authorize/capture/retrieve/release proof through migration `1260`;
- settlement claim before provider release, dispute-race rejection and post-claim mutable-seller
  reconciliation proof;
- legal ownership non-mutation on settlement;
- finance request-vs-decision provenance proof;
- payment capability/live-provider freeze;
- provider-linked cancellation using the shared durable selector;
- non-production sandbox route/runtime guards;
- Marketplace list/detail reservation convergence and event-side-effect containment.

Targeted mutation guards are maintained only for discovered load-bearing failure classes. The ledger
must use unique labels; a mutation counts only when its anchor changes and the named invariant turns
red/non-safe relative to the clean candidate.

The generic repository migration checker still has its historical fixed-list limitation; Phase 6
does not rely on that harness for this chain because the dedicated blocking full-chain test executes
all nine migrations in dependency order.

## 10. Remaining gates before Phase 6 PASS

Phase 6 remains **NOT CERTIFIED** until all of the following are true on one exact final head:

1. blocking GitHub CI completes green; queued/running is not a pass;
2. the ordered nine-migration PostgreSQL proof is green on that exact head;
3. fresh independent review/certification is clean; the implementer does not self-certify;
4. targeted mutation guards for the current failure classes are green on the clean tree and kill
   their deliberate regressions;
5. the exact candidate is reconciled against current `main` / merged-tree result;
6. any external-provider sandbox proof requiring owner credentials is recorded honestly as either
   proven evidence or an explicit external credential/provider-access gate.

Only after those source gates close does the programme perform the **single controlled staging truth
cutover**: positive staging-ref verification, before-state receipts, ordered accumulated migrations,
compatible exact-head deployment, canonical Trust refresh through its single writer, grant/RLS checks
and post-cutover receipts.

Phase 7 Golden Reference Vehicles remain blocked until that cutover completes.

No production action, real-money activation, staging DB write or merge is authorized by this document.

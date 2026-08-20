# Phase 6 transaction authority — canonical closure contract

Status: **CONTRACT COMPLETE — exact-head certification is tracked in Issue #164 / PR #165**

Parent certified Phase 5 anchor: `119aaa9bfcbb38942e5fc9acdc9bbda09a443ce3`.

This document is the canonical Phase 6 transaction-authority contract. It deliberately does not
embed a mutable branch SHA or self-certify a changing head. The authoritative PASS/FAIL state must be
an exact-head receipt in Issue #164 / PR #165 after blocking CI, the accumulated PostgreSQL chain,
targeted mutation proof, fresh independent review and the governed behavioral UAT evidence required
by the programme.

Phase 6 closes the server-authority chain:

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

No production action, real-money activation or live provider enablement is authorized by Phase 6.

## 1. Canonical buyer, seller, inquiry and listing authority

- Buyer identity comes from authenticated CarUp `userContext`; browser `customerId` / buyer IDs are
  never transaction authority.
- Marketplace seller authority is `vehicles.current_seller_id`. `owner_id` is legal/historical
  ownership and is never a seller fallback.
- A transaction requires a current clear `vehicle_purchase_interest` inquiry binding the same VIN,
  buyer and current seller. Buyer and seller must be distinct.
- Listing amount, currency and currency provenance are resolved from the current governed listing.
  Browser values cannot override them.
- The immutable listing snapshot contains seller/listing truth only. Transaction-owned cache fields
  such as `vehicles.status` and broad `updated_at` are excluded so a successful reservation cannot
  invalidate its own transaction snapshot.
- Current publication, seller, inquiry lineage, Trust/evidence gates and snapshot continuity are
  recomputed server-side before consequential transaction actions. Missing/unknown authority fails
  closed.

## 2. State and reservation authority

Clients request named actions; they never submit canonical transaction/payment state.

Provider-neutral transaction states include:

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

Authority is partitioned:

- **buyer / participants** — initiation and participant actions permitted by the state graph;
- **reviewer/admin** — release approval and consequential financial governance;
- **CarUp internal orchestration** — non-money workflow actions where explicitly governed;
- **PaymentProvider reconciliation** — provider-confirmed captured, released, refunded and provider
  cancellation truth.

A provider cannot manufacture CarUp `release_approved`. A human/admin cannot manufacture
`funds_held`, `settled` or `refunded` without provider confirmation. Internal `system` is not provider
money authority.

`vehicle_reservations` is reservation authority; `vehicles.status`, `reserved_at`, `reserved_until`
and `active_reservation_id` are projections/cache. Reservation creation is PostgreSQL-atomic.

A wall-clock-expired reservation may become available automatically only before a provider intent is
linked. After provider linkage, clock expiry alone cannot erase the hold or admit a second buyer;
provider truth must reconcile first.

Direct generic escrow transitions, historical SafePay state writers and historical generic payment
webhooks fail closed behind the canonical transaction router.

## 3. Deposit and provider boundary

Deposit eligibility is server-derived from a fresh gate/reservation check. The current synthetic test
policy is versioned as `marketplace-deposit-1.0.0` and uses USD 500; unsupported currency fails
closed rather than being silently converted/defaulted.

The browser cannot choose provider, provider mode, provider intent ID, payer, payee, deposit amount,
currency or canonical payment state.

Marketplace reuses the existing SafeTrade `PaymentProvider` abstraction and capability/control plane.
Provider discovery metadata never upgrades a provider into verified support.

### Durable synthetic sandbox

Marketplace synthetic test/staging transactions use the PostgreSQL-backed
`DurableSandboxPaymentProvider`; persisted payment intent authority is not held in a process-local
Map. The sandbox remains synthetic/test-only and reports `live:false`.

`POST /api/escrow/:id/sandbox/capture` is:

- available only in governed non-production runtimes;
- **buyer-owned end to end** — there is no admin capture exception;
- unable to accept browser-authored provider state;
- required to recheck current transaction/listing/inquiry/gate authority before provider
  authorization/capture.

Explicit production deployment signals fail closed even if weaker environment flags are stale.

## 4. Consequential governance authentication

The ordinary local/test `x-user-id` fallback remains available only to development/test routes that
are not consequential money governance.

The following routes require a validated CarUp session through `authorizeSessionRole()` and never
accept the generic `x-user-id` fallback:

- `POST /api/escrow/:id/release/approve`
- `POST /api/escrow/:id/release`
- `POST /api/escrow/:id/release/recover`
- `POST /api/escrow/:id/refund`

The Phase 6 session-governance mutation guard must fail if the wrapper re-enables fallback or any of
those routes regresses to generic role authorization.

## 5. Settlement, refund and recovery serialization

Provider money calls are preceded by durable PostgreSQL operation claims.

Settlement ordering is:

```text
reviewer release approval
  -> durable settlement claim
  -> provider.release(idempotency key)
  -> provider-confirmed released
  -> canonical reconciliation to settled
```

Refund similarly claims the refund operation before calling the provider. Settlement and refund
claims are mutually exclusive while active.

Settlement recovery is not a blind claim-clear operation. It requires reviewer/admin authority and a
provider capable of authoritative `confirmNotReleased()` semantics:

1. CarUp establishes a durable settlement-recovery fence **before** querying provider status.
2. Release/retry is blocked while that fence is active.
3. Provider `released` truth wins and is reconciled to canonical settlement.
4. Recovery is permitted only from definitive attributable `captured` / NOT-RELEASED evidence with a
   provider confirmation reference.
5. Recovery provenance and closed-fence evidence are immutable.
6. A recovered operation may enter a newly governed refund or same-key re-claim only through the
   serialized database rules.

Settlement may close listing/reservation projections but **must not rewrite `vehicles.owner_id` or
create legal ownership history**. Payment is not title proof.

## 6. Provider capability contract

Canonical capability vocabulary includes:

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

The SafeTrade sandbox is `test_only` and does not claim regulated escrow or real-money movement.
ContiPay, Paynow, PayPal, Stripe, Pesapal, Peach Payments, Stitch, Selcom, PayChangu and other
candidates remain unverified until official provider/merchant/legal evidence proves the relevant
capabilities. Candidate jurisdiction metadata is not capability evidence.

`SAFETRADE_APPROVED_LIVE_PROVIDERS` remains empty for this Phase 6 programme. Missing external
credentials/provider access is an external evidence gate, never something to invent.

## 7. Finance truth

The compatibility `/api/finance/pre-approve` URL is retained, but it creates a governed application,
not a fabricated approval:

- applicant identity comes from authenticated context; browser `customerId` is ignored;
- selected lender must resolve to a real bank-role user;
- requested amount is bounded by current listing truth;
- listing currency/provenance are server resolved;
- initial application status is `Pending`;
- no invented income, debt, fallback Trust score, APR or monthly payment may auto-approve;
- every resulting Approved/Rejected/Disbursed row retains attributable decision source/time;
- Approved/Disbursed rows retain explicit APR and positive monthly-payment terms on every resulting
  terminal-row write.

## 8. Browser/database isolation

From the first Phase 6 migration onward, direct `anon` / `authenticated` access is revoked from the
transaction/event tables governed by the programme. Durable sandbox ledgers and financial RPCs remain
service-role only.

Blocking proofs cover at least:

- `escrow_trust_sessions`
- `escrow_trust_events`
- `escrow_trust_webhook_events`
- `vehicle_reservations`
- `safetrade_sandbox_payment_intents`
- `safetrade_sandbox_payment_operations`

Participant-scoped/public-safe backend projections are the read path.

## 9. Canonical Phase 6 migration chain — authored, unapplied

Dependency order:

1. `20260819100000_issue164_phase6_transaction_terms.sql`
2. `20260819110000_issue164_phase6_atomic_reservations.sql`
3. `20260819120000_issue164_phase6_deposit_payment_lifecycle.sql`
4. `20260819121000_issue164_phase6_atomic_session_actions.sql`
5. `20260819122000_issue164_phase6_atomic_transaction_intent.sql`
6. `20260819123000_issue164_phase6_finance_truth.sql`
7. `20260819124000_issue164_phase6_reservation_expiry_reconciliation.sql`
8. `20260819125000_issue164_phase6_provider_reconciliation_hardening.sql`
9. `20260819126000_issue164_phase6_payment_operation_hardening.sql`
10. `20260819127000_issue164_phase6_settlement_recovery.sql`
11. `20260819128000_issue164_phase6_payment_race_recovery.sql`
12. `20260819129000_issue164_phase6_settlement_recovery_fence.sql`

**None of these Issue #164 migrations is made a production action by this contract.** The controlled
staging truth cutover is a separate programme gate after source/schema certification and before Phase
7 Golden Reference Vehicles.

The final chain must be exercised in dependency order on PostgreSQL semantics. Migration 1290 must be
proven both in its focused settlement/recovery race harness and as the final member of the accumulated
`1000 -> 1290` Phase 6 chain.

## 10. Certification protocol

A Phase 6 PASS is valid only when the same exact candidate head has:

1. blocking GitHub CI green;
2. the accumulated `1000 -> 1290` PostgreSQL chain green;
3. focused settlement/refund/recovery and provider idempotency/race proofs green;
4. targeted mutation guards green on the clean candidate and red on their deliberate regressions;
5. fresh independent review with no blocking P0/P1;
6. exact-head behavioral UAT/evidence required by the programme, including legitimate-session money
   governance and legal-ownership non-mutation;
7. reconciliation against current `main` / merge result;
8. honest recording of any external-provider credential/access gate.

The committed document is the contract; the exact-head certification receipt belongs in Issue #164 /
PR #165 so it cannot become a misleading self-reference after a later branch commit.

## 11. Staging/production boundary

Before Phase 7, the programme still performs one controlled staging truth cutover: positively verify
the staging Supabase ref, record before-state receipts, preflight/apply the accumulated Issue #164
migrations in dependency order, deploy the compatible exact programme head, refresh Trust only
through the canonical writer, rerun grants/RLS/postconditions and record post-cutover receipts.

Production remains unchanged unless separately authorized. No live payout, live-provider activation,
Gemini activation or production write is authorized by Phase 6 closure.

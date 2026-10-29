# CARUP-PAY-01A — CarUp Japan direct-payment sandbox foundation (source-only)

**Programme:** CarUp Marketplace / SafeTrade Transaction Authority (separate DIRECT MERCHANT scope)
**Starting source parent:** `6af11ac67a8e62745d0e7db43ed859c5adcc0287`
**Accepted R3 product:** `78db685e43f8d2728c19e1c556d8fcbf84c30950`
**Branch:** `feat/carup-pay-01a-japan-stripe-sandbox-foundation`
**Release classification:** SOURCE CANDIDATE ONLY. Not physically certified. No Stripe account touched. No DB migration applied.

## A. Authority and exclusions

Dedicated CarUp Japan TEST merchant: `acct_1UVnGaEjgXqvlsJk`.
Primary/live CarUp account: `acct_1UVnDqIED7OE0eXN` — **not used**.
Other organisations and their Stripe credentials are outside scope.

This candidate does NOT enable live payments, validate legal merchant eligibility, approve international checkout, operate escrow, transfer to sellers, pay private sellers or dealers, assert vehicle transfer, invoice customers or change subscriptions. It does NOT activate the SafeTrade `delayed_release`, `payout_to_seller` or `regulated_escrow` capabilities.

PAY-01A uses a uniquely named `PAY-01A` test-only certification item at **JPY 100** (JPY is a zero-decimal currency); it is not a vehicle price, deposit, purchase or customer invoice. The backend derives the amount and currency. A browser cannot submit them. No Serena/Vezel/CAP/ownership state is read or written.

## B. Audit findings and reuse

| Source | Finding | PAY-01A action |
|---|---|---|
| `marketplacePaymentService.js` | Canonical Marketplace deposit eligibility, capture, refund and settlement rely on session/reservation lineage and Issue #164 RPCs | Untouched. No Stripe substitution in escrow provider selection |
| `marketplacePaymentProviderSelector.js` | SafeTrade's synthetic durable sandbox is separate and non-live | Untouched |
| `safeTradePaymentProvider.js`, `safeTradePaymentCapabilities.js` | Direct collection does not imply hold/delayed release/seller payout | No Stripe capability promotion |
| `testModeBillingProvider.js`, `billingProviderProfiles.js` | Subscription tests use Stripe-shaped billing requests only; not vehicle payment authority | Untouched; no subscription adapter reuse |
| `escrowTrustRoutes.js` | Legacy SafePay webhook returns 410; escrow requires canonical transaction authority | Untouched |
| `services/payment/paymentRouter.js` | Historical generic gateway webhook returns 410 | Untouched |
| `payment_transactions` / `011_phase6_schema.sql` | Existing backend-owned gateway tracking table with unique reference | Add columns + atomic functions to existing row, NO second money ledger |
| `20260619201406_production_access_containment.sql` | `payment_transactions` already denies direct anonymous/authenticated writes | Preserve and reassert containment |
| `backend/server.js`, `csrfMiddleware` | Global JSON parser comes before routes; exact raw capture and webhook CSRF exemption must be placed there | Add dedicated exact-path byte buffer and exception |

**Provider-control-plane audit:** `providerPlatform/providerRegistry.js` currently registers `government_source`, `insurance`, `finance` and `escrow` capability types. It has no direct merchant collection capability. PAY-01A therefore does not misregister a direct Stripe merchant as `escrow` or activate the SafeTrade provider registry; it remains an explicit sandbox-only backend feature gate pending a separately governed provider-control-plane extension.

**Boundary:** Provider events are recorded in `pay01a_stripe_event_receipts` only as signature-verified unique event evidence. The sole canonical *money state* is in `payment_transactions`. No `escrow_trust_sessions`, `safepay_escrows`, vehicle ownership or seller-settlement fields are written.

## C. Configuration (names ONLY; never commit values)

Local backend config:

- `CARUP_PAY01A_ENABLED` — must explicitly equal `true`; default is disabled
- `CARUP_PAY01A_STRIPE_ACCOUNT_ID` — must equal the dedicated sandbox account
- `CARUP_PAY01A_STRIPE_SECRET_KEY` — sandbox secret credential only
- `CARUP_PAY01A_STRIPE_WEBHOOK_SECRET` — exact Stripe CLI local listener signing secret
- `CARUP_PAY01A_RETURN_ORIGIN` — locally allowlisted HTTP origin (`localhost` or `127.0.0.1`)
- `CARUP_ENV` / `VERCEL_ENV` / `NODE_ENV` — all must satisfy nonproduction runtime gates
- Existing backend `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must target a governed isolated local/test database, NEVER production

Keys must be entered directly into secure local configuration by the Owner, without sharing keys via chat, source, PR, screenshots or logs. Never set this flag in live deployments.

The official Stripe Node SDK is locked in backend/package.json and the workspace/backend package locks. There is no SDK call unless explicitly enabled by environment and the correct account is verified through a real Stripe account read.

## D. HTTP contract

All non-webhook routes require an authenticated, session-verified `admin` user. An asserted `x-user-id` or client-provided role cannot authorize.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/pay01a/checkout` | Atomic record claim, provider account identity check, idempotent Checkout; requires `Idempotency-Key` 16–96 allowed chars |
| GET | `/api/pay01a/:reference` | Fresh provider retrieval; payment status from provider, not redirect |
| POST | `/api/pay01a/:reference/reconcile` | Explicit fresh reconciliation (for interrupted returns, webhook gaps) |
| POST | `/api/pay01a/:reference/refund` | Atomic refund claim, provider idempotency and fresh refund reconciliation |
| POST | `/api/pay01a/stripe/webhook` | Raw-byte Stripe signature verification then account check then authoritative retrieval; no CSRF cookie needed |

Source-only route examples (no credential values):

```sh
# After approval, local migration and secure configuration:
npm ci
node --test backend/tests/pay01a-stripe-sandbox-foundation.test.js

# The authenticated admin client supplies its existing session and CSRF credentials.
# POST /api/pay01a/checkout with a stable 16–96 char Idempotency-Key.
# The server returns a hosted Checkout URL; the frontend NEVER decides payment status.
```

Payment initiation provides the `reference` in `client_reference_id`, Checkout metadata and PaymentIntent metadata. The returned hosted URL is a navigation destination only. A success/cancel URL has no authority to mark money as paid.

## E. Database implementation and rollback

An **unapplied** migration `20261029181000_carup_pay01a_stripe_sandbox.sql`:

1. extends existing `payment_transactions` with a caller-scoped idempotency key, verified merchant account, Checkout session, PaymentIntent and refund references;
2. adds unique indexes for request, Checkout and PaymentIntent;
3. adds append-only unique provider **event receipts** (not a second payment ledger);
4. adds server-only `pay01a_claim_checkout`, `pay01a_attach_checkout`, `pay01a_apply_provider_snapshot` and `pay01a_begin_refund` RPCs;
5. refuses incompatible canonical reference/account/economics, cross-event replay, status regressions and concurrent refund duplication;
6. reasserts RLS and `service_role`-only RPC execution.

**Do not run against live or shared canonical staging without explicit migration review and authorization.** A destructive automatic DOWN migration is deliberately refused: transaction evidence must not be erased. A rollback requires a separately reviewed retention plan.

## F. Physical certification intentionally NOT executed

The following require Owner-entered sandbox credentials, safe local database setup and the physical browser/Stripe CLI; offline fake tests cannot certify any of them:

| Mandatory outcome | Current evidence |
|---|---|
| Correct CarUp Japan sandbox `/v1/account` identity | Source guard only; NOT physically verified |
| Backend Checkout creation and hosted Stripe test checkout | Source only |
| Successful/declined/cancelled/abandoned test cards | NOT run |
| Raw signed webhook, bad signature, duplicate and out-of-order real deliveries | Unit coverage only; NOT run with Stripe |
| Interrupted return/retry and authoritative retrieval | Unit coverage only; NOT run with Stripe |
| Test refund and duplicate refund guard | Unit coverage only; NOT run with Stripe |
| CarUp DB receipt matched to Stripe payment/refund references | NOT run; migration unapplied |
| Cross-merchant/environment refusal against real provider accounts | Offline refusal tests only; NOT run |

Required physical receipts later: exact branch SHA + local DB migration checksum; Stripe account `acct_1UVnGaEjgXqvlsJk`; Checkout `cs_test_...`; PaymentIntent `pi_...`; signed event `evt_...`; CarUp `pay01a_...` record; refund `re_...`; event unique-claim/duplicate replay proof; declined and invalid signature negative controls; sanitized runtime logs and local test result. No secret, card data, person data or live payment identifiers should be captured.

## G. Release and next governance

Until physical proof, the correct recommendation is **RECOMMEND REMEDIATE**, for bounded follow-through (migration and local test setup, real Stripe credentials entered securely, physical Checkout/refund UAT, exact-head evidence review). Do NOT merge, enable live payments, move the staging alias, mark PAY-01A certified or promote Stripe to SafeTrade escrow.

After PAY-01A has independent physical evidence, propose a separately governed PAY-01B transaction-integration design. PAY-01C full vehicle transaction UAT remains later and subject to escrow/settlement/legal provider authority.

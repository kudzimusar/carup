# CARUP-PAY-03A — Real Vehicle History Report Commerce

**Programme:** CARUP PAYMENTS 2.0 — Unified Commercial Service Payments Programme  
**Controlling Authority:** [GitHub Issue #247](https://github.com/kudzimusar/carup/issues/247)  
**Parent Work Package:** `CARUP-PAY-02-FND-R1` (`5c77c26889b0811292f66e08e0589388467ed2bb`, PR #249)  
**Commercial Product Code:** `intel.report.vehicle_history_single`  
**Environment Scope:** Isolated Sandbox & Test Authority (`acct_1UVnGaEjgXqvlsJk`, `JPY 100`)  
**Production Authorization:** `NONE`

---

## 1. Executive Summary

`CARUP-PAY-03A` delivers CarUp's first genuine source-backed first-party commercial product integration: **CarUp Vehicle History Report — Single VIN (`intel.report.vehicle_history_single`)**.

Unlike the synthetic `PAY-01C` sandbox demonstration (`vehicle_history_demo`), `PAY-03A` connects:
1. **Real Vehicle Authority**: Queries real vehicles in `public.vehicles` and evaluates pre-purchase data coverage and mandatory source limitations via the canonical report assembly engine (`backend/services/report/reportService.js`) before collecting money.
2. **Versioned Commercial Quote & Order Authority**: Issues durable `public.pay02_commercial_quotes` rows, claims checkout via `public.pay02_claim_quote_checkout`, and links canonical `public.payment_transactions` and `public.pay02_report_orders`.
3. **Governed Stripe Japan Sandbox Checkout**: Creates a test-mode Stripe Checkout session on `acct_1UVnGaEjgXqvlsJk` for `JPY 100` (`currency_scale = 0`) with strict client-reference and metadata correlation.
4. **Authoritative Payment Convergence & Concurrency-Safe Fulfillment**: Both Stripe webhook processing (`processPay01aWebhook`) and explicit customer/admin verification (`POST /api/pay03a/orders/:orderId/verify`) converge on canonical `payment_transactions` and invoke `deliverVerifiedVehicleHistoryReport`, backed by the transactional PostgreSQL RPC `public.pay03a_complete_report_fulfillment`.
5. **Buyer Ownership, Expiring Share Links & Governed Refund Revocation**: Paid orders bind an immutable `public.report_versions` snapshot (`carup.report.v1`). Buyers can view their report, create expiring share links (`POST /api/pay03a/orders/:orderId/share`), and if an administrator executes a governed sandbox refund (`POST /api/pay03a/admin/orders/:orderId/refund`), both `pay02_report_orders` (`revoked_refunded`) and `report_versions.revoked = true` are atomically revoked, immediately blocking buyer and shared-link access.

---

## 2. Part III — Pre-Checkout Contract Hardening (PAY-02 Carry-Forward Fixes)

All three mandatory pre-checkout contract hardenings required before `PAY-03A` checkout have been implemented and verified:

1. **Atomic Governance Review Enforcement (`reviewPay02GovernanceProposal`)**:
   - Removed the non-atomic multi-step JavaScript fallback in `backend/services/payment/pay02Service.js`.
   - Governance proposal reviews now strictly require `db.rpc('pay02_review_activation_proposal', ...)` and fail closed with `503 PAY02_ATOMIC_GOVERNANCE_RPC_REQUIRED` if the transactional PostgreSQL RPC is unavailable.
2. **Mandatory Cross-Reference Correlation (`deliverVerifiedVehicleHistoryReport`)**:
   - Every cross-reference field across `pay02_commercial_quotes`, `payment_transactions`, `pay02_report_orders`, and `vehicles` is verified for non-null presence and exact equality (`quote.id === order.quote_id === payment.pay02_quote_id`, `quote.payment_reference === order.payment_reference === payment.reference`, `payment.pay01a_account_id === 'acct_1UVnGaEjgXqvlsJk'`, `order.product_version === quote.product_version`, `order.vin === vehicle.vin`, `order.vehicle_id === vehicle.id`).
   - Any missing or mismatched link fails closed with `409 PAY02_REPORT_ORDER_CORRELATION_MISMATCH`.
3. **Concurrency-Safe Idempotent Fulfillment & Checked DB Writes (`public.pay03a_complete_report_fulfillment`)**:
   - Added `public.pay03a_complete_report_fulfillment` in `database/migrations/20261031160000_carup_pay03a_real_report_commerce.sql`, which locks the order, quote, payment, and vehicle rows `FOR UPDATE`, prevents duplicate `report_versions` creation under concurrent webhook + verify calls, and atomically updates `report_versions` and `pay02_report_orders`.
   - All fallback update paths in `pay02Service.js` inspect `{ data, error }` and fail closed with `500 PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED` on any database error or zero-row update.

---

## 3. Seven Financial Questions Answered (`intel.report.vehicle_history_single`)

| Question | PAY-03A Authoritative Implementation |
| --- | --- |
| **1. What is being purchased?** | `intel.report.vehicle_history_single` (v1) — a single-VIN CarUp Vehicle History Report bound to a verified `public.vehicles(id, vin)` record. |
| **2. Who owes the money?** | Authenticated CarUp buyer (`req.user.id`), persisted on `pay02_commercial_quotes.payer_user_id`, `payment_transactions.user_id`, and `pay02_report_orders.buyer_id`. |
| **3. Who is legally entitled to the money?** | First-party merchant of record `carup_japan` (`CarUp Japan Co., Ltd.`), beneficiary `CarUp Japan Co., Ltd.`, funds owner `carup_first_party_revenue`. |
| **4. How much is owed, and in which currency?** | Integer minor-unit `100 JPY` (`currency_scale = 0`, `¥100`) locked in `pay02_commercial_quotes` under `sandbox_test_only` authority. |
| **5. Which provider may process the transaction?** | `stripe_jp_sandbox` (`acct_1UVnGaEjgXqvlsJk`) in Stripe test mode (`livemode = false`). All live/unverified providers fail closed. |
| **6. What does payment actually authorize?** | Generation and binding of one immutable `public.report_versions` (`carup.report.v1`) snapshot and `entitled` status on `public.pay02_report_orders`. |
| **7. How do we reconcile the outcome?** | Canonical `public.payment_transactions` stores `stripe_session_id`, `stripe_payment_intent_id`, `pay01a_refund_id`, and `pay02_quote_id`; `pay02_sync_quote_from_canonical_payment` synchronizes quote, order, and `report_versions.revoked` states. |

---

## 4. API Surface (`/api/pay03a`)

### Customer Endpoints
- `GET /api/pay03a/vehicles`: Lists eligible real vehicles from `public.vehicles` with optional VIN/make/model search filter.
- `GET /api/pay03a/vehicles/:vin/readiness`: Evaluates pre-purchase report readiness, completeness coverage, mandatory source limitations, and commercial terms (`JPY 100`, `acct_1UVnGaEjgXqvlsJk`) before purchase.
- `POST /api/pay03a/orders/checkout`: Validates `Idempotency-Key`, verifies vehicle eligibility, creates & persists a `PAY-02` quote, claims canonical `payment_transactions` + `pay02_report_orders`, creates a Stripe sandbox Checkout session, and attaches the Checkout session ID.
- `GET /api/pay03a/orders`: Lists the authenticated buyer's `PAY-03A` report orders.
- `GET /api/pay03a/orders/:orderId`: Retrieves a single buyer-owned report order.
- `POST /api/pay03a/orders/:orderId/verify`: Queries Stripe sandbox Checkout & PaymentIntent state, updates canonical `payment_transactions`, synchronizes `PAY-02` quote/order state, and triggers idempotent report fulfillment when paid.
- `GET /api/pay03a/orders/:orderId/report`: Serves the buyer's entitled, verified `carup.report.v1` snapshot with `Cache-Control: private, no-store`. Fails closed (`409` or `403`) when unpaid, refunded, or accessed by another user.
- `POST /api/pay03a/orders/:orderId/share`: Creates or rotates an expiring share token (`share_token`, `share_expires_at`) on `public.report_versions` for an entitled buyer order.

### Administrative Endpoints
- `GET /api/pay03a/admin/orders`: Lists `PAY-03A` report orders with quote, payment, entitlement, and report version provenance for `admin` / `super_admin`.
- `GET /api/pay03a/admin/orders/:orderId`: Returns detailed order, quote, canonical payment, and report snapshot provenance.
- `POST /api/pay03a/admin/orders/:orderId/refund`: Issues a governed Stripe sandbox refund on `acct_1UVnGaEjgXqvlsJk`, transitions `payment_transactions` to `refunded`, transitions `pay02_report_orders` to `revoked_refunded`, and sets `report_versions.revoked = true`.

---

## 5. UI Surface

- **Customer Vehicle History Commerce (`/vehicle-history`)**:
  - Implemented in `web/src/pages/VehicleHistoryCommerce.tsx`.
  - Allows authenticated buyers to search/select real vehicles, inspect pre-purchase data coverage & limitations, initiate governed `JPY 100` Stripe sandbox Checkout, verify payment status on return, open the fulfilled report snapshot, and generate expiring share links.
- **Administrative Commercial Foundation Console (`/admin/commercial-foundation`)**:
  - Extended `web/src/pages/dashboard/admin/Pay02CommercialFoundation.tsx` with the **PAY-03A Real Vehicle History Report Orders & Governed Refunds** panel (`data-testid="pay03a-admin-orders-panel"`).

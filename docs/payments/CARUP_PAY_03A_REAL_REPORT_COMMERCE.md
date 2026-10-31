# CARUP-PAY-03A — Real Vehicle History Report Commerce (`CARUP-PAY-03A-R1`)

**Programme:** CARUP PAYMENTS 2.0 — Unified Commercial Service Payments Programme  
**Controlling Authority:** [GitHub Issue #247](https://github.com/kudzimusar/carup/issues/247)  
**Parent Work Package:** `CARUP-PAY-02-FND-R1` (`5c77c26889b0811292f66e08e0589388467ed2bb`, PR #249)  
**Product PR:** [PR #250](https://github.com/kudzimusar/carup/pull/250) (`feat/carup-pay-03a-real-report-sandbox-commerce`)  
**Commercial Product Code:** `intel.report.vehicle_history_single`  
**Environment Scope:** Isolated Sandbox & Test Authority (`acct_1UVnGaEjgXqvlsJk`, `JPY 100`)  
**Production Authorization:** `NONE`

---

## 1. Executive Summary

`CARUP-PAY-03A` (remediated under `CARUP-PAY-03A-R1`) implements CarUp's first source-backed first-party commercial product workflow in isolated sandbox environments: **CarUp Vehicle History Report — Single VIN (`intel.report.vehicle_history_single`)**.

Unlike the synthetic `PAY-01C` sandbox demonstration (`vehicle_history_demo`), `PAY-03A` connects:
1. **Canonical Vehicle & Evidence Authority (`public.vehicles`, `public.vehicle_evidence`)**: Queries vehicles in `public.vehicles`, evaluates pre-purchase data coverage and mandatory source limitations via `assembleReport` (`backend/services/report/reportService.js`), and enforces an evidence-backed eligibility gate (`R1-B`) that refuses checkout (`422 PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE`) before charging if a vehicle record contains only static identity metadata with zero historical lifecycle evidence.
2. **Versioned Commercial Quote & Order Authority**: Issues durable `public.pay02_commercial_quotes` rows (`status = 'issued'`), claims checkout atomically via `public.pay02_claim_quote_checkout` (`status = 'payment_initiated'`), and links canonical `public.payment_transactions` and `public.pay02_report_orders` (`entitlement_status = 'awaiting_payment'`).
3. **Governed Stripe Japan Sandbox Checkout**: Creates a test-mode Stripe Checkout session (`livemode = false`) on verified sandbox account `acct_1UVnGaEjgXqvlsJk` (`gateway = 'stripe_carup_japan_sandbox'`) for `JPY 100` (`currency_scale = 0`) with strict client-reference and metadata correlation.
4. **Authoritative Payment Convergence & Atomic Fulfillment (`R1-E`)**: Signed Stripe webhooks (`processPay01aWebhook`), customer verification (`POST /api/pay03a/orders/:orderId/verify`), and admin fulfillment recovery (`POST /api/pay03a/admin/orders/:orderId/reconcile`) converge on canonical `payment_transactions`, synchronize quote/order state (`status = 'paid_verified'`, `entitlement_status = 'entitled'`) via `public.pay02_sync_quote_from_canonical_payment`, and fulfill the report exclusively through the atomic PostgreSQL RPC `public.pay03a_complete_report_fulfillment` (`status = 'fulfilled'`). No non-atomic multi-step JavaScript fallback exists.
5. **Fail-Closed Share-Link Entitlement & Governed Refund Revocation (`R1-C`, `R1-D`)**: Paid orders bind 1:1 to an immutable `public.report_versions` snapshot (`report_tier = 'pay03a_commercial_snapshot'`, `pay03a_order_id = pay02_report_orders.id`). Expiring share links (`POST /api/pay03a/orders/:orderId/share` -> `GET /api/reports/shared/:token`) verify active order entitlement and canonical `payment_transactions.status = 'paid'` on every read, failing closed (`entitlement_unavailable` or `revoked`) on database lookup errors, `refund_pending`, or `refunded` states while preserving legacy Milestone 4 report versions (`report_tier = 'legacy_version'`).

---

## 2. Free Live Route vs. Paid Sandbox Commercial Snapshot (`R1-B`)

> **Policy Status:** `CANDIDATE_SANDBOX_DIFFERENTIATION_PENDING_OWNER_APPROVAL`

CarUp already provides an authenticated live vehicle-history route (`GET /api/vehicles/:vin/report`). `PAY-03A` does **not** silently paywall existing functionality and does **not** claim exclusive external registries or secret data sources. Both paths invoke the same canonical `assembleReport(db, vin, { audience: 'buyer' })` engine:

| Dimension | Free Live Route (`GET /api/vehicles/:vin/report`) | Paid Sandbox Snapshot (`intel.report.vehicle_history_single`) |
| --- | --- | --- |
| **Commercial Status** | Free authenticated on-demand read | `JPY 100` sandbox test fixture (`CANDIDATE_SANDBOX_DIFFERENTIATION_PENDING_OWNER_APPROVAL`) |
| **Underlying Data Engine** | `assembleReport` (`vehicle_history_report.v1`) | Same `assembleReport` (`vehicle_history_report.v1`) — no exclusive data sources claimed |
| **Evidence Eligibility Gate** | Returns live identity/completeness even for metadata-only rows | **Refuses purchase before charging (`422 PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE`)** if the vehicle has zero historical lifecycle events, evidence records, listing snapshots, or alerts |
| **Snapshot Persistence** | Ephemeral response; creates no `report_versions` row | Persists an immutable `public.report_versions` row (`report_tier = 'pay03a_commercial_snapshot'`) with SHA-256 `content_hash` and `pay03a_order_id` |
| **Buyer Order & Audit Trail** | None | Durable `pay02_commercial_quotes` + `payment_transactions` + `pay02_report_orders` record |
| **Expiring Share Link** | None (direct `/api/report-versions/:id/share` blocked for paid snapshots) | Buyer-controlled expiring share token (`pay03a_shr_*`) via `POST /api/pay03a/orders/:orderId/share` with fail-closed entitlement and refund revocation enforcement |

---

## 3. Canonical Schema Preservation & Fixture Segregation (`R1-A` & `R1-C`)

1. **Zero Synthetic Vehicles in Product Migrations (`R1-A`)**:
   - `database/migrations/20261031160000_carup_pay03a_real_report_commerce.sql` contains **zero** `INSERT INTO public.vehicles` statements and **zero** `CREATE TABLE IF NOT EXISTS` fallbacks for `public.vehicles` or `public.report_versions`.
   - Synthetic test vehicles (`WBA3A5C51DF358101`, `JTDBR32E820112202` with verified `public.vehicle_evidence`, and metadata-only control `DBA-GRS204-0005303`) are segregated into `backend/tests/sql/fixtures/pay03a-synthetic-vehicle-fixtures.sql`, which refuses execution unless `current_database() = 'pay01c_sandbox_ci'` and stamps every row with `specifications.pay03a_synthetic_fixture = true`.
2. **Preservation of Canonical `public.report_versions` Authority (`R1-C`)**:
   - `20261031160000_carup_pay03a_real_report_commerce.sql` requires the canonical Vehicle History migrations (`20260621150000_report_versions.sql` and `20260624120000_vehicle_trust_security_hardening.sql`) to be applied first, failing deterministically with `PAY03A_REQUIRES_CANONICAL_VEHICLE_AND_REPORT_SCHEMA` or `PAY03A_REQUIRES_CANONICAL_REPORT_VERSION_GUARD` if absent.
   - The canonical immutability trigger `trg_report_version_guard` (`public.carup_report_version_guard()`) is preserved intact.
   - `PAY-03A` adds only `report_tier` (`'legacy_version'` | `'pay03a_commercial_snapshot'`), `pay03a_order_id`, an additive binding guard trigger (`trg_pay03a_report_version_binding_guard`), and an additive `AS RESTRICTIVE` RLS policy (`pay03a_paid_report_entitlement_guard`) so `authenticated` callers cannot bypass paid order entitlement via direct table reads while legacy Milestone 4 report rows remain unaffected.

---

## 4. Seven Financial Questions Answered (Verified Source Schema & Authority — `R1-G`)

| Question | Verified PAY-03A Source Implementation |
| --- | --- |
| **1. What is being purchased?** | Catalogue item `intel.report.vehicle_history_single` (`product_version = 1`), bound to `public.vehicles.vin` (`pay02_commercial_quotes.source_object_type = 'vehicles'`, `source_object_id = vin`, `pay02_report_orders.vin = vin`). |
| **2. Who owes the money?** | Authenticated CarUp buyer (`req.userContext.id`), persisted in `pay02_commercial_quotes.payer_id` (`payer_role`), `payment_transactions.pay01a_actor_id`, and `pay02_report_orders.buyer_id`. |
| **3. Who is legally entitled to the money?** | Internal code `carup_japan` across `merchant_of_record`, `contractual_seller`, `legal_beneficiary`, `funds_owner`, and `revenue_beneficiary` on `pay02_commercial_quotes` and `pay02_funds_owner` / `pay02_legal_beneficiary` on `payment_transactions`. **Fact vs. Assumption**: `acct_1UVnGaEjgXqvlsJk` is a verified Stripe Japan sandbox account (`CarUp Japan (Sandbox)`); formal legal entity corporate registration is an external commercial prerequisite not asserted by source code. |
| **4. How much is owed, and in which currency?** | Integer minor-unit `100` in `JPY` (`currency_scale = 0`), stored in `pay02_commercial_quotes.total_minor` (`currency = 'JPY'`) and `payment_transactions.amount` (`currency = 'JPY'`) as a sandbox test fixture (`SANDBOX_TEST_ONLY`). |
| **5. Which provider may process the transaction?** | Provider key / gateway `stripe_carup_japan_sandbox` on verified Stripe sandbox account `acct_1UVnGaEjgXqvlsJk` (`livemode = false`). All other providers and live keys fail closed. |
| **6. What does payment actually authorize?** | Transition of `pay02_commercial_quotes.status` (`issued` → `payment_initiated` → `paid_verified` → `fulfilled`), transition of `pay02_report_orders.entitlement_status` (`awaiting_payment` → `entitled`), and atomic creation of one immutable `public.report_versions` row (`report_tier = 'pay03a_commercial_snapshot'`, `pay03a_order_id = order.id`). |
| **7. How do we reconcile the outcome?** | Canonical `public.payment_transactions` stores `reference`, `status` (`pending` \| `paid` \| `cancelled` \| `refund_pending` \| `refunded`), `pay01a_checkout_id`, `pay01a_intent_id`, `pay01a_refund_id`, and `pay02_quote_id`. `public.pay02_sync_quote_from_canonical_payment` synchronizes quote status, order `entitlement_status` (`refund_suspended` on `refund_pending`; `revoked_refunded` on `refunded`), and `report_versions.revoked = true`. |

---

## 5. API Surface (`/api/pay03a`)

### Customer Endpoints (`authorizeSessionRole([])`)
- `GET /api/pay03a/vehicles`: Lists vehicles from `public.vehicles` with pre-purchase eligibility (`eligibleForReport`, `eligibilityStatus`, `ineligibilityReason`, `isSyntheticFixture`) and `deliverableComparison`.
- `GET /api/pay03a/vehicles/:vin/readiness`: Evaluates vehicle report readiness, historical evidence counts, completeness coverage, mandatory limitations, `deliverableComparison`, and `JPY 100` sandbox commercial terms.
- `POST /api/pay03a/orders/checkout`: Refuses client price/party overrides (`400`) and metadata-only vehicles (`422 PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE`), issues a durable `PAY-02` quote, claims canonical `payment_transactions` + `pay02_report_orders`, creates a Stripe sandbox Checkout session on `acct_1UVnGaEjgXqvlsJk`, and attaches `pay01a_checkout_id`.
- `GET /api/pay03a/orders`: Lists the authenticated buyer's `PAY-03A` report orders.
- `GET /api/pay03a/orders/:orderId`: Retrieves a single buyer-owned report order without mutating provider state.
- `POST /api/pay03a/orders/:orderId/verify`: Reconciles with Stripe sandbox (`reconcilePay01aPayment`), runs `pay02_sync_quote_from_canonical_payment`, and when `status = 'paid'`, executes atomic idempotent fulfillment via `pay03a_complete_report_fulfillment`.
- `GET /api/pay03a/orders/:orderId/report`: Reconciles with Stripe and serves the buyer's entitled `vehicle_history_report.v1` snapshot with `Cache-Control: private, no-store, no-cache, must-revalidate`.
- `POST /api/pay03a/orders/:orderId/share`: Creates or rotates an expiring `pay03a_shr_*` share token on `public.report_versions` for an actively entitled paid order.

### Administrative Endpoints (`authorizeSessionRole(['admin'])`)
- `GET /api/pay03a/admin/orders`: Lists `PAY-03A` report orders with quote, canonical payment, entitlement, and report version provenance.
- `GET /api/pay03a/admin/orders/:orderId`: Inspects a single `PAY-03A` report order.
- `POST /api/pay03a/admin/orders/:orderId/reconcile`: Reconciles canonical payment state with Stripe and recovers interrupted report fulfillment idempotently (`paid_verified` → `fulfilled`) without creating a duplicate payment or second report version.
- `POST /api/pay03a/admin/orders/:orderId/refund`: Executes a governed Stripe sandbox refund (`refundPay01aPayment`), synchronizes quote (`status = 'refunded'`) and order (`entitlement_status = 'revoked_refunded'`), and revokes the bound `report_versions` snapshot (`revoked = true`).

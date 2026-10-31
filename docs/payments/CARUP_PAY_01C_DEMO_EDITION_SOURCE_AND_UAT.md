# CARUP-PAY-01C — Vehicle History Report Demo Edition
**Source candidate only — local Stripe sandbox.** Parent `2c4057a2224ac14d7ec19b05f79f53f3a5eb5d5d`. No production authorization, staging migration, live money, merger, seller settlement, SafeTrade or title transfer.

## Product and policy
- Customer page: `/demo/vehicle-history`; customer history on the same page.
- Admin inspection/refund: `/admin/demo-purchases` (linked from existing `/admin/payments`).
- `vehicle_history_demo`: exact JPY 100 from the **server**, CarUp Japan Stripe sandbox `acct_1UVnGaEjgXqvlsJk`. This price is a deliberately fixed sandbox **test item**, not commercial pricing.
- Returned report is generated from explicitly fictional, hard-coded synthetic events under `syntheticDemoReport()`. No real VIN lookup, no claim of authentic vehicle history.
- **Entitlement policy:** an order with an authenticated, provider-verified canonical `paid` state is granted one immutable `granted_at`. Report is accessible only while `payment_transactions.status = 'paid'`, `granted_at` is present, and `revoked_at` is absent. `refund_pending` suspends access. A verified full `refunded` state writes one immutable `revoked_at`. Refunds do not delete history. The report GET performs a fresh provider reconciliation to protect against delayed refund events.
- Failed/cancelled/expired/unpaid Checkout cannot create a grant. An ambiguous provider failure stays pending; the browser redirect alone is never payment evidence.
- Buyers cannot read or manage other buyers' orders, and the original PAY-01A/B routes remain admin-only. Only the new admin route can refund a demo order.

## Canonical authority and idempotency
The only money ledger is the accepted `public.payment_transactions` plus the original PAY-01A Stripe event receipts. `public.pay01c_demo_orders` stores **product identity, buyer, request key and entitlement timestamps**, not competing payment amounts or financial state.

`pay01c_claim_demo_checkout` inserts the payment row and demo order together, atomically and idempotently for a buyer/request key. It intentionally reuses the exact existing PAY-01A Checkout and metadata verifier. The hosted Checkout return path is `/demo/vehicle-history`, never an authorization signal.

The PAY-01A signed webhook constructs and verifies from the original raw bytes; current Stripe account, Checkout, PaymentIntent, refund evidence, merchant metadata, amount, and currency are all independently checked. The existing idempotent `pay01a_apply_provider_snapshot` executes before `pay01c_sync_demo_entitlement`. That new RPC returns null for older PAY-01A payments and updates demo entitlement only for linked orders. If entitlement reconciliation fails, the delivery fails closed so retries can complete fulfillment safely.

Admin refund calls the accepted PAY-01A refund service using the buyer identity **read from the canonical order**, inside an administrator-only route; it never trusts a browser-supplied buyer identity. Idempotent retry is inherited from the accepted Stripe key and canonical refund guard.

## Required local-only provisioning
1. Verify checkout at this PR's exact commit, with a clean worktree. Keep PR #246 frozen/open/draft/unmerged.
2. Confirm the database is the **Owner's governed isolated local Supabase** environment; never production `vhmnajoeicasaigiophh` or shared staging.
3. Inspect migration history and confirm the PAY-01A schema/RPCs and `payment_transactions` table exist.
4. Apply **only** `database/migrations/20261030223000_carup_pay01c_demo_product.sql` locally, then verify table uniqueness, row-level security, ACLs and RPC EXECUTE permissions. No automatic destructive down migration.
5. Owner enters test-only CarUp Japan Stripe credentials and the local Stripe CLI signing secret in protected local configuration, without sharing values in chat. Set `CARUP_PAY01A_ENABLED=true` and `CARUP_PAY01C_ENABLED=true` only in that isolated environment. Existing `CARUP_PAY01A_STRIPE_ACCOUNT_ID` must match the sandbox, `CARUP_PAY01A_RETURN_ORIGIN=http://127.0.0.1:5173` (or the existing localhost approved origin). No live-looking key is permitted.
6. Start local web/backend and the **existing** path-restricted Stripe CLI listener for `/api/pay01a/stripe/webhook`. Authenticate a real buyer account and a separate authorized admin account through CarUp, never role-assertion headers.

## Offline source verification
- `node --test backend/tests/pay01a-stripe-sandbox-foundation.test.js backend/tests/pay01c-demo-product.test.js`
- `cd web && npx vitest run src/pages/DemoVehicleHistory.test.tsx src/pages/dashboard/admin/Pay01aPayments.test.tsx`
- `npm run build --workspace web`
The dedicated PAY-01C CI workflow runs these without any Stripe credential or financial mutation.

## Physical certification matrix (not fulfilled by unit mocks)
- Buyer visits product on desktop and 390px mobile; sees TEST ONLY and genuine server-projected JPY100.
- Buyer logs in, buys one demo item via CarUp-hosted authenticated POST, follows genuine `cs_test_...` Checkout.
- Complete **one** JPY100 sandbox payment, verify account `acct_1UVnGaEjgXqvlsJk`, PaymentIntent `pi_...` in Stripe and canonical payment row with matching references/amount/currency/metadata.
- Obtain genuine Stripe-signed `evt_...` webhook. Reconcile to paid, verify one grant and report; history shows only buyer's order.
- Retry same webhook and interrupted return; assert no second order, money row or grant.
- Second authenticated buyer must receive 404/403 when reading first buyer order/report; customer cannot call admin refund.
- Cancel/decline/expire separate *unpaid* sessions only if minimum necessary for certification: no unlock.
- Authorized admin inspects linked canonical payment and refunds **once**; confirm Stripe `re_...`, same order turns `refunded`, report access revoked. Replays yield zero additional refunds.
- Capture sanitized mobile/desktop screenshots and RLS/RPC verification results. Do not include session, test key, webhook secret, card details or real customer information.

**Physical outcome:** NOT YET CERTIFIED until the Owner's local runtime, migration, authenticated customer flow and actual Stripe sandbox receipts are observed. No deployment, live collection or merge authorized.

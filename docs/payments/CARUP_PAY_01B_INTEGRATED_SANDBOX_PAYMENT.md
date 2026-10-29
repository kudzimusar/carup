# CARUP-PAY-01B — Integrated Stripe sandbox payment

PAY-01B adds an authenticated CarUp admin console for the existing PAY-01A
first-party direct-merchant certification item. It does not change SafeTrade,
vehicle ownership, escrow, seller settlement or payout authority.

## User journey

`/admin/payments` is available only inside the existing admin dashboard shell.
The page is explicitly labelled **CarUp Japan · Test mode** and displays the
server-owned JPY 100 certification item. The browser sends no amount, currency,
merchant or provider status. The backend creates the hosted Stripe Checkout
Session and redirects only to the validated Stripe URL.

After Checkout, Stripe returns to `/admin/payments`. The return is treated as
unconfirmed; the page uses the existing authenticated reconciliation endpoint to
retrieve authoritative Checkout, PaymentIntent and refund state. An operator can
request one full test refund through the existing protected backend route. The
history table is a safe projection of canonical `payment_transactions`; Stripe
event receipts remain evidence and are not a second ledger.

## Backend contract

- `GET /api/pay01a` — admin-only safe projection of sandbox payment records.
- `POST /api/pay01a/checkout` — admin-only Checkout creation with a stable
  idempotency key and server-controlled JPY 100 parameters.
- `GET /api/pay01a/:reference` — provider-backed reconciliation.
- `POST /api/pay01a/:reference/refund` — governed full refund and reconciliation.
- `POST /api/pay01a/stripe/webhook` — exact raw-body signature verification and
  provider-backed event processing.

The sandbox gate remains fail-closed for production, non-local return origins,
wrong merchant accounts, live-looking keys and missing webhook secrets. The
Stripe account guard remains `acct_1UVnGaEjgXqvlsJk`.

## Marketplace boundary

This integration certifies direct CarUp merchant collection only. A successful
Checkout is not a vehicle purchase, escrow funding, seller payout, reservation,
title transfer or release authorization. Marketplace transactions continue to
use their existing SafeTrade capability and settlement gates.

## Verification

The focused PAY-01A/PAY-01B service suite and the PAY-01B console unit suite
must pass before physical UAT. Physical UAT requires a new temporary sandbox
credential entered privately by the Owner because the PAY-01A credential was
revoked during security closeout. No credential belongs in this repository or in
the evidence report.

#!/usr/bin/env bash
# CARUP-PAY-03A-STG01-FINAL — Owner-run Stripe CLI webhook listener for the Stage 6 backend on 127.0.0.1:5031.
# Forwards exactly the events PAY-01A accepts (backend/services/payment/pay01aService.js allowedEvents).
# Prints the whsec_ signing secret to paste into the Stage 6 backend launcher. Keep this window open.
set -euo pipefail
exec stripe listen \
  --events-from @self \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,refund.created,refund.updated,refund.failed \
  --forward-to http://127.0.0.1:5031/api/pay01a/stripe/webhook

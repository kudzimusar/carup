#!/usr/bin/env bash
# CARUP-PAY-03B-LR01 Level 2 — Owner-run Stripe CLI listener for the PAY-03B sandbox backend on 127.0.0.1:5041.
# Forwards the PAY-01A payment events plus the subscription and invoice events PAY-03B reconciles.
# Prints the whsec_ signing secret to paste into the PAY-03B launcher. Keep this window open.
set -euo pipefail
exec stripe listen \
  --events-from @self \
  --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.created,invoice.finalized,invoice.paid,invoice.payment_succeeded,invoice.payment_failed,invoice.updated,invoice.voided,invoice.marked_uncollectible,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,charge.refund.updated,refund.created,refund.updated,refund.failed \
  --forward-to http://127.0.0.1:5041/api/pay01a/stripe/webhook

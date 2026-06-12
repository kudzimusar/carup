# 03 — Rewards, Wallet, and Settlement TRD

## Purpose

Define how CarUp gives small benefits to buyers, sellers, referrers, ambassadors, and partners without exposing the system to abuse.

## Benefit types

- Buyer discount.
- Seller fee refund or listing credit.
- General referrer wallet credit.
- Ambassador tier benefit.
- Container-space booking credit.
- Parts order discount.
- Priority support access.

## State machine

Every benefit must move through a clear lifecycle:

```text
created -> pending -> eligible -> approved -> payable -> paid_or_applied
created -> pending -> held -> rejected
```

## Maturity rules

A benefit should mature only after a verified commercial milestone. Examples include approved listing, paid order, confirmed booking, container loading, delivery confirmation, or review-window closure.

## AI use

The Reward Agent calculates the expected benefit, checks eligibility, finds missing requirements, and recommends approve, hold, or reject. The agent does not make final high-value settlement decisions without permission.

## Admin controls

Admins need a wallet ledger, event timeline, fraud signals, manual adjustment reason, approval status, and exportable audit history.

## Acceptance criteria

- No benefit matures from signup alone.
- Duplicate claims are blocked.
- Self-referral attempts are flagged.
- Users can see pending and approved balances.
- Admins can explain why a benefit is held or rejected.

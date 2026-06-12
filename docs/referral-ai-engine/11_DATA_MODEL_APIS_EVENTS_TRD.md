# 11 — Data Model TRD

## Purpose

Define the technical foundation for referral attribution, campaign operations, wallet status, and AI tools.

## Core records

- Referral codes.
- Referral events.
- Campaigns.
- Campaign channels.
- Coupons.
- Wallets.
- Wallet transactions.
- Ambassador profiles.
- Container campaigns.
- Container-space bookings.
- AI runs.
- AI tool calls.
- Review queue.

## Core actions

- Validate referral code.
- Record referral event.
- Create campaign.
- Apply coupon.
- Recommend wallet status.
- Record container booking interest.
- Triage lead.
- Generate share kit.
- Queue review.

## Acceptance criteria

- Every AI tool call writes an audit record.
- Every referral event stores channel and campaign metadata.
- APIs return structured errors that agents can explain to users.

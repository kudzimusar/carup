# 10 — Trust, Fraud, Compliance, and Guardrails TRD

## Purpose

Protect the referral system from abuse while keeping the user experience simple.

## Guardrail areas

- Duplicate account checks.
- Self-referral checks.
- Code expiry and usage limits.
- Minimum order or booking value.
- Channel consent records.
- Public disclosure text for promoted referrals.
- Manual review queue.
- Audit trail for agent and admin decisions.

## Risk signals

The system should watch for repeated device patterns, repeated phone use, unusual code velocity, abnormal campaign conversion patterns, repeated failed payments, and repeated disputes.

## AI use

The Trust Agent summarizes risk signals and recommends allow, hold, review, or reject. The agent must explain the reason and cite the events that caused the recommendation.

## Human review

Human operators decide disputed cases, blocked accounts, large settlements, and compliance exceptions.

## Acceptance criteria

- Risk checks run before benefit maturity.
- Users receive clear explanations when a benefit is pending or held.
- Admins can view the full event trail.
- AI recommendations are stored but remain reviewable.

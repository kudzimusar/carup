# 12 — Implementation Roadmap and Test Plan

## Phase 1 — Foundation

Build referral codes, campaign records, QR generation, coupon rules, wallet records, event logging, and admin views.

## Phase 2 — AI gateway

Create a CarUp Agent Gateway with permissioned tools for triage, code validation, campaign drafting, share-kit generation, wallet status explanation, and support handoff.

## Phase 3 — Messaging channels

Connect WhatsApp, Telegram, web chat, and mobile chat to the same gateway. Preserve channel metadata and referral attribution.

## Phase 4 — Local marketplace

Enable local buyer, seller, parts, supplier, mechanic, and operator referral flows.

## Phase 5 — Import campaigns

Enable vehicle import, parts import, and container-space campaign flows with route pages and capacity status.

## Phase 6 — AI marketing and SEO

Generate campaign pages, share kits, proof stories, FAQ drafts, and channel messages from campaign data.

## Phase 7 — Trust and review

Add risk checks, human review queues, wallet holds, dispute handling, and audit exports.

## Test plan

- Code creation test.
- QR scan attribution test.
- Coupon application test.
- WhatsApp entry attribution test.
- Telegram entry attribution test.
- Local buyer referral test.
- Seller referral test.
- Container-space referral test.
- Reward pending to approved state test.
- Fraud signal hold test.
- Human review override test.
- AI triage and handoff test.
- SEO page generation draft test.

## Definition of done

The system is ready only when a referred user can enter from a social channel, create a verified lead or transaction path, retain attribution across the workflow, and produce a reviewable benefit record with a complete event trail.

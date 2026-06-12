# 07 — AI Layer TRD

## Purpose

Make AI the operating layer of the referral engine instead of a simple content helper.

## AI roles

- Triage: identify what the user wants.
- Attribution: validate codes and attach campaign context.
- Campaign: draft campaign assets and share kits.
- Channel: adapt content for chat, web, mobile, and social channels.
- Import: route vehicle, parts, and container inquiries.
- Local marketplace: support local buyer and seller flows.
- Reward: calculate and recommend benefit state.
- Trust: check risk signals and request review.
- Analytics: explain campaign performance.
- Handoff: summarize cases for operators.

## Tool gateway

All AI roles call CarUp-owned tools through one gateway. The gateway controls permissions, logging, retries, and provider fallback.

## Acceptance criteria

- AI can route a user from entry to workflow.
- AI decisions are visible in admin logs.
- Restricted actions are queued for review.
- The same gateway serves web chat, messaging channels, and external assistants.

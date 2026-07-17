# Agent 8 Current-State Gap Matrix

Recorded before implementation on branch `feature/agent-8-omnichannel-communication-engine`, stacked on `origin/feat/referral-final-uat-release` because PR #88 is still open.

## Repository And PR Scan

- Main baseline: `origin/main` at `c25b094`.
- Referral dependency: PR #88, `feat/referral-final-uat-release`, open and clean; Agent 8 branch is based on this branch.
- Related open PRs inspected: #99 Agent 8 spec, #94 navigation, #98/#91-#97 vehicle-life stack, #90/#81 diaspora stack, #76 release candidate, #72 mobile verification, #66 mobile drawer. None should be copied into Agent 8; only existing merged/PR #88 repository foundations are used.
- Local unrelated work preserved: pre-existing mobile ESLint/package changes were stashed as `preserve-navigation-mobile-eslint-local`.

## Canonical Runtime Decisions

- Canonical outbox: `domain_events`, because `eventBusService.js`, `eventWorker.js`, `/api/health`, escrow, and diaspora services use it at runtime.
- Legacy outbox: `outbox_events` remains untouched for compatibility; Agent 8 does not create a third outbox table.
- Canonical notification queue: existing `notification_queue`, extended additively. Agent 8 does not create a competing queue.
- Channel parsing/referral dependency: existing `ReferralChannelGatewayService` and `referralChannelPayloadParsers.js` are reused for WhatsApp, Telegram, Facebook, Instagram, web chat, and mobile chat.

## Gaps Before This PR

| Area | Existing state | Gap closed by Agent 8 implementation |
| --- | --- | --- |
| Threads/messages | No canonical durable communication thread/message model | Add `message_threads`, `message_participants`, `messages` and services |
| Cross-channel identity | Referral channel parser carries sender IDs only | Add `channel_identities` with safe linking rules |
| Queue | Legacy/simple `notification_queue` shapes vary | Add canonical queue fields to existing table and runtime queue service |
| Delivery attempts | No provider-attempt table | Add `message_delivery_attempts` and delivery worker |
| Webhooks | Referral webhooks parse, but no canonical receipt log/dedupe | Add `webhook_logs` plus communication webhook service |
| Preferences/consent | Diaspora preferences are scoped to diaspora | Add `communication_preferences` and policy checks |
| Escalation/SLA | No communication-specific escalation ledger | Add `communication_escalations` and SLA service behavior |
| Admin command center | Admin referral/marketplace pages exist | Add protected communication APIs and web command center |
| User/mobile surfaces | Referral and marketplace flows exist | Add notification center/preferences/support/chat APIs and screens |
| AI safety | Referral gateway triages referral input | Add thread-level AI mode and mandatory handoff controls |
| Marketplace bridge | Inquiries create rows and referral events | Emit communication domain event and create marketplace thread |
| Escrow/finance bridge | Escrow emits `ESCROW_*`; finance writes application only | Subscribe/map available escrow events; emit/map finance events |

## Supabase Notes

Official Supabase changelog was checked on 2026-06-23. Relevant current item: new public tables are not automatically exposed to Data/GraphQL APIs, so Agent 8 uses backend service-role APIs for application access and enables RLS as defense in depth instead of relying on direct frontend Data API exposure.


# Agent 8 — Omnichannel Communication Engine

## Summary

Implements the production-testable CarUp Omnichannel Communication Engine across database, backend services, API routes, provider-neutral adapters, notification delivery, web/mobile user surfaces, admin command center, AI handoff safety, referral/marketplace/escrow/finance integration, tests, and evidence documentation.

## Dependency / Base

- Main SHA: `c25b094` recorded before implementation.
- Referral PR #88 status: open, clean, branch `feat/referral-final-uat-release`.
- Branch strategy used: `feature/agent-8-omnichannel-communication-engine` stacked on `origin/feat/referral-final-uat-release`.

## Current State Before This PR

- Restored the authoritative Agent 8 spec from PR #99 because it was not present on the implementation base.
- Inspected current branch state, PR #88, related open PRs, existing migrations, `notification_queue`, `domain_events`, referral channel gateway, web navigation, mobile tabs, backend routing, event bus, and provider patterns.
- Recorded the pre-implementation gap matrix in `docs/agent-8-omnichannel/AGENT_8_CURRENT_STATE_GAP_MATRIX.md`.

## Architecture Implemented

- Adds one canonical communication fabric with durable threads, participants, messages, cross-channel identities, delivery attempts, webhook logs, preferences, escalations, and a provider-neutral adapter contract.
- Reuses existing `notification_queue` and `domain_events` instead of creating parallel queue/outbox systems.
- Keeps provider adapters free of business truth and delegates referral attribution to the existing referral gateway.

## Database and Migrations

- Adds migration `database/migrations/20260623143000_omnichannel_communication_engine.sql`.
- Creates `message_threads`, `channel_identities`, `message_participants`, `messages`, `message_delivery_attempts`, `webhook_logs`, `communication_preferences`, and `communication_escalations`.
- Extends `notification_queue` with canonical Agent 8 delivery fields and legacy-compatible status/channel checks.
- Extends `domain_events` with outbox metadata needed by the communication listener path.
- Enables RLS and policies for user/admin read boundaries and preference ownership.

## Canonical Threads, Messages, and Identities

- Backend services resolve or create durable threads, participants, identities, messages, assignments, escalations, read markers, feedback reopening, and safe projections.
- Identity linking prevents unsafe weak merges and preserves channel-specific external identities.

## Notification Queue and Outbox Strategy

- Canonical queue: existing `notification_queue`, extended additively.
- Canonical outbox: existing `domain_events`, consumed via the existing event worker/listener pattern.
- Legacy `outbox_events` remains untouched for compatibility.

## Channel Adapters

- WhatsApp: Meta configuration-gated adapter path and deterministic fake coverage.
- Telegram: bot configuration-gated adapter path, webhook secret validation, and deterministic fake coverage.
- Instagram/Facebook: Meta adapter path and webhook normalization through the same contract.
- Email: SendGrid-compatible configuration contract.
- SMS: Twilio-compatible configuration contract.
- Web/Mobile chat: canonical inbound API path.
- In-app/Push: in-app provider path plus push configuration contract.

## Webhooks, Security, and Deduplication

- Adds `/api/communications/webhooks/:provider/:channel`.
- Verifies Telegram secret tokens, Meta signatures/verify tokens, and shared-secret gateway headers.
- Logs webhooks with dedupe keys and returns safe success for duplicates without duplicate messages.
- Adds CSRF machine-webhook exemption only for communication webhook paths; route-level webhook auth remains required.

## Retry, Fallback, and Dead Letter

- Delivery worker records attempts, retryable failures, exponential backoff, max-attempt dead letters, admin retry, and admin cancel.
- Notification policy respects preferences/consent and suppresses marketing sends when opted out.

## AI Automation and Human Handoff

- Adds deterministic AI classifier/safe answer service.
- Finance, escrow, payment, approval, verification, complaint, fraud, and explicit human requests force persistent handoff.
- AI does not approve finance, release escrow, fabricate payment status, calculate rewards, expose private evidence, or create business truth.

## Referral Integration

- Reuses `ReferralChannelGatewayService` and existing payload parsers.
- Preserves referral code/campaign attribution on listing shares and inbound messages.
- Communication code never calculates rewards or mutates wallets.

## Marketplace Integration

- Marketplace inquiries emit best-effort communication domain events after the marketplace row and referral bridge complete.
- Listing share API preserves listing, channel, referral code, and campaign attribution.
- Buyer/seller context is stored on threads without exposing private contact data in public responses.

## Escrow Integration

- Communication listeners subscribe to available escrow domain events such as `ESCROW_CREATED` and `ESCROW_UPDATED`.
- Templates use authoritative persisted event payloads only.

## Financing Integration

- Finance application submission emits `finance.application.status_changed` for communication notification policy.
- Templates do not promise approval and do not expose sensitive financial documents.

## Admin Command Center

- Adds admin communication APIs for thread list/detail, reply, assignment, priority, escalation, resolve, reopen, metrics, and dead-letter retry/cancel.
- Adds `web/src/pages/dashboard/admin/Communications.tsx` and navigation entries.

## User Web and Mobile Surfaces

- Adds user web Communications page for notifications, support chat, marketplace share, preferences, and read markers.
- Adds mobile Messages tab plus API client for notifications, support chat, share, and preferences.

## APIs and Events

- User APIs under `/api/communications/*`.
- Admin APIs under `/api/admin/communications/*`.
- Webhook APIs under `/api/communications/webhooks/:provider/:channel`.
- Event listeners map marketplace, escrow, finance, referral, and communication events into canonical threads/notifications.

## Observability

- Stores webhook logs, delivery attempts, last error codes/messages, dead-letter timestamps, escalation rows, and communication metrics.
- Provider request/response details are redacted before persistence.

## Privacy, Consent, and Authorization Guarantees

- RLS is enabled on new tables as defense in depth.
- User routes use authenticated user context; admin routes use existing auth/admin middleware.
- Preferences distinguish transactional and marketing communications.
- AI/handoff logic avoids private evidence and business-state fabrication.
- No provider token, raw authorization header, or secret is logged by the new code.

## Files Changed

- Spec/docs: `AGENT_8_OMNICHANNEL_COMMUNICATION_GOAL_LOOP.md`, `docs/agent-8-omnichannel/*`.
- Database/shared: Agent 8 migration, `shared/types/communication.ts`, `shared/types/index.ts`.
- Backend services/routes: `backend/services/communication/*`, communication/admin routes, server registration, CSRF webhook allowlist, marketplace/finance event bridges, env example.
- Web: API hook additions, owner/admin communication pages, routes, feature registry, dashboard navigation, route test.
- Mobile: communication API client, Messages tab, tab registration, contract test.
- Tests: backend communication engine test and Agent 8 Playwright WhatsApp/Telegram validation.

## Tests Run and Results

- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 25 passed.
- `node --test backend/tests/server-export.test.js` - 1 passed.
- `node --test backend/tests/diaspora-csrf-flow.test.js backend/tests/referral-engine-route-smoke.test.js` - 15 passed with local server binding.
- `node --test backend/tests/audit-logger.test.js backend/tests/referral-engine-e2e-stack.test.js` - 8 passed.
- `node --test backend/tests/marketplace-v1-spine.test.js backend/tests/marketplace-classification-backfill.test.js` - 71 passed.
- `npm run test:unit --workspace=web -- --run src/config/communicationNavigation.test.ts` - 2 passed.
- `cd web && npx eslint src/pages/dashboard/owner/Communications.tsx src/pages/dashboard/admin/Communications.tsx src/config/communicationNavigation.test.ts` - passed.
- `npx tsc --noEmit --project web/tsconfig.app.json` - passed.
- `npm run build --workspace=web` - passed with existing large chunk warning.
- `npx tsc --noEmit --project mobile/tsconfig.json` - passed.
- `cd mobile && npx tsx tests/communication-api.test.ts` - passed.
- `npm run test:qa -- tests/agents/08-whatsapp-telegram.spec.ts` - 6 passed across Chromium and Mobile Chrome.
- `git diff --check` - passed.

## Live Provider Verification

- Provider: WhatsApp, Telegram, Instagram/Facebook, email, SMS, push.
- Environment: local deterministic fake/test provider only.
- Result: no live provider delivery was claimed.
- Limitations: real provider credentials and webhook secrets must be added before sandbox/live delivery verification.

## Known Limitations

- Full web lint still reports pre-existing app-wide lint debt outside Agent 8; Agent 8 targeted web lint passes.
- Full mobile lint still reports a pre-existing auth registration lint error and warnings outside Agent 8; mobile type-check and Agent 8 contract tests pass.
- Provider adapters are configuration-gated and ready for credentials, but live provider send/webhook verification was not performed.

## Migration / Deployment Order

1. Deploy `20260623143000_omnichannel_communication_engine.sql`.
2. Deploy backend routes/services/listeners and environment variable contract.
3. Configure provider credentials and webhook secrets.
4. Deploy web and mobile updates.
5. Enable or schedule communication delivery worker processing.
6. Run deterministic fake-provider smoke tests.
7. Run sandbox/live provider verification after credentials are configured.

## Rollback Plan

1. Disable provider credentials or set `COMMUNICATION_ENGINE_ENABLED=false`.
2. Stop the communication delivery worker.
3. Revert the application deployment.
4. Keep the additive migration during rollback to preserve audit/message history.
5. If database rollback is unavoidable, archive communication tables first.

## Manual QA Checklist

- [ ] Create a marketplace share link for WhatsApp and verify referral/listing parameters.
- [ ] Create a Telegram share/start link.
- [ ] Send duplicate fake WhatsApp webhook and confirm one message.
- [ ] Send duplicate Telegram update and confirm one message.
- [ ] Create web chat inquiry and confirm thread/admin inbox.
- [ ] Ask safe FAQ and confirm AI answer.
- [ ] Ask for a human and confirm escalation.
- [ ] Trigger low-confidence AI path and confirm human handoff.
- [ ] Trigger marketplace inquiry notification.
- [ ] Trigger available escrow status notification.
- [ ] Trigger available finance status notification.
- [ ] Simulate retryable provider failure and successful retry.
- [ ] Simulate permanent failure and dead letter.
- [ ] Retry dead-letter item as admin.
- [ ] Confirm marketing opt-out suppression.
- [ ] Confirm quiet-hour delay for non-urgent message.
- [ ] Confirm urgent/security bypass rule where configured.
- [ ] Confirm fallback uses only permitted verified channel.
- [ ] Confirm user cannot read another user's thread.
- [ ] Confirm non-admin cannot open admin communication routes.
- [ ] Confirm internal note is not visible to user.
- [ ] Confirm logs contain no provider token or raw authorization header.
- [ ] Confirm mobile deep link opens permitted destination.
- [ ] Confirm unread/read synchronization.
- [ ] Confirm feedback can reopen resolved thread.

## Follow-Up Work

- Add real provider credentials in staging and run provider sandbox verification.
- Address repository-wide pre-existing lint debt in a separate cleanup PR.
- Tune web bundle splitting for the existing large Vite output warning.

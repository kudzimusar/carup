# Agent 8 — Omnichannel Communication Engine

## Summary

Implements the production-testable CarUp Omnichannel Communication Engine across database, backend services, API routes, provider-neutral adapters, notification delivery, web/mobile user surfaces, admin command center, AI handoff safety, referral/marketplace/escrow/finance integration, tests, and evidence documentation.

Review correction commit `b44eee7` addresses all five Codex review threads: admin reply queueing, Meta GET verification, raw-body Meta HMAC verification, legacy BIGSERIAL notification queue compatibility, and exception-safe provider delivery retries/dead letters.

Activation update: PR #88 has been merged, PR #100 has been rebased/retargeted to `main`, and the Agent 8 database layer has been applied and verified on Supabase staging project `carup-staging` (`eoyenigwevnxwwhyhaer`) only. Production Supabase was not modified.

Latest staging activation hardening commit: `3a848ef` (`fix(communication): harden staging activation schema`).

Latest native navigation gate fix commit: `4da5c15` (`fix(mobile): preserve native tab budget with messages`).

Latest navigation e2e count fix commit: `02ddb68` (`test(navigation): account for communication entries`).

Latest follow-up Codex review fix commit: `7c30980` (`fix(communication): address follow-up review defects`).

## Dependency / Base

- Main SHA: `c25b094` recorded before implementation.
- Referral PR #88 status: merged into `main`.
- PR #88 merge commit: `37cc485c94e85d793c5887c391e155a96a9264fc`.
- PR #100 strategy now used: `feature/agent-8-omnichannel-communication-engine` rebased and retargeted to `main`.
- PR #100 rebased head before staging hardening commits: `bb731e93556bcc9d77ab7a2cdf165bd6d392d1aa`.

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
- Adds staging hardening follow-up migrations `database/migrations/20260624044812_agent8_communication_runtime_security_hardening.sql` and `database/migrations/20260624045600_agent8_communication_fk_indexes.sql`.
- Creates `message_threads`, `channel_identities`, `message_participants`, `messages`, `message_delivery_attempts`, `webhook_logs`, `communication_preferences`, and `communication_escalations`.
- Extends `notification_queue` with canonical Agent 8 delivery fields and legacy-compatible status/channel checks.
- Extends `domain_events` with outbox metadata needed by the communication listener path.
- Enables RLS and policies for user/admin read boundaries, canonical notification queue visibility, audit rows, and preference ownership.

## Staging Activation

Applied to Supabase staging `carup-staging` (`eoyenigwevnxwwhyhaer`) only:

- `agent_8_omnichannel_communication_engine`
- `agent_8_communication_provider_runtime`
- `agent8_communication_runtime_security_hardening`
- `agent8_communication_admin_audit_policies`
- `agent8_communication_fk_indexes`

Verified on staging:

- All Agent 8 communication tables exist.
- RLS is enabled on all target tables, including legacy `notification_queue`.
- User-visible and admin-audit policies exist.
- `claim_due_communication_notifications(...)` is `SECURITY DEFINER`, uses `FOR UPDATE SKIP LOCKED`, casts legacy `scheduled_at`, and is executable only by owner/postgres and `service_role`.
- Existing `notification_queue.id` remains `BIGSERIAL`/`bigint` with its sequence default.
- A disposable Agent 8 queue row was claimed exactly once and then removed.
- All Agent 8 communication foreign keys have covering indexes.

Full activation evidence and the channel status matrix are in `docs/agent-8-omnichannel/ACTIVATION_EVIDENCE.md`.

## Follow-Up Codex Review Corrections

Commit `7c30980` resolves the latest four Codex review threads:

- Guarded the early staging-hardening migration's claim RPC grants with `to_regprocedure(...)` so fresh databases do not fail before the provider runtime migration creates the function.
- Preserved trusted authenticated ownership on preference updates by whitelisting preference fields and keeping route-provided `user_id` / `tenant_id`.
- Kept legacy `notification_queue.recipient_id` user-only for external identity deliveries and relied on `recipient_identity_id` for contacts without CarUp users.
- Replaced plain invalid-webhook errors with `ForbiddenError` so rejected provider signatures return 403 instead of 500.

## Vercel Staging Preview Activation

The local backend checkout was linked to `pay-pass-project/carup-backend-staging`.
Branch-scoped Preview envs were added for
`feature/agent-8-omnichannel-communication-engine`:

- `COMMUNICATION_ENGINE_ENABLED=true`
- `COMMUNICATION_WORKER_ENABLED=true`
- `COMMUNICATION_WORKER_SECRET`
- `CRON_SECRET`

The generated secret values were stored by Vercel without being printed or
committed. Production Vercel envs were not changed. The 1-5 minute scheduler
still needs a shared secret provisioned into both the scheduler and backend, or
Vercel Pro/external scheduling; the bundled Vercel cron remains daily-compatible
for Hobby limits.

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
- Verifies Telegram secret tokens, Meta GET callback challenges, Meta raw-body `x-hub-signature-256` HMAC signatures, and shared-secret gateway headers when Meta app secret is not configured.
- Logs webhooks with dedupe keys and returns safe success for duplicates without duplicate messages.
- Adds CSRF machine-webhook exemption only for communication webhook paths; route-level webhook auth remains required.

## Retry, Fallback, and Dead Letter

- Delivery worker records attempts, retryable failures, exponential backoff, max-attempt dead letters, admin retry, and admin cancel.
- Provider SDK/network exceptions are caught, recorded as delivery attempts, locks are cleared, and rows move to retry/backoff or dead letter.
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
- User-visible admin replies create one outbound message plus one `notification_queue` row for delivery; internal admin notes remain internal and are never queued externally.
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

- `node --test backend/tests/communication-engine.test.js` - 35 passed, including Codex review regressions for admin reply queueing, internal-note suppression, valid/invalid Meta GET verification, raw-body Meta signature pass/fail, legacy BIGSERIAL queue IDs, legacy TEXT queue retry, thrown adapter retry/dead-letter handling, provider runtime coverage, scheduler-safe claim/recovery, migration hardening assertions, guarded runtime-hardening RPC grants, preference ownership preservation, external identity queue FK safety, and 403 invalid-webhook errors.
- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 50 passed.
- `node --test backend/tests/referral-channel-gateway-phase3.test.js` - 15 passed before PR #88 merge.
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
- `cd mobile && npx tsx tests/native-navigation.test.ts` - 19 passed after preserving the native More-tab budget.
- `cd mobile && npx tsx tests/native-tabs.test.ts` - 18 passed after keeping Messages visible and Referrals drawer-placed.
- `cd mobile && npx tsx tests/native-drawer.test.ts` - 28 passed after moving Referrals into the governed drawer.
- `node scripts/generate-feature-manifest.mjs --check` - passed.
- GitHub `navigation-e2e` - passed after updating owner/admin dashboard item counts for Agent 8 Communications entries.
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
- Vercel backend checkout is now linked to `carup-backend-staging`, and branch-scoped Preview worker envs were configured. Non-preview staging/production envs were not changed.
- No SendGrid, Twilio, Meta, Telegram, or Expo credentials/account resources were available; live provider UAT was not claimed.
- No physical device was available for push notification validation.

## Migration / Deployment Order

1. Deploy `20260623143000_omnichannel_communication_engine.sql`.
2. Deploy `20260624120000_communication_provider_runtime.sql`.
3. Deploy or confirm `20260624044812_agent8_communication_runtime_security_hardening.sql` and `20260624045600_agent8_communication_fk_indexes.sql` on environments where the first two migrations were already applied without the new source hardening.
4. Deploy backend routes/services/listeners and environment variable contract.
5. Configure provider credentials and webhook secrets.
6. Deploy web and mobile updates.
7. Enable or schedule communication delivery worker processing.
8. Run deterministic fake-provider smoke tests.
9. Run sandbox/live provider verification after credentials are configured.

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

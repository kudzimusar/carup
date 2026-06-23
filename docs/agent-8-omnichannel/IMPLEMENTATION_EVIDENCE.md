# Agent 8 Implementation Evidence

Branch: `feature/agent-8-omnichannel-communication-engine`

Base strategy: stacked on `origin/feat/referral-final-uat-release` because PR #88 is open and clean.

Main SHA recorded before implementation: `c25b094`

Current base commit for this branch before Agent 8 commits: `e7a2f60afc35a90ffad3b17352e459742fb6d10b`

Latest Codex review-fix commit: `b44eee7` (`fix(communication): address codex review delivery defects`)

## Acceptance Ledger

| Area | Status | Evidence |
| --- | --- | --- |
| Canonical architecture | PASS | Added durable thread, participant, message, identity, webhook log, delivery attempt, preference, escalation tables. Existing `notification_queue` and `domain_events` are the canonical queue/outbox. |
| Channels | PASS | Common adapter contract covers WhatsApp, Telegram, Instagram, Facebook, email, SMS, web chat, mobile chat, in-app, and push. Fake adapter covers CI without credentials. WhatsApp and Telegram are covered by deterministic backend and Playwright tests. |
| User experience | PASS | Web and mobile communication surfaces expose notifications, support/chat, marketplace share, feedback, and preferences. |
| Admin | PASS | Admin routes and web command center support list, assign, reply, escalate, resolve, reopen, metrics, and dead-letter recovery. |
| Reliability | PASS | Queueing, dedupe keys, webhook logs, delivery attempts, exponential backoff, dead-letter retry/cancel, and consent-aware channel selection are implemented and tested. |
| Integrations | PASS | Reuses referral channel gateway. Marketplace inquiry/share, escrow domain events, and finance application status emit/map into communication notifications. |
| Safety | PASS | AI service forces handoff for finance/escrow/payment decisions, never mutates business truth, and uses backend state/templates for authoritative updates. RLS policies, admin middleware, CSRF webhook exceptions, and secret redaction are in place. |
| Verification | PASS with notes | Focused backend, web, mobile, Playwright, security, migration, marketplace, audit, referral regression, type-check, and build commands pass. Full web/mobile lint still reports pre-existing issues outside Agent 8; targeted Agent 8 web lint passes. |

## Codex Review Corrections

Resolved in commit `b44eee7`:

- Admin user-visible replies now create the canonical outbound `messages` row and attach a `notification_queue` row that the existing delivery worker can send. Internal admin notes remain `internal` messages and do not create external queue rows.
- Communication webhooks now support Meta GET callback verification for WhatsApp, Facebook, and Instagram. Valid `hub.mode=subscribe` requests return `hub.challenge` as plain text; invalid tokens are rejected.
- Meta POST webhook HMAC verification now uses the exact raw request body captured by the Express JSON parser for `/api/communications/webhooks/meta/*` and passed into `CommunicationWebhookService`.
- Notification enqueue no longer forces UUID IDs into `notification_queue`; the database default is used unless an explicit ID is supplied. The test harness now emulates legacy BIGSERIAL queue IDs.
- Provider adapter exceptions are normalized into delivery failure results, recorded in `message_delivery_attempts`, and routed through retry/backoff or dead-letter handling with locks cleared.

## Tests Run And Results

Passing:

- `node --test backend/tests/communication-engine.test.js` - 19 passed, including Codex review regressions for admin reply queueing, internal-note suppression, Meta GET verification, raw-body HMAC, legacy BIGSERIAL queue IDs, and thrown adapter retry/dead-letter handling.
- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 34 passed.
- `node --test backend/tests/server-export.test.js` - 1 passed. Supabase live connection warning is expected without live credentials.
- `node --test backend/tests/diaspora-csrf-flow.test.js backend/tests/referral-engine-route-smoke.test.js` - 15 passed with localhost binding escalation.
- `node --test backend/tests/audit-logger.test.js backend/tests/referral-engine-e2e-stack.test.js` - 8 passed.
- `node --test backend/tests/marketplace-v1-spine.test.js backend/tests/marketplace-classification-backfill.test.js` - 71 passed. Hermetic tests log best-effort domain event fetch failures because no Supabase network is available, but assertions pass.
- `npm run test:unit --workspace=web -- --run src/config/communicationNavigation.test.ts` - 1 file, 2 tests passed.
- `cd web && npx eslint src/pages/dashboard/owner/Communications.tsx src/pages/dashboard/admin/Communications.tsx src/config/communicationNavigation.test.ts` - passed.
- `npx tsc --noEmit --project web/tsconfig.app.json` - passed.
- `npm run build --workspace=web` - passed. Existing Vite chunk-size warning remains: main JS chunk about 2,051 kB before gzip.
- `npx tsc --noEmit --project mobile/tsconfig.json` - passed.
- `cd mobile && npx tsx tests/communication-api.test.ts` - passed with normal IPC escalation for `tsx`.
- `npm run test:qa -- tests/agents/08-whatsapp-telegram.spec.ts` - 6 passed across Chromium and Mobile Chrome with local Vite server binding.
- `git diff --check` - passed.

Non-blocking existing lint debt:

- `npm run lint --workspace=web` still fails on pre-existing app-wide lint issues including `react-refresh/only-export-components`, existing `any` usage, and React compiler hook rules in older files. Agent 8 targeted web lint passes.
- `npm run lint --workspace=mobile` still fails on a pre-existing `react/no-unescaped-entities` error in `mobile/app/(auth)/register.tsx` and existing warnings in auth/verification/garage files. Agent 8 removed the new unused imports it surfaced.

## Live Provider Verification

- Provider: WhatsApp, Telegram, Instagram/Facebook, email, SMS, push.
- Environment: local deterministic fake/test provider only.
- Result: no live provider delivery was claimed or attempted.
- Limitations: real provider credentials and webhook secrets must be configured before sandbox/live delivery verification.

## Configuration Still Required

- `CARUP_META_WEBHOOK_VERIFY_TOKEN`
- `CARUP_META_WEBHOOK_APP_SECRET`
- `CARUP_META_ACCESS_TOKEN`
- `CARUP_META_PHONE_NUMBER_ID`
- `CARUP_TELEGRAM_BOT_TOKEN`
- `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `CARUP_SENDGRID_API_KEY`
- `CARUP_SENDGRID_FROM_EMAIL`
- `CARUP_TWILIO_ACCOUNT_SID`
- `CARUP_TWILIO_AUTH_TOKEN`
- `CARUP_TWILIO_MESSAGING_SERVICE_SID`
- `CARUP_PUSH_PROVIDER`
- `CARUP_PUSH_SERVICE_KEY`

## Deployment Order

1. Deploy the migration `20260623143000_omnichannel_communication_engine.sql`.
2. Deploy backend services, routes, adapters, event listeners, and environment variable contract.
3. Configure provider secrets in the target environment.
4. Deploy web and mobile application updates.
5. Enable or schedule the communication delivery worker.
6. Run smoke tests with the deterministic fake provider.
7. Run live provider sandbox verification only after credentials are available.

## Rollback Plan

1. Disable provider credentials or set `COMMUNICATION_ENGINE_ENABLED=false`.
2. Stop the communication delivery worker.
3. Revert the application deploy.
4. Leave the additive migration in place during rollback to preserve audit/thread history.
5. If a database rollback is required, archive communication tables first because they contain message/audit history.

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

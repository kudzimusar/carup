# Agent 8 Implementation Evidence

Branch: `feature/agent-8-omnichannel-communication-engine`

Base strategy: stacked on `origin/feat/referral-final-uat-release` because PR #88 is open and clean.

Main SHA recorded before implementation: `c25b094`

Current base commit for this branch before Agent 8 commits: `e7a2f60afc35a90ffad3b17352e459742fb6d10b`

Latest Codex review-fix commit: `b44eee7` (`fix(communication): address codex review delivery defects`)

Latest provider-runtime commits:

- `ab8a11a` (`feat(communication): add real provider adapters`)
- `b28467f` (`feat(communication): add durable delivery scheduler`)
- branch-head evidence commit (`test(communication): cover provider runtime`; exact SHA recorded in PR body after push)

## Connector And Provider Discovery

Discovery date: 2026-06-24.

All checks below were read-only or unauthenticated reachability checks. No provider secrets were printed, committed, or logged.

| Resource | Availability | Auth validity | Sender/webhook resource | Live-test capability | Remaining action |
| --- | --- | --- | --- | --- | --- |
| GitHub | Available through `gh` CLI | Authenticated as `kudzimusar`; token scopes include `repo` and `workflow` | PR #100 is open, base `feat/referral-final-uat-release`, head `feature/agent-8-omnichannel-communication-engine`, auto-merge disabled | Can push branch, update PR, and request review | None for PR maintenance |
| Supabase staging | Visible through Supabase MCP as `carup-staging` (`eoyenigwevnxwwhyhaer`) | Project list succeeded; subsequent migration inspection required app reauthentication | Staging database exists and is healthy; migration apply is blocked until connector reauth or a correctly linked CLI is available | Cannot safely apply staging migrations in this session after reauth requirement | Reauthenticate Supabase MCP or link CLI to CarUp staging before applying migrations |
| Supabase local CLI | CLI installed (`2.98.2`) | Authenticated, but project list does not include CarUp/CarUp staging | No CarUp project ref linked in checkout | Not suitable for CarUp staging mutations | Reauth/link CLI to `eoyenigwevnxwwhyhaer` if MCP remains blocked |
| Vercel | CLI installed (`54.7.1`) and `vercel whoami` succeeds as `kudzimusar` | Authenticated locally, but checkout is not linked and project listing did not expose PR projects | GitHub PR status shows Vercel projects `carup`, `carup-backend`, `carup-staging`, and `carup-backend-staging`; local env listing is blocked by missing Vercel link | Cannot configure env or deploy staging from this checkout without a safe project link | Link the checkout to the intended Vercel project/team or provide Vercel project IDs for staging |
| SendGrid | API endpoint reachable; unauthenticated `/v3/scopes` returned `401` | No local `SENDGRID_API_KEY` detected and no connector tool exposed | `SENDGRID_FROM_EMAIL` and webhook verification key are not present in local env files yet | Authenticated account health/send/webhook UAT blocked | Add provider secrets in staging and verify sender identity/webhook signing key |
| Twilio | API endpoint reachable; unauthenticated Accounts API returned `401` | No local `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` detected and no Twilio CLI installed | No local messaging service SID/from number found | Authenticated SMS/WhatsApp sandbox UAT blocked | Add Twilio credentials and sender or messaging service in staging |
| Meta Graph / WhatsApp / Facebook / Instagram | Graph API reachable; unauthenticated root returned `400` | No local `CARUP_META_ACCESS_TOKEN` detected | Env examples include Meta access token, app secret, webhook verify token, and phone number ID placeholders | Authenticated account/page/phone/webhook UAT blocked | Add Meta token, app secret, phone number ID, page ID, and configure webhook URL |
| Telegram | API host reachable; unauthenticated root returned redirect | No local `CARUP_TELEGRAM_BOT_TOKEN` detected | Env examples include bot token and webhook secret token placeholders | Bot `getMe`, webhook registration, and message UAT blocked | Add bot token and webhook secret in staging |
| Expo Push | Push endpoint reachable; POST-only endpoint returned `405` to safe GET | No local `EXPO_ACCESS_TOKEN` detected | Env examples include Expo access token placeholder | Push ticket/receipt UAT blocked without Expo token and device push token | Add Expo access token and test device token in staging |

## Acceptance Ledger

| Area | Status | Evidence |
| --- | --- | --- |
| Canonical architecture | PASS | Added durable thread, participant, message, identity, webhook log, delivery attempt, preference, escalation tables. Existing `notification_queue` and `domain_events` are the canonical queue/outbox. |
| Channels | PASS | Common adapter contract covers WhatsApp, Telegram, Instagram, Facebook, email, SMS, web chat, mobile chat, in-app, and push. Real HTTP adapters now exist for SendGrid, Twilio SMS, Meta WhatsApp Cloud API, Facebook Messenger, Instagram Messaging, Telegram Bot API, and Expo Push. Fake adapter covers CI without credentials. WhatsApp and Telegram are covered by deterministic backend and Playwright tests. |
| User experience | PASS | Web and mobile communication surfaces expose notifications, support/chat, marketplace share, feedback, and preferences. |
| Admin | PASS | Admin routes and web command center support list, assign, reply, escalate, resolve, reopen, metrics, and dead-letter recovery. |
| Reliability | PASS | Queueing, dedupe keys, webhook logs, delivery attempts, exponential backoff, dead-letter retry/cancel, provider receipt updates, scheduler-safe notification claiming, stale lock recovery, authenticated internal processing endpoint, and consent-aware channel selection are implemented and tested. |
| Integrations | PASS | Reuses referral channel gateway. Marketplace inquiry/share, escrow domain events, and finance application status emit/map into communication notifications. |
| Safety | PASS | AI service forces handoff for finance/escrow/payment decisions, never mutates business truth, and uses backend state/templates for authoritative updates. RLS policies, admin middleware, CSRF webhook exceptions, and secret redaction are in place. |
| Verification | PASS with notes | Focused backend, web, mobile, Playwright, security, migration, marketplace, audit, referral regression, type-check, and build commands pass. Provider-runtime regression has 31 passing communication tests and 46 passing communication/referral tests. Full web/mobile lint still reports pre-existing issues outside Agent 8; targeted Agent 8 web lint passes. |

## Provider Runtime Addendum

Implemented after connector discovery:

- Real SendGrid Mail Send adapter with configuration validation, bearer auth, custom args for notification/message IDs, normalized accepted/error results, and signed Event Webhook verification.
- Real Twilio SMS adapter using Programmable Messaging form-encoded API, messaging-service or from-number configuration, status callback URL support, normalized SID/status mapping, and Twilio callback signature verification.
- Real Meta WhatsApp Cloud API adapter using `CARUP_META_PHONE_NUMBER_ID` and Graph `/messages`, plus Meta status receipt extraction.
- Real Facebook Messenger and Instagram Messaging adapters using Meta Graph scoped recipient IDs.
- Real Telegram Bot API adapter using `sendMessage` with bot token validation.
- Real Expo Push adapter using ticket IDs and receipt processing.
- Durable delivery runtime now claims due/stale notifications through `claim_due_communication_notifications(...)` using `FOR UPDATE SKIP LOCKED`, preventing duplicate concurrent sends and recovering stale processing locks.
- Added authenticated scheduler endpoint `POST /api/internal/communications/process`, protected by `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET`, and backend `vercel.json` cron declaration for five-minute processing.
- Production registry no longer treats missing provider credentials as fake delivery. Production uses real adapters that fail closed with `provider_not_configured`; fake adapters remain deterministic for development/test.
- Domain event listeners now fail safely when Agent 8 communication tables have not yet been migrated: they log one migration warning and skip communication fanout unless `COMMUNICATION_ENGINE_ENABLED=true` is explicitly set after migration.

## Codex Review Corrections

Resolved in commit `b44eee7`:

- Admin user-visible replies now create the canonical outbound `messages` row and attach a `notification_queue` row that the existing delivery worker can send. Internal admin notes remain `internal` messages and do not create external queue rows.
- Communication webhooks now support Meta GET callback verification for WhatsApp, Facebook, and Instagram. Valid `hub.mode=subscribe` requests return `hub.challenge` as plain text; invalid tokens are rejected.
- Meta POST webhook HMAC verification now uses the exact raw request body captured by the Express JSON parser for `/api/communications/webhooks/meta/*` and passed into `CommunicationWebhookService`.
- Notification enqueue no longer forces UUID IDs into `notification_queue`; the database default is used unless an explicit ID is supplied. The test harness now emulates legacy BIGSERIAL queue IDs.
- Provider adapter exceptions are normalized into delivery failure results, recorded in `message_delivery_attempts`, and routed through retry/backoff or dead-letter handling with locks cleared.

## Tests Run And Results

Passing:

- `node --test backend/tests/communication-engine.test.js` - 32 passed, including real provider adapter request/response mapping, SendGrid signed webhook verification, Twilio status signature verification, provider receipt updates, scheduler-safe claim/recovery, internal processor authentication, missing-migration listener guard, Codex review regressions for admin reply queueing, internal-note suppression, Meta GET verification, raw-body HMAC, legacy BIGSERIAL queue IDs, and thrown adapter retry/dead-letter handling.
- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 46 passed.
- `node backend/tests/run-tests.js` - passed with network escalation for live Supabase access. Initial sandboxed run failed at Supabase fetch; rerun passed all 35 governance/integration/trust/security checks. The live database used by the suite does not yet have Agent 8 tables, so communication fanout logs a single migration warning and skips until `COMMUNICATION_ENGINE_ENABLED=true` after migration.
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
- Secret-pattern scan over changed communication/env/evidence files found no committed provider credentials. It matched only pre-existing generated fake `sk_live_` test-token strings in `backend/server.js`.

Non-blocking existing lint debt:

- `npm run lint --workspace=web` still fails on pre-existing app-wide lint issues including `react-refresh/only-export-components`, existing `any` usage, and React compiler hook rules in older files. Agent 8 targeted web lint passes.
- `npm run lint --workspace=mobile` still fails on a pre-existing `react/no-unescaped-entities` error in `mobile/app/(auth)/register.tsx` and existing warnings in auth/verification/garage files. Agent 8 removed the new unused imports it surfaced.

## Live Provider Verification

- Provider: WhatsApp, Telegram, Instagram/Facebook, email, SMS, push.
- Environment: local deterministic fake/test provider and real-client unit harness with fake fetch/signature inputs.
- Result: real provider clients and webhook verification paths are implemented and tested without live sends. Provider endpoint reachability was checked safely: SendGrid `401`, Twilio `401`, Meta `400`, Telegram redirect, Expo `405` on safe unauthenticated probes.
- Limitations: no live provider delivery was claimed or attempted. Authenticated sandbox/live UAT is blocked until provider credentials, sender resources, callback URLs, and staging secrets are configured.

## Configuration Still Required

- `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`
- `TWILIO_STATUS_CALLBACK_URL`
- `CARUP_META_WEBHOOK_VERIFY_TOKEN`
- `CARUP_META_ACCESS_TOKEN`
- `CARUP_META_APP_SECRET`
- `CARUP_META_PHONE_NUMBER_ID`
- `CARUP_META_PAGE_ID`
- `CARUP_TELEGRAM_BOT_TOKEN`
- `CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `EXPO_ACCESS_TOKEN`

## Deployment Order

1. Deploy the migration `20260623143000_omnichannel_communication_engine.sql`.
2. Deploy the migration `20260624120000_communication_provider_runtime.sql`.
3. Deploy backend services, routes, adapters, event listeners, and environment variable contract.
4. Configure provider secrets and `COMMUNICATION_WORKER_SECRET`/`CRON_SECRET` in the target environment.
5. Deploy web and mobile application updates.
6. Enable the backend cron/scheduler for `/api/internal/communications/process`.
7. Run smoke tests with the deterministic fake provider.
8. Register provider webhooks and run live provider sandbox verification only after credentials are available.

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

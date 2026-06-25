# Agent 8 Implementation Evidence

Branch: `feature/agent-8-omnichannel-communication-engine`

Base strategy: PR #88 was verified, merged to `main`, and PR #100 was rebased/retargeted to `main`.

Main SHA recorded before implementation: `c25b094`

PR #88 merge commit: `37cc485c94e85d793c5887c391e155a96a9264fc`

Current rebased PR #100 head before staging activation hardening: `bb731e93556bcc9d77ab7a2cdf165bd6d392d1aa`

Latest Codex review-fix commit: `b44eee7` (`fix(communication): address codex review delivery defects`)

Latest staging activation hardening commit: `3a848ef` (`fix(communication): harden staging activation schema`)

Latest native navigation gate fix commit: `4da5c15` (`fix(mobile): preserve native tab budget with messages`)

Latest navigation e2e count fix commit: `02ddb68` (`test(navigation): account for communication entries`)

Latest follow-up Codex review fix commit: `7c30980` (`fix(communication): address follow-up review defects`)

Latest final Codex review fix commit: `05cdea7` (`fix(communication): address final review thread gaps`)

Latest Cloudflare email activation commit: pending local commit (`feat(communication): add cloudflare email edge integration`)

Latest provider-runtime commits:

- `ab8a11a` (`feat(communication): add real provider adapters`)
- `b28467f` (`feat(communication): add durable delivery scheduler`)
- branch-head evidence commit (`test(communication): cover provider runtime`; exact SHA recorded in PR body after push)

## Connector And Provider Discovery

Discovery date: 2026-06-24.

All checks below were read-only or unauthenticated reachability checks. No provider secrets were printed, committed, or logged.

| Resource | Availability | Auth validity | Sender/webhook resource | Live-test capability | Remaining action |
| --- | --- | --- | --- | --- | --- |
| GitHub | Available through `gh` CLI | Authenticated as `kudzimusar`; token scopes include `repo` and `workflow` | PR #88 was merged; PR #100 is open on `main`, head `feature/agent-8-omnichannel-communication-engine`, auto-merge disabled | Can push branch, update PR, and request review | None for PR maintenance |
| Supabase staging | Visible through Supabase MCP as `carup-staging` (`eoyenigwevnxwwhyhaer`) | Project list, migrations, SQL checks, and advisors succeeded | Staging database exists and is healthy; Agent 8 migrations were applied to staging only | Database-layer staging verification completed | Configure staging app env/scheduler before provider UAT |
| Supabase local CLI | CLI installed (`2.98.2`) | Authenticated, but project list does not include CarUp/CarUp staging | No CarUp project ref linked in checkout | DB work was performed through Supabase MCP | Keep MCP as the migration path unless CLI is explicitly linked |
| Vercel | CLI installed (`54.7.1`) and `vercel whoami` succeeds as `kudzimusar` | Backend checkout linked to `pay-pass-project/carup-backend-staging` | Branch-scoped Preview envs added for `COMMUNICATION_ENGINE_ENABLED`, `COMMUNICATION_WORKER_ENABLED`, `COMMUNICATION_WORKER_SECRET`, and `CRON_SECRET` on `feature/agent-8-omnichannel-communication-engine` | Preview checks pass through GitHub; new preview deployments can pick up branch envs | Production envs were not changed; 1-5 minute scheduler still needs shared secret storage or Vercel Pro/external scheduler |
| Cloudflare | No Cloudflare connector exposed by tool search; `wrangler` not installed; no local `CLOUDFLARE*`/`CF_*` env vars found | Account/zone/API auth not discoverable | Email Service sender/domain, Email Routing address, Worker, Queues, DLQ, R2, WAF, and Cron are not configured | Live Cloudflare UAT blocked | Add staging Cloudflare account/zone/tooling/secrets, deploy Worker, configure DNS/routing/queues/cron, then run live inbox/UAT |
| SendGrid | API endpoint reachable; unauthenticated `/v3/scopes` returned `401` | No local `SENDGRID_API_KEY` detected and no connector tool exposed | `SENDGRID_FROM_EMAIL` and webhook verification key are not present in local env files yet | Authenticated account health/send/webhook UAT blocked | Add provider secrets in staging and verify sender identity/webhook signing key |
| Twilio | API endpoint reachable; unauthenticated Accounts API returned `401` | No local `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` detected and no Twilio CLI installed | No local messaging service SID/from number found | Authenticated SMS/WhatsApp sandbox UAT blocked | Add Twilio credentials and sender or messaging service in staging |
| Meta Graph / WhatsApp / Facebook / Instagram | Graph API reachable; unauthenticated root returned `400` | No local `CARUP_META_ACCESS_TOKEN` detected | Env examples include Meta access token, app secret, webhook verify token, and phone number ID placeholders | Authenticated account/page/phone/webhook UAT blocked | Add Meta token, app secret, phone number ID, page ID, and configure webhook URL |
| Telegram | API host reachable; unauthenticated root returned redirect | No local `CARUP_TELEGRAM_BOT_TOKEN` detected | Env examples include bot token and webhook secret token placeholders | Bot `getMe`, webhook registration, and message UAT blocked | Add bot token and webhook secret in staging |
| Expo Push | Push endpoint reachable; POST-only endpoint returned `405` to safe GET | No local `EXPO_ACCESS_TOKEN` detected | Env examples include Expo access token placeholder | Push ticket/receipt UAT blocked without Expo token and device push token | Add Expo access token and test device token in staging |

## Activation Addendum

Staging activation was completed for the database layer on 2026-06-24 against Supabase project `carup-staging` (`eoyenigwevnxwwhyhaer`) only. Production Supabase project `CarUp` (`vhmnajoeicasaigiophh`) was observed but not modified.

Applied staging migrations:

- `agent_8_omnichannel_communication_engine`
- `agent_8_communication_provider_runtime`
- `agent8_communication_runtime_security_hardening`
- `agent8_communication_admin_audit_policies`
- `agent8_communication_fk_indexes`

Activation hardening added committed migration coverage for RLS on the existing canonical `notification_queue`, service-role-only execution of `claim_due_communication_notifications(...)`, admin audit read policies for delivery attempts and webhook logs, and covering indexes for Agent 8 foreign keys including legacy `notification_queue.recipient_id`.

Staging verification confirmed all Agent 8 tables exist, RLS is enabled on all target tables, the claim RPC uses `FOR UPDATE SKIP LOCKED`, legacy `BIGSERIAL` queue IDs are preserved, a disposable queue row could be claimed exactly once, and all Agent 8 communication foreign keys have covering indexes.

Vercel staging preview activation was partially completed by linking `backend/` to `pay-pass-project/carup-backend-staging` and adding branch-scoped Preview envs for `COMMUNICATION_ENGINE_ENABLED=true`, `COMMUNICATION_WORKER_ENABLED=true`, `COMMUNICATION_WORKER_SECRET`, and `CRON_SECRET` on `feature/agent-8-omnichannel-communication-engine`. The generated secret values were stored by Vercel without being printed or committed. Production Vercel envs were not changed.

See `docs/agent-8-omnichannel/ACTIVATION_EVIDENCE.md` for the full activation ledger and channel-by-channel status matrix.

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

- Cloudflare Email adapter (`cloudflare_email`) with `EMAIL_PROVIDER=cloudflare` selection, authenticated Worker outbound mode, official REST Email Sending fallback, provider health metadata, 5 MiB attachment guard, and explicit SendGrid fallback intent without automatic cross-provider delivery.
- Real SendGrid Mail Send adapter with configuration validation, bearer auth, custom args for notification/message IDs, normalized accepted/error results, and signed Event Webhook verification.
- Real Twilio SMS adapter using Programmable Messaging form-encoded API, messaging-service or from-number configuration, status callback URL support, normalized SID/status mapping, and Twilio callback signature verification.
- Real Meta WhatsApp Cloud API adapter using `CARUP_META_PHONE_NUMBER_ID` and Graph `/messages`, plus Meta status receipt extraction.
- Real Facebook Messenger and Instagram Messaging adapters using Meta Graph scoped recipient IDs.
- Real Telegram Bot API adapter using `sendMessage` with bot token validation.
- Real Expo Push adapter using ticket IDs and receipt processing.
- Durable delivery runtime now claims due/stale notifications through `claim_due_communication_notifications(...)` using `FOR UPDATE SKIP LOCKED`, preventing duplicate concurrent sends and recovering stale processing locks.
- Added authenticated scheduler endpoint `GET|POST /api/internal/communications/process`, protected by `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET`, and backend `vercel.json` cron declaration. The Vercel project is currently on a Hobby plan, so the bundled Vercel cron uses the daily-compatible `0 0 * * *` schedule; production-frequency processing should use Vercel Pro cron or an external/Supabase scheduler calling the same endpoint.
- Production registry no longer treats missing provider credentials as fake delivery. Production uses real adapters that fail closed with `provider_not_configured`; fake adapters remain deterministic for development/test.
- Domain event listeners now fail safely when Agent 8 communication tables have not yet been migrated: they log one migration warning and skip communication fanout unless `COMMUNICATION_ENGINE_ENABLED=true` is explicitly set after migration.

## Cloudflare Email And Edge Addendum

Implemented on 2026-06-25:

- Added `cloudflare/carup-communications-edge/` Worker project with `fetch`, `email`, `queue`, and `scheduled` handlers.
- Worker `fetch` supports health, authenticated diagnostics/callback, and authenticated `/email/send`.
- Worker `email()` parses inbound Email Routing metadata, enforces recipient/size/attachment checks, preserves Message-ID threading headers, and forwards a canonical signed payload to CarUp.
- Worker `queue()` consumes inbound/outbound transport jobs, retries transient failures, and hands terminal failures to DLQ when configured.
- Worker `scheduled()` calls protected CarUp `/api/internal/communications/process` for staging-frequency processing once deployed.
- Backend accepts `POST /api/communications/webhooks/cloudflare/email` through the existing provider/channel webhook route with exact raw-body HMAC verification, timestamp, nonce, body hash, optional Cloudflare Access service-token checks, recipient allow-list, attachment safety checks, dedupe, and canonical Supabase message storage.
- Cloudflare Queues remain transport-only. `notification_queue`, `messages`, `webhook_logs`, and `message_delivery_attempts` remain the canonical state.
- Added `docs/agent-8-omnichannel/CLOUDFLARE_ACTIVATION_EVIDENCE.md` with the redacted access matrix and provider readiness status.

Cloudflare live activation remains blocked: no connector, no Wrangler binary, no Cloudflare env vars, no account/zone credentials, no deployed Worker, no configured Email Service/Email Routing/Queues/R2/Cron/WAF/DNS, and no live inbound/outbound UAT evidence.

## Codex Review Corrections

Resolved in commit `b44eee7`:

- Admin user-visible replies now create the canonical outbound `messages` row and attach a `notification_queue` row that the existing delivery worker can send. Internal admin notes remain `internal` messages and do not create external queue rows.
- Communication webhooks now support Meta GET callback verification for WhatsApp, Facebook, and Instagram. Valid `hub.mode=subscribe` requests return `hub.challenge` as plain text; invalid tokens are rejected.
- Meta POST webhook HMAC verification now uses the exact raw request body captured by the Express JSON parser for `/api/communications/webhooks/meta/*` and passed into `CommunicationWebhookService`.
- Notification enqueue no longer forces UUID IDs into `notification_queue`; the database default is used unless an explicit ID is supplied. The test harness now emulates legacy BIGSERIAL queue IDs.
- Provider adapter exceptions are normalized into delivery failure results, recorded in `message_delivery_attempts`, and routed through retry/backoff or dead-letter handling with locks cleared.

Resolved fresh Codex follow-up review in commit `a286f9c`:

- Granted `service_role` execute permission on `claim_due_communication_notifications(TEXT, INTEGER, INTEGER)` after the public revoke, so the service-role Supabase client can call the durable claim RPC.
- Cast legacy `notification_queue.scheduled_at` values to `timestamptz` inside the claim RPC due-date comparisons and ordering, preserving compatibility with text-backed legacy queues.
- Added safe legacy TEXT queue handling: the migration supplies a `gen_random_uuid()::text` default when a text `notification_queue.id` column has no default, and the repository retries notification inserts with a generated UUID only when a legacy no-default text ID error is observed. BIGSERIAL queues continue to use the database default.
- Admin replies to guest/external requester identities now create canonical queue rows with `recipient_identity_id` and provider delivery payloads, so WhatsApp, Telegram, Facebook, Instagram, SMS, email, and push identity threads can be delivered by the existing worker even when `primary_user_id` is null.
- Added regressions for external-identity admin reply delivery, legacy TEXT queue retry, migration grant/casts/defaults, and retained the existing admin-user reply, internal-note, Meta verification/signature, BIGSERIAL, retry, and dead-letter coverage.

Resolved second fresh Codex follow-up review in commit `7c30980`:

- Guarded the early staging-hardening migration's claim RPC grants with `to_regprocedure(...)` so fresh databases do not fail before the provider runtime migration creates the function.
- Preserved trusted authenticated ownership on preference updates by whitelisting preference fields and keeping route-provided `user_id` / `tenant_id`.
- Kept legacy `notification_queue.recipient_id` user-only for external identity deliveries and relied on `recipient_identity_id` for WhatsApp/Telegram/Facebook/Instagram/SMS/email/push contacts without CarUp users.
- Replaced plain invalid-webhook `Error` throws with `ForbiddenError` so central middleware returns 403 instead of 500 for rejected provider signatures.

Resolved final Codex follow-up review in commit `05cdea7`:

- Added legacy queue compatibility columns (`type`, `title`, `message`, `read`) to the additive Agent 8 `notification_queue` migration so deployments that started from `002_add_notification_queue.sql` have every column written by the canonical queue service.
- Preserved the authorized target thread for user-visible `POST /api/communications/threads/:id/messages` sends by passing the loaded thread into inbound ingestion and teaching ingestion to use a trusted target thread instead of rediscovering a new thread from message intent.
- Moved communication route/admin route imports in `backend/tests/communication-engine.test.js` behind test Supabase env setup so clean environments without Supabase variables do not fail before tests execute.
- Added regressions for clean-env route import, target-thread preservation with marketplace-looking text in a support thread, and legacy queue column migration coverage.

## Tests Run And Results

Passing:

- `/usr/bin/env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node --test backend/tests/communication-engine.test.js` - 36 passed, proving the communication test suite sets safe dummy Supabase env before dynamic route imports.
- `/usr/bin/env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node --test backend/tests/communication-engine.test.js` - 42 passed after Cloudflare email adapter, webhook, and Worker contract coverage.
- `node --test cloudflare/carup-communications-edge/test/edge.test.js` - 6 passed.
- `node --check cloudflare/carup-communications-edge/src/index.js` - passed.
- `node --test backend/tests/communication-engine.test.js` - 36 passed, including real provider adapter request/response mapping, SendGrid signed webhook verification, Twilio status signature verification, provider receipt updates, scheduler-safe claim/recovery, internal processor GET/POST authentication, missing-migration listener guard, Codex review regressions for admin reply queueing, external-identity admin delivery, internal-note suppression, Meta GET verification, raw-body HMAC, target-thread preservation, legacy queue column compatibility, legacy BIGSERIAL queue IDs, legacy TEXT queue generated-ID retry, thrown adapter retry/dead-letter handling, migration hardening assertions for queue RLS/admin audit policies/FK indexes/claim RPC grants, guarded runtime hardening migration grants, preference ownership preservation, external identity queue FK safety, and 403 invalid-webhook errors.
- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 51 passed.
- `npm run test:unit --workspace=web` - 27 files, 317 tests passed.
- `for f in backend/tests/auth-login.test.js backend/tests/referral-*.test.js; do node --test "$f" || exit 1; done` - passed with local listener permission for the referral route smoke test; this mirrors Referral Engine CI's backend suite shape with dummy Supabase env.
- `node --check backend/scripts/uat/referral-uat-journeys.mjs` - passed.
- `node --test backend/tests/referral-channel-gateway-phase3.test.js` - 15 passed immediately before PR #88 merge.
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
- `cd mobile && npx tsx tests/native-navigation.test.ts` - 19 passed after preserving the native More-tab budget.
- `cd mobile && npx tsx tests/native-tabs.test.ts` - 18 passed after keeping Messages visible and Referrals drawer-placed.
- `cd mobile && npx tsx tests/native-drawer.test.ts` - 28 passed after moving Referrals into the governed drawer.
- `npm run test:qa -- tests/agents/27-feature-registry-navigation-map.spec.ts` - local rerun hit sidebar rendering timeouts in this environment, but exposed and fixed deterministic owner/admin count drift from Agent 8 Communications entries; GitHub `navigation-e2e` passed afterward.
- `node scripts/generate-feature-manifest.mjs --check` - passed after regenerating owner/navigation artifacts.
- `npm run test:qa -- tests/agents/08-whatsapp-telegram.spec.ts` - 6 passed across Chromium and Mobile Chrome with local Vite server binding.
- `npx playwright test tests/agents/08-whatsapp-telegram.spec.ts` - 6 passed across Chromium and Mobile Chrome with local Vite server binding.
- `git diff --check` - passed.
- Secret-pattern scan over changed communication/env/evidence files found no committed provider credentials. It matched only pre-existing generated fake `sk_live_` test-token strings in `backend/server.js`.

Non-blocking existing lint debt:

- `npm run lint --workspace=web` still fails on pre-existing app-wide lint issues including `react-refresh/only-export-components`, existing `any` usage, and React compiler hook rules in older files. Agent 8 targeted web lint passes.
- `npm run lint --workspace=mobile` still fails on a pre-existing `react/no-unescaped-entities` error in `mobile/app/(auth)/register.tsx` and existing warnings in auth/verification/garage files. Agent 8 removed the new unused imports it surfaced.
- `npm run test --workspace=backend` failed locally at the first Supabase seeding check with `fetch failed`; an escalated rerun was rejected because the suite may mutate an unverified live service-role database. The safer Referral Engine CI backend suite shape passed.
- Full `npx playwright test` was executed with local server permission and remains red outside Agent 8: 74 passed, 18 skipped, 60 failed in pre-existing auth, vehicle evidence, premium evidence gallery, feature registry/navigation, feature governance, and navigation accessibility specs. The focused Agent 8 WhatsApp/Telegram Playwright spec passed 6/6.

## Live Provider Verification

- Provider: WhatsApp, Telegram, Instagram/Facebook, email, SMS, push.
- Environment: local deterministic fake/test provider and real-client unit harness with fake fetch/signature inputs.
- Result: real provider clients and webhook verification paths are implemented and tested without live sends. Cloudflare Email Service/Worker paths are implemented and locally tested, but no Cloudflare live account access was available. Provider endpoint reachability was checked safely for non-Cloudflare providers: SendGrid `401`, Twilio `401`, Meta `400`, Telegram redirect, Expo `405` on safe unauthenticated probes.
- Limitations: no live provider delivery was claimed or attempted. Authenticated sandbox/live UAT is blocked until provider credentials, sender resources, callback URLs, and staging secrets are configured.
- Vercel scheduler limitation: current Vercel account rejected `*/5 * * * *` because Hobby cron is limited to daily jobs. The code now ships a daily-compatible Vercel cron plus a protected endpoint that can be called at production frequency by Vercel Pro Cron, Supabase scheduling, or another authenticated scheduler.

## Configuration Still Required

- Staging Vercel project link or project IDs for `carup-backend-staging` / `carup-staging`
- `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET` for non-preview staging/production targets and any external scheduler secret store
- `EMAIL_PROVIDER=cloudflare`
- `EMAIL_PROVIDER_FALLBACK=sendgrid`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_EMAIL_API_TOKEN`
- `CLOUDFLARE_EMAIL_FROM`
- `CLOUDFLARE_EMAIL_FROM_NAME`
- `CLOUDFLARE_EMAIL_REPLY_TO`
- `CLOUDFLARE_EMAIL_WORKER_URL`
- `CLOUDFLARE_EMAIL_WORKER_SECRET`
- `CLOUDFLARE_EMAIL_INBOUND_SECRET`
- `CLOUDFLARE_EMAIL_ALLOWED_RECIPIENTS`
- `CLOUDFLARE_ACCESS_CLIENT_ID`
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`
- `CLOUDFLARE_R2_BUCKET`
- `CLOUDFLARE_QUEUE_INBOUND`
- `CLOUDFLARE_QUEUE_OUTBOUND`
- `CLOUDFLARE_QUEUE_DLQ`
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
3. Deploy or confirm the staging hardening migrations `20260624044812_agent8_communication_runtime_security_hardening.sql` and `20260624045600_agent8_communication_fk_indexes.sql` where the first two migrations were already applied without the new source hardening.
4. Deploy backend services, routes, adapters, event listeners, and environment variable contract.
5. Configure provider secrets and `COMMUNICATION_WORKER_SECRET`/`CRON_SECRET` in the target environment.
6. For Cloudflare staging email, configure Email Service sender/domain, Email Routing recipient(s), Worker secrets, Queues/DLQ, optional R2 bucket, WAF/rate limits, and deploy `cloudflare/carup-communications-edge/` to staging only.
7. Deploy web and mobile application updates.
8. Enable the backend cron/scheduler for `/api/internal/communications/process`. On the current Vercel Hobby plan, bundled cron is daily; configure Cloudflare Cron, Vercel Pro Cron, or another authenticated scheduler for production-frequency processing.
9. Run smoke tests with the deterministic fake provider.
10. Register provider webhooks and run live provider sandbox verification only after credentials are available.

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

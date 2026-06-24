# Agent 8 Omnichannel Activation Evidence

Last updated: 2026-06-24

This document records the operational activation run for PR #100 without secrets.
Production was not migrated or deployed during this run.

## Repository And PR State

- Repository: `kudzimusar/carup`
- Agent 8 branch: `feature/agent-8-omnichannel-communication-engine`
- PR #88: merged into `main`
  - URL: https://github.com/kudzimusar/carup/pull/88
  - Head SHA before merge: `e7a2f60afc35a90ffad3b17352e459742fb6d10b`
  - Merge commit: `37cc485c94e85d793c5887c391e155a96a9264fc`
  - Merged at: `2026-06-24T04:36:03Z`
- PR #100: open, unmerged, auto-merge disabled
  - URL: https://github.com/kudzimusar/carup/pull/100
  - Base after rebase/retarget: `main`
  - Rebased head before staging hardening commits: `bb731e93556bcc9d77ab7a2cdf165bd6d392d1aa`
  - Activation hardening commit: `3a848ef` (`fix(communication): harden staging activation schema`)
  - Navigation gate fix commit: `4da5c15` (`fix(mobile): preserve native tab budget with messages`)
  - Final PR head: updated on GitHub after this evidence update is pushed.
  - GitHub checks observed after retarget: `referral-ci`, Vercel web/backend/staging previews all passed.

## Supabase Staging Project

- Project name: `carup-staging`
- Project reference: `eoyenigwevnxwwhyhaer`
- API URL: `https://eoyenigwevnxwwhyhaer.supabase.co`
- Production project observed but not modified: `CarUp` (`vhmnajoeicasaigiophh`)

## Staging Schema Snapshot

Before Agent 8 migrations were applied, direct staging queries showed:

- Present legacy tables: `notification_queue`, `domain_events`
- Missing Agent 8 tables: `message_threads`, `message_participants`, `messages`,
  `channel_identities`, `message_delivery_attempts`, `webhook_logs`,
  `communication_preferences`, `communication_escalations`
- Missing routine: `claim_due_communication_notifications(...)`
- Existing `notification_queue.id`: `BIGSERIAL`/`bigint` with sequence default

## Migrations Applied To Staging

Applied to `carup-staging` only:

- `agent_8_omnichannel_communication_engine`
- `agent_8_communication_provider_runtime`
- `agent8_communication_runtime_security_hardening`
- `agent8_communication_admin_audit_policies`
- `agent8_communication_fk_indexes`

The first two correspond to the Agent 8 migrations in the branch. The latter
three are staging-hardening follow-ups discovered during activation verification
and are represented in committed migration files:

- `database/migrations/20260624044812_agent8_communication_runtime_security_hardening.sql`
- `database/migrations/20260624045600_agent8_communication_fk_indexes.sql`

The original Agent 8 migration files were also hardened so fresh environments
receive the same guarantees without relying on follow-ups.

## Staging Migration Verification

Verified on `carup-staging`:

- All target tables exist:
  `message_threads`, `message_participants`, `messages`, `channel_identities`,
  `message_delivery_attempts`, `webhook_logs`, `communication_preferences`,
  `communication_escalations`, `notification_queue`, `domain_events`.
- RLS is enabled on all ten target tables, including `notification_queue`.
- User read policies exist for user-visible communication rows.
- Admin read policies exist for escalation, delivery attempt, and webhook audit rows.
- `claim_due_communication_notifications(p_worker_id text, p_batch_limit integer, p_stale_after_seconds integer)` exists.
- Claim RPC is `SECURITY DEFINER`, uses `FOR UPDATE SKIP LOCKED`, and casts legacy `scheduled_at`.
- Claim RPC execute privileges are limited to `service_role` and owner/postgres; `anon` and `authenticated` are not granted.
- Staging `notification_queue.id` remains `bigint` with its existing sequence default.
- Queue dedupe and due/processing-lock indexes exist.
- A disposable Agent 8 queue row was successfully claimed once by the RPC:
  status became `processing`, `locked_by` was set, and `attempt_count` incremented to `1`.
  The disposable probe row was removed after verification.
- All Agent 8 communication foreign keys have covering indexes after `agent8_communication_fk_indexes`.

## Supabase Advisors

Security and performance advisors were run after migration.

- Agent 8-specific issues found and fixed:
  - `notification_queue` RLS disabled after initial migration application.
  - Claim RPC still executable by `anon`/`authenticated`.
  - `message_delivery_attempts` had RLS enabled with no policy.
  - Agent 8 communication foreign keys were missing covering indexes.
- Remaining advisor output is dominated by pre-existing project-wide tables and policies outside Agent 8 scope, including older public-schema RLS and indexing findings.

## Connector Matrix

| Connector | Authenticated | Target/resource observed | Secret mutation available | Live UAT available | Current status |
|---|---:|---|---:|---:|---|
| GitHub CLI/App | Yes | `kudzimusar/carup` | N/A | N/A | Used for PR merge, rebase, checks |
| Supabase MCP | Yes | `carup-staging` `eoyenigwevnxwwhyhaer` | SQL/migrations/advisors available | DB verification available | Used for staging migrations |
| Supabase CLI | Yes | CLI v2.98.2 | Not linked to staging by checkout | DB work done via MCP | Available but MCP preferred |
| Vercel CLI | Yes | User `kudzimusar`; no local project link, `vercel project ls` returned no projects under default scope | Not available from checkout yet | Preview checks available via GitHub | Blocked for env mutation/linking |
| SendGrid | No provider account connector exposed | Env contract present only | No | No | Blocked by provider credentials/account access |
| Twilio | No provider account connector exposed | Env contract present only | No | No | Blocked by provider credentials/account access |
| Meta / WhatsApp / Facebook / Instagram | No provider account connector exposed | Env contract present only | No | No | Blocked by provider credentials/app/account access |
| Telegram Bot API | No bot token available | Env contract present only | No | No | Blocked by bot token |
| Expo Push | No Expo account/device connector exposed | Env contract present only | No | No physical device access | Blocked by Expo credentials and physical device |

## Tests Run In This Activation Segment

- `node --test backend/tests/referral-channel-gateway-phase3.test.js` - 15 passed before PR #88 merge.
- `npx tsc --noEmit --project web/tsconfig.app.json` - passed before PR #88 merge and after PR #100 rebase.
- `npx tsc --noEmit --project mobile/tsconfig.json` - passed before PR #88 merge and after PR #100 rebase.
- `node --test backend/tests/communication-engine.test.js backend/tests/referral-channel-gateway-phase3.test.js` - 49 passed after PR #100 rebase.
- `mobile: npx tsx tests/native-tabs.test.ts` - 18 passed after native navigation reconciliation.
- `mobile: npx tsx tests/native-navigation.test.ts` - 19 passed after preserving the native More-tab budget.
- `mobile: npx tsx tests/native-drawer.test.ts` - 28 passed after moving Referrals into the governed drawer and keeping Messages visible.
- `node scripts/generate-feature-manifest.mjs --check` - passed after regenerating shared navigation artifacts.
- `node --test backend/tests/communication-engine.test.js` - 34 passed after migration hardening assertions.
- `git diff --check` - passed after staging-hardening migration additions.

## Channel Operational Matrix

| Channel | Implemented | Configured | Deployed | Webhook Registered | Outbound Live-Tested | Inbound/Receipt Live-Tested | Final Status |
|---|---:|---:|---:|---:|---:|---:|---|
| WhatsApp | Yes | No | Preview only | No | No | No | Blocked by Meta credentials/test phone/webhook registration |
| Telegram | Yes | No | Preview only | No | No | No | Blocked by bot token/webhook registration |
| Email / SendGrid | Yes | No | Preview only | No | No | No | Blocked by SendGrid credentials/sender verification |
| SMS / Twilio | Yes | No | Preview only | No | No | No | Blocked by Twilio credentials/sender/test recipient |
| Facebook Messenger | Yes | No | Preview only | No | No | No | Blocked by Meta Page/app permissions |
| Instagram Messaging | Yes | No | Preview only | No | No | No | Blocked by Instagram professional account/app permissions |
| Push / Expo | Yes | No | Preview only | No | No | No | Blocked by Expo credentials and physical device access |
| In-app | Yes | DB configured | Preview only | N/A | Not live-tested | Not live-tested | Backend ready; staging app activation pending |
| Web chat | Yes | DB configured | Preview only | N/A | Not live-tested | Not live-tested | Backend ready; staging app activation pending |
| Mobile chat | Yes | DB configured | Preview only | N/A | Not live-tested | Not live-tested | Backend ready; staging app activation pending |

## Current Blockers

- Vercel checkout is not linked to the staging backend project, and `vercel project ls`
  did not list the GitHub-integrated projects visible in PR checks. Staging env
  mutation and worker-secret configuration are therefore not yet available from
  this CLI session.
- No SendGrid, Twilio, Meta, Telegram, or Expo provider credentials/account
  connectors are available in this session. Live provider UAT cannot be claimed.
- No physical device is available through the tool environment, so physical-device
  push evidence cannot be produced here.
- The 1-5 minute scheduler is not yet configured. Supabase DB is available for
  possible `pg_cron`/`pg_net` scheduling, but the staging backend URL and worker
  secret must be available in protected secret storage first.

## Production Safety

- No Agent 8 migrations were applied to the production `CarUp` Supabase project.
- PR #100 remains open and unmerged.
- No mobile app release was performed.

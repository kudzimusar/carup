# PR #111 Staging Activation — 2026-07-06

## Scope

- Branch: `fix/issue-110-agent8-telegram-auto-delivery`
- PR: #111
- Base: `feature/agent-8-omnichannel-communication-engine`
- Ready-preview runtime head: `004ff684b3ff9365f956156f129e1c750ba9141d`
- Current verified branch head: `16a8e7fa5fae6a28f3f77c1cdb9876d14635f3ea`
- Staging Supabase project: `eoyenigwevnxwwhyhaer`
- Production resources changed: none

The commits after the Ready-preview runtime head contain documentation, tests and CI workflow changes; they do not change the deployed web or backend application runtime.

## CI

Both required workflows passed on the current verified branch head:

- Communication Command Center CI: success
- Referral Engine CI: success

The communication workflow now runs:

- the communication engine unit suite;
- a source test for the privilege-hardening migration;
- the required PostgreSQL Command Center integration suite;
- a separate real-PostgreSQL verification of the direct table privileges.

The PostgreSQL jobs run rather than skip. Together they verify the Command Center migrations, database RPCs, tenant scoping, registered-user search, per-agent unread, SLA schema, audit ID compatibility, RLS isolation, rollback and direct table permissions.

## Staging database activation

Applied in order:

1. `communication_inbox_projection_20260705150000`
2. `communication_audit_events_20260705170000`
3. `communication_sla_20260705180000`
4. `communication_privilege_hardening_20260705190000`

The fourth migration was added after live staging verification found that project default grants retained direct authenticated write permissions. It resets the audit and SLA policy tables to authenticated read-only access while preserving the backend service-role permissions.

## Verified on staging

- Inbox projection view exists.
- Search, counts and per-agent unread RPCs exist.
- RPC execution is restricted to the backend service role.
- Required indexes exist.
- Projection and aggregate totals match the source threads.
- Tenant-scoped search produced no cross-tenant rows.
- Keyset pagination produced two non-overlapping pages.
- Per-agent unread RPC executed successfully.
- Audit notification IDs accept the legacy numeric queue ID as text.
- Temporary verification records were removed.
- Audit and SLA policy RLS policies are tenant-aware.
- Direct authenticated writes to the audit and SLA policy tables are disabled.
- All additive SLA columns exist.
- The communication worker cron remains active.

Current staging snapshot after cleanup:

- communication threads projected: 2
- audit events: 0
- SLA policies: 0
- active communication worker cron jobs: 1

## Staging deployments

Vercel reported Ready previews for runtime head `004ff684b3ff9365f956156f129e1c750ba9141d` for web and backend staging. The authoritative URLs are recorded by the Vercel bot in PR #111.

This execution environment could not resolve the preview hostnames, so browser-route and visual verification were not claimed from this session.

## Previous live provider evidence

Earlier staging acceptance proved real WhatsApp delivery through `meta_whatsapp_cloud_api` with a provider `wamid`, and real Telegram delivery through `telegram_bot_api` with automatic Supabase Cron processing.

## Remaining acceptance evidence

Only reachable-browser and physical-device checks remain:

1. Verify all Command Center routes on the latest web preview.
2. Repeat WhatsApp inbound, admin reply, automatic send and device receipt.
3. Repeat Telegram inbound, admin reply, automatic send and device receipt.
4. Exercise one controlled failed/dead-letter recovery.
5. Capture redacted desktop, tablet and mobile screenshots.
6. Add the final UAT evidence to PR #111 and Issue #107.

These are runtime evidence tasks, not unresolved source or schema work.

## Release boundary

- PR #111 remains open and mergeable.
- Do not merge directly to `main`.
- Do not apply these migrations to production yet.
- Do not modify production webhooks or provider credentials.
- After final live UAT, merge PR #111 into the Agent 8 integration branch first.

## Rollback

Use the feature migrations' Down sections in reverse order: SLA, audit, then inbox projection. The privilege hardening migration intentionally does not restore broader authenticated write access.
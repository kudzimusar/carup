# Enterprise Communication Command Center — Completion Evidence

Branch: `fix/issue-110-agent8-telegram-auto-delivery` · PR #111 · base `feature/agent-8-omnichannel-communication-engine`.
Scope: the 17-item AUTHORITATIVE remediation contract (Issues #107 / #110) **plus** the independent-review
follow-up (P0 pre-deploy blockers + P1 goal-completion items).

## Independent-review follow-up (P0 / P1) — status

| # | Item | Status |
|---|------|--------|
| P0.1 | Audit `notification_id` UUID → **TEXT** (live queue id is BIGSERIAL) + `String(id)` normalization + schema-tied compat test (bigint/text/numeric 8) | ✅ |
| P0.2 | Smoke-test audit event linked to the created thread (`result.thread_id`, not `result.thread.id`) + regression test | ✅ |
| P0.3 | Tenant scoping **fail-closed**: tenant-less non-platform → 403 (never `tenant_id IS NULL`), across dead-letter/recovery/metrics/worker-health; threads/detail/audit/retry/cancel/bulk/requeue fail closed via scope/loaders | ✅ |
| P1.4 | Per-channel **provider operations telemetry** (webhook configured/verified, latest inbound, latest outbound OK, latest error, queue/retry/DLQ counts, worker+scheduler, stale locks, credential presence-without-values) | ✅ |
| P1.5 | **Visible** timeline metadata in the normal bubble (branded icon+label, sender, exact date/time/tz, relative, direction, delivery state); raw ids/ISO/correlation only in technical mode | ✅ |
| P1.6 | **True bounded DOM** — virtualized inbox (fixed-height window); scale e2e loads thousands + many pages and asserts mounted rows stay under a fixed bound | ✅ |
| P1.7 | **Per-agent unread** (acting agent's own read marker, not MAX across agents) + a separate team-unread signal; two-agent isolation tests | ✅ |
| P1.8 | **Registered-user identity fallback** — `primary_user_id` → CarUp profile name/email when there is no requester channel identity (never Support/Complaint/General) | ✅ |
| P1.9 | **SLA business-hours engine** — policy selection + first/next/resolution deadlines within business hours/timezone, evening/weekend rollover, holidays; DST-boundary test; applied on priority change | ✅ |
| P1.10 | **Real section workspaces** — /queues (backlog grid), /sla (worklist), /audit (GLOBAL search, no thread selection), /settings (read-only routing/SLA reference) | ✅ |
| P1.11 | **Recovery inspection** — per-item delivery-attempt history (provider request/message ids, error details), retry timing + retryability, thread navigation, guarded bulk + safe requeue + audit | ✅ |
| P1.12 | **Real integration tests** — credential-gated Postgres suite (migrations + RPCs + tenant scoping + numeric-id audit insert + SLA columns/policies). Skips without `COMMUNICATION_TEST_DATABASE_URL` | ✅ authored (runs in CI/staging with a DB) |
| P1.13 | PR renamed to reference #107 + #110; this evidence updated with honest deferrals | ✅ |

(The original 17-item contract — DB-side projection, identity-first inbox, audit, unread, SLA, tenant
scoping, recovery, provider health, nested routes, responsive, Playwright/axe — remains ✅; see git history.)

## Verification gates (local, this checkout)

- `git diff --check` — clean.
- Backend communication `node --test tests/communication-engine.test.js` — **108 / 108**.
- Diaspora regression — **27 / 27**.
- Postgres integration suite — **skipped** here (no `COMMUNICATION_TEST_DATABASE_URL`); runs in CI/staging.
- Web `vitest` — **427 / 427**; `tsc` clean; ESLint clean on changed files; production `vite build` green.
- Playwright e2e (desktop + tablet + mobile, route-mocked) — green, incl. bounded-DOM scale + real-workspace navigation + provider telemetry; axe structural clean.
- The wider backend integration suites (auth/evidence/marketplace/etc.) require live `SUPABASE_URL`/`SERVICE_ROLE_KEY` and are env-gated in a bare checkout — unrelated to this change.

## Honest deferrals / notes

- **Do NOT deploy or apply the three migrations yet** (per the review). Migration order when the operator proceeds: `20260705150000_communication_inbox_projection.sql` → `20260705170000_communication_audit_events.sql` → `20260705180000_communication_sla.sql` (after the base engine migration). Run the P1.12 integration suite against a disposable Postgres first.
- **Per-agent unread in the RPC path** is applied by re-projecting the returned page (≤200 rows) through the tested projection; the SQL view's own `unread_count` remains a team-level signal. The window/memory fallback computes per-agent directly. Both paths yield per-agent unread; verified on the memory/window path (RPC path exercised by the P1.12 integration suite against a real DB).
- **Settings is read-only** — routing/SLA/channel configuration editing is intentionally deferred and labelled as such.
- **Provider telemetry** derives from live adapter health + recent webhook/attempt/queue rows; per-channel history depth is bounded by the query limits.
- **Operator-blocked (cannot run from here):** applying migrations to staging Supabase; deploying the latest frontend/backend previews; live on-device WhatsApp + Telegram inbound→reply→receipt UAT (real `wamid`/`telegram_bot_api` ids); a controlled failed→dead-letter recovery; desktop/tablet/mobile screenshots. No production resource was modified.

To run the frontend e2e anywhere: `cd web && npx playwright install && (start a server) && PLAYWRIGHT_BASE_URL=… npx playwright test e2e/command-center-*.spec.ts`.
To run the Postgres integration suite: `cd backend && COMMUNICATION_TEST_DATABASE_URL=postgres://… node --test tests/integration/`.

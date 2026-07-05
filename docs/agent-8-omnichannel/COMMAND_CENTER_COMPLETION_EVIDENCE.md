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
| P1.9 | **SLA business-hours engine + full policy lifecycle** — policy selection + first/next/resolution deadlines within business hours/timezone, evening/weekend rollover, holidays, DST; applied on create/inbound, first-response stamp, next-response restart, recompute on priority/channel, pause/resume, clear on resolve, reapply on reopen (no longer priority-only); weekend/DST/pause lifecycle tests | ✅ |
| P1.10 | **Real section workspaces** — /queues (backlog grid), /sla (worklist), /audit (GLOBAL search, no thread selection), /settings (read-only routing/SLA reference) | ✅ |
| P1.11 | **Recovery inspection** — per-item delivery-attempt history (provider request/message ids, error details), retry timing + retryability, thread navigation, guarded bulk + safe requeue + audit | ✅ |
| P1.12 | **Real Postgres integration gate** — REQUIRED `communication-postgres` CI job (postgres:16 service) that must run, not skip: migrations apply + roll back; RPC search/count + tenant scoping; registered-user name+email search; per-agent two-agent unread; SLA columns round-trip; RLS tenant isolation negative tests; numeric-id audit. **Passes 9/9 on real Postgres in CI** | ✅ |
| P1.13 | PR renamed to reference #107 + #110; this evidence updated with honest deferrals | ✅ |

(The original 17-item contract — DB-side projection, identity-first inbox, audit, unread, SLA, tenant
scoping, recovery, provider health, nested routes, responsive, Playwright/axe — remains ✅; see git history.)

## Verification gates (CI green on head `4a50a33`)

- **Referral Engine CI** (`pull_request`) — **success**: Web `tsc -p web/tsconfig.app.json --noEmit`, web unit, mobile ts:check, referral suites, production `vite build`.
- **Communication Command Center CI** (`pull_request`, new) — **success**:
  - `communication-unit`: backend communication `node --test` — **116 / 116** (adds engine-wide ordered audit lifecycle, full SLA policy lifecycle incl. weekend/DST/pause, registered-user search parity, per-agent + team unread, hardened-RLS + grant schema assertions).
  - `communication-postgres`: the real-Postgres integration gate **runs (not skipped) and passes 9 / 9** against a disposable `postgres:16` service container — migrations apply + roll back cleanly; audit numeric-id TEXT; RPC search/count tenant scoping; registered-user name+email search; per-agent two-agent unread (A read→0, B→2); SLA columns round-trip; RLS tenant isolation (A≠B, tenantless≠platform-null, platform-admin global, anon denied).
- Local: `git diff --check` clean; Diaspora regression **27 / 27**; Web `vitest` **427 / 427**, `tsc` clean, ESLint clean, `vite build` green; Playwright e2e (desktop + tablet + mobile, route-mocked) green + axe structural clean.
- The wider backend integration suites (auth/evidence/marketplace/etc.) require live `SUPABASE_URL`/`SERVICE_ROLE_KEY` and are env-gated in a bare checkout — unrelated to this change.

## Honest deferrals / notes

- **Migrations not yet applied to staging/prod (operator-blocked)** — no CarUp DB access from here. They are proven to apply + roll back cleanly against real Postgres in the `communication-postgres` CI job. Operator order: `20260705150000_communication_inbox_projection.sql` → `20260705170000_communication_audit_events.sql` → `20260705180000_communication_sla.sql` (after the base engine migration). Until applied, the API serves the graceful bounded-window fallback.
- **Per-agent unread** is now a first-class DB contract: the view exposes `team_unread_count` (unambiguous team signal) and `communication_thread_agent_unread(thread_ids, user_id)` answers the per-agent badge — proven by a real-DB two-agent test in the Postgres gate. The backend page re-projection remains as a belt-and-suspenders path and yields the same per-agent value.
- **Registered-user DB search** — the projection joins the CarUp `users` profile; a registered customer with no channel identity is found in the DB path by name (RPC also searches email/phone, never projected). Verified against real Postgres.
- **RLS** on `communication_audit_events` + `communication_sla_policies` is tenant-hardened (explicit platform-admin policy + tenant-membership policy; authenticated SELECT under RLS; anon revoked; append-only). Negative tests run in the Postgres gate.
- **Settings is read-only** — routing/SLA/channel configuration editing is intentionally deferred and labelled as such.
- **Provider telemetry** derives from live adapter health + recent webhook/attempt/queue rows (no longer a deferral).
- **Operator-blocked (cannot run from here):** applying migrations to staging Supabase; deploying head `bc65d49` frontend/backend; live on-device WhatsApp + Telegram inbound→reply→receipt UAT (real `wamid`/`telegram_bot_api` ids); a controlled failed→dead-letter recovery; desktop/tablet/mobile screenshots. No production resource was modified.
- **Staging activation attempt (2026-07-06):** see `ACTIVATION_EVIDENCE.md` (PR #111 section). Phase A (workspace/target safety) + the runnable regression subset passed; migration application (Phases B–D) and everything downstream are blocked because staging Supabase `eoyenigwevnxwwhyhaer` is not reachable from the run environment (no `SUPABASE_DB_URL`/`psql`; the authenticated Supabase CLI + MCP accounts do not contain it). Exact operator action documented there.

To run the frontend e2e anywhere: `cd web && npx playwright install && (start a server) && PLAYWRIGHT_BASE_URL=… npx playwright test e2e/command-center-*.spec.ts`.
To run the Postgres integration suite: `cd backend && COMMUNICATION_TEST_DATABASE_URL=postgres://… node --test tests/integration/`.

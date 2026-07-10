# Command Center — Discovery Gap Matrix (Phase 2)

Grounded audit of the current state vs. the authoritative plan
(`ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md`). Status legend:
**Done** · **Partial** · **Not started** · **Blocked-ext** (needs operator: staging deploy,
live provider UAT, staging Supabase, Vercel, or on-device confirmation — I have none of these
credentials/access in-session).

Baseline: branch `fix/issue-110-agent8-telegram-auto-delivery` @ `ff6bbc7`, isolated worktree,
tree clean. WhatsApp/Telegram real adapters verified live earlier this thread (staging health
`mode=real`); the provider smoke-test endpoint exists and refuses fake success.

| # | Plan requirement | Current state | Status |
|---|---|---|---|
| 3 | Channel registry + accessible brand icons + identity/date formatting + unit tests | **Added this iteration:** `web/src/features/communications/channelRegistry.ts` (12 channels incl. LINE/X planned, provider labels, webhook paths, capabilities), `ChannelIcon.tsx` (accessible, brand-coloured, not colour-alone), `communicationFormatting.ts` (workflow≠delivery labels/tone, identity-first labels, masked phone/email, exact TZ dates, never "Invalid Date"); 19 vitest tests | **Done** |
| 4 | Scalable inbox APIs: cursor pagination, server search/filter/sort/counts, identity/attempt projections, schema-tied tests | Backend `GET /api/admin/communications/threads` uses a single `status`+`limit` query, orders by `updated_at`, no cursor, no server search/sort, no counts endpoint | **Not started** |
| 5 | Shell/routes: `/admin/communications/{inbox,queues,recovery,sla,audit,providers,settings}`, deep links, header, rail | Only `/admin/communications` (+ legacy alias) exists; single page, no nested routes/deep links | **Not started** |
| 6 | Enterprise inbox: virtualization, debounced search, URL-persisted filters, multi-select/bulk, keyboard nav, complete states | Redesigned page has client-side `limit:300` fetch, segmented filter+counts, search, skeleton/empty/error states, stale-response + post-unmount guards; **no** virtualization, URL state, bulk, or keyboard nav | **Partial** |
| 7 | Conversation timeline: exact dates/timezones, workflow/delivery separation, attempts/errors, technical drawer | Direction-aligned bubbles + per-message delivery badge + provider_message_id; **no** exact-TZ dates, Today/Yesterday separators (now available via `communicationFormatting`), attempts/error detail, or technical drawer | **Partial** |
| 8 | Composer: explicit channel target, internal note, idempotency, queued-first, draft preservation, correlation errors, templates/AI seams | Internal-note switch, idempotency key, correlation id on failure, draft preserved, delivery status polling all present; **no** explicit "Reply via WhatsApp to +81…" target line, templates, or AI-draft seam | **Partial** |
| 9 | Handoff/SLA/context: assign self/agent/team, escalation reasons, SLA states, linked identities | Assign-to-me/team/admin-id, escalate, resolve present; **no** SLA state machine (Healthy/Due/Breached/Paused), business-hours, reassignment history, or linked identities | **Partial** |
| 10 | Recovery + audit: recovery queues, attempt inspection, guarded bulk retry, full audit timeline | Dead-letter rail with retry/cancel; **no** dedicated recovery queues (stale/processing/queued-too-long), attempt drill-down, bulk retry, or audit timeline | **Partial** |
| 11 | Provider health/diagnostics: Ready/Warning/Blocked, real/fake, webhook/worker/scheduler health, smoke test, future channels shown | Worker-health strip (queue/SLA/Telegram/cron) + real/fake via `/health`; protected provider smoke test done; **no** per-channel provider cards, webhook state, or future-channel "Not configured" rows | **Partial** |
| 12 | Component architecture: split the monolith into ~20 focused components | `Communications.tsx` is still a single (redesigned) page; `web/src/features/communications/` scaffolding started with registry/icon/formatting | **Partial** |
| 12 | Verification gates: tsc, lint, web unit, communication-engine, schema tests, production build, `git diff --check` | tsc/eslint clean; communication-engine **66** pass; new web unit **19** pass; production build/Playwright/axe not yet run here | **Partial** |
| 13 | Staging UAT: deploy previews vs staging Supabase; validate live use + screenshots | Requires Vercel deploy + staging Supabase access | **Blocked-ext** |
| — | Live Telegram + WhatsApp inbound/outbound UAT with provider IDs on-device | Requires operator trigger (admin session/worker secret) + on-device confirmation; endpoint ready | **Blocked-ext** |
| 12 | Playwright + axe accessibility, responsive, 1,000-thread load test | Playwright deps present (`@playwright/test`, `@axe-core/playwright`) but browsers not installed; needs running app | **Blocked-ext** (browsers/app) |
| 14 | Adversarial `/code-review`, resolve findings, update Issue #107 / PR #111 | Ran adversarial reviews on prior increments; not yet for the enterprise scope | **Partial** |
| 15 | Production boundary: no main merge / prod DB / secrets / webhooks without approval | Respected throughout | **Done** |

## Unblocked next targets (in priority order)

1. **Phase 4 backend** — additive cursor pagination + server search/filter/sort + counts on the admin threads API, with schema-tied backend tests (no client `limit:300`).
2. **Phase 12 architecture** — split `Communications.tsx` into `features/communications/admin/*` components consuming the new registry/formatting.
3. **Phase 7/8 wiring** — timeline exact-TZ dates + Today/Yesterday separators + explicit reply-target line using `communicationFormatting`.
4. **Phase 6 inbox** — virtualization + URL-persisted filters + keyboard nav + bulk actions.
5. **Phase 11 health** — per-channel provider cards + future-channel "Not configured" rows from the registry.

## Deterministic operator action to unblock the terminal gates

To evidence the `/goal`'s staging + live-UAT conditions, an operator must, once the branch preview
is Ready: (a) confirm the Vercel **preview URL** for `fix/issue-110-agent8-telegram-auto-delivery`
and that it targets **staging Supabase**; (b) trigger the WhatsApp/Telegram live UAT (admin session
or `COMMUNICATION_WORKER_SECRET`) and confirm on-device receipt; (c) paste the JSON response +
preview URL back. Everything above those gates is being implemented and verified in-session.

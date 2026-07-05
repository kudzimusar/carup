# CarUp Enterprise Communication Command Center

## Authoritative `/goal` + `/loop` Plan

**Issue:** #107  
**Active branch:** `fix/issue-110-agent8-telegram-auto-delivery`  
**Active PR:** #111, stacked on Agent 8 PR #100  
**Canonical UI:** `/admin/communications`  
**Primary file:** `web/src/pages/dashboard/admin/Communications.tsx`

This is the single source of truth for all agents building, testing, activating, and maintaining the CarUp Communication Command Center. Supporting notes may be added, but scope, phases, acceptance, and stop conditions live here.

---

## 1. Mission and definition of done

Build an enterprise omnichannel operations console that can manage at least **1,000 daily conversations** without hidden messages, channel ambiguity, duplicate sends, false delivery states, or developer-only recovery.

For every conversation an operator must immediately know:

- who contacted CarUp;
- the exact channel/provider;
- when and where each message was sent or received;
- the related listing, order, escrow, finance, import, referral, trust, or support context;
- owner/team, SLA, and next action;
- whether the last reply is queued, sent, delivered, read, failed, retrying, or dead-lettered;
- provider, webhook, worker, scheduler, and queue health;
- who performed each audited action.

The goal is achieved only when the feature is fully usable on staging, live Telegram and WhatsApp still work through real adapters, all automated gates pass, screenshots/UAT evidence are attached, and PR #111 is review-ready. Main merge and production changes remain an explicit approval boundary.

---

## 2. Baseline that must not regress

- Telegram inbound works.
- Telegram admin reply uses `telegram_bot_api`.
- Automatic delivery runs through Supabase Cron and the protected worker.
- WhatsApp webhook verification works.
- CarUp sends through `meta_whatsapp_cloud_api`.
- The live WhatsApp test returned a `wamid...` and reached the device.
- `messages`, `notification_queue`, `message_delivery_attempts`, and `webhook_logs` remain canonical.
- Fake adapter output must never appear as real staging/production success.

---

## 3. Non-negotiable rules

### Separate thread workflow from message delivery

**Workflow:** Open, AI handling, Needs human, Assigned, Awaiting customer, Escalated, Resolved, Reopened, Spam/closed.

**Delivery:** Draft, Queued, Processing, Sent, Delivered, Read, Retry scheduled, Failed, Dead letter, Cancelled, Internal note.

A resolved thread may contain a queued or failed outbound message. Show both accurately.

### Channel-first and identity-first

Primary labels prefer verified CarUp/contact name, then provider display name/handle, then masked phone/email, then a readable fallback. Raw UUIDs, thread keys, provider IDs, and JSON stay in a technical drawer.

### No fake success

Show real/fake mode. Refuse smoke tests in fake mode. Missing credentials, webhook secrets, URLs, or scheduler configuration show `Blocked` or `Not configured`. A database insert is `Queued`, never `Sent`.

### Authorization and audit

Use genuine platform base roles for platform operations; enforce tenant/team boundaries; never send internal notes externally; audit replies, assignment, escalation, resolution, retries, cancellation, diagnostics, and identity changes. Never expose secret values.

---

## 4. Route and source map

### Preserve

- `/admin/communications`
- `/dashboard/admin/communications` — legacy alias; redirect when safe.
- `/dashboard/communications` — owner/customer surface, not this console.

### Target routes

- `/admin/communications/inbox`
- `/admin/communications/inbox/:threadId`
- `/admin/communications/queues`
- `/admin/communications/recovery`
- `/admin/communications/sla`
- `/admin/communications/audit`
- `/admin/communications/providers`
- `/admin/communications/settings`

If nested routing is risky inside PR #111, preserve `/admin/communications` and implement durable query/deep-link state first.

### Inspect before editing

Frontend: `Communications.tsx`, owner communications, `useCarUpApi.ts`, `apiClient.ts`, `App.tsx`, dashboard layout, feature registry/navigation, UI primitives.

Backend/data: admin and public communication routes, `backend/services/communication/*`, adapters, server wiring, Agent 8 migrations, shared communication types, communication and diaspora tests.

Evidence: activation evidence, configuration validator, WhatsApp smoke-test runbook.

---

## 5. Enterprise layout and navigation

### Header

Environment, queue depth, oldest queued age, SLA breaches, unassigned, dead letters, provider incidents, last worker run, refresh/reconnect status, and shortcuts.

### Desktop

1. Channel/queue rail
2. Inbox list
3. Conversation timeline/composer
4. Context/operations rail

Compact desktop collapses the context rail. Tablet switches inbox/conversation with a drawer. Mobile uses inbox → conversation → details and a sticky composer.

### Required rail entries with counts

All active, Unassigned, Mine, Needs human, AI handling, Awaiting customer, SLA breach, Failed/dead letter, WhatsApp, Telegram, Email, SMS, Facebook Messenger, Instagram, LINE, X, In-app, Web chat, Mobile chat, Push, Resolved.

Unavailable channels remain visible as `Not configured`.

---

## 6. Channel registry, real icons, and future channels

Create one canonical registry defining channel key, public/accessibility label, icon, brand token, provider label, identity format, capabilities, health state, webhook path, and diagnostics support.

Create a reusable `ChannelIcon`. No emoji or generic chat icon for branded channels. Use a maintained brand-icon package such as `react-icons/si` or approved accessible SVG components, with Lucide fallback. Icons require text labels and cannot depend on color alone.

Required identities: WhatsApp, Telegram, Facebook Messenger, Instagram, LINE, X, Email, SMS, Push, In-app, Web chat, Mobile chat.

### Planned provider seams

- **LINE:** adapter contract, signature verification, webhook dedupe, LINE identity, normalized text/media/rich messages, retries, validator, diagnostics; route `/api/communications/webhooks/line/line`.
- **Facebook Messenger:** reuse Meta HMAC/webhook logging, page-scoped identity, canonical inbound service; route `/api/communications/webhooks/meta/facebook`.
- **Instagram:** reuse Meta verification, IG identity, safe story/reel/post context; route `/api/communications/webhooks/meta/instagram`.
- **X:** implement only after approved API access and current DM/webhook capability are verified; dedicated adapter, signed events, `@handle`, retry/rate-limit classification, diagnostics; planned route `/api/communications/webhooks/x/dm`.

The UI must be registry-driven so a channel appears consistently in inbox, filters, timeline, health, recovery, and audit without rewriting the page.

---

## 7. Inbox at enterprise scale

The current client-side `limit: 300` pattern is not sufficient.

### Backend

- cursor pagination using stable `last_message_at` + `id` ordering;
- server search, filters, sort, and counts independent of page;
- unread/mention counts;
- bounded payloads and no N+1 identity/provider queries;
- strict authorization/tenant scoping.

### Frontend

- virtualization or bounded DOM;
- debounced search;
- URL-persisted filters/selection;
- multi-select and bulk operations;
- keyboard navigation;
- preserved selection/draft during refresh;
- stale-response protection;
- clear loading, empty, offline, and error states.

### Every row

Real channel icon/name, customer identity, masked identifier/handle, location/timezone when known, last-message direction/preview, timestamp, unread count, workflow, priority, owner/team, SLA, delivery risk, and CarUp context. Raw IDs are never the title.

### Search/filter/sort/bulk

Search names, phones, emails, handles, text, references, provider IDs, teams, and assignees. Filter channel, workflow, delivery, unread, assignment, priority, SLA, date, location, context, incident, and spam. Sort newest, oldest waiting, SLA urgency, priority, unread, failed, and unassigned. Bulk assign, mark read, resolve/reopen, escalate, retry, cancel, spam, and authorized audit export with confirmation, partial-failure reporting, and audit.

---

## 8. Conversation, dates, replies, SLA, recovery, and audit

### Conversation header

Identity, primary channel/provider, linked identities, workflow, owner/team, priority, SLA, context reference, last inbound/outbound, provider/webhook warning.

### Timeline

Distinct inbound, outbound, AI, and internal-note entries. Show sender, channel icon, direction, exact date/time, relative time, timezone, content, delivery state, attempts/errors, correlation ID, safe media/template metadata, and audit link. Use Today/Yesterday/full-date separators. Default to operator timezone, expose ISO/UTC in details, and show customer-local time when known. Never render `Invalid Date`.

### Composer

Modes: external reply, internal note, approved template, future media, saved response, AI-assisted draft requiring review. State the exact target, e.g. `Reply via WhatsApp to +81 …`. Disable duplicate submit, preserve idempotency/client message ID, preserve draft on failure, show Queued first, poll/subscribe until settled, expose correlation ID, clearly mark internal notes, warn on destination changes, and show channel policy/template/session constraints.

### Handoff and SLA

Assign self/agent/team, specialist request, AI→human handoff, human-owned AI assist, escalation reason/severity, reassignment history. Show first/next/resolution SLA, business hours/timezone, pause reason, breach timestamp, escalation policy. States: Healthy, Due soon, Breached, Paused, Not applicable.

### Recovery

Dedicated views for queued too long, stale processing, retry scheduled, failed, dead letter, cancelled, and provider incidents. Inspect attempts; retry/cancel/requeue safely; open thread; copy safe IDs; guarded bulk retry. Show provider, channel, attempt, timing, request/message IDs, redacted result, error, retryability, next retry, and actor.

### Audit

Reconstruct thread creation, webhook verification/dedupe, identity linking, AI classification, assignment/handoff, reply, queue claim, attempts, receipts, retry/dead letter/cancel, consent, resolve/reopen, redaction, and export. Include actor, role, tenant, correlation ID, time, reason, and safe metadata.

---

## 9. Provider health and diagnostics

Show Ready/Warning/Blocked, real/fake, credential presence without values, webhook state, last inbound, last successful outbound, latest failure, queue depth, oldest age, worker run, Supabase Cron state, stale locks, retries/dead letters, and safe rotation metadata.

Preserve the protected provider smoke capability: platform-admin/worker-secret authorization, explicit recipient confirmation, real adapter required, durable records, provider message ID required, audit event, and no production test without explicit confirmation.

---

## 10. Component architecture

Split the current monolith into focused components, for example:

```text
web/src/features/communications/admin/
  CommandCenterPage.tsx
  CommandCenterHeader.tsx
  ChannelRail.tsx
  InboxToolbar.tsx
  ConversationList.tsx
  ConversationRow.tsx
  ConversationWorkspace.tsx
  ConversationHeader.tsx
  MessageTimeline.tsx
  MessageBubble.tsx
  DeliveryStateBadge.tsx
  ReplyComposer.tsx
  ContextOperationsRail.tsx
  CustomerIdentityCard.tsx
  AssignmentPanel.tsx
  SlaPanel.tsx
  ProviderHealthPanel.tsx
  DeliveryRecoveryPanel.tsx
  AuditDrawer.tsx
  BulkActionBar.tsx
  channelRegistry.tsx
  communicationFormatting.ts
  communicationQueryState.ts
```

Adjust to repository conventions, but `Communications.tsx` must not remain an unbounded monolith.

---

## 11. Continuous implementation phases

Phases are gates, not approval pauses.

1. **Safety:** read this file; inspect branch, worktrees, PR #111, Issue #107, concurrent agents, git status; isolate unrelated WIP; record baseline.
2. **Discovery:** audit UI, APIs, schema, navigation, tests, provider health, staging; capture desktop/tablet/mobile before screenshots; produce a gap matrix.
3. **Registry/design:** channel registry, accessible brand icons, labels, status/SLA tokens, identity and date formatting, unit tests.
4. **Scalable APIs:** cursor pagination, server search/filter/sort/counts, identity projection, attempt/audit projection, schema-tied tests, backward compatibility.
5. **Shell/routes:** deep links, header, rail, inbox, conversation, context rail, responsive behavior, admin guards.
6. **Enterprise inbox:** virtualized/paginated rows, filters, counts, sorting, bulk selection, keyboard support, complete states.
7. **Conversation:** timeline, exact dates/timezones, identity, workflow/delivery separation, attempts/errors, technical drawer.
8. **Composer:** explicit channel, notes, idempotency, queued state, draft preservation, correlation errors, template/macro/AI seams, duplicate prevention.
9. **Handoff/SLA/context:** assignment, routing, escalation, resolve/reopen, SLA, customer/context, linked identities.
10. **Recovery/audit:** recovery queues, attempts, retry/cancel, stale-lock context, guarded bulk actions, audit timeline.
11. **Health/diagnostics:** provider cards, validator, webhook/worker/scheduler health, events/failures, smoke tests, future channels shown as not configured.
12. **Verification:** TypeScript, lint, web unit, communication-engine, diaspora regressions, schema tests, Playwright, axe, responsive, pagination/load, idempotency, retry/dead-letter, real/fake, production build, `git diff --check`; use `/run` and `/verify`.
13. **Staging UAT:** deploy previews against staging Supabase; validate authorized admin use and live Telegram/WhatsApp inbound/outbound, icons, identities, timestamps, replies, provider IDs, SLA, audit, and recovery; capture after screenshots.
14. **Adversarial review:** UX, accessibility, security, performance, schema/API, operational clarity; resolve critical/high/medium findings; run `/code-review`; update Issue #107 and PR #111 with evidence and rollback.
15. **Production boundary:** do not merge main, apply production migrations, rotate production secrets, or switch webhooks without explicit user approval.

---

## 12. Required tests and targets

Tests must cover discoverability of AI-handled threads; channel counts; cursor stability; search/filter/sort; bounded DOM; no UUID-first rows; inbound/outbound/internal/AI timeline; exact timezone dates; workflow vs delivery; explicit reply target; duplicate suppression; draft preservation; queued→sent/delivered; failure correlation; assignment/escalation/resolve/reopen; SLA; audit; real/fake and not-configured providers; Telegram/WhatsApp health; protected smoke test; stale lock; retry/cancel; keyboard/focus/axe; desktop/tablet/mobile; and a fixture/load test with at least 1,000 threads.

Performance targets: shell interactive within 2 seconds on normal staging; loaded filters respond within 100 ms or one server round trip; no unbounded DOM for 10,000 threads; safe reconnect; no post-unmount updates; stale requests cannot replace current selection; drafts survive refresh/errors.

---

## 13. Git, evidence, and release policy

Use an isolated worktree when current WIP is unrelated. Base on the latest Agent 8/PR #111 head. Keep focused docs, registry/inbox, conversation/ops, and test commits. Commit intended files only, push, and update the correct PR. Attach before/after screenshots, test output, deployment URLs, migration status, live UAT, and rollback. Stop before merge unless explicit approval is given.

---

## 14. Claude Code skill workflow

Project skill:

```text
.claude/skills/carup-command-center/SKILL.md
```

Invoke:

```text
/carup-command-center
```

Then run:

```text
/loop 10m /carup-command-center continue implementation, verification, CI, review feedback, deployment checks, and staging UAT until the active goal is achieved
```

Use `/run`, `/verify`, and `/code-review`. `/goal` is the stop authority; `/loop` revisits asynchronous CI, deployments, and reviews.

---

## 15. Exact `/goal` command

```text
/goal The CarUp Enterprise Communication Command Center defined in docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md is fully implemented and active on staging: canonical admin routes/deep links work; real channel icons, identity-first inbox rows, exact dates/timezones, server-side paginated searchable filterable queues for 1,000+ daily conversations, professional timeline, explicit reply channel, independent workflow/delivery states, handoff/assignment/SLA, delivery recovery, audit, provider/webhook/worker/scheduler health, diagnostics, responsive layouts, and accessibility are complete; Telegram and WhatsApp live inbound/outbound still pass through real adapters with provider message IDs and no fake success; additive backend/schema contracts are tested against real migrations; TypeScript, lint, unit, backend, schema, Playwright, accessibility, production build, and git diff checks pass; /run and /verify prove the staging app; screenshots and UAT evidence are attached to PR #111 and Issue #107; the branch is pushed and the PR is review-ready. Do not merge main or change production database, secrets, or webhooks without explicit approval. Continue until every condition is evidenced, or stop only for a genuine external credential/account/approval blocker after completing all unblocked work and reporting one deterministic next action.
```

---

## 16. Completion checklist and stop conditions

- [ ] Safe worktree/baseline and gap matrix.
- [ ] Channel registry and real icons.
- [ ] Routes/deep links.
- [ ] Server-paginated enterprise inbox.
- [ ] Search/filter/sort/counts/bulk actions.
- [ ] Identity-first rows and exact dates/timezones.
- [ ] Professional timeline and technical drawer.
- [ ] Workflow/delivery separation.
- [ ] Audited composer/internal notes.
- [ ] Assignment/handoff/escalation/SLA.
- [ ] Recovery, attempts, and audit.
- [ ] Provider health/diagnostics and future channels.
- [ ] Accessibility/responsive/load tests.
- [ ] Live Telegram and WhatsApp UAT.
- [ ] No fake success.
- [ ] All automated gates, `/run`, and `/verify` pass.
- [ ] Screenshots/evidence attached; Issue #107 and PR #111 updated.
- [ ] Production untouched pending approval.

Do not pause for phase approvals. Stop early only for a real external blocker: missing account/provider access, staging credentials, required business verification, unavailable GitHub/Supabase/Vercel permissions, production approval, or unavoidable concurrent-work conflict. Show evidence, finish all unblocked work, provide one deterministic operator action, and resume after it is completed.

**Success:** a non-technical admin can find a customer among thousands of conversations, recognize the channel, understand dates/context, see owner/SLA, reply through the correct provider, confirm delivery, recover failures, escalate, inspect audit, understand provider health, and operate from desktop, tablet, or mobile without SQL or developer help.
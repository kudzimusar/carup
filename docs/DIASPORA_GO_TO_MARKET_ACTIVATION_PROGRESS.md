# Diaspora go-to-market activation — progress and truth statement (Issue #127)

> **Status: PARTIAL. The workflow defined by Issue #127 is NOT complete, and neither of its two
> terminal outcomes has been reached.** Two of the five deliverables are implemented and verified;
> three are not yet started beyond the schema this branch adds for them. This document states exactly
> what is true so that nothing here can be mistaken for an activation receipt.
>
> Branch: `claude/diaspora-go-to-market-activation` · Baseline: `afb3736` (exact `origin/main` at start)
> Date: 2026-07-27, updated 2026-07-28 (Owner Continuation Directive v2)

---

## 1. What is actually done

| Deliverable | Status | Evidence |
|---|---|---|
| **A — UI-10 Trade Graph dashboard** | **Implemented and verified** (flags OFF) | 18 backend + 19 web-unit + 17 Playwright/Chromium tests; direct Chromium inspection |
| **B — Confirmed workbook import** | **NEXT (step 2).** Schema only; service, route and UI unwritten | ledger #21 tables exist and are verified; no code reads them yet |
| **C — Live Google Drive** | **Schema only**, plus vault-reference safety | ledger #21 `diaspora_credential_references` + its anti-secret constraints |
| **D — Live subscription billing** | **Correctness fix only** (webhook CSRF); live provider not implemented | webhook now reaches its handler; reconciliation table unused |
| **E — SafeTrade ST-3 closure** | **ALL FOUR ITEMS CLOSED END-TO-END** (2026-07-28). Sandbox only; live money still fail-closed | ledgers #22/#23 + services + operator console; 42 + 29 real-Postgres assertions, 51 service tests, 14 Chromium |

### ST-3, item by item

| Item | Mechanism | Wired into the request path? |
|---|---|---|
| **#1** transactional outbox for auxiliary dispute/delivery events | **CLOSED.** Ledger #23 gives the dispute-hold and delivery-window-close paths atomic RPCs: state change + CRITICAL audit + outbox events in ONE transaction. Drainer claims with `FOR UPDATE SKIP LOCKED` under a visibility lease, backs off exponentially, and dead-letters at the attempt ceiling | **YES** — both services call the atomic RPCs; drainer + operator console shipped |
| **#2** maker-checker separation | Enforced in three independent layers: service, DB CHECK constraint, and the RPC under its row lock | **YES** — the request half now files automatically on a HIGH-risk evaluation; approve/reject in the operator console |
| **#3** provider/ledger ordering | Durable operation state machine; reserve → dispatch → confirm → `ledger_applied` in the committing transaction | **YES** — reserved before every provider call; unconfirmed operations visible in the reconciliation queue |
| **#4** durable webhook de-duplication | `UNIQUE (provider, event_id)` in Postgres; out-of-order events recorded and superseded | **YES** — the payment-webhook route uses it; the process-memory `Set` is gone |

The decisive proof for #1 is a rollback, not a happy path: the harness opens a transaction, observes
the state change, the audit row and the outbox event, rolls back, and shows all three are gone. A
best-effort append made after COMMIT cannot do that — which is the entire reason item #1 existed.

Nothing in this branch has been applied to any database, deployed to any environment, or had any
feature flag turned on. Production is untouched.

---

## 2. Verification actually performed

| Gate | Result |
|---|---|
| Backend unit/integration (`node --test backend/tests/*.test.js`) | **2153 tests · 2141 pass · 0 fail · 12 skipped** (baseline was 2093/2081/0/12) |
| Web unit (`vitest`) | **74 files · 642 tests · 0 fail** |
| Web typecheck (`tsc --noEmit`) | clean |
| Production web build | clean |
| CR-1 secret scan | clean (1507 tracked files) |
| Real-Postgres — ledger #21 ACL/constraint contract | **106 / 106** on PostgreSQL 17.5 |
| Real-Postgres — ledger #22 ST-3 RPC behaviour | **29 / 29** on PostgreSQL 17.5 |
| Real-Postgres — pre-existing main migration check | pass |
| Playwright · bundled Chromium · UI-10 | **17 / 17, zero retries, zero accepted flakes** |
| Direct Chromium inspection | route mounts, flag honoured, no horizontal overflow, no page-specific console errors |

**Not performed:** staging migration application, staging deployment, deployed-staging UAT,
production anything. Those are listed in §5 as remaining work, not as passed gates.

### Why the real-Postgres harnesses are trustworthy

`database/test/diaspora_gtm_migration_check.mjs` models Supabase's `ALTER DEFAULT PRIVILEGES` — the
platform behaviour that silently grants every new public-schema table to `anon` and `authenticated`,
and the root cause of compensating ledgers #17, #19 and #20. Before asserting anything it creates a
control table with no grants and **proves the hazard is live in the harness**; if that control ever
stops leaking, the ACL assertions would be passing vacuously and the run fails. Privileges are read
with `has_table_privilege()` across all **eight** PG17 privileges including `MAINTAIN`, which
`information_schema` cannot report, plus column-level ACLs.

`database/test/diaspora_st3_migration_check.mjs` applies the **real** ledgers #13, #21 and #22 and
then *executes* the transition RPC through the scenarios ST-3 exists to prevent, rather than
asserting that DDL parses.

---

## 3. Defects found and fixed

Three defects were found by adversarial review of the reconciled tree. **All three passed every
existing test.** They share a shape worth recording: both sides of a contract were correct in
isolation and nothing connected them, so unit tests of either side pass while the system does not
work.

1. **Both Diaspora provider webhooks were CSRF-blocked in production.** Neither
   `/api/diaspora/subscription/webhook` nor `/api/diaspora/safetrade/payment-webhook` was on the
   `csrfMiddleware` exemption list, so in any non-test environment every provider delivery was
   rejected before its handler ran. A payment provider has no browser session and cannot present a
   CSRF token, so live billing and SafeTrade webhooks could not have worked at all. The whole suite
   passed because `csrfMiddleware` short-circuits on `NODE_ENV==='test'` **before** consulting the
   list — the tests were structurally incapable of catching it.

2. **The Trade Graph was write-dead.** `eventWorker` invoked subscribers with three arguments; the
   Phase 10 projection subscriber requires a fourth (the raw outbox record) because `event.id` is its
   idempotency key and `source_event_ref`. It threw on every event, so `trade_graph_*` stayed empty
   and UI-10 would have rendered a permanently — and honestly — empty dashboard.

3. **The money path called the provider before recording anything.** ST-3 item 3 was closed in SQL
   and still open in JavaScript: the provider was dispatched first and our ledger written afterwards,
   so a crash or an RPC refusal left the provider having acted with no authoritative record. With a
   live provider that is real money moved, and a retry moves it twice.

A fourth was found by the ledger #21 harness itself: actor-identity columns were typed `uuid`, but
user ids are `text` throughout the Diaspora schema. Real ids such as `user-reviewer` were unstorable
and the maker-checker comparison raised `operator does not exist: uuid = text`. Found by the
behavioural harness, not by review.

---

## 4. What is fail-closed right now

| Surface | State |
|---|---|
| `DIASPORA_TRADE_GRAPH` (backend capability) | OFF — entire API surface 404s |
| `VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED` | OFF — nav hidden, page shows unavailable, **no network call** |
| `VITE_DIASPORA_TRADE_GRAPH_AI_ENABLED` | OFF — gated separately from the dashboard |
| `DIASPORA_SAFETRADE_LIVE_PAYMENT` | OFF — and the RPC refuses `p_live_payment=true` and any non-sandbox provider at the **database** boundary (verified) |
| `SAFETRADE_APPROVED_LIVE_PROVIDERS` | empty — live selection throws `EXTERNAL_ACTIVATION_REQUIRED` |
| `APPROVED_LIVE_PROVIDERS` (billing) | empty — same |
| Google Drive live provider | six methods throw `EXTERNAL_ACTIVATION_REQUIRED` |
| Confirmed workbook import | still refused; only dry-run and draft execution exist |
| Ledgers #21 / #22 | committed, **not applied** to any database |

---

## 5. Remaining work before Issue #127 can close

**Engineering (no external dependency — implementable now):**

- Deliverable **B**: confirmation service, execution state machine with compensation, per-row
  receipts, downloadable result workbook, operator recovery controls, UI, Playwright journeys.
- Deliverable **C** (sandbox half): vault adapter over `diaspora_credential_references`, the real
  Google Drive provider implemented against the API with an injectable HTTP transport, durable sync
  attempts with retry/backoff, connect/disconnect/reconnect UI states, token-absence proofs.
- Deliverable **D** (correctness half): wire `diaspora_billing_reconciliation_runs`, out-of-order
  event handling, complete entitlement enforcement across gated operations, observability.
- Deliverable **E**: **DONE** (2026-07-28). All four ST-3 items closed end-to-end, with the outbox
  drainer, retries, dead-letters, operator console and Chromium matrix. One best-effort audit remains
  by design (`SAFETRADE_DISPUTE_EVIDENCE_ADDED`) and is documented inline: item #1 concerns TRANSITION
  audit, and adding evidence appends to an append-only table where the row IS the record.
- Apply ledgers #21/#22 to staging, verify, then deploy and run the deployed-staging UAT.

**Owner-only external actions (cannot be created by an agent).** Listed for completeness — this
branch does **not** yet claim it has finished everything else, so this is not the consolidated
checklist that Issue #127's second terminal outcome calls for:

1. Google OAuth client id/secret + verified consent screen, and an approved redirect URI.
2. An approved vault/KMS/secret-store account (a database column is not an acceptable substitute).
3. Subscription provider merchant account and **test-mode** API keys, plus approval of plans, prices
   and currencies.
4. SafeTrade payment/escrow provider merchant eligibility and the legal/custodial determination of
   the operating model — payment facilitation, marketplace split payments, or licensed escrow. CarUp
   must not be described as holding escrowed funds unless the structure supports that claim.
5. Explicit production money-movement authorization, separately from any of the above.

---

## 6. Honest statement of outcome

Issue #127 defines two permitted terminal outcomes. **Neither applies to this branch.**

- It is not `GO-TO-MARKET ACTIVATION COMPLETE — CHROMIUM/PLAYWRIGHT VERIFIED`, because three of five
  deliverables are not implemented and nothing has been deployed or applied.
- It is not `GO-TO-MARKET ACTIVATION IMPLEMENTATION COMPLETE — OWNER EXTERNAL ACTIONS REQUIRED`,
  because the work that remains is overwhelmingly ordinary engineering with no external dependency —
  it is not blocked on any owner action.

What this branch is: a verified, self-consistent increment that closes SafeTrade ST-3, ships UI-10,
fixes three latent production defects, and lays the audited schema foundation the remaining three
deliverables build on. It is safe to review and merge on its own terms, and it leaves every risky
surface exactly as fail-closed as it found them.

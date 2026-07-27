# Diaspora go-to-market activation — progress and truth statement (Issue #127)

> **Status: PARTIAL. The workflow defined by Issue #127 is NOT complete, and neither of its two
> terminal outcomes has been reached.** Two of the five deliverables are implemented and verified;
> three are not yet started beyond the schema this branch adds for them. This document states exactly
> what is true so that nothing here can be mistaken for an activation receipt.
>
> Branch: `claude/diaspora-go-to-market-activation` · Baseline: `afb3736` (exact `origin/main` at start)
> Date: 2026-07-27, updated 2026-07-28 (Owner Continuation Directive v2 — checkpoint 2)

---

## 1. What is actually done

| Deliverable | Status | Evidence |
|---|---|---|
| **A — UI-10 Trade Graph dashboard** | **Implemented and verified** (flags OFF) | 18 backend + 19 web-unit + 17 Playwright/Chromium tests; direct Chromium inspection |
| **B — Confirmed workbook import** | **COMPLETE** (2026-07-28). Backend + UI + Chromium. Flags OFF | 31 service + 9 contract + 23 helper tests; 24 Chromium; ledger #21 constraints in the 106/106 real-Postgres run |
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

## 3b. Deliverable B was not actually working (found 2026-07-28, fixed in `ee38004`)

Specifying the import UI against the shipped API surfaced three P0 defects in the confirmed-import
backend. **All three passed the existing 31 tests.** They are the same shape as the three in §3: two
sides of a contract, each correct alone, with nothing asserting the join.

1. **Nothing was ever applied.** `executeWorkbookImportAction` reports through `status` +
   `targetRecordId`; it has never had an `executed` boolean or a `recordId`. The orchestrator read
   exactly those two, so `result?.executed` was permanently `undefined` and **every** row — including
   rows whose draft record was successfully inserted — was receipted as a *skip*. `applied` stayed
   empty, so compensation had nothing to reverse while the inserted rows stayed in the database, and
   a half-applied run still reported *"every applied row was reversed. Nothing was imported."* That
   is precisely the outcome compensation exists to prevent, and precisely the claim §1 said this
   feature must never make. The seam is now an exported pure function, `classifyExecutionResult`.
2. **Every `.xlsx` upload was unconfirmable.** The upload route hashes the raw bytes and passes
   `sourceChecksum` as an *option*; persistence only read the checksum out of the client *payload*.
   Uploaded batches therefore persisted with `checksum_sha256 = NULL`, and `POST /confirm` refuses a
   batch with no recorded checksum (`BATCH_CHECKSUM_MISSING`). The entire upload path was dead.
   Persistence now honours the server-computed value and prefers it over a client-declared one.
3. **Receipts authorized the session but never the batch.** `/receipts`, `/receipts.csv` and
   `/interrupted-imports` ran on `authorizeRole()` alone — "any authenticated user" — and
   `listReceipts` drops its tenant filter entirely when the request carries no `x-tenant-id`. The
   backend uses the service-role client, so RLS did not backstop it: a request without that header
   could read another organisation's receipts by batch id. Receipts now authorize through
   `getDiasporaWorkbookImportBatch` and scope to that batch's own tenant; the tenant-wide list fails
   closed.

**Why the suite missed all three:** the only `appliedRows` assertion in
`diaspora-workbook-confirmed-import.test.js` runs against an **empty row set**, where "0 applied" is
true whether the feature works or not — and nothing asserted the shape of the value crossing the
executor→orchestrator seam. The 9 new tests in `diaspora-workbook-confirmed-import-contract.test.js`
are written from the seam; the checksum ones were guard-checked and fail against the previous code.

---

## 3c. Step 3 Phase-1 discovery — three billing defects fixed, the rest catalogued (2026-07-28)

Adversarial discovery of the subscription surface (directive Phase 1) mapped the system end-to-end
and audited it for vacuous tests. **Three defects were fixed immediately** because Phase 1 requires
fixing P0/P1 before building; the remainder are catalogued here as the Step 3 work list.

### Fixed in this checkpoint

1. **P0 — the webhook's only credential was a literal committed to this repository.**
   `billingWebhookSecret()` fell back to a hard-coded string whenever `NODE_ENV !== 'production'`.
   That route (`POST /api/diaspora/subscription/webhook`) has **no auth middleware**, is deliberately
   **CSRF-exempt**, and writes authoritative subscription state through the **RLS-bypassing
   service-role client**. And because `APPROVED_LIVE_PROVIDERS` is empty, the *sandbox* provider is
   selected in **every** environment — so its HMAC check, keyed on that secret, is the real
   authentication everywhere. Any deployment with `NODE_ENV` of `staging`, `preview`, `development`
   or unset would therefore accept a forged webhook from anyone who had read this file, moving an
   arbitrary tenant onto any plan; the signature verified because the attacker held our key. Now
   fails closed outside `NODE_ENV==='test'`. The duplicate literal in
   `diaspora-entitlements.test.js` — which is *why* the suite could never catch this — now derives
   the key instead.
2. **P0 — a failed apply blackholed the event permanently.** Webhook idempotency keyed on **row
   existence**, but the row is written *before* the state is applied and `processed_at` stamped
   *after*. Any failure in between (a status the CHECK rejects — providers emit `canceled`, the CHECK
   only accepts `cancelled`; an unknown `plan_key` hitting the FK; the partial-unique collision
   between concurrent deliveries) left the provider retrying into a permanent
   `200 alreadyProcessed`, with `processed_at` NULL and nothing scanning for it. A cancellation lost
   that way leaves the tenant on a paid plan forever. Idempotency now keys on **completed work**, and
   a retry claims the existing row rather than colliding with `uq_diaspora_billing_event`.
3. **P1 — cancellation and expiry did nothing at all.** `resolveSubscription` decided access from
   `status` alone. Nothing in this system ever transitions a row out of `active`: there is no
   scheduler, and an at-period-end cancellation intentionally **keeps** status `active` (that is what
   it means). So a tenant who cancelled — and was told "access continues until the period ends" —
   kept the full paid entitlement set permanently, as did a tenant whose period simply lapsed. Access
   is now decided by `grantsAccessNow(row)`, which honours `current_period_end` alongside status
   while preserving status-only behaviour for open-ended rows.

Tests: `backend/tests/diaspora-billing-security-contract.test.js`, 13 assertions, **guard-checked —
12 of 13 fail against the previous implementation.**

### Catalogued, NOT yet fixed — the Step 3 work list

| # | Severity | Defect |
|---|---|---|
| 1 | P0 | Ledger #21's `occurred_at` / `provider_sequence` / `superseded` columns — added specifically for out-of-order handling — are **unused**. The webhook is last-write-wins on arrival order, so a retried older event re-grants a cancelled plan. SafeTrade already does this correctly and is the reference. |
| 2 | P1 | Only **4 of 19** feature keys are ever passed to the entitlement guard. Turning `DIASPORA_SUBSCRIPTION_ENFORCEMENT` on leaves Drive, audit export, advanced graph, AI, containers and API access ungated — the paid tiers are unsellable. |
| 3 | P1 | `diaspora.ai.execute_medium` is advertised as metered and surfaced by `GET /usage`, but **nothing ever meters it**. The exhausted-quota and unlimited UI states are proven only against fixtures the server cannot produce. |
| 4 | P1 | A soft-deleted entitlement override can **never be re-granted**: the lookup filters `deleted_at IS NULL` but the UNIQUE constraint has no such predicate, so the re-insert 23505s into a 500. |
| 5 | P1 | `releaseUsage` decrements the meter with a non-atomic JS read-modify-write; concurrent releases permanently inflate remaining quota. Reservation is atomic; release is not. |
| 6 | P1 | **No idempotency key** on checkout / portal / change-plan / cancel. SafeTrade forwards `x-idempotency-key`; the subscription methods do not. |
| 7 | P1 | **No audit row on any subscription state change** — not on checkout, plan change, cancellation, or webhook apply. Only usage commit/release/override are audited. |
| 8 | P1 | `diaspora_billing_reconciliation_runs` exists in ledger #21 and is written by **nothing**. There is no drift detection between provider state and our rows. |
| 9 | P2 | `successUrl`/`cancelUrl` accepted verbatim with no allow-list — an open-redirect surface the moment a live provider is approved. |
| 10 | P2 | A verified webhook with no `tenantId` is ACKed, marked processed and silently discarded; the provider never resends. |
| 11 | P2 | The SQL plan seed and `PLAN_CATALOG` duplicate the entitlement matrix with **no parity test**; production reads the DB branch, every route test reads the config branch. |

### Mock-fidelity gaps that make whole classes of billing assertion vacuous

`backend/tests/helpers/mockSupabase.js`: `select()` ignores its column list; `.or()`, `.gte()`,
`.lte()`, `.gt()`, `.lt()` are **no-ops** (every range/period/expiry filter silently dropped);
`.delete()` falls through to the select path and deletes nothing; `.upsert()` is aliased to `insert`
with the conflict target ignored; CHECK constraints, foreign keys and RLS are absent entirely; and
`eq(col, null)` *matches* NULL rows where Postgres matches none. Only 5 tables have UNIQUE indexes
registered — **not** `diaspora_subscriptions`, `diaspora_user_entitlement_overrides`,
`diaspora_usage_meters` or `diaspora_usage_reservations`, all of which have real UNIQUE constraints.
Defects 2, 4 and 5 above are individually invisible to this mock.

Also: nine backend test files abort on import when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
unset, hiding **190 tests** and silently lowering the totals. CI sets them; local runs typically do
not, which is exactly when the loss is invisible.

---


## 3d. Closure checkpoint (2026-07-28) — both UI lanes integrated and proven in Chromium

Integrator head at this checkpoint: see the PR. Work added in this pass, all on the integration
branch, with the concurrent-writer conflict that preceded it resolved (single writer confirmed).

### Billing operator UI (Deliverable D tail)

The backend had shipped `/reconcile`, `/reconciliation-runs` and `/billing-health` with **no UI
consuming any of them** — four durable signals existed and nothing surfaced. `BillingOperationsPanel`
renders them under one rule: **a route that responds is not a healthy system.** Reconciliation
FRESHNESS is judged independently of mismatch counts, because a scheduler that quietly stopped
reports the same "0 mismatches" as a healthy one, and nothing else in the system notices provider
drift. Never-run and stale both read as failed and raise a needs-operator state; dead-lettered
provider events are terminal and say so. The panel is unconditionally labelled test mode, removes
itself entirely on a 403 rather than rendering a misleading empty dashboard, loads once per mount,
and a double-clicked Reconcile issues exactly one POST.

### Drive status + durable-sync UI (integration request #3)

Types mirroring `sanitizeSyncAttempt` (no token field on any of them by design), the
`sync-attempts` reader, `activation.pending` rendering "Drive is not yet activated" and **hiding**
Connect (which without owner credentials could only fail `NOT_CONFIGURED`), and the distinction the
backend provides preserved: `dead_lettered` is a failure needing user action, never a
warning-coloured "syncing"; `failed` with a `nextAttemptAt` is the retrying case.

### Defects found and fixed while doing it

1. **P0 — the Drive page carried the same unbounded request loop PR #130 fixed.** It held the
   aggregate `useCarUpApi()` object and derived its effect deps from it. Proven: 7 of the new tests
   fail against that pattern, six by 5-second infinite-loop timeout.
2. Three **responsive** defects, all pre-existing: an unbroken 42-character scope URL widened the
   Connection section past a 390px viewport; grid items default to `min-width:auto` and could not
   shrink (held at 412px in a 390px viewport — `min-w-0` is the fix); the linked-files table had no
   overflow container.
3. Two **test** defects that produced misleading results rather than honest failures: a flag guard
   that checked `count()` before React mounted (flaky skip instead of a real run), and a
   `'**/api/**'` catch-all registered LAST — Playwright resolves the last matching route, so it
   silently overrode the CSRF mock and the reconcile POST failed with "Could not establish a secure
   session", surfacing only as a missing element.

The overflow assertions now name the offending element, width and text. The first two attempts at
that fix were wrong precisely because a bare boolean said nothing about which node was too wide.

### Combined local closure gate at this checkpoint

| Gate | Result |
|---|---|
| Backend (`ALLOW_OCR_MOCK=true`, canonical env) | **2496 tests · 2484 pass · 0 fail · 12 skipped** |
| Web unit | **81 files · 744 tests · 0 fail** |
| Real PostgreSQL — ledger #21 GTM foundation | **106 / 106** |
| Real PostgreSQL — billing (#24) | **36 / 36** |
| Real PostgreSQL — Drive vault reference | **76 / 76** |
| Real PostgreSQL — ST-3 (#22) | **29 / 29** |
| Real PostgreSQL — ST-3 item 1 (#23) | **42 / 42** |
| TypeScript | clean |
| Production web build | clean |
| CR-1 secret scan | clean (1571 tracked files) |
| Chromium — new Drive sync-state matrix | **10 / 10** (desktop + mobile) |
| Chromium — new billing operations matrix | **12 / 12** (desktop + mobile) |
| Chromium — existing Drive + subscription suites | **22 / 22** |

**Note on the OCR failures reported in earlier checkpoints:** they were an environment artifact of
running without `ALLOW_OCR_MOCK=true`, not defects. With the canonical env the backend suite is 0
fail. Earlier reports of "11 pre-existing failures" should be read that way.

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

## 4b. RESUME POINT (Owner Continuation Directive v4 — checkpoint 5)

Branch `claude/diaspora-go-to-market-activation`, PR **#129**, head `112b22b`. 0 behind main.

| Step | State |
|---|---|
| 1 — ST-3 item #1 | **DONE** |
| 2 — Confirmed workbook import | **DONE** (backend + UI + Chromium) |
| 3 — Subscription billing, test mode | **DONE** — see gaps below |
| 4 — Google Drive | **DONE** — see gaps below |
| 5 — Vercel staging deploy | **BLOCKED (owner)** — account quota |
| 6 — Staging migrations + deployed matrix | **BLOCKED (owner)** — workflow not on default branch |
| 7 — Fixture cleanup + receipt | depends on 5/6 |

### Combined gates at this head

| Gate | Result |
|---|---|
| Backend (`ALLOW_OCR_MOCK=true`) | **2496 · 2484 pass · 0 fail · 12 skipped** |
| Web unit | **78 files · 712 tests · 0 fail** |
| Real Postgres 17.5 — five harnesses | **289 assertions · 0 failed** (#21 106 · #22 29 · #23 42 · drive-vault 76 · billing 36) |
| Chromium — GTM suites | **55/55**, zero retries |
| Chromium — subscription / drive (isolated, `--retries=0`) | **18/18** and **4/4** |
| build · tsc · lint gate · CR-1 | clean · clean · 0 net-new · clean (1563 files) |

### The two staging blockers are genuinely owner-only

1. **Vercel** — `vercel deploy` returns `Resource is limited - try again in 24 hours (more than 100,
   code: api-deployments-free-per-day)`. The `Ready` deployments visible earlier in the day predate
   the cap. Needs the daily reset or a plan upgrade.
2. **Migrations** — `workflow_dispatch` workflows are only dispatchable if the file exists on the
   **default branch**. `diaspora-staging-gtm-migrations.yml` exists only on this branch, and merging
   PR #129 is explicitly forbidden. GitHub returns
   `HTTP 404: workflow ... not found on the default branch`. The owner must either place that one file
   on `main` or run `backend/scripts/diaspora-staging-apply-gtm.mjs` with the staging credential.

The deployed browser matrix and fixture seed/cleanup both depend on these, so they are not startable.

### Engineering that genuinely remains (NOT owner-gated)

- **One managed vault backend client.** `resolveVault()` throws `VAULT_NOT_CONFIGURED` for every
  managed backend. It is one class implementing four methods, but which class depends on the owner's
  vault choice, so it is half engineering and half decision.
- **Four entitlement keys unenforced**, each with a written reason asserted by test: `drive.connect`
  and `drive.export` (the Drive lane could not edit those files; now that both lanes are integrated
  they can be wired), `graph.advanced` (needs an async refactor of the trade-graph context guard
  across 10 call sites; the capability flag is OFF so the surface 404s), `api.access` (no diaspora API
  surface exists).
- **No scheduler wiring** for billing reconciliation or the checkout-abandonment sweep. Both are
  implemented and operator-triggerable; nothing calls them on a timer.
  `DIASPORA_BILLING_RECONCILIATION_SCHEDULER` exists and defaults OFF.
- **The Zimbabwe-side renewal scheduler** described in ADR-001 §8 is not built.

### Owner external actions

1. Google OAuth client id/secret, a byte-identical redirect URI, and a `drive.file` consent screen.
2. `DIASPORA_DRIVE_STATE_SECRET` (the OAuth state signer already fails closed without it).
3. A vault backend choice plus its credentials.
4. Billing provider merchant account and **test-mode** keys, plus approval of plans/prices/currencies.
   ADR-001 records a corporate-entity precondition that gates the recommendation.
5. Vercel plan upgrade or the daily reset.
6. Place `diaspora-staging-gtm-migrations.yml` on the default branch.

Ledgers **#21, #22, #23, #24 are committed and UNAPPLIED to every database.** No live-risk flag is on.

---

## 5. Remaining work before Issue #127 can close

**Engineering (no external dependency — implementable now):**

- Deliverable **B**: **DONE** — backend, UI and the 24-scenario Chromium matrix.
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

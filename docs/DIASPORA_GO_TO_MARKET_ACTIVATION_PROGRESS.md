# Diaspora go-to-market activation — current truth (Issue #127)

> **This is a single current-state statement, not a checkpoint log.**
>
> Earlier revisions of this file appended a new checkpoint each pass while leaving the previous ones
> in place. The result contradicted itself: §1 called Drive "schema only" and billing a "correctness
> fix only" while §3d and §4b recorded both as done and Chromium-proven, and §6 asserted "three of
> five deliverables are not implemented" against a tree in which all five exist. A progress document
> that says both things says nothing. Those sections are deleted rather than annotated; the history
> is in git.
>
> Branch `claude/diaspora-go-to-market-activation` · PR **#129** · rewritten 2026-07-30 (Owner
> Continuation Directive v5, Phase 3).

---

## 1. How to read the status columns

A deliverable can be true at one level and false at the next, so the levels are tracked separately.
Collapsing them is exactly how a progress document starts lying.

| Level | Means |
|---|---|
| **Implemented locally** | Code is on the branch and its tests pass on this machine |
| **Applied to staging** | Its migrations are recorded in canonical staging's `supabase_migrations.schema_migrations` |
| **Deployed to staging** | The exact frozen candidate is serving on the staging frontend and backend |
| **Deployed-UAT verified** | The browser matrix passed *against that deployment*, not against a local dev server |
| **Production** | Untouched by this branch. Always. |

"Implemented locally" is the weakest claim on the list. It is not activation, and nothing below
should be read as activation.

---

## 2. Deliverable status

| Deliverable | Implemented locally | Applied to staging | Deployed to staging | Deployed-UAT verified |
|---|---|---|---|---|
| **A — UI-10 Trade Graph dashboard** | ✅ | ❌ | ❌ | ❌ |
| **B — Confirmed workbook import** | ✅ | ❌ | ❌ | ❌ |
| **C — Google Drive** | ✅ test transport; live needs owner OAuth | ❌ | ❌ | ❌ |
| **D — Subscription billing** | ✅ provider test mode; live needs a merchant account | ❌ | ❌ | ❌ |
| **E — SafeTrade ST-3** | ✅ all four items | ❌ | ❌ | ❌ |

**Production: untouched.** No migration applied, no deploy, no live-risk flag enabled, no real money
moved by anything in this branch.

Every column after the first is empty for a single reason, and it is not "not built" — see §5.

---

## 3. What each deliverable actually is

**A — UI-10 Trade Graph.** Tenant summary, projection health measured as lag from the last event
*processed* rather than from a heartbeat (a worker that stopped consuming still emits heartbeats),
dead-letter visibility, and an admin rebuild. Responses carry counts and status only, so they cannot
carry PII by construction rather than by redaction.

**B — Confirmed workbook import.** A confirmation is bound to tenant + checksum + dry-run revision +
user + expiry + idempotency key. Quota is reserved before any row is applied; a receipt is written as
each row is decided; failure compensates; quota is released rather than committed. An *irreversible*
partial failure routes to `NEEDS_OPERATOR` with an explicit do-not-retry and no retry control
rendered at all — the one case where offering a button would be the defect. `imported: true` requires
that every row applied.

**C — Google Drive.** A vault interface handing out opaque random handles (never secret-derived), the
real Drive v3 provider over an injectable transport, PKCE with the verifier vaulted and destroyed
after a single exchange, tenant binding, durable sync attempts with backoff and dead-lettering, and
an adversarial token-absence proof carrying positive controls that prove the detector is capable of
failing.

**D — Subscription billing.** Provider ADR, a provider-neutral adapter over an injectable transport,
a durable webhook ledger with supersede semantics for out-of-order delivery, reconciliation with
freshness judged independently of mismatch count (a scheduler that silently stopped reports the same
"0 mismatches" as a healthy one), and entitlement enforcement.

**E — SafeTrade ST-3.** All four items closed: transactional outbox with a drainer, maker-checker
separation, provider/ledger ordering, durable webhook de-duplication. The decisive proof for the
outbox is a rollback, not a happy path — the harness observes the state change, the audit row and the
outbox event inside one transaction, rolls back, and shows all three gone. A best-effort append made
after COMMIT cannot do that, which is the entire reason the item existed.

---

## 4. Migrations

All are **committed and unapplied to every database, including staging.**

| Ledger | File | sha256:12 |
|---|---|---|
| #21 | `20260727120000_diaspora_gtm_activation_foundation.sql` | `157dae537997` |
| #22 | `20260727130000_diaspora_safetrade_st3_closure.sql` | `610ac3118e64` |
| #23 | `20260728090000_diaspora_safetrade_st3_item1_closure.sql` | `385cd2724015` |
| #24 | `20260729090000_diaspora_billing_test_mode_closure.sql` | `28aa8c6d7807` |
| #25 | `20260730090000_diaspora_atomic_quota_release.sql` | `dad8779da60b` |
| #26 | `20260731090000_diaspora_entitlement_override_regrant.sql` | `93ab8f5ee95a` |
| #27 | `20260731100000_diaspora_scheduler_leases.sql` | `8efa7e011b4e` |

Each carries the ledger-#20 ACL contract — `PUBLIC`, `anon` and `authenticated` hold nothing;
`service_role` holds exactly what it needs; RLS on — applied in the *same* migration that creates the
object, because Supabase's `ALTER DEFAULT PRIVILEGES` grants every new public-schema table to `anon`
and `authenticated` the instant it is created. That platform behaviour is the root cause of
compensating ledgers #17, #19 and #20, and the harness reproduces it deliberately: it creates a
control table with no grants and fails the whole run if that control *stops* leaking, because at that
point the ACL assertions would be passing vacuously.

---

## 5. The staging lane — where it actually stands

The secure dispatcher merged to `main` as PR #131 and is registered. It was dispatched in `verify`
mode as **run 30270396058**, which established three things:

- all four pinned checksums verified against the pinned candidate — **PASS**;
- the ref gate, actor gate, pinned checkout, secret scoping and typed-input design behaved — **PASS**;
- TLS — **FAIL**: `self-signed certificate in certificate chain`.

A certificate error is not the acceptable "nothing applied yet" preflight outcome. It means the
connection could not be trusted, so the lane stopped and the cause was repaired rather than muted.

**Cause.** Supabase's Postgres endpoints chain to a self-signed `Supabase Root 2021 CA`, deliberately
absent from Node's public root store. The repository's older #19/#20 appliers answered this with
`rejectUnauthorized: false`, which does not fix the problem — it stops asking the question. A
connection that does not verify is a connection that can be intercepted, and this one carries a
credential with write access to every Diaspora table.

**Repair (`eb9426f`).** Supabase's published root is bundled at `database/certs/` and pinned as the
trust anchor, so verification genuinely succeeds against one known certificate. Precedence: an
explicitly supplied `DIASPORA_STAGING_CA_CERT`, then the bundled root, then Node's public roots. No
code path disables verification.

**Consequence.** The migration runner changed, so the dispatcher's pin at `001cf808…` became stale —
it points at the pre-repair runner, which would fail the same way. Advancing the pin is a reviewable
pull request against `main` by design: that is the property that makes a pinned SHA worth having, and
it is why the pin is not something this branch can move on its own.

**Where the lane stands now.** **PR #132 is open and MERGEABLE**, pinning candidate
`fff881371b995126af69c5825159f9707167dad0` and declaring all seven ledgers. It changes one workflow
file — comments, the two SHA occurrences and two step names — and applies nothing: the default mode
is still `verify`. All 17 controls established by PR #131 were re-verified against the **parsed**
YAML rather than the source text, which matters because `#21` starts a YAML comment and silently
truncated this workflow's own name once already.

The staging column is empty because that pin has not landed on `main` yet — not because the
migrations are unfinished.

---

## 5b. The pre-freeze review, and what it caught

Before pinning a candidate at a real database holding a service-role credential, the integrated tree
went through an adversarial review: six independent dimensions over the diff, then **two** independent
refuters per finding, each instructed to default to *refuted* when uncertain. A finding survived only
if both failed to refute it. 63 agents, and the large majority of candidate findings were refuted —
most apparent defects were already handled somewhere the reviewer had not read, which is exactly what
the refutation pass is for.

Five survived. Each was reproduced before being acted on, and each fix carries a guard-check that
fails against the pre-fix code.

| # | Defect | Why no existing test caught it |
|---|---|---|
| 1 | The runner's own **PUBLIC-EXECUTE check could never fire**. It matched `/(^\|,)=[a-zA-Z]/` against `proacl` text, but an `aclitem[]` renders as `{entry,…}` and the PUBLIC entry is always element **zero** — preceded by a brace, never a comma. A `SECURITY DEFINER` function shipped without its `REVOKE` line would have been executable by `anon`, running as the table owner and bypassing RLS, while the run printed *"contract verified"* and exited 0. | Two harnesses carried the same broken pattern, and ledger #25's RPC had **no PUBLIC assertion at all**. The table side never had the hole because it always used `has_table_privilege`. |
| 2 | **Ledger #27's backoff overflowed int4.** It multiplied before clamping, and a clamp cannot prevent an overflow inside its own argument: at 27 consecutive failures the release RPC raised `integer out of range`. The release then never lands, so the job freezes one short of its terminus with `next_run_at` in the past and re-fails on every tick forever — the exact "dead job becomes background noise" loop the terminus exists to prevent. | The harness drove the failure loop only at `max_failures = 5`, while the constants module accepts up to 50. The JS model computed the same window in IEEE doubles, which cannot overflow, so it disagreed with the SQL precisely where the SQL broke. |
| 3 | **Spec 37's deployed probes were anonymous.** They sent `credentials:'include'` on an application with no cookie session — auth travels as `x-user-id`/`x-session-token` from localStorage. Every "refusal" was an ordinary 401, so the entire fail-closed half of the deployed matrix would have reported green having verified nothing. | A 401 satisfies `expect(status).toBeGreaterThanOrEqual(400)`, and the fixture only fails on 5xx. The file's own rule *"a 404 is not a refusal"* has exactly this shape; it excluded 404 and not 401. |
| 4 | **The plan-catalog read filtered a column that does not exist.** `.is('deleted_at', null)` on `diaspora_subscription_plans` raises 42703, and the error branch was an empty `if`. So every catalog read silently fell back to config: the `source:'db'` branch was dead code in production while the header documented the opposite. An operator raising a tenant's allowance in the database would see the old limit enforced and no error anywhere. | `mockSupabase`'s `.is(col, null)` matches rows whose value is nullish, and a column absent from a row reads as `undefined` — so the mock returned the seeded plan exactly where PostgREST returns a 400. |
| 5 | **The scheduler stranded its lease**, and stamped `finished_at` with the **start** instant. Only the handler was guarded; `openRun`, `closeRun` and the release RPC sat outside any `try/finally`, so a throw in any of them meant the only release call site was never reached. Reachable with no infrastructure failure: the operator route took `tenantId` as a free string while the column is `uuid`. The clock bug put `next_run_at` in the past for any run longer than its interval. | Every existing failure test threw from the **handler** — the one path already caught. Every test injected `now` with a synchronous handler, so start and end coincided legitimately. |

Rule 3 is now written into spec 37 beside the other two, because the pattern is what generalises: a
refusal only counts when the request reached the thing that is supposed to refuse it.

---

## 6. Engineering still open on this branch

Both specialist lanes are integrated. What follows is what genuinely remains, separated from what is
merely an owner decision.

**Nothing is open that would block terminal outcome B on engineering grounds.** The items below are
either deliberate design, or decisions that are not the code's to make.

Deliberate, and documented where they live:

- **The Drive sweep cannot replay uploads.** `diaspora_drive_sync_attempts` stores a content checksum,
  not content, by design. The sweep reclaims abandoned claims and dead-letters at the ceiling;
  unreplayable operations are counted and surfaced (`detail.unreplayable`) rather than silently
  dead-lettered.
- **The renewal sweep does detection only.** It calls no provider method and its table carries no
  amount, currency or payment handle. Collection stays behind ADR-001 §9, which is an owner
  determination, not a missing function.
- **`syncDrive` is ungated.** It refreshes a token; no data leaves the platform through it, and
  `disconnectDrive` must always work.

Owner decisions the code has deliberately NOT made:

- **The buyer/seller Drive tier is thin.** `PLAN_CATALOG` grants `drive.connect: true` and
  `drive.export: false` to `diaspora_buyer` and `seller`. Both keys are now genuinely enforced, so
  with `DIASPORA_SUBSCRIPTION_ENFORCEMENT` on, those tiers can link a Drive and see connection status
  but cannot put a file in it. That is what the catalog says today; widening it is a pricing decision,
  not a code cleanup, and it is one line if the intent was otherwise.
- **`diaspora.api.access` was withdrawn, in config only.** It was `true` on `enterprise` with no
  Diaspora API surface anywhere to gate. The claim is now `false` on every plan and the word "API" is
  gone from the enterprise description — the plan no longer advertises something that does not exist.
  The seeded row in `diaspora_subscription_plans` still carries the old value and cannot be corrected
  without a migration, because the seed ends `ON CONFLICT DO NOTHING`. That divergence is inert while
  the catalog read prefers config, and it is recorded here so it is not discovered later.

Closed on this branch:

- **`releaseUsage` was a non-atomic read-modify-write** — two concurrent releases both read the same
  `used_count` and both wrote the same decrement, so the meter was credited twice for one release and
  remaining quota inflated permanently. Ledger #25 moves the whole sequence under `FOR UPDATE` on both
  the reservation and its meter.
- **A revoked entitlement override could never be re-granted** — `uq_diaspora_user_override` has no
  `deleted_at` predicate, so a tombstone held the unique slot forever and the re-insert surfaced as a
  500 naming a Postgres constraint. Ledger #26 adds the apply and revoke RPCs.
- **Five recurring workloads ran on no timer at all.** Ledger #27 adds the durable scheduler; the tick
  is a GitHub workflow rather than a `vercel.json` cron because the account is on Vercel's Hobby plan,
  where crons fire once per day — and a schedule that claims fifteen minutes while running daily is
  worse than none, because the freshness signals would report health while work sat undone.
- **The Drive provider's vault was unscoped.** `forTenant()` reached the PKCE verifier but never the
  layer holding refresh tokens. Not exploitable — the credential reference always comes from the
  caller's own connection row — but it made the lane's central claim untrue where it mattered most.
- **The five defects in §5b**, found by the pre-freeze review.

## 7. Verification performed locally

At candidate `fff881371b995126af69c5825159f9707167dad0`:

| Gate | Result |
|---|---|
| Backend (`ALLOW_OCR_MOCK=true`, the canonical CI env) | **2656 tests · 2644 pass · 0 fail · 12 skipped** |
| Web unit (vitest) | **81 files · 744 tests · 0 fail** |
| TypeScript · production web build | clean · clean |
| CR-1 secret scan | clean (1607 tracked files) |
| Real PostgreSQL 17.5 — #21 GTM foundation | **106 / 106** |
| Real PostgreSQL 17.5 — #22 ST-3 | **29 / 29** |
| Real PostgreSQL 17.5 — #23 ST-3 item 1 | **42 / 42** |
| Real PostgreSQL 17.5 — #24 billing | **36 / 36** |
| Real PostgreSQL 17.5 — #25 atomic quota release | **28 / 28** |
| Real PostgreSQL 17.5 — #26 override re-grant | **50 / 50** |
| Real PostgreSQL 17.5 — #27 scheduler leases | **73 / 73** |
| Real PostgreSQL 17.5 — Drive vault reference | **76 / 76** |
| Real PostgreSQL 17.5 — function-ACL detector | **16 / 16** |
| **Real-Postgres total** | **456 assertions · 0 failed** |
| Diaspora e2e (`web/e2e`, 197 tests) | 192 passed · 1 skipped · 4 failed under 2-worker contention; **54/54 when the three affected specs are re-run alone** |

All nine ledger harnesses now run in CI. Only one of them did before — the other eight were hand-run
only, so a regression in any could have reached staging unnoticed.

Privileges are read with `has_table_privilege` / `has_function_privilege` across all eight PG17
privileges including `MAINTAIN`, which `information_schema` cannot report at all. That instrument
replaced ACL-text parsing everywhere after §5b finding 1.

### On the `tests/agents` suite

That suite reports 43 failures on this branch — and **13 of the same failures on `origin/main`**,
verified by running the identical specs there. `16-vehicle-evidence-flow` fails a *different* subset
on `main` between runs. None of the failures is in a Diaspora spec; they are auth, dashboard and
navigation journeys that need a backend the local Playwright config never starts. They are recorded
here as pre-existing rather than counted as this branch's, and rather than quietly omitted.

**Not performed, and not claimed:** staging migration application, staging deployment,
deployed-staging UAT, production anything.

Earlier checkpoints reported "11 pre-existing OCR failures". They were an environment artifact of
running without `ALLOW_OCR_MOCK=true`, which CI sets at `ci.yml:30`. There were no such defects.

## 8. Owner external actions

These cannot be performed from the repository, by this agent or any other.

1. **Google OAuth** — client id and secret, a byte-identical redirect URI, and a `drive.file` consent
   screen. Also `DIASPORA_DRIVE_STATE_SECRET`; the state signer already fails closed without it.
2. **Managed vault** — the backend choice, its credentials and its IAM.
3. **Billing provider** — merchant account and **test-mode** keys, plus approval of plans, prices and
   currencies. ADR-001 records a corporate-entity precondition that gates its recommendation.
4. **SafeTrade provider** — merchant eligibility, and the legal determination of the operating model
   (payment facilitation, marketplace split payments, or licensed escrow). CarUp must not be
   described as holding escrowed funds unless the structure actually supports that claim.
5. **Vercel** — the account returned `Resource is limited — try again in 24 hours (more than 100,
   code: api-deployments-free-per-day)`. Needs the daily reset or a plan upgrade before the exact
   candidate can be deployed to staging.
6. **Merges** — PR #129 itself, and the dispatcher-update PR that re-pins the final candidate.
7. **Production money-movement authorization**, separately from every item above.

---

## 9. Fail-closed state

| Surface | State |
|---|---|
| `DIASPORA_TRADE_GRAPH` (backend capability) | OFF — the whole API surface 404s |
| `VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED` | OFF — nav hidden, page reports unavailable, **no network call** |
| `VITE_DIASPORA_TRADE_GRAPH_AI_ENABLED` | OFF — gated separately from the dashboard |
| `DIASPORA_SAFETRADE_LIVE_PAYMENT` | OFF — and the RPC refuses `p_live_payment=true` and any non-sandbox provider at the **database** boundary |
| `SAFETRADE_APPROVED_LIVE_PROVIDERS` | empty — live selection throws `EXTERNAL_ACTIVATION_REQUIRED` |
| `APPROVED_LIVE_PROVIDERS` (billing) | empty — same |
| Google Drive live provider | throws `EXTERNAL_ACTIVATION_REQUIRED` without owner credentials |
| `DIASPORA_BILLING_RECONCILIATION_SCHEDULER` | OFF |
| Ledgers #21–#25 | committed, **unapplied to every database** |

---

## 10. Rollback

- **This branch:** revert it. No database and no deployment has been changed from it, so there is
  nothing else to undo.
- **Migrations:** each applies in its own transaction together with its `schema_migrations` row, so a
  failed apply records nothing and leaves no partial state. #21, #24, #25, #26 and #27 carry real
  `Down` sections. #22 and #23 are tightening-only by design — reversing them would restore the
  best-effort audit path and remove maker-checker from the money boundary — so recovery there is
  restore-from-backup under explicit authorization, not a down migration.
- **Dispatcher:** revert the one workflow file on `main`.

---

## 11. Terminal outcome

Issue #127 permits exactly two. **Neither has been reached**, and the reason has changed.

- Not `GO-TO-MARKET ACTIVATION COMPLETE — CHROMIUM/PLAYWRIGHT VERIFIED`: nothing is applied to
  staging, nothing is deployed, and no browser matrix has run against a deployment.
- Not `GO-TO-MARKET ACTIVATION IMPLEMENTATION COMPLETE — OWNER EXTERNAL ACTIONS REQUIRED`: that
  outcome asserts the remaining work is owner-only. It is *nearly* true now — §6 lists no open
  ordinary engineering — but the staging lane is blocked on a **merge**, and a merge is an ordinary
  action, not an external one. Claiming outcome B while a mergeable pull request sits open would be
  the same species of overstatement this document was rewritten to remove.

**The single thing standing between here and the staging lane** is landing PR #132 on `main`. The
dispatcher only runs from the default branch, so the pin cannot take effect anywhere else. That merge
applies nothing: the default mode is `verify`, and dispatching is a separate act.

Once it lands, the remaining sequence is entirely mechanical and needs no owner input: verify → apply
→ verify against staging, deploy the exact candidate to the staging frontend and backend, run the
deployed browser matrix (specs 32–37), clean up fixtures, and write the closure receipt.

What this branch is today: all five deliverables implemented and locally verified, **seven** audited
migrations frozen and unapplied to every database, a staging runner that verifies TLS instead of
ignoring it and can now actually detect a PUBLIC grant, five defects caught by adversarial review
before any of it touched a database, and every risky surface left exactly as fail-closed as it was
found.

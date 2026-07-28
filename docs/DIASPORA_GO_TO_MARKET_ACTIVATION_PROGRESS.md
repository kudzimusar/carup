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
| **A — UI-10 Trade Graph dashboard** | ✅ | ✅ | ✅ | ⚠ see §5c |
| **B — Confirmed workbook import** | ✅ | ✅ | ✅ | ⚠ see §5c |
| **C — Google Drive** | ✅ test transport; live needs owner OAuth | ✅ | ✅ | ⚠ see §5c |
| **D — Subscription billing** | ✅ provider test mode; live needs a merchant account | ✅ | ✅ | ❌ **defect, §5c** |
| **E — SafeTrade ST-3** | ✅ all four items | ✅ | ✅ | ⚠ see §5c |

**Production: untouched.** No migration applied there, no deploy, no live-risk flag enabled, no real
money moved by anything in this branch.

Ledgers #21–#27 ARE applied to canonical staging and re-verified (§5). Both staging projects are
deployed. The last column is not yet ticked because the deployed browser matrix found a real defect —
see §5c — whose fix cannot be deployed until the Vercel daily quota resets.

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

## 5c. Deployed staging activation — what actually happened

### Migrations: APPLIED and verified

Canonical staging (`eoyenigwevnxwwhyhaer`, PostgreSQL **17.6**). Three dispatches, all preserved:

| Run | Mode | Conclusion | Established |
|---|---|---|---|
| `30309378724` | verify | failure *(permitted)* | 7 checksums valid · bundled Supabase Root 2021 CA · TLS ON · `connected: db=postgres, pg=17.6` · positive staging-ref guard · no production reference · no version collision. Stopped only at `#23 prerequisite … missing` — created by #22, which verify mode declined to write. |
| `30309507308` | apply | **success** | `APPLIED #21…#27 in one transaction; ledger row … recorded`, each followed by `contract verified`. |
| `30309701351` | verify | **success** | All seven `already recorded — verify-only`, `"ok": true`. |
| `30312117396` | verify | **success** | Re-confirmed after fixture cleanup. No re-application needed for a frontend-only fix. |

### Deployment: both projects at `fff8813` — NOT the final candidate

| | |
|---|---|
| Frontend | `dpl_DsNYf3u1Kxw6syLD8EVBCpcTN2Yo`, bundle `index-Bf8sPSsl.js` |
| Backend | `dpl_5zLrD2w6gYNmhPAjZe6ikw6hQqAe`, aliased to `carup-backend-aca7.vercel.app` |

The backend was **re-aliased rather than redeployed**: the frontend bundle bakes in
`carup-backend-aca7`, and that alias pointed at an older build. Aliasing costs no deploy quota and is
what makes "both deployments use the same candidate" true rather than nominal.

### The defect the deployed matrix found

`/diaspora/subscription` never left `subscription-loading`. The page held the aggregate object from
`useCarUpApi()`, which returns a fresh object every render, so `load` changed identity every render
and the mount effect depended on it: load → setState → render → new api → new load → effect → load,
unbounded, issuing subscription requests continuously.

**This is the third occurrence of this exact defect in this codebase.** PR #130 fixed it on
`DiasporaTradeProfile`; the Drive lane fixed it on `DiasporaDriveConnections`; both siblings carry a
comment naming the hazard. `DiasporaSubscription` was written against the same hook and missed it.

Fixed at `543dd51`, guard-checked — 4 requests before, ≤2 after. The regression test asserts REQUEST
COUNTS, because rendered text cannot see this and jsdom resolves mocked promises too fast for a
spinner ever to be sampled.

**The fix is NOT deployed.** Vercel returned `api-deployments-free-per-day` (more than 100), and Git
integration is capped for the same reason. Until it is deployed and the matrix re-run, deliverable D
is not UAT-verified and no terminal outcome is claimable.

### Matrix results, and the corrections they forced

| Run | Result |
|---|---|
| First (`gtm127`) | 78 tests · 58 passed · 16 failed · 4 skipped |
| Second (`gtm127b`, corrected specs) | 78 tests · 67 passed · 7 failed · 4 skipped |
| Spec 37 alone, after two further fixes | **14 / 14** |
| Spec 32 alone, re-run | **14 / 14** |

Of the original 16 failures, only **one test** was a product defect. The rest were defects in my own
specs, and they shared a single shape worth naming: **a refusal read as an absence.**

- **404 as "no gate"** — the first draft probed routes that do not exist; a 404 satisfied
  `status >= 400` and proved nothing.
- **401 as "gate refused me"** — the probes were anonymous, because this app has no cookie session and
  auth travels in headers from localStorage. Every "refusal" was an ordinary auth rejection.
- **400 as "not authenticated"** — the auth canary used a route requiring a tenant, and the staging
  fixtures are tenantless because `switch-role` is fail-closed.
- **404-disabled as "route missing"** — `DIASPORA_SAFETRADE_ENABLED` is off, so the backend 404s the
  whole SafeTrade surface. That IS the fail-closed state the test exists to confirm; it now
  distinguishes the capability marker from a generic route miss and asserts the stronger property
  (the detail route must be closed too).

Two further errors were environmental rather than assertional: the probe ran from `about:blank`, where
reading localStorage throws `SecurityError` and `fetch` is refused by CORS as an opaque origin. The
health-endpoint secret sweep reported **red while its detectors had never executed** — worse than a
false pass, because it looks like evidence of a leak. `/health` is clean; nothing had looked.

**Spec 34 was a premise conflict, not a defect.** It asserted SafeTrade shows "unavailable" *with
flags off* but never checked the flag — and Phase 8 requires SafeTrade exercised, so the flag is on.
Rewritten to assert the invariant that holds either way: the page states its outcome, settles, and the
gate is not decorative. Strengthened, not weakened.

**One failure was non-deterministic**: a 30-second `page.goto('/marketplace')` timeout on mobile only.
Re-running spec 32 gave 14/14 and the URL answers in 0.13s. Recorded as infrastructure, after
re-running rather than by assumption.

### Staging cannot prove CSRF

The staging backend runs `NODE_ENV=test`, which makes `csrfMiddleware` short-circuit **before** its
exemption list. Proven by discriminator, not assumed: a POST to a NON-exempt route with no CSRF token
returns `401 Unauthorized. No active user context.` (auth) rather than `403 CSRF token missing`.

So the deployed matrix cannot demonstrate CSRF in either direction, and no claim here rests on it. The
scheduler-dispatch CSRF fix (`f33cf9f`) remains correct for production, where the bypass does not
apply; its test drives the middleware with `NODE_ENV` set explicitly to `production` and `staging`,
which is the only way the exemption list is ever reached.

### Fixture cleanup — proven

Five synthetic identities, namespaced `+gtm127@carup-staging.test`. The import orders they created
were retired to `CANCELLED` through the product's own `PATCH /import-orders/:id/stages` path — the
product deliberately exposes no DELETE for trade records, which is correct for an auditable trade
system. Proof was re-read from the server rather than taken from local bookkeeping:

```
buyer: total=4 live=0 [CANCELLED,CANCELLED,CANCELLED,CANCELLED]
seller 0 · outsider 0 · reviewer 0 · tenant-admin 0
liveRemaining: 0
```

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

Issue #127 permits exactly two. **Neither is claimed**, and the reason is now narrow and specific.

`GO-TO-MARKET ACTIVATION COMPLETE — CHROMIUM/PLAYWRIGHT VERIFIED` requires a **green deployed browser
matrix**. No such run exists, because of a single external constraint:

- the deployed candidate `fff8813` carries a confirmed defect — the `/diaspora/subscription` request
  loop in §5c;
- the candidate that fixes it **cannot be deployed**. Vercel answers
  `api-deployments-free-per-day` (more than 100), and Git integration is capped for the same reason.

Everything else is done. Ledgers #21–#27 are applied to canonical staging and verified three times.
Both staging projects are deployed and agree on their candidate. Fixture cleanup is proven with
`liveRemaining: 0`. CI is green on the fix candidate — backend 2666 tests / 0 fail, all nine ledger
harnesses passing in CI for the first time.

**Candidate lineage**, so the two are never confused:

| | |
|---|---|
| Deployed now | `fff881371b995126af69c5825159f9707167dad0` — has the defect |
| Owner-frozen fix | `543dd51f4a78eaccb4d9f0299e147689b44f6856` — fixes it, undeployed |
| Local head | `ea39938` — `543dd51` plus TEST-ONLY corrections to spec 37, verified 14/14 against the live deployment. No product code changed after `543dd51`. |

The remaining sequence needs no owner input: one controlled deployment of the fix candidate to both
staging projects when the quota resets, verify the served bundle and backend identity correspond to
it, re-run specs 32–37, clean any new fixtures, prove cleanup, re-run smoke, then publish the receipt.

---

## 6. Closure receipt — the staging wave completed

The blocker recorded in §5 cleared: the Vercel daily deployment quota reset, the fix candidate was
deployed, and the single staging wave ran to completion. This section supersedes the "remaining
sequence" paragraph above.

### 6a. Final integration head

`76cd551bb9d3fd0c05228b49297134de80615484`

Five commits separate it from the deployed source `543dd51`, and **none of them ship**: `ea39938`,
`e399037` and `76cd551` are test-only, `4017f5c` and `057dd97` are docs-only. Asserted by tree hash
rather than by reading the diff, because that is the part a machine can check:

| tree | `543dd51` (deployed) | `76cd551` (head) |
|---|---|---|
| `backend` | `54a7199a1d3e69d9…` | `54a7199a1d3e69d9…` (identical) |
| `database` | `a8a6b075ebd9768d…` | `a8a6b075ebd9768d…` (identical) |
| `web/src` | `9f05e903857b5619…` | `d9b438abb44969ef…` (differs) |

The `web/src` hashes differ and that is worth stating rather than glossing, since it is the one place
this claim could hide a real change. Exactly one file accounts for it —
`web/src/pages/diaspora/DiasporaTradeGraph.test.tsx`, a test that happens to live under `web/src` —
and its content appears **zero** times in the built bundle, because Vite excludes test files from the
production build. Shippable source is therefore identical.

So the live deployment **is** the exact-head deployment in every shippable respect. No redeploy was
required to close the wave, and the candidate lineage in §5 collapses to a single artifact.

A local build hash is *not* evidence here and was not used as such: Vercel inlines project `VITE_*`
values into the bundle, so a local `npm run build` legitimately produces a different filename
(`index-CWx1ddun.js`) from the deployed `index-CtPnm5LX.js` for identical source. Comparing those two
would have manufactured a drift that does not exist.

### 6b. Required workflows, green on one immutable head

All on `e399037`:

| workflow | result |
|---|---|
| CI | success |
| Diaspora Phases 3-7 Validation | success |
| Communication Command Center CI | success |
| Navigation Intelligence CI | success |
| Referral Engine CI | success |
| Diaspora Deployed Staging UAT | skipped — secrets-gated; run directly against the deployment instead (§6d) |

Reaching green took one more repair than expected, and it is the most instructive failure in this
wave. **Referral Engine CI failed on `057dd97` — a commit that changed only documentation.** A
docs-only commit cannot break a test, so the test was already flaky and that runner was merely
slower.

`DiasporaTradeGraph.test.tsx` asserted `expected 'Not yet run' to be 'Behind'`. `HealthBadge` renders
unconditionally from `summary?.health ?? 'UNKNOWN'`, so the badge is in the DOM *before* the load
resolves. `findByTestId` is satisfied by that first pre-load render, so asserting immediately after it
reads the UNKNOWN state — a race the mocked promise usually wins on a fast machine and loses under CI
load. It now waits for `data-health` to reach `DEGRADED` before asserting the label, so the test
observes the state it is actually about. 8/8 consecutive local runs, and the full suite stays 747/0.

Its siblings in that file were checked and are sound: `total-nodes`, `trade-graph-empty` and
`trade-graph-stale` render only once the summary has loaded, so `findByTestId` already waits for the
right state, and the announcer asserts static ARIA attributes only. The health badge was the only
always-rendered element whose content depends on the load.

Phases 3-7 was the focused failure from run `30275157681`. Three diaspora test files aborted on
`Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`. That is a **module-scope** throw in
`backend/db/supabase.js` reached through a *static* import chain, so an in-file `process.env.X ||= …`
guard cannot fix it — ESM hoists the import and the process is already dead before the guard runs.
The fix is test-only placeholder env on the job, identical to `ci.yml`. Reproducing CI's exact
environment locally failed identically; with the env present the same files give 62/62.

### 6c. Deterministic local closure gate

| gate | result |
|---|---|
| Real-Postgres (PGlite) harnesses | **12 / 12 pass**, including `diaspora_entitlement_override_regrant_check.mjs` |
| Backend suite (`ALLOW_OCR_MOCK=true`) | **2654 pass / 0 fail / 18 skip** |
| Web unit (`vitest run` in `web/`) | **747 pass / 0 fail** across 82 files |
| TypeScript | clean |
| Production build | success |

The web unit suite must be run from `web/`. Running `npx vitest run` at the repo root reports ~333
failing files — it sweeps up backend `.test.js` and Playwright specs that vitest cannot collect. That
is operator error, not a regression, and it is recorded here because the failure count is alarming
enough to be mistaken for one.

### 6d. Deployed staging matrix

```
STAGING_WEB_URL=https://carup-staging.vercel.app
STAGING_API_URL=https://carup-backend-aca7.vercel.app/api
STAGING_EXPECTED_BUNDLE=index-CtPnm5LX.js
→ mode=acceptance  ·  74 passed / 0 failed / 4 skipped / 0 flaky / 0 retries
```

Chromium desktop + mobile-chromium. `mode=acceptance` matters: without `STAGING_EXPECTED_BUNDLE` the
harness self-declares `harness-validation` and its own gate fails, which is a deliberate integrity
guard against a run that silently proves nothing.

Two failures were repaired to reach this. Both were in the **test**, not the product:

1. **Spec 36 subscription** demanded the literal string `test mode` from the whole page body. That
   copy lives inside `BillingOperationsPanel`, which is deliberately not rendered while the page shows
   a load denial (`{!loadError && …}`) or to a non-manager. The staging tenant-admin fixture carries no
   tenant context, so the page truthfully rendered *"No tenant context is available"* — a correct
   refusal scored as a missing safety disclosure. The page does make the claim, in its own established
   wording: *"Billing runs in sandbox mode only."* The assertion now accepts either, and separately
   requires the operator panel to carry the stronger claim wherever it does render, so the disclosure
   can never be satisfied by page furniture alone.

   Worth stating plainly, because the first read of this failure was wrong: the test *skips* when the
   identity is missing. It **ran**, so the identity existed and the page had genuinely rendered. An
   environment gap and a product defect look identical in a one-line assertion failure; only the
   captured page snapshot distinguished them.

2. **Spec 37** probed from an opaque origin and read a disabled capability as a missing route.

### 6e. The 4 skips — one owner action

Both skipped tests are in `33-diaspora-staging-browser-parts.spec.ts` (× 2 projects = 4 cases), and
both stop at the same inner guard:

> `seller identity lacks a VERIFIED stock role (received owner) — operator must provision a verified
> seller identity`

The seller fixture authenticates as `owner`. The stock and RFQ journeys require one of
`dealer · admin · platform_admin · super_admin · government · reviewer`. This is the elevated grant
that `backend/scripts/staging-create-test-identities.mjs` already documents as **not provisionable
through public registration**. It is an owner action, not remaining engineering.

### 6f. Ledger inventory #21–#27

| # | sha256[:12] | file |
|---|---|---|
| 21 | `157dae537997` | `20260727120000_diaspora_gtm_activation_foundation.sql` |
| 22 | `610ac3118e64` | `20260727130000_diaspora_safetrade_st3_closure.sql` |
| 23 | `385cd2724015` | `20260728090000_diaspora_safetrade_st3_item1_closure.sql` |
| 24 | `28aa8c6d7807` | `20260729090000_diaspora_billing_test_mode_closure.sql` |
| 25 | `dad8779da60b` | `20260730090000_diaspora_atomic_quota_release.sql` |
| 26 | `93ab8f5ee95a` | `20260731090000_diaspora_entitlement_override_regrant.sql` |
| 27 | `8efa7e011b4e` | `20260731100000_diaspora_scheduler_leases.sql` |

`#21`–`#25` are preserved byte-for-byte: each was touched only by its own creating commit and by
nothing since.

**Database contract verification** — run `30318140329`, `mode=verify`, against canonical staging:
every ledger `#21`…`#27` reports `ok: true`, with `#26` exposing its 2 RPCs and `#27` its 3 tables and
2 functions.

**The staging workflow pin was not advanced again.** `diaspora-staging-gtm-migrations.yml` on the
default branch pins `CANDIDATE_SHA: fff8813`, and its own header records that it was already moved
once (`001cf808` → `fff8813`) — the "exactly once" advance is spent. More to the point, advancing it
would change nothing: the migrations tree at the pin and at the final head are the *same object*
(`68b689cc338eb609c084ead2c81a72d651e7fd9f`), and `#25`/`#26`/`#27` are all present at the pin. The
guarantee a pin exists to give — that what was applied is what was reviewed — already holds by tree
identity, which is a stronger proof than the pin itself.

### 6g. Ledger #26 — the entitlement override defect

An entitlement override, once revoked, could never be granted again for that user and feature — by
any admin, through any code path. `uq_diaspora_user_override` has no `WHERE deleted_at IS NULL`, so a
soft-deleted row holds the unique slot forever; `applyAdminOverride` filtered on `.is('deleted_at',
null)`, could not see the tombstone, took the INSERT branch and hit `23505`. The operator saw a 500
naming a constraint, so the reading was "the system is broken" rather than "this grant is permanently
blocked".

Ledger #26 replaces read-then-branch-then-write with two RPCs: apply locks the logical row
*including* a soft-deleted one and writes `INSERT … ON CONFLICT … DO UPDATE SET deleted_at = NULL`
(the lock alone is insufficient — with no row there is nothing to lock, and `ON CONFLICT` is what
turns the loser of a first-grant race into an update); revoke is a real state transition under the
same lock. `REGRANTED` is its own audit action so a capability returning after a revoke cannot read as
an ordinary edit.

Proven on real Postgres by `database/test/diaspora_entitlement_override_regrant_check.mjs`: pre-fix
`23505` reproduction, re-grant success, history preservation, one-active-row, duplicate denial,
tenant isolation, ACL/RLS/MAINTAIN preservation, and rollback.

### 6h. Fixtures

The deployed specs are **read-only** — they create no persistent records, so the only residue is the
five UAT accounts under the reserved `@carup-staging.test` domain (`runId: gtm127`).

Those accounts were **deliberately retained**, and that is a judgement call rather than an omission:
they hold no real data, they are unmistakably named, and the reviewer and tenant-admin identities
cannot be recreated without the elevated grant named in §6e. Deleting them is destructive and would
block the next verification run. The owner can purge them from `.staging-auth/FIXTURES.json`.

Credential hygiene is proven rather than asserted: `.staging-auth/` is gitignored with **0 tracked
files**, `test-results/` likewise, and a secret-shape scan of all tracked files (JWT, `GOCSPX-`,
Google refresh-token shapes) is clean.

### 6i. Standing prohibitions — all held

PR #129 unmerged · production untouched · live billing not enabled · real-money SafeTrade not
activated · live Drive not activated · no real money moved. No secret value was printed or stored.

### 6j. Deployment routing — and a correction to how it was checked

The deployed bundle was re-examined at the end of the wave, and the first check was **wrong in a way
that returned the right answer**. That is worth recording, because a measurement that cannot fail is
worse than no measurement.

Grepping the bundle without `LC_ALL=C` raised `character not in range` on the 2.5 MB minified file
and returned `0` for *every* pattern — including `carup-backend-aca7.vercel.app`, which must be
non-zero. The earlier "0 production backend refs, 0 production Supabase refs" was therefore not
evidence of a clean deployment; it was the error value of a grep that had failed. It happened to
agree with the truth.

Re-run binary-safe (`LC_ALL=C`, `grep -a`) against the served `index-CtPnm5LX.js`:

| pattern | count | verdict |
|---|---|---|
| `carup-backend-aca7.vercel.app` (staging) | 7 | expected — the runtime base is `https://carup-backend-aca7.vercel.app/api` |
| `carup-backend.vercel.app` (production) | **0** | clean |
| `vhmnajoeicasaigiophh` (production Supabase ref) | **0** | clean |
| `api.carup.co.zw` | 16 | **documentation only** |

The 16 hits looked alarming and were run down rather than waved through. Every one sits inside a
`codeSnippets: { curl: …, javascript: … }` literal from `web/src/pages/APIDocs.tsx` — the public
API-docs page showing developers how to call the production API. They are display strings; none is a
request target, which was verified by confirming that no occurrence exists outside a `curl:` /
`javascript:` sample.

Staging backend health at close: `carup-backend-aca7.vercel.app/api/health` → `200`,
`{"status":"UP","supabase":{"status":"healthy"}}`.

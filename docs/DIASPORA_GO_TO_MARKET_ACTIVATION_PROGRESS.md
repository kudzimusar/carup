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

**Consequence, and it is the current blocker.** The migration runner changed, so the dispatcher's
pinned `CANDIDATE_SHA = 001cf808…` is stale — it points at the pre-repair runner, which would fail
the same way. Ledger #25 must also join its pinned list. Advancing the pin is a reviewable pull
request against `main` by design: that is the property that makes a pinned SHA worth having, and it
is why the pin is not something this branch can move on its own.

So the staging column is empty because the dispatcher must be re-pinned to a frozen final candidate
first — not because the migrations are unfinished.

---

## 6. Engineering still open on this branch

In flight in isolated specialist worktrees, neither yet integrated:

- **Entitlements** — a soft-deleted entitlement override can never be re-granted. `applyAdminOverride`
  looks the row up with `.is('deleted_at', null)` and inserts when it finds none, but
  `uq_diaspora_user_override (tenant_id, user_id, feature_key)` carries no such predicate, so the
  insert raises 23505 and surfaces as a 500 — that user loses that feature permanently. Being fixed
  as ledger #26. `mockSupabase` did not register this table's unique index, which is why no test could
  catch it; the index is now registered *without* `deleted_at` awareness, matching the real
  constraint, so the broken path fails its tests instead of passing them.
- **Entitlement coverage** — of 19 feature keys, only a minority reach the guard. `drive.connect`,
  `drive.export`, `graph.advanced` and `api.access` are the named gaps.
- **Vault + schedulers** — one managed vault backend client (`resolveVault()` throws
  `VAULT_NOT_CONFIGURED` for every managed backend), plus timer wiring for billing reconciliation and
  the checkout-abandonment sweep. Both sweeps are implemented and operator-triggerable; nothing calls
  them on a schedule. `DIASPORA_BILLING_RECONCILIATION_SCHEDULER` exists and defaults OFF.

Closed since the last checkpoint:

- **`releaseUsage` was a non-atomic read-modify-write.** Two concurrent releases of the same
  reservation both passed the status check, both read the same `used_count`, and both wrote the same
  decrement — the meter lost the amount once and was credited for it twice, permanently inflating
  remaining quota. Ledger #25 moves the whole sequence into one transaction under `FOR UPDATE` on
  both the reservation and its meter, floors the decrement at zero, refuses to release a `COMMITTED`
  reservation, and writes the audit row inside the same transaction. 26/26 on real PostgreSQL 17.5,
  including source-level assertions that both rows are genuinely locked — outcome assertions alone
  would pass in a single-connection harness whether the locks were there or not.

---

## 7. Verification performed locally

| Gate | Result |
|---|---|
| Backend (`ALLOW_OCR_MOCK=true`, the canonical CI env) | **2497 tests · 2485 pass · 0 fail · 12 skipped** |
| Web unit (vitest) | **81 files · 744 tests · 0 fail** |
| TypeScript · production web build | clean · clean |
| CR-1 secret scan | clean (1574 tracked files) |
| Real PostgreSQL 17.5 — #21 GTM foundation | **106 / 106** |
| Real PostgreSQL 17.5 — #22 ST-3 | **29 / 29** |
| Real PostgreSQL 17.5 — #23 ST-3 item 1 | **42 / 42** |
| Real PostgreSQL 17.5 — #24 billing | **36 / 36** |
| Real PostgreSQL 17.5 — #25 atomic quota release | **26 / 26** |
| Real PostgreSQL 17.5 — Drive vault reference | **76 / 76** |
| Playwright · bundled Chromium · full sweep | **295 passed · 0 failed · 0 flaky · 5 skipped** across 47 spec files |

Privileges in the ACL harnesses are read with `has_table_privilege()` across all eight PG17
privileges including `MAINTAIN`, which `information_schema` cannot report at all, plus column-level
ACLs.

**Not performed, and not claimed:** staging migration application, staging deployment,
deployed-staging UAT, production anything.

Earlier checkpoints reported "11 pre-existing OCR failures". They were an environment artifact of
running without `ALLOW_OCR_MOCK=true`, which CI sets at `ci.yml:30`. There were no such defects.

---

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
  failed apply records nothing and leaves no partial state. #21, #24 and #25 carry real `Down`
  sections. #22 and #23 are tightening-only by design — reversing them would restore the best-effort
  audit path and remove maker-checker from the money boundary — so recovery there is
  restore-from-backup under explicit authorization, not a down migration.
- **Dispatcher:** revert the one workflow file on `main`.

---

## 11. Terminal outcome

Issue #127 permits exactly two. **Neither has been reached.**

- Not `GO-TO-MARKET ACTIVATION COMPLETE — CHROMIUM/PLAYWRIGHT VERIFIED`: nothing is applied to
  staging, nothing is deployed, and no browser matrix has run against a deployment.
- Not `GO-TO-MARKET ACTIVATION IMPLEMENTATION COMPLETE — OWNER EXTERNAL ACTIONS REQUIRED`: ordinary
  engineering remains open in §6, and that outcome is only honest once none does.

What this branch is: all five deliverables implemented and locally verified, five audited migrations
frozen and unapplied, a repaired staging runner that verifies TLS instead of ignoring it, and every
risky surface left exactly as fail-closed as it was found.

# GARAGE-1.0-FINAL — consolidated evidence packet

Written for: the Moderator reviewing the campaign for acceptance. Nothing here is self-acceptance.

**Production was not accessed.** Every database read and write named below targets staging project `eoyenigwevnxwwhyhaer`; every
harness refuses the production project ref by name (`vhmnajoeicasaigiophh`) and the refusal was exercised (see §12).

The packet lives at `~/carup-launch-evidence/garage-1-0-final/` (≈ 119 MB, mostly screenshots). `evidence/MANIFEST.sha256` lists the
SHA-256 of **all 257 files**, so the external packet is verifiable; the small receipts are copied into `docs/garage-1.0/evidence/`.

## 1. Authority reconstruction

`GARAGE_1_0_FINAL_AUTHORITY_RECONSTRUCTION.md` — what existed, what was reused, what was built, what is external. The governing rule
held throughout: **one authority per fact**. Customer authorization stayed the existing `mechanic_work_orders.owner_authorization`
(an estimate does not carry its own flag); Communications stayed the existing outbox → policy → governed template → in-app path;
service records stayed the record of work actually done (never copied from an estimate); payment was never inferred.

## 2. SHA chain

| Step | Commit |
|---|---|
| Accepted start (PR #241, Draft, untouched, still `07b60e5d`) | `07b60e5d158d7dad7232d33f11f06a478c92da3f` |
| OPS04–OPS07, Communications, hub, operations view, concurrency, CI (16 commits) | `fc28c490` … `005ab130` |
| Operating-hub, owner commercial journey, stock and operations UI | `368d5727` |
| Plain-language case history; "You" for the assigned mechanic (found in UAT) | `a3e4410b` |
| **Garage chooses the site at acceptance** (found in UAT) — **final product commit** | **`8353dbdd7eb9382d210d8f9eff48a7300ec36224`** |

19 commits, 102 files (+17,804 / −514), PR #242 (Draft). **5 migrations added, 0 consumed migrations modified.**
Certification branches (evidence tooling only, 3 files each, on top of `368d5727`): `cert/garage-1.0-final-stg01-activate-r1`,
`cert/garage-1.0-final-stg01-window-r1`. Documentation, the UAT spec and the Owner scripts are added after the product commit and
change no product file.

## 3. Migration ledger (staging)

Applied 2026-10-24 ~11:04Z by workflow run `40088339929`, each migration in one transaction together with its ledger row (1.0–1.6 s each).

| Version | Name | Blob |
|---|---|---|
| `20261024100000` | `garage_ops04_estimates_and_authorization` | `931243a3…` |
| `20261024110000` | `garage_ops05_workshop_execution_gates` | `57e43110…` |
| `20261024120000` | `garage_ops06_parts_stock` | `23a19fcb…` |
| `20261024130000` | `garage_ops07_invoice_payment_receipt` | `938d1d64…` |
| `20261024140000` | `garage_communications_events_and_template` | `cca41ce1…` |

Tip before: `20261023140000` (OPS03). Tip now: `20261024140000`. Receipts: `evidence/stg01-activate/{preflight,apply,verify}.json`,
`up-sql-checksums.txt`. The harness pins each migration to its git blob, resumes from a ledger prefix, and stops on a gap or a
ledger/table disagreement. It was rehearsed on a throwaway PostgreSQL 16 built from the OPS03 foundation first.

## 4. Schema / RLS / RPC receipts

`verify.json` diffs the **live** catalog against a manifest generated from the tested PGlite world: **50 functions** (body `md5(prosrc)`,
keyed by name + identity arguments, security-definer flag, `EXECUTE` for `anon`/`authenticated`/`service_role`), **11 tables** (RLS
enabled **and forced**, column counts, privileges), 21 triggers, 45 constraints (validated), 24 indexes → `CATALOG_MATCHES_EXPECTED`.
`anon` can execute only 19 trigger functions (not exposed as RPC) and 2 pure helpers; nothing can read the new tables except
`service_role`. The verifier was mutation-tested with nine mutants, and the testing found a real blind spot — a name-only key let a
second overload hide a tampered function — which was fixed before use.

## 5. CI

`GARAGE-1.0 FINAL CI` (custody · hermetic backend · **16 race tests on a real PostgreSQL 16** · full web) green on every pushed head,
including the final product commit (runs `40093141506` push, `40093145395` PR). Inherited gates that ran are green (AUTH-05, Communications
Command Center, Diaspora 3–7, OC-5R REL-03A, Referral, Vehicle Passport). `Diaspora Deployed Staging UAT` and `Seller Home & Lifecycle
Staging UAT` are reviewer-gated and were **not** approved.
Local: at the final product commit, web 277 files / 2,836 tests, `tsc` clean, build OK; at `368d5727`, backend 9,019 tests (Node 20, CI
environment; the two later commits carry their own tests and ran in CI) — 8,970 pass, 39 skip, **10 non-passing in two files that fail identically on the untouched parent `07b60e5d`** (`vehicle-life-taxonomy`:
`pngjs` is missing from this machine's partial install; `oc5r-prov01-fx-observation-policy`).
The real-PG suite found and fixed a genuine deadlock (`complete_job` vs a concurrent service-record insert); the lock order is
case → work order → estimate → stock part everywhere.

## 6. Deployments and runtime provenance

| Pair | Backend | Web | Used for |
|---|---|---|---|
| `368d5727` | `dpl_CbvoCVgjyQunbNCncQxSZ2w8dJZv` (`carup-backend-staging-qzyo36siw-11-11`) | `dpl_3H1vDnvpYsQdQQPDfHHUyKs7cRK9` (`carup-staging-qvxo0r6gi-11-11`) | UAT iterations 1–9 |
| `a3e4410b` | `dpl_7n7ptdSQmYs5JBrKNTFAdEE13W6H` (`carup-backend-staging-7pl0mhfx5-11-11`) | `dpl_8a9V8vCDpNbGdadgh6kVApZmD6QE` (`carup-staging-ou2b9chmj-11-11`) | UAT 17/17 |
| **`8353dbdd`** | **`dpl_HZdWCS6yVP4WYnkd94orJdsQCX2b`** (`carup-backend-staging-4p98ybvvw-11-11`) | **`dpl_86Tvoh2ERqNb7CCB7h9Y3HLZz2Aa`** (`carup-staging-4km81vsko-11-11`) | **final UAT 20/20** |

Each pair was proven before use: `/api/health` build = the exact SHA, `database.supabase_project_ref = eoyenigwevnxwwhyhaer`,
`consistent: true`, external sends `disabled`; web `/carup-provenance.json` = the exact SHA with `api_base_url` = the immutable backend
host and `unpaired: false`. During the run, **every `/api/` request from every actor went only to that backend host** (test 18).

**Canonical staging is unchanged**: `api-staging.carup.dev` and `carup-backend-staging.vercel.app` → `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK`
(`07b60e5d`); `staging.carup.dev` and `carup-staging.vercel.app` → `07b60e5d`, paired to `api-staging`; kill switch active, sends disabled.

## 7. The journeys (final run, `uat-final2-202610241217`)

**Golden** — customer requests (public contract) → admin accepts **choosing a site** → customer requests a time, garage confirms it with a
planned mechanic → admin prepares an estimate (the form refuses to guess a currency), sends it → *bypass attempts refused* → customer
accepts → admin stocks a part, assigns the mechanic, starts → mechanic (sees **no prices**) records work + odometer, uses a part,
completes → admin issues the invoice (the form **refuses an unpriced line**; priced by the admin), records a partial then the final
payment (overpayment refused: "more than the invoice balance (80.00 remaining)") → receipts → customer sees invoice, payments, receipts
with "CarUp has not processed or verified this payment" → visit marked fulfilled → stock 11 → operations view.

**Negative** — a declined estimate leaves the work order `declined`; start (`The customer declined this work…`), record service
(`…has not authorized this work order…`), complete (`Start the work first…`) and invoice (`…once the job is complete`) are each refused,
for their own reason. No service record or invoice exists on any declined work order.

**Security** — customer → `ACTIVE_TENANT_REQUIRED`; mechanic → `ACTIVE_TENANT_ROLE` on operations, closeout, invoices, payments; the
mechanic's hub **payload** contains none of the prices and no internal note; garage cannot authorize its own job (`not_custodian`).

**Mobile 390×844** — admin hub, mechanic hub, customer requests, stock, operations: no horizontal overflow.

## 8. Database witness and reconciliation

A separate, read-only readout run **by the workflow, not the browser**, of everything each window changed. `reconcile.cjs` checks 19
business invariants from the rows (authorization precedes work; no work or invoice on declined jobs; stock arithmetic and unbroken
chains; usage ↔ consumption movement; invoice = Σ lines; payments labelled `garage_recorded_external` and never over the total; one
receipt per payment; gapless numbering; counters = highest number; completed jobs have a record and an assignment; every outbox event has
a dedupe key). **All 19 hold in both windows.**

| | Window 1 | Window 2 (final run only) |
|---|---|---|
| Cases / estimates / work orders | 11 / 10 / 10 | 2 / 2 / 2 |
| Service records / mileage / usage | 5 / – / 5 | 1 / 1 / 1 |
| Invoices / payments / receipts | 4 / 7 / 7 | 1 / 2 / 2 |
| Appointments (events) | – | 1 (`requested, confirmed, fulfilled`) |
| Audit events | 77 | 18 |
| Writes in any other tenant | **0** | **0** |
| Fixture vehicle odometer | – | **15,000** (garage observed 15,420; not rewritten) |

## 9. Communications (the one real gate)

The canonical worker (`07b60e5d`) has no handler for the new events and dead-letters them: `NO_CURRENT_SUBSCRIBER: no handler is
registered for garage.estimate.sent` after 5 attempts. Attribution by event type (current staging): **this campaign: 27 dead-lettered**
(1 appointment, 12 estimate, 5 invoice, 9 payment — all synthetic, attributable by dedupe key); **not this campaign:** 4 older
`garage.application.reject`/`request_more_info` dead letters from 2026-10-21 and 37 processed earlier events. Existing case-status
notifications deliver normally (the customer's bell shows them). Policy for every new event is in-app only; external sends were disabled
throughout. Resolution and order of deployment: `GARAGE_1_0_OWNER_CUTOVER_RUNBOOK.md`.

## 10. Regression of OPS01 / OPS02 / OPS03

Pages load with their real content (sites Harare + Bulawayo; workforce Mechanic 01…10; customers incl. the new relationship; schedule);
the three retained accepted OPS03 cases open in the new hub and offer the new first step; an OPS03 appointment is requested, confirmed
and fulfilled on the new schema; the OPS01–OPS03 migration and authority suites pass in CI; no consumed migration was modified.

## 11. What the UAT iterations found (disclosed in full)

Eleven UAT runs preceded this packet. **Every failure in runs 1–8 was a flaw in my spec or an assumption of mine, not the product**
(config location; a mis-keyed health field; "accepting creates a work order" — it is the first *estimate* that does; an ambiguous
locator; an extra click that *closed* a panel the page had opened; a regex that matched "Partly paid"; vacuous patterns I then
tightened). Three were genuine **product** findings, each fixed, mutation-tested and re-proven:

1. The case history printed raw event codes (`Service.case.accepted`) — the unit fixtures used short names, never the wire names.
2. A mechanic assigned to their own job read "A team member" instead of "You".
3. Nothing ever gave a customer-created request a **site**, so the customer could never book a time (accept sent an empty body).
   Pre-dating this campaign, but it blocks request → appointment, so it is closed here.

Retained synthetic data from the iterations (not cleaned, by design — attributable): 13 UAT cases, 7 UAT parts, 5 invoices
(`INV-000001` stays partly paid, 100.00 of 180.00), 9 payments and receipts, 0 live appointments.

## 12. Credential and session cleanup

Window 1 (`40089362970`, 11:19–12:05Z) and window 2 (`40093299387`, 12:17–12:28Z). The runner never held a plaintext credential: the
operator generated passwords locally and committed only scrypt hashes. Cleanup ran `always()`, restored `password_hash` to NULL **only
where it equalled the window hash**, invalidated only sessions created in the window, and `verify-clean` passed. **Independently
confirmed through the read-only inspection connection after each window:** all three pinned identities `password_hash IS NULL`, 0 valid
sessions. The harness's refusals were exercised: production URL, a non-scrypt hash, an identity that already had a hash, and credential
drift (cleanup refuses rather than overwrite someone else's change). `receipts: evidence/window-r{1,2}/credential-*.json`.

## 13. Remaining external gates

1. **Move the canonical staging hosts** to the final build — Owner action (the harness refuses `vercel deploy --prod` / `alias set` for
   Claude). Scripts and order: runbook. Without it, Garage events keep dead-lettering on the canonical worker.
2. **Supplier / procurement** — no governed authority exists; supplier stays free text, labelled "not verified".
3. **CarUp-processed or verified garage payments** — no canonical payment authority for garage services; payments are recorded by the
   garage and labelled so.

# GARAGE-1.0-CUTOVER-01 — canonical staging activation and final canonical UAT: receipt

Written for: the Moderator and Owner closing GARAGE-1.0. Everything below was read back from the systems named, not inferred.

**Result: the canonical staging runtime serves the accepted Garage product commit
`8353dbdd7eb9382d210d8f9eff48a7300ec36224`, the full 20-gate physical UAT passes against the canonical hosts, the new Garage
events are processed instead of dead-lettered, and the campaign's 27 dead letters were replayed and delivered.**
Production (`vhmnajoeicasaigiophh`) was not accessed.

## 1. What changed on canonical staging

| Host | Before | After |
|---|---|---|
| `api-staging.carup.dev` | `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK` · `07b60e5d` | **`dpl_76Zt2nhwLD7HDs94QfDBEuJxNxxH` · `8353dbdd`** |
| `carup-backend-staging.vercel.app` | `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK` · `07b60e5d` | **`dpl_76Zt2nhwLD7HDs94QfDBEuJxNxxH` · `8353dbdd`** |
| `staging.carup.dev` | `07b60e5d`, paired to `api-staging` | **`carup-staging-4xj9p054l-11-11` · `8353dbdd`**, paired to `api-staging` |
| `carup-staging.vercel.app` | `07b60e5d`, paired to `api-staging` | **`carup-staging-4xj9p054l-11-11` · `8353dbdd`**, paired to `api-staging` |

Backend: production target of the *staging* project, `environment: production`, `source: explicit_build_input`, kill switch **active**,
external sends **disabled**, database `eoyenigwevnxwwhyhaer` (consistent). The served case-screen chunk contains the final features (the
site picker and its failure message). Rollback targets are unchanged and untouched: backend `carup-backend-staging-ix1pa2wni-11-11`
(`dpl_GTRNcuTik…`), web `carup-staging-hpqpt2iah-11-11` (`dpl_7AQTQs1a…`).

## 2. The sequence, as run (2026-10-24 UTC; the Owner's clock reads 2026-10-25)

| Step | Result |
|---|---|
| Starting state re-verified | canonical `07b60e5d`; branch heads and ledger tip as recorded; 27 campaign dead letters; credentials NULL |
| `DRY_RUN=1 owner-deploy-garage-candidate.sh` | guards passed; two staging-only deploys printed |
| `owner-deploy-garage-candidate.sh` (1st run) | web deployed; **backend: Vercel CLI `Not authorized`** (the transient first-attempt error; no backend deployment was created). One web candidate `carup-staging-122py6psb-11-11` was left **unaliased** (harmless) |
| `owner-deploy-garage-candidate.sh` (2nd run) | backend `dpl_76Zt2nhwLD7HDs94QfDBEuJxNxxH`, web `carup-staging-4xj9p054l-11-11`; both **proved** the exact build on the staging database. `--skip-domain` held: canonical hosts still `07b60e5d` |
| `CHECK_ONLY=1 owner-cutover-garage.sh` | all preconditions held; nothing moved (first run of the script's positive path) |
| `owner-cutover-garage.sh` | **backend hosts moved and verified through the canonical hosts, then web hosts moved and verified**. Record: `evidence/cutover-01/owner/owner-cutover-record.json` |
| Independent re-probe | all four hosts at `8353dbdd` with fresh requests |

No workflow was running against staging at the time of the cutover (13 reviewer-gated runs were waiting, unapproved).

## 3. Final canonical UAT (20 of 20, 9.9 min, visible Chrome)

Against `https://staging.carup.dev` / `https://api-staging.carup.dev/api`, asserting `commit_sha = 8353dbdd…`, the backend's database =
`eoyenigwevnxwwhyhaer`, external sends disabled, and that **every `/api/` request from every actor went to `api-staging.carup.dev`**:
provenance · customer request · accept **choosing a site** · appointment · estimate · bypass attempts · customer accepts · stock/assign/start ·
mechanic work (no prices) · invoice (unpriced line refused) · partial then final payment · receipts · customer view · visit fulfilled ·
operations · negative journey (4 refusals, each for its own reason) · mobile 390×844 · history · security · OPS01–03 regression ·
communications · pairing. Evidence: `evidence/cutover-01/uat/canonical-journey-evidence.json`, 52 screenshots in the external packet.

## 4. The defect the cutover was for — now fixed on the real worker

| | Before the cutover (worker `07b60e5d`) | After (worker `8353dbdd`) |
|---|---|---|
| New `garage.*` events | dead-lettered, `NO_CURRENT_SUBSCRIBER`, 5 attempts | **6 of 6 `processed`, attempt 1** |
| Customer notifications | none for Garage events | **6 × `garage_commercial_update_v1`, `in_app`, `delivered`** (plus the 4 existing case-status ones) |
| External channel | – | **none** (kill switch active, sends disabled) |

## 5. Replay of the 27 synthetic dead letters — decided: replay

**Decision and reason.** Replay, because the runbook claims dead-lettered events are recoverable losslessly once a subscriber exists, and that
claim should be proven on data that is safe to replay rather than assumed: the events are synthetic, in-app only (policy
`channels: ['in_app']`), addressed to the synthetic UAT customer, and the kill switch is active. It used the product's own recovery function,
`EventWorker.reprocessDeadLetters({ ids })`, through cert branch `cert/garage-1.0-cutover-01-replay-r1` (run `40130838672`).

Guards (all rehearsed first on a throwaway PostgreSQL 16 with 8 decoys): staging project only (production ref refused); refuses unless the
canonical backend serves the final build; scope = status `dead_letter`, the four campaign event types, the synthetic tenant, the campaign window,
addressed to the UAT customer — and **exactly 27 rows** (so a re-trigger after success is a safe no-op).

**Result:** requested 27, replayed 27, ids match → **27 `processed`**, **27 notifications `delivered`** (`in_app`, with `delivered_at`). The only dead letters left
on staging are the **four older `garage.application.reject/request_more_info` events from 2026-10-21 — not this campaign's, untouched**.

The first replay attempt **refused and changed nothing**: its read-only preflight failed (`text = uuid`) because `domain_events.tenant_id` is `text` on
staging and my rehearsal table had guessed `uuid`. I fixed the comparison, rebuilt the rehearsal with the **real** column types read from staging, re-ran
it, and confirmed the exact scope query against the real data (27 distinct rows) before re-triggering.

## 6. Independent database witness of the canonical run (window 3)

19 business invariants hold (`uat/reconcile.cjs`): authorization precedes work; no work or invoice on a declined job; stock arithmetic and unbroken
chains; usage ↔ consumption; invoice = Σ lines; payments labelled `garage_recorded_external`; one receipt per payment; gapless numbering (`INV-000006`,
`RCT-000010/11`); counters = highest number. Writes in any other tenant: **0**. The fixture vehicle's odometer: **15,000** (the garage's observation of
15,420 did not rewrite it). Appointment history `requested → confirmed → fulfilled`.

## 7. Credentials and sessions

Window 3 (run `40129698155`, 20:26–20:37Z): the runner held **hashes only** (fresh passwords generated locally, never committed). Cleanup restored
`password_hash` to NULL only where it equalled the window hash and invalidated only the window's sessions; `verify-clean` passed; **independently
confirmed through the read-only connection: all three pinned identities `password_hash IS NULL`, 0 valid sessions.** The stop ref was deleted.

## 8. Final state

Canonical staging = the accepted Garage product commit; migration tip `20261024140000` (unchanged by the cutover); PR #241 untouched (open, Draft,
`07b60e5d`); PR #242 Draft. **Remaining, none internal:** supplier/procurement and CarUp-processed garage payments have no governed authority (not invented);
`Diaspora Deployed Staging UAT` and `Seller Home & Lifecycle Staging UAT` are reviewer-gated and were not approved.

Cutover-01 certification branches (evidence tooling only): `cert/garage-1.0-final-stg01-window-r1` (window 3), `cert/garage-1.0-cutover-01-replay-r1` (replay, `26edf3be`).

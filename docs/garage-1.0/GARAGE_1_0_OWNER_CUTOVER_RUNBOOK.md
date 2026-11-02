# GARAGE-1.0-FINAL — Owner cutover runbook (canonical staging)

Written for: whoever has to move canonical staging onto a Garage-1.0-style build again (or understand how it was done).

**Status: EXECUTED 2026-10-24 (CUTOVER-01).** Canonical staging now serves the accepted commit
`8353dbdd7eb9382d210d8f9eff48a7300ec36224`. The record is `GARAGE_1_0_CUTOVER_01_RECEIPT.md`; this document keeps the *procedure*, the guards and
the lessons. Nothing in it touches Production (`vhmnajoeicasaigiophh`); neither script can name it.

## Before and after

| Host | Before | After |
|---|---|---|
| `api-staging.carup.dev`, `carup-backend-staging.vercel.app` | `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK` · `07b60e5d` | `dpl_76Zt2nhwLD7HDs94QfDBEuJxNxxH` · `8353dbdd` |
| `staging.carup.dev`, `carup-staging.vercel.app` | OPS03 web · `07b60e5d` | `carup-staging-4xj9p054l-11-11` · `8353dbdd`, paired to `api-staging` |

Rollback targets (untouched): backend `carup-backend-staging-ix1pa2wni-11-11`, web `carup-staging-hpqpt2iah-11-11`. The database migrations are additive and
are **not** rolled back by a host rollback: the old build runs on them, though their triggers apply to it.

## Why the order is backend first

The communications worker dead-letters an event it has no handler for:

```
NO_CURRENT_SUBSCRIBER: no handler is registered for garage.estimate.sent   (5 attempts → status dead_letter)
```

During the Preview-pair UAT, 27 `garage.*` events emitted by a Preview backend were dead-lettered by the canonical worker (then `07b60e5d`). **Deploy order is
therefore: subscribers before emitters** — the backend (which carries the worker's handlers) before the web that exposes the screens that cause the events. The
script enforces it and verifies the backend through the canonical hosts before it touches the web. The cron jobs that drive the worker
(`carup-communication-worker-every-minute`, `carup-events-outbox-every-minute`) call endpoints held in the Vault (not readable by the read-only inspection role);
moving **both** backend hosts covers whichever one they target.

How the worker behaves (its own comments say so): an event with no subscriber is *retried*, up to 5 attempts, and only then dead-lettered — "retrying below the normal attempt ceiling allows a subscriber deployed during an incident to pick the row up without an operator replay". So events emitted in the few minutes before the new worker is live are recovered automatically; older ones are recovered with `reprocessDeadLetters({ ids })`, "the governed path after a real subscriber is installed".

Not this campaign's, and left alone: four older `garage.application.reject` / `garage.application.request_more_info` events dead-lettered with the same `NO_CURRENT_SUBSCRIBER` error on 2026-10-21 (they remain the only `garage.*` dead letters on staging). I did not establish whether the current build has a handler for them, and replaying an event that has no subscriber only dead-letters it again.

## The two actions

1. **Deploy the candidates** (moves no host):

   ```bash
   DRY_RUN=1 bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh     # optional: prints the guards and the exact commands
   bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh
   ```

   Deploys the exact commit to the production target of the two **staging** projects with `--skip-domain`, builds the web for
   `https://api-staging.carup.dev/api`, then proves each candidate serves exactly that build on the staging database with the kill switch active and external sends
   disabled. Writes `docs/garage-1.0/owner/out/owner-deploy-record.json`. *If the backend step prints `Not authorized`, it is the Vercel CLI's transient first-attempt
   error (no deployment is created): run the script once more. This happened in CUTOVER-01; the first web candidate was left unaliased.*

2. **Cut over** (backend first, then web):

   ```bash
   CHECK_ONLY=1 bash docs/garage-1.0/owner/owner-cutover-garage.sh           # guards only; moves nothing
   bash docs/garage-1.0/owner/owner-cutover-garage.sh
   ```

   Refuses unless the deploy record says the candidates proved the build and each candidate still proves it *now*; moves the two backend hosts, verifies them through the
   canonical hosts, moves the two web hosts, verifies those; on a failed verification it moves nothing further and prints the exact rollback command.

The guards were exercised before the real run with deliberately wrong candidates (no record; "not proven"; a Preview pair, refused because its web is not paired to the canonical
API; the then-current canonical runtime, refused as the wrong build) — all refused and moved nothing. In CUTOVER-01 the positive path ran for the first time (`CHECK_ONLY`, then for real).

## After the cutover (done in CUTOVER-01)

1. **Re-run the physical UAT on the canonical hosts** — 20 of 20. The spec supports it unchanged:
   `GARAGE_FINAL_WEB=https://staging.carup.dev GARAGE_FINAL_API=https://api-staging.carup.dev/api GARAGE_FINAL_SHA=<final sha>` (see `uat/README.md`).
2. **Confirm new events process**: 6 of 6 `processed` on the first attempt, 6 notifications `delivered` in-app.
3. **Replay the dead letters** with `EventWorker.reprocessDeadLetters({ ids })` (no HTTP route; run through a cert workflow with a staging-only guard). It resets
   `dead_letter` rows to `pending` and zeroes attempts; the live worker then processes them. CUTOVER-01 replayed the campaign's 27 (27 `processed`, 27 `delivered`),
   scoped by **explicit selection** and refusing unless the scope was *exactly* 27, so a re-trigger is a safe no-op. Do not replay by event type alone on shared staging.
4. **Close the credential window** and confirm independently that the pinned identities are back to NULL with 0 valid sessions.

## Rules that held

* Never alias a **Preview** to a canonical host: Previews carry only the branchless Preview environment (no worker or ledger secrets). Deploy to the *production target* of the staging projects.
* A read-only inspection connection can verify but not change staging; changes go through a cert-branch workflow with a staging-only guard.
* Rehearse destructive tooling against the **real** column types (read them from the target first) — the replay harness's first run refused and changed nothing because its rehearsal table had guessed `uuid` for a `text` column.

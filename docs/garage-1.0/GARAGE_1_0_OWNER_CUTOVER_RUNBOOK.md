# GARAGE-1.0-FINAL — Owner cutover runbook (canonical staging)

Written for: the Owner/Moderator who will move the canonical staging hosts onto the final Garage-1.0 build.

**Status.** The physical UAT was run on an exact-SHA *Preview* pair. The canonical staging hosts have **not** been moved, because the
harness's auto-mode classifier refuses to let Claude run `vercel deploy --prod` or `vercel alias set` — those are Owner actions. Two
guarded scripts do it. Nothing in this runbook touches Production (`vhmnajoeicasaigiophh`), and neither script can name it.

## What is live today

| Host | Serves | Build |
|---|---|---|
| `api-staging.carup.dev`, `carup-backend-staging.vercel.app` | `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK` (OPS03) | `07b60e5d` |
| `staging.carup.dev`, `carup-staging.vercel.app` | `dpl_7AQTQs1apayK5PrVUk3RDai88Dut` (OPS03) | `07b60e5d`, paired to `api-staging` |

The staging **database** already carries every Garage-1.0 migration (ledger tip `20261024140000`; receipt in
`evidence/stg01-activate/`). The migrations are additive and the old OPS03 build runs on the new schema, but its database triggers now
apply to it: the execution gates (start/record/complete) are enforced by PostgreSQL regardless of which build calls them.

## Why the order is backend first

The communications worker dead-letters an event it has no handler for:

```
NO_CURRENT_SUBSCRIBER: no handler is registered for garage.estimate.sent   (5 attempts → status dead_letter)
```

During the UAT, 21 `garage.*` events emitted by the Preview backend were dead-lettered by the canonical worker (still `07b60e5d`).
They are intact, carry deduplication keys, and are attributable (`uat_final_customer_20261024a`). **Deploy order is therefore:
subscribers before emitters** — the backend (which carries the worker's handlers) is moved before the web exposes the screens that
cause the events. The cutover script enforces that order and verifies the backend through the canonical hosts before it touches the web.

The cron jobs that drive the worker (`carup-communication-worker-every-minute`, `carup-events-outbox-every-minute`) call endpoints held in
the Vault (`CARUP_WORKER_ENDPOINT_URL`, `CARUP_EVENTS_ENDPOINT_URL`). Those values are not readable by the read-only inspection role, so
**confirm which host each one targets** (it will be one of the two backend hosts above). The script moves both backend hosts, so either
answer is covered.

## The two actions

1. **Deploy the candidates** (does not move any host):

   ```bash
   DRY_RUN=1 bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh     # optional: prints the guards and the exact commands
   bash docs/garage-1.0/owner/owner-deploy-garage-candidate.sh
   ```

   It deploys the exact commit to the production target of the two **staging** projects with `--skip-domain`, builds the web for
   `https://api-staging.carup.dev/api`, and then proves each candidate serves exactly that build on the staging database with the kill
   switch active and external sends disabled. It writes `docs/garage-1.0/owner/out/owner-deploy-record.json`.

2. **Cut over** (backend first, then web):

   ```bash
   CHECK_ONLY=1 bash docs/garage-1.0/owner/owner-cutover-garage.sh           # guards only; moves nothing
   bash docs/garage-1.0/owner/owner-cutover-garage.sh
   ```

   It refuses unless the deploy record says the candidates proved the build, and each candidate still proves it *now*. It then moves
   the two backend hosts, verifies them through the canonical hosts, moves the two web hosts, and verifies those. On a failed
   verification it moves nothing further and prints the exact rollback command (the previous deployments are named in the script).

The guards were exercised before hand-over with deliberately wrong candidates (no record; "not proven"; the Preview pair, refused
because its web is not paired to the canonical API; the current canonical runtime, refused as the wrong build) — all refused and moved
nothing. The *positive* path can only be exercised against a genuine canonical-paired candidate, so run `CHECK_ONLY=1` first.

## After the cutover

1. **Re-run the physical UAT on the canonical hosts.** The spec supports it unchanged:
   `GARAGE_FINAL_WEB=https://staging.carup.dev GARAGE_FINAL_API=https://api-staging.carup.dev/api GARAGE_FINAL_SHA=<final sha>`.
   Credentials come from a bounded, self-restoring window (cert branch `cert/garage-1.0-final-stg01-window-r1`, hashes only; see
   `uat/README.md`). The communications test then has something real to assert: new `garage.*` events should reach `processed`.
2. **Replay the 21 dead letters (Moderator's decision).** `EventWorker.reprocessDeadLetters({ eventType })` resets `dead_letter` rows to
   `pending` and zeroes attempts ("operator-driven recovery after the underlying defect is fixed"). There is no HTTP route for it. The
   events are in-app only (policy `channels: ['in_app']`), so replaying them cannot send anything outside CarUp; they would deliver
   in-app notifications to the synthetic UAT customer. Leaving them dead-lettered is also acceptable — they are attributable synthetic
   rows — but a Communications dashboard that counts dead letters will include them until replayed or cancelled.
3. **Do not alias a Preview to a canonical host.** Previews carry only the branchless Preview environment (no worker or ledger secrets);
   the scripts deploy to the *production target* of the staging projects for that reason.

## Rollback

Per script output. For reference: backend `alias set carup-backend-staging-ix1pa2wni-11-11.vercel.app <host>` for the two backend hosts;
web `alias set carup-staging-hpqpt2iah-11-11.vercel.app <host>` for the two web hosts. The database migrations are not rolled back by this:
they are additive, and the old build runs on them.

# INTEGRATION REQUEST — Vault + Scheduler lane (Issue #127, Phases 2D and 2E)

Everything below touches an **integration-owned file**, so it is requested here rather than done. All
of it is additive, and none of it enables anything: every job ships OFF by default, on both switches.

---

## 1. `backend/scripts/diaspora-staging-apply-gtm.mjs` — add ledger #27

Requested by the integrator; recorded here so the values live next to the migration.

- **File:** `database/migrations/20260731100000_diaspora_scheduler_leases.sql`
- **Ledger:** #27
- **sha256:12:** `ab15e7d98192` — **recompute before applying**; this value is frozen only if the file
  is not touched again after this commit. `node -e "…createHash('sha256')…"` or the harness below both
  print it (`database/test/diaspora_scheduler_lease_check.mjs` reports it as `ledger27`).

**Tables created (3):**

| Table | Purpose |
|---|---|
| `diaspora_scheduled_jobs` | one row per job: the lease (`lease_owner`, `leased_until`), the schedule (`next_run_at`, `interval_seconds`), the freshness signals (`last_success_at`, `last_attempt_at`, `last_failure_at`), and the terminus (`state='needs_operator'`). `enabled` defaults **FALSE**. |
| `diaspora_scheduler_runs` | durable run history — counts and states only, never a payload. |
| `diaspora_subscription_renewals` | ADR-001 §8 detection records, unique per `(tenant_id, subscription_id, period_end)`. Carries **no** amount, currency or payment handle. |

**Functions created (2):**

- `public.diaspora_scheduler_claim_atomic(text, text, integer, integer, boolean, boolean, timestamptz)`
- `public.diaspora_scheduler_release_atomic(text, text, boolean, text, text, uuid, integer, integer, integer, timestamptz)`

Both `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL` from PUBLIC/anon/
authenticated, `GRANT EXECUTE` to `service_role`.

**Prerequisite tables/objects:**

- `public.diaspora_subscriptions` (ledger #12) — read by the renewal sweep. The migration itself does
  **not** reference it (no FK), so it applies against any schema; the *service* needs it.
- `public.set_diaspora_trade_os_updated_at()` (ledger #3) — used for the `updated_at` triggers, guarded
  by an `IF EXISTS` check, so its absence downgrades to "no trigger" rather than failing the apply.
- `gen_random_uuid()` — already available everywhere ledgers #21–#25 apply.

No other ledger is read or modified. The Down block drops only the three tables and two functions.

**Verification available now:**

```bash
node database/test/diaspora_scheduler_lease_check.mjs   # 68/68 on PGlite (PG 17.5)
```

That harness models Supabase's `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon,
authenticated` and asserts the ledger-#20 ACL contract on all three tables, the claim's full decision
tree, lease expiry, the zombie refusal, backoff, the terminus, every CHECK constraint, the renewal
unique index, and that the Down block leaves nothing behind.

---

## 2. `.github/workflows/` — a scheduled dispatcher (optional, and inert without secrets)

The scheduler has **no always-running process** by design (Vercel is serverless). Something external
must call it. Two options; either works, neither is required for the code to be correct.

### Option A — Vercel Cron (preferred; no new workflow file) — **integration-owned, do not action from here**

Confirmed by the integrator: the cron belongs in **`backend/vercel.json`** (the `carup-backend-staging`
project, rooted at `backend/`), **not** the root `vercel.json` — the root file configures the frontend
project, which never serves `/api/diaspora/*`. Recorded here only so the shape is on the record:

```json
{
  "crons": [
    { "path": "/api/diaspora/scheduler/internal/run", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET`, which the route already accepts
(`schedulerDispatchSecret()` falls back to `CRON_SECRET`, matching `communicationRoutes.js`).

**Answering the integrator's safety question directly: no code path I own runs work when
`DIASPORA_SCHEDULER_ENABLED` is unset, and the cron is safe to wire ahead of activation.**

I strengthened this after the question was asked. The disabled check now runs **before**
authentication, so an un-enabled deployment answers `200 {dispatched:false,
reason:"SCHEDULER_DISABLED"}` **whether or not a secret is configured**. Previously an
enabled-flag-unset deployment with no `CRON_SECRET` would have answered 503 every tick — technically
"ran nothing", but a cron that goes red every fifteen minutes is a cron people learn to ignore. The
early return performs no work, opens no database connection and reads no state; the only thing it
discloses to an unauthenticated caller is that a feature flag is off.

That behaviour is not assumed, it is proved. `backend/tests/diaspora-scheduler-routes.test.js` asserts
it directly, and does not settle for reading the JSON — the disabled path is exercised with and
without a credential and the response is checked to carry no `results` array at all, so a route that
ran every job and then reported `dispatched:false` would fail.

Two further layers hold even after the flag is on: every job needs its own environment flag (all five
default off), and the flag check happens before the claim, so a dispatch tick against five off jobs
makes zero database calls.

### Option B — GitHub Actions (needed if the deployment is not on Vercel)

```yaml
name: Diaspora Scheduler Dispatch
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch due diaspora scheduled jobs
        env:
          BASE_URL: ${{ secrets.DIASPORA_API_BASE_URL }}
          SCHEDULER_SECRET: ${{ secrets.DIASPORA_SCHEDULER_SECRET }}
        run: |
          set -euo pipefail
          [ -n "${BASE_URL:-}" ] || { echo "SKIPPED — no DIASPORA_API_BASE_URL secret"; exit 0; }
          [ -n "${SCHEDULER_SECRET:-}" ] || { echo "SKIPPED — no DIASPORA_SCHEDULER_SECRET"; exit 0; }
          # --fail-with-body so a 4xx/5xx fails the job AND prints why.
          curl --fail-with-body -sS -X POST \
            -H "x-diaspora-scheduler-secret: ${SCHEDULER_SECRET}" \
            -H 'content-type: application/json' \
            "${BASE_URL%/}/api/diaspora/scheduler/internal/run"
```

The explicit skip-on-missing-secret is deliberate: a scheduled workflow that fails every fifteen
minutes because a secret was never set is a permanently red repository, and a permanently red
repository is one nobody reads.

### CI for the new suites (optional)

`backend/tests/diaspora-scheduler.test.js` and `backend/tests/diaspora-vault-gcp-secret-manager.test.js`
are picked up by the existing `node --test backend/tests/*.test.js` glob — no workflow change needed.

If you want the migration gated in CI, the PGlite harness needs no service container:

```yaml
      - name: Ledger #27 real-Postgres behaviour
        run: node database/test/diaspora_scheduler_lease_check.mjs
```

`backend/tests/realpg/scheduler-lease-realpg.mjs` (the two-session `SKIP LOCKED` proof) needs
`embedded-postgres`, installed from `backend/tests/realpg/package.json`, and follows the same
standalone convention as the four harnesses already in that directory.

---

## 3. Environment variables to register (all default OFF / absent)

### Phase 2D — the managed vault

| Variable | Notes |
|---|---|
| `DIASPORA_CREDENTIAL_VAULT_BACKEND` | set to `gcp_secret_manager` to activate; anything else keeps `resolveVault()` failing closed in production |
| `DIASPORA_VAULT_GCP_PROJECT_ID` | falls back to `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` / the key file's `project_id` |
| `DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON` | **a private key** — encrypted platform secret only, never `.env`, never CI logs |
| `DIASPORA_VAULT_GCP_USE_METADATA_SERVER` | `true` on GCE/GKE/Cloud Run (workload identity, no key file) |
| `DIASPORA_VAULT_GCP_SECRET_PREFIX` | default `carup` |
| `DIASPORA_VAULT_GCP_REPLICA_LOCATIONS` | comma-separated; empty = automatic replication. **Fixed at secret-creation time** |
| `DIASPORA_VAULT_GCP_DESTROY_PREVIOUS_VERSION` | default `true` |
| `DIASPORA_VAULT_GCP_TIMEOUT_MS` | default 15000 |

Full IAM detail — including that the usual `secretAccessor` + `secretVersionManager` pair is **not
sufficient**, because neither grants `secretmanager.secrets.create` or `.delete` — is in
`docs/adr/0002-diaspora-managed-credential-vault-google-secret-manager.md`.

### Phase 2E — the scheduler

| Variable | Default | Notes |
|---|---|---|
| `DIASPORA_SCHEDULER_ENABLED` | off | the dispatch endpoint's master switch |
| `DIASPORA_SCHEDULER_SECRET` | absent | falls back to `CRON_SECRET`; **without either, the dispatch route answers 503 and runs nothing** |
| `DIASPORA_BILLING_RECONCILIATION_SCHEDULER` | off | pre-existing name, deliberately unchanged |
| `DIASPORA_BILLING_CHECKOUT_SWEEP_SCHEDULER` | off | |
| `DIASPORA_BILLING_EVENT_RETRY_SCHEDULER` | off | |
| `DIASPORA_DRIVE_SYNC_RETRY_SCHEDULER` | off | |
| `DIASPORA_SUBSCRIPTION_RENEWAL_SCHEDULER` | off | |
| `DIASPORA_SCHEDULER_LEASE_SECONDS` | 300 | must exceed the longest run and stay under the platform function timeout |
| `DIASPORA_SCHEDULER_MAX_FAILURES` | 5 | consecutive failures before `needs_operator` |
| `DIASPORA_SCHEDULER_BACKOFF_BASE_SECONDS` / `_MAX_SECONDS` | 60 / 3600 | |
| `DIASPORA_SCHEDULER_INTERVAL_<JOB_KEY>` | per-job default | clamped to the migration's 30s–24h CHECK |
| `DIASPORA_SCHEDULER_BATCH_<JOB_KEY>` | 100 | capped at 500 |
| `DIASPORA_DRIVE_ATTEMPT_VISIBILITY_MS` | 900000 | how long an `in_flight` Drive attempt may go unsettled before it is reclaimed |
| `DIASPORA_SUBSCRIPTION_RENEWAL_LEAD_DAYS` | 3 | how far ahead of `period_end` a renewal is detected |

**Turning a job on requires two independent acts**, by design: the environment flag above *and*
`UPDATE diaspora_scheduled_jobs SET enabled = true WHERE job_key = '…'`. The database column is the
kill switch an operator can pull mid-incident without a redeploy.

---

## 4. Shared-file changes you asked me to flag

**`backend/routes/diasporaSubscriptionRoutes.js`** — two changes, both mechanical:

1. `async function syncSubscriptionFromSnapshot(...)` (the ~60-line block after
   `// ── Persistence helpers …`, at the very end of the file) was **moved verbatim** to
   `backend/services/diaspora/billing/diasporaBillingSubscriptionSync.js`. Its body is byte-identical.
2. One import line added:
   `import { syncSubscriptionFromSnapshot } from '../services/diaspora/billing/diasporaBillingSubscriptionSync.js';`

Nothing else in that file changed — no route, no handler, no ordering. The move was necessary because
the scheduled event-retry job needs the *same* writer: leaving it in the route would have meant either
a service importing a route (wrong direction, and an import cycle waiting to happen) or a second copy
of the only function that mutates subscription state.

`backend/tests/diaspora-subscription-routes.test.js`, `…-authz.test.js` and
`diaspora-billing-webhook-ledger.test.js` all pass unchanged (67/67).

**`backend/routes/diasporaRoutes.js`** — one import plus one `router.use('/scheduler', …)` mount, in
the same style as the `/trade-graph` mount and for the same reason (a prefix so the sub-router's gate
cannot shadow sibling diaspora routes).

**`backend/tests/helpers/mockSupabase.js`** — CONTENDED with the entitlements lane. My change is
**one object entry appended to `UNIQUE_INDEXES`**, immediately after the existing
`diaspora_billing_provider_events` line, plus its comment. Nothing else in the file is touched — no
restructuring, no builder changes:

```js
  // ledger #27 — diaspora_subscription_renewals: UNIQUE (tenant_id, subscription_id, period_end).
  // The renewal sweep's idempotency IS this index: a second sweep in the same period must lose the
  // insert race rather than record a second due renewal, and on the other side of that window is a
  // duplicate charge.
  diaspora_subscription_renewals: [['tenant_id', 'subscription_id', 'period_end']],
```

It is needed because without it the mock accepts every insert, and the renewal idempotency test would
pass even if the unique index were dropped from the migration. The entitlements lane's
`diaspora_user_entitlement_overrides` entry and mine are independent keys in the same frozen object,
so both can be kept verbatim.

---

## 5. Things I did **not** do

- I did **not** edit `backend/scripts/diaspora-staging-apply-gtm.mjs` (integration-owned).
- I did **not** edit any `.github/workflows/*` file.
- I did **not** edit `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md` — ledger #27's row is yours to add.
- I did **not** touch `vercel.json` or `backend/vercel.json` (both integration-owned).
- I did **not** fix the `requestCorrelationId` bug in `backend/services/diaspora/diasporaEntitlementService.js`
  (3 pre-existing test failures at my base commit `36e2568`). Per your note it is already fixed at
  integration head `82dbb17`, so there is nothing of mine to drop.
- I did **not** weaken `scripts/cr1-secret-scan.mjs`, and added no allow-list entry. The new fixtures
  assemble credential-shaped values at runtime, as `googleDriveFixtures.js` established.

---

## Resolution status (2026-08-08, reunification audit)
- §1 ledger #27 in `backend/scripts/diaspora-staging-apply-gtm.mjs`: **SATISFIED**.
- §2 scheduled dispatcher (Vercel Cron in `backend/vercel.json`): **NOT WIRED — deferred to owner.**
  `backend/vercel.json` is `{}`; wiring a production-facing cron is an activation decision, not
  reunification wiring. The request's own text marks it optional and integration-owned.

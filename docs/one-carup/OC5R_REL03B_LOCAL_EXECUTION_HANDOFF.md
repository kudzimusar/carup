# OC-5R-REL-03B — LOCAL EXECUTION HANDOFF

**Scope:** local runtime custody only, after REL-03A source/harness preparation is frozen by the moderator.

**Canonical staging Supabase project:** `eoyenigwevnxwwhyhaer`
**Production Supabase project:** `vhmnajoeicasaigiophh` — **Production is forbidden.**
**GitHub Actions secret environment:** `staging`

> **Do not activate or drain the worker until the backlog inventory has been reviewed and classified safe enough for bounded processing.**

This handoff deliberately contains variable names and commands, never credential values.

## 1. Exact source custody

The moderator's REL-03A return supplies the immutable final SHA. Do not infer it from an old receipt.

```bash
export REL03_BRANCH='fix/oc5r-real-runtime-source-closure'
: "${OC5R_REL03A_SOURCE_SHA:?set to the exact REL-03A final SHA from the moderator return}"

git fetch origin "$REL03_BRANCH"
test "$(git rev-parse "origin/$REL03_BRANCH")" = "$OC5R_REL03A_SOURCE_SHA"
git checkout --detach "$OC5R_REL03A_SOURCE_SHA"
test "$(git rev-parse HEAD)" = "$OC5R_REL03A_SOURCE_SHA"
test -z "$(git status --porcelain)"
```

Do not rebase, merge, amend or force-push.

## 2. Required local variables

Required custody variables:

```text
OC5R_REL03A_SOURCE_SHA
DIASPORA_STAGING_DATABASE_URL
COMMUNICATION_WORKER_SECRET
COMMUNICATION_OUTBOUND_DISABLED
STAGING_UAT_PASSWORD
STAGING_WEB_URL
STAGING_API_URL
REL03_RUN_ID
REL03_WINDOW_START
VERCEL_TOKEN              # only if the local custodian uses the Vercel CLI
VERCEL_TEAM               # only if required by the existing Vercel account
```

Set the outbound control explicitly:

```bash
export COMMUNICATION_OUTBOUND_DISABLED=true
test "$COMMUNICATION_OUTBOUND_DISABLED" = true
```

Never echo, print, artifact, screenshot, or commit `COMMUNICATION_WORKER_SECRET`, database URLs, UAT passwords or provider credentials.

## 3. Inventory the live backlog and exact next worker batch

The inventory parses the configured connection and refuses production, unknown targets and unprovable identities before opening a socket.

```bash
: "${DIASPORA_STAGING_DATABASE_URL:?}"
node scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs \
  --format both \
  --output "$PWD/rel03-backlog-before.json"
```

Require:

```text
target.kind        = staging
target.project_ref = eoyenigwevnxwwhyhaer
boundary.transaction = BEGIN READ ONLY
boundary.mutating_sql = false
worker_selection_contract.max_outbox_attempts = 5
worker_selection_contract.order_by = created_at ASC
worker_selection_contract.batch_limit = 10
```

The inventory's `next_worker_batch` reproduces the current worker's eligibility/order/limit contract:

```text
status = pending
attempts < MAX_OUTBOX_ATTEMPTS (currently 5, derived from eventWorker.js)
ORDER BY created_at ASC
LIMIT 10
```

The read-only inventory deliberately does not acquire `FOR UPDATE SKIP LOCKED`; it must never lock or mutate staging rows.

For every exact next-batch event, review only:

```text
id
event_type
status
attempts
tenant_id
created_at
classification
```

No payload review is required by this tool.

## 4. Fail-closed next-batch review

Read these evidence domains separately:

- **SOURCE CLASSIFICATION** — what this exact checkout registers.
- **LIVE BACKLOG OBSERVATION** — which rows actually exist in staging.
- **NEXT WORKER BATCH** — the exact oldest eligible rows a single worker poll would attempt under the current source contract.

Effect classes:

- `IN_APP_ONLY` — Communications subscriber; internal channel only.
- `AUDIT_ONLY` — source-proven audit-only subscriber.
- `EXTERNAL_CHANNEL_POSSIBLE` — an external provider may be reached.
- `NON_COMMUNICATION_SIDE_EFFECT` — a non-Communications handler can mutate another domain.
- `NO_CURRENT_SUBSCRIBER` — no current handler was found.
- `UNKNOWN_REQUIRES_REVIEW` — source truth is insufficient.

### Default first-batch gate

The first worker invocation is permitted by classification only when every row in the exact `next_worker_batch` is:

```text
IN_APP_ONLY
AUDIT_ONLY
```

Require:

```text
next_worker_batch_review.stop_required = false
next_worker_batch_review.default_classification_gate_passes = true
```

If `next_worker_batch` is empty, do not invoke the worker.

### Mandatory STOP classes

Any exact next-batch row classified as one of these is a STOP pending moderator review:

```text
EXTERNAL_CHANNEL_POSSIBLE
NON_COMMUNICATION_SIDE_EFFECT
NO_CURRENT_SUBSCRIBER
UNKNOWN_REQUIRES_REVIEW
```

`NO_CURRENT_SUBSCRIBER` is specifically fail-closed. The current event worker resolves an empty handler list and still marks the event `processed`. It therefore means:

> processing would consume authority evidence without a current handler

It does **not** mean safe to discard.

`COMMUNICATION_OUTBOUND_DISABLED=true` does not override this gate. The kill switch prevents external sends; it does not neutralize non-Communications handlers or make handlerless event consumption harmless.

Also STOP if:

- target proof is not exactly `eoyenigwevnxwwhyhaer`;
- the exact next-batch shape differs unexpectedly from the reviewed inventory;
- any reconciliation table required below cannot be inspected;
- runtime identity cannot be tied to `$OC5R_REL03A_SOURCE_SHA`;
- `COMMUNICATION_OUTBOUND_DISABLED=true` is not proven active.

## 5. Canonical GitHub staging-environment worker-secret custody

REL-03 uses only:

```text
COMMUNICATION_WORKER_SECRET
```

The backend remains the existing Communications worker authority. Do not create `TRADEOS_WORKER_SECRET` support.

The same protected value must be held in:

1. the branch-scoped **Vercel Preview** backend environment; and
2. the GitHub Actions **`staging` environment** secret named `COMMUNICATION_WORKER_SECRET`.

The deployed Diaspora bootstrap job and reusable shard job are source-bound to:

```yaml
environment: staging
```

If GitHub custody must be established, do it only under explicit REL-03B authority and never print the value:

```bash
printf '%s' "$COMMUNICATION_WORKER_SECRET" | \
  gh secret set COMMUNICATION_WORKER_SECRET \
    --repo kudzimusar/carup \
    --env staging
```

Do not create or replace a repository-wide `COMMUNICATION_WORKER_SECRET`.

No Production-scoped secret may be changed.

## 6. Vercel Preview scope only

The permitted deployment target is the governed branch **Preview** pair. Never use `--prod`, never move production aliases, and never mutate Production environment variables.

If Preview environment custody needs convergence, use branch-scoped Preview values only:

```bash
cd backend
vercel link --yes --scope "$VERCEL_TEAM" --project carup-backend-staging --token "$VERCEL_TOKEN"
printf '%s' "$COMMUNICATION_WORKER_SECRET" | \
  vercel env add COMMUNICATION_WORKER_SECRET preview "$REL03_BRANCH" --token "$VERCEL_TOKEN"
printf '%s' "$COMMUNICATION_OUTBOUND_DISABLED" | \
  vercel env add COMMUNICATION_OUTBOUND_DISABLED preview "$REL03_BRANCH" --token "$VERCEL_TOKEN"
cd ..
```

If an entry already exists, reconcile it through the connected Vercel custody tool rather than printing or reading the secret.

## 7. Required REL-03B execution order

Use this exact order:

```text
freeze exact SHA
→ inventory live backlog
→ inspect exact next_worker_batch
→ STOP if next batch contains any non-default class
→ establish GitHub staging-environment + Vercel Preview secret custody
→ deploy exact Preview pair
→ prove exact runtime SHA
→ prove COMMUNICATION_OUTBOUND_DISABLED=true
→ capture BEFORE snapshot tracking exact next-batch IDs
→ make ONE worker call
→ capture AFTER snapshot tracking the SAME IDs
→ reconcile exact event mutations + newly-created Communications rows
→ run inventory again
→ explicitly review the NEW next_worker_batch
→ only then seek authority for any second worker call
```

No automatic loop.

No drain-until-empty command.

Approval of batch 1 never authorizes batch 2.

## 8. Runtime identity and outbound-disabled proof

The backend health endpoint exposes the source-controlled kill switch:

```bash
curl --fail --silent "$STAGING_API_URL/health" | \
  jq '{commit_sha, communications: .communications.outbound}'
```

Require:

```text
commit_sha = $OC5R_REL03A_SOURCE_SHA
communications.kill_switch = active
communications.external_sends = disabled
communications.control = COMMUNICATION_OUTBOUND_DISABLED
```

Then prove the governed frontend/backend pair:

```bash
node scripts/ci/resolve-governed-preview-pair.mjs
```

Do not continue on a mismatched SHA, unpaired frontend, stable-main backend, production origin, or wrong staging project.

## 9. Before snapshot — track the reviewed batch by exact event ID

Choose a bounded UTC window for **new Communications rows**:

```bash
: "${REL03_WINDOW_START:?set an ISO-8601 UTC timestamp}"
REL03_BEFORE_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/ci/oc5r-rel03-communications-snapshot.mjs \
  --since "$REL03_WINDOW_START" \
  --until "$REL03_BEFORE_END" \
  --track-events-from "$PWD/rel03-backlog-before.json" \
  --output "$PWD/rel03-before.json"
```

The snapshot has two different observation modes:

1. `tracked_worker_batch` queries the exact IDs from `rel03-backlog-before.json` regardless of their original `created_at`, current status or update time.
2. The ordinary time window observes newly-created rows in:

```text
notification_queue
message_threads
messages
message_delivery_attempts
```

An old September event in the exact worker batch must therefore remain visible during an October REL-03 run.

Before calling the worker, require:

```text
tracked_worker_batch.expected_ids
==
tracked_worker_batch.rows[].id
```

Any missing expected ID is a STOP.

## 10. One bounded worker call

Generate a non-secret correlation ID:

```bash
export REL03_RUN_ID="rel03-$(date -u +%Y%m%dT%H%M%SZ)"
```

**One worker call is the initial bound. Do not loop automatically.**

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$STAGING_API_URL/internal/events/process" \
  -H "Authorization: Bearer $COMMUNICATION_WORKER_SECRET" \
  -H "x-correlation-id: $REL03_RUN_ID" \
  -H 'content-type: application/json'
```

Stop on `401`, `503 event_worker_unarmed`, transport failure, or an unexpected processed/backlog result.

## 11. After snapshot — same exact event IDs

Use the **same** reviewed inventory file:

```bash
REL03_AFTER_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/ci/oc5r-rel03-communications-snapshot.mjs \
  --since "$REL03_WINDOW_START" \
  --until "$REL03_AFTER_END" \
  --track-events-from "$PWD/rel03-backlog-before.json" \
  --output "$PWD/rel03-after.json"

node scripts/ci/oc5r-rel03-communications-reconcile.mjs \
  --before "$PWD/rel03-before.json" \
  --after "$PWD/rel03-after.json" \
  --output "$PWD/rel03-reconciliation.json"
```

The reconciliation must include:

```text
tracked_worker_batch.expected_ids
tracked_worker_batch.observed_before
tracked_worker_batch.observed_after
tracked_worker_batch.status_transitions
tracked_worker_batch.attempt_transitions
tracked_worker_batch.error_transitions
tracked_worker_batch.missing_ids
tracked_worker_batch.complete
```

If any expected ID is absent before or after, the reconciliation command exits non-zero:

```text
TRACKED WORKER BATCH RECONCILIATION INCOMPLETE
```

Do not reinterpret a missing tracked event as a removed row.

Review:

- `pending → processed`;
- `pending → pending` with attempts incremented;
- `pending → dead_letter`;
- error-state changes;
- new notifications, threads and messages;
- every new delivery attempt;
- any unexpected external delivery attempt.

## 12. Re-inventory before any possible second worker call

Immediately after reconciliation:

```bash
node scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs \
  --format both \
  --output "$PWD/rel03-backlog-after-batch1.json"
```

This produces a **new** `next_worker_batch`.

Review it from zero under the same classification gate.

Batch-1 approval is consumed after the first worker invocation.

Do not make a second worker call unless the new exact batch is separately reviewed and the moderator explicitly authorizes continuation.

## 13. Corrected D7 dispatch

Do not grep-run only the two D7 tests: the spec is serial and the current reservation is created earlier in the same spec. Run the whole Trade OS container spec on Chromium:

```bash
npx playwright test \
  --config=playwright.staging.config.ts \
  --project=chromium \
  tests/agents/45-trade-os-container-demo-staging.spec.ts
```

D7 must prove:

- participant current user + exact current reservation reference + `APPROVED` + `diaspora.container_booking.reservation_approved`;
- current Hikari coordinator + same reservation reference + `REQUESTED` + `diaspora.container_booking.reservation_received`;
- non-null `event_id`;
- notification `created_at` after this run's reservation mutation;
- Communications UI contains the exact current `RES-...` reference.

Historical `container_booking` rows cannot satisfy the predicate.

## 14. GitHub staging certification scope only

After local proof is reconciled, dispatch the existing governed **staging** workflow from this branch:

```bash
gh workflow run diaspora-deployed-staging-uat.yml \
  --repo kudzimusar/carup \
  --ref "$REL03_BRANCH"
```

The workflow's secret-consuming bootstrap and reusable shard jobs are bound to the GitHub `staging` environment.

Record the run ID and exact head. Do not dispatch a production release workflow.

## 15. Final staging reconciliation

After D7/staging certification, run the inventory again for evidence:

```bash
node scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs \
  --format both \
  --output "$PWD/rel03-backlog-final.json"
```

No cleanup/delete command exists in REL-03 tooling.

Do not mark historical events processed manually.

Do not delete historical notifications to make D7 pass.

## 16. Evidence to return to the moderator

Return:

- exact checked-out SHA;
- governed Preview frontend/backend URLs and runtime SHA proofs;
- redacted proof that `COMMUNICATION_WORKER_SECRET` custody exists in Vercel Preview and GitHub Actions `staging` environment, never the value;
- `/api/health` outbound kill-switch proof;
- `rel03-backlog-before.json`;
- exact batch classification review and stop decision;
- `rel03-before.json`;
- worker HTTP status, correlation ID, processed/backlog counts;
- `rel03-after.json`;
- `rel03-reconciliation.json`;
- `rel03-backlog-after-batch1.json`;
- explicit evidence that the new next batch was reviewed before any second call;
- corrected D7 Playwright result and artifact paths;
- GitHub staging workflow run ID/result;
- `rel03-backlog-final.json`;
- explicit confirmation of no Production access, no Production alias/env mutation, and no unreviewed second drain.

## Absolute prohibitions

**Production is forbidden.**

Do not:

- contact Supabase production `vhmnajoeicasaigiophh`;
- use Vercel Production scope or `--prod`;
- move production aliases;
- print or artifact secrets;
- use a repository-wide `COMMUNICATION_WORKER_SECRET`;
- process a batch containing a default STOP classification without moderator authority;
- delete historical notifications;
- manually mark domain events processed;
- broaden the worker auth contract;
- run an automatic drain loop;
- assume batch-1 approval authorizes batch 2;
- run Owner UAT;
- merge PR #222.

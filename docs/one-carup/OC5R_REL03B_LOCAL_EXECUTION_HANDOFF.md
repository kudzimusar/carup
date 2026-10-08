# OC-5R-REL-03B — LOCAL EXECUTION HANDOFF

**Scope:** local runtime custody only, after REL-03A source/harness preparation is frozen by the moderator.

**Canonical staging Supabase project:** `eoyenigwevnxwwhyhaer`
**Production Supabase project:** `vhmnajoeicasaigiophh` — **Production is forbidden.**

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

## 3. Prove the staging database target before doing anything else

The inventory code parses the connection itself and refuses production, unknown targets and unprovable identities before opening a socket.

```bash
: "${DIASPORA_STAGING_DATABASE_URL:?}"
node scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs \
  --format both \
  --output "$PWD/rel03-backlog-before.json"
```

Expected target in JSON:

```text
target.kind        = staging
target.project_ref = eoyenigwevnxwwhyhaer
boundary.transaction = BEGIN READ ONLY
boundary.mutating_sql = false
```

Any other target is an immediate stop.

## 4. Interpret the backlog

Read `source_classification` and `live_backlog_observation` as different evidence:

- **SOURCE CLASSIFICATION** says what this exact checkout registers and what Communications policy permits.
- **LIVE BACKLOG OBSERVATION** says what rows actually exist in staging.
- Neither substitutes for the other.

Effect classes:

- `IN_APP_ONLY` — Communications subscriber exists and policy is internal-only.
- `EXTERNAL_CHANNEL_POSSIBLE` — processing may reach an external provider.
- `NON_COMMUNICATION_SIDE_EFFECT` — exact non-Communications subscriber found.
- `AUDIT_ONLY` — reserved for a source-proven audit-only subscriber.
- `NO_CURRENT_SUBSCRIBER` — no exact subscriber found in the current source scan.
- `UNKNOWN_REQUIRES_REVIEW` — do not infer safety.

### Stop before worker activation if

- target proof is not exactly `eoyenigwevnxwwhyhaer`;
- any pending event is `UNKNOWN_REQUIRES_REVIEW`;
- any pending `EXTERNAL_CHANNEL_POSSIBLE` family has not been explicitly reviewed;
- any pending non-Communications side effect is not understood;
- row age/count/distribution is materially different from the moderator-reviewed inventory;
- the five reconciliation tables cannot be inspected;
- runtime identity cannot be tied to `$OC5R_REL03A_SOURCE_SHA`;
- `COMMUNICATION_OUTBOUND_DISABLED=true` is not proven active on the runtime.

## 5. Canonical worker-secret custody

REL-03 uses only:

```text
COMMUNICATION_WORKER_SECRET
```

The backend remains the existing Communications worker authority. Do not create `TRADEOS_WORKER_SECRET` support.

The **same protected value** must be held in:
1. the branch-scoped **Vercel Preview** backend environment; and
2. the GitHub repository Actions secret named `COMMUNICATION_WORKER_SECRET`.

If custody must be established, do it only under explicit REL-03B authority and never print the value. GitHub example:

```bash
printf '%s' "$COMMUNICATION_WORKER_SECRET" | \
  gh secret set COMMUNICATION_WORKER_SECRET --repo kudzimusar/carup
```

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

## 7. Deployment order

1. Freeze exact REL-03A SHA.
2. Inventory and review backlog.
3. Establish Preview-only backend worker-secret + outbound-kill-switch custody.
4. Deploy backend Preview from the exact SHA.
5. Prove backend runtime identity and outbound kill switch.
6. Deploy the paired frontend Preview from the same exact SHA if the governed pair resolver requires a fresh frontend.
7. Prove the pair.
8. Take the **before** database snapshot.
9. Only then perform one bounded worker poll.
10. Take the **after** snapshot and reconcile.
11. Review the delta before any second worker call.
12. Run the corrected D7 staging spec.
13. Run the governed GitHub staging certification.
14. Take final database inventory/reconciliation and return evidence.

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

## 9. Before snapshot

Choose a bounded UTC window that starts before the controlled drain:

```bash
: "${REL03_WINDOW_START:?set an ISO-8601 UTC timestamp}"
REL03_BEFORE_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/ci/oc5r-rel03-communications-snapshot.mjs \
  --since "$REL03_WINDOW_START" \
  --until "$REL03_BEFORE_END" \
  --output "$PWD/rel03-before.json"
```

The snapshot is read-only and covers:

```text
domain_events
notification_queue
message_threads
messages
message_delivery_attempts
```

## 10. Bounded worker drain

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

Stop on `401`, `503 event_worker_unarmed`, transport failure, or an unexpected processed/backlog result. Review the before/after reconciliation before authorizing another call.

## 11. After snapshot and reconciliation

```bash
REL03_AFTER_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/ci/oc5r-rel03-communications-snapshot.mjs \
  --since "$REL03_WINDOW_START" \
  --until "$REL03_AFTER_END" \
  --output "$PWD/rel03-after.json"

node scripts/ci/oc5r-rel03-communications-reconcile.mjs \
  --before "$PWD/rel03-before.json" \
  --after "$PWD/rel03-after.json" \
  --output "$PWD/rel03-reconciliation.json"
```

Review exactly which domain event changed status, which notification/thread/message appeared, and whether any `message_delivery_attempts` row appeared. With D7's in-app-only policy and the kill switch active, an unexpected external attempt is a stop condition.

## 12. Corrected D7 dispatch

Do not grep-run only the two D7 tests: the spec is serial and the current reservation is created earlier in the same spec. Run the whole Trade OS container spec on Chromium:

```bash
npx playwright test \
  --config=playwright.staging.config.ts \
  --project=chromium \
  tests/agents/45-trade-os-container-demo-staging.spec.ts
```

D7 must prove:
- participant current user + exact current reservation reference + `APPROVED` + `diaspora.container_booking.reservation_approved`;
- current Hikari coordinator + the same reservation reference + `REQUESTED` + `diaspora.container_booking.reservation_received`;
- non-null `event_id`;
- notification `created_at` after this run's reservation mutation;
- Communications UI visibly contains the exact current `RES-...` reference.

A historical `container_booking` row cannot satisfy the predicate.

## 13. GitHub staging certification scope only

After local proof is reconciled, dispatch the existing governed **staging** workflow from this branch:

```bash
gh workflow run diaspora-deployed-staging-uat.yml \
  --repo kudzimusar/carup \
  --ref "$REL03_BRANCH"
```

Record the run ID and exact head. Do not dispatch a production release workflow.

## 14. Final staging reconciliation

Run the backlog inventory again and compare it with the reviewed pre-drain inventory:

```bash
node scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs \
  --format both \
  --output "$PWD/rel03-backlog-final.json"
```

No cleanup/delete command exists in REL-03 tooling. Do not mark historical events processed manually and do not delete historical notifications to make D7 pass.

## 15. Evidence to return to the moderator

Return:

- exact checked-out SHA;
- governed Preview frontend/backend URLs and runtime SHA proofs;
- redacted proof that `COMMUNICATION_WORKER_SECRET` custody is present in Preview + GitHub Actions (never the value);
- `/api/health` outbound kill-switch proof;
- `rel03-backlog-before.json`;
- inventory classification review / stop decisions;
- worker HTTP status, correlation ID, processed/backlog counts;
- `rel03-before.json`, `rel03-after.json`, `rel03-reconciliation.json`;
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
- delete historical notifications;
- manually mark domain events processed;
- broaden the worker auth contract;
- run an automatic drain loop;
- run Owner UAT;
- merge PR #222.

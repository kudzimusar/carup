# Staging runtime revision parity guard

## Why this exists

CarUp's staging environment serves **two operational runtimes**, and they are not the same thing:

```text
api-staging.carup.dev              webhooks + API   — what certification talks to
carup-backend-staging.vercel.app   pg_cron target   — what actually SENDS Email
```

The pg_cron job that drains `notification_queue` posts to `CARUP_WORKER_ENDPOINT_URL`, which is the
project's own domain — **not** the aliased `api-staging.carup.dev`. Pushing a branch creates a
*preview* deployment and re-aliases `api-staging`, while `carup-backend-staging.vercel.app` keeps
serving the last **production-target** deployment. The two therefore drift by default; keeping them
together takes deliberate action.

During Email 1.0 they drifted, and it shipped a real defect:

> A governed marketing message reached a human inbox with **no unsubscribe control**. The unsubscribe
> feature was deployed — on `api-staging.carup.dev`. The runtime that actually sent the message was
> older and had no such code, so it transmitted no HTML part and no `List-Unsubscribe` headers.

Nothing detected it. Every automated check passed, because every check ran against the runtime that
had the fix. The defect was found by a person reading the delivered Email.

The lesson generalises beyond Email: **certifying against a runtime that does not perform the action
proves nothing about the action.**

## What the guard does

`backend/config/buildProvenance.js` reports the revision an instance was built from, exposed in the
existing `/api/health` response:

```json
"build": {
  "commit_sha": "…",
  "commit_sha_short": "…",
  "branch": "…",
  "deployment_id": "…",
  "environment": "production",
  "provenance_available": true
}
```

`scripts/assert-staging-runtime-parity.mjs` probes **both** runtimes and compares them.

```bash
node scripts/assert-staging-runtime-parity.mjs                # both runtimes must agree
node scripts/assert-staging-runtime-parity.mjs <expected-sha> # ...and match a specific revision
```

Exit code 0 prints `STAGING_RUNTIME_REVISION_PARITY=PASS`; anything else exits non-zero and names the
disagreement.

## It fails closed, deliberately

| Condition | Verdict |
|---|---|
| Both runtimes on the same revision | PASS |
| Runtimes on different revisions | **FAIL** — the exact drift that shipped the defect |
| Both agree, but on a revision other than the expected one | **FAIL** — agreement on a stale build is still a certification lie |
| A runtime is unreachable or times out | **FAIL** |
| A runtime reports no `commit_sha` | **FAIL** — silence is not agreement |
| No runtimes supplied | **FAIL** — never a vacuous pass |

Unknown provenance is never treated as agreement. A runtime that cannot say what it is running is
precisely the blind spot this removes.

## When to run it

Run it **immediately before** any Email/Communications physical certification, and again before
declaring a result exact-head. A certification result is only valid for the revision both runtimes
were on at the time.

It is deliberately **not** a blocking CI job: CI runs on a commit, not on a deployment, so wiring it
into every PR would make CI fail whenever staging happens to be mid-deploy — noise that would train
people to ignore it. The comparison *logic* is CI-enforced through
`backend/tests/staging-runtime-parity.test.js`, which runs in both the main and Communications
workflows; the live probe is a certification step.

## Fixing a FAIL

Deploy the intended revision to **both** runtimes, then re-run:

- `api-staging.carup.dev` — alias the deployment to this host.
- `carup-backend-staging.vercel.app` — requires a **production-target** deployment, because
  `COMMUNICATION_WORKER_SECRET` is Production-scoped and a preview build will answer the cron with
  `401`.

Do not "fix" a FAIL by pointing the cron at `api-staging.carup.dev` instead. That would hide the
divergence rather than remove it, and the two hosts exist for separate reasons.

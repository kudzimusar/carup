# Workflow secret isolation

Introduced by CARUP-PAY-05-LR01 Checkpoint A (issue #252). Enforced by `scripts/ci/workflow-secret-isolation.mjs`
and `backend/tests/ci-workflow-secret-isolation.test.js`.

## Why it exists

Opening a same-repository pull request ran `diaspora-phases-3-7-validation`'s `staging-integration` job with
`secrets.DIASPORA_STAGING_DATABASE_URL`. That job writes, then deletes, synthetic rows on **shared staging**.
GitHub's own records (read-only API, 2026-11-02) show it executed on **54 of 54** Payments pull-request runs (PRs
#245–#251, 2026-10-29 → 2026-11-02), four staging tests each time, although no Payments package held staging
authority. On the same runs, `diaspora-deployed-staging-uat` received the staging credentials in its Bootstrap job
54 times; it stopped only because its own pairing proof refused the branch.

Pins such as `if: github.event.pull_request.number == 148`, a label, or an in-script refusal are not boundaries: a
pull request runs the workflow files of its own merge commit, so the next edit removes them. The policy is
therefore structural.

## The rules

| Code | Rule |
|---|---|
| `WSI-PRIVILEGED-PR-EVENT` | No workflow is triggered by `pull_request_target` or `workflow_run`. |
| `WSI-PR-SECRET` | A workflow that `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment` or `merge_group` can start references no secret except `GITHUB_TOKEN`, never uses `secrets: inherit`, `secrets[…]` or `toJSON(secrets)`, names no `environment:`, calls no local reusable workflow that does, and calls no remote reusable workflow. |
| `WSI-SHARED-DATA-REACH` | A job holding a shared-data credential (`*DATABASE_URL`, `*DB_URL`, `*SERVICE_ROLE*`, `*CA_CERT`, `*UAT_PASSWORD`, `*WORKER_SECRET`, `*SCHEDULER_SECRET`, `*DATA_API_METADATA_KEY`, `STAGING_*`, `*_STAGING_*`, `PRODUCTION_*`) can be started only by `workflow_dispatch` or `schedule` — directly, through `workflow_call`, or behind a top-level `github.event_name == 'workflow_dispatch'` condition. Never by `push` or a pull-request event. |
| `WSI-SHARED-DATA-APPROVAL` | A dispatchable job holding a staging credential names `environment: staging`; one holding a production credential names `environment: production`. Both environments have required reviewers. |

## What changed (20 workflow files)

- `diaspora-phases-3-7-validation.yml`: `staging-integration` removed. It now lives in the new
  `diaspora-staging-integration.yml`, which runs only on `workflow_dispatch`, waits for the `staging` environment's
  reviewers, and requires both the Owner's written authorization (`authorization_ref`, a comment URL) and the exact
  commit (`expected_sha`). It records both in the run summary.
- No longer started by a pull request, and now behind `environment: staging`: `diaspora-deployed-staging-uat`,
  `seller-home-lifecycle-staging-uat`, `operations-serena-staging-uat`, `seller-exact-head-staging-uat`,
  `seller-phase-d-account-diagnostic`, `seller-phase-e-staging`.
- `oc5r-deployed-provider-proof`: the pull-request `labeled` trigger became an Owner dispatch behind
  `environment: staging`. Its guard test was updated to pin the new shape. The file must be on the default branch
  before it can be dispatched.
- `communication-command-center-ci`: the two staging jobs pinned to PR #148 were removed. That PR merged on
  2026-08-16 (`f9c6f80d`), so the jobs could never run again; their last definition is in that commit.
- `seller-registration-profile-staging`, `seller-s0-global-taxonomy-staging`, `seller-s3-location-visibility-staging`:
  these PR-pinned one-shot gates are retired to `workflow_dispatch`. Their PR conditions can never hold for a
  dispatch, so they are inert.
- `seller-baseline-visual-audit`, `seller-media-lifecycle-staging-uat`: the push trigger was removed and
  `environment: staging` added.
- `issue164-staging-truth-cutover`: the one-shot push-to-`main` path was removed. It had already been used, and
  `main` has no branch protection.
- `o2-ocr-hardening-offline` (stage-4 job), `diaspora-canonical-staging-uat`, `diaspora-staging-19-…`,
  `diaspora-staging-20-…`: `environment: staging` added.

After the change, the dry run finds 57 jobs in 29 workflows that a pull request can start. None of them can read a
secret or a protected environment. A push of a Payments branch reaches no shared-data credential.

## Running it

```bash
node --test backend/tests/ci-workflow-secret-isolation.test.js
node scripts/ci/workflow-secret-isolation.mjs --push-branch "$(git branch --show-current)" --report report.json
```

The PAY-04 and PAY-05 CI workflows run both on every push and pull request, and publish the report as an artifact.

## What only the Owner can close

The policy governs workflow files. It cannot stop someone with write access from adding a new workflow on their own
branch that reads a **repository-level** secret. These remain repository-level today: `DIASPORA_STAGING_DATABASE_URL`,
`STAGING_UAT_PASSWORD`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `TRADEOS_WORKER_SECRET`,
`VERCEL_TOKEN`, `CLOUDFLARE_*` and `GEMINI_API_KEY`. The complete fix is a repository-settings change:

1. Move the staging credentials into the `staging` environment's secrets, so that only reviewer-approved jobs can
   read them.
2. Enable "Prevent self-review" on `staging` and `Production`.
3. Protect `main`.

Note: `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are used only by the dispatch-only
`diaspora-live-validation*` workflows, and which project they point at is not recorded anywhere a workflow can
check.

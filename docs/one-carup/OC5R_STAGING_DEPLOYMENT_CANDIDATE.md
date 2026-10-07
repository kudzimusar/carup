# OC-5R staging deployment candidate (REL-01)

This package prepares the governed staging release of PR #222. The release itself is recorded separately in `certification/OC5R_STAGING_RELEASE_RECORD.json`: deployment ids, aliases, runtime-identity proof and gate runs. That separation keeps the candidate an immutable statement of *what may be deployed*.

The machine-readable package is [`certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json`](certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json). It is checked by:

```
node scripts/ci/verify-deployment-candidate.mjs \
  --manifest docs/one-carup/certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json \
  --deployed-sha <deploy commit>
```

## The candidate

| | |
|---|---|
| Branch / PR | `fix/oc5r-real-runtime-source-closure` · #222 (Draft, unmerged) |
| **Code SHA** | `15b604ba3dd13d440396f0f165ecf44b960646a6` |
| Supersedes | `d18936ab` (PROV-01) and `e7b14a07`. The `e7b14a07` deploy commit `312916a6` had its backend preview deployed. Its runtime-identity check found one database endpoint unreadable by shape, so the parser was fixed in `15b604ba` and that backend preview is not used |
| Deployable commit | The code SHA, or a descendant that changes **only** `docs/**` and this branch's two pairing records |
| Frontend | `carup-staging` (`prj_auYmL5hA2ppWA15jdTK4GAdy3AYm`), **preview** target |
| Backend | `carup-backend-staging` (`prj_ddsVeXDxxHxyMAaZxX4v5ORya27W`), **preview** target |
| Frontend SHA = backend SHA | Yes. One monorepo commit; the gates require frontend == backend == head |
| Database | `eoyenigwevnxwwhyhaer` (canonical staging). REL-01 changed nothing under `database/` |
| Stable aliases | `carup-staging.vercel.app` and `carup-backend-staging.vercel.app` are **never** moved |

## Why the pair is on named aliases

The CarUp Vercel projects have had **no connected Git repository** since the OC-P0 cost containment. This has three consequences:
- Vercel assigns no `-git-<branch>` alias.
- Vercel injects no `VERCEL_GIT_*` variables.
- Vercel refuses branch-scoped environment variables.

The PROV-01 procedure assumed all three. On 2026-10-08 the owner chose this path:
- **CLI upload of the exact commit.** The upload comes from a clean detached worktree; the dry run shows the upload set is the tracked tree and nothing else.
- **Two named preview aliases**, assigned through the Vercel API and read back:

| Record | Value |
|---|---|
| `web/preview-frontend-pairing.json` | `https://carup-staging-oc5r-rel01-11-11.vercel.app` |
| `web/preview-backend-pairing.json` | `https://carup-backend-staging-oc5r-rel01-11-11.vercel.app` |

- **Explicit build provenance.** `CARUP_BUILD_SHA` and `CARUP_BUILD_REF` are set to the deploy commit and branch.
  - They are build env on both previews, and runtime env on the backend.
  - The frontend pairs and stamps `/carup-provenance.json` from them.
  - The backend's `/api/health` build block reports them, with `source`.
  - Vercel's own variables win when present, and a contradiction is refused.

## Procedure (REL-01)

1. Commit only the two pairing records and the candidate documents on top of the code SHA. Verify the result (pairing `present`). This is the deploy commit.
2. Deploy `carup-backend-staging` to the preview target from a clean worktree at the deploy commit. Pass:
   - `-b`/`-e CARUP_BUILD_SHA`
   - `-b`/`-e CARUP_BUILD_REF`
   - `-e COMMUNICATION_OUTBOUND_DISABLED=true`
   - `-m carupSourceSha`

   Assign the backend alias and read it back.
3. Deploy `carup-staging` the same way (`-b` build provenance). Assign the frontend alias and read it back.
4. Prove runtime identity before any journey:
   - the served bundle and `/api/health` both state the deploy commit;
   - the bundle calls the backend alias;
   - the database refs are the staging project only;
   - OCR custody is canonical (cloudflare/Qwen) and general AI is cloudflare/Gemma;
   - the outbound kill switch is **active**.
5. Run the deployed provider proof, then the two staging gates, on the deploy commit. The proof runs when the label `oc5r-deployed-provider-proof` is added to the PR.

## Environment contract changes (names only)

- **`COMMUNICATION_OUTBOUND_DISABLED=true`.** Deployment-scoped runtime env on the backend preview. Without a Git connection a branch-scoped variable cannot be created. It is never set on production. Proven by `/api/health` → `communications.outbound.kill_switch: active`.
- **`CARUP_BUILD_SHA`, `CARUP_BUILD_REF`.** Deployment-scoped; see above.
- **`CLOUDFLARE_API_TOKEN`.** Unchanged: the owner set it on the preview and production targets. Nothing reads the stale `CLOUDFLARE_TOKEN`.
- **`COMMUNICATION_WORKER_SECRET`.** Absent on this preview. The Diaspora gate's spec 45 (D7, two tests) drains the outbox with GitHub's `TRADEOS_WORKER_SECRET`, so it gets 401. On 2026-10-08 the owner decided to run it and report this.
- **Everything else** is as in the PROV-01 contract. The now-strict webhook secrets remain absent on staging.

## GitHub staging protection (E2)

Unchanged since PROV-01: the `staging` environment requires one of `kudzimusar` or `11-eleven-skm`. The two deployed-UAT gates and the label-triggered provider proof declare no environment.

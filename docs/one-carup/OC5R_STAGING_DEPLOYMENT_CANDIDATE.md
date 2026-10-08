# OC-5R staging deployment candidate (REL-02)

This package prepares the second governed staging release of PR #222. It is built on top of the branch **as REL-01 left it**; nothing REL-01 recorded is rewritten.

The release itself is recorded separately in `certification/OC5R_REL02_STAGING_RELEASE_RECORD.json`: deployment ids, aliases, runtime-identity proof, the provider proof and the gate runs. That separation keeps the candidate an immutable statement of *what may be deployed*.

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
| **Code SHA** | `1737763513f36158abb954fcd49e25dc49181779` |
| Starting head | `ce89a8fac7ad75d07e9b6d9fc4ab87e8503dbc80` (REL-01's release record) |
| Preserved, not superseded | `d491b5aa` (code `15b604ba`): REL-01's accepted **frozen deployed evidence**. Its named preview aliases (`…-oc5r-rel01-11-11`) keep serving that exact deployment, and its receipts, release record and report stand as written |
| Deployable commit | The code SHA, or a descendant that changes **only** `docs/**` and this branch's two pairing records |
| Frontend | `carup-staging` (`prj_auYmL5hA2ppWA15jdTK4GAdy3AYm`), **preview** target |
| Backend | `carup-backend-staging` (`prj_ddsVeXDxxHxyMAaZxX4v5ORya27W`), **preview** target |
| Frontend SHA = backend SHA | Yes. One monorepo commit; the gates require frontend == backend == head |
| Database | `eoyenigwevnxwwhyhaer` (canonical staging). REL-02 changed nothing under `database/` |
| Stable aliases | `carup-staging.vercel.app` and `carup-backend-staging.vercel.app` are **never** moved. Neither are the REL-01 aliases |

## What REL-02 changed (source)

REL-01's two governed gates were red on four defects, none of them REL-01's. REL-02 closes them without weakening an assertion and without bypassing the real UI.

| | Defect | Resolution |
|---|---|---|
| **A** | The loaded owner `/dashboard/garage/:vin` page never said it was the Vehicle Passport, so the frozen Seller assertion `/Vehicle Passport\|Passport/i` could not pass | A visible "Vehicle Passport" label above the vehicle heading and VIN. Presentation only: no new authority, no data, no change to the loading or error truth |
| **B** | Spec 41 counted `aria-current="page"` across **both** navigation systems | The product is unchanged: the sidebar and the compact bar each mark their own destination. The spec now asserts exactly one active **sidebar** destination, and which one |
| **C** | Spec 45 assumed an operator was already inside Hikari Co-Load after login | The spec chooses the organisation through the real prompt or switcher, as the product requires. It writes no storage, sets no tenant header and calls no endpoint itself |
| **D** | Spec 38's tablet tap failed | Reproduced before any change. **A harness-scroll defect**: the page's smooth scrolling and Playwright's auto-scroll never settle between two fixed bars. The control is structurally clear. The test now scrolls it clear, measures it, and taps normally. No force, and neither bar is touched |
| **E** | The deployed buyer assistant timed out: Gemma reasons by default (~16 s against a 12 s bound) | The Gemma policy sends `chat_template_kwargs.enable_thinking=false`. The 12 s bound, the shared transport, the OCR/Qwen body and the model pin are unchanged. A timed-out Marketplace answer now says `ai_reason: ai_timeout` |
| **J** | D7 would hide every journey after it if its drain were rejected | D7's assertions are unchanged and now run last. The drain's answers are recorded |

## Why the pair is on named aliases

The CarUp Vercel projects have had **no connected Git repository** since the OC-P0 cost containment. Vercel assigns no `-git-<branch>` alias, injects no `VERCEL_GIT_*` variables and refuses branch-scoped environment variables. A governed release is therefore a CLI upload of a clean detached worktree onto two **named** aliases.

REL-02 uses **new** aliases, so the REL-01 evidence keeps serving the exact deployment it recorded:

| Record | Value |
|---|---|
| `web/preview-frontend-pairing.json` | `https://carup-staging-oc5r-rel02-11-11.vercel.app` |
| `web/preview-backend-pairing.json` | `https://carup-backend-staging-oc5r-rel02-11-11.vercel.app` |

- **Explicit build provenance.** `CARUP_BUILD_SHA` and `CARUP_BUILD_REF` are set to the deploy commit and branch.
  - They are build env on both previews, and runtime env on the backend.
  - The frontend pairs and stamps `/carup-provenance.json` from them.
  - The backend's `/api/health` build block reports them, with `source`.
  - Vercel's own variables win when present, and a contradiction is refused.

## Procedure (REL-02)

1. Deploy the **backend** preview of the code SHA first. Assign the backend alias and read it back; its `/api/health` must already state the code SHA and an active kill switch.
2. Commit only the two pairing records and the candidate documents on top of the code SHA. Verify the result (pairing `present`). This is the deploy commit.
3. Deploy **both** previews from that commit. Pass:
   - `-b`/`-e CARUP_BUILD_SHA`, `-b`/`-e CARUP_BUILD_REF`;
   - on the backend, `-e COMMUNICATION_OUTBOUND_DISABLED=true`;
   - `-m carupSourceSha`.

   Assign both aliases and read them back.
4. Prove runtime identity before any journey:
   - the served bundle and `/api/health` both state the deploy commit;
   - the bundle calls the backend alias;
   - the database refs are the staging project only, and consistent;
   - OCR custody is canonical (cloudflare/Qwen) and general AI is cloudflare/Gemma;
   - the outbound kill switch is **active**.
5. Run the deployed provider proof, then the two staging gates, on the deploy commit. The proof runs when the label `oc5r-deployed-provider-proof` is added to the PR.

## Environment contract (names only)

- **`COMMUNICATION_OUTBOUND_DISABLED=true`.** Deployment-scoped runtime env on the backend preview. It is never set on production. Proven by `/api/health` → `communications.outbound.kill_switch: active`.
- **`CARUP_BUILD_SHA`, `CARUP_BUILD_REF`.** Deployment-scoped; see above.
- **`CLOUDFLARE_API_TOKEN`.** Set by the owner on the preview and production targets.
  - It is **runtime-verified** on the REL-01 preview: `/api/health` reported OCR (Qwen) and general AI (Gemma) configured, and a deployed Qwen run through the product path answered.
  - Only the stable staging deployment (main@bb9d9900) still predates it.
  - Nothing reads the stale `CLOUDFLARE_TOKEN`.
- **`SUPABASE_DB_URL`.** It no longer targets the Preview environment. The owner removed that target on 2026-10-07 because its value is unreadable by shape and no runtime path reads it while `DATABASE_URL` is set. Its production scope is unchanged. **This programme does not restore it.**
- **`COMMUNICATION_WORKER_SECRET`.** Absent on the Preview target.
  - Spec 45 D7 drains the outbox with GitHub's `TRADEOS_WORKER_SECRET` at `/api/internal/events/process`.
  - That endpoint accepts only the runtime's `COMMUNICATION_WORKER_SECRET` or `CRON_SECRET`, and otherwise answers 401 "Unauthorized communication worker request."
  - D7 runs unchanged. If the secret is rejected, the exact response is recorded and reported as **one staging secret-custody blocker**.
  - This programme adds no backend secret and rotates none. `TRADEOS_WORKER_SECRET` is never made a backend authentication secret.
- **Everything else** is as in the PROV-01 contract. The now-strict webhook secrets remain absent on staging.

## GitHub staging protection (E2)

Unchanged since PROV-01: the `staging` environment requires one of `kudzimusar` or `11-eleven-skm`. The two deployed-UAT gates and the label-triggered provider proof declare no environment.

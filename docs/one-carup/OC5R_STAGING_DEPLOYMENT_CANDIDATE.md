# OC-5R staging deployment candidate (PROV-01 E1–E3)

**Nothing here has been deployed.** This package prepares a governed staging deployment. No deployment, redeploy, alias move,
promotion, Git auto-deploy change or merge was performed. DEPLOYED-CERTIFIED is not claimed.

The machine-readable package is [`certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json`](certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json).
`scripts/ci/verify-deployment-candidate.mjs` checks a deploy commit against it.

## The candidate

| | |
|---|---|
| Branch / PR | `fix/oc5r-real-runtime-source-closure` · #222 (Draft) |
| **Code SHA** | `d18936abfda408753013e821605914134518b155` |
| Deployable commit | The code SHA, or a descendant that changes **only** `docs/**` and this branch's two pairing records |
| Frontend | `carup-staging` (`prj_auYmL5hA2ppWA15jdTK4GAdy3AYm`), **preview** target, this branch |
| Backend | `carup-backend-staging` (`prj_ddsVeXDxxHxyMAaZxX4v5ORya27W`), **preview** target, this branch |
| Frontend SHA = backend SHA | Yes: one monorepo commit. The gates require frontend == backend == candidate head |
| Database | `eoyenigwevnxwwhyhaer` (canonical staging). PROV-01 introduced no migration |
| Stable aliases | `carup-staging.vercel.app` and `carup-backend-staging.vercel.app` are **not** moved; the pair resolver refuses them |
| Vercel team | `team_InL2Jmsg4dbG0rFY8nxriTha`. Git auto-deploy stays disabled |

**Verifier.** Run:

```
node scripts/ci/verify-deployment-candidate.mjs \
  --manifest docs/one-carup/certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json \
  --deployed-sha <deploy commit>
```

It refuses by name:
- `NOT_A_DESCENDANT`
- `CODE_CHANGED`
- `OTHER_BRANCH_PAIRING_CHANGED`
- `FRONTEND_ALIAS_MISMATCH`
- `BACKEND_ALIAS_SHAPE`
- `PAIR_REFUSED`

8 tests cover it; 6 of 6 mutants are killed.

## Pairing authority

| Record | Expected |
|---|---|
| `web/preview-frontend-pairing.json` | `https://carup-staging-git-fix-oc5r-real-runtime-source-closure-11-11.vercel.app`. This is Vercel's per-branch alias: 60 characters, not truncated |
| `web/preview-backend-pairing.json` | Must match `^https://carup-backend-staging-git-fix-oc5r-real-runtime-so[a-z0-9-]*-11-11\.vercel\.app$` |

The backend alias is over 63 characters, so Vercel truncates it and appends a hash it assigns at the branch's first backend
preview. That hash is **read from the deployment's alias list, never composed by hand**. Until that deployment exists, the
pairing records for this branch are deliberately absent.

## Procedure (for the authorised deployer; not performed here)

1. Deploy the **backend** preview of the deploy commit. Read its per-branch alias from the deployment's alias list.
2. Commit **only** this branch's two pairing records. Run the verifier: it must pass with pairing `present`.
3. Deploy **both** previews from that pairing commit. The frontend embeds the pairing at build time, so the deployed frontend
   commit must contain it. Run the verifier again.
4. Dispatch *Seller Home & Lifecycle Staging UAT* and *Diaspora Deployed Staging UAT* on the branch head. Each proves the
   governed exact-head pair before any staging contact.

**What counts as DEPLOYED RUNTIME VERIFIED:**
- the served bundle's pairing and the runtime request capture, not a READY deployment;
- `/api/health` on the backend preview reporting `ai.configured` / `ocr.configured`.

Until then, the Workers AI credential is **STAGING CONFIG PREPARED** only.

## Environment contract (E1)

Names and targets only. No value was read or decrypted. Read at 2026-10-07T14:44Z.

- **`CLOUDFLARE_API_TOKEN`:** present on `carup-backend-staging`, preview and production (the owner set it at 2026-10-07T14:25:16Z).
  `CLOUDFLARE_ACCOUNT_ID` is present too. These are what OCR (`@cf/qwen/qwen3.8-27b`) and the general AI gateway
  (`@cf/google/gemma-4-26b-a4b-it`) need.
- **`CLOUDFLARE_TOKEN`:** stale. No code reads it and no compatibility was added. **Owner action:** remove it.
- **`CLOUDFLARE_API_TOKEN` type:** `encrypted`, so team members can decrypt it. **Optional owner action:** store it as `sensitive`,
  like the other provider credentials.
- **Present on the backend preview target:**
  - `ALLOW_OCR_MOCK` (ignored in every deployment)
  - `BREVO_*`
  - `CLOUDFLARE_*`
  - `CORS_ALLOWED_ORIGINS`
  - the database URLs
  - `DIASPORA_SAFETRADE_ENABLED`, `DIASPORA_TRADE_GRAPH`
  - `ENABLE_AUTOMATION_WEBHOOKS`
  - `JWT_SECRET`
  - `OCR_MODE`
  - `RESEND_*`
  - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`
- **Absent on the preview target (pre-existing; production target only):**
  - `CARUP_BLOCKCHAIN_*`
  - `CARUP_EMAIL_REPLY_TOKEN_SECRET`
  - `CARUP_META_*`
  - `CARUP_TELEGRAM_*`
  - `COMMUNICATION_*`
  - `CRON_SECRET`
  - `CARUP_PUBLIC_API_URL`
  - `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`
  - `NODE_ENV`

  A branch preview therefore runs with:
  - ledger signing refused;
  - Meta and Telegram reporting `provider_not_configured`;
  - the communications worker off.

  No staging UAT spec signs a webhook, so this adds no dependency to the two gates.
- **Now strict in every deployment.** These are absent on staging, so their webhooks fail closed there:
  - `INSURANCE_WEBHOOK_SECRET`
  - `FINANCE_WEBHOOK_SECRET`
  - `ESCROW_TRUST_WEBHOOK_SECRET`
  - `ESCROW_PROVIDER_WEBHOOK_SECRET`
  - `DIASPORA_BILLING_WEBHOOK_SECRET`
  - `DIASPORA_SAFETRADE_WEBHOOK_SECRET`
  - `CARUP_CHANNEL_WEBHOOK_SECRET`

  Set one only when that webhook is to be exercised on staging. SafeTrade still answers 503 without an approved provider.
- **Frontend:** `VITE_API_URL` must **not** be set for this branch on `carup-staging`, because it would override the governed
  pairing. None is set today.

## GitHub staging protection (E2)

Applied and read back at 2026-10-07T15:03:58Z, and confirmed again at 15:16:57Z:
- **Environment:** `staging`.
- **Required reviewers:** one of `kudzimusar` or `11-eleven-skm`.
- **`prevent_self_review`:** `false`.
- **`can_admins_bypass`:** `true`.
- **Branch policy:** none.

**Consequences:**
- **Jobs that now wait for a reviewer.** Every job that names `environment: staging`:
  - `diaspora-scheduler-dispatch`
  - `diaspora-staging-uat-tenancy`
  - `diaspora-staging-gtm-migrations`
  - `events-cron-staging-migration`
  - `issue164-golden-vehicles-dispatcher`
  - `issue164-staging-truth-cutover`
  - `marketplace-reference-media-staging`
  - `publication-gate-staging-migrations`
  - `seller-registration-profile-staging`
  - `seller-s0-global-taxonomy-staging`
  - `seller-s3-location-visibility-staging`
- **The two deployed-UAT gates in step 4 are unaffected.** They declare no environment.
- **The scheduler queues inert waiting runs.** `diaspora-scheduler-dispatch` runs on a `*/15` cron on `main`, so each tick now
  queues a waiting run. Its last run (2026-10-07T09:16Z) was a no-op: "SKIPPED — DIASPORA_API_BASE_URL is not configured".
  Pausing it therefore stops no live job.
- **A stricter mirror of Production is one setting change:** self-review prevented, no admin bypass.

# OC-5R-PROV-01 — Provider source convergence & staging deployment readiness

**Status:** READY FOR MODERATOR REVIEW. No deployment occurred. DEPLOYED-CERTIFIED is not claimed. Owner UAT has not begun.

| | |
|---|---|
| Branch / PR | `fix/oc5r-real-runtime-source-closure` · PR #222 (Draft, unmerged) |
| Starting head | `cfe8bfa6e7c48c446eb05894e253681024cd6118` |
| A1 | `a6d9d81f1aef275be9c9e635b52f5c7f2fe80877` |
| B | `16698d6cccba17917c47b9bb7651730813afb42a` |
| C | `c31ad2b5e382af3bd02b96e464112f8c3f9eb0c1` |
| Communications + D2 + E3 | `4a6f96e7564cf8081cd3d28928bc1cee1b514585` |
| **Candidate code SHA** | `d18936abfda408753013e821605914134518b155` (CR-1 test fix; test-only diff from `4a6f96e7`) |
| Final head | this documentation commit — a docs-only descendant of the candidate code SHA (`scripts/ci/verify-deployment-candidate.mjs` passes) |
| Staging DB | `eoyenigwevnxwwhyhaer` (canonical). Production database: never contacted. |

## 1. Source defects closed

**A1 — Trust authority**
- Trust counted partner-file and CarUp manual-review coverage as a *connected* source: +8 each on the score, the connected-source count, the confidence ceiling, the CarUp Gold ≥2 floor and the insurer/eligibility ≥1 floor.
- The automated government check fed that count. For a provider in partner_file/manual mode it returned the SANDBOX synthetic payload, persisted under partner-file/manual provenance. The registry refuses `sandbox` in a deployment, so those two modes were how fixtures reached deployed Trust.
- Fixed:
  - only `source_connected` is connected; reviewed evidence is kept, counted as `reviewed`, disclosed in plain words, and adds nothing;
  - the automated path never mints reviewed provenance;
  - the rules version is now `trust-decision-1.1.0`.
- No history was rewritten: the coverage view, `recordManualVerification` and every row are unchanged.

**B1 — one deployed-runtime classifier**
- `testFixtureGuard` now delegates to `utils/runtimeEnvironment.js`.
- NODE_ENV alone can no longer open a bypass inside any declared deployment. The bypasses closed:
  - the x-user-id identity fallback and passwordless login (the latter had no deployment guard at all);
  - the CSRF bypass and its committed secret;
  - the ephemeral ledger signing secret (previously refused in production only);
  - the OCR asserted-identity seam and the client-extraction seam;
  - the static vault token and the Seller fixture scope;
  - error diagnostics and the CSRF cookie flags.

**B2 — webhook seams and committed secrets**
- The communications `{test:true}` seam and the committed billing, eligibility, escrow-trust and escrow-provider secrets are now local/CI only.
- They were live on staging and previews.

**B3 — SafeTrade payment webhook**
- Replay drift was measured against the sandbox's fixed record clock (2026-06-21T00:00Z). A delivery stamped at that instant verified forever, and a fresh one never did. Drift is now measured against the wall clock.
- The route bypassed the fail-closed provider selector. It now selects through it, and a deployment without an approved provider answers 503 and reconciles nothing, even with a configured secret.
- The committed key is never usable in a deployment.

**B4 — escrow provider participant authority**
- PATCH transition and POST initiate admitted every buyer, owner and dealer account.
- They now require the canonical participant authority (`escrowTrustService.getSession`). An unrelated user gets 403 and nothing is written.

**B5 — eligibility, insurer and lender webhooks**
- A caller-supplied `x-provider-id` chose the verification key. The key is now server-owned (`verifyRouteWebhook`) and a mismatch is refused.
- A signature for one capability can no longer move another capability's request.

**C1 — ECB reference FX**
- Requests were unbounded. One request was made, and one insert attempted, per converted charge component, and one per read for unpublished currencies. A 16-day-old row could be served as AVAILABLE.
- Now:
  - every request is bounded;
  - one process observer has a success TTL and a failure TTL;
  - a snapshot is written only on a newer publication;
  - staleness is decided at read time;
  - nothing is fabricated.

**C2 — billing**
- BillingProviderError was an untyped 500. It is now a typed CarUpError: 4xx for the caller, 503 when the provider is not active, 502 for a bad provider answer.
- Read routes no longer select a provider. No path simulates success.

**C3 — Sentry health**
- `/api/health` said `enabled` whenever `SENTRY_DSN` existed, with no SDK installed. It now reports `unavailable` or `not_configured`.

**C4 — Help Center**
- The Help Center claimed EcoCash, ZIPIT and RTGS for CarUp plans, and the assistant said "We accept multi-currency payments!".
- Every mention of a payment rail is now qualified, and no online payment method is claimed as live.

**Communications transport boundary (proven by the boundary map)**

| Defect | Was | Now |
|---|---|---|
| G1 | The `:provider` URL segment chose the verification scheme, so `POST /webhooks/brevo/whatsapp?token=<Brevo secret>` ingested WhatsApp without Meta's HMAC. | The channel decides which provider may speak for it. |
| G2 | A Meta POST carrying the GET verify token was treated as verified. | Only Meta's HMAC authenticates a POST. |
| G3 | The generic `CARUP_CHANNEL_WEBHOOK_SECRET` was accepted in deployments, and comparisons were not timing-safe. | It is refused in every deployment, because no real provider presents it; comparisons are timing-safe. |
| G4 | Request-carried `notification_id`/`message_id` could mark ANY notification delivered without a matching delivery attempt. | A receipt moves state only through the attempt it resolves to. |
| G5 | A Telegram timeout became a permanent HTTP-400 `provider_rejected`. | It stays a retryable timeout. |
| G6 | A 2xx with no provider message id was recorded as sent under a synthesised id. | It is `provider_acceptance_unproven` (Resend, Meta ×3, Telegram, Twilio, the legacy Cloudflare worker). The admin smoke audit no longer says "delivered". |
| G7 | The inbound Resend body read was unbounded. | It is bounded. |
| G8 | Tests leaked `VERCEL_ENV=preview` into the rest of their file. | The environment is restored, and those tests now sign Meta POSTs the way a preview deployment requires. |

The boundary map's test gaps are closed too:
- the fake-Telegram assertion;
- Resend's `missing_secret` reason;
- refusal of a wrong Telegram or Brevo secret.

**Defects found by this run's own gates**
- **B3 battery survivor:** a test gap; closed at c31ad2b5.
- **C1 battery survivor:** a stub that crashed instead of hanging; closed at 4a6f96e7.
- **CR-1:** a production project ref literal in the E3 test; closed at d18936ab.

## 2. Tests

**Full backend suite** (ci.yml env contract):

| SHA | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| a6d9d81f | 8,053 | 8,030 | 0 | 23 |
| 16698d6c | 8,082 | 8,059 | 0 | 23 |
| c31ad2b5 | 8,098 | 8,075 | 0 | 23 |
| 4a6f96e7 | 8,135 | 8,112 | 0 | 23 |
| **d18936ab** — exact-SHA worktree, every request refused unless loopback (offline by construction) | **8,135** | **8,112** | **0** | **23** |

**Web** (vitest, from `web/`, at d18936ab):
- 2,208 / 2,228 pass.
- The 20 failures are in 6 files (route convergence, AuthContext ×2, guest sell draft, intelligence activity, restored draft). They reproduce identically at the starting head `cfe8bfa6` (20 failed / 20 passed in the same files) and run against a borrowed dependency tree. **PROV-01 did not introduce them**, and every PROV-01 web suite passes.
- `tsc -b` exit 0; `vite build` OK (non-deploying); ESLint clean on all 5 changed web files.

**Mobile** (at d18936ab):
- `tsc --noEmit` exit 0.
- The native contract tests (`test:native`) pass 10/10.
- vitest: 66/66 tests pass. Two standalone `tsx` harnesses, `garage-odometer-ocr` and `marketplace-media-contract`, are missing from `mobile/vitest.config.ts` `exclude` and report "No test suite found". This predates PROV-01 and is not run by CI.

**Gates at d18936ab**
- **CR-1:** clean (3,179 tracked files).
- **Certification guard:** 75 receipts, 54 capability rows, no impossible promotion.

## 3. Mutation testing

All batteries ran at an exact SHA in a clean detached worktree, one fragment per mutant, with the worktree verified clean afterwards. From D onward every node run is egress-guarded: every request is refused unless loopback.

| Set | SHA | Killed |
|---|---|---|
| A1 Trust / government | a6d9d81f | 13/13 + web 1/1 |
| B security | 16698d6c | 36/37 → survivor killed 1/1 at c31ad2b5 |
| C providers | c31ad2b5 | 13/14 → survivor killed 1/1 at 4a6f96e7; Help Center web 3/3 |
| Communications G1–G7 | 4a6f96e7 | 18/18 |
| D2 smoke harness + workflow | 4a6f96e7 | 9/9 |
| E3 candidate verifier | 4a6f96e7 | 6/6 |
| Qwen OCR boundary | 4a6f96e7 | 21/21 |
| Native odometer | 4a6f96e7 | 12/12 + mobile 4/4 |
| Gemma gateway | 4a6f96e7 | 14/14 |
| Marketplace advisory | 4a6f96e7 | 12/12 |

## 4. Receipts earned (`ONE_CARUP_CERTIFICATION_MANIFEST.json`)

**SOURCE-CERTIFIED**
- `trust.connected_source_authority`
- `security.deployed_runtime_boundary`
- `payments.safetrade_webhook_boundary`
- `escrow.provider_participant_authority`
- `eligibility.webhook_identity`
- `trade.reference_fx`
- `billing.provider_unavailable_contract`
- `observability.health_truth`
- `web.help_center_payment_claims`
- `communications.transport_boundary`
- `programme.live_provider_smoke_harness`
- `programme.staging_deployment_candidate`
- `ocr.qwen_boundary`
- `garage.native_odometer_candidate`
- `ai.general.gemma_gateway`

`marketplace.ai_advisory` received a **scoped** SOURCE receipt, but its SOURCE cell is **not promoted**. The price estimate publishes a deterministic "fair" band, against "CarUp publishes no valuation", and the model may raise its confidence label. `ai_notes` are unfiltered.

**Carried LIVE PASS:** `ocr.qwen_boundary` keeps the earlier block's `OC5R-OCR-QWEN-LIVE-SMOKE` (run 37607951170 @ `f8fed206`).
- Check at `d18936ab`: the receipt's 18-file import closure has only two changes since `f8fed206`.
  - `config/testFixtureGuard.js` (B1). The path calls only `isTestFixtureAllowed`, which is false under the workflow's
    `NODE_ENV=production` before and after.
  - `services/ai/sentry.js` (C3). An additive export the path never calls.
- The receipt's path therefore behaves identically. It remains a PARTIAL single-fixture proof and makes no accuracy claim.

**LIVE-PROVIDER-CERTIFIED:** `trade.reference_fx` — ECB.
- The governed harness ran at `4a6f96e7` (local, keyless; workflow not dispatchable, see §5).
- Feed dated 2026-10-07, 29 currencies, JPY→USD triangulated through EUR, no snapshot written.
- Executed at 2026-10-07T14:43:57.735Z.

## 5. Providers not live-smoked — exact reasons

| Provider | State | Reason |
|---|---|---|
| Gemma (Workers AI) | BLOCKED | The local harness run classified it `NOT_CONFIGURED` (correct: no credential in that context). The governed dispatch-only workflow returns HTTP 404 "not found on the default branch" (re-checked 2026-10-07T15:15:11Z). A new workflow can only be dispatched once its file exists on `main`, and merging is forbidden. The credential exists only as GitHub repo secrets and in staging config, which no other execution context can read. **Unblock:** land `.github/workflows/oc5r-live-provider-smoke.yml` (workflow file only) on `main`, then `gh workflow run oc5r-live-provider-smoke.yml --ref fix/oc5r-real-runtime-source-closure -f provider=gemma`. |
| Resend | NOT_CONFIGURED | `RESEND_API_KEY` is not a GitHub secret. It exists only as a Vercel *sensitive* (write-only) variable. |
| Telegram | NOT_CONFIGURED | `CARUP_TELEGRAM_BOT_TOKEN`, same as Resend. |
| Meta WhatsApp | NOT_CONFIGURED | `CARUP_META_ACCESS_TOKEN`, `CARUP_META_PHONE_NUMBER_ID` and `CARUP_META_WABA_ID`, same as Resend. |

All four were classified by the harness at `4a6f96e7`. No message was sent; no fake response was created.

## 6. Staging environment (E1)

- **STAGING CONFIG PREPARED:** `CLOUDFLARE_API_TOKEN` is present on `carup-backend-staging` for preview and production (owner, 2026-10-07T14:25:16Z). `CLOUDFLARE_ACCOUNT_ID` is present.
- **NOT DEPLOYED-RUNTIME VERIFIED:** the running deployment `dpl_91cteUJnAN8218aeCtUPrXHSHLa3` serves `main@bb9d9900` and predates both the variable and this lineage.
  - **Superseded (2026-10-08, OC-5R-REL-01):** the governed REL-01 preview pair (`d491b5aa`) verified the variable at runtime — OCR (Qwen)
    and general AI (Gemma) reported configured by `/api/health`, and a deployed Qwen run answered (run 37705240258). Only the *stable*
    deployment named above still predates it. See `OC5R_REL01_STAGING_RELEASE_REPORT.md`.
- `CLOUDFLARE_TOKEN` is stale and unread. No compatibility was added. Removing it is an owner action.

The full names-only contract is in the candidate package. It covers what a new branch preview has and lacks, and which webhook secrets are now strict in every deployment.

## 7. GitHub staging protection (E2)

Applied at 2026-10-07T15:03:58Z:
- the `staging` environment requires one of `kudzimusar`, `11-eleven-skm`;
- self-review is allowed; admin bypass is kept; no branch policy.
- Confirmed again at 2026-10-07T15:16:57Z.
- **Consequence:** the scheduled `diaspora-scheduler-dispatch` runs, and the other 10 workflows whose jobs target `staging`, now wait for a reviewer (the list is in the candidate doc).
  - `diaspora-scheduler-dispatch` runs on main, `*/15` cron. Its last run (09:16Z) was a no-op: "SKIPPED — DIASPORA_API_BASE_URL is not configured". Holding it stops no live job.
  - The two deployed-UAT gates declare no environment, so they are unaffected.
- **Stricter Production mirror** (self-review prevented, no admin bypass): one setting change.

## 8. Deployment candidate (E3)

- **Package:** `docs/one-carup/certification/OC5R_STAGING_DEPLOYMENT_CANDIDATE.json` (human-readable: `OC5R_STAGING_DEPLOYMENT_CANDIDATE.md`).
- **Code SHA:** `d18936ab`.
- **Frontend and backend:** the same deploy commit, which is the code SHA or a descendant that changes only docs and this branch's two pairing records.
- **Projects:** `carup-staging` and `carup-backend-staging`, branch previews only. Stable aliases are not moved.
- **DB:** `eoyenigwevnxwwhyhaer`.
- **Expected pairing:**
  - the frontend alias is exact;
  - the backend alias is a shape whose hash Vercel assigns at the first branch preview, so it is never hand-composed.

## 9. Database reconciliation intact

- A fresh read-only capture (2026-10-07T14:58:26Z) recomputes the post-convergence manifest identically:
  - 207 RECORDED_AND_PRESENT, 7 NEVER_APPLY, 1 RECORDED_ONE_TIME_DATA_MIGRATION_NEVER_REPLAY;
  - 0 per-file differences;
  - ledger 263 rows, unchanged;
  - 38 orphan rows identical by (version, name).
- No file under `database/` changed since `cfe8bfa6`.
- The push CI window (14:42:28Z → 14:50:05Z) was net-zero: only 3 background `SECURITY_CSRF_VIOLATION` rows from `/triggers/github`; all pre-existing audit rows unchanged.

## 10. Production untouched

- No production tool, credential or project was used.
- The only Vercel operations were names-only environment reads on the two staging projects.
- Database reads were read-only, against staging.
- No production configuration, alias or deployment was read or changed.

## 11. No deployment

- No deployment, redeploy, alias move, promotion, Git auto-deploy change, merge, payment activation or biometrics activation occurred.
- The only GitHub configuration change is E2.

## 12. Residual findings (not changed here)

- **Marketplace price estimate:** the deterministic "fair" band, and model-adjustable confidence, sit against "no valuation". `ai_notes` are unfiltered. The `aiLimiter` route wiring is untested, and its budget is shared with other sensitive routes.
- **OCR model override:** `CARUP_OCR_MODEL` can select another proven, non-rejected model (e.g. Gemma) by explicit configuration.
- **Odometer privacy:** rests on the client contract plus the OCR-time bucket gate. The server does not force photo uploads private.
- **Synthesised request ids:** SendGrid, Brevo, Expo and Cloudflare REST still synthesise a request id on an id-less 2xx.
- **Consent:** no adapter checks recipient consent beyond the marketing gate.
- **Mobile vitest config:** the `exclude` list lacks two standalone `tsx` harnesses.
- **Preview environment:** a branch preview lacks the production-target-only variables listed in the contract, as before this programme.
- **Earlier inventory findings still open** (outside PROV-01's stages; the disposition is in `OC5R_LIVE_PROVIDER_READINESS.md`):
  - there is no communications send kill-switch, and several communications env vars are dead;
  - the admin WhatsApp credential-check `send_probe` sends one message through the raw adapter rather than the governed one
    (admin-only, explicit opt-in);
  - Drive / vault and deposits still fail with untyped 500s;
  - Document Intelligence labels an unconfigured provider `provider_failed`;
  - the Diaspora confidence score defaults to 0;
  - the Gemini key travels in the URL.

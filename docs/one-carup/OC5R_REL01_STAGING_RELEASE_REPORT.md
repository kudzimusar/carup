# OC-5R-REL-01 — Exact-SHA staging release & deployed UAT

**Status:** READY FOR MODERATOR REVIEW. The REL-01 run is complete; **the release is not.**
- The governed preview pair runs the exact deploy SHA, and its runtime identity is verified.
- Qwen OCR was proven through the deployed path.
- Gemma was **not**: the deployed advisory route exceeds its 12 s bound.
- **Both governed gates are red** (§6). Every failure is a pre-existing product-spec convergence gap of this lineage, not a REL-01 regression.
- Owner UAT has not begun and is not inferred. Production was not touched. PR #222 is unmerged.

| | |
|---|---|
| Branch / PR | `fix/oc5r-real-runtime-source-closure` · PR #222 (Draft, unmerged) |
| Starting head | `0c67d52958a02aa0397094111ffd6c08c4f5ca65` |
| **Code SHA** | `15b604ba3dd13d440396f0f165ecf44b960646a6` (supersedes `d18936ab` and `e7b14a07`) |
| **Deploy / UAT SHA** | `d491b5aa8778002341f1eba6e2450273546e52cb`: the two pairing records and the candidate docs on top of the code SHA; `verify-deployment-candidate.mjs` passes with pairing `present` |
| Staging DB | `eoyenigwevnxwwhyhaer`. The production project was never contacted |
| Release record | [`certification/OC5R_STAGING_RELEASE_RECORD.json`](certification/OC5R_STAGING_RELEASE_RECORD.json) |

## 1. The four release blockers, closed in source

**Marketplace — no valuation is manufactured**
- The all-in estimate no longer publishes a fair value or an asking-price ± band.
  - It states `valuation_status: not_configured` with a notice.
  - `price_confidence` is the fixed cost-estimate label.
- The price estimate makes no provider call for any caller, so no model can raise its confidence or write notes.
- AI text that states a money amount, a percentage or valuation vocabulary is withheld from:
  - buyer guidance;
  - listing drafts;
  - share copy.

  The reader is told when this happens.
- An AI-assisted answer carries `ai_provenance {provider, model, execution}`.
- `marketplace.ai_advisory` SOURCE is promoted on this evidence: REL-MARKET 24/24 and REL-MARKET-web 3/3.

**Native odometer — the server derives private storage**
- An odometer photo is always stored private, in the `ocr-documents` bucket, whatever the caller asks. This covers `current_condition:odometer`, `inspection:odometer_reading` and the legacy `odometer_photo`.
  - A requested `public_safe` is clamped to `private`, and the refusal is recorded.
  - A remote reference outside that bucket is refused.
- Classification correction cannot move a public-bucket row into an odometer type, nor publish one.
- Partner ingestion skips such assets.
- The client contract and the OCR-time bucket gate are unchanged.
- The regression back to the old public path is a killed mutant (REL-ODO 13/13).

**OCR custody — fails closed in a deployment**
- In staging, preview or production, an OCR model override must be absent or exactly `@cf/qwen/qwen3.8-27b`. Anything else is `OCR_CUSTODY_REFUSED`.
- A process deployed only by `NODE_ENV` opens the evaluation seam only with `CARUP_OCR_MODEL_EVALUATION=governed`.
- Local and test keep the controlled seam.
- Gemma's general-AI role is unchanged.
- `/api/health` reports `ocr.custody`. REL-CUSTODY 8/8.

**Communications — a real outbound kill switch**
- `COMMUNICATION_OUTBOUND_DISABLED` is fail-closed. Every external send is refused before any request, with `outbound_disabled`. This covers:
  - the direct adapters;
  - the governed Meta template path;
  - the delivery worker, which holds the item one hour out with an `OUTBOUND_HELD` audit;
  - the admin smoke route;
  - `send_probe`.
- `send_probe` now runs through the governed `sendProviderSmokeTest` boundary.
- SendGrid, Brevo, Expo, Cloudflare REST and the Cloudflare worker no longer synthesise a provider id. An id-less 2xx is `provider_acceptance_unproven`.
- REL-COMMS 19/19.

**Release support**
- **Explicit build provenance.** `CARUP_BUILD_SHA` and `CARUP_BUILD_REF` serve the Git-less previews. Vercel's own variables win, and a contradiction is refused.
- **Database target in `/api/health`.** It reports the project ref of every configured endpoint, never a value. An unreadable endpoint is counted and named, and `consistent` requires every endpoint to be read. Batteries: REL-HEALTH 10/10, REL-PROV 4/4 + 6/6.
- **The label-triggered deployed provider proof.** REL-PROOF 10/10.

## 2. Re-certification of the code SHA

| Check | Result |
|---|---|
| Backend suite (ci.yml env contract) | 8259 tests: 8236 pass, **0 fail**, 23 skipped |
| Web vitest | 2217/2237. The 20 failures are identical to the starting head (2208/2228, same 6 files) and touch no changed or release-critical surface |
| Web build · eslint | OK · clean |
| Mobile | tsc clean · vitest 66/66 (two tsx harnesses mis-collected, pre-existing) · native push tests pass |
| CR-1 · certification guard | clean (3194 files) · no impossible promotion |
| Mutation batteries | 93/93 at `e7b14a07`, plus REL-HEALTH 10/10, REL-PROOF 10/10 and REL-CUSTODY 8/8 re-run at `15b604ba`. The other sets' files are unchanged |
| DB reconciliation (read-only) | 207/7/1; 0 diffs; ledger 263; 38 orphans identical; 7,703 live objects, 0 unexplained |

The web and mobile trees at `15b604ba` are byte-identical to `e7b14a07`, where those suites ran.

## 3. Deployment

- **How the previews were built.**
  - CLI uploads of a clean detached worktree at the deploy SHA. The dry-run upload set is the tracked tree: 3190 = 3194 tracked − `.git` and four `.gitignore` files.
  - `CARUP_BUILD_SHA` and `CARUP_BUILD_REF` were passed as build inputs, with meta `carupSourceSha`. Vercel's meta filter returns exactly these deployments.
- **Frontend**
  - `dpl_F6XtrHpnu12WecJZYgMGzqZEqcbo` (carup-staging, preview).
  - Alias `https://carup-staging-oc5r-rel01-11-11.vercel.app`, read back.
- **Backend**
  - `dpl_CiBUWPo2g83cuhwts5oJ5aQgosnB` (carup-backend-staging, preview).
  - Deployment env `COMMUNICATION_OUTBOUND_DISABLED=true`.
  - Alias `https://carup-backend-staging-oc5r-rel01-11-11.vercel.app`, read back. It was moved from the unused `312916a6` preview.
- **Stable aliases unchanged.**
  - `carup-staging.vercel.app` remains `dpl_4LzS7ioRPzjvDbw1nSaiFdoqkT6Y`.
  - `carup-backend-staging.vercel.app` remains `dpl_91cteUJnAN8218aeCtUPrXHSHLa3`.
  - Both are main@bb9d9900.
- **Not used:**
  - `dpl_aw6JohCorvwwrvufmBd9BT5GbzjY`: the first backend preview of the deploy SHA, stopped at Stage 4 (see below).
  - Measurement probe `dpl_HCKwBhTFLYHqzw8b51nTwjky9KPg` and positive control `dpl_A5P5ty8Z7zrpCNJ9MBFa9UrC6v3A`: never aliased.

**Environment change, owner-approved**
- **What Stage 4 found.** The first backend preview's health named `SUPABASE_DB_URL` unreadable by shape, so `database.consistent` was false.
  - It is one *sensitive* Vercel entry, which nobody can read.
  - No runtime path reads it while `DATABASE_URL` is set.
  - Stage 4 stopped there.
- **What changed.** On the owner's decision, the entry's targets were edited from production + preview to production only.
  - Done at 2026-10-07T23:49:06Z, through the Vercel API.
  - The value was never read, decrypted or sent.
  - The production scope is unchanged.
- **Redeploy.** The same SHA was then redeployed.

## 4. Runtime identity — DEPLOYED RUNTIME VERIFIED

| Condition | Result |
|---|---|
| Frontend and backend serve `d491b5aa` (`explicit_build_input`); frontend paired, `api_base_url` = the backend alias | PASS |
| `DATABASE_URL` → `eoyenigwevnxwwhyhaer`. The probe whose only Postgres endpoint is `DATABASE_URL` reads that project. The positive control proves the blanking takes effect (`postgres_project_refs: []`) | PASS |
| `SUPABASE_DB_URL` absent from Preview; its production scope unchanged | PASS |
| Database consistent: the Supabase ref and every Postgres endpoint read as the staging project, 0 unrecognised | PASS |
| No production ref in the health body, nor in any of the 3 served chunks. The staging ref is in the split Supabase chunk | PASS |
| A browser load of the frontend alias called only the backend alias (12 requests) | PASS |
| OCR cloudflare / `@cf/qwen/qwen3.8-27b`, configured, custody canonical, mock not reachable | PASS |
| General AI cloudflare / `@cf/google/gemma-4-26b-a4b-it`, configured, advisory | PASS |
| Outbound kill switch `active`, external sends `disabled` | PASS |
| The stale `CLOUDFLARE_TOKEN` is not required (no code reads it) | PASS |

- The first identity run scanned only the entry chunk, so it missed the staging ref in the split chunk.
- The checker now crawls the whole chunk closure, which is stricter for the production check too.
- Both records are kept.

## 5. Deployed provider proof

Run [37705240258](https://github.com/kudzimusar/carup/actions/runs/37705240258), label-triggered at the deploy SHA, after the governed pair resolver.

**Qwen — SUCCEEDED through the deployed path**
- **Upload.** One synthetic odometer image (drawn digits `084213`) was uploaded with `visibility_level: public_safe`.
  - It was stored **private** in `ocr-documents`, with the refusal recorded.
- **OCR.** `run-ocr` answered from cloudflare / `@cf/qwen/qwen3.8-27b`.
  - Provider time 6.9 s.
  - The reading was `candidate_pending_review`, and every authority effect was false.
  - Recorded mileage did not move, and the vehicle stayed unpublished.
- **Accuracy is not claimed.** The reading was 4213 km: the two leading digits were dropped.
- **Cleanup.** The proof deleted its OCR rows (2 extractions, 1 OCR document).

**Gemma — not earned (LIVE stays pending)**
- **Observed.** The deployed buyer assistant answered `ai_unavailable` after 13.35 s, with no `ai_reason` and no provenance.
- **Cause.** The assistant bounds the gateway at 12 s, and Gemma reasons by default.
- **Diagnostic.** It was run outside the governed path through the Cloudflare account API. It is not evidence.
  - With the default reasoning, this request takes 16.3 s.
  - With `chat_template_kwargs.enable_thinking=false` it takes 2.7 s, with valid JSON.
- **Remediation is a code change, not made here.** Disable reasoning for advisory calls (or raise the bound), and surface `ai_reason: ai_timeout`.

## 6. Governed gates (exact deploy SHA)

**Seller Home & Lifecycle — FAILED: a pre-existing Seller/Garage product-spec convergence blocker**

Run [37703062846](https://github.com/kudzimusar/carup/actions/runs/37703062846), attempt 2. The pairing proof passed, against the frozen bundle `index-3F8HCCtf.js`.

- **Where it failed.** All three viewports failed at spec 48 line 450.
  - The sold vehicle's garage page loaded with its VIN, heading, trust and documents.
  - The spec expects the text "Passport", which the loaded page has never rendered.
  - The spec was authored at `6a64ea49` and had never run before.
  - `VehicleProfile.tsx` is unchanged from the starting head, so this is not a REL-01 regression.
  - The assertion is preserved unweakened, and the Garage UI was not patched in the frozen run. Remediation awaits moderator review.
- **Passed first:**
  - the publication gate;
  - P (the listing stays off ordinary Home, and shows in the run-scoped Home with its cover);
  - unpublish, republish and sold.
- **Not reached:** the after-sold Marketplace, Home and retirement assertions.
  - The DB afterwards shows all three run VINs as sold with `publication_status` still published.
  - This is an observation, not a gate assertion.
- **Q (Communications)** is `fixme` (owner decision D) and did not run.

**Diaspora Deployed — FAILED**

Run [37703063171](https://github.com/kudzimusar/carup/actions/runs/37703063171), attempt 2. The pairing proof passed in Bootstrap and in every shard.

| Shard | Passed | Failed | Skipped | Did not run |
|---|---|---|---|---|
| Chromium | 57 | 2 | 7 | 13 |
| Tablet | 47 | 3 | 29 | — |
| Mobile | 48 | 2 | 29 | — |

The aggregate is a failure, because it requires all three shards.

- **Spec 41 line 60 (all three viewports).**
  - On `/dashboard/garage`, two navigation links carry `aria-current="page"`: the sidebar's and the compact bottom nav's "My Garage". The spec expects one.
  - REL-01 changed no navigation, layout or dashboard file, and the compact nav predates the spec.
  - Classification: a pre-existing navigation product-spec convergence gap.
- **Spec 45 line 138 (Chromium) and line 507 (tablet and mobile).**
  - The operator lands "acting for yourself", with an organisation chooser ("Act for SYNTHETIC Hikari Co-Load Logistics").
  - The spec expects that organisation context implicitly: the identity header and the container create section.
  - REL-01 changed no Trade OS or tenant-context file.
  - Classification: a pre-existing active-organisation-context product-spec convergence gap.
  - Consequence: on Chromium the serial chain stopped, so 13 tests did not run, including **D7**.
- **Spec 38 line 569 (tablet only).**
  - The first "Request an inspection" button was visible, but every click landed on the fixed compact bottom nav for 20 s.
  - REL-01 changed the All-in cost panel on this page. The clicked button sits *above* that panel in the stacked tablet layout, so the panel cannot move it, and the step passed on desktop and mobile.
  - A comparative run has not excluded it.
  - Classification: a tablet-only fixed-overlay layout/test interaction.
- **Skips.**
  - Spec 43: three tests, because the Kingstone staging credentials are not provisioned for this gate.
  - Spec 47: two tests, because the T3 fixtures are not provisioned.
  - The rest skip by design: desktop-once journeys, and responsive cases on narrow projects.
- **D7 was not executed.** `COMMUNICATION_WORKER_SECRET` is still absent on this preview, so a run that reaches D7 will get a 401 from `/internal/events/process`. This is an environment blocker, and it is unchanged.

## 7. Database after UAT

The fingerprints are whole-database (public, auth, storage, migrations) and read-only. Every changed table is attributed to this run's own actors. Pre-existing rows are unchanged in every window: no row from before a window was updated or deleted.

| Window | Result |
|---|---|
| 23:17:35 → 23:37:31Z (deploy commit, push, cancelled gates, first backend preview) | **net-zero**; 1 background CSRF row |
| 23:37:31 → 23:57:39Z (deploys, probe and control, alias moves, Stage 4) | 3 anonymous telemetry rows from the Stage 4 browser capture |
| 23:57:39 → 00:04:37Z (provider proof) | proof identity, its session and login; 1 unpublished draft vehicle with its ownership row; 1 private evidence row in `ocr-documents`, with its append-only provenance event and object; 1 trust-presentation work item; 2 audit rows. **The proof's OCR rows were deleted** (0 remain) |
| 00:04:37 → 00:17:11Z (Seller gate) | 3 Golden Sellers; 3 vehicles (all Sold); their images, objects, private registration evidence, work items; 3 pending domain events; sessions, telemetry and audit |
| 00:17:11 → 01:02:45Z (Diaspora gate) | 3 Golden Sellers; 6 vehicles (all Sold); 5 guest inquiries to the run's own listings; 4 Diaspora import orders with their lines, quote, milestones and stock rows; 9 in-app notifications, queued with 0 attempts; 22 pending domain events; 2 intelligence rollups; sessions, telemetry and audit |

Across the whole run:
- 10 vehicles were created: 9 sold, 1 draft (the proof's). **0 are left live in commerce.**
- 7 users were created: the 6 Golden Sellers and the proof identity.
- **0 message-delivery attempts started, and nothing was sent or delivered.**

Invariants, read-only and identical before the release, after the proof and at the end:
- 0 of the 147 retired seed rows are present.
- 0 synthetic reference objects, and 0 synthetic reference listing images.
- u3 is present (tombstoned, expected), and the retained escrow is present.

Net-zero is not achieved, and is not claimed. The retained rows are retained by design:
- The evidence row cannot be deleted without its append-only provenance event, which the database refuses.
- Golden Sellers persist per run.
- The gates do not delete their fixtures.

The per-table record is in the release record.

## 8. Receipts earned

Only receipts the evidence supports were added to `ONE_CARUP_CERTIFICATION_MANIFEST.json`.

**SOURCE, at code SHA `15b604ba` (`local`)**

| Receipt | Capability |
|---|---|
| OC5R-REL01-MARKET-SOURCE | marketplace.ai_advisory (**SOURCE promoted PENDING → PASS**) |
| OC5R-REL01-ODOMETER-SOURCE | garage.native_odometer_candidate |
| OC5R-REL01-OCR-CUSTODY-SOURCE | ocr.qwen_boundary |
| OC5R-REL01-COMMS-SOURCE | communications.transport_boundary |
| OC5R-REL01-HEALTH-SOURCE | observability.health_truth |
| OC5R-REL01-PROVENANCE-SOURCE | programme.staging_deployment_candidate |
| OC5R-REL01-PROOF-HARNESS-SOURCE | programme.live_provider_smoke_harness |

**DEPLOYED, at deploy SHA `d491b5aa` (`preview`)**

| Receipt | Capability | Ladder |
|---|---|---|
| OC5R-REL01-CANDIDATE-DEPLOYED | programme.staging_deployment_candidate | DEPLOYED → PASS |
| OC5R-REL01-HEALTH-DEPLOYED | observability.health_truth | DEPLOYED → PASS |
| OC5R-REL01-QWEN-DEPLOYED | ocr.qwen_boundary | DEPLOYED → PASS (no accuracy claimed) |
| OC5R-REL01-ODOMETER-DEPLOYED | garage.native_odometer_candidate | **not promoted**: the device/Expo capture runtime was not exercised |

**LIVE-PROVIDER, at deploy SHA `d491b5aa` (`preview`)**

| Receipt | Capability | Note |
|---|---|---|
| OC5R-REL01-QWEN-DEPLOYED-LIVE | ocr.qwen_boundary | the current-lineage live receipt; the 084213 → 4213 misread is recorded |

**Not earned**
- Gemma LIVE and DEPLOYED.
- marketplace.ai_advisory LIVE and DEPLOYED.
- seller.home_lifecycle DEPLOYED.
- communications.transport_boundary DEPLOYED: the kill switch is active, but no send was attempted on the deployment.
- Any capability promotion from the Diaspora gate.
- Any OWNER-UAT.

## 9. Production untouched

- **Vercel.** No production-target deployment was made, and no stable or production alias moved.
- **Domains.** `carup.dev` and `api.carup.dev` were not touched.
- **Database.** The production Supabase project was never contacted. Every database read was against `eoyenigwevnxwwhyhaer`.
- **Environment.** The only edit was removing Preview from `SUPABASE_DB_URL`, owner-approved; its production scope is unchanged.

## 10. Remaining blockers before Owner UAT

1. **Seller/Garage product-spec convergence** (spec 48 line 450). Decide whether the page renders a visible "Vehicle Passport" label or the spec asserts on what the page renders. Then re-run the Seller gate at a new exact SHA.
2. **Navigation convergence** (spec 41 line 60). The sidebar and the compact bottom nav both mark the current page.
3. **Active-organisation context** (spec 45). The operator must choose an organisation where the spec expects it implicitly. This also blocks D7 and the rest of the Trade OS chain on desktop.
4. **Tablet fixed-overlay interaction** (spec 38 line 569). The compact bottom nav covers the first inspection CTA.
5. **Gemma on the deployed advisory path.** The 12 s bound and the model's default reasoning do not fit: ~16 s with reasoning, 2.7 s without. Fixing it is a code change, and it is not begun.
6. **D7 environment.** `COMMUNICATION_WORKER_SECRET` is absent on the preview.
7. **Environment follow-ups for the owner.**
   - `SUPABASE_DB_URL` is unreadable by shape on the production target of `carup-backend-staging` too: the stable staging runtime.
   - The stale `CLOUDFLARE_TOKEN` is still present on that production target.
8. **Pre-existing web baseline.** 20 web test failures in 6 files, identical at the starting head.
9. **Git disconnection.** The staging projects have no Git connection, so every governed preview is a CLI upload onto named aliases.

None of these is remediated in REL-01. Remediation awaits moderator review.

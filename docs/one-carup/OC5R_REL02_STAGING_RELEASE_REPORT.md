# OC-5R-REL-02 — Deployed product convergence: Seller, Trade OS and Gemma

**Status:** **READY FOR MODERATOR REVIEW. Both governed gates are GREEN at the exact deploy SHA, and the deployed provider proof SUCCEEDED.** One staging secret-custody blocker remains (D7, below). Owner UAT has **not** been performed, accepted or claimed.

| | |
|---|---|
| Branch / PR | `fix/oc5r-real-runtime-source-closure` · PR #222 (Draft, unmerged) |
| Starting head | `ce89a8fac7ad75d07e9b6d9fc4ab87e8503dbc80` (REL-01's release record) |
| Frozen REL-01 evidence | `d491b5aa8778002341f1eba6e2450273546e52cb` (code `15b604ba`). **Untouched**: its receipts, record and report stand as written, and its aliases still serve it |
| **Code SHA** | `ff50ba347b8cd43f144b320195bdcd18c98ffbd5` |
| **Deploy / UAT SHA** | `24a149334beb25932ebcafdb829463a65fce17f1` (documents only on top of the code SHA. The two alias records were committed with the interim deploy commit and are inherited unchanged, so the candidate verifier accepts it with pairing `absent`) |
| Superseded interim iteration | code `1737763513f36158abb954fcd49e25dc49181779`, deploy `1ab0e357c350de492447ab0fbeddc2fbcb8725d3`: deployed, runtime-verified and gate-tested. Its Diaspora gate found two **test-harness** defects and no product defect (C2, J2 below). No product source differs between it and the final code SHA. Its evidence is kept in §6a |
| Staging DB | `eoyenigwevnxwwhyhaer`. The production project was never contacted |
| Release record | [`certification/OC5R_REL02_STAGING_RELEASE_RECORD.json`](certification/OC5R_REL02_STAGING_RELEASE_RECORD.json) |
| Owner package | [`ONE_CARUP_OWNER_UAT_READINESS_PACKAGE.md`](ONE_CARUP_OWNER_UAT_READINESS_PACKAGE.md) |

## 1. What was fixed, and how each was classified

REL-01 left both governed gates red on four defects that were **not** REL-01's, and REL-02's own first deployed run found two more, both in the test harness. Each was investigated before it was changed.

| | Finding | Classification | Resolution |
|---|---|---|---|
| **A** | The loaded owner `/dashboard/garage/:vin` page never said it was the Vehicle Passport, so the frozen assertion `/Vehicle Passport\|Passport/i` could not pass | Product convergence gap (present since the spec was written) | A visible **Vehicle Passport** label above the vehicle heading and VIN. The landmark's name is the label plus the heading. No new authority or data, and the loading and error truth are unchanged. **The assertion is not weakened** |
| **B** | Spec 41 counted `aria-current="page"` across both navigation systems | Harness | Product unchanged. The sidebar and the compact bar each mark their own destination, and the bar is `lg:hidden` but stays in the DOM. The spec now asserts exactly **one active sidebar destination, and which one**. A real-component test pins that the compact bar may mark its own at the same time |
| **C** | Spec 45's operator assumed it was already inside Hikari Co-Load | Harness vs the OC-5D contract | The contract is authoritative: login never selects an organisation. A bounded helper chooses it through the real "Act for …" prompt or switcher, observes the product's own `PUT /api/auth/active-tenant`, and proves the context in the UI. It writes no storage, sets no tenant header and calls no endpoint. Applied to every operator journey (including the responsive one) and to the rival-tenant outsider, so the cross-tenant denial is a real tenant-isolation denial |
| **D** | Spec 38 tablet: the first "Request an inspection" tap timed out | **Harness-scroll defect**, by the gate you set | See below |
| **E** | The deployed buyer assistant timed out: Gemma reasons by default (~16 s against its 12 s bound) | Source (policy) | The Gemma policy sends `chat_template_kwargs.enable_thinking=false` |
| **J** | A D7 failure would skip every journey after it | Harness | D7's assertions are unchanged and now the **last two** tests; every drain response is recorded |
| **C2** | Spec 45's seven-viewport geometry sweep hit the suite's 90 s ceiling at its seventh viewport | **Slow, not stuck**: six viewports (393, 820, 1024, 1280, 1366, 1440) had completed at ~13 s each with every assertion passing. The one long test and the one visual-capture test now set explicit test timeouts (240 s and 180 s). The 90 s default, every per-action bound, `retries: 0` and all assertions are unchanged |
| **J2** | Spec 42 (tablet) failed with "the seller's UI upload must have produced a governed evidence row" | **Harness race, product correct.** The test clicked *Submit Evidence* and read the evidence list at once. The deployed backend's runtime log shows the seller's `POST …/evidence/upload` running 04:12:13.8→04:12:16.5 (HTTP **201**) and the reviewer's list 04:12:14.2→04:12:15.5, **inside** it; the row was created at 04:12:15.6. The spec now observes the product's own POST (registered before the click), requires it accepted, and waits for the uploader to close (it closes only on success) before the reviewer reads. The assertions are unchanged and the list is still one read |

### D — reproduced before any change

- **Method.** The real deployed REL-01 frontend bundle at the tablet's 820×1180 with touch. The API was replayed from the gate's own recorded responses, so no staging data was touched.
- **The gate's trace.**
  - Playwright's log alternated "compact bar intercepts pointer events" and "sticky header intercepts pointer events", separated by "element is not stable".
  - The recorded scroll position ping-ponged **18 ↔ 1154**, in lockstep.
- **Reproduction.** From the gate's starting scroll (51) the plain click **failed 6/6** at 1×, 4× and 6× CPU throttle.
- **Cause isolated.**
  - The app sets `html { scroll-behavior: smooth }`.
  - Playwright's auto-scroll animates and reports "not stable".
  - Those retries leave only the two extreme alignments in play, so the control is put under the compact bar, then under the sticky header, and never in the middle.
  - With smooth scrolling off the identical click passes in ~150 ms.
- **Classification gate.**
  - After one user-equivalent scroll to the middle, the control sits at 568–612 inside the clear band 65–1111 (header bottom, bar top), with **zero overlap**.
  - Its centre's hit target is the control, and a normal click opens its dialog.
  - So it is **structurally clear**: a harness-scroll defect.
- **Fix.** `tapClearOfBars` scrolls the real control to the middle with an instant scroll, waits for it to settle, **measures** it against both bars (a pure, unit-tested geometry module), records the geometry as evidence, fails on any overlap, then taps with a **normal click**. It never forces, never hides or alters a bar, and never moves test pixels.
- **Verified.**
  - The real helper ran under Playwright against the replay: tablet, desktop and mobile at 1× and 6× CPU all passed.
  - The old plain click is kept as a failing control on the tablet.
  - The deployed result is in §6.
- **A product observation, not acted on.** `html { scroll-padding-top/bottom }` equal to the two bars would make browser-driven scrolls (keyboard focus, anchor jumps) clear them too (WCAG 2.2 "Focus Not Obscured"). That is outside the classification gate, so it was deliberately not made.

### E — the Gemma policy

- **What changed.** The request body is #217's plus the one field `chat_template_kwargs: { enable_thinking: false }`.
  - It applies to text, JSON and image requests.
  - The golden contract was updated **intentionally**: #217's body is kept verbatim as history, and the test proves the difference is exactly that field.
  - The rationale is documented in the provider and the tests: interactive CarUp advisory calls need bounded latency, and hidden model reasoning is not itself a CarUp product output or authority.
- **What did not change:**
  - `cloudflareAiTransport.js` still sends every policy's body verbatim.
  - The OCR/Qwen request body is **byte-identical** to a baseline captured before the change.
  - The model and provider are pinned.
  - There is one attempt and no fallback.
  - Provenance is unchanged.
  - The Marketplace's **12 s bound is not lengthened**.
- **`ai_timeout`.** A degraded Marketplace answer whose AI call timed out now carries `ai_reason: 'ai_timeout'`. **Only a timeout does.**
  - Every other failure keeps the deterministic answer with no reason.
  - Sign-in required, oversized input, valuation and withheld output keep their vocabulary.
  - An answer that never reached the model is never relabelled.
  - The buyer drawer says so.

## 2. Source certification (code SHA)

- **Code SHA `ff50ba34`.** The only change from the interim code SHA `17377635` is tests, harness specs and documents. **No product source differs.**
- **Backend.** The full suite under the ci.yml env contract: **8312 tests, 8289 pass, 0 fail, 23 skipped**.
- **Harness contracts.** `oc5r-rel02-uat-harness-contracts.test.js` passes **25/25**.
- **Web.** The evidence-uploader contract tests pass locally (9/9). The full web suite passed in CI at the deploy SHA (the OC-5D web surfaces job).
- **Spec type-check and lint.** Strict `tsc` on spec 42 exits 0, and eslint is clean on the changed web test.
- **Mutation.** Every set was run at `ff50ba34` and every mutant was killed:
  - REL-MARKET: 24/24
  - REL-PROOF: 10/10
  - REL2-EVIDENCE-web: 8/8
  - REL2-GEMMA: 21/21
  - REL2-GEMMA-web: 4/4
  - REL2-HARNESS: 59/59
  - REL2-NAV-web: 5/5
  - REL2-ORG-web: 8/8
  - REL2-PASSPORT: 7/7
  - REL2-PROOF: 9/9
- **Guards.** CR-1 is clean, the certification guard finds no impossible promotion, and the candidate verifier for `24a14933` returns `ok`, pairing `absent`. Every PR check on the deploy SHA passed.

## 3. The governed pair

| | Frontend | Backend |
|---|---|---|
| Deployment | `dpl_7DM7w7mTE5AesWueu2i6a6rjMHEG` | `dpl_796CYuhndXadx1TTvHjPWcFmJDfa` |
| Alias (named, REL-02) | https://carup-staging-oc5r-rel02-11-11.vercel.app | https://carup-backend-staging-oc5r-rel02-11-11.vercel.app |
| Upload set | the tracked tree exactly (3200 uploaded, nothing untracked) | same |
| Deployment env | `CARUP_BUILD_SHA` / `CARUP_BUILD_REF` (build) | the same, as build and runtime env, plus `COMMUNICATION_OUTBOUND_DISABLED=true` |

- **Process.** Both previews were built from a clean detached worktree at `24a14933`. The two aliases were then **moved** from the interim deployments (`dpl_CFRtA9A1…` and `dpl_8SoFtGC4…`) and read back.
- **Untouched.** The stable aliases and the REL-01 aliases were read back unmoved.

## 4. Runtime identity — DEPLOYED RUNTIME VERIFIED

- **Identity checks 14/14 and acceptance conditions 8/8, at `24a14933`.**
  - Both aliases state the deploy SHA (`source: explicit_build_input`).
  - The frontend is paired to the REL-02 backend alias.
  - The database is `eoyenigwevnxwwhyhaer` only: consistent, with 0 unrecognised endpoints.
  - No production ref appears in the health body or in any served chunk.
  - OCR is cloudflare/Qwen with canonical custody. General AI is cloudflare/Gemma.
  - The outbound kill switch is active.
  - `SUPABASE_DB_URL` is **not** on Preview.
- **Browser capture.** A load of the frontend alias called only the REL-02 backend alias. Bundle `index-DvoFh8Hm.js`, the same bundle both gates froze.

## 5. Deployed provider proof (run 37728492328)

- **Overall: SUCCEEDED** (2026-10-08T04:40:01Z → 2026-10-08T04:41:11Z).
- **Gemma: HTTP 200 in 3937 ms**, inside the 12 s bound that was not lengthened.
  - `ai_assisted`, `ai_available: true`.
  - Provenance: cloudflare / `@cf/google/gemma-4-26b-a4b-it` / `provider_executed`.
  - 7 guidance lines, 0 withheld. Protected vehicle and user state unchanged.
- **Qwen.** The odometer photo was requested `public_safe` and stored **private** (`ocr-documents`), with the refusal recorded.
  - OCR: HTTP 201 in 41288 ms. `candidate_pending_review`, read **4213 km** where `084213` was drawn.
  - **No accuracy is claimed.**
  - Every authority effect is false, mileage is unchanged and the vehicle is still unpublished.
  - Cleanup: 2 extractions and 1 OCR document deleted.

## 6. Governed gates (exact SHA `24a14933`)

| Gate | Run | Result |
|---|---|---|
| Seller Home & Lifecycle | [37728393919](https://github.com/kudzimusar/carup/actions/runs/37728393919) attempt 2 | **success**. P+R passed on chromium (2.0 m), tablet (1.8 m) and mobile (1.6 m). The retirement sweep found nothing left in commerce. Q is fixme (owner decision D) |
| Diaspora Deployed | [37728394135](https://github.com/kudzimusar/carup/actions/runs/37728394135) attempt 2 | **success**. Chromium 71 passed / 0 failed / 9 skipped (18.3 m); tablet 50/0/30; mobile 50/0/30 |

- **Every REL-02 finding closed on the deployed pair:**
  - A: the frozen Passport assertion holds on three viewports.
  - B: spec 41 passes on all three.
  - C: every operator and outsider journey chose its organisation through the real prompt, and the rival-tenant denial held.
  - C2: the seven-viewport geometry gate and the visual capture passed.
  - D: spec 38 on tablet passed.
  - J2: spec 42 passed on all three.
- **Skips:** spec 43 ×3 (Kingstone credentials not provisioned), spec 47 ×2 (T3 fixtures not provisioned), and four responsive cases that run on the narrow projects by design.

### D7: the tests reported passed, but the result is NOT earned

- **The drain was refused every time.** Every call answered `401 {"error":"Unauthorized communication worker request."}`: 7× in the participant test, 8× in the operator test.
  - The preview runtime has neither `COMMUNICATION_WORKER_SECRET` nor `CRON_SECRET`, so any supplied secret is refused.
- **The assertions passed on stale rows.** They only ask whether *some* `container_booking` notification exists for the user.
  - The newest such rows were created on **2026-09-26** by earlier Trade OS runs.
  - **This run created none.** Its 11 booking events (requested 4, received 4, approved 1, rejected 1, cancelled 1) sit unprocessed in `domain_events`.
- **Handling.** D7 ran **unchanged**, as instructed. No backend secret was added or rotated, and **no D7 receipt was issued.**

### 6a. The superseded interim iteration (`1ab0e357`)

- **Same procedure.** It was runtime-verified (14/14, 8/8), proved (run 37723572509, Gemma 3178 ms), and its Seller gate was green (run 37723227982).
- **Its Diaspora gate (run 37723228342) found two test-harness defects and no product defect:**
  - **C2:** spec 45's sweep hit the 90 s suite ceiling at viewport 7 of 7, after six had passed.
  - **J2:** spec 42 on tablet read the evidence list inside the product's own upload. The backend runtime log shows the reviewer's read 04:12:14.2→15.5 inside the seller's POST 04:12:13.8→16.5 (HTTP 201).
  - Mobile was 50/50.
- **Its evidence is kept in the release record.** No receipt cites it.

## 7. Database after the run

- **Window:** REL-02 start (03:32:14Z) to the final fingerprint (07:08:17Z). Verdict: **NO_UNEXPECTED_MUTATION**.
- **Invariants:**
  - retired seed rows present: 0 (all 147 absent);
  - synthetic reference media: 0 objects and 0 listing images;
  - the u3 tombstone is present and its row hash is unchanged;
  - the retained escrow is present and its hash is unchanged;
  - pre-existing audit rows are byte-identical in every window.
- **Commerce and delivery:**
  - UAT vehicles left live in public commerce: 0. Two proof drafts and the interim tablet draft are not public.
  - Public evidence created: 0.
  - Message-delivery attempts started: **0**.
  - Every new notification is queued and in-app only.
- **Every new row is classified:**
  - **APPEND_ONLY**: `diaspora_import_audit_log` 74, `domain_events` 73, `evidence_provenance_events` 20, `trust_audit_events` 397
  - **TELEMETRY**: `intelligence_ingestion_stats` 3, `marketplace_activity_events` 338, `navigation_analytics_events` 274
  - **UAT_FIXTURE**: `communication_reconciliation_work` 20, `diaspora_cargo_reservations` 8, `diaspora_container_shipments` 6, `diaspora_import_order_request_lines` 2, `diaspora_import_orders` 8, `diaspora_import_quotes` 2, `diaspora_payment_milestones` 12, `diaspora_stock_items` 6, `diaspora_stock_ledger` 6, `listing_images` 78, `marketplace_inquiries` 12, `notification_queue` 18, `referral_events` 12, `storage.objects` 98, `user_sessions` 320, `users` 14, `vehicle_evidence` 20, `vehicle_taxonomy_observations` 6, `vehicles` 20
- **Attribution.** All 14 new users are on `@carup-staging.test`. Container shipments come only from `u_tradeos_operator` and reservations only from participants A and B, all in Hikari.

## 8. Receipts

- **Issued:** 17 receipts. Each cites the final SHA: the code SHA for SOURCE, the deploy SHA otherwise.
  - **SOURCE:** PASSPORT, GEMMA, ADVISORY, HARNESS (now including C2 and J2), PROOF-HARNESS.
  - **DEPLOYED:** CANDIDATE, HEALTH, QWEN, ODOMETER, GEMMA, ADVISORY, SELLER-HOME, PASSPORT, ACTIVE-TENANT.
  - **LIVE:** GEMMA, ADVISORY, QWEN.
- **Ladder cells moved:**
  - `seller.home_lifecycle` DEPLOYED → PASS.
  - `owner.vehicle_passport_identity` SOURCE and DEPLOYED → PASS.
  - `ai.general.gemma_gateway` LIVE and DEPLOYED → PASS.
  - `marketplace.ai_advisory` LIVE and DEPLOYED → PASS, scoped to the buyer assistant.
  - `service_network.active_tenant_context` DEPLOYED → PASS.
- **Not earned:**
  - D7, and any Trade OS notification or communications cell.
  - OCR accuracy.
  - Every OWNER-UAT cell.
- **History preserved.** REL-01's receipts, record and report are unchanged.

## 9. Production untouched

- **Vercel.** No production-target deployment was made. No stable alias moved, and neither did the REL-01 aliases.
- **Domains.** `carup.dev` and `api.carup.dev` were not touched.
- **Database.** The production Supabase project was never contacted.
- **Environment.** No variable was changed in REL-02. In particular `SUPABASE_DB_URL` was **not** restored to Preview.

## 10. Remaining blockers to Owner UAT

1. **Staging secret custody (D7), the one exact blocker.**
   - **What fails.** The candidate backend's Preview target has no `COMMUNICATION_WORKER_SECRET` (or `CRON_SECRET`), so `POST /api/internal/events/process` answers **401** to the GitHub staging secret `TRADEOS_WORKER_SECRET`. On this preview, Trade OS booking events are therefore never turned into in-app notifications.
   - **Who decides.** Only the owner can supply the worker secret to the preview runtime (for example deployment-scoped at the next deploy), with custody of its value.
   - **What this run did not do.** It added no secret and rotated none.
2. **D7 is not scoped to its own run.** It passes on any historical `container_booking` notification. Scoping it to the run's reservation is a harness change that needs moderator authorisation, because D7 was to run unchanged.
3. **Not provisioned.** The Kingstone staging credentials (spec 43, 3 tests) and the T3 fixtures (spec 47, 2 tests) are missing, so those tests skipped.
4. **Owner decisions still open:**
   - Seller Q (Communications) stays fixme until owner decision D.
   - Qwen accuracy is not claimed, and the 11-fixture gate has not been run.
   - The stale `CLOUDFLARE_TOKEN` should be removed from the production target.
5. **Undrained events.** This run's staging events remain undrained in `domain_events`. If a staging worker drains them later, the deployment that drains them decides whether its outbound kill switch applies.
6. **Owner UAT.** Only the Product Owner can perform and record it. Nothing here claims it.

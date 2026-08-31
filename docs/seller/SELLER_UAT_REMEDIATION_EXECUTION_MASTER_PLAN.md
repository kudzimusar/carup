# Seller UAT Remediation — Master Execution & Roll-Call Plan

**Status:** ACTIVE — authoritative execution tracker  
**Repository:** `kudzimusar/carup`  
**Integration authority / merge target:** `integration/vehicle-passport-v16-cert` / Draft PR #194  
**Seller implementation lane:** `fix/seller-uat-convergence-remediation` / Draft PR #202  
**Master synchronized into implementation lane:** merge commit `2639ba01cabd75630c64bdf7b019333e7309ddcb` via non-main sync PR #204  
**Tracker creation ancestor:** `43204beeec40123b0cce0c457aded6d0f733c4bc`  
**Forensic pre-remediation baseline:** `106f76509ae1d1d10a3c4a26b4f93f7993d55027`  
**Primary owner UAT vehicle:** `UAT20260828SELL01` — 2021 Toyota Hilux, USD 23,000, expected `publication_status=draft`  
**Owner UAT account under reconciliation:** `buynsellpvtltd@gmail.com`  
**Governing design law:** root `DESIGN.md`  
**Existing convergence plan:** `docs/seller/SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md`  
**Marketplace visual extension:** `docs/marketplace/MARKETPLACE_VISUAL_DNA.md`

---

## 0. Authority, operating rule, and non-stop execution protocol

This file is the **single operational roll-call tracker** for the Seller UAT remediation programme. It does not replace `DESIGN.md`, the Seller convergence plan, or Marketplace visual DNA; it converts them into a task-by-task execution ledger that must be updated as work is completed.


### 0.0 Tracker bootstrap roll call

- [x] **BOOT-1. Master execution tracker created on the active #194 integration branch.**  
  **Evidence:** commit `e4401654888764c0c4683880070fe320599599bc`.
- [x] **BOOT-2. Existing Seller convergence plan bound to this tracker and corrected to the current #194 branch context.**  
  **Evidence:** commit `e3b2a9c957389a39a92b4123d48d3806abdebf23`.
- [x] **BOOT-3. Previous automated Seller PASS explicitly demoted to historical engineering evidence, not owner-facing Golden completion.**  
  **Evidence:** "Current programme roll call" in this tracker initializes every remediation phase as NOT STARTED and Phase S requires the full UI Golden journey.
- [x] **BOOT-4. Authoritative tracker and completed Phase A/B baseline evidence synchronized into the Seller implementation lane without rewriting prior remediation history.**  
  **Evidence:** sync PR #204 merged `integration/vehicle-passport-v16-cert@e02988aff867290b573767034d2a6be9237e0fc9` into `fix/seller-uat-convergence-remediation` at merge commit `2639ba01cabd75630c64bdf7b019333e7309ddcb`. The pre-existing 25 #202 commits remain ancestors and must be re-certified item-by-item before receiving master-plan credit.


### 0.1 Mandatory task-state notation

Every task below must carry one of these states:

- `[ ]` — not started / not proven
- `[~]` — actively in progress, not yet cleared
- `[x]` — cleared with evidence
- `[!]` — blocked by an external dependency or owner decision

A task **may not move to `[x]` merely because code was written**. It is cleared only when its acceptance evidence is recorded in this file.

### 0.2 Mandatory update cadence

For every cleared task:

1. execute the task;
2. run the task-specific gate;
3. update this file from `[ ]` or `[~]` to `[x]`;
4. add evidence beside the task: test, screenshot artifact, API proof, workflow run, commit SHA, or owner decision;
5. commit the tracker update together with the implementation when practical, or immediately after the implementation commit if the tool cannot atomically modify both;
6. re-read the next unchecked item in this file before proceeding.

**No phase may be declared complete while any required item inside it remains `[ ]`, `[~]`, or `[!]`.**

### 0.3 Non-stop execution rule

Once implementation begins, execute the phases continuously in order. Do **not** stop for routine progress reports, previews, or conversational summaries between tasks.

A stop is permitted only for:
- a true external blocker that cannot be resolved from the repository or connected tooling;
- a protected production/environment approval requiring the owner;
- a product decision explicitly marked `OWNER DECISION REQUIRED`;
- a safety/security issue where continuing would risk data or production integrity.

When blocked, mark the exact item `[!]`, record why, continue with every other independent item that can safely proceed, and stop only when no remaining independent work can continue.

### 0.4 No-skip roll-call rule

At the end of each phase, perform a **roll call**:
- read every item in the phase;
- confirm each required item is `[x]`;
- verify no acceptance criterion was weakened to make a test pass;
- verify no API shortcut substituted for a UI requirement;
- verify no seeded/reference vehicle substituted for the dynamic Seller journey;
- verify no "unavailable" state was accepted as proof of an event that should have been generated.

### 0.5 Evidence quality rule

Evidence must prove the intended contract, not merely a nearby technical condition.

Examples:
- A 1×1 PNG proves upload syntax, **not meaningful visual media**.
- An inquiry row proves durable inquiry capture, **not Communications convergence**.
- "Intelligence unavailable" proves truthful rendering, **not event instrumentation**.
- Direct API vehicle creation proves backend capability, **not Home → Sell → Seller Studio UAT**.
- A seeded Marketplace vehicle proves reference rendering, **not Seller-created parity**.


### 0.6 Source-plan coverage map — no orphan phases

This table is the mandatory roll call against the earlier `SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md`. It prevents a later agent from implementing only the defects most recently discussed in chat.

| Earlier convergence-plan requirement | Master tracker coverage |
|---|---|
| Phase 0 — freeze, baseline, parity audit | A + B |
| Phase 1 — navigation architecture | E1 |
| Phase 2 — Sell intent router | E2 |
| Phase 3 — canonical draft/resume | F |
| Phase 4 — media persistence/identity | G |
| Phase 5 — My Garage redesign | H |
| Phase 6 — My Listings redesign | I |
| Phase 7 — authenticated Seller Studio | J |
| Phase 8 — one buyer presentation component | K |
| Phase 9 — section-by-section dynamic parity | L |
| Phase 10 — Seller Intelligence visual upgrade | N |
| Phase 11 — Owner Dashboard convergence | O |
| Phase 12 — publication readiness / Marketplace transition | R + P |
| Phase 13 — Golden Dynamic Seller Journey | S |
| Unit/component/integration/E2E test strategy | S + T + U |
| Desktop/mobile visual regression | B + S + T |
| Exit criteria / exact-head / owner UAT | U + V + W |
| Truth & Trust / privacy / no fake data | M + permanent invariants |
| New gaps exposed by owner UAT: test-data isolation, account continuity, Featured/count semantics, Communications proof, Home resilience, tablet/accessibility | C + D + P + Q + T |

**Coverage rule:** if a requirement is added to `DESIGN.md`, the Seller convergence plan, Marketplace visual DNA, or an accepted owner UAT defect, this table and the task list must be updated before implementation can call that requirement in scope.


---

# PHASE A — Governance reset and frozen baseline

**Goal:** establish one trustworthy baseline and prevent further contamination before product changes.

- [x] **A1. Freeze current candidate for forensic baseline.** Record exact frontend SHA, backend SHA, staging project, PR #194 head, and current Marketplace public inventory count.
  - Acceptance: provenance values recorded here; no mutation required.
  - **Evidence:** forensic baseline frozen on pre-remediation exact head `106f76509ae1d1d10a3c4a26b4f93f7993d55027`. Frontend `dpl_758ugDwdTKYNQuUyCcXWeg5XeR6E` READY; `/carup-provenance.json` reports the exact SHA, branch `integration/vehicle-passport-v16-cert`, paired backend, `unpaired=false`. Backend `dpl_2exP3xuQNVZk7eNFqq2FX85BqvjM` READY; `/api/health` reports the same exact SHA, Supabase healthy, outbox backlog 0. `GET /api/marketplace/listings` returned `total=9` published listings on 2026-08-30. No runtime/data mutation was used to collect this evidence.

- [x] **A2. Capture the owner-reported UAT defects as a formal defect ledger.**
  - Must include:
    - `buynsellpvtltd@gmail.com` login failure;
    - old verification email not received;
    - owner UAT Hilux media absent;
    - Home hero blank media;
    - Vehicle Detail/gallery blank media;
    - Home "Eight useful next moves" media regression;
    - automated Hiluxes in Marketplace;
    - 13 public listing count discrepancy;
    - accidental/unclear featured semantics;
    - Trust 60/100 concern;
    - Sell intent chooser absent;
    - legacy Owner Dashboard;
    - My Garage / Evidence Vault navigation defect;
    - any other defects found during Phase B parity audit.
  - Acceptance: ledger is finite, uniquely numbered, and cross-linked to tasks below.
  - **Evidence:** `docs/seller/SELLER_UAT_REMEDIATION_BASELINE_DEFECT_LEDGER.md`, defects `SELL-UAT-001`…`SELL-UAT-020`; commit `9ec6247d0dba2391f10098b6289a5403576835e7`.

- [x] **A3. Protect the owner UAT specimen.**
  - `UAT20260828SELL01` must remain identifiable and must not be silently deleted, published, overwritten, or converted into automation data.
  - Expected current state: 2021 Toyota Hilux, USD 23,000, `draft`.
  - Acceptance: read-only proof of identity and state.
  - **Evidence:** read-only exact-head `GET /api/vehicles/UAT20260828SELL01/passport` on baseline `106f765...`: 2021 Toyota Hilux, USD 23,000, 45,000 km, Diesel/Automatic/AWD/Pickup, `publication_status=draft`, listing media `state=none`, canonical Trust `not_evaluated`, Vehicle Passport lifecycle present. The specimen was not mutated.

- [x] **A4. Protect the owner account under investigation.**
  - Do not recreate, delete, reset, or merge `buynsellpvtltd@gmail.com` until account-state diagnosis is complete and the owner approves any credential mutation.
  - Acceptance: account reconciliation procedure documented before mutation.
  - **Evidence:** protected-account procedure recorded in `docs/seller/SELLER_UAT_REMEDIATION_BASELINE_DEFECT_LEDGER.md` at commit `9ec6247d0dba2391f10098b6289a5403576835e7`: no delete/recreate/merge/reset before Phase D read-only diagnosis; preserve vehicle/listing/ownership relationships; owner approval required for non-self-service credential mutation.

- [x] **A5. Reconcile the old Seller convergence plan against this tracker.**
  - Every Phase 0–13 requirement in `SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md` maps to at least one task here.
  - Acceptance: no orphan requirement.
  - **Evidence:** §0.6 source-plan coverage map in this tracker; convergence plan cross-link commit `e3b2a9c957389a39a92b4123d48d3806abdebf23`.

### Phase A roll call
- [x] **A-RC. Phase A complete:** A1–A5 all `[x]`; no product behavior changed before baseline capture.
  - **ROLL CALL PASS:** baseline/provenance, finite defect ledger, protected UAT specimen, protected-account procedure, and source-plan mapping are all recorded. Phase A introduced documentation only; no application behavior, staging data, account, configuration, deployment policy, or `main` mutation was used to clear the gate.

---

# PHASE B — Full Seller ↔ Marketplace parity audit

**Goal:** complete the Phase 0 audit that should have preceded redesign and certification.

## B1. Baseline visual capture

Capture desktop, narrow/tablet, and mobile evidence for:

- [x] **B1.1 Home**
- [x] **B1.2 Marketplace**
- [x] **B1.3 Rich reference Marketplace Vehicle Detail**
- [x] **B1.4 Public/guest Sell**
- [x] **B1.5 Owner Dashboard**
- [x] **B1.6 My Garage**
- [x] **B1.7 Evidence Vault**
- [x] **B1.8 My Listings**
- [x] **B1.9 Authenticated Seller Studio**
- [x] **B1.10 Seller-created draft Buyer Preview / Vehicle Detail**
- [x] **B1.11 Communications Seller surface**
- [x] **B1.12 Seller Intelligence**
- [x] **B1.13 Verify / Passport entry for the Seller-created vehicle**

Acceptance for B1:
- screenshots/artifacts are from exact-head staging;
- desktop + narrow/tablet + mobile are represented;
- obvious blank media and legacy UI are preserved as evidence, not hidden.

## B2. Field/section parity matrix

For a rich reference VIN and `UAT20260828SELL01`, record:

- [x] **B2.1 Listing gallery / cover / carousel**
- [x] **B2.2 Make/model/year / identity**
- [x] **B2.3 Price / currency**
- [x] **B2.4 Mileage / fuel / transmission / drivetrain / body style / condition**
- [x] **B2.5 Seller description / features**
- [x] **B2.6 Seller identity and seller type**
- [x] **B2.7 Location / privacy projection**
- [x] **B2.8 Canonical Trust**
- [x] **B2.9 Trust confidence / source coverage**
- [x] **B2.10 Government/partner checks**
- [x] **B2.11 Registration / plate / identifier state**
- [x] **B2.12 Evidence state**
- [x] **B2.13 Lifecycle/history**
- [x] **B2.14 Ownership**
- [x] **B2.15 Service**
- [x] **B2.16 PartSentry**
- [x] **B2.17 Insurance**
- [x] **B2.18 Pricing/cost estimate**
- [x] **B2.19 Inquiry**
- [x] **B2.20 Reservation/SafePay readiness**
- [x] **B2.21 Save**
- [x] **B2.22 Compare**
- [x] **B2.23 Share**
- [x] **B2.24 Recommendations/related vehicles**
- [x] **B2.25 Publication state**
- [x] **B2.26 Missing / pending / unavailable design state**

Parity-matrix columns must include:
`capability/section | reference VIN | UAT VIN | canonical source | seller-stated/governed/computed/private | expected missing state | component | gap | severity | owner decision if any`.

- [x] **B2.27 Commit parity matrix to repository.**
  - **Evidence:** `docs/seller/SELLER_MARKETPLACE_BASELINE_PARITY_AUDIT.md`; frozen runtime `106f76509ae1d1d10a3c4a26b4f93f7993d55027`; reference `CARUPGLDNA0000001`; human UAT `UAT20260828SELL01`; commit `cce9a059d6ab14700f991824612a83bc97a7786d`. B2.1–B2.26 are audited row-by-row there.

### Phase B roll call
- [x] **B-RC. Phase B complete:** every B1/B2 item is `[x]`, and no redesign proceeds based on memory alone.
  - **Evidence:** workflow run `33307316382`, job `99246029931`, artifact `9730920923`, digest `sha256:e1d605dc88784c1422bca5699a975fc82c90c919393b258d86c678eb043157b3`; 39 screenshots = 13 required surfaces × desktop/tablet/mobile; receipt `docs/seller/SELLER_PHASE_B_VISUAL_BASELINE_RECEIPT.md`; field parity audit `docs/seller/SELLER_MARKETPLACE_BASELINE_PARITY_AUDIT.md`.
  - **ROLL CALL PASS:** every B1/B2 item is evidenced. Known baseline invariant violations (notably automation contamination and duplicate Garage/Evidence navigation) are preserved as defects assigned to later phases; this audit introduced no new product behavior and did not weaken acceptance criteria.

---

# PHASE C — UAT environment integrity and automated-test isolation

**Goal:** human UAT must not be contaminated by automated Golden vehicles or meaningless test media.

- [x] **C1. Inventory all automation-created Seller vehicles currently visible in staging.**
  - Identify by VIN pattern, creation source/run, publication state, lifecycle state, media, and owner account.
  - **Evidence:** backend/services/marketplace/marketplaceClassificationRules.js:110 (SELLER_AUTOMATION_DESCRIPTION_RE marker) + .github/workflows/seller-exact-head-staging-uat.yml:258-316 'Audit Seller automation inventory after run' queries public.vehicles LEFT JOIN listing_images grouped by vin/publication_status/status/created_at/seller_description, extracts run_marker via regex, computes media_count. Executed live at audited HEAD 823b6e8a in GH Actions run 33345485423 (job 99348674175, step passed): output {"total_automation_records":36,"public_automation_records":0}.
  - **Note:** Real, currently-executing inventory query against live staging DB, not just code-reading. One gap vs the literal ask: 'owner account' is reported as a hardcoded literal owner_class:'staging-synthetic-seller' per row, not a per-row lookup of the real owner_id/email — acceptable in practice because all automation vehicles are created under one known fixed staging seller (uat.buyer@carup-staging.test), but the script itself doesn't surface that identity per-row.

- [x] **C2. Explain the current Marketplace count semantically.**
  - Distinguish public listings, draft vehicle identities, sold/retired, seeded references, automation records, and human UAT vehicles.
  - **Evidence:** .github/workflows/seller-exact-head-staging-uat.yml:318-398 'Explain Marketplace population semantics' computes vehicle_identities_total, live_public_rows_total, live_public_discovery_eligible, live_public_automation, live_public_other_fixtures, draft_or_nonpublic, sold_or_retired and asserts API total == DB eligible count. Live output at HEAD 823b6e8a (run 33345485423): {"public_discovery_api_total":9,"live_public_discovery_eligible":9,"live_public_automation":0,"live_public_other_fixtures":18,"draft_or_nonpublic":6,"sold_or_retired":42,"owner_uat_publication_status":"draft"} — step passed, semantics explicitly enumerated in receipt.semantics.
  - **Note:** This is a genuine, executed reconciliation against production-shaped staging data, distinguishing every category the tracker asks for.

- [x] **C3. Define automation-data isolation policy.**
  - Choose one governed strategy:
    1. dedicated automation namespace/environment, or
    2. hard exclusion from human discovery/Home/featured surfaces, plus
    3. deterministic cleanup/retirement in `finally`/teardown.
  - Acceptance: interrupted/failed tests cannot leave public stock behind.
  - **Evidence:** Hard-exclusion (option 2): getFixtureExclusion (marketplaceClassificationRules.js:110-135) + filterVisibleVehicles (backend/services/marketplace/listingSummaryService.js:1016-1035), wired into every marketplace read path: listingSummaryService.js:1310, marketplaceDiscoveryService.js:82, marketplaceSavedService.js:93, marketplaceListingDetailService.js:182. Preview-only reveal gated by backend/routes/marketplaceRoutes.js:42-47 (fixture_scope only honored when NODE_ENV==='test' or VERCEL_ENV==='preview', never in production). Deterministic cleanup (option 3): pre-run retireStaleAutomationVehicles (tests/agents/38-seller-staging-browser-golden.spec.ts:164-186) plus a finally-block retirement (:648-655). Direct unit test backend/tests/marketplace-listing-summary.test.js:573-583 'Seller automation fixtures stay hidden unless the exact preview run scope is requested' — ran locally via `node --test backend/tests/marketplace-classification-rules.test.js backend/tests/marketplace-listing-summary.test.js`: 39/39 pass.
  - **Note:** Both governed strategies from the plan (dedicated exclusion + deterministic teardown) are implemented together, not just one. The teardown half's live reliability is graded separately under C4, where a concrete gap was found.

- [~] **C4. Implement deterministic Golden Seller teardown.**
  - Every created vehicle must end non-public and retired even on assertion failure where cleanup can safely execute.
  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:648-655 finally-block, gated on a vehicleCreated flag, calls retireAutomationVehicle (unpublish + status=sold + verify absence from /marketplace/listings, tolerant of 200/404). Live counter-evidence at the exact audited HEAD: GH Actions run 33345485423 (job 99348674175, 2026-08-31, conclusion=failure) shows all three projects (chromium/tablet-chromium/mobile-chromium) each consumed ~3 minutes and were killed by the 180s test.setTimeout; for chromium and tablet-chromium the final captured stack frame is *inside this exact finally block* at spec.ts:652 (`mutationHeaders` call), failing with 'apiRequestContext.get: Target page, context or browser has been closed' — i.e. the safety-net cleanup call itself did not return before forced termination in this run.
  - **Gap:** The post-run DB audit still showed 0 public automation records this run, but that traces to the try-block's own explicit unpublish/mark-sold steps (spec.ts:634-638) already having completed for 2 of 3 vehicles, and the 3rd (mobile-chromium) never having been published before it failed elsewhere (see C7). So the finally-block safety net was never actually observed to complete successfully when the run reached it — its behavior for the scenario it exists to cover (failure occurring AFTER publish but BEFORE the manual unpublish/sold steps) is unproven and the one live sample we have shows it stalling rather than finishing. Root cause (staging load/rate limiting vs a logic defect) is not established here. Downgraded from 'x' to '~' on this direct, same-commit evidence.

- [x] **C5. Remove or retire leaked automation listings through a governed cleanup path.**
  - Preserve auditability; do not disguise them as owner-created records.
  - Acceptance: human UAT Marketplace count no longer includes leaked automation stock.
  - **Evidence:** Same live receipts as C1/C2: public_automation_records=0 and live_public_automation=0 at audited HEAD. Retirement happens via real state transitions (unpublish + status='sold'), not deletion, and rows keep their 'Golden Dynamic Seller ...' seller_description marker (never disguised as owner-created). Workflow step 'Upload Seller deployed-UAT evidence' (if: always()) uploads test-results/seller-automation-inventory.json and seller-marketplace-population-semantics.json as a retained CI artifact (artifact 'seller-exact-head-staging-uat-33345485423-1' confirmed present via `gh run view`).
  - **Note:** Cleanup is governed (goes through the same production API endpoints as a real seller would use) and auditable (JSON receipts retained as CI artifacts), and the current live state has zero leaked public automation stock.

- [x] **C6. Replace 1×1 PNG as the human-facing visual certification fixture.**
  - Technical upload tests may retain tiny fixtures in unit/integration scope.
  - Browser visual certification must use meaningful multi-image fixtures with valid dimensions.
  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:44-56 defines VISUAL_TEST_PNGS: 7 distinct 320x180 PNG data-URIs, uploaded together as the vehicle's photo set at :242 (`images: VISUAL_TEST_PNGS`), confirmed rendered as 7 thumbnails via the `listing-media-thumb` count assertion at :388. A separate, deliberately tiny EVIDENCE_TEST_PNG (:59-60) is used only for the unrelated evidence-document upload at :434, matching the plan's explicit carve-out that technical/evidence fixtures may stay minimal.
  - **Note:** The 1x1 PNG is gone from the human-facing visual-certification path; the only remaining tiny fixture is correctly scoped to a non-visual, technical evidence-transport upload.

- [~] **C7. Add media-quality acceptance.**
  - Minimum decoded dimensions;
  - non-zero intrinsic dimensions;
  - visible rendered area;
  - image load success;
  - cover crop is meaningful;
  - gallery navigation actually changes images.
  - **Evidence:** expectMeaningfulRenderedImage (spec.ts:188-207) asserts node.complete && naturalWidth>=64 && naturalHeight>=40 — real decoded-dimension and load-success checks. Gallery-change assertions exist at spec.ts:396-411 (next/previous/thumbnail all assert primaryImage src changes then restores). BUT live CI at the exact audited HEAD (run 33345485423, job 99348674175) shows the mobile-chromium project FAILING at spec.ts:401 with `TimeoutError: locator.tap: Timeout 20000ms exceeded` on the 'Next photo' button — Playwright's action log shows repeated pointer-event interception by `<nav data-testid="compact-bottom-nav">` (web/src/components/layout/CompactBottomNav.tsx:41, `fixed inset-x-0 bottom-0`) and the Vercel preview feedback widget. The button itself (web/src/pages/VehicleDetail.tsx:1883-1890, `absolute right-4 top-1/2`) sits inside the tall image container, and on a true mobile viewport its vertical midpoint lands under the fixed bottom nav, making it untappable. Desktop (chromium/click) and tablet (tablet-chromium/tap) in the same run got past this same line (their failures trace only to a later cleanup step, see C4), so this reads as mobile-viewport-specific.
  - **Gap:** This is a real, current, previously-undocumented product defect surfaced by this audit via a live same-commit CI failure, not a hypothetical gap: gallery navigation does not reliably work on mobile right now. 'Cover crop is meaningful' and pixel-level 'visible rendered area' beyond bounding-box visibility have no dedicated assertion either. Because several sub-criteria (decoded dimensions, load success, desktop/tablet nav) are genuinely proven, but the mobile nav criterion is actively failing, this is graded '~' rather than 'x' or blank.

- [x] **C8. Prevent automation listings from becoming Home hero/featured inventory.**
  - Acceptance: Home cannot select automation fixtures as editorial/live showcase material.
  - **Evidence:** web/src/pages/Landing.tsx (the actual '/' Home route per web/src/App.tsx:247) sources its hero/live-showroom vehicles exclusively via `fetchMarketplaceListings` (Landing.tsx:168), which calls the same public listings service (backend/services/marketplace/listingSummaryService.js:1310) that runs every row through filterVisibleVehicles — excluding anything matching SELLER_AUTOMATION_DESCRIPTION_RE by default. Directly unit-tested: backend/tests/marketplace-listing-summary.test.js:573-583 (verified passing locally, 39/39 in the file). No separate/bypassing data source for Home was found. Landing.tsx:182-185 code comment states this explicitly: '...Automated fixtures are also retired by the Seller staging harness and must never be allowed to define this surface.'
  - **Note:** web/src/pages/Home.tsx is dead Vite scaffold code, unreferenced in App.tsx routing — Landing.tsx is the real Home surface, and it shares the exact same fixture-exclusion choke point as Marketplace.

- [x] **C9. Define and implement "Featured" semantics.**
  - OWNER DECISION REQUIRED only if product policy is not already documented.
  - Distinguish newest from featured.
  - UI must not imply editorial endorsement merely because a listing is newest.
  - **Evidence:** web/src/pages/Landing.tsx:166-188 selects the hero purely by `sort: 'newest'` from the public listings API and picks the first entry with renderable media — no separate 'featured' flag exists anywhere in the schema/UI. UI copy at Landing.tsx:311 reads 'Live from Marketplace · published inventory', not 'Featured'. Code comment at :182-185 explicitly documents 'This is a live showroom, not an editorial featured award.' The CI workflow encodes the same governed policy as an auditable field: .github/workflows/seller-exact-head-staging-uat.yml:374 `featured_policy: 'Home live showroom is newest eligible published inventory, not editorial Featured endorsement'`.
  - **Note:** Because automation fixtures are excluded from the underlying feed entirely (C8), they cannot appear in this newest-first showroom either, so 'automated fixtures cannot become Featured' is satisfied by construction rather than by a separate rule.

- [x] **C10. Clarify count labels in UI.**
  - Marketplace count must state what it counts (for example, published listings), not ambiguous "vehicles" if that can be confused with total vehicle identities.
  - **Evidence:** web/src/pages/Marketplace.tsx:986-996 — heading 'Published vehicles', the count itself renders as '{N} published listing(s)' (data-testid="marketplace-results-count"), with subcopy 'Published listings only · Trust and vehicle facts retain their governed states.'
  - **Note:** Matches the tracker's own example fix ('published listings' instead of ambiguous 'vehicles').

### Phase C roll call
- [~] **C-RC. Phase C complete:** no automation leakage, no 1×1 visual certification, counts are semantically accurate, Featured has a governed rule.

  - **Evidence:** 8 of 10 sub-items (C1,C2,C3,C5,C6,C8,C9,C10) have strong, largely live-verified evidence of no leakage, no 1x1 fixture, semantically accurate counts, and a governed Featured rule. However the CI gate whose job is specifically to certify this journey — 'Seller Exact-Head Staging UAT' — FAILED at the exact audited commit 823b6e8a (GH Actions run 33345485423, conclusion=failure, https://github.com/kudzimusar/carup/actions/runs/33345485423), due to a real, previously-undocumented mobile gallery-navigation defect (C7) plus an unproven cleanup-safety-net path (C4).
  - **Gap:** Declaring Phase C fully complete would be premature while its own certifying gate is red on the audited commit for reasons squarely inside Phase C's scope (media/gallery certification, teardown determinism). Recommend fixing the mobile gallery-button z-index/layering issue and re-verifying the finally-block cleanup path completes promptly before marking C-RC 'x'.
---

# PHASE D — Account continuity, authentication, registration, and Seller identity

**Goal:** a real existing or new Seller account must survive the journey without being silently orphaned.

## D1. Existing account reconciliation

- [x] **D1.1 Diagnose `buynsellpvtltd@gmail.com` read-only before mutation.**
  - Determine whether the account exists;
  - whether it has a valid current password hash;
  - whether it is a legacy passwordless account;
  - registration date/source;
  - verification state;
  - registration profile state;
  - existing user/session/vehicle relationships;
  - whether login failure is wrong password vs missing/incompatible credential state where safely diagnosable.
  - **Evidence:** CI run 33345485622 (.github/workflows/seller-phase-d-account-diagnostic.yml, read-only BEGIN READ ONLY ... ROLLBACK transaction against staging) downloaded via `gh run download` and inspected at test-results/seller-account-diagnostic.json: {account_exists:true, credential_state:'current_scrypt_password', email_verified:false, registration_profile:null, linked_vehicle_count:1 (VIN UAT20260828SELL01, publication_status:draft), sessions:{total:3,valid:1}, auth_action_tokens:[], auth_notifications:[], mutation_performed:false}. This directly answers: exists (yes), valid current hash (yes, scrypt), legacy-passwordless (no), verification state (unverified), registration profile state (none), existing relationships (1 vehicle, 3 sessions). Workflow is wired and has run successfully 10+ times on this PR.
  - **Note:** Two sub-asks are only partially answered: 'registration date/source' gives join_date (2026-08-28) but no distinct 'source' field exists in the schema to query; 'wrong password vs missing/incompatible credential state' is narrowed (credential exists in current format, ruling out missing/legacy) but cannot be fully resolved without a live login attempt, which is correctly out of scope for read-only diagnosis. Also: the master tracker doc (SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md) still shows this item unchecked with 'Evidence: TBD' — the real evidence exists in CI but has not been written back into the tracker, so per the ledger's own closure rule this would not yet be considered 'closed' procedurally even though the technical diagnosis is real and sound.

- [~] **D1.2 Reconcile pre-upgrade login behavior.**
  - Confirm why earlier deployment already returned 401 for this account.
  - **Evidence:** Same diagnostic artifact (run 33345485622) shows credential_state='current_scrypt_password' (not 'legacy_passwordless' or 'unsupported_legacy_hash'), which rules out a hash-format/legacy-incompatibility explanation for any earlier 401. backend/utils/passwordAuth.js:59-73 evaluateLoginCredentials confirms a stored hash always requires the matching password, in every NODE_ENV. Checked docs/seller/*.md and `gh pr view 202 --json comments` for a written reconciliation — none exists.
  - **Gap:** The raw material to answer 'why did the earlier deployment return 401' now exists (a valid current-format password hash is on file), which points toward 'wrong password entered' rather than 'incompatible credential state', but no one has actually written down that conclusion anywhere (tracker still 'Evidence: TBD', no PR comment, no doc). This is an inference I can make from the data, not a documented reconciliation the task performed.

- [~] **D1.3 Define safe recovery path.**
  - No account duplication.
  - No ownership/listing loss.
  - No credential mutation without owner approval if required.
  - **Evidence:** docs/seller/SELLER_UAT_REMEDIATION_BASELINE_DEFECT_LEDGER.md:60-70 'Protected account procedure' already states the required rules (no delete/recreate/merge, no credential mutation to force UAT pass, preserve vehicle/listing/ownership relationships, owner approval required for non-self-service credential mutation, use the governed recovery path once proven). backend/routes/authRecoveryRoutes.js forgot-password/reset-password (verified working, see D2.4) is a mechanism that satisfies this without any account mutation, duplication, or ownership loss.
  - **Gap:** The definition text is real but was written earlier (baseline-ledger commit, cited elsewhere in the tracker as Phase-A-adjacent evidence) rather than freshly produced as a D1.3-specific deliverable synthesizing the D1.1 diagnosis into a concrete recovery decision for this account. No doc states 'given credential_state=current_scrypt_password, the recovery path for this account is X.' Tracker still unchecked with no Evidence line for D1.3.

## D2. Email verification and recovery

- [~] **D2.1 Verify registration email dispatch path end-to-end.**
  - **Evidence:** backend/server.js:2278-2302 calls createAuthEmailService({...}).issueEmailVerification() from POST /api/auth/register. backend/tests/auth-email-service.test.js:54-76 (passing, ran via `node --test`) unit-tests issueEmailVerification/queueAuthEmail with injected notificationService/deliveryWorker/tokenService and asserts channel='email', classification='security', priority='high', action_url shape. Running backend/tests/auth-register-privilege.test.js live showed this code path actually executing through the real HTTP /api/auth/register route (console output: '[auth] registration verification Email could not be dispatched: communication_templates lookup failed...') and registration still succeeding, matching the documented graceful-degradation design.
  - **Gap:** No test asserts the `email_verification` field returned in the actual /api/auth/register HTTP response (auth-register-privilege.test.js does not check it). So the service-level contract is well tested and the route wiring is directly observed/traced, but there is no single assertion proving the full dispatch path end-to-end through the live endpoint.
- [~] **D2.2 Verify resend-verification path.**
  - **Evidence:** backend/routes/authRecoveryRoutes.js:202-237 implements resend-verification with anti-enumeration (identical response for unknown/verified/unverified). I wrote and ran an ad hoc probe (backend/__probe_recovery_routes.mjs, executed then removed) mounting the real authRecoveryRouter with fake db/tokenService/services and POSTing to /api/auth/resend-verification — returned 200 {success:true} as designed.
  - **Gap:** No committed repo test drives this route directly at the HTTP level; only its collaborators (authActionTokenService, authEmailService) are unit-tested elsewhere. My own executed probe is real but not a permanent regression test in the codebase, so this is downgraded from 'x' per the evidence-quality bar.
- [x] **D2.3 Verify email verification token/action route.**
  - **Evidence:** backend/tests/email-hardening-r1-welcome-durability.test.js — ran via `node --test`, 7/7 passing, including 'R1-DURABILITY the full adversarial sequence: verify, welcome fails, reconcile, exactly one' which mounts the real authRecoveryRouter on a live express app, does server.listen(0), POSTs to /api/auth/verify-email, and asserts response.status===200, response.body.success===true, and users[0].email_verified_at is set. Route wired at backend/server.js:310 via app.use(authRecoveryRouter()).
  - **Note:** This is a genuine committed HTTP-level test that exercises the exact route end-to-end, including a token-consume/replay check (R1-D3) and downstream durability guarantees.
- [~] **D2.4 Verify forgot-password / reset-password path.**
  - **Evidence:** backend/routes/authRecoveryRoutes.js:75-197 implements forgot-password (generic response regardless of account existence, equivalent-work timing) and reset-password (atomic token consumption, password_hash update, session invalidation, replay rejection). I wrote and ran an ad hoc probe against the real router: known-account forgot-password queued exactly 1 email; unknown-account forgot-password returned an identical response with 0 additional emails queued; reset-password with the issued token changed the stored password_hash and set sessions.is_valid=false; a replayed reset token was rejected with 400. backend/tests/auth-recovery-security.test.js (307 lines, all passing) exhaustively covers the underlying token-service, URL-building, and transport-routing contracts these routes depend on.
  - **Gap:** As with D2.2, no committed repo test drives POST /api/auth/forgot-password or /api/auth/reset-password directly; my own executed probe substantiates the route logic works correctly but is not part of the permanent test suite.
- [x] **D2.5 Verify delivery failure is surfaced truthfully, not presented as "sent".**
  - **Evidence:** backend/services/auth/authEmailService.js:47-61 (immediate-dispatch-with-truthful-failure design) + backend/tests/auth-email-service.test.js:78-92 'immediate auth delivery failure is returned truthfully and never relabelled as sent' (passing) asserts delivery.status==='delivery_failed' and errorCode==='auth_immediate_dispatch_failed' rather than 'sent'. web/src/pages/auth/Register.tsx:222-228 renders three genuinely distinct, non-overlapping messages keyed off emailStatus ('sent' / 'queued' / else 'CarUp could not confirm delivery ... Use the resend button below') — never a blanket 'email sent' claim.
  - **Note:** Both the backend truthful-status contract and the frontend truthful-rendering are directly verifiable in source and backed by a passing unit test on the backend side.
- [x] **D2.6 Verify auth email delivery does not depend on unavailable worker semantics in preview.**
  - **Evidence:** backend/services/auth/authEmailService.js:46-61 comment+code: 'Security Email cannot rely on a periodic worker in serverless previews... that exact row is dispatched now' — calls deliveryWorker.deliverNotification(queued.notification) synchronously inline. backend/tests/auth-email-service.test.js:54-76 'auth Email enters the canonical queue and is immediately delivered in preview/serverless semantics' (passing) asserts h.delivered.length===1 and result.delivery.status==='sent' without any worker/cron dependency.
  - **Note:** Directly matches the item's requirement; a specific test asserts exactly this contract.
- [x] **D2.7 Verify mailbox verification remains distinct from KYC/ownership/Trust.**

## D3. Seller identity model

  - **Evidence:** backend/routes/authRecoveryRoutes.js:252-254 shows verify-email only sets users.email_verified_at. `grep -rn email_verified_at backend/routes backend/middleware backend/server.js` shows it referenced nowhere else in the codebase (not used to gate vehicle creation, KYC, ownership, or Trust routes). backend/tests/email-hardening-r1-welcome-durability.test.js proves verification succeeds (200, email_verified_at set) even when the downstream welcome/notification pipeline is fully down ('ACCOUNT CORRECTNESS IS NOT COUPLED TO EMAIL AVAILABILITY'). web/src/pages/auth/Register.tsx:463-467 states explicitly in UI copy: 'Vehicle ownership, identity/KYC, Dealer or Exporter approval remain governed workflows and are never implied by this form.'
  - **Note:** Strong convergent evidence: code shows no coupling, a passing test proves independence from the notification pipeline, and the UI states the separation explicitly to the user.
- [x] **D3.1 Preserve public-registration least privilege.**
  - Public signup cannot self-assign dealer/admin/mechanic/etc authorization roles.

  - **Evidence:** backend/server.js:2184-2213 PUBLIC_REGISTRATION_ROLE allowlist rejects any role other than omitted/'owner' before any DB write. backend/tests/auth-register-privilege.test.js — ran via `node --test`, 12/12 passing, driving the real server.js over real HTTP, including 'every privileged role is rejected and creates NO user and NO session' (loops admin/government/bank/insurance/dealer/mechanic, asserts 0 user rows and 0 session rows after each rejection) and 'tenant / stakeholder headers cannot elevate registration' (x-stakeholder-role/x-tenant-id/x-user-id headers do not bypass the allowlist).
  - **Note:** This is the strongest-evidenced item in the phase: a real end-to-end HTTP test against the actual server.
- [x] **D3.2 Define individual Seller profile semantics.**
  - **Evidence:** backend/services/auth/registrationProfileService.js:63-78 builds the profile object with no 'role' key. backend/tests/auth-registration-profile.test.js:9-27 'individual Diaspora profile is context, not a platform role' (passing) asserts profile.onboarding_status==='not_required', profile.business_type===null, and `'role' in result.profile === false`.
  - **Note:** Direct assertion of the exact semantic the item requires.
- [x] **D3.3 Define dealer/business/exporter Seller profile semantics.**
  - Business identity is profile/onboarding, not self-granted authorization.
  - **Evidence:** backend/services/auth/registrationProfileService.js:52-57,63-76 requires organization_name+business_type for 'business' accounts and sets onboarding_status='requested' (never a role). backend/tests/auth-registration-profile.test.js:29-47 'business Dealer/Exporter intent requests governed onboarding and grants no role' (passing) asserts onboarding_status==='requested' and `'role' in profile === false` for both dealer and exporter. backend/tests/auth-registration-profile.test.js:92-99 'registration profile migration is backend-writable and public-client closed' (passing) confirms RLS FORCE + REVOKE ALL FROM anon,authenticated + GRANT ALL TO service_role on database/migrations/20260829123000_user_registration_profiles.sql.
  - **Note:** Covers both the semantic (profile not authorization) and the storage-security contract (public clients cannot self-write privileged profile rows).
- [~] **D3.4 Verify Seller journey for private owner.**
  - **Evidence:** backend/server.js:2187,2208 assigns role='owner' unconditionally on public registration. backend/routes/vehiclesRoutes.js:96,210,260,294,347 shows authorizeRole(['owner', ...]) granting 'owner' full publish/unpublish/price-change/status-change/seller-claim capability with no additional escalation required. backend/tests/auth-register-privilege.test.js confirms owner registration + session + working /api/auth/me end-to-end.
  - **Gap:** Strong corroborating evidence that a private individual can register and immediately act as a full Seller without role escalation, but no single dedicated test walks a complete 'private-owner Seller journey' (register -> create vehicle -> publish) within this branch; the pieces are proven separately, not as one journey.
- [ ] **D3.5 Verify governed path for business/dealer Seller onboarding or explicitly document deferred scope.**
  - **Evidence:** grep across backend/ for 'user_registration_profiles' shows only one write site: the INSERT at registration (backend/server.js:2242). No admin/review route reads, lists, or updates onboarding_status anywhere in backend/routes/. backend/scripts/seller-registration-profile-staging.mjs:82 shows the DB CHECK-constraint vocabulary already anticipates 'in_review'/'approved'/'rejected' states, but nothing in the codebase ever transitions a profile into them. Searched docs/seller/*.md for 'deferred' — no mention of this being explicitly out of scope.
  - **Gap:** The item explicitly allows either 'verify a governed path' or 'explicitly document deferred scope' — neither condition is met. A business/dealer registration is captured as a request but has no way to ever be reviewed, approved, or converted into actual privileged access, and this gap is not acknowledged anywhere as intentionally deferred.
- [~] **D3.6 Keep "vehicle new to CarUp" separate from commercial "new/used" condition.**

  - **Evidence:** web/src/components/sell/SellIntentRouter.tsx:102 ('A vehicle new to CarUp is different from a seller saying the vehicle condition is "New"'), web/src/pages/dashboard/owner/MyListings.tsx:274, and web/src/pages/dashboard/owner/MyGarage.tsx:132 all independently state this distinction in user-facing copy. No backend data-model field conflates the two concepts (searched for seller_intent/new_to_carup columns — none exist; the concept is UI-routing-only, and 'condition' is a separate vehicle attribute).
  - **Gap:** The distinction is made consistently and unambiguously across three separate UI surfaces I read directly, but no automated test asserts this specific contract, so it is downgraded from 'x' per the evidence-quality bar.
### Phase D roll call
- [ ] **D-RC. Phase D complete:** existing account is reconciled; new-account verification/recovery works; Seller identity model does not conflate authorization role with business profile.

  - **Evidence:** Aggregating the above: D1.1/D2.3/D2.5/D2.6/D2.7/D3.1/D3.2/D3.3 are genuinely 'x'; D1.2/D1.3/D2.1/D2.2/D2.4/D3.4/D3.6 are '~' (real but incompletely proven/documented); D3.5 is ' ' (no governed onboarding path and no deferred-scope documentation). docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md still shows every Phase D checkbox unchecked with 'Evidence: TBD' for D1.1-D1.3 and no Evidence lines at all for D2.*/D3.* — the tracker itself has not been updated with any of the real evidence that now exists in code/CI.
  - **Gap:** Phase D is NOT complete. Concretely blocking D-RC: (1) D3.5 has no governed dealer/business approval workflow at all, so 'Seller identity model does not conflate authorization role with business profile' is only half-true — profile capture is clean, but there is no path from profile to authorized access, governed or otherwise; (2) D1.2/D1.3 lack any written reconciliation/decision even though the diagnostic data to support one now exists; (3) several D2 items (D2.1/D2.2/D2.4) are proven only by my own ad hoc execution, not by committed regression tests, so they could regress silently. Additional hygiene finding: .github/workflows/seller-phase-d-auth-continuity.yml's path-trigger list references 'web/src/pages/Register.tsx', 'Login.tsx', 'ForgotPassword.tsx', 'ResetPassword.tsx', 'VerifyEmail.tsx' at the top level, but these files have always lived under web/src/pages/auth/ (confirmed via git log --follow and git log --diff-filter=A) — the path filter has never matched and would not by itself trigger this gate on a frontend-only change to those files (it has still run successfully on this PR because backend paths also changed).
---

# PHASE E — Navigation architecture and Sell intent router

**Goal:** global Sell resolves intent before a user is forced into a blank form.

## E1. Navigation

- [x] **E1.1 Give My Garage and Evidence Vault distinct navigation semantics.**
  - Preferred: `/dashboard/garage` and `/dashboard/evidence`, or remove Evidence Vault as a duplicate top-level intent and make it explicitly vehicle-scoped.
  - **Evidence:** web/src/config/featureRegistry.ts:300-319 defines distinct dashboard items 'owner.garage' (route /dashboard/garage) and 'owner.evidence-vault' (route /dashboard/evidence, domain 'evidence'); web/src/App.tsx:328-329 registers both routes separately. EvidenceVault.tsx (web/src/pages/dashboard/owner/EvidenceVault.tsx:69-121) is genuinely vehicle-scoped: it lists per-vehicle evidence workspaces and its actions link into /dashboard/garage/:id (lines 108,113), and its empty state routes new-vehicle intent to /sell (line 64), not to a duplicate blank-vehicle form.
  - **Note:** Matches the tracker's 'preferred' resolution (distinct routes/semantics) rather than removal. No automated test asserts the two pages are non-duplicative, but reading both pages end-to-end shows clearly different purposes (vehicle list+lifecycle CTA vs. cross-vehicle evidence index).
- [x] **E1.2 Exactly one active sidebar destination at a time.**
  - **Evidence:** web/src/components/layout/DashboardLayout.tsx:158-160 computes isActive per sidebar item via exact route match or route-prefix match, explicitly excluding '/dashboard' from the prefix check so Overview doesn't co-activate. Directly asserted in a real staging E2E test: tests/agents/41-seller-phase-e-staging.spec.ts:60 and :66 assert `page.locator('nav a[aria-current="page"]')).toHaveCount(1)` on /dashboard/garage and /dashboard/evidence, run across desktop/tablet/mobile viewports (lines 4-8, 30).
  - **Note:** Direct, targeted assertion (not just a green workflow name) exercising exactly this contract on a live staging deployment.
- [~] **E1.3 Shared authenticated workspace header.**
  - breadcrumb/back/up;
  - object identity;
  - status;
  - one primary CTA.
  - **Evidence:** web/src/components/seller/SellerWorkspaceHeader.tsx:5-54 implements back link, object identity, status label and a single `primaryAction` slot. It is used in MyGarage.tsx, EvidenceVault.tsx, MyListings.tsx and SellVehicle.tsx (872-880) only. tests/agents/41-seller-phase-e-staging.spec.ts:59,65,69,73 verify `seller-workspace-header` is visible on those 4 routes on real staging across 3 viewports.
  - **Gap:** Real coverage exists for the 4 primary Seller workspace pages, but grep confirms zero usage of SellerWorkspaceHeader in VehicleProfile.tsx, ServiceHistory.tsx, InsuranceRecords.tsx, PartSentry.tsx, ReferralWallet.tsx, SavedCars.tsx, Communications.tsx, AIDashboard.tsx — so 'shared workspace header' is real but not uniformly adopted across the owner dashboard.
- [~] **E1.4 Every Seller sub-page can return to Seller/Owner Home.**
  - **Evidence:** SellerWorkspaceHeader.tsx:9-10 defaults `backHref='/dashboard'`, `backLabel='Seller / Owner home'`; staging E2E (tests/agents/41-seller-phase-e-staging.spec.ts:61) confirms the rendered link has href '/dashboard' on /dashboard/garage. DashboardLayout.tsx's persistent sidebar (rendered on every /dashboard/* route) always includes an Overview/home item, so returning home is always structurally possible.
  - **Gap:** The explicit per-page 'back to home' affordance is confirmed only on the 4 SellerWorkspaceHeader pages; ServiceHistory.tsx, InsuranceRecords.tsx and PartSentry.tsx have no in-page back/breadcrumb element at all (grep for ArrowLeft/backHref/SellerWorkspaceHeader returned nothing), relying solely on the persistent sidebar rather than a dedicated affordance as DESIGN.md §6.2 calls for.
- [~] **E1.5 Every vehicle page can return to My Garage.**
  - **Evidence:** web/src/pages/dashboard/owner/VehicleProfile.tsx:340 has an explicit `<Link to="/dashboard/garage">...Back to Garage</Link>`.
  - **Gap:** Confirmed by direct code read, but no automated test (unit or the staging spec) exercises this link; the staging spec never navigates to /dashboard/garage/:id. Downgraded from 'x' to '~' for lack of test evidence per the evidence bar.
- [x] **E1.6 Mobile drawer/back behavior preserves route and form state.**
  - **Evidence:** tests/agents/41-seller-phase-e-staging.spec.ts:72-83: on the mobile viewport (390x844), navigates to /dashboard/sell-vehicle, fills vehicle-make-input with 'Toyota', opens the mobile sidebar ('Open sidebar menu'), closes it ('Close sidebar menu'), then asserts the URL is still /dashboard/sell-vehicle AND vehicle-make-input still has value 'Toyota'.
  - **Note:** Direct, targeted assertion of exactly this contract, run against a real staging deployment.
- [~] **E1.7 Sidebar visual design converges with `DESIGN.md`.**

## E2. Sell intent router

For signed-in users, global Sell must first present:
1. **Sell a vehicle already in My Garage**
2. **Sell a vehicle CarUp already knows**
3. **Add a vehicle CarUp does not know yet**

For signed-out users:
1. identify a known vehicle;
2. add a new vehicle;
3. sign in to continue existing vehicle/draft.

  - **Evidence:** DASHBOARD sidebar (DashboardLayout.tsx:181-198) uses orange-50/orange-700/orange-500 for the active-state indicator, matching DESIGN.md §4.1 ('CarUp orange for primary action, active state'); nav items use `rounded-lg`, matching DESIGN.md §4.4's carve-out that rounded treatment is appropriate for 'compact controls'.
  - **Gap:** Plausible convergence on reading source + DESIGN.md side by side, but this is an inherently visual/subjective judgment and no visual-regression or design-lint test exists to certify it — downgraded to '~'.
- [x] **E2.1 Signed-in Garage vehicles are shown first with image/missing-media state, Passport identity, listing state, and contextual CTA.**
  - **Evidence:** web/src/components/sell/SellIntentRouter.tsx:124-172 renders the authenticated 'Your vehicles' Garage section (image via ListingImage with missing-media fallback, VIN + Passport identity line, publication_status label, contextual CTA from vehicleAction()) positioned ahead of the 'another vehicle' options section (176-206). Directly asserted end-to-end: tests/agents/41-seller-phase-e-staging.spec.ts:47-56 fetches bounding boxes and asserts `garageBox!.y < knownBox!.y` ('owned vehicles must appear before another-vehicle choices'), run across desktop/tablet/mobile.
  - **Note:** Strong: real DOM-position assertion on live staging, not just presence.
- [~] **E2.2 Existing Garage vehicle → Sell this vehicle / Continue listing / Review & publish / Manage listing based on lifecycle.**
  - **Evidence:** SellIntentRouter.tsx:13-22 `vehicleAction()` maps status/publication_status to distinct CTAs: sold→'View sale history', published→'Manage listing', draft/publishable→'Continue listing'/'Review & publish', else→'Sell this vehicle'. MyGarage.tsx:41-64 `contextualAction()` implements an equivalent lifecycle mapping for the My Garage page itself.
  - **Gap:** Logic reads correctly end-to-end on inspection, but no unit/integration test feeds mock vehicles through each status branch and asserts the resulting label/href — the only related tests (SellerWorkspaceConvergence.test.ts, SellerResume.contract.test.ts) are string-presence checks against the raw source text, not behavioral assertions. Per the evidence bar this stays '~', not 'x'.
- [x] **E2.3 Known external vehicle lookup reuses Passport identity.**
  - **Evidence:** web/src/hooks/useSellerVehicleIdentification.ts + VehicleIdentificationNotice wired into both GuestSell.tsx and SellVehicle.tsx. web/src/pages/SellFlow.identification.test.tsx runs a real behavioral test (describe.each over guest and authenticated surfaces) asserting: existing-Passport detection shows 'sell-vin-passport-exists' with the found year/make/model and does NOT leak the other seller's price/mileage (lines 51-68); a 404 correctly shows 'CarUp holds no Passport for this VIN' without claiming the vehicle doesn't exist (70-80); network failure degrades to an advisory, not a block (82-90); incomplete VIN never triggers a lookup (92-98). The onConfirm handler (GuestSell.tsx:533-551, SellVehicle.tsx ~1060+) reuses found.make/model/year via `previous.make.trim() || found?.make || ''` pattern.
  - **Note:** Solid targeted test evidence plus consistent code tracing for identity reuse.
- [~] **E2.4 Authority/ownership claim required before commercial management.**
  - **Evidence:** Client: SellVehicle.tsx authorityState machine (idle/checking/recognized/evidence_required/error), `requestSellerAuthorityClaim()` call (line ~497), and `reuse_existing_passport` sent to the server only when `authorityState === 'recognized'` (line ~693). Backend: backend/server.js:2730 emits `SELLER_AUTHORITY_CLAIM_REQUIRED` and rejects passport reuse without evidence; backend/tests/seller-existing-passport-authority.test.js:39-56 and web/src/pages/SellerExistingPassport.contract.test.ts:23-30 assert these tokens exist in the real source files.
  - **Gap:** The client→server contract traces consistently end-to-end on reading, but every test that exercises it is a regex/string-match against the source file, not an integration test that actually POSTs a claim without evidence and asserts a real 4xx response with that error code. Kept at '~' per the evidence bar's instruction to distinguish 'reads correct' from 'a test asserts the exact contract'.
- [~] **E2.5 New-to-CarUp path creates canonical identity.**
  - **Evidence:** The 'new_vehicle' SellIntentRouter path (SellIntentRouter.tsx onResolve, consumed in GuestSell.tsx:344-356) resets to a blank form that submits through the same createVehicleListing()/POST-vehicles-add path used everywhere else, which per prior memory (Canonical Vehicle Truth, Issue #164) was independently certified to create canonical vehicle identity.
  - **Gap:** Not independently re-verified in this session (would require re-reading backend/routes/vehiclesRoutes.js vehicle-creation path in depth, which is largely inherited from a separately-certified prior phase rather than new Phase E work). Marked '~' rather than 'x' for lack of fresh, in-session verification of the canonical-identity guarantee itself.
- [ ] **E2.6 No owner with known vehicles is dumped directly into a blank new-vehicle form.**
  - **Evidence:** The PRIMARY, most-discoverable Sell entry points bypass the Sell Intent Router entirely for authenticated owners and route straight to the blank form: (1) Desktop mega-menu nodes 'sell.your-car', 'sell.private-owner', 'sell.start-plate-vin' (web/src/config/navigationManifest.ts:140,143,145) all set `authDestination: '/dashboard/sell-vehicle'`; `resolveBaseRoute()` (navigationManifest.ts:219-229) returns `node.authDestination` directly whenever `ctx.isAuthenticated` is true, and this feeds the always-visible 'Sell' dropdown built at web/src/components/layout/Navbar.tsx:182 (`sellMenu = getDesktopMegaMenu('navbar-mega-sell', navContext)`). (2) The mobile drawer's primary Sell item ('mobile.sell', navigationManifest.ts:209, same authDestination) is rendered via `getMobileNavigation()`→`flattenSurface('mobile-primary', ctx)` (line 600) into MobileNavDrawer.tsx. (3) The mobile bottom tab bar independently hardcodes the same behavior: web/src/components/layout/CompactBottomNav.tsx:19-25 sets `sellHref = '/dashboard/sell-vehicle'` whenever `isAuthenticated && user.role === 'owner'`. (4) `/dashboard/sell-vehicle` renders SellVehicle.tsx with NO redirect/intent-check logic at all (grep for Navigate/useNavigate/redirect in that file returns nothing) — with no `?vin=` param it falls straight into the blank Step-0 'Vehicle Details' form from its all-empty INITIAL state.
  - **Gap:** This directly reproduces the exact scenario DESIGN.md itself forbids: DESIGN.md:188-189 §6.4 'A user managing a known vehicle must never be forced into a new vehicle experience without an explicit choice.' The only paths that correctly funnel through /sell are secondary/contextual links (Landing.tsx CTAs, MyGarage.tsx 'Add or sell a vehicle', MyListings.tsx 'Sell another vehicle', EvidenceVault.tsx 'Add or find a vehicle') — none of which is the primary global nav entry. No test (unit or the staging E2E spec) exercises clicking the actual nav-sell menu item or the bottom-nav 'Sell' tab as an authenticated owner with existing garage vehicles; the staging spec (tests/agents/41-seller-phase-e-staging.spec.ts:72) only navigates directly to the URL, which sidesteps this exact failure mode rather than validating against it. This is a genuine, reproducible defect, not merely unproven.
- [x] **E2.7 Sell intent UI certified desktop/tablet/mobile.**

  - **Evidence:** tests/agents/41-seller-phase-e-staging.spec.ts:4-8 defines desktop (1440x1000), tablet (1024x900) and mobile (390x844) viewports and runs the full Sell-intent journey (lines 30-84: /sell guest state, /sell authenticated garage-first state, /dashboard/garage, /dashboard/evidence, /dashboard/listings, /dashboard/sell-vehicle, plus mobile-only drawer behavior) inside a `for (const viewport of VIEWPORTS)` loop against a real staging deployment (.github/workflows/seller-phase-e-staging.yml verifies exact-head frontend/backend before running it).
  - **Note:** Genuine multi-viewport certification with targeted assertions per surface, not just a passing workflow name.
### Phase E roll call
- [ ] **E-RC. Phase E complete:** navigation is distinct and Sell always resolves intent first.

  - **Evidence:** See E2.6: the primary desktop mega-menu, mobile drawer, and mobile bottom-nav 'Sell' entries all send an authenticated owner directly into a blank SellVehicle.tsx form, never through the /sell Sell Intent Router. Only secondary/contextual CTAs (Landing, MyGarage, MyListings, EvidenceVault empty/action states) correctly resolve intent first.
  - **Gap:** The tracker's own goal statement is 'global Sell resolves intent before a user is forced into a blank form.' Since the actual global/primary Sell affordances on both desktop and mobile do not do this, Phase E roll-call cannot pass. The parts that DO work (the /sell page itself, its garage-first ordering, mobile drawer state preservation, sidebar single-active-item, workspace header on 4 core pages) are real and well-evidenced, but they are reached only if a user manually types/clicks a secondary link to /sell rather than using the site's own primary Sell navigation — which is the opposite of the stated goal.
---

# PHASE F — Canonical Seller draft, autosave, refresh, and resume

**Goal:** no Seller progress is lost across refresh, navigation, or authentication.

- [x] **F1. Define canonical guest draft vs persisted server draft authority.**
  - **Evidence:** web/src/pages/dashboard/owner/SellVehicle.tsx:410-414 (explicit comment + code: 'Once an account-scoped server draft exists, it becomes the durable authority... browser draft remains crash-recovery only'), SellVehicle.tsx:30-33 SERVER_AUTOSAVE_FIELDS gated on serverDraftLoaded; guestSellDraft.continuity.test.ts (ran locally, 4/4 pass) proves guest-draft <-> authenticated-form field parity structurally.
  - **Note:** Authority split is clearly defined and code-enforced for the single-VIN case. One caveat: the model has no VIN cross-check between the sessionStorage guest draft and a `?vin=` resume target — see F14 for the concrete failure scenario this creates.
- [x] **F2. Autosave Seller commercial fields at meaningful boundaries.**
  - **Evidence:** SellVehicle.tsx:30-33,413-450 (debounced PATCH via updateSellerDraft + autosaveReceiptMatches revision guard); backend/server.js:3017-3173 (PATCH /api/vehicles/:vin/seller-draft persists and echoes exact DB values). Deployed staging test tests/agents/38-seller-staging-browser-golden.spec.ts:359-363 asserted 'saved to your account' and PASSED on chromium+tablet-chromium against exact-head commit 823b6e8a (GH run 33345485423, stack trace shows execution reached line 652, i.e. past this assertion).
  - **Note:** Real production code path plus a real deployed-browser confirmation, not just a unit test.
- [~] **F3. Autosave current Seller Studio stage.**
  - **Evidence:** SellVehicle.tsx:176 `useState(() => readGuestSellStep())`, :404 `saveGuestSellStep(step)`; GuestSell.tsx:94,168 same pattern; SellerResume.contract.test.ts:28-32 pins the wiring (grep-only, ran locally and passes).
  - **Gap:** Code path is correct on inspection and wired symmetrically in both flows, but no test (unit or staging) actually verifies resuming at a specific NON-initial stage after a refresh/reopen — the staging test always resumes a fully-formed listing at stage 1 and manually clicks Next.
- [x] **F4. Persist history-plan selections.**
  - **Evidence:** web/src/lib/guestSellDraft.annotations.test.ts:31-35,47,61-64 (ran locally, 3/3 pass) — real save+read round trip asserts historyPlan survives exactly, including legacy-draft-without-historyPlan compatibility. SellVehicle.tsx:212,399,786-790 carries it through to the authenticated surface as a read-only 'evidence preparation carried over' summary.
  - **Note:** historyPlan is guest-draft-only by design (no backend column) which is consistent with the F1 authority split; this is a deliberate, reasonable scope, not a gap.
- [x] **F5. Persist privacy selections.**
  - **Evidence:** guestSellDraft.ts:220-223 (explicit enum parse/round-trip); SellVehicle.tsx:193,343-346,426 (autosave payload + server-resume restore); backend/server.js:3104-3118 (PATCH persists listing_location_visibility). Deployed staging test created a vehicle with location_visibility:'public' and later independently confirmed via the real public Marketplace search + detail API that the listing was actually publicly discoverable (spec lines 274,420,470-500), which is only possible if this value was persisted and read back correctly end-to-end; PASSED at run 33345485423.
  - **Note:** Full real backend+DB round trip, not just code reading.
- [~] **F6. Persist seller identity/public-display selections.**
  - **Evidence:** SellVehicle.tsx:194,347,427,683 (autosave/create/resume payload plumbing for publicSellerDisplay); backend/server.js:3099-3102 (PATCH persists public_seller_display_enabled); SellFlow.consent.test.tsx:141,144 (grep-pinned wiring, passes).
  - **Gap:** Code paths read correctly on both write and resume sides, but no test (unit or staging) exercises a `true` value through create/autosave/resume and asserts any observable effect — the deployed staging journey only ever sets this false. Backend Phase-4 tests (issue164-phase4-seller-location.test.js) cover the downstream Passport-claim projection, not this draft-persistence path.
- [x] **F7. Persist photo order.**
  - **Evidence:** web/src/pages/SellFlow.media.test.tsx (ran locally: 13/13 pass in this file) — real React Testing Library test rendering SellVehicle.tsx and asserting the actual submitted `images` array order after using the reorder controls. Deployed staging test asserts exact restored label order after server resume (spec:348-352) and exact order in the public marketplace projection (spec:494-500); PASSED at run 33345485423.
  - **Note:** Both a real component test and a real deployed end-to-end round trip.
- [x] **F8. Persist photo labels.**
  - **Evidence:** SellFlow.media.test.tsx:174-185 (ran locally, pass) — asserts photo_label survives to the submit payload attached to the correct photo. Staging spec:348-352,496-500 asserts exact 7-label restore from server resume and the same order/labels in the public detail API; PASSED at run 33345485423.
  - **Note:** Same dual-evidence strength as F7.
- [x] **F9. Persist explicit cover selection.**
  - **Evidence:** SellFlow.media.test.tsx:127-172,222-250,276-281 (ran locally, pass) — cover selection is explicit, travels with the photo through reorder/removal, never fabricated from index 0. Staging spec:353 (`listing-media-cover-badge-2` visible after server resume) and :496 (public detail API shows is_primary on the correct photo_label); PASSED at run 33345485423.
  - **Note:** Directly targets the exact S4/F9 defect the suite documents (cover badge previously fabricated from array position).
- [x] **F10. Preserve draft on page refresh at every stage.**
  - **Evidence:** guestSellDraft.ts:231-262 (sessionStorage read on module functions) + SellVehicle.tsx:175-176/GuestSell.tsx:94 (mount-time hydration, uniform across every stage since it is not stage-conditional); guestSellDraft.continuity/annotations tests (ran locally, pass) prove the underlying save/read mechanism; staging spec:364-368 performs one real `page.reload()` and asserts the exact field value survives, PASSED at run 33345485423.
  - **Note:** The hydration mechanism is stage-agnostic by construction (same initializer regardless of current step), and is exercised at multiple distinct points (guest-flow unit tests, an authenticated Location&Pricing-stage real browser reload, and an Images&Features-stage seeded-draft render in SellFlow.media.test.tsx).
- [~] **F11. Preserve draft through guest → registration.**
  - **Evidence:** GuestSell.tsx:320-337 (`saveForAccount()` synchronously persists the full draft, including images, before offering account links) and :828 (`/register?returnTo=%2Fdashboard%2Fsell-vehicle`); SellVehicle.tsx reads `readGuestSellDraft()`/`readGuestSellDraftWithMedia()` on mount. SellFlow.resilience.test.ts:55-63 (ran locally, pass) pins these exact strings.
  - **Gap:** Code reads correctly and the save-before-navigate ordering is sound, but no test (unit or staging) actually drives a guest through the real /register flow and back to /dashboard/sell-vehicle to observe the draft resurface.
- [~] **F12. Preserve draft through guest → login to an existing account.**
  - **Evidence:** GuestSell.tsx:829 (`/login?returnTo=%2Fdashboard%2Fsell-vehicle`); same saveForAccount()/readGuestSellDraft() mechanism as F11; SellFlow.resilience.test.ts:58 (ran locally, pass, grep-only).
  - **Gap:** Same evidence class and same gap as F11 — no executed end-to-end test of the actual login handoff.
- [x] **F13. Resume from server after authentication when a server draft exists.**
  - **Evidence:** SellVehicle.tsx:290-362 (fetchOwnedVehicles-driven server-draft hydration when no guest draft exists and `?vin=` is valid). Deployed staging test tests/agents/38-seller-staging-browser-golden.spec.ts:334-353 navigates to `/dashboard/sell-vehicle?vin=<vin>` for a vehicle created purely via direct API (this browser page never uploaded the photos), and asserts the exact 7 labels/order/cover are restored from CarUp's server record — PASSED on chromium, tablet-chromium AND mobile-chromium at run 33345485423 (all three reached past this point before failing later on unrelated steps).
  - **Note:** This is the strongest possible form of proof for F13 — a real browser, real backend, real DB, against the exact commit under audit.
- [~] **F14. Never restart a known Seller vehicle as a blank registration/form without explicit user choice.**
  - **Evidence:** Positive case covered: SellVehicle.tsx:1056-1074 + useSellerVehicleIdentification hook detects an existing Passport on manual VIN entry and blocks silent duplication. Gap found: SellVehicle.tsx:175 `const [guestDraft] = useState(() => readGuestSellDraft())` and :291 `if (guestDraft || !validateVin(resumeVin)) return` — there is no VIN match check between a stored guest draft and the `?vin=` resume target. MyGarage.tsx:57,63, MyListings.tsx:301,406 and VehicleProfile.tsx:344 all link to `/dashboard/sell-vehicle?vin=<X>` without ever calling clearGuestSellDraft() first.
  - **Gap:** Concrete failure scenario: a Seller abandons a guest draft for vehicle A (still in sessionStorage), then within the same tab clicks 'Continue listing' for an unrelated known vehicle B from My Garage/My Listings — the stale vehicle-A guest draft silently wins over vehicle B's real server data, with no warning. This is not 'blank form' but is arguably a worse instance of the same class of defect the item guards against. No test covers this path.
- [x] **F15. Save success only claims data actually persisted.**
  - **Evidence:** SellVehicle.tsx:696-738 gates the success toast + clearGuestSellDraft() on server-confirmed receipts (submission_id_recorded, images_recorded_count, images_replacement_complete, images_labels_recorded all checked); backend/server.js:3149-3169 returns an exact DB-read-back receipt for autosave, not an echo of the request. Staging spec:291-332 (create+replay counts asserted exactly) and :359-368 (post-reload exact value) PASSED at run 33345485423.
  - **Note:** grep confirms clearGuestSellDraft() has exactly one call site in production code, immediately after these checks (SellVehicle.tsx:736).
- [~] **F16. On failed persistence, preserve the only local/browser copy and surface actionable recovery.**
  - **Evidence:** SellVehicle.tsx:610-753 — every failure branch (upload not fully confirmed, unresolved image URLs, submission id not durably recorded, incomplete/mismatched photo gallery, network/API exception) returns/falls through without calling clearGuestSellDraft() and shows an explicit actionable toast (e.g. 'Your browser draft has been kept so you can retry').
  - **Gap:** Code-level guarantee is thorough and consistent (single clearGuestSellDraft() call site gated on success), but no test — unit or staging — actually induces a real persistence failure to observe this recovery behavior in practice, so this is 'reads correct' rather than 'proven by a test'.
- [x] **F17. Duplicate-submit/retry is idempotent and does not create duplicate vehicle identities/listings.**

  - **Evidence:** database/migrations/20260831100000_seller_listing_submission_id.sql (unique index + shape-check constraint); backend/server.js:2405-2419 (UUID validation, fail-closed 503 on missing schema), :2715-2783 (exact-replay detection: same submission id + matching Seller scope + matching media -> 200 idempotent_replay, mismatched scope -> 409 SELLER_AUTHORITY_CLAIM_REQUIRED, mismatched media -> 409 SELLER_SUBMISSION_REPLAY_MISMATCH). backend/tests/seller-listing-idempotency.test.js ran locally: 6/6 PASS. Deployed staging test spec:287-332 creates then replays the identical request against the real backend+DB and asserts idempotent_replay true/false and image-count parity exactly — PASSED at run 33345485423 (exact-head commit 823b6e8a).
  - **Note:** Minor residual gap: a true concurrent double-submit race (two simultaneous inserts before either commits) is not caught with a friendly response — there is no explicit handling of a Postgres unique-violation on this column, so it would surface as a generic 500 rather than a graceful replay response. The DB unique constraint still guarantees no duplicate row is ever created, so the core 'no duplicate identity' guarantee holds even in that edge case.
### Phase F roll call
- [~] **F-RC. Phase F complete:** refresh/auth/navigation cannot silently destroy Seller progress or duplicate the vehicle.

  - **Evidence:** Every mechanism has real implementation and most have real behavioral proof, including a genuine deployed-staging end-to-end journey (GH Actions run 33345485423 against exact-head commit 823b6e8a) that PASSED create, idempotent replay, server-authoritative resume with exact media/label/cover restore, and account-linked autosave-survives-reload on desktop, tablet, AND mobile Chromium (all three profiles executed well past every Phase-F-relevant assertion, confirmed via stack-trace/line-number analysis of the failure point).
  - **Gap:** However this cannot be certified 'complete': (1) the overall CI gate for that staging test is currently RED at HEAD — chromium/tablet-chromium fail only in the test's own `finally` cleanup step (retiring the fixture vehicle hangs on a CSRF call near the 180s ceiling, likely rate-limiting from cumulative test traffic) and mobile-chromium fails earlier on an unrelated Phase-G mobile gallery tap obstruction — so there is no clean top-to-bottom PASS artifact to point to; (2) a real, unguarded stale-guest-draft-vs-resume-VIN gap exists (F14) that can silently substitute the wrong vehicle's data with zero warning; (3) F16's failure/recovery path and F11/F12's guest-to-auth handoff are proven only by code reading or grep-pinned string tests, never by an executed scenario. The roll call requires every item cleared with no residual duplication/data-loss risk before Phase F can be marked complete.
---

# PHASE G — Media persistence, gallery continuity, and visual quality

**Goal:** seven real Seller images remain the same seven images across the full journey.

## G1. Owner UAT vehicle historical repair path

- [x] **G1.1 Confirm `UAT20260828SELL01` has no canonical listing-media rows.**
  - **Evidence:** Live read query against carup-staging (project eoyenigwevnxwwhyhaer) run 2026-08-31: `select ... from listing_images where vin='UAT20260828SELL01'` returned `[]` (zero rows); `select ... from vehicles where vin='UAT20260828SELL01'` confirms the row still exists as Toyota Hilux 2021, publication_status='draft'. Matches docs/seller/SELLER_UAT_REMEDIATION_BASELINE_DEFECT_LEDGER.md:13 and SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md:155 baseline claim.
  - **Note:** Confirmed unchanged from baseline: still zero canonical listing-media rows as of today, verified live rather than assumed from old docs.
- [x] **G1.2 Record that missing historical uploads cannot be reconstructed server-side.**
  - **Evidence:** docs/seller/SELLER_MARKETPLACE_PARITY_MATRIX.md:60 ('the server cannot reconstruct media that never persisted') and docs/seller/SELLER_MARKETPLACE_CONVERGENCE_IMPLEMENTATION_PLAN.md:251 ('UAT20260828SELL01 has no stored listing images. Re-upload is necessary; server cannot reconstruct missing rows.').
  - **Note:** This is a documentation/acknowledgment item and is explicitly recorded in two authoritative docs, not just implied.
- [~] **G1.3 Provide governed re-upload/retry path without mutating unrelated vehicle facts.**

## G2. Seven-image persistence contract

  - **Evidence:** backend/server.js:2699-2999 (POST /api/vehicles/add, reuse_existing_passport branch): for an existing VIN, listing_images are replaced by inserting new rows then deleting only prior rows for that VIN with created_at < the new batch's watermark (server.js:2951-2958) — a no-op delete when zero prior rows exist, exactly UAT20260828SELL01's case. backend/tests/seller-existing-passport-authority.test.js 'governed Seller authority becomes listing scope without becoming legal ownership' (ran locally with `node --test`, PASS) asserts the reuse block never writes owner_id and never inserts vehicle_ownership_history.
  - **Gap:** Structurally sound and traced end-to-end by reading; the ownership-non-mutation claim is backed by a real passing test. But no test exercises the exact scenario (existing VIN with historically zero media + reuse_existing_passport=true + fresh 7-image submission) end-to-end and asserts resulting row count/labels — only the identical-payload idempotent-replay path (a different, freshly-created VIN in the same test) is exercised live. Downgraded from 'x' per the 'code looks correct on reading vs. a test asserts this exact contract' rule.
- [x] **G2.1 Select/upload 7 meaningful vehicle photos.**
  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:224-230 uploads 7 distinct, non-trivial 320x180 PNG images (VISUAL_TEST_PNGS, each visually different) via POST /media/upload/vehicle and asserts `mediaBody.urls` has length 7. This test ran for real against deployed staging at the audited commit 823b6e8a (GitHub Actions run 33345485423, job 'golden-dynamic-seller'); live DB query today confirms VIN JTDKARFP0H3034724 (created 2026-08-31 00:54:40, inside that run's window) has exactly 7 listing_images rows with real supabase storage URLs.
  - **Note:** Meets the 'meaningful photo, not 1x1 fixture' bar explicitly (file's own comment enforces this).
- [x] **G2.2 All 7 upload successfully or save is visibly incomplete; no silent partial success.**
  - **Evidence:** Same spec, lines ~290-298 assert images_recorded===true, images_recorded_count===7, images_unpublishable_count===0, images_replacement_complete!==false, images_labels_recorded===true from the real POST /api/vehicles/add response at the audited commit's CI run. server.js:2917-2999 computes these fields from actual insert outcomes (never fabricated). Live DB confirms media_count=7 (never fewer) for every recent Golden Dynamic Seller run inspected (7 consecutive runs, all media_count=7).
  - **Note:** No partial-success case observed in any of the sampled runs; the contract as coded reports partial state honestly rather than silently.
- [x] **G2.3 All 7 listing-media rows persist.**
  - **Evidence:** Live SQL against carup-staging: `select vin, image_url, is_primary, display_order, photo_label from listing_images where vin='JTDKARFP0H3034724' order by display_order` returns exactly 7 rows, created during CI run 33345485423 (the audited-commit run), with real supabase storage URLs.
  - **Note:** Direct database evidence, not inference from API response fields alone.
- [x] **G2.4 All 7 survive refresh.**
  - **Evidence:** Spec lines ~334-341: after creation, a fresh `page.goto('/dashboard/sell-vehicle?vin=...')` (a page that never created the fixture) waits for `seller-server-draft-loaded`, navigates through the real Studio stages to Images & Features, and asserts `restoredLabelTriggers` has count 7. Playwright's own failure report for the audited-commit run (33345485423) shows the 3 recorded failures occur at: (a) the cleanup `finally` block at line 652 after the global 180s test-timeout fired (a pre-existing, unrelated My-Listings/communications N+1 slowness, fixed one commit later in f50b5b07), and (b) a mobile-only carousel-tap flake at line ~399 (G4 territory, out of this audit's scope) — neither is in the G2 assertion block (lines ~242-350), so those assertions executed without a reported failure.
  - **Note:** Survival is proven via a fresh navigation/server round-trip rather than a literal F5, which is the stronger form of the same claim.
- [x] **G2.5 Labels survive refresh.**
  - **Evidence:** Spec: `for (index...) expect(restoredLabelTriggers.nth(index)).toContainText(photoLabels[index])` after the fresh navigation above. Live DB for JTDKARFP0H3034724 shows photo_label values in display_order 0-6: 'Front three-quarter','Front','Driver side','Passenger side','Rear three-quarter','Interior','Dashboard' — exactly matching the submitted labels.
  - **Note:** No open questions.
- [x] **G2.6 Ordering survives refresh.**
  - **Evidence:** Live DB display_order column for JTDKARFP0H3034724 is 0-6 in the exact submitted sequence; commit f6820819 added a marketplace-detail assertion sorting projected items by seller_order and asserting the label sequence equals the original photoLabels array (spec lines ~404-412); backend/utils/vehicleMediaProjection.js was patched in 15fcaaee to preserve stored order in the projection.
  - **Note:** No open questions.
- [x] **G2.7 Explicit cover survives refresh.**
  - **Evidence:** Live DB shows is_primary=true only on display_order=2 (photo_label='Driver side'), matching the submitted `is_primary: index===2`. Spec asserts `listing-media-cover-badge-2` visible after the fresh server-backed reload, and later in Buyer Preview asserts the primary `vehicle-image` src equals `mediaBody.urls[2]` and `listing-media-photo-label` shows 'Driver side'.
  - **Note:** No open questions.
- [x] **G2.8 Retry does not duplicate media rows.**
  - **Evidence:** Spec lines ~314-331: an identical-payload replay POST to /api/vehicles/add (F17 lost-response simulation) returns idempotent_replay:true, images_recorded_count:7 (not 14), images_replacement_complete:true. Live DB for the corresponding VIN shows exactly 7 rows despite two /vehicles/add POSTs in the test. backend/tests/seller-listing-idempotency.test.js ('same durable submission key is resolved before normal existing-Passport confirmation', 'a replay still requires governed Seller relationship and exact media identity') ran locally via `node --test`, PASS.
  - **Note:** No open questions.
- [~] **G2.9 Media delivery failures are distinguishable from "Seller supplied no photos".**

## G3. Cross-surface continuity

The same explicit cover must appear in:
  - **Evidence:** READ path: backend/tests/issue164-phase5-media-contract.test.js 'M1 GUARD: a FAILED listing_images read degrades to not_loaded, never to "no photos"' and 'M1 GUARD: an EMPTY listing_images read says "no photos", which is a different fact' — both ran locally (`node --test`, 78/78 pass in file) and assert distinct `state`/`empty_statement` values for a failed read vs. a confirmed-empty read. WRITE path: web/src/pages/dashboard/owner/SellVehicle.tsx:715-726 gates all failure-detection (recordedCount mismatch, refusedCount>0, replacement incomplete) behind `if (resolvedImageUrls.length > 0)`, so a Seller who submitted 0 photos gets the plain success toast while a Seller whose submitted photos failed to fully persist gets a distinct error toast ('...did not confirm the complete photo gallery...draft has been kept so you can retry').
  - **Gap:** The read-side distinction is certified by a real executing test. The write-side (Seller Studio save) branch is correct on direct reading of the code but is only checked by a static string-containment test (web/src/pages/SellerResume.contract.test.ts:65, `expect(seller).toContain('images_recorded_count')`) rather than a test that actually exercises the mismatch-vs-zero-submitted branching and asserts the two different toasts. Net: implemented and traceable, not fully certified by a targeted behavioral test -> '~'.
- [x] **G3.1 Seller Studio**
  - **Evidence:** web/src/pages/dashboard/owner/SellVehicle.tsx:758 `primaryListingImageUrl(serverVehicle.listing_media)`; lines 310 & 350 restore `coverImageIndex` from the server's `is_primary` flag on resume; lines 1348-1367 render the `listing-media-cover-badge-{i}` on exactly that index. web/src/lib/listingMedia.test.ts (9/9 passing, ran locally) directly tests `primaryListingImageUrl` honouring `is_primary` over document order.
  - **Note:** Seller Studio reads the identical canonical listing_media block (same helper as Garage/Listings) and restores the seller's chosen cover index from is_primary, not from array position.
- [x] **G3.2 My Garage**
  - **Evidence:** web/src/pages/dashboard/owner/MyGarage.tsx:147 `const media = primaryListingImageUrl(vehicle.listing_media)`, rendered via `<ListingImage src={media}.../>` at lines 155-163 keyed to `data-testid=vehicle-row-${vin}`. Backend source: backend/server.js:3459-3463 `/api/vehicles/me` attaches `listing_media` via `ownerListingMedia()` -> `toListingMediaBlock`.
  - **Note:** Same shared helper/backend projection as every other owner surface; primaryListingImageUrl is unit-tested (listingMedia.test.ts, passing).
- [x] **G3.3 My Listings**
  - **Evidence:** web/src/pages/dashboard/owner/MyListings.tsx:307-311 — `data-testid={my-listing-card-${listing.vin}}` renders `<ListingImage src={primaryListingImageUrl(listing.listing_media)}.../>`.
  - **Note:** Identical wiring to My Garage/Seller Studio via the same primaryListingImageUrl helper reading the same listing_media block.
- [x] **G3.4 Buyer Preview**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1152-1155 sets presentationMode from `?mode=seller_preview`, but the gallery block (lines 1820-2025) has zero branching on isSellerPreview — only the top-right save/compare/share icons (line 1963) are gated. web/src/pages/VehicleDetail.presentationMode.test.ts (5/5 passing) proves both modes route through this one architecture. web/src/pages/VehicleDetail.media.test.tsx:828-845 'honours a primacy claim once and invents one never' is a real render test (ran locally, part of 97/97 passing) that plants is_primary on the 2nd of 2 items and asserts the rendered `vehicle-image` src is that item's URL and `listing-media-primary` is present. Backend gating: backend/server.js:1084-1092 resolves `listingAudience: isAuthorized ? 'owner' : 'public'`, and backend/utils/vehicleMediaProjection.js:796-805 `toGatedListingMediaBlock` returns the FULL (unfiltered) block for 'owner' audience regardless of draft/publication status, which is why a seller can preview full media pre-publish.
  - **Note:** Caveat: the staging E2E assertion for this exact scenario (tests/agents/38-...:380-392) is the one whose locator bug commit 823b6e8a just fixed; I found no evidence of a confirmed passing execution of that spec after the fix (only a 3-test 'skipped' dry-list in test-results/, not a real run), so treat the E2E layer as corroborating rather than independently confirmed — the component-level test above is the harder evidence.
- [x] **G3.5 Marketplace listing card**
  - **Evidence:** backend/services/marketplace/listingSummaryService.js:594-606 `electPrimaryImage()` calls the same `toListingMediaBlock` and elects `block.items[0]` as `primary_image_url`/`primary_image_state`. web/src/pages/Marketplace.tsx:1032 `primaryImage: primaryImageForListing(listing)` feeds `MarketplaceListingCard` -> `ListingImage`. web/src/lib/marketplacePresentation.ts:11-18 `primaryImageForListing` gates on `primary_image_state` in ('seller_primary','first_published'). web/src/lib/marketplacePresentation.test.ts (2/2 passing, ran locally).
  - **Note:** Same election function as My Garage/Listings/Seller Studio's backend source, just surfaced through the summary projection instead of the full listing_media block.
- [x] **G3.6 Marketplace Vehicle Detail primary image**
  - **Evidence:** Same component/code path as G3.4 (VehicleDetail.tsx, marketplace_public is the default presentationMode); the gallery/primary-image render logic (lines 1841-1872) is identical for both modes. web/src/pages/VehicleDetail.media.test.tsx:828-845 (passing) directly proves the election+render contract independent of mode.
  - **Note:** Same caveat as G3.4: this specific staging-detail path was exercised by the just-fixed locator in tests/agents/38-...:390 (`page.getByTestId('vehicle-image').first()`), not independently re-run by me.
- [x] **G3.7 Home hero/featured placement when governed selection legitimately chooses that vehicle**
  - **Evidence:** web/src/pages/Landing.tsx:186-191 — `heroVehicle` = newest featured vehicle whose `primary_image_state`/`primary_image_url` pass `canRenderMarketplacePrimaryImage`; `heroImage = heroVehicle.primary_image_url`. This is the exact same field computed by `electPrimaryImage()` (backend/services/marketplace/listingSummaryService.js:594-606) used by the Marketplace card (G3.5).
  - **Note:** 'Home' in this codebase is web/src/pages/Landing.tsx (route '/'); web/src/pages/Home.tsx is unused Vite scaffolding, not wired into App.tsx routing.
- [ ] **G3.8 Recommendations/related vehicle cards where applicable**

The full 7-image gallery must appear in:
  - **Evidence:** No 'recommendations' / 'related vehicles' / 'similar vehicles' component or section exists anywhere in web/src (grepped pages, components, and VehicleDetail.tsx specifically for similar|related|recommend — no matches besides unrelated admin/help-center features).
  - **Gap:** Item says 'where applicable'; the feature itself does not exist in the product, so there is nothing to verify a shared cover against. Marking not-proven rather than N/A since the tracker still lists it as an open checklist item.
- [~] **G3.9 Buyer Preview**
  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:386-390 asserts `listing-media-primary` visible, label 'Driver side', and `listing-media-thumb` count === 7 in Buyer Preview. Commit 823b6e8a561aa1d7334976696da8067f3aff7450's message states the real run that surfaced the locator bug failed at the src-equality assertion (originally line 390), i.e. AFTER the 7-thumbnail count check, implying that count assertion had already passed in that run. Code has no cap/slice on `galleryItems.map()` (VehicleDetail.tsx:2015), and local render tests with 2-4 images (VehicleDetail.media.test.tsx, passing) confirm the same thumb-rendering path generalizes.
  - **Gap:** Downgraded from x to ~ because I could not independently observe a raw passing log for this exact run — I'm relying on the commit message's narrative plus generalization from N=2-4 local tests, not a directly-witnessed N=7 pass.
- [~] **G3.10 Marketplace Vehicle Detail**

## G4. Carousel/visual acceptance

  - **Evidence:** tests/agents/38-...:487-500 confirms via a direct API call to `/marketplace/listings/:vin` that the PUBLISHED listing's `listing_media.items` has length 7 with correct labels/order. But the spec does NOT assert `listing-media-thumb` DOM count on the public (non-preview) VehicleDetail render — only visibility of `listing-media-primary` and `expectMeaningfulRenderedImage` (lines 483-485). VehicleDetail.tsx's gallery/thumbnail code is identical for both modes (no isSellerPreview branch on the thumbnail block).
  - **Gap:** Proven at the API/data layer and by shared-component architecture, but no direct UI assertion of a 7-thumbnail DOM count specifically at the public marketplace detail surface.
- [~] **G4.1 Desktop next/previous controls work.**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1876-1882 (`listing-media-previous`) and 1883-1890 (`listing-media-next`) cycle `currentImageIdx` via modulo arithmetic — correct on reading. tests/agents/38-...:396-403 asserts click-driven navigation on the 'chromium' project.
  - **Gap:** No local component-level test clicks these controls and asserts the src changes (only E2E). Per commit 823b6e8a's account, the last real staging run failed upstream of this block (at the since-fixed src-equality assertion on line ~390), so these nav assertions were never reached/observed passing in any run I have evidence of.
- [~] **G4.2 Thumbnail selection works.**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:2015-2023 thumbnail `onClick={() => setCurrentImageIdx(galleryIndex)}` — correct on reading. tests/agents/38-...:409-411 clicks a thumbnail and asserts the primary image src changes.
  - **Gap:** Same caveat as G4.1: no local render+interaction test, and the E2E assertion for this has not been confirmed executed/passing post-fix.
- [~] **G4.3 Touch/mobile gallery works.**
  - **Evidence:** playwright.staging.config.ts:44-50 configures 'tablet-chromium' and 'mobile-chromium' projects with `hasTouch: true`; tests/agents/38-...:400-401,404-405 use `.tap()` instead of `.click()` on those projects for the exact same next/previous controls as G4.1.
  - **Gap:** Same underlying handlers as desktop (no separate touch code path in VehicleDetail.tsx), so a pass on chromium reasonably implies a pass on touch profiles, but I have no confirmed execution evidence for any of the three projects post-fix.
- [~] **G4.4 Crop/aspect is stable and does not create deceptive presentation.**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1851 primary image uses `aspect-[16/9] w-full object-cover sm:aspect-[2/1]`; thumbnails (line 2020-2021) use a fixed `h-20 w-28` box with `object-cover`. No cropping/zoom tool exists anywhere in Seller Studio or VehicleDetail (grepped for 'crop' — no matches).
  - **Gap:** Stable, CSS-only aspect boxes with no interactive crop feature to misrepresent the photo; sound by architecture but no dedicated automated non-deceptive-crop assertion exists.
- [x] **G4.5 Meaningful dimensions required for browser visual certification.**
  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:188-207 `expectMeaningfulRenderedImage()` polls `node.complete && naturalWidth >= 64 && naturalHeight >= 40` before accepting, and asserts on the decoded size. Lines 45-56 document the seven fixtures as real 320x180 multi-view PNGs specifically because 'a 1x1 transport fixture can never satisfy Seller media certification.'
  - **Note:** This is a property of the certification method itself (verified directly by reading the helper and fixtures), independent of whether a fresh full run has been executed.
- [~] **G4.6 No blank giant media regions when a valid meaningful image exists.**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1841 gates on `hasListingPhotos && activeImage` — there is no intermediate state where the gallery container renders without either a real `<img>` or the explicit `no-images-placeholder` branch (lines 1897-1951). A per-URL `onError` handler (`markListingMediaFailed`) removes only the failing URL from `galleryItems` rather than blanking the whole gallery.
  - **Gap:** Structurally sound by code trace; no dedicated automated test asserts 'the media region is never blank while a valid image exists.'
- [x] **G4.7 No unrelated stock image substitutes for real listing media.**
  - **Evidence:** web/src/components/marketplace/ListingImage.tsx:1-19 explicitly documents removing the prior Unsplash fallback and only ever renders the real `src` or a branded 'Image unavailable' placeholder (Car+ImageOff icons) — no external stock-photo branch exists. Repo-wide grep for 'unsplash' in web/src turns up only an unrelated Careers.tsx background image, never in vehicle-media rendering code.
  - **Note:** Confirmed by direct code reading of the single shared image component used by every listing surface.
- [x] **G4.8 Listing media never masquerades as verified evidence.**

  - **Evidence:** web/src/pages/VehicleDetail.tsx:1834-1837 caption reads 'Photos supplied by the seller... CarUp does not review them and makes no claim about what they show.' web/src/pages/VehicleDetail.media.test.tsx:447-503 describe('VehicleDetail — listing media is never labelled verified') is a real, currently-passing test (ran locally, part of 97/97) that renders the block across published/none/not_loaded states and scans the actual DOM innerHTML for any trust/governance language, asserting none is present, with an anti-vacuity check (lines 494-501) proving the scanner does detect such language when it's genuinely present (in the separate verified-evidence block).
  - **Note:** Direct, executed, passing test of exactly this contract.
### Phase G roll call
- [ ] **G-RC. Phase G complete:** 7/7 meaningful photos + labels + order + cover survive the full journey and render correctly on desktop/tablet/mobile.

---

# PHASE H — My Garage redesign

**Goal:** My Garage becomes the durable owner vehicle workspace defined by `DESIGN.md`.

- [~] **H1. Page header with route orientation and Seller/Owner Home return.**
  - **Evidence:** web/src/pages/dashboard/owner/MyGarage.tsx:93-108 renders <SellerWorkspaceHeader> without overriding backHref/backLabel; web/src/components/seller/SellerWorkspaceHeader.tsx:9-10,26-32 defaults to backHref='/dashboard', backLabel='Seller / Owner home' and renders it as a real <Link>; web/src/App.tsx:327 maps '/dashboard' to <OwnerDashboard/>.
  - **Gap:** Route-orientation/back-to-home is wired correctly by construction (props omitted -> hardcoded defaults apply), verified by reading end-to-end, but no test renders MyGarage itself and asserts the back link/href. SellerWorkspaceHeader.test.tsx only exercises a hand-constructed instance with different props, not the one MyGarage actually passes.
- [~] **H2. Vehicle count/state uses truthful semantics.**
  - **Evidence:** MyGarage.tsx:71-89 (three explicit vehiclesState values driven by the real fetchOwnedVehicles() promise, not fabricated), MyGarage.tsx:97-103 (count text driven by vehicles.length, differentiated loading/error/ready); partially reinforced by OwnerDashboard.trust.test.tsx:424-446 which renders MyGarage and asserts vehicle-status-${VIN} reads 'Status not recorded' (not an invented 'Active') — passing (41/41 in that file).
  - **Gap:** Per-vehicle status truthfulness is directly tested. The aggregate Garage-level count/loading/error copy ('N governed vehicle workspaces', 'Garage read unavailable') is not asserted by any test — only traced by reading.
- [x] **H3. Vehicle stories use substantial real media or designed missing-media state.**
  - **Evidence:** MyGarage.tsx:157-169 renders <ListingImage src={primaryListingImageUrl(vehicle.listing_media)} .../> with a real-media caption vs 'No seller listing photo recorded' overlay; web/src/components/marketplace/ListingImage.tsx:40-73 implements a branded 'Image unavailable' placeholder (never stock) with load-failure fallback; web/src/components/marketplace/ListingImage.test.tsx (all cases, incl. load-failure fireEvent.error) passes; OwnerDashboard.trust.test.tsx:501-505 asserts MyGarage's source never contains 'images.unsplash.com'; backend/server.js:3459,653-664 (ownerListingMedia) sources real listing_images rows via the same toListingMediaBlock projection used by the public listing.
  - **Note:** Composed evidence across a well-tested shared component plus a direct negative test on MyGarage's own source is strong enough for 'x'. Caveat: backend/tests/issue164-owner-listing-media.test.js has one stale/failing subtest (see rollCallNotes) — doesn't contradict the fail-closed behavior on reading, but weakens the backend-side test currency.
- [~] **H4. Make/model/year + safe identifier prominent.**
  - **Evidence:** MyGarage.tsx:174-183 renders `{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}` as a prominent h2, with 'Vehicle identity incomplete' fallback, and the VIN in a font-mono overlay at line 165.
  - **Gap:** Clear, unconditional rendering verified by reading; no test asserts the composed heading text or VIN visibility specifically for MyGarage.
- [~] **H5. Passport identity/state visible.**
  - **Evidence:** MyGarage.tsx:175-177 labels each row 'Vehicle Passport' as an eyebrow; MyGarage.tsx:254-259 provides a 'View Vehicle Passport' link to /dashboard/garage/:vin (App.tsx:330 -> VehicleProfile, the Passport surface).
  - **Gap:** DESIGN.md §12 itself only requires 'Passport identity' (not a separate verification-state field) be shown, which this satisfies by inspection. No dedicated automated assertion of this label/link exists.
- [~] **H6. Ownership/current-seller relationship visible.**
  - **Evidence:** MyGarage.tsx:33-39 relationshipLabel() reads real vehicle.owner_id / vehicle.current_seller_id against the signed-in user.id and renders one of 4 real states; backend/server.js:3441-3446 confirms /api/vehicles/me actually returns owner_id and current_seller_id via select('*') scoped `.or(owner_id.eq...,current_seller_id.eq...)`.
  - **Gap:** Logic is simple, real-field-driven and traced end to end with high confidence, but no test renders MyGarage and asserts the 'Relationship' text for any of the 4 branches.
- [~] **H7. Listing/publication lifecycle visible.**
  - **Evidence:** MyGarage.tsx:21-31 publicationLabel() maps exactly the 6 real backend publication_status values ('draft','identity_complete','documents_submitted','review_pending','publishable','published') confirmed live in backend/server.js:3044 and documented in backend/utils/vehicleStatus.js:41-46.
  - **Gap:** Strong static correlation between the frontend switch and the actual backend enum, but no direct render test asserts any of these six labels appears in MyGarage's 'Commerce lifecycle' block.
- [x] **H8. Canonical Trust state visible without decorative substitution.**
  - **Evidence:** MyGarage.tsx:211-227 uses readOwnerTrustClaim() (web/src/pages/dashboard/owner/ownerStatedValues.ts:39-53, fails closed: score only ever non-null when evaluation_state==='evaluated'); OwnerDashboard.trust.test.tsx (rendered via renderGarage(), lines 183-184) directly asserts against MyGarage's own trust-claim-${VIN} DOM node across not-evaluated/stale/legacy-shape/evaluated/insufficient_evidence/no-invented-tier/no-raw-trust_score scenarios — 41/41 passing when run locally (`npm run test:unit --workspace=web -- src/pages/dashboard/owner/OwnerDashboard.trust.test.tsx`).
  - **Note:** This is genuine behavioral test coverage, not just source substring matching — the strongest-evidenced item in Phase H.
- [~] **H9. Evidence/readiness visible.**
  - **Evidence:** MyGarage.tsx:230-250 renders 'Governed supporting state' counts via statedCount(vehicle.counts?.verified_documents/services/active_insurance/parts, ...) (ownerStatedValues.ts:87-94, null -> 'not recorded' in words, never a fabricated 0); backend/server.js:575-610 ownerGarageCounts() performs 4 independent real Supabase reads (vehicle_evidence/mechanic_work_orders/partsentry_logs/insurance_records) and fails closed to null per-source on any read error.
  - **Gap:** End-to-end code trace is convincing and explicitly documents the historical '0 docs against 4 verified documents' defect it fixes, but no frontend test renders MyGarage and asserts any of these four count strings, and no backend test exercises ownerGarageCounts() against real/fixture data.
- [~] **H10. Service/insurance/PartSentry summaries only where governed.**
  - **Evidence:** Same as H9 — the same 'Governed supporting state' grid covers services (Wrench icon) and active_insurance (ShieldCheck) and parts (Gauge, i.e. PartSentry), all sourced from real governed tables per backend/server.js:575-610, fail-closed to 'not recorded' when unmeasured.
  - **Gap:** No test asserts these render only 'where governed' (i.e., that an ungoverned/unmeasurable case degrades to words, not a zero) for MyGarage specifically — same gap as H9.
- [~] **H11. Exactly one dominant contextual CTA.**
  - draft → **Continue listing**
  - published → **Manage listing**
  - vehicle only → **Sell this vehicle**
  - **Evidence:** MyGarage.tsx:41-66 contextualAction() computes exactly one of {Manage listing, Continue listing, Sell this vehicle} and MyGarage.tsx:260-264 renders exactly one unconditional <Button> per row using that single computed action.
  - **Gap:** Structurally guaranteed by the JSX (there is only one Button element in the template, not a conditional set of several), which is stronger than ordinary 'looks correct' reading, but per the stated grading rule ('mark ~ unless a direct test exists') no automated test exercises all three action branches and asserts singularity, so kept at '~'.
- [~] **H12. Secondary View Passport action.**
  - **Evidence:** MyGarage.tsx:253-259 renders a 'View Vehicle Passport' link alongside the primary CTA, matching DESIGN.md:401-402 verbatim ('View Vehicle Passport').
  - **Gap:** Clear by reading; not covered by any render-level test.
- [x] **H13. Open editorial/automotive composition; legacy generic card-grid no longer governing.**
  - **Evidence:** SellerWorkspaceConvergence.test.ts:24 asserts `expect(garage).not.toContain('rounded-xl p-8 flex flex-col items-center justify-center')` (the legacy card-grid signature) — passes; direct reading of MyGarage.tsx (lines 141-271) confirms the actual layout is an editorial image+content split (`grid gap-0 py-8 lg:grid-cols-[minmax(310px,0.82fr)_minmax(0,1.18fr)]`) with large serif-weight typography, not a generic card grid.
  - **Note:** Both a passing negative test and direct visual/structural reading agree — solid 'x'.
- [~] **H14. Desktop/tablet/mobile visual acceptance.**
  - **Evidence:** MyGarage.tsx uses responsive Tailwind classes at multiple breakpoints (sm:min-h-[320px], lg:grid-cols-[...], sm:grid-cols-3, xl:grid-cols-[1fr_1fr], sm:flex-row) suggesting a considered responsive layout; tests/agents/39-seller-baseline-visual-audit.spec.ts captures desktop/tablet/mobile screenshots of /dashboard/garage.
  - **Gap:** The only visual-capture spec is a generic Phase-B smoke test (asserts only non-empty body and no 5xx, no assertion of Phase H's specific layout claims), requires live staging credentials (BASELINE_WEB_URL, STAGING_UAT_BUYER_PASSWORD) to run at all, and predates/ignores the Phase H redesign specifics. No jsdom/component test can verify actual responsive rendering. Downgraded to '~' — code suggests correct intent, not proven visually.
- [~] **H15. `My Garage → Hilux → Continue listing → Seller Studio` works without sidebar knowledge.**

  - **Evidence:** MyGarage.tsx:56-59 sets Continue-listing href to `/dashboard/sell-vehicle?vin=${vin}`; App.tsx:336 routes that to <SellVehicle/>; SellVehicle.tsx:173,294 reads searchParams.get('vin') and calls fetchOwnedVehicles() to resume the exact existing draft, surfaced via seller-server-draft-loaded (SellVehicle.tsx:977); SellerResume.contract.test.ts:34-41 asserts (via source substring) that this reopen-by-vin wiring exists in both MyGarage and SellVehicle.
  - **Gap:** Every hop of the journey (Garage row CTA -> URL param -> Studio resume) is directly wired via a plain <Link href>, so no sidebar knowledge is structurally required to get from Garage to Studio for a specific VIN. However, no automated test actually clicks the 'Continue listing' button from a rendered MyGarage and asserts arrival at Seller Studio with that VIN preloaded — tests/agents/38-seller-staging-browser-golden.spec.ts (a staging-only, external-dependency spec) navigates to /dashboard/garage and to /dashboard/sell-vehicle via separate page.goto() calls, never via the actual button click.
### Phase H roll call
- [~] **H-RC. Phase H complete:** My Garage satisfies DESIGN.md and the contextual continuation journey.

  - **Evidence:** See rollCallNotes and per-item entries above.
  - **Gap:** The redesign genuinely exists, closely follows DESIGN.md §12, and two/thirteen items (H3, H8) plus the negative legacy-grid check (H13) have real behavioral test coverage that passes today. The remaining ten items are supported only by confident end-to-end code reading, not by tests that exercise the specific behavior, and H14/H15 in particular have no automated coverage of the actual interactions described. Per the stated evidence bar this phase is not yet fully certified — recommend adding render-level tests (extending OwnerDashboard.trust.test.tsx's pattern) for contextualAction's 3 branches, relationshipLabel/publicationLabel text, the governed-counts grid, and a local (non-staging) Playwright/RTL click-through of Continue listing -> Seller Studio, plus fixing the one currently-failing backend test in issue164-owner-listing-media.test.js.
---

# PHASE I — My Listings redesign

**Goal:** My Listings becomes the Seller commerce operating surface.

- [~] **I1. Top KPI/state band uses governed values only.**
  - **Evidence:** web/src/pages/dashboard/owner/MyListings.tsx:191-251 (KPI band computed purely from fetchOwnedVehicles/fetchCommunicationThreads results, no fabricated defaults); SellerWorkspaceConvergence.test.ts:27-33 only asserts the variable-name strings ('publishedCount', 'draftsNeedingAction', etc.) appear in the source, not that the band renders correct governed numbers.
  - **Gap:** Code reads correctly (real API data only, error states shown as 'Unavailable'/'Not tracked' rather than 0). No test drives real multi-listing data through the band and asserts the rendered figures, so downgraded from 'x'.
- [~] **I2. Published count.**
  - **Evidence:** MyListings.tsx:191-192 `publishedCount = myListings.filter(l => (publicationStatuses[l.vin]||l.publication_status)==='published').length`
  - **Gap:** Correct on reading; no dedicated test asserts a rendered published-count value for a fixture set.
- [~] **I3. Drafts needing action.**
  - **Evidence:** MyListings.tsx:193-197 `draftsNeedingAction` = non-published AND non-sold listings.
  - **Gap:** Logic correctly excludes sold/published; no dedicated test.
- [~] **I4. Buyer inquiries.**
  - **Evidence:** MyListings.tsx:187-189,239 — KPI 'Buyer inquiries' = marketplaceConversations.length (a Communications-thread count filtered by business_workflow/thread_type), not the durable inquiry-row total shown separately by SellerInquiriesCard beneath it.
  - **Gap:** Per the Golden spec's own comment (tests/agents/38-seller-staging-browser-golden.spec.ts:534-536), a communication thread is an 'asynchronous downstream projection' distinct from the durable inquiry record — exactly the conflation the evidence-quality bar warns about. The KPI is real governed data (not invented) but is a thread-count proxy for 'inquiries', which can lag or diverge from the true inquiry count. No test validates the two numbers agree.
- [~] **I5. Views/saves only where tracked.**
  - **Evidence:** MyListings.tsx:198-203,240-241 — trackedViews/rawSaveCounts filter to Number.isFinite values only; renders 'Not tracked' text when the array is empty rather than 0.
  - **Gap:** Correct on reading (matches the FIELD_STATES discipline used elsewhere in the codebase); no dedicated behavioral test.
- [~] **I6. Listing value aggregated only when currency semantics allow it.**
  - **Evidence:** MyListings.tsx:204-212 — canAggregateValue requires every listing priced+currencied AND a single distinct currency across all; otherwise renders 'Mixed / incomplete'.
  - **Gap:** Correct on reading; no test exercises a mixed-currency or partially-priced fixture set to confirm the fallback fires.
- [~] **I7. Large image + identity + lifecycle per listing.**
  - **Evidence:** MyListings.tsx:309-320 (large image panel, 340px column, min-h-[230px], VIN+identity overlay) and :322-334 (year/make/model + price header).
  - **Gap:** Structurally present on reading; 'large image' is a visual-design judgment with no automated check.
- [~] **I8. Draft / ready / published / reserved / sold are visually unmistakable.**
  - **Evidence:** STATUS_BADGE (MyListings.tsx:19-23: available=green, reserved=amber, sold=gray) + PUBLICATION_BADGE (web/src/lib/publicationStatus.ts:1-9: draft/identity_complete=slate, documents_submitted/review_pending=blue, publishable=amber, published=green), rendered together at MyListings.tsx:342-355; sold cards additionally get opacity-75 (line 306) and a 'Sale completed' footer note (line 517-521).
  - **Gap:** Five distinct label/color combinations exist by reading; no test asserts all five render visually distinct.
- [~] **I9. Exactly one dominant contextual action.**
  - **Evidence:** MyListings.tsx:297-301 computes a single `dominant` object (sold→Passport, published→Marketplace, else→Continue listing); rendered once at :335-339 as the only `bg-slate-950` filled button, versus many smaller `variant=outline` secondary actions in the 'Manage this listing' block.
  - **Gap:** Structurally guarantees exactly one dominant CTA per listing; no automated test asserts uniqueness (e.g. exactly one `listing-primary-` button exists), so kept at '~' per the strict evidence bar.
- [~] **I10. Draft action: Continue/Edit.**
  - **Evidence:** MyListings.tsx:301 — non-sold/non-published dominant action = 'Continue listing' → `/dashboard/sell-vehicle?vin=<vin>`.
  - **Gap:** Confirmed by reading; SellerWorkspaceConvergence.test.ts checks the string 'Continue listing' only for MyGarage.tsx, not for MyListings.tsx.
- [~] **I11. Draft action: Preview buyer listing.**
  - **Evidence:** MyListings.tsx:392-398 — 'Buyer Preview' button (unpublished) → `/marketplace/<vin>?mode=seller_preview`; string presence asserted in SellerWorkspaceConvergence.test.ts:35; the destination page's behavior at that URL is exercised by tests/agents/38-seller-staging-browser-golden.spec.ts:380-388 (see I19).
  - **Gap:** The Golden test navigates directly via page.goto to the seller_preview URL rather than clicking the MyListings button itself, so the click-through wiring is verified only by reading, not by a click-simulating test.
- [~] **I12. Draft action: Publication readiness.**
  - **Evidence:** MyListings.tsx:404-409 — `publication-readiness-<vin>` button, gated `!isSold && !isPublished`, → `/dashboard/sell-vehicle?vin=<vin>&stage=review`; string presence asserted in SellerWorkspaceConvergence.test.ts:36.
  - **Gap:** No test simulates clicking this control or asserts its conditional gating (present only for active drafts).
- [~] **I13. Published action: View on Marketplace.**
  - **Evidence:** MyListings.tsx:299-300 — published dominant action = 'View on Marketplace' → `/marketplace/<vin>`; string asserted in SellerWorkspaceConvergence.test.ts:37. Publish flow proven live: tests/agents/38-seller-staging-browser-golden.spec.ts:461-463 clicks `publish-toggle-<vin>` and asserts the badge becomes 'Published' via a real backend call.
  - **Gap:** That publish assertion sits early in the Golden spec (before the mid-journey hang described under I18/I20) so it plausibly executed in CI run 33346888849, but the spec does not itself click the MyListings 'View on Marketplace' dominant button — it separately confirms public visibility via the Marketplace search page (spec.ts:470-484).
- [~] **I14. Published management: performance.**
  - **Evidence:** MyListings.tsx:455-465 ('Performance' toggle, `toggle-insights-<vin>`) mounts `<ListingInsights vin=.../>` at :469-471; ListingInsights.tsx itself has a genuine targeted test (web/src/components/intelligence/ListingInsights.test.tsx) asserting truthful completeness/trust/metric rendering (no fabricated zeros, Trust never conflated with Completeness).
  - **Gap:** The mounted component is well-proven in isolation, but no test clicks the MyListings toggle and asserts ListingInsights actually renders inside MyListings. The toggle is unconditional (all lifecycle states, not just published), which is broader than the item's 'Published management' framing but not contradictory to it.
- [~] **I15. Price/availability.**
  - **Evidence:** Price sub-part strongly proven: web/src/pages/dashboard/owner/MyListings.price.test.tsx (12 tests, all passing — verified locally via `npx vitest run`) covers amount-only submission, currency displayed-not-editable, client+server validation, server-authoritative echo, rollback on refusal, no side effects on trust/publication/status, hidden when sold, and cancel. Availability sub-part (Mark sold) only unit-tested at the pure-function level: web/src/pages/dashboard/owner/MyListings.status.test.ts (normalizeListingStatus/isSoldListingStatus/applyPersistedListingStatus).
  - **Gap:** No component test clicks `mark-sold-<vin>` and asserts the resulting badge/opacity change inside MyListings.tsx; the only test that would (the Golden E2E, spec.ts:637-638) is not currently completing on this branch (see I18).
- [~] **I16. Evidence/Trust.**
  - **Evidence:** MyListings.tsx:399-403 'Evidence & Trust' → `/dashboard/garage/<vin>`; Canonical Trust block at :364-374 uses the shared, previously-hardened `readOwnerTrustClaim` helper (web/src/pages/dashboard/owner/ownerStatedValues.ts:20-46), which fails closed to 'null' unless evaluation_state==='evaluated'.
  - **Gap:** Helper is reused across multiple certified surfaces (documented extensively in its own file), but has no dedicated unit test file, and no MyListings-specific test exercises the trust block.
- [x] **I17. Inquiry response.**
  - **Evidence:** SellerInquiriesCard mounted at MyListings.tsx:253 (`<SellerInquiriesCard ownedListings={ownedLoaded ? myListings : undefined} />`); SellerInquiryList (web/src/components/marketplace/SellerInquiriesCard.tsx:50-123) renders mailto:/tel: reply links per inquiry, which is directly asserted by web/src/components/marketplace/SellerInquiriesCard.test.tsx ('renders buyer name, email, and phone as separate reply fields', 'links the vehicle identity to the Marketplace detail route').
  - **Note:** A targeted, pre-existing component test proves the actual response mechanism (contact channels), and the wiring into MyListings is confirmed by reading. The Golden E2E (spec.ts:556-560) additionally confirms real inquiry rows surface in this exact card against live staging, though that portion's completion status in the two most recent CI runs is uncertain (see I18/I20).
- [~] **I18. Unpublish/sold lifecycle.**
  - **Evidence:** Unpublish (MyListings.tsx:441-454, label flips 'Unpublish'/'Publish to Marketplace') and Mark sold (:416-440) both call real API mutations (unpublishVehicleListing/updateVehicleStatus) and apply only server-confirmed results. No local component test clicks these buttons (only negative non-interference assertions exist in MyListings.price.test.tsx:141-151). The only test that exercises them live — tests/agents/38-seller-staging-browser-golden.spec.ts:634-638 — is currently FAILING to complete on this branch: `gh run list --workflow seller-exact-head-staging-uat.yml` shows zero successful runs (failures at 33346888849, 33345485423, 33336163687, 33335452615, 33321072785, all 2026-08-30/31, all post-dating the 907486bd My Listings redesign commit); run 33346888849's own diff against this audited commit (823b6e8a) touches only an unrelated backend communications file.
  - **Gap:** Implementation reads correctly, but its only end-to-end proof source is presently broken on real deployed staging, so the unpublish/sold transition is not currently confirmed working outside unit-level function tests.
- [x] **I19. No draft Passport fallback mislabeled as a public listing.**
  - **Evidence:** MyListings.tsx:395 routes the non-published preview link exclusively through `?mode=seller_preview`; VehicleDetail.tsx:1804-1815 renders the 'Buyer Preview — not public' banner only when isSellerPreview, and :1963-1980 / :2059-2060 hide favorite/compare/share and all primary purchase actions in that mode. tests/agents/38-seller-staging-browser-golden.spec.ts:374-385 directly asserts this exact chain against live staging for a genuinely-drafted, never-published VIN (publication-badge contains 'Draft', seller-preview-banner contains 'Buyer Preview — not public', vehicle-detail-primary-actions/compare/share all have count 0). Backend independently enforces this: backend/services/marketplace/marketplaceListingDetailService.js:180-184 and listingSummaryService.js:1024-1034 (filterVisibleVehicles) 404 any non-published/non-'available'-status vehicle for audience='public' regardless of presentation_mode, so the public detail endpoint itself cannot leak an unpublished row.
  - **Note:** This assertion block sits before the CI run's later failure/hang point (spec.ts:401+ and the >538 region — see I18/I20), so it plausibly executed and passed in the most recent run (33346888849) before the run failed on later, unrelated steps.
- [ ] **I20. Desktop/tablet/mobile visual acceptance.**

  - **Evidence:** gh run list --workflow seller-exact-head-staging-uat.yml on this branch shows ZERO successful runs across every recorded attempt (2026-08-30 15:57 through 2026-08-31 01:38, runs 33321072785/33335452615/33336163687/33345485423/33346888849 all 'failure'). The most recent completed run (33346888849) fails on ALL THREE viewport projects (chromium desktop, tablet-chromium, mobile-chromium) of tests/agents/38-seller-staging-browser-golden.spec.ts. mobile-chromium fails with a concrete, reproducible defect: `TimeoutError: locator.tap: Timeout 20000ms exceeded` on the gallery's 'Next photo' control (spec.ts:401), whose call log shows it repeatedly intercepted by `<nav data-testid="compact-bottom-nav">` and `<vercel-live-feedback>`. chromium/tablet-chromium each hit the outer 180s test timeout somewhere later in the journey (exact line obscured because the finally-block's own cleanup failure — 'apiRequestContext.get: Target page, context or browser has been closed' — suppresses the original timeout error per JS try/finally semantics). MyListings.responsive.test.tsx only asserts a `flex-wrap` className substring on the action-row markup (source-string check under jsdom, no real layout), which is not cross-viewport visual acceptance.
  - **Gap:** This is active, reproducible counter-evidence, not merely an absence of proof: on the live deployed build matching this exact commit (823b6e8a and f50b5b07 are identical in web/src/pages/dashboard/owner/MyListings.tsx and web/src/pages/VehicleDetail.tsx — the only diff between them is an unrelated backend file), a fixed-position mobile navigation element blocks a required interaction on the Buyer Preview page reached from My Listings. Desktop/tablet/mobile visual acceptance for the Seller journey is not currently demonstrated and is currently failing CI.
### Phase I roll call
- [ ] **I-RC. Phase I complete:** lifecycle and actions are coherent and visually aligned with Home/Marketplace.

  - **Evidence:** Aggregate of above: 12 of 20 sub-items rest on code-reading rather than a targeted automated assertion (I1-I3, I5-I10, I12-I13, I16, I18), and the one test class that would give live, cross-cutting proof of lifecycle coherence — the Golden Dynamic Seller staging journey (tests/agents/38-seller-staging-browser-golden.spec.ts) — has never passed on this branch (0 successful runs; latest failure 33346888849, 2026-08-31T01:12:37Z) and fails on every viewport class.
  - **Gap:** Core Seller-owned mechanics (price change: I15's price half; inquiry response: I17; draft-not-mislabeled-public: I19) are solidly proven. But 'lifecycle and actions are coherent and visually aligned' cannot be certified while the only cross-viewport, end-to-end acceptance test for exactly this journey is actively red on the branch under audit. Recommend NOT_READY until the Golden staging UAT passes clean on chromium/tablet-chromium/mobile-chromium and at least the KPI-band and mark-sold/unpublish interactions get a dedicated component-level test.
---

# PHASE J — Authenticated Seller Studio convergence

**Goal:** the authenticated Seller workspace visually and functionally matches the approved CarUp Seller standard.

- [~] **J1. Dark automotive identity/stage region aligned with DESIGN.md.**
  - **Evidence:** web/src/pages/dashboard/owner/SellVehicle.tsx:868-959 (hero section, bg-[#07111f], stat tiles bg-[#0b1625], orange-300 eyebrow, font-black tracking-[-0.05em] headline). The same #07111f/#0b1625 dark-navy palette is reused verbatim in web/src/components/sell/SellIntentRouter.tsx:94, web/src/pages/GuestSell.tsx:369,414,474,522,673,760, and web/src/pages/VehicleDetail.tsx:1558 — i.e. it is the established converged-surface palette, matching DESIGN.md section 4.1 ('deep navy/near-black for decisive commerce and Trust regions') and 4.2/4.4 (uppercase letter-spaced eyebrows, high-weight display headings, squared stat tiles).
  - **Gap:** Genuine, consistent code-level match to DESIGN.md's written rules and to other already-converged surfaces. Downgraded from 'x' because no screenshot or visual-regression test exists — 'aligned with DESIGN.md' is ultimately a visual judgment I made by reading Tailwind classes, not one asserted by any test.
- [x] **J2. Clear stage progression.**
  - **Evidence:** SellVehicle.tsx:887 renders 'Stage {step + 1} of {STEPS.length}' reactively in the hero; the pre-existing StepIndicator (SellVehicle.tsx:136-150) renders numbered/checkmark circles with connecting progress lines. Functional stage progression is exercised by a passing render test: web/src/pages/SellFlow.media.test.tsx's advanceToMediaStep() clicks 'Next' twice and asserts distinct per-stage content appears in sequence (sell-vin-no-carup-record -> seller-privacy-controls -> listing-media-grid) — verified by running `npm run test:unit --workspace=web -- src/pages/SellFlow.media.test.tsx` (passed).
  - **Note:** Text derivation from step/STEPS.length is trivial and directly traced; underlying stage-to-stage transition is test-proven, even though the literal 'Stage X of Y' string itself isn't asserted by name.
- [~] **J3. Wide desktop composition.**
  - **Evidence:** SellVehicle.tsx:868 outer wrapper is `max-w-[1100px] mx-auto` (pre-existing, unchanged by this phase's commits). The hero uses an asymmetric `lg:grid-cols-[1.25fr_0.75fr]` split (copy left / large media panel right, SellVehicle.tsx:869) plus a `sm:grid-cols-2 xl:grid-cols-4` stat band (SellVehicle.tsx:906) — genuinely wider/editorial vs. a plain single-column card. DESIGN.md 4.3 sets a ceiling of 'up to 1440px', which 1100px satisfies but does not approach.
  - **Gap:** The hero/stage region is materially wider and more composed than the legacy narrow card form beneath it (which still uses `grid sm:grid-cols-2/3` inside one Card). No screenshot proof; rated on code trace only.
- [~] **J4. Calm mobile stack.**
  - **Evidence:** Hero grid defaults to single column on mobile (`grid gap-0 lg:grid-cols-...`), stat band defaults to 1 column (`sm:grid-cols-2 xl:grid-cols-4`), eyebrow row uses `flex flex-wrap`, StepIndicator hides step labels below `sm:` (SellVehicle.tsx:144 `hidden sm:block`).
  - **Gap:** Consistent with a calm mobile stack on inspection, but no responsive/viewport test or screenshot exists to confirm actual rendered behavior at a real mobile width.
- [x] **J5. Existing Passport facts hydrate where authority permits.**
  - **Evidence:** web/src/pages/SellerResume.contract.test.ts 'hydrates Passport identity without inventing commercial seller facts' asserts the exact hydration expressions in SellVehicle.tsx. web/src/pages/SellFlow.identification.test.tsx renders the real authenticated SellVehicle component, types an existing VIN, and asserts `sell-vin-passport-exists` appears — ran and passed (`npm run test:unit ... SellFlow.identification.test.tsx`).
  - **Note:** Real render-based test, not just string matching.
- [x] **J6. Canonical vs seller-editable fields are visibly distinct.**
  - **Evidence:** SellVehicle.tsx:756 `const canonicalLocked = serverDraftLoaded`, applied as `disabled={canonicalLocked}` on make/model/year/color/vin/engineNumber/chassisNumber/plateNumber/tempPlateId/importStatus/mileage/fuelType/transmission/drivetrain (14 fields). I wrote and ran an ad-hoc RTL test (rendered the real component with a mocked fetchOwnedVehicles returning a matching VIN): with `?vin=` present, `vehicle-make-input` and `vehicle-vin-input` were confirmed `.disabled === true` with hydrated value 'Toyota'; with no `?vin=`, the same field was confirmed `.disabled === false`. Both passed on first run; temp test file deleted after, no git residue.
  - **Note:** Upgraded from what would be '~' (code trace only) to 'x' because I directly verified the disabled/enabled DOM state under both conditions in a real render, not just by reading source.
- [x] **J7. Existing stored Seller draft hydrates instead of blank restart.**
  - **Evidence:** Same ad-hoc render test as J6: with `?vin=JTDKARFP0H3000731` and a mocked `fetchOwnedVehicles` resolving a server vehicle, `vehicle-make-input` value became 'Toyota' (not blank) and `seller-server-draft-loaded` testid appeared. Confirms SellVehicle.tsx:290-350's hydration effect actually populates the form instead of leaving INITIAL blank state.
  - **Note:** Directly observed via render, not inferred.
- [x] **J8. "Existing listing loaded" / equivalent resume orientation is clear.**
  - **Evidence:** SellVehicle.tsx:976-981 renders 'Existing Seller listing loaded.' with testid `seller-server-draft-loaded` when `serverDraftLoaded` is true. Confirmed present via my ad-hoc render test (waitFor on that testid succeeded).
  - **Note:** Clear, unambiguous resume orientation copy, test-confirmed to actually mount.
- [x] **J9. Media readiness visible.**
  - **Evidence:** SellVehicle.tsx:758,913 'Media readiness' tile reads `form.images.length` and `coverImageIndex`. Ad-hoc render test seeded a server vehicle with 2 `listing_media.items` (one `is_primary: true`) and asserted the hero contains '2 listing photos' and 'cover chosen' — passed.
  - **Note:** Directly rendered and asserted, not just string-presence.
- [x] **J10. Seller copy completeness visible.**
  - **Evidence:** SellVehicle.tsx:762-764 `sellerCopyState` computes `${form.description.length}/500 description characters` once length>=50. Ad-hoc test seeded a 60-char description and asserted the hero contains '60/500 description characters' — passed.
  - **Note:** Real DOM assertion, not just source-text matching.
- [x] **J11. Evidence state visible.**
  - **Evidence:** SellVehicle.tsx:759-761 uses the governed `statedCount(serverVehicle.counts?.verified_documents, 'verified document')` helper (web/src/pages/dashboard/owner/ownerStatedValues.ts:87-94, which fails closed to 'not recorded' rather than fabricating a 0 — the same helper used by the already-audited My Garage surface). Ad-hoc test seeded `counts.verified_documents: 3` and asserted the hero contains '3 verified documents' — passed.
  - **Note:** Reuses a well-designed, fail-closed helper; genuinely test-confirmed end-to-end.
- [x] **J12. Canonical Trust state visible.**
  - **Evidence:** SellVehicle.tsx:757,922-925 `readOwnerTrustClaim(serverVehicle)` (ownerStatedValues.ts:39-53, narrows only, never invents a score outside the `evaluated` state) drives testid `seller-studio-trust-state`. Ad-hoc tests confirmed both an evaluated case ('74 / 100 · Moderate trust') and a `not_evaluated` case ('Not evaluated') render correctly, not just a truthful-empty-state stub.
  - **Note:** Both the populated and empty/unavailable states were exercised, directly satisfying the evidence bar's concern about a truthful empty state not proving real instrumentation — here the populated case was also proven with real data.
- [x] **J13. Privacy projection visible.**
  - **Evidence:** SellVehicle.tsx:929-932 renders 'Location: {...}' and 'Seller identity: {...}' from `form.locationVisibility`/`form.publicSellerDisplay`, hydrated at SellVehicle.tsx:340-343 from `raw.listing_location_visibility`/`raw.public_seller_display_enabled`. Ad-hoc test seeded `listing_location_visibility: 'province_only'`, `public_seller_display_enabled: false` and asserted the hero contains 'Location: province only' and 'Seller identity: withheld' — passed.
  - **Note:** Real render assertion covering a non-default privacy state, not just the default.
- [~] **J14. Publication blockers exact and actionable.**
  - **Evidence:** SellVehicle.tsx:1524-1528 wires the real `VehicleCompletenessPanel` into the Review step, gated on `serverDraftLoaded && validateVin(form.vin)`. VehicleCompletenessPanel.tsx:154-162 renders an exact, itemized 'Publication is blocked' list from `data.blocking_gaps`, with actionable 'Upload documents'/'View my garage' CTAs (lines 195-205). web/src/components/VehicleCompletenessPanel.test.tsx directly asserts this exact/actionable rendering (blocking_gaps content, 'blocks publish' badge) with real fixtures.
  - **Gap:** The panel's own contract is strongly test-proven, but no test exercises SellVehicle end-to-end through to the Review step with `serverDraftLoaded=true` to confirm this specific wiring point (only a string-containment check that the testid exists in source). I traced the wiring by reading it and it is correct, but did not independently render-test that integration point, so this stays at '~' rather than 'x'.
- [x] **J15. Buyer Preview CTA present.**
  - **Evidence:** SellVehicle.tsx:937-939 renders a 'Buyer Preview — not public' CTA (testid `seller-buyer-preview`) linking to `/marketplace/${vin}?mode=seller_preview`, gated on `validateVin(form.vin)`. Wired into the same governed dual-mode VehicleDetail architecture as MyListings (web/src/pages/dashboard/owner/MyListings.tsx:395) per web/src/pages/VehicleDetail.presentationMode.test.ts ('Seller Phase K — one buyer presentation, two governed modes'), which asserts real authorization gating (`fetchOwnedVehicles()`, `sellerPreviewAuthorization !== 'allowed'`), a seller-preview banner, and disabled buyer transactions/sidebar in preview mode. Ran `npm run test:unit --workspace=web -- src/pages/VehicleDetail.presentationMode.test.ts src/pages/VehicleDetail.parity.test.ts` — 12/12 passed.
  - **Note:** Strong: not a bare marketplace link but a governed, authorization-checked preview mode with its own dedicated, passing test suite.
- [~] **J16. One primary action per stage; legacy equal-weight action clusters removed.**
  - **Evidence:** Full inventory of all 11 `<Button>` usages in SellVehicle.tsx (lines 812-813, 847-848, 937, 1081/1084 [owner/authorised-seller toggle — a single-select control, not a competing-action pair], 1098, 1454, 1559/1563/1576 [Back = outline/secondary, Next-or-Save = orange primary — exactly one dominant CTA per stage footer]). No equal-weight competing action pair (e.g. a legacy side-by-side 'Save Draft' / 'Publish' pair) was found anywhere in the file.
  - **Gap:** High-confidence manual code trace across the entire 1585-line file, but no automated test asserts 'exactly one primary action' the way MyListings.tsx is via its `listing-primary-` naming convention in SellerWorkspaceConvergence.test.ts. Kept at '~' per the evidence bar's preference for a direct test over reading-based confidence on a structural claim.
- [~] **J17. Accessibility: labels, errors, keyboard, focus, touch.**
  - **Evidence:** Strengths (test-proven): SellFlow.media.test.tsx asserts real aria-labels ('Make photo N the cover photo', 'Remove listing photo N'), keyboard-operable reorder (buttons, not drag-only), and `focus:opacity-100`/`focus-within:opacity-100` classes so controls reveal on keyboard focus — all passing. Autosave state uses `role="status" aria-live="polite"` (SellVehicle.tsx:964-965); the hero title uses `aria-labelledby` (SellVehicle.tsx:884); the Next button sets `aria-busy` while checking (SellVehicle.tsx:1567). Gaps (found by direct reading): `grep -c '<label' SellVehicle.tsx` = 26, but only 1 has `htmlFor` (the location-visibility select, line 1250) — the other 25 (Make, Model, Year, Color, VIN, Engine/Chassis/Plate/TIP, Import Status, Mileage, Condition, Body Style, Fuel/Transmission/Drivetrain, Price/Currency, Description, etc.) are visually adjacent `<label>` text with no `htmlFor`/`id` association to their control. There is no focus management anywhere in the file (`grep -n '\.focus()\|autoFocus\|scrollIntoView'` returned nothing) when the wizard advances/regresses steps. The Back/Next/Save buttons use the shared shadcn Button default size (`h-9` = 36px, web/src/components/ui/button.tsx:23), below the commonly-cited 44px touch-target minimum.
  - **Gap:** Genuinely mixed: excellent, test-proven accessibility in the S4 media-reorder controls, but a real, unremediated label-association gap across most of the form and no step-to-step focus management. This is a concrete finding, not a hedge.
- [~] **J18. Desktop/tablet/mobile visual acceptance.**

  - **Evidence:** Same responsive-class evidence as J3/J4 (hero grid collapses on mobile via `lg:grid-cols-...`, stat band via `sm:grid-cols-2 xl:grid-cols-4`, step labels `hidden sm:block`). No visual-regression test, no screenshot captured, and no Playwright/browser-based check was run against a live instance of this route (would require standing up the authenticated dashboard against a backend, judged out of scope for this forensic pass).
  - **Gap:** Not proven by any automated or visual artifact in the repo; rated on code trace only, one notch above 'not proven' because the responsive classes are real and consistently applied.
### Phase J roll call
- [~] **J-RC. Phase J complete:** authenticated Seller Studio is no longer a legacy visual fork.

  - **Evidence:** 12 of 18 sub-items (J2, J5-J13, J15) are proven with real render-based tests (existing suite + two ad-hoc component-level tests I authored, ran, and deleted). 5 items (J1, J3, J4, J14, J16, J18) are implemented and traced with high confidence but lack a direct automated/visual assertion. J17 has a concrete, identified accessibility regression (missing label associations, no focus management, sub-44px touch targets) alongside strong test-proven accessibility elsewhere.
  - **Gap:** The Studio is materially converged in data-truthfulness and functional terms (this is the strongest part of the phase), but 'no longer a legacy visual fork' also requires the visual-acceptance and accessibility bar to be met, and neither is fully certified: J17's label/focus/touch gaps are real defects, not just missing tests, and J1/J3/J4/J18 have zero visual-regression evidence. Roll-call should stay open pending (a) a visual/screenshot pass across desktop/tablet/mobile, and (b) fixing the label-association and step-focus accessibility gaps.
---

# PHASE K — Shared Buyer Preview / Marketplace Vehicle Detail architecture

**Goal:** one buyer presentation architecture, two governed modes.

- [x] **K1. Shared domain presentation layer exists.**
  - `seller_preview`
  - `marketplace_public`
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1152-1155 defines presentationMode as exactly 'seller_preview' | 'marketplace_public' from the `mode` query param; VehicleDetail.presentationMode.test.ts (5 tests) passes locally (`npx vitest run src/pages/VehicleDetail.presentationMode.test.ts` -> 5 passed).
  - **Note:** One component, one discriminated presentationMode variable, not two pages/components. Both SellVehicle.tsx and MyListings.tsx route into it via ?mode=seller_preview (grep confirmed).
- [x] **K2. Shared gallery.**
  - **Evidence:** VehicleDetail.tsx:1804-1975 renders the gallery (`listing-media-block`, `image-gallery`) unconditionally; the only isSellerPreview branch inside it hides the save/compare icon overlay (line ~1963). VehicleDetail.media.test.tsx (135 tests across the 4-file gate, run locally, all pass) exercises published/none/not_loaded states, primary photo, photo_label, dual transports, url-honesty, all rendered via `/marketplace/${VIN}` (marketplace_public, no mode param).
  - **Note:** Gallery contract itself has no seller_preview/marketplace_public branch; only the corner-icon overlay differs, and that difference is covered separately by K11.
- [x] **K3. Shared commercial identity/decision panel.**
  - **Evidence:** VehicleDetail.tsx:2295-2345 (Info card: VIN, plate/temp-id/withheld state, registration badge, trust-score-badge) is rendered unconditionally, not inside an isSellerPreview branch. VehicleDetail.trust.test.tsx renders the page at `/marketplace/${VIN}?mode=seller_preview` and asserts real content on `trust-score-badge`/`sidebar-trust` (e.g. lines 243-260); all 30 tests in that file pass.
  - **Note:** Header/identity/trust badge block is one render path for both modes; verified by an actual RTL render, not just source grep.
- [x] **K4. Shared canonical Trust/source coverage.**
  - **Evidence:** VehicleDetail.tsx:2085-2088 renders TrustSummaryPanel/TrustDecisionPanel/SourceCoveragePanel with no isSellerPreview gate (gated only by `detail` truthiness). VehicleDetail.trust.test.tsx (30 tests, run locally, all pass) proves the canonical-trust reading (`readPublicTrust`) end-to-end: null score never renders as 0, insufficient_evidence vs low vs not-evaluated are distinct, stale evaluations withheld, legacy passport engine score refused.
  - **Note:** Trust reading logic itself has no mode branch; the panel that reads `detail.trust_summary` is the same instance for both modes.
- [~] **K5. Shared pricing/cost context.**
  - **Evidence:** VehicleDetail.tsx:2091 renders `<AllInPricePanel pricing={detail.pricing_summary} />` unconditionally within the `{detail && (...)}` block (no isSellerPreview branch). Only source-text pin found: VehicleDetail.parity.test.ts:35 asserts the AllInPricePanel source contains 'All-in cost estimate'.
  - **Gap:** Code reads correctly (shared instance, gated only by `detail`), but no test in the Phase K gate actually renders VehicleDetail with a populated `detail.pricing_summary` and asserts the panel's rendered content — trust.test.tsx and sellerStatement.test.tsx both reject fetchMarketplaceListingDetail, and media.test.tsx doesn't inspect pricing. Downgraded per the evidence bar (code-path-looks-correct vs. a test that actually exercises it).
- [x] **K6. Shared evidence/registration presentation.**
  - **Evidence:** VehicleDetail.tsx ~2188-2280 (`verified-evidence-block`) is unconditional. VehicleDetail.media.test.tsx has extensive real-render coverage: verified-evidence-item/empty/not_loaded, dual-transport resolution, withheld_private artifacts still rendering as governed facts (e.g. lines 643-760, 1423-1440), evidence vs listing-media disjointness (line 722-723). All pass.
  - **Note:** Registration/identity presentation (plate/temp-id/withheld) at VehicleDetail.tsx:2295-2325 is likewise unconditional, matching K6's scope.
- [x] **K7. Shared seller description/features.**
  - **Evidence:** VehicleDetail.sellerStatement.test.tsx (5 tests, run locally, all pass) renders the real component at `/vehicle/${VIN}?mode=seller_preview` and asserts `seller-description`, `seller-features`, `spec-seller-condition` (labelled seller-stated, never 'verified/certified/confirmed/inspected'), `spec-body-style`, and that absent seller copy renders nothing fabricated.
  - **Note:** The description/features code (VehicleDetail.tsx ~2350-2392) has no isSellerPreview branch, so the same test coverage generalizes to marketplace_public by direct reading.
- [~] **K8. Shared lifecycle/history.**
  - **Evidence:** VehicleDetail.tsx ~2400-2490 (`history-timeline`, canonical-lifecycle vs legacy-audit fallback) is rendered unconditionally inside the Tabs, with no isSellerPreview branch.
  - **Gap:** No test in the 4 Phase-K-gate files (or elsewhere found) mounts VehicleDetail with lifecycle events and asserts the timeline actually renders. Confirmed only by direct code reading — no isSellerPreview conditional exists around this block — so marked '~' per the evidence bar rather than 'x'.
- [~] **K9. Shared ownership/service/insurance/PartSentry sections.**
  - **Evidence:** Ownership: VehicleDetail.tsx:2904-2960 (Ownership Summary card) is unconditional. Service: lifecycle category 'service' + trustSignals.maintenance_logs_count feed the same shared code. Insurance/PartSentry: not rendered by name in VehicleDetail.tsx itself, but surfaced through the shared TrustSummaryPanel (web/src/components/marketplace/TrustSummaryPanel.tsx:26-71, 'PartSentry' row) and TrustDecisionPanel ('insurance_eligibility' dimension label), both rendered unconditionally when `detail` exists (VehicleDetail.tsx:2085-2087).
  - **Gap:** All four sub-facts are present in source and structurally unconditional on isSellerPreview, but no test renders VehicleDetail with real ownership+PartSentry+insurance data and asserts all four appear together in either mode — trust.test.tsx forces fetchMarketplaceListingDetail to reject, so the PartSentry/insurance path (which lives behind `detail`) is never actually exercised by an automated VehicleDetail test. High-confidence code trace, not a direct test — '~'.
- [x] **K10. Seller preview is clearly "Buyer Preview — not public".**
  - **Evidence:** VehicleDetail.tsx:1805-1811, data-testid="seller-preview-banner" containing 'Buyer Preview — not public'. VehicleDetail.presentationMode.test.ts:19 asserts the source contains that exact testid (test passes). tests/agents/38-seller-staging-browser-golden.spec.ts (commit 5a40e14b) asserts `page.getByTestId('seller-preview-banner')).toContainText('Buyer Preview — not public')` against a real staged deploy.
  - **Note:** The Golden Playwright spec is real E2E evidence but requires live staging access I did not execute in this session; treated as strong corroborating (not independently re-run) evidence, on top of the passing unit test.
- [x] **K11. Buyer transactional controls disabled/replaced in Seller preview.**
  - **Evidence:** VehicleDetail.tsx:2059 (`detail && !isSellerPreview` gates 'Ask about this vehicle'/'Request an inspection'), :1963 (`!isSellerPreview` hides save/compare icons), :2727-2734 (isSellerPreview replaces the entire Call/WhatsApp/Reserve/Financing sidebar block with a 'Buyer actions are disabled' panel), :2092-2098 ('Buyer transactions disabled in preview' replacing Contact&inquire in the marketplace-detail-panels block). VehicleDetail.presentationMode.test.ts:29-34 and VehicleDetail.parity.test.ts:38-48 pin these exact strings/testids; the Golden spec (5a40e14b) asserts zero count for vehicle-detail-primary-actions/compare/share and visibility of seller-preview-sidebar-disabled on a live deploy.
  - **Note:** Every buyer transactional surface I found (contact, reserve, finance, save, compare, share, inquiry) is either absent or explicitly replaced by a disabled-state panel in isSellerPreview; none rendered live in preview mode.
- [~] **K12. Seller editing controls stay outside buyer presentation.**
  - **Evidence:** Exhaustive grep of the full 3128-line VehicleDetail.tsx for `<Input`, `onChange=`, `Edit `, `updateVehicle`, `patchVehicle` found exactly one Input (the VIN/plate lookup search box in the marketplace_public header, not a vehicle-field editor) and zero write/update handlers. Seller-Studio buttons ('Return to editing', 'Back to Seller Studio') are outbound `<Link>`s to /dashboard/sell-vehicle, not inline editors.
  - **Gap:** No dedicated automated test asserts the absence of editing controls on this page — this is my own exhaustive text-search verification, not a test the CI gate runs, so downgraded to '~' per the evidence bar even though confidence is high.
- [x] **K13. Marketplace public mode requires published state.**
  - **Evidence:** backend/routes/marketplaceRoutes.js:133-135 calls `getMarketplaceListingDetail(supabase, req.params.id, { audience: 'public', ... })` unconditionally — `presentation_mode` only toggles the `emitListingOpened` intelligence event (line 134), never the `audience`. backend/services/marketplace/marketplaceListingDetailService.js:180-184 applies `filterVisibleVehicles` for the public audience; backend/services/marketplace/listingSummaryService.js:1024-1034 filters on `isPublicVehicleStatus` and `isPubliclyVisiblePublication`. backend/tests/marketplace-publication-gate.test.js, run locally (`node --test`, 9/9 pass), directly asserts `getMarketplaceListingDetail(supabase, DRAFT_VIN, {audience:'public'})` rejects with 'Listing not found' and a published VIN resolves.
  - **Note:** Because seller_preview and marketplace_public both resolve `detail` through the identical audience:'public' call, the same hermetic test that proves marketplace_public requires publication also proves the marketplace-commercial block (trust_summary/pricing/inquiry) is equally gated in Seller Preview. Note: the separate Vehicle Passport (VIN) lookup path used for the base vehicle/gallery/description is intentionally NOT publication-gated (VIN lookup is documented elsewhere on this page as 'open to everyone') — that is a distinct, pre-existing surface, not the Marketplace commercial contract K13 addresses, and its own listing-photo leak was independently closed via `listingPublicationStatus`/`listingAudience` params into the media contract (backend/server.js:1084-1091).
- [x] **K14. Public inquiry/transaction controls active only when governed.**
  - **Evidence:** VehicleDetail.tsx:2059 (`detail && !isSellerPreview`) gates the primary Ask/Inspect actions; :2727-2854 gates Call/WhatsApp/Reserve/Financing/InquiryModal behind `detail ? (...) : (<div data-testid="marketplace-actions-unavailable">...)`. Combined with K13's proof that `detail` only resolves for a published listing (backend/tests/marketplace-publication-gate.test.js, PASS), transactional controls are provably inert until the listing is governed-public.
  - **Note:** Directly composed from the K13 evidence plus the `detail`-gated JSX; no separate test targets this exact composition, but both halves are independently test-proven.
- [~] **K15. No second legacy Seller-preview design remains.**
  - **Evidence:** `grep -rln "SellerPreview\|seller-preview\|SellerListingPreview" web/src` (excluding tests) returns only VehicleDetail.tsx. `git log --oneline --all | grep -i 'phase-k\|shared-detail\|shared buyer'` shows this whole architecture (commits a1a2db83, 84aa8c38, 5a40e14b, 317a95dc, dd0159a1, 6af45a37) was newly authored on 2026-08-30/31 with no prior competing implementation found. GuestSell.tsx has an unrelated pre-account 'buyer preview' Dialog, but web/src/pages/GuestSell.preview.test.tsx's own docstring states it reuses 'the actual Marketplace listing card' and that 'the bespoke layout it replaced is gone' — a card-level preview for a pre-VIN, pre-account draft, not a competing VehicleDetail-page design.
  - **Gap:** This is my own repo-wide negative-space search rather than an automated regression test that would catch a future re-introduction of a duplicate design, so marked '~' rather than 'x' despite finding nothing.
- [x] **K16. Draft preview does not require pretending the draft is a public Marketplace listing.**

  - **Evidence:** git show a1a2db83 (MyListings.tsx): unpublished listings link to `/marketplace/${vin}?mode=seller_preview` ('Buyer Preview'), only published ones get the bare `/marketplace/${vin}` ('Public detail') URL. Combined with K13's proof that `detail` stays gated/null for an unpublished VIN even when presentation_mode=seller_preview, the draft case renders VehicleDetail.tsx's isSellerPreview-disabled sidebar (line 2727, 'Buyer actions are disabled... Publication state is not changed by previewing') rather than fabricating a published marketplace state.
  - **Note:** No marketplace-only fields (trust_summary/pricing_summary/inquiry CTAs) are invented for a draft in seller_preview — they simply stay absent (same `detail`-gated block used everywhere), which is the correct way to avoid 'pretending the draft is public'.
### Phase K roll call
- [~] **K-RC. Phase K complete:** preview/public cannot drift because they share the same presentation contract.

  - **Evidence:** Core shared-page mechanism (presentationMode discriminator, gallery, evidence, trust reading, seller statements, buyer-preview banner/disabled controls, publication gating of the marketplace commercial block, and draft routing) is real, is a single render tree with no forked component, and is backed by passing unit tests (VehicleDetail.presentationMode.test.ts, VehicleDetail.media.test.tsx, VehicleDetail.sellerStatement.test.tsx, VehicleDetail.trust.test.tsx — 145 tests total, all run locally and passing) plus a passing backend hermetic test (marketplace-publication-gate.test.js, 9/9).
  - **Gap:** Not a clean PASS: K5, K8, K9, K12 and K15 are real on reading but lack a direct automated assertion exercising that specific sub-contract on this page (pricing panel content, lifecycle timeline, ownership/insurance/PartSentry composition, absence of edit controls, absence of a duplicate design). The 'cannot drift' guarantee therefore holds by construction (one component, few narrow isSellerPreview branches, none of which touch those five areas) but is not yet fully certified by tests the way K1-K4/K6/K7/K10/K11/K13/K14/K16 are.
---

# PHASE L — Dynamic Marketplace parity for Seller-created vehicles

**Goal:** a normal Seller-created vehicle has the same information architecture as a rich Marketplace reference vehicle.

- [x] **L1. Photos/gallery parity**
  - **Evidence:** web/src/pages/VehicleDetail.media.test.tsx describe blocks 'a photo on the Marketplace card is a photo on this page' (370-445), 'BOTH blocks published at once' (1312-1526), and 'renders no carousel for a single photo, however many artifacts sit beside it' (1371). These render VehicleDetail with 1-photo and multi-photo fixtures and assert the same gallery architecture (data-testid=image-gallery, listing-media-thumb, vehicle-image). Confirmed passing via vitest (60/60 across the 5 web spec files run).
  - **Note:** Strong direct-render coverage, not just source-grep.
- [x] **L2. Commercial identity parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:2038,2300,2358-2361 render make/model/year/mileage/transmission/fuel/body_style directly off vehicle.X with null-safe guards, unconditional on VIN. backend/tests/seller-cross-surface-convergence.test.js:84-96 'make, model, year and body style read identically on both projections' asserts field-by-field equality between the Marketplace-card projection and the Vehicle Detail projection for the same row. Passed (110/110 node --test run).
- [x] **L3. Price/currency parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1138-1142 governedPrice() is the single formatting function used at all 3 price render sites (2050,2654,2718); returns 'Price not recorded' unless both a numeric price and a real currency string are present. backend/tests/seller-cross-surface-convergence.test.js 'mileage, price and currency agree, and an absent one is absent on both' and 'a currency with no provenance is published by neither surface' passed.
- [x] **L4. Trust parity**
  - **Evidence:** web/src/pages/VehicleDetail.trust.test.tsx (60 tests, all passing) directly renders VehicleDetail with varying canonical-trust fixtures: null/not-evaluated (242-298), insufficient-evidence-as-measured-zero (300-388), stale/superseded (390-438), no invented tiers (440-480) — same component/testids for every state.
- [x] **L5. Source coverage parity**
  - **Evidence:** web/src/components/SourceCoveragePanel.test.tsx:11-17 'renders a row for all five registries even when none checked' and :18-22 'shows Not yet checked for providers with no result' directly assert the panel keeps the full 5-row architecture for a zero-coverage vehicle, vs :32-57 asserting confirmed/conflict/unavailable states. Test file passed.
- [x] **L6. Government/partner checks parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:822-905 buildVerificationSources() renders ZIMRA/CVR/ZRP/odometer/stolen-alert rows generically off passport.trustSignals. web/src/pages/VehicleDetail.trust.test.tsx:497-522 directly renders the Verification tab with signals absent (asserts unknown/'reported no registry, clearance or odometer signals') and with signals present (asserts 'Vehicle registered in Central Vehicle Registry') — same code path, both states proven by render+assert.
- [~] **L7. Cost estimate parity**
  - **Evidence:** web/src/components/marketplace/AllInPricePanel.tsx is a pure generic renderer over pricing_summary fields (filters by typeof value === 'number', no hardcoded values); VehicleDetail.tsx:2091 passes detail.pricing_summary unconditionally. VehicleDetail.parity.test.ts:35 only substring-checks the panel contains 'All-in cost estimate'.
  - **Gap:** No render test exists for AllInPricePanel — TrustSummaryPanel (a sibling panel) is explicitly vi.mock()'d out in the render-based VehicleDetail test suites and AllInPricePanel is never independently rendered/tested either. Code reading gives high confidence it is generic, but no test renders it with a sparse vs rich pricing_summary and asserts the DOM. Downgraded from 'x'.
- [~] **L8. Inquiry parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:2061-2109,2752-2814 mounts <InquiryModal> unconditionally (gated only by detail && !isSellerPreview, never by vehicle data richness), with contact/reservation/financing entry points driven by generic state. VehicleDetail.parity.test.ts confirms <InquiryModal is used and InquiryModal.tsx exports marketplace-inquiry-open.
  - **Gap:** No InquiryModal.test.* file exists and no VehicleDetail render test actually opens/exercises the modal for a low-data vehicle — evidence is code-reading + substring assertion only. This item is UI-parity scope only; full inquiry-capture proof belongs to Phase Q.
- [x] **L9. Registration/evidence parity**
  - **Evidence:** web/src/pages/VehicleDetail.media.test.tsx describe 'evidence renders as a governed artifact, never as an identity' (643-792) directly renders the evidence list with populated and near-empty evidenceVault fixtures and asserts field-by-field construction, the public gate, and distinct empty/not_loaded states (506-611).
- [x] **L10. Seller statements parity**
  - **Evidence:** web/src/pages/VehicleDetail.sellerStatement.test.tsx (5 tests, all passing): renders seller_description, seller_features, seller_stated_condition labelled as statement, and body_style, plus 'keeps missing missing — no fabricated description, features, condition or body style' (182).
- [~] **L11. Lifecycle parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1726,2415-2483 renders history-timeline generically off passport.lifecycle.events, with an explicit 'Vehicle lifecycle was not loaded' fallback and a data-driven per-category icon map (line 774).
  - **Gap:** No test renders VehicleDetail with populated vs empty lifecycle events and asserts the timeline DOM — only VehicleDetail.parity.test.ts substring-checks the fallback text exists. Downgraded from 'x' for lack of a direct behavioral test.
- [x] **L12. Ownership parity**
  - **Evidence:** web/src/pages/VehicleDetail.media.test.tsx:612-626 'renders ownership history source failure as unavailable rather than zero transfers' renders with ownershipSummary.previousOwnerCountState:'unavailable' and asserts prev-owner-count-unavailable renders while prev-owner-count does not.
- [x] **L13. Service parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:901-907 'Service Records' row driven by m.maintenance_logs_count within buildVerificationSources, plus an independent Market-Analysis-tab rendering at 2664-2670 with service-records-unrecorded testid. The first path is exercised by VehicleDetail.trust.test.tsx's absent/present-signals tests (497-522), which include this row in the same array.
- [~] **L14. PartSentry parity**
  - **Evidence:** web/src/components/marketplace/TrustSummaryPanel.tsx:27-31,71 renders a generic 'PartSentry' row keyed off trust.partsentry_public_status including a not_applicable/'No PartSentry data' state; backend marketplaceTrustSummaryService.js computes partsentry_public_status generically from partSentryRows for any VIN. VehicleDetail.tsx:2085 passes detail.trust_summary unconditionally.
  - **Gap:** TrustSummaryPanel is explicitly vi.mock()'d to () => null in both VehicleDetail.media.test.tsx:112 and VehicleDetail.sellerStatement.test.tsx:73, so no VehicleDetail render test exercises the PartSentry row at all. Only backend unit coverage (partsentry-review-workflow.test.js, partsentry-write-truth.test.js) and a parity.test.ts substring check exist. Downgraded from 'x'.
- [~] **L15. Insurance parity**
  - **Evidence:** 'insurance' is one lifecycle/evidence category folded into the same generic timeline/evidence machinery used for service, ownership_transfer etc. (VehicleDetail.tsx:759,787 timelineIcon/lifecycleIcon maps; evidence caption at 2201-2203 names 'insurance' alongside registration/customs/service).
  - **Gap:** No dedicated Insurance panel and no test exercises an 'insurance'-category row specifically for either vehicle type. Rests on generic-mechanism inference only — kept at '~'.
- [x] **L16. Reservation/SafePay readiness parity**
  - **Evidence:** web/src/pages/VehicleDetail.media.test.tsx (1015-1143): 'keeps reservation authority server-owned and offers only the governed request step' (1051), 'does not turn a stale Reserved status cache into an active reservation claim' (1070), 'renders Reserved only when the canonical reservation summary is actively reserved' (1091) — all render-tested against the same generic isReservedOnServer/reserveRequested logic at VehicleDetail.tsx:2765-2789.
- [x] **L17. Seller privacy parity**
  - **Evidence:** web/src/pages/VehicleDetail.media.test.tsx:1016-1028 'keeps withheld and unrecorded as different identifier states' renders with identifiersRedacted:true and asserts identity-field-withheld ('Not shown publicly') vs identity-field-unrecorded render distinctly; backend/tests/seller-reconciliation-privacy.test.js and seller-location-province-only.test.js (all passing) prove the same vocabulary cross-surface.
- [~] **L18. Save parity**
  - **Evidence:** web/src/pages/VehicleDetail.tsx:1961-1977 renders the Save/Compare/Share cluster unconditionally, gated only by !isSellerPreview — no vehicle-data branching exists. toggleFavorite/isFav logic (1483-1526) is VIN-generic.
  - **Gap:** No behavioral test exercises the Save button for two different VIN fixtures; only VehicleDetail.parity.test.ts substring-checks the markup exists. Kept '~' per the evidence bar despite high reading confidence.
- [~] **L19. Compare parity**
  - **Evidence:** Same unconditional-render block as L18 (VehicleDetail.tsx:1966-1972); compareHref (1537) built generically from vehicle.vin.
  - **Gap:** No dedicated render/behavior test; substring-only evidence plus code reading. Kept '~'.
- [~] **L20. Share parity**
  - **Evidence:** Same unconditional-render block as L18/L19 (VehicleDetail.tsx:1976); handleShare is generic.
  - **Gap:** No dedicated render/behavior test; substring-only evidence plus code reading. Kept '~'.
- [ ] **L21. Recommendations parity where applicable**
  - **Evidence:** grep across web/src and backend for recommendation/similar-vehicle/related-vehicle features touching VehicleDetail returned nothing (only unrelated admin ReferralTrustReview.tsx hits); git log --all --grep=recommend shows no Seller/Marketplace recommendations work.
  - **Gap:** No Recommendations/Similar-vehicles feature exists anywhere in VehicleDetail or marketplace surfaces for either vehicle type. The item reads 'where applicable' but no documented decision that it's inapplicable was found, so it cannot be marked cleared.
- [x] **L22. Missing states preserve the same section architecture.**
  - `Pending`, `Not evaluated`, `Source not connected`, `Not available`, etc.
  - **Evidence:** web/src/pages/VehicleDetail.parity.test.ts:50-63 asserts presence of 'Not recorded','not evaluated','Marketplace actions unavailable','Vehicle lifecycle was not loaded','History report unavailable' plus SourceCoveragePanel's 'pending'/'Source unavailable'/'Not yet checked'. Corroborated by many direct render tests (VehicleDetail.media.test.tsx, .trust.test.tsx) exercising the actual missing-state branches for photos, evidence, ownership, plate-history and trust signals, all preserving the same section markup rather than hiding the section.
  - **Note:** Aggregate verdict across individually-verified sub-behaviors (see L1, L6, L9, L12, L16, L17).
- [x] **L23. No seeded/reference-only presentation path is required.**

  - **Evidence:** VehicleDetail.parity.test.ts:18-19 asserts source contains no mockVehicles and no /referenceVehicle|goldenVehicle|seededVehicle/. Independently confirmed by grep: no GOLDEN/Golden/hardcoded golden-VIN branch in VehicleDetail.tsx or backend/services/marketplace/marketplaceListingDetailService.js/listingSummaryService.js — getMarketplaceListingDetail() (marketplaceListingDetailService.js:163-273) is a single query-by-VIN function with no reference-vehicle special case.
### Phase L roll call
- [~] **L-RC. Phase L complete:** Seller-created and reference vehicles share the same structural experience without copied fake data.

  - **Evidence:** Architecturally single, VIN-generic code paths with no seeded/reference-only branch (L23=x) and comprehensive proven missing-state handling (L22=x, backed by L1/L6/L9/L12/L16/L17=x). CI gate .github/workflows/seller-phase-lm-parity-trust.yml correctly scoped; its full test set (60 web + 110 backend) passes on the checked-out tree.
  - **Gap:** Not a clean pass: L21 has no evidence of ever being addressed; L7/L8/L11/L14/L15/L18/L19/L20 rest on generic/unconditional code confirmed by reading but lacking a direct render/behavioral test for the exact contract — TrustSummaryPanel and AllInPricePanel are actively mocked to null in the only render-based VehicleDetail suites, so PartSentry/cost-estimate DOM is never actually asserted end-to-end.
---

# PHASE M — Trust, readiness, completeness, and privacy semantics

**Goal:** prevent one decorative number from laundering uncertainty.

- [x] **M1. Canonical Trust remains the only Trust authority.**
  - **Evidence:** backend/services/trustDecision/canonicalTrustService.js:1-114 (INV-TRUST-2 single-writer contract, toPublicTrust() 10-field public shape); web/src/pages/VehicleDetail.trust.test.tsx (26/26 pass, verified by direct run) asserts legacy raw trust_score(84)/deprecated-engine(90)/decision-route(50) never reach VehicleDetail or VehicleProfile; web/src/pages/dashboard/owner/OwnerDashboard.trust.test.tsx (41/41 pass) asserts the same for the owner dashboard rail; backend/tests/issue164-phase3-trust-authority.test.js:523-532 ('an unversioned legacy score...is not published', values 50/74/80/84/90/96.8)
  - **Note:** Vehicle-level Trust authority is solid across VehicleDetail, VehicleProfile, OwnerDashboard, Marketplace card src (no `vehicle.trust_score` reads per VehicleDetail.trust.test.tsx:542-543). Note: admin/MarketplaceModeration.tsx, bank/LendingQueue.tsx (loan-application trust_score, different domain) and diaspora/DiasporaStockPassport.tsx (dealer-profile trust_score, different domain) still read raw trust_score fields, but these are outside this workflow's declared path scope and are different objects (admin diagnostics / loan applications / dealer profiles), not vehicle canonical Trust, so not scored against M1.
- [x] **M2. Publication Readiness is presented as a separate concept.**
  - **Evidence:** web/src/pages/SellFlow.threeMeasurements.test.tsx (5/5 pass, verified by direct run): 'renders all three as distinct blocks' (post-save-completeness, listing-quality-panel, canonical-trust-pointer testids), 'points to Canonical Trust rather than restating it as a seller-side number' asserts canonical-trust-pointer text contains 'Canonical Trust is measured separately' / 'Neither block above is a Trust score' and contains no digit-% or score/band literal; web/src/pages/dashboard/owner/SellVehicle.tsx:805-808 renders this pointer; git commit 3491ec44 'present listing quality without letting it read as trust'
  - **Note:** Publication Readiness (the is_publishable badge / blocking_gaps in VehicleCompletenessPanel, rendered in Seller Studio) is structurally and textually separate from the canonical-trust-pointer block.
- [x] **M3. Listing Quality/Completeness is presented as a separate concept.**
  - **Evidence:** web/src/pages/SellFlow.threeMeasurements.test.tsx: 'states what Listing Quality is and what it is not' asserts listing-quality-scope text contains 'How strong your advertisement is', 'separate from whether CarUp can publish', 'separate again from what CarUp has verified'; 'never lets Listing Quality borrow verification language' asserts listing-quality-band text excludes /verified|trusted|certified|gold/ and panel excludes 'CarUp has verified this vehicle'/'Trust score'
  - **Note:** Listing Quality/Completeness (VehicleCompletenessPanel's completeness_percent + Progress bar, and the separate listing-quality-panel) is kept both conceptually and lexically distinct from readiness and Trust.
- [x] **M4. No completeness percentage is presented as Trust.**
  - **Evidence:** grep -in 'trust' web/src/components/VehicleCompletenessPanel.tsx web/src/components/SourceCoveragePanel.tsx -> no hits; grep 'completeness|readiness|is_publishable' web/src/pages/VehicleDetail.tsx (the buyer-facing/public surface) -> no hits, i.e. completeness never appears on the Trust-bearing page at all; SellFlow.threeMeasurements.test.tsx asserts canonical-trust-pointer contains no /\d+\s*%/ and no /\b(score|band)\s*[:=]/
  - **Note:** Completeness % (VehicleCompletenessPanel) lives only in Seller Studio, never on the buyer Trust surface, and the studio's own Trust pointer explicitly disclaims restating any percentage as Trust.
- [x] **M5. No readiness percentage is presented as Trust.**
  - **Evidence:** Same as M4: is_publishable / readiness badge ('Ready to publish' / 'Draft — not yet publishable') in VehicleCompletenessPanel.tsx carries no numeric percent and no 'trust' wording; canonical-trust-pointer test asserts no digit-percent appears beside the Trust disclaimer
  - **Note:** Readiness is boolean/badge-based, never expressed as a percentage that could be mistaken for Trust.
- [~] **M6. Review policy/presentation for 60/100 with low confidence, zero substantiated governed facts, and zero connected sources.**
  - OWNER DECISION REQUIRED only if changing policy thresholds/score semantics.
  - **Evidence:** backend/services/trustDecision/trustDecisionService.js:216-219 confidenceBand(completeness_percent) declares confidence from self-declared completeness alone (>=80% => 'high'); canonicalTrustService.js:374-402 confidenceOf() floors that declared confidence by governed_facts_substantiated+connected_sources (support===0 => ceiling 'low'). I directly executed assembleDecision+resolveVehicleFacts+canonicalFromDecision+toPublicTrust with completeness_percent=80, 0 governed facts, 0 connected sources, and confirmed the composite output was score:50/band:moderate/confidence:'low' — the exact 'declared-high-but-zero-support' scenario the docstring names as the historical 60/100-style defect, correctly capped.
  - **Gap:** No committed automated test asserts this exact composite (~60, low confidence, 0 substantiated, 0 connected) by name — backend/tests/issue164-phase3-trust-authority.test.js:401-419 tests a nearby scenario (completeness 60%, but WITH substantiated+connected facts present, yielding 'medium') and VehicleDetail.trust.test.tsx's 'insufficient_evidence' tests use a hand-set fixture (score 0) rather than deriving confidence from raw inputs. Verified correct by direct execution of production code, not by a persisted regression test — downgraded per the audit's rule to prefer a committed test over my own trace.
- [x] **M7. Confidence and evidence basis are visible enough that score cannot mislead.**
  - **Evidence:** web/src/pages/VehicleDetail.trust.test.tsx 'surfaces the evidence basis, the confidence and the unbacked legacy claim' asserts trust-evidence-basis shows '0 of 7', trust-unbacked-claims shows '2', trust-confidence shows 'Low confidence', trust-known-limitations names the specific unbacked flag; 'prints "Not recorded", never 0, for an evidence count that was never resolved'; backend canonicalTrustService.js EVIDENCE_BASIS_FIELDS + known_limitations are part of the frozen public contract (PUBLIC_TRUST_FIELDS)
  - **Note:** Visibility of confidence + evidence_basis on the rendered surface is directly and thoroughly tested (26/26 passing suite); the underlying confidence-computation correctness itself is only traced/executed by me (see M6), not committed-test-covered.
- [x] **M8. Not-evaluated owner UAT vehicle remains not evaluated; no legacy score substitution.**
  - **Evidence:** backend/tests/issue164-phase3-trust-authority.test.js:523-532 'an unversioned legacy score — every row on staging today — is not published' (loops 50/74/80/84/90/96.8, asserts score:null, evaluation_state:NOT_EVALUATED, limitation matches /predates the canonical trust authority/); canonicalTrustService.js:530-539 classifyCache() puts a null-version row into UNVERSIONED before any other classification, deliberately ordered so no legacy hand-set score is reachable through the fresh branch
  - **Note:** No test targets the literal owner-UAT VIN (UAT20260828SELL01) by name, but the mechanism it depends on (any unversioned/legacy score, regardless of magnitude, resolves to not_evaluated with score:null) is generically and thoroughly proven, which is sufficient since the UAT vehicle's stored score predates the versioned cache exactly like the tested legacy values.
- [x] **M9. Seller-stated facts visually distinct from governed facts.**
  - **Evidence:** web/src/pages/VehicleDetail.sellerStatement.test.tsx (5/5 pass, verified by direct run): 'labels the condition as the seller's statement, never as a CarUp finding' asserts spec-seller-condition tile text contains 'seller' and excludes /verified|certified|confirmed|inspected/; backend/tests/seller-cross-surface-convergence.test.js:98-108 'the seller statement and the governed classification stay separate on both surfaces' asserts summary.seller_stated_condition !== summary.condition_category on both the Marketplace summary and Vehicle Detail projection
  - **Note:** Both frontend label wording and backend field separation (seller_stated_condition vs vehicle_condition_category) are covered by passing tests.
- [x] **M10. Privacy cross-surface assertions.**
  - Seller Studio → Preview → Marketplace → Passport → inquiry
  - **Evidence:** backend/tests/seller-cross-surface-convergence.test.js (all 12 tests, part of 110/110 passing run) pushes ONE vehicle row through buildMarketplaceListingSummary and toPublicVehicle/toListingClaims and asserts field-for-field agreement (location visibility incl. province_only, seller identity, trust, seller statements, no private identifier); backend/routes/marketplaceRoutes.js:126-134 shows Seller Preview reuses the identical `audience: 'public'` code path as the real Marketplace/Passport detail read ('the service remains public-gated; this query cannot expose an unpublished row'), so Preview cannot diverge from what Marketplace/Passport show; inquiry flow (marketplaceInquiryService.js) only carries the BUYER's own contact info toward the seller, never the reverse
  - **Note:** Marketplace<->Passport/Detail convergence is directly tested; Preview's parity with the public projection is confirmed by reading the shared code path (same audience:'public', same projection functions) rather than a dedicated Preview-specific privacy test; inquiry direction (buyer info to seller) is the correct one and doesn't carry the leak risk this item is about.
- [x] **M11. Province-only or broader location choices do not leak city/address.**
  - **Evidence:** backend/tests/seller-location-province-only.test.js (all pass, part of 110/110 run): 'province_only publishes the province and country and withholds the city', 'a city withheld by province_only is byte-identical to one withheld outright', 'province_only discloses strictly less than public and strictly more than withheld'; seller-cross-surface-convergence.test.js:152-177 confirms the same three visibilities agree on both the Marketplace card label string and the Vehicle Detail claims object, and that a withheld city/province never appears in the composed card label text
  - **Note:** Directly and thoroughly tested at both the projection-function level and the cross-surface composed-label level.
- [x] **M12. Seller identity visibility respects explicit opt-in/state.**
  - **Evidence:** backend/tests/seller-consent-controls.test.js (all pass): 'an omitted identity consent stays off', 'the handler resolves identity consent with a strict boolean, not coercion' (asserts server.js matches /public_seller_display_enabled\s*===\s*true/); backend/tests/seller-cross-surface-convergence.test.js:143-150 'an unpublished seller identity is withheld on both surfaces' asserts summary.seller_public_profile_enabled===false and claims.seller.display_name.state !== RECORDED when public_seller_display_enabled is false; web/src/pages/SellFlow.consent.test.tsx:141 confirms the write path submits the seller's own form choice
  - **Note:** Write-path strict-boolean gating and read-path withholding are both covered by passing tests, end to end from the Sell form to the public projection.
- [~] **M13. Private phone/email never leak into public listing projection.**

  - **Evidence:** backend/tests/marketplace-listing-summary.test.js:236 (part of a passing 20/20 file) directly asserts `assert.equal('sellerPhone' in summary, false)` after feeding a fixture with `sellerPhone: '+263772000000'` into buildMarketplaceListingSummary; backend/utils/publicVehicleProjection.js:170-192 PUBLIC_VEHICLE_FIELDS is an explicit allow-list with no phone/email column at all, and grep across backend/server.js, publicVehicleProjection.js and listingSummaryService.js finds no code path that attaches seller phone/email to any public vehicle/listing/passport response (the only `select(...phone, email...)` calls in server.js are the self-scoped /api/auth/login and /api/auth/me routes)
  - **Gap:** The Marketplace-summary path has a direct, targeted, passing regression test naming 'sellerPhone'. The Vehicle Detail/Passport public-projection path (toPublicVehicle/toListingClaims) has no equivalent test that feeds a seller_phone/seller_email field into a fixture and asserts absence — its guarantee rests on the allow-list architecture (traced by reading, not test-proven for that specific field name), so downgraded to '~' for that leg.
### Phase M roll call
- [~] **M-RC. Phase M complete:** Trust, readiness, completeness, and privacy remain distinct and truthful.

  - **Evidence:** All CI-declared backend tests for this gate pass: node --test over seller-reconciliation-privacy, seller-location-province-only, seller-consent-controls, seller-cross-surface-convergence, issue164-phase3-trust-authority, marketplace-listing-summary => 110/110 pass (I ran this exact set). All CI-declared frontend tests pass individually: VehicleDetail.parity/.sellerStatement/.trust (26/26), SourceCoveragePanel, VehicleCompletenessPanel all green when run standalone; `npm run build --workspace=web` succeeds (exit 0). Additional non-workflow-gated evidence (SellFlow.threeMeasurements.test.tsx, OwnerDashboard.trust.test.tsx) independently corroborates M1-M5.
  - **Gap:** OVERRIDE: downgraded from the audit agent's 'x' verdict to '~' per this tracker's own binding rule (§0.1): no phase may be declared complete while any required item remains not-x. Not yet 'x': M6, M13. Agent's original rationale: One caveat carried up from the sub-items: M6's exact composite scenario and M13's Passport-path leg for phone/email are proven by direct reading/execution rather than a committed targeted test, so the roll call is a strong PASS with those two named residual gaps rather than an unqualified one. The one observed test failure (VehicleDetail.trust.test.tsx's first test) only occurred when 5 test files were run concurrently and is a timeout/resource-contention artifact — reproduced as a clean pass twice when run in isolation.
---

# PHASE N — Seller Intelligence redesign and instrumentation proof

**Goal:** a real Seller decision dashboard with governed charts and proven event flow.

## N1. Dashboard design

- [~] **N1.1 KPI band**
  - active listings;
  - drafts needing action;
  - inquiries;
  - tracked views;
  - saves;
  - response state.
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:274-286 (KPI band renders exactly 6 cards: Active listings, Listing views, Unique visitors, Saves, Inquiries, Response state)
  - **Gap:** Active listings, inquiries, tracked views (as 'Listing views'), saves and response state are all present and correctly sourced from availability-enveloped metrics. 'Drafts needing action' is completely absent from this page — it exists only on a different surface (web/src/pages/dashboard/owner/MyListings.tsx:193,238, 'Need action' KPI). Since N1.1 explicitly lists it as part of THIS KPI band, this is a real, specific gap, not a naming quibble.
- [~] **N1.2 Primary time-series when governed data exists.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:89-120 (DailySeries component) and :297 (rendered only inside the readable-gated section)
  - **Gap:** Renders a real bar series (views/saves/inquiries) from pulse.series when present, with an honest 'No computed daily rollup points are available' empty state (line 93-96) rather than a fabricated flat line. Correct on reading; no behavioral render test exercises either branch — web/src/pages/dashboard/owner/SellerIntelligence.test.ts is a pure source-string-match test (checks the file text contains 'seller-intelligence-time-series', nothing about actual rendering).
- [~] **N1.3 Conversion funnel using only instrumented events.**
  - Impression/View → Save/Compare → Inquiry → Inspection → transaction handoff
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:300-326 (funnel section, data-testid=seller-intelligence-funnel)
  - **Gap:** The funnel shown is Impressions -> Views -> Saves -> Inquiries plus view_to_save/view_to_inquiry conversion rates, all sourced from real instrumented metrics (no fabrication). However the tracker's own item names five stages — Impression/View -> Save/Compare -> Inquiry -> Inspection -> transaction handoff — and Compare, Inspection and any transaction-handoff stage are entirely absent from this funnel. Partial implementation of the named contract.
- [~] **N1.4 Discovery-source distribution where tracked.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:398,122-130 (UntrackedPanel 'Discovery sources')
  - **Gap:** Correctly renders an honest 'Not tracked in the current Seller projection' panel with a specific reason rather than fabricating a source distribution — matches 'where tracked' semantics since it genuinely isn't tracked. Verified by reading only; no render test.
- [~] **N1.5 Listing performance comparison.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:329-378 (listing comparison table) fed by fetchListingIntelligence -> backend/services/intelligence/intelligenceProjectionService.js:304-365 getListingInsights
  - **Gap:** Real per-vehicle views/saves/inquiries/completeness/trust columns, sourced from rollups keyed on the listing's own VIN. Correct end-to-end on reading; no dedicated render/behavioral test.
- [~] **N1.6 Inquiry distribution.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:201-209,380-397 (inquiryDistribution computed from real fetchMyMarketplaceInquiries() rows)
  - **Gap:** Distinguishes null ('Inquiry authority could not be read'), empty ('0 inquiries recorded'), and a real grouped distribution — good honesty discipline. No render test.
- [~] **N1.7 Geographic interest where tracked.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:399 (UntrackedPanel 'Geographic interest')
  - **Gap:** Same honest not-tracked pattern as N1.4. Correct on reading, unproven by a render test.
- [~] **N1.8 Price-change response where tracked.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:400 (UntrackedPanel 'Price-change response')
  - **Gap:** States price mutations are recorded in the ledger but no before/after response model is computed, and claims no uplift. Consistent with the N2.6 finding that marketplace_price_changed has real code but no proven event flow yet.
- [~] **N1.9 Listing readiness/completeness visual, distinct from Trust.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:364-371 (separate 'Listing completeness' and 'Canonical Trust' columns, label 'listing completeness · not Trust'); backend/services/intelligence/listingCompletenessService.js:1-20 (module docstring: trust and completeness returned in a sibling block no scoring path can reach)
  - **Gap:** Structurally separated in both the API envelope (ListingCompleteness.displayed_separately.trust vs percent) and the UI. Correct and well-reasoned on reading; no dedicated automated test asserts the exact non-overlap contract, so kept at '~' rather than 'x'.
- [~] **N1.10 Designed truthful unavailable/no-activity/not-tracked states.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx: loading (252-256), error (258-263), unreadable (265-270), series-empty (91-97), threads-null (211-212,282-285), inquiry-null (383-384), 3x UntrackedPanel (398-400)
  - **Gap:** Genuinely thorough set of distinct truthful states for different failure/absence modes. Verified only by reading; the only test touching this file is a source-string-match, not a render test exercising these branches.
- [x] **N1.11 No fake zero lines, fake 0%, fake revenue, or decorative trends.**
  - **Evidence:** web/src/lib/intelligenceDisplay.test.ts:23-53 (real behavioral assertions: displayMetric(unavailable) === 'Not available' and explicitly asserts .not.toBe('0') for unavailable/insufficient_data/not_applicable/missing envelopes); confirmed passing locally (47/47 tests, 'npm run test:unit --workspace=web -- .../intelligenceDisplay.test.ts' run 2026-08-31)
  - **Note:** Grepped SellerIntelligence.tsx for '|| 0'/'?? 0' fallbacks on rendered metrics: none found (the only two hits, lines 206 and 211, are legitimate counts over already-fetched real arrays, not treating a failed fetch as zero). Every rendered metric in the component routes through displayMetric/metricCopy, which is directly and behaviorally tested.
- [~] **N1.12 Text/table equivalent for chart meaning where practical.**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:104 (per-bar aria-label with exact views/saves/inquiries numbers), :300-326 (funnel is already a text list of numbers), :340-377 (listing comparison is a literal HTML table)
  - **Gap:** Text/table equivalents exist for the funnel and listing comparison (they ARE text/tables), and the one true chart (DailySeries) carries an aria-label with the exact numeric values. No dedicated accessibility/text-equivalence test.
- [~] **N1.13 Desktop/tablet/mobile chart readability.**

## N2. Instrumentation proof

After generating a known event in E2E:
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:100,274,340 (overflow-x-auto wrappers, sm:grid-cols-2 xl:grid-cols-6 responsive KPI grid); tests/agents/38-seller-staging-browser-golden.spec.ts:614-617 (per-viewport document.documentElement.scrollWidth <= window.innerWidth+1 check across chromium/tablet-chromium/mobile-chromium projects, added in commit 8942424e)
  - **Gap:** Code looks correctly responsive on reading. The actual automated cross-viewport proof lives inside the Golden Dynamic Seller staging E2E spec, which — per `gh run list --workflow=seller-exact-head-staging-uat.yml --limit 100` — has 0 successful runs in its last 100 attempts (86 cancelled, 13 failed, 1 in-progress as of this audit). So the dedicated readability proof has never actually completed.
- [~] **N2.1 Marketplace view/impression event recorded where defined.**
  - **Evidence:** backend/services/intelligence/activityEventTypes.js:22 (marketplace_listing_impression is CLIENT_EMITTED); web/src/pages/Marketplace.tsx:64-92 (IntersectionObserver at 25% visibility fires trackActivity); web/src/lib/intelligenceActivity.test.ts (client buffer/flush behaviorally tested)
  - **Gap:** Real, non-trivial wiring; no test specifically exercises the IntersectionObserver call site. The most recent completed staging E2E DB audit (GH run 33345485423 @823b6e8a, step 'Audit Phase N generated-event chain') found ZERO marketplace_listing_impression rows for any of the 3 Golden VINs generated in that run.
- [~] **N2.2 Save event recorded.**
  - **Evidence:** backend/services/marketplace/marketplaceSavedService.js:19,48 (emitListingSaved called on the real save path); backend/tests/intelligence-marketplace-instrumentation.test.js:257-274 ('saving through the real service emits exactly one save observation', 're-saving...observes NOTHING') — ran locally, passes (110/110 backend intelligence tests green)
  - **Gap:** Strongest-evidenced of the six: real emitter unit-tested against a fake DB client with idempotency + no-op assertions, AND source-grep wiring test (instrumentation test :374-383) confirms the route actually calls it with `req` threaded through. Staging E2E DB audit still found 0 marketplace_listing_saved rows for all 3 Golden VINs in the last completed run — so end-to-end (the item's stated evidence bar) is unproven, though unit-level proof is solid.
- [~] **N2.3 Compare event recorded.**
  - **Evidence:** web/src/pages/Marketplace.tsx:508-525 (toggleCompare fires marketplace_compare_added/_removed with compare_set_size metadata); backend/services/intelligence/activityEventTypes.js:23 (client-emittable)
  - **Gap:** Real, correctly-implemented client wiring (toggle direction maps to the right event type). `grep -rn "compare_added" web/src backend/tests` found zero test references anywhere — this event has no test coverage at all, weaker than N2.2/N2.4/N2.5. Staging DB audit found 0 marketplace_compare_added rows for any Golden VIN.
- [~] **N2.4 Inquiry event recorded.**
  - **Evidence:** backend/services/marketplace/marketplaceInquiryService.js:272 (emitInquiryCreated(inserted, ...) on the real creation path); backend/tests/intelligence-marketplace-instrumentation.test.js:302-314,385-389 (idempotency + wiring assertions, passing)
  - **Gap:** Direct unit test proves anchoring-on-inquiry-id and scope-from-authority-row. Staging E2E DB audit found 0 marketplace_inquiry_created rows for any of the 3 Golden VINs in the last completed run (the golden spec's own inquiry-creation steps at spec lines 508-521 never executed because the test failed earlier, during evidence upload).
- [~] **N2.5 Inspection request event recorded where supported.**
  - **Evidence:** backend/services/intelligence/marketplaceActivityEmitters.js (INSPECTION_INQUIRY_TYPES set + emitInquiryCreated emits a second marketplace_inspection_requested event); backend/tests/intelligence-marketplace-instrumentation.test.js:316-332 (asserts inspection-type inquiries emit both events, non-inspection types do not)
  - **Gap:** Well-tested at unit level with both positive and negative cases. Staging DB audit found 0 marketplace_inspection_requested rows for any Golden VIN in the last completed run.
- [~] **N2.6 Price change event recorded.**
  - **Evidence:** backend/routes/vehiclesRoutes.js:319-339 (emitPriceChanged called after the real price update, keyed on before/after price); backend/services/intelligence/marketplaceActivityEmitters.js (emitPriceChanged implementation, request-id anchored)
  - **Gap:** Weakest-evidenced of the six: `grep -rn "emitPriceChanged" backend/tests` returns nothing — backend/tests/seller-price-change.test.js exists and tests the price route's validation/scope rules extensively but never asserts the price-changed event is emitted. Staging DB audit found 0 marketplace_price_changed rows for any Golden VIN in the last completed run.
- [~] **N2.7 Seller Intelligence reads the generated event(s).**
  - **Evidence:** web/src/pages/dashboard/owner/SellerIntelligence.tsx:134-135,155 -> web/src/hooks/useCarUpApi.ts:629-632 -> backend/routes/intelligenceProjectionRoutes.js:90-101 -> backend/services/intelligence/intelligenceProjectionService.js:451+ getSellerPulse (reads listing_rollups built from marketplace_activity_events)
  - **Gap:** The read path from dashboard to the activity ledger is real and correctly traced end-to-end on reading. No CI run has yet closed the loop with a genuinely-generated event: the Golden E2E's own attempt to prove this (forcing a rollup then polling my-analytics, spec lines 568-610) has never executed to completion (0/100 recent successful runs of that workflow).
- [x] **N2.8 "Unavailable" is not accepted as proof that instrumentation succeeded.**
  - **Evidence:** .github/workflows/seller-exact-head-staging-uat.yml:400-477 ('Audit Phase N generated-event chain' step queries public.marketplace_activity_events directly by VIN/event_type and throws 'Phase N generated-event chain is incomplete' if any required row is missing — it never inspects or accepts any UI text); tests/agents/38-seller-staging-browser-golden.spec.ts:604-609 (explicit `.not.toContainText('Unavailable')` assertion on the inquiry KPI, gated behind an independent polled-API proof of real data)
  - **Note:** This is a property of the certification method itself, verified directly by reading both enforcement points; it holds independent of whether the wider E2E currently passes end-to-end.
- [~] **N2.9 If downstream projection is asynchronous, certification waits/polls its governed completion within a bounded interval and reports failure if it never arrives.**

  - **Evidence:** tests/agents/38-seller-staging-browser-golden.spec.ts:568-602 (POST /api/internal/intelligence/rollup to force the async projection, then `expect.poll(..., { timeout: 20_000, intervals: [500,1000,2000] })` against GET /api/marketplace/my-analytics, with an explicit failure message 'generated Marketplace inquiry never reached the governed Seller Intelligence projection' if it never converges)
  - **Gap:** Correctly designed bounded-poll-with-explicit-failure mechanism on reading. It has never actually executed in any observed CI run — the test fails earlier (during evidence upload, per the timeout-raise commit 0f4ce5ab's own rationale) before reaching this block in every one of the last several completed runs, so the mechanism is unverified at runtime.
### Phase N roll call
- [ ] **N-RC. Phase N complete:** dashboard design is decision-grade and event propagation is actually proven.

  - **Evidence:** gh run list --workflow=seller-exact-head-staging-uat.yml --limit 100: 0 successful runs (86 cancelled, 13 failed, 1 in-progress as of audit); GH run 33345485423 (head 823b6e8a, the most recent completed run) 'Audit Phase N generated-event chain' step output: of 3 Golden VINs x 7 required event types = 21 required rows, all 21 were missing (only one unrelated marketplace_listing_sold row existed)
  - **Gap:** Dashboard design shows real craft (honest-state discipline is genuinely strong, N1.11 directly proven) but has two concrete named-spec gaps (N1.1 missing 'drafts needing action'; N1.3 funnel omits Compare/Inspection/handoff). More decisively, the instrumentation-proof half of Phase N (N2) has never been demonstrated end-to-end in CI: the one test built specifically to prove it has a 0% pass rate over its last 100 runs, and the last completed run's own database audit found none of the required events for any freshly-created Golden vehicle. A newer commit (0f4ce5ab, current actual branch HEAD — note the task described HEAD as 823b6e8a, but the repo's actual checked-out HEAD is 0f4ce5ab, 3 commits ahead) raises the test timeout specifically to try to reach these steps, with a corresponding CI run in progress at time of audit; its outcome is unknown and must not be assumed. Phase N is not certifiable as complete on current evidence.
---

# PHASE O — Owner Dashboard convergence

**Goal:** replace the legacy generic dashboard with the ownership/Seller cockpit defined in DESIGN.md.

- [ ] **O1. Priority 1: What needs attention**
- [ ] **O2. Priority 2: Vehicles/listings**
- [ ] **O3. Priority 3: Buyer activity**
- [ ] **O4. Priority 4: Trust/evidence readiness**
- [ ] **O5. Priority 5: Service/insurance/PartSentry**
- [ ] **O6. Priority 6: Communications**
- [ ] **O7. Priority 7: Intelligence**
- [ ] **O8. Direct Continue listing for draft Seller vehicle.**
- [ ] **O9. Meaningful vehicle media used.**
- [ ] **O10. KPI/chart hierarchy used where governed data exists.**
- [ ] **O11. Unsupported legacy trend widgets removed/deprecated.**
- [ ] **O12. Fake/untracked numeric defaults removed.**
- [ ] **O13. Decorative cards with no action removed/deprioritized.**
- [ ] **O14. "Ask Gutu AI" placement reconciled with current global product naming/design; no legacy prominence by accident.**
- [ ] **O15. Desktop/tablet/mobile visual acceptance.**
- [ ] **O16. Accessibility acceptance.**

### Phase O roll call
- [ ] **O-RC. Phase O complete:** Owner Dashboard is no longer the legacy shell observed in owner UAT.

---

# PHASE P — Home and downstream visual resilience

**Goal:** Seller-created inventory must improve Home without allowing Marketplace/test-media problems to collapse Home design.

- [ ] **P1. Home hero only uses a governed eligible live listing with meaningful renderable media.**
- [ ] **P2. Home does not silently equate "newest" with "featured" unless that is the explicit product rule.**
- [ ] **P3. Live inventory uses the same Marketplace listing presentation contract.**
- [ ] **P4. Published Seller cover image appears correctly in Home live inventory when selected by ranking.**
- [ ] **P5. "Eight useful next moves" remains visually communicative even if Marketplace listing media is missing.**
- [ ] **P6. Conceptual journeys use resilient vector/diagram scenes where appropriate.**
  - Verify;
  - Diaspora;
  - finance;
  - protection;
  - service;
  - parts.
- [ ] **P7. A missing vehicle image cannot turn conceptual journey panels into giant blank spaces.**
- [ ] **P8. No unrelated stock vehicle impersonates a real listing.**
- [ ] **P9. Home visual regression included in Seller publication/unpublication test.**
- [ ] **P10. Desktop/tablet/mobile Home evidence reviewed after Seller publication.**

### Phase P roll call
- [ ] **P-RC. Phase P complete:** Seller media and Home storytelling are resilient and semantically correct.

---

# PHASE Q — Communications convergence

**Goal:** inquiry capture must become a real Seller conversation tied to the same listing/vehicle.

- [ ] **Q1. Guest buyer submits inquiry through public Marketplace UI.**
- [ ] **Q2. Durable marketplace inquiry row created.**
- [ ] **Q3. Seller inquiry inbox shows correct VIN, buyer identity fields allowed by policy, and exact message.**
- [ ] **Q4. Communications downstream projection/thread is created.**
- [ ] **Q5. Thread remains linked to the same listing/vehicle.**
- [ ] **Q6. Participants/authorization are correct.**
- [ ] **Q7. Seller can respond through supported in-app Communications UI.**
- [ ] **Q8. Buyer-side conversation visibility/return path works where current product supports it.**
- [ ] **Q9. External provider channels are displayed only if runtime can actually deliver them.**
- [ ] **Q10. Missing external providers do not block in-app conversation certification.**
- [ ] **Q11. Asynchronous thread projection gets a bounded completion assertion; inquiry inbox alone does not satisfy this phase.**
- [ ] **Q12. Communication events remain privacy-minimized and auditable.**

### Phase Q roll call
- [ ] **Q-RC. Phase Q complete:** Seller sees a governed conversation, not merely a raw inquiry row.

---

# PHASE R — Publication readiness and full commerce lifecycle

**Goal:** publication is deliberate, blocked truthfully, reversible, and preserves Passport identity.

- [ ] **R1. Pre-publication summary shows media readiness.**
- [ ] **R2. Seller copy completeness.**
- [ ] **R3. Required identifier/evidence state.**
- [ ] **R4. Privacy projection.**
- [ ] **R5. Canonical Trust state as-is.**
- [ ] **R6. Exact publication blockers and next action.**
- [ ] **R7. Buyer Preview before publication.**
- [ ] **R8. Publish blocked without required verified ownership evidence.**
- [ ] **R9. Authorized reviewer verification clears the exact governed blocker.**
- [ ] **R10. Publish from Seller UI.**
- [ ] **R11. Public Marketplace endpoint returns VIN only after publication.**
- [ ] **R12. Marketplace search/facets discover the VIN.**
- [ ] **R13. Marketplace card uses explicit Seller cover.**
- [ ] **R14. Vehicle Detail uses shared presentation.**
- [ ] **R15. Change price through Seller UI and verify persistence.**
- [ ] **R16. Unpublish through Seller UI and verify public disappearance.**
- [ ] **R17. Republish through Seller UI and verify public reappearance.**
- [ ] **R18. Mark sold through Seller UI.**
- [ ] **R19. Sold vehicle exits active Marketplace commerce.**
- [ ] **R20. Passport persists after sold/retirement.**
- [ ] **R21. Ownership/history persists; sold/unpublish does not erase durable vehicle identity.**

### Phase R roll call
- [ ] **R-RC. Phase R complete:** full publish → unpublish → republish → sold lifecycle is proven.

---

# PHASE S — Genuine Golden Dynamic Seller Journey

**Goal:** replace the reduced API-heavy "Golden" test with the documented owner-facing dynamic journey.

This test may use APIs only for actions that have **no intended UI** (for example, an authorized back-office reviewer action if reviewer UI is not in scope). It may not use APIs to bypass Seller UI stages that are part of the product journey.

## Required journey — every item mandatory

- [ ] **S1. Home loads exact-head staging.**
- [ ] **S2. Click Sell from Home/global navigation.**
- [ ] **S3. Seller intent chooser appears.**
- [ ] **S4. Exercise existing/known/new decision semantics.**
- [ ] **S5. Start a genuinely new Seller vehicle through UI for the dynamic test.**
- [ ] **S6. Enter Seller/vehicle commercial data through UI.**
- [ ] **S7. Upload 7 meaningful photos through UI.**
- [ ] **S8. Apply photo labels through UI.**
- [ ] **S9. Select explicit cover through UI.**
- [ ] **S10. Save guest draft through UI.**
- [ ] **S11. Create a fresh account through UI.**
- [ ] **S12. Verify account handoff returns to the same draft.**
- [ ] **S13. Refresh mid-form and prove resume.**
- [ ] **S14. Navigate to My Garage.**
- [ ] **S15. Use Continue listing CTA.**
- [ ] **S16. Open My Listings.**
- [ ] **S17. Use Preview buyer listing CTA.**
- [ ] **S18. Confirm preview is marked non-public.**
- [ ] **S19. Confirm 7/7 gallery, labels/order/cover continuity.**
- [ ] **S20. Add required evidence through intended Seller/owner UI.**
- [ ] **S21. Observe pending evidence state.**
- [ ] **S22. Resolve review using a genuinely authorized independent role.**
- [ ] **S23. Return to Seller and observe blocker cleared.**
- [ ] **S24. Publish from Seller UI.**
- [ ] **S25. Sign out / use public buyer context.**
- [ ] **S26. Find vehicle through Marketplace search.**
- [ ] **S27. Open public Vehicle Detail.**
- [ ] **S28. Compare section-by-section to rich reference architecture.**
- [ ] **S29. Save listing.**
- [ ] **S30. Compare listing.**
- [ ] **S31. Share listing.**
- [ ] **S32. Submit buyer inquiry.**
- [ ] **S33. Seller sees durable inquiry.**
- [ ] **S34. Seller Communications thread appears.**
- [ ] **S35. Seller can respond in supported in-app channel.**
- [ ] **S36. Seller Intelligence receives governed event(s).**
- [ ] **S37. Change price.**
- [ ] **S38. Unpublish.**
- [ ] **S39. Verify Marketplace removal.**
- [ ] **S40. Republish.**
- [ ] **S41. Verify Marketplace reappearance.**
- [ ] **S42. Mark sold.**
- [ ] **S43. Verify active commerce ends.**
- [ ] **S44. Verify Vehicle Passport still persists.**
- [ ] **S45. Verify Home remains visually intact after lifecycle transitions.**
- [ ] **S46. Golden test cleans/retire its own automation data deterministically.**

## Device/browser matrix

- [ ] **S47. Desktop Chromium**
- [ ] **S48. Narrow desktop/tablet Chromium**
- [ ] **S49. Mobile Chromium**
- [ ] **S50. No horizontal overflow on modified surfaces**
- [ ] **S51. Touch/gallery interactions usable**
- [ ] **S52. Persistent navigation remains reachable**

### Phase S roll call
- [ ] **S-RC. Phase S complete:** all S1–S52 are `[x]`; no API shortcut substituted for an intended UI journey.

---

# PHASE T — Accessibility and visual regression certification

**Goal:** redesigned Seller surfaces are usable and visually stable, not merely functional.

- [ ] **T1. Seller entry visual regression evidence**
- [ ] **T2. Owner Dashboard visual regression evidence**
- [ ] **T3. My Garage visual regression evidence**
- [ ] **T4. Evidence Vault visual regression evidence**
- [ ] **T5. My Listings visual regression evidence**
- [ ] **T6. Authenticated Seller Studio visual regression evidence**
- [ ] **T7. Buyer Preview visual regression evidence**
- [ ] **T8. Marketplace card + Vehicle Detail visual regression evidence**
- [ ] **T9. Seller Intelligence visual regression evidence**
- [ ] **T10. Home hero / Eight useful next moves visual regression evidence**
- [ ] **T11. Keyboard navigation**
- [ ] **T12. Visible focus**
- [ ] **T13. Form labels/errors**
- [ ] **T14. Gallery control accessibility**
- [ ] **T15. Drawer/sheet accessibility**
- [ ] **T16. Chart text/table equivalent where practical**
- [ ] **T17. Status not conveyed by color alone**
- [ ] **T18. Touch target acceptance**
- [ ] **T19. Alt text / missing-media semantics**
- [ ] **T20. Automated accessibility gate green on exact head**

### Phase T roll call
- [ ] **T-RC. Phase T complete:** visual and accessibility evidence reviewed for all modified Seller/downstream surfaces.

---

# PHASE U — Complete cross-feature regression battery

**Goal:** Seller remediation must not regress Vehicle Passport, Verify, Marketplace, Home, Communications, Intelligence, ownership lifecycle, Service Network, referral/navigation, or security.

Required exact-head battery:

- [ ] **U1. Backend unit/integration tests**
- [ ] **U2. Web unit/component tests**
- [ ] **U3. TypeScript**
- [ ] **U4. Lint/regression lint**
- [ ] **U5. Production web build**
- [ ] **U6. Generic Playwright suite**
- [ ] **U7. Seller-specific component/integration tests**
- [ ] **U8. Genuine Golden Seller Journey**
- [ ] **U9. Marketplace exact-head staging**
- [ ] **U10. Vehicle Passport full relevant battery**
- [ ] **U11. Verify/search regression**
- [ ] **U12. Communications unit/integration/staging**
- [ ] **U13. Intelligence unit/integration/staging**
- [ ] **U14. Navigation**
- [ ] **U15. Accessibility**
- [ ] **U16. Referral**
- [ ] **U17. Ownership lifecycle**
- [ ] **U18. Service Network/garage/mechanic affected-surface regression**
- [ ] **U19. Security/secret scan**
- [ ] **U20. Dependency/security audit**
- [ ] **U21. Staging integration**
- [ ] **U22. Migration/preflight gates if migrations changed**
- [ ] **U23. Frontend/backend exact SHA provenance match**
- [ ] **U24. No pending/failing required checks**
- [ ] **U25. No unresolved P0/P1 review threads**

### Phase U roll call
- [ ] **U-RC. Phase U complete:** complete affected battery green on one stable exact head.

---

# PHASE V — Owner UAT handoff and acceptance

**Goal:** automation earns a candidate; the owner decides whether the visible product is acceptable.

- [ ] **V1. Freeze stable exact-head candidate.**
- [ ] **V2. Confirm frontend and backend staging both serve exact candidate SHA.**
- [ ] **V3. Provide one current UAT URL.**
- [ ] **V4. Provide owner account guidance without exposing CI-rotated automation credentials.**
- [ ] **V5. Provide clean existing-account continuity test.**
- [ ] **V6. Provide clean fresh-account journey test.**
- [ ] **V7. Provide explicit test data and what must not be reused.**
- [ ] **V8. Owner verifies visual result on real desktop/mobile.**
- [ ] **V9. Owner verifies Seller intent journey.**
- [ ] **V10. Owner verifies 7-photo gallery/cover continuity.**
- [ ] **V11. Owner verifies Owner Dashboard/My Garage/My Listings/Seller Studio.**
- [ ] **V12. Owner verifies Preview/public distinction.**
- [ ] **V13. Owner verifies publication lifecycle.**
- [ ] **V14. Owner verifies inquiry/Communications/Intelligence.**
- [ ] **V15. Owner verifies Home/Marketplace/Vehicle Detail appearance.**
- [ ] **V16. Owner UAT decision recorded as PASS.**

### Phase V roll call
- [ ] **V-RC. Phase V complete:** owner has accepted the visual/product result; automated PASS alone is insufficient.

---

# PHASE W — Final integration / merge readiness

**Goal:** close the programme only after the repository, staging, tests, and owner acceptance agree.

- [ ] **W1. All prior phase roll calls A–V are `[x]`.**
- [ ] **W2. No unresolved P0/P1 defects.**
- [ ] **W3. No known visual exceptions undocumented.**
- [ ] **W4. `DESIGN.md` compliance checklist complete.**
- [ ] **W5. Seller convergence plan exit criteria all mapped and cleared.**
- [ ] **W6. Final stable exact SHA recorded.**
- [ ] **W7. Final CI/check matrix green.**
- [ ] **W8. Independent review clean.**
- [ ] **W9. Exact-head certification receipt committed.**
- [ ] **W10. Receipt-bearing head rerun and green.**
- [ ] **W11. PR #194 remains Draft until all merge gates above clear.**
- [ ] **W12. Merge/reconciliation target re-fetched immediately before any merge action.**
- [ ] **W13. No accidental direct mutation of `main` outside the approved integration plan.**
- [ ] **W14. Final owner handoff includes exact head, UAT result, CI result, remaining protected production gates, and merge status.**

### Phase W roll call
- [ ] **W-RC. Seller UAT remediation complete and merge-ready.**

---

# Permanent invariants — must be checked in every phase

These are not one-time tasks. Every phase roll call must verify them.

- [ ] **INV-1 Truth & Trust unchanged:** no fabricated Trust/evidence/government claims.
- [ ] **INV-2 Draft is never public unless the owner explicitly publishes after blockers clear.**
- [ ] **INV-3 Seller statements remain seller-stated.**
- [ ] **INV-4 Listing media remains separate from verified evidence.**
- [ ] **INV-5 Vehicle Passport identity remains canonical and durable.**
- [ ] **INV-6 Privacy projection remains authoritative.**
- [ ] **INV-7 No fake dashboard zeros/charts/trends.**
- [ ] **INV-8 No automation test stock contaminates human UAT.**
- [ ] **INV-9 No seeded/reference vehicle substitutes for a Seller-created acceptance journey.**
- [ ] **INV-10 No UI requirement is silently replaced with direct API setup.**
- [ ] **INV-11 Desktop + tablet/narrow + mobile remain first-class.**
- [ ] **INV-12 Accessibility remains part of acceptance.**
- [ ] **INV-13 No routine conversational stop between tasks once implementation begins.**
- [ ] **INV-14 This tracker is updated every time a task is cleared.**
- [ ] **INV-15 Existing authority seams are preserved:** Seller remediation must not fork or create competing writers/read models for Vehicle Passport lifecycle, ownership, canonical Trust, Evidence, Marketplace publication, Communications, Intelligence, PartSentry, or Service Network authority.

---

# Current programme roll call

At creation time, prior automated certification is treated as **historical engineering evidence only**, not completion of the tasks above.

**Reconciled against real evidence (code, local test runs, live staging queries, exact-head CI) by a
13-agent audit at commit `823b6e8a` — see per-item Evidence/Gap lines above. Counts exclude the
phase's own `-RC` line.** Several `~`/blank findings below (notably C7's mobile gallery-button
occlusion, and the F-G/timeout/save-toggle/inquiry-ordering defects it led to investigating further)
have since been fixed on top of `823b6e8a`; those fixes are not yet re-certified by a green exact-head
gate, so phase states below are intentionally not upgraded until that happens.

| Phase | State | Reason |
|---|---|---|
| A — Governance reset/baseline | COMPLETE | A1–A5 and A-RC cleared on frozen baseline `106f765...`; documentation-only evidence |
| B — Parity audit | COMPLETE | B1 39-view visual baseline + B2 full parity matrix accepted; defects preserved for remediation |
| C — UAT integrity | IN PROGRESS | 8/10 items `x` (real live-staging query evidence); blocked by C4 (teardown safety-net observed stalling under a real CI failure, not proven to complete) and C7 (mobile gallery Next/Previous buttons obstructed by the fixed bottom nav — root-caused and fixed post-audit via `z-[60]`, pending green-gate re-verification) |
| D — Account continuity | IN PROGRESS | 8/16 `x`, 7 `~`, 1 blank; auth/registration/recovery stack is real and mostly test-proven, but D3.5 (governed dealer/business approval workflow) does not exist at all — requests are captured but never reviewed/approved by anything |
| E — Navigation/Sell intent | IN PROGRESS | 6/14 `x`, 7 `~`, 1 blank; **E2.6/E-RC found a real production defect**: the desktop mega-menu, mobile drawer, and bottom-tab-bar Sell entries all route straight to the blank `/dashboard/sell-vehicle` form, bypassing the `/sell` Sell Intent Router this same phase built — not yet fixed |
| F — Draft/resume | IN PROGRESS | 11/17 `x`, 6 `~`; autosave/idempotency/resume contracts are substantially real and commit-linked, remaining items proven by reading rather than a dedicated test |
| G — Media | IN PROGRESS | 20/30 `x`, 9 `~`, 1 blank; 7-photo persistence/order/label/cover contract is strongly proven; gaps remain in pixel-level crop/render acceptance and full cross-surface (Home hero) proof |
| H — My Garage | IN PROGRESS | 3/15 `x`, 12 `~`; the redesigned page exists and reads correctly on inspection, but almost none of it is backed by a dedicated automated/visual test yet |
| I — My Listings | IN PROGRESS | 2/20 `x`, 17 `~`, 1 blank; redesign is implemented but almost entirely unproven by targeted tests — the weakest-evidenced phase alongside N |
| J — Seller Studio | IN PROGRESS | 11/18 `x`, 7 `~`; convergence is substantially real and test-backed, several secondary items unproven |
| K — Shared buyer presentation | IN PROGRESS | 11/16 `x`, 5 `~`; the one-component seller-preview/marketplace-public architecture is strongly evidenced |
| L — Dynamic parity | IN PROGRESS | 14/23 `x`, 8 `~`, 1 blank; most sections proven parity, a handful of secondary sections still gap |
| M — Trust/privacy semantics | IN PROGRESS | 11/13 `x`, 2 `~`; near-complete — M6 (the exact low-confidence/zero-substantiated Trust composite) and M13 (Passport-path phone/email exclusion) lack a dedicated committed test; the auditing agent's M-RC `x` was overridden to `~` per this tracker's own §0.1 rule |
| N — Seller Intelligence | IN PROGRESS | 2/22 `x`, 20 `~`; dashboard design exists, but event-instrumentation proof is the weak point — matches the live "Phase N generated-event chain is incomplete" failures observed directly in exact-head CI |
| O — Owner Dashboard | NOT STARTED | legacy UI still deployed |
| P — Home resilience | NOT STARTED | blank-media regression present |
| Q — Communications | NOT STARTED | inquiry ≠ proven conversation |
| R — Publication lifecycle | NOT STARTED | republish + full lifecycle missing |
| S — Genuine Golden journey | NOT STARTED | previous test was reduced/API-heavy |
| T — Visual/accessibility | NOT STARTED | redesigned target not yet certified |
| U — Cross-feature battery | NOT STARTED | must run after remediation |
| V — Owner UAT | NOT STARTED | current candidate failed owner UAT |
| W — Merge readiness | NOT STARTED | cannot clear before owner PASS |

---

# Tracker maintenance template

When clearing a task, append evidence in this exact style:

> **Evidence:** commit `<sha>`; test `<name>` PASS; workflow run `<id>`; staging artifact `<id>`; desktop/mobile screenshot set `<path/artifact>`.

When a task is blocked:

> **BLOCKED:** `<external dependency>`. Safe independent work remaining: `<yes/no>`. Owner action required: `<exact action>`.

When a phase is cleared:

> **ROLL CALL PASS:** every mandatory item in Phase X is `[x]`; invariants INV-1…INV-14 rechecked; no acceptance criterion weakened.

---

## Final rule

**Do not call Seller "certified", "complete", "mergeable", or "owner-UAT-ready" until Phase V owner acceptance is `[x]` and Phase W roll call is complete.**

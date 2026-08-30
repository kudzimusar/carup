# Seller UAT Remediation — Master Execution & Roll-Call Plan

**Status:** ACTIVE — authoritative execution tracker  
**Repository:** `kudzimusar/carup`  
**Working branch / PR:** `integration/vehicle-passport-v16-cert` / Draft PR #194  
**Baseline exact head when this tracker was created:** `43204beeec40123b0cce0c457aded6d0f733c4bc`  
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

- [ ] **B1.1 Home**
- [ ] **B1.2 Marketplace**
- [ ] **B1.3 Rich reference Marketplace Vehicle Detail**
- [ ] **B1.4 Public/guest Sell**
- [ ] **B1.5 Owner Dashboard**
- [ ] **B1.6 My Garage**
- [ ] **B1.7 Evidence Vault**
- [ ] **B1.8 My Listings**
- [ ] **B1.9 Authenticated Seller Studio**
- [ ] **B1.10 Seller-created draft Buyer Preview / Vehicle Detail**
- [ ] **B1.11 Communications Seller surface**
- [ ] **B1.12 Seller Intelligence**
- [ ] **B1.13 Verify / Passport entry for the Seller-created vehicle**

Acceptance for B1:
- screenshots/artifacts are from exact-head staging;
- desktop + narrow/tablet + mobile are represented;
- obvious blank media and legacy UI are preserved as evidence, not hidden.

## B2. Field/section parity matrix

For a rich reference VIN and `UAT20260828SELL01`, record:

- [ ] **B2.1 Listing gallery / cover / carousel**
- [ ] **B2.2 Make/model/year / identity**
- [ ] **B2.3 Price / currency**
- [ ] **B2.4 Mileage / fuel / transmission / drivetrain / body style / condition**
- [ ] **B2.5 Seller description / features**
- [ ] **B2.6 Seller identity and seller type**
- [ ] **B2.7 Location / privacy projection**
- [ ] **B2.8 Canonical Trust**
- [ ] **B2.9 Trust confidence / source coverage**
- [ ] **B2.10 Government/partner checks**
- [ ] **B2.11 Registration / plate / identifier state**
- [ ] **B2.12 Evidence state**
- [ ] **B2.13 Lifecycle/history**
- [ ] **B2.14 Ownership**
- [ ] **B2.15 Service**
- [ ] **B2.16 PartSentry**
- [ ] **B2.17 Insurance**
- [ ] **B2.18 Pricing/cost estimate**
- [ ] **B2.19 Inquiry**
- [ ] **B2.20 Reservation/SafePay readiness**
- [ ] **B2.21 Save**
- [ ] **B2.22 Compare**
- [ ] **B2.23 Share**
- [ ] **B2.24 Recommendations/related vehicles**
- [ ] **B2.25 Publication state**
- [ ] **B2.26 Missing / pending / unavailable design state**

Parity-matrix columns must include:
`capability/section | reference VIN | UAT VIN | canonical source | seller-stated/governed/computed/private | expected missing state | component | gap | severity | owner decision if any`.

- [ ] **B2.27 Commit parity matrix to repository.**
  - Evidence: `TBD`.

### Phase B roll call
- [ ] **B-RC. Phase B complete:** every B1/B2 item is `[x]`, and no redesign proceeds based on memory alone.

---

# PHASE C — UAT environment integrity and automated-test isolation

**Goal:** human UAT must not be contaminated by automated Golden vehicles or meaningless test media.

- [ ] **C1. Inventory all automation-created Seller vehicles currently visible in staging.**
  - Identify by VIN pattern, creation source/run, publication state, lifecycle state, media, and owner account.
  - Evidence: `TBD`.

- [ ] **C2. Explain the current Marketplace count semantically.**
  - Distinguish public listings, draft vehicle identities, sold/retired, seeded references, automation records, and human UAT vehicles.
  - Evidence: `TBD`.

- [ ] **C3. Define automation-data isolation policy.**
  - Choose one governed strategy:
    1. dedicated automation namespace/environment, or
    2. hard exclusion from human discovery/Home/featured surfaces, plus
    3. deterministic cleanup/retirement in `finally`/teardown.
  - Acceptance: interrupted/failed tests cannot leave public stock behind.
  - Evidence: `TBD`.

- [ ] **C4. Implement deterministic Golden Seller teardown.**
  - Every created vehicle must end non-public and retired even on assertion failure where cleanup can safely execute.
  - Evidence: `TBD`.

- [ ] **C5. Remove or retire leaked automation listings through a governed cleanup path.**
  - Preserve auditability; do not disguise them as owner-created records.
  - Acceptance: human UAT Marketplace count no longer includes leaked automation stock.
  - Evidence: `TBD`.

- [ ] **C6. Replace 1×1 PNG as the human-facing visual certification fixture.**
  - Technical upload tests may retain tiny fixtures in unit/integration scope.
  - Browser visual certification must use meaningful multi-image fixtures with valid dimensions.
  - Evidence: `TBD`.

- [ ] **C7. Add media-quality acceptance.**
  - Minimum decoded dimensions;
  - non-zero intrinsic dimensions;
  - visible rendered area;
  - image load success;
  - cover crop is meaningful;
  - gallery navigation actually changes images.
  - Evidence: `TBD`.

- [ ] **C8. Prevent automation listings from becoming Home hero/featured inventory.**
  - Acceptance: Home cannot select automation fixtures as editorial/live showcase material.
  - Evidence: `TBD`.

- [ ] **C9. Define and implement "Featured" semantics.**
  - OWNER DECISION REQUIRED only if product policy is not already documented.
  - Distinguish newest from featured.
  - UI must not imply editorial endorsement merely because a listing is newest.
  - Evidence: `TBD`.

- [ ] **C10. Clarify count labels in UI.**
  - Marketplace count must state what it counts (for example, published listings), not ambiguous "vehicles" if that can be confused with total vehicle identities.
  - Evidence: `TBD`.

### Phase C roll call
- [ ] **C-RC. Phase C complete:** no automation leakage, no 1×1 visual certification, counts are semantically accurate, Featured has a governed rule.

---

# PHASE D — Account continuity, authentication, registration, and Seller identity

**Goal:** a real existing or new Seller account must survive the journey without being silently orphaned.

## D1. Existing account reconciliation

- [ ] **D1.1 Diagnose `buynsellpvtltd@gmail.com` read-only before mutation.**
  - Determine whether the account exists;
  - whether it has a valid current password hash;
  - whether it is a legacy passwordless account;
  - registration date/source;
  - verification state;
  - registration profile state;
  - existing user/session/vehicle relationships;
  - whether login failure is wrong password vs missing/incompatible credential state where safely diagnosable.
  - Evidence: `TBD`.

- [ ] **D1.2 Reconcile pre-upgrade login behavior.**
  - Confirm why earlier deployment already returned 401 for this account.
  - Evidence: `TBD`.

- [ ] **D1.3 Define safe recovery path.**
  - No account duplication.
  - No ownership/listing loss.
  - No credential mutation without owner approval if required.
  - Evidence: `TBD`.

## D2. Email verification and recovery

- [ ] **D2.1 Verify registration email dispatch path end-to-end.**
- [ ] **D2.2 Verify resend-verification path.**
- [ ] **D2.3 Verify email verification token/action route.**
- [ ] **D2.4 Verify forgot-password / reset-password path.**
- [ ] **D2.5 Verify delivery failure is surfaced truthfully, not presented as "sent".**
- [ ] **D2.6 Verify auth email delivery does not depend on unavailable worker semantics in preview.**
- [ ] **D2.7 Verify mailbox verification remains distinct from KYC/ownership/Trust.**

## D3. Seller identity model

- [ ] **D3.1 Preserve public-registration least privilege.**
  - Public signup cannot self-assign dealer/admin/mechanic/etc authorization roles.

- [ ] **D3.2 Define individual Seller profile semantics.**
- [ ] **D3.3 Define dealer/business/exporter Seller profile semantics.**
  - Business identity is profile/onboarding, not self-granted authorization.
- [ ] **D3.4 Verify Seller journey for private owner.**
- [ ] **D3.5 Verify governed path for business/dealer Seller onboarding or explicitly document deferred scope.**
- [ ] **D3.6 Keep "vehicle new to CarUp" separate from commercial "new/used" condition.**

### Phase D roll call
- [ ] **D-RC. Phase D complete:** existing account is reconciled; new-account verification/recovery works; Seller identity model does not conflate authorization role with business profile.

---

# PHASE E — Navigation architecture and Sell intent router

**Goal:** global Sell resolves intent before a user is forced into a blank form.

## E1. Navigation

- [ ] **E1.1 Give My Garage and Evidence Vault distinct navigation semantics.**
  - Preferred: `/dashboard/garage` and `/dashboard/evidence`, or remove Evidence Vault as a duplicate top-level intent and make it explicitly vehicle-scoped.
- [ ] **E1.2 Exactly one active sidebar destination at a time.**
- [ ] **E1.3 Shared authenticated workspace header.**
  - breadcrumb/back/up;
  - object identity;
  - status;
  - one primary CTA.
- [ ] **E1.4 Every Seller sub-page can return to Seller/Owner Home.**
- [ ] **E1.5 Every vehicle page can return to My Garage.**
- [ ] **E1.6 Mobile drawer/back behavior preserves route and form state.**
- [ ] **E1.7 Sidebar visual design converges with `DESIGN.md`.**

## E2. Sell intent router

For signed-in users, global Sell must first present:
1. **Sell a vehicle already in My Garage**
2. **Sell a vehicle CarUp already knows**
3. **Add a vehicle CarUp does not know yet**

For signed-out users:
1. identify a known vehicle;
2. add a new vehicle;
3. sign in to continue existing vehicle/draft.

- [ ] **E2.1 Signed-in Garage vehicles are shown first with image/missing-media state, Passport identity, listing state, and contextual CTA.**
- [ ] **E2.2 Existing Garage vehicle → Sell this vehicle / Continue listing / Review & publish / Manage listing based on lifecycle.**
- [ ] **E2.3 Known external vehicle lookup reuses Passport identity.**
- [ ] **E2.4 Authority/ownership claim required before commercial management.**
- [ ] **E2.5 New-to-CarUp path creates canonical identity.**
- [ ] **E2.6 No owner with known vehicles is dumped directly into a blank new-vehicle form.**
- [ ] **E2.7 Sell intent UI certified desktop/tablet/mobile.**

### Phase E roll call
- [ ] **E-RC. Phase E complete:** navigation is distinct and Sell always resolves intent first.

---

# PHASE F — Canonical Seller draft, autosave, refresh, and resume

**Goal:** no Seller progress is lost across refresh, navigation, or authentication.

- [ ] **F1. Define canonical guest draft vs persisted server draft authority.**
- [ ] **F2. Autosave Seller commercial fields at meaningful boundaries.**
- [ ] **F3. Autosave current Seller Studio stage.**
- [ ] **F4. Persist history-plan selections.**
- [ ] **F5. Persist privacy selections.**
- [ ] **F6. Persist seller identity/public-display selections.**
- [ ] **F7. Persist photo order.**
- [ ] **F8. Persist photo labels.**
- [ ] **F9. Persist explicit cover selection.**
- [ ] **F10. Preserve draft on page refresh at every stage.**
- [ ] **F11. Preserve draft through guest → registration.**
- [ ] **F12. Preserve draft through guest → login to an existing account.**
- [ ] **F13. Resume from server after authentication when a server draft exists.**
- [ ] **F14. Never restart a known Seller vehicle as a blank registration/form without explicit user choice.**
- [ ] **F15. Save success only claims data actually persisted.**
- [ ] **F16. On failed persistence, preserve the only local/browser copy and surface actionable recovery.**
- [ ] **F17. Duplicate-submit/retry is idempotent and does not create duplicate vehicle identities/listings.**

### Phase F roll call
- [ ] **F-RC. Phase F complete:** refresh/auth/navigation cannot silently destroy Seller progress or duplicate the vehicle.

---

# PHASE G — Media persistence, gallery continuity, and visual quality

**Goal:** seven real Seller images remain the same seven images across the full journey.

## G1. Owner UAT vehicle historical repair path

- [ ] **G1.1 Confirm `UAT20260828SELL01` has no canonical listing-media rows.**
- [ ] **G1.2 Record that missing historical uploads cannot be reconstructed server-side.**
- [ ] **G1.3 Provide governed re-upload/retry path without mutating unrelated vehicle facts.**

## G2. Seven-image persistence contract

- [ ] **G2.1 Select/upload 7 meaningful vehicle photos.**
- [ ] **G2.2 All 7 upload successfully or save is visibly incomplete; no silent partial success.**
- [ ] **G2.3 All 7 listing-media rows persist.**
- [ ] **G2.4 All 7 survive refresh.**
- [ ] **G2.5 Labels survive refresh.**
- [ ] **G2.6 Ordering survives refresh.**
- [ ] **G2.7 Explicit cover survives refresh.**
- [ ] **G2.8 Retry does not duplicate media rows.**
- [ ] **G2.9 Media delivery failures are distinguishable from "Seller supplied no photos".**

## G3. Cross-surface continuity

The same explicit cover must appear in:
- [ ] **G3.1 Seller Studio**
- [ ] **G3.2 My Garage**
- [ ] **G3.3 My Listings**
- [ ] **G3.4 Buyer Preview**
- [ ] **G3.5 Marketplace listing card**
- [ ] **G3.6 Marketplace Vehicle Detail primary image**
- [ ] **G3.7 Home hero/featured placement when governed selection legitimately chooses that vehicle**
- [ ] **G3.8 Recommendations/related vehicle cards where applicable**

The full 7-image gallery must appear in:
- [ ] **G3.9 Buyer Preview**
- [ ] **G3.10 Marketplace Vehicle Detail**

## G4. Carousel/visual acceptance

- [ ] **G4.1 Desktop next/previous controls work.**
- [ ] **G4.2 Thumbnail selection works.**
- [ ] **G4.3 Touch/mobile gallery works.**
- [ ] **G4.4 Crop/aspect is stable and does not create deceptive presentation.**
- [ ] **G4.5 Meaningful dimensions required for browser visual certification.**
- [ ] **G4.6 No blank giant media regions when a valid meaningful image exists.**
- [ ] **G4.7 No unrelated stock image substitutes for real listing media.**
- [ ] **G4.8 Listing media never masquerades as verified evidence.**

### Phase G roll call
- [ ] **G-RC. Phase G complete:** 7/7 meaningful photos + labels + order + cover survive the full journey and render correctly on desktop/tablet/mobile.

---

# PHASE H — My Garage redesign

**Goal:** My Garage becomes the durable owner vehicle workspace defined by `DESIGN.md`.

- [ ] **H1. Page header with route orientation and Seller/Owner Home return.**
- [ ] **H2. Vehicle count/state uses truthful semantics.**
- [ ] **H3. Vehicle stories use substantial real media or designed missing-media state.**
- [ ] **H4. Make/model/year + safe identifier prominent.**
- [ ] **H5. Passport identity/state visible.**
- [ ] **H6. Ownership/current-seller relationship visible.**
- [ ] **H7. Listing/publication lifecycle visible.**
- [ ] **H8. Canonical Trust state visible without decorative substitution.**
- [ ] **H9. Evidence/readiness visible.**
- [ ] **H10. Service/insurance/PartSentry summaries only where governed.**
- [ ] **H11. Exactly one dominant contextual CTA.**
  - draft → **Continue listing**
  - published → **Manage listing**
  - vehicle only → **Sell this vehicle**
- [ ] **H12. Secondary View Passport action.**
- [ ] **H13. Open editorial/automotive composition; legacy generic card-grid no longer governing.**
- [ ] **H14. Desktop/tablet/mobile visual acceptance.**
- [ ] **H15. `My Garage → Hilux → Continue listing → Seller Studio` works without sidebar knowledge.**

### Phase H roll call
- [ ] **H-RC. Phase H complete:** My Garage satisfies DESIGN.md and the contextual continuation journey.

---

# PHASE I — My Listings redesign

**Goal:** My Listings becomes the Seller commerce operating surface.

- [ ] **I1. Top KPI/state band uses governed values only.**
- [ ] **I2. Published count.**
- [ ] **I3. Drafts needing action.**
- [ ] **I4. Buyer inquiries.**
- [ ] **I5. Views/saves only where tracked.**
- [ ] **I6. Listing value aggregated only when currency semantics allow it.**
- [ ] **I7. Large image + identity + lifecycle per listing.**
- [ ] **I8. Draft / ready / published / reserved / sold are visually unmistakable.**
- [ ] **I9. Exactly one dominant contextual action.**
- [ ] **I10. Draft action: Continue/Edit.**
- [ ] **I11. Draft action: Preview buyer listing.**
- [ ] **I12. Draft action: Publication readiness.**
- [ ] **I13. Published action: View on Marketplace.**
- [ ] **I14. Published management: performance.**
- [ ] **I15. Price/availability.**
- [ ] **I16. Evidence/Trust.**
- [ ] **I17. Inquiry response.**
- [ ] **I18. Unpublish/sold lifecycle.**
- [ ] **I19. No draft Passport fallback mislabeled as a public listing.**
- [ ] **I20. Desktop/tablet/mobile visual acceptance.**

### Phase I roll call
- [ ] **I-RC. Phase I complete:** lifecycle and actions are coherent and visually aligned with Home/Marketplace.

---

# PHASE J — Authenticated Seller Studio convergence

**Goal:** the authenticated Seller workspace visually and functionally matches the approved CarUp Seller standard.

- [ ] **J1. Dark automotive identity/stage region aligned with DESIGN.md.**
- [ ] **J2. Clear stage progression.**
- [ ] **J3. Wide desktop composition.**
- [ ] **J4. Calm mobile stack.**
- [ ] **J5. Existing Passport facts hydrate where authority permits.**
- [ ] **J6. Canonical vs seller-editable fields are visibly distinct.**
- [ ] **J7. Existing stored Seller draft hydrates instead of blank restart.**
- [ ] **J8. "Existing listing loaded" / equivalent resume orientation is clear.**
- [ ] **J9. Media readiness visible.**
- [ ] **J10. Seller copy completeness visible.**
- [ ] **J11. Evidence state visible.**
- [ ] **J12. Canonical Trust state visible.**
- [ ] **J13. Privacy projection visible.**
- [ ] **J14. Publication blockers exact and actionable.**
- [ ] **J15. Buyer Preview CTA present.**
- [ ] **J16. One primary action per stage; legacy equal-weight action clusters removed.**
- [ ] **J17. Accessibility: labels, errors, keyboard, focus, touch.**
- [ ] **J18. Desktop/tablet/mobile visual acceptance.**

### Phase J roll call
- [ ] **J-RC. Phase J complete:** authenticated Seller Studio is no longer a legacy visual fork.

---

# PHASE K — Shared Buyer Preview / Marketplace Vehicle Detail architecture

**Goal:** one buyer presentation architecture, two governed modes.

- [ ] **K1. Shared domain presentation layer exists.**
  - `seller_preview`
  - `marketplace_public`
- [ ] **K2. Shared gallery.**
- [ ] **K3. Shared commercial identity/decision panel.**
- [ ] **K4. Shared canonical Trust/source coverage.**
- [ ] **K5. Shared pricing/cost context.**
- [ ] **K6. Shared evidence/registration presentation.**
- [ ] **K7. Shared seller description/features.**
- [ ] **K8. Shared lifecycle/history.**
- [ ] **K9. Shared ownership/service/insurance/PartSentry sections.**
- [ ] **K10. Seller preview is clearly "Buyer Preview — not public".**
- [ ] **K11. Buyer transactional controls disabled/replaced in Seller preview.**
- [ ] **K12. Seller editing controls stay outside buyer presentation.**
- [ ] **K13. Marketplace public mode requires published state.**
- [ ] **K14. Public inquiry/transaction controls active only when governed.**
- [ ] **K15. No second legacy Seller-preview design remains.**
- [ ] **K16. Draft preview does not require pretending the draft is a public Marketplace listing.**

### Phase K roll call
- [ ] **K-RC. Phase K complete:** preview/public cannot drift because they share the same presentation contract.

---

# PHASE L — Dynamic Marketplace parity for Seller-created vehicles

**Goal:** a normal Seller-created vehicle has the same information architecture as a rich Marketplace reference vehicle.

- [ ] **L1. Photos/gallery parity**
- [ ] **L2. Commercial identity parity**
- [ ] **L3. Price/currency parity**
- [ ] **L4. Trust parity**
- [ ] **L5. Source coverage parity**
- [ ] **L6. Government/partner checks parity**
- [ ] **L7. Cost estimate parity**
- [ ] **L8. Inquiry parity**
- [ ] **L9. Registration/evidence parity**
- [ ] **L10. Seller statements parity**
- [ ] **L11. Lifecycle parity**
- [ ] **L12. Ownership parity**
- [ ] **L13. Service parity**
- [ ] **L14. PartSentry parity**
- [ ] **L15. Insurance parity**
- [ ] **L16. Reservation/SafePay readiness parity**
- [ ] **L17. Seller privacy parity**
- [ ] **L18. Save parity**
- [ ] **L19. Compare parity**
- [ ] **L20. Share parity**
- [ ] **L21. Recommendations parity where applicable**
- [ ] **L22. Missing states preserve the same section architecture.**
  - `Pending`, `Not evaluated`, `Source not connected`, `Not available`, etc.
- [ ] **L23. No seeded/reference-only presentation path is required.**

### Phase L roll call
- [ ] **L-RC. Phase L complete:** Seller-created and reference vehicles share the same structural experience without copied fake data.

---

# PHASE M — Trust, readiness, completeness, and privacy semantics

**Goal:** prevent one decorative number from laundering uncertainty.

- [ ] **M1. Canonical Trust remains the only Trust authority.**
- [ ] **M2. Publication Readiness is presented as a separate concept.**
- [ ] **M3. Listing Quality/Completeness is presented as a separate concept.**
- [ ] **M4. No completeness percentage is presented as Trust.**
- [ ] **M5. No readiness percentage is presented as Trust.**
- [ ] **M6. Review policy/presentation for 60/100 with low confidence, zero substantiated governed facts, and zero connected sources.**
  - OWNER DECISION REQUIRED only if changing policy thresholds/score semantics.
- [ ] **M7. Confidence and evidence basis are visible enough that score cannot mislead.**
- [ ] **M8. Not-evaluated owner UAT vehicle remains not evaluated; no legacy score substitution.**
- [ ] **M9. Seller-stated facts visually distinct from governed facts.**
- [ ] **M10. Privacy cross-surface assertions.**
  - Seller Studio → Preview → Marketplace → Passport → inquiry
- [ ] **M11. Province-only or broader location choices do not leak city/address.**
- [ ] **M12. Seller identity visibility respects explicit opt-in/state.**
- [ ] **M13. Private phone/email never leak into public listing projection.**

### Phase M roll call
- [ ] **M-RC. Phase M complete:** Trust, readiness, completeness, and privacy remain distinct and truthful.

---

# PHASE N — Seller Intelligence redesign and instrumentation proof

**Goal:** a real Seller decision dashboard with governed charts and proven event flow.

## N1. Dashboard design

- [ ] **N1.1 KPI band**
  - active listings;
  - drafts needing action;
  - inquiries;
  - tracked views;
  - saves;
  - response state.
- [ ] **N1.2 Primary time-series when governed data exists.**
- [ ] **N1.3 Conversion funnel using only instrumented events.**
  - Impression/View → Save/Compare → Inquiry → Inspection → transaction handoff
- [ ] **N1.4 Discovery-source distribution where tracked.**
- [ ] **N1.5 Listing performance comparison.**
- [ ] **N1.6 Inquiry distribution.**
- [ ] **N1.7 Geographic interest where tracked.**
- [ ] **N1.8 Price-change response where tracked.**
- [ ] **N1.9 Listing readiness/completeness visual, distinct from Trust.**
- [ ] **N1.10 Designed truthful unavailable/no-activity/not-tracked states.**
- [ ] **N1.11 No fake zero lines, fake 0%, fake revenue, or decorative trends.**
- [ ] **N1.12 Text/table equivalent for chart meaning where practical.**
- [ ] **N1.13 Desktop/tablet/mobile chart readability.**

## N2. Instrumentation proof

After generating a known event in E2E:
- [ ] **N2.1 Marketplace view/impression event recorded where defined.**
- [ ] **N2.2 Save event recorded.**
- [ ] **N2.3 Compare event recorded.**
- [ ] **N2.4 Inquiry event recorded.**
- [ ] **N2.5 Inspection request event recorded where supported.**
- [ ] **N2.6 Price change event recorded.**
- [ ] **N2.7 Seller Intelligence reads the generated event(s).**
- [ ] **N2.8 "Unavailable" is not accepted as proof that instrumentation succeeded.**
- [ ] **N2.9 If downstream projection is asynchronous, certification waits/polls its governed completion within a bounded interval and reports failure if it never arrives.**

### Phase N roll call
- [ ] **N-RC. Phase N complete:** dashboard design is decision-grade and event propagation is actually proven.

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

---

# Current programme roll call

At creation time, prior automated certification is treated as **historical engineering evidence only**, not completion of the tasks above.

| Phase | State | Reason |
|---|---|---|
| A — Governance reset/baseline | COMPLETE | A1–A5 and A-RC cleared on frozen baseline `106f765...`; documentation-only evidence |
| B — Parity audit | NOT STARTED | complete matrix not yet accepted |
| C — UAT integrity | NOT STARTED | automation leakage confirmed |
| D — Account continuity | NOT STARTED | owner account unresolved |
| E — Navigation/Sell intent | NOT STARTED | chooser missing |
| F — Draft/resume | NOT STARTED | full UI proof absent |
| G — Media | NOT STARTED | owner UAT media absent |
| H — My Garage | NOT STARTED | legacy convergence incomplete |
| I — My Listings | NOT STARTED | redesign incomplete |
| J — Seller Studio | NOT STARTED | visual convergence incomplete |
| K — Shared buyer presentation | NOT STARTED | architectural proof incomplete |
| L — Dynamic parity | NOT STARTED | section matrix incomplete |
| M — Trust/privacy semantics | NOT STARTED | Trust UX review required |
| N — Seller Intelligence | NOT STARTED | event propagation not proven |
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

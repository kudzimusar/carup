# Seller ↔ Marketplace Convergence Implementation Plan

**Status:** Implementation plan — do not treat current Seller UI as certified until this plan closes
**Target branch/PR context:** current Seller account-handoff lane / PR #198
**Governing design:** root `DESIGN.md` plus `docs/marketplace/MARKETPLACE_VISUAL_DNA.md`
**Primary test vehicle:** `UAT20260828SELL01`
**Goal:** Make Seller, Garage, Listings, Passport, Marketplace and Intelligence behave and look like one CarUp product.

---

## 1. Why this plan exists

UAT exposed a systematic gap:

- the public Home/Marketplace stack has reached the current CarUp design standard;
- authenticated Owner/Seller surfaces still carry legacy dashboard design;
- Seller-created data does not yet prove parity with curated reference Marketplace vehicles;
- listing media failed to persist through an earlier guest→account save;
- draft/public preview semantics are confused;
- Seller navigation is incomplete;
- existing vehicles are not the natural first choice when a logged-in owner clicks Sell;
- Intelligence exists functionally but does not yet read as a serious business dashboard.

This is therefore a **convergence programme**, not a patch list.

---

## 2. Non-negotiable constraints

1. Preserve Truth & Trust semantics.
2. Preserve Vehicle Passport identity and custody contracts.
3. Do not invent Trust, evidence, views, inquiries or trends.
4. Do not copy public reference/seed data into a real Seller-created vehicle.
5. A draft remains non-public.
6. Seller-stated facts remain distinguishable from governed facts.
7. Privacy projection remains authoritative.
8. Listing media remains separate from verified evidence.
9. Communications and Intelligence use their governed APIs/contracts.
10. Mobile and desktop are both first-class acceptance targets.

---

## 3. Confirmed defects / omissions

### P0 — journey/data continuity
- Seller-selected photos previously disappeared after account handoff.
- `UAT20260828SELL01` currently has `listing_media.state = none`.
- Draft preview currently routes through public `/marketplace/:vin`, whose Marketplace listing endpoint correctly returns 404 for a draft and then falls back to Passport view.
- Existing-account vehicle editing/resume is not obvious enough.
- Long-form progress historically did not survive all refresh/auth boundaries.

### P0 — navigation model
- `owner.garage` and `owner.evidence-vault` are both visible sidebar entries mapped to `/dashboard/garage`.
- Both therefore activate together and represent two intents with one destination.
- My Garage lacks sufficiently obvious return/up navigation and listing continuation.

### P1 — Seller entry
- top-level Sell assumes a new form rather than resolving:
  - existing vehicle in My Garage;
  - known CarUp Passport;
  - genuinely new vehicle.

### P1 — visual/system coherence
- My Garage is legacy card-grid UI.
- My Listings is legacy generic management-card UI.
- authenticated Seller Studio is visually behind public Sell/Home/Marketplace.
- Owner Dashboard is largely legacy generic dashboard composition.
- Intelligence output is mostly text/cards rather than decision-grade visual analytics.

### P1 — Marketplace parity
- curated reference vehicles prove rich Marketplace rendering but do not prove that a normal Seller journey can create the same complete structural experience.
- newly Seller-created draft does not yet demonstrate gallery → commercial → Trust/source → evidence → lifecycle → inquiry composition.
- missing data collapses or weakens the experience instead of consistently rendering designed unknown/pending states.

---

## 4. Target product journey

### 4.1 Entry decision

When user clicks **Sell my car**:

#### Signed out
Show three clear paths:
1. CarUp already knows this vehicle — identify it.
2. I am adding a vehicle for the first time.
3. Sign in to continue an existing draft/vehicle.

#### Signed in
Lead with:

**Your vehicles**
- eligible My Garage vehicles;
- thumbnail;
- Passport identity;
- current listing state;
- CTA: **Continue selling** / **Create listing** / **Manage published listing**.

Then:
- **Find another vehicle CarUp knows**
- **Add a new vehicle**

No authenticated owner should have to retype a known VIN simply to discover their vehicle.

---

## 5. Phase 0 — freeze, baseline and parity audit

### Deliverables
- root `DESIGN.md` adopted;
- current screenshots captured for desktop/mobile:
  - Home;
  - Marketplace;
  - reference Vehicle Detail;
  - public Sell;
  - Owner Dashboard;
  - My Garage;
  - My Listings;
  - authenticated Seller Studio;
  - Seller-created draft Vehicle Detail;
- Seller↔Marketplace parity matrix created.

### Parity matrix columns
- capability/section;
- reference VIN;
- `UAT20260828SELL01`;
- data source;
- expected missing state;
- UI component;
- gap;
- severity;
- owner decision.

### Gate
No broad redesign implementation until the matrix is complete.

---

## 6. Phase 1 — navigation architecture correction

### 6.1 Fix duplicate sidebar intent
Current defect:
- My Garage → `/dashboard/garage`
- Evidence Vault → `/dashboard/garage`

Choose one of these governed patterns:

**Preferred**
- `/dashboard/garage` = My Garage
- `/dashboard/evidence` = Evidence Vault index
- vehicle-scoped evidence routes from each vehicle/Passport

Alternative:
- Evidence Vault becomes a child/tab inside Vehicle Profile and is removed as a duplicate top-level sidebar item.

### 6.2 Local orientation component
Create a shared authenticated workspace header:
- breadcrumb;
- back/up action;
- object identity;
- status;
- one primary CTA.

Examples:
- Seller Home / My Garage
- Seller Home / My Garage / Hilux
- Seller Home / My Listings / Hilux

### 6.3 Sidebar redesign
Bring sidebar into global visual contract:
- clearer hierarchy;
- no double-active states;
- stable mobile drawer;
- role identity;
- global actions visually subordinate to current workflow.

### Acceptance
- exactly one active destination per intent;
- every Seller sub-page can return to Seller Home;
- every vehicle page can return to My Garage;
- mobile close/back behavior preserves route state.

---

## 7. Phase 2 — Sell intent router

Create the first-step Seller decision surface.

### Signed-in behavior
Fetch governed eligible vehicles and show:
- listing image or designed missing-media state;
- make/model/year;
- Passport state;
- listing state;
- primary action derived from lifecycle.

State examples:
- no listing → **Sell this vehicle**
- draft → **Continue listing**
- ready → **Review & publish**
- published → **Manage listing**
- sold → **View sale history / relist only if policy allows**

### Known external vehicle
VIN/approved identifier lookup:
- reuse Passport identity;
- require authority claim/ownership capability;
- never copy another seller's commercial statements.

### New vehicle
Start canonical creation.

### Gate
Clicking global Sell for a signed-in owner with Garage vehicles must not default immediately to a blank new-vehicle form.

---

## 8. Phase 3 — canonical Seller draft/resume model

### Requirements
- autosave typed fields;
- autosave current stage;
- preserve seller history-plan selections;
- preserve privacy selections;
- preserve photo ordering/labels/cover;
- preserve through refresh;
- preserve through guest→auth handoff;
- resume from server when already persisted.

### Save semantics
A save may only claim success for the data actually persisted.

If selected media cannot be persisted:
- keep browser/local draft;
- fail the server save visibly or mark incomplete;
- never clear the only copy.

### Server draft
A persisted Seller listing becomes the canonical resume source after authentication.

### Gate
Refresh at every Seller step and confirm no entered state disappears.

---

## 9. Phase 4 — media persistence and identity

### Correct historical defect
`UAT20260828SELL01` has no stored listing images. Re-upload is necessary; server cannot reconstruct missing rows.

### Contract
- upload all selected images;
- validate every returned URL;
- persist listing media rows;
- preserve display order;
- preserve explicit primary/cover;
- reject partial success as a complete-save success;
- allow retry without data loss.

### Cross-surface identity test
After save, the same selected primary image must render in:
- Seller Studio;
- My Garage;
- My Listings;
- Seller buyer preview;
- published Marketplace card;
- Marketplace Vehicle Detail.

### Gate
No "Image unavailable" caused by a successful Seller save.

---

## 10. Phase 5 — My Garage redesign

Replace the legacy generic grid with an automotive owner workspace.

### Page header
- back to Seller/Owner Home;
- "My Garage";
- vehicle count/state;
- primary action: **Add / find vehicle**.

### Vehicle story
Use:
- meaningful image area;
- make/model/year;
- safe identifier;
- Passport state;
- listing lifecycle state;
- canonical Trust state;
- evidence/readiness summary;
- service/insurance/PartSentry counts where governed.

### Contextual primary CTA
For a draft:
> **Continue listing**

For published:
> **Manage listing**

For vehicle only:
> **Sell this vehicle**

Secondary:
> View Passport

### Visual language
- open composition;
- larger media;
- fewer nested cards;
- current Home/Marketplace typography/palette;
- responsive mobile story layout.

### Gate
The user can perform:
`My Garage → Hilux → Continue listing → Seller Studio`
without using the sidebar or knowing a hidden route.

---

## 11. Phase 6 — My Listings redesign

Turn My Listings into the Seller commerce operating surface.

### Top band
- Published listings
- Drafts needing action
- buyer inquiries
- tracked views/saves only where tracked
- listing value only when currencies can be meaningfully aggregated; otherwise split by currency or do not aggregate.

### Primary per-listing story
Large image + identity + lifecycle.

### Action hierarchy
Exactly one dominant contextual action:
- Continue listing;
- Review & publish;
- Manage published listing;
- Respond to inquiries.

Secondary actions grouped:
- preview;
- price/availability;
- evidence/Trust;
- insights;
- sold/unpublish.

### Preview semantics
Draft button is:
> **Preview buyer listing**

Published button is:
> **View on Marketplace**

Do not label a draft Passport fallback as "View listing".

### Gate
Draft and published states are visually and semantically unmistakable.

---

## 12. Phase 7 — authenticated Seller Studio redesign

Bring authenticated Seller Studio to public Sell / Marketplace standard.

### Step shell
- dark automotive identity region;
- clear stage progression;
- contextual guidance;
- wide desktop composition;
- calm mobile stack.

### Existing Passport
Show:
- identity facts already held;
- source/provenance;
- seller-editable versus canonical fields.

### Avoid re-entry
When server Seller draft exists:
- hydrate stored Seller commercial facts;
- preserve current step;
- show "existing listing loaded";
- do not restart blank registration.

### Publication readiness
Final step should show:
- listing media readiness;
- seller copy completeness;
- required evidence state;
- canonical Trust state;
- privacy projection;
- publication blockers;
- buyer preview CTA.

---

## 13. Phase 8 — one buyer presentation component

This phase closes the biggest Seller↔Marketplace visual gap.

### Requirement
Seller draft preview and public Marketplace Vehicle Detail must use one shared presentational composition.

Implement a domain presentation layer that can render:

- `mode="seller_preview"`
- `mode="marketplace_public"`

The shared composition owns:
1. gallery;
2. identity/commercial panel;
3. Trust/source coverage;
4. pricing/cost;
5. inquiry region;
6. evidence/registration;
7. seller description/features;
8. lifecycle;
9. ownership/service/insurance/PartSentry.

### Mode differences
Seller preview:
- clearly labeled non-public preview;
- buyer transactional actions disabled/replaced with explanatory state;
- Seller edit controls outside the buyer presentation.

Marketplace public:
- only published listing;
- active governed inquiry/transaction controls.

### Rule
No second "Seller preview design" that can drift from Marketplace.

---

## 14. Phase 9 — section-by-section dynamic parity

Use:
- a rich reference vehicle;
- `UAT20260828SELL01` created/updated through Seller UI.

For every Marketplace Vehicle Detail section:
- populate from the same canonical contract where data exists;
- render truthful designed missing state where it does not;
- never switch to a different legacy structure.

### Required sections
- photos;
- commercial identity;
- price;
- canonical Trust;
- source coverage;
- government/partner checks;
- cost estimate;
- inquiry;
- registration/evidence;
- seller statements;
- vehicle lifecycle;
- ownership;
- service;
- PartSentry;
- insurance;
- reservation/SafePay readiness;
- seller privacy;
- recommendations/compare/save/share where applicable.

### Gate
A fresh Seller-created vehicle has the **same information architecture** as a reference Marketplace vehicle before publication, even when many states read "not evaluated" or "not available".

---

## 15. Phase 10 — Seller Intelligence visual upgrade

Apply the Dashboard section of `DESIGN.md`.

### Seller cockpit
Top KPI band, governed only:
- active listings;
- drafts needing action;
- inquiries;
- tracked views;
- saves;
- response state.

### Primary chart
Time-series:
- views;
- saves;
- inquiries;
- inspection requests;
with selectable period if backend supports it.

### Conversion funnel
`Impression/View → Save/Compare → Inquiry → Inspection → transaction handoff`

Only include events actually instrumented.

### Secondary visuals
Where governed data exists:
- discovery-source distribution;
- listing performance comparison;
- inquiry distribution;
- geographic buyer interest;
- price-change response;
- listing-readiness/completeness.

### Empty state
If no data:
- chart frame remains designed;
- explicitly says what is not tracked / what event will populate it;
- no fake lines;
- no fake 0%;
- no invented revenue.

### Visual quality
Use CarUp automotive palette, not the screenshot's third-party branding.
The screenshot is a structural inspiration: KPI + traffic visual + secondary graphics, not a style template.

---

## 16. Phase 11 — Owner Dashboard convergence

Owner Dashboard becomes the Seller/ownership cockpit rather than a legacy card collection.

### Priority hierarchy
1. What needs attention
2. vehicles/listings
3. buyer activity
4. Trust/evidence readiness
5. service/insurance/PartSentry
6. Communications
7. Intelligence

### Remove/deprecate
- fake or untracked numeric defaults;
- decorative cards with no action;
- unsupported trend widgets.

### Add
- meaningful visuals when data exists;
- direct Seller continuation;
- coherent vehicle stories.

---

## 17. Phase 12 — publication readiness and Marketplace transition

Before publishing:
- complete Seller buyer preview;
- validate media;
- validate required identifiers/evidence;
- validate privacy;
- display canonical Trust as-is;
- show exact blockers.

On publish:
- canonical Marketplace endpoint must return the VIN;
- Marketplace search/discovery must find it under supported facets;
- listing card must use seller-selected primary image;
- Vehicle Detail must use shared composition;
- no special seeded/reference path.

---

## 18. Phase 13 — Golden Dynamic Seller Journey

This becomes a mandatory merge gate.

### Test
1. Home → Sell
2. choose existing/new
3. enter Seller data
4. upload 7 photos
5. choose labels/cover
6. save guest draft
7. create/sign into account
8. resume automatically
9. refresh mid-form
10. open My Garage
11. Continue listing
12. open My Listings
13. Preview buyer listing
14. add evidence
15. observe pending state
16. resolve governed review using authorized role only
17. publish
18. find in Marketplace
19. open as signed-out buyer
20. compare section-by-section to reference
21. save/compare/share where supported
22. submit inquiry
23. Seller sees conversation
24. Seller Intelligence receives governed event
25. change price
26. unpublish
27. verify Marketplace removal
28. republish
29. mark sold
30. verify active commerce ends while Vehicle Passport persists

### Prohibited shortcut
Seeded/reference vehicles cannot satisfy this gate.

---

## 19. Test strategy

### Unit/component
- route intent;
- navigation active state;
- autosave;
- media order/cover;
- draft/public preview modes;
- zero-state rendering;
- chart data-state semantics;
- responsive action hierarchy.

### Integration
- guest→auth draft;
- server resume;
- owned/current-seller scope;
- media persistence;
- publication blockers;
- canonical Marketplace projection.

### E2E
Desktop + mobile Golden Dynamic Seller Journey.

### Visual regression
Snapshot/reference screenshots for:
- Seller entry;
- My Garage;
- My Listings;
- Seller Studio;
- buyer preview;
- Seller Intelligence dashboard.

---

## 20. PR sequencing

To minimize risk and unblock the programme:

### PR A — Design + audit contract
- `DESIGN.md`
- parity matrix
- convergence plan
- no product behavior change

### PR B — navigation + Sell intent
- fix duplicate Evidence Vault route/placement
- local workspace navigation
- Sell chooser

### PR C — draft/media continuity
- autosave/resume
- media all-or-nothing persistence
- cross-surface image continuity

### PR D — Seller workspace redesign
- Owner Dashboard
- My Garage
- My Listings
- authenticated Seller Studio

### PR E — shared Marketplace preview
- buyer-preview/public shared composition
- section parity

### PR F — Intelligence visualization
- governed charts
- truthful empty states

### PR G — Golden Dynamic Seller certification
- exact-head staging
- desktop/mobile UAT
- publication cycle
- Marketplace convergence
- Communications/Intelligence confirmation

If current programme constraints require PR #198 to remain the lane, these phases may be commits/checkpoints inside it, but the merge gate remains the same.

---

## 21. Exit criteria

Seller convergence is complete only when:

- root `DESIGN.md` governs all modified UI;
- no duplicate active nav intents remain;
- Sell resolves existing/new intent first;
- refresh/auth never destroys Seller progress;
- selected photos persist or save fails without data loss;
- My Garage visibly offers Continue listing;
- My Listings has clear draft/public lifecycle;
- draft preview is the same Marketplace presentation in preview mode;
- newly Seller-created listing matches Marketplace section architecture;
- no seed/reference-only behavior is required;
- Seller Intelligence reads as a real visual business dashboard without fake data;
- desktop/mobile UAT passes;
- the Golden Dynamic Seller Journey passes end to end;
- exact-head CI/staging/provenance gates are green;
- owner UAT accepts the visual/product result.

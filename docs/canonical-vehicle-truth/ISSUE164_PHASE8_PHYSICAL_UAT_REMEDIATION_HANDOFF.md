# Issue #164 Phase 8 — Physical UAT Remediation Handoff

> **ONE VEHICLE. ONE TRUTH. ONE PUBLIC CONTRACT.**
>
> This document is the authoritative continuation handoff from the first complete owner-executed physical UAT pass for Issue #164. It exists so Claude/Fable or any continuation agent can resume without relying on chat context.

## 0. Read this first

This is **not** a new architecture exercise and **not** permission to restart Issue #164 from first principles.

Before changing code, reconcile this document against live GitHub/PR/deployment state. Live evidence wins if the branch has moved.

Required reading order:

1. GitHub Issue #164 — `PROGRAM: CarUp Canonical Vehicle Truth Closure`.
2. `docs/canonical-vehicle-truth/ISSUE164_PHASE8_GOLDEN_UAT_SCRIPT.md`.
3. **This file** — the physical UAT result and remediation contract.
4. PR #165 and its current exact head/CI/review state.

Operating rules remain unchanged:

- single writable lane: `integration/canonical-vehicle-truth-closure` / PR #165;
- PR #161 remains read-only and must not be merged; close as superseded only after final PR #165 merge/post-merge smoke;
- no production writes or provider activation;
- no real money, Gemini activation, or production cutover;
- protected `main`, no admin bypass;
- after any remediation code change, re-earn local gates, exact-head CI, fresh independent Codex review, preview provenance, and physical re-UAT before merge.

## 1. Physical UAT baseline

The first complete 32-step physical UAT was executed by the owner in Chrome against the certified Phase 8 candidate:

- **certified UAT code head:** `993c1179f4c9ba19de453e9901f3567f66d7f48e`
- **PR:** #165
- **branch:** `integration/canonical-vehicle-truth-closure`
- **frontend preview used:** `https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app`
- **canonical staging Supabase:** `eoyenigwevnxwwhyhaer`
- **API host observed by the browser during UAT:** `https://carup-backend-staging.vercel.app`
- **physical UAT result:** **14 PASS / 18 FAIL**

This documentation commit may move the branch head beyond `993c1179…`; that does **not** change what was physically tested. `993c1179…` is the immutable pre-remediation UAT baseline.

The prior engineering certification on that baseline was clean before physical UAT:

- web suite: 980/980;
- backend: 4110 total / 4098 pass / 0 fail / 12 skipped;
- lint baseline: no new errors;
- TypeScript/build/migration verifier/CR-1/diff check: pass;
- exact-head GitHub Actions: success;
- independent Codex: P0=0 / P1=0 / P2=0.

**Key lesson:** the browser UAT found real truth/convergence defects that source review, tests and CI did not detect. Do not treat the previous clean engineering certification as physical-product PASS.

## 2. Golden fixture truth — do not change the expected facts to make the UI pass

### Golden A — complete / published

- VIN: `CARUPGLDNA0000001`
- 2019 Toyota Hilux
- price: USD 21,500
- location: `Bulawayo, Bulawayo Metropolitan, Zimbabwe`
- publication: `published`
- canonical Trust: **60**
- Trust state: `evaluated`
- band: `moderate`
- confidence: `low`
- calculation version: `trust-decision-1.0.0`
- listing media: 5
- verified evidence: 4 — registration, police clearance, inspection, insurance
- owner/seller fixture id: `golden-a-owner-stg`

### Golden B — deliberately incomplete / draft

- VIN: `CARUPGLDNB0000002`
- 2017 Nissan NP200
- price: USD 9,800
- location: `Gweru, Midlands, Zimbabwe`
- publication: `draft`
- canonical Trust: **50**
- Trust state: `evaluated`
- band: `moderate`
- confidence: `low`
- calculation version: `trust-decision-1.0.0`
- listing media rows: 2, but **must be gated publicly while draft**
- evidence: 1 registration document, **pending**, `verified_by = null`
- owner/seller fixture id: `golden-b-owner-stg`

Critical correction that must survive remediation: **Golden B is evaluated at 50. It is not “not evaluated.”** Its pending document blocks publication; it does not erase the existing governed Trust decision.

## 3. Formal 32-step PASS/FAIL matrix

Every FAIL below is a release-blocking physical UAT defect under the Issue #164 contract. Do not waive a failed step because a lower-level API/test passed.

| Step | Surface / action | Result | Physical result / defect |
|---:|---|:---:|---|
| 1 | Landing loads published listings | **PASS** | Featured listings loaded; no fake green Verified/Trust number on cards. Broken images observed separately. |
| 2 | Golden A Landing facts | **FAIL** | Identity and USD 21,500 correct; governed tags correct; **location rendered only `Zimbabwe`**, not full Bulawayo/city/province/country. |
| 3 | Landing search `Hilux` | **PASS** | Navigated to `/marketplace?q=Hilux`; query preserved. |
| 4 | Golden A Marketplace facts | **FAIL** | Identity/price/specs correct; **location still only `Zimbabwe`**; image unavailable. |
| 5 | Landing ↔ Marketplace consistency | **FAIL** | Shared displayed location was internally consistent but wrong; primary image failed to render on both. Canonical full location was not preserved. |
| 6 | Golden A public Detail/Passport Trust | **FAIL** | UI showed **`Sign in to view trust`** instead of 60/evaluated/moderate/low/version. |
| 7 | Golden A same Trust everywhere | **FAIL** | `60` and `trust-decision-1.0.0` absent from public UI; public Passport response also contained conflicting canonical 60 and legacy 80 authorities. |
| 8 | Golden A gallery vs verified evidence | **FAIL** | Evidence separation/count passed: 5 listing-media slots and exactly 4 verified evidence items. **All five listing images failed to render.** |
| 9 | Registration country/authority truth | **PASS** | `Zimbabwe` + `Not recorded`; no bare `ZW`/`CVR` fabricated fallback. |
| 10 | Seller/contact privacy | **PASS** | Private Seller; no fabricated phone; no number published; Call disabled. |
| 11 | Anonymous payload privacy | **FAIL** | Marketplace projection was clean, but public Passport lookup exposed `owner_id`, `tenant_id`, `current_seller_id`. |
| 12 | Golden A Owner Dashboard / notification count | **PASS** | Login worked; dashboard loaded; bell count matched `/api/notifications/me`. |
| 13 | Golden A “Needs your attention” | **FAIL** | Dashboard said **`1 vehicle has no completed trust assessment`** although Golden A has evaluated Trust 60/version. |
| 14 | Wallet / account Trust Index / trend honesty | **PASS** | Wallet Not available; account Trust Index Not calculated/Verification pending; no fabricated balance or value trend. |
| 15 | Golden A My Garage | **FAIL** | Vehicle/price/mileage okay; neutral image placeholder acceptable for this step; **`Trust assessment unavailable` despite canonical 60**. Also 0 docs despite 4 verified evidence. |
| 16 | Golden A per-VIN Garage profile | **FAIL** | No fake valuation language and price correct; **header image unavailable despite canonical listing media**; owner Trust unavailable. |
| 17 | Golden A specs/purchase date | **FAIL** | Mileage/color/engine okay; **`Purchased 8/23/2026` fabricated/mislabelled from `created_at`** rather than governed acquisition date. |
| 18 | Golden A service/parts consistency | **FAIL** | No invented garage/OEM; but My Garage said 0 services/0 parts while detail showed 1 service/1 part. Same VIN disagreed across owner surfaces. |
| 19 | Golden A owner Trust ↔ public Trust | **FAIL** | Owner page said Trust assessment unavailable; canonical value is 60/version. No convergence. |
| 20 | Owner top-bar search | **PASS** | `Hilux` → `/search?q=Hilux`; intent preserved on large-screen layout. |
| 21 | Golden B excluded from Marketplace | **PASS** | Search for VIN returned 0; draft did not leak into public Marketplace. |
| 22 | Golden B direct public Passport | **PASS** | Passport rendered but not as a published listing; no public gallery/evidence; Reserve disabled with explanation. |
| 23 | Golden B public Trust | **FAIL** | UI showed **`Sign in to view trust`** / “no trust score published” instead of canonical 50/evaluated/moderate/low/version. |
| 24 | Golden B public media/evidence withholding | **PASS** | No actual listing photos/thumbnails; pending registration doc not exposed; explicit no-verified-evidence/withheld states; no false clean-history claim. |
| 25 | Golden B Owner “Needs your attention” | **FAIL** | Correctly recognized outstanding work, but falsely said **`1 vehicle has no completed trust assessment`**. B is already evaluated at 50; blocker is pending evidence/publication readiness. |
| 26 | Golden B My Garage status | **PASS** | Recorded `Available` status shown; no invented `Active`. Draft publication badge remained distinct. |
| 27 | Golden B owner detail | **FAIL** | Pending registration evidence correctly shown as Pending review; no valuation/stock image. **`Purchased 8/23/2026` again mislabelled from creation date.** |
| 28 | Golden B publication gate | **FAIL** | Backend safety gate worked: `POST /api/vehicles/CARUPGLDNB0000002/publish` returned 400 and vehicle stayed draft. **Owner only saw generic “Listing is not publishable yet. Resolve the blocking requirements first.” — actual blocking requirement was not named.** |
| 29 | Dealer/Garage/Insurance directories | **PASS** | Explicit verified-only empty states; no invented companies/partners. |
| 30 | Press / Blog truth | **FAIL** | Press narrow criterion passed; **Blog still publishes unsupported/fabricated ZINARA/CarUp integration claims and mock factual content.** |
| 31 | `blockchain` terminology | **PASS** | 0 matches on `/`, `/marketplace`, `/trust`, `/press`, `/blog`. |
| 32 | Local Storage transaction authority | **PASS** | CarUp origin contained only `carup_nav_cohort`, `carup_token`, `carup_user`; no reservation/escrow/payment/transaction authority. |

### Formal score

- **PASS:** 14/32
- **FAIL:** 18/32
- **Physical UAT overall:** **FAIL — remediation required before merge**

> **⚠ READ ADDENDUM A BEFORE ACTING ON THIS MATRIX.**
>
> The above is the **first physical UAT's observed result** and is preserved verbatim. It was
> subsequently established that this run had a **frontend/backend provenance mismatch**: the PR #165
> preview frontend was resolving its API base to `carup-backend-staging.vercel.app`, which serves
> `main` (`87033020`, pre-Phase-8), not the candidate.
>
> Every backend-dependent failure below therefore measured the WRONG contract. Addendum A
> re-classifies each one as a genuine product defect, an environment/pairing artifact, or pending
> re-baseline. **An artifact is not a pass** — it is recorded as
> `INVALID FOR CANDIDATE CERTIFICATION — BACKEND MISMATCH` and must be physically re-run through the
> correctly paired preview before it may receive a PASS.

## 4. Exact evidence captured during UAT

### 4.1 Public Golden A Marketplace payload

The public Marketplace response was clean for the Step 11 forbidden identifiers and contained:

- `trust_score = 60`
- `currency = USD`
- `location = "Zimbabwe"` — incorrect/truncated for the canonical full Bulawayo location
- primary image under `https://media.carup-staging.test/...`
- five media URLs on the same host
- seller type `private`
- trust summary score 60
- no `owner_id`, `tenant_id`, or `current_seller_id` in the Marketplace listing projection.

### 4.2 Public Passport lookup — security/privacy + competing Trust authority

Physical UAT inspected:

`GET https://carup-backend-staging.vercel.app/api/vehicles/passport/lookup/CARUPGLDNA0000001`

Observed in the same public response:

- `vehicle.trust_score = 60`
- canonical metadata present on `vehicle`: `trust-decision-1.0.0`, evaluated_at, band `moderate`, confidence `low`
- full canonical location values present: Bulawayo / Bulawayo Metropolitan / Zimbabwe, with operator provenance
- **forbidden public fields:**
  - `vehicle.tenant_id = null`
  - `vehicle.owner_id = "golden-a-owner-stg"`
  - `vehicle.current_seller_id = "golden-a-owner-stg"`
- **legacy conflicting authority:** `trustReport.trustScore = 80`
- evidence/timeline objects also exposed implementation-oriented fields such as `uploaded_by`, `verified_by`, `storage_bucket`, `file_path`, and Trust-impact metadata.

The explicit Step 11 failure is the owner/tenant/seller identifier leak. The additional evidence implementation fields are an engineering privacy-projection audit item and must not be ignored simply because they were not named by Step 11.

### 4.3 Protected Trust requests

Unauthenticated requests to protected owner/trust routes, including the Trust decision route, returned 401 `Unauthorized. No active user context.` This likely explains why public UI falls back to “Sign in to view trust,” but **the required product behavior is still to publish the governed public Trust projection**. Do not “fix” this by weakening protected-route authorization; fix the public projection/consumer path.

### 4.4 Media failure root evidence

All five Golden A listing-media URLs used:

`https://media.carup-staging.test/...`

Chrome reported:

`ERR_NAME_NOT_RESOLVED`

This is the direct runtime reason the images fail across Landing, Marketplace, Detail and owner surfaces. The media records exist; delivery/URL resolution does not.

### 4.5 Purchased-date source defect

The exact certified owner profile source was inspected. `VehicleProfile.tsx` derives the value labelled `Purchased` from `pv.created_at` via `statedDate(...)`.

That is a semantic fabrication. Vehicle-record creation time is not proof of purchase/acquisition time.

Required behavior:

- render a real governed purchase/acquisition date if one exists, otherwise
- render `Not recorded`.

Do not rename `created_at` into another business fact.

### 4.6 Golden B publication attempt

Owner My Listings correctly showed:

- 2017 Nissan NP200
- USD 9,800
- `Available`
- `Draft — not publicly visible`
- `Publish to Marketplace`

On publish attempt:

- public listing lookup 404 remained expected for the draft vehicle;
- `POST /api/vehicles/CARUPGLDNB0000002/publish` returned **400**;
- exact user-visible/backend error: **`Listing is not publishable yet. Resolve the blocking requirements first.`**

Safety gate PASS; actionable blocker disclosure FAIL. The UI must surface the actual `blocking_gaps`/ownership-document requirement from the server response rather than collapsing it into a generic message.

### 4.7 Step 32 Local Storage

CarUp preview origin keys observed:

- `carup_nav_cohort`
- `carup_token`
- `carup_user`

No reservation/escrow/payment/transaction state was stored. `carup_user` and `carup_token` are expected auth/session client state. Do not move transaction authority into browser storage during remediation.

## 5. OBS-01 through OBS-19 — preserve every observation

These are not all separate formal step failures, but they are part of the owner evidence set and must be triaged. Do not silently drop them.

### OBS-01 — Golden A media visibly broken on public cards

Landing and Marketplace showed unavailable/broken vehicle images for Golden A even though listing media rows existed.

**Disposition:** remediation required; overlaps formal Steps 5/8/16.

### OBS-02 — oversized/sticky action panel obstructs Detail content

The blue Price/Call/Reserve action panel behaved as an oversized/sticky element and could obstruct vehicle details while scrolling.

**Disposition:** responsive/interaction UX defect candidate. Preserve existing business safeguards while fixing layout.

### OBS-03 — location disagreement across surfaces

Golden A Detail reported `Location not recorded`, Landing/Marketplace reported only `Zimbabwe`, while the public Passport payload carried the full governed Bulawayo location.

**Disposition:** canonical projection/consumer convergence defect; overlaps Steps 2/4/5.

### OBS-04 — media delivery root cause confirmed as DNS/host failure

All five Golden A media records pointed at `media.carup-staging.test`; Chrome returned `ERR_NAME_NOT_RESOLVED`.

**Disposition:** fix the media URL/delivery contract. Do not paper over with unrelated stock images.

### OBS-05 — legacy `+5 Trust` / `+5 Points` evidence UI

Evidence UI displayed `+5 Points` / `+5 Trust`; Passport evidence/timeline data contained `trust_score_impact` / `trust_impact`-style fields. This can imply a second/manual Trust calculation path even while canonical Trust should have one authority.

**Disposition:** audit whether this is a legitimate historical governed attribute or stale Trust-calculation UI. It must not create an independent public Trust authority.

### OBS-06 — disabled action labels have poor/invisible contrast

Some disabled actions, especially around Call/Reserve, had labels with poor contrast or appeared almost invisible.

**Disposition:** accessibility/UX remediation; do not re-enable actions merely to make them visible.

### OBS-07 — Owner Dashboard appears older than previously approved redesign

The physical Golden owner dashboard appeared to be an older dashboard than a legitimate redesign previously seen in the programme.

**Disposition:** reconcile PR #161 disposition/ported owner work and history before changing design. Do not blindly restore stale PR #161 code. Determine whether a valid newer dashboard was omitted/superseded and port only compatible presentation changes onto canonical contracts.

### OBS-08 — account Trust Index semantics may differ from vehicle Trust

Dashboard `AUTO-CALCULATED TRUST INDEX` showed `Not calculated / Verification pending` while Golden A vehicle Trust is 60.

**Disposition:** do not fail solely from the current evidence if this tile is truly account-level. Clarify semantics and naming so users cannot confuse account Trust with vehicle Trust. Never fabricate an account score from vehicle score.

### OBS-09 — My Garage document count contradicts evidence

Golden A My Garage showed `0 docs`, while Golden A has four verified evidence documents.

**Disposition:** owner read-model/count convergence defect. Determine the intended definition of “docs”; if it means vehicle evidence, render the governed count. If it means another collection, relabel to avoid false zero.

### OBS-10 — My Garage summary shows zero service/insurance/parts state

Golden A My Garage showed `0 services`, `0 active insurance`, `0 parts tracked` while other owner surfaces/data showed richer state.

**Disposition:** audit each counter’s source/definition. Do not render measurement zero where no canonical measurement/read was performed.

### OBS-11 — Owner Trust unavailable despite canonical 60

Golden A owner surfaces repeatedly showed `Trust assessment unavailable` although the canonical fixture has an evaluated Trust 60/version.

**Disposition:** core Trust consumer convergence defect; overlaps Steps 15/19.

### OBS-12 — `Purchased` date is `created_at`

Golden A and Golden B owner detail pages both displayed `Purchased 8/23/2026`; source inspection proved the field is vehicle `created_at`.

**Disposition:** formal truth defect; overlaps Steps 17/27. Replace with governed acquisition date or `Not recorded`.

### OBS-13 — owner service/parts counts disagree within the same VIN

Golden A My Garage showed 0 services/0 parts while the detailed per-VIN page showed Total Services = 1 and Total Parts = 1.

**Disposition:** same-VIN owner-surface invariant violation; formal Step 18 failure.

### OBS-14 — owner top-bar search absent in mobile layout

Step 20 passed on larger layout, but the owner top-bar search was absent on mobile/narrow layout.

**Disposition:** responsive feature-parity observation. Decide whether intentional; if search is part of the owner shell contract, expose an equivalent mobile affordance.

### OBS-15 — pending Registration Document carries a `Public` badge on owner evidence view

Golden B owner Evidence & Media showed Registration Document = `Pending Review` and also `Public`. Public anonymous Passport correctly withheld it because only verified evidence publishes.

**Disposition:** likely visibility-intent metadata rather than current publication state, but the label is ambiguous. Verify semantics. It must never cause pending evidence to leak publicly or imply verification.

### OBS-16 — My Listings mobile CTA overflows the listing card

On narrow/mobile layout, `Publish to Marketplace` bled outside the listing card/container and created horizontal overflow.

**Disposition:** responsive layout defect. Fix wrapping/stacking/min-width behavior without changing publication semantics.

### OBS-17 — publication rejection is non-actionable

Golden B publication is correctly blocked, but the owner sees only the generic message:

`Listing is not publishable yet. Resolve the blocking requirements first.`

The actual missing requirement — pending/unverified ownership/registration evidence — is not surfaced.

**Disposition:** formal Step 28 failure. Preserve server enforcement and expose actionable `blocking_gaps` safely.

### OBS-18 — `listings` 503 observed after publish attempts

Console also showed a `listings:1` resource returning 503 after the failed publication attempts.

**Disposition:** investigate/reproduce. Do not promote to a separate acceptance failure unless reproducible, but do not discard it. Determine whether it is transient preview/runtime noise or a real post-mutation refresh defect.

### OBS-19 — preserve `/press` and `/blog` design; fix truth, do not delete the surfaces

Owner explicitly approved the visual/product direction of these pages and wants them **kept live and expanded**.

The remediation rule is:

- **preserve the strong Media Hub / CarUp Drive design direction**;
- do not flatten/remove these pages to make tests pass;
- replace unsupported/fabricated factual claims, people, metrics, partnerships, comments and integrations with governed facts, sourced editorial content, explicitly labelled future vision, or honest empty/coming-soon states;
- create a maintainable content-governance model so fabricated corporate/regulatory claims cannot re-enter as hardcoded mock editorial.

The current Blog source still contains unsupported factual-looking material including ZINARA-system and CarUp integration claims. See Section 7.

## 6. Release-blocking remediation clusters — recommended order

All formal FAIL steps must be fixed, but remediation should follow dependency/risk order rather than page order.

### Cluster A — public privacy projection and competing Trust authorities

**Affected:** Steps 6, 7, 11, 19, 23; OBS-05, OBS-11.

Required outcomes:

1. Public Passport must use a strict allow-listed serializer/projection; remove `owner_id`, `tenant_id`, `current_seller_id` and audit evidence implementation fields.
2. Eliminate/retire the legacy `trustReport.trustScore = 80` authority from the public response or make it impossible to conflict with canonical Trust. One VIN cannot publish 60 and 80 in the same payload.
3. Public Detail/Passport must consume the canonical public Trust projection and render 60 for A / 50 for B with evaluated/band/confidence/version.
4. Owner surfaces must consume the same canonical Trust decision, not treat protected-route failure as “assessment unavailable.”
5. Do **not** weaken auth on protected Trust endpoints as a shortcut; expose the intended public-safe Trust read model.

Acceptance:

- A public = owner = 60/version everywhere;
- B public = owner = 50/version everywhere;
- no anonymous private identifiers;
- no second numeric Trust authority.

### Cluster B — canonical location projection

**Affected:** Steps 2, 4, 5; OBS-03.

Required outcomes:

- Golden A Landing, Marketplace and Detail show the governed full location `Bulawayo, Bulawayo Metropolitan, Zimbabwe` or consume one canonical structured location contract that renders equivalently;
- do not collapse a known city/province into country-only;
- do not turn known location into `Location not recorded` on Detail;
- preserve unknown-as-unknown for vehicles that genuinely lack location.

### Cluster C — media delivery/continuity

**Affected:** Steps 5, 8, 16; OBS-01, OBS-04.

Required outcomes:

- repair canonical media URL generation/delivery so the five Golden A listing images resolve in the certified preview/runtime;
- Landing, Marketplace, Detail and Owner use the same canonical listing media;
- no stock-photo substitution;
- Golden B draft media remains publicly gated.

### Cluster D — owner attention/read-model truth

**Affected:** Steps 13, 15, 18, 25; OBS-08, OBS-09, OBS-10, OBS-13.

Required outcomes:

- `Needs your attention` must not say A or B has no completed Trust assessment when both are evaluated;
- B attention must point at the real blocker: pending ownership/registration evidence / not publishable;
- My Garage Trust displays canonical score when available;
- counts/summary facts are consistent with detailed per-VIN facts and have explicit semantics;
- no false zero where data was not actually measured/read.

### Cluster E — purchase/acquisition date semantics

**Affected:** Steps 17, 27; OBS-12.

Required outcome:

- remove `created_at` → `Purchased` mapping;
- show governed acquisition/purchase date if present, else `Not recorded`;
- add regression tests that vehicle creation timestamp cannot be rendered as purchase date.

### Cluster F — publication-gate explanation

**Affected:** Step 28; OBS-17, OBS-18.

Required outcomes:

- keep backend 400/fail-closed behavior;
- return and surface safe, specific blocking requirements such as pending/unverified ownership document;
- verify the frontend preserves structured `blocking_gaps` from API errors;
- investigate the observed post-attempt 503.

### Cluster G — Blog/content governance

**Affected:** Step 30; OBS-19.

Current Blog source contains hardcoded claims presented as current facts, including claims equivalent to:

- ZINARA launched a third-generation portal integrating tolling, vehicle registration and insurance databases;
- ZINARA linked with ZRP and City Parking into one clearing system;
- ANPR toll plazas automatically check licensing/insurance and issue electronic fines;
- CarUp sells insurance directly and pushes a cryptographically signed voucher into the ZINARA database;
- licensing clearance occurs in under three minutes;
- mock authors/biographies, view/like counts and seeded user comments;
- additional unverified market/regulatory/AI/finance claims in other hardcoded articles.

Press narrowly passed Step 30 because fabricated press releases were removed, but its broader corporate copy should also be fact-checked during this content-governance pass.

Required outcomes:

- keep `/press` and `/blog` live and visually strong;
- remove or rewrite unsupported factual claims;
- clearly distinguish **current governed capability**, **editorial claim with source**, and **future vision**;
- do not invent partnerships, provider integrations, funding, people, quotes, metrics, comments or regulatory facts;
- add a regression/content-integrity guard appropriate to the repository.

### Cluster H — responsive/accessibility polish

**Affected observations:** OBS-02, OBS-06, OBS-14, OBS-16.

Required outcomes:

- mobile action rows fit their containers;
- disabled actions remain legible and clearly disabled;
- sticky panels do not obstruct content;
- owner search has intentional responsive behavior.

These are not permission to delay formal truth/security blockers; fix them in the same remediation pass where low-risk.

## 7. What already works — do not regress it

The remediation must preserve these physically proven behaviors:

1. Golden B remains absent from public Marketplace while draft.
2. Golden B direct Passport can render without becoming a published listing.
3. Golden B pending document is withheld publicly and visible to owner as pending.
4. Golden B draft listing media is withheld publicly.
5. Reserve action for B cannot initiate a transaction while seller/listing conditions are unresolved.
6. Publication backend gate rejects B and leaves it draft.
7. Seller contact is not fabricated; Call is disabled when no governed contact is published.
8. Registration country/authority do not fall back to bare fake `ZW`/`CVR` values.
9. Listing media and verified evidence remain separate concepts.
10. Dealer/Garage/Insurance directories use honest verified-only empty states.
11. No `blockchain` wording was found on tested public product surfaces.
12. Local Storage does not assert reservation/escrow/payment/transaction truth.
13. Landing and owner search preserve query intent on the tested layouts.
14. Wallet/value tiles do not invent balances or valuation trends.
15. No stock image was substituted where vehicle media was unavailable.

## 8. Claude/Fable implementation instructions

### Do not start coding by guessing root causes

First reconcile:

- current PR #165 exact head;
- current CI state;
- current Vercel preview SHA/provenance;
- current canonical staging fixture state;
- whether the UAT credential remains granted or has been revoked;
- current public Passport and Marketplace payloads for Golden A/B.

Then make a short remediation map from each formal FAIL to exact files/contracts/tests before editing.

### Keep one lane

All remediation stays on:

`integration/canonical-vehicle-truth-closure`

Do not create another overlapping feature PR.

### Tests must be truth-oriented

For every fixed defect, add/adjust regression coverage that would have failed on `993c1179…`. In particular, tests should prove:

- public Passport cannot expose private identifiers;
- one public Trust value/version per VIN;
- A=60 and B=50 can be rendered from the public contract while protected routes remain protected;
- full governed location is preserved across surfaces;
- media URL contract produces resolvable/staging-valid media rather than a dead synthetic hostname;
- `created_at` cannot masquerade as purchase date;
- owner attention cannot call an evaluated vehicle “not assessed”;
- owner summary counts do not contradict the detailed same-VIN read;
- publication errors surface structured blocking requirements;
- hardcoded/mock editorial cannot assert provider partnerships/integrations as facts.

### Do not “fix” UAT by altering fixtures or expectations

Forbidden shortcuts include:

- changing Golden A from 60 or Golden B from 50 to match the UI;
- marking B’s pending document verified;
- publishing B to make images appear;
- weakening public/privacy projection to make consumer code easier;
- enabling protected Trust routes anonymously;
- replacing broken images with unrelated stock images;
- replacing missing purchase date with another plausible date;
- deleting `/press` or `/blog` instead of governing their content.

## 9. Required re-certification sequence after remediation

The next candidate is not accepted when code “looks fixed.” It must earn the full closure sequence:

1. remediation implemented on same programme branch;
2. local/unit/integration/security tests clean;
3. full web + backend regression clean;
4. TypeScript/build/lint/migration/secret/diff gates clean;
5. push new exact SHA;
6. exact-head GitHub Actions green;
7. fresh independent Codex review **on that exact SHA**, no stale carry-forward;
8. deploy/identify exact-head PR preview and verify `/api/health`/provenance;
9. re-run physical UAT on the affected steps and any dependency-neighbor steps;
10. because the first UAT had broad truth failures, final closure should run the **full 32-step script once clean** before merge;
11. revoke temporary Golden credentials after final physical UAT;
12. request normal independent collaborator approval;
13. protected merge to `main` only after all gates are clean;
14. post-merge staging smoke/invariants against merged `main`;
15. close PR #161 as superseded only after successful post-merge verification;
16. close Issue #164 only with final evidence.

## 10. Physical re-UAT minimum map

While intermediate fixes can be retested narrowly, these are the minimum direct regression steps by cluster:

- Trust/privacy: **6, 7, 11, 13, 15, 19, 23, 25**
- location: **2, 4, 5**
- media: **1, 4, 5, 8, 15, 16, 22, 24**
- owner dates/counts: **15, 17, 18, 26, 27**
- publication: **21, 24, 25, 28**
- content governance: **29, 30, 31**
- browser authority: **32**
- responsive observations: recheck My Listings/mobile detail/mobile owner shell manually.

Final release still requires one complete 32-step clean run.

## 11. Continuation checkpoint template

When context must move to another chat/agent, carry this exact minimum state:

```text
CARUP ISSUE #164 CONTINUATION

Governing objective:
ONE VEHICLE. ONE TRUTH. ONE PUBLIC CONTRACT.

Repo: kudzimusar/carup
PR: #165
Writable branch: integration/canonical-vehicle-truth-closure
PR #161: frozen/read-only; never merge; close superseded only after #165 merge + smoke
Canonical staging Supabase: eoyenigwevnxwwhyhaer

Physical UAT baseline tested: 993c1179f4c9ba19de453e9901f3567f66d7f48e
Physical UAT: 14 PASS / 18 FAIL
Authoritative remediation handoff:
docs/canonical-vehicle-truth/ISSUE164_PHASE8_PHYSICAL_UAT_REMEDIATION_HANDOFF.md
UAT script:
docs/canonical-vehicle-truth/ISSUE164_PHASE8_GOLDEN_UAT_SCRIPT.md

Do not restart architecture. Reconcile live head, then continue the remediation clusters in the handoff.
No production/provider/real-money activation.
After remediation: full gates -> exact-head CI -> fresh Codex -> exact preview -> physical UAT -> protected merge -> post-merge smoke.
```

## 12. Closure criterion

Issue #164 is **not** complete because the engineering candidate passed CI. It is complete only when:

- all formal physical UAT failures above are remediated;
- OBS items are either fixed or explicitly dispositioned with evidence;
- the full 32-step physical UAT is clean on an exact certified candidate;
- independent review/approval is clean;
- protected merge succeeds;
- post-merge staging smoke/invariants succeed;
- temporary Golden credentials are revoked;
- PR #161 is closed as superseded with evidence;
- Issue #164 is closed with final receipts.

Until then, PR #165 remains a remediation candidate, not a certified merge candidate.

---

# ADDENDUM A — provenance correction and re-classification of the first physical UAT

> Added after the first UAT, on the reconciled live branch. **Nothing above this line has been
> edited.** The original evidence stands exactly as the owner recorded it; this addendum explains why
> the *interpretation* of that evidence changed, and records the classification history so a future
> agent can see why the defect count moved.

## A.1 The first physical UAT had a frontend/backend provenance mismatch

**The 14 PASS / 18 FAIL result in §3 remains the first physical UAT's observed result.** It is not
amended, and it is not converted into passes.

However, that run cannot be treated as an exact-candidate end-to-end certification, because the
frontend preview under test was not talking to the candidate's backend.

Measured, not inferred:

| Evidence | Value |
|---|---|
| `web/src/lib/apiClient.ts` → `isStagingFrontendHost()` | matched **any** `carup-staging-*.vercel.app`, including per-branch previews |
| Consequence with no `VITE_API_URL` | resolved to `DEFAULT_STAGING_API_BASE_URL` = `https://carup-backend-staging.vercel.app/api` |
| That backend's `/api/health` | `commit_sha_short: 87033020`, `branch: main` — **pre-Phase-8** |
| The deployed bundle's compiled `import.meta.env` | `{}` — so `VITE_API_URL` was genuinely undefined |
| §4.2's own inspected URL | `carup-backend-staging.vercel.app` — the host the UAT script §0 had already ruled out |

So the PR #165 **frontend** was exercised against **`main`'s backend**. Every backend-dependent step
measured `main`'s contract while appearing to certify the candidate. Nothing in CI could have caught
it: CI never exercises the deployed pairing.

## A.2 Classification vocabulary

Each formal step is now recorded under exactly one of:

- **A — GENUINE PRODUCT DEFECT.** Reproduces against the correctly paired candidate, or is
  frontend/fixture-only and therefore backend-independent.
- **B — ENVIRONMENT / PAIRING ARTIFACT.** The candidate is measurably correct; the observed failure
  was produced by the mismatch. **This is NOT a PASS.** It is recorded as
  `INVALID FOR CANDIDATE CERTIFICATION — BACKEND MISMATCH` and must be physically re-run through the
  correctly paired frontend before it may receive a PASS.
- **C — PENDING RE-BASELINE.** Not yet settled; requires the paired re-run, and in some cases an
  authenticated Golden owner session.

No step is waived. A step in class B has *no result* until it is re-run.

## A.3 Re-classification of the 18 failures

Class B items were verified against the paired candidate backend
(`carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app`), several of them in a
real browser on the paired preview.

| Step | Original | Class | Evidence |
|---:|---|:---:|---|
| 2 | FAIL | **B** | Candidate marketplace summary returns `location: "Bulawayo, Bulawayo Metropolitan, Zimbabwe"`, `location_state: "recorded"`. Main returns country-only. |
| 4 | FAIL | **B** | Same payload, same verification. |
| 5 | FAIL | **A + B** | Location half is B (above). **Media half is A** — see Cluster C. |
| 6 | FAIL | **B** | Browser-verified on the paired preview: the Trust panel renders **60 / Moderate trust / Evaluated / Low confidence**. `Sign in to view trust` is absent from the DOM. |
| 7 | FAIL | **B** | Candidate passport publishes ONE `trustReport` — the canonical projection (`score 60`, `trust-decision-1.0.0`). The legacy `trustScore: 80` exists only on main. |
| 8 | FAIL | **A** | Structure was already correct (5 media / 4 verified evidence, separated). The failure is that the artifacts do not exist — Cluster C. |
| 11 | FAIL | **B** | Candidate passport contains no `owner_id`, `tenant_id` or `current_seller_id`. Main leaks all three. |
| 13 | FAIL | **B** | `/api/vehicles/me` attaches canonical `trust` via `withCanonicalTrust` on the candidate; `git show 87033020:backend/server.js` contains **0** occurrences of that helper, so main returns raw rows with no `trust` key and `readOwnerTrustClaim` correctly falls to `unavailable`. |
| 15 | FAIL | **B + A** | Trust half is B (above). **Docs count is A** — `vehicles` has no `documents` column. |
| 16 | FAIL | **B + A** | Owner header image: main publishes no `listing_media` block at all (B). The image still cannot load (A, Cluster C). |
| 17 | FAIL | **A** | `purchaseDate: statedDate(pv.created_at)` — frontend-only, source-proven. |
| 18 | FAIL | **A** | Same-VIN contradiction is real and is worse than reported: see A.4. |
| 19 | FAIL | **B** | Same mechanism as 13. |
| 23 | FAIL | **B** | Same mechanism as 6/7, for Golden B's canonical 50. |
| 25 | FAIL | **B + A** | False "no trust assessment" is B. **The absence of a publication-readiness item is A.** |
| 27 | FAIL | **A** | Same `created_at` defect as 17. |
| 28 | FAIL | **A** | Confirmed and now explained exactly — see A.4. |
| 30 | FAIL | **A** | Blog/Press content — unchanged, genuine. |

**Why "Sign in to view trust" appeared is worth recording**, because it is the opposite of a bug:
`readPublicTrust` requires `evaluation_state` and returns `null` for main's legacy
`{vin, trustScore, metrics}` shape. Its own comment says so — *"against a server that still serves the
old passport body this page reports 'unavailable' instead of quietly publishing the 70-baseline
engine's number again."* The page **failed closed exactly as designed** and refused to publish main's
stale 80. Do not "fix" it.

## A.4 What the paired re-verification ADDED to the defect list

Re-baselining did not only subtract. It surfaced defects the first run could not see:

- **Step 6 — the calculation version is not on the Trust panel.** `trust-decision-1.0.0` is rendered
  only inside the **inactive** "Market Analysis" tab, so the version the step requires is absent from
  the Trust panel. Browser-verified: the score renders, the version does not. **Not yet remediated.**
- **Step 18 is worse than recorded.** `serviceHistory` and `partsHistory` were built from the SAME
  `event_source === 'service'` filter, and the only such events are PartSentry part logs — so Golden
  A's single part log was published as *both* "1 service" and "1 part". Measured on canonical staging:
  Golden A has `partsentry_logs = 1`, `mechanic_work_orders = 0`, `insurance_records = 1` (active).
  The per-VIN page was also hardcoding `insuranceRecords: []`, so one active policy rendered as none.
- **Step 15 / OBS-09/10 are false zeros at the schema level.** `vehicles` has **no** `documents`,
  `service_records`, `parts` or `insurance_records` column (measured), so `|| 0` published four
  unmeasured zeros per vehicle.
- **Step 28 has an exact root cause.** `evaluateCompleteness` splits unmet blocking requirements into
  `blocking_gaps` (missing) and `pending_gaps` (pending_review). Golden B's only unmet requirement is
  an uploaded ownership document awaiting review → `pending_gaps: [ownership_document]`,
  `blocking_gaps: []`. The 400 body omitted `pending_gaps` entirely and both publish handlers gated on
  `blocking_gaps.length`, so the only case that occurs fell through to the generic sentence.
- **OBS-05 is a real second Trust authority.** `PremiumEvidenceGallery` renders `+5 Trust` / `Trust
  Impact +5 Points` from `vehicle_evidence.trust_score_impact`, which feeds only the DEPRECATED
  trustGraph engine — the canonical service never reads it. **Not yet remediated.**

## A.5 Cluster I — preview provenance (NEW, P0, closed)

Commits `0cc2e0f5`, `1aa63d88`.

- `resolveApiBaseUrl` now separates stable staging aliases from per-branch previews. An unpaired
  preview resolves to `https://unpaired-preview.carup.invalid/api` (RFC 2606 — can never resolve).
  Deliberately **not** the empty string: several call sites read
  `BASE_URL || DEFAULT_PRODUCTION_API_BASE_URL`, and an empty base there falls through to PRODUCTION.
- `web/preview-backend-pairing.json` maps branch → backend preview, applied at build time by
  `web/vite.config.ts`, which also bakes in the build SHA and emits `/carup-provenance.json`.
- `web/src/lib/previewProvenance.ts` + `PreviewProvenanceBanner` compare the bundle's build SHA
  against the backend's `/api/health` `commit_sha` at runtime and block UAT on anything not provably
  paired. An unverifiable pairing is treated as a wrong one.
- `scripts/issue164-uat-provenance-receipt.mjs` produces the pre-UAT receipt.

**Do not prove pairing by scanning the bundle.** Vite INLINES `VITE_API_URL` at each call site while
`DEFAULT_STAGING_API_BASE_URL` remains as an unused constant, so the presence of a hostname proves
nothing — that false positive blocked a correctly-paired preview on this guard's first run. Read
`/carup-provenance.json`.

### Provenance receipt (required before any physical UAT)

```
frontend preview URL      https://carup-staging-git-integration-canonical-vehicle-tr-7bafc7-11-11.vercel.app
backend preview URL       https://carup-backend-staging-git-integration-canonical-ve-df06b3-11-11.vercel.app
API base compiled in      the paired backend preview (source: preview-backend-pairing.json)
frontend candidate SHA    1aa63d88…
backend /api/health SHA   1aa63d88…
SHA equality              EQUAL
calls stable carup-backend-staging.vercel.app   no
→ VALID FOR UAT
```

Independently confirmed in a real browser: all six API calls on `/marketplace?q=Hilux` went to the
paired backend; **zero** went to the stable one.

## A.6 Remediation status

| Cluster | Status |
|---|---|
| I — preview provenance | **DONE**, verified by receipt + browser |
| C — media | **CODE DONE**; the staging fixture write is **OWNER-ACTION BLOCKED** (see A.7) |
| B — location | **DONE** — browser-verified live: Detail renders `Bulawayo, Bulawayo Metropolitan, Zimbabwe` |
| D — owner read-model | **DONE** (governed counts, parts/services split, insurance) |
| E — date semantics | **DONE** (`Purchased` and `Listed` both un-fabricated) |
| F — publication disclosure | **DONE** — gate untouched, `pending_gaps` propagated |
| G — content governance | **DONE** — 13 findings closed, both surfaces live, 19-test guard |
| H — responsive/accessibility | **DONE** — OBS-02/06/14/16, 10 regression tests |
| Step 6 calculation version | **DONE** — published on the Trust panel |
| OBS-05 second Trust authority | **DONE** — `+N Trust` removed from the deprecated source |
| Test-environment containment | **DONE** — see Addendum B |

**Every engineering cluster is closed. The only outstanding engineering/runtime item is Cluster C's
staging fixture write (A.7), which requires an owner-side credential step.**

### Gate status on the remediation candidate

| Gate | Result |
|---|---|
| web suite | **1054 / 1054** |
| backend suite (local, CI-parity env) | **4135 total / 4123 pass / 0 fail / 12 skipped** |
| TypeScript (`web/tsconfig.app.json`) | 0 errors |
| lint regression gate | `NET_NEW_ERRORS=0`, `NET_NEW_WARNINGS=0` |
| CR-1 credential scan | clean (1923 tracked files) |
| `git diff --check` | clean |

One CI finding worth recording, because it is the same discipline this programme is about: the
blocking CR-1 scan rejected two lines of the new containment TEST, where fixture URIs carried a
`postgres:redacted@` userinfo section. The scanner matches the *shape*, and a scanner taught to
ignore a shape because one instance is fake stops being a scanner — so the fixtures were made
credential-free rather than the scanner relaxed.

## A.7 BLOCKER — the Cluster C staging fixture write cannot be executed by the assistant

Golden A's five listing-media rows and all evidence rows still carry Phase 7's unresolvable
locators. The code that repairs them is complete and tested, but applying it to canonical staging
requires a service-role credential, and there is none available:

- `.env.staging`'s `SUPABASE_SERVICE_ROLE_KEY` is a **32-character placeholder**, not a JWT — the
  script's own guard rejects it (`BLOCKED: … is not a service-role JWT`).
- Supabase storage RLS grants **no** anon or authenticated INSERT on `vehicle-images`
  (`provider_buckets_no_anon` denies; no permissive policy exists), so a publishable key cannot upload.
- The governed dispatcher `.github/workflows/issue164-golden-vehicles-dispatcher.yml` is
  `main`-only **and** owner-actor-only, and its `CANDIDATE_SHA` is pinned to the Phase 7 fixture
  `18897a45` — so even if dispatched it would run the OLD code.

What is already proven without it:

- The canonical delivery contract is **live**: the public object URL host resolves in ~51 ms and
  returns HTTP 400 for a missing object, versus DNS failure for `media.carup-staging.test`.
- `vehicle-images` currently holds **0** objects, confirming the fixture never uploaded anything.

### A.7.1 Credential guard hardened before the owner step

Raised on review of candidate `1430546b`: the runner validated the credential by SHAPE only —
`key.split('.').length === 3`. A legacy Supabase **anon** JWT is also three segments, so an operator
who pasted the anon key would have passed the guard and run the fixture under RLS. That fails by
silently seeing no rows: a wrong-credential fault wearing the costume of missing data.

The guard now decodes the JWT payload and requires `role === "service_role"` before any Supabase
client is constructed. The signature is deliberately not verified — that would require the project's
JWT secret, which this script must never hold, and a forged token is not the risk being managed
(Supabase rejects it on the first request). What is prevented is an honest operator mistake.

Nothing derived from the token is logged. The refusal is INVARIANT across roles — pinned by test, so
a message that cannot vary with the token's contents cannot be reporting them.

Proven (`backend/tests/issue164-phase8-service-role-guard.test.js`, 12 tests): service_role accepted;
anon rejected; authenticated/user rejected; no-role rejected; malformed rejected; publishable/non-JWT
rejected; wrong host rejected; production ref rejected. Every token is BUILT AT RUNTIME rather than
written as a literal — a real base64url JWT begins `eyJ`, which is exactly what the blocking CR-1
scanner matches, and relaxing the scanner to accommodate a test would be the wrong trade.

### A.7.2 First guarded staging run — stopped at `verify_1`, verifier defect found and fixed

The owner ran the full guarded `--mode=sequence` with a temporary local service-role injection. It
stopped exactly where a fail-closed sequence should:

```
STEP verify_1: failed = ["A:evidence_fetchable","B:evidence_fetchable"]
sequence-exit=1
```

**What the run PROVED (runtime evidence, canonical staging):**

- the staging identity guard passed with a real `service_role` credential;
- `bootstrap_1` = `ok: true`;
- all **7** synthetic listing images uploaded to the public `vehicle-images` bucket;
- all **5** synthetic evidence PDFs uploaded to the private `ocr-documents` bucket;
- **`media_fetchable` did NOT fail** — the new public image delivery path works end to end, which is
  the core of Cluster C.

**The defect was in the verifier, not the delivery.** `verify()` selected
`id, evidence_type, verification_status, file_url`, but the fetchability probe requires
`storage_bucket` and `file_path` to mint a signed read for the private bucket. It was therefore
handed rows that could not carry a locator, and reported "no storage locator" for every document.
The verifier was not loading the fields it verifies.

**Two things hid it, and both are now closed:**

1. The source-test mock returned the WHOLE row whatever the select requested — strictly more generous
   than PostgREST. A mock that answers questions the server would not answer cannot prove the
   server's contract. It now projects to the selected columns, and reverting the select fix alone
   reproduces the owner's exact failure signature locally.
2. `evidence_bucket_exists` passed **vacuously**: it filtered out undefined buckets before asserting,
   and `[].every()` is true. It now asserts per row. An invariant that cannot fail is not an
   invariant.

Fixed by loading the locator fields. `evidence_fetchable` was NOT weakened and `ocr-documents`
remains private — the probe still mints a signed read and fetches it.

The sequence aborted before cleanup, so the Golden fixture rows and storage objects remain in
staging. They are deliberately NOT being removed by hand: the corrected sequence is idempotent and
will reconcile/reuse them, which is itself part of the proof.

**Owner action required — choose one:**

1. Provide a working staging service-role key, and the assistant runs
   `node backend/scripts/issue164-golden-uat-hash.mjs`-style guarded bootstrap → verify → browser
   render proof → cleanup; or
2. Merge a small control-plane PR repinning the dispatcher's `CANDIDATE_SHA` to the certified
   remediation head, then dispatch it with `--mode=sequence`.

Until one happens, Steps 1, 4, 5, 8, 15, 16 cannot pass a physical re-UAT.

## A.8 Local test-suite status

Backend suite on the assistant's machine: **4123 total / 4109 pass / 2 fail**.

- One failure was a genuine regression introduced during Cluster C and has been **fixed**: repairing
  legacy media rows with `.eq('id', …)` broke the Phase 5 media-identity containment rule (no
  `listing_images` query may be keyed by its own id — it is the enumeration oracle Phase 1 closed).
  Caught by `backend/tests/issue164-phase5-media-identity-containment.test.js`. Now keyed by
  `(vin, image_url)`.
- The other, `provision-staging-qa-accounts.test.js` → *"every provisioned role is valid against the
  REAL users role catalog"* → `28P01 password authentication failed for user "postgres"`, is
  **environmental and pre-existing**, proven by mechanism rather than assumed:
  `backend/db/supabase.js` calls `dotenv.config()`, which loads the machine-local `.env`; that file
  supplies `SUPABASE_DB_URL` pointing at `db.vhmnajoeicasaigiophh.supabase.co` (**production**), whose
  password has been rotated. `.env` is gitignored and untracked, and `ci.yml` sets `SUPABASE_DB_URL`
  **zero** times, so on CI the live-DB branch is skipped entirely and the test passes.
  **Latent hazard worth a separate ticket:** on any developer machine holding a production `.env`,
  this test attempts a live connection to the production database.

---

# ADDENDUM B — newly discovered certification-containment defect: test processes could reach production

Discovered while classifying the last outstanding local test failure during Phase 8 remediation. It is
**not** an Issue #164 product defect; it is a defect in the conditions under which Issue #164 is being
certified, which is why it is recorded here and was closed immediately rather than deferred.

## B.1 The defect

`backend/db/supabase.js` calls `dotenv.config()` at module scope. Nearly every backend test reaches
that module through a static import chain, so running the suite loads the developer machine's generic
`.env` into `process.env`. On a CarUp maintainer's machine **`.env` is the PRODUCTION environment
file**. `provision-staging-qa-accounts.test.js` then does:

```js
if (process.env.SUPABASE_DB_URL) { await new pg.Client({ connectionString: … }).connect() }
```

…so a `NODE_ENV=test` process **opened a connection to the production database**. It failed only
because the password had been rotated (`28P01`), and it surfaced as an ordinary test failure rather
than as a containment breach.

Measured, not assumed:

| | |
|---|---|
| `.env` defines `SUPABASE_DB_URL` | yes, host `db.vhmnajoeicasaigiophh.supabase.co` (**production**) |
| `.env` tracked in git / gitignored | untracked / gitignored |
| `ci.yml` sets `SUPABASE_DB_URL` | **zero** times |
| CI "real PostgreSQL" steps | all in-process **PGlite** — no connection string |
| `communication-postgres` job | `postgres://…@localhost:5432/postgres` — a service container |

So CI was never affected, which is precisely why nothing caught it. **A certification run that can
reach production is not contained, whatever the connection returns.**

The guard also found a **second** inherited production vector the investigation had not named:
`DATABASE_URL`.

## B.2 The rule implemented

`backend/db/testDatabaseContainment.js`, applied in `backend/db/supabase.js` immediately after
`dotenv.config()` and before any client is constructed. Under `NODE_ENV=test` only:

1. A guarded database URL that a **dotfile injected** into a process that did not already have one is
   **removed** — whatever it points at. The test then behaves exactly as it does in CI: it skips its
   live-database branch.
2. A guarded database URL that was **deliberately exported** and references the **production** project
   is **refused** — it throws before any connection.

Order matters, and the first draft got it wrong. Throwing on an *inherited* production URL made the
entire backend suite unrunnable on any maintainer machine holding a production `.env` — blocking
certification rather than protecting it. An inherited value is one nobody asked for; dropping it is
both fail-closed and non-breaking. An explicit export is a considered act, and *that* is refused.

Scope is deliberately narrow: three variables (`SUPABASE_DB_URL`, `DATABASE_URL`,
`DIASPORA_STAGING_DATABASE_URL` — the set the existing staging guard already covers).
`COMMUNICATION_STAGING_DATABASE_URL` is explicitly supplied by its own workflow under `NODE_ENV=test`
and is deliberately out of scope. No other environment variable is inspected, and non-test processes
are untouched.

## B.3 Proof

`backend/tests/issue164-phase8-test-database-containment.test.js` — 11 tests, all failing on baseline
`993c1179` where no containment existed. They prove: a deliberate production target is refused before
a client is constructed; an inherited one is dropped and reported as `(PRODUCTION)`; an explicitly
exported localhost or staging database still works; CI with no dotfile is byte-identical; non-test
processes keep their own database; only the three named variables are inspected; and the wiring order
in `supabase.js` is snapshot → dotenv → contain → client.

**No production credential, host or connection is required to prove any of it** — the guard is a pure
function over an environment object.

End-to-end on the machine that exhibited the defect, `provision-staging-qa-accounts.test.js` now
reports **11/11 pass**, with:

```
[carup] NODE_ENV=test: ignoring SUPABASE_DB_URL (PRODUCTION), DATABASE_URL (PRODUCTION)
        inherited from a dotfile. A test that needs a database must be given one explicitly
        by its environment.
```

That was the last unexplained local failure. It is now closed by containment rather than by
classification.

---

# ADDENDUM C — Cluster C closed: privileged staging sequence PASS + browser runtime proof

## C.1 Guarded staging sequence — PASS

The owner re-ran the full guarded `--mode=sequence` with a temporary local service-role injection
against canonical staging `eoyenigwevnxwwhyhaer`, on candidate `5b80f720`.

```
SEQUENCE PASS — receipt written to issue164-golden-vehicles-receipt.json
sequence-exit=0
```

Receipt preserved at `docs/canonical-vehicle-truth/evidence/issue164-phase8-cluster-c-sequence-receipt.json`
(non-secret: counts and step names only). Every step passed:

| Step | Result |
|---|---|
| `baseline` | captured |
| `bootstrap_1` / `verify_1` | ok / **ok** — the locator fix landed |
| `bootstrap_2` / `verify_2` | ok / ok |
| `no_duplicate_graph` | `identical: true`, no diffs |
| `unrelated_preserved_through_bootstrap` | ok, no diffs |
| `cleanup_1` | ok, scoped deletions only |
| `absence_after_cleanup` | `absent: true` |
| `cleanup_2_idempotent` | **`deleted: {}`** — a second cleanup removes nothing |
| `unrelated_preserved_through_cleanup` | ok, no diffs |
| `bootstrap_3` / `verify_3` | ok / ok — fixture left in the final verified state |

`productionTouched: false` · `liveProviderActivated: false` · `geminiActivated: false`.

## C.2 Database state after the sequence

- Golden A: **5** listing images; Golden B: **2** — governed counts exact.
- Every locator is now `https://eoyenigwevnxwwhyhaer.supabase.co/storage/v1/object/public/vehicle-images/…`.
- Evidence: Golden A 4 × `verified`, Golden B 1 × `pending` (`verified_by` null), all in the PRIVATE
  `ocr-documents` bucket with a relative `file_path`.
- **Zero** `carup-staging.test` locators and **zero** legacy `phase7-golden` buckets remain.

## C.3 Runtime reachability

| Check | Result |
|---|---|
| All 5 Golden A images | HTTP **200**, `content-type: image/png`, valid PNG signature, ~9 KB each |
| Private evidence via PUBLIC url (A and B) | HTTP **400** — the bucket is private, as required |
| Signed-read path | exercised by `verify_3` (`evidence_fetchable` ok) |

`evidence_fetchable` was not weakened and `ocr-documents` was not made public.

## C.4 Browser proof — paired preview `5b80f720`

Provenance receipt re-run first: frontend SHA == backend `/api/health` SHA == `5b80f720`, API base is
the paired backend preview, **zero** calls to the stable staging backend.

**Golden A Detail** — screenshot `evidence/issue164-clusterC-goldenA-gallery.png`:

- **6/6 images loaded, 0 broken**; all from canonical storage; **0** `.test` requests.
- Every image `960×640` — the synthetic asset's own dimensions, so this is real content, not a
  fallback or a substitution.
- Gallery reads **"1 / 5"** with five visibly distinct panels.
- Evidence rendered in its own section: *"These are not the listing photos above."*
- Location `Bulawayo, Bulawayo Metropolitan, Zimbabwe` · Trust **60** · **`trust-decision-1.0.0`**.
- Network: five `…/vehicle-images/CARUPGLDNA0000001/golden-*.png` → **200**; **no** request to
  `ocr-documents`; `/trust-decision` and `/sources/coverage` correctly **401** anonymously while the
  page still publishes 60 from the public passport.

**Landing / Marketplace** — canonical media, `960×640`, full governed location, `$21,500`, no stock or
`.test` sources; Golden B absent from both.

**Golden B public passport** — **0 images** (draft media fully gated), Trust **50** +
`trust-decision-1.0.0`, Reserve **disabled** with its explanation, no pending-evidence disclosure.

**Golden B marketplace search** — `Browse 0 published listings`, `0 vehicles found`, no listing card;
the only VIN occurrences are the echoed search query and its filter chip.

### An incidental proof of the OBS-01 fix

Landing initially reported one broken image. It resolved to a **non-Golden** staging vehicle whose
media points at `/uat/owner/toyota-corolla.svg`, a file absent from the deployment — the SPA rewrite
returns HTTP 200 with `text/html`, which cannot decode as an image. Scrolling it into view showed the
`ListingImage` `onError` fallback working exactly as designed: the `<img>` was removed and replaced by
the branded placeholder *"2019 Toyota Corolla — image unavailable"*, leaving **0** broken images.

The first count was a measurement artifact of my own: `loading="lazy"` means a below-fold image is
`complete: false` with `naturalWidth: 0` **before it has failed**, which is indistinguishable from a
failure unless you wait for it. Worth remembering when reading any image-health assertion.

## C.5 Status

**Cluster C is CLOSED for all public surfaces.** The remaining item is the OWNER GARAGE view, which
requires an authenticated Golden owner session — that credential is deliberately unprovisioned
(`password_hash` null) and its provisioning is the same owner action that gates the full 32-step UAT.
It is therefore carried into the physical re-UAT rather than being blocked on separately.

---

# ADDENDUM D — pre-push adversarial review of the credential-grant path

The Golden UAT credential grant writes `password_hash` on four staging identities, so the change was
put through a four-lens adversarial review (blast radius, credential hygiene, guard ordering, test
integrity) BEFORE being pushed. It found a P0 in my own fix. Findings are classified rather than
merely refuted; a passing unit test was not accepted as a dismissal.

## D.1 Findings

| # | Finding | Class | Resolution |
|---:|---|---|---|
| 1 | `let preHashed` declared TWICE — the validated hash was discarded and the grant path was dead by construction | **VALID (P0)** | Single declaration. All three lenses found it independently. |
| 2 | Derived-key regex `{64,}` accepted a TRUNCATED key | **VALID (P1)** | `hashPassword` always emits `scrypt:<32 hex>:<128 hex>` (`SCRYPT_KEYLEN = 64` bytes, measured). Tightened to exact `{128}`. A short key writes a hash `verifyPassword` can never match — the silent lockout the check exists to prevent. |
| 3 | No test executes the grant path | **VALID (P1)** | New CLI-invocation suite that SPAWNS the scripts. |
| 4 | The auth script kept the same module-scope mode validation just removed from its sibling | **VALID (P2)** | Moved under the direct-invocation guard. Fixing one direction only would have moved the trap, not closed it. |
| 5 | Hash file read with no ownership/permission check, symlinks followed | **VALID (P2)** | Rejects symlink, non-regular file, group/world-accessible, and foreign-owned — honouring the `O_EXCL 0600` its producer creates it with. |
| 6 | `main()` fell through to the destructive `sequence` for any unrecognised mode | **VALID (P2)** | `sequence` is now asserted explicitly; `--mode=sequnce` blocks. |
| 7 | The new "users read must be scoped" assertion was VACUOUS | **VALID (P2)** | Proven: the negative lookahead passed when `.in(...)` was deleted entirely — it caught a *wrong* scope but not a *missing* one. Replaced with a positive assertion plus an unscoped-read check. |
| 8 | Both credential sources silently resolved by precedence | **VALID (P2)** | Refused as an ambiguity. |
| 9 | A mid-loop failure leaves a partial grant | **ALREADY COVERED, hardened** | `fail()` exits 1, so a partial grant can never exit 0. It printed nothing, so it now reports which accounts were already written. |
| 10 | `credentialSource` always reported `'env'` | **DUPLICATE of #1** | Resolved by the P0 fix, now pinned by test. |

## D.2 The lesson that outlived the bugs

**My first CLI suite passed with the P0 deliberately reintroduced.** With a dummy credential the run
dies at the users-read before any write, so nothing observed which binding the credential landed in.
A test that cannot fail is worth nothing, and there were two here — the vacuous scoping assertion was
the other.

The fix was to make the property observable at the point it matters: the script now reports the
credential source **from the same binding the write reads**, before any database access. Re-running
the mutation with the shadowing restored now fails (`not ok 2`). Both guards were verified by
mutation rather than assumed.

## D.3 What the grant now proves

- **Subject containment** — four hard-pinned `@carup-staging.test` identities; the list is a frozen
  literal that reads neither `argv` nor `env`; the users read is positively asserted to be scoped to
  it; all four must exist before any write; a partial grant exits non-zero and names what was written.
- **Environment containment** — exact canonical staging hostname, production ref refused, and the
  `service_role` role claim decoded and required before any client is constructed.
- **Credential hygiene** — plaintext is never read on the hash-file path; the hash is read locally
  from an owner-only regular file; no hash content appears in any output on any path (asserted);
  malformed, truncated, short-salt and non-lowercase hashes are refused before database access.
- **CLI behaviour** — importing `evaluateStagingGuard` no longer interprets the caller's `--mode`;
  the fixture runner still validates its own modes when executed; grant/status/revoke are covered by
  real spawned invocations, not only imported functions.

---

# ADDENDUM E — fresh independent Codex review on `98e90c8d`

Requested on the exact head with no carry-forward (the previous clean result was on `993c1179`, which
predates the entire remediation). Codex returned **4 inline findings**. All four are **VALID**; none
was dismissed on the strength of a passing test.

## E.1 P1 — the Supabase REST endpoint was still reachable in tests

The containment guard in Addendum B covered Postgres connection URLs only. But `db/supabase.js`
builds a **service-role** client from `SUPABASE_URL` immediately after `dotenv.config()`, and on a
maintainer's machine that dotfile supplies the **production** project. Measured: `.env`'s
`SUPABASE_URL` host-ref is the production ref, and **24 backend test files** do

```js
process.env.SUPABASE_URL ||= 'http://localhost:54321'
```

which **preserves** the inherited value rather than overriding it. So every Supabase read and write in
those files was aimed at production with an RLS-bypassing key.

This is a bigger hole than the one Addendum B closed, in the same guard, and it was missed because I
reasoned about the *connection string* rather than about *every way the process can reach a project*.

**Fixed.** Containment now covers `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`.
A dotfile-supplied endpoint is **substituted** with the CI-parity local values (not deleted —
`db/supabase.js` throws without them, and these are exactly what CI has always supplied); an
explicitly exported production endpoint is **refused**. Non-test processes are untouched, and CI with
no dotfile is byte-identical. Five new tests.

## E.2 P1 — identity and role were not verified before granting a credential

The grant matched rows by email alone. A pinned address whose row had drifted to a privileged role
would still receive the shared UAT credential — and `POST /api/auth/login` copies `users.role`
straight into the session, so an `admin` row would have turned an owner/buyer grant into an
administrator login.

**Fixed.** Each row must now match its **deterministic Golden id** and its **expected role**, sourced
from `GOLDEN_USERS`. Any mismatch fails the whole grant before a single write, rather than skipping a
row.

## E.3 P2 — service history could never populate

My Cluster D fix separated parts from services by excluding `partsentry:` events. But the passport
timeline carried **no** mechanic work orders at all, so the new predicate produced an always-empty
service history while `/api/vehicles/me` correctly counted the same work orders — a fresh
same-VIN contradiction, introduced by the change that was meant to remove one.

**Fixed at the root.** `getVehicleTimeline` now reads `mechanic_work_orders` and emits them under
`event_source: 'service'` with a `workorder:` id prefix. Services and parts are each read from their
own governed source — the same two sources the counts use — so the per-VIN page and My Garage cannot
disagree.

## E.4 P2 — a failed storage removal was recorded and ignored

`cleanup` copied a storage error into `detail` and returned normally, so the reporter marked the step
successful and cleanup went on to delete the locator rows. The sequence could have reported PASS while
leaving orphaned objects that nothing in the database can find again.

**Fixed.** A non-null removal error now throws. Removing an object that is already gone still succeeds,
so idempotency is preserved — pinned by both tests.

## E.5 Note

Findings E.1 and E.3 are both cases of a fix being narrower than the property it claimed to establish:
one guarded the connection string but not the project, the other separated two collections without
giving one of them a source. Worth remembering when reviewing any "fixed" claim in this programme.

---

# ADDENDUM F — second Codex round on `2e69e085`

Re-review on the head that Addendum E's fixes produced. Four more inline findings, **all VALID**, and
all four are consequences of those fixes. Recorded because the pattern matters more than the bugs: a
remediation is itself a change, and each one opens new surface.

## F.1 P1 — I introduced a PII leak while fixing the service/parts divergence

Adding `mechanic_work_orders` to the passport timeline put the user-entered `description` into
`event.desc`. The public timeline sanitizer had no `service` branch, so it passed that text straight
through to `publicDescription` for **anonymous callers by VIN**.

Worse than reported: the table also carries `customer_name` and `customer_id`. Free text typed into a
work order — a complaint, a name, a phone number — would have become publicly readable.

**Fixed two ways.** The producer no longer selects `description`, `issue_description`, `customer_name`
or `customer_id` at all; only the controlled `status` and the recorded cost travel. And the public
sanitizer now has a `service` branch, so even a future change that starts emitting free text cannot
publish it anonymously.

## F.2 P1 — the identity/role check disarmed REVOKE

Addendum E's drift check ran for **every** mode. If a Golden row drifts to a privileged role *after* a
credential was granted, refusing `revoke` would leave the shared UAT password **active on exactly the
account that most needs it cleared** — the opposite of containment. `status` was equally blocked, so
drift could not even be investigated.

**Fixed.** The refusal is scoped to `grant`. `status` and `revoke` continue and warn.

## F.3 P2 — cleanup still deleted the locator rows after a storage failure

Making the storage step throw was not enough: `makeReporter().step()` **catches** the throw and
records `ok: false` without aborting, so the deletion plan still ran. Objects that could not be
removed were orphaned with their locator rows deleted — nothing left in the database to find them by.
The receipt said `false`; the damage happened anyway.

**Fixed.** Cleanup checks the storage step's result and returns before any database deletion, leaving
the locators in place precisely so the objects stay discoverable. The test now asserts the row counts
are unchanged, not merely that the receipt is false.

## F.4 P2 — the recorded service cost was dropped

The work-order query omitted `total_cost`, so `details.cost` was absent and `VehicleProfile`'s cost
reducer treated the missing value as zero — a vehicle with paid service work displayed as **$0**. That
is the false-zero class Cluster D exists to remove, reintroduced two commits after removing it.

**Fixed.** `total_cost` is selected and published as the event's cost.

## F.5 A fifth, self-caught: the PII fix was too BROAD

The F.1 fix added an **unscoped** `service` branch to the public sanitizer. Measured on the live
preview before the change, a PartSentry event publishes:

```
id: partsentry:4 | label: Replaced | publicDescription: "Front brake pads (Replaced)"
```

That is structured, non-sensitive, governed information the public Detail page uses — and the
unscoped branch would have replaced it with a generic sentence, destroying real published fact.
PartSentry shares `event_source: 'service'` with work orders but carries no free text and no customer
columns.

**Fixed** by keying the override on the `workorder:` id prefix. Both directions are now pinned by
`backend/tests/issue164-phase8-service-timeline-privacy.test.js`: the work-order path publishes no
free text and no customer identity, and PartSentry keeps publishing its part description.

Caught by re-reading my own change against live data rather than by another reviewer — which is the
habit the earlier rounds should have instilled sooner.

## F.6 The pattern

Across Addendum D, E and F the same shape recurs: **a fix mis-sized against the property it claims.**

- D: a guard covering the connection string but not the project.
- E: a separation giving one collection no source.
- F.3: a throw stopping a function but not its caller.
- F.5: an override broad enough to destroy the information it was protecting.

Four of those five were caught by an independent reader rather than by the author. That is the
argument for keeping the review step — not for resolving to be more careful.

---

# ADDENDUM G — third Codex round on `cb85543d`

One inline finding, **P1, VALID** — and it is the sharpest of the series, because it is about the
command whose whole purpose is to undo a credential.

## G.1 Revocation could be defeated by identity drift

The grant-only scoping from F.2 kept `revoke` running, but `found` was still loaded **by the four
pinned emails only**. Two consequences:

- If a granted fixture's **email changes**, an email-keyed revoke finds no row, reports it `absent`,
  and **leaves the shared UAT hash live** on the very account that drifted.
- If that pinned email has meanwhile been **reassigned to a different user**, the same path clears
  **that user's** password instead.

So the command that exists to remove a credential could both fail to remove it and remove someone
else's. Identity here is the deterministic fixture **id**; the email is only a label on it.

**Fixed.** Rows are now read by the pinned emails **and** the deterministic ids, so drift is visible
from either direction. `revoke` iterates `GOLDEN_UAT_IDS` and updates by id. `status` resolves by id
first, so a renamed row still reports against its fixture identity. A row holding a pinned email but
sitting outside the fixture id set is **reported and never written to**. Four new assertions.

## G.2 A vacuous test of my own, caught immediately

The first version of the status assertion sliced the source from the status branch to
`indexOf("if (MODE === 'grant')")` — but an earlier `MODE === 'grant'` guard sits **above** status, so
the slice ran backwards and was empty. The assertion would have passed against anything. Anchored to
the first grant branch **after** status.

That is the third vacuous assertion in this programme (after the media-locator and users-scope ones).
The tell is always the same: an assertion that cannot distinguish the presence of a property from the
absence of the code it is inspecting.

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
| C — media | **CODE DONE**; the staging fixture write is **BLOCKED** (see A.7) |
| B — location | **DONE** |
| D — owner read-model | **DONE** (counts, parts/services split, insurance) |
| E — date semantics | **DONE** |
| F — publication disclosure | **DONE** |
| G — content governance | **NOT STARTED** |
| H — responsive/accessibility | **NOT STARTED** |
| Step 6 calculation version | **NOT STARTED** |
| OBS-05 second Trust authority | **NOT STARTED** |

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

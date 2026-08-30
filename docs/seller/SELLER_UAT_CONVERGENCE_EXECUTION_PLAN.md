# Seller UAT Convergence — One-Go Execution Plan & Roll Call

**Status:** ACTIVE — do not call Seller certified until every blocking checkbox is complete  
**Execution branch:** `fix/seller-uat-convergence-final-194`  
**Base / parent integration branch:** `integration/vehicle-passport-v16-cert` (PR #194)  
**Starting exact head:** `43204beeec40123b0cce0c457aded6d0f733c4bc`  
**Main branch protection:** **DO NOT MODIFY `main`**  
**Primary human UAT vehicle:** `UAT20260828SELL01`  
**Governing design:** root `DESIGN.md` + `docs/marketplace/MARKETPLACE_VISUAL_DNA.md`  
**Authority:** This checklist is the execution ledger. A task may be checked only after its implementation and evidence are complete.

---

## Execution discipline

1. Work phase-by-phase without pausing for conversational progress reports.
2. After each completed task, update this file and change only that task from `[ ]` to `[x]`.
3. Do not collapse a partial technical assertion into a product/UAT PASS.
4. Do not weaken a documented acceptance criterion because a downstream projection is inconvenient.
5. Do not use seeded/reference vehicles as substitutes for the real Seller journey.
6. Human-facing visual gates require meaningful rendered media, not merely syntactically valid image files.
7. Automated certification data must not pollute human UAT inventory, Home hero selection, featured inventory, or counts.
8. Seller, Vehicle Passport, Verify, Marketplace, Home, Communications, Intelligence and ownership lifecycle must remain one vehicle thread.
9. Desktop, tablet/narrow desktop and mobile are all acceptance targets.
10. Owner UAT is the final product acceptance gate after engineering certification.
11. No production/provider activation is implied by staging/source certification.
12. Final integration target is PR #194's branch, **not `main`**.

---

# PHASE 0 — Baseline, parity matrix, and environment truth

- [x] 0.1 Capture/record current exact-head source/deployment provenance before changes.
- [x] 0.2 Build Seller↔Marketplace parity matrix for Home, Marketplace, reference Vehicle Detail, public Sell, Owner Dashboard, My Garage, My Listings, Seller Studio, draft Vehicle Detail and `UAT20260828SELL01`.
- [x] 0.3 Record current human-UAT inventory count and identify automated/generated vehicles separately.
- [x] 0.4 Record `UAT20260828SELL01` publication, media, Trust, ownership/seller, evidence and account state without mutating it.
- [x] 0.5 Record current account continuity problem for `buynsellpvtltd@gmail.com` and distinguish authentication, verification-email and password-recovery concerns.
- [x] 0.6 Record current Home/Marketplace media selection behavior and 1×1 Golden test contamination.
- [x] 0.7 Record current Trust presentation semantics including low-confidence score behavior.
- [x] 0.8 Confirm #198 is already merged into #194's branch and #199 is already closed/unmerged; treat these as historical integration facts, not work to repeat.

**Phase 0 gate:** ✅ finite defect ledger recorded in `docs/seller/SELLER_MARKETPLACE_PARITY_MATRIX.md`.

---

# PHASE 1 — Certification / human-UAT environment isolation

- [x] 1.1 Automated Golden Seller vehicles are clearly identifiable as automation.
- [x] 1.2 Golden lifecycle guarantees deterministic cleanup/retirement even after failure/interruption.
- [x] 1.3 Automated vehicles cannot appear in normal human UAT Marketplace discovery after cleanup.
- [x] 1.4 Automated vehicles cannot become Home hero/featured inventory.
- [x] 1.5 Automated vehicles cannot alter human-UAT Marketplace counts.
- [x] 1.6 Golden visual media fixture is meaningful and minimum-dimension compliant; 1×1 media cannot satisfy visual acceptance.
- [x] 1.7 Certification distinguishes technical image validity from visual/media quality.
- [x] 1.8 Existing leaked automation inventory is reconciled through a governed cleanup mechanism, not silent ad-hoc database editing.

**Phase 1 gate:** ✅ automation is marked, default discovery isolates it, seven meaningful 640×400 images are required, and governed API cleanup runs before/after the staging gate.

---

# PHASE 2 — Navigation architecture and workspace orientation

- [ ] 2.1 My Garage and Evidence Vault no longer share the same top-level route/active state.
- [ ] 2.2 Evidence Vault has a deliberate route/placement consistent with `DESIGN.md`.
- [ ] 2.3 Shared Seller/Owner workspace header supplies breadcrumb/back/up/object identity/status/primary CTA.
- [ ] 2.4 Every Seller sub-page can return to Seller/Owner Home.
- [ ] 2.5 Every vehicle page can return to My Garage.
- [ ] 2.6 Sidebar hierarchy is visually converged and has one active intent per destination.
- [ ] 2.7 Mobile drawer/back behavior preserves route/task state.
- [ ] 2.8 Tablet/narrow-desktop navigation is explicitly verified.

---

# PHASE 3 — Sell intent router

- [ ] 3.1 Signed-out Sell offers: known CarUp vehicle / new-to-CarUp vehicle / sign in to resume.
- [ ] 3.2 Signed-in Sell leads with eligible My Garage vehicles.
- [ ] 3.3 Known Garage vehicle shows contextual lifecycle CTA: Sell / Continue / Review & publish / Manage.
- [ ] 3.4 Known CarUp Passport lookup reuses canonical identity and requires seller authority.
- [ ] 3.5 New-to-CarUp path creates a canonical new vehicle identity.
- [ ] 3.6 “New vehicle identity” is not conflated with seller-stated “new/used” commercial condition.
- [ ] 3.7 Global Home/Marketplace Sell entry points route through the intent decision rather than a blank legacy form.

---

# PHASE 4 — Account continuity, authentication and Seller onboarding

- [ ] 4.1 Existing historical Seller accounts are reconciled without duplicate-account creation.
- [ ] 4.2 `buynsellpvtltd@gmail.com` failure mode is conclusively identified.
- [ ] 4.3 Existing-account password recovery works end-to-end.
- [ ] 4.4 Registration verification-email delivery status is truthful.
- [ ] 4.5 Resend verification works through canonical Communications email seam.
- [ ] 4.6 Email verification remains distinct from Seller draft access unless policy explicitly requires otherwise.
- [ ] 4.7 Guest→auth Seller handoff preserves the exact draft.
- [ ] 4.8 Sign-in to resume an existing draft returns to the correct Seller stage.
- [ ] 4.9 Public registration cannot self-assign privileged roles.
- [ ] 4.10 Individual vs dealer/business Seller profile semantics are explicit without conflating profile type with authorization role.
- [ ] 4.11 Business/dealer Seller onboarding path has a governed approval state rather than self-granted dealer access.
- [ ] 4.12 Existing ownership/current-seller relationships survive account recovery/reconciliation.
- [ ] 4.13 Privacy-sensitive account data is never exposed by Seller UI reconciliation.

---

# PHASE 5 — Canonical Seller draft, autosave and resume

- [ ] 5.1 Typed vehicle/listing fields autosave at meaningful boundaries.
- [ ] 5.2 Current Seller Studio stage persists.
- [ ] 5.3 Seller commercial statements persist.
- [ ] 5.4 Privacy selections persist.
- [ ] 5.5 History-plan selections persist.
- [ ] 5.6 Photo ordering persists.
- [ ] 5.7 Photo labels persist.
- [ ] 5.8 Explicit cover selection persists.
- [ ] 5.9 Refresh at every Seller step preserves progress.
- [ ] 5.10 Navigation away/back preserves progress.
- [ ] 5.11 Guest→auth transition preserves progress.
- [ ] 5.12 Server-persisted draft is canonical after authentication.
- [ ] 5.13 UI may only claim “saved” for state actually persisted.
- [ ] 5.14 Partial media failure never clears the only browser/local copy.

---

# PHASE 6 — Media persistence, quality and cross-surface identity

- [ ] 6.1 Seven selected photos upload through the real Seller UI.
- [ ] 6.2 Seven canonical listing-media rows persist.
- [ ] 6.3 All returned media URLs are validated/retrievable.
- [ ] 6.4 Display order is preserved.
- [ ] 6.5 Labels are preserved.
- [ ] 6.6 Explicit cover/primary choice is preserved.
- [ ] 6.7 Partial upload cannot be reported as complete success.
- [ ] 6.8 Retry is safe/idempotent and does not duplicate media unexpectedly.
- [ ] 6.9 Seller Studio restores all seven images after refresh/resume.
- [ ] 6.10 My Garage uses the selected cover.
- [ ] 6.11 My Listings uses the selected cover.
- [ ] 6.12 Seller Buyer Preview renders the full gallery/carousel.
- [ ] 6.13 Published Marketplace card uses the selected cover.
- [ ] 6.14 Marketplace Vehicle Detail renders the full gallery/carousel.
- [ ] 6.15 Home hero/live inventory uses meaningful renderable media only.
- [ ] 6.16 Recommendations/featured locations use the correct cover when applicable.
- [ ] 6.17 Image-delivery failure is distinguished from seller-supplied-no-photos.
- [ ] 6.18 Evidence media remains separate from advertising/listing media.
- [ ] 6.19 Desktop/mobile/tablet gallery controls and crops are visually verified.

---

# PHASE 7 — My Garage redesign

- [ ] 7.1 My Garage matches current CarUp design language, not legacy generic cards.
- [ ] 7.2 Meaningful vehicle media is prominent.
- [ ] 7.3 Make/model/year + safe identifier are clear.
- [ ] 7.4 Vehicle Passport identity/state is visible.
- [ ] 7.5 Listing/publication lifecycle state is visible.
- [ ] 7.6 Canonical Trust state is visible without decorative inflation.
- [ ] 7.7 Evidence/readiness summary is truthful.
- [ ] 7.8 Service/insurance/PartSentry context appears only when governed/available.
- [ ] 7.9 One dominant contextual CTA is derived from lifecycle.
- [ ] 7.10 Draft vehicle dominant CTA is **Continue listing**.
- [ ] 7.11 Published vehicle dominant CTA is **Manage listing**.
- [ ] 7.12 Vehicle-only dominant CTA is **Sell this vehicle**.
- [ ] 7.13 Secondary Vehicle Passport action remains obvious.
- [ ] 7.14 My Garage has explicit return/up orientation.

---

# PHASE 8 — My Listings redesign

- [ ] 8.1 My Listings is a Seller commerce operating surface, not a generic management grid.
- [ ] 8.2 Top band distinguishes published, drafts needing action and inquiries.
- [ ] 8.3 Tracked views/saves appear only where actually tracked.
- [ ] 8.4 Listing value aggregation respects currency semantics.
- [ ] 8.5 Listing story is image-led with identity + lifecycle.
- [ ] 8.6 Draft/ready/published/reserved/sold states are visually unmistakable.
- [ ] 8.7 Exactly one dominant contextual action appears per listing.
- [ ] 8.8 Draft exposes Continue/Edit + Buyer Preview + readiness.
- [ ] 8.9 Published exposes View on Marketplace + performance + price/availability + lifecycle.
- [ ] 8.10 Inquiry action is connected to the correct vehicle/listing.
- [ ] 8.11 Price change persists and updates downstream presentation.
- [ ] 8.12 Unpublish/sold actions are grouped and clearly lifecycle/destructive.

---

# PHASE 9 — Authenticated Seller Studio redesign

- [ ] 9.1 Seller Studio visually converges with Home/public Sell/Marketplace.
- [ ] 9.2 Stage progression is clear.
- [ ] 9.3 Desktop composition is wide and automotive/editorial.
- [ ] 9.4 Mobile composition is calm and preserves context.
- [ ] 9.5 Existing Passport facts show provenance.
- [ ] 9.6 Canonical vs seller-editable fields are explicit.
- [ ] 9.7 Existing server draft hydrates instead of restarting blank.
- [ ] 9.8 “Existing listing loaded”/resume state is visible where useful.
- [ ] 9.9 Final readiness step shows media, copy, evidence, Trust, privacy and exact blockers.
- [ ] 9.10 Buyer Preview CTA is prominent before publication.

---

# PHASE 10 — Shared Buyer Preview / Marketplace Vehicle Detail architecture

- [ ] 10.1 One shared domain presentation architecture supports Seller Preview and Marketplace Public modes.
- [ ] 10.2 Shared composition owns gallery.
- [ ] 10.3 Shared composition owns identity/commercial panel.
- [ ] 10.4 Shared composition owns canonical Trust/source coverage.
- [ ] 10.5 Shared composition owns pricing/cost context.
- [ ] 10.6 Shared composition owns inquiry region.
- [ ] 10.7 Shared composition owns registration/evidence.
- [ ] 10.8 Shared composition owns seller description/features.
- [ ] 10.9 Shared composition owns lifecycle.
- [ ] 10.10 Shared composition owns ownership/service/insurance/PartSentry context.
- [ ] 10.11 Seller Preview is unmistakably **not public**.
- [ ] 10.12 Seller Preview has no active buyer transaction controls.
- [ ] 10.13 Public mode is reachable only for published listings.
- [ ] 10.14 Seller edit controls stay outside buyer presentation composition.

---

# PHASE 11 — Dynamic Marketplace parity

For a fresh Seller-created vehicle, the following must use the same information architecture as a rich reference vehicle:

- [ ] 11.1 photos/gallery
- [ ] 11.2 commercial identity
- [ ] 11.3 price/currency
- [ ] 11.4 canonical Trust
- [ ] 11.5 source coverage
- [ ] 11.6 government/partner checks
- [ ] 11.7 cost estimate
- [ ] 11.8 inquiry
- [ ] 11.9 registration/evidence
- [ ] 11.10 seller statements/features
- [ ] 11.11 vehicle lifecycle
- [ ] 11.12 ownership
- [ ] 11.13 service
- [ ] 11.14 PartSentry
- [ ] 11.15 insurance
- [ ] 11.16 reservation/SafePay readiness
- [ ] 11.17 seller privacy
- [ ] 11.18 save/compare/share/recommendations where supported
- [ ] 11.19 missing states render intentionally as Pending / Not evaluated / Not available / Source not connected rather than collapsing layout.

---

# PHASE 12 — Trust, readiness and listing-quality semantics

- [ ] 12.1 Canonical Trust is visually distinct from publication readiness.
- [ ] 12.2 Canonical Trust is visually distinct from listing completeness/quality.
- [ ] 12.3 Publication readiness never masquerades as Trust.
- [ ] 12.4 Listing completeness never masquerades as Trust.
- [ ] 12.5 Low-confidence Trust scores cannot visually overstate authority.
- [ ] 12.6 Zero substantiated facts / zero connected sources are prominent enough to contextualize any numeric Trust result.
- [ ] 12.7 Legacy/unversioned Trust values are not published.
- [ ] 12.8 No fake badges/checks/claims are introduced by visual redesign.

---

# PHASE 13 — Seller Intelligence and Owner Dashboard convergence

## Seller Intelligence
- [ ] 13.1 KPI band is governed and meaningful.
- [ ] 13.2 Time-series chart uses real tracked data.
- [ ] 13.3 Conversion funnel includes only instrumented stages.
- [ ] 13.4 Discovery-source distribution appears only where available.
- [ ] 13.5 Listing-performance comparison is governed.
- [ ] 13.6 Inquiry distribution is governed.
- [ ] 13.7 Geographic interest appears only where tracked.
- [ ] 13.8 Price-change response appears only where tracked.
- [ ] 13.9 Readiness/completeness visual is distinct from Trust.
- [ ] 13.10 Missing data renders Not tracked / No activity / Source not connected, never fake zero charts.

## Owner Dashboard
- [ ] 13.11 Legacy Owner Dashboard composition is replaced/converged.
- [ ] 13.12 Priority order: attention → vehicles/listings → buyer activity → Trust/evidence → service/insurance/PartSentry → Communications → Intelligence.
- [ ] 13.13 Direct Seller continuation is prominent.
- [ ] 13.14 Coherent vehicle stories use real media.
- [ ] 13.15 Unsupported trend widgets/fake defaults are removed.
- [ ] 13.16 Charts/KPIs have accessible textual equivalents where practical.

---

# PHASE 14 — Home, Featured semantics and communicative media resilience

- [ ] 14.1 Home Seller downstream regression is part of Seller certification.
- [ ] 14.2 Home hero cannot select unusable/test media.
- [ ] 14.3 “Featured” has an explicit governed business/product rule rather than silently meaning “newest”.
- [ ] 14.4 Marketplace count labels state what is being counted.
- [ ] 14.5 Human-UAT count excludes retired/isolated automation stock from normal discovery.
- [ ] 14.6 “Eight useful next moves” remains visually meaningful when Marketplace imagery is absent.
- [ ] 14.7 Conceptual journeys (Verify, Diaspora, finance, protection, service, parts) use resilient illustrative/diagrammatic media where appropriate rather than depending entirely on live listing photos.
- [ ] 14.8 Home visual storytelling remains truthful: no fake verification/finance/insurance claims.
- [ ] 14.9 Home live inventory continues to reuse canonical Marketplace vehicle presentation where appropriate.

---

# PHASE 15 — Communications, Intelligence propagation and publication lifecycle

## Communications
- [ ] 15.1 Buyer inquiry is durable and bound to correct VIN/listing.
- [ ] 15.2 Seller inquiry inbox shows exact buyer message.
- [ ] 15.3 Canonical Communications thread projection is proven, not waived.
- [ ] 15.4 Correct participants/authorization are enforced.
- [ ] 15.5 Seller can respond through supported in-app path.
- [ ] 15.6 External provider channels are surfaced only when runtime delivery is actually available.

## Intelligence propagation
- [ ] 15.7 Known inquiry event is recorded.
- [ ] 15.8 Relevant Seller metric/instrumentation updates.
- [ ] 15.9 Seller Intelligence can read the event/metric.
- [ ] 15.10 “Unavailable” may be truthful UI but does not count as propagation PASS when a known event was generated.

## Publication lifecycle
- [ ] 15.11 Draft cannot become public accidentally.
- [ ] 15.12 Exact publication blockers are displayed.
- [ ] 15.13 Publish makes canonical Marketplace endpoint discoverable.
- [ ] 15.14 Published card/detail uses selected cover/gallery.
- [ ] 15.15 Unpublish removes public discovery.
- [ ] 15.16 Republish restores public discovery without duplicate vehicle identity.
- [ ] 15.17 Mark sold ends active commerce.
- [ ] 15.18 Vehicle Passport and lifecycle persist after sale.

---

# PHASE 16 — Responsive, accessibility and visual certification

- [ ] 16.1 Desktop Seller entry visual reviewed.
- [ ] 16.2 Tablet/narrow-desktop Seller entry visual reviewed.
- [ ] 16.3 Mobile Seller entry visual reviewed.
- [ ] 16.4 Desktop Owner Dashboard reviewed.
- [ ] 16.5 Tablet/narrow-desktop Owner Dashboard reviewed.
- [ ] 16.6 Mobile Owner Dashboard reviewed.
- [ ] 16.7 My Garage/My Listings/Seller Studio/Preview/Intelligence reviewed at all three breakpoints.
- [ ] 16.8 No horizontal overflow.
- [ ] 16.9 Keyboard navigation works.
- [ ] 16.10 Form labels/errors are accessible.
- [ ] 16.11 Gallery controls are keyboard/touch accessible.
- [ ] 16.12 Focus management is correct across modal/drawer/navigation flows.
- [ ] 16.13 Status does not rely on color alone.
- [ ] 16.14 Charts have accessible semantics/text equivalents where practical.
- [ ] 16.15 Touch targets are appropriately sized.
- [ ] 16.16 Visual regression evidence uses meaningful images and detects blank/1×1 regressions.

---

# PHASE 17 — Genuine Golden Dynamic Seller Journey

The gate must run through the **real UI** except where a separate governed reviewer role is inherently required.

- [ ] 17.1 Home → Sell
- [ ] 17.2 choose existing/known/new intent
- [ ] 17.3 enter Seller data in Seller Studio
- [ ] 17.4 upload 7 meaningful photos
- [ ] 17.5 choose labels/order/cover
- [ ] 17.6 save guest draft
- [ ] 17.7 create/sign into account
- [ ] 17.8 verification-email state truthful
- [ ] 17.9 resume automatically
- [ ] 17.10 refresh mid-form and retain progress
- [ ] 17.11 My Garage
- [ ] 17.12 Continue listing CTA
- [ ] 17.13 My Listings
- [ ] 17.14 Preview buyer listing
- [ ] 17.15 verify full 7-photo gallery in preview
- [ ] 17.16 add evidence through Seller UI
- [ ] 17.17 observe pending state
- [ ] 17.18 authorized reviewer resolves evidence
- [ ] 17.19 publish through Seller UI
- [ ] 17.20 Home visual downstream remains correct
- [ ] 17.21 find in Marketplace
- [ ] 17.22 open as signed-out buyer
- [ ] 17.23 compare section-by-section to rich reference
- [ ] 17.24 save
- [ ] 17.25 compare
- [ ] 17.26 share
- [ ] 17.27 submit inquiry
- [ ] 17.28 Seller sees inquiry
- [ ] 17.29 Seller sees canonical Communications thread/response path
- [ ] 17.30 Seller Intelligence receives governed event
- [ ] 17.31 change price
- [ ] 17.32 unpublish
- [ ] 17.33 verify Marketplace removal
- [ ] 17.34 republish
- [ ] 17.35 verify Marketplace restoration with same VIN
- [ ] 17.36 mark sold
- [ ] 17.37 verify active commerce ends
- [ ] 17.38 verify Vehicle Passport persists

**Prohibited shortcut:** reference/seeded vehicles cannot satisfy this gate.

---

# PHASE 18 — Full affected cross-feature battery

- [ ] 18.1 Seller unit/component suite
- [ ] 18.2 Seller integration suite
- [ ] 18.3 Golden Seller desktop
- [ ] 18.4 Golden Seller tablet/narrow desktop
- [ ] 18.5 Golden Seller mobile
- [ ] 18.6 Marketplace unit/integration
- [ ] 18.7 Marketplace exact-head staging browser
- [ ] 18.8 Vehicle Passport full foundation suite
- [ ] 18.9 Verify/search regressions
- [ ] 18.10 Home/navigation regressions
- [ ] 18.11 Communications unit/PostgreSQL/integration
- [ ] 18.12 Intelligence/navigation instrumentation
- [ ] 18.13 Service Network affected regressions
- [ ] 18.14 backend full node:test
- [ ] 18.15 TypeScript
- [ ] 18.16 lint/lint-regression
- [ ] 18.17 production web build
- [ ] 18.18 Playwright full suite
- [ ] 18.19 accessibility suite
- [ ] 18.20 security/secret scan/dependency audit
- [ ] 18.21 migration/preflight safety gates
- [ ] 18.22 exact-head frontend/backend provenance match
- [ ] 18.23 zero unresolved P0/P1 review findings

---

# PHASE 19 — Owner-UAT candidate handoff

- [ ] 19.1 Exact-head frontend deployment READY.
- [ ] 19.2 Exact-head backend deployment READY.
- [ ] 19.3 Backend health reports exact candidate SHA.
- [ ] 19.4 Owner UAT URL is pinned to exact candidate.
- [ ] 19.5 Human UAT account instructions distinguish old account recovery from automation accounts.
- [ ] 19.6 Owner UAT uses clean human inventory, not leaked automation listings.
- [ ] 19.7 Owner UAT accepts visible Seller product.
- [ ] 19.8 No Seller merge/feature-complete claim is made before owner acceptance.

---

# PHASE 20 — Final integration / stop rule

Historical facts to preserve:
- PR #198 was already merged/closed into `integration/vehicle-passport-v16-cert`.
- PR #199 was already closed and was never merged to `main`.

Current remediation must finish as follows:

- [ ] 20.1 Reconfirm #198 remains merged into #194's branch and was not merged directly to `main`.
- [ ] 20.2 Reconfirm #199 remains closed/unmerged.
- [ ] 20.3 Merge the **current Seller UAT convergence remediation PR** into `integration/vehicle-passport-v16-cert` / PR #194's branch — never `main`.
- [ ] 20.4 Re-fetch PR #194 after Seller remediation integration.
- [ ] 20.5 Record PR #194's new exact head.
- [ ] 20.6 Confirm `main` head is unchanged by Seller remediation.
- [ ] 20.7 Stop feature work on Seller.

---

## Completion rule

Seller is complete only when **every blocking checkbox above is `[x]`** and the final exact-head evidence agrees with this ledger.

No conversational summary can override an unchecked gate.

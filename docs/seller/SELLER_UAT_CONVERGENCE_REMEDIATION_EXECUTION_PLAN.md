# Seller UAT Convergence Remediation — Canonical Execution Plan

**Status:** Active execution plan — implementation may proceed only through this checklist  
**Branch:** `fix/seller-uat-convergence-remediation`  
**Base:** `integration/vehicle-passport-v16-cert@43204beeec40123b0cce0c457aded6d0f733c4bc`  
**Governing UX:** root `DESIGN.md` + `docs/marketplace/MARKETPLACE_VISUAL_DNA.md`  
**Supersedes as execution authority:** informal Seller remediation checklists and the reduced Golden Seller acceptance interpretation  
**Primary human UAT vehicle:** `UAT20260828SELL01`  
**Primary human UAT account:** historical Seller account continuity must be reconciled without deleting/recreating user data  
**Production/main rule:** do not modify or merge to `main` during this programme

---

## 0. Execution law

This file is the canonical roll-call for Seller remediation. It exists specifically to prevent partial completion being reported as programme completion.

### 0.1 Mandatory roll-call after every cleared task

After **every** implementation task, test fix, data-harness fix, or design closure:

1. Re-read this entire checklist.
2. Update the status of **every phase and every numbered acceptance item**.
3. Keep completed items checked only while their evidence still holds.
4. If a later change invalidates earlier evidence, immediately re-open that item.
5. Record the exact commit SHA and evidence/run beside the cleared item.
6. Do not announce an interim "complete" state merely because one phase is green.
7. Continue automatically to the next unchecked item unless blocked by an external protected action that genuinely requires owner input/approval.
8. No owner UAT handoff until all engineering + visual + exact-head staging gates below are green.
9. Owner UAT is the final product-acceptance gate. Automated tests never substitute for it.

### 0.2 Status vocabulary

- `[ ]` not started / not proven
- `[~]` in progress or implemented but not fully certified
- `[x]` proven on the current exact head
- `[!]` blocked externally; blocking reason must be written next to the item

### 0.3 Completion rule

Seller convergence is complete only when **all mandatory checkboxes in this document are `[x]`**, exact-head CI/staging provenance is green, no P0/P1 review findings remain, and owner UAT accepts the visible product.

---

# Phase 0 — Baseline, forensic inventory and parity ledger

## 0A. Preserve and baseline current state

- [x] Record exact source head and staging frontend/backend provenance. Baseline: `43204beeec40123b0cce0c457aded6d0f733c4bc`; paired staging provenance was verified before remediation.
- [ ] Capture current desktop, narrow/tablet, and mobile evidence for:
  - Home
  - Marketplace
  - rich reference Vehicle Detail
  - public Sell
  - Owner Dashboard
  - My Garage
  - Evidence Vault
  - My Listings
  - authenticated Seller Studio
  - Seller-created draft Buyer Preview / Vehicle Detail
  - Seller Intelligence
  - Communications
- [x] Preserve the current state of `UAT20260828SELL01` without publishing it. Baseline confirmed draft/non-public before remediation.
- [x] Preserve the historical account issue for `buynsellpvtltd@gmail.com` without deleting or recreating the account. Read-only forensic state retained.

## 0B. Full Seller ↔ Marketplace parity matrix

Create/maintain a parity matrix with, at minimum:
- section/capability
- rich reference VIN
- `UAT20260828SELL01`
- canonical data source
- seller-stated/governed/computed/private classification
- expected missing state
- UI component
- desktop/mobile behavior
- gap
- severity
- owner decision where required
- evidence

Required rows:
- [x] listing gallery
- [x] make/model/year/VIN identity
- [x] price/currency
- [x] mileage/specification
- [x] seller-stated condition
- [x] seller description/features
- [x] seller identity/privacy projection
- [x] location/privacy projection
- [x] canonical Trust
- [x] Trust confidence/source coverage
- [x] listing completeness/readiness
- [x] publication readiness
- [x] evidence/registration
- [x] government/partner checks
- [x] cost/pricing context
- [x] lifecycle/history
- [x] ownership
- [x] service
- [x] PartSentry
- [x] insurance
- [x] reservation/SafePay state
- [x] save
- [x] compare
- [x] share
- [x] recommendations/related inventory
- [x] inquiry
- [x] Communications linkage
- [x] Intelligence instrumentation
- [x] sold/retired persistence

**Phase 0 gate:** no phase may be called complete until this matrix exists and remains current.

---

# Phase 1 — UAT environment and certification-harness integrity

## 1A. Automated test inventory isolation

- [ ] Identify all Seller Golden automation vehicles by deterministic metadata/identity.
- [ ] Prevent automated UAT vehicles from contaminating human Marketplace discovery, Home hero, Home live inventory, featured inventory, counts, recommendations, or visual-story media.
- [ ] Add deterministic cleanup/retirement in `finally`/teardown so interrupted tests cannot leave public stock.
- [ ] Cleanup must be idempotent.
- [ ] Failed cleanup must fail the certification job loudly.
- [ ] Human UAT inventory/counts must not change because an automated Golden test ran.

## 1B. Meaningful automation media

- [ ] Replace 1×1 PNG as the visual acceptance fixture with a meaningful, non-trivial test image for human-facing visual gates.
- [ ] Technical media tests may keep minimal binary fixtures only in lower-level tests.
- [ ] Visual acceptance must enforce sensible decoded dimensions.
- [ ] Visual acceptance must prove non-blank rendered media.
- [ ] Visual acceptance must prove cover crop is visible on desktop/mobile.

## 1C. Marketplace count and Featured semantics

- [ ] Marketplace count label explicitly describes what is counted.
- [ ] Drafts/sold/test fixtures do not appear in public active-listing counts.
- [ ] Define and document Home “Featured” selection semantics.
- [ ] Do not silently equate newest listing with editorial/quality “Featured” status unless that is the explicit product rule.
- [ ] Automated fixtures cannot become Featured.

---

# Phase 2 — Account continuity, registration and recovery

## 2A. Historical account reconciliation

- [ ] Determine read-only current state for `buynsellpvtltd@gmail.com`.
- [ ] Distinguish unknown user / invalid password / legacy password-state internally while keeping public auth errors opaque.
- [ ] Preserve historical vehicles/listings/ownership when account recovery occurs.
- [ ] Do not solve continuity by deleting and recreating the account.
- [ ] Add migration/recovery path for supported legacy account state if required.

## 2B. Registration and mailbox verification

- [ ] New registration creates a usable unprivileged owner account.
- [ ] Registration profile dimensions persist.
- [ ] Verification email dispatch status is truthful.
- [ ] Resend verification works.
- [ ] Email verification state is visible without masquerading as KYC/identity verification.
- [ ] Seller draft handoff does not disappear when email delivery is delayed/unavailable.
- [ ] No UI claims “email sent” if provider delivery was not accepted.

## 2C. Password recovery

- [ ] Forgot-password request works.
- [ ] Recovery email delivery state is truthful.
- [ ] Reset token is governed, expiring and one-time.
- [ ] Password reset restores login without breaking Seller draft/ownership continuity.
- [ ] Old sessions are handled according to security policy after reset.

## 2D. Seller identity dimensions

- [ ] Preserve authorization role security: public registration cannot self-grant dealer/admin/etc.
- [ ] Support Seller profile distinctions separately from authorization role.
- [ ] Explicitly model private/local individual Seller.
- [ ] Explicitly model diaspora/international individual Seller where supported.
- [ ] Explicitly model dealer/business/exporter onboarding request where supported.
- [ ] Dealer/business Seller cannot gain privileged platform permissions through public profile selection.
- [ ] Seller UI wording distinguishes authorization role from commercial/business identity.

---

# Phase 3 — Navigation architecture and orientation

## 3A. Garage / Evidence Vault

- [ ] My Garage and Evidence Vault have distinct navigation intents and distinct destinations, or Evidence Vault is intentionally nested and removed as a duplicate top-level entry.
- [ ] Only one sidebar entry is active for a given destination.
- [ ] Evidence Vault can be reached directly and from a vehicle context.

## 3B. Shared authenticated workspace orientation

Every Seller/Owner route must answer “Where am I?”, “How do I go back/up?”, “What is the next action?”

- [x] shared workspace header/breadcrumb pattern
- [ ] Seller/Owner Home orientation
- [ ] My Garage orientation
- [ ] vehicle profile orientation
- [ ] My Listings orientation
- [ ] Seller Studio orientation
- [ ] Evidence Vault orientation
- [ ] Communications orientation
- [ ] Intelligence orientation
- [ ] stable mobile drawer/back behavior
- [ ] no route-state loss when opening/closing mobile navigation

---

# Phase 4 — Sell intent router

The global Sell entry must resolve **intent before form entry**.

## 4A. Signed-out

- [ ] CarUp already knows this vehicle — identify/reuse it.
- [ ] Add a vehicle CarUp does not know yet.
- [ ] Sign in to continue an existing draft/vehicle.

## 4B. Signed-in

- [ ] Show eligible My Garage vehicles first.
- [ ] Each known vehicle shows image/missing-media state, identity, Passport state and listing lifecycle.
- [ ] No listing → **Sell this vehicle**.
- [ ] Draft → **Continue listing**.
- [ ] Ready → **Review & publish**.
- [ ] Published → **Manage listing**.
- [ ] Sold → governed sale history/relist path only if policy permits.
- [ ] Separate action to find another vehicle CarUp already knows.
- [ ] Separate action to add a new vehicle.
- [ ] Signed-in user with Garage vehicles is never dumped directly into a blank new-vehicle form.

## 4C. Terminology

- [ ] “Vehicle new to CarUp” is not confused with commercial condition “New”.
- [ ] Seller-stated condition remains a seller statement.

---

# Phase 5 — Canonical Seller draft, autosave and resume

## 5A. Persist all expected draft state

- [ ] identity fields
- [ ] commercial fields
- [x] seller description/features
- [ ] seller history/plan selections
- [ ] privacy selections
- [ ] seller display preferences
- [ ] current step/stage
- [ ] uploaded media set
- [ ] media order
- [ ] media labels
- [ ] explicit cover/primary
- [ ] publication-readiness progress

## 5B. Continuity boundaries

Prove no data loss across:
- [ ] refresh at every Seller Studio step
- [ ] route away and return
- [ ] browser restart where server draft exists
- [ ] guest → registration handoff
- [ ] guest → existing-account login handoff
- [ ] authenticated server resume
- [ ] validation failure
- [ ] transient media/API failure

## 5C. Save truthfulness

- [ ] UI never claims a complete save for data that failed persistence.
- [ ] Failed media persistence leaves recoverable local/browser state and visible incomplete status.
- [ ] Retry does not duplicate rows or reorder media unexpectedly.

---

# Phase 6 — Media persistence, gallery identity and visual quality

## 6A. Seven-photo contract

Real Golden Seller path must prove:
- [ ] 7 photos selected
- [ ] 7 uploads accepted
- [ ] 7 canonical listing-media rows persisted
- [ ] 7 restored after refresh
- [ ] 7 restored after auth handoff
- [ ] labels persist
- [ ] order persists
- [ ] explicit cover persists
- [ ] removing/replacing media behaves predictably
- [ ] partial upload cannot masquerade as full success

## 6B. Cross-surface cover continuity

The exact selected cover image must remain recognizable in:
- [ ] Seller Studio
- [ ] My Garage
- [ ] My Listings
- [ ] Seller Buyer Preview
- [ ] Marketplace card
- [ ] Home live/featured vehicle surface where eligible
- [ ] Marketplace Vehicle Detail
- [x] recommendations/related inventory where applicable

## 6C. Full-gallery continuity

- [ ] Seller Buyer Preview presents the complete persisted gallery.
- [ ] Public Vehicle Detail presents the complete persisted gallery after publication.
- [ ] carousel/thumb controls work on desktop.
- [ ] touch/swipe controls work on mobile.
- [ ] image delivery failure is distinguished from “seller added no photos”.
- [ ] no unrelated stock image substitutes for listing media.
- [ ] evidence images never leak into listing gallery.

---

# Phase 7 — Home visual resilience and “Eight useful next moves”

## 7A. Home live vehicle media

- [ ] Hero/live vehicle uses governed published listing media only.
- [ ] Missing/broken media produces a deliberate bounded state, not a huge accidental blank region.
- [ ] Human Seller publication/unpublication updates Home truthfully.
- [ ] Draft vehicles never appear.

## 7B. Eight useful next moves

- [ ] Buy visual communicates inventory/discovery.
- [ ] Sell visual communicates Seller workflow.
- [ ] Verify visual remains meaningful even if live vehicle photography is unavailable.
- [ ] Diaspora visual is conceptual/process-led and does not depend on a random listing image.
- [ ] Finance visual remains meaningful without fabricating approval.
- [ ] Protection/insurance visual remains meaningful without fabricating coverage.
- [ ] Service visual remains meaningful without fabricating service history.
- [ ] Parts visual remains meaningful without fabricating fitment/availability.
- [ ] Conceptual scenes do not collapse because Marketplace media is missing.
- [ ] No fake gamification/progress.
- [ ] desktop/tablet/mobile remain visually balanced.

---

# Phase 8 — My Garage redesign

- [ ] Converges to `DESIGN.md`, not legacy card-grid defaults.
- [ ] meaningful vehicle media
- [ ] make/model/year + safe identifier
- [ ] Passport identity/state
- [x] ownership/relationship state
- [ ] listing/publication lifecycle
- [x] canonical Trust state
- [ ] evidence/readiness
- [x] service summary where governed
- [x] insurance summary where governed
- [x] PartSentry summary where governed
- [ ] one dominant contextual next action
- [ ] draft → **Continue listing**
- [ ] published → **Manage listing**
- [ ] vehicle-only → **Sell this vehicle**
- [ ] secondary **View Vehicle Passport**
- [ ] obvious return to Seller/Owner Home
- [ ] desktop/tablet/mobile visual acceptance

---

# Phase 9 — My Listings redesign

## 9A. Seller operating surface

- [ ] KPI/top band uses only governed measures.
- [ ] Published count truthful.
- [ ] Drafts-needing-action truthful.
- [ ] Buyer inquiries truthful.
- [ ] Views/saves only when tracked.
- [ ] Aggregate listing value only when currencies/semantics permit.

## 9B. Listing story

- [ ] large/meaningful image
- [ ] identity
- [ ] Draft / Ready / Published / Reserved / Sold visibly distinct
- [ ] price/availability/location
- [ ] performance where measured
- [ ] readiness/media/evidence/Trust/publication requirements
- [ ] one dominant contextual action
- [ ] secondary actions grouped by purpose
- [ ] Draft CTA = **Preview buyer listing**
- [ ] Published CTA = **View on Marketplace**
- [ ] no draft labeled as a public listing

---

# Phase 10 — Authenticated Seller Studio redesign

- [ ] current Home/Marketplace visual DNA
- [ ] dark automotive identity region where appropriate
- [ ] clear stage progression
- [ ] wide desktop composition
- [ ] calm mobile stack
- [ ] existing Passport facts clearly sourced
- [ ] seller-editable vs canonical fields explicit
- [ ] server-resumed draft visibly identified
- [ ] no unnecessary re-entry of known identity facts
- [ ] final readiness step includes:
  - media readiness
  - seller copy completeness
  - evidence requirements
  - canonical Trust state
  - listing completeness
  - publication readiness
  - privacy projection
  - exact blockers
  - Buyer Preview CTA

---

# Phase 11 — One Buyer Presentation architecture

Seller Buyer Preview and public Marketplace Vehicle Detail must use one presentational contract.

Shared composition:
- [ ] gallery
- [ ] vehicle/commercial identity panel
- [x] canonical Trust/source coverage
- [ ] pricing/cost context
- [x] inquiry region
- [ ] registration/evidence
- [x] seller description/features
- [x] lifecycle/history
- [x] ownership/service/insurance/PartSentry
- [ ] reservation/SafePay readiness where governed

Seller-preview mode:
- [ ] unmistakably **Buyer Preview — not public**
- [ ] no active buyer transaction actions
- [ ] seller edit controls remain outside buyer presentation

Marketplace-public mode:
- [ ] only published listings
- [ ] governed buyer actions active
- [ ] same information architecture

---

# Phase 12 — Dynamic Marketplace parity

For a fresh Seller-created vehicle, before and after publication:

- [ ] same section order as rich reference Vehicle Detail
- [ ] truthful designed missing/pending/unavailable states
- [ ] no alternate legacy layout
- [ ] seller-selected cover on Marketplace card
- [ ] complete gallery on Vehicle Detail
- [x] canonical Trust only
- [ ] source coverage explicit
- [ ] privacy projection preserved
- [ ] exact VIN/facet/search discovery works after publish
- [ ] draft remains undiscoverable publicly
- [x] save works where supported
- [x] compare works where supported
- [x] share works where supported
- [ ] recommendations do not use contaminated automation fixtures

---

# Phase 13 — Trust, completeness and publication-readiness separation

These are three different concepts and must never collapse into one decorative percentage.

- [ ] **Canonical Trust** = governed evidence/source decision.
- [ ] **Listing completeness/quality** = seller content/readiness, not Trust.
- [ ] **Publication readiness** = policy blockers for going public.
- [ ] UI labels and visual treatment keep them distinct.
- [ ] 60/100 or any numeric Trust cannot imply high confidence when source/evidence confidence is low.
- [ ] Trust presentation exposes confidence and known limitations appropriately.
- [ ] No legacy score substitution.
- [ ] No trust score is fabricated for `UAT20260828SELL01` if canonical authority says not evaluated.

---

# Phase 14 — Seller Intelligence redesign and instrumentation proof

## 14A. Decision-grade visual dashboard

Where governed data exists:
- [ ] KPI band
- [ ] views time-series
- [x] saves
- [x] compares
- [x] shares
- [ ] inquiries
- [ ] inspection requests where tracked
- [ ] conversion funnel
- [ ] discovery source
- [ ] geographic interest where tracked
- [ ] listing-by-listing comparison
- [ ] price-change response
- [ ] evidence/readiness
- [ ] listing completeness
- [ ] response performance

## 14B. Truthful states

- [ ] no fake zeroes
- [ ] no fake lines
- [ ] no fake percentages
- [ ] explicit Not tracked / No activity yet / Source not connected / Unavailable
- [ ] chart meaning available in accessible text/table form

## 14C. Instrumentation acceptance

After a known Golden event:
- [ ] raw governed event recorded
- [ ] correct vehicle/listing scope
- [ ] rollup/projection updated if designed to be synchronous
- [ ] async projection eventually observed if designed asynchronous
- [ ] Seller Intelligence reads the event or names the precise unavailable source
- [ ] generic “unavailable” cannot alone satisfy instrumentation PASS

---

# Phase 15 — Owner Dashboard convergence

Owner Dashboard becomes the ownership/Seller cockpit.

Priority order:
1. what needs attention
2. vehicles/listings
3. buyer activity
4. Trust/evidence readiness
5. service/insurance/PartSentry
6. Communications
7. Intelligence

Acceptance:
- [ ] legacy generic card-grid composition removed/deprecated for this surface
- [ ] no fake/untracked numeric defaults
- [ ] no unsupported trend widgets
- [ ] meaningful KPI/visual hierarchy where data exists
- [ ] direct continuation into active Seller work
- [ ] coherent vehicle stories
- [ ] current CarUp typography/palette/layout
- [ ] desktop/tablet/mobile accepted

---

# Phase 16 — Communications convergence

## 16A. Inquiry durability

- [ ] buyer inquiry creates durable governed inquiry
- [ ] exact VIN/listing relationship preserved
- [ ] buyer identity/contact projection follows privacy/security rules
- [ ] seller sees inquiry immediately in governed Seller inbox

## 16B. Conversation projection

- [x] inquiry projects into canonical Communications thread when architecture requires it
- [ ] same vehicle/listing context
- [ ] correct participants
- [ ] authorization enforced
- [ ] seller can respond in-app
- [ ] conversation persists
- [ ] external provider delivery remains separate from in-app durability
- [ ] where external providers are disabled, UI states that truthfully
- [ ] “Seller sees inquiry” cannot substitute for “Communications projection works” when the plan requires both

---

# Phase 17 — Publication lifecycle

Pre-publication:
- [ ] media validated
- [ ] identifier requirements validated
- [ ] evidence requirements validated
- [ ] privacy validated
- [ ] seller copy validated
- [x] canonical Trust displayed as-is
- [ ] exact blocking gaps displayed
- [ ] Buyer Preview available while still private

Lifecycle:
- [ ] publish from Seller UI
- [ ] public Marketplace endpoint returns VIN
- [ ] Marketplace search finds VIN
- [ ] Home only includes it if Home selection rules make it eligible
- [ ] price change persists
- [ ] unpublish removes public discovery
- [ ] republish restores governed public discovery
- [ ] mark sold ends active commerce
- [ ] sold vehicle disappears from active Marketplace
- [ ] Vehicle Passport persists after sold state
- [x] ownership/lifecycle history persists

---

# Phase 18 — Accessibility and responsive certification

Every materially changed Seller surface must pass:

## Desktop
- [ ] 1440-ish reference
- [ ] keyboard navigation
- [ ] focus handling
- [ ] readable hierarchy
- [ ] no overflow

## Narrow/tablet
- [ ] explicit narrow-desktop/tablet pass
- [ ] no collapsed action hierarchy
- [ ] charts usable
- [ ] navigation usable

## Mobile
- [ ] persistent key navigation reachable
- [ ] media touch controls
- [ ] primary CTA discoverable
- [ ] no horizontal overflow
- [ ] drawer state preserved
- [ ] forms usable
- [ ] charts simplified/readable

## Accessibility
- [ ] form labels/errors
- [ ] alt/placeholder semantics
- [ ] gallery controls keyboard/touch accessible
- [ ] color not sole status carrier
- [ ] charts have textual equivalents
- [ ] touch targets adequate
- [ ] automated accessibility regression green

---

# Phase 19 — Genuine Golden Dynamic Seller Journey

This is the mandatory human-facing E2E merge gate. API shortcuts may support setup/reviewer authority but may not replace the Seller UI steps being certified.

Run on desktop and mobile, plus explicit tablet/narrow visual pass.

1. [ ] Home
2. [ ] click Sell
3. [ ] intent chooser visible
4. [ ] choose existing/known/new path
5. [ ] enter Seller data in UI
6. [ ] select 7 meaningful photos
7. [ ] label photos
8. [ ] order photos
9. [ ] choose explicit cover
10. [ ] guest draft saved truthfully
11. [ ] create account OR sign into historical compatible account
12. [ ] verification-email state truthful
13. [ ] draft resumes automatically
14. [ ] refresh mid-form
15. [ ] state survives
16. [ ] My Garage
17. [ ] Continue listing CTA
18. [ ] Seller Studio resumes
19. [ ] My Listings
20. [ ] Preview buyer listing
21. [ ] preview clearly non-public
22. [ ] complete gallery visible
23. [ ] evidence upload
24. [ ] pending state visible
25. [ ] authorized reviewer resolves evidence
26. [ ] readiness changes truthfully
27. [ ] publish from Seller UI
28. [ ] signed-out Marketplace discovery
29. [ ] Home visual sanity check
30. [ ] public Vehicle Detail
31. [ ] section-by-section parity to rich reference
32. [ ] save
33. [ ] compare
34. [ ] share
35. [ ] buyer inquiry
36. [ ] Seller inquiry inbox
37. [ ] Communications thread/projection
38. [ ] Seller response path
39. [ ] Intelligence event recorded
40. [ ] Intelligence visual reflects governed activity or precise source-state
41. [ ] price change
42. [ ] unpublish
43. [ ] Marketplace removal
44. [ ] republish
45. [ ] Marketplace return
46. [ ] mark sold
47. [ ] active Marketplace removal
48. [ ] Passport persists
49. [ ] media identity remains coherent throughout
50. [ ] privacy projection remains coherent throughout

**Prohibited shortcut:** a seeded/reference vehicle or API-created vehicle cannot satisfy this gate.

---

# Phase 20 — Cross-feature exact-head battery

After all implementation:

- [ ] backend full suite
- [ ] web unit/component suite
- [ ] typecheck
- [ ] lint-regression
- [ ] production web build
- [ ] Seller suites
- [ ] Marketplace suites
- [ ] Vehicle Passport suites
- [ ] Verify/navigation suites
- [ ] Communications suites
- [ ] Intelligence suites
- [ ] Service Network affected integration suites
- [ ] security/secret/dependency gates
- [ ] migration/preflight gates
- [ ] Playwright full suite
- [ ] Seller Golden desktop
- [ ] Seller Golden mobile
- [ ] tablet/narrow visual evidence
- [ ] accessibility
- [ ] exact frontend provenance
- [ ] exact backend provenance
- [ ] staging health
- [ ] no automated inventory contamination after tests
- [ ] no unresolved P0/P1 review threads

---

# Phase 21 — Owner UAT handoff

Only after Phases 0–20 are green:

- [ ] stable candidate SHA frozen
- [ ] exact frontend URL supplied
- [ ] exact backend SHA/provenance supplied
- [ ] human UAT account instructions supplied
- [ ] no rotating automation credential presented as human credential
- [ ] historical account continuity result documented
- [ ] clean Marketplace inventory/count explained
- [ ] expected external-provider limitations documented
- [ ] click-by-click UAT script supplied
- [ ] owner visual/product acceptance received

---

# Roll-call ledger

This section must be updated after **every** cleared task.

| Phase | Status | Current evidence / exact SHA | Re-open reason if any |
|---|---|---|---|
| 0 Baseline + parity | [~] | Parity matrix committed at `b25a89dc690d17d9e253ae4358edec64eea6532b`; baseline screenshots still pending | |
| 1 UAT/harness integrity | [ ] | | |
| 2 Account continuity | [ ] | | |
| 3 Navigation | [ ] | | |
| 4 Sell intent | [ ] | | |
| 5 Draft/resume | [ ] | | |
| 6 Media | [ ] | | |
| 7 Home visuals | [ ] | | |
| 8 My Garage | [ ] | | |
| 9 My Listings | [ ] | | |
| 10 Seller Studio | [ ] | | |
| 11 Buyer presentation | [ ] | | |
| 12 Marketplace parity | [ ] | | |
| 13 Trust/readiness separation | [ ] | | |
| 14 Intelligence | [ ] | | |
| 15 Owner Dashboard | [ ] | | |
| 16 Communications | [ ] | | |
| 17 Publication lifecycle | [ ] | | |
| 18 Responsive/accessibility | [ ] | | |
| 19 Genuine Golden journey | [ ] | | |
| 20 Exact-head battery | [ ] | | |
| 21 Owner UAT | [ ] | | |

---

# Change-control rule for this programme

Every implementation commit must state which checklist items it advances. No checklist item may be marked `[x]` from code inspection alone when it requires runtime, visual, staging, or owner evidence.

No merge to `main` is authorized by this plan. This programme must first produce a clean Seller-remediated candidate stacked on the current #194 integration branch, followed by owner UAT and the project's normal reconciliation/production sequence.

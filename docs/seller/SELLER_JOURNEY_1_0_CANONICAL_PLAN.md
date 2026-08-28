# CarUp Seller Journey 1.0 — Canonical Plan

**Status:** Canonical programme manual  
**Programme:** Seller Journey 1.0 — Vehicle-to-Marketplace Go-to-Market Truth Pipeline  
**Source anchor:** `main@ba208963d863654157335189c60f587cbe330041`  
**Created:** 2026-08-28  
**Owner:** CarUp  
**Repository:** `kudzimusar/carup`

---

## 1. Purpose

Seller Journey 1.0 turns Sell into the **authoring console for a CarUp vehicle**, not merely a classified-ad form.

A seller should enter information once and that canonical information should correctly power:

`Sell → Vehicle Passport → Verify → Marketplace → Home → Search/Filters → Communications → Intelligence → Transaction → Ownership lifecycle`

The advertisement is temporary. The vehicle truth must persist.

### Platform taxonomy dependency

Seller Journey S0 initiates the hardening of CarUp's vehicle taxonomy, but the resulting taxonomy is a **platform-wide global contract**, not a Seller-owned asset.

Canonical authority: `docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`

Once production-certified, Sell, Buy/Marketplace, Home, Verify/Passport, Intelligence, Imports/Diaspora, mobile, dealer/admin tools, backend services and public/partner APIs must consume or extend that one taxonomy rather than recreate local vocabularies.

This document is the durable product, engineering, QA, UAT, merge and future-agent manual for the Seller Journey 1.0 programme.

No implementation agent should begin Seller Journey work without reading this document and reconciling its source anchors against live repository state.

---

## 2. Governing product outcome

A successful Seller Journey 1.0 lets one seller:

1. start selling as a guest or authenticated user;
2. identify or create the correct vehicle without duplicating an existing Passport;
3. provide one complete canonical commercial data set;
4. distinguish seller-stated facts from verified/governed facts;
5. choose seller identity, location and communication visibility;
6. create premium listing media without confusing listing photos with evidence;
7. provide evidence and resolve discrepancies;
8. preview the actual Marketplace representation;
9. understand publication readiness, listing quality and canonical Trust separately;
10. publish and be discoverable by all applicable Marketplace filters;
11. receive buyer inquiries and communications through CarUp Communications;
12. see truthful Seller Intelligence;
13. edit, pause, republish, change price and mark sold;
14. begin the ownership-transfer lifecycle;
15. retain the Vehicle Passport after the advertisement ends.

The final programme gate is not “the form works.” It is an exact-head, staging-proven, owner-accepted end-to-end seller lifecycle.

---

## 3. Live programme anchors and lane boundaries

At creation of this plan, the live anchors are:

| Surface | Exact state |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| Marketplace / Buyer↔Seller PR #182 | `0d6df68f5003e209269f19cca54ead85cdab0748` — Draft |
| Communications / Email PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — Draft |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — Draft |
| Post-Reunification execution plan PR #181 | Open; freezes max two active source-write PRs |

### 3.1 Hard lane rule

The repository operating model freezes a maximum of **two active source-write PRs at a time**.

Therefore this Seller programme begins as a **documentation / contract / audit lane only**.

It MUST NOT open a third runtime implementation lane while existing source-write lanes occupy the shared Seller, Marketplace, Communications or Intelligence surfaces.

### 3.2 Current file ownership boundaries

PR #182 currently owns or modifies the critical Seller and Marketplace surfaces, including:

- `web/src/data/vehicleTaxonomy.ts`
- `web/src/pages/GuestSell.tsx`
- `web/src/pages/dashboard/owner/SellVehicle.tsx`
- Marketplace filters and parameter contracts
- Marketplace listing cards
- Home
- Verify
- Vehicle Detail

PR #183 owns the Communications architecture and provider/channel orchestration.

PR #185 owns Intelligence event, metric, rollup, projection and recommendation architecture.

Seller Journey 1.0 MUST consume those contracts. It MUST NOT fork or recreate them.

### 3.3 Mandatory pre-phase reconciliation

Before every runtime implementation phase:

1. re-read live `main` SHA;
2. enumerate open implementation PRs and exact heads;
3. compare changed-file manifests;
4. identify shared-file ownership;
5. perform merge-tree/conflict analysis where applicable;
6. choose the implementation base from the accepted/merged canonical state, not stale `main`;
7. record the reconciliation in the phase receipt.

No phase may rely on remembered SHAs.

---

## 4. Permanent Seller Journey invariants

### Invariant 1 — One answer, one canonical destination

> If CarUp asks the seller a question, CarUp must have a canonical destination for the answer.

No accepted Seller field may be silently discarded.

### Invariant 2 — Seller statement is not verified truth

Every material fact must preserve authority and provenance:

`seller-stated → evidence-backed → verified/governed`

Seller input must never silently become CarUp-certified truth.

### Invariant 3 — Cross-surface parity

If Marketplace can filter it, Sell must populate it or another governed source must.

If Marketplace displays it, the canonical source must be known.

If Verify reports it, its provenance / verification state must be known.

If Home displays it, Home must reuse the Marketplace/public projection.

If Intelligence measures it, the underlying event or fact must actually exist.

### Invariant 4 — Communications is horizontal infrastructure

Seller Journey does not rebuild email, WhatsApp, Telegram, push, internal notification or conversation systems.

Seller emits governed domain events into the existing Communications layer.

> Providers are transports. CarUp owns the conversation.

### Invariant 5 — Intelligence observes business truth

Authoritative business mutations happen in the Seller/Marketplace domain first.

Intelligence records meaningful observations and authoritative events at those boundaries.

Telemetry must never become business truth.

### Invariant 6 — Three distinct measurements

Never collapse:

- **Publication Readiness** — may CarUp publish?
- **Listing Quality** — is the commercial listing strong?
- **Canonical Trust** — what has CarUp actually verified?

They must remain independently calculated and independently presented.

### Invariant 7 — Taxonomy is global, not feature-local

Seller Journey may discover or extend taxonomy requirements, but it must not own a private Seller taxonomy. Once a dimension is canonical, every CarUp surface must consume or extend the global contract rather than create another list.

### Invariant 8 — Missing stays missing

No UI, API, migration or projection may fabricate a plausible default for an unknown vehicle fact.

A missing value is not zero, false, “local,” “USD,” “2020,” “private seller,” or any other convenient substitute unless the user or governed source explicitly supplied it.

---

## 5. Programme phases

# S0 — Vehicle Taxonomy & Seller Contract Foundation — PREREQUISITE

### Goal

Establish CarUp's **global governed vehicle language** and one complete Seller data contract before expanding Seller runtime UX. Seller S0 is the initiating workstream; the completed taxonomy is owned by the CarUp platform and reused globally.

### Scope

Define the canonical hierarchy:

`Make → Model → Generation → Variant/Trim → Model Year → Body Style → Fuel → Transmission → Drivetrain`

Keep independent dimensions for:

- seller-stated condition;
- governed/commercial classification;
- mileage;
- colour;
- import state;
- location;
- features/extras;
- price/currency;
- vehicle identity;
- evidence state;
- Trust signals.

### Deliverables

- platform-wide global taxonomy contract (`docs/platform/CARUP_GLOBAL_VEHICLE_TAXONOMY_CONTRACT.md`);
- global consumer matrix covering Sell, Buy/Marketplace, Home, Verify/Passport, Intelligence, Imports/Diaspora, mobile, backend and APIs;
- alias / regional naming strategy;
- Zimbabwe / JDM / SADC seed policy;
- unknown / Other handling;
- taxonomy versioning;
- Seller Data Contract Matrix;
- filter parity matrix;
- canonical storage / provenance mapping;
- Communications event seam;
- Intelligence event seam;
- privacy vocabulary.

### Production gate

S0 passes only when contract tests can prove, for every applicable dimension:

`source value → global taxonomy normalization → canonical persistence → required product projections/filters/analytics`

No incompatible vocabulary, no dead Seller fields, and no required CarUp surface maintaining an independent competing taxonomy.

---

# S1 — Seller Entry & Vehicle Identification

### Goal

Make starting a sale low-friction without compromising Truth.

### Journey

`Sell → VIN/plate/vehicle lookup → existing Passport detection → seller confirmation → guest/auth handoff`

### Requirements

- guest seller support;
- authenticated private owner;
- dealer / tenant context;
- dealer branch context where governed;
- existing Vehicle Passport reuse;
- duplicate-vehicle prevention;
- no truth-dangerous defaults;
- guest draft survives authentication.

### Communications seam

Examples:

- draft continuation;
- account handoff;
- identity / account verification.

### Intelligence seam

Examples:

- `sell_started`;
- vehicle lookup outcome;
- `guest_draft_saved`;
- account handoff started/completed.

### Gate

A guest can begin, authenticate later and resume without losing or corrupting entered information.

---

# S2 — Canonical Commercial Listing Data

### Goal

Close all Seller data-continuity P0s.

### Required canonical persistence

At minimum:

- description;
- features/extras;
- body style;
- seller-stated condition;
- import details;
- location;
- price;
- currency;
- all vehicle specification fields requested by Sell.

Seller assertion must remain separate from governed classification.

### Gate

100% Seller Data Contract Matrix coverage.

**Zero accepted UI fields may be silently discarded.**

---

# S3 — Seller Identity, Dealer Context & Privacy

### Goal

Make the seller recognizable when consented and private when not.

### Controls

Private seller:

- public seller identity on/off;
- display name / profile projection.

Dealer:

- dealer identity;
- branch;
- verified dealership context;
- organization projection.

Location:

- city + province;
- province only;
- hidden until inquiry.

Communication preferences:

- CarUp secure messaging;
- WhatsApp where configured/consented;
- phone where allowed;
- email;
- other governed transports.

### Gate

Visibility on/off is tested through API, Marketplace, Home, Verify and Communications.

No private field may leak.

---

# S4 — Listing Media Studio

### Goal

Create a premium commercial listing while preserving evidence semantics.

### Capabilities

- multiple images;
- drag/reorder;
- explicit cover photo;
- guided photo sequence;
- media-quality feedback;
- recommended damage disclosure;
- odometer/dashboard guidance.

Suggested sequence:

`Front → Rear → Driver side → Passenger side → Interior → Dashboard → Odometer → Engine → Tyres → Known damage`

### Truth boundary

Listing media remains commercial media unless separately admitted into governed evidence.

### Gate

Seller-selected primary media survives persistence and projects consistently to Marketplace/Home/detail.

---

# S5 — Embedded Verify & Evidence Reconciliation

### Goal

Make Truth part of the seller experience.

### Scope

Allow evidence upload and reconciliation for:

- ownership/registration;
- identity where required;
- customs/import;
- inspection;
- supporting records.

Contradictions must be surfaced explicitly.

Example:

- Seller stated: 2020
- Evidence indicates: 2019

The user must resolve or accept the governed outcome; the system must not silently overwrite.

### Communications seam

- evidence received;
- review pending;
- verification completed;
- discrepancy action required.

### Gate

Known material contradictions cannot silently reach publication.

---

# S6 — Actual Buyer Preview & Searchability Proof

### Goal

Show the seller exactly what buyers will see.

Reuse the actual:

- Marketplace listing card;
- Marketplace listing-detail/public projection.

Also show an explicit discoverability summary, for example:

`Toyota · Hilux · Pickup · Diesel · Automatic · Harare · 2021`

### Gate

Every applicable preview facet is programmatically tested against Marketplace discovery.

No separate approximate preview model.

---

# S7 — Publication Readiness & Listing Quality

### Goal

Make publishability understandable and actionable.

Present three separate blocks:

1. Publication Readiness;
2. Listing Quality;
3. Canonical Trust.

### Communications examples

- ownership evidence still required;
- listing now publishable;
- recommended listing-quality improvement.

### Gate

A seller can clearly distinguish blocking requirements, recommendations and verified Trust state.

---

# S8 — Publish, Edit & Manage Lifecycle

### Goal

Complete the operational seller lifecycle.

### Capabilities

- save draft;
- resume;
- edit;
- publish;
- pause/unpublish;
- change price;
- respond to inquiries;
- manage conversations;
- mark sold;
- begin ownership transfer.

### Authoritative domain events

Examples:

- `listing_published`;
- `buyer_inquiry_created`;
- `buyer_message_received`;
- `price_changed`;
- `listing_unpublished`;
- `vehicle_sold`.

Communications decides the governed transport/channel from preferences and availability.

### Gate

Full lifecycle works without direct database intervention.

---

# S9 — Seller Intelligence Pairing

### Goal

Turn already-proven journey signals into truthful seller guidance.

### Examples

- qualified search appearances;
- listing views;
- saves;
- inquiries;
- listing completeness;
- lost-opportunity guidance;
- missing searchable dimensions;
- price/activity guidance where governed evidence supports it.

### Gate

Every visible metric traces to a governed event/read model.

Missing data renders as unavailable, never fake zero.

---

# S10 — Communications End-to-End Certification

### Goal

Certify the Seller journey against the existing Communications system.

### Matrix

For each seller-domain event prove:

`Domain event → Communications → preference policy → channel → delivery → canonical conversation/notification record`

Test configured channels:

- in-app;
- email;
- WhatsApp;
- Telegram;
- push;
- retries;
- dedupe;
- consent;
- opt-outs;
- failure behavior.

### Gate

External provider failure must not destroy the canonical CarUp communication state.

---

# S11 — Home / Marketplace / Verify Convergence

### Goal

Prove one canonical vehicle representation across the public product.

### Required convergence

`Seller → Marketplace → Home → Vehicle Detail → Verify → Passport`

No contradictory:

- Trust;
- seller identity;
- mileage;
- location;
- vehicle classification;
- price/currency;
- media semantics.

### Gate

Cross-surface contract/snapshot tests agree on every governed field.

---

# S12 — Golden Seller Vehicle Production Certification

### Goal

Prove Seller Journey 1.0 end to end on one exact staging candidate.

### Golden Seller Vehicle certification script

The test seller must:

1. start as guest;
2. identify/create the vehicle;
3. authenticate without losing data;
4. complete every canonical Seller field;
5. upload strong media;
6. provide evidence;
7. resolve discrepancies;
8. choose seller/privacy settings;
9. preview actual Marketplace output;
10. satisfy publication readiness;
11. publish;
12. find the vehicle through every applicable filter;
13. inspect Marketplace presentation;
14. inspect Home presentation where eligible;
15. find the same vehicle through Verify;
16. inspect the same Passport;
17. receive an inquiry;
18. receive correct Communications;
19. respond through Communications;
20. inspect truthful Seller Intelligence;
21. edit the vehicle;
22. change price;
23. unpublish/republish;
24. mark sold;
25. begin ownership transfer;
26. confirm Vehicle Passport persistence after listing closure.

### Certification requirements

- desktop;
- compact/mobile web;
- applicable native/mobile;
- API contract tests;
- backend tests;
- database/migration checks;
- privacy/security tests;
- Playwright E2E;
- visual regression;
- staging UAT;
- exact-head CI;
- independent review;
- owner acceptance;
- short soak.

No production activation occurs from an uncertified Draft PR.

---

## 6. P0 and P1 priorities

### P0 — production correctness

- taxonomy contract;
- canonical persistence;
- Truth/provenance;
- privacy;
- seller/dealer identity;
- publication authority;
- filter parity;
- no dead fields;
- Verify consistency;
- Communications authority;
- secure lifecycle operations.

### P1 — benchmark-quality experience

- embedded verification;
- media studio;
- real buyer preview;
- edit/resume;
- listing-quality guidance;
- seller Intelligence;
- proactive Communications;
- dealer presentation;
- cross-surface polish.

Seller Journey 1.0 is not complete merely because P0 APIs work. P1 is part of the programme definition.

---

## 7. Communications contract

Seller Journey consumes Communications 2.0 / Email Experience infrastructure.

Seller-domain code may emit authoritative events and supply canonical recipient/context metadata, but must not:

- implement direct provider-specific business logic in Seller surfaces;
- bypass consent/preferences;
- duplicate conversation storage;
- make WhatsApp/Telegram/email delivery the source of truth;
- lose canonical communication state when a provider fails.

Expected seller-lifecycle communication classes include:

- draft/incomplete listing;
- identity/account handoff;
- evidence/review status;
- discrepancy action;
- listing publish/unpublish;
- inquiry/reply;
- reservation/transaction;
- price/lifecycle changes;
- listing-performance recommendations;
- sold/ownership-transfer follow-up.

---

## 8. Intelligence contract

Seller Journey pairs Intelligence at meaningful domain boundaries.

Client-observable events may describe UI activity.

Authoritative business events must be written server-side beside the corresponding domain mutation.

Recommended journey event family includes:

- `sell_started`;
- `guest_draft_saved`;
- `account_handoff_started`;
- `account_handoff_completed`;
- `draft_persisted`;
- `identity_completed`;
- `evidence_uploaded`;
- `evidence_verified`;
- `discrepancy_detected`;
- `discrepancy_resolved`;
- `listing_previewed`;
- `publish_attempted`;
- `listing_published`;
- `listing_viewed`;
- `listing_saved`;
- `compare_added`;
- `inquiry_started`;
- `inquiry_sent`;
- `reservation_started`;
- `reservation_confirmed`;
- `price_changed`;
- `listing_unpublished`;
- `vehicle_sold`.

Do not instrument every keystroke unless a governed product question requires it.

---

## 9. Evidence and receipt protocol

Every implementation phase must deposit a receipt under:

`docs/seller/receipts/`

Recommended names:

- `S0_TAXONOMY_AND_CONTRACT_CERTIFICATION.md`
- `S1_ENTRY_AND_IDENTIFICATION_CERTIFICATION.md`
- `S2_CANONICAL_LISTING_DATA_CERTIFICATION.md`
- `S3_IDENTITY_PRIVACY_CERTIFICATION.md`
- `S4_MEDIA_STUDIO_CERTIFICATION.md`
- `S5_VERIFY_RECONCILIATION_CERTIFICATION.md`
- `S6_PREVIEW_SEARCHABILITY_CERTIFICATION.md`
- `S7_PUBLICATION_QUALITY_CERTIFICATION.md`
- `S8_LIFECYCLE_CERTIFICATION.md`
- `S9_SELLER_INTELLIGENCE_CERTIFICATION.md`
- `S10_COMMUNICATIONS_CERTIFICATION.md`
- `S11_CROSS_SURFACE_CONVERGENCE_CERTIFICATION.md`
- `S12_GOLDEN_SELLER_CERTIFICATION.md`

Each receipt must include:

- source/base SHA;
- candidate exact head;
- open-PR reconciliation;
- changed-file ownership;
- migrations/schema affected;
- tests run;
- staging proof;
- unresolved findings;
- PASS/BLOCKED decision.

---

## 10. Definition of Done

Seller Journey 1.0 is DONE only when:

> One seller can create one truthful vehicle once, publish it beautifully, have buyers discover and communicate about it reliably, receive actionable intelligence, complete its selling lifecycle, and leave behind a persistent trustworthy Vehicle Passport — with the complete journey proven at one exact production-candidate head.

Anything less is an intermediate phase, not programme completion.

---

## 11. Future-agent start protocol

Every future agent working on Seller Journey 1.0 must:

1. read this document;
2. read the latest `docs/seller/receipts/` phase receipt;
3. reconcile live `main`, #182/#183/#185 or their successors;
4. confirm the current allowed source-write lanes;
5. avoid shared-file changes owned by another active lane;
6. preserve Truth, Trust, Communications and Intelligence authority boundaries;
7. make only the current phase changes;
8. certify the exact head before moving to the next phase.

No agent should restart the programme from first principles.

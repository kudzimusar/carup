# CarUp Vehicle Passport / Trust Lifecycle 1.0 — Canonical Plan

**Status:** canonical programme plan candidate  
**Programme:** Post-Reunification Product Advancement — Vehicle Passport / Trust Lifecycle 1.0  
**Repository:** kudzimusar/carup  
**Source anchor at planning time:** main@ba208963d863654157335189c60f587cbe330041  
**Created:** 2026-08-28  
**Owner:** CarUp  
**Runtime authorization:** BOUNDED FOUNDATION ONLY while Seller Journey 1.0 remains active. V0/V1 and isolated, additive Passport-only scaffolding may proceed concurrently when lane governance permits and Seller-owned shared surfaces are not modified. Seller-dependent integration phases remain blocked until exact-head Seller reconciliation/certification.

---

# 0. Executive decision

Vehicle Passport / Trust Lifecycle 1.0 will **not rebuild Canonical Vehicle Truth or Canonical Trust**.

It will turn the already-built identity, evidence, provenance, verification, Trust, Marketplace, Seller, Communications and Intelligence foundations into one persistent vehicle lifecycle.

The governing product chain is:

**Sell → Vehicle Passport → Verify → Marketplace → Home → Communications → Intelligence → ownership lifecycle**

The governing architectural relationship is:

**Evidence / observations → Canonical Truth → Canonical Trust → Vehicle Passport → role-scoped journeys and actions**

The advertisement is temporary.

The canonical vehicle and its governed history persist.

---

# 1. Programme objective

A successful Vehicle Passport / Trust Lifecycle 1.0 allows one physical vehicle to exist as one durable CarUp record across:

- creation / discovery;
- Seller authoring;
- evidence submission;
- verification and discrepancy resolution;
- Marketplace publication;
- buyer due diligence;
- Communications;
- transaction / reservation;
- sale;
- ownership transfer;
- service and maintenance;
- PartSentry / parts provenance;
- insurance / finance interactions where governed;
- future relisting;
- future ownership.

The programme is complete only when a real owner can open a vehicle and understand:

1. **what vehicle this is;**
2. **what CarUp knows;**
3. **where each important fact came from;**
4. **what is verified, stated, unknown, unavailable or conflicting;**
5. **what CarUp can responsibly conclude;**
6. **what happened over the vehicle's life;**
7. **what needs attention now;**
8. **what actions the owner is allowed to take;**
9. **what buyers/partners are allowed to see;**
10. **what persists after the vehicle is sold.**

---

# 2. Product thesis

Most vehicle-history products are report-centric.

CarUp should be lifecycle-centric.

The target product is a **living vehicle operating record**:

**Identify → verify → understand → maintain → transact → transfer → preserve**

This should combine the strongest benchmark ideas:

- CARFAX-style history and owner care;
- carVertical-style timeline, mileage, damage/risk and market context;
- AutoCheck-style concise interpretation without reducing everything to one score;
- VINwiki-style persistent owner-contributed vehicle history;
- official inspection/source patterns such as UK MOT;
- Digital Product Passport-style persistent identity and role-aware lifecycle data;
- Zimbabwe-specific licensing, registration, roadworthiness, customs/import and theft/clearance realities.

CarUp's unique advantage is the combination:

**Truth + Trust + Marketplace + Seller + Communications + Intelligence + Service/PartSentry + Ownership continuity**

---

# 3. Permanent architecture invariants

## Invariant 1 — One physical vehicle, one canonical identity

A resale, relisting, owner change, new plate or new Seller flow must not create a second vehicle when the canonical vehicle is already known.

## Invariant 2 — Truth is fact + provenance

Every important fact must preserve where it came from and what authority class it has.

At minimum distinguish:

- seller-stated;
- owner-stated;
- garage/partner-stated;
- evidence-backed;
- CarUp-reviewed;
- source-connected;
- verified clear;
- verified adverse;
- pending;
- rejected;
- expired;
- no record;
- unavailable;
- unknown;
- not applicable;
- conflicting.

## Invariant 3 — Trust remains canonical

The sole canonical Trust authority remains the existing Trust decision system.

Passport must never calculate its own score, confidence band or verification state.

## Invariant 4 — Passport is orchestration, not authority

Passport owns the lifecycle user experience and safe composition of canonical information.

It does not become a second source of vehicle truth.

## Invariant 5 — Unknown stays unknown

Absence, failed fetch, not connected, no record and not evaluated are not interchangeable.

## Invariant 6 — Trust, evidence completeness, confidence and risk remain separate

Do not collapse them into a single badge or percentage.

## Invariant 7 — Seller statement is never silently promoted

A statement becomes stronger only through a governed evidence/review/source path.

## Invariant 8 — Listing media is not evidence

Commercial imagery may be useful context but cannot silently acquire evidence semantics.

## Invariant 9 — One canonical conversation

Passport events use CarUp Communications. No Passport-specific email, chat or WhatsApp subsystem.

## Invariant 10 — Intelligence observes

Analytics and AI may explain, recommend and forecast. They do not become business truth or Trust authority.

## Invariant 11 — Ownership is history, not overwrite

Ownership transitions append to the vehicle lifecycle. Prior history is preserved subject to privacy rules.

## Invariant 12 — Public projection is policy-governed

The public Passport is not the owner Passport with fields hidden in the frontend. Sensitive data must be excluded server-side.

## Invariant 13 — Corrections preserve history

Material facts, evidence and review decisions are superseded or corrected through an auditable path, not silently overwritten.

## Invariant 14 — External authority claims are source-specific

CarUp may say “ZIMRA document reviewed” or “source-connected result” only when the exact source state supports it. It may not create generic “government verified” claims.

## Invariant 15 — Exact-head certification

No phase is complete because an earlier SHA was green.

---

# 4. Existing CarUp foundations to preserve

This programme begins from a mature base, not zero.

Existing or previously certified foundations include:

- canonical VIN-based vehicle records;
- plate/chassis/engine/registration identity fields;
- duplicate/conflict controls;
- ownership-history structures;
- evidence storage;
- secure evidence access rules;
- evidence checksums;
- OCR/document inspection capabilities;
- evidence review;
- Trust decision service;
- Trust audit/history;
- public vehicle projection;
- canonical media/evidence separation;
- Vehicle Passport page/read path;
- evidence timeline/gallery;
- Marketplace Trust summaries;
- Seller evidence and publication workflow;
- Verify lookup policy;
- public/private Passport projection rules;
- Communications 2.0 canonical conversation model;
- CarUp Intelligence event/read-model architecture;
- Marketplace reference UX;
- Home communicative ecosystem surface;
- global vehicle taxonomy;
- PartSentry and service/mechanic foundations.

Every V0 reconciliation must determine which of these are currently merged/certified and which remain on successor PRs.

---

# 5. Product model: the six Passport pillars

The Vehicle Passport user experience will be structured around six durable product pillars.

## 5.1 Identity — “Which vehicle is this?”

Includes:

- VIN;
- plate and plate history where governed;
- chassis;
- engine;
- make/model/generation/variant/year;
- body/fuel/transmission/drivetrain;
- import/local identity;
- canonical aliases;
- duplicate/conflict state.

Identity must expose enough context to prevent mistaken vehicles without leaking protected identifiers.

## 5.2 Evidence — “What records exist?”

Includes:

- documents;
- photos admitted as evidence;
- inspections;
- registrations;
- ownership evidence;
- customs/import evidence;
- insurance evidence;
- mileage observations;
- service records;
- PartSentry/parts provenance;
- transaction/transfer evidence where applicable.

Every item needs provenance and visibility.

## 5.3 Verification — “What has actually been checked?”

Examples:

- source-connected;
- CarUp document-reviewed;
- pending;
- rejected;
- expired;
- conflicting;
- unavailable;
- unknown.

The verification layer must not invent certainty.

## 5.4 Trust — “What can CarUp responsibly conclude?”

The Passport presents the canonical Trust decision with:

- score/value where evaluated;
- Trust band;
- confidence;
- evidence basis;
- risk state;
- reasons;
- limitations;
- evaluation version/state;
- freshness where applicable.

## 5.5 Lifecycle — “What happened over time?”

A unified timeline may include:

- import;
- registration;
- ownership;
- inspection;
- mileage;
- incident/damage where evidenced;
- insurance;
- service;
- parts;
- listing;
- reservation;
- sale;
- ownership transfer.

## 5.6 Owner Cockpit — “What needs attention now?”

Examples:

- evidence needed;
- discrepancy unresolved;
- inspection due;
- licence due;
- insurance due;
- service due;
- ownership transfer action;
- buyer inquiry;
- listing improvement;
- PartSentry or part lifecycle action;
- security/recall/safety action where authoritative.

This pillar is a major CarUp differentiator.

---

# 6. Passport projections and audiences

One canonical vehicle supports several server-governed projections.

## Public Passport

Purpose: safe vehicle understanding.

May include:

- public identity;
- public-safe Trust;
- public-safe evidence summary;
- public-safe lifecycle;
- Marketplace state;
- selected service/history events.

Must exclude:

- private owner contact;
- private documents;
- internal review notes;
- source credentials;
- private operational tables;
- sensitive insurance/finance data;
- previous-owner personal information.

## Buyer / transaction Passport

Purpose: due diligence for a legitimate buyer/transaction.

May expose additional evidence or transaction context only where policy and consent permit.

## Owner Passport

Purpose: manage the vehicle.

Includes role-safe access to:

- evidence;
- documents;
- ownership actions;
- reminders;
- service history;
- listing state;
- private communications/action links;
- correction/dispute workflows.

## Seller / Dealer projection

Purpose: prepare and sell a vehicle.

Consumes Seller Journey contracts and highlights:

- publication blockers;
- evidence gaps;
- discrepancies;
- listing quality;
- canonical Trust;
- buyer-visible preview.

## Garage / Mechanic projection

Purpose: complete an authorized service job.

Expose only the vehicle/service context necessary for the job.

## Institutional / partner projection

Purpose: finance, insurance, inspection, government or other governed workflows.

Access must be purpose-scoped and auditable.

## CarUp governance projection

Purpose: evidence review, disputes, fraud, source operations and audit.

This projection may include internal detail never exposed publicly.

---

# 7. Data and provenance model

Every material lifecycle record should be able to answer:

- vehicle_id / VIN;
- event/fact category;
- asserted value;
- normalized value where applicable;
- authority/source class;
- source organization/provider;
- source record identifier where safe;
- evidence references;
- actor;
- observed_at;
- recorded_at;
- effective_from/to where relevant;
- verification/review state;
- confidence only where semantically valid;
- visibility policy;
- correction/supersession relation;
- audit reference.

Do not create one giant “passport_events” table as a new source of truth if authoritative domain tables already exist.

A Passport timeline/read model may normalize events for display, but each event must retain a pointer back to its authoritative source.

---

# 8. Lifecycle event taxonomy

The programme should establish or reuse one governed event vocabulary.

Candidate event families:

## Identity
- vehicle_identity_created
- vehicle_identity_matched
- identity_conflict_detected
- identity_conflict_resolved
- identifier_changed

## Evidence / verification
- evidence_submitted
- evidence_received
- evidence_review_pending
- evidence_verified
- evidence_rejected
- evidence_superseded
- discrepancy_detected
- discrepancy_resolved
- source_verification_requested
- source_verification_completed
- source_verification_unavailable

## Trust
- trust_evaluation_requested
- trust_evaluated
- trust_materially_changed
- trust_stale
- trust_unavailable

## Marketplace / Seller
- listing_draft_created
- listing_published
- listing_unpublished
- listing_price_changed
- buyer_inquiry_created
- reservation_started
- reservation_confirmed
- vehicle_sold

## Ownership
- ownership_claim_started
- ownership_claim_verified
- ownership_transfer_started
- ownership_transfer_action_required
- ownership_transfer_completed
- ownership_transfer_disputed

## Service / maintenance
- service_record_added
- service_record_verified
- mileage_observed
- inspection_recorded
- part_installed
- partsentry_check_recorded
- maintenance_due

## Compliance / care
- licence_due
- insurance_due
- inspection_due
- safety_or_recall_action_available

Events must not replace authoritative domain records.

---

# 9. Programme phases

The phases below are sequential gates. Future agents may split a phase into sub-phases but may not skip the authority or certification intent.

---

# V0 — Live Reconciliation, Authority Freeze and Gap Inventory

## Goal

Start from live truth after Seller Journey closure, not from this planning snapshot.

## Required work

- resolve current main SHA;
- enumerate all open PRs;
- identify active source-write lanes;
- identify Seller Journey accepted/candidate exact head;
- reconcile Marketplace, Seller, Verify, Passport, Communications and Intelligence files;
- inventory identity, evidence, ownership, service, PartSentry, Trust and public projection schemas;
- identify duplicated/deprecated legacy paths;
- audit existing Passport routes/components;
- audit current mobile Passport parity;
- audit external source integration reality;
- audit security/RLS/lookup policy;
- map every proposed Passport field to an existing authority or explicit new gap.

## Deliverables

- V0 baseline receipt;
- current authority matrix;
- schema/read/write inventory;
- gap matrix;
- conflict/shared-file map;
- implementation lane authorization statement.

## Gate

No runtime code until V0 can state:

**what already exists, what is canonical, what is missing, what is deprecated, and which files are safe to own.**

---

# V1 — Passport Information Architecture and Canonical Read Model

## Goal

Define one coherent Passport product without inventing new truth.

## Scope

Design and implement a role-aware Passport read model that composes existing authoritative sources.

Minimum sections:

- identity;
- current lifecycle state;
- Trust summary;
- evidence/verification summary;
- attention/actions;
- timeline;
- ownership;
- service/maintenance;
- parts;
- Marketplace/listing context.

## Requirements

- server-composed role-safe projection;
- explicit missing/unavailable/conflict states;
- no N+1 uncontrolled private reads;
- source references retained internally;
- public/owner/partner projections contract-tested.

## Gate

One test vehicle yields internally consistent projections across public and owner Passport views.

---

# V2 — Vehicle Identity, Claim and Access

## Goal

Make the Passport belong to the physical vehicle while controlling who may manage it.

## Scope

- exact VIN lookup;
- approved plate/protected lookup policy;
- existing Passport detection;
- owner claim;
- seller-to-owner continuity;
- dealer/tenant vehicle relationship;
- claim dispute;
- identifier history;
- access roles.

## Security

- prevent enumeration;
- rate-limit lookups;
- authorization on every manage action;
- no client-controlled owner_id/tenant_id;
- audit ownership/access changes.

## Gate

A legitimate owner can claim/manage the correct existing vehicle without creating a duplicate or gaining access to another user's private data.

---

# V3 — Evidence Vault and Provenance Experience

## Goal

Make evidence understandable and manageable.

## Scope

- evidence categories;
- upload;
- evidence metadata;
- source/provenance;
- status;
- visibility;
- evidence gallery;
- supersession/correction;
- secure download;
- owner deletion request semantics without destroying provenance.

## Required UX

Every evidence item should answer:

- what is this?
- who/what supplied it?
- when?
- what vehicle does it belong to?
- what status does it have?
- who can see it?
- did it affect Trust?
- was it superseded?

## Gate

No evidence can appear as verified merely because it was uploaded.

---

# V4 — Verification, Review and Discrepancy Reconciliation

## Goal

Turn conflicting/stated/evidence data into an actionable workflow.

## Scope

- field-level comparison;
- discrepancy creation;
- user explanation;
- review queue;
- human decision;
- source verification state;
- correction/supersession;
- re-evaluation trigger.

Example:

**Seller stated 2020 → evidence indicates 2019 → discrepancy → user/reviewer action → governed outcome**

## Communications

Notify on:

- evidence received;
- review pending;
- discrepancy action required;
- resolution;
- rejection.

## Gate

A material known contradiction cannot silently disappear into the Passport or Marketplace.

---

# V5 — Trust Explanation Layer

## Goal

Make canonical Trust useful to ordinary humans without changing the Trust engine.

## Required presentation

- Trust band/value if evaluated;
- evaluation state;
- confidence;
- evidence completeness;
- risk status;
- reasons;
- limitations;
- freshness/version where useful;
- “how to improve evidence” actions where governed.

## Prohibited

- client-side score;
- “verified car” umbrella badge;
- positive language from unknown/no-record;
- AI rewriting canonical Trust;
- rounding or banding that changes semantics.

## Gate

The same vehicle returns the same canonical Trust decision on Passport, Marketplace, Verify and other governed surfaces.

---

# V6 — Unified Vehicle Lifecycle Timeline

## Goal

Create the human-readable history of the vehicle.

## Event categories

- manufacture/import where known;
- registration/licensing;
- ownership;
- inspection;
- mileage;
- evidence;
- verification;
- damage/incident where evidenced;
- insurance;
- service;
- parts;
- listing;
- reservation/transaction;
- sale/transfer.

## Requirements

- chronological;
- source-aware;
- privacy-aware;
- filterable by category;
- details drill-down;
- correction/supersession;
- “unknown history” language where coverage is incomplete;
- no duplicate event inflation from multiple projections of the same source record.

## Gate

Timeline entries reconcile back to authoritative records and no public timeline leaks private operational data.

---

# V7 — Ownership History and Transfer Lifecycle

## Goal

Prove that the Passport survives a change of owner.

## Lifecycle

**current owner → sale/transfer initiated → required parties/actions → evidence/review → transfer complete → previous owner access changes → new owner receives continuity**

## Rules

- sold is not transfer complete;
- transaction complete is not necessarily registry ownership complete;
- prior owner personal data is protected;
- historical ownership event persists;
- shared evidence visibility is policy-governed;
- disputed transfer has a safe review path.

## Gate

A Golden Vehicle can be sold and transferred without creating a new Passport or deleting its prior history.

---

# V8 — Service, Maintenance, Garages and PartSentry

## Goal

Make post-purchase activity add durable value to the Passport.

## Service chain

**vehicle → authorized job → garage/mechanic → mileage → work performed → parts → evidence → status → Passport event**

## Support

- professional service records;
- owner/DIY service records with correct authority label;
- inspections;
- invoices;
- mileage observations;
- parts replaced;
- PartSentry fitment/provenance;
- service intervals;
- maintenance reminders;
- correction/dispute.

## Trust boundary

Service or PartSentry data may contribute governed facts to Trust only through explicit canonical Trust inputs.

## Gate

A service event appears once, with correct source strength and visibility, and cannot directly stamp “trusted” on the vehicle.

---

# V9 — Owner Cockpit and Next Actions

## Goal

Make Passport useful between buying and selling.

## Attention model

Possible cards/actions:

- verify ownership;
- add missing evidence;
- resolve discrepancy;
- inspection due;
- licence due;
- insurance due;
- service due;
- confirm mileage;
- respond to ownership transfer;
- review new service record;
- review PartSentry issue;
- prepare vehicle for sale;
- improve resale readiness.

## Prioritization

Actions should be derived from authoritative state and governed Intelligence, with clear distinction:

- required;
- recommended;
- informational.

## Gate

No action card may claim a due date/state unsupported by a canonical source or explicitly labeled estimate.

---

# V10 — Marketplace and Buyer Due-Diligence Convergence

## Goal

Make Passport the evidence/depth layer behind the buying decision.

## Buyer journey

**Marketplace → Vehicle Detail → Trust summary → Passport/history → inquiry/inspection → transaction**

## Requirements

- public-safe Passport link from eligible listings;
- progressive disclosure;
- seller statement vs verified fact distinction;
- timeline/risk/evidence summaries;
- buyer-specific data only when authorized;
- no Passport-only vehicle receives Marketplace transaction actions if not publicly listed.

## Gate

Marketplace and Passport agree on identity, mileage semantics, seller-stated facts, Trust, price/listing state and public evidence.

---

# V11 — Seller, Verify and Home Convergence

## Goal

Close the public ecosystem loop.

### Seller

Seller-authored data and evidence should flow into the same Passport.

### Verify

Verify should locate and explain the same governed vehicle, not a second history model.

### Home

Home communicates Passport capability truthfully and routes into actual product journeys.

## Gate

**Seller → Passport → Verify → Marketplace → Home** has no contradictory canonical vehicle field or Trust state.

---

# V12 — Communications Lifecycle Orchestration

## Goal

Make lifecycle state proactive without creating provider-specific business logic.

## Required event-to-communication matrix

For each selected event prove:

**domain event → Communications policy → canonical notification/conversation → recipient/consent → provider → delivery/retry → audit**

Minimum classes:

- evidence/review;
- discrepancy;
- Trust material change;
- service/maintenance;
- compliance due;
- ownership transfer;
- Marketplace/transaction;
- safety/recall where authoritative.

## Gate

Provider failure cannot erase the canonical CarUp notification/conversation.

---

# V13 — Passport Intelligence and Gutu AI

## Goal

Turn governed lifecycle data into understandable next-best-action.

## Intelligence examples

Owner:

- Passport completeness;
- evidence gaps;
- service timing;
- resale readiness;
- unresolved actions.

Buyer:

- explain evidence;
- summarize known limitations;
- compare history dimensions.

Seller:

- evidence/listing improvements correlated with buyer behavior.

CarUp:

- evidence coverage;
- discrepancy backlog;
- source availability;
- transfer completion;
- service/parts patterns;
- Passport engagement.

## AI allowed

- summarize;
- explain;
- surface relevant evidence;
- identify missing information;
- recommend next action;
- assist search/navigation.

## AI prohibited

- certify evidence;
- create official results;
- set ownership;
- directly set Trust;
- invent history;
- hide uncertainty.

## Gate

Every recommendation can point to its governed input/read model and is clearly advisory when not authoritative.

---

# V14 — External Source / Institutional Adapter Framework

## Goal

Standardize how CarUp incorporates government, insurer, lender, garage and other partner evidence.

## Adapter contract

Each adapter must define:

- provider/authority;
- legal/contract basis;
- request identity;
- response schema;
- source timestamp;
- match/no-record/adverse/unavailable semantics;
- evidence retention;
- retry;
- credential isolation;
- audit;
- privacy;
- user-visible wording;
- sandbox/live mode.

## Zimbabwe source domains

Potential future adapters include:

- CVR;
- ZINARA;
- VID;
- ZIMRA;
- CID/ZRP;
- insurers;
- finance;
- inspection providers.

## Gate

No adapter is called “live verified” until staging/runtime proof demonstrates real source connectivity.

---

# V15 — Mobile, Offline/Low-Bandwidth and Accessibility Parity

## Goal

Make Passport usable in the real Zimbabwe product context.

## Requirements

- responsive web;
- applicable native/mobile parity;
- low-bandwidth loading strategy;
- image/evidence progressive loading;
- accessible timeline and status semantics;
- keyboard/screen-reader support;
- no information conveyed by color alone;
- safe retry states;
- share/deep-link behavior;
- owner-critical actions available on compact screens.

Offline mutation support should be added only where conflict resolution and authorization are safe.

## Gate

Golden Vehicle owner and buyer journeys are complete on desktop and compact/mobile without semantic loss.

---

# V16 — Golden Vehicle Lifecycle Certification

## Goal

Prove the system as one product.

## Golden Vehicle script

A single Golden Vehicle should be taken through:

1. Seller starts with or detects existing Passport.
2. Vehicle identity is confirmed.
3. Seller adds commercial data.
4. Seller adds listing media.
5. Seller submits evidence.
6. A discrepancy is detected.
7. Discrepancy is resolved through governed workflow.
8. Trust evaluates from canonical evidence.
9. Seller previews buyer representation.
10. Vehicle publishes.
11. Buyer finds it in Marketplace.
12. Buyer opens Vehicle Detail.
13. Buyer opens public Passport.
14. Buyer sees the same Trust/evidence semantics.
15. Buyer sends inquiry.
16. Communications persists/delivers.
17. Transaction/reservation proceeds where enabled.
18. Vehicle is sold.
19. Ownership transfer starts.
20. Ownership transfer completes through the governed available workflow.
21. New owner opens the same Passport.
22. Historical listing remains historical, not current.
23. Garage/service record is added.
24. Mileage observation is added.
25. PartSentry/part record is added where applicable.
26. Passport timeline updates.
27. Trust re-evaluates only if the new governed evidence is a Trust input.
28. Communications sends a lifecycle notification where appropriate.
29. Intelligence provides a truthful next-best-action.
30. New owner later relists the same vehicle.
31. Marketplace uses the same canonical vehicle and Passport.
32. Previous-owner private data remains protected.

## Certification matrix

- API contracts;
- database constraints/migrations;
- security/RLS;
- evidence/privacy;
- Trust invariants;
- Communications;
- Intelligence;
- Marketplace;
- Seller;
- Verify;
- Home;
- service/PartSentry;
- ownership;
- desktop;
- mobile;
- accessibility;
- Playwright functional;
- visual regression;
- exact-head CI;
- exact-head staging;
- independent review;
- owner UAT;
- short soak.

## Gate

No P0/P1 unresolved in the Golden Lifecycle.

---

# 10. Design and experience requirements

Vehicle Passport must feel like a premium automotive record, not a generic admin dashboard.

## Visual hierarchy

Preferred order:

1. vehicle;
2. current state;
3. Trust/attention;
4. lifecycle;
5. evidence detail;
6. actions.

## Recommended product primitives

### Vehicle Identity Hero

- current vehicle media;
- make/model/year;
- identity context;
- ownership/listing state.

### Trust Lens

- canonical Trust;
- confidence;
- evidence basis;
- limitations;
- risk.

### Attention Rail

- required actions;
- recommended actions;
- due items.

### Lifecycle Timeline

- chronological;
- source-aware;
- expandable;
- category filters.

### Evidence Drawer/Gallery

- source;
- status;
- visibility;
- date;
- linked fact/event.

### Mileage Story

- observations over time;
- source markers;
- conflicts.

### Ownership Story

- privacy-safe owner/transfer chronology.

### Service & Parts Story

- jobs;
- mileage;
- garage;
- parts;
- evidence.

## Media rules

- real listing photos remain listing media;
- evidence images are identified as evidence only when admitted through evidence workflow;
- conceptual illustrations can explain how Passport works;
- no stock photo becomes a factual vehicle event;
- motion must not be required to understand Trust/history;
- mobile stacks calmly.

---

# 11. Communications integration contract

Passport does not choose providers directly.

It emits/consumes governed lifecycle events.

Communications decides:

- recipient;
- consent;
- preference;
- canonical notification/conversation;
- channel;
- template;
- retry;
- delivery state.

Examples:

**Evidence discrepancy detected → canonical event → owner notification → in-app/email/WhatsApp according to policy**

**Ownership transfer action required → canonical event → buyer/seller participants → canonical conversation/notification**

Never send a provider message first and attempt to reconstruct CarUp state later.

---

# 12. Intelligence integration contract

Instrument meaningful domain boundaries.

Do not instrument every keystroke.

Authoritative business events are server-emitted beside successful domain mutations.

Client events may describe non-authoritative interaction such as:

- Passport opened;
- timeline filtered;
- evidence detail opened;
- Trust explanation opened.

Server events include:

- evidence accepted;
- discrepancy resolved;
- ownership transfer completed;
- service record recorded;
- listing published.

Every user-visible Intelligence metric must have:

- metric definition;
- source events/records;
- owner;
- scope;
- privacy rule;
- missing/unavailable behavior.

---

# 13. Security, privacy and abuse controls

Passport is a high-value identity/history surface.

Mandatory controls:

- role/tenant authorization;
- owner relationship verification;
- server-side projection;
- lookup rate limits;
- anti-enumeration;
- audit of privileged reads/writes;
- secure evidence URLs;
- no public raw storage paths;
- no client-side filtering of private records;
- no previous-owner PII leakage;
- source credential isolation;
- provider webhook authenticity;
- append-only critical audit/provenance;
- correction without historical destruction;
- legal/consent basis for partner/institution sharing;
- deletion/privacy handling consistent with retained audit obligations.

High-risk capabilities require explicit threat-model tests.

---

# 14. Data quality and failure-state rules

Every field/read model must define behavior for:

- known value;
- null/missing;
- source not connected;
- source unavailable;
- stale;
- conflicting;
- rejected;
- pending;
- expired;
- not applicable;
- permission withheld;
- service failure.

Examples:

- no mileage source → “No governed mileage observation available”, not “0 km”;
- CID no record → not automatically “police cleared”;
- failed insurer API → “unavailable”, not “uninsured”;
- no service records → “No service records available to CarUp”, not “never serviced”;
- no damage evidence → “No governed damage information available”, not “accident free”.

---

# 15. Correction, dispute and provenance policy

A trustworthy Passport must support being wrong and being corrected.

Required workflow:

**claim/challenge → evidence → review/source confirmation → decision → authoritative record update/supersession → audit → Trust re-evaluation if relevant → updated projections → communication**

Never silently rewrite historical evidence or review decisions.

Material disputes may require:

- temporary warning state;
- restricted public claim;
- review ownership;
- evidence preservation;
- resolution reason.

---

# 16. External-provider activation policy

External integrations are not required to block the whole Passport if unavailable.

Core Beta may operate with:

- CarUp-reviewed evidence;
- source-not-connected states;
- sandboxed partner adapters;
- fail-closed actions.

But UI must remain honest.

Live activation requires:

- contract/legal basis;
- credentials;
- staging connectivity;
- test data;
- negative/adverse/no-record cases;
- timeout/retry behavior;
- audit;
- privacy;
- production authorization.

---

# 17. Migration and release safety

For every database change:

- additive first where possible;
- explicit Up/Down markers under repository migration conventions;
- no destructive production rewrite without reconciliation;
- no blind historical Trust recalculation;
- no provenance-destroying cascade;
- RLS/grants tested separately;
- indexes for timeline/read-model access;
- backfills source-aware and idempotent;
- no fake fixtures in production projections.

Production activation occurs only after explicit owner authorization.

---

# 18. Required phase receipts

Each phase deposits a receipt under:

**docs/vehicle-passport-lifecycle/receipts/**

Recommended files:

- V0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md
- V1_PASSPORT_READ_MODEL_CERTIFICATION.md
- V2_IDENTITY_CLAIM_ACCESS_CERTIFICATION.md
- V3_EVIDENCE_PROVENANCE_CERTIFICATION.md
- V4_VERIFICATION_DISCREPANCY_CERTIFICATION.md
- V5_TRUST_EXPLANATION_CERTIFICATION.md
- V6_LIFECYCLE_TIMELINE_CERTIFICATION.md
- V7_OWNERSHIP_TRANSFER_CERTIFICATION.md
- V8_SERVICE_PARTSENTRY_CERTIFICATION.md
- V9_OWNER_COCKPIT_CERTIFICATION.md
- V10_MARKETPLACE_BUYER_CONVERGENCE.md
- V11_SELLER_VERIFY_HOME_CONVERGENCE.md
- V12_COMMUNICATIONS_CERTIFICATION.md
- V13_INTELLIGENCE_AI_CERTIFICATION.md
- V14_EXTERNAL_ADAPTER_CERTIFICATION.md
- V15_MOBILE_ACCESSIBILITY_CERTIFICATION.md
- V16_GOLDEN_VEHICLE_LIFECYCLE_CERTIFICATION.md

Every receipt must contain:

- source/base SHA;
- exact candidate head;
- open PR/lane reconciliation;
- changed files;
- schema/migrations;
- authority contracts touched;
- tests;
- staging proof;
- visual evidence if UI;
- privacy/security results;
- unresolved findings;
- PASS/BLOCKED;
- next authorized phase.

---

# 19. Testing strategy

## Unit

- field-state semantics;
- projection;
- role policy;
- timeline normalization;
- Trust presentation;
- date/due logic;
- event mapping.

## Integration

- vehicle + evidence;
- evidence + verification;
- verification + Trust;
- Trust + Passport;
- Seller + Passport;
- Marketplace + Passport;
- service + Passport;
- ownership + Passport;
- domain event + Communications;
- domain event + Intelligence.

## Database

- foreign keys;
- uniqueness;
- append-only/audit behavior;
- RLS;
- grants;
- tenant isolation;
- migration apply/down/reapply where supported;
- provenance retention.

## E2E

- owner;
- buyer;
- seller;
- dealer;
- garage/mechanic;
- transfer;
- mobile.

## Visual

- desktop;
- tablet;
- compact mobile;
- long timeline;
- sparse/unknown-data vehicle;
- high-evidence vehicle;
- discrepancy state;
- private vs public projection.

## Failure testing

- external source unavailable;
- provider timeout;
- evidence missing;
- Trust stale;
- transfer conflict;
- Communications provider failure;
- Intelligence unavailable;
- partial service data.

---

# 20. Golden reference vehicles

At minimum use two Golden Vehicles.

## Golden A — evidence-rich

Designed to prove:

- identity;
- multiple evidence categories;
- meaningful Trust;
- ownership continuity;
- service;
- PartSentry;
- sale/transfer;
- relisting.

## Golden B — sparse/uncertain

Designed to prove:

- unknown remains unknown;
- low evidence does not receive flattering Trust;
- missing service does not mean no service history;
- source unavailable does not mean clear;
- publication and buyer language remain conservative.

A third adverse/conflict vehicle is strongly recommended for discrepancy/security certification.

---

# 21. Definition of Done

Vehicle Passport / Trust Lifecycle 1.0 is DONE only when:

> One physical vehicle can enter CarUp through Seller or owner identity, accumulate governed evidence and Trust, appear consistently in Verify/Marketplace/Home, communicate through canonical Communications, produce truthful Intelligence, survive sale and ownership transfer, accumulate service/PartSentry history, and later be relisted as the same vehicle — with role-safe projections and exact-head staging certification.

A pretty Passport page is not completion.

A Trust score is not completion.

A history timeline is not completion.

The complete lifecycle is the product.

---

# 22. Future-agent start protocol

Every future implementation agent MUST:

1. read this entire plan;
2. read DEPENDENCY_AND_AUTHORITY_MAP.md;
3. read MARKET_BENCHMARK_AND_DIFFERENTIATION_MATRIX.md;
4. read the latest receipt;
5. read the final/active Seller Journey canonical plan and receipts;
6. read Canonical Vehicle Truth / Trust contracts;
7. reconcile live main and all open implementation PRs;
8. confirm lane authorization;
9. identify the current phase;
10. change only the current phase scope;
11. preserve authority boundaries;
12. deposit an exact-head receipt before advancing.

No agent should restart this programme from first principles.

No agent should assume the planning-time SHAs are current.

No agent should interpret this document as permission to activate production.

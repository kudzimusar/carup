# Vehicle Passport / Trust Lifecycle 1.0 — Dependency and Authority Map

**Planning date:** 2026-08-28
**Canonical main at planning time:** ba208963d863654157335189c60f587cbe330041

## 1. Why this map exists

Vehicle Passport / Trust Lifecycle 1.0 sits across many already-built CarUp systems. That creates a high risk that a future implementation agent will duplicate a capability because it appears in several user journeys.

This document assigns **authority, contribution, projection and orchestration ownership**.

The core rule is:

> A surface may contribute governed observations to canonical Truth or consume canonical projections from it. It may not create a competing vehicle truth, competing Trust authority, competing conversation record or competing analytics truth.

---

## 2. Planning-time live programme anchors

These are evidence anchors, not permanent implementation bases. Live reconciliation is mandatory before runtime work.

| Programme / surface | Planning-time exact state | Relationship to Passport Lifecycle |
|---|---|---|
| Canonical main | ba208963d863654157335189c60f587cbe330041 | certified base at planning time |
| Post-Reunification plan PR #181 | 857d672abbe64ae8ac3651d4d94c71fddca74aa2 | governance and lane rules |
| Marketplace / Seller runtime PR #182 | abc11e9682a7140a9e3e60f995d9537ad4043b8a | active Seller/Marketplace contracts |
| Communications / Email PR #183 | 507530aadff17ec8aa4830d3cb392efda6876031 | communications horizontal layer |
| Intelligence plan PR #184 | 0ea51b58cb7c89286112546d8b3f588f157199fe | intelligence product contract |
| Intelligence runtime PR #185 | 0b9fa0304878b3d16210db55fb2a3f7f1261f65d | intelligence implementation candidate |
| Seller Journey docs PR #186 | e251ab2f2caa4aa944277ccc67e0f665d77ce739 | Seller → Passport dependency and phase receipts |

Future agents must replace this table with live evidence in V0.

---

## 3. Canonical authority stack

### Layer A — Vehicle identity authority

**Question:** Which physical vehicle is this?

Primary concepts:

- VIN as stable canonical vehicle identity where available;
- plate, chassis, engine and registration identifiers;
- aliases/history where identifiers change;
- duplicate/conflict detection;
- existing Passport reuse rather than duplicate creation.

Vehicle Passport MUST consume this identity. It may expose role-safe identifiers but may not invent a second identity key.

### Layer B — Truth / evidence authority

**Question:** What facts, observations and source records exist, and where did they come from?

Canonical concepts already present include:

- seller-stated facts;
- evidence assets and checksums;
- source metadata;
- OCR / extraction observations;
- government/compliance records;
- ownership records;
- mileage observations;
- service/inspection evidence;
- verification/review decisions;
- immutable/auditable provenance and history.

Truth must preserve distinctions such as:

- stated;
- observed;
- evidence-backed;
- reviewed;
- source-connected;
- unknown;
- unavailable;
- conflicting;
- expired;
- not applicable.

The Passport does not upgrade a statement into verified Truth merely by displaying it.

### Layer C — Trust authority

**Question:** What can CarUp responsibly conclude from governed evidence?

Canonical authority:

**backend/services/trustDecision/trustDecisionService.js**

The Canonical Vehicle Truth ADR already establishes that this is the sole Trust decision authority.

Protected principles:

- deterministic;
- auditable;
- versioned;
- reproducible;
- confidence separate from score;
- absence is never positive evidence;
- unknown is not false;
- public projection strips private dimensions;
- known limitations remain visible;
- vehicles.trust_score is only a materialized cache of the canonical decision and is not an independent authority.

Vehicle Passport MUST consume this decision. It MUST NOT create:

- a Passport-specific Trust score;
- a new weighted confidence algorithm in the UI;
- a green “verified” state derived from missing evidence;
- a client-side Trust band;
- an AI-computed verification decision.

### Layer D — Passport orchestration

**Question:** How does a human understand and act on Vehicle Truth and Trust across the life of the vehicle?

This is the primary authority of Vehicle Passport / Trust Lifecycle 1.0.

Passport owns:

- information architecture;
- lifecycle aggregation;
- role-scoped projection composition;
- owner/buyer/partner action surfaces;
- navigation into evidence, verification and history;
- next-required-action presentation;
- lifecycle continuity across listing, ownership and service;
- safe links into Communications, Marketplace, Seller, PartSentry and future partner workflows.

Passport does **not** become the source table for facts already owned elsewhere.

---

## 4. Surface-by-surface dependency map

| Surface / subsystem | What it contributes | What it consumes | What it MUST NOT own |
|---|---|---|---|
| Seller Journey | seller assertions, commercial listing data, media, evidence submissions, consent/privacy, sale state | canonical identity, verification state, publication readiness, Trust projection | canonical Trust, buyer truth, provider verification |
| Vehicle Passport | lifecycle orchestration, role-scoped experience, owner actions, timeline composition | identity, Truth, Trust, listing state, service, ownership, Communications, Intelligence | independent vehicle truth or Trust |
| Verify | lookup and verification-oriented projection | canonical public/protected vehicle projection, Trust/evidence state | duplicate Passport, new verification semantics |
| Marketplace | commercial public listing and buyer decision surface | public vehicle projection, listing state, canonical Trust, Passport links | vehicle identity, Trust calculation, evidence authority |
| Home | ecosystem explanation and routing | safe public projections and Marketplace inventory | Truth/Trust calculation or invented capability status |
| Communications | canonical conversation, notification, consent, channel selection, delivery/retry | governed Passport lifecycle events and user/vehicle context | vehicle Truth, Passport state authority |
| Intelligence | observations, metrics, rollups, recommendation, next-best-action | authoritative lifecycle/domain events and role-safe read models | business truth, Trust authority, ownership authority |
| Ownership lifecycle | ownership transfer records, transaction lifecycle events | canonical vehicle identity, seller/buyer authority, Passport continuity | new vehicle record on resale |
| Garage / Mechanic | governed service/work observations, diagnostics, mileage, evidence | owner permission, vehicle identity, relevant Passport context | arbitrary Trust mutations |
| PartSentry | parts identity, fitment, provenance/check state | vehicle identity, garage/service context | automatic “vehicle trusted” conclusion |
| SafeTrade / SafePay | reservation/payment/escrow/transaction facts | vehicle/listing/participant context | Trust score or ownership history without authoritative transfer |
| Finance / Insurance | governed applications/quotes/policies/claims where integrated | role-safe Passport/Trust context | direct mutation of core vehicle facts without governed adapters |
| Government / institutional adapters | source-specific official result/evidence when actually integrated | explicit request/context | broad “government verified” flag not tied to a source result |
| Mobile | parity projection and actions | same backend contracts as web | separate mobile Truth/Trust logic |

---

## 5. Seller dependency: activation rule

Seller Journey 1.0 is the immediate upstream authoring programme.

Its canonical target is:

**Sell → Vehicle Passport → Verify → Marketplace → Home → Communications → Intelligence → Transaction → Ownership lifecycle**

Passport Lifecycle MUST begin from the final accepted Seller contracts, not the planning-time branch.

Before V1:

1. confirm whether Seller S0–S12 completed;
2. identify the accepted Seller exact head;
3. confirm guest/auth continuity;
4. confirm existing Passport detection;
5. confirm seller-stated vs governed fact preservation;
6. confirm media vs evidence separation;
7. confirm publication readiness / listing quality / canonical Trust remain separate;
8. confirm sold / ownership-transfer handoff semantics;
9. identify unresolved Seller-to-Passport gaps;
10. record them in V0 rather than silently redesign Seller.

If Seller is incomplete, Passport work may proceed only in documentation, read-model analysis or non-conflicting prototype mode unless governance explicitly authorizes otherwise.

---

## 6. Marketplace and Home dependency

### Marketplace

Marketplace is a consumer of canonical Truth/Trust and a commercial projection of a currently available listing.

Passport must support Marketplace with:

- stable vehicle identity link;
- safe Trust summary;
- evidence/risk explanation entry point;
- ownership/service/history summary where public;
- clearly marked unknowns;
- truthful listing-to-Passport continuity.

Passport MUST NOT cause Marketplace to expose private evidence or operational source records.

### Home

Home is the sales/marketing/ecosystem front door. It should explain the Passport value and route users into Buy/Sell/Verify/Owner journeys.

Home may say things such as:

- understand what is known about a vehicle;
- keep vehicle history after purchase;
- connect service and evidence over time.

It may not claim:

- government verified;
- accident free;
- fully insured;
- duty cleared;
- clean history;

unless the canonical public projection supports the specific claim.

---

## 7. Communications dependency

CarUp Communications remains canonical.

Passport lifecycle events may include:

- passport_claim_started;
- passport_claim_completed;
- evidence_submitted;
- evidence_review_pending;
- evidence_verified;
- evidence_rejected;
- discrepancy_detected;
- discrepancy_action_required;
- discrepancy_resolved;
- trust_evaluated;
- trust_state_materially_changed;
- inspection_due;
- licence_due;
- insurance_due;
- service_due;
- recall_or_safety_action_available;
- ownership_transfer_started;
- ownership_transfer_action_required;
- ownership_transfer_completed;
- new_service_record;
- new_partsentry_record;
- vehicle_sold;
- passport_access_shared or access_revoked where governed.

Required pattern:

**Authoritative domain event → Communications policy → canonical notification/conversation → provider transport → delivery result**

Provider failure must not delete or become the canonical communication state.

---

## 8. Intelligence dependency

Intelligence observes the lifecycle and helps users act.

Examples of valid Passport Intelligence:

- Passport completeness trend;
- evidence coverage by category;
- time since last governed mileage observation;
- service interval guidance where supported;
- unresolved discrepancy age;
- ownership-transfer abandonment;
- buyer interest correlated with evidence completeness;
- listing performance before/after a governed improvement;
- service demand by vehicle type;
- parts failure/replacement patterns where data quality supports it;
- owner next-best-action.

Invalid patterns:

- clickstream becomes ownership truth;
- AI writes verified mileage;
- “no event received” becomes “no accident”;
- recommendation changes Trust;
- model prediction is displayed as an official inspection result;
- missing event count displayed as zero when collection is unavailable.

Every visible metric must trace to a governed event/read model.

---

## 9. PartSentry, garages and service-history dependency

The target provenance chain is:

**Vehicle → service/work order → garage/technician identity → mileage observation → part or service performed → PartSentry fitment/provenance where applicable → invoice/photo/evidence → review/source state → Passport timeline**

Important distinctions:

- service statement is not automatically verified;
- garage identity strength matters;
- part fitment is not vehicle-wide Trust;
- commercial invoice is evidence of a transaction, not proof the work was correctly performed;
- listing media and service evidence remain separate;
- owner-added DIY service may be recorded but must retain owner-stated provenance;
- dispute/correction history must be preserved.

---

## 10. Ownership lifecycle dependency

The Passport must survive commercial state changes.

Required continuity:

**not listed → draft listing → published → inquiry/reservation → sold → transfer pending → new owner confirmed → retained Passport → future service → future relisting**

Rules:

- a sale does not create a new vehicle;
- a relisting reuses the canonical vehicle;
- ownership records are append-only/history-preserving;
- previous owner private details are not automatically exposed to future owners/buyers;
- evidence remains subject to its visibility and legal basis;
- ownership transfer cannot be inferred solely from listing status = sold;
- transaction completion and authoritative ownership transfer are distinct states.

---

## 11. External-source dependency model

CarUp may integrate Zimbabwe and international sources over time, but every adapter must expose source reality honestly.

Source states must support at least:

- source_connected_and_match;
- source_connected_and_adverse;
- source_connected_no_record;
- source_unavailable;
- document_reviewed;
- pending_review;
- rejected;
- expired;
- unknown_not_connected;
- not_applicable.

Examples of Zimbabwe-relevant domains include:

- CVR registration / ownership;
- ZINARA licensing;
- VID roadworthiness / inspection;
- ZIMRA customs/import duty;
- CID/ZRP theft/clearance;
- insurance;
- service/repair evidence.

A manually reviewed official document is not the same as a live source-connected result.

---

## 12. Privacy and projection model

One canonical vehicle may have several projections.

### Public Passport

May expose:

- public vehicle identity;
- safe lifecycle summary;
- governed Trust/evidence summary;
- public-safe timeline entries;
- selected listing/service facts where policy permits.

### Buyer / transaction Passport

May expose additional due-diligence material authorized for the buyer/transaction context.

### Owner Passport

May expose:

- private documents;
- evidence management;
- personal reminders/actions;
- ownership-transfer controls;
- private service/insurance details where appropriate.

### Garage / partner projection

May expose only the information required for the authorized job, service or partner workflow.

### CarUp governance projection

May expose provenance, source metadata, review tasks, discrepancies, audit records and other internal governance information subject to staff authorization.

Projection is not duplication: all projections must derive from the same canonical records and policies.

---

## 13. Security dependencies

Passport work must preserve or strengthen:

- RLS/grants;
- tenant isolation;
- participant/owner authorization;
- service-role-only operational tables;
- evidence asset access controls;
- secure upload/download;
- auditability;
- append-only provenance;
- no raw provider credentials in client payloads;
- no internal reviewer or IP metadata in public projection;
- no VIN/plate enumeration leaks beyond approved lookup policy;
- rate limits and abuse protection on Verify/Passport lookups;
- safe deletion/supersession without destroying provenance.

Issue-specific or successor security gates must be reconciled live at V0.

---

## 14. Dependency sequencing

Passport Lifecycle runtime work should not begin simply because this plan exists.

Preferred sequence:

1. Seller Journey reaches accepted closure.
2. Accepted Seller/Marketplace contracts are merged or otherwise chosen as canonical implementation base.
3. Active lane capacity is available.
4. V0 live reconciliation freezes authorities and remaining gaps.
5. Passport phases proceed in order, unless a phase receipt explicitly justifies a safe reordering.
6. Communications and Intelligence are paired at each meaningful business boundary, not bolted on at the end.
7. Garage/PartSentry and ownership integrations are activated only when their authoritative write paths are proven.
8. External government/partner integrations remain fail-closed and source-honest.
9. Final Golden Vehicle certification proves cross-surface lifecycle continuity.

---

## 15. Permanent anti-fork invariants

1. One physical vehicle → one canonical vehicle identity.
2. One authoritative fact record per governed fact class, with provenance.
3. One canonical Trust decision authority.
4. One public vehicle projection policy.
5. One canonical conversation system.
6. One governed analytics/event vocabulary.
7. One ownership history for the vehicle.
8. One global vehicle taxonomy.
9. Passport is orchestration, not a parallel database of “truth”.
10. Unknown remains unknown everywhere.

# CarUp Trade OS — T5 Container Marketplace & Multi-Corridor Compatibility Implementation Plan

**Status:** **`T5-USABLE` — OWNER ACCEPTED, FROZEN at `5079b0b3`** (see §18 below and master plan §40–§43)
**Date:** 2026-09-06
**Repository:** `kudzimusar/carup`
**Branch:** `feat/trade-os-client-demo-convergence`
**Draft PR:** `#207`
**Plan baseline:** branch head `53f3c7004ea5a48f6e245af9c1db03122eaaa3d1`
**Frozen runtime code SHA:** `5079b0b3b531a9cb03b852682cb426158b730d7d`
**Certification/docs descendant:** `4f7529eb094e6a3df418a3fb8235204d3dcc8291`
**Production:** NOT AUTHORIZED / MUST REMAIN UNTOUCHED
**Parent authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`
**Global design authority:** root `DESIGN.md`

---

## 0. Authority, purpose and use

This is a **bounded T5 implementation plan**, not a second Trade OS master plan.

It records the owner-approved commercial-transparency and multi-corridor architecture required before T5 implementation proceeds. The canonical Living Master Plan remains the programme authority. The first T5 execution cycle must reconcile this approved contract into the canonical master plan before runtime product code changes are made.

Every human or AI agent working on T5 must:

1. read the canonical Living Master Plan completely;
2. read this T5 plan completely;
3. inspect the current implementation before creating new schema or services;
4. use the roll-call checklists in this file rather than chat memory;
5. mark `[x]` only after implementation **and** required evidence exist;
6. use `[~]` for partial/started and `[ ]` for not started;
7. append dated execution receipts after each bounded cycle;
8. preserve T3 and T4 frozen semantics unless repo evidence proves a real compatibility defect;
9. keep production untouched;
10. stop at T5 — do not implement T6/T8/T9/T10/T11/T12/T13/T14/T15/T16/T17 functionality merely because this plan makes it compatible.

### T5 architectural objective

> **Make the existing Container Marketplace compatible with a multi-provider, multi-corridor, mode-neutral and commercially transparent Trade Journey without duplicating procurement, logistics, booking, shipment, evidence or Passport authorities.**

### The critical architectural correction

> **A customer's final destination must not be assumed to be the destination of the individual sailing on which they reserve capacity.**

A customer may want final delivery in Harare while the ocean sailing terminates in Beira, Durban or another gateway. T5 must make that composition possible without pretending the ocean sailing itself reaches Zimbabwe.

---

# 1. Product position that T5 must preserve

## 1.1 Platform north star

CarUp Trade OS remains a cross-border sourcing, logistics and transaction operating system connecting buyers, suppliers, shippers, logistics organisers and downstream operational partners through one governed trade journey.

Trade OS logistics is **not limited to automotive cargo**. Eligible logistics cargo may include vehicles, parts, household/personal effects, furniture/appliances, boxes, machinery/equipment and other lawful cargo supported by the relevant organiser/carrier.

## 1.2 Commercial launch wedge

The initial commercial proving ground is:

> **Japan → Zimbabwe and Southern African vehicle/automotive trade.**

That is a go-to-market focus, not a schema restriction.

CarUp's structural advantage comes from combining:

- Marketplace and Seller foundations;
- Vehicle Passport;
- Evidence/Drive;
- Parts and compatibility;
- Zimbabwe vehicle lifecycle;
- procurement RFQ;
- logistics RFQ;
- shared-container capacity;
- Communications;
- later rates, shipment, customs, reputation and Intelligence.

## 1.3 Competitive model

CarUp should not force one exporter/provider to own the whole journey.

The customer may eventually compose:

```text
Vehicle/source      → Supplier A
International freight → Provider C
Inspection          → Provider D
Clearing            → Provider F
Inland transport    → Provider H
```

**A provider wins only the service scope it quoted.** Selecting one supplier or logistics provider must never silently appoint that party to every later trade stage.

---

# 2. Existing authorities T5 must reuse

T5 is not a greenfield build.

| Concern | Existing authority / implementation | T5 rule |
|---|---|---|
| Procurement demand | `diaspora_import_orders` | Reuse; do not create a generic shadow Trade Order |
| Procurement offers | `diaspora_import_quotes` | Preserve one-request→many-offers history |
| Logistics demand | `diaspora_logistics_requests` | Reuse; procurement and logistics remain distinct origins |
| Logistics cargo | `diaspora_logistics_request_items` | Reuse; preserve measurement provenance/unknown semantics |
| Logistics offers | `diaspora_logistics_quotes` | Reuse; provider award is service-scope bounded |
| Sailing/container | `diaspora_container_shipments` | Extend carefully rather than replace |
| Capacity reservation | `diaspora_cargo_reservations` | Preserve APPROVED-only capacity truth |
| Shipment | `diaspora_shipments` | T11 authority; T5 must not become the tracker |
| Shipment events | `diaspora_shipment_stage_events` | T11 authority |
| Documents | `diaspora_trade_documents` + Evidence/Drive | T8 authority; T5 may only remain attachable |
| Trade fact provenance | `diaspora_trade_fact_observations` | Reuse for later measured/verified facts |
| Intake vocabulary/privacy | `tradeIntakeContract.js` + Intake 2.0 migrations | Reuse; richer T5 discovery must not widen private data |
| Communications | canonical Communications | Reuse; no second T5 inbox |
| Transaction Passport | `tradeTransactionPassportService.js` | Projection only; no second transaction authority |
| Vehicle identity | canonical Vehicle Passport/vehicle authority | Link only when cargo is a vehicle |
| Audit | canonical diaspora audit authority | Critical T5 mutations remain auditable |

### Permanent T4 rule

> **One identity → one authoritative transaction → one evidence trail → one event stream → many projections.**

T5 must not introduce `trade_transactions`, `trade_orders`, `trade_journeys` or another universal record merely to make the commercial model look unified.

The **Trade Journey** is initially a customer-facing composition of existing authoritative facts, not automatically a new source-of-truth table.

---

# 3. Repository findings that make this T5 change necessary

The following are measured implementation facts at the approved baseline and must guide T5.

## 3.1 Current sailing matching conflates final destination with sailing endpoint

`backend/services/diaspora/diasporaLogisticsRfqService.js` currently allows a provider to attach a sailing only when both request and container have the same origin country and the same destination country.

That supports simple direct routes such as:

```text
Japan → Zimbabwe
```

but rejects a legitimate multi-leg journey such as:

```text
Customer final destination: Harare, Zimbabwe
Ocean sailing: Yokohama, Japan → Beira, Mozambique
Later inland/transit leg: Beira → Forbes/Machipanda → Harare
```

This is the primary T5 architecture defect to correct.

## 3.2 Shipping mode vocabularies already drift

Intake 2.0 permits customer mode preferences including:

- `roro`;
- `shared_container`;
- `private_container`;
- provider recommendation.

The logistics quote service currently accepts:

- `shared_container`;
- `lcl`;
- `fcl`;
- `road`;
- `multimodal`;
- `other`.

There is no clean `roro` provider-offer value today.

T5 must establish a compatible mode contract without building the full RoRo commercial/booking system.

## 3.3 Discovery-critical sailing facts are partly metadata

The Container UI already captures facts such as:

- origin port/loading location;
- destination port/terminal;
- loading window;
- carrier/forwarder;
- booking/container reference;
- documentation requirements;
- participant/cargo notes.

Several are currently placed in `metadata` rather than structured queryable fields.

Intake 2.0 established the rule that validated/matched/queried/privacy-bearing facts should not be hidden in arbitrary JSON. T5 must normalize only the sailing facts genuinely required for discovery, matching or operator decisions.

## 3.4 Sailing creation currently means immediate publication

`createContainer()` currently writes `BOOKING_OPEN` immediately.

T5 requires an operator lifecycle where a sailing can be prepared as a draft, reviewed, then deliberately opened for bookings.

## 3.5 Legacy container status vocabulary reaches beyond T5 ownership

The historical container table includes statuses such as `LOADING`, `SHIPPED`, `ARRIVED` and `COMPLETED`.

T5 must not begin using those values as shipment truth simply because they exist. Loading belongs to T10; shipment/event truth belongs to T11.

## 3.6 Existing capacity kernel is hardened and must remain authoritative

Only `APPROVED` reservations consume capacity.

The database approval RPC serializes approvals, recomputes volume/weight under lock, rejects overfill and writes critical audit in one transaction.

T5 must extend around this kernel rather than replace it.

---

# 4. Canonical T5 concept boundaries

T5 must make the following distinctions explicit in schema, service contracts, UI and tests.

```text
FINAL CUSTOMER DESTINATION
≠
CORRIDOR
≠
CORRIDOR LEG
≠
TRANSPORT MODE
≠
SAILING / CAPACITY OPPORTUNITY
≠
RESERVATION
≠
SHIPMENT
```

## 4.1 Final customer destination

The customer's required outcome, e.g.:

```text
Harare, Zimbabwe
```

This remains a customer/request fact.

## 4.2 Corridor

A reusable route pattern connecting an origin market to the customer's destination market.

Initial benchmark candidates:

| Code | Working description | Planning status |
|---|---|---|
| `JP-BEI-ZW` | Japan → Beira → Zimbabwe | Initial benchmark candidate |
| `JP-DUR-ZW` | Japan → Durban → Zimbabwe | Initial benchmark candidate |
| `JP-DAR-ZW` | Japan → Dar es Salaam → regional transit → Zimbabwe | Research candidate; do not assume equivalence until measured |

No corridor may be hardcoded as globally cheapest, fastest or preferred.

## 4.3 Corridor leg

One ordered segment of a corridor.

Example:

```text
1. Yokohama → Beira          mode: ocean
2. Beira → Forbes/Machipanda mode: road/transit
3. Forbes → Harare           mode: road
```

A leg can later reference jurisdiction, expected documents, rate sources and operational providers without T5 becoming the authority for those downstream facts.

## 4.4 Transport mode

A mode is independent from corridor.

Future-compatible vocabulary may include where technically relevant:

- `roro`;
- `shared_container`;
- `private_container` / `fcl`;
- `lcl`;
- `road`;
- `rail`;
- `air`;
- `multimodal`;
- `other`.

T5 must not claim CarUp can execute every mode. The contract must merely avoid preventing those modes later.

## 4.5 Sailing / capacity opportunity

A real dated bookable transport opportunity, for example:

```text
Yokohama → Beira
40HC
booking cutoff: 2026-10-10
planned departure: 2026-10-18
21 CBM available
```

A sailing may cover one corridor leg, not the whole customer journey.

## 4.6 Reservation

A participant request for capacity on a specific sailing.

`REQUESTED` is not approved capacity.

`APPROVED` is the only state that consumes capacity.

## 4.7 Shipment

Actual transport movement and event history belong to the shipment authority in T11.

A planned sailing departure is not proof that cargo shipped.

---

# 5. Service scope contract

T5 must introduce or formalize the concept of **service scope** without inventing a second transaction authority.

A Trade Journey can be complete or partial.

Examples:

- Bring Your Own Vehicle;
- international freight only;
- shared-container capacity only;
- clearing only;
- inland delivery only;
- managed import.

A customer must not be forced to purchase the entire chain.

### Required rule

> **An accepted quote or booking applies only to the service scope explicitly offered/accepted.**

Selecting a vehicle supplier does not make that supplier the freight provider.

Selecting a freight provider does not make that provider the clearing agent or inland transporter.

---

# 6. Commercial compatibility T5 must preserve now

T5 does not implement the authoritative pricing engine, but it must avoid constraining it.

## 6.1 Multi-offer history

Existing one-request→many-offer behavior must remain intact.

Accepted, rejected, withdrawn and expired offers remain retained as governed commercial history where existing lifecycle rules allow.

## 6.2 Original money is permanent

Every quote must continue to preserve:

```text
original amount
original currency
```

T5 must not overwrite original money with USD.

## 6.3 FX boundary

The long-term architecture distinguishes:

- Reference FX — comparison/display;
- Transaction FX — actual settlement conversion;
- Customs FX — legally applicable customs valuation rate.

T5 does **not** implement the FX engine.

T5 requirement:

> do not create a schema or UI assumption that would prevent T6 from attaching immutable FX snapshots later.

No cross-currency “best price” comparison is authorized without T6 FX authority.

## 6.4 Cost taxonomy compatibility

Future cost lines may use common stage categories:

- Goods;
- Origin;
- Export;
- Origin Terminal;
- Main Carriage;
- Insurance;
- Transshipment;
- Destination Port;
- Transit;
- Import Customs;
- Regulatory;
- Clearing;
- Inland;
- Final Delivery;
- Finance;
- CarUp;
- Exceptions.

T5 may reference a canonical cost type where required for forward compatibility, but does not calculate or reconcile those costs.

## 6.5 CarUp revenue truth

Future classifications may include:

- pass-through cost;
- government duty;
- tax;
- partner charge;
- CarUp service fee;
- CarUp commission;
- permitted logistics margin;
- contingent cost.

Permanent rule:

> **CarUp must never label its own revenue as a third party's charge.**

Customer-facing disclosure policy belongs to later commercialization/legal review.

---

# 7. T5 implementation slices and roll-call

Implementation must proceed in the order below unless repository evidence justifies a documented dependency change.

## T5.0 — Governance reconciliation and frozen-baseline proof

**Goal:** make the approved strategy durable before runtime changes.

- [x] Re-read the full canonical Living Master Plan and this file.
- [x] Confirm exact branch head and clean working tree.
- [x] Confirm PR #207 is still Draft and production is untouched.
- [x] Confirm T3 remains frozen at `b446d8ea` semantics.
- [x] Confirm T4 remains frozen at `736f06c5` semantics.
- [x] Confirm current Intake 2.0 status and owner-UAT/freeze state; do not silently override it.
- [x] Amend the canonical Living Master Plan with the approved Commercial Transparency & Multi-Corridor Compatibility contract before runtime T5 changes.
- [x] Expand the canonical T5 checklist to match the approved exit gate in this file.
- [x] Record a dated execution entry.

**Exit:** documentation authority is reconciled; no competing plan exists.

---

## T5.1 — Current T5 authority/schema audit

**Goal:** prove what can be reused before adding schema.

Inspect at minimum:

- `diaspora_container_shipments`;
- `diaspora_cargo_reservations`;
- `diaspora_logistics_requests`;
- `diaspora_logistics_request_items`;
- `diaspora_logistics_quotes`;
- `diaspora_shipments`;
- `diaspora_shipment_stage_events`;
- current RLS/policies/grants;
- container creation/listing/reservation/approval APIs;
- T3 sailing matching;
- all current container metadata usages;
- Intake 2.0 route/destination/mode fields;
- Passport projections;
- current staging fixture/certification architecture.

- [x] Inventory candidate fields currently hidden in container metadata.
- [x] Classify each as structured, metadata, later-phase or obsolete.
- [x] Identify whether a reusable corridor authority already exists anywhere else in the repo.
- [x] Prove no existing route/corridor table should be reused before creating one.
- [x] Produce authority map and migration proposal.

**Exit:** schema proposal is additive, minimal and evidence-based.

---

## T5.2 — Corridor reference contract

**Goal:** make multi-corridor composition possible without turning T5 into a rate/customs engine.

Preferred conceptual shape, subject to audit:

```text
CorridorDefinition
- id
- code
- display_name
- origin market/location scope
- final destination market/location scope
- active/effective state
- metadata only for genuinely non-queryable extras

CorridorLeg
- id
- corridor_id
- sequence
- origin location
- destination location
- mode compatibility
- jurisdiction/country
- optional operational notes
```

Rules:

- [x] Corridor definitions own route composition only.
- [x] They do not own carrier rates.
- [x] They do not own tax/customs law.
- [x] They do not own shipment status.
- [x] They do not declare a preferred corridor.
- [x] A corridor supports ordered legs.
- [x] A sailing can reference the applicable corridor/leg without claiming to complete the whole journey.
- [x] Future corridors can be added without schema redesign.
- [x] Historical transactions retain the corridor/leg references used at the time where applicable.

**Exit:** Harare final destination can legitimately use a Beira/Durban/Dar ocean gateway without changing the customer's final destination to that port country.

---

## T5.3 — Sailing identity and lifecycle normalization

**Goal:** turn the current container record into a coherent bookable sailing/capacity opportunity without replacing the hardened capacity authority.

Normalize only facts needed for discovery/matching/operator decisions, potentially including after audit:

- origin port/loading location;
- destination port/terminal;
- corridor/leg reference;
- booking cutoff;
- loading window;
- planned departure;
- expected arrival when provider-stated;
- container type;
- total volume;
- max weight;
- cargo eligibility policy;
- carrier/forwarder identity when actually recorded;
- booking/container reference;
- documentation requirement summary where appropriate.

Lifecycle target:

```text
DRAFT
→ BOOKING_OPEN
→ BOOKING_CLOSED
or CANCELLED
```

- [x] Creating a sailing no longer necessarily publishes it immediately.
- [x] Only authorized operator authority may open/close/cancel it.
- [x] `LOADING`/`SHIPPED`/`ARRIVED` legacy values are not used as T5 shipment truth.
- [x] Unknown carrier/reference/arrival facts remain unknown.
- [x] No fake sailings or default ETAs.

**Exit:** operator can prepare, review and deliberately publish a real sailing.

---

## T5.4 — Corridor-aware sailing discovery and eligibility

**Goal:** replace direct final-country equality with truthful multi-leg compatibility.

Current anti-pattern to remove:

```text
sailing.destination_country == customer.final_destination_country
```

Target logic must consider separately:

- customer's final destination;
- candidate corridor;
- applicable sailing leg;
- booking window/cutoff;
- service mode compatibility;
- cargo class/handling declarations;
- known volume/weight where required;
- actual available capacity;
- operator cargo policy.

Rules:

- [x] Matching never auto-books or auto-approves.
- [x] Matching never invents an inland leg.
- [x] A corridor recommendation is not yet a T5 pricing recommendation.
- [x] A route match is not proof of regulatory eligibility.
- [x] Customer declarations remain customer-stated until authority confirms them.
- [x] Unknown dimensions may prevent capacity reservation while still allowing the request to exist.

**Exit:** valid gateway sailings can be surfaced for Zimbabwe final destinations without false direct-route claims.

---

## T5.5 — Mode compatibility reconciliation

**Goal:** stop T5 from encoding container-only transport assumptions into the shared contract.

- [x] Reconcile Intake and logistics-offer mode vocabularies.
- [x] Support `roro` as a representable mode where appropriate.
- [x] Keep `shared_container`, `private_container/fcl`, `lcl`, `road`, `multimodal`, and future modes semantically distinct.
- [x] Container Marketplace only books capacity for modes it actually operates.
- [x] No RoRo booking/rate integration is implemented merely to satisfy vocabulary compatibility.
- [x] UI uses ordinary customer language first; freight terminology may be explanatory, not required knowledge.

**Exit:** mode no longer forces corridor or vice versa.

---

## T5.6 — Participant booking workspace and service-scope composition

**Goal:** make booking one coherent stage of the Trade Journey rather than a separate disconnected feature.

Participant needs:

- discover suitable real sailings;
- understand route leg vs final destination;
- see organiser/business identity;
- see known departure/cutoff/terminal facts;
- understand remaining capacity;
- understand what service is and is not included;
- request space;
- see `REQUESTED` vs `APPROVED` clearly;
- continue through the same Passport/transaction context.

Rules:

- [x] Procurement-origin continuation remains linked without re-entry.
- [x] Logistics-origin transaction remains first-class with no manufactured procurement order.
- [x] Capacity provider is not automatically clearing/inland/delivery provider.
- [x] Vehicle Passport links only for vehicle cargo.
- [x] Existing Communications remains canonical.
- [x] Existing evidence/document authorities remain canonical.

**Exit:** user understands which part of the journey this booking covers and what still remains.

---

## T5.7 — Capacity, manifest, exceptions and release semantics

**Goal:** preserve the hardened capacity invariant while making the operator product complete.

- [x] `REQUESTED` consumes 0.
- [x] `APPROVED` consumes exactly the approved volume once.
- [x] concurrent approval cannot overfill volume.
- [x] configured weight capacity cannot be exceeded.
- [x] reject/cancel releases capacity.
- [x] replay is idempotent.
- [x] manifest shows participant-safe cargo context.
- [x] estimated vs authoritative/measured values remain distinguishable.
- [x] operator sees exceptions/readiness without fabricated downstream state.
- [x] booking closure means bookings closed only — not loaded/shipped/customs/delivered.

### Standing logistics request lifecycle gap

The existing known gap remains:

> a procurement-linked live logistics request cannot currently be cancelled/closed through the customer product, so the one-live-continuation slot cannot be intentionally released.

During T5 audit, classify deliberately:

- [x] whether this becomes required T5 booking/lifecycle work; or
- [x] whether it remains a separately scheduled pre-production logistics-lifecycle task.

Do not let it disappear from the plan.

**Exit:** capacity and booking lifecycle are operationally safe and understandable.

---

## T5.8 — Discovery boundaries, privacy and anti-bypass

**Goal:** support useful marketplace discovery without weakening private transaction authority.

- [x] Auth identity remains server-derived.
- [x] Tenant/business authority remains server-verified.
- [x] Commercial profile never self-grants security authority.
- [x] Cross-tenant discovery uses an explicit safe projection.
- [x] New corridor/sailing fields are invisible unless explicitly allow-listed.
- [x] Pickup/delivery addresses and contacts remain private until authorized operational stage.
- [x] VIN remains governed.
- [x] Private metadata/internal ids/storage paths never leak.
- [x] Operator may mutate only sailings/reservations within governed scope.
- [x] User cannot reserve/approve in a manner that bypasses provider/operator authority.
- [x] Public/qualified discovery boundary and anti-bypass policy are explicit.

Mandatory adversarial cases:

1. anonymous;
2. unrelated user;
3. wrong tenant;
4. spoofed role/tenant;
5. public/qualified projection vs private record;
6. provider attaching another operator's sailing;
7. participant reading another participant's booking;
8. unauthorized approval;
9. overfill/concurrency;
10. private Intake fields;
11. VIN leakage;
12. unreadable vs empty state.

**Exit:** corridor expansion does not widen private data access.

---

## T5.9 — UI/UX and responsive product convergence

Root `DESIGN.md` remains the authority.

The product should explain the journey before feature names.

Critical UI truth:

```text
Your destination: Harare, Zimbabwe
Ocean leg: Yokohama → Beira
Then: inland/transit leg required to Zimbabwe
```

not:

```text
Destination: Mozambique
```

when the customer's requested outcome is Zimbabwe.

- [x] One primary action per decision region.
- [x] DRAFT / OPEN / REQUESTED / APPROVED / CLOSED are human-readable.
- [x] planned vs actual facts are visually distinguishable.
- [x] no card wall that hides journey composition.
- [x] desktop/tablet/mobile layouts are deliberate.
- [x] full-page screenshots reviewed by eye.

Geometry gate on all T5 operating routes:

```text
document.documentElement.scrollWidth <= window.innerWidth + 1
body.scrollWidth <= window.innerWidth + 1
```

Required widths:

- 393×852;
- 820×1180;
- 1024×768;
- 1280×800;
- 1366×768;
- 1440×900;
- 1536×864.

**Exit:** users can understand final destination, corridor leg, sailing and booking state without knowing internal architecture.

---

## T5.10 — Staging certification and owner UAT

**Goal:** prove the actual deployed product against real staging Postgres, not mocks alone.

Fresh isolated synthetic fixtures must prove at minimum:

### A. Direct/shared-container case

```text
Japan → destination served directly by sailing
request → provider/sailing → space REQUESTED → operator APPROVED
```

### B. Multi-corridor gateway case

```text
Final customer destination: Harare, Zimbabwe
Selected corridor: JP-BEI-ZW or JP-DUR-ZW
Sailing leg: Japan → gateway port
Capacity reservation on that sailing
Passport still preserves Harare as final outcome
No fake inland/customs completion
```

### C. Logistics-origin case

```text
user already owns cargo
→ Ship something
→ suitable corridor/sailing
→ booking
```

with no procurement order manufactured.

### D. Procurement-origin case

```text
supplier award
→ continue shipping without re-entry
→ candidate corridor/sailing
→ booking
```

### E. Capacity truth

- REQUESTED consumes 0;
- APPROVED consumes once;
- rejected/cancelled reservation releases;
- concurrent overfill refused;
- run-scoped fixtures leave no inherited capacity.

### F. Security/privacy

- safe marketplace projection;
- unrelated/anonymous denied;
- provider/tenant boundaries;
- no private Intake field leakage.

### G. Responsive proof

All seven contracted widths plus full visual review.

### Required evidence

- exact code head;
- exact docs head;
- FE deployed URL + served bundle;
- BE `/api/health` SHA;
- staging DB identity;
- migration ledger if schema changed;
- test/gate results;
- screenshots;
- console/network review;
- production untouched proof.

Automation can recommend PASS/FAIL but does not replace owner product UAT.

**Exit:** owner records T5 verdict.

---

# 8. T5 exit gate — expanded compatibility contract

T5 is not complete until every applicable row is proven.

## Architecture

1. [ ] Procurement and logistics remain distinct authoritative origins.
2. [ ] No universal shadow Trade Order/Trade Journey authority is introduced.
3. [ ] One request may retain multiple competing offers.
4. [ ] An accepted offer appoints a provider only for its scoped service.
5. [ ] Container/capacity remains an independent service component.

## Corridor

6. [ ] Customer final destination is distinct from individual sailing/leg endpoints.
7. [ ] Reusable corridor definitions can contain ordered legs.
8. [ ] No corridor is globally hardcoded as preferred.
9. [ ] Corridor and transport mode are independent.
10. [ ] New future corridors require data/configuration, not schema redesign.

## Mode

11. [ ] Shared contracts can represent RoRo/container/LCL/FCL/road/multimodal concepts without claiming T5 operates them all.
12. [ ] Container Marketplace books only modes/capacity it actually governs.

## Commercial compatibility

13. [ ] Every quote preserves original amount and currency.
14. [ ] T5 performs no cross-currency normalization without T6 authority.
15. [ ] Sale Incoterm and CarUp service scope cannot be conflated.
16. [ ] Future cost-category/evidence references can attach without copying facts.
17. [ ] No opaque T5 rate engine or invented all-in landed cost exists.

## Sailing/capacity

18. [ ] Discovery-critical sailing facts are structured/queryable where justified.
19. [ ] Sailing can exist as DRAFT before opening.
20. [ ] REQUESTED capacity consumes zero.
21. [ ] APPROVED capacity consumes exactly once.
22. [ ] Rejection/cancellation releases capacity.
23. [ ] Concurrent approval cannot overbook.
24. [ ] Weight and volume remain separate constraints.
25. [ ] Physical/container fit is never inferred from CBM alone.

## Truth/security

26. [ ] Public, participant and operator projections remain different.
27. [ ] Customer declarations are never interpreted as carrier acceptance.
28. [ ] Planned departure is not shown as shipped.
29. [ ] Expected arrival is not shown as arrived.
30. [ ] T8/T9/T10/T11/T12/T13 facts can attach later without redesign.
31. [ ] Intake private data remains private.
32. [ ] Vehicle Passport is linked only for vehicle cargo.
33. [ ] Production remains untouched.

**T5 verdict vocabulary:**

- `T5-PARTIAL` — implementation exists but required technical/staging/owner evidence is incomplete;
- `T5-USABLE` — full T5 exit gate proven and owner UAT accepted;
- never call T5 production-ready merely because it is T5-USABLE.

---

# 9. T5 non-goals / phase firewall

T5 must **not** implement the following merely because the architecture references them:

- live freight-rate engine;
- USD normalization engine;
- official FX provider integration;
- landed-cost calculator;
- corridor winner/recommendation scoring;
- authoritative customs/tax calculations;
- import-eligibility legislation engine;
- full Incoterm engine;
- carrier tracking integration;
- AIS;
- Freightos/project44/Vizion production integration;
- warehouse actual measurements;
- loading/vanning;
- shipment-event ingestion;
- customs/border release;
- payment/escrow settlement;
- provider reputation scoring;
- savings claims;
- profitability analytics;
- automatic shared-container optimization.

Those remain in governed later phases.

---

# 10. Revised phase ownership after T5

| Phase | Approved responsibility |
|---|---|
| **T5** | Corridor-compatible sailing/capacity discovery, operator lifecycle, booking/manifest, service-scope composition, security boundaries |
| **T6** | Rate sources, FX snapshots, cost taxonomy authority, quote normalization, landed-cost estimation, corridor economics, deterministic Shipping Mode/Corridor Advisor |
| **T7** | Full procurement/logistics/container/exception conversation lifecycle |
| **T8** | Documents, evidence, cost-document proof, verification/presence |
| **T9** | Yard/intake, actual measurement observations, storage/readiness |
| **T10** | Consolidation/load plan, vanning/loading evidence, seal/reference, left-behind cargo |
| **T11** | Shipment authority, normalized event ledger, carrier/API adapters, customer/operator timelines |
| **T12** | Eligibility, customs valuation, duty/tax, transit/customs rules, destination operations |
| **T13** | Payment/escrow milestones, financial reconciliation, disputes |
| **T14** | Supplier/logistics reputation from governed outcomes |
| **T15** | Corridor performance, savings evidence, quote accuracy, cost variance and Trade Intelligence |
| **T16** | AI assistance/recommendation over deterministic authorities; no autonomous authority |
| **T17** | Subscriptions, fees, commissions, margins, partner commercial models, enterprise operations |
| **T18** | Full end-to-end certification and explicit production authorization |

---

# 11. Research gate before authoritative T6 pricing

T5 should leave T6 with a research-ready architecture, not invented economics.

Use a controlled comparable benchmark:

```text
same vehicle
same Japanese origin
same final Zimbabwe destination
same quote period
same defined service scope
```

Benchmark corridor candidates:

- `JP-BEI-ZW`;
- `JP-DUR-ZW`;
- `JP-DAR-ZW` as a research candidate until direct Zimbabwe commercial evidence supports equivalence.

Every collected quote should retain:

- source/provider;
- original currency;
- validity;
- service scope;
- route/corridor;
- mode;
- inclusions;
- exclusions;
- mandatory external charges;
- contingent charges;
- timing assumptions;
- evidence/document source;
- final actual cost if the journey is completed.

Research questions:

- where do margins accumulate?
- which fees are mandatory vs avoidable?
- which corridor wins for the same comparable scope?
- which providers expose hidden extras?
- which stages benefit most from competition?
- what utilization is needed to improve shared-container economics?
- what coordination cost does CarUp actually incur?
- what CarUp fee remains contribution-positive while still improving the customer outcome?

Unanswered questions remain tracked assumptions, not product constants.

---

# 12. Permanent Truth & Transparency rules carried into T5

1. No hidden CarUp fee inside a third-party charge.
2. No estimated price presented as actual.
3. No current FX rate retrospectively rewriting historical commercial truth.
4. No duty/tax rule without jurisdiction, source and effective period when that phase arrives.
5. No corridor presented as universally optimal.
6. No carrier/AIS inference represented as confirmed cargo truth.
7. No customs-clearance event without attributable authority.
8. No deletion of competing quote history required for later Intelligence unless lifecycle/privacy law requires it.
9. No duplicated charge when an Incoterm/bundled scope already includes it.
10. No savings claim without comparable evidence.
11. No requirement to buy the vehicle on CarUp in order to use Trade OS logistics.
12. No external provider becomes the permanent Trade OS source of truth.
13. Unknown is a legitimate state and must never be converted to zero merely to render a complete-looking screen.
14. A customer declaration is not a carrier, warehouse, customs or verification fact.
15. A booking is not a shipment.
16. A sailing endpoint is not necessarily the customer's final destination.

---

# 13. Regression protection

T5 must prove it does not regress:

- T2 procurement RFQ marketplace, multi-quote history and privacy;
- T3 logistics RFQ, provider eligibility, offer award and capacity conversion;
- T3 frozen APPROVED-only capacity semantics;
- T4 procurement/logistics Passport origins and no-shadow-authority rule;
- Intake 2.0 progressive disclosure, private-field allow-lists and provenance;
- Communications canonical routing;
- Vehicle Passport privacy/authority;
- Evidence/Drive separation;
- unavailable-vs-empty truth semantics;
- responsive geometry;
- current deployment-pairing/provenance discipline.

No T5 correction is acceptable if it obtains multi-corridor flexibility by loosening tenant, privacy, audit or Truth & Trust controls.

---

# 14. Required implementation receipts

Each bounded T5 cycle must append a dated execution note to the canonical master plan and maintain a T5 receipt under `docs/trade-os/receipts/` once implementation begins.

The final receipt must include:

- starting head;
- code head;
- docs head;
- schema changes;
- authority decisions;
- migration application environment;
- production untouched proof;
- backend/unit/integration counts;
- real-Postgres constraint results;
- CI gate execution proof;
- deployed FE URL and bundle;
- deployed BE SHA;
- FE/BE pairing evidence;
- fresh E2E fixture references;
- security/adversarial matrix;
- seven-width geometry matrix;
- screenshots;
- owner findings and disposition;
- final `T5-PARTIAL` or `T5-USABLE` verdict.

---

# 15. Claude / implementation-agent operating order

Once the owner authorizes T5 implementation, the agent must execute in this order:

```text
1. read canonical master plan + this plan
2. reconcile the approved contract into the canonical master plan
3. prove baseline / freeze / production state
4. audit current T5 authorities and metadata
5. propose the smallest corridor-compatible schema
6. implement corridor reference + sailing lifecycle first
7. replace direct final-destination equality with corridor/leg compatibility
8. reconcile mode vocabulary without building later-phase rate/booking integrations
9. converge participant/operator UI around the new model
10. preserve capacity kernel and harden release/exception semantics
11. run adversarial + real-Postgres + regression gates
12. deploy exact candidate to staging
13. certify direct and multi-corridor journeys with run-owned fixtures
14. run desktop/tablet/mobile product UAT
15. record owner findings
16. correct blocking T5 issues only
17. mark T5-USABLE only after owner acceptance
18. freeze T5 and STOP
```

Do not start T6 automatically.

---

# 16. Owner decision recorded

**Decision:** APPROVED.

The commercial-transparency and multi-corridor strategy is accepted with the reviewed corrections in this plan.

T5 may now be prepared for implementation against this contract after the required canonical-plan reconciliation/preflight.

**Production remains NOT AUTHORIZED.**


---

# 17. Implementation closure — 2026-09-06

**All slices implemented. `T5-PARTIAL` — owner acceptance is the only open row.**

Every `[ ]` above is now `[x]`: T5.0–T5.9 implemented and T5.10 certified twice — once at
`84b6de3a`, then re-certified end to end after the final product/performance closure on the
paired candidate `5079b0b3`.

**Where the evidence lives**

- Contract reconciliation → master plan **§40**
- Implementation + first certification → master plan **§41**
- Final product/performance closure + owner-UAT proxy → master plan **§42**
- Receipt → `docs/trade-os/receipts/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR.md`

**The four §41 findings are closed:** F1 (publish no longer blocks on discovery — 13–14s → 6.1s
with the page usable while discovery is pending), F2 (discovery is bounded: 7 queries at 1, 10 and
50 sailings; ~5.6s → ~2.34s median and flat), F3 (both route strategies disclosed as named
categories with no ranking), F4 (certification data repaired, product semantics untouched). F5 is
preserved and still mutation-guarded.

**Non-goals held.** No rate engine, FX, landed cost, corridor economics or recommendation scoring;
no customs/tax; no shipment tracker; no warehouse/loading; no settlement; no reputation; no RoRo
commercial integration. `LOADING`/`SHIPPED`/`ARRIVED` are not used as T5 truth.

**Verdict:** `T5-PARTIAL` — recommended owner action **freeze as T5-USABLE**. T6 NOT started.
Production NOT touched. PR #207 remains Draft.

---

# 18. Owner acceptance and freeze — 2026-09-06

**T5 IS ACCEPTED. Owner verdict: `T5-USABLE`. T5 is FROZEN at `5079b0b3`.**

§17 above records the implementation closure and remains the chronological account of the
`T5-PARTIAL` state that preceded this decision. It is deliberately not rewritten.

| | |
|---|---|
| Frozen runtime code SHA | `5079b0b3b531a9cb03b852682cb426158b730d7d` |
| Certification/docs descendant | `4f7529eb094e6a3df418a3fb8235204d3dcc8291` (docs-only descendant; three documentation files, no runtime code) |
| FE / BE | both paired on **`5079b0b3`** |
| PR #207 | remains **Draft** |
| Production | **untouched**, and **NOT AUTHORIZED** |
| T6 | may now be planned/implemented under its own canonical phase contract |

**Technical and product-proxy gates passed** — the full matrix is in master plan §43.

**F1–F5 disposition:** F1 closed (publish no longer blocks discovery; 13–14 s → 6.1 s), F2 closed
(N+1 removed; 7 queries at 1/10/50 sailings), F3 closed by disclosure without ranking, F4 closed as
certification data only, F5 preserved and still mutation-guarded.

**Accepted residual:** the ~6.1 s staging transition is accepted as non-blocking
platform/performance debt — discovery no longer blocks the page, matching is asynchronous, the N+1
is gone, query count is bounded, and **no T5 invariant depends on the latency**.

**Boundary that still stands:** *T5 is NOT production-ready merely because it is `T5-USABLE`.*
Production readiness is a separate, explicitly-authorized gate (T18).

**STOP T5.**

# CarUp Diaspora Trade OS System Plan

> **Status:** CANONICAL REVIEW DRAFT — 2026-09-13  
> **Current delivery context:** T5  
> **Implementation authorization:** This document is a planning contract. No new product code, migration, staging mutation, production activation, live-money behavior, or external integration is authorized until owner review and explicit approval.  
> **Detailed companion plan:** [`CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md`](./CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md)

---

## 1. Purpose

CarUp Trade OS is the operating layer for cross-border automotive trade, beginning with Japan-to-Southern-Africa vehicle and auto-parts journeys and expanding through governed corridor, provider, logistics, compliance, payment, ownership, and service workflows.

The goal is not to build another used-car exporter, another listing site, another freight tracker, or another spreadsheet application.

The goal is to give buyers, sellers, exporters, logistics providers, clearing agents, dealers, and enterprise operators one auditable system in which they can:

```text
Discover / Request
→ Compare
→ Verify
→ Buy / Procure
→ Prepare
→ Ship
→ Transit
→ Clear
→ Deliver
→ Own
→ Service
→ Resell
```

The Trade OS must connect commercial, physical, regulatory, financial, document, and trust state without allowing any one spreadsheet, partner, AI model, external API, or operator to become an uncontrolled source of truth.

---

## 2. Product North Star

CarUp should become:

> **An open, verified marketplace and Trade Operating System for cross-border vehicle and automotive trade.**

The strategic distinction is:

> **A traditional exporter sells the customer its own solution. CarUp allows the market to compete to produce the customer's best complete trade outcome.**

CarUp should therefore support:

- inventory discovery;
- buyer-led RFQs;
- seller/exporter competition;
- parts procurement;
- freight competition;
- corridor comparison;
- partial-service journeys;
- shared capacity/container aggregation;
- transparent cost decomposition;
- governed FX and customs treatment;
- shipment visibility;
- evidence and document custody;
- milestone payments and reconciliation;
- provider performance;
- persistent Vehicle Passport / evidence history.

CarUp does not need to beat every major exporter at being a major exporter. It needs to make the surrounding trade journey more competitive, composable, transparent, and accountable.

---

## 3. Permanent Truth & Trust Principles

The following principles govern every Trade OS phase.

1. **No hidden CarUp fee inside a third-party charge.**
2. **No estimate presented as a confirmed or actual cost.**
3. **No current FX rate silently rewriting historical monetary truth.**
4. **No customs/tax/regulatory rule without jurisdiction, provenance, and effective date when authoritative.**
5. **No route assumed to be globally optimal.**
6. **No AIS/provider inference represented as confirmed cargo truth without supporting evidence.**
7. **No customs or compliance event without an attributable source.**
8. **No deletion of competing quotes merely because one quote is selected.**
9. **No duplicate charge where a commercial term already includes it.**
10. **No claim that CarUp saves money without comparable evidence.**
11. **No requirement that a user buy a vehicle on CarUp in order to use Trade OS logistics services.**
12. **No external provider becomes the permanent Trade OS source of truth.**
13. **No spreadsheet bypasses the authoritative service layer.**
14. **No AI command bypasses authorization, approval, ledger, or state-transition rules.**
15. **No test fixture is allowed to masquerade as production commercial or regulatory truth.**

---

## 4. Current CarUp Foundation

The repository already contains substantial diaspora/Trade OS foundations. Existing domains include:

- import orders;
- import quotes;
- trade profiles;
- trade documents;
- document extraction/OCR and verification;
- container shipments;
- cargo reservations;
- shipments and shipment-stage events;
- compliance reviews;
- payment milestones;
- reputation records;
- notification preferences;
- audit logs;
- workbook dry-run/import infrastructure;
- workbook XLSX generation/parsing/export;
- AI command boundaries;
- entitlement and drive integration scaffolding in later programme work.

Existing Trade OS table families include:

- `diaspora_import_orders`;
- `diaspora_import_quotes`;
- `diaspora_trade_profiles`;
- `diaspora_trade_documents`;
- `diaspora_trade_document_extractions`;
- `diaspora_trade_document_verifications`;
- `diaspora_container_shipments`;
- `diaspora_cargo_reservations`;
- `diaspora_shipments`;
- `diaspora_shipment_stage_events`;
- `diaspora_compliance_reviews`;
- `diaspora_payment_milestones`;
- `diaspora_reputation_records`;
- `diaspora_import_audit_log`;
- `diaspora_import_order_participants`;
- `diaspora_notification_preferences`.

New work must extend existing domain ownership rather than creating parallel order, event, payment, audit, or workbook systems.

---

## 5. Operating Modes

Trade OS should remain accessible through several compatible operating modes.

### 5.1 Online Account Mode

Users manage RFQs, quotes, supply, orders, documents, logistics, container reservations, payments, compliance, and shipment state directly through CarUp web/app surfaces.

### 5.2 Offline Workbook Mode

Users download governed templates, work offline, and upload them back. Workbooks are staging/exchange documents, not authoritative databases.

### 5.3 API / Enterprise Integration Mode

Enterprise partners may eventually connect through controlled APIs or mapped bulk-import channels while producing the same canonical Trade OS entities.

### 5.4 AI Command Mode

AI can propose or prepare actions but must never mutate authoritative state directly.

### 5.5 Scenario / UAT Mode

CarUp can exercise the same workbook and service contracts using controlled scenario packs in local/test/staging environments. This is a testing mode, not a shortcut around production governance.

---

## 6. Actor Model

Trade OS actors may include:

- buyer;
- seller;
- exporter;
- supplier;
- dealer;
- auction/procurement agent;
- yard/operator;
- inspection provider;
- freight forwarder;
- carrier;
- consolidator;
- clearing/customs agent;
- transit provider;
- inland transporter;
- insurance partner where permitted;
- CarUp operator;
- reviewer/compliance actor;
- enterprise partner.

Actor identity, role, tenant, capability, verification, geography, and authorization must remain explicit.

A provider may perform more than one role, but roles must not be inferred merely from a company name.

---

## 7. Customer / Service Segments

Customer segment and corridor are separate dimensions.

| Segment | Primary need |
|---|---|
| **CarUp Self-Serve** | Experienced importer selects individual services |
| **CarUp Assist** | Guided import workflow |
| **CarUp Managed Import** | CarUp coordinates most of the journey |
| **CarUp Dealer Pro** | Repeat/bulk importer tools |
| **CarUp Enterprise** | Fleet/organization procurement and integration |
| **CarUp Exporter OS** | Japan seller/exporter operations |
| **CarUp Trade Partner** | Logistics/service-provider operations |

A customer may also bring a vehicle or shipment acquired outside CarUp Marketplace.

---

# 8. Trade Journey and Service Scope

Trade OS must distinguish the **complete possible journey** from the **services a customer chooses to buy**.

A full journey may include:

```text
Vehicle / Parts Source
→ Origin Collection
→ Yard
→ Inspection / Export Readiness
→ Export Customs
→ Origin Terminal
→ Main Carriage
→ Transshipment
→ Destination Port
→ Transit Country
→ Border
→ Import Customs
→ Inland Transport
→ Final Delivery
```

But customers must be able to purchase only a subset.

Examples:

### Bring Your Own Vehicle

Customer already owns the vehicle and requests shipping/clearance/delivery.

### CarUp Ship

International freight only.

### CarUp Clear

Customs/clearing coordination only.

### CarUp Deliver

Port/border-to-destination delivery only.

### Managed Import

CarUp coordinates most available stages.

The data model must therefore preserve `TRADE_JOURNEY` separately from `SERVICE_SCOPE`.

---

# 9. RFQ and Multi-Provider Commercial Architecture

RFQ capability is a core Trade OS differentiator.

A buyer should be able to express demand without first selecting an existing Marketplace listing.

Examples:

- vehicle procurement RFQ;
- parts procurement RFQ;
- freight RFQ;
- container-capacity RFQ;
- inspection RFQ;
- clearing RFQ;
- transit RFQ;
- inland transport RFQ;
- enterprise/fleet RFQ.

One RFQ may receive multiple competing quotes.

Quotes must be retained with:

- provider;
- provider role/capability;
- service scope;
- route/corridor where relevant;
- original amount;
- original currency;
- validity;
- inclusions;
- exclusions;
- mandatory external costs;
- contingent costs;
- assumptions;
- lead time;
- evidence/source;
- status;
- accepted/rejected/expired outcome.

Accepting one quote must not erase the commercial history of competing quotes.

The final Trade Order may compose multiple providers, for example:

```text
Vehicle       → Supplier A
Inspection    → Provider B
Freight       → Provider C
Clearing      → Provider D
Delivery      → Provider E
```

Trade OS must not assume the vehicle seller automatically becomes the freight, customs, and delivery provider.

---

# 10. Workbook & Template Architecture

The workbook remains a first-class offline and enterprise bridge, but not the source of truth.

The workbook can serve as:

1. offline input;
2. RFQ exchange;
3. provider response surface;
4. export/report format;
5. bulk-edit surface;
6. migration/onboarding surface;
7. scenario/UAT fixture;
8. AI-command staging surface where governed.

## 10.1 Existing XLSX Foundation

The repository already contains a config-driven XLSX engine.

Canonical implementation surfaces include:

- `backend/constants/diaspora/diasporaWorkbookSchema.js`;
- `backend/constants/diaspora/diasporaWorkbookTemplates.js`;
- `backend/services/diaspora/workbook/diasporaWorkbookXlsxService.js`;
- workbook validation/persistence/import execution services;
- workbook upload-security controls.

The current generated template families include:

- `buyer`;
- `seller`;
- `supplier`;
- `enterprise`;
- `container_reservation`.

This supersedes the older three-template planning assumption.

The workbook parser already normalizes `.xlsx` into the same payload shape consumed by existing dry-run validation.

Do not create a second XLSX parser or a scenario-only workbook schema.

## 10.2 Template Rules

- stable canonical field keys;
- versioned schema;
- human help/instructions;
- controlled vocabulary/dropdowns where appropriate;
- hidden/protected references where appropriate;
- file/sheet/row/cell bounds;
- formula non-execution on import;
- formula injection neutralization on export;
- privacy warning;
- original values retained;
- role-appropriate fields only.

## 10.3 Role-Specific Expansion

Future focused templates may include:

- vehicle seller;
- parts supplier;
- freight provider;
- clearing agent;
- inland transport provider;
- consolidator.

They should be compositions/projections of canonical field definitions, not unrelated schemas.

---

# 11. Template Ingestion & Scenario Testing Architecture

The detailed contract is maintained in:

[`CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md`](./CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md)

This architecture is now part of the global Trade OS plan.

## 11.1 Two Data Layers

### Reference Data Packs

Reusable automotive/trade facts:

- vehicle reference;
- parts/fitment reference;
- geography/ports/borders;
- corridor candidates;
- partner capabilities;
- deterministic regulatory fixtures where tests require them.

### Scenario / Transaction Packs

Specific trade journeys:

- buyer demand;
- RFQ;
- supplier/provider responses;
- quote selection;
- container reservations;
- documents;
- shipment events;
- compliance;
- payments;
- exceptions.

Reference data and scenario transactions must not be conflated.

## 11.2 Canonical Ingestion Pipeline

```text
Template Generator
→ Workbook / Structured Input
→ Upload Security
→ XLSX Parser
→ Normalized Trade Payload
→ Structural Validation
→ Domain Validation
→ Business-Rule Validation
→ Dry-Run Diagnostics
→ Human Review
→ Draft Import
→ Authoritative Trade OS Service Layer
→ Audit / Event Ledger
→ Scenario Assertions / UAT
```

No workbook or test helper may become an alternate authoritative mutation channel.

## 11.3 Data Provenance

Imported/test data must preserve provenance such as:

- `SYSTEM_GENERATED`;
- `CARUP_TEMPLATE`;
- `LEGACY_WORKBOOK`;
- `BUYER_SUBMITTED`;
- `SELLER_SUBMITTED`;
- `SUPPLIER_SUBMITTED`;
- `LOGISTICS_PROVIDER_SUBMITTED`;
- `API_PROVIDER`;
- `GOVERNMENT_SOURCE`;
- `VERIFIED_DOCUMENT`;
- `TEST_FIXTURE`;
- `VERIFIED_SNAPSHOT`.

Source type and verification state must remain conceptually separate.

## 11.4 Golden Scenarios

The initial T5 scenarios are:

- `SCN-ALPHARD-HARARE-001` — vehicle RFQ / competing sellers;
- `SCN-PARTS-CONTAINER-001` — realistic parts procurement / supplier competition;
- `SCN-BYO-VEHICLE-SHIPPING-001` — partial journey / shipping-only.

These scenarios should persist and gain capabilities as later T-tracks are implemented.

---

# 12. Vehicle and Parts Identity

Vehicle and parts transactions share Trade OS workflow but require distinct identity models.

Do not flatten both into one generic mostly-null `ITEM` object.

## 12.1 Vehicle Identity

Potential attributes include:

- VIN/chassis;
- make/model/grade;
- year/manufacture date;
- engine;
- mileage;
- auction/condition attributes;
- dimensions/weight;
- freight profile;
- vehicle documents;
- Vehicle Passport link.

## 12.2 Parts Identity

Potential attributes include:

- OEM number;
- alternative/cross-reference numbers;
- manufacturer/brand;
- fitment;
- chassis/engine compatibility;
- quantity/UOM;
- condition/quality;
- dimensions/weight/CBM;
- packaging;
- hazmat classification;
- HS-code candidate;
- evidence/source.

The original Universal Motors parts workbook is useful as a rich legacy fixture source, not as unreviewed production truth.

---

# 13. Currency & FX Contract

USD is the intended canonical customer-facing comparison currency for Trade OS commercial views, but original currency must never be destroyed.

Every monetary record should ultimately distinguish:

- original amount;
- original currency;
- USD display/reference snapshot;
- reference FX rate/source/date;
- actual transaction/settlement FX where applicable;
- customs FX where applicable.

Three FX concepts must remain separate:

| FX type | Purpose |
|---|---|
| **Reference FX** | CarUp comparison/display |
| **Transaction FX** | Money actually exchanged/settled |
| **Customs FX** | Rate legally used by applicable customs authority |

Historical confirmed monetary records are immutable snapshots.

**T5 requirement:** preserve original money and schema compatibility.  
**T6 responsibility:** governed official/reference FX integration and conversion behavior.

---

# 14. Multi-Corridor Architecture

CarUp must not assume all Zimbabwe imports use Beira.

Initial competing corridor families include:

| Code | Route concept |
|---|---|
| `JP-DAR-ZW` | Japan → Dar es Salaam → regional inland transit → Zimbabwe |
| `JP-BEI-ZW` | Japan → Beira → Machipanda/Forbes → Zimbabwe |
| `JP-DUR-ZW` | Japan → Durban → Beitbridge → Zimbabwe |

A corridor is a reusable route template composed of legs.

Corridor and transport mode are different concepts.

Modes may include, where relevant:

- RoRo;
- private container;
- shared container;
- LCL;
- air;
- road;
- rail.

Trade OS should ultimately recommend rather than globally default.

Recommendation may later consider:

- expected landed cost;
- sailing/service availability;
- transit time;
- delay variance;
- storage exposure;
- port cost;
- inland cost;
- customs-value implications;
- provider availability;
- historical exceptions;
- shipment compatibility.

Corridor intelligence belongs primarily to T6+ and must use sourced/actual data rather than embedded assumptions.

---

# 15. Incoterms & Service Scope

Trade OS must separate:

- sale Incoterm;
- named place;
- Incoterm version;
- seller/buyer responsibility boundary;
- risk-transfer boundary;
- CarUp service scope.

Example:

```text
Vehicle Sale: CIF Beira
CarUp Service: Managed Beira-to-Harare coordination
Importer of Record: Buyer
Clearing Agent: Partner
```

The system must not falsely relabel that arrangement as DDP.

Incoterms allocate commercial responsibilities/risk; they are not universal customs-valuation formulas.

---

# 16. Rates, Costs & Landed-Cost Architecture

Every material cost should eventually be classifiable by journey stage and provenance.

Canonical stage families:

- goods/acquisition;
- origin pickup/yard;
- export;
- origin terminal;
- main carriage;
- insurance;
- transshipment;
- destination terminal;
- transit;
- import customs;
- regulatory;
- clearing;
- inland transport;
- final delivery;
- finance/payment;
- CarUp fee;
- contingent/exception costs.

Every cost record should eventually be able to answer:

- what is this charge?
- who charged it?
- who pays it?
- what currency was it originally quoted in?
- how was USD derived?
- what evidence supports it?
- is it estimated/quoted/confirmed/invoiced/paid/reconciled?
- is it included elsewhere?
- what is its customs-value treatment?
- what is its revenue treatment?

Cost lifecycle:

```text
INDICATIVE
→ QUOTED
→ CONFIRMED
→ INVOICED
→ PAID
→ RECONCILED
```

Revenue classification should distinguish at least:

- pass-through;
- government duty/tax;
- partner charge;
- CarUp service fee;
- CarUp commission;
- permitted logistics margin;
- contingent cost.

T6 owns the authoritative rate/FX/quote-normalization/landed-cost engine.

---

# 17. Shared Container & Capacity Marketplace

Trade OS should support aggregate logistics demand.

A `ContainerOpportunity` or equivalent domain should be capable of representing:

- corridor;
- departure window;
- container type;
- total capacity;
- reserved capacity;
- remaining capacity;
- participating orders;
- provider/coordinator;
- allocation method;
- booking lifecycle.

Customers may reserve capacity by the units supported by the operation, such as vehicle slot, CBM, weight, or another governed basis.

The economic objective is:

```text
Fragmented customer demand
→ aggregated demand
→ better utilization
→ stronger procurement economics
→ transparent allocation of savings/costs
```

Existing container shipment/cargo reservation foundations should be extended rather than replaced.

---

# 18. Document & Evidence Architecture

Trade documents must be able to support both costs and events.

Examples:

- Commercial Invoice;
- Auction Invoice/Sheet;
- Export Declaration;
- Inspection Certificate;
- Packing List;
- Freight Invoice;
- Bill of Lading;
- Insurance Certificate;
- Port/Terminal Invoice;
- Transit Declaration;
- Customs Entry;
- Customs Assessment;
- Government Receipt;
- Release/Delivery Order;
- Inland Waybill;
- Proof of Delivery.

Evidence should retain:

- source;
- linked entity;
- verification status;
- timestamps;
- extracted data where applicable;
- reviewer state;
- access controls.

T8 owns deeper evidence/document relationships and provenance hardening.

---

# 19. Yard, Measurements & Freight Profile

Freight must not rely permanently on generic assumptions such as a fixed CBM for a vehicle model.

A governed vehicle/cargo freight profile may later include:

- length;
- width;
- height;
- measured volume;
- provider chargeable volume;
- gross/curb weight;
- running status;
- oversize status;
- fuel/battery attributes;
- container-fit profile;
- measurement source/date.

Parts/cargo need equivalent dimensions, weight, packaging, hazmat, and quantity information.

T9 owns yard/measurement/vanning/consolidation operational evidence.

---

# 20. Shipment Visibility Architecture

CarUp should own a canonical event taxonomy and normalize external provider events into it.

Conceptual flow:

```text
External Provider Event
→ Raw Integration Event
→ CarUp Normalizer
→ Canonical Shipment Event
→ Shipment Ledger
→ Customer Timeline
```

## 20.1 Customer Timeline

A simplified customer projection may show:

```text
M1 Booking Confirmed
M2 At Japan Port
M3 Departed Japan
M4 In Transit
M5 Arrived Destination Port
M6 Clearing / Border Transit
M7 Delivered
```

## 20.2 Operational Ledger

The underlying event system must support granular states such as:

- yard receipt;
- inspection;
- export customs;
- gate-in;
- loaded;
- ATD;
- transshipment;
- ETA update;
- ATA;
- discharge;
- transit declaration;
- guarantee/bond state;
- border arrival/exit;
- customs assessment;
- payment;
- customs release;
- inland dispatch;
- POD.

Every event should preserve source and time semantics. Planned, estimated, and actual timestamps must not overwrite each other.

T11 owns the canonical shipment ledger and provider/carrier adapters.

---

# 21. Shipment Blockers

Trade OS should explain why a journey cannot advance, not only where it is.

Examples:

- inspection certificate missing;
- export customs not released;
- transit guarantee inactive;
- container awaiting consolidation;
- customs assessment awaiting payment;
- delivery order unavailable.

Blockers should eventually identify:

- blocking rule;
- responsible party;
- required action;
- related document;
- financial requirement;
- expected next transition.

---

# 22. Import Eligibility, Customs & Transit

Before a vehicle is committed for import, Trade OS should eventually determine whether the intended destination allows the transaction.

Eligibility inputs may include:

- destination;
- vehicle age;
- classification;
- engine/fuel;
- steering;
- importer type;
- inspection requirement;
- permit requirement;
- exemptions/rebates.

Customs architecture should separate:

- customs valuation;
- duty;
- surtax/special tariffs where applicable;
- excise where applicable;
- VAT/tax;
- foreign/transit/inland cost treatment;
- customs FX;
- assessment;
- payment;
- release.

Transit guarantees/bonds must be represented as lifecycles, not merely fees.

T12 owns authoritative eligibility/customs/transit logic and effective-dated regulatory rules.

---

# 23. Payments, SafeTrade & Reconciliation

Trade OS should connect commercial obligations to the trade journey without pretending CarUp is a regulated bank, insurer, carrier, or customs authority unless legally true.

Payment milestones may include:

- deposit;
- vehicle balance;
- freight;
- inspection;
- insurance;
- duty/tax;
- clearing;
- delivery;
- approved exception costs.

SafeTrade should eventually combine:

- verified actors;
- verified stock/vehicle;
- evidence/documents;
- quote terms;
- payment milestones;
- compliance gates;
- shipment gates;
- disputes;
- delivery confirmation;
- reputation eligibility.

The final financial state should support reconciliation:

```text
Quoted
→ Confirmed
→ Invoiced
→ Paid
→ Final Actual
→ Variance
```

T13 owns payment-milestone execution and financial reconciliation.

---

# 24. Vehicle Passport / Persistent Trade Evidence

The trade journey should strengthen the permanent Vehicle Passport.

Potential evidence chain:

```text
Auction / Source Evidence
→ Inspection
→ Export Evidence
→ Freight / Bill of Lading
→ Customs Assessment
→ Duty Receipt
→ Delivery / POD
→ Ownership
→ Service / Workshop Evidence
→ Later Resale
```

Trade OS should not become a temporary shipment record that disappears after delivery.

---

# 25. Provider Reputation & Performance

Provider trust should eventually include execution history, not ratings alone.

Potential signals:

- quote accuracy;
- quote-to-actual variance;
- response time;
- on-time performance;
- document quality;
- clearance success;
- exception rate;
- claims/disputes;
- customer outcome.

Historical performance may inform future recommendations, but scoring logic must remain explainable and source-linked.

---

# 26. Savings & Customer Value Evidence

CarUp should not market unverified savings.

Completed journeys may eventually produce a Savings Statement comparing:

- comparable alternative;
- selected journey;
- estimated landed cost;
- final landed cost;
- difference;
- source of difference;
- CarUp fee.

Potential savings sources:

- supplier competition;
- freight competition;
- corridor selection;
- shared capacity;
- clearing competition;
- document/process efficiency;
- avoided storage/demurrage;
- better provider performance.

This turns “CarUp is cheaper” from a marketing claim into measurable evidence.

---

# 27. Commercial Model

CarUp should use a hybrid commercial model rather than a single percentage applied everywhere.

Potential revenue sources:

- marketplace transaction fee;
- managed-import coordination fee;
- freight procurement/coordination fee;
- permitted logistics margin;
- shared-container/consolidation fee;
- document processing fee;
- partner commission where lawful/disclosed;
- Dealer Pro subscription;
- Exporter OS SaaS/usage;
- Enterprise retainer/SLA.

CarUp must distinguish:

```text
GMV
≠ CarUp Revenue
≠ Contribution
```

Conceptually:

```text
Net Revenue
= CarUp fees
+ earned commissions
+ eligible logistics margin
+ allocated subscription revenue
```

and:

```text
Contribution
= Net Revenue
- CarUp-paid provider costs
- payment costs
- operational labour
- expected exception/claims cost
```

T17 owns deeper commercialization and profitability logic.

---

# 28. AI Command Architecture

AI remains a controlled workflow assistant, never an unrestricted editor.

Canonical pipeline:

1. receive command;
2. classify intent;
3. extract entities;
4. resolve known entities;
5. score confidence;
6. check entitlement;
7. check role/tenant permission;
8. check business rules;
9. detect duplicate/idempotency risk;
10. create proposed/draft action;
11. require confirmation/approval according to risk;
12. execute through governed service;
13. audit and emit event.

High-risk actions must remain human/reviewer governed.

AI may help prepare scenario fixtures, but generated values must be labeled and must not silently become authoritative regulatory, commercial, or provider truth.

---

# 29. Subscription & Entitlements

Trade features may be plan/entitlement gated.

Entitlements should be checked at the service boundary and should not be inferred only from UI visibility.

Potential product groups:

- Buyer Member;
- Seller/Supplier Member;
- Dealer/Trade Pro;
- Exporter OS;
- Enterprise Partner;
- Trade Partner.

Plan catalogs and quotas should be config/governance-driven rather than scattered hard-coded assumptions.

---

# 30. Cloud Drive & User-Owned Document Storage

Trade OS may support user-approved storage providers such as Google Drive and later other providers through an abstraction.

A conceptual folder model remains useful:

```text
CarUp Trade/
  Buyer Orders/
  Seller Stock/
  Import Documents/
  Export Documents/
  Invoices/
  Bills of Lading/
  Compliance/
  Payment Proof/
  Completed Orders/
```

CarUp must handle revocation gracefully and avoid treating a connected drive as permanent availability.

Token/credential handling must use approved secure storage and never fixture/test files.

---

# 31. Trade Graph Intelligence

The Trade OS graph connects participants and events:

```text
Buyer
→ RFQ / Order
→ Requested Vehicle / Part
→ Provider
→ Quote
→ Service Scope
→ Container / Reservation
→ Document
→ Payment
→ Shipment
→ Compliance
→ Delivery
→ Passport / Reputation
```

The graph should be a projection of authoritative domain events/records rather than a second mutable source of truth.

Potential questions include:

- what blocks this order?
- which provider repeatedly misses quotes?
- which corridor has lower actual variance?
- which demand should be consolidated?
- which documents are missing?
- which supplier matches this RFQ?

---

# 32. Security & Hardening

Core controls include:

- authentication;
- server-derived authorization;
- tenant isolation;
- RLS where applicable;
- entitlement checks;
- idempotency;
- immutable/ledgered state where required;
- audit logging;
- document access controls;
- upload validation;
- formula injection defense;
- workbook bounds;
- duplicate detection;
- approval queues;
- rate limits;
- private file controls;
- safe external-provider adapters;
- no fixture credentials/secrets;
- no broad staging cleanup;
- no test fixture promotion to production truth.

Stock, payment, verification, compliance, and shipment completion must not be overwritten directly from workbook cells or AI commands.

---

# 33. Scenario/UAT Environment Contract

Scenario data must be environment-aware.

## Local / Automated Tests

- deterministic fixtures;
- synthetic identities;
- sandbox/fake providers;
- fixture rules;
- complete controlled reset.

## Staging / Owner UAT

- isolated test identities/tenants;
- scenario/run IDs;
- staging-only fixtures;
- controlled cleanup/isolation;
- no production access.

## Demo

- curated scenario data;
- clearly labeled as demo;
- no false live availability/regulatory claims.

## Production

Canonical scenario/test fixture injection is forbidden by default.

---

# 34. Golden Scenarios

Trade OS should use longitudinal Golden Scenarios rather than recreating unrelated test data in every phase.

## `SCN-ALPHARD-HARARE-001`

Vehicle retail procurement and later import journey.

## `SCN-PARTS-CONTAINER-001`

Parts procurement based on cleaned realistic legacy fixture data.

## `SCN-BYO-VEHICLE-SHIPPING-001`

Customer already owns vehicle; Trade OS supplies logistics workflow only.

Future scenarios may cover:

- dealer bulk import;
- shared container;
- document failure;
- customs reassessment;
- delayed shipment;
- provider quote variance;
- failed/blocked payment;
- disputed delivery.

Every scenario must define expected results/assertions.

---

# 35. Testing Strategy

Testing should reuse the same scenario concepts across layers.

## Unit

- parser;
- template generation;
- validation;
- state transitions;
- cost/rule formulas when their phases arrive;
- assertion evaluation;
- provider/corridor normalization.

## Integration

- workbook → normalized payload;
- dry-run zero-write;
- cross-reference validation;
- business-rule denial;
- reviewed import;
- idempotent replay;
- multi-quote preservation;
- service-layer mutation.

## Staging

- real staging constraints;
- RLS/tenant isolation;
- RPC/service behavior;
- scenario/run isolation;
- Golden Journey progression.

## E2E / Owner UAT

- upload/download;
- diagnostics;
- RFQ comparison;
- quote selection;
- partial-service journey;
- documents;
- shipment/payment/customs UI as later phases arrive;
- assertion/report evidence.

---

# 36. Current T-Track Alignment

The current global Trade OS work should be governed through the following track allocation.

| Track | Responsibility |
|---|---|
| **T5** | Template/scenario ingestion compatibility, independent RFQ, multi-quote/provider composition, partial journeys, original-currency preservation, scenario provenance/assertions |
| **T6** | Official/reference FX, rates, cost components, quote normalization, corridor comparison, landed-cost engine |
| **T8** | Document/evidence relationships and provenance |
| **T9** | Yard operations, measurements, freight profiles, vanning/consolidation evidence |
| **T11** | Canonical shipment ledger, carrier/provider adapters, customer timeline |
| **T12** | Import eligibility, customs valuation, duty/tax/transit/destination rules |
| **T13** | Payment milestones, settlement evidence, final financial reconciliation |
| **T17** | Fees, commissions, subscriptions, provider economics, contribution/profitability |

This overlay is the current governing phase map for the capabilities above.

Older references to “Phase 5”, “Phase 6”, etc. in historical Trade OS planning must not be confused with the current `T5`, `T6`, etc. programme tracks.

---

# 37. T5 Compatibility Gate

T5 must not be considered complete if its architecture prevents the later global Trade OS design.

T5 must prove or preserve all of the following:

1. buyer demand/RFQ can exist without an existing listing;
2. one RFQ can retain multiple competing quotes;
3. provider identity and role are explicit;
4. quote acceptance preserves rejected/expired alternatives;
5. one order can later compose multiple providers;
6. service scope can represent partial journeys;
7. corridor is not hardcoded globally;
8. transport mode is separable from corridor;
9. original monetary amount/currency are preserved;
10. later USD normalization is supported;
11. CarUp fee classification can remain separate from partner/pass-through charges;
12. canonical cost categories can be referenced later;
13. future evidence can attach without schema replacement;
14. future shipment events can attach without schema replacement;
15. shared capacity/container reservations remain compatible;
16. workbook parsing uses the existing engine;
17. dry-run remains zero-write;
18. authoritative mutation remains service-layer governed;
19. scenario/test provenance is explicit;
20. scenario replay/import is idempotent;
21. fixture data is isolated from production truth;
22. Golden Scenarios can be rerun/reset safely.

---

# 38. T5 Non-Goals

T5 must not absorb future phase work merely to make a demo appear complete.

T5 does not own:

- live official FX integration;
- final landed-cost calculations;
- live Dar/Beira/Durban recommendation;
- carrier rate APIs;
- live freight procurement;
- AIS;
- ASYCUDA integration;
- authoritative tax/customs rules;
- live escrow release;
- final commercial profitability engine.

T5 should establish extension points, not fake future functionality.

---

# 39. Immediate Documentation / Review State

This master plan is being updated together with:

[`CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md`](./CARUP_TRADE_OS_TEMPLATE_INGESTION_AND_SCENARIO_TESTING_PLAN.md)

The immediate owner-review decisions are:

1. approve Reference Pack vs Scenario Pack separation;
2. approve the three initial Golden Scenarios;
3. approve T5 as a compatibility/ingestion/RFQ test gate rather than a full logistics phase;
4. approve mandatory provenance for fixture/import data;
5. approve reuse of cleaned Universal Motors legacy data as `LEGACY_WORKBOOK` / `TEST_FIXTURE`, not production truth;
6. approve the T5→T17 scenario inheritance model;
7. approve workbooks as staging/exchange surfaces only.

No implementation follows from this review draft until explicitly approved.

---

# 40. Post-Approval Implementation Sequence

If the owner approves the plan, work should proceed in one bounded T5 lane.

### T5-A — Contract Reconciliation

- compare current workbook schema to expanded RFQ/provider requirements;
- identify minimum additive changes;
- define Scenario Manifest;
- define provenance representation;
- define isolation/reset contract.

### T5-B — Reference Fixture Preparation

- clean small vehicle reference pack;
- clean small parts/fitment pack;
- create synthetic buyer/provider identities;
- retain provenance.

### T5-C — Golden Scenario Generation

- Alphard procurement;
- Parts procurement;
- Bring-Your-Own shipping.

### T5-D — Dry Run / Validation

- structural validation;
- domain validation;
- business-rule validation;
- zero-write proof.

### T5-E — Reviewed Draft Import

- existing parser;
- existing import state machine;
- service-layer execution;
- idempotency proof;
- multi-quote preservation.

### T5-F — UAT / Assertions

- expected assertions;
- owner-visible evidence;
- defect register;
- no scope creep into T6.

---

# 41. Definition of Done for This Planning Update

This planning update is complete when:

- the dedicated Template Ingestion & Scenario Testing plan exists;
- this master plan references and incorporates it;
- the master plan reflects the current five-template XLSX foundation rather than the historical three-template assumption;
- the workbook engine is treated as existing capability, not proposed greenfield work;
- T5 scope and non-goals are explicit;
- the three initial Golden Scenarios are defined;
- provenance and fixture truth boundaries are explicit;
- current T-track ownership is explicit;
- no product code, schema migration, or production behavior has changed;
- owner review occurs before implementation.

---

# 42. Strategic Outcome

The resulting system should ultimately allow this proposition:

> **Buy through CarUp, buy from a Japanese exporter, buy at auction, or bring a vehicle you already own. CarUp helps you compare providers, compare corridors, understand the full landed cost, aggregate logistics where useful, manage the trade documents, follow the shipment, clear the border, deliver the vehicle, and preserve the evidence history.**

Template ingestion is therefore not a side utility.

It begins as a realistic testing and offline-ingestion mechanism, but it can become the enterprise bridge that lets real automotive businesses bring existing stock, demand, RFQs, supplier responses, and operating data into the same governed Trade OS.

That capability must be built without sacrificing the core contract:

> **CarUp remains the authoritative, auditable operating system; templates remain controlled exchange surfaces.**

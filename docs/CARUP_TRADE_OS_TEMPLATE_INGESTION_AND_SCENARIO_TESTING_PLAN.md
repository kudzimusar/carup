# CarUp Trade OS — Template Ingestion & Scenario Testing Architecture

> **Status:** REVIEW DRAFT — planning and documentation only  
> **Date:** 2026-09-13  
> **Program:** CarUp Diaspora Trade OS  
> **Current delivery context:** T5  
> **Implementation authorization:** **NOT GRANTED** by this document. Product code, migrations, staging data writes, and production behavior remain unchanged until owner review and approval.

---

## 1. Purpose

This document defines the architecture for using structured templates and reusable scenario packs to populate, validate, exercise, demonstrate, and regress-test CarUp Trade OS with realistic vehicle, parts, supplier, RFQ, logistics, document, payment, container, compliance, and shipment data.

The architecture deliberately builds on the workbook capability CarUp already has. It does **not** introduce a second spreadsheet system and it does **not** make spreadsheets authoritative.

The intended outcome is a governed bridge between:

1. real-world trade data;
2. offline workbooks;
3. realistic test fixtures;
4. UAT scenarios;
5. partner bulk onboarding;
6. the authoritative Trade OS domain and service layer.

The core principle is:

> **Workbooks supply structured facts and proposed actions. Trade OS validates, governs, calculates, authorizes, and records authoritative state.**

---

## 2. Why This Architecture Is Needed Now

Trade OS has reached the point where empty-state testing and manually created toy records are no longer sufficient.

T5 and the later Trade OS tracks need to prove increasingly connected business journeys:

- buyer demand;
- independent RFQs;
- multiple competing provider quotes;
- vehicle and parts procurement;
- partial-service journeys such as shipping-only;
- provider composition;
- shared-container reservations;
- original-currency pricing;
- later USD normalization;
- documents and evidence;
- yard and freight measurements;
- shipment milestones;
- transit and customs;
- payment milestones;
- reconciliation;
- provider and corridor intelligence.

Creating these records manually for every test would be slow, inconsistent, difficult to reproduce, and unlike the workflows that enterprise sellers and suppliers will eventually use.

Template ingestion solves two problems at once:

1. **near-term:** realistic, repeatable Trade OS testing and UAT;
2. **long-term:** a bulk onboarding and offline operating channel for real buyers, sellers, dealers, exporters, logistics providers, and enterprise partners.

This makes the feature strategically useful rather than test-only infrastructure.

---

## 3. Historical Lineage

This architecture is an evolution of work CarUp already used to shape Trade OS.

### 3.1 Universal Motors Zimbabwe Auto Parts BOS

The earlier `Universal_Motors_Zimbabwe_Auto_Parts_BOS_v1` workbook modeled an offline automotive operating system with reference and transactional sheets covering:

- vehicles;
- parts and fitment;
- HS codes;
- suppliers;
- customers;
- customer orders;
- purchase orders;
- costing;
- container planning;
- inventory;
- payments;
- order audit;
- compliance;
- dashboard reporting.

Its schema conventions intentionally used stable structured columns suitable for parsing and import.

This should be treated as a **legacy reference fixture and design ancestor**, not as authoritative production data.

### 3.2 Enterprise Connected Workbook

The later connected enterprise workbook moved from a parts catalogue toward a complete trade workflow:

```text
Customer demand
→ Supplier RFQ
→ Supplier response
→ Purchase order
→ Shipment/container planning
→ Landed-cost progression
→ Inventory/compliance/payment
```

This is the conceptual bridge from the parts BOS to the modern Trade OS domain graph.

### 3.3 Tonde / Benricom Supplier RFQ Pattern

The supplier-facing RFQ workbook established an important privacy and workflow principle:

> External partners should receive only the information required to perform their role.

Supplier workbooks should not expose internal customer margins, CarUp commercial strategy, unrelated customer data, or internal provider comparisons.

That principle must remain in the modern template architecture.

### 3.4 Current Trade OS Workbook Engine

The repository now contains a real XLSX implementation rather than only a spreadsheet concept.

Existing foundations include:

- `backend/constants/diaspora/diasporaWorkbookSchema.js`
- `backend/constants/diaspora/diasporaWorkbookTemplates.js`
- `backend/services/diaspora/workbook/diasporaWorkbookXlsxService.js`
- workbook validation and persistence services;
- workbook dry-run flows;
- workbook import execution;
- workbook export/round-trip capability;
- workbook upload security controls;
- operator UI surfaces.

Current generated XLSX template families include:

- buyer;
- seller;
- supplier;
- enterprise;
- container reservation.

The XLSX service already supports:

```text
.xlsx bytes
→ parseWorkbook()
→ normalized { templateType, sheets }
→ existing dry-run validation
→ diagnostics
→ reviewed draft import
```

Formula cells are not executed by the parser. Export neutralizes spreadsheet formula injection. Existing import execution is designed to remain idempotent and draft-oriented rather than bypassing authoritative ledgered services.

Therefore the new architecture must **extend this proven foundation rather than replace it**.

---

## 4. Scope

This plan covers:

- reference data packs;
- scenario packs;
- role-specific workbooks;
- scenario manifests;
- data provenance;
- structural/domain/business validation;
- dry-run diagnostics;
- reviewed import;
- scenario assertions;
- environment isolation;
- test reset strategy;
- legacy fixture reuse;
- T5 minimum capability;
- later T-track extension points.

This plan does **not** authorize implementation of:

- live official FX conversion;
- live freight rates;
- authoritative customs calculations;
- carrier tracking integrations;
- ASYCUDA integration;
- real escrow or payment release;
- production regulatory rules;
- automated corridor recommendation;
- AI authority to bypass service-layer rules.

Those capabilities remain in their governed phases.

---

# 5. Architectural Principle: Two Data Layers

Trade OS testing data must be divided into two major classes.

## 5.1 Reference Data Packs

Reference data describes reusable automotive and trade facts that may participate in many scenarios.

Reference data is not itself a transaction.

Initial reference-pack families should include:

### Vehicle Reference Pack

Potential fields:

- reference vehicle ID;
- make;
- model;
- variant/grade;
- chassis code;
- engine code;
- manufacture/production range;
- body type;
- fuel type;
- transmission;
- drive type;
- dimensions;
- gross/curb weight where known;
- freight-profile attributes;
- source/provenance;
- verification state.

A vehicle reference is not the same thing as a specific sale vehicle. A specific sale vehicle may later add VIN/chassis number, mileage, condition, auction data, photos, and documents.

### Parts Reference Pack

Potential fields:

- part reference ID;
- part name;
- category/subcategory;
- OEM number;
- alternative OEM numbers;
- aftermarket cross references;
- manufacturer;
- brand;
- country of origin;
- vehicle fitment;
- chassis fitment;
- engine fitment;
- manufacture-year fitment;
- condition/quality class;
- dimensions;
- unit weight;
- CBM;
- packaging;
- hazmat attributes;
- HS-code candidate;
- source/provenance;
- verification state.

### Geography & Corridor Reference Pack

Potential fields:

- country;
- city;
- port;
- border post;
- location code;
- candidate corridor;
- candidate corridor legs;
- supported transport modes.

Important: corridor reference fixtures do not automatically make rates or regulatory treatment authoritative.

### Partner Capability Reference Pack

Potential fields:

- partner reference;
- role/capability;
- country/service area;
- supported origin/destination;
- transport mode;
- container capability;
- clearing jurisdiction;
- operating status;
- verification status;
- source/provenance.

### Regulatory Fixture Pack

For tests only, scenarios may need deterministic customs, tax, inspection, or age-limit fixtures.

These must be explicitly labeled as one of:

- `TEST_FIXTURE`;
- `VERIFIED_SNAPSHOT`;
- `GOVERNMENT_SOURCE`.

A regulatory test fixture must never silently become production regulatory truth.

---

## 5.2 Scenario / Transaction Packs

Scenario data describes a particular business event or journey.

Examples:

- a buyer requests a Toyota Alphard;
- a dealer requests 400 parts;
- three suppliers submit competing quotes;
- a customer already owns a vehicle and requests shipping only;
- multiple orders reserve capacity in one container;
- a shipment becomes blocked because a document is missing;
- customs assessment changes the expected landed cost.

Scenario packs should be reusable, deterministic, and independently resettable.

---

# 6. Scenario Pack Contract

A scenario pack should have an explicit manifest.

The manifest may initially live as a versioned fixture file rather than a database entity.

Conceptual contract:

```text
ScenarioManifest
  scenario_id
  title
  description
  scenario_version
  workbook_schema_version
  environment_class
  fixture_class
  allowed_environments
  tags[]
  reference_pack_dependencies[]
  template_inputs[]
  expected_entity_counts
  expected_assertions[]
  expected_warnings[]
  expected_rejections[]
  reset_policy
  source_provenance
  production_forbidden
```

Example:

```yaml
scenario_id: SCN-ALPHARD-HARARE-001
scenario_version: 1
purpose: T5 multi-quote vehicle procurement
production_forbidden: true
reference_pack_dependencies:
  - REF-VEHICLES-JP-ZW-V1
  - REF-PARTNERS-T5-V1
template_inputs:
  - buyer
  - seller-a
  - seller-b
  - seller-c
expected_assertions:
  - one RFQ exists
  - three quotes are retained
  - one expired quote cannot be accepted
  - rejected quote remains auditable
  - accepted provider is linked to the order
```

---

# 7. Proposed Fixture Repository Structure

After approval, the implementation should prefer versioned fixture assets rather than hidden ad-hoc seeds.

Proposed structure:

```text
tests/
  fixtures/
    trade-os/
      reference/
        vehicles/
        parts/
        geography/
        partners/
        regulatory/
      scenarios/
        SCN-ALPHARD-HARARE-001/
          manifest.yml
          buyer.xlsx
          seller-a.xlsx
          seller-b.xlsx
          seller-c.xlsx
        SCN-PARTS-CONTAINER-001/
          manifest.yml
          buyer.xlsx
          supplier-a.xlsx
          supplier-b.xlsx
        SCN-BYO-VEHICLE-SHIPPING-001/
          manifest.yml
          buyer.xlsx
          logistics-provider-a.xlsx
```

The exact folder structure may change during implementation review, but the separation between reference fixtures and scenario transactions should remain.

Binary workbooks should only be committed if they are intentionally stable fixtures. Where practical, test workbooks should be generated from the canonical template generator so schema changes fail visibly rather than allowing stale binary fixtures to drift unnoticed.

---

# 8. Template Strategy

## 8.1 Existing Template Families Remain the Foundation

The current workbook engine already defines:

- `buyer`;
- `seller`;
- `supplier`;
- `enterprise`;
- `container_reservation`.

Do not create a parallel parser.

Do not create independent schemas for every test scenario.

Scenario packs must use the same schema definitions used by actual product workbooks.

## 8.2 Role-Specific Views May Expand Later

As Trade OS becomes more composable, role-focused templates may become useful:

- Vehicle Seller;
- Parts Supplier;
- Freight Provider;
- Clearing Agent;
- Inland Transport Provider;
- Consolidator/Container Operator.

These should preferably be **compositions or projections of canonical sheet definitions**, not unrelated column sets.

The objective is one Trade OS language exposed through focused role-specific surfaces.

## 8.3 Enterprise Workbook

The enterprise template remains the widest offline operational surface.

It should not be used automatically for every external partner.

External partners should receive only the sheets and fields needed for their role.

---

# 9. Vehicle and Parts Domain Separation

Vehicle and parts trade should share the Trade OS transaction infrastructure while preserving distinct product identity schemas.

Do not solve this using one enormous generic `ITEM` schema containing mostly nullable fields.

Shared domains include:

```text
Buyer
RFQ
Provider
Quote
Order
Service Scope
Container
Shipment
Document
Compliance
Payment
Delivery
Reputation
```

Specialized identity remains separate.

## Vehicle-specific identity

Examples:

- VIN/chassis;
- make/model/grade;
- year/manufacture date;
- engine;
- mileage;
- auction grade;
- vehicle condition;
- physical dimensions;
- freight profile;
- vehicle documents.

## Part-specific identity

Examples:

- part number;
- OEM number;
- alternatives;
- manufacturer;
- fitment;
- quantity/UOM;
- MOQ;
- unit dimensions/weight;
- packaging;
- hazmat status.

This allows Trade OS to remain a shared trade engine without flattening automotive truth.

---

# 10. Ingestion Pipeline

The canonical pipeline should be:

```text
Template Generator
        ↓
Workbook / Structured Input
        ↓
Upload Security Gateway
        ↓
XLSX Parser
        ↓
Normalized Trade Payload
        ↓
Structural Validation
        ↓
Domain Validation
        ↓
Business-Rule Validation
        ↓
Dry-Run Diagnostics
        ↓
Human Review / Confirmation
        ↓
Draft Import
        ↓
Authoritative Trade OS Service Layer
        ↓
Domain Records + Audit/Event Ledger
        ↓
Scenario Assertions / UAT
```

No scenario fixture, spreadsheet, operator, AI command, or test helper should create an alternate mutation route around the service layer for authoritative business state.

---

# 11. Validation Architecture

Validation must be explicitly layered.

## 11.1 Layer A — Structural Validation

Questions:

- Is the file supported?
- Is the template/schema version recognized?
- Are expected sheets present?
- Are headers recognized?
- Are required fields populated?
- Are IDs syntactically valid?
- Are dates valid?
- Are enum values allowed?
- Are duplicate offline keys present?
- Are file/sheet/row/cell limits respected?

This layer primarily belongs to the existing workbook parser and validation services.

## 11.2 Layer B — Domain Validation

Questions:

- Does a quote reference an existing order/RFQ?
- Does the provider have a compatible role?
- Does a parts row reference a known part or valid candidate?
- Does vehicle fitment make sense?
- Does a reservation reference an existing container?
- Does declared capacity fit within available capacity?
- Are referenced documents/entities resolvable?
- Does a shipment reference the correct order?

This layer verifies internal Trade OS consistency.

## 11.3 Layer C — Business-Rule Validation

Questions:

- Is the actor authorized?
- Is the tenant permitted to perform the action?
- Is the quote still eligible for acceptance?
- Does the order state permit this transition?
- Is the provider verified for the operation where required?
- Is required compliance complete?
- Would the action bypass a ledger or approval gate?
- Does the action require confirmation or privileged approval?

A workbook that passes structural validation must still fail safely if the proposed business action is not allowed.

---

# 12. Dry-Run / Import Preview

Dry-run must remain a zero-authoritative-write operation.

The user/operator should see a business-oriented preview, not only cell-level spreadsheet errors.

Example summary:

```text
421 rows found
398 ACCEPTED
17 WARNING
6 REJECTED
```

Example diagnostics:

```text
Q-102
WARNING
Quote is JPY-denominated. Original amount will be preserved; authoritative USD comparison is unavailable until governed FX conversion runs.

RES-21
REJECTED
Requested container volume exceeds remaining capacity by 1.8 m³.

SHIP-8
REJECTED
Shipment references an unknown import order.
```

Every diagnostic should ideally contain:

- workbook/sheet;
- source row;
- offline identifier;
- severity;
- stable diagnostic code;
- human explanation;
- proposed action type;
- affected Trade OS entity;
- whether approval is required.

---

# 13. Import Semantics

## 13.1 Dry Run First

No import occurs before a valid dry run.

## 13.2 Explicit Review

Accepted rows become eligible for reviewed execution rather than automatically authoritative.

## 13.3 Draft-First

Where the current architecture uses draft import semantics, preserve them.

Imported records should enter through the same services and state machines as equivalent online actions.

## 13.4 Idempotency

Re-uploading the same scenario or workbook must not duplicate authoritative records.

Identity should use existing import-batch/idempotency infrastructure and stable offline keys.

## 13.5 No Direct Ledger Bypass

Stock totals, payment truth, verification truth, shipment completion, customs completion, and similar governed state must not be directly overwritten from spreadsheet cells.

---

# 14. Data Provenance Contract

Every imported or fixture-originated record should be attributable to its source.

Canonical provenance families to design around:

```text
SYSTEM_GENERATED
CARUP_TEMPLATE
LEGACY_WORKBOOK
OPERATOR_ENTERED
BUYER_SUBMITTED
SELLER_SUBMITTED
SUPPLIER_SUBMITTED
LOGISTICS_PROVIDER_SUBMITTED
API_PROVIDER
GOVERNMENT_SOURCE
VERIFIED_DOCUMENT
TEST_FIXTURE
VERIFIED_SNAPSHOT
```

The final schema may distinguish source type from verification level, but those concepts must not be collapsed.

For example:

```text
source_type = SUPPLIER_SUBMITTED
verification_state = UNVERIFIED
```

is materially different from:

```text
source_type = VERIFIED_DOCUMENT
verification_state = VERIFIED
```

This supports both testing discipline and future Marketplace transparency.

---

# 15. Currency Contract for Scenario Packs

All Trade OS customer-facing comparison may eventually be normalized to USD, but scenario templates must preserve the provider/source currency.

Example:

```text
Supplier quote: JPY 1,250,000
```

should remain JPY source truth.

Trade OS later stores the governed USD snapshot separately.

Scenario tests should eventually verify:

- original amount remains unchanged;
- original currency remains unchanged;
- official/reference FX provenance is recorded;
- FX date is recorded;
- historical quote does not change when a later rate changes;
- customs FX can differ from display/reference FX.

**T5 does not implement live official FX.** It must only avoid a schema/design choice that destroys original-currency truth or prevents later USD normalization.

---

# 16. RFQ Template Architecture

Templates should support buyer demand independently of an existing Marketplace listing.

A buyer should eventually be able to express:

### Vehicle RFQ

```text
Toyota Alphard
2019+
< 80,000 km
Grade 4+
Destination: Harare
Maximum landed budget: USD 18,000
```

### Parts RFQ

```text
20 Toyota Hiace oil filters
10 alternators
5 radiators
Destination: Harare
Required-by: <date>
```

Verified providers may respond using:

- Trade OS UI;
- workbook;
- later API integration.

All response channels must normalize into the same Quote domain.

---

# 17. Provider Privacy and Data Minimization

The Tonde supplier workbook established a pattern that must remain permanent.

A provider-specific export must not expose unrelated or commercially sensitive information.

Examples of data that should remain internal unless explicitly required:

- buyer margin;
- CarUp commercial margin;
- competing provider quotes;
- unrelated customer identity;
- internal intelligence scores not intended for that provider;
- internal fraud/review notes;
- confidential payment details.

Role-specific workbook exports should be generated from allowed-field policies, not manually cleaned copies.

---

# 18. Scenario Assertions

A dataset without an expected result is not a complete test scenario.

Every canonical scenario should define deterministic assertions.

Assertion families may include:

- expected entity count;
- expected accepted rows;
- expected warnings;
- expected rejected rows;
- expected order state;
- expected quote state;
- expected selected provider;
- expected blocker;
- expected capacity allocation;
- expected audit/event existence;
- expected permission denial;
- expected idempotency behavior.

Example:

```text
SCN-ALPHARD-HARARE-001

EXPECT 1 buyer RFQ
EXPECT 3 provider quotes
EXPECT quote Q-A = ELIGIBLE
EXPECT quote Q-B = EXPIRED
EXPECT quote Q-C = REJECTED
EXPECT accepted quote selection to preserve Q-B and Q-C
EXPECT exactly 1 accepted provider relationship
EXPECT repeat import to create 0 duplicate quotes
```

Assertions should eventually be machine-readable so the same scenario can power automated integration tests and owner UAT.

---

# 19. Golden Scenario Catalogue

CarUp should maintain a small, durable set of canonical scenarios rather than hundreds of unrelated fixtures.

## 19.1 `SCN-ALPHARD-HARARE-001` — Vehicle Retail Procurement

Purpose:

- independent vehicle RFQ;
- multiple Japanese seller/exporter responses;
- preserved rejected/expired quotes;
- accepted provider;
- later corridor/rate/shipment extension.

Initial T5 scope:

```text
Buyer in Zimbabwe
→ RFQ for Toyota Alphard
→ Seller A quote
→ Seller B quote
→ Seller C quote
→ expiry/rejection/selection behavior
→ composed Trade Order
```

Later extension:

```text
T6  FX + freight + corridor + landed cost
T8  documents/evidence
T9  yard + vehicle measurements
T11 shipment events
T12 customs/transit
T13 payments/reconciliation
T17 commercial contribution
```

## 19.2 `SCN-PARTS-CONTAINER-001` — Parts Procurement

Purpose:

- realistic part catalogue subset;
- fitment/reference relationships;
- bulk demand;
- multiple suppliers;
- MOQ/lead-time/price comparison;
- later container capacity.

Use a carefully cleaned subset of the Universal Motors legacy workbook as a **test fixture**, preserving provenance as `LEGACY_WORKBOOK` / `TEST_FIXTURE` until individually verified.

## 19.3 `SCN-BYO-VEHICLE-SHIPPING-001` — Bring Your Own Vehicle

Purpose:

Prove Trade OS is not dependent on purchasing the vehicle through CarUp Marketplace.

Journey:

```text
Customer already owns vehicle
→ requests logistics service
→ receives provider quote(s)
→ selects service
→ Trade Order contains no CarUp vehicle procurement requirement
```

## 19.4 Future Golden Scenarios

Later additions should include:

- dealer bulk import;
- shared container across independent customers;
- document/compliance failure;
- route/corridor comparison;
- customs reassessment;
- shipment delay;
- provider quote-to-actual variance;
- payment/release blocker.

---

# 20. Failure / Exception Scenarios

Trade OS must be tested deliberately against failures, not only the happy path.

Minimum exception catalogue should eventually include:

- duplicate offline ID;
- unknown vehicle reference;
- unknown part reference;
- invalid fitment;
- expired quote;
- quote from unauthorized provider;
- negative/zero amount where prohibited;
- missing required currency;
- container over-capacity;
- missing compliance document;
- blocked order transition;
- payment not confirmed;
- shipment event out of sequence;
- customs valuation adjustment;
- quote-to-invoice variance;
- cross-tenant reference;
- unauthorized role;
- formula-injection payload;
- unsupported workbook version;
- repeated import/idempotency replay.

---

# 21. T5 Scope

T5 must **not** become the full landed-cost, customs, shipment, or integration programme.

T5's responsibility is to prove that template-driven data can exercise the expanded commercial architecture without forcing later redesign.

## 21.1 T5 Minimum Capability

T5 should prove:

1. realistic workbook data passes through the existing XLSX parser;
2. template/schema version is explicit;
3. scenario/test provenance can be retained;
4. buyer demand can exist independently of Marketplace inventory;
5. one demand/RFQ can retain multiple competing quotes;
6. provider identity and role are preserved;
7. rejected and expired quotes are not destroyed when another quote is accepted;
8. quote/order composition does not assume one provider supplies the entire journey;
9. partial-journey demand such as shipping-only is representable;
10. original amount and currency are preserved;
11. future USD normalization is not blocked;
12. dry-run remains zero-write;
13. business-rule validation still occurs after spreadsheet parsing;
14. authoritative mutation goes through service-layer rules;
15. repeated import is idempotent;
16. scenario fixtures are isolated from production truth;
17. expected assertions can be evaluated manually and/or automatically;
18. test data can be reset without damaging unrelated staging data.

## 21.2 T5 Initial Scenario Set

T5 should use exactly three primary scenarios first:

### A. Vehicle Procurement

`SCN-ALPHARD-HARARE-001`

### B. Parts Procurement

`SCN-PARTS-CONTAINER-001`

### C. Partial Journey

`SCN-BYO-VEHICLE-SHIPPING-001`

This is enough to prove the architecture without prematurely building the entire scenario catalogue.

---

# 22. Later T-Track Alignment

The same canonical scenarios should grow with the product rather than being discarded after T5.

| Track | Scenario capability added |
|---|---|
| **T5** | Template ingestion compatibility, independent RFQ, multi-quote/provider composition, partial journey, scenario provenance/assertions |
| **T6** | Governed FX, rates, cost components, quote normalization, corridor comparison, landed-cost estimation |
| **T8** | Document/evidence relationships, document provenance, cost/event evidence |
| **T9** | Yard events, measurements, freight profile, packaging/vanning/consolidation evidence |
| **T11** | Canonical shipment event ledger, provider/carrier adapters, customer timeline |
| **T12** | Import eligibility, customs valuation, duty/tax rules, transit/border processing |
| **T13** | Payment milestones, settlement evidence, reconciliation, quote-to-actual financial flow |
| **T17** | Fees, commissions, logistics margin, subscriptions, provider economics, contribution/profitability |

This allows one Golden Scenario to become a longitudinal certification journey across Trade OS.

---

# 23. Environment & Isolation Model

Scenario execution must be environment-aware.

## 23.1 Local / Automated Test

Allowed:

- synthetic actors;
- deterministic fixture IDs;
- fake/sandbox providers;
- fixture rates;
- complete reset.

## 23.2 Staging / UAT

Allowed:

- synthetic or specifically approved non-production actors;
- scenario-specific tenant/user identity;
- controlled staging imports;
- safe external sandbox adapters where available.

Every scenario should use a predictable identifier namespace so records can be found and cleaned safely.

## 23.3 Demo

Demo scenarios may use curated data but must not be represented as live commercial availability or current regulatory truth.

## 23.4 Production

Canonical test fixtures must be **production-forbidden by default**.

There must be no generic "seed scenario" action capable of populating production.

---

# 24. Reset and Cleanup

Repeatable scenario testing requires repeatable cleanup.

A future scenario runner should know exactly which records belong to a scenario through:

- scenario ID;
- import batch ID;
- tenant/test actor identity;
- stable fixture identifiers;
- correlation IDs/event metadata where appropriate.

Cleanup must be narrow and attributable.

Never use broad destructive SQL such as deleting all diaspora trade rows merely to reset UAT.

Where historical audit/ledger rows are intentionally immutable, reset strategy should use isolated scenario tenants/runs rather than pretending immutable business history can be erased.

---

# 25. Security Requirements

Template/scenario functionality inherits the existing workbook security contract and should add scenario-specific safety.

Required controls:

- supported MIME/extension validation;
- `.xlsm` rejection unless explicitly governed in the future;
- file-size limits;
- sheet/row/cell limits;
- zip-bomb protection;
- formula injection neutralization on export;
- formula non-execution on import;
- filename normalization;
- PII minimization;
- no real passwords/API keys in fixture files;
- no production credentials in scenario packs;
- role-based export field filtering;
- tenant authorization;
- idempotency;
- audit attribution;
- production fixture prohibition.

---

# 26. Legacy Workbook Reuse Rules

Legacy workbooks are valuable because they contain realistic automotive complexity.

They must not be imported blindly.

## 26.1 Allowed Reuse

Reuse may include:

- vehicle makes/models/chassis/engines;
- part categories;
- part fitment relationships;
- OEM numbers as candidate fixture data;
- physical dimensions as fixture values;
- realistic quantities;
- supplier response structure;
- RFQ workflow;
- container packing complexity.

## 26.2 Values Requiring Revalidation

Do not assume continuing truth for:

- current supplier pricing;
- current stock availability;
- FX conversions;
- duty/VAT/surtax rates;
- HS-code treatment;
- live provider contact details;
- current shipping rates;
- current regulatory eligibility;
- manufacturer claims not independently verified.

These should carry fixture/provenance labels until verified.

## 26.3 Rule

> **Reuse the structural richness; revalidate the commercial and regulatory truth.**

---

# 27. Calculations: Workbook vs Trade OS

The original workbook contained spreadsheet formulas for FX, prices, landed cost, CBM, and other calculations.

The modern architecture should move authoritative calculations into governed application services.

Examples:

```text
Workbook may provide:
  UNIT_PRICE_JPY = 180000

Trade OS later calculates/stores:
  REFERENCE_USD_AMOUNT
  FX_RATE
  FX_SOURCE
  FX_DATE
```

Likewise:

```text
Workbook may provide:
  LENGTH
  WIDTH
  HEIGHT
  WEIGHT

Trade OS calculates:
  normalized volume
  provider-specific chargeable volume
  container utilization
```

This prevents stale formulas from silently becoming business truth.

---

# 28. Download → Edit → Re-import

The architecture should support safe round-trip workflows.

Potential future flows:

### Dealer stock

```text
Export current stock
→ edit allowed fields offline
→ upload
→ dry-run changes
→ approve
```

### Supplier RFQ response

```text
Download RFQ
→ fill availability/price/lead time
→ upload response
→ Trade OS normalizes quote
```

### Operator reconciliation

```text
Export governed operational view
→ reconcile offline
→ upload proposed updates
→ validate/approve through service layer
```

Round-trip support is an enterprise feature, not permission to overwrite governed state.

---

# 29. Proposed UAT Experience

A future operator/UAT surface should provide:

1. choose scenario or upload template;
2. parse file;
3. show scenario/manifest metadata;
4. show dry-run summary;
5. inspect accepted/warning/rejected rows;
6. inspect proposed Trade OS actions;
7. confirm import where authorized;
8. navigate directly to created RFQ/order/quotes;
9. run scenario assertions;
10. show pass/fail evidence;
11. reset/re-run where permitted.

The product should distinguish:

- fixture execution;
- real customer import;
- enterprise migration;
- ordinary workbook upload.

These may share technology but must not be visually or operationally confused.

---

# 30. Observability

Scenario runs should eventually emit enough metadata to diagnose failure without inspecting raw database rows manually.

Recommended metadata:

- scenario ID;
- scenario version;
- run ID;
- import batch ID;
- tenant;
- actor;
- workbook schema version;
- parser result;
- validation result;
- action count;
- assertion results;
- correlation ID;
- timestamps;
- failure code.

Do not log sensitive workbook contents indiscriminately.

---

# 31. Testing Strategy

The architecture should support multiple layers using the same scenario source.

## Unit Tests

- manifest validation;
- template generation;
- parser behavior;
- provenance normalization;
- assertion evaluation;
- field mapping.

## Integration Tests

- workbook → normalized payload;
- dry-run zero-write;
- domain cross-references;
- business-rule denial;
- reviewed import;
- idempotent re-import;
- multi-quote preservation.

## Staging Tests

- real staging DB constraints;
- RLS/tenant isolation;
- RPC/service-layer behavior;
- scenario reset/isolation;
- Golden Journey state transitions.

## E2E / Owner UAT

- upload/download flow;
- diagnostics UX;
- RFQ comparison;
- accepted/rejected/expired quote behavior;
- navigation to created records;
- scenario assertion summary.

---

# 32. T5 Implementation Sequence After Approval

No implementation starts until owner approval of this plan.

If approved, T5 should proceed incrementally:

## T5-A — Contract Reconciliation

- compare current workbook schema to T5 RFQ/multi-provider requirements;
- identify the minimum additive schema changes;
- confirm no duplicate parser/service is needed;
- define scenario manifest contract;
- define provenance representation;
- document data/reset boundaries.

## T5-B — Reference Fixture Preparation

- extract a small cleaned vehicle reference set;
- extract a small cleaned parts/fitment set from legacy workbook;
- create synthetic test actors/providers;
- label every legacy-derived row as fixture/provenance data.

## T5-C — Scenario Pack Generation

Create:

- `SCN-ALPHARD-HARARE-001`;
- `SCN-PARTS-CONTAINER-001`;
- `SCN-BYO-VEHICLE-SHIPPING-001`.

Generate workbook assets from canonical template definitions where possible.

## T5-D — Validation & Dry Run

- structural validation;
- cross-reference validation;
- provider/RFQ validation;
- business-rule validation;
- dry-run diagnostics;
- prove zero authoritative writes.

## T5-E — Reviewed Draft Import

- import through existing services;
- prove idempotency;
- prove rejected/expired quotes remain preserved;
- prove partial journey does not require Marketplace purchase.

## T5-F — Assertions & UAT

- execute expected assertions;
- capture pass/fail evidence;
- run desktop/mobile UAT where relevant;
- record defects without broadening into T6.

---

# 33. T5 Non-Goals

T5 must not implement merely because the scenario needs a future field:

- live ECB or other official FX adapter;
- ZIMRA customs exchange-rate automation;
- final landed-cost calculator;
- Dar/Beira/Durban recommendation engine;
- live ocean freight procurement;
- carrier API tracking;
- AIS;
- live customs/ASYCUDA integration;
- live payments;
- real-money escrow release;
- production regulatory automation;
- automated profitability statements.

T5 may establish extension points for these later capabilities.

---

# 34. Definition of Done — Architecture Plan

This documentation phase is complete when:

- this plan exists in the repository;
- the master Trade OS plan references and aligns to it;
- existing workbook implementation is described as a reusable foundation rather than future work;
- reference packs and scenario packs are clearly separated;
- three T5 Golden Scenarios are defined;
- data provenance is mandatory;
- dry-run/service-layer authority boundaries are explicit;
- T5 scope and non-goals are explicit;
- later T-track ownership is explicit;
- no product code has been changed;
- owner has reviewed and explicitly approved implementation.

---

# 35. Implementation Acceptance Criteria — Reserved for Owner Approval

If implementation is approved, T5 Template Ingestion & Scenario Testing is accepted only when all of the following are demonstrated:

1. canonical template generation remains the schema source;
2. `.xlsx` parsing uses the existing workbook engine;
3. dry-run creates zero authoritative business records;
4. structural, domain, and business-rule validation are distinguishable;
5. reference fixtures are separate from transaction scenarios;
6. scenario data carries provenance;
7. production fixture import is blocked by default;
8. vehicle and parts identity remain specialized;
9. RFQs can be independent of Marketplace listings;
10. one RFQ retains multiple quotes;
11. accepted quote selection does not erase competing history;
12. shipping-only/partial journey is representable;
13. original currency is preserved;
14. authoritative state changes execute through governed services;
15. re-import is idempotent;
16. scenario runs are attributable by scenario/run/import identifiers;
17. `SCN-ALPHARD-HARARE-001` passes its T5 assertions;
18. `SCN-PARTS-CONTAINER-001` passes its T5 assertions;
19. `SCN-BYO-VEHICLE-SHIPPING-001` passes its T5 assertions;
20. scenario reset/re-run does not damage unrelated staging records.

---

# 36. Owner Review Gate

This document intentionally stops before implementation.

Owner review should confirm:

- the Reference Pack / Scenario Pack separation;
- the three T5 Golden Scenarios;
- the T5 minimum scope;
- the provenance model;
- the rule that workbooks remain staging/exchange surfaces, never authoritative bypasses;
- the phase allocation from T5 through T17.

Only after explicit approval should implementation planning move from this architecture document into code-level task decomposition.

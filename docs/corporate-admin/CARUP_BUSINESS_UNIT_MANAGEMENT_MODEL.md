# CARUP BUSINESS UNIT MANAGEMENT MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-BU — Business Unit Management & Scorecard Agent  
Task: CA-BU-01  
Status: BUSINESS UNIT MANAGEMENT ARCHITECTURE / SCORECARD CONTRACT ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This Business Unit management model is produced under the following exact accepted authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical plan authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Accepted CA-ORG-01 authority: `705eb6fa1cd89109977052e88e220f0498668060`
- Accepted CA-RBAC-01 authority: `4abdf95e1e1490b01f51cb45106a57fcf7b954b9`
- Accepted CA-METRIC-01 authority: `32c26ce5d89ec3829e2afa9248d1e77a2cb4c784`
- Accepted CA-FIN-01 authority: `9ba7388559fa13cf353e410ce2a62be30660bdeb`
- Accepted CA-GROWTH-01 authority: `f7e4c0519411994383d8d3e316c10b380f0e728d`
- Accepted CA-UX-01 authority: `336c6d6015b6c2a4851fb1171642bcc5e93adcdf`
- Accepted/frozen K2B operational-provenance authority: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`
- Current documentation starting head supplied by CA-MOD: `d90f1b64a4c227837f24e62eb22484006110e489`
- Product/reference authority inspected read-only: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`
- Parallel implementation lane: **CA-K3-01 — ACTIVE**

The checked task file contains an earlier internal documentation-head reference. The later CA-MOD dispatch supplied `d90f1b64a4c227837f24e62eb22484006110e489` as current documentation authority. Repository verification showed the Corporate Admin docs branch exactly at that later head before CA-BU-01 mutation. This document therefore uses the later moderator authority and does not rewrite or alter the active CA-K3-01 lane.

PR #222 was independently confirmed Draft/Open/Unmerged at exact head `7b34dec1bc9f05b72b6abf0104db65980f280a0b` during inspection.

This document defines management ownership, scorecard eligibility, operating cadence, escalation and drill-down contracts only. It does **not** create legal entities, implement product code, define new metric formulas, change finance recognition, redefine customers, change K2B provenance, modify routes, create database schema, deploy, merge or mutate production.

---

## 2. Executive management position

The four accepted Business Units are **management constructs**, not proven subsidiaries or legal entities.

They exist so CarUp can answer four different questions:

1. What business outcome is this operating unit trying to create?
2. What demand, supply, throughput, quality and backlog facts can it truthfully manage?
3. Which operational workflows does the BU own, and which central control functions remain independent?
4. What should management review daily, weekly and monthly without distorting incompatible product domains?

The model intentionally avoids a synthetic “BU Health Score.”

A BU scorecard is a **structured management contract**, not a promise that every row will have every KPI.

---

## 3. BU management principles

### 3.1 Stable BU identity

The canonical BU IDs are stable:

- `BU_MARKETPLACE`
- `BU_SERVICE_NETWORK`
- `BU_FINANCIAL_SERVICES`
- `BU_DIASPORA_TRADE`

Labels may evolve by Owner decision, but downstream code, reporting and metric ownership should use the stable IDs.

### 3.2 Management unit ≠ legal entity

No BU name proves:

- incorporation;
- subsidiary status;
- statutory reporting entity;
- bank account ownership;
- tax residency;
- legal employer;
- separate company.

Legal entity remains a separate dimension governed by CA-ORG and future legal/accounting authority.

### 3.3 Operating ownership ≠ control ownership

A BU may own an operating process while a central function owns the control policy.

Examples:

- Marketplace operates listings and inquiries; Trust/Risk/Compliance governs central evidence/fraud/control policy.
- Financial Services operates finance/insurance/payment products; Corporate Finance & Accounting owns accounting policy.
- Diaspora Trade operates order/quote/logistics workflows; Legal/Governance and Trust/Risk/Compliance own central control policy.
- Service Network operates garage/service workflows; Platform owns technical integrations and Security controls.

### 3.4 Product participant ≠ internal organisational member

External dealers, garages, mechanics, lenders, insurers, logistics providers, buyers, sellers, government agencies and other tenants/providers are not internal BU staff merely because they participate in a BU product.

### 3.5 Relationship count ≠ Corporate customer count

BU scorecards may truthfully count:

- inquiries;
- buyers;
- sellers;
- work-order customers;
- Trade buyers/participants;
- finance applicants;
- insurance eligibility participants;

when source semantics permit.

Those counts must not be summed into a Corporate distinct-customer number.

### 3.6 Process amount ≠ accounting result

A BU may carry product commercial amounts when they are real source facts, but:

- listing price ≠ GMV;
- requested finance amount ≠ disbursement;
- quote amount ≠ revenue;
- scheduled milestone ≠ cash;
- escrow state ≠ recognized revenue;
- service amount ≠ recognized revenue.

### 3.7 K2B operational truth is mandatory for Actual

A BU Actual may include only rows eligible under accepted K2B provenance.

- operational: eligible for Actual where the source path consumes K2B;
- non-operational: excluded from Actual;
- UNKNOWN / needs review: excluded from Actual.

If exact source-path K2B consumption is not certified, the metric remains `CANDIDATE_AFTER_K2B_CONSUMPTION`.

### 3.8 Management questions determine metric choice

The scorecard should answer:

- Is demand changing?
- Is supply/capacity sufficient?
- Is work progressing?
- Is backlog accumulating?
- Is quality/control deteriorating?
- Where is geography relevant?
- Is data trustworthy?
- What requires management action?

Metrics that do not answer a management question remain diagnostic.

---

## 4. Canonical BU IDs and provisional labels

| Canonical ID | Provisional management label | Accepted organisational posture | Legal status |
| --- | --- | --- | --- |
| `BU_MARKETPLACE` | Marketplace & Vehicle Commerce | MVP management BU | UNKNOWN / not asserted |
| `BU_SERVICE_NETWORK` | Garage, Service & Parts | MVP management BU | UNKNOWN / not asserted |
| `BU_FINANCIAL_SERVICES` | Finance, Payments & Insurance | Customer-facing product BU | UNKNOWN / not asserted |
| `BU_DIASPORA_TRADE` | Diaspora Trade & Logistics | MVP management BU | UNKNOWN / not asserted |

### 4.1 Safe internal sub-domain defaults

These are management groupings, not new BUs:

**BU_MARKETPLACE**
- Marketplace;
- Dealer / Vehicle Commerce.

**BU_SERVICE_NETWORK**
- Garage & Service;
- Parts & Provenance / PartSentry.

**BU_FINANCIAL_SERVICES**
- Finance / Lending Product;
- Payments / Escrow Product;
- Insurance Product & Partner Ecosystem.

**BU_DIASPORA_TRADE**
- Trade Operations;
- Trade Compliance Operations;
- Logistics / Container Services.

Any promotion of these sub-domains into separate BUs requires CA-MOD/Owner authority.

---

# PART I — PER-BU MANAGEMENT CONTRACTS

## 5. BU_MARKETPLACE — Marketplace & Vehicle Commerce

### 5.1 Mandate

Manage the CarUp vehicle-commerce marketplace as a trusted operating system for:

- vehicle supply;
- publication;
- buyer discovery;
- seller/dealer participation;
- inquiries;
- transaction/reservation progression;
- moderation;
- trust/passport dependencies;
- dealer operating participation.

The mandate is to increase qualified, governed marketplace activity while preserving publication truth, trust controls and process integrity.

### 5.2 Included products/services

Included:

- public Marketplace vehicle supply;
- listing/publication lifecycle;
- vehicle detail/engagement surfaces;
- saved vehicles;
- Marketplace inquiries;
- vehicle-commerce transaction intent and reservation stages;
- private-seller participation;
- dealer inventory/commercial participation;
- seller publication readiness as an operational dependency;
- Marketplace moderation;
- Marketplace-specific fraud/risk operating queues;
- Marketplace demand intelligence;
- Marketplace buyer/seller journey intelligence.

### 5.3 Explicitly excluded

Excluded from BU ownership:

- Corporate Finance & Accounting;
- central identity policy;
- central evidence/trust policy;
- central fraud policy;
- Platform feature governance;
- Navigation telemetry infrastructure;
- generic communications-provider operations;
- dealer as a legal/internal CarUp entity;
- Corporate customer definition;
- statutory/legal vehicle ownership claims beyond governed product authority.

### 5.4 Customer/participant relationships

Valid source-accurate relationships include:

- anonymous Marketplace visitor;
- authenticated known shopper;
- saver;
- inquiry submitter;
- Marketplace buyer;
- private seller;
- dealer seller/merchant organisation;
- reservation participant;
- transaction-intent participant.

Do not call all of these “customers.”

A guest inquiry is an inquiry/contact relationship, not a confirmed person/customer.

### 5.5 Governed source domains

Primary current sources include:

- canonical vehicle/listing publication authority;
- current Marketplace Admin projection;
- `marketplace_inquiries`;
- `marketplace_activity_events`;
- `saved_vehicles`;
- transaction/reservation authorities;
- dealer profiles/compliance;
- vehicle evidence/trust/governance/fraud authorities;
- versioned Marketplace Intelligence rollups.

### 5.6 Business owner archetype

Proposed management archetype:

`BU_LEAD / MARKETPLACE_BUSINESS_LEAD`

This is a role archetype only. Authority is granted by CA-RBAC permissions and scope, not title.

### 5.7 Key operating-owner groups

Conceptual operating owners:

- Marketplace Operations;
- Vehicle Commerce / Dealer Operations;
- Marketplace moderation operators;
- seller/publication operations;
- inquiry/lead operations.

Central control functions remain separate.

### 5.8 Management questions

Daily/weekly management should be able to ask:

- How much **operational published supply** exists?
- What supply is not public and why?
- Is search/filter demand changing?
- Where do searches return no results?
- Which listings receive governed impressions, opens, saves or inquiries?
- How many operational inquiries are waiting or progressing?
- Where is seller publication blocked?
- Which dealer profiles require compliance attention?
- Is moderation backlog accumulating?
- Are fraud/evidence/trust queues constraining publication?
- Which linked journey stages show drop-off?
- Which vehicle/listing locations show demand/supply mismatch where source semantics allow?

### 5.9 Mandatory semantic protections

- **published listing ≠ operational vehicle**
- **publishable ≠ published**
- **inquiry ≠ sale**
- **listing price ≠ GMV**
- **reservation ≠ completed sale**
- **saved vehicle ≠ purchase**
- **listing open ≠ buyer**
- **dealer profile ≠ customer**
- **Trust score ≠ legal ownership**
- **moderation approval ≠ seller publication**

### 5.10 Operational queues

BU-owned or BU-facing queues:

- Marketplace listing moderation;
- buyer inquiry triage;
- seller/listing publication exceptions;
- dealer commercial-operation queue where distinct from central compliance.

Shared/control queues:

- vehicle evidence review → CF_TRUST_RISK_COMPLIANCE;
- fraud queue → CF_TRUST_RISK_COMPLIANCE;
- governance/trust review → CF_TRUST_RISK_COMPLIANCE;
- dealer compliance decision → control relationship to CF_TRUST_RISK_COMPLIANCE.

### 5.11 Growth/demand measures

Potential demand measures:

- operational Marketplace searches;
- zero-result searches;
- structured filter use;
- listing impressions;
- listing opens;
- saves;
- inquiries;
- demand by governed make/category/filter;
- linked detail→inquiry progression where certified;
- source/referral/campaign association where governed.

Navigation route renders remain discoverability telemetry and are not a commercial funnel stage.

### 5.12 Supply/capacity measures

Valid supply concepts:

- operational public listings;
- operational non-public listings by publication lifecycle;
- dealer/private-seller supply mix where source classification permits;
- publishable but not published population as a diagnostic operating state;
- current listing inventory by governed location/category.

Do not treat every vehicle record as Marketplace supply.

### 5.13 Throughput/journey

Potential linked process measures:

- listing created → publishable;
- publishable → published only if exact event lineage supports it;
- impression → detail;
- detail → save;
- detail → inquiry;
- inquiry → transaction intent;
- transaction intent → reservation.

Only linked cohorts/processes may be labelled conversion.

### 5.14 Finance authority

Current BU finance posture:

- listing prices: product facts only;
- requested/reservation/deposit/payment states: product process facts only;
- GMV: `PENDING_CA_FIN` / unavailable as Corporate accounting;
- recognized revenue: `PENDING_CA_FIN`;
- gross profit/margin: `PENDING_CA_FIN`;
- take rate: `PENDING_CA_FIN`;
- cash/AR/AP: central CA-FIN only.

### 5.15 Trust/risk obligations

Marketplace consumes central:

- identity;
- evidence;
- Trust;
- fraud;
- governance;
- dealer compliance.

BU operating management may see aggregate risk/backlog where permitted but does not own central control policy.

### 5.16 Backlog/cycle-time management

Potential backlog families:

- listings awaiting moderation;
- inquiries awaiting follow-up;
- seller/publication blocks;
- dealer compliance dependency backlog;
- evidence/trust/fraud queues affecting Marketplace.

Cycle-time candidates require explicit start/end events and versioned semantics. Do not invent “time to sale.”

### 5.17 Geography

Valid Marketplace geography dimensions may include:

- listing city/region;
- seller/dealer operating geography;
- inquiry geography where explicitly recorded;
- vehicle location.

Do not label listing geography “customer residence.”

### 5.18 Drill-downs

Business Units → BU_MARKETPLACE → metric/exception →:

- Customers & Growth demand view;
- Operations → Marketplace moderation/inquiry queue;
- Trust/Risk/Compliance → vehicle/evidence/fraud review;
- Dealer compliance;
- Data & Intelligence → metric/provenance details;
- Reports → Marketplace BU review.

Executive aggregate drill-down must stop before restricted PII/evidence unless separately authorized.

### 5.19 Reporting cadence

Daily:
- publication/supply exceptions;
- moderation;
- inquiries;
- critical fraud/trust dependencies.

Weekly:
- demand/supply;
- search/filter behavior;
- engagement;
- linked journey progression;
- dealer participation;
- backlog/cycle time;
- source quality.

Monthly:
- material Marketplace change;
- demand/supply shifts;
- strategic seller/dealer issues;
- unavailable finance/customer gaps;
- executive decisions required.

---

## 6. BU_SERVICE_NETWORK — Garage, Service & Parts

### 6.1 Mandate

Manage the CarUp service ecosystem covering:

- garage/service-provider participation;
- service requests/cases;
- work orders;
- job progression;
- parts/provenance;
- provider operating quality;
- service-network coverage;
- onboarding and compliance dependencies.

### 6.2 Included products/services

Included:

- public garage/service discovery as product supply;
- garage tenant workspaces;
- service cases;
- work orders;
- mechanic/service logs;
- work-order customer relationships;
- service-category demand;
- garage branch activity where source exists;
- Parts/PartSentry operating integration;
- parts RFQ demand;
- garage onboarding;
- service-provider operating state.

### 6.3 Explicitly excluded

Excluded:

- external garages as internal departments;
- Corporate customer truth;
- central Trust policy;
- central People/staffing policy;
- private cross-garage inventory aggregation without authority;
- supplier performance where no supplier principal exists;
- part compatibility where no fitment source exists;
- Corporate revenue/profit from service amounts.

### 6.4 Customer/participant relationships

Source-accurate relationships:

- service requester;
- work-order customer identified by `customer_id`;
- repeat identified work-order customer;
- garage tenant;
- mechanic;
- service provider;
- parts RFQ participant.

Preserve:

**work-order customer ≠ Corporate distinct customer**

A work order without `customer_id` must not be heuristically assigned to a person.

### 6.5 Governed source domains

Primary sources:

- `service_cases`;
- `mechanic_work_orders`;
- work-order assignments/service records;
- Marketplace service inquiries;
- garage tenant/workspace authority;
- garage onboarding applications;
- `partsentry_logs`;
- mechanic/garage parts inventory;
- part-quote inquiry records;
- `service@2` Intelligence;
- `parts_demand@1` Intelligence.

### 6.6 Business owner archetype

`BU_LEAD / SERVICE_NETWORK_BUSINESS_LEAD`

Title is descriptive only.

### 6.7 Key operating-owner groups

- Service Network Operations;
- Garage Operations;
- Parts & Provenance Operations.

Trust policy remains central.

### 6.8 Management questions

- How many service requests are arriving?
- How many are accepted, declined or cancelled?
- How many cases complete?
- What is service turnaround where both timestamps exist?
- Which service categories are in demand?
- Which branches receive case volume?
- How large is the work-order backlog?
- How many identified work-order customers return within the governed window?
- Which garages are onboarding or blocked?
- What PartSentry provenance activity exists?
- How much parts RFQ demand exists?
- Which capacity questions are currently unmeasurable?
- Where is service coverage geographically present?

### 6.9 Mandatory semantic protections

- **work-order customer ≠ Corporate distinct customer**
- **service amount ≠ recognized revenue**
- **accepted case ≠ completed job**
- **assigned work ≠ staff performance**
- **garage tenant ≠ internal CarUp department**
- **PartSentry flagged ≠ fraud verdict**
- **part RFQ ≠ sale**
- **free-text supplier field ≠ governed supplier principal**
- **vehicle Marketplace zero-result search ≠ parts zero-result demand**

### 6.10 Operational queues

BU-owned/facing:

- garage service request/case queue;
- work-order queue;
- job-stage exceptions;
- service completion/cancellation queue;
- garage onboarding operating handoff;
- parts RFQ operating queue where actionable.

Central/control:

- garage compliance → Trust/Risk/Compliance;
- identity/evidence → Trust/Risk/Compliance;
- PartSentry fraud adjudication → central Trust/Fraud;
- platform integration/provider issues → Platform.

### 6.11 Growth/demand

Potential demand measures:

- service requests;
- accepted requests;
- service-category demand;
- branch case volume;
- service inquiries;
- work orders;
- repeat identified work-order customers;
- parts RFQ demand.

Customer language remains source-specific.

### 6.12 Supply/capacity

Current source supports provider/garage/work-order activity, but **capacity utilisation is unavailable** because CarUp has no governed bays/slots/shifts/opening-hours capacity model.

Current source does not support per-person team-performance metrics because it lacks a governed workforce/working-hours denominator.

Capacity section therefore contains:

- known garage/provider presence where governed;
- active work/work-order counts;
- explicit capacity-data gap.

### 6.13 Throughput/journey

Service-case process:

- requested;
- accepted;
- active/started;
- completed;
- declined/cancelled.

`service@2` defines booking conversion as accepted service cases / all service requests with minimum-denominator handling.

Work-order completion rate is a separate work-order measure.

Do not merge case and work-order funnels without a governed join.

### 6.14 Backlog/cycle time

Potential:

- open service cases;
- open work orders;
- aging requests;
- started→completed turnaround where both timestamps exist;
- unmeasured-turnaround coverage.

A missing timestamp does not become zero duration.

### 6.15 Finance authority

Potential product facts:

- service price/amount only where authoritative;
- parts stock commercial values only within appropriate private organisational context.

Corporate status:

- service revenue: `PENDING_CA_FIN`;
- gross profit: `PENDING_CA_FIN`;
- contribution margin: `PENDING_CA_FIN`;
- cash/receivables: `PENDING_CA_FIN`.

### 6.16 Parts / PartSentry boundary

Valid current parts facts include:

- part RFQ volume/status;
- PartSentry provenance/verification states;
- garage's own parts inventory.

Unavailable:

- demand by structured part;
- supplier attribution/performance;
- compatibility/fitment;
- zero-result parts-search demand;
- cross-tenant inventory aggregate.

PartSentry remains a provenance capability and must not become a second Trust/Fraud authority.

### 6.17 Geography

Valid dimensions may include:

- garage operating city/province/country;
- service branch;
- service-case branch;
- provider coverage geography.

Do not infer customer residence from garage location.

### 6.18 Drill-downs

BU_DETAIL →:

- Service demand / Customers & Growth;
- Operations → garage cases/work orders;
- Trust → garage onboarding/compliance;
- Parts/PartSentry intelligence;
- Data/Intel source details;
- Reports.

### 6.19 Reporting cadence

Daily:
- waiting requests;
- active/open work;
- cancellations;
- onboarding blockers;
- trust/compliance blockers.

Weekly:
- request/accept/completion trends;
- turnaround;
- category demand;
- repeat identified service relationships;
- parts RFQ/provenance;
- source-quality gaps.

Monthly:
- network participation;
- geography/coverage;
- strategic capacity gaps;
- service-quality signals where governed;
- finance gaps;
- management decisions.

---

## 7. BU_FINANCIAL_SERVICES — Finance, Payments & Insurance

### 7.1 Mandate

Manage customer-facing finance, payments/escrow and insurance product demand and provider participation without acting as Corporate Finance & Accounting.

### 7.2 Included products/services

Included:

- finance applications;
- lender/provider participation;
- finance eligibility requests;
- provider decision stages when authoritative;
- insurance eligibility activity;
- insurance provider participation;
- policy/product workflow states where authoritative;
- Marketplace deposit/payment intent workflow;
- SafePay/escrow product states;
- product adoption/intent;
- payment/provider operating integration as it affects business workflow.

### 7.3 Explicitly excluded

Excluded:

- Corporate chart of accounts;
- accounting recognition;
- Corporate cash/treasury;
- AR/AP;
- general ledger;
- statutory reporting;
- Corporate revenue/gross profit;
- underwriting policy owned by external lenders/insurers unless CarUp has explicit authority;
- provider technical health as a business KPI except when it materially affects BU availability.

### 7.4 Customer/participant relationships

Source-accurate relationships:

- finance applicant;
- eligibility requester;
- lender/bank provider;
- insurance eligibility participant;
- policy/product participant where governed;
- insurer;
- payer/payee participant in payment workflow;
- escrow participant.

Do not call an applicant a disbursed borrower.

### 7.5 Governed source domains

- `finance_applications`;
- finance provider registrations/decisions;
- `eligibility_requests` capability=finance;
- `eligibility_requests` capability=insurance;
- insurance product/policy/claim sources where authoritative;
- Marketplace payment/deposit/transaction-intent sources;
- escrow trust sessions;
- SafePay/SafeTrade touchpoints only at the product-workflow grain;
- `finance_demand@1`;
- `insurance_demand@1`.

### 7.6 Business owner archetype

`BU_LEAD / FINANCIAL_SERVICES_BUSINESS_LEAD`

This is not CFO authority.

### 7.7 Management questions

- How many finance applications are received?
- How many authoritative lender decisions are recorded?
- How many applications await decision?
- Is a live lender/provider market active?
- What finance eligibility activity is live versus sandbox?
- What insurance eligibility activity is live versus sandbox?
- Which product workflows stop before provider decision?
- What deposit/payment/escrow process states exist?
- Are provider integrations preventing product progression?
- Which facts are product demand versus real money movement?
- Which accounting results remain unavailable?

### 7.8 Mandatory semantic protections

- **requested amount ≠ disbursement**
- **eligibility ≠ approval**
- **approval ≠ disbursement unless source says so**
- **payment intent ≠ cash**
- **deposit ≠ vehicle transaction value**
- **escrow held ≠ revenue**
- **sandbox escrow ≠ live settlement**
- **provider success ≠ recognized revenue**
- **insurance eligibility ≠ policy bound**
- **policy row ≠ policy bound through CarUp**
- **Finance/Payments product intelligence ≠ Corporate Finance & Accounting**

### 7.9 Operational queues

BU-owned/facing:

- finance application queue;
- provider-decision wait queue;
- insurance product/eligibility workflow;
- payment/deposit workflow exceptions;
- escrow-product workflow exceptions.

Central/shared:

- restricted financial reporting → CF_FINANCE_ACCOUNTING;
- provider technical outage → CF_PLATFORM_TECH;
- identity/AML/compliance policy → CF_TRUST_RISK_COMPLIANCE / CF_LEGAL_GOVERNANCE;
- data/metric source issues → CF_DATA_INTELLIGENCE.

### 7.10 Growth/demand

Finance candidates:

- applications received;
- authoritative decisions recorded;
- awaiting decision;
- live eligibility requests;
- eligible/not-eligible counts;
- decision rate where governed.

Insurance candidates:

- live eligibility requests;
- eligible/not-eligible;
- eligibility rate where governed.

Sandbox activity is diagnostic only and never market demand.

### 7.11 Supply/capacity

Supply/provider-side facts:

- active lender/provider registrations;
- active insurer/provider registrations;
- provider availability.

These are product supply/market-enablement facts, not Corporate headcount/capacity.

Provider technical telemetry remains `TECHNICAL_OPERATIONAL` unless it materially blocks the BU and is presented as an exception.

### 7.12 Throughput/journey

Finance journey candidates:

- application received;
- awaiting provider decision;
- authoritative decision;
- later stages only if source is proven.

There is **no disbursement state** in accepted current authority.

Insurance journey candidates:

- eligibility request;
- eligible/not eligible;
- quote/provider decision only when authoritative;
- policy bound unavailable today.

### 7.13 Backlog/cycle time

Potential:

- applications awaiting decision;
- age since application;
- provider decision latency only when both events are recorded;
- eligibility processing latency if timestamps support it;
- payment/escrow workflow age.

Do not fabricate approval/disbursement cycle time from missing events.

### 7.14 Finance authority state

BU product monetary facts may include:

- requested amount;
- quoted APR;
- product deposit/payment amount;
- escrow amount by explicit mode/currency.

They remain product facts.

Corporate accounting:

- GMV: `PENDING_CA_FIN`;
- recognized revenue: `PENDING_CA_FIN`;
- cash: `PENDING_CA_FIN`;
- gross profit: `PENDING_CA_FIN`;
- AR/AP: `PENDING_CA_FIN`;
- take rate: `PENDING_CA_FIN`;
- contribution margin: `PENDING_CA_FIN`.

### 7.15 Trust/risk/compliance obligations

Financial Services consumes:

- identity/verification;
- regulated-provider governance;
- finance/insurance consent;
- fraud/risk controls;
- legal/regulatory policy.

Business scorecards may show aggregate compliance state, not private applicant evidence by default.

### 7.16 Geography

Valid dimensions may include:

- provider jurisdiction;
- product availability country;
- applicant geography only where an authoritative attribute and RBAC allow it;
- transaction/payment jurisdiction if explicitly recorded.

Do not infer customer residence from lender/insurer location.

### 7.17 Drill-downs

BU_FINANCIAL_SERVICES →:

- Finance-product demand;
- Insurance-product demand;
- Operations application queue;
- provider/product availability;
- Trust/Compliance;
- Data/Intel;
- Corporate Finance page for **accounting** state only.

Crossing from BU product finance into Corporate Finance is an explicit domain transition.

### 7.18 Reporting cadence

Daily:
- application/provider queues;
- provider availability;
- workflow exceptions;
- sandbox/live separation.

Weekly:
- product demand;
- decision throughput;
- waiting population;
- insurance demand;
- payment/escrow workflow state;
- compliance exceptions.

Monthly:
- product adoption/intention;
- provider participation;
- strategic regulatory/provider risks;
- accounting gaps;
- requested executive decisions.

---

## 8. BU_DIASPORA_TRADE — Diaspora Trade & Logistics

### 8.1 Mandate

Manage CarUp's cross-border Trade operating system covering:

- trade participants;
- buyer requests/import orders;
- RFQs;
- supplier quotes;
- quote acceptance;
- documents;
- Trade compliance;
- logistics/container workflows;
- cargo/shipment progression;
- SafeTrade workflow;
- Trade Graph relationships.

### 8.2 Included products/services

Included:

- Trade profiles;
- import orders;
- Request Quotes / RFQ workflows;
- supplier/buyer quote relationships;
- accepted quote operations;
- Trade documents;
- warehouse/cargo intake;
- container loading;
- shipment movement;
- customs/destination;
- participant tracking;
- container co-loading;
- Trade Rate Research;
- Trade Graph;
- SafeTrade workflow;
- workbook/import operational tooling;
- Trade compliance.

### 8.3 Explicitly excluded

Excluded:

- legal subsidiary claims;
- Corporate customer status for every participant;
- accounting revenue from quotes/charges;
- cash from scheduled milestones;
- live settlement claims from sandbox providers;
- customer residence inferred from corridor;
- shipment demand where no shipment records exist;
- landed-cost calculation where no structured source exists.

### 8.4 Customer/participant relationships

Source-accurate relationships:

- Trade profile participant;
- Trade buyer;
- buyer request/order owner;
- supplier/dealer;
- quote submitter;
- accepted supplier;
- logistics provider;
- container/cargo participant;
- government/reviewer participant where externally authorized.

Preserve:

**Trade participant ≠ customer by default**

### 8.5 Governed source domains

- `diaspora_import_orders`;
- `diaspora_import_quotes`;
- `diaspora_payment_milestones`;
- `escrow_trust_sessions`;
- Trade profile/participant authority;
- RFQ/request metadata;
- Trade document authority;
- container/cargo/shipment sources;
- Trade Graph derived authority;
- SafeTrade sources;
- Diaspora compliance/workbook sources;
- `trade_demand@1`.

### 8.6 Business owner archetype

`BU_LEAD / DIASPORA_TRADE_BUSINESS_LEAD`

### 8.7 Management questions

- How many buyer requests/orders are created?
- How many requests are published as RFQs?
- How many receive submitted offers?
- How many have an accepted quote?
- What is the time to first submitted offer where measurable?
- Which corridors are represented?
- How many quotes are issued/accepted?
- What amounts are quoted by currency?
- What milestones are scheduled versus confirmed?
- Is any live escrow provider used?
- What Trade processes are blocked by documentation/compliance?
- What logistics/container/shipment stages are actually recorded?
- Which desired logistics metrics remain unavailable?
- How much activity is Trade Graph derivation versus authoritative row fact?

### 8.8 Mandatory semantic protections

- **Trade participant ≠ customer by default**
- **quote ≠ revenue**
- **quote amount ≠ recognized revenue**
- **requested budget ≠ transaction value**
- **scheduled milestone ≠ cash**
- **sandbox settlement ≠ live settlement**
- **escrow state ≠ revenue**
- **corridor geography ≠ customer residence**
- **order corridor ≠ travelled route**
- **commercial charge class ≠ accounting revenue**
- **accepted quote ≠ completed shipment**
- **Trade Graph derived relationship ≠ recorded operational fact**

### 8.9 Operational queues

BU-owned/facing:

- buyer request/order queue;
- RFQ publication;
- supplier-offer queue;
- quote acceptance follow-through;
- Trade document operations;
- workbook/import operations;
- warehouse/cargo intake;
- container loading;
- shipment/customs operations;
- Trade communications.

Shared/control:

- compliance → Trust/Risk/Compliance / Legal;
- provider integration → Platform;
- finance recognition → Corporate Finance;
- metrics/provenance → Data & Intelligence.

### 8.10 Growth/demand

Potential:

- buyer requests/orders;
- published RFQs;
- submitted offers;
- requests receiving offer;
- accepted quote count;
- corridor demand at order-request grain;
- supplier participation;
- repeat Trade buyer relationship where customer/identity definition permits.

Do not label route/corridor as customer geography.

### 8.11 Supply/capacity

Potential:

- submitted supplier offers;
- active supplier participation;
- container space only where authoritative operational records exist;
- warehouse/loading capacity only when a governed capacity model exists.

Current Trade Intelligence does not support a general shipment/container-demand KPI from empty shipment/container records.

### 8.12 Throughput/journey

Linked Trade process candidates:

- request created;
- RFQ published;
- submitted offer received;
- accepted quote;
- downstream logistics/document milestones where linked;
- operational completion when exact domain state is defined.

Trade Intelligence already supports:

- request counts;
- requests with offers;
- offer-to-award;
- time to first offer for measurable cases.

These remain candidates for Corporate Actual until exact K2B source consumption is certified.

### 8.13 Finance authority

Valid product commercial facts:

- requested budget by currency;
- quoted amount by currency;
- scheduled milestone amounts by currency;
- explicit live vs sandbox escrow sessions.

Do not combine currencies.

Corporate accounting status:

- settled trade value: unavailable;
- revenue: `PENDING_CA_FIN`;
- gross profit: `PENDING_CA_FIN`;
- cash: `PENDING_CA_FIN`;
- take rate/contribution margin: `PENDING_CA_FIN`.

### 8.14 Trust/risk/compliance

BU consumes:

- Trade compliance;
- identity;
- provider/supplier controls;
- Trust/evidence where applicable;
- legal/regulatory governance.

No compliance-cleared metric if no authoritative review event exists.

### 8.15 Backlog/cycle time

Potential:

- unpublished/draft request backlog;
- published RFQ awaiting offer;
- accepted quote awaiting next process stage;
- document/compliance waiting;
- warehouse/loading/customs waiting;
- time to first submitted offer;
- milestone confirmation waiting.

Never infer stage times where timestamps are absent.

### 8.16 Geography

Valid geography:

- order origin country/city;
- order destination country/city;
- corridor;
- supplier operating geography;
- logistics route only when shipment route exists.

Do not call corridor “customer residence.”

If only one corridor exists, show it as observed coverage rather than “top corridor.”

### 8.17 Trade Graph

Trade Graph may support derived relationship/opportunity views.

It must be visually/semantically marked:

`DIAGNOSTIC_ONLY / derived graph intelligence`

unless specific graph metrics are separately registered and certified.

It may not override authoritative order/quote/shipment facts.

### 8.18 Drill-downs

BU_DIASPORA_TRADE →:

- Trade demand;
- RFQ/quote funnel;
- Trade Operations;
- logistics/container workspaces;
- Trade compliance;
- SafeTrade product workflow;
- Data/Intel;
- Reports.

### 8.19 Reporting cadence

Daily:
- open requests;
- published RFQs awaiting offers;
- accepted-quote follow-up;
- blocked documents/compliance;
- logistics/workbook exceptions.

Weekly:
- request/offer/award flow;
- time to first offer;
- corridor demand;
- supplier participation;
- milestone/escrow product states;
- provenance/source gaps.

Monthly:
- material corridor/participant change;
- strategic supplier/logistics risks;
- product workflow adoption;
- unavailable settlement/revenue gaps;
- executive decisions.

---

# PART II — CENTRAL FUNCTIONS AND SCORECARD CONTRACT

## 9. Central Corporate function dependency model

BUs consume central functions; they do not duplicate them.

| Central function | Central ownership | Marketplace relationship | Service Network relationship | Financial Services relationship | Diaspora Trade relationship |
| --- | --- | --- | --- | --- | --- |
| `CF_EXECUTIVE` | Corporate strategy / enterprise management | Reviews BU contribution | Reviews BU contribution | Reviews BU contribution | Reviews BU contribution |
| `CF_FINANCE_ACCOUNTING` | Accounting policy, recognition, management accounting | Receives future governed commerce facts | Receives future governed service facts | **Separate from BU finance product** | Receives future governed Trade facts |
| `CF_CUSTOMERS_GROWTH` | Customer/growth semantics, acquisition, cross-BU demand | Marketplace demand/growth service | Service demand/growth service | Product demand/growth service | Trade demand/growth service |
| `CF_TRUST_RISK_COMPLIANCE` | Central Trust/control policy | Evidence, fraud, dealer, seller controls | Garage/PartSentry control matrix | Identity/regulatory/risk controls | Trade compliance/control |
| `CF_DATA_INTELLIGENCE` | Metric registry, lineage, provenance consumption, quality | Marketplace metrics | Service/parts metrics | Finance/insurance product metrics | Trade/logistics metrics |
| `CF_LEGAL_GOVERNANCE` | Legal/regulatory governance | Dealer/commerce policy | Garage/service policy | Regulated product policy | Cross-border/trade policy |
| `CF_PEOPLE_ADMIN` | Internal membership/access administration | Internal BU team only | Internal BU team only | Internal BU team only | Internal BU team only |
| `CF_PLATFORM_TECH` | Platform, integrations, AI/model, feature, security | Marketplace platform dependencies | Garage/service integrations | Provider/payment integrations | Trade/logistics/provider platform |

### 9.1 Central-control invariant

A BU may be accountable for operating outcomes without being authorized to change:

- Corporate metric definitions;
- finance recognition;
- K2B provenance classification;
- identity/evidence policy;
- access-control policy;
- platform-security policy.

---

## 10. Reusable BU scorecard contract

Every BU detail page/report should use the following **slots**, not mandatory identical KPIs.

### A. BU mandate / management context

Required:

- BU ID;
- display label;
- selected organisation/geography scope;
- reporting period;
- management owner archetype;
- source/provenance state;
- current significant exceptions.

### B. Demand / customer-participant activity

Examples:

- searches/inquiries;
- service requests;
- finance applications;
- Trade orders/RFQs.

Must use source-accurate participant language.

### C. Supply / capacity

Examples:

- published listings;
- active service providers;
- lender/insurer availability;
- supplier offers.

Capacity must not be invented from counts when no capacity denominator exists.

### D. Throughput / journey progression

Only linked process/funnel metrics.

Must state:

- stage A;
- stage B;
- link key;
- window;
- denominator;
- metric version.

### E. Quality / trust / compliance

Examples:

- review backlog;
- fraud cases;
- compliance status;
- PartSentry provenance.

Central control ownership remains visible.

### F. Backlog / cycle time

Must distinguish:

- backlog count;
- aging;
- throughput;
- cycle time.

Missing timestamps do not become zero.

### G. Geography / market dimensions

Only authoritative geography with explicit type.

### H. Finance / commercial values

Only where CA-FIN permits.

Product amounts must be labelled as such.

### I. Data quality / provenance / freshness

Required:

- K2B consumption status;
- excluded non-operational count where available;
- UNKNOWN/not-counted state;
- source freshness;
- metric version;
- degraded/incomplete warning.

### J. Management attention / exceptions

Only governed exception rules.

Do not generate synthetic health/severity without authority.

---

## 11. Metric eligibility vocabulary

CA-BU uses exactly the following management eligibility statuses.

### `CERTIFIED_CURRENT`

The current exact source path is proven at accepted authority to:

- read authoritative facts;
- apply accepted K2B operational provenance where relevant;
- distinguish read failure from measured zero;
- preserve metric semantics.

This does **not** mean the metric is automatically a Corporate KPI. It means it may be consumed as a current source-accurate BU fact.

### `CANDIDATE_AFTER_K2B_CONSUMPTION`

The metric definition/source is governed enough to be a candidate, but its exact source path has not yet proven accepted K2B consumption for BU Actual.

### `BLOCKED_OWNER_DECISION`

Source may exist, but business meaning requires unresolved Owner policy.

### `PENDING_CA_FIN`

An accounting/economic metric cannot be activated until CA-FIN establishes source and recognition authority.

### `UNAVAILABLE_NO_SOURCE`

No authoritative source/required state currently exists.

### `UNAVAILABLE_NOT_SEPARABLE`

Source data exists but cannot support the requested grain or distinction.

### `DIAGNOSTIC_ONLY`

Useful operating/analytical context but not a management outcome KPI.

### `TECHNICAL_OPERATIONAL`

Platform/provider/runtime fact, not business performance.

---

# PART III — PER-BU METRIC ELIGIBILITY

## 12. BU_MARKETPLACE metric eligibility

| Candidate metric/fact | Source posture | Eligibility | Management use / guard |
| --- | --- | --- | --- |
| Operational listing population | Current K2B Admin projection | `CERTIFIED_CURRENT` | Queue/snapshot fact; not all vehicles |
| Public/published listing count | Current publication projection using listing visibility | `CERTIFIED_CURRENT` | Marketplace supply |
| Non-public operational listings by lifecycle | Current K2B Admin projection | `CERTIFIED_CURRENT` | Operating supply exception |
| Suppressed/rejected listing population | Current Admin moderation projection | `CERTIFIED_CURRENT` | Operations/control |
| Operational Marketplace inquiry count | Current K2B Admin inquiries/analytics path | `CERTIFIED_CURRENT` | Inquiry volume, not sales |
| Operational dealer profiles in compliance queue | K2B-aware dealer projection | `CERTIFIED_CURRENT` | Dealer operating/control population |
| Operational fraud queue cases | K2B-aware fraud projection | `CERTIFIED_CURRENT` | Risk workload; central control |
| Searches | Marketplace activity ledger | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Demand |
| Zero-result search count/rate | Marketplace activity ledger | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Unmet recorded search demand |
| Structured filter use | Marketplace activity ledger | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Demand segmentation |
| Listing impressions | Marketplace activity ledger | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Exposure |
| Listing opens/detail views | Marketplace activity ledger | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Consideration |
| Saves | `saved_vehicles` + activity observation | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Engagement |
| Daily unique shopper/link-key count | Marketplace rollup | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Daily only |
| Multi-day true unique shoppers | Current projection uses peak-day unique | `UNAVAILABLE_NOT_SEPARABLE` | Never label peak-day as period unique |
| Human-readable top free-text search terms | Query stored as hash | `UNAVAILABLE_NOT_SEPARABLE` | Structured filters remain available |
| Detail→inquiry linked conversion | Linked Marketplace event/business authority | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Only after linkage coverage certified |
| Inquiry→transaction progression | Inquiry/transaction authority | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Process outcome, not revenue |
| Transaction→reservation progression | Transaction/reservation authority | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Process outcome |
| Completed dealer sales | No certified completed dealer-sale source | `UNAVAILABLE_NO_SOURCE` | Do not infer |
| Marketplace customer count | Customer policy unresolved | `BLOCKED_OWNER_DECISION` | Do not relabel shoppers/inquiries |
| Active Marketplace customers | Customer activity definition unresolved | `BLOCKED_OWNER_DECISION` | Blocked |
| Marketplace GMV | Accounting authority absent | `PENDING_CA_FIN` | Listing price not GMV |
| Marketplace recognized revenue | Accounting authority absent | `PENDING_CA_FIN` | No derivation from deposits/listing price |
| Gross profit/margin | Accounting authority absent | `PENDING_CA_FIN` | Blocked |
| Navigation route renders to Marketplace | Navigation telemetry | `DIAGNOSTIC_ONLY` | Discoverability only |
| Platform/provider health | Technical services | `TECHNICAL_OPERATIONAL` | Exception input only |

---

## 13. BU_SERVICE_NETWORK metric eligibility

| Candidate metric/fact | Source posture | Eligibility | Management use / guard |
| --- | --- | --- | --- |
| Service requests/cases | `service_cases` / `service@2` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Demand |
| Accepted service cases | `service_cases` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Throughput |
| Declined/cancelled cases | `service_cases` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Exception/quality |
| Booking conversion | accepted/requested in `service@2` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Process rate; min denominator |
| Turnaround hours | started→completed cases | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Measured coverage must display |
| Service category demand | `service_cases.service_category` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Demand |
| Branch case volume | `service_cases.branch_id` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Operating scope |
| Work orders | `mechanic_work_orders` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Workload |
| Completed/open work orders | work-order status | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Backlog/throughput |
| Identified work-order customers | `customer_id` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Relationship only |
| Repeat identified work-order customers | same `customer_id` repeated | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Domain relationship; not Corporate retention |
| Practitioner contributing count | work-order mechanic IDs | `DIAGNOSTIC_ONLY` | Not performance |
| Capacity utilisation | no bays/slots/shifts model | `UNAVAILABLE_NO_SOURCE` | Do not infer |
| Team performance/productivity | no roster/hours denominator | `UNAVAILABLE_NO_SOURCE` | Do not rank mechanics |
| Parts RFQ volume/status | `marketplace_inquiries` type=part quote | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Parts demand |
| PartSentry verification/provenance counts | `partsentry_logs` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Provenance; fraud separate |
| Demand by structured part | RFQ has no part reference | `UNAVAILABLE_NOT_SEPARABLE` | Cannot classify exact part demand |
| Supplier performance | no supplier principal | `UNAVAILABLE_NO_SOURCE` | Free text not supplier authority |
| Parts compatibility/fitment | no compatibility source | `UNAVAILABLE_NO_SOURCE` | Safety-critical; do not infer |
| Zero-result parts demand | no parts search surface | `UNAVAILABLE_NO_SOURCE` | Vehicle searches not parts demand |
| Cross-garage inventory | private org data/no platform aggregate authority | `UNAVAILABLE_NOT_SEPARABLE` | Own-garage inventory only |
| Service revenue | accounting authority absent | `PENDING_CA_FIN` | Service amount ≠ revenue |
| Service gross profit/margin | accounting authority absent | `PENDING_CA_FIN` | Blocked |
| Corporate distinct service customers | customer policy/person resolution unresolved | `BLOCKED_OWNER_DECISION` | Work-order customers not Corporate distinct |

---

## 14. BU_FINANCIAL_SERVICES metric eligibility

| Candidate metric/fact | Source posture | Eligibility | Management use / guard |
| --- | --- | --- | --- |
| Finance applications received | `finance_applications` / `finance_demand@1` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product demand |
| Authoritative finance decisions recorded | decision timestamp/source | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product throughput |
| Applications awaiting decision | derived from governed decision authority | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Backlog |
| Decision rate | decided/application | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Requires min denominator |
| Live finance eligibility requests | `eligibility_requests` mode=live | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product demand |
| Sandbox finance eligibility | simulated provider | `DIAGNOSTIC_ONLY` | Never market demand |
| Requested finance amount | application request | `DIAGNOSTIC_ONLY` | Intent only; not book/disbursement |
| Finance disbursements | no state/source | `UNAVAILABLE_NO_SOURCE` | Do not infer |
| Loan portfolio value | no disbursed book | `UNAVAILABLE_NO_SOURCE` | Do not sum requested amount |
| Live insurer eligibility requests | insurance demand source | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product demand |
| Sandbox insurer eligibility | simulated provider | `DIAGNOSTIC_ONLY` | Never market demand |
| Insurance quote submissions | no provider decision observed | `UNAVAILABLE_NO_SOURCE` | Blocked |
| Policies bound through CarUp | no binding authority | `UNAVAILABLE_NO_SOURCE` | Policy row not enough |
| Insurance renewals | no renewal events | `UNAVAILABLE_NO_SOURCE` | Blocked |
| Active lender/provider roster | provider registration | `TECHNICAL_OPERATIONAL` | Product enablement; not business outcome |
| Active insurer/provider roster | provider registration | `TECHNICAL_OPERATIONAL` | Product enablement |
| Deposit/payment workflow counts | product payment source | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Process facts only |
| Payment intent amount | product intent | `DIAGNOSTIC_ONLY` | Not cash |
| Escrow live sessions/state | product escrow source | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product workflow; not revenue |
| Escrow sandbox sessions | simulated | `DIAGNOSTIC_ONLY` | Never live business outcome |
| Product customer count | qualification unresolved | `BLOCKED_OWNER_DECISION` | Applicant/eligible ≠ customer automatically |
| GMV | accounting authority absent | `PENDING_CA_FIN` | Blocked |
| Recognized revenue | accounting authority absent | `PENDING_CA_FIN` | Blocked |
| Cash | accounting authority absent | `PENDING_CA_FIN` | Payment intent ≠ cash |
| AR/AP | accounting authority absent | `PENDING_CA_FIN` | Blocked |
| Gross profit/take rate/contribution margin | accounting authority absent | `PENDING_CA_FIN` | Blocked |

---

## 15. BU_DIASPORA_TRADE metric eligibility

| Candidate metric/fact | Source posture | Eligibility | Management use / guard |
| --- | --- | --- | --- |
| Buyer requests/import orders | `diaspora_import_orders` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Demand/process |
| RFQs published | order metadata / governed RFQ state | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Throughput |
| Submitted offers/quotes | `diaspora_import_quotes` | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Supplier participation |
| Requests with offer | linked order/quotes | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Process progression |
| Accepted quotes | atomic quote acceptance | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Buyer decision, not revenue |
| Published→offer rate | linked order/quote process | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Linked process rate |
| Offer→award rate | linked order/quote process | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Linked process rate |
| Time to first submitted offer | measurable published→first offer | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Cycle time with coverage |
| Corridor demand | order origin/destination | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Request corridor, not customer residence |
| Requested budgets by currency | order product fact | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Intent only |
| Quoted amounts by currency | quote product fact | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Commercial quote, not revenue |
| Scheduled milestone count/amount | milestone authority | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Obligation/schedule, not cash |
| Confirmed milestones | confirmed_at | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Product process fact |
| Live escrow sessions | product source | `CANDIDATE_AFTER_K2B_CONSUMPTION` | Workflow only |
| Sandbox escrow sessions | simulated | `DIAGNOSTIC_ONLY` | Not live settlement |
| Settled trade value | no confirmed live payment | `UNAVAILABLE_NO_SOURCE` | Scheduled/sandbox amounts forbidden |
| Live SafeTrade completion | live payment constrained/unobserved | `UNAVAILABLE_NO_SOURCE` | Blocked |
| Shipment demand | no shipment records in accepted intelligence authority | `UNAVAILABLE_NO_SOURCE` | Do not use order corridor as shipment |
| Route demand | no shipment records | `UNAVAILABLE_NO_SOURCE` | Corridor ≠ travelled route |
| Landed cost | no structured duty/freight/tax breakdown | `UNAVAILABLE_NO_SOURCE` | Do not invent |
| Vehicle-linked Trade outcomes | orders lack authoritative VIN linkage in accepted intelligence | `UNAVAILABLE_NO_SOURCE` | No Trust/listing join |
| Compliance-cleared orders | no authoritative recorded review in current intelligence | `UNAVAILABLE_NO_SOURCE` | Do not infer |
| Trade Graph relationship/opportunity | separate derived graph authority | `DIAGNOSTIC_ONLY` | Derived, not actual order fact |
| Trade customer count | qualification policy unresolved | `BLOCKED_OWNER_DECISION` | Participant/buyer ≠ universal customer |
| Recognized revenue/gross profit/cash | accounting authority absent | `PENDING_CA_FIN` | Quote/milestone ≠ accounting |

---

# PART IV — CROSS-BU MANAGEMENT

## 16. Legitimate cross-BU comparison rules

### 16.1 Comparisons allowed when definitions genuinely align

Valid cross-BU comparisons may include:

- source freshness;
- proportion of metrics degraded/unavailable;
- backlog age using a deliberately harmonized aging definition;
- queue counts by the same control class;
- cycle time only where start/end semantics are explicitly comparable;
- period-over-period growth of the **same registered metric family**;
- management attention counts by governed category;
- operational provenance exclusion/UNKNOWN counts;
- risk/compliance backlog by the same central-control classification;
- report timeliness.

### 16.2 Comparisons allowed only with explicit domain labels

Examples:

- Marketplace inquiries versus Service requests versus Trade buyer requests may appear in a “Demand activity” matrix, but they must remain separate measures.
- Marketplace detail→inquiry versus Trade RFQ→offer rates may appear as separate journey KPIs, but not one ranked “conversion” column.
- Published vehicle supply and active service providers may both appear under “Supply/Capacity,” but not as comparable units.

### 16.3 Forbidden comparisons

Do not:

- sum BU customer/participant counts into Corporate distinct customers;
- rank BUs by unavailable revenue;
- sum listing price, service amount, requested finance, quote amount and milestones;
- compare Marketplace inquiry rate with Trade quote acceptance as if equivalent;
- compare service booking conversion with finance decision rate as one universal conversion;
- construct one weighted “BU Health Score”;
- infer profitable BU ranking without CA-FIN;
- infer customer-growth ranking where customer definitions differ;
- normalize metrics with an invented denominator;
- use route renders as a cross-BU active-user metric.

### 16.4 Cross-BU scorecard presentation

The recommended comparison matrix contains metric **families**, not forced common numbers:

| BU | Demand/activity | Supply/capacity | Throughput | Trust/control | Backlog/cycle | Finance authority | Data quality |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Marketplace | domain metrics | domain metrics | domain metrics | domain metrics | domain metrics | mostly blocked | state |
| Service Network | domain metrics | domain metrics/gaps | domain metrics | domain metrics | domain metrics | blocked | state |
| Financial Services | applications/eligibility | providers | decisions/workflow | regulated controls | decision backlog | accounting blocked | state |
| Diaspora Trade | orders/RFQs | suppliers/logistics where sourced | offers/awards | trade compliance | process aging | accounting blocked | state |

No row receives a synthetic total score.

---

## 17. Management cadence

### 17.1 Daily operational review

**Purpose:** remove immediate operating blockers.

Questions:

- What is waiting?
- What failed?
- What crossed a governed SLA/threshold?
- Which source is degraded?
- Which central function must act?

Typical inputs:

- queue counts;
- oldest items;
- failures;
- current throughput;
- critical compliance/risk blocks;
- source freshness.

Output:

- assigned operational actions;
- escalations;
- acknowledged data issues.

No strategic performance judgment from one day's noise without baseline.

### 17.2 Weekly BU review

**Purpose:** manage trend and operating execution.

Required structure:

1. BU mandate/context.
2. Changes from previous comparable period.
3. Demand/activity.
4. Supply/capacity.
5. Throughput/journey.
6. Backlog/cycle time.
7. Trust/risk/compliance.
8. Geography where valid.
9. Finance/commercial product facts with authority state.
10. Data quality/provenance.
11. Actions/decisions required.

BU-specific emphases:

- Marketplace: supply, demand, inquiries, publication, moderation.
- Service: requests, completion, turnaround, network/parts.
- Financial Services: applications/eligibility/provider decision flow.
- Diaspora: requests/RFQs/offers/award/corridors/process blocks.

### 17.3 Monthly executive review

**Purpose:** explain material BU contribution and structural risks.

Include:

- material change;
- strategic demand/supply movement;
- bottlenecks;
- risk/control issues;
- finance authority state;
- critical source/metric gaps;
- cross-BU dependencies;
- requested executive decisions.

Exclude:

- raw queue detail unless material;
- ungoverned targets;
- invented financial results.

### 17.4 Quarterly strategy / board contribution

**Purpose:** support strategic direction.

Inputs:

- accepted monthly trends;
- strategic opportunity/risk;
- geographic expansion evidence;
- product/BU structural issues;
- finance state when authoritative;
- major Owner decisions;
- data/authority gaps that constrain strategy.

No quarterly “profitability” narrative until accounting authority exists.

---

## 18. Escalation model

### 18.1 BU-local issue

Remain inside BU when:

- issue is a routine operating queue;
- no central policy/control is implicated;
- action is within BU permission/scope;
- source/metric is not in conflict;
- no legal/security/accounting decision is required.

### 18.2 Central-function escalation

| Issue type | Escalate to | BU retains |
| --- | --- | --- |
| Identity/evidence/fraud/compliance | `CF_TRUST_RISK_COMPLIANCE` | Operating context and remediation |
| Legal/regulatory ambiguity | `CF_LEGAL_GOVERNANCE` | Product facts |
| Accounting/revenue/cash discrepancy | `CF_FINANCE_ACCOUNTING` | Source commercial facts |
| Customer/growth definition/attribution | `CF_CUSTOMERS_GROWTH` | Domain activity |
| Metric/source conflict | `CF_DATA_INTELLIGENCE` | Source operating context |
| Provider/integration/runtime outage | `CF_PLATFORM_TECH` | Business impact |
| Security incident | Security within `CF_PLATFORM_TECH` / independent security authority | Business impact |
| Internal access/membership issue | `CF_PEOPLE_ADMIN` / Access governance | Business need |
| Cross-BU strategic conflict | `CF_EXECUTIVE` | BU recommendation |

### 18.3 Escalation severity

CA-BU does not create numeric severity thresholds.

A future threshold may only be displayed when:

- policy owner is identified;
- metric/source is governed;
- threshold version is governed;
- escalation target is defined.

Until then, use explicit workflow states and age, not arbitrary red/green severity.

---

## 19. Current route/domain ownership map

This map is conceptual ownership, not route mutation.

### 19.1 BU_MARKETPLACE

| Current surface/domain | Conceptual BU/function owner | Notes |
| --- | --- | --- |
| `/marketplace` and listing/detail/compare | `BU_MARKETPLACE` | Public commerce product |
| `/dealers` | `BU_MARKETPLACE` | External dealer discovery |
| `/dealer`, inventory, leads, promotions, analytics | `BU_MARKETPLACE` | External dealer participant workspace |
| `/admin/moderation` | `BU_MARKETPLACE` Operations + Trust matrix | Marketplace moderation/inquiries |
| seller/listing publication flows | `BU_MARKETPLACE` | Publication authority preserved |
| `/admin/dealer-compliance` | `CF_TRUST_RISK_COMPLIANCE` control; BU context | Do not move policy into BU |
| `/admin/evidence`, vehicle review | central Trust control; BU dependency | Evidence/trust is shared |
| `/admin/fraud-queue` | central Trust/Fraud; BU dependency | Aggregate may appear in BU scorecard |

### 19.2 BU_SERVICE_NETWORK

| Current surface/domain | Conceptual BU/function owner | Notes |
| --- | --- | --- |
| `/garages` / garage detail | `BU_SERVICE_NETWORK` | External provider discovery |
| `/marketplace/services` | `BU_SERVICE_NETWORK` product line | Service discovery |
| `/garage`, cases, customers, profile, team | `BU_SERVICE_NETWORK` | External garage tenant workspace |
| `/mechanic`, work orders, service logs | `BU_SERVICE_NETWORK` | External/service participant workspace |
| `/mechanic/parts` | `BU_SERVICE_NETWORK` Parts | Scoped parts operations |
| `/dashboard/partsentry` | `BU_SERVICE_NETWORK` + central Trust matrix | Provenance capability |
| `/marketplace/parts` | `BU_SERVICE_NETWORK` Parts | Parts marketplace |
| `/admin/garage-applications` | BU onboarding + central Trust/People dependencies | Approval/workspace creation are separate |
| PartSentry fraud decisions | `CF_TRUST_RISK_COMPLIANCE` | Not BU-local fraud policy |

### 19.3 BU_FINANCIAL_SERVICES

| Current surface/domain | Conceptual BU/function owner | Notes |
| --- | --- | --- |
| `/bank` / applications / collateral / risk | `BU_FINANCIAL_SERVICES` participant workspace | External lender context |
| `/insurance` | `BU_FINANCIAL_SERVICES` | Product discovery |
| `/insurance-dash` / claims / risk / fraud | `BU_FINANCIAL_SERVICES` product/provider workspace with central control matrix | External insurer role |
| finance applications / eligibility services | `BU_FINANCIAL_SERVICES` | Product demand |
| insurance eligibility/product services | `BU_FINANCIAL_SERVICES` | Product demand |
| Marketplace deposit/payment workflow | `BU_FINANCIAL_SERVICES` shared product capability + Marketplace dependency | Accounting separate |
| escrow/SafePay product workflow | `BU_FINANCIAL_SERVICES` product ownership; Platform integration dependency | Revenue/cash separate |
| Corporate Finance page | `CF_FINANCE_ACCOUNTING` | **Not** BU Financial Services |

### 19.4 BU_DIASPORA_TRADE

| Current surface/domain | Conceptual BU/function owner | Notes |
| --- | --- | --- |
| `/diaspora` | `BU_DIASPORA_TRADE` | Product entry |
| Trade profile / imports / request-quotes / requests | `BU_DIASPORA_TRADE` | Trade participants/orders |
| buyer requests / supplier offers | `BU_DIASPORA_TRADE` | Sourcing workflow |
| Trade documents / warehouse / cargo / loading | `BU_DIASPORA_TRADE` | Operations |
| shipments / tracking / customs | `BU_DIASPORA_TRADE` | Logistics operations |
| container co-loading | `BU_DIASPORA_TRADE` | Logistics/container product |
| Trade Rate Research | `BU_DIASPORA_TRADE` + Data/Intel input | Research/advisory distinction required |
| Trade Graph | `BU_DIASPORA_TRADE` + `CF_DATA_INTELLIGENCE` | Derived graph |
| SafeTrade / SafeTrade Operations | `BU_DIASPORA_TRADE` + Financial Services/Platform dependencies | Sandbox/live truth preserved |
| `/admin/diaspora/compliance` | central Trust/Legal control + BU context | Compliance policy central |
| workbook console/dry run/import | `BU_DIASPORA_TRADE` Operations | Operational tooling |
| Diaspora AI command center | Platform/AI capability + BU context | AI output advisory |

### 19.5 Central cross-domain surfaces

| Current surface/domain | Central conceptual owner |
| --- | --- |
| Feature Governance | `CF_PLATFORM_TECH` |
| AI model/provider health | `CF_PLATFORM_TECH` |
| Navigation Intelligence | `CF_DATA_INTELLIGENCE` / Customers & Growth consumption |
| Corporate metric registry/provenance | `CF_DATA_INTELLIGENCE` |
| Communications customer operation | `CF_CUSTOMERS_GROWTH` + relevant BU operations |
| Communications provider/dead-letter/worker | `CF_PLATFORM_TECH` |
| Identity Verification | `CF_TRUST_RISK_COMPLIANCE` |
| Evidence / Trust / Governance / Fraud | `CF_TRUST_RISK_COMPLIANCE` |
| User/account/Coporate membership access | `CF_PEOPLE_ADMIN` + CA-RBAC |
| Corporate Finance & Accounting | `CF_FINANCE_ACCOUNTING` |

Cross-domain surfaces must not be forced into one BU merely because they serve it.

---

## 20. BU drill-down contract

Canonical navigation:

`Business Units Overview
→ BU Detail
→ metric / exception
→ governed population
→ operational workspace or restricted record where permitted`

### 20.1 Context that must persist

Every BU drill-down preserves:

- BU ID;
- reporting period;
- comparison period if valid;
- geography type/value;
- metric identity/version;
- source/provenance state;
- filters;
- RBAC organisational scope;
- data-classification ceiling.

### 20.2 Management-plane transition

BU Detail is **Corporate Intelligence**.

If a viewer chooses “Open queue” or “Resolve case”:

- transition to **Business Operations** must be explicit;
- page header must change plane;
- same BU/filter context may be carried;
- mutations remain owned by the current domain service.

No mutation controls should be embedded directly inside an executive BU scorecard.

### 20.3 Restricted drill-stop

If aggregate permission exists but record detail does not:

- aggregate remains visible;
- drill-down stops;
- no PII/evidence IDs leak through tooltip or URL prefetch;
- UI states “Record-level access restricted” where existence disclosure is safe.

---

## 21. BU reporting contract

### 21.1 Weekly BU Review

Required report fields:

- BU ID/label;
- reporting period;
- comparison period;
- scope/geography;
- metric versions;
- K2B/provenance state;
- demand/activity;
- supply/capacity;
- throughput/journey;
- quality/trust/compliance;
- backlog/cycle time;
- finance/commercial state;
- data-quality/freshness;
- key changes;
- open actions;
- escalations;
- Owner/Executive decisions requested.

### 21.2 Monthly Executive BU Contribution

Concise structure:

1. Material change.
2. What drove change.
3. BU contribution to Corporate objectives, without invented targets.
4. Strategic demand/supply signal.
5. Key operational bottleneck.
6. Major Trust/Risk/Compliance issue.
7. Finance authority/current state.
8. Geography/market signal where authoritative.
9. Data/source caveat.
10. Decision required from Executive/central function.

### 21.3 Reporting truth

Weekly/monthly reports must not:

- convert candidate metrics into Actual;
- remove unavailable slots merely to make the report look complete;
- hide K2B exclusions/UNKNOWN populations when material;
- replace source failure with zero;
- carry incompatible metric versions without disclosure.

---

## 22. Geography model

| BU | Valid geography dimensions | Explicitly not equivalent |
| --- | --- | --- |
| Marketplace | listing city/region, dealer operating geography, inquiry geography if recorded | customer residence |
| Service Network | garage/provider location, branch, service operating coverage | customer residence unless separately sourced |
| Financial Services | provider jurisdiction, product availability geography, explicit applicant geography if governed | customer residence inferred from provider |
| Diaspora Trade | order origin, destination, corridor, supplier geography, actual shipment route when sourced | customer residence |

### 22.1 Corporate region dimension

Future Corporate regions may group these dimensions for reporting, but must not rewrite the underlying geography type.

### 22.2 Unknown geography

Unknown remains unknown.

Do not infer from:

- IP;
- phone prefix;
- email;
- tenant address;
- listing location;
- shipment destination.

unless a later authority explicitly permits that inference.

---

## 23. K2B, finance and growth boundaries

### 23.1 K2B

Accepted/frozen:

`7b34dec1bc9f05b72b6abf0104db65980f280a0b`

BU Actual:

- operational only;
- non-operational excluded;
- UNKNOWN excluded.

CA-BU does not define new provenance classes.

### 23.2 Finance

CA-FIN remains authority for:

- GMV;
- recognized revenue;
- cost;
- gross profit;
- operating expense/profit;
- net profit;
- cash;
- AR/AP;
- take rate;
- contribution margin.

BU product amounts must not be promoted.

### 23.3 Growth/customer

CA-GROWTH remains authority for:

- customer definition;
- active/transacting customer;
- activation;
- attribution;
- retention;
- churn;
- reactivation;
- cross-BU distinct person/customer;
- customer geography.

BU scorecards use source-accurate relationships until these policies are accepted.

---

## 24. RBAC / data-classification inputs

### 24.1 Executive aggregate

Potentially visible with appropriate permission:

- BU scorecard aggregates;
- BU comparisons;
- risk backlog summaries;
- finance unavailable/summary states;
- report outputs.

Does not imply:

- PII;
- KYC/evidence;
- financial line items;
- secrets;
- mutation.

### 24.2 BU aggregate

`BU_LEAD` / analyst archetype receives only explicit BU scope.

No sibling BU access by title.

### 24.3 Operational drill-down

Requires domain permission plus:

- BU/org scope;
- classification;
- geography;
- assurance;
- valid delegation/time.

### 24.4 Restricted finance

Financial line items/export require separate CA-RBAC restricted-financial permissions and assurance.

### 24.5 Restricted identity/compliance

Evidence/identity/fraud case detail requires explicit restricted compliance permission and assurance.

### 24.6 Export

A BU read permission does not imply export.

Export should state:

- scope;
- period;
- classification;
- metric version;
- source/provenance;
- publisher/exporter authority.

---

# PART V — OWNER DECISIONS

## 25. Owner Decision Register

| Decision ID | Owner decision required | Why it matters | Safe default until resolved |
| --- | --- | --- | --- |
| `OD-CABU-001` | Confirm final management labels for the four canonical BU IDs. | UI/report terminology | Use CA-ORG provisional labels |
| `OD-CABU-002` | Is Marketplace & Vehicle Commerce one BU long term, or should Dealer/Vehicle Commerce later become separate? | Ownership/scorecards | One `BU_MARKETPLACE` |
| `OD-CABU-003` | Is Garage, Service & Parts one BU long term? | Service management structure | One `BU_SERVICE_NETWORK` |
| `OD-CABU-004` | Does Parts/PartSentry remain inside Service Network or become a future separate management unit? | Parts ownership | Parts inside Service Network with Trust matrix |
| `OD-CABU-005` | Does Insurance remain inside Financial Services or become a separate BU/partner ecosystem? | BU scope | Insurance inside `BU_FINANCIAL_SERVICES` |
| `OD-CABU-006` | Does Logistics/Container remain fully inside Diaspora Trade? | Trade/logistics ownership | Inside `BU_DIASPORA_TRADE` |
| `OD-CABU-007` | Preferred BU leadership archetype labels. | Reporting/access templates | Generic `BU_LEAD` + domain descriptor |
| `OD-CABU-008` | Required BU management cadence: daily/weekly/monthly/quarterly? | Operating rhythm | Daily ops + weekly BU + monthly executive |
| `OD-CABU-009` | Which scorecard sections are mandatory for every BU versus optional? | Consistency | Context, data quality and management attention mandatory; other sections domain-specific |
| `OD-CABU-010` | Which metric families may appear in cross-BU comparison by default? | Prevents false comparison | Source freshness, backlog/cycle only where definitions align |
| `OD-CABU-011` | Should BUs ever be ranked against one another? If so, on which registered metrics? | Executive comparison | No generic ranking |
| `OD-CABU-012` | What geography dimensions should each BU adopt as default management view? | Maps/segmentation | Use source-native geography types |
| `OD-CABU-013` | What exact operational completion state defines a completed Marketplace commercial journey? | Throughput | Keep transaction/reservation stages separate |
| `OD-CABU-014` | What exact operational completion state defines Service Network completion? | Throughput | Use domain service-case/work-order status separately |
| `OD-CABU-015` | What exact operational completion state defines Financial Services product completion? | Product adoption | Do not infer beyond authoritative provider/payment state |
| `OD-CABU-016` | What exact operational completion state defines a Diaspora Trade journey? | Trade throughput | Keep accepted quote/logistics/order states separate |
| `OD-CABU-017` | Which BU outcomes are strategic outcomes versus diagnostic process metrics? | Executive scorecards | Promote only independently governed metrics |
| `OD-CABU-018` | What management thresholds trigger BU escalation? | Attention workflow | No numeric threshold until approved |
| `OD-CABU-019` | Who owns BU targets/budgets once target-setting is authorized? | Performance management | Do not invent targets |
| `OD-CABU-020` | Should any BU become a profit centre? | Finance/reporting | No profit-centre claim |
| `OD-CABU-021` | If profit centres are created, are all four BUs profit centres? | Management accounting | Unknown; CA-FIN/Owner decision |
| `OD-CABU-022` | How are shared central-function costs allocated to BUs? | Contribution/profitability | No allocation |
| `OD-CABU-023` | How should one person with relationships across several BUs appear in BU reviews? | Cross-BU customer reporting | Count relationship in each BU; never sum as Corporate distinct |
| `OD-CABU-024` | Should supply-side sellers/dealers/garages be treated as BU customers, participants or partners? | Customer-facing scorecards | Use participant/relationship labels |
| `OD-CABU-025` | Should BU scorecards expose blocked strategic metrics such as revenue/customer count as visible unavailable slots? | Management transparency | Follow CA-UX: keep strategically important blocked slots |
| `OD-CABU-026` | Which BU metrics require daily versus weekly refresh expectations? | Freshness/attention | Source-native freshness until governed |
| `OD-CABU-027` | Should BU leadership receive default aggregate Trust/Risk visibility across all BU cases? | RBAC/privacy | Aggregate only; record detail separate |
| `OD-CABU-028` | Should BU leadership receive default restricted-finance detail? | RBAC/SoD | No; explicit finance permission required |
| `OD-CABU-029` | Should BU leadership receive default customer PII? | Privacy | No; aggregate only |
| `OD-CABU-030` | What standard constitutes a material change in Monthly Executive BU reporting? | Management narrative | No automatic materiality threshold |
| `OD-CABU-031` | What is the approved lifecycle for creating, merging, splitting or retiring a BU? | Long-term org governance | CA-MOD/Owner-controlled change, not route-driven |
| `OD-CABU-032` | When can a product domain be promoted from department/product line to BU? | Structural stability | Requires explicit Owner/CA-ORG decision |
| `OD-CABU-033` | Should BU reports show technical provider health directly or only business-impact exceptions? | Plane separation | Business-impact exception only; technical detail in Platform |
| `OD-CABU-034` | How should shared Communications operations be allocated across BU reviews? | Cross-BU ownership | Business conversation linked to owning context; provider ops central |
| `OD-CABU-035` | How should referral/campaign-associated demand be attributed across BUs before acquisition policy is accepted? | Growth reporting | Association only; no acquired-customer claim |
| `OD-CABU-036` | Should Trade Graph derived opportunity indicators appear in executive BU scorecards? | Actual vs advisory/derived | Diagnostic only |
| `OD-CABU-037` | What is the future Service Network capacity model, if any? | Capacity utilisation | Capacity unavailable until governed source exists |
| `OD-CABU-038` | What supplier authority model is required before Parts supplier performance can exist? | Parts management | Supplier performance unavailable |
| `OD-CABU-039` | What live-provider milestone must Financial Services meet before “live market” product KPIs become executive metrics? | Product maturity | Keep sandbox separate and explicit |
| `OD-CABU-040` | What logistics/shipment source maturity is required before Diaspora logistics demand becomes a strategic KPI? | Trade maturity | No shipment-demand KPI until authoritative records exist |

Every unresolved management/business policy remains explicit rather than being encoded as a metric formula or UI assumption.

---

# PART VI — DOWNSTREAM CONTRACT

## 26. Inputs for CA-REPORT

CA-REPORT should consume:

- stable BU IDs;
- weekly/monthly BU review structures;
- per-BU metric eligibility;
- source/metric versions;
- K2B eligibility;
- explicit unavailable states;
- central-function escalation ownership.

Reports must distinguish:

- Certified Current;
- Candidate after K2B consumption;
- Blocked Owner Decision;
- Pending CA-FIN;
- unavailable/diagnostic/technical.

A report must not promote a candidate because it has appeared repeatedly in previous reports.

---

## 27. Inputs for CA-UX / CA-K3 implementation

CA-UX/K3 should consume:

- four stable BU IDs;
- domain-specific scorecard slots;
- no synthetic BU health score;
- explicit cross-plane drill-down;
- per-BU valid/invalid metrics;
- central-function ownership badges/links;
- metric eligibility state;
- geography type;
- finance/growth blocked states.

### 27.1 Active CA-K3-01 collision rule

CA-K3-01 is active.

CA-BU-01 creates **no request** to alter active shell/truth-state implementation.

After CA-BU acceptance, a later bounded implementation task may add BU Overview/Detail composition, but only after:

- CA-K3-01 acceptance or collision-safe authority;
- metric-source endpoints are selected;
- exact K2B consumption is certified for each activated source.

---

## 28. Inputs for CA-CERT

CA-CERT should require:

### 28.1 BU identity

- stable BU IDs;
- no legal-entity/subsidiary assertion;
- no external tenant shown as internal org.

### 28.2 Metric eligibility

For every rendered BU metric:

- registry ID/version;
- eligibility state;
- exact source;
- K2B consumption state;
- truth availability;
- period;
- scope.

### 28.3 K2B

Prove:

- non-operational rows excluded;
- UNKNOWN excluded;
- failed read ≠ zero;
- excluded/unknown counts surfaced where designed.

### 28.4 Finance

Prove:

- listing/request/quote/service amounts never become revenue/GMV/cash;
- PENDING_CA_FIN slots remain blocked;
- currency is never silently combined.

### 28.5 Growth/customer

Prove:

- inquiries ≠ sales;
- participants ≠ customers;
- work-order customers ≠ Corporate distinct customers;
- corridor ≠ customer residence;
- unrelated funnels not compared as one conversion.

### 28.6 RBAC

Prove:

- BU aggregate read does not expose restricted records;
- sibling BU scope denied;
- Trust/financial/PII drill-down requires explicit permission;
- export separately authorized.

### 28.7 Plane transition

Prove:

- BU detail is Corporate Intelligence;
- “Operate” transitions explicitly to Business Operations;
- mutation actions remain domain-owned.

### 28.8 Cross-BU comparison

Prove:

- no health composite;
- incompatible metric families are not ranked together;
- no summation of BU customer relationships;
- unavailable finance does not participate in ranking.

---

## 29. Open risks

1. **BU-as-legal-entity drift** — management labels could be shown as subsidiaries.
2. **Route-driven org drift** — a large product route family could be promoted to a BU without CA-ORG.
3. **Customer-sum inflation** — BU relationships could be summed into Corporate customers.
4. **Marketplace inquiry-as-sale** — demand could be overstated as transaction outcome.
5. **Listing-price-as-GMV** — product price could become executive finance.
6. **Publishable-as-published** — supply could be overstated.
7. **Service-customer overclaim** — work-order customer could become Corporate distinct customer.
8. **Service-capacity fabrication** — work orders could be divided by an invented capacity denominator.
9. **Mechanic productivity overclaim** — assignment count could become staff performance.
10. **PartSentry control leakage** — provenance/flag state could become fraud adjudication.
11. **Parts supplier fabrication** — free-text supplier could become governed supplier performance.
12. **Finance request-as-disbursement** — requested amount could become loan book.
13. **Payment-intent-as-cash** — product state could become treasury fact.
14. **Escrow-as-revenue** — held/sandbox state could become income.
15. **Insurance policy-bound overclaim** — policy rows could be called bound through CarUp.
16. **Sandbox/live mixing** — simulated provider activity could inflate business demand.
17. **Trade quote-as-revenue** — quote amounts could become sales/revenue.
18. **Milestone-as-cash** — scheduled obligations could become received money.
19. **Corridor-as-customer-geography** — order geography could become residence.
20. **Order-corridor-as-shipment-route** — requested route could become travelled route.
21. **Trade Graph-as-Actual** — derived graph opportunity could override record truth.
22. **K2B consumption gap** — accepted K2B could be bypassed by a metric path not integrated.
23. **Candidate promotion** — governed candidate may be mislabeled Actual before certification.
24. **False cross-BU comparison** — unrelated funnel rates could be ranked.
25. **Synthetic health score** — management may request an opaque composite.
26. **Central-function duplication** — each BU could build its own Trust/Data/Finance policy.
27. **Broad BU-lead access** — BU title could become unrestricted PII/finance/platform access.
28. **Mixed plane UX** — executive scorecard could embed mutation controls.
29. **Source-failure zero** — unavailable data could look like good performance.
30. **Premature K3 collision** — BU page implementation could collide with active shell foundation.
31. **Uncontrolled BU proliferation** — every product domain could become a new BU.
32. **Profit-centre overclaim** — management BU could be presented as P&L unit without CA-FIN/Owner policy.
33. **Shared-cost fiction** — profitability could be computed before allocation policy.
34. **Technical-provider metric promotion** — provider uptime could become business health without defined impact.
35. **Target invention** — red/green “performance” may appear without governed target.

---

## 30. Stop conditions encountered

CA-BU stopped rather than guessing on:

- final long-term BU boundaries;
- Parts future organisational status;
- Insurance future organisational status;
- Logistics future organisational status;
- BU profit-centre status;
- BU target/budget ownership;
- shared-cost allocation;
- universal customer semantics;
- active/transacting customer semantics;
- strategic completion states;
- materiality thresholds;
- escalation thresholds;
- live-provider maturity policy;
- service capacity model;
- supplier performance authority;
- future logistics/shipment metric maturity;
- any finance/accounting formula;
- any legal-entity claim.

No product mutation was required.

---

## 31. Recommended next task

After CA-MOD independently accepts CA-BU-01, the recommended next documentation authority task is:

**CA-REPORT-01 — Corporate Management Reporting / Snapshot / Publication Authority**

Purpose:

- bind Corporate Overview, BU Weekly Review, Monthly Executive Review, Quarterly Board/Strategy and Compliance/Risk reports to exact metric versions, source snapshots, BU scope, K2B provenance and RBAC;
- define reproducible report snapshots;
- define generate/review/approve/publish custody;
- preserve CA-FIN unavailable accounting states;
- preserve CA-GROWTH customer semantics;
- consume this BU scorecard contract without recalculating metrics.

CA-K3-01 should continue independently within its currently authorized shell/truth-state scope. CA-BU-01 does not authorize BU page implementation.

---

## 32. Non-actions

CA-BU-01 made no changes to:

- web code;
- backend;
- routes;
- database;
- K2B;
- metric formulas;
- finance policy;
- customer policy;
- Corporate shell;
- deployments;
- production.

This document does not self-accept.

CA-BU-01 BUSINESS UNIT MANAGEMENT MODEL READY FOR MODERATOR REVIEW

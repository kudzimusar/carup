# CA-BU-01 — BUSINESS UNIT MANAGEMENT / SCORECARD / OPERATING MODEL

FROM: CA-MOD — Corporate Admin Programme Moderator
TO: CA-BU — Business Unit Management & Scorecard Agent
TASK: CA-BU-01
PROGRAMME: CA-1.0 — CarUp Corporate Admin 1.0

## Exact accepted authorities

- Canonical plan: 5d4997cacaff8068c4ec4c5ae78f562be4249344
- CA-ARCH-01 ACCEPTED: 7cae8c3c8c987714a8ca6db2128db3b9a589f141
- CA-ORG-01 ACCEPTED: 705eb6fa1cd89109977052e88e220f0498668060
- CA-RBAC-01 ACCEPTED: 4abdf95e1e1490b01f51cb45106a57fcf7b954b9
- CA-METRIC-01 ACCEPTED: 32c26ce5d89ec3829e2afa9248d1e77a2cb4c784
- CA-FIN-01 ACCEPTED: 9ba7388559fa13cf353e410ce2a62be30660bdeb
- CA-GROWTH-01 ACCEPTED: f7e4c0519411994383d8d3e316c10b380f0e728d
- CA-UX-01 ACCEPTED: 336c6d6015b6c2a4851fb1171642bcc5e93adcdf
- K2B operational-provenance authority ACCEPTED/FROZEN: 7b34dec1bc9f05b72b6abf0104db65980f280a0b
- Current documentation programme head: 3af47fc06b3026c497b629914fb282f0f92f5ec5

## Parallel implementation lane

CA-K3-01 is ACTIVE in the web lane.

CA-BU-01 is documentation / management-architecture work only and must not collide with CA-K3-01 implementation.

Read and obey in full:

- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md
- docs/corporate-admin/CARUP_CORPORATE_FINANCE_MODEL.md
- docs/corporate-admin/CARUP_CUSTOMER_GROWTH_INTELLIGENCE_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_UX_ARCHITECTURE.md

Read-only inspect current product/domain sources where needed to determine existing domain ownership and management boundaries.

---

## MODERATOR AUTHORITY

AUTHORIZED — BUSINESS UNIT MANAGEMENT ARCHITECTURE / SCORECARD CONTRACT / DOCUMENTATION ONLY

NO WEB PRODUCT IMPLEMENTATION.
NO BACKEND IMPLEMENTATION.
NO DATABASE MIGRATION.
NO METRIC FORMULA INVENTION.
NO FINANCE POLICY INVENTION.
NO CUSTOMER POLICY INVENTION.
NO K2B MUTATION.
NO ORGANISATIONAL LEGAL-ENTITY CLAIM.
NO PRODUCTION.

---

## 1. Objective

Define the canonical Business Unit operating model for CarUp Corporate Admin 1.0.

CA-ORG established the provisional non-legal management BUs.
CA-UX established how BU pages should be presented.
CA-BU must now define what each BU actually owns, what management questions it must answer, which metrics are valid, what operational queues belong to it, what it escalates to Corporate functions, and how BU performance can be compared without semantic distortion.

The output must make Business Units usable as real management units rather than labels in navigation.

---

## 2. Canonical provisional BU IDs

Consume CA-ORG exactly.

The provisional management BUs are:

- BU_MARKETPLACE
- BU_SERVICE_NETWORK
- BU_FINANCIAL_SERVICES
- BU_DIASPORA_TRADE

These are management constructs, not proven subsidiaries or legal entities.

Recommended customer-facing / management labels may use:

- Marketplace & Vehicle Commerce
- Garage, Service & Parts
- Finance, Payments & Insurance
- Diaspora Trade & Logistics

but CA-BU must keep the canonical IDs stable.

Do not create additional BUs unless current architecture proves a distinct management unit and CA-MOD authorizes expansion.

---

## 3. Required BU contract

For each BU define a canonical management contract containing at minimum:

- BU ID;
- display name;
- purpose / mandate;
- customer / participant relationships;
- products / services included;
- products / services explicitly excluded;
- governed source domains;
- business owner role archetype;
- key operational owners;
- upstream dependencies;
- downstream dependencies;
- central Corporate functions serving the BU;
- management questions;
- scorecard metric families;
- valid operational metrics;
- valid growth/demand metrics;
- finance metrics and their authority state;
- trust/risk/compliance obligations;
- data-quality/provenance dependencies;
- management cadence;
- escalation rules;
- cross-BU dependencies;
- drill-down destinations;
- report requirements;
- Owner Decisions;
- current gaps.

---

## 4. BU_MARKETPLACE

Define the management model for Marketplace & Vehicle Commerce.

At minimum evaluate:

- vehicle supply;
- publication state;
- seller/supplier activity;
- buyer demand;
- search/filter activity;
- listing detail engagement;
- saves;
- inquiries;
- reservations/transaction stages;
- dealer participation;
- moderation queues;
- vehicle trust/passport dependencies;
- marketplace fraud/risk;
- operational cycle time;
- published supply by governed dimensions;
- demand/supply mismatch where source authority exists.

Preserve:

- published listing != operational vehicle;
- inquiry != sale;
- listing price != GMV;
- reservation != completed sale unless authority says so;
- current K2B publication/provenance rules.

Do not create Marketplace revenue or GMV.

---

## 5. BU_SERVICE_NETWORK

Define the management model for Garage, Service & Parts.

At minimum evaluate:

- garages / service providers;
- service requests;
- cases;
- work orders;
- job stages;
- customer_id relationships;
- repeat service relationships where governed;
- Parts / PartSentry operational integration;
- mechanic/provider capacity;
- backlog;
- turnaround / cycle time;
- completion state;
- service quality signals where authoritative;
- garage onboarding/compliance;
- provider trust;
- geographic service coverage where source authority exists.

Preserve:

- work-order customer relationship != Corporate distinct customer;
- service amount != recognized revenue;
- garage tenant != internal CarUp department.

---

## 6. BU_FINANCIAL_SERVICES

Define the management model for Finance, Payments & Insurance.

This is a customer-facing product BU and must remain distinct from CF_FINANCE_ACCOUNTING.

At minimum evaluate:

- finance applications;
- lender/provider participation;
- eligibility/decision stages;
- insurance eligibility/policy/product states;
- payment/deposit workflow;
- SafePay/SafeTrade integration touchpoints where relevant;
- escrow/payment workflow states;
- product demand;
- approvals/declines where authoritative;
- application cycle time;
- product adoption/intent;
- provider health only where it materially impacts BU operations.

Preserve CA-FIN:

- requested amount != disbursement;
- payment intent != cash;
- escrow != revenue;
- deposit != vehicle transaction value;
- provider success != recognized revenue;
- finance-product activity != Corporate accounting.

Corporate Finance & Accounting metrics remain governed by CA-FIN and are not owned by this BU.

---

## 7. BU_DIASPORA_TRADE

Define the management model for Diaspora Trade & Logistics.

At minimum evaluate:

- trade profiles;
- buyer requests / import orders;
- RFQs;
- quotes;
- accepted quotes;
- supplier participation;
- trade documents;
- logistics;
- containers / cargo reservations;
- shipment stages;
- country/corridor dimensions;
- Trade Graph where governed;
- SafeTrade workflow states;
- compliance;
- cycle times;
- operational completion;
- repeat trade relationships where governed.

Preserve:

- Trade participant != customer unless CA-GROWTH rule qualifies it;
- quote amount != revenue;
- scheduled payment milestone != cash;
- sandbox settlement != live settlement;
- corridor geography != customer residence;
- commercial charge class != accounting revenue.

---

## 8. Central Corporate functions versus BUs

Consume CA-ORG.

Define clearly what remains centrally owned and should not be duplicated as a BU department.

At minimum:

- CF_EXECUTIVE
- CF_FINANCE_ACCOUNTING
- CF_CUSTOMERS_GROWTH
- CF_TRUST_RISK_COMPLIANCE
- CF_DATA_INTELLIGENCE
- CF_LEGAL_GOVERNANCE
- CF_PEOPLE_ADMIN
- CF_PLATFORM_TECH

For each BU, define the service/dependency relationship with these functions.

Examples:

- BU Marketplace consumes Corporate Trust/Risk but does not own Corporate Trust policy;
- BU Financial Services does not own Corporate accounting;
- BU Diaspora Trade consumes Platform/AI/Data capabilities but does not own Platform governance.

---

## 9. Scorecard architecture

Define the reusable BU scorecard contract that CA-UX can render and future web tasks can implement.

Required scorecard sections:

A. BU mandate / management context
B. Demand / customer-participant activity
C. Supply / capacity
D. Throughput / journey progression
E. Quality / trust / compliance
F. Backlog / cycle time
G. Geography / market dimensions where authoritative
H. Finance / commercial values only where CA-FIN permits
I. Data-quality / provenance / freshness
J. Management attention / exceptions

Not every BU must populate every section.

Do not force false comparability.

---

## 10. Metric eligibility matrix

For each BU produce a matrix classifying candidate metrics as:

- CERTIFIED_CURRENT
- CANDIDATE_AFTER_K2B_CONSUMPTION
- BLOCKED_OWNER_DECISION
- PENDING_CA_FIN
- UNAVAILABLE_NO_SOURCE
- UNAVAILABLE_NOT_SEPARABLE
- DIAGNOSTIC_ONLY
- TECHNICAL_OPERATIONAL

Use accepted CA-METRIC truth states and semantics.

Do not promote candidate metrics into Actual.

---

## 11. Cross-BU comparison rules

Define which comparisons are valid and which are not.

Valid examples may include:

- backlog aging within comparable queue families;
- cycle time where the process definition is comparable;
- activity trends normalized by an approved denominator;
- source freshness;
- risk backlog counts by governed class.

Invalid examples include:

- summing BU customer counts into Corporate distinct customers;
- ranking BUs by revenue when revenue authority does not exist;
- comparing inquiry rate in Marketplace to quote acceptance in Trade as if the funnels are equivalent;
- one generic 'BU health score' without governed weighting.

Do not create a synthetic cross-BU composite score.

---

## 12. BU leadership / management cadence

Define recommended management cadences, subject to Owner approval:

- daily operational review;
- weekly BU review;
- monthly executive review;
- quarterly strategy/board contribution.

For each cadence specify:

- questions to answer;
- metric families;
- exceptions;
- operational queues;
- report outputs;
- escalation path.

Do not assign named people.

Use role archetypes only.

---

## 13. BU / Corporate escalation model

Define when a BU issue remains inside the BU and when it escalates to a central Corporate function.

Examples to consider:

- security/provider outage → Platform/Security;
- fraud/compliance exception → Trust/Risk/Compliance;
- customer demand anomaly → Customers & Growth;
- finance/accounting discrepancy → Corporate Finance;
- access issue → People & Access;
- metric/source conflict → Data & Intelligence;
- legal/regulatory issue → Legal/Governance.

Do not create automatic severity policy without authority.

---

## 14. Business-unit ownership of current routes

Read-only inspect current product routes/services and map them conceptually to BU or central-function ownership.

Create a mapping such as:

- Marketplace routes/pages → BU_MARKETPLACE;
- garage/service routes/pages → BU_SERVICE_NETWORK;
- finance/insurance product routes/pages → BU_FINANCIAL_SERVICES;
- Diaspora Trade/logistics routes/pages → BU_DIASPORA_TRADE;
- feature governance / AI / provider health → CF_PLATFORM_TECH;
- fraud/evidence/identity compliance → CF_TRUST_RISK_COMPLIANCE;
- Corporate metric registry/provenance → CF_DATA_INTELLIGENCE.

Where a surface is cross-domain, mark shared ownership/dependency rather than forcing one owner.

---

## 15. BU drill-down contract

Define what happens when a user moves:

Business Units Overview → BU Detail → metric/exception → operational workspace.

Must preserve:

- BU scope;
- reporting period;
- geography/filter context;
- metric identity/version;
- provenance state;
- RBAC;
- management plane transition.

An executive BU page must not directly embed mutation controls from Operations.

---

## 16. BU reporting contract

Define the minimum Weekly BU Review and Monthly Executive BU Contribution structure.

Weekly BU Review should include:

- mandate/context;
- changes since previous period;
- demand/activity;
- supply/capacity;
- throughput/funnel where valid;
- backlog/cycle time;
- risk/compliance;
- source quality;
- actions/decisions required.

Monthly Executive contribution should be more concise and focus on:

- material change;
- BU contribution to Corporate objectives;
- strategic risks/opportunities;
- governed financial state where available;
- unresolved data/authority gaps;
- requested executive decisions.

Do not invent targets.

---

## 17. Geography and region handling

Consume CA-GROWTH and CA-ORG.

Each BU may have different geography semantics.

Examples:

- Marketplace vehicle/listing location;
- Service provider operating geography;
- Finance product jurisdiction/provider availability;
- Trade origin/destination corridor.

Do not label these all 'customer location'.

Document the valid geography dimensions per BU.

---

## 18. K2B boundary

K2B is accepted/frozen.

CA-BU may use accepted operational-provenance semantics.

Corporate/BU Actual must:

- include eligible operational records only;
- exclude non-operational test/UAT/CI/certification/seeded/legacy-synthetic records;
- exclude UNKNOWN from Actual.

If a BU metric source path has not proven K2B consumption, mark it PENDING_K2B_CONSUMPTION.

Do not recreate provenance.

---

## 19. Finance boundary

Consume CA-FIN.

Do not create or imply:

- GMV;
- recognized revenue;
- gross profit;
- operating profit;
- net profit;
- Corporate cash;
- AR/AP;
- take rate;
- contribution margin

unless CA-FIN says the source authority exists.

Product commercial amounts remain product facts, not accounting facts.

---

## 20. Customer/Growth boundary

Consume CA-GROWTH.

Do not create one universal BU/customer metric where definitions are unresolved.

Use source-accurate relationships:

- registered accounts;
- operational accounts;
- verified identity subjects;
- inquiries;
- Marketplace buyers/sellers;
- service work-order customers;
- Trade buyers/participants;
- finance applicants;
- insurance participants.

Do not sum relationship counts into Corporate customer totals.

---

## 21. RBAC / data-classification boundary

Consume CA-RBAC.

For each BU scorecard identify:

- executive aggregate access;
- BU aggregate access;
- operational drill-down;
- restricted financial detail;
- restricted identity/compliance detail;
- export rights.

Do not assume BU leader permission grants platform/finance/PII access.

---

## 22. Owner Decision Register

Create OD-CABU-* decisions for unresolved management policy.

At minimum consider:

- final BU labels;
- BU ownership boundaries;
- whether Parts belongs fully under Service Network or has separate future treatment;
- whether Insurance remains within Financial Services;
- whether logistics is fully within Diaspora Trade;
- BU leadership role archetype naming;
- BU review cadence;
- BU scorecard mandatory sections;
- cross-BU comparison policy;
- BU geographic reporting dimensions;
- operational completion states;
- strategic outcome definitions;
- escalation thresholds;
- BU target/budget ownership;
- future profit-centre designation;
- whether each BU becomes a formal profit centre;
- shared-cost allocation policy;
- cross-BU customer relationship reporting;
- business-unit lifecycle creation/retirement policy.

Do not guess unresolved organisational policy.

---

## 23. Required deliverable

Create only:

docs/corporate-admin/CARUP_BUSINESS_UNIT_MANAGEMENT_MODEL.md

Must include:

1. authority/custody;
2. BU management principles;
3. canonical BU IDs/labels;
4. BU_MARKETPLACE management contract;
5. BU_SERVICE_NETWORK management contract;
6. BU_FINANCIAL_SERVICES management contract;
7. BU_DIASPORA_TRADE management contract;
8. central function dependency model;
9. reusable BU scorecard contract;
10. per-BU metric eligibility matrices;
11. cross-BU comparison rules;
12. management cadence;
13. escalation model;
14. current route/domain ownership map;
15. BU drill-down contract;
16. BU reporting contract;
17. geography model;
18. K2B/finance/growth boundaries;
19. RBAC/data classification inputs;
20. Owner Decision Register;
21. downstream inputs for CA-REPORT, CA-UX/K3 implementation, CA-CERT;
22. open risks;
23. recommended next task.

---

## 24. Parallel-lane rule

CA-K3-01 is active in the web implementation lane.

CA-BU must not:

- modify web code;
- modify routes;
- modify Corporate shell;
- request CA-K3-01 to implement BU detail prematurely;
- redefine truth-state components;
- change K2B.

If CA-BU discovers a conflict with active CA-K3-01 architecture, record it as a bounded implementation dependency for CA-MOD rather than mutating product.

---

## 25. Repository scope

AUTHORIZED MUTATION:

docs/corporate-admin/**

READ-ONLY INSPECTION:

web/**
backend/**
shared/**
database schema/migration history
accepted programme docs

FORBIDDEN MUTATION:

web/**
backend/**
shared/**
database/**
mobile/**
.github/**
staging data
production
deployments

---

## 26. Stop conditions

STOP rather than guess if:

- a BU boundary conflicts with accepted CA-ORG;
- a metric requires inventing a formula;
- a finance metric lacks CA-FIN authority;
- a customer metric requires unresolved CA-GROWTH policy;
- a comparison would mix incompatible grains;
- a legal-entity claim would be required;
- a route/domain has materially ambiguous ownership;
- product mutation appears necessary.

---

## 27. Return receipt

Return:

AGENT: CA-BU
TASK: CA-BU-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES / SYSTEMS INSPECTED
FILES CHANGED
BU MANAGEMENT CONTRACT SUMMARY
PER-BU SCORECARD SUMMARY
METRIC ELIGIBILITY SUMMARY
CURRENT ROUTE / DOMAIN OWNERSHIP MAP
CROSS-BU COMPARISON RULES
OWNER DECISIONS REQUIRED
OPEN RISKS
DOWNSTREAM INPUTS
STOP CONDITIONS
RECOMMENDED NEXT TASK

Final line exactly:

CA-BU-01 BUSINESS UNIT MANAGEMENT MODEL READY FOR MODERATOR REVIEW

Do not self-accept.
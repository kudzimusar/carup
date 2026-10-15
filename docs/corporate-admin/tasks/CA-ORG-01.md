# CA-ORG-01 — CORPORATE ENTITY / BUSINESS-UNIT / DEPARTMENT MODEL

FROM: CA-MOD — Corporate Admin Programme Moderator  
TO: CA-ORG — Organisation & Subsidiary Structure Agent  
TASK: CA-ORG-01  
PROGRAMME: CA-1.0 — CarUp Corporate Admin 1.0

Canonical programme authority:

docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md

Canonical plan authority:

5d4997cacaff8068c4ec4c5ae78f562be4249344

Accepted architecture input:

CA-ARCH / CA-ARCH-01  
docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md  
accepted result authority: 7cae8c3c8c987714a8ca6db2128db3b9a589f141

Product/reference authority to inspect read-only:

PR #222 / fix/oc5r-real-runtime-source-closure  
505ffcca6b641c8b3b55f503e0f4fd39d26710dc

Parallel dependency:

K2B — Operational Provenance Authority / Admin Truth Convergence  
ACTIVE

## MODERATOR DISPOSITION

AUTHORIZED — CORPORATE ORGANISATION ARCHITECTURE / DOCUMENTATION ONLY

NO PRODUCT IMPLEMENTATION.

NO DATABASE MUTATION.

NO RBAC IMPLEMENTATION.

NO LEGAL-ENTITY CLAIMS WITHOUT OWNER EVIDENCE.

NO ROUTE MIGRATION.

NO CORPORATE DASHBOARD IMPLEMENTATION.

NO K2B PROVENANCE IMPLEMENTATION.

---

## 1. Objective

Define the durable organisational model Corporate Admin 1.0 will use to represent CarUp internally.

The model must support:

Company → legal entity/subsidiary OR business unit → department → team

without assuming that every product domain is a legal company.

The output must establish a clear organisational taxonomy so later agents can answer:

- where a person belongs;
- which unit owns a process;
- which unit owns a metric;
- which business unit may have P&L/reporting scope;
- which functions are central/shared;
- which external organisations are partners/regulators/vendors rather than CarUp departments;
- which hierarchy levels Corporate Admin must navigate and report by.

This is organisation architecture, not legal incorporation advice and not implementation.

---

## 2. Binding inputs

Read in full:

1. docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
2. docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md

Preserve:

- Corporate Intelligence / Business Operations / Platform & Security separation;
- the canonical Corporate Admin domains;
- the rule that product routes do not prove legal entities;
- the distinction between internal corporate structure and tenant/external-organisation structure;
- CA-RBAC, CA-METRIC, CA-FIN, CA-BU and CA-REPORT downstream ownership;
- K2B as provenance authority.

Do not silently revise these authorities.

---

## 3. Required organisation taxonomy

Define canonical conceptual entity types at minimum:

- CORPORATE_PARENT
- LEGAL_ENTITY
- SUBSIDIARY
- BUSINESS_UNIT
- CORPORATE_FUNCTION
- DEPARTMENT
- TEAM
- COST_CENTRE
- PROFIT_CENTRE
- REGION
- EXTERNAL_PARTNER
- REGULATOR
- VENDOR

You may refine names if necessary, but every type must have:

- definition;
- parent/child eligibility;
- whether it is internal or external;
- whether it may own people;
- whether it may own metrics;
- whether it may own budget/P&L scope;
- whether it may own operating workflows;
- whether it may appear in Corporate Admin hierarchy;
- whether it is an organisational unit or only a reporting dimension.

Do not treat REGION as automatically a legal entity.

Do not treat COST_CENTRE / PROFIT_CENTRE as automatically departments.

---

## 4. Corporate hierarchy model

Produce a proposed internal hierarchy capable of supporting:

CarUp Corporate
→ business unit / subsidiary
→ department
→ team

and central corporate functions shared across units.

The model must support matrix relationships where a central function serves multiple BUs without becoming duplicated into each BU.

Example problem to solve:

A Trust / Risk / Compliance team may centrally govern:

- Marketplace;
- Diaspora Trade;
- Dealer Operations;
- Garage & Service;
- Finance;
- Insurance;

without becoming six different compliance departments.

Define how this is represented conceptually.

---

## 5. Business-domain classification

Use CA-ARCH findings and repository evidence to classify the following as:

- PROPOSED_BUSINESS_UNIT
- PROPOSED_CORPORATE_FUNCTION
- SHARED_GOVERNED_CAPABILITY
- PLATFORM_FUNCTION
- EXTERNAL_INSTITUTION_TYPE
- UNRESOLVED

Domains to classify include at minimum:

- Marketplace
- Dealer / Vehicle Commerce
- Garage & Service
- Finance / Payments
- Insurance
- Diaspora Trade
- Logistics / Container Services
- Parts / PartSentry
- Referral / Marketing
- Communications
- Trust / Risk / Compliance
- Identity / Verification
- Data & Intelligence
- Platform Operations
- Security
- AI / Model Operations
- Feature Governance
- Integrations
- People & Administration
- Legal / Governance
- Finance & Accounting
- Customers & Growth

For every classification distinguish:

PROVEN CURRENT PRODUCT DOMAIN  
from  
PROPOSED INTERNAL ORGANISATIONAL HOME  
from  
LEGAL STATUS: UNKNOWN unless explicitly proven.

---

## 6. External institution boundary

Current CarUp product roles include or interact with:

- bank;
- insurance;
- government;
- dealer;
- garage/mechanic;
- organisations/tenants.

Determine which of these are primarily:

- customer/merchant organisations;
- service providers;
- regulated institutions;
- external partners;
- regulators;
- internal CarUp units;

based only on repository/product evidence.

Do NOT classify an external bank, insurer, government agency, dealer or garage as a CarUp department merely because it has a portal or route.

Create a hard conceptual boundary between:

INTERNAL CORPORATE ORGANISATION

and

EXTERNAL PLATFORM PARTICIPANT / TENANT / PARTNER.

---

## 7. Business-unit ownership model

For each proposed BU/function establish what it conceptually owns:

- customers;
- workflows;
- operating queues;
- metrics;
- budget/P&L candidate scope;
- reporting responsibility;
- leadership role placeholder;
- geographic scope;
- dependent shared services.

Do not define final job titles if unproven.

Use placeholders such as:

BU_LEAD
FUNCTION_LEAD
DEPARTMENT_MANAGER

when titles require owner decision.

---

## 8. Corporate function model

Evaluate central functions including:

- Executive Office
- Finance & Accounting
- Customers & Growth
- Marketing & Communications
- Trust / Risk / Compliance
- Data & Intelligence
- Legal / Governance
- People & Administration
- Platform / Technology
- Security

Determine:

- whether each is central/shared;
- which BUs consume it;
- whether it has independent reporting responsibility;
- whether it requires restricted information classification;
- whether it should appear directly in Corporate Admin top-level IA.

Do not merge Customers & Growth with Communications merely because current pages are mixed.

Do not merge Data & Intelligence with Platform merely because technical monitoring exists.

---

## 9. Financial/reporting dimensions

Prepare organisation inputs for CA-FIN and CA-METRIC.

Define conceptually where Corporate Admin will need:

- legal entity dimension;
- BU dimension;
- department dimension;
- region/country dimension;
- currency dimension;
- cost centre;
- profit centre;
- reporting period;
- consolidation scope.

Do not define accounting formulas.

Do not infer tax/legal consolidation rules.

Flag every item needing Owner/accounting/legal determination.

---

## 10. People / membership placement

Prepare organisation inputs for CA-RBAC.

Define conceptually how a corporate person may belong to:

- one home organisational unit;
- zero or more matrix/shared-function assignments;
- one or more temporary/delegated scopes;
- geographic scopes;
- external-partner scopes where applicable.

Do not design permissions.

Do not change users.role.

Do not reuse current tenant membership automatically as internal corporate membership.

Explicitly state where internal corporate membership must remain separate from customer/partner tenant membership.

---

## 11. MVP organisation proposal

Produce a bounded Corporate Admin 1.0 MVP organisation model.

It must be sufficient to support the canonical top-level product:

- Corporate Overview
- Business Units
- Finance
- Customers & Growth
- Operations
- Trust / Risk / Compliance
- Data & Intelligence
- People & Access
- Reports
- Platform

The MVP must not require that every product domain immediately become a separate BU.

Recommend the minimum durable structure that avoids a future reorganisation trap.

---

## 12. Owner decision register

Create an explicit decision register for questions repository evidence cannot answer.

At minimum include:

- Is there currently one legal CarUp company or multiple?
- Which product domains are intended to become legal subsidiaries?
- Which domains should be BUs versus product lines?
- Is Diaspora Trade a BU, subsidiary candidate or programme?
- Is Marketplace the parent commercial platform or a peer BU?
- Is Dealer/Vehicle Commerce a Marketplace department or distinct BU?
- Is Garage & Service a BU?
- Is Parts/PartSentry a BU, department or capability?
- Is Logistics/Container Services inside Diaspora Trade or independent?
- Does Finance/Payments include only platform payments or a broader financial-services BU?
- Is Insurance an internal business line, marketplace/integration function or primarily partner ecosystem?
- Which regions/countries should be explicit reporting dimensions at MVP?
- Which units should have P&L responsibility?
- Which corporate functions are central?
- Which titles/leadership positions exist now versus planned?

For each decision provide:

- decision ID;
- question;
- why it matters;
- affected downstream agents;
- safe default if unresolved;
- what MUST NOT be assumed.

---

## 13. Required deliverable

Create:

docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md

The document must contain:

1. authority/custody;
2. organisation taxonomy;
3. internal vs external boundary;
4. proposed hierarchy;
5. business-domain classification matrix;
6. proposed BU model;
7. corporate function model;
8. shared-function / matrix relationship model;
9. metric/reporting ownership model;
10. financial/reporting dimensions;
11. membership-placement inputs for CA-RBAC;
12. MVP organisation structure;
13. owner decision register;
14. downstream inputs for:
   - CA-RBAC / CA-RBAC-01
   - CA-METRIC / CA-METRIC-01
   - CA-FIN / CA-FIN-01
   - CA-BU
   - CA-REPORT
   - CA-UX
15. open questions / risks;
16. recommended next task.

If useful, add ONE concise machine-readable organisational taxonomy under docs/corporate-admin/, but only if it materially improves traceability.

---

## 14. Repository scope

AUTHORIZED MUTATION:

docs/corporate-admin/**

READ-ONLY INSPECTION:

web/**
backend/**
shared/**
database schema/migration history
existing programme/docs

FORBIDDEN MUTATION:

web/**
backend/**
shared/**
database/**
mobile/**
.github/**
staging database
production
deployments
Vercel aliases

No runtime changes.

---

## 15. Evidence rules

Distinguish:

PROVEN PRODUCT/REPOSITORY FACT  
PROPOSED ORGANISATIONAL MODEL  
OWNER DECISION REQUIRED

Never promote a proposal into a proven company fact.

Do not use route names as evidence of legal incorporation.

Do not use current tenants/organizations as automatic evidence of internal corporate structure.

Do not expose unnecessary PII.

---

## 16. K2B boundary

K2B owns operational/test provenance.

CA-ORG may identify which internal unit should eventually OWN a data source or metric.

CA-ORG must not:

- classify runtime rows;
- alter provenance logic;
- mutate staging data;
- create a second operational-truth classifier.

If K2B is incomplete, mark operational-data dependencies as PENDING_K2B.

---

## 17. Stop conditions

STOP and report if:

- a legal-entity conclusion would require external legal evidence not present;
- internal vs external status cannot be determined safely;
- organisational placement would require an Owner business decision;
- a change to product/database/RBAC appears necessary;
- K2B collision would make a conclusion unsafe.

For unresolved business structure, provide alternatives and an Owner decision ID rather than guessing.

---

## 18. Return receipt

Use canonical CA receipt format.

Return:

AGENT: CA-ORG  
TASK: CA-ORG-01  
EXACT STARTING AUTHORITY:
- canonical plan
- accepted CA-ARCH-01 authority
- inspected product SHA

EXACT RESULTING AUTHORITY:
- documentation branch SHA

DEPENDS ON:
- CA-ARCH / CA-ARCH-01 — ACCEPTED
- K2B — ACTIVE

FILES / SYSTEMS INSPECTED  
FILES CHANGED  
PROVEN FACTS  
PROPOSED MODEL  
OWNER DECISIONS REQUIRED  
OPEN QUESTIONS  
COLLISIONS / DEPENDENCIES  
DOWNSTREAM INPUTS  
STOP CONDITIONS ENCOUNTERED  
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-ORG-01 CORPORATE ORGANISATION MODEL READY FOR MODERATOR REVIEW

Do not self-accept.

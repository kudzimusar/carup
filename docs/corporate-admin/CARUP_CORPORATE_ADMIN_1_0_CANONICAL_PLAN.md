# CARUP CORPORATE ADMIN 1.0 — CANONICAL PROGRAMME PLAN

Programme: CA-1.0  
Status: OWNER-AUTHORIZED / CANONICAL PROGRAMME AUTHORITY  
Repository: kudzimusar/carup  
Canonical path: docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md  
Authority date: 13 October 2026 (JST)  
Programme Moderator: CA-MOD — Corporate Admin Programme Moderator / Programme Controller  
Plan Custodian: CA-ARCH — Corporate Architecture & Governance Agent

> BINDING RULE: This file is the controlling architecture and programme authority for CarUp Corporate Admin 1.0 unless superseded by a later explicit Owner or CA-MOD decision. Chat may explain the plan but does not silently change it. Every Corporate Admin agent must cite this file, its stable agent ID, and its exact task ID in every return receipt.

---

## 1. Purpose

CarUp has outgrown the idea that one generic Admin user represents every form of company authority.

The platform spans Marketplace, vehicle commerce/dealers, garage and service, finance/payments, insurance, Diaspora Trade, logistics/container services, customer communications, Trust/Risk/Compliance, Data/AI, and technical platform governance.

Corporate Admin 1.0 therefore establishes a corporate management system, not a larger settings page. It must help leadership understand the business, plan strategically, report accurately, manage delegated authority, and drill from company performance into accountable business units, departments, teams and operating records.

The target product must answer, truthfully:

- How much business is CarUp facilitating?
- How much revenue is CarUp actually earning?
- What are gross profit, gross margin, direct costs, receivables, payables and settlement exposure?
- How many customers are active, transacting, retained or lost, and where are they?
- Which acquisition channels, searches, routes, journeys and features produce conversion and revenue?
- Which business units are growing, underperforming, generating risk, or consuming disproportionate effort?
- Which queues need leadership attention?
- Which numbers are Actual, Derived, Estimated, Forecast or Unavailable?
- Who may see or change each class of corporate information?

The product must be visually suitable for daily management, executive meetings and a boardroom screen. It must be graphic and strategically useful without presenting synthetic or ungoverned numbers as facts.

---

## 2. Canonical product principle

### 2.1 Admin is not a job title

The technical/backend admin role may continue during migration, but the product concept of Admin must no longer mean CEO, CFO, COO, operations manager, compliance officer and system administrator simultaneously.

### 2.2 Three management planes

| Plane | Purpose | Typical users |
| --- | --- | --- |
| Corporate Intelligence | Strategic management and consolidated performance | CEO, COO, CFO, executive leadership, authorised reporting users |
| Business Operations | Running individual business units and departments | BU directors, managers, analysts, operators |
| Platform & Security | Running the technology platform and technical governance | Platform Admin, Security Admin, Data/AI Admin, Feature Governance operators |

A Platform Admin may configure technical capabilities without receiving corporate-finance access. A CFO may see financial detail without feature-governance mutation authority. A CEO may have broad read access while having few day-to-day mutations.

---

## 3. Non-negotiable principles

1. Truth before visualization.
2. Role is not authority by itself.
3. Corporate titles do not grant permissions.
4. Executive leadership is read-heavy; broad visibility does not imply broad mutation.
5. Every strategic metric and operational queue has an accountable business owner.
6. One metric has one governed definition.
7. Read failure, unavailable source and measured zero are different states.
8. UAT, CI, proof, certification and automation data must not silently inflate business metrics.
9. Genuine historical business records are not the same as test artifacts.
10. Charts, maps, funnels, heatmaps and scorecards must answer management questions rather than decorate pages.
11. Drill-down is progressive: Corporate → business unit → department/team → operating record.
12. Sensitive access and mutations must be least-privilege, attributable and auditable.
13. Business units, subsidiaries, partners, regulators and vendors are distinct entity types.
14. Agents never self-accept; CA-MOD independently certifies every task.

---

## 4. Corporate organisation model

Corporate Admin must support:

Company → legal entity/subsidiary or business unit → department → team.

Reference structure:

- Executive Office
  - CEO
  - COO
  - CFO
  - other executive leadership
- Business Units
  - Marketplace
  - Dealer / Vehicle Commerce
  - Garage & Service
  - Finance / Payments
  - Insurance
  - Diaspora Trade
  - Logistics / Container Services
- Corporate Functions
  - Finance & Accounting
  - Customers & Growth
  - Marketing & Communications
  - Trust / Risk / Compliance
  - Data & Intelligence
  - Legal / Governance
  - People & Administration
- Platform
  - Platform Operations
  - Security
  - AI / Model Operations
  - Data Engineering
  - Feature Governance
  - Integrations

Each organisational node must explicitly state whether it is an internal business unit, corporate function, legal subsidiary, external partner, regulator, vendor, joint venture, or another governed type.

A connected bank, insurer or government agency must never be silently represented as a CarUp department merely because it has a portal.

---

## 5. Corporate identity, RBAC and delegated authority

The eventual access decision is:

Identity × organisation membership × permission set × data scope × geography × current context.

The current flat users.role model is insufficient.

A corporate membership must be able to express:

- entity / business unit;
- department / team;
- position or job function;
- permission set;
- data scope;
- geographic scope;
- delegated authority window.

Base identity and effective authority are different. CarUp must preserve the distinction between:

- base/platform identity;
- corporate assignments;
- current business context;
- partner/tenant-lent authority;
- temporary delegated authority.

The deferred PLATFORM_ROLE / portal-authority problem belongs here. Corporate Admin must not reintroduce a client-side “choose any role” catalogue.

Illustrative authority:

| Function | Scope | Typical access |
| --- | --- | --- |
| CEO | Corporate | Consolidated strategic metrics, broad read access |
| COO | Corporate / Operations | Cross-unit operations, queues, service levels |
| CFO | Corporate / Finance | Revenue, margins, costs, settlements, receivables, payables |
| Marketplace Director | Marketplace | Marketplace customers, sales, listings, moderation and unit performance |
| Diaspora Director | Diaspora Trade | Imports, containers, logistics, customers, trade margins and compliance |
| Compliance Manager | Assigned scope | KYC, evidence, fraud/risk, policy, audit |
| Analyst | Assigned scope | Analytics/reporting; generally no mutation |
| Operator | Assigned business unit | Bounded operating workflows |
| Platform Admin | Platform | Technical configuration and integrations |
| Security Admin | Platform / Security | Access governance, identity security and security audit |

Titles are descriptive; permission assignments are authoritative.

---

## 6. Stable Corporate Admin agent roster

Every Corporate Admin agent has a permanent ID and must refer to other agents by stable ID and exact task ID.

| Agent ID | Stable name | Responsibility |
| --- | --- | --- |
| CA-MOD | Corporate Admin Programme Moderator | Controller; dispatch, verification, acceptance, collision control |
| CA-ARCH | Corporate Architecture & Governance Agent | Canonical architecture, information architecture, cross-agent integration, plan custody |
| CA-ORG | Organisation & Subsidiary Structure Agent | Corporate entity hierarchy and organisational ownership |
| CA-RBAC | Corporate Identity & Access Agent | Memberships, permissions, delegated authority and data scopes |
| CA-METRIC | Metric Governance & Data Semantics Agent | Metric registry, definitions, lineage, ownership and refresh policy |
| CA-FIN | Finance & Management Accounting Agent | Financial semantics and finance-management views |
| CA-GROWTH | Customer & Growth Intelligence Agent | Customer cohorts, navigation intelligence, funnels, acquisition and retention |
| CA-UX | Executive Intelligence UX Agent | Visual language, dashboard composition and responsive executive design |
| CA-BU | Business Unit Administration Agent | BU scorecards, departmental operations and drill-down architecture |
| CA-REPORT | Management Reporting & Board Intelligence Agent | Management reports, executive packs, exports and snapshots |
| CA-PLAT | Platform & Security Administration Agent | Platform, AI/data, security and integration admin boundaries |
| CA-CERT | Corporate Admin Certification Agent | Exact-head certification, cross-role access and visual evidence custody |

### Mandatory cross-agent reference rule

No report may say only “the previous agent” or “another agent”.

Example:

CA-RBAC / CA-RBAC-02 depends on CA-ORG / CA-ORG-01 and CA-METRIC / CA-METRIC-01.

### Mandatory task header

Every dispatched task must state:

- FROM
- TO
- TASK
- DEPENDS ON
- OBJECTIVE
- ALLOWED SCOPE
- PROHIBITED SCOPE
- EXACT HEAD / DATA AUTHORITY
- REQUIRED TESTS / EVIDENCE
- STOP CONDITIONS
- RETURN RECEIPT

Only CA-MOD issues ACCEPT, REMEDIATE or BLOCK. Agents do not self-accept or self-merge.

---

## 7. Canonical information architecture

Corporate Admin 1.0 is founded on these corporate domains:

1. Corporate Overview
2. Business Units
3. Finance
4. Customers & Growth
5. Operations
6. Trust / Risk / Compliance
7. Data & Intelligence
8. People & Access
9. Reports
10. Platform

These are governed domains, not merely menu headings.

### Corporate Overview

Executive summary, company performance, strategic alerts, BU scorecards, finance summary, customer/growth summary, risks/opportunities and period comparison.

### Business Units

Unit-level executive and operating views for Marketplace, Dealer/Vehicle Commerce, Garage & Service, Finance/Payments, Insurance, Diaspora Trade, Logistics/Container Services and future units.

### Finance

Management accounting, revenue, GMV, direct costs, gross profit/margin, settlements, receivables, payables, obligations, refunds/disputes and finance reporting.

### Customers & Growth

Customer cohorts, acquisition, navigation/search intelligence, funnels, retention, reactivation, geography, referral/marketing and conversion.

### Operations

Cross-company service levels, queues, transaction operations, fulfilment and escalations.

### Trust / Risk / Compliance

KYC/identity, evidence review, fraud/risk, compliance controls and audit oversight.

### Data & Intelligence

Metric/data lineage, data quality, intelligence products, AI/advisory health and governed analytical capabilities.

### People & Access

Corporate users, memberships, departments, teams, permissions, delegated authority, access review and account lifecycle. A real account suspension/deactivation model belongs here.

### Reports

Management reports, historical snapshots, scheduled reporting, executive packs and exports.

### Platform

Platform health, integrations, providers, feature governance, security administration and technical operations.

---

## 8. Executive Intelligence visual model

The Corporate Overview must look like an executive intelligence product, not a spreadsheet or generic SaaS card wall.

First-viewport target:

- period, business-unit and region controls;
- Revenue, GMV, Gross Margin, Customers and Conversion headline KPIs;
- Revenue & Margin trend;
- BU Contribution;
- Customer Growth & Retention;
- Conversion Funnel;
- Geographic Performance map;
- Risks / Opportunities;
- BU scorecards.

Use:

- line/area charts for trends;
- bars for comparison/contribution;
- funnels for conversion;
- maps for geography;
- heatmaps for behavioural concentration;
- timelines for operating flow;
- scorecards for BU comparison;
- tables for record-level inspection and reconciliation.

Tables must not dominate executive pages merely because source data lives in tables.

---

## 9. Visual language

Corporate Admin should feel automotive + financial + intelligence platform.

Direction:

- clean light/neutral canvas;
- deep slate/neutral typography;
- CarUp orange used as an accent, not page paint;
- disciplined spacing and restrained borders;
- large numeric KPI typography;
- consistent semantic positive/risk/warning states;
- boardroom-readable charts;
- hierarchy before density;
- desktop-first executive layout with deliberate tablet/mobile adaptation;
- no generic template-dashboard card wall;
- no fabricated trend arrows or decorative percentages.

---

## 10. Metric governance

Every strategic metric must expose one truth state:

| State | Meaning |
| --- | --- |
| Actual | Canonical operational/accounting data |
| Derived | Deterministic calculation from canonical actual data |
| Estimated | Incomplete-data estimate with explicit limitations |
| Forecast | Forward-looking model/scenario output |
| Unavailable | CarUp cannot truthfully calculate it yet |

Corporate Admin requires a Corporate Metric Registry. Minimum fields:

- metric_id;
- name;
- business definition;
- formula/derivation;
- source authority;
- business owner;
- business unit/corporate function;
- refresh frequency;
- currency/unit;
- period semantics;
- geographic scope;
- truth state;
- provenance requirement;
- data classification;
- allowed permission scopes;
- calculation version.

Dashboards consume governed metric definitions. They do not author competing definitions.

---

## 11. Financial semantics

| Metric | Meaning |
| --- | --- |
| GMV | Total value of transactions facilitated by CarUp |
| Revenue | Amount actually earned by CarUp through governed fees, commissions, subscriptions or recognised service income |
| Direct costs / COGS | Costs directly attributable to the associated revenue |
| Gross profit | Revenue minus direct costs |
| Gross margin | Gross profit divided by revenue |
| Operating contribution | Gross profit minus attributable variable operating expenses |
| Net profit | Accounting result requiring proper expense/accounting authority |
| Escrow held | Customer/partner funds held under escrow; not CarUp revenue |
| Receivables | Amount owed to CarUp |
| Payables / obligations | Amount CarUp owes or is obliged to settle |

Binding rule: GMV is not revenue. Escrow is not revenue. Cash received is not automatically profit. Forecast is not Actual.

---

## 12. Customer, navigation and growth intelligence

Where source authority exists, Corporate Admin should distinguish:

- registered users;
- verified users;
- active customers;
- transacting customers;
- returning customers;
- buyers vs sellers;
- dealers/garages/institutional accounts;
- diaspora customers;
- retained/reactivated/churned cohorts;
- acquisition source;
- geography.

Management journeys should connect acquisition to business outcomes, for example:

Acquisition → Landing/Search → Marketplace → Vehicle Detail → Trust/Evidence → Inquiry → Reservation → Payment → Completed Transaction.

The corporate layer should expose governed views of:

- top-performing surfaces;
- fastest-growing surfaces;
- highest-converting journeys;
- highest-revenue-contributing journeys;
- search demand and unmet searches;
- feature adoption;
- geographic demand;
- self/internal/bot traffic exclusion.

Raw clicks alone are not strategic intelligence.

---

## 13. Business-unit scorecards

The executive view is consolidated; each BU gets its own governed scorecard.

Examples:

### Marketplace

Potential metrics: GMV, CarUp revenue, active listings, sellers, buyers, inquiries, conversion, average vehicle value, days-to-sale, top makes/models, top regions, acquisition channels, risk/trust measures where governed, refunds/cancellations.

### Diaspora Trade

Potential metrics: trade/import GMV, CarUp revenue, active orders/customers, average order value, vehicles in transit, container utilisation, cycle time, customs/compliance holds, destination geography, supplier performance, gross margin, obligations.

### Finance / Payments

Potential metrics: transaction volume, fee revenue, escrow held, settlements, receivables, payables, failed payments, disputes/refunds, settlement time and governed finance exposure.

A metric is not active merely because it appears in this plan. CA-METRIC must certify its source before CA-UX renders it as an Actual KPI.

---

## 14. Department drill-down

Within a BU, access becomes progressively scoped.

Example Marketplace:

- Executive Summary
- Sales
- Customers
- Listings
- Operations
- Trust & Risk
- Finance
- Reports

A Marketplace Director may see all relevant sections. A moderation operator may see only bounded operational queues. Product surface follows responsibility and permission scope.

---

## 15. Management reporting

Reporting is first-class, not a screenshot of a dashboard.

Required cadences:

- Daily operational leadership briefing
- Weekly BU management review
- Monthly executive management report
- Quarterly strategy/board pack
- Governed compliance/risk reporting

Dashboards show current interactive state. Reports create stable historical snapshots with period definitions, calculation versions and export provenance.

---

## 16. Data truth and provenance dependency

Programme dependency:

K2A Data Truth → K2B Provenance Authority → Corporate Admin metric activation.

Corporate Admin must consume the shared provenance authority and must not invent another fixture classifier.

Minimum provenance classes:

- real owner-created;
- real business operational;
- UAT;
- CI automation;
- golden test;
- proof/certification;
- seed/demo;
- legacy synthetic;
- historical real;
- unknown/requires review.

---

## 17. Programme phases

### K2A — DATA TRUTH

Question: What information is real?  
Status at plan creation: ACCEPTED.

### K2B — PROVENANCE AUTHORITY

Question: How does CarUp distinguish operational business truth from certification/test/history?  
Status at plan creation: ACTIVE WEB/DATA-TRUTH LANE.

### K3A — CORPORATE ADMIN FOUNDATION

Establish organisation hierarchy, BUs/corporate functions, departments/teams, memberships, RBAC, permission/data scopes, delegated authority, Metric Registry, information architecture and corporate route/access model.

### K3B — EXECUTIVE INTELLIGENCE MVP

Deliver Corporate Overview, BU contribution, Customers & Growth, Finance, Operations, Risk/Compliance and governed scorecards.

### K3C — BUSINESS UNIT ADMIN

Build scoped operating surfaces for Marketplace, Diaspora, Dealer/Vehicle Commerce, Garage & Service, Finance/Payments, Insurance, Logistics/Container and future units as real capabilities exist.

### K3D — MANAGEMENT REPORTING

Deliver governed daily/weekly/monthly/quarterly reports, exports, executive packs and historical snapshots.

### K4 — ADVANCED INTELLIGENCE

Forecasting, anomaly detection, targets/budgets, variance analysis, scenario planning and strategic-planning intelligence. Forecasts/estimates must never overwrite Actuals.

---

## 18. Corporate Admin 1.0 MVP boundary

MVP requires the durable architecture/navigation for:

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

Only governed capabilities become active. Missing capabilities may be labelled unavailable/planned; they must not be filled with mock statistics.

---

## 19. Migration of current Admin capabilities

| Current capability | Target home |
| --- | --- |
| Marketplace Moderation | Marketplace → Operations |
| Communications Command Center | Customers & Growth / Communications Operations |
| Fraud Queue | Trust / Risk / Compliance |
| Evidence Review | Trust / Risk / Compliance |
| AI Monitoring | Data & Intelligence |
| Feature Governance | Platform |
| Drive/Provider Connections | Platform → Integrations |
| Diaspora tools | Business Units → Diaspora Trade |
| Referral tools | Customers & Growth |
| Finance / Escrow | Finance and applicable BU |
| User Management | People & Access |
| Dealer Compliance | Dealer Operations / Compliance |

Current capability is not deleted merely because its current location is wrong.

---

## 20. Conceptual route model

The eventual route scheme may resemble:

- /corporate
- /corporate/overview
- /corporate/business-units
- /corporate/business-units/marketplace
- /corporate/business-units/diaspora
- /corporate/finance
- /corporate/customers
- /corporate/operations
- /corporate/risk
- /corporate/intelligence
- /corporate/people
- /corporate/reports
- /corporate/platform

This is conceptual, not implementation authority. CA-ARCH and CA-RBAC must reconcile it with current CarUp routing before migration.

---

## 21. Information classification

Minimum conceptual classes:

- Public
- Internal
- Internal Confidential
- Restricted Financial
- Restricted Identity/Compliance
- Restricted Security/Platform

Metric visibility and record-level visibility are different. An executive may see an aggregate count without underlying customer PII.

---

## 22. Audit and accountability

Corporate Admin must be able to answer:

- who changed a governed setting;
- who approved/rejected a controlled action;
- which organisational context they acted under;
- which permission authorized it;
- what changed;
- when it changed;
- which data/calculation version produced a management report.

Corporate dashboards must not create untracked mutation paths around governed domain authorities.

---

## 23. Collision rules

1. K2B owns operational provenance remediation until accepted.
2. Corporate Admin agents may inspect K2B but must not build competing provenance authority.
3. Communications retains custody of messaging evidence and transport state.
4. Corporate Admin consumes communications aggregates only after source/provenance semantics are accepted.
5. Finance views must not redefine transaction/escrow authority.
6. AI views remain advisory/operational unless a governed metric explicitly uses an AI output labelled Estimated or Forecast.
7. Corporate Admin work remains documentation/research in parallel until CA-MOD explicitly authorizes product implementation.

---

## 24. Canonical programme controls

Authority order for Corporate Admin:

1. latest explicit Owner direction;
2. latest accepted CA-MOD disposition;
3. this canonical plan;
4. accepted Corporate Admin task receipts;
5. implementation/runtime evidence;
6. ordinary chat discussion.

Major architecture, agent-boundary, metric-semantic, RBAC or programme-phase changes require an explicit proposal, impact analysis, Owner/CA-MOD authorization and repository update.

Every implementation candidate must be certified at an exact SHA. A successful build is not acceptance. An agent report is not acceptance.

---

## 25. First-wave task sequence

The first Corporate Admin wave can run while K2B continues because it is documentation/research only.

1. CA-ARCH-01 — Current-state Corporate Admin architecture inventory and target mapping.
2. CA-ORG-01 — Corporate entity / BU / department model.
3. CA-RBAC-01 — Corporate membership, permissions and delegated authority.
4. CA-METRIC-01 — Metric Registry foundation and source/owner mapping.
5. CA-UX-01 — Executive Intelligence visual system and dashboard wireframe architecture.
6. CA-FIN-01 — Financial metric semantics and management-accounting authority.
7. CA-GROWTH-01 — Customer/navigation/growth metric and funnel authority.
8. CA-CERT-01 — Architecture consistency/collision audit before K3A implementation authority.

CA-MOD may run bounded tasks in parallel only where authorities/files do not collide.

---

## Appendix A — Mandatory agent receipt

Every return must contain:

- AGENT
- TASK
- EXACT STARTING AUTHORITY
- EXACT RESULTING AUTHORITY
- DEPENDS ON
- FILES / SYSTEMS INSPECTED
- FILES CHANGED
- CLAIMS
- PROVEN FACTS
- OPEN QUESTIONS
- COLLISIONS / DEPENDENCIES
- TESTS / EVIDENCE
- STOP CONDITIONS ENCOUNTERED
- RECOMMENDED NEXT AGENT/TASK

The final line is the task-specific return phrase supplied by CA-MOD and must not contain self-acceptance language.

---

## Appendix B — Definition of done for Corporate Admin 1.0 architecture

The architecture phase is complete when:

- Corporate vs Platform administration is separated conceptually and technically.
- Organisation hierarchy can represent company, BU/subsidiary, department and team.
- Corporate memberships and permission scopes replace the assumption that one admin role means all authority.
- Every active strategic KPI has a governed metric definition and source.
- Operational/test provenance cannot silently contaminate management metrics.
- Corporate Overview has a clear graphic executive hierarchy.
- Each BU can own a scorecard without duplicating metric definitions.
- People & Access has a path to real account lifecycle/access review.
- Reports can reproduce historical figures with versioned definitions.
- Corporate Admin remains compatible with governed domain authorities rather than bypassing them.

---

## Current state at plan creation

- K2A — Data Truth: ACCEPTED.
- K2B — Provenance Authority: ACTIVE.
- Corporate Admin architecture: AUTHORIZED IN PARALLEL AS DOCUMENTATION/RESEARCH.
- Product implementation is NOT authorized until separately dispatched.
- The current staging Admin is not the final CEO/corporate product.
- Next Corporate Admin task: CA-ARCH-01.

**END — CARUP CORPORATE ADMIN 1.0 CANONICAL PROGRAMME PLAN**

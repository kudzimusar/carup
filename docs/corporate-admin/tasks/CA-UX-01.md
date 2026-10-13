# CA-UX-01 — CORPORATE ADMIN EXECUTIVE UX / INFORMATION ARCHITECTURE / VISUAL INTELLIGENCE SYSTEM

FROM: CA-MOD — Corporate Admin Programme Moderator
TO: CA-UX — Executive Intelligence UX Agent
TASK: CA-UX-01
PROGRAMME: CA-1.0 — CarUp Corporate Admin 1.0

## Exact accepted authorities

- Canonical plan: 5d4997cacaff8068c4ec4c5ae78f562be4249344
- CA-ARCH-01 ACCEPTED: 7cae8c3c8c987714a8ca6db2128db3b9a589f141
- CA-ORG-01 ACCEPTED: 705eb6fa1cd89109977052e88e220f0498668060
- CA-RBAC-01 ACCEPTED: 4abdf95e1e1490b01f51cb45106a57fcf7b954b9
- CA-METRIC-01 ACCEPTED: 32c26ce5d89ec3829e2afa9248d1e77a2cb4c784
- CA-FIN-01 ACCEPTED: 9ba7388559fa13cf353e410ce2a62be30660bdeb
- CA-GROWTH-01 ACCEPTED / K2B-RECUSTODIED: f7e4c0519411994383d8d3e316c10b380f0e728d
- K2B operational-provenance authority ACCEPTED / FROZEN: 7b34dec1bc9f05b72b6abf0104db65980f280a0b
- Current documentation programme head: f7e4c0519411994383d8d3e316c10b380f0e728d

## Read and obey in full

- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md
- docs/corporate-admin/CARUP_CORPORATE_FINANCE_MODEL.md
- docs/corporate-admin/CARUP_CUSTOMER_GROWTH_INTELLIGENCE_MODEL.md

Read-only inspect current accepted web/Admin implementation at K2B authority where useful:

- product/reference head: 7b34dec1bc9f05b72b6abf0104db65980f280a0b

Do not substitute current implementation limitations for the accepted Corporate Admin architecture.

---

## MODERATOR AUTHORITY

AUTHORIZED — UX ARCHITECTURE / INFORMATION ARCHITECTURE / VISUAL INTELLIGENCE DESIGN / DOCUMENTATION ONLY

NO WEB PRODUCT IMPLEMENTATION.
NO BACKEND IMPLEMENTATION.
NO DATABASE MIGRATION.
NO RBAC IMPLEMENTATION.
NO METRIC FORMULA CREATION.
NO FINANCE POLICY INVENTION.
NO CUSTOMER POLICY INVENTION.
NO K2B MUTATION.
NO DEPLOYMENT.
NO MERGE.
NO PRODUCTION.

---

## 1. Objective

Design the canonical CarUp Corporate Admin 1.0 user experience as a strategic management system, not a generic admin console.

The Owner requires a corporate-grade, graphic, executive and operational intelligence environment that can scale from MVP into a multi-business-unit company.

The UX must translate governed CarUp data into:

- executive understanding;
- business-unit performance;
- finance visibility;
- customer and growth intelligence;
- operational management;
- trust/risk/compliance oversight;
- people/access governance;
- reports and management cadence;
- platform/security administration;
- data-quality and provenance awareness.

The design must make it obvious which plane the user is operating in:

1. Corporate Intelligence
2. Business Operations
3. Platform & Security

Do not collapse these into one generic Admin surface.

---

## 2. Binding top-level information architecture

The canonical top-level Corporate Admin IA is:

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

Do not replace this with the current /admin menu merely because that is what exists today.

Map current routes into this future IA as REUSE / REHOME / SPLIT / RETIRE / REBUILD-AS-VIEW.

---

## 3. Executive UX principle

The Corporate Overview must feel like a boardroom and operating-review system, not a SaaS card wall.

Required visual character:

- premium automotive + financial + intelligence language;
- neutral/slate base with controlled CarUp orange accent;
- high information density without visual clutter;
- large meaningful charts where trend/comparison matters;
- maps only where geography authority exists;
- funnels only where linked stages exist;
- heatmaps/matrices only where the underlying dimensions are governed;
- ranked views only when rank semantics are defined;
- tables primarily for inspection/drill-down, not as the dominant executive composition;
- clear exception and attention states;
- strong typography and hierarchy;
- management-readable on laptop/large desktop;
- responsive behavior for tablet/smaller web widths without recreating the native app.

Do not invent decorative KPI cards simply to fill space.

---

## 4. Global shell

Define the canonical Corporate Admin web shell.

At minimum specify:

- primary navigation pattern;
- page title / context hierarchy;
- current Corporate plane indicator;
- scope selector behavior;
- BU / function / geography context;
- reporting period selector;
- comparison period selector where valid;
- metric freshness indicator;
- user/account/profile placement;
- notifications/attention center behavior;
- breadcrumbs / drill-up behavior;
- global search or command-palette behavior if justified;
- role/capability-sensitive navigation;
- restricted-data indicators;
- responsive collapse behavior.

Do not make a job title the source of navigation authority.

Navigation is permission-driven under CA-RBAC.

---

## 5. Corporate Overview

Design the executive landing composition.

It must answer, in priority order:

- What is happening across CarUp now?
- What changed versus the selected comparison period?
- Which business unit/function needs attention?
- What is growing?
- What is deteriorating?
- What is unavailable or not yet measurable?
- What requires management action?

Define a visual hierarchy such as:

A. Executive headline strip / high-confidence governed metrics
B. Business-unit performance overview
C. Customer/Growth demand picture
D. Finance position
E. Operations / throughput / backlog
F. Trust/Risk/Compliance exceptions
G. Geographic / market view where authoritative
H. Data quality / provenance / freshness
I. Management actions / reports due

But do not activate a metric that the accepted models block.

Where a desired executive KPI has no authority, design a truthful unavailable/provisional state instead of inserting zero or fabricated values.

---

## 6. Metric visual-state grammar

Consume CA-METRIC and define how the UI renders:

- GOVERNED_ACTUAL
- GOVERNED_DERIVED
- GOVERNED_RATE_OR_RATIO
- ADVISORY
- TECHNICAL_OPERATIONAL
- PENDING_K2B_CONSUMPTION
- PENDING_CA_FIN
- INSUFFICIENT_DATA
- UNAVAILABLE_NO_SOURCE
- UNAVAILABLE_NOT_SEPARABLE
- DUPLICATED_OR_CONFLICTING
- UNKNOWN_AUTHORITY
- DEGRADED
- FORBIDDEN / no permission

Zero, no data, unavailable, not separable and forbidden MUST look and read differently.

Do not use red/green performance semantics unless a governed target/baseline exists.

Every executive metric needs discoverable metadata for:

- definition;
- source;
- period;
- calculation version;
- freshness;
- scope;
- truth/quality state.

---

## 7. Business Units UX

Consume CA-ORG.

Design the Business Units area around the accepted non-legal management BU candidates:

- BU_MARKETPLACE
- BU_SERVICE_NETWORK
- BU_FINANCIAL_SERVICES
- BU_DIASPORA_TRADE

These are management constructs, not claims of legal entities.

Create a reusable BU scorecard structure with slots for:

- customers / participants where governed;
- demand;
- supply/capacity;
- throughput;
- conversion where linked;
- revenue only when finance authority eventually exists;
- gross profit only when authoritative;
- risk;
- service quality;
- backlog;
- cycle time;
- geography;
- key exceptions.

Not every BU must populate every slot.

Design cross-BU comparison without summing incompatible metrics.

---

## 8. Finance UX

Consume CA-FIN exactly.

Corporate Finance & Accounting must be visually and navigationally distinct from Finance/Payments product activity.

Design Finance sections for the future governed model, including:

- Executive Finance Summary;
- Revenue / margin views when source authority exists;
- Cash / treasury when source authority exists;
- Settlement / escrow exposure;
- Receivables / payables when authoritative;
- Management accounting by BU / profit centre / cost centre;
- period close / reporting state;
- finance exceptions / reconciliation;
- source-system and currency disclosure.

Current unavailable accounting metrics MUST be represented as unavailable/PENDING_CA_FIN, not fake values.

Product facts such as finance applications, deposits, SafePay state or Trade commercial charges may appear only in correctly labelled operational/product views.

Do not turn product payment states into Corporate revenue.

---

## 9. Customers & Growth UX

Consume CA-GROWTH.

Design the area so it can show useful demand/growth intelligence even while universal customer metrics remain blocked.

Separate:

- Accounts / identity
- Known/verified identity subjects
- Marketplace demand
- Search/filter behavior
- Leads/inquiries
- Buyer/Seller journeys
- Trade demand
- Service-network demand
- Acquisition associations
- Navigation/product discoverability
- Cohorts/retention only when definitions exist
- Geography only using correct geography type

Do not label registered accounts as customers.
Do not label inquiries as sales.
Do not label route views as users/customers.
Do not label independent stage totals as conversion.

Where customer definition is unresolved, the UI must use source-accurate labels such as:

- Registered accounts
- Operational accounts
- Verified identity subjects
- Inquiries
- Known shoppers
- Trade buyers/participants

only where their semantic authority exists.

---

## 10. Navigation / Data Intelligence UX

Design a strategic intelligence area for the Owner requirement around clicks, routes, feature usage, search/filter behavior and rankings.

Must distinguish:

A. Navigation Intelligence
- route renders;
- item impressions;
- item selections;
- feature discoverability;
- destination blocked/errors;
- technical/UX discoverability.

B. Marketplace / commercial behavioral intelligence
- searches;
- filters;
- result/detail progression;
- saves;
- inquiries;
- seller journey;
- linked commercial outcomes where available.

Never merge the two into one false funnel.

Explicitly design for known limitations:

- Navigation 50,000-row completeness bound;
- peak-day unique versus true period unique;
- hashed search terms rather than human-readable free text;
- staff/self/bot and K2B-consumption status;
- missing link keys.

Design degraded/incomplete states visibly.

---

## 11. Operations UX

Design Operations as a management plane, not an executive vanity dashboard.

Cover reusable patterns for:

- operational queues;
- backlogs;
- exception lists;
- SLA/cycle-time views;
- throughput;
- workload/capacity;
- service/garage operations;
- Marketplace moderation operational status where appropriate;
- Trade/logistics operational stages;
- communications operations where business-facing;
- drill-down to governed records.

Separate business operations from Platform technical operations.

---

## 12. Trust / Risk / Compliance UX

Design executive aggregate plus restricted operator drill-down.

Potential surfaces:

- verification state summary;
- evidence review backlog;
- fraud queue;
- compliance review;
- Marketplace trust status;
- unresolved/review-needed provenance;
- risk trend;
- policy/decision exceptions;
- audit access where authorized.

Aggregate executive visibility must not imply access to KYC/evidence/PII records.

Use CA-RBAC classification and drill-down rules.

---

## 13. People & Access UX

Consume CA-RBAC.

Design People & Access around:

- Corporate memberships;
- permission assignments;
- organisational scope;
- geographic scope;
- delegated authority;
- access lifecycle;
- access reviews;
- break-glass visibility;
- session/account actions where authorized;
- audit/history.

Do not reuse current `users.role` as the future Corporate membership editor.

Do not present job titles as authority.

Do not implement account suspension as role mutation.

Show clearly the difference between:

- Account
- Corporate membership
- Permission assignment
- External tenant membership
- Session

and their separate revoke/suspend semantics.

---

## 14. Reports UX

Reports are first-class.

Design a Reports area for:

- Daily Operations
- Weekly BU Review
- Monthly Executive Review
- Quarterly Board / Strategy
- Compliance / Risk
- ad-hoc governed report generation

Each report must carry:

- reporting period;
- metric versions;
- scope;
- truth/quality states;
- provenance status;
- currency/units;
- owner/publisher;
- generated timestamp;
- export restrictions.

Design generate / review / approve / publish states without assuming the same user may perform all actions.

---

## 15. Platform UX

Platform is a separate technical administration plane.

Design navigation and page families for:

- platform health;
- integrations/providers;
- feature governance;
- AI/model operations;
- security controls;
- technical communications/provider status;
- deployment/environment visibility where authorized;
- data-pipeline/platform diagnostics.

Do not place Corporate Finance, Customer Growth or BU management metrics inside Platform merely because an admin can access both.

---

## 16. Role/capability-aware experiences

Do not create separate products for CEO/CFO/COO, but define example landing/composition behavior for capability archetypes.

At minimum model:

- executive aggregate viewer;
- operations leader;
- finance leader;
- BU leader;
- growth/customer leader;
- trust/compliance leader;
- People/access administrator;
- Platform administrator;
- Security administrator;
- Data/Intelligence administrator;
- read-only auditor.

Titles are examples only.

For each, define:

- default landing domain;
- visible top-level sections;
- aggregate versus drill-down access;
- restricted-data behavior;
- export behavior;
- unavailable/forbidden behavior.

---

## 17. Drill-down architecture

Define a consistent management drill path:

Corporate Overview
→ domain / BU
→ metric or exception
→ governed population
→ record/detail where permitted

Every drill-down must preserve:

- scope;
- reporting period;
- metric definition/version;
- filter context;
- provenance/truth state;
- RBAC.

A drill-down may stop at aggregate level when underlying records are restricted.

---

## 18. Scope and filter architecture

Define which filters are global versus page-local.

Potential global dimensions:

- reporting period;
- comparison period;
- BU;
- corporate function;
- legal entity only when proven;
- geography;
- currency where applicable.

Do not expose a filter that the underlying metric cannot support.

Filters must not silently change metric grain or formula.

---

## 19. Executive attention system

Design an attention/exception pattern that can surface:

- operational degradation;
- risk backlog;
- data-quality degradation;
- metric freshness breach;
- unavailable critical source;
- threshold/target breach only when a governed target exists;
- report due/approval pending;
- security/platform incidents only to authorized users.

Do not create an AI-generated severity system without authority.

---

## 20. Visual component grammar

Define when to use:

- headline metric / scorecard;
- sparkline;
- trend line;
- stacked bar;
- comparison bar;
- distribution;
- funnel;
- cohort grid;
- heatmap;
- map;
- matrix;
- ranked list;
- exception queue;
- timeline;
- table;
- status badge;
- provenance/freshness indicator;
- unavailable/blocked panel.

For each component type specify:

- valid data conditions;
- invalid/misleading uses;
- required labels;
- drill-down behavior.

---

## 21. Responsive web behavior

Corporate Admin is a web management system.

Define:

- desktop/laptop primary composition;
- tablet adaptation;
- narrower browser behavior;
- which dense visualizations collapse into summaries;
- table horizontal/column behavior;
- filter drawer behavior;
- no assumption that mobile web replaces the separate CarUp native product.

---

## 22. Accessibility / readability

Require:

- keyboard navigation;
- screen-reader labels;
- visible focus;
- color-independent state communication;
- chart textual summaries;
- adequate contrast;
- scalable text;
- no meaning carried only by color;
- accessible table and drill-down semantics.

---

## 23. Current Admin migration map

Read-only inspect the current `/admin` implementation at accepted K2B authority.

Produce a migration map showing where current surfaces belong in the new Corporate IA.

Classify each current page/surface as:

- KEEP / WRAP
- REHOME
- SPLIT
- MERGE
- RETIRE
- PLATFORM-ONLY
- OPERATIONS-ONLY
- CORPORATE-INTELLIGENCE VIEW NEEDED

Pay special attention to known mixed-plane areas:

- Admin Users
- Communications
- Feature Governance / Navigation Intelligence
- Marketplace moderation/analytics
- Fraud / Evidence / Verification
- Dealer/Garage management
- referrals/growth
- Command Centre.

Do not change code.

---

## 24. Canonical page blueprints

Provide detailed page-level blueprints/wireframes in Markdown for at least:

1. Corporate Overview
2. Business Units overview
3. BU detail
4. Finance overview
5. Customers & Growth overview
6. Operations overview
7. Trust / Risk / Compliance overview
8. Data & Intelligence overview
9. People & Access overview
10. Reports
11. Platform overview

Use textual/ASCII or Mermaid wireframes where useful.

Each blueprint must identify:

- page objective;
- primary user question;
- top controls;
- visual hierarchy;
- metric slots and their required authority state;
- drill-down destinations;
- empty/unavailable behavior;
- role/capability constraints;
- responsive behavior.

Do not fill wireframes with invented business numbers.

---

## 25. Owner visual direction

The UX must embody these Owner requirements:

- graphic, not spreadsheet-like;
- strategic management first;
- clear corporate hierarchy;
- business units visible;
- finance/customer/geography/profitability designed as first-class domains;
- navigation/click/search intelligence translated into business understanding only when semantically valid;
- scalable to departments, subsidiaries/legal entities and regions without pretending those structures already exist;
- useful from MVP, not merely a future enterprise mockup.

Do not produce a generic template.

---

## 26. Owner Decision Register

Create OD-CAUX-* decisions only where visual/product-policy choices genuinely require Owner input.

At minimum consider:

- default Corporate landing page;
- executive density level;
- default reporting period;
- global scope selector behavior;
- light/dark mode policy for Corporate Admin;
- default BU comparison arrangement;
- whether unavailable strategic metrics remain visible as blocked slots or are hidden;
- map usage/default geography;
- executive alert/attention placement;
- report approval workflow presentation;
- whether Platform is visible in the same nav for executive-only users;
- terminology for Accounts vs Customers until customer policy resolves;
- preferred boardroom presentation/export mode.

Do not ask the Owner to decide matters already governed by CA-METRIC/CA-RBAC/CA-FIN/CA-GROWTH.

---

## 27. Required deliverable

Create:

docs/corporate-admin/CARUP_CORPORATE_ADMIN_UX_ARCHITECTURE.md

The document must include:

1. authority/custody;
2. UX principles;
3. three management planes;
4. top-level IA;
5. global shell;
6. Corporate Overview composition;
7. BU UX;
8. Finance UX;
9. Customers & Growth UX;
10. Operations UX;
11. Trust/Risk/Compliance UX;
12. Data & Intelligence UX;
13. People & Access UX;
14. Reports UX;
15. Platform UX;
16. role/capability-aware experience model;
17. metric visual-state grammar;
18. component/visualization grammar;
19. drill-down model;
20. scope/filter model;
21. executive attention model;
22. responsive/accessibility rules;
23. current Admin migration map;
24. 11 required page blueprints;
25. Owner Decision Register;
26. downstream implementation contract;
27. certification/evidence expectations;
28. open risks;
29. recommended next implementation task.

Optional:

- one additional small Markdown wireframe companion under docs/corporate-admin/ if the main artifact becomes unreadable;
- Mermaid diagrams embedded in Markdown.

Do not create web components, screenshots, fake dashboards or product code.

---

## 28. Downstream implementation contract

Define the minimum rules future K3 implementation specialists must follow.

At minimum:

- consume K2B rather than recreate provenance;
- consume CA-METRIC definitions rather than recompute KPIs;
- preserve CA-RBAC aggregate/drill-down restrictions;
- preserve CA-FIN unavailable accounting states;
- preserve CA-GROWTH customer/funnel semantics;
- do not invent dummy values;
- do not treat failed reads as zero;
- do not weaken current auth/domain authorities;
- keep Corporate Intelligence, Business Operations and Platform/Security separable;
- certify exact-head responsive behavior;
- use real staging data only under accepted provenance rules.

---

## 29. Evidence / certification expectations

Define what CA-CERT should eventually require for implementation acceptance, including:

- page/role matrix;
- responsive captures;
- permission-denied states;
- unavailable/no-data states;
- K2B operational-only truth;
- metric/source metadata;
- drill-down scope preservation;
- finance blocked-state truth;
- PII separation;
- keyboard/accessibility;
- visual hierarchy fidelity;
- no fake values;
- cross-surface metric reconciliation.

---

## 30. Repository scope

AUTHORIZED MUTATION:

docs/corporate-admin/**

READ-ONLY INSPECTION:

web/**
backend/**
shared/**
accepted programme docs

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
aliases

---

## 31. Stop conditions

STOP rather than guess if:

- the design requires inventing a metric;
- the design requires redefining customer semantics;
- the design requires finance/accounting assumptions;
- a page would expose restricted records beyond CA-RBAC;
- a desired chart lacks governed denominator/time/grain;
- a map would imply geography not proven by source;
- a ranking would be misleading under incomplete data;
- a design depends on a legal entity/subsidiary not yet proven;
- product/database mutation appears necessary.

Use blocked/unavailable states and Owner Decisions instead of fabrication.

---

## 32. Return receipt

Return:

AGENT: CA-UX
TASK: CA-UX-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES / SYSTEMS INSPECTED
FILES CHANGED
PROVEN CURRENT UX / ADMIN FACTS
PROPOSED CORPORATE UX ARCHITECTURE
CURRENT ADMIN MIGRATION MAP
PAGE BLUEPRINT SUMMARY
ROLE/CAPABILITY EXPERIENCE MODEL
METRIC/TRUTH VISUAL MODEL
OWNER DECISIONS REQUIRED
OPEN RISKS
DOWNSTREAM IMPLEMENTATION CONTRACT
STOP CONDITIONS
RECOMMENDED NEXT TASK

Final line exactly:

CA-UX-01 CORPORATE ADMIN UX ARCHITECTURE READY FOR MODERATOR REVIEW

Do not self-accept.
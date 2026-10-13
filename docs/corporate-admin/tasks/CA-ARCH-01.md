# CA-ARCH-01 — CURRENT-STATE CORPORATE ADMIN ARCHITECTURE INVENTORY / TARGET MAPPING

FROM: CA-MOD — Corporate Admin Programme Moderator  
TO: CA-ARCH — Corporate Architecture & Governance Agent  
TASK: CA-ARCH-01  
PROGRAMME: CA-1.0 — CarUp Corporate Admin 1.0

Canonical programme authority:

docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md

Canonical plan commit:

5d4997cacaff8068c4ec4c5ae78f562be4249344

Current product/reference authority to inspect:

PR #222 / fix/oc5r-real-runtime-source-closure  
505ffcca6b641c8b3b55f503e0f4fd39d26710dc

Current parallel dependency:

K2B — Operational Provenance Authority / Admin Truth Convergence  
ACTIVE under the web/data-truth lane.

## MODERATOR DISPOSITION

AUTHORIZED — ARCHITECTURE DISCOVERY / MAPPING / DOCUMENTATION ONLY

NO PRODUCT IMPLEMENTATION.

NO DATABASE MUTATION.

NO RBAC MIGRATION.

NO ROUTE MIGRATION.

NO CORPORATE DASHBOARD IMPLEMENTATION.

NO ADMIN VISUAL REDESIGN.

NO K2B PROVENANCE REIMPLEMENTATION.

---

## 1. Objective

Establish a reliable current-state architecture map showing how the CarUp repository as it exists today maps into the target Corporate Admin 1.0 architecture.

The output must answer:

1. What Admin, intelligence, reporting, finance, people/access, business-unit and platform capabilities already exist?
2. Which current routes/components/endpoints are technical/platform administration versus genuine corporate/business management?
3. Which capabilities belong under each target Corporate Admin domain?
4. Which existing role assumptions conflict with the canonical corporate membership/RBAC direction?
5. Which metrics/projections already have governed source authority and which are ad hoc, unavailable, duplicated or unsafe?
6. Which current features can be reused, moved, wrapped or must eventually be redesigned?
7. What dependencies must be resolved before CA-ORG-01, CA-RBAC-01, CA-METRIC-01 and CA-UX-01 begin?
8. Where will K2B provenance authority need to be consumed by Corporate Admin, without CA-ARCH creating another provenance mechanism?

This is an architecture inventory, not implementation.

---

## 2. Binding architecture

Read the complete canonical plan before any repository analysis.

Do not reinterpret or silently narrow:

- the three management planes;
- the organisation hierarchy;
- the stable Corporate Admin agent roster;
- the Corporate Admin information architecture;
- metric truth states;
- finance semantics;
- executive-intelligence visual direction;
- the K2A → K2B → K3A → K3B → K3C → K3D → K4 sequence;
- Corporate vs Platform administration separation;
- the rule that one admin role must not mean all authority.

If repository reality conflicts with the plan, document the conflict. Do not silently change the plan.

---

## 3. Required repository inventory

Inspect current source at exact reference authority 505ffcca... and map at minimum:

### Web / navigation

- web/src/App.tsx
- DashboardLayout / Navbar / MobileNavDrawer / CompactBottomNav
- feature/navigation registries and route-access logic
- all current /admin routes
- all current role dashboards and portal shells

### Admin / operations

- AdminDashboard
- UserManagement
- MarketplaceModeration
- Fraud / risk queues
- Evidence review
- Identity / verification admin
- Dealer compliance
- Communications Command Center
- AI monitoring
- Feature Governance
- integrations/provider administration
- finance/escrow administration
- referral/growth tooling
- Diaspora administration

### Intelligence

Inventory all governed intelligence projections already present, including where applicable:

- Command Centre
- Navigation Intelligence
- Dealer intelligence
- Garage/service intelligence
- Insurance demand
- Finance demand
- Parts/provenance
- Diaspora/trade intelligence
- Referral/marketing intelligence
- Institutional/government intelligence
- any customer/activity/funnel or reporting services

### Backend authority

For every mapped Admin capability identify:

- route;
- authorization middleware;
- service/projection;
- source table(s);
- current actor/role assumptions;
- mutation capability;
- audit sink where relevant;
- provenance filtering, if any;
- whether output is operational, technical, advisory or strategic.

---

## 4. Required target-domain mapping

Map every current capability into exactly one primary target home where possible:

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

A capability may have secondary consumers, but there must be one primary product owner/domain.

Example:

Marketplace Moderation  
→ primary: Business Units / Marketplace / Operations  
→ secondary aggregate consumer: Corporate Operations / Trust where governed.

Do not put everything under Corporate Overview.

---

## 5. Management-plane classification

Every current capability must also be classified as one of:

- CORPORATE_INTELLIGENCE
- BUSINESS_OPERATIONS
- PLATFORM_SECURITY
- SHARED_GOVERNED_SERVICE

Explain ambiguous cases.

This classification is independent of the current URL.

A page under /admin does not automatically mean Corporate Intelligence.

---

## 6. Current-role audit

Inventory current use of:

- admin
- platform_admin
- super_admin
- owner
- dealer
- mechanic
- insurance
- bank
- government
- reviewer or other effective roles

For each Admin/corporate-capable route determine:

- whether access is platform-role based;
- whether tenant/org context is used;
- whether role equates to job function;
- whether current model can express departmental/business-unit scope;
- whether mutations are broader than future least-privilege expectations.

Do not design the final RBAC schema here. Produce the gap map for CA-RBAC.

---

## 7. Metric/projection inventory

Do not calculate new business KPIs.

Inventory existing metric/projection contracts and classify each as:

- GOVERNED_ACTUAL
- GOVERNED_DERIVED
- ADVISORY
- TECHNICAL_OPERATIONAL
- CONTAMINATED_PENDING_K2B
- UNAVAILABLE
- DUPLICATED_OR_CONFLICTING
- UNKNOWN

For each include:

- metric/projection name;
- source authority;
- calculation location;
- current consumer;
- business owner if inferable;
- time-window semantics;
- provenance dependency;
- recommended future Corporate Admin domain.

Flag any duplicate definitions of the same business idea.

---

## 8. Visual/current-product audit

Without redesigning, assess the current Admin information structure against the canonical visual direction.

Document:

- card-wall patterns;
- spreadsheet/table-heavy screens;
- lack of executive hierarchy;
- technical controls mixed with business KPIs;
- excessive flat navigation;
- areas that already contain useful charts/maps/funnels/scorecards;
- reusable visualization components;
- responsive constraints relevant to future CA-UX work.

Do not produce final visual designs in CA-ARCH-01.

---

## 9. Corporate structure questions

Prepare a list for CA-ORG of organisational questions that the repository cannot answer, including:

- which units are internal BUs versus legal subsidiaries;
- which external banks/insurers/government bodies are partners versus internal units;
- geographic hierarchy needs;
- department/team hierarchy;
- cross-functional corporate functions;
- ownership/accountability of each BU.

Do not invent legal entities.

---

## 10. Data-truth / K2B boundary

K2B owns operational provenance.

CA-ARCH may:

- inspect its proposed/current contracts;
- identify Corporate Admin consumers;
- identify places where Corporate Admin will require provenance-aware metrics.

CA-ARCH must not:

- create another fixture classifier;
- change K2B code;
- classify ambiguous production-like records;
- mutate data.

If K2B is not yet complete, mark dependencies as PENDING_K2B.

---

## 11. Required deliverables

Create:

docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md

The document must contain:

1. exact authority/custody;
2. current Admin route map;
3. capability inventory;
4. management-plane classification;
5. target Corporate Admin domain mapping;
6. endpoint/service/table map;
7. role/access gap matrix;
8. metric/projection inventory;
9. current visual/information-architecture assessment;
10. reuse / move / redesign recommendations;
11. K2B dependencies;
12. collision risks;
13. open organisational questions for CA-ORG;
14. inputs required by CA-RBAC;
15. inputs required by CA-METRIC;
16. inputs required by CA-UX;
17. proposed next first-wave task order.

Also create a concise machine-readable mapping if useful, but only if it materially improves traceability. Do not create unnecessary framework/code.

---

## 12. Repository scope

AUTHORIZED:

- docs/corporate-admin/**

READ-ONLY INSPECTION:

- web/**
- backend/**
- shared/**
- existing docs relevant to Admin/intelligence/RBAC/reporting

PROHIBITED MUTATION:

- web/**
- backend/**
- shared/**
- database/**
- mobile/**
- .github/workflows/**
- staging database
- production
- aliases/deployments

No application commit outside docs/corporate-admin/**.

---

## 13. Evidence requirements

Return exact file references for the most important findings.

Distinguish:

CLAIM  
from  
PROVEN REPOSITORY FACT  
from  
ARCHITECTURAL RECOMMENDATION.

Do not state that a capability exists because a planning document mentions it; verify runtime/source implementation where practical.

No deployment is needed.

No browser UAT is required unless needed only to understand current information architecture; do not mutate product state.

---

## 14. Stop conditions

STOP and report if:

- the canonical plan conflicts with a later explicit Owner/CA-MOD authority;
- product mutation appears necessary to answer the inventory;
- K2B files are being concurrently changed in a way that makes a factual conclusion unsafe;
- legal/subsidiary status would have to be invented;
- a metric source cannot be identified reliably;
- the task would expose secrets or unnecessary personal information.

Unknown is an acceptable architecture result.

---

## 15. Return receipt

Use the canonical receipt format.

Return:

AGENT: CA-ARCH  
TASK: CA-ARCH-01  
EXACT STARTING AUTHORITY: canonical plan commit + inspected product SHA  
EXACT RESULTING AUTHORITY: docs branch SHA  
DEPENDS ON: K2A ACCEPT / K2B ACTIVE  
FILES / SYSTEMS INSPECTED  
FILES CHANGED  
CLAIMS  
PROVEN FACTS  
OPEN QUESTIONS  
COLLISIONS / DEPENDENCIES  
TESTS / EVIDENCE  
STOP CONDITIONS ENCOUNTERED  
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-ARCH-01 CURRENT-STATE CORPORATE ADMIN MAP READY FOR MODERATOR REVIEW

Do not self-accept.

# CARUP CORPORATE ADMIN UX ARCHITECTURE

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-UX — Executive Intelligence UX Agent  
Task: CA-UX-01  
Status: UX ARCHITECTURE / INFORMATION ARCHITECTURE / VISUAL INTELLIGENCE DESIGN ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This UX architecture is produced under the following exact accepted authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical plan authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Accepted CA-ORG-01 authority: `705eb6fa1cd89109977052e88e220f0498668060`
- Accepted CA-RBAC-01 authority: `4abdf95e1e1490b01f51cb45106a57fcf7b954b9`
- Accepted CA-METRIC-01 authority: `32c26ce5d89ec3829e2afa9248d1e77a2cb4c784`
- Accepted CA-FIN-01 authority: `9ba7388559fa13cf353e410ce2a62be30660bdeb`
- Accepted / K2B-recustodied CA-GROWTH-01 authority: `f7e4c0519411994383d8d3e316c10b380f0e728d`
- Accepted / frozen K2B operational-provenance authority: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`
- Current documentation starting head: `b7ee82aec73f78bac8d0bac9c5a90dcc6168ac1a`
- Current accepted web/Admin implementation inspected read-only: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`

At execution time PR #222 was Draft/Open/Unmerged at exact head `7b34dec1bc9f05b72b6abf0104db65980f280a0b`. CA-UX-01 therefore inspected the same exact accepted K2B/product authority supplied by CA-MOD. No later implementation was substituted.

This document is the canonical design authority for future Corporate Admin UX implementation subject to CA-MOD acceptance. It does not implement web components, backend APIs, database schema, RBAC, metric calculations, finance policy, customer policy, K2B provenance, deployment or production mutation.

---

## 2. Executive design position

CarUp Corporate Admin must not be a restyled version of the current `/admin` shell.

It must operate as a **corporate management system** with three visibly distinct management planes:

1. **Corporate Intelligence** — understand company and BU performance, management reporting, governed demand, finance state and strategic exceptions.
2. **Business Operations** — operate queues, cases, workflows, backlogs and controlled business decisions.
3. **Platform & Security** — administer technical capabilities, providers, feature governance, AI/model operations, security and runtime diagnostics.

The current Admin product is valuable as an inventory of proven services and workflows, but its single `admin` presentation model is not the future Corporate authority.

The future UX must therefore:

- preserve existing governed domain services instead of rebuilding business authority in the UI;
- make the management plane unmistakable on every page;
- let one authenticated person move between planes only when their CA-RBAC permissions permit it;
- preserve organisational, geographic, data-classification, delegation, assurance and time scopes during navigation;
- visibly distinguish actual, derived, advisory, unavailable, degraded and forbidden states;
- make management questions primary and tables secondary;
- never fabricate values to complete a visual composition.

---

## 3. UX principles

### 3.1 Management question before widget

Every major visual must answer a named management question.

Examples:

- “Which BU changed materially in the selected period?”
- “Where is Marketplace demand outrunning available supply?”
- “Which operational queue is accumulating?”
- “Which governed source is stale or unavailable?”
- “Which Trade corridor is seeing more qualified process activity?”
- “Which access review or compliance queue requires action?”

A visual that cannot answer a real management question is diagnostic context, not an executive KPI.

### 3.2 Truth before polish

The UI must never improve appearance by weakening semantics.

Binding examples:

- unavailable is not `0`;
- failed read is not empty;
- no source is not no activity;
- unknown provenance is not operational;
- registered accounts are not customers;
- inquiries are not sales;
- payment intent is not revenue;
- independent stage totals are not conversion;
- navigation route renders are not users;
- peak-day unique is not period unique.

### 3.3 Corporate hierarchy before implementation history

The UX follows the canonical corporate IA, not the current route grouping.

### 3.4 Aggregate first, restricted detail second

Executive views should begin with governed aggregates. Record-level PII, identity evidence, finance line items and platform secrets are separate restricted drill-downs.

### 3.5 Exception-led management

Management attention is better served by meaningful exceptions, freshness failures and queue degradation than by decorative card walls.

### 3.6 Graphic, not spreadsheet-like

Primary page composition should favor:

- trend lines;
- comparison bars;
- distributions;
- linked funnels;
- cohort matrices;
- governed rankings;
- maps only where valid;
- exception bands;
- timelines;
- compact scorecards.

Tables are appropriate for:

- drill-down;
- queues;
- audit;
- record inspection;
- comparison details.

### 3.7 Source lineage is part of UX

Every management metric needs discoverable metadata for:

- definition;
- source authority;
- metric version;
- period;
- as-of time;
- provenance eligibility;
- scope;
- truth state;
- classification;
- relevant caveat.

### 3.8 No title-based product forks

There is one Corporate Admin product. CEO/CFO/COO/BU-lead-style archetypes influence visible composition through permission sets and scope, not separate hard-coded applications.

---

## 4. Visual language

### 4.1 Character

The target visual language is:

- corporate;
- premium automotive;
- financially serious;
- intelligence-led;
- calm rather than decorative;
- high-density without being cramped.

### 4.2 Base treatment

Use:

- neutral/slate page chrome;
- white/near-white content surfaces in light mode;
- controlled CarUp orange for brand emphasis and selected navigation;
- semantic state treatments that include text/icon/pattern, never color alone;
- restrained shadows and borders;
- strong typographic hierarchy;
- large chart canvases for meaningful comparisons.

### 4.3 Information density

Desktop should support a boardroom/operating-review reading distance:

- one executive story per viewport;
- a small number of large primary visuals;
- secondary detail below;
- no grid of 12 equal-weight cards.

### 4.4 Performance color

Do not use red/green to mean “bad/good” unless a governed target, threshold or expected direction exists.

Red may still communicate:

- security severity;
- explicit error;
- blocked state;
- failed controlled action.

Green may communicate:

- successful technical state;
- explicit approved/complete workflow state.

Neither may imply business performance without a governed baseline.

---

## 5. Three management planes

### 5.1 Corporate Intelligence

Purpose:

- understand;
- compare;
- explain;
- review;
- report.

Primary top-level homes:

- Corporate Overview;
- Business Units;
- Finance;
- Customers & Growth;
- Data & Intelligence;
- Reports.

This plane is primarily aggregate and analytical.

### 5.2 Business Operations

Purpose:

- operate;
- review;
- decide;
- clear backlog;
- resolve exceptions.

Primary top-level homes:

- Operations;
- Trust / Risk / Compliance;
- People & Access for governed access/account administration;
- contextual operational workspaces reached from BU or intelligence drill-down.

### 5.3 Platform & Security

Purpose:

- administer the technical platform;
- inspect runtime health;
- govern feature rollout;
- administer integrations/providers;
- inspect AI/model operations;
- execute security controls.

Primary top-level home:

- Platform.

### 5.4 Plane indicator

Every page header must include a persistent plane label:

- `Corporate Intelligence`
- `Business Operations`
- `Platform & Security`

If a page offers a cross-plane jump, the transition must be explicit.

Example:

`Marketplace demand intelligence → Open moderation queue`

The destination header changes from Corporate Intelligence to Business Operations.

The UI must never make a queue action look like an extension of an executive chart.

---

## 6. Canonical top-level IA

The canonical top-level information architecture remains, in this order:

1. **Corporate Overview**
2. **Business Units**
3. **Finance**
4. **Customers & Growth**
5. **Operations**
6. **Trust / Risk / Compliance**
7. **Data & Intelligence**
8. **People & Access**
9. **Reports**
10. **Platform**

### 6.1 Primary destination semantics

| Top-level destination | Primary plane | Purpose |
| --- | --- | --- |
| Corporate Overview | Corporate Intelligence | Cross-company state, change and attention |
| Business Units | Corporate Intelligence | Compare and inspect management units |
| Finance | Corporate Intelligence | Corporate Finance & Accounting state; future P&L/treasury; finance exceptions |
| Customers & Growth | Corporate Intelligence | Demand, acquisition association, linked journeys, geography and cohorts where governed |
| Operations | Business Operations | Queues, throughput, backlog, cycle-time and domain work |
| Trust / Risk / Compliance | Business Operations | Aggregate risk posture plus restricted review queues |
| Data & Intelligence | Corporate Intelligence | Metric registry, provenance, quality, lineage, navigation/commercial intelligence |
| People & Access | Business Operations | Accounts, membership, permissions, scope, delegation, sessions, access reviews |
| Reports | Corporate Intelligence | Management cadence, governed report lifecycle and publication |
| Platform | Platform & Security | Feature, provider, AI/model, technical communications, runtime and security administration |

### 6.2 Contextual secondary navigation

Within each top-level area, local navigation may offer:

- Overview;
- Trends;
- Segments;
- Exceptions;
- Queue / Operate;
- Reports;
- Audit / Metadata.

The exact set depends on the domain and permission set.

---

## 7. Global Corporate Admin shell

### 7.1 Desktop shell

Recommended composition:

`┌──────────────────────────────────────────────────────────────────────────────┐
│ CarUp Corporate Admin | Plane | Scope | Period | Freshness | Attention | Me │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ 1 Overview    │ Breadcrumb / plane / page title / page-level actions        │
│ 2 BUs         │ Scope chips / comparison / source state                    │
│ 3 Finance     ├──────────────────────────────────────────────────────────────┤
│ 4 Growth      │                                                              │
│ 5 Operations  │                     Page composition                         │
│ 6 Trust/Risk  │                                                              │
│ 7 Data/Intel  │                                                              │
│ 8 People      │                                                              │
│ 9 Reports     │                                                              │
│10 Platform    │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Optional metadata / provenance drawer                                       │
└──────────────────────────────────────────────────────────────────────────────┘`

### 7.2 Primary navigation

Desktop:

- persistent left rail;
- ten canonical destinations in canonical order;
- current destination strongly highlighted;
- each item includes a subtle plane marker;
- destinations with no usable permission are hidden unless policy requires a disabled explanatory state;
- direct route remains server-authorized.

### 7.3 Page title hierarchy

Header sequence:

1. plane;
2. breadcrumb;
3. page title;
4. management question / concise subtitle;
5. top controls;
6. optional action button appropriate to plane.

Example:

`Corporate Intelligence / Business Units / Marketplace & Vehicle Commerce`

### 7.4 Scope selector

The global scope selector chooses only among scopes already authorized by CA-RBAC.

Potential scopes:

- Corporate;
- BU;
- corporate function;
- department;
- legal entity when proven;
- region/geography where the current metric supports it.

It may narrow authority but never widen it.

Changing scope must not silently change:

- metric definition;
- inclusion rules;
- data classification;
- reporting period.

### 7.5 Reporting period selector

Global period should support only periods the current page metrics can consume.

Recommended initial options:

- Today / current day where meaningful;
- 7 days;
- 30 days;
- 90 days;
- calendar periods only after governed reporting semantics exist.

If a page contains mixed source periods, the page must disclose that and disable invalid global period changes.

### 7.6 Comparison period

Show only when:

- metric version is comparable;
- population and scope are compatible;
- period lengths are comparable;
- source completeness is acceptable.

No default percentage delta where comparison is invalid.

### 7.7 Freshness indicator

Global header can show:

- `All current`;
- `1 source degraded`;
- `3 metrics stale`;
- `Source unavailable`.

This indicator opens a source-quality drawer rather than pretending freshness is a business KPI.

### 7.8 Attention center

Global attention entry opens an authorized queue of:

- critical source degradation;
- overdue operational queues;
- report approvals due;
- governed threshold breaches;
- access reviews due;
- security/platform incidents for authorized principals.

No AI-generated severity without an accepted rule.

### 7.9 Account/profile placement

Top-right account menu shows:

- signed-in account;
- current internal membership/scope;
- active delegation if any;
- external tenant context separately;
- session/security controls when permitted.

It must not show a job title as the permission source.

### 7.10 Global search / command palette

A command palette is justified for a dense management product.

It may search:

- top-level destinations;
- permitted BUs/functions;
- report names;
- permitted queues;
- permitted records by safe identifiers.

It must respect:

- RBAC;
- data classification;
- scope;
- existence-hiding rules.

No unauthorized record names should leak through autocomplete.

---

## 8. Scope and filter architecture

### 8.1 Global filters

Eligible global dimensions:

- reporting period;
- comparison period;
- BU;
- corporate function;
- geography where authoritative;
- legal entity only when proven;
- currency where the metric supports it.

### 8.2 Page-local filters

Examples:

- Marketplace: make/category, listing state, inquiry type;
- Operations: queue state, severity, owner/team;
- Trust: review state, evidence class, risk severity;
- Growth: source association, filter dimension, platform;
- Platform: provider, environment, feature, model.

### 8.3 Filter validity

A filter may appear only when all visible metrics on the filtered canvas support that dimension, or the page must clearly mark which visuals are unaffected.

### 8.4 Filter chip semantics

Applied filters display as explicit chips.

Example:

`BU: Diaspora Trade`  
`Geography: Destination = Zimbabwe`  
`Period: trailing 30 days`

The geography chip must state which geography type is being used.

### 8.5 Scope persistence

Drill-down preserves:

- organisational scope;
- period;
- geography;
- source filters;
- metric version;
- truth/provenance state.

A user may deliberately reset scope, but the UI must not reset silently.

---

## 9. Metric visual-state grammar

Every metric slot contains:

- label;
- value or state;
- unit;
- period;
- optional comparison;
- truth-state badge;
- freshness/provenance marker;
- metadata affordance.

### 9.1 GOVERNED_ACTUAL

Presentation:

- normal primary numeric/text value;
- badge: `Actual`;
- source and as-of available in metadata;
- K2B consumption state confirmed for operational sources.

### 9.2 GOVERNED_DERIVED

Presentation:

- normal value;
- badge: `Derived`;
- calculation version discoverable;
- formula explanation available.

### 9.3 GOVERNED_RATE_OR_RATIO

Presentation:

- value with denominator disclosure;
- badge: `Rate` or `Ratio`;
- denominator floor and cohort definition discoverable.

### 9.4 ADVISORY

Presentation:

- visually separate advisory panel;
- badge/icon: `Advisory`;
- never placed in the same visual hierarchy as an actual KPI without clear distinction;
- recommendation text must not overwrite a governed status.

### 9.5 TECHNICAL_OPERATIONAL

Presentation:

- Platform & Security styling;
- badge: `Technical`;
- must not appear as corporate performance unless separately promoted by CA-METRIC.

### 9.6 PENDING_K2B_CONSUMPTION

K2B itself is accepted/frozen.

This state means the exact metric/source path has not yet proven consumption of K2B operational provenance.

Presentation:

- no Corporate Actual value;
- blocked slot with text: `Operational provenance integration not certified for this source`;
- optionally show diagnostics only to Data/Intelligence-authorized users;
- never count UNKNOWN as operational.

### 9.7 PENDING_CA_FIN

Presentation:

- future finance slot remains visible where strategically important;
- value area: `Not available — accounting authority not yet established`;
- no zero;
- no placeholder currency.

### 9.8 INSUFFICIENT_DATA

Presentation:

- neutral state;
- display `Insufficient data`;
- optional denominator sample disclosure;
- no 0%.

### 9.9 UNAVAILABLE_NO_SOURCE

Presentation:

- blocked panel;
- `Unavailable — no authoritative source`;
- source requirement link if useful.

### 9.10 UNAVAILABLE_NOT_SEPARABLE

Presentation:

- `Not separable from current source`;
- explain the inseparable grain.

Example:

`Human-readable search terms are not available; current source retains hashed query signatures.`

### 9.11 DUPLICATED_OR_CONFLICTING

Presentation:

- no headline value;
- `Definition conflict — reconciliation required`;
- link to Data & Intelligence lineage/registry.

### 9.12 UNKNOWN_AUTHORITY

Presentation:

- no value;
- `Authority unknown — blocked`;
- never rendered as advisory estimate.

### 9.13 DEGRADED

Presentation:

- last known value may be shown only if policy permits;
- label `Degraded`;
- show last computed time;
- explain incomplete/truncated source.

Navigation 50,000-row cap is a candidate degraded trigger where completeness cannot be proven.

### 9.14 FORBIDDEN

Presentation:

- never masquerade as unavailable;
- page-level or slot-level access message;
- avoid revealing sensitive metric existence where policy requires non-enumeration;
- if safe, say `You do not have access to this data.`

### 9.15 MEASURED ZERO

Presentation:

- numeric `0`;
- normal metric styling;
- Actual/Derived badge remains;
- metadata confirms successful complete read.

### 9.16 NO DATA

Presentation:

- `No data for this period`;
- distinct from zero and unavailable.

---

## 10. Visualization/component grammar

| Component | Valid use | Misleading/invalid use | Required labels / behavior |
| --- | --- | --- | --- |
| Headline metric | One high-confidence management fact | Filling empty space with weak context metrics | Unit, period, state, freshness |
| Sparkline | Compact directional history with comparable periods | Non-comparable versions/irregular gaps without disclosure | Axis/time range in tooltip/summary |
| Trend line | Time series with consistent grain | Mixing different definitions or currencies | Grain, timezone, missing-data semantics |
| Comparison bar | Compare BUs/segments on same semantic metric | Comparing incompatible BU concepts | Shared unit/metric definition |
| Stacked bar | Parts of a true whole under stable categories | Partial coverage normalized to 100% | Coverage and denominator |
| Distribution | Spread/percentiles of meaningful continuous/ordinal measure | One or tiny sample | Sample size and unit |
| Funnel | Linked stages with governed cohort | Independent stage totals | Link key, cohort, window, denominator |
| Cohort grid | Same defined subject across intervals | Anonymous sessions treated as customers | Cohort grain, entry event, interval |
| Heatmap | Two governed dimensions with complete matrix | Decorative density without stable denominator | Dimension labels, scale |
| Map | Authoritative geography type | Inferring customer geography from listing/shipment/IP | Geography definition, unknown bucket |
| Matrix | Compare units versus dimensions | Synthetic scoring without rule | Measure and scale |
| Ranked list | Complete/comparable population with ranking metric | Truncated Navigation data or tiny sample | Rank measure, window, sample/coverage |
| Exception queue | Actionable governed states | AI-guessed urgency | Rule/severity source, owner |
| Timeline | Ordered case/process/audit events | Combining unrelated entity timelines | Event source, timestamps |
| Table | Inspection, drill-down, queues | Primary executive story | Column semantics, sorting, accessible headers |
| Status badge | Explicit lifecycle/truth state | Red/green business judgment without baseline | Text + icon/color |
| Provenance indicator | K2B/freshness/source status | Hidden footnote only | Excluded/unknown counts where safe |
| Unavailable panel | Strategically important blocked source | Replacing unavailable with zero | Reason and dependency |

### 10.1 Chart textual summary

Every chart must expose a concise text summary for screen readers and management export.

Example pattern:

`Marketplace searches increased over the selected comparison period; zero-result share is available separately. No sales conclusion is implied.`

Do not infer conclusions unsupported by the data.

---

## 11. Corporate Overview architecture

### 11.1 Objective

Provide one page that answers:

- What is happening across CarUp?
- What changed?
- Which BU/function needs attention?
- Where is demand growing?
- Where are operations deteriorating?
- Which critical metrics are unavailable?
- What requires management action?

### 11.2 Composition hierarchy

**A. Executive state band**

Maximum 4–6 high-confidence slots.

Candidate categories:

- operational account activity only if K2B consumption certified;
- published Marketplace supply;
- authoritative inquiries/demand;
- cross-BU operational throughput;
- risk/compliance backlog;
- report/attention state.

Do not use blocked customer/revenue metrics.

**B. BU performance landscape**

A large comparison visual with one row per provisional BU:

- Marketplace & Vehicle Commerce;
- Garage, Service & Parts;
- Finance, Payments & Insurance;
- Diaspora Trade & Logistics.

Each row contains only comparable or clearly domain-labelled facts.

**C. Demand & growth picture**

Use:

- search demand;
- zero-result demand;
- inquiries;
- Trade requests;
- service requests;
- referral/campaign associations;
- navigation discoverability as a separate panel.

**D. Finance position**

Current authority:

- strategic blocked slots for revenue, gross profit, cash, AR/AP;
- clearly labelled product/operational finance facts in a secondary “Product money workflow” panel if useful;
- no conversion of deposit/quote/sandbox into finance actuals.

**E. Operations state**

Large backlog/throughput/cycle-time panel.

**F. Trust / Risk / Compliance**

Aggregate queue/exception trends; restricted record details remain behind authorization.

**G. Geography**

Only present when a specific authoritative geography type is selected.

Examples:

- Trade destination corridors;
- dealer operating countries;
- customer residence only after policy.

**H. Data quality / provenance**

Compact persistent band:

- operational K2B source coverage;
- excluded non-operational count;
- unknown/not-counted count where relevant;
- stale/degraded sources;
- metric definition conflicts.

**I. Management actions**

- reports due;
- access reviews due;
- unresolved high-severity queues;
- data source failures.

### 11.3 What Corporate Overview must not become

- a list of links to current Admin pages;
- a wall of equal cards;
- a Platform health console;
- a customer count without customer authority;
- a finance page with fake revenue;
- a mixed operational mutation workspace.

---

## 12. Business Units UX

### 12.1 Objective

Let management compare accepted provisional BUs and drill into one BU without asserting legal entity status.

### 12.2 Business Units overview

Primary visual:

- four-row scorecard matrix;
- columns are metric families, not necessarily identical KPIs.

Recommended rows:

- Marketplace & Vehicle Commerce;
- Garage, Service & Parts;
- Finance, Payments & Insurance;
- Diaspora Trade & Logistics.

Recommended columns:

- participants/customers where governed;
- demand;
- supply/capacity;
- throughput;
- linked conversion;
- finance state;
- risk;
- service quality;
- backlog;
- cycle time;
- geography;
- exceptions.

If a metric family has no equivalent in a BU, render `Not applicable` rather than forcing a value.

### 12.3 Cross-BU comparison

Allowed:

- comparable count/rate using same metric definition;
- standardized backlog/cycle-time where definitions are deliberately harmonized;
- growth rates for comparable metric families.

Not allowed:

- one synthetic score without Owner weighting;
- summing inquiries + work orders + Trade orders as “transactions”;
- comparing quote acceptance to Marketplace inquiry conversion as if identical.

### 12.4 BU Detail

Common frame:

- BU headline;
- key management questions;
- demand;
- supply/capacity;
- throughput/funnel;
- operational state;
- risk;
- finance/product money facts;
- geography;
- exceptions;
- report history.

Each BU customizes the metric content.

---

## 13. Finance UX

### 13.1 Hard boundary

The Finance top-level destination represents **Corporate Finance & Accounting**.

Customer-facing Finance/Payments product intelligence belongs to:

- BU Financial Services;
- Customers & Growth demand views;
- Operations for product workflows.

### 13.2 Current finance page composition

Because accepted CA-FIN proves no Corporate accounting SOR:

**A. Finance authority state**

Prominent information panel:

`Corporate accounting system of record not yet established.`

**B. Future strategic slots**

Visible but blocked:

- GMV;
- recognized revenue;
- revenue by BU;
- direct cost;
- gross profit;
- gross margin;
- operating expense;
- operating profit;
- net profit;
- cash;
- receivables;
- payables;
- take rate;
- contribution margin.

Each slot uses PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE, not zero.

**C. Product money workflow panel**

May show correctly labelled operational facts:

- Marketplace deposit workflow states;
- finance applications;
- Trade quote/requested budget;
- escrow session/provider mode;
- subscription test/sandbox state;
- referral reward obligations.

This panel must be titled as **Product / operational money facts**, not Corporate Finance results.

**D. Future finance exception area**

Reserved for:

- reconciliation mismatches;
- period close exceptions;
- unreconciled settlements;
- AR/AP aging;
- bank reconciliation.

Do not fabricate until source exists.

### 13.3 Currency

Every amount carries its source currency.

No multi-currency total until CA-FIN approves accounting FX.

---

## 14. Customers & Growth UX

### 14.1 Objective

Provide strategic demand and journey intelligence without inventing a universal customer.

### 14.2 Page families

**A. Accounts & identity**

Source-accurate labels:

- Registered accounts;
- Operational accounts;
- Current verified identity subjects;
- no “Customers” headline until Owner policy.

**B. Marketplace demand**

- searches;
- zero-result search rate;
- filter use;
- listing impressions;
- listing opens;
- saves;
- inquiries.

**C. Journey performance**

Only linked funnels:

- impression→detail;
- detail→save;
- detail→inquiry;
- inquiry→transaction;
- transaction→reservation;

where coverage/linkage is certified.

Unlinked current activity ratios must be labelled as ratios, not conversions.

**D. Seller journey**

- draft/listing created;
- readiness;
- published;
- inquiry received;
- transaction/reservation progression.

**E. Trade demand**

- buyer requests;
- RFQs;
- quotes;
- accepted quotes;
- corridor activity.

**F. Service-network demand**

- service requests;
- accepted cases;
- completed cases;
- identified/repeat service customers where valid.

**G. Acquisition associations**

- referral-associated inquiries;
- campaign-associated inquiries;
- recorded source coverage.

Do not use “acquired customers” until attribution policy is accepted.

**H. Product discoverability**

Navigation Intelligence:

- route renders;
- nav impressions;
- nav selections;
- feature discoverability;
- blocks/errors.

Keep this panel visually and semantically separate from commercial journey.

**I. Cohorts**

Available only for governed subject/grain definitions.

Registration cohorts are account cohorts, not customer cohorts.

**J. Retention/churn**

Blocked until definitions exist.

### 14.3 Search ranking limitation

Human-readable top free-text searches remain unavailable because current source retains hashes.

Allowed UX:

- top structured filters;
- hashed signature diagnostics for authorized analysts;
- “Human-readable search terms unavailable from current source” blocked state.

---

## 15. Operations UX

### 15.1 Objective

Operate the company’s business workflows.

Primary patterns:

- queue;
- backlog;
- SLA/cycle time;
- throughput;
- assignment;
- exception;
- controlled action;
- audit.

### 15.2 Operations overview

Use a management queue matrix:

| Domain | Waiting | Aging | Throughput | Exceptions | Owner |
| --- | --- | --- | --- | --- | --- |
| Marketplace moderation | governed | governed | governed if available | publication/risk | Marketplace Ops |
| Communications | governed | SLA | replies/resolutions | failed/dead-letter business-facing | Customer Ops |
| Garage onboarding | governed | age | decisions | activation issues | Service Network |
| Dealer compliance | governed | age | decisions | suspended/restricted | Compliance |
| Trade/logistics | governed | cycle | stages | blocked milestones | Trade Ops |

No fake “overall operations health” score.

### 15.3 Operational drill-down

From an Operations aggregate:

`Operations → queue → item → controlled decision → audit receipt`

Every action uses existing owning domain service.

Corporate Admin never creates generic mutation authority.

---

## 16. Trust / Risk / Compliance UX

### 16.1 Two-layer design

**Executive aggregate layer**

- verification workload;
- evidence review backlog;
- fraud/open cases;
- governance review;
- dealer compliance;
- garage review;
- unresolved provenance/source exceptions;
- trends/aging.

**Restricted operator layer**

- identity case;
- evidence preview;
- fraud case;
- vehicle review;
- person/compliance review;
- trust/governance decision;
- dealer/garage decision.

### 16.2 Data-classification boundary

Aggregate executive permission does not imply access to:

- identity documents;
- guest contact details;
- individual applicant records;
- raw fraud evidence;
- private dealer/garage documents.

### 16.3 Trust vocabulary

Do not collapse:

- identity verified;
- evidence verified;
- dealer compliance;
- seller authority;
- PartSentry verification;
- fraud status;
- Trust score;
- governance status

into one “verified/trusted” percentage.

---

## 17. Data & Intelligence UX

### 17.1 Objective

Make metric truth, provenance, lineage and strategic behavioral intelligence inspectable.

### 17.2 Sections

**Metric Registry**

- metric identity;
- definition;
- owner/steward;
- source;
- version;
- classification;
- certification state.

**Source & Provenance**

- K2B operational counts;
- excluded non-operational records;
- UNKNOWN/needs-review counts;
- source-path consumption status;
- freshness.

**Navigation Intelligence**

- route renders;
- item impressions;
- selections;
- blocks/errors;
- completeness bound.

**Commercial Behaviour**

- searches;
- filters;
- listing opens;
- saves;
- inquiries;
- linked journeys.

**Data Quality**

- freshness breaches;
- incomplete dimensions;
- definition conflicts;
- reconciliation issues.

**Advisory / AI Intelligence**

- model-generated summaries and suggestions as advisory;
- never actual metrics.

### 17.3 50,000-row Navigation rule

When the current Navigation aggregation reaches the bounded read and completeness is not proven:

- page state: DEGRADED;
- rankings disabled or clearly non-certifiable;
- exact warning visible;
- no executive promotion.

---

## 18. People & Access UX

### 18.1 Objective

Govern who can act inside Corporate Admin without using job title or `users.role` as authority.

### 18.2 Required conceptual separation

The person/account detail must visibly separate:

**Account**
- base account;
- account state;
- authentication/session facts.

**Corporate membership**
- internal organisational placement;
- home unit;
- matrix assignments;
- membership lifecycle.

**Permission assignments**
- permission set/capability;
- exact organisation/data/geography scope;
- assurance;
- time window.

**Delegation**
- source grant;
- delegator;
- delegate;
- expiry;
- scope.

**External tenant membership**
- dealer/garage/institution relationships;
- separate from internal membership.

**Sessions**
- valid/revoked/expired sessions;
- session actions where authorized.

### 18.3 Directory

Future People & Access directory should allow:

- account search;
- internal membership filter;
- organisational scope filter;
- access-review status;
- active delegation indicator;
- session-security state.

It must not use role badges as a shortcut for permissions.

### 18.4 Access detail

Recommended tabs:

- Account;
- Membership;
- Permissions;
- Delegations;
- External memberships;
- Sessions;
- Audit.

### 18.5 Lifecycle actions

Separate actions:

- disable account;
- suspend corporate membership;
- revoke permission;
- revoke delegation;
- revoke session;
- revoke external tenant membership.

The UI must explain impact before action.

---

## 19. Reports UX

### 19.1 Report families

First-class report templates:

1. Daily Operations
2. Weekly BU Review
3. Monthly Executive Review
4. Quarterly Board / Strategy
5. Compliance / Risk
6. Ad-hoc governed report

### 19.2 Report lifecycle

`Draft → Generated → In Review → Approved → Published`

Optional terminal/exception states:

- Rejected;
- Superseded;
- Withdrawn;
- Generation failed.

Generation is not publication.

Reviewer/approver/publisher may be different people.

### 19.3 Report metadata

Every report shows:

- period;
- scope;
- metric IDs/versions;
- source snapshot/as-of;
- truth/quality states;
- provenance status;
- units/currencies;
- preparer;
- reviewer;
- approver;
- publisher;
- generated timestamp;
- publish timestamp;
- export classification.

### 19.4 Boardroom mode

Future boardroom presentation may offer:

- one-page executive narrative;
- chart-forward slides/print;
- footnoted unavailable/source caveats;
- appendix with definitions.

No invented values to improve presentation density.

---

## 20. Platform UX

### 20.1 Platform sections

**Platform Overview**
- technical state;
- incidents;
- degraded integrations;
- source freshness for technical systems.

**Feature Governance**
- registry;
- rollout overrides;
- audit;
- immutable policy versus runtime narrowing.

**Integrations & Providers**
- provider connection state;
- live/sandbox;
- reconciliation/health where governed.

**AI / Model Operations**
- model/provider configured state;
- runtime health;
- model operations;
- future evaluation metrics only when authoritative.

**Communications Delivery**
- provider telemetry;
- dead letters;
- delivery recovery;
- worker health;
- SLA infrastructure configuration.

**Security**
- session/security controls;
- break-glass;
- privileged events;
- security audit.

**Data Pipeline**
- rollup/job state;
- source freshness;
- pipeline diagnostics.

### 20.2 Platform separation

Do not place:

- Corporate revenue;
- customer growth;
- BU scorecards;
- finance applications;
- compliance business decisions

inside Platform merely because the same administrator can access them.

---

## 21. Executive attention system

### 21.1 Attention item contract

Each attention item must contain:

- title;
- category;
- source;
- scope;
- reason;
- severity/rule source;
- age;
- owner;
- permitted action/drill-down;
- truth state.

### 21.2 Eligible attention sources

- operational backlog above governed threshold;
- risk/compliance queue aging;
- source freshness breach;
- K2B UNKNOWN population requiring review;
- metric definition conflict;
- report approval due;
- access review due;
- security incident;
- integration/provider outage;
- reconciliation failure.

### 21.3 Ineligible attention generation

Do not generate “urgent”, “high risk” or “deteriorating” based solely on:

- AI narrative;
- arbitrary percentage delta;
- stylistic red threshold;
- ungoverned target;
- incomplete source.

---

## 22. Role/capability-aware experience model

Titles below are archetype labels only. Actual visibility derives from CA-RBAC grants/scopes.

| Archetype | Default landing | Typical visible sections | Drill-down posture | Export posture |
| --- | --- | --- | --- | --- |
| Executive aggregate viewer | Corporate Overview | Overview, BUs, Finance summary states, Growth aggregates, Reports | Aggregate first; no PII/evidence/secrets by default | Governed report/export only |
| Operations leader | Operations | BUs, Operations, selected Trust queues, Reports | Queue/case within assigned scope | Operational export if separately granted |
| Finance leader | Finance | Overview, Finance, BUs, Reports | Restricted finance detail only if explicitly granted | Separate restricted export permission |
| BU leader | BU Detail | Overview, BUs, Growth, Operations, Reports within BU | BU-bound records | BU exports only |
| Growth/customer leader | Customers & Growth | Growth, Data & Intelligence, Reports | Aggregate behaviour; customer PII separate | Aggregate export by default |
| Trust/compliance leader | Trust / Risk / Compliance | Trust, Operations, Reports | Restricted cases where granted | Sensitive export tightly gated |
| People/access administrator | People & Access | People & Access, Reports/audit | Membership/access detail; no automatic domain data | Access/audit export if granted |
| Platform administrator | Platform | Platform, Data & Intelligence technical views | Technical config; no Finance/People detail automatically | Technical export |
| Security administrator | Platform → Security | Platform Security, People session/security views | Privileged security scope | Security audit export |
| Data/Intelligence administrator | Data & Intelligence | Data/Intel, Reports, aggregate domains | Metric/source/lineage access; raw PII separate | Governed data export |
| Read-only auditor | Reports / Audit | Reports plus explicit audit domains | Read-only; minimized sensitive raw data | Time-bound approved export only |

### 22.1 Forbidden behavior

If a section is not permitted:

- direct URL is denied by server;
- nav item is absent or appropriately disabled;
- no hidden “admin bypass” assumption;
- no title-based override.

---

## 23. Drill-down architecture

Canonical drill path:

`Corporate Overview
→ domain / BU
→ metric or exception
→ governed population
→ record/detail where permitted`

### 23.1 Example: Marketplace demand

`Corporate Overview
→ Marketplace & Vehicle Commerce
→ Inquiries
→ qualified operational inquiry population
→ inquiry detail if permitted`

### 23.2 Example: risk

`Corporate Overview
→ Trust / Risk / Compliance
→ Identity review backlog
→ queue
→ case
→ evidence preview only with restricted permission + required assurance`

### 23.3 Drill-stop state

When the viewer may see aggregate but not records:

- preserve chart;
- show `Record-level access restricted`;
- do not show names/IDs via tooltip;
- offer metadata instead of detail link.

### 23.4 Context preservation

Breadcrumb carries:

- scope;
- period;
- filters;
- metric identity/version;
- comparison;
- provenance state.

---

## 24. Responsive behavior

### 24.1 Large desktop

Target:

- persistent left rail;
- full scope bar;
- 12-column content grid;
- side-by-side primary visuals;
- fixed metadata/attention affordance.

### 24.2 Laptop

- left rail remains but can compact;
- primary chart width retained;
- secondary panels stack;
- comparison matrix horizontally scrolls only when necessary.

### 24.3 Tablet

- sidebar becomes drawer;
- global controls become two-row header;
- large charts stack;
- BU comparison turns into vertically stacked scorecard rows;
- detail side rails become accordions/drawers;
- tables prioritize first 3–5 critical columns with column selector.

### 24.4 Narrow browser

Corporate Admin remains usable but not redesigned as a mobile consumer app.

Rules:

- single-column narrative;
- charts collapse to compact summary + “View chart” disclosure;
- filters move into drawer;
- tables become horizontal scroll/row detail;
- queue actions remain explicit;
- no dense three-column analyst layout.

### 24.5 Native separation

Narrow web does not replace the separate CarUp native app/product.

---

## 25. Accessibility and readability

Required:

- full keyboard navigation;
- visible focus;
- semantic headings;
- screen-reader chart summaries;
- accessible tables with headers/captions;
- color-independent state icons/text;
- contrast-compliant text;
- scalable typography;
- meaningful button labels;
- no icon-only critical state;
- modal/drawer focus management;
- live regions for asynchronous queue/action state where appropriate.

Charts must have:

- accessible title;
- textual summary;
- unit;
- period;
- source/truth state;
- equivalent data table when appropriate.

---

## 26. Current Admin migration map

The following map is grounded in the accepted current implementation at `7b34dec1bc9f05b72b6abf0104db65980f280a0b`.

### 26.1 Command Centre

| Current surface | Current route | Future disposition | Future home | Rationale |
| --- | --- | --- | --- | --- |
| Ecosystem Command Centre | `/admin` | **CORPORATE-INTELLIGENCE VIEW NEEDED / REBUILD-AS-VIEW** | Corporate Overview | Current page is a source composition plus quick links; future overview needs governed hierarchy, BU comparison, unavailable finance, attention and provenance rather than mixed Admin shortcuts. |

Retire the current quick-link-first command-center composition as Corporate Overview authority. Reuse its governed source services where CA-METRIC permits.

### 26.2 Users / People

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| User Management directory | `/admin/users` | **SPLIT / REHOME** | People & Access |
| New user registration action | `/admin/users` | **KEEP / WRAP only as Account creation if separately authorized** | People & Access → Accounts |
| Current role selector presented as permissions | `/admin/users` | **RETIRE as future access model** | Replaced by Corporate membership + permission assignments |
| Open People & Compliance Review | `/admin/people/:userId/review` | **SPLIT / KEEP-WRAP** | People & Access account context + Trust/Risk restricted review workspace |

Current account suspension correctly shows unavailable rather than silently writing an invalid role/state. Future suspension must use the CA-RBAC lifecycle model.

### 26.3 Communications

| Current section | Disposition | Future home |
| --- | --- | --- |
| Inbox, assignment, handoff, replies | **OPERATIONS-ONLY / REHOME** | Operations → Customer Communications |
| SLA worklist / queue aging | **OPERATIONS-ONLY / REHOME** | Operations |
| Customer-thread business metrics | **SPLIT / WRAP** | Customers & Growth / Operations |
| Dead-letter recovery | **PLATFORM-ONLY** | Platform → Communications Delivery |
| Worker health | **PLATFORM-ONLY** | Platform |
| Provider telemetry / smoke tests | **PLATFORM-ONLY** | Platform → Integrations/Providers |
| Technical settings / provider policies | **PLATFORM-ONLY** | Platform |
| Communication audit | **SPLIT** | Operations audit or Platform audit depending event type |

The current `/admin/communications` page is the clearest example of a required plane split.

### 26.4 Feature Governance and Navigation Intelligence

| Current concern | Disposition | Future home |
| --- | --- | --- |
| Feature registry / rollout overrides | **PLATFORM-ONLY / KEEP-WRAP** | Platform → Feature Governance |
| Feature governance audit | **PLATFORM-ONLY** | Platform |
| Navigation route renders / item impressions / selections | **REHOME / CORPORATE-INTELLIGENCE VIEW NEEDED** | Data & Intelligence; selected growth summaries in Customers & Growth |
| Navigation blocked/errors | **SPLIT** | Data & Intelligence diagnostics; Platform if technical root cause |
| Current mixed `/admin/features` page | **SPLIT** | Platform + Data & Intelligence |

### 26.5 Marketplace

| Current concern | Route | Disposition | Future home |
| --- | --- | --- | --- |
| Listing moderation queue/actions | `/admin/moderation` | **OPERATIONS-ONLY / KEEP-WRAP** | Operations → Marketplace |
| Inquiry triage/status | `/admin/moderation?tab=inquiries` | **OPERATIONS-ONLY** | Operations → Marketplace / Customer Communications as appropriate |
| Current stat cards | same | **SPLIT / REPLACE-AS-INTELLIGENCE** | Customers & Growth / BU Marketplace |
| K2B provenance notice | same | **KEEP / WRAP** | Shared truth/provenance grammar |
| AI moderation advisory | same | **KEEP-WRAP as ADVISORY** | Operations item detail |
| Vehicle Operations | `/admin/vehicles/:vin/review` | **OPERATIONS-ONLY / KEEP-WRAP** | Trust/Risk/Compliance → Vehicle review, linked from Operations |
| Marketplace management intelligence | current mixed/vertical services | **CORPORATE-INTELLIGENCE VIEW NEEDED** | BU Marketplace + Customers & Growth |

### 26.6 Trust / Risk / Compliance

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| Evidence Review | `/admin/evidence` | **REHOME / OPERATIONS-ONLY** | Trust / Risk / Compliance |
| Identity Verification Cases | `/admin/verification` | **REHOME / OPERATIONS-ONLY** | Trust / Risk / Compliance |
| Trust Review | `/admin/trust-review` | **REHOME / OPERATIONS-ONLY** | Trust / Risk / Compliance |
| Fraud Queue | `/admin/fraud-queue` | **REHOME / OPERATIONS-ONLY** | Trust / Risk / Compliance |
| Governance Review | `/admin/governance-review` | **REHOME / OPERATIONS-ONLY** | Trust / Risk / Compliance |
| Person compliance workspace | `/admin/people/:userId/review` | **SPLIT / KEEP-WRAP** | Trust/Risk restricted workspace + People account context |
| Executive risk aggregates | not a canonical current page | **CORPORATE-INTELLIGENCE VIEW NEEDED** | Trust / Risk / Compliance Overview |

### 26.7 Dealer and Garage

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| Dealer Compliance | `/admin/dealer-compliance` | **OPERATIONS-ONLY / REHOME** | Trust/Risk/Compliance + Marketplace BU context |
| Garage Applications | `/admin/garage-applications` | **OPERATIONS-ONLY / REHOME** | Operations → Service Network onboarding |
| Garage evidence/private docs | current garage review | **KEEP-WRAP restricted** | Trust/Operations drill-down |
| Dealer/Garage management intelligence | no canonical unified corporate view | **CORPORATE-INTELLIGENCE VIEW NEEDED** | BU Marketplace / BU Service Network |

### 26.8 Referral / Growth

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| Referral Campaigns | `/admin/referrals` | **SPLIT** | Customers & Growth intelligence + Business Operations campaign management |
| Codes & Coupons | `/admin/referrals/codes` | **OPERATIONS-ONLY / REHOME** | Growth operations |
| Local Leads | `/admin/referrals/local-leads` | **OPERATIONS-ONLY** | Operations / Growth |
| Import Routes | `/admin/referrals/import-routes` | **REHOME** | Diaspora Trade BU / Operations |
| Referral Marketing AI assets | `/admin/referrals/marketing` | **OPERATIONS-ONLY; ADVISORY clearly labelled** | Growth operations |
| Referral Trust | `/admin/referrals/trust` | **REHOME** | Trust / Risk / Compliance |
| Referral Intelligence projection | embedded in campaign page | **CORPORATE-INTELLIGENCE VIEW NEEDED / WRAP** | Customers & Growth |

### 26.9 Diaspora Admin

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| Diaspora Compliance | `/admin/diaspora/compliance` | **OPERATIONS-ONLY / REHOME** | Operations / Trust with BU Diaspora scope |
| Workbook Operator Console | `/admin/diaspora/workbooks` | **OPERATIONS-ONLY** | Diaspora Trade Operations |
| Workbook Dry Run | `/admin/diaspora/workbooks/new` | **OPERATIONS-ONLY** | Diaspora Trade Operations |
| Trade management intelligence | vertical services | **CORPORATE-INTELLIGENCE VIEW NEEDED** | BU Diaspora Trade & Logistics |

### 26.10 AI Monitoring

| Current surface | Route | Disposition | Future home |
| --- | --- | --- | --- |
| AI provider/model status | `/admin/ai` | **PLATFORM-ONLY / KEEP-WRAP** | Platform → AI / Model Operations |
| Future model quality/usage management intelligence | not currently authoritative corporate-wide | **CORPORATE-INTELLIGENCE VIEW NEEDED only when source exists** | Data & Intelligence |
| Demonstration confidence/accuracy values | removed/currently unavailable | **RETIRE** | Do not restore without authority |

### 26.11 Duplicate / superseded routes

- `/dashboard/admin/communications` alias: **MERGE/RETIRE alias** when migration permits; one canonical future route.
- any separate VerificationReview legacy surface not mounted as canonical current route: **MERGE/RETIRE** into the current Identity Verification Case Management authority.
- legacy static/mock KPI components superseded by governed projections: **RETIRE from Corporate semantics**.

---

## 27. Canonical page blueprints

### 27.1 Blueprint 1 — Corporate Overview

**Objective:** executive operating picture across CarUp.

**Primary question:** What changed, what needs attention and what is unavailable?

**Top controls:**
- Corporate scope;
- period;
- comparison;
- provenance/freshness.

**Hierarchy:**

`[Plane: Corporate Intelligence]  Corporate Overview
[Scope] [Period] [Compare] [Freshness]

┌──────────────── Executive state band ────────────────┐
│ Governed actual/derived slots only                   │
└──────────────────────────────────────────────────────┘

┌──────────────── BU landscape ────────────────────────┐
│ Marketplace | Service Network | Financial | Diaspora │
│ domain-appropriate trends + exceptions               │
└──────────────────────────────────────────────────────┘

┌──────────────────────┐ ┌─────────────────────────────┐
│ Demand / Growth      │ │ Operations / Backlog        │
│ governed trends      │ │ queues / cycle time         │
└──────────────────────┘ └─────────────────────────────┘

┌──────────────────────┐ ┌─────────────────────────────┐
│ Finance authority    │ │ Trust / Risk / Compliance   │
│ blocked/current      │ │ aggregate exceptions        │
└──────────────────────┘ └─────────────────────────────┘

[Data quality & provenance] [Management actions / reports due]`

**Metric slots:** no universal customers/revenue/profit until authority exists.

**Drill-downs:** BU, Growth, Operations, Trust, Reports, Data/Intel.

**Unavailable behavior:** blocked strategic slots remain visible with reason.

**Role constraints:** executive aggregate permissions; no automatic PII.

**Responsive:** BU landscape stacks by BU; state band becomes 2-column then 1-column.

---

### 27.2 Blueprint 2 — Business Units Overview

**Objective:** compare provisional management BUs.

**Primary question:** Which BU is changing and where?

**Top controls:** period, comparison, geography where compatible.

**Hierarchy:**

`Business Units
[Period] [Compare]

┌──────────────── BU comparison matrix ─────────────────────────┐
│ BU                     Demand Throughput Risk Cycle Finance    │
│ Marketplace             ...    ...        ...  ...   blocked  │
│ Service Network         ...    ...        ...  ...   blocked  │
│ Financial Services      ...    ...        ...  ...   blocked  │
│ Diaspora Trade          ...    ...        ...  ...   blocked  │
└────────────────────────────────────────────────────────────────┘

[Exceptions by BU]   [Comparable growth trends]   [Reports]`

**Charts:** comparison bars, matrix, trend lines.

**Invalid:** synthetic one-number BU score.

**Drill-down:** BU Detail.

**Unavailable:** Not applicable versus unavailable differentiated.

**Role constraints:** BU lead sees authorized BU; executives see multiple.

**Responsive:** matrix becomes BU cards with identical row labels only where comparable.

---

### 27.3 Blueprint 3 — BU Detail

**Objective:** management scorecard for one BU.

**Primary question:** What is driving this BU and what needs intervention?

**Top controls:** BU locked to context, period, geography.

**Hierarchy:**

`[BU name]
[Demand trend] [Supply/capacity] [Throughput]
[Linked journey / process progression]
[Backlog & cycle time]
[Risk/compliance]
[Product money facts / Corporate finance state]
[Geography]
[Exceptions]
[Recent BU reports]`

**Metric slots:** BU-specific; do not force uniformity.

**Drill-down:** Growth, Operations, Trust, Finance product facts, Reports.

**Responsive:** vertically stack sections; preserve most important trend first.

---

### 27.4 Blueprint 4 — Finance

**Objective:** truthful Corporate Finance authority state and future management accounting.

**Primary question:** What financial facts are authoritative now, and what is blocked?

**Top controls:** legal entity only when proven, period, currency when valid.

**Hierarchy:**

`Finance — Corporate Finance & Accounting

[Authority banner: accounting SOR state]

┌──────── Future strategic finance ────────────────────┐
│ Revenue    Gross Profit   Cash    AR/AP   Take Rate  │
│ unavailable / PENDING_CA_FIN states                 │
└──────────────────────────────────────────────────────┘

[Product / operational money facts — clearly separate]
[Future reconciliation exceptions]
[Future management accounting by BU/cost/profit centre]
[Finance report lifecycle]`

**Charts:** none for unavailable accounting values.

**Drill-down:** product operational facts only under correct label; future restricted ledger detail.

**Role constraints:** finance aggregates separate from line items/export.

**Responsive:** blocked slots become list; no empty currency cards.

---

### 27.5 Blueprint 5 — Customers & Growth

**Objective:** demand, association and linked journey intelligence without inventing customer semantics.

**Primary question:** Where is qualified demand forming and where do journeys progress or stop?

**Top controls:** period, BU, geography type, source association.

**Hierarchy:**

`Customers & Growth

[Accounts & identity — source-accurate labels]
[Marketplace demand: searches / filters / zero-result]
[Commercial journey: linked funnels only]
[Seller journey]
[Trade demand] [Service demand]
[Referral / campaign associations]
[Navigation discoverability — separate panel]
[Geography — governed type]
[Cohorts — only where defined]
[Blocked: customers / retention / churn / CAC / LTV / ROAS]`

**Charts:** trends, structured-filter rankings, linked funnel, process drop-off.

**Invalid:** route render→inquiry conversion without link key.

**Drill-down:** governed population then record if allowed.

**Role constraints:** no raw PII for executive aggregate viewer.

**Responsive:** discovery and commercial panels remain visually separate.

---

### 27.6 Blueprint 6 — Operations

**Objective:** manage business workflow health and queues.

**Primary question:** What is waiting, aging, blocked or failing?

**Top controls:** BU/domain, queue, owner/team, period.

**Hierarchy:**

`Operations
[Queue summary by domain]
[Backlog aging]
[Throughput / cycle-time]
[Exceptions]
[Work allocation]
[Domain queues]
  Marketplace
  Communications
  Service Network
  Dealer/Garage
  Trade/Logistics
[Audit / recent actions]`

**Charts:** aging distribution, throughput trend, queue matrix.

**Tables:** primary for actionable queue detail after aggregate.

**Unavailable:** read failure explicitly different from empty.

**Role constraints:** operator sees assigned scopes/actions.

**Responsive:** queue summary first; detail opens full-screen/drawer.

---

### 27.7 Blueprint 7 — Trust / Risk / Compliance

**Objective:** management risk posture plus governed review work.

**Primary question:** What risk/compliance work exists and where is it aging?

**Top controls:** domain, queue, state, severity, period.

**Hierarchy:**

`Trust / Risk / Compliance
[Aggregate risk/workload strip]
[Verification backlog] [Evidence backlog]
[Fraud cases] [Governance review]
[Dealer compliance] [Garage review]
[Trend / aging]
[Restricted operator queues]
[Audit / decision history]`

**Charts:** queue trend, aging distribution, state breakdown.

**Invalid:** one combined “Trust %”.

**Drill-down:** restricted case detail with assurance.

**Role constraints:** aggregates may be broader than evidence/PII access.

---

### 27.8 Blueprint 8 — Data & Intelligence

**Objective:** inspect the quality, provenance and lineage behind management intelligence.

**Primary question:** Can management trust the number, and what does it mean?

**Top controls:** domain, metric, source, period.

**Hierarchy:**

`Data & Intelligence
[Metric registry search]
[Source/provenance health]
[Definition conflicts]
[Freshness]
[Navigation Intelligence]
[Marketplace/commercial behaviour]
[Data quality exceptions]
[AI advisory/model intelligence — separately labelled]`

**Charts:** source freshness timeline, provenance composition, route rankings only when complete.

**Drill-down:** metric metadata → source lineage → source diagnostics.

**Role constraints:** raw source access separate from metric metadata.

**Responsive:** registry results become cards; charts stack.

---

### 27.9 Blueprint 9 — People & Access

**Objective:** manage internal Corporate placement and authority safely.

**Primary question:** Who has what authority, where, why and until when?

**Top controls:** organisational unit, access state, permission set, delegation, review due.

**Hierarchy:**

`People & Access
[Access review / overdue attention]
[Corporate membership directory]
[Permission assignments]
[Delegations]
[External tenant relationships]
[Session/security state]
[Break-glass]
[Audit]

Person detail:
Account | Membership | Permissions | Delegation | External | Sessions | Audit`

**Invalid:** role/title as permission editor.

**Drill-down:** person/account → assignment → audit.

**Role constraints:** People admin does not automatically see finance/customer/identity domain records.

---

### 27.10 Blueprint 10 — Reports

**Objective:** manage recurring management reporting as governed artifacts.

**Primary question:** Which reports are due, in review, approved or published?

**Top controls:** report family, period, scope, state.

**Hierarchy:**

`Reports
[Due / review / approval strip]
[Daily Operations]
[Weekly BU Review]
[Monthly Executive Review]
[Quarterly Board / Strategy]
[Compliance / Risk]
[Ad-hoc]
[Published archive]

Report detail:
Scope | Period | Metric versions | Provenance | Currency/units
Generated → Review → Approve → Publish
[Preview] [Exceptions] [Audit]`

**Role constraints:** generate/review/approve/publish separated by permission.

**Responsive:** report list first; preview opens separate screen.

---

### 27.11 Blueprint 11 — Platform

**Objective:** administer technical systems without mixing business management.

**Primary question:** Is the platform technically governed, available and secure?

**Top controls:** environment, provider, feature, technical domain.

**Hierarchy:**

`Platform
[Technical attention strip]
[Platform health / source availability]
[Feature Governance]
[Integrations & Providers]
[AI / Model Operations]
[Communications Delivery]
[Security]
[Data pipeline / rollups]
[Technical audit]`

**Charts:** technical latency/availability only when defined.

**Invalid:** generic business “health score”.

**Drill-down:** provider/feature/security event.

**Role constraints:** Platform Admin does not inherit Finance/People/customer PII.

---

## 28. Owner Decision Register

| Decision ID | Owner decision | Why needed | Safe default |
| --- | --- | --- | --- |
| `OD-CAUX-001` | Default Corporate Admin landing page for users with several domain permissions? | Determines first management story | Corporate Overview when permitted; otherwise first permitted top-level domain |
| `OD-CAUX-002` | Preferred executive information density: compact boardroom, standard, or dense analyst? | Layout density | Standard corporate density with optional compact mode later |
| `OD-CAUX-003` | Default reporting period for Corporate Overview? | First-load interpretation | 30-day trailing only if source family supports it; otherwise source-native |
| `OD-CAUX-004` | Should comparison period default on or require explicit selection? | Avoid misleading automatic deltas | Explicit/off unless comparability is certified |
| `OD-CAUX-005` | Should Corporate scope selector default to last-used scope or highest authorized scope? | Prevent accidental broad context | Last explicit authorized scope; clearly displayed |
| `OD-CAUX-006` | Light mode only for MVP, or light/dark mode? | Visual product policy | Light-first Corporate MVP; dark mode later unless Owner directs |
| `OD-CAUX-007` | Should the full ten-item IA remain visible to all users with disabled forbidden items, or hide unpermitted destinations? | Discoverability vs existence privacy | Hide unpermitted destinations by default; direct routes still enforced |
| `OD-CAUX-008` | Preferred BU comparison default: matrix, stacked scorecards, or trend-first? | Overview composition | Matrix on desktop with trend drill-down |
| `OD-CAUX-009` | Should strategically important unavailable metrics remain visible as blocked slots? | Management roadmap visibility | Yes for Finance/customer strategic metrics; hide low-value unavailable diagnostics |
| `OD-CAUX-010` | Should maps appear by default when an authoritative geography exists, or only as an optional view? | Space/interpretation | Optional view until geography policy stabilizes |
| `OD-CAUX-011` | Placement of executive attention center: persistent right rail, header drawer, or Overview section? | Daily management workflow | Header drawer + Overview summary |
| `OD-CAUX-012` | Should report approvals use timeline, stage bar, or task queue as primary visual? | Report workflow presentation | Stage bar in report detail + task queue on Reports overview |
| `OD-CAUX-013` | Should Platform remain visible in the same sidebar for executive-only users who have no Platform permission? | Plane separation | Hidden unless permitted |
| `OD-CAUX-014` | Preferred terminology until customer policy resolves: “Accounts & Identity”, “Audience”, or another umbrella? | Avoid “Customers” overclaim inside growth page | Use “Accounts & Identity” for account metrics; retain Customers & Growth top-level name |
| `OD-CAUX-015` | Preferred boardroom/export presentation: web presentation mode, print/PDF, slide-oriented pack, or combination? | Quarterly review workflow | Design metadata-compatible web report first; export mode later |
| `OD-CAUX-016` | Should Corporate Admin support user-customized dashboard layouts in MVP? | Complexity/governance | No; canonical layouts first |
| `OD-CAUX-017` | Should users be able to pin frequently used queues/reports? | Productivity | Allow future bookmarks; no custom KPI recomposition in MVP |
| `OD-CAUX-018` | Should management attention allow manual acknowledgement/ownership assignment in the UX? | Workflow ownership | Only where underlying domain has governed ownership; otherwise read-only attention |
| `OD-CAUX-019` | Preferred treatment of provenance set-aside counts in executive pages: always visible or metadata drawer unless non-zero? | Truth visibility | Show compact indicator always; expand when excluded/unknown > 0 |
| `OD-CAUX-020` | Should Data & Intelligence expose hashed search-signature rankings to authorized analysts? | Usability/privacy | Structured filter rankings by default; hashes hidden unless explicitly useful |
| `OD-CAUX-021` | Should separate “Operate” tabs exist inside intelligence domains or always transition to Operations/Trust top-level routes? | Plane clarity | Explicit cross-plane route transition; no hidden mutation tab on executive pages |
| `OD-CAUX-022` | Should report viewers support presenter/full-screen mode? | Boardroom use | Design-ready but not MVP-required |
| `OD-CAUX-023` | Should table column preferences persist per user? | Dense operator UX | Yes eventually; canonical defaults in MVP |
| `OD-CAUX-024` | Preferred breakpoint strategy for Corporate tablet/narrow web? | Responsive fidelity | Standard content-driven breakpoints; exact pixels determined during implementation |
| `OD-CAUX-025` | Should blocked Finance slots include “what is required to unlock” explanatory links? | Transparency | Yes, link to governed source/authority explanation, not implementation promises |
| `OD-CAUX-026` | Should executive pages surface advisory AI narratives at all? | Risk of authority confusion | No by default; optional clearly separated advisory panel if Owner requests |
| `OD-CAUX-027` | Should a universal “management notes” feature exist on reports/BU reviews? | Meeting workflow | Defer; do not mix notes with authoritative metrics without governance |
| `OD-CAUX-028` | Should Corporate Overview retain explicit “Data unavailable” cards for strategic finance/customer KPIs after implementation begins? | Avoid false completeness | Yes until authority exists |
| `OD-CAUX-029` | Should attention items support snooze/dismiss? | Risk of hiding important issues | Only if source workflow owns acknowledgement/snooze semantics |
| `OD-CAUX-030` | Preferred language for the three plane labels in final UI? | Product wording | Use Corporate Intelligence / Business Operations / Platform & Security unless Owner changes wording |

---

## 29. Downstream implementation contract

Future K3 / implementation specialists must obey all of the following.

### 29.1 Provenance

- consume accepted K2B authority;
- Corporate Actual includes only operational eligible records;
- exclude test/UAT/CI/certification/seeded/legacy-synthetic classes from Actual;
- do not count UNKNOWN/needs-review as operational;
- if a source path is not certified to consume K2B, display PENDING_K2B_CONSUMPTION.

### 29.2 Metrics

- consume CA-METRIC metric identities and versions;
- do not recompute KPI formulas in React;
- do not invent denominators;
- do not turn failed reads into zero;
- preserve unavailable/no data/not separable/forbidden.

### 29.3 Finance

- preserve CA-FIN unavailable accounting states;
- never derive GMV/revenue/profit/cash from listing price, deposit, quote, milestone or sandbox provider state;
- keep Corporate Finance separate from Finance/Payments product intelligence.

### 29.4 Growth

- preserve CA-GROWTH customer grain;
- account ≠ customer;
- route render ≠ user;
- inquiry ≠ sale;
- linked funnels only;
- human-readable top searches remain unavailable from hashes;
- peak-day unique remains peak-day.

### 29.5 Access

- preserve CA-RBAC aggregate/drill-down restrictions;
- no frontend-only authorization;
- no title-based permission;
- no future access editor built around `users.role`;
- respect step-up/assurance for restricted actions.

### 29.6 Domain authority

- existing owning domain services remain decision authorities;
- Corporate Admin orchestrates/links, not duplicates;
- no generic “approve everything” Corporate endpoint.

### 29.7 Real data

- use real staging data only under accepted provenance;
- no dummy dashboard numbers;
- no seeded fallback values;
- no sample values that can be mistaken for Actual.

### 29.8 Plane separation

Implementation must keep:

- Corporate Intelligence;
- Business Operations;
- Platform & Security

visually and navigationally separable.

Mixed current pages must be split according to this architecture.

### 29.9 Responsive behavior

- certify desktop/laptop/tablet/narrow browser;
- preserve management hierarchy on collapse;
- do not remove truth-state metadata at narrow width.

### 29.10 Accessibility

- keyboard;
- focus;
- screen-reader summaries;
- color-independent states;
- table semantics;
- chart summaries.

---

## 30. Certification and evidence expectations

CA-CERT should eventually require exact-head evidence for at least:

### 30.1 Page/role matrix

Verify for representative permission archetypes:

- visible top-level destinations;
- forbidden direct-route behavior;
- aggregate versus restricted drill-down;
- export visibility.

### 30.2 Truth-state states

Evidence must include:

- measured zero;
- no data;
- unavailable no source;
- not separable;
- insufficient data;
- degraded;
- forbidden;
- PENDING_CA_FIN;
- PENDING_K2B_CONSUMPTION;
- advisory;
- actual/derived.

### 30.3 K2B truth

For operational-source pages:

- only operational rows counted;
- non-operational excluded;
- UNKNOWN not counted;
- provenance metadata visible;
- failed read not rendered as empty.

### 30.4 Metric metadata

Verify:

- metric identity/version;
- period;
- scope;
- source;
- freshness;
- truth state.

### 30.5 Drill-down preservation

Start from Overview/BU metric and prove:

- scope persists;
- period persists;
- filter persists;
- RBAC persists;
- record detail stops when permission is absent.

### 30.6 Finance truth

Verify:

- blocked accounting slots do not show fabricated values;
- product money facts are not labelled revenue/cash/GMV;
- source currencies remain explicit.

### 30.7 Customer/growth truth

Verify:

- account not labelled customer;
- inquiry not labelled sale;
- Navigation route not labelled user;
- unlinked stages not labelled conversion;
- peak-day unique labelled correctly;
- raw search text not fabricated.

### 30.8 Responsive visual evidence

Required captures:

- large desktop;
- laptop;
- tablet;
- narrow web.

For each required page family at least one representative exact-head capture.

### 30.9 Accessibility

Evidence:

- keyboard path;
- visible focus;
- screen-reader chart summary;
- accessible table;
- color-independent state labels.

### 30.10 Cross-surface reconciliation

Same metric ID shown in:

- Corporate Overview;
- BU Detail;
- Reports

must reconcile exactly for same scope/period/version.

---

## 31. Open risks

1. **Generic-admin relapse** — implementation may simply rename the current sidebar.
2. **KPI card-wall relapse** — visually easy cards may dominate over management hierarchy.
3. **Plane leakage** — Platform provider controls may remain next to executive metrics.
4. **RBAC masking** — UI hiding may be mistaken for backend authorization.
5. **Admin bypass inheritance** — current broad `admin` compatibility could undermine least privilege during migration.
6. **Metric recomputation** — frontend may recalculate values rather than consume CA-METRIC.
7. **Unavailable-to-zero regression** — failed/absent sources may render as 0.
8. **K2B source-path gap** — accepted K2B can still be bypassed by an unintegrated metric path.
9. **Customer relabeling** — accounts/sessions/inquiries may be renamed customers for executive appeal.
10. **Finance relabeling** — deposits/quotes/settlements may be promoted to revenue/GMV.
11. **Conversion relabeling** — independent stage totals may be rendered as a funnel.
12. **Navigation vanity** — clicks/routes may be treated as strategic outcomes.
13. **Truncated rankings** — 50,000-row Navigation bound may produce false “top” lists.
14. **Search-term fabrication** — hashes may be treated as known human-readable terms.
15. **PII leakage** — executive drill-down may expose customer/identity/People details.
16. **Trust collapse** — identity, evidence, fraud and compliance states may be combined into one score.
17. **BU legal overclaim** — management units may be displayed as subsidiaries/legal entities.
18. **Geography ambiguity** — map may imply customer residence from Trade/listing geography.
19. **Red/green overclaim** — visual performance judgment without target.
20. **Advisory confusion** — AI narrative may look authoritative.
21. **Mixed Communications migration** — customer operations/provider technical controls may remain in one page.
22. **Mixed Feature Governance migration** — Navigation analytics may remain under Platform.
23. **People role-editor relapse** — future access UI may reuse `users.role`.
24. **Report self-approval** — same user may be allowed to generate/approve/publish without SoD.
25. **Responsive truth loss** — metadata may disappear on narrow widths.
26. **Custom-dashboard fragmentation** — user-defined layouts could create competing management truths too early.
27. **Stale comparison** — comparable-looking trends may mix metric versions.
28. **Empty-state ambiguity** — no data, read failure and zero may look the same.
29. **Source conflict** — duplicated legacy/current analytics may appear together without registry reconciliation.
30. **Overbuilt MVP** — broad architecture may cause implementation to attempt every future feature before source authority exists.

---

## 32. Stop conditions encountered

CA-UX did not invent:

- customer definitions;
- retention/churn policy;
- acquisition attribution;
- finance/accounting metrics;
- legal entities/subsidiaries;
- new metric formulas;
- KPI targets;
- risk thresholds;
- strong-authentication policy;
- K2B provenance classes;
- new business numbers;
- new record-level permissions.

Where a desired strategic visual lacked authority, the architecture uses:

- blocked slot;
- unavailable state;
- not separable;
- PENDING_K2B_CONSUMPTION;
- PENDING_CA_FIN;
- Owner Decision.

No application, backend, database, K2B, deployment, alias, production or merge mutation was performed.

---

## 33. Recommended next implementation task

After CA-MOD independent acceptance of CA-UX-01, the safest first implementation slice is:

**CA-K3-01 — Corporate Admin Shell + Truth-State Component Foundation**

Bounded implementation objective:

- new Corporate Admin shell;
- ten canonical top-level destinations;
- persistent plane indicator;
- permission-aware navigation hooks;
- global scope/period container;
- shared truth-state components;
- provenance/freshness component;
- blocked/unavailable/no-data/forbidden grammar;
- responsive shell;
- no substantive KPI calculations;
- no new backend authority;
- no finance/customer invention.

Suggested first product content after shell certification:

**Corporate Overview read-only composition using only already-certified source cards/sections and explicit blocked strategic slots.**

Implementation should leave current operational Admin routes available until each migration slice is independently certified.

---

## 34. Return posture

This document defines architecture only.

This document does not self-accept.

CA-UX-01 CORPORATE ADMIN UX ARCHITECTURE READY FOR MODERATOR REVIEW

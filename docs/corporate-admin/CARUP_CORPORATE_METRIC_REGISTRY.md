# CARUP CORPORATE METRIC REGISTRY

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-METRIC — Metric Governance & Data Semantics Agent  
Task: CA-METRIC-01  
Status: METRIC GOVERNANCE / DOCUMENTATION ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This Corporate Metric Registry is produced under the following exact authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical programme authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted architecture input: CA-ARCH / CA-ARCH-01
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Accepted organisation input: CA-ORG / CA-ORG-01
- Accepted CA-ORG-01 authority: `705eb6fa1cd89109977052e88e220f0498668060`
- Accepted access input: CA-RBAC / CA-RBAC-01
- Accepted CA-RBAC-01 authority: `4abdf95e1e1490b01f51cb45106a57fcf7b954b9`
- Current documentation starting head: `91efaf59964f2033633ab9f5f98af6f67ea150aa`
- Product/reference snapshot inspected read-only: `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`
- Parallel dependency: **PC01-K2B-R1 — ACTIVE / NOT ACCEPTED**

The live PR #222 head had advanced beyond the supplied product snapshot during execution. CA-METRIC-01 remained pinned to `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` and did not adopt later K2B/product state as Corporate Admin authority.

This document governs how Corporate Admin may eventually name, calculate, classify, certify, compare and display numbers. It does **not** implement a dashboard, write product code, alter analytics events, mutate the database, define accounting recognition, classify runtime provenance, or activate any metric.

---

## 2. Governing principle

**One business idea → one registered metric identity → one governed definition/version.**

Every KPI, count, rate, ratio, ranking, chart series, scorecard value and management-report number exposed through Corporate Admin must resolve to a registry entry or an explicitly non-metric technical/advisory object.

A chart is not a definition.

A UI label is not a definition.

A SQL query is not a definition.

A route response is not automatically a Corporate metric.

A metric is active only when its source, semantics, window, provenance, lineage, access classification and certification state are governed.

---

## 3. Evidence posture

### PROVEN CURRENT METRIC FACT

At the inspected product snapshot:

- CarUp Intelligence has a versioned marketplace activity ledger and versioned daily rollups.
- Marketplace rollups combine behavioral telemetry with authority reads for inquiries, reservations and saved-state snapshots.
- Rollup time is UTC day, and current stakeholder projection windows are constrained to 7/30/90 days.
- Current Intelligence exposes explicit availability envelopes: value, insufficient data, unavailable and not applicable.
- Current rate helpers use denominator floors, but some existing “conversion” ratios compare independent stage totals rather than a linked cohort.
- Multi-day unique values in current marketplace projection are not true period uniques; `windowUnique` reports the largest single-day unique and labels its basis `peak_day`.
- Navigation Analytics is a separate privacy-minimized telemetry system. It stores bounded feature/node/route-pattern events and does not store names, email, phone, VIN, device IDs, IP or raw URLs.
- Navigation aggregation currently reads a bounded window capped at 50,000 rows and calculates metrics in memory.
- Navigation `selectionThroughRate` returns numeric zero when its denominator is zero; this is not acceptable as a Corporate registry semantic without a wrapper.
- Current Marketplace Admin Analytics is an all-time live snapshot with a separate derivation from the versioned Intelligence rollups.
- Current Marketplace Admin Analytics can substitute inquiry zeros on an unavailable inquiry source and annotates the failure; Corporate Admin must not consume those zeros as measured.
- Dealer Intelligence removed fabricated sales/revenue/customer-satisfaction/campaign-performance values and explicitly states that completed dealer sale authority is absent.
- Service Intelligence `service@2` has governed service-case counts, accepted/cancelled cases, booking conversion, turnaround coverage, category demand and branch case volume; capacity utilisation and team performance remain unavailable.
- Finance Intelligence `finance_demand@1` is commercial demand intelligence only. Requested amounts are not money lent; no disbursement state exists.
- Insurance Intelligence `insurance_demand@1` separates live from sandbox eligibility and has no authoritative CarUp policy-bound conversion.
- Trade Intelligence `trade_demand@1` reads authoritative order/quote/milestone/escrow records, separates sandbox from live provider activity, groups monetary amounts by currency and explicitly refuses settled trade value where no confirmed payment exists.
- Parts Intelligence `parts_demand@1` supports RFQ volume/status, PartSentry provenance and scoped garage inventory; it has no structured parts-search demand, supplier-performance authority or compatibility source.
- Referral Intelligence `referral_performance@1` filters only referral-domain event types from a shared event table, keeps accrued versus paid reward value separate and states attribution coverage limitations.
- Command Centre `command_centre@1` is compositional and explicitly declares missing revenue, customer health, platform health and fraud-interception-rate sources.
- Communications exposes business/funnel analytics and separate worker/provider technical telemetry, with bounded row reads in several paths.
- AI Intelligence context is advisory and explicitly includes unavailable facts so generated answers cannot invent them.
- Report service preserves calculation versions and exports unavailable metrics as “NOT MEASURED” rather than blank/zero.

### PROPOSED GOVERNED SEMANTIC

This registry standardizes those existing sources into one Corporate contract and blocks misleading reuse where current projections are fit for stakeholder/product purposes but not yet fit for company-level management reporting.

### PENDING_K2B

Operational metrics whose source can contain UAT, CI, certification, fixture, synthetic, legacy or unknown provenance remain **PENDING_K2B** for Corporate activation until PC01-K2B-R1 or a successor authority is accepted.

### PENDING_CA_FIN

Accounting/management-finance metrics that require accounting authority remain **PENDING_CA_FIN** and, where no source exists, **UNAVAILABLE_NO_SOURCE**.

---

## 4. Canonical registry contract

Every active or candidate Corporate metric must have all mandatory fields below.

| Registry field | Requirement |
| --- | --- |
| `metric_id` | Stable machine identity. Never silently reused for a changed definition. |
| `canonical_name` | Human-readable canonical label. |
| `business_definition` | Plain-language statement of exactly what is being measured. |
| `purpose` | Management question the metric answers. |
| `metric_type` | COUNT / AMOUNT / RATE / RATIO / DURATION / DISTRIBUTION / RANK / STATE / INDEX where separately governed. |
| `truth_state` | One of the canonical truth states in section 5. |
| `plane` | Corporate Intelligence / Business Operations / Platform & Security. |
| `corporate_domain` | Corporate Overview, Business Units, Finance, Customers & Growth, Operations, Trust/Risk/Compliance, Data & Intelligence, People & Access, Reports or Platform. |
| `business_owner` | Internal BU/function accountable for business meaning, using CA-ORG identities. |
| `data_steward` | Internal function responsible for definition/quality/lineage. |
| `source_authority` | Authoritative table/service/projection or explicit absence. |
| `source_objects` | Exact source tables/services/projections. |
| `calculation_authority` | Code/service/version that derives the metric, if derived. |
| `formula` | Governed formula or “NONE / direct count”; accounting formulas may remain PENDING_CA_FIN. |
| `numerator` | Required for rate/ratio; registry metric/source identity. |
| `denominator` | Required for rate/ratio; registry metric/source identity. |
| `denominator_floor` | Minimum denominator or NONE. |
| `unit` | count, percent, ratio, hours, currency amount, etc. |
| `currency_semantics` | Currency source; single-currency, by-currency, or PENDING_CA_FIN. No implicit FX. |
| `time_grain` | Event, point-in-time, UTC day, week, month, rolling window, etc. |
| `default_window` | Default display/management window. |
| `timestamp_authority` | Which timestamp assigns an event/record to a period. |
| `period_semantics` | Inclusive/exclusive bounds and whether today is partial. |
| `entity_grain` | Account, anonymous profile/session, listing, seller, tenant, BU, order, case, thread, etc. |
| `organisational_dimensions` | Corporate/BU/function/department/team dimensions allowed. |
| `geographic_dimensions` | Country/region/corridor/market dimensions and source. |
| `other_dimensions` | Platform, channel, make/model, service category, provider mode, etc. |
| `provenance_dependency` | NONE / PENDING_K2B / accepted provenance rule reference. |
| `inclusion_rules` | Explicit qualification rules. |
| `exclusion_rules` | Staff, fixture, bot, synthetic, spam, rejected, sandbox, etc. |
| `zero_semantics` | Conditions under which value 0 is a true measurement. |
| `no_data_semantics` | Conditions under which NO DATA is used. |
| `unavailable_semantics` | Conditions and reason codes for unavailable. |
| `freshness_contract` | Expected refresh and stale threshold. |
| `quality_state` | Registry quality lifecycle in section 8. |
| `classification` | CA-RBAC classification. |
| `aggregate_permission` | Permission needed to see aggregate value. |
| `drill_down_permission` | Separate permission needed to see underlying records. |
| `export_implication` | Whether export requires a stronger permission/assurance. |
| `lineage_version` | Calculation/source/inclusion version. |
| `certification_state` | DRAFT / SOURCE_IDENTIFIED / SEMANTICS_DEFINED / PROVENANCE_GATED / CERTIFIED / DEGRADED / BLOCKED / DEPRECATED. |
| `caveats` | Known limitation that must travel with the metric. |
| `replacement_metric_id` | Required if deprecated/replaced. |

### 4.1 Metric ID convention

Recommended pattern:

`<domain>.<subject>.<measure>.<grain>`

Examples:

- `marketplace.listing.published.count`
- `marketplace.search.zero_result.count`
- `growth.navigation.item_selection.rate`
- `service.case.turnaround.median_hours`
- `risk.identity.pending_review.count`

A change in formula, uniqueness rule, population, authority source, time semantics or inclusion/exclusion that changes meaning requires a new `lineage_version` and may require a new `metric_id` if the business concept itself changes.

---

## 5. Canonical truth states

| Truth state | Meaning | Corporate treatment |
| --- | --- | --- |
| `GOVERNED_ACTUAL` | Direct count/state/value from an authoritative domain source with no business inference beyond scoped filtering. | Eligible after provenance/access/freshness certification. |
| `GOVERNED_DERIVED` | Deterministic transformation of governed sources under a versioned calculation. | Eligible after lineage and provenance certification. |
| `GOVERNED_RATE_OR_RATIO` | Versioned numerator/denominator with named populations, window and denominator policy. | Eligible only when denominator and cohort semantics are explicit. |
| `ADVISORY` | Recommendation, AI summary, heuristic or non-authoritative suggestion. | Never rendered as Actual KPI. |
| `TECHNICAL_OPERATIONAL` | Runtime/worker/provider/configuration telemetry. | Platform plane; not business performance unless separately promoted through a new registry metric. |
| `CONTAMINATED_PENDING_K2B` | Potentially valid source mixed with or vulnerable to non-business provenance not yet accepted by K2B. | Block from Corporate Actual until provenance gate accepted. |
| `INSUFFICIENT_DATA` | Source is valid but denominator/sample/coverage is below governed threshold. | Display “Insufficient data”, never 0%. |
| `UNAVAILABLE_NO_SOURCE` | No authoritative source exists for the business idea. | No value may be shown. |
| `UNAVAILABLE_NOT_SEPARABLE` | Source exists, but the requested segment/dimension cannot be isolated honestly. | State the inseparability; do not infer. |
| `DUPLICATED_OR_CONFLICTING` | Multiple current calculations/sources claim adjacent meaning without registry reconciliation. | Do not activate until one canonical semantic is chosen. |
| `UNKNOWN_AUTHORITY` | A value exists but its authority/meaning cannot be established. | Block. |
| `DEPRECATED` | Metric definition must no longer be used. | Hide from new Corporate surfaces; retain lineage for historical interpretation. |

---

## 6. Display-state semantics: 0 is not absence

Corporate Admin must use a display state separately from numeric value.

### 6.1 MEASURED ZERO — `0`

A numeric zero is valid only when all are true:

- metric is applicable to the requested scope/window;
- authoritative source was read successfully;
- required rollup/calculation completed;
- provenance gate is satisfied;
- coverage is sufficient for a count metric;
- inclusion/exclusion rules are known;
- exactly zero qualifying observations/records exist.

Example: a successfully read authoritative inquiry table contains zero qualifying inquiries in a certified window.

### 6.2 NO DATA

Use **NO DATA** when the source concept exists but no observations are available and absence cannot safely be interpreted as zero performance.

Examples:

- no completed rollup exists for the requested historical slice;
- instrumentation started after the requested period;
- a cohort has no observation history;
- a dimension has no recorded values even though the metric could eventually support it.

Registry field `zero_is_meaningful` or equivalent must decide whether an empty result can become zero.

### 6.3 UNAVAILABLE

Use **UNAVAILABLE** when the metric cannot be measured now because:

- source read failed;
- required calculation is not computed;
- source authority does not exist;
- required provider/integration is absent;
- definition requires unresolved policy;
- current environment cannot certify provenance.

Unavailable always carries a reason code.

### 6.4 NOT SEPARABLE

Use **NOT SEPARABLE** when a broader source exists but the requested subset cannot be isolated without guessing.

Examples:

- referral actor type cannot reliably distinguish organic visitors from operators;
- raw search text is not stored, so human-readable “top search terms” are not separable from hashed search signatures;
- an unattributed finance application cannot be assigned to a lender;
- current channel/source coverage may describe only recorded events, not the whole funnel.

### 6.5 FORBIDDEN

**FORBIDDEN is an access decision, not a data state.**

A metric may exist and be certified but the caller lacks CA-RBAC permission.

Forbidden must never be converted to:

- zero;
- unavailable;
- no data.

Where existence itself is sensitive, the product may return a non-enumerating authorization response rather than reveal that the metric exists.

### 6.6 INSUFFICIENT DATA

For rates/ratios/distributions, valid source with a denominator below a governed floor is `INSUFFICIENT_DATA`, not 0 and not UNAVAILABLE.

---

## 7. Registry quality lifecycle

`DRAFT → SOURCE_IDENTIFIED → SEMANTICS_DEFINED → PROVENANCE_GATED → CERTIFIED`

Additional states:

- `DEGRADED` — source exists but freshness/quality/coverage temporarily fails.
- `BLOCKED` — unresolved authority/conflict prevents activation.
- `DEPRECATED` — definition retired; lineage retained.

### 7.1 Certification requirements

CA-CERT must later verify for each certified metric:

1. exact source authority;
2. calculation/version;
3. numerator and denominator where applicable;
4. time grain/window/timestamp;
5. provenance exclusion;
6. null/zero/no-data semantics;
7. organisational/geographic scope;
8. currency/unit;
9. freshness/staleness;
10. access classification and aggregate/drill-down permissions;
11. reconciliation to authority rows where possible;
12. version identity and historical reproducibility.

---

## 8. Existing metric/source inventory

Disposition meanings:

- **REUSE** — existing semantic/source is fit to register with minimal normalization.
- **WRAP** — keep source/derivation, but Corporate registry must add scope/truth/access/freshness/provenance semantics.
- **REPLACE** — existing projection/metric is unsuitable for Corporate meaning; reuse lower-level source where safe.
- **DEPRECATE** — do not expose as Corporate metric.

### 8.1 Command Centre and Corporate Overview

| Current projection / metrics | Source authority / current derivation | Current consumer | Current truth posture | Time semantics | Provenance | Future domain | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `command_centre@1` overview: users total, joined in window, organizations total | Direct counts from `users` and `organizations` | Admin Command Centre | Governed source counts, but “customer” meaning is not established | 30-day default service window for joined; totals point-in-time | PENDING_K2B for business/customer classification | Corporate Overview / People & Access | **WRAP**; rename account/org facts, do not call customers |
| Supply: vehicles total, published, unpublished, listed in window | `vehicles` direct scan and publication status | Admin Command Centre | Governed actual state/count candidates | point-in-time plus created-in-window | PENDING_K2B and fixture exclusion requirements | Marketplace / Corporate Overview | **WRAP** |
| Demand: inquiries, saved vehicles, activity events | `marketplace_inquiries`, `saved_vehicles`, activity ledger | Admin Command Centre | Mixed grains; saved count is current-state rows while inquiries/events are windowed | windowed counts; current save rows selected without a window filter in current composition | PENDING_K2B | Marketplace / Customers & Growth | **REPLACE** as a combined “Demand” number; register individual metrics only |
| Evidence reviewed / awaiting review | `vehicle_evidence.verification_status` | Admin Command Centre | Governed operational counts; not Trust score | windowed by created_at | PENDING_K2B for operational truth | Trust/Risk/Compliance | **WRAP** |
| Threads/messages | Communications tables | Admin Command Centre | Volume only, no conversation-quality meaning | windowed by created_at | PENDING_K2B | Operations / Customers & Growth | **WRAP** |
| Escrow sessions/live/sandbox settlements | `escrow_trust_sessions` split by provider mode | Admin Command Centre | Record-state counts; sandbox explicitly non-financial | windowed | PENDING_K2B; live provider authority required | Business Units / Finance boundary | **WRAP** counts; never promote to revenue/GMV |
| Claims recorded | `insurance_claims` count | Admin Command Centre | Volume only; not underwriting/risk outcome | windowed | PENDING_K2B | Trust/Risk/Compliance / Insurance BU | **WRAP** |
| Revenue, customer health, platform health, fraud interception rate | Explicitly no source in `commandCentreService.js` | Admin Command Centre absence blocks | `UNAVAILABLE_NO_SOURCE` | N/A | N/A | Corporate Overview | **REUSE absence semantics**; do not fill with estimates |

**Registry rule:** Command Centre is a composition layer, not a calculation authority for vertical KPIs.

### 8.2 Marketplace Intelligence rollups

| Current metric family | Source / derivation | Consumer | Current truth posture | Time semantics | Provenance | Future domain | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Impressions, views, engaged views, save/unsave events, shares, compare adds, inquiry starts | `marketplace_activity_events` → versioned daily rollups `rollup@2` | Seller/Dealer/Admin Intelligence | Governed derived candidate | UTC daily; projections 7/30/90 | **PENDING_K2B** for Corporate activation; current exclusions include staff/fixture/bot/synthetic and seller self-traffic where applicable | Marketplace / Customers & Growth | **WRAP** |
| Inquiries | Authority read from `marketplace_inquiries`; spam/rejected and non-vehicle inquiries excluded in rollup authority | Seller/Dealer/Admin Intelligence | `GOVERNED_ACTUAL` count candidate | UTC day + 7/30/90 projection | PENDING_K2B for business provenance | Marketplace | **REUSE/WRAP** |
| Inspections | Inspection-type authoritative inquiry/workflow rows | Intelligence rollups | Governed actual candidate | UTC day | PENDING_K2B | Marketplace / Operations | **WRAP** |
| Reservations | Active `vehicle_reservations` established in day | Intelligence rollups | Governed actual reservation-state count, not sale/payment | UTC day | PENDING_K2B | Marketplace / Operations | **WRAP** |
| Net watchlist | Current `saved_vehicles` snapshot per listing | Listing projection | Governed current-state actual | snapshot at rollup computation, not event total | PENDING_K2B | Marketplace | **WRAP** with snapshot semantics |
| `unique_viewers` / `unique_shoppers` daily | Distinct link/actor keys within a day | Intelligence rollups | Governed derived daily unique | UTC day | PENDING_K2B | Customers & Growth | **REUSE daily only** |
| Multi-day “unique” projection | Maximum daily unique over requested days with `basis=peak_day` | Seller/Dealer/Admin projections | Not a true period unique | 7/30/90 | PENDING_K2B | Customers & Growth | **REPLACE label/semantic** with `peak_daily_unique_*` unless future true-window unique exists |
| `view_to_inquiry` / similar current projection rate | Independent period inquiry total divided by view total; helper caps above 100 | Seller/Dealer/Admin projections | Deterministic activity ratio, **not a linked cohort conversion** | 7/30/90 | PENDING_K2B | Customers & Growth / Marketplace | **REPLACE as “conversion”**; may retain as explicitly named activity ratio |
| Zero-result rate | zero-result searches / searches, denominator floor | Admin Intelligence | Candidate governed rate if source/provenance complete | 7/30/90 | PENDING_K2B | Customers & Growth | **WRAP** |
| `active_listings` in seller/tenant rollups | Listing set participating in day’s rollup activity/authority events | Dealer projection | Misleading as inventory count for management | UTC day, max in projection | PENDING_K2B | Marketplace Supply | **DEPRECATE for supply KPI**; use authoritative listing state/snapshot |
| Listing completeness | Fixed rubric `completeness@LC1` | Seller Intelligence | Governed derived quality/completeness of recorded fields | current/listing | PENDING_K2B if used corporately | Marketplace Operations | **WRAP**; not Trust/quality score |
| Lost opportunity | Near-miss filtered searches attributable to missing listing fields | Seller guidance | Governed derived opportunity signal under version | bounded search window | PENDING_K2B | Marketplace / Customers & Growth | **WRAP**, never call lost sales/revenue |

### 8.3 Legacy Marketplace Admin Analytics

Current projection:

- listings: total/public/pending/suppressed/rejected/archived/high-risk;
- inquiries: total/by type/by status/referral-attributed/high-risk/diaspora demand;
- no governed time window;
- independently calculates from raw tables;
- inquiry failure can yield zero-valued shape with a note;
- “high_risk” listing logic uses a numeric `trust_score` threshold and is not the canonical Trust authority.

**Corporate disposition: REPLACE projection.**

Reuse individual authoritative table states where they are still valid, but:

- do not consume failure zeros;
- do not use its `high_risk` metric as Corporate risk;
- do not allow it to compete with versioned Marketplace Intelligence;
- register moderation backlog/state counts separately under Operations if needed.

### 8.4 Navigation Intelligence

Current privacy-minimized source: `navigation_analytics_events`.

Current event types include surface open, item impression/selection, destination rendered/blocked, role switch, drawer/tab interaction and navigation error.

| Metric | Current derivation | Corporate semantic | Status / disposition |
| --- | --- | --- | --- |
| Navigation impressions | Count `navigation_item_impression` | Number of registered nav feature/node impressions | **WRAP, PENDING_K2B** |
| Navigation selections | Count `navigation_item_selected` | Number of selections of registered nav feature/node | **WRAP, PENDING_K2B** |
| Destination renders | Count `navigation_destination_rendered` | Registered destination route successfully rendered | **WRAP, PENDING_K2B** |
| Destination blocked | Count `navigation_destination_blocked` | Navigation attempts blocked by governed route lifecycle/access reason | **WRAP, PENDING_K2B**; reason taxonomy required |
| Navigation errors | Count `navigation_error` | Recorded nav errors, not platform-wide error rate | **WRAP, PENDING_K2B** |
| Selection-through rate | selections / impressions | Discovery ratio for the same registered nav population | **REPLACE current zero-denominator behavior**; registry rate must return INSUFFICIENT_DATA/NO DATA when denominator is 0 |
| Platform split | Count by web/iOS/Android | Distribution of recorded nav events by platform | **WRAP, PENDING_K2B** |
| Role-category split | Count by coarse trusted session role | Distribution by coarse platform role, not customer segment | **WRAP**; never call role category customer type |
| Top surfaces | Ranked event counts by nav surface | Navigation UI-surface activity | **WRAP**, not “top features” unless feature/node grouped |
| Zero-selection items | Impressed feature/node IDs with no selection in window | Discovery-friction signal | **WRAP**, requires minimum impression floor before management escalation |
| Top routes | Source/destination route patterns are stored but current aggregate endpoint does not rank them | Future governed route-render ranking | **REPLACE/NEW registry derivation** from scalable aggregate, PENDING_K2B |
| Route views | Destination-rendered count by registered route pattern | Route render activity, not unique visitors | **NEW governed derivation**, PENDING_K2B |
| Verify route usage | Navigation selections/renders for a registered Verify feature/route where present | Feature discovery/render only | **WRAP**, never equate with verification completed |
| Feature adoption | Requires eligible population + feature use numerator | Not currently defined by nav counts alone | **UNAVAILABLE_NOT_SEPARABLE** until denominator/population defined |
| Abandonment from nav | No linked journey semantics in nav table alone | Cannot infer abandonment from “impressed but not selected” | **UNAVAILABLE_NOT_SEPARABLE** |

**Current scalability limitation:** current aggregate endpoint caps its read at 50,000 events. Corporate certification must not accept a silently truncated window. A Corporate implementation must use a complete aggregate/read model or return DEGRADED/UNAVAILABLE when the cap is reached.

### 8.5 Dealer / tenant Marketplace Intelligence

Current dealer projection uses tenant-grain rollups and verified tenant scope.

Reusable candidate metrics:

- impressions;
- views;
- daily unique viewers;
- saves;
- confirmed shares;
- inquiries;
- inspections;
- reservations where rollup version supports them.

Not currently authoritative:

- completed dealer sales;
- dealer revenue;
- average sale price;
- customer satisfaction;
- promotion views/clicks/ROI where no instrumentation exists.

**Disposition:** WRAP governed demand/engagement counts. Keep sales/revenue metrics **UNAVAILABLE_NO_SOURCE / PENDING_CA_FIN** as applicable.

Real inventory count must come from authoritative tenant-scoped vehicle inventory/listing state, not rollup `active_listings`.

### 8.6 Garage / Service Network

Current `service@2` sources:

- mechanic work orders;
- service cases;
- service inquiries;
- PartSentry/service records;
- canonical vehicle identity for make/model enrichment.

Reusable governed candidates:

- work orders;
- completed work orders;
- open work orders;
- service records logged;
- service enquiries;
- identified/repeat customer counts at the current service-record grain;
- practitioners contributing as a count, not performance;
- service requests;
- accepted requests;
- declined/cancelled;
- booking conversion with denominator floor;
- cancellation rate with denominator floor;
- turnaround median with measured/unmeasured case coverage;
- service-category demand with unspecified bucket;
- branch case volume with unattributed bucket.

Unavailable:

- capacity utilisation — no slots/bays/shifts/open-hours model;
- team performance — assignment count is not performance.

**Disposition:** REUSE/WRAP `service@2` with BU/org scope and PENDING_K2B. Do not transform branch case count into branch quality/performance without a governed definition.

### 8.7 Finance-product Intelligence

Current `finance_demand@1` is **commercial demand**, not Corporate Finance.

Reusable source candidates:

- applications received;
- authoritatively decided applications;
- awaiting decision;
- decision rate with explicit denominator;
- active lender/provider-state count;
- live eligibility request status counts;
- sandbox eligibility request counts separately;
- unattributed application count for platform scope.

Unavailable:

- approvals when no authoritative lender decision source exists;
- offers;
- disbursements;
- portfolio value;
- portfolio APR;
- default/delinquency;
- collateral binding;
- certified acquisition/source attribution.

**Disposition:** WRAP commercial-demand metrics under the Financial Services BU. None of these are Revenue, Cash, Receivables or loan-book value.

All Corporate Finance/accounting use is **PENDING_CA_FIN**.

### 8.8 Insurance Intelligence

Current `insurance_demand@1` supports:

- active insurer/provider state;
- live eligibility requests;
- eligible/not eligible/pending;
- live eligibility rate with denominator floor;
- sandbox activity separately.

Unavailable:

- insurance product views;
- quote submissions;
- offers;
- policies bound through CarUp;
- renewals;
- certified acquisition/source attribution.

Claims exist elsewhere as governed domain records but are not insurance-demand conversion.

**Disposition:** WRAP live demand; keep sandbox separate and **PENDING_K2B**. Do not infer policy conversion.

### 8.9 Diaspora / Trade / Logistics

Current `trade_demand@1` reusable candidates:

- orders created;
- cancelled orders;
- status/type distribution;
- corridor counts;
- quotes issued/accepted;
- orders with/awaiting quote;
- quote acceptance rate;
- request-for-quote published/open/awarded counts;
- offers received;
- offers per quoted request;
- publish-to-offer ratio;
- offer-to-award ratio;
- time to first submitted offer;
- requested budgets grouped by source currency;
- scheduled payment milestones;
- confirmed milestone count;
- milestone confirmation rate;
- scheduled amounts grouped by currency;
- escrow session counts split live/sandbox/no-payment.

Unavailable:

- settled trade value;
- live SafeTrade outcomes;
- shipment/container demand where no records exist;
- actual travelled route demand;
- landed cost;
- authoritative trade↔vehicle linkage where absent;
- counterparty reputation;
- compliance outcomes where no reviews exist.

The separate Trade Graph remains a derived graph authority for graph-based matching/opportunity, not authoritative trade-table counts.

**Disposition:** REUSE/WRAP authoritative table-derived metrics; keep Trade Graph metrics separately versioned. Monetary request/quote/scheduled amounts are **not GMV/revenue**.

### 8.10 Parts / PartSentry

Reusable candidates:

- parts RFQ requests/responded/awaiting response and response rate;
- PartSentry logs recorded;
- parts verified / awaiting verification;
- public-card eligible;
- flagged for review;
- PartSentry verification rate;
- tenant-scoped part types tracked;
- stock-recorded coverage;
- true recorded zero-stock count;
- below reorder threshold when thresholds exist;
- inventory value only over recorded price × recorded stock, with coverage disclosed.

Unavailable/not separable:

- requested part identity from RFQ — free-text message is not structured part authority;
- supplier attribution/performance — no supplier principal on RFQs;
- parts compatibility — no authoritative compatibility source;
- platform-wide private garage inventory;
- parts zero-result search demand — vehicle marketplace search cannot be relabeled as parts search.

**Disposition:** WRAP. `flagged_for_review` is not fraud outcome.

### 8.11 Referral / Growth

Current `referral_performance@1` supports:

- referral-domain event count;
- codes created;
- validations/failed validations;
- validation success rate;
- coupon actions;
- channel breakdown;
- source breakdown with explicit source coverage;
- active/draft campaign counts;
- reward transactions/accrued amounts by currency;
- paid reward counts/amounts separately;
- referral-attributed inquiry counts and rate.

Limitations:

- shared `referral_events` requires explicit domain filtering;
- source coverage is incomplete;
- actor type cannot cleanly distinguish organic versus operator in some flows;
- inquiry is the furthest authoritative commercial outcome currently linked;
- no completed-sale conversion;
- no campaign-cost authority;
- no true ROI;
- partner rows may be UAT/revoked rather than live business.

**Disposition:** WRAP counts and coverage; **PENDING_K2B** for Corporate Actual. Attribution and ROI remain BLOCKED/UNAVAILABLE where authority is absent.

### 8.12 Trust / Identity / Governance / Fraud

Potential Corporate metrics must summarize governed domain facts without recalculating domain decisions.

Candidate actual/derived metrics:

- identity verification sessions by governed status;
- pending identity-review backlog;
- evidence rows by governed verification status;
- Trust Fact requests/decisions by governed state;
- governance review tasks/decisions by governed state;
- fraud cases/signals/resolutions by governed state;
- dealer compliance requirements/decisions;
- garage application state/decision counts;
- lifecycle state counts where audience and privacy classification permit.

Prohibited shortcuts:

- one generic “Trust score” combining identity, evidence, dealer, PartSentry and fraud;
- fraud interception rate without a defined denominator/outcome authority;
- CarUp review presented as government verification;
- AI/OCR confidence presented as a decision outcome.

**Disposition:** REUSE domain states; WRAP into aggregate metrics. Classification generally Restricted Identity/Compliance for drill-down; aggregate exposure follows CA-RBAC.

### 8.13 Communications

#### Business/customer analytics

Current per-user analytics includes:

- conversations total/active/converted;
- workflow/funnel stage;
- marketplace conversation progression;
- first-response time samples;
- event counts;
- delivery status;
- attribution fields;
- AI derivations/human review;
- campaign touches/conversion.

Current weaknesses for Corporate use:

- row caps;
- all-time/unclear period semantics on some reads;
- several rate helpers return 0 when denominator is zero;
- conversion state semantics are Communications-specific, not universal sales conversion.

**Disposition:** REPLACE Corporate rates, WRAP raw governed counts only when complete-window source is available.

#### Admin/technical communications operations

Candidate technical/operations facts:

- open threads;
- unassigned threads;
- overdue threads;
- dead-letter count;
- duplicate webhook count;
- worker queue depth/status;
- oldest queued age;
- provider delivery attempts/errors;
- scheduler/adapter health.

**Truth state:** TECHNICAL_OPERATIONAL or Business Operations queue metrics depending on metric.  
**Disposition:** WRAP; do not combine into a generic “communications health score”.

### 8.14 Platform / Feature Governance / AI

- Feature rollout state/override/audit: governed technical configuration state → **TECHNICAL_OPERATIONAL**, REUSE/WRAP.
- `server_health` rows: technical operational source; not automatically uptime/SLA → WRAP.
- in-process metrics hub: restart-scoped telemetry → technical diagnostic only; **DEPRECATE for management-period KPI** unless durable semantics are added.
- provider/model configured state: technical state, not AI quality.
- AI request volume/latency/accuracy: unavailable where canonical measurement source is absent.
- AI summaries, recommendations, marketing suggestions, OCR/classifier aids: **ADVISORY**, never Actual.
- `ai_context@1` is a grounding contract, not a KPI authority.

### 8.15 Reports

Current `reportService.js` has good semantic behavior:

- period and calculation version travel with report;
- unavailable rows remain unavailable;
- CSV says `NOT MEASURED` rather than blank/zero.

**Disposition:** REUSE semantic pattern / WRAP as source capability. It is not yet the Corporate historical management-report snapshot authority.

---

## 9. Strategic Corporate metric families

This section establishes candidate semantics. A candidate is not active merely because it is listed.

### 9.1 Corporate Overview

| Metric family | Canonical semantic | Current source posture | Registry status |
| --- | --- | --- | --- |
| Registered accounts | Distinct base CarUp account rows under a certified account definition | `users` exists | PENDING_K2B; do not call customers |
| Customers | Distinct people/organisations satisfying Owner-approved customer definition | No canonical definition | `OD-CAMETRIC-001` / BLOCKED |
| Active customers | Customers with qualifying business activity inside governed window | No canonical definition | `OD-CAMETRIC-002` / BLOCKED |
| Verified customers | Customers meeting approved verification semantic | Identity lifecycle exists; customer grain unresolved | `OD-CAMETRIC-003` / BLOCKED |
| Public listings | Listings currently public under canonical publication state | `vehicles/publication_status` / listing service | Candidate GOVERNED_ACTUAL, PENDING_K2B |
| New/published listings | Governed creation/publication transitions in period | vehicle authority + activity events | PENDING_K2B |
| Inquiries/leads | Authoritative qualifying marketplace inquiry rows | `marketplace_inquiries` | Candidate GOVERNED_ACTUAL, PENDING_K2B |
| Conversion | Named funnel conversion with linked cohort/denominator | No one universal conversion | `OD-CAMETRIC-010`; existing activity ratios are not universal conversion |
| Revenue | Accounting-recognized CarUp revenue | No accepted source | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Gross profit | Revenue minus governed direct costs under CA-FIN policy | No accepted source | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Operating profit | Accounting result | No accepted source | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Cash | Governed cash balance/receipt authority | No accepted Corporate source | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Settlement exposure | Governed live unsettled obligations/settlements | Sandbox/current transaction sources insufficient for company accounting | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Risk/compliance backlog | Open governed review/case tasks by specific domain | Multiple domain sources | Candidate WRAPPED aggregate, PENDING_K2B |
| Service-network activity | Service cases/work orders under Service Network | `service@2` | Candidate governed, PENDING_K2B |
| Platform reliability | Defined uptime/latency/error objective over durable telemetry | No current Corporate source | UNAVAILABLE_NO_SOURCE until CA-PLAT/metric authority |

### 9.2 Customers & Growth

Candidate families:

- registered accounts;
- new accounts;
- defined customers;
- active customers;
- verified customers;
- anonymous visitors/profile keys;
- authenticated visitors;
- acquisition source;
- referral source;
- geography;
- returning customer;
- retained customer;
- reactivated customer;
- churned customer;
- route/feature discovery;
- marketplace search behavior;
- funnel progression;
- campaign/referral outcomes.

Retention/churn and paying customer remain unavailable until business definitions and source authority exist.

### 9.3 Marketplace scorecard

Candidate supply:

- listings total;
- public listings;
- listings created;
- listings submitted;
- listings published;
- listings suppressed/rejected if operationally relevant;
- inventory by make/model/region where canonical fields exist.

Candidate demand/engagement:

- searches;
- zero-result searches;
- listing impressions;
- listing opens/views;
- engaged views;
- saves/current watchlist;
- compare adds;
- inquiry starts;
- authoritative inquiries;
- inspection requests;
- reservations.

Outcome:

- sold-status transitions may be a vehicle lifecycle metric, but “vehicles sold through CarUp” requires Owner/transaction authority decision.
- sale value/GMV/revenue remain unavailable until CA-FIN/transaction authority.

### 9.4 BU scorecard template

Every BU may populate only metrics it can govern.

Standard slots:

- customers;
- demand;
- supply/capacity;
- throughput;
- conversion;
- revenue;
- gross profit;
- direct cost;
- risk/compliance;
- service quality;
- backlog;
- cycle time.

A blank source slot is not a zero. The registry returns UNAVAILABLE with reason.

---

## 10. Customer and entity grain contract

### 10.1 Account

A row/principal in CarUp's base account identity system.

**Account ≠ customer.**

Internal staff, external providers and customers may all hold accounts.

### 10.2 Customer

A business-defined person or organisation consuming/buying/transacting through CarUp under an Owner-approved definition.

Current repository does not establish one canonical customer entity.

Status: **OD-CAMETRIC-001**.

### 10.3 Active customer

A customer with one or more Owner-approved qualifying activities in a defined time window.

Required definition must state:

- qualifying activity set;
- window;
- person versus organisation grain;
- authenticated versus anonymous treatment;
- whether non-commercial browsing counts;
- provenance exclusions.

Status: **OD-CAMETRIC-002**.

### 10.4 Verified customer

Must distinguish:

- account/email verification;
- identity verification/lifecycle;
- dealer/garage/institution verification;
- vehicle/evidence Trust.

No one generic “verified” bit may combine them.

Status: **OD-CAMETRIC-003**.

### 10.5 Paying customer

A customer with accounting-authoritative recognized payment/revenue relationship under CA-FIN policy.

Current source authority absent.

Status: **PENDING_CA_FIN / OD-CAMETRIC-004**.

### 10.6 Buyer

A person/account/organisation exhibiting an Owner-approved buyer-side business action.

The platform role `owner` must not automatically be renamed buyer.

Possible authoritative buyer actions include inquiry/reservation/order participation, but the registry needs OD-CAMETRIC-005 before defining the cohort.

### 10.7 Seller

A person/tenant with canonical ownership/seller authority over a listing or seller-side transaction/workflow.

A person may be both buyer and seller. These are behavioral/business roles, not mutually exclusive identities.

### 10.8 Institutional partner

An external bank, insurer, government body, dealer organisation, garage, provider or API partner under an explicit external relationship.

Tenant/provider existence does not automatically mean “customer” or “paying customer”.

### 10.9 Anonymous visitor

A pseudonymous analytics actor represented by a privacy-safe session/profile key where instrumented.

It is not a known person.

### 10.10 Session

Three session concepts must never be conflated:

- authentication session (`user_sessions`);
- pseudonymous analytics profile/session key;
- activity session defined by inactivity gap.

A “session count” must name which one.

### 10.11 Device

No Corporate metric should call the pseudonymous browser/profile key a physical device unless a dedicated device authority exists.

### 10.12 Inquiry

A row in the authoritative inquiry/workflow source.

### 10.13 Lead

For marketplace vehicle rollups, a qualifying vehicle inquiry excluding spam/rejected states under the current Intelligence contract.

This is not automatically the universal Corporate definition of “lead” across finance, trade, service or insurance. Domain-specific lead metrics need domain IDs.

---

## 11. Navigation and behavioral intelligence contract

Navigation Intelligence must answer management questions, not reward clicks.

### 11.1 Management question hierarchy

Raw event → governed metric → management interpretation.

Examples:

- impression → feature discovery exposure;
- selection → discovery engagement;
- destination render → successful route reach;
- search → expressed marketplace demand;
- zero-result search → unmet supply signal;
- detail open → listing consideration;
- save/compare/inquiry → deeper intent;
- seller listing progression → supply onboarding friction;
- verification route use → Trust feature discovery;
- verification decision → governed Trust/Identity outcome.

A raw click is never itself “customer growth”.

### 11.2 Route views

Canonical candidate:

`growth.navigation.route_render.count`

Definition: count of `navigation_destination_rendered` grouped by registered destination route pattern, complete window only.

Truth: GOVERNED_DERIVED after scalable aggregation/provenance.  
Status: PENDING_K2B.

Do not call route renders unique visitors.

### 11.3 Searches

Canonical candidates:

- `marketplace.search.performed.count`
- `marketplace.search.zero_result.count`
- `marketplace.search.zero_result.rate`
- `marketplace.search.filter_usage.count`

Source: server-emitted marketplace activity events.

A search with filters is behavioral demand, not a customer or sale.

### 11.4 Filter usage

Current search event metadata carries bounded `filter_keys` and allowlisted filter values.

Candidate management use:

- which attributes buyers use;
- which filters correlate with zero results;
- supply-field completeness gaps.

Never infer personal preference beyond aggregate cohort use.

### 11.5 Vehicle-detail views

Canonical candidate:

`marketplace.listing.open.count`

Source: server-emitted `marketplace_listing_opened` where request context exists.

Known limitation: requests without analytics session/page context can be intentionally unrecorded. Coverage must be disclosed.

### 11.6 Saves

Two distinct metrics:

- save actions in period — event count;
- current saved/watchlist state — authoritative `saved_vehicles` snapshot.

Do not add these or use one as the other.

### 11.7 Inquiry start versus completion

- Start: `marketplace_inquiry_started` behavioral event.
- Completion: authoritative `marketplace_inquiries` row / corresponding server-emitted observation.

True start→completion conversion requires a linked cohort key across both stages. If linkage is absent/incomplete, counts remain valid but conversion is **UNAVAILABLE_NOT_SEPARABLE**.

### 11.8 Seller journey

Candidate stages:

- listing creation process started;
- listing record created;
- documents/steps where governed;
- submitted for review;
- published;
- sold-status transition.

Client process telemetry may describe friction; server state transitions describe authoritative lifecycle.

Abandonment must only be calculated from linked process instances with a governed start and terminal/timeout rule.

### 11.9 Verify usage

Separate:

1. navigation/select/render of Verify-related feature;
2. verification session started;
3. evidence submitted;
4. review decision;
5. current identity/Trust state.

A route render is not verification completion.

### 11.10 Top routes

Rank by governed route-render count only after:

- complete window;
- provenance gate;
- minimum-volume rule;
- registered route identity;
- comparable platform instrumentation.

### 11.11 Top searches

Current activity ledger stores a normalized query **hash**, not raw free text.

Therefore:

- ranking anonymous search signatures by hash may be technically possible;
- human-readable “top search terms” are **UNAVAILABLE_NOT_SEPARABLE** from current source;
- filter/value rankings are available where bounded metadata is recorded.

A future human-readable search-intelligence design would require a separately governed privacy-safe query taxonomy, not silent recovery of raw text.

### 11.12 Zero-result searches

The count/rate is measurable from server events.

Human-readable “what exact words returned zero” is not currently available because raw query text is not retained.

Filter-based zero-result demand can be governed if the bounded filter metadata has sufficient coverage.

### 11.13 Abandonment

Canonical abandonment requires:

- named process;
- linked process/session instance;
- started state;
- completed state;
- explicit abandonment or timeout rule;
- time window;
- exclusions.

Current `process_step_recorded` supports explicit outcomes including abandoned, but Corporate abandonment rates remain PENDING_K2B and instrumentation-coverage certification.

### 11.14 Staff, bots, UAT, CI and unknown provenance

Corporate behavioral metrics must exclude or segment:

- CarUp staff/self traffic according to metric;
- bots/suspected bots;
- fixtures;
- synthetic certification;
- CI/UAT/automation;
- unknown provenance when Owner policy says unknown is not eligible for Actual.

Current marketplace event taxonomy has some exclusion flags. Navigation telemetry has coarse role but no accepted K2B provenance authority. **PC01-K2B-R1 remains the only parallel provenance authority and is not adopted by this document.**

---

## 12. Funnel and conversion semantics

There is no metric named simply `conversion`.

Every conversion metric ID must state:

- source population;
- destination outcome;
- linkage key/cohort;
- window;
- denominator policy.

Examples of future metric identities:

- `marketplace.funnel.search_to_detail.rate`
- `marketplace.funnel.detail_to_inquiry.rate`
- `marketplace.funnel.inquiry_start_to_submit.rate`
- `marketplace.funnel.inquiry_to_reservation.rate`
- `service.funnel.request_to_accept.rate`
- `trade.funnel.published_request_to_offer.rate`

### 12.1 Linked versus unlinked ratios

A linked conversion asks: “Of entities in stage A, how many of the **same cohort** reached B?”

An unlinked activity ratio asks: “How many B events occurred relative to A events in the same period?”

These are not the same.

Current `view_to_inquiry` marketplace projection uses period totals and may cap above 100 because inquiries can arrive through channels that bypass view instrumentation. Corporate Admin must not label that as a linked conversion rate.

### 12.2 Denominator floors

Current Intelligence uses minimum denominator 20 generally and smaller explicit floors in some verticals.

Corporate registry must store the floor per metric, not assume one global threshold.

Owner Decision `OD-CAMETRIC-025` governs cross-domain threshold policy.

---

## 13. Retention, churn and cohort semantics

Current repository has no canonical cross-company retention/churn/customer-health model.

Therefore:

- retention = UNAVAILABLE_NO_SOURCE until cohort definition exists;
- churn = UNAVAILABLE_NO_SOURCE;
- reactivation = UNAVAILABLE_NO_SOURCE;
- customer health score = DEPRECATED/UNAVAILABLE_NO_SOURCE.

Future definition must specify:

- customer grain;
- qualifying activity;
- acquisition/start cohort;
- observation windows;
- inactivity threshold;
- reactivation rule;
- business-unit versus corporate scope;
- anonymous treatment;
- provenance.

Status: `OD-CAMETRIC-016`.

---

## 14. Finance boundary for CA-FIN

This section names distinctions only. It does **not** define accounting recognition.

| Concept | Corporate semantic boundary | Current authority posture |
| --- | --- | --- |
| Listing price | Seller/provider asking price recorded on a listing/vehicle, in its recorded currency | Source may exist; Marketplace metric, not accounting |
| Merchandise/listing value | Aggregate asking value of a defined inventory cohort | Candidate only; must preserve currency and listing-state definition; not GMV |
| Requested budget | Amount a trade/finance applicant says they want to spend/borrow | Governed request amount where recorded; not transaction |
| Quote amount | Commercial offer/request value in source currency | Governed quote fact; not revenue |
| Payment intent | Record that a payment/escrow workflow was initiated | Operational fact; not cash |
| Escrow session | Governed transaction/escrow workflow state | Operational state; sandbox/live must stay separated |
| Sandbox escrow | Simulation state | **Never** GMV, settlement, cash or revenue |
| Escrow held | Actual customer/partner funds currently held under live governed provider authority | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE at snapshot** |
| Settlement | Confirmed movement/release under live settlement authority | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE at snapshot** |
| GMV candidate | Value of qualifying completed transactions facilitated by CarUp under a governed transaction definition | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** until completion/value authority is certified |
| Billing/invoice amount | Amount invoiced/billed under an authoritative billing source | Domain sources may exist, but no accepted corporate accounting authority |
| Recognized revenue | Amount earned by CarUp under CA-FIN recognition policy | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Refund | Governed reversal/refund under accounting/payment authority | **PENDING_CA_FIN**; sandbox/refund workflow state is not enough |
| Direct cost / COGS | Cost directly attributable to recognized revenue | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Gross profit | Recognized revenue less governed direct cost | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Operating expense | Governed accounting expense | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Operating profit | Governed accounting result | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Cash receipt / cash | Actual cash movement/balance under accounting/banking authority | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Receivable | Amount owed to CarUp under accounting authority | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |
| Payable / obligation | Amount CarUp owes under accounting authority | **PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE** |

### 14.1 Cross-currency rule

Until CA-FIN supplies governed FX:

- never sum monetary amounts across currencies;
- group by recorded currency;
- disclose unpriced/missing-currency records;
- do not infer currency from geography.

---

## 15. Time semantics

### 15.1 Timestamp authority

Every metric specifies one timestamp authority.

Examples:

- behavioral event → effective server-governed `occurred_at`;
- inquiry → authoritative `created_at`;
- listing publication → committed state-transition time;
- service request → `requested_at` where available;
- completion duration → governed start/completion timestamps;
- accounting metric → CA-FIN period authority.

### 15.2 Marketplace rollup clock

Current Intelligence daily rollups use **UTC day**.

Current windows include today where rows exist, but freshness checks target the most recent day reasonably expected to be complete.

Corporate reporting timezone remains `OD-CAMETRIC-007`.

### 15.3 Window comparability

Comparisons require:

- same metric ID;
- same lineage version;
- same inclusion/exclusion;
- same entity grain;
- same currency semantics;
- compatible period length;
- comparable provenance eligibility.

A 7-day trailing window cannot silently be compared with a calendar week and called “week over week”.

### 15.4 Partial periods

Current day/month/quarter must be marked partial unless compared to a comparably elapsed prior period.

---

## 16. Organisational and geographic dimensions

Consume CA-ORG / CA-ORG-01:

- Corporate parent;
- proven legal entity when available;
- BU;
- corporate function;
- department;
- team;
- region/country;
- cost centre;
- profit centre.

Metric dimensions must not invent organisation membership.

Examples:

- Marketplace BU demand may be scoped to `BU_MARKETPLACE`;
- Trust/Risk control metrics may be cross-BU matrix aggregates;
- Platform metrics belong to `CF_PLATFORM_TECH`;
- Finance & Accounting metrics belong to `CF_FINANCE_ACCOUNTING`, not automatically `BU_FINANCIAL_SERVICES`.

Cost/profit-centre dimensions are PENDING_CA_FIN.

Geography source remains `OD-CAMETRIC-006`.

---

## 17. RBAC and data classification

Consume CA-RBAC / CA-RBAC-01.

### 17.1 Aggregate versus drill-down

Each metric declares:

- aggregate permission;
- drill-down permission;
- classification.

Example:

`customer.active.count` may be visible under aggregate Customers & Growth permission, while underlying customer rows require `corporate.customer.pii.read`.

### 17.2 Restricted categories

- financial line items → Restricted Financial;
- identity/evidence/compliance records → Restricted Identity/Compliance;
- employee/private People rows → separately restricted People data;
- secrets/provider/security configuration → Restricted Security/Platform.

Metric certification does not grant record access.

### 17.3 Forbidden display

Caller authorization failure is FORBIDDEN, never a metric truth state.

---

## 18. Freshness and staleness

Every certified metric must declare:

- expected refresh cadence;
- source watermark;
- computed_at/as_of;
- stale-after threshold;
- partial-period status.

### 18.1 Current rollup pattern

`intelligence_rollup_runs` provides a good reusable freshness pattern.

### 18.2 Stale data

Stale but known data is not zero and not necessarily unavailable.

Corporate UX should show:

- last computed time;
- stale/degraded label;
- metric value only if policy permits stale display.

Owner Decision `OD-CAMETRIC-019` establishes cross-domain freshness targets.

---

## 19. Historical restatement and versioning

Any change to the following requires a governed revision:

- formula;
- numerator/denominator;
- entity grain;
- uniqueness;
- time window/period;
- timestamp authority;
- inclusion/exclusion;
- provenance eligibility;
- currency/unit;
- source authority;
- scope/dimensions;
- classification.

### 19.1 Recompute versus preserve

Derived rollups may be recomputed under a new version, but historical reports must preserve which version was used at publication time.

CA-REPORT must reference metric ID + lineage version.

Historical-restatement policy remains `OD-CAMETRIC-020`.

---

## 20. Corporate metric seed register

The following is a **governance seed**, not an implementation table and not an activation list.

| Metric ID | Definition | Truth / certification | Source posture | Future domain | Disposition |
| --- | --- | --- | --- | --- | --- |
| `corporate.account.registered.count` | Distinct base accounts | Candidate actual, PENDING_K2B | `users` | Corporate Overview / People | WRAP |
| `corporate.customer.count` | Owner-defined customer grain | BLOCKED | No canonical definition | Corporate Overview | NEW after OD |
| `corporate.customer.active.count` | Defined customers with qualifying activity/window | BLOCKED | No canonical definition | Corporate Overview / Growth | NEW after OD |
| `corporate.customer.verified.count` | Customer cohort meeting approved verification definition | BLOCKED | Identity sources exist; customer definition absent | Growth / Trust | NEW after OD |
| `marketplace.listing.public.count` | Current listings eligible/public under canonical state | Candidate actual, PENDING_K2B | vehicles/listing authority | Marketplace | WRAP |
| `marketplace.listing.created.count` | Listings created in period | Candidate actual, PENDING_K2B | vehicle row + transition event | Marketplace | WRAP |
| `marketplace.listing.published.count` | Listings entering published state in period | Candidate actual, PENDING_K2B | publication transition | Marketplace | WRAP |
| `marketplace.search.performed.count` | Governed marketplace search executions | Candidate derived, PENDING_K2B | activity ledger | Growth / Marketplace | WRAP |
| `marketplace.search.zero_result.count` | Governed search executions with zero results | Candidate derived, PENDING_K2B | activity ledger | Growth / Marketplace | WRAP |
| `marketplace.search.zero_result.rate` | Zero-result searches / searches | Candidate rate, PENDING_K2B | activity ledger | Growth / Marketplace | WRAP |
| `marketplace.listing.impression.count` | Qualified listing-card impressions | Candidate derived, PENDING_K2B | activity ledger | Marketplace | WRAP |
| `marketplace.listing.open.count` | Listing detail served with analytics context | Candidate derived, PENDING_K2B | server event | Marketplace | WRAP |
| `marketplace.listing.unique_viewer.daily.count` | Distinct governed viewer key within UTC day | Candidate derived, PENDING_K2B | daily rollup | Marketplace / Growth | REUSE |
| `marketplace.listing.unique_viewer.period.count` | True distinct viewers across period | UNAVAILABLE_NOT_SEPARABLE from current daily rollups | Future full-window identity aggregation | Growth | REPLACE current peak-day proxy |
| `marketplace.listing.peak_daily_unique_viewer.count` | Largest daily unique-viewer count in window | Governed derived candidate | current projection | Marketplace | RENAME/WRAP |
| `marketplace.listing.save.action.count` | Save actions recorded in period | Candidate derived, PENDING_K2B | activity ledger | Marketplace | WRAP |
| `marketplace.listing.watchlist.current.count` | Current saved-state rows for listing | Candidate actual snapshot, PENDING_K2B | `saved_vehicles` | Marketplace | WRAP |
| `marketplace.inquiry.qualifying.count` | Authoritative non-spam/non-rejected vehicle inquiries | Candidate actual, PENDING_K2B | `marketplace_inquiries` | Marketplace | REUSE |
| `marketplace.inquiry.start.count` | Instrumented inquiry-flow starts | Candidate behavioral, PENDING_K2B | activity ledger | Growth | WRAP |
| `marketplace.funnel.inquiry_start_to_submit.rate` | Linked inquiry starts reaching authoritative submission | BLOCKED until linkage/coverage certified | activity + inquiry authority | Growth | NEW |
| `marketplace.reservation.established.count` | Active reservation records established in period | Candidate actual, PENDING_K2B | `vehicle_reservations` | Marketplace Operations | WRAP |
| `marketplace.vehicle.sold_status_transition.count` | Vehicle/listing transition into normalized sold state | Candidate lifecycle metric, PENDING_K2B | vehicle/listing authority + event | Marketplace | WRAP; not completed sale/GMV |
| `marketplace.vehicle.completed_sale.count` | Completed CarUp-facilitated sales | UNAVAILABLE_NO_SOURCE | No certified completed-sale authority | Marketplace | BLOCKED |
| `growth.navigation.route_render.count` | Registered destination route renders | Candidate derived, PENDING_K2B | navigation events | Customers & Growth | NEW wrapper |
| `growth.navigation.item_impression.count` | Registered nav item impressions | Candidate derived, PENDING_K2B | navigation events | Customers & Growth | WRAP |
| `growth.navigation.item_selection.count` | Registered nav item selections | Candidate derived, PENDING_K2B | navigation events | Customers & Growth | WRAP |
| `growth.navigation.item_selection.rate` | Selections / impressions for same governed population | Candidate rate, PENDING_K2B | navigation events | Customers & Growth | REPLACE zero-denominator behavior |
| `growth.search.top_term.rank` | Human-readable top search terms | UNAVAILABLE_NOT_SEPARABLE | raw query text not stored | Customers & Growth | BLOCKED |
| `growth.customer.retention.rate` | Retained customer cohort rate | UNAVAILABLE_NO_SOURCE | no customer/retention model | Customers & Growth | BLOCKED |
| `growth.customer.churn.rate` | Churned customer cohort rate | UNAVAILABLE_NO_SOURCE | no churn model | Customers & Growth | BLOCKED |
| `dealer.inventory.current.count` | Current dealer tenant inventory | Candidate actual, PENDING_K2B | tenant-scoped vehicle inventory | Marketplace BU | REUSE source, not rollup active_listings |
| `dealer.completed_sale.count` | Completed dealer sales | UNAVAILABLE_NO_SOURCE | no certified authority | Marketplace BU | BLOCKED |
| `dealer.revenue.amount` | Recognized dealer/CarUp revenue for dealer scope | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | no accounting authority | Finance / BU | BLOCKED |
| `service.case.request.count` | Governed service cases requested | Candidate actual, PENDING_K2B | service_cases | Service Network BU | REUSE |
| `service.case.accepted.count` | Governed service cases accepted | Candidate actual, PENDING_K2B | service_cases | Service Network BU | REUSE |
| `service.case.booking.rate` | Accepted / requested service cases | Candidate rate, PENDING_K2B | service@2 | Service Network BU | REUSE |
| `service.case.turnaround.median_hours` | Median start→complete hours over measurable cases | Candidate derived, PENDING_K2B | service@2 | Service Network BU | REUSE with coverage |
| `service.capacity.utilisation.rate` | Used capacity / governed available capacity | UNAVAILABLE_NO_SOURCE | no capacity model | Service Network BU | BLOCKED |
| `finance_product.application.count` | Finance applications received | Candidate actual, PENDING_K2B | finance_applications | Financial Services BU | REUSE/WRAP |
| `finance_product.decision.recorded.count` | Applications with authoritative decision stamp/source | Candidate actual, PENDING_K2B | finance applications/decisions | Financial Services BU | REUSE |
| `finance_product.disbursement.amount` | Actual disbursed amount | UNAVAILABLE_NO_SOURCE | no disbursement state | Financial Services BU | BLOCKED |
| `insurance.eligibility.live_request.count` | Live provider eligibility requests | Candidate actual, PENDING_K2B | eligibility_requests live mode | Financial Services BU | WRAP |
| `insurance.policy.bound.count` | Policies actually bound through CarUp | UNAVAILABLE_NO_SOURCE | no authoritative binding through CarUp | Financial Services BU | BLOCKED |
| `trade.order.created.count` | Import orders created in scope/window | Candidate actual, PENDING_K2B | diaspora_import_orders | Diaspora Trade BU | REUSE |
| `trade.quote.accepted.count` | Accepted authoritative quote rows | Candidate actual, PENDING_K2B | diaspora_import_quotes | Diaspora Trade BU | REUSE |
| `trade.milestone.confirmed.count` | Confirmed payment milestones | Candidate actual if present, PENDING_K2B | diaspora_payment_milestones | Diaspora Trade BU | REUSE |
| `trade.settled_value.amount` | Value of live confirmed trade settlement | UNAVAILABLE_NO_SOURCE at snapshot | no confirmed live settlement | Diaspora / Finance | BLOCKED |
| `trade.requested_budget.amount_by_currency` | Requested order budgets grouped by recorded currency | Candidate actual request amount, PENDING_K2B | order rows | Diaspora Trade BU | REUSE, not GMV |
| `parts.rfq.request.count` | Qualifying parts RFQs | Candidate actual, PENDING_K2B | marketplace_inquiries | Service Network BU | WRAP |
| `parts.partsentry.verified.count` | PartSentry logs with verified part status | Candidate actual, PENDING_K2B | partsentry_logs | Service / Trust | REUSE |
| `parts.inventory.stock_value.amount` | Recorded unit price × recorded stock for priced rows | Candidate derived, PENDING_K2B | mechanic_parts | Service Network BU | WRAP with coverage and currency policy |
| `referral.event.count` | Events in explicit referral-domain taxonomy | Candidate derived, PENDING_K2B | referral_events filtered set | Customers & Growth | WRAP |
| `referral.inquiry.attributed.count` | Inquiries carrying referral code | Candidate actual/derived with attribution caveats, PENDING_K2B | marketplace_inquiries | Customers & Growth | WRAP |
| `referral.completed_sale.attributed.count` | Completed sales attributable to referral | UNAVAILABLE_NO_SOURCE | sale linkage absent | Customers & Growth | BLOCKED |
| `risk.identity.pending_review.count` | Identity sessions pending governed review | Candidate actual, PENDING_K2B | verification_sessions | Trust/Risk/Compliance | WRAP |
| `risk.evidence.pending_review.count` | Evidence awaiting governed review | Candidate actual, PENDING_K2B | vehicle_evidence | Trust/Risk/Compliance | WRAP |
| `risk.fraud.open_case.count` | Open fraud cases under governed case status | Candidate actual, PENDING_K2B | fraud_cases | Trust/Risk/Compliance | WRAP |
| `risk.fraud.interception.rate` | Governed prevented/eligible fraudulent outcomes | UNAVAILABLE_NO_SOURCE | denominator/outcome authority absent | Trust/Risk/Compliance | DEPRECATE current fiction |
| `communications.thread.open.count` | Open communication threads under governed status | Candidate operational, PENDING_K2B | message_threads | Operations | WRAP |
| `communications.queue.dead_letter.count` | Dead-letter notifications | TECHNICAL_OPERATIONAL | notification_queue | Platform | WRAP |
| `communications.response.first.median_minutes` | Median first-response time over complete governed sample | Candidate derived only after complete-window source | threads | Operations | REPLACE capped user analytics for Corporate |
| `platform.feature.override.active.count` | Active governed feature override records | TECHNICAL_OPERATIONAL | feature_rollout_overrides | Platform | NEW/WRAP if management need exists |
| `platform.runtime.uptime.rate` | Availability over governed observation interval | UNAVAILABLE_NO_SOURCE | no accepted uptime authority | Platform | BLOCKED |
| `ai.model.accuracy.rate` | Model task accuracy against governed evaluation set | UNAVAILABLE_NO_SOURCE unless model-specific certification exists | none corporate-wide | Data & Intelligence | BLOCKED |
| `corporate.revenue.recognized.amount` | Accounting-recognized CarUp revenue | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | no accepted accounting authority | Finance | BLOCKED |
| `corporate.gmv.amount` | Value of qualifying completed facilitated transactions | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | transaction completion/value authority unresolved | Finance / Overview | BLOCKED |
| `corporate.gross_profit.amount` | Recognized revenue less governed direct cost | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | accounting authority absent | Finance | BLOCKED |
| `corporate.cash.amount` | Governed cash position under accounting/banking authority | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | no accepted source | Finance | BLOCKED |
| `corporate.receivable.amount` | Amount owed to CarUp | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | no accepted source | Finance | BLOCKED |
| `corporate.payable.amount` | Amount CarUp owes | PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE | no accepted source | Finance | BLOCKED |

---

## 21. Owner Decision Register

| Decision ID | Question | Why it matters | Affected agents | Safe default | MUST NOT be assumed |
| --- | --- | --- | --- | --- | --- |
| `OD-CAMETRIC-001` | What exactly is a Corporate “customer”? | Account/tenant/visitor are not equivalent | CA-GROWTH, CA-BU, CA-UX, CA-REPORT | Do not publish customer count | Do not equate `users` or tenants with customers |
| `OD-CAMETRIC-002` | What qualifies an active customer and over what window? | Drives MAU/active/retention metrics | CA-GROWTH, CA-UX, CA-REPORT | No active-customer KPI | Do not define activity as any page view |
| `OD-CAMETRIC-003` | What does “verified customer” mean? | Identity/account/dealer/vehicle verification differ | CA-GROWTH, CA-RBAC, CA-CERT | Keep verification dimensions separate | Do not use one generic verified flag |
| `OD-CAMETRIC-004` | What constitutes a paying customer? | Requires financial relationship authority | CA-FIN, CA-GROWTH, CA-REPORT | PENDING_CA_FIN | Do not infer from application/order/escrow intent |
| `OD-CAMETRIC-005` | How are buyer and seller customer cohorts defined? | Roles/journeys overlap | CA-GROWTH, CA-BU | Use domain actions separately | Do not equate `owner` with buyer |
| `OD-CAMETRIC-006` | What is the authoritative geography source for customer/business reporting? | IP, address, tenant, order destination mean different things | CA-GROWTH, CA-FIN, CA-REPORT | Use source-specific geography only | Do not infer geography from one incidental field |
| `OD-CAMETRIC-007` | What Corporate reporting timezone applies? | Current rollups use UTC | CA-FIN, CA-REPORT, CA-UX | Preserve UTC source grain and label it | Do not silently localize period boundaries |
| `OD-CAMETRIC-008` | What are standard management reporting periods? | Needed for comparable charts/reports | CA-REPORT, CA-UX, CA-FIN | Keep exact rolling/calendar labels | Do not call 30 days “month” |
| `OD-CAMETRIC-009` | What fiscal calendar applies? | Finance/board reporting | CA-FIN, CA-REPORT | PENDING_CA_FIN | Do not assume calendar year |
| `OD-CAMETRIC-010` | Which funnel(s) own the word “conversion”? | There is no universal denominator | CA-GROWTH, CA-BU, CA-UX | Use named stage-to-stage metrics only | Do not publish generic conversion |
| `OD-CAMETRIC-011` | What is authoritative “sold vehicle” for management reporting? | Sold status may not equal completed CarUp transaction | CA-BU, CA-FIN, CA-GROWTH | Treat sold-status transition as lifecycle only | Do not call it completed sale/GMV |
| `OD-CAMETRIC-012` | What source establishes completed CarUp-facilitated transaction value? | Needed for GMV | CA-FIN, CA-BU, CA-REPORT | GMV unavailable | Do not sum listing prices, requested amounts or sandbox settlements |
| `OD-CAMETRIC-013` | What is the accounting source of recognized revenue? | Executive finance KPI | CA-FIN, CA-REPORT | PENDING_CA_FIN | Do not infer fees/cash from product workflow |
| `OD-CAMETRIC-014` | What is the governed gross-profit definition and direct-cost source? | Board/BU contribution | CA-FIN, CA-REPORT | PENDING_CA_FIN | Do not invent margin formula/source |
| `OD-CAMETRIC-015` | Who is accountable business owner for each BU scorecard family? | Registry needs accountable semantic owner | CA-ORG, CA-BU, CA-REPORT | Use proposed BU/function placeholders | Do not infer job title/incumbent |
| `OD-CAMETRIC-016` | What are retention, churn and reactivation definitions? | Customer-health metrics absent | CA-GROWTH, CA-REPORT | Unavailable | Do not use inactivity heuristics without authority |
| `OD-CAMETRIC-017` | What is the canonical acquisition-attribution model? | Referral/comms/source coverage differs | CA-GROWTH, CA-REPORT | Show source-specific coverage only | Do not present partial attribution as complete |
| `OD-CAMETRIC-018` | What attribution window/model applies: first touch, last touch, multi-touch, referral-specific? | Changes channel performance materially | CA-GROWTH, CA-FIN | No corporate ROI/conversion attribution | Do not select model by convenience |
| `OD-CAMETRIC-019` | What freshness/staleness threshold applies per metric family? | Sources refresh differently | CA-UX, CA-REPORT, CA-CERT | Show source `as_of` and degrade when known incomplete | Do not use one global stale threshold |
| `OD-CAMETRIC-020` | When definitions change, are historical periods restated under new version or preserved as originally published? | Trend comparability/report reproducibility | CA-REPORT, CA-CERT | Preserve published version; new version explicit | Do not silently rewrite reports |
| `OD-CAMETRIC-021` | How must UNKNOWN provenance be treated in executive metrics after K2B? | Unknown may contaminate Actual | K2B, CA-CERT, CA-UX | Exclude from Actual / surface coverage loss until Owner decides | Do not silently count UNKNOWN as real |
| `OD-CAMETRIC-022` | May provisional/PENDING_K2B metrics appear in executive views? | Risk of decision-making on uncertified data | CA-UX, CA-CERT | No headline Actual; allow diagnostics only with explicit label | Do not render provisional as Actual |
| `OD-CAMETRIC-023` | What FX/cross-currency policy applies? | Trade/referral/parts amounts may have multiple currencies | CA-FIN, CA-REPORT | Group by source currency only | Do not sum across currencies |
| `OD-CAMETRIC-024` | How is navigation identity/uniqueness defined across web/native, logout and devices? | Affects unique visitor and funnel claims | CA-GROWTH, CA-CERT | Use current source-specific pseudonymous keys and disclose limitation | Do not claim unique people cross-device |
| `OD-CAMETRIC-025` | What denominator floors apply to each rate/ratio family? | Prevents misleading small-sample percentages | CA-BU, CA-GROWTH, CA-CERT | Preserve current source-specific floors; Corporate metric registers exact floor | Do not apply one arbitrary global floor |
| `OD-CAMETRIC-026` | What minimum volume is required before a “top route/search/feature” rank is management-worthy? | Avoids vanity rankings on tiny samples | CA-GROWTH, CA-UX | No rank without volume/coverage disclosure | Do not rank single-digit noise |
| `OD-CAMETRIC-027` | Should human-readable search terms ever be retained in a privacy-safe governed taxonomy? | Current source stores hashes, not raw text | CA-GROWTH, CA-PLAT, CA-CERT | Keep top terms unavailable; use filter/search-signature aggregates | Do not reconstruct raw text |
| `OD-CAMETRIC-028` | How is listing supply defined: public, publishable, active, available-for-sale, or inventory-owned? | Current “active_listings” rollup is not inventory | CA-BU, CA-GROWTH | Use explicitly named publication/inventory states | Do not use rollup active_listings as dealer inventory |
| `OD-CAMETRIC-029` | What constitutes a lead across Marketplace, Service, Finance, Insurance and Trade? | Domain rows differ | CA-GROWTH, CA-BU | Use domain-specific inquiry/application/request metric IDs | Do not create one “leads” total |
| `OD-CAMETRIC-030` | What is the canonical service-quality score, if any? | Current source supports cycle/backlog but not one quality index | CA-BU, CA-UX | No synthetic score; show component metrics | Do not average unrelated service metrics |
| `OD-CAMETRIC-031` | What risk/compliance backlog belongs on Corporate Overview? | Multiple queues have different severity/ownership | CA-RBAC, CA-BU, CA-UX | Show named queue counts separately | Do not sum all review items into one risk number |
| `OD-CAMETRIC-032` | What business target/budget authority exists for red/green variance? | Color/status requires baseline | CA-FIN, CA-BU, CA-UX | No target delta without governed target | Do not infer good/bad from direction alone |
| `OD-CAMETRIC-033` | What source defines institutional/customer organisation counts in Corporate reporting? | Legacy organizations and tenants overlap | CA-ORG, CA-GROWTH | Keep source names explicit | Do not count duplicate representations as distinct customers |
| `OD-CAMETRIC-034` | What coverage threshold allows partial-source attribution/distributions to be shown? | Source/channel fields may be sparse | CA-GROWTH, CA-CERT | Show coverage and avoid whole-population claim | Do not normalize partial data to 100% without label |
| `OD-CAMETRIC-035` | Which report publication values may use stale-but-certified data? | Reports may run after source delay | CA-REPORT, CA-CERT | Block sensitive report publication when freshness policy fails | Do not silently use stale data |
| `OD-CAMETRIC-036` | What is the Corporate policy for partial current periods versus completed periods? | Affects trends and deltas | CA-REPORT, CA-UX | Mark partial explicitly; compare like-for-like elapsed periods only | Do not compare partial month to full prior month as equivalent |

---

## 22. Dashboard contract for CA-UX

CA-UX must not need to infer metric truth.

Every rendered metric receives:

- value or null;
- display state;
- unit/currency;
- period/window;
- as-of/freshness;
- truth state;
- lineage version;
- caveat/coverage where material;
- comparison basis if present;
- permission-aware drill-down target.

Binding display rules:

1. measured zero may display 0;
2. NO DATA displays as such;
3. UNAVAILABLE displays reason/category, never 0;
4. NOT SEPARABLE states the segmentation limitation;
5. FORBIDDEN follows RBAC and is not a data placeholder;
6. stale values display freshness;
7. provisional/advisory data is visibly labeled;
8. currency/time units are explicit;
9. comparisons require compatible versions/periods;
10. aggregate cards do not grant source-record access;
11. red/green performance semantics require governed target/baseline;
12. AI/advisory text must not convert unavailable metrics into estimates.

---

## 23. Downstream inputs

### 23.1 CA-FIN / CA-FIN-01

Consume section 14 and all `PENDING_CA_FIN` entries.

CA-FIN must establish:

- transaction completion/value authority;
- GMV definition;
- revenue recognition;
- direct cost;
- gross profit/margin;
- operating expense/profit;
- cash;
- receivables/payables;
- settlement/escrow accounting;
- FX/currency policy;
- fiscal periods;
- cost/profit-centre semantics.

CA-METRIC does not pre-empt those formulas.

### 23.2 CA-GROWTH / CA-GROWTH-01

Consume:

- customer/entity grain contract;
- Navigation versus marketplace activity separation;
- funnel linkage rules;
- acquisition/referral coverage;
- top routes/search semantics;
- active/retention/churn Owner Decisions.

### 23.3 CA-BU

Consume:

- BU scorecard standard slots;
- domain-specific metric seed;
- explicit unavailable slots;
- ownership/stewardship requirements.

Do not invent missing KPI families to make scorecards visually complete.

### 23.4 CA-UX / CA-UX-01

Consume dashboard contract in section 22 and the registry display-state semantics.

### 23.5 CA-REPORT

Consume:

- metric ID + lineage version;
- exact period;
- as-of/freshness;
- unavailable semantics;
- historical-restatement policy;
- classification/export permissions.

Every published management report must be reproducible against the metric version it cites.

### 23.6 CA-PLAT

Consume:

- scalable aggregation requirements;
- technical-operational versus business KPI separation;
- complete-window/freshness requirements;
- no silent row-cap truncation;
- K2B integration boundary.

### 23.7 CA-CERT / CA-CERT-01

Certification must reject any metric where:

- source cannot be reproduced;
- unavailable can become zero;
- provenance is not accepted;
- formula/version is ambiguous;
- cross-currency amounts are silently summed;
- rate denominator is missing;
- unique grain is mislabeled;
- current source is silently truncated;
- drill-down bypasses RBAC;
- current data is compared to incompatible historical definition.

---

## 24. PENDING_K2B register

The following families remain PENDING_K2B for Corporate Actual activation at minimum:

- marketplace behavioral ledger metrics;
- versioned marketplace rollups where business/test provenance eligibility must be certified;
- listing/inquiry/reservation counts where non-business fixtures/history may coexist;
- Navigation Analytics;
- Dealer demand/intelligence;
- Service/Garage operational metrics;
- Finance/Insurance live-versus-sandbox demand counts where operational provenance must be certified;
- Trade/Logistics operational records;
- PartSentry/parts operational counts;
- Referral events/attribution;
- Trust/identity/fraud/compliance aggregate counts;
- Communications business/queue metrics;
- any Corporate Overview count sourced from product operational tables.

This registry does not classify rows or adopt PC01-K2B-R1 implementation details.

---

## 25. PENDING_CA_FIN register

Until CA-FIN establishes source and accounting semantics, these remain unavailable for Corporate Actual:

- GMV;
- recognized revenue;
- direct cost / COGS;
- gross profit;
- gross margin;
- operating expense;
- operating profit;
- net profit;
- cash receipts/balance;
- escrow held as accounting balance;
- live settlement exposure;
- receivables;
- payables/obligations;
- refund accounting;
- dealer/BU revenue;
- finance disbursement/portfolio value;
- trade settled value;
- cross-currency consolidated monetary totals.

Product-domain amounts such as listing price, requested loan amount, order budget, quote amount, scheduled milestone and accrued referral reward remain named exactly as those concepts and are not upgraded into accounting metrics.

---

## 26. Open risks and collisions

### 26.1 Duplicate Marketplace analytics

Legacy Admin analytics and versioned Intelligence can produce adjacent listing/inquiry views with different grains/windows. Corporate Admin must select registry semantics, not whichever endpoint is easiest.

### 26.2 “Unique” overstatement

Current multi-day marketplace projection exposes a peak-day unique proxy. Corporate Admin must rename or replace it rather than call it period unique.

### 26.3 Conversion overstatement

Independent period totals can yield ratios over 100 and are currently capped. Corporate conversion requires linked cohorts; capping does not make an unlinked ratio a conversion metric.

### 26.4 Navigation truncation

Current 50,000-row aggregate cap can silently undercount large windows. Certification must detect completeness.

### 26.5 Zero-denominator rates

Navigation and Communications current helpers can emit 0 when no denominator exists. Corporate registry must convert this to NO DATA/INSUFFICIENT_DATA.

### 26.6 Sandbox promotion

Finance, insurance, trade and escrow sources contain sandbox activity. Sandbox may be operationally useful but never business Actual demand/payment/revenue unless explicitly labeled as simulation.

### 26.7 Asking/requested values promoted to GMV

Listing price, loan requested amount, trade budget and quote amount are not completed transaction value.

### 26.8 Partial attribution

Referral/communications source fields have incomplete coverage. A partial source distribution cannot be normalized into “all acquisition”.

### 26.9 Trust-domain conflation

Identity verification, vehicle evidence, Trust Facts, fraud, dealer compliance and PartSentry are separate authorities.

### 26.10 Technical telemetry promoted to executive health

Queue depth, provider configured state, process-memory counters and feature overrides are not platform reliability or customer-health KPIs.

### 26.11 K2B collision

This document defines which provenance classes a metric requires. It does not define the runtime classifier.

---

## 27. Stop conditions encountered

CA-METRIC encountered several questions that cannot safely be answered from repository evidence:

- customer/active/paying customer definitions;
- universal conversion funnel;
- sold/completed-transaction authority;
- GMV and accounting sources;
- retention/churn;
- acquisition model/window;
- Corporate reporting timezone/fiscal period;
- true period uniqueness across devices;
- human-readable top search terms;
- target/budget semantics;
- cross-currency conversion;
- accepted operational provenance under active K2B.

These were converted into `OD-CAMETRIC-*` decisions or `PENDING_K2B / PENDING_CA_FIN` states rather than guessed.

No product code, database, analytics event, deployment, production data, K2B classifier or dashboard was modified.

---

## 28. Recommended next task

Subject to CA-MOD independent review of CA-METRIC-01:

1. **CA-FIN / CA-FIN-01** should establish the accounting/management-finance source and semantic boundary using section 14 and the PENDING_CA_FIN register.
2. **CA-GROWTH / CA-GROWTH-01** should establish the customer/funnel/acquisition/retention definitions using sections 9–13.
3. **CA-UX / CA-UX-01** should consume only accepted metric semantics and the display-state contract; it must not invent missing KPIs to complete layouts.
4. **CA-CERT / CA-CERT-01** should later certify metric source, formula, provenance, time, access and version identity before any metric is activated as Corporate Actual.

This document does not self-accept.

CA-METRIC-01 CORPORATE METRIC REGISTRY READY FOR MODERATOR REVIEW

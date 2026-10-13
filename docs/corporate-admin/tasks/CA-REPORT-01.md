# CA-REPORT-01 — CORPORATE MANAGEMENT REPORTING / SNAPSHOT / PUBLICATION AUTHORITY

FROM: CA-MOD — Corporate Admin Programme Moderator
TO: CA-REPORT — Management Reporting & Publication Agent
TASK: CA-REPORT-01
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
- CA-BU-01 ACCEPTED: f73472378cffe81c9bdd981d77e085809ad5c5dd
- K2B operational-provenance authority ACCEPTED/FROZEN: 7b34dec1bc9f05b72b6abf0104db65980f280a0b
- Current documentation programme head: f73472378cffe81c9bdd981d77e085809ad5c5dd

## Parallel implementation lane

CA-K3-01 is ACTIVE in the web lane.

CA-REPORT-01 is documentation/reporting-governance work only and must not collide with CA-K3-01.

Read and obey in full:

- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md
- docs/corporate-admin/CARUP_CORPORATE_FINANCE_MODEL.md
- docs/corporate-admin/CARUP_CUSTOMER_GROWTH_INTELLIGENCE_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_UX_ARCHITECTURE.md
- docs/corporate-admin/CARUP_BUSINESS_UNIT_MANAGEMENT_MODEL.md

---

## MODERATOR AUTHORITY

AUTHORIZED — REPORTING ARCHITECTURE / SNAPSHOT / PUBLICATION GOVERNANCE / DOCUMENTATION ONLY

NO WEB IMPLEMENTATION.
NO BACKEND IMPLEMENTATION.
NO DATABASE MIGRATION.
NO REPORT GENERATION CODE.
NO METRIC RECOMPUTATION.
NO FINANCE OR CUSTOMER POLICY INVENTION.
NO K2B MUTATION.
NO PRODUCTION.

---

## 1. Objective

Define the canonical Corporate Management Reporting authority for CarUp.

The model must establish how recurring management reports are defined, snapshotted, reviewed, approved, published, reproduced and audited without allowing reports to invent or silently alter metric truth.

At minimum cover:

- Daily Operations;
- Weekly BU Review;
- Monthly Executive Review;
- Quarterly Board / Strategy;
- Compliance / Risk;
- ad-hoc governed reports.

Reports are first-class governed artifacts, not screenshots of dashboards.

---

## 2. Core reporting principles

Reports must preserve:

- exact metric identity/version;
- exact source authority;
- exact reporting period;
- scope / BU / function / geography;
- K2B provenance state;
- truth/availability state;
- currency/unit;
- freshness / as-of time;
- report generation timestamp;
- reviewer/approver/publisher custody;
- classification / export restriction;
- reproducibility.

A report must not:

- recompute a KPI in the report layer;
- replace unavailable with 0;
- hide degraded source state;
- promote candidate metrics to Actual;
- invent narrative causality;
- infer customer or finance semantics beyond accepted authority;
- silently change metric version between draft and publication.

---

## 3. Report registry

Define a canonical Report Definition Registry.

Each report definition must include at minimum:

- report_id;
- report_family;
- title;
- purpose / management question;
- intended audience/capability archetypes;
- owner function/BU;
- cadence;
- reporting timezone/period policy;
- scope model;
- metric set with exact registry IDs/versions;
- required/optional sections;
- source freshness requirements;
- truth-state rules;
- provenance requirements;
- classification;
- drill-down links where permitted;
- generate/review/approve/publish permissions;
- retention policy placeholder;
- export formats allowed;
- report-definition version;
- certification state.

Do not encode specific metric values in the report definition.

---

## 4. Report instance / snapshot contract

Define the canonical immutable Report Instance / Snapshot model.

Each generated report must bind:

- report_definition_id + version;
- instance_id;
- generated_at;
- reporting period start/end;
- scope snapshot;
- metric IDs/versions;
- actual metric outputs or explicit unavailable states;
- source/as-of metadata;
- K2B/provenance summary;
- comparison period where valid;
- currency/unit;
- data-quality flags;
- narrative annotations and their authority;
- generated_by;
- review state;
- approval state;
- publication state;
- publication timestamp;
- supersession/restatement lineage.

A published report must remain reproducible even if live dashboards later change.

Define snapshot-versus-live-link semantics explicitly.

---

## 5. Report lifecycle

Consume CA-UX.

Canonical lifecycle:

Draft → Generated → In Review → Approved → Published

Also define:

- Rejected / Returned for correction;
- Superseded;
- Withdrawn where policy permits;
- Restated.

State transitions must identify:

- who may perform them;
- whether content/metric snapshot may still change;
- audit requirements;
- whether a new report instance/version is required.

Do not assume the same user can generate, approve and publish.

---

## 6. Segregation of duties

Consume CA-RBAC and CA-FIN.

Define conceptual permissions for:

- create report definition;
- generate report instance;
- review report;
- approve report;
- publish report;
- withdraw/supersede;
- export;
- view restricted appendices;
- edit management commentary.

Design SoD guidance such that high-stakes reports can separate preparer/reviewer/approver/publisher.

Mark Owner decisions where policy is unresolved.

---

## 7. Daily Operations report

Define Daily Operations as an operational management report, not an executive financial statement.

Potential sections:

- queue/backlog state;
- operational throughput;
- aging/cycle-time;
- exceptions;
- source degradation;
- risk/compliance blockers;
- outstanding actions.

Use source-accurate metrics only.

Do not include unavailable finance KPIs merely for completeness.

---

## 8. Weekly BU Review

Consume CA-BU exactly.

For each BU, define a reproducible Weekly BU Review template with:

- BU ID/label;
- reporting period;
- management context;
- demand/activity;
- supply/capacity;
- throughput/journey;
- quality/trust/compliance;
- backlog/cycle time;
- geography where authoritative;
- finance/commercial state where governed;
- data quality/provenance;
- key changes;
- actions/escalations;
- decisions required.

Respect per-BU metric eligibility.

`CANDIDATE_AFTER_K2B_CONSUMPTION` must not silently appear as Actual.

---

## 9. Monthly Executive Review

Define a concise Corporate management report with:

- Corporate Overview;
- BU material changes;
- Customers & Growth state;
- Finance state;
- Operations exceptions;
- Trust/Risk/Compliance;
- Data/Intelligence quality;
- People/Access items where material;
- strategic decisions requested.

Where finance/customer KPIs are unavailable, preserve blocked/unavailable states.

Do not fabricate management deltas where comparison is invalid.

---

## 10. Quarterly Board / Strategy report

Define a higher-level strategic report architecture.

Potential sections:

- strategic context;
- BU trajectory;
- market/demand signals;
- governed financial state;
- risk/compliance;
- operational capability;
- major data/authority gaps;
- strategic opportunities and decisions.

Do not create statutory financial reporting or legal board obligations unless authority exists.

Board/Strategy is a management-report family, not a claim of legal corporate filing.

---

## 11. Compliance / Risk report

Consume CA-RBAC and Trust/Risk architecture.

Define aggregate report sections for:

- verification/evidence workload;
- fraud/compliance cases;
- governance review;
- dealer/garage compliance;
- provenance/UNKNOWN backlog;
- aging/trend;
- restricted appendices where separately authorized.

Aggregate visibility must not imply access to raw KYC/PII/evidence.

---

## 12. Ad-hoc governed reporting

Define a safe ad-hoc reporting model.

Users may select only:

- metrics already registered;
- dimensions the metric supports;
- periods the metric supports;
- scopes they are authorized to access.

Ad-hoc reporting must not allow:

- arbitrary formulas;
- raw SQL;
- ungoverned joins;
- unauthorized PII exports;
- mixing incompatible metric versions;
- converting candidate/unavailable values into Actual.

---

## 13. Narrative / commentary authority

Define separate treatment for:

- factual metric narrative;
- human management commentary;
- advisory AI-generated commentary if ever enabled.

AI narrative must be clearly advisory and must never overwrite metric truth or approval state.

Human commentary should carry author/timestamp and not alter metric snapshots.

Do not create AI commentary by default.

---

## 14. Comparison / variance rules

Consume CA-METRIC and CA-UX.

Report deltas/variance may appear only when:

- same metric identity/version or approved comparable versions;
- compatible population/scope;
- comparable periods;
- adequate source completeness;
- same unit/currency basis.

Otherwise show comparison unavailable/incomparable.

Do not auto-compute percent change on zero/undefined denominators without governed rule.

---

## 15. Finance reporting boundary

Consume CA-FIN.

Reports must not create:

- GMV;
- recognized revenue;
- gross profit;
- operating profit;
- cash;
- AR/AP;
- take rate;
- contribution margin

until CA-FIN establishes source authority.

Product amounts can appear only with exact product labels and source context.

Cross-currency aggregation requires accepted FX authority.

---

## 16. Customer/Growth reporting boundary

Consume CA-GROWTH.

Do not report:

- universal customer count;
- active customer;
- transacting customer;
- CAC/LTV/ROAS/ARPU;
- retention/churn;
- acquisition attribution

unless the corresponding Owner/source authority is accepted.

Use source-accurate labels such as accounts, inquiries, participants, buyers/sellers, work-order customers, Trade buyers where valid.

---

## 17. K2B provenance boundary

K2B is accepted/frozen.

Corporate/BU Actual in reports must include operational eligible records only.

Non-operational classes and UNKNOWN must not enter Actual.

Report snapshots should record provenance state and, where relevant, excluded/UNKNOWN counts.

If a metric source path is not certified to consume K2B, preserve its candidate/pending state.

Do not reclassify rows in the report layer.

---

## 18. Report freshness / completeness

Define report-generation rules for:

- all sources current;
- one source stale;
- source unavailable;
- incomplete bounded source;
- partial period;
- mixed freshness.

A report may still generate with degraded/unavailable sections if policy permits, but it must disclose this prominently.

Define which failures should block publication versus allow publication with caveat as Owner decisions.

---

## 19. Restatement / supersession

Define how reports behave when:

- source correction occurs;
- metric version changes;
- provenance correction occurs;
- late-arriving data appears;
- accounting policy later changes;
- report commentary is corrected.

Never mutate a published report in place without audit.

Prefer immutable supersession/restatement lineage.

---

## 20. Report exports

Define export governance for:

- web view;
- PDF/print;
- CSV/tabular extracts where permitted;
- future presentation/slide pack.

Exports must preserve:

- report ID/version;
- period;
- scope;
- metric versions;
- as-of/generated time;
- classification;
- truth/degraded states;
- provenance/currency context.

Export permission is separate from report-read permission.

Do not require implementation in this task.

---

## 21. Report archive / search

Define metadata required to find historical reports by:

- family;
- BU/function;
- period;
- publication state;
- publisher;
- version;
- classification.

Historical report view must show whether a newer report/restatement supersedes it.

---

## 22. Corporate Overview / dashboard relationship

Define the relationship:

- dashboards = current/live governed views;
- reports = period-bound reproducible governed artifacts.

A report may deep-link to current dashboard drill-down, but that live view must be labelled current and must not replace the report's snapshotted facts.

Do not treat screenshot capture as report authority.

---

## 23. Owner Decision Register

Create OD-CAREPORT-* decisions for unresolved reporting policy.

At minimum consider:

- final report families/cadences;
- reporting timezone;
- fiscal/calendar period conventions;
- report owner/publisher roles;
- SoD strictness by report family;
- publication-blocking source failures;
- acceptable stale-source thresholds;
- partial-period publication;
- materiality thresholds;
- restatement policy;
- report retention;
- export formats;
- external sharing policy;
- board/strategy audience;
- management commentary policy;
- AI advisory commentary policy;
- report approval SLA;
- classification labels;
- report archival duration;
- whether published reports may be withdrawn;
- whether unavailable strategic slots remain visible.

Do not guess.

---

## 24. Required deliverable

Create only:

docs/corporate-admin/CARUP_CORPORATE_REPORTING_MODEL.md

Must include:

1. authority/custody;
2. reporting principles;
3. Report Definition Registry;
4. Report Instance/Snapshot contract;
5. lifecycle/state machine;
6. SoD/access model;
7. Daily Operations template;
8. Weekly BU Review template;
9. Monthly Executive Review template;
10. Quarterly Board/Strategy template;
11. Compliance/Risk template;
12. ad-hoc reporting model;
13. narrative/commentary model;
14. comparison/variance rules;
15. finance/growth/K2B boundaries;
16. freshness/completeness model;
17. restatement/supersession model;
18. export governance;
19. archive/search model;
20. dashboard/report relationship;
21. Owner Decision Register;
22. downstream inputs for CA-PLAT, CA-CERT and K3 implementation;
23. open risks;
24. recommended next task.

---

## 25. Parallel-lane rule

CA-K3-01 remains active.

CA-REPORT must not:

- modify web code;
- request implementation of reports inside active K3-01;
- alter truth-state components;
- add backend/report tables;
- change current routes.

Any implementation dependency should be recorded for later CA-MOD dispatch.

---

## 26. Repository scope

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

## 27. Stop conditions

STOP rather than guess if:

- a report requires a metric not in CA-METRIC;
- publication requires finance/customer policy not accepted;
- reporting period policy is unresolved;
- metric versions are incomparable;
- report generation would require new backend/schema implementation;
- a report would expose restricted detail beyond CA-RBAC;
- a statutory/legal reporting claim would be required.

---

## 28. Return receipt

Return:

AGENT: CA-REPORT
TASK: CA-REPORT-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES / SYSTEMS INSPECTED
FILES CHANGED
REPORT REGISTRY SUMMARY
SNAPSHOT / REPRODUCIBILITY CONTRACT
LIFECYCLE / SOD MODEL
REPORT FAMILY TEMPLATES
FINANCE / GROWTH / K2B BOUNDARIES
OWNER DECISIONS REQUIRED
OPEN RISKS
DOWNSTREAM INPUTS
STOP CONDITIONS
RECOMMENDED NEXT TASK

Final line exactly:

CA-REPORT-01 CORPORATE REPORTING MODEL READY FOR MODERATOR REVIEW

Do not self-accept.
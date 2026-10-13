
# CARUP CORPORATE REPORTING MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-REPORT — Management Reporting & Publication Agent  
Task: CA-REPORT-01  
Status: REPORTING GOVERNANCE / SNAPSHOT / PUBLICATION AUTHORITY ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This Corporate Reporting Model is produced under the following accepted authorities:

- Canonical programme plan: \`docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md\`
- Accepted CA-ARCH-01 authority: \`7cae8c3c8c987714a8ca6db2128db3b9a589f141\`
- Accepted CA-ORG-01 authority: \`705eb6fa1cd89109977052e88e220f0498668060\`
- Accepted CA-RBAC-01 authority: \`4abdf95e1e1490b01f51cb45106a57fcf7b954b9\`
- Accepted CA-METRIC-01 authority: \`32c26ce5d89ec3829e2afa9248d1e77a2cb4c784\`
- Accepted CA-FIN-01 authority: \`9ba7388559fa13cf353e410ce2a62be30660bdeb\`
- Accepted CA-GROWTH-01 authority: \`f7e4c0519411994383d8d3e316c10b380f0e728d\`
- Accepted CA-UX-01 authority: \`336c6d6015b6c2a4851fb1171642bcc5e93adcdf\`
- Accepted CA-BU-01 authority: \`f73472378cffe81c9bdd981d77e085809ad5c5dd\`
- Accepted/frozen K2B authority: \`7b34dec1bc9f05b72b6abf0104db65980f280a0b\`
- Current documentation starting head supplied by CA-MOD: \`9a518544faf68d504214964ef62a6bfe87fc927f\`
- Product/reporting sources inspected read-only at: \`7b34dec1bc9f05b72b6abf0104db65980f280a0b\`
- Parallel implementation lane: **CA-K3-01 — ACTIVE**

The task file itself contains an earlier documentation-head reference because it was authored before the dispatch commit. Repository verification established the Corporate Admin documentation branch exactly at \`9a518544faf68d504214964ef62a6bfe87fc927f\` before CA-REPORT-01 mutation. The later CA-MOD authority therefore governs.

At execution time PR #222 was independently confirmed Draft/Open/Unmerged at exact K2B/product head \`7b34dec1bc9f05b72b6abf0104db65980f280a0b\`.

This document defines reporting architecture, report registry semantics, immutable snapshot custody, lifecycle, publication, export, archive and restatement governance only. It does **not** implement report code, change web/backend/database/schema, recompute KPIs, define accounting recognition, redefine customers, alter K2B, deploy, merge or mutate production.

---

## 2. Executive reporting position

CarUp Corporate reporting must be a **governed management-record system**, not a dashboard-print feature.

The canonical distinction is:

**Dashboard = current/live governed view**

**Report = period-bound, scope-bound, version-bound, reproducible governed artifact**

A report may be generated from the same registered metrics that a dashboard displays, but after generation the report becomes its own immutable historical instance.

A published report must remain intelligible and reproducible after:

- the live dashboard changes;
- a metric definition receives a new version;
- source data receives later events;
- K2B provenance classifications change;
- comparison periods move;
- a report's commentary changes;
- a new report supersedes the old one.

The report layer may package truth. It may not create truth.

---

## 3. Current reporting precedents — proven facts, not Corporate authority

### 3.1 Current Intelligence periodic reporting pattern

At the accepted product authority, \`backend/services/intelligence/reportService.js\` provides \`report@1\` periodic reporting with strong semantic properties:

- weekly and monthly periods;
- source projection already calculated upstream;
- calculation versions travel in exported report rows;
- KPI catalogue version travels with the report;
- unavailable values are exported as unavailable/“NOT MEASURED”, never blank/zero;
- measured zero remains numeric zero;
- coverage warnings state when figures cannot be measured;
- server-generated CSV preserves semantic explanations;
- failed source projection yields report-level unavailability instead of “zero activity.”

This is a **good semantic pattern**.

It is **not** the future Corporate Management Report authority because it does not provide:

- Corporate Report Definition Registry;
- Corporate scope/version registry;
- BU/function report families;
- review/approval/publish custody;
- Corporate report retention;
- immutable management report snapshots;
- report archive/search;
- restatement/supersession policy;
- report-family SoD;
- Corporate publication classification.

### 3.2 Current Vehicle History immutable-version pattern

Current Vehicle History reporting provides another useful pattern:

- immutable report-version payload;
- content hash;
- monotonically versioned snapshot;
- supersedes-version lineage;
- generated-by/generated-at;
- expiring share token;
- revocation/correction notice;
- database guard preventing report payload/content-hash/version mutation.

This proves CarUp already understands the importance of immutable report snapshots.

It is **not** Corporate Management Reporting authority because the Vehicle History model is:

- VIN-scoped;
- public/buyer-facing;
- domain-specific;
- not metric-registry driven;
- not BU/Corporate management reporting;
- not management-approval/publishing custody;
- not a Corporate report archive.

### 3.3 Corporate reuse posture

Future Corporate implementation should **reuse the semantic lessons**, not automatically reuse the same schema/table/service.

CA-REPORT-01 authorizes no schema decision.

---

## 4. Core reporting principles

### 4.1 Report definitions contain no metric values

A Report Definition says:

- what must be reported;
- which metric IDs/versions are allowed;
- which scope and periods are supported;
- who may generate/review/approve/publish;
- what source/freshness/provenance quality is required.

It does not store the current number.

### 4.2 Report instances freeze the number and its meaning

A generated Report Instance binds:

- metric identity;
- metric lineage/version;
- actual output or explicit unavailable state;
- period;
- scope;
- source metadata;
- unit/currency;
- K2B/provenance state;
- comparison basis;
- generation custody.

### 4.3 No metric recomputation inside reports

Report code must consume registered metric outputs/snapshots.

It may not:

- create a new numerator/denominator;
- sum incompatible metrics;
- invent an FX conversion;
- infer “customer” from accounts;
- infer revenue from product amounts;
- convert independent stages into funnel conversion.

### 4.4 Unavailable remains unavailable

A report must preserve:

- measured zero;
- no data;
- insufficient data;
- unavailable no source;
- unavailable not separable;
- degraded;
- forbidden;
- candidate/pending;
- technical/diagnostic/advisory.

Do not normalize them all into blank cells or zero.

### 4.5 Candidate never becomes Actual through repetition

A metric classified by CA-BU as:

\`CANDIDATE_AFTER_K2B_CONSUMPTION\`

remains a candidate in every generated report until independently certified.

A report cannot “graduate” it by displaying it for several weeks.

### 4.6 Report narrative is subordinate to metric truth

Commentary can interpret.

Commentary cannot:

- change a metric value;
- change availability;
- change metric classification;
- change K2B provenance;
- create causal certainty;
- create accounting recognition;
- change approval status.

### 4.7 Published history is append-only in meaning

Published instances must not be rewritten in place.

Correction occurs through:

- correction notice where the original factual snapshot is still valid but commentary needs correction;
- restatement where reported facts/metrics change;
- supersession where a later report replaces an earlier artifact for the same management purpose.

---

# PART I — REPORT DEFINITION REGISTRY

## 5. Corporate Report Definition Registry

Every recurring or ad-hoc governed report must resolve to a registered definition.

### 5.1 Required definition fields

| Field | Required semantics |
| --- | --- |
| \`report_definition_id\` | Stable identifier |
| \`report_family\` | Daily Operations / Weekly BU / Monthly Executive / Quarterly Board-Strategy / Compliance-Risk / Ad-hoc |
| \`title\` | Human-readable report title |
| \`purpose\` | Management question answered |
| \`audience_archetypes\` | Allowed conceptual audiences; final auth from CA-RBAC |
| \`owner_scope\` | Corporate function, BU or explicit matrix owner |
| \`cadence\` | Daily / weekly / monthly / quarterly / ad-hoc |
| \`reporting_timezone_policy\` | Explicit timezone policy; Owner decision where unresolved |
| \`period_policy\` | Start/end/grain/partial-period rules |
| \`scope_model\` | Corporate / BU / function / department / geography / explicit set |
| \`metric_requirements\` | Exact registered metric IDs and permitted versions |
| \`section_contract\` | Required/optional section IDs and ordering |
| \`supported_dimensions\` | Only CA-METRIC-supported dimensions |
| \`comparison_policy\` | Which prior periods/versions are comparable |
| \`source_freshness_policy\` | Required freshness and stale-state handling |
| \`provenance_policy\` | K2B eligibility and UNKNOWN/non-operational treatment |
| \`truth_state_policy\` | Handling of unavailable/degraded/insufficient/forbidden |
| \`classification\` | Report classification / highest content class |
| \`restricted_appendix_policy\` | Whether separate restricted appendices are allowed |
| \`generate_permission\` | Conceptual permission requirement |
| \`review_permission\` | Conceptual permission requirement |
| \`approve_permission\` | Conceptual permission requirement |
| \`publish_permission\` | Conceptual permission requirement |
| \`export_permissions\` | Allowed export types and permissions |
| \`drilldown_contract\` | Allowed live-view links |
| \`retention_policy_ref\` | Owner-defined retention reference |
| \`definition_version\` | Immutable semantic version |
| \`certification_state\` | Draft / Certified / Deprecated / Superseded |
| \`effective_from\` | Effective definition start |
| \`effective_to\` | Optional retirement boundary |
| \`change_reason\` | Why definition version changed |

### 5.2 Period-basis authority

The report-family name **Monthly** or **Quarterly** does not, by itself, choose calendar or fiscal boundaries.

Until Owner/reporting policy explicitly resolves the period convention:

- no recurring Monthly/Quarterly report may claim an authoritative calendar or fiscal basis merely from its family name;
- a certified report definition must state the exact period convention, timezone and boundary semantics before generation/publication can claim an authoritative recurring period basis;
- if that certified period basis is absent, the report remains blocked from claiming an authoritative Monthly/Quarterly reporting period.

This is a fail-closed boundary, not a selection of calendar or fiscal policy.

### 5.3 Definition versioning

A new Report Definition version is required when a change alters management meaning, including:

- metric set;
- required metric version;
- period semantics;
- scope semantics;
- mandatory section;
- approval/publication chain;
- classification;
- allowed export;
- comparison policy;
- provenance policy.

Cosmetic wording/layout changes that do not alter report meaning may remain within the same definition version if audit policy permits.

### 5.4 Definition certification

A definition is eligible for production reporting only when:

1. all required metric IDs exist in CA-METRIC;
2. each required metric state is allowed by the report policy;
3. BU metrics respect CA-BU eligibility;
4. finance semantics obey CA-FIN;
5. customer/growth semantics obey CA-GROWTH;
6. K2B requirements are explicit;
7. RBAC permissions/classification are defined;
8. period/timezone semantics are resolved;
9. export/classification policy is resolved;
10. report definition has been certified under future CA-CERT.

---

# PART II — REPORT INSTANCE / SNAPSHOT

## 6. Immutable Report Instance contract

Every generation creates a new Report Instance.

### 6.1 Required instance envelope

A report instance must bind:

- \`report_instance_id\`;
- \`report_definition_id\`;
- \`report_definition_version\`;
- \`generation_sequence\` or unique version;
- \`generated_at\`;
- \`generated_by\`;
- \`reporting_period_start\`;
- \`reporting_period_end\`;
- \`reporting_timezone\`;
- \`is_partial_period\`;
- \`scope_snapshot\`;
- \`classification_snapshot\`;
- \`metric_snapshots[]\`;
- \`comparison_snapshot\`, if valid;
- \`provenance_summary\`;
- \`source_freshness_summary\`;
- \`data_quality_flags\`;
- \`narrative_blocks[]\`;
- \`review_state\`;
- \`approval_state\`;
- \`publication_state\`;
- \`published_at\`;
- \`published_by\`;
- \`supersedes_instance_id\`;
- \`restates_instance_id\`;
- \`withdrawal/supersession metadata\`;
- \`content_integrity_hash\` or equivalent future integrity mechanism;
- \`audit references\`.

### 6.2 Scope snapshot

The instance freezes scope metadata such as:

- Corporate;
- BU ID;
- function;
- department/team;
- geography type/value;
- legal entity only if authority exists;
- data classification;
- reporting period.

Future organisational changes must not rewrite historical report scope labels silently.

If display names later change, archive may show:

- historical label at generation;
- current label as metadata.

The historical snapshot remains authoritative for the published artifact.

### 6.3 Metric snapshot

Each report metric entry must bind at minimum:

- metric ID;
- metric definition version;
- lineage/calculation version;
- metric label at generation;
- truth classification;
- eligibility state;
- actual value or explicit availability state;
- unit;
- source currency where applicable;
- numerator/denominator snapshot where rate/ratio requires it;
- time grain;
- period;
- dimensions;
- entity grain;
- source authority;
- source/as-of timestamp;
- freshness state;
- provenance/K2B state;
- exclusion/UNKNOWN summary where relevant;
- comparison value only if valid;
- notes/limitations;
- classification.

### 6.4 Explicit unavailable snapshot

Unavailable output must still be snapshotted.

Example conceptual row:

- metric ID: \`corporate.finance.recognized_revenue\`
- state: \`PENDING_CA_FIN\`
- value: null
- reason: \`accounting_source_not_established\`
- source authority: none/CA-FIN blocked
- generated_at: report time

This allows a historical report to prove that CarUp **did not claim revenue** at that time.

### 6.5 Snapshot versus live link

A report may contain a deep link:

\`View current metric\`

That opens the live Corporate Admin surface.

It must be labelled **Current / Live**.

The live page must not visually replace the report's historical value.

Recommended pattern:

- Report snapshot: “Period ending 2026-10-11”
- Live link: “View current state”

### 6.6 Reproducibility

Reproducibility means the archive can recover:

- exact report definition version;
- exact metric versions;
- exact frozen outputs/states;
- exact report period/scope;
- exact provenance/freshness metadata;
- exact publication custody.

It does not necessarily require replaying old database queries.

The immutable snapshot itself is the management record.

A future reproducibility audit may additionally compare the snapshot with archived source/query receipts where such receipts are retained.

---

# PART III — LIFECYCLE AND CUSTODY

## 7. Canonical lifecycle

Primary lifecycle:

**Draft → Generated → In Review → Approved → Published**

Exception/terminal states:

- Returned for Correction;
- Rejected;
- Superseded;
- Restated;
- Withdrawn, if Owner policy permits;
- Generation Failed.

### 7.1 Draft

Definition/template and report request exist, but no frozen report instance is authoritative.

Allowed:

- select permitted scope/period;
- prepare commentary placeholders;
- validate required sources.

Not allowed:

- publish;
- present as finalized management record.

### 7.2 Generated

A report snapshot has been created.

At this point:

- metric values/states are frozen for this instance;
- definition/metric versions are frozen;
- source/provenance metadata is frozen;
- generation identity/time is frozen.

Management commentary may still be added/edited under policy, but must be separately versioned/audited and may not mutate metric snapshots.

If metric content must change, generate a new instance.

### 7.3 In Review

Review checks:

- report completeness;
- semantic correctness;
- source/degraded disclosures;
- required commentary;
- finance/customer/K2B boundaries;
- classification;
- comparison validity;
- decisions/escalations.

Review does not authorize changing the frozen metric snapshot.

### 7.4 Returned for Correction

Reviewer returns the instance/request because:

- required section missing;
- commentary inaccurate/unsupported;
- classification incorrect;
- wrong report definition/scope used;
- quality gate failed.

If the metric snapshot itself is wrong, generate a replacement instance.

### 7.5 Rejected

Report is intentionally not approved for publication.

Reason is mandatory.

Rejected report may remain retained for audit according to retention policy.

### 7.6 Approved

Approver attests that the frozen instance and approved commentary are ready for publication.

Approval binds:

- approver;
- timestamp;
- report instance;
- content version/hash;
- classification.

Any substantive change after approval invalidates approval and requires renewed review/approval.

### 7.7 Published

Publication makes the exact approved instance the official management artifact for its scope/period/family **only when an accepted report definition, CA-RBAC grant and applicable Owner/report-family publication policy authorize that transition**. Approval alone does not create publication authority.

Publication records:

- publisher;
- timestamp;
- publication channel;
- audience/classification;
- exported artifact IDs if applicable.

Published content is immutable.

### 7.8 Superseded

A later report instance becomes the current authoritative artifact for the same management purpose without necessarily asserting the earlier report was wrong.

Example:

- quarterly strategy v2 supersedes a withdrawn draft-like publication due to packaging change under policy.

Archive retains both with lineage.

### 7.9 Restated

Use Restated when a previously published fact/report materially changes because of:

- corrected source;
- provenance correction;
- metric-definition correction;
- late-arriving data accepted under restatement policy;
- accounting-policy/source change;
- material factual correction.

A restatement:

- creates a new report instance;
- identifies the restated instance;
- records reason;
- records changed metrics/sections;
- preserves original published artifact.

### 7.10 Withdrawn

Withdrawal is not deletion.

**Withdrawal is disabled while `OD-CAREPORT-038` remains unresolved.**

If Owner policy later permits withdrawal:

- original report remains archived;
- publication status becomes withdrawn;
- reason and actor recorded;
- public/internal distribution links may be revoked according to policy;
- replacement/restatement link shown if available.

### 7.11 Generation Failed

A failed report generation is not a report of zero activity.

Record:

- failed generation attempt;
- missing/unreadable source;
- affected sections;
- timestamp;
- retry/audit state.

---

## 8. State-transition contract

| From | To | Frozen metric snapshot changes allowed? | Audit required? | New instance required? |
| --- | --- | --- | --- | --- |
| Draft | Generated | Generation creates snapshot | Yes | Yes, first instance |
| Generated | In Review | No | Yes | No |
| In Review | Returned | No | Yes | No |
| Returned | Generated replacement | Old snapshot no; replacement yes | Yes | Yes if metric snapshot differs |
| In Review | Rejected | No | Yes | No |
| In Review | Approved | No | Yes | No |
| Approved | Published | No | Yes | No |
| Approved | Returned | No | Yes | Commentary-only policy dependent; metric change requires new |
| Published | Restated | Original no | Yes | **Yes** |
| Published | Superseded | Original no | Yes | **Yes** |
| Published | Withdrawn **only if Owner/report-family policy explicitly enables withdrawal** | Original no | Yes | No content mutation |
| Any | Generation Failed | N/A | Yes | Failed attempt record |

---

# PART IV — ACCESS AND SEGREGATION OF DUTIES

## 9. Conceptual report permissions

Future Corporate permission taxonomy should include or map to:

- \`corporate.report.definition.create\`
- \`corporate.report.definition.edit\`
- \`corporate.report.generate\`
- \`corporate.report.review\`
- \`corporate.report.approve\`
- \`corporate.report.publish\`
- \`corporate.report.withdraw\`
- \`corporate.report.restate\`
- \`corporate.report.read\`
- \`corporate.report.export\`
- \`corporate.report.restricted_appendix.read\`
- \`corporate.report.commentary.edit\`
- \`corporate.report.audit\`

These are conceptual reporting authorities and do not implement CA-RBAC.

### 9.1 Permission does not replace source access policy

A report generator may only generate metrics that:

- their report-generation role is authorized to request;
- the registered report definition permits;
- the report service itself is authorized to snapshot.

Report publication does not grant direct access to underlying restricted source rows.

### 9.2 Restricted appendices

A report may have:

- general management body;
- separately classified restricted appendix.

Example:

Compliance/Risk body:
- queue totals;
- aging;
- trend.

Restricted appendix:
- named cases/evidence references.

The restricted appendix must have separate access/export controls.

---

## 10. Segregation of duties

### 10.1 Baseline principle

**Generate ≠ Review ≠ Approve ≠ Publish**

The same person may perform multiple stages only where the report-family policy explicitly permits it.

### 10.2 High-stakes report SoD boundary

Accepted CA-RBAC already requires **report preparer ≠ publisher for designated executive/board/restricted reports** and forbids self-grant/SoD bypass.

CA-REPORT does not convert that accepted safeguard into broader unresolved policy. For Monthly Executive, Quarterly Board/Strategy, restricted Finance and sensitive Compliance/Risk reports:

- the accepted CA-RBAC preparer/publisher separation remains binding where designated;
- any additional generator/reviewer/approver separation is a **non-binding CA-REPORT recommendation** until the report-family/Owner policy explicitly adopts it;
- if a certified report definition does not identify permitted review/approval/publication custody, that absence does not authorize self-approval or publication.

### 10.3 Daily Operations

Daily Operations may use lighter SoD where Owner approves because timeliness matters.

Possible model:

- automated generation;
- operations-lead review;
- publication to authorized internal audience.

Still no silent self-publication policy is assumed.

### 10.4 Ad-hoc reporting

Ad-hoc generation does not automatically become Published.

A generated ad-hoc report is:

- private/draft/generated;
- share/export controlled;
- subject to approval if promoted into an official management report.

### 10.5 Step-up assurance

CA-RBAC assurance applies as accepted upstream authority.

Accepted CA-RBAC establishes:

- A0 / A1 / A2 assurance classes;
- fail-closed behavior if assurance state cannot be read;
- **A1 minimum** for restricted-finance export/publish;
- **A1 as a candidate** for executive/board/restricted report publication;
- A2 as a future stronger class that is not currently available as a proven strong authenticator.

CA-REPORT neither strengthens nor weakens those accepted constraints. Exact report-family assurance for executive/board/restricted publication, restatement or any future withdrawal remains unresolved unless an accepted CA-RBAC/Owner policy states it. An unresolved Owner Decision grants no assurance or publication authority.

---

# PART V — REPORT FAMILIES

## 11. Daily Operations

### 11.1 Purpose

Answer:

**What is waiting, failing, aging or blocked today?**

Daily Operations is not an executive financial statement.

### 11.2 Scope

May be:

- Corporate operations roll-up;
- BU-specific daily operations;
- function-specific operations.

### 11.3 Core sections

1. Reporting period / as-of.
2. Queue/backlog state.
3. Operational throughput.
4. Aging/cycle time.
5. Exceptions/blockers.
6. Trust/Risk/Compliance blockers.
7. Source degradation.
8. Outstanding actions/escalations.
9. Data/provenance notes.

### 11.4 Metric eligibility

Prefer:

- `CERTIFIED_CURRENT`;
- governed operational metrics with exact source-path K2B certification.

A **Generated** or **In Review** artifact may preserve a candidate metric in its exact candidate state only where the already accepted report definition/policy permits it. A candidate is never Actual.

Publication of candidate metrics is **disabled pending explicit Owner/report-family policy**. Placement in a “Pending/Diagnostic” section does not itself authorize publication.

### 11.5 Finance

Do not add unavailable Corporate finance KPIs merely to fill space.

Product money workflow exceptions may appear with exact labels when operationally material.

---

## 12. Weekly BU Review

### 12.1 Purpose

Answer:

**How is this BU operating, what changed, what is constraining it, and what action is required?**

### 12.2 Required BU identity

Freeze:

- canonical BU ID;
- display label at generation;
- reporting period;
- scope/geography;
- management-owner archetype;
- metric/provenance state.

### 12.3 Required section contract

Consume CA-BU exactly:

1. Mandate / management context.
2. Demand / activity.
3. Supply / capacity.
4. Throughput / journey.
5. Trust / quality / compliance.
6. Backlog / cycle time.
7. Geography where authoritative.
8. Finance / commercial state where governed.
9. Data quality / provenance.
10. Key changes.
11. Actions / escalations.
12. Decisions required.

### 12.4 Per-BU specialization

#### BU_MARKETPLACE

Potential report facts:

- operational public/non-public supply;
- operational inquiries;
- moderation/risk queue;
- certified/candidate search-demand measures;
- linked journey measures where certified;
- dealer participation;
- blocked finance/customer metrics.

Preserve:

- inquiry ≠ sale;
- listing price ≠ GMV;
- publishable ≠ published.

#### BU_SERVICE_NETWORK

Potential:

- requests/cases;
- accepted/completed;
- work orders;
- turnaround with measured coverage;
- parts RFQs;
- PartSentry provenance;
- garage onboarding;
- unavailable capacity.

Preserve:

- work-order customer ≠ Corporate distinct customer;
- service amount ≠ revenue.

#### BU_FINANCIAL_SERVICES

Potential:

- finance applications;
- authoritative decisions;
- eligibility;
- live vs sandbox;
- insurer/lender participation;
- payment/escrow workflow;
- accounting unavailable state.

Preserve:

- requested amount ≠ disbursement;
- payment intent ≠ cash;
- escrow ≠ revenue.

#### BU_DIASPORA_TRADE

Potential:

- buyer requests/orders;
- RFQ publication;
- submitted offers;
- accepted quotes;
- time to first offer;
- corridor demand;
- scheduled/confirmed milestones;
- live/sandbox escrow distinction;
- unavailable shipment/live settlement metrics.

Preserve:

- participant ≠ customer;
- quote ≠ revenue;
- scheduled milestone ≠ cash;
- corridor ≠ customer residence.

### 12.5 Candidate metrics

If CA-BU says:

\`CANDIDATE_AFTER_K2B_CONSUMPTION\`

the Weekly BU report must snapshot that **candidate state**, not a business Actual.

For Generated/In-Review artifacts where the accepted report definition permits candidate preservation, the non-binding presentation recommendation is:

- “Pending certification”
- no executive performance coloring;
- no inclusion in cross-BU ranking;
- no automated management delta.

This presentation recommendation does not authorize candidate publication. `OD-CAREPORT-052` remains unresolved.

---

## 13. Monthly Executive Review

### 13.1 Purpose

Answer:

- What materially changed across CarUp?
- Which BU/function requires executive attention?
- Which strategic facts are unavailable?
- Which decisions are required?

### 13.2 Required sections

1. Corporate Overview.
2. BU material changes.
3. Customers & Growth.
4. Finance state.
5. Operations exceptions.
6. Trust/Risk/Compliance.
7. Data/Intelligence quality.
8. People/Access items where material.
9. Strategic decisions requested.
10. Source/provenance caveats.

### 13.3 Materiality

CA-REPORT does not invent a materiality threshold.

Until Owner policy:

- human reviewers identify material changes;
- automated “material” labels remain disabled unless a governed rule exists.

### 13.4 Customers & Growth

Where universal customer semantics remain unresolved:

use:

- operational accounts;
- inquiries;
- buyers/sellers;
- work-order customers;
- Trade buyers/participants;
- applications;
- source-associated demand.

Do not create a “customers grew X%” headline without accepted customer authority.

### 13.5 Finance

Strategically important unavailable finance slots may remain visible:

- revenue unavailable;
- gross profit unavailable;
- cash unavailable;
- AR/AP unavailable;
- take rate unavailable.

This truth is more valuable than a fabricated complete-looking report.

---

## 14. Quarterly Board / Strategy

### 14.1 Purpose

Provide a higher-level strategic management artifact for the intended governance audience.

This is **not** a statutory filing definition and does not assert formal board/legal obligations.

### 14.2 Sections

1. Strategic context.
2. Corporate trajectory.
3. BU trajectory.
4. Market/demand signals.
5. Governed financial state.
6. Trust/Risk/Compliance.
7. Operational capability.
8. Geographic/market development where authoritative.
9. Major data/authority gaps.
10. Strategic opportunities.
11. Decisions requested.
12. Appendix: metric definitions/provenance.

### 14.3 Financial discipline

If Corporate accounting authority is absent, Quarterly Board/Strategy must say so.

It must not fill the gap with:

- listing value;
- requested finance amount;
- quotes;
- deposits;
- scheduled milestones;
- sandbox settlements.

### 14.4 Strategic narrative

Human commentary may summarize trends and strategic implications.

It must distinguish:

- factual statement based on metrics;
- management interpretation;
- decision/recommendation.

---

## 15. Compliance / Risk

### 15.1 Purpose

Provide governed oversight of control workload and risk/compliance operations.

### 15.2 Aggregate sections

Potential:

- identity verification workload;
- evidence-review backlog;
- fraud case workload;
- governance review;
- dealer compliance;
- garage onboarding/compliance;
- Trade compliance;
- provenance UNKNOWN/review backlog;
- aging/trend;
- high-level source degradation.

### 15.3 Restricted appendices

May include, with separate permission:

- named cases;
- evidence references;
- case IDs;
- reviewer decisions;
- sensitive compliance detail.

Aggregate report-read permission does not imply appendix access.

### 15.4 No universal Trust score

Do not collapse:

- identity;
- evidence;
- fraud;
- dealer compliance;
- garage compliance;
- PartSentry;
- Trade compliance

into one generic “Risk %” or “Trust score” without registered authority.

---

## 16. Ad-hoc governed reporting

### 16.1 Purpose

Allow authorized analysts/managers to answer bounded questions without creating a shadow analytics platform.

### 16.2 Allowed selections

Ad-hoc users may select only:

- registered metric IDs;
- certified/permitted metric versions;
- supported dimensions;
- supported time grain/period;
- authorized organisational scope;
- authorized geography;
- allowed classification;
- approved comparison periods.

### 16.3 Forbidden ad-hoc capabilities

No:

- arbitrary formula builder;
- raw SQL;
- free-form joins;
- unregistered calculated fields;
- cross-currency sum without FX authority;
- user-defined customer identity merge;
- raw PII export without permission;
- candidate→Actual override;
- K2B reclassification;
- independent-stage “conversion” builder.

### 16.4 Ad-hoc state

By default, an ad-hoc report is:

\`Generated / Unpublished\`

It becomes an official management artifact only through a registered/policy-approved review and publication path.

### 16.5 Ad-hoc reproducibility

Even ad-hoc generated artifacts must snapshot:

- query/report configuration;
- metric IDs/versions;
- scope;
- dimensions;
- period;
- outputs/states;
- source/provenance;
- generated by/time.

---

# PART VI — NARRATIVE, COMPARISON AND TRUTH BOUNDARIES

## 17. Narrative and commentary authority

### 17.1 Factual metric narrative

System-generated factual narrative may state only deterministic facts already present in the snapshot.

Example:

“Operational Marketplace inquiries were higher than the approved comparable prior period.”

Only valid if comparison rules pass.

### 17.2 Human management commentary

Human commentary must bind:

- author;
- timestamp;
- section/report instance;
- commentary version/status.

It may describe:

- context;
- hypothesis;
- management interpretation;
- planned action;
- requested decision.

It may not alter metric snapshots.

### 17.3 Causality

Narrative must not say:

“Campaign X caused growth”

when the source only proves campaign association.

Use:

“Campaign X was associated with recorded inquiries under the current source coverage.”

### 17.4 AI commentary

AI commentary is **fail-closed / disabled unless explicit Owner/report-family policy authorizes it**.

If later enabled:

- explicitly badge \`Advisory AI commentary\`;
- record model/provider/version;
- preserve prompt/context source references;
- prohibit mutation of report metrics/states;
- prohibit approval-state mutation;
- require human review for publication;
- never treat AI speculation as factual narrative.

---

## 18. Comparison / variance rules

A report may calculate/display a comparison only when all are true:

1. same metric ID or explicitly approved comparable metric versions;
2. compatible definition/lineage;
3. same entity grain;
4. compatible population;
5. compatible organisational/geographic scope;
6. same unit;
7. same currency or accepted FX basis;
8. comparable periods;
9. adequate completeness;
10. compatible provenance/K2B policy.

### 18.1 Percent change

Do not compute a generic percent change when:

- prior value unavailable;
- current value unavailable;
- prior denominator zero and no governed rule exists;
- metric version changed incompatibly;
- period is partial and prior is complete unless policy allows;
- currencies differ without FX.

### 18.2 Incomparable state

Display:

\`Comparison unavailable — metric definitions/periods are not comparable.\`

This is preferable to a misleading delta.

---

# PART VII — FINANCE, GROWTH AND K2B

## 19. Finance reporting boundary

CA-FIN remains controlling.

Reports must not invent or infer:

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

### 19.1 Product amounts

Allowed only with exact label and context:

- listing price;
- requested finance amount;
- deposit/payment intent;
- escrow amount/state;
- quote amount;
- scheduled milestone;
- service/product charge if source exists.

No product amount may be relabelled accounting revenue/cash.

### 19.2 Currency

A report must snapshot source currency.

Cross-currency aggregation is forbidden until accepted FX authority exists.

### 19.3 Future accounting integration

When CA-FIN later certifies accounting metrics, new report-definition versions must explicitly add them.

Historical reports are not retroactively rewritten to contain finance metrics that were unavailable at generation time.

---

## 20. Customers & Growth boundary

CA-GROWTH remains controlling.

Unless corresponding policy/source authority is accepted, reports must not claim:

- Corporate distinct customers;
- active customers;
- transacting customers;
- retained customers;
- churn;
- reactivation;
- acquisition channel causality;
- CAC;
- LTV;
- ROAS;
- ARPU;
- revenue/profit per customer.

### 20.1 Source-accurate terms

Use:

- registered accounts;
- operational accounts;
- verified identity subjects;
- inquiries;
- Marketplace buyers/sellers;
- work-order customers;
- Trade buyers/participants;
- finance applicants;
- insurance participants.

### 20.2 Funnel rules

No report may label independent stage totals “conversion.”

Every funnel needs:

- linked cohort/process;
- stages;
- denominator;
- link key;
- period;
- version.

---

## 21. K2B provenance boundary

Accepted/frozen K2B authority:

\`7b34dec1bc9f05b72b6abf0104db65980f280a0b\`

Corporate/BU Actual:

- operational eligible rows only;
- non-operational rows excluded;
- UNKNOWN/review-required rows excluded.

### 21.1 Report snapshot provenance summary

Where relevant, snapshot:

- operational included count;
- non-operational excluded count;
- UNKNOWN/review-required excluded count;
- provenance source/version;
- source-path K2B certification state.

### 21.2 Candidate source path

If exact metric path has not proven K2B consumption:

- preserve \`CANDIDATE_AFTER_K2B_CONSUMPTION\`;
- no Actual label;
- no inclusion in executive “actual” totals/rankings.

### 21.3 Report layer cannot reclassify

No report rule may decide:

- this looks real;
- this is probably test;
- this fixture should count;
- this UNKNOWN row is operational.

K2B/source authority owns classification.

---

# PART VIII — FRESHNESS, COMPLETENESS AND PUBLICATION QUALITY

## 22. Freshness/completeness model

A report snapshots source quality at generation.

**Generation ≠ publication.**

A degraded, stale, unavailable, bounded-incomplete or partial-period instance may be generated only where an already accepted/certified report definition or policy explicitly permits that generation state. The existence of an unresolved `OD-CAREPORT-*` never supplies that permission.

Publication is a separate authority gate. Unless an accepted report-family/Owner policy explicitly permits publication for the relevant quality state, unresolved policy must not be read as publication authority.

### 22.1 ALL_CURRENT

All required sources meet report-definition freshness policy.

### 22.2 MIXED_FRESHNESS

Some sections are current; one or more are stale but readable.

A snapshot may be generated only where an already accepted/certified report definition permits mixed-freshness generation.

Publication remains **unresolved and disabled absent explicit report-family/Owner publication policy**.

### 22.3 SOURCE_STALE

A required source exceeds the freshness rule of an accepted/certified definition. If no freshness threshold exists, the report layer must not invent one.

Show, where a stale state is already established by authority:

- source;
- last as-of;
- affected metrics;
- stale duration/category.

Do not substitute old value silently.

Generation and publication of a stale-source report are separate policy decisions. Unresolved publication policy grants no permission to publish.

### 22.4 SOURCE_UNAVAILABLE

Source read failed.

Affected metric/section becomes unavailable/degraded according to CA-METRIC.

A report instance may be generated with that explicit state only where an already accepted/certified definition permits it. **Significant SOURCE_UNAVAILABLE publication remains blocked unless explicit report-family/Owner publication policy permits it.**

### 22.5 BOUNDED_INCOMPLETE

Source has known completeness limitation.

Example:

Navigation aggregation reaches the 50,000-row bound without proof the requested period is complete.

Result:

- DEGRADED / unavailable according to metric contract;
- ranking/comparison disabled if completeness invalidates them.

### 22.6 PARTIAL_PERIOD

Report period is not complete.

Example:

a report generated before the certified reporting period closes.

Must snapshot:

- `is_partial_period=true`;
- period elapsed;
- comparison policy.

No comparison to a complete prior period unless an accepted comparison policy permits it.

Generation may occur only where an already accepted/certified definition permits partial-period generation. **Publication remains disabled unless explicit report-family/Owner policy permits partial-period publication.**

### 22.7 Mixed-state report

One unavailable source does not automatically erase all valid sections.

Where generation is already authorized, the report instance can preserve:

- valid sections;
- unavailable sections;
- explicit coverage summary.

That preservation is not publication authority. Publication-blocking behavior remains an explicit report-family/Owner decision; unresolved policy fails closed.

---

# PART IX — RESTATEMENT, CORRECTION AND SUPERSESSION

## 23. Correction taxonomy

### 23.1 Commentary correction

Use when metric snapshot is unchanged but narrative wording is wrong/unclear.

Policy options:

- correction notice attached to published instance; or
- new commentary version under same immutable metric snapshot.

Must be audited.

### 23.2 Source correction

If source data correction changes a published metric:

- generate new report instance;
- mark as Restatement;
- link to original;
- state affected metrics/reason.

### 23.3 Metric-version correction

If a metric formula/definition was defective:

- corrected metric receives proper lineage/version under CA-METRIC;
- restated report binds corrected version;
- original remains archived.

### 23.4 Provenance correction

If K2B/source provenance changes eligibility:

- regenerate affected report under accepted authority;
- restatement records excluded/included changes;
- original retained.

### 23.5 Late-arriving data

Late data does not silently backfill a published report.

Owner policy decides whether:

- no restatement needed;
- append correction note;
- restate if material.

### 23.6 Accounting change

Future accounting policy/source changes are controlled by CA-FIN.

Historical reports should not silently adopt new recognition policy.

Restatement, if required, must identify accounting basis/version.

### 23.7 Supersession versus restatement

**Supersession:** later artifact replaces prior management presentation without necessarily declaring original numbers wrong.

**Restatement:** prior published facts materially changed.

---

# PART X — EXPORT GOVERNANCE

## 24. Export formats

Future supported formats may include:

- web report;
- PDF/print;
- CSV/tabular extract;
- future board/presentation pack.

CA-REPORT-01 does not implement them.

### 24.1 Web

Canonical interactive management artifact.

Must show:

- report ID/version;
- state;
- period;
- scope;
- generated/published custody;
- metric metadata;
- availability/provenance;
- supersession/restatement notice.

### 24.2 PDF / print

Must embed:

- report ID;
- instance/version;
- generation/publication timestamp;
- period;
- scope;
- classification;
- truth/degraded states;
- source/provenance note;
- page numbering;
- superseded/restated notice if applicable.

A PDF is a rendering of a report instance, not a new report definition.

### 24.3 CSV

CSV is appropriate only for explicitly authorized tabular extracts.

It must preserve:

- metric identity;
- value/state;
- unit/currency;
- period;
- scope;
- metric/calculation version;
- source/as-of;
- classification;
- provenance state.

Unavailable must never export as blank if blank could imply zero/missing accidentally.

Current \`report@1\` “NOT MEASURED” pattern is a useful precedent.

### 24.4 Board/presentation pack

Future slide/presentation rendering must derive from the same approved report instance.

It must not:

- select different unapproved metric values;
- suppress unavailable caveats;
- change period/scope;
- create new narrative causality.

### 24.5 Export permission

Report read ≠ export.

Separate permissions apply to:

- standard PDF;
- CSV;
- restricted appendix export;
- board pack;
- external sharing.

### 24.6 Classification

Export inherits the report's highest relevant classification unless a separately generated redacted/public-safe variant is governed.

---

# PART XI — ARCHIVE, SEARCH AND SHARING

## 25. Report archive metadata

Historical report archive must support search/filter by:

- report family;
- report definition ID/version;
- report instance ID/version;
- BU;
- corporate function;
- scope;
- geography;
- reporting period;
- generated date;
- published date;
- state;
- publisher;
- classification;
- restated/superseded status.

### 25.1 Archive result display

Each result should show:

- title;
- family;
- period;
- scope;
- state;
- publication timestamp;
- definition version;
- “Superseded by …” / “Restated by …” where relevant.

### 25.2 Immutable history

Archive must never replace old instance with newest file under same URL/reference without lineage.

### 25.3 External sharing

External sharing is unresolved Owner policy.

Fail-closed interim posture:

- no external sharing authority exists merely because a report can be read internally;
- external sharing requires explicit capability, classification and Owner/report-family policy;
- expiring/revocable share patterns are non-binding future design options;
- no public token sharing is authorized by CA-REPORT-01.

Vehicle History share links are a domain precedent, not authority to expose Corporate reports.

---

# PART XII — DASHBOARD / REPORT RELATIONSHIP

## 26. Live dashboard versus report

### 26.1 Dashboard

Dashboard:

- current data;
- current selected period;
- current metric version;
- current permissions;
- current provenance;
- current source freshness.

It can change minute to minute.

### 26.2 Report

Report:

- fixed report period;
- fixed scope;
- fixed metric version/output;
- fixed generation time;
- fixed publication custody;
- historical artifact.

### 26.3 Deep link

A report can link to a dashboard for current investigation.

The destination must show:

**Current Live View**

and not imply it is the historical report snapshot.

### 26.4 Screenshot prohibition

A screenshot of a dashboard:

- loses machine-readable metric IDs;
- may omit unavailable-state reasons;
- may omit provenance;
- may omit publication custody;
- may be stale without as-of semantics.

Therefore screenshot capture is not canonical report authority.

---

# PART XIII — REPORT FAMILY REGISTRY SEED

## 27. Proposed canonical report IDs

These IDs are proposed registry seeds and do not implement backend records.

| Report ID | Family | Primary owner | Default audience | Cadence |
| --- | --- | --- | --- | --- |
| \`REPORT_DAILY_OPERATIONS_CORPORATE\` | Daily Operations | Operations / Executive matrix | COO/ops leads | Daily |
| \`REPORT_WEEKLY_BU_MARKETPLACE\` | Weekly BU | BU_MARKETPLACE | BU Lead / Executive | Weekly |
| \`REPORT_WEEKLY_BU_SERVICE_NETWORK\` | Weekly BU | BU_SERVICE_NETWORK | BU Lead / Executive | Weekly |
| \`REPORT_WEEKLY_BU_FINANCIAL_SERVICES\` | Weekly BU | BU_FINANCIAL_SERVICES | BU Lead / Executive | Weekly |
| \`REPORT_WEEKLY_BU_DIASPORA_TRADE\` | Weekly BU | BU_DIASPORA_TRADE | BU Lead / Executive | Weekly |
| \`REPORT_MONTHLY_EXECUTIVE\` | Monthly Executive | CF_EXECUTIVE | Executive | Monthly |
| \`REPORT_QUARTERLY_STRATEGY\` | Quarterly Board / Strategy | CF_EXECUTIVE | Approved governance audience | Quarterly |
| \`REPORT_COMPLIANCE_RISK\` | Compliance / Risk | CF_TRUST_RISK_COMPLIANCE | Compliance/Executive | Defined cadence |
| \`REPORT_ADHOC_GOVERNED\` | Ad-hoc | Explicit owner | Authorized scoped audience | On demand |

Final names/cadences remain Owner decisions. These proposed registry seeds do not authorize a recurring schedule, period basis, generation, approval or publication by themselves.

---

# PART XIV — EXAMPLE REPORT-INSTANCE SEMANTICS

## 28. Example without invented business values

A Weekly Marketplace report may snapshot:

- Public operational listings: \`GOVERNED_ACTUAL\`
- Operational inquiries: \`GOVERNED_ACTUAL\`
- Search demand: \`CANDIDATE_AFTER_K2B_CONSUMPTION\`
- Human-readable top search terms: \`UNAVAILABLE_NOT_SEPARABLE\`
- Marketplace customer count: \`BLOCKED_OWNER_DECISION\`
- GMV: \`PENDING_CA_FIN\`
- Recognized revenue: \`PENDING_CA_FIN\`

This is a **complete truthful report** even though several strategic slots contain no numeric value.

Completeness of reporting means all required questions are represented with their true states—not that every slot has a number.

---

# PART XV — OWNER DECISION REGISTER

## 29. Owner Decision Register

### 29.1 Authority rule for unresolved Owner Decisions

An unresolved `OD-CAREPORT-*` is a **question requiring authority**. It is not authority itself.

Every interim posture below is classified as one of four types:

1. **ACCEPTED UPSTREAM AUTHORITY** — a constraint already established by an accepted upstream CA-RBAC / CA-METRIC / CA-FIN / CA-GROWTH / CA-UX / CA-BU / K2B authority. CA-REPORT merely carries it forward.
2. **FAIL-CLOSED INTERIM** — a non-expansive restriction used only to prevent an unauthorized action while policy is unresolved. It may block generation, publication, sharing, export, withdrawal or disclosure; it may not create new rights or business semantics.
3. **NON-BINDING CA-REPORT RECOMMENDATION** — design guidance for future Owner/moderator consideration. It must not be implemented as permission, cadence, period, publication, sharing, export, withdrawal or policy authority merely because it appears here.
4. **UNRESOLVED OWNER DECISION** — no operative policy is established by CA-REPORT. A certified report definition may rely only on authority explicitly accepted elsewhere; it cannot self-resolve the Owner Decision.

Additional binding interpretation rules:

- **generation ≠ publication**;
- generating an allowed degraded/unavailable/partial/candidate-preserving instance does not authorize publishing it;
- unresolved policy never authorizes publication, withdrawal, external sharing, export, classification downgrade, financial/customer reinterpretation, K2B reclassification or access expansion;
- a “recommendation” is not a safe default unless it is separately classified as a fail-closed interim restriction;
- where accepted upstream authority is stricter than a recommendation, the accepted upstream authority controls.

| Decision ID | Owner decision required | Why it matters | Authority posture while unresolved |
| --- | --- | --- | --- |
| `OD-CAREPORT-001` | Confirm canonical report families and names. | Registry stability | **ACCEPTED UPSTREAM AUTHORITY:** CA-REPORT models the six dispatched report families. Final naming/cadence policy remains unresolved and this row grants no schedule/publication authority. |
| `OD-CAREPORT-002` | Reporting timezone for Corporate/BU reports. | Period boundaries | **UNRESOLVED OWNER DECISION:** no hidden timezone default. A certified definition must state timezone before claiming authoritative period boundaries. |
| `OD-CAREPORT-003` | Calendar versus fiscal month/quarter conventions. | Monthly/quarterly reproducibility | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** do not choose calendar or fiscal convention. A certified report definition must explicitly state the accepted period convention before recurring Monthly/Quarterly generation/publication can claim an authoritative period basis. |
| `OD-CAREPORT-004` | Who owns each report definition? | Accountability | **NON-BINDING CA-REPORT RECOMMENDATION:** align ownership to the accepted BU/central-function architecture. Exact owner authority remains unresolved. |
| `OD-CAREPORT-005` | Who may generate reports by family? | Custody | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no generate authority is created here; generation requires explicit accepted CA-RBAC/report-definition permission. |
| `OD-CAREPORT-006` | Who may review each family? | SoD | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no review authority is created here; require explicit accepted permission. |
| `OD-CAREPORT-007` | Who may approve each family? | Governance | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no approval authority is created here; require explicit accepted permission. |
| `OD-CAREPORT-008` | Who may publish each family? | Publication authority | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no publication authority is created here; require explicit accepted publish permission and certified report-family policy. |
| `OD-CAREPORT-009` | Which families require generator ≠ approver? | SoD | **UNRESOLVED OWNER DECISION:** CA-RBAC already supplies designated preparer/publisher separation; CA-REPORT recommends stronger separation for high-stakes reports but grants no additional rule until accepted. |
| `OD-CAREPORT-010` | Which families require publisher ≠ preparer? | SoD | **ACCEPTED UPSTREAM AUTHORITY:** CA-RBAC requires report preparer ≠ publisher for designated executive/board/restricted reports. Which additional families are designated remains unresolved. |
| `OD-CAREPORT-011` | Can Daily Operations use lighter SoD? | Timeliness | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** do not relax accepted CA-RBAC SoD merely for cadence. Any lighter family-specific rule requires explicit approval. |
| `OD-CAREPORT-012` | Which source failures block generation? | Availability | **UNRESOLVED OWNER DECISION:** degraded/unavailable generation is permitted only where an already accepted/certified definition explicitly allows it. This OD itself authorizes no generation. |
| `OD-CAREPORT-013` | Which source failures block publication? | Quality | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** significant source-failure publication is disabled unless explicit report-family/Owner policy permits it. Generation, where already authorized, does not imply publication. |
| `OD-CAREPORT-014` | Maximum acceptable stale-source age by report family/source. | Freshness | **UNRESOLVED OWNER DECISION:** CA-REPORT invents no stale threshold. Without an accepted threshold, do not label a source “current” by assumption. |
| `OD-CAREPORT-015` | May reports publish with MIXED_FRESHNESS? | Governance | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** mixed-freshness publication is disabled absent explicit report-family/Owner policy. An authorized Generated/In-Review snapshot may preserve mixed freshness without granting publication. |
| `OD-CAREPORT-016` | May reports publish for partial periods? | Comparability | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** partial-period publication is disabled absent explicit report-family/Owner policy. Authorized generation must preserve `is_partial_period=true`. |
| `OD-CAREPORT-017` | Materiality threshold for Monthly Executive changes. | Narrative/attention | **UNRESOLVED OWNER DECISION:** no automatic materiality threshold or “material” label. |
| `OD-CAREPORT-018` | Materiality threshold requiring report restatement. | Historical governance | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** published content is never mutated in place; whether a change requires formal restatement remains unresolved. |
| `OD-CAREPORT-019` | Late-arriving-data restatement policy. | Reproducibility | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** late data never rewrites a published instance. No automatic restatement/publication is authorized. |
| `OD-CAREPORT-020` | Metric-version change restatement policy. | Historical comparability | **FAIL-CLOSED INTERIM:** published snapshots remain immutable; any corrected metric output requires a new instance. Whether that instance must be formally restated/published remains unresolved. |
| `OD-CAREPORT-021` | K2B provenance correction restatement policy. | Actual integrity | **FAIL-CLOSED INTERIM:** K2B corrections never rewrite published custody in place. A new instance is required if corrected facts are issued; publication/restatement policy remains unresolved. |
| `OD-CAREPORT-022` | Report retention duration by family/classification. | Archive | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no deletion authority is inferred from missing retention policy. |
| `OD-CAREPORT-023` | Draft/rejected report retention. | Audit | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** do not silently delete solely because retention is unresolved. |
| `OD-CAREPORT-024` | Allowed export formats by family. | Disclosure | **UNRESOLVED OWNER DECISION:** the architecture describes possible formats but grants no family-specific export authority. |
| `OD-CAREPORT-025` | Which report classes permit CSV export? | Data leakage | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no CSV export without explicit accepted export permission and report-definition allowance. |
| `OD-CAREPORT-026` | Restricted appendix export policy. | Sensitive data | **ACCEPTED UPSTREAM AUTHORITY + UNRESOLVED DETAIL:** CA-RBAC requires separate restricted access/assurance; no appendix export is authorized until exact report/export policy is accepted. |
| `OD-CAREPORT-027` | External sharing of Corporate reports. | Confidentiality | **FAIL-CLOSED INTERIM:** no external sharing authority exists until explicit Owner/report-family policy and CA-RBAC capability authorize it. |
| `OD-CAREPORT-028` | May external links be expiring/revocable? | Sharing model | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no external report-link creation is authorized. Expiring/revocable links are only a future design option. |
| `OD-CAREPORT-029` | Board/Strategy audience definition. | Legal/governance meaning | **ACCEPTED UPSTREAM BOUNDARY:** this is a management-report family, not a statutory/legal filing claim. Exact audience remains unresolved. |
| `OD-CAREPORT-030` | Whether Quarterly report is called “Board”, “Strategy” or both. | Legal semantics | **NON-BINDING CA-REPORT RECOMMENDATION:** retain the dispatched “Quarterly Board / Strategy” working label; it grants no legal Board authority. |
| `OD-CAREPORT-031` | Human commentary editing cutoff. | Approval integrity | **FAIL-CLOSED INTERIM:** substantive post-approval change invalidates the approval state under the report lifecycle; exact commentary cutoff policy remains unresolved. |
| `OD-CAREPORT-032` | Whether commentary may be corrected without full restatement. | Correction policy | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no in-place published-content mutation. Correction notice/new commentary lineage is architectural guidance; exact policy remains unresolved. |
| `OD-CAREPORT-033` | AI commentary policy. | Authority risk | **FAIL-CLOSED INTERIM:** AI commentary is disabled unless explicit Owner/report-family policy enables it. |
| `OD-CAREPORT-034` | If AI commentary enabled, required human-review level. | Safety/governance | **UNRESOLVED OWNER DECISION:** CA-REPORT recommends human review; because AI is disabled pending policy, this recommendation grants no publication authority. |
| `OD-CAREPORT-035` | Report approval SLA by family. | Workflow | **UNRESOLVED OWNER DECISION:** no SLA/breach threshold is created. |
| `OD-CAREPORT-036` | Final report-classification labels. | RBAC/export | **ACCEPTED UPSTREAM AUTHORITY:** use CA-RBAC data-classification classes; any report-specific labels remain unresolved and may not downgrade upstream classification. |
| `OD-CAREPORT-037` | Whether a report classification inherits the highest included metric/source classification. | Information security | **FAIL-CLOSED INTERIM:** absent a governed redacted derivative, the report may not be assigned a lower access classification than included content. Exact inheritance mechanics remain unresolved. |
| `OD-CAREPORT-038` | Whether published reports may be withdrawn. | Historical governance | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** withdrawal is disabled until explicit Owner policy authorizes it. If later authorized, withdrawal must be audited and must never delete historical custody. |
| `OD-CAREPORT-039` | Who may withdraw or restate published reports? | Custody | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no withdraw/restatement action authority is created here; require explicit privileged permission. |
| `OD-CAREPORT-040` | Whether strategically important unavailable slots stay visible in published reports. | Truth transparency | **UNRESOLVED OWNER DECISION:** the immutable report instance must preserve the true unavailable state; exact published-layout prominence remains unresolved. |
| `OD-CAREPORT-041` | How report-definition versions are approved/certified. | Change control | **NON-BINDING CA-REPORT RECOMMENDATION:** Data/Intelligence plus report-owner review is a proposed future model. No certification authority is created here. |
| `OD-CAREPORT-042` | Whether layout-only changes require report-definition version increment. | Version semantics | **NON-BINDING CA-REPORT RECOMMENDATION:** avoid semantic-version churn when meaning is unchanged; final versioning policy remains unresolved. |
| `OD-CAREPORT-043` | Whether ad-hoc reports may be shared inside a team before approval. | Shadow-report risk | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no team sharing beyond already accepted report-read/share authority. |
| `OD-CAREPORT-044` | When an ad-hoc report becomes an official management artifact. | Authority | **ACCEPTED REPORT-LIFECYCLE BOUNDARY:** generation alone is not publication. Official Published status requires the governed approval/publication path and explicit authority. |
| `OD-CAREPORT-045` | Whether Board/Executive publication requires strong future A2 assurance. | High-stakes publication | **ACCEPTED UPSTREAM AUTHORITY + UNRESOLVED DETAIL:** CA-RBAC defines A0/A1/A2, makes assurance fail closed, sets restricted-finance export/publish at A1 minimum, and lists executive/board/restricted report publication as an A1 candidate. CA-REPORT grants no new A1/A2 requirement; exact Board/Executive assurance remains unresolved. |
| `OD-CAREPORT-046` | Whether published report integrity hashes/signatures are required. | Tamper evidence | **NON-BINDING CA-REPORT RECOMMENDATION:** integrity hashing is recommended; no implementation/policy requirement is created here. |
| `OD-CAREPORT-047` | How current organisational-label changes are displayed on historical reports. | Archive readability | **ACCEPTED REPORT-SNAPSHOT BOUNDARY + UNRESOLVED DISPLAY:** historical scope snapshot remains immutable; showing a current alias beside it is optional and unresolved. |
| `OD-CAREPORT-048` | Whether report archive search can expose titles/metadata of forbidden reports. | Existence privacy | **FAIL-CLOSED INTERIM:** archive/search must not widen CA-RBAC or leak forbidden metadata merely through search. Exact non-enumeration UX remains unresolved. |
| `OD-CAREPORT-049` | Whether report PDF/slide exports may omit unavailable sections. | Truth preservation | **ACCEPTED EXPORT BOUNDARY + UNRESOLVED LAYOUT:** exports must preserve truth/degraded state for included required content. Whether an optional section may be omitted remains report-definition policy. |
| `OD-CAREPORT-050` | Who may certify comparison compatibility across metric versions. | Variance truth | **ACCEPTED UPSTREAM BOUNDARY:** report layer may not self-certify incompatibly versioned metrics. Exact approving actor/process under CA-METRIC/Data Intelligence remains unresolved. |
| `OD-CAREPORT-051` | Whether compliance/risk reports require a restricted appendix or separate report definition. | Classification | **NON-BINDING CA-REPORT RECOMMENDATION:** prefer separately gated restricted content. No appendix inclusion/export authority is created here. |
| `OD-CAREPORT-052` | Whether a published report may contain candidate metrics at all. | Executive ambiguity | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** candidates never become Actual. Generated/In-Review artifacts may preserve candidate state only where otherwise authorized. Publication of candidate content is disabled until explicit Owner/report-family policy permits it; a Pending/Diagnostic section alone is not authority. |
| `OD-CAREPORT-053` | How report actions/decisions required are tracked after publication. | Closed-loop management | **NON-BINDING CA-REPORT RECOMMENDATION:** future governed action-system linkage is desirable; no action-tracking implementation/policy is created here. |
| `OD-CAREPORT-054` | Whether report annotations/management decisions are themselves immutable after publication. | Audit | **ACCEPTED REPORT-LIFECYCLE BOUNDARY:** approved/published content is not mutated in place; exact correction annotation mechanics remain unresolved. |
| `OD-CAREPORT-055` | Whether daily/weekly reports automatically supersede prior report in same family. | Archive semantics | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** do not auto-supersede solely because a new period report exists. |
| `OD-CAREPORT-056` | How report scopes spanning multiple BUs/functions are represented. | Cross-BU reports | **NON-BINDING CA-REPORT RECOMMENDATION:** use an explicit enumerated scope snapshot; final representation policy remains unresolved. |
| `OD-CAREPORT-057` | Whether report currency presentation may show multiple source currencies side-by-side. | Finance readability | **ACCEPTED UPSTREAM BOUNDARY + NON-BINDING PRESENTATION RECOMMENDATION:** CA-FIN forbids ungoverned cross-currency aggregation. Side-by-side source-currency presentation is recommended, not mandated. |
| `OD-CAREPORT-058` | Whether external regulators/auditors receive Corporate report variants. | External authority | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no external variant/distribution authority until separate definition, access and legal policy are accepted. |
| `OD-CAREPORT-059` | Who owns recurring report schedules and missed-generation alerts. | Operations | **UNRESOLVED OWNER DECISION:** no scheduler ownership or automated publication authority is created. |
| `OD-CAREPORT-060` | Whether generated-but-unpublished report instances can be deleted. | Audit/storage | **UNRESOLVED OWNER DECISION / FAIL-CLOSED:** no deletion authority is inferred while retention/deletion policy is unresolved. |

---

# PART XVI — DOWNSTREAM INPUTS

## 30. Inputs for CA-PLAT

CA-PLAT should consume:

- report-definition registry as a governed control plane;
- explicit generate/review/approve/publish permissions;
- immutable report instance;
- export/share classification;
- audit requirements;
- no platform-admin implication of report publication rights;
- no technical provider admin implication of Corporate report access.

Platform implementation must preserve:

**Report permission ≠ source-domain mutation permission**

and:

**Platform Admin ≠ Reporting Publisher**

---

## 31. Inputs for CA-K3 implementation

CA-K3-01 remains active and must not be expanded by this task.

Later bounded report UI implementation should consume:

- CA-UX Reports page blueprint;
- report family registry;
- lifecycle states;
- immutable instance metadata;
- unavailable/degraded grammar;
- archive/search;
- report detail with custody;
- comparison validity;
- export permissions.

Do not implement reporting inside current CA-K3-01 unless separately dispatched by CA-MOD.

### 31.1 Suggested future K3 report slice

After reporting backend authority exists:

**CA-K3-REPORT-01 — Reports Read-Only Registry / Archive / Detail Foundation**

Possible bounded scope:

- report family list;
- report state filters;
- immutable detail rendering;
- lifecycle timeline;
- source/provenance metadata;
- no generate/publish mutation until backend and RBAC are separately certified.

---

## 32. Inputs for CA-CERT

CA-CERT should eventually prove:

### 32.1 Definition registry

- exact report definition version;
- required metric IDs exist;
- unsupported metric blocked;
- changed semantic definition creates new version.

### 32.2 Snapshot immutability

- published metric snapshots cannot change;
- report definition/metric versions remain frozen;
- source/as-of preserved;
- content integrity verifiable where implemented.

### 32.3 Availability truth

- measured zero exports zero;
- unavailable exports unavailable;
- no data remains no data;
- candidate remains candidate;
- degraded section visible.

### 32.4 K2B

- only operational rows enter Actual;
- non-operational excluded;
- UNKNOWN excluded;
- report layer cannot override classification.

### 32.5 Finance

- no GMV/revenue/cash/profit invented;
- product amounts correctly labelled;
- currency not summed without authority.

### 32.6 Growth

- accounts/inquiries/participants not universal customers;
- unlinked stages not conversion;
- attribution association not causality.

### 32.7 SoD

- generator cannot self-approve where forbidden;
- publisher permission separate;
- restricted export separate;
- report approval invalidated by substantive post-approval change.

### 32.8 Restatement

- original remains;
- new restated instance links backward;
- archive marks supersession/restatement;
- shared/exported historical IDs remain traceable.

### 32.9 Dashboard/report distinction

- historical report value remains fixed;
- live deep link visibly labelled current;
- live changes do not mutate report.

### 32.10 Export

- PDF/CSV carries report ID/version/period/scope/classification;
- unavailable semantics survive;
- restricted appendix export denied without permission.

---

# PART XVII — OPEN RISKS

## 33. Open risks

1. **Dashboard-screenshot relapse** — report may become a screenshot without version/provenance.
2. **Metric recomputation** — report backend may duplicate KPI formulas.
3. **Candidate promotion** — repeated candidate display may become implied Actual.
4. **Unavailable→zero** — export formatting may erase truth state.
5. **Metric-version drift** — draft and published report may bind different versions silently.
6. **Live-data mutation** — archive may render current metric instead of frozen snapshot.
7. **Source correction overwrite** — historical report may change in place.
8. **K2B override** — reporting logic may decide its own provenance eligibility.
9. **UNKNOWN leakage** — unknown rows may enter Actual during aggregate export.
10. **Customer overclaim** — accounts/inquiries may become customers in executive narrative.
11. **Conversion fabrication** — independent stage totals may appear as funnel.
12. **Attribution causality** — campaign association may become “campaign caused”.
13. **Finance fabrication** — listing/request/quote/milestone values may become revenue/GMV/cash.
14. **Currency aggregation** — mixed currencies may be summed.
15. **Product finance / accounting collapse** — Financial Services product facts may appear under Corporate Finance.
16. **Commentary authority bleed** — human note may override metric state.
17. **AI narrative authority bleed** — model output may look like approved factual narrative.
18. **Self-approval** — same user may generate/approve/publish high-stakes report.
19. **Export privilege escalation** — read permission may imply CSV/restricted export.
20. **Restricted appendix leakage** — aggregate report sharing may expose KYC/PII.
21. **Archive metadata leakage** — forbidden report titles may appear in search.
22. **Report deletion** — withdrawn/restated report may disappear instead of remaining auditable.
23. **Correction without lineage** — changed report may overwrite original URL/version.
24. **Late-data confusion** — current dashboard may disagree with published report without explanation.
25. **Materiality invention** — automated report may mark changes “material” without policy.
26. **Stale-source concealment** — report may publish old values as current.
27. **Partial-period comparison** — partial month may be compared with full month.
28. **Definition-version explosion** — cosmetic changes may create unnecessary semantic versions.
29. **Definition under-versioning** — semantic changes may occur without new version.
30. **Ad-hoc shadow metrics** — formula builder may create ungoverned KPIs.
31. **Ad-hoc PII export** — analyst scope may bypass report classification.
32. **Raw SQL path** — ad-hoc system may bypass metric registry.
33. **Board/legal overclaim** — “Board report” may imply statutory/legal filing authority.
34. **Report schedule overreach** — scheduler may publish without review.
35. **Publisher-as-owner conflation** — publishing authority may be assumed to own metric definitions.
36. **Report family scope collision** — one instance may mix incompatible BU/customer grains.
37. **Cross-BU customer summation** — report may sum BU relationship counts.
38. **Risk-score collapse** — multiple control domains may be reduced to one score.
39. **K3 collision** — active shell implementation may be expanded prematurely.
40. **Vehicle-report pattern overreuse** — existing public report-version table may be reused without Corporate classification/SoD design.
41. **Periodic-report pattern overreach** — current weekly/monthly seller summary may be mistaken for Corporate archive authority.
42. **CSV semantics loss** — downstream spreadsheet handling may drop status/version columns.
43. **External-sharing leakage** — public-style token links may expose Corporate data.
44. **Restatement ambiguity** — corrected commentary may be confused with corrected metrics.
45. **Approval stale-state** — source quality may materially deteriorate between approval and publication.
46. **Publication-after-change** — approved content may change before publish.
47. **Classification drift** — report classification may not track highest included content sensitivity.
48. **Historical-label rewriting** — current org labels may replace historical scope context.
49. **Export/view mismatch** — exported file may contain more detail than web report.
50. **Narrative-only decisions** — actions requested may not close into governed action tracking later.

---

# PART XVIII — STOP CONDITIONS

## 34. Stop conditions encountered

CA-REPORT stopped rather than guessing on:

- reporting timezone;
- fiscal versus calendar periods;
- report-family ownership;
- final SoD strictness;
- publication-blocking source failures;
- stale-source thresholds;
- partial-period publication;
- materiality;
- restatement thresholds;
- retention duration;
- final export formats;
- external sharing;
- Board/Strategy audience/legal meaning;
- AI commentary;
- approval SLA;
- withdrawal policy;
- classification labels;
- assurance level for high-stakes publication;
- future report database/schema;
- report scheduling implementation;
- any finance/customer metric not already authorized.

No statutory filing model was invented.

No report-generation backend/schema was created.

---

# PART XIX — RECOMMENDED NEXT TASK

## 35. Recommended next task

After CA-MOD independently accepts CA-REPORT-01, the recommended next architecture task is:

**CA-PLAT-01 — Corporate Platform / Security Administration Boundary & Migration Model**

Purpose:

- define future Platform/Admin control plane separately from Corporate Intelligence and Business Operations;
- map current \`admin\`, \`platform_admin\`, \`super_admin\`, feature governance, AI/model ops, provider health, communications delivery, security/session controls and integrations;
- consume CA-RBAC and CA-REPORT publication permissions;
- prevent Platform authority from becoming Corporate Finance/People/customer authority;
- prepare compatibility retirement without touching active K3 implementation prematurely.

A later CA-CERT task should then certify the cross-programme architecture and exact implementation slices.

---

## 36. Non-actions

CA-REPORT-01 made no changes to:

- web code;
- backend code;
- shared code;
- database/schema;
- report tables;
- report services;
- current routes;
- K2B;
- metrics;
- finance policy;
- customer policy;
- CA-K3-01;
- deployments;
- staging data;
- production.

This document does not self-accept.

CA-REPORT-01 CORPORATE REPORTING MODEL READY FOR MODERATOR REVIEW

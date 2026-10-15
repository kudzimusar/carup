# CA-METRIC-01 — CORPORATE METRIC REGISTRY / KPI SEMANTICS

FROM: CA-MOD
TO: CA-METRIC — Metric Governance & Data Semantics Agent
TASK: CA-METRIC-01
PROGRAMME: CA-1.0

## Binding authorities

- Canonical plan: 5d4997cacaff8068c4ec4c5ae78f562be4249344
- CA-ARCH-01 ACCEPTED: 7cae8c3c8c987714a8ca6db2128db3b9a589f141
- CA-ORG-01 ACCEPTED: 705eb6fa1cd89109977052e88e220f0498668060
- CA-RBAC-01 ACCEPTED: 4abdf95e1e1490b01f51cb45106a57fcf7b954b9
- Product snapshot for read-only inspection: 505ffcca6b641c8b3b55f503e0f4fd39d26710dc
- PC01-K2B-R1: ACTIVE / NOT ACCEPTED

Read in full:
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md

## MODERATOR AUTHORITY

AUTHORIZED — DOCUMENTATION / METRIC GOVERNANCE ONLY.

Do not modify product code, database, analytics events, K2B, deployments, or production.
Do not invent accounting formulas.
Do not treat the active K2B-R1 candidate as accepted authority.

## Objective

Create the canonical Corporate Metric Registry architecture that governs every KPI, chart, rate, rank, scorecard and management-report number used by Corporate Admin.

Prevent:
- duplicate definitions of the same business idea;
- test/UAT/automation data being presented as business truth;
- unavailable values appearing as zero;
- sandbox activity appearing as revenue;
- technical telemetry being mislabeled as business performance;
- clicks/views being mislabeled as customers;
- time-window and currency ambiguity;
- executive aggregates silently granting access to restricted source data.

## Required registry contract

Define mandatory fields including:

metric_id; canonical_name; business_definition; purpose; metric_type; truth_state; plane; corporate_domain; business_owner; data_steward; source_authority; source tables/services/projections; calculation authority; formula if governed; numerator/denominator; unit; currency semantics; time grain; default window; timestamp authority; organisational/geographic/BU dimensions; customer/entity grain; provenance dependency; inclusion/exclusion; null/unavailable semantics; freshness; lineage/version; quality state; classification; aggregate permission; drill-down permission; export implication; certification status; caveats; deprecation/replacement.

## Truth states

Define and distinguish at least:

GOVERNED_ACTUAL
GOVERNED_DERIVED
GOVERNED_RATE_OR_RATIO
ADVISORY
TECHNICAL_OPERATIONAL
CONTAMINATED_PENDING_K2B
INSUFFICIENT_DATA
UNAVAILABLE_NO_SOURCE
UNAVAILABLE_NOT_SEPARABLE
DUPLICATED_OR_CONFLICTING
UNKNOWN_AUTHORITY
DEPRECATED

Explicitly state:
0 != NO DATA != UNAVAILABLE != NOT SEPARABLE != FORBIDDEN.

## Inventory existing metric authority

Inspect current projections at the accepted product snapshot and map:
- Command Centre;
- Marketplace;
- Navigation Intelligence;
- Dealer;
- Garage / Service;
- Finance product / SafePay / escrow;
- Insurance;
- Diaspora / Trade / Logistics;
- Parts / PartSentry;
- Referral / Growth;
- Identity / Verification / Trust / Fraud;
- Communications;
- Platform / AI / feature governance.

For each, record:
source, current calculation, consumer, truth state, time semantics, provenance dependency, target Corporate Admin domain, and REUSE / WRAP / REPLACE / DEPRECATE recommendation.

Do not call finance applications, vehicle prices, escrow sessions or sandbox settlement corporate revenue/profit.

## Executive metric families

Define governed candidate families, marking missing sources honestly:

Corporate Overview:
customers; listings; public listings; inquiries/leads; conversion; revenue; gross profit; operating profit; cash; settlement exposure; risk/compliance backlog; service/network activity.

Customers & Growth:
registered, active, verified, new and returning customers; geography; acquisition source; referrals; search/navigation engagement; funnels; retention/churn.

Marketplace:
operational listings; actually-public listings; created/published listings; inquiries; saves; buyer/seller engagement; sold vehicles; time-to-publish/inquiry/sale.

Business-unit scorecards:
customers; demand; supply/capacity; throughput; conversion; revenue; gross profit; cost; risk; service quality; backlog; cycle time.
Not every BU must populate every slot.

## Customer grain

Define what account, customer, active customer, verified customer, buyer, seller, institutional partner, anonymous visitor, session, device, inquiry and lead mean.

Never assume:
page view = customer;
session = customer;
guest email = confirmed customer;
tenant = customer;
account = paying customer.

Use Owner Decision IDs where source authority is absent.

## Navigation / Data Intelligence

Define how navigation intelligence can support strategic management without vanity metrics.

Cover:
page/route views; authenticated visitors; anonymous visitors; searches; filter use; result views; detail views; saves; inquiry start/completion; seller create/start/complete; Check/Verify use; top routes/features; top searches; zero-result searches; abandonment; funnel progression.

Define treatment requirements for staff/self traffic, bots, CI/UAT/automation and UNKNOWN. K2B owns runtime provenance classification.

## Time / dimensions / access

Every metric must identify its timestamp authority and period semantics.

Consume CA-ORG dimensions:
Corporate parent, proven legal entity, BU, function, department, team, geography, cost centre, profit centre.

Consume CA-RBAC:
aggregate visibility is separate from record drill-down; Restricted Financial, Identity/Compliance, People-private and Security/Platform sources remain independently gated.

## Finance boundary

Prepare CA-FIN inputs distinguishing:
listing price; merchandise/listing value; GMV candidate; payment intent; escrow; sandbox escrow; live settlement; billing/invoice amount; recognized revenue; refund; cost; gross profit; operating expense; operating profit; cash receipt; receivable; payable.

Do not define accounting recognition rules.
Corporate accounting metrics without an authoritative source remain PENDING_CA_FIN / UNAVAILABLE_NO_SOURCE.

## Lineage / quality

Define metric versioning. Any formula, source, inclusion/exclusion, provenance, timestamp, currency/unit, scope or classification change must create a governed revision.

Define quality lifecycle:
DRAFT
SOURCE_IDENTIFIED
SEMANTICS_DEFINED
PROVENANCE_GATED
CERTIFIED
DEGRADED
BLOCKED
DEPRECATED

CA-CERT must later prove source, formula, time window, provenance, null semantics, access, reconciliation and version identity.

## Dashboard contract for CA-UX

Without designing UI, require:
- measured zero only when truly measured;
- unavailable never shown as zero;
- not-separable explicitly stated;
- stale data shows freshness;
- provisional/advisory data labeled;
- source/provenance discoverable;
- chart units/time periods explicit;
- comparisons use comparable definitions;
- drill-down follows RBAC;
- no red/green implication without target/baseline authority.

## Owner decisions

Create OD-CAMETRIC-* decisions for unresolved definitions including at minimum:
active customer; paying customer; anonymous inclusion; staff traffic; geography source; reporting timezone; reporting period; fiscal period; conversion funnel; sold-vehicle authority; accounting source; GMV; gross profit; BU KPI owners; targets/budgets; retention/churn; acquisition attribution; attribution window; navigation identity; freshness; historical restatement; UNKNOWN provenance; provisional executive metrics; cross-currency policy.

## Required deliverable

Create only:

docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md

Optional: one small machine-readable registry seed only if materially useful.

The document must clearly mark:
PROVEN CURRENT METRIC FACT
PROPOSED GOVERNED SEMANTIC
OWNER DECISION REQUIRED
PENDING_K2B
PENDING_CA_FIN

## K2B boundary

PC01-K2B-R1 is active and unaccepted.

CA-METRIC may define provenance requirements and PENDING_K2B dependencies.
CA-METRIC must not adopt unaccepted K2B implementation, classify staging rows, create another classifier, or bind final operational counts.

## Stop conditions

Stop rather than guess when:
- formula requires business/accounting policy;
- source is unknown;
- sources conflict;
- conclusion depends on unaccepted K2B;
- legal/accounting policy is required;
- entity grain cannot be determined;
- product mutation appears necessary.

## Return receipt

AGENT: CA-METRIC
TASK: CA-METRIC-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES INSPECTED
FILES CHANGED
PROVEN CURRENT METRIC FACTS
PROPOSED METRIC GOVERNANCE MODEL
PENDING_K2B ITEMS
PENDING_CA_FIN ITEMS
OWNER DECISIONS REQUIRED
OPEN QUESTIONS
DOWNSTREAM INPUTS
STOP CONDITIONS
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-METRIC-01 CORPORATE METRIC REGISTRY READY FOR MODERATOR REVIEW

Do not self-accept.

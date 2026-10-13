# CARUP CORPORATE RBAC MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-RBAC — Corporate Identity & Access Agent  
Task: CA-RBAC-01  
Status: CORPORATE ACCESS ARCHITECTURE / DOCUMENTATION ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This access model is produced under the following exact authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical programme authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted architecture input: CA-ARCH / CA-ARCH-01
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Accepted organisation input: CA-ORG / CA-ORG-01
- Accepted CA-ORG-01 authority: `705eb6fa1cd89109977052e88e220f0498668060`
- Current documentation starting head: `71e8450b80001fc69eeaa53402aa0aad98f058b6`
- Product/reference authority inspected read-only: PR #222 historical accepted product snapshot `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`
- Parallel provenance dependency: K2B — ACTIVE / not accepted into Corporate Admin authority

The live PR #222 head had advanced beyond the supplied product snapshot during execution. CA-RBAC-01 intentionally remained pinned to `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` and did not substitute later K2B/product state.

This document defines a **future Corporate Admin authorization architecture**. It does not implement permissions, database tables, route gates, account status, UI, provenance logic, or legal/employment facts.

---

## 2. Evidence posture

### PROVEN CURRENT AUTHORIZATION FACT

At the inspected product snapshot:

- `shared/types/index.ts` exposes a flat platform role vocabulary including `admin` alongside customer/participant roles.
- Backend `authorizeRole(...)` recognizes `admin`, `platform_admin` and `super_admin` as broad platform-admin compatibility roles; the platform role may bypass ordinary route allowed-role lists.
- Verified tenant context and tenant role are derived separately and re-checked against `tenant_users` / active tenant state.
- Only governed tenant roles may be lent into the effective role; tenant membership does not become general platform authority.
- `operationsAuthorizationService.js` already provides a named-capability seam for bounded Operations access instead of adding new raw role checks.
- Its compatibility map derives capabilities from server-derived platform/base role, not client-selected effective role.
- Consequential Operations capabilities require a proven session.
- `requireProvenIdentity()` blocks asserted-header identity from private-evidence paths unless explicitly allowed.
- `authenticationAssuranceService.js` and `stepUpMiddleware.js` provide session-derived assurance classes and recent re-authentication for sensitive/critical actions.
- At this snapshot, a real strong authenticator such as WebAuthn/passkey is not implemented; the current critical class therefore falls back explicitly to recent password re-authentication.
- Governed identity-lifecycle transitions and session revocation exist separately from the older Admin “suspend user” routes.
- Current Admin suspension routes are semantically inconsistent: one attempts to write `users.role='suspended'`, another attempts `users.status='Suspended'`. Neither is the future Corporate Admin membership/access lifecycle model.
- The primary audit service writes authoritative `trust_audit_events` with actor, target, request and change context; domain audit remains separate from future corporate access-governance audit.
- Existing external tenant, government, bank, insurance, dealer, mechanic and partner authorities are product/participant authorities, not proof of internal CarUp corporate membership.

### PROPOSED CORPORATE ACCESS MODEL

CA-RBAC proposes an additive capability-and-scope architecture in which final Corporate Admin authorization depends on:

**who × permission × internal organisation scope × data classification × geography × delegation × assurance × time**

No title, legacy role, navigation item, tenant membership or organisational membership alone grants final authority.

### OWNER DECISION REQUIRED

Unresolved access-policy choices are assigned `OD-CARBAC-###` identifiers in section 21. Safe defaults are fail-closed and least-privilege.

---

## 3. Core security invariants

1. **Identity is not authority.** Authentication establishes who is present; authorization separately establishes what they may do.
2. **Title is not authority.** CEO, CFO, COO, Director, Manager, Analyst, Operator and Admin labels are descriptive only.
3. **Membership is not permission.** Belonging to a BU/function/team does not by itself grant read or mutation rights.
4. **Permission is not scope.** A capability is ineffective without matching organisational, data, geography and time scope.
5. **Aggregate access is not record access.** Seeing company totals never implies access to the underlying PII, evidence, employee files, financial line items or secrets.
6. **Internal corporate scope is not external tenant scope.** `tenant_users` / partner/provider authority remains a different namespace.
7. **Client-selected context never grants authority.** Context selection may narrow or choose among server-proven grants; it must not mint a grant.
8. **Sensitive actions require stronger assurance.** Authentication assurance is cumulative with capability checks, not a substitute.
9. **Delegation cannot amplify authority.** A delegator cannot give what they do not hold and cannot delegate around explicit denials or segregation-of-duties controls.
10. **No self-grant.** A subject cannot approve or activate their own new privileged access.
11. **No standing break-glass.** Emergency authority is short-lived, explicit, high-assurance and reviewed.
12. **Fail closed on authority uncertainty.** Missing membership, unreadable permission state, expired delegation, unknown classification or ambiguous scope does not grant access.
13. **Domain services remain mutation authorities.** Corporate Admin permission authorizes entry to a governed action; it does not replace the domain decision rules.
14. **K2B remains provenance authority.** Permission to see operational data never decides whether a row is real operational truth.
15. **Navigation never grants.** Server authorization must match or be stricter than navigation visibility.

---

## 4. Canonical identity and authority namespaces

Corporate Admin must preserve the following independent namespaces.

### 4.1 BASE IDENTITY

**Question:** Who is the human/account principal?

Conceptually contains:

- immutable/internal subject identifier;
- authentication credentials/methods;
- identity/account lifecycle status when a future authoritative account model exists;
- session state;
- identity-proofing state where required.

It must not encode all Corporate Admin authority in `users.role`.

A single base identity can simultaneously hold internal Corporate membership, external tenant membership, legacy platform role and delegated authority without those namespaces overwriting one another.

### 4.2 LEGACY PLATFORM ROLE

**Question:** Which current platform compatibility role does the runtime recognize?

Examples at the inspected snapshot include:

- `admin`;
- customer/participant roles such as `owner`, `dealer`, `mechanic`, `bank`, `insurance` and `government`;
- backend compatibility aliases `platform_admin` / `super_admin`.

Legacy platform role remains a migration/runtime concept. It is not the target Corporate Admin access model.

### 4.3 INTERNAL CORPORATE MEMBERSHIP

**Question:** Where does the person belong inside CarUp?

Consume CA-ORG / CA-ORG-01 and support:

- one home organisational unit;
- zero or more matrix assignments;
- internal organisation path;
- legal-entity association only when proven;
- BU/function/department/team placement;
- geographic responsibility;
- employment/contract relationship class when an authoritative source exists;
- start/end dates;
- active/inactive/suspended membership state.

Internal membership must not be inferred from `tenant_users` or legacy `organizations`.

### 4.4 CORPORATE PERMISSION ASSIGNMENT

**Question:** Which stable capabilities are assigned?

An assignment conceptually contains:

- one permission set or explicit permission subset;
- assignment source/authority;
- internal organisation scope;
- data scope/classification;
- geography;
- effective time window;
- assurance requirement override only when policy permits;
- optional delegation reference;
- approval/audit metadata;
- lifecycle state.

A permission assignment is independent of title.

### 4.5 ORGANISATIONAL SCOPE

**Question:** Over which internal organisational nodes may the permission operate?

Examples:

- corporate root;
- one legal entity;
- one BU;
- one corporate function;
- one department;
- one team;
- explicit cross-BU control scope;
- own organisational unit only.

Organisational scope is internal only. External tenants are not children of this tree.

### 4.6 DATA SCOPE / CLASSIFICATION

**Question:** Which information class and grain may be accessed?

Access must distinguish at least:

- aggregate;
- record-level;
- PII-bearing;
- evidence/document-bearing;
- financial line item;
- employee/private People record;
- security/platform secret/configuration;
- audit metadata;
- own record;
- assigned case/queue;
- explicitly cross-unit control data.

Data classification is described in section 9.

### 4.7 GEOGRAPHIC SCOPE

**Question:** In which country/region/market may the assignment apply?

Geography is a narrowing dimension, not automatically a parent in the organisation tree.

Examples:

- GLOBAL;
- one country;
- one region;
- explicit market set.

Unknown geography never widens access.

### 4.8 DELEGATED AUTHORITY

**Question:** Is this permission temporarily exercised on another person's/role's authority?

Delegation is a bounded derivative assignment with:

- delegator;
- delegate;
- permission subset;
- organisation scope;
- data/geographic scope;
- reason;
- start/end;
- assurance requirement;
- approval;
- revocation state;
- immutable audit linkage.

Delegation never changes the delegate's base title or permanent membership.

### 4.9 EXTERNAL TENANT / PARTNER AUTHORITY

**Question:** What may the principal do for an external organisation or partner relationship?

Existing tenant/partner/provider authority remains independent:

- `tenant_users` roles;
- verified selected tenant;
- partner API scopes;
- provider/institution-specific authority;
- government/reviewer paths.

An internal CarUp employee may also have an external operational tenant context, but that does not expand internal Corporate Admin scope.

### 4.10 ASSURANCE CONTEXT

**Question:** Is the person authenticated strongly and recently enough for this action?

This is derived from server-held authentication/session facts, never from a client-declared value.

### 4.11 CURRENT BUSINESS CONTEXT

**Question:** Which one of the principal's already-authorized scopes is currently selected for the request?

Context selection narrows/chooses. It does not grant.

---

## 5. Canonical access-decision model

### 5.1 Conceptual expression

A Corporate Admin request is authorized only when all required dimensions are satisfied:

`ALLOW =
  authenticated(subject)
  AND account_is_usable(subject)
  AND permission_granted(subject, action, resource)
  AND organisation_scope_matches(subject, resource)
  AND data_scope_allows(subject, resource.classification, resource.grain)
  AND geography_matches(subject, resource.geography)
  AND delegation_valid_if_used(subject, action, resource)
  AND assurance_satisfies(subject.session, action.required_assurance)
  AND time_window_active(subject.assignment, delegation)
  AND segregation_of_duties_allows(subject, action, resource)
  AND domain_authority_allows(action, resource)
  AND provenance_visibility_allows(resource)`

The last provenance term is **PENDING_K2B** where operational/test distinction is relevant.

If any mandatory dimension is unknown/unreadable, the decision fails closed for the protected action.

### 5.2 Required decision inputs

| Dimension | Required question | Examples |
| --- | --- | --- |
| Subject | Who is acting? | base user/person ID, session |
| Permission | What capability is requested? | `corporate.finance.restricted.read` |
| Resource/action | What is being read/changed? | report, queue, case, access grant |
| Internal org scope | Which CarUp unit owns/is affected? | corporate, BU, function, department, team |
| Data classification | How sensitive is the resource? | Internal, Restricted Financial |
| Data grain | Aggregate or record-level? | company KPI vs customer row |
| Geography | Which market/country? | GLOBAL, ZW, JP |
| Delegation | Permanent or delegated authority? | delegation ID / chain |
| Assurance | How strongly/recently authenticated? | A0/A1/A2 |
| Time | Is assignment/delegation active now? | effective_from / expires_at |
| SoD context | Is actor prohibited due to conflicting role in this transaction? | preparer vs approver |
| External context | Does a separate tenant/partner relationship apply? | verified tenant, partner scope |
| Domain authority | Does owning service permit the action? | identity review policy, feature governance policy |
| Provenance | Is this data eligible for this view? | operational vs UAT, PENDING_K2B |

### 5.3 Explicit deny conditions

Access must be denied when:

- the permission exists but the organisational scope does not match;
- aggregate permission is used to request record-level data;
- a data-classification ceiling is exceeded;
- an assignment or delegation has expired/suspended/revoked;
- geography is outside allowed scope;
- required assurance is not met;
- SoD policy prohibits the specific action;
- the current context was merely asserted by the client and not server-verified;
- the domain service refuses the operation;
- authority state cannot be read reliably.

---

## 6. Permission architecture

### 6.1 Naming convention

Use stable capabilities, not job-title checks.

Recommended pattern:

`<plane>.<domain>.<resource>.<action>`

Where:

- `plane`: `corporate`, `platform`, optionally `access` for access-governance primitives;
- `domain`: stable business/governance domain;
- `resource`: object or information surface;
- `action`: `read`, `read_aggregate`, `read_private`, `review`, `act`, `manage`, `generate`, `publish`, `approve`, `export`, `delegate`, `audit`.

Data classification and organisational scope should normally remain assignment attributes rather than be duplicated into every capability name. Distinct capability names are appropriate when aggregate and restricted record access are materially different authorities.

### 6.2 Corporate permission taxonomy

#### Corporate overview / BU intelligence

- `corporate.overview.read`
- `corporate.business_unit.read`
- `corporate.business_unit.compare`
- `corporate.operations.summary.read`

These are aggregate/read-oriented by default and do not imply private drill-down.

#### Finance

- `corporate.finance.summary.read`
- `corporate.finance.restricted.read`
- `corporate.finance.line_item.read`
- `corporate.finance.export`
- `corporate.finance.period.manage`
- `corporate.finance.approval.act`

Exact accounting action semantics belong to CA-FIN.

#### Customers & Growth

- `corporate.customer.aggregate.read`
- `corporate.customer.pii.read`
- `corporate.growth.aggregate.read`
- `corporate.growth.campaign.read`
- `corporate.growth.campaign.manage`

#### Operations

- `corporate.operations.queue.read`
- `corporate.operations.case.read`
- `corporate.operations.case.act`
- `corporate.operations.escalation.manage`

These are Corporate Admin-facing capabilities; existing domain Operations capabilities remain compatibility/domain inputs during migration.

#### Trust / Risk / Compliance

- `corporate.risk.aggregate.read`
- `corporate.risk.case.read`
- `corporate.risk.case.review`
- `corporate.compliance.evidence.read`
- `corporate.compliance.decision.act`
- `corporate.audit.domain.read`

Owning domain services retain final decision authority.

#### People & Access

- `corporate.people.aggregate.read`
- `corporate.people.private.read`
- `corporate.people.membership.manage`
- `corporate.people.access.read`
- `corporate.people.access.request`
- `corporate.people.access.approve`
- `corporate.people.access.revoke`
- `corporate.people.delegation.manage`
- `corporate.people.session.revoke`

No permission here implies direct mutation of `users.role`.

#### Data & Intelligence

- `corporate.metric.registry.read`
- `corporate.metric.registry.manage`
- `corporate.intelligence.aggregate.read`
- `corporate.intelligence.lineage.read`
- `corporate.data.quality.read`

Metric/formula authority belongs to CA-METRIC.

#### Reports

- `corporate.report.generate`
- `corporate.report.read`
- `corporate.report.export`
- `corporate.report.publish`
- `corporate.report.approve`

Generation and publication are separate authorities.

### 6.3 Platform permission taxonomy

- `platform.health.read`
- `platform.feature.read`
- `platform.feature.manage`
- `platform.integration.read`
- `platform.integration.manage`
- `platform.provider.read`
- `platform.provider.manage`
- `platform.ai.read`
- `platform.ai.manage`
- `platform.security.read`
- `platform.security.manage`
- `platform.security.session.revoke`
- `platform.audit.read`

Platform capabilities do not imply corporate-finance, People or identity-evidence access.

### 6.4 Access-governance capabilities

For the future access-control plane:

- `access.assignment.read`
- `access.assignment.request`
- `access.assignment.approve`
- `access.assignment.revoke`
- `access.delegation.read`
- `access.delegation.approve`
- `access.delegation.revoke`
- `access.break_glass.request`
- `access.break_glass.approve`
- `access.break_glass.review`
- `access.review.read`
- `access.review.certify`

These are conceptual. No schema/route implementation is authorized by this document.

### 6.5 Permission-set rules

A permission set is a named bundle for manageability, not a magical role.

Required properties:

- stable ID;
- version;
- included capabilities;
- allowed scope types;
- default data-classification ceiling;
- required assurance floor;
- delegability policy;
- incompatibility/SoD tags;
- lifecycle status;
- owner/approver class;
- audit version.

Permission sets may be combined only when the resulting set does not violate explicit incompatibilities.

---

## 7. Role archetypes and permission bundles

Archetypes are templates for assignment; titles never grant authority.

| Archetype | Typical conceptual capabilities | Typical scope | Explicit exclusions by default |
| --- | --- | --- | --- |
| `EXECUTIVE_READ` | Corporate overview, BU aggregate, finance summary, growth aggregate, risk aggregate, reports read | Corporate | No record-level PII/evidence, People private records, platform mutation |
| `CEO_EXECUTIVE_LEAD` | EXECUTIVE_READ + approved strategic reports | Corporate | No automatic feature/security/access mutation; no automatic restricted record access |
| `COO_OPERATIONS_EXECUTIVE` | Cross-BU operations summary/queue read, BU aggregates, escalations | Corporate/assigned operating scope | No automatic Finance restricted line items, People private data or platform secrets |
| `CFO_FINANCE_EXECUTIVE` | Finance summary/restricted financial reporting, approved exports subject to policy | Corporate/financial scope | No identity evidence, People private records, feature/security mutation by title |
| `BU_LEAD` | BU scorecards, BU operations, assigned customer/growth aggregates | One BU + children | No sibling BU, central People/Platform, restricted compliance evidence unless separately granted |
| `FUNCTION_LEAD` | Function-specific management and reports | One corporate function, possibly matrix scope | No unrelated BU/domain powers |
| `DEPARTMENT_MANAGER` | Department/team metrics and bounded operational management | Department + child teams | No parent/sibling scope automatically |
| `CORPORATE_ANALYST` | Governed aggregate intelligence, report generation | Explicit corporate/BU scopes | No mutation, no private record access unless separately assigned |
| `BU_ANALYST` | BU aggregate/lineage/report read | One BU | No cross-BU or mutation |
| `OPERATOR` | Queue/case read and specific domain action | Assigned BU/department/queue | No strategic/global data, no access administration |
| `COMPLIANCE_REVIEWER` | Assigned identity/evidence/risk case read/review | Explicit cross-BU control scopes | No feature/platform mutation, no People access administration |
| `PEOPLE_ADMIN` | People membership lifecycle, permitted People records | People function / assigned internal units | No security policy or finance detail by default |
| `ACCESS_ADMIN` | Access request/assignment/revocation administration | Explicit corporate scope | Cannot self-approve; no automatic domain-data access |
| `PLATFORM_ADMIN` | Platform feature/integration/provider/health administration | Platform | No customer PII, People private data or executive finance detail by default |
| `SECURITY_ADMIN` | Security configuration, session/access security actions, security audit | Security scope | No corporate finance/business mutation by default |
| `DATA_INTELLIGENCE_ADMIN` | Metric registry/data-quality/lineage administration | Data & Intelligence | No source business mutation; restricted source-row access separately granted |
| `REPORTING_PUBLISHER` | Report publication after governed preparation/approval | Explicit reporting scope | No automatic source-record access beyond what report task requires |
| `READ_ONLY_AUDITOR` | Governed audit/read permissions | Explicit audit scope/time window | No mutation; sensitive raw data minimized/redacted unless explicitly approved |

### 7.1 Same title, different authority

Two “Marketplace Directors” may differ:

- Person A: `BU_LEAD` over `BU_MARKETPLACE`, ZW only, aggregate + operations case read.
- Person B: `BU_LEAD` over `BU_MARKETPLACE`, GLOBAL, aggregate only.

The title does not decide the difference; the permission assignments and scopes do.

### 7.2 Multiple sets without omnipotence

One person may hold:

- `BU_LEAD` over Marketplace;
- `REPORTING_PUBLISHER` over Marketplace monthly reports;
- temporary `COMPLIANCE_REVIEWER` delegation for a specific case set.

The effective authority is the union of valid grants **within each grant's own scope/classification/time**, not a flattened “admin everything” role.

---

## 8. Permission evaluation and explicit scope composition

### 8.1 Grant structure

A conceptual grant should answer:

- subject;
- permission set/version or capability;
- internal organisation root;
- descendant inheritance flag;
- explicit included/excluded org nodes;
- data classification ceiling;
- record grain;
- geographic set;
- business context;
- delegation ID if applicable;
- assurance floor;
- start/end;
- approval source;
- lifecycle state.

### 8.2 Intersection, not accidental union, across dimensions

Within one grant:

`effective_scope = organisation_scope ∩ data_scope ∩ geography ∩ time ∩ assurance ∩ delegation_scope`

Across multiple grants, each grant is evaluated independently. The system must not combine one grant's broad organisation scope with another grant's broad data scope to create an authority no single approved grant intended.

Example:

- Grant 1: Marketplace-wide aggregate access.
- Grant 2: Finance-team private line-item access.

These must **not** combine into Marketplace-wide private financial line-item access.

This “no cross-grant privilege synthesis” rule is a core design invariant.

---

## 9. Data classification enforcement

Consume the programme classifications:

1. **Public**
2. **Internal**
3. **Internal Confidential**
4. **Restricted Financial**
5. **Restricted Identity/Compliance**
6. **Restricted Security/Platform**

Classification is independent of organisation scope.

### 9.1 Classification and grain matrix

| Information | Typical classification | Aggregate access | Record-level access | Default rule |
| --- | --- | --- | --- | --- |
| Public marketplace facts | Public | May be broadly visible | Public-record detail only | Public policy governs |
| Corporate KPI totals | Internal / Internal Confidential | Executive/analyst permission may allow | Underlying rows separately authorized | Aggregate grant never grants rows |
| Customer counts/cohorts | Internal Confidential | Executives/growth analysts may receive aggregates | Customer PII requires `corporate.customer.pii.read` or equivalent | Pseudonymize/minimize by default |
| Customer PII | Internal Confidential or stricter by context | Not exposed merely to derive totals | Explicit record permission + scope | Least privilege |
| Revenue/GMV/margin summary | Restricted Financial or governed aggregate classification decided by CA-FIN | CFO/executive summary may be allowed | Financial line items require separate restricted permission | Summary ≠ ledger/line-item access |
| Financial line items/settlements/receivables | Restricted Financial | Aggregate/report permission insufficient | Explicit restricted permission, scope, assurance | Export may require stronger control |
| Employee/private People records | Internal Confidential / People-restricted treatment | Aggregate headcount may be allowed | Explicit People private permission | Executives do not automatically receive employee files |
| Identity/KYC evidence | Restricted Identity/Compliance | Aggregate status may be allowed | Explicit evidence permission + high assurance | Signed/private documents require stronger gate |
| Fraud/compliance cases | Restricted Identity/Compliance | Risk aggregate may be allowed | Explicit case scope/review permission | Cross-BU control scope must be explicit |
| Platform configuration | Restricted Security/Platform | High-level health may be Internal | Config/secrets require Platform/Security permission | Business executives do not inherit |
| Secrets/credentials | Restricted Security/Platform | Never exposed as aggregate raw values | Direct secret read should generally remain unavailable; controlled secret operations instead | Do not surface secret material |
| Audit events | Internal Confidential / restricted based on contents | Audit summaries possible | Raw event access explicitly scoped/redacted | Audit access is not universal access to embedded data |

### 9.2 Aggregate versus record-level invariant

A permission such as `corporate.customer.aggregate.read` may authorize:

- customer count;
- conversion rate;
- retention cohort;
- region-level distribution.

It must not authorize:

- names;
- emails;
- phones;
- identity documents;
- individual communications;
- individual case notes.

Similarly, `corporate.finance.summary.read` may authorize a governed revenue/margin summary without granting `corporate.finance.line_item.read`.

### 9.3 Classification ceilings

Each grant should declare the highest classification and grain it permits. A permission-set default is a ceiling, not an entitlement to every resource at that classification.

### 9.4 K2B provenance categories

CA-RBAC may later gate visibility of:

- operational;
- test/UAT/certification;
- historical;
- unknown/requires-review

datasets, but K2B decides classification of runtime rows. All provenance-specific enforcement here is **PENDING_K2B**.

---

## 10. Organisational-scope inheritance

Consume CA-ORG / CA-ORG-01 internal hierarchy.

### 10.1 Safe default inheritance

An explicit grant on an internal organisational node may include descendants only when `include_descendants=true` is part of the grant/policy.

Examples:

- `BU_MARKETPLACE` scope can include Marketplace departments/teams.
- A department scope can include its teams.
- A team scope does not inherit parent/sibling authority.

### 10.2 Non-inheritance boundaries

Parent scope must not automatically cross into:

- central corporate functions outside the granted tree;
- sibling BUs;
- external tenants/partners;
- a different legal entity merely because the same brand/product appears there;
- a different geographic scope;
- a higher data classification;
- another control function's restricted cases.

### 10.3 Legal entity versus BU

Legal entity and BU are separate dimensions. Where a BU spans legal entities or a legal entity contains several BUs, the access decision must use the approved combination rather than infer one from the other.

Exact legal relationships remain subject to CA-ORG Owner Decisions.

### 10.4 Geography

Geography narrows the organisational grant:

`BU_MARKETPLACE + ZW` does not grant Marketplace in another country.

A Corporate/Global grant must be explicit.

### 10.5 Explicit exclusions

A broad parent grant may carry explicit exclusions for particularly sensitive child units or datasets.

Example:

Corporate Executive read scope may include all BU aggregates while excluding raw People, Identity/Compliance and Security datasets.

---

## 11. Matrix and shared-function authority

Central functions act across BUs through explicit matrix/control scopes rather than duplicated organisational membership.

### 11.1 Ownership dimensions

The access model must distinguish:

- **operating owner** — runs the business workflow;
- **control owner** — governs/assures policy and compliance;
- **data steward** — governs data definition/quality/lineage;
- **reporting owner** — owns recurring management/report publication;
- **access owner** — approves/owns access policy for a resource/scope.

These roles may belong to different internal units.

### 11.2 Example: Marketplace evidence

- Marketplace: operating owner for listing/commerce workflow.
- Trust/Risk/Compliance: control owner for evidence/risk review.
- Data & Intelligence: data/metric steward where applicable.
- Marketplace or Reports function: reporting owner depending on report.
- Security/Access governance: access-control oversight for sensitive permissions.

A compliance reviewer receives explicit cross-BU/control scope; they are not made a member of every BU.

### 11.3 Central Finance

Finance & Accounting may have cross-BU access to governed financial data without gaining operational mutation rights in every BU.

### 11.4 Data & Intelligence

Data & Intelligence may manage metric registry/lineage across BUs without inheriting unrestricted customer/identity/source-row access. Source-level private access is separately granted.

### 11.5 People & Administration

People administrators may manage corporate membership placement without automatically gaining Security Admin or domain Operations capability.

### 11.6 Security

Security may receive independent security/audit scope across the enterprise without inheriting business-finance authority.

---

## 12. Delegated authority model

### 12.1 Delegation record semantics

A future delegation must contain:

- delegation ID;
- delegator subject;
- delegate subject;
- original permission source;
- exact permission/capability subset;
- organisation scope;
- data-classification/grain ceiling;
- geography;
- business context;
- effective-from;
- expires-at;
- reason;
- approving authority if required;
- required assurance;
- status;
- created/revoked timestamps;
- immutable audit reference.

### 12.2 Delegation rules

1. No self-grant.
2. Delegator must currently hold the permission being delegated.
3. Delegated scope must be equal to or narrower than delegator scope.
4. Delegated classification/grain must be equal to or narrower than delegator's.
5. Delegation must not bypass SoD restrictions.
6. Delegation must not bypass explicit denial.
7. Delegation must have an expiry.
8. Delegation stops immediately when revoked or when the source grant becomes inactive, unless policy explicitly establishes an independent approved grant.
9. Delegation of access-administration, Security or restricted-finance permissions may require separate approver/dual control.
10. Delegation must never mutate title or legacy platform role.
11. Client-side “switch role” is not delegation. Future internal context selection chooses among existing server-approved assignments.

### 12.3 Delegation duration

Maximum duration remains Owner Decision `OD-CARBAC-004`. Safe default: short, explicit duration; no indefinite delegation.

---

## 13. Access, membership, account and session lifecycle

These lifecycles are distinct.

### 13.1 Corporate permission-assignment lifecycle

`REQUESTED → APPROVED → ACTIVE → SUSPENDED / REVOKED / EXPIRED`

Rules:

- REQUESTED grants nothing.
- APPROVED grants nothing until all activation conditions/effective time are satisfied.
- ACTIVE may authorize within exact scope.
- SUSPENDED temporarily grants nothing.
- REVOKED permanently grants nothing from that assignment.
- EXPIRED grants nothing after end time.

### 13.2 Corporate membership lifecycle

Conceptually:

`PENDING → ACTIVE → SUSPENDED → ENDED`

Membership suspension removes authority that depends on that membership but does not necessarily disable the person's entire CarUp account or external tenant relationships.

### 13.3 Base account lifecycle

A future authoritative account lifecycle must be separate from `users.role`.

Conceptually:

- ACTIVE;
- DISABLED;
- SECURITY_HOLD;
- CLOSED/ENDED where business policy requires.

Exact states/source remain unresolved. Current identity-lifecycle state is a separate governed identity-proofing/capability concept and must not be silently reused as corporate employment/access status.

### 13.4 Session lifecycle

Sessions independently have:

- valid;
- revoked;
- expired.

Current `user_sessions.is_valid` already provides a real revocation contract at the inspected snapshot.

### 13.5 External tenant membership lifecycle

External `tenant_users` membership remains independently governed. Revoking Corporate Admin membership does not automatically revoke an external dealer/garage membership unless a separate authorized business/security action does so.

---

## 14. Suspension and access-removal semantics

### 14.1 ACCOUNT DISABLE

Meaning: base CarUp account may no longer authenticate/use protected account capabilities.

Expected effect:

- terminate/revoke all active sessions;
- block new sessions;
- invalidate all Corporate Admin grants through account usability gate;
- preserve historical audit;
- external tenant authority becomes unusable through that disabled identity even if membership rows remain.

Implementation semantics require future authority.

### 14.2 CORPORATE MEMBERSHIP SUSPEND

Meaning: person remains a CarUp account but temporarily cannot exercise authority derived from one internal corporate membership.

Expected effect:

- deny grants whose scope depends on that membership;
- do **not** mutate `users.role`;
- do not automatically destroy external tenant membership;
- session revocation policy depends on sensitivity and remains `OD-CARBAC-020`.

### 14.3 PERMISSION REVOKE

Meaning: one permission assignment/bundle is removed.

Expected effect:

- permission ceases immediately for new decisions;
- no automatic unrelated membership removal;
- session termination may not be necessary if every request re-evaluates active grants, but sensitive access revocation may additionally revoke sessions under policy.

### 14.4 SESSION REVOKE

Meaning: invalidate one/some/all active authentication sessions.

Expected effect:

- immediate authentication interruption for those sessions;
- does not by itself remove membership or future permission assignments;
- current product already supports governed session revocation.

### 14.5 EXTERNAL TENANT MEMBERSHIP REVOKE

Meaning: remove/restrict authority inside an external participant organisation.

Expected effect:

- external context no longer valid;
- no automatic change to internal Corporate Admin placement;
- current tenant context should continue to be re-verified independently.

### 14.6 Broken legacy “suspend” controls

The future Corporate Admin must not model suspension by writing a new pseudo-role such as `users.role='suspended'` or assuming an ungoverned `users.status` field is the authority.

---

## 15. Assurance and step-up model

### 15.1 Conceptual classes

| Corporate class | Meaning | Current snapshot analogue | Typical use |
| --- | --- | --- | --- |
| `A0_STANDARD` | Proven ordinary authenticated session | session / ordinary_action | normal read, low-risk navigation |
| `A1_RECENT_REAUTH` | Proven session + recent credential re-authentication | recent_reauth / sensitive_action | restricted evidence read, sensitive decisions, access changes |
| `A2_STRONG` | Proven session + phishing-resistant or otherwise approved stronger authenticator, when implemented | not currently available at snapshot | highest-risk security/access/finance/break-glass actions |

The existing product's `critical_authority_action` currently falls back to recent password re-authentication because no strong authenticator is implemented. Corporate Admin must not label that fallback as A2.

### 15.2 Typical assurance requirements

Safe defaults:

- ordinary aggregate read: A0;
- customer PII / People private read: A1 candidate;
- identity evidence preview/review: A1 minimum;
- access grant/revoke for privileged sets: A1 minimum, potentially A2/dual control;
- restricted finance export/publish: A1 minimum; A2/dual control pending policy;
- provider/security configuration: A1 minimum; critical changes may require A2;
- break-glass: A2 target, with interim policy explicitly governed if A2 unavailable;
- report publication: A1 candidate where report is executive/board/restricted.

### 15.3 Assurance is not permission

Meeting A1/A2 grants nothing unless all permission/scope/classification conditions also pass.

### 15.4 Fail-closed

If assurance state cannot be read, the sensitive action should fail closed rather than silently downgrade.

---

## 16. Segregation of duties

These are governance safeguards; this document does not claim an external legal mandate unless separately established.

### 16.1 MVP-required controls

| Control | MVP posture |
| --- | --- |
| Access requestor ≠ sole approver for their own privileged access | Required |
| Access grant actor ≠ grantee for self-grant | Required |
| Report preparer ≠ publisher for designated executive/board/restricted reports | Required for designated sensitive publications |
| Identity/compliance reviewer ≠ Access Admin for the same subject-sensitive decision where conflict exists | Required policy safeguard |
| Break-glass request/use ≠ sole post-use reviewer | Required |
| Permission revoke/suspension events are auditable | Required |
| Security-sensitive configuration requires auditable named actor and assurance | Required |

### 16.2 Strongly recommended / policy-dependent

| Control | Posture |
| --- | --- |
| Finance preparer ≠ finance approver for material transactions/report approval | Required when CA-FIN defines material approval workflows; exact boundary pending |
| Feature/integration operator ≠ Security approver for critical security-affecting changes | Recommended / policy-dependent |
| Access administrator ≠ access auditor/certifier for their own changes | Recommended, becoming required for privileged reviews |
| Metric definition editor ≠ final report publisher for sensitive board metrics | Recommended where material |

### 16.3 SoD tags

Permission sets should be able to carry incompatibility tags so the authorization/governance layer can detect combinations such as:

- `ACCESS_GRANTOR` + `SELF_APPROVER`;
- `REPORT_PREPARER` + `REPORT_PUBLISHER` where dual control is required;
- `FINANCE_PREPARER` + `FINANCE_APPROVER` for governed material actions;
- `BREAK_GLASS_USER` + `BREAK_GLASS_REVIEWER` on the same event.

Exact combinations remain policy decisions, not implementation in this task.

---

## 17. Break-glass emergency access

### 17.1 Purpose

Emergency access is a narrowly bounded mechanism for exceptional incidents when normal access cannot resolve urgent risk.

### 17.2 Required properties

A future break-glass grant must have:

- named emergency permission set;
- specific incident/reason reference;
- exact subject;
- exact capability subset;
- narrow organisation/data/geographic scope;
- short expiry;
- high assurance;
- explicit approval unless an Owner-approved emergency self-activation policy exists;
- no delegation;
- immutable audit;
- prominent active state;
- automatic expiry;
- post-use review by a different reviewer;
- evidence of actions executed while active.

### 17.3 No standing emergency admin

There must be no permanent “break glass super admin” assigned for convenience.

### 17.4 Strong-authenticator gap

Because the inspected product snapshot has no strong authenticator, any implementation before A2 exists would need an explicit Owner-approved interim control. This remains `OD-CARBAC-008` and `OD-CARBAC-019`.

---

## 18. Corporate access audit model

Corporate access audit complements, not replaces, domain audit.

### 18.1 Access-governance events

Future audit must be able to answer:

- who requested access;
- who approved it;
- who granted/activated it;
- what permission set/version/capability;
- which internal organisation scope;
- which data classification/grain;
- which geography;
- start/end;
- delegation chain;
- reason;
- assurance level;
- what was suspended/revoked/expired;
- which sessions were revoked as part of an access/security event;
- which break-glass grant was activated/used/reviewed;
- access-review/certification outcome.

### 18.2 Sensitive action correlation

For sensitive domain actions, access audit should correlate:

- request/session identifier;
- effective Corporate permission;
- corporate assignment/delegation used;
- assurance class;
- organisational/geographic context;
- owning domain audit event identifier where available.

Do not duplicate the domain payload into Corporate access audit.

### 18.3 Audit minimization

Audit should record enough to prove authority and action without copying secrets, raw identity evidence, passwords, tokens or unnecessary PII.

### 18.4 Immutability and required-audit actions

Privileged access changes, break-glass activation, designated finance/report approvals and security-sensitive mutations should fail if their required authoritative audit cannot be recorded, consistent with the current product's fail-closed pattern for governed audited changes.

---

## 19. Compatibility and migration model

Do not perform an all-at-once RBAC rewrite.

### Phase 0 — current compatibility baseline

Continue existing:

- `users.role`;
- `authorizeRole(...)`;
- backend `admin/platform_admin/super_admin` compatibility;
- external tenant role/context;
- existing Operations capability map;
- current proven-session/step-up gates;
- domain-specific authorization.

No Corporate Admin authority is inferred from tenant membership.

### Phase 1 — additive corporate authority, read-only first

Introduce, when separately authorized:

- internal Corporate membership records;
- corporate permission assignments/sets;
- organisation/data/geography scopes;
- evaluation service in shadow/read-only mode;
- audit of Corporate access decisions.

Legacy roles continue to protect existing runtime.

Corporate Admin read-only surfaces may compare “legacy would allow” versus “corporate policy would allow” without changing production authority.

### Phase 2 — Corporate Admin routes consume new authority

New Corporate Admin routes/navigation use the Corporate permission evaluator.

Existing domain APIs continue their established authorization.

For a Corporate Admin action that invokes a domain operation:

**Corporate permission gate AND existing domain gate/service policy** must both pass.

No compatibility layer may weaken the domain service.

### Phase 3 — bounded replacement of broad admin on Corporate Admin paths

After evidence/certification:

- remove broad legacy `admin` bypass from bounded Corporate Admin routes one domain at a time;
- map required administrators to explicit permission sets/scopes;
- preserve external tenant and domain roles;
- keep current Operations capabilities until their equivalent corporate/domain permissions are independently certified.

### Phase 4 — retire unsafe compatibility

Only after CA-CERT and owner/moderator authority:

- retire redundant broad admin compatibility on Corporate Admin surfaces;
- decide final treatment of `platform_admin` and `super_admin`;
- remove client-visible internal role-switch patterns once equivalent server-governed context selection/delegation exists;
- retain legacy participant roles where still required for external product portals.

### 19.1 Compatibility mapping principles

| Current authority | Migration treatment |
| --- | --- |
| `admin` | Temporary broad compatibility only; do not automatically mint every Corporate permission permanently |
| `platform_admin` | Treat as current backend compatibility authority; map to explicit Platform permission sets when source/identity representation is resolved |
| `super_admin` | No permanent omnipotent target role; future treatment requires OD-CARBAC-017 |
| Operations capabilities | Reuse as proven capability seam; bridge to Corporate/Operations permission checks incrementally |
| `tenant_users` role | Remains external tenant authority; never becomes internal Corporate membership |
| government/reviewer paths | Remain external/institutional/reviewer domain authority unless a separate internal corporate membership is independently granted |
| step-up assurance | Reuse as authentication-assurance foundation; do not pretend strong auth exists |
| session revocation | Reuse as account-security primitive when separately integrated with Corporate lifecycle |

### 19.2 Key migration risks

1. **Admin shadow escalation:** creating Corporate membership while continuing unconditional admin bypass can make least-privilege UI cosmetic unless server paths are migrated.
2. **Tenant-to-corporate confusion:** importing `tenant_users` into Corporate membership would turn external customers/partners into internal authority.
3. **Frontend normalization:** `platform_admin` / `super_admin` compatibility may be hidden behind `admin` presentation, obscuring true technical authority.
4. **Capability duplication:** creating a second Operations capability vocabulary without mapping the existing bounded seam would create conflicting authorization.
5. **Cross-grant synthesis:** independently scoped grants could accidentally combine into broader authority unless each grant is evaluated atomically.
6. **Assurance overstatement:** calling current password step-up “strong authentication” would be false.
7. **Legacy suspend ambiguity:** using `role/status` writes for corporate suspension would create competing account-lifecycle authorities.
8. **External reviewer conflation:** government/reviewer product authority must not make a principal an internal Compliance employee.
9. **Client context escalation:** role/context pickers must only select already-approved server-side assignments.
10. **K2B collision:** RBAC may decide who can see provenance classes but may not classify the data.

---

## 20. Corporate Admin navigation implications

Without defining UI, the access architecture must enable:

1. Navigation displays only domains with at least one usable permission in the current internal scope.
2. Direct URL authorization must match server policy even if navigation is stale or manipulated.
3. Corporate Overview may show aggregate executive metrics without exposing record drill-down controls.
4. A visible KPI/card must not imply permission to click through to restricted source rows.
5. Finance restricted pages/exports are absent or refused without explicit Financial permissions.
6. People private pages are absent/refused without People permissions.
7. Identity/evidence case detail is absent/refused without Restricted Identity/Compliance permission and assurance.
8. Platform configuration is absent for executives lacking Platform permissions.
9. BU navigation follows explicit organisational scopes and inheritance.
10. Matrix functions can see their explicitly assigned cross-BU control views without joining each BU.
11. External tenant/partner portals remain outside Corporate Admin hierarchy.
12. “Unavailable” and “Forbidden” must be distinguishable:
    - **Unavailable**: source/capability/data does not exist or is not currently governable.
    - **Forbidden**: source exists but subject lacks access.
13. K2B/provenance-unavailable data must not be represented as “Forbidden” merely because it is not activated.
14. Permission evaluation details should not leak sensitive resource existence to unauthorized users.

---

## 21. Owner Decision Register

| Decision ID | Question | Why it matters | Affected agents | Safe default while unresolved | MUST NOT be assumed |
| --- | --- | --- | --- | --- | --- |
| `OD-CARBAC-001` | What is the authoritative source for internal Corporate membership? | Corporate scope cannot be trusted without it | CA-RBAC, CA-CERT, CA-PLAT | Separate future corporate authority; no inference from tenants | Do not reuse `tenant_users` / `users.role` automatically |
| `OD-CARBAC-002` | Who may approve/grant Corporate Admin access? | Defines access governance and accountability | CA-RBAC, CA-PLAT, CA-CERT | No self-grant; require designated Access Admin/owner path | Do not assume any `admin` can grant all corporate access |
| `OD-CARBAC-003` | Which privileged access changes require dual control? | Determines SoD and approval workflow | CA-RBAC, CA-FIN, CA-PLAT, CA-CERT | Dual control for break-glass and highest-risk privilege; broader list fail-closed pending decision | Do not treat one administrator as universal approver |
| `OD-CARBAC-004` | What is the maximum delegation duration? | Prevents permanent shadow authority | CA-RBAC, CA-CERT | Short explicit expiry; no indefinite delegation | Do not create standing delegation |
| `OD-CARBAC-005` | What record-level PII access, if any, should executives receive by default? | Aggregate executive access must not become broad PII access | CA-UX, CA-GROWTH, CA-CERT | Aggregate only | Do not infer PII rights from executive title |
| `OD-CARBAC-006` | What customer/People PII should CFO access include? | Finance duties may require some records but not all People/customer data | CA-FIN, CA-RBAC, CA-CERT | Restricted finance data only; no general People/customer PII | Do not infer PII from CFO title |
| `OD-CARBAC-007` | Should Security access governance be structurally independent of Platform administration? | Prevents Platform operator self-approval and improves control independence | CA-PLAT, CA-CERT | Separate permission sets and audit; independent approval for critical changes | Do not equate Platform Admin with Security Admin |
| `OD-CARBAC-008` | Who may approve and who must review break-glass access? | Emergency access requires independent oversight | CA-PLAT, CA-CERT | Separate approver and post-use reviewer; no self-review | Do not create permanent emergency super-admin |
| `OD-CARBAC-009` | How should employees, contractors and temporary workers differ in access policy? | Relationship type may constrain expiry, scope and review | CA-RBAC, CA-ORG, CA-CERT | Same least-privilege model; contractors require explicit end date | Do not infer employment class from account/tenant role |
| `OD-CARBAC-010` | How should external consultants/auditors access Corporate Admin? | They may require temporary read-only access without internal employment | CA-RBAC, CA-REPORT, CA-CERT | Time-bound READ_ONLY_AUDITOR with minimized data | Do not make them employees or platform admins |
| `OD-CARBAC-011` | What is the access review/certification cadence? | Needed to detect stale privilege | CA-REPORT, CA-CERT, CA-PLAT | Privileged access reviewed more frequently; cadence unresolved | Do not claim quarterly/monthly policy without Owner decision |
| `OD-CARBAC-012` | What dormant-account policy applies? | Stale identities/sessions increase risk | CA-PLAT, CA-CERT | No new privilege for dormant/unreviewed identities; exact thresholds unresolved | Do not invent inactivity duration |
| `OD-CARBAC-013` | Which permissions require geographic restrictions and what is the source of authoritative geography? | Cross-country operations may have different access needs | CA-ORG, CA-RBAC, CA-FIN, CA-CERT | Explicit geography only where assigned; no implicit GLOBAL | Do not infer scope from residence/IP |
| `OD-CARBAC-014` | Who may export restricted financial data? | Export increases disclosure risk | CA-FIN, CA-REPORT, CA-CERT | CFO/Finance permission set alone not sufficient; explicit export permission + A1 | Do not make every Finance reader an exporter |
| `OD-CARBAC-015` | Who may publish executive/board reports and is separate approval required? | Published reports become management record | CA-REPORT, CA-FIN, CA-CERT | Separate REPORTING_PUBLISHER; sensitive reports require distinct preparer/publisher | Do not equate report generation with publication |
| `OD-CARBAC-016` | How should current `platform_admin` compatibility map into future Corporate authority? | Backend recognizes authority not represented cleanly in shared frontend role | CA-PLAT, CA-CERT | Map to explicit Platform permission set only after authoritative identity source is known | Do not grant Corporate Finance/People access automatically |
| `OD-CARBAC-017` | What is the future of `super_admin`? | Omnipotent compatibility conflicts with least privilege | CA-PLAT, CA-CERT | No target-state permanent omnipotent role; preserve only compatibility until certified replacement | Do not encode `super_admin` as future corporate role |
| `OD-CARBAC-018` | How should external `government` / `reviewer` authority remain separated from internal Compliance staff? | Shared review endpoints can obscure principal type | CA-RBAC, CA-PLAT, CA-CERT | Treat external reviewer authority as external/domain scope only | Do not create Corporate membership from reviewer role |
| `OD-CARBAC-019` | Which action classes require A1 vs future A2 strong assurance? | Current product has no strong authenticator | CA-PLAT, CA-FIN, CA-CERT | A1 for current sensitive actions; highest-risk target A2 when implemented | Do not call recent password reauth “strong authenticator” |
| `OD-CARBAC-020` | Which membership/permission suspensions must revoke live sessions immediately? | Determines revocation latency | CA-PLAT, CA-CERT | Account disable/security compromise → revoke all; narrow permission revoke re-evaluated immediately and session revocation policy-specific | Do not assume every role change requires logout or that none does |
| `OD-CARBAC-021` | Which People/access actions require separate approver from the Access Admin executing them? | Prevents unilateral privileged grants | CA-RBAC, CA-CERT | Privileged/self-related grants require independent approval | Do not allow self-approval |
| `OD-CARBAC-022` | Which finance workflows require preparer/approver separation and materiality thresholds? | CA-RBAC cannot invent finance approval policy | CA-FIN, CA-CERT | Keep capability split available; require CA-FIN decision before high-risk action activation | Do not infer legal/accounting thresholds |
| `OD-CARBAC-023` | Which feature/integration/security changes require dual control? | Some technical changes can alter platform-wide risk | CA-PLAT, CA-CERT | Security-affecting critical changes require stronger review; exact list unresolved | Do not let broad Platform Admin bypass future Security policy |
| `OD-CARBAC-024` | May permission sets be delegated, or only explicit capabilities from them? | Prevents accidental broad delegation | CA-RBAC, CA-CERT | Delegate explicit capability subset, never opaque full bundle by default | Do not assume bundle delegation |
| `OD-CARBAC-025` | How should conflicting grants/explicit denies be resolved? | Deterministic evaluation is required | CA-RBAC, CA-CERT | Explicit deny / suspended state wins; narrower restrictions preserved | Do not resolve conflicts by broadest grant |
| `OD-CARBAC-026` | What retention/access policy applies to Corporate access-audit records? | Audit must remain useful without unnecessary sensitive retention | CA-REPORT, CA-PLAT, CA-CERT | Preserve authoritative access events; minimize embedded sensitive data; retention TBD | Do not invent statutory retention period |
| `OD-CARBAC-027` | Who owns Corporate permission-set definitions and version approval? | Permission taxonomy itself is security policy | CA-PLAT, CA-CERT, CA-RBAC | Central access-governance ownership with security review | Do not let each BU silently redefine shared capabilities |
| `OD-CARBAC-028` | Should designated executives receive GLOBAL organisational scope by default or explicit enumerated units? | Determines blast radius of executive access | CA-ORG, CA-UX, CA-CERT | Corporate aggregate grant only; restricted detail remains explicitly enumerated | Do not turn executive title into unrestricted GLOBAL record access |
| `OD-CARBAC-029` | Can external tenant context ever be used simultaneously with internal Corporate Admin mutation? | Mixed principal context can cause attribution/scope confusion | CA-PLAT, CA-CERT | Keep contexts separate; require explicit domain handoff rather than blended authority | Do not merge tenant and corporate grants in one implicit effective role |
| `OD-CARBAC-030` | What policy applies while A2 strong authentication is unavailable for a future action designated A2? | Break-glass/critical access cannot pretend unavailable assurance exists | CA-PLAT, CA-CERT | Do not activate A2-only functionality without explicit interim Owner control | Do not silently downgrade A2 to A1 |

---

## 22. Downstream inputs

### 22.1 CA-METRIC / CA-METRIC-01

Consume:

- aggregate versus record-level split;
- organisational scope and classification dimensions;
- `corporate.metric.registry.read/manage` concepts;
- data-steward versus business-owner separation;
- K2B dependency for provenance-specific visibility;
- no cross-grant privilege synthesis.

Metric truth/formulas remain CA-METRIC authority.

### 22.2 CA-UX / CA-UX-01

Consume:

- navigation reflects effective Corporate permission and organisational scope;
- visible aggregates do not imply visible record drill-down;
- Platform, People, Finance and Compliance detail are separately gated;
- unavailable versus forbidden states are distinct;
- titles are display metadata only;
- current context selection cannot grant authority.

### 22.3 CA-FIN / CA-FIN-01

Consume:

- Finance summary versus restricted/line-item/export capabilities;
- CFO title does not grant PII or unrelated mutations;
- assurance and SoD hooks for finance;
- Owner Decisions OD-CARBAC-006, 014, 019 and 022.

### 22.4 CA-BU

Consume:

- BU/department/team scope inheritance;
- BU Lead/Manager archetypes as templates, not roles;
- explicit matrix-control scopes;
- sibling/central-function non-inheritance.

### 22.5 CA-REPORT

Consume:

- separate generate/export/publish/approve permissions;
- report preparer/publisher SoD;
- audience/classification scope;
- audit/version traceability;
- OD-CARBAC-015 and 026.

### 22.6 CA-PLAT

Consume:

- explicit Platform versus Security permission separation;
- migration treatment of `admin/platform_admin/super_admin`;
- existing assurance/session-revocation primitives;
- client context cannot grant;
- A2 strong-authenticator gap;
- OD-CARBAC-007, 016, 017, 019, 023 and 030.

### 22.7 CA-CERT / CA-CERT-01

Certification should later prove at minimum:

- same title with different scopes produces different access;
- aggregate executive read cannot retrieve underlying PII/evidence/financial line items;
- Platform Admin cannot access Finance/People/Compliance detail unless separately granted;
- CFO cannot mutate Platform/Identity merely by title;
- tenant membership cannot mint Corporate Admin authority;
- expired/revoked/suspended delegation fails;
- explicit organisational/geographic boundaries hold;
- direct URL and navigation are consistent;
- step-up gates fail closed;
- current legacy admin compatibility does not silently bypass migrated Corporate paths;
- no cross-grant privilege synthesis;
- domain service authorization remains in force after Corporate gate;
- K2B provenance is consumed rather than duplicated.

---

## 23. Open risks and collisions

### 23.1 Broad admin compatibility

The current platform-admin bypass remains the largest migration collision. Corporate Admin least privilege becomes real only when bounded server routes stop relying on broad compatibility after certification.

### 23.2 Internal membership authority unresolved

CA-ORG correctly separated internal membership from tenants, but the authoritative internal source remains OD-CARBAC-001. No implementation should guess.

### 23.3 Platform-admin representation gap

`platform_admin` / `super_admin` are backend-recognized compatibility roles but not cleanly represented in the shared platform role model. Migration must not hide this behind an “admin” UI label.

### 23.4 Assurance ceiling

Current password re-authentication is useful A1 assurance but is not a strong authenticator. High-risk future A2 functions need a separately authorized authentication capability or explicit interim Owner policy.

### 23.5 Legacy suspension collision

Broken/inconsistent Admin suspend routes must not become Corporate access lifecycle authority. Corporate membership suspension, account disable and identity lifecycle are separate concepts.

### 23.6 Audit overlap

Corporate access audit must correlate with domain audit without copying sensitive domain payloads or creating a competing source of truth.

### 23.7 Matrix overreach

Cross-BU central functions can accidentally become global super-users if control scopes are expressed as generic Corporate access. Matrix grants must identify function, capability, organisation set and classification explicitly.

### 23.8 External reviewer collision

Government/reviewer permissions share some review surfaces with internal operations. Principal type and internal membership must remain independently established.

### 23.9 K2B provenance

Who may see a dataset and whether that dataset is operational truth are different questions. Provenance enforcement remains PENDING_K2B.

---

## 24. Stop conditions encountered

The task encountered policy questions that cannot be resolved safely from repository evidence:

- authoritative corporate-membership source;
- privileged approver identities;
- dual-control boundaries;
- delegation duration;
- executive/CFO PII defaults;
- strong-authenticator target policy;
- break-glass governance;
- access-review/dormancy cadence;
- finance/report approval policy;
- final `platform_admin` / `super_admin` treatment.

In accordance with the dispatch, these were converted to `OD-CARBAC-*` decisions and safe defaults rather than guessed.

No product mutation, database migration, `users.role` change, tenant change, middleware change, route-gate change, UI change, deployment or K2B provenance change was performed.

---

## 25. Recommended next task

Subject to CA-MOD independent review of CA-RBAC-01:

1. **CA-METRIC / CA-METRIC-01** can consume the accepted CA-ORG ownership model and this classification/scope architecture.
2. **CA-FIN / CA-FIN-01** can resolve financial visibility/export/approval semantics without conflating finance-product authority.
3. **CA-UX / CA-UX-01** can design permission-aware Corporate Admin information architecture after metric/finance inputs are stable enough.
4. **CA-PLAT** should later translate the accepted architecture into a bounded migration design for platform/security administration, but no implementation should begin without explicit CA-MOD authority.
5. **CA-CERT / CA-CERT-01** should eventually certify cross-role, cross-scope, assurance and compatibility boundaries before broad legacy-admin retirement.

This document does not self-accept.

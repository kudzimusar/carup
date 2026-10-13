# CA-RBAC-01 — CORPORATE MEMBERSHIP / PERMISSION / DELEGATED-AUTHORITY MODEL

FROM: CA-MOD — Corporate Admin Programme Moderator  
TO: CA-RBAC — Corporate Identity & Access Agent  
TASK: CA-RBAC-01  
PROGRAMME: CA-1.0 — CarUp Corporate Admin 1.0

Canonical programme authority:

docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md

Canonical plan authority:

5d4997cacaff8068c4ec4c5ae78f562be4249344

Accepted architecture input:

CA-ARCH / CA-ARCH-01  
docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md  
accepted authority: 7cae8c3c8c987714a8ca6db2128db3b9a589f141

Accepted organisation input:

CA-ORG / CA-ORG-01  
docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md  
accepted authority: 705eb6fa1cd89109977052e88e220f0498668060

Product/reference authority for repository inspection:

PR #222 historical accepted product snapshot  
505ffcca6b641c8b3b55f503e0f4fd39d26710dc

IMPORTANT:
PR #222 has advanced beyond 505ffcca under active K2B work.
Do not substitute the unaccepted K2B head for accepted Corporate Admin product authority.
You may inspect later source only if CA-MOD separately authorizes it.

Parallel dependency:

K2B — Operational Provenance Authority / Admin Truth Convergence  
ACTIVE / NOT YET ACCEPTED INTO CORPORATE ADMIN AUTHORITY

## MODERATOR DISPOSITION

AUTHORIZED — CORPORATE ACCESS ARCHITECTURE / DOCUMENTATION ONLY

NO PRODUCT IMPLEMENTATION.

NO DATABASE MIGRATION.

NO USERS.ROLE CHANGE.

NO TENANT MODEL CHANGE.

NO AUTH MIDDLEWARE CHANGE.

NO ROUTE-GATE CHANGE.

NO ACCOUNT-SUSPENSION IMPLEMENTATION.

NO CORPORATE UI IMPLEMENTATION.

NO K2B PROVENANCE IMPLEMENTATION.

---

## 1. Objective

Design the durable Corporate Admin identity, membership, permission and delegated-authority model.

The model must solve the proven problem that one current platform role, admin, visually and operationally conflates executive intelligence, finance visibility, business operations, compliance/review, People administration, technical platform administration and security-sensitive authority.

The target access decision must conceptually answer:

WHO is acting
×
FOR WHICH internal CarUp organisational scope
×
WITH WHICH governed permission/capability
×
OVER WHICH data classification / record scope
×
IN WHICH geographic/business context
×
UNDER WHICH delegation / assurance conditions.

This is access architecture, not implementation.

---

## 2. Binding inputs

Read in full:

1. docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
2. docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
3. docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md

Preserve:

- Corporate Intelligence / Business Operations / Platform & Security separation;
- internal corporate hierarchy versus external tenant/partner namespace;
- company → BU/subsidiary → department → team model;
- central/shared-function matrix model;
- information-classification model;
- titles do not grant permissions;
- platform identity, corporate membership and external tenant membership are separate;
- current domain services remain mutation authorities;
- K2B remains operational provenance authority.

Do not silently revise these.

---

## 3. Current-state constraints to consume

CA-ARCH proved:

- shared frontend role type exposes owner, dealer, mechanic, bank, insurance, government, admin;
- platform_admin / super_admin are normalized to admin for frontend presentation;
- backend authorizeRole() separately recognizes broad platform-admin compatibility;
- Operations capability names exist and are a better seam than adding more raw role checks;
- current admin reaches mixed Corporate, Operations and Platform functions;
- current external tenant role must not become Corporate Admin internal membership;
- consequential actions already use real-session/capability/assurance patterns in some domains.

CA-ORG proved:

- internal corporate placement is separate from tenant_users / organizations;
- one person may have one home internal unit plus matrix/delegated/geographic scopes;
- external banks, insurers, government bodies, dealers and garages remain outside the internal hierarchy;
- legal entity / BU / department / team / region / cost-centre / profit-centre are separate concepts.

Use those as input.

---

## 4. Required identity namespaces

Define, at minimum, these distinct conceptual namespaces:

### A. BASE IDENTITY

The human/account identity.

Must not encode all corporate authority in one users.role value.

### B. PLATFORM ROLE

Legacy/runtime CarUp platform role used during migration.

Examples include current admin, owner, dealer, etc.

This remains a compatibility/runtime concept, not the future Corporate Admin authority model.

### C. CORPORATE MEMBERSHIP

Internal CarUp placement in one or more internal organisational units.

Must support:
- home unit;
- matrix assignment;
- employment/contract relationship class when authoritative;
- active/inactive placement state;
- start/end dates.

### D. CORPORATE PERMISSION SET

Named bundle of actions/capabilities granted independently of title.

### E. DATA SCOPE

Which information the person may see:
- aggregate corporate;
- legal entity;
- BU;
- department;
- team;
- own records;
- assigned queue/case;
- cross-unit control scope.

### F. GEOGRAPHIC SCOPE

Country/region/market restriction where applicable.

### G. DELEGATED AUTHORITY

Temporary or secondary authority:
- acting role;
- delegated unit;
- specific permissions;
- effective dates;
- delegator;
- reason.

### H. EXTERNAL TENANT / PARTNER AUTHORITY

Existing participant organisation authority.

Must remain independent from Corporate membership.

---

## 5. Access decision model

Define a canonical conceptual authorization expression.

At minimum include:

subject
resource
action
organisation_scope
data_classification
business_context
geographic_scope
delegation
assurance_level
time

The model should be capable of expressing:

CEO may see consolidated Actual corporate KPIs but not necessarily mutate platform configuration.

CFO may see Restricted Financial data but cannot approve identity evidence merely because they are CFO.

Marketplace Director may see Marketplace BU operations and scorecards but not private Finance/People records outside authorised scopes.

Compliance Manager may review governed evidence across assigned BUs but not change feature rollouts.

Platform Admin may administer technical platform controls but does not automatically see customer PII, executive finance detail or People records.

Security Admin may manage security/access controls with independent audit and may require stronger assurance.

Analyst may read governed aggregates for assigned units but perform no mutation.

Operator may execute specific domain operations only for assigned queues/business units.

External government/bank/insurer roles are not Corporate Admin members by default.

---

## 6. Permission architecture

Design permission naming and grouping.

Prefer stable capabilities over job-title checks.

Example conceptual namespaces:

corporate.overview.read
corporate.business_unit.read
corporate.finance.summary.read
corporate.finance.restricted.read
corporate.customer.aggregate.read
corporate.customer.pii.read
corporate.operations.queue.read
corporate.operations.case.act
corporate.risk.aggregate.read
corporate.risk.case.review
corporate.people.aggregate.read
corporate.people.private.read
corporate.people.access.manage
corporate.metric.registry.read
corporate.metric.registry.manage
corporate.report.generate
corporate.report.publish
platform.feature.read
platform.feature.manage
platform.integration.read
platform.integration.manage
platform.security.read
platform.security.manage

These examples are illustrative.

Define a durable convention and permission taxonomy.

Do NOT implement permissions in code.

---

## 7. Role archetypes / permission bundles

Create conceptual corporate archetypes such as:

- EXECUTIVE_READ
- CEO / EXECUTIVE_LEAD
- COO / OPERATIONS_EXECUTIVE
- CFO / FINANCE_EXECUTIVE
- BU_LEAD
- FUNCTION_LEAD
- DEPARTMENT_MANAGER
- CORPORATE_ANALYST
- BU_ANALYST
- OPERATOR
- COMPLIANCE_REVIEWER
- PEOPLE_ADMIN
- ACCESS_ADMIN
- PLATFORM_ADMIN
- SECURITY_ADMIN
- DATA_INTELLIGENCE_ADMIN
- REPORTING_PUBLISHER
- READ_ONLY_AUDITOR

But bind this rule:

ROLE ARCHETYPE / TITLE is not itself final authority.

Authority comes from:
permission set + organisational/data/geographic scope + assurance/delegation.

Show how two people with the same title may have different scopes.

Show how one person may hold multiple permission sets without acquiring all rights of an omnipotent admin.

---

## 8. Data classification enforcement

Consume canonical classes:

- Public
- Internal
- Internal Confidential
- Restricted Financial
- Restricted Identity/Compliance
- Restricted Security/Platform

Define how permissions interact with data classification.

At minimum explain:

- aggregate KPI visibility versus record-level detail;
- customer PII;
- employee/private People data;
- financial line-item detail;
- compliance/identity evidence;
- secrets/security/platform configuration;
- audit events.

An executive’s ability to see aggregate data must not automatically grant access to underlying PII/evidence/secrets.

---

## 9. Organisational scope inheritance

Define how access scopes follow hierarchy.

Example:

BU_MARKETPLACE scope may include child Marketplace departments/teams.

But:
- parent scope must not automatically cross into central functions;
- matrix/control functions may require explicit cross-BU scope;
- external tenants are not descendants of internal BU nodes;
- legal entity and BU scope may overlap but are not identical;
- geography is a filter/scope dimension, not automatically a hierarchy parent.

Define safe inheritance rules.

---

## 10. Matrix/shared-function authority

Design how central functions such as:

- Finance & Accounting;
- Trust / Risk / Compliance;
- Data & Intelligence;
- People & Administration;
- Security;

can act across multiple BUs without being duplicated into each BU.

The model must distinguish:

operating owner
control owner
data steward
reporting owner

Example:
Marketplace owns listing operations.
Trust/Risk may govern evidence/risk review.
Data & Intelligence may steward metric semantics.
Finance & Accounting may own accounting recognition.

Do not collapse these into one generic owner.

---

## 11. Delegated authority

Define temporary delegation semantics.

Must include:

- delegator;
- delegate;
- organisational scope;
- permission subset;
- start/end;
- reason;
- maximum duration policy placeholder;
- revocation;
- audit event;
- step-up requirement where appropriate.

Delegation must never allow a user to grant permissions they do not themselves hold.

No self-grant.

No silent permanent role switch.

This model should eventually replace client-visible “switch to any role” concepts for internal corporate authority.

---

## 12. Access lifecycle

Define conceptual lifecycle:

REQUESTED
APPROVED
ACTIVE
SUSPENDED
REVOKED
EXPIRED

Distinguish:

- corporate membership state;
- account identity state;
- permission assignment state;
- external tenant membership state;
- session state.

Do not use users.role='suspended'.

Do not assume current users.status exists.

Provide a future conceptual account lifecycle that CA-MOD may later authorize for implementation.

---

## 13. Account suspension / access removal

The current Admin suspension control is broken and K2B is expected to remove/disable the false control.

CA-RBAC must define what a correct future model requires.

Distinguish:

ACCOUNT DISABLE
CORPORATE MEMBERSHIP SUSPEND
PERMISSION REVOKE
SESSION REVOKE
EXTERNAL TENANT MEMBERSHIP REVOKE

Specify which actions should terminate current sessions and which should not.

Do not implement.

---

## 14. Assurance / step-up model

Preserve stronger assurance for consequential actions.

Define conceptual assurance classes, for example:

A0 — ordinary authenticated session
A1 — recent re-authentication / step-up
A2 — high-assurance action / dual-control candidate

Determine categories that may require stronger assurance, such as:

- permission/access grants;
- finance configuration or restricted financial exports;
- identity/compliance decisions;
- provider/platform/security configuration;
- publishing executive/board reports;
- break-glass access.

Do not change existing auth middleware.

---

## 15. Segregation of duties

Define key separation-of-duty principles.

At minimum consider:

- requestor vs approver;
- finance preparer vs finance approver;
- identity reviewer vs account-access administrator;
- feature/integration operator vs security approver;
- report preparer vs report publisher;
- person granting access vs person auditing access.

Identify which ones are MVP requirements versus later controls.

Do not invent legal compliance obligations; state them as governance safeguards unless independently required.

---

## 16. Break-glass / emergency access

Design a bounded future emergency-access concept.

Must include:

- named emergency permission set;
- explicit reason;
- short duration;
- high assurance;
- immutable audit;
- post-use review;
- no automatic standing access.

Do not implement.

---

## 17. Corporate access audit

Define minimum access/audit records Corporate Admin will eventually need to answer:

- who granted/revoked access;
- what permission set;
- what organisational/data/geographic scope;
- on whose authority;
- effective dates;
- delegation chain;
- assurance level;
- session/access revocation;
- which sensitive action was executed.

Do not duplicate domain audit logs; define how corporate access audit complements them.

---

## 18. Migration / compatibility model

Produce a safe conceptual migration from current state.

Must explain how current:

admin
platform_admin
super_admin
operations capabilities
tenant role
government/reviewer paths

can coexist temporarily while Corporate Admin membership is introduced.

Do NOT propose an all-at-once role rewrite.

Prefer additive migration:

Phase 1:
read-only corporate membership/permission model alongside legacy roles.

Phase 2:
Corporate Admin routes consume new corporate authority while domain APIs continue existing authorization.

Phase 3:
replace broad admin compatibility on bounded Corporate Admin paths with permission checks.

Phase 4:
retire unsafe compatibility only after certification.

Provide exact compatibility risks.

---

## 19. Corporate Admin navigation implication

Without designing UI, define what access architecture must enable:

- users see only Corporate Admin domains they are entitled to;
- direct URL access matches navigation visibility;
- aggregate executive views may be visible without drill-down record access;
- Platform controls are absent for executives lacking Platform permissions;
- Finance/People/Compliance detail remains hidden without classified-data permission;
- business-unit navigation follows organisational scope;
- unavailable versus forbidden are distinguishable.

Do not create wireframes.

---

## 20. Owner Decision Register

Create OD-CARBAC identifiers for unresolved access-policy decisions.

At minimum cover:

- authoritative source for internal corporate membership;
- who may grant Corporate Admin access;
- whether access approval requires dual control;
- maximum delegation duration;
- executive record-level PII defaults;
- CFO access to customer/People PII;
- Security independence;
- break-glass approver/reviewer;
- employee vs contractor access handling;
- external consultant/auditor access;
- access review cadence;
- dormant account policy;
- geo-restricted access;
- finance export/publish authority;
- report publishing authority;
- current platform_admin migration;
- super_admin future treatment;
- reviewer/government separation;
- step-up policy levels.

Every unresolved choice must have:

decision ID
question
why it matters
affected agents
safe default
what must NOT be assumed.

---

## 21. Required deliverable

Create:

docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md

Must include:

1. authority/custody;
2. current-state constraints;
3. identity namespaces;
4. canonical access-decision model;
5. permission naming/taxonomy;
6. role archetypes;
7. data classification enforcement;
8. organisational-scope inheritance;
9. matrix/shared-function authority;
10. delegated authority;
11. access/account lifecycle;
12. suspension/access-removal semantics;
13. assurance/step-up model;
14. segregation of duties;
15. break-glass model;
16. audit model;
17. compatibility/migration path;
18. Corporate Admin navigation implications;
19. Owner Decision Register;
20. downstream inputs for CA-METRIC, CA-UX, CA-FIN, CA-BU, CA-REPORT, CA-PLAT, CA-CERT;
21. open risks;
22. recommended next task.

Optional: one concise machine-readable permission taxonomy only if it materially improves traceability.

---

## 22. Repository scope

AUTHORIZED MUTATION:

docs/corporate-admin/**

READ-ONLY INSPECTION:

web/**
backend/**
shared/**
database schema/migration history
existing docs

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

## 23. K2B boundary

K2B owns operational provenance.

CA-RBAC may define who is permitted to see:

operational
test/certification
historical
unknown

data categories in principle.

CA-RBAC must not:

- classify runtime rows;
- implement provenance filtering;
- alter K2B;
- invent a second provenance authority.

Mark provenance-specific enforcement as PENDING_K2B where necessary.

---

## 24. Evidence rules

Distinguish:

PROVEN CURRENT AUTHORIZATION FACT
PROPOSED CORPORATE ACCESS MODEL
OWNER DECISION REQUIRED

Do not describe conceptual permissions as already implemented.

Do not claim current users are employees/executives.

Do not expose secrets or unnecessary PII.

---

## 25. Stop conditions

STOP and report if:

- Corporate membership would have to be inferred from tenant membership;
- a permission rule requires an unresolved legal/business decision;
- product mutation appears necessary;
- current authority cannot be determined safely;
- the task collides with K2B runtime/product changes.

Use safe defaults and Owner Decision IDs rather than guessing.

---

## 26. Return receipt

Use canonical CA receipt format.

Return:

AGENT: CA-RBAC
TASK: CA-RBAC-01

EXACT STARTING AUTHORITY:
- canonical plan
- accepted CA-ARCH-01
- accepted CA-ORG-01
- inspected product SHA

EXACT RESULTING AUTHORITY:
- documentation branch SHA

DEPENDS ON:
- CA-ARCH / CA-ARCH-01 — ACCEPTED
- CA-ORG / CA-ORG-01 — ACCEPTED
- K2B — ACTIVE

FILES / SYSTEMS INSPECTED
FILES CHANGED
PROVEN FACTS
PROPOSED ACCESS MODEL
OWNER DECISIONS REQUIRED
OPEN QUESTIONS
COLLISIONS / DEPENDENCIES
DOWNSTREAM INPUTS
STOP CONDITIONS ENCOUNTERED
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-RBAC-01 CORPORATE ACCESS MODEL READY FOR MODERATOR REVIEW

Do not self-accept.

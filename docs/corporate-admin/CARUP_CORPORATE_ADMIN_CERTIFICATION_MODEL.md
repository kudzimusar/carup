# CARUP CORPORATE ADMIN CERTIFICATION MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0
Agent: CA-CERT — Corporate Admin Certification Agent
Task: CA-CERT-01
Status: CROSS-PLANE ARCHITECTURE / MIGRATION CERTIFICATION MODEL — NOT PROGRAMME ACCEPTANCE

---

# 1. Authority and custody

This certification model is produced under the following exact accepted authorities:

- Canonical plan: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- CA-ARCH-01: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- CA-ORG-01: `705eb6fa1cd89109977052e88e220f0498668060`
- CA-RBAC-01: `4abdf95e1e1490b01f51cb45106a57fcf7b954b9`
- CA-METRIC-01: `32c26ce5d89ec3829e2afa9248d1e77a2cb4c784`
- CA-FIN-01: `9ba7388559fa13cf353e410ce2a62be30660bdeb`
- CA-GROWTH-01: `f7e4c0519411994383d8d3e316c10b380f0e728d`
- CA-UX-01: `336c6d6015b6c2a4851fb1171642bcc5e93adcdf`
- CA-BU-01: `f73472378cffe81c9bdd981d77e085809ad5c5dd`
- CA-REPORT-01: `860ae2e0ddeccb33bc504ca15c0f8382fc3574a2`
- CA-PLAT-01: `ba8485534bd5d555c6565d85ddb5954a26408844`
- K2B operational-provenance authority / frozen product-source authority: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`
- Exact documentation starting authority: `ba8485534bd5d555c6565d85ddb5954a26408844`

Parallel implementation custody:

**CA-K3 — ACTIVE / SEPARATE PRODUCT IMPLEMENTATION CUSTODY**

CA-CERT-01 does not modify CA-K3, current web implementation, current `/admin`, backend, shared code, mobile code, database, workflows, staging, Production, deployments, configuration or secrets.

Immediately before this artifact was created:

- branch `docs/corporate-admin-1-canonical-plan` was identical to `ba8485534bd5d555c6565d85ddb5954a26408844`;
- `docs/corporate-admin/CARUP_CORPORATE_ADMIN_CERTIFICATION_MODEL.md` did not exist;
- PR #224 was Draft / Open / Unmerged and its head was the exact starting documentation authority.

This model is a certification architecture. It does not self-accept any architecture or implementation.

---

# 2. Certification objective

The controlling certification question is:

> **Can CarUp implement and progressively migrate to the accepted Corporate Admin architecture without authority collision, semantic contradiction, false business truth, access widening, or loss of accepted operational capability?**

CA-CERT answers that question across the accepted authorities **as one management system**.

It does not:

- redesign an accepted model because another design is possible;
- make an unresolved Owner decision;
- repair accepted architecture inside this document;
- create a second provenance classifier;
- create accounting semantics;
- create customer semantics;
- create implementation permission;
- accept CA-K3 work.

The controlling product principle remains:

> **Truth before visualization.**

---

# 3. Accepted-authority registry

| Authority | Primary responsibility | Downstream authority it must not replace | Certification posture |
| --- | --- | --- | --- |
| Canonical Plan | Programme principles, three planes, ten-destination IA, sequencing | Specialist semantic authorities | Binding programme frame |
| CA-ARCH | Current-state source/route/authority inventory | Future specialist semantics | Source/migration baseline |
| CA-ORG | Internal organisation taxonomy, BU/function boundary, internal/external separation | RBAC permission model, Finance accounting | Controlling organisation authority |
| CA-RBAC | Membership/permission/scope/classification/delegation/assurance/SoD | Domain mutation authority, K2B | Controlling access authority |
| CA-METRIC | Metric identity, truth states, availability, lineage, formula/version contract | Accounting policy, customer policy | Controlling metric semantics |
| CA-FIN | Product-money versus Corporate accounting boundary | Product transaction authority | Controlling finance/accounting semantics |
| CA-GROWTH | Customer/relationship/journey/acquisition semantics | Accounting semantics, K2B | Controlling customer/growth semantics |
| CA-UX | Ten-destination Corporate UX, truth-state presentation, plane transitions | Source truth, RBAC | Controlling Corporate Admin experience architecture |
| CA-BU | Four management BU contracts, scorecard eligibility, cross-BU comparison rules | Legal entity, customer/accounting truth | Controlling BU management model |
| CA-REPORT | Report definitions, immutable snapshots, lifecycle, publication/SoD/export | Metric calculation, source-domain mutation | Controlling management-reporting model |
| CA-PLAT | Platform/Security technical boundary, compatibility roles, provider/model/security controls | Corporate business authority | Controlling Platform/Security model |
| K2B | Operational/non-operational/unknown provenance and accepted public-truth boundary | Corporate presentation/metric formulas | Controlling operational-provenance authority |

No accepted authority above is permitted to synthesize a privilege, fact, metric or business concept that its controlling authority explicitly withholds.

---

# 4. Canonical three-plane model

The accepted management planes are:

## 4.1 Corporate Intelligence

Purpose:

- understand;
- compare;
- explain;
- review;
- report.

Canonical top-level destinations:

1. **Corporate Overview**
2. **Business Units**
3. **Finance**
4. **Customers & Growth**
7. **Data & Intelligence**
9. **Reports**

Corporate Intelligence is aggregate/read-oriented by default. Drill-down never bypasses record-level permissions.

## 4.2 Business Operations

Purpose:

- operate;
- review;
- decide;
- clear backlog;
- resolve exceptions.

Canonical top-level destinations:

5. **Operations**
6. **Trust / Risk / Compliance**
8. **People & Access**

Contextual BU operating workspaces may be reached from Corporate Intelligence, but mutation authority remains with the owning domain service.

## 4.3 Platform & Security

Purpose:

- operate the technical system;
- govern features/integrations/models;
- administer authentication/security/runtime controls;
- inspect technical diagnostics and audit.

Canonical top-level destination:

10. **Platform**

## 4.4 Ten-destination invariant

The canonical Corporate top-level IA is exactly:

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

No eleventh top-level Corporate destination is certified by CA-1.0.

## 4.5 Plane-boundary invariant

A cross-plane link is valid.

A cross-plane authority collapse is not.

Examples:

- BU scorecard → Operations queue: valid transition.
- Corporate Overview card → restricted Finance rows without Finance permission: invalid.
- Platform provider page → customer payment records merely for convenience: invalid.
- People & Access → Security session revocation when separately authorized: valid controlled transition.
- Reporting infrastructure admin → report publication: invalid unless separate report-publish authority exists.

---

# 5. Authority consistency matrix

Interaction classes:

- `CONSISTENT`
- `CONSISTENT_WITH_PENDING_OWNER_POLICY`
- `IMPLEMENTATION_DEPENDENCY`
- `MIGRATION_DEPENDENCY`
- `COLLISION_REQUIRES_REMEDIATION`

| Concept | Controlling authority | Consuming authorities | Source/product dependency | Owning plane | Future implementation owner | Certification requirement | Pending authority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Corporate parent/company | CA-ORG | RBAC, UX, BU, REPORT, FIN | Future internal-org authority | Corporate | People & Access / org foundation | Must remain conceptual until legal/display identity is approved | OD-CAORG-001/015 | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Legal entity/subsidiary | CA-ORG + future legal evidence | FIN, REPORT, RBAC | No repository route may create legal status | Corporate | Org/Finance foundation | No BU/product may be shown as legal entity without evidence | OD-CAORG-001/002/015 | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Management BU | CA-ORG / CA-BU | UX, METRIC, REPORT, RBAC | Four stable BU IDs | Corporate Intelligence + Operations | Corporate BU surfaces | Stable ID, non-legal label, scoped metrics | Some BU labels/grouping Owner decisions | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Corporate function | CA-ORG | RBAC, UX, METRIC, REPORT | Future internal-org authority | Cross-plane internal structure | People & Access / org foundation | Central function must not be duplicated under each BU | OD-CAORG-013/016/017/018/020 | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Department | CA-ORG | RBAC, REPORT, UX | Future internal-org authority | Owning plane | Org foundation | Parent must be BU/function/legal entity/subsidiary as accepted | membership source pending | `IMPLEMENTATION_DEPENDENCY` |
| Team | CA-ORG | RBAC, UX | Future internal-org authority | Owning plane | Org foundation | No permission inherited merely from placement | membership source pending | `IMPLEMENTATION_DEPENDENCY` |
| Corporate membership | CA-RBAC consumes CA-ORG | UX, PLAT, CERT | No accepted current internal membership SOR | Business Operations / People & Access | People & Access | Separate from `users.role` and external tenant membership | OD-CAORG-022/023 + RBAC policy | `IMPLEMENTATION_DEPENDENCY` |
| Permission assignment | CA-RBAC | all | Future Corporate access authority | Cross-plane control | People & Access / Access governance | Stable capability + exact scope; no title grants | RBAC implementation choices | `IMPLEMENTATION_DEPENDENCY` |
| Organisational scope | CA-RBAC + CA-ORG | all | future org tree | Cross-plane control | Access service | BU/function/dept/team scope evaluated server-side | none that permits widening | `IMPLEMENTATION_DEPENDENCY` |
| Geography | CA-RBAC + domain source + CA-METRIC | GROWTH, BU, REPORT | source-specific geography | Cross-plane | Access/metric implementation | Geography type must be named; listing/corridor ≠ customer residence | OD-CAORG-011 / metric policy | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Data classification | CA-RBAC | UX, REPORT, PLAT | classification metadata | Cross-plane control | Access enforcement | Aggregate/detail/export distinctions enforced | selected thresholds/policy | `IMPLEMENTATION_DEPENDENCY` |
| Assurance | CA-RBAC; current product step-up | PLAT, REPORT, People/Access | `user_sessions` / assurance service | Platform & Security control | Security | A1 not represented as A2; assurance never substitutes permission | A2/critical-action policy | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Delegation | CA-RBAC | UX, REPORT, PLAT | future access authority | Business Operations / People & Access | Access governance | Cannot amplify; expiry; source grant remains valid | OD-CARBAC policy | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Segregation of duties | CA-RBAC + REPORT/FIN | REPORT, FIN, PLAT | future action workflow | Cross-plane control | owning domain + Access | maker/checker where accepted; no self-grant | thresholds/dual-control policy | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Metric identity | CA-METRIC | BU, UX, REPORT, GROWTH, FIN | registered metric version | Data & Intelligence | Metric registry | Stable ID/version/source/window/grain | metric-specific Owner decisions | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Truth state | CA-METRIC | all rendering/reporting | source status | Data & Intelligence | Metric/UX | zero/no-data/unavailable/forbidden remain distinct | none | `CONSISTENT` |
| K2B provenance | K2B | METRIC, BU, GROWTH, REPORT, UX | frozen authority `7b34dec1…` | Data truth control | source-path adapters | UI/BU/report never reclassifies; UNKNOWN excluded from Actual | path implementation only | `CONSISTENT` |
| Corporate Finance | CA-FIN | METRIC, BU, REPORT, UX | future accounting SOR | Corporate Intelligence + Finance control | Finance & Accounting | Product states never promoted into books | extensive OD-CAFIN register | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Customer/growth intelligence | CA-GROWTH | METRIC, BU, REPORT, UX | domain relationship/event sources | Corporate Intelligence | Customers & Growth | Source-accurate nouns; no universal customer until approved | OD-CAGROWTH register | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| BU scorecards | CA-BU consumes METRIC/K2B/FIN/GROWTH | UX, REPORT | domain-specific sources | Corporate Intelligence | Business Units | eligibility state per slot; no synthetic health score | BU/metric/finance policies | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Management reports | CA-REPORT | UX, RBAC, FIN, BU | report registry/snapshot implementation | Corporate Intelligence | Reports | immutable period/scope/version/provenance; publication separate | OD-CAREPORT register | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Platform/Security | CA-PLAT consumes RBAC/METRIC | UX, CERT | current technical control plane | Platform & Security | Platform | technical authority never creates business authority | OD-CAPLAT register | `CONSISTENT_WITH_PENDING_OWNER_POLICY` |
| Current `/admin` | CA-ARCH current state; PLAT/UX migration maps | all | frozen product `7b34dec1…` | Mixed legacy | coexistence bridge | preserve current capability until each replacement certified | route-by-route migration | `MIGRATION_DEPENDENCY` |
| Future `/corporate` | Canonical plan + UX | all accepted authorities | CA-K3 implementation | three planes | CA-K3 product lane | no architecture invention; exact-head source/access/truth proof | implementation work | `IMPLEMENTATION_DEPENDENCY` |

### 5.1 Organisation hierarchy clarification

The accepted CA-ORG taxonomy does **not** define a single linear chain:

`BU → Corporate Function`.

It defines internal branching:

`CORPORATE_PARENT`
→ optional proven `LEGAL_ENTITY / SUBSIDIARY`
→ `BUSINESS_UNIT OR CORPORATE_FUNCTION`
→ `DEPARTMENT`
→ `TEAM`

with accepted direct-parent flexibility for departments/teams where a layer is intentionally omitted.

Therefore the certification-safe reading of the programme shorthand is:

**Company → optional legal entity/subsidiary → management BU or Corporate Function → department → team**

Central functions remain central/shared peers of BUs, not children duplicated inside every BU.

This is a clarification against the accepted CA-ORG authority, not an architecture redesign.

---

# 6. Cross-plane collision audit

A mixed current screen is not automatically a collision.

It is certifiable when:

1. each source retains its owning authority;
2. business mutation stays in the owning domain;
3. Platform mutation stays technical;
4. Corporate analytics remain read/aggregate-oriented;
5. access is separately evaluated;
6. migration can split presentation without rewriting source truth.

| Current surface | Current purpose | Source/domain authority | Current mutation authority | Corporate Intelligence responsibility | Business Operations responsibility | Platform & Security responsibility | Future destination | Coexistence requirement | Collision result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin` | Mixed command centre + shortcuts | command-centre projections + linked domains | linked domain actions only | Corporate Overview composition | contextual links only | technical links only | Corporate Overview + plane destinations | Yes | Migration dependency, not collision |
| `/admin/users` | Account list, legacy roles, account creation, People review link | account/auth + People/compliance reads | legacy account endpoints/domain controls | aggregate account context only | People & Access lifecycle | session/security tooling only | People & Access + Platform Security | Yes | Split valid |
| `/admin/communications*` | Inbox, SLA, replies, provider/worker/dead letters | Communications domain | business reply/handoff + technical recovery | growth/report aggregates only | conversations/customer workflow | provider/worker technical operations | Operations/Growth + Platform | Yes | Split required |
| `/admin/features` | Feature governance + Navigation Analytics | feature governance + nav analytics | feature overrides | nav usage belongs Data/Growth | none | feature technical state | Platform Feature Governance + Data/Growth | Yes | Split required |
| Navigation Analytics | discovery telemetry | Navigation Intelligence | none/business read | Growth/Data analysis | none | instrumentation technical support only | Customers & Growth / Data & Intelligence | Yes | Consistent |
| Marketplace Moderation | listing/inquiry moderation | Marketplace | domain moderation | aggregate scorecard only | Marketplace Ops | none | Operations / BU Marketplace | Yes | Not Platform |
| Dealer administration | dealer compliance/commercial ops | Dealer/Marketplace/Compliance | owning services | BU aggregate | operating/compliance queues | provider/runtime only | Marketplace Ops + Trust | Yes | Consistent split |
| Garage administration | onboarding/workspaces/service | Service Network | garage/service authorities | Service BU aggregate | Service Operations | integrations only | Service Network Ops + Trust | Yes | Consistent split |
| Evidence | evidence review | Evidence/Trust | domain review authority | aggregate backlog only | Trust/Risk/Compliance | storage/runtime only | Trust/Risk/Compliance | Yes | Not Platform |
| Verification | identity verification | Identity authority | domain reviewer | aggregate state only | Trust/Risk/Compliance | provider/technical path only | Trust/Risk/Compliance | Yes | Not Platform |
| Fraud | fraud cases/review | Fraud authority | domain reviewer | aggregate backlog only | Trust/Risk/Compliance | model/runtime only | Trust/Risk/Compliance | Yes | Not Platform |
| Referrals/Growth | campaign/codes/leads/marketing | Referral/Growth | referral services | Growth analytics | Growth Operations | channel infrastructure only | Customers & Growth / Operations | Yes | Consistent |
| `/admin/ai` | model/server-health presentation | AI/runtime source | current source mostly read | business AI value not implied | domain decisions remain human/domain | model/provider runtime | Platform → AI/Model Ops | Yes | Platform technical |
| Diaspora Trade Admin | compliance/workbook/dry-run | Trade domain | Trade/reviewer services | BU trade scorecard | Trade Operations/Trust | integrations/runtime only | BU Trade / Operations / Trust | Yes | Not Platform |
| Provider administration | registry/activation/kill/health | provider platform | provider control plane | no business conclusion | source-domain business workflow separate | technical provider control | Platform → Integrations | Yes | Platform technical |
| Runtime diagnostics | health/build/database target | runtime/config | technical only | none unless registered metric | none | Platform Runtime | Platform → Diagnostics | Yes | Platform technical |
| Session/security administration | assurance/session/revocation | auth/security | Security/session services | none | People/Access experience may invoke | technical Security control | Platform Security + People & Access | Yes | Split by responsibility |
| Management reports | report registry/snapshots/lifecycle | CA-REPORT | report lifecycle authority only | Reports | source-domain mutations remain elsewhere | rendering/storage/runtime only | Reports | Yes | Consistent |

### 6.1 Cross-plane audit outcome

**PASS_WITH_PENDING_OWNER_POLICY**

No accepted source requires collapsing the three planes.

Current mixed Admin presentation is a migration problem with a bounded coexistence path, not a controlling architecture contradiction.

---

# 7. Organisation-model certification

## 7.1 Certified organisational invariants

- **BU ≠ legal entity**
- **corporate function ≠ BU**
- **partner/vendor/tenant ≠ internal department**
- **external participant ≠ internal Corporate member**
- **organisational placement ≠ permission**
- **cost centre/profit centre ≠ organisational unit by default**

Accepted management BUs:

- `BU_MARKETPLACE`
- `BU_SERVICE_NETWORK`
- `BU_FINANCIAL_SERVICES`
- `BU_DIASPORA_TRADE`

Accepted central functions include:

- `CF_EXECUTIVE`
- `CF_FINANCE_ACCOUNTING`
- `CF_CUSTOMERS_GROWTH`
- `CF_TRUST_RISK_COMPLIANCE`
- `CF_DATA_INTELLIGENCE`
- `CF_LEGAL_GOVERNANCE`
- `CF_PEOPLE_ADMIN`
- `CF_PLATFORM_TECH`

External dealers, garages, banks, insurers, governments, logistics actors and partners remain external even when they use CarUp accounts, tenants, portals or APIs.

## 7.2 Certification gates for organisation implementation

Implementation must prove:

- stable internal organisation IDs;
- no product route creates legal status;
- internal membership source is separate from external tenant membership;
- central functions are not duplicated as BU child organisations merely to simplify permissions;
- matrix/control relationships do not themselves grant access;
- archived reports retain the historical organisation scope/version they were generated against.

## 7.3 Organisation result

**PASS_WITH_PENDING_OWNER_POLICY**

Pending legal-entity, formal-function and internal-membership source decisions are explicitly fail-closed and do not make the architecture internally inconsistent.

---

# 8. RBAC / role certification

## 8.1 Future access expression

Accepted Corporate authority evaluates:

**identity × Corporate membership × permission × internal organisation scope × geography × data classification × delegation/context × assurance × time × SoD × domain authority × provenance**

Preserve:

- **job title ≠ permission**
- **account ≠ membership**
- **membership ≠ permission**
- **permission ≠ scope**
- **tenant role ≠ internal Corporate membership**
- **legacy role ≠ Corporate membership**
- **Platform Admin ≠ universal Corporate authority**
- **Executive title ≠ restricted-record access**
- **aggregate access ≠ record-detail access**
- **assurance ≠ permission**
- **report read ≠ report publish**
- **report read ≠ export**
- **People membership administration ≠ Security administration**
- **navigation visibility ≠ authority**
- **client-selected context ≠ grant**
- **multiple grants must not synthesize a privilege no single approved grant carries**

## 8.2 Legacy compatibility bridge

Current runtime still recognizes:

- `admin`
- `platform_admin`
- `super_admin`
- external tenant/product roles.

Certification permits temporary compatibility only when:

- server-derived base role remains authoritative;
- tenant role cannot elevate into platform authority;
- capability/scope checks are added without weakening domain checks;
- frontend normalization is presentation only;
- replacement grants are independently certified before retirement.

No future permission assignment may be inferred from the legacy label alone.

## 8.3 Role retirement certification

A legacy role consumer may retire only after:

1. every route/service consumer is inventoried;
2. future permission class is identified;
3. current legitimate actors are mapped;
4. negative authorization tests pass;
5. scope/classification/assurance is server enforced;
6. rollback/coexistence is defined;
7. no current operational capability is orphaned;
8. exact-head evidence passes.

## 8.4 RBAC result

**PASS_WITH_PENDING_OWNER_POLICY**

No accepted model grants universal Admin authority. Remaining issues are implementation and Owner-policy decisions, not architecture collisions.

---

# 9. Data-classification / access matrix

The matrix below is conceptual and does not issue grants.

| Information class | Semantic owner | Owning plane | Aggregate visibility | Record-detail visibility | Mutation authority | Export | Assurance expectation | Scope/classification requirement | Certification gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary Corporate aggregates | metric/business owner | Corporate Intelligence | explicit Corporate/BU read grants | underlying rows separate | none from aggregate view | separate | A0 normally; policy may raise | Internal/Internal Confidential + org scope | AUTH-aggregate + METRIC truth |
| BU aggregates | BU + metric owner | Corporate Intelligence | assigned BU/corporate scope | domain records separate | none | separate | A0 | BU scope | AUTH sibling-denial |
| Customer/participant PII | Customers/Growth + source domain | Corporate/Operations | minimized aggregates only | explicit PII permission | source-domain only | separately gated | A1 where sensitive | classification + org/geography | AUTH-PII |
| Restricted customer records | owning domain | Business Operations | aggregate status only | explicit record/case permission | owning service | separate | A1 or higher policy | record scope + classification | AUTH-record |
| Finance summaries | CF_FINANCE_ACCOUNTING | Corporate Intelligence | explicit finance summary grant | line items separate | Finance SOR only | separate | A0/A1 by policy | Restricted Financial | FIN/AUTH |
| Restricted Finance detail | CF_FINANCE_ACCOUNTING | Corporate Intelligence / Finance control | no automatic executive access | explicit restricted-finance permission | Finance authority | separate + stronger | A1/A2 policy | legal entity/BU/classification | FIN/AUTH/SoD |
| People-private records | CF_PEOPLE_ADMIN | Business Operations | approved aggregates | explicit People private permission | People authority | separate | A1+ | People scope | AUTH-People |
| Identity/KYC evidence | CF_TRUST_RISK_COMPLIANCE | Business Operations | aggregate review counts | explicit evidence/case permission | identity/evidence domain | separate | high assurance | Restricted Identity/Compliance | AUTH-KYC |
| Fraud/compliance case detail | CF_TRUST_RISK_COMPLIANCE | Business Operations | risk backlog aggregate | reviewer/control scope | domain service | separate | A1+ | control scope | AUTH-risk |
| Reports | Reporting owner | Corporate Intelligence | explicit report read | appendices separately classified | report lifecycle only | separate permission | depends family | report scope/classification | REPORT-read |
| Restricted report appendix | source owner + reporting owner | Corporate Intelligence | summary may omit appendix | source-equivalent restricted permission | source/report assembly only | high-risk separate | A1/A2 policy | source classification inherited | REPORT-appendix |
| Platform diagnostics | CF_PLATFORM_TECH | Platform & Security | technical status with Platform read | detailed diagnostics Platform scope | Platform technical service | no automatic export | A0/A1 policy | Restricted Security/Platform | PLAT-diagnostics |
| Provider configuration | CF_PLATFORM_TECH | Platform & Security | status/reference metadata | technical config only | provider manage | no business export | A1 policy for change | Platform scope/environment | PLAT-provider |
| Credential reference | CF_PLATFORM_TECH/Security | Platform & Security | configured/reference metadata | reference only | controlled rotation/update | no raw-secret export | high assurance for change | Restricted Security/Platform | PLAT-secret |
| Raw secret | secret system, not Admin UI | Platform & Security | never | generally unavailable | controlled secret operation only | forbidden by default | strongest accepted policy | Restricted Security/Platform | PLAT-secret-denial |
| Technical audit | Platform/Security audit owner | Platform & Security | summaries where approved | scoped/redacted event access | append through owning systems | separate/possibly forbidden | A1 for sensitive export | embedded classification applies | PLAT-audit |

### 9.1 Cross-role certification examples

- Executive aggregate grant must stop before PII/KYC/Finance line items.
- BU Lead must be denied sibling BU data.
- Platform Admin must be denied Corporate Finance and customer PII unless separately granted.
- Compliance Reviewer may receive cross-BU control scope without becoming a member of every BU.
- Report Publisher may publish an approved report but cannot mutate source-domain facts.
- Infrastructure/report-service operator may keep report jobs healthy without becoming report publisher.

---

# 10. Metric / truth certification

## 10.1 Display-state contract

Certified rendering must distinguish:

- measured `0`
- `NO DATA`
- `UNAVAILABLE`
- `NOT SEPARABLE`
- `FORBIDDEN`
- `INSUFFICIENT_DATA`

A failed source is not measured zero.

Forbidden access is not unavailable data.

## 10.2 Truth-state contract

Accepted metric states include:

- `GOVERNED_ACTUAL`
- `GOVERNED_DERIVED`
- `GOVERNED_RATE_OR_RATIO`
- `ADVISORY`
- `TECHNICAL_OPERATIONAL`
- `CONTAMINATED_PENDING_K2B`
- `INSUFFICIENT_DATA`
- `UNAVAILABLE_NO_SOURCE`
- `UNAVAILABLE_NOT_SEPARABLE`
- `DUPLICATED_OR_CONFLICTING`
- `UNKNOWN_AUTHORITY`
- `DEPRECATED`

Preserve:

- **candidate ≠ Actual**
- **diagnostic ≠ KPI**
- **technical operational ≠ business performance**
- **peak-day unique ≠ true period unique**
- **independent stage totals ≠ linked funnel conversion**
- **route render ≠ customer**
- **feature enabled ≠ feature used**
- **feature impression ≠ adoption**
- **failed read ≠ zero**
- **same label with different formula/version ≠ same metric**

## 10.3 Metric activation requirements

No Corporate metric becomes active merely because a query returns a number.

Certification requires:

- metric ID;
- lineage version;
- exact source;
- calculation authority/version;
- grain;
- window;
- timestamp authority;
- provenance;
- inclusion/exclusion;
- zero/no-data/unavailable semantics;
- freshness/completeness;
- classification;
- aggregate/detail/export permissions;
- certification state.

## 10.4 Known mandatory guards

- Navigation 50,000-row cap must not silently produce complete-looking Corporate ranks.
- Current multi-day Marketplace unique projection must be labelled peak-day, not period unique.
- Current unlinked “conversion” ratios must not be labelled linked conversion.
- Human-readable top free-text search terms remain unavailable from hash-only source.
- Cross-currency amounts must not be summed without accepted finance/FX authority.
- AI generated output remains advisory.
- product/provider state does not become business KPI by placement.

## 10.5 Metric result

**PASS_WITH_PENDING_OWNER_POLICY**

The accepted models consistently preserve missing/blocked states rather than invent values.

---

# 11. K2B certification

Frozen authority:

`7b34dec1bc9f05b72b6abf0104db65980f280a0b`

## 11.1 K2B ownership

K2B answers whether a source row/path is eligible as operational business truth.

Corporate Admin answers how an eligible fact is presented, aggregated and authorized.

Therefore:

**K2B classification authority ≠ Corporate presentation authority**

## 11.2 Required downstream behavior

- operational records may enter Actual only through an accepted/certified source path;
- non-operational records are excluded from Actual;
- UNKNOWN/review-required records are excluded from Actual;
- test/UAT/automation/certification populations cannot silently inflate business metrics;
- pending source paths remain candidate/pending;
- Corporate UI does not reclassify;
- BU scorecards do not reclassify;
- Growth does not reclassify;
- Reports do not reclassify;
- Platform does not reclassify.

Known public-vehicle rule:

> No Corporate/Admin projection may call a vehicle public unless canonical public Marketplace could actually expose it.

## 11.3 K2B implementation proof

Every source adapter entering Corporate Actual must identify:

- source family;
- K2B eligibility path/version;
- excluded non-operational count where safe;
- UNKNOWN/review count where safe;
- test/fixture handling;
- fallback behavior;
- source-read failure behavior.

## 11.4 K2B result

**PASS**

The accepted architecture consumes K2B as an upstream authority and does not define a competing classifier.

Path-specific consumption remains an implementation-certification dependency.

---

# 12. Finance certification

CA-FIN's controlling conclusion remains:

**PRODUCT FINANCIAL FACTS EXIST; CORPORATE ACCOUNTING AUTHORITY DOES NOT YET EXIST.**

Preserve:

- **Financial Services BU ≠ Corporate Finance & Accounting**
- **listing price ≠ transaction value**
- **requested finance ≠ disbursement**
- **quote ≠ completed sale**
- **deposit ≠ full transaction**
- **payment intent ≠ cash**
- **scheduled milestone ≠ cash**
- **escrow ≠ revenue**
- **GMV ≠ revenue**
- **revenue ≠ gross profit**
- **gross profit ≠ operating profit**
- **receivable ≠ cash**
- **provider reconciliation ≠ accounting reconciliation**
- **commercial fee class ≠ recognized revenue**

## 12.1 Blocked/pending Corporate accounting metrics

Until separately accepted accounting authority exists:

- GMV;
- recognized revenue;
- gross profit;
- gross margin;
- operating expense;
- operating profit;
- net profit;
- cash;
- AR;
- AP;
- average transaction value;
- take rate;
- contribution margin;
- revenue/customer;
- CAC;
- LTV;
- accounting FX/consolidated currency totals.

Product commercial facts may remain visible under their source-accurate names.

They must not fill blocked Finance slots.

## 12.2 Platform/payment boundary

Provider success may prove a technical/provider workflow fact.

It cannot by itself prove:

- cash;
- accounting settlement;
- recognized revenue;
- receivable/payable;
- bank reconciliation.

## 12.3 Finance result

**PASS_WITH_PENDING_OWNER_POLICY**

No accepted downstream authority overrides CA-FIN or manufactures accounting truth.

---

# 13. Customers / Growth certification

Preserve:

- **account ≠ customer**
- **registered user ≠ verified person**
- **registered user ≠ customer**
- **session ≠ customer**
- **route render ≠ customer**
- **inquiry ≠ customer**
- **inquiry ≠ sale**
- **guest email ≠ customer**
- **external tenant ≠ customer**
- **referral code ≠ customer**
- **campaign association ≠ causality**
- **Trade participant ≠ universal Corporate customer**
- **customer count ≠ sum of BU customer counts**
- **peak-day unique ≠ period unique**

The accepted architecture does not yet contain one universal Corporate customer definition.

## 13.1 Certified noun discipline

Until Owner-approved semantics exist, use:

- registered account;
- verified identity subject;
- Marketplace buyer/inquirer;
- seller;
- service work-order customer;
- Trade buyer/participant;
- finance applicant;
- insurance participant;
- external provider/institution;
- anonymous/pseudonymous session.

Do not normalize all of them to `Customer`.

## 13.2 Funnel discipline

A metric may be labelled conversion/drop-off only when it has:

- explicit journey/domain;
- stage A and B;
- same governed link key;
- cohort entry;
- time window;
- repeated-stage rule;
- exclusions/provenance;
- denominator floor/quality;
- completion semantics.

Independent totals may be activity ratios only.

## 13.3 Attribution discipline

Referral/campaign/source association is not causal acquisition until an accepted attribution policy defines:

- model;
- lookback;
- direct treatment;
- conflicts;
- identity/linkage;
- coverage.

CAC/LTV/ROAS remain doubly dependent on Growth + Finance authority.

## 13.4 Growth result

**PASS_WITH_PENDING_OWNER_POLICY**

The absence of one universal customer definition is explicit and fail-closed, not a contradiction.

---

# 14. Business Unit certification

Accepted BUs:

- `BU_MARKETPLACE`
- `BU_SERVICE_NETWORK`
- `BU_FINANCIAL_SERVICES`
- `BU_DIASPORA_TRADE`

## 14.1 BU-wide invariants

Every BU certification must prove:

- management construct, not automatically legal entity;
- central-function ownership remains central;
- source-specific participant nouns remain intact;
- metric eligibility vocabulary is visible/enforced;
- no synthetic universal BU Health Score;
- no summation of BU relationships into Corporate distinct customers;
- cross-BU rank only where metric semantics genuinely align;
- Finance remains CA-FIN-governed;
- operational queues remain Business Operations;
- Platform responsibilities remain technical.

Accepted scorecard eligibility vocabulary includes:

- `CERTIFIED_CURRENT`
- `CANDIDATE_AFTER_K2B_CONSUMPTION`
- `BLOCKED_OWNER_DECISION`
- `PENDING_CA_FIN`
- `UNAVAILABLE_NO_SOURCE`
- `UNAVAILABLE_NOT_SEPARABLE`
- `DIAGNOSTIC_ONLY`
- `TECHNICAL_OPERATIONAL`

## 14.2 Cross-BU comparison

Allowed:

- same registered metric family/version;
- harmonized backlog/cycle definition;
- freshness/completeness;
- control-backlog class;
- report timeliness.

Not allowed:

- one universal conversion column from unrelated funnels;
- one weighted BU health score;
- rank by unavailable revenue;
- rank by customer growth where customer definitions differ;
- sum listing/service/request/quote amounts;
- route renders as cross-BU active users.

## 14.3 BU result

**PASS_WITH_PENDING_OWNER_POLICY**

Each BU explicitly defers to the correct specialist authority.

---

# 15. Reporting certification

Preserve:

**Dashboard = current/live governed view**

**Report = period-bound, scope-bound, version-bound, reproducible governed artifact**

And:

- **generation ≠ publication**
- **candidate metric ≠ Actual**
- **Platform Admin ≠ Reporting Publisher**
- **report read ≠ report publish**
- **report read ≠ export**
- **report infrastructure administration ≠ report publication authority**

## 15.1 Report instance certification

A report instance must freeze:

- definition ID/version;
- period;
- organisational/geographic scope;
- metric IDs/versions;
- values/display states;
- source/as-of state;
- K2B/provenance state;
- availability/freshness;
- classification;
- generation/review/approval/publication custody;
- export classification.

Reports must not silently recompute history under current definitions.

## 15.2 Lifecycle / SoD

The accepted report lifecycle separates:

- Draft;
- Generated;
- In Review;
- Returned/Rejected;
- Approved;
- Published;
- Superseded;
- Restated;
- Withdrawn;
- Generation Failed.

Publication requires its own permission/policy.

A generated report is not published.

## 15.3 Owner-policy behavior

An unresolved reporting Owner Decision is a question requiring authority, not permission.

A pending policy is certifiable only when implementation remains fail-closed.

## 15.4 Reporting result

**PASS_WITH_PENDING_OWNER_POLICY**

The reporting model consumes Metric/K2B/Finance/Growth semantics rather than redefining them.

---

# 16. Platform certification

Accepted Platform authority:

`ba8485534bd5d555c6565d85ddb5954a26408844`

Certify:

- Feature Governance cannot broaden immutable role policy;
- Navigation Intelligence remains distinct from Platform technical state;
- provider configuration does not grant source-domain record access;
- raw secrets are not ordinary Admin-readable values;
- credential reference ≠ credential reveal;
- AI output remains advisory;
- model configured ≠ model certified;
- model available ≠ model quality;
- A1 is not represented as A2;
- deployment visibility ≠ deployment authority;
- staging/test runtime facts cannot become Corporate Actual;
- Communications technical permission does not grant customer-conversation/business authority;
- Security administration does not become People membership authority;
- provider reconciliation does not become accounting reconciliation;
- Platform Admin ≠ Reporting Publisher;
- Platform Admin ≠ universal Corporate authority.

## 16.1 Editorial observations only

Two accepted CA-PLAT wording defects are recorded without reopening the model:

1. `OD-CAPLAT-001` contains a malformed internal section reference: `use the seven-area IA in \`34`.
2. The secret-reveal invariant is duplicated immediately under the secret-rotation section.

These are **EDITORIAL / NON-SEMANTIC**.

They do not change permission, architecture, source truth, migration or certification result.

A future bounded documentation-cleanup task may fix them only if CA-MOD authorizes it.

## 16.2 Platform result

**PASS_WITH_PENDING_OWNER_POLICY**

---

# 17. /admin → /corporate migration certification matrix

Core rule:

> **Existing `/admin` and future `/corporate` coexist until each individual replacement is independently certified.**

A new page does not become authoritative merely because it looks complete.

| Current route/capability | Current real purpose | Current plane mixture | Target plane | Future Corporate destination | Current source authority | Current mutation authority | Future permission class | Coexist? | Backend change? | Product change? | Data migration? | Exact certification gate | Retirement condition |
| --- | --- | --- | --- | --- | --- | --- | --- | :---: | :---: | :---: | :---: | --- | --- |
| `/admin` | Mixed command centre/shortcuts | all three | Corporate Intelligence | `/corporate` Overview | source-labelled command centre | linked domains only | `corporate.overview.read` | Yes | likely wrapper | Yes | No | MIG-001 + METRIC-001 | new Overview source/access/exact-head certified; no orphan links |
| `/admin/features` governance tab | feature registry/rollout | Platform | Platform | Platform → Feature Governance | feature governance | feature override service | `platform.feature.read/manage` | Yes | capability fronting | Yes | No | PLAT-001/002 + AUTH-001 | replacement certified |
| `/admin/features` analytics tab | nav usage | Corporate Intelligence mixed into Platform page | Corporate Intelligence | Customers & Growth / Data & Intelligence | Navigation Intelligence | read only | Corporate growth/data aggregate | Yes | maybe read-model wrapper | Yes | No | METRIC-004 + MIG-002 | analytics replacement certified |
| `/admin/users` | account list/legacy role/create + People review link | Business Ops + Platform compatibility | Business Operations | People & Access; Security cross-link | accounts/auth/People read models | auth/account/domain services | People/access + security separately | Yes | Yes | Yes | future membership store | AUTH-002/003 + MIG-003 | role field no longer permission authority |
| `/admin/ai` | model/server health | Platform | Platform | AI / Model Operations | AI/runtime sources | future model control-plane | `platform.ai.read/manage` | Yes | likely | Yes | No | PLAT-004/005 | model/provider source and access certified |
| `/admin/moderation` | Marketplace moderation | Business Operations | Business Operations | Operations → Marketplace | Marketplace authority | Marketplace moderation service | BU/domain Ops | Yes | capability fronting | Yes | No | AUTH-004 + MIG-004 | new Ops surface certified |
| `/admin/evidence` | evidence review | Business Operations | Business Operations | Trust/Risk/Compliance | evidence authority | evidence review service | restricted compliance review | Yes | capability fronting | Yes | No | AUTH-005 + MIG-004 | replacement certified |
| `/admin/vehicles/:vin/review` | vehicle operations review | Business Operations | Business Operations | Marketplace Ops / Trust | composed vehicle/evidence/seller/trust authorities | owning domain services | restricted reviewer | Yes | wrapper/gates | Yes | No | AUTH-005 + MIG-004 | replacement certified |
| `/admin/people/:userId/review` | identity/authority/compliance read | Business Operations | Business Operations | Trust / People context | people compliance read model | owning domain services | restricted person read/review | Yes | capability alignment | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/fraud-queue` | fraud review | Business Operations | Business Operations | Trust/Risk/Compliance | fraud authority | fraud service | compliance reviewer | Yes | capability fronting | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/dealer-compliance` | dealer compliance | Business Operations | Business Operations | Trust + Marketplace | dealer compliance | dealer compliance service | control/reviewer | Yes | capability fronting | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/garage-applications` | garage onboarding/review | Business Operations | Business Operations | Service Ops + Trust | garage onboarding | garage review service | service/control permission | Yes | capability fronting | Yes | No | AUTH-004/006 + MIG-004 | replacement certified |
| `/admin/verification` | identity verification cases | Business Operations | Business Operations | Trust/Risk/Compliance | identity authority | verification service | restricted identity reviewer | Yes | capability fronting | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/trust-review` | Trust review | Business Operations | Business Operations | Trust/Risk/Compliance | Trust authority | Trust service | reviewer | Yes | capability fronting | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/governance-review` | governance review | Business Operations/control | Business Operations | Trust / Legal-Governance | governance authority | governance service | reviewer/control | Yes | capability fronting | Yes | No | AUTH-006 + MIG-004 | replacement certified |
| `/admin/referrals` | campaigns | Business Ops/Growth | Business Operations | Customers & Growth / Growth Ops | referral authority | referral service | Growth operator | Yes | capability fronting | Yes | No | GROWTH-004 + MIG-005 | replacement certified |
| `/admin/referrals/codes` | codes/coupons | Business Ops/Growth | Business Operations | Growth Ops | referral authority | referral service | Growth operator | Yes | capability fronting | Yes | No | GROWTH-004 + MIG-005 | replacement certified |
| `/admin/referrals/local-leads` | local leads | Business Ops/Growth | Business Operations | Growth Ops | referral/Marketplace | referral service | Growth operator | Yes | capability fronting | Yes | No | GROWTH-004 + MIG-005 | replacement certified |
| `/admin/referrals/import-routes` | referral import routes | Business Ops/Growth/Trade | Business Operations | Growth / Trade Ops | referral/Trade | referral/Trade service | scoped operator | Yes | capability fronting | Yes | No | GROWTH-004 + MIG-005 | replacement certified |
| `/admin/referrals/marketing` | marketing content/ops | Growth | Business Operations | Customers & Growth | referral/marketing | marketing/referral service | Growth/marketing | Yes | capability fronting | Yes | No | GROWTH-005 + MIG-005 | replacement certified |
| `/admin/referrals/trust` | referral trust review | Trust + Growth | Business Operations | Trust/Risk/Compliance | referral trust | trust-review service | control/reviewer | Yes | capability fronting | Yes | No | AUTH-006 + MIG-005 | replacement certified |
| `/admin/communications*` inbox/SLA | conversations/replies/handoff | Business Ops | Business Operations | Operations / Customers & Growth | Communications domain | communication service | comms operator | Yes | split APIs where needed | Yes | No | GROWTH-006 + MIG-006 | business surface certified |
| `/admin/communications*` provider/worker/dead-letter | technical delivery | Platform | Platform | Integrations → Communications Delivery | technical comms telemetry | technical recovery/provider tools | platform integration/provider | Yes | split technical endpoints/gates | Yes | No | PLAT-006 + MIG-006 | technical surface certified |
| `/dashboard/admin/communications*` | aliases | mixed legacy alias | split as above | canonical replacements | same | same | same | Yes | redirect eventually | Yes | No | MIG-006 | all links/tests moved |
| `/admin/diaspora/compliance` | Trade compliance | Business Ops | Business Operations | Trade Ops / Trust | Trade compliance | domain service | Trade/control reviewer | Yes | capability fronting | Yes | No | BU-004 + MIG-004 | replacement certified |
| `/admin/diaspora/workbooks` | workbook operator | Business Ops | Business Operations | Trade Data Intake Ops | workbook authority | workbook service | Trade operator | Yes | capability fronting | Yes | No | BU-004 + MIG-004 | replacement certified |
| `/admin/diaspora/workbooks/new` | dry-run | Business Ops | Business Operations | Trade Data Intake Ops | dry-run authority | workbook service | Trade operator | Yes | capability fronting | Yes | No | K2B-004 + MIG-004 | replacement certified |
| `/api/admin/providers*` | provider control plane | Platform | Platform | Integrations & Providers | provider registry | provider platform service | `platform.provider.*` | Yes | capability fronting | UI needed | No | PLAT-003 + AUTH-007 | compatibility role no longer needed |
| `/api/admin/health` | server-health rows | Platform | Platform | Runtime / Diagnostics | `server_health` | read | `platform.health.read` | Yes | projection cleanup likely | Yes | No | PLAT-007 + METRIC-006 | replacement source certified |
| auth/session security | step-up/session revocation | Platform + People UX | Platform control | Security with People link | auth/session authority | security service | `platform.security.*` / self-service | Yes | capability alignment | Yes | No | AUTH-008 + PLAT-008 | replacement certified |
| report jobs/storage/rendering | technical report infrastructure | Platform supports Reports | Corporate Reports + Platform infra | Reports + technical support | CA-REPORT/report service | report lifecycle vs infra separately | report + platform permissions separate | Yes | implementation | Yes | report snapshot store | REPORT-001..006 | report lifecycle certified |

### 17.1 Prohibited migration shortcuts

Do not certify:

- big-bang deletion;
- blanket `/admin → /corporate` redirect;
- global replacement based on visual parity;
- source formula changes hidden inside UI migration;
- route retirement before backend/access/source parity;
- stale screenshots/CI from an older SHA as current replacement evidence.

---

# 18. Negative-certification matrix

Positive paths are insufficient. The following denials must be proven where applicable.

| Negative requirement | Required proof | Failure blocks |
| --- | --- | --- |
| Ordinary user cannot enter Corporate Admin | server + route negative test | implementation acceptance/release |
| External tenant membership cannot mint internal Corporate membership | server integration test | access activation |
| Tenant role cannot become `platform_admin`/`super_admin` | auth negative test | access activation/release |
| Frontend role normalization cannot widen backend authority | backend denial with normalized UI role | implementation acceptance |
| BU Lead cannot read sibling BU by route/query manipulation | scoped integration test | BU migration |
| Platform Admin cannot read restricted Finance by default | authorization-negative test | Platform migration |
| Platform Admin cannot read customer PII merely for debugging | authorization-negative test | Platform migration |
| Platform Admin cannot inspect KYC evidence merely because it runs the system | authorization-negative test | Platform migration |
| Executive title alone cannot read restricted records | assignment/title negative test | Corporate access activation |
| Aggregate grant cannot retrieve underlying records | API negative test | Corporate Intelligence acceptance |
| Report reader cannot publish | report lifecycle negative test | Reports release |
| Report reader cannot export when export separately gated | report export negative test | Reports release |
| Report publisher cannot mutate source-domain facts | domain API negative test | Reports release |
| Report infrastructure admin cannot self-grant publication | RBAC/SoD negative test | Reports/Platform release |
| Candidate metric cannot render as Actual | truth-state unit/integration test | metric/UI acceptance |
| K2B UNKNOWN cannot enter Actual | provenance fixture/integration test | metric/report acceptance |
| non-operational/UAT/automation/certification rows cannot enter Actual | K2B fixture/source-path test | Corporate metrics/reports |
| source read failure cannot render numeric zero | failure injection test | metric/UI acceptance |
| provider success cannot become revenue/cash | semantic contract test | Finance acceptance |
| AI output cannot become authoritative domain decision without separate authority | service/domain test | AI feature acceptance |
| staging/test runtime facts cannot become Production business truth | environment/provenance test | release/reporting |
| route render cannot become customer/unique visitor | metric contract test | Growth acceptance |
| unlinked stage totals cannot become conversion/drop-off | metric/funnel test | Growth/BU acceptance |
| report generation cannot equal publication | lifecycle test | Reports release |
| secret reference cannot expose raw secret | API/UI/log/audit negative test | Platform release |

---

# 19. CA-K3 implementation certification contract

CA-K3 remains separate and untouched.

Every future Corporate product slice must return evidence for:

1. exact starting SHA;
2. exact final SHA;
3. exact accepted architecture dependencies;
4. bounded changed paths;
5. no architecture invention;
6. no new metric formula without CA-METRIC authority;
7. no new accounting semantics without CA-FIN;
8. no new customer definition without CA-GROWTH/Owner authority;
9. no K2B reimplementation;
10. no title/legacy-role authority widening;
11. targeted unit tests;
12. relevant integration/regression tests;
13. typecheck;
14. build;
15. `git diff --check`;
16. responsive evidence where UI changes;
17. keyboard/accessibility evidence;
18. truth-state tests;
19. authorization-negative tests;
20. ordinary-user denial;
21. sibling/cross-plane denial where applicable;
22. source-unavailable/failure behavior;
23. exact-head runtime/screenshots where applicable;
24. current evidence only;
25. no stale evidence substitution;
26. explicit coexistence/rollback behavior for migrated current Admin surfaces;
27. no unauthorized staging/Production mutation.

CA-CERT does not self-accept any CA-K3 result.

Every implementation return remains subject to CA-MOD disposition:

`ACCEPT`
`REMEDIATE`
or
`BLOCK`

---

# 20. Certification gate catalogue

Every gate is deterministic.

Severity:

- `P0` — authority/truth/security failure; blocks acceptance and usually release/retirement.
- `P1` — material semantic/migration/evidence failure; blocks affected slice.
- `P2` — bounded quality/evidence deficiency; blocks claimed certification but not unrelated slices.

## 20.1 AUTH gates

| Gate | Invariant | Applicability | Required evidence | Pass | Fail | Authority owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-AUTH-001` | Identity is not authority | all Corporate routes | server auth tests | authenticated subject without grant denied | auth alone permits | CA-RBAC | P0 | access activation/release |
| `CA-CERT-AUTH-002` | Account ≠ Corporate membership | People/Access | integration fixture | account with no membership denied | account implies membership | CA-RBAC/ORG | P0 | access activation |
| `CA-CERT-AUTH-003` | Tenant role ≠ internal membership | tenant + Corporate | negative integration | tenant member cannot enter internal scope absent grant | tenant membership grants | CA-RBAC/ORG | P0 | release |
| `CA-CERT-AUTH-004` | Permission ≠ scope | BU/Operations | scoped tests | out-of-scope resource denied | capability works globally | CA-RBAC | P0 | acceptance |
| `CA-CERT-AUTH-005` | Aggregate ≠ record access | analytics/drilldown | API negative tests | aggregate grant cannot fetch rows/PII | record leak | CA-RBAC | P0 | acceptance/release |
| `CA-CERT-AUTH-006` | Restricted evidence/finance/People requires explicit grant | restricted domains | negative + assurance tests | default executive/platform denied | broad title/admin allowed | CA-RBAC | P0 | release |
| `CA-CERT-AUTH-007` | Legacy role is compatibility only | migrated legacy gates | role/capability matrix | legacy mapping explicit and bounded | implicit universal mapping | CA-RBAC/PLAT | P0 | migration/retirement |
| `CA-CERT-AUTH-008` | Assurance is cumulative, not permission | sensitive actions | A0/A1 failure/success tests | grant+required assurance required | assurance alone grants or missing assurance passes | CA-RBAC | P0 | sensitive action activation |

## 20.2 ORG gates

| Gate | Invariant | Applicability | Required evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-ORG-001` | BU ≠ legal entity | BU UI/reports | org metadata + labels | non-legal management label | subsidiary/company claim without evidence | CA-ORG | P0 | BU/reports |
| `CA-CERT-ORG-002` | Corporate function is central/shared | org tree | tree fixture/UI | function peer to BU / matrix relationship | function duplicated as BU child authority | CA-ORG | P1 | org/access |
| `CA-CERT-ORG-003` | External participant ≠ internal unit | People/BU | tenant/org fixtures | dealer/garage/provider remains external | external org shown internal | CA-ORG | P0 | access/release |
| `CA-CERT-ORG-004` | Placement does not grant | org + RBAC | membership/no-permission test | placement alone denied | placement grants action | CA-RBAC/ORG | P0 | access |
| `CA-CERT-ORG-005` | Historical scope retained | reports/history | snapshot test | report stores exact org scope/version | historical report re-resolves to current org | CA-REPORT/ORG | P1 | publication |

## 20.3 METRIC gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-METRIC-001` | metric has stable ID/version | every Corporate KPI | registry/source test | ID/version/source explicit | anonymous formula/card | CA-METRIC | P0 | metric acceptance |
| `CA-CERT-METRIC-002` | zero ≠ unavailable/no-data | all metrics | failure/empty/zero fixtures | three states render distinctly | source failure renders 0 | CA-METRIC | P0 | UI/report |
| `CA-CERT-METRIC-003` | candidate ≠ Actual | candidate sources | truth-state tests | candidate visibly blocked/labeled | candidate promoted | CA-METRIC | P0 | metric/report |
| `CA-CERT-METRIC-004` | linked funnel required | Growth/BU funnels | cohort/link-key tests | same linked population | independent totals labelled conversion | CA-METRIC/GROWTH | P0 | Growth/BU |
| `CA-CERT-METRIC-005` | peak-day unique ≠ period unique | Marketplace uniques | projection/label test | peak-day label/basis preserved | monthly/period unique claim | CA-METRIC | P1 | metric/UI |
| `CA-CERT-METRIC-006` | technical operational ≠ business KPI | Platform telemetry | registry/UX test | technical label/plane | “business health” from runtime state | CA-METRIC/PLAT | P0 | Overview/Platform |
| `CA-CERT-METRIC-007` | complete window required for ranking | bounded/truncated sources | completeness test | complete or DEGRADED/UNAVAILABLE | silent truncated rank | CA-METRIC | P0 | ranking/report |
| `CA-CERT-METRIC-008` | cross-currency sum forbidden without authority | money-like metrics | currency fixtures | grouped by currency / blocked | silent conversion/sum | CA-METRIC/FIN | P0 | Finance/BU/report |

## 20.4 K2B gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-K2B-001` | only operational eligible for Actual | business source paths | source-path tests | operational included | non-operational included | K2B | P0 | Actual/report |
| `CA-CERT-K2B-002` | UNKNOWN excluded | uncertain rows | UNKNOWN fixtures | excluded/reviewed | included as Actual | K2B | P0 | Actual |
| `CA-CERT-K2B-003` | UAT/CI/automation/fixtures excluded | contaminated sources | fixture tests | excluded | inflate business metric | K2B | P0 | metric/release |
| `CA-CERT-K2B-004` | presentation does not reclassify | UI/BU/report | adapter/UI tests | consumes K2B state | local Corporate classifier | K2B | P0 | implementation |
| `CA-CERT-K2B-005` | public listing truth matches public Marketplace | listing projections | public/Admin parity test | Admin public only when canonical public visible | admin-only public claim | K2B/Marketplace | P0 | Marketplace metrics |

## 20.5 FIN gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-FIN-001` | product amount ≠ accounting result | all money displays | semantic fixtures | source-accurate labels | quote/listing/deposit called revenue/GMV | CA-FIN | P0 | Finance/BU/report |
| `CA-CERT-FIN-002` | provider state ≠ cash | payments/escrow | provider/accounting tests | product state only | provider success called cash | CA-FIN | P0 | Finance |
| `CA-CERT-FIN-003` | GMV unavailable until accepted completion/value | Overview/Finance | metric registry test | blocked/PENDING_CA_FIN | inferred GMV | CA-FIN | P0 | release/report |
| `CA-CERT-FIN-004` | revenue/gross profit require Finance SOR | Finance/report | source-lineage test | unavailable until journal authority | product table computes | CA-FIN | P0 | Finance/report |
| `CA-CERT-FIN-005` | BU Financial Services ≠ Corporate Finance | BU/Finance IA | nav/access test | separate destinations/authority | product BU owns accounting | CA-ORG/FIN | P0 | IA/release |
| `CA-CERT-FIN-006` | Finance read/export/approval separated | Finance controls | RBAC/SoD tests | separate grants/assurance | summary reader exports/posts | CA-RBAC/FIN | P0 | Finance activation |

## 20.6 GROWTH gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-GROWTH-001` | account/session/inquiry ≠ customer | Overview/Growth | noun/metric tests | source-accurate labels | relabelled customer | CA-GROWTH | P0 | Growth/Overview |
| `CA-CERT-GROWTH-002` | no universal customer count until policy | company totals | registry/UI test | blocked/source-specific | summed BU relationships | CA-GROWTH | P0 | Overview/report |
| `CA-CERT-GROWTH-003` | Navigation ≠ commercial conversion | nav/journeys | linkage tests | separate panels/metrics | route render becomes funnel sale | CA-GROWTH/METRIC | P0 | Growth |
| `CA-CERT-GROWTH-004` | referral/campaign association ≠ causality | acquisition | attribution tests | “associated” + coverage | “acquired by” without model | CA-GROWTH | P1 | Growth/report |
| `CA-CERT-GROWTH-005` | retention/churn require approved definitions | lifecycle metrics | registry tests | blocked until definition | inactivity labelled churn | CA-GROWTH | P0 | Growth/report |
| `CA-CERT-GROWTH-006` | communications delivery ≠ engagement/conversion | comms analytics | status/funnel tests | channel states separate | sent/delivered called conversion | CA-GROWTH/PLAT | P0 | Growth |

## 20.7 BU gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-BU-001` | stable BU IDs / non-legal labels | BU shell/report | metadata tests | canonical IDs + legal UNKNOWN | routes used as legal entities | CA-BU/ORG | P0 | BU |
| `CA-CERT-BU-002` | eligibility state per metric | scorecards | component tests | every slot carries eligibility | blocked metric shown as Actual | CA-BU/METRIC | P0 | BU |
| `CA-CERT-BU-003` | no synthetic BU health score | cross-BU | UI/registry test | family matrix only | weighted invented score | CA-BU | P0 | BU Overview |
| `CA-CERT-BU-004` | operate transition preserves domain authority | BU drilldowns | route/action tests | explicit transition + domain gate | scorecard mutates directly | CA-BU/RBAC | P0 | BU/Operations |
| `CA-CERT-BU-005` | only comparable metrics rank | comparisons | version/definition tests | same semantic family | unrelated funnel ranks | CA-BU/METRIC | P1 | comparison/report |

## 20.8 REPORT gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-REPORT-001` | report definition contains no live values | definition registry | schema/service tests | template references metrics | values embedded in definition | CA-REPORT | P0 | Reports |
| `CA-CERT-REPORT-002` | instance immutable/reproducible | report generation | snapshot tests | exact versions/values retained | live recomputation changes history | CA-REPORT | P0 | publication |
| `CA-CERT-REPORT-003` | generation ≠ publication | lifecycle | state/permission tests | separate transition/grant | generate auto-publishes | CA-REPORT/RBAC | P0 | publication |
| `CA-CERT-REPORT-004` | restricted appendices inherit source restrictions | sensitive reports | access tests | appendix separately gated | report read leaks source detail | CA-REPORT/RBAC | P0 | report release |
| `CA-CERT-REPORT-005` | export separate from read | exports | negative tests | export grant required | read downloads restricted data | CA-REPORT/RBAC | P0 | export |
| `CA-CERT-REPORT-006` | restatement/supersession preserves history | corrections | lifecycle tests | append/supersede with reason | destructive rewrite | CA-REPORT | P0 | archive/publication |

## 20.9 PLAT gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-PLAT-001` | feature override cannot broaden immutable role policy | Feature Governance | service tests | narrowing only | role widening | CA-PLAT/RBAC | P0 | Platform |
| `CA-CERT-PLAT-002` | failed feature state read fails safe | Feature Governance | failure injection | last-good restrictive/static safe | enables feature | CA-PLAT | P0 | Platform/release |
| `CA-CERT-PLAT-003` | provider manage ≠ source-domain record access | integrations | negative auth tests | config allowed, records denied | provider admin sees business rows | CA-PLAT/RBAC | P0 | Platform |
| `CA-CERT-PLAT-004` | model configured ≠ certified | AI ops | model-state tests | distinct states | configured labelled certified | CA-PLAT | P0 | AI |
| `CA-CERT-PLAT-005` | AI output remains advisory | AI/domain | service tests | advisory provenance + domain decision separate | model writes authoritative outcome | CA-PLAT/domain owner | P0 | AI/release |
| `CA-CERT-PLAT-006` | technical comms permission ≠ conversation authority | Communications | negative auth tests | provider ops without message-body access | technical admin reads customer conversation | CA-PLAT/GROWTH | P0 | Platform |
| `CA-CERT-PLAT-007` | runtime visibility ≠ deploy authority | Runtime | permission/action tests | read works; deploy absent/separate | diagnostics grant deploys | CA-PLAT/RBAC | P0 | Production activation |
| `CA-CERT-PLAT-008` | raw secrets unavailable in Admin surfaces | secrets/config | API/UI/log/audit scans | only reference/state | raw key/token revealed | CA-PLAT/Security | P0 | Platform/release |

## 20.10 MIG gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-MIG-001` | old/new coexist per capability | every replacement | route/source matrix | both work until replacement accepted | blanket cutover | CA-MOD/implementation owner | P0 | migration |
| `CA-CERT-MIG-002` | source truth unchanged or explicitly versioned | moved analytics | source diff/tests | same authority/version | UI migration changes formula silently | controlling semantic owner | P0 | migration |
| `CA-CERT-MIG-003` | access parity or intentional least-privilege tightening | migrated routes | old/new actor matrix | no widening; legitimate access retained | new universal access or orphaned ops | CA-RBAC | P0 | migration |
| `CA-CERT-MIG-004` | domain mutation remains owning service | Operations moves | integration tests | same domain service | generic Corporate mutation endpoint | domain owner | P0 | migration |
| `CA-CERT-MIG-005` | links/deep links/aliases retired only after coverage | route migration | route inventory | no orphan links | old route removed early | CA-K3/CA-MOD | P1 | retirement |
| `CA-CERT-MIG-006` | retirement needs exact-head replacement evidence | all legacy retirement | current CI/runtime evidence | exact head proven | stale/visual-only proof | CA-CERT/CA-MOD | P0 | retirement |

## 20.11 UX gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-UX-001` | exactly ten top-level destinations | Corporate shell | DOM/nav test | canonical ten/order | extra generic Admin destination | CA-UX | P1 | shell acceptance |
| `CA-CERT-UX-002` | truth state is visible | metric UI | component/runtime tests | value/state/freshness/caveat | blocked/unavailable shown blank/0 | CA-UX/METRIC | P0 | UI acceptance |
| `CA-CERT-UX-003` | permission does not rely on hidden nav | all routes | direct-route negative test | server denies | hidden link is only guard | CA-RBAC/UX | P0 | release |
| `CA-CERT-UX-004` | keyboard/accessibility usable | interactive UI | automated + manual evidence | threshold met | inaccessible core action | CA-UX | P1 | UI acceptance |
| `CA-CERT-UX-005` | responsive layout preserves meaning | responsive UI | desktop/tablet/mobile captures | hierarchy/data intact | hidden/truncated critical truth | CA-UX | P1 | UI acceptance |

## 20.12 EVIDENCE gates

| Gate | Invariant | Applicability | Evidence | Pass | Fail | Owner | Severity | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-CERT-EVIDENCE-001` | exact SHA identified | every certification | git/run metadata | exact head stated | branch name only | CA-CERT | P0 | acceptance |
| `CA-CERT-EVIDENCE-002` | bounded diff proven | implementation slice | compare/diff | authorized paths only | scope creep | CA-MOD/CA-CERT | P0 | acceptance |
| `CA-CERT-EVIDENCE-003` | source proof current | source claims | exact-head source references | exact current bytes | stale source | CA-CERT | P0 | acceptance |
| `CA-CERT-EVIDENCE-004` | relevant tests current | code changes | run/job IDs | tests on exact head | older run only | implementation owner | P0 | acceptance |
| `CA-CERT-EVIDENCE-005` | typecheck/build current | typed/buildable slices | exact-head jobs | success | missing/fail | implementation owner | P1 | acceptance/release |
| `CA-CERT-EVIDENCE-006` | browser/runtime proof current where needed | UI/runtime changes | URL/run/screenshots + SHA | exact head runtime | screenshots from older head | CA-K3/CA-CERT | P0 | UI acceptance |
| `CA-CERT-EVIDENCE-007` | negative auth proof included | authority changes | denial tests/staging where required | explicit deny evidence | only positive path | CA-RBAC/CA-CERT | P0 | access activation |
| `CA-CERT-EVIDENCE-008` | agent declaration is not acceptance | all specialist work | independent CA-MOD recertification | evidence independently reviewed | specialist self-accepts | CA-MOD | P0 | programme acceptance |

## 20.13 Gate counts

| Family | Count |
| --- | ---: |
| AUTH | 8 |
| ORG | 5 |
| METRIC | 8 |
| K2B | 5 |
| FIN | 6 |
| GROWTH | 6 |
| BU | 5 |
| REPORT | 6 |
| PLAT | 8 |
| MIG | 6 |
| UX | 5 |
| EVIDENCE | 8 |
| **TOTAL** | **76** |

---

# 21. Evidence-custody model

## 21.1 Evidence classes

### SOURCE_PROOF

Proves exact source/authority bytes.

Required fields:

- exact SHA;
- repository/path;
- relevant lines/blob/diff;
- authority being proven.

### UNIT_TEST_PROOF

Proves bounded function/component semantics.

Required:

- exact SHA;
- command/job;
- target tests;
- result.

### INTEGRATION_TEST_PROOF

Proves composition across route/service/source/authorization boundaries.

Required:

- exact SHA;
- environment if external;
- run/job ID;
- scope;
- result.

### BUILD_TYPECHECK_PROOF

Proves the candidate compiles/types/builds.

Does not prove business truth or access semantics.

### BROWSER_RUNTIME_PROOF

Proves actual browser/runtime behavior.

Required:

- exact SHA/runtime build identity;
- environment;
- URL;
- browser/device;
- timestamp;
- tested journey;
- result.

### RESPONSIVE_VISUAL_PROOF

Proves composition at defined viewport/device classes.

Must not substitute for authorization/source proof.

### ACCESSIBILITY_PROOF

Includes automated and required manual keyboard/screen-reader checks according to policy.

### AUTHORIZATION_NEGATIVE_PROOF

Proves forbidden actor/scope/action is rejected server-side.

### STAGING_PROOF

Used only where the implementation class requires live environment/source behavior.

Must identify:

- exact staging environment;
- exact build SHA;
- exact database/source target where safe;
- no Production mutation.

### OWNER_CHECKPOINT_PROOF

Records Owner visual/product decision where Owner judgment is part of acceptance.

It does not replace semantic/security tests.

### DEPLOYMENT_PROOF

Used only when deployment is separately authorized.

Must identify deployment ID/URL, exact build provenance and target environment.

## 21.2 Exact-head rule

Evidence from an older SHA cannot certify a newer SHA unless:

- the relevant bytes are independently proven identical; and
- every dependent runtime/config/source assumption is unchanged or separately recertified.

A successful build alone is not acceptance.

Successful CI alone is not acceptance.

A screenshot alone is not acceptance.

An agent declaration alone is not acceptance.

## 21.3 Evidence minimum for a migrated UI slice

At minimum:

- source compare;
- bounded diff;
- targeted tests;
- relevant regression;
- typecheck;
- build;
- diff check;
- truth-state tests;
- positive + negative authorization tests;
- responsive evidence;
- keyboard/accessibility evidence;
- exact-head runtime evidence where route/runtime behavior changed.

---

# 22. OD-CACERT Owner Decision Register

These decisions are certification-policy questions only.

They do not copy or supersede upstream Owner Decision registers.

> **An unresolved `OD-CACERT-*` is a question requiring authority, not authority itself.**

Recommendations are not permissions.

| Decision | Certification-policy question | Safe posture while unresolved |
| --- | --- | --- |
| `OD-CACERT-001` | Which implementation classes require live staging proof in addition to CI? | Require staging for authority/source/environment behavior that cannot be proven in isolated tests; do not require Production |
| `OD-CACERT-002` | Which UI slices require an Owner visual checkpoint? | Require for shell, executive Overview, major BU/Finance/Growth/Reports composition; exact list pending |
| `OD-CACERT-003` | What browser matrix is mandatory? | Chromium baseline plus at least one independent engine before release where browser behavior is material |
| `OD-CACERT-004` | What responsive/device matrix is mandatory for Corporate web? | Desktop + tablet + narrow mobile responsive proof; exact dimensions pending |
| `OD-CACERT-005` | What accessibility threshold is required? | No critical keyboard/accessibility blockers; exact WCAG/tool threshold pending Owner policy |
| `OD-CACERT-006` | Which authorization changes require negative tests on live staging? | Treat new/changed privileged access as staging-required when safe seed identities exist; never test by mutating Production |
| `OD-CACERT-007` | How long must certification evidence be retained? | Preserve run/artifact/source references through programme release; long-term retention policy pending |
| `OD-CACERT-008` | What evidence threshold permits retirement of one legacy `/admin` route? | Exact-head source/access/runtime parity plus no orphan consumers; retirement policy remains explicit per route |
| `OD-CACERT-009` | Do Finance implementations require independent Finance reviewer sign-off beyond CA-MOD? | Recommend yes for accounting-source activation; not an operative requirement until Owner decides |
| `OD-CACERT-010` | Do Reports publication/SoD implementations require independent governance review? | Recommend independent review for publication/withdrawal/export controls; policy pending |
| `OD-CACERT-011` | What are Production certification prerequisites? | No Production activation from CA-CERT alone; require separate release authority, exact build provenance and all applicable P0 gates |
| `OD-CACERT-012` | When can byte-identical proof reuse older evidence? | Only when exact relevant bytes and all dependent runtime/config/source conditions are independently proven identical |
| `OD-CACERT-013` | Maximum age for runtime screenshots/browser evidence. | No fixed days invented; evidence must represent current exact head/environment and current source assumptions |
| `OD-CACERT-014` | Which Platform/Security actions require independent dual-control certification? | Defer to accepted CA-RBAC/Owner policy; no one-person production authority inferred |
| `OD-CACERT-015` | May a certification run use seeded synthetic data to prove UI behavior? | Yes only when visibly isolated from business Actual and K2B path proves exclusion; never use it to certify business counts |

---

# 23. Unresolved implementation dependencies

The architecture is certifiable while these remain fail-closed implementation dependencies:

1. internal Corporate membership source;
2. Corporate permission assignment/runtime evaluator;
3. organisational hierarchy persistence/versioning;
4. final legal-entity/display identity;
5. final geography policy;
6. CA-RBAC policy details for A2/critical actions/dual control;
7. source-path K2B consumption for each Corporate Actual metric;
8. scalable complete Navigation aggregation beyond bounded reads;
9. true period-unique implementation if desired;
10. linked funnel coverage for candidate conversions;
11. universal customer definition if Owner chooses one;
12. customer person-resolution authority if cross-account distinct people are required;
13. accounting system of record;
14. revenue/GMV/cost/FX/period policy;
15. report registry/snapshot store/lifecycle implementation;
16. Platform capability fronting of legacy technical role checks;
17. route-by-route migration from current `/admin`;
18. exact Product/Owner checkpoint policy for major visual slices;
19. evidence retention/browser/accessibility certification policy;
20. release/Production activation authority.

None of these is treated as implicitly solved.

---

# 24. Architecture collision findings

## 24.1 Controlling semantic collisions

**None found.**

No pair of accepted Corporate authorities requires mutually incompatible facts or permissions.

## 24.2 Organisation shorthand clarification

The task shorthand could be misread as:

`management BU → Corporate Function`.

That would conflict with CA-ORG.

The accepted CA-ORG authority instead defines BUs and Corporate Functions as distinct peer internal unit types below the corporate/legal layer, with shared/matrix relationships between them.

CA-CERT therefore certifies the accepted branching model and does not treat Corporate Function as a mandatory child of BU.

This is not an upstream architecture defect because the accepted CA-ORG model itself is unambiguous.

## 24.3 Current mixed Admin surfaces

The current `/admin` IA mixes planes.

This is an accepted **migration dependency**, not a semantic collision, because source and mutation authorities can remain unchanged while presentation/access move incrementally.

## 24.4 Pending Owner policies

Pending Owner policy is not a collision where:

- the model explicitly states the gap;
- the safe interim is fail-closed;
- implementation cannot cross the boundary without new authority.

## 24.5 CA-PLAT editorial defects

The malformed `34` reference and duplicate secret-reveal sentence are editorial only and do not change the Platform authority model.

## 24.6 First real controlling defect

**NONE IDENTIFIED.**

No defect requiring upstream remediation was found in the accepted architecture set.

---

# 25. Open risks

1. Legacy `admin` may remain a de facto universal role if capability migration stalls.
2. `platform_admin/super_admin` may be mistaken for future Corporate grants.
3. Frontend normalization may hide meaningful compatibility-role distinctions.
4. Internal Corporate membership may be incorrectly built on external tenancy.
5. BU labels may drift into legal-entity language.
6. Central functions may be duplicated under BUs and create conflicting ownership.
7. Aggregate access may leak record-level PII through drill-down.
8. Executive title may be used as a restricted-data shortcut.
9. Multiple grants may synthesize unintended broad privilege.
10. A1 password re-authentication may be labelled A2.
11. K2B logic may be copied into Corporate UI and drift.
12. UAT/automation rows may inflate Actual if source adapters bypass K2B.
13. Admin/public Marketplace publication truth may diverge.
14. source failure may be rendered as measured zero.
15. candidate metrics may be promoted because a dashboard needs visual density.
16. Navigation truncation may generate false rankings.
17. peak-day unique may be labelled monthly/period unique.
18. independent stage totals may become “conversion”.
19. customer counts may be fabricated from accounts/inquiries/BU sums.
20. referral association may become causal acquisition.
21. product payment/provider state may become Corporate cash/revenue.
22. quoted CarUp fee classes may become recognized revenue.
23. cross-currency product amounts may be summed.
24. Financial Services BU may be confused with Finance & Accounting.
25. report generation may become automatic publication.
26. report readers may inherit export.
27. report infrastructure operators may self-grant publication.
28. Platform provider rights may expose source-domain business records.
29. technical health may be presented as business health.
30. AI configured/available may be presented as certified/accurate.
31. AI output may become a domain decision.
32. technical Communications access may expose customer content.
33. secret references may evolve into reveal-secret UI.
34. Platform runtime visibility may become deploy authority.
35. staging/test state may enter Production business truth.
36. big-bang `/admin` retirement may break legitimate operational capability.
37. new `/corporate` pages may be accepted on visual completeness without source/access parity.
38. stale exact-head evidence may be reused after implementation changes.
39. browser success may be mistaken for authorization certification.
40. Owner checkpoint may be mistaken for semantic/security acceptance.

---

# 26. Architecture-certification definition of done

CA-1.0 architecture is ready for progressive implementation when all of the following are true:

- accepted authorities are registered and non-conflicting;
- three planes remain distinct;
- ten top-level Corporate destinations remain canonical;
- organisation model preserves internal/external and BU/function/legal distinctions;
- RBAC remains capability + scope + classification + geography + assurance + delegation + time + SoD;
- legacy roles are compatibility only;
- data classification separates aggregate/detail/export;
- metric truth states and display states are immutable requirements;
- K2B remains sole operational-provenance authority;
- Finance blocks false accounting results;
- Growth blocks false universal-customer claims;
- BU scorecards use eligibility states and domain-specific semantics;
- Reports freeze period/scope/version/provenance and separate publication;
- Platform remains technical and cannot inherit business authority;
- current `/admin` migration is route-by-route with coexistence;
- negative authorization/truth tests are first-class;
- certification gates are deterministic;
- evidence is exact-head and current;
- unresolved Owner policy remains fail-closed;
- CA-K3 can consume the architecture without being allowed to redefine it.

All conditions are satisfied at the architecture-model level.

Implementation proof remains outstanding by slice.

---

# 27. Final architecture-level recommendation

## Specialist recommendation: CERTIFIABLE

The accepted Corporate Admin authorities form one internally consistent, progressively implementable and certifiable management architecture.

This recommendation is based on the following:

- no controlling cross-authority semantic contradiction was found;
- every major semantic domain has one identified controlling authority;
- overlaps are expressed as consumption relationships rather than competing truth;
- pending Owner decisions are explicitly fail-closed;
- mixed current Admin surfaces have a per-capability coexistence/migration path;
- Finance, Growth, K2B, Reporting and Platform all preserve their own hard boundaries;
- negative authority can be tested deterministically;
- the architecture can migrate incrementally without requiring loss of current operational capability.

`CERTIFIABLE` is a specialist architecture recommendation only.

It is **not** CA-MOD programme acceptance.

---

# 28. Recommended next bounded implementation / certification task

Subject to CA-MOD acceptance of CA-CERT-01, the recommended next bounded task is:

**CA-K3-CERT-01 — Corporate Shell / Access Boundary Exact-Head Certification**

Bounded purpose:

- certify the first implemented Corporate shell against the ten-destination IA;
- prove ordinary-user denial;
- prove legacy Admin and new Corporate coexistence;
- prove navigation does not grant;
- prove scope selector narrows only;
- prove truth-state component behavior;
- prove no Corporate business metric is invented by the shell;
- collect desktop/tablet/mobile responsive and keyboard evidence;
- certify exact implemented head without modifying unrelated Operations/Platform domains.

This recommendation does not authorize that task, change CA-K3 custody or authorize merge/deployment.

---

# 29. Non-actions

CA-CERT-01 performs no:

- architecture-document edits outside this artifact;
- web/backend/shared/mobile mutation;
- database/migration mutation;
- workflow mutation;
- K2B mutation;
- CA-K3 mutation;
- staging mutation;
- Production mutation;
- deployment;
- secret/environment-variable change;
- report publication;
- role/permission activation;
- route retirement;
- merge.

This document does not self-accept.

CA-CERT-01 CORPORATE ADMIN CROSS-PLANE CERTIFICATION MODEL READY FOR MODERATOR REVIEW

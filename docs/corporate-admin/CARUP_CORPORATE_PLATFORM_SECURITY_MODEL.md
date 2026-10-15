# CARUP CORPORATE PLATFORM / SECURITY ADMINISTRATION MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-PLAT — Corporate Platform & Security Administration Agent  
Task: CA-PLAT-01  
Status: PLATFORM / SECURITY ADMINISTRATION ARCHITECTURE ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This Platform & Security Administration Model is produced under the following exact accepted authorities:

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
- Accepted/frozen K2B authority and product/source inspection authority: `7b34dec1bc9f05b72b6abf0104db65980f280a0b`
- Exact documentation starting authority: `860ae2e0ddeccb33bc504ca15c0f8382fc3574a2`
- Parallel implementation lane: **CA-K3-01 — ACTIVE / SEPARATE WEB IMPLEMENTATION CUSTODY**

There is no accepted `docs/corporate-admin/tasks/CA-PLAT-01.md` at the starting authority. The CA-MOD dispatch is the controlling task authority.

Repository custody was checked immediately before this artifact was written: branch `docs/corporate-admin-1-canonical-plan` was identical to `860ae2e0ddeccb33bc504ca15c0f8382fc3574a2` and this artifact did not yet exist.

This task is architecture/documentation only. It does not implement Platform RBAC, change current roles, create schema, change current `/admin`, rotate credentials, mutate provider configuration, deploy, merge, touch CA-K3, modify K2B, or change staging/Production.

---

# PART I — EXECUTIVE PLATFORM BOUNDARY

## 2. The Platform plane

The accepted Corporate Admin management planes remain:

1. **Corporate Intelligence**
2. **Business Operations**
3. **Platform & Security**

This document governs the third plane only.

Platform exists to administer and observe the **technical system**. It does not own CarUp's business truth simply because it can configure the infrastructure through which that truth flows.

### 2.1 Binding separation rules

Preserve:

- **Platform Admin ≠ Corporate Executive**
- **Platform Admin ≠ Reporting Publisher**
- **Platform Admin ≠ Corporate Finance authority**
- **Platform Admin ≠ People authority**
- **Platform Admin ≠ Customer/Growth authority**
- **Platform Admin ≠ Trust/Risk business decision authority**
- **technical health ≠ business performance**
- **provider configuration ≠ commercial outcome**
- **feature enablement ≠ product adoption**
- **AI/model availability ≠ AI quality or business value**
- **communications-provider delivery ≠ customer engagement success**
- **technical access path ≠ permission to inspect business records**
- **technical reconciliation ≠ accounting reconciliation**
- **runtime access ≠ domain mutation authority**
- **secret administration ≠ secret disclosure**
- **system audit access ≠ unrestricted access to payload data**

### 2.2 What Platform may own

Subject to CA-RBAC and future accepted policy, the Platform plane may own technical administration of:

- platform/runtime observability;
- feature-governance technical state;
- integration/provider configuration;
- provider technical health;
- AI/model runtime configuration;
- model/provider operational telemetry;
- authentication/security infrastructure;
- technical session-security operations;
- runtime/environment identity;
- deployment/build provenance visibility;
- technical audit/change history;
- communications delivery/provider infrastructure;
- technical queue/worker health;
- secret references and controlled rotation actions.

### 2.3 What Platform must not own merely by technical privilege

Platform privilege must not automatically grant:

- Corporate KPI access;
- Corporate Finance line items;
- accounting journals;
- customer PII;
- employee/private People files;
- KYC/evidence documents;
- compliance adjudication;
- fraud disposition;
- dealer/garage compliance decision;
- Marketplace moderation decision;
- BU operating queues;
- customer communications content;
- report approval/publication;
- metric-definition authority;
- customer-definition authority;
- K2B provenance classification.

---

# PART II — CURRENT TECHNICAL ADMINISTRATION REALITY

## 3. Current role and guard inventory at frozen source authority

### 3.1 Frontend canonical role vocabulary

At `7b34dec1…`, `shared/types/index.ts` exposes:

`owner | dealer | mechanic | bank | insurance | government | admin`

The shared frontend `UserRole` does **not** include:

- `platform_admin`
- `super_admin`

Therefore the current frontend role type cannot express all backend-recognized platform roles directly.

### 3.2 Backend compatibility platform roles

`backend/middleware/authMiddleware.js` recognizes:

- `admin`
- `platform_admin`
- `super_admin`

as platform-admin compatibility roles.

Current authorization behavior materially matters:

- the server derives the base/platform role from the authenticated session/account;
- active tenant context is independently verified;
- a tenant role does not become a platform role;
- platform-admin compatibility roles can bypass many ordinary route allowlists;
- consequential routes increasingly compose proven-session, named capability and step-up checks on top.

This broad route-list bypass is a **current compatibility behavior**, not future Corporate authority.

### 3.3 Frontend compatibility normalization

Current web code deliberately normalizes:

`platform_admin → admin`  
`super_admin → admin`

for frontend route/navigation presentation.

That compatibility prevents backend-recognized platform administrators from being redirected into a non-admin dashboard, but it also means the current web shell visually collapses materially different backend labels into one `admin` experience.

It must not be reused as future Corporate membership or permission semantics.

### 3.4 Current role semantics table

| Current label | Proven current use | Future interpretation |
| --- | --- | --- |
| `admin` | Frontend Admin role; backend platform-admin compatibility role; broad legacy route authority; many domain reviewer/operator routes | Compatibility bridge only; must be decomposed into CA-RBAC permissions/scopes |
| `platform_admin` | Backend-recognized platform role; broad allowlist bypass; appears in technical and business-domain operator/reviewer code; frontend maps to `admin` | Compatibility bridge; **not** automatic future PLATFORM_ADMIN permission bundle |
| `super_admin` | Backend-recognized broad compatibility role across technical and many business-domain paths; frontend maps to `admin` | Compatibility bridge; no future “all Corporate authority” meaning |
| tenant roles | External dealer/garage/etc. operating context, separately verified | External participant context; never internal Corporate Platform membership |
| `government` / reviewer variants | Domain/institutional reviewer authority in selected routes | Not Platform Admin merely because current routes overlap |
| worker/system secret actors | Machine-to-machine technical actors for selected runtime jobs/diagnostics | Machine authority, not human Corporate membership |

### 3.5 No distinct future “super user” proved

The inspected source proves broad current uses of `super_admin` but does not establish a separate future Corporate policy meaning for it.

CA-PLAT therefore must not infer:

- “super_admin owns all company data”;
- “super_admin may publish reports”;
- “super_admin may approve Finance”;
- “super_admin is an Executive”;
- “super_admin is the future break-glass identity.”

Those would be new authority claims.

---

## 4. Current authentication, session and assurance reality

### 4.1 Session authority

Current authentication uses `user_sessions`.

A real session carries:

- user identity;
- base/platform role context;
- selected external organisation context where verified;
- validity/expiry;
- assurance/step-up state where migrated.

### 4.2 Sign-out

`POST /api/auth/logout` revokes **the currently authenticated session** by setting `user_sessions.is_valid=false`.

The implementation:

- requires a real authenticated session;
- does not accept another person's token from request body;
- retains the session row as history;
- audits the sign-out;
- reports failure if revocation cannot be confirmed.

Other sessions remain active. “Sign out everywhere” is a separate contract.

### 4.3 Own-session security

Current account security supports:

- listing own sessions;
- revoking other sessions;
- reasoned/audited revocation;
- no token material returned in the session list.

### 4.4 Step-up authentication

Current step-up:

- is session-bound;
- re-proves the current password;
- records step-up time/method on the session;
- cannot be satisfied by an asserted `x-user-id` fallback;
- fails closed with 503 when assurance state cannot be read;
- requires recent re-authentication for sensitive actions.

### 4.5 Accepted CA-RBAC assurance authority

CA-RBAC already defines:

- `A0_STANDARD` — ordinary authenticated assurance;
- `A1_RECENT_REAUTH` — recent credential re-authentication;
- `A2_STRONG` — future approved stronger authenticator.

At the frozen source authority, a proven strong A2 authenticator is not established. Recent password re-authentication must not be relabelled A2.

CA-PLAT consumes these semantics and does not create a fourth assurance model.

---

## 5. Current technical Admin surface inventory

| Current surface / source | Current actual purpose | Plane problem |
| --- | --- | --- |
| `/admin` | Mixed “Ecosystem command centre” plus links into Users, AI, moderation, fraud, dealer compliance, evidence | Mixes Corporate/Operations/Platform concerns |
| `/admin/features` | Feature registry/lifecycle/rollout overrides **plus Navigation Analytics tab** | Technical governance mixed with usage intelligence |
| `/admin/ai` | Thin AI model/server-health view, truthful unavailable handling | Platform-oriented but lacks full model/provider control-plane architecture |
| `/admin/users` | Platform accounts, legacy role display/creation plus People review link | People/Access and legacy role semantics mixed into Admin |
| `/admin/communications*` | Conversations/SLA/handoff/customer context plus provider/worker/dead-letter/smoke-test technical operations | Business Operations mixed with Platform delivery infrastructure |
| `/api/admin/providers*` | Provider registry, activation, kill switch, health/incidents/reconciliation | Real technical provider control plane; currently not represented as a canonical Corporate Platform surface |
| `/api/admin/health` | `server_health` technical rows | Technical telemetry, limited/legacy semantics |
| public health/runtime diagnostics | Build/runtime/provider/system telemetry | Some current diagnostics may disclose more technical detail than public liveness needs |
| authentication/session security routes | Step-up, own-session list/revocation | Security infrastructure |
| identity lifecycle/account-security routes | Sensitive lifecycle/session controls layered with Operations capability | Mixed security/control domain; not People membership authority |
| feature-governance audit | Runtime rollout change history | Platform audit precedent |
| central `trust_audit_events` logger | Redacted authoritative audit events | Cross-domain audit service, not unrestricted Platform data entitlement |

---

# PART III — LEGACY COMPATIBILITY MODEL

## 6. Compatibility purpose

Current `admin`, `platform_admin` and `super_admin` exist because current source predates the future Corporate capability-and-scope model.

They may temporarily remain as compatibility inputs so existing routes continue to work while migration is staged.

They must not become:

- **legacy role ≠ Corporate membership**;
- future internal Corporate membership;
- future permission assignments;
- future job titles;
- future break-glass roles;
- a universal “all data” entitlement.

## 7. Allowed interim use

A legacy role may temporarily:

1. satisfy existing route middleware where current product still depends on it;
2. seed a compatibility mapping into already-accepted bounded capability services;
3. maintain existing operator access until replacement has exact-head certification;
4. allow current frontend admin routing through `normalizeFrontendRole`.

The bridge must always preserve current domain-service checks, tenant checks, assurance checks and audit.

## 8. Prohibited compatibility assumptions

Do not infer:

- legacy `admin` = Corporate Admin member;
- `platform_admin` = unrestricted platform permission;
- `super_admin` = all Corporate permissions;
- current role bypass = accepted future scope;
- role switch = delegation;
- external tenant role = internal platform role;
- admin navigation = authorization;
- Platform technical capability = business record permission.

## 9. Migration path

Recommended compatibility migration stages:

### Stage P0 — Inventory and freeze

- inventory every route/service using the three compatibility roles;
- classify each dependency by future plane/domain;
- preserve current behavior until replacement exists.

### Stage P1 — Capability fronting

For Platform-owned paths:

- require accepted CA-RBAC Platform permission;
- preserve legacy role only as a temporary compatibility grant source;
- server continues to enforce scope/classification/assurance.

For non-Platform paths:

- migrate to owning Corporate/Operations capability instead of a Platform role.

### Stage P2 — Dual evidence

For each migrated path prove:

- legacy authorized subject still works where intended;
- non-authorized subject fails;
- tenant role cannot elevate;
- capability scope cannot widen;
- assurance and audit remain intact;
- Platform permission alone cannot mutate the owning business domain.

### Stage P3 — Remove role bypass dependence

After all dependent paths are certified:

- ordinary route authorization no longer relies on platform-role global bypass;
- compatibility role may remain only as an explicit mapping source where required.

### Stage P4 — Retire compatibility labels

Retirement requires Owner/CA-RBAC authority plus:

- complete route inventory;
- zero uncustodied consumers;
- replacement grants issued;
- emergency-access replacement certified;
- frontend no longer needs role normalization;
- rollback plan and audit evidence.

## 10. Fail-closed compatibility behavior

During migration:

- unknown legacy role grants nothing;
- failed capability lookup grants nothing;
- expired/suspended Corporate assignment grants nothing;
- role normalization is presentation only;
- a missing future Corporate membership does not cause a legacy role to be silently converted into one;
- compatibility mapping cannot cross a higher data classification;
- compatibility mapping cannot create Reporting/Finance/People/Trust authority.

---

# PART IV — FUTURE PLATFORM DOMAIN MODEL

## 11. Platform Overview

### Objective

Answer:

- Is the technical platform operating?
- What runtime/integration/security exceptions require technical action?
- Which feature/provider/model controls are degraded or disabled?
- Is current technical state attributable to a known build/environment?
- What technical change requires Platform/Security attention?

### Valid content

Potential governed technical state:

- runtime/build identity;
- environment identity;
- database-target consistency;
- feature-control exceptions;
- provider degradation;
- integration configuration state;
- model/provider availability;
- security/session incidents;
- queue/worker technical backlog;
- required technical audit failures.

### Invalid content

Do not include as “Platform health”:

- revenue;
- customer growth;
- Marketplace conversion;
- Trust approval rate;
- report publication status as a technical score;
- BU profitability;
- customer engagement;
- AI “quality” without governed evaluation authority.

### No synthetic health score

Do not create a single “Platform Health 92%” score from heterogeneous technical signals.

Each source keeps its own state and availability.

---

## 12. Feature Governance

Platform owns **technical feature state**.

### 12.1 Governed concerns

- feature registry identity;
- lifecycle state;
- enabled/disabled state;
- rollout percentage;
- environment;
- time window;
- tenant allow/deny controls where accepted;
- immutable role exposure ceiling;
- kill/disable path;
- version/concurrency;
- change reason;
- audit history.

### 12.2 Current strong properties to preserve

Current Feature Governance already proves useful controls:

- explicit lifecycle states;
- runtime override cannot broaden immutable role policy;
- environment is validated;
- write environment is server-trusted;
- percentage rollout only narrows exposure;
- tenant role and platform role namespaces remain distinct;
- storage failure preserves last-good restrictive state or static defaults;
- optimistic concurrency;
- audited mutation.

### 12.3 Not Feature Governance

Do not place under Platform Feature Governance:

- navigation selection-through rate;
- route popularity;
- feature adoption;
- customers using a feature;
- commercial funnel impact;
- BU performance.

Those belong to Data & Intelligence / Customers & Growth when governed.

---

## 13. Integrations & Providers

### 13.1 Platform-owned technical questions

- Is the provider registered?
- Which capability/jurisdiction does it serve?
- What activation mode is recorded?
- Is a kill switch enabled?
- Is a credential **reference** configured?
- What technical health/incidents are recorded?
- Is the provider callable under its technical contract?
- Are recent technical attempts failing?
- Is a reconciliation mismatch waiting for technical investigation?

### 13.2 Current provider states

The current provider registry supports technical modes including:

- not configured;
- contract pending;
- credential pending;
- sandbox;
- partner file;
- manual;
- pilot live;
- live;
- degraded;
- unavailable;
- suspended.

These are technical/provider states. They do not prove commercial completion.

### 13.3 Fail-closed provider registration

Current strong pattern:

- new providers start non-callable;
- kill switch starts enabled;
- raw secrets are rejected;
- live/pilot-live requires a signed-contract state and credential reference;
- sandbox is refused in production-like runtime.

Preserve this conservative posture.

### 13.4 Provider administration does not grant source-domain access

A Platform user allowed to configure an insurer, lender, payment, identity or communications provider does not automatically receive:

- applications;
- insurance claims;
- payment records;
- identity evidence;
- message bodies;
- customer PII;
- accounting line items.

---

## 14. AI / Model Operations

### 14.1 Platform technical control-plane responsibilities

Potential future model registry/control plane should represent:

- provider ID;
- model ID;
- purpose/domain;
- execution authority classification;
- configured/not configured;
- enabled/disabled;
- runtime route/policy;
- certification/evaluation state;
- health;
- latency/errors where measured;
- usage/cost where authoritative;
- environment;
- last technical change;
- audit history.

### 14.2 Current general-AI authority

At the frozen source:

- general inference is routed through a canonical gateway;
- provider/model policy is pinned;
- no provider fallback is configured;
- output authority is explicitly **advisory**;
- provider failure does not become a favorable business result;
- model output carries provider/model/execution provenance.

### 14.3 OCR/evidence model separation

OCR/evidence model policy is not the same as general AI model policy.

Preserve:

- general AI runtime ≠ OCR runtime;
- configured key ≠ selected provider;
- selected provider ≠ certified provider;
- model configured ≠ model certified;
- classifier/OCR result ≠ final domain authority;
- AI recommendation ≠ management decision.

### 14.4 Evaluation versus availability

A model may be:

- configured and unhealthy;
- configured and healthy but uncertified for a purpose;
- certified for one purpose but not another;
- available while lacking a governed quality metric.

Therefore:

**availability ≠ quality ≠ certification ≠ business value**

### 14.5 Cost / usage

Only expose AI cost/usage if an authoritative source and registered metric exist.

Do not estimate spend from request counts or token heuristics and call it Actual.

---

## 15. Security Administration

### 15.1 Scope

Platform/Security may administer technical security controls including:

- authentication assurance infrastructure;
- sessions;
- privileged access technical enforcement;
- security-sensitive configuration;
- break-glass technical mechanism when later authorized;
- security audit;
- session revocation;
- security events/attention state;
- credential/secret rotation workflow integration.

### 15.2 Security Admin ≠ Access Admin

Accepted CA-RBAC separates:

- Security administration;
- People/Access administration;
- Corporate membership;
- permission assignment.

A Security Admin may implement/enforce authentication/session controls without owning employee placement or ordinary permission approval.

### 15.3 Current session controls to preserve

- proven-session requirement;
- current-session logout;
- own-session list;
- revoke-one/others/all service capability;
- reason for privileged revocation;
- audit;
- no token material returned.

### 15.4 Assurance

Sensitive Platform actions consume accepted CA-RBAC A0/A1/A2 semantics.

CA-PLAT does not declare which unresolved Platform operation requires A2. Where accepted upstream authority already requires A1, preserve it.

If stronger-assurance policy is unresolved, do not weaken A1 or pretend password re-authentication is A2.

### 15.5 Break-glass

Accepted CA-RBAC already requires:

- no standing break-glass;
- narrow scope;
- short expiry;
- high assurance;
- immutable audit;
- post-use review;
- no delegation.

Exact Platform break-glass activation/approval policy remains unresolved and requires `OD-CAPLAT-*` authority.

---

## 16. Runtime / Environment Administration

### 16.1 Valid runtime identity

Platform may show non-secret technical identity such as:

- environment;
- commit SHA/build identity;
- deployment ID;
- source of provenance;
- database project reference;
- runtime parity state;
- provider/configuration availability state;
- service/runtime diagnostic state.

### 16.2 Current proven safe patterns

`buildProvenance`:

- reports commit/build identity;
- reports conflict instead of picking one silently;
- unknown runtime revision fails certification.

`databaseTarget`:

- extracts non-secret Supabase project refs;
- names unrecognized variable **names**, not values;
- reports inconsistent database targets;
- never exposes connection strings/passwords.

### 16.3 Environment boundaries

At minimum distinguish:

- development;
- test/CI;
- staging;
- preview where relevant;
- production.

Non-production runtime activity must never enter Corporate business Actual merely because Platform can see it.

### 16.4 Deployment visibility ≠ deployment authority

Seeing:

- build SHA;
- deployment state;
- environment;

does not authorize:

- production promotion;
- rollback;
- environment-variable change;
- secret rotation;
- database migration.

Those require separate accepted policy/capability.

---

# PART V — PLATFORM RBAC / CAPABILITY MODEL

## 17. Consume CA-RBAC; do not create a second authorization system

Accepted CA-RBAC already establishes the Platform permission taxonomy:

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

These capabilities do not imply Corporate Finance, People or identity-evidence access.

CA-PLAT maps product functions into this accepted taxonomy. It does not silently add production-change or approval authority.

## 18. Capability mapping

| Platform activity | Accepted CA-RBAC capability | Additional gate |
| --- | --- | --- |
| View Platform overview/technical health | `platform.health.read` | scope/classification |
| View feature registry/effective technical state | `platform.feature.read` | environment/scope |
| Change feature rollout/lifecycle override | `platform.feature.manage` | assurance, audit, future approval policy |
| View integration technical state | `platform.integration.read` | classification |
| Change integration configuration | `platform.integration.manage` | assurance, audit, environment policy |
| View provider registry/health | `platform.provider.read` | classification |
| Change provider activation/kill switch/config ref | `platform.provider.manage` | assurance, audit, production-change policy |
| View AI/model runtime state | `platform.ai.read` | classification |
| Change model/provider technical configuration | `platform.ai.manage` | assurance, audit, model-activation policy |
| View security posture | `platform.security.read` | Security scope |
| Security-sensitive configuration | `platform.security.manage` | assurance, SoD/approval where accepted |
| Revoke technical sessions | `platform.security.session.revoke` | target/scope, reason, assurance, audit |
| View Platform audit | `platform.audit.read` | redaction/classification |
| Runtime diagnostics | `platform.health.read` as current accepted umbrella | exact narrower capability may be future CA-RBAC decision |
| Technical export | **not inferred** | separate future explicit export authority required |

## 19. Read / change / approve / audit separation

Preserve:

- **read ≠ configure**
- **configure ≠ approve**
- **approve ≠ audit**
- **Platform access ≠ source-domain mutation authority**

Where the accepted permission taxonomy currently has `manage` but future policy requires maker/checker:

- do not interpret `manage` as both maker and approver automatically;
- approval can be a separate workflow/control assignment;
- any future new capability name must be introduced through CA-RBAC authority, not CA-PLAT invention.

## 20. Scope dimensions

Platform access decisions still consume:

- subject;
- permission;
- internal organisational scope where relevant;
- data classification;
- geography where relevant;
- delegation;
- assurance;
- time;
- explicit environment/resource scope;
- audit/SoD.

Platform is a central function, but “central” does not mean unrestricted.

## 21. Delegation

Platform delegation must follow CA-RBAC:

- delegator must already hold authority;
- delegated scope cannot widen;
- expiry required;
- no bypass of denial/SoD;
- sensitive Security delegation may require separate approval;
- delegation never mutates legacy role/title.

---

# PART VI — SECRETS AND CREDENTIALS

## 22. Secrets boundary

Raw secrets should generally not be ordinary Admin-readable values.

### 22.1 Preferred visible metadata

Expose only governed metadata such as:

- configured / not configured;
- secret reference identity;
- provider/capability it supports;
- environment;
- last-rotated timestamp where authoritative;
- rotation-required state where authoritative;
- version/reference metadata where safe;
- validation state.

### 22.2 Preferred actions

Where separately authorized:

- replace secret reference;
- rotate credential;
- revoke credential;
- validate configuration;
- activate new credential version.

### 22.3 Never expose by convenience

Do not provide:

- reveal API key;
- copy private key;
- show database password;
- show webhook secret;
- show session token;
- show full service-account JSON;

merely because the caller is a Platform Admin.

### 22.4 Current source precedents

Preserve:

- provider registry accepts `credential_ref`, not raw secret;
- apparent secrets are rejected;
- audit redaction strips password/token/api-key/secret/credential/auth/signature fields;
- database-target diagnostics return project refs, not connection values;
- OCR/AI diagnostics report configured state, not credentials.

### 22.5 Secret rotation authority

- **permission to administer an integration ≠ permission to reveal its raw secret**

Permission to administer an integration ≠ permission to reveal its raw secret.

Who may rotate production credentials, whether dual approval is required, and which assurance class applies remain Owner/CA-RBAC decisions.

---

# PART VII — DOMAIN BOUNDARIES

## 23. Communications boundary

### 23.1 Business Operations / Growth side

Business-facing concerns:

- conversations;
- participants;
- inbox;
- handoff/assignment;
- SLA workflow;
- customer/participant context;
- consent;
- business replies;
- campaign/referral-associated business activity where governed;
- delivery exceptions as they affect an operating case.

### 23.2 Platform & Security side

Technical concerns:

- channel/provider configuration;
- provider health;
- worker/scheduler health;
- webhook state;
- technical delivery attempts;
- technical dead-letter/retry machinery;
- provider smoke tests;
- channel integration state;
- provider/runtime audit.

### 23.3 Required semantic separation

Preserve:

- **provider delivery health ≠ customer engagement**
- **queued ≠ sent**
- **sent ≠ delivered unless provider authority says delivered**
- **delivered ≠ read**
- **read ≠ conversion**
- **message sent ≠ commercial success**
- **provider smoke-test success ≠ customer journey success**

### 23.4 Current migration implication

Current `/admin/communications` combines both planes and must be split in future.

The technical half may move under Platform → Integrations/Providers or a Communications Delivery subsection.

The conversation/business half belongs Business Operations / Customers & Growth.

---

## 24. Feature / Navigation boundary

Platform owns:

- feature identity;
- lifecycle;
- rollout;
- exposure controls;
- technical availability;
- environment state.

Data & Intelligence / Growth owns governed analysis of:

- impressions;
- selections;
- route renders;
- usage;
- demand/adoption where properly defined.

Preserve:

- **feature enabled ≠ feature used**
- **feature impression ≠ adoption**
- **route render ≠ customer**
- **route selection ≠ business outcome**

Current Navigation Analytics co-location inside Feature Governance is a presentation/migration defect, not shared authority.

---

## 25. AI / Data & Intelligence boundary

### Platform

Own technical AI/model control plane:

- provider;
- model;
- routing;
- configured state;
- health;
- technical telemetry;
- certification/evaluation state as metadata;
- runtime selection;
- technical audit.

### Data & Intelligence

Own governed data/business interpretation:

- metric registry;
- calculation lineage;
- data quality interpretation;
- business analytical outputs;
- certified management metrics.

### Hard boundary

Platform model administration may not:

- modify metric formulas;
- mark AI output as Corporate Actual;
- override CA-METRIC availability;
- create customer/business labels;
- approve domain decisions.

---

## 26. Finance / Payments boundary

Platform may technically administer:

- payment provider connectivity;
- escrow provider connectivity;
- lender/insurer integration;
- webhook/configuration health;
- provider technical reconciliation.

Platform does not gain accounting authority.

Preserve:

- **payment-provider success ≠ cash**
- **escrow ≠ revenue**
- **deposit ≠ recognized revenue**
- **technical transaction log ≠ accounting ledger**
- **provider reconciliation ≠ accounting reconciliation**
- **requested amount ≠ disbursement**

Corporate Finance & Accounting remains `CF_FINANCE_ACCOUNTING` under CA-FIN.

---

## 27. Trust / Risk / Compliance boundary

Platform may administer technical systems used for:

- identity verification;
- evidence processing;
- fraud tooling;
- compliance tooling;
- provider connectivity;
- security of those systems.

Platform does not own the domain adjudication.

Preserve:

- **provider configured ≠ verification approved**
- **OCR result ≠ identity decision**
- **technical evidence access path ≠ permission to inspect evidence**
- **security administration ≠ compliance adjudication**
- **fraud model output ≠ fraud decision**
- **Platform Admin ≠ Trust reviewer**

Sensitive evidence remains Restricted Identity/Compliance under CA-RBAC.

---

## 28. People & Access boundary

### Platform/Security responsibilities

May include technical infrastructure for:

- sign-in;
- sessions;
- authentication assurance;
- session revocation;
- access-control enforcement;
- security audit.

### People & Access responsibilities

Owns Corporate governance experience for:

- account versus membership distinction;
- internal Corporate membership;
- organisational placement;
- permission requests/assignments;
- delegation;
- access review;
- membership suspension/end;
- People/private records as separately permitted.

### Hard boundary

Do not make these Platform functions merely because current Admin uses `users.role`:

- employee record management;
- job title;
- internal BU/function placement;
- Corporate membership ownership;
- access approval ownership.

`users.role` remains legacy runtime input, not the future Corporate access model.

---

## 29. Reporting boundary

Platform may technically support:

- report service runtime;
- object/file storage;
- rendering service;
- scheduler/job health;
- export infrastructure;
- report delivery infrastructure.

Platform does not inherit:

- definition ownership;
- review;
- approval;
- publication;
- withdrawal;
- restatement;
- restricted report read;
- restricted export.

Preserve:

**Platform Admin ≠ Reporting Publisher**

CA-REPORT's fail-closed Owner-policy rules remain controlling.

---

# PART VIII — TECHNICAL TRUTH CONTRACT

## 30. Technical metric classification

Use CA-METRIC semantics.

Technical observations normally belong to:

`TECHNICAL_OPERATIONAL`

Examples:

- runtime build identity;
- uptime/runtime age where accurately sourced;
- latency;
- error count;
- queue depth;
- provider state;
- integration configured state;
- model configured state;
- feature override state;
- worker health;
- scheduler health.

### 30.1 Technical measurement ≠ business KPI

Do not promote technical values into:

- revenue;
- conversion;
- customer satisfaction;
- customer growth;
- product adoption;
- BU health;
- compliance success;
- AI business value.

### 30.2 Zero / unavailable

A measured technical zero may display as `0`.

A failed source must display unavailable/degraded, not zero.

### 30.3 Configured / enabled

Preserve:

- configured ≠ healthy;
- healthy ≠ certified;
- enabled ≠ used;
- provider callable ≠ commercial transaction complete;
- model returned output ≠ business truth.

### 30.4 Sandbox/test separation

Staging, test, CI, fixtures, simulator and sandbox activity must never become Corporate/BU Actual.

K2B remains provenance authority for operational business data.

---

# PART IX — AUDIT AND CHANGE GOVERNANCE

## 31. Technical change audit contract

A consequential Platform control-plane change should record, where applicable:

- named actor / machine actor;
- timestamp;
- capability used;
- internal scope;
- resource/provider/feature/model identifier;
- environment;
- before state;
- after state;
- reason;
- assurance class;
- delegation reference;
- approval reference where policy requires;
- request/correlation ID;
- deployment/change ticket reference;
- result;
- rollback/reversal link if applicable.

### 31.1 Secret redaction

Before/after state must never persist raw:

- passwords;
- tokens;
- API keys;
- private keys;
- webhook secrets;
- database credentials;
- signing secrets.

Use reference/version/change metadata.

### 31.2 Required-audit fail-closed pattern

Where accepted policy says audit is mandatory for a privileged change:

- audit failure must prevent/rollback the change where technically possible;
- if rollback fails, revoke/invalidate the relevant authority/session and raise an incident rather than leave untracked privileged state.

Current active-tenant and session-security patterns provide useful precedents.

### 31.3 SoD

Accepted CA-RBAC controls remain binding.

CA-PLAT may recommend maker/checker for:

- production provider activation;
- production feature rollout;
- critical Security changes;
- secret rotation;
- model activation;
- deployment/promotion.

Those recommendations are not operative until explicit Owner/CA-RBAC policy accepts them.

---

# PART X — CURRENT /ADMIN MIGRATION MAP

## 32. Classification vocabulary

Each current surface is classified as one of:

- `REHOME_PLATFORM`
- `SPLIT_PLATFORM_AND_OTHER_PLANE`
- `KEEP_COMPATIBILITY_BRIDGE`
- `REBUILD_AS_CORPORATE_VIEW`
- `DEPRECATE_AFTER_CERTIFIED_REPLACEMENT`
- `NOT_PLATFORM`

Classification is architectural intent. No route is changed by CA-PLAT-01.

## 33. Concrete migration map

| Current route/capability | Current actual purpose | Classification | Future plane / destination | Compatibility requirement | Source authority | RBAC implication | Migration dependency | Retirement condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin` | Mixed command centre and Admin shortcuts | `REBUILD_AS_CORPORATE_VIEW` | Corporate Intelligence → Corporate Overview; Platform gets separate internal area | Keep route until Corporate shell replacement accepted | command-centre projections + links | current admin compatibility only | CA-K3 Corporate shell | Exact replacement certified; no orphan links |
| `/admin/features` — rollout governance tab | Feature registry, lifecycle, environment, overrides, audit | `REHOME_PLATFORM` | Platform → Feature Governance | Current route remains bridge | feature manifest + rollout override authority | map to `platform.feature.read/manage` | capability-backed API/UI | Replacement exact-head certified |
| `/admin/features` — Navigation Analytics tab | Aggregate navigation usage | `SPLIT_PLATFORM_AND_OTHER_PLANE` | Data & Intelligence / Customers & Growth | Keep current tab until new destination exists | Navigation Intelligence | Data/Growth aggregate permission, not Platform mutation | CA-METRIC/GROWTH/K3 | New analytics surface certified |
| `/admin/ai` | Model/server-health view | `REHOME_PLATFORM` | Platform → AI / Model Operations | Keep compatibility route | server health + AI runtime config where sourced | `platform.ai.read`; manage separate | canonical model/provider admin API | Replacement certified |
| `/admin/users` | Account list, legacy role display/creation, People review link | `SPLIT_PLATFORM_AND_OTHER_PLANE` | People & Access for accounts/membership/access; Platform Security for session/security tools | Preserve current route until People/Access replacement | users + K2B + auth/session | no future role-as-permission; technical session revoke separately | CA-K3 People & Access + RBAC implementation | role-based User Management no longer authoritative |
| `/admin/communications` inbox/thread/SLA/handoff | Customer/participant communication operations | `NOT_PLATFORM` | Business Operations / Customers & Growth | Keep until split | Communications domain | business scoped permissions | Communications operating surface | Business replacement certified |
| `/admin/communications` provider/worker/dead-letter technical panels | Provider delivery/runtime operations | `SPLIT_PLATFORM_AND_OTHER_PLANE` | Platform → Integrations & Providers → Communications Delivery | Same current component temporarily | communication provider/worker telemetry | Platform integration/provider permissions | technical split surface | Split certified |
| `/dashboard/admin/communications*` aliases | Legacy aliases to same Communications surface | `DEPRECATE_AFTER_CERTIFIED_REPLACEMENT` | Canonical destinations only | Redirect/alias until link migration | same Communications domain | no new authority | canonical split complete | All links/tests migrated |
| `/api/admin/providers*` | Provider registry, activation, kill switch, health/incidents/reconciliation | `REHOME_PLATFORM` | Platform → Integrations & Providers | Existing API remains technical authority until capability fronting | provider registry | `platform.provider.read/manage` + future approval policy | CA-RBAC implementation | Legacy role gate replaced/certified |
| `/api/admin/health` | server-health rows | `REHOME_PLATFORM` | Platform → Runtime / Diagnostics | Existing API bridge | `server_health` | `platform.health.read` | technical projection cleanup | New diagnostics source certified |
| public health detailed telemetry | Public runtime/system detail | `SPLIT_PLATFORM_AND_OTHER_PLANE` | Minimal public liveness + authenticated Platform diagnostics | Do not remove until release/UAT dependencies reconciled | runtime metrics/build provenance | public minimum vs Platform detail | dedicated hardening task | UAT/cert consumers migrated |
| auth/session security endpoints | Step-up, own-session list/revoke | `REHOME_PLATFORM` for technical control; self-service remains user security | Platform → Security for admin security operations | preserve existing self-service | `user_sessions` + assurance | `platform.security.*` for admin paths | RBAC integration | compatibility gates replaced |
| identity lifecycle admin transition | Identity/account-security control | `SPLIT_PLATFORM_AND_OTHER_PLANE` | Trust/People authority + Platform session/security infrastructure | Keep current capability guard | identity lifecycle | Operations capability + assurance | owning-domain recustody | Domain owner/capability certified |
| `/admin/moderation` | Marketplace moderation/inquiry operations | `NOT_PLATFORM` | Business Operations → Marketplace | none beyond normal route migration | Marketplace authority | BU/Operations permission | CA-K3 Operations | new surface certified |
| `/admin/evidence` | Evidence review | `NOT_PLATFORM` | Trust/Risk/Compliance / Operations | none | evidence authority | restricted evidence permission | Trust/Operations surface | certified replacement |
| `/admin/vehicles/:vin/review` | Vehicle evidence/seller/trust review workspace | `NOT_PLATFORM` | Business Operations / Trust | none | composed domain authorities | restricted review scope | Operations | replacement |
| `/admin/people/:userId/review` | Person identity/authority/compliance review | `NOT_PLATFORM` | Trust/Risk/Compliance / People context | none | identity/authority sources | restricted identity permission | Trust/People | replacement |
| `/admin/fraud-queue` | Fraud case operations | `NOT_PLATFORM` | Trust/Risk/Compliance | none | fraud case authority | compliance reviewer | Trust surface | replacement |
| `/admin/dealer-compliance` | Dealer compliance decision | `NOT_PLATFORM` | Trust/Risk/Compliance + Marketplace context | none | dealer compliance authority | control scope | Trust surface | replacement |
| `/admin/garage-applications` | Garage onboarding/review | `NOT_PLATFORM` | Service Network Operations + Trust control | none | garage onboarding authority | operating/control matrix | BU/Trust surface | replacement |
| `/admin/verification` | Identity verification case management | `NOT_PLATFORM` | Trust/Risk/Compliance | none | identity verification | restricted identity permission | Trust surface | replacement |
| `/admin/trust-review` | Trust review queue | `NOT_PLATFORM` | Trust/Risk/Compliance | none | Trust authority | control scope | Trust surface | replacement |
| `/admin/governance-review` | Governance review decisions | `NOT_PLATFORM` | Trust/Risk/Compliance / Legal-Governance | none | governance authority | reviewer scope | Trust/Legal | replacement |
| `/admin/referrals` | Referral campaigns | `NOT_PLATFORM` | Customers & Growth / Growth Operations | none | referral domain | Growth permission | Growth surface | replacement |
| `/admin/referrals/codes` | Referral codes | `NOT_PLATFORM` | Growth Operations | none | referral domain | Growth permission | Growth surface | replacement |
| `/admin/referrals/local-leads` | Referral-associated leads | `NOT_PLATFORM` | Growth Operations | none | referral domain | Growth permission | Growth surface | replacement |
| `/admin/referrals/import-routes` | Referral import-route operations | `NOT_PLATFORM` | Growth / Trade Operations | none | referral/Trade domain | scoped business permission | owning surface | replacement |
| `/admin/referrals/marketing` | Referral marketing content/ops | `NOT_PLATFORM` | Customers & Growth | none | referral/marketing domain | Growth permission | Growth surface | replacement |
| `/admin/referrals/trust` | Referral trust review | `NOT_PLATFORM` | Trust/Risk/Compliance | none | referral trust authority | control permission | Trust surface | replacement |
| `/admin/diaspora/compliance` | Trade compliance operations | `NOT_PLATFORM` | Diaspora Trade Operations / Trust | none | Trade compliance | BU/control matrix | Trade/Trust | replacement |
| `/admin/diaspora/workbooks` | Trade workbook operator console | `NOT_PLATFORM` | Diaspora Trade Operations | none | workbook batches/diagnostics | BU operations | Trade surface | replacement |
| `/admin/diaspora/workbooks/new` | Workbook dry-run | `NOT_PLATFORM` | Diaspora Trade Operations | none | dry-run authority | BU operations | Trade surface | replacement |
| legacy `admin/platform_admin/super_admin` route gates | Broad compatibility authority | `KEEP_COMPATIBILITY_BRIDGE` | CA-RBAC capability/scope grants | Must remain until every consumer is mapped | auth middleware + route/service checks | never convert directly to universal Corporate permission | full dependency inventory/cert | zero uncustodied consumers |
| Feature Governance current legacy role gate | Technical role gate | `KEEP_COMPATIBILITY_BRIDGE` | `platform.feature.*` | preserve until capability gate exists | feature service | Platform RBAC | backend/RBAC implementation | capability path certified |
| Provider Platform current legacy role gate | Technical + current government overlap | `KEEP_COMPATIBILITY_BRIDGE` | `platform.provider.*` plus explicitly separate domain reviewer paths | do not remove blindly | provider platform routes | Platform RBAC + domain boundary | route-specific migration | all current actors mapped |

---

# PART XI — RECOMMENDED PLATFORM INTERNAL IA

## 34. Proposed internal information architecture

The accepted Corporate top-level IA already contains **Platform**.

CA-PLAT recommends, but does **not** Owner-approve, these internal areas:

1. **Platform Overview**
2. **Feature Governance**
3. **Integrations & Providers**
4. **AI / Model Operations**
5. **Security**
6. **Runtime / Diagnostics**
7. **Audit / Change History**

### 34.1 Platform Overview

Composition only:

- current runtime/build identity;
- significant provider/integration states;
- feature-control exceptions;
- security attention items;
- technical source availability.

No mixed business score.

### 34.2 Feature Governance

- registry;
- lifecycle;
- rollouts;
- environment;
- audit.

No Navigation Analytics.

### 34.3 Integrations & Providers

Possible subsections:

- provider registry;
- Communications delivery;
- identity/evidence integrations;
- payment/escrow connectivity;
- lender/insurer connectivity;
- external data services;
- storage/email/messaging where governed.

### 34.4 AI / Model Operations

- model/provider registry;
- runtime policy;
- configuration;
- certification/evaluation metadata;
- technical telemetry;
- audit.

### 34.5 Security

- assurance;
- session security;
- security controls;
- privileged operations;
- security events/attention;
- break-glass when authorized.

### 34.6 Runtime / Diagnostics

- build provenance;
- environment identity;
- database target;
- service diagnostics;
- worker/runtime status;
- deployment visibility where authorized.

### 34.7 Audit / Change History

- Platform technical changes;
- security changes;
- feature changes;
- provider/model/config changes;
- redacted technical audit.

---

# PART XII — OWNER DECISION REGISTER

## 35. Authority rule

An unresolved `OD-CAPLAT-*` is a **question requiring authority**, not authority itself.

Interim entries use these labels:

1. **ACCEPTED UPSTREAM AUTHORITY** — already established by CA-RBAC/CA-UX/CA-METRIC/CA-FIN/CA-GROWTH/CA-REPORT/K2B.
2. **FAIL-CLOSED INTERIM** — a non-expansive restriction that prevents unauthorized action while policy is unresolved.
3. **NON-BINDING CA-PLAT RECOMMENDATION** — architecture guidance only; not permission or operating policy.
4. **UNRESOLVED OWNER DECISION** — no operative policy supplied.

A recommendation must never be treated as production-change, secret, deployment, publication, business-data or access authority.

## 36. Owner Decision Register

| Decision ID | Decision required | Authority posture while unresolved |
| --- | --- | --- |
| `OD-CAPLAT-001` | Final Platform sub-navigation. | **NON-BINDING CA-PLAT RECOMMENDATION:** use the seven-area IA in `34; labels/order are not Owner-approved. |
| `OD-CAPLAT-002` | Timing for retirement of legacy `admin` as broad compatibility authority. | **UNRESOLVED / FAIL-CLOSED:** do not retire until all consumers have certified replacement grants. |
| `OD-CAPLAT-003` | Timing for retirement of `platform_admin`. | **UNRESOLVED / FAIL-CLOSED:** preserve only as compatibility bridge until mapped consumers are certified. |
| `OD-CAPLAT-004` | Timing and future meaning of `super_admin`. | **UNRESOLVED / FAIL-CLOSED:** do not translate to universal Corporate authority or break-glass. |
| `OD-CAPLAT-005` | Whether any future Platform permission bundle should be named PLATFORM_ADMIN. | **NON-BINDING RECOMMENDATION:** archetype may exist, but exact grant comes from CA-RBAC assignments. |
| `OD-CAPLAT-006` | Exact strongest assurance required for critical Platform actions. | **ACCEPTED UPSTREAM + UNRESOLVED DETAIL:** preserve CA-RBAC A0/A1/A2 and current A1 requirements; do not invent A2 until policy/technology exists. |
| `OD-CAPLAT-007` | Which Platform changes require dual control. | **UNRESOLVED / FAIL-CLOSED:** no one-person production critical-change entitlement is inferred from `manage` where separate approval is required by later policy. |
| `OD-CAPLAT-008` | Feature rollout approval policy by environment. | **UNRESOLVED:** current technical manage path remains compatibility authority; future approval workflow not invented. |
| `OD-CAPLAT-009` | Production feature disable/kill-switch emergency authority. | **UNRESOLVED:** preserve current fail-safe technical controls; no new Corporate actor entitlement. |
| `OD-CAPLAT-010` | Integration/provider configuration approval policy. | **UNRESOLVED:** manage permission does not automatically become approver authority. |
| `OD-CAPLAT-011` | Provider production activation approval boundary. | **UNRESOLVED / FAIL-CLOSED:** no new production activation right is created by this document. |
| `OD-CAPLAT-012` | Provider kill-switch enable/disable authority in Production. | **UNRESOLVED:** current route behavior remains compatibility; future capability/approval policy required. |
| `OD-CAPLAT-013` | Secret rotation authority. | **UNRESOLVED / FAIL-CLOSED:** raw secret reveal is not authorized; rotation requires explicit future grant/policy. |
| `OD-CAPLAT-014` | Whether secret rotation requires dual control. | **UNRESOLVED:** recommendation for high-risk Production secrets only, not operative policy. |
| `OD-CAPLAT-015` | Whether any Platform user may ever read raw secrets. | **FAIL-CLOSED INTERIM:** no ordinary Admin raw-secret read; controlled actions/references are preferred. |
| `OD-CAPLAT-016` | AI/model activation authority. | **UNRESOLVED:** `platform.ai.manage` does not by itself settle maker/checker or certification policy. |
| `OD-CAPLAT-017` | Model/provider certification owner. | **UNRESOLVED:** technical Platform records certification state; owning certification authority must be separately accepted. |
| `OD-CAPLAT-018` | Who may change general AI provider/model policy. | **UNRESOLVED / FAIL-CLOSED:** current pinned runtime policy stays until separately authorized. |
| `OD-CAPLAT-019` | Who may change OCR provider/model policy. | **UNRESOLVED / FAIL-CLOSED:** do not conflate with general AI administration. |
| `OD-CAPLAT-020` | Technical AI cost/usage visibility. | **UNRESOLVED:** no estimated cost KPI; show only authoritative source if later accepted. |
| `OD-CAPLAT-021` | Runtime/deployment visibility by Corporate role. | **UNRESOLVED:** Platform health permission is the current architectural anchor; exact visibility scope remains policy. |
| `OD-CAPLAT-022` | Production deployment/promotion authority. | **UNRESOLVED / FAIL-CLOSED:** visibility does not grant deploy. CA-PLAT creates no production-change authority. |
| `OD-CAPLAT-023` | Production rollback authority. | **UNRESOLVED / FAIL-CLOSED:** no rollback authority created. |
| `OD-CAPLAT-024` | Environment-variable configuration authority. | **UNRESOLVED / FAIL-CLOSED:** no environment mutation authorized by this architecture. |
| `OD-CAPLAT-025` | Cross-environment Platform administration model. | **UNRESOLVED:** access to staging does not imply Production. |
| `OD-CAPLAT-026` | Whether environment becomes an explicit CA-RBAC assignment scope. | **NON-BINDING RECOMMENDATION:** model environment as resource scope; any RBAC schema change belongs to CA-RBAC implementation authority. |
| `OD-CAPLAT-027` | Security incident visibility across Corporate roles. | **UNRESOLVED:** executives may get aggregate attention state only if separately permitted; raw security detail remains restricted. |
| `OD-CAPLAT-028` | Security incident mutation/closure authority. | **UNRESOLVED:** technical Security permission does not automatically grant incident adjudication semantics. |
| `OD-CAPLAT-029` | Break-glass activation and approval process. | **ACCEPTED UPSTREAM + UNRESOLVED DETAIL:** no standing break-glass; exact activation/approval remains Owner/CA-RBAC policy. |
| `OD-CAPLAT-030` | Break-glass maximum duration. | **UNRESOLVED:** use CA-RBAC fail-closed rules; do not choose duration here. |
| `OD-CAPLAT-031` | Break-glass post-use review owner. | **UNRESOLVED:** must be independent under accepted CA-RBAC principle; exact role not chosen. |
| `OD-CAPLAT-032` | Session revocation authority over another user. | **ACCEPTED UPSTREAM + UNRESOLVED SCOPE:** CA-RBAC has `platform.security.session.revoke`; exact organisational/target scope remains assignment policy. |
| `OD-CAPLAT-033` | Whether Platform Security may disable base accounts. | **UNRESOLVED:** account disable semantics are distinct from Corporate membership; no new account-disable authority. |
| `OD-CAPLAT-034` | Technical audit retention duration. | **UNRESOLVED:** no deletion authority inferred from missing retention policy. |
| `OD-CAPLAT-035` | Technical audit export rights. | **UNRESOLVED / FAIL-CLOSED:** `platform.audit.read` does not imply export. |
| `OD-CAPLAT-036` | General technical export capability. | **UNRESOLVED / FAIL-CLOSED:** no technical export permission is created by CA-PLAT. |
| `OD-CAPLAT-037` | Whether detailed runtime diagnostics remain exposed on public health endpoints. | **NON-BINDING RECOMMENDATION:** minimize public liveness and move detailed diagnostics behind Platform auth after dependency review. |
| `OD-CAPLAT-038` | Public liveness response contract. | **UNRESOLVED:** do not break existing certification consumers without a separately dispatched migration. |
| `OD-CAPLAT-039` | Communications provider smoke-test authority. | **UNRESOLVED:** current base-platform guard remains compatibility; future capability/assurance policy required. |
| `OD-CAPLAT-040` | Dead-letter retry/requeue ownership when business case and technical delivery overlap. | **UNRESOLVED:** technical recovery and business communication ownership must remain distinguishable. |
| `OD-CAPLAT-041` | Whether Communications provider technical operations live under Integrations or a dedicated subsection. | **NON-BINDING RECOMMENDATION:** Integrations & Providers → Communications Delivery. |
| `OD-CAPLAT-042` | Final ownership of provider reconciliation mismatch resolution. | **UNRESOLVED:** technical mismatch resolution may require domain/Finance control depending on semantics; do not generalize. |
| `OD-CAPLAT-043` | Feature Governance production approval owner. | **UNRESOLVED:** feature technical manager ≠ Product/BU business owner automatically. |
| `OD-CAPLAT-044` | Whether percentage rollout may be changed by one actor in Production. | **UNRESOLVED:** current behavior is compatibility, not future policy. |
| `OD-CAPLAT-045` | Who may certify a model for a business purpose. | **UNRESOLVED:** technical model configuration alone cannot certify business use. |
| `OD-CAPLAT-046` | Whether AI evaluation results are visible under Platform, Data & Intelligence, or both. | **NON-BINDING RECOMMENDATION:** Platform shows technical certification metadata; Data & Intelligence owns analytical interpretation. |
| `OD-CAPLAT-047` | Who may view provider credential-reference identifiers. | **UNRESOLVED:** restrict as Security/Platform metadata; no raw secret follows from it. |
| `OD-CAPLAT-048` | Production-change approval boundary across Feature/Provider/AI/Security. | **UNRESOLVED / FAIL-CLOSED:** CA-PLAT creates no blanket Production operator authority. |
| `OD-CAPLAT-049` | Whether deployment/change tickets are mandatory correlation references. | **NON-BINDING RECOMMENDATION:** useful for audit; not an authority until accepted. |
| `OD-CAPLAT-050` | Technical change reason requirements by action class. | **NON-BINDING RECOMMENDATION:** require reasons for consequential changes; exact list remains policy. |
| `OD-CAPLAT-051` | Audit-before-change versus audit-after-change contract per technical action. | **UNRESOLVED:** preserve existing required-audit fail-closed behavior where already established. |
| `OD-CAPLAT-052` | Whether Platform may see aggregate provider business-volume counts. | **UNRESOLVED / FAIL-CLOSED:** technical health does not imply business-volume access. |
| `OD-CAPLAT-053` | Whether Platform may inspect message/evidence/payment payload content for debugging. | **UNRESOLVED / FAIL-CLOSED:** no content access from technical privilege alone; require separate source-domain permission. |
| `OD-CAPLAT-054` | Whether technical support impersonation/session takeover is ever permitted. | **UNRESOLVED / FAIL-CLOSED:** no impersonation authority is created. |
| `OD-CAPLAT-055` | Legacy role compatibility sunset criteria. | **NON-BINDING RECOMMENDATION:** zero uncustodied consumers, replacement grants, exact-head certification, rollback plan. |
| `OD-CAPLAT-056` | Whether `government` remains permitted on technical Provider Platform routes long term. | **UNRESOLVED:** current route access is product reality; future Platform vs institutional-review split needs bounded recustody. |
| `OD-CAPLAT-057` | Whether Platform Admin gets Corporate Overview by default. | **ACCEPTED UPSTREAM BOUNDARY:** Platform capability does not imply Corporate Intelligence. Any aggregate view requires separate Corporate permission. |
| `OD-CAPLAT-058` | Whether Platform Admin gets customer/People/Finance restricted data for debugging. | **ACCEPTED UPSTREAM BOUNDARY / FAIL-CLOSED:** no; separate record permission/scope/classification required. |
| `OD-CAPLAT-059` | Whether Platform audit access includes raw embedded business payloads. | **ACCEPTED UPSTREAM BOUNDARY:** CA-RBAC requires scope/redaction; audit access is not universal payload access. |
| `OD-CAPLAT-060` | Future Platform technical reporting/publication model. | **ACCEPTED UPSTREAM BOUNDARY:** Platform may supply technical source data; CA-REPORT controls official report publication and Platform Admin is not Reporting Publisher. |

---

# PART XIII — INPUTS FOR IMPLEMENTATION AND CERTIFICATION

## 37. Inputs for CA-K3

CA-K3-01 is active and separate. CA-PLAT-01 authorizes no CA-K3 changes.

A future bounded Platform UI slice should consume:

- existing top-level **Platform** destination only;
- accepted CA-UX shell;
- this proposed internal IA only after CA-MOD/Owner acceptance;
- CA-RBAC Platform capabilities;
- truth-state components;
- source/freshness/provenance metadata;
- explicit read versus manage gates;
- environment context;
- restricted-state UX;
- no raw secret rendering;
- explicit cross-plane links rather than embedded business mutation.

### 37.1 Future UI composition rules

Platform pages should:

- show technical source names/version/as-of;
- show unavailable/degraded rather than zero;
- badge environment;
- badge advisory AI;
- show when a control is compatibility-gated;
- visibly separate view/change/approval state;
- link to owning business plane rather than copy its decision UI.

### 37.2 Do not bring into Platform UI

Do not rehome:

- Marketplace moderation;
- evidence review;
- identity adjudication;
- fraud disposition;
- People membership placement;
- report publishing;
- customer funnel analysis;
- Finance accounting.

---

## 38. Inputs for CA-CERT

CA-CERT should later prove:

### 38.1 Role compatibility

- `platform_admin`/`super_admin` cannot be minted by tenant role selection;
- frontend normalization grants no backend privilege;
- compatibility mapping is explicit and auditable;
- removal of a legacy mapping does not orphan required access;
- Platform permission alone cannot enter unrelated business actions.

### 38.2 Platform RBAC

For each Platform route/action:

- exact capability;
- organisation/resource scope;
- environment;
- classification;
- assurance;
- delegation;
- time;
- denial state.

### 38.3 Feature Governance

Prove:

- read separate from manage;
- override cannot broaden immutable access;
- environment cannot be client-spoofed for writes;
- failed override read does not silently enable a disabled feature;
- mutations audited;
- Navigation Analytics no longer implies feature-manage authority.

### 38.4 Provider administration

Prove:

- raw secret rejected/not returned;
- provider reference metadata only;
- new provider fail closed;
- Production sandbox prohibition preserved where applicable;
- live activation prerequisites preserved;
- kill switch blocks calls;
- provider manage does not expose business payloads.

### 38.5 AI/model operations

Prove:

- model configured state truthful;
- missing provider/credentials is unavailable, not success;
- advisory output remains advisory;
- provider/model provenance preserved;
- OCR and general AI policies separate;
- no fabricated accuracy/cost/quality metrics.

### 38.6 Security/session

Prove:

- session revoke requires exact permission/scope;
- token never returned;
- assurance read failure fails sensitive action;
- A1 is not labelled A2;
- break-glass cannot exist as standing role;
- audit required where policy says required.

### 38.7 Runtime/environment

Prove:

- build identity truthful;
- conflicting build provenance fails closed;
- database target reports reference, not credential;
- environment scope enforced;
- staging/test telemetry cannot become Corporate Actual.

### 38.8 Communications split

Prove:

- business conversation content permission separate from provider/worker technical permission;
- provider health does not become engagement metric;
- fake adapter never appears healthy/real;
- queued/sent/delivered states remain distinct.

### 38.9 Cross-plane denial

Test subjects:

- Platform Admin without Corporate aggregate permission;
- Platform Admin without Finance permission;
- Platform Admin without People private permission;
- Platform Admin without Trust evidence permission;
- Platform Admin without report publication permission.

All must fail in the relevant non-Platform action even if technical Platform access succeeds.

### 38.10 Secrets

Prove no Platform API/UI/log/audit/export reveals:

- password;
- API key;
- bearer/session token;
- private key;
- webhook secret;
- DB credential.

---

# PART XIV — OPEN RISKS

## 39. Open risks

1. **Legacy-role privilege persistence** — global platform-role bypass can outlive intended compatibility period.
2. **Super-admin semantic drift** — label may be assumed to mean all Corporate authority.
3. **Frontend normalization opacity** — `platform_admin/super_admin` appear simply as `admin`.
4. **Route-list bypass leakage** — technical role can reach business-domain routes that should later be separately scoped.
5. **Role-to-capability overmapping** — migration could grant entire future bundles because one legacy route once allowed `admin`.
6. **Tenant/platform namespace crossing** — tenant roles could attempt to mimic platform labels.
7. **Feature/analytics conflation** — current page mixes governance with Navigation Intelligence.
8. **Feature enablement/adoption conflation** — technical exposure may be presented as product success.
9. **Provider/business conflation** — provider health may be presented as commercial completion.
10. **Provider reconciliation/accounting conflation** — technical mismatch resolution may be mistaken for financial reconciliation.
11. **Government-role overlap** — current Provider Platform admits government; future ownership requires recustody.
12. **Raw-secret exposure** — convenience UI may add reveal/copy secret fields.
13. **Secret audit leakage** — before/after snapshots may capture credentials if redaction fails.
14. **Production environment overreach** — staging manage permission may silently apply to Production.
15. **Deployment authority overreach** — runtime visibility may become deploy/rollback permission.
16. **Public health information exposure** — detailed diagnostics may reveal unnecessary runtime/provider information.
17. **Runtime-truth staleness** — `server_health` rows may be old/seeded and look current.
18. **Synthetic Platform health score** — heterogeneous states may be compressed into meaningless percentage.
19. **AI availability/quality conflation** — configured model may be shown as accurate/certified.
20. **AI business-authority leakage** — advisory output may become automated decision.
21. **OCR/general-AI collapse** — separate provider policies may be merged incorrectly.
22. **AI cost fabrication** — token/request heuristics may become reported spend.
23. **Communications plane leakage** — Platform provider permission may expose conversation content.
24. **Delivery/engagement conflation** — sent/delivered may become engagement/conversion.
25. **Smoke-test abuse** — provider test can send to external recipient and therefore requires careful future authority.
26. **Dead-letter ownership ambiguity** — technical retry can affect a business conversation.
27. **Security/People collapse** — technical account/session control may become People membership ownership.
28. **Identity/security collapse** — Security Admin may be given KYC evidence because identity tools use technical infrastructure.
29. **Audit overbreadth** — Platform audit read may leak embedded restricted business data.
30. **Export privilege escalation** — read may become CSV/log export.
31. **Break-glass as super_admin** — legacy role could be misused as permanent emergency account.
32. **A1/A2 mislabelling** — password reauth may be described as strong A2 authentication.
33. **Assurance bypass on legacy routes** — some current admin changes may not have the newer step-up layer.
34. **Capability duplication** — CA-PLAT implementation may create a second permission table instead of consuming CA-RBAC.
35. **Domain mutation proxying** — Platform may add generic mutation endpoints around business services.
36. **Report publisher leakage** — technical report scheduler/admin could become report publisher.
37. **Finance leakage** — payment/provider technical logs may be interpreted as ledger/cash.
38. **K2B bypass** — technical environment/test rows may enter business Actual.
39. **CA-K3 collision** — Platform implementation could mutate shell while CA-K3 custody is active.
40. **Premature role retirement** — removal before route recustody may break necessary operator paths.
41. **Never-retired compatibility** — migration bridge can become permanent if no sunset gate exists.
42. **Model activation without certification** — technical manage permission may bypass purpose certification.
43. **Provider activation without business/legal prerequisites** — technical state can be changed without accepted approval policy.
44. **Secret rotation without rollback** — credential change can break production service.
45. **Unaudited critical changes** — some current technical routes may fail-soft audit.
46. **Environment identity mismatch** — runtime/app/database may point to inconsistent targets.
47. **Machine actor conflation** — worker secret may be treated as human Platform Admin.
48. **Cross-plane navigation leakage** — showing a link may be mistaken for granting access.
49. **Technical source failure as zero** — dashboards may understate incidents.
50. **Platform as miscellaneous bucket** — operational/admin pages may be rehomed merely because they currently live under `/admin`.

---

# PART XV — STOP CONDITIONS AND UNRESOLVED ISSUES

## 40. Stop conditions encountered

CA-PLAT stopped rather than guessing on:

- final Platform sub-navigation;
- exact retirement date of legacy roles;
- future policy meaning of `super_admin`;
- production deployment/promotion authority;
- production rollback authority;
- feature production approval;
- provider production activation approval;
- secret rotation authority;
- dual-control requirements;
- A2 requirements;
- break-glass activation details;
- environment-variable mutation authority;
- technical export rights;
- audit retention;
- security incident audience;
- model certification owner;
- AI model activation approval;
- provider reconciliation ownership where technical and business semantics meet;
- government-role future access to Provider Platform;
- external debug access to restricted source records;
- public health endpoint redesign.

No stop condition required widening scope because each unresolved issue can remain fail-closed/pending in this architecture.

---

# PART XVI — RECOMMENDED NEXT TASK

## 41. Recommended next programme task

After independent CA-MOD acceptance of CA-PLAT-01, the recommended next architecture/certification task is:

**CA-CERT-01 — Corporate Admin Cross-Plane Authority / Migration Certification Model**

Purpose:

- certify the complete CA-1.0 architecture set across Corporate Intelligence, Business Operations and Platform & Security;
- build an exact route/capability/source/plane certification matrix;
- prove legacy-role compatibility does not widen Corporate authority;
- define exact implementation certification gates for CA-K3 and subsequent Platform/Operations slices;
- prove finance/customer/K2B/reporting boundaries survive UI implementation;
- establish retirement gates for current mixed `/admin` surfaces without modifying them during certification design.

This should precede any broad Platform implementation mutation.

---

## 42. Non-actions

CA-PLAT-01 changes no:

- web code;
- backend code;
- shared code;
- mobile code;
- database;
- migrations;
- workflows;
- runtime configuration;
- secrets;
- feature rollout;
- provider activation;
- AI model configuration;
- current `/admin` route;
- CA-K3 artifact;
- K2B state;
- staging data;
- Production data;
- deployment.

No merge is authorized or performed.

This document does not self-accept.

CA-PLAT-01 CORPORATE PLATFORM / SECURITY ADMINISTRATION MODEL READY FOR MODERATOR REVIEW

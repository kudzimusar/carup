# CARUP CORPORATE ORGANISATION MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-ORG — Organisation & Subsidiary Structure Agent  
Task: CA-ORG-01  
Status: ORGANISATION ARCHITECTURE / DOCUMENTATION ONLY — NOT ACCEPTED UNTIL CA-MOD REVIEW

## 1. Authority and custody

This organisation model is produced under the following exact authorities:

- Canonical programme plan: `docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md`
- Canonical programme authority: `5d4997cacaff8068c4ec4c5ae78f562be4249344`
- Accepted architecture input: CA-ARCH / CA-ARCH-01
- Accepted CA-ARCH-01 authority: `7cae8c3c8c987714a8ca6db2128db3b9a589f141`
- Current documentation starting head: `337072a7ea3a8bddabf96745ffca742014882947`
- Product/reference authority inspected read-only: PR #222 / `fix/oc5r-real-runtime-source-closure` at `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`
- Parallel provenance dependency: K2B — ACTIVE

The live PR #222 head had advanced beyond the supplied product inspection SHA at execution time. This task intentionally remained pinned to `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` and did not substitute later product state.

This document defines a **conceptual internal organisation architecture** for Corporate Admin. It does not prove incorporation, employment, tax residence, ownership structure, subsidiaries, statutory reporting entities or legal relationships.

### 1.1 Binding separation

The model preserves three distinct namespaces:

1. **INTERNAL CORPORATE ORGANISATION** — CarUp's own corporate hierarchy, functions, business units, departments and teams.
2. **EXTERNAL PLATFORM PARTICIPANT / TENANT / PARTNER** — dealers, garages, banks, insurers, government institutions, vendors, service providers, API partners and other organisations using or connecting to CarUp.
3. **REPORTING DIMENSIONS** — region, cost centre, profit centre, currency, reporting period and consolidation scope. These may classify activity but are not automatically organisational units.

No current `tenant`, `organization`, route, portal or product role is treated as proof of an internal CarUp corporate unit.

---

## 2. Evidence posture

### PROVEN PRODUCT / REPOSITORY FACT

The inspected product contains:

- product/domain surfaces for Marketplace, dealer/vehicle commerce, garage/service, finance, insurance, Diaspora Trade, logistics/container operations, parts/PartSentry, referral/marketing, communications, Trust/Risk/Compliance, identity/verification, Data/Intelligence and Platform operations;
- a platform tenancy model using `tenants` and `tenant_users`;
- legacy `organizations` types such as dealership, garage, insurance, bank, fleet, import and government;
- external/provider constructs including `provider_registry`, `lender_profiles`, `insurer_profiles` and `partner_clients`;
- platform participant roles including dealer, mechanic, bank, insurance and government;
- a monolithic internal `admin` role rather than a corporate membership model.

These facts prove product domains and external participant models. They do **not** prove internal corporate structure.

### PROPOSED ORGANISATIONAL MODEL

CA-ORG proposes a durable structure that can represent:

`CORPORATE_PARENT → LEGAL_ENTITY / SUBSIDIARY OR BUSINESS_UNIT → DEPARTMENT → TEAM`

while allowing central corporate functions to serve multiple business units through matrix relationships rather than duplicated departments.

### OWNER DECISION REQUIRED

Every unresolved business-structure question is assigned an `OD-CAORG-###` identifier in section 15. No unresolved point is promoted to fact.

---

## 3. Canonical conceptual organisation taxonomy

The taxonomy below is conceptual. It is not a database schema.

| Entity type | Definition | Eligible parent(s) | Internal / external | May own people | May own metrics | May own budget / P&L scope | May own operating workflows | Appears in internal Corporate Admin hierarchy | Organisational unit or reporting dimension |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CORPORATE_PARENT` | Top conceptual CarUp corporate root used for consolidated management. Legal identity is not implied. | None | Internal | Yes | Yes | Consolidated scope candidate | Yes, through child units/functions | Yes | Organisational unit |
| `LEGAL_ENTITY` | A legally recognised company/entity proven by legal evidence outside route/product structure. | CORPORATE_PARENT or another legally valid parent subject to Owner/legal evidence | Internal | Yes | Yes | Yes | Yes | Yes | Organisational unit |
| `SUBSIDIARY` | A legally controlled entity proven by legal/ownership evidence. It is a legal-entity subtype, not a product-domain synonym. | CORPORATE_PARENT or LEGAL_ENTITY | Internal | Yes | Yes | Yes | Yes | Yes | Organisational unit |
| `BUSINESS_UNIT` | Internal accountable commercial/operating unit that groups related products, customers and workflows. It need not be a legal entity. | CORPORATE_PARENT, LEGAL_ENTITY or SUBSIDIARY | Internal | Yes | Yes | Budget yes; P&L candidate subject to OD-CAORG-012 | Yes | Yes | Organisational unit |
| `CORPORATE_FUNCTION` | Central/shared internal function serving the enterprise or multiple BUs, such as Finance & Accounting or Trust/Risk/Compliance. | CORPORATE_PARENT, LEGAL_ENTITY or SUBSIDIARY | Internal | Yes | Yes | Budget/cost scope yes; P&L normally no unless explicitly decided | Yes, for its function | Yes | Organisational unit |
| `DEPARTMENT` | Stable operating subdivision of a BU or corporate function. | BUSINESS_UNIT, CORPORATE_FUNCTION, LEGAL_ENTITY or SUBSIDIARY | Internal | Yes | Yes | Budget/cost scope candidate | Yes | Yes | Organisational unit |
| `TEAM` | Smallest normal internal organisational grouping for people and bounded workflow responsibility. | DEPARTMENT, BUSINESS_UNIT or CORPORATE_FUNCTION where no department layer is needed | Internal | Yes | Operational/team metrics | Budget may be allocated; not automatically P&L | Yes | Yes, when useful | Organisational unit |
| `COST_CENTRE` | Accounting/reporting allocation used to attribute costs. It may map to an org unit but is not the org unit itself. | Linked to any internal accountable unit; not a hierarchy parent by default | Internal reporting construct | No by itself | Cost metrics | Yes, cost scope | No by itself | As metadata/filter, not hierarchy by default | Reporting dimension |
| `PROFIT_CENTRE` | Management-accounting scope used to attribute revenue/contribution/P&L responsibility. It may map to a BU or legal entity but is not automatically one. | Linked to BUSINESS_UNIT / LEGAL_ENTITY / SUBSIDIARY subject to OD-CAORG-012 | Internal reporting construct | No by itself | Revenue/contribution metrics | P&L scope candidate | No by itself | As metadata/filter, not hierarchy by default | Reporting dimension |
| `REGION` | Geographic reporting/operating scope such as country, market or region. It does not imply incorporation. | May scope any internal or external unit; not a corporate parent by default | Reporting construct | No by itself | Geographic metrics | Geographic budget/report scope may be assigned | No by itself | Filter/dimension; optional hierarchy view | Reporting dimension |
| `EXTERNAL_CUSTOMER_OR_MERCHANT_ORGANISATION` | Dealer, garage, fleet, exporter or other customer/merchant business acting on CarUp. | External only | External | Its own people, not CarUp people | Partner/customer metrics only | No CarUp P&L ownership | Own external workflows; participates in CarUp workflows | No | External entity |
| `EXTERNAL_PARTNER` | Contracted or integrated third party that supports/consumes CarUp capabilities. | External only | External | Its own people | Partner-performance metrics may be governed | No CarUp P&L ownership | Partner workflows | No | External entity |
| `REGULATOR` | Government/regulatory authority acting in a statutory or oversight capacity. | External only | External | Its own people | Regulatory/service metrics if governed | No | Regulatory workflows | No | External entity |
| `VENDOR` | Third-party supplier to CarUp, including software, infrastructure or professional-service provider. | External only | External | Its own people | Vendor/service metrics | No CarUp P&L ownership | Vendor/service workflows | No | External entity |
| `EXTERNAL_SERVICE_PROVIDER` | Bank, lender, insurer, payment/escrow provider, logistics provider or similar product/service provider. | External only | External | Its own people | Provider-service metrics | No CarUp P&L ownership | Provider workflows | No | External entity |

### 3.1 Taxonomy invariants

1. `LEGAL_ENTITY` and `SUBSIDIARY` require legal evidence; product routes never create them.
2. `BUSINESS_UNIT` is an internal management construct and may exist without separate incorporation.
3. `REGION` is not a legal entity unless separate evidence says otherwise.
4. `COST_CENTRE` and `PROFIT_CENTRE` are accounting/reporting dimensions, not departments.
5. External participants never become CarUp organisational nodes merely because they have tenant membership, portals, APIs or operational queues.
6. One external company may appear in multiple external roles without becoming multiple CarUp departments.
7. A product capability may be shared across multiple organisational units without being duplicated organisationally.

---

## 4. Internal versus external boundary

### 4.1 Hard conceptual rule

**Internal corporate membership must never be inferred from `tenant_users`, `organizations`, product roles, provider registrations or partner API access.**

The inspected tenancy model explicitly treats a tenant role as a role **inside one organisation** and distinguishes it from the platform role. Existing organisations include dealership, garage, insurance, bank, fleet, import and government types. These are primarily participant/tenant concepts, not evidence of CarUp employment or corporate placement.

### 4.2 Current participant classification

| Current participant/domain term | Proven current product status | Corporate-organisation interpretation |
| --- | --- | --- |
| Dealer / dealership | Formal platform role plus dealer profile / tenant or organisation constructs | External customer/merchant organisation when referring to a dealership; internal **Dealer / Vehicle Commerce** product domain is a separate concept |
| Garage | Tenant/organisation type; mechanic users and garage membership/workspace | External customer/service organisation when referring to a garage; internal **Garage & Service** product domain is separate |
| Mechanic | Platform/person role and garage practitioner context | External/marketplace participant unless separately proven to be a CarUp employee |
| Bank / lender | Platform role, lender/provider profile and finance integration constructs | External regulated service provider; internal Finance/Payments product ownership remains separate |
| Insurer | Platform role, insurer/provider profile and insurance integration constructs | External regulated service provider; internal Insurance product ownership remains separate |
| Government | Platform role / organisation type / provider integration context | External regulator/institution; never a CarUp department |
| Logistics provider | Business-registration vocabulary / communications participant role / trade workflows | External service provider unless separately contracted as internal employment, which repository evidence does not prove |
| External API partner | `partner_clients` scoped API principal | External partner |
| Payment / escrow provider | Provider configuration/control-plane record | External service provider |
| `tenants` / `tenant_users` | Platform organisation membership and context | External/customer/partner organisation namespace by default; not Corporate Admin internal membership |
| Legacy `organizations` | Mixed external organisation model with participant types | Not authoritative for internal CarUp hierarchy |
| `admin` user | Current platform administrative authority | Does not prove CEO/CFO/COO/function placement |

### 4.3 Required future namespace separation

Corporate Admin should conceptually maintain:

- **Corporate person identity** — the human/account base identity.
- **Internal corporate placement** — home unit and matrix assignments.
- **Platform role** — existing product/runtime role during migration.
- **External tenant membership** — membership in a dealer, garage or other participant organisation.
- **Partner/provider authority** — API/provider-specific external authority.
- **Delegated corporate scope** — time-bound internal authority handled later by CA-RBAC.

These must remain independently inspectable.

---

## 5. Proposed durable internal hierarchy

### 5.1 Root

**PROPOSED ORGANISATIONAL MODEL**

`CARUP_CORPORATE` — entity type `CORPORATE_PARENT`

- Purpose: consolidated internal management root.
- Legal status: **UNKNOWN**.
- It is a conceptual reporting/management root only until OD-CAORG-001 and OD-CAORG-015 are resolved.
- It may contain legal entities/subsidiaries if legal evidence later proves them, without changing the rest of the taxonomy.

### 5.2 MVP hierarchy

The minimum durable structure proposed for CA-1.0 is:

`CARUP_CORPORATE`  
→ Executive Office  
→ Business Units  
→ Corporate Functions  
→ Platform / Technology

#### Proposed business units

1. `BU_MARKETPLACE` — Marketplace & Vehicle Commerce
2. `BU_SERVICE_NETWORK` — Garage, Service & Parts
3. `BU_FINANCIAL_SERVICES` — Finance, Payments & Insurance
4. `BU_DIASPORA_TRADE` — Diaspora Trade & Logistics

These are **management proposals, not legal entities**.

The grouping deliberately avoids making every product domain a separate BU on day one. The taxonomy allows later split/merge by changing organisational placement while preserving product-domain identity and metric lineage.

#### Proposed corporate functions

- `CF_EXECUTIVE` — Executive Office
- `CF_FINANCE_ACCOUNTING` — Finance & Accounting
- `CF_CUSTOMERS_GROWTH` — Customers & Growth
- `CF_TRUST_RISK_COMPLIANCE` — Trust / Risk / Compliance
- `CF_DATA_INTELLIGENCE` — Data & Intelligence
- `CF_LEGAL_GOVERNANCE` — Legal / Governance
- `CF_PEOPLE_ADMIN` — People & Administration

#### Proposed platform function

- `CF_PLATFORM_TECH` — Platform / Technology
  - Platform Operations
  - Security
  - AI / Model Operations
  - Data Engineering
  - Feature Governance
  - Integrations

Security remains a distinct governed platform function with an escalation relationship outside normal product operations; whether it requires a structurally independent reporting line is OD-CAORG-017.

### 5.3 Why this is the safe MVP default

- It preserves every proven product domain.
- It prevents an explosion of empty or artificial BUs.
- It keeps corporate functions central rather than duplicated.
- It cleanly separates Finance & Accounting from the Finance/Payments product business.
- It allows Insurance, Dealer/Vehicle Commerce, Logistics and PartSentry to become separate BUs later without redefining the entity taxonomy.
- It avoids interpreting banks, insurers, dealers or garages as internal organisational units.
- It gives CA-RBAC, CA-METRIC and CA-REPORT stable organisational scopes before final job titles or legal structure are known.

All BU grouping choices remain subject to the explicit Owner Decisions in section 15.

---

## 6. Business-domain classification matrix

The following matrix deliberately separates **PROVEN CURRENT PRODUCT DOMAIN**, **PROPOSED INTERNAL ORGANISATIONAL HOME**, and **LEGAL STATUS**.

| Domain | PROVEN CURRENT PRODUCT DOMAIN | Classification | PROPOSED INTERNAL ORGANISATIONAL HOME | LEGAL STATUS | Key boundary / dependency | Owner Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Marketplace | Proven marketplace routes, listings, inquiries, moderation and Intelligence | `PROPOSED_BUSINESS_UNIT` | `BU_MARKETPLACE` / Marketplace Department | **UNKNOWN** | External buyers/sellers/dealers are participants, not staff | OD-CAORG-003 |
| Dealer / Vehicle Commerce | Proven dealer inventory/compliance/commerce domain | `UNRESOLVED` | Safe default: department/product line inside `BU_MARKETPLACE` | **UNKNOWN** | External dealerships remain `EXTERNAL_CUSTOMER_OR_MERCHANT_ORGANISATION` | OD-CAORG-004 |
| Garage & Service | Proven garage/service network, work-order and mechanic domain | `PROPOSED_BUSINESS_UNIT` | `BU_SERVICE_NETWORK` / Service Network Department | **UNKNOWN** | External garages/mechanics remain participant organisations/persons | OD-CAORG-005 |
| Finance / Payments | Proven finance applications, eligibility/provider and payment/escrow product domains | `PROPOSED_BUSINESS_UNIT` | `BU_FINANCIAL_SERVICES` / Finance & Payments Department | **UNKNOWN** | External banks/lenders/payment providers remain external; Finance & Accounting is separate | OD-CAORG-009 |
| Insurance | Proven insurance records/claims/provider/demand domain | `UNRESOLVED` | Safe default: Insurance Product Department inside `BU_FINANCIAL_SERVICES` | **UNKNOWN** | External insurers remain regulated providers | OD-CAORG-010 |
| Diaspora Trade | Proven import/order/quote/compliance/workbook/trade domain | `PROPOSED_BUSINESS_UNIT` | `BU_DIASPORA_TRADE` / Trade Operations Department | **UNKNOWN** | External exporters/dealers/customers remain participants | OD-CAORG-007 |
| Logistics / Container Services | Proven shipment/container/workbook/logistics product domain; live integration maturity limited | `UNRESOLVED` | Safe default: Logistics & Container Department inside `BU_DIASPORA_TRADE` | **UNKNOWN** | External logistics/carrier providers remain external | OD-CAORG-008 |
| Parts / PartSentry | Proven parts/provenance domain and PartSentry records | `SHARED_GOVERNED_CAPABILITY` | Safe default: Parts & Provenance Department inside `BU_SERVICE_NETWORK` with Trust/Risk/Compliance governance matrix | **UNKNOWN** | Part provenance must not become a second Trust authority | OD-CAORG-006 |
| Referral / Marketing | Proven referral campaigns/codes/events and marketing-generation tools | `PROPOSED_CORPORATE_FUNCTION` | `CF_CUSTOMERS_GROWTH` / Marketing & Acquisition Department | **UNKNOWN** | AI/generated marketing output remains advisory; commercial attribution governed later | OD-CAORG-016 |
| Communications | Proven customer threads/messages plus delivery/provider/worker operations | `SHARED_GOVERNED_CAPABILITY` | Business ownership: `CF_CUSTOMERS_GROWTH` / Customer Communications; technical transport: `CF_PLATFORM_TECH` / Integrations | **UNKNOWN** | One product service spans business and platform planes | OD-CAORG-019 |
| Trust / Risk / Compliance | Proven evidence, fraud, trust, governance, compliance domains | `PROPOSED_CORPORATE_FUNCTION` | `CF_TRUST_RISK_COMPLIANCE` | **UNKNOWN** | Central control function; should not be duplicated per BU | OD-CAORG-013 |
| Identity / Verification | Proven identity sessions, OCR/classification, decisions and assurance | `SHARED_GOVERNED_CAPABILITY` | `CF_TRUST_RISK_COMPLIANCE` / Identity & Verification Department or team | **UNKNOWN** | Shared service to BUs; identity evidence remains governed domain authority | OD-CAORG-013 |
| Data & Intelligence | Proven Intelligence services, governed projections, metric/data lineage concerns | `PROPOSED_CORPORATE_FUNCTION` | `CF_DATA_INTELLIGENCE` | **UNKNOWN** | Business metric governance separate from platform runtime health | OD-CAORG-013 |
| Platform Operations | Proven technical platform/control-plane capability | `PLATFORM_FUNCTION` | `CF_PLATFORM_TECH` / Platform Operations | **UNKNOWN** | Technical administration must not confer corporate-finance authority | OD-CAORG-013 |
| Security | Proven authentication, audit, assurance and security-control needs | `PLATFORM_FUNCTION` | `CF_PLATFORM_TECH` / Security, with independent escalation matrix | **UNKNOWN** | Structural independence unresolved | OD-CAORG-017 |
| AI / Model Operations | Proven AI/provider/model operational surfaces and advisory outputs | `PLATFORM_FUNCTION` | `CF_PLATFORM_TECH` / AI & Model Operations; analytical governance matrix to `CF_DATA_INTELLIGENCE` | **UNKNOWN** | Model runtime ≠ corporate intelligence semantics | OD-CAORG-018 |
| Feature Governance | Proven feature rollout/override control plane | `PLATFORM_FUNCTION` | `CF_PLATFORM_TECH` / Feature Governance | **UNKNOWN** | Navigation Analytics should not remain organisationally coupled merely because UI is shared | OD-CAORG-013 |
| Integrations | Proven provider, partner, communications and technical integration capabilities | `PLATFORM_FUNCTION` | `CF_PLATFORM_TECH` / Integrations | **UNKNOWN** | External providers remain external entities | OD-CAORG-013 |
| People & Administration | Proven need for account lifecycle; current Admin user management is monolithic | `PROPOSED_CORPORATE_FUNCTION` | `CF_PEOPLE_ADMIN` | **UNKNOWN** | Internal corporate membership source is not current tenant membership | OD-CAORG-022 |
| Legal / Governance | Governance/audit product capabilities exist; internal legal department existence is not proven | `PROPOSED_CORPORATE_FUNCTION` | `CF_LEGAL_GOVERNANCE` | **UNKNOWN** | Legal incorporation/legal reporting requires external evidence | OD-CAORG-020 |
| Finance & Accounting | Corporate requirement from canonical plan; current product Finance Intelligence is not accounting | `PROPOSED_CORPORATE_FUNCTION` | `CF_FINANCE_ACCOUNTING` | **UNKNOWN** | Must remain distinct from `BU_FINANCIAL_SERVICES` | OD-CAORG-013 |
| Customers & Growth | Proven navigation, referral, marketplace funnel and communications data families | `PROPOSED_CORPORATE_FUNCTION` | `CF_CUSTOMERS_GROWTH` | **UNKNOWN** | CA-GROWTH defines governed funnel semantics | OD-CAORG-013 |

---

## 7. Proposed business-unit ownership model

The table establishes conceptual accountability only. Job titles remain placeholders.

| Proposed BU | Customers / counterparties | Operating workflows / queues | Metric ownership candidate | Budget / P&L candidate | Reporting responsibility | Leadership placeholder | Geographic scope | Shared services consumed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BU_MARKETPLACE` — Marketplace & Vehicle Commerce | Buyers, private sellers, dealers, vehicle-commerce participants | Listings, inquiries, moderation, dealer commercial operations, commerce lifecycle | Marketplace/vehicle-commerce operating and performance metrics | Candidate subject to OD-CAORG-012 | BU scorecard, operations and commercial reporting | `BU_LEAD` | Multi-country capable; actual MVP regions subject to OD-CAORG-011 | Finance & Accounting; Customers & Growth; Trust/Risk/Compliance; Data & Intelligence; Legal/Governance; Platform |
| `BU_SERVICE_NETWORK` — Garage, Service & Parts | Vehicle owners, garages, mechanics, parts participants | Service network, work orders/cases, garage operations, parts/provenance | Service/garage/parts performance metrics | Candidate subject to OD-CAORG-012 | BU scorecard, service operations, parts/provenance reporting | `BU_LEAD` | Multi-country capable; actual regions subject to OD-CAORG-011 | Customers & Growth; Trust/Risk/Compliance; Data & Intelligence; Platform; Finance & Accounting |
| `BU_FINANCIAL_SERVICES` — Finance, Payments & Insurance | Applicants/customers, banks/lenders, insurers, payment/escrow counterparties | Finance demand/applications, payment/escrow product operations, insurance product operations and provider relationships | Product-demand/provider/transaction metrics once governed | Candidate subject to OD-CAORG-009/010/012 | BU scorecard; does **not** own statutory accounting merely because it contains finance products | `BU_LEAD` | Product/provider jurisdiction-aware | Finance & Accounting; Trust/Risk/Compliance; Legal/Governance; Data & Intelligence; Platform |
| `BU_DIASPORA_TRADE` — Diaspora Trade & Logistics | Diaspora buyers/sponsors, exporters/dealers, logistics providers, trade participants | Orders, quotes, workbooks, trade compliance, logistics/container processes | Trade and logistics operating metrics | Candidate subject to OD-CAORG-007/008/012 | BU scorecard and trade-operating reports | `BU_LEAD` | Corridor/country aware; exact MVP regions subject to OD-CAORG-011 | Finance & Accounting; Customers & Growth; Trust/Risk/Compliance; Data & Intelligence; Legal/Governance; Platform |

### 7.1 Ownership principle

A BU may own **business outcome accountability** without owning every service it consumes.

Example:

- Marketplace owns marketplace listing/inquiry operating performance.
- Trust/Risk/Compliance owns central control policy and governed trust/compliance responsibilities.
- Data & Intelligence owns metric/data governance responsibilities.
- Platform owns runtime/integration operation.
- Finance & Accounting owns accounting semantics and consolidation.

This prevents each BU from creating its own compliance, metric or platform truth.

---

## 8. Corporate function model

| Corporate function | Central/shared? | Primary conceptual responsibility | Consuming BUs | Independent reporting responsibility | Restricted-information expectation | Direct Corporate Admin top-level presence |
| --- | --- | --- | --- | --- | --- | --- |
| Executive Office | Central | Corporate direction, consolidated review, strategic accountability | All | Yes | Broad aggregate; detailed access later governed by CA-RBAC | Corporate Overview |
| Finance & Accounting | Central | Management-accounting semantics, budgets, cost/profit-centre governance, financial reporting | All | Yes | Restricted Financial | Finance |
| Customers & Growth | Central | Acquisition, customer intelligence, funnel/navigation, retention, referral and growth governance | All commercial BUs | Yes | Internal / customer analytics; PII scope separate | Customers & Growth |
| Marketing & Communications | Proposed department within Customers & Growth | Brand/campaign/customer communications business ownership | All relevant BUs | Yes within Customers & Growth | Internal/customer communications | Customers & Growth; operational views may surface under Operations |
| Trust / Risk / Compliance | Central shared control function | KYC/identity, evidence, fraud/risk, compliance controls, audit oversight | All BUs | Yes, including escalation independent of BU performance | Restricted Identity/Compliance | Trust / Risk / Compliance |
| Data & Intelligence | Central shared | Metric/data lineage, analytical products, data quality, business intelligence governance | All | Yes | Internal Confidential; some derived restricted scopes | Data & Intelligence |
| Legal / Governance | Central proposed | Corporate legal/governance policy, legal obligations, governance framework | All | Yes | Internal Confidential / legal restricted as later defined | Usually under Corporate/People/Reports; exact IA subject to CA-UX |
| People & Administration | Central | Internal membership placement, people lifecycle, administration, organisational records | All | Yes | Restricted personnel/access data | People & Access |
| Platform / Technology | Central platform function | Runtime platform, technical operations, integrations, feature governance, model operations/data engineering | All | Yes | Restricted Security/Platform | Platform |
| Security | Central platform/control capability | Authentication/security posture, security administration, incident/control oversight | All | Yes; independence subject to OD-CAORG-017 | Restricted Security/Platform | Platform, with Trust/Risk cross-link where appropriate |

### 8.1 Required non-mergers

The following separations are binding architectural recommendations:

- **Finance & Accounting ≠ Finance/Payments product BU.**
- **Customers & Growth ≠ Communications technical delivery.**
- **Data & Intelligence ≠ Platform runtime administration.**
- **Trust/Risk/Compliance ≠ each BU's local operations team.**
- **Security ≠ generic Platform Admin permission.**
- **Legal/Governance ≠ product governance queue by default.**

---

## 9. Shared-function and matrix relationship model

Central functions must serve BUs without being duplicated as separate organisational departments inside every BU.

### 9.1 Conceptual relationship types

The future Corporate Admin organisation model should be capable of expressing these relationships without treating them as permissions:

- `HOME_UNIT` — the person's primary internal organisational placement.
- `MATRIX_ASSIGNMENT` — a secondary assignment to another BU/function/team for a defined purpose.
- `SERVICE_RELATIONSHIP` — one internal unit provides a shared service to another.
- `CONTROL_RELATIONSHIP` — central function governs/assures a BU process without owning the BU.
- `METRIC_BUSINESS_OWNER` — organisational owner accountable for metric meaning/use.
- `DATA_STEWARD_RELATIONSHIP` — function responsible for data definition/quality/lineage, subject to CA-METRIC.
- `OPERATING_OWNER` — organisational unit accountable for day-to-day workflow/queue.
- `REPORTING_OWNER` — unit accountable for recurring management reporting.
- `COST_ALLOCATION_RELATIONSHIP` — reporting relationship used by CA-FIN; not organisational parentage.

These are conceptual organisation/accountability relationships, not the CA-RBAC permission model.

### 9.2 Example: Trust / Risk / Compliance

One central `CF_TRUST_RISK_COMPLIANCE` may:

- govern evidence-review policy across `BU_MARKETPLACE`;
- govern dealer compliance controls across `BU_MARKETPLACE`;
- govern garage/service compliance across `BU_SERVICE_NETWORK`;
- govern finance/insurance control policy across `BU_FINANCIAL_SERVICES`;
- govern trade/compliance controls across `BU_DIASPORA_TRADE`.

The same central function does not become five duplicated compliance departments.

BU teams may execute bounded operational queues. Central Trust/Risk/Compliance retains control ownership and independent risk/compliance reporting.

### 9.3 Example: Communications

Current Communications capability spans two planes:

- customer/business communications — matrixed to `CF_CUSTOMERS_GROWTH` and relevant BU operating teams;
- provider/delivery/dead-letter/worker operations — owned by `CF_PLATFORM_TECH`.

The underlying governed Communications service may remain shared. Organisational ownership is split by responsibility, not by duplicating technical truth.

---

## 10. Metric and reporting ownership model

This section supplies organisation ownership inputs only; CA-METRIC defines formulas and semantic authority.

### 10.1 Required ownership fields for each corporate metric

Every future governed corporate metric should be able to reference:

- `ACCOUNTABLE_ORG_UNIT` — the BU/function accountable for the business outcome;
- `METRIC_BUSINESS_OWNER` — organisational owner responsible for definition/use;
- `DATA_STEWARD_ORG` — organisational function responsible for data quality/lineage;
- `REPORTING_OWNER_ORG` — unit responsible for recurring management reporting;
- `CONTROL_OWNER_ORG` — optional independent control function;
- `LEGAL_ENTITY_SCOPE` — when legal reporting applies;
- `BUSINESS_UNIT_SCOPE`;
- `DEPARTMENT_SCOPE` where relevant;
- `REGION_SCOPE`;
- `COST_CENTRE` / `PROFIT_CENTRE` where finance has established them;
- K2B provenance requirement.

### 10.2 Default accountability pattern

- Commercial/product KPIs → BU accountable.
- Corporate financial KPIs → Finance & Accounting accountable for accounting semantics; BU may own operating drivers.
- Customer/growth KPIs → BU owns business outcome; Customers & Growth owns cross-company growth semantics.
- Trust/risk/compliance KPIs → Trust/Risk/Compliance owns control semantics; BU owns remediation/operating outcome where appropriate.
- Data-quality/lineage metrics → Data & Intelligence.
- Platform/runtime metrics → Platform/Technology.
- People/access metrics → People & Administration with Security/Trust control relationships where relevant.

### 10.3 K2B boundary

Metric organisational ownership does not decide whether a row is operational business truth. K2B remains the provenance authority. Any metric depending on operational/test distinction is `PENDING_K2B` until K2B permits activation.

---

## 11. Financial and reporting dimensions

This section defines dimensions Corporate Admin must be able to carry. It does not define accounting formulas or consolidation rules.

| Dimension | Purpose | Organisational relationship | Status / decision |
| --- | --- | --- | --- |
| Legal entity | Statutory/accounting entity scope | Links internal organisational activity to a proven legal entity | Unknown until OD-CAORG-001 / OD-CAORG-002 |
| Business unit | Management performance/accountability | Primary commercial/operating unit | Proposed in this model; final boundaries OD-CAORG-003 through OD-CAORG-010 |
| Department | Functional/operational drill-down | Child organisational unit | Supported conceptually |
| Team | Bounded people/workflow ownership | Child organisational unit | Supported conceptually |
| Region / country | Geographic operating/reporting scope | Dimension attached to units, people, customers or metrics | MVP countries/regions OD-CAORG-011 |
| Currency | Monetary reporting unit | Metric/transaction/reporting dimension; never inferred from region alone | Base/reporting-currency policy belongs to CA-FIN and OD-CAORG-024 |
| Cost centre | Cost allocation | Linked to org unit but not identical to it | Granularity OD-CAORG-021; accounting semantics CA-FIN |
| Profit centre | Contribution/P&L reporting | Usually linked to BU/legal entity when authorised | Scope OD-CAORG-012 / OD-CAORG-021 |
| Reporting period | Time basis for management reports | Cross-cuts all units | Calendar/fiscal rules OD-CAORG-025 |
| Consolidation scope | Which legal entities/BUs roll into a report | Reporting relationship, not hierarchy alone | Requires legal/accounting determination OD-CAORG-001 / OD-CAORG-026 |

### 11.1 Required downstream boundary

CA-FIN / CA-FIN-01 must determine:

- accounting basis and period semantics;
- base/reporting currencies;
- cost-centre/profit-centre governance;
- P&L attribution;
- legal/statutory consolidation;
- inter-unit/intercompany treatment where applicable.

CA-ORG does not infer any of these from product transactions.

---

## 12. People and membership-placement inputs for CA-RBAC

This section defines **where a corporate person belongs**, not what they may do.

### 12.1 Conceptual placement model

A corporate person should be able to have:

1. **one home organisational unit** — normally TEAM, DEPARTMENT, CORPORATE_FUNCTION or BUSINESS_UNIT;
2. **zero or more matrix assignments** — secondary internal assignments with purpose and time bounds;
3. **zero or more delegated organisational scopes** — temporary responsibility for another unit, resolved by CA-RBAC;
4. **zero or more geographic scopes** — country/region responsibility;
5. **an optional leadership/position label** — descriptive, not authoritative for access;
6. **external partner/tenant relationships separately** — never folded into internal membership.

### 12.2 Corporate placement attributes required downstream

CA-RBAC should be able to consume organisational facts such as:

- corporate person identifier;
- home org-unit identifier;
- org-unit type;
- parent chain;
- legal-entity association if proven;
- business-unit association;
- department/team;
- matrix assignment org unit;
- assignment start/end;
- assignment purpose;
- geographic scope;
- employment/contract relationship classification if an authoritative source later exists;
- active/inactive organisational placement state.

### 12.3 Explicit separation from existing tenancy

Existing:

`users.role`  
`tenant_users(tenant_id, user_id, role)`  
`user_sessions.active_organization_id`

must **not** automatically become:

`corporate_membership`  
`home_business_unit`  
`corporate_department`  
`corporate_team`

A person may simultaneously be:

- a CarUp corporate employee/contractor in an internal function;
- an admin/member of an external tenant for operational reasons;
- a platform administrator during migration;
- a temporary delegate for a BU.

These are separate relationships and must not overwrite one another.

The authoritative internal people/membership source remains unresolved under OD-CAORG-022.

---

## 13. MVP Corporate Admin organisation structure

The proposed MVP is intentionally bounded:

### `CARUP_CORPORATE` — CORPORATE_PARENT
**Legal status: UNKNOWN — OD-CAORG-001 / OD-CAORG-015**

#### Executive Office
- Executive leadership grouping
- Final titles and current incumbency: OD-CAORG-014

#### Business Units
- `BU_MARKETPLACE` — Marketplace & Vehicle Commerce
  - Marketplace Operations
  - Dealer / Vehicle Commerce
- `BU_SERVICE_NETWORK` — Garage, Service & Parts
  - Service Network
  - Garage Operations
  - Parts & Provenance / PartSentry
- `BU_FINANCIAL_SERVICES` — Finance, Payments & Insurance
  - Finance / Lending Product
  - Payments / Escrow Product
  - Insurance Product & Partner Ecosystem
- `BU_DIASPORA_TRADE` — Diaspora Trade & Logistics
  - Trade Operations
  - Trade Compliance Operations
  - Logistics / Container Services

#### Corporate Functions
- `CF_FINANCE_ACCOUNTING` — Finance & Accounting
- `CF_CUSTOMERS_GROWTH` — Customers & Growth
  - Marketing & Acquisition
  - Customer Communications
- `CF_TRUST_RISK_COMPLIANCE` — Trust / Risk / Compliance
  - Identity & Verification
  - Evidence / Trust Governance
  - Fraud / Risk
  - Compliance Oversight
- `CF_DATA_INTELLIGENCE` — Data & Intelligence
- `CF_LEGAL_GOVERNANCE` — Legal / Governance
- `CF_PEOPLE_ADMIN` — People & Administration

#### Platform / Technology
- `CF_PLATFORM_TECH`
  - Platform Operations
  - Security
  - AI / Model Operations
  - Data Engineering
  - Feature Governance
  - Integrations

### 13.1 Mapping to canonical Corporate Admin top-level IA

| Canonical Corporate Admin domain | Organisational source |
| --- | --- |
| Corporate Overview | `CARUP_CORPORATE` consolidated view |
| Business Units | The four proposed MVP BUs plus future confirmed BUs |
| Finance | `CF_FINANCE_ACCOUNTING` with BU contributions; not `BU_FINANCIAL_SERVICES` alone |
| Customers & Growth | `CF_CUSTOMERS_GROWTH` |
| Operations | Cross-BU operating view over BU-owned workflows |
| Trust / Risk / Compliance | `CF_TRUST_RISK_COMPLIANCE` |
| Data & Intelligence | `CF_DATA_INTELLIGENCE` |
| People & Access | `CF_PEOPLE_ADMIN` + CA-RBAC authority |
| Reports | Cross-unit reporting governed by CA-REPORT |
| Platform | `CF_PLATFORM_TECH` |

This structure can support the canonical IA without asserting a legal subsidiary for any product domain.

---

## 14. Organisational ownership rules for downstream agents

1. A product domain has exactly one **primary internal organisational home** once confirmed, even if services are shared.
2. A BU may consume a central function without containing a duplicate copy of that function.
3. A central control function may govern a BU process without becoming the BU operating owner.
4. External participants are never children of internal organisational units.
5. Product/provider records may be associated with a BU for reporting, but that relationship does not imply ownership of the external company.
6. Legal entity scope and BU scope are separate dimensions.
7. Cost/profit centres may map to organisational units but are independently governed accounting dimensions.
8. Metric business ownership, data stewardship and control ownership may point to different organisational units.
9. Organisational hierarchy does not itself grant permissions.
10. K2B provenance status is independent of organisational ownership.

---

## 15. Owner Decision Register

Every unresolved business decision identified by CA-ORG-01 is registered here.

| Decision ID | Question | Why it matters | Affected downstream agents | Safe default while unresolved | MUST NOT be assumed |
| --- | --- | --- | --- | --- | --- |
| `OD-CAORG-001` | Is CarUp currently one legal company or multiple legal entities? | Required for statutory/consolidated reporting and legal-entity hierarchy | CA-RBAC, CA-METRIC, CA-FIN, CA-BU, CA-REPORT | Use conceptual `CARUP_CORPORATE` root with legal status UNKNOWN | Do not create or name legal entities from product domains |
| `OD-CAORG-002` | Which, if any, product domains are or are intended to become legal subsidiaries? | Determines legal hierarchy versus management BU hierarchy | CA-FIN, CA-BU, CA-REPORT, CA-RBAC | Treat every product-domain unit as non-legal BUSINESS_UNIT proposal | Do not label Marketplace, Diaspora, Finance, etc. subsidiaries |
| `OD-CAORG-003` | Is Marketplace a standalone BU, parent commercial platform, or part of a broader commerce BU? | Determines first-level management accountability | CA-BU, CA-METRIC, CA-UX, CA-REPORT | Use `BU_MARKETPLACE` as MVP management BU | Do not infer parent-company status from route breadth |
| `OD-CAORG-004` | Is Dealer / Vehicle Commerce a separate BU or a department/product line of Marketplace? | Affects dealer scorecards, leadership and P&L scope | CA-BU, CA-METRIC, CA-RBAC | Department/product line inside `BU_MARKETPLACE` | Do not turn external dealerships into internal units |
| `OD-CAORG-005` | Is Garage & Service a standalone BU? | Determines service-network accountability and reporting | CA-BU, CA-METRIC, CA-RBAC | Use `BU_SERVICE_NETWORK` as MVP BU | Do not treat external garages as internal branches |
| `OD-CAORG-006` | Is Parts/PartSentry a BU, department, or shared governed capability? | Affects parts commerce versus provenance/control ownership | CA-BU, CA-METRIC, CA-RBAC | Parts & Provenance department in `BU_SERVICE_NETWORK` with Trust/Risk governance matrix | Do not make PartSentry a second Trust authority |
| `OD-CAORG-007` | Is Diaspora Trade a BU, legal subsidiary candidate, or programme/product line? | Determines trade accountability, P&L and reporting hierarchy | CA-BU, CA-FIN, CA-METRIC, CA-REPORT | Use `BU_DIASPORA_TRADE` as non-legal MVP BU | Do not claim incorporation or subsidiary status |
| `OD-CAORG-008` | Is Logistics / Container Services inside Diaspora Trade or an independent BU? | Affects logistics scorecards, operations and provider ownership | CA-BU, CA-METRIC, CA-RBAC | Department inside `BU_DIASPORA_TRADE` | Do not infer a standalone logistics company |
| `OD-CAORG-009` | Does Finance/Payments represent a broad internal financial-services BU or only product/payment capabilities around external providers? | Determines BU scope and future financial-services accountability | CA-FIN, CA-BU, CA-METRIC, CA-RBAC | Use `BU_FINANCIAL_SERVICES` for product ownership only; keep external providers external | Do not confuse product finance with corporate Finance & Accounting |
| `OD-CAORG-010` | Is Insurance a separate BU, a department of Financial Services, or primarily a partner ecosystem? | Determines scorecard/P&L and provider-relationship ownership | CA-BU, CA-METRIC, CA-FIN | Insurance Product department inside `BU_FINANCIAL_SERVICES` | Do not classify insurers themselves as internal |
| `OD-CAORG-011` | Which countries/regions should be explicit MVP corporate reporting scopes? | Needed for geography filters, assignments and regional reporting | CA-RBAC, CA-METRIC, CA-FIN, CA-REPORT, CA-UX | Support REGION/COUNTRY dimension generically; do not hard-code organisational regions | Do not infer corporate operating regions from user addresses or single trade corridors |
| `OD-CAORG-012` | Which units should carry P&L/profit-centre responsibility? | Required for BU contribution and management accounting | CA-FIN, CA-BU, CA-METRIC, CA-REPORT | Mark four MVP BUs as P&L candidates only | Do not present BU revenue/margin/accounting ownership until CA-FIN authority exists |
| `OD-CAORG-013` | Which proposed corporate functions are formally central/shared today versus target-state functions? | Distinguishes current organisation from target architecture | CA-RBAC, CA-BU, CA-UX | Treat listed functions as target-state central functions for architecture only | Do not claim current departments/employees exist from product modules |
| `OD-CAORG-014` | Which leadership titles/positions exist now versus planned? | Needed for position mapping and reporting ownership, but titles must not become permissions | CA-RBAC, CA-BU, CA-REPORT | Use `BU_LEAD`, `FUNCTION_LEAD`, `DEPARTMENT_MANAGER` placeholders | Do not invent CEO/CFO/Director assignments or incumbents |
| `OD-CAORG-015` | What is the authoritative legal/display name of the top internal corporate entity? | Required before Corporate Admin exposes legal/company identity | CA-UX, CA-FIN, CA-REPORT, CA-RBAC | Display conceptual label “CarUp Corporate” in architecture documentation only | Do not equate brand name with legal entity name |
| `OD-CAORG-016` | Should Marketing & Communications be a department of Customers & Growth or an independent central function? | Affects campaign/customer communication ownership | CA-GROWTH, CA-RBAC, CA-BU, CA-UX | Department inside `CF_CUSTOMERS_GROWTH` | Do not merge business communications with technical delivery infrastructure |
| `OD-CAORG-017` | Should Security be structurally independent from Platform/Technology or a Platform department with independent escalation? | Security independence affects governance and reporting | CA-RBAC, CA-PLAT, CA-CERT | Platform Security function with independent escalation/control relationship | Do not treat Platform Admin as Security authority by default |
| `OD-CAORG-018` | Where should Data Engineering and AI/Model governance split between Data & Intelligence and Platform? | Prevents duplicated data/model ownership | CA-METRIC, CA-PLAT, CA-RBAC | Data Engineering and runtime Model Ops under Platform; business metric/data governance under Data & Intelligence | Do not merge runtime telemetry with corporate analytics |
| `OD-CAORG-019` | Who owns customer Communications business operations versus communications infrastructure? | Current service spans customer and platform planes | CA-GROWTH, CA-PLAT, CA-BU, CA-RBAC | Business/customer comms under Customers & Growth; delivery/provider operations under Platform | Do not create one generic “Communications” authority |
| `OD-CAORG-020` | Does CarUp have a distinct Legal / Governance function today, and what is its scope? | Required for legal/compliance/governance accountability | CA-RBAC, CA-REPORT, CA-BU | Keep as proposed central function with no claimed staff/incumbency | Do not infer legal department existence from governance code |
| `OD-CAORG-021` | What cost-centre and profit-centre granularity should MVP support? | Drives finance/reporting drill-down | CA-FIN, CA-METRIC, CA-REPORT | Allow mapping at BU/function/department levels conceptually | Do not equate every department with a cost/profit centre |
| `OD-CAORG-022` | What authoritative source will establish internal CarUp corporate membership and organisational placement? | Existing tenant/user role models are not sufficient | CA-RBAC, CA-CERT | Treat corporate membership as a separate future authority | Do not reuse `tenant_users` or `users.role` automatically |
| `OD-CAORG-023` | How should employees who also operate in external tenants/partner contexts be represented organisationally? | Needed to prevent authority and identity collision | CA-RBAC, CA-CERT | Keep internal placement and external tenant/partner scopes separate | Do not convert tenant membership into corporate placement |
| `OD-CAORG-024` | What base/reporting currencies should Corporate Admin use, and how should multi-currency reporting be governed? | Required for consolidated financial reporting | CA-FIN, CA-METRIC, CA-REPORT | Preserve source currency; do not aggregate across currencies without governed FX authority | Do not infer currency from country or UI |
| `OD-CAORG-025` | What fiscal calendar/reporting periods apply? | Needed for management/accounting snapshots | CA-FIN, CA-METRIC, CA-REPORT | Use generic reporting-period dimension until defined | Do not assume calendar year equals fiscal year |
| `OD-CAORG-026` | What is the legal/accounting consolidation scope and are there intercompany relationships? | Required for group reporting if multiple legal entities exist | CA-FIN, CA-REPORT | No statutory consolidation assumptions | Do not create elimination/intercompany logic without legal/accounting authority |

---

## 16. Downstream inputs

### 16.1 CA-RBAC / CA-RBAC-01

CA-RBAC should consume:

- taxonomy and internal/external boundary from sections 3–4;
- home-unit, matrix-assignment and delegated-scope placement concepts from section 12;
- legal entity / BU / department / team ancestry as organisational scope inputs;
- the rule that `users.role`, `tenant_users` and external provider/partner authority are separate from corporate membership;
- OD-CAORG-017, 022 and 023 as blocking owner decisions for final access architecture.

CA-ORG does **not** define permission sets, data scopes or route gates.

### 16.2 CA-METRIC / CA-METRIC-01

CA-METRIC should consume:

- primary BU/function organisational homes for business ownership;
- separate metric business owner, data steward, reporting owner and control owner relationships;
- BU/department/region/cost/profit-centre dimensions;
- K2B as the provenance authority;
- OD-CAORG-003 through 013, 021, 024 and 025 where final metric attribution depends on Owner/finance decisions.

CA-ORG defines ownership dimensions, not formulas.

### 16.3 CA-FIN / CA-FIN-01

CA-FIN should consume:

- separation between legal entity, BU, department, cost centre and profit centre;
- separation between `CF_FINANCE_ACCOUNTING` and `BU_FINANCIAL_SERVICES`;
- four MVP BU P&L candidates only as architecture, not accounting facts;
- OD-CAORG-001, 002, 009, 010, 012, 021, 024, 025 and 026.

CA-ORG does not define revenue recognition, GMV, margin, tax, FX or consolidation formulas.

### 16.4 CA-BU

CA-BU should consume:

- proposed four-BU MVP structure;
- departments/product-line defaults;
- central shared-function relationships;
- external-participant boundary;
- Owner Decision IDs attached to each unresolved split.

BU scorecards should not create duplicate central functions or metric definitions.

### 16.5 CA-REPORT

CA-REPORT should consume:

- hierarchy dimensions;
- legal entity versus BU distinction;
- reporting owner relationships;
- region/currency/period/consolidation dimensions;
- Owner Decisions affecting historical snapshots and consolidation.

### 16.6 CA-UX

CA-UX should use the organisation model to:

- distinguish Corporate Overview from BU/function drill-down;
- render central functions once rather than duplicated under each BU;
- distinguish external partners/tenants from internal units;
- present finance product BU separately from corporate Finance & Accounting;
- keep Platform/Security separate from corporate executive/financial authority.

No final wireframe is created by CA-ORG.

---

## 17. Open risks and collisions

### 17.1 Legal-entity ambiguity

Repository/product evidence cannot establish legal entities or subsidiaries. OD-CAORG-001, 002 and 015 remain mandatory before any legal company hierarchy is presented as fact.

### 17.2 Tenant/corporate-membership collision

Current platform tenancy is mature enough to be tempting to reuse, but doing so would mix external dealerships/garages/institutions with internal company organisation. OD-CAORG-022 and 023 must remain explicit.

### 17.3 Finance name collision

“Finance” currently describes at least two different concepts:

- Finance/lending/payment product capability;
- corporate Finance & Accounting.

They must remain separate organisational nodes.

### 17.4 Communications ownership collision

Customer/business communications and provider/delivery technical operations share services but not management plane. OD-CAORG-019 must be resolved before final organisation/RBAC implementation.

### 17.5 Security independence

Security belongs in Platform IA today but may require independent control reporting. OD-CAORG-017 remains open.

### 17.6 Data / AI ownership collision

Data Engineering and Model Operations are technical platform responsibilities; metric semantics, lineage and business intelligence are Data & Intelligence responsibilities. OD-CAORG-018 resolves any final boundary.

### 17.7 K2B dependency

Organisational ownership does not make data operationally true. Metrics and reports depending on operational/test provenance remain `PENDING_K2B`.

---

## 18. Stop conditions encountered

The task encountered legal/business questions that cannot be proven from repository evidence. In accordance with the dispatch, these did **not** cause invented answers; they were converted into Owner Decision IDs with safe defaults.

No condition required product/database/RBAC mutation.

No K2B provenance logic was altered or duplicated.

---

## 19. Recommended next task

Subject to CA-MOD independent review of CA-ORG-01:

1. **CA-RBAC / CA-RBAC-01** should consume the organisation taxonomy and membership-placement model.
2. **CA-METRIC / CA-METRIC-01** should consume the organisational ownership and reporting dimensions.
3. Owner decisions may be resolved in parallel where CA-MOD/Owner chooses, especially OD-CAORG-001, 003–012, 017, 022 and 024–026.
4. **CA-CERT / CA-CERT-01** should later verify that organisation, RBAC, metrics and IA remain consistent before K3A implementation authority.

This document does not self-accept.

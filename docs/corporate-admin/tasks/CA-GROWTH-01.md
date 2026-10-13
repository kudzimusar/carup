# CA-GROWTH-01 — CUSTOMER / ACQUISITION / NAVIGATION / FUNNEL / RETENTION AUTHORITY MODEL

FROM: CA-MOD — Corporate Admin Programme Moderator
TO: CA-GROWTH — Customer & Growth Intelligence Agent
TASK: CA-GROWTH-01
PROGRAMME: CA-1.0

## Accepted authorities

- Canonical plan: 5d4997cacaff8068c4ec4c5ae78f562be4249344
- CA-ARCH-01 ACCEPTED: 7cae8c3c8c987714a8ca6db2128db3b9a589f141
- CA-ORG-01 ACCEPTED: 705eb6fa1cd89109977052e88e220f0498668060
- CA-RBAC-01 ACCEPTED: 4abdf95e1e1490b01f51cb45106a57fcf7b954b9
- CA-METRIC-01 ACCEPTED: 32c26ce5d89ec3829e2afa9248d1e77a2cb4c784
- CA-FIN-01 ACCEPTED: 9ba7388559fa13cf353e410ce2a62be30660bdeb
- Product snapshot for read-only inspection: 505ffcca6b641c8b3b55f503e0f4fd39d26710dc
- PC01-K2B-R2: ACTIVE / NOT YET ACCEPTED

Read in full:
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md
- docs/corporate-admin/CARUP_CORPORATE_ADMIN_CURRENT_STATE_MAP.md
- docs/corporate-admin/CARUP_CORPORATE_ORGANISATION_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_RBAC_MODEL.md
- docs/corporate-admin/CARUP_CORPORATE_METRIC_REGISTRY.md
- docs/corporate-admin/CARUP_CORPORATE_FINANCE_MODEL.md

## MODERATOR AUTHORITY

AUTHORIZED — CUSTOMER/GROWTH INTELLIGENCE ARCHITECTURE / DOCUMENTATION ONLY.

NO PRODUCT IMPLEMENTATION.
NO ANALYTICS EVENT MUTATION.
NO DATABASE MIGRATION.
NO COOKIE/TRACKING EXPANSION.
NO PII EXPANSION.
NO K2B PROVENANCE IMPLEMENTATION.
NO MARKETING AUTOMATION.
NO DASHBOARD IMPLEMENTATION.
NO PRODUCTION.

---

## 1. Objective

Establish the canonical Customer & Growth Intelligence authority model for Corporate Admin 1.0.

The output must determine what CarUp can truthfully say about:

- customers;
- registered and verified users;
- buyers, sellers, dealers, garages and institutional participants;
- active users/customers;
- acquisition sources;
- navigation and feature usage;
- searches and filter behaviour;
- buyer/seller/trade journeys;
- inquiries/leads;
- conversion;
- activation;
- retention/reactivation/churn;
- geography;
- referrals/campaigns;
- channel performance;
- business-unit customer contribution.

This task must prevent route views, sessions, guest inquiries, test users and unrelated tenant identities from being silently renamed into customers or conversions.

---

## 2. Binding semantic rules

Preserve:

- account != customer by default;
- session != customer;
- page/route view != customer;
- anonymous visitor != known customer;
- guest email != confirmed customer;
- inquiry != sale;
- save/watchlist != purchase;
- finance application != customer revenue;
- tenant != customer;
- partner organisation != consumer customer;
- provider/dealer/garage/government identity != internal CarUp employee;
- stage totals != linked cohort conversion;
- peak-day uniqueness != true period distinct users;
- route navigation != marketplace commercial outcome;
- test/UAT/CI/proof activity != business growth;
- UNKNOWN provenance is not silently counted;
- referral code presence != proven acquisition attribution without an attribution model.

---

## 3. Current identity / participant inventory

Inspect the accepted product snapshot and classify the identity constructs that currently exist, including where present:

- users;
- sessions;
- tenant_users / organisations;
- owner/seller identities;
- buyer identities;
- guest inquiry identities;
- dealer accounts/profiles;
- mechanic/garage accounts/profiles;
- finance/lender participants;
- insurer participants;
- government/reviewer roles;
- diaspora trade profiles;
- referral participants;
- anonymous navigation/session identifiers;
- communication participants;
- device/session/page-view identifiers.

For each define:

- identity key;
- whether it is authenticated;
- whether it is person, organisation, session, device or anonymous context;
- whether it can safely support a distinct-person/customer count;
- data classification;
- current provenance/K2B dependency;
- current BU/domain ownership.

---

## 4. Canonical customer taxonomy

Design the future governed taxonomy, without inventing counts.

At minimum distinguish:

- ACCOUNT
- KNOWN_PERSON
- REGISTERED_USER
- VERIFIED_PERSON
- CUSTOMER_CANDIDATE
- ACTIVE_CUSTOMER
- TRANSACTING_CUSTOMER
- BUYER
- SELLER
- DEALER_CUSTOMER
- GARAGE_SERVICE_CUSTOMER
- DIASPORA_TRADE_CUSTOMER
- FINANCE_PRODUCT_CUSTOMER
- INSURANCE_PRODUCT_CUSTOMER
- PARTNER_ORGANISATION
- INSTITUTIONAL_PARTICIPANT
- ANONYMOUS_VISITOR
- LEAD
- INQUIRY
- SESSION
- DEVICE

For each state what evidence is required before a record may enter that class.

Where business policy is unresolved, create OD-CAGROWTH decisions.

---

## 5. Active customer semantics

Do not invent one universal active-customer definition.

Define candidate models such as:

- authenticated activity;
- meaningful product action;
- commercial-intent activity;
- transaction/completion activity;
- BU-specific active customer;
- rolling 7/30/90-day activity.

Explain advantages/risks of each.

Recommend the architecture for a canonical Corporate active-customer metric while leaving the threshold/action set as Owner policy where necessary.

An active customer definition must identify:
- person/customer grain;
- qualifying actions;
- window;
- provenance exclusion;
- geography/BU attribution;
- identity reconciliation;
- anonymous treatment.

---

## 6. Acquisition authority

Inventory current acquisition/referral/marketing source evidence.

At minimum inspect:

- referral codes;
- campaign codes;
- source_channel;
- referral engine;
- Marketplace referral bridge;
- communication/marketing attribution where present;
- landing/navigation query/context;
- any UTM-like or campaign parameters;
- Diaspora/referral programme sources;
- first-touch / last-touch data if any.

Determine what can currently prove:

- referral participation;
- campaign association;
- acquisition source;
- conversion attribution;
- nothing sufficient.

Do not create an attribution model from incidental fields.

---

## 7. Navigation Intelligence boundary

Consume CA-METRIC.

Keep Navigation Intelligence separate from commercial outcome intelligence.

Inventory and define:

- route render/view;
- navigation impression;
- navigation selection;
- feature-entry click;
- search invocation;
- filter use;
- result-page view;
- zero-result event if actually available;
- deep-link navigation;
- authenticated versus anonymous activity;
- self_traffic;
- bot_suspect;
- staff/internal activity where identifiable;
- CI/UAT/proof/certification activity.

Determine which events can support:

- top routes;
- top features;
- navigation discoverability;
- selection-through;
- path progression;
- entry/exit analysis;
- feature adoption.

Do not reinterpret these as sales/conversion unless linked to authoritative commercial events.

Carry forward known constraints:
- 50,000-row bounded Navigation aggregation;
- zero-denominator selection-rate behavior;
- privacy-minimized/hashed search semantics where applicable.

---

## 8. Search / discovery intelligence

Define governed management semantics for:

- search submissions;
- normalized query signature/hash;
- human-readable search terms when actually retained;
- make/model/category filters;
- trust filters;
- geography filters;
- price filters;
- zero-result searches;
- result count distribution;
- filter-to-detail progression;
- detail-to-save/inquiry progression.

Explicitly state where raw search text is unavailable and must not be reconstructed.

Prepare future metric definitions for demand discovery without expanding privacy collection.

---

## 9. Funnel authority

Define canonical funnel architecture.

Funnels must require stage-linkable identity/process authority, not just unrelated stage totals.

Potential funnels to evaluate:

### Buyer
Landing/entry → Search/Discover → Results → Vehicle Detail → Save/Inquiry → Reservation → Payment/Deposit → Completed Transaction

### Seller
Sell entry → Draft started → Vehicle/document capture → Readiness → Publishable → Published → Inquiry received → Reservation → Completed transaction

### Verify
Verify entry → identifier submitted → record found/not found → evidence/passport viewed → next governed action

### Trade
Trade entry → profile/intent → RFQ/import order → quote → accepted commercial step → shipment/logistics → governed completion

### Dealer/Garage
relevant product entry → action → operational/commercial completion where authority exists.

For each stage classify:
- authoritative event/source;
- linked identity/process ID;
- current availability;
- provenance dependency;
- whether conversion can truthfully be computed today.

Do not call a ratio conversion if stages are not linked.

---

## 10. Leads and inquiries

Define:

- lead;
- inquiry initiated;
- inquiry completed/recorded;
- qualified lead if supportable;
- duplicate inquiry handling;
- guest inquiry handling;
- lead owner/business-unit assignment.

Do not equate inquiry with customer or sale.

Determine whether current Marketplace inquiries can support lead metrics once K2B is accepted.

---

## 11. Activation

Design activation as a BU/product-specific first-value concept.

Examples to evaluate, not automatically accept:
- buyer activation: first meaningful vehicle-detail/save/inquiry action;
- seller activation: first publishable/published listing;
- Verify activation: first successful governed check;
- Trade activation: first valid trade profile/order/RFQ milestone;
- Dealer/Garage activation: first governed inventory/service operation.

Create Owner decisions where the business must choose the activation milestone.

---

## 12. Retention / reactivation / churn

Determine what current event history can and cannot support.

Define future governed concepts for:

- new cohort;
- retained customer;
- returning customer;
- reactivated customer;
- dormant customer;
- churned customer;
- cohort retention;
- repeat buyer/seller/service customer;
- BU-level retention versus Corporate retention.

Each must specify:
- identity grain;
- qualifying activity;
- cohort date;
- observation windows;
- excluded provenance;
- treatment of anonymous and account-only activity.

Do not invent churn without a business-defined inactivity policy.

---

## 13. Geography

Inventory possible current geography sources:

- declared profile country/region;
- vehicle/listing location;
- trade origin/destination;
- tenant/organisation geography;
- IP/network-derived geography if it exists;
- billing/provider geography;
- shipment/logistics locations.

Classify whether each describes:
- customer home/location;
- transaction location;
- vehicle location;
- business unit market;
- origin/destination;
- technical request location.

Do not infer customer geography from vehicle location or Trade destination by default.

Do not introduce new precise-location collection.

---

## 14. Customer value / finance boundary

Consume CA-FIN.

Do NOT produce:
- customer revenue;
- LTV;
- CAC;
- ROAS;
- ARPU;
- revenue per customer;
- margin per customer;
- payback period;

unless both finance authority and customer/attribution authority exist.

Instead define the source prerequisites and mark the metrics unavailable/PENDING_CA_FIN.

Referral reward or marketing spend does not by itself establish CAC.

---

## 15. Business-unit customer ownership

Consume CA-ORG.

Define how one person may be:
- one Corporate customer;
- a Marketplace buyer;
- a Marketplace seller;
- a Trade customer;
- a Garage customer;
- a Finance-product applicant;
- an Insurance-product participant;

without being double-counted in Corporate distinct-customer metrics.

Design the distinction between:
- Corporate distinct customer;
- BU customer;
- product relationship;
- cross-BU customer.

Do not choose customer-master identity implementation here.

---

## 16. Growth scorecard architecture

Prepare candidate metric families for CA-UX and CA-BU.

At minimum:

### Corporate
- known customers;
- active customers;
- new customers;
- returning/reactivated customers;
- BU customer contribution;
- geography;
- acquisition mix;
- meaningful product activity;
- lead/inquiry flow;
- governed funnel progression;
- retention candidate metrics.

### Marketplace / Buy
- search/discovery users;
- result/detail engagement;
- saves;
- inquiries;
- buyer/seller activation;
- published supply;
- linked funnel progression where proven.

### Verify
- checks initiated/completed;
- records found/not found;
- evidence/passport engagement;
- follow-on actions.

### Sell
- drafts started;
- capture/readiness progression;
- publishable/published;
- inquiry received;
- time-to-publish candidate.

### Trade
- Trade entrants;
- profiles/orders/RFQs;
- quote progression;
- shipment/logistics stages;
- repeat trade activity.

Do not activate a metric if source/identity linkage is absent.

---

## 17. Rankings / top-performing views

Because the Owner explicitly requires clicks/top ranks/strategic business planning, define governed ranking semantics.

Possible ranking dimensions:
- top routes/features by valid human interaction;
- top vehicle makes/models by discovery interest;
- top listings by governed engagement;
- top filters;
- top BU/product journeys;
- top acquisition channels;
- top regions where customer geography is authoritative;
- fastest-growing governed cohorts;
- highest-converting linked journeys.

Every rank must specify:
- population;
- metric;
- period;
- minimum denominator/sample rule;
- provenance exclusions;
- tie behavior;
- whether it is volume, rate, growth or value.

No 'top' label without a defined ranking metric.

---

## 18. Privacy / RBAC

Consume CA-RBAC.

Separate:
- aggregate growth intelligence;
- identifiable customer records;
- PII;
- communication content;
- identity/KYC evidence;
- raw navigation/session data;
- marketing export.

Executive aggregate access must not automatically grant PII/drill-down.

Do not expand data collection merely because Corporate Admin would find it useful.

---

## 19. K2B boundary

PC01-K2B-R2 is active/unaccepted at dispatch.

CA-GROWTH may define which metrics require operational provenance and mark them PENDING_K2B.

CA-GROWTH must not:
- adopt unaccepted K2B counts;
- classify staging rows;
- implement provenance;
- create another classifier;
- treat UNKNOWN as operational.

---

## 20. Owner Decision Register

Create OD-CAGROWTH-* decisions covering at minimum:

- canonical customer definition;
- active customer definition;
- paying/transacting customer definition;
- buyer/seller relationship definition;
- guest-to-customer treatment;
- anonymous visitor inclusion;
- staff/internal traffic policy;
- customer geography authority;
- activation milestones by BU;
- buyer funnel stages;
- seller funnel stages;
- Verify funnel stages;
- Trade funnel stages;
- qualified lead definition;
- duplicate inquiry handling;
- attribution model;
- attribution window;
- first-touch vs last-touch vs multi-touch;
- referral ownership;
- retention activity definition;
- retention windows;
- churn/dormancy policy;
- reactivation policy;
- cross-BU customer identity;
- ranking denominator/sample policy;
- top-search privacy policy;
- cohort timezone/date policy;
- cross-device identity policy;
- marketing opt-in/export policy;
- growth target ownership;
- growth baseline/variance policy.

Every decision must include safe default and what must not be assumed.

---

## 21. Required deliverable

Create only:

docs/corporate-admin/CARUP_CUSTOMER_GROWTH_INTELLIGENCE_MODEL.md

Must include:
1. authority/custody;
2. current identity/participant inventory;
3. customer taxonomy;
4. active-customer architecture;
5. acquisition/attribution authority;
6. Navigation Intelligence boundary;
7. search/discovery semantics;
8. funnel authority maps;
9. leads/inquiries semantics;
10. activation model;
11. retention/reactivation/churn model;
12. geography authority;
13. finance/LTV/CAC boundary;
14. cross-BU customer identity model;
15. growth scorecard architecture;
16. rankings/top-performance semantics;
17. privacy/RBAC mapping;
18. PENDING_K2B register;
19. PENDING_CA_FIN register;
20. Owner Decision Register;
21. downstream inputs for CA-UX, CA-BU, CA-REPORT, CA-CERT;
22. open risks;
23. recommended next task.

---

## 22. Evidence rules

Distinguish:
PROVEN CURRENT GROWTH/IDENTITY FACT
PROPOSED GOVERNED GROWTH SEMANTIC
PENDING_K2B
PENDING_CA_FIN
OWNER DECISION REQUIRED

Do not convert technical activity into business success.
Do not expose secrets or unnecessary PII.

---

## 23. Repository scope

AUTHORIZED MUTATION:
docs/corporate-admin/**

READ-ONLY INSPECTION:
web/**
backend/**
shared/**
database schema/migration history
accepted docs

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

---

## 24. Stop conditions

STOP rather than guess if:
- customer identity cannot be established;
- a conversion requires unlinked stage totals;
- attribution policy is absent;
- retention/churn requires business policy;
- geography would require an unsafe inference;
- a metric depends on unaccepted K2B;
- a financial growth metric depends on unavailable CA-FIN authority;
- product/database mutation appears necessary.

---

## 25. Return receipt

AGENT: CA-GROWTH
TASK: CA-GROWTH-01
EXACT STARTING AUTHORITIES
EXACT RESULTING AUTHORITY
FILES / SYSTEMS INSPECTED
FILES CHANGED
PROVEN CURRENT GROWTH FACTS
PROPOSED CUSTOMER/GROWTH AUTHORITY MODEL
PENDING_K2B ITEMS
PENDING_CA_FIN ITEMS
OWNER DECISIONS REQUIRED
OPEN QUESTIONS
DOWNSTREAM INPUTS
STOP CONDITIONS
RECOMMENDED NEXT AGENT/TASK

Final line exactly:

CA-GROWTH-01 CUSTOMER & GROWTH INTELLIGENCE MODEL READY FOR MODERATOR REVIEW

Do not self-accept.
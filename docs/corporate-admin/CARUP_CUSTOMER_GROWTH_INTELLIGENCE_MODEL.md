# CARUP CUSTOMER & GROWTH INTELLIGENCE MODEL

Programme: CA-1.0 — CarUp Corporate Admin 1.0  
Agent: CA-GROWTH — Customer & Growth Intelligence Authority Agent  
Task: CA-GROWTH-01  
Status: CA-MOD ACCEPTED — CUSTOMER/GROWTH AUTHORITY / DOCUMENTATION ONLY — K2B DEPENDENCY RECUSTODIED

## 1. Authority and custody

This model is produced under the following exact authorities:

- Canonical programme plan: \`docs/corporate-admin/CARUP_CORPORATE_ADMIN_1_0_CANONICAL_PLAN.md\`
- Canonical programme authority: \`5d4997cacaff8068c4ec4c5ae78f562be4249344\`
- Accepted CA-ARCH-01 authority: \`7cae8c3c8c987714a8ca6db2128db3b9a589f141\`
- Accepted CA-ORG-01 authority: \`705eb6fa1cd89109977052e88e220f0498668060\`
- Accepted CA-RBAC-01 authority: \`4abdf95e1e1490b01f51cb45106a57fcf7b954b9\`
- Accepted CA-METRIC-01 authority: \`32c26ce5d89ec3829e2afa9248d1e77a2cb4c784\`
- Accepted CA-FIN-01 authority: \`9ba7388559fa13cf353e410ce2a62be30660bdeb\`
- Documentation starting head: \`5e667b17250dbbaff113bfff424c91ae67916d53\`
- Product/reference snapshot inspected read-only: \`505ffcca6b641c8b3b55f503e0f4fd39d26710dc\`
- Accepted operational-provenance dependency: **PC01-K2B-R2 — ACCEPTED / FROZEN @ `7b34dec1bc9f05b72b6abf0104db65980f280a0b`**

The live PR #222 advanced beyond the supplied product snapshot during execution. CA-GROWTH-01 remained pinned to `505ffcca6b641c8b3b55f503e0f4fd39d26710dc` for product/source inspection. After the specialist return, CA-MOD independently accepted PC01-K2B-R2 at `7b34dec1bc9f05b72b6abf0104db65980f280a0b`. This recustody consumes only K2B's accepted provenance/publication semantics as a downstream authority; it does **not** substitute the later PR #222 product tree for the product snapshot inspected by CA-GROWTH.

This document establishes customer, growth, funnel, cohort, attribution and behavioural-intelligence semantics only. It does **not** build dashboards, add analytics instrumentation, change event schemas, alter product code, modify database schema, create migrations, mutate K2B, classify current rows, expose PII, or activate blocked Corporate KPIs.

---

## 2. Executive conclusion

### 2.1 What CarUp can currently prove

At the inspected authority, CarUp can prove several distinct identity and relationship facts:

- a base registered CarUp account exists;
- a session-authenticated account identity exists for a request;
- a current governed identity-verification lifecycle exists per account;
- a person/account can hold one or more verified tenant memberships;
- a Marketplace inquiry can be submitted by an authenticated buyer or by a guest contact;
- a governed Marketplace transaction can identify an authenticated buyer and current seller;
- a saved vehicle can be tied to an authenticated account;
- a service work order can carry a \`customer_id\`;
- a dealer profile can represent an external dealer business identity and compliance lifecycle;
- a Diaspora Trade profile can represent an authenticated user's trade role in a country;
- a Trade order can identify a buyer and participants;
- lender/insurer records can identify applicants/consenting users and external provider institutions;
- referral/campaign/source codes can be attached to governed events or inquiries;
- Marketplace behavioural activity can be linked by opaque pseudonymous session keys, page-view IDs, authenticated user IDs where proven, listing IDs and business object IDs;
- Navigation Intelligence can prove privacy-minimized route/feature/navigation activity;
- Communications can prove conversation participation and its own workflow/funnel states.

Those facts do **not** create one canonical Corporate customer entity by themselves.

### 2.2 What CarUp cannot currently truthfully claim

At this authority, CarUp does not have one accepted source that proves:

- total Corporate distinct customers;
- active Corporate customers;
- transacting Corporate customers;
- retained Corporate customers;
- churned Corporate customers;
- reactivated Corporate customers;
- paying customers;
- cross-BU distinct people where duplicate CarUp accounts belong to the same real-world person;
- one universal conversion rate;
- one universal customer funnel;
- customer acquisition source under an accepted first/last/multi-touch model;
- CAC;
- LTV;
- ROAS;
- ARPU;
- revenue per customer;
- profit per customer;
- human-readable top free-text search terms;
- true multi-day Marketplace unique shoppers from the existing peak-day projection;
- unique visitors from Navigation Intelligence;
- a linked Navigation-route → commercial-outcome conversion.

The correct Corporate state for those concepts is **BLOCKED**, **PENDING_K2B_CONSUMPTION**, **PENDING_CA_FIN**, or **UNAVAILABLE_NOT_SEPARABLE** as specified below.

### 2.3 Governing rule

**CarUp must distinguish identity, audience, relationship, activity and commercial outcome.**

A person can be:

- a registered account holder without being a customer;
- a verified person without being a customer;
- a buyer in one journey and a seller in another;
- a customer of more than one CarUp business unit;
- a member of an external dealer/garage tenant without being an internal CarUp employee;
- an anonymous/pseudonymous visitor before any known-person relationship exists.

The Corporate customer layer must be a governed relationship model above those proven facts, not a relabeling of any one product table.

---

## 3. Non-negotiable semantic separations

These rules are binding for every Corporate Admin surface and report:

- **account ≠ customer**
- **registered user ≠ customer**
- **verified person ≠ customer**
- **session ≠ customer**
- **analytics session ≠ authenticated session**
- **page view ≠ customer**
- **route render ≠ unique visitor**
- **navigation selection ≠ business conversion**
- **feature route render ≠ feature completion**
- **search ≠ customer**
- **search ≠ inquiry**
- **inquiry ≠ sale**
- **lead ≠ customer unless the Owner-approved customer rule says so**
- **guest email ≠ confirmed customer**
- **guest phone ≠ confirmed customer**
- **tenant ≠ customer**
- **tenant member ≠ customer**
- **dealer profile ≠ customer**
- **garage tenant ≠ customer**
- **provider institution ≠ customer**
- **institutional participant ≠ customer**
- **referral code present ≠ acquired customer**
- **campaign code present ≠ campaign-caused conversion**
- **UTM/source field ≠ attribution policy**
- **stage totals ≠ linked funnel conversion**
- **communications conversion status ≠ completed commercial sale**
- **Marketplace listing sold status ≠ accounting revenue**
- **completed operational journey ≠ paying customer**
- **peak-day unique ≠ period unique**
- **pseudonymous session key ≠ durable device identity**
- **source geography ≠ customer residence**
- **trade corridor ≠ customer geography**
- **listing location ≠ customer location**
- **raw click count ≠ customer growth**
- **high activity ≠ high customer value**
- **rank by events ≠ strategic importance**
- **sandbox/test activity ≠ Corporate Actual**
- **customer count ≠ sum of BU customer counts**

---

## 4. Customer and identity grain taxonomy

### 4.1 Canonical conceptual taxonomy

| Entity / relationship | Canonical meaning | Current source candidate | Customer by itself? | Corporate count status |
| --- | --- | --- | --- | --- |
| \`ACCOUNT\` | One base CarUp account identity, normally one \`users.id\`. | \`users\` | **No** | Account count candidate; PENDING_K2B_CONSUMPTION |
| \`KNOWN_PERSON\` | A person linked to a proven CarUp identity subject. | Account + governed identity layer | **No** | Cross-account person resolution not established |
| \`REGISTERED_USER\` | An account with a persisted CarUp registration/account row. | \`users\` | **No** | Candidate account-level metric |
| \`VERIFIED_PERSON\` | A person/account whose **current** identity lifecycle is capability-bearing. | \`identity_lifecycle_events\` + governed historical verification fallback | **No** | Candidate only after customer grain decision |
| \`CUSTOMER_CANDIDATE\` | Known person/org with qualifying commercial/customer relationship evidence but not yet meeting Owner customer definition. | Domain-specific | Not yet | Domain relationship only |
| \`CUSTOMER\` | A Corporate subject satisfying the Owner-approved customer relationship definition. | Future governed customer semantic over source domains | **Yes** | BLOCKED pending Owner definition |
| \`ACTIVE_CUSTOMER\` | A defined customer with ≥1 approved qualifying activity in the approved activity window. | Future governed customer + linked activity | Yes | BLOCKED |
| \`TRANSACTING_CUSTOMER\` | A defined customer participating in an Owner-approved transaction state, with domain authority and provenance. | Domain transaction authority | Yes | BLOCKED cross-company; domain-specific candidate |
| \`BUYER\` | Role/relationship of a participant seeking/acquiring a vehicle/service/trade outcome. | Marketplace buyer IDs, Trade buyer IDs, domain records | Not automatically | Relationship fact |
| \`SELLER\` | Role/relationship of the governed seller/supplier in a commercial journey. | \`current_seller_id\`, Trade quote/seller role | Not automatically | Relationship fact |
| \`DEALER_CUSTOMER\` | Customer relationship within Dealer/Vehicle Commerce; **not** synonymous with dealer business profile. | Marketplace dealer-scoped relationships; completed dealer commerce absent | Depends Owner definition | BLOCKED |
| \`GARAGE_SERVICE_CUSTOMER\` | Known customer relationship represented by governed service/work-order authority. | \`mechanic_work_orders.customer_id\`; service case linkage where available | Domain candidate | PENDING_K2B_CONSUMPTION / identity completeness |
| \`DIASPORA_TRADE_CUSTOMER\` | Known buyer/customer relationship to a governed Trade request/order, not every Trade participant. | \`diaspora_import_orders.buyer_id\`, buyer-owned RFQ/order | Domain candidate | PENDING_K2B_CONSUMPTION |
| \`FINANCE_PRODUCT_CUSTOMER\` | Person with qualifying customer-facing finance-product relationship under Owner rule. | finance application/consent/decision | Not merely applicant by default | BLOCKED customer policy |
| \`INSURANCE_PRODUCT_CUSTOMER\` | Person with qualifying customer-facing insurance relationship under Owner rule. | insurance consent/policy/product records | Not merely eligibility outcome | BLOCKED customer policy |
| \`PARTNER_ORGANISATION\` | External organization integrated/commercially partnered with CarUp. | partner/provider/tenant sources | Not automatically | External organization relationship |
| \`INSTITUTIONAL_PARTICIPANT\` | Bank, insurer, government agency, regulator, provider or other institution participating in CarUp processes. | provider registry, institutional profiles, tenants/orgs | Not automatically | External participant |
| \`ANONYMOUS_VISITOR\` | Unknown person interacting without proven account identity. | Behavioural observations only | **No** | Audience/activity only |
| \`LEAD\` | Governed pre-transaction prospect/lead record under a named domain. | referral lead, qualified inquiry or domain lead authority | Not automatically | Lead metric by source |
| \`INQUIRY\` | Persisted request/question/intent row with its own domain lifecycle. | \`marketplace_inquiries\` | **No** | Governed event/entity count |
| \`SESSION\` | Bounded interaction/authentication context; subtype must be stated. | auth \`user_sessions\`; Marketplace pseudonymous session | **No** | Session count only |
| \`DEVICE\` | A durable governed device identity. | No accepted canonical source | **No** | UNAVAILABLE_NO_SOURCE |

### 4.2 ACCOUNT

The base \`users\` table proves account existence.

It can include customers, sellers, dealers, mechanics, insurer/bank/government users, administrators, staff or operational users, and test/UAT/fixture accounts pending provenance classification.

Therefore \`corporate.account.registered.count\` may be defined as an account metric after K2B, but it must not be labelled “customers” or “users acquired” without additional policy.

### 4.3 REGISTERED USER

“Registered user” is an account-level term.

Minimum proof:

- persisted \`users.id\`;
- account registration exists under the current auth/account contract;
- row is eligible under accepted provenance rules.

A registration profile enriches context but is not required to prove the base account exists.

### 4.4 VERIFIED PERSON

The preferred current authority is the **current identity lifecycle**, not the legacy \`users.is_verified\` boolean by itself.

Current identity states include:

- \`verified\`;
- \`recovered\`;
- \`reverification_required\`;
- \`suspended\`;
- \`compromised\`;
- \`disputed\`;
- \`revoked\`;
- \`not_established\`.

Capability-bearing states are \`verified\` and \`recovered\`.

Therefore a Corporate “currently verified person” candidate should use the governed lifecycle semantic once CA-MOD/Owner accepts it.

A verified person still is **not automatically a customer**.

Owner decision: \`OD-CAGROWTH-006\`.

### 4.5 KNOWN PERSON and the cross-account gap

Current product identity is primarily keyed by \`users.id\`.

CarUp does **not** currently prove that two separate CarUp account IDs cannot belong to the same real-world person.

Therefore:

- the same **account** can be deduplicated across BUs today;
- the same **real person with multiple accounts** cannot be safely deduplicated into one Corporate person from current sources.

A future Corporate distinct-person metric needs a governed person-resolution authority, not email/name matching.

Never deduplicate people by same email domain, similar name, phone normalization alone, IP address, device/session key or tenant membership.

Owner decision: \`OD-CAGROWTH-007\`.

---

## 5. Buyer, seller and customer relationships

### 5.1 BUYER

Buyer is a **domain relationship**, not a permanent platform role.

Marketplace buyer authority can be proven from:

- authenticated \`buyer_id\` on a governed inquiry;
- transaction \`buyer_id\`;
- reservation \`buyer_id\`.

Diaspora Trade buyer authority can be proven from:

- \`diaspora_import_orders.buyer_id\`;
- buyer-owned RFQ/order;
- explicit Trade participant role where applicable.

A guest inquiry with no authenticated \`buyer_id\` proves an **inquirer**, not a confirmed buyer person.

### 5.2 SELLER

Marketplace seller authority uses the governed current seller relationship:

- \`vehicles.current_seller_id\`;
- current seller type/provenance;
- transaction \`seller_id\`.

\`owner_id\` is not a seller fallback.

Trade supplier/seller authority may come from Trade profile role, quote \`seller_id\`, and RFQ supplier relationship.

Seller is not automatically a customer; supply-side customer treatment is an Owner business decision.

### 5.3 Customer direction

Corporate customer semantics must declare whether CarUp counts:

- demand-side customers only;
- supply-side customers too;
- external organizations that buy platform services;
- institutional partners as customers where they have paid/commercial relationships;
- both people and organizations, with separate grains.

Until resolved, Corporate Admin must not publish one “customers” number.

Owner decisions: \`OD-CAGROWTH-001\` through \`OD-CAGROWTH-005\`.

---

## 6. Domain customer relationships

### 6.1 Marketplace / Vehicle Commerce customer

Possible proven relationship stages:

1. known authenticated shopper;
2. saver;
3. inquiry submitter;
4. purchase-interest buyer;
5. transaction participant;
6. reservation participant;
7. settled transaction participant.

These are **different facts**.

Safe default:

- account + passive browse → not customer;
- save → engaged known user, not automatically customer;
- inquiry → customer candidate/lead, not sale;
- reservation → transaction participant;
- settled live transaction → strongest purchase relationship, but Corporate customer/transacting definition remains Owner-governed and PENDING_K2B_CONSUMPTION.

### 6.2 Dealer customer

“Dealer customer” is ambiguous and must be split:

1. **customer of a dealer through CarUp** — demand-side Marketplace person interacting with dealer-owned inventory;
2. **dealer as a CarUp business customer** — external dealer organization consuming CarUp platform/service capabilities.

These are different grains.

Current repository proves dealer business profiles and dealer-scoped Marketplace activity/inquiries, but no authoritative completed dealer sales metric.

Therefore neither may be silently called “dealer customers” in Corporate reporting without an explicit definition.

Owner decision: \`OD-CAGROWTH-008\`.

### 6.3 Garage/service customer

Current service sources include work orders with \`customer_id\`.

That supports:

- identified service customer count at the work-order grain;
- repeat identified service customer count within a defined service window.

It does not automatically support:

- Corporate distinct customer;
- lifetime customer relationship;
- unique people when \`customer_id\` is missing;
- customer satisfaction;
- profit per customer.

Service cases support request/accept/complete operational funnel metrics, but case-level conversion is not a person-level customer conversion unless a governed customer identity link exists.

### 6.4 Diaspora Trade customer

A Trade profile proves a role and geography in the Trade domain.

A Trade order with \`buyer_id\` proves a buyer relationship.

Recommended safe hierarchy:

- Trade profile only → Trade participant;
- buyer-owned request/order → Trade customer candidate;
- Owner-approved qualifying active order/RFQ/accepted commercial step → candidate active Trade customer;
- operational completion may support a completed Trade journey, but finance/payment status is separately governed by CA-FIN.

### 6.5 Finance product customer

A finance application or eligibility request proves finance-product intent/engagement.

It does not prove disbursement, paying relationship, CarUp revenue or completed finance transaction.

Whether applicant, approved applicant or disbursed borrower qualifies as a CarUp customer is Owner policy.

### 6.6 Insurance product customer

Insurance eligibility/policy/product records can prove product engagement.

They do not prove premium payment or CarUp revenue.

Owner must define whether quote requester, policyholder, active policy holder or insurer partner counts as a customer and at which grain.

### 6.7 Institutional participant

Banks, lenders, insurers, government agencies, regulators and other providers can exist in provider registry, institutional profile tables, tenants, partner APIs and organization records.

Institutional participation is not customer status.

Government/regulator must never be called a customer merely because it has an account, tenant or platform integration.

---

## 7. Anonymous visitor, session, page view and device

### 7.1 Anonymous visitor

Marketplace activity can record an \`actor_scope='anonymous'\` event with a pseudonymous session key.

This proves anonymous behavioural activity, not a durable person.

A session may later contain authenticated activity, but identity attribution across anonymous history remains governed and must respect privacy/attribution policy.

### 7.2 Two different session concepts

CarUp currently has at least two semantically different session concepts.

**Authentication session**

- source: \`user_sessions\`;
- identifies a validated account session;
- carries expiry/validity/selected organization.

**Marketplace analytics session**

- source: opaque \`pseudonymous_session_key\`;
- random and privacy-minimized;
- supports behavioural linkage;
- stored by the web client and cleared on logout;
- not derived from user identity.

Every metric must say which session grain it uses.

### 7.3 Page view

Marketplace activity uses \`page_view_id\` as a route/screen interaction unit.

It rotates on route transitions.

It is valid for page-view-scoped de-duplication, impression/open linkage and journey analysis.

It is not a customer, device, household or unique person.

### 7.4 Device

There is no accepted durable device identity.

The Marketplace pseudonymous session key must not be renamed “device ID”.

Navigation Intelligence intentionally does not persist device/user/session identity.

Therefore device-level reach/frequency is unavailable.

---

## 8. Lead and inquiry semantics

### 8.1 INQUIRY

\`marketplace_inquiries\` is the authority for Marketplace inquiries.

An inquiry may contain authenticated \`buyer_id\` or guest contact fields, seller and seller tenant, inquiry type, referral/campaign/source channel, lifecycle status, risk status and bounded attribution metadata.

A guest email or phone proves only contact information supplied for that inquiry.

It does not prove unique real person, registered user, verified person, customer or sale.

### 8.2 LEAD

A lead is a named pre-transaction prospect/workflow entity.

Current examples include:

- Marketplace qualifying inquiry;
- referral local-marketplace lead;
- dealer-scoped lead/inquiry workflow.

A referral-attributed Marketplace inquiry may bridge into the canonical referral lead flow.

This proves **lead creation**, not conversion to customer or sale.

### 8.3 Lead qualification

Lead status such as \`qualified\` is the domain workflow state.

It is not transaction completion, payment, revenue or customer activation unless Owner explicitly defines activation that way.

---

## 9. Current acquisition and attribution evidence

### 9.1 Available first-party attribution fields

Current sources can carry:

- \`referral_code\`;
- \`campaign_code\`;
- \`source_channel\`;
- bounded UTM/source metadata on inquiries;
- campaign/referral association on Marketplace activity events;
- referral code/campaign IDs in referral events;
- Communications \`acquisition_source\`, referral code and campaign code;
- campaign-delivery state in Communications.

These fields prove **recorded association**.

They do not prove causal acquisition.

### 9.2 Referral code authority

Referral code validation can prove code identity, code owner, campaign association, validity, channel and whether a specific inquiry/lead was referral-attributed.

The Marketplace referral bridge derives attribution server-side and creates at most one linked lead per inquiry.

That is a strong **association** source.

It does not choose first touch, last touch, last non-direct, multi-touch, weighted touch, attribution window or cross-device attribution.

### 9.3 Campaign code authority

A campaign code on an event/inquiry proves that the recorded action carried that code.

It does not prove the campaign caused the inquiry, customer, transaction or revenue.

### 9.4 UTM/source

UTM/source metadata is useful acquisition context.

It must be treated as client/request-supplied attribution context, bounded by coverage and quality, and not identity authority.

### 9.5 Attribution model required

Before CarUp may say “customers acquired by channel”, “campaign conversion”, “referral conversion”, “organic customer” or “best acquisition channel”, the Owner must approve:

- conversion target;
- touch model;
- lookback window;
- direct-traffic handling;
- anonymous→authenticated linkage policy;
- multi-device/cross-session rules;
- source precedence;
- missing-attribution treatment;
- campaign/referral conflicts.

Until then, report **associated events/inquiries by recorded source**, not acquired customers.

---

## 10. Navigation Intelligence boundary

### 10.1 What Navigation Intelligence is

Navigation Intelligence is a separate privacy-minimized telemetry system.

It records registered feature/navigation taxonomy such as:

- surface opened;
- item impression;
- item selected;
- destination rendered;
- destination blocked;
- role switched;
- drawer opened;
- tab selected;
- navigation error.

It stores bounded feature/node/route-pattern values and coarse role category.

It deliberately does **not** persist user ID, customer ID, tenant ID, device ID, names, email, phone, raw URL or IP address.

### 10.2 What it can answer

Subject to completeness/K2B:

- which registered navigation items were shown most;
- which were selected most;
- which registered route patterns rendered most;
- platform split of recorded navigation;
- blocked navigation attempts by reason;
- navigation errors;
- discovery/select-through activity.

### 10.3 What it cannot answer

Navigation Intelligence cannot by itself prove unique visitors, customers, conversion, retention, customer geography, customer acquisition, commercial outcome, Verify completion, Trade order completion or Marketplace inquiry/sale.

### 10.4 50,000-row bound

Current aggregate reads are capped at **50,000 events** and aggregate in memory.

Corporate rule:

- if the requested window is proven complete below the cap, aggregate may be used;
- if the cap is reached and completeness is not proven, the metric must become **DEGRADED/UNAVAILABLE**, never silently truncated.

No ranking or rate based on a silently truncated window may be certified.

### 10.5 Zero-denominator selection-through rate

The current Navigation helper can return numeric zero where impressions are zero.

Corporate semantics must replace this with \`not_applicable\` or \`insufficient_data\` for zero denominator.

Zero must mean measured zero selections in an eligible denominator, not “division was impossible”.

### 10.6 Navigation versus business outcome

Examples:

- selecting Verify navigation → **Verify discoverability**, not verification usage/completion;
- rendering \`/marketplace\` → route activity, not Marketplace shopper/customer;
- selecting Trade route → Trade discoverability, not RFQ/order;
- rendering Finance route → feature access, not finance applicant;
- rendering Garage route → route activity, not service request.

Navigation Intelligence remains separate from commercial/process authorities.

---

## 11. Marketplace behavioural intelligence

### 11.1 Canonical observation ledger

\`marketplace_activity_events\` is the governed observation store for Marketplace behaviour.

It explicitly does not replace business authorities.

It can record searches, zero-result searches, listing impressions, listing opens, engaged views, inquiry starts, compare actions, contact clicks, shares, saves/unsaves, authoritative inquiry observations, inspection requests, reservation events, listing lifecycle observations and process-step observations.

### 11.2 Identity and linkage

The ledger can carry anonymous/authenticated/system actor scope, pseudonymous session key, authenticated user ID where proven, page-view ID, listing/vehicle, object ID/type, campaign/referral/source channel.

This supports linked journeys where the same governed link key is present.

### 11.3 Exclusions

Current taxonomy supports flags such as staff, fixture, bot suspect, synthetic and seller self-traffic.

Corporate activation remains **PENDING_K2B_CONSUMPTION** until the accepted provenance authority defines eligible business rows.

---

## 12. Governed behaviour semantics

### 12.1 Route views

**Source:** Navigation \`navigation_destination_rendered\`.

Meaning: registered destination route rendered.

Do not call page views unless the exact route-view semantic is stated; do not call unique visitors, customers or visits/sessions.

Metric candidate: \`growth.navigation.route_render.count\`.

Status: **PENDING_K2B_CONSUMPTION + completeness guard**.

### 12.2 Navigation impressions

**Source:** \`navigation_item_impression\`.

Meaning: registered navigation item was presented under current client de-duplication rules.

It is not a Marketplace listing impression.

### 12.3 Navigation selections

**Source:** \`navigation_item_selected\`.

Meaning: registered navigation item selected.

Selection-through rate must state numerator, impression denominator, scope, completeness and zero-denominator handling.

### 12.4 Feature usage

A route render/select can establish **feature discovery/access activity** only.

A business feature's true use must come from its domain authority.

Examples:

- Verify use → identifier/passport workflow, not just route render;
- Marketplace use → search/detail/save/inquiry domain observations;
- Trade use → RFQ/order/quote domain facts;
- Service use → service request/case/work order.

### 12.5 Searches

Marketplace search event semantics:

- a real search requires free-text query and/or structured filter;
- bare listing browse is not a search;
- session key is required;
- result count is captured;
- zero-result search is separately emitted.

Search is **expressed demand**, not customer or sale.

### 12.6 Free-text search terms

Free-text query is stored as a normalized **hash**, not raw text.

Therefore:

- hashed search-signature frequency may be ranked;
- human-readable “top search terms” are **UNAVAILABLE_NOT_SEPARABLE**;
- CarUp must not attempt dictionary reversal/reconstruction of hashes;
- structured filters can support human-readable demand categories.

### 12.7 Filters

Structured allowlisted filters include, where present, make, condition, category, sort, minimum price, maximum price and tag(s).

Filter use can support demand analysis such as most selected makes, price-band interest, category demand and zero-result supply gaps.

A filter count is not a customer count.

### 12.8 Vehicle detail views

**Canonical behaviour source:** \`marketplace_listing_opened\`.

The emitter excludes prefetch, requires session/page context, records measurable undercount when context is absent, and can carry campaign/referral association.

A listing open is stronger than a Navigation route render for Marketplace demand.

### 12.9 Listing impressions

\`marketplace_listing_impression\` is a result/list presentation observation.

It supports result exposure, position/rank response and impression→detail analysis where linkage is present.

It is not a unique shopper by itself.

### 12.10 Saves

Current \`saved_vehicles\` is the authoritative current saved-state source.

Save/unsave activity events observe actual authoritative changes.

Use cases include current watchlist, saves in window, save rate and repeat engagement.

A save is not purchase intent equal to an inquiry and is not a sale.

### 12.11 Inquiries

Authority: \`marketplace_inquiries\`.

Use: lead/inquiry volume, inquiry type, source/referral/campaign coverage, seller/tenant demand and lifecycle status.

Do not infer sale or revenue.

### 12.12 Contact clicks and inquiry starts

Client interaction events such as contact clicked and inquiry modal opened are **intent/friction signals**.

Only the persisted inquiry row proves an inquiry was created.

### 12.13 Compare/share

Compare and share events are engagement/discovery signals.

They may help rank demand/consideration but are not conversions by themselves.

---

## 13. Unique visitor/shopper semantics

### 13.1 Daily unique Marketplace actor

Current Marketplace rollups can derive daily unique actors/link keys.

This is usable only with the exact daily grain, exact link-key rule and K2B/exclusion certification.

### 13.2 Multi-day current limitation

Current 7/30/90 “unique” projection uses the **maximum daily unique** across the window.

Its basis is \`peak_day\`.

That is **not true period uniqueness**.

Corporate surfaces must label it as \`peak_daily_unique_viewers\`, \`peak_daily_unique_shoppers\` or equivalent explicit peak-day language.

Never label it unique visitors this month, monthly unique customers or 30-day unique shoppers.

### 13.3 True period distinct

A true period-distinct metric must deduplicate the same governed actor/link key across the entire period.

If that read model is not available/certified, true period unique is unavailable.

### 13.4 Navigation uniqueness

Navigation events do not retain a visitor/session key.

Therefore Navigation cannot produce true unique visitors under the current privacy contract.

---

## 14. Funnel architecture

### 14.1 Rule

There is no metric named simply **conversion**.

Every funnel rate must define:

- domain/journey;
- stage A;
- stage B;
- link key;
- cohort entry rule;
- time window;
- maximum allowed elapsed time if applicable;
- exclusion/provenance policy;
- denominator;
- minimum denominator;
- treatment of repeated stage events;
- completion semantics.

### 14.2 Linked conversion

A linked conversion asks:

> Of entities that entered stage A, how many of those **same linked entities/processes** reached stage B under the declared rule?

Acceptable link keys can include session + listing, page-view + listing, authenticated user + listing, inquiry ID, transaction intent ID, reservation ID, Trade order ID, quote ID, service case ID and work-order ID.

Independent stage totals cannot substitute for linkage.

### 14.3 Current false-conversion risk

Some current projections divide independent totals, such as inquiries in a period by views in a period.

Those can be useful **activity ratios** if explicitly labelled.

They may exceed 100% because inquiries can arrive through paths without measured views.

They must not be called linked conversion.

---

## 15. Buyer / Marketplace funnel

### 15.1 Canonical stage map

Proposed analytical stage vocabulary:

1. \`MARKETPLACE_ENTRY\`
2. \`SEARCH_PERFORMED\`
3. \`LISTING_IMPRESSION\`
4. \`LISTING_OPENED\`
5. \`ENGAGED\`
6. \`SAVED\`
7. \`INQUIRY_STARTED\`
8. \`INQUIRY_CREATED\`
9. \`PURCHASE_INQUIRY_CURRENT\`
10. \`TRANSACTION_INTENT_CREATED\`
11. \`RESERVATION_ACTIVE\`
12. \`PAYMENT_INTENT_CREATED\`
13. \`FUNDS_HELD\`
14. \`RELEASE_APPROVED\`
15. \`SETTLED\`
16. \`RESERVATION_COMPLETED\`

### 15.2 Current linkage

**Navigation entry → Marketplace activity**

Current Navigation telemetry intentionally contains no customer/session identifier. Therefore route render/select cannot currently be linked to a specific Marketplace commercial outcome.

Result:

- entry route counts can be shown separately;
- Navigation → Marketplace conversion is **UNAVAILABLE_NOT_SEPARABLE**.

**Search → impression**

Can be linked where the same Marketplace pseudonymous session and page-view/search context exist, the listing impression belongs to the resulting list and coverage is certified.

**Impression → detail**

Can be linked by same session, listing ID and temporal/page lineage.

**Detail → save/inquiry**

Current web client threads session/page-view context into server requests, allowing governed linkage where recorded.

**Inquiry → transaction**

Strong business linkage exists through inquiry ID, buyer ID, seller ID and VIN/listing.

**Transaction → reservation/payment**

Strong linkage exists through transaction intent and reservation/payment fields.

### 15.3 Settlement caveat

At the inspected finance authority, live external money is not currently certified.

A settled sandbox transaction cannot become Corporate Actual customer conversion.

CA-FIN remains controlling for payment/revenue semantics.

---

## 16. Seller funnel

### 16.1 Proposed stages

1. sell entry;
2. listing/draft created;
3. vehicle/document evidence captured;
4. readiness evaluated;
5. publishable;
6. published;
7. inquiry received;
8. qualified/current purchase inquiry;
9. reservation;
10. governed transaction;
11. settlement/completion.

### 16.2 Current authority

Use business sources, not Navigation, for seller progress:

- vehicle/listing authority;
- evidence/readiness authority;
- publication status/transitions;
- Marketplace inquiry seller/seller-tenant;
- transaction/reservation authority.

Marketplace activity events may observe listing-created/submitted/published/sold transitions, but the business row remains authoritative.

### 16.3 Dealer sales limitation

Current Dealer Intelligence explicitly has no authoritative completed dealer sale/value source suitable for dealer sales/revenue KPIs.

Therefore:

- published listing → not sale;
- listing disappears → not sale;
- status Sold without validated transaction context → do not infer revenue;
- dealer inquiry → not customer sale.

---

## 17. Verify journey

### 17.1 Product surface

The registered \`product.verify\` feature routes to \`/search\`.

Current Vehicle Search/Verify supports exact VIN lookup, protected identifier lookup with authentication requirements, public Passport match, history-only match where a record exists but is not currently listed, and Marketplace make/model discovery.

### 17.2 Navigation evidence

Navigation can measure Verify feature impression/selection and \`/search\` destination render.

That proves discoverability only.

### 17.3 Outcome evidence gap

No dedicated current growth event authority was found that fully links:

1. Verify entry;
2. identifier submitted;
3. lookup attempted;
4. record found/not found/indeterminate;
5. Passport opened;
6. next action.

The product API can return governed lookup outcomes, but CA-GROWTH must not manufacture a funnel from route renders plus unrelated vehicle requests.

Therefore:

- Verify route usage → measurable via Navigation, PENDING_K2B_CONSUMPTION;
- Verify submitted searches/outcomes → **requires dedicated governed process/source linkage or accepted existing authority mapping**;
- Verify conversion → **UNAVAILABLE_NOT_SEPARABLE** today.

Owner decision: \`OD-CAGROWTH-025\`.

---

## 18. Diaspora Trade funnel

### 18.1 Proposed stages

1. Trade entry;
2. Trade profile / buyer identity established;
3. buyer request/order created;
4. RFQ published;
5. supplier quote submitted;
6. quote accepted;
7. seller assigned/commercial progression;
8. logistics/container stage;
9. shipment stage;
10. operational order completion.

### 18.2 Strong current process linkage

Trade sources have durable IDs: order ID, buyer ID, participant IDs, quote ID, accepted quote ID and container/shipment IDs.

Quote acceptance is an atomic governed operation:

- order locked;
- buyer/owner authority verified;
- one submitted quote accepted;
- sibling quotes rejected;
- order stamped with accepted quote;
- audit written.

Therefore domain funnel counts can use process-linked records.

### 18.3 Finance boundary

Trade quote/order completion does not establish live payment, revenue or settled trade value.

Those remain CA-FIN controlled.

### 18.4 Navigation boundary

Trade route renders cannot currently be linked to Trade orders because Navigation telemetry does not carry customer/session identifiers.

Report route demand and process funnel separately.

---

## 19. Garage / Service funnel

### 19.1 Process funnel

Current service authority supports case stages such as service request, accepted/declined, active/started and completed/cancelled.

A booking conversion can be computed at the **service-case grain** where defined.

That is not automatically a customer conversion.

### 19.2 Customer identity

Work orders can carry \`customer_id\`.

This allows identified service customers in a defined work-order window and repeat identified service customers.

Rows without customer ID must not be assigned to the requester, vehicle owner, current session user or garage tenant member as a convenience.

### 19.3 Garage organization scope

Garage intelligence is organization/tenant scoped.

A mechanic's personal activity must not be substituted for the garage's organization activity.

The same service row may legitimately contribute to both person and organization operational views while remaining one underlying case/order.

---

## 20. Dealer funnel

Dealer/Vehicle Commerce can use dealer profile/compliance lifecycle, governed inventory/listing publication, seller-scoped inquiries and Marketplace transaction records where linked.

Current authority does not support dealer revenue, units sold from a certified dealer-sale source, customer satisfaction or promotion ROI where no governed cost/outcome exists.

Dealer growth should therefore focus on real supply/demand/process measures rather than fabricated sales value.

---

## 21. Referral and campaign funnel

### 21.1 Candidate stages

1. code/campaign exposed or shared where instrumentation exists;
2. code validated;
3. attributed Marketplace/Trade lead;
4. inquiry/order;
5. qualified domain outcome;
6. Owner-defined customer activation;
7. finance-approved economic outcome if applicable.

### 21.2 Required linkage

A campaign/referral funnel must join by governed code ID, campaign ID, subject/inquiry ID, user/customer subject when allowed and conversion object ID.

A count of campaign events divided by all inquiries is not conversion unless the same cohort is linked.

### 21.3 Referral event log caution

\`referral_events\` is a shared event store and may contain non-referral event families.

Corporate referral reporting must count an explicit referral-domain event taxonomy, not every row in the table.

---

## 22. Activation

### 22.1 Definition architecture

Activation is the **first Owner-approved value-realization event** for a defined customer relationship.

It is not automatically registration, first login, first page view, identity verification, first search or first save.

### 22.2 Possible domain activation candidates

These are candidates only, not accepted policy:

- Marketplace buyer: first qualifying inquiry, reservation or completed transaction;
- Marketplace seller: first governed published listing;
- Garage Service: first accepted/completed service case;
- Diaspora Trade: first published RFQ/order or accepted quote;
- Finance: first qualifying application/approved product state;
- Insurance: first qualifying policy/product state;
- business tenant: first governed productive operation.

Owner must select the exact value event per customer type/BU.

### 22.3 Corporate activation

Corporate activation must not sum BU activations.

One Corporate customer can activate in multiple BUs.

Recommended conceptual outputs:

- \`corporate.customer.first_activation_at\` — first qualifying CarUp customer activation;
- \`customer_bu_activation\` — separate per-BU activation relationship.

No schema is implemented here.

---

## 23. Active customer

### 23.1 Required definition

An active customer needs all of:

1. a governed customer subject;
2. approved customer relationship;
3. approved qualifying activity set;
4. activity window;
5. provenance eligibility;
6. exclusion policy;
7. BU/Corporate scope.

Without those, “monthly active customers” is not valid.

### 23.2 Qualified activity hierarchy

A future Owner policy may classify activities into levels:

**Discovery**
- search;
- detail open;
- compare;
- Verify access.

**Engagement**
- save;
- share;
- contact click.

**Commercial intent**
- inquiry;
- service request;
- RFQ/order;
- finance/insurance application.

**Operational/commercial progression**
- accepted case;
- published listing;
- quote submitted/accepted;
- reservation;
- transaction state.

**Completed outcome**
- completed service/order/transaction under domain authority.

CA-GROWTH does not decide which levels qualify an active customer.

### 23.3 Anonymous activity

Anonymous activity can be reported as anonymous sessions, anonymous search/detail activity and anonymous audience demand.

It cannot create an active customer until a governed customer subject exists.

---

## 24. Transacting customer

A transacting customer must be defined by an Owner-approved business state.

Possible domain states differ:

- Marketplace transaction/reservation/settlement;
- service accepted/completed case;
- Trade accepted quote/order progression/completion;
- finance product lifecycle;
- insurance policy/product lifecycle.

There is no one current universal “transaction” table covering all BUs.

Corporate transacting-customer count therefore remains **BLOCKED** until customer grain is defined, per-BU qualifying transaction states are defined, cross-BU deduplication exists and K2B is accepted.

A payment intent alone never qualifies.

---

## 25. Retention

### 25.1 Required architecture

Retention requires customer subject, activation/cohort entry, qualifying ongoing activity, observation window, return window, BU scope and provenance completeness.

A retained customer must be the **same linked customer subject** across periods.

### 25.2 Do not substitute

Do not call:

- repeat page views → retention;
- repeat pseudonymous sessions → customer retention;
- repeat inquiries from an unlinked guest email → retained customer;
- returning tenant requests → retained person;
- two work orders with missing customer IDs → repeat customers.

### 25.3 Domain retention

Domain-specific repeat behaviour may be measured honestly:

- repeat identified service customer;
- repeat Trade buyer;
- repeat seller publisher;
- repeat known Marketplace shopper.

Those require distinct metric names and should not be generalized into Corporate customer retention without the customer model.

---

## 26. Reactivation

Reactivation requires:

1. customer previously qualified as active;
2. customer then met Owner-defined inactivity/churn condition;
3. same governed subject later performs qualifying reactivation activity.

A mere login after inactivity is not reactivation unless policy says login qualifies.

Reactivation must be scoped Corporate, BU or product.

---

## 27. Churn

### 27.1 Customer churn

Corporate customer churn is currently **BLOCKED**.

It requires Owner decisions on customer relationship, active window, grace period, explicit cancellation versus behavioral inactivity, terminal versus reversible churn and BU aggregation.

### 27.2 Inactivity is not churn

“Inactive for 30 days” must not be labelled churn unless the Owner defines that threshold and population.

### 27.3 Domain churn

Some domains can support separately named churn concepts, such as subscription cancellation/lapse.

Those remain domain-specific and cannot be substituted for Corporate customer churn.

---

## 28. Customer geography

### 28.1 Geography sources

Current source candidates include:

**Registration profile**
- country of residence;
- city;
- province;
- market relationship.

**Dealer profile**
- operating country;
- business address.

**Trade profile**
- country;
- city;
- role-specific trade location.

**Trade order**
- origin country/city;
- destination country/city.

**Inquiry**
- optional country/contact context.

**Listing**
- vehicle/listing location.

These are not interchangeable.

### 28.2 Corporate customer location

A Corporate customer geography metric must specify residence, operating/business location, transaction origin, transaction destination or activity location.

“Where customers are” should normally mean a governed customer geography attribute, not where an asset/shipment is.

### 28.3 IP address

Authentication/security tables may contain IP addresses.

CA-GROWTH does not authorize using security IP telemetry as customer geography.

Any such use would require explicit privacy, legal and RBAC approval.

### 28.4 Trade corridor

Japan → Zimbabwe or any other Trade corridor is **demand corridor geography**, not customer residence.

### 28.5 Missing geography

Unknown geography remains unknown.

Do not infer from phone prefix, email domain, tenant address, listing location, shipment destination or browser IP without authority.

---

## 29. Time intelligence

Strategic question:

**When does activity happen?**

Valid time dimensions may include hour of day, day of week, calendar day/week/month, event-to-next-stage latency, response time and order/service turnaround.

Every metric must state timestamp authority, timezone, window and late-event rule.

Marketplace event \`occurred_at\` is not automatically customer local time.

Owner must choose reporting timezone and any customer-local-time treatment.

---

## 30. Demand intelligence

### 30.1 Valid demand signals

Current real signals include:

- Marketplace searches;
- zero-result searches;
- filter use;
- listing impressions/opens;
- saves;
- inquiries;
- inspection requests;
- service requests;
- vehicle make/model demand in service work;
- Trade RFQs/orders;
- submitted supplier quotes;
- Trade corridor demand;
- parts/service marketplace activity where governed source exists.

### 30.2 Demand hierarchy

Demand should be labelled by strength:

- discovery demand;
- consideration;
- commercial intent;
- transaction/process progression;
- completed outcome.

Do not combine all into one “demand score” without an Owner-approved model.

### 30.3 Zero-result demand

Zero-result searches are a supply-gap signal.

They do not prove lost sale, lost revenue or lost customer.

Use “unmet recorded search demand” or equivalent.

---

## 31. Top routes, features and rankings

### 31.1 Ranking contract

Every ranking must state:

- ranked object;
- ranking measure;
- window;
- completeness;
- tie rule;
- minimum sample;
- exclusion/provenance;
- whether rank is event-, session-, customer-, transaction- or revenue-based.

### 31.2 Top routes

Candidate: count of \`navigation_destination_rendered\` by registered route pattern.

Label:

**Top rendered routes by recorded Navigation events**

Not top customer journeys, most popular with customers or unique visitors.

50,000-row completeness guard applies.

### 31.3 Top navigation features

Candidate measures:

- impressions;
- selections;
- successful renders.

Keep them separate.

A feature can rank high in impressions and low in selections.

### 31.4 Top Marketplace listings

Possible rankings:

- impressions;
- opens;
- saves;
- inquiries;
- inspection requests.

Each is a different question.

Do not create one blended “top listing” rank without approved weighting.

### 31.5 Top searches

Allowed:

- structured filter demand;
- hashed search-signature frequency.

Not available:

- raw human-readable free-text top terms.

### 31.6 Top geographies

Possible rankings must state geography type:

- customer residence;
- Trade origin;
- Trade destination;
- dealer operating country;
- inquiry country.

Never merge them under “Top customer countries”.

### 31.7 Rank change

A “rank up/down” indicator requires a comparable prior window with the same metric version, population, completeness and provenance policy.

No decorative arrows without a computed comparison.

---

## 32. Which journey performs best?

“Best journey” is meaningless without an outcome.

Permitted comparison patterns include:

- highest linked search→detail progression;
- highest linked detail→inquiry progression;
- lowest drop-off at a named stage;
- shortest median time to a named governed outcome;
- highest service request→accept rate;
- highest Trade request→submitted-quote rate.

Not permitted without CA-FIN:

- best revenue journey;
- highest-LTV journey;
- best ROAS;
- most profitable funnel.

Comparisons must use like-for-like funnel definition, window, population and attribution/provenance.

---

## 33. Where do people drop out?

### 33.1 Drop-off semantics

For linked stages A→B:

\`dropoff = eligible linked A cohort − same linked subjects/processes reaching B\`

Drop-off rate:

\`1 − linked_conversion_rate\`

Only valid when stage linkage is complete enough to define the cohort.

### 33.2 Independent totals

If only independent stage totals exist:

- show both counts;
- optionally show an explicitly named activity ratio;
- do not call the difference “drop-off”.

### 33.3 Process versus customer drop-off

Trade/order or service-case drop-off may be computed at **process grain** even if person-level customer identity is absent.

Label accordingly:

- RFQ process drop-off;
- service-case drop-off;
- transaction-intent drop-off.

Do not call it customer churn.

---

## 34. Which business unit is growing?

BU growth cannot be represented by one universal scalar today.

A BU growth scorecard should use a small family of governed measures.

### Marketplace & Vehicle Commerce

- published supply;
- searches;
- detail opens;
- saves;
- inquiries;
- linked transaction/reservation progression.

### Garage, Service & Parts

- service requests;
- accepted/completed cases;
- identified/repeat service customers;
- work orders;
- parts/RFQ demand where governed.

### Finance, Payments & Insurance

- product applications/requests;
- live provider demand separated from sandbox;
- eligible/approved product outcomes where governed;
- no revenue growth until CA-FIN.

### Diaspora Trade & Logistics

- buyer requests/orders;
- published RFQs;
- submitted quotes;
- accepted quotes;
- shipment/order progression;
- route/corridor demand;
- no settled trade value/revenue until CA-FIN.

Corporate Admin may compare **growth rates for comparable metric families**, but must not create a synthetic “BU Growth Score” without Owner weighting/policy.

Owner decision: \`OD-CAGROWTH-036\`.

---

## 35. Cohorts

### 35.1 Cohort requirements

A cohort must have:

- immutable cohort-entry rule;
- subject grain;
- cohort date/window;
- qualification rule;
- subsequent measured action;
- retention horizon;
- provenance policy.

### 35.2 Candidate cohorts

Potential cohorts:

- registration cohort;
- first verified-identity cohort;
- first customer-activation cohort;
- first Marketplace inquiry cohort;
- first seller publication cohort;
- first service request cohort;
- first Trade order/RFQ cohort;
- campaign-associated cohort;
- referral-associated cohort.

### 35.3 Customer cohort caveat

Until \`CUSTOMER\` is defined, customer cohorts remain blocked.

Registration cohorts are account cohorts, not customer cohorts.

---

## 36. Cross-BU customer identity

### 36.1 One person, several BUs

The same governed person/account may participate in Marketplace, Service, Diaspora Trade, Finance and Insurance.

Corporate distinct-customer logic must count that subject **once**, while BU customer metrics can count the relationship once per BU.

Example conceptual model:

- Corporate subject: \`C123\`
- Marketplace relationship: yes
- Service relationship: yes
- Trade relationship: yes

Results:

- Corporate distinct customers: +1
- Marketplace customers: +1
- Service customers: +1
- Trade customers: +1
- Sum of BU customers: 3 and **must not be presented as Corporate distinct customers**.

### 36.2 Cross-account limitation

Current source can deduplicate the same \`users.id\` across BUs.

It cannot safely merge multiple account IDs belonging to the same person.

Therefore exact real-person Corporate distinct customer remains blocked until a person-resolution authority exists.

### 36.3 Organization customers

Organizations and people must remain separate subject grains.

If the Owner wants one combined “customer entities” measure, the definition must state that it mixes people and organizations.

Default: report separately.

---

## 37. Strategic Customer & Growth scorecard architecture

### Tier 1 — Corporate customer health

Blocked until customer definition:

- distinct customers;
- active customers;
- newly activated customers;
- retained customers;
- reactivated customers;
- churned customers.

### Tier 2 — Demand and acquisition

Candidate governed metrics:

- Marketplace searches;
- zero-result rate;
- detail opens;
- saves;
- inquiries;
- referral-associated inquiries;
- campaign-associated inquiries;
- Trade requests/RFQs;
- service requests.

All Corporate Actual operational counts: **PENDING_K2B_CONSUMPTION**.

### Tier 3 — Journey performance

Use linked process metrics:

- impression→detail;
- detail→save;
- detail→inquiry;
- inquiry→transaction;
- transaction→reservation;
- service request→accepted;
- Trade RFQ→quote;
- Trade quote→accepted.

Only where linkage is proven.

### Tier 4 — Product discoverability

Navigation:

- feature impressions;
- selections;
- route renders;
- blocked routes;
- navigation errors.

Keep separate from Tier 3 business outcomes.

### Tier 5 — Geography/time

- customer geography after customer authority;
- inquiry geography;
- Trade corridors;
- operating geography;
- hourly/daily activity.

### Tier 6 — Economic customer intelligence

**BLOCKED by CA-FIN + customer/attribution authority:**

- CAC;
- LTV;
- ARPU;
- revenue per customer;
- profit per customer;
- ROAS;
- contribution margin per customer/channel.

---

## 38. Vanity-metric guard

A metric is not a management KPI merely because it is large or easy to count.

### 38.1 Context metrics

Usually context rather than standalone KPI:

- raw clicks;
- page/route renders;
- navigation impressions;
- message volume;
- total sessions;
- total registered accounts.

### 38.2 Management relevance test

A Customer/Growth KPI should answer at least one:

- Are we acquiring the right customers?
- Are qualified customers progressing?
- Are customers returning?
- Where is demand unmet?
- Which BU/customer journey is improving?
- Where is the process failing?
- Where does customer activity concentrate?
- Is growth source/segment sustainable?

If the source cannot answer the management question, use a lower-confidence/context label.

---

## 39. Customer geography and rankings privacy

Executive/customer-growth aggregates may show counts/rates by governed geography, cohorts and source/channel summaries.

They do not imply permission to view person name, email, phone, guest contact details, raw navigation/session rows, raw referral history by person, private Trade participant records or finance/insurance applicant detail.

Consume CA-RBAC.

Aggregate permission and line-item/PII permission are separate.

---

## 40. PII and behavioural access

### 40.1 Marketplace activity

Authenticated user ID and pseudonymous session key are internal-only.

Seller surfaces should receive aggregates, not viewer identities, unless a declared lead/inquiry workflow separately authorizes the identity.

### 40.2 Navigation

Navigation deliberately omits PII/session identity.

Corporate Admin must not attempt to enrich raw navigation rows with user identities as a shortcut.

### 40.3 Guest inquiries

Guest contact detail is Restricted customer/contact data.

An executive growth aggregate does not imply access to the underlying guest email/phone.

### 40.4 Exports

Customer-level export requires a separately authorized RBAC capability.

“Can view customer count” must never imply “can export customer identities”.

---

## 41. Retention and erasure implications

Marketplace activity raw retention is governed separately from business records.

Identity erasure can tombstone authenticated user linkage while preserving aggregate-compatible behavioural rows.

Consequences:

- historical aggregate may remain stable after identity erasure;
- person-level historical cohorts may lose attributable identity;
- an erased row must not be reclassified as an anonymous customer;
- retention/churn computations must document how erased identity is handled.

---

## 42. Accepted K2B operational-provenance boundary

PC01-K2B-R2 is **ACCEPTED / FROZEN** at:

`7b34dec1bc9f05b72b6abf0104db65980f280a0b`

CA-GROWTH now consumes K2B as the accepted authority for the distinction between:

- operational business records;
- non-operational test / UAT / CI / certification / seeded / legacy-synthetic records;
- UNKNOWN / needs-review records;
- canonical Marketplace publication truth.

This acceptance does **not** turn an operational account into a customer, an operational event into meaningful growth, or an operational transaction-stage record into revenue. Customer grain, qualifying activity, funnel linkage, attribution, retention and finance semantics remain governed by this document, CA-METRIC, CA-FIN and Owner Decisions.

For Corporate Actual, the safe provenance rule is now:

- include only records K2B classifies as operational for the relevant supported domain;
- exclude K2B non-operational classes from Corporate Actual;
- do not count UNKNOWN / needs-review as operational;
- preserve excluded/review populations for governed inspection rather than deleting them.

Where a Customer/Growth metric has **not yet been proven to consume the accepted K2B authority on its exact source path**, its state is:

**`PENDING_K2B_CONSUMPTION_CONSUMPTION`**

This is no longer a statement that K2B itself is unaccepted. It means the particular metric/source still needs source-path integration and certification against accepted K2B semantics.

This applies, as relevant, to:

- registered accounts used for business/customer metrics;
- Marketplace behavioural activity beyond already-converged Admin operational projections;
- saves;
- reservations/transactions;
- service records/work orders/cases;
- Trade profiles/orders/quotes;
- referral/campaign events;
- communications funnel data;
- finance/insurance product demand.

Marketplace inquiries and listing operational populations may consume K2B's accepted record-level provenance semantics, but Customer/Growth labels and funnel use still require the separate customer/grain/linkage rules in this model.

Navigation Intelligence remains a separate special case: K2B acceptance does not automatically prove record-level provenance for every Navigation event. Navigation Corporate Actual therefore remains **PENDING_K2B_CONSUMPTION_CONSUMPTION / source-specific provenance certification**, plus its existing 50,000-row completeness constraint and behavioural self/bot/staff rules.

---

## 43. CA-FIN boundary

CA-FIN-01 established that Corporate accounting authority does not yet support the required economic customer metrics.

Therefore CA-GROWTH must not create:

- CAC;
- LTV;
- ROAS;
- ARPU;
- revenue per customer;
- revenue per active customer;
- profit per customer;
- contribution margin per customer;
- customer lifetime gross profit;
- paid-customer count based on product payment intent;
- channel profitability.

These require both:

1. accepted customer/attribution authority; and
2. accepted accounting/revenue/cost authority.

Current status:

**PENDING_CA_FIN + PENDING_CUSTOMER_AUTHORITY**

---

## 44. Metric readiness matrix

| Metric / concept | Current source | Status | Required guard |
| --- | --- | --- | --- |
| Registered accounts | \`users\` | Candidate, PENDING_K2B_CONSUMPTION | Never call customers |
| Currently verified identity subjects | identity lifecycle | Candidate, PENDING_K2B_CONSUMPTION | Customer relation separate |
| Corporate distinct customers | No canonical customer subject | **BLOCKED** | Owner definition + cross-BU/person resolution |
| Active customers | No approved customer/activity/window | **BLOCKED** | Owner policy |
| Transacting customers | Domain transaction sources differ | **BLOCKED Corporate** | Per-BU states + dedupe + K2B |
| Marketplace inquiries | \`marketplace_inquiries\` | Candidate actual, PENDING_K2B_CONSUMPTION | Inquiry ≠ sale |
| Guest inquirers | guest contact on inquiries | Countable as inquiry contacts only | Do not call distinct customers |
| Saved listings | \`saved_vehicles\` | Candidate state, PENDING_K2B_CONSUMPTION | Save ≠ transaction |
| Marketplace searches | activity ledger | Candidate, PENDING_K2B_CONSUMPTION | Complete instrumentation |
| Zero-result searches | activity ledger | Candidate, PENDING_K2B_CONSUMPTION | Search demand, not lost sale |
| Filter usage | activity ledger | Candidate, PENDING_K2B_CONSUMPTION | Structured filters only |
| Listing impressions | activity ledger | Candidate, PENDING_K2B_CONSUMPTION | Observation |
| Listing opens | activity ledger | Candidate, PENDING_K2B_CONSUMPTION | Missing-context undercount disclosed |
| Daily unique shoppers | daily distinct link/actor keys | Candidate, PENDING_K2B_CONSUMPTION | Daily only |
| 7/30/90 unique shoppers current projection | peak daily unique | **RENAME/WRAP** | Never period unique |
| Human-readable top search terms | Query text hashed | **UNAVAILABLE_NOT_SEPARABLE** | Cannot reverse hash |
| Structured top filters | filter metadata | Candidate, PENDING_K2B_CONSUMPTION | Keep filter semantics |
| Navigation route renders | Navigation events | Candidate, PENDING_K2B_CONSUMPTION | 50k completeness guard |
| Navigation unique visitors | No identity/session stored | **UNAVAILABLE_NO_SOURCE** | Privacy contract |
| Navigation→commercial conversion | No shared link key | **UNAVAILABLE_NOT_SEPARABLE** | Do not divide totals |
| Detail→inquiry linked conversion | Marketplace link keys + inquiry | Candidate | K2B + linkage coverage |
| Inquiry→transaction linked conversion | inquiry ID→transaction | Candidate | K2B + exact states |
| Trade RFQ→quote | order/quote IDs | Candidate | K2B |
| Trade quote→accepted | atomic accepted quote | Candidate | K2B |
| Service request→accepted | service case | Candidate | K2B + min denominator |
| Repeat service customers | work-order customer_id | Candidate | Identified customer grain only |
| Dealer completed customer sales | No accepted completed-sale source | **UNAVAILABLE_NO_SOURCE** | Do not infer from listings |
| Customer retention | No canonical policy | **BLOCKED** | Customer+activation+window |
| Customer churn | No canonical policy | **BLOCKED** | Customer+active/grace rule |
| Reactivation | No canonical policy | **BLOCKED** | Same subject + churn state |
| Customer geography | Multiple non-equivalent sources | **BLOCKED Corporate** | Owner hierarchy |
| Trade corridor demand | order origin/destination | Candidate, PENDING_K2B_CONSUMPTION | Not customer geography |
| Referral-associated inquiries | referral code + inquiry | Candidate | Association, not acquisition |
| Campaign-associated inquiries | campaign code + inquiry | Candidate | Association, not causality |
| Customers acquired by channel | Attribution model absent | **BLOCKED** | Owner attribution policy |
| CAC | Finance + attribution absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |
| LTV | Finance + customer lifecycle absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |
| ROAS | Cost/revenue + attribution absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |
| ARPU | Finance + customer grain absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |
| Revenue per customer | Finance + customer grain absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |
| Profit per customer | Finance + cost/customer grain absent | **PENDING_CA_FIN / BLOCKED** | Both authorities |

---

## 45. Recommended Corporate metric namespace

This section defines names/semantics only, not implementation.

### Accounts / identity

- \`corporate.account.registered.count\`
- \`corporate.identity.current_verified.count\`
- \`corporate.customer.count\` — BLOCKED
- \`corporate.customer.active.count\` — BLOCKED
- \`corporate.customer.transacting.count\` — BLOCKED
- \`corporate.customer.newly_activated.count\` — BLOCKED
- \`corporate.customer.retained.rate\` — BLOCKED
- \`corporate.customer.reactivated.count\` — BLOCKED
- \`corporate.customer.churn.rate\` — BLOCKED

### Marketplace demand

- \`marketplace.search.performed.count\`
- \`marketplace.search.zero_result.count\`
- \`marketplace.search.zero_result.rate\`
- \`marketplace.search.filter_usage.count\`
- \`marketplace.listing.impression.count\`
- \`marketplace.listing.open.count\`
- \`marketplace.listing.save.count\`
- \`marketplace.inquiry.created.count\`
- \`marketplace.daily_unique_shopper.count\`
- \`marketplace.peak_daily_unique_shopper.count\`

### Linked Marketplace funnels

- \`marketplace.funnel.impression_to_detail.rate\`
- \`marketplace.funnel.detail_to_save.rate\`
- \`marketplace.funnel.detail_to_inquiry.rate\`
- \`marketplace.funnel.inquiry_to_transaction.rate\`
- \`marketplace.funnel.transaction_to_reservation.rate\`

These remain candidates until exact linkage/coverage/K2B is certified.

### Navigation

- \`growth.navigation.item_impression.count\`
- \`growth.navigation.item_selection.count\`
- \`growth.navigation.item_selection.rate\`
- \`growth.navigation.route_render.count\`
- \`growth.navigation.destination_blocked.count\`
- \`growth.navigation.error.count\`

### Service

- \`service.request.count\`
- \`service.request_to_accept.rate\`
- \`service.completed_case.count\`
- \`service.identified_customer.count\`
- \`service.repeat_identified_customer.count\`

### Trade

- \`trade.buyer_request.count\`
- \`trade.rfq.published.count\`
- \`trade.quote.submitted.count\`
- \`trade.quote.accepted.count\`
- \`trade.funnel.rfq_to_quote.rate\`
- \`trade.funnel.quote_to_accept.rate\`
- \`trade.order.completed.count\`

### Attribution

Until Owner policy:

- \`growth.referral_associated.inquiry.count\`
- \`growth.campaign_associated.inquiry.count\`
- \`growth.source_recorded.inquiry.count\`

Avoid “acquired” in IDs until acquisition model is accepted.

---

## 46. Growth reporting availability states

Every Customer/Growth output should use the CA-METRIC availability contract.

At minimum:

- \`value\`;
- \`insufficient_data\`;
- \`unavailable\`;
- \`not_applicable\`;
- \`degraded\` where bounded/truncated coverage is known.

Additional governance flags:

- \`PENDING_K2B_CONSUMPTION\`;
- \`PENDING_CA_FIN\`;
- \`UNAVAILABLE_NOT_SEPARABLE\`;
- \`BLOCKED_OWNER_DECISION\`.

A failed read must never become zero.

---

## 47. Owner Decision Register

| Decision ID | Owner decision required | Why it matters | Safe default until resolved |
| --- | --- | --- | --- |
| \`OD-CAGROWTH-001\` | What exact relationship makes a **person** a CarUp customer? | Corporate customer count | Customer count blocked |
| \`OD-CAGROWTH-002\` | Are supply-side sellers/dealers/garages CarUp customers, or only demand-side users? | Customer direction | Keep relationships separate |
| \`OD-CAGROWTH-003\` | Are external business organizations counted as customers in addition to people? | Mixed customer grains | Report people/org separately |
| \`OD-CAGROWTH-004\` | Which institutional participants can ever be customers? | Banks/insurers/providers/regulators differ | Participant ≠ customer |
| \`OD-CAGROWTH-005\` | Does customer status persist after a transaction/journey ends, and for how long? | Lifetime/active/churn | No lifetime status assumed |
| \`OD-CAGROWTH-006\` | Is \`VERIFIED_PERSON\` defined by current identity lifecycle capability-bearing state? | Verified customer semantics | Prefer lifecycle, not legacy boolean, pending approval |
| \`OD-CAGROWTH-007\` | What is the authoritative cross-account person-resolution method? | Real-person distinct count | Do not merge accounts heuristically |
| \`OD-CAGROWTH-008\` | Does “dealer customer” mean customer-of-dealer, dealer-as-CarUp-customer, or both separately? | Grain ambiguity | Keep separate |
| \`OD-CAGROWTH-009\` | What makes a garage/service participant a customer? | Service customer count | Work-order customer relationship only |
| \`OD-CAGROWTH-010\` | What makes a Diaspora Trade buyer a customer: profile, RFQ/order, accepted quote, completion? | Trade customer count | Profile = participant; order buyer = candidate |
| \`OD-CAGROWTH-011\` | What makes a finance applicant a CarUp customer? | Finance Product customer | Application = intent only |
| \`OD-CAGROWTH-012\` | What makes an insurance user a CarUp customer? | Insurance customer | Eligibility/policy states remain separate |
| \`OD-CAGROWTH-013\` | What activities qualify an active customer? | MAU/WAU/customer health | Active customer blocked |
| \`OD-CAGROWTH-014\` | What active-customer window(s) apply: 7/30/90 days or other? | Active denominator | No window assumed |
| \`OD-CAGROWTH-015\` | Is activity qualification different by BU? | Cross-BU comparability | No universal active rule |
| \`OD-CAGROWTH-016\` | What exact states qualify a transacting customer per BU? | Transaction customer count | Blocked |
| \`OD-CAGROWTH-017\` | Is a Marketplace reservation a transaction, or must live settlement complete? | Marketplace transacting customer | Keep stages separate |
| \`OD-CAGROWTH-018\` | What exact event activates a Marketplace buyer customer? | Activation | No event assumed |
| \`OD-CAGROWTH-019\` | What exact event activates a Marketplace seller customer? | Seller activation | No event assumed |
| \`OD-CAGROWTH-020\` | What exact event activates a Service customer? | Service activation | No event assumed |
| \`OD-CAGROWTH-021\` | What exact event activates a Trade customer? | Trade activation | No event assumed |
| \`OD-CAGROWTH-022\` | What exact event activates Finance/Insurance customers? | Product activation | No event assumed |
| \`OD-CAGROWTH-023\` | Is identity verification itself ever a customer activation event? | Prevents KYC=customer | Default no |
| \`OD-CAGROWTH-024\` | Should anonymous pre-login behavioural history be attributable to a later known customer when session linkage exists? | Privacy/attribution | Keep pseudonymous unless policy permits |
| \`OD-CAGROWTH-025\` | What is the authoritative Verify journey and which outcomes need governed instrumentation/linkage? | Verify funnel | Route activity only today |
| \`OD-CAGROWTH-026\` | What is the canonical acquisition attribution model: first touch, last touch, last non-direct, multi-touch or other? | Channel/customer acquisition | Association only |
| \`OD-CAGROWTH-027\` | What attribution lookback window applies? | Acquisition cohort | No window assumed |
| \`OD-CAGROWTH-028\` | How is direct/unknown traffic treated? | Attribution denominator | Keep unknown explicit |
| \`OD-CAGROWTH-029\` | How are conflicting campaign, referral and UTM touches resolved? | Attribution | Preserve all recorded associations |
| \`OD-CAGROWTH-030\` | Are referral and paid/owned campaigns mutually exclusive attribution classes? | Channel reporting | No exclusivity assumed |
| \`OD-CAGROWTH-031\` | What minimum source-coverage threshold permits channel ranking? | Sparse source fields | Publish coverage with any breakdown |
| \`OD-CAGROWTH-032\` | What minimum denominator permits a funnel conversion rate? | Avoid unstable rates | Use metric-specific insufficient_data |
| \`OD-CAGROWTH-033\` | What maximum elapsed time links stage A to stage B for each funnel? | Attribution/conversion | Same-object linkage only; no arbitrary window |
| \`OD-CAGROWTH-034\` | How are repeated stage events handled—first, last, any, or bounded episodes? | Funnel numerators | No silent double count |
| \`OD-CAGROWTH-035\` | Which funnels are strategic Corporate funnels versus BU diagnostic funnels? | Scorecard scope | Keep domain-specific |
| \`OD-CAGROWTH-036\` | Does the Owner want a synthetic BU Growth Score? If so, what governed weights? | Avoid vanity composite | Do not create composite |
| \`OD-CAGROWTH-037\` | What defines retained customer and retention interval? | Retention | Blocked |
| \`OD-CAGROWTH-038\` | What inactivity/grace rule defines churn? | Churn | Inactivity ≠ churn |
| \`OD-CAGROWTH-039\` | Is explicit cancellation treated differently from behavioral churn? | Churn | Report separately |
| \`OD-CAGROWTH-040\` | What qualifies reactivation after churn/inactivity? | Reactivation | Blocked |
| \`OD-CAGROWTH-041\` | Are retention/churn definitions Corporate-wide or BU-specific? | Multi-BU customer | Keep BU-specific until decided |
| \`OD-CAGROWTH-042\` | What is the authoritative customer geography: residence, operating location, transaction location or another hierarchy? | “Where customers are” | Keep geography types separate |
| \`OD-CAGROWTH-043\` | What reporting timezone governs “when activity happens”? | Hour/day rankings | Preserve UTC/event time until decided |
| \`OD-CAGROWTH-044\` | Should customer-local-time analysis be supported, and from which governed geography/timezone? | Time intelligence | No inference |
| \`OD-CAGROWTH-045\` | Which ranking families are management KPIs versus diagnostics? | Avoid click vanity | Label event rankings as diagnostics |
| \`OD-CAGROWTH-046\` | What minimum sample/coverage is required to publish a top route/feature/listing rank? | Ranking reliability | Show insufficient_data when weak |
| \`OD-CAGROWTH-047\` | Should Marketplace hashed query signatures be surfaced internally, or only structured filter demand? | Privacy/usability | Do not call hashes search terms |
| \`OD-CAGROWTH-048\` | What future privacy-safe taxonomy, if any, should enable human-readable search demand? | Top search terms | Raw terms unavailable |
| \`OD-CAGROWTH-049\` | What Corporate cohort-entry events are approved? | Cohort reporting | Registration cohorts only as account cohorts |
| \`OD-CAGROWTH-050\` | How should erased/tombstoned identities be treated in longitudinal customer cohorts? | Privacy/retention | Preserve aggregate; no re-identification |
| \`OD-CAGROWTH-051\` | Which customer/growth aggregates can executives export? | RBAC/privacy | Export separately gated |
| \`OD-CAGROWTH-052\` | What line-item customer PII should Customer & Growth operators access? | RBAC | Aggregate by default |
| \`OD-CAGROWTH-053\` | Should the same CarUp account count once per BU and once Corporate? | Cross-BU dedupe | Yes as safe conceptual model; Owner to ratify |
| \`OD-CAGROWTH-054\` | How should organization customers and individual customers be reported in Corporate totals? | Grain | Separate counts |
| \`OD-CAGROWTH-055\` | When may a guest inquiry be linked to a later account/customer? | Guest identity | No email/phone matching without governed link |
| \`OD-CAGROWTH-056\` | Does a referral lead qualify as a customer candidate before an inquiry/order exists? | Lead/customer boundary | Lead only |
| \`OD-CAGROWTH-057\` | What defines “new customer” when a known person enters a second BU? | Cross-BU acquisition | New-to-BU ≠ new-to-CarUp |
| \`OD-CAGROWTH-058\` | What defines “returning customer” versus “repeat activity”? | Retention | Use repeat-action wording |
| \`OD-CAGROWTH-059\` | Which process completion states can be used as non-financial growth outcomes? | Journey comparison | Domain completion only, never revenue |
| `OD-CAGROWTH-060` | K2B now governs Growth Actual eligibility as operational-only; which non-operational provenance classes, if any, may appear in separately labelled Benchmark/Test views? | Prevents benchmark/test views from contaminating Actual | Actual = K2B operational only; UNKNOWN excluded; Benchmark/Test policy still Owner-governed |
| \`OD-CAGROWTH-061\` | Should Navigation remain permanently identity-free, or is any future privacy-safe join architecture desired? | Cross-system funnel | Current Navigation stays separate |
| \`OD-CAGROWTH-062\` | What completeness policy applies when the 50,000 Navigation cap is reached? | Truncated rankings | DEGRADED/UNAVAILABLE, never silent |
| \`OD-CAGROWTH-063\` | What exact Corporate definition distinguishes “visitor”, “shopper” and “customer”? | Executive terminology | Use source-specific labels only |
| \`OD-CAGROWTH-064\` | Which seller/dealer/garage organization activities qualify business-customer activity? | B2B growth | No tenant=customer inference |
| \`OD-CAGROWTH-065\` | How should multi-role Trade participants be classified when one person is buyer in one order and seller in another? | Customer role | Roles are per relationship |
| `OD-CAGROWTH-066` | Beyond accepted K2B record provenance, what is the canonical treatment of behavioural bot flags, staff/internal traffic and seller self-traffic? | Demand truth | Exclude where authoritative flags exist; never infer unflagged activity as human/customer activity |
| \`OD-CAGROWTH-067\` | Does Corporate Growth need household/customer-group concepts? | Person grouping | No household inference |
| \`OD-CAGROWTH-068\` | Which business outcomes should define “journey performs best”? | Strategic comparison | Compare explicitly named linked outcomes only |

---

## 48. Downstream inputs

### CA-UX

Customer & Growth surfaces must:

- distinguish accounts from customers;
- distinguish anonymous sessions from people;
- distinguish route renders from business usage;
- show source/window/calculation version;
- show coverage/completeness;
- show PENDING_K2B_CONSUMPTION and unavailable states;
- label peak-day uniqueness correctly;
- never display human-readable top search terms from hashes;
- use linked funnel language only where linkage exists;
- avoid PII unless the viewer has explicit RBAC authority.

### CA-REPORT

Reports must carry subject grain, funnel/link key, attribution model, window, metric version, K2B status, availability/completeness, BU scope and cohort rule.

### CA-METRIC

CA-METRIC may activate currently blocked customer metrics only after accepted Owner Decisions, customer subject/grain, accepted K2B provenance and certified source linkage.

### CA-FIN

Economic customer metrics remain blocked until accounting and attribution/customer authority are simultaneously accepted.

### CA-RBAC

Preserve:

- aggregate customer metrics separate from PII;
- executive aggregate access separate from raw event/session access;
- customer export separate from customer summary;
- finance/insurance customer detail under stricter domain controls.

### CA-ORG / CA-BU

One person may have several BU customer relationships.

BU reports may count that relationship in each BU.

Corporate distinct customer must deduplicate the Corporate subject and must not sum BU counts.

### CA-CERT

Future certification must test customer definition, identity grain, cross-BU dedupe, funnel linkage, attribution model, K2B provenance, Navigation 50k completeness, period uniqueness, search-term privacy, RBAC/PII separation and cohort reproducibility.

---

## 49. Open risks

1. **Account-as-customer inflation** — all accounts, including staff/providers/test accounts, can be mislabeled customers.
2. **Cross-BU double counting** — same account/person can be counted once per BU then incorrectly summed.
3. **Cross-account duplicate people** — current system lacks a canonical person merge authority.
4. **Guest contact inflation** — repeated guest emails/phones can be treated as confirmed people.
5. **Inquiry-as-sale** — lead volume can be presented as commercial conversion.
6. **Tenant-as-customer** — external organization context can be mistaken for customer status.
7. **Navigation-as-funnel** — route selections/renders can be treated as business outcomes.
8. **Independent totals-as-conversion** — stage ratios can look precise while having no cohort linkage.
9. **Peak-day-as-period-unique** — current multi-day unique projection can overstate meaning.
10. **Navigation 50k truncation** — “top” rankings can silently represent only the bounded event set.
11. **Search-hash relabeling** — hashed signatures can be presented as human-readable search terms.
12. **Sparse attribution** — recorded source/campaign fields may cover only part of a population.
13. **Attribution causality** — code/UTM association can be presented as caused acquisition.
14. **Seller self-traffic** — listing owner/dealer activity can inflate shopper demand if exclusions are not applied.
15. **K2B-consumption bypass** — Corporate Actual can still absorb non-business activity if a Growth source bypasses or incompletely consumes the accepted K2B provenance authority.
16. **Bot/prefetch inflation** — unguarded impressions/opens can inflate demand.
17. **Verify-route vanity** — route renders can be called completed verifications.
18. **Trade-route vanity** — Trade clicks can be called customers/orders.
19. **Customer geography confusion** — shipment/listing/tenant locations can be mislabeled customer location.
20. **Activity-as-retention** — repeat sessions can be called retained customers.
21. **Inactivity-as-churn** — arbitrary inactivity threshold can create fake churn.
22. **Domain conversion leakage** — Communications “converted” can be treated as sale conversion.
23. **Finance leakage** — payment intent or sandbox settlement can create fake paying customers/ARPU.
24. **Ranking without completeness** — “top” can be published from partial/bounded reads.
25. **Executive PII leakage** — aggregate dashboard permission can be expanded into raw customer/event access.
26. **Composite score opacity** — weighted “growth score” can hide contradictory underlying metrics.
27. **Organization/person mixing** — combined entity count can lose business meaning.
28. **Same-account role changes** — buyer/seller/dealer roles can be treated as fixed person classifications.
29. **Deleted/erased identity reinterpretation** — tombstoned activity can be recast as anonymous new people.
30. **Lost-opportunity overclaim** — zero-results/near misses can be translated into “lost sales” or “lost revenue”.

---

## 50. Stop conditions encountered

CA-GROWTH stopped rather than guessing on:

- canonical customer definition;
- person-versus-organization customer scope;
- supply-side customer treatment;
- cross-account person deduplication;
- active-customer activities/window;
- transacting-customer state;
- BU activation events;
- acquisition attribution model/window;
- anonymous→known attribution;
- funnel time limits;
- repeated-stage handling;
- retention;
- churn;
- reactivation;
- Corporate customer geography;
- reporting timezone;
- Verify outcome funnel instrumentation;
- customer rankings based on complete periods;
- future human-readable search taxonomy;
- Corporate cohort definitions;
- CAC/LTV/ROAS/ARPU/revenue/profit per customer;
- K2B consumption mapping/certification for Growth sources not yet wired to the accepted provenance authority.

Every unresolved customer/growth/business policy is represented by \`OD-CAGROWTH-*\` rather than a fabricated assumption.

---

## 51. Recommended next steps after moderator review

If CA-MOD accepts CA-GROWTH-01:

1. Owner should prioritize \`OD-CAGROWTH-001\` customer definition, cross-BU grain, active/transacting rules and attribution policy.
2. PC01-K2B-R2 is accepted/frozen at `7b34dec1bc9f05b72b6abf0104db65980f280a0b`; before Corporate Actual customer/growth counts are activated, each metric source path must prove it consumes the accepted K2B provenance semantics or remain `PENDING_K2B_CONSUMPTION`.
3. CA-UX can safely implement account, demand, navigation and funnel surfaces using explicit source labels and unavailable states without waiting for a universal customer KPI.
4. Verify should receive a future bounded instrumentation/source-authority task if the Owner requires submitted/found/passport/next-action funnel intelligence.
5. Customer/economic KPIs should remain blocked until CA-FIN authority exists for the corresponding revenue/cost facts.
6. CA-CERT should later certify: **identity/customer grain → qualifying source event → linked funnel/cohort → provenance → aggregate → RBAC-safe report**.

No dashboard, instrumentation, product code, analytics schema, database migration, K2B implementation, live runtime or production data was changed by CA-GROWTH-01.

This document does not self-accept.

CA-GROWTH-01 CUSTOMER & GROWTH INTELLIGENCE MODEL READY FOR MODERATOR REVIEW


---

## 52. CA-MOD post-review recustody — accepted K2B dependency

**Recustody date:** 13 October 2026  
**Original CA-GROWTH specialist result:** `c291bdd453d08adfbee28b3de07b17adb25898ad`  
**Accepted K2B authority:** `7b34dec1bc9f05b72b6abf0104db65980f280a0b`

This bounded CA-MOD recustody was made after PC01-K2B-R2 reached independent moderator acceptance.

It changes no customer definition, funnel definition, attribution policy, retention/churn rule, metric formula, finance rule, RBAC rule or source inspection result from CA-GROWTH-01.

It resolves only the stale dependency state:

- K2B itself is now **ACCEPTED / FROZEN**;
- K2B operational provenance may be consumed by Corporate Admin as an accepted downstream authority;
- remaining `PENDING_K2B_CONSUMPTION` labels mean a particular Growth source path still needs integration/certification, not that K2B is unaccepted;
- K2B operational status must never be relabelled as customer status without the separate customer relationship definition required by this model;
- the product/reference snapshot inspected by CA-GROWTH remains `505ffcca6b641c8b3b55f503e0f4fd39d26710dc`; no later PR #222 product tree is silently substituted.

This recustody preserves the 68 Owner Decisions except where `OD-CAGROWTH-060` and `OD-CAGROWTH-066` are narrowed to reflect accepted K2B authority.

**CA-GROWTH-01 accepted dependency state:** K2B authority resolved; customer/growth policy decisions remain explicitly governed.

# CarUp Intelligence 1.0 — Data, Analytics, AI & Stakeholder Intelligence Canonical Plan

**Status:** Canonical product and engineering plan candidate  
**Programme:** Post-Reunification Product Advancement  
**Repository:** kudzimusar/carup  
**Source anchor:** main@ba208963d863654157335189c60f587cbe330041  
**Document branch:** docs/carup-intelligence-data-analytics-canonical-plan  
**Runtime authorization:** NONE — this document does not authorize a third source-write lane, production changes, partner activation, government integrations, data migration, or external data sharing by itself.  
**Primary purpose:** Give CarUp builders, agents, operators, executives and future stakeholder users one durable source of truth for how CarUp will collect, govern, interpret, visualize and apply automotive data, analytics and AI.

---

## 1. Executive summary

CarUp is evolving from a vehicle marketplace into an automotive operating system and trust network. Vehicle Truth establishes what is known about a vehicle. Trust establishes how much confidence CarUp can responsibly place in governed evidence and evaluated facts. Communications owns interaction channels and workflow conversations. CarUp Intelligence must now become the fourth horizontal layer: it explains what activity means and what a user, partner or CarUp operator should do next.

The programme is not a request to add generic charts or to install a third-party analytics tracker. It is a plan to build a first-party, governed automotive intelligence capability across Marketplace, Vehicle Passport, Trust, Communications, SafePay/SafeTrade, insurance, finance, mechanics, garages, PartSentry, parts, referrals, Diaspora Trade OS, government-linked workflows and CarUp's own internal operations.

The central product loop is:

    DATA
      ↓
    OBSERVATION
      ↓
    INTELLIGENCE
      ↓
    RECOMMENDATION
      ↓
    ACTION
      ↓
    BETTER OUTCOME
      ↓
    MORE GOVERNED DATA

The goal is that every material action in the CarUp automotive lifecycle leaves an appropriately governed signal, and every useful signal improves at least one of the following:

- Vehicle Truth
- Trust and risk understanding
- customer experience
- business conversion
- stakeholder decision-making
- CarUp operations
- marketing effectiveness
- product development
- fraud/compliance control
- AI assistance
- regional/global automotive intelligence

The programme must create value at three levels simultaneously:

1. **Individual value** — owners, buyers and sellers understand what is happening and what to do.
2. **Business value** — dealers, garages, insurers, banks, suppliers and other partners understand demand, conversion and ROI.
3. **Network value** — CarUp understands the automotive market well enough to improve the product, build better services, make stronger partner propositions and expand regionally and globally.

---

## 2. Product thesis

CarUp should not merely store vehicle records. It should learn, in a privacy-governed and evidence-aware way, how vehicles, people, services, institutions and transactions move through the automotive economy.

The long-term operating model is:

    VEHICLE TRUTH
    What is known?
          │
          ├─────────────┐
          │             │
        TRUST        ACTIVITY
    Can we rely     What are people
      on it?          doing?
          │             │
          └──────┬──────┘
                 ↓
          INTELLIGENCE
        What does it mean?
                 ↓
             ACTION
       What should happen next?

CarUp Intelligence therefore is not an isolated feature. It is a horizontal system capability.

---

## 3. Objectives

### 3.1 Primary objectives

CarUp Intelligence 1.0 must:

1. establish one canonical measurement vocabulary across web, mobile, backend and partner/API surfaces;
2. capture governed first-party activity events without replacing authoritative domain records;
3. provide truthful, role-scoped dashboards for every major stakeholder class;
4. show stakeholders not only numbers, but what those numbers mean and what action they should take;
5. measure how listing quality, data completeness, imagery, price, evidence, Trust, response time and other factors relate to commercial outcomes;
6. help sellers and businesses improve the quality of information they contribute to CarUp;
7. give CarUp Technologies a comprehensive Automotive Intelligence Command Center;
8. provide measurable ROI to dealers, insurers, banks, garages, suppliers and other partners;
9. connect analytics to Communications and Gutu AI so important insights can proactively reach users;
10. create a governed data foundation that improves as CarUp expands from Zimbabwe into regional and global markets.

### 3.2 Secondary objectives

The programme should also enable:

- product funnel analysis;
- customer activation/retention analysis;
- acquisition and campaign attribution;
- partner performance management;
- workflow abandonment analysis;
- form and listing completion optimisation;
- market supply/demand analysis;
- zero-result and unmet-demand discovery;
- pricing intelligence;
- service and parts demand intelligence;
- transaction readiness analysis;
- government/compliance workflow visibility where authoritative data is available;
- AI-powered explanation and next-best-action;
- stakeholder reports and future subscription intelligence products;
- future aggregate automotive market reports.

---

## 4. Non-goals and hard boundaries

This plan does not authorize:

- fabrication of unavailable metrics;
- republishing unknown government status as false or verified;
- treating clickstream data as Vehicle Truth;
- revealing anonymous shopper identities to sellers;
- unrestricted partner access to CarUp's internal data;
- unrestricted government access to browsing behaviour;
- cross-tenant analytics leakage;
- client-controlled seller_id, tenant_id or privileged attribution;
- a third simultaneous source-write lane while Lane A and Lane B remain active;
- production analytics activation without staged certification;
- replacing authoritative tables with an analytics ledger;
- inferring causation from correlation without adequate evidence;
- silently collecting sensitive data without a defined governance basis.

Unknown must remain unknown. Not evaluated must remain not evaluated. Not available must remain not available.

---

# PART I — STAKEHOLDER UNIVERSE

## 5. Canonical stakeholder model

The current CarUp Feature Registry formalizes seven authenticated roles:

- Owner
- Dealer
- Mechanic
- Insurance
- Government
- Administrator
- Bank

That role list is useful for access control, but it is not broad enough to define the full CarUp economic network. The intelligence programme must use a wider stakeholder taxonomy.

Stakeholders are grouped below as:

A. CarUp internal stakeholders  
B. Consumers and vehicle owners  
C. Automotive merchants and professionals  
D. Financial and risk partners  
E. Trade, logistics and diaspora participants  
F. Government and institutional stakeholders  
G. Growth, marketing and ecosystem partners

---

## 6. Internal CarUp Technologies stakeholders

CarUp itself must be the best-informed stakeholder in the system.

| Internal stakeholder | Key information | Main decisions |
|---|---|---|
| Founders / Executive | GMV, growth, liquidity, supply, demand, revenue, retention, partner ROI | strategy and capital allocation |
| CarUp Admin | ecosystem health and exceptions | operating control |
| Marketplace Operations | listings, quality, moderation, demand, enquiries, conversion | marketplace liquidity |
| Trust & Evidence | evidence coverage, evaluations, conflicts, review backlog | trust operations |
| Fraud / Risk | abnormal behaviour, identity conflicts, payment anomalies | loss prevention |
| Customer Support | workflow failures, unresolved cases, customer history | support |
| Communications Operations | delivery, response, conversion by workflow/channel | engagement |
| Marketing / Growth | acquisition, activation, campaigns, referrals, retention | growth |
| Partner Sales | partner pipeline, partner ROI, demand opportunity | commercial sales |
| Account Management | dealer/insurer/bank/garage performance | retention and upsell |
| Finance | subscriptions, fees, commissions, escrow, settlement | financial control |
| Product | feature adoption, abandonment, conversion | roadmap |
| UX / Design | friction, form abandonment, responsive/device behaviour | experience improvement |
| Data / Intelligence | metrics, cohorts, forecasts, benchmarks | intelligence |
| Gutu AI | governed user, vehicle and performance context | assistance |
| Engineering / SRE | event loss, latency, errors, jobs, API reliability | reliability |
| Security | auth anomalies, abuse, access violations | security |
| Legal / Privacy / Compliance | consent, retention, access audits, lawful sharing | governance |
| Partnerships / Integration Operations | API/provider health and institutional workflows | ecosystem integration |

Internal intelligence must remain permissioned. “CarUp can technically access it” is not a sufficient authorization rule.

---

## 7. Consumer stakeholders

### 7.1 Anonymous visitors and shoppers

Potential signals:

- landing/source
- search terms
- filters
- result count
- zero-result search
- listing impressions
- listing opens
- comparison actions
- price-band interest
- make/model/year/category demand
- geography where coarse and lawful
- acquisition/referral source

Value:

- understand pre-lead demand;
- improve search and discovery;
- detect supply gaps;
- improve marketing campaigns.

Privacy rule: anonymous/pseudonymous until the user deliberately identifies themselves.

### 7.2 Registered buyers

Additional signals:

- saves
- unsaves
- shares
- repeat listing visits
- compare additions/removals
- enquiries
- inspection requests
- finance interest
- insurance interest
- reservation
- purchase
- post-purchase actions

Primary intelligence question:

**What vehicles and services are most relevant to me, and what should I do next?**

### 7.3 Private sellers

Inputs:

- vehicle details
- pricing
- specifications
- selling location
- listing description
- media
- evidence
- service/history information
- availability
- communication response
- price changes

Outputs:

- impressions
- views
- saves
- shares
- enquiries
- inspection/reservation progression
- price response
- listing completeness
- missed-search opportunities
- comparable performance
- next-best-action

Primary question:

**Is my vehicle attracting serious buyers, and what can I improve?**

### 7.4 Vehicle owners not currently selling

Relevant intelligence:

- Vehicle Passport completeness
- Trust/evidence state
- service and maintenance
- insurance
- parts
- licence/compliance workflow where authoritative
- value trend where a legitimate model exists
- ownership actions

Primary question:

**What should I do next to maintain, protect or prepare my vehicle?**

---

## 8. Dealer stakeholders

Dealers produce:

- inventory
- pricing
- media
- evidence
- publication actions
- promotions
- salesperson response
- lead progression
- reservations
- sales where captured

Dealers consume:

- portfolio impressions
- detail views
- saves
- shares
- enquiries
- inspections
- reservations
- sales attribution
- response times
- inventory ageing
- demand by make/model
- campaign performance
- price response
- listing-quality opportunities
- stock gaps

Primary question:

**Which stock is performing, which stock needs attention, and what value is CarUp delivering to my dealership?**

---

## 9. Fleet, rental and corporate vehicle stakeholders

Examples:

- logistics fleets
- rental companies
- NGOs
- corporate fleets
- public-sector fleets

Potential inputs:

- fleet inventory
- mileage
- service schedule
- maintenance history
- insurance
- incidents
- replacement cycles
- resale status

Intelligence:

- cost and maintenance trends
- vehicles needing attention
- replacement/retention candidates
- resale demand
- fleet risk
- utilisation where integrated

---

## 10. Mechanics

Inputs:

- work orders
- diagnosis
- service records
- labour/service category
- parts used
- completion state
- turnaround

Outputs:

- profile discovery
- enquiries
- bookings/jobs
- service demand
- repeat customers
- response time
- demand by make/model
- incomplete or lost opportunities

Primary question:

**Is my practice growing, and what services are customers asking for?**

---

## 11. Garages and service centres

A garage is an organization/location and must not be permanently conflated with an individual mechanic.

Potential garage structure:

- organization
- branch
- service bays
- mechanics/team
- service catalogue
- opening/capacity
- bookings
- jobs
- customers
- parts

Intelligence:

- search impressions
- profile visits
- enquiries
- booking conversion
- service demand
- capacity utilisation
- cancellation
- turnaround
- repeat customer rate
- branch/team performance
- demand-capacity mismatch

Future dedicated role/surface should be considered.

---

## 12. Vehicle inspectors and assessors

Stakeholders may include:

- pre-purchase inspectors
- independent assessors
- insurance assessors
- roadworthiness inspectors where integrated

Potential signals:

- inspection requested
- accepted
- completed
- turnaround
- result/state
- evidence produced
- geography
- vehicle category demand

These signals strengthen both Trust and transaction conversion.

---

## 13. Parts suppliers and distributors

Potential actors:

- retailers
- wholesalers
- authorized distributors
- importers
- manufacturers/distributors
- lawful dismantlers/breakers where applicable

Inputs:

- catalogue
- compatibility
- inventory
- price
- location
- PartSentry identity/provenance
- fulfilment

Outputs:

- searches
- product views
- compatibility checks
- RFQs
- zero-result/unmet demand
- conversion
- demand by make/model/category

Key opportunity signal:

**Users searched for a part, but CarUp had no suitable verified supplier result.**

---

## 14. Insurance companies

Inputs:

- products
- eligibility
- quotes
- policy workflow
- renewals
- claims
- claim outcomes
- risk/fraud decisions where authorized

Outputs:

- qualified exposures
- insurance product opens
- quote starts
- quote submissions
- offers
- accepted policies
- renewals
- cancellations
- claims funnel
- source attribution

Primary question:

**Where is insurable demand coming from, and what is converting?**

---

## 15. Insurance brokers and agents

Do not collapse brokers into insurers.

Intelligence:

- referrals
- quote submissions
- insurer placement
- conversion
- policies
- renewals
- commissions where CarUp participates
- product performance

---

## 16. Banks

Existing formal CarUp role.

Inputs:

- finance products
- applications
- decision states
- collateral/vehicle information
- approved amount
- disbursement where integrated

Outputs:

- finance-eligible sessions
- calculator/prequalification starts
- applications
- completion
- approval/rejection
- disbursement
- demand by vehicle value/type
- conversion by channel
- portfolio/risk metrics where authorized

Primary question:

**Where is credible vehicle-finance demand and how well does it convert?**

---

## 17. Asset-finance, leasing, microfinance and fintech companies

These may offer:

- hire purchase
- leasing
- salary-backed finance
- vehicle-backed loans
- microfinance

They use the same core intelligence architecture with product-specific funnels and permissions.

---

## 18. Payment and settlement providers

Signals:

- payment attempt
- method
- success/failure
- settlement
- refund
- reversal
- latency/error

CarUp use:

- payment conversion
- provider reliability
- abandonment
- operational reconciliation

---

## 19. SafePay / escrow participants

Stakeholders:

- buyer
- seller
- CarUp
- escrow/payment provider

Lifecycle signals:

- escrow initiated
- funded
- held
- inspection condition
- release
- dispute
- refund
- complete

Primary intelligence:

- transaction trust funnel
- time in state
- dispute/reversal rates
- conversion.

---

## 20. Referral agents and affiliates

Inputs:

- code/link/QR
- channel
- campaign
- attribution

Outputs:

- link views
- qualified visits
- leads
- qualified leads
- transactions
- rewards
- channel performance

---

## 21. Advertising and marketing partners

Potential users:

- dealers
- automotive brands
- insurers
- finance companies
- parts/service businesses

Permitted intelligence:

- reach
- impressions
- engagement
- qualified actions
- attribution
- campaign ROI

Privacy rule: measurable ROI must not require exposing individual anonymous shoppers.

---

## 22. Diaspora buyers and sponsors

Signals:

- source country
- destination
- vehicle interest
- landed-cost calculation
- RFQ
- inspection
- finance
- SafeTrade
- container-space interest
- shipment
- delivery

Primary question:

**What should I buy/import, what will it cost, and where is the process now?**

---

## 23. Overseas dealers, exporters, auction and sourcing partners

Inputs:

- stock
- source
- condition
- FOB/CIF information
- inspection
- export readiness
- documentation

Outputs:

- Zimbabwe/regional demand
- RFQs
- conversion
- price sensitivity
- preferred destination/model

---

## 24. Freight, shipping and logistics providers

Signals:

- booking
- origin/destination
- ETD/ETA
- milestones
- delay
- container capacity
- cost
- exception/damage
- delivery

Creates a CarUp trade-flow dataset.

---

## 25. Clearing and customs agents

Potential signals:

- declaration
- documents
- duty stage
- clearance
- border/import milestone
- exception
- completion time

---

## 26. Government and institutional stakeholders

Government intelligence requires separate authority, privacy and legal controls. It is not a commercial dashboard with a different logo.

Potential stakeholder classes include:

- vehicle registry authorities
- police / vehicle-theft or clearance units
- customs/tax authorities
- roadworthiness/vehicle inspection authorities
- road/vehicle licensing authorities
- transport ministry
- financial/insurance regulators where applicable
- consumer protection
- data/privacy regulators
- courts/lawful investigation processes where specifically authorized

CarUp must never state that an external authority verified a fact unless a governed integration or verified evidence supports the claim.

Possible data states must include:

- verified
- not verified where an authority actually evaluated it
- pending
- unavailable
- unknown/not connected

Unknown is not false.

---

# PART II — CANONICAL DATA MODEL

## 27. Twenty-four canonical data domains

The exact field count is intentionally not frozen before schema/event-contract work. Instead, every field/event must map into one of these canonical domains.

| # | Domain | Example inputs | Core purpose |
|---|---|---|---|
| 1 | User identity | user, role, verification | authorization |
| 2 | Organization | dealer/garage/insurer/bank profile | partner identity |
| 3 | Vehicle identity | VIN, make, model, year | Vehicle Truth |
| 4 | Ownership | owner/seller/transfer | ownership lifecycle |
| 5 | Listing/publication | status, description, availability | commerce |
| 6 | Specifications | mileage, fuel, transmission, drivetrain | matching |
| 7 | Pricing | price, currency, price changes | price response |
| 8 | Location | selling/service geography | relevance |
| 9 | Media | listing images and coverage | presentation quality |
| 10 | Evidence | governed documents/provenance | Truth/Trust |
| 11 | Trust | evaluated dimensions and state | risk/confidence |
| 12 | Search/discovery | query, filters, result count, impressions | demand |
| 13 | Engagement | opens, saves, shares, compare | intent |
| 14 | Leads | enquiry/contact/status | commercial demand |
| 15 | Communications | channel, response, SLA, workflow | conversion |
| 16 | Inspection/service | inspections, work orders, service history | condition/service |
| 17 | Parts | search, compatibility, RFQ | parts demand |
| 18 | Finance | calculator, application, approval | lending demand |
| 19 | Insurance | quote, policy, claim | insurance demand |
| 20 | Transaction | reservation, escrow, sale | commerce outcome |
| 21 | Government/compliance | registry, licence, clearance, duty | lawful lifecycle |
| 22 | Import/logistics | RFQ, shipping, customs, delivery | trade |
| 23 | Attribution | referral, campaign, source | marketing ROI |
| 24 | Platform/business | revenue, subscription, errors, uptime | CarUp health |

---

## 28. Authority model: business truth vs analytics observation

CarUp Intelligence is an observation layer, not a replacement source of truth.

Examples:

- saved_vehicles remains authority for current saved state;
- analytics records save/unsave history;
- marketplace_inquiries remains authority for enquiries;
- Communications remains authority for conversation/thread state;
- SafePay/escrow domain remains authority for escrow state;
- vehicle/evidence/trust services remain authority for Vehicle Truth and Trust;
- analytics can count and correlate these states but cannot override them.

Rule:

**An analytics event may describe that an action occurred. It may not manufacture the authoritative business state that the action concerns.**

---

## 29. Canonical activity event envelope

Conceptual first-party event:

    event_id
    schema_version
    event_type
    occurred_at
    received_at

    actor_scope
    pseudonymous_session_key
    authenticated_user_id_internal

    tenant_id_internal
    organization_id_internal
    listing_id
    vehicle_reference
    object_type
    object_id

    source_surface
    source_platform
    source_channel
    campaign_code
    referral_code

    event_version
    idempotency_key
    privacy_class
    metadata_allowlist

Server must derive privileged identity and tenancy wherever possible.

Clients must not be trusted to assert their own tenant, seller or organization scope.

---

## 30. Initial Marketplace event vocabulary

At minimum:

- marketplace_search_performed
- marketplace_search_zero_results
- marketplace_listing_impression
- marketplace_listing_opened
- marketplace_listing_engaged
- marketplace_listing_saved
- marketplace_listing_unsaved
- marketplace_listing_shared
- marketplace_compare_added
- marketplace_compare_removed
- marketplace_compare_viewed
- marketplace_contact_clicked
- marketplace_inquiry_started
- marketplace_inquiry_created
- marketplace_inspection_requested
- marketplace_reservation_started
- marketplace_reservation_completed
- marketplace_price_changed
- marketplace_listing_created
- marketplace_listing_submitted
- marketplace_listing_published
- marketplace_listing_paused
- marketplace_listing_archived
- marketplace_listing_sold

Definitions must be deterministic.

Examples:

**Impression:** listing card actually satisfies the governed display/visibility definition, not merely returned by an API.

**Open/detail view:** deliberate opening of listing detail.

**Engaged view:** only if a deterministic, documented interaction/time rule exists.

**Save:** user has expressed durable watchlist interest.

**Inquiry:** lead record actually created, not simply tapping a button.

**Sale:** authoritative transaction/sale state, not inferred from disappearing inventory.

---

## 31. Funnel vocabulary

Marketplace:

    IMPRESSION
       ↓
    DETAIL VIEW
       ↓
    ENGAGED VIEW
       ↓
    SAVE / SHARE / COMPARE
       ↓
    INQUIRY
       ↓
    INSPECTION
       ↓
    FINANCE / INSURANCE
       ↓
    RESERVATION
       ↓
    TRANSACTION

Different workflows must retain separate funnels rather than forcing every stakeholder into one generic conversion model.

---

# PART III — DATA COMPLETENESS AS A GROWTH ENGINE

## 32. Listing Readiness / Completeness

CarUp must introduce a deterministic Listing Readiness or Listing Completeness measure.

It is not a Trust score.

Example:

    LISTING COMPLETENESS — 74%

    ✓ Vehicle identity
    ✓ Asking price
    ✓ Mileage
    ✓ Basic specifications
    ! Add more useful photos
    ! Add selling location
    ! Complete service history
    ! Add governed evidence

The score must be explainable: every point must map to a defined field/group.

---

## 33. Twelve listing-quality groups

1. vehicle identity completeness  
2. seller profile completeness  
3. pricing completeness  
4. specification completeness  
5. selling location  
6. useful description  
7. exterior media coverage  
8. interior media coverage  
9. evidence coverage  
10. service/history coverage  
11. Trust/evaluation state — displayed separately from completeness  
12. transaction readiness

The UX must distinguish:

- information completeness;
- evidence/Trust;
- transaction readiness.

They answer different questions.

---

## 34. Lost Opportunity Intelligence

Missing information should be measured not only as an incomplete form, but as a possible loss of discovery or conversion.

Example:

A user searches for:

- Toyota
- 2019+
- automatic
- Harare
- under $18,000

A 2020 Toyota at $17,500 lacks transmission and selling location.

CarUp may be unable to confidently include it in those filters.

Seller insight:

**Your listing could not be confidently matched to 42 relevant searches because important information was missing.**

This creates a concrete incentive to improve the listing.

Metrics:

- eligible searches missed due to missing field;
- searches excluded by missing price/currency;
- filters excluded by missing specification;
- location-filter opportunities lost;
- marketplace visibility prevented by publication/readiness requirements.

---

## 35. Image intelligence

Measure:

- uploaded image count;
- publishable/usable count;
- primary image;
- exterior coverage;
- interior coverage;
- image loading failures;
- media order;
- image engagement where useful and privacy-safe.

Possible action:

**Add an interior and rear view. Listings in your comparison group with fuller image coverage are associated with stronger buyer engagement.**

Do not claim a fixed uplift until observed data supports it.

---

## 36. Price intelligence

Price intelligence should not merely say “too expensive.”

Signals:

- comparable price position;
- impression-to-view rate;
- view-to-save rate;
- view-to-inquiry rate;
- time on market;
- compare behaviour;
- interest before/after price change.

Example:

    PRICE POSITION
    Within comparable range

    BUYER RESPONSE
    Strong views
    Moderate saves
    Weak enquiries

    AFTER LAST PRICE CHANGE
    Saves/week increased from 12 to 21

Use language such as:

- price response is strong/moderate/weak;
- above/below comparable asking range;
- enquiry conversion changed after price adjustment.

Avoid claiming buyer intent that was not explicitly expressed.

---

## 37. Data Completeness → Business Outcome analysis

CarUp should learn which inputs correlate with commercial outcomes.

Examples:

| Input | Outcome relationship to evaluate |
|---|---|
| photo count/coverage | view→save, view→inquiry |
| price completeness | search eligibility |
| service history | engagement/conversion |
| evidence coverage | save/inquiry conversion |
| Trust evaluation | engagement/conversion |
| dealer verification | conversion |
| location completeness | search/discovery |
| seller response time | lead progression |
| finance availability | purchase progression |
| insurance availability | quote/purchase progression |
| inspection availability | reservation progression |
| description quality | engagement/enquiry |
| time on market | interest decay |

Analysis must distinguish correlation from causation.

---

# PART IV — PROCESS INTELLIGENCE

## 38. Process telemetry principle

Page views alone are insufficient. Each major CarUp workflow needs a process funnel.

Each step should be able to answer:

- started?
- completed?
- abandoned?
- failed?
- resumed?
- elapsed time?
- validation problem?
- help/support needed?
- downstream conversion?

---

## 39. Seller/listing funnel

    START LISTING
      → VEHICLE IDENTITY
      → SPECIFICATIONS
      → PRICE
      → LOCATION
      → MEDIA
      → EVIDENCE
      → REVIEW
      → PUBLICATION
      → LEAD
      → INSPECTION
      → RESERVATION
      → SALE
      → OWNERSHIP-TRANSFER WORKFLOW

Use:

- improve forms;
- detect abandonment;
- target nudges;
- measure time-to-publish;
- measure time-to-sale.

---

## 40. Buyer funnel

    DISCOVER
      → SEARCH/FILTER
      → LISTING VIEW
      → COMPARE/SAVE/SHARE
      → ENQUIRY
      → INSPECTION
      → FINANCE/INSURANCE
      → RESERVATION
      → PURCHASE
      → POST-PURCHASE OWNER JOURNEY

---

## 41. Dealer funnel

    INVENTORY INGEST
      → DATA COMPLETENESS
      → EVIDENCE
      → PUBLICATION
      → DISCOVERY
      → LEAD
      → SALES RESPONSE
      → QUALIFIED
      → INSPECTION
      → RESERVATION
      → SALE
      → AFTERSALES

---

## 42. Insurance funnel

    ELIGIBLE VEHICLE/USER
      → INSURANCE SURFACE
      → PRODUCT VIEW
      → QUOTE START
      → DOCUMENTS
      → QUOTE SUBMISSION
      → OFFER
      → ACCEPT
      → POLICY
      → RENEWAL
      → CLAIM if applicable

---

## 43. Finance funnel

    FINANCE INTEREST
      → CALCULATOR
      → PREQUALIFICATION
      → APPLICATION
      → DOCUMENTS
      → DECISION
      → ACCEPTANCE
      → DISBURSEMENT

---

## 44. Garage/service funnel

    DISCOVERY
      → GARAGE/MECHANIC PROFILE
      → SERVICE VIEW
      → ENQUIRY
      → BOOKING
      → WORK ORDER
      → SERVICE COMPLETION
      → REVIEW
      → REPEAT

---

## 45. Parts funnel

    PART SEARCH
      → RESULT
      → COMPATIBILITY
      → PARTSENTRY/PROVENANCE
      → SUPPLIER VIEW
      → RFQ
      → ORDER
      → FULFILMENT

Zero-result searches are commercial opportunity signals.

---

## 46. Import / Diaspora funnel

    VEHICLE DISCOVERY
      → LANDED-COST ESTIMATE
      → RFQ
      → INSPECTION
      → SAFETRADE
      → PURCHASE
      → EXPORT
      → SHIPPING
      → CUSTOMS
      → DELIVERY
      → REGISTRATION

---

## 47. Government/compliance lifecycle

Where authoritative integrations/evidence exist:

    VEHICLE
      → IDENTITY
      → POLICE/CLEARANCE PROCESS
      → DUTY/TAX PROCESS
      → INSURANCE REQUIREMENT
      → OWNERSHIP TRANSFER
      → REGISTRATION/LICENSING
      → ROADWORTHINESS/INSPECTION as applicable

Every institutional state must carry authority/provenance.

---

# PART V — VISUAL INTELLIGENCE EXPERIENCE

## 48. Four levels of stakeholder intelligence

Analytics must not live only on one “Analytics” page.

### Level 1 — Dashboard Pulse

Answers: **What happened since I last came here?**

Typically four to five KPIs with trends.

### Level 2 — Contextual Intelligence

Performance appears beside the object being managed:

- listing row;
- vehicle;
- promotion;
- garage;
- policy/product;
- finance product;
- part;
- referral campaign.

### Level 3 — Deep Intelligence Workspace

Role-specific trends, funnels, cohorts and benchmarks.

### Level 4 — Proactive Intelligence

CarUp brings meaningful changes through:

- Needs Attention;
- notifications;
- Communications;
- email;
- eventual push;
- Gutu AI.

---

## 49. Shared visual grammar

Use a consistent intelligence design language:

### KPI card

    614
    Listing views
    ↑ 18.2%
    vs previous period

### Signal badges

- Strong demand
- Rising
- Stable
- Cooling
- Needs attention
- Insufficient data

### Funnel

Show counts and conversion between steps.

### Trend

7 / 30 / 90 day periods plus appropriate comparison.

### Benchmark

Example:

**Higher save-to-view conversion than 73% of comparable listings.**

Benchmark methodology and cohort size must be transparent enough to avoid misleading users.

### Next Best Action

Every major intelligence surface should answer:

**What should I do now?**

---

## 50. Individual Seller / Owner Intelligence

Locations:

- /dashboard
- /dashboard/listings
- listing-specific insights route to be defined during implementation

Dashboard pulse:

- impressions/views
- saves
- shares
- enquiries
- trend
- interest state

Listing card contextual metrics:

- views
- saves
- shares
- enquiries
- days live
- listing completeness
- demand signal

Deep listing insight:

- discovery funnel
- 7/30/90 trend
- price response
- benchmark
- lost opportunities
- media completeness
- next-best-action

No published listing:

**Publish your vehicle to start receiving Marketplace insights.**

No data should render as fake zero when the read model is unavailable.

---

## 51. Dealer Intelligence

Locations:

- /dealer
- /dealer/inventory
- /dealer/leads
- /dealer/promotions
- /dealer/analytics

Dealer home pulse:

- portfolio impressions
- detail views
- saves
- leads
- inspections
- reservations
- sales where authoritative

Inventory table:

| Vehicle | Price | Views | Saves | Leads | Days live | Signal |
|---|---:|---:|---:|---:|---:|---|

Deep Intelligence tabs:

- Overview
- Inventory
- Leads
- Audience
- Marketing
- Benchmarks

Dealer insights:

- top performers
- needs attention
- aged stock
- price response
- lead conversion
- salesperson/response-time performance
- acquisition channel
- campaign ROI
- demand gap
- listing completeness

The existing static/mock SalesAnalytics remnants must not survive as trusted business intelligence.

---

## 52. Mechanic Intelligence

Location:

- /mechanic and future workshop insight route

Pulse:

- profile views
- enquiries
- booked jobs
- completed jobs
- response time
- repeat customer rate

Deep insight:

- demand by service
- demand by make/model
- enquiry→work-order conversion
- turnaround
- lost enquiries
- repeat customers

---

## 53. Garage Intelligence

Future dedicated organization-level role/surface should include:

- overview
- bookings
- services
- team
- customers
- intelligence

Metrics:

- search impressions
- profile visits
- service views
- enquiries
- bookings
- cancellation
- capacity
- branch/team performance
- demand by service
- repeat customers

Mechanic and Garage data must be related but not conflated.

---

## 54. Insurance Intelligence

Existing surfaces:

- /insurance-dash
- /insurance-dash/claims
- /insurance-dash/risk
- /insurance-dash/fraud

Commercial intelligence should add:

- qualified vehicle exposure
- insurance opens
- quote starts
- quote submissions
- offers
- policies
- renewals
- source attribution

Risk/underwriting intelligence remains separate from marketing/demand intelligence.

---

## 55. Bank / Finance Intelligence

Existing surfaces:

- /bank
- /bank/applications
- /bank/collateral
- /bank/risk

Commercial demand view:

- finance-eligible sessions
- calculator/prequalification
- applications
- approvals
- disbursements
- average vehicle value
- demand by vehicle/price band
- conversion by source

Risk view remains independently governed.

---

## 56. Parts / Supplier Intelligence

Future supplier surface:

- catalogue
- requests
- PartSentry/provenance
- intelligence

Metrics:

- searches
- zero results
- product views
- compatibility checks
- RFQs
- orders
- fulfilment
- demand gaps

---

## 57. Diaspora / Trade Intelligence

Metrics:

- source market
- Zimbabwe destination
- stock views
- landed-cost calculations
- RFQs
- inspection
- container-space interest
- SafeTrade progression
- shipment milestones
- delivery

Views:

- route demand
- vehicle demand
- conversion
- delays/exceptions.

---

## 58. Referral Intelligence

Owner/referrer view:

- link/QR views
- qualified visits
- leads
- transactions
- pending/released rewards

CarUp Admin view:

- campaign/channel performance
- fraud/abuse
- referral CAC/ROI
- local vs diaspora attribution.

---

## 59. Government / Regulatory Intelligence

Government views must be purpose-limited.

Possible aggregate/authorized metrics:

- vehicles with known authoritative registry status;
- vehicles with unknown status;
- clearance workflow counts;
- ownership-transfer workflow counts;
- evidence/compliance backlog;
- conflict/anomaly counts;
- roadworthiness/licensing workflow where integrated.

Government should not receive unrestricted shopper histories.

---

# PART VI — CARUP INTERNAL AUTOMOTIVE INTELLIGENCE COMMAND CENTER

## 60. Admin information architecture

Target route:

- /admin/intelligence

Sections:

- Overview
- Marketplace
- Supply
- Demand
- Listing Quality
- Trust & Evidence
- Communications
- Transactions
- Dealers
- Mechanics & Garages
- Parts
- Insurance
- Finance
- Government/Compliance
- Diaspora/Trade
- Referrals
- Marketing
- Customer Health
- Revenue
- Risk
- Platform
- AI

---

## 61. Admin Overview

Suggested top KPIs:

- Marketplace impressions
- unique shoppers
- active listings
- active sellers
- active dealers
- enquiries
- inspections
- reservations
- transactions
- GMV where authoritative
- active professional organizations

Avoid current-dashboard fabricated fallback values.

---

## 62. Supply Intelligence

Metrics:

- vehicles created
- vehicles published
- new listings/day
- dealer/private mix
- make/model/year supply
- region
- price distribution
- average/median days live
- aged inventory
- supply shortage
- oversupply

Commercial use:

**High buyer demand exists for a model/category for which CarUp currently has insufficient supply.**

Sales/partnership teams can use that signal to recruit relevant dealers.

---

## 63. Demand Intelligence

Metrics:

- searches
- search sessions
- filters
- zero-result searches
- impressions
- views
- saves
- shares
- compares
- enquiries
- geography
- diaspora demand

Commercial use:

CarUp can prove real demand to inventory partners.

---

## 64. Listing Quality Intelligence

Metrics:

- completion distribution
- missing location
- weak image coverage
- missing specifications
- incomplete evidence
- unpublished due to readiness
- missed-search opportunity
- time-to-complete

Use:

- targeted campaigns;
- product/form improvements;
- dealer coaching;
- seller nudges.

---

## 65. Trust & Evidence Intelligence

Metrics:

- evaluated vs not evaluated
- evidence coverage
- evidence review backlog
- conflicts
- stale states
- source distribution
- workflow blockers
- transaction readiness vs evidence state

Never reinterpret raw caches as authoritative Trust.

---

## 66. Communications Intelligence

Metrics:

- conversations
- active/converted
- response time avg/median/p95
- workflow/funnel stage
- channel
- delivery success/failure/suppression
- enquiry→next-step
- campaign attribution

Use:

- seller/dealer response coaching
- provider reliability
- customer engagement
- conversion.

---

## 67. Transaction Intelligence

Metrics:

- reservation starts/completions
- SafePay/escrow lifecycle
- abandoned transaction
- time in state
- disputes/refunds
- completed transaction
- GMV and fees where authoritative

---

## 68. Marketing / Growth Intelligence

Acquisition:

- source
- campaign
- referral
- paid/organic where known
- acquisition cost when imported from ad spend

Activation:

- account creation
- first search
- first save
- first enquiry
- first vehicle
- first listing publication

Engagement:

- active user
- search
- views
- saves
- communications

Conversion:

- lead
- inspection
- reservation
- transaction

Retention:

- returning user
- repeat buyer
- repeat seller
- active dealer
- partner churn

Revenue:

- subscription
- promotion
- transaction fee
- referral/partner revenue

Core growth funnel:

    VISITOR
      ↓
    ACCOUNT
      ↓
    ACTIVATED USER
      ↓
    QUALIFIED ACTION
      ↓
    TRANSACTION
      ↓
    REPEAT USER

---

## 69. Product and UX Intelligence

Track process friction, not merely visits:

- form step abandonment
- validation errors
- retry loops
- mobile/desktop differences
- task completion
- support invocation
- route/navigation failures
- failed API calls related to user workflows

Use Navigation Analytics for navigation behaviour, but do not repurpose privacy-minimized navigation telemetry as listing/business performance data.

---

## 70. Platform / Engineering Intelligence

Internal-only:

- API latency
- error rate
- provider failure
- event ingestion loss
- event lag
- rollup lag
- job failure
- webhook health
- integration availability
- environment/version provenance

Every dashboard should make stale/unavailable data diagnosable internally.

---

# PART VII — MARKETING, ROI & BUSINESS IMPROVEMENT

## 71. Partner ROI reports

Dealer report example:

- search impressions
- inventory views
- saves
- enquiries
- inspections
- reservations
- sales where attributable
- response time
- campaign/source breakdown

Insurer report:

- eligible exposures
- product views
- quote starts
- submissions
- policies where confirmed
- source/channel

Bank report:

- finance-eligible sessions
- calculator/prequalification
- applications
- approvals
- disbursements where confirmed

Garage report:

- discovery impressions
- profile views
- service enquiries
- bookings
- repeat customers

Supplier report:

- part searches
- zero-result demand
- product views
- RFQs
- orders

These reports make CarUp's commercial value measurable.

---

## 72. Promotion and advertising intelligence

Promotions must connect to outcomes.

Metrics:

- impressions
- listing/profile opens
- saves
- enquiries
- attributed qualified leads
- transactions where attributable
- cost
- cost per qualified lead
- return on spend where data is complete

A promotion should never be sold only as “visibility” if CarUp can demonstrate outcomes.

---

## 73. User improvement loop

CarUp should replace generic prompts such as:

**Complete your profile**

with evidence-aware prompts such as:

- Add selling location: relevant location-filter searches could not confidently match your listing.
- Add more usable photos: your current media coverage is below the comparison group.
- Complete mileage: buyers frequently filter by mileage in this segment.
- Respond to enquiries: unanswered leads are accumulating.
- Review price: traffic is healthy but save/inquiry conversion is below comparable listings.
- Add governed evidence: your listing cannot yet support certain confidence/transaction-readiness states.

No nudge should fabricate a benefit.

---

# PART VIII — AI & GUTU INTELLIGENCE

## 74. AI role

AI should sit on top of governed analytics, not replace it.

Gutu AI may:

- explain performance;
- summarize changes;
- compare periods;
- identify likely workflow friction;
- prioritize next-best-action;
- answer user questions using authorized data;
- create marketing suggestions;
- generate stakeholder reports;
- help CarUp operators investigate trends.

AI may not:

- invent metrics;
- override Trust;
- assert external-government verification;
- reveal data outside user authorization;
- infer protected/sensitive attributes;
- claim causation merely because two metrics correlate.

---

## 75. Example seller AI interaction

Question:

**Why is my Hilux not selling?**

Possible governed answer:

- discovery is strong;
- detail views are healthy;
- save-to-view conversion is below the comparison group;
- asking price is above the comparable asking range;
- two listing-completeness groups are incomplete;
- evidence/Trust state is whatever the canonical services actually report.

Then:

**Recommended next actions: review price, add missing media coverage, complete outstanding governed information.**

---

## 76. Example dealer AI interaction

Question:

**Which vehicles should I focus on today?**

Gutu can rank:

1. high traffic + weak lead conversion;
2. strong demand + incomplete listing;
3. new enquiry requiring response;
4. aged stock with falling interest;
5. under-supplied market opportunity.

Ranking rules must be inspectable and testable.

---

## 77. Proactive intelligence

Insight delivery surfaces:

- dashboard Needs Attention
- notifications
- Communications inbox
- email
- future push/mobile
- Gutu daily/weekly summary

Examples:

- listing interest rose sharply;
- enquiry requires response;
- data completeness is blocking discovery;
- campaign is generating qualified demand;
- parts search has unmet supply;
- finance demand is rising in a value band.

---

# PART IX — PRIVACY, SECURITY & GOVERNANCE

## 78. Privacy tiers

### Anonymous behaviour

Aggregate/pseudonymous analytics only.

### Authenticated behaviour

Internal pseudonymous/account-scoped analytics according to purpose.

### Declared lead

Identity becomes available inside authorized business workflow after deliberate user action.

### Regulated/institutional data

Purpose-limited access, audited and sourced from authoritative integrations/evidence.

---

## 79. Seller privacy rule

A seller may see:

**822 unique shoppers viewed your listing.**

A seller may not automatically see:

- names
- phone numbers
- emails
- identity of anonymous viewers

Identity becomes available only when a user becomes an authorized lead/contact under the relevant flow.

---

## 80. Government privacy rule

Government access is not a universal super-admin role.

Institutional access must be:

- purpose-defined;
- role/scope controlled;
- auditable;
- minimized;
- legally/contractually grounded;
- separated from unrelated commercial behavioural data.

---

## 81. Internal CarUp privacy rule

CarUp Admin must itself be permissioned.

Possible internal scopes:

- executive aggregate
- marketplace operations
- trust/evidence
- fraud
- support
- marketing
- finance
- security
- data administration

Sensitive row-level inspection should require a legitimate operational reason and audit trail.

---

## 82. Data quality controls

Required:

- schema versioning
- idempotency
- dedupe
- bot/test/fixture exclusion
- self-traffic exclusion where appropriate
- clock/time normalization
- late-event handling
- source/version provenance
- null/unknown semantics
- event loss monitoring
- rollup reconciliation
- backfill rules
- retention
- deletion/erasure compliance
- cohort minimums for privacy-sensitive benchmarks

---

# PART X — ANALYTICS STORAGE & COMPUTATION

## 83. Conceptual first-party storage

Potential table family:

- marketplace_activity_events
- listing_daily_metrics
- seller_daily_metrics
- tenant_daily_metrics
- platform_daily_metrics
- process_step_events
- partner_attribution_events
- insight_recommendations or materialized insight state where appropriate

These are conceptual names, not pre-approved migrations.

---

## 84. Rollups

Daily listing rollup may include:

- impressions
- unique impressions/viewers
- detail views
- engaged views
- saves
- unsaves
- shares
- compare adds
- enquiries
- inspection requests
- reservations
- search appearances
- missed-search opportunities

Seller/tenant rollups aggregate authorized listing metrics.

Do not store calculations that can silently diverge from their definitions without versioning.

---

## 85. Metric contract

Every KPI must define:

- name
- definition
- unit
- numerator
- denominator
- time window
- uniqueness rule
- dedupe rule
- exclusions
- source table/event
- authority
- privacy class
- allowed audiences
- calculation version
- data-availability state

This metric registry becomes mandatory for new dashboards.

---

# PART XI — IMPLEMENTATION PROGRAMME

## 86. Programme name

**CarUp Intelligence 1.0 — Marketplace, Stakeholder & Decision Intelligence**

The programme is divided into phased, certifiable work. Agents must not skip directly to attractive dashboards.

---

## 87. I0 — Live reconciliation and complete data inventory

Objectives:

- reconcile canonical main, staging and current migrations;
- inventory every current analytics/event source;
- inventory current mock/static dashboard metrics;
- inventory business-authority tables;
- inventory role/access model;
- inventory partner/API integrations;
- identify current data that must not be trusted.

Deliverables:

- existing-data inventory;
- event inventory;
- mock/static data removal register;
- stakeholder/source/consumer matrix;
- data-gap register.

Gate:

No new canonical metric without identifying its source and authority.

---

## 88. I1 — Canonical metric and event contract

Freeze definitions for:

- impression
- view
- engaged view
- unique viewer/session
- save
- unsave
- share
- compare
- lead
- inspection
- reservation
- sale
- conversion
- churn
- response
- listing completeness
- missed opportunity
- active user
- retention
- attribution

Deliverables:

- metric registry;
- event taxonomy;
- privacy classification;
- versioning policy.

---

## 89. I2 — First-party activity ledger

Build governed ingestion/storage architecture.

Requirements:

- server-side derivation of privileged dimensions;
- schema versioning;
- idempotency;
- dedupe;
- privacy;
- bot/test exclusions;
- retention;
- RLS/access boundaries;
- indexes/performance;
- fail-safe behaviour.

Gate:

No cross-tenant leak; no fabricated authority.

---

## 90. I3 — Marketplace instrumentation

Instrument web and native/mobile:

- search
- zero-results
- card impressions
- opens
- saves/unsaves
- shares
- compare
- inquiry
- inspection
- reservation
- listing lifecycle
- price change
- form/process steps

Analytics should normally not block UX. Authoritative business actions still rely on their normal domain writes.

---

## 91. I4 — Rollups and query/read models

Build:

- listing daily metrics
- seller metrics
- dealer/tenant metrics
- platform metrics
- funnel rollups
- trend comparison
- benchmark cohort framework

Requirements:

- reproducible calculation;
- reconciliation tests;
- calculation versions;
- clear no-data/unavailable states.

---

## 92. I5 — Authorization and privacy projections

Define APIs/read models by audience.

Conceptual routes may include:

- /api/marketplace/my-listings/:id/analytics
- /api/marketplace/my-analytics
- /api/dealer/analytics
- /api/admin/marketplace/intelligence

Final routes require live implementation reconciliation.

Tests:

- seller cannot access another seller;
- dealer cannot access another tenant;
- partner receives only agreed metrics;
- government receives only purpose-limited data;
- admin permissions are scoped.

---

## 93. I6 — Listing Readiness & Lost Opportunity

Implement:

- deterministic completeness groups;
- explainable score;
- missed-search opportunities;
- field-specific nudges;
- media completeness;
- price-response inputs.

Gate:

Completeness must never masquerade as Trust.

---

## 94. I7 — Individual Seller / Owner Intelligence

Deliver:

- dashboard Marketplace Pulse;
- listing-level contextual metrics;
- full listing insights;
- next-best-action;
- truthful empty/unavailable states;
- mobile parity.

---

## 95. I8 — Dealer Intelligence

Deliver:

- dealer pulse;
- portfolio metrics;
- inventory performance table;
- lead funnel;
- audience/source attribution;
- promotions ROI;
- benchmarks;
- next-best-actions.

Replace mock/static analytics rather than layering new analytics on top of fictional data.

---

## 96. I9 — Mechanic & Garage Intelligence

Deliver:

- mechanic work-demand intelligence;
- service funnel;
- response/repeat metrics;
- garage organization model decision;
- future garage dashboard/intelligence;
- capacity/demand insight where data exists.

---

## 97. I10 — Insurance Intelligence

Deliver:

- commercial demand funnel;
- quote/policy conversion where integrated;
- source attribution;
- separate risk/fraud and commercial views;
- privacy/tenant controls.

---

## 98. I11 — Finance Intelligence

Deliver:

- finance demand;
- calculator/prequalification;
- applications;
- approvals/disbursement where integrated;
- price-band/vehicle demand;
- separate lending risk projection.

---

## 99. I12 — Parts & Supplier Intelligence

Deliver:

- parts demand;
- zero-result demand;
- compatibility;
- RFQ;
- supplier performance;
- PartSentry/provenance relationship.

---

## 100. I13 — Diaspora / Trade Intelligence

Deliver:

- source/destination market;
- landed-cost activity;
- RFQ;
- SafeTrade;
- shipment/container demand;
- route demand;
- trade funnel.

---

## 101. I14 — Referral & Marketing Intelligence

Deliver:

- referral performance;
- campaign/source attribution;
- promotion ROI;
- channel performance;
- fraud-safe attribution.

---

## 102. I15 — Government / Regulatory Intelligence

Only after source authority and integration boundaries are established.

Deliver:

- institutional stakeholder contract;
- verification/provenance states;
- aggregate workflow;
- permission/audit model;
- unknown/unavailable semantics.

No government “verified” status may be invented.

---

## 103. I16 — CarUp Automotive Intelligence Command Center

Deliver:

- /admin/intelligence;
- Overview;
- Supply;
- Demand;
- Quality;
- Trust/Evidence;
- Communications;
- Transactions;
- stakeholder verticals;
- Marketing;
- Customer Health;
- Revenue;
- Risk;
- Platform.

---

## 104. I17 — Proactive Next-Best-Action

Build deterministic recommendation rules first.

Examples:

- incomplete data blocks discovery;
- high traffic + weak conversion;
- unanswered leads;
- demand exceeds supply;
- campaign underperforming;
- listing interest cooling.

Each recommendation needs:

- rule;
- evidence;
- threshold;
- explanation;
- action;
- suppression/cooldown.

---

## 105. I18 — Gutu AI Intelligence

Provide AI with authorized, governed intelligence context.

Capabilities:

- explanation;
- summaries;
- query;
- prioritized action;
- report generation;
- marketing suggestions.

Tests:

- cannot invent;
- cannot cross tenant/user scope;
- cannot override Trust;
- cannot promote unknown government state to verified.

---

## 106. I19 — Reports, certification and stakeholder manualization

Deliver:

- weekly/monthly seller/dealer/partner summaries;
- downloadable/exportable report where appropriate;
- user-facing explanations for every KPI;
- in-product help;
- stakeholder manuals derived from this canonical document.

Certification:

- controlled staging events;
- exact count reconciliation;
- web/mobile instrumentation parity;
- auth/privacy;
- no-data truthfulness;
- performance;
- event loss;
- rollup lag;
- visual/responsive UAT;
- soak;
- exact-head evidence.

---

# PART XII — EXECUTION GOVERNANCE

## 107. Current lane rule

At this document's source anchor:

- Lane A: Communications / Email — active implementation PR #183
- Lane B: Marketplace Reliability / Reference UX — active implementation PR #182

This plan is documentation-only.

It does not authorize a third implementation lane.

When an implementation lane becomes available:

1. reconcile live main;
2. reconcile staging;
3. select the next bounded Intelligence phase;
4. branch from canonical main;
5. freeze tests/contracts first;
6. implement;
7. open/maintain one bounded PR;
8. certify exact head;
9. owner review/authorization according to normal CarUp governance.

---

## 108. Agent operating instructions

Any AI/developer agent working on CarUp Intelligence must:

1. read this entire document;
2. reconcile it against live repository/deployment evidence;
3. identify the exact Intelligence phase being implemented;
4. identify authoritative source tables/services before coding;
5. identify affected roles and privacy boundaries;
6. identify current mock/static values that may be replaced;
7. preserve Vehicle Truth / Trust semantics;
8. preserve Communications as the conversation authority;
9. avoid duplicate event vocabularies;
10. add metric definitions and tests with code;
11. fail truthfully when data is unavailable;
12. provide exact-head evidence before claiming completion.

Agents must not:

- broaden a PR silently;
- create a competing analytics architecture;
- introduce a third-party tracker as CarUp's commercial source of truth;
- compute tenant scope from untrusted client input;
- fabricate baseline metrics;
- merge without the required project authorization.

---

# PART XIII — TESTING & CERTIFICATION

## 109. Required test layers

### Unit

- metric calculations
- event validation
- completeness
- benchmarks
- recommendation rules

### Authorization

- user scope
- seller scope
- tenant scope
- partner scope
- government scope
- admin scope

### Data quality

- duplicate events
- idempotency
- late events
- bot/test exclusion
- self-traffic
- missing values
- unknown/unavailable state

### Integration

- business action creates expected event;
- event references correct authoritative object;
- rollup includes exactly expected count;
- dashboard matches rollup.

### Web/mobile

- equivalent action semantics;
- responsive/mobile presentation;
- no duplicate instrumentation caused by rerenders.

### Staging certification

Create a controlled UAT script:

- exact number of impressions;
- opens;
- saves;
- shares;
- enquiries;
- price change;
- unsave;
- inspection/reservation where safe.

Then verify expected counts exactly.

---

## 110. Analytics observability

CarUp must monitor the analytics system itself.

Metrics:

- events received
- invalid events
- duplicate suppression
- ingestion lag
- rollup lag
- failed rollups
- missing source
- schema-version distribution
- dashboard query latency

A dashboard that silently stops counting is a production defect.

---

# PART XIV — USER MANUAL PRINCIPLES

## 111. How CarUp should explain analytics to users

Every KPI should have a plain-language definition.

Examples:

### Impressions

How many governed opportunities your listing had to be shown under the CarUp impression definition.

### Views

How many listing-detail opens occurred.

### Saves

How many shoppers currently or historically expressed watchlist interest, depending on the displayed metric.

### Enquiries

Actual enquiries created through the canonical enquiry system.

### Listing Completeness

How much useful listing information you have supplied. It is not a Trust score.

### Trust

Only what the canonical Trust service has evaluated.

### Price response

How buyer activity around the listing compares with defined behaviour and comparable listings; it is not a statement about what every buyer “thinks.”

---

## 112. Business user playbook

### Seller

If discovery is low:
- improve missing searchable data;
- confirm publication/readiness;
- improve media;
- review category/location/price data.

If views are high but saves are low:
- inspect price/media/completeness/comparables.

If saves are high but enquiries are low:
- inspect price, transaction readiness, evidence and contact flow.

If enquiries exist but no progression:
- respond quickly;
- inspect availability/inspection/finance barriers.

### Dealer

Use:
- inventory signals to prioritize stock;
- lead funnel to improve sales response;
- demand intelligence to source inventory;
- promotion analytics to allocate marketing;
- completeness to improve listing quality.

### Garage/Mechanic

Use:
- service demand to adjust catalogue;
- booking funnel to improve conversion;
- demand/capacity to plan availability;
- repeat rate to manage customer retention.

### Insurer

Use:
- eligible exposure to understand demand;
- quote conversion to improve product flow;
- source attribution to assess CarUp ROI;
- risk view separately for underwriting.

### Bank/Finance

Use:
- vehicle/price-band demand;
- application funnel;
- abandonment;
- source/partner conversion.

---

# PART XV — REGIONAL & GLOBAL EXPANSION

## 113. Regionalization principles

CarUp Intelligence must not hard-code Zimbabwe assumptions into the event model.

Regional dimensions should be configurable:

- country
- province/state/region
- currency
- market source
- government authority
- finance/insurance product regime
- vehicle identity rules
- import/export corridor
- language/timezone

Core metric vocabulary should remain stable across markets.

---

## 114. Global intelligence opportunity

As CarUp expands, governed aggregate intelligence may support:

- cross-market vehicle demand
- import/export corridors
- regional price movement
- parts demand
- insurance/finance demand
- service demand
- fleet trends
- vehicle provenance/Trust insights

This can become a strategic data moat only if:

- data quality is strong;
- definitions stay consistent;
- privacy is preserved;
- source authority is explicit;
- regional data is not falsely normalized.

---

# PART XVI — SUCCESS MEASURES

## 115. System success

CarUp Intelligence 1.0 succeeds when:

- every key Marketplace action has a canonical event;
- seller/dealer metrics reconcile to authoritative activity;
- dashboards never rely on fabricated placeholder business metrics;
- listing completeness produces actionable guidance;
- CarUp can quantify lost opportunity from missing data;
- role/tenant access is proven;
- web/mobile parity is certified;
- CarUp Admin has cross-ecosystem operational intelligence;
- partner ROI can be demonstrated;
- Gutu can explain metrics without inventing them.

---

## 116. Business success

Indicators:

- higher listing completion;
- more usable media;
- reduced seller-form abandonment;
- higher search eligibility;
- faster response;
- improved enquiry progression;
- improved dealer partner retention;
- measurable insurance/finance/garage/parts partner value;
- stronger campaign attribution;
- lower product friction;
- higher marketplace liquidity.

These are objectives, not guaranteed outcomes.

---

# PART XVII — DEFINITION OF DONE

CarUp Intelligence 1.0 is not “done” when a chart renders.

A phase is done only when:

1. metric definitions are documented;
2. source authority is known;
3. event/read model is implemented;
4. privacy and role scope are enforced;
5. calculation is versioned;
6. unit/integration tests pass;
7. UI has truthful loading/no-data/error states;
8. web/mobile parity is addressed where required;
9. staging controlled-event counts reconcile;
10. no P0/P1 privacy or cross-tenant defects remain;
11. observability exists;
12. documentation is updated;
13. owner/stakeholder UAT is complete where required.

---

# PART XVIII — PERMANENT GOVERNING PRINCIPLES

## 117. Principle 1 — Every meaningful action should leave a governed signal

Do not instrument noise for its own sake. Capture actions that improve a decision.

## 118. Principle 2 — Analytics does not replace Truth

Clicks do not prove vehicle facts.

## 119. Principle 3 — Unknown remains unknown

Especially for government, Trust, insurance, finance and compliance.

## 120. Principle 4 — Numbers require provenance

Every KPI must point to source and definition.

## 121. Principle 5 — Intelligence must be actionable

Prefer:

**You missed 42 relevant searches because transmission is missing.**

over:

**Profile completeness: 71%.**

## 122. Principle 6 — Privacy is part of the product

A stakeholder receives the intelligence needed for their role, not unrestricted raw data.

## 123. Principle 7 — AI explains governed intelligence

AI may interpret; it may not invent.

## 124. Principle 8 — CarUp learns from outcomes

Use data to improve forms, listings, search, workflows, partner products and market strategy.

## 125. Principle 9 — One architecture, many projections

Seller, dealer, bank, insurer, garage, government and admin views derive from common governed definitions without becoming identical dashboards.

## 126. Principle 10 — Data quality compounds

As CarUp expands, consistent definitions and authority make the network more valuable. Bad or fabricated data compounds in the opposite direction and must be prevented.

---

# 127. Canonical closing model

CarUp's mature product model should be understood as:

    TRUTH
    What is known about the vehicle and transaction?

    TRUST
    How confidently can CarUp rely on governed evidence?

    COMMUNICATIONS
    How do people and organizations interact?

    INTELLIGENCE
    What does ecosystem activity mean?

    AI
    How can that intelligence be explained, prioritized and acted upon?

    ACTION
    What should the person, business, institution or CarUp itself do next?

This is the intended long-term direction of CarUp Intelligence.

The purpose is not to make CarUp a dashboard company. It is to make CarUp an automotive operating system that learns responsibly from real activity, gives every authorized stakeholder useful intelligence, improves its own product continuously, proves commercial value, and develops a durable data advantage as it expands from Zimbabwe into regional and global markets.


---

# PART XIX — CURRENT-STATE AUDIT AND REUSE MAP

## 128. Why this section exists

CarUp already contains several analytics and operational data components. Intelligence 1.0 must reuse, converge or deliberately supersede them. Agents must not assume the system starts from zero, and must not create a parallel event stack merely because the current pieces are incomplete.

The following findings were established during the live-repository audit that preceded this plan.

---

## 129. Navigation Analytics — existing, useful, but not commercial listing analytics

Current components include:

- docs/navigation-intelligence/NAVIGATION_ANALYTICS.md
- web/src/lib/navigationAnalytics.ts
- mobile/utils/navigationAnalytics.ts
- backend/services/navigationAnalytics/navigationAnalyticsService.js
- backend/routes/navigationAnalyticsRoutes.js
- database/migrations/20260623130000_navigation_analytics_events.sql
- web/src/components/admin/NavigationAnalyticsPanel.tsx

Current event vocabulary includes:

- navigation_surface_opened
- navigation_item_impression
- navigation_item_selected
- navigation_destination_rendered
- navigation_destination_blocked
- navigation_role_switched
- navigation_drawer_opened
- navigation_tab_selected
- navigation_error

This subsystem is privacy-minimized and intentionally avoids retaining raw VIN/listing/tenant identity, names, email, phone, raw URLs, IP addresses and similar direct identifiers.

It can answer questions such as:

- which navigation surfaces are used;
- which items are selected;
- where users encounter blocked destinations;
- selection-through rate;
- platform/role differences;
- zero-selection items.

It cannot truthfully answer:

**How many shoppers viewed Dealer X's Hilux?**

Rule:

**Navigation Analytics remains navigation telemetry. Marketplace Intelligence must not overload it with commercial identity that contradicts its privacy contract.**

---

## 130. Marketplace Admin Analytics — existing operational/governance layer

Current components include:

- backend/services/marketplace/marketplaceAnalyticsService.js
- backend/routes/marketplaceAdminRoutes.js
- web/src/pages/dashboard/admin/MarketplaceModeration.tsx

Current aggregate outputs cover:

Listings:
- total
- public
- pending_review
- suppressed
- rejected
- archived
- high_risk

Inquiries:
- total
- by type
- by status
- referral attributed
- high risk
- diaspora demand

This is valuable Marketplace operational intelligence.

It is not yet seller/dealer ROI intelligence because it does not provide the full listing-performance funnel.

---

## 131. Marketplace product plan already anticipated richer analytics

Existing Marketplace planning material identified events such as:

- marketplace_listing_viewed
- marketplace_listing_saved
- marketplace_listing_shared
- marketplace_inquiry_created
- marketplace_quote_requested
- marketplace_inspection_requested
- marketplace_import_interest_created
- marketplace_container_space_interest_created
- marketplace_service_booked
- marketplace_purchase_confirmed

The Marketplace seller/owner plan also included “View performance stats.”

Rich analytics was deferred post-MVP rather than rejected. CarUp Intelligence 1.0 therefore closes an acknowledged functional gap rather than introducing an unrelated product direction.

---

## 132. Listing-view measurement is currently incomplete

The current public listing-detail flow can emit marketplace_listing_viewed through referral/campaign attribution when referral or campaign context exists.

Ordinary direct/organic listing views are not therefore guaranteed to be represented by that mechanism as a canonical durable listing-view count.

Intelligence 1.0 must create a consistent listing-view contract independent of whether a referral code exists.

---

## 133. Saved vehicles are a strong current-state source, but not a history ledger

Current Marketplace Saved service persists saved_vehicles and supports:

- save
- unsave
- list current saves

Unsave removes the current-state row.

Therefore saved_vehicles can remain authoritative for current saved state, but alone it cannot support:

- historical save rate;
- unsave rate;
- watchlist churn;
- save duration;
- save→inquiry historical conversion;
- behaviour before/after price changes.

Intelligence 1.0 must record save/unsave observations while preserving saved_vehicles as current-state authority.

---

## 134. Marketplace inquiries are a strong commercial foundation

Current marketplace_inquiries already carries useful commercial information including:

- listing association
- buyer/seller/tenant associations
- inquiry type
- inquiry status
- source channel
- referral code
- campaign code
- risk state
- created/updated timestamps
- allowlisted attribution metadata

This should be reused as inquiry authority.

Analytics should reference it, not create a competing lead database.

---

## 135. Communications Analytics is reusable

Current Communications analytics already includes useful scoped measures such as:

- conversations total/active/converted
- conversion rate
- workflow/funnel stage
- Marketplace conversations
- Marketplace converted
- inquiry→next-step
- response time average/median/p95
- delivery success/failure/suppression
- attribution by source/referral/campaign
- campaign touches/conversions

CarUp Intelligence should project this into seller/dealer/partner intelligence where authorized instead of recreating messaging analytics.

---

## 136. Sharing is currently an instrumentation gap

Marketplace/Vehicle Detail can expose share UX, including native navigator sharing, but a general durable marketplace_listing_shared history is not currently a dependable commercial metric.

Intelligence instrumentation must close this gap.

---

## 137. Dealer Dashboard truthfulness and remaining placeholders

Current Dealer Dashboard has deliberately removed unsupported fabricated values for major business metrics and shows unavailable states where no source exists.

That is the correct Truth posture.

However, static/demo remnants such as fixed sales chart data and inventory-age percentages must not be promoted into the new Intelligence system.

The separate dealer SalesAnalytics surface also contains mock/static values and must eventually be replaced by real CarUp-owned analytics rather than cosmetically restyled.

---

## 138. Insurance Dashboard truthfulness

Current Insurance Dashboard has similarly removed fabricated claims/premium/risk business numbers when no read model exists.

Intelligence 1.0 must preserve this discipline.

New insurance KPIs only become live when a valid source/read model exists.

---

## 139. Bank and Admin dashboard audit requirement

Existing bank/admin screens contain legacy/static or fallback-like values that must be audited before they are treated as business intelligence.

I0 must classify every displayed number as one of:

- authoritative live
- derived live
- static demo
- fallback
- unavailable
- deprecated

No static/fallback metric may silently enter Intelligence 1.0.

---

## 140. Current Marketplace implementation lane boundary

At this plan's source anchor:

- PR #182 is the active Marketplace Reliability + Reference UX lane;
- PR #183 is the active Communications / Email lane.

The Marketplace PR does not constitute implementation of this Intelligence programme.

This plan must not be read as evidence that rich seller/dealer analytics has already shipped.

---

# PART XX — INPUT CHANNELS AND END-TO-END DATA FLOW

## 141. Twelve canonical input channels

The 24 data domains describe what the data means. The following 12 input channels describe how information enters CarUp.

| # | Input channel | Examples |
|---|---|---|
| 1 | User-entered forms | listing, profile, vehicle, quote/application data |
| 2 | User interaction events | search, impression, view, save, share, compare |
| 3 | Authoritative CarUp workflow writes | inquiry, work order, reservation, escrow, transaction |
| 4 | Communications | messages, delivery, response, workflow events |
| 5 | Vehicle/evidence/trust services | evidence, evaluated facts, Trust states |
| 6 | Business partner APIs | dealer, insurer, finance, supplier, garage systems |
| 7 | Payment/settlement integrations | attempt, settlement, refund, reversal |
| 8 | Government/institutional integrations | registry, clearance, duty/licence/inspection where authorized |
| 9 | Import/logistics integrations | shipping, customs, container, delivery |
| 10 | Marketing/referral attribution | campaign, QR, referral, source |
| 11 | Platform telemetry | errors, latency, job/provider health |
| 12 | Controlled derived analytics | rollups, benchmarks, deterministic insight rules |

The count is deliberately separate from field count. A later schema inventory will enumerate exact fields under these channels and the 24 domains.

---

## 142. Canonical end-to-end flow

    INPUT CHANNELS
    Forms | Behaviour | Business workflows | Communications
    Partners | Government | Payments | Logistics | Platform
                             │
                             ↓
                 AUTHORITATIVE DOMAIN SERVICES
                             +
                    GOVERNED ACTIVITY EVENTS
                             │
                             ↓
                 VALIDATION / DEDUPE / PRIVACY
                             │
                             ↓
                    INTELLIGENCE LEDGER
                             │
                 ┌───────────┼───────────┐
                 ↓           ↓           ↓
              Real-time    Rollups    Historical
                signals      KPIs       trends
                 │           │           │
                 └───────────┼───────────┘
                             ↓
                     INSIGHT ENGINE
                             │
            ┌────────────────┼────────────────┐
            ↓                ↓                ↓
        Dashboards      Communications      Gutu AI
            │                │                │
            └────────────────┼────────────────┘
                             ↓
                     NEXT BEST ACTION
                             ↓
                         OUTCOME
                             ↓
                  NEW GOVERNED SIGNALS

---

# PART XXI — DATA-POINT VALUE CATALOGUE

## 143. How to read this catalogue

For each signal CarUp should know:

1. what it represents;
2. who primarily benefits;
3. how CarUp uses it for marketing/product improvement;
4. how it can encourage better user/business behaviour.

This catalogue is illustrative but intentionally broad. I0/I1 converts it into the exact metric/event registry.

| Data point / signal | Direct stakeholder value | CarUp marketing/product value | Possible nudge/action |
|---|---|---|---|
| Search query | buyer demand | identify demand trends | recruit matching supply |
| Search filters | precise preferences | understand vehicle attributes users care about | ask sellers to complete commonly filtered fields |
| Zero-result search | unmet demand | sales/partner opportunity | recruit dealer/supplier inventory |
| Listing impression | discovery exposure | measure Marketplace reach | improve listing eligibility |
| Detail view | buyer interest | measure discovery quality | improve weak view rate |
| Engaged view | stronger attention | identify useful listing content | improve media/description |
| Save | durable interest | intent modelling | notify seller of rising interest |
| Unsave | cooling/changed interest | watchlist churn | review price/availability after sufficient data |
| Share | advocacy/consideration | organic reach | encourage shareable listing quality |
| Compare add | active evaluation | competitive set intelligence | show comparable positioning |
| Inquiry started | intent with friction possibility | form-funnel analysis | simplify abandoned lead flow |
| Inquiry created | qualified lead | partner ROI | respond quickly |
| Inspection request | high intent | transaction funnel | improve inspection availability |
| Reservation start | near-transaction intent | transaction friction | resolve readiness blockers |
| Reservation complete | strong conversion | Marketplace liquidity | continue transaction |
| Sale/transaction | authoritative outcome | GMV/conversion | aftersales owner journey |
| Listing created | seller activation | supply acquisition | complete listing |
| Listing submitted | seller progression | time-to-publish | resolve review blockers |
| Listing published | active supply | marketplace growth | promote/share listing |
| Listing paused | supply removal | churn/reason analysis | ask reason where appropriate |
| Listing sold | supply conversion | days-to-sale | capture outcome/aftersales |
| Price set | market offer | price distributions | confirm currency/price |
| Price change | seller response | before/after analysis | explain changed demand |
| Missing price/currency | weak discovery/clarity | product/data-quality issue | complete pricing |
| Mileage present/missing | buyer confidence/filtering | search eligibility | complete mileage |
| Transmission present/missing | matching | missed-filter analysis | complete specification |
| Fuel type present/missing | matching | demand segmentation | complete specification |
| Location present/missing | geographic relevance | regional demand | add selling/service location |
| Photo count | visual completeness | conversion analysis | add useful photos |
| Photo coverage | buyer inspection confidence | media-quality learning | add missing exterior/interior views |
| Broken/unusable media | degraded listing | UX reliability | replace failed image |
| Description completeness | buyer understanding | content-quality analysis | add useful vehicle detail |
| Evidence added | stronger provenance | Trust/readiness funnel | complete governed evidence |
| Evidence review pending | workflow blocker | operations backlog | await/respond to review |
| Trust evaluated | confidence state | relationship to conversion | show evaluation truthfully |
| Trust not evaluated | absence of evaluation | completion/readiness analysis | complete required evidence if applicable |
| Seller response time | lead handling | partner coaching | reply to waiting enquiries |
| Unanswered enquiry | lost opportunity | conversion leakage | respond now |
| Conversation progression | sales/service funnel | channel effectiveness | move to inspection/next step |
| Communication delivery failure | unreachable workflow | provider reliability | use allowed fallback/retry |
| Dealer inventory age | capital/supply issue | inventory liquidity | review aged stock |
| Dealer lead conversion | sales effectiveness | partner ROI | improve follow-up |
| Promotion impression | paid exposure | campaign reach | evaluate campaign |
| Promotion qualified lead | paid outcome | ROI | reallocate campaign spend |
| Garage profile impression | service exposure | services-market reach | improve business profile |
| Garage enquiry | service demand | service-market intelligence | respond/offer booking |
| Garage booking | service conversion | network value | manage capacity |
| Service completion | fulfilled work | retention/service quality | request review/next service |
| Repeat customer | loyalty | partner health | retention programme |
| Part search | parts demand | supplier recruitment | source missing inventory |
| Part zero-result | unmet demand | high-value supplier opportunity | onboard compatible supplier |
| Compatibility check | fitment intent | vehicle-parts graph | improve catalogue |
| Part RFQ | commercial intent | supplier ROI | respond/quote |
| Insurance surface view | product interest | partner exposure | continue quote |
| Insurance quote start | strong intent | insurance funnel | finish quote |
| Quote submission | qualified demand | partner ROI | insurer response |
| Policy bound | confirmed conversion | insurance revenue/ROI | renewal journey |
| Policy renewal | retention | partner value | renewal reminder |
| Claim opened | service/risk workflow | insurance operations | complete claim steps |
| Finance calculator start | finance interest | demand by price band | prequalify |
| Finance application | qualified lending demand | bank ROI | complete documents |
| Approval | lender outcome | conversion | accept/continue |
| Disbursement | completed finance | partner ROI | transaction completion |
| Payment attempt | payment intent | checkout conversion | resolve payment friction |
| Payment failure | transaction blocker | provider/UX issue | retry/alternate allowed method |
| Escrow funded | transaction confidence | SafePay conversion | continue governed process |
| Escrow dispute | risk | operational improvement | review case |
| Referral visit | acquisition | channel attribution | optimize referral programme |
| Referral qualified lead | valuable acquisition | campaign ROI | reward/refine source |
| Diaspora landed-cost calculation | import intent | corridor demand | offer RFQ/import next step |
| Import RFQ | trade lead | route/stock opportunity | respond/source vehicle |
| Container-space interest | logistics demand | capacity planning | match shipment capacity |
| Shipment milestone | process progress | logistics reliability | notify customer |
| Customs/clearance state | import progress | corridor bottleneck | complete missing requirement |
| Registry status known | compliance clarity | lifecycle intelligence | proceed with allowed action |
| Registry status unknown | missing authority | integration/data-gap measure | do not misstate; obtain authorized proof |
| Police clearance known | transaction/compliance | Trust/lifecycle | proceed/escalate according to source |
| Police status unknown | no authoritative knowledge | gap measurement | never render “failed” |
| Duty/tax evidence | import/ownership compliance | transaction readiness | complete requirement |
| Licensing/roadworthiness state | owner/compliance | retention/service opportunity | reminder when authoritative |
| Form-step abandonment | user friction | UX optimization | resume/help |
| Validation error | task blocker | form/product improvement | fix field/help copy |
| API/provider error | degraded workflow | reliability | operational remediation |
| Feature adoption | product usage | roadmap | education or simplification |
| Active/returning user | retention | growth health | personalized re-engagement |
| Churn/inactivity | retention risk | lifecycle marketing | relevant reactivation |
| Revenue/fee | CarUp business outcome | unit economics | strategy/pricing |

---

# PART XXII — CHURN AND RETENTION DEFINITIONS

## 144. “Churn” is not one number

CarUp must not place an undefined generic churn rate on dashboards.

Separate metrics include:

### Listing interest decay
Current-period discovery/engagement compared with prior period.

### Watchlist churn
Unsaves relative to active/new saves under a documented time window.

### Lead abandonment
Enquiries that never reach a defined next state.

### Buyer funnel abandonment
Drop-off between view, save, inquiry, inspection, reservation and transaction.

### Dealer/customer subscription churn
A business partner cancelling or ceasing a paid/active relationship.

### User churn
A previously active user failing the agreed meaningful-activity criterion over a defined period.

### Partner inactivity
Organization no longer publishing/responding/processing activity.

Every churn metric must define cohort, time window and denominator.

---

# PART XXIII — VISUAL REFERENCE MAPS

## 145. Universal stakeholder dashboard hierarchy

Every stakeholder dashboard should generally follow:

    ┌─────────────────────────────────────────────┐
    │ 1. Identity / context / period             │
    ├─────────────────────────────────────────────┤
    │ 2. Intelligence Pulse — 4–5 core KPIs     │
    ├─────────────────────────────────────────────┤
    │ 3. Needs Attention / Next Best Action      │
    ├───────────────────┬─────────────────────────┤
    │ 4. Core operation │ 5. Performance/trend  │
    ├───────────────────┴─────────────────────────┤
    │ 6. Recent activity                         │
    ├─────────────────────────────────────────────┤
    │ 7. Tools / secondary actions               │
    └─────────────────────────────────────────────┘

Do not turn every home dashboard into a dense analyst terminal. Deep analytics belongs in the Intelligence workspace.

---

## 146. Owner / Private Seller visual

    OWNER DASHBOARD

    [Needs Your Attention]

    ┌──────────── Marketplace Pulse ─────────────┐
    │ Views     Saves     Shares     Enquiries   │
    │ 186       23        8          5           │
    │ Trend: +31% vs prior period                │
    └────────────────────────────────────────────┘

    ┌──────────── Next Best Action ──────────────┐
    │ Strong discovery; enquiry conversion is   │
    │ below the comparison group.               │
    │ [Review listing]                           │
    └────────────────────────────────────────────┘

    [My Garage / Vehicles]
    [Trust & Evidence]
    [Saved Cars] [Recent Activity]
    [Insurance] [PartSentry] [Wallet]
    [Ask Gutu AI]

Listing row/card:

    2021 Toyota Hilux
    PUBLIC · Trust state: canonical only

    614 views | 91 saves | 34 shares | 22 enquiries

    Listing completeness: 82%
    Demand signal: Strong
    [Full insights]

---

## 147. Dealer visual

    DEALER PERFORMANCE — Branch / period

    Impressions | Views | Saves | Leads
    Inspections | Reservations | Sales

    [Top Performers]        [Needs Attention]

    LEAD FUNNEL
    Enquiries → Contacted → Qualified
    → Inspection → Reservation → Sale

    INVENTORY TABLE
    Vehicle | Price | Views | Saves | Leads | Days | Signal

Deep workspace tabs:

    OVERVIEW | INVENTORY | LEADS | AUDIENCE | MARKETING | BENCHMARKS

---

## 148. Mechanic visual

    WORKSHOP PULSE

    Profile views | Enquiries | Jobs booked | Completed
    Avg response | Repeat customers

    Popular services
    Demand by make/model
    Recent work orders
    Next Best Action
    Quick Actions

---

## 149. Garage visual

    GARAGE PERFORMANCE

    Search impressions | Profile views | Enquiries | Bookings
    Enquiry→booking conversion
    Repeat rate

    Top Services
    Capacity / demand
    Branch/team performance
    Busy periods
    Lost demand / unoffered services

---

## 150. Insurance visual

    INSURANCE MARKET PULSE

    Eligible exposures | Product opens | Quote starts | Qualified leads
    Policies/renewals only where authoritative

    Demand by vehicle/category
    Funnel
    Source/channel
    Territory aggregate

Separate navigation:

    COMMERCIAL INTELLIGENCE | CLAIMS | RISK | FRAUD

---

## 151. Bank / Finance visual

    VEHICLE FINANCE DEMAND

    Eligible sessions | Calculator | Applications | Approved
    Disbursed where authoritative

    Demand by price band
    Vehicle/category demand
    Application funnel
    Source attribution

Separate:

    COMMERCIAL INTELLIGENCE | APPLICATIONS | COLLATERAL | CREDIT RISK

---

## 152. Parts / Supplier visual

    PARTS DEMAND

    Searches | Product views | Compatibility checks | RFQs

    Top requested parts
    Zero-result demand
    Demand by vehicle
    Supplier conversion
    PartSentry/provenance state

---

## 153. Diaspora / Trade visual

    TRADE INTELLIGENCE

    Stock views | Landed-cost calculations | RFQs
    SafeTrade actions | Container interest | Completed imports

    Route demand
    Vehicle demand
    Funnel
    Shipment performance

---

## 154. Government visual

    VEHICLE GOVERNANCE / COMPLIANCE

    Known authoritative states
    Unknown/unavailable states
    Pending workflows
    Review/escalation
    Aggregate integrity trends

Institutional views must visibly distinguish:

- verified;
- pending;
- unavailable;
- unknown.

---

## 155. CarUp Admin visual

    CARUP AUTOMOTIVE INTELLIGENCE — ZIMBABWE / REGION

    Marketplace impressions | Unique shoppers | Active listings
    Active sellers/dealers | Leads | Transactions | GMV

    SUPPLY               DEMAND
    MARKETPLACE          LISTING QUALITY
    TRUST & EVIDENCE     COMMUNICATIONS
    TRANSACTIONS         DEALERS
    GARAGES              PARTS
    INSURANCE            FINANCE
    GOVERNMENT           DIASPORA
    REFERRALS            MARKETING
    CUSTOMER HEALTH      REVENUE
    RISK                 PLATFORM
    AI

This is the internal operating cockpit, not a public dashboard.

---

## 156. Mobile reference

Mobile should present decision-first information, not squeezed desktop charts.

Example:

    YOUR LISTING — Toyota Hilux

    This week

    186 Views  +24%
    23 Saves
    5 Enquiries

    Strong interest

    CARUP INSIGHT
    Your listing attracts viewers, but enquiry
    conversion is below the comparison group.

    [Review listing]

    RECENT ACTIVITY
    Today: 4 saves
    Yesterday: 1 enquiry
    Monday: 38 views

---

# PART XXIV — STAKEHOLDER × AUTHORITY × ACCESS MATRIX

## 157. Core access posture

Legend:

- P = produces/creates data
- C = consumes authorized intelligence
- A = authoritative source for some domain state
- G = governed aggregate/purpose-limited access
- — = no default access

| Stakeholder | Marketplace behaviour | Own business operations | Vehicle Truth/Trust | Financial data | Institutional/compliance | Cross-market aggregate |
|---|---|---|---|---|---|---|
| Anonymous visitor | P | — | public projection only | — | public only | — |
| Buyer | P/C own | C own | authorized/public | own transaction | own authorized workflow | — |
| Private seller | P/C own listing | C own | own/authorized | own transaction | own workflow | benchmark only |
| Dealer | P/C tenant | P/A own CRM-like states where integrated | authorized tenant | own business | own workflow | approved benchmark |
| Mechanic | P/C own | A work-order/service records | authorized service context | own business | — | approved benchmark |
| Garage | P/C org | A booking/service records | authorized | own business | — | approved benchmark |
| Parts supplier | P/C org | A catalogue/RFQ state | compatibility context | own business | — | demand aggregate |
| Insurer | C scoped | A policy/claim states if integrated | authorized underwriting context | own insurance | regulated scope | approved demand aggregate |
| Bank/finance | C scoped | A lending states if integrated | authorized lending context | A own finance | regulated scope | approved demand aggregate |
| Payment/escrow partner | limited | A provider transaction state | — | scoped transaction | — | — |
| Logistics/import partner | scoped | A shipment/service state | shipment context | scoped | customs workflow if authorized | route aggregate |
| Referral partner | C own attribution | A own referral participation | — | reward only | — | own aggregate |
| Government institution | — by default | institutional workflow | A for its official domain | only lawful scope | A for official domain | G where agreed |
| CarUp operations | scoped internal | C | C according to role | scoped | scoped | C |
| CarUp executive/data | aggregate by default | C aggregate | C aggregate | C aggregate | C aggregate | C |
| Gutu AI | no independent rights | derived from caller rights | derived from caller rights | derived from caller rights | derived from caller rights | only allowed aggregates |

The exact policy must be encoded in authorization, not left to UI convention.

---

# PART XXV — REPORTING AND MANUALIZATION

## 158. Three documentation layers

This canonical plan is the source document.

Future user documentation should be derived into:

### Builder Manual
For agents/engineers:
- metric contract
- event schema
- authorization
- instrumentation
- testing
- deployment/certification

### Operator Manual
For CarUp staff:
- Admin Intelligence
- investigation
- partner reports
- campaign analysis
- data-quality monitoring
- privacy/escalation

### Stakeholder Business Manual
For sellers/dealers/garages/insurers/banks/suppliers:
- what each metric means;
- what action to take;
- how to improve performance;
- what CarUp does and does not infer;
- privacy boundaries.

Do not maintain these as independent truths. They must trace back to the canonical definitions in this plan and the metric registry.

---

## 159. Weekly / monthly intelligence summaries

Potential seller summary:

- views
- saves
- shares
- enquiries
- strongest change
- one or two recommended actions

Dealer summary:

- portfolio reach
- top/weak stock
- leads/conversion
- response time
- marketing source
- demand opportunity

Garage summary:

- discovery
- enquiries/bookings
- top services
- capacity
- repeat rate

Partner summary:

- qualified exposure
- conversion
- source
- trend
- ROI where financially supported

CarUp executive summary:

- supply
- demand
- liquidity
- partner performance
- marketing
- product friction
- revenue
- risk
- system health

---

# PART XXVI — ONLINE REACH, AUTOMATION AND GLOBAL DATA PRODUCTS

## 160. Online-system reach

Once the governed intelligence foundation is reliable, CarUp can use it to improve online reach through authorized automation.

Examples:

- identify under-supplied vehicle categories and run targeted dealer acquisition campaigns;
- identify incomplete seller listings and send completion guidance;
- detect rising demand and recommend promotion inventory;
- produce dealer/partner performance reports;
- generate privacy-safe market content;
- personalize re-engagement based on legitimate lifecycle state;
- recommend finance/insurance/service next steps when relevant.

AI may help compose and prioritize outreach, but Communications/consent/suppression policies remain authoritative for delivery.

---

## 161. Future automotive data products

Potential future products, subject to governance and sufficient data quality:

- dealer market benchmark reports
- vehicle demand indices
- price movement indices
- average time-to-qualified-lead
- average time-to-sale where sale state is reliable
- parts-demand index
- service-demand index
- finance-demand index
- insurance-demand index
- diaspora corridor index
- aggregate regional vehicle-supply reports

These products must use minimum cohort thresholds and avoid re-identification.

---

# PART XXVII — IMMEDIATE NEXT ACTION AFTER PLAN APPROVAL

## 162. Before any source implementation

Once the owner approves this canonical plan and an implementation lane becomes available, the first engineering task is not “build dashboard charts.”

It is:

**I0 — Stakeholder × Process × Data × Authority inventory on live main/staging.**

The I0 deliverable must enumerate:

- exact database tables;
- exact existing events;
- exact APIs;
- exact dashboard fields;
- exact mocks/placeholders;
- exact role/tenant boundaries;
- exact missing events;
- exact retention/privacy classifications;
- exact data integrations available vs aspirational.

Only after I0 and I1 are approved should schema/instrumentation code begin.

This prevents future agents from getting lost, duplicating architecture or mistaking design intention for deployed capability.

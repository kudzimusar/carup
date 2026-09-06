# CarUp Trade OS — Cross-Border Trade & Shared Logistics Living Master Plan

**Status:** CANONICAL ACTIVE PLAN
**Version:** 2.0
**Date:** 2026-09-04
**Repository:** `kudzimusar/carup`
**Implementation branch:** `feat/trade-os-client-demo-convergence`
**Draft PR:** `#207`
**Current branch baseline at v2 promotion:** `255d903eee27579d28eb3685a0a6bc75061135c7`
**Production:** NOT AUTHORIZED / MUST REMAIN UNTOUCHED until a separate production gate
**Primary objective:** evolve the existing Diaspora Trade OS, Reverse RFQ and Container Co-Loading kernels into CarUp's complete cross-border sourcing, shared-logistics and trade operating system.

---

# 0. Governance — this document is the durable authority

This file is the governing product, architecture, implementation, UAT and operating manual for CarUp Trade OS from 2026-09-04 onward.

Version 1.0 of this file concentrated on recovering and converging the historical Container Co-Loading MVP for a same-day client demonstration. That work remains valid historical evidence in Git history and is summarized in §24. It is no longer the programme north star.

The business decision changed on 2026-09-04: a prospective Japan→Zimbabwe shared-container client accepted the CarUp proposition. The programme therefore moves from **demo convergence** to **production-intent Trade OS product development**.

Every human or AI implementation agent must:

1. Read this file completely before changing Trade OS code.
2. Use the phase ledger in this file as roll-call. Do not work from chat memory.
3. Do not create another master plan or competing Trade OS architecture document.
4. Mark `[x]` only when implementation and the required evidence exist.
5. Use `[~]` for partial/started and `[ ]` for not started.
6. Append a dated execution entry after each bounded implementation cycle.
7. Preserve existing hardened kernels unless evidence proves replacement is necessary.
8. Reuse canonical CarUp identity, tenant membership, Communications, Evidence/Drive, Intelligence, Vehicle Passport, Trust and navigation authorities.
9. Keep business identity separate from authorization roles.
10. Never fabricate payment, customs, carrier, Trust, reputation, shipment, compliance, capacity, ETA, cost or delivery state.
11. Treat UI usability and responsive geometry as product correctness, not cosmetic polish.
12. Keep production untouched until owner-authorized production readiness and cutover.
13. If implementation reality contradicts this plan, amend this file deliberately before diverging.
14. Preserve old evidence through Git history; do not keep obsolete checklists active merely because they once passed.

**Architectural rule:**

> One identity → one authoritative transaction → one evidence trail → one event stream → many projections.

**Product rule:**

> CarUp must translate ordinary human intent into trade objects. Users should not need to understand freight jargon, RFQ terminology, CBM mathematics, tenant roles, or internal table names to use the product.

---

# 1. Product north star

CarUp Trade OS is a **cross-border trade, sourcing, logistics and transaction operating system** connecting buyers, suppliers, shippers, logistics organisers and downstream operational partners from first demand through sourcing, booking, consolidation, shipment and destination handoff.

CarUp remains especially differentiated in automotive because it already has Seller, Marketplace, Vehicle Passport, Evidence, Trust, Parts and Zimbabwe vehicle-lifecycle foundations. However, **Trade OS logistics is not limited to automotive cargo**.

The winning positioning is:

> **Tell CarUp what you need to buy or move. CarUp connects the appropriate participants, preserves the transaction, coordinates the trade journey and carries the same data through sourcing, logistics and Zimbabwe handoff.**

CarUp is not the shipping line, customs authority, bank, insurer or freight forwarder unless CarUp later becomes a legally authorized provider of one of those services. The platform is the governed mediation, coordination, evidence, workflow and intelligence layer.

---

# 2. Two primary customer intents — procurement and logistics must not be conflated

The user must begin from an understandable intention, not from internal feature names.

## 2.1 Procurement: “I need to buy/find something”

```text
I need something
  → Request Quotes
  → qualified suppliers see the opportunity
  → questions / clarification
  → suppliers submit commercial offers
  → buyer compares offers
  → buyer accepts one offer
  → accepted quote becomes the operating order
  → payment / documents / logistics follow
```

Initial procurement scope remains CarUp's strongest verticals:

- vehicles;
- vehicle parts;
- mixed automotive orders.

Do **not** silently turn CarUp into a general Alibaba-style goods marketplace. General non-automotive sourcing requires a separate owner product decision. The logistics layer, however, may move broader eligible cargo that the user already owns or has sourced elsewhere.

## 2.2 Logistics: “I already have something and need to move it”

```text
I already own / bought cargo
  → Request Shipping or choose an available sailing
  → describe cargo in ordinary language
  → calculate/estimate dimensions if needed
  → qualified logistics providers / organiser respond or booking is requested
  → quote / booking decision
  → warehouse intake / measurement
  → consolidation / loading
  → shipment
  → destination clearance / handoff / delivery
```

Eligible logistics cargo may include, subject to organiser/carrier, safety, customs and law:

- vehicles;
- vehicle parts;
- household/personal effects;
- furniture/appliances;
- boxed goods;
- machinery/equipment;
- commercial/general cargo;
- other eligible cargo.

A user shipping household goods must not be forced through an automotive purchase workflow.

---

# 3. Actor model — relationships, not global role explosion

A cross-border transaction can involve several actors. One person/business may hold multiple relationships across different transactions.

## 3.1 Core actors

### Buyer / Importer
Requests or purchases goods and may become consignee/importer of record where legally applicable.

### Supplier / Seller / Exporter
Offers stock or responds to procurement requests and supplies goods.

### Shipper / Consignor
Person/business tendering cargo for transport. May be the buyer, supplier or another party.

### Consignee
Destination recipient for cargo. May be the buyer or another authorized recipient.

### Logistics Organiser / Freight Forwarder
Runs its own container or shipping operation, reviews bookings, coordinates cargo, capacity, documents, loading and shipment operations.

### Warehouse / CFS / Loading Team
Receives cargo, records condition/measurements, stores it, prepares consolidation and confirms loading events.

### Carrier
Physical ocean/road/air transport provider. Carrier facts must be recorded only when supplied/verified; CarUp must not imply carrier authority.

### Clearing Agent / Customs Broker
Handles destination/origin clearance where legitimately appointed.

### Delivery / Collection Partner
Handles destination collection or last-mile delivery.

### CarUp Platform Oversight
Support, reviewer, risk, dispute and governance authority. This is separate from the client's logistics operator role.

## 3.2 Identity and authorization model

Do not create `users.role = logistics_provider`, `shipper`, `consignee`, etc. merely to render labels.

Use:

```text
authenticated user
  + registration/commercial profile
  + organisation / tenant
  + tenant membership
  + transaction participant relationship
  + scoped permission/capability
```

Commercial identity and security role remain different authorities.

A Trade OS surface should show the context that matters to the transaction, for example:

```text
Hikari Co-Load Logistics
Logistics Provider
Japan → Zimbabwe Trade Operations
Signed in as Kudzie · Organisation Administrator
```

rather than presenting the operator primarily as “Car Owner.”

---

# 4. Canonical data ownership

Do not create shadow copies of authoritative facts.

| Concept | Canonical authority |
|---|---|
| Authenticated person | `users` |
| Signup/commercial context | `user_registration_profiles` |
| Organisation/operator boundary | canonical tenant/organisation + membership |
| Legacy trade profile extension | `diaspora_trade_profiles` until T1 convergence closes |
| Vehicle identity | canonical `vehicles` / VIN/chassis + Vehicle Passport |
| Seller/listing | Seller/Marketplace domain |
| Procurement/import demand/order | `diaspora_import_orders` |
| Supplier quote | `diaspora_import_quotes` |
| Seller stock | `diaspora_stock_items` + stock ledger |
| Container/sailing | `diaspora_container_shipments` |
| Cargo booking/reservation | `diaspora_cargo_reservations` |
| Shipment | `diaspora_shipments` |
| Shipment timeline | `diaspora_shipment_stage_events` |
| Documents | governed Trade/Evidence records; Drive stores files only |
| Human messages | canonical Communications conversation/message authority |
| One-way activity | event/outbox + Notifications |
| Audit | governed audit authority |
| Vehicle Trust | canonical Trust/Evidence authority |
| Trade/logistics reputation | separate derived business-performance authority |
| Intelligence | read-only projections over authoritative facts/events |
| Trade Graph | rebuildable derived graph, never source of truth |

---

# 5. Existing implementation that MUST be reused

Trade OS is not a greenfield build.

## 5.1 Procurement / Reverse RFQ kernel

Authoritative/current files include:

- `web/src/pages/diaspora/DiasporaReverseRfq.tsx`
- `backend/services/diaspora/diasporaBuyerOrderService.js`
- `backend/services/diaspora/diasporaRfqService.js`
- `backend/services/diaspora/diasporaDemandSupplyMatchingService.js`
- `backend/routes/diasporaBuyerOrderRoutes.js`
- `backend/constants/diaspora/diasporaRfqConstants.js`
- `web/e2e/diaspora-reverse-rfq.spec.ts`

Current backend strengths already include:

- buyer orders for `vehicle`, `parts`, `mixed`;
- origin/destination;
- make/model/year taxonomy normalization;
- budget/currency;
- urgency;
- requested part number;
- publish RFQ lifecycle;
- deterministic supply matching;
- seller quote drafts/submission;
- idempotent quote creation;
- quote amount/currency;
- valid-until;
- inclusions/exclusions;
- stock linkage;
- lead time;
- shipping terms;
- edit/withdraw rules;
- atomic acceptance of exactly one quote;
- rejection of sibling quotes;
- audit and entitlement gates.

Current UI exposes only a small fraction of that capability and must be treated as legacy product presentation, not the target design.

## 5.2 Container / shared logistics kernel

Authoritative/current files include:

- `backend/services/diaspora/diasporaContainerMarketplaceService.js`
- `backend/routes/diasporaContainerMarketplaceRoutes.js`
- `database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql`
- `web/src/pages/diaspora/DiasporaContainerMarketplace.tsx`
- `backend/tests/diaspora-container-marketplace.test.js`
- `backend/tests/diaspora-container-marketplace-auth.test.js`
- `tests/agents/45-trade-os-container-demo-staging.spec.ts`

Current hardened strengths include:

- create/list container sailings;
- rich cargo reservations;
- server-side import-order linkage authorization;
- participant-safe visibility;
- tenant-scoped logistics operator authority;
- atomic approval;
- volume and optional weight overfill protection;
- reject/cancel capacity release;
- audit;
- canonical notification/event integration;
- guided CBM calculation;
- operator manifest/booking detail;
- Trade OS workspace shell;
- responsive geometry gates;
- truthful booking-close semantics.

Capacity invariant:

```text
USED_VOLUME = sum(APPROVED reservation estimated_volume)
AVAILABLE_VOLUME = total_capacity_volume - USED_VOLUME
FILL_PERCENT = USED_VOLUME / total_capacity_volume
READY_TO_CLOSE = FILL_PERCENT >= 90%   # advisory indicator
FULL = FILL_PERCENT >= 98%             # advisory indicator
```

Only approved reservations consume capacity.

## 5.3 Other reusable Trade OS foundations

- seller stock + stock ledger;
- Stock Passport;
- Order Passport;
- trade documents/OCR;
- Google Drive provider + credential vault;
- payment milestone schema;
- shipment + stage events;
- SafeTrade foundations;
- Communications 2.0;
- Intelligence I13 diaspora trade projections;
- Trade Graph vocabulary and derived services;
- workbook import/export/dry-run foundations;
- entitlement/subscription guard;
- AI command draft/approval architecture.

---

# 6. Current gap register after v2 review

The product is materially stronger in backend capability than in product coherence.

| Gap | Current state | Required target |
|---|---|---|
| Programme scope | container/demo centric | full procurement + logistics OS |
| Actor model | buyer/seller/admin language | buyer, supplier, shipper, consignee, operator, warehouse, carrier, clearing, CarUp oversight |
| Trade identity | security role often visible | contextual commercial/transaction identity |
| Request Quotes | technical Reverse RFQ page | layman sourcing marketplace |
| Logistics RFQ | absent as first-class flow | “Ship something” request marketplace |
| Cross-tenant RFQ discovery | tenant filter blocks marketplace semantics | safe marketplace projection + governed quote capability |
| Buyer request capture | origin/make/model only in UI | guided requirement wizard |
| Seller RFQ feed | raw table + amount box | opportunity marketplace + relevance + detail |
| Quote composition | amount-only UI | full commercial proposal |
| Quote comparison | amount/status | apples-to-apples commercial comparison |
| Clarification | weak/absent | transaction-bound buyer↔supplier questions |
| Award conversion | quote acceptance exists | accepted quote → operating order/booking without re-entry |
| Cargo model | improved but still booking-centric | reusable cargo/item groups + measurement lifecycle |
| Pricing | mostly absent | rate/fee/markup/charge model |
| Warehouse | absent | intake, measure, discrepancy, storage/readiness |
| Loading | absent | load plan, actual loaded state, evidence, seal/reference |
| Shipment | data model exists | coherent operator + participant tracking |
| Customs | data fragments | checkpoints/doc requirements without false authority |
| Documents | tables/storage foundations | checklist/workspace + parties + status |
| Communications | event stitching exists | full transaction conversation lifecycle |
| Admin/operator | technically separated | dedicated control planes and oversight |
| Reputation | legacy/shadow concepts | governed trade/logistics performance authority |
| Intelligence | truth foundations | procurement + logistics operational projections |
| Commercial model | entitlements foundations | configurable plans/fees without hardcoding undecided business economics |

---

# 7. Global benchmark register — research snapshot 2026-09-04

Benchmarks are pattern references, not products to copy. CarUp must preserve its own Truth & Trust, Zimbabwe and automotive advantages.

## 7.1 Alibaba.com RFQ — procurement demand marketplace

Official references:

- https://buyer.alibaba.com/page/HowItWorks/Page.html
- https://seller.alibaba.com/rfq

Observed patterns:

- buyer posts a sourcing requirement to the marketplace instead of contacting one seller;
- sellers proactively browse relevant RFQs;
- seller profiles/verification signals help buyer assessment;
- detailed communication stays attached to sourcing;
- sellers submit detailed quotes, not merely prices.

**CarUp lesson:** Request Quotes must be a true buyer-demand marketplace with qualified seller opportunities, detailed requirements, business identity/evidence and on-platform communication.

## 7.2 uShip — ordinary-person shipping marketplace

Official references:

- https://www.uship.com/
- https://www.uship.com/learn/carriers/

Observed patterns:

- customer describes what needs moving;
- providers compete with quotes/offers;
- marketplace supports vehicles, furniture, equipment, freight and more;
- carriers can ask questions and submit quotes;
- customer compares and chooses provider.

**CarUp lesson:** logistics should start from “What do you need moved?” rather than requiring users to understand LCL/RFQ terminology.

## 7.3 Shiply — layman simplicity

Official reference:

- https://www.shiply.com/how-it-works

Observed patterns:

- “tell us what you need moved → compare quotes → choose”;
- wide cargo scope including furniture and cars;
- provider feedback/ratings help decision-making;
- the process is framed for ordinary users rather than freight specialists.

**CarUp lesson:** freight mathematics and terminology must be assisted. Estimated measurements and photos should be acceptable pending operator confirmation.

## 7.4 Freightos — international freight quote comparison

Official references:

- https://www.freightos.com/instant-freight-quote/
- https://www.freightos.com/forwarders/rate-quote/

Observed patterns:

- compare multiple freight-forwarder offers;
- compare price and transit time;
- all-in fee transparency is emphasized;
- quote, booking, tracking, support and documentation live in one journey;
- forwarder-side rate management/quoting uses a single source of truth.

**CarUp lesson:** a logistics quote is a service proposal with route, mode, timing, fees, inclusions and provider—not an amount field.

## 7.5 Maersk LCL — shared-container customer language

Official reference:

- https://www.maersk.com/transportation-services/ocean-transport/lcl

Observed patterns:

- explains LCL as smaller cargo sharing a container;
- customer pays for the space used;
- journey is described as Book → Load & consolidate → Ship → Deconsolidate & deliver;
- supports boxes, pallets/crates and shared capacity;
- emphasizes visibility and milestone tracking.

**CarUp lesson:** explain co-loading in ordinary language and show a real logistics lifecycle, not just CBM capacity.

## 7.6 Flexport Buyer’s Consolidation — operator control plane

Official reference:

- https://www.flexport.com/products/buyers-consolidation/

Observed patterns:

- groups multiple suppliers into consolidated containers;
- combines order/booking visibility with consolidation planning;
- exposes order/SKU-level visibility;
- operator workflows include CFS/value-added services and exception management.

**CarUp lesson:** logistics organisers need a control plane covering bookings, cargo readiness, consolidation, exceptions and loading—not merely a list of “container fillers.”

## 7.7 GoFreight — forwarder quotation operations

Official reference:

- https://gofreight.com/product/rate-management-quoting/

Observed patterns:

- centralized carrier rates;
- rate comparison;
- quote building with charges/markup;
- quote acceptance updates status;
- accepted quote converts to shipment without manual re-entry;
- downstream invoicing uses the same commercial data.

**CarUp lesson:** accepted proposals must become operational transactions without duplicating facts.

## 7.8 Benchmark synthesis

CarUp is not copying one competitor. The target combination is:

```text
Alibaba       → buyer-driven sourcing
uShip/Shiply  → ordinary-person transport marketplace
Freightos     → international quote comparison and fee transparency
Maersk LCL    → shared-container journey language
Flexport      → consolidation/operator control plane
GoFreight     → rate/quote-to-shipment operations
CarUp         → Vehicle Passport + Zimbabwe lifecycle + Trust + Evidence + Communications + Intelligence
```

---

# 8. Trade OS information architecture

Primary Trade OS entry must be intention-led.

Recommended authenticated Trade OS navigation:

```text
Trade OS
├── Overview
├── Request Quotes
├── Buyer Requests        # seller/supplier opportunity view
├── Shipping Requests     # logistics RFQs
├── Containers
├── Orders / Bookings
├── Shipments
├── Documents
├── Communications
└── Intelligence          # only measured facts
```

Do not expose routes that are not operational merely to fill navigation.

Public `/diaspora` may explain the service and provide qualified discovery. Authenticated operating routes belong in the Trade OS workspace shell, not the marketing footer/mega-nav shell.

Internal term **Reverse RFQ** may remain in code/domain docs. Primary buyer-facing UI should use **Request Quotes**. Seller-facing UI should use **Buyer Requests** or **Opportunities**.

Help copy may explain:

> “This process is commonly called a Request for Quotation (RFQ).”

---

# 9. Request Quotes / Reverse RFQ 2.0 — first-class product phase

This section is a complete product contract. `/diaspora/rfq` must not be merely restyled; its mechanics, data exposure and lifecycle must converge to this model.

## 9.1 Entry question

Buyer sees:

### What do you need help with?

**Buy something**
“Tell CarUp what you need. Suitable suppliers can send you offers.”

**Ship something**
“Already have the item? Ask logistics providers to help move it.”

The “Buy” path enters Procurement RFQ. The “Ship” path enters Logistics RFQ (T3). Do not mix their schemas or quote semantics.

## 9.2 Procurement request types

Initial supported request types:

- Vehicle
- Vehicle part(s)
- Multiple automotive items / mixed order

### Vehicle request wizard

Capture progressively:

1. **What vehicle are you looking for?**
   - make;
   - model;
   - acceptable year range;
   - condition preference;
   - variant/trim/fuel/transmission only if the buyer knows;
   - allow “I’m flexible / not sure.”
2. **Where should it go?**
   - source/origin preference if any;
   - destination country/city;
   - delivery/pickup preference if known.
3. **Budget and timing**
   - optional budget + currency;
   - urgency / needed-by date;
   - budget must not become a claim of purchasing power.
4. **Requirements**
   - free-text needs;
   - reference image where governed upload exists;
   - avoid duplicate fields already represented by canonical taxonomy.
5. **Review before publishing**
   - human-readable summary;
   - explain what sellers will see;
   - privacy preview;
   - publish action.

### Parts request wizard

Capture:

- part name in ordinary language;
- quantity;
- vehicle make/model/year/chassis/VIN where buyer knows it;
- OEM/part number if known;
- explicit **“I don’t know the part number”** path;
- new/used/OEM/aftermarket preference where relevant;
- photos/reference evidence where available;
- destination;
- required date/urgency;
- optional budget.

Where a CarUp Vehicle Passport exists, allow buyer to select their vehicle so compatibility facts can be linked rather than retyped.

PartSentry/compatibility assistance may help identify a part, but AI/compatibility inference must never be silently presented as verified fitment.

### Mixed/multi-item request

Allow an order to contain multiple requested lines without creating separate disconnected RFQs when the buyer wants one commercial offer.

Each line should support quantity and relevant vehicle/part references.

## 9.3 Draft vs publish

Buyer request lifecycle:

```text
DRAFT
→ READY_TO_PUBLISH
→ OPEN_FOR_QUOTES
→ CLARIFICATION
→ QUOTES_RECEIVED
→ AWARDED / ACCEPTED
→ CONVERTED_TO_ORDER
or CLOSED / CANCELLED / EXPIRED
```

Use existing authoritative statuses where possible; add new status vocabulary only when lifecycle semantics cannot be represented safely.

Publishing must create a safe marketplace representation. Draft/private data remains tenant/user scoped.

## 9.4 Safe marketplace projection — critical cross-tenant architecture

Current seller RFQ listing filters published orders to the seller's `tenant_id`, which is safe but prevents a genuine cross-tenant marketplace.

Do **not** solve this by removing tenant/RLS boundaries.

Target pattern:

```text
PRIVATE BUYER ORDER (authoritative)
      ↓ publish
SAFE RFQ MARKETPLACE PROJECTION
      ↓ qualified visibility
ELIGIBLE SELLER
      ↓ governed quote capability
SELLER QUOTE linked to authoritative order
```

The marketplace projection must expose only fields necessary to decide whether to quote, for example:

- RFQ reference;
- request category;
- product/vehicle requirements;
- quantity;
- destination;
- timing/deadline;
- buyer verification/business-class signal where policy permits;
- question/quote deadline;
- non-identifying buyer context needed to trade.

Do not expose private contact details, raw buyer IDs, unrelated tenant metadata, evidence files or hidden risk data.

Before implementation, inspect current RLS and tenant policies. Introduce the smallest governed cross-tenant publication bridge (server-side sanitized projection/view/capability) required to support marketplace visibility without granting sellers private order access.

## 9.5 Seller opportunity marketplace

Seller-facing title: **Buyer Requests** or **Opportunities**.

Do not show a raw table with `Demand | Origin | Amount`.

Each opportunity should communicate, for example:

```text
Honda Fit GD1 front shocks
Quantity: 20
Destination: Harare, Zimbabwe
Condition: New or quality aftermarket
Needed by: 30 Oct
Part number: Buyer does not know
Quotes received: 3
Request closes: 2 days
Buyer: Verified CarUp participant
```

Seller actions:

- **Prepare quote**
- **Ask a question**
- **Not relevant / hide**
- save/watch where useful

Opportunity feed should support deterministic filters where data exists:

- category;
- vehicle make/model;
- part number;
- destination;
- deadline;
- origin preference;
- compatible stock;
- seller's own relevance/match reason.

Do not fabricate demand counts or urgency.

## 9.6 Explainable matching

Existing matching is deterministic and must be preserved as a strength.

Current signals:

- make match;
- model match;
- year overlap;
- part-number match;
- available quantity;
- export readiness.

Planned measured additions where authoritative data exists:

- sufficient quantity;
- buyer destination/corridor;
- supplier location;
- condition requirement;
- deadline/lead-time compatibility;
- budget fit;
- verified stock/evidence state;
- compatible sailing/container option;
- supplier fulfillment history.

Internal numerical scores may rank results. Buyer/seller UI should explain them in human language:

```text
Strong match
✓ Correct vehicle model
✓ Required quantity appears available
✓ Stock recorded as export ready
✓ Supplier is near the requested origin
```

Do not present opaque AI percentages as truth.

## 9.7 Clarification / questions

RFQ is not a one-shot form.

Buyer and eligible seller must be able to ask questions before a quote is finalized.

Use canonical Communications, scoped to the RFQ/order reference. Do not create an RFQ-specific message table.

Examples:

- buyer: “Would aftermarket KYB be acceptable?”
- seller: “Do you need delivery to Harare or Beitbridge collection?”
- buyer: “I can accept 2019–2021 if mileage is under X.”

User-authored text must remain exact messages; system status events are separate notifications.

Privacy/anti-bypass policy must be explicit. Contact data should not be leaked simply because an RFQ was published.

## 9.8 Seller quote composer — commercial proposal, not amount box

Existing backend supports more than the current UI. Expose it coherently.

### Offer identity

- quote reference;
- supplier/business identity;
- linked Stock Passport/item where available;
- quote status: draft/submitted/withdrawn/accepted/rejected/expired.

### Product terms

- offered product/item description;
- quantity;
- condition/specification;
- substitutions/alternatives if allowed;
- stock evidence/passport linkage.

### Price

- unit price where relevant;
- quantity;
- subtotal;
- currency;
- taxes/fees only where the seller legitimately supplies them;
- total quoted amount.

### Logistics terms

- source/pickup location;
- shipping included/not included;
- delivery point/service level;
- expected dispatch/lead time;
- estimated delivery only when seller/provider can support it;
- shipping terms/Incoterm where applicable;
- potential compatible container/sailing if based on real capacity.

### Commercial terms

- valid until;
- deposit/payment expectation;
- inclusions;
- exclusions;
- warranty/returns where supplied;
- special conditions.

### Evidence

- stock photos/evidence;
- supplier identity/verification;
- export-readiness evidence where governed.

Draft must be editable. Submitted quote becomes immutable except through governed revision/versioning or withdrawal rules. Accepted quote cannot be silently edited.

## 9.9 Quote comparison — apples-to-apples and truth governed

Buyer comparison must not be “cheapest wins.”

Display real comparable dimensions such as:

| Dimension | Supplier A | Supplier B |
|---|---|---|
| Product price | recorded | recorded |
| Quantity | recorded | recorded |
| Shipping | included / excluded / unknown | ... |
| Quote total | recorded | recorded |
| Estimated landed cost | only if calculable from authoritative components | unknown otherwise |
| Dispatch / lead time | recorded | recorded |
| Quote valid until | recorded | recorded |
| Stock evidence | verified / seller-stated / unavailable | ... |
| Supplier reputation | governed trade reputation only | ... |
| Container option | real compatible sailing or not selected | ... |
| Inclusions | explicit | explicit |
| Exclusions | explicit | explicit |

Rules:

- unknown is shown as **Not provided / Not enough data**;
- no cross-currency comparison without an approved FX authority;
- no fake “best deal 92%” score;
- no vehicle Trust score used as supplier reputation;
- do not claim landed cost without duties/freight/fees data.

CarUp may provide deterministic highlights such as:

- lowest recorded quote total;
- fastest recorded lead time;
- most complete evidence;
- shipping included;

only when the underlying facts support them.

## 9.10 Award / acceptance

Existing atomic one-quote acceptance is a hardened kernel and must remain authoritative.

Acceptance should visibly explain what happens:

```text
Accept this offer
→ this supplier becomes the awarded supplier for the request
→ competing submitted quotes close/reject according to the governed lifecycle
→ an operating order/booking is created or activated from the same facts
→ payment/documents/logistics continue without re-entering product information
```

Accepted quote → operating transaction must preserve canonical IDs and references. Do not copy fields into unrelated shadow orders.

## 9.11 Seller quote management

Seller needs:

- Draft quotes;
- Submitted quotes;
- Won/accepted;
- Not selected;
- Withdrawn;
- Expired.

Existing backend edit/submit/withdraw rules should be exposed rather than ignored.

## 9.12 Notifications and Communications events

Required lifecycle events include at minimum:

- RFQ published;
- relevant seller opportunity surfaced where governed;
- seller asks question;
- buyer replies;
- quote drafted (usually no external notification);
- quote submitted;
- quote withdrawn;
- quote revised/versioned if introduced;
- quote accepted;
- competing quote not selected;
- RFQ closed/expired/cancelled;
- accepted quote converted to order/booking.

Use canonical domain-event → Communications/Notification architecture.

## 9.13 RFQ Intelligence

Measured projections may include:

- number of open requests;
- request categories;
- real quote counts;
- time to first quote;
- time to award;
- quote-to-award conversion;
- supplier response rate;
- destination/corridor demand;
- unmet demand where no qualified quote is received;
- price ranges only when currency/terms are comparable.

Never fabricate market demand from an empty or unreadable data source.

## 9.14 RFQ security invariants

Mandatory:

- private draft orders never appear in marketplace;
- safe marketplace projection excludes private buyer fields;
- seller cannot mutate buyer order;
- seller can access only their own quote details plus safe RFQ projection;
- buyer cannot edit seller quote;
- only buyer/order authority accepts quote;
- seller cannot accept own quote;
- cross-tenant marketplace visibility does not equal cross-tenant private record access;
- contact data remains governed;
- quote acceptance stays atomic/idempotent;
- accepted quote cannot be withdrawn/edited outside governed rules;
- all critical transitions audited.

## 9.15 RFQ 2.0 acceptance journey

Buyer:

```text
Trade OS
→ Request Quotes
→ Buy something
→ choose Vehicle / Parts / Mixed
→ guided request
→ review privacy + summary
→ publish
→ see request OPEN
→ receive seller question/quote
→ answer question
→ compare ≥2 quotes where fixtures permit
→ accept one
→ see accepted supplier and next operating step
```

Seller:

```text
Trade OS
→ Buyer Requests
→ discover qualified cross-tenant marketplace opportunity
→ open safe request detail
→ ask question
→ prepare detailed quote
→ save draft
→ submit
→ buyer sees it
→ seller sees accepted/not-selected result
```

Final staging proof must include adversarial tenant/privacy cases, not only happy-path UI.

---

# 10. Logistics RFQ — “Ship something”

Procurement and logistics RFQ share request/quote concepts but have different fields and participants.

## 10.1 Customer journey

```text
Ship something
→ What are you moving?
→ Where is it now?
→ Where should it go?
→ When?
→ Do you know dimensions?
→ calculate/estimate if not
→ service preferences
→ publish shipping request or choose compatible sailing
→ logistics providers/organiser respond
→ compare logistics offers
→ book
```

## 10.2 Cargo capture

Support:

- vehicle;
- parts;
- household/personal effects;
- furniture/appliances;
- boxes/cartons;
- machinery/equipment;
- pallets/crates;
- general eligible cargo;
- other eligible cargo.

Guided dimensions:

- quantity;
- length;
- width;
- height;
- unit cm/m;
- calculated estimated CBM;
- estimated total weight;
- multiple item groups;
- photos where governed.

Users may say “I don’t know.” Estimates remain estimates until operator/warehouse confirms actual measurements.

## 10.3 Logistics quote

A logistics offer may include:

- provider;
- service mode;
- route;
- origin service/pickup;
- destination service/delivery;
- container/LCL/shared-space option;
- cargo basis (vehicle, CBM, weight, package count);
- freight charge;
- handling;
- origin/destination charges;
- document fees;
- optional services;
- currency;
- transit time/estimated dates where supported;
- validity;
- inclusions/exclusions;
- conditions.

Unknown fees must not be hidden inside an apparently “all-in” total.

## 10.4 Connection to container marketplace

A logistics request may be matched to an existing real sailing when:

- route is compatible;
- booking deadline is compatible;
- capacity exists;
- cargo eligibility is compatible;
- operator actually accepts that cargo class.

Do not auto-approve based on matching alone.

---

# 11. Shared Container / Co-Loading product

Container Co-Loading becomes one logistics fulfillment mechanism inside Trade OS.

## 11.1 Sailing identity

A sailing/container may record:

- organiser;
- origin country/city;
- origin port/loading location;
- destination country/city;
- destination port/terminal;
- container type;
- total CBM;
- max weight;
- booking deadline/cut-off;
- loading window;
- planned departure;
- expected arrival when supplied;
- carrier/forwarder when supplied;
- booking/container reference;
- cargo eligibility notes;
- documentation requirements.

Unknown values display `Not recorded yet`.

## 11.2 Booking lifecycle

```text
REQUESTED
→ NEEDS_CLARIFICATION (if required)
→ APPROVED
→ INTAKE_PENDING
→ RECEIVED_AT_WAREHOUSE
→ MEASURED / DISCREPANCY
→ READY_FOR_LOADING
→ LOADED
→ SHIPPED
→ DESTINATION_PROCESSING
→ RELEASED / READY_FOR_COLLECTION
→ DELIVERED / COLLECTED
```

Do not force all states into `diaspora_cargo_reservations` if shipment/warehouse authorities belong elsewhere. Use linked canonical operational records.

## 11.3 Operator manifest

Operator needs a true control plane showing:

- booking/reference;
- participant identity;
- cargo description/category;
- estimated vs actual CBM/weight;
- linked order/vehicle;
- approval state;
- document readiness;
- payment/charge state only where real;
- warehouse/intake state;
- loading readiness;
- exceptions;
- last activity;
- Communications entry.

---

# 12. Order / Booking Passport

The current Order Passport must evolve into the transaction-facing record that prevents fragmented workflows.

It should aggregate, subject to authorization:

- request/specification;
- buyer/participant identity;
- supplier/provider;
- quotes and accepted offer;
- cargo booking;
- container/sailing;
- shipment;
- documents;
- payment milestones;
- compliance checkpoints;
- Communications reference;
- exceptions/disputes;
- Zimbabwe handoff;
- Vehicle Passport linkage where applicable;
- audit/evidence timeline.

Accepted quote and container reservation must appear as linked facts, not manually re-created copies.

---

# 13. Commercial quoting, rates and charges

The full product needs a governed commercial model.

## 13.1 Rate sources

Potential sources:

- operator-maintained route rates;
- carrier/forwarder rate cards;
- manually prepared quote components;
- future provider/API rates.

Every rate needs provenance and validity.

## 13.2 Charge components

Examples:

- base freight;
- CBM charge;
- vehicle fixed charge;
- origin handling;
- warehouse/CFS handling;
- loading;
- documentation;
- inland pickup;
- destination handling;
- customs brokerage service fee;
- last-mile delivery;
- storage;
- optional insurance service.

Do not hardcode a commercial model before owner/client rules are approved.

## 13.3 Quote → booking conversion

Borrow the proven GoFreight pattern conceptually:

```text
rate/offer
→ quote
→ customer accepts
→ operational booking/shipment uses same terms
→ invoice/payment milestones reference same charge objects
```

No re-entry.

---

# 14. Documents and Evidence

Use CarUp's governed Evidence/Drive provider architecture.

Potential document checklist by transaction may include:

- purchase invoice;
- commercial invoice;
- packing list;
- export certificate;
- vehicle title/export certificate;
- inspection evidence;
- bill of lading;
- customs declaration;
- duty/tax proof;
- warehouse receipt;
- loading evidence;
- delivery/collection evidence.

Rules:

- document type/status belongs to CarUp metadata authority;
- Google Drive/other provider stores file objects;
- private documents remain private;
- checksum/provenance where available;
- verification state is separate from uploaded/present state;
- missing document ≠ failed document;
- upload does not imply customs approval.

---

# 15. Warehouse, intake and measurement

A shared-container operator needs a real origin operations workflow.

Planned capability:

- intake appointment/reference;
- receiving location;
- cargo arrival time;
- receiver/staff identity;
- photos/evidence;
- package/item count;
- estimated vs actual dimensions;
- estimated vs actual weight;
- discrepancy reason;
- condition on receipt;
- rejected/conditional cargo;
- storage location;
- readiness checklist;
- special-handling notes.

Actual measurement must be a separate governed fact from customer estimate.

If actual CBM changes materially, the system must surface an exception and any commercial implication rather than silently overwrite the customer's estimate.

---

# 16. Loading and consolidation

Planned capability:

- approved/ready cargo pool;
- container load plan;
- cargo placement/reference;
- loaded/not-loaded state;
- actual loaded CBM/weight;
- load photos/evidence;
- container/seal reference;
- rejected/left-behind cargo;
- exception notes;
- booking close;
- transition to shipment.

The existing atomic capacity kernel remains the booking-capacity guard; warehouse/load facts may refine actual capacity through a governed reconciliation path.

---

# 17. Shipment and tracking

Use existing shipment/stage tables rather than inventing a new tracker.

Operator view:

- whole-container/shipment timeline;
- participant/cargo manifest;
- outstanding documents/actions;
- exceptions;
- carrier/reference facts;
- current authoritative stage.

Participant view:

- only their cargo/order;
- meaningful shipment milestones;
- requested actions;
- documents/status where authorized;
- communication;
- expected dates only when real.

Never infer physical location from a status label.

---

# 18. Customs, destination and Zimbabwe handoff

CarUp coordinates evidence/checkpoints; it does not self-declare customs clearance.

Potential checkpoints:

- arrival notice;
- customs documents received;
- broker assigned;
- declaration submitted;
- assessment/duty state when authoritative data exists;
- inspection hold;
- clearance/release evidence;
- collection/delivery readiness;
- final handoff.

Vehicle cargo additionally connects into:

```text
import in transit
→ arrived/customs pending
→ customs cleared/CVR pending
→ CVR/plate pending
→ locally registered
→ Vehicle Passport / ownership lifecycle
```

Container/shipment facts provide provenance; they do not directly alter Vehicle Trust.

---

# 19. Communications

Trade OS uses canonical CarUp Communications.

Required conversation contexts:

- procurement RFQ buyer↔supplier;
- accepted order buyer↔supplier;
- logistics RFQ shipper↔provider;
- container booking participant↔organiser;
- warehouse/action clarification;
- shipment/destination exception;
- dispute/support escalation.

Status events remain system-generated notifications. Human messages remain exact user-authored messages.

Channels (web/email/WhatsApp/Telegram etc.) are delivery mechanisms, not separate business records.

---

# 20. SafeTrade, payments and disputes

SafeTrade must remain provider- and evidence-backed.

Potential lifecycle:

- quote accepted;
- deposit requested;
- deposit paid/confirmed only from real authority;
- balance milestone;
- shipment/document condition;
- release rule;
- dispute/hold;
- completion.

Do not activate fake settlement to make Trade OS look complete.

Dispute/exception types should eventually include:

- supplier non-performance;
- quote disagreement;
- damaged cargo;
- measurement discrepancy;
- prohibited/rejected cargo;
- missing documents;
- missed cut-off;
- storage/late fees;
- shipment delay;
- delivery/collection dispute.

---

# 21. Trust and reputation

Keep three concepts separate:

1. **Vehicle Trust** — vehicle/evidence authority.
2. **Trade/Supplier Reputation** — sourcing/fulfillment performance.
3. **Logistics Reputation** — provider/organiser operational performance.

Potential measured reputation inputs after sufficient real data:

- accepted orders fulfilled;
- on-time dispatch;
- quote accuracy;
- document completion;
- cancellations;
- disputes;
- warehouse discrepancies;
- shipment milestone performance;
- participant feedback.

Historical `diaspora_trade_profiles.trust_score` must not become a shadow universal Trust authority. Reconcile/deprecate it during T14.

---

# 22. Intelligence

Trade OS Intelligence must follow I13 Truth & Trust discipline.

Potential procurement intelligence:

- open RFQs;
- quote response rate;
- time to first quote;
- award rate;
- unmet demand;
- category/corridor demand;
- supplier fulfillment.

Potential logistics intelligence:

- sailing capacity utilization;
- requested vs approved capacity;
- booking conversion;
- measurement discrepancies;
- loading readiness;
- document blockers;
- shipment milestone delays;
- route/corridor demand;
- actual revenue/cost only from governed financial records.

No fake zeros on read failure. No cross-currency aggregation without FX authority. No graph-derived metric presented as transaction truth.

---

# 23. AI assistance

AI is an assistant, not the authority.

Useful low/medium-risk assistance:

- turn plain-language buyer request into a draft RFQ;
- suggest missing requirement questions;
- help identify likely part terminology;
- summarize quotes;
- explain trade terms in plain language;
- calculate cargo CBM from dimensions;
- prepare quote draft from approved rate/stock data;
- flag missing documents;
- summarize operator exceptions;
- suggest compatible real sailings.

AI may not:

- accept a quote;
- approve cargo;
- verify customs clearance;
- fabricate carrier rates;
- mark payment received;
- change Vehicle Trust;
- mark delivery complete;
- silently modify authoritative records.

All writes go through governed service workflows and confirmations/approvals.

---

# 24. Historical foundation — what the September container convergence already achieved

The v1 programme and owner-UAT correction cycle remain valuable foundations.

By branch head `255d903eee27579d28eb3685a0a6bc75061135c7`, the lane had materially established:

- dedicated authenticated Trade OS workspace shell for the client-demo routes;
- removal of public marketing footer/mega-nav from the operational container flow;
- geometry gates at 393, 820, 1024, 1280, 1366, 1440 and 1536 widths;
- logistics-provider business identity separate from `users.role`;
- tenant-scoped operator authority;
- broader cargo categories;
- guided CBM calculation;
- richer sailing identity;
- operator manifest/booking detail;
- safe server-side import-order linkage checks;
- canonical container booking events/notifications;
- recovery-safe migration behavior;
- atomic volume/weight overfill protection;
- real staging fixtures for Japan→Zimbabwe October/December sailings;
- unmocked staging test coverage;
- owner instruction that automated certification never overrides manual product UAT.

The old D0–D10 demo checklist is retired as an active roadmap. Git history retains the exact receipts.

---

# 25. Full product programme — T0 to T18

This replaces the old C1–C18 backlog as the active roadmap.

## T0 — Foundation inventory and invariants  ✅ COMPLETE

**Goal:** freeze what is authoritative before expansion.

- [x] Reconcile branch against current `main` without losing #207 work.
- [x] Inventory all Trade OS routes/services/tables/RLS/events/tests.
- [x] Mark authoritative vs legacy/duplicate surfaces.
- [x] Freeze security, audit, Trust and unavailable-vs-empty invariants.
- [x] Record migration state staging vs production.
- [x] Confirm current PR/build provenance.

**Evidence:** execution entry "T0 complete, T1 prerequisites complete, T2 implementation cycle 1" in §30.

## T1 — Trade OS workspace, actor and identity convergence

**Goal:** a coherent operating environment for procurement and logistics.

- [ ] Expand Trade OS workspace navigation per §8.
- [ ] Make contextual trade/business identity canonical across Trade OS surfaces.
- [ ] Reconcile `user_registration_profiles` and legacy `diaspora_trade_profiles` so identity facts are not duplicated authorities.
- [ ] Model transaction participant relationships for buyer/supplier/shipper/consignee/operator where existing participants table permits.
- [ ] Preserve tenant membership as business authorization boundary.
- [ ] Establish qualified seller/logistics-provider marketplace eligibility without global role escalation.
- [ ] Add responsive/geometry gates to all migrated Trade OS routes.

## T2 — Request Quotes / Reverse RFQ 2.0

**Goal:** make buyer-driven sourcing understandable and commercially complete.

- [ ] Replace primary UI term `Reverse RFQ` with `Request Quotes`; seller side `Buyer Requests`/`Opportunities`.
- [ ] Add intent entry: Buy something vs Ship something.
- [ ] Build guided Vehicle request wizard.
- [ ] Build guided Parts request wizard with “I don’t know the part number.”
- [ ] Build mixed/multi-line automotive request.
- [ ] Add draft/review/privacy-preview/publish lifecycle.
- [ ] Build safe cross-tenant published RFQ marketplace projection; do not broaden private tenant access.
- [ ] Build seller opportunity feed with filters and relevance explanations.
- [ ] Build safe RFQ detail page.
- [ ] Connect canonical RFQ conversation/questions.
- [ ] Build detailed seller quote composer using existing amount/currency/validity/inclusions/exclusions/lead-time/shipping terms/stock linkage.
- [ ] Add quote draft/edit/submit/withdraw UI.
- [ ] Add governed quote versioning/revision only if current immutable submission model requires it.
- [ ] Build apples-to-apples quote comparison with unknown semantics.
- [ ] Preserve atomic accepted-quote RPC.
- [ ] Convert accepted quote to operating order/passport without re-entry.
- [ ] Add lifecycle notifications/events.
- [ ] Add deterministic RFQ Intelligence projections.
- [ ] Add adversarial marketplace/privacy/RLS tests.
- [ ] Certify buyer + seller journeys on deployed staging desktop/tablet/mobile.

## T3 — Logistics RFQ / Shipping Requests

**Goal:** allow people who already own cargo to request transport.

- [x] Build Ship Something wizard.
- [x] Reuse guided measurement/cargo item groups.
- [x] Support vehicle and non-vehicle eligible cargo.
- [x] Build logistics-provider opportunity marketplace.
- [x] Build logistics quote schema/composer/comparison.
- [x] Match requests to compatible real container sailings where evidence permits.
- [x] Preserve operator approval as authority.
- [x] Connect canonical Communications.

**T3 acceptance ledger — these are deliberately NOT collapsed into one “done”:**

| Acceptance dimension | State |
|---|---|
| Implemented | ✅ head `5958e436` — owner UAT round 1 corrections |
| Tested locally | ✅ diaspora gate 1424/0/7 · T3-adversarial 21/21 · comms coverage 10/10 · migration-integrity 27/27 · browser 48/48 (incl. the new unreadable-sailings case) |
| Lint / typecheck | ✅ `tsc` clean, lint gate `NET_NEW_ERRORS=0` |
| CI proven | ✅ all 7 workflows green at `5958e436` |
| Adversarial security proven | ✅ 13/13 over HTTP, full §9 matrix |
| Responsive UAT proven | ✅ all seven contracted widths, one real 393px defect found and fixed |
| Staging migration applied | ✅ applied to STAGING ONLY; 3 tables `rls_enabled=true`, RPC service_role-only |
| Staging DB authority proven | ✅ award RPC exercised on real Postgres — see the cycle entry |
| Staging backend serves T3 | ✅ branch preview answers the T3 routes 401, not 404 |
| Staging frontend paired to that backend | ✅ PROVEN at runtime — preview calls ONLY the branch backend |
| Exact-head unmocked browser journey | ✅ spec 47, `mode=acceptance`, bundle `index-DbaX20hJ.js` pinned — **6/6** (both journeys × desktop/tablet/mobile) on the corrected build |
| Container-space conversion on staging | ✅ spec 47 carries the whole chain — REQUESTED consumes 0, replay idempotent, foreign sailing refused, approval consumes exactly the reserved volume |
| Trade OS route-boundary foundation | ✅ enforcement restored; nav visibility == typed-URL eligibility, pinned for all 7 roles |
| Staging taxonomy RLS drift | ✅ forward reconciliation applied; RLS on, anon/authenticated revoked, service_role preserved |
| Owner visual/product UAT | ⏳ ROUND 1 COMPLETE — 8 findings, all corrected at `5958e436`. **ROUND 2 REQUIRED.** Guide: `docs/trade-os/T3_OWNER_UAT_GUIDE.md` |

**T3 returns T3-PARTIAL.** Of the five items recorded in the closure correction, four are now
closed — shared-container conversion proof, route-boundary foundation, taxonomy RLS drift, and CI
on the final candidate. What remains:

1. **owner visual/product UAT** — see `docs/trade-os/T3_OWNER_UAT_GUIDE.md`.

Automation cannot close that row (§29), so T3 stays T3-PARTIAL until the owner records a verdict.
Do not describe T3 as client-ready, and do not begin T4, before then.

## T4 — Order & Booking Passport convergence

- [x] One operating record from awarded procurement/logistics quote.
- [x] Aggregate participants, quote, cargo, container, documents, milestones, communications and audit.
- [x] Prevent shadow duplication.
- [x] Deployed-staging evidence for BOTH origins (see §34).
- [x] Owner UAT PASS WITH FINDINGS; blocking comprehension findings closed (see §35). **T4-USABLE.**

Executed at `8fc31aaa`, certified at `3a3d729e`. Receipt:
`docs/trade-os/receipts/T4_ORDER_BOOKING_PASSPORT_CONVERGENCE.md`.

## T5 — Container Marketplace & Multi-Corridor Compatibility

**Approved implementation plan:** `docs/trade-os/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR_IMPLEMENTATION_PLAN.md`
(owner approved 2026-09-06). §40 of this file carries the reconciled contract; the slice-level
roll-calls live in the plan document and are mirrored here as the canonical exit record.

**Governing correction:** a customer's FINAL DESTINATION is not the destination of the individual
sailing they reserve capacity on. Harare stays Harare while the ocean leg ends at Beira or Durban.

- [x] T5.0 Governance reconciliation and frozen-baseline proof. (§40, `b3654376`)
- [x] T5.1 Authority/schema audit — recorded in the migration header; no corridor authority existed.
- [x] T5.2 Corridor reference contract (`diaspora_trade_corridors` + `_legs`; ordered legs; no preferred corridor).
- [x] T5.3 Sailing identity + lifecycle (DRAFT → BOOKING_OPEN → BOOKING_CLOSED / CANCELLED; ports promoted to columns).
- [x] T5.4 Corridor-aware discovery (`sailingRouteMatch`; both matching sites; no auto-book; onward legs stated as required).
- [x] T5.5 Mode compatibility (`roro` representable; a roro offer cannot attach a container sailing).
- [x] T5.6 Booking workspace / service-scope composition (leg vs final destination legible; REQUESTED vs APPROVED unchanged).
- [x] T5.7 Capacity kernel preserved + **the standing lifecycle gap CLOSED** (cancel/close, slot released).
- [x] T5.8 Privacy/anti-bypass (DRAFT invisible and unconfirmable; allow-listed corridor projection).
- [x] T5.9 UI/UX + seven-width responsive certification (21/21, visual review done).
- [x] T5.10 Deployed-staging certification **COMPLETE**, then re-certified after the F1/F2/F3
      closure on the exact paired candidate `5079b0b3` (§42). **Owner acceptance is the only
      remaining row** — automation cannot close it (§29).

**Exit gate (all 33 rows of the plan's §8, tracked verbatim in the plan document):** architecture
5 rows · corridor 5 · mode 2 · commercial compatibility 5 · sailing/capacity 8 · truth/security 8.
T5 verdicts: `T5-PARTIAL` / `T5-USABLE` (owner-recorded only; never production-ready by itself).

## T6 — Rates, commercial transparency, FX, landed cost and corridor economics

**Approved implementation plan:** `docs/trade-os/T6_RATES_PRICING_LANDED_COST_IMPLEMENTATION_PLAN.md`
(authorized 2026-09-06 at head `9baf6466`). §44 of this file carries the reconciled commercial
contract; the slice roll-call lives in the plan document.

**Objective:** make avoidable trade cost visible and competitively removable — without
manufacturing certainty.

- [x] T6.0 Commercial authority audit (§44) — no FX/charge/rate/landed/allocation authority existed.
- [x] T6.1 FX authority — ECB reference rates behind `FxRateProvider`, immutable snapshots, AVAILABLE/STALE/UNAVAILABLE.
- [x] T6.2 Canonical cost taxonomy (17 stages); unknown ≠ not-applicable, enforced by one shared rule.
- [x] T6.3 Structured charge components — one table, two nullable FKs, exactly-one-owner CHECK.
- [x] T6.4 Quote normalization + deterministic comparability (no false cheapest).
- [x] T6.5 Rate observations, classified and kept separate from provider quotes.
- [x] T6.6 Landed-cost estimate that names unpriced stages; customs firewall held.
- [x] T6.7 Corridor economics over the frozen T5 authority; uncertainty penalised.
- [x] T6.8 Deterministic, explainable advisor — no AI authority.
- [x] T6.9 Shared-capacity allocation, explicit bases only, exact reconciliation.
- [~] T6.10 Security, UI, migration gate and staging journeys COMPLETE; **owner UAT remains**.

**Exit gate:** the 28-row acceptance list in §44. Verdicts: `T6-PARTIAL` / `T6-USABLE`
(owner-recorded only; never production-ready by itself).

## T7 — Full Communications lifecycle

- [ ] Procurement conversations.
- [ ] Logistics request conversations.
- [ ] Container booking conversations.
- [ ] Warehouse/action requests.
- [ ] Shipment exceptions.
- [ ] Provider-channel routing only after canonical web record works.

## T8 — Documents & Evidence workspace

- [ ] Transaction-specific checklists.
- [ ] Governed upload/classification/status.
- [ ] Google Drive provider reuse.
- [ ] Verification vs presence semantics.
- [ ] Participant/privacy boundaries.

## T9 — Warehouse intake and measurement

- [ ] Intake appointment/reference.
- [ ] Receive cargo.
- [ ] Photos/condition.
- [ ] Actual measurement.
- [ ] Discrepancy workflow.
- [ ] Storage/readiness state.

## T10 — Consolidation and loading

- [ ] Load readiness.
- [ ] Load plan.
- [ ] Loaded evidence.
- [ ] Actual loaded CBM/weight.
- [ ] Seal/container reference.
- [ ] Left-behind/exception handling.

## T11 — Shipment and tracking

- [ ] Container → shipment transition.
- [ ] Operator timeline.
- [ ] Participant-specific tracking.
- [ ] Carrier/reference facts.
- [ ] Exception/action handling.

## T12 — Customs and Zimbabwe destination operations

- [ ] Document checkpoints.
- [ ] Broker/agent relationship.
- [ ] Clearance/release evidence.
- [ ] Collection/delivery.
- [ ] Vehicle Zimbabwe-readiness handoff.

## T13 — SafeTrade / payment milestones / disputes

- [ ] Provider-backed payments only.
- [ ] Deposit/balance milestones.
- [ ] Holds/release conditions.
- [ ] Dispute workflow.
- [ ] No fabricated settlement.

## T14 — Supplier and logistics reputation

- [ ] Separate from Vehicle Trust.
- [ ] Derive only from governed outcomes.
- [ ] Reconcile/deprecate legacy `diaspora_trade_profiles.trust_score` semantics.

## T15 — Trade Intelligence

- [ ] Procurement metrics.
- [ ] Logistics metrics.
- [ ] Container utilization.
- [ ] Document/exception bottlenecks.
- [ ] Real financial projections where authority exists.
- [ ] Preserve I13 truth rules.

## T16 — AI Trade Assistant

- [ ] Plain-language request drafting.
- [ ] Quote assistance.
- [ ] Cargo/measurement assistance.
- [ ] Exception summaries.
- [ ] Risk gates and confirmation.
- [ ] No autonomous authority.

## T17 — Commercialization and enterprise operations

- [ ] Subscription/entitlement activation.
- [ ] Organisation staff roles/permissions.
- [ ] Branch/location support.
- [ ] Configurable fees/plans.
- [ ] Enterprise APIs only after data contracts stabilize.

## T18 — End-to-end certification and production readiness

- [ ] Full buyer sourcing journey.
- [ ] Full supplier response journey.
- [ ] Full shipping-request journey.
- [ ] Full shared-container journey.
- [ ] Warehouse/loading/shipment/destination journey.
- [ ] Desktop/tablet/mobile owner UAT.
- [ ] Security/RLS/adversarial certification.
- [ ] Communications/evidence/intelligence regression.
- [ ] Staging provenance exact-head.
- [ ] Production migration/cutover plan.
- [ ] Separate explicit owner production authorization.

---

# 26. Immediate execution order after v2 promotion

The programme is broad, but implementation remains bounded and evidence-driven.

**Immediate next implementation cycle:** T0 → T1 foundations required for T2, then **T2 Request Quotes / Reverse RFQ 2.0**.

Do not begin T3–T18 merely because they are documented. T2 must be implemented as a complete vertical sourcing slice before moving deeper into logistics expansion.

Within T2, execute in this order unless repository evidence requires a narrow dependency adjustment:

1. current branch/main reconciliation and baseline tests;
2. RFQ/current RLS/security discovery;
3. Trade OS IA/navigation and contextual identity changes required by Request Quotes;
4. buyer-facing naming/intent architecture;
5. request wizard + draft/review/publish;
6. safe marketplace projection / cross-tenant seller visibility;
7. seller opportunity feed/detail;
8. canonical buyer↔seller clarification conversation;
9. detailed quote composer + draft/submit/withdraw;
10. buyer quote comparison;
11. atomic acceptance + accepted quote → operating order/passport;
12. events/notifications;
13. measured RFQ Intelligence;
14. adversarial and regression tests;
15. deployed exact-head staging UAT across desktop/narrow desktop/tablet/mobile;
16. update this plan with evidence and remaining T2 gaps.

---

# 27. UI/UX contract

Root `DESIGN.md` is the global authority. `docs/marketplace/MARKETPLACE_VISUAL_DNA.md` is a reference implementation, not a template to copy blindly.

Trade OS should feel unmistakably CarUp while using an operations/sourcing composition:

- deep navy/charcoal structural anchors;
- restrained CarUp orange for primary action/meaningful emphasis;
- editorial hierarchy rather than generic SaaS card walls;
- open compositions/dividers/bands;
- purposeful density for tables/manifests;
- clear status language;
- one primary action per decision region;
- no fake illustrations pretending to be evidence;
- conceptual process visuals are permitted where clearly illustrative;
- loading / empty / unavailable / pending are distinct;
- desktop, narrow desktop, tablet and mobile are deliberate layouts.

Hard geometry gate for operating routes:

```text
document.documentElement.scrollWidth <= window.innerWidth + 1
body.scrollWidth <= window.innerWidth + 1
```

plus bounded workspace/table/form regions at representative widths:

- 393×852;
- 820×1180;
- 1024×768;
- 1280×800;
- 1366×768;
- 1440×900;
- 1536×864.

Full-page screenshots must be reviewed by eye; locator visibility alone is insufficient.

---

# 28. Security and privacy invariants

Every phase must preserve:

- authenticated identity server-derived;
- tenant identity server-verified;
- business labels do not self-grant authority;
- private tenant data stays private;
- marketplace publication exposes a safe projection, not underlying private rows;
- transaction participants receive only scoped access;
- cross-tenant supplier/provider discovery is capability-based, not broad table access;
- spoofed role/tenant headers fail;
- user cannot accept/approve their own counterparty offer without legitimate separate authority;
- atomic quote acceptance and container approval stay atomic;
- private documents use governed access/signed URLs;
- unreadable state never becomes false empty;
- audit-critical transitions fail safely;
- no status implies payment/customs/shipment/delivery outside its authority.

Mandatory adversarial test classes:

1. anonymous;
2. wrong user;
3. wrong tenant;
4. spoofed tenant/role;
5. marketplace projection vs private order read;
6. seller A attempting seller B quote access;
7. buyer attempting seller quote mutation;
8. seller attempting quote acceptance;
9. accepted-quote mutation/withdraw attempt;
10. replay/idempotency;
11. container overfill/concurrency;
12. document leakage;
13. unreadable vs empty.

---

# 29. Testing and certification contract

Green tests are evidence, not a substitute for product judgment.

Each completed phase must include:

- targeted backend unit/integration tests;
- migration/RLS tests where schema/policies change;
- affected Communications tests;
- affected Intelligence tests;
- TypeScript/typecheck;
- relevant web unit tests;
- mocked Playwright for deterministic edge states;
- unmocked deployed staging browser journey;
- desktop/narrow desktop/tablet/mobile geometry;
- full-page visual evidence;
- console/page/API error gates;
- security/adversarial path;
- owner UAT before client/production claims.

Final report per bounded cycle:

```text
Candidate SHA:
Branch / PR:
Plan tasks moved:
Files changed:
Migrations:
Backend tests:
Web tests:
Playwright:
Staging FE:
Staging BE:
DB:
Pairing/provenance:
Security evidence:
Visual evidence:
Known limitations:
Production touched: NO
Next unchecked task:
```

No agent may call a phase client-ready solely because automated tests pass.

---

# 30. Change-control / execution ledger

Every implementation cycle appends an entry below.

## Programme decision entry — 2026-09-04 19:38 JST

**Decision:** prospective client accepted the shared-container CarUp proposition. Owner directed the programme to stop optimizing for a bounded demo and build the complete Trade OS feature.

**Plan change:** v1 demo-oriented plan promoted to v2 cross-border Trade OS product plan. The old D0–D10 checklist is historical. The active roadmap is T0–T18.

**Major expansion:** Request Quotes / Reverse RFQ 2.0 promoted to a first-class phase with:

- layman buyer language;
- Buy vs Ship intent separation;
- guided vehicle/parts/mixed procurement;
- safe cross-tenant RFQ marketplace projection;
- seller opportunity feed;
- explainable matching;
- canonical clarification conversations;
- detailed commercial quote composer;
- quote comparison;
- atomic award;
- quote→operating-order conversion;
- notifications/events;
- RFQ Intelligence;
- adversarial privacy/RLS gates.

**Benchmark basis:** Alibaba RFQ, uShip, Shiply, Freightos, Maersk LCL, Flexport Buyer’s Consolidation, GoFreight — official product pages reviewed 2026-09-04; see §7.

**Current branch:** `feat/trade-os-client-demo-convergence` at `255d903eee27579d28eb3685a0a6bc75061135c7` before this documentation commit.
**PR #207:** remains Draft.
**Production touched:** NO.
**Next unchecked task:** T0 baseline/reconciliation, then T1 prerequisites and T2 Request Quotes / Reverse RFQ 2.0.

---

## Execution entry — 2026-09-04 · T0 complete, T1 prerequisites complete, T2 implementation cycle 1

**Branch:** `feat/trade-os-client-demo-convergence` · Draft PR #207 · **Production touched: NO**

### T0 — Foundation inventory and invariants ✅

- [x] **Reconcile branch against current `main` without losing #207 work.** Local HEAD was
  `255d903e`; the remote branch had ADVANCED to `ed690b4a` (the owner's two retasking commits:
  the v2 master plan and the updated directive). Local was a strict ancestor with no local-only
  commits, so this fast-forwarded cleanly — no rebase, no force, nothing overwritten.
  `origin/main` is unchanged at `bb9d9900`; merge-base is still `bb9d9900`, so PR #207's base
  has NOT moved and no reconciliation against newer Seller/Marketplace/Passport/Communications/
  Intelligence work was required. Container Co-Loading correction work verified intact
  (`TradeOSWorkspaceLayout.tsx`, `tradeContextService.js`, `containerBookingNotifier.js`,
  migration `20260904100000`).
- [x] **Inventory Trade OS routes/services/tables/RLS/events/tests** — see the reuse map below.
- [x] **Mark authoritative vs legacy surfaces.** The legacy `/diaspora/rfq` page is the one
  surface found to be genuinely superseded (see T2.1); everything else is reused, not replaced.
- [x] **Freeze invariants.** Atomic accept-quote RPC, capacity kernel, audit, tenant isolation and
  unavailable-vs-empty semantics are untouched by this cycle.
- [x] **Record migration state.** Staging carries `20260904100000` (container convergence) and now
  `20260904180000` (T2). Production carries neither.
- [x] **Confirm PR/build provenance.** PR #207 Draft, base `main`.

**T0 baseline tests (before any T2 change):** `node --test backend/tests/diaspora-*.test.js` →
**1364 tests, 1357 pass, 0 fail, 7 skipped.**

### Authoritative reuse map (what T2 builds ON, never rebuilds)

| Concern | Authority reused | Evidence |
|---|---|---|
| Buyer request record | `diaspora_import_orders` (`order_type` already allows `vehicle`/`parts`/`mixed`) | `013_diaspora_trade_schema.sql` |
| Request lifecycle | EXISTING statuses + `metadata.rfq` — **no new status CHECK, no migration** | `deriveRfqLifecycle()` in `diasporaRfqConstants.js` |
| Quote record | `diaspora_import_quotes` (amount/currency/valid_until/inclusions/exclusions already present) | `013_diaspora_trade_schema.sql` |
| Award | `diaspora_accept_quote_atomic` RPC — untouched | `diasporaBuyerOrderService.js:acceptQuote` |
| Matching | `diasporaDemandSupplyMatchingService.js` — already deterministic and already returns human `reasons` | `scoreStockAgainstOrder()` |
| Vehicle taxonomy | `normalizeVehicleTaxonomyInput()` already called by `createBuyerOrder` | `diasporaBuyerOrderService.js:67` |
| Workspace shell | `TradeOSWorkspaceLayout` from the container cycle | reused, nav extended |

**Status-vocabulary decision (§9.3):** no migration needed. `IMPORT_REQUESTED` + `metadata.rfq.published=false` = DRAFT; `QUOTE_ISSUED` + published = OPEN_FOR_QUOTES; ≥1 submitted quote = QUOTES_RECEIVED; `SELLER_ASSIGNED` + `acceptedQuoteId` = AWARDED. The database keeps its own words; `deriveRfqLifecycle()` translates them for humans.

### T1 — prerequisites for T2 (only what T2 needs) ✅

- [x] Trade OS workspace navigation extended to the intention-led model (§8): Request quotes ·
  My requests · Buyer requests · Containers · Orders · Messages. Only working surfaces listed.
- [x] Sourcing routes live in the AUTHENTICATED workspace shell, not the public marketing shell.
- [x] Business/trade identity already canonical via `tradeContextService` (container cycle).
- [x] No new global buyer/supplier/logistics security role introduced.
- [x] Responsive geometry gate applied to the new surfaces.
- [ ] `user_registration_profiles` ↔ legacy `diaspora_trade_profiles` convergence — **deferred**,
  not required by T2 (T1 backlog).

### T2 — Request Quotes / Reverse RFQ 2.0 (cycle 1)

- [x] **T2.1 Information architecture.** `Reverse RFQ` retired from customer UI. Registry entry
  relabelled **Request Quotes** → `/diaspora/request-quotes`; new **Buyer Requests** entry for
  suppliers. `/diaspora/rfq` redirects (old links still land correctly) and the legacy page +
  its 4-test spec were REMOVED rather than left as a competing surface — two RFQ experiences
  would be exactly the comprehension failure the owner flagged. Manifest regenerated; drift gate green.
- [x] **T2.2 Request Quotes entry.** Buy something / Ship something, in ordinary language.
- [x] **T2.3 Vehicle request wizard.** Vehicle → destination → budget/timing → review, with
  "leave blank if flexible" and no jargon.
- [x] **T2.4 Parts request wizard.** Ordinary-language part name, quantity, condition, vehicle
  context, and an explicit **"I don't know it"** part-number path that is preselected and
  reassuring. A buyer's own CarUp vehicles can be selected so canonical identity is reused
  instead of retyped.
- [x] **T2.5 Multi-item request.** New additive table `diaspora_import_order_request_lines`
  (migration `20260904180000`) — a real relational model, because lines are matched, quoted and
  compared, so they are business data and not presentation metadata. One request, many lines.
- [x] **T2.6 Draft → review → publish.** Nothing publishes on first save. The review step carries
  a **privacy preview** naming exactly what suppliers will and will not see.
- [x] **T2.7 Safe marketplace projection — the critical security work.** See below.
- [x] **T2.8 Seller opportunity marketplace.** `Buyer Requests` with open/mine tabs, per-line
  requirement detail, quote counts, deterministic make filter, and teaching empty states.
- [x] **T2.9 Explainable matching.** Reasons in human language ("20 units required", "Buyer does
  not know the part number — your identification helps"). No opaque score is shown.
- [x] **T2.10 Buyer↔seller clarification — DONE in cycle 1b.** The blocker (the ensure endpoint is
  worker-secret guarded server-to-server, unreachable from the web client) was closed by adding the
  missing seam: `backend/services/diaspora/diasporaRfqConversationService.js` +
  `POST /diaspora/buyer-orders/:id/conversation`. It creates/reuses a CANONICAL Communications
  thread — `marketplace` workflow, `marketplace_inquiry` thread type, buyer/seller stakeholder
  contract, `subject_type: 'diaspora_rfq'` — with **no rfq_messages table and no feature chat**.
  One thread per (request, supplier) pair so competitors never read each other's clarifications.
  Participation is EARNED: the buyer must own the request and a supplier must be able to see it in
  the marketplace (published + open + not awarded); anyone else is refused. The supplier's
  "Ask a question" now creates the real thread and hands them to the canonical inbox where
  questions are actually read and answered.
- [x] **T2.11 Quote composer.** A real commercial proposal: description, quantity, unit price,
  total, currency, condition, dispatch lead time, shipping included/excluded/**not stated**,
  validity, inclusions and exclusions. Backed by additive REAL COLUMNS (`offered_quantity`,
  `unit_price`, `lead_time_days`, `shipping_included`, `offered_condition`,
  `offered_description`, `stock_item_id`) so comparison compares data, not prose.
- [x] **T2.12 Quote lifecycle.** Draft / submit / withdraw exposed in "My offers", with won and
  not-selected outcomes derived from authoritative order state.
- [x] **T2.13 Quote comparison.** Real dimensions side by side; a term the supplier did not state
  renders **"Not provided"**, never a favourable default. Deterministic highlights only
  ("Lowest recorded total", "Fastest stated dispatch", "Shipping included") and each is suppressed
  when the data cannot support it — with only one stated lead time there is nothing to be fastest
  against, so no claim is made. Mixed currencies are flagged and never silently compared.
- [x] **T2.14 Atomic supplier selection.** The hardened RPC is untouched and now driven from the
  comparison surface, with the consequences stated before the click.
- [x] **T2.15 Order Passport continuation.** After award the mental model changes: a truthful
  stage list (Request ✓ · Supplier ✓ · Order in progress · Shipping/Documents/Zimbabwe **not
  started**) and a direct route into the order. No re-entry of any fact.
- [x] **T2.16 Notifications/Communications events — DONE in cycle 1c.** `rfqLifecycleNotifier.js`
  emits three canonical outbox events after the audited mutation — `quote_submitted` (the BUYER is
  told an offer arrived; a DRAFT is private to the supplier and emits nothing), `quote_accepted`
  (the winner), and `quote_not_selected` (every other supplier — silence would leave them chasing
  a closed request). Subscribed with in-app-only policies on the `marketplace_inquiry` thread type
  using a governed `rfq_update_v1` template with the same required variables as the container
  template, so a missing value can never render a blank claim. Not emitted on an idempotent
  acceptance replay, so a retry never re-notifies. Coverage gates (emitter literal, C1
  addressability, policy/template/classification) green.
- [ ] **T2.17 RFQ Intelligence** — not started; deliberately not faked.
- [x] **T2.18 Responsive.** Geometry gate (document/body scrollWidth ≤ viewport + 1) at 393 /
  1024 / 1280 / 1440 across the supplier surface incl. the open composer.
- [x] **T2.19 Adversarial security certification.** 18 new tests, all passing.
- [x] **T2.20 Real staging journey — CERTIFIED (cycle 1d).** Spec 46 on the deployed exact-head
  pair: **16 passed / 0 failed**, retries 0, across chromium + tablet (820×1180) + Pixel 5. The
  buyer and supplier are in two DIFFERENT tenants, so the cross-tenant claim is proven against the
  real database rather than a mock.

### T2.7 — the safe cross-tenant marketplace (security decision, recorded)

**What was wrong.** `listRfqs()` did `select('*')` and filtered in JS by
`o.tenant_id === context.tenantId`. That had two consequences: a supplier could only ever see
their OWN organisation's requests (so a marketplace was impossible), **and** a supplier with no
tenant context received the FULL private order row — buyer id, VIN, chassis, auction lot,
internal metadata — for every published request in the system.

**What was done.** One change, two halves, because widening discovery without sanitizing would
have deepened the leak:

1. `projectRfqForMarketplace()` — an **allow-list** projection. A column added to
   `diaspora_import_orders` in future cannot leak by default, because nothing spreads the row.
2. The same-tenant filter is replaced by the real marketplace rule: **published + open +
   not-your-own**, returning only the projection.

Budget is exposed **only** when the buyer explicitly opted in (`metadata.rfq.discloseBudget`) —
a budget is a negotiating position, so silence stays silence. Competitor detail is reduced to a
count of submitted offers; amounts and identities never cross. RLS is untouched; the new table
denies `anon`/`authenticated` outright so a direct PostgREST read cannot bypass the projection.

**Proof:** `backend/tests/diaspora-rfq2-marketplace-projection.test.js` — 18 tests including an
allow-list assertion over returned keys (a future leak fails the test), a serialized-secret scan,
the tenantless-supplier case that closes the old leak, budget privacy both ways, competitor
privacy, buyer-cannot-use-supplier-endpoint, and line-level privacy.

### Evidence

- **Backend:** T2 projection suite **18/18**; RFQ suite 14/14; migration integrity green;
  full diaspora suite **1382 tests, 1375 pass, 0 fail, 7 skipped** (baseline 1357 pass → +18, no regressions).
- **Web:** `tsc --noEmit` clean; nav/drift/footer unit tests 17/17; **T2 mocked e2e 18/18, no flakes**,
  including the geometry gate and the comprehension regressions.
- **Migration:** `20260904180000` applied to staging `eoyenigwevnxwwhyhaer`. Production untouched.

### Cycle 1b additions (after the discovery workflow's independent review)

A parallel 8-dimension discovery workflow re-read the September code and independently confirmed
the two load-bearing decisions — the service-role sanitized allow-list projection ("already
implemented and is correct; adopt it") and leaving RLS untouched ("weakening RLS would buy nothing"
since diaspora services read through the service role, so the JS projection IS the boundary). It
also surfaced two things worth acting on, both now fixed:

- **Canonical taxonomy reuse.** The vehicle/parts wizards captured make and model as FREE TEXT,
  which the deterministic matcher could never match against stock (`scoreStockAgainstOrder`
  compares normalized make/model) and which the plan forbids as a second taxonomy. Both now use
  the canonical `VEHICLE_MAKES` / `modelsForMake` selects from `@/data/vehicleTaxonomy`, with
  model gated on make and an explicit "I'm flexible / not sure" option.
- **`useCarUpApi` aggregate hazard.** The retired page destructured the whole hook object (which is
  a fresh unmemoized literal each render) and had an unbounded refetch loop. All four new Trade
  surfaces destructure individual functions — verified.

### Cycle 1d — T2.20 deployed staging certification

**Candidate:** `50c4a784` · FE `carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app`
(bundle `index-DG_GYu40.js`) ↔ BE `carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app`,
both verified at the same SHA, `unpaired: false`. DB staging `eoyenigwevnxwwhyhaer`. Production untouched.

**Identities (separate tenants, which is the whole point):**
`tradeos.rfq-buyer@carup-staging.test` (tenant `…c03`) and `tradeos.rfq-supplier@carup-staging.test`
(tenant `…d04`). Passwords local-only in gitignored `.staging-auth/`.

**Proven on the deployed pair (16/16):** anonymous denial · buyer publishes a parts request with NO
part number · a supplier in ANOTHER tenant discovers it · **the API response carries no buyer id,
tenant, email or name, and an undisclosed budget does not cross** (asserted on the wire, not the
DOM) · marketplace visibility does NOT grant private-record access (direct probe refused) ·
supplier sends a real commercial offer (quantity/unit price/lead time/shipping persisted as
columns) · buyer compares on stated terms and selects · **atomic award holds — a second, different
acceptance is refused** · awarded request leaves the marketplace while the supplier still sees they
won · hard geometry gate at 393/820/1024/1280/1366/1440/1536 · full-page visual evidence on
desktop, narrow desktop, tablet and mobile.

**Defect found by reviewing that evidence (not by an assertion):** a parts request was titled by
`requested_make` ("Honda") instead of what the buyer actually asked for ("Front shocks"). Titles
now prefer the line description for parts/mixed requests and reserve make/model for vehicle
requests, on both the detail and list surfaces.

**Known limitations (honest):** T2.17 RFQ Intelligence is not started and deliberately not faked.
Legacy staging requests created before T2 carry no request lines and some carry junk
`requested_make` values; the projection renders them truthfully ("Not provided" / "Not disclosed")
rather than hiding them, but they look thin next to a T2-created request.

**Next unchecked task:** T2.20 deployed staging certification (buyer + supplier journeys,
desktop/narrow/tablet/mobile, adversarial tenant cases), then T2.17 RFQ Intelligence.


---

## Execution entry — 2026-09-05 · T2 CLOSURE CYCLE (owner audit response)

The owner independently audited PR #207 head `3dd6138f` and found that T2.17 was not the only gap.
Twelve items were raised; all twelve are addressed below. **Production untouched. PR #207 Draft.
main untouched. T3 not started.**

### Reopened and now closed

**1. Linked-vehicle authorization — SECURITY BLOCKER (was: unauthorized write).**
`replaceRequestLines` wrote a caller-supplied `linked_vehicle_vin` directly; the UI only offering
the caller's own vehicles is presentation, not authorization. Every linkage is now resolved through
the CANONICAL `resolveVehicleObjectAuthority` before any write: a foreign VIN is **403**, an unknown
VIN is **404**, a failed lookup is a refusal (never a pass), and authorization runs for the whole
batch BEFORE the insert so one bad line cannot leave a partial write. Five adversarial tests,
including the all-or-nothing case. **T2.4 re-marked complete only now.**

**2. "Verified CarUp buyer" — REMOVED.** The projection derived `buyer_context.verified` from
`diaspora_import_orders.verification_status`, which verifies the ORDER, and the seller UI rendered
it as person verification. The person/business authority is `diaspora_trade_profiles`, which is
dormant — measured on staging: **5 profiles, 0 VERIFIED, and 0 VERIFIED orders**. There is nothing
truthful to publish, so the claim and the field are gone. A regression asserts an order marked
VERIFIED produces no verification signal, and the projection allow-list now rejects any
re-introduction.

**3. Supplier-specific matching.** `matchReasons()` restated the buyer's own request ("20 units
requested") as if it were evidence about the supplier. Replaced by `buildSupplierMatches()`, which
reuses the existing deterministic `scoreStockAgainstOrder` against the caller's **OWN published
stock only** (tenant-scoped, else `created_by`). The supplier now sees "You have 24 available —
Front shocks", the scorer's own reasons, and export-readiness. The numeric score sorts but is never
displayed; strength is worded. With no match the UI says **"No stock match confirmed yet"**. A test
plants a competitor's stock and asserts it never appears.

**4. Supplier identity in comparison.** Buyer-visible offers now carry `supplier` — display name
(organisation name where the supplier trades as a business), business type and country from the
canonical user/registration authorities — labelled *supplier-stated, not verified by CarUp*. No
email, phone, tenant data or invented reputation; a DRAFT quote gets no identity because it is not
an offer. Test asserts contact details and any score/rating/reputation string are absent.

**5. Buyer draft editing.** "Edit request" opens the wizard at `?edit=<id>`, hydrated from the
authoritative draft (route, lines, budget, disclosure choice, timing), and saving PATCHes the same
record instead of creating a duplicate.

**6. Supplier draft editing.** "Edit offer" reopens a DRAFT with its saved values and updates it
through the existing governed `updateQuote`; submitted and accepted offers stay immutable.

**7. Offer review before submission.** Prepare → **Review offer** → Submit. The review panel shows
exactly what the buyer will see, with unstated terms as "Not provided".

**8. Multi-item semantics — decided: option A, MULTIPLE PARTS.** Every non-vehicle line is written
as `item_kind='part'`, so the product now says so: "Several parts", "What parts do you need?",
"Add another part". True mixed vehicle+part sourcing is a later product decision, not something
this UI will advertise while writing parts.

**9. T2.17 RFQ Intelligence — measured only.** `sourcingRequestActivity()` extends the EXISTING
trade intelligence projection (no Trade OS analytics silo) with requests created, drafts,
open-for-offers, awarded, requests-with-an-offer, offers received, offers per quoted request,
published→offer and offer→award rates with explicit denominators, and median time-to-first-offer
computed only from requests that actually received one. Uses the shared `metric`/`rate`/
`unavailable` primitives, so a thin denominator returns INSUFFICIENT_DATA rather than a percentage
of three rows. No GMV, revenue, savings, supplier quality or market extrapolation.

**10/11. Both red CI checks were MINE, and both are fixed.**
- *Vehicle Passport Foundation → Diff hygiene*: trailing whitespace on 13 markdown lines in this
  plan (mostly the v2 promotion header). Stripped; `git diff --check` clean.
- *Navigation Intelligence → navigation-e2e*: the pinned dealer sidebar count was 16 and my new
  `diaspora.buyer-requests` entry made it 17. The pin is updated with a comment recording why.
  Neither was pre-existing; neither was dismissed.

### Evidence

- **Backend:** 5806 tests, **5782 pass, 0 fail**, 21 skipped (ci.yml env). New: 9 closure-security
  tests + the updated 18-test projection allow-list.
- **Web:** `tsc` clean; production build green; **mocked T2 e2e 25/25, no flakes**, including one
  regression per audit item 2–8.
- **Staging:** re-certified below.

**Remaining T2 gaps:** none of the twelve audit items. Trade-profile-backed supplier verification
stays absent until that authority is genuinely populated (recorded above as the condition).

### Cycle 1f — closing the CI triage properly, and one real defect it uncovered

The first attempt at items 10/11 was incomplete rather than wrong, and re-running the checks is
what exposed that. Recorded here because the failure mode is worth remembering: I fixed the half
of each problem I had looked at and assumed the other half did not exist.

- *Diff hygiene* rejected a second file. I had stripped this plan but not
  `docs/CLAUDE_CODE_TRADE_OS_CLIENT_DEMO_CONVERGENCE_DIRECTIVE.md`, which the same PR touches.
  Every `.md` in the PR diff is now stripped and `git diff --check` is clean.
- *navigation-e2e* rejected a second count. `diaspora.buyer-requests` registers with
  `roles: ['dealer', 'admin']`, so it moved **both** pins; I had re-pinned only dealer. All seven
  role counts were recomputed from the registry locally before pushing (owner 21, dealer 17,
  mechanic 5, insurance 4, government 14, admin 33, bank 4).

**The defect retries were hiding.** One mocked spec — "Ask a question creates a real canonical
conversation, not a dead button" — was passing only on retry. Run with `--retries=0` it failed 3
of 5 times, and the failure was the truth: the supplier landed on `/dealer`, not Communications.

`/dashboard/communications` is mounted inside the **owner-only** `DashboardLayout`, and no dealer
messages route exists anywhere in the app. So a supplier who clicked "Ask a question" *did* create
the canonical thread server-side and was then bounced to their dealer dashboard with no way to
open or answer it. The Trade OS shell's own "Messages" nav item and the container marketplace's
Communications link had the identical defect. This is precisely the dead button the test was
written to prevent, and the retry policy had been reporting it as green.

**Fix.** The canonical Communications page is already participant-neutral — it renders whatever
threads the server returns for the authenticated user. So the same component is now mounted at
`/diaspora/messages` inside the participant-neutral Trade OS shell, and the three Trade OS entry
points point there. No role was widened, no guard weakened, no second inbox built: thread
visibility is still decided server-side per participant. The registry entry carries
`placements: []`, so no sidebar count moves and the owner dashboard keeps its single Messages item.

**Hygiene failure in the same cycle, recorded rather than quietly repaired.** A `git add -A` swept
233 machine-local files into a commit — `.playwright-mcp` dumps, `.claude` and `.mcp.json` settings,
nine root screenshots — and the CR-1 credential gate correctly rejected it, because `.mcp.json`
names the production Supabase project ref in a command path. No credential was exposed: the
committed files contain no tokens, JWTs, service-role keys or env blocks, so no rotation is
required. Cleaning up, I then deleted a tracked `SKILL.md` that belongs to main (restored) and left
the screenshots tracked because `git rm` aborted on one nonexistent path with stderr suppressed.
Both corrected; `.gitignore` now covers the local state so `add -A` cannot repeat it.

**Evidence at this head:** previously-flaky spec 5/5 with `--retries=0`; mocked T2 e2e **40/40**
with retries disabled; registry + manifest drift **86/86** after regenerating
`shared/navigation/feature-manifest.json`; navigation map spec **16/16**; `tsc` clean; CR-1 secret
scan clean over 2585 tracked files; net PR diff 49 files with no machine-local paths.

### T2 closure evidence — head `a8805770`

**Exact-head pair, proven not assumed.** Frontend `carup-staging-mno4vnwzh-11-11.vercel.app`
(bundle `index-FUHWJvon.js`) against backend `carup-backend-staging-lk0l30j4f-11-11.vercel.app`,
whose `/api/health` reports `commit_sha: a8805770341866771ec8871f03221ff345930338` — both sides at
the certified head, with the bundle pinned through `STAGING_EXPECTED_BUNDLE`.

| Gate | Result |
| --- | --- |
| Spec 46 — T2 RFQ 2.0, deployed staging, cross-tenant | **19 passed, 0 failed** (26 skipped: tablet/mobile skip the serial journey) |
| Spec 45 — container co-loading, deployed staging | **17 passed, 0 failed**, excluding the two outbox-drain tests (see below) |
| CI at head | **15 checks green, 0 failures** (Passport, navigation-e2e, Secret scan all recovered) |
| Backend suite (CI env) | green in `Lint · Types · Build · Tests` |
| Mocked T2 e2e | **40/40 with `--retries=0`** |
| Registry + manifest drift + nav regression | **92/92** |

**What spec 46 now proves that it did not before:** a supplier opens Messages from the Trade OS
shell, lands on `/diaspora/messages` and the canonical Communications surface actually renders —
asserted on a real element, not just the URL; a supplier is not offered the owner-only "Orders";
and a buyer is not offered the dealer-only "Buyer requests".

**Honest gap.** Two spec 45 tests — the D7 organiser-directed notification and the participant
activity/communication state — require `TRADEOS_WORKER_SECRET` to drain the domain-event outbox
through the candidate runtime. That secret is configured in Vercel for this branch but is not
readable from this shell: `vercel env pull` returns empty placeholders for every encrypted
variable here (`JWT_SECRET`, `DATABASE_URL` and `SUPABASE_URL` all pull empty too), so this is a
local read limitation and NOT evidence that the deployment is misconfigured. The drain guard fails
closed by construction — `matchesPrimary` requires a non-empty configured secret AND a supplied
one — so an unreadable secret cannot leave the endpoint open. Those two tests were certified in
cycle 1d; they are not re-proven at this head, and the rest of spec 45, including the D9 passport
link, the geometry gate and the full-page visual evidence, runs and passes here.

**Local backend suite caveat, recorded so the number is not misread.** Run on this machine the
suite reports 5806 tests / 5771 pass / 14 fail / 21 skipped. All 14 sit in six files that need
services this machine does not have — a real Postgres (`password authentication failed for user
"postgres"`) and a live OCR provider (`fetch failed`) — and none is a Trade OS test. The same
suite is green in CI, which supplies those services; CI is the authority for this gate, and the
local run is reported here only so the discrepancy is explained rather than hidden.

## Execution entry — 2026-09-05 · T3 stabilization and completion cycle

Takeover at head `f6c10e9b` (the T3 implementation commits plus its receipt). This cycle stabilized
that head, reconciled the Container Co-Loading regression suite with the new Shipping information
architecture, and closed the three gaps the T3 receipt itself listed as outstanding.

### The head was red, and it was one cause, not six

Six workflows were failing at `f6c10e9b` — CI, Diaspora Phases 3-7 Validation, Referral Engine CI,
Navigation Intelligence CI, Vehicle Passport Foundation CI and Marketplace Reference Regression.
All six were **green at `cd450edd`**, the last commit before the T3 frontend landed. The single
cause was two unused imports in `TradeLogisticsProviderPanel` failing web TypeScript, which every
one of those workflows runs. Backend T3 was never implicated: migration sanity and the focused
Diaspora backend tests passed inside the same failing run.

Per §30's standing hazard note, the per-workflow baseline was established BEFORE attributing any
red gate to this branch.

### Two real defects the stabilization uncovered

1. **The provider default was dead by construction.** `TradeShippingWorkspace` seeded its tab from
   `useState(isProvider ? 'provider' : 'mine')`, but the shell fetches the trade context *after*
   the component mounts, so `isProvider` was always `false` at seed time; the corrective effect
   only ever moved provider → mine. A logistics provider could therefore never land on “Provider
   requests”, which is exactly what the receipt documented as the behaviour. The tab is now derived
   during render, and lives in the URL (`?view=`) so the three modes are linkable.

2. **The T3 wrapper bypassed the container product's access gate.** Before T3, an unauthorized role
   reaching `/diaspora/containers` got the hardened page's own access-denied state. The Shipping
   workspace renders first and opens on “My shipping”, and `TradeShippingRequests` has no role gate,
   so a `mechanic` received a working shipping-request surface. The workspace is now offered only to
   a role the Feature Registry admits to `/diaspora/containers` — the same rule the shell nav filters
   with — and every other role falls through to the container product, which remains the authority
   on its own access.

### Recorded gap, deliberately not absorbed into T3

`TradeOSWorkspaceLayout` passes `RegistryRouteBoundary enforceAuth={false}`, so **role checks are
skipped for every Trade OS route**, not just the container one. This predates T3 (introduced in
`77e85246`). Enabling enforcement is not a free correction: `reviewer` is not a valid `UserRole`
yet the container product authorizes it, so enforcement would bounce reviewers off the marketplace
they operate, and `government` off `/diaspora/request-quotes` and `/diaspora/messages`. It needs its
own decision plus registry reconciliation, and is listed here rather than silently fixed or ignored.
The API authorizes independently, so this is defence-in-depth, not the only control.

### Container Co-Loading reconciled with the Shipping IA

Thirteen container tests were failing. Audited individually: twelve were stale assumptions (they
reached for container test ids before opening Container space) and one was the real defect above.
The twelve now route through a shared `openContainerSpace()` helper — `/diaspora/containers` →
`shipping-tab-containers` → the existing assertions, unchanged and unweakened. Two regressions were
added: the unauthorized-role test now also proves the T3 wrapper leaks nothing, and an explicit
Shipping → Container space test proves the hardened product behind the tab still runs a real
reservation end to end. **16/16.**

Two further defects were found in the T3 spec itself and confirmed to be **already failing at
`f6c10e9b`** by re-running that exact tree: both tests read the captured mock payload straight after
`click()`, which returns on dispatch rather than round-trip completion, and `getByLabel(/Included/i)`
matched three elements.

### Receipt gaps closed

- **T2 → T3 handoff.** “Ship something” said multi-provider logistics quotation was “not available
  yet”. T3 built it, so the copy was false. The path now leads with *Ask providers to quote →
  Create a shipping request* and keeps *Find container space* as the direct second route. Ordinary
  language only: neither “logistics RFQ” nor “reverse RFQ” appears, and a test asserts it.
- **CarUp vehicle identity reuse.** A vehicle cargo group now offers the requester's own vehicles
  from `/api/vehicles/me`, whose scope (`owner_id` or `current_seller_id`) is a strict SUBSET of
  `resolveVehicleObjectAuthority`, so the picker can never offer a vehicle the server would refuse.
  Selecting one fills the description from the identity CarUp already holds. Three states stay
  distinct per §8: not-read, genuinely empty, and read-FAILED — and a failed read never blocks
  manual capture.
- **Lifecycle notifications — decided for T3, not deferred to T7.** T2 already tells a buyer when an
  offer arrives and tells every supplier whether they won; a logistics provider is in the same
  position, and asymmetry would be felt immediately. Three outbox events
  (`diaspora.logistics.quote_submitted` / `_accepted` / `_not_selected`) on the existing
  Communications authority — no new notification store, no second chat authority. A DRAFT emits
  nothing; a WITHDRAWN offer is never told it “lost”; an idempotent acceptance replay re-notifies
  nobody. T7 still owns warehouse, shipment exceptions and provider-channel routing.

### Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit -p web/tsconfig.app.json` | clean |
| `node scripts/lint-baseline-gate.mjs` | `NET_NEW_ERRORS=0` (repo errors 145 → 135) |
| `diaspora-logistics-rfq.test.js` | 12/12 |
| `diaspora-logistics-rfq-adversarial.test.js` | 13/13 |
| `diaspora-container-marketplace-auth.test.js` | 16/16 |
| `communication-event-coverage.test.js` | 9/9 (emitter-literal, C1 addressability, threadType DB CHECK, policy/template) |
| `trade-shipping-rfq.spec.ts` | 7/7 |
| `diaspora-container-marketplace.spec.ts` | 16/16 (14 preserved + 2 new) |
| `trade-request-quotes.spec.ts` | 25/25 |

Adversarial matrix proven over HTTP against the real router: private DRAFT unreadable by a provider
(list, direct and requester-read); projection carries no requester id/name/email/phone; a dealer is
not a logistics business; spoofed role and tenant headers manufacture no eligibility; a requester
cannot quote their own request; foreign / route-mismatched / closed sailings all refused with no
partial row; DRAFT price never reaches the requester; neither requester nor rival can edit an offer;
no self-award; acceptance takes exactly one and rejects every submitted sibling; a second award
cannot displace the first; a quote creates no reservation and consumes no capacity; an award books
nothing; request-space creates exactly one REQUESTED reservation and retries idempotently; a
REQUESTED reservation consumes no capacity; the requester cannot approve their own space and nor can
a rival organiser; all seven T3 surfaces answer 401 anonymously.

Responsive geometry proven at 393×852, 820×1180, 1024×768, 1280×800, 1366×768, 1440×900 and
1536×864 across the customer wizard (cargo, dimensions, route, review + privacy preview) and the
provider journey (opportunities, composer, offer review). It found a real 18px overflow at 393px —
the currency select composed `w-24` onto a class string already carrying `w-full`, which narrows
nothing — fixed at the root, not with `overflow-x-hidden`.

### Not done

Staging migration, staging backend/frontend provenance, the exact-head unmocked
requester→provider→offer→award→container-space journey, and owner UAT. **T3 = T3-PARTIAL.**

Production untouched. PR #207 remains Draft.

## Execution entry — 2026-09-05 · T3 staging schema activation, and three defects only a real database could show

Continues the stabilization cycle above. CI went fully green (7/7) at `658e2e44`, so the T3
migration was applied to **staging only**. Applying it, and then exercising it, found three
security/correctness defects that every local suite had been green through.

### 1. The migration shipped with no Row Level Security

`diaspora_logistics_requests`, `diaspora_logistics_request_items` and `diaspora_logistics_quotes`
were created without RLS, while every sibling Diaspora trade table has carried it since
`013_diaspora_trade_schema.sql`. That would have left the entire logistics demand book — requester
ids, tenant ids and linked vehicle VINs — readable with the anon key, which is precisely the
exposure the T3 marketplace projection exists to prevent at the API layer. An open table makes that
projection decorative.

RLS is now enabled on all three with the sibling `diaspora_platform_admin_access` policy.
Deliberately no owner-scoped policies: CarUp authenticates through its own backend, not Supabase
Auth, so `auth.uid()` is never populated for an ordinary user and such a policy could never match —
writing one would look protective without being so.

### 2. The award RPC was executable by `anon` and `authenticated`

`REVOKE ALL … FROM PUBLIC` is not sufficient, because Supabase applies DIRECT execute grants to the
API roles on a new function. Measured on staging after the first apply:

```text
diaspora_accept_logistics_quote_atomic     anon EXECUTE = true
diaspora_accept_quote_atomic               anon EXECUTE = false
diaspora_approve_cargo_reservation_atomic  anon EXECUTE = false
```

The named revokes from `20260621094000_diaspora_h7_rpc_execute_grants.sql` were applied; all three
now measure `anon=false, authenticated=false, service_role=true`.

### 3. The award RPC failed EVERY call — pgcrypto `search_path`

```text
SELECT diaspora_accept_logistics_quote_atomic(...)
ERROR: 42883 function digest(text, unknown) does not exist
```

The seal uses pgcrypto's `digest()`, but the function pinned `search_path = public, pg_temp`. On
Supabase pgcrypto lives in `extensions`. **T3's atomic award was 100% broken against a real
database while every local suite was green.**

`20260725120000_diaspora_rpc_pgcrypto_search_path_fix.sql` had already repaired exactly this for
five earlier RPCs, and its own comment records why it hides: the embedded-Postgres harnesses
install pgcrypto into `public`, where the bare name resolves. The T3 RPC was written from the
template of the functions that had the bug rather than the migration that fixed it.

`migration-integrity` now carries a guard — any migration function calling `digest()` while pinning
a `search_path` must include `extensions`, exempting functions repaired by a later compensating
`ALTER`. Proven non-vacuous: reintroducing the defect fails the gate and names the function.

### Staging DB authority — measured after the fixes

A synthetic fixture was built on the existing `SYNTHETIC` tradeos staging identities
(`u_tradeos_participant_b` as requester, `u_tradeos_operator` — a real `logistics_provider`
profile — and `u_tradeos_outsider` as competing providers):

```text
provider awards its own offer            refused DIASPORA_LOGISTICS/FORBIDDEN
PRIVILEGED provider awards its own       refused DIASPORA_LOGISTICS/SELF_AWARD
stranger awards someone else's request   refused DIASPORA_LOGISTICS/FORBIDDEN
NULL actor                               refused DIASPORA_LOGISTICS/UNAUTHENTICATED
  after all four: request still OPEN_FOR_QUOTES, 0 quotes altered

requester awards                         AWARDED, correct quote, ACCEPTED=1, REJECTED=1
audit                                    1 row, 64-hex-character cryptographic seal
idempotent replay                        returns true, writes NO second audit row
reservations created                     0 — an award is not a booking
```

Note the ordering the real function revealed: a provider is refused at the OWNERSHIP gate before
the self-award gate is reached, so `SELF_AWARD` is the deeper guard that still holds for an actor
who passes ownership. The first version of this proof asserted the wrong code; the function was
right and the expectation was wrong.

Fixture removed afterwards — 0 requests / 0 items / 0 quotes remain. The append-only audit row is
deliberately retained.

### Backend provenance

The branch auto-deploys to a stable Vercel alias
(`carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app`), so no shared
staging deployment was displaced. That preview answers `/api/diaspora/logistics-requests/mine` with
**401**, not 404 — the T3 routes are deployed and guarded.

### Still not done

The frontend/backend pairing is NOT proven (a branch web preview can silently call the shared
staging backend — see the standing hazard), the unmocked browser journey has not been run, and
owner UAT remains outstanding. **T3 stays T3-PARTIAL.**

### Unrelated finding, reported not fixed

Staging reports `public.vehicle_taxonomy_observations` with **RLS disabled** — fully exposed to the
anon key. It is outside the T3 slice and was not touched; enabling RLS without policies would block
its current readers, so it needs its own decision.

Production untouched. PR #207 remains Draft.

## Execution entry — 2026-09-05 · T3 deployed-staging certification (spec 47)

The T3 journey now runs unmocked on the deployed candidate. Added `tests/agents/47-trade-os-t3-staging.spec.ts`
and registered it **additively** in `playwright.staging.config.ts` — no certified gate was mutated.

### Pairing proven BEFORE the journey

A branch preview that quietly calls the shared staging backend would make any UAT evidence
worthless (standing hazard). Measured at runtime on the deployed preview:

```text
API hosts observed:
  carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app   ← branch backend
shared staging backend (carup-backend-staging.vercel.app)   0 calls
production                                                  0 calls
```

`resolveApiBaseUrl` is configured with that branch backend in 15 places in the shipped bundle. The
repo's own `UNPAIRED_PREVIEW_API_BASE_URL` guard means an unconfigured preview would have failed
loudly to `unpaired-preview.carup.invalid` rather than silently reaching a real backend.

### Fixtures created through the real product path

Both identities were created through the **public registration API**, not by writing password
hashes. That also demonstrates the eligibility design under test: the provider is an ordinary
`owner` account whose registration profile says `logistics_provider`.

```text
onboarding: {"status":"requested","business_type":"logistics_provider","market_relationship":"international"}
role: owner
```

Commercial eligibility is a profile. It is never a platform role.

### The certified journey — `mode=acceptance`, bundle `index-DoUNtrHE.js`

3/3 on `chromium`, `tablet-chromium` and `mobile-chromium`:

```text
requester  publishes cargo with no freight knowledge, supplying only a box size
provider   discovers it cross-organisation through the SAFE projection
           — asserted the card carries neither the requester's email nor name
provider   submits a transparent offer; unstated components render "Not provided"
requester  sees the offer AND its provider, compares, awards
```

### Data validated after the mutations, not only the pixels

Across all four staging runs:

| Fact | Measured |
|---|---|
| requests / awarded | 4 / 4 |
| accepted quotes / total quotes | 4 / 4 |
| `estimated_volume_cbm` | `1.512`, basis `CALCULATED` — 0.6 × 0.45 × 0.4 × 14, computed by the real backend |
| **reservations created from logistics** | **0** — an award is not a booking |
| lifecycle events | 8 (2 per run) |

```text
diaspora.logistics.quote_submitted   OFFER_RECEIVED   → the requester
diaspora.logistics.quote_accepted    OFFER_ACCEPTED   → the provider
```

Both carry reference and route. No `quote_not_selected`, correctly — each run had a single offer.

The synthetic rows are left in place as the evidence. They are unmistakably marked and all
`AWARDED`, so they cannot surface in a later provider opportunity feed.

### Container-space conversion — also proven on staging

The provider fixture was given governed tenant membership over a **dedicated** synthetic sailing,
so the test never consumes capacity on an existing fixture container. Spec 47's second test then
runs the conversion unmocked:

```text
requester publishes cargo with a stated volume
provider attaches a sailing it actually operates, and submits
requester awards
UI states plainly that "the organiser still has to approve" BEFORE any space exists
requester explicitly requests container space
```

Measured immediately after the space request:

| | total | used | available |
|---|---|---|---|
| container | 60.000 | **0.000** | **60.000** |

reservation `REQUESTED`, 3.000 CBM, `source: logistics_rfq_award`, carrying `logistics_request_id`
— **consuming nothing.**

The organiser then approved through the **existing hardened container authority** — the same
route, service and atomic RPC the container product has always used, not a T3 shortcut:

| | total | used | available |
|---|---|---|---|
| container | 60.000 | **3.000** | **57.000** |

reservation `APPROVED`, `reviewed_by` the organiser, 2 audit rows.

The whole chain is therefore proven against a real database, in order and with every boundary
intact: **a quote is not a booking, an award is not approved capacity, a space request is not an
approval, and only an APPROVED reservation consumes capacity.**

The provenance gate also did its job on the way here: it refused an acceptance run when a later
push had rebuilt the preview, rather than certifying stale pages.

### What this does and does not settle

It settles the backend, the schema, the pairing, the award journey and the container-space
conversion. It does **not** settle owner visual/product acceptance, which §29 says green automation
can never replace. **T3 remains T3-PARTIAL for that one reason.**

Production untouched. PR #207 remains Draft.

## Execution entry — 2026-09-05 · T3 final closure correction

Three items were carried as closed or unstated when they were not, and the ledger's headline said
the one thing a reader would most rely on: that nothing but owner acceptance stood in the way. That
was an overclaim. It is corrected, and the three items are now genuinely closed.

### 1. Shared-container conversion — was a hand measurement, now a gate

The chain to organiser approval had been measured, but the approval step ran BY HAND with `curl`.
Nothing in the repository would have caught it breaking, and staging carried no proof of idempotent
replay or of foreign provider/container denial.

Spec 47's conversion test now carries the whole chain in `mode=acceptance` with the bundle pinned:

```text
publish → attach an operated sailing → award
        → capacity read BEFORE the space request
        → request space          → capacity UNCHANGED
        → replay the request     → idempotentReplay=true, no second reservation
        → attach a FOREIGN sailing → refused
        → organiser approves in the UI, through the existing container authority
        → capacity moves by EXACTLY the reserved volume, and only now
```

**Two flaws in my own first attempt, both of which made assertions pass while measuring nothing:**

- `getByTestId('diaspora-container-card').first()` read whichever sailing rendered first, not this
  journey's. The before/after capacity comparison was comparing an untouched stranger's container
  against itself and going green. The fixture now has a capacity unique across staging (47 CBM),
  the helper asserts it found exactly that card, and the offer pins the sailing by id.
- The API helper sniffed its base URL from resource timings and hit the web origin, receiving HTML.

Replay and foreign-attach are asserted at the API deliberately: the UI hides the button once
recorded and the composer only lists the provider's own sailings, so a UI-only check would prove a
button is hidden rather than that the server refuses. The foreign sailing is a REAL container owned
by another organisation — a fabricated id would be refused as not-found, proving nothing about
authorization.

Measured after the runs: `total 47.000 · used 3.000 · available 44.000`, 4 reservations across 4
distinct logistics requests — **1 APPROVED, 3 still REQUESTED**. Three REQUESTED reservations sit on
the container consuming **zero** capacity while the approved one consumes exactly its 3 CBM.

### 2. Trade OS route boundary — T1/T0 hardening found during T3

The shell passed `enforceAuth={false}`, so `RegistryRouteBoundary` skipped the registry's ROLE
decision on every protected Trade OS route. The nav filtered through `canRoleAccessRoute`, but
typing the URL bypassed that filter: a link a role could not see was still a page it could open.

The registry was checked against the actor model FIRST, because enforcement turns every registry
mistake into a hard block. That check found:

- `/diaspora/imports/:id/passport` was **UNREGISTERED**. `/diaspora` is not a protected prefix, so
  `isPublicRoute()`'s fallback classified it PUBLIC — an order-specific Order Passport rendering for
  anyone who typed the URL, enforcement on or off. Registered owner-only.
- `government` held containers and buyer-requests but not Messages, while the container product
  treats government as an operator. Operating a sailing entails its conversations; enforcement
  would have hardened that incoherence into a block. Added to Messages.
- **My earlier objection was wrong, and checking is what showed it.** I had deferred this fix
  arguing that "enforcement would bounce reviewers off the marketplace they operate". `reviewer` is
  not in the `UserRole` union and staging has **0** users holding it — it is dead code in the
  container component. I had reasoned from that component's role set instead of from reality.

Consequently the container suite's operator fixture, carrying role `reviewer`, had been proving an
operator journey for a role that cannot exist. It now uses `admin`.

Seven direct-route tests assert on `evaluateRouteAccess` — the real decision, not a restatement:
participant/supplier/logistics-provider direct URLs render; an unauthorized authenticated role is
REDIRECTED with reason `role`; visibility equals eligibility for **all seven roles** in both
directions; every Trade OS route is registered; and contextual business eligibility is never
promoted to a platform role. Proven non-vacuous — reverting the flag fails exactly the two security
tests.

Backend authorization remains authoritative; this is the SPA agreeing with the API.

### 3. Staging taxonomy RLS drift

`20260828133000_global_vehicle_taxonomy_s0.sql` already expressed the intent. Staging had drifted:

```text
rls_enabled   false
anon          SELECT true  INSERT true
authenticated SELECT true  INSERT true
```

A governance queue of raw seller/import observations, fronted by PostgREST, readable **and
writable** with the anon key. Reconciled by a forward, idempotent migration rather than editing or
replaying the applied one; it also revokes PUBLIC, because RLS-with-no-policy denies rows but leaves
the relation advertised. It ends with a block that RAISEs if the reconciliation did not take.

After applying: `rls_enabled true`, anon and authenticated false on SELECT and INSERT, service_role
retaining all four privileges, 3 rows intact.

`migration-integrity` gains a generalised guard: every table created by a migration dated 20260801
or later must declare RLS somewhere in the set — the class **both** defects belong to. Proven
non-vacuous by stripping the RLS block from the T3 migration, which fails the gate and names all
three tables. Scope is dated because 55 of 270 tables predate the convention and a gate that fails
on all of them gets switched off.

### Reported, deliberately not changed

- A dealer-as-buyer can reach `/diaspora/requests` but not `/diaspora/imports`.
- `government` holds `/diaspora/buyer-requests`.
- `blockchain_custody_rollout` and `blockchain_signing_watermarks` have no RLS in their migrations.
  Neither exists on staging; production state could not be read from here, so their migrations were
  NOT edited — that belongs to the slice that owns them, and they are listed in the guard so the
  debt stays visible.

These are product/ownership decisions, not defects this cycle should settle silently.

### Remaining

**Owner visual/product UAT only.** T3 stays T3-PARTIAL until that verdict is recorded. Do not begin
T4. Production untouched. PR #207 remains Draft.

## Execution entry — 2026-09-05 · T3 post-closure re-certification at `232b68c3`

The interim hardening (immutable submitted terms, terminal states, inclusive validity, concurrent
request-space uniqueness, DRAFT-engagement privacy, requester projection, truthful sailing states,
cargo preflight) was audited, preserved, and extended: the 9-dimension adversarial audit's remaining
confirmed findings were closed in `232b68c3` (see that commit for the itemized list — notably the
governed-template registration without which every T2/T3 lifecycle notification dead-letters, the
withdrawn-DRAFT disclosure, the unknown-CBM dead end now resolved by fill-only confirm-measurements,
the 0.000-CBM data-loss path, the cross-tenant my-requests scan, and four vacuous tests).

Everything below was then proven on the DEPLOYED exact head — FE `index-BPPgy9UI.js` and BE both
built from `232b68c3`, against the real staging database:

| # | Targeted proof | Result |
|---|---|---|
| A | Expired offer selection | DB guard: yesterday→ACCEPTED **EXPIRED**; today (inclusive) accepted; past-dated DRAFT→SUBMITTED **EXPIRED** |
| B | Submitted-term immutability | `total_amount` update on SUBMITTED → **IMMUTABLE_SUBMITTED_QUOTE** |
| C | Terminal-state guard | ACCEPTED→WITHDRAWN → **TERMINAL_QUOTE_STATE** |
| D | DRAFT Communications privacy | conversation on DRAFT-only engagement **403**; after submit **200** + thread |
| E | Requester quote projection | no `provider_tenant_id` / `metadata` / `created_by` / `updated_by` / `deleted_at`; provider safe identity present |
| F | Sailing unreadable ≠ empty | pinned in the mocked suite (fault injection is not possible against deployed staging; stated, not claimed) |
| G | Cargo preflight | 0.000-CBM item → **400**, `/mine` count unchanged — no header written |
| H | Concurrent space-request uniqueness | two SIMULTANEOUS calls → one reservation |
| I | Losing racer | **200 + idempotentReplay:true**, no raw uniqueness-constraint leak |
| J | REQUESTED capacity | 2.000 CBM REQUESTED, container 27/20 **unchanged** |
| K | APPROVED capacity | organiser approval → 27→**29**, exactly once |
| L | Replay after approval | idempotentReplay:true, capacity stayed 29/18 |
| M | Foreign sailing | **403** |

Full journey: spec 47 `mode=acceptance`, **6/6** across chromium / tablet-chromium /
mobile-chromium at the pinned bundle; harness console/page/HTTP capture gates clean. Local at the
same tree: diaspora gate **1424/0/7**, adversarial **21/21**, browser **48/48** including both
seven-width geometry loops. CI: **all 7 workflows green at `232b68c3`**.

Product decisions recorded, not silently made: (1) multiple named alternative offers per provider
remain PERMITTED — no one-provider-one-quote uniqueness was added; accidental duplicates vs named
alternatives is an owner decision. (2) CarUp staff acting FOR a provider currently rides on
privileged oversight; if wanted as a product behaviour it must become explicit delegated authority
with audit. (3) `quote_withdrawn` notification stays a deliberate T7 deferral. (4) Six foreign-lane
template keys remain unregistered, listed in the coverage gate as visible debt.

**T3 returns T3-PARTIAL for exactly one reason: OWNER VISUAL / PRODUCT UAT**
(`docs/trade-os/T3_OWNER_UAT_GUIDE.md`). T4 not begun. Production untouched. PR #207 Draft.

## Execution entry — 2026-09-05 · OWNER UAT ROUND 1 → corrections at `5958e436`

The owner walked one complete transaction — **SHIP-9D8120DA** — on desktop and mobile against
bundle `index-CBnC8_u3.js`: published → provider offered USD 1,030 on a real sailing → compared and
selected → requested space → organiser approved → requester saw approved. Capacity moved **only** on
approval. 30 full-page screenshots (`scratchpad/uat/`, `scratchpad/uatm/`).

### Passed owner judgement — do not destabilize

Buy vs Ship entry; the real Ship journey; no freight knowledge required; the CBM calculation showing
its arithmetic AND labelling itself an estimate; the three measurement options; "I don't know yet"
feeling permitted; the privacy preview; offer comparison with component charges, *Not provided*,
*provider-stated, not verified by CarUp*, Includes/Excludes; container space clearly a request;
the organiser view reading as an operating system; truthful downstream states (*Loading preparation
— Not started*, *Shipment — Not connected*, *Not recorded yet*); the mobile cargo wizard.

### The eight findings, and what they actually were

| # | Finding | Root cause |
|---|---|---|
| 1 | "Review state could not be read" right after a SUCCESSFUL space request | `requestSpace()` discarded the mutation response — which already carried `REQUESTED` — and re-derived it from a racing read |
| 2 | "0.000 CBM estimated" for a request with no cargo | `items.some(...)` on an EMPTY array is `false`, so the unknown branch was skipped and `reduce()` published a confident zero |
| 3 | Mobile identity overlapped the TRADE OS lockup at 393px | lockup and identity shared one flex row at every width |
| 4 | "Loading business context…" looked stuck | **My round-1 report was WRONG.** Measured: 200 in 1.5–2.5s, every time. Latency + weak affordance, not a hang |
| 5 | Sailing matches were a wall of 8 near-identical rows | no grouping, no identity, outweighed the offer |
| 6 | Validity missing from the provider's own review | field simply absent from the review pane |
| 7 | Header stuck at "Provider selected" after approval | header rendered the request's status enum, which stops at AWARDED |
| 8 | "FROM Japan" vs "TO Harare, Zimbabwe" read as unfinished | two code paths formatting the two halves |

Finding 4 is recorded as a correction to my own report rather than quietly dropped: the endpoint
always answered; my 600 ms screenshots caught it in flight. The fix is therefore an affordance plus
a **terminal guarantee** (a read that never settles resolves to the honest unreadable state), not a
chase after a phantom hang.

### Corrections

The reservation state is now taken from the authoritative mutation response and a failed refresh can
no longer erase it. Zero/unknown/known cargo are three distinct statements, and an itemless request
says *"Cargo details not recorded"* rather than inventing a title. The header composes vertically
below `sm` — nothing hidden, nothing shrunk to illegibility. Sailings group by WHO operates and WHEN
it departs, state equivalence as a count instead of repeating it, show the soonest three with
progressive disclosure, and claim no ranking CarUp has no authority for. Validity appears in the
provider review. A derived stage projection reports the furthest REAL state (published → offers
received → provider selected → space requested → space approved) without mutating the enum, and
stops there — loaded/shipped/cleared/delivered are not implied by a container approval. One route
formatter now composes both halves.

### Evidence at `5958e436`

FE `index-DbaX20hJ.js` and BE both built from the correction head. Spec 47 `mode=acceptance`
**6/6** across chromium / tablet / mobile. Round-2 owner journey re-walked end to end on desktop
**and** at 393px, with all eight corrections asserted inline (`scratchpad/uat2/`,
`scratchpad/uatm2/`). Diaspora gate **1424/0/7**; browser **54/54**; web unit **213/213**; tsc,
vite build and lint gate clean; CI **7/7 green**.

One spec-47 run failed first for a reason worth recording: the shared fixture sailing had reached
**45.296 of 47 CBM** across ~24 accumulated certification approvals, so the container product
**correctly refused** further approval as overfill. That is the capacity guard working. The fixture
was reset; the spec consumes 3 CBM per run and needs periodic reset or its own per-run sailing.

**OWNER UAT ROUND 2 REQUIRED.** T3 remains **T3-PARTIAL** — automation cannot close it, and round 1
is not a pass. T4 not begun. Production untouched. PR #207 Draft.

---

## §31 — T3 CERTIFICATION INFRASTRUCTURE HARDENING (run-scoped sailing)

**This is not a new product capability.** No runtime product behaviour changed. The Owner UAT
Round 2 candidate `5958e436` is preserved exactly: `TradeShippingRequests`, the provider workspace,
the Trade OS header, Request-Quotes business context, route/status logic, sailing presentation and
the container product are all untouched. The only change inside the product tree is two inert DOM
attributes used for test selection (below).

### The weakness

Spec 47 filled ONE long-lived staging sailing. Every certification approved 3 CBM into it and never
returned the capacity, so used volume ratcheted upward run after run — measured at **9.000 / 47**
across three runs, and previously at **45.296 / 47** after ~24, at which point a perfectly healthy
run failed because the container product **correctly refused to overfill**.

The product was right every time. The certification was the defect: it depended on capacity earlier
runs had consumed, and on a human periodically resetting a shared row by hand. §30 recorded this and
named the fix — "its own per-run sailing". This section delivers it.

### Old model → new model

| | Old | New |
|---|---|---|
| Sailing | one shared row, id hardcoded (`aaaa1111-…`) | created inside the run via `POST /container-marketplace/containers` |
| Identity | matched by a unique total (47 CBM) | addressed by container id (`data-container-id`) |
| Starting capacity | whatever earlier runs left | **0 used / full available, by construction** |
| Reservations at start | accumulated from every prior run | asserted **0 inherited** |
| Capacity assertions | relative (`before + 3`) | absolute (`0 → 3`), because the ledger starts empty |
| Reset | manual, periodic | none needed — a later run cannot inherit a sailing that did not exist |

The run owns its sailing, cargo, quote, reservation and approval. The requester/provider identities
and the foreign sailing remain stable on purpose, and that is a deliberate deviation from a literal
"everything per run": identities accumulate no capacity, minting fresh ones each run would litter
staging and require ungoverned SQL to grant tenant membership, and a refused foreign attach writes
nothing so that container cannot drift. **Capacity was the thing that accumulated; capacity is the
thing now isolated.**

### Authority — nothing is bypassed

`createContainer` sets `coordinator_id` to the creator, and `assertProviderMayOfferContainer` admits
the coordinator — so the provider may attach the sailing it just created through exactly the check a
real operator passes. Creation itself still requires tenant-admin authority, which is why `apiAs`
now sends `x-tenant-id` from the stored user's `active_tenant_id`, precisely as the app does:
`authorizeRole` only consults `tenant_users` when that header is present, so without it an operator
holds no tenant role and creation is refused 403. The helper carries no privilege the UI lacks.

A side effect worth stating: the foreign-attach refusal is now a **stronger** proof than before. It
is refused for a caller who *is* a tenant admin of another tenant, not merely for one with no
tenant role at all.

### Proof on real staging (governed API, unmocked)

Provider `u_9fe392f59e44494f`, tenant `c0106a0e-…-0a01`, tenant_role `admin`:

```
CREATE            201   coordinator === caller: true   status BOOKING_OPEN
  total/used/available                24 / 0 / 24
CAPACITY  (governed endpoint)  usedVolume 0, availableVolume 24
RESERVATIONS                   count = 0        (nothing inherited)
CLEANUP close-booking          200 → BOOKING_CLOSED
```

### Preserved proofs

Spec 47 still asserts, unweakened: quote submitted → no reservation; accepted → no reservation;
request space → exactly one REQUESTED; REQUESTED consumes 0; replay → `idempotentReplay=true` and
still exactly one reservation; foreign sailing refused server-side; approval → APPROVED and capacity
up by exactly the reserved volume; re-approval does **not** consume twice; `available = total −
sum(APPROVED)`. Two new assertions were added, not removed: the manifest holds exactly one
reservation, and the operator card is checked against the capacity ledger so the UI cannot disagree
with it. Scope stays desktop / tablet / mobile — **6/6**.

### Cleanup semantics

The run closes booking on the sailing it created, best effort. Cleanup is never a precondition: the
next run creates its own sailing, so it does not matter whether this succeeded. **Structural
isolation, not housekeeping.** Cleanup touches only run-owned resources and never deletes anything.

### Drift guard

`backend/tests/trade-os-t3-certification-isolation.test.js` (8 tests, ordinary CI — not staging-only,
because the failure it prevents is silent everywhere else) pins the *architecture*, not any id:
the sailing is created through the governed endpoint; no shared sailing is pinned as a default
(exactly one hardcoded id may remain — the foreign one — and it stays env-overridable); creation
asserts an empty ledger and no inherited reservations; cards are addressed by id and never `.first()`;
the reference is run-scoped; the capacity invariants above are all still present; the container
surface still exposes the identities; and cleanup swallows its own failure. Each assertion was
mutation-tested — reverting to a hardcoded sailing, dropping the empty-ledger assertion, and removing
the DOM hook each failed exactly one test and no others.

### Product-tree change (inert)

`DiasporaContainerMarketplace.tsx` gains `data-container-id={c.id}` on the sailing card and
`data-reservation-id={r.id}` on the reservation row. Attributes only — never read by the app, no
behaviour, no styling. They exist because selecting a container by position or by a capacity string
has twice read a stranger's sailing and still gone green.

**Superseded by §32:** Owner UAT Round 2 returned PASS and this work is now certified on a
deployed head. T4 not begun. Production untouched. PR #207 Draft.

---

## §32 — T3 CLOSURE: OWNER UAT ROUND 2 PASS, FIXTURE ISOLATION CERTIFIED → **T3-USABLE**

**Owner UAT Round 2: PASS.**

### What the owner inspected, and how the final head differs

Round 2 was performed against runtime candidate **`5958e436`**, served as **`index-DbaX20hJ.js`**.
The final repository head **`b446d8ea`** differs from that candidate by exactly four things:

1. staging certification fixture isolation (`tests/agents/47-trade-os-t3-staging.spec.ts`);
2. the CI drift guard (`backend/tests/trade-os-t3-certification-isolation.test.js`);
3. two inert DOM identifiers — `data-container-id`, `data-reservation-id`;
4. documentation.

**No visual, product or runtime behaviour was changed after owner approval.** The owner was
therefore not asked to repeat the full transaction walkthrough.

> **Provenance caveat, recorded because it is load-bearing.** Bundle hashes in this pipeline are
> **not reproducible for identical source**: `5958e436` → `355887dc` is docs-only (zero bundle
> inputs) yet the two builds produced `index-DbaX20hJ.js` and `index-BaUwx5WP.js`. A hash therefore
> identifies a BUILD, not a source state, and `STAGING_EXPECTED_BUNDLE` pins "the build I measured
> is still the one being served" — not "the served code equals commit X". Always read the served
> hash off the live deployment; never predict it. Note also that the branch **alias** follows the
> newest push, so it had already moved to `355887dc` before this task began; the per-deployment URL
> `carup-staging-nmc25clbk-11-11.vercel.app` is what pins `5958e436`/`index-DbaX20hJ.js`.

### Certified deployment

| | |
|---|---|
| Head | `b446d8ea` |
| Frontend | `index-C8Mq-5Lh.js` — carries both DOM identifiers (verified in the served asset) |
| Backend | `/api/health` reports `commit_sha b446d8ea` |
| Pairing | the served bundle bakes exactly ONE backend origin, and it is the branch backend the run used |

### Spec 47 — 6/6, `mode=acceptance`, run `t3iso-1788615917`

Desktop, tablet and mobile, each creating and using **its own** run-scoped sailing.

Confirmed independently from the database ledger, not only from test assertions:

| Sailing | total | used | available | reservations | APPROVED | status |
|---|---|---|---|---|---|---|
| `golden.t3.sailing.t3iso-1788615917.chromium` | 24.000 | 3.000 | 21.000 | 1 | 1 (3.000 CBM) | BOOKING_CLOSED |
| `…t3iso-1788615917.tablet-chromium` | 24.000 | 3.000 | 21.000 | 1 | 1 (3.000 CBM) | BOOKING_CLOSED |
| `…t3iso-1788615917.mobile-chromium` | 24.000 | 3.000 | 21.000 | 1 | 1 (3.000 CBM) | BOOKING_CLOSED |

Every promised invariant holds and is visible in the ledger: `available = total − sum(APPROVED)`
(24 − 3 = 21); exactly ONE reservation per sailing, so replay created no second row; exactly ONE
APPROVED, so re-approval did not consume twice; and each run-owned sailing is BOOKING_CLOSED, so
cleanup touched only what the run created.

### The accumulation defect is proven eliminated

The old shared sailing `aaaa1111-…` reads **9.000 / 47, 3 APPROVED, `updated_at` 11:51:31Z** —
*before* this certification began. It was **not touched**. Under the previous model this run would
have driven it to 18.000/47. **A full 6/6 certification now consumes zero shared capacity.** The
foreign sailing `bbbb2222-…` likewise remains 0.000/60 with 0 reservations, because a refused
attach writes nothing.

### CI at the exact head — 7/7

CI · Communication Command Center CI · Diaspora Phases 3-7 Validation · Marketplace Reference
Regression · Navigation Intelligence CI · Referral Engine CI · Vehicle Passport Foundation CI —
all **success**. Diaspora Deployed Staging UAT skipped by design (manual dispatch).

The drift guard was verified to **execute** in CI, not merely to exist: subtests 5342–5349 in the
`Backend tests (node:test)` step, all `ok`.

### Verdict

**T3-PARTIAL → T3-USABLE. T3 is FROZEN at `b446d8ea`.**

The closure rests on: Owner UAT Round 2 PASS; fixture isolation pushed and deployed; Spec 47 6/6 on
the new exact deployed head; CI 7/7; FE/BE pairing confirmed.

**T4 NOT STARTED — it requires separate owner authorization. Production untouched. PR #207 remains
Draft.**

> *Superseded on the T4 authorization:* T4 was subsequently authorized and is now materially
> implemented and certified on staging for both origins — see **§33** (execution) and **§34** (final
> technical certification). This paragraph is retained as the record of what was true at T3 closure.
> T5 remains not started.

### The principle this closes on

Each certification project owns the capacity state it measures. Do not reintroduce a shared sailing,
periodic manual reset, indefinitely growing capacity, `.first()` resource selection, or relative
capacity assertions against unknown inherited state. `backend/tests/trade-os-t3-certification-isolation.test.js`
enforces this in ordinary CI.

---

## §33 — T4 EXECUTION: Order & Booking Passport convergence

**Start `04558148` · candidate `8fc31aaa` · T4-PARTIAL · owner UAT required.**
T3 frozen at `b446d8ea` and untouched. Production untouched. T5 not started. PR #207 Draft.

### The authority decision, and why it is one column

The audit ran before any code. Existing authorities already own procurement
(`diaspora_import_orders` + quotes + participants), logistics (`diaspora_logistics_requests` +
quotes), capacity (the container authority), documents, Communications and audit — and
`getImportOrder` already aggregates seven relations in one read. Communications was **already
converged**: T2 and T3 both call the same canonical `ensureReferenceFlow` on workflow `marketplace`.

Exactly one fact had no home: *"this shipping request is moving the goods from that purchase."*
That is an edge, not an entity, so T4 adds **one nullable foreign key** —
`diaspora_logistics_requests.import_order_id` — and no table. A `trade_transactions` table was
considered and rejected: it would duplicate an identity the two anchors already provide, and every
column it held would be a second copy of a canonical row.

NULL is the normal case. A logistics-origin transaction moves cargo the requester already owns, and
§4B's rule — never manufacture a procurement order for it — is exactly what a nullable column
buys.

### The two origins, never conflated

`kind` is a path segment, not a query flag, so a purchase and a shipment cannot be merged by a
missing parameter. Procurement-origin anchors on the order; logistics-origin on the shipping
request. The continuation prefills route and vehicle from the purchase — the buyer never meets a
blank shipping form — while the crate measurements CarUp genuinely does not know stay `UNKNOWN`
with a null volume, so T3 still correctly refuses container space until a real volume exists.

### Stage: furthest proven, never beyond evidence

A deterministic ladder on the SERVER as a pure function, because T3's equivalent lives in a React
component where it cannot be tested alone or shared. An awarded request with an APPROVED
reservation reads **"Container space approved"**, not "Provider selected". And it stops there:
warehouse intake, loading, shipment, customs and handoff report `NOT_STARTED` / `NOT_CONNECTED` /
`NOT_RECORDED` because T9–T12 own those authorities. Unknown is not zero.

### Idempotency in the database, not the button

A partial unique index permits one LIVE continuation per order; the loser of a race gets 23505 and
is handed the winner. Partial deliberately — a CANCELLED or CLOSED request frees the slot, without
which a buyer whose shipping was cancelled could never arrange it again.

### Evidence

Service tests **25/25** · real-Postgres constraint gate **11/11** (new CI step, confirmed
executing — this migration is past `NEW_MIGRATIONS`'s `20260810120000` cutoff and would otherwise
have been executed by no gate) · T3 **12/12** unchanged · web unit **1572/1572** · tsc clean ·
lint NET_NEW 0/0 · build ✓ · **CI 7/7** at `8fc31aaa`.

Deployed staging (FE `index-CrOj-Kvb.js`, BE `commit_sha 8fc31aaa`, paired): the logistics-origin
passport reads `SPACE_APPROVED` on `SHIP-54829F7F` with sailing `SAIL-2BACA5F7` at 24/3/21 and
`consumes_capacity=true`; the awarded provider sees the transaction with the requester **withheld**,
no VIN field, and a payload scan showing neither leaked; seven-width geometry clean with 0 console
errors and 0 5xx.

### What is NOT done, plainly

**The staging migration was not applied** — `apply_migration` was refused by the environment's
safety classifier, and staging SQL reads were refused after it. The same DDL was deliberately NOT
re-routed through another tool: that would work around the refusal's intent rather than its
mechanism. So `import_order_id` does not exist on staging, and the **procurement-origin passport
and the continuation have no deployed-staging evidence**. Both are covered by service tests and the
real-Postgres gate; what is missing is one authorized action.

Twelve local backend failures in `verification-*` and `provision-staging-qa-accounts` are
**pre-existing**: stashing every T4 change and re-running at `04558148` produced the identical 25
failure markers in the same four files. They pass in CI.

**T4-PARTIAL. Owner UAT required. T5 NOT STARTED — it needs separate owner authorization.**

---

## §34 — T4 FINAL TECHNICAL CERTIFICATION (both origins on deployed staging)

**Candidate `3a3d729e`. T4-PARTIAL, remaining for exactly one reason: OWNER VISUAL / PRODUCT UAT.**
T3 frozen at `b446d8ea` and green. Production untouched. T5 not started. PR #207 Draft.

### Staging schema, applied under authorization

`20260906090000_trade_os_t4_transaction_continuation_link.sql` applied to STAGING only through the
approved migration authority; ledger `20260905151925`. Verified afterwards rather than trusted:
the nullable `import_order_id`, the FK with `ON DELETE SET NULL`, the partial lookup index, and the
live-continuation unique index carrying exactly
`deleted_at IS NULL AND import_order_id IS NOT NULL AND status <> ALL (ARRAY['CANCELLED','CLOSED'])`.
**Production checked: the column does not exist there (0).**

### The defect only the deployed journey could find

The first procurement run returned **201 with zero cargo lines** — the API looked healthy while
T4's core "no re-entry" guarantee was silently broken. `cargo_category` is a lowercase vocabulary
and `'VEHICLE'` violated the CHECK; worse, **the insert's error was never inspected**, so it failed
silently. Fixed in `3a3d729e`, together with a latent hazard on the same line: `linked_vehicle_vin`
is a FK to `vehicles`, so an unverified VIN would both break the insert and assert an unauthorised
vehicle link — it is now carried only when the vehicle exists *and* belongs to the buyer. The
continuation now converges: a replay repairs a missing cargo line. No mock could have caught this,
because the mock has no CHECK constraints.

### Both origins, on the same deployed candidate

**Procurement** `ORD-C1F0F150` → `SHIP-18F70CAB`: refused before acceptance ("Accept a supplier
offer before arranging shipping"); after acceptance the passport reads `COUNTERPARTY_SELECTED`,
the continuation is 201 with the order linked and the route inherited, the cargo line carries
"Toyota Aqua" with `measurement_basis UNKNOWN` and **null** volume and weight, replay is idempotent,
and **four concurrent activations returned one id with no raw 23505**.

**Logistics** `SHIP-54829F7F`: `SPACE_APPROVED`, sailing 24/3/21, `consumes_capacity=true`,
`continued_from_order = null` — no procurement order manufactured — and the five unimplemented
stages honest.

### Security, on deployed staging

Requester and buyer 200 on their own; unrelated user **403** on both passports and on
continue-to-logistics; anonymous **401** on both; non-awarded provider **403**; awarded provider 200
with the requester **withheld** and no VIN field. Payload scans show no requester id, no reference,
and none of `storage_path`, `document_url`, `service_role`, `tenant_users`, `deleted_at`,
`created_by`. Public registration cannot self-grant `dealer`; that control was not worked around.

### Gates

Backend **87/87** · real-Postgres T4 gate **11/11** · web unit **1572/1572** · tsc clean · lint
NET_NEW 0/0 · build ✓ · **CI 7/7**, with **both T4 gates confirmed executing** (the PGlite step by
name, five T4 subtests and the constraint checks visible in the log).

Responsive: both passports, seven widths, `scrollWidth <= innerWidth + 1` everywhere, 0 console
errors, 0 5xx. The procurement surface says **"Supplier selected"**, the logistics one **"Container
space approved"** — origin-specific human language, each with its evidence line.

### Named gap

**Nothing in the codebase writes `CANCELLED` or `CLOSED` to a logistics request** — T3 shipped no
cancel capability. The slot-release predicate is therefore correct and proven on real Postgres but
unreachable through the product, which means a buyer who starts shipping for an order cannot start a
different one for it. The index is built for the capability that should exist; the capability is a
T-phase gap, not a T4 defect.

**Remaining gate: OWNER UAT. Do not treat this entry as an owner pass.**

---

## §35 — T4 OWNER UAT AND UX CLOSURE → **T4-USABLE**, FROZEN at `736f06c5`

**Owner T4 UAT: PASS WITH FINDINGS.** The convergence architecture was accepted. Three HIGH findings
blocked the freeze — all of them about the passport being hard to *understand*, none about it being
untrue. The findings stay in the record; they are not rewritten away.

### The findings, and why they mattered

**F1 — the passport printed internal user ids.** "Who is involved" rendered
`u_75baf4fa3c9a4f29`, so a customer could not tell who their supplier was and an internal
identifier sat on a customer-facing surface. Identity now resolves business/trading name, then the
governed person's name, then the **role**. There is deliberately **no id fallback**: an unresolvable
party reads "Selected supplier", which is truthful and useful where an opaque id is neither. A
withheld party renders by role and says it is not shared, so T3's requester-withheld contract is
untouched — and a test now pins that no raw id can reach `participants` for any viewer.

**F2 — the passport never said what to do next.** It answered *what is this / what happened / what
is waiting* and stopped, so a freshly awarded logistics transaction offered no action while the real
next step sat one navigation away. `next_step` is now derived on the server from the same
authoritative facts as the stage. It links to the canonical workspace instead of reimplementing the
workflow; a blocked step names what is missing ("Confirm cargo volume before requesting space")
rather than hiding the control; a pending space request shows WAITING rather than a second CTA; and
an APPROVED transaction offers **nothing**, because warehouse intake, loading, shipment, customs and
handoff have no authority yet.

**F3 — "Arrange shipping" ended in a soft dead-end.** It created a correct linked DRAFT and left the
customer there. The next step now carries **"Continue shipping request"** straight to that draft.
The continuation still begins as DRAFT deliberately: a procurement award is not a published
logistics RFQ, and nothing publishes on the customer's behalf.

**F4** gave Messages a real "Open conversation" link into canonical Communications — no second
inbox. **F5** stopped the procurement passport discarding the recorded city ("Japan → Zimbabwe"
where the order said Yokohama and Harare). **F7** gave the mobile nav a trailing fade so scrollable
items stop reading as accidentally chopped.

**F6 required no product change.** The supplier UI needs governed `dealer` authority and public
registration correctly refuses to grant it; that control was not weakened. Future UAT needs a
governed supplier tenant fixture — recorded as a certification-fixture improvement.

### Closure evidence (deployed `736f06c5`, FE `index-Bks3yTmb.js`, paired)

Four passport states re-walked. No raw user id on any of them or on the provider view; conversation
link present on all four; procurement route reads "Japan → Harare, Zimbabwe"; mobile 393px clean
with a scrollable nav; and each next step correct for its state, including the two that correctly
offer no action at all. "Continue shipping request" lands on the linked draft with its inherited
cargo intact. Backend **90/90**, real-Postgres gate **11/11**, tsc clean, lint 0/0, build ✓, 0 5xx.

> Recorded because it was nearly reported as a defect: the UAT harness logged 16–24
> `TypeError: Failed to fetch` console entries. Idling on the dashboard and on a passport **without
> navigating** produces **zero**. They were the harness aborting its own in-flight requests.

### Non-blocking gap, owner-classified, not lost

**A procurement-linked live logistics request cannot be cancelled or closed through the customer
product.** Nothing in the codebase writes `CANCELLED` or `CLOSED` to a logistics request — T3
shipped no cancel capability — so the one-live-continuation slot cannot be intentionally released.
The partial index is correct and proven on real Postgres; what is missing is a **product action**.
**NON-BLOCKING for T4, and required before production readiness.** Its home is logistics
request-lifecycle ownership, to be placed against the canonical roadmap when that work is scheduled
rather than assigned blindly to T5 or T7.

### Verdict

**T4-PARTIAL → T4-USABLE. T4 IS FROZEN at `736f06c5`.**
Production untouched. **T5 NOT STARTED — it requires separate owner authorization.** PR #207 Draft.

---

## §36 — TRADE OS TRANSACTION INTAKE CONTRACT

**Governing section for T2–T17 intake. Not a new master plan.** Any phase that needs a customer
fact asks this contract for it first; a phase that discovers a missing fact adds it HERE rather
than building a second form.

### 36.1 The rule the contract exists to enforce

> **CAPTURE ONCE → RECORD PROVENANCE → VERIFY WHEN AN AUTHORITY EXISTS → REUSE EVERYWHERE.**

A customer saying *"about 400 kg"* and a warehouse scale saying *"437 kg"* are two different facts
about the same thing. The second must never silently overwrite the first, because the difference
between them is exactly what a dispute, a re-quote, or a capacity refusal later turns on.

And the corollary that governs the UI: **unknown is a legitimate answer.** A customer who knows they
have twelve boxes but not their dimensions must be able to say so. Forcing a number to satisfy a
column is how a database gets full of confident lies.

### 36.2 Audit findings — what already exists (measured before designing)

| Concern | Authority today | Verdict |
|---|---|---|
| Procurement header | `diaspora_import_orders` — route, make/model/year, budget, taxonomy | **Reuse.** |
| Procurement detail | `diaspora_import_order_request_lines` — `item_kind`, quantity, vehicle make/model/year, `part_number` + `part_number_known`, `condition_preference` | **Reuse and extend.** Already a proper line structure, not a blob. |
| RFQ-level intent | `diaspora_import_orders.metadata.rfq` — `discloseBudget`, `neededBy`, `urgency`, `buyerNotes`, `quoteDeadline` | Metadata already carries intake intent; **migrate the queryable/privacy-bearing ones to columns**. |
| Logistics header | `diaspora_logistics_requests` — origin/destination country·city·location, `needed_by`, `service_preference` | **Reuse and extend.** |
| Logistics cargo | `diaspora_logistics_request_items` — category, quantity, L·W·H + unit, CBM, weight, **`measurement_basis`** | **Reuse.** `measurement_basis` (CALCULATED / PROVIDED / UNKNOWN) is the existing provenance seed. |
| Supplier visibility | `projectRfqForMarketplace` / `projectRequestLineForMarketplace` / `projectLogisticsRequestForMarketplace` | **Explicit allow-lists with documented exclusions. Extend the same way — never return a raw row.** |
| Vehicle identity | canonical Vehicle Passport + `resolveVehicleObjectAuthority` | **Reuse.** A VIN is linked through authority, never from free text. |
| Documents | `diaspora_trade_documents` (+ Drive) | **Readiness only** at intake. Presence ≠ verification. |
| Conversation | canonical Communications `ensureReferenceFlow` | **Reuse.** No second inbox. |

**No new transaction authority is created.** T4 already proved the shape of that decision: an edge,
not an entity.

### 36.3 Where a fact is allowed to live

A field's home is decided by what must be *done* with it, not by what is convenient to write:

1. **Structured column on an existing authority** — required when the fact is validated, matched
   against supply, queried, or privacy-gated. Steering, drivetrain, mileage ceiling, budget meaning,
   budget disclosure, destination outcome, shipping objective, consignee kind, clearing/insurance/
   inspection/payment intent all qualify: each one either filters supply or decides what a supplier
   may see.
2. **Line/item row** — anything that repeats. Parts, cargo groups and vehicles are lines, never a
   comma-separated string in a notes field.
3. **Provenance ledger** (§36.5) — any fact that a later authority can supersede: weight, volume,
   dimensions, value, condition, inspection state.
4. **Metadata** — only genuinely open-ended, non-queryable, non-privacy-bearing extras. Free-text
   notes and the existing `metadata.rfq` display fields qualify. **A field that needs validation,
   matching, querying or a privacy decision does not.**

> **The anti-pattern this forbids:** dropping the whole expanded intake into one JSON object because
> it ships faster. That object cannot be validated, cannot be matched against supply, cannot be
> partially projected to a supplier, and cannot be migrated. Every later phase would then re-read a
> blob and re-implement its own interpretation of it.

### 36.4 Field classification

Every field carries one of four states, and the UI must show which:

| Class | Meaning | UI obligation |
|---|---|---|
| **REQUIRED NOW** | Without it the request is not meaningful | Blocks publish, and says why |
| **RECOMMENDED** | Improves quote accuracy | *"Adding these may help providers quote more accurately"* — never "incomplete" |
| **CONDITIONAL** | Only exists because of another answer | Appears only when triggered |
| **LATER** | Useful downstream, not needed to publish | Offered, never demanded |

**"Form incomplete" is forbidden for information that is legitimately unknown or optional.**

### 36.5 Provenance model

Facts that an authority can later supersede are recorded as **observations**, not as overwritten
values:

```
CUSTOMER_STATED · CUSTOMER_ESTIMATED · CARUP_CALCULATED · PROVIDER_STATED
WAREHOUSE_MEASURED · CARRIER_STATED · DOCUMENT_DERIVED · VERIFIED
```

Rules:
- **`VERIFIED` requires an authority.** No customer selection may produce it.
- An estimate and a measurement are never collapsed; the newest observation is what surfaces, and
  the earlier one remains readable.
- The existing `measurement_basis` on logistics items is the in-row summary of the newest
  observation, kept for compatibility and for cheap matching.

### 36.6 Privacy classification

Every field is assigned a visibility class, **defaulting to PRIVATE when uncertain**:

| Class | Who sees it |
|---|---|
| `PRIVATE` | The requester (and platform admins) only |
| `MARKETPLACE_SAFE` | Any qualified supplier/provider browsing opportunities |
| `COUNTERPARTY_AFTER_ENGAGEMENT` | Only a counterparty who has engaged (submitted an offer / been awarded) |
| `INTERNAL` | CarUp operations; never in a customer or supplier payload |
| `LATER_OPERATIONAL` | Released to an operational participant only when that stage exists |

**Permanently PRIVATE at intake:** pickup address and site contacts, consignee contact details,
personal phone/email, internal user and tenant ids, storage paths and document URLs, undisclosed
budget, payment intent, clearing-agent contact details, and any VIN not authorised for the viewer.

**A richer intake must not widen the marketplace projection.** Supplier visibility stays an explicit
allow-list; a new field is invisible to suppliers until it is deliberately added to that list and
covered by an adversarial test.

### 36.7 Customer-declaration boundary

A customer declaration records an **intention or a belief**, never an operational fact:

- ticking *"batteries"* does not make hazardous carriage eligible;
- ticking *"inspection completed"* does not produce an inspection certificate;
- naming a budget meaning does not compute a landed cost (**T6** owns rates);
- expressing insurance or clearing interest does not create a policy or a broker relationship.

Each is stored as customer-stated and requires the relevant authority before it means anything.

### 36.8 Downstream consumers

| Phase | What it reads from intake |
|---|---|
| **T2** | requirement + supplier matching |
| **T3** | cargo, route, service preference |
| **T4** | the Passport projects it; the continuation **inherits** destination outcome and item identity |
| **T5** | sailing eligibility inputs |
| **T6** | requested quote scope and charge components |
| **T8** | document-readiness seed |
| **T9** | replaces estimates with measurements — **via a new observation, not an overwrite** |
| **T11/T12** | destination outcome, consignee, clearing intent |
| **T13** | payment and insurance intent |
| **T15** | funnel completeness and demand signals |

### 36.9 Revision semantics

A DRAFT is freely editable. Once published, a change that alters what a supplier already quoted
against is **commercially material** and may not be applied silently — it requires a governed
revision and re-confirmation. Non-material additions (a clarifying note, a later-class fact) may be
added without invalidating offers. T2/T3's existing edit rules stand; this contract does not loosen
them.

### 36.10 Standing gap carried into this contract

**A procurement-linked live logistics request still cannot be cancelled or closed through the
product**, so the one-live-continuation slot cannot be intentionally released (see §35). It is
**not** Intake 2.0's to fix, and it must not disappear: **required before production readiness**,
owned by logistics request-lifecycle work.

---

## §37 — INTAKE 2.0 EXECUTION

**Start `86006034` · candidate `c4bb5425` · INTAKE-2.0-PARTIAL · owner UAT required.**
Governed by §36. Receipt: `docs/trade-os/receipts/TRADE_OS_COMPREHENSIVE_INTAKE_2_0.md`.
T3 frozen. T4 frozen at `736f06c5`. Production untouched. **T5 not started.**

**Persistence.** Structured columns on the two existing authorities for everything validated,
matched, queried or privacy-gated; one append-only observation ledger for facts a later authority
supersedes. No blob, and no new transaction authority.

**Provenance.** A customer may state or estimate their own facts and nothing else. `VERIFIED`,
`WAREHOUSE_MEASURED`, `CARRIER_STATED`, `PROVIDER_STATED` and `DOCUMENT_DERIVED` are refused from a
customer-facing caller. `currentFact` always returns the provenance alongside the value — there is
no accessor that hands back a bare number, so an estimate cannot be rendered as a measurement.

**Privacy.** The marketplace projections grew by enumerated allow-list only. A runtime sentinel test
proves no private field crosses. Declared cargo value and export clearance state are deliberately
withheld from browsing suppliers.

**Progressive disclosure.** The novice path is unchanged and the deep fields are hidden until asked
for — verified on the deployed build. Blank means "no preference", never a default.

**T4 reuse, proven on staging.** A comprehensive award's continuation inherited the destination
outcome, the shipping objective, all three timing fields, the route and the item identity, while
measurements and vehicle state stayed unknown — and the buyer's budget ceiling, budget basis,
payment intent, clearing intent and delivery area did **not** cross onto the logistics authority.

**One defect only the deployed journey could find:** the line normalizer was written and never
called, so every vehicle preference persisted as null while the module and the columns were both
correct. Its regression test drives the real write path.

**Deferred, and named:** the logistics intake UI, the PRIVATE-class contact/document fields (T8), a
governed supplier fixture for projection UAT, and rates (T6). The logistics cancel/close gap remains
recorded in §36.10 — required before production readiness.

---

## §38 — INTAKE 2.0 FINAL CLOSURE

**Candidate `be432647`. INTAKE-2.0-PARTIAL, remaining for owner product/visual UAT.**
Receipt §7–§10. T3 frozen. T4 frozen at `736f06c5`. Production untouched. **T5 not started.**

**The interpretation corrected.** PRIVATE never meant "do not collect"; it means collect where the
journey needs it and never expose it. Pickup and delivery addresses and contacts, consignee details,
clearing-agent details, cargo location and contact preferences are now collected — and every one is
named in `NEVER_MARKETPLACE_VISIBLE`. Certified: thirteen private sentinels published, **none**
reached the provider projection, while the five facts a provider needs all did.

**Document readiness is surfaced and honest.** Four states, `verified=false` on every row, no
percentage and no completeness flag because the required set is unknown, `verified` refused as a
state, and re-answering corrects rather than duplicating. No T8 functionality was added.

**The supplier fixture is governed, not a loosened control.** `/diaspora/rfqs` still requires the
`dealer` role and public registration still refuses to grant it. The fixture lives in the existing
provisioning script that refuses production and hashes at runtime, is run-scoped and synthetic, and
a test pins that exactly one dealer exists.

**The supplier journey is walked end to end**: opportunity → detail → offer → comparison → award →
T4 continuation, with 0 of 12 private facts crossing and 10 of 10 quote-relevant facts crossing.

**A real defect it exposed:** the buyer could see a supplier's DRAFT offer and its amount. The
intent was already documented in `createQuote` and already enforced in T3; T2's read returned every
row. Drafts are now withheld, and the pre-existing assertion — which accepted the row as long as
identity was stripped, while the price still crossed — was deliberately strengthened.

**Three wiring gaps, one lesson.** `normalizeLineIntake` written but never called; the readiness
service implemented but unreachable. Both were found by walking the deployed product. A module being
correct is not the same as a module being wired.

**Still deferred and named:** the T3 wizard surfaces only part of the logistics intake; the supplier
screens were walked through the API rather than the browser; readiness has no upload (T8); managed
import stays an intent; rates remain T6. The **logistics cancel/close gap** (§36.10) is unchanged —
required before production readiness.

---

## §39 — INTAKE 2.0 LAST TECHNICAL CLOSURE (BROWSER-PROVEN)

**Candidate `c84ac9b5`. INTAKE-2.0-PARTIAL — owner UAT is all that remains.**
T3 frozen. T4 frozen at `736f06c5`. Production untouched. **T5 not started.**

**§38 said the supplier screens were walked "through the API rather than the browser". Walking them
in a browser is what found the defect the API could never have shown.**

The API was right the whole time. `projectRfqForMarketplace()` allow-listed and published every
richer answer the buyer gave — steering, transmission, drivetrain, mileage cap, seats, accident and
rust tolerance, intended use, alternatives, delivery outcome, priority, shipping mode, timing, and
which costs to price. Asserting on that payload passed. Then the supplier's screen rendered a title,
a route, a needed-by and a budget line, and dropped the rest. **Intake 2.0's entire premise was dead
on the surface it existed to serve**, and no API assertion could have told us.

The provider side was worse, because there the missing facts are operational. The logistics card
showed route, volume and weight — but not whether the vehicle runs, whether the keys exist, what the
customer declared is inside it, or whether an inland collection leg is part of the job at all. A
provider cannot price winching they cannot see, and "batteries" is a dangerous-goods disclosure that
was reaching nobody.

**What changed.**

- The supplier card renders the allow-listed brief. The TS types that had never declared those
  fields now carry them, mirroring `MARKETPLACE_SAFE_ORDER_FIELDS` / `_LINE_FIELDS` exactly.
- The logistics projection was widened through a **named** allow-list,
  `MARKETPLACE_SAFE_LOGISTICS_FIELDS`: `pickup_required`, `origin_site_type`,
  `destination_outcome`, `shipping_objective`, availability and timing. The **shape** of the job
  crosses so it can be priced; the **address it happens at** does not. Every contact, consignee and
  clearing agent stays in `NEVER_MARKETPLACE_VISIBLE`.
- Both briefs speak in the **reader's** voice. The buyer chose "Deliver it to my address"; printing
  that verbatim on a supplier's screen reads as if the supplier said it. Same fact, correct speaker.
- A declaration renders as a customer statement — "customer-stated, confirm before carriage" — never
  as CarUp having accepted the cargo.
- Absent stays absent: an unanswered question omits the brief rather than printing a "Not provided"
  wall. A vehicle request no longer tells suppliers "buyer does not know the part number".

**The privacy guards were themselves the fourth wiring gap.** They enumerated the allow-lists by
hand, so a *new* allow-list was covered by nothing — which is exactly what adding the logistics one
would have done. They now **discover** every `MARKETPLACE_SAFE_*` export, and a test asserts the
discovery finds something, because a guard that silently covers nothing is worse than no guard.

**Browser-proven, both directions.**

| Walk | Result |
|---|---|
| Supplier: login → list → brief → compose → review → submit | all pass |
| Buyer: sees offer → compares → **awards** (`Supplier selected` / `Accepted`) | pass |
| Provider: list → brief → compose → review → submit | all pass |
| Requester: opens detail → compares the provider offer (2,600 / 35 days) | pass |
| Private facts on counterparty screens (4 supplier + 4 provider sentinels) | **0 leaked** |
| Raw enums / raw UUIDs / internal field names on either screen | **0** |
| Seven-width geometry across 4 surfaces (393 → 1536) | **28/28, no overflow** |
| Console errors on a settled page; 5xx across every walk | **0 / 0** |

**Method note worth keeping.** `npx tsc --noEmit -p web/tsconfig.json` checks **nothing** — that
project is `files: []` with references. It reported "clean" on code containing real type errors.
`tsc -b` is the gate, and it was verified by deliberately breaking a file first. A gate is not a
gate until you have watched it fail.

**Two findings, recorded then CLOSED at `3c382bae`** (owner asked for both to be fixed):

1. *(MISSING CAPABILITY → closed)* The requester's own shipping list showed "Waiting for offers ·
   Logistics providers can respond" while a submitted offer waited — the same words a request
   nobody had answered shows. `listMyLogisticsRequests()` now returns `offer_count`, counted with
   **exactly** the rule the detail screen uses to build its offer list (neither DRAFT nor
   WITHDRAWN), so the badge cannot contradict the page it opens. The row reads "1 offer to
   compare".

   An **unreadable** count is ABSENT, never `0`: `countVisibleOffers()` returns null on a failed
   read and the field is omitted, so the row keeps its status note rather than announcing "no
   offers" — a claim we would not have earned. (§8.1. The first draft of this code wrote `|| 0`;
   it was caught on review, and a test now holds it.)

2. *(UX-DESIGN → closed)* PRIVATE meant private **from providers**. It never meant private from
   the person who typed it. The detail now echoes the customer's answers in two groups: what
   providers can see ("Providers see these, so they can price the job") and what is kept private
   ("Never shown to providers browsing your request. Shared with the provider you choose, once you
   choose them") — the honest statement, since choosing a provider does share them.

Both speak in the customer's own voice — "We collect it for you", "Delivered to your address" — and
no raw enum reaches either screen. Verified on deployed staging (FE `index-DyESD1P8.js`, BE
`3c382bae`): the badge reads "1 offer to compare"; the owner sees their own pickup address, phone
and delivery address back; and the **provider's** screen still shows none of it. 15 tests, each
mutation-tested.

**Still deferred and named:** readiness has no upload (T8); managed import stays an intent; rates
remain T6. The **logistics cancel/close gap** (§36.10) is unchanged — required before production
readiness.

---

## §40 — T5 GOVERNANCE RECONCILIATION: COMMERCIAL TRANSPARENCY & MULTI-CORRIDOR COMPATIBILITY CONTRACT

**Execution entry — 2026-09-06 · T5.0. Owner authorized T5 implementation at branch head
`3c382bae` (T5 plan introduced at `70f9a251`, actual head at start of execution `d866e2ce` — one
docs-only commit past authorization, closing the two Intake findings). This section reconciles the
owner-approved plan (`docs/trade-os/T5_CONTAINER_MARKETPLACE_MULTI_CORRIDOR_IMPLEMENTATION_PLAN.md`)
into the canonical authority BEFORE any T5 runtime change, per §0 rule 13.**

### Baseline proof at T5.0

| Fact | State |
|---|---|
| Branch / head | `feat/trade-os-client-demo-convergence` @ `d866e2ce`, clean tree |
| PR #207 | Draft, OPEN |
| Production | untouched — `origin/main` still `bb9d9900` (pre-Trade-OS); no prod deploy, no prod migration |
| T3 | frozen at `b446d8ea` semantics (§32) |
| T4 | **T4-USABLE**, frozen at `736f06c5` (§35) |
| Intake 2.0 | **INTAKE-2.0-PARTIAL — owner UAT only remains** (candidate `c84ac9b5`, findings closed at `3c382bae`); NOT owner-accepted, NOT frozen. T5 must preserve its contracts and must not pre-empt that UAT. |
| Known red gate at start | Vehicle Passport Foundation CI `Diff hygiene` — 8 trailing-whitespace lines introduced with the T5 plan at `70f9a251`; fixed in this T5.0 commit |

### The reconciled contract (authoritative summary; full text in the plan document)

**1. The architectural correction.** A customer's final destination must never be assumed to be
the destination of the sailing they reserve capacity on. `Harare, Zimbabwe` remains the customer
fact while the booked ocean leg is `Yokohama → Beira`. The composition is made possible; the
inland continuation is neither fabricated nor implied complete.

**2. Seven concepts that must never collapse** (schema, services, UI and tests):

```text
FINAL CUSTOMER DESTINATION ≠ CORRIDOR ≠ CORRIDOR LEG ≠ TRANSPORT MODE
≠ SAILING / CAPACITY OPPORTUNITY ≠ RESERVATION ≠ SHIPMENT
```

**3. Corridor authority.** A corridor is a reusable ordered-leg route pattern
(`JP-BEI-ZW`, `JP-DUR-ZW`; `JP-DAR-ZW` research-only). It owns route composition ONLY — never
rates, customs/tax, shipment state, reputation or a "preferred corridor" claim. New corridors are
data, not schema redesign.

**4. Sailing lifecycle.** `DRAFT → BOOKING_OPEN → BOOKING_CLOSED | CANCELLED`. Creating ≠
publishing. Legacy `LOADING/SHIPPED/ARRIVED` container statuses are never T5 shipment truth
(T10/T11 own those facts). Booking closure means bookings closed — nothing more.

**5. Service scope.** An accepted quote/booking appoints that provider for the quoted scope only.
Selecting a freight provider does not appoint a clearing agent; selecting a supplier does not
appoint a freight provider. Trade Journey remains a composition of canonical authorities — no
`trade_transactions`/`trade_orders`/`trade_journeys` shadow record.

**6. Commercial transparency preserved for T6.** Original amount + original currency are
permanent; no cross-currency normalization, landed-cost, FX snapshot, rate engine or corridor
economics in T5 (T6). CarUp revenue must never be labelled as a third party's charge. No corridor
is presented as universally optimal.

**7. Truth rules carried forward** (plan §12): unknown is never zero; a booking is not a shipment;
a sailing endpoint is not the customer's destination; customer declarations are not carrier
acceptance; planned departure/arrival are never shown as shipped/arrived.

**8. Privacy.** New corridor/sailing facts are invisible unless explicitly allow-listed; Intake
2.0's `NEVER_MARKETPLACE_VISIBLE` set and projection discipline extend to every new T5 surface.
The plan's 12-case adversarial matrix is mandatory.

**9. Phase firewall.** T5 implements no rate/FX/landed-cost/customs/tracking/warehouse/loading/
settlement/reputation/optimization capability (plan §9); T6–T18 ownership stands (plan §10).

**10. Known standing gap carried in.** A procurement-linked live logistics request cannot be
cancelled/closed through the customer product (§36.10, §38, §39). T5.7 must classify its
disposition deliberately — required T5 work or a scheduled pre-production task — and must not let
it vanish.

### Execution order

T5.0 (this entry) → T5.1 audit → T5.2 corridor → T5.3 sailing lifecycle → T5.4 discovery →
T5.5 mode → T5.6 booking workspace → T5.7 capacity → T5.8 privacy → T5.9 UI/responsive →
T5.10 staging certification → owner UAT. Stop at T5; T6 not authorized.

---

## §41 — T5 IMPLEMENTATION & TECHNICAL CERTIFICATION → **T5-PARTIAL**, OWNER UAT REQUIRED

**Execution entry — 2026-09-06. Start `3c382bae` (authorization) / `d866e2ce` (actual). Code head
`84b6de3a`. Staging schema activated. Production untouched. T6 not started.**

### The correction, delivered

Country-equality on both endpoints meant a real `Yokohama → Beira` sailing could **never** serve a
Harare customer without lying about one side of the route. It now does, and the screen says so in
the customer's own terms:

```text
Your destination: Harare, Zimbabwe
This sailing covers: Yokohama → Beira — Japan → Beira → Zimbabwe corridor
Then still required: Forbes/Machipanda → Harare — not part of this sailing, not yet arranged.
```

Rendered verbatim on deployed staging. The destination is never rewritten to Mozambique, the
onward legs are stated as **required and unarranged**, and a match still books nothing.

### What was built (T5.1 audit → T5.8)

| Slice | Decision |
|---|---|
| T5.1 | **No corridor authority existed anywhere** — the only "corridor" was an Intelligence display label. Ports lived in container metadata. The container status CHECK *already* had DRAFT/BOOKING_OPEN/BOOKING_CLOSED/CANCELLED. `metadata.total_capacity_weight` is read by the hardened approval RPC and deliberately stays there. Intake could say `roro`; the offer CHECK could not. |
| T5.2 | `diaspora_trade_corridors` + `diaspora_trade_corridor_legs`. Route composition **only**. JP-BEI-ZW / JP-DUR-ZW benchmark, **JP-DAR-ZW research_candidate**. Ordered by code; nothing ranks. RLS: authenticated read, service_role write. |
| T5.3 | `origin_port`/`destination_port`/`corridor_id`/`corridor_leg_id` promoted to columns. `publish:false` → DRAFT; `openBooking` publishes deliberately; `cancelSailing` refused while any live reservation exists. Legacy LOADING/SHIPPED/ARRIVED remain unused as T5 truth. |
| T5.4 | `sailingRouteMatch()` — direct equality still matches; otherwise an applicable corridor's **leg shape** does. Matching is by geography; an operator's declared leg cannot widen eligibility. |
| T5.5 | `roro` added to service + DB CHECK. A roro offer **cannot** attach a shared-container sailing — the container does not carry it. No RoRo integration was built. |
| T5.7 | **The standing §36.10 gap is closed.** `cancelMyLogisticsRequest` / `closeMyLogisticsRequest`, requester-only, audited, both refused while a live REQUESTED/APPROVED reservation is attached. Proven on staging: cancel → the T4 one-live-continuation slot is **freed** and a new continuation succeeds. |
| T5.8 | `?status=DRAFT` returns only sailings the caller operates; a foreign DRAFT read by id is **404**, so existence is not confirmable. Corridor projection allow-listed despite being reference data. |

### Evidence

| Gate | Result |
|---|---|
| PGlite migration gate (`trade_os_t5_corridor_check.mjs`) | **16/16**, wired as its own CI step and **confirmed executed** in CI |
| Backend suites | **1549 pass / 0 fail** (7 skipped) |
| Web diaspora suites | **139 pass / 0 fail** |
| New tests | 24 backend + 8 web, load-bearing guards **mutation-tested** (8 mutations, every one goes red) |
| Deployed staging API certification | **37/37** on real Postgres |
| Deployed staging browser certification | **25/25** |
| Procurement-origin continuation (case D) | **14/14**, incl. idempotent replay and slot release |
| Seven-width geometry × 3 routes | **21/21**, zero overflow, screenshots reviewed by eye |
| Console errors on a settled page / 5xx | **0 / 0** |
| CI | **7/7 green** at `84b6de3a` — including Vehicle Passport Foundation CI, red since `70f9a251`, fixed by T5.0's hygiene commit |
| `tsc -b` / lint regression | clean / **zero net-new errors** |

Staging identity: FE `carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app`
(bundle `index-Daou84Dg.js` at certification), BE `/api/health` `commit_sha_short` **`f0bcca2a`**
paired, Supabase **staging** project only. Migration `20260907090000` applied to staging: 3
corridors, 8 legs, 4 columns, roro CHECK, RLS enabled on both new tables.

### Findings

| # | Class | Finding |
|---|---|---|
| F1 | **UX-DESIGN** | Publishing a shipping request takes **~13–14s** to reach the detail, because `setView('detail')` fires only after sailing-matches and reservation reads complete. The customer sees the wizard the whole time. Pre-existing shape, now more visible because corridor discovery added work. |
| F2 | **MISSING T5 CAPABILITY** (performance) | `findCompatibleSailings` is N+1: it lists corridors, then queries reservations per BOOKING_OPEN container (~5.6s on staging). Correct, not scalable. |
| F3 | **UX-DESIGN** | Gateway sailings sort by departure date like any other, so a corridor option can sit behind "Show N more departures". Ordering is deliberately neutral (no ranking is permitted), so this is a disclosure question, not a ranking one. |
| F4 | **PREFERENCE / fixture hygiene** | Legacy synthetic sailings carry raw fixture ids in `origin_city`, so one card reads "Sails to your destination: golden.t3.sailing.t3iso-… → Harare". Inherited test data, not product behaviour. |
| F5 | *(fixed in-lane)* | The gateway card first read "This sailing covers: Japan → Beira — Japan → Beira → Zimbabwe corridor". Now uses the sailing's own ports per §T5.9. `84b6de3a`. |

None of F1–F4 blocks the T5 exit gate; all are recorded rather than silently carried.

### Verdict

**T5-PARTIAL — owner UAT required.** Every technical row of the plan's §8 exit gate is proven;
the owner's product/visual verdict is the only row automation cannot close (§29). **T6 not
started. Production untouched.**

---

## §42 — T5 FINAL PRODUCT, PERFORMANCE & OWNER-UAT CLOSURE

**Execution entry — 2026-09-06. Start `5a077c7c` (docs) / `84b6de3a` (certified runtime).
Final code head `5079b0b3`. Production untouched. T6 not started. PR #207 Draft.**

The T5 architecture was accepted and is unchanged. This cycle closed the four product/performance
weaknesses recorded in §41 that were unsuitable to carry into T6, then re-ran the whole owner-UAT
proxy on a single paired candidate.

### F1 — publish no longer blocks on discovery

`openDetail` did everything before `setView('detail')`: the request row, the whole-marketplace
sailing match, and the reservation refresh — and `save()` additionally awaited a refresh of the
LIST the user was leaving. A publish that had already **succeeded** left the customer looking at
the wizard for ~13–14s.

It is now two phases. Phase 1 is the single row the page needs, and the page renders. Phase 2 —
discovery and the reservation read — runs beside it under the same generation guard, so a newer
open still supersedes a stale response. The list refresh no longer blocks either.

A pending discovery is **its own state** ("Looking for compatible sailings…"), never rendered as
"no sailings found": one is *we are still looking*, the other is a claim about the marketplace. A
failed read stays UNREADABLE and offers **Try again**. Double-submit protection is untouched.

| | Before | After (staging, `5079b0b3`) |
|---|---|---|
| Publish → usable detail | ~13–14 s, frozen wizard | **6.1 s**, page interactive with discovery pending |
| Discovery fills in | (blocking) | **+3.0 s**, same page |

### F2 — discovery is no longer N+1

`findCompatibleSailings` issued one reservations query **per candidate sailing**. Every
candidate's reservations now come from ONE batched read grouped in memory.

| Sailings | Reservation reads | Total queries |
|---|---|---|
| 1 | 1 | 7 |
| 10 | 1 | 7 |
| 50 | 1 | 7 |

Proven by assertion, not by timing. Measured on staging, warm, `n=6`:

| | Median | Note |
|---|---|---|
| Plain list read (control) | 1380 ms | the platform floor for any authenticated read here |
| `sailing-matches` (discovery) | **2344 ms** | ~964 ms above the floor, and **flat** |
| Before the fix | ~5600 ms | with *fewer* sailings than the run above |

Capacity **truth** is unchanged: the same `computeCapacity()` over the same APPROVED rows, and
approval remains the atomic container-serialized RPC — the only thing that may consume capacity.
An unreadable capacity read now **refuses loudly** rather than presenting zero as "no space".

### F3 — the multi-corridor option is no longer buried

Departure ordering is neutral and correct, but a gateway sailing is a different route **strategy**,
not a worse departure — behind five earlier direct departures it landed sixth, where a customer
had to guess a different kind of journey was hidden under "Show more".

The fix is **disclosure, not ranking**. When both kinds exist the screen shows two named
categories — *Direct sailings* and *Gateway corridor sailings* — each ordered by departure date,
each expanding independently, under one line: **"Two kinds of route can carry this shipment. CarUp
does not rank them — the choice is yours."** No corridor is best, cheapest, fastest or
recommended; `planning_status` never reaches the screen; JP-DAR-ZW stays `research_candidate`. The
economics that would justify a recommendation remain T6's.

### F4 — certification data only

No product logic was changed to prettify synthetic rows. New T5 fixtures use readable place and
business names, and one legacy staging row whose `origin_city` held a raw fixture id was repaired
**as data** (the original value is preserved in its metadata for attribution).

### F5 — preserved

The gateway card still names the sailing's own ports: *"This sailing covers: Port of Yokohama →
Port of Beira"*. Its mutation test still fails when reverted to the leg's country label.

### Owner-UAT proxy — all journeys, fresh data, exact paired candidate

| Journey | Result |
|---|---|
| A — gateway customer (Harare final, Yokohama→Beira leg) | **13/13** |
| B — direct route unbroken | pass (within A's run) |
| C — space lifecycle REQUESTED → APPROVED | pass (within C/D/E's 27/27) |
| D — reject / cancel / release + continuation slot | pass |
| D2 — request cancel/close guard via the real `request-space` path | **7/7** |
| E — operator draft → open → manifest → approve/reject → close | pass |
| F — corridor neutrality across two corridors | pass |
| Adversarial matrix (13 authority + 11 batched-discovery + 12 privacy + 1 truth) | **37/37** |
| Seven-width geometry, requester **and** operator | **14/14** |
| Console errors on settled pages / 5xx | **0 / 0** |

### Exact deployment provenance

| | |
|---|---|
| Code SHA (FE **and** BE) | `5079b0b3b531a9cb03b852682cb426158b730d7d` |
| FE deployment | `dpl_BpSJA8HXAYLfQiMUhVrs9QUaeunr` · `carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app` |
| Served bundle | `index-BrN5lNNZ.js` |
| BE deployment | `dpl_BTcyPeiQjWzcvSajx49AQ444fAFn` · `carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app` |
| BE `/api/health` | `commit_sha 5079b0b3…`, branch `feat/trade-os-client-demo-convergence`, preview |
| FE→BE pairing | the branch backend origin was read **out of the served bundle**, not inferred |
| Staging DB | Supabase **staging** project, `supabase: healthy`. Production untouched. |

Both sides deploy from **one commit**; the §41 lineage note (FE at `84b6de3a`, BE at its
web-only-parent `f0bcca2a`) no longer applies.

### Verdict

**T5-PARTIAL — all technical and product-proxy gates closed; owner acceptance only.**
Recommended owner action: **freeze as T5-USABLE**. T6 not started. Production untouched.

---

## §43 — T5 OWNER ACCEPTANCE → **T5-USABLE**, FROZEN at `5079b0b3`

**Owner decision — 2026-09-06. T5 IS ACCEPTED.**

The owner accepted the final T5 closure return (§42). No additional T5 runtime changes are
required before T6.

| | |
|---|---|
| **Owner verdict** | **`T5-USABLE`** |
| **Frozen runtime code SHA** | `5079b0b3b531a9cb03b852682cb426158b730d7d` |
| **Certification/docs descendant** | `4f7529eb094e6a3df418a3fb8235204d3dcc8291` |
| **Ancestry** | `5079b0b3` is an ancestor of `4f7529eb`; the two differ by **three documentation files only** (`TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`, the T5 plan, the T5 receipt). No runtime code changed after the frozen SHA. |
| **FE / BE pairing** | Both deploy from **`5079b0b3`** — FE `dpl_BpSJA8HXAYLfQiMUhVrs9QUaeunr` (bundle `index-BrN5lNNZ.js`), BE `dpl_BTcyPeiQjWzcvSajx49AQ444fAFn`, `/api/health` reporting the same SHA. Pairing was read out of the served bundle, never inferred. |
| **PR #207** | remains **Draft** |
| **Production** | **untouched** — `origin/main` still `bb9d9900`; no production deploy, no production migration |
| **T6** | may now be planned/implemented under its own canonical phase contract |

### What was accepted

**T5 technical and product-proxy gates passed.** PGlite migration gate 15/15 · backend 1553/0
(7 skipped) · web diaspora 151/151 · full web unit suite green in CI · adversarial matrix 37/37 ·
owner-UAT proxy journeys A–F (13/13 + 27/27 + 7/7) · seven-width geometry 14/14 across requester
**and** operator · 0 console errors on settled pages · 0 5xx · `tsc -b` clean · zero net-new lint ·
CI 7/7 green.

### F1–F5 disposition at freeze

| # | Disposition |
|---|---|
| **F1** — publish blocked on discovery (~13–14 s) | **CLOSED.** `openDetail` split into two phases; discovery and the reservation read are background under the same generation guard. Pending discovery is its own state, never "none found"; failure stays UNREADABLE with **Try again**. **13–14 s → 6.1 s** to a usable page, discovery +3.0 s after. |
| **F2** — `findCompatibleSailings` N+1 (~5.6 s) | **CLOSED.** One batched reservations read replaces one-per-sailing: **7 queries at 1, 10 and 50 sailings** (asserted, not timed). Staging warm median **2344 ms** against a **1380 ms** plain-read floor. Capacity truth and the atomic approval RPC untouched; an unreadable capacity read refuses loudly. |
| **F3** — gateway option buried behind "Show more" | **CLOSED by disclosure, not ranking.** Two named categories — *Direct sailings* / *Gateway corridor sailings* — each ordered by departure date, each expanding independently, under "CarUp does not rank them — the choice is yours." `planning_status` never reaches the screen. |
| **F4** — legacy fixtures held raw ids in `origin_city` | **CLOSED as certification data only.** No product logic changed; one staging row repaired with its original value preserved in metadata. |
| **F5** — gateway card named the leg's country, not the ports | **PRESERVED.** "This sailing covers: Port of Yokohama → Port of Beira", still mutation-guarded (reverting turns 2 tests red). |

### Accepted residual — non-blocking platform/performance debt

The remaining **~6.1 s** staging publish→detail transition is **accepted as non-blocking
platform/performance debt**, because:

- sailing discovery no longer blocks the detail page;
- matching is asynchronous;
- the N+1 was removed;
- query count is bounded;
- **no T5 invariant depends on the latency.**

### Standing boundary

> **T5 is NOT production-ready merely because it is `T5-USABLE`.**

`T5-USABLE` records that the T5 exit gate is proven and the owner accepts the phase. Production
readiness remains a separate, explicitly-authorized gate (T18), and production remains **NOT
AUTHORIZED**.

**T5 IS FROZEN at `5079b0b3`. STOP T5.**

---

## §44 — T6 COMMERCIAL TRANSPARENCY CONTRACT (reconciled before runtime)

**Execution entry — 2026-09-06 · T6.0. T6 authorized at head `9baf6466`. T5 remains
`T5-USABLE`, frozen at runtime `5079b0b3`. Production untouched. T7+ not authorized.**

Reconciled into the canonical authority **before** any T6 runtime change, per §0 rule 13.
Plan: `docs/trade-os/T6_RATES_PRICING_LANDED_COST_IMPLEMENTATION_PLAN.md`.

### The audit that shapes the design

Nothing commercial is being replaced, because **almost none of it exists**. There is no FX
authority anywhere in the repository; no charge-component authority; no rate authority; no
landed-cost authority; no allocation authority. Logistics offers carry **five fixed numeric
columns** (freight, handling, origin, destination, documentation) — a sixth charge cannot be
expressed at all, and none of the five carries its own currency, inclusion state, provenance or
revenue classification. Procurement offers carry no components whatsoever. `inclusions` and
`exclusions` are free-text arrays: readable by a human, not classifiable by a comparator.

`tradeIntelligenceService` already states this gap honestly — *"there is no structured duty,
freight, handling or tax breakdown to build a landed cost from"* — and its `amountsByCurrency`
deliberately refuses to add currencies together because no conversion was performed. **That is the
contract T6 must satisfy before any USD comparison may appear on a screen.**

Two hazards recorded:

1. Every money column is `NOT NULL DEFAULT 'USD'`. A provider quoting JPY who omits the field
   silently produces a USD row. Staging shows the risk is *unexercised, not absent*: every existing
   amount is USD (42 import quotes, 71 logistics quotes, 115 order budgets). Multi-currency is
   entirely unproven in practice.
2. One pre-existing fabricated financial value lives **outside** Trade OS —
   `documentIntelligenceService` writes `exchange_rate_used: 13.5` and a defaulted
   `duty_calculated_zig` into `zimra_declarations` during admin OCR approval. That is a **customs**
   FX and a **duty**: T12 territory, in a separately certified subsystem. It is recorded and
   deliberately **not** changed by T6 — T12 owns the engine that must replace it — and named so it
   cannot be mistaken for a precedent.

### The permanent money model

Four concepts that must never collapse into one another:

```text
SOURCE MONEY      original_amount + original_currency — permanent commercial truth
REFERENCE USD     comparison/presentation only, always shown beside its source
SETTLEMENT MONEY  what is actually transferred — T13
CUSTOMS MONEY     the valuation/exchange basis a customs authority legally applies — T12
```

Reference FX may **never** silently become settlement FX or customs FX. The original is the
commercial fact; the USD figure is a reproducible derived presentation, carrying its rate, source
and rate date. If reference FX is unavailable the source money still shows and the comparison
degrades on its own — never 0, never 1:1, never a silent last-known rate.

### Schema decision — four additive tables

`diaspora_fx_rate_snapshots` · `diaspora_trade_charge_components` ·
`diaspora_trade_rate_observations` · `diaspora_shared_charge_allocations`.

No JSON charge blob. No universal shadow transaction. No existing authority replaced.

**One charge table, not two.** A component attaches to either a procurement offer or a logistics
offer. A polymorphic `(owner_type, owner_id)` pair would abandon referential integrity; two
near-identical tables would duplicate every rule. The table therefore carries **two nullable
foreign keys** with a CHECK that exactly one is set — real FK integrity into both domains, one
service path. The same shape T4 used for the continuation edge, for the same reason.

**Landed cost gets no table.** An estimate is a composition of charge components and FX snapshots,
both immutable, so it is reproducible by construction and a later rate change cannot rewrite an
earlier one. A table would store a derivable fact.

### Truth rules T6 adds to the programme

1. **Unknown is never zero** — not freight, not customs, not FX, not an unreadable rate source.
2. **An exclusion is not a zero.** "Destination clearing: EXCLUDED" must never render as `$0`.
3. **Different scopes are not comparable numbers.** $1,700 port-to-port is not "$400 cheaper" than
   $2,100 door-to-door until the scope difference is stated.
4. **Uncertainty is penalised, never rewarded.** A corridor with three unpriced stages must not
   appear cheaper than a fully priced one.
5. **No corridor is BEST/CHEAPEST/PREFERRED.** T5's neutrality survives T6.
6. **CarUp revenue is never labelled as a third party's charge.**
7. **Provider-stated is not verified** merely because a provider typed it.
8. **A research observation is not a provider quote**, an official fee is not a CarUp estimate, and
   a historical actual is not a current market rate.
9. **No savings claim.** Arithmetic differences between comparable options are allowed; "you saved
   $X with CarUp" needs a governed baseline and journey history (T15/T17).
10. **An estimate is not an invoice.** T6 never manufactures INVOICED/PAID/RECONCILED — T13 owns
    settlement.

### Firewalls held

Customs/tax/eligibility (T12) · settlement/escrow (T13) · documents & verification (T8) ·
warehouse (T9) · loading (T10) · tracking (T11) · reputation (T14) · Intelligence/Savings (T15) ·
AI authority (T16) · fee & subscription policy (T17) · production (T18).

Sale Incoterm ≠ CarUp service scope: T6 only prevents double-counting where a recorded scope
explicitly says a cost is already included, and infers nothing where the treatment is unknown.

---

## §45 — T6 EXECUTION: RATES, FX, LANDED COST AND CORRIDOR ECONOMICS

**Execution entry — 2026-09-06. Start `9baf6466`. Code head `b6ba1ccd`. Staging schema activated.
Production untouched. T7+ not started. PR #207 Draft.**

### FX — the source, and the limitation that matters

The ECB euro reference rates. Chosen because it is a **central bank publishing its own figures**
rather than a reseller with a convenient API, and — decisively — because the ECB itself publishes
these as *reference* rates not intended for transaction purposes. A source whose own terms match
our contract is the point: suitable for comparison, unsuitable for settlement (T13) and customs
(T12).

Verified live against the feed: 29 currencies, EUR-based. **ZWG, ZWL, MZN and TZS are not
published** — the destination market and both gateway markets. Those conversions are UNAVAILABLE.
They are not approximated, not pegged and not filled from a secondary source, because an invented
Zimbabwe rate would be acted on.

JPY→USD is not published either, so it is triangulated JPY→EUR→USD and **the legs are stored**. On
staging: `rate 0.0064001322, date 2026-09-04, legs [EUR/JPY, EUR/USD]`. Snapshots are immutable at
the database level — a newer rate is a new row, so a conversion a customer already saw stays
reproducible. Publication is business-day only, so the weekend gap is real and reads STALE with the
source's own date, never today's.

### Schema — four additive tables

`diaspora_fx_rate_snapshots` · `diaspora_trade_charge_components` ·
`diaspora_trade_rate_observations` · `diaspora_shared_charge_allocations`.

**One charge table, not two.** A component attaches to either a procurement or a logistics offer.
A polymorphic owner pair would abandon referential integrity; two tables would duplicate every
rule. Two nullable FKs with a CHECK that exactly one is set gives real integrity into both domains
and one service path — the shape T4 used for the continuation edge.

**Landed cost gets no table.** It composes immutable components and immutable snapshots, so it is
reproducible by construction and a later rate change cannot rewrite an earlier estimate.

### Three defects found by actually exercising this

1. **A JPY offer silently became a USD offer.** The audit flagged the `DEFAULT 'USD'` hazard as
   "unexercised, not absent". The staging journey exercised it: a JPY 2,400,000 supplier offer came
   back USD. The cause is that the two quote authorities read *different* field names —
   `quote_currency` and `currency` — and both fell back to `'USD'`, so supplying the other domain's
   name redenominated the offer by a factor of ~150 with nothing to catch it, because USD is a
   valid currency. `resolveSourceCurrency()` now honours either name, requires ISO-4217 when
   supplied, keeps an existing currency across a PATCH, and reaches the USD default only through
   genuine absence.
2. **"Not applicable" was treated as a gap.** A logistics quote moves cargo the customer already
   owns, so GOODS genuinely does not apply — and answering honestly reported the journey as
   incomplete. This contradicted the contract's own unknown-vs-not-applicable distinction.
3. **The coverage rule existed three times, and drifted.** Fixing (2) in the landed estimate left
   the corridor comparison and the `unpriced` list with their own copies, so the same journey read
   complete on one screen and incomplete on another. `isStageAnswered` / `isUnpricedGap` now live
   once and are imported by both, guarded by a test that computes coverage through both paths and
   asserts they agree.

A fourth was found by mutation testing before it ever shipped: an estimate with nothing priced
returned **USD 0.00** instead of null — the precise unknown-becomes-zero failure this phase exists
to prevent.

### Recorded, deliberately not fixed

`documentIntelligenceService` writes a hardcoded `exchange_rate_used: 13.5` and a defaulted
`duty_calculated_zig` into `zimra_declarations` during admin OCR approval. That is **customs** FX
and **duty** — T12 territory, in a separately certified subsystem, not the Trade OS commercial
path. Changing a certified lane to tidy a value T6 does not own would be scope creep; T12 owns the
engine that must replace it. It is named here so it cannot be mistaken for a precedent.

### Evidence

| Gate | Result |
|---|---|
| T6 PGlite migration gate (own CI step, **confirmed executed**) | **28/28** |
| T6 backend suite | **51/51** |
| Backend regression (T3 · T4 · T5 · Intake · diaspora) | **1577 / 0** |
| T6 web suite | **16/16** |
| Staging journeys — FX, procurement, logistics, allocation, security | **31/31** |
| Staging journeys — corridor economics, mode | **9/9** + **15/15** |
| Mutation testing | every failure the directive names, plus 4 of my own; three initially survived and exposed real gaps |
| CI at `b6ba1ccd` | **7/7 green**, T6 gate executed |

### Verdict

**T6-PARTIAL — owner acceptance remains.** T7 not started. Production untouched.

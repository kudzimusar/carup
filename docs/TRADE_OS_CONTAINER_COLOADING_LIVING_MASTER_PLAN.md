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
| Implemented | ✅ head `ca06e8c3` |
| Tested locally | ✅ backend 42/42, browser 48/48 (see the cycle entry in §30) |
| Lint / typecheck | ✅ `tsc` clean, lint gate `NET_NEW_ERRORS=0` |
| CI proven | ✅ all 7 workflows green at `658e2e44` and `2cb2c503`; re-running on `ca06e8c3` |
| Adversarial security proven | ✅ 13/13 over HTTP, full §9 matrix |
| Responsive UAT proven | ✅ all seven contracted widths, one real 393px defect found and fixed |
| Staging migration applied | ✅ applied to STAGING ONLY; 3 tables `rls_enabled=true`, RPC service_role-only |
| Staging DB authority proven | ✅ award RPC exercised on real Postgres — see the cycle entry |
| Staging backend serves T3 | ✅ branch preview answers the T3 routes 401, not 404 |
| Staging frontend paired to that backend | ✅ PROVEN at runtime — preview calls ONLY the branch backend |
| Exact-head unmocked browser journey | ✅ spec 47, `mode=acceptance`, bundle pinned, 3/3 desktop+tablet+mobile |
| Container-space conversion on staging | ✅ REQUESTED consumes 0; organiser approval consumes exactly 3 of 60 |
| Owner visual/product UAT | ❌ PENDING — cannot be replaced by automation |

**T3 therefore returns T3-PARTIAL, not T3-USABLE** — and the single reason is the last row.
Everything automation can establish is established: the schema and its atomic authority against
real Postgres, the frontend/backend pairing, the full unmocked requester → provider → award
journey at three viewport classes, and the container-space conversion through the existing
organiser authority. Owner visual/product acceptance has not happened, and green automation does
not substitute for it (§29). Do not describe T3 as client-ready until the owner has seen it.

## T4 — Order & Booking Passport convergence

- [ ] One operating record from awarded procurement/logistics quote.
- [ ] Aggregate participants, quote, cargo, container, documents, milestones, communications and audit.
- [ ] Prevent shadow duplication.

## T5 — Container Marketplace full product

- [ ] Sailing discovery/eligibility policy.
- [ ] Operator sailing management.
- [ ] Participant booking workspace.
- [ ] Capacity + manifest + exceptions.
- [ ] Qualified/public discovery boundaries and anti-bypass policy.

## T6 — Rates, pricing and charge allocation

- [ ] Rate source/provenance model.
- [ ] Charge components.
- [ ] Markup/discount governance.
- [ ] Per-participant freight allocation.
- [ ] Quote validity.
- [ ] Accepted quote → charges without re-entry.
- [ ] Do not hardcode undecided commercial economics.

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

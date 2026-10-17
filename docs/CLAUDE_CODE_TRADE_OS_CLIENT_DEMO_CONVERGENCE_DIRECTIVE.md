# Claude Code Directive — CarUp Trade OS Full Product Expansion

**Date:** 2026-09-04
**Repository:** `kudzimusar/carup`
**Branch:** `feat/trade-os-client-demo-convergence`
**Draft PR:** `#207`
**Canonical implementation plan:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` **v2.0**
**Plan promotion commit:** `9da04411f353aeba59cf073e31bf5374781d229e`
**Production:** MUST REMAIN UNTOUCHED

> The filename of this directive is historical. Its content now supersedes the old same-day demo mission. Do not use the old demo objective as your scope.

---

# 1. Business decision and mission

The prospective Japan→Zimbabwe shared-container client accepted the CarUp proposition.

The owner has therefore changed the programme from:

> “make the old Container Co-Loading MVP convincing enough for a demo”

into:

> **build the complete CarUp Trade OS cross-border sourcing and shared-logistics product using the existing hardened kernels.**

Do not optimize the product around a temporary demo page. Do not start over. Preserve and extend what already works.

Your immediate bounded mission is:

1. establish T0 current-state truth and reconcile with current `main`;
2. complete only the T1 workspace/identity/actor prerequisites required by sourcing;
3. implement **T2 — Request Quotes / Reverse RFQ 2.0** as a complete vertical product slice;
4. certify the buyer and seller sourcing journey against a real deployed staging pair;
5. update the v2 living master plan with evidence;
6. return the remaining T2 gaps before moving to T3.

Do **not** begin T3–T18 merely because they are documented. They are the programme roadmap, not permission to scatter changes across the entire app.

---

# 2. Read the governing plan first

Read completely:

`docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`

It is now **CarUp Trade OS — Cross-Border Trade & Shared Logistics Living Master Plan v2.0**.

It is the only master plan for this programme.

Do not create:

- a new RFQ master plan;
- a new Trade OS TODO document;
- a separate container roadmap;
- a second architecture document that competes with it.

Use its T0–T18 ledger and append execution evidence there.

Also read relevant authorities before changing code:

- `docs/CARUP_DIASPORA_TRADE_OS_SYSTEM_PLAN.md`
- `docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md`
- `docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`
- `docs/DIASPORA_PHASES_3_TO_7_HARDENING_REPORT.md`
- `docs/DIASPORA_TRADE_OS_MVP_ACCEPTANCE_MATRIX.md`
- `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`
- `docs/intelligence/receipts/I13_DIASPORA_TRADE_INTELLIGENCE.md`
- `docs/DIASPORA_PHASE10_TRADE_GRAPH_DESIGN.md`
- root `DESIGN.md`
- `docs/marketplace/MARKETPLACE_VISUAL_DNA.md`
- current Seller/Vehicle Passport/registration-lifecycle plans referenced from the master plan.

The old documents are historical inputs. Current code and the v2 master plan are authoritative when they differ.

---

# 3. First inspect the current branch and current main

Before editing runtime code:

1. record current local HEAD, remote branch HEAD and `origin/main`;
2. confirm working tree state;
3. determine whether `main` advanced beyond the original #207 base;
4. if `main` advanced, assess conflicts and deliberately reconcile/rebase/merge according to repository governance before feature expansion;
5. do not silently overwrite newer Seller, Communications, Intelligence, Passport, navigation or security work;
6. update T0 in the master plan with the exact baseline.

The branch already contains the September Container owner-UAT correction work. Preserve it unless current `main` proves a conflict.

---

# 4. Existing Reverse RFQ code — do not guess

Inspect at minimum:

- `web/src/pages/diaspora/DiasporaReverseRfq.tsx`
- `backend/services/diaspora/diasporaBuyerOrderService.js`
- `backend/services/diaspora/diasporaRfqService.js`
- `backend/services/diaspora/diasporaDemandSupplyMatchingService.js`
- `backend/routes/diasporaBuyerOrderRoutes.js`
- `backend/constants/diaspora/diasporaRfqConstants.js`
- `web/e2e/diaspora-reverse-rfq.spec.ts`
- relevant shared/web RFQ types in `web/src/types/index.ts` and `shared/types/index.ts`
- RFQ/quote migrations and RLS/policies;
- `diaspora_import_orders` and `diaspora_import_quotes` schema;
- `diaspora_import_order_participants` usage;
- current entitlement guard for RFQ create/respond;
- current Order Passport aggregation;
- current Communications reference-flow APIs/services;
- current feature registry/navigation entries for RFQ/Trade OS.

Known starting mismatch you must verify rather than assume:

- backend buyer orders support `vehicle`, `parts`, `mixed`, richer route/timing/budget/taxonomy data;
- current buyer UI creates a thin order and historically hard-coded `order_type: 'parts'`;
- backend quote supports amount/currency, valid-until, inclusions/exclusions, stock linkage, lead time, shipping terms, draft/submit/edit/withdraw;
- current seller UI historically exposes little more than an amount input;
- deterministic matching already exists and is explainable;
- seller RFQ listing historically applies tenant filtering that can prevent a real cross-tenant marketplace.

Confirm the exact current branch state before changing it.

---

# 5. Product language — do not lead with “Reverse RFQ”

Internal code/domain terminology may remain RFQ.

Primary buyer-facing label:

**Request Quotes**

Supporting copy:

> Tell CarUp what you need. Suitable suppliers can send you offers so you can compare price, availability, timing and terms before choosing.

Primary seller-facing label:

**Buyer Requests** or **Opportunities**

Supporting copy:

> Find customers actively looking for products you can supply.

Help text may explain:

> This process is commonly called a Request for Quotation (RFQ).

Do not require laymen users to understand “reverse RFQ” before using the feature.

---

# 6. Critical intent separation

The Trade OS must distinguish:

## A. Buy something

Procurement sourcing. Initial supported verticals:

- Vehicle
- Vehicle parts
- Mixed/multiple automotive items

## B. Ship something

Logistics request for cargo already owned/bought.

T3 implements full Logistics RFQ later, but T2 must establish the intent entry and route users honestly.

Do NOT broaden procurement into a general goods marketplace merely because Container Co-Loading accepts non-automotive cargo.

A user shipping household effects is not a procurement buyer.

If “Ship something” is not implemented during this cycle, render an honest handoff to the currently functioning Container/Shipping surface or a clearly described unavailable/next-step state. Do not fake a completed logistics RFQ.

---

# 7. T1 prerequisites — do only what T2 requires

Do not spend this cycle rebuilding every Trade OS route.

Required T1 work is limited to the prerequisites that make Request Quotes coherent:

- Trade OS navigation includes the sourcing path in plain language;
- contextual identity uses business/trade context, not generic “Car Owner” as the primary sourcing identity;
- buyer/seller commercial context and transaction relationships remain separate from security roles;
- RFQ route lives inside the corrected authenticated Trade OS workspace rather than an unsuitable public marketing shell;
- responsive geometry contract applies to the RFQ surfaces;
- cross-tenant marketplace eligibility is designed using scoped capability/projection, not role escalation.

Do not create global `buyer`, `supplier`, `shipper` or `logistics_provider` security roles to solve UI semantics.

---

# 8. T2 buyer journey — Request Quotes

Build a proper guided sourcing experience.

## 8.1 Entry

Within Trade OS, the user should be able to choose:

- **Buy something**
- **Ship something**

Buy enters the sourcing wizard.

## 8.2 Step: choose request type

Present understandable options:

- Vehicle
- Vehicle parts
- Multiple items

Do not expose database values as the primary copy.

## 8.3 Vehicle request

Capture progressively:

- make;
- model;
- acceptable year range;
- condition preference;
- optional variant/trim/fuel/transmission if the buyer knows it;
- “I’m flexible / not sure” where appropriate;
- source/origin preference if any;
- destination country/city;
- optional budget + currency;
- urgency or needed-by date;
- additional requirements.

Reuse canonical vehicle taxonomy normalization. Do not build a second make/model vocabulary.

## 8.4 Parts request

Capture:

- ordinary part name;
- quantity;
- make/model/year or linked CarUp vehicle where available;
- OEM/part number if known;
- explicit **I don’t know the part number** path;
- condition/OEM/aftermarket preference where relevant;
- destination;
- needed-by/urgency;
- optional budget;
- reference photo/evidence only through governed upload infrastructure.

If the buyer selects a Vehicle Passport, link canonical vehicle identity rather than copying authoritative vehicle facts into ad-hoc metadata.

Do not present inferred fitment as verified compatibility.

## 8.5 Multi-item request

Support multiple requested lines under one buyer request where the buyer wants a single commercial offer.

Do not force one RFQ per line unless the data model absolutely requires it. If schema extension is required, design the smallest additive authoritative model and document the decision in the master plan before migration.

## 8.6 Draft and review

Buyer must be able to:

- save/edit a draft;
- review a plain-language summary;
- see what sellers will see;
- understand privacy boundaries;
- publish deliberately.

Do not publish on initial form submit without a review step.

Use current lifecycle where possible; do not invent status strings casually.

---

# 9. Cross-tenant marketplace — highest-risk architecture task

Current tenant isolation must remain intact.

A real RFQ marketplace requires eligible sellers from other organisations to see a **safe published opportunity** without gaining private access to the buyer's order.

Target model:

```text
PRIVATE AUTHORITATIVE BUYER ORDER
        ↓ publish
SAFE RFQ MARKETPLACE PROJECTION
        ↓
ELIGIBLE SELLER
        ↓ scoped quote capability
SELLER QUOTE → authoritative order reference
```

Do NOT “fix” marketplace discovery by simply deleting a tenant filter or weakening RLS.

Before implementation:

1. inspect `diaspora_import_orders` RLS/policies;
2. inspect `diaspora_import_quotes` RLS/policies;
3. inspect `diaspora_import_order_participants` and whether it can represent seller participation safely;
4. inspect service-role/server-side access patterns already used by public/qualified projections elsewhere in CarUp;
5. write a short decision note inside the master-plan execution entry explaining the selected pattern.

A published seller projection may contain only safe fields required to decide whether to quote, such as:

- RFQ/reference;
- product/vehicle/part requirements;
- quantity;
- destination;
- timing/deadline;
- request category;
- non-identifying buyer verification/business signal where policy allows;
- quote deadline;
- relevance/match explanation.

It must not expose:

- buyer private email/phone;
- raw hidden identifiers unless needed internally and non-sensitive;
- unrelated tenant data;
- private evidence/documents;
- internal risk flags;
- other suppliers’ private quote details.

Adversarial tests are mandatory.

---

# 10. Seller opportunity experience

Do not render a raw RFQ table with an amount box.

Create a genuine opportunity marketplace.

A seller should understand:

- what the buyer needs;
- quantity/specification;
- destination;
- timing;
- what is known/unknown;
- whether the seller has a relevant stock match;
- how long the opportunity remains open;
- how to ask a question;
- how to prepare an offer.

Example presentation semantics:

```text
Honda Fit GD1 front shocks
20 units
Harare, Zimbabwe
New or quality aftermarket
Needed by 30 October
Part number: Buyer does not know
Strong match: your published stock has compatible make/model and available quantity
```

Seller actions:

- Prepare quote
- Ask a question
- Not relevant / hide

Add filters only for real fields.

Do not fabricate “hot”, “trending” or demand volume badges.

---

# 11. Explainable matching

Preserve `diasporaDemandSupplyMatchingService` as deterministic/explainable unless a current equivalent supersedes it.

Current signals include:

- make;
- model;
- year overlap;
- part number;
- availability;
- export readiness.

Extend only using authoritative data.

Potential additions during T2 if low-risk:

- quantity sufficiency;
- destination/corridor compatibility;
- supplier location;
- requested condition;
- needed-by vs lead time;
- budget fit;
- verified stock evidence.

Do not add compatible-container ranking unless it comes from real sailing capacity and does not destabilize T2.

Internal numeric score may sort. UI must show plain-language reasons, not unexplained percentages.

---

# 12. Buyer↔seller clarification

RFQ must support questions before a quote.

Use canonical CarUp Communications.

Do not create:

- `rfq_messages` shadow table;
- feature-specific chat state;
- seller/buyer DM system outside Communications.

Use a canonical RFQ/order reference flow.

Required semantics:

- buyer/seller participant authorization;
- exact authored messages;
- system status events separate;
- safe identity presentation;
- no automatic exposure of phone/email;
- anti-bypass/contact policy preserved.

If current Communications cannot safely create the two-party reference thread without wider refactor, document the exact blocker and leave the task `[~]`; do not fake a chat button.

---

# 13. Seller quote composer

Expose the commercial capability already in the backend.

At minimum support:

## Offer

- seller/business identity;
- offered item/description;
- quantity/specification;
- linked stock item/passport when authorized.

## Price

- quote amount;
- currency;
- unit price/subtotal where the order structure supports it;
- clear total.

## Timing

- lead time/dispatch;
- valid until.

## Logistics terms

- shipping included / excluded / not provided;
- shipping terms;
- origin/pickup where supplied;
- destination/service level where supplied.

## Commercial terms

- inclusions;
- exclusions;
- notes/conditions.

Use current backend fields first. Add schema only when a required user concept cannot be represented safely.

Draft lifecycle must be usable:

- create/save draft;
- edit draft;
- review;
- submit;
- withdraw where current rules permit.

Do not allow submitted/accepted quote mutation outside governed rules.

---

# 14. Quote comparison

Buyer needs a real comparison surface.

Compare actual fields side-by-side where possible:

- seller/business;
- offered item/stock evidence;
- quantity;
- price/total;
- currency;
- shipping included/excluded;
- lead time;
- valid until;
- inclusions;
- exclusions;
- governed supplier reputation if one legitimately exists.

Unknown values render:

- Not provided
- Not enough data
- Not verified

as appropriate.

Do NOT:

- convert currencies without approved FX authority;
- calculate landed cost without authoritative duty/freight/fee components;
- show “best deal 92%”;
- use Vehicle Trust as seller reputation;
- treat cheapest as recommended by default.

Deterministic highlights are allowed only if obvious from recorded facts, e.g. lowest recorded quote total in the same currency, fastest recorded lead time, shipping included.

---

# 15. Award and quote → order conversion

Preserve the existing atomic accepted-quote RPC unless current main has superseded it.

Prove:

- buyer/order authority alone can accept;
- quote belongs to the order;
- only submitted quote accepted;
- same-quote replay idempotent;
- different second acceptance rejected;
- sibling submitted quotes transition according to current contract;
- seller cannot self-accept;
- cross-tenant actor cannot accept.

After acceptance, move the same transaction forward.

Do not require the buyer to re-enter:

- vehicle/part request;
- seller;
- price;
- accepted quote;
- route/destination.

Accepted quote should activate/continue the Order Passport and provide the next legitimate step (documents/payment/logistics depending on what is actually connected).

If an “order” already is the authoritative `diaspora_import_orders` row, do not create a duplicate “new order”; update lifecycle/relationships instead.

---

# 16. Events, notifications and intelligence

Use canonical domain-event/Communications patterns.

Minimum events to evaluate/implement:

- RFQ published;
- quote submitted;
- quote withdrawn;
- seller question / buyer answer via conversation semantics;
- quote accepted;
- quote not selected / RFQ closed;
- accepted quote ready for next operating step.

Do not notify on every draft keystroke.

T2 Intelligence should be narrow and measured:

- open requests;
- real quote counts;
- time to first quote;
- time to award;
- requests with no quotes;
- category/destination demand where source is readable;
- quote/award conversion.

Follow I13 truth rules:

- unreadable ≠ zero;
- no fake revenue;
- no unsupported landed cost;
- no cross-currency totals;
- Trade Graph not activated merely for richer UI.

---

# 17. Design contract

Root `DESIGN.md` is global authority.

`docs/marketplace/MARKETPLACE_VISUAL_DNA.md` is a reference, not a page template.

Request Quotes should feel like CarUp while behaving like a sourcing operating system.

Use:

- clear intent-led entry;
- progressive disclosure;
- ordinary-language help;
- navy/charcoal anchors;
- restrained orange primary actions;
- open editorial composition;
- calm data density;
- no generic nested card wall;
- no raw IDs in primary UI;
- truthful loading/empty/unavailable states;
- responsive forms/comparison tables;
- clear actor labels and transaction context.

Do not keep the old RFQ UI merely because the backend tests use its locators. Update tests to the correct product.

Hard geometry assertions at least:

- 393×852;
- 820×1180;
- 1024×768;
- 1280×800;
- 1366×768;
- 1440×900;
- 1536×864.

For every final operating route:

```text
document.documentElement.scrollWidth <= window.innerWidth + 1
body.scrollWidth <= window.innerWidth + 1
```

Review full-page screenshots by eye.

---

# 18. Security tests — mandatory T2 matrix

At minimum prove:

1. anonymous cannot access private buyer orders;
2. buyer A cannot read buyer B private draft;
3. published RFQ safe projection is visible only to eligible seller actors under the chosen marketplace policy;
4. seller cannot use marketplace visibility to fetch the private underlying order;
5. safe projection contains no forbidden private fields;
6. seller A cannot access seller B private quote;
7. buyer can read quotes submitted to their request only under governed path;
8. buyer cannot edit seller quote;
9. seller cannot mutate buyer request;
10. seller cannot accept their own quote;
11. cross-tenant unrelated actor cannot accept quote;
12. accepted quote cannot be withdrawn/edited improperly;
13. atomic acceptance concurrency remains safe;
14. spoofed tenant/role headers fail;
15. unreadable RFQ/quote reads do not render false empty states;
16. Communications participants cannot read another RFQ conversation;
17. document/evidence references do not leak through marketplace projection.

Do not relax RLS simply to make the browser journey pass.

---

# 19. Test strategy

Run baseline tests before edits and affected suites after each substantial boundary.

At minimum include:

- RFQ buyer-order backend tests;
- seller RFQ/quote backend tests;
- atomic quote acceptance tests;
- demand/supply matching tests;
- auth/tenant/RLS tests;
- Communications tests if questions/events change;
- Intelligence tests if projections change;
- navigation/feature registry tests;
- TypeScript;
- web unit tests;
- RFQ mocked e2e;
- deployed staging unmocked buyer journey;
- deployed staging unmocked seller journey;
- privacy/adversarial browser/API checks;
- geometry/full-page screenshots desktop/narrow desktop/tablet/mobile;
- relevant existing Container/Trade OS regression gates so T2 does not break the client-accepted co-loading foundation.

Do not lower assertions or mark skips merely to achieve green.

---

# 20. Staging fixtures

Use clearly synthetic staging-only data.

Minimum T2 end-to-end fixtures should include:

- Buyer A with a vehicle request;
- Buyer B or separate fixture for a parts request;
- Supplier A with matching published stock;
- Supplier B with a competing valid quote if practical;
- unrelated tenant/supplier adversarial actor;
- one request with unknown part number path;
- one request with at least two quotes so comparison/atomic award are visible.

Do not reuse another gate's mutable identity if the staging architecture supports per-gate ownership.

Credentials remain outside git.

Production untouched.

---

# 21. What NOT to build in this cycle

Do not branch into T3–T18 unless a narrow prerequisite is unavoidable.

Specifically do not spend this T2 cycle building:

- full Logistics RFQ;
- full pricing engine;
- payment provider activation;
- full warehouse WMS;
- loading planner;
- carrier API integrations;
- full customs system;
- complete Trade Graph activation;
- logistics reputation;
- enterprise API programme;
- production deployment.

Record discovered dependencies in the master plan under their proper T phase.

---

# 22. Plan-update rule

As you work, update:

`docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`

Move only tasks genuinely proven.

Every execution entry must include:

- candidate SHA;
- current main/base SHA;
- branch/PR;
- T0/T1/T2 tasks moved;
- files changed;
- migrations/RLS changes;
- security design decision for marketplace projection;
- backend tests/results;
- web tests/results;
- staging FE/BE exact URLs;
- paired SHA/provenance;
- DB environment;
- visual proof;
- known limitations;
- production touched = NO;
- next unchecked T2 task.

Do not depend on this prompt for durable state after the run.

---

# 23. First return format

Return exactly:

```text
TRADE OS T2 — REQUEST QUOTES / REVERSE RFQ 2.0 RETURN

Verdict: T2-USABLE | T2-PARTIAL | BLOCKED

Candidate SHA:
Branch / PR:
Current main baseline:
Frontend staging:
Backend staging:
DB:
Paired provenance:
Production touched: NO

T0 foundation:
T1 prerequisites:
T2 buyer Request Quotes:
T2 seller Buyer Requests:
Cross-tenant marketplace projection:
RFQ privacy/RLS:
Buyer↔seller clarification:
Quote composer:
Quote comparison:
Atomic award:
Order/Passport continuation:
Notifications/Communications:
RFQ Intelligence:
Responsive/design proof:
Security/adversarial proof:
Regression result:
Master plan updated: YES/NO

Remaining T2 blockers:
Next unchecked task:
```

**T2-USABLE** requires the complete buyer→seller→quote→compare→accept journey to work on the deployed exact-head staging frontend/backend with real staging records, plus safe cross-tenant marketplace semantics and owner-inspectable responsive UI.

Do not call the entire Trade OS “complete.” T2 is one vertical phase of T0–T18.

---

# 24. Immediate instruction

Start now from the v2 master plan at commit `9da04411f353aeba59cf073e31bf5374781d229e`.

First establish T0 and inspect the actual current Reverse RFQ implementation and RLS. Then implement only the T1 prerequisites required by sourcing and proceed through T2 in the order defined by §26 of the master plan.

The priority is not speed through checkboxes. The priority is to turn the existing backend capability into a coherent sourcing marketplace ordinary buyers and sellers can actually understand and use, without weakening CarUp's security, truth or data ownership.

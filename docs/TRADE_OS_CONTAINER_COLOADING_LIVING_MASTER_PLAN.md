# CarUp Trade OS — Container Co-Loading Living Master Plan

**Status:** CANONICAL ACTIVE PLAN  
**Version:** 1.0  
**Date:** 2026-09-04  
**Repository:** `kudzimusar/carup`  
**Implementation branch:** `feat/trade-os-client-demo-convergence`  
**Baseline:** `main@bb9d9900c700873ca57df0ac18a1a5c01f77711a`  
**Primary immediate objective:** make the existing Trade OS container co-loading capability demonstrably usable with real staging data today, then continue iterating without creating a parallel system.

---

# 0. Governance — this document is the active contract

This is the governing implementation, product, UAT and operating manual for the CarUp Trade OS container-sharing/co-loading capability from 2026-09-04 onward.

It does **not** erase the historical Trade OS documents. It reconciles them with the Seller, Communications, Intelligence, Vehicle Passport, Trust, onboarding and security work merged after the Trade OS programme paused.

Every human or AI implementation agent must:

1. Read this file before changing Trade OS/container code.
2. Use the task ledger in this file as the roll-call. Do not work from chat memory alone.
3. Mark a task `[x]` only when implementation **and** the stated evidence exist.
4. Use `[~]` for started/partially proven and `[ ]` for not started.
5. Record commit SHA, tests, staging evidence and any deviation next to the task before moving on.
6. Preserve the authoritative data model and security boundaries below.
7. Reuse the existing Trade OS services, routes, migrations and tables rather than rebuilding a second container system.
8. Reuse canonical CarUp Communications, identity, Evidence/Drive, Intelligence and Vehicle Passport surfaces where integration is required.
9. Never turn a business identity such as logistics provider into a platform-security role merely to make a demo work.
10. Never fabricate shipment, payment, Trust, reputation, compliance, capacity or delivery state.
11. Keep production untouched until a separately authorized production cutover.
12. If implementation reality contradicts this plan, document the contradiction and amend this plan deliberately; do not silently diverge.

**Owner requirement:** the first implementation return must prioritize a working, coherent staging demonstration over speculative breadth. Most of the engine already exists; this programme is a convergence and usability programme, not a rewrite.

---

# 1. Product purpose

CarUp is the mediation and operating layer for shared container trade between participants, the shipment/container organiser and the downstream Zimbabwe vehicle/trade ecosystem.

The immediate client use case is:

> A Japan-based organiser wants to run 40-foot shared containers to Zimbabwe, initially targeting October and December shipments. Participants may ship cars or other eligible cargo that legally and safely fits the container. The organiser needs one system to coordinate participants, cargo, space, documents, loading and shipment progress instead of scattered DMs and spreadsheets.

CarUp's role is **not** to pretend to be the shipping line, customs authority, bank or insurer. CarUp provides the digital system of record and governed workflow connecting the parties.

### Value proposition

CarUp should let the organiser:

- publish/open a shipment/container opportunity;
- show route, dates, booking deadline and available capacity;
- receive structured cargo-space requests;
- understand who is shipping what;
- approve, reject or cancel reservations safely;
- prevent approved reservations from overfilling the container;
- coordinate loading and shipment information;
- keep operational messages attached to the correct container/order;
- keep participant documents and evidence governed and separated;
- maintain a traceable audit trail;
- connect vehicle imports to the later Vehicle Passport / Zimbabwe ownership journey;
- expose real operational intelligence from actual records rather than invented dashboards.

CarUp should let a participant:

- discover an available shared container;
- understand the route, departure target, deadline and remaining capacity;
- request space for a vehicle, parts, household goods or another eligible cargo category;
- provide cargo dimensions/volume/weight/value/description as appropriate;
- see reservation status;
- receive relevant updates and communication;
- follow the later shipment/order journey when linked;
- preserve evidence relating to their own cargo/order.

---

# 2. Product north star and canonical data flow

The platform must preserve one connected trade journey:

```text
CarUp user
  -> registration profile
  -> organisation / tenant membership where applicable
  -> trade role/profile extension
  -> import order or cargo intent
  -> cargo reservation
  -> container
  -> shipment
  -> documents / payment milestones / compliance
  -> Zimbabwe readiness
  -> Vehicle Passport / ownership handoff where cargo is a vehicle
  -> trade/logistics reputation outcome
  -> Intelligence projections
```

Communications, Notifications, Security, Audit and AI surround this journey; they do not create shadow copies of it.

**Architectural rule:**

> One identity -> one authoritative transaction -> one evidence trail -> one event stream -> many projections.

---

# 3. Existing implementation that MUST be reused

## 3.1 Existing container kernel

Current authoritative files:

- `backend/services/diaspora/diasporaContainerMarketplaceService.js`
- `backend/routes/diasporaContainerMarketplaceRoutes.js`
- `database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql`
- `backend/tests/diaspora-container-marketplace.test.js`
- `web/src/pages/diaspora/DiasporaContainerMarketplace.tsx`
- `web/e2e/diaspora-container-marketplace.spec.ts`
- `web/src/hooks/useCarUpApi.ts`
- `web/src/types/index.ts`
- `web/src/App.tsx`
- `web/src/config/featureRegistry.ts`
- `shared/navigation/feature-manifest.json`

Existing authoritative tables:

- `diaspora_container_shipments`
- `diaspora_cargo_reservations`
- `diaspora_shipments`
- `diaspora_shipment_stage_events`
- `diaspora_import_orders`
- `diaspora_import_quotes`
- `diaspora_trade_documents`
- `diaspora_payment_milestones`
- `diaspora_import_audit_log`

## 3.2 Existing truths that are already strong

The implementation already supports:

- create/list containers at API level;
- request/list cargo reservations;
- approve/reject/cancel reservation;
- close booking;
- authoritative approved-volume capacity calculation;
- optional weight guard;
- concurrency-safe atomic approval RPC;
- participant-safe reservation visibility;
- tenant-aware service-layer permission checks;
- sealed/critical audit trails;
- explicit separation between closing booking and shipment/delivery/customs/payment;
- UI route `/diaspora/containers`;
- backend and browser tests;
- previous canonical staging UAT certification.

Capacity contract:

```text
USED_VOLUME = sum(APPROVED reservation estimated_volume)
AVAILABLE_VOLUME = total_capacity_volume - USED_VOLUME
FILL_PERCENT = USED_VOLUME / total_capacity_volume
READY_TO_CLOSE = FILL_PERCENT >= 0.90
FULL = FILL_PERCENT >= 0.98
```

Pending reservations do not consume approved capacity. Approval must never bypass the atomic RPC.

## 3.3 Historical documents that remain evidence/reference

Read these when implementation questions arise:

- `docs/CARUP_DIASPORA_TRADE_OS_SYSTEM_PLAN.md`
- `docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md`
- `docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`
- `docs/DIASPORA_PHASES_3_TO_7_HANDOFF.md`
- `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_HARDENING_DIRECTIVE.md`
- `docs/DIASPORA_PHASES_3_TO_7_HARDENING_PROGRESS.md`
- `docs/DIASPORA_PHASES_3_TO_7_HARDENING_REPORT.md`
- `docs/DIASPORA_TRADE_OS_MVP_ACCEPTANCE_MATRIX.md`
- `docs/DIASPORA_TRADE_OS_DEPLOYED_BROWSER_UAT_REPORT.md`
- `docs/DIASPORA_PHASE10_TRADE_GRAPH_DESIGN.md`

The historically referenced `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md` is not present on current `main`; do not rely on it as an available runtime artifact.

---

# 4. Reconciliation with newer CarUp architecture

Trade OS was not actively evolved while major CarUp foundations changed. The container programme must now converge with these newer authorities.

## 4.1 Identity and onboarding

Canonical new signup context:

- `backend/services/auth/registrationProfileService.js`
- `database/migrations/20260829123000_user_registration_profiles.sql`

Rules:

- account identity and commercial identity are not authorization roles;
- public signup remains unprivileged;
- business onboarding may record a logistics/freight business type, but that type must not grant platform authority;
- operational authority comes from governed organisation/tenant membership and scoped permissions.

Current gap: the business-type vocabulary does not explicitly contain logistics/freight-forwarder. This must be reconciled without creating a global `logistics` platform role.

Target model:

```text
user
 -> user_registration_profile(account_kind=business)
 -> organisation/tenant
 -> business_type=logistics_provider (or approved equivalent)
 -> tenant owner/admin/staff membership
 -> scoped container permissions
```

The organiser must **not** need `platform_admin`, `government`, or a reviewer role to run their own container business.

## 4.2 Communications 2.0

Canonical plan:

- `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`

Trade/container subjects already belong in the canonical communications architecture, including `diaspora_order` and `container_booking`.

Rules:

- human coordination must use the CarUp canonical conversation model;
- WhatsApp/email/Telegram/web are channels, not separate business records;
- exact human messages must be preserved;
- reservation and shipment state transitions remain domain records, not chat messages;
- activity notification and human conversation are separate semantics.

For the demo slice, reservation-created/approved/rejected/cancelled and booking-closed states should create the correct activity notification and, where a human coordination thread is needed, bind to/reuse a canonical `container_booking` conversation rather than inventing a Trade OS chat silo.

## 4.3 Intelligence 1.0

Relevant authority:

- `docs/intelligence/receipts/I13_DIASPORA_TRADE_INTELLIGENCE.md`
- `backend/services/intelligence/tradeIntelligenceService.js`
- `backend/services/diaspora/tradegraph/diasporaTradeIntelligenceService.js`

Rules:

- authoritative tables win;
- no fake zero when data is unreadable;
- no settlement claims without confirmed settlement;
- no shipment demand claims when there are no shipment records;
- no cross-currency total without FX authority;
- do not activate Trade Graph merely to make the demo richer.

The first demo may show operational container metrics sourced directly from authoritative container/reservation records: capacity, approved/pending reservation counts and actual statuses. Do not fabricate market opportunity, route demand, revenue or reputation.

## 4.4 Trade Graph

Relevant authority:

- `docs/DIASPORA_PHASE10_TRADE_GRAPH_DESIGN.md`
- `backend/constants/diaspora/diasporaTradeGraphConstants.js`

The vocabulary already includes container/reservation events. The graph has historically been feature-gated/off and previously empty.

For today:

- preserve event-compatible semantics;
- do not make the demo depend on the graph;
- if existing canonical event emission can be wired safely with minimal scope, do so;
- otherwise record the missing projection wiring as P1 and keep authoritative table behaviour primary.

## 4.5 Seller / Vehicle Passport / Zimbabwe registration lifecycle

Relevant plans:

- `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`
- `docs/seller/ZIMBABWE_SELLER_REALITY_COMMUNICATIONS_HARDENING_PLAN.md`

Container/shipment records can provide provenance for vehicle import states such as:

- import in transit;
- arrived/customs pending;
- customs cleared/CVR pending;
- CVR/plate pending;
- locally registered.

Rules:

- do not duplicate Seller/listing data inside a container reservation;
- if cargo is a CarUp vehicle/import order, link it by canonical identifier;
- shipment/container evidence may strengthen Vehicle Passport provenance;
- it must not directly invent or manually alter canonical Vehicle Trust.

## 4.6 Trust and reputation

Separate concepts:

- **Vehicle Trust:** governed vehicle/evidence authority.
- **Trade/Logistics Reputation:** performance outcome of importer/seller/logistics provider.
- **Listing completeness/readiness:** not Trust.

The historical `diaspora_trade_profiles.trust_score` must not become a second universal CarUp Trust authority. Any future use must be explicitly reconciled as a derived trade reputation concept.

## 4.7 Drive / Evidence

Reuse the governed provider already used by Trade OS and later Seller work:

- `backend/services/diaspora/drive/googleDriveProvider.js`
- existing credential vault/provider abstraction.

Drive is storage, not public authority. CarUp metadata/evidence remains authoritative.

Container documents should ultimately bind to the relevant order/container/shipment and participant, for example packing list, invoice, bill of lading, customs documentation and delivery evidence.

Live Drive is not a P0 blocker for today's first usable demo unless the staging environment already has it legitimately activated.

---

# 5. Immediate demo scope — definition of “works today”

The first usable staging return is accepted only if a real browser user can complete the core journey without developer tools or direct DB edits during the demonstration.

## Demo Actor A — Container organiser / logistics operator

The organiser can:

1. sign in through the normal CarUp account path;
2. reach Trade OS through visible navigation;
3. open Container Co-Loading;
4. create an October or December Japan -> Zimbabwe container from the UI;
5. enter at minimum:
   - origin country/city;
   - destination country/city;
   - departure target/date;
   - booking deadline;
   - container type;
   - total CBM;
   - optional max weight;
   - public/participant-safe notes or cargo eligibility guidance;
6. see the created container in the open-container list;
7. open it and see capacity state;
8. see incoming reservation requests;
9. approve/reject valid requests;
10. see capacity update after approval;
11. see a truthful full/ready state based on approved reservations;
12. close booking only through the governed action;
13. see audit/activity state rather than silent mutations.

## Demo Actor B — Participant/customer

The participant can:

1. sign in through normal CarUp identity;
2. navigate to the available shared containers;
3. open a specific Japan -> Zimbabwe container;
4. request space using a structured form;
5. choose cargo category such as:
   - vehicle;
   - vehicle parts;
   - household/personal effects;
   - general eligible cargo;
   - other eligible cargo;
6. provide cargo description;
7. provide estimated volume (CBM);
8. optionally provide estimated weight, declared value/currency and an import-order/vehicle reference if one exists;
9. submit the request;
10. see `REQUESTED`, then the later approved/rejected state;
11. see only records they are allowed to see;
12. receive/see the relevant activity update and a clear route to communication where implemented.

## Demo Actor C — Owner/observer

The CarUp owner can show:

- Trade OS navigation and purpose;
- open container(s);
- capacity truth;
- structured reservations;
- operator decision;
- participant status;
- real audit/notification evidence;
- linked order/passport evidence where a vehicle/import order exists;
- operational Intelligence only where the data actually exists.

---

# 6. P0 implementation ledger — complete before the first client demonstration

Claude/agents must take roll-call against this list on every return.

## D0 — Baseline and regression boundary

- [ ] Verify working branch derives from `main@bb9d9900c700873ca57df0ac18a1a5c01f77711a` or document the newer reconciled SHA.
- [ ] Working tree clean before implementation.
- [ ] Read this master plan plus the files listed in §3 and §4.
- [ ] Run targeted baseline tests for container marketplace, auth/tenant isolation, route validation and the directly affected web surface.
- [ ] Record baseline results here before changing behaviour.

**Evidence:** commit/SHA + exact test commands/results.

## D1 — Navigation and Trade OS entry coherence

- [ ] Confirm `/diaspora/containers` still resolves.
- [ ] Ensure a normal authorized business/participant can discover Trade OS / Container Co-Loading through current navigation without knowing the URL.
- [ ] Preserve feature-registry/feature-manifest consistency.
- [ ] Add clear links between the relevant Trade OS surfaces: import orders, container co-loading, documents/passport where applicable, and Trade Intelligence.
- [ ] Do not expose admin/reviewer consoles to ordinary participants.

**Demo acceptance:** owner can start from a normal dashboard/Trade OS entry and reach the container page in clicks, not by typing a hidden route.

## D2 — Proper logistics organiser identity and permission semantics

- [ ] Add an explicit non-authorizing business identity for logistics/freight operation to the registration/business vocabulary and DB constraint through an additive migration if required.
- [ ] Do **not** create a new global platform security role merely for the organiser.
- [ ] Reuse organisation/tenant membership/scoped authority.
- [ ] Replace route-level assumptions that only reviewer/admin/government actors may create/manage containers where they block a legitimate tenant operator.
- [ ] Keep service-layer ownership/tenant permission checks authoritative.
- [ ] Prove another tenant cannot manage the organiser's container.
- [ ] Preserve platform reviewer/admin oversight as an additional path, not the client's required identity.

**Demo acceptance:** a legitimate business operator can create/manage its own container without being made platform admin.

## D3 — Operator Create Container UI

- [ ] Add the missing UI over the already-existing `POST /api/diaspora/container-marketplace/containers` endpoint.
- [ ] Use existing design system and current dashboard patterns.
- [ ] Validate required fields client-side for usability and server-side for truth.
- [ ] Provide actionable validation/error messages.
- [ ] Refresh/select the new container after creation.
- [ ] Never silently substitute demo values when fields are missing.

**Demo acceptance:** organiser creates the October/December container entirely through UI.

## D4 — Rich cargo-space request UI

Current UI asks only for CBM even though the backend already supports richer fields. Close this gap.

- [ ] Cargo category.
- [ ] Cargo description.
- [ ] Estimated volume (CBM), required.
- [ ] Estimated weight, optional unless the selected operation requires it.
- [ ] Declared value and currency, optional and clearly labelled as declared—not verified value.
- [ ] Optional import order / vehicle linkage using a valid participant-owned record where available.
- [ ] Eligibility acknowledgement / organiser instructions if such data is available.
- [ ] Preserve server validation and participant ownership.

**Do not** claim CarUp has confirmed dangerous-goods eligibility, customs classification or shipping-line acceptance unless a real governed authority exists.

## D5 — Reservation operations and capacity truth

- [ ] Preserve atomic `diaspora_approve_cargo_reservation_atomic` as the only approval path.
- [ ] Preserve optional weight overfill protection.
- [ ] Show REQUESTED/APPROVED/REJECTED/CANCELLED clearly.
- [ ] Show pending and approved counts separately.
- [ ] Only APPROVED volume consumes used capacity.
- [ ] Capacity refreshes after approve/reject/cancel.
- [ ] Participant can cancel own eligible reservation.
- [ ] Operator sees participant-safe identifying context needed for operations, not unrelated private data.
- [ ] Unreadable state must never render as “none”.

## D6 — Booking close semantics

- [ ] Keep “Close booking” distinct from “container departed”, “shipment delivered”, “customs cleared” and “paid”.
- [ ] Decide and document whether 90% is advisory or enforced for closing. Current system treats it as an indicator, not a hard gate.
- [ ] For today's demo, do not silently change this business rule. If operator may close below 90%, show that it is a manual decision; if enforcement is introduced, add tests and explain the rule in UI.

## D7 — Communications and activity stitching

- [ ] Inspect the current post-#194 Communications runtime before writing integration code.
- [ ] Reuse canonical subject `container_booking` / relevant `diaspora_order` context.
- [ ] On reservation request, create/emit the appropriate one-way activity notification.
- [ ] On approval/rejection/cancellation/booking close, surface the appropriate activity state.
- [ ] Where human coordination is enabled, bind it to a canonical CarUp conversation rather than a feature-specific chat table.
- [ ] Keep exact user-authored text separate from system-generated status events.
- [ ] Do not block the P0 demo on WhatsApp/Telegram delivery if provider routing is not required for the browser demonstration; web/app communication state is sufficient for first return if truthful.

## D8 — Intelligence coherence

- [ ] Preserve I13 Truth & Trust rules.
- [ ] Show only measured container/reservation facts available from authoritative tables.
- [ ] No fake route-demand ranking, freight revenue, settled value or “success rate”.
- [ ] Preserve unavailable vs empty semantics.
- [ ] If Trade Intelligence is extended, add a narrowly named measured container-operations section rather than duplicating dormant Trade Graph opportunity logic.
- [ ] Do not enable `DIASPORA_TRADE_GRAPH` solely for the demo.

## D9 — Vehicle/import-order linkage

- [ ] If cargo type is vehicle and a CarUp import order/vehicle identity exists, support safe linkage rather than copying vehicle data into reservation metadata.
- [ ] Confirm linked reservation appears in the Order Passport where existing aggregation supports it.
- [ ] Do not infer customs clearance, local registration or Vehicle Trust from booking alone.
- [ ] Preserve later path to Zimbabwe Ready and ownership handoff.

## D10 — Demo data and staging UAT

- [ ] Use staging only.
- [ ] Create unmistakably synthetic but realistic demo identities/data; do not use production or real customer secrets.
- [ ] Demonstration dataset should include at least:
  - one logistics business/operator;
  - one Japan -> Zimbabwe 40ft/40HC October container;
  - one December container if practical;
  - at least two participants;
  - one vehicle reservation;
  - one non-vehicle eligible cargo reservation;
  - one approved reservation;
  - one pending or rejected reservation;
  - capacity visibly below 100% so remaining-space behaviour is visible.
- [ ] Execute browser UAT through Chromium/Playwright on desktop and mobile for the core flow.
- [ ] No mocks for the final staging certification path.
- [ ] Record exact staging URL, frontend/backend SHA pairing, test result, console/page/API errors and known limitations.
- [ ] Production remains untouched.

---

# 7. P1 convergence after the first usable return

These are important, but must not prevent the first demonstrable P0 slice unless they are required by a dependency uncovered during implementation.

- [ ] C1. Canonical user-registration-profile -> diaspora trade-profile convergence; eliminate duplicate identity authority.
- [ ] C2. Full logistics organisation/staff permission model: owner/admin/operations staff with least privilege.
- [ ] C3. Canonical domain-event emission for container lifecycle and replayable Trade Graph projection.
- [ ] C4. Full Communications 2.0 container conversation lifecycle and provider-channel routing.
- [ ] C5. Container/shipment document workspace using governed Evidence/Drive authority.
- [ ] C6. Warehouse intake / cargo measurement / loading readiness workflow.
- [ ] C7. Loading plan and per-reservation loading status.
- [ ] C8. Container -> shipment transition and unified timeline.
- [ ] C9. Per-customer charges, freight allocation and transparent pricing engine.
- [ ] C10. Payment request/milestone integration without pretending CarUp settles money before a real provider is activated.
- [ ] C11. Customs/compliance document checkpoints.
- [ ] C12. Delivery/collection handoff.
- [ ] C13. Trade/logistics reputation model distinct from Vehicle Trust.
- [ ] C14. Public/qualified container discovery policy and anti-bypass contact policy.
- [ ] C15. Subscription/entitlement commercial activation.
- [ ] C16. Operational dashboard for organiser: capacity, deadlines, pending reviews, missing docs and exceptions.
- [ ] C17. Customer-facing shipment tracking view.
- [ ] C18. Trade Intelligence projections from real container/shipment outcomes.

---

# 8. Data ownership contract

Do not duplicate authoritative data merely for convenience.

| Concept | Authority |
|---|---|
| Core authenticated person | `users` |
| Signup/commercial context | `user_registration_profiles` |
| Business/operator boundary | canonical organisation/tenant + membership |
| Legacy Trade OS profile extension | `diaspora_trade_profiles` until convergence task C1 closes |
| Vehicle identity | canonical `vehicles` / VIN/chassis + Vehicle Passport |
| Seller/listing commercial presentation | Seller/Marketplace listing domain |
| Cross-border buyer/order | `diaspora_import_orders` |
| Container | `diaspora_container_shipments` |
| Cargo booking | `diaspora_cargo_reservations` |
| Shipment | `diaspora_shipments` |
| Shipment timeline | `diaspora_shipment_stage_events` |
| Trade documents | governed trade/evidence records; Drive only stores file objects |
| Human conversation | canonical Communications conversation |
| One-way activity state | Notifications/event outbox |
| Audit | governed audit trail |
| Vehicle Trust | canonical Trust/evidence authority |
| Trade/logistics reputation | separate derived business-performance authority |
| Intelligence | read-only projections over authoritative facts/events |
| Trade Graph | rebuildable derived graph, never source of truth |

---

# 9. User operating manual — first demonstrable version

## 9.1 Organiser

1. Register/sign in to CarUp as a business user.
2. Complete/receive governed business activation for the logistics organisation.
3. Open **Trade OS -> Container Co-Loading**.
4. Select **Create container**.
5. Enter Japan origin, Zimbabwe destination, planned departure, booking deadline, type and capacity.
6. Publish/open the booking.
7. Share the CarUp booking entry with qualified participants.
8. Open the container to review requested cargo.
9. Check cargo details and estimated volume/weight.
10. Approve or reject requests.
11. Use capacity display to understand used and remaining space.
12. Coordinate participant questions through the CarUp communication context.
13. Close booking when the organiser is ready to stop taking new requests.
14. Continue the operational journey into shipment/document milestones as those P1 surfaces are activated.

## 9.2 Participant

1. Register/sign in to CarUp.
2. Open **Trade OS -> Container Co-Loading**.
3. Select an available Japan -> Zimbabwe container.
4. Review route/date/deadline/capacity and organiser instructions.
5. Select **Request cargo space**.
6. Describe the vehicle/goods accurately.
7. Enter estimated CBM and other available cargo facts.
8. Submit.
9. Track status as REQUESTED/APPROVED/REJECTED/CANCELLED.
10. Use the linked CarUp communication/order context for follow-up rather than relying on untracked DMs.

## 9.3 CarUp owner/admin

The owner/admin supervises platform integrity and can provide support/review authority, but the client must not require owner/admin impersonation for normal logistics operations.

---

# 10. Security invariants

The demo is not permission to weaken the system.

Must remain true:

- user ID and tenant identity are server-derived;
- public/business labels cannot self-grant platform privileges;
- tenant A cannot create/update/approve/close tenant B container records;
- participant sees only reservations they are allowed to see;
- operator authority is scoped to the operator's own tenant/business;
- reviewer/admin oversight remains separately privileged;
- reservation approval stays atomic;
- no approved capacity may exceed volume/weight capacity;
- sensitive documents remain private;
- audit-critical transitions fail safely;
- no payment, compliance, customs, shipment or delivery status is implied by a booking state;
- no data fetch failure renders a false “none exist” state.

Mandatory adversarial tests for every permission change:

1. anonymous request denied;
2. ordinary participant cannot create/manage another organisation's container;
3. cross-tenant operator denied;
4. participant cannot approve their own reservation unless separately and legitimately authorized as operator for that tenant;
5. spoofed role/tenant headers do not grant access;
6. overfill race still fails safely.

---

# 11. UI/UX expectations for the client demo

The client should see an operational product, not a developer test harness.

Required qualities:

- clear Trade OS/container naming;
- normal CarUp navigation;
- obvious organiser vs participant actions;
- date/route/capacity visible at a glance;
- readable mobile layout;
- structured forms rather than JSON/raw IDs where avoidable;
- human-readable statuses;
- real empty/error/loading states;
- no buttons that only simulate success;
- no fabricated KPIs;
- no developer-only labels in primary UI;
- no need to know hidden URLs;
- no reliance on direct Supabase edits during client demonstration.

---

# 12. Testing and certification gate

## Required automated checks for first return

At minimum:

- targeted backend container marketplace suite;
- atomic approval/concurrency test;
- logistics auth/tenant isolation tests affected by permission changes;
- registration-profile tests if business vocabulary changes;
- affected Communications tests if integration changes;
- affected Intelligence tests if projection changes;
- web unit/typecheck for changed surfaces;
- Playwright container marketplace journey;
- route/navigation validation;
- build.

## Required staging browser proof

Demonstrate:

```text
operator login
 -> Trade OS navigation
 -> create container
 -> participant login
 -> discover container
 -> request vehicle/non-vehicle space
 -> operator sees request
 -> approve
 -> capacity changes
 -> participant sees approved state
 -> activity/communication state visible
```

Also test reject/cancel and cross-tenant denial.

Final staging report must state:

- exact candidate SHA;
- exact frontend/backend deployment URLs;
- paired/unpaired state;
- database environment;
- migrations applied;
- desktop/mobile browser result;
- number passed/failed/skipped/flaky;
- unexpected console errors;
- page errors;
- 5xx/unexplained 4xx;
- known demo limitations;
- production untouched.

---

# 13. Definition of first-return success

Claude's first return is **usable for demonstration** only if all of the following are true:

- [ ] a legitimate non-platform-admin business operator can create/manage its own container;
- [ ] container creation is available through UI;
- [ ] participant can navigate to the container without hidden URL knowledge;
- [ ] rich cargo reservation form captures more than CBM;
- [ ] vehicle and non-vehicle eligible cargo are both representable;
- [ ] operator can approve/reject;
- [ ] participant can cancel where allowed;
- [ ] capacity updates truthfully from approved reservations;
- [ ] overfill is still atomically impossible;
- [ ] statuses are clear;
- [ ] relevant activity/communication is stitched to modern CarUp semantics at least at the browser/app level;
- [ ] no fake Trust/payment/shipment/compliance claims were introduced;
- [ ] final flow works against real staging data in Chromium;
- [ ] owner receives a staging URL plus demo identities/instructions through the secure existing UAT mechanism (never commit passwords);
- [ ] regression tests are green for affected domains;
- [ ] this plan has been updated with evidence.

If any checkbox is false, return the specific blocker and continue the bounded implementation loop rather than declaring the demo ready.

---

# 14. Explicit non-goals for the first return

Do not lose today attempting to complete these unless they are required to unblock P0:

- real-money settlement;
- live SafeTrade provider activation;
- full freight pricing optimization;
- public shipping marketplace SEO;
- end-to-end customs integration;
- shipping-line API integration;
- full warehouse WMS;
- full Trade Graph activation/backfill;
- universal logistics reputation scoring;
- production deployment;
- rewriting the existing container engine;
- rebuilding Communications inside Trade OS;
- replacing Vehicle Passport/Trust with Trade OS-specific equivalents.

---

# 15. First implementation sequence

Execute in this order unless repository evidence proves a dependency requires a small reordering:

1. **Baseline + tests** — understand current post-#194 reality.
2. **Identity/permission seam** — make legitimate logistics tenant operator possible without platform-admin abuse.
3. **Navigation** — make Trade OS discoverable.
4. **Create Container UI** — close the largest operator gap.
5. **Rich reservation UI** — expose fields already supported by backend.
6. **Capacity/actions** — preserve hardened kernel and improve operational presentation.
7. **Communications/activity seam** — stitch to current canonical system.
8. **Order/vehicle linkage** — reuse existing import-order/passport path where practical.
9. **Measured intelligence presentation** — real facts only.
10. **Real staging data + browser UAT**.
11. **Update this ledger with evidence**.
12. **Return demo URL/instructions and only the remaining P1 gaps**.

---

# 16. Change-control rule

This file is living durable memory.

Every implementation cycle must append a dated execution entry below.

Template:

```text
## Execution entry YYYY-MM-DD HH:MM JST
Candidate SHA:
Branch:
Tasks moved:
Files changed:
Migrations:
Backend tests:
Web tests:
Playwright:
Staging FE:
Staging BE:
DB:
Known limitations:
Production touched: NO/YES (must be explicitly authorized)
Next unchecked task:
```

No agent should rely on a chat transcript to determine current status when this file can be updated instead.

---

# 17. Current execution entry — 2026-09-04

**Candidate baseline:** `main@bb9d9900c700873ca57df0ac18a1a5c01f77711a`  
**Branch:** `feat/trade-os-client-demo-convergence`  
**State:** planning/reconciliation initiated; implementation not yet certified.  
**Current known container status:** engineering MVP exists and was historically staging-certified; client-ready commercial workflow is incomplete.  
**Immediate owner goal:** same-day real staging demonstration for a Japan -> Zimbabwe shared-container client.  
**Production touched:** NO.

Known P0 gaps at plan creation:

1. operator Create Container API exists but polished UI is missing;
2. reservation UI captures only CBM despite richer backend schema;
3. current route-level operator authorization is reviewer/admin/government oriented and is not appropriate for a private logistics client;
4. new registration profile lacks explicit logistics/freight business type;
5. Communications architecture supports `container_booking`, but direct lifecycle wiring must be verified/stitched against the current post-#194 runtime;
6. Trade Graph vocabulary is designed for container events but graph activation must not be required for the demo;
7. Trade Intelligence must remain truth-based and currently has historical evidence of zero real container/shipment rows;
8. Vehicle/import linkage exists through Trade OS/Order Passport/ownership handoff but must not be confused with Vehicle Trust;
9. freight-cost allocation, warehouse/loading console, full per-customer charges/docs and live payments remain later commercial work.

**Next task:** D0 baseline + repository reconciliation, then D2/D1/D3 in the implementation branch.

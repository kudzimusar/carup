# Claude Code Directive — CarUp Trade OS Client Demo Convergence

**Date:** 2026-09-04  
**Repository:** `kudzimusar/carup`  
**Branch:** `feat/trade-os-client-demo-convergence`  
**Required baseline:** `main@bb9d9900c700873ca57df0ac18a1a5c01f77711a` or a newer explicitly reconciled `main` SHA  
**Canonical implementation plan:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md`

---

## Mission

Take the existing CarUp Diaspora Trade OS / Container Co-Loading implementation and make the **basic real workflow demonstrably usable on staging today** for a prospective Japan -> Zimbabwe shared-container client.

This is **not a rewrite** and not a greenfield feature. Most of the engine already exists. Your job is to stitch the existing Trade OS implementation into the CarUp architecture that has changed during the last few weeks, close the specific usability/permission/navigation gaps that prevent a client demonstration, run regression tests, deploy the candidate to staging, and prove the flow in a real Chromium browser with real staging records.

The first return should tell us whether the candidate is genuinely usable for a client demo. Do not declare it ready merely because unit tests pass.

---

# 1. Before changing code

Read in this order:

1. `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` — **governing plan and task ledger**.
2. `docs/CARUP_DIASPORA_TRADE_OS_SYSTEM_PLAN.md`
3. `docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md`
4. `docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`
5. `docs/DIASPORA_PHASES_3_TO_7_HARDENING_REPORT.md`
6. `docs/DIASPORA_TRADE_OS_MVP_ACCEPTANCE_MATRIX.md`
7. `docs/DIASPORA_TRADE_OS_DEPLOYED_BROWSER_UAT_REPORT.md`
8. `docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md`
9. `docs/intelligence/receipts/I13_DIASPORA_TRADE_INTELLIGENCE.md`
10. `docs/DIASPORA_PHASE10_TRADE_GRAPH_DESIGN.md`
11. `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`
12. `docs/seller/ZIMBABWE_SELLER_REALITY_COMMUNICATIONS_HARDENING_PLAN.md`

Then inspect the actual current code before editing:

- `backend/services/diaspora/diasporaContainerMarketplaceService.js`
- `backend/routes/diasporaContainerMarketplaceRoutes.js`
- `database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql`
- `backend/tests/diaspora-container-marketplace.test.js`
- `backend/tests/diaspora-logistics-auth.test.js`
- `web/src/pages/diaspora/DiasporaContainerMarketplace.tsx`
- `web/e2e/diaspora-container-marketplace.spec.ts`
- `web/src/hooks/useCarUpApi.ts`
- `web/src/types/index.ts`
- `web/src/App.tsx`
- `web/src/config/featureRegistry.ts`
- `shared/navigation/feature-manifest.json`
- `backend/services/auth/registrationProfileService.js`
- `database/migrations/20260829123000_user_registration_profiles.sql`
- current Communications services/routes/models after PR #194
- current Intelligence projection route/service after PR #194
- current tenant/organisation membership and authorization helpers

Do not assume the July implementation or July documents still describe the current runtime exactly. The September code is authoritative.

Before editing, run and record the targeted baseline tests required by D0 in the master plan. Update D0 in the plan with exact results.

---

# 2. Non-negotiable architecture

Do not create a parallel Trade OS identity, chat, Trust, Intelligence or document system.

Preserve:

```text
user
 -> registration profile
 -> organisation/tenant membership where applicable
 -> import order / cargo intent
 -> cargo reservation
 -> container
 -> shipment
 -> documents / milestones / compliance
 -> Zimbabwe readiness
 -> Vehicle Passport / ownership handoff when cargo is a vehicle
```

Communications, Notifications, Security, Audit and Intelligence surround those same records.

Canonical ownership:

- core person = `users`;
- signup/business context = `user_registration_profiles`;
- business authority = governed organisation/tenant membership;
- container = `diaspora_container_shipments`;
- reservation = `diaspora_cargo_reservations`;
- shipment = `diaspora_shipments` + stage events;
- order = `diaspora_import_orders`;
- human messaging = canonical Communications conversation;
- one-way activity = Notifications/event system;
- Vehicle Trust = canonical Trust/evidence authority;
- logistics/trade reputation = separate future derived performance concept;
- Intelligence = read-only projection of authoritative data;
- Trade Graph = rebuildable derived graph and must not become a source of truth.

---

# 3. Immediate client scenario

The client is a Japan-based shared-container organiser planning 40ft Japan -> Zimbabwe shipments, initially October and December. They want multiple Zimbabwe-bound participants to share container capacity.

Cargo is **not restricted to cars**. The system must be capable of representing:

- vehicles;
- vehicle parts;
- household/personal effects;
- general eligible cargo;
- other eligible cargo that the organiser/shipping rules permit.

Do not present CarUp as the shipping line, customs authority, insurer or money custodian.

For the demonstration, CarUp is the neutral digital coordination, record, communication and trust/evidence layer.

---

# 4. P0 — work this list in order

Use §6 of the master plan as the authoritative checklist. Mark items as you complete them with evidence. Do not create a second TODO document.

## P0.1 Baseline and branch integrity — D0

- Confirm this branch is based on the current merged `main` convergence baseline.
- If `main` has moved, reconcile deliberately before implementation and record the new SHA in the plan.
- Ensure no unrelated local work is overwritten.
- Run targeted pre-change tests.

## P0.2 Legitimate logistics operator — D2

The current container runtime still reflects old reviewer/admin/government assumptions. A private logistics business must not need a platform-admin identity.

Implement the minimum coherent September model:

1. Add an explicit non-authorizing business identity for a logistics/freight business in the registration profile vocabulary. Use a clear canonical value such as `logistics_provider` unless the current repo already has a better canonical vocabulary after inspection.
2. If `user_registration_profiles.business_type` has a DB CHECK, add an **additive migration** to extend it. Do not edit an already-applied migration in place.
3. Do **not** add `logistics_provider` as a global `users.role` merely to pass auth.
4. Operational authority must come from existing organisation/tenant membership and scoped role/permission semantics.
5. Inspect `authorizeRole()` route gates and service-layer tenant checks. Widen route access only enough for a legitimate tenant operator to reach the service; keep the service/RPC authoritative.
6. Preserve platform reviewer/admin oversight.
7. Add cross-tenant and privilege-escalation tests.
8. Prove spoofed role/tenant headers cannot create, approve, reject or close another organisation's container.

If the current organisation onboarding does not yet automatically activate a new business account, do not invent a dangerous shortcut. Reuse the existing governed staging bootstrap/admin activation path and document the remaining onboarding step as P1. The demo account must still operate with real tenant-scoped permissions rather than global admin impersonation.

## P0.3 Trade OS navigation — D1

The client must not need a hidden route.

- Keep `/diaspora/containers`.
- Make Container Co-Loading discoverable from the normal current CarUp dashboard/Trade OS navigation for the correct actors.
- Keep `featureRegistry.ts` and `shared/navigation/feature-manifest.json` aligned.
- Add clear navigation between relevant Trade OS surfaces where it improves the demo: import orders, container co-loading, Order Passport/documents and Trade Intelligence.
- Do not expose reviewer/admin consoles to ordinary participants.
- Preserve current global navigation/design conventions from the post-#194 app.

## P0.4 Create Container UI — D3

The backend already has `POST /api/diaspora/container-marketplace/containers`. Do not create another endpoint unless current code evidence proves this one is unsuitable.

Add a production-quality operator form to `DiasporaContainerMarketplace.tsx` or a small reusable component used by that page.

Minimum fields:

- origin country;
- origin city;
- destination country;
- destination city;
- planned departure date;
- booking deadline;
- container type (40HC/40ft appropriate existing vocabulary; do not invent unsupported DB values blindly);
- total volume CBM;
- optional total weight capacity;
- participant-safe notes/eligibility guidance if the existing schema/metadata is appropriate.

Requirements:

- show the form only to a legitimately authorized operator;
- client-side usability validation plus server validation;
- clear errors;
- no seeded/fabricated fallback values;
- after successful creation, refresh and select the new container;
- mobile usable.

## P0.5 Rich cargo request UI — D4

The current UI only sends `estimated_volume`, while the backend already supports richer reservation fields. Expose that existing capability coherently.

Minimum fields:

- cargo category;
- cargo description;
- estimated volume CBM — required;
- estimated weight — optional;
- declared value — optional;
- currency — optional/current supported vocabulary;
- optional import order / vehicle linkage where the logged-in participant owns/has access to a valid order.

Use a closed, understandable category vocabulary. It must represent at least vehicle, vehicle parts, household/personal effects, general eligible cargo and other eligible cargo.

Never claim that selecting a category means CarUp has certified shipping-line acceptance, dangerous-goods compliance or customs classification.

If order linking is exposed through a selector, fetch only participant-authorized records and send their canonical ID. Never allow arbitrary cross-user order IDs.

## P0.6 Reservation operations and capacity — D5/D6

Do not weaken the hardened kernel.

- `diaspora_approve_cargo_reservation_atomic` remains the only approval path.
- APPROVED reservations consume capacity; REQUESTED do not.
- Preserve weight overfill protection.
- Preserve concurrency safety.
- Show approved/pending counts and used/available capacity clearly.
- Show participant cargo summary to the authorized operator.
- Participant can cancel their own eligible request.
- Reviewer/operator can approve/reject only with legitimate authority.
- A failed reservation read must remain “unavailable”, not “no reservations”.
- Keep closing booking distinct from departure/delivery/customs/payment.

The existing 90% “Ready to close” and 98% “Full” values are currently indicators. Do not silently convert 90% into a hard close requirement. If you believe a rule change is needed, preserve current behaviour for today's demo, record the proposal in the plan, and add it to P1 unless the owner has explicitly approved the business rule.

## P0.7 Communications/activity stitch — D7

Inspect the actual post-#194 Communications implementation before coding.

Target semantics:

```text
reservation state mutation
 -> authoritative Trade OS row + audit
 -> activity notification/event
 -> canonical container_booking conversation only where human coordination is needed
```

Do not create a `diaspora_container_messages` table or separate Trade OS chat.

Use the canonical subject types already designed (`container_booking`, and `diaspora_order` where order context is appropriate).

At minimum for the first return:

- reservation requested -> participant/operator-facing activity state;
- approved -> participant-facing activity state;
- rejected -> participant-facing activity state;
- cancelled -> relevant activity state;
- booking closed -> relevant participant activity state;
- browser user has a clear path to communication if the canonical conversation integration is safely available.

Do not block the entire first demo on external WhatsApp/Telegram delivery. Browser/web Communications can satisfy P0 if it is real and canonical. Provider delivery can remain a later channel proof.

## P0.8 Intelligence coherence — D8

Do not regress the I13 Truth & Trust work.

The demo may show only measured operational facts from real authoritative records:

- number/status of reservations;
- approved vs pending;
- used/available capacity;
- actual departure/deadline data;
- real container count if queried.

Do not invent:

- freight revenue;
- settled trade value;
- route market share;
- “success rate”;
- customer reputation;
- logistics Trust score;
- shipment demand when no shipment rows exist.

Do not enable Trade Graph solely for the demo. If you extend `tradeIntelligenceService.js`, keep the addition narrow and measured and update its tests. Do not duplicate `containerOpportunities` from the dormant graph service.

## P0.9 Vehicle/import order coherence — D9

If a reservation is linked to a vehicle import order:

- use the canonical order ID;
- do not duplicate make/model/VIN as authoritative booking data when those facts already have an owner;
- confirm the existing Order Passport aggregate shows the reservation where supported;
- preserve later Zimbabwe Ready / vehicle identity / ownership handoff flow;
- booking alone must not change Vehicle Trust, customs state or local registration state.

## P0.10 Real staging demo dataset and browser certification — D10

Final proof must be against staging, not mocked Playwright routes.

Create safe synthetic demo records using the existing staging UAT provisioning mechanisms. Do not commit passwords or real client/customer secrets.

Minimum dataset:

- one legitimate logistics business/operator tenant;
- one October Japan -> Zimbabwe 40ft/40HC container;
- one December container if practical after the first is stable;
- at least two participant accounts;
- one vehicle reservation;
- one non-vehicle eligible-cargo reservation;
- at least one approved reservation;
- one pending/rejected/cancelled state visible;
- remaining capacity visible.

Run Chromium/Playwright on desktop and mobile against the actual deployed frontend/backend pair.

Required real-browser journey:

```text
operator login
 -> navigate to Trade OS
 -> open Container Co-Loading
 -> create container
 -> participant login
 -> discover container
 -> request vehicle/non-vehicle space
 -> operator login
 -> see request
 -> approve
 -> capacity changes
 -> participant sees approved state
 -> activity/communication state visible
```

Also prove:

- reject/cancel;
- anonymous denial;
- cross-tenant denial;
- overfill denial;
- no unexpected console errors;
- no page errors;
- no unexplained API 5xx/4xx.

---

# 5. Files likely to change

This is guidance, not permission to blindly edit all of them. Inspect before changing.

Likely P0 files:

### Backend

- `backend/services/diaspora/diasporaContainerMarketplaceService.js`
- `backend/routes/diasporaContainerMarketplaceRoutes.js`
- `backend/services/auth/registrationProfileService.js`
- the current registration/auth route/UI service that consumes the vocabulary
- current tenant/organisation authorization helpers, only if a scoped permission seam is actually missing
- current Communications event/listener/service files, only through their canonical public service interfaces
- `backend/services/intelligence/tradeIntelligenceService.js`, only if D8 requires a measured projection
- `backend/tests/diaspora-container-marketplace.test.js`
- `backend/tests/diaspora-logistics-auth.test.js`
- registration/communications/intelligence tests directly affected

### Database

- new additive migration for the business-type CHECK if `logistics_provider` is added;
- do not edit applied migration `20260829123000_user_registration_profiles.sql` in place;
- do not replace or bypass the existing atomic container approval migration/RPC.

### Web

- `web/src/pages/diaspora/DiasporaContainerMarketplace.tsx`
- optional small components under the existing diaspora component/page structure if the page becomes unwieldy
- `web/src/hooks/useCarUpApi.ts`
- `web/src/types/index.ts`
- current signup/business onboarding UI vocabulary source
- `web/src/config/featureRegistry.ts`
- `shared/navigation/feature-manifest.json`
- current dashboard/navigation components as required
- current Communications link/component only if needed for the canonical container conversation
- existing Order Passport only if safe linkage display is genuinely missing
- `web/e2e/diaspora-container-marketplace.spec.ts`
- staging UAT spec(s) following the repository's current post-#194 golden/staging test architecture

### Documentation

- **always update** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` as tasks move;
- update/create a staging UAT receipt if the repository's current convention uses one;
- do not create competing master plans.

---

# 6. Constraints

1. **Production untouched.** No production migrations, aliases, credentials, data or deployments.
2. Do not merge to `main`; leave the candidate on the feature branch / PR for owner review unless explicitly instructed otherwise.
3. Do not weaken auth, RLS, tenant isolation, atomicity, audit or privacy for speed.
4. Do not replace real failures with mock success.
5. Do not hardcode demo KPIs or shipment states.
6. Do not make the client a platform admin as the final functional solution.
7. Do not introduce a second container table/service when the current authoritative kernel can be extended.
8. Do not activate real-money payment or SafeTrade functionality.
9. Do not activate Trade Graph merely for appearance.
10. Do not conflate logistics reputation with Vehicle Trust.
11. Do not conflate “booking closed” with departed/shipped/delivered/customs cleared/paid.
12. Do not expose another participant's private reservation/document data.
13. Do not report an unreadable query as an empty result.
14. Do not pause after every small task. Work through the P0 ledger in one bounded implementation cycle, committing coherent milestones and updating the master plan.
15. If one non-essential P1 item is blocked, record it and continue the P0 slice rather than expanding scope.

---

# 7. Testing expectations

Run the repo's real commands after inspecting package scripts. At minimum, prove the directly affected areas and their integration regressions.

Expected categories:

- container marketplace backend suite;
- atomic RPC/concurrency proof;
- diaspora logistics auth/tenant isolation;
- registration profile validation/migration checks;
- Communications tests if lifecycle wiring changes;
- Trade Intelligence tests if projection changes;
- web unit tests for changed components;
- TypeScript;
- route/navigation validation;
- build;
- existing diaspora container Playwright;
- unmocked deployed staging Chromium desktop + mobile.

Do not reduce assertions or delete security tests just to get green.

---

# 8. First-return report format

Do not return a long narrative first. Return this exact decision structure, then supporting detail.

```text
TRADE OS CLIENT DEMO — FIRST RETURN

Verdict: DEMO-USABLE / NOT YET DEMO-USABLE
Candidate SHA:
Branch:
Frontend staging URL:
Backend staging URL:
Paired SHA/provenance:
Production touched: NO

P0 roll-call:
D0 Baseline: PASS/PARTIAL/FAIL
D1 Navigation: PASS/PARTIAL/FAIL
D2 Logistics operator identity/authority: PASS/PARTIAL/FAIL
D3 Create Container UI: PASS/PARTIAL/FAIL
D4 Rich cargo request: PASS/PARTIAL/FAIL
D5 Reservation/capacity: PASS/PARTIAL/FAIL
D6 Close semantics: PASS/PARTIAL/FAIL
D7 Communications/activity: PASS/PARTIAL/FAIL
D8 Intelligence coherence: PASS/PARTIAL/FAIL
D9 Order/vehicle linkage: PASS/PARTIAL/FAIL
D10 Real staging UAT: PASS/PARTIAL/FAIL

Demo path proven:
<exact click flow>

Real demo data:
<safe record descriptions/IDs only; no passwords>

Tests:
<commands + pass/fail counts>

Known limitations that the client may notice:
<only real remaining limitations>

Regression/security findings:
<none or exact findings>

Master plan updated: YES/NO
Next unchecked P0 task:
```

If verdict is `NOT YET DEMO-USABLE`, continue fixing P0 blockers in the same branch unless a true external boundary prevents progress. Do not call a candidate ready because only mocked E2E passes.

---

# 9. Success condition

The owner should be able to open one staging URL later today and demonstrate, with real staging data:

> “Here is our shared Japan-to-Zimbabwe container. Here is how I create it as the organiser. Here is how a customer books a car or other eligible cargo. Here is the request. Here is the approval. Here is the capacity changing. Here is the participant's status and the CarUp communication/activity record. The system is already functioning at this basic level; we are now refining pricing, loading, documents and deeper shipment operations around the client's real workflow.”

That is the target. Build toward that statement without overstating anything CarUp cannot yet prove.

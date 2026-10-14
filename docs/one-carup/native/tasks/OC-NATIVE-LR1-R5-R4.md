# OC-NATIVE-LR1-R5-R4 — MOBILE DISCOVERY + PRIMARY JOURNEY NAVIGATION CONVERGENCE

FROM: OC-NATIVE MODERATOR
TO: OC-NATIVE PRODUCT SPECIALIST
TASK: OC-NATIVE-LR1-R5-R4
PROGRAMME: One CarUp Native

Repository: kudzimusar/carup
PR: #223
Branch: feat/oc-native01-product-foundation

## Exact authority

Current branch/documentation authority:
86179a651f2e918b49f0f06fbb72017fc0a5b94e

Frozen certified R5-R3 product/evidence authority:
435221436b3d2f1a93c1309a9017af3963c3e485

Frozen underlying R5 visual product authority:
f7e735eb492704068f28eb912bd83bf0567771e2

Read and obey:
- docs/one-carup/native/OC_NATIVE_LR1_R5_VISUAL_SYSTEM.md — OWNER IA AMENDMENT — 13 OCTOBER 2026
- docs/navigation-intelligence/NATIVE_NAVIGATION_BOUNDARY.md — Supersession note — 13 October 2026
- root DESIGN.md

## MODERATOR DISPOSITION

AUTHORIZED — BOUNDED NATIVE PRODUCT ADJUSTMENT

R5 NAVY/ORANGE VISUAL LANGUAGE: APPROVED IN PRINCIPLE / PRESERVE
MOBILE DISCOVERY: REMEDIATE
PRIMARY NATIVE NAVIGATION: REMEDIATE
BACKEND: FROZEN UNLESS A SPECIFIC PROVEN API GAP REQUIRES MODERATOR ESCALATION
DATABASE: FORBIDDEN
PRODUCTION: FORBIDDEN
MERGE: FORBIDDEN
WHATSAPP / TELEGRAM: OUT OF SCOPE

---

# 1. OWNER REQUIREMENT — NON-NEGOTIABLE

The current permanent bottom shell:
Home | Market | Verify | Sell | Account

is SUPERSEDED.

The required permanent consumer shell is:
**Home | Buy | Verify | Sell | Trade**

This is a product-information-architecture decision, not optional copy polish.

The implementation MUST NOT return for review with:
- Market still shown as the permanent buyer tab;
- Account still shown as the permanent bottom-right tab;
- Trade hidden inside Account;
- Profile added as a sixth bottom tab;
- a fake Trade placeholder that is merely the old Account screen renamed.

Any of those outcomes is non-conformant.

# 2. MARKET → BUY — MANDATORY

The current customer-facing tab label Market MUST become Buy.
The existing Marketplace route/component may remain technically named marketplace if that avoids unnecessary route churn.

BUY means:
Marketplace discovery → search → filters → shortlist/saved cars → results → vehicle detail → inquiry / buyer journey.

Required:
- bottom tab says Buy;
- accessibility label expresses Buy/Marketplace intent;
- active state remains correct;
- deep links into Marketplace continue to work;
- existing Marketplace authorization/truth contracts remain unchanged.

Do not rename backend Marketplace APIs merely for this navigation change.

# 3. ACCOUNT → TRADE — MANDATORY

The current permanent bottom Account destination MUST be replaced by Trade.

Trade is a first-class CarUp pillar.

Trade MUST connect users to real governed Trade OS / Diaspora Trade capabilities.

The repository already contains governed Diaspora Trade authorities including import orders, trade profiles, trade documents, container shipments, cargo reservations, shipments/timelines, compliance/governance paths, and Trade Graph / SafeTrade where existing flags and authority permit.

No native Trade screen exists at the starting product authority. Therefore R5-R4 is authorized to create the bounded native Trade gateway/surface needed for this tab.

Minimum acceptable Trade destination:
- clearly identifies Trade / Diaspora Trade;
- uses the accepted R5 navy/orange visual language;
- is not the Account screen with a new label;
- provides user-facing entry/guidance to real trade capabilities actually available to that signed-in user;
- respects existing auth, role/tenant, feature-governance and backend authority;
- shows truthful unavailable/planned states when capability is not enabled or not natively implemented;
- never fabricates an import order, shipment, container, quote, payment, milestone or trade metric.

Investigate and expose a sensible native entry structure around real available capabilities such as:
- My Import Orders / Start Import;
- Trade Profile;
- Containers / Container Space where governed and applicable;
- Shipments;
- Trade Documents;
- Trade/Diaspora guidance.

Do NOT rebuild the entire Trade OS inside R5-R4.

If the existing authenticated Trade APIs cannot be safely consumed within bounded native scope, STOP and report the exact gap rather than substituting fake cards.

# 4. ACCOUNT / PROFILE MOVES TO THE HEADER — MANDATORY

Account remains a real capability but is no longer a permanent bottom journey.

A persistent Profile affordance MUST appear in the shared native top-right header.

Profile must open the existing Account/personal capability.

The existing internal account route may remain.

Profile is the entry for current governed personal/account functions, including identity/account information, memberships/context, My Garage/account utilities, preferences where real, professional workspace links where authorized, and Sign Out.

Do not duplicate Account data into a shadow profile store.
Do not create fake Settings pages.

# 5. NOTIFICATIONS + PROFILE HEADER — MANDATORY

The shared header must contain two distinct balanced controls:
**Notifications | Profile**

Requirements:
- Notifications uses a recognizable bell/notification icon.
- Profile uses a recognizable person/avatar/profile icon.
- Both have practical minimum touch targets.
- Both have accessibility labels.
- Both respect safe area and Dynamic Type.
- Their visual weight is balanced.
- Neither obscures the CarUp lockup or hero.
- unread badge/count appears only from real governed unread/notification state.

Do not use a decorative fake notification count.

# 6. DO NOT ORPHAN CARUP INBOX / COMMUNICATIONS

The current Home screenshot contains a message/chat affordance in the upper-right.

You MUST identify exactly what it currently opens before changing it.

CarUp Inbox remains canonical conversation authority.

The navigation change MUST preserve discoverable access to Inbox/conversations through real paths.

Acceptable paths may include:
- communication-related Notifications;
- Vehicle Detail → Message seller;
- conversation deep links;
- Profile/Account → Messages/Inbox;
- an explicit contextual Inbox entry.

If the current chat icon is the only viable route to a required Inbox flow and no safe replacement exists in scope: STOP and report the dependency.

Do not silently remove Inbox.

# 7. MOBILE MARKETPLACE DISCOVERY — MANDATORY

The owner approves the current premium Home visual language but rejects the mobile discoverability gap.

Current native discovery exposes primarily keyword search and a few make chips.

The canonical Marketplace backend already supports make, model, year, colour, body style, location, fuel, transmission, minimum price, maximum price, condition/category, trust/verification tags and sorting.

Governed trust tags include at least:
- passport_verified
- partsentry_checked
- dealer_verified

The mobile Buy journey MUST expose these capabilities truthfully.

# 8. HOME DISCOVERY ENTRY

Preserve the current R5 Home hero.
Do NOT turn Home into a desktop-style filter form.

Near the existing search/discovery entry, make All filters clearly visible and understandable.

Use progressive disclosure:
Search → All filters → filter sheet → results

# 9. FILTER PANEL / SHEET

Implement a phone-appropriate native filter sheet/panel.

Required groups:
- Make
- Model
- Year
- Colour
- Body style
- Location
- Fuel
- Transmission
- Minimum price
- Maximum price
- Condition
- Trust / verification tags

Sorting must remain reachable.

Trust filters must clearly expose Passport Verified, PartSentry Checked and Dealer Verified.

Do not infer trust tags client-side.
Do not show filters the backend cannot honor truthfully.

# 10. RESULTS STATE

After filters are applied, Buy/results MUST retain the selected state.

Required persistent controls:
- Filters / Filters (N)
- Sort
- active removable filter chips
- truthful matching-result count

Required behavior:
- applying filters calls the canonical Marketplace API;
- do not filter only the first downloaded page;
- selected filters survive navigation into results and refinement;
- removing a chip updates the canonical query;
- Clear all restores the genuine unfiltered Marketplace population;
- zero real matches show a truthful zero-result state;
- no mock/demo inventory;
- no fake counts.

# 11. PRIMARY SHELL SEMANTICS

Final bottom navigation:
1. Home
2. Buy
3. Verify
4. Sell
5. Trade

These five labels define the primary customer-facing CarUp product pillars.

Do not add More or Account as another permanent bottom item.
Do not replace Verify or Sell with generic labels.
Do not place Trade behind More.
Profile must not become a sixth bottom tab.

# 12. VISUAL CONSTRAINTS

PRESERVE:
- CarUp navy/orange;
- current lockup;
- ONE CARUP · ONE VEHICLE THREAD;
- Buy. Sell. Verify.;
- current typography;
- current hero composition;
- orange primary CTA hierarchy;
- current card language;
- current bottom-bar styling language;
- accepted Verify screen visual treatment.

This task is NOT authorization for a new brand redesign.

The navigation/header/filter additions must look like they were always part of R5.

# 13. LIKELY AUTHORIZED PRODUCT SCOPE

Expected files may include:
- mobile/app/(tabs)/_layout.tsx
- mobile/navigation/nativeShell.ts
- mobile/app/(tabs)/index.tsx
- mobile/app/(tabs)/marketplace.tsx
- mobile/app/market/results.tsx
- mobile/app/(tabs)/account.tsx only as needed to preserve Profile destination
- a new bounded native Trade tab/screen
- bounded shared native header component(s)
- bounded reusable Marketplace filter component(s)
- mobile/utils/marketplaceApi.ts for truthful query plumbing only
- mobile Trade API helper(s) only if consuming existing governed backend contracts
- task-specific native tests
- docs/one-carup/native/** only for task receipt/evidence

Do not touch backend initially.
Do not touch database.

If backend work becomes necessary, STOP and return the exact unsupported capability/contract gap for moderator authorization.

# 14. ROUTE / GOVERNANCE RULES

Preserve:
- Expo Router route integrity;
- current auth gates;
- feature governance;
- tenant/role authority;
- Vehicle Passport/Trust authority;
- Marketplace publication truth;
- Communications conversation authority;
- existing deep links;
- current Account capability.

Do not create client-side authority merely because a tab is visible.
Trade visibility does not bypass Diaspora/Trade auth or feature flags.

# 15. REQUIRED TESTS

Add deterministic tests proving at minimum:
A. permanent native shell labels are exactly Home / Buy / Verify / Sell / Trade.
B. Market is no longer a visible permanent tab label.
C. Account is no longer a visible permanent bottom tab.
D. Profile header control reaches Account/personal capability.
E. Notifications and Profile are both present, accessible and distinct.
F. communications/Inbox remains reachable through at least one certified real route.
G. Trade is not backed by the Account screen.
H. Trade gateway does not fabricate trade records.
I. Buy routes to canonical Marketplace.
J. All filters is visible/discoverable.
K. supported filter selections serialize to canonical Marketplace query parameters.
L. trust tags use canonical backend query values.
M. result state retains filters and count.
N. Clear all resets canonical query.
O. zero-result state remains truthful.
P. R5 Verify and Home visual invariants remain.

# 16. REQUIRED OWNER EVIDENCE — IOS + ANDROID

Capture owner-reviewable phone evidence for both iOS and Android:
1. Home with new bottom shell visible.
2. Header showing Notifications + Profile.
3. Profile opened to Account/personal destination.
4. Buy tab active.
5. All filters discoverable.
6. filter panel open.
7. multiple filters selected.
8. trust filter selected.
9. filtered results with Filters (N) + chips + result count.
10. zero-result state.
11. Trade tab active.
12. Trade landing/gateway showing real governed entry points or truthful unavailable states.
13. Verify still visually conforms.
14. Sell still reachable.
15. Inbox/communications access still demonstrably reachable.

No screenshot may contain a system modal, launcher substitution, crash, ANR or stale prior shell.

The existing R5 fail-closed evidence methodology must remain intact.

# 17. SOURCE / RUNTIME CERTIFICATION

Run:
- mobile Vitest;
- npm run test:native --workspace=mobile;
- npm run test:static --workspace=mobile;
- mobile TypeScript;
- Expo dependency check where relevant;
- git diff --check;
- task-specific navigation/discovery/Trade tests.

Use the existing immutable staging authority unless moderator provides a newer native-certified backend.
External sends remain disabled for native evidence.
No production.

# 18. STOP CONDITIONS

STOP and report if:
- Trade requires a new backend contract rather than existing governed Diaspora authority;
- Trade tab can only be implemented as a fake/static demo;
- moving the current chat/header affordance would orphan Inbox;
- filter parity requires unsupported backend semantics;
- a requested trust filter would need client inference;
- Account/Profile move breaks auth/session control;
- navigation change requires weakening feature governance;
- a backend/database mutation appears necessary;
- frozen R5 visual language would need wholesale redesign;
- branch custody is lost.

Do not solve a stop condition by silently widening scope.

# 19. RETURN RECEIPT

Return:
- exact starting branch head;
- frozen product authority;
- exact final head;
- changed files;
- final shell labels/routes;
- Profile/Notifications implementation;
- Inbox continuity proof;
- Trade gateway design and exact real authorities consumed;
- Marketplace filter query contract;
- tests;
- iOS evidence;
- Android evidence;
- artifacts/digests;
- staging backend pairing;
- zero backend/database mutation proof;
- PR state;
- any stop condition or newly proven defect.

Final line exactly:

OC-NATIVE-LR1-R5-R4 MOBILE DISCOVERY + PRIMARY JOURNEY NAVIGATION CANDIDATE READY FOR MODERATOR REVIEW

Do not self-accept.
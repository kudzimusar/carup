# MODERATOR → T11-CAP-LR01-R3 WORKSPACE + VEHICLE CAPABILITY CONVERGENCE SPECIALIST

## T11-CAP-LR01-R3 — CARUP WORKSPACE NAVIGATION + VEHICLE CAPABILITY BOUNDARY CONVERGENCE

**Repository:** `kudzimusar/carup`

**Programme:** `CarUp CAP 1.0 / Trade OS / Marketplace / Vehicle Workspace Convergence`

**Parent unit:** `T11-CAP-LR01-R2`

**Accepted R2 product authority:**

`6c13fdc4481aec703b0b2189027143a8e3d1fe9d`

**Accepted R2 evidence head:**

`f4b12b608efb7a9285d97bab01f44c17b8cbab0a`

**R2 PR:**

`#243`

R2 PR #243 remains:

- OPEN;
- DRAFT;
- UNMERGED.

**Controlling R3 product/navigation/design authority:**

`docs/trade-os/T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md`

Read the controlling authority document **completely before product mutation**.

Do not work from the title alone.

Do not work from this dispatch alone where the authority document contains greater detail.

If the authority document is:

- absent;
- unreadable;
- materially different from this dispatch;
- committed on an unexplained product lineage;
- contradicted by the live repository;
- or the R2 authority has moved unexpectedly,

**STOP AT CUSTODY.**

Do not improvise a replacement specification.

---

# MODERATOR DISPOSITION

`AUTHORIZED — R3 WORKSPACE NAVIGATION + VEHICLE CAPABILITY CONVERGENCE`

This is a **UI architecture, navigation, information-architecture and bounded visual convergence unit**.

It is **not** authorization to redesign the accepted CAP backend.

It is **not** authorization to restart Trade OS discovery.

It is **not** authorization to create a new role architecture.

It is **not** authorization to redesign the entire CarUp product.

It is **not** authorization to merge PR #243.

---

# 1. OWNER INTENT — CONTROLLING

CarUp must support one person operating in several legitimate business capacities without confusing those capacities in the UI.

Kingston is the real proof case.

Kingston can simultaneously be:

- a **Car owner** in the canonical Vehicle domain;
- a **local Marketplace seller** for one vehicle;
- a **buyer/importer** in a Trade OS transaction;
- potentially a **supplier/exporter** in another Trade OS transaction later.

These roles are not mutually exclusive.

They must not require duplicate vehicles.

They must not require duplicate customer accounts merely because the business context changed.

They must not cause one department to silently take ownership of another department's workflow.

The UI must make these distinctions clear.

---

# 2. CORE PRODUCT MODEL

The governing hierarchy is:

`ACCOUNT → WORKSPACE → VEHICLE → CAPABILITY → TRANSACTION`

The governing domain invariant is:

`VEHICLE != MARKETPLACE LISTING != IMPORT ORDER`

The objects may share:

- VIN/frame;
- ownership;
- photographs/evidence;
- Vehicle Passport;
- customer identity;

but they retain independent business lifecycles.

---

# 3. ACCOUNT ROLE IS NOT TRANSACTION ROLE

Do not redesign the account system merely because one person participates differently in different transactions.

A user's platform role can remain:

`owner`

while that user is:

- Seller for a Marketplace vehicle;
- buyer/importer for a particular import order;
- supplier/exporter in another Trade transaction.

Transaction role must come from the relevant transaction authority.

Trade-profile classification must not silently override transaction role.

Seller functionality must not imply the person is the Seller in every Trade transaction.

---

# 4. VEHICLE IDENTITY IS DURABLE

A vehicle has one canonical identity.

The same Serena or Vezel must not become a separate “Trade vehicle” and “Marketplace vehicle”.

The Vehicle/Passport domain remains the durable bridge.

Capabilities attach to the vehicle.

Capabilities do not redefine the vehicle.

A vehicle may have:

- Marketplace capability only;
- Trade/CAP capability only;
- both;
- neither.

The base Vehicle/Passport presentation must remain coherent across all four cases.

---

# 5. REAL PROOF VEHICLES

Use the actual staging records.

## Serena

Frame/VIN:

`GFC27-027051`

Current known state:

- 2016 Nissan Serena Highway Star;
- owned by Kingston;
- Kingston is current seller;
- Marketplace publication is published;
- real listing media exists;
- no linked import order.

Serena represents:

`OWNED VEHICLE + LOCAL MARKETPLACE SALE`

It must not receive a misleading primary CAP action.

---

## Vezel

Frame/chassis:

`RU3-1316558`

Current known state:

- 2018 Honda Vezel;
- owned by Kingston;
- current Marketplace seller state is independent;
- current Marketplace publication is draft;
- one real linked import order exists;
- real CAP exists;
- real governed vehicle photographs exist.

Vezel represents:

`OWNED VEHICLE + IMPORT JOURNEY`

and potentially:

`OWNED VEHICLE + IMPORT JOURNEY + LOCAL MARKETPLACE SALE`

if the Owner later chooses to list it.

Do not manufacture Seller publication state merely to demonstrate that scenario.

---

# 6. CRITICAL BUSINESS REQUIREMENT

If the Vezel is eventually sold locally through CarUp Marketplace, it must use:

**the same Seller Studio**

**the same Marketplace listing lifecycle**

**the same publication authority**

**the same Seller UI rules**

as the Serena.

Import participation must never create a special Seller product.

CAP remains available separately.

Therefore:

`Vezel import + local sale`

must become:

**same Passport structure**

+ **same Seller rules/UI as Serena**

+ **full CAP remains available**

without one workflow mutating the other.

---

# 7. CAP BELONGS TO TRADE & IMPORTS

CAP is **not Seller UI**.

CAP belongs to:

**Trade OS / Trade & Imports**

The strongest canonical customer path should be:

`Trade & Imports`

→ `Import Orders`

→ `Import Order`

→ `CAP / Journey & Arrival`

The preferred transaction-scoped route is:

`/diaspora/journey/import_order/:orderId`

The vehicle route:

`/diaspora/journey/vehicle/:vin`

may remain as a convenience resolver.

It must not imply that every vehicle has a CAP.

---

# 8. CAPABILITY-DRIVEN NAVIGATION

Do not show CAP merely because a Vehicle Passport exists.

A CAP/Journey control must be driven by a real readable import capability.

Expected behaviour:

### Serena

No import order.

Therefore:

- no prominent `Journey & arrival` action;
- no implication that an import journey is missing or broken;
- normal Vehicle/Marketplace workflow remains dominant.

### Vezel

Real readable import order.

Therefore Passport may show:

**Trade & Import**

`Import journey available`

`View CAP`

This must be clearly distinct from:

**Marketplace**

`Sell this vehicle`

or:

`Continue listing`

or:

`Manage listing`

as factually appropriate.

---

# 9. MULTIPLE IMPORT ORDERS

A vehicle is not itself the transaction.

If exactly one readable import order exists, the vehicle resolver may enter it.

If multiple readable import orders exist:

**NEVER GUESS.**

Present the customer with the available journeys.

Do not choose newest.

Do not choose first.

Do not infer the intended transaction from shipment status.

Preserve the existing fail-closed R2 behaviour.

---

# 10. NO NAVIGATIONAL DEAD ENDS

This is a controlling R3 invariant.

> **No CarUp business page may become a navigational dead end. Every business workflow must visibly identify its workspace, current subject, parent context and legitimate adjacent capabilities.**

A user must never need the browser Back button simply to understand:

- where they are;
- what object they are viewing;
- where they came from;
- how to return;
- what legitimate next actions exist.

---

# 11. EVERY BUSINESS PAGE MUST ANSWER FIVE QUESTIONS

Every R3-touched protected business page must visibly answer:

1. **Where am I?**
   - workspace identity.

2. **What am I working on?**
   - vehicle / listing / import order.

3. **Where did I come from?**
   - parent/breadcrumb/back action.

4. **What can I do next here?**
   - in-workspace actions.

5. **What adjacent capability exists?**
   - explicit cross-workspace link where legitimate.

---

# 12. WORKSPACE MODEL

One authenticated account.

Do not create separate Seller and Importer logins.

Present clear workspace contexts.

The target mental model is:

## My CarUp

### My Vehicles

Canonical ownership / Vehicle Passport / Garage.

### Marketplace / Selling

Seller Studio, Marketplace listing lifecycle, buyer preview, listings.

### Trade & Imports

Import orders, CAP, documents, shipping, customs, messages/delivery.

The exact final navigation wording may be refined only if it improves clarity without changing this model.

---

# 13. WORKSPACE TRANSITION MUST BE VISIBLE

When Kingston moves:

`Vezel Passport → View CAP`

the UI must visibly indicate that he has entered:

**Trade & Imports**

The transition cannot look like another tab on the Seller vehicle page.

Likewise:

`CAP → Vehicle Passport`

must visibly return to the Vehicle workspace.

Changing workspace is not changing account identity.

Do not ask the user to log out or switch accounts.

---

# 14. CAP HEADER / CONTEXT REQUIREMENT

The CAP page must clearly communicate context.

Conceptually it should expose:

`Trade & Imports / Import Orders / Honda Vezel / CAP`

and vehicle/import identity such as:

**2018 Honda Vezel**

`RU3-1316558`

plus appropriate route/origin/destination information where real data exists.

Do not fabricate missing values to fill the header.

---

# 15. CAP EXIT REQUIREMENTS

CAP must provide clear product navigation.

At minimum where authorized/applicable:

**Back to Import Order**

**View Vehicle Passport**

and in-workspace Trade navigation to real capabilities such as:

- Documents;
- Shipping;
- Customs;
- Messages.

A Marketplace/Seller action may be shown as an **adjacent vehicle capability**, but it must not appear as a CAP progress stage.

---

# 16. VEHICLE PASSPORT BECOMES THE CLEAN BRIDGE

The Vehicle Passport should not show an undifferentiated row of unrelated actions.

Create or converge clearly separated capability presentation.

At minimum:

## Marketplace capability

Possible truthful states:

- Published → Manage Listing
- Draft → Continue Listing
- Not listed → Sell This Vehicle
- Seller authority unresolved → Resolve Seller authority

## Trade & Import capability

Possible truthful states:

- Journey available → View CAP
- Multiple journeys → Choose Journey
- No journey → no prominent CAP action
- Read failed/withheld → do not falsely convert it to “No journey”

Do not infer these states from arbitrary strings.

---

# 17. MY GARAGE CONSISTENCY

The Serena and Vezel must use the same base Garage presentation language.

They may display different capability states because their data is different.

They must not appear as if they are two different CarUp products.

The base vehicle card should communicate canonical vehicle identity first.

Then capability state may communicate:

**Marketplace**

and/or:

**Trade & Import**

without replacing the vehicle identity.

---

# 18. SELLER REGRESSION RULE

Import participation must never change the Seller/Marketplace presentation rules of the canonical vehicle.

If Vezel enters Seller Studio:

- use the same `SellVehicle` / Seller Studio architecture;
- use the same Seller listing assertions;
- use the same publication readiness;
- use the same Marketplace media rules;
- use the same buyer-preview behaviour;
- use the same Seller authority model;

as Serena.

Do not build:

`ImportedVehicleSellerStudio`

or any equivalent parallel system.

---

# 19. MEDIA BOUNDARY

Preserve the distinction established in R2.

Governed vehicle photographs may be visible to the authorized owner in:

- Garage;
- Passport;
- CAP;
- Seller Studio as available source material.

But private governed media must not automatically become public Marketplace listing media.

Seller publication remains a governed Seller decision.

Trade/CAP media availability does not mean Marketplace publication.

---

# 20. MARKETPLACE MUST REMAIN INDEPENDENT FROM CAP

Do not allow:

- CAP completion to publish a vehicle;
- shipment progress to establish Seller authority;
- import-order state to choose Marketplace asking price;
- CAP progress to imply listing readiness;
- Customs completion to imply Marketplace availability.

Likewise do not allow:

- Marketplace publication to imply import completion;
- asking price to become purchase price;
- listing photographs to become shipping evidence;
- Seller description to become Trade authority.

---

# 21. VISUAL DESIGN AUTHORITY — CONTROLLING

The Owner has selected the current **Seller workspace design language** as the visual model for new CarUp design work in R3.

The primary design-reference surfaces are:

1. `web/src/components/seller/SellerWorkspaceHeader.tsx`
2. `web/src/pages/dashboard/owner/MyGarage.tsx`
3. `web/src/pages/dashboard/owner/SellVehicle.tsx`

Read these before designing new R3 components.

---

# 22. SELLER DESIGN GRAMMAR

New R3 UI must follow the Seller design language.

Preserve characteristics such as:

- CarUp navy/slate + orange;
- white / restrained neutral working surfaces;
- real vehicle imagery as a primary visual;
- automotive/editorial hierarchy;
- small uppercase tracked eyebrows;
- strong black/bold display headings;
- tight heading tracking;
- strong separators;
- square or low-radius controls;
- deliberate dark feature/stage panels;
- structured information grids;
- restrained badges;
- strong action hierarchy;
- wide desktop canvas;
- responsive collapse;
- high contrast;
- clear typography.

---

# 23. DO NOT CREATE A FOURTH DESIGN LANGUAGE

R3 must not introduce:

- frosted glass as the default workspace container;
- excessive backdrop blur;
- decorative glassmorphism;
- fleets of generic rounded cards;
- floating pills as primary navigation;
- gradient decoration on every surface;
- a new font;
- a new color system;
- a CAP-specific visual identity;
- a separate visual language for imported vehicles.

Do not merely add CSS until the screens “look consistent.”

Extract reusable design primitives.

---

# 24. R3 DOES NOT REDESIGN THE WHOLE HOME PAGE

The Owner has identified broader CarUp design inconsistency, including public Home.

That observation is valid.

However this R3 unit is bounded.

Do not redesign all Home, Dealer, Garage, Corporate, Finance, etc. surfaces.

R3 should create reusable navigation/design foundations that can later feed a dedicated:

**ONE CARUP DESIGN SYSTEM / UI CONVERGENCE**

programme.

Do not let R3 expand indefinitely.

---

# 25. REQUIRED SHARED COMPONENT THINKING

Prefer shared reusable components rather than page-specific styling.

Responsibilities should include equivalents of:

## Workspace identity/navigation

Working concept:

`CarUpWorkspaceBar`

Responsibilities:

- active workspace;
- account identity;
- workspace switching;
- top-level destinations.

## Breadcrumb/parent context

Working concept:

`WorkspaceBreadcrumbs`

Example:

`Trade & Imports / Import Orders / Honda Vezel / CAP`

## Vehicle identity

Working concept:

`VehicleContextHeader`

Responsibilities:

- vehicle identity;
- VIN/frame;
- photograph where appropriate;
- current capability/status context.

## Capability boundary

Working concept:

`VehicleCapabilityPanel`

Responsibilities:

- Marketplace state;
- Trade state;
- independent actions.

## Exit/navigation actions

Working concept:

`WorkspaceExitActions`

Names are suggestions.

Responsibilities are mandatory.

---

# 26. DO NOT OVERCOMPONENTIZE

Do not create abstraction merely for abstraction.

Shared components should exist where they:

- enforce workspace clarity;
- enforce consistent visual language;
- prevent Seller/Trade drift;
- reduce duplicated navigation logic.

Do not replace mature existing components merely to satisfy a component-count target.

---

# 27. REQUIRED PRE-IMPLEMENTATION AUDIT

Before changing product UI, produce:

`T11_CAP_LR01_R3_ROUTE_WORKSPACE_CAPABILITY_MATRIX.md`

or an equivalent receipt under the established R3 receipts location.

Required columns:

`SURFACE`

`ROUTE`

`WORKSPACE`

`CANONICAL SUBJECT`

`PARENT CONTEXT`

`CURRENT ENTRY PATH`

`CURRENT EXIT PATH`

`CAPABILITY SOURCE`

`DESIGN FAMILY`

`DEFECT / NO DEFECT`

Minimum audited surfaces:

- My Garage
- Vehicle Passport
- Seller Studio
- My Listings
- Marketplace listing
- Trade OS shell
- Import Orders
- Import Order Detail
- CAP / Journey
- Documents
- Shipping
- Customs
- Messages

Also map end-to-end:

### Serena

My Garage  
→ Passport  
→ Seller / listing

### Vezel Seller path

My Garage  
→ Passport  
→ Seller Studio

### Vezel Trade path

Trade & Imports  
→ Import Orders  
→ Import Order  
→ CAP

### Cross-capability Vezel path

Passport  
→ CAP  
→ Passport

---

# 28. PRE-IMPLEMENTATION CLASSIFICATION

Classify every finding as exactly one of:

- `NAVIGATION_DEFECT`
- `WORKSPACE_IDENTITY_DEFECT`
- `CAPABILITY_VISIBILITY_DEFECT`
- `VISUAL_CONSISTENCY_DEFECT`
- `DATA_READ_MODEL_DEFECT`
- `AUTHORIZATION_DEFECT`
- `PRE_EXISTING_OUT_OF_SCOPE`
- `NO_DEFECT`

Do not solve a navigation problem with a database migration unless the audit proves the read model genuinely cannot answer the required question.

---

# 29. STOP CONDITIONS BEFORE PRODUCT MUTATION

Stop and return to the Moderator before implementation if the audit proves any of these:

1. Seller and Trade are actually sharing a conflicting write authority.
2. CAP requires a backend redesign to determine availability safely.
3. Vehicle identity is duplicated between Marketplace and Trade.
4. Kingston's transaction authority is materially inconsistent.
5. Current R2 product head no longer matches accepted authority.
6. Required authority document differs from this dispatch.
7. Fix requires Production access.
8. Scope requires reopening T8/T11/T12 architecture.

Do not silently broaden the task.

---

# 30. MANDATORY IMPLEMENTATION ORDER

If the audit confirms the known model and reveals only bounded UI/navigation/read-model defects, proceed in this exact order.

## A — CUSTODY

- verify R2 product SHA;
- verify R2 evidence head;
- verify PR #243 state;
- verify R3 authority document;
- verify current branch and clean starting diff.

Prefer a dedicated R3 branch.

Do not silently mutate accepted R2 custody.

Recommended branch name:

`feat/t11-cap-lr01-r3-workspace-navigation`

If branch/PR governance requires another exact name, record the reason.

---

## B — AUDIT

Create the route/workspace/capability matrix.

Do not skip.

---

## C — SELLER DESIGN EXTRACTION

Identify reusable layout/design primitives from:

- SellerWorkspaceHeader;
- MyGarage;
- Seller Studio.

Document the extracted design contract.

Do not merely duplicate Tailwind classes into every page.

---

## D — WORKSPACE IDENTITY

Introduce or converge authenticated workspace identity/navigation.

The user must immediately understand:

**My Vehicles / Marketplace**

versus:

**Trade & Imports**

without reading the URL.

---

## E — VEHICLE CAPABILITY CONVERGENCE

Vehicle Passport must expose capabilities separately.

Remove/rework the universal CAP/Journey action.

CAP must become conditional on a real authorized readable journey.

Marketplace action must remain independently derived.

---

## F — MY GARAGE CONVERGENCE

Serena and Vezel must share the same vehicle presentation grammar.

Their factual capability states may differ.

Do not build different cards based on “imported vehicle”.

---

## G — CAP NAVIGATION CONVERGENCE

Apply the Seller-derived visual grammar to the **navigation/chrome/context introduced or changed by R3**.

Do not disturb accepted R2 CAP content semantics merely to restyle the page.

Add:

- workspace identity;
- breadcrumb/parent context;
- clear import-order relationship;
- explicit exits;
- clear vehicle identity.

---

## H — TRADE PARENT FLOW

Ensure the natural CAP path is:

`Trade & Imports → Import Orders → Import Order → CAP`

Ensure CAP returns clearly to its Import Order.

Do not make Vehicle Passport the only CAP entry.

---

## I — SELLER REGRESSION

Prove the Vezel uses the same Seller Studio product as Serena.

Do not mutate Seller business facts simply for UAT.

---

## J — RESPONSIVE + ACCESSIBILITY

Validate:

- 390px
- 768px
- 1280px
- 1920px

Check:

- no horizontal overflow;
- visible keyboard focus;
- logical tab order;
- responsive navigation;
- breadcrumbs do not become unusable;
- workspace switcher remains understandable;
- buttons retain minimum usable touch size;
- no text clipping of vehicle/frame identifiers.

---

## K — PHYSICAL OWNER UAT

Use the actual Kingston staging account.

Do not use synthetic users for final physical certification.

---

# 31. PHYSICAL UAT — SERENA

Perform:

`Kingston → My Garage → Serena → Vehicle Passport`

Verify:

- normal canonical Vehicle presentation;
- Marketplace state visible;
- no misleading primary CAP CTA;
- Seller/Marketplace actions clear.

Then:

`Serena Passport → Manage Listing / Seller Studio`

Verify:

- established Seller visual language;
- explicit return to Passport/My Garage;
- no Trade OS controls intruding.

Do not change Serena's real business state merely for testing.

---

# 32. PHYSICAL UAT — VEZEL PASSPORT TO CAP

Perform:

`Kingston → My Garage → Vezel → Vehicle Passport`

Verify:

- same base Passport design family as Serena;
- Marketplace capability clearly separate;
- Trade & Import capability clearly separate.

Select:

`View CAP`

Verify:

- obvious workspace transition to Trade & Imports;
- CAP identifies vehicle;
- CAP identifies transaction context;
- breadcrumbs/parent navigation are visible;
- no confusion with Seller Studio.

Return using explicit UI:

`CAP → Vehicle Passport`

Do not use browser Back as the certification path.

---

# 33. PHYSICAL UAT — TRADE OS TO CAP

Perform:

`Trade & Imports`

→ `Import Orders`

→ Vezel import order

→ `CAP`

Verify:

- import order is the natural parent;
- CAP entry is obvious;
- CAP return to Import Order is obvious;
- Documents/Shipping/Customs remain clearly Trade functions;
- navigation remains coherent after visiting those pages.

---

# 34. PHYSICAL UAT — VEZEL SELLER CAPABILITY

From Vezel Passport:

enter Seller Studio.

Verify:

- same Seller architecture as Serena;
- same design language;
- same lifecycle controls;
- no CAP stage embedded into Seller listing steps;
- Trade capability remains adjacent/contextual.

Do not publish the Vezel unless Owner separately authorizes publication.

Do not create fake listing facts.

---

# 35. FUTURE JAPAN-YARD REQUIREMENT

R3 must remain compatible with the future CarUp business model.

A future vehicle may:

1. enter CarUp's Japan yard;
2. receive a canonical Vehicle Passport;
3. be marketed for sale;
4. be purchased by an overseas customer;
5. receive an Import Order;
6. move through CAP;
7. later be resold locally.

The UI architecture must support all of those capabilities around one durable vehicle identity.

Do not bake “imported vehicle” in as a permanent UI class that changes the Seller experience.

---

# 36. BUY-DIRECT-FROM-JAPAN REQUIREMENT

The Owner specifically wants buyers to be able to buy directly from CarUp's Japan-side inventory/yard in future.

Therefore the architecture must be compatible with:

Marketplace vehicle  
→ purchase/import transaction created  
→ Trade & Imports journey created  
→ same vehicle Passport retained  
→ CAP begins.

Do not make CAP dependent on a vehicle first being locally listed in Zimbabwe.

Do not make local Seller functionality dependent on CAP completion.

---

# 37. DO NOT REOPEN R2 DATA AUTHORITIES

Unless the audit proves a new defect, R3 must not change:

- 14-row historical CAP ledger;
- 5-group source order;
- R2 provenance;
- T8 document authority;
- T11 movement authority;
- T12 customs authority;
- D2 shipment isolation;
- Vezel source facts;
- R2 private media/document security;
- CAP external-runtime independence.

R2 is frozen.

---

# 38. NO PRODUCTION

Production Supabase:

`vhmnajoeicasaigiophh`

remains forbidden.

Do not access it.

Do not query it.

Do not mutate it.

Staging:

`eoyenigwevnxwwhyhaer`

may be used only within already established controlled authority.

R3 should normally require little or no database mutation.

---

# 39. SELLER STUDIO AUTOSAVE DEFECT

R2 identified a separate Seller Studio autosave-on-open behaviour.

Do not accidentally expand R3 into a broad Seller lifecycle remediation.

If the defect prevents R3 UAT or causes real staging mutation merely by navigation:

- document it;
- restore only authorized test-state changes if prior procedure permits;
- classify it separately;
- return to Moderator if product mutation is required.

Do not hide it.

---

# 40. CURRENT INHERITED CI FAILURES

Do not contaminate R3 with inherited unrelated failures such as:

- T3 `SAILING MATCH`;
- `UNGOVERNED_BRANCH`;
- previously classified inherited FX failure if still applicable.

Reverify live CI.

Do not assume the classification remains true without checking.

Do not weaken unrelated governance or tests to obtain green results.

---

# 41. TEST REQUIREMENTS

At minimum add/update tests for:

### Capability visibility

- Serena: no CAP CTA.
- Vezel: CAP CTA available.
- multiple journeys: chooser/no guess.
- unreadable journey: not falsely rendered as absent.

### Workspace navigation

- Passport → CAP.
- CAP → Passport.
- Import Order → CAP.
- CAP → Import Order.
- Seller Studio → Passport/My Garage.

### Domain isolation

- CAP availability does not change Seller state.
- Marketplace publication does not change CAP state.
- account role does not overwrite transaction role.

### Shared design/navigation components

- correct workspace label;
- correct parent breadcrumb;
- responsive behaviour;
- accessibility labels/focus.

### Existing regression

- Serena Seller workflow.
- Vezel CAP.
- D2.
- unrelated-user isolation.

---

# 42. DESIGN ACCEPTANCE GATES

The Moderator should be able to look at:

**My Garage**

**Vehicle Passport**

**Seller Studio**

**CAP**

and recognize one coherent CarUp business-product family.

But the Moderator must also immediately know which workspace is active.

Visual convergence does not mean erasing departmental identity.

Use:

**same design grammar**

with:

**clear workspace identity**

rather than identical pages.

---

# 43. CAP CONTENT MUST REMAIN CUSTOMER-FIRST

Do not let navigation work turn CAP into an internal admin panel.

The CAP core remains the customer's journey:

- Purchased Vehicle
- Consignee / Notify
- Document Delivery
- Shipping
- Documents
- Destination / Agent
- Progress
- other legitimate customer information

Navigation/chrome may improve.

Do not replace the customer journey with system architecture labels.

---

# 44. LANGUAGE RULES

Avoid internal implementation jargon in customer UI.

Prefer:

`Trade & Imports`

over internal programme codes.

Prefer:

`View import journey`

or:

`View CAP`

over:

`Open T11 compositor`.

Prefer:

`Back to import order`

over:

`Parent subject`.

Programme codes belong in receipts/tests, not customer navigation.

---

# 45. PRIVACY

Do not expose:

- private addresses;
- tokens;
- raw storage paths;
- private document URLs;
- backend IDs unnecessarily;
- cross-customer vehicles/import orders.

Breadcrumbs and workspace headers must obey the same authorization rules as the underlying pages.

Do not leak an import-order title/vehicle identity merely because a route exists.

---

# 46. EVIDENCE RULE

Every final UI claim must be backed by:

- exact code;
- exact data;
- physical UAT;
- or a clearly labelled inference.

Do not manufacture screenshots.

Do not fabricate successful navigation.

Do not use mocked data in final physical certification.

Tests/fixtures are allowed for coverage but cannot replace real Kingston/Serena/Vezel UAT.

---

# 47. MODERATOR CHECKPOINTS

The programme authority defines five checkpoints.

## CHECKPOINT 1 — AFTER AUDIT

Before substantial product mutation, ensure the route/workspace/capability matrix confirms the intended model.

If it contradicts the intended architecture materially:

STOP.

Do not code around the contradiction.

---

## CHECKPOINT 2 — AFTER DESIGN/NAVIGATION PRIMITIVES

Prove:

- Seller design language was extracted;
- no fourth visual language was invented;
- workspace identity is clear.

---

## CHECKPOINT 3 — AFTER VEHICLE CAPABILITY CONVERGENCE

Compare Serena and Vezel.

Prove:

- same base vehicle shell;
- different capabilities only where real facts differ.

---

## CHECKPOINT 4 — AFTER CAP NAVIGATION

Prove:

- CAP clearly belongs to Trade & Imports;
- no navigation dead end;
- Import Order and Passport are both understandable parent/adjacent contexts.

---

## CHECKPOINT 5 — FINAL OWNER UAT

Only then recommend acceptance.

---

# 48. DO NOT SELF-ACCEPT

The specialist cannot accept R3.

The specialist returns evidence and exactly one recommendation:

`RECOMMEND ACCEPT`

or

`RECOMMEND REMEDIATE`

or

`RECOMMEND BLOCK`

The Moderator retains final disposition authority.

---

# 49. REQUIRED RETURN PACKET

Return:

- exact starting SHA;
- exact final product SHA;
- exact evidence/docs SHA;
- branch;
- PR;
- PR state;
- exact parent;
- commit sequence;
- changed files;
- route/workspace/capability matrix;
- design-language extraction;
- shared components introduced;
- pages modified;
- data/backend changes, if any, with justification;
- proof R2 authority remained intact;
- Serena UAT;
- Vezel Passport/CAP UAT;
- Trade OS → CAP UAT;
- Vezel Seller-path UAT;
- responsive evidence at 390 / 768 / 1280 / 1920;
- accessibility results;
- console findings;
- network findings;
- authorization/isolation tests;
- CI classification;
- inherited defects;
- new defects;
- confirmation Production was not accessed.

---

# 50. SUCCESS CONDITION

R3 succeeds when Kingston can move naturally through CarUp while remaining one person with multiple legitimate capabilities.

The successful model must read like this:

### Serena

`My Vehicles`

→ `Serena Passport`

→ `Marketplace / Manage Listing`

No misleading CAP.

### Vezel

`My Vehicles`

→ `Vezel Passport`

with two independent capabilities:

`Marketplace`

and

`Trade & Import`

### Vezel Trade journey

`Trade & Imports`

→ `Import Orders`

→ `Vezel Import Order`

→ `CAP`

with obvious return paths.

### Vezel local sale

`Vezel Passport`

→ `Seller Studio`

using the **same Seller product and design rules as Serena**.

CAP remains intact.

Seller remains intact.

Vehicle identity remains one.

The customer always knows:

**where they are**

**what vehicle they are working on**

**what business workflow they are in**

**where they came from**

**where they can go next**

without needing to understand CarUp's internal organizational structure.

That is the R3 objective.

---

# SPECIALIST FINAL INSTRUCTION

Be thorough.

Do not optimize for speed.

Do not take visual shortcuts.

Do not replace architectural clarity with cosmetic consistency.

Do not redesign a domain merely because its navigation is confusing.

Preserve the accepted R2 plumbing.

Converge the workspace boundaries.

Converge the vehicle capability model.

Use the Seller UI as the visual authority.

Make Serena and Vezel prove the architecture.

And do not let any CarUp business page become a navigational dead end.

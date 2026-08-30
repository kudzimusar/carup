# CarUp Global Product Design System

**Status:** Canonical global UI/UX contract
**Scope:** Every CarUp web surface — public, authenticated, operational, administrative, mobile and desktop
**Authority:** Root-level product design law. Feature-specific design documents may extend this file but may not contradict it.
**Reference implementations:** current Home, Marketplace and Marketplace Vehicle Detail experiences.
**Supersedes:** undocumented legacy dashboard conventions and feature-local visual improvisation.

---

## 1. Purpose

CarUp must feel like one automotive platform, not a collection of pages built by different teams or at different times.

The product promise is:

> **One vehicle identity. One coherent journey. Seller statements, governed evidence, Trust, commerce and lifecycle intelligence remain connected without fabricating facts.**

Every feature must therefore preserve both:

1. **functional continuity** — the user's object, state and next action persist across routes; and
2. **visual continuity** — typography, media, composition, navigation, actions, data states and interaction patterns visibly belong to the same product.

A page is not design-complete merely because its controls work. It is complete only when it satisfies this global contract and the end-to-end journey it participates in.

---

## 2. Governing hierarchy

When design instructions conflict, use this order:

1. **Truth & Trust / security / privacy contracts**
2. **This root `DESIGN.md`**
3. Feature-specific design documents
4. Component-local implementation decisions
5. Conversational or temporary styling instructions

Feature documents may introduce specialized patterns, but they may not:
- create a competing visual system;
- downgrade accessibility or responsive behavior;
- fabricate data to make a dashboard look populated;
- replace canonical Trust with decorative scores;
- merge seller-stated facts with verified/governed facts;
- hide missing/unavailable states;
- introduce navigation that breaks object continuity.

The existing `docs/marketplace/MARKETPLACE_VISUAL_DNA.md` remains the Marketplace-specific extension of this contract.

---

## 3. Reference quality bar

The accepted visual/product quality bar is established by the current:

- Home experience;
- Marketplace showroom;
- Marketplace listing cards;
- Marketplace Vehicle Detail composition.

New or materially changed surfaces must converge toward this standard rather than preserve legacy dashboard styling.

The target character is:

- serious automotive commerce;
- editorial rather than generic SaaS;
- evidence-led rather than badge-led;
- photo- and information-led rather than card-led;
- visually confident but operationally calm;
- dense enough to be useful, never crowded;
- premium without pretending unavailable data exists.

---

## 4. Core visual language

### 4.1 Palette

Primary anchors:
- deep navy / near-black for decisive commerce and Trust regions;
- CarUp orange for primary action, active state and important highlights;
- white and restrained cool gray for reading surfaces;
- semantic colors only where meaning is real: success, warning, danger, informational.

Rules:
- orange is an action/significance color, not background decoration everywhere;
- gradients are exceptional, not default;
- color may never be the only carrier of status;
- semantic color must map to actual state, not marketing enthusiasm.

### 4.2 Typography

Use a strong editorial hierarchy:
- large, compact, high-weight display headings for major decisions;
- concise section titles;
- readable body copy with generous line height;
- small uppercase/letter-spaced eyebrows only for hierarchy, not decoration;
- tabular/monospaced treatment where identifiers benefit from it.

Avoid:
- tiny metadata as the dominant information layer;
- equal visual weight for every button, number and label;
- dense dashboard text with no hierarchy.

### 4.3 Layout

Canonical content width: **up to 1440px** for primary public and major authenticated workspace surfaces.

Use:
- intentional whitespace;
- open bands and dividers;
- asymmetric grids where content warrants them;
- full-width visual regions where a vehicle or chart deserves emphasis;
- sticky decision panels only when they preserve context.

Avoid:
- wrapping every section in a rounded card;
- nesting cards inside cards as the default composition;
- narrow legacy dashboard columns for complex business workflows;
- arbitrary width changes between connected routes.

### 4.4 Shape

Large rounded rectangles are not the default CarUp language.

Rounded treatment is appropriate for:
- compact controls;
- pills/status chips;
- drawers/sheets;
- avatars;
- small interactive units;
- selected charts where the container benefits from separation.

Editorial/commerce regions should prefer:
- squared or lightly rounded edges;
- borders;
- bands;
- open composition;
- shadow used to establish hierarchy rather than decorate every panel.

---

## 5. Media-first automotive rule

Vehicle imagery is primary visual information.

Rules:
- real listing photography receives substantial area;
- no unrelated stock vehicle may stand in for a listing;
- listing media is seller advertising media, not verified evidence;
- verified evidence has its own governed presentation;
- missing listing media must produce an honest designed state;
- image delivery failure is distinct from "seller supplied no photos";
- cover/primary image follows the seller's explicit choice when recorded;
- galleries must work on touch and desktop;
- crop/aspect behavior must remain stable across Seller preview, Garage, Listings, Home and Marketplace.

A vehicle journey should visually preserve identity. The same primary listing image should remain recognizable across:
Seller Studio → My Garage → My Listings → Preview → Marketplace → Vehicle Detail.

---

## 6. Navigation and orientation

Every route must answer:

1. **Where am I?**
2. **How do I go back or up one level?**
3. **What is the primary next action?**

### 6.1 Global navigation
Use the canonical public or authenticated navigation shell.

### 6.2 Local navigation
Object/workflow pages require local orientation:
- breadcrumb and/or explicit back action;
- object identity in the header;
- next-step CTA;
- no dead-end pages.

Example:
`Seller Home / My Garage / 2021 Toyota Hilux / Listing`

### 6.3 Active-state rule
One navigation item represents one distinct destination/intent.

Two visible navigation items must not share the same route and simultaneously appear active unless they are intentionally represented as one grouped control.

### 6.4 Seller continuity
A user managing a known vehicle must never be forced into a "new vehicle" experience without an explicit choice.

---

## 7. Action hierarchy

Each decision region gets **one visually dominant primary action**.

Secondary actions:
- are grouped by purpose;
- are visually quieter;
- do not compete with the main next step.

For Seller listing management, lifecycle operations should be grouped as:
- **Continue / improve**
- **Preview / publish**
- **Performance**
- **Price / availability**
- **Trust / evidence**
- **Archive / sold / destructive**

Do not present six equally weighted buttons in one cluster.

---

## 8. Data-state design

Every data element must distinguish:

- loading;
- recorded;
- evaluated;
- pending;
- unavailable;
- not connected;
- withheld by privacy;
- not applicable;
- stale;
- error.

### 8.1 No fake zeros
If CarUp does not track a metric, display:
- "Not tracked";
- "No data yet";
- "Source not connected";
- or another truthful state.

Do **not** render `0` unless zero is an actual measured value.

### 8.2 Empty space is still designed
An unavailable data series should reserve an intentional explanatory state where the future capability belongs, without drawing fake bars, fake lines or fake percentages.

### 8.3 Provenance
Seller-stated, CarUp-computed and externally/governed values must remain semantically distinguishable.

---

## 9. Dashboard and Intelligence standard

CarUp dashboards are business decision surfaces, not lists of cards.

The visual benchmark is the *class* of executive dashboard represented by:
- top-line KPI tiles;
- time-window controls;
- one or more dominant charts;
- secondary visual breakdowns;
- clear action queues;
- drill-down from aggregate → vehicle/listing → event.

The exact third-party reference layout is **not** to be copied. CarUp uses its own automotive visual DNA.

### 9.1 Dashboard composition

When governed data exists, a mature dashboard should normally contain:

**A. KPI band**
- 3–6 high-value measures;
- current value;
- comparison or state;
- compact trend indicator only when a real comparison exists.

**B. Primary traffic visual**
Choose the chart that answers the main business question:
- line/area chart for time series;
- bar chart for categorical comparison;
- funnel for conversion;
- stacked bar for composition;
- scatter for relationship/distribution;
- heat map for temporal/geographic intensity when appropriate.

**C. Secondary visual summaries**
Examples:
- donut/radial chart for composition or completion;
- funnel for listing → view → save → inquiry;
- segmented readiness meter;
- source-distribution chart;
- ranked table with sparklines where real history exists.

**D. Action queue**
Explain what the user should do next.

### 9.2 Seller Intelligence vocabulary

Where data is governed and available, Seller dashboards should be able to visualize:
- listing views over time;
- unique buyer interest;
- saves;
- shares;
- comparison inclusions;
- inquiries;
- inspection requests;
- conversion funnel;
- discovery source/search terms;
- geographic interest;
- price changes versus response;
- listing completeness;
- evidence/readiness state;
- publication state;
- response time;
- listing-by-listing performance.

### 9.3 Truthful dashboard zero-state

When data is not yet available:
- keep the information architecture visible;
- label the metric "Not tracked" or "No activity yet" as appropriate;
- explain what event will populate it;
- do not plot synthetic lines or placeholder percentages;
- do not convert "unknown" to zero.

### 9.4 Chart accessibility
- chart meaning must also be available in text/table form where practical;
- never rely on color alone;
- legends must be concise;
- mobile charts must remain readable without horizontal page overflow;
- chart controls require keyboard/touch accessibility.

---

## 10. Responsive design contract

Every modified feature is certified on:
- desktop;
- tablet/narrow desktop;
- mobile.

Mobile is not a shrunk desktop.

Rules:
- persistent key navigation remains reachable;
- primary CTA stays discoverable;
- media remains usable;
- tables become deliberate cards/scroll regions only when necessary;
- charts simplify rather than become illegible;
- no horizontal page overflow;
- touch targets are appropriately sized;
- drawer/sheet behavior must preserve task state.

---

## 11. Seller experience standard

Seller is a first-class commerce experience, not a utility form.

### 11.1 Seller entry
"Sell" must first resolve intent:

1. **Sell a vehicle already in My Garage**
2. **Sell a vehicle CarUp already knows** — identify by VIN/plate/approved identifier and reuse Passport identity
3. **Add a vehicle CarUp does not know yet**

Authenticated users should see their eligible vehicles before being asked to type known details again.

### 11.2 Progressive reuse
Canonical identity facts may hydrate where authority permits.
Seller commercial statements remain seller-owned and editable.

### 11.3 Autosave
Long forms must preserve progress at meaningful interaction boundaries and across refresh/auth handoff.

### 11.4 Media
Media persistence is a save prerequisite when the seller expects media to be part of the listing.
No successful save may silently discard selected listing media.

### 11.5 Draft preview
Draft preview must reuse the **same buyer presentation components** as public Marketplace Vehicle Detail, in a non-public preview mode.

A draft preview is not a public Marketplace listing.

### 11.6 Publication
Publication is a governed transition.
Blocked publication must state the exact blocker and the next action.

---

## 12. My Garage standard

My Garage represents the owner's durable vehicle relationship, not just a listing grid.

Each vehicle story should expose:
- real listing image when available;
- Passport identity;
- ownership/relationship state;
- listing/publication state;
- Trust state;
- evidence/readiness state;
- service/insurance/PartSentry summaries where supported;
- one dominant context-sensitive next action.

For a draft Seller vehicle, the dominant action is normally:
> **Continue listing**

Secondary:
> View Vehicle Passport

My Garage must provide an obvious route back to Seller/Owner home.

---

## 13. My Listings standard

My Listings is the Seller commerce operating surface.

Each listing should visually separate:

### Identity
vehicle image + make/model/year + VIN or safe identifier

### Lifecycle
draft / ready / published / reserved / sold

### Commercial facts
price, availability, location projection

### Performance
views, saves, inquiries, conversion and trends — only where tracked

### Readiness
photos, seller copy, evidence, Trust/publication requirements

### Actions
one primary next action; secondary actions grouped by lifecycle.

A draft must offer:
- Continue/Edit;
- Buyer Preview;
- Publication readiness.

A public listing may offer:
- View on Marketplace;
- performance;
- price/availability actions;
- unpublish/sold lifecycle.

---

## 14. Marketplace and Vehicle Detail standard

Marketplace remains inventory-first.

Vehicle Detail order:

1. Listing gallery
2. Vehicle/commercial decision panel
3. Canonical Trust and source coverage
4. Pricing/cost context
5. Contact/inquiry path
6. Registration/evidence identity
7. Seller-stated description/features
8. Vehicle history/lifecycle intelligence
9. ownership/service/insurance/PartSentry context where available
10. transaction/reservation path where governed

A newly Seller-created listing must render through the same structure. Missing facts produce designed states; they do not trigger an alternate legacy page.

---

## 15. Vehicle Passport / Verify standard

Passport is the durable identity/evidence/lifecycle layer.

Verify must:
- preserve the same vehicle visual identity;
- distinguish exact VIN lookup from protected identifier lookup;
- distinguish "not found" from "not authorized";
- never imply verification from absence;
- expose governed evidence and Trust states clearly.

Seller must reuse Passport identity rather than create duplicate vehicle identities.

---

## 16. Communications standard

Communications should appear at the decision point:
- buyer inquiry;
- seller response;
- inspection request;
- support/handoff.

Do not expose channels the runtime cannot actually deliver.

Conversation state must remain connected to the listing/vehicle.

---

## 17. Service Network / Garage / Mechanic standard

Operational service surfaces use the same global shell and hierarchy but prioritize:
- vehicle identity;
- work state;
- evidence;
- responsible party;
- next action.

Service history must feed the Passport lifecycle without visually masquerading as verified evidence unless governed verification exists.

---

## 18. Dealer / business workspace standard

Dealer and partner workspaces may be denser than consumer surfaces, but still use:
- CarUp palette and typography;
- open layout;
- consistent navigation;
- visual KPI + chart hierarchy;
- vehicle imagery where inventory is the subject;
- explicit tenant/branch context;
- truthful zero states.

Tables are acceptable where comparison density is the primary task, but should not become the only design language.

---

## 19. Diaspora / finance / insurance / government / admin

Specialized roles may add domain-specific controls, but:
- global navigation/orientation rules remain;
- data provenance remains visible;
- charts must be based on governed data;
- role-specific operational density is allowed;
- no feature may introduce a competing brand system.

---

## 20. Legacy UI deprecation

The following patterns are **legacy defaults** and may not be copied into new or materially redesigned work without explicit justification:

- every section as `Card + CardContent + card-shadow`;
- large stacks of equally weighted rounded cards;
- generic dashboard grids with no visual hierarchy;
- tiny icon + label as the only representation of a major feature;
- unrelated stock images;
- six equally weighted action buttons;
- dashboard zeros for untracked data;
- duplicated visible nav items sharing one route;
- route-local styles that ignore Home/Marketplace visual language.

Existing legacy surfaces are migration targets, not reference implementations.

---

## 21. Shared component strategy

Prefer shared, domain-aware primitives for:
- vehicle media;
- vehicle identity headers;
- Trust state;
- evidence state;
- publication state;
- seller listing preview;
- KPI tiles;
- chart frames;
- empty/unavailable states;
- breadcrumbs/back navigation;
- primary/secondary action regions.

Do not copy-and-paste Marketplace markup into Seller if a reusable presentational component can encode the same semantics.

The goal is **one component contract, multiple modes**, for example:
- Marketplace public mode;
- Seller draft-preview mode;
- Owner management mode.

---

## 22. Design review checklist

Before implementation:
- What canonical journey is this surface part of?
- What object is the user acting on?
- Which existing reference surface should it visually match?
- Which data is seller-stated, governed, computed, unavailable or private?
- What is the one primary action?
- What happens on mobile?
- What does the zero-state look like?
- What persists through refresh/navigation?
- What is the next and previous route?

Before certification:
- desktop visual evidence reviewed;
- mobile visual evidence reviewed;
- no legacy visual regression;
- local navigation works;
- object identity persists;
- real media persists;
- empty/error/loading states are designed;
- no fake zeros/trends;
- Truth & Trust semantics unchanged;
- dynamic journey reaches the downstream feature it feeds.

---

## 23. End-to-end certification rule

A feature cannot be certified only by testing its own page.

Certification must prove the **upstream and downstream contract**.

For Seller, the minimum dynamic journey is:

`Home → Sell → identify/reuse/add vehicle → Seller Studio → media → account/auth handoff → autosave/resume → My Garage → My Listings → buyer preview → evidence/review → publish → Marketplace → Vehicle Detail → inquiry → Seller Intelligence → unpublish/sold → Passport persists`

Reference/seeded vehicles may validate rendering and governed states, but **may not substitute for a vehicle created through the actual Seller journey**.

---

## 24. Change control

Any PR that materially changes UI must state:
- which `DESIGN.md` sections it implements;
- any documented exception;
- desktop/mobile evidence;
- affected end-to-end journey;
- whether shared design primitives changed.

A UI PR is not mergeable if it knowingly introduces a new legacy pattern or visual fork without an approved exception.

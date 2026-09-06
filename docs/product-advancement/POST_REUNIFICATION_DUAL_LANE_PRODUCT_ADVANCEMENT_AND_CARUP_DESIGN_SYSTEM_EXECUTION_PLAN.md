# CarUp Post-Reunification Dual-Lane Product Advancement & Design System Execution Plan

**Repository:** `kudzimusar/carup`  
**Canonical branch:** `main`  
**Plan status:** canonical planning document; no runtime implementation is authorized by this document alone  
**Programme stage:** Post-Reunification Product Advancement  
**Primary implementation lanes:** Communications / Email and Core Marketplace Buyer↔Seller Reliability  
**Design strategy:** Marketplace as the first reference implementation of the mature CarUp product experience  
**Execution model:** maximum two active source-write PRs at a time  

---

## 0. Purpose

This document defines how CarUp proceeds after Project Reunification and Canonical Vehicle Truth / Trust closure without recreating the fragmentation that the reunification programme was designed to eliminate.

The governing product direction remains:

> **ONE CARUP. ONE CANONICAL MAIN. ONE CURRENT PRODUCT.**

Reunification is complete. Canonical Vehicle Truth / Trust is complete. The system now moves from architecture recovery and truth-convergence into **product advancement, reliability, and product-experience maturity**.

The next execution model intentionally permits **two bounded implementation PRs in parallel**, provided they start from canonical `main`, have explicit ownership boundaries, and converge through a controlled integration certification process.

This plan also defines the CarUp design-system programme. Design is not treated as a cosmetic phase postponed until the end. Instead, product UX architecture begins now, while the highest-fidelity visual polish is applied progressively as functional journeys stabilize.

Marketplace is the first reference domain because it combines the broadest set of CarUp capabilities in one user journey: discovery, search, filtering, vehicle media, Trust, Passport, comparison, saving, inquiry, Communications, reservation, and transaction readiness.

---

# 1. Governing Product Context

## 1.1 Project Reunification is closed

Do not reopen the historical repository-recovery programme unless live evidence proves a canonical-main integrity defect.

Do not repeat:

- branch archaeology across historical remote branches;
- worktree/stash reconstruction;
- competing-current-product debates;
- re-creation of an integration/reunification branch;
- revival of superseded implementations simply because they still exist in Git history;
- broad repository rewrites for tidiness.

From this point:

> **Current `main` is CarUp.**

Historical branches and closed/superseded PRs are evidence, not alternative product authorities.

## 1.2 Canonical Vehicle Truth / Trust is closed

Do not reopen Issue #164 or redesign Trust merely because another feature touches vehicles.

The permanent rule is:

> **Features may contribute governed facts to canonical Truth / Trust, or consume canonical Truth / Trust. They must not create competing vehicle truth.**

Marketplace, Passport, Garage, Finance, Insurance, SafeTrade, Diaspora, Communications, mobile, and future partner systems must consume the canonical vehicle / Trust contracts already certified.

No feature may:

- publish legacy `vehicles.trust_score` as canonical Trust;
- create its own hidden Trust ranking rule;
- infer private vehicle identity from public payloads;
- bypass the canonical public vehicle projection;
- create a second media-publication definition;
- fabricate unavailable facts as zero/default/verified values.

## 1.3 Communications architecture is also canonical

The Communications rule remains:

> **CarUp owns the conversation. Providers are transports.**

Marketplace must not build its own messaging subsystem. Email must not become a parallel chat product. WhatsApp, Telegram, Email, SMS, Push, Web, Mobile and future Voice remain transport / presentation channels into the same canonical conversation model.

---

# 2. Programme Objective

The immediate programme objective is to make the reunited and trustworthy CarUp **reliably usable by real people**.

The work now prioritizes:

1. complete user journeys rather than isolated backend capability;
2. P0/P1 reliability and security before feature breadth;
3. one canonical business contract per concept;
4. polished but truthful UX;
5. mobile parity where the journey requires it;
6. visual design that reveals, rather than hides, CarUp's Trust / evidence advantage;
7. controlled beta readiness.

The transition is:

```text
PROJECT REUNIFICATION
        ↓
ONE CANONICAL MAIN
        ↓
CANONICAL VEHICLE TRUTH / TRUST
        ↓
POST-REUNIFICATION PRODUCT ADVANCEMENT
        ↓
FUNCTIONAL RELIABILITY + PRODUCT EXPERIENCE
        ↓
CONTROLLED FIRST TESTERS
        ↓
BETA / GO-TO-MARKET ACTIVATION
```

---

# 3. The Dual-Lane Execution Model

## 3.1 Maximum two active source-write PRs

CarUp may now run **two implementation PRs in parallel**.

This is a hard concurrency cap, not a target to exceed.

Allowed structure:

```text
main
├── Lane A PR — Communications / Email
└── Lane B PR — Core Marketplace Reliability + Reference UX
```

Disallowed structure:

```text
main
├── Communications
├── Marketplace
├── Design rewrite
├── Diaspora
├── Garage
└── Security hardening
```

Documentation, design research, prototypes, test plans and visual concept generation may proceed outside the two source-write lanes so long as they do not create a third runtime mutation lane.

## 3.2 Both implementation lanes branch from canonical `main`

Default rule:

- Lane A branches from current verified `main`.
- Lane B branches from the same current verified `main`.
- Lane B does not normally branch from Lane A.
- Lane A does not normally branch from Lane B.

The purpose is to preserve independent reviewability and prevent stacked-PR dependency chains from becoming a new source of architectural confusion.

## 3.3 No silent cross-lane edits

If one lane needs a contract or edit owned by the other lane, it must create an **integration request** rather than editing through the boundary casually.

Example:

```text
INTEGRATION REQUEST
Requester: Marketplace
Owner: Communications
Need: buyer inquiry creation must return/open canonical conversation context
Required by: Marketplace buyer↔seller journey
```

The owning lane then supplies the contract or makes the smallest necessary owned change.

## 3.4 Shared-file changes are serialized

Certain files or surfaces are effectively integration choke-points and must not be edited concurrently without explicit ownership.

Examples include:

- global application routing;
- global feature registry;
- common authentication/session bootstrap;
- shared API primitives;
- shared type contracts;
- migration ledger / migration dispatcher infrastructure;
- environment-wide workflows;
- canonical navigation shell.

When such a file must change, one lane owns the change and the other consumes it after merge or through a narrowly reviewed shared commit.

---

# 4. Lane A — Communications / Email Product Advancement

## 4.1 Lane objective

Finish and harden the user-facing Communications / Email product without reopening the Communications architecture.

The lane owns:

- canonical conversations;
- participants;
- message persistence;
- delivery and retry;
- email transport;
- Resend / Brevo transport adapters where applicable;
- reply tokens and inbound reply routing;
- provider webhooks;
- notification-to-conversation relationships;
- consent / preferences / unsubscribe presentation;
- Communications Command Center;
- conversation authorization;
- user conversation UX;
- email templates / rendering under the canonical Email Experience & Design System;
- communication analytics and AI support where already contractually defined.

## 4.2 Lane non-goals

Do not:

- create an independent Email chat system;
- duplicate Marketplace inquiry state;
- recreate WhatsApp / Telegram architecture;
- let providers become the canonical record;
- build transport-specific business logic that belongs in CarUp domain services.

## 4.3 Marketplace seam

The Marketplace lane may create or advance an inquiry, but once a buyer needs to communicate with a seller, the canonical conversation belongs to Communications.

Marketplace may own:

```text
buyer expresses interest
        ↓
marketplace inquiry created
```

Communications owns:

```text
canonical conversation opened
        ↓
participants established
        ↓
message persisted
        ↓
transport selected
        ↓
email / WhatsApp / Telegram / in-app delivery
```

---

# 5. Lane B — Core Marketplace Buyer↔Seller Reliability + Reference UX

## 5.1 Lane objective

Make the Core Marketplace buyer↔seller journey reliable enough for controlled external testing while transforming Marketplace into the first mature CarUp product-experience reference implementation.

This is not a Marketplace rewrite.

The lane must preserve the current working business architecture and improve reliability, information architecture, responsiveness and visual presentation around it.

## 5.2 Existing Marketplace engineering is an asset, not a discard candidate

The current web Marketplace already contains meaningful engineering that must be preserved unless a measured defect requires replacement, including:

- canonical public Marketplace listing API;
- URL-backed search and filter state;
- free-text search;
- make filter;
- condition/category filter;
- stackable Trust tags with AND semantics;
- min/max price filtering;
- sort state;
- advanced client refinements for body, location, fuel and transmission;
- mobile filter drawer on web;
- saved listings;
- guest favorites;
- compare workflow;
- share workflow;
- inquiry flow;
- AI Buyer Assistant entry point;
- referral/campaign attribution capture;
- real production/staging API behavior without silent mock fallback.

The Truth / Trust closure hardened this implementation. Marketplace now consumes canonical public Truth / Trust instead of freely reading legacy stored scores or inventing missing facts.

The design programme therefore preserves:

```text
behavior
contracts
state machines
backend APIs
governed truth
privacy boundaries
test semantics
```

while being free to refactor:

```text
component composition
page hierarchy
markup structure
layout
visual hierarchy
spacing
responsive treatment
interaction patterns
information density
```

## 5.3 Core buyer journey

The first reliable Marketplace journey is:

```text
Marketplace Home
      ↓
Search / Discovery
      ↓
Filter / Sort
      ↓
Vehicle Listing Card
      ↓
Vehicle Detail
      ↓
Trust / Passport
      ↓
Save / Compare / Share
      ↓
Contact Seller / Inquiry
      ↓
Canonical Conversation
      ↓
Reservation / next permitted transaction action
```

## 5.4 Core seller journey

```text
Seller / Dealer inventory
      ↓
Create / select vehicle
      ↓
add media / evidence
      ↓
review truthful listing state
      ↓
Publish
      ↓
Edit / manage
      ↓
Receive inquiry
      ↓
Canonical conversation
      ↓
Reserve / sold / unpublish lifecycle
```

## 5.5 Marketplace reliability priorities

The lane must verify and harden:

- listing discovery correctness;
- publication / draft visibility;
- search behavior;
- filter behavior;
- server-side facet coverage needed for scale;
- canonical Trust sorting/filtering;
- saved listing account scoping;
- compare correctness;
- inquiry durability;
- seller identity presentation;
- reservation lifecycle;
- sold / unavailable states;
- error / loading / empty states;
- real mobile parity;
- integration into canonical Communications.

---

# 6. Marketplace Reference UX Strategy

## 6.1 Marketplace is the first CarUp design-system reference implementation

Marketplace is selected because it exposes the broadest practical mix of CarUp capabilities and therefore forces the design language to solve real product problems rather than abstract component-library problems.

The reference implementation must prove how CarUp presents:

- vehicle identity;
- vehicle media;
- price;
- Trust;
- confidence;
- evidence;
- unknown / withheld facts;
- seller identity;
- action urgency;
- comparison;
- conversation;
- reservation state;
- history / Passport entry points.

## 6.2 Benchmark principles

The Marketplace should be informed by successful vehicle discovery and vehicle-history products without becoming a visual copy of any one of them.

Reference principles include:

- **Autotrader:** fast vehicle discovery, familiar automotive taxonomy, immediate actionability;
- **Cars.com:** deep but comprehensible filter / facet architecture;
- **Carwow:** guided buyer decision support, comparison and editorial/assistant behavior;
- **carVertical:** evidence / history storytelling, timeline clarity, risk/unknown-state communication;
- **CarUp:** canonical Trust, Zimbabwe / Diaspora context, Vehicle Passport, PartSentry, SafeTrade-readiness and connected automotive ecosystem.

The intended synthesis is:

> **Precision Automotive Commerce + Evidence-Led Trust Intelligence.**

## 6.3 Explicit visual non-goals

The mature CarUp design language must not default to:

- glassmorphism;
- translucent dashboards everywhere;
- generic fintech neon;
- purple/blue AI gradients as identity;
- floating glowing AI orbs;
- decorative blur replacing hierarchy;
- excessive pill controls;
- every section placed in a rounded card;
- fabricated “verified” badges used as decoration;
- generic SaaS sidebar + statistic-card composition as the primary visual identity.

## 6.4 Desired visual character

CarUp should feel:

- automotive;
- precise;
- factual;
- premium;
- trustworthy;
- controlled;
- active;
- responsive;
- contemporary without being trend-dependent.

### Foundation

- warm white / cool off-white product canvas;
- deep graphite / navy-black typography;
- electric CarUp orange for primary action / brand energy;
- steel / slate neutral support;
- green reserved for evidence-backed positive state;
- amber for uncertainty / attention;
- red for block / risk;
- blue for informational/source context;
- gradients used sparingly, not as structural UI wallpaper.

## 6.5 Vehicle photography hierarchy

On shopping surfaces, vehicle imagery is primary content.

The Marketplace card hierarchy is approximately:

```text
VEHICLE IMAGE
MAKE / MODEL / YEAR
PRICE
ESSENTIAL SPECS
LOCATION
TRUST STATE / CONFIDENCE
SELLER CONTEXT
ACTION
```

Do not overload cards with every possible Trust / Passport / risk detail.

Use progressive disclosure.

## 6.6 Trust is not a review-star widget

Do not visually reduce canonical Trust to a decorative badge such as:

```text
80 Trust ✓
```

Trust presentation must communicate the distinction between score and confidence.

Reference structure:

```text
TRUST
Moderate
50 / 100

Confidence
Low

Evidence basis
7 governed facts
0 substantiated by connected authority

Limitations
3 known limitations
```

The exact presentation may evolve, but the semantic hierarchy is mandatory.

## 6.7 Unknown / not evaluated / withheld are first-class visual states

The UI must not hide truthful uncertainty.

It must distinguish:

- known recorded fact;
- not recorded;
- withheld/private;
- not evaluated;
- evaluated;
- unavailable/system failure;
- inconsistent / blocked.

A missing price is not `$0`.

A missing mileage is not `0 km`.

An unstamped legacy score is not canonical Trust.

An undisclosed seller identity is not automatically “private seller.”

---

# 7. CarUp Design-System Architecture

## 7.1 Build from product primitives, not page-specific styling

The Design System should grow from reusable CarUp product primitives.

Primary domain primitives:

### Vehicle Identity Block

- vehicle image;
- make/model/year;
- public VIN / identity context where permitted;
- listing / ownership state.

### Trust Block

- canonical score if evaluated;
- band;
- confidence;
- evidence basis;
- limitations;
- source / evaluation state.

### Action Block

- next-best action;
- blocking issue;
- urgency;
- primary CTA;
- secondary CTA.

### Evidence Block

- evidence category;
- source;
- state;
- verification / review posture;
- privacy / availability state.

### Timeline

- ownership;
- service;
- evidence;
- verification;
- reservation / transaction;
- communication-relevant events.

### Transaction State

- inquiry;
- reservation;
- payment readiness;
- inspection;
- delivery / completion.

### Conversation Context

- participants;
- vehicle / listing context;
- canonical conversation;
- message history;
- permitted actions.

## 7.2 Marketplace component decomposition target

Do not preserve a giant page component merely because it currently works.

Target composition may include:

```text
MarketplacePage
├── MarketplaceSearchShell
├── MarketplaceQuickDiscovery
├── MarketplaceFacetPanel
├── MarketplaceMobileFilters
├── MarketplaceActiveFilterBar
├── MarketplaceResultHeader
├── MarketplaceListingGrid
│   └── VehicleListingCard
│       ├── VehicleMediaFrame
│       ├── VehicleCommerceSummary
│       ├── VehicleTrustPreview
│       └── SellerContextPreview
├── MarketplaceCompareTray
├── MarketplaceEmptyState
└── MarketplaceLoadError
```

Implementation may choose different component names, but responsibilities should be similarly separated.

---

# 8. Design Toolchain

## 8.1 Governing principle

Design tools must serve the real product architecture. They do not define product truth or business logic.

The preferred flow is:

```text
reference research
      ↓
UX architecture
      ↓
CarUp design principles
      ↓
high-fidelity visual concepts
      ↓
component / responsive mapping
      ↓
real React implementation
      ↓
browser visual review
      ↓
Playwright visual + functional certification
      ↓
refinement
```

## 8.2 OpenAI image generation

Use for:

- high-fidelity desktop Marketplace concepts;
- high-fidelity mobile Marketplace concepts;
- Vehicle Detail concepts;
- Trust / Passport presentation studies;
- Owner / Seller / Conversation component studies;
- competing visual directions before implementation.

Prompts must be constrained by real CarUp information architecture and contracts. Do not generate generic “car marketplace dashboard” imagery and then retrofit the product to it.

## 8.3 Higgsfield

Use primarily for:

- automotive brand imagery;
- hero scenes;
- campaign visuals;
- premium motion / video;
- launch and marketing treatments.

Higgsfield is not the canonical source of application layout, state semantics, or component architecture.

## 8.4 Figma — optional, assistant-operated if adopted

Figma is optional for this programme.

The owner is **not required to know Figma or manually construct Figma screens**.

If the Figma connector is installed and connected, the AI implementation agent is expected to operate the Figma workflow on the owner's behalf, including where supported:

- creating / editing design files;
- establishing pages / frames;
- maintaining component variants;
- documenting tokens;
- mapping desktop / tablet / mobile states;
- carrying approved concepts toward design-to-code handoff.

The owner remains responsible for product/design approval, not manual Figma operation.

Figma adoption gate:

```text
IF Figma materially improves reusable design-system governance
    → install/connect and use it as a durable design source
ELSE
    → use documented tokens + high-fidelity concepts + the real React application as the canonical design implementation
```

No implementation work is blocked while the Figma decision remains open.

## 8.5 Real React application is the final design authority

The production product is the executable design.

Desktop/web implementation must use the existing CarUp stack and real application data/contracts.

Reference review sizes should include at least:

```text
1440px desktop
1024px tablet
390px mobile viewport
```

The design process is not complete until the real implementation has been visually and functionally certified.

---

# 9. Mobile Product Strategy

## 9.1 Mobile is not desktop collapsed

Mobile CarUp should not be a desktop sidebar translated into smaller cards.

Mobile prioritization should usually be:

```text
Vehicle
Trust
Action
Conversation
History
```

with progressive disclosure.

## 9.2 Mobile interaction principles

Use where appropriate:

- bottom navigation;
- sticky primary actions;
- action sheets;
- full-screen filter / sort controls;
- large touch targets;
- swipeable image galleries;
- compact Trust summaries with expandable evidence;
- camera / document capture where native value exists;
- conversation-first interaction;
- safe deep-link recovery.

## 9.3 Canonical contract parity

Mobile must consume the same canonical Marketplace / Trust / reservation / Communications contracts as web.

Mobile must not:

- invent its own Trust score;
- assume `trust_score` is always numeric;
- derive availability from stale cached listing status;
- expose private identifiers absent from the public contract;
- substitute local business logic for backend projections.

The Marketplace Reliability lane must explicitly reconcile any remaining mobile type/UI assumptions against the final canonical contracts.

---

# 10. UX Design Phases

## Phase D0 — Existing-state capture

Before significant visual refactoring:

- capture current desktop/mobile Marketplace screenshots;
- document existing components and behavior;
- record current filter/search state contracts;
- record existing Playwright/unit tests;
- identify visual debt separately from functional defects.

## Phase D1 — Reference and interaction architecture

Produce:

- Marketplace information architecture;
- desktop search/discovery wire map;
- mobile search/discovery wire map;
- Vehicle Detail hierarchy;
- Trust / Passport progressive disclosure model;
- save / compare / inquiry / conversation action hierarchy.

## Phase D2 — Visual direction studies

Generate multiple high-fidelity alternatives using the approved CarUp principles.

Study dimensions include:

- listing-card density;
- image dominance;
- filter-panel density;
- Trust presentation;
- price hierarchy;
- seller summary;
- CTA placement;
- desktop vs mobile variation.

Select one coherent direction before broad implementation.

## Phase D3 — Reference component implementation

Implement real React components against existing live Marketplace contracts.

Do not hard-code prototype-only data into production surfaces.

## Phase D4 — Vehicle Detail / Trust convergence

Bring the selected design language into:

- Vehicle Detail;
- Vehicle Trust summary;
- Passport entry points;
- evidence/history preview;
- seller summary;
- inquiry / conversation transition.

## Phase D5 — Mobile parity

Implement equivalent native/mobile patterns without forcing desktop composition onto mobile.

## Phase D6 — Design-system extraction

After Marketplace proves the primitives in reality, extract and formalize reusable:

- tokens;
- typography;
- spacing;
- surfaces;
- buttons;
- form controls;
- status language;
- vehicle primitives;
- Trust primitives;
- evidence primitives;
- transaction primitives;
- responsive patterns.

## Phase D7 — Progressive propagation

Apply the proven mature language in subsequent product lanes such as:

- Owner Dashboard;
- Seller / Dealer inventory;
- Garage / Mechanic;
- PartSentry;
- Diaspora;
- Finance / Insurance;
- Admin;
- Communications.

Do not restyle every domain simultaneously.

---

# 11. Behavioral Preservation Contract for Marketplace UI Work

Before major Marketplace component restructuring, freeze tests around the behaviors below.

## 11.1 Search

Verify:

- free-text search;
- query persistence;
- debounce behavior;
- deep-link URL recovery;
- identifier / Passport lookup policy where applicable;
- public identifier privacy.

## 11.2 Filters

Verify:

- make;
- category / condition;
- stackable Trust tags;
- price range;
- active-filter chip removal;
- URL serialization / parsing;
- browser back / forward;
- mobile filter flow.

## 11.3 Sort

Verify:

- newest;
- price low/high;
- canonical Trust ordering;
- graceful fallback when canonical Trust ranking is unavailable.

## 11.4 Actions

Verify:

- save / unsave;
- guest favorites behavior;
- compare;
- share;
- inquiry;
- canonical conversation transition;
- reservation action where enabled.

## 11.5 Truth

Verify:

- unknown price does not become `$0`;
- unknown mileage does not become `0 km`;
- legacy/unversioned Trust does not become canonical score;
- private identifiers remain absent;
- draft/unpublished listings remain absent;
- seller identity is not fabricated;
- unavailable media is not treated as a successful empty read when the contract distinguishes those states.

---

# 12. Backend / Facet Evolution During UX Work

The current web UI supports more filter refinements than the backend natively guarantees at all scales.

The Marketplace Reliability lane must classify each facet as one of:

```text
SERVER-CANONICAL
CLIENT-REFINEMENT
DEFERRED
```

Candidate facets for server-canonicalization as inventory grows include:

- body type;
- fuel;
- transmission;
- location;
- year;
- mileage;
- seller type;
- availability;
- additional canonical Trust/evidence dimensions.

Do not move filters server-side purely for architectural preference. Use measurable product/scale need and ensure URL/API contracts remain deterministic.

---

# 13. Ownership Boundaries

## 13.1 Communications-owned

- communication routes/services;
- conversation lifecycle;
- participants;
- message persistence;
- delivery routing;
- email adapters/webhooks;
- reply tokens;
- delivery retry;
- communication preferences;
- Communications Command Center.

## 13.2 Marketplace-owned

- listing browse/search;
- listing detail;
- search/filter/sort state;
- Marketplace listing cards;
- saved listings;
- compare;
- seller listing management;
- listing publication UX;
- Marketplace reservation lifecycle presentation/actions;
- Marketplace-specific buyer/seller UX;
- Marketplace reference design components.

## 13.3 Canonical shared contracts — protected

Neither lane may casually fork:

- vehicle public projection;
- Trust decision contract;
- media publication contract;
- reservation/transaction authority;
- auth/session identity;
- global navigation registry;
- common design tokens once formalized.

## 13.4 Integrator-owned shared chokepoints

When both PRs need the same cross-cutting file, use an explicit integrator decision.

Examples:

- `App.tsx` / primary route tables;
- feature registry root;
- shared API client primitives;
- shared types;
- global navigation shell;
- root Tailwind/theme tokens;
- environment / CI workflow foundations.

---

# 14. Merge and Reconciliation Protocol

## 14.1 Independent progression

Each lane may progress independently through implementation and exact-head CI.

## 14.2 First merge

When one lane is ready:

1. exact-head tests pass;
2. exact-head security/static gates pass;
3. independent review passes where required;
4. staging/preview evidence is acceptable;
5. merge into `main`.

## 14.3 Second-lane mandatory reconciliation

The remaining open lane must then reconcile against the new `main` before merge.

Mandatory:

- update/rebase/merge current `main` using the approved repository workflow;
- resolve overlaps explicitly;
- rerun full lane tests;
- rerun shared integration tests;
- rerun Playwright for affected journeys;
- prove that the first lane's merged functionality remains intact.

The second PR is not certified based on tests from before the first PR merged.

---

# 15. Certification Model

## 15.1 Certification hierarchy

Every significant journey should progress through:

```text
unit / pure contract tests
      ↓
integration tests
      ↓
exact-head CI
      ↓
staging / preview runtime
      ↓
Playwright functional certification
      ↓
Playwright visual/responsive review
      ↓
physical owner UAT where needed
      ↓
short soak / observability
```

## 15.2 Playwright functional certification

Required Marketplace flows should include at minimum:

### Buyer

- load Marketplace;
- search;
- filter;
- sort;
- open detail;
- inspect Trust / Passport entry point;
- save;
- compare;
- create inquiry;
- reach canonical conversation;
- reserve where enabled.

### Seller

- open inventory;
- create/edit listing where in current scope;
- manage media;
- see publication state;
- publish/unpublish;
- receive inquiry;
- continue conversation;
- mark lifecycle state where allowed.

### Mobile

- discovery;
- filter/search;
- detail;
- Trust semantics;
- inquiry/conversation transition;
- safe responsive/native navigation.

## 15.3 Visual certification

Use Playwright screenshots / visual review to check:

- 1440 desktop;
- 1024 tablet;
- 390 mobile;
- loading state;
- empty state;
- error state;
- evaluated Trust;
- not-evaluated Trust;
- missing price/mileage;
- long seller / model strings;
- one-image/no-image/multi-image states;
- compare selection state;
- active filters;
- mobile drawers/sheets;
- conversation transition.

Visual certification does not mean pixel-perfect screenshot locking of every dynamic screen. It means high-value visual regressions are made observable and repeatable.

## 15.4 Accessibility baseline

Before controlled testers:

- keyboard navigation on web;
- visible focus states;
- semantic labels;
- sufficient contrast;
- touch targets appropriate on mobile;
- modal/drawer focus behavior;
- no essential status communicated by color alone.

---

# 16. Security / Reliability Gate Before First Testers

A tester journey must not expose an unresolved P0/P1 involving:

- cross-tenant access;
- private data exposure;
- account takeover;
- unauthenticated writes;
- secret/private-key exposure;
- false canonical Trust;
- serious data corruption;
- unintended money movement.

If a severe defect belongs to an externally gated feature outside the Core Beta Contract, disable/fail-close that feature rather than blocking all beta progress.

---

# 17. Core Beta Contract

Do not wait for every long-term CarUp integration before inviting controlled testers.

The first tester cohort should exercise a bounded, truthful product contract.

## Buyer

```text
browse
→ search/filter
→ detail
→ Trust / Passport
→ save / compare
→ inquire
→ communicate
→ reserve where safely enabled
```

## Seller / Dealer

```text
manage listing
→ media/evidence
→ publication state
→ publish/edit
→ receive inquiry
→ communicate
→ unpublish/sold
```

## Owner / Garage / Mechanic

These may be included only to the depth currently certified, and should become subsequent reliability lanes after Marketplace/Communications stabilize.

## Externally gated systems

SafeTrade live money movement, insurer/lender integrations, registry/government integrations, subscription billing and other partner-dependent functionality may remain:

- sandboxed;
- test-mode;
- disabled;
- “activation required”.

They should not be represented as live if they are not live.

---

# 18. Timeline to Controlled First Testers

Planning estimate after the dual-lane programme starts:

> **approximately 10–15 working days, with 3 calendar weeks as the safer planning target**, assuming no new P0/P1 blocker emerges.

Reference sequence:

## Week 1

- Communications / Email closure;
- Marketplace reliability baseline;
- Marketplace design direction selection;
- priority component implementation;
- high-severity defect containment.

## Week 2

- buyer/seller journey completion;
- reference Marketplace UX implementation;
- mobile parity fixes;
- cross-lane integration;
- Playwright functional certification;
- visual/responsive certification.

## Week 3

- 48-hour staging soak;
- owner UAT;
- bug fixes;
- final release-candidate proof;
- tester accounts / instructions;
- controlled cohort launch.

Do not compress the soak / UAT stage simply because CI is green.

---

# 19. Definition of Done — Lane A Communications

Lane A is done for the Core Beta Contract when:

- buyer↔seller conversation creation is durable;
- messages persist canonically;
- transport delivery is observable;
- retries/deduplication behave correctly;
- email presentation follows the canonical Email Experience plan;
- replies route into the same conversation;
- no duplicate parallel conversation is created accidentally;
- communication authorization is correct;
- user conversation UI is usable on desktop/mobile where in scope;
- failure states are explicit;
- Playwright / integration coverage passes;
- staging soak reveals no stuck/duplicate delivery defect.

---

# 20. Definition of Done — Lane B Marketplace

Lane B is done for the Core Beta Contract when:

- search/filter/sort contracts are reliable;
- existing advanced Marketplace behavior is preserved or intentionally improved;
- Marketplace public listings remain canonical/private-safe;
- evaluated and not-evaluated Trust render truthfully;
- save / compare / share work;
- inquiry is durable;
- buyer↔seller flow transitions into canonical Communications;
- seller publication lifecycle is reliable;
- mobile does not contradict canonical web/backend state;
- major screens implement the selected CarUp reference UX;
- accessibility baseline is met;
- Playwright functional and visual certification pass;
- no P0/P1 remains on the beta journey;
- 48-hour soak is clean enough for controlled testers.

---

# 21. Design-System Governance After Marketplace

Marketplace should not become a one-off redesign.

Once its reference components are proven, the programme must extract reusable design rules and move them into a formal CarUp Design System.

The system should document at minimum:

- color tokens;
- typography;
- spacing;
- radii;
- elevation;
- interactive states;
- form behavior;
- responsive breakpoints/patterns;
- vehicle identity patterns;
- Trust patterns;
- evidence patterns;
- status language;
- timeline patterns;
- transaction patterns;
- conversation patterns;
- empty/loading/error patterns;
- accessibility rules.

Future product lanes consume these components instead of inventing independent visual systems.

---

# 22. Figma Decision Record

At the time of this plan, Figma is **not required to begin**.

If adopted later:

- the owner does not need to manually operate Figma;
- the connected AI/design agent will be responsible for creating and maintaining design artifacts to the extent supported by the connector;
- Figma will serve design governance and handoff, not product truth;
- the real React/native implementation and certified behavior remain authoritative for the shipped product.

Decision options:

### Option A — Adopt Figma

Best when:

- component governance is becoming difficult in code alone;
- multiple product domains need coordinated visual work;
- design variants/responsive states benefit from a durable shared canvas.

### Option B — Do not adopt Figma yet

Use:

- documented design principles/tokens;
- OpenAI-generated high-fidelity concepts;
- Higgsfield for automotive brand/media;
- real React/native implementation;
- Playwright visual certification.

This option is fully valid and does not lower the engineering standard.

---

# 23. Permanent Guardrails

1. **Maximum two implementation write lanes.**
2. **Both lanes start from canonical `main`.**
3. **No parallel reimplementation of the same domain contract.**
4. **Communications owns conversation; Marketplace owns commerce/discovery.**
5. **Truth/Trust is consumed, not reinvented.**
6. **Design work may restructure presentation, not falsify data.**
7. **Unknown is an acceptable product state; fabrication is not.**
8. **Mobile uses canonical backend contracts.**
9. **Figma, if adopted, is assistant-operated; owner approval is required, owner manual design work is not.**
10. **The second PR to merge must re-certify against the first PR already on `main`.**
11. **No broad UI rewrite without behavioral regression coverage.**
12. **No external provider activation hidden inside a UI/design PR.**
13. **P0/P1 blocks tester exposure or the affected feature is fail-closed.**
14. **No mocks presented as real user data.**
15. **Visual polish is iterative; UX architecture begins now.**

---

# 24. Immediate Execution Sequence After Plan Approval

No runtime source changes begin until this plan is approved/canonized.

After approval:

## Step 1 — Establish exact starting `main`

Record:

- `main` SHA;
- open PR disposition;
- current Communications lane state;
- current Marketplace lane state;
- current staging deployments.

## Step 2 — Open/continue Lane A

Continue Communications / Email using its existing canonical architecture and plan.

## Step 3 — Open Lane B from current `main`

Create the Core Marketplace Buyer↔Seller Reliability + Reference UX implementation branch/PR.

## Step 4 — Freeze Marketplace behavioral baseline

Before broad visual refactor, prove the existing search/filter/sort/action contracts and add missing regression coverage.

## Step 5 — Produce design reference package

Create:

- current-state screenshots;
- UX architecture;
- reference benchmark notes;
- desktop concept alternatives;
- mobile concept alternatives;
- Vehicle Detail / Trust concept;
- component map.

## Step 6 — Owner selects direction

The owner selects the preferred CarUp reference UX direction. The owner is not required to operate design software.

## Step 7 — Implement in real application

Refactor Marketplace presentation/components while preserving the behavioral contract.

## Step 8 — Cross-lane integration

Marketplace inquiry/conversation seam is integrated through Communications-owned contracts.

## Step 9 — Exact-head certification

Run CI, integration, Playwright functional, visual/responsive and security checks.

## Step 10 — Controlled staging UAT + soak

Run owner UAT and minimum stability soak before the first tester cohort.

---

# 25. Final Operating Principle

The previous programme asked:

> **Which CarUp is real?**

The Truth / Trust programme asked:

> **Which vehicle facts are real, and which Trust result is authoritative?**

The next programme asks:

> **Can a real person use the one real CarUp confidently, quickly, and repeatedly — and can the interface make its underlying truthfulness visible?**

That is the purpose of Post-Reunification Dual-Lane Product Advancement and the CarUp Design System.

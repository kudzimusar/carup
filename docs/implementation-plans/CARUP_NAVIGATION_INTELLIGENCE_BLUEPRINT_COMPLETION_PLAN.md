# CarUp Navigation Intelligence Blueprint — Milestones 1–8 Completion Plan

## Document status

This document is the authoritative implementation and execution plan for completing the remaining CarUp Navigation Intelligence Blueprint.

It supersedes any narrower document that treats Marketplace URL intelligence, category coverage, or the Feature Registry foundation as the complete navigation system.

The implementation team must treat this file as the source of truth for the remaining work and must continue iterating until every mandatory acceptance gate is satisfied or a genuine external blocker requiring Product Owner judgment is documented.

This is not a documentation-only milestone. The expected outcome is one integrated, production-ready navigation system covering desktop top navigation, desktop footer navigation, mobile web navigation, route boundaries, lifecycle and rollout governance, the admin Feature Governance Console, automated validation, staging evidence, rollback instructions, and one final reviewable pull request.

---

# 1. Governing goal

CarUp must have one truthful, typed, auditable navigation and feature-governance system that controls all public and stakeholder discovery surfaces without replacing backend security.

The completed system must provide:

1. One structured source of truth for desktop top navigation, mega-menus, footer navigation, dashboard sidebars, user-menu destinations, and mobile web navigation.
2. Stable route and query construction for Marketplace filters and other deep links.
3. Truthful visibility rules for active, beta, planned, hidden, disabled, deprecated, role-limited, tenant-limited, environment-limited, and time-limited features.
4. Reusable frontend route boundaries for authentication, role eligibility, lifecycle state, and safe redirects.
5. Backend-persisted runtime rollout overrides with trusted authorization, validation, audit logging, safe failure behavior, and reset-to-default support.
6. An admin-only Feature Governance Console backed by real APIs and persistence.
7. Automated checks that detect dead links, registry drift, duplicate routes, invalid lifecycle metadata, hidden-route leakage, role leakage, unsafe runtime overrides, and frontend/backend manifest divergence.
8. Complete responsive, keyboard, accessibility, browser, staging, and Product Owner validation.
9. One final integration PR that stops before merge and provides exact implementation, migration, test, staging, security, performance, and rollback evidence.

The governing principle is:

```text
Feature Registry
→ truthful navigation placement
→ valid registered route
→ correct user and environment visibility
→ safe frontend route boundary
→ unchanged backend authorization
→ auditable runtime governance
→ tested user experience
```

---

# 2. Repository and execution boundary

Repository:

```text
https://github.com/kudzimusar/carup
```

Expected starting point:

```text
latest origin/main
```

Create one integration branch:

```text
codex/navigation-intelligence-blueprint-completion
```

Do not implement this programme on:

- `main`;
- `release/carup-v1-rc1`;
- the Marketplace v1 branch;
- any unrelated Diaspora, Evidence, Trust, mobile-app, or payment branch.

Open one final pull request:

```text
codex/navigation-intelligence-blueprint-completion → main
```

The final PR must remain unmerged until the Product Owner explicitly authorizes merge.

Multi-agent sub-branches and worktrees are permitted, but every subtask must converge into the single integration branch. The lead agent owns conflict resolution, test convergence, staging evidence, and the final report.

---

# 3. Current verified baseline

The implementation must begin by verifying the current repository state rather than reimplementing completed foundations.

## 3.1 Completed foundations

### Navigation cleanup

Merged PR #54 completed:

- duplicate route cleanup;
- authenticated versus unauthenticated link correction;
- Evidence Vault and Evidence Upload discoverability;
- navigation regression checks.

### Feature Registry foundation

Merged PR #55 completed:

- typed `web/src/config/featureRegistry.ts`;
- centralized role metadata;
- dashboard sidebar selectors;
- role-switch routing helpers;
- support for owner, dealer, mechanic, insurance, government, admin, and bank roles;
- registry documentation and tests.

### Public direct links and footer foundation

Merged PR #56 completed:

- public route registration;
- parameterized route matching;
- direct public desktop links sourced from the registry;
- footer Product, Company, Resources, and Stakeholder columns sourced from registry helpers;
- public/protected route helpers;
- route-mirroring tests.

### Route guard alignment and dead-link validation

Merged PR #57 completed:

- dashboard role-mismatch handling;
- registry-aware auth-layout detection;
- registry-based post-login dashboard routing;
- duplicate-route, dead-link, route-mirroring, public-nav, footer, and dashboard-root validation.

### Marketplace navigation truth substrate

The existing Marketplace Navigation Intelligence subsystem already provides:

- query parameters `q`, `make`, `category`, `tag`, `minPrice`, `maxPrice`, and `sort`;
- fixture exclusion;
- real-listing eligibility;
- safe Marketplace classification;
- coverage-gated navigation;
- environment-aware `VITE_API_URL` handling.

This subsystem must be preserved and consumed by the full navigation system. It is not the full Blueprint.

## 3.2 Incomplete current state

At programme start, agents must verify the following expected gaps:

- `Navbar.tsx` still contains static arrays for Buy, Sell, Verify, Parts, and More mega-menus.
- Several top-navigation items still route to generic destinations rather than governed deep links.
- Footer links are registry-sourced but do not yet use the full lifecycle, rollout, external-link, and accessibility model.
- Current `main` still contains a hardcoded mobile drawer.
- PR #66 contains an initial registry-driven mobile drawer, but is open, unmerged, and not production-complete.
- Mobile bottom tabs and native Expo shared navigation are outside the current web Blueprint unless discovery proves a safe existing shared surface.
- Route helper functions exist, but no complete shared lifecycle-aware route-boundary architecture exists.
- Registry metadata still relies on primitive `isPlanned` and `isHidden` flags.
- No production-grade backend rollout persistence exists.
- No admin Feature Governance Console exists.
- No final Blueprint-level staging, accessibility, rollback, and Product Owner acceptance evidence exists.

## 3.3 Required preflight commands

Before implementation:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

Then create the integration branch:

```bash
git checkout -b codex/navigation-intelligence-blueprint-completion
```

Record:

- main SHA;
- branch SHA;
- working-tree status;
- Node version;
- npm version;
- TypeScript version;
- current route count;
- current registry item count;
- current static navigation source count.

Do not proceed with unrelated modified or untracked application files.

---

# 4. Multi-agent execution model

Claude Code should use multiple agents or worktrees, but file ownership and integration order must be explicit.

## Lead agent — programme integrator

Owns:

- branch creation;
- discovery consolidation;
- architectural decisions;
- shared schema conflict resolution;
- integration sequence;
- complete regression execution;
- staging deployment coordination;
- final PR and completion report.

## Agent A — desktop top navigation and registry architecture

Owns primarily:

- `web/src/config/featureRegistry.ts` or extracted registry modules;
- structured navigation-placement types;
- Buy, Sell, Verify, Parts, Services/More migration;
- Marketplace coverage/deep-link integration;
- mega-menu unit and Playwright tests.

## Agent B — footer navigation

Owns primarily:

- `web/src/components/layout/Footer.tsx`;
- footer placements and selectors;
- internal versus external links;
- legal, stakeholder, social, responsive, and accessibility validation;
- footer tests.

## Agent C — mobile web navigation

Owns primarily:

- reconciliation or porting of PR #66;
- mobile drawer selectors and rendering;
- public/authenticated/all-seven-role behavior;
- mobile interaction and accessibility tests;
- tablet transition tests.

## Agent D — route boundaries and authentication regressions

Owns primarily:

- reusable route-boundary components;
- `App.tsx` integration;
- login, return-to, session restoration, role mismatch, hidden/disabled/planned/beta/deprecated direct access;
- route-boundary unit and Playwright tests.

## Agent E — feature lifecycle, backend governance, migration and APIs

Owns primarily:

- framework-neutral feature manifest;
- lifecycle and rollout model;
- database migration;
- backend service and evaluator;
- trusted admin APIs;
- caching, audit and failure behavior;
- backend tests.

## Agent F — Admin Feature Governance Console

Owns primarily:

- admin route and registry entry;
- feature list, search, filters, detail, mutation controls, confirmations, conflict handling and audit display;
- frontend integration and accessibility;
- console tests.

## Agent G — adversarial QA, CI, staging and release evidence

Owns primarily:

- dead-link and drift CI gates;
- security review;
- accessibility review;
- responsive matrix;
- bundle-size comparison;
- staging verification;
- rollback review;
- final evidence matrix.

## Coordination rule

Agents must not edit shared files concurrently without an agreed ownership window. Shared high-conflict files include:

- `web/src/config/featureRegistry.ts`;
- any extracted registry manifest/type modules;
- `web/src/App.tsx`;
- `web/src/components/layout/Navbar.tsx`;
- backend server route registration;
- package manifests and lockfiles.

The lead agent must sequence these edits and rebase or merge sub-branches before another agent begins conflicting work.

---

# 5. Mandatory discovery deliverable

Before application changes, create:

```text
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_DISCOVERY_MATRIX.md
```

The matrix must inventory every navigation surface and item.

Required columns:

| Surface | Parent menu | Section | Label | Current route | Query | Icon | Public/protected | Roles | Lifecycle | Coverage rule | Source file | Registry ID | Duplicate source | Intended action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Inventory at minimum:

- desktop logo/home;
- Buy mega-menu;
- Sell mega-menu;
- Verify mega-menu;
- Parts mega-menu;
- Services/More mega-menu;
- direct desktop links;
- user menu;
- role switcher;
- dashboard sidebars for seven roles;
- footer Product;
- footer Company;
- footer Resources;
- footer Stakeholders;
- footer legal links;
- social/external links;
- mobile public items;
- mobile role-specific items;
- mobile account actions;
- page-level contextual navigation;
- deep links with query parameters;
- coverage-gated Marketplace items;
- planned and deferred items;
- obsolete or duplicate routes.

The discovery report must also record:

- current `App.tsx` route patterns;
- current guard patterns;
- current registry item count;
- current hardcoded arrays;
- current external links;
- missing descriptions or icons;
- known route aliases;
- current test coverage;
- likely migration risks;
- ownership of each item.

No phase may be reported complete without updating this matrix to show the final source of truth.

---

# Milestone 1 — Scope correction, documentation and baseline convergence

## Objective

Establish the full Navigation Intelligence Blueprint as the authoritative workstream, preserve the Marketplace truth subsystem as a dependency, reconcile PR #66, and produce a clean implementation baseline.

## Required work

### 1. Correct feature documentation hierarchy

Do not delete valid Marketplace Navigation Intelligence documentation. Clarify its scope.

Required documentation structure:

```text
docs/features/NAVIGATION_INTELLIGENCE.md
```

must clearly state whether it documents only Marketplace truth/coverage behavior or the entire Blueprint. Prefer one of these approaches:

1. Rename or retitle it as Marketplace Navigation Truth and Coverage; or
2. Add an explicit opening scope notice linking to this master Blueprint plan.

Create or update:

```text
docs/navigation-intelligence/CARUP_NAVIGATION_INTELLIGENCE_ARCHITECTURE.md
```

This architecture document must explain:

- registry purpose;
- navigation surfaces;
- frontend visibility versus backend authorization;
- static metadata versus runtime override;
- Marketplace coverage integration;
- lifecycle model;
- route-boundary behavior;
- governance and audit model;
- contributor workflow.

### 2. Reconcile PR #66

Inspect PR #66 and decide by evidence whether to:

- merge its changes into the integration branch;
- port a corrected subset;
- supersede it with a cleaner implementation.

Preserve useful work:

- `mobile_nav` placement;
- `getMobileNavItems` concept;
- public versus authenticated filtering;
- role-aware entries;
- icon resolution;
- registry-driven drawer rendering.

Do not blindly merge stale conflicts.

Record the decision in:

```text
docs/navigation-intelligence/NAVIGATION_PR_RECONCILIATION.md
```

### 3. Establish regression baseline

Run before major changes:

```bash
npm run test:unit --workspace=web
npx tsc --noEmit --project web/tsconfig.app.json
npm run build
node backend/tests/run-tests.js
git diff --check
```

Run existing navigation Playwright suites according to current config and paths.

Record exact commands, exit codes, pass/fail/skip counts and warnings.

## Milestone 1 acceptance gate

- Discovery matrix exists.
- Scope documentation is corrected.
- PR #66 decision is documented.
- Current baseline tests are recorded.
- Integration branch is clean and pushed.
- No unrelated feature work is included.

---

# Milestone 2 — Complete desktop top navigation and mega-menus

## Objective

Replace all remaining hardcoded desktop mega-menu definitions with typed registry-backed navigation structures while preserving the existing visual identity and interaction behavior.

## 2.1 Registry navigation model

Extend the registry with a composable navigation-placement model.

A suitable model must support at least:

```ts
export type NavigationSurface =
  | 'navbar-direct'
  | 'navbar-mega-buy'
  | 'navbar-mega-sell'
  | 'navbar-mega-verify'
  | 'navbar-mega-parts'
  | 'navbar-mega-services'
  | 'navbar-more'
  | 'footer-product'
  | 'footer-company'
  | 'footer-resources'
  | 'footer-stakeholders'
  | 'footer-legal'
  | 'footer-social'
  | 'dashboard-sidebar'
  | 'user-menu'
  | 'mobile-primary'
  | 'mobile-secondary'
  | 'mobile-account';

export interface FeatureNavigationPlacement {
  surface: NavigationSurface;
  section?: string;
  sectionOrder?: number;
  order: number;
  labelOverride?: string;
  description?: string;
  icon?: LucideIconName;
  query?: Record<string, string>;
  badge?: string;
  external?: boolean;
  coverageRule?: MarketplaceCoverageRule;
  authDestination?: string;
  guestDestination?: string;
}
```

The final model may differ, but it must:

- remain serializable or bridgeable to a framework-neutral manifest;
- avoid React component instances in data;
- preserve stable feature IDs;
- support nested sections and deterministic ordering;
- support query strings without manual string concatenation;
- support auth-aware destinations safely;
- support coverage-gated destinations;
- distinguish internal routes from approved external links;
- represent planned and disabled items truthfully;
- prevent arbitrary callbacks in registry data.

## 2.2 Required selectors

Implement tested selectors or equivalent APIs:

- `getNavigationSections(surface, context)`;
- `getNavigationItems(surface, section, context)`;
- `getNavigationPlacements(featureId)`;
- `buildFeatureHref(feature, placement, context)`;
- `getDesktopMegaMenu(surface, context)`;
- `getFooterNavigation(section, context)`;
- `getMobileNavigation(context)`;
- `resolveFeatureVisibility(feature, context)`.

Context should include only what is needed:

- authentication state;
- role;
- tenant ID if available;
- environment;
- runtime effective-feature state;
- Marketplace coverage response;
- current time if lifecycle windows are active.

Selectors must be deterministic, side-effect free, and independently unit-tested.

## 2.3 Migrate every desktop menu

Migrate these `Navbar.tsx` sources:

- `buyMenu`;
- `sellMenu`;
- `verifyMenu`;
- `partsMenu`;
- `moreMenu`;
- direct registry links;
- any remaining user-menu route maps.

No duplicate static menu arrays may remain unless documented as a justified exception.

### Buy menu requirements

Every current item must be classified and implemented as one of:

- active deep link;
- coverage-gated deep link;
- governed tag requiring backend truth;
- planned/disabled item;
- generic safe fallback with an explicit reason.

At minimum review:

- Shop All Cars;
- Brand New Cars;
- Recently Imported;
- Locally Used;
- Second Hand Cars;
- Dealer Verified Cars;
- Passport Verified Cars;
- SUVs;
- Pickups;
- Hatchbacks;
- Sedans;
- Toyota;
- Honda;
- Mazda;
- Under USD 5,000;
- Under USD 10,000;
- Verify Before You Buy;
- View Vehicle Passport;
- Highest Trust Listings;
- PartSentry Checked Vehicles;
- Trust Guide links.

Never activate `passport_verified`, `partsentry_checked`, `brand_new`, or `second_hand` through heuristics that bypass their trusted evidence pipelines.

### Sell menu requirements

Preserve correct guest versus authenticated destinations for:

- Sell Your Car;
- Create Vehicle Passport;
- Dealer Listing;
- Sell as Private Owner;
- Start with Plate/VIN;
- Upload Vehicle Evidence;
- Add Service History;
- SafePay/Reservation readiness;
- parts/accessory selling;
- seller guidance.

A role must not be directed to a dashboard it cannot access. Guest users must receive safe registration or login destinations with a safe return path where appropriate.

### Verify menu requirements

Preserve and classify:

- plate search;
- VIN search;
- chassis search;
- vehicle Passport;
- ownership privacy summary;
- evidence timeline;
- duty signals;
- theft signals;
- odometer signals;
- PartSentry verification items.

Do not claim integrations as active when only a general search route exists. Use truthful descriptions and lifecycle states.

### Parts menu requirements

Review all routes for:

- Parts Marketplace;
- verified parts;
- engines;
- gearboxes;
- ECUs;
- body panels;
- lights;
- tyres and wheels;
- batteries;
- accessories;
- parts selling;
- garage inventory;
- mechanic catalog;
- PartSentry actions.

Unavailable category-specific inventory must not be presented as a working filtered experience unless the route and data contract exist.

### More/Services requirements

Review:

- Insurance;
- Pricing;
- Diaspora Trade;
- How It Works;
- Trust and Safety;
- Help;
- Contact;
- Blog;
- service and garage destinations.

Do not keep a placeholder route merely because it exists in the current array.

## 2.4 Preserve interaction and accessibility

The migrated top navigation must preserve or improve:

- sticky header behavior;
- visual design;
- menu widths and grid layout;
- hover/click behavior;
- keyboard opening;
- Escape closing;
- focus movement;
- focus return;
- arrow-key behavior supported by the component library;
- screen-reader labels;
- active-route state;
- query-aware active state;
- mobile/desktop breakpoint separation.

## 2.5 Tests

Add:

```text
web/src/config/featureRegistry.mega-menu.test.ts
tests/agents/29-navigation-mega-menu.spec.ts
```

Tests must prove:

- every prior menu and section renders;
- exact ordering is preserved unless a documented correction is approved;
- every active item resolves to the intended pathname and query;
- coverage-gated links activate and defer correctly;
- governed tags are not falsely activated;
- hidden and disabled items do not render;
- planned items are not presented as active;
- auth-aware destinations are correct;
- no duplicate static mega-menu definition remains;
- keyboard behavior remains functional;
- direct and deep-link refresh works.

## Milestone 2 acceptance gate

- All desktop mega-menus are registry-backed.
- Unsupported items are truthfully planned, disabled, or safely deferred.
- Marketplace coverage logic remains intact.
- No top-nav route points to fabricated functionality.
- Unit, TypeScript, build, and targeted Playwright tests pass.

---

# Milestone 3 — Complete desktop footer navigation

## Objective

Turn the existing registry-sourced footer into a complete, governed, accessible desktop and responsive footer system.

## Required work

### 3.1 Footer inventory and route audit

Audit every footer item:

- Product;
- Company;
- Resources;
- Stakeholders;
- legal links;
- contact information;
- social links;
- logo/home link.

Confirm each internal route exists, is registered, has the correct lifecycle state, and has the correct role/public policy.

### 3.2 Footer registry placements

Represent footer placement, order and section explicitly in the registry model rather than inferring all behavior from ID prefixes.

Retain prefix helpers only if they remain deterministic and tested.

### 3.3 Stakeholder behavior

Stakeholder links must:

- include all intended roles;
- exclude platform admin from public promotion unless explicitly desired;
- route unauthenticated users safely;
- avoid exposing internal-only tools;
- preserve role labels consistently.

### 3.4 External and social links

Remove placeholder `href="#"` behavior.

Each social link must be:

- a real approved URL;
- hidden/disabled until configured; or
- explicitly represented as planned.

External links must use safe attributes:

```text
target="_blank"
rel="noopener noreferrer"
```

when opening a new tab.

### 3.5 Lifecycle and runtime visibility

Footer selectors must apply:

- lifecycle state;
- runtime override;
- environment restrictions;
- role/tenant visibility where relevant;
- deprecation redirects;
- hidden and disabled exclusion.

### 3.6 Responsive and accessibility

Verify:

- desktop multi-column layout;
- tablet layout;
- narrow phone layout;
- logical heading order;
- keyboard access;
- descriptive labels for icon-only social links;
- visible focus;
- adequate contrast;
- no overflow;
- no duplicate link labels with ambiguous destinations.

### 3.7 Tests

Add footer-specific unit and browser tests proving:

- all active footer items are registry-backed;
- all internal routes exist;
- hidden/disabled/planned rules are respected;
- external-link safety attributes are present;
- stakeholder role mapping is correct;
- phone/tablet/desktop rendering works;
- keyboard navigation reaches every link.

## Milestone 3 acceptance gate

- Footer contains no placeholder destinations.
- Every item has a truthful state and source.
- Footer works across responsive breakpoints.
- Footer accessibility and route tests pass.

---

# Milestone 4 — Complete mobile web navigation

## Objective

Deliver one registry-driven, role-safe, responsive and accessible mobile web navigation system using the same feature metadata as desktop navigation.

## 4.1 Reconcile PR #66

Port or supersede its useful implementation after current-main review.

Do not merge stale code blindly.

## 4.2 Navigation composition

The mobile drawer must distinguish:

- public primary actions;
- public secondary/more actions;
- authenticated dashboard actions;
- role-specific feature actions;
- account actions;
- sign-in/register actions;
- role switching where supported;
- sign-out.

The drawer must use registry selectors and must not retain separate hardcoded route arrays.

## 4.3 Role matrix

Add explicit expected mobile items for:

- unauthenticated/public;
- owner;
- dealer;
- mechanic;
- insurance;
- government;
- admin;
- bank.

For each role verify:

- intended items are present;
- unrelated role items are absent;
- hidden features are absent;
- disabled features are absent;
- beta labels are accurate;
- planned items do not appear active;
- account actions are safe;
- dashboard root is correct.

## 4.4 Interaction behavior

Required:

- accessible trigger label;
- correct `aria-expanded`;
- drawer/dialog semantics;
- body/background interaction policy;
- focus moves into drawer;
- focus is trapped where appropriate;
- Escape closes;
- click outside closes if supported;
- focus returns to trigger;
- drawer closes after navigation;
- back/forward does not leave stale drawer state;
- role switch refreshes items;
- logout clears protected items;
- deep-link refresh renders correct state;
- current route uses `aria-current` or equivalent;
- touch targets are practical;
- long menus scroll.

## 4.5 Responsive matrix

Test at minimum:

- small iPhone;
- large iPhone;
- common Android phone;
- small tablet portrait;
- tablet landscape;
- desktop.

Verify clean transition between mobile drawer and desktop mega-menus.

## 4.6 Mobile bottom tabs and native navigation boundary

This web Blueprint does not automatically authorize a new native tab architecture.

During discovery:

- inspect the Expo/React Native navigation structure;
- identify whether existing bottom tabs duplicate registry metadata;
- document a safe shared-manifest strategy.

Implement native shared registry consumption only if it can be done without expanding the programme into a native navigation redesign. Otherwise create a precise follow-up plan and keep native mobile behavior unchanged.

Do not claim native Navigation Intelligence complete unless actual native screens consume the shared manifest and are tested.

## 4.7 Tests

Add a dedicated Playwright suite, for example:

```text
tests/agents/30-mobile-navigation-blueprint.spec.ts
```

Cover public plus all seven roles, duplicates, route existence, active state, close behavior, keyboard/focus behavior, responsive transitions and no role leakage.

## Milestone 4 acceptance gate

- Mobile drawer is fully registry-driven.
- Public and seven-role test matrix passes.
- No hidden or cross-role leakage exists.
- Accessibility and responsive checks pass.
- No duplicate mobile route source remains.

---

# Milestone 5 — Shared route boundaries and direct-access enforcement

## Objective

Centralize repeated frontend route-access logic while preserving explicit React Router declarations and keeping backend authorization authoritative.

## 5.1 Boundary architecture

Create small focused components or helpers equivalent to:

- `RegistryRouteBoundary`;
- `RequireAuthenticatedUser`;
- `RequireFrontendRole`;
- `FeatureAvailabilityBoundary`;
- `FeatureUnavailablePage`;
- `FeatureDisabledPage`;
- `FeaturePlannedPage`;
- `FeatureDeprecatedNotice`;
- `FeatureBetaNotice`.

Do not create one opaque component that mixes all behavior and becomes impossible to audit.

## 5.2 Evaluation order

A route boundary must evaluate safely:

1. Is authentication state still bootstrapping?
2. Is the route registered?
3. Is it public or protected?
4. Is authentication required?
5. Is the current role eligible?
6. Is the tenant eligible where applicable?
7. What is the effective lifecycle state?
8. Is the feature enabled in the current environment and time window?
9. Is a safe redirect, denial page, planned page, beta label or deprecation destination required?

## 5.3 Required behavior

- Public active route → render normally.
- Protected active route + no user → login with validated return-to.
- Protected active route + correct role → render.
- Protected active route + wrong role → explicit denial or safe dashboard route.
- Auth bootstrap → loading state, never premature redirect.
- Planned route → not promoted as active; direct access shows planned/unavailable state.
- Hidden route → absent from nav; direct-access policy documented and tested.
- Disabled route → safe unavailable state.
- Beta route → render with accurate beta notice when configured.
- Deprecated route → safe redirect or notice with target.
- Unknown route → existing not-found behavior.

Prevent redirect loops and unsafe open redirects.

## 5.4 Router integration

Keep `App.tsx` route declarations readable and explicit.

Use typed wrappers or helpers only where they improve consistency.

Do not generate the entire router from configuration if this hides route ownership or nested behavior.

## 5.5 Authentication regressions

Preserve:

- hard reload session restoration;
- login redirect;
- safe return-to;
- role switching;
- stale-session behavior;
- logout;
- CSRF behavior;
- current protected routes;
- existing backend authorization.

## 5.6 Tests

Add unit and Playwright coverage for:

- auth bootstrap;
- unauthenticated protected route;
- return-to sanitization;
- correct role;
- wrong role;
- public route;
- hidden route;
- planned route;
- disabled route;
- beta route;
- deprecated route;
- tenant-limited route;
- no redirect loop;
- browser refresh;
- role-switch transition.

## Milestone 5 acceptance gate

- Repeated frontend guard logic is centralized.
- Direct access and navigation visibility use the same effective-state decision.
- Existing active routes behave identically unless a documented bug is corrected.
- Auth and return-to regressions pass.

---

# Milestone 6 — Feature lifecycle, rollout persistence and backend governance

## Objective

Implement production-grade lifecycle and controlled rollout without weakening backend authorization or relying on unsafe client-only flags.

## 6.1 Lifecycle model

Define:

```ts
export type FeatureLifecycleState =
  | 'active'
  | 'beta'
  | 'planned'
  | 'hidden'
  | 'disabled'
  | 'deprecated';
```

Provide deterministic migration from `isPlanned` and `isHidden`.

No feature may have contradictory state.

## 6.2 Static versus runtime metadata

### Static code metadata

Must include:

- feature ID;
- label;
- route;
- domain;
- default lifecycle;
- default roles;
- navigation placements;
- icon;
- description;
- ownership/team;
- immutable security boundary references where useful;
- deprecation destination if code-defined.

### Runtime rollout override

May include:

- environment;
- enabled/disabled override;
- lifecycle override within permitted states;
- allowed roles within immutable constraints;
- allowed tenant IDs;
- denied tenant IDs;
- start and end times;
- beta message;
- reason;
- actor;
- version;
- timestamps.

A runtime override must never grant access broader than backend authorization or immutable static policy.

## 6.3 Framework-neutral manifest

The backend must not import browser-specific React modules.

Implement one of:

1. a shared framework-neutral TypeScript module;
2. a generated JSON manifest;
3. a validated generated server manifest.

CI must prevent silent drift between frontend navigation metadata and backend governance metadata.

## 6.4 Database migration

Create an idempotent migration following repository conventions, likely for:

```text
feature_rollout_overrides
```

Required fields:

- ID;
- feature ID;
- environment;
- lifecycle state;
- enabled state;
- allowed roles;
- allowed tenant IDs;
- denied tenant IDs;
- starts at;
- ends at;
- reason;
- created by;
- updated by;
- created at;
- updated at;
- version.

Required safeguards:

- unique/conflict constraints;
- indexes;
- valid lifecycle constraint;
- valid environment constraint;
- safe JSON/array validation;
- optimistic concurrency/versioning;
- service-role-only writes or equivalent backend-only access;
- RLS if client access is possible;
- no production migration before staging verification and approval.

## 6.5 Backend service

Create a dedicated service under a clear namespace, for example:

```text
backend/services/featureGovernance/featureGovernanceService.js
```

Responsibilities:

- load static manifest;
- validate feature IDs;
- load overrides;
- create/update/reset override;
- evaluate effective state;
- enforce immutable role limits;
- enforce environment and dates;
- enforce tenant allow/deny;
- handle version conflict;
- invalidate cache;
- emit audit event;
- sanitize user-facing effective-state output.

## 6.6 API surface

Implement routes consistent with project conventions, for example:

```text
GET    /api/features/effective
GET    /api/admin/features
GET    /api/admin/features/:featureId
PATCH  /api/admin/features/:featureId/rollout
DELETE /api/admin/features/:featureId/rollout
GET    /api/admin/features/:featureId/audit
```

Rules:

- writes require trusted server-derived platform admin authority;
- client-supplied role headers never grant access;
- ordinary users receive only sanitized effective state;
- internal reasons and tenant lists are not exposed publicly;
- tenant admins cannot mutate global policy unless separately designed and approved;
- invalid input returns safe 4xx responses;
- storage failure does not globally enable features.

## 6.7 Effective-state evaluator

Input:

- static feature metadata;
- runtime override;
- environment;
- authenticated role;
- tenant;
- current time;
- deterministic rollout key only if percentage rollout is implemented.

Output:

```ts
{
  featureId,
  state,
  enabled,
  visible,
  accessible,
  beta,
  reasonCode,
  deprecatedTo
}
```

Do not expose internal admin notes.

## 6.8 Caching and failure mode

Use a short bounded cache or request-level cache.

Required behavior:

- cache invalidates after mutation;
- database failure falls back safely to static defaults;
- disabled features do not become enabled because storage failed;
- structured warnings include correlation IDs without secrets;
- backend authorization remains unchanged.

## 6.9 Audit logging

Every mutation must record:

- actor user ID;
- trusted actor role;
- feature ID;
- previous state;
- next state;
- environment;
- reason;
- version;
- correlation ID;
- timestamp;
- request metadata according to existing audit patterns.

## 6.10 Tests

Backend tests must cover:

- admin read/write;
- non-admin denial;
- spoofed role denial;
- unknown feature;
- invalid lifecycle;
- invalid role;
- invalid tenant;
- immutable-role expansion denial;
- tenant allow/deny;
- date windows;
- version conflict;
- static fallback;
- storage failure fallback;
- cache invalidation;
- audit emission;
- sanitized effective-state response.

Frontend tests must cover effective-state integration with navigation and route boundaries.

## Milestone 6 acceptance gate

- Lifecycle is coherent and normalized.
- Runtime overrides persist in staging.
- Authorization and audit are proven.
- Effective state controls nav and direct access consistently.
- Safe fallback behavior is tested.

---

# Milestone 7 — Admin Feature Governance Console

## Objective

Provide an admin-only, accessible, auditable interface for inspecting the Feature Registry and managing permitted runtime rollout overrides.

## 7.1 Route and registry entry

Add:

```text
/admin/features
```

Register it as:

- protected;
- platform-admin only;
- active;
- admin dashboard placement;
- labelled `Feature Governance`;
- absent from non-admin navigation.

Backend authority must independently enforce access.

## 7.2 Console list

Display:

- feature ID;
- label;
- route;
- domain;
- static lifecycle;
- effective lifecycle;
- enabled state;
- navigation surfaces;
- static roles;
- runtime roles;
- environment;
- tenant restrictions;
- start/end times;
- beta/deprecation information;
- last updated by;
- last updated at;
- override status.

## 7.3 Filtering

Support:

- search by ID, label or route;
- lifecycle;
- domain;
- navigation surface;
- role;
- environment;
- overridden/default;
- tenant-limited;
- deprecated;
- disabled.

## 7.4 Detail view

Provide a read-only detail view before mutation.

Show:

- static metadata;
- current override;
- effective result by context;
- audit history;
- immutable constraints;
- affected navigation surfaces;
- affected roles/tenants;
- current version.

## 7.5 Mutations

Admin may:

- enable or disable within permitted policy;
- mark beta;
- schedule start/end;
- set tenant allow/deny;
- restrict roles within immutable bounds;
- set reason;
- set deprecation destination where permitted;
- reset override to static default.

Admin may not:

- edit feature ID;
- edit code-defined route;
- create arbitrary routes;
- grant broader access than backend policy;
- bypass tenant isolation;
- remove immutable audit history.

## 7.6 Confirmation and concurrency

Require explicit confirmation for:

- disabling active production feature;
- deprecating feature;
- changing global visibility;
- removing tenant access;
- resetting override.

Show before/after state, environment, roles, tenants and reason.

Use version checking to prevent stale overwrite.

## 7.7 UX states

Implement:

- loading;
- empty;
- API/storage error;
- permission denied;
- stale-version conflict;
- success feedback;
- reset feedback;
- audit loading/error;
- responsive table/card mode.

Do not fabricate metrics.

## 7.8 Accessibility

Required:

- labelled filters and controls;
- keyboard-accessible table/cards;
- focus-managed dialogs;
- status not conveyed only by color;
- error association;
- confirmation wording;
- responsive usable layout.

## 7.9 Tests

Backend/API:

- admin read/write;
- non-admin denied;
- spoofed role denied;
- audit created;
- version conflict;
- invalid payload;
- missing feature;
- reset override.

Frontend/unit:

- list renders;
- filters work;
- detail renders;
- form validates;
- confirmation required;
- conflict/error states;
- non-admin nav exclusion.

Playwright:

- admin opens console;
- searches/filters;
- opens detail;
- creates staging override;
- observes navigation change;
- observes direct-route behavior;
- views audit;
- resets override;
- non-admin direct access denied;
- static default restored.

## Milestone 7 acceptance gate

- Console uses real persistence and APIs.
- Only trusted admins can mutate.
- All changes are auditable and conflict-safe.
- Navigation responds correctly to staging overrides.
- Accessibility and E2E tests pass.

---

# Milestone 8 — Final convergence, staging, Product Owner UAT and production readiness

## Objective

Converge all navigation work, prove it in production-equivalent staging, prepare rollback, and stop at one merge-ready PR awaiting explicit approval.

## 8.1 Integration cleanup

Confirm the final branch contains intentional changes only.

Remove:

- obsolete hardcoded navigation arrays;
- duplicate route maps;
- temporary flags;
- local diagnostics;
- generated logs;
- screenshots outside approved artifacts;
- stale compatibility code no longer required.

Do not remove compatibility logic still needed by active consumers.

## 8.2 CI gates

CI must fail for:

- active route absent from router;
- duplicate active route pattern;
- active nav item with no route;
- invalid navigation surface;
- invalid lifecycle state;
- missing dashboard root;
- hidden/disabled item exposed;
- auth-required item exposed publicly;
- invalid icon;
- duplicate menu order within a section;
- dead internal link;
- unsafe external link;
- frontend/backend manifest drift;
- override for unknown feature;
- unauthorized governance mutation;
- missing audit event;
- migration/service change without tests.

Prefer fast unit validation for structural checks rather than browser tests.

## 8.3 Full test matrix

Discover current scripts, then run at minimum:

```bash
npm ci
npm run test:unit --workspace=web
npx tsc --noEmit --project web/tsconfig.app.json
npm run build
node backend/tests/run-tests.js
git diff --check
```

Run existing navigation tests and all newly added Blueprint tests.

Expected suites include or replace with current equivalents:

```text
tests/agents/27-feature-registry-navigation-map.spec.ts
tests/agents/28-feature-registry-public-nav-access.spec.ts
tests/agents/29-navigation-mega-menu.spec.ts
tests/agents/30-mobile-navigation-blueprint.spec.ts
tests/agents/31-navigation-route-boundary.spec.ts
tests/agents/32-feature-governance-console.spec.ts
```

Also rerun critical auth, Marketplace navigation, Diaspora, Evidence and role-switch regressions affected by shared navigation and guards.

Report exact command, exit code, pass/fail/skip count, duration and warnings.

## 8.4 Performance

Measure before/after:

- main JS bundle size;
- registry module size;
- navigation render cost where meaningful;
- governance API latency;
- cache behavior;
- number of blocking requests before public page render.

Do not add a blocking governance API dependency before rendering public navigation if static defaults can render safely and runtime state can hydrate without misleading users.

Document bundle impact and mitigation.

## 8.5 Staging deployment

Deploy frontend and backend from the same integration branch/SHA.

Apply the governance migration to staging only.

Verify:

- staging frontend calls staging backend;
- staging backend uses staging Supabase;
- no production writes;
- static defaults render when no override exists;
- admin API authorization;
- non-admin denial;
- override creation;
- nav visibility update;
- direct-route boundary update;
- audit record;
- override reset;
- cache invalidation;
- desktop top nav;
- footer;
- mobile drawer;
- all seven roles;
- login/return-to;
- role switching;
- Marketplace coverage-gated links;
- deep-link refresh;
- tablet transition;
- accessibility smoke.

## 8.6 Product Owner UAT document

Create:

```text
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_UAT_CHECKLIST.md
```

The checklist must provide exact URLs, roles, credentials source instructions without secrets, steps, expected behavior, actual result, screenshot field and pass/fail field.

Include:

- desktop Buy, Sell, Verify, Parts and More menus;
- footer sections;
- public mobile drawer;
- seven authenticated roles;
- hidden/planned/disabled/beta/deprecated behavior;
- direct-route denial;
- admin governance console;
- staging override and reset;
- role switch;
- logout;
- refresh/back/forward;
- phone/tablet/desktop;
- keyboard and focus behavior.

## 8.7 Rollback plan

Create:

```text
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_ROLLBACK_RUNBOOK.md
```

Cover:

- reverting frontend registry changes;
- restoring previous Navbar/Footer behavior;
- disabling governance console route;
- resetting all runtime overrides;
- invalidating cache;
- rolling back migration when safe;
- restoring static defaults;
- deployment rollback;
- verification after rollback.

## 8.8 Final PR

Open one PR to `main`.

Title:

```text
feat(nav): complete CarUp Navigation Intelligence Blueprint
```

PR body must include:

1. baseline and problem statement;
2. milestone-by-milestone completion;
3. files changed by subsystem;
4. registry model changes;
5. every migrated navigation surface;
6. route-boundary behavior;
7. lifecycle and rollout model;
8. migration and API details;
9. governance console capability;
10. authorization and audit guarantees;
11. tests and exact results;
12. Vercel previews;
13. staging migration and smoke evidence;
14. accessibility evidence;
15. performance impact;
16. Product Owner UAT status;
17. rollback procedure;
18. known limitations;
19. intentionally deferred native/mobile items;
20. explicit statement that the PR is not merged.

## Milestone 8 acceptance gate

- Full regression is green.
- Staging verification is complete.
- UAT checklist is complete or remaining blockers are explicit.
- Rollback is documented and proven operationally where feasible.
- One reviewable PR is open.
- No automatic merge occurred.

---

# 6. Security and truthfulness rules

These rules apply to every milestone.

1. The Feature Registry controls frontend discovery and experience; it does not replace Express authorization, service ownership checks, tenant isolation, RLS, trust enforcement, evidence enforcement, payment enforcement, document access or shipment access.
2. Client-supplied roles or headers never grant governance authority.
3. Hidden, disabled and planned features must not appear active.
4. Beta features must be labelled accurately.
5. Runtime override failure must not enable a disabled feature.
6. Marketplace coverage must use real public-eligibility rules and must exclude fixtures.
7. Governed trust tags must not be activated by unsafe heuristics.
8. External links must be explicitly classified and safe.
9. No secret, `.env` value, database URL, service-role key, local brain file or absolute local path may be committed.
10. No production migration or governance change occurs without separate approval.
11. No unrelated visual redesign or product overhaul is authorized.
12. Do not delete tests, weaken assertions, add broad TypeScript suppression or bypass failing security checks to obtain a green build.

---

# 7. Mandatory stop conditions

Stop the programme and report evidence if:

- a change would weaken backend authorization;
- route ownership is ambiguous and cannot be resolved from code and product intent;
- an active feature has no real route or implementation and Product Owner intent is required;
- lifecycle implementation would expose a planned or disabled feature;
- a governance API trusts client-supplied role authority;
- a migration is destructive or affects unexpected rows;
- production credentials or production data are required for testing;
- frontend and backend manifests cannot be reconciled safely;
- a phase requires rewriting unrelated authentication or routing architecture;
- test failures reveal conflicting business rules between existing features;
- more scope is required than this Blueprint authorizes;
- staging points to production services;
- a critical accessibility or role-leakage defect remains;
- required tests still fail after focused remediation.

A stop report must include:

- exact blocker;
- evidence;
- affected milestone;
- impacted files and users;
- safest options;
- recommended decision;
- work already completed;
- rollback status.

Do not stop merely because the task is large or because one agent finished its assigned slice.

---

# 8. Definition of Done

The Navigation Intelligence Blueprint is complete only when all statements below are true.

## Architecture

- One typed registry/manifest governs every intended navigation surface.
- Desktop mega-menus no longer depend on duplicate local arrays.
- Footer is fully governed.
- Mobile web navigation is fully governed.
- Dashboard and user-menu routing remain governed.
- Frontend and backend manifests cannot drift silently.
- Route declarations remain auditable.

## Functionality

- Buy, Sell, Verify, Parts and More menus are truthful and functional.
- Footer links are valid and lifecycle-aware.
- Public and seven-role mobile navigation is correct.
- Marketplace coverage gates still work.
- Query deep links preserve exact URL state.
- Auth, role, tenant and lifecycle direct-access behavior is consistent.
- Active, beta, planned, hidden, disabled and deprecated states work.
- Runtime overrides work by environment, role, tenant and time.
- Reset to static default works.

## Governance

- Trusted admins can inspect and mutate permitted rollout state.
- Non-admin and spoofed-role attempts are denied.
- Version conflicts are safe.
- Every change is audited.
- Internal governance data is not exposed publicly.

## Quality

- TypeScript passes.
- Build passes.
- Unit tests pass.
- Backend tests pass.
- Existing registry/navigation E2E passes.
- New desktop, footer, mobile, boundary and console E2E passes.
- Critical auth, Marketplace, Diaspora and Evidence regressions pass.
- Accessibility checks pass.
- Responsive checks pass.
- `git diff --check` passes.
- Vercel checks are green.
- Bundle impact is documented.

## Delivery

- Discovery matrix is complete.
- Architecture documentation is current.
- UAT checklist is complete.
- Rollback runbook exists.
- Staging evidence exists.
- One final PR is open against `main`.
- The PR is not merged automatically.
- Product Owner receives a precise completion report and test guide.

---

# 9. Required agent progress report after every loop

After each loop, report:

1. Current milestone and sub-goal.
2. Agents/worktrees used.
3. Files changed.
4. Architectural decisions.
5. Tests run and exact results.
6. Acceptance criteria completed.
7. Remaining acceptance criteria.
8. Defects found and fixed.
9. Security/accessibility risks.
10. Merge conflicts or cross-agent coordination issues.
11. Next loop target.
12. Whether any stop condition was reached.

Commit logical, reviewable checkpoints. Push the integration branch regularly. Do not open multiple competing final PRs.

---

# 10. Exact Claude Code `/goal` instruction

```text
/goal

You are working only in the CarUp repository:
https://github.com/kudzimusar/carup

Authoritative implementation plan:
docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md

Complete the remaining CarUp Navigation Intelligence Blueprint Milestones 1 through 8 as one coordinated production-grade programme.

The goal is not merely to improve Marketplace filters or add a Feature Registry. The final system must complete desktop top navigation and all mega-menus, finish the desktop footer, finish registry-driven mobile web navigation, centralize route boundaries, implement feature lifecycle and controlled rollout persistence, build the admin Feature Governance Console, add CI and security gates, prove responsive and accessible behavior in staging, produce UAT and rollback documentation, and open one fully tested final PR.

Use multiple agents or isolated worktrees according to the ownership model in the plan. Start from latest main and create:
codex/navigation-intelligence-blueprint-completion

Treat the repository plan as the source of truth. Inspect every file, PR, route, menu and test named by the plan rather than assuming prior knowledge.

Do not work on main.
Do not work on release/carup-v1-rc1.
Do not merge automatically.
Do not weaken backend authorization.
Do not expose hidden, disabled or planned features as active.
Do not use production data or credentials for tests.
Do not stop at documentation, scaffolding or a partial mobile drawer.

Continue until every Definition of Done item is satisfied or a genuine external Product Owner decision is required.
```

---

# 11. Exact Claude Code `/loop` instruction

```text
/loop

Continue executing docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md until Milestones 1 through 8 and the final Definition of Done are complete.

For each loop:

1. Inspect current branch, git status, recent commits and unresolved agent work.
2. State the exact current milestone and smallest complete vertical sub-goal.
3. Assign agents or worktrees with explicit file ownership.
4. Implement the sub-goal completely across registry, UI, routing, backend, database, tests and docs where required.
5. Review the diff for scope, truthfulness, authorization, hidden-route leakage, role leakage, accessibility and responsive behavior.
6. Run focused tests.
7. Fix failures before proceeding.
8. Run relevant regressions.
9. Commit and push a logical checkpoint.
10. Update the discovery matrix and completion evidence.
11. Report completed criteria, remaining criteria, blockers and the next loop target.

Do not stop because one agent finished, because files exist, because unit tests alone pass, or because a preview deployed.

Stop only when:
- every mandatory acceptance gate is complete and one final PR is ready for explicit Product Owner review; or
- a genuine stop condition in the plan requires human judgment.

Never merge automatically.
```

---

# 12. Required final completion report

Claude Code must return:

1. final PR URL;
2. integration branch;
3. base main SHA;
4. final head SHA;
5. milestone 1–8 completion matrix;
6. agents/worktrees used;
7. exact files changed by subsystem;
8. navigation surfaces migrated;
9. items intentionally planned, disabled or deferred;
10. registry and manifest model changes;
11. route-boundary behavior;
12. lifecycle and rollout rules;
13. migration details;
14. APIs added;
15. authorization and audit controls;
16. admin console capabilities;
17. tests added;
18. exact commands and results;
19. Vercel preview URLs and SHAs;
20. staging migration and smoke evidence;
21. Product Owner UAT status;
22. accessibility and responsive results;
23. bundle-size and performance impact;
24. rollback procedure;
25. known limitations;
26. explicit merge recommendation;
27. explicit confirmation that no automatic merge occurred.

A phase must not be described as complete merely because code was written. Completion requires integrated behavior and evidence.

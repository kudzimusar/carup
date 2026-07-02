# CarUp Navigation Intelligence — Full-Completion Fast-Track Plan

## Document status

This document extends:

`docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md`

It authorizes the final completion pass for the Navigation Intelligence feature on:

- Repository: `https://github.com/kudzimusar/carup`
- Branch: `codex/navigation-intelligence-blueprint-completion`
- Pull request: `#94 — feat(nav): complete CarUp Navigation Intelligence Blueprint`

Continue on the existing branch and PR. Push logical checkpoints as work converges. Do not work directly on `main`. Do not merge automatically.

---

# 1. Final programme goal

Finish Navigation Intelligence as the discovery and routing engine across:

```text
shared feature truth
→ desktop navigation
→ mobile web navigation
→ native Expo navigation
→ direct-route enforcement
→ controlled rollout
→ usage analytics
→ accessible interaction
→ auditable administration
```

The six previously deferred implementation areas are now in scope:

1. Native Expo bottom-tab conversion.
2. Native Expo drawer conversion.
3. Lazy-loading the Admin Feature Governance Console.
4. Further visual and interaction polish.
5. Additional navigation analytics.
6. Advanced deterministic percentage rollout controls.
7. Broad non-critical web/native accessibility refinements.
8. Final CI, staging, documentation, and PR evidence.

Fast-track means completing all workstreams in one coordinated programme. It does not permit:

- fake native routes;
- weakened backend authorization;
- personal-data-heavy analytics;
- unstable per-request rollout assignment;
- production-first migrations;
- deletion or weakening of tests;
- automatic merge.

---

# 2. Multi-agent execution model

Use multiple agents or isolated worktrees with explicit ownership.

## Lead agent — programme integrator

Owns:

- branch and PR state;
- architecture decisions;
- shared contract changes;
- conflict resolution;
- integration order;
- complete regression;
- staging evidence;
- PR body and final report.

## Native navigation agent

Owns primarily:

- `mobile/app/_layout.tsx`
- `mobile/app/(tabs)/_layout.tsx`
- native feature manifest adapter
- native route ownership
- native route boundary
- bottom tabs
- drawer
- native navigation tests

## Web UX and performance agent

Owns primarily:

- lazy loading the governance console
- route loading/error/retry states
- desktop mega-menu polish
- mobile web drawer polish
- footer/sidebar polish
- bundle comparison

## Analytics agent

Owns primarily:

- event taxonomy
- analytics migration
- backend ingestion and aggregation
- web analytics client
- native analytics client
- admin analytics panel
- analytics tests

## Rollout agent

Owns primarily:

- percentage schema
- deterministic assignment
- effective-state evaluator changes
- API validation
- Admin Console controls
- audit behavior
- rollout tests

## Accessibility and QA agent

Owns primarily:

- automated accessibility testing
- keyboard/focus behavior
- screen-reader semantics
- touch targets
- reduced motion
- native accessibility
- adversarial review
- final evidence

## Shared-file coordination

Serialize changes to:

- `web/src/App.tsx`
- `web/src/config/featureRegistry.ts`
- `web/src/config/navigationManifest.ts`
- `web/src/context/FeatureGovernanceContext.tsx`
- `backend/services/featureGovernance/featureGovernanceService.js`
- `backend/routes/featureGovernanceRoutes.js`
- `backend/server.js`
- `mobile/app/_layout.tsx`
- `mobile/app/(tabs)/_layout.tsx`
- package manifests
- database migrations

---

# 3. Mandatory discovery deliverable

Before implementation, create:

`docs/navigation-intelligence/NAVIGATION_FULL_COMPLETION_DISCOVERY.md`

It must record:

## Native route inventory

For every route under `mobile/app`:

- Expo route
- screen purpose
- owning feature ID
- public/protected
- supported roles
- current tab/drawer placement
- intended tab/drawer placement
- whether a real native screen exists
- web equivalent
- lifecycle state
- deep-link behavior

No missing native screen may be represented as active.

## Web performance inventory

Record:

- initial main bundle size
- governance console contribution
- current eager imports
- current loading/error behavior
- candidate chunk boundaries

## Analytics inventory

Record:

- existing request telemetry
- operations metrics
- audit-log conventions
- relevant tables/services
- route patterns suitable for aggregate analytics
- data minimization and retention constraints

## Rollout inventory

Record:

- current `feature_rollout_overrides` schema
- current effective-state evaluator
- cache behavior
- authenticated context
- anonymous web context
- native context
- Admin Console mutation model

## Accessibility inventory

Audit:

- desktop header and mega-menus
- mobile web drawer
- footer
- dashboard sidebar
- lifecycle state pages
- Governance Console
- native tabs
- native drawer
- native headers

Classify findings:

- release blocker
- high-value fast fix
- non-blocking polish
- intentionally deferred

---

# Milestone A — Native Expo feature-manifest foundation

## Objective

Make native navigation consume the same governed feature truth without importing browser-specific components.

## Required files

Create or equivalent:

```text
mobile/navigation/types.ts
mobile/navigation/featureManifest.ts
mobile/navigation/nativeNavigationManifest.ts
mobile/navigation/featureIcons.tsx
mobile/navigation/evaluateNativeRouteAccess.ts
mobile/components/navigation/NativeFeatureBoundary.tsx
mobile/utils/featureGovernanceApi.ts
mobile/store/featureGovernanceStore.ts
```

## Requirements

- Consume `shared/navigation/feature-manifest.json`.
- Validate manifest shape.
- Map feature IDs explicitly to Expo routes.
- Map icon names to native icons.
- Classify tab versus drawer placement.
- Apply authentication, role, lifecycle, and backend effective state.
- Refresh after login, logout, and role switch.
- Use the canonical mobile API base resolver.
- Remove hardcoded production `localhost` usage from mobile auth/navigation paths.
- Preserve static defaults when governance API is temporarily unavailable.
- Hide or block features with no native screen.
- Validate every exposed native route exists.
- Avoid browser-only imports.

## Native route-boundary states

Support:

- loading
- public active
- protected anonymous
- wrong role
- planned
- hidden
- disabled
- beta
- deprecated
- backend inaccessible
- native implementation unavailable

## Acceptance

- Native-safe adapter exists.
- Every active native entry has an explicit feature owner.
- No dead native route.
- Login/logout/role switch refreshes native effective state.
- Mobile TypeScript passes.

---

# Milestone B — Native Expo bottom tabs

## Objective

Replace the static bottom-tab list with governed role-aware tabs.

## Tab limit

Maximum five visible slots:

```text
Home or Dashboard
Marketplace or Discover
Primary supported work area
Referrals or Activity
More
```

## Role matrices

Define tested tab sets for:

- anonymous/public
- owner
- dealer
- mechanic
- insurance
- government
- admin
- bank

Only real native screens may appear.

A role without a native-specific work screen must use a real generic Dashboard or expose supported routes through More/Drawer. Do not create a decorative empty page merely to satisfy the tab matrix.

## Required behavior

- lifecycle and backend state filtering
- role-aware visibility
- logout removes protected tabs
- role switch updates tabs
- beta badge where supported
- planned/hidden/disabled/unsupported tabs absent
- deep-link route boundary
- safe-area support
- keyboard-safe layout
- Android navigation-bar spacing
- iPhone home-indicator spacing
- readable labels and consistent icons

## Tests

- public and all role tab sets
- maximum five visible tabs
- hidden/disabled/role-denied exclusion
- beta state
- logout
- role switch
- missing native route
- route ownership
- deep links

---

# Milestone C — Native Expo drawer

## Objective

Provide governed access to supported secondary native routes.

## Implementation

Choose the smallest compatible option:

1. Expo Router drawer with compatible navigation dependencies; or
2. Controlled custom drawer using existing gesture/reanimated support.

Document the decision in:

`docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md`

## Suggested sections

- Discover
- My Work
- Trust and Verification
- Account
- Support

## Required behavior

- public versus authenticated content
- role-aware and lifecycle-aware content
- current route state
- closes after navigation
- Android Back closes drawer first
- role switch/logout refresh
- long-menu scrolling
- safe-area support
- screen-reader labels
- practical touch targets
- no web-only route leakage
- no unintended tab/drawer duplication
- More tab opens the drawer or a predictable native navigation hub

## Tests

- public plus all roles
- hidden/disabled/role-denied exclusion
- active route
- close after selection
- Android Back where testable
- logout and role switch
- missing route exclusion
- tab/drawer duplication

---

# Milestone D — Lazy Admin Feature Governance Console

## Objective

Remove the console from the initial web chunk without changing authorization.

## Required changes

- Replace eager import in `web/src/App.tsx` with route-level lazy loading.
- Add reusable loading state.
- Add retryable chunk-error state.
- Preserve direct `/admin/features` refresh.
- Ensure authorization runs before protected content appears.
- Preload only for a verified admin, optionally on hover/focus or idle.
- Preserve current console tests.

## Evidence

Record:

- main bundle raw/gzip before
- main bundle raw/gzip after
- governance console chunk size
- build warnings
- direct-route load behavior

## CI

Add a stable assertion that the console is a separate chunk without hardcoding a hashed filename.

---

# Milestone E — Visual and interaction polish

## Principle

Polish the current CarUp navy/orange system. Do not redesign the product.

## Desktop mega-menus

Improve:

- spacing and alignment
- section hierarchy
- descriptions and icons
- query-aware active state
- planned/beta badges
- focus and hover states
- open/close consistency
- viewport collision
- long labels
- loading stability
- reduced layout shift

## Mobile web drawer

Improve:

- logo/header
- current role context
- section grouping
- active state
- touch targets
- scrolling
- account actions
- planned/beta labels
- focus/overlay transitions
- safe areas

## Footer and sidebar

Improve:

- responsive hierarchy
- focus states
- legal/stakeholder clarity
- active item clarity
- role label
- badge consistency
- narrow-screen behavior

## Governance Console

Improve:

- list density
- filter grouping
- lifecycle badges
- before/after mutation summary
- percentage rollout controls
- analytics panel
- loading/error/empty/conflict states
- tablet/mobile layout

## Lifecycle pages

Improve:

- planned
- disabled
- unavailable
- deprecated
- beta
- not found

Each should provide a safe next action.

## Native

Polish tabs and drawer using native platform conventions.

## Evidence

Capture lightweight screenshots or CI artifacts for:

- desktop menus
- mobile web drawer
- footer
- governance console
- lifecycle page
- native tabs
- native drawer

---

# Milestone F — Navigation analytics

## Objective

Measure discovery and navigation without collecting unnecessary personal data.

## Event taxonomy

Versioned events:

```text
navigation_surface_opened
navigation_item_impression
navigation_item_selected
navigation_destination_rendered
navigation_destination_blocked
navigation_role_switched
navigation_drawer_opened
navigation_tab_selected
navigation_error
```

## Allowed fields

- schema version
- event type
- feature ID
- node ID
- surface
- registered source route pattern
- registered destination route pattern
- platform
- coarse role category
- lifecycle/reason code
- build version
- timestamp

## Excluded fields

Do not store:

- names
- email
- phone
- VIN
- tokens
- unrestricted free text
- raw tenant identifiers
- unnecessary device identifiers

## Persistence

Add a staging-first migration with:

- RLS enabled
- backend-only writes
- no direct public table writes
- indexes for time, feature, type, surface, platform
- retention documentation
- no required raw user identity

## Backend ingestion

Add bounded batch ingestion.

Requirements:

- allowlisted schema
- event-count limit
- payload-size limit
- rate limiting
- route-pattern sanitization
- trusted role derivation when authenticated
- duplicate/idempotency handling
- fast response
- analytics failure never blocks navigation

## Admin aggregates

Add admin-only aggregate APIs for:

- impressions
- selections
- destination renders
- blocked attempts
- selection-through rate
- platform split
- role-category split
- top surfaces
- zero-selection items
- date range

## Web client

- bounded queue
- timed batches
- safe page-hide flush
- capped retry
- offline bounds
- duplicate-impression prevention
- navigation never waits for analytics

## Native client

- bounded queue
- app-background flush
- network-aware capped retry
- no unbounded local storage
- same event schema
- navigation never waits for analytics

## Admin UI

Add an Analytics panel to `/admin/features`.

Include:

- date range
- feature selection
- impressions
- selections
- renders
- blocked attempts
- conversion
- platform/role split
- top/low discovery
- truthful no-data and error states
- textual equivalents for charts

## Tests

- valid and invalid batches
- oversized batch
- unknown fields removed/rejected
- rate limit
- non-admin aggregate denial
- duplicate handling
- offline behavior
- analytics storage failure
- no sensitive field
- navigation still works when analytics fails

---

# Milestone G — Deterministic percentage rollout

## Objective

Release a feature to a stable percentage of eligible users.

## Schema

Add a staging-first migration extending `feature_rollout_overrides` with equivalent fields:

```text
rollout_percentage SMALLINT NOT NULL DEFAULT 100
rollout_seed TEXT
```

Constraints:

- percentage 0–100
- bounded seed
- existing rows remain 100%
- additive and reversible where safe

## Stable subject priority

1. Trusted authenticated user context.
2. Trusted user plus verified tenant context.
3. Opaque anonymous web cohort context.
4. Random native installation cohort stored locally.

The cohort value is not authentication.

## Deterministic assignment

Use one stable server-side hash algorithm over:

- feature
- environment
- seed
- stable subject

Never use per-request randomness.

## Evaluation order

```text
static lifecycle
→ runtime lifecycle/enabled
→ environment
→ time window
→ immutable role
→ runtime role restriction
→ tenant rules
→ percentage assignment
→ effective visible/accessibility
```

Percentage rollout must never broaden role or tenant access.

## API and Admin Console

Support:

- percentage 0–100
- seed rotation
- reason
- optimistic versioning
- before/after confirmation
- audit
- reset to static default
- warnings for 0%, partial rollout, and seed rotation

Admin UI should include:

- number input
- accessible slider if used
- current percentage
- exposure explanation
- confirmation
- production warning
- reset

## Tests

- 0%
- 100%
- stable repeated assignment
- same subject stable across instances
- seed change reshuffles
- role/tenant/time denial wins first
- web anonymous context
- native context
- cache isolation
- no raw subject in response
- invalid percentage
- non-admin denial
- version conflict
- audit
- reset
- non-flaky distribution checks for 10/25/50/75%

---

# Milestone H — Accessibility completion

## Objective

Reach a strong practical WCAG 2.2 AA baseline for primary navigation.

## Automated web checks

Run automated checks on:

- public desktop navigation
- open mega-menu
- mobile web drawer
- footer
- dashboard sidebar
- lifecycle pages
- Governance Console list
- Governance Console dialog
- analytics panel

## Web behavior

Verify/fix:

- semantic landmarks
- labelled triggers
- expanded/current/selected/disabled states
- keyboard opening
- Escape closing
- logical tab order
- visible focus
- focus return
- no hover-only access
- 200% zoom/reflow
- practical touch targets
- reduced motion
- status not color-only
- skip-to-content
- retry/recovery
- accessible tables/forms/dialogs/charts
- clear errors and announcements

## Native behavior

Add:

- accessibility roles
- labels
- hints where useful
- selected/disabled states
- VoiceOver/TalkBack order
- Dynamic Type
- practical touch targets
- reduced motion
- Android Back behavior
- light/dark contrast where supported

Do not disable font scaling globally.

## Manual evidence

Document:

- keyboard-only desktop
- 200% zoom
- reduced motion
- phone landscape
- Android TalkBack where available
- iOS VoiceOver where available

Mark unavailable device checks honestly.

---

# Milestone I — CI, staging, and closeout

## Documentation

Create/update:

```text
docs/navigation-intelligence/NATIVE_NAVIGATION_IMPLEMENTATION.md
docs/navigation-intelligence/NAVIGATION_ANALYTICS.md
docs/navigation-intelligence/PERCENTAGE_ROLLOUT.md
docs/navigation-intelligence/NAVIGATION_ACCESSIBILITY_REPORT.md
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_MILESTONE_EVIDENCE.md
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_UAT_CHECKLIST.md
docs/navigation-intelligence/NAVIGATION_BLUEPRINT_ROLLBACK_RUNBOOK.md
```

## Migrations

Apply new migrations to staging first.

Verify:

- schema
- constraints
- indexes
- RLS
- grants
- migration history
- function search paths
- security advisors

## CI

Expand Navigation Intelligence CI with:

- clean install
- web unit
- web TypeScript
- web build
- mobile TypeScript
- mobile lint
- backend governance tests
- backend analytics tests
- manifest drift
- native route ownership
- console chunk split
- navigation Playwright
- accessibility Playwright

## Staging smoke

Verify:

- native effective-state loading
- native tabs and drawer
- lazy console loading
- analytics ingestion and aggregate display
- percentage create/update/reset
- deterministic assignment
- role and tenant restrictions
- accessibility smoke
- rollback readiness

## Fast-track defect policy

Must fix:

- app startup or build failure
- primary dead navigation
- authorization bypass
- role/tenant leakage
- native route crash
- unstable rollout
- analytics privacy violation
- inaccessible primary flow
- unsafe migration
- infinite redirect/drawer loop

May document:

- minor spacing/animation tuning
- advanced charts
- low-value secondary native parity
- perfect screenshot matching
- rare wording refinements
- optimization beyond console lazy-loading

---

# Definition of Done

Complete only when:

- native tabs and drawer are governed and expose only real routes;
- native navigation refreshes after login/logout/role switch;
- governance console is lazy-loaded with loading/error/retry;
- primary surfaces are polished and responsive;
- web/native analytics use one minimized schema and work in staging;
- percentage rollout is deterministic, audited, configurable, and authorization-safe;
- primary web/native accessibility checks pass;
- new migrations are verified in staging;
- web, mobile, backend, CI, and Vercel staging are green;
- docs and PR #94 are updated;
- all work is committed and pushed;
- PR #94 remains unmerged.

---

# Claude execution contract

```text
/goal

Execute docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_FULL_COMPLETION_FASTTRACK_PLAN.md in one coordinated multi-agent programme.

Repository: https://github.com/kudzimusar/carup
Branch: codex/navigation-intelligence-blueprint-completion
Existing PR: #94

Complete native Expo governed tabs/drawer and route boundaries, lazy Admin Governance Console, visual polish, privacy-minimized web/native navigation analytics, deterministic percentage rollout, broad accessibility, expanded CI, staging verification, documentation, and PR evidence.

Continue on the existing branch and push checkpoints immediately.
Do not fabricate native screens.
Do not weaken backend authorization.
Do not store unnecessary personal data.
Do not use random rollout assignment.
Do not apply new migrations to production.
Do not merge automatically.
Do not stop at scaffolding or documentation.

/loop

Continue until every Definition of Done item is satisfied.

Each loop:
1. inspect branch, PR, worktrees, and review state;
2. state the active milestone and sub-goal;
3. assign agents with explicit file ownership;
4. implement across shared contracts, web, native, backend, database, tests, and docs;
5. review route truth, authorization, analytics minimization, rollout stability, accessibility, and responsiveness;
6. run focused tests and affected regressions;
7. fix failures;
8. commit and push the checkpoint;
9. update evidence and PR #94;
10. continue to the next incomplete gate.

Stop only when all authorized workstreams are implemented, blocker defects are resolved, CI/staging are green, documentation is current, and PR #94 is pushed and unmerged.
```

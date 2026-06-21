# CarUp Feature Registry — Remaining Phases Master Implementation Plan

## Document purpose

This document is the authoritative execution plan for completing the remaining Feature Registry expansion in one coordinated engineering programme.

It is designed for Claude Code multi-agent execution using a persistent `/goal` and `/loop` workflow. Agents must treat this document as the source of truth, execute the phases in dependency order, continuously validate the repository, and stop only when the defined completion gates are satisfied or a genuine external blocker is documented.

This plan covers the remaining optional expansion beyond Feature Registry Phases 1–3:

- Phase 4 — Structured mega-menu migration
- Phase 5 — Shared route wrapper and guard integration
- Phase 6 — Feature lifecycle, flags, and controlled rollout states
- Phase 7 — Admin Feature Governance Console
- Final convergence — documentation, tests, CI enforcement, production-equivalent verification, and one merge-ready integration PR

The existing Feature Registry foundation must remain stable throughout this programme.

---

## 1. Current baseline

The following work is already complete on `main` and must not be reimplemented:

### Phase 1 — Registry and dashboard navigation foundation

- `web/src/config/featureRegistry.ts` exists as the typed feature catalogue.
- Dashboard sidebar navigation consumes registry selectors.
- Role metadata and default dashboard routes are centralized.
- Navbar role switching consumes registry route helpers.
- All seven stakeholder roles are represented:
  - owner
  - dealer
  - mechanic
  - insurance
  - government
  - admin
  - bank
- Registry documentation exists.
- Phase 1 Playwright coverage exists in `tests/agents/27-feature-registry-navigation-map.spec.ts`.

### Phase 2 — Public navigation and route alignment

- Public direct navbar links consume registry selectors.
- Footer Product, Company, Resources, and Stakeholder sections consume registry data.
- Parameterized route matching exists.
- Route classification helpers exist:
  - `isPublicRoute`
  - `isProtectedRoute`
  - `getAllowedRolesForRoute`
  - `canRoleAccessRoute`
  - `getDefaultRouteForRole`
- Route mirroring against `App.tsx` exists.
- Phase 2 Playwright coverage exists in `tests/agents/28-feature-registry-public-nav-access.spec.ts`.

### Phase 3 — Guard alignment and CI validation

- Frontend dashboard role mismatch protection is registry-aware.
- Auth-page layout detection is registry-aware.
- Post-login dashboard routing uses registry helpers.
- Planned and hidden route metadata exists.
- CI-safe route validation tests exist.
- Active duplicate routes, dead links, missing role dashboards, and navigation drift are checked.

### Existing production safeguards

Agents must preserve all existing behavior in:

- authentication and session restoration
- CSRF handling
- backend authorization
- Diaspora import, document, reservation, and shipment flows
- marketplace fixture protection
- OCR and reviewer workflows
- evidence and trust scoring
- role switching
- production and staging API routing

The Feature Registry is a frontend product/navigation/governance layer. It must never be treated as the backend authorization boundary.

---

## 2. Programme goal

### `/goal`

Complete Feature Registry Phases 4–7 as one coordinated, production-grade programme so that CarUp has:

1. One structured source of truth for all public and stakeholder navigation surfaces, including mega-menus.
2. Reusable, registry-aware React route wrappers and frontend guards without duplicating backend security rules.
3. Explicit feature lifecycle and rollout metadata supporting active, planned, beta, hidden, disabled, deprecated, tenant-limited, and role-limited states.
4. A secure admin Feature Governance Console for inspecting and managing runtime-configurable feature rollout state.
5. CI gates that prevent dead links, route drift, invalid role mappings, inaccessible active features, unsafe feature-state transitions, and untested governance changes.
6. Full documentation, regression coverage, staging verification, and a merge-ready PR.

### `/loop`

Continue discovery, implementation, testing, review, repair, and re-validation until every mandatory acceptance criterion in this document is satisfied.

Do not stop at partial scaffolding, placeholder UI, documentation-only output, or tests that mock away the actual integration.

Do not merge to `main` automatically. The final stopping point is one clean, reviewable, fully tested PR with deployment evidence and a precise completion report.

---

## 3. Programme operating rules

### 3.1 Repository and workflow

- Repository: `https://github.com/kudzimusar/carup`
- Start from latest `main`.
- Create one integration branch:
  - `codex/feature-registry-completion-phases-4-7`
- Multi-agent sub-branches are allowed, but they must converge into the integration branch before the final PR.
- Agents must commit intentional files only.
- Never include local brain files, temporary prompts, credentials, `.env` values, screenshots, or unrelated worktree files.
- Preserve any unrelated untracked file unless its ownership and purpose are verified.
- Do not touch preserved stash `diaspora-wip-preserved-cc42b41`.
- Open a PR and stop before merge.

### 3.2 Scope discipline

Do not redesign the visual identity of CarUp.

Do not rewrite authentication or backend authorization.

Do not migrate unrelated business logic into the registry.

Do not convert all React Router declarations into opaque generated code if doing so reduces readability or makes route ownership harder to audit.

Do not make planned, hidden, disabled, or beta features visible to unauthorized users.

Do not claim runtime feature management unless backend persistence, validation, authorization, audit logging, and failure behavior are actually implemented and tested.

### 3.3 Security boundaries

The registry may control:

- navigation visibility
- route wrapper selection
- frontend user experience
- rollout display state
- tenant/role eligibility hints
- product governance metadata

The registry must not replace:

- Express middleware authorization
- service-layer ownership checks
- tenant isolation
- database RLS
- platform-role verification
- payment, evidence, document, shipment, or trust enforcement

Every governance API must use trusted server-derived user context.

Client-supplied role headers must never grant feature-governance authority.

### 3.4 Truthfulness

- Disabled or unavailable features must not appear active.
- Beta features must be labelled accurately.
- Planned features must not route users into fabricated functionality.
- Runtime changes must be auditable.
- If a feature requires a deployment before a configuration change can take effect, the UI and documentation must say so.

---

## 4. Required discovery before implementation

Agents must inspect and map the current implementation before changing code.

At minimum inspect:

### Frontend registry and routing

- `web/src/config/featureRegistry.ts`
- `web/src/config/featureRegistry.route-validation.test.ts`
- `web/src/App.tsx`
- `web/src/components/layout/Navbar.tsx`
- `web/src/components/layout/Footer.tsx`
- `web/src/components/layout/DashboardLayout.tsx`
- `web/src/components/layout/MainLayout.tsx`
- `web/src/lib/returnTo.ts`
- current route guard components or inline guard patterns
- existing unit test configuration
- existing Playwright configuration

### Existing navigation structures

Inventory every menu structure and classify it:

- direct navbar links
- Buy mega-menu
- Parts mega-menu
- Sell mega-menu
- Services or More mega-menu
- authenticated role switcher
- dashboard sidebars
- footer sections
- contextual page-level navigation
- mobile navigation if present

For each item capture:

- label
- description
- icon
- route
- query parameters
- nested section
- role visibility
- public/protected state
- current implementation file
- whether it is active, planned, hidden, or obsolete

### Backend and persistence

Inspect current database and backend patterns for:

- migrations
- Supabase access
- admin authorization
- audit logging
- tenant context
- safe error middleware
- service-layer validation
- API route conventions
- test fixtures

Reuse established patterns rather than creating an isolated governance subsystem.

### Existing tests

Inspect:

- `tests/agents/27-feature-registry-navigation-map.spec.ts`
- `tests/agents/28-feature-registry-public-nav-access.spec.ts`
- `tests/agents/16-vehicle-evidence-flow.spec.ts`
- `web/src/config/featureRegistry.route-validation.test.ts`
- auth/session tests
- admin authorization tests
- backend test runner behavior

### Discovery report

Before implementation, create a concise internal execution note recording:

- current route count
- current registry item count
- all navigation surfaces
- all remaining duplicate route maps
- current guard patterns
- current audit-log pattern
- preferred persistence model
- risks and migration strategy

This note may be included in the final PR body or stored under `docs/` if it adds lasting value.

---

# Phase 4 — Structured Mega-Menu Migration

## 5. Phase 4 objective

Move the remaining public mega-menu definitions into typed registry-backed structures without changing their visual design, ordering, descriptions, icons, links, query behavior, keyboard behavior, or responsive behavior.

## 5.1 Registry model extension

Extend the registry model only as much as required. Prefer composable metadata rather than one oversized interface.

Possible fields or supporting types may include:

```ts
export type NavigationSurface =
  | 'navbar-direct'
  | 'navbar-mega-buy'
  | 'navbar-mega-parts'
  | 'navbar-mega-sell'
  | 'navbar-mega-services'
  | 'navbar-more'
  | 'footer-product'
  | 'footer-company'
  | 'footer-resources'
  | 'footer-stakeholders'
  | 'dashboard-sidebar'
  | 'mobile-nav';

export interface FeatureNavigationPlacement {
  surface: NavigationSurface;
  section?: string;
  order: number;
  description?: string;
  icon?: LucideIconName;
  query?: Record<string, string>;
  badge?: string;
}
```

The final model may differ if the existing registry supports a cleaner extension.

Requirements:

- Maintain strict TypeScript typing.
- Avoid embedding React components directly in configuration.
- Resolve icons through an explicit icon map.
- Preserve stable feature IDs.
- Support nested sections and item ordering.
- Support routes with query parameters.
- Support external links only through an explicit safe external-link type.
- Do not permit arbitrary JavaScript callbacks in registry data.

## 5.2 Mega-menu selectors

Add tested selectors such as:

- `getMegaMenuSections(surface)`
- `getMegaMenuItems(surface, section)`
- `getNavigationPlacements(featureId)`
- `buildFeatureHref(feature, placement)`
- `getMobileNavigationItems()` if mobile navigation exists

Selectors must:

- exclude hidden and disabled features
- exclude planned features unless explicitly displayed as planned
- apply role/tenant/rollout visibility where relevant
- preserve configured ordering
- return stable data structures suitable for rendering

## 5.3 Navbar migration

Migrate the remaining static mega-menu arrays from `Navbar.tsx` into registry-backed selectors.

Must preserve:

- exact menu titles
- section headings
- descriptions
- route destinations
- query parameters
- icons
- ordering
- hover/click behavior
- mobile/desktop behavior
- accessibility labels
- keyboard navigation

Do not combine unrelated menu sections merely to simplify configuration.

## 5.4 Mobile navigation alignment

If mobile navigation duplicates desktop menu definitions:

- render from the same registry selectors
- preserve mobile-specific layout behavior
- ensure feature visibility is consistent between desktop and mobile
- add tests for mobile viewport navigation

If no separate mobile menu exists, document that fact.

## 5.5 Phase 4 validation

Add tests proving:

- every prior mega-menu item still renders
- every prior link resolves to the same route and query
- section order is unchanged
- mobile navigation remains usable
- hidden/disabled items do not render
- planned items do not appear active
- external links use safe attributes
- no duplicate static mega-menu source remains

### Phase 4 acceptance gate

Phase 4 is complete only when all mega-menu definitions are registry-backed or explicitly documented as a justified exception.

---

# Phase 5 — Shared Route Wrapper and Guard Integration

## 6. Phase 5 objective

Introduce reusable, registry-aware frontend route wrappers and guard composition while preserving explicit React Router route declarations and backend security boundaries.

## 6.1 Guard architecture

Create or refine small, explicit components/helpers such as:

- `RegistryRouteBoundary`
- `RequireAuthenticatedUser`
- `RequireFrontendRole`
- `FeatureAvailabilityBoundary`
- `FeatureDisabledPage`
- `FeatureUnavailablePage`
- `FeatureBetaNotice`

Names may differ, but responsibilities must remain separated.

The wrapper must evaluate:

1. Is the route registered?
2. Is it public or protected?
3. Is authentication required?
4. Is the current role eligible?
5. Is the feature active for the current rollout context?
6. Is the route planned, hidden, disabled, deprecated, or beta?
7. What safe fallback or redirect should occur?

## 6.2 Router integration strategy

Do not blindly generate the entire `App.tsx` tree from registry data.

Preferred approach:

- keep route declarations explicit
- wrap protected feature elements with registry-aware boundaries
- centralize repeated route access logic
- preserve nested route readability
- preserve lazy loading where present
- preserve existing return-to behavior

Where practical, create a typed helper such as:

```tsx
registryRoute('/dashboard/garage', <GarageDashboard />)
```

but only if it improves clarity and testability.

## 6.3 Authentication behavior

Must preserve:

- hard reload session restoration
- safe return-to handling
- login redirects
- role-switch redirects
- stale-session behavior
- existing auth loading states

No guard may redirect while authentication state is still bootstrapping.

Prevent redirect loops.

## 6.4 Role mismatch behavior

For protected routes:

- eligible role → render
- authenticated but ineligible role → safe role dashboard or explicit access-denied page
- unauthenticated → login with safe return-to
- unknown/unregistered route → existing not-found behavior

The behavior must be documented and tested.

## 6.5 Availability behavior

Define clear frontend behavior:

- `active` → render normally
- `beta` → render with optional non-blocking beta label
- `planned` → do not expose as active; direct access shows planned/unavailable state
- `hidden` → absent from navigation; direct access follows documented policy
- `disabled` → unavailable with safe message
- `deprecated` → redirect or display deprecation notice according to metadata

## 6.6 Phase 5 tests

Add tests for:

- unauthenticated protected-route redirect
- safe return-to preservation
- auth bootstrap does not trigger false redirect
- correct-role access
- wrong-role redirect or denial
- public route unaffected
- hidden feature absent from navigation
- disabled feature direct access
- planned feature direct access
- beta feature rendering
- no redirect loop
- all existing registry E2E tests remain green

### Phase 5 acceptance gate

Phase 5 is complete when repeated frontend route-guard logic is centralized, active routes behave identically to the current production baseline, and feature lifecycle states are enforced consistently on direct access and navigation.

---

# Phase 6 — Feature Lifecycle, Flags, and Controlled Rollout

## 7. Phase 6 objective

Add a production-grade feature lifecycle and rollout model that supports controlled enablement without misrepresenting backend authorization or creating unsafe client-only feature flags.

## 7.1 Lifecycle states

Replace or normalize existing boolean fields into a coherent lifecycle model while maintaining backward compatibility during migration.

Required states:

```ts
export type FeatureLifecycleState =
  | 'active'
  | 'beta'
  | 'planned'
  | 'hidden'
  | 'disabled'
  | 'deprecated';
```

If `isPlanned` and `isHidden` remain temporarily, add a deterministic normalization helper and remove ambiguity.

## 7.2 Rollout policy model

Support explicit rollout policy metadata such as:

- global enabled/disabled
- allowed roles
- allowed tenant IDs
- denied tenant IDs
- percentage rollout if genuinely needed
- start time
- end time
- environment restrictions
- beta label/message
- deprecation target route

Avoid percentage rollout unless there is a stable user key and deterministic hashing.

## 7.3 Static versus runtime state

Separate:

### Static registry metadata

Stored in TypeScript and deployed with code:

- feature ID
- route
- default lifecycle
- navigation placement
- default roles
- descriptions
- icons
- ownership/team metadata

### Runtime rollout overrides

Stored in the database:

- enabled/disabled override
- beta override
- tenant allow/deny lists
- role override within permitted bounds
- effective dates
- reason
- actor
- audit metadata

Runtime overrides must never create access broader than backend authorization.

## 7.4 Backend persistence

Create a migration using established database conventions.

Suggested table shape:

```sql
feature_rollout_overrides
- id
- feature_id
- environment
- lifecycle_state
- enabled
- allowed_roles
- allowed_tenant_ids
- denied_tenant_ids
- starts_at
- ends_at
- reason
- created_by
- updated_by
- created_at
- updated_at
- version
```

Exact types must follow project conventions.

Requirements:

- unique constraints preventing conflicting active overrides
- indexes for feature/environment lookup
- safe JSON/array validation
- timestamps
- optimistic concurrency or version checking if updates may race
- RLS if direct client access is possible
- preferably service-role-only backend access for governance writes

## 7.5 Backend service and API

Create a dedicated service, for example:

- `backend/services/featureGovernance/featureGovernanceService.js`

Create routes under a clear namespace, for example:

- `GET /api/admin/features`
- `GET /api/admin/features/:featureId`
- `PATCH /api/admin/features/:featureId/rollout`
- `DELETE /api/admin/features/:featureId/rollout`
- `GET /api/features/effective`

Exact route names may follow existing conventions.

Authorization:

- governance writes: trusted platform admin only unless a narrower governance role already exists
- governance reads for console: platform admin/reviewer as appropriate
- effective-feature read for signed-in users: sanitized output only
- tenant admins must not change global rollout policy unless explicitly designed and approved

Validation:

- feature ID must exist in static registry manifest
- lifecycle state must be valid
- dates must be valid
- role names must be valid
- tenant IDs must be valid UUIDs or existing tenant identifiers
- overrides cannot expand access beyond immutable backend constraints
- reason is required for disabling/deprecating production features

## 7.6 Registry manifest bridge

The Node backend cannot safely import browser-specific React modules.

Create a framework-neutral feature manifest source or generated artifact.

Preferred options:

1. Extract common registry metadata into a shared TypeScript/JSON-safe module with no React imports.
2. Generate a JSON manifest at build/test time from the registry.
3. Maintain a validated server manifest generated from the frontend registry.

The chosen approach must prevent silent drift through CI validation.

## 7.7 Effective feature evaluation

Implement one deterministic evaluator that combines:

- static lifecycle state
- runtime override
- environment
- authenticated role
- tenant
- current time
- deterministic percentage key if used

Return a safe result:

```ts
{
  featureId,
  state,
  enabled,
  visible,
  reasonCode,
  beta,
  deprecatedTo
}
```

Never expose internal admin notes to ordinary users.

## 7.8 Caching and failure mode

Define caching deliberately.

Requirements:

- short bounded cache or request-level cache
- cache invalidation after admin update
- safe behavior if database lookup fails
- no accidental global enabling on failure

Recommended failure behavior:

- fall back to static registry defaults
- log structured warning
- preserve backend authorization
- never expose a disabled feature because the override service failed

## 7.9 Phase 6 tests

Backend tests must cover:

- admin can create/update override
- non-admin cannot mutate override
- spoofed role denied
- invalid feature ID rejected
- invalid lifecycle rejected
- invalid role/tenant policy rejected
- tenant allow/deny evaluation
- date-window evaluation
- static fallback on missing override
- safe fallback on storage failure
- cache invalidation
- audit entry emitted
- sanitized effective-feature response

Frontend tests must cover:

- active feature visible
- hidden feature omitted
- disabled feature omitted and direct access blocked
- beta feature labelled
- tenant-limited feature visibility
- runtime state loading does not break auth bootstrap

### Phase 6 acceptance gate

Phase 6 is complete only when lifecycle states and runtime overrides are persisted, authorized, audited, safely evaluated, and integrated into navigation/direct-route behavior with tests.

---

# Phase 7 — Admin Feature Governance Console

## 8. Phase 7 objective

Build an admin-only governance console for inspecting the registry and managing permitted runtime rollout overrides.

## 8.1 Route and registry entry

Add an admin route, for example:

- `/admin/features`

Register it in the Feature Registry as:

- protected
- admin-only
- active
- dashboard sidebar or admin tools placement
- clearly labelled `Feature Governance`

Do not expose it to non-admin roles.

## 8.2 Console capabilities

The console must display:

- feature ID
- label
- route
- lifecycle state
- enabled/effective state
- navigation surfaces
- allowed static roles
- runtime role policy
- tenant rollout policy
- environment
- effective dates
- beta/deprecation information
- last updated by
- last updated at
- audit/change history link or panel

## 8.3 Filtering and inspection

Support useful filters:

- search by ID/label/route
- lifecycle state
- navigation surface
- role
- environment
- overridden versus static default
- tenant-limited features

Provide a read-only detail view before mutation controls.

## 8.4 Mutation controls

Admin may:

- enable/disable within allowed policy
- mark beta
- schedule start/end
- set allowed/denied tenants
- set allowed roles within safe constraints
- add reason
- reset runtime override to static default

Admin may not:

- edit feature IDs
- edit code-defined routes
- create arbitrary routes
- bypass backend authorization
- modify immutable backend security constraints

## 8.5 Confirmation and safety

Require explicit confirmation for high-impact changes:

- disable active production feature
- deprecate feature
- change global role visibility
- remove tenant access
- reset override

Show:

- current effective state
- proposed effective state
- affected environment
- affected roles/tenants
- reason

Use optimistic concurrency/version checks to prevent overwriting newer changes.

## 8.6 Audit logging

Every mutation must record:

- actor user ID
- trusted actor role
- feature ID
- previous state
- next state
- environment
- reason
- correlation ID
- timestamp
- request metadata consistent with existing audit patterns

Audit records must be immutable to ordinary application users.

## 8.7 UX states

Implement:

- loading state
- empty state
- storage/API error state
- permission denied state
- stale version conflict state
- successful update feedback
- rollback/reset feedback

Do not use fabricated metrics.

## 8.8 Accessibility

- keyboard-accessible filters and dialogs
- labelled form controls
- focus management in confirmation dialogs
- status text not conveyed by color alone
- accessible tables/cards at responsive sizes

## 8.9 Phase 7 tests

Backend/API:

- admin read/write
- reviewer read policy if allowed
- non-admin denied
- spoofed role denied
- audit entry created
- version conflict handled
- invalid payload safe 400
- missing feature safe 404

Frontend/unit:

- table renders manifest and effective states
- filters work
- mutation form validates
- confirmation required
- unauthorized role cannot see route/nav item
- conflict and API error states render

Playwright:

- admin opens console
- filters feature
- opens detail
- creates safe override
- observes effective state update
- views audit evidence
- resets override
- non-admin direct access denied/redirected
- navigation visibility changes according to test fixture override

### Phase 7 acceptance gate

Phase 7 is complete when the console is functional, admin-only, backed by real persistence and APIs, audited, conflict-safe, accessible, and tested end to end.

---

# Final convergence and quality gates

## 9. Integration requirements

All phases must converge without breaking existing route behavior.

The final branch must contain:

- registry model extensions
- mega-menu migration
- route wrapper integration
- lifecycle evaluator
- backend persistence and APIs
- audit logging
- admin governance console
- migrations
- documentation
- unit tests
- backend tests
- Playwright tests
- CI validation updates

No phase may remain as disconnected scaffolding.

## 10. Required documentation

Update or create:

- `docs/CARUP_FEATURE_REGISTRY_AND_NAVIGATION_MAP.md`
- this master implementation plan with a completion appendix or status markers
- feature lifecycle and rollout documentation
- admin governance console runbook
- database migration/deployment instructions
- rollback procedure
- contributor instructions for adding a feature
- contributor instructions for adding menu placements
- contributor instructions for changing lifecycle defaults
- explicit explanation of frontend visibility versus backend authorization

## 11. Required CI gates

CI must fail for:

- active registry route missing from router
- duplicate active route pattern
- active nav item with no active route
- dashboard role without default route
- invalid navigation surface
- invalid lifecycle state
- runtime override referencing unknown feature
- backend manifest drift from frontend registry
- unsafe route guard regression
- dead hardcoded navigation link
- untested migration/service changes where applicable

Do not make CI depend on an interactive browser for checks that can run as unit tests.

## 12. Required test execution

Run the relevant exact commands after discovering current package scripts. At minimum:

```bash
npm run test:unit --workspace=web
npx tsc --noEmit --project web/tsconfig.app.json
npm run build
npx playwright test tests/agents/27-feature-registry-navigation-map.spec.ts --project=chromium --timeout=120000
npx playwright test tests/agents/28-feature-registry-public-nav-access.spec.ts --project=chromium --timeout=120000
npx playwright test tests/agents/16-vehicle-evidence-flow.spec.ts --project=chromium --timeout=120000
node backend/tests/run-tests.js
git diff --check
```

Add and run dedicated tests for Phases 4–7.

Suggested names:

- `web/src/config/featureRegistry.mega-menu.test.ts`
- `web/src/config/featureRegistry.lifecycle.test.ts`
- `backend/tests/feature-governance-auth.test.js`
- `backend/tests/feature-governance-evaluator.test.js`
- `tests/agents/29-feature-registry-mega-menu.spec.ts`
- `tests/agents/30-feature-registry-route-boundary.spec.ts`
- `tests/agents/31-feature-governance-console.spec.ts`

Also run targeted authentication and navigation regressions affected by route wrappers.

## 13. Staging verification

Before recommending merge:

- deploy frontend and backend previews
- apply migration to a safe staging environment first
- verify staging frontend calls staging backend only
- verify governance APIs
- verify admin console with staging admin
- verify non-admin denial
- verify runtime override changes effective navigation behavior
- verify reset restores static default
- verify audit records
- verify existing Diaspora buyer flow remains green
- verify login/return-to and role switching remain green

Do not apply unreviewed governance changes to production.

## 14. Performance requirements

- registry selectors should be deterministic and inexpensive
- avoid repeated full registry scans in render loops where memoization is appropriate
- do not add blocking governance API calls before rendering public pages unless required
- cache effective feature state safely
- avoid materially increasing the main bundle without justification
- report bundle-size changes

## 15. Migration and rollback

Provide a rollback plan covering:

- reverting frontend registry changes
- disabling governance console route
- resetting runtime overrides
- rolling back database migration if safe
- restoring static defaults
- invalidating caches

Runtime overrides must be resettable without deleting static registry metadata.

## 16. Definition of done

The programme is done only when all of the following are true:

### Architecture

- All navbar mega-menus are registry-backed or explicitly justified exceptions.
- Route wrapper/guard duplication is reduced and centralized.
- Static metadata and runtime overrides are clearly separated.
- Frontend and backend feature manifests cannot drift silently.

### Functionality

- Lifecycle states work consistently.
- Runtime override evaluation works by environment, role, tenant, and time.
- Admin governance console performs real authorized changes.
- Audit history is recorded.
- Reset to static default works.

### Security

- Backend remains the authority.
- Only trusted admins can mutate rollout state.
- Spoofed roles are denied.
- Tenant isolation is preserved.
- Invalid or conflicting changes fail safely.

### Quality

- TypeScript passes.
- Build passes.
- Unit tests pass.
- Backend tests pass.
- Existing registry E2E passes.
- New Phase 4–7 E2E passes.
- Evidence and Diaspora critical regressions pass.
- `git diff --check` passes.
- Vercel checks are green.

### Delivery

- One final PR is open against `main`.
- PR body explains every phase.
- Files changed are intentional.
- Migration and deployment instructions are present.
- Staging verification evidence is included.
- Remaining limitations are explicit.
- Agent recommends merge or clearly identifies a real blocker.
- The branch is not merged automatically.

---

# Multi-agent execution structure

## 17. Recommended agent assignments

Claude Code may split work across agents as follows:

### Agent A — Registry and mega-menu architecture

- Phase 4 model
- mega-menu migration
- selectors
- frontend unit tests

### Agent B — Route boundaries and auth regressions

- Phase 5 wrapper design
- App.tsx integration
- login/return-to/role mismatch tests

### Agent C — Backend governance and database

- Phase 6 migration
- service/API
- evaluator
- authorization
- caching
- audit integration
- backend tests

### Agent D — Admin console

- Phase 7 route/UI
- API integration
- accessibility
- frontend tests

### Agent E — Validation and adversarial review

- CI gates
- manifest drift checks
- security review
- regression execution
- staging validation
- PR completion report

Agents must coordinate shared files before editing. The lead agent owns integration conflict resolution and final validation.

## 18. Mandatory review loops

The lead agent must run these loops:

### Loop 1 — Discovery and design review

- verify baseline
- inspect existing patterns
- confirm schema and API design
- record risks

### Loop 2 — Phase implementation review

After each phase:

- review diff
- run targeted tests
- ensure no scope creep
- repair before continuing

### Loop 3 — Cross-phase integration

- resolve model inconsistencies
- verify static/runtime state interaction
- verify route wrappers consume effective state
- verify console updates propagate

### Loop 4 — Security review

- role spoofing
- tenant crossover
- unauthorized API access
- unsafe defaults
- stale cache
- audit completeness

### Loop 5 — Full regression and staging

- full tests
- builds
- deployment checks
- staging workflows
- final report

The `/loop` must continue until the Definition of Done is satisfied.

---

# Final report format

Claude Code must return:

1. PR URL
2. integration branch
3. final head SHA
4. phase-by-phase completion status
5. exact files changed
6. database migrations added
7. API endpoints added or changed
8. registry model changes
9. mega-menu surfaces migrated
10. route wrappers integrated
11. lifecycle and rollout rules implemented
12. governance console capabilities
13. authorization and audit controls
14. tests added
15. commands run and exact results
16. Vercel preview URLs
17. staging migration and smoke results
18. bundle-size impact
19. intentionally deferred items
20. known limitations
21. merge recommendation

Do not report a phase complete merely because files exist. Report completion only when behavior is integrated and verified.

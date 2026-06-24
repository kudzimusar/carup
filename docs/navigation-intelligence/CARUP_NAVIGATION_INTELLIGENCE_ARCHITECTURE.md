# CarUp Navigation Intelligence — Architecture

> **Status: TARGET architecture being implemented on branch `codex/navigation-intelligence-blueprint-completion`.**
> This document describes the architecture the platform is converging on, not the current state of `main`. Where it says "the registry governs", "selectors resolve", or "the route boundary evaluates", read it as the contract being built. The companion master plan is [`docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md`](../implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md). The Marketplace Truth & Coverage substrate that this architecture consumes (and does **not** replace) is documented in [`docs/features/NAVIGATION_INTELLIGENCE.md`](../features/NAVIGATION_INTELLIGENCE.md).
>
> **Today's baseline (for honesty):** the registry holds **83 features** and **7 roles**, lifecycle is expressed only as booleans `isPlanned` / `isHidden`, `NavPlacement` is a flat string array (`dashboard_sidebar` / `header` / `footer` / `mobile_nav` / `user_menu`), there is no `NavigationSurface`, no navigation manifest, no `buildFeatureHref`, no `coverageRule` field, no standalone route-boundary components, and no catch-all route. Desktop mega-menus, the footer, and the mobile drawer are still hand-authored arrays in `Navbar.tsx` / `Footer.tsx`. This architecture replaces those hand-authored surfaces with a registry-backed manifest.

---

## 1. Registry purpose — single typed source of truth

`web/src/config/featureRegistry.ts` is the **single typed source of truth** for feature, route, and role metadata across the CarUp web app. Every navigable capability is described once, in typed code, and all navigation surfaces, route guards, and governance reads derive from it. Nothing in navigation is "hand-knowledge" that lives only in a component.

- **Scale:** 83 features, 7 roles.
- **Roles (`UserRole`, from `shared/types`):** `owner` | `dealer` | `mechanic` | `bank` | `insurance` | `government` | `admin` (exact strings — no synonyms).
- **Role metadata (`ROLE_METADATA`)** carries each role's canonical `dashboardRoute`:
  `owner=/dashboard`, `dealer=/dealer`, `mechanic=/mechanic`, `insurance=/insurance-dash`, `government=/government`, `admin=/admin`, `bank=/bank`.
- **Feature shape (`FeatureRegistryItem`):** `id`, `label`, `route`, `domain` (`FeatureDomain`), `roles: UserRole[]`, `placements: NavPlacement[]`, `requiresAuth`, `icon` (`LucideIconName`), optional `badge`, `description`, plus lifecycle (see §6).
- **Domains (`FeatureDomain`):** `commerce` | `trust` | `evidence` | `safepay` | `parts` | `service` | `insurance` | `government` | `diaspora` | `admin` | `finance` | `referral` | `info`.

The registry is consumed by the existing selector family (e.g. `getFeaturesByRole`, `getFeaturesByPlacement`, `getDashboardItems`, `canAccessFeature`, `getDashboardRoute`, `getFeatureByRoute`, `isPublicRoute`, `isProtectedRoute`, `getAllowedRolesForRoute`, `canRoleAccessRoute`, `getDefaultRouteForRole`) and by the new navigation selectors introduced in §2.

**Why a registry at all:** it makes the route-validation CI gate possible. `web/src/config/featureRegistry.route-validation.test.ts` already asserts that every non-planned/non-hidden feature has a `<Route>` in `App.tsx`, that there are **no duplicate active routes**, that every role `dashboardRoute` is registered, and that `Navbar` / `Footer` / `DashboardLayout` contain no dead links. The registry is what gives that gate something authoritative to check against.

---

## 2. Navigation surfaces and the navigation manifest

### 2.1 `NavigationSurface` model

The flat `NavPlacement` string array is replaced by a richer, enumerated `NavigationSurface` taxonomy that names every concrete place a navigation node can render:

| Group | Surfaces |
|-------|----------|
| Desktop primary | `navbar-direct`, `navbar-more` |
| Desktop mega-menus | `navbar-mega-buy`, `navbar-mega-sell`, `navbar-mega-verify`, `navbar-mega-parts`, `navbar-mega-services` |
| Footer | `footer-product`, `footer-company`, `footer-resources`, `footer-stakeholders`, `footer-legal`, `footer-social` |
| Authenticated chrome | `dashboard-sidebar`, `user-menu` |
| Mobile web | `mobile-primary`, `mobile-secondary`, `mobile-account` |

This taxonomy is what lets the codebase distinguish, for example, the desktop **Buy** mega-menu (`navbar-mega-buy`) from the mobile primary tab strip (`mobile-primary`), and the dedicated **legal** and **social** footer surfaces (which today don't exist — legal links are buried under Resources and social links are `href="#"` placeholders) from the four content footer columns.

### 2.2 `NAVIGATION` manifest of `NavigationNode`s

A new registry-backed `NAVIGATION` manifest enumerates every governed navigation node. Each `NavigationNode` is **either**:

1. **Feature-linked** — it references a `FeatureRegistryItem` by `id` and inherits that feature's route, roles, auth requirement, and lifecycle; **or**
2. **A standalone governed link** — a navigation entry that is not itself a top-level feature (e.g. a Buy mega-menu deep-link such as "SUVs" or "Under $10,000"), but is still governed, ordered, and validated.

Each `NavigationNode` carries:

| Field | Meaning |
|-------|---------|
| `surface` | one of the `NavigationSurface` values (§2.1) |
| `section` | sub-grouping within a surface (e.g. "Vehicles", "Buyer Tools" inside `navbar-mega-buy`) |
| `order` | deterministic sort order within section |
| `label` | display text |
| `query` | structured marketplace query params (`q`/`make`/`category`/`tag`/`minPrice`/`maxPrice`/`sort`) used to build the href |
| `icon` | `LucideIconName` |
| `lifecycle` | `FeatureLifecycleState` (§6) — inherited from the feature when feature-linked |
| `coverageRule` | optional coverage gate key (§5) for coverage-gated nodes |
| `authDestination` | href to use when the user is authenticated |
| `guestDestination` | href to use when the user is a guest |
| `external` | true for off-site links (footer-social, etc.) — drives `target`/`rel` |

### 2.3 Selectors over the manifest

Surfaces are rendered exclusively through selectors so that components stop owning routing knowledge:

- `getDesktopMegaMenu(surface)` — returns ordered sections + nodes for a `navbar-mega-*` surface.
- `getFooterNavigation(surface)` — returns nodes for a `footer-*` surface.
- `getMobileNavigation(surface)` — returns nodes for `mobile-primary` / `mobile-secondary` / `mobile-account`.
- `buildFeatureHref(node, { user })` — resolves a node to a concrete href, choosing `authDestination` vs `guestDestination`, appending the structured `query`, and applying any `coverageRule` (§5).
- `resolveFeatureVisibility(node | feature, { user, overrides, env })` — the single visibility decision used by both nav rendering and route boundaries (§7), folding role, auth, lifecycle, tenant, environment, and override state into one verdict.

### 2.4 Why a separate manifest instead of stuffing deep-links into `FEATURE_REGISTRY`

The Buy / Sell / Verify / Parts / Services mega-menus contain **~69 deep-links**, and many of the Buy items legitimately point at the **same** destination — `/marketplace` (e.g. "Shop All Cars", "Brand New Cars", "Recently Imported", "Locally Used", "Second Hand Cars" all resolve to `/marketplace`, differing only by query/coverage). If those were modeled as `FeatureRegistryItem`s, they would all collide on `route`.

That directly violates the **"no duplicate active route" invariant** enforced by `featureRegistry.route-validation.test.ts`, which forbids two non-planned/non-hidden features from claiming the same route. Keeping deep-links in a **navigation manifest** — where many nodes are allowed to share a base route because they are distinguished by `section` / `order` / `query` / `coverageRule` — preserves that invariant. `FEATURE_REGISTRY` stays a clean one-feature-per-route catalog; `NAVIGATION` carries the many-to-one presentation layer on top of it.

---

## 3. Frontend visibility vs backend authorization

The registry and navigation manifest govern **discovery and UX only**. They decide what a user *sees and can click*, never what a user is *allowed to do*.

- **Authoritative authorization stays on the server.** Express `authorizeRole(...)` (`backend/middleware/authMiddleware.js`), Supabase **RLS**, and per-service ownership checks remain the only enforcement of access. Frontend visibility is advisory.
- **Visibility never grants access.** If a node is mistakenly shown to a role that the backend rejects, the request still fails server-side. Hiding a node is a UX nicety, not a security control.
- **Corollary:** every protected route must be enforced twice — once for UX (registry visibility / route boundary) and once for real (backend `authorizeRole` + RLS). The frontend layer must be treated as untrusted by the backend.

---

## 4. Static metadata vs runtime override

Navigation metadata has two layers: **static code defaults** and a **backend-persisted override**.

- **Static defaults (code):** each feature/node ships with default `lifecycle`, `roles`, and `placements`/surfaces baked into `featureRegistry.ts` / `NAVIGATION`. This is the version-controlled, reviewable baseline and the **immutable policy floor**.
- **Runtime override (`feature_rollout_overrides`):** a backend-persisted record, keyed per feature, overlays the static defaults. Fields:
  - `environment` (which env the override applies to),
  - `enabled`,
  - `lifecycle` override (only within the **permitted states** for that feature),
  - `allowedRoles` / `deniedRoles` (only **within the immutable static role bounds**),
  - `tenantAllow` / `tenantDeny`,
  - `startAt` / `endAt` (time-boxed rollout),
  - `betaMessage`,
  - `reason`, `actor`, `version` (for audit + optimistic concurrency, §8).

**Invariant — overrides can only narrow.** An override can **never broaden access beyond backend authorization or the immutable static policy**. It can disable a feature, restrict it to fewer roles/tenants, time-box it, or move it to a *more* restrictive lifecycle state — but it cannot grant a role the static policy never permitted, and it can never override what the backend `authorizeRole`/RLS layer enforces. A `disabled` static default can never be flipped to broadly enabled in a way that exceeds the static bounds.

---

## 5. Marketplace coverage integration

The Marketplace Truth & Coverage substrate documented in [`docs/features/NAVIGATION_INTELLIGENCE.md`](../features/NAVIGATION_INTELLIGENCE.md) is **preserved and consumed, not replaced**.

- `web/src/lib/marketplaceParams.ts` already provides `COVERAGE_GATED_NAV` (today `{ 'Locally Used': 'locally_used' }`), `resolveCoverageNavHref(label, fallbackHref, navCoverage)`, and the `fetchMarketplaceNavCoverage()` API call against `GET /api/marketplace/nav-coverage`.
- Coverage-gated `NavigationNode`s declare a `coverageRule` (§2.2). When `buildFeatureHref` resolves such a node, it calls into the existing coverage substrate: if the category has ≥ 3 eligible listings the href activates (e.g. `/marketplace?category=locally_used`); otherwise it **defers gracefully** to `/marketplace` with no category filter.
- The promotion threshold of 3, fixture exclusion, and the no-PII guarantees of the coverage endpoint are inherited unchanged from the substrate. This architecture adds *more callers* of the substrate (any node with a `coverageRule`), it does not re-implement coverage logic.

---

## 6. Lifecycle model

Lifecycle is promoted from two booleans to a typed enum:

```
FeatureLifecycleState = 'active' | 'beta' | 'planned' | 'hidden' | 'disabled' | 'deprecated'
```

### 6.1 Deterministic migration from today's booleans

Existing `isPlanned` / `isHidden` flags map deterministically, with no ambiguity:

- `isPlanned === true` → `planned`
- else `isHidden === true` → `hidden`
- else → `active`

(`isPlanned` wins over `isHidden` if both are somehow set, making the migration total and order-independent.) The new states `beta`, `disabled`, and `deprecated` have no boolean predecessor and are introduced fresh.

### 6.2 State semantics (nav visibility AND direct access)

| State | Nav visibility | Direct route access |
|-------|----------------|---------------------|
| `active` | Shown normally on its surfaces | Allowed (subject to auth/role) |
| `beta` | Shown, with a beta affordance (`FeatureBetaNotice`) | Allowed; renders beta notice |
| `planned` | Optionally shown as "coming soon" / non-clickable | Blocked → `FeaturePlannedPage` |
| `hidden` | Not rendered in any surface | Route may exist but is not advertised |
| `disabled` | Not rendered | Blocked → `FeatureDisabledPage` |
| `deprecated` | Shown with deprecation affordance (`FeatureDeprecatedNotice`) or hidden per policy | Allowed but warns; on the path to removal |

Lifecycle is evaluated identically for navigation rendering and for route entry — there is one decision (`resolveFeatureVisibility`), so a node can never be "clickable but blocked" by accident.

---

## 7. Route-boundary behavior

Route protection moves from ad-hoc checks inside `App.tsx` / `DashboardLayout.tsx` into composable boundary components:

- **`RegistryRouteBoundary`** — top-level wrapper that looks the current path up in the registry (`getFeatureByRoute`) and orchestrates the checks below.
- **`RequireAuthenticatedUser`** — gates protected routes; redirects guests to login with a sanitized return-to.
- **`RequireFrontendRole`** — checks the registry's allowed roles for the route (`canRoleAccessRoute`); a UX gate layered on top of backend `authorizeRole`.
- **`FeatureAvailabilityBoundary`** — evaluates lifecycle + override + env/time and routes to the correct outcome page/notice.
- **Outcome surfaces:** `FeatureUnavailablePage`, `FeatureDisabledPage`, `FeaturePlannedPage`, plus inline `FeatureDeprecatedNotice` and `FeatureBetaNotice`.

### 7.1 Evaluation order

The boundary evaluates in a fixed, short-circuiting order:

1. **auth-bootstrap** — wait for `AuthContext` to finish hydrating (`loading` gate); never redirect mid-bootstrap. *(This closes today's gap where `App.tsx` does not gate on `loading`, risking premature redirects.)*
2. **registered** — is this path known to the registry? If not → not-found.
3. **public vs protected** — `isPublicRoute` / `isProtectedRoute`.
4. **auth** — authenticated user required? (`RequireAuthenticatedUser`)
5. **role** — does the user's role satisfy the route? (`RequireFrontendRole` / `canRoleAccessRoute`)
6. **tenant** — tenant allow/deny from override.
7. **lifecycle** — `active`/`beta`/`planned`/`hidden`/`disabled`/`deprecated` (§6).
8. **env/time** — environment match + `startAt`/`endAt` window from override.
9. **outcome** — redirect / deny / planned / beta / deprecated rendering.

### 7.2 Loop-safety and return-to

- **No redirect loops:** the boundary never redirects to a destination that would itself immediately re-redirect; dashboard fallbacks use `getDefaultRouteForRole` so a role always lands somewhere it is allowed.
- **Return-to is already safe:** post-login return paths are sanitized by `web/src/lib/returnTo.ts` (`isSafeReturnTo` / `safeReturnTo` / `resolvePostLoginRoute`), which blocks `//`, `\\`, `://`, and control characters. This sanitizer is **preserved as-is** and reused by `RequireAuthenticatedUser` — boundaries do not invent a second return-to scheme.
- A catch-all (`<Route path="*">` → NotFound) is added so unknown paths render a real surface instead of blank.

---

## 8. Governance and audit model

A new admin-only Feature Governance surface manages overrides, backed by guarded APIs and full audit.

- **APIs:**
  - `GET /api/features/effective` — the resolved (static ⊕ override) view for the current context.
  - `GET /api/admin/features...` — admin read of feature/override state.
  - `PATCH /api/admin/features...` — create/update an override.
  - `DELETE /api/admin/features...` — clear an override (revert to static defaults).
- **Server-derived authority only.** Platform-admin authority is established server-side via `authorizeRole(['admin'])` (`PLATFORM_ADMIN_ROLES = {admin, platform_admin, super_admin}`), reading the role from `users` / `user_sessions`. **Client headers never grant admin** — `x-stakeholder-role` is only a *requested* role and is ignored for authorization.
- **Audit.** Every mutation is written to `trust_audit_events` via `logAuditEvent` (`backend/services/auditLogger.js`), recording `event_type`, `previous_value` / `new_value` (JSONB, redacted), `actor_user_id`, `actor_role`, `actor_tenant_id`, `source_route`, `request_id`, and `reason`.
- **Optimistic concurrency.** Override writes carry a `version`; a stale `version` is rejected so two admins cannot silently clobber each other.
- **Safe fallback.** If override storage is unavailable or returns malformed data, resolution falls back to **static defaults**. The fallback is fail-closed in the safe direction: a feature that is `disabled` by static default **never becomes enabled** through a storage failure.

---

## 9. Contributor workflow — adding a feature or nav item

To add a navigable capability end-to-end:

1. **Registry** — add a `FeatureRegistryItem` to `web/src/config/featureRegistry.ts` (`id`, `label`, `route`, `domain`, `roles`, `requiresAuth`, `icon`, lifecycle). One feature, one route.
2. **Manifest** — add the corresponding `NavigationNode`(s) to `NAVIGATION`: pick the `surface`, `section`, `order`, `label`, `query`, optional `coverageRule`, and auth/guest destinations. Use the manifest (not new registry entries) for deep-links that share an existing base route such as `/marketplace`.
3. **Route** — register the `<Route>` in `App.tsx` (wrapped by the appropriate boundary from §7).
4. **Tests** — extend coverage; the structural gate `featureRegistry.route-validation.test.ts` must stay green.

### 9.1 What the route-validation gate enforces

The CI gate (`web/src/config/featureRegistry.route-validation.test.ts`, run via `npm run test:unit --workspace=web`) blocks merges on navigation drift:

- **No dead links** — every non-planned/non-hidden feature has a real `<Route>` in `App.tsx`; `Navbar` / `Footer` / `DashboardLayout` contain no link to a missing route.
- **No duplicate active routes** — two active features can't claim the same route (the invariant the manifest in §2.4 exists to protect).
- **No drift** — every role `dashboardRoute` is registered, and every header/footer item has a route.

If you add a node but forget the route (or vice versa), or you accidentally collide routes, the gate fails. That gate — plus backend `authorizeRole`/RLS as the real enforcement layer — is what keeps the registry honest as the single source of truth.

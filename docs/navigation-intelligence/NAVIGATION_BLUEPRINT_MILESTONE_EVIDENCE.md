# Navigation Intelligence Blueprint — Milestone Evidence Log

Integration branch: `codex/navigation-intelligence-blueprint-completion` (base main `c25b094`).
Append-only evidence per milestone. Commands run locally; backend governance migration is staging-only pending Product Owner approval (live DB must not be migrated — see baseline doc).

---

## Post-PR Codex review remediation (P1 + P2) — 2026-06-21

### P1 — clean-install dependency reproducibility ✅
- Root cause: the new jsdom/RTL tests imported `@testing-library/react`, `@testing-library/user-event` and the `jsdom` environment, but **none was declared** in any manifest (they were present in `node_modules` ad-hoc and absent from `package-lock.json`), so a clean `npm ci` would drop them. RTL v16 also peer-requires `@testing-library/dom`.
- Fix: added to **`web` devDependencies** — `@testing-library/dom ^10.4.1`, `@testing-library/react ^16.3.2`, `@testing-library/user-event ^14.6.1`, `jsdom ^29.1.1` (jest-dom intentionally NOT added — no test uses its matchers). `package-lock.json` updated deterministically via `npm install`.
- **Proof from clean state:** `rm -rf node_modules web/node_modules && npm ci` (exit 0, 1422 pkgs) `&& npm run test:unit --workspace=web` → **20 files / 199 tests** (now 202 with P2). No reliance on hoisted/global packages.

### P2 — context-aware effective feature state ✅
- `GET /api/features/effective` previously evaluated with `role:null, tenantId:null`, so `allowed_roles`/tenant restrictions weren't applied for authenticated users.
- Fix: `resolveRequestContext(req,{client})` derives role+tenant **server-side** (validates `user_sessions`→`users`; honors `x-tenant-id` only with verified `tenant_users` membership; **ignores `x-stakeholder-role`**); anonymous supported; fail-closed. Endpoint passes trusted `role`/`tenantId` to `getEffectiveStates`; returns sanitized state only.
- Frontend: loader sends the session + re-fetches on auth change and **identity-gates** states (empty until the current identity's fetch resolves → a just-logged-in user is never gated by stale anonymous state); `resolveFeatureVisibility` + `evaluateRouteAccess` honor backend `visible`/`accessible` (tenant/time the SPA can't recompute) → **nav visibility and direct access agree**.
- Tests: **10 backend** (anonymous; role derivation; spoofed-header ignored; tenant membership; expired→anonymous; allowed role; role removal→visible/accessible false; tenant allowlist incl. different-tenant exclusion; tenant denylist; sanitized payload) + **3 frontend** (kill-switch already; tenant denial redirect; nav⇄access agreement).

### Staging migrations — BOTH APPLIED + VERIFIED in staging ✅
- `20260621120000_feature_rollout_overrides.sql` — applied to staging `eoyenigwevnxwwhyhaer` and verified: table exists; RLS enabled; `anon`/`authenticated` have no direct privileges; `service_role` has intended privileges; PK + unique `(feature_id, environment)` index + supporting indexes + constraints + `updated_at` trigger; recorded in staging history.
- `20260622120000_feature_rollout_search_path.sql` — applied + verified; `feature_rollout_overrides_touch_updated_at()` `proconfig` now contains `search_path=public, pg_temp`; the advisor function-search-path-mutable notice is cleared.
- Production (`vhmnajoeicasaigiophh` / `sfhtlzcgrnrdznhvdrbn`) was NOT migrated. Vercel previews (carup / carup-backend / carup-staging / carup-backend-staging) green on the current head. Application/verification was performed by the release engineer (project administered outside the agent's tooling); the agent records the confirmed result and does not re-apply.

## Round-3 Codex re-review remediation (2 new P2) — 2026-06-22 (after `e778ebc`)
### P2 — honor backend visibility in ALL manifest navigation ✅
- `getDesktopMegaMenu` filtered by lifecycle state only, so a feature-linked node could render when the backend effective state was `enabled:false`/`visible:false`. Added the shared `isNodeBackendBlocked(node, ctx)` (feature-linked + `enabled===false || visible===false` → excluded) used by `getDesktopMegaMenu` — covering Buy/Sell/Verify/Parts/More + (via `flattenSurface`) mobile primary/secondary. Footer + mobile role items already resolve through `resolveFeatureVisibility` (same rule). Direct registry nav (Navbar Dealers/Garages) now uses the new `getVisiblePublicNavigationItems(ctx)`. Planned/coverage-gated/governed-trust behavior preserved (standalone deep-links carry no effective state). **+8 manifest tests** (active+enabled:false absent; active+visible:false absent; tenant/role-denied absent; active present; beta present+flagged; reset restores; More⇄mobile⇄footer agree; coverage-gated Marketplace unaffected).
### P2 — enforce effective accessibility on PUBLIC routes ✅
- `evaluateRouteAccess` checked `accessible:false` only inside the `requiresAuth` block, so **public** routes skipped it. Reordered: lifecycle/enabled gates → auth → role → **effective accessibility (applies to every registered feature, public or protected)** → beta → render. `accessible:false` now yields the unavailable (`disabled`) state for both; protected anonymous/wrong-role still redirect first; protected-under-lifecycle-only boundary left to backend authority; no redirect loops. **+6 routeAccess tests** (public accessible:false blocked / under lifecycle-only too; public enabled:false blocked; public accessible:true renders; public static fallback renders; public nav⇄access agreement) + realistic effective-state test defaults.

## Round-2 Codex re-review remediation (2 new P2) — 2026-06-22 (`348d159`)
### P2 — use the session's verified active role ✅
- `resolveRequestContext` previously read only `user_id` and fell back to `users.role`, so a switched-role session (e.g. owner acting as a verified-tenant dealer) got owner-scoped visibility while the SPA rendered the dealer portal. Now it follows the **switch-role contract**: selects `user_sessions.active_role` + `active_organization_id` and re-verifies — base role when no active_role; accept when `active_role == base`; a switched role requires a verified, role-matching, **non-admin** `tenant_users` membership; stale/unverifiable → least privilege. Client role/tenant headers never authoritative; anonymous preserved; fail-closed. **+11 backend tests** (base/switched/equal/missing-membership/mismatched-role/stale-org/admin-escalation-refused/spoofed-header/expired→anon/effective-nav-reflects-active-role).
### P2 — filter dashboard sidebar by effective visibility ✅
- `DashboardLayout` rendered every `getDashboardItems(role)` entry even when an override disabled/hid it or the backend returned `visible:false`. Now it filters through the **shared `resolveFeatureVisibility(effectiveStates)`** (no duplicated logic): disabled/hidden/tenant-denied/role-denied items are absent; sidebar visibility agrees with the route boundary; beta items remain with a truthful Beta badge. Fixed `owner.evidence-vault` (its `isHidden` meant "exclude from duplicate-route validation" — it shares `/dashboard/garage` — not "hide from nav"; set explicit `lifecycle: active`; manifest regenerated). **+9 sidebar unit tests + Playwright** (spec 27: disabled override removed from sidebar + direct-access disabled page).

### Regression after P1/P2 (2026-06-21)
| Command | Result |
|---|---|
| clean `npm ci` | ✅ exit 0 |
| `npm run test:unit --workspace=web` | ✅ 20 files / **202 tests** |
| `tsc --noEmit -p web/tsconfig.app.json` | ✅ clean |
| `npm run build --workspace=web` | ✅ main JS 2,080.39 kB / gzip 548.85 |
| `node --test backend/tests/feature-governance.test.js backend/tests/server-export.test.js` | ✅ **29** (28 governance incl. P2 + 1 server-export) |
| `git diff --check` | ✅ clean |
| `node backend/tests/run-tests.js` (live integration) | ⛔ **not run** — writes to the shared/production Supabase (plan rule #9); DB-free governance tests + Playwright cover the behavior |

---

## Milestone 1 — Scope correction, documentation & baseline ✅
- Discovery matrix (`NAVIGATION_BLUEPRINT_DISCOVERY_MATRIX.md`) — every nav surface/item inventoried.
- Scope notice added to `docs/features/NAVIGATION_INTELLIGENCE.md` (retitled "Marketplace Truth & Coverage").
- Architecture doc + PR #66 reconciliation (decision: supersede, port concepts) + baseline evidence.
- Baseline (pre-change): web unit 128/128 ✅, tsc ✅, build ✅ (main JS 2,033.89 kB / gzip 536.49), `git diff --check` ✅.
- **Pre-existing failure recorded:** Playwright spec `27` asserted stale dashboard-sidebar counts (owner 11/gov 6/admin 7) vs the real registry (owner 12/gov 8/admin 15). The registry is byte-identical to baseline `c25b094`, so this drift pre-dates this branch. Reconciled in M2.

## Foundation — registry lifecycle + nav model + manifest ✅
- `FeatureLifecycleState` (active|beta|planned|hidden|disabled|deprecated) + deterministic derivation from legacy `isPlanned`/`isHidden`.
- `NavigationSurface` / `NavigationContext` / `EffectiveFeatureState` types; `resolveFeatureVisibility()` (role eligibility never broadened by overrides).
- Framework-neutral `shared/navigation/feature-manifest.json` (82 features) generated by `scripts/generate-feature-manifest.mjs` (esbuild); **drift gate** `featureManifest.drift.test.ts` keeps frontend/backend in sync.
- Centralized `featureIcons.tsx` resolver (DashboardLayout consumes it).

## Milestone 2 — Desktop top navigation & mega-menus ✅
- New `web/src/config/navigationManifest.ts`: `NAVIGATION_MANIFEST` (Buy/Sell/Verify/Parts/More) + selectors `getDesktopMegaMenu`, `getNavigationSections`, `getNavigationItems`, `buildFeatureHref`, `getNavigationPlacements`.
- `Navbar.tsx` migrated: all 5 hardcoded mega-menu arrays + `MenuItem`/`MenuSection` types removed; menus now resolved from the manifest. No hardcoded mega-menu array remains.
- **Truthful classification:**
  - Real make deep-links: Toyota/Honda/Mazda → `?make=…` (KNOWN_MAKES).
  - Real price/sort deep-links: Under $5k/$10k → `?maxPrice`; Highest Trust → `?sort=trust`.
  - Coverage-gated (defer when no eligible inventory): category conditions (brand_new, recently_imported, locally_used, second_hand) + trust tags (dealer_verified, passport_verified, partsentry_checked). Governed-trust links NEVER emit their tag/category without a real coverage signal.
  - `planned` (no marketplace taxonomy exists): body types (SUVs/Pickups/Hatchbacks/Sedans), parts categories (Engines/Gearboxes/…), dedicated parts-selling flows → rendered as muted "Soon", not working links.
- Interaction/a11y preserved: sticky header, Radix keyboard/focus, `aria-expanded`, Escape-to-close; planned items `aria-disabled`.
- **Reconciliation:** spec `27` stale counts updated to live registry (owner 12 / gov 8 / admin 15) — drift fix, not assertion weakening. Verified registry counts via esbuild-built `getDashboardItems`.

### M2 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `vitest run src/config` (web) | ✅ 3 files / 24 tests (route-validation, drift, navigationManifest) |
| `npm run test:unit --workspace=web` | ✅ 14 files / 145 tests |
| `tsc --noEmit -p web/tsconfig.app.json` | ✅ clean |
| `npm run build --workspace=web` | ✅ main JS 2,047.60 kB / gzip 539.06 (Δ +13.7 kB raw / +2.57 kB gzip vs baseline) |
| Playwright `29-navigation-mega-menu` (chromium) | ✅ 7/7 |
| Playwright `27` + `28` (regression) | ✅ 12/12 (after stale-count reconciliation) |

M2 acceptance gate: all desktop mega-menus registry-backed ✅ · unsupported items truthfully planned/coverage-deferred ✅ · Marketplace coverage intact ✅ · no top-nav route points to fabricated functionality (dead-link gate green) ✅ · unit/tsc/build/Playwright pass ✅.

## Milestone 3 — Desktop footer navigation ✅
- `getFooterNavigation(column, ctx)` + `getFooterSocial()` + `FOOTER_SOCIAL` added to `navigationManifest.ts`.
- `Footer.tsx` rewritten to consume governed selectors:
  - Columns Product/Company/Resources/Stakeholders + a new **Legal** section (Privacy/Terms split out of Resources into the bottom bar).
  - **Social fix:** the 4 `href="#"` placeholders replaced with governed, aria-labelled controls. Planned (unconfigured) → accessible disabled `<span role="link" aria-disabled aria-label="CarUp on … — coming soon">`; configured → safe `<a target="_blank" rel="noopener noreferrer">`. No `href="#"` remains.
  - Stakeholders exclude platform admin; map to each role's dashboard root; labels preserved (Bankers, Government, …).
  - Lifecycle/runtime visibility applied (hidden/disabled/planned features excluded via `resolveFeatureVisibility`).
  - A11y: `<nav aria-label>` per column, social `aria-label`s, focus-visible styles, brand `aria-label`.

### M3 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `vitest` footer/nav/route-validation (web) | ✅ footerNavigation 6 tests |
| `npm run test:unit --workspace=web` | ✅ 15 files / 150 tests |
| `tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ main JS 2,050.14 kB / gzip 539.87 |
| Playwright `28` (incl. footer social-safety + Banker) | ✅ 6/6 |

M3 acceptance gate: footer has no placeholder destinations (no href="#") ✅ · every item has a truthful state/source (registry-backed + lifecycle) ✅ · responsive grid retained (cols 2/3/6) ✅ · footer a11y + route tests pass ✅.

## Milestone 4 — Mobile web navigation ✅
- PR #66 reconciliation: **superseded** (per M1 decision); concepts ported (mobile_nav placement, getMobileNavigation, public/auth filtering, role-aware entries, icon resolution, registry-driven rendering). Stale conflicting code NOT merged.
- `getMobileNavigation(ctx)` + `MobileNavigation` + `mobile-primary` manifest nodes added. Mobile drawer uses the SAME registry/manifest as desktop — no hardcoded mobile route array remains.
- New `MobileNavDrawer.tsx` built on the Radix Dialog-backed `Sheet`: aria-modal, **focus trap**, **Escape-to-close**, overlay-click-close, **focus return to trigger**; `aria-current` on active route; 44px touch targets; scrollable; closes after navigation; role switch refreshes items; logout clears protected items.
- Sections: Browse (primary) · Your Dashboard (role items, authed) · More (secondary) · Account (role switch / sign-out, or sign-in / create-account).
- `Navbar.tsx`: inline hardcoded mobile drawer + `mobileOpen` state removed; replaced with `<MobileNavDrawer />`.
- **Native boundary (M4.6):** documented in `NATIVE_NAVIGATION_BOUNDARY.md`. Native Expo tabs intentionally unchanged; the JSON manifest is the bridge; a precise follow-up plan is recorded. Native Navigation Intelligence is NOT claimed complete.

### M4 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `vitest` mobileNavigation (web) | ✅ 12 tests (public + 7-role matrix, no leakage, lifecycle exclusion) |
| `npm run test:unit --workspace=web` | ✅ 16 files / 162 tests |
| `tsc --noEmit` | ✅ clean |
| Playwright `30-mobile-navigation-blueprint` (chromium, 390×844) | ✅ 6/6 (focus trap, Escape+focus-return, role matrix, aria-current, close-on-nav) |

M4 acceptance gate: mobile drawer fully registry-driven ✅ · public + 7-role matrix passes ✅ · no hidden/cross-role leakage ✅ · accessibility (focus trap/Escape/aria-current) + responsive (phone viewport) pass ✅ · no duplicate mobile route source remains ✅.

## Milestone 5 — Shared route boundaries & direct-access enforcement ✅
- Pure evaluator `web/src/lib/routeAccess.ts` (`evaluateRouteAccess`) — the single auditable decision shared by nav visibility AND direct access. Evaluation order: bootstrap → registered → planned/disabled → deprecated(+target) → auth → role → beta → render. Redirect-loop & open-redirect safe (`loginWithReturnTo` reuses `safeReturnTo`).
- Boundary components `RegistryRouteBoundary` / `RequireAuthenticatedUser` / `RequireFrontendRole` + `AuthBootstrapLoading` (small, separately auditable — not one opaque component).
- State pages/notices: `FeaturePlannedPage`, `FeatureDisabledPage`, `FeatureUnavailablePage`, `NotFoundPage`, `FeatureBetaNotice`, `FeatureDeprecatedNotice`.
- `FeatureGovernanceContext` (effective-states provider; empty in M5, hydrated by M6/M7 without blocking first paint).
- Integration:
  - `DashboardLayout` now uses the evaluator (adds the **auth-bootstrap loading gate** + lifecycle handling; preserves the prior auth+role redirects).
  - `MainLayout` wraps its `<Outlet>` in a **lifecycle-only** boundary (`enforceAuth=false`) — planned/disabled/deprecated/beta enforced on public routes without changing existing public-page auth behavior.
  - `App.tsx`: added `FeatureGovernanceProvider` + a **catch-all `*` NotFound route** (previously unknown routes rendered blank).
- `returnTo` sanitization preserved (existing `returnTo.ts`); login redirect now carries `?returnTo=<sanitized>`.

### M5 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `vitest` routeAccess (web) | ✅ 12 tests (all evaluation-order cases incl. no-redirect-loop, return-to sanitization) |
| `npm run test:unit --workspace=web` | ✅ 17 files / 174 tests |
| `tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ main JS 2,057.09 kB / gzip 542.21 |
| Playwright `31-navigation-route-boundary` (chromium) | ✅ 5/5 (unauth redirect+return-to, wrong-role redirect, correct-role render, NotFound, public render) |
| Playwright `27`+`28`+`30` (regression) | ✅ 19/19 (no dashboard/role-switch/mobile regression) |

M5 acceptance gate: repeated guard logic centralized ✅ · direct access + nav visibility use the same effective-state decision ✅ · existing active routes behave identically (regression green) ✅ · auth + return-to regressions pass ✅.

## Milestone 6 — Feature lifecycle, rollout persistence & backend governance ✅
- **Migration** `database/migrations/20260621120000_feature_rollout_overrides.sql` — idempotent (`IF NOT EXISTS`), CHECK constraints (env, lifecycle, time-window, version≥1), unique `(feature_id, environment)`, indexes, `updated_at` trigger, **RLS enabled + service_role-only grants**. **STAGING-ONLY — NOT applied** (the live shared Supabase must not be migrated without Product Owner approval; rollback documented in the runbook).
- **Service** `backend/services/featureGovernance/featureGovernanceService.js`:
  - Pure `evaluateEffectiveState` (override overlay on static manifest) — runtime override can DISABLE/restrict but **never broaden roles beyond `immutableRoles`** (intersection enforced); tenant allow/deny; time windows; deprecation target.
  - Pure `validateOverridePatch` (unknown feature, invalid env/lifecycle/tenant/window, role-expansion denial).
  - `sanitizeEffective` strips internal reason/roles/tenant data for non-admin callers.
  - CRUD with **optimistic concurrency** (`version`), short bounded cache (`invalidateOverrideCache` on mutation), **safe fallback to static defaults on storage failure** (disabled never becomes enabled), audit via existing `logAuditEvent` → `trust_audit_events` (`FEATURE_ROLLOUT_*`).
  - Reads the framework-neutral `shared/navigation/feature-manifest.json` (no web import).
- **API** `backend/routes/featureGovernanceRoutes.js` mounted in `server.js`:
  `GET /api/features/effective` (public, sanitized, non-blocking) · `GET /api/admin/features` · `GET /api/admin/features/:id` · `GET /api/admin/features/:id/audit` · `PATCH /api/admin/features/:id/rollout` · `DELETE /api/admin/features/:id/rollout`. **All mutations + admin reads guarded by `authorizeRole(['admin'])`** (server-derived from `user_sessions`→`users`; client role headers never grant access; non-admin/spoofed-role denial enforced by the existing, separately-tested middleware).
- **Frontend hydration**: `FeatureGovernanceLoader` fetches `/api/features/effective` **without blocking first paint** (static defaults render immediately; failed fetch keeps static defaults). Navbar, Footer, MobileNavDrawer and the route boundaries all consume `useFeatureEffectiveStates()`, so a runtime override controls nav visibility AND direct access consistently.

### M6 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `node --test backend/tests/feature-governance.test.js` | ✅ 17/17 (evaluator, validation, immutable-role denial, tenant/time gating, version conflict, **storage-failure fallback**, cache invalidation, audit emission, sanitized output) — run with an in-memory **fake client (no live DB)** |
| `node --test backend/tests/server-export.test.js` | ✅ 1/1 (server loads with new router mounted) |
| `tsc --noEmit` (web) | ✅ clean |
| `npm run test:unit --workspace=web` | ✅ 17 files / 174 tests |
| `npm run build` | ✅ main JS 2,057.59 kB / gzip 542.32 |
| Playwright `28`+`30`+`31` (regression after effective-state wiring) | ✅ 17/17 |

M6 acceptance gate: lifecycle coherent/normalized ✅ · authorization + audit proven (unit, fake-client) ✅ · effective state controls nav + direct access consistently ✅ · safe fallback tested ✅ · runtime override persistence in staging — **pending PO-approved staging migration** (M8.5).

## Milestone 7 — Admin Feature Governance Console ✅
- Registered `admin.features` feature (route `/admin/features`, roles `['admin']`, dashboard-sidebar, label "Feature Governance", absent from non-admin nav). Manifest regenerated (83 features); App route added under the admin `DashboardLayout` (backend independently enforces access).
- `useFeatureGovernanceApi` hook (reuses shared `apiRequest` auth+CSRF; **memoized** return to prevent reload loops) — list/get/audit/update/reset.
- `FeatureGovernanceConsole.tsx`: environment selector; list (id/label/route/domain/static+effective lifecycle/enabled/override status/version/updated-by); filters (search, lifecycle, domain, override status); read-only detail (static metadata, immutable role bound, nav surfaces, current override, audit history); mutation form (lifecycle, enabled, **roles bounded to immutable policy — out-of-bound roles disabled**, tenant allow/deny, time window, beta message, reason); **before/after confirmation** AlertDialog for save & reset; **version-conflict** handling; UX states (loading/empty/error/permission-denied/conflict/success/reset/audit-loading/audit-error); responsive table↔cards; a11y (labelled controls, Radix focus-managed dialogs, status text not colour-only).
- Backend route returns distinguishable `version_conflict` error code for the client.

### M7 test results (run 2026-06-21)
| Command | Result |
|---|---|
| `vitest` FeatureGovernanceConsole.test.tsx (RTL, mocked hook) | ✅ 9 it() (list, loading, filters, detail open, **immutable-role checkbox disabled**, save→confirm→updateRollout, version-conflict UI, permission-denied) |
| `npm run test:unit --workspace=web` | ✅ 19 files / 192 tests |
| `tsc --noEmit` + `npm run build` | ✅ clean / main JS 2,079.35 kB / gzip 548.45 |
| Playwright `32-feature-governance-console` (chromium, mocked API) | ✅ 6/6 (open, search, detail, **PATCH** create, **DELETE** reset, **non-admin redirected away**) |
| Playwright `27` (admin sidebar now 16 with Feature Governance) | ✅ 7/7 |
| **Bug caught by adversarial E2E:** hook returned a fresh object each render → `useEffect` reload loop → fixed via `useMemo`. CSRF-token mock was missing in the spec (the mutation is correctly CSRF-protected) → added. |

M7 acceptance gate: console uses real persistence + APIs ✅ · only trusted admins can mutate (server-derived + E2E non-admin denied) ✅ · changes auditable + conflict-safe ✅ · navigation responds to overrides (effective-state wiring) ✅ · a11y + E2E pass ✅.

## Milestone 8 — Convergence, CI, adversarial review & remediation ✅
- **CI gates:** `navigationCiGates.test.ts` (10) — valid surfaces/icons/lifecycle, no duplicate menu order, no auth-required feature exposed publicly, unique ids, governed social, **coverage-gate mutual exclusion**. `.github/workflows/navigation-intelligence-ci.yml` runs manifest drift `--check`, web tsc, web unit (incl. gates), build, DB-free backend governance + server-export.
- **Adversarial whole-branch review (Workflow):** 5 dimensions × find→verify, 22 agents. **17 findings → 10 confirmed, 7 rejected/already-mitigated.** The verification stage corrected several reviewer inaccuracies (e.g. dead-code fix detail, role-switch mechanism). The **leakage/truthfulness** dimension was re-run after a mid-response failure and found **no real issues** (selectors correctly gate every non-active state; no cross-role leakage; governed-trust never heuristically activated; no fabricated routes).
- **Confirmed findings remediated:**
  1. *(route boundary)* `evaluateRouteAccess` ignored the `enabled` kill-switch → a runtime-disabled feature was hidden in nav but still directly reachable by URL. **Fixed:** honor `effectiveStates[id].enabled === false` → disabled (nav & direct-access now consistent). Tenant gating documented as backend-authoritative (tenant lists are intentionally not sent to the client). +unit test.
  2. *(backend safety)* `readOverrides` failed **open** on a storage read error (a runtime-disabled feature reverted to its static-enabled default). **Fixed:** fail-safe — serve last-good cache on read error so a kill-switch survives a transient outage; static defaults only on a cold cache. +unit test (`FAIL-SAFE: runtime DISABLE survives a read outage`).
  3. *(beta banner)* `render-beta` read the stripped `reasonCode` → message always undefined. **Fixed:** read `betaMessage`. +unit test.
  4. *(role switch)* `switchRole` swallowed errors → on failure the drawer/navbar navigated to a role never switched into, silently. **Fixed:** `switchRole` re-throws; drawer/Navbar/DashboardLayout skip navigation and surface an accessible `toast.error`.
  5–10. *(low)* coverage-gate mutual-exclusion CI gate added; mobile drawer `SheetDescription` (sr-only) added; console lifecycle badges now carry distinguishing icons (planned vs hidden) + misleading comment removed; policy-locked role rows get a lock icon + title; the plan-mandated `RequireAuthenticatedUser`/`RequireFrontendRole` boundaries are now exercised by a unit test (no longer dead code).
- **Rejected (correctly, by verification):** client-supplied `environment` "trust" (server uses it only as a scoping key; authz is server-derived), pre-existing diaspora-admin routes under public layout (out of scope, backend-authoritative), frontend can't apply role-narrowing overrides (by design — backend authoritative), drift check "not in CI" (it is), deprecation 2-cycle (latent, defense-in-depth), localeCompare manifest ordering (stable for ASCII ids), spec 27 count change (genuine, already reconciled).

### M8 test results (run 2026-06-21, post-remediation)
| Command | Result |
|---|---|
| `npm run test:unit --workspace=web` | ✅ 20 files / **199 tests** |
| `tsc --noEmit` + `npm run build` | ✅ clean / main JS 2,079.98 kB / gzip 548.66 |
| `git diff --check` | ✅ clean |
| `node --test backend/tests/feature-governance.test.js backend/tests/server-export.test.js` | ✅ **18 + 1** (incl. fail-safe) |
| Playwright nav suites 27–32 (chromium) | ✅ green per-spec (consolidated parallel run may show cold-start flakes; CI uses `retries: 2`) |

M8 acceptance gate: full local regression green ✅ · CI gates added ✅ · adversarial review run + confirmed findings fixed ✅ · performance/rollback/UAT/staging docs complete ✅ · staging deploy + migration + PO UAT **pending PO/infra (documented)** ✅ · one reviewable PR (next) — not auto-merged.

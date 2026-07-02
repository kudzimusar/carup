# Navigation Intelligence — Full-Completion Discovery

> Mandatory discovery deliverable for
> `docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_FULL_COMPLETION_FASTTRACK_PLAN.md` (§3).
> Read-only inventory taken on branch `codex/navigation-intelligence-blueprint-completion`
> (head `f178dc1`). No screen, route, or capability described below is fabricated — every
> "real" classification is evidence-backed with file:line. Items marked **BLOCKER** must be
> fixed during implementation.

---

## 1. Native route inventory (`mobile/`)

Expo SDK `~54.0.0`, `expo-router ~6.0.24`, `typedRoutes: true`. `react-native-reanimated ~4.1.1`
+ `react-native-gesture-handler ~2.28.0` + `react-native-screens` + `react-native-safe-area-context`
are present (drawer is feasible); **`@react-navigation/drawer` is NOT installed**.

| Expo route | File | Real? | Owning feature (web) | Auth | Tab/placement | Web equivalent |
|---|---|---|---|---|---|---|
| `/(tabs)/index` | `app/(tabs)/index.tsx` | **REAL** (120 ln; role switcher, logout) | `owner.dashboard` (role dashboard) | protected | Tab: Dashboard | `/dashboard` |
| `/(tabs)/garage` | `app/(tabs)/garage.tsx` | **REAL** (347 ln; fleet, odometer, service history) | `owner.garage` | protected | Tab: Garage | `/dashboard/garage` |
| `/(tabs)/escrow` | `app/(tabs)/escrow.tsx` | **REAL** (273 ln; SafePay milestones) | `product.safepay` / `owner.safepay` | protected | Tab: Escrow | `/dashboard/safepay` |
| `/(tabs)/marketplace` | `app/(tabs)/marketplace.tsx` | **REAL** (134 ln; FlashList, canonical API) | `product.marketplace` | public | Tab: Marketplace | `/marketplace` |
| `/(tabs)/referral` | `app/(tabs)/referral.tsx` | **REAL** (270+ ln; wallet, share, dispute) | `owner.referrals` | protected | Tab: Referrals | `/dashboard/referrals` |
| `/vehicle/[vin]` | `app/vehicle/[vin].tsx` | **REAL** (trust score, listing detail, inquiry) | `product.marketplace` | public | deep-link | `/marketplace/:vin` |
| `/(auth)/login` | `app/(auth)/login.tsx` | **REAL** (CSRF, `LoginSchema`) | `auth.login` | public | — | `/auth/login` |
| `/(auth)/register` | `app/(auth)/register.tsx` | **REAL** (`RegisterSchema`) | `auth.register` | public | — | `/auth/register` |
| `/(auth)/biometric` | `app/(auth)/biometric.tsx` | **REAL** | `auth.biometric` | protected | — | — |
| `/(auth)/verification/*` | 9 screens (intro→result) | **REAL** (~1,750 ln total) | `auth.verification` | protected | — | `/dashboard/verification` |

**Current nav structure** — `app/(tabs)/_layout.tsx` (63 ln) is a **static** `expo-router` `Tabs` list of 5
fixed `Tabs.Screen` (index/garage/escrow/marketplace/referral). No lifecycle/role/backend filtering.
Auth gate is at the root (`app/_layout.tsx` `SecureSessionProvider`, (auth) vs (tabs) stacks). Role
switching happens *inside* the dashboard screen, not at nav level.

**Auth + API** — session in `expo-secure-store` (`carup_secure_user` / `carup_secure_token`,
`mobile/store/authStore.ts`). **Canonical API base resolver = `getVerificationApiBaseUrl(env, platformOS)`**
in `mobile/utils/verificationApi.ts:56` (validates `EXPO_PUBLIC_API_URL`, rejects localhost on device
unless `EXPO_PUBLIC_ALLOW_LOCALHOST_API=true`); already reused by `marketplaceApi.ts:11` and
`referralApi.ts:13`.

> **BLOCKER (native localhost) — must fix in Milestone A:** hardcoded `http://localhost:5001` in
> `mobile/store/authStore.ts:83` (`switchRole`), `app/(tabs)/garage.tsx:49,66`, `app/(tabs)/escrow.tsx:30,46`,
> `app/(auth)/register.tsx:31`. These bypass the canonical resolver and break physical devices. Route them
> through the canonical base resolver (extracted to a shared `mobile/utils/apiBase.ts`).

**Shared manifest** — `shared/navigation/feature-manifest.json` exists (≈21.8 KB; array of
`{id, domain, route, defaultLifecycle, defaultRoles, immutableRoles, requiresAuth, betaCapable}`).
Mobile currently imports only `@shared/types` and `@shared/schemas` — **it does not yet consume the
feature manifest**; that is Milestone A.

---

## 2. Web performance inventory

- **Console import is EAGER:** `web/src/App.tsx:96` `import FeatureGovernanceConsole from './pages/dashboard/admin/FeatureGovernanceConsole'`, routed at `App.tsx:278` (`/admin/features`). **No `React.lazy()` exists anywhere in the app** — every admin route (`/admin`, `/admin/users`, `/admin/ai`, `/admin/moderation`, `/admin/evidence`, `/admin/trust-review`, `/admin/referrals/*`) is eager.
- **Bundle is monolithic:** `web/dist/assets/index-*.js` ≈ **2,083,291 bytes (2.0 MB)** raw, single chunk; `web/vite.config.ts` has **no `manualChunks`**/rollup output config.
- **Console size:** `FeatureGovernanceConsole.tsx` 418 ln + `useFeatureGovernanceApi.ts` 149 ln; deps `sonner`, `lucide-react`, shadcn `Dialog`/`AlertDialog` (Dialog/AlertDialog may be first use → ~10–15 KB each).
- **Reusable loading/error UI:** `Spinner` (`web/src/components/ui/spinner.tsx`, `role=status`), `AuthBootstrapLoading` (`RegistryRouteBoundary.tsx:23`, `aria-live=polite`), `Shell` pattern in `FeatureStatePages.tsx`. **No global ErrorBoundary exists** → must add a retryable chunk-error boundary for lazy load.
- **Tests / CI:** console E2E in `tests/agents/32-feature-governance-console.spec.ts` (mocks `/api/admin/features*` via `page.route`, auth via `addInitScript` — will still pass post-split). **No CI chunk-split assertion exists.**

→ **Milestone D**: `React.lazy` + `Suspense(AuthBootstrapLoading)` + new retryable chunk-error boundary; keep authorization before content; preload for verified admin on idle/hover; add a stable "console is a separate chunk" CI assertion (no hashed filename).

---

## 3. Analytics inventory

- **Existing telemetry to reuse (not duplicate):** `backend/middleware/telemetryMiddleware.js` (latency), `backend/services/metrics.js` (`OperationsMetricsHub`, in-memory), `backend/middleware/securityMiddleware.js` `rateLimiter({max,windowMs,isSensitive})` (per-IP, 429, audit-logs), `backend/middleware/correlationMiddleware.js` (`x-request-id`).
- **Audit convention:** `backend/services/auditLogger.js` `logAuditEvent(client, event)` → `trust_audit_events` (columns incl. `event_type, previous_value/new_value (JSONB, redacted), actor_user_id/role/tenant_id, source_route, reason, request_id`). `redact()` strips password/token/secret/etc. New analytics audit events use `event_type: 'NAVIGATION_ANALYTICS_*'`.
- **Migration template + standard structure** (RLS enable, `REVOKE anon/authenticated`, `GRANT service_role`, CHECK constraints, unique index, supporting indexes, `updated_at` trigger): copy `database/migrations/20260621120000_feature_rollout_overrides.sql`. Naming: `YYYYMMDDHHMMSS_name.sql`.
- **Service/route/test patterns:** services take an injectable `client` (default `supabase` from `backend/db/supabase.js`); routes registered in `backend/server.js` (`app.use(featureGovernanceRouter)`); admin guarded by `authorizeRole(['admin'])` (`backend/middleware/authMiddleware.js`, server-derives role from `user_sessions`→`users`, tenant from `tenant_users`). DB-free tests use the in-memory fake client in `backend/tests/feature-governance.test.js`.
- **Route-pattern validation for sanitization:** `getFeatureByRoute()` / `matchRoutePattern()` (web `featureRegistry.ts`) + the manifest node IDs (`navigationManifest.ts`) are the **only** values analytics may store as source/destination.

→ **Milestone F**: minimized event taxonomy; staging-first analytics table (RLS, service-role writes, time/feature/type/surface/platform indexes); bounded batch ingestion (allowlisted schema, count/size caps, rate limit, route-pattern sanitization, idempotency, never blocks nav); admin-only aggregates; bounded web + native clients; admin Analytics panel; DB-free tests.

**Excluded fields (hard rule):** no names, email, phone, VIN, tokens, free text, raw tenant IDs, or unnecessary device IDs. Store only schema-version, event-type, feature/node ID, surface, **registered** source/destination route pattern, platform, coarse role category, lifecycle/reason code, build version, timestamp.

---

## 4. Rollout inventory

- **Schema** (`database/migrations/20260621120000_feature_rollout_overrides.sql`): `feature_rollout_overrides(id, feature_id, environment, lifecycle_state, enabled, allowed_roles[], allowed_tenant_ids[], denied_tenant_ids[], starts_at, ends_at, beta_message, reason, created_by, updated_by, created_at, updated_at, version)`, unique `(feature_id, environment)`, env/lifecycle/window/version CHECKs, `updated_at` trigger, RLS + service-role only.
- **Evaluator** (`backend/services/featureGovernance/featureGovernanceService.js` `evaluateEffectiveState`, ~ln 188–231) gate order: static lifecycle → override lifecycle/`enabled` → immutable-role intersection (never broadens) → role eligibility → tenant allow/deny → `visible`/`accessible`. **Percentage gate must be inserted AFTER tenant rules and BEFORE final visible/accessible, and must only narrow.**
- **Trusted subject** (`resolveRequestContext`, ~ln 55–106): server-verified `user_id`, `active_role`, `active_organization_id` from `user_sessions` (client role/tenant headers never trusted); anonymous → `{role:null, tenantId:null}`; fail-closed.
- **Cache** (`readOverrides`, ~ln 248–279): per-**environment**, 30 s TTL, **fail-safe** (serve last-good on read error; static defaults only on cold start). Frontend `FeatureGovernanceContext.tsx` keys the effective map per identity (`${user?.id ?? 'anon'}|${token}`).
- **No anonymous cohort/visitor-id concept exists yet** → Milestone G must add a stable, opaque anonymous web cohort (localStorage) and a random native installation cohort (SecureStore). The cohort is **not** authentication.
- **Effective-state shape** `EffectiveFeatureState {featureId,state,enabled,visible,accessible,beta,reasonCode?,deprecatedTo?,betaMessage?}` (web `featureRegistry.ts`); consumed by `routeAccess.ts`, `navigationManifest.ts`, `useFeatureGovernanceApi.ts`; backend `sanitizeEffective()` strips internal fields. Percentage is an **input** to the evaluator; it must not leak the raw subject in the response.
- **Admin mutation:** `PATCH /api/admin/features/:featureId/rollout` (`authorizeRole(['admin'])`, optimistic `expectedVersion`, 409 conflict); `RolloutPatch` currently `{environment, lifecycle_state, enabled, allowed_roles, allowed_tenant_ids, denied_tenant_ids, starts_at, ends_at, beta_message, reason}` → extend with `rollout_percentage`, `rollout_seed`.

→ **Milestone G**: staging-first migration adds `rollout_percentage SMALLINT NOT NULL DEFAULT 100` + `rollout_seed TEXT`; one stable server-side hash over `(feature, environment, seed, stable-subject)`; never per-request random; deterministic, cache-isolated; API/console/audit/web/native + distribution tests.

---

## 5. Accessibility inventory

`@axe-core/playwright` is **not** a dependency; no automated a11y test exists. Radix `Dialog`/`Sheet`/`DropdownMenu`
already provide focus-trap + Escape + focus-return + `aria-expanded` (keep). Findings:

| Severity | Surface | Finding | file:line |
|---|---|---|---|
| **blocker** | Navbar | notification bell icon-button has no `aria-label` | `Navbar.tsx:216` |
| **blocker** | Dashboard | sidebar close (X) button no `aria-label` | `DashboardLayout.tsx:115` |
| **blocker** | Dashboard | sidebar open toggle no `aria-label` | `DashboardLayout.tsx:222` |
| **blocker** | Native | tabs lack `accessibilityRole`/`Label`/`State` | `mobile/app/(tabs)/_layout.tsx` |
| **blocker** | Native | dashboard Pressables lack `accessible`/`accessibilityLabel` | `mobile/app/(tabs)/index.tsx:53` |
| fast-fix | Navbar | decorative `ChevronDown` needs `aria-hidden` | `Navbar.tsx:68` |
| fast-fix | Navbar | currency dropdown no `aria-label` | `Navbar.tsx:200` |
| fast-fix | Drawer | decorative icons need `aria-hidden` | `MobileNavDrawer.tsx:84` |
| fast-fix | Sidebar | active link missing `aria-current="page"` | `DashboardLayout.tsx:168` |
| fast-fix | global | animations not wrapped in `prefers-reduced-motion` | tailwind/ui primitives |
| OK | Footer, FeatureStatePages, Console badges/filters, Radix dialogs | already accessible | — |

→ **Milestone H**: fix blockers + fast-fixes; add `@axe-core/playwright` automated checks on the 9 surfaces; native `accessibilityRole/Label/State` + Dynamic Type (no global font-scale disable); honest manual-evidence table.

---

## Cross-cutting decisions

1. **Shared contract first.** Native consumes `shared/navigation/feature-manifest.json` (the existing array shape) via a native adapter — no browser imports. Percentage/analytics types are added to shared where both web and native need them.
2. **Authorization unchanged.** All new admin endpoints reuse `authorizeRole(['admin'])`; percentage rollout and analytics never broaden role/tenant access; lazy-loading must keep authz before protected content renders.
3. **Privacy by construction.** Analytics stores only registered route patterns + sanitized enums; ingestion validates against the manifest.
4. **Determinism.** Rollout uses a stable server-side hash, never per-request randomness; native cohort is a locally-stored random installation id (not identity).
5. **Staging-first migrations.** New analytics + rollout-percentage migrations are applied to staging `eoyenigwevnxwwhyhaer` only; production untouched.
6. **No fabrication.** Native tabs/drawer expose only the real screens inventoried above; a role with no native-specific work screen uses the real generic Dashboard or exposes routes via More/Drawer — never a decorative empty page.

## Shared-file serialization (per plan §2.7)

Changes to `web/src/App.tsx`, `featureRegistry.ts`, `navigationManifest.ts`, `FeatureGovernanceContext.tsx`,
`backend/services/featureGovernance/featureGovernanceService.js`, `backend/routes/featureGovernanceRoutes.js`,
`backend/server.js`, `mobile/app/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx`, package manifests, and
`database/migrations/*` are serialized through the lead integrator to avoid conflicts.

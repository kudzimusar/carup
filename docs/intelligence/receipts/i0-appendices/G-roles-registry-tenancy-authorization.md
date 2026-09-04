# I0 Audit — Roles, Feature Registry, Tenancy & Authorization (repo @ feat/carup-intelligence-1-0 == main@ba208963)

## 1. FORMAL ROLE MODEL

### 1.1 Canonical platform roles (7)
- Type: `shared/types/index.ts:1` — `UserRole = 'owner' | 'dealer' | 'mechanic' | 'bank' | 'insurance' | 'government' | 'admin'`
- DB enforcement: `database/migrations/supabase_schema.sql:19` — `users.role` CHECK constrains to exactly these 7. `subscription` (Free/Premium/Enterprise/System) is separate (`supabase_schema.sql:23`).
- Public registration is server-forced to `'owner'`; any other requested role → 403 (`backend/server.js:2080-2090`, `PUBLIC_REGISTRATION_ROLE`).
- Role display/dashboard metadata: `web/src/config/featureRegistry.ts:276-284` (`ROLE_METADATA`: owner→/dashboard, dealer→/dealer, mechanic→/mechanic, insurance→/insurance-dash, government→/government, admin→/admin, bank→/bank).

### 1.2 Extra role vocabularies that exist ONLY in backend gate lists (not in users.role CHECK)
- `buyer`, `reviewer`, `member` — appear in `authorizeRole([...])` lists (e.g. escrowProviderRoutes.js:26,45; fraudRoutes.js:19 `QUEUE_ROLES=['admin','government','reviewer']`). Reachable only as **tenant roles** (`tenant_users.role` is free TEXT, `002_multi_tenant_and_auth_schema.sql:25`) assumed via role-switch/x-stakeholder-role, since `users.role` cannot hold them.
- `platform_admin`, `super_admin`, `government_reviewer` — in `PLATFORM_ADMIN_ROLES` (`backend/middleware/authMiddleware.js:11`) and diaspora sets (`backend/services/diaspora/diasporaAuthorization.js:4-23`). Unrepresentable in `users.role` under the CHECK; defined defensively.
- Referral `OPERATOR_ROLES` (`backend/routes/referralRoutes.js:16`) additionally names `seller`, `agent`, `manager`, `operator`, `route_agent`, `marketing_manager`, `trust_manager`, `compliance_manager` — none exist as platform roles; reachable only as tenant roles.
- `finance` in `authorizeRole(['admin','finance','bank'])` (lender/finance routes) — not a platform role.

### 1.3 Feature Registry (web navigation + route gating)
- `web/src/config/featureRegistry.ts` (1663 lines, **102 features**, `id: '...'` count). Fields per item: id, domain (13 domains, lines 53-66), route, roles (UserRole[]), placements, lifecycle. Lifecycle states: active|beta|planned|hidden|disabled|deprecated (lines 90-105). Navigation surfaces model: lines 114-132. Mirrored framework-neutral manifest consumed by backend: `shared/navigation/feature-manifest.json` (102 entries; fields defaultRoles/immutableRoles/requiresAuth; immutableRoles drawn only from the 7 canonical roles).
- Role → surface gating (representative): owner-only ~13 features (lines 294-425); dealer (439-490); mechanic (502-543); insurance (555-586); government (599-639); admin (651-861); bank (1047-1078); diaspora features owner/dealer/admin/government mixes (868-993); public features `roles: []` (~30 entries, 1090-1330).
- Frontend enforcement: single pure evaluator `web/src/lib/routeAccess.ts:136` `evaluateRouteAccess` (order: loading → registered? → lifecycle → deprecated redirect → auth → role → effective accessibility → beta). Consumed by `web/src/components/layout/DashboardLayout.tsx:79` and `web/src/components/routing/RegistryRouteBoundary.tsx:55`. Sidebar visibility uses same effective states (DashboardLayout.tsx:60-75). Explicitly "never replaces backend authorization" (routeAccess.ts:6-7).

### 1.4 Backend route gating
- Core middleware: `backend/middleware/authMiddleware.js` — `authorizeRole(allowedRoles)` (line 87): session token (`user_sessions` lookup) → `users.role` → optional `x-tenant-id` verified against `tenant_users` → `resolveEffectiveRole` (line 65: requested `x-stakeholder-role` honoured only if == platform role, or == verified tenant role and ≠ 'admin') → allow if effectiveRole in list OR platformRole ∈ PLATFORM_ADMIN_ROLES (line 172). Variants: `authorizeSessionRole` (line 204, no x-user-id fallback), `requireProvenIdentity` (line 42, refuses header-asserted identity for private-document/signed-URL issuers), `optionalAuth` (line 214, anonymous-tolerant).
- Dev fallback: `x-user-id` header accepted when `NODE_ENV ∈ {test,development,local}` or `CARUP_ALLOW_X_USER_ID_FALLBACK=true` (lines 54-63); recorded as `authenticationMethod='x-user-id-fallback'` (see staging NODE_ENV=test hazard history).
- Gate-list census across backend/routes+server.js: 33× `['admin']`, 20× `[]` (auth-only), 15× `['owner','dealer','admin']`, 14× `['admin','government']`, plus buyer/reviewer/diaspora mixes (full tally captured; every list implicitly bypassed by platform admin).

### 1.5 Role switching
- Endpoint: `POST /api/auth/switch-role` (`backend/server.js:361-457`; rate-limited 5/min at server.js:191). Rules: self-only (userId must equal session user), role must be in the 7-role approved catalog (server.js:391), tenant switch requires verified `tenant_users` membership, `canAssumeRequestedRole` = role==users.role OR (== verified tenantRole AND ≠ 'admin'). Mints a NEW `user_sessions` row with `active_role` + `active_organization_id`.
- Audit: `logAuditEvent` → `trust_audit_events` (authoritative) + best-effort FK-safe legacy mirror `organization_audit_logs` (`backend/services/auditLogger.js:209,233,130-215`). **`role_switch_logs` table exists** (`database/migrations/003_add_user_sessions.sql:18`, `supabase_schema.sql:289`) **but no backend runtime code writes it** — schema-only artifact.
- Mobile: role switch UI limited to owner/dealer/mechanic (`mobile/app/(tabs)/index.tsx:28`).

## 2. TENANCY & SCOPE DERIVATION

### 2.1 Model
- Two overlapping org models: **tenants** (active: `tenants`, `tenant_users` role TEXT default 'member', settings/branding/feature_flags/billing/api_keys — `002_multi_tenant_and_auth_schema.sql:11-69`) and **legacy organizations** (`organizations` type CHECK dealership|garage|insurance|bank|fleet|import|government + profiles/roles/users/permissions/branches/departments/audit_logs/ai_agents — `supabase_schema.sql:163-250`). Organizations map to tenants via `organizations.tenant_id` (`002_…sql:199`). `organization_roles`/`organization_permissions` are written at seed (`backend/db/database.js:330`) and read only for staff display (`server.js:1899`) — **no backend permission checks consume organization_permissions**.
- Server-side derivation (authoritative paths):
  - `authorizeRole`: tenant context comes from client `x-tenant-id` but is **verified** against `tenant_users` membership before entering `req.userContext.tenantId` (authMiddleware.js:150-162); 403 if not a member.
  - Session-carried switched context: `user_sessions.active_role`/`active_organization_id` re-verified per request by `resolveRequestContext` (`backend/services/featureGovernance/featureGovernanceService.js:57-112`) with least-privilege fallback; header roles never authoritative.
  - Diaspora Trade Graph: `tenantOf(req)` = verified `req.userContext.tenantId` only, else 403 (`backend/routes/diasporaTradeGraphRoutes.js:136-142`); `sellerId` query param (line 345) is evaluated inside tenant-scoped node resolution.
  - Diaspora order access: participant/buyer/tenant-membership checks in `diasporaAuthorization.js` (PLATFORM_REVIEW_ROLES / TENANT_ADMIN_ROLES; buyer cannot approve reservations, lines 83-87).
  - Communication: participant-based (`assertParticipantAccess`, communicationBaseRoutes.js:128,164); thread tenant is `thread.tenant_id`, "never reassigned for routing" (`emailStakeholderMatrix.js:33`).
  - Vehicle add stamps tenant server-side for dealers (noted at featureRegistry.ts:1348-1350).
- RLS helpers (defense-in-depth; backend uses service_role which **bypasses RLS**, and CarUp auth is custom — `auth.uid()`/`auth.jwt()` are null for the anon-key path, so these policies are effectively inert for the primary runtime):
  - `current_tenant_id()` ← `current_setting('app.current_tenant')` (`002_…sql:170`; search_path-pinned re-issue `20260620232827_issue77_…sql`). No backend code sets `app.current_tenant`.
  - `is_diaspora_platform_admin()` ← JWT role ∈ (admin, government) (013 + 20260620232827).
  - `diaspora_can_access_order()`, `diaspora_trade_os_current_user_id()/is_platform_admin()/is_tenant_member()/can_access_row()` (013, 014, 20260611061849, 20260619201406).
  - Vehicle RLS example policy `tenant_vehicles_isolation` (`002_…sql:176-181`). `feature_rollout_overrides` is service_role-only RLS (`20260621120000_feature_rollout_overrides.sql:73-77`).

### 2.2 Client-supplied tenant/seller/org IDs trusted for privileged reads — RISKS
- **RISK (unauthenticated org PII read)**: `GET /api/organizations/:id/users` has **no auth middleware**; returns staff `users.name/email/avatar` + org role for any client-supplied org id — `backend/server.js:1891-1907`. Same pattern `GET /api/organizations/:id/branches` (server.js:1876, lower sensitivity). Contrast: `/api/organizations/:id/audit-logs` correctly verifies membership (server.js:1910-1935).
- **RISK (cross-tenant filter under broad role list)**: referral admin listings accept `req.query.tenant_id` verbatim, preferred over the verified `userContext.tenantId`, gated only by `OPERATOR_ROLES` which includes plain `dealer` — `backend/routes/referralRoutes.js:116,133,252,291,434,468,512` (`OPERATOR_ROLES` at :16). A dealer (or any tenant with role 'seller'/'agent'…) can enumerate other tenants' campaigns/codes/timeline. `/trust/disputes` also takes `req.query.user_id` (:438).
- **RISK (audit attribution, not read scope)**: raw `x-tenant-id` header used for audit `actor_tenant_id` fallback without membership check — `backend/routes/communicationBaseRoutes.js:23-25`, `backend/routes/promotionsRoutes.js:53`, `backend/services/communication/communicationCompletionRoutes.js:12`. Mitigated in the legacy org mirror by membership validation (`auditLogger.js:131-162`), but the primary `trust_audit_events` row records the unverified value.
- Lower severity / privileged-role-bounded: `GET /api/fraud/cases?tenant_id=` cross-tenant filter but admin/government/reviewer only (`fraudRoutes.js:40-45`); mobile-certification matrix `tenant_id` query, admin/government only (`mobileCertificationRoutes.js:15-21`); scheduler `tenantId` body/query but platform-admin-predicate gated (`diasporaSchedulerRoutes.js:141-196`).
- Non-risk note: `optionalAuth` copies raw `x-tenant-id` into `userContext.tenantId` unvalidated (`authMiddleware.js:247`) — safe only while optionalAuth consumers stay non-privileged; any future privileged read off that field would trust a client tenant claim.

### 2.3 Feature rollout (governance overlay)
- Table `feature_rollout_overrides` (`20260621120000_feature_rollout_overrides.sql:15-44`): per feature×environment; lifecycle_state, enabled kill-switch, allowed_roles (can only NARROW immutableRoles — `validateOverridePatch`, featureGovernanceService.js:149+), allowed/denied_tenant_ids, time window, beta_message, version (optimistic concurrency); +percentage rollout & seed (`20260623120000`). RLS: service_role only.
- Service `backend/services/featureGovernance/featureGovernanceService.js`: static manifest + override ⇒ EffectiveFeatureState; 30s cache; fail-closed on read failure (disabled never becomes enabled). Anonymous cohort bucketing via non-auth `x-nav-cohort` header (lines 60-64).
- Endpoints: public sanitized `GET /api/features/effective` (featureGovernanceRoutes.js:52, uses `resolveRequestContext`); admin console CRUD `GET/PATCH/DELETE /api/admin/features*` all `authorizeRole(['admin'])` (featureGovernanceRoutes.js:65-102). Web console: `web/src/pages/dashboard/admin/FeatureGovernanceConsole.tsx` behind registry admin role; effective states consumed via `useFeatureGovernanceApi.ts` → `FeatureGovernanceContext`.

## 3. STAKEHOLDER RECONCILIATION MATRIX

| Intelligence-plan stakeholder | Exists today as | Evidence |
|---|---|---|
| Anonymous buyer | Supported request class (no role): `optionalAuth` + public marketplace/vehicle endpoints; `roles: []` public features | authMiddleware.js:214; server.js:461 (public VIN details); featureRegistry public entries |
| Registered buyer | Formal role **'owner'** (public registration forces it); 'buyer' appears only as backend gate token / tenant role / communication participant role | server.js:2080-2090; escrowProviderRoutes.js:26; emailStakeholderMatrix.js:28 |
| Private seller | Formal role 'owner' (sell flow roles ['owner','dealer']) | featureRegistry.ts:1338-1351 |
| Fleet | Organization type only (`organizations.type='fleet'`); no role, no routes | supabase_schema.sql:166 |
| Garage | Formal role **'mechanic'** + tenant/org type 'garage'; garage workflow in comms | featureRegistry.ts:502-543; supabase_schema.sql:166; emailStakeholderMatrix.js:44 |
| Inspector | Evidence-source taxonomy value only (`evidence_sources.source_type='inspector'`); NOT a user role | 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql:48,347 |
| Parts supplier | Communication participant role `parts_seller` + parts marketplace routes; NOT a platform role | emailStakeholderMatrix.js:52; backend/routes/partsRoutes.js |
| Broker | NOT PRESENT (only "memory broker" comment hit, unrelated) | eventWorker.js:238 |
| Finance / leasing / fintech | Formal role **'bank'** + org type 'bank'; partner scopes `finance:request/read`; 'finance' gate token unbacked by users.role | featureRegistry.ts:1047-1078; partnerApiRoutes.js:149,162 |
| Payments | Internal service surface (`/api/payments`, payment service); no stakeholder role | server.js:286; backend/services/payment |
| SafePay / escrow | Product surfaces + admin-managed **provider platform** (escrow_providers config, kill-switch); providers are admin-configured records, not login roles | escrowProviderRoutes.js; providerPlatformRoutes.js:21-44; 20260703160000_escrow_provider.sql |
| Referral partner | Analytics/records only: referral codes with owner_user_id/channel under referral service; operators are tenant-role gated; no partner login | referralRoutes.js:16,110+ |
| Marketing partner | NOT PRESENT as principal; marketing = Brevo transport class in comms | emailStakeholderMatrix.js:19 |
| Diaspora user | Not a distinct role — diaspora features gated to owner/dealer/admin/government + entitlement plans (`diasporaEntitlementService.js` PLAN_CATALOG, subscription tables) | featureRegistry.ts:868-993; 20260621120000_diaspora_phase8_subscription_entitlements.sql |
| Overseas dealer/exporter | Role 'dealer' within diaspora tenant context (stock-manager dealer/admin); no dedicated exporter principal | featureRegistry.ts:898-902; 013_diaspora_trade_schema.sql |
| Logistics | Communication participant role `logistics_provider` (container_logistics workflow) only | emailStakeholderMatrix.js:81; communicationStakeholderContractService.js:9 |
| Clearing/customs | Workbook column vocabulary `clearing_agent` only; no principal | backend/constants/diaspora/diasporaWorkbookSchema.js:20 |
| Government | Formal role 'government' + org/tenant type + gov source activation ops routes | featureRegistry.ts:599-639; governmentActivationRoutes.js:37-79 |
| Internal teams | Single 'admin' role (+ unrepresentable platform_admin/super_admin aliases); worker/service principals via secrets (communication worker secret, service_role) | authMiddleware.js:11; communicationBaseRoutes.js:37-45 |
| External API partners | **partner_clients** scope model: hashed API keys, JSONB least-privilege scopes (vehicle:identity/trust/sources, fraud:read_summary, trust:read, dealer:read_summary, insurance:request/read, finance:request/read), status, per-min rate limit, optional tenant_id; append-only `partner_api_requests` | 20260626130000_partner_api.sql:14-50; middleware/partnerAuth.js:11-56; partnerApiRoutes.js:66-171 |

Not present in any form: broker, dedicated inspector login, logistics/clearing logins, marketing-partner principal, distinct "buyer" platform role, fleet workflows beyond the org-type enum.

## 4. ADMIN PERMISSIONING

- **Monolithic.** `authorizeRole` grants any platform admin (`admin|platform_admin|super_admin`) access to EVERY gated route regardless of the route's allowedRoles list (`authMiddleware.js:172`), and 'admin' is the only admin value `users.role` can hold (supabase_schema.sql:19). There is no permission/capability table consulted at request time — `organization_permissions` exists but is seed-only/dead for authorization (backend/db/database.js:212,330; no reads in middleware/services).
- No scoped admin sub-roles in practice: admin consoles (adminRoutes, partnerAdminRoutes, providerPlatformRoutes, featureGovernanceRoutes, identityVerificationAdminRoutes) are uniformly `authorizeRole(['admin'])`; a few review consoles widen to government/reviewer (marketplaceAdminRoutes REVIEWER_ROLES; fraud QUEUE_ROLES; mobileCertification ['admin','government']).
- Partial hardening layers on top of the monolith: `authorizeSessionRole` (real session required) for consequential governance actions (authMiddleware.js:204); `requireProvenIdentity` on private-document/signed-URL issuers (authMiddleware.js:42; identityVerificationAdminRoutes.js:2); explicit `isPlatformAdmin` predicate ("belt and braces") for scheduler/billing ops (diasporaSchedulerRoutes.js:141-146; diasporaAuthorization.js:79-81); tenant-admin ('admin' in tenant_users) is deliberately non-assumable via switch-role/effective-role (`!== 'admin'` guards, server.js:423 and authMiddleware.js:78) so tenant membership can never mint platform admin.
- Admin auditability: all governance/admin mutations route through `logAuditEvent` → append-only `trust_audit_events` (+ legacy org mirror), and feature-override changes carry created_by/updated_by + version (feature_rollout_overrides).
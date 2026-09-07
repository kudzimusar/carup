# Pre-S0 Dependency Reconnaissance — Service Network Foundation 1.0

- **Programme:** CarUp Service Network Foundation 1.0
- **Canonical plan:** `docs/service-network-foundation/CARUP_SERVICE_NETWORK_FOUNDATION_1_0_CANONICAL_PLAN.md` (on `main` via PR #196 lane; not duplicated on this branch)
- **Receipt date:** 2026-08-29
- **Lane:** branch `feat/service-network-foundation-1-0`, Draft PR #197 (single S0–S10 implementation PR)

## 1. Exact repository state

| Item | Value |
|---|---|
| Implementation base (`main`) | `ba208963d863654157335189c60f587cbe330041` |
| Lane head at reconnaissance | `001f7de29313354795269bdb4b8ef75b41c5029a` (base + lane-opening receipt) |
| PR #194 head (read-only reference) | `244226867089fd0492a0f43335bd67a541ce61f0` |
| Workspace | isolated fresh clone (`carup-service-network`), separate from the #194 reconciliation workspace |
| Toolchain | Node v20.20.2, npm 10.8.2 (CI uses Node 20 — parity) |
| Install | `npm ci` (full, exact lockfile; earlier disk-full-corrupted partial install detected and discarded) |

### Owner decision recorded (2026-08-29)

The plan's S0 gate ("confirm #194/successor merged") was **explicitly overridden by the owner**, who instructed twice that S0–S10 proceed now against pre-#194 `main`. Consequences accepted and recorded:

- implementation base is `ba208963` (pre-#194);
- #194 remains a **read-only reference** — never merged, cherry-picked, or copied;
- when #194 (or successor) lands on `main`, this branch **must be rebased** onto the new `main`, and S0 reconciliation **must be re-run** against merged truth before certification;
- every S0 freeze statement below that a #194 contract could invalidate is tagged `[#194-sensitive]`.

## 2. Baseline verification (all commands run in the isolated workspace at lane head)

Environment (exact CI env contract from `.github/workflows/ci.yml`):
`NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true`

| Step | Command | Result |
|---|---|---|
| Web typecheck | `npx tsc --noEmit --project web/tsconfig.app.json` | **PASS** (exit 0, 68s, zero diagnostics) |
| Migration integrity | `node database/test/migration_pglite_check.mjs` | **PASS** (exit 0) |
| Issue #101 P0 hardening | `node database/test/issue101_p0_hardening_check.mjs` | **PASS** |
| Issue #101 parity | `node database/test/issue101_parity_check.mjs` | **PASS** |
| Issue #101 parity→P0 chain | `node database/test/issue101_parity_then_p0_chain.mjs` | **PASS** |
| Issue #101 public_keys transition | `node database/test/issue101_public_keys_transition_check.mjs` | **PASS** |
| Issue #101 post-cutover certifier | `node database/test/issue101_post_cutover_certifier_check.mjs` | **PASS** |
| Diaspora ledger harnesses (11) | `node database/test/diaspora_*_check.mjs` (each) | **PASS** (11/11, exit 0) |
| Backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4352 tests, 4331 pass, **0 fail**, 21 skipped, 48 suites, 263s |

**Pre-existing failures: none.** The baseline at `ba208963` is fully green under the CI env contract. Any future red is Service-Network-introduced.

Not run locally (documented, not hidden): `npm run build` (web production build) and the lint-regression gate (`scripts/lint-baseline-gate.mjs`) — both CI-side gates that need no local baseline because CI computes them per-PR against the base branch; playwright E2E (`npm run test:qa`) — requires a running app/staging pairing, out of Pre-S0 scope; mobile workspace deps deliberately not installed (disk constraint; no mobile work in S0–S9 baseline).

## 3. Open-PR landscape touching Service Network domains (S0 audit item)

| PR | Lane | State | Relevance |
|---|---|---|---|
| #194 | `integration/vehicle-passport-v16-cert` | Draft, reconciling | **Primary dependency** — Communications, Intelligence, Passport ownership transfer, Marketplace, seller/taxonomy, issue158 custody (567 files, +84015/−5125, 14 migrations) |
| #196 | `docs/service-network-foundation-1-0-plan` | Ready | Carries the canonical plan to `main` |
| #188 | `feat/vehicle-passport-foundation` | Draft | Passport V0/V1 foundation lane |
| #186 | `docs/seller-journey-1-0-canonical-plan` | Draft | Seller docs lane |
| #185 | `feat/carup-intelligence-1-0` | Draft | Intelligence I0–I19 lane (partially superseded by #194 content) |
| #184 | `docs/carup-intelligence-data-analytics-canonical-plan` | Draft | Intelligence docs |
| #183 | `feat/email-experience-design-system-1-0-implementation` | Draft | Email Experience lane |
| #182 | `feat/marketplace-reliability-reference-ux` | Draft | Marketplace/seller runtime lane |
| #181 | `docs/post-reunification-dual-lane-design-system-plan` | Ready | Design-system docs |
| #137 | `fix/issue-127-uat-remediation` | Draft | Diaspora UAT fixes (low overlap) |

## 4. PR #194 delta inventory (read-only)

Full diff generated locally (`git diff main...origin/integration/vehicle-passport-v16-cert`): 567 files, +84015/−5125.

Migrations #194 introduces (none exist on `main`):
`20260826120000_email_1_0_hardening`, `20260827120000_intelligence_activity_ledger`, `20260827130000_intelligence_rollups`, `20260827140000_intelligence_post_review_hardening`, `20260828120000_intelligence_recommendations`, `20260828133000_global_vehicle_taxonomy_s0`, `20260828140000_global_vehicle_taxonomy_imports_s0`, `20260828143000_global_vehicle_taxonomy_color_s0`, `20260828160000_seller_s3_location_visibility_province_only`, `20260828203000_passport_ownership_transfer_authority`, `20260828210000_issue158_private_key_custody`, `20260828220000_passport_ownership_transfer_communications`, `20260829003000_issue158_custody_rollout_upgrade`, `20260829020000_issue158_activation_boundary_hardening` — plus (uncommitted in the reconciliation workspace at receipt time) a `20260829040000_issue158_terminal_event_uniqueness` in flight.

Routes/server surface #194 touches: `adminCommunicationRoutes`, `adminRoutes`, `authRecoveryRoutes`, `communicationBaseRoutes`, `marketplaceRoutes`, `referralRoutes`, `vehiclesRoutes`, `server.js`; new: `intelligenceActivityRoutes`, `intelligenceProjectionRoutes`, `intelligenceRollupRoutes`, `passportOwnershipTransferRoutes`.

Area distribution: web/src 138, backend/tests 107, backend/services 106, docs/communications 87, docs/intelligence 39, docs/vehicle-passport-lifecycle 24, database/migrations 14, backend/routes 11.

## 5. Keystone facts verified first-hand (not agent-reported)

1. `mechanic_work_orders` — converged **superset** shape via `20260808150000_mechanic_work_orders_convergence.sql`: two historical shapes (006_domain1: `organization_id TEXT`/`customer_name`; 009_phase4: `tenant_id UUID`/`mechanic_id`/`customer_id`/`labor_cost`/`total_cost`) merged additively; backend writes phase-4 names; NOT-NULLs on legacy columns dropped conditionally; `-- +migrate Down` is an intentional no-op. Plan §6.3 "evolve additively, never a second work-order table" binds to exactly this table.
2. `garage_service_request` — an inquiry **type** (enum value), not a table: `20260616120000_marketplace_v1_inquiries.sql:46`, `shared/types/marketplace.ts:298`, mapped to marketplace event `marketplace_service_booked` (`backend/services/marketplace/marketplaceEventTypes.js:59`), consumed by the referral bridge (`20260716033000_referral_bridge_outbox_payload_minimization.sql:38`), surfaced via `web/src/components/marketplace/InquiryModal.tsx` ("Request a service") and `MarketplaceCategoryPage.tsx`. Plan §10's "smallest truthful additive bridge" starts from this vocabulary.
3. Migration marker contract — `-- +migrate Up` required (verified present in sampled migrations); migration integrity enforced by `database/test/migration_pglite_check.mjs` (green above).

## 6. Domain reconnaissance status

Reconnaissance ran as 14 parallel read-only domain readers (two passes: 7 completed in the
first run, 7 re-ran after a session usage limit; resumed from journal cache — no findings lost).

**All 14 domains complete:** auth-tenant, garage-mechanic, vehicle-ownership, marketplace,
communications, email-whatsapp, passport-evidence, partsentry-workorders, trust, intelligence,
owner-surfaces, events-outbox, migrations-tests, pr194-cross.

## 7. Domain findings

### Domain: auth-tenant

**Files** (24)
- backend/middleware/authMiddleware.js — canonical auth entry: authorizeRole/authorizeSessionRole/optionalAuth/requireProvenIdentity factories (optionalAuth IS a factory — must be called), resolveEffectiveRole, FALLBACK_AUTH_METHOD; shapes req.userContext
- backend/services/auth/sessionRow.js — buildSessionRow: the only correct user_sessions insert row (legacy NOT NULL id/active_role/created_at + token/is_valid + active_organization_id)
- backend/services/auth/authActionTokenService.js — SA1C AuthActionTokenService: hashed (SHA-256-only-persisted), single-use, purpose-bound, atomic-consume auth action tokens
- backend/routes/authRecoveryRoutes.js — SA1D forgot/reset-password + verify-email; enumeration-safe, rate-limited, session-invalidating
- backend/utils/passwordAuth.js — scrypt hashPassword/verifyPassword (timing-safe), evaluateLoginCredentials, isPasswordlessLoginAllowed (legacy passwordless only in dev/test/env-flag)
- backend/server.js — /api/auth/login:2004, /register:2080, /me:2053, /switch-role:361, /organizations/my-org:1824, /organizations/:id/branches:1876 + /users:1891 (both UNAUTHENTICATED on main)
- backend/middleware/partnerAuth.js — requirePartnerScope(scope) factory: x-api-key partner auth, correlation id, append-only logging, fail-closed
- backend/services/partner/partnerAuthService.js — partner_clients keys: sha256 key_hash, constant-time compare, scope model
- backend/middleware/securityMiddleware.js — csrfMiddleware (signed double-submit; JWT_SECRET's ONLY use — there is no JWT auth), rateLimiter factory
- backend/middleware/correlationMiddleware.js — x-request-id/x-correlation-id → req.requestId/correlationId + asyncStore{correlationId, tenantId(UNVERIFIED header)}
- backend/services/auditLogger.js — logAuditEvent: actor_user_id/actor_role/actor_tenant_id/actor_type defaulted from req.userContext; FK-valid actor-org resolution; writes trust_audit_events + organization_audit_logs
- backend/db/supabase.js — service_role Supabase client (bypasses RLS; server-side only) + test-database containment guard
- backend/routes/workOrdersRoutes.js — exemplar tenant-isolation consumer: userContext.tenantId scopes all mechanic_work_orders reads/writes
- backend/routes/vehiclesRoutes.js — vehicle access checks combine owner_id + caller's tenant_users membership list (~line 574)
- backend/services/featureGovernance/featureGovernanceService.js — reads tenant_users.role for tenant-scoped feature governance
- backend/services/communication/authEmailTemplates.js — AUTH_ROUTES + buildAuthActionUrl: canonical builder of token-bearing auth URLs (APP_BASE_URL)
- backend/services/communication/emailReplyTokenService.js — hashed opaque multi-use Reply-To routing tokens (expiring/revocable/rotatable) over email_reply_tokens
- backend/services/identity/verificationSessionService.js — identity verification 'sessions' (user-bound workflow rows, NOT auth sessions)
- backend/utils/context.js — asyncStore used by correlation middleware for ambient request context
- web/src/hooks/useCarUpApi.ts — attaches x-session-token/x-user-id/x-stakeholder-role/x-tenant-id (from user.active_tenant_id) on every call (:452-455 et al.)
- web/src/lib/authSession.ts — session header helper (x-session-token + x-user-id)
- web/src/context/AuthContext.tsx — web session state; boot validation against /api/auth/me
- backend/db/database.js — SQLite seed incl. organization family + 'Simbisa Garages Ltd' type 'garage' (:311); organization_roles/permissions written only here
- docs/service-network-foundation/receipts/LANE_OPENING.md — the single docs commit atop canonical main @ ba208963 (001f7de2)

**Tables** (22)
- users — TEXT id ('u_'+16hex), email UNIQUE, role CHECK (owner|dealer|mechanic|insurance|government|bank|admin — NO garage role), password_hash (20260613010000), is_verified; THE single user authority (auth.users empty by design)
- user_sessions — opaque sk_live_* token UNIQUE, is_valid, expires_at, user_id, legacy NOT NULL active_role/created_at + active_organization_id; RLS-on service-role-only; contract doc = 20260617120000 header
- login_attempts — user_id/success/method('password'|...)/ip; written on every login outcome
- tenants — UUID id, name, type free TEXT ('dealership','garage','government','finance' per comment), status; 002; 'garage' tenant type already exists
- tenant_users — UUID id, tenant_id FK, user_id TEXT FK, role TEXT default 'member' (free-form: 'admin','manager','mechanic' seen), UNIQUE(tenant_id,user_id); THE membership/garage-access authority; runtime = SELECT-only (no provisioning writes exist)
- tenant_settings / tenant_branding / tenant_feature_flags / tenant_billing — per-tenant config rows keyed on tenant_id (002); branding has custom_domain UNIQUE
- tenant_api_keys — hashed per-tenant API keys (002) — UNUSED at runtime (zero .from() hits); do not confuse with partner_clients
- organizations — TEXT id, type CHECK (dealership|garage|insurance|bank|fleet|import|government), + tenant_id FK→tenants (the legacy↔tenant bridge, 002)
- organization_users / organization_roles / organization_permissions — legacy staff model; written only by seed (backend/db/database.js:330), read only for staff display; NO permission checks consume organization_permissions
- organization_branches — branch entity (supabase_schema.sql) — plan 9.4 branch-attribution target; no authorization consumes it today
- auth_action_tokens — user_id FK, purpose CHECK (4 auth purposes), token_hash UNIQUE (64-hex), expires/used/revoked_at, metadata; deny-all RLS (20260817120000)
- email_reply_tokens — token_hash UNIQUE, tenant_id NOT NULL, thread_id/participant_id FKs, expiring/revocable, multi-use (20260817160000)
- marketing_unsubscribe_tokens — hashed unsubscribe credential (20260817200000)
- partner_clients — sha256 key_hash + scopes for partner API (partnerAuthService)
- device_sessions / trusted_devices — device rows (002); only fraudService reads device_sessions; NOT part of auth (no governed device identity — plan 6.7 'record absent')
- identity_documents / kyc_profiles — identity evidence + KYC (002)
- verification_sessions — identity-verification workflow keyed user_id (20260605042424)
- diaspora_oauth_states — OAuth state nonces (20260621093000)
- role_switch_logs / security_events / failed_auth_attempts — 003-era bookkeeping tables
- trust_audit_events + organization_audit_logs — logAuditEvent sinks carrying actor_user_id/actor_role/actor_tenant_id
- domain_events — outbox; tenant_id TEXT nullable, no FK (011)
- mechanic_work_orders — has tenant_id + mechanic_id; the existing garage-work authority Service Case must orchestrate (workOrdersRoutes)

**Services** (12)
- backend/middleware/authMiddleware.js — authority for identity+role+tenant resolution; exports authorizeRole(allowedRoles,{allowUserIdFallback}), authorizeSessionRole (no header fallback, for consequential actions), optionalAuth() FACTORY (anonymous-tolerant, sets identityAsserted), requireProvenIdentity() (refuses x-user-id-fallback identities at private-document/signed-URL issuers), resolveEffectiveRole, isUserIdFallbackAllowed/isPrivateEvidenceFallbackAllowed (CARUP_ALLOW_X_USER_ID_FALLBACK), FALLBACK_AUTH_METHOD
- req.userContext shape (authorizeRole) — {id, userId, role, effectiveRole, baseRole, platformRole, tenantRole, tenantId(verified), requestedRole, isVerified, authenticationMethod}; optionalAuth adds identityAsserted and passes x-tenant-id UNVERIFIED
- backend/services/auth/authActionTokenService.js — AuthActionTokenService.issue/consume/revokeLiveTokens; purposes password_reset|email_verification|email_change|reauthentication; TTLs 10min–24h; raw token returned once, SHA-256 persisted; atomic conditional-UPDATE consume
- backend/services/auth/sessionRow.js — buildSessionRow: sole authority for session-row shape (id/active_role/active_organization_id/token/is_valid/expires_at)
- backend/utils/passwordAuth.js — scrypt credential authority: hashPassword ('scrypt:salt:hex', min 8 chars), verifyPassword (timingSafeEqual), evaluateLoginCredentials, isPasswordlessLoginAllowed (dev/test only)
- backend/services/partner/partnerAuthService.js — partner API key authority: pk-prefixed raw keys, sha256 key_hash in partner_clients, constant-time compare, clientHasScope, logPartnerRequest append-only
- backend/services/auditLogger.js — actor-context audit authority: logAuditEvent (actor_user_id/actor_role/actor_tenant_id/actor_type from req.userContext) + FK-valid actor-org resolution into organization_audit_logs/trust_audit_events
- backend/middleware/securityMiddleware.js — csrfMiddleware (signed double-submit cookie; refuses to run without JWT_SECRET outside test) + rateLimiter factory (used at 5/min switch-role, 5/15min forgot-password)
- backend/middleware/correlationMiddleware.js — request/correlation id authority (asyncStore ambient context; its tenantId is unverified telemetry only)
- backend/services/featureGovernance/featureGovernanceService.js — consumes tenant_users.role as tenant-scoped governance role
- backend/services/communication/emailReplyTokenService.js — hashed multi-use routing-token authority (the non-single-use token pattern)
- backend/services/identity/verificationSessionService.js (+identityBinding.js) — identity-verification workflow over verification_sessions; separate 'session' concept from auth

**APIs** (13)
- POST /api/auth/login — backend/server.js:2004, unauthenticated; scrypt check via evaluateLoginCredentials, mints opaque sk_live_* token into user_sessions (24h), records login_attempts
- POST /api/auth/register — backend/server.js:2080, unauthenticated; role FORCED to 'owner' (allowlist, rejects any other before writes), auto-session
- GET /api/auth/me — backend/server.js:2053, authorizeRole() no roles; frontend boot session validation (401 clears stale token)
- POST /api/auth/switch-role — backend/server.js:361, authorizeRole() + 5/min rate limit (server.js:191); self-only, 7-role catalog, tenant switch requires verified tenant_users membership, tenant 'admin' non-assumable; mints NEW session with active_role/active_organization_id
- POST /api/auth/forgot-password — backend/routes/authRecoveryRoutes.js:98, rateLimiter 5/15min isSensitive; enumeration-safe (identical body + equivalent scrypt work for unknown accounts)
- POST /api/auth/reset-password — backend/routes/authRecoveryRoutes.js:147, bearer action-token; atomic consume, then invalidates ALL user_sessions (is_valid=false) and revokes live reset tokens
- POST /api/auth/verify-email — backend/routes/authRecoveryRoutes.js:223, bearer action-token, atomic consume
- GET /api/organizations/my-org — backend/server.js:1824, authorizeRole(); resolves FIRST tenant_users membership (+settings/branding); ambiguous for multi-tenant users
- GET /api/organizations/:id/branches — backend/server.js:1876, UNAUTHENTICATED on main (PR #194 adds authorizeRole()+membership scope)
- GET /api/organizations/:id/users — backend/server.js:1891, UNAUTHENTICATED on main, selects * incl. emails (PR #194 hardens + minimizes)
- POST /api/organizations/:id/audit-logs — backend/server.js:~1950, authorizeRole() + tenant_users admin verification
- GET/POST/PATCH /api/mechanic/work-orders[/:id] — backend/routes/workOrdersRoutes.js, authorizeRole(['mechanic','admin']); every query scoped .eq('tenant_id', req.userContext.tenantId); cross-tenant==404
- Partner API surface — backend/routes/partnerApiRoutes.js via requirePartnerScope(scope) (backend/middleware/partnerAuth.js): x-api-key → sha256 lookup in partner_clients, scope check, append-only request log

**Events** (5)
- ROLE_SWITCH_REQUESTED / ROLE_SWITCH_GRANTED / ROLE_SWITCH_DENIED — emitted by POST /api/auth/switch-role via logAuditEvent (backend/services/auditLogger.js) into trust_audit_events (+ FK-valid organization_audit_logs when actor org resolvable)
- No auth domain_events exist on main — login/register/verify emit nothing to the outbox; PR #194 adds the first: 'user.email.verified'
- user.email.verified — PR #194: emitted by verify-email route via emitDomainEvent (backend/services/eventBus/eventBusService.js) as durable outbox row in domain_events; consumed by leadershipWelcomeProducer (R1 welcome email) through eventWorker
- domain_events outbox (database/migrations/011_phase6_schema.sql:4) — event_type/payload JSONB/status pending|processed|failed/attempts/tenant_id TEXT nullable; polled by eventWorker registered in backend/server.js:~355 (registerDomainListeners/registerCommunicationListeners, 1s poller) — THE transport Service Event Contract (plan §8) should ride
- login_attempts table rows (success/method/ip) written inline by login route — bookkeeping, not events

**RLS/policies** (9)
- vehicles/tenant_vehicles_isolation (002:177) — FOR ALL USING tenant_id = current_tenant_id() OR tenant_id IS NULL; permissive NULL branch; inert on runtime path (service_role bypasses; app.current_tenant never set)
- tenants/tenant_isolation (002:186) — SELECT via tenant_users WHERE user_id = auth.uid()::text; inert because auth.users is empty under custom auth
- user_sessions — RLS enabled, REVOKE anon/authenticated, GRANT service_role (20260613000000) — service-role-only session store
- auth_action_tokens — ENABLE + FORCE RLS with ZERO policies + REVOKE anon/authenticated (20260817120000) — canonical deny-all token-table posture
- production_access_containment (20260619201406) — loop REVOKE ALL FROM anon/authenticated + GRANT service_role across public tables
- current_tenant_id() — NULLIF(current_setting('app.current_tenant',true),'')::UUID (002:170); search_path pinned by 20260620232827; KNOWN-INTENTIONAL that no backend code sets the session var (verified: zero grep hits)
- communication_is_thread_participant(p_thread_id) — SECURITY DEFINER, caller derived exclusively from auth.uid() (20260811131800); participant-scoped comms access model relevant to plan 15.2
- RLS on tenant_users/tenant_settings/tenant_billing enabled (002) with no runtime-effective policies for the custom-auth path — protection is against direct PostgREST access only
- Effective posture: tenant isolation for API traffic is 100% application-level (verified userContext + explicit tenant_id filters); RLS is defense-in-depth for anon/authenticated PostgREST — new Service Network tables must implement BOTH per plan 24.6

**Migrations** (14)
- database/migrations/002_multi_tenant_and_auth_schema.sql — establishes tenants, tenant_users, tenant_settings/branding/feature_flags/billing/api_keys; tenant_id columns on vehicles/organizations/etc; user_sessions, login_attempts, device_sessions, trusted_devices, identity_documents, kyc_profiles; current_tenant_id(); tenant RLS + Croco seed
- database/migrations/003_add_user_sessions.sql — SQLite-era user_sessions (active_role, active_organization_id), role_switch_logs, security_events, failed_auth_attempts
- database/migrations/supabase_schema.sql — users (TEXT id, role CHECK owner|dealer|mechanic|insurance|government|bank|admin — NO 'garage'), stakeholder_profiles, organizations + organization_profiles/roles/users/permissions/branches (legacy family)
- database/migrations/20260613000000_phase7b_supabase_auth_and_identity.sql — Postgres port: user_sessions defaults backfill, RLS-on + REVOKE anon/authenticated + GRANT service_role, login_attempts
- database/migrations/20260613010000_users_password_hash.sql — users.password_hash column (custom auth credential store)
- database/migrations/20260617120000_user_sessions_auth_contract_align.sql — adds token/is_valid + uniqueness; file header IS the authoritative session-contract doc
- database/migrations/20260817120000_sa1_auth_action_tokens.sql — auth_action_tokens: hashed single-use purpose-bound tokens; ENABLE+FORCE RLS, zero policies, REVOKE anon/authenticated (deny-all idiom)
- database/migrations/20260817160000_email_reply_tokens.sql — hashed opaque Reply-To routing tokens (multi-use, expiring, revocable) with tenant_id/thread/participant binding
- database/migrations/20260817200000_marketing_unsubscribe_tokens.sql — hashed unsubscribe tokens (third hashed-token family)
- database/migrations/20260619201406_production_access_containment.sql — sweeping REVOKE anon/authenticated + GRANT service_role across tables (RLS posture reset)
- database/migrations/20260620232827_issue77_access_containment_followup.sql — pins current_tenant_id() search_path; deliberately keeps anon EXECUTE for the vehicles policy
- database/migrations/20260811131800_communications_2_participant_auth_hardening.sql — communication_is_thread_participant(p_thread_id) SECURITY DEFINER derives caller solely from auth.uid() (closes membership-enumeration surface)
- database/migrations/20260621093000_diaspora_h6_oauth_state_nonce.sql — diaspora_oauth_states (OAuth state/nonce, Drive integration)
- database/migrations/011_phase6_schema.sql — domain_events outbox (tenant_id TEXT nullable) + pending-index for worker polling

**Tests** (16)
- backend/tests/auth-middleware.test.js — locks resolveEffectiveRole: spoofed x-stakeholder-role rejected, tenant role must be verified, tenant 'admin' never escalates to platform admin, fallback env gating
- backend/tests/auth-session.test.js — GET /api/auth/me through REAL authorizeRole: 200 live session / 401 stale-expired-invalid (frontend boot-validation contract)
- backend/tests/user-sessions-auth-contract.test.js — proves 20260617120000 migration closes token/is_valid drift; real middleware over post-migration table shape
- backend/tests/auth-session-row.test.js — buildSessionRow always populates legacy NOT NULL columns (root-cause fix for login loop)
- backend/tests/auth-login.test.js — scrypt roundtrip, evaluateLoginCredentials, passwordless-login gate never opens in production
- backend/tests/auth-register-privilege.test.js — REAL server.js app: public register can only ever create 'owner'; any other role rejected before any write
- backend/tests/auth-recovery-security.test.js — SA1C/SA1D: hash-only persistence, atomic single-use consume, purpose binding, enumeration safety (MODIFIED by PR #194 for the outbox emission)
- backend/tests/auth-email-templates.test.js — auth email template/URL contract
- backend/tests/issue164-phase8-golden-uat-auth.test.js (+ -cli, -hash) — golden UAT auth flows incl. hashPassword usage
- backend/tests/issue164-d0-evidence-route-authorization.test.js — evidence routes require proven identity (requireProvenIdentity contract)
- backend/tests/media-upload-authz.test.js — signed-URL/media authorization
- backend/tests/diaspora-route-authorization.test.js, diaspora-safetrade-authz.test.js, diaspora-subscription-authz.test.js, lender-routes-authz.test.js — route-level authorizeRole contracts across domains
- backend/tests/diaspora-drive-vault-tenant-scope.test.js — tenant scoping of vault access
- backend/tests/referral-uat-auth-guard.test.js — UAT auth guard
- backend/tests/verification-session-workflow.test.js — identity verification session workflow
- PR #194 adds: email-experience-auth-equivalence.test.js, email-experience-reply-token.test.js, intelligence-rollup-route-auth.test.js — none alter the core auth contract

**Contract gaps** (13)
- No tenant/membership provisioning API: every runtime access to tenants/tenant_users is a SELECT (server.js, authMiddleware, vehiclesRoutes, featureGovernanceService) — no endpoint creates a garage tenant or adds a member; garage onboarding (plan 6.5) has no governed write path
- No membership invitation flow — nothing to invite a mechanic/staff user into a garage tenant (no invite tokens, no join endpoint)
- No branch-scoped authorization: organization_branches exists (supabase_schema.sql) and organization_users.branch_id is legacy/seed-only; req.userContext has no branch field and no code authorizes at branch level (plan 9.4)
- No governed device identity in the auth path: device_sessions/trusted_devices tables exist (002) but only fraudService reads device_sessions; login/session never populates them — per plan 6.7 record device context as absent, don't fabricate
- No generic capability/share-link service: auth_action_tokens is purpose-CHECKed to 4 auth purposes; no case/vehicle-scoped, owner-granted, revocable capability primitive exists (plan §21) — must be built following the SA1C hashed/atomic-consume pattern
- No garage publication/visibility model: tenants has only name/type/status (+branding table); no published/draft flag, no public directory projection, no service catalogue — entire Garage Directory surface is greenfield
- tenant_users.role is unconstrained TEXT with no role catalog or capability registry consumed at runtime; organization_permissions exists but ZERO backend permission checks read it — membership/capability semantics (plan 9.2) are undefined beyond the effective-role arbitration
- req.userContext lacks plan-6.7 actor-context fields: no branch_id, no membership capability, no source_channel, no device registration; correlation id lives on req not userContext — Service writes need an assembly step
- No QR/service-link resolver or resource-link table: 'qr' exists only as marketplace source-channel vocab (marketplaceEventTypes.js:50) and referral qr_payload URLs (referralEngineService.js:350) — plan 6.8 resolver is greenfield
- No logout/session-revocation endpoint: the ONLY user_sessions invalidation is reset-password (authRecoveryRoutes.js:180); no per-session or per-device revocation surface
- domain_events.tenant_id is nullable free TEXT with no FK — Service Event Contract needs a validated tenant reference convention
- No auth/tenant contract in shared/ types — userContext shape is defined only implicitly in authMiddleware.js; a Service Network actor-context type would have no shared home today
- user_sessions has no tenant-membership revalidation after issuance: switch-role bakes active_organization_id into the session but authorizeRole re-verifies membership per-request only when x-tenant-id is sent — fine, but means session active_organization_id is advisory, not authority

**Likely conflicts with Service Network** (10)
- 'session' is heavily overloaded: user_sessions (auth), escrow_trust_sessions (transactions, 20260626180000), verification_sessions (identity, 20260605042424), device_sessions — any Service-Network 'service session' naming would collide; 'Service Case' avoids it
- TWO org models coexist: tenants family (active authority: tenants/tenant_users, UUID ids) vs legacy organizations family (organization_users/roles/permissions/branches, TEXT ids, seed-only writes); bridged by organizations.tenant_id (002). Garage identity/Directory built on the wrong one forks authority — must anchor on tenants
- Garage typing disagrees: tenants.type comment enumerates 'dealership','garage','government','finance' (free TEXT) while organizations.type CHECK is dealership|garage|insurance|bank|fleet|import|government (supabase_schema.sql:166) — S0 must pick/constrain one vocabulary
- 'mechanic' exists as BOTH platform users.role (CHECK) and a tenant_users role (authMiddleware comment 'admin','manager','mechanic') — plan 9.2/Invariant 3 requires keeping mechanic=person, garage=tenant; new garage-staff semantics must extend tenant membership, not add a platform role
- RLS is NOT the runtime tenant boundary: backend/db/supabase.js uses service_role (bypasses RLS) and no code sets app.current_tenant, so current_tenant_id() policies (002) never engage; app-level .eq('tenant_id', verified ctx) is the real control — new service tables must not assume RLS isolates backend traffic
- tenant_vehicles_isolation policy (002:177) has a permissive 'tenant_id IS NULL' branch — copying that idiom to service tables would leak tenantless rows
- x-tenant-id is client-SELECTED context (verified against membership but chosen by the client); a multi-garage user's active tenant is header-driven and /my-org 'takes the first' membership — Service Case attribution needs explicit, persisted target-tenant, never ambient header
- PLATFORM_ADMIN_ROLES (admin/platform_admin/super_admin) bypass allowedRoles in authorizeRole (authMiddleware.js:172) — service endpoints inherit platform-admin bypass; plan Invariant 13/governance should decide whether that is acceptable per route
- auth_action_tokens.purpose has a hard CHECK of 4 auth purposes (20260817120000) — reusing the TABLE for case-scoped capabilities requires a purpose-CHECK migration; reusing only the SERVICE PATTERN with a sibling table avoids destabilizing SA1
- optionalAuth passes x-tenant-id through UNVERIFIED into userContext.tenantId (authMiddleware.js:~240) — public service/directory surfaces must never treat that field as authorization (plan 9.3)

**Must reuse (do not duplicate)** (17)
- authorizeRole/authorizeSessionRole/optionalAuth/requireProvenIdentity from backend/middleware/authMiddleware.js — plan 9.1 'no new garage login universe'; never build parallel auth middleware (remember both are FACTORIES: optionalAuth(), authorizeRole([...]))
- tenant_users membership as THE garage-access authority + the verified x-tenant-id pattern (authMiddleware.js:150-162) — garage principals are tenant members, not a new platform role
- In-query tenant scoping idiom from backend/routes/workOrdersRoutes.js (.eq('tenant_id', req.userContext.tenantId); cross-tenant indistinguishable from missing) — the plan 9.3 enforcement pattern already proven in the garage-adjacent domain
- AuthActionTokenService pattern (backend/services/auth/authActionTokenService.js): crypto.randomBytes → SHA-256-only persistence → atomic conditional-UPDATE consume → purpose/user binding → revocation — plan 6.8 REQUIRES S0 to inspect/prefer this before any new token service; extend via sibling table or purpose-CHECK migration
- buildAuthActionUrl / AUTH_ROUTES (backend/services/communication/authEmailTemplates.js) — existing token-bearing-link URL construction to mirror for service links
- buildSessionRow (backend/services/auth/sessionRow.js) if any flow ever mints a session — never hand-roll user_sessions inserts (legacy NOT NULL columns)
- logAuditEvent (backend/services/auditLogger.js) — actor_user_id/actor_role/actor_tenant_id/actor_type + FK-valid org resolution = the existing plan-6.7 actor-context capture for audited writes
- correlationMiddleware req.requestId/correlationId — the correlation/request-id field of Actor Context already exists; do not mint a second correlation scheme
- resolveEffectiveRole + PLATFORM_ADMIN_ROLES semantics — any service-route role arbitration must go through it (tenant 'admin' non-escalation is deliberately encoded there)
- FALLBACK_AUTH_METHOD / userContext.identityAsserted / requireProvenIdentity — gate any private service-document or capability issuance on PROVEN identity, exactly as evidence/passport routes do
- MARKETPLACE_SOURCE_CHANNELS ('qr','operator','whatsapp'...) and inquiry type 'garage_service_request' (backend/services/marketplace/marketplaceEventTypes.js:23,50) — plan §10 mandates reusing these vocabularies
- domain_events outbox + emitDomainEvent + eventWorker (011_phase6_schema.sql, backend/server.js:~355) — Service Event Contract transport; PR #194's user.email.verified shows the sanctioned emission style (quoted literal event type for the coverage gate)
- rateLimiter from backend/middleware/securityMiddleware.js for QR/capability/service-link endpoints (isSensitive pattern per switch-role and forgot-password)
- assertOrganizationMembership helper (PR #194 server.js) — generalize this org→tenant membership proof instead of re-deriving it per service route
- Deny-all RLS idiom for new service tables: ENABLE+FORCE RLS, zero policies, REVOKE anon/authenticated, service-role writes (20260817120000 / 20260619201406) — matches plan 24.6
- scrypt passwordAuth + evaluateLoginCredentials — any future recipient-authentication for capability links reuses this, never a second credential scheme
- identity_documents/kyc_profiles/verification_sessions (002, 20260605042424) — existing identity-evidence authorities; garage/mechanic verification must reference, not duplicate

**PR #194 delta** (11)
- backend/server.js — adds assertOrganizationMembership(req, orgId) (org→tenant_id→tenant_users proof, platform admins exempt); /api/organizations/:id/branches and /:id/users gain authorizeRole() + membership scope + column minimization (staff emails dropped) — closes the unauthenticated org-data leak that exists on main
- backend/routes/authRecoveryRoutes.js — verify-email now emits durable 'user.email.verified' outbox event via injected emitDomainEvent (R1 leadership welcome moves from swallowed inline call to retried outbox work); queueAuthEmail gains classification:'security'
- backend/services/communication/authEmailTemplates.js — extracts AUTH_EMAIL_COPY frozen single-source auth copy so canonical and certified renderers cannot drift
- backend/services/communication/emailExperience/authEquivalence.js (ADDED) — defines canonical-vs-certified auth email equivalence contract
- backend/services/communication/emailReplyTokenService.js — v2 DERIVED reply tokens (CARUP_EMAIL_REPLY_TOKEN_SECRET, domain-separated derivation; v1 random tokens stay resolvable) + canonical platform-tenant form reconciling email_reply_tokens.tenant_id NOT NULL vs message_threads.tenant_id NULL
- backend/tests/auth-recovery-security.test.js (MODIFIED) + backend/tests/email-experience-auth-equivalence.test.js / email-experience-reply-token.test.js (ADDED) — lock the recovery outbox emission and token derivation
- web/src/pages/auth/Register.tsx — returnTo-aware post-registration routing via resolvePostLoginRoute; login link preserves returnTo
- database/migrations/20260827120000_intelligence_activity_ledger.sql (ADDED) — new actor-context exemplar: authenticated_user_id/tenant_id derived server-side from verified context, object's owning tenant from the OBJECT never headers, staff/self_traffic flags — the pattern plan 6.7 service writes should mirror
- backend/tests/intelligence-rollup-route-auth.test.js (ADDED) — route auth for intelligence rollups
- docs/intelligence/receipts/i0-appendices/G-roles-registry-tenancy-authorization.md (ADDED) — full roles/tenancy/authorization audit (confirms: tenant_users.role free TEXT; 'buyer'/'reviewer'/'member' reachable only as tenant roles; organization_permissions unconsumed; no backend sets app.current_tenant; tenant-admin cannot mint platform admin)
- NOT touched by #194: backend/middleware/authMiddleware.js, backend/utils/passwordAuth.js, backend/services/auth/sessionRow.js, backend/services/auth/authActionTokenService.js, and all tenant/org migrations — the core auth/tenant contract is unchanged vs main

**Notes:** Architecture verdict for Service Network S0: CarUp auth is fully custom (auth.users empty by design; no Supabase Auth, no JWT anywhere — JWT_SECRET only signs CSRF tokens). Sessions are opaque sk_live_* bearer tokens in public.user_sessions validated per-request by authorizeRole (a factory, like optionalAuth). Tenant scope enters via client-selected x-tenant-id but is VERIFIED against tenant_users before it reaches req.userContext.tenantId — that verified field, applied as .eq('tenant_id', ...) inside each query (workOrdersRoutes is the exemplar; cross-tenant == 404), is the real isolation mechanism, because the backend runs service_role and bypasses RLS; current_tenant_id()/app.current_tenant is intentionally inert. Garage = tenants row (type 'garage' already exists), mechanic = users.role — exactly the plan 9.2 split; what is missing is every write path (tenant provisioning, membership, invitations, publication) and the capability-link layer, for which the SA1C hashed/atomic-consume token pattern is the mandated starting point (plan 6.8). PR #194 leaves the core auth contract untouched; its relevant deltas are the org-endpoint membership hardening, the durable user.email.verified outbox event, and an in-PR tenancy/authorization audit appendix that corroborates this map. Workspace inspected: /Users/shadreckmusarurwa/Project AI/carup-service-network at 001f7de2 (main ba208963 + LANE_OPENING docs commit).

### Domain: garage-mechanic

**Files** (30)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/workOrdersRoutes.js — mechanic work-order GET/POST/PATCH; creator stamped as mechanic_id; tenant-scoped update = 404 cross-tenant
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/partsRoutes.js — mechanic_parts inventory, tenant-scoped
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/dealerRoutes.js — dealer compliance self-service/admin/buyer-safe route set
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/dealer/dealerComplianceService.js — dealer identity, 8 lifecycle statuses, deriveCanPublish gate, append-only decision ledger, buyer-safe summary
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/middleware/authMiddleware.js — authorizeRole: session→users.role platform role, x-tenant-id verified against tenant_users, resolveEffectiveRole, requireProvenIdentity
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/server.js — /api/organizations/* endpoints (my-org via tenant_users; :id/branches and :id/users UNAUTH), /api/partsentry/add and /:vin
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/partsentry/partsentryService.js — signed repair log with mechanic_id + tenant_id provenance
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/trustGraph/trustGraphService.js — Passport service timeline; privacy-limited mechanic_work_orders select (id,vin,created_at,status,mechanic_id,total_cost)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplaceEventTypes.js — garage_service_request inquiry type, qr source channel, referral event map
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplacePartsService.js — governed garage/service listing stub; public sanitized provider card shape; empty until provider backend exists
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplaceDiscoveryService.js — 'service' category labeled 'Garages & Services'
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/emailStakeholderMatrix.js — 'garage' workflow: roles vehicle_owner+garage, transactional only, identity from work-order participant, tenant-scoped
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/communicationStakeholderContractService.js — garage requiredRoles ['vehicle_owner','garage']
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/communicationWorkflowService.js — garage workflow → 'general' category
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/eventBusService.js — existing event bus (with eventWorker.js, listeners.js) for §8 reuse
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/GarageDirectory.tsx — deliberate honest empty state; hardcoded empty array, NO API call; comment says wire to governed registry when published
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/DealerDirectory.tsx — same honest-empty pattern for dealers
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/App.tsx — /garages → GarageDirectory (248); /dashboard/garage → owner MyGarage (312) naming clash
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/dashboard/mechanic/WorkOrders.tsx — real work-order UI: create/complete/cancel via useCarUpApi; renders 'Unassigned' when mechanic_id absent
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/dashboard/mechanic/MechanicDashboard.tsx — stats from fetched work orders (fetchMechanicWorkOrders)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/dashboard/mechanic/ServiceLogs.tsx — partsentry repair-log UI (addRepairLog/fetchRepairHistory)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/dashboard/mechanic/CustomerRecords.tsx — HARDCODED mock customers with fabricated PII-like data (truth debt)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/pages/dashboard/mechanic/PartsTracking.tsx — parts inventory UI (on main still has invented defaults PR#194 fixes)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/hooks/useCarUpApi.ts — fetch/create/updateMechanicWorkOrder actions (~lines 2010-2023)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/shared/types/index.ts — UserRole has mechanic+dealer, NO garage; Organization.type incl 'garage'; ServiceRecord with mechanic_id
- /Users/shadreckmusarurwa/Project AI/carup-service-network/shared/types/marketplace.ts — MarketplaceListingType incl 'garage'; inquiry type 'garage_service_request'
- /Users/shadreckmusarurwa/Project AI/carup-service-network/DEALER_MECHANIC_DISCOVERY_AUDIT.md — Directive 004A type-safety audit of 6 dealer/mechanic portal pages (not a domain-model audit)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/DEALER_MECHANIC_REMEDIATION_REPORT.md — Directive 004B: @ts-nocheck removed from 4 pages, any-types eliminated, hook boundary preserved
- /Users/shadreckmusarurwa/Project AI/carup-service-network/ROUTE_AUTHORIZATION_MATRIX.md — documents org endpoint auth gaps (audit-log rows now stale; branches/users rows still accurate)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/docs/service-network-foundation/receipts/LANE_OPENING.md — the one docs commit on top of main (001f7de2)

**Tables** (17)
- organizations — legacy org universe; type CHECK ('dealership','garage','insurance','bank','fleet','import','government'); supabase_schema.sql:163
- organization_branches — id, organization_id, name, location, phone ONLY (no staff/capacity); supabase_schema.sql:209; read by unauth endpoint
- organization_users / organization_roles / organization_permissions — legacy membership with role level, branch_id, department_id + resource/action perms; supabase_schema.sql:183-208
- organization_profiles — tax_id, license_number, address, trust_score; supabase_schema.sql:171
- organization_audit_logs — org audit trail written via /api/organizations/:id/audit-logs; supabase_schema.sql:224
- tenants — ACTIVE org universe: name, type (free text incl 'garage'), status; 002_multi_tenant_and_auth_schema.sql:11
- tenant_users — ACTIVE membership: tenant_id, user_id, role (mechanic/admin/manager/member), UNIQUE(tenant,user); auth authority; 002:20
- tenant_settings / tenant_branding — org config returned by /api/organizations/my-org; 002
- users — role CHECK ('owner','dealer','mechanic','insurance','government','bank','admin'); mechanic IS a platform role, garage is NOT; supabase_schema.sql:19
- mechanic_work_orders — converged superset: tenant_id + legacy organization_id, vin FK, customer_id, customer_name, mechanic_id (creator-stamped), description, status CHECK ('In Progress','Completed','Cancelled'), labor_cost, total_cost, created_at only; 006/009/20260808150000
- mechanic_parts — tenant parts inventory: tenant_id, name, sku (unique per tenant), stock_level, unit_price; 006/009
- partsentry_logs — append-only repair ledger with mechanic_id, tenant_id, signature (written by partsentryService)
- dealer_profiles — user-keyed dealer identity + 8 independent lifecycle statuses + listing_limit + expiry_date; 20260626150000
- dealer_branches — dealer_id, name, address; 20260626150000
- dealer_compliance_documents / dealer_compliance_requirements / dealer_compliance_decisions — evidence metadata (ON DELETE RESTRICT) + checklist + append-only governance ledger; 20260626150000
- marketplace_inquiries — inquiry rows incl type garage_service_request, seller_tenant_id, source_channel incl 'qr'; 20260616120000
- user_sessions — session token authority consumed by authorizeRole; 003/20260617120000

**Services** (9)
- backend/services/dealer/dealerComplianceService.js — dealer business identity authority: createOrUpdateProfile, addBranch, listRequirements, uploadDocument, recordDecision (append-only), evaluateCompliance, deriveCanPublish (pure publish gate), getBuyerSafeSummary
- backend/services/partsentry/partsentryService.js — addRepairLog: signed repair ledger rows with mechanic_id + tenant_id provenance; emits 'Mechanic Inspection' vehicle event
- backend/services/trustGraph/trustGraphService.js — Passport service-timeline projection reading mechanic_work_orders with privacy-limited column set
- backend/services/marketplace/marketplacePartsService.js — getServiceListings: governed garage/service listing surface, sanitized card shape, honestly empty (no provider backend)
- backend/services/marketplace/marketplaceEventTypes.js — canonical inquiry/source-channel/referral-event vocabularies incl garage_service_request and qr
- backend/services/communication/{emailStakeholderMatrix,communicationStakeholderContractService,communicationWorkflowService}.js — existing 'garage' communications workflow (vehicle_owner+garage, transactional, tenant-scoped)
- backend/services/eventBus/{eventBusService,eventWorker,listeners}.js — event emission/consumption infrastructure, currently no service-domain producers
- backend/middleware/authMiddleware.js — authority for principal resolution: platform role from users.role, tenant role from tenant_users, exports authorizeRole/authorizeSessionRole/requireProvenIdentity/resolveEffectiveRole
- backend/services/providerPlatform/* — external verification-provider framework (police/insurer data), NOT garage service providers; not a garage registry

**APIs** (15)
- GET/POST/PATCH /api/mechanic/work-orders — backend/routes/workOrdersRoutes.js, authorizeRole(['mechanic','admin']), tenant from req.userContext.tenantId; POST stamps caller as mechanic_id
- GET/POST /api/mechanic/parts — backend/routes/partsRoutes.js, authorizeRole(['mechanic','admin']), tenant-scoped mechanic_parts
- POST /api/partsentry/add — backend/server.js:1630, authorizeRole(['mechanic','owner','dealer','admin']); non-mechanics need own-vehicle/same-tenant proof
- GET /api/partsentry/:vin — backend/server.js:1658, optionalAuth(); public sees governed public ledger only
- GET /api/organizations/my-org — backend/server.js:1824, authorizeRole(); resolves org via tenant_users→tenants join
- GET /api/organizations/:id/branches — backend/server.js:1876, NO AUTH (public branch fetch, flagged Medium Risk in ROUTE_AUTHORIZATION_MATRIX.md)
- GET /api/organizations/:id/users — backend/server.js:1891, NO AUTH; returns staff name/email/avatar/role publicly
- GET+POST /api/organizations/:id/audit-logs — backend/server.js:1910/1950, authorizeRole() (matrix rows saying 'public' are stale)
- POST/GET /api/dealer/profile, POST /api/dealer/branches, GET /api/dealer/requirements, POST /api/dealer/documents — backend/routes/dealerRoutes.js, authorizeRole(['dealer','admin']), self-profile only
- GET /api/admin/dealers[,/:id], PATCH /api/admin/dealers/:id/decision — backend/routes/dealerRoutes.js, authorizeRole(['admin','government','reviewer'])
- GET /api/dealers/:id/summary — backend/routes/dealerRoutes.js, any authenticated; coarse status + evidence band only
- GET /api/marketplace/services — backend/routes/marketplaceRoutes.js, public; garage/service listings stub returns empty until provider backend exists
- POST /api/marketplace/inquiries — backend/routes/marketplaceRoutes.js, optionalAuth+rate-limit; accepts type garage_service_request, source_channel qr
- PR#194 only: GET /api/mechanic/analytics — intelligenceProjectionRoutes.js, authorizeRole(['mechanic','admin']), person scope
- PR#194 only: GET /api/garage/analytics — intelligenceProjectionRoutes.js, authorizeRole(['mechanic','dealer','admin']), verified-tenant scope, no org parameter; FIRST /api/garage/* namespace

**Events** (5)
- 'Mechanic Inspection' vehicle event — emitted by partsentryService.addRepairLog via blockchainService.addEvent (backend/services/partsentry/partsentryService.js:53); consumed by passport timeline
- garage_service_request → referral event 'marketplace_service_booked' — INQUIRY_TYPE_TO_REFERRAL_EVENT in backend/services/marketplace/marketplaceEventTypes.js:59
- Referral bridge outbox labels garage_service_request as 'mechanic service' — database/migrations/20260716033000_referral_bridge_outbox_payload_minimization.sql:38
- eventBus infrastructure exists (backend/services/eventBus/eventBusService.js, eventWorker.js, listeners.js) but NO work-order lifecycle events are emitted today — Service Event Contract (plan §8) has no emitter yet
- PR#194: passport timeline work-order event carries no free-text notes — contract locked by issue164-phase8-service-timeline-privacy.test.js against trustGraphService

**RLS/policies** (7)
- mechanic_work_orders — RLS enabled with ZERO policies + REVOKE ALL from anon/authenticated, GRANT service_role (20260809110000); backend service-role client is the only path
- mechanic_parts — identical default-deny posture (20260809110000)
- dealer_profiles — RLS: owner read/update/insert policies + oversight read (20260626150000:166-190)
- dealer_compliance_decisions — append-only via governance_block_mutation trigger; reversal is a new row (20260626150000)
- tenant_users — RLS enabled (002:164); diaspora self-read policy added then SELECT revoked from authenticated (013:533,783-784)
- vehicle_evidence / vehicles — write grants revoked, SELECT-only for API roles (20260809110000); public-read posture owned by Issue #101
- Posture locked by backend/tests/db-anon-grant-posture.test.js — any new garage/service tables must ship matching default-deny grants

**Migrations** (10)
- database/migrations/supabase_schema.sql — base users table (role CHECK: owner,dealer,mechanic,insurance,government,bank,admin — NO garage) + legacy organizations universe (type CHECK incl 'garage', organization_branches/users/roles/permissions/audit_logs)
- database/migrations/002_multi_tenant_and_auth_schema.sql — tenants (type free text incl 'garage'), tenant_users (role incl 'mechanic'), tenant_settings/branding; tenant_users RLS enabled
- database/migrations/006_domain1.sql — FIRST mechanic_work_orders shape (organization_id TEXT, customer_name NOT NULL, status default 'pending') + mechanic_parts
- database/migrations/009_phase4_schema.sql — SECOND mechanic_work_orders shape (tenant_id UUID FK tenants, vin FK vehicles, mechanic_id FK users, status CHECK 'In Progress'/'Completed'/'Cancelled')
- database/migrations/20260808150000_mechanic_work_orders_convergence.sql — converges the two shapes into a superset (adds tenant_id, mechanic_id, customer_id, costs; relaxes legacy NOT NULLs); plan 6.3 says evolve THIS table additively
- database/migrations/20260809110000_api_role_write_hardening.sql — RLS enabled + all anon/authenticated grants revoked on mechanic_work_orders/mechanic_parts; service-role only
- database/migrations/20260626150000_dealer_compliance.sql — dealer_profiles (8 uncollapsed lifecycle statuses), dealer_branches, compliance documents/requirements, append-only dealer_compliance_decisions via governance_block_mutation
- database/migrations/20260616120000_marketplace_v1_inquiries.sql — marketplace_inquiries incl garage_service_request vocabulary
- database/migrations/013_diaspora_trade_schema.sql — tenant_users self-read policy then REVOKE SELECT from authenticated (:783)
- Migration marker contract: new migrations MUST carry '-- +migrate Up' and pass backend/tests/migration-integrity.test.js

**Tests** (10)
- backend/tests/dealer-compliance.test.js — locks publish gate, append-only decision ledger, buyer-safe summary exclusions, admin tenant scoping
- backend/tests/dealer-routes.test.js — locks self-profile scoping (no cross-dealer reads), admin decision path, buyer summary privacy, suspend-blocks-publication
- backend/tests/dealer-leads-inquiries.test.js — dealer lead/inquiry surface contract
- backend/tests/issue164-phase8-service-timeline-privacy.test.js — locks the mechanic_work_orders passport-timeline select to non-free-text, non-customer-identity columns and sanitized public descriptions
- backend/tests/partsentry-write-truth.test.js — partsentry write-truth contract (mechanic provenance path)
- backend/tests/db-anon-grant-posture.test.js — locks default-deny grants incl mechanic_work_orders/mechanic_parts
- backend/tests/migration-integrity.test.js — enforces '-- +migrate Up' marker contract for any new domain migration
- web/src/pages/dashboard/mechanic/WorkOrders.test.tsx — locks PATCH completion/cancellation with DB-legal 'Completed'/'Cancelled', total_cost validation, terminal rows immutable, description rendering
- web/src/pages/dashboard/mechanic/ServiceLogs.test.tsx — service-log UI contract over partsentry history
- PR#194 adds: backend/tests/intelligence-service-mechanic-garage.test.js (23 tests, person-vs-tenant scoping + unavailable-vs-zero) and web ServiceIntelligence.test.tsx (12) + PartsTracking.test.tsx

**Contract gaps** (13)
- No garage public projection/publication state exists anywhere — GarageDirectory.tsx renders a hardcoded empty array with no API; no directory API, no garage detail page (S1 builds all of it)
- No tenant/organization onboarding or membership-management API — nothing in backend inserts into tenants or tenant_users (grep-verified); garage orgs and memberships are seeded out-of-band
- No org-level verification/onboarding state on tenants — dealer_profiles carries verification but is user-keyed and dealer-only; a garage tenant has only name/type/status
- No mechanic assignment history model — single mechanic_id column on mechanic_work_orders; no assignment table, no assigned_by, no unassigned_at (plan 6.4/S4)
- mechanic_work_orders has created_at ONLY — no completed_at/cancelled_at/started_at, no branch_id, no service_category, no cancellation reason (confirmed by I9 receipt and 009/20260808150000 migrations)
- No booking/appointment/scheduling or capacity model anywhere in the schema (I9 receipt: verified against live staging)
- No service_cases table and no garage_service_request→work-order bridge; inquiry routing proves no governed target-garage relationship (plan fact #9)
- Work-order lifecycle lacks request/accept/decline states — only 'In Progress','Completed','Cancelled' in DB CHECK and API
- No work-order lifecycle event emission — eventBus exists but nothing emits service events (plan §8 contract has no producer)
- No mechanic public identity/practitioner projection and no service-link/QR resolver for mechanic resources (plan 20.3)
- No branch model for the ACTIVE tenants universe — organization_branches belongs to the legacy organizations universe, dealer_branches to dealers; work orders carry no branch reference
- Garage staging reality at I9 freeze: 0 mechanic_work_orders rows, one garage-type organization, one garage_service_request inquiry — no data to certify against
- CustomerRecords.tsx still ships fabricated customer data — same class of truth debt S1 empty-states policy exists to prevent

**Likely conflicts with Service Network** (12)
- Two parallel organization universes: tenants/tenant_users (auth authority, backend/middleware/authMiddleware.js) vs organizations/organization_* (legacy server.js endpoints + supabase_schema.sql). Plan 6.5 says evolve existing org/branch model — S0 must pick one; branches exist in organization_branches AND dealer_branches, none for tenants
- GET /api/organizations/:id/branches and /:id/users are UNAUTHENTICATED (server.js:1876/1891) — leaks staff names/emails; directly violates plan 6.5 'do not publish private staff information' and must not be the S1 directory basis
- 'garage' naming collision: /dashboard/garage = owner MyGarage vehicle collection (web/src/App.tsx:312) and /garages = public directory; Service Network 'garage' business surfaces need distinct routes/labels
- /api/garage/* namespace is claimed by PR #194 analytics (garage = verified-tenant intelligence); S1/S2 garage identity/case APIs must join, not clash with, that convention (no tenant params, session-verified scope)
- tenants.type is free TEXT ('garage' by convention, 002 migration) while organizations.type has a CHECK incl 'garage' (supabase_schema.sql:166) — garage typing has no single enforced vocabulary
- creator=mechanic conflation: POST /api/mechanic/work-orders stamps mechanic_id = caller (workOrdersRoutes.js:49) — plan 6.4/S4 requires removing this as final authority; web WorkOrders.tsx renders mechanic from that same column
- Work-order status vocabulary is capitalized display strings ('In Progress','Completed','Cancelled') enforced by DB CHECK (009_phase4_schema.sql) and locked by web tests — plan 7.x lifecycle (request/accept/decline/assign) must be reconciled additively in S2/S3, not by mutating the CHECK
- I9 receipt (PR #194) declares cancellation not-measurable while the current route supports 'Cancelled' — plan fact #6 requires explicit reconciliation
- dealer publication governance (dealer_profiles) is USER-keyed (user_id) while garage identity is TENANT-keyed — the deriveCanPublish pattern can be reused but not the keying
- serviceIntelligenceService (PR #194) counts inquiry type 'mechanic_service_request' which does NOT exist in MARKETPLACE_INQUIRY_TYPES (marketplaceEventTypes.js) — vocabulary drift to settle before S3 bridge
- emailStakeholderMatrix 'garage' workflow already binds identity to 'work order participant' — Service Case conversations must reconcile with that contract, not create a parallel comms silo (Invariant 6)
- PartSentry can feed vehicles mileage via signed repair logs (plan fact #8) — S0 must adjudicate that mutation under the canonical mileage fact contract before service records write mileage

**Must reuse (do not duplicate)** (14)
- tenant_users membership + authorizeRole/x-tenant-id verification (backend/middleware/authMiddleware.js) — the ONLY garage-access mechanism; plan 9.1/9.3 require reusing it
- resolveEffectiveRole, requireProvenIdentity, authorizeSessionRole (authMiddleware.js) — proven-identity and role-escalation guards for consequential service writes (Actor Context §6.7)
- mechanic_work_orders converged table (20260808150000) — plan 6.3 forbids a second work-order table; evolve additively (service_case_id, branch_id, completed_at, cancelled_at)
- deriveCanPublish pure gate + 8 uncollapsed statuses + append-only decision ledger pattern (backend/services/dealer/dealerComplianceService.js, 20260626150000 migration incl governance_block_mutation) — the template for garage publication governance, re-keyed to tenant
- Communications garage workflow contracts (emailStakeholderMatrix.js:44, communicationStakeholderContractService.js:4, communicationWorkflowService.js:6) — garage stakeholder + tenant rule already defined; S3 must plug into them (Invariant 6)
- marketplace inquiry vocabulary: garage_service_request + source channel qr + statuses (backend/services/marketplace/marketplaceEventTypes.js) — plan §10 mandates reuse for the S3 bridge
- eventBus (backend/services/eventBus/eventBusService.js + eventWorker + listeners) — existing transport for the Service Event Contract (§8)
- trustGraphService passport timeline work-order projection + its privacy contract (issue164-phase8-service-timeline-privacy.test.js) — Passport stays projection authority (plan fact #7); extend, never fork
- partsentryService provenance pattern (mechanic_id + tenant_id + signature + addEvent) — model for service-record provenance (§6.6)
- PR#194 serviceIntelligenceService scoping rules and /api/garage/analytics session-tenant resolution — the person-vs-tenant discipline S1-S4 APIs must match
- marketplacePartsService sanitized public provider-card shape (line ~85) — starting point for the S1 directory card contract
- honest-empty-state pattern of GarageDirectory.tsx/DealerDirectory.tsx — S1 'truthful empty states' requirement already has its house style
- web WorkOrders.tsx + useCarUpApi mechanic work-order actions + their tests — S4 converges this surface rather than replacing it
- migration marker contract ('-- +migrate Up') + backend/tests/migration-integrity.test.js — every new domain migration must comply

**PR #194 delta** (11)
- backend/services/intelligence/serviceIntelligenceService.js (NEW) — I9 mechanic(person)/garage(tenant) projections; mechanic never widens to tenant, garage never narrows to caller; NOT_MEASURABLE list (bookings, capacity, team, branch, turnaround, cancellation, category) returned with reasons
- backend/routes/intelligenceProjectionRoutes.js (NEW) — adds GET /api/mechanic/analytics (mechanic,admin) and GET /api/garage/analytics (mechanic,dealer,admin); scope only from verified session, deliberately no tenant/org parameters; failed reads return 'unavailable', never zeros
- backend/tests/intelligence-service-mechanic-garage.test.js (NEW, 23 tests) — locks person/tenant scoping, refusal without verified tenant, unavailable-vs-zero honesty
- docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md (NEW, FROZEN) — canonical mechanic-vs-garage principal model + verified schema survey; staging at freeze: 0 work orders, 1 garage org, 1 garage_service_request
- web/src/components/intelligence/ServiceIntelligence.tsx + .test.tsx (NEW) — scope-labeled surface mounted on mechanic dashboard
- web/src/pages/dashboard/mechanic/MechanicDashboard.tsx (M) — mounts <ServiceIntelligence scope="mechanic"/>
- web/src/pages/dashboard/mechanic/PartsTracking.tsx (M) + PartsTracking.test.tsx (NEW) — honesty remediation: null-preserving TrackedPart, invented supplier/threshold/zero defaults removed, fake 'Upload Invoice' control deleted; adds PartsIntelligence
- web/src/components/intelligence/DealerIntelligence.tsx + .test.tsx (NEW) and dealer pages DealerDashboard/Inventory/Promotions/SalesAnalytics (M) — I8 dealer intelligence surfaces
- docs/intelligence/manuals/dealer.md, receipts/I8_DEALER_INTELLIGENCE.md, i0-appendices/D-web-kpi-register-owner-dealer-mechanic.md (NEW) — dealer/mechanic KPI registers
- serviceIntelligenceService defines SERVICE_INQUIRY_TYPES incl 'mechanic_service_request' which is absent from MARKETPLACE_INQUIRY_TYPES on main — vocabulary drift Service Network must settle
- No garage/mechanic schema, RLS, or authority changes in #194 — the delta is read-only projections plus web honesty fixes

**Notes:** Workspace verified at 001f7de2 (main ba208963 + LANE_OPENING.md docs commit). Core identity model confirmed exactly as plan 9.2 wants preserved: mechanic is a person (users.role CHECK value AND a tenant_users role), garage is only an organization/tenant type — no garage login universe, no garage platform role. The live authority chain is session→users.role, x-tenant-id header verified against tenant_users membership (authMiddleware.js:151-162). Biggest structural risks for S0/S1: the dual organization universe (tenants vs organizations) and the two unauthenticated /api/organizations/:id endpoints; biggest reuse wins: the converged mechanic_work_orders table, dealerComplianceService's publish-gate/append-only-ledger pattern, Communications' existing 'garage' workflow, and PR #194's I9 scoping discipline plus its frozen receipt, which doubles as a verified schema survey of this exact domain. PR #194 (Intelligence 1.0) does not change any garage/mechanic authority or schema — it adds read-only projections, honesty fixes on mechanic/dealer pages, and claims the /api/garage/* and /api/mechanic/analytics namespaces.

### Domain: vehicle-ownership

**Files** (27)
- backend/server.js — legacy vehicle spine: GET /api/vehicles, /:vin/details, /:vin/passport, passport lookup, POST /api/vehicles/add (VIN dup 409), /me, /saved, /inventory
- backend/routes/vehiclesRoutes.js — status/publish/unpublish/evidence routes; owner check = vehicle.owner_id === req.userContext.id plus tenant/admin paths
- backend/utils/publicVehicleProjection.js — canonical allow-lists (PUBLIC_VEHICLE_FIELDS, OWNER_VEHICLE_SELECT, PRIVATE_VEHICLE_FIELDS) + FIELD_STATES/claims contract; single definition of the anonymous vehicle surface
- backend/utils/vehicleStatus.js — status normalization (Available/Reserved/Sold/Archived/Pending/Banned/Flagged/Suspended) and 'published'-only public visibility gate
- backend/utils/vehicleMediaProjection.js — listing media vs evidence projection; evidence keeps Phase-0 allow-list unforked
- backend/utils/passportLookupPolicy.js — VIN (ISO 3779, 17-char no I/O/Q) public lookup; plate/chassis/temp-id lookups authenticated-only, non-enumerable when anonymous
- backend/services/marketplace/marketplaceListingEligibility.js — VALID_VIN_RE + real-listing eligibility (rejects VIN_REF_*/placeholder makes); buildVehicleListingCandidate/getListingEligibility
- backend/services/marketplace/listingSummaryService.js — LISTING_SELECT_COLUMNS(_WITH_CLAIMS), the second and last permitted vehicle allow-list
- backend/services/evidence/vehicleFactResolver.js — derived vehicle facts resolved from authoritative records, never from denormalized booleans; pure/injected read
- backend/services/trustDecision/canonicalTrustService.js — only lawful source of a published trust position (versioned); vehicles.trust_score column is a demoted legacy cache
- backend/services/golden/goldenVehicleSpecs.js — golden VINs CARUPGLDNA0000001 / CARUPGLDNB0000002 + deterministic users/ids
- backend/services/golden/goldenVehicleFixture.js — staging-only golden dataset engine; writes through real canonical paths, never seeds conclusions
- backend/scripts/issue164-golden-vehicles.mjs — golden bootstrap/verify/cleanup CLI with staging guard (evaluateStagingGuard)
- backend/services/diaspora/diasporaOwnershipHandoffService.js — cross-border handoff; insertVehicleIdentity is the ONLY existing identity-without-listing creation path (fabricates mileage:0/price:0/year:0)
- backend/services/partsentry/partsentryService.js — line 51 updates vehicles.mileage directly; the exact mutation plan S0 item 8 must adjudicate
- backend/services/blockchain/blockchainService.js — hash-chained per-VIN blockchain_events ledger (calculateHash/addEvent)
- backend/services/eventBus/eventBusService.js — domain_events outbox publisher; eventWorker.js consumes
- backend/services/marketplace/marketplaceInquiryService.js — inquiry_type validation incl 'garage_service_request' (Marketplace-owned intent)
- database/migrations/supabase_schema.sql — base vehicles table: vin TEXT PRIMARY KEY (VIN = canonical id), make/model/year, mileage NOT NULL, price NOT NULL, status, trust_score; legacy vehicle_ownership_history
- database/migrations/010_phase5_schema.sql — adds vehicles.owner_id TEXT REFERENCES users(id) ON DELETE SET NULL
- database/migrations/013_zimbabwe_plate_and_owner_privacy.sql — plate/chassis/engine/temp-id fields, current_seller_id, current_seller_type, public_seller_display_enabled, vehicle_plate_history
- database/migrations/20260624140000_listing_publication_lifecycle.sql — publication_status lifecycle draft→identity_complete→documents_submitted→review_pending→publishable→published; temp_plate_id
- database/migrations/20260825090100_revoke_anon_vehicles_select.sql — anon SELECT revoked on vehicles after live staging+prod leak of owner_id/current_seller_id/plate/chassis/engine
- backend/tests/issue164-phase1-read-contract.test.js — 'no fourth vehicle allow-list' governance test naming the only permitted lists
- backend/tests/issue164-phase8-permanent-invariants.test.js — INV-1 one VIN one projection; INV-3 private identifiers stripped; INV-9 publication gate
- web/src/pages/VehicleDetail.tsx — public vehicle surface (modified by #194)
- web/src/pages/dashboard/owner/VehicleProfile.tsx — owner vehicle surface (modified by #194)

**Tables** (13)
- vehicles — canonical identity, vin TEXT PRIMARY KEY (one VIN = one row = one physical vehicle); columns: owner_id TEXT→users, tenant_id UUID→tenants (002), current_seller_id/current_seller_type/public_seller_display_enabled (013), plate/normalized_plate/chassis/engine/temp identifiers (013), status, publication_status (20260624140000), price+mileage NOT NULL, trust_score legacy cache, six verification booleans
- vehicle_ownership_history — legacy transfer ledger: vin, previous_owner_id, new_owner_id, transfer_date TEXT, transfer_hash (supabase_schema.sql); #194 adds transfer_id + unique index
- vehicle_plate_history — plate lineage with plate_type/status/is_current/record_visibility (013_zimbabwe_plate_and_owner_privacy.sql)
- vehicle_evidence — evidence ledger keyed by vin (014_passport_evidence_architecture.sql; taxonomy columns via 015 and 20260621120000)
- blockchain_events — hash-chained per-VIN immutable timeline: previous_hash/current_hash/event_type/payload/signature (supabase_schema.sql)
- evidence_class_taxonomy / evidence_sources / evidence_sets / evidence_provenance_events — vehicle-life evidence taxonomy + provenance (20260621120000)
- domain_events — outbox for async events, status/attempts/tenant_id (011_phase6_schema.sql)
- users — id TEXT PK; all vehicle FKs (owner_id, seller ids) are TEXT user ids
- vehicle_import_records / vehicle_government_documents / diaspora_import_orders — diaspora identity-handoff graph linked to vehicles(vin)
- partsentry_logs — mechanic/parts provenance keyed by vin (supabase_schema.sql)
- PR194: vehicle_ownership_transfers — UUID PK, vin→vehicles RESTRICT, previous/incoming_owner_id→users, tenant_id TEXT, state machine column, idempotency_key UNIQUE, version, single-active-transfer unique index per vin
- PR194: vehicle_ownership_transfer_events — append-only from_state/to_state/actor/payload per transfer
- PR194: vehicles taxonomy columns — make/model/generation/trim/fuel/transmission/drivetrain/body_style/color taxon ids + taxonomy_version/resolution + seller_description/seller_features/seller_stated_condition (20260828133000)

**Services** (16)
- backend/utils/publicVehicleProjection.js — vehicle projection authority; owns both public and owner field sets and the stated-claims (FIELD_STATES/withheld-vs-not_recorded) vocabulary
- backend/services/marketplace/listingSummaryService.js — marketplace listing projection; owns LISTING_SELECT_COLUMNS(_WITH_CLAIMS)
- backend/services/marketplace/marketplaceListingEligibility.js — vehicle creation gate: VIN format, placeholder rejection, owner/tenant candidate construction
- backend/services/evidence/vehicleFactResolver.js — resolves duty/police/zimra/etc facts from authoritative ledgers; unknown stays unknown
- backend/services/trustDecision/canonicalTrustService.js — versioned trust projection (CALCULATION_VERSION, TRUST_EVALUATION_STATES); the only trust read source
- backend/services/golden/goldenVehicleFixture.js + goldenVehicleSpecs.js + goldenSyntheticAssets.js — golden/UAT vehicle dataset engine (staging-only, idempotent, derives-not-seeds)
- backend/services/diaspora/diasporaOwnershipHandoffService.js — resolves-or-creates canonical vehicle identity from an import order, links import records to vehicles(vin), appends hash-chained handoff event; reads vehicle.owner_id for authorization
- backend/services/partsentry/partsentryService.js — parts/repair logging; contains the direct vehicles.mileage UPDATE flagged by plan S0
- backend/services/blockchain/blockchainService.js — canonical hash-chain writer for blockchain_events (vehicle timeline)
- backend/services/eventBus/eventBusService.js / eventWorker.js — domain_events outbox transport
- PR194: backend/services/passport/passportOwnershipTransferService.js — beginOwnershipTransfer/transitionOwnershipTransfer/getOwnershipTransfer, delegating ALL mutation to atomic SQL authorities (test-locked: 'service owns no direct vehicle/history mutation')
- PR194: backend/services/passport/passportOwnershipProjection.js — audience-gated ownership projection; owner_id only for GOVERNANCE audience; buildOwnershipHistory
- PR194: backend/services/passport/passportTransferStateMachine.js + passportAccessPolicy.js — transfer state vocabulary and passport audience policy
- PR194: backend/services/taxonomy/vehicleTaxonomyService.js — normalizeVehicleTaxonomyInput against shared/taxonomy/vehicle/catalog.json (carup-global-vehicle-taxonomy@1.0.0)
- PR194: backend/services/report/canonicalVehicleLifecycleService.js — buildCanonicalVehicleLifecycle projection over evidence (vehicle-lifecycle-1.0.0)
- PR194: backend/services/blockchain/blockchainKeyCustodyService.js — issue-158 signer key custody for the blockchain_events chain

**APIs** (19)
- GET /api/vehicles — backend/server.js, anonymous via service_role backend, allow-listed projection + published-only gate
- GET /api/vehicles/:vin/details — backend/server.js, anonymous, allow-listed
- GET /api/vehicles/:vin/passport — backend/server.js, passportLimiter + optionalAuth() factory; audience decides PUBLIC vs OWNER_VEHICLE_SELECT
- GET /api/vehicles/passport/lookup/:identifier — backend/server.js, optionalAuth() + passportLookupPolicy (VIN public; plate/chassis/temp-id authenticated, non-enumerable otherwise)
- POST /api/vehicles/add — backend/server.js, authorizeRole(['dealer','owner','admin']); marketplace eligibility gate; 409 on existing VIN; sets owner_id/current_seller_* from auth context
- GET /api/vehicles/me — backend/server.js, authorizeRole(['owner','dealer','admin']), owner_id-scoped
- GET /api/vehicles/saved, POST /api/vehicles/saved/add, DELETE /api/vehicles/saved/:vin — backend/server.js, authorizeRole
- GET /api/vehicles/inventory — backend/server.js, authorizeRole(['dealer','admin'])
- GET /api/vehicles/:vin/completeness — backend/server.js, authorizeRole(['owner','dealer','admin','reviewer'])
- PATCH /api/vehicles/:vin/status — backend/routes/vehiclesRoutes.js, authorizeRole(['admin','dealer','owner']) + owner/tenant check
- POST /api/vehicles/:vin/publish and /unpublish — vehiclesRoutes.js, authorizeRole(['owner','dealer','admin'])
- POST /api/vehicles/:vin/evidence/upload, GET /:vin/evidence, GET /:vin/evidence/timeline — vehiclesRoutes.js, upload authorizeRole(), reads public-projected
- PATCH /api/vehicles/:vin/evidence/:id/verify|reject — vehiclesRoutes.js, authorizeRole(['admin','government'])
- GET /api/vehicles/:vin/verify-ledger, /:vin/odometer-audit — backend/server.js, anonymous ledger verification
- POST /api/vehicles/:vin/reserve — backend/server.js, authorizeRole()
- PR194: POST /api/vehicles/:vin/ownership-transfers — passportOwnershipTransferRoutes.js, authorizeSessionRole([]) (real session only, x-user-id fallback rejected)
- PR194: GET /api/ownership-transfers/:transferId — authorizeSessionRole([])
- PR194: PATCH /api/ownership-transfers/:transferId — authorizeSessionRole([]); governance roles gate completion
- PR194: PATCH /api/vehicles/:vin/price — added to vehiclesRoutes.js, authorizeRole(['owner','dealer','admin'])

**Events** (6)
- domain_events outbox — emitter eventBusService.js, consumer eventWorker.js; the canonical async transport (011_phase6_schema.sql)
- garage_service_request → 'marketplace_service_booked' — mapping in backend/services/marketplace/marketplaceEventTypes.js; Marketplace-owned inquiry intent the plan's Service Case bridge must consume idempotently
- blockchain_events hash chain — emitter blockchainService.addEvent (+ diaspora appendHandoffTimelineEvent 'CROSS_BORDER_OWNERSHIP_HANDOFF'); consumer GET /api/vehicles/:vin/verify-ledger
- PR194: 'vehicle.ownership.transfer_completed' — emitted INSIDE passport_transition_ownership_transfer_atomic SQL into domain_events
- PR194: 'vehicle.ownership.transfer_action_required' — same SQL authority for awaiting_parties/evidence_required/under_review/disputed transitions
- PR194: ownership_transfer_v1 communication template + versions seeded by 20260828220000 for policy-driven notification enrichment

**RLS/policies** (7)
- vehicles/vehicles_public_read — SELECT TO authenticated USING(true); anon SELECT and ALL revoked (20260825090100) after verified staging+production leak; all public reads flow through service_role backend + allow-list
- vehicles/tenant_vehicles_isolation — FOR ALL USING (tenant_id = current_tenant_id() OR tenant_id IS NULL) WITH CHECK tenant match (002_multi_tenant_and_auth_schema.sql)
- vehicles write grants — REVOKE ALL then GRANT SELECT only to anon/authenticated (20260809110000_api_role_write_hardening.sql); writes are service_role-only
- vehicle_evidence — 'uploader or admin read' policy (20260624120000_vehicle_trust_security_hardening.sql); anon select revoked (20260825090000)
- vehicle_plate_history — admin-read policy (20260624120000)
- evidence_sets / evidence_provenance_events — owner-or-admin / admin-or-reviewer read (20260624120000)
- PR194: vehicle_ownership_transfers and vehicle_ownership_transfer_events — RLS ENABLED with no permissive app-role policies (service-role access via SECURITY DEFINER atomic functions)

**Migrations** (18)
- database/migrations/supabase_schema.sql — establishes vehicles (vin PK), vehicle_ownership_history, blockchain_events, partsentry_logs
- database/migrations/002_multi_tenant_and_auth_schema.sql — vehicles.tenant_id UUID + tenant_vehicles_isolation policy
- database/migrations/010_phase5_schema.sql — vehicles.owner_id
- database/migrations/013_zimbabwe_plate_and_owner_privacy.sql — plate/chassis/engine identity fields, current_seller_id/type, vehicle_plate_history
- database/migrations/014_passport_evidence_architecture.sql — vehicle_evidence
- database/migrations/015_vehicle_evidence_timeline.sql — evidence event_type/checksum/linked_registry_event_id hardening
- database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql — evidence taxonomy/sources/sets/provenance
- database/migrations/20260624120000_vehicle_trust_security_hardening.sql — evidence/plate-history read policies
- database/migrations/20260624140000_listing_publication_lifecycle.sql — publication_status CHECK + temp_plate_id
- database/migrations/20260818110000_issue164_listing_location_provenance.sql — *_source provenance columns; drops fabricating defaults
- database/migrations/20260819110000/122000_issue164_phase6_* — transaction authorities read current_seller_id as THE seller relationship ('owner_id is not read')
- database/migrations/20260809110000_api_role_write_hardening.sql — vehicles SELECT-only for API roles
- database/migrations/20260825090100_revoke_anon_vehicles_select.sql — anon fully revoked from vehicles
- PR194: 20260828133000/140000/143000_global_vehicle_taxonomy_* — taxonomy tables + taxon-id columns on vehicles
- PR194: 20260828160000_seller_s3_location_visibility_province_only.sql — province-only public location
- PR194: 20260828203000_passport_ownership_transfer_authority.sql — transfer tables + passport_begin/transition_ownership_transfer_atomic; completion updates vehicles.owner_id, NULLs current_seller_id/type/source, demotes published→publishable, dual-writes vehicle_ownership_history, emits domain_events
- PR194: 20260828220000_passport_ownership_transfer_communications.sql — ownership_transfer_v1 template
- PR194: 20260828210000/20260829003000/20260829020000_issue158_* — blockchain signer key custody + activation boundary hardening

**Tests** (16)
- backend/tests/issue164-phase1-read-contract.test.js — locks the allow-list universe: 'no fourth vehicle allow-list exists under backend/utils or backend/services' names the only permitted lists
- backend/tests/issue164-phase8-permanent-invariants.test.js — INV-1 one VIN yields one identical public trust projection; INV-3 private identifiers stripped; INV-9 publication gate; INV-10 versioned decisions
- backend/tests/vehicle-create-eligibility.test.js — VIN format (17-char, no I/O/Q), VIN_REF_*/VIN_INT_* fixtures rejected, placeholder make/model rejected, owner_id/tenant candidate rules
- backend/tests/vehicle-status.test.js — status normalization + quarantine vocabulary
- backend/tests/issue164-phase4-passport-claim-columns.test.js — claim/provenance column contract
- backend/tests/issue164-phase5-listing-publication-gate.test.js — published-only public visibility
- backend/tests/issue164-phase7-golden-vehicles.test.js — golden dataset orchestration invariants (deterministic ids, trust derived not written)
- backend/tests/diaspora-ownership-handoff.test.js — canonical-identity resolve-or-create handoff contract
- backend/tests/realpg/public-vehicle-rls-realpg.mjs — real-Postgres RLS proof for public vehicle posture
- backend/tests/vehicle-report.test.js, vehicle-life-taxonomy.test.js, vehicle-document-extractions.test.js — report/taxonomy/extraction contracts
- backend/tests/db-anon-grant-posture.test.js — anon grant posture incl vehicles
- PR194: passport-v2-identity-access.test.js — passport identity/access audiences
- PR194: passport-v7-ownership-transfer.test.js — transfer lifecycle contract
- PR194: passport-v16-ownership-authority.test.js — locks: service owns no direct vehicle/history mutation; atomic append-only migration; duplicate-active-transfer prevention; sale/payment is NOT ownership proof; participant reads redact owner ids
- PR194: passport-v16-postgres-authorities.test.js — real-Postgres proof of the SQL authorities
- PR194: global-vehicle-taxonomy.test.js + global-vehicle-taxonomy-antifork.test.js — single canonical taxonomy, anti-fork

**Contract gaps** (10)
- No governed identity-only vehicle creation path: POST /api/vehicles/add demands price+currency+mileage+marketplace eligibility; the only non-listing precedent (diasporaOwnershipHandoffService.insertVehicleIdentity) fabricates mileage:0/price:0/year:0 — exactly what newer contracts forbid. Garage intake of an unknown vehicle (Invariant 1) has no honest path today
- vehicles.price and vehicles.mileage are NOT NULL with no 'unknown' representation — a service-only, never-listed vehicle cannot be recorded truthfully without schema or contract work
- No backend/services/vehicle module: canonical identity logic is scattered across server.js, vehiclesRoutes.js, marketplaceListingEligibility.js and the diaspora service — no single resolve-or-create authority for Service Network to call
- No tenant/garage-scoped vehicle lookup: plate/chassis lookup exists only as the authenticated passport lookup (passportLookupPolicy); nothing lets a garage resolve a customer vehicle by plate within its tenant scope
- No customer↔vehicle or garage↔vehicle relationship table; nothing represents 'this vehicle is at / known to this garage' (plan 6.x needs it; a garage must not fork vehicle identity to get it)
- No service_records / service-case tables at all; Passport's service/parts projection (PR194 passportServicePartsProjection) reads partsentry_logs only
- No consumer/handler mapping for the new 'vehicle.ownership.*' domain_events beyond the seeded communication template — Service Network events will need the same outbox wiring plus real consumers
- No test asserting plan 11.3 (service history survives legal ownership transfer) — transfer completion leaves evidence/partsentry rows untouched by construction, but nothing locks it, and previous-owner PII protection over future service records is unspecified
- No vehicle-level 'in service' state that is distinct from marketplace status — and none should be added to vehicles.status (marketplace vocabulary); Service Network needs its own state surface
- Mileage authority contract (plan 13.1) does not exist: partsentryService.js:51 still overwrites vehicles.mileage unconditionally

**Likely conflicts with Service Network** (8)
- Naming/authority: plan's Service Case vs existing Marketplace 'garage_service_request' inquiry_type (marketplaceInquiryService.js) and its 'marketplace_service_booked' event — Marketplace owns acquisition intent (Invariant 8); the bridge must consume, not rename or duplicate
- vehicles.status is marketplace-owned vocabulary (Available/Reserved/Sold/quarantine, backend/utils/vehicleStatus.js); any service-lifecycle status written there would collide with public visibility gating and quarantine semantics
- Allow-list governance: a garage-facing vehicle projection with its own column list would fail the 'no fourth vehicle allow-list' test (issue164-phase1-read-contract.test.js:765) — Service Network must extend publicVehicleProjection.js or reuse LISTING/OWNER selects
- Ownership authority overlap: PR194's passport_transition_ownership_transfer_atomic already mutates vehicles.owner_id and retires current_seller_id/publication_status on completion; Service Network must not add a competing ownership or seller writer (three ownership writers would exist if it did: legacy vehicle_ownership_history writers, #194 authority, plus any new one)
- Seller identity semantics: transaction authorities (20260819122000 et al.) read current_seller_id as THE seller relationship and explicitly do not read owner_id — service flows keyed on 'owner' must not conflate the two
- tenant_id type divergence: vehicles.tenant_id is UUID (002) while #194's vehicle_ownership_transfers.tenant_id and users ids are TEXT — garage/tenant references in new schema must pick and justify one
- PartSentry mileage write vs plan 13.1 canonical mileage facts — S0 must adjudicate before Service Network records odometer at intake
- Schema-overlap hazard: #194 taxonomy migration already added seller_description/seller_stated_condition/body_style to vehicles; Service Network columns on vehicles would further widen a table two governance suites treat as closed

**Must reuse (do not duplicate)** (14)
- backend/utils/publicVehicleProjection.js — every new vehicle read MUST project through PUBLIC/OWNER selects and the FIELD_STATES stated-claims vocabulary; never select('*') on vehicles
- backend/services/marketplace/listingSummaryService.js LISTING_SELECT_COLUMNS_WITH_CLAIMS — the only other permitted vehicle column list
- VIN validation — reuse VALID_VIN_RE (marketplaceListingEligibility.js:53) / VIN_PATTERN (passportLookupPolicy.js:31); do not write a third regex
- backend/utils/passportLookupPolicy.js — identifier lookup gating (public VIN, restricted plate/chassis/temp-id, non-enumerable refusals) for any garage lookup feature
- backend/utils/vehicleStatus.js — status normalization and publication visibility; never re-derive
- PR194 ownership authority — passport_begin/transition_ownership_transfer_atomic + vehicle_ownership_transfers; Service Network must never write vehicles.owner_id, current_seller_id or vehicle_ownership_history directly (test-locked)
- backend/services/trustDecision/canonicalTrustService.js — any trust display; never vehicles.trust_score
- backend/services/evidence/* (evidenceService, evidenceTaxonomy, provenanceService, vehicleFactResolver) — attach service evidence by reference; extend the taxonomy, don't fork it
- domain_events outbox via eventBusService/eventWorker — transport for service events; follow the #194 pattern of emitting inside atomic SQL where mutation and event must be one transaction
- backend/services/blockchain/blockchainService.js — hash-chained vehicle timeline appends (with issue-158 key custody once merged)
- backend/services/golden/* + backend/scripts/issue164-golden-vehicles.mjs — golden/UAT vehicle dataset engine and staging guard for Service Network UAT fixtures
- diasporaOwnershipHandoffService.insertVehicleIdentity — the resolve-or-create identity precedent to GOVERN and generalize (not copy: its 0-value fabrications must be fixed, not propagated)
- optionalAuth()/authorizeRole()/authorizeSessionRole([]) middleware — optionalAuth is a factory (call it); consequential operations follow #194's session-only pattern
- PR194 shared/taxonomy/vehicle/catalog.json + vehicleTaxonomyService — canonical make/model/color vocabulary for any garage-entered vehicle data

**PR #194 delta** (15)
- backend/services/passport/ (19 new modules) — passport read model, audience policy, ownership projection (owner_id only for GOVERNANCE audience), service/parts projection, lifecycle timeline; main has NO backend/services/passport today
- database/migrations/20260828203000_passport_ownership_transfer_authority.sql — vehicle_ownership_transfers + vehicle_ownership_transfer_events; state machine initiated→awaiting_parties→evidence_required→under_review→transaction_complete→registry_pending→complete (+disputed/cancelled); one active transfer per VIN; completion atomically sets vehicles.owner_id, NULLs current_seller_id/type/source, demotes published→publishable, appends vehicle_ownership_history, emits domain_events
- backend/services/passport/passportOwnershipTransferService.js + passportTransferStateMachine.js — JS layer delegating all mutation to the SQL authorities (locked by passport-v16-ownership-authority.test.js)
- backend/routes/passportOwnershipTransferRoutes.js — POST /api/vehicles/:vin/ownership-transfers, GET/PATCH /api/ownership-transfers/:transferId, authorizeSessionRole([]) session-only; mounted in server.js
- database/migrations/20260828220000 — ownership_transfer_v1 communication template/versions
- Global vehicle taxonomy: 20260828133000/140000/143000 migrations + shared/taxonomy/vehicle/catalog.json + backend/services/taxonomy/vehicleTaxonomyService.js + seller-s0-taxonomy-backfill.mjs — taxon-id columns on vehicles (make/model/color/fuel/transmission/drivetrain/body_style), taxonomy_version 'carup-global-vehicle-taxonomy@1.0.0'; never rewrites raw historical values
- database/migrations/20260828160000 — seller location public visibility narrowed to province-only
- backend/routes/vehiclesRoutes.js — adds PATCH /api/vehicles/:vin/price
- backend/services/report/canonicalVehicleLifecycleService.js — vehicle-lifecycle-1.0.0 projection over evidence
- Issue-158 custody: backend/services/blockchain/blockchainKeyCustodyService.js + 20260828210000/20260829003000/20260829020000 migrations + finalize script — signer key custody for the blockchain_events chain
- backend/utils/publicVehicleProjection.js / vehicleMediaProjection.js — small extensions (e.g. CLAIM_VISIBILITY) to the claims contract
- Tests added: passport-v1..v16 suites incl. passport-v16-ownership-authority, passport-v16-postgres-authorities, passport-v7-ownership-transfer, global-vehicle-taxonomy(+antifork), passport-foundation-contract
- Web/mobile: SellVehicle.tsx, VehicleProfile.tsx, VehicleDetail.tsx, VehicleSearch.tsx updated; new sellerVehicleIdentification lib/hook, vehicleTaxonomy data, VehicleIdentificationNotice/VehicleHistoryCoveragePanel; mobile/app/vehicle/[vin].tsx updated
- docs/vehicle-passport-lifecycle/ — V0–V16 certification receipts incl. V7_OWNERSHIP_TRANSFER_CERTIFICATION.md
- Note: issue-158 hardening continues past this diff on integration/vehicle-passport-v16-cert (e.g. 20260829040000_issue158_terminal_event_uniqueness.sql not in the diff) — S0 must re-pin the merged SHA, per the plan's 'no stale #194 assumption' gate

**Notes:** Workspace audited read-only at canonical main (ba208963 + docs commit): backend/services has no passport/ or vehicle/ directory on main — the entire passport+ownership-transfer layer arrives with PR #194. Canonical identity rule as implemented: vehicles.vin TEXT PRIMARY KEY is the one canonical id (Invariant 1 is structurally enforced by the PK plus the 409 duplicate-VIN check in POST /api/vehicles/add and diaspora resolve-or-create); there is no surrogate vehicle id anywhere. Ownership model: owner_id = legal owner (custody), current_seller_id = governed selling relationship (transaction authorities read only the latter), and #194 makes ownership change an append-only, idempotent, governance-gated SQL authority that also retires the selling relationship. The two allow-lists are publicVehicleProjection.js (PUBLIC/OWNER family) and listingSummaryService.js LISTING_SELECT_COLUMNS — enforced by a repo-scanning test. Biggest Service-Network-shaped hole: no honest way to create or reference a vehicle identity outside a marketplace listing (price/mileage NOT NULL, eligibility gate), which S0 must resolve before any garage intake flow exists.

### Domain: marketplace

**Files** (23)
- backend/routes/marketplaceRoutes.js — public discovery + inquiries + saved + AI advisory router (184 lines on main)
- backend/routes/marketplaceAdminRoutes.js — listing moderation + inquiry assign/status + analytics (reviewer roles)
- backend/routes/leadsRoutes.js — projects seller-scoped marketplace_inquiries into the dealer Leads pipeline (inquiryToLead)
- backend/services/marketplace/marketplaceInquiryService.js — SINGLE buyer-intent capture path; createInquiry, seller routing, risk assessment, projections; garage_service_request flows through here
- backend/services/marketplace/marketplaceEventTypes.js — backend source of truth for inquiry types/statuses/source channels/referral-event mapping (mirror of shared/types/marketplace.ts)
- backend/services/marketplace/marketplaceReferralBridgeService.js — marketplace→referral attribution bridge; QR channel map; idempotent inquiry→lead bridging
- backend/services/marketplace/marketplaceListingEligibility.js — pure REAL_LISTING_ELIGIBILITY contract (reason/warning codes); wired into POST /api/vehicles/add via server.js
- docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md — the eligibility contract document
- backend/services/marketplace/marketplacePartsService.js — governed, deliberately EMPTY parts + garage/service listing surface; buildServiceSummary card shape (verification_status fail-closed)
- backend/services/marketplace/listingSummaryService.js — canonical public listing summary builder + PartSentry public-card governance
- backend/services/marketplace/marketplaceModerationService.js — listing moderation actions with independent role re-check
- backend/services/marketplace/marketplaceInquiryService.js toSellerInquiry/toAdminInquiry — audience-scoped inquiry projections (guest PII hidden from public)
- backend/services/eventBus/eventBusService.js — transactional outbox emitDomainEvent into domain_events; marketplace.inquiry.created idempotent by inquiryId
- backend/services/referral/referralEngineService.js — QR/barcode scans recorded as first-class referral events (lines 516-535); share payload qr_payload = referral URL string (line 350)
- backend/services/report/reportService.js — createShareLink/getReportByShareToken/revokeShare: existing expiring+revocable share-token infra (plaintext token)
- shared/types/marketplace.ts — canonical TS contract: MarketplaceInquiryType incl. garage_service_request (line 298), MarketplaceSourceChannel incl. qr (line 323)
- web/src/components/marketplace/InquiryModal.tsx — inquiry UI; label 'Request a service' for garage_service_request (line 24)
- web/src/pages/MarketplaceCategoryPage.tsx — Garages & Services category page; CTA inquiryType garage_service_request (line 50); renders empty governed listings today
- web/src/lib/marketplaceReferral.ts — captureReferralFromUrl + inquiryAttributionFields; source_channel limited to 'web'|'mobile'
- web/src/pages/dashboard/admin/MarketplaceModeration.tsx — admin marketplace surface (moderation + inquiries)
- database/migrations/20260616120000_marketplace_v1_inquiries.sql — owns marketplace_inquiries + marketplace_listing_reports
- database/migrations/20260811132100_communications_2_reliability_closure.sql — AFTER INSERT trigger writing marketplace.inquiry.created into domain_events transactionally + dedupe_key
- backend/server.js — mounts leads/marketplace/marketplaceAdmin routers (lines 295, 307-308); imports marketplaceListingEligibility for /api/vehicles/add

**Tables** (8)
- marketplace_inquiries — buyer-intent capture; cols: id, listing_id, listing_type, buyer_id, guest_name/email/phone, seller_id, seller_tenant_id, inquiry_type (CHECK incl. garage_service_request), message, referral_code, campaign_code, source_channel (CHECK incl. qr), status, risk_status, assigned_operator, country, metadata jsonb; owning migration 20260616120000_marketplace_v1_inquiries.sql
- marketplace_listing_reports — listing abuse reports; reason_code/status CHECKs; same migration
- domain_events — transactional outbox (011_phase6_schema.sql); dedupe_key + dedupe trigger added by 20260811132100_communications_2_reliability_closure.sql; carries marketplace.inquiry.created
- organizations — has type 'garage' in CHECK (002_multi_tenant_and_auth_schema.sql:14, supabase_schema.sql:166); existing garage identity seam; staging holds one garage org (per PR #194 I9 receipt)
- vehicles.current_seller_id/tenant_id — the ONLY routing source createInquiry consults, and only for vehicle-bound inquiry types
- report_versions.share_token/share_expires_at/revoked — existing expiring share-link columns (reportService.js)
- referral events table (REFERRAL_TABLES.events) — stores marketplace referral events incl. QR_SCANNED and bridged leads keyed by metadata.source_inquiry_id
- mechanic_work_orders — referenced by PR #194 serviceIntelligenceService; 0 rows in staging per I9 receipt (owned by mechanic domain, listed here as the convergence read target)

**Services** (11)
- backend/services/marketplace/marketplaceInquiryService.js — buyer-intent authority: createInquiry, resolveListingSeller (current_seller_id only, owner_id deliberately unselectable), listInquiriesForSeller/Admin, assignInquiry, updateInquiryStatus, assessInquiryRisk
- backend/services/marketplace/marketplaceEventTypes.js — exported enums: MARKETPLACE_INQUIRY_TYPES, MARKETPLACE_INQUIRY_STATUSES, MARKETPLACE_SOURCE_CHANNELS, INQUIRY_TYPE_TO_REFERRAL_EVENT (garage_service_request → marketplace_service_booked), DIASPORA_INQUIRY_TYPES
- backend/services/marketplace/marketplaceReferralBridgeService.js — emitMarketplaceReferralEvent (best-effort), bridgeInquiryToReferralLead (idempotent per inquiry+tenant via metadata.source_inquiry_id), SOURCE_CHANNEL_MAP qr→REFERRAL_CHANNELS.QR
- backend/services/marketplace/marketplaceListingEligibility.js — pure REAL listing eligibility: getListingEligibility/buildVehicleListingCandidate, stable reason codes, explicit-NULL-not-default rule
- backend/services/marketplace/marketplacePartsService.js — getPartsListings/getServiceListings (governed empty) + buildPartSummary/buildServiceSummary public card shapes
- backend/services/marketplace/listingSummaryService.js — listMarketplaceListings + PartSentry public-status derivation
- backend/services/marketplace/marketplaceModerationService.js — listing moderation with independent assertModerator platform-role re-check
- backend/services/marketplace/marketplaceDiscoveryService.js / marketplaceSavedService.js / marketplaceAnalyticsService.js / marketplaceAiAssistantService.js — discovery, saved listings, admin analytics, deterministic-fallback AI advisory
- backend/services/eventBus/eventBusService.js — emitDomainEvent transactional outbox writer (domain_events), marketplace.inquiry.created idempotency by inquiryId
- backend/services/report/reportService.js — createShareLink/getReportByShareToken/revokeShare share-token authority
- backend/services/referral/referralEngineService.js — validateReferralCode (records QR_SCANNED), recordReferralEvent, share assets with qr_payload=referral URL

**APIs** (15)
- GET /api/marketplace/listings — backend/routes/marketplaceRoutes.js, public (no auth), reservation-truth overlay
- GET /api/marketplace/services — marketplaceRoutes.js, public, governed EMPTY garage/service listing set (getServiceListings)
- GET /api/marketplace/parts — marketplaceRoutes.js, public, governed empty parts set
- GET /api/marketplace/listings/:id — marketplaceRoutes.js, optionalAuth(), emits best-effort referral listing_viewed
- POST /api/marketplace/inquiries — marketplaceRoutes.js, inquiryLimiter (15/min) + optionalAuth(); guest allowed; THE garage_service_request entry point
- GET /api/marketplace/my-listings/inquiries — marketplaceRoutes.js, authorizeRole([]) seller inbox
- GET/POST/DELETE /api/marketplace/saved|listings/:id/save — marketplaceRoutes.js, authorizeRole([])
- POST /api/marketplace/ai/* (listing-draft, buyer-assistant, price-estimate, share-copy) — marketplaceRoutes.js, aiLimiter, advisory-only
- GET /api/leads — backend/routes/leadsRoutes.js, authorizeRole(['dealer','admin']); projects seller-scoped marketplace_inquiries into dealer lead pipeline
- GET /api/admin/marketplace/inquiries — backend/routes/marketplaceAdminRoutes.js, authorizeRole(['admin','government']) + service-layer assertReviewer re-check
- PATCH /api/admin/marketplace/inquiries/:id/assign and /status — marketplaceAdminRoutes.js, reviewer roles; only write path that mutates inquiry status
- GET/PATCH /api/admin/marketplace/listings* (approve/reject/suppress/request-evidence/flag-risk/clear-risk) — marketplaceAdminRoutes.js, reviewer roles
- GET /api/admin/marketplace/analytics — marketplaceAdminRoutes.js, reviewer roles
- POST /api/report-versions/:id/share — backend/routes/reportRoutes.js, owner/dealer/admin; existing expiring share-link creation (Service Link candidate infra)
- Routers mounted at backend/server.js:295 (leads), :307-308 (marketplace, marketplaceAdmin)

**Events** (7)
- marketplace.inquiry.created — emitted by createInquiry (marketplaceInquiryService.js, fail-closed) AND by DB trigger trg_marketplace_inquiry_communication_outbox; consumer: Communications 2.0 orchestrator; transport: domain_events outbox, idempotent per inquiryId (dedupe_key)
- marketplace.inquiry.referral_bridge_requested — emitted by createInquiry via emitDomainEvent before lead bridging; transport: domain_events outbox
- marketplace_service_booked (referral event) — mapped from garage_service_request creation via INQUIRY_TYPE_TO_REFERRAL_EVENT; emitter marketplaceReferralBridgeService.emitMarketplaceReferralEvent; transport: referral events table (recordReferralEvent), best-effort
- marketplace_inquiry_created / marketplace_inspection_requested / marketplace_quote_requested / marketplace_listing_viewed etc. — MARKETPLACE_REFERRAL_EVENT_TYPES in marketplaceEventTypes.js, referral engine transport, best-effort
- QR_SCANNED / BARCODE_SCANNED — referralEngineService.js:516-535 validateReferralCode records a scan event when channel is qr/barcode, reusing the referral events table (explicitly 'no separate scan-tracking system')
- communication.share_link_created — constant SHARE_LINK_CREATED in backend/services/communication/communicationUtils.js:45
- PR #194 adds Intelligence observations: emitSearchPerformed/emitListingOpened (marketplaceRoutes.js) and emitInquiryCreated (marketplaceInquiryService.js) via backend/services/intelligence/marketplaceActivityEmitters.js — best-effort, never-throw, authority-anchored idempotency, drops counted in intelligence_ingestion_stats

**RLS/policies** (4)
- marketplace_inquiries — RLS ENABLED, ALL revoked from anon+authenticated, GRANT ALL to service_role only (20260616120000 migration); authorization lives in the Express service layer
- marketplace_listing_reports — same posture: RLS enabled, service_role-only
- communication_marketplace_inquiry_outbox() function — REVOKE from PUBLIC, EXECUTE granted to service_role only (20260811132100 migration)
- No anon/authenticated policies exist on any marketplace table — Service Network tables should follow this service_role-only + service-layer-authz pattern

**Migrations** (7)
- database/migrations/20260616120000_marketplace_v1_inquiries.sql — creates marketplace_inquiries (inquiry_type CHECK incl. garage_service_request; source_channel CHECK incl. qr) + marketplace_listing_reports; RLS + service_role-only
- database/migrations/20260811132100_communications_2_reliability_closure.sql — domain_events.dedupe_key + dedupe trigger + AFTER INSERT trigger on marketplace_inquiries writing marketplace.inquiry.created transactionally (ON CONFLICT DO NOTHING)
- database/migrations/011_phase6_schema.sql — creates domain_events outbox table
- database/migrations/002_multi_tenant_and_auth_schema.sql — organizations table with type incl. 'garage' (garage identity seam)
- database/migrations/supabase_schema.sql:166,358 — organizations type CHECK incl. 'garage'; seeds 'Simbisa Garages Ltd' garage org
- database/migrations/20260811131700_communications_2_workflow_template_foundations.sql:18 — seeds 'garage_booking_confirmation' template (audience vehicle_owner, category garage_service)
- database/migrations/20260716033000_referral_bridge_outbox_payload_minimization.sql — referral bridge outbox payload minimization touching marketplace inquiry events

**Tests** (9)
- backend/tests/marketplace-v1-spine.test.js — locks createInquiry contract: guest must supply contact, public projection hides PII, invalid inquiry_type rejected, metadata allow-list sanitization, outbox is a REQUIRED collaborator (fail-closed), seller inbox tenant/seller scoping + predicate push-down, referral event emission; does NOT exercise garage_service_request specifically
- backend/tests/referral-marketplace-inquiry-lead-bridge.test.js — locks idempotent inquiry→referral-lead bridge: one lead per inquiry, concurrent executions produce one lead, invalid code yields plain inquiry, no wallet transaction before admin qualification
- backend/tests/communications-2-marketplace-ingress-and-routing.test.js — locks inquiry→conversation: seller notified exactly once, replaying same inquiry adds no second message/notification (outbox idempotency), fail-closed ambiguous routing
- backend/tests/communications-2-marketplace-outbox-hardening.test.js — outbox hardening for inquiry events
- backend/tests/dealer-leads-inquiries.test.js — locks GET /api/leads: seller_id/tenant scoping, spam never surfaces, status vocabulary remap (assigned→new, qualified→negotiating)
- backend/tests/marketplace-listing-eligibility.test.js + vehicle-create-eligibility.test.js + marketplace-onboarding-fixture.test.js — lock REAL_LISTING_ELIGIBILITY reason codes and /api/vehicles/add wiring
- backend/tests/referral-engine-phase1.test.js:130 — locks qr_payload === short_referral_url (QR payload is the referral URL, no image infra)
- MAIN HAS ZERO tests naming garage_service_request (grep over backend/tests) — the type's behavior is untested until PR #194
- PR #194 backend/tests/intelligence-service-mechanic-garage.test.js (A) — first garage_service_request tests: spam/rejected excluded from enquiry counts, purchase inquiries are not service enquiries, seller_id attribution, unavailable-not-zero failure posture, no Trust leakage

**Contract gaps** (12)
- NO garage_service_request table/flow exists — it is only an inquiry_type VALUE on marketplace_inquiries (CHECK constraint, 20260616120000 migration); no acceptance, no lifecycle, no service case
- NO target-garage routing: createInquiry sets seller_id/seller_tenant_id ONLY for VEHICLE_BOUND_TYPES (vehicle_purchase_interest, vehicle_inspection_request, dealer_stock_request, trade_in_request) — a garage_service_request row lands with NULL seller/tenant and no field says which garage it was directed to (plan §10.2's exact question is unanswerable today)
- NO inquiry-level idempotency: POST /api/marketplace/inquiries generates randomUUID per call, accepts no idempotency key — a client retry creates duplicate inquiry rows (only the outbox event and the referral lead are deduped per inquiry id); plan §10.3 inquiry→ServiceCase dedup linkage must be built
- NO durable inquiry→ServiceCase linkage column/table exists anywhere (nothing to persist the bridge in)
- NO QR generation/rendering infrastructure: no qrcode/react-qr package in any package.json; 'qr' exists only as a source_channel/referral channel enum + QR_SCANNED referral events; referral qr_payload is just the referral URL string (referralEngineService.js:350)
- NO service-link/deep-link resolver for vehicle / service case / mechanic resources (plan §6.8); the only token-resolving surface is report share tokens (reportRoutes.js)
- Web never emits source_channel='qr': inquiryAttributionFields in web/src/lib/marketplaceReferral.ts hardcodes 'web'|'mobile', so end-to-end §20.4 QR attribution has no producing surface
- NO garage directory data: getServiceListings returns a governed empty set ('Service provider onboarding — verified-only', marketplacePartsService.js); no provider-listing backend, no garage publication state
- inquiry metadata allow-list (ALLOWED_METADATA_KEYS) strips any target-garage/service-context key a client might send — an additive schema change is required, metadata cannot smuggle routing
- NO booking/appointment/capacity model (confirmed by PR #194 serviceIntelligenceService NOT_MEASURABLE list and I9 receipt: mechanic_work_orders 0 rows in staging)
- NO test on main references garage_service_request at all — the type is entirely unlocked by tests until PR #194's intelligence-service-mechanic-garage.test.js lands
- marketplace_inquiries.assigned_operator is a bare TEXT operator id — no operator/garage assignment authority model behind it

**Likely conflicts with Service Network** (8)
- PR #194 serviceIntelligenceService.js defines SERVICE_INQUIRY_TYPES = {garage_service_request, mechanic_service_request} but 'mechanic_service_request' exists NOWHERE else — not in MARKETPLACE_INQUIRY_TYPES (marketplaceEventTypes.js), not in shared/types/marketplace.ts, and the DB CHECK constraint (20260616120000 migration) would reject it; Service Network adding this type requires a coordinated enum+CHECK+types change
- PR #194 service intelligence reads marketplace_inquiries.seller_id/seller_tenant_id as the SERVICE PROVIDER target (pr194.diff lines ~17195-17200), but on main createInquiry only populates seller_* for VEHICLE_BOUND_TYPES (garage_service_request excluded) — so the enquiry metric reads 0 today, AND this pre-claims seller_* as 'target garage' semantics that plan §10.2 explicitly warns against overloading
- Referral event name 'marketplace_service_booked' is already mapped from garage_service_request creation (marketplaceEventTypes.js INQUIRY_TYPE_TO_REFERRAL_EVENT) even though no booking model exists (PR #194 I9 receipt: NOT_MEASURABLE no_booking_model) — Service Network 'booking/acceptance' vocabulary will collide with this pre-existing misnomer
- marketplace_inquiries status vocabulary (new/assigned/contacted/qualified/closed/spam/rejected) is a LEAD pipeline (leadsRoutes.js remaps it again to new/contacted/negotiating/closed) — plan §6.2 Service Case statuses must not be conflated with or written back into inquiry status; a mapping decision is needed at the bridge
- listing_type on a garage_service_request inquiry defaults to 'vehicle' (createInquiry sets 'diaspora_request' only for diaspora types) — misleading if Service Network queries by listing_type
- Communications workflow template 'garage_booking_confirmation' (category garage_service, 20260811131700 migration) already exists with 'booking' naming — Service Network notification events (§15.4) must reconcile rather than duplicate this template family
- PR #194 MarketplaceShareSheet.tsx builds share URLs with NO referral/source/utm params — a Service Network share/QR surface reusing it would silently drop plan §20.4 source attribution
- report_versions share_token is stored in PLAINTEXT (reportService.js createShareLink) — plan §6.8 requires bearer secrets stored hashed, so this infra is a pattern to reuse but not compliant as-is

**Must reuse (do not duplicate)** (15)
- marketplace_inquiries table + inquiry_type 'garage_service_request' + source_channel 'qr' vocabularies (database/migrations/20260616120000_marketplace_v1_inquiries.sql, backend/services/marketplace/marketplaceEventTypes.js, shared/types/marketplace.ts) — plan §10 mandates reusing these
- createInquiry single capture path (backend/services/marketplace/marketplaceInquiryService.js) — guest+auth handling, contact enrichment, risk assessment, metadata allow-list, audience-scoped projections; extend additively, do not fork a second intake
- Transactional outbox: emitDomainEvent + domain_events + dedupe_key + AFTER INSERT trigger pattern (backend/services/eventBus/eventBusService.js, 20260811132100 migration) — the model for idempotent Service Case bridging events
- marketplaceReferralBridgeService (backend/services/marketplace/marketplaceReferralBridgeService.js) — QR→REFERRAL_CHANNELS.QR mapping, per-inquiry idempotent lead bridging pattern (findInquiryLeadEvent keyed on source_inquiry_id) = the template for idempotent inquiry→ServiceCase
- referralEngineService.validateReferralCode QR_SCANNED recording (backend/services/referral/referralEngineService.js:516-535) — first-class QR scan events on the existing event table; explicitly no separate scan-tracking system
- report share-token pattern (backend/services/report/reportService.js:187-213 + reportRoutes.js) — expiring, revocable, server-validated resource links; plan §6.8 says inspect/prefer existing token infra (must add hashing)
- organizations table with type 'garage' (002_multi_tenant_and_auth_schema.sql; supabase_schema.sql:166) — garage identity anchor; do not invent a new garage entity table without reconciling
- Communications template 'garage_booking_confirmation' category garage_service (20260811131700 migration) — extend this template family for §15.4 service notifications
- leadsRoutes.js inquiryToLead + marketplaceAdminRoutes inquiry assign/status — existing operational surfaces over inquiries; Garage inbox should follow this projection pattern, not raw rows
- buildServiceSummary card shape + governed-empty getServiceListings (backend/services/marketplace/marketplacePartsService.js) — the Garage Directory card contract seed: verification_status fail-closed, statedValue() absence semantics, no fabricated labels
- REAL_LISTING_ELIGIBILITY pattern (backend/services/marketplace/marketplaceListingEligibility.js + docs/CARUP_REAL_LISTING_ELIGIBILITY_CONTRACT.md) — pure reason-coded eligibility as the model for garage publication eligibility
- inquiryLimiter/aiLimiter + optionalAuth guest pattern (marketplaceRoutes.js) — rate-limited guest-capable entry points
- web captureReferralFromUrl + inquiryAttributionFields (web/src/lib/marketplaceReferral.ts) — extend for qr channel rather than a new attribution store
- PR #194 MarketplaceShareSheet.tsx — share UX component to extend (adding attribution params) for Service Link sharing
- PR #194 serviceIntelligenceService NOT_MEASURABLE honesty pattern — state absent capabilities with reasons instead of estimating

**PR #194 delta** (19)
- backend/routes/marketplaceRoutes.js (M) — wires fire-and-forget Intelligence I3 emitters: emitSearchPerformed on listings search, emitListingOpened on detail, req threaded into createInquiry/saveListing/unsaveListing for session context; no new endpoints, no auth changes
- backend/services/marketplace/marketplaceInquiryService.js (M) — ALLOWED_METADATA_KEYS extended with buyer_intent, safepay_requested, fitment_taxonomy_version/make/model/year; emitInquiryCreated observation after insert; garage_service_request routing logic UNCHANGED
- backend/services/intelligence/marketplaceActivityEmitters.js (A) — all server-emitted marketplace observations; authority-anchored idempotency; drops counted in intelligence_ingestion_stats
- backend/services/intelligence/serviceIntelligenceService.js (A) — mechanic/garage service intelligence over marketplace_inquiries (filters seller_id / seller_tenant_id) + mechanic_work_orders; SERVICE_INQUIRY_TYPES = {garage_service_request, mechanic_service_request}; explicit NOT_MEASURABLE list (no booking/capacity model); mechanic projection never widens to tenant, garage never narrows to caller
- backend/services/marketplace/carUpGoldService.js (A) — governed CarUp Gold qualification (projectCarUpGold, policy carup-gold-1.0.0) from canonical trust; frontend must never recreate/relax
- backend/services/marketplace/listingSummaryService.js (M) — adds carup_gold projection + canonical taxonomy facet matchers (make/model/fuel/transmission/body/location) applied pre-sort/limit
- backend/services/marketplace/marketplaceListingEligibility.js (M) — year bounds now come from vehicleTaxonomyService.vehicleYearBounds() instead of MIN_LISTING_YEAR=1980 const
- backend/services/marketplace/marketplacePartsService.js (M) — part fitment claim vocabulary: normalizePartFitmentEntry, PART_FITMENT_TAXONOMY_VERSION, model-range only, VIN/plate/chassis deliberately absent
- backend/services/marketplace/marketplaceDiscoveryService.js + marketplaceSavedService.js (M) — observation threading / facet support
- shared/types/marketplace.ts (M) — adds MarketplacePartFitment, synthetic_demo demo-media marker (never a Trust input), display_label nullable
- web/src/components/marketplace/InquiryModal.tsx (M) — intentMetadata pass-through merged into inquiry metadata
- web/src/components/marketplace/MarketplaceShareSheet.tsx (A) — WhatsApp/Facebook/X/email/copy/native share; NO referral or source_channel params on shared URLs
- web MarketplaceListingCard.tsx, VehicleIntelligenceStory.tsx, marketplaceCardModel.ts, marketplacePresentation.ts (A) — new card/presentation layer
- mobile/app/(tabs)/marketplace.tsx + mobile/utils/marketplaceApi.ts (M) — mobile marketplace media contract
- .github/workflows/marketplace-reference-media-*.yml + backend/fixtures/marketplace-reference-media-v1.json + backend/scripts/marketplace-reference-media-staging.mjs (A) — staging reference-media seeding pipeline (synthetic_demo provenance)
- backend/tests/intelligence-service-mechanic-garage.test.js (A) — FIRST tests touching garage_service_request: spam/rejected excluded from service enquiries, seller_id attribution, no Trust leakage, unreadable table reports unavailable-not-zero
- backend/tests/marketplace-carup-gold.test.js, marketplace-reference-*.test.js, marketplace-lifecycle-missing-mileage.test.js (A) + marketplace-v1-spine.test.js, marketplace-listing-eligibility.test.js (M)
- docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md (A) — staging reconciliation: mechanic_work_orders 0 rows; ONE garage_service_request inquiry; ONE organization of type garage
- backend/services/passport/passportMarketplaceConvergence.js + backend/tests/passport-v10-marketplace-convergence.test.js (A) — passport/marketplace convergence (adjacent domain, touches marketplace summaries)

**Notes:** Headline: on main, 'garage_service_request' is only a vocabulary value (inquiry_type on marketplace_inquiries) captured through the single createInquiry path — there is no routing to a garage, no lifecycle, no dedicated table, and no test locking it. The plan's §10 claim that 'Marketplace already recognizes garage_service_request and source channel qr' is confirmed but is vocabulary-only. The biggest S0 design decision this recon surfaces: PR #194's service intelligence already reads marketplace_inquiries.seller_id/seller_tenant_id as the service-provider target while plan §10.2 forbids overloading seller semantics — whichever additive target-garage field S0 chooses must be reconciled with #194's intelligence readers before both merge. Idempotency exists at three layers (outbox event per inquiryId, referral lead per inquiry+tenant, comms trigger ON CONFLICT) but NOT at inquiry creation itself. QR is attribution vocabulary + referral scan events only; there is zero QR generation or resolver infrastructure, and the web client can never emit source_channel='qr' today. Grounding: every claim above from files opened/grepped in /Users/shadreckmusarurwa/Project AI/carup-service-network and /private/tmp/.../scratchpad/pr194.diff (+ pr194-name-status.txt); PLAN.md sections 2.3, 4 (inv. 8/11), 6.8, 10, 20 read.

### Domain: communications

**Files** (23)
- backend/services/communication/ — 49-module canonical Communications 2.0 engine (threads, notifications, delivery, AI, templates, webhooks)
- backend/services/communication/communicationThreadService.js — thread/participant/message model; resolveOrCreateThread dedupes on (tenant_id, thread_key); recordMessage
- backend/services/communication/communicationWorkflowService.js — ensureBusinessConversation: business_workflow allow-list WORKFLOW_THREAD_TYPES (has 'garage'->'general', NO 'service'), deterministic thread_key, requires >=2 participants, idempotent initial message
- backend/services/communication/communicationStakeholderContractService.js — per-workflow required stakeholder roles; garage: ['vehicle_owner','garage']; no mechanic role anywhere
- backend/services/communication/communicationConversationService.js — ensureParticipant with stakeholder_role; buyer/seller marketplace flows; analytics recording
- backend/services/communication/communicationNotificationService.js — NOTIFICATION_POLICIES event->channels/fallback map; queueFromDomainEvent; queueNotification with dedupe_key; recipientFromPayload (single user only)
- backend/services/communication/communicationCanonicalNotificationService.js — governed-DB-template rendering; queueNextFallback = ordered recovery sequence (not broadcast)
- backend/services/communication/communicationProductNotificationService.js — WhatsApp Meta customer-service-window (24h session vs approved template) via conversation_channel_bindings
- backend/services/communication/communicationDeliveryWorker.js — claims queued notification_queue rows, adapter dispatch, retry/backoff, dead-letter, suppression check, fallback orchestration
- backend/services/communication/adapters/providerAdapters.js — channel registry: whatsapp(Meta), telegram, email(transport router), sms(Twilio), instagram, facebook, push(ExpoPushAdapter, EXPO_ACCESS_TOKEN), in_app(fake); real adapters only in production/staging or COMMUNICATION_REAL_ADAPTERS
- backend/services/communication/communicationEventListeners.js — COMMUNICATION_EVENT_TYPES subscribed on eventWorker; every listed type must have a real emitter (test-enforced)
- backend/services/communication/communicationPreferenceService.js — consent/preferences, selectChannels merges policy + user fallback channels
- backend/services/communication/communicationGovernedTemplateService.js — governed template registry rendering with variable escaping
- backend/services/communication/communicationInboxProjection.js — JS mirror of communication_inbox_threads SQL view (requester identity, unread count, failed-outbound risk)
- backend/services/communication/communicationServiceFactory.js — DI factory wiring repository/thread/notification/worker services
- backend/routes/communicationRoutes.js — wraps base router; adds /api/internal/events/process outbox drain (worker-secret/CRON_SECRET gated, refuses when zero listeners armed)
- backend/routes/communicationBaseRoutes.js — user thread/message/notification/preferences/AI/share APIs + provider webhooks + delivery-worker drain
- backend/routes/adminCommunicationRoutes.js — 28+ admin command-center endpoints (threads, reply, SLA, dead-letter, recovery, provider smoke/credential checks, metrics)
- backend/services/eventBus/eventWorker.js — transactional outbox (domain_events) poller invoked serverlessly
- web/src/components/owner/OwnerNotificationBell.tsx — owner in-app bell; unavailable != zero (amber dot, explicit unavailable state), server-reported unread count only
- web/src/features/communications/admin/QueueOverview.tsx — admin communications queue UI
- web/src/features/communications/admin/CommandCenterNav.tsx — admin command-center nav
- web/src/features/communications/channelRegistry.ts — frontend channel registry

**Tables** (18)
- message_threads — canonical thread; thread_type CHECK ('support','marketplace_inquiry','referral','escrow','finance','import','container','trust_safety','feedback','complaint','account','general'); business_workflow/funnel_stage TEXT (no CHECK) added by comms 2.0; subject_type/subject_id free-form; unique (tenant_id, thread_key); 20260623143000 + 20260811131500
- message_participants — participant_type/user_id/admin_id/external_identity_id/role/stakeholder_role/permissions; explicit-participant model; 20260623143000
- messages — channel, provider, provider_message_id, client_message_id (idempotency), content_text/json, ai flags; 20260623143000
- channel_identities — external channel identity bindings (phone/email/chat ids); 20260623143000
- conversation_channel_bindings — per-participant per-channel binding: can_send, transactional_consent, last_inbound_message_id (drives WhatsApp session window); 20260811131500
- notification_queue — the 'nq' queue: created legacy in 002 (uppercase channel CHECK), extended by omnichannel (tenant_id, recipient_user_id, recipient_identity_id, thread_id, message_id, event_id, notification_type, title, message, channel, template_key, payload, priority, status, dedupe_key, scheduled_at, attempt_count)
- outbox_events + domain_events — transactional outbox event fabric; 002 + omnichannel migration
- message_delivery_attempts — per-attempt provider delivery evidence; 20260623143000
- webhook_logs — inbound provider webhook audit; 20260623143000
- communication_preferences — per-user/tenant channel enables (push_enabled, in_app_enabled, email/sms/whatsapp/telegram), preferred_channel, fallback_channels JSONB, quiet hours, consent_source/version/withdrawn_at; unique (user_id, tenant)
- communication_escalations — escalation records; 20260623143000
- communication_suppressions — per-channel/address suppression consulted by delivery worker
- communication_templates — governed registry: template_key, business_workflow, stakeholder_audience, classification CHECK ('security','transactional','service','marketing'), status; 20260811131500
- communication_template_versions — versioned approved template bodies (approval_status draft/approved/rejected/retired); 20260811131500
- conversation_events — analytics events keyed by business_workflow/event_type; 20260811131500
- message_parts / message_derivations — structured message parts and AI derivations; 20260811131500
- communication_inbox_threads (VIEW) — identity-first inbox projection; 20260705150000
- gateway_integration_logs / sync_reconciliation_queue — legacy gateway/sync tables from 002

**Services** (16)
- communicationWorkflowService — business-conversation authority; assertWorkflow rejects any workflow not in its 13-key allow-list ('service' would 400 today); exports communicationWorkflowTypes
- communicationStakeholderContractService — listContracts/contractFor: enforces required stakeholder roles per workflow before conversation creation
- communicationThreadService — thread lifecycle, addParticipant, recordMessage, SLA policy application
- communicationConversationService — ensureParticipant (stakeholder_role), read receipts, analytics
- communicationNotificationService — policy lookup, queueFromDomainEvent, queueNotification (dedupe, template render, outbound message row + notification_queue row)
- communicationCanonicalNotificationService — ordered fallback chain (primary + fallback children), governed template rendering, queueNextFallback used by worker and webhook service
- communicationProductNotificationService — resolveWhatsappDeliveryPolicy: session mode inside 24h customer-service window, approved provider template outside
- communicationDeliveryWorker — drain loop: adapter lookup, suppression, retry/backoff, dead-letter, fallback orchestration, delivery attempts audit
- communicationEventListeners — registerCommunicationListeners(eventWorker): domain event -> queueFromDomainEvent; schema-missing tolerant
- communicationPreferenceService — getPreferences/selectChannels (policy channels + user fallbacks; policyChannelsOnly hard-cap)
- communicationTemplateService / communicationGovernedTemplateService — code + DB-governed template rendering
- communicationInboundService — inbound webhook message ingestion + transactional acknowledgement
- communicationAuditLog — communication audit events
- communicationSla / communicationSlaSchedule — SLA policies, pause/resume
- communicationRecovery — dead-letter recovery listing/bulk retry
- eventBus/eventWorker — outbox subscribe/poll; the only transport by which business events reach Communications

**APIs** (22)
- GET/POST /api/internal/communications/process — communicationBaseRoutes.js, worker-secret/CRON_SECRET (pg_cron drains delivery queue)
- GET/POST /api/internal/events/process — communicationRoutes.js, worker-secret; drains domain_events outbox through eventWorker (refuses if no listeners armed)
- GET /api/communications/health — communicationBaseRoutes.js, unauthenticated config validation
- GET /api/communications/threads — communicationBaseRoutes.js, authorizeRole([]) (any authenticated session)
- GET /api/communications/threads/:id — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/threads — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/threads/:id/messages — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/threads/:id/read — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/threads/:id/feedback — communicationBaseRoutes.js, authorizeRole([])
- GET /api/communications/notifications — communicationBaseRoutes.js, authorizeRole([]); listNotificationsForUser(req.userContext.id) scoping
- POST /api/communications/notifications/:id/read — communicationBaseRoutes.js, recipient-ownership checked (404 otherwise)
- GET/PATCH /api/communications/preferences — communicationBaseRoutes.js, authorizeRole([])
- GET /api/communications/analytics — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/threads/:id/ai/{suggest-reply,summarize,translate} — communicationBaseRoutes.js, authorizeRole([])
- POST /api/communications/share — communicationBaseRoutes.js, authorizeRole([])
- GET/POST /api/communications/webhooks/:provider/:channel — communicationBaseRoutes.js, provider signature verification (Meta callback, rawBody)
- GET /api/admin/communications/threads[+/:id,/:id/audit] — adminCommunicationRoutes.js, authorizeRole(ADMIN_ROLES)
- POST /api/admin/communications/threads/:id/{reply,read,escalate,resolve,reopen} — adminCommunicationRoutes.js, ADMIN_ROLES
- PATCH /api/admin/communications/threads/:id/{assignment,priority} + POST sla/{pause,resume} — adminCommunicationRoutes.js, ADMIN_ROLES
- GET/POST /api/admin/communications/dead-letter[+ :id/{retry,cancel,requeue}] + /recovery + /recovery/bulk-retry — adminCommunicationRoutes.js, ADMIN_ROLES
- GET /api/admin/communications/{worker/health,audit,sla/policies,providers,metrics} — adminCommunicationRoutes.js, ADMIN_ROLES
- POST /api/admin/communications/test/{provider-smoke,provider-credential-check} + GET provider-template-status — adminCommunicationRoutes.js, requireAdminOrWorkerSecret

**Events** (7)
- COMMUNICATION_EVENT_TYPES on main: marketplace.inquiry.created, marketplace.listing.moderated, finance.application.{status_changed,approved,declined}, identity.verification.decided, evidence.review.decided — emitters in domain services, consumed by communicationEventListeners, transport = domain_events outbox drained by eventWorker via /api/internal/events/process
- ESCROW_CREATED/ESCROW_UPDATED — deliberately unsubscribed (legacy SafePay authority retired in #164 Phase 6); policies retained only so historical queued rows resolve
- Notification fallback chain — delivery worker failure or webhook 'failed' receipt -> notificationService.queueNextFallback -> next channel notification (ordered recovery, not broadcast)
- Thread-type constraint rule — every policy threadType MUST be in message_threads_thread_type_check or the INSERT fails and the notification is never queued (documented in NOTIFICATION_POLICIES comments)
- Recipient addressing rule — delivery worker resolves email/phone/expo_push_token ONLY from notification.payload; policy-driven notifications carry none, so email/push dead-letter (in_app-only + policyChannelsOnly workaround for identity/moderation/evidence events)
- PR #194 adds: 10 MARKETPLACE_* transaction-stage events (from issue164_transition_session_atomic / record_payment_state_atomic), vehicle.trust.presentation_changed, vehicle.ownership.transfer_{started,action_required,state_changed,completed}, user.email.verified — all consumed via same outbox
- communication-event-coverage.test.js — enforces every subscribed event type has a literal emitter under backend/services|routes; any new service.* event needs a real emitter first

**RLS/policies** (12)
- notification_queue — RLS enabled (20260624044812); notification_queue_user_read: recipient-scoped user read
- message_threads — message_threads_participant_read (20260811131800): primary_user_id = auth.uid() OR communication_is_thread_participant(id); replaces older user-read policy
- messages — messages_participant_read: communication_is_thread_participant(thread_id)
- message_participants — message_participants_thread_read: participant of same thread
- conversation_channel_bindings — participant read via communication_is_thread_participant(thread_id)
- message_parts — participant read via owning message's thread
- conversation_events / message_derivations — participant read (20260811131800)
- message_delivery_attempts — admin-only read (20260624044812)
- webhook_logs — admin-only read (20260624044812)
- channel_identities, communication_preferences, communication_escalations — RLS enabled in 20260623143000
- public.communication_is_thread_participant(UUID) — SECURITY DEFINER helper honouring message_participants.permissions->>'read'; EXECUTE granted to authenticated only — the participant-isolation primitive Service Case conversations MUST ride on (tenant membership alone grants nothing, matching plan 15.2)
- 20260705190000_communication_privilege_hardening.sql — privilege/grant hardening across communication tables (locked by communication-privilege-migration.test.js)

**Migrations** (16)
- database/migrations/002_add_notification_queue.sql — outbox_events, notification_queue (legacy uppercase channel CHECK), gateway_integration_logs, sync_reconciliation_queue
- database/migrations/20260623143000_omnichannel_communication_engine.sql — message_threads (thread_type CHECK), channel_identities, message_participants, messages, message_delivery_attempts, webhook_logs, communication_preferences, communication_escalations; extends notification_queue with modern columns; enables RLS
- database/migrations/20260624044812_agent8_communication_runtime_security_hardening.sql — notification_queue RLS + admin-read policies
- database/migrations/20260624045600_agent8_communication_fk_indexes.sql — FK indexes
- database/migrations/20260624120000_communication_provider_runtime.sql — provider runtime config
- database/migrations/20260625031500_agent8_communication_legacy_queue_compatibility.sql — recipient_id nullable, status/next_attempt due index
- database/migrations/20260626120000_communication_supabase_cron.sql + 20260712100000_communication_scheduler_production_activation.sql — pg_cron scheduling of worker drains
- database/migrations/20260705150000_communication_inbox_projection.sql — communication_inbox_threads view
- database/migrations/20260705170000_communication_audit_events.sql — audit events
- database/migrations/20260705180000_communication_sla.sql — SLA schema
- database/migrations/20260705190000_communication_privilege_hardening.sql — grants/privileges
- database/migrations/20260811131500_communications_2_conversation_core.sql — business_workflow/funnel_stage on message_threads, conversation_channel_bindings, message_parts, communication_templates(+versions, classification CHECK incl 'service'), conversation_events, message_derivations
- database/migrations/20260811131600..132300 (comms 2.0 series) — delivery monotonicity, workflow/template foundations, participant auth hardening (RLS), privacy binding hardening, template runtime registry, reliability closure, product capabilities, completion
- database/migrations/20260813060000_communications_2_meta_provider_template_binding.sql — Meta WhatsApp provider template binding
- database/migrations/20260817180000_notification_dedupe_uniqueness.sql — unique index uq_notification_queue_dedupe_key
- PR #194 adds: 20260828220000_passport_ownership_transfer_communications.sql — seeds governed ownership_transfer_v1 template + version

**Tests** (19)
- backend/tests/communication-engine.test.js — core thread/notification engine contract
- backend/tests/communication-event-coverage.test.js — every COMMUNICATION_EVENT_TYPES entry must have a real emitter literal; blocks phantom service events
- backend/tests/communication-outbox-dedupe.test.js — outbox/notification dedupe semantics
- backend/tests/communication-privilege-migration.test.js — locks privilege-hardening migration effects
- backend/tests/communications-2-conversation-core.test.js — ensureBusinessConversation contract (deterministic key, >=2 participants, idempotent initial message)
- backend/tests/communications-2-canonical-service-hardening.test.js — canonical notification service hardening (modified by #194)
- backend/tests/communications-2-marketplace-ingress-and-routing.test.js — marketplace event -> conversation routing (the pattern a Service Case bridge should mirror)
- backend/tests/communications-2-marketplace-outbox-hardening.test.js — outbox hardening
- backend/tests/communications-2-participant/inbound attribution: communications-2-inbound-participant-attribution.test.js — inbound message participant binding
- backend/tests/communications-2-routing-privacy-hardening.test.js — routing privacy (participant leakage protection)
- backend/tests/communications-2-governed-template-runtime.test.js + communications-2-provider-template-status.test.js — governed template registry/runtime
- backend/tests/communications-2-product-capabilities.test.js — WhatsApp session-window / product policy
- backend/tests/communications-2-admin-reply-participant-recipient.test.js + communications-2-admin-reply-recipient-identity.test.js — admin reply recipient binding
- backend/tests/communications-2-receipt-attribution-hardening.test.js — delivery receipt attribution
- backend/tests/communications-2-completion.test.js + communications-2-uat-defects.test.js — completion/UAT defect locks
- backend/tests/communications-2-staging-runner-contract.test.js — staging runner contract
- backend/tests/production-comms-scheduler-probe-contracts.test.js + production-disable-misrouted-comms-cron-*.test.js — scheduler/cron safety contracts
- web/src/features/communications/ownerReadReceipt.test.tsx + channelRegistry.test.tsx + admin/QueueOverview.test.tsx + admin/CommandCenterNav.test.tsx — frontend comms locks
- PR #194 adds: backend/tests/passport-v12-communications.test.js (passport->communications orchestration), email-hardening-durability-scheduler.test.js, email-hardening-r1-welcome-durability.test.js

**Contract gaps** (11)
- No 'service' business_workflow: communicationWorkflowService.js WORKFLOW_THREAD_TYPES and communicationStakeholderContractService.js CONTRACTS have 'garage' but no 'service'; assertWorkflow would 400 on business_workflow=service today — plan 15.1 requires add/normalize
- message_threads.thread_type CHECK (20260623143000) has no 'service' value; a service thread must reuse 'general' or ship an additive constraint migration (NOTIFICATION_POLICIES comments prove violations silently kill notifications)
- No mechanic stakeholder role anywhere: garage contract roles are only ['vehicle_owner','garage']; plan 15.2 requires mechanic(s) and admin/governance participants
- Zero service notification events: no service.* entries in COMMUNICATION_EVENT_TYPES or NOTIFICATION_POLICIES; plan 15.4 events (request received/accepted/declined, assigned, completed, cancelled) all missing, and each needs a real emitter to pass communication-event-coverage.test.js
- No governed service templates: communication_templates classification CHECK already allows 'service' but no service-case template rows exist (only #194's ownership_transfer_v1 comes close as a pattern)
- No push-token registry: no push_token/device_token table in any migration; ExpoPushAdapter reads expo_push_token from notification.payload only — plan 18's 'recipient token/address exists through governed routing' has no storage today
- Recipient address enrichment missing: delivery worker resolves email/phone/push only from notification.payload; policy-driven notifications carry none, so email/push dead-letter (documented in communicationNotificationService.js) — service events would be in_app-only without enrichment work
- No garage-audience fan-out: recipientFromPayload returns a single user id; no mechanism to notify 'accepting garage users' as a group (plan 15.2/15.4)
- No garage-side notification surface: OwnerNotificationBell.tsx is owner-dashboard only; no garage/mechanic in-app notification UI in web/src
- No service-case conversation binding failure semantics: nothing implements plan 15.5 'recoverable error/receipt' pattern for required conversation bindings (marketplace ingress is fire-and-forget via outbox)
- SMS channel enum mismatch latent: legacy 002 notification_queue channel CHECK is uppercase ('SMS','WHATSAPP','TELEGRAM','EMAIL','PUSH') while services write lowercase incl 'in_app' — any new service channel work must confirm which constraint survives on the live DB before relying on it

**Likely conflicts with Service Network** (7)
- 'garage' vs 'service' workflow naming: a garage business_workflow already exists (workflow service + stakeholder contract + emailStakeholderMatrix.js row with fallback 'in_app'); adding a parallel 'service' workflow without normalizing creates two competing conversation keys for the same interaction
- classification value 'service' is already an email/notification classification category (security/transactional/service/marketing CHECK in communication_templates, 20260811131500) — overloading it as 'Service Network' vocabulary will confuse template governance; #194 even classifies vehicle_trust_update as 'service'
- message_threads.subject_type/subject_id are free-form TEXT with dedupe keys derived from them — a 'service_case' subject_type must be chosen once and never aliased, or thread dedupe (tenant+workflow+subject) silently forks conversations
- PR #194's passportCommunicationIntent.js establishes the intent pattern (MUST NOT preselect provider/channel/template); a Service Network that queues channel-specific notifications directly would conflict with this just-landed convention
- thread_type 'general' is the current garage-workflow mapping; plan UI (Service Case detail conversation) filtering by thread_type would collide with every other 'general' thread — filter by business_workflow instead
- teamForThread() routes unknown types to 'support' — service threads without an explicit assigned_team land in the support queue, mixing garage operations into admin support SLA
- #194 heavily rewrites communicationNotificationService/EventListeners/BaseRoutes (durability reconciliation on worker tick, classification on every policy) — Service Network work branched off main before #194 merges will conflict in exactly these files

**Must reuse (do not duplicate)** (18)
- communicationWorkflowService.ensureBusinessConversation (backend/services/communication/communicationWorkflowService.js) — the ONLY sanctioned way a business workflow opens a thread: deterministic key, explicit >=2 participants, idempotent initial message; extend its allow-list, do not add a new messages table (plan 15.1)
- communicationStakeholderContractService CONTRACTS (backend/services/communication/communicationStakeholderContractService.js) — extend the garage/service contract with mechanic/admin roles here, not in a new authority
- communicationConversationService.ensureParticipant — explicit participant + stakeholder_role creation; reuse for owner/garage-user/mechanic participants
- NOTIFICATION_POLICIES + queueFromDomainEvent (communicationNotificationService.js) — add service.* policies here; #194's vehicle.ownership.transfer_* policies are the exact template to copy
- COMMUNICATION_EVENT_TYPES + registerCommunicationListeners (communicationEventListeners.js) — subscribe service events through the domain_events outbox; never call notification services directly from service routes
- domain_events outbox + eventWorker + /api/internal/events/process drain (communicationRoutes.js) — existing transport; no new scheduler/cron (see #194's reconcileCommunicationDurability precedent of piggybacking the existing tick)
- communicationCanonicalNotificationService.queueNextFallback — ordered channel fallback; do not reimplement fallback in service code
- communicationProductNotificationService.resolveWhatsappDeliveryPolicy — WhatsApp session-window/template rule (plan 17); no direct WhatsApp sends from service routes
- communicationPreferenceService + communication_preferences — consent, quiet hours, channel selection (plan 15.3)
- communication_templates/_versions governed registry + communicationGovernedTemplateService — new service templates must be seeded as governed rows (pattern: #194's 20260828220000 ownership_transfer_v1 migration)
- PR #194 emailExperience/* renderer + emailClassification + recipientResolution — canonical Email rendering for any service email (plan 16)
- uq_notification_queue_dedupe_key (20260817180000) + buildDedupeKey — notification dedupe (plan 18 'dedupe')
- public.communication_is_thread_participant RLS helper (20260811131800) — participant isolation for service conversations; satisfies plan 15.2 'tenant membership alone must not expose conversations'
- OwnerNotificationBell.tsx — in-app bell with unavailable != zero and server-count-only semantics (plan 18); extend, don't fork
- adapters/providerAdapters.js registry incl ExpoPushAdapter — push transport; provider activation is env-gated (real adapters only in production/staging), matching plan 15.3 'provider activation is not inferred from schema support'
- communication_inbox_threads projection (20260705150000 + communicationInboxProjection.js) — in-app inbox listing for any service-thread surfacing
- PR #194 passportCommunicationIntent.js pattern — channel/template-neutral communication intents from a domain authority; Service Case should emit intents the same way
- communicationAuditLog + message_delivery_attempts — delivery evidence trail (plan 18 'delivery evidence exists')

**PR #194 delta** (16)
- backend/services/communication/communicationEventListeners.js — +20 subscribed event types: 10 MARKETPLACE_* transaction stages, vehicle.trust.presentation_changed, 4 vehicle.ownership.transfer_*, user.email.verified
- backend/services/communication/communicationNotificationService.js — adds classification to every policy; new policies safetrade_transaction (threadType escrow), vehicle_trust_update (threadType account, classification 'service'), ownership_transfer (threadType account)
- backend/services/communication/emailExperience/ — 21 NEW files: canonical email renderer, classification authority, recipient resolution/presentation, brand identity/tokens, reference templates (R1-R6), text renderer
- backend/services/communication/templateVariableSubstitution.js (new) — escaping moved out of communicationGovernedTemplateService.js ('escaping is owned by the representation')
- backend/routes/communicationBaseRoutes.js — worker drain endpoint now also runs reconcileCommunicationDurability (trust-presentation + R1 welcome reconciliation) on the existing pg_cron tick; never throws into the drain
- backend/services/communication/reconcileCommunicationDurability.js (new) — durability reconciler; previously tested-but-never-invoked recovery now scheduled
- backend/routes/adminCommunicationRoutes.js — G5: reply resolves identity AND participant, binds metadata.recipient_participant_id; replies classified 'conversational'; removes fabricated systemHealth 'Optimal' / aiConfidence '98.5%' metrics
- backend/services/communication/communicationInboundService.js — inbound acknowledgement explicitly classified 'transactional'
- backend/services/communication/adapters/safeTradeDomainEventAdapter.js (new) — marketplace transaction domain-event adapter
- backend/services/communication/producers/leadershipWelcomeProducer.js (new) — durable R1 welcome producer off user.email.verified (replaces swallowed inline send)
- backend/services/communication/marketingConsentState.js (new) — marketing consent state
- backend/services/passport/passportCommunicationIntent.js (new) — channel-neutral passport communication intents; throws if provider/channel/template preselected
- database/migrations/20260828220000_passport_ownership_transfer_communications.sql (new) — governed ownership_transfer_v1 template seed
- backend/tests — new: passport-v12-communications.test.js, email-hardening-durability-scheduler.test.js, email-hardening-r1-welcome-durability.test.js; modified: communication-event-coverage.test.js, communications-2-canonical-service-hardening.test.js
- docs/communications/ — 87 added files: Email Experience 1.0 receipts, migration runbook, certification matrix, G1-G12 authority docs, email previews + runtime screenshots
- Modified core comms engine files (repository, serviceFactory, deliveryWorker, orchestrator, webhookService, canonicalConversation/Notification services, campaign, templates, authEmailTemplates, emailReplyTokenService, providerAdapters) — Service Network branches must be cut AFTER #194 to avoid conflicts in these exact files

**Notes:** Workspace verified read-only at /Users/shadreckmusarurwa/Project AI/carup-service-network (main). The Communications engine is genuinely workflow-ready: a business workflow CAN open a canonical thread today via ensureBusinessConversation, but only for the 13 allow-listed workflows — 'garage' exists (owner+garage roles, thread_type 'general'), 'service' does not, and no mechanic role exists anywhere. The three hard integration constraints for Service Network: (1) thread_type DB CHECK and the code allow-lists must be extended together or notifications silently fail at thread INSERT; (2) email/push delivery for policy-driven notifications dead-letters without payload address enrichment, and there is no push-token registry at all, so plan-18 push claims are currently unprovable; (3) every new service.* event needs a literal emitter or communication-event-coverage.test.js fails. PR #194 substantially rewrites the notification/event-listener/route files and lands the intent pattern (passportCommunicationIntent) plus governed-template-seed migration pattern that Service Network should copy verbatim; sequence Service Network work after #194 merges.

### Domain: email-whatsapp

**Files** (21)
- backend/services/communication/adapters/providerAdapters.js — all channel adapters: EmailTransportRouter (classification routing), Resend/Brevo/SendGrid/Cloudflare email, MetaWhatsAppAdapter, Twilio SMS, Expo push, fake-adapter gating (891 lines)
- backend/services/communication/communicationMetaWhatsAppGovernedAdapter.js — WhatsApp template-mode adapter: business-initiated sends REQUIRE approved Meta provider_template_reference, else refused
- backend/services/communication/communicationProductNotificationService.js — WhatsApp customer-service-window policy (24h, COMMUNICATION_WHATSAPP_SESSION_HOURS) layered over canonical routing; session vs template mode from conversation_channel_bindings.last_inbound_message_id
- backend/services/communication/communicationNotificationService.js — event→notification policy map (channels + fallbackChannels per event), dedupe key build, suppression checks
- backend/services/communication/communicationPreferenceService.js — consent (transactional_enabled/marketing_enabled), quiet hours, channel allowance/fallback merge
- backend/services/communication/communicationDeliveryWorker.js — drains notification_queue, resolves addresses, dispatches to provider adapters (290 lines on main)
- backend/services/communication/communicationEventListeners.js — COMMUNICATION_EVENT_TYPES subscribed onto event-outbox worker
- backend/services/communication/emailStakeholderMatrix.js — E6 policy: 13 declared workflows (incl. 'garage': vehicle_owner+garage roles) each with email contract; regression-asserted
- backend/services/communication/communicationWorkflowService.js — WORKFLOW_THREAD_TYPES allow-list; assertWorkflow() throws 400 for unknown workflow ('service' absent)
- backend/services/communication/authEmailTemplates.js — branded auth/security email templates (AUTH_EMAIL_TEMPLATES, renderAuthEmail)
- backend/services/communication/emailReplyTokenService.js — E2/E4 Reply-To conversation+<token>@mail.carup.dev; SHA-256 hash persisted; live revalidation on resolve
- backend/services/communication/marketingUnsubscribeService.js — unsubscribe token hash/generate, idempotent suppression assertion into communication_suppressions
- backend/services/communication/resendWebhookService.js — svix signature verify; email.bounced/complained/suppressed → canonical suppression reasons
- backend/services/communication/communicationWebhookService.js — inbound webhook verification: Meta hub.challenge + x-hub-signature-256 (CARUP_META_APP_SECRET), Resend svix, Twilio, SendGrid, Cloudflare
- backend/services/communication/communicationGovernedTemplateService.js — escaped variable substitution + governed provider template reference resolution
- backend/routes/marketingUnsubscribeRoutes.js — public token-authenticated GET/POST /api/communications/unsubscribe, rate-limited, backend-rendered HTML + RFC one-click
- backend/routes/communicationBaseRoutes.js — threads/notifications/preferences APIs, provider webhooks, internal worker endpoint
- backend/config/emailProviderQuota.js — free-tier ceilings (resend 100/day, brevo 300/day), env-overridable; documents Supabase-Auth-SMTP bypass limitation
- backend/env.example — all provider env vars (CARUP_META_*, RESEND_*, BREVO_*, TWILIO_*, CLOUDFLARE_EMAIL_*); note EMAIL_PROVIDER=sendgrid line is drift vs router's EMAIL_PROVIDER_LEGACY
- backend/server.js — mounts marketingUnsubscribeRouter() (line 303) and communicationRouter
- backend/services/communication/adapters/fakeCommunicationAdapter.js — fake adapter used whenever env is not real (default in tests)

**Tables** (14)
- message_threads — canonical threads; business_workflow TEXT (free, no CHECK) added by 20260811131500
- conversation_channel_bindings — per-participant channel binding: transactional_consent, can_send, last_inbound_message_id (WhatsApp window evidence) — 20260811131500
- channel_identities — per-user channel addresses (whatsapp/email/etc.), RLS user-read — 20260623143000
- notification_queue — delivery queue drained by pg_cron worker every minute
- message_delivery_attempts — provider attempt audit, admin-read RLS
- communication_preferences — consent + quiet hours + consent audit fields
- communication_suppressions — canonical suppression (unsubscribe/complaint/hard_bounce/manual/provider_suppression); FORCE RLS, revoked from anon/authenticated — 20260817160000
- email_reply_tokens — hashed Reply-To routing tokens — 20260817160000
- marketing_unsubscribe_tokens — hashed unsubscribe tokens, FORCE RLS — 20260817200000
- communication_templates / communication_template_versions — governed templates; provider_template_reference carries Meta WhatsApp template binding
- communication_campaigns / communication_campaign_deliveries — marketing campaigns with suppressed/sent/delivered statuses — 20260811132300
- webhook_logs — provider webhook audit, admin-read RLS
- communication_reconciliation_work — NEW in PR #194 hardening migration: durable email reconciliation work queue (R1 welcome, R5 trust presentation), FORCE RLS
- messages / message_participants — canonical conversation records (WhatsApp window proof reads messages.created_at)

**Services** (12)
- EmailTransportRouter (providerAdapters.js) — classification→adapter: marketing→Brevo, everything else (security|auth|transactional|conversational|service)→Resend; SendGrid/Cloudflare quarantined behind EMAIL_PROVIDER_LEGACY
- ResendEmailAdapter — canonical transactional/security email; auth_template_key→branded auth HTML from authEmailTemplates; RESEND_AUTH_FROM_EMAIL persona
- BrevoMarketingAdapter — marketing transport; appends unsubscribe text/HTML
- MetaWhatsAppAdapter — session (free-form text) sends to graph.facebook.com/v20.0/<phone_number_id>/messages
- CommunicationMetaWhatsAppGovernedAdapter — template-mode send; parses 'name|lang' or JSON provider_template_reference; refuses business-initiated send without approved template
- CommunicationProductNotificationService.resolveWhatsappDeliveryPolicy — authority for session-vs-template decision from binding consent + last inbound within 24h; never infers open window
- CommunicationCanonicalNotificationService + preferenceService.isChannelAllowed/selectChannels — consent gate + fallback channel merge + policyChannelsOnly hard-cap
- MarketingUnsubscribeService — token verify + idempotent canonical suppression write; CarUp owns decision, never the provider
- emailReplyTokenService — mint/resolve reply tokens; resolution revalidates live thread/participant/binding invariants
- createDefaultAdapterRegistry — REAL adapters iff NODE_ENV=production/staging or COMMUNICATION_REAL_ADAPTERS=true; otherwise FakeCommunicationAdapter
- communicationEventListeners.registerCommunicationEventListeners — subscribes canonical event types to the outbox worker
- emailProviderQuota (backend/config) — pure send-allowance policy consulted by worker/campaign service

**APIs** (7)
- GET+POST /api/communications/unsubscribe — marketingUnsubscribeRoutes.js, public, rate-limiter only, token-authenticated (no session auth)
- GET+POST /api/communications/webhooks/:provider/:channel — communicationBaseRoutes.js, provider-signature verified (svix / Meta hub.challenge + x-hub-signature-256 / Twilio / SendGrid), no session auth
- GET+POST /api/internal/communications/process — communicationBaseRoutes.js worker endpoint, invoked by Supabase pg_cron every minute; #194 adds durability reconciliation inside it
- GET /api/communications/threads, /threads/:id, POST /threads, /threads/:id/messages, /read, /feedback — communicationBaseRoutes.js, authorizeRole([])
- GET /api/communications/notifications, POST /notifications/:id/read, GET /preferences, GET /analytics — communicationBaseRoutes.js, authorizeRole([])
- GET /api/communications/health — communicationBaseRoutes.js, unauthenticated adapter health
- GET+POST /api/internal/events/process — communicationRoutes.js, event outbox worker endpoint

**Events** (7)
- marketplace.inquiry.created — emitter marketplace, consumer communicationEventListeners via event outbox worker; channels in_app/push/email, fallback whatsapp/sms
- finance.application.status_changed / approved / declined — outbox → notification policies; approved/declined include whatsapp as primary channel
- identity.verification.decided, evidence.review.decided, marketplace.listing.moderated — outbox → in_app-heavy policies (delivery worker cannot address email/push from policy payloads; documented dead-channel note in communicationNotificationService.js)
- delivery transport — notification_queue drained by pg_cron job carup-communication-worker-every-minute → /api/internal/communications/process (20260626120000)
- #194 adds subscriptions: MARKETPLACE_PAYMENT_INITIATED/INSPECTION_PENDING/RELEASE_APPROVED/TRANSACTION_DISPUTED/CANCELLED/FUNDS_HELD/SETTLED/REFUNDED/FAILED/PAYMENT_FAILED (from issue164 atomic fns via domain_events)
- #194 adds: vehicle.trust.presentation_changed (R5), vehicle.ownership.transfer_started/action_required/state_changed/completed, user.email.verified (R1 durable welcome)
- NO service.* events exist anywhere — plan section 15.4 mapping is entirely greenfield

**RLS/policies** (8)
- message_threads/messages/message_participants/channel_identities — user-read policies (participant-scoped) — 20260623143000_omnichannel_communication_engine.sql lines 315-372
- communication_preferences — user_all policy (own rows)
- notification_queue — user-read; writes are service-role/worker only
- message_delivery_attempts, webhook_logs, communication_escalations — admin-read policies
- communication_suppressions — ENABLE+FORCE RLS, REVOKE ALL from anon/authenticated (service-role only) — 20260817160000
- marketing_unsubscribe_tokens — ENABLE+FORCE RLS — 20260817200000
- communication_reconciliation_work — ENABLE+FORCE RLS — #194 20260826120000
- 20260705190000_communication_privilege_hardening.sql — privilege hardening pass locked by communication-privilege-migration.test.js

**Migrations** (11)
- database/migrations/20260623143000_omnichannel_communication_engine.sql — core comm schema (threads, messages, channel_identities, notification_queue, preferences) + RLS
- database/migrations/20260624120000_communication_provider_runtime.sql — provider runtime state
- database/migrations/20260626120000_communication_supabase_cron.sql — pg_cron every-minute worker calling /api/internal/communications/process (this is what makes staging-enqueued messages send for REAL)
- database/migrations/20260712100000_communication_scheduler_production_activation.sql — production scheduler activation
- database/migrations/20260811131500_communications_2_conversation_core.sql — business_workflow column (free TEXT), conversation_channel_bindings, communication_templates/versions, brand assets, conversation_events
- database/migrations/20260811132200_communications_2_product_capabilities.sql — WhatsApp product capabilities; provider_approval_status='pending_configuration' semantics locked by staging-runner-contract test
- database/migrations/20260813060000_communications_2_meta_provider_template_binding.sql — binds approved Meta template carup_conversation_reply|en_US; downgrade path back to pending_configuration
- database/migrations/20260817160000_email_reply_tokens.sql — email_reply_tokens + communication_suppressions (E2/E4/E5)
- database/migrations/20260817180000_notification_dedupe_uniqueness.sql — notification dedupe uniqueness
- database/migrations/20260817200000_marketing_unsubscribe_tokens.sql — marketing_unsubscribe_tokens (E3)
- #194 database/migrations/20260826120000_email_1_0_hardening.sql — communication_reconciliation_work table, vehicles.trust_presentation_announced_fingerprint, enqueue_email_welcome_reconciliation()/enqueue_trust_presentation_reconciliation() triggers, communication_domain_event_dedupe_key()

**Tests** (13)
- backend/tests/email-stakeholder-matrix.test.js — locks E6: every workflow ships with a declared Email contract; new 'service' workflow must be added here or the regression fails
- backend/tests/email-webhook-and-reply-routing.test.js — Resend webhook verify + reply-token routing (also M in #194)
- backend/tests/auth-email-templates.test.js — branded auth template rendering
- backend/tests/email-provider-quota.test.js — free-tier quota policy
- backend/tests/communication-engine.test.js — engine incl. COMMUNICATION_REAL_ADAPTERS real/fake registry gating
- backend/tests/communications-2-provider-template-status.test.js — WhatsApp provider template status truth
- backend/tests/communications-2-governed-template-runtime.test.js — governed template runtime (escaping, provider refs)
- backend/tests/communications-2-product-capabilities.test.js — WhatsApp window/product capability contracts
- backend/tests/communications-2-staging-runner-contract.test.js — asserts migration keeps provider_approval_status 'pending_configuration' (never fabricate Meta approval)
- backend/tests/communications-2-conversation-core.test.js / -marketplace-ingress-and-routing / -inbound-participant-attribution / -routing-privacy-hardening — canonical conversation + routing privacy
- backend/tests/communication-privilege-migration.test.js / communication-outbox-dedupe.test.js / communication-event-coverage.test.js — privilege, dedupe, event coverage locks
- backend/tests/integration/communication-postgres.integration.test.js + communications-2-postgres/-privacy-postgres — Postgres-backed integration locks
- #194 adds ~26 tests: email-experience-* (renderer, classification, recipient-resolution, unsubscribe-ownership, reply-token, resend-provenance, auth-equivalence), email-hardening-* (c2-c5, durability-scheduler, r1/r5 durability, reconciliation-privileges), email-reference-r1..r6

**Contract gaps** (7)
- No service.* notification events: COMMUNICATION_EVENT_TYPES and NOTIFICATION_POLICIES contain zero service-case events (request/accept/decline/assign/complete) — plan 15.4 mapping is greenfield
- 'service' business workflow does not exist: communicationWorkflowService.assertWorkflow throws 400 for it (WORKFLOW_THREAD_TYPES has marketplace/dealer/garage/parts/... but no 'service'), and emailStakeholderMatrix has no service-workflow row
- No service Email templates: neither authEmailTemplates nor #194's emailExperience/emailTemplateRegistry contain any service-case template; plan 16 requires new templates comply with the Email Experience system (which is only in PR #194, not on main)
- No approved Meta WhatsApp template for service events: only carup_conversation_reply|en_US is bound (20260813060000); any business-initiated service WhatsApp needs a new Meta-approved template registered via governed template versions, else CommunicationMetaWhatsAppGovernedAdapter refuses
- Policy-driven notifications cannot address email/push/whatsapp today unless the emitter resolves recipients: delivery worker resolves addresses from notification.payload only (documented in communicationNotificationService.js ~line 68-77); #194 adds canonical recipientResolution for email — service events will need equivalent recipient resolution for WhatsApp
- No participant model for garage-user(s)/mechanic in stakeholder matrix: existing 'garage' workflow declares only vehicle_owner+garage roles; plan 15.2 needs mechanic and admin/governance participants
- Email Experience canonical renderer/classification/recipient-resolution (plan 16 'canonical recipient resolution', 'Email classification') exists ONLY in unmerged PR #194 — building Service Network email on main without it duplicates what #194 lands

**Likely conflicts with Service Network** (7)
- Workflow naming: matrix already has 'garage' workflow (thread_type 'general'); plan introduces business_workflow='service' — the two can collide/confuse; extending WORKFLOW_THREAD_TYPES + matrix must reconcile with the existing garage entry, not add a parallel near-duplicate
- email-stakeholder-matrix.test.js will fail the moment a service workflow/thread appears without a declared matrix row — schema allows it (business_workflow is free TEXT) but policy regression does not
- Merge-conflict overlap with PR #194: it rewrites providerAdapters.js (+310 lines), communicationDeliveryWorker.js (+289), communicationBaseRoutes.js, communicationEventListeners.js, communicationServiceFactory.js — any Service Network work in those files on main will conflict; sequencing against #194 is required
- EmailTransportRouter already reserves a 'service' classification (routes to Resend) — Service Network must adopt that exact classification token, not invent 'service_case' or similar
- env.example drift: backend/env.example still documents EMAIL_PROVIDER=sendgrid/EMAIL_PROVIDER_FALLBACK while the router uses EMAIL_PROVIDER_LEGACY — copying env.example as-is would quarantine email onto legacy SendGrid
- REAL-SEND HAZARD (known: PR #148 gates C/D sent real WhatsApp): pg_cron drains notification_queue every minute on staging with real adapters (NODE_ENV=staging → createDefaultAdapterRegistry uses MetaWhatsAppAdapter/Resend); ANY test/gate/UAT that enqueues a notification row in the staging DB will send a real WhatsApp/email; jest defaults to fakes only because NODE_ENV=test — keep COMMUNICATION_REAL_ADAPTERS unset and never point tests at staging Postgres
- Plan 17 forbids 'send WhatsApp directly from service route' shortcuts — the tempting shortcut exists (MetaWhatsAppAdapter is directly importable); all sends must go through the notification queue + resolveWhatsappDeliveryPolicy

**Must reuse (do not duplicate)** (14)
- EmailTransportRouter + classification routing — backend/services/communication/adapters/providerAdapters.js (service classification → Resend already defined)
- CommunicationProductNotificationService.resolveWhatsappDeliveryPolicy — backend/services/communication/communicationProductNotificationService.js (customer-service-window authority; plan 17)
- CommunicationMetaWhatsAppGovernedAdapter — backend/services/communication/communicationMetaWhatsAppGovernedAdapter.js (approved-template enforcement outside window)
- conversation_channel_bindings (consent + window evidence) — database/migrations/20260811131500_communications_2_conversation_core.sql (plan 17 'channel identities/bindings')
- communication_suppressions + MarketingUnsubscribeService — backend/services/communication/marketingUnsubscribeService.js (plan 16 suppression rules)
- emailReplyTokenService — backend/services/communication/emailReplyTokenService.js (plan 16 Reply-To/canonical conversation behavior)
- Notification policy map + dedupe + fallback — backend/services/communication/communicationNotificationService.js (add service.* policies here, no new engine)
- communicationEventListeners COMMUNICATION_EVENT_TYPES — backend/services/communication/communicationEventListeners.js (register service events here, same outbox worker)
- Governed templates + provider_template_reference registry — backend/services/communication/communicationGovernedTemplateService.js + communication_template_versions
- emailStakeholderMatrix — backend/services/communication/emailStakeholderMatrix.js (extend with service workflow row; do not fork)
- pg_cron worker + /api/internal/communications/process — no new scheduler/cron (pattern #194 itself enforces in communicationBaseRoutes.js)
- #194 emailExperience renderer stack (renderEmail, emailClassification, recipientResolution, canonicalEmailLinks, senderPersona) — backend/services/communication/emailExperience/ once merged; plan 16 mandates compliance with it
- emailProviderQuota — backend/config/emailProviderQuota.js (free-tier ceilings for any new send volume)
- communicationPreferenceService consent gates — backend/services/communication/communicationPreferenceService.js (plan 17 transactional consent)

**PR #194 delta** (12)
- backend/services/communication/emailExperience/* (22 new modules) — canonical Email renderer, classification, recipient resolution, sender persona, canonical links, unsubscribe presentation, brand tokens, reference templates R1-R6
- backend/services/communication/adapters/providerAdapters.js (+~310) — G4 send-side provenance from the actual Resend payload, sender-persona enforcement (refuses mismatched From), List-Unsubscribe header with one-click/visible-URL match assertion, security classification honored alongside auth_template_key, Idempotency-Key
- backend/services/communication/communicationDeliveryWorker.js (+~289) — renders email via renderEmailForNotification, canonical recipientResolution with transient-retry vs durable dead-letter split, retry_scheduled status for pre-dispatch transients
- backend/routes/communicationBaseRoutes.js — worker endpoint now invokes reconcileCommunicationDurability (R1 welcome + R5 trust-presentation reconciliation) on the existing per-minute cron; counts-only logging
- backend/services/communication/communicationEventListeners.js (+27) — subscribes MARKETPLACE_* payment/transaction events, vehicle.trust.presentation_changed, vehicle.ownership.transfer_*, user.email.verified
- backend/services/communication/emailReplyTokenService.js — v2 DERIVED (reproducible) reply tokens; v1 random tokens stay resolvable
- backend/services/communication/authEmailTemplates.js (M ~38 lines) — aligned with emailExperience auth equivalence
- backend/services/communication/adapters/safeTradeDomainEventAdapter.js (A) — SafeTrade domain event adapter feeding R4 emails
- database/migrations/20260826120000_email_1_0_hardening.sql (A) — communication_reconciliation_work (FORCE RLS), vehicles.trust_presentation_announced_fingerprint, enqueue triggers, domain-event dedupe-key function
- ~26 new email tests (email-experience-*, email-hardening-*, email-reference-r1..r6) + database/test/email_reconciliation_privilege_check.mjs + scripts/email-1-0-hardening-preflight.mjs
- docs/communications/* — EMAIL_1_0 migration runbook, staging certification matrix, G1-G12 receipts, rendered previews; web/public/email-assets/manifest.json
- WhatsApp untouched by #194: no changes to communicationMetaWhatsAppGovernedAdapter.js, communicationProductNotificationService.js, Meta env vars, or the Meta template binding migration — the providerAdapters.js edits are email-side only

**Notes:** Email 1.0 (merged, on main) is the sending authority: EmailTransportRouter routes by classification (marketing→Brevo, all else→Resend; legacy quarantined behind EMAIL_PROVIDER_LEGACY), with canonical suppression (communication_suppressions), hashed unsubscribe + reply tokens, and public token-authenticated unsubscribe routes. WhatsApp is a Communications transport only: MetaWhatsAppAdapter (session) + governed template adapter (business-initiated), gated by resolveWhatsappDeliveryPolicy which proves the 24h customer-service window from conversation_channel_bindings.last_inbound_message_id and otherwise demands the one approved Meta template (carup_conversation_reply|en_US). Real-send hazard is structural, not test-code: NODE_ENV=staging/production (or COMMUNICATION_REAL_ADAPTERS=true) swaps in real adapters and Supabase pg_cron drains notification_queue every minute via /api/internal/communications/process — enqueueing anything in the staging DB sends real WhatsApp/email (exactly how PR #148 gates C/D fired real WhatsApp). Service Network sequencing: the 'service' email classification slot already exists in the router, but the 'service' workflow, matrix row, notification policies, events, and any Meta service templates are all greenfield, and PR #194 rewrites the very files (providerAdapters, deliveryWorker, eventListeners, baseRoutes) Service Network must touch — land or rebase on #194 first.

### Domain: passport-evidence

**Files** (19)
- backend/server.js — buildVehiclePassport (line 868): the passport projection builder; audience gate (line ~885-906); public timeline sanitizer (1240-1345); passport routes 1442/1457; canonicalPassportTrust cache-only trust read (793+)
- backend/services/trustGraph/trustGraphService.js — getVehicleTimeline(vin): projects 11 source tables into timeline events (480 lines)
- backend/utils/passportLookupPolicy.js — governed lookup policy: VIN public, plate/temp-id/chassis auth-only, NON_ENUMERABLE_LOOKUP_RESPONSE answered without querying DB
- backend/utils/publicVehicleProjection.js — PUBLIC_EVIDENCE_FIELDS allow-list (line 239) + toPublicEvidence; source_name published, source_id withheld
- backend/utils/vehicleMediaProjection.js — media contract separating listing_media (marketing) from verified_evidence (governed proof); holds publication gate
- backend/routes/vehiclesRoutes.js — evidence upload/read/review/verify/reject/link-event routes (1043 lines); public read projects through PUBLIC_EVIDENCE_FIELDS, signed URLs only for authorized readers
- backend/routes/evidenceCatalogRoutes.js — taxonomy, sources, evidence-sets, provenance, extractions routes
- backend/services/evidence/evidenceService.js — validation, role matrix, normalizeEvidenceRecord, evidenceToTimelineItem, mergeEventsWithEvidence (437 lines)
- backend/services/evidence/evidenceTaxonomy.js — 8 life-stage classes + subtype catalog + 13 legacy-type mapping; runtime mirror of seed migration 20260621120000
- backend/services/evidence/vehicleFactResolver.js — governed vehicle facts resolved from evidence inputs; FACT_STATUS / PROVENANCE_KINDS / FACT_INPUT_TABLES (986 lines)
- backend/services/evidence/provenanceService.js — provenance event chain: computeContentHash, recordProvenanceEvent, verifyProvenanceChain, toPublicProvenanceSummary
- backend/services/evidence/sourceRegistryService.js — PUBLIC_SOURCE_FIELDS, listPublicSources (reads evidence_sources_public), sourcePermitsClass
- backend/services/evidence/evidenceSetService.js / completenessEvaluator.js / extractionService.js / perceptualHash.js / uploadIdempotency.js — set grouping, completeness scoring, OCR extraction review, dedupe hashing, idempotent upload
- backend/services/evidence/evidenceReviewNotifier.js — evidence review decision → 'evidence.review.decided' domain event bridge (best-effort)
- backend/middleware/authMiddleware.js — optionalAuth is a FACTORY; publishes identityAsserted so an asserted x-user-id cannot buy the owner audience
- backend/services/blockchain/blockchainService.js — verifyChain used by /api/vehicles/:vin/verify-ledger; issue158 custody target
- web/src/pages/VehicleDetail.tsx + web/src/hooks/useCarUpApi.ts — passport consumers: request /vehicles/:vin/passport (line 632) and /vehicles/passport/lookup/:id (line 865)
- web/src/components/EvidenceUploadModal.tsx — evidence upload UI
- backend/services/diaspora/diasporaOwnershipHandoffService.js — existing writer touching ownership handoff (pre-#194)

**Tables** (13)
- vehicle_evidence — canonical evidence rows: vin, evidence_type(+class/subtype via later migrations), file/storage (storage_bucket vehicle-images|ocr-documents), visibility_level (public_safe/restricted/private/government_only), verification_status, trust_impact, metadata JSONB, plate/chassis/engine columns (withheld publicly); owning migration 014
- evidence_class_taxonomy — seeded 8 life-stage classes; owning migration 20260621120000
- evidence_sources — registered evidence sources; public projection via evidence_sources_public view (security_invoker, issue101-hardened)
- evidence_sets — grouped evidence submissions (20260621120000)
- evidence_provenance_events — hash-chained provenance per evidence row (20260621120000)
- vehicle_ownership_history — ownership transfer source events; timeline reads id/transfer_date/previous_owner_id/new_owner_id; #194 adds transfer_id + uniqueness and makes the atomic transfer fn its writer
- mechanic_work_orders — service-record source: tenant_id, vin, customer_id, customer_name (006), status, description, labor_cost/total_cost, mechanic_id, created_at (006_domain1 + 009_phase4); PII columns never selected by the timeline
- partsentry_logs — part event source (timestamp, action_type, part_name, mechanic_id, mileage, description)
- insurance_records / safepay_escrows / zimra_declarations / cvr_ownership_records / vid_inspections / cid_clearance_records / zinara_licensing_records / vehicle_plate_history — remaining timeline projection sources
- listing_images — seller marketing media; read only through vehicleMediaProjection publication gate
- domain_events — outbox transport for evidence.review.decided
- #194 NEW: vehicle_ownership_transfers + vehicle_ownership_transfer_events — transfer authority, service_role-only (20260828203000)
- #194 NEW: blockchain_custody_rollout + public_keys RLS — issue158 key custody (20260828210000+)

**Services** (12)
- backend/server.js buildVehiclePassport — passport projection authority: vehicle row + timeline + evidence vault + media contract + claims + cache-only canonical trust; collaborators injected as parameters
- backend/services/trustGraph/trustGraphService.js — getVehicleTimeline: parallel reads of vehicle_ownership_history, partsentry_logs, mechanic_work_orders (deliberately excludes description/issue_description/customer_name/customer_id), insurance_records, safepay_escrows, zimra/cvr/vid/cid/zinara, vehicle_plate_history; emits prefixed event ids (workorder:/partsentry:/...)
- backend/services/evidence/evidenceService.js — evidenceTypes, verificationStatuses [pending/verified/rejected/disputed/superseded], uploadRoleMatrix, reviewRoles, normalizeEvidenceRecord, evidenceToTimelineItem, mergeEventsWithEvidence, runAiAnalysis
- backend/services/evidence/evidenceTaxonomy.js — EVIDENCE_CLASSES (import/auction/accident/repair/inspection/ownership_transfer/dealer_listing/current_condition), CLASS_SUBTYPES, LEGACY_TYPE_TO_CLASS
- backend/services/evidence/provenanceService.js — PROVENANCE_EVENT_TYPES, computeContentHash, recordProvenanceEvent, verifyProvenanceChain, toPublicProvenanceSummary
- backend/services/evidence/sourceRegistryService.js — toPublicSource/listPublicSources via evidence_sources_public, sourcePermitsClass
- backend/services/evidence/vehicleFactResolver.js — resolveFact + FACT_DEFINITIONS/FACT_STATUS/PUBLISHABLE_FACT_STATUSES/PROVENANCE_KINDS; CALCULATION_VERSION vehicle-fact-1.0.0
- backend/services/evidence/uploadIdempotency.js / perceptualHash.js / extractionService.js / completenessEvaluator.js / evidenceSetService.js — dedupe, hashing, OCR extraction review, completeness, set grouping
- backend/services/evidence/evidenceReviewNotifier.js — review decision → evidence.review.decided outbox bridge
- backend/utils/passportLookupPolicy.js — classifyLookupIdentifier, resolveLookupAccess, LOOKUP_KINDS/PUBLIC_LOOKUP_KINDS/NON_ENUMERABLE_LOOKUP_RESPONSE
- backend/utils/publicVehicleProjection.js + vehicleMediaProjection.js — public evidence allow-list and two-model media contract
- #194 adds backend/services/passport/* (21 modules) — see pr194_delta

**APIs** (15)
- GET /api/vehicles/:vin/passport — backend/server.js:1442, passportLimiter(30/min) + optionalAuth(); audience decided by proven identity only
- GET /api/vehicles/passport/lookup/:identifier — backend/server.js:1457, passportLookupLimiter(10/min) + optionalAuth + resolveLookupAccess policy gate before any query
- GET /api/vehicles/:vin/verify-ledger — backend/server.js (public), blockchain verifyChain
- POST /api/vehicles/:vin/evidence/upload — backend/routes/vehiclesRoutes.js:492, authorizeRole() + uploadRoleMatrix in service
- POST /api/evidence/upload — vehiclesRoutes.js:516, authorizeRole()
- GET /api/vehicles/:vin/evidence — vehiclesRoutes.js:525, public with PUBLIC_EVIDENCE_FIELDS projection; signed URLs only for authorized readers
- GET /api/vehicles/:vin/evidence/timeline — vehiclesRoutes.js:675
- GET /api/evidence/review — vehiclesRoutes.js:741, authorizeRole(reviewRoles=[admin,government,dealer,mechanic])
- PATCH /api/vehicles/:vin/evidence/:id/verify and /reject — vehiclesRoutes.js:772/868, authorizeRole([admin,government])
- PATCH /api/vehicles/:vin/evidence/:id/link-event — vehiclesRoutes.js:963, authorizeRole()
- GET /api/evidence/taxonomy and GET /api/evidence/sources — evidenceCatalogRoutes.js:41/46, public
- POST+GET /api/vehicles/:vin/evidence-sets — evidenceCatalogRoutes.js:57/74
- GET /api/vehicles/:vin/evidence/:id/provenance — evidenceCatalogRoutes.js:81
- POST /api/vehicles/:vin/evidence/:id/extractions, GET /api/vehicles/:vin/extractions, PATCH extraction review — evidenceCatalogRoutes.js:101/114/129
- #194 NEW: POST /api/vehicles/:vin/ownership-transfers, GET+PATCH /api/ownership-transfers/:transferId — backend/routes/passportOwnershipTransferRoutes.js, authorizeSessionRole([])

**Events** (5)
- evidence.review.decided — emitted by backend/services/evidence/evidenceReviewNotifier.js after verify/reject persists; consumer: notification fabric (NOTIFICATION_POLICIES → evidence_review_v1 template); transport: domain_events outbox via eventBusService.emitDomainEvent
- domain_events outbox table — backend/services/eventBus/eventBusService.js inserts with dedupe (idx_domain_events_dedupe_key)
- timeline 'events' (event_source: ownership_transfer/service/insurance/escrow/zimra/cvr/vid/cid/zinara/plate_*) are read-side projections built per-request in getVehicleTimeline, NOT bus events
- #194: passportCommunicationIntent.js requires canonical domain_event_type + (domain_event_id or deterministic dedupe_key) for every passport communication
- #194: ownership-transfer comms template ownership_transfer_v1 seeded via migration 20260828220000 into communication_templates/_versions

**RLS/policies** (8)
- vehicle_evidence — RLS enabled (015); 'vehicle evidence public verified read' (anon, visibility_level=public_safe AND verification_status=verified) REVOKED+dropped by 20260825090000: anon has NO select; public reads flow only through service_role backend projection; authenticated read/insert/update-own-pending kept
- evidence_sources — evidence_sources_public_read policy (issue101 20260814090000); base table RLS enabled by 20260621120000
- evidence_sources_public (view) — security_invoker=true; REVOKE ALL then GRANT SELECT to anon+authenticated, ALL to service_role (issue101 B3-P0 closed the write/bypass path)
- evidence_class_taxonomy — evidence_class_taxonomy_public_read (issue101)
- evidence_sets — 'evidence sets authenticated read' (20260621120000)
- evidence_provenance_events — 'provenance authenticated read' (20260621120000)
- #194: vehicle_ownership_transfers / vehicle_ownership_transfer_events — RLS enabled, REVOKE ALL from anon+authenticated; SELECT/INSERT/UPDATE only to service_role; atomic transfer functions EXECUTE service_role-only
- #194: public_keys — RLS enabled by 20260828210000 (issue158 custody)

**Migrations** (10)
- database/migrations/014_passport_evidence_architecture.sql — creates vehicle_evidence (vin/evidence_type/storage_bucket/visibility_level/verification_status/trust_impact/metadata, +plate/chassis/engine columns)
- database/migrations/015_vehicle_evidence_timeline.sql — enables RLS on vehicle_evidence; public-verified-read (anon), authenticated read/insert/update-own-pending policies
- database/migrations/20260618050000_verification_evidence_trust_columns.sql — additive assessment columns on verification_sessions
- database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql — evidence_class_taxonomy, evidence_sources, evidence_sources_public view, evidence_sets, evidence_provenance_events + RLS
- database/migrations/20260814090000_issue101_p0_rls_and_view_hardening.sql — evidence_sources_public security_invoker=true, SELECT-only to anon/authenticated, evidence_sources_public_read + evidence_class_taxonomy_public_read policies
- database/migrations/20260825090000_revoke_anon_vehicle_evidence_select.sql — revokes anon SELECT on vehicle_evidence and drops the anon policy; public reads flow through service_role backend only (Down restores exactly)
- database/migrations/006_domain1.sql + 009_phase4_schema.sql — mechanic_work_orders source table (customer_name/customer_id/description PII columns live here)
- #194 A: 20260828203000_passport_ownership_transfer_authority.sql — vehicle_ownership_transfers + _events, atomic begin/transition SQL functions, service_role-only
- #194 A: 20260828220000_passport_ownership_transfer_communications.sql — ownership_transfer_v1 template seed
- #194 A: 20260828210000/20260829003000/20260829020000 issue158 custody chain — blockchain_custody_rollout table, blockchain_activate_public_key_atomic, public_keys RLS; plus scripts issue158_mark_old_writers_drained.sql / issue158_private_key_custody_finalize.sql

**Tests** (12)
- backend/tests/d0-evidence-private-data-exposure.test.js — locks the 54-column anonymous evidence leak closed (uploaded_by/verified_by/file_path/plate/chassis/tenant_id/verification_notes + signed-URL minting)
- backend/tests/issue164-phase8-service-timeline-privacy.test.js — workorder sanitizer scoped by id prefix: public gets fixed wording, PartSentry keeps real part text (both directions asserted)
- backend/tests/issue164-d0-evidence-route-authorization.test.js — evidence route authorization contract
- backend/tests/issue164-d0-evidence-timeline-projection.test.js — evidence-to-timeline projection contract
- backend/tests/issue164-d2-verified-evidence-published-not-none.test.js — verified evidence must publish, sparse-data honesty
- backend/tests/issue164-phase4-passport-claim-columns.test.js — claim-governed vehicle columns withheld from projection
- backend/tests/issue164-phase5-passport-media-wiring.test.js — media contract spread onto passport body (M in #194)
- backend/tests/issue164-lookup-policy.test.js — non-enumerable plate/temp-id/chassis lookup
- backend/tests/evidence-api.test.js / evidence-validation.test.js / evidence-catalog-routes.test.js / evidence-ai-fraud.test.js / identity-evidence-validation.test.js — upload validation, catalog routes, AI-analysis sanitation
- backend/tests/issue-101-p0-hardening.test.js (+post-cutover/data-api/public-keys/cutover siblings) — evidence_sources_public and RLS posture
- #194 A: passport-foundation-contract.test.js + passport-v2..v16 suites — audience/claim/evidence/trust/timeline/ownership/service-parts/communications/golden-lifecycle contracts incl. passport-v8-service-parts.test.js
- #194 A: issue-158-private-key-custody / rotation-boundary / boundary-upgrade-postgres tests — custody chain; test asserts transfer service does NO direct vehicle_ownership_history insert (atomic SQL only)

**Contract gaps** (8)
- No garage/provider identity in the service projection: mechanic_work_orders has only mechanic_id + tenant_id/organization_id, no garage entity or display name — Invariant 10 'Provider not recorded' state must be built from scratch
- No service provenance vocabulary (plan 6.6) on mechanic_work_orders or partsentry_logs — nothing distinguishes self-reported vs mechanic-signed vs garage-verified
- mechanic_work_orders has no service/event date distinct from created_at, no odometer, no evidence linkage column — S6 'Passport V8 source enrichment' precondition; a backdated real service date is currently unrepresentable on the timeline
- Evidence taxonomy has no routine service/maintenance class and no 'receipt' or 'service provider document' subtype (closest: repair/repair_invoice, mechanic_certification, inspection/odometer_reading) — must extend via module + seed-migration lockstep (evidenceTaxonomy.js + 20260621120000 pattern)
- No service_cases table, no service lifecycle events (request/accept/assign/complete) anywhere in database/migrations — timeline cannot project a service lifecycle
- No garage directory / publication surface, hence no passport 'serviced by <garage>' attribution path
- No per-record cost privacy policy beyond blanket public redaction (public details allow-list drops cost/mechanic at server.js:1332-1345); plan 11.1 private-cost is only implicitly satisfied
- No passport module on main: 'Passport V8' is a lineage name, not a code marker (zero V8 strings in backend) — the projection authority is inline server.js + trustGraphService; S0's 'audit Passport V8 projection' means auditing those two files unless #194 merges first

**Likely conflicts with Service Network** (7)
- #194 creates vehicle_ownership_transfers authority whose SQL fn INSERTs vehicle_ownership_history (adds transfer_id + uq_vehicle_ownership_history_transfer) — Service Network ownership/history assumptions must reconcile with this new writer; hard merge-order dependency
- #194 adds passportLifecycleTimeline + passportServicePartsProjection formalizing 'Passport V8' as modules; plan S6 'Passport V8 source enrichment' targets a projection that lives inline in server.js on main today — Foundation must pick ONE target depending on #194 merge order or fork the authority
- Invariant 9: plan forbids a second service timeline; #194's passportLifecycleTimeline/passportTimelineService already sit beside trustGraphService.getVehicleTimeline — adding a Foundation service timeline would make a third
- #194 registers communication template ownership_transfer_v1 + passportCommunicationIntent vocabulary; Service Network notification templates/intents must not collide with these keys
- Service Link/QR (plan §20) lookups must go through passportLookupPolicy PUBLIC_LOOKUP_KINDS (deliberately a list of ONE); adding QR resolution as a new anonymous kind conflicts with the non-enumerable oracle contract unless added there openly
- issue158 custody chain (#194) rewrites blockchainService signing behind /verify-ledger; any Service Network ledger/signing of service records lands on a custody boundary currently mid-reconciliation on integration/vehicle-passport-v16-cert
- Naming: plan's 'service record' vs existing mechanic_work_orders rows already projected as event_source:'service' with workorder: id prefix — a new service_records table must not double-count against these on the timeline

**Must reuse (do not duplicate)** (13)
- trustGraphService.getVehicleTimeline (backend/services/trustGraph/trustGraphService.js) — THE single history projection; service-case/work events must be added as new source reads here (or its #194 successor), never as a parallel timeline authority (Invariant 9)
- buildVehiclePassport audience gate (server.js 885-906): provenIdentity via optionalAuth-published identityAsserted flag + PASSPORT_PRIVILEGED_ROLES — reuse for owner vs public service projection, never re-read headers
- PUBLIC_EVIDENCE_FIELDS + toPublicEvidence (backend/utils/publicVehicleProjection.js) — the one public evidence allow-list both passport and /evidence route share; extend it, do not fork it
- Evidence upload pipeline: validateEvidenceUploadPayload, uploadRoleMatrix, uploadIdempotency, buildEvidenceProvenanceColumns, recordEvidenceUploadProvenance (backend/services/evidence/) — service evidence attaches BY REFERENCE here (plan 12: no service-media silo)
- evidenceTaxonomy governance path — new service classes/subtypes go into evidenceTaxonomy.js + a seed migration mirroring 20260621120000, keeping module and DB in lockstep
- PATCH /api/vehicles/:vin/evidence/:id/link-event (vehiclesRoutes.js:963) + vehicle_evidence.timeline_event_id — existing evidence-to-timeline binding for service records
- emitDomainEvent → domain_events outbox (backend/services/eventBus/eventBusService.js) + evidenceReviewNotifier pattern — service notification events ride the same fabric
- timeline sanitizer workorder branch (server.js:1267-1278) — the id-prefix-scoped public wording pattern ('Service record signed by a mechanic') for any new PII-bearing service source
- passportLookupPolicy.resolveLookupAccess + PUBLIC_LOOKUP_KINDS (backend/utils/passportLookupPolicy.js) — any QR/service-link vehicle resolution must reuse this non-enumerable policy
- vehicleFactResolver (backend/services/evidence/vehicleFactResolver.js) — governed fact derivation from evidence for any service-derived claims
- canonicalPassportTrust (server.js:793) — cache-only MATERIALIZED trust read; service surfaces needing trust read this, never recompute (Invariant 4)
- vehicleMediaProjection contract — keeps governed evidence separate from marketing media; service photo galleries must not merge the two
- #194 modules if merged first: passportContract audiences/PUBLIC_FORBIDDEN_KEYS, passportEvidenceProjection, passportServicePartsProjection.buildPassportServicePartsSection as the S6 extension points

**PR #194 delta** (13)
- backend/services/passport/ (21 new modules incl. README) — versioned passport layer V1-V16: passportContract (PASSPORT_AUDIENCES/VISIBILITY, PUBLIC_FORBIDDEN_KEYS, assertPublicSafeObject), passportReadModelService (assemblePassportReadModel), passportAccessPolicy, passportEvidenceProjection, passportServicePartsProjection (projects work orders + PartSentry — the modularized V8), passportLifecycleTimeline, passportOwnershipProjection/TransferService/TransferStateMachine, passportTrustLens, passportAttentionRail, marketplace/surface convergence, passportCommunicationIntent, AI advisory, external source adapter, golden lifecycle certification
- backend/routes/passportOwnershipTransferRoutes.js (A) — transfer begin/read/transition endpoints via authorizeSessionRole([]) calling passport_*_atomic RPCs
- backend/server.js (M) — app.use(passportOwnershipTransferRouter); buildVehiclePassport gains buildCanonicalVehicleLifecycle collaborator on both passport routes
- backend/services/report/canonicalVehicleLifecycleService.js (A) + reportService.js (M) — canonical lifecycle assembled for the passport body
- database/migrations/20260828203000 (A) — vehicle_ownership_transfers + vehicle_ownership_transfer_events, RLS enabled, REVOKE anon/authenticated, service_role-only grants + EXECUTE on atomic fns; transition fn INSERTs vehicle_ownership_history with transfer_id + uq constraint
- database/migrations/20260828220000 (A) — ownership_transfer_v1 communication template + versions seed
- issue158 custody (A): blockchainKeyCustodyService.js, blockchainService.js (M), migrations 20260828210000/20260829003000/20260829020000, drain/finalize scripts, tests issue-158-{private-key-custody,rotation-boundary,boundary-upgrade-postgres} — key custody behind the ledger the passport's /verify-ledger reads
- evidence delta: backend/services/evidence/sellerFactReconciliation.js (A: RECONCILIATION_STATE, reconcileSellerFacts over vehicle+extractions; deliberately no exported column array per issue164-phase1 contract); completenessEvaluator.js (M); d0-evidence-private-data-exposure.test.js (M); issue164-phase5-passport-media-wiring.test.js (M)
- tests (A): passport-foundation-contract + passport-v2..v16 suites (identity-access, evidence-provenance, verification-discrepancy, trust-lens, lifecycle-timeline, ownership-transfer, service-parts, attention-rail, marketplace/surface convergence, communications, ai-advisory, external-adapter, golden-lifecycle, ownership-authority, postgres-authorities, runtime-convergence)
- web/src/pages/dashboard/owner/VehicleProfile.passport-v15.test.tsx (A) — owner surface passport contract
- .github/workflows/vehicle-passport-foundation-ci.yml (A) — node --check gates over the passport modules
- backend/routes/vehiclesRoutes.js (M) — adds PATCH /api/vehicles/:vin/price (adjacent to but not part of the evidence surface)
- docs/vehicle-passport-lifecycle/ (A) — canonical plan, authority map, V0-V16 certification receipts

**Notes:** Workspace verified read-only at canonical main. On main the passport projection authority is buildVehiclePassport in backend/server.js composing over injected collaborators (trust, claims, media) plus trustGraphService.getVehicleTimeline; there is NO backend/services/passport directory. PR #194 (branch integration/vehicle-passport-v16-cert, currently mid issue158 reconciliation per git status) introduces the entire versioned passport service layer V1-V16 including passportServicePartsProjection (the modular 'V8'), an ownership-transfer authority whose only writer to vehicle_ownership_history is a service_role-gated atomic SQL function (tests assert no JS-side insert), and threads buildCanonicalVehicleLifecycle into buildVehiclePassport. Service Network S6 work is therefore merge-order-coupled to #194: enrich source tables (garage identity, service date, provenance, evidence link) and let the existing projection — whichever shape wins — read them, per Invariant 9.

### Domain: partsentry-workorders

**Files** (22)
- backend/services/partsentry/partsentryService.js — addRepairLog (odometer guard, sha256 signature, 5-min idempotency, tenant stamping, vehicles.mileage overwrite, blockchain event) + getRepairHistory with fail-closed public allowlist
- backend/routes/workOrdersRoutes.js — the ENTIRE work-order API (91 lines): list/create/patch mechanic_work_orders, tenant-scoped, no service module behind it
- backend/routes/partsRoutes.js — mechanic parts inventory list/create against mechanic_parts
- backend/routes/partsentryReviewRoutes.js — 9 governed review endpoints delegating to trustGovernance/partsentryReviewService
- backend/services/trustGovernance/partsentryReviewService.js — 790-line review authority: create/approve/reject/revoke/flag/clear/audit-trail, suspicion gating, evidence checks
- backend/server.js:1630-1686 — POST /api/partsentry/add (ownership check for non-mechanics) and GET /api/partsentry/:vin (publicOnly widening on verified owner_id only)
- backend/server.js:2833-2853 — GET /api/service-history/me reads mechanic_work_orders across owned VINs (owner service history surface)
- backend/server.js:563-590 — ownerGarageCounts: services tallied from mechanic_work_orders, parts from partsentry_logs, null-not-zero semantics
- backend/services/trustGraph/trustGraphService.js:30 — public vehicle timeline reads mechanic_work_orders with privacy-restricted select (id, vin, created_at, status, mechanic_id, total_cost only)
- backend/check-mileage.js — dev scratch script: read-only SELECT of one hardcoded VIN; NOT a mileage authority (duplicate in backend/scratch/check-mileage.js)
- backend/services/evidence/vehicleFactResolver.js — canonical fact resolver (Issue #164 Phase 2); covers the six verification booleans, does NOT cover mileage
- backend/services/marketplace/marketplacePartsService.js — gated public /api/marketplace/parts and /api/marketplace/services surface; returns governed empty results, no fabricated listings
- backend/services/golden/goldenVehicleSpecs.js:108-109 — Golden A fixture pins odometer 78450 and asserts addRepairLog rejects lower readings
- backend/services/golden/goldenVehicleFixture.js — injects addRepairLog as a collaborator for golden dataset builds
- backend/services/evidence/evidenceTaxonomy.js:76,102 — existing evidence classes 'odometer_reading' and 'odometer' (plan 12 odometer-photo class already exists)
- web/src/pages/dashboard/mechanic/WorkOrders.tsx — list/create/complete/cancel UI; optimistic update w/ rollback; keeps full DB id for PATCH
- web/src/pages/dashboard/mechanic/ServiceLogs.tsx — PartSentry log create + per-VIN history; action types mirror DB CHECK
- web/src/pages/dashboard/mechanic/PartsTracking.tsx — garage parts inventory over /api/mechanic/parts
- web/src/pages/dashboard/mechanic/MechanicDashboard.tsx — mechanic landing surface
- web/src/pages/dashboard/owner/PartSentry.tsx — owner-side repair-log surface hitting /api/partsentry/add
- web/src/hooks/useCarUpApi.ts:900,2010-2035 — client bindings: /partsentry/add, /partsentry/:vin, /mechanic/work-orders (GET/POST/PATCH), /mechanic/parts (GET/POST)
- web/src/types/index.ts:1299 — WorkOrder interface; status union mixes DB CHECK values with lowercase normalized forms ('pending'|'in-progress'|'completed'|'cancelled'|'In Progress'|'Completed'|'Cancelled')

**Tables** (6)
- mechanic_work_orders — converged superset of two historical shapes: id UUID, tenant_id UUID, organization_id TEXT (legacy, nullable post-convergence), vin FK vehicles ON DELETE CASCADE, customer_id FK users, customer_name (legacy, nullable), mechanic_id FK users, description, issue_description (006 legacy), labor_cost, total_cost, status, created_at, updated_at; CHECK status IN ('In Progress','Completed','Cancelled') from 009_phase4_schema.sql
- mechanic_parts — garage private stock: tenant_id UUID FK tenants, name, sku, stock_level, min_stock, supplier (free text, not a principal), unit_price, UNIQUE(tenant_id, sku); converged with legacy organization_id shape
- partsentry_logs — repair ledger: BIGSERIAL id, vin FK vehicles, mechanic_id FK users NOT NULL, part_name, part_oem, action_type CHECK IN ('Replaced','Repaired','Inspected','Diagnosed'), description, mileage INTEGER NOT NULL, signature, timestamp TEXT, tenant_id (FK tenants, added later), verification_status + part_verification_status CHECK IN ('unverified','pending','verified','rejected','disputed'), suspicion_status CHECK IN ('none','watch','flagged','cleared'), public_card_eligible BOOLEAN DEFAULT false
- partsentry_review_requests — governed review ledger: partsentry_log_id FK, vin FK, request_type CHECK IN ('public_card_eligible','verification_status','part_verification_status','suspicion_status'), status CHECK IN ('pending','approved','rejected','revoked','superseded'), requester/reviewer identity+role+tenant, evidence_ids[], reason, decision_notes, unique partial index enforcing one pending request per (log, type) — 20260710130000
- vehicles.mileage — the canonical odometer column; its ONLY application writer is partsentryService.addRepairLog:51 (monotonic >= guard, then overwrite)
- NO service_case, service_record, work_order_assignment, garage_directory, or service_link table exists in database/migrations (grep confirmed zero hits)

**Services** (6)
- backend/services/partsentry/partsentryService.js — parts/service provenance authority: addRepairLog(vin, mechanicId, partName, partOem, actionType, description, mileage, tenantId) and getRepairHistory(vin, {publicOnly}); public rows require public_card_eligible=true AND suspicion in ('','none','cleared') allowlist
- backend/services/trustGovernance/partsentryReviewService.js — exported authority functions: createPartSentryReviewRequest, listPartSentryReviewQueue, approvePartSentryReviewRequest, rejectPartSentryReviewRequest, revokePartSentryReviewRequest, flagPartSentrySuspicion, clearPartSentrySuspicion, getPartSentryReviewAuditTrail, getPartSentryLogForReview, validatePartSentryReviewPayload; approval blocked while suspicion is watch/flagged; audits via shared auditLogger
- NO work-order service module exists — workOrdersRoutes.js and partsRoutes.js query supabase directly; any Service Case ↔ work order bridge must either add a service layer or extend the routes
- backend/services/trustGraph/trustGraphService.js — timeline consumer of mechanic_work_orders + partsentry_logs; its column-restricted select is contract-locked by issue164-phase8 test
- backend/services/evidence/vehicleFactResolver.js — pure, injected-read fact resolver pattern (starts at unknown, moved only by rows actually read) that plan 13.1 mileage reconciliation should extend
- backend/services/marketplace/marketplacePartsService.js — governed public parts/services marketplace projection; mirrors PartSentry suppression rules; explicitly forbids fabricated supplier/verification labels

**APIs** (13)
- GET /api/mechanic/work-orders — workOrdersRoutes.js, authorizeRole(['mechanic','admin']), tenant-filtered
- POST /api/mechanic/work-orders — workOrdersRoutes.js, authorizeRole(['mechanic','admin']); VIN must exist in vehicles; customer_id auto-resolved from vehicles.owner_id; mechanic_id = creator (req.userContext.id); status forced 'In Progress'
- PATCH /api/mechanic/work-orders/:id — workOrdersRoutes.js, authorizeRole(['mechanic','admin']); accepts only status in ('In Progress','Completed','Cancelled') + optional non-negative total_cost; tenant scoping inside the UPDATE (cross-tenant = 404); NO transition guard from terminal states
- GET /api/mechanic/parts — partsRoutes.js, authorizeRole(['mechanic','admin'])
- POST /api/mechanic/parts — partsRoutes.js, authorizeRole(['mechanic','admin'])
- POST /api/partsentry/add — server.js:1630, authorizeRole(['mechanic','owner','dealer','admin']); non-mechanic/non-admin must own the vehicle or share its tenant
- GET /api/partsentry/:vin — server.js:1658, optionalAuth(); public allowlist projection by default, full history only for mechanic/admin or verified owner_id match (forged x-tenant-id header deliberately NOT trusted)
- POST /api/verification/partsentry/:logId/requests — partsentryReviewRoutes.js, authorizeRole(['mechanic','owner','dealer','admin'])
- GET /api/verification/partsentry/review-queue — partsentryReviewRoutes.js, admin only
- PATCH /api/verification/partsentry/:requestId/approve|reject|revoke — partsentryReviewRoutes.js, admin only
- PATCH /api/verification/partsentry/:logId/flag-suspicion|clear-suspicion — partsentryReviewRoutes.js, admin only
- GET /api/verification/partsentry/audit-trail/:vin and /logs/:logId — partsentryReviewRoutes.js, admin only
- GET /api/service-history/me — server.js:2833, authorizeRole(['owner','dealer','admin']); mechanic_work_orders for the caller's owned VINs

**Events** (3)
- 'Mechanic Inspection' blockchain ledger event — emitted by partsentryService.addRepairLog via blockchainService.addEvent (blockchain_events table); payload: logId, partName, partOem, actionType, odometer, mechanicId, signature; emitted only AFTER the insert succeeds
- PartSentry review audit events — partsentryReviewService via logAuditEvent (services/auditLogger.js) on every create/approve/reject/revoke/flag/clear, carrying actor, previous/new values, source route
- NO eventBus/Communications emission exists from workOrdersRoutes, partsRoutes, or partsentryService — work-order lifecycle changes are silent (plan section 8/15 events are all net-new)

**RLS/policies** (5)
- mechanic_work_orders — RLS ENABLED, zero policies, REVOKE ALL FROM anon+authenticated, GRANT ALL TO service_role (20260809110000_api_role_write_hardening.sql:27-33); service-role-only posture, all access mediated by Express
- mechanic_parts — same service-role-only posture (20260809110000:28-34)
- partsentry_logs — RLS ENABLED in supabase_schema.sql:307; no anon/authenticated policies
- partsentry_review_requests — RLS on, zero policies, explicit REVOKE anon/authenticated + GRANT service_role (20260710130000:115-125)
- vehicles — vehicles_public_read policy (SELECT USING true) in supabase_schema.sql; mileage overwrite goes through service_role client

**Migrations** (7)
- database/migrations/006_domain1.sql — legacy mechanic_work_orders/mechanic_parts shape: organization_id TEXT NOT NULL, customer_name NOT NULL, issue_description, status DEFAULT 'pending' (no CHECK)
- database/migrations/009_phase4_schema.sql — phase-4 shape the backend writes: tenant_id UUID FK tenants, vin FK vehicles, customer_id/mechanic_id FK users, status CHECK ('In Progress','Completed','Cancelled') DEFAULT 'In Progress', labor_cost/total_cost REAL
- database/migrations/20260808150000_mechanic_work_orders_convergence.sql — converges BOTH shapes onto an additive superset; drops legacy NOT NULLs on organization_id/customer_name; tenant indexes; Down is a deliberate no-op (roll forward only)
- database/migrations/supabase_schema.sql:103 — creates partsentry_logs with action_type CHECK and FK chain to vehicles/users; enables RLS
- database/migrations/20260603132036_marketplace_listing_summary_infra.sql:30-53 — adds verification_status/part_verification_status/suspicion_status/public_card_eligible to partsentry_logs with their CHECK constraints
- database/migrations/20260710130000_partsentry_review_requests.sql — creates the governed review-request ledger + one-pending-per-(log,type) unique index + service-role-only RLS
- database/migrations/20260809110000_api_role_write_hardening.sql — RLS/grant hardening for mechanic_work_orders, mechanic_parts, vehicle_ownership_history

**Tests** (9)
- backend/tests/partsentry-write-truth.test.js — locks: insert error checked BEFORE odometer mutation/blockchain event; happy-path returns id + side effects; tenant stamped on log (garage) and null (owner); server.js must pass tenantId to addRepairLog; PATCH tenant-scoped in the UPDATE itself; only DB CHECK statuses; create persists customer_name + authenticated mechanic identity; mileage-rollback rejection
- backend/tests/partsentry-review-workflow.test.js — locks the full review lifecycle against a mock client: create/approve/reject/revoke/flag/clear, payload validation, suspicion gating
- backend/tests/issue164-phase8-service-timeline-privacy.test.js — locks the trustGraphService work-order select to NEVER fetch description/issue_description/customer_name/customer_id, MUST fetch status/total_cost; public sanitizer fixes description for workorder: events ONLY (PartSentry keeps its own)
- backend/tests/issue164-phase1-read-contract.test.js:230 — locks GET /api/partsentry/:vin response = repair history via getRepairHistory, never the vehicle row
- backend/tests/issue164-phase7-golden-vehicles.test.js — golden dataset builds through injected addRepairLog (odometer >= 78450 contract)
- web/src/pages/dashboard/mechanic/WorkOrders.test.tsx — locks: PATCH with DB-legal 'Completed'/'Cancelled', optional total_cost, negative-cost client rejection, honest failure rollback, NO actions on terminal rows (client-side terminality), Phase-4 description column rendering, cancelled filter
- web/src/pages/dashboard/mechanic/ServiceLogs.test.tsx — locks: exactly the DB CHECK action_type options, honest empty state (no mock logs), success keyed off returned id, no hardcoded mechanic id
- backend/tests/run-tests.js:137-151 — legacy integration pass through addRepairLog/getRepairHistory
- backend/tests/diaspora-trade-os-parts-flow.test.js — a SEPARATE 'parts' universe: diaspora buyer orders with order_type='parts' (naming overlap only, different tables)

**Contract gaps** (11)
- No service_case concept anywhere: no table, service, route, or migration mentions service_case/service_record/garage_directory/service_link
- mechanic_work_orders has no service_case_id, no branch_id, no completed_at/cancelled_at (only created_at/updated_at + status), no cancellation reason, no structured service_category, no currency on labor_cost/total_cost — every 6.3 reconciliation column is missing
- No mechanic assignment model: mechanic_id is stamped from the creator at insert (workOrdersRoutes.js POST) and NO API path can ever reassign it — PATCH accepts only status/total_cost; 6.4's assignment history table does not exist
- Work-order lifecycle has only 3 DB-legal states ('In Progress','Completed','Cancelled') and no requested/accepted phase; the legacy 'pending' default (006 shape) is unreachable through the API
- No governed mileage observation record: the mechanic-entered odometer exists only as partsentry_logs.mileage plus a direct vehicles.mileage overwrite; vehicleFactResolver does NOT cover mileage, so the 13.1 question (canonical fact vs source observation) is answered 'direct canonical mutation' today
- No linkage partsentry_logs ↔ work order (no work_order_id column) and no work_order ↔ parts-used join (mechanic_parts is standalone inventory) — the plan-13 chain Service Case → work order → part record → PartSentry has no middle links
- No completion/cancellation server timestamps means plan 7.6's 'authoritative server timestamp' for completion cannot be satisfied without additive columns
- No service lifecycle events reach eventBus/Communications/notifications from any work-order or PartSentry write (plan sections 8 and 15.4 are all net-new)
- Server does not enforce terminal-state immutability: PATCH will happily move 'Completed' back to 'In Progress' (only the UI hides actions on terminal rows) — conflicts with plan 7.6 'must remain historical'
- No garage identity/publication projection: garages are tenants; no publication state, no public garage profile (marketplacePartsService returns a deliberately empty governed surface)
- customer_id is auto-resolved from vehicles.owner_id at create — there is no requester identity distinct from vehicle owner, which 6.1's requester_user_id requires

**Likely conflicts with Service Network** (9)
- Mileage authority (plan 13.1): partsentryService.js:51 directly overwrites vehicles.mileage after a monotonic >= guard; reachable by owners/dealers via POST /api/partsentry/add, not just mechanics. This exact behavior is pinned by partsentry-write-truth.test.js and goldenVehicleSpecs.js:108 — reconciling it to an observation-feeds-resolver model will break those contracts unless done deliberately
- State vocabulary collision: DB CHECK uses Title Case 'In Progress'/'Completed'/'Cancelled' while web/src/types WorkOrder.status and WorkOrders.tsx normalize to lowercase 'pending'/'in-progress'/'completed'/'cancelled' — the plan's Service Case states (requested/accepted/active/completed/declined/cancelled) overlap the lowercase set, so 'completed'/'cancelled' will be ambiguous between Case state and work-order state in shared UI code
- Terminal-state mutability: server permits Completed→In Progress via PATCH; plan 7.6/Invariant 12 requires completed/cancelled records to remain historical — S4's 'compatible status model' must add a transition guard without breaking WorkOrders.test.tsx optimistic-update expectations
- Provenance vocabulary drift: PR #194's passportServicePartsProjection.js freezes SERVICE_AUTHORITIES = {professional_governed, owner_declared, partner_record, unknown} — missing plan 6.6's garage_stated, mechanic_attributed, evidence_backed; if #194 merges first, Service Network's vocabulary must extend, not fork, that set
- Public services surface overlap: marketplacePartsService already owns unauthenticated /api/marketplace/parts and /api/marketplace/services — a Garage Directory must reconcile with Invariant 8 (Marketplace owns discovery intent) and reuse its suppression rules rather than adding a second public services endpoint
- 'parts' naming overlap: diaspora buyer orders use order_type='parts' (diaspora-trade-os-parts-flow.test.js) and mechanic_parts is garage stock — three distinct 'parts' meanings already exist before Service Network adds part records
- PR #194 adds three NEW mechanic_work_orders consumers (canonicalVehicleLifecycleService, serviceIntelligenceService, passportServicePartsProjection) with frozen column selects — S4 additive schema evolution must not rename/repurpose existing columns those selects read
- Timeline privacy contract: issue164-phase8 test locks the exact work-order select in trustGraphService — any S4 column additions consumed publicly must pass the same no-free-text/no-customer-identity gate
- customer semantics: work-order 'customer' is the vehicle's owner_id resolved at create; Service Case requester_user_id is a different principal — converging them naively would misattribute requesters on owner-transferred vehicles

**Must reuse (do not duplicate)** (14)
- mechanic_work_orders table itself — plan 6.3 forbids a second work-order table; evolve additively via a sibling migration in the 20260808150000 convergence style (database/migrations/20260808150000_mechanic_work_orders_convergence.sql)
- partsentryService.addRepairLog + its idempotency/signature/tenant-attribution — the part-record write authority (backend/services/partsentry/partsentryService.js); Service Records must link to it, not re-implement part logging
- PartSentry public projection rule (public_card_eligible AND fail-closed non-suspicious allowlist) — partsentryService.getRepairHistory + trustGovernance/partsentryReviewService NON_SUSPICIOUS lists; any public service history must apply the same gate
- partsentryReviewService governed review workflow + one-pending-per-(log,type) DB uniqueness — the template for any Service Network review/verification flow (backend/services/trustGovernance/partsentryReviewService.js)
- vehicleFactResolver injected-read, unknown-first fact pattern for the 13.1 mileage reconciliation (backend/services/evidence/vehicleFactResolver.js)
- trustGraphService timeline work-order emitter and server.js public sanitizer — the already-certified public projection of work orders (backend/services/trustGraph/trustGraphService.js:27-30)
- tenant scoping pattern: filter inside the UPDATE so cross-tenant rows read as 404 (backend/routes/workOrdersRoutes.js PATCH) — reuse for all Service Case writes
- authorizeRole middleware + req.userContext.tenantId (backend/middleware/authMiddleware.js usage in all three route files) — no new garage auth universe
- service-role-only RLS posture (RLS on, zero client policies, REVOKE anon/authenticated) from 20260809110000 and 20260710130000 for every new table
- evidence taxonomy classes odometer_reading/odometer (backend/services/evidence/evidenceTaxonomy.js:76,102) — plan 12's odometer-photo evidence class already exists; extend taxonomy, don't invent labels
- blockchainService.addEvent ledger for tamper-evident service records (backend/services/blockchain/blockchainService.js via partsentryService)
- ownerGarageCounts null-not-zero tally semantics (backend/server.js:563-590) — Invariant 10 already implemented for service/part counts; owner surfaces must keep it
- marketplacePartsService governance invariants (no fabricated verification labels, suspicion suppression) for any Garage Directory card (backend/services/marketplace/marketplacePartsService.js)
- migration marker contract '-- +migrate Up' + migration-integrity test run (per repo memory) for every new migration

**PR #194 delta** (14)
- backend/services/partsentry/partsentryService.js (M) — addRepairLog now rejects non-finite/negative mileage BEFORE any write (previously NaN sailed past the `mileage < vehicle.mileage` guard and could reset an odometer); blank description/part_oem stored as null instead of caller-fabricated strings
- backend/services/passport/passportServicePartsProjection.js (A) — projects mechanic_work_orders rows + partsentry logs into audience-gated Passport service records; freezes SERVICE_AUTHORITIES = professional_governed/owner_declared/partner_record/unknown and SAFE_PARTSENTRY_SUSPICION = ('','none','cleared')
- backend/services/passport/passportReadModelService.js + passportSurfaceConvergence.js + README.md (A) — Passport V8 composition layer consuming the projection; declares it does not mutate vehicles/evidence or calculate Trust
- backend/services/report/canonicalVehicleLifecycleService.js (A) — lifecycle timeline reads mechanic_work_orders (privileged audiences only: id, created_at, status), maps them to category 'service' with sourceKind 'mechanic_work_order'; PartSentry rows publish summary-only unless public_card_eligible + non-suspicious
- backend/services/intelligence/serviceIntelligenceService.js (A) — I9 mechanic/garage metrics over mechanic_work_orders (work_orders/completed/open counts, repeat customers) scoped by mechanic_id (PERSON) or tenant_id (GARAGE)
- backend/services/intelligence/partsIntelligenceService.js (A) — I12: documents that parts compatibility/supplier intelligence is structurally unmeasurable (no parts catalogue, no fitment table, no supplier registry; mechanic_parts.supplier is free text); serves RFQ funnel + PartSentry provenance + own inventory only
- backend/services/marketplace/marketplacePartsService.js (M) — adds normalizePartFitmentEntry / PART_FITMENT_TAXONOMY_VERSION: lister-supplied fitment CLAIMS, explicitly never PartSentry verification and never Trust
- backend/tests/partsentry-write-truth.test.js (M) — adds blockchain custody RPC stubs (custodyGeneration, activation boundary) so addRepairLog's ledger side effect runs under the new custody contract; work-order route assertions unchanged
- backend/tests/passport-v8-service-parts.test.js, intelligence-parts.test.js, intelligence-service-mechanic-garage.test.js, marketplace-lifecycle-missing-mileage.test.js (A) — new contract suites over the above
- web/src/pages/dashboard/mechanic/PartsTracking.tsx (M) + PartsTracking.test.tsx (A) — outage no longer renders as an empty shelf; no invented 'Internal' supplier or default reorder threshold of 5
- web/src/pages/dashboard/mechanic/MechanicDashboard.tsx (M) — embeds ServiceIntelligence scope='mechanic' (person-scoped work metrics)
- web/src/pages/dashboard/owner/PartSentry.tsx (M) — stops fabricating 'Service performed' description, 'UNKNOWN' OEM, and 0 mileage on blank fields (the 0 previously overwrote the vehicle odometer server-side)
- web/src/components/intelligence/PartsIntelligence.tsx/.test.tsx (A) — parts intelligence surface
- NOT touched by #194: workOrdersRoutes.js, partsRoutes.js, partsentryReviewRoutes.js, partsentryReviewService.js, all mechanic_work_orders migrations, WorkOrders.tsx, ServiceLogs.tsx — the work-order authority itself is unchanged; #194 only adds READ consumers

**Notes:** Workspace inspected read-only at /Users/shadreckmusarurwa/Project AI/carup-service-network (all relative paths above are under this root). Summary for S4/S5 planning: the work-order authority is tiny (91-line route file, no service module, 3 Title-Case states, service-role-only RLS) and is consumed today by trustGraphService (public timeline, privacy-locked select), server.js owner service-history + ownerGarageCounts, and the mechanic web surfaces; PR #194 adds three further read-only consumers plus a mileage-validation hardening inside addRepairLog. The single most consequential 13.1 fact: vehicles.mileage has exactly one writer — partsentryService.addRepairLog — which overwrites the canonical odometer under a monotonic guard, is reachable by owners/dealers, and is contract-pinned by tests and the Golden fixture; mileage is absent from vehicleFactResolver, so today the mechanic-entered odometer IS the canonical fact with no observation/provenance layer. check-mileage.js is a dev scratch query, not an authority.

### Domain: trust

**Files** (29)
- backend/services/trustDecision/canonicalTrustService.js — THE canonical trust authority (ADR-001, Issue #164 Phase 3); 971 lines; single read path + single writer of vehicles.trust_score
- backend/services/trustDecision/trustDecisionService.js — pure versioned decision engine (CALCULATION_VERSION='trust-decision-1.0.0'); dimensions: identity, completeness, source coverage, conflicts, fraud, compliance, eligibility
- backend/services/trustGraph/trustGraphService.js — DEPRECATED 70-baseline engine; adds +5 when partsentry_logs count>=3 (literal service-activity→trust); calculateVehicleTrustScore at :473 writes trust_score WITHOUT clearing stamp columns
- backend/services/trust-service/trustEnforcementEngine.js — penalty writes over assumed 80.0 baseline; clears stamps via UNSTAMPED_TRUST_CACHE in same update (:100, :185)
- backend/services/trust-service/trustService.js — legacy trust helper; inserts trust_score_history
- backend/services/trustGovernance/trustFactWorkflowService.js — governed trust-fact request/approve/reject/revoke workflow; patches vehicles fact columns + trust_audit_events
- backend/services/trustGovernance/trustPermissionService.js — canSetTrustFact policy; fact allow-lists incl PARTSENTRY_PUBLIC_CARD_FACTS, GOVERNMENT_APPROVAL_FACTS
- backend/services/document-intelligence/documentIntelligenceService.js — foreign trust_score writer (+20 on OCR approval, :400-410); clears stamps in same update
- backend/services/evidence/vehicleFactResolver.js — Phase 2 fact resolver; provenance/evidence_basis input to canonical record, deliberately NOT a scoring input
- backend/services/evidence/completenessEvaluator.js — completeness dimension input to decision engine
- backend/routes/trustDecisionRoutes.js — trust decision HTTP surface (cache-only canonical projection + stripped decision)
- backend/routes/trustFactRoutes.js — trust fact governance HTTP surface
- backend/routes/vehiclesRoutes.js — evidence verify/reject handlers (:819, :914) are the ONLY production HTTP reach to refreshCanonicalTrust
- backend/routes/escrowTrustRoutes.js — Marketplace transaction lifecycle routes; 'trust' in name only
- backend/services/escrow/escrowTrustService.js — Issue #164 Phase 6 Marketplace transaction lifecycle, NOT the Trust authority
- backend/services/marketplace/listingSummaryService.js — list surface trust via getCanonicalTrustBatch→toPublicTrust, cache-only (:71-73)
- backend/services/marketplace/marketplaceTrustSummaryService.js — detail-page trust summary carrying exact toPublicTrust 10-field shape
- backend/utils/publicVehicleProjection.js — strips raw vehicles.trust_score from public projections (:181-183); documents DEFAULT 80.0 hazard (:150)
- backend/services/eventBus/eventBusService.js — domain_events outbox; emitDomainEvent + dedupe-key machinery
- backend/server.js — public vehicle surfaces read via getCanonicalTrust/Batch + toPublicTrust (:496-518, :813); listing creation inserts explicit trust_score:null (:2352 area)
- backend/scripts/production-refresh-canonical-trust-uatprd.mjs — pinned prod refresh runner; TARGET_VIN='UATPRD17830287622' module constant, NONTARGET_ROWS=351 byte-identical assertion
- backend/scripts/issue164-refresh-canonical-trust.mjs — staging canonical trust refresh runner
- backend/scripts/production-apply-issue164-trust-provenance.mjs — prod stamp-columns migration applier
- web/src/pages/TrustSafety.tsx — public trust wording page (rewritten in PR #194 to remove fabricated claims)
- web/src/components/marketplace/TrustSummaryPanel.tsx — trust rendering component
- web/src/pages/dashboard/shared/TrustReviewQueue.tsx — trust fact review queue UI
- web/src/pages/dashboard/admin/ReferralTrustReview.tsx — referral trust review UI (separate referral programme)
- docs/canonical-vehicle-truth/ADR-001-trust-authority.md — the trust authority ADR
- backend/services/referral/referralTrustReviewService.js — referral-programme trust review (person/referral scope, not vehicle trust)

**Tables** (16)
- vehicles.trust_score — materialized CACHE of decision.overall_trust.value, never an authority; column-level DEFAULT 80.0 is a legacy hazard (new inserts must set explicit null)
- vehicles trust stamp columns — trust_calculation_version, trust_evaluated_at, trust_band, trust_confidence, trust_known_limitations, trust_evidence_basis; added by 20260817140000; NULL version = demoted to not_evaluated (load-bearing, no backfill)
- vehicles.trust_presentation_announced_fingerprint — PR #194 R5-D1 durable announce marker (20260826120000_email_1_0_hardening.sql); absent in prod per runbook
- trust_fact_requests — governed fact change requests; vin, trust_fact, requested/current value, status, requester+reviewer role/tenant, evidence_ids, partsentry_log_ids (20260604002000)
- trust_audit_events — immutable trust governance audit trail (20260603233640)
- trust_score_history — score change log; legacy prod shape REAL NOT NULL previous/new_score, TEXT timestamp (20260809100000 + 20260810120000 convergence)
- rolling_integrity_checkpoints — vin PK, last_verified_event_id, rolling_hash (20260809100000)
- trust_change_log — immutability-hardened change log (20260624150000)
- mechanic_work_orders — existing work-order table; tenant_id, mechanic_id, customer_id, labor_cost, total_cost added by 20260808150000; read by trustGraphService graph read-model, NOT by canonical decision engine
- mechanic_parts — parts inventory, tenant_id + min_stock + supplier (20260808150000)
- partsentry_logs — PartSentry service ledger; counted (>=3 → +5) ONLY by the deprecated trustGraph engine
- vehicle_evidence — evidence rows with trust_score_impact/trust_impact columns consumed by deprecated engine; RLS-hardened
- domain_events — outbox transport for domain events; dedupe key per event type
- escrow_trust_sessions / escrow_trust_events / escrow_trust_webhook_events — Marketplace escrow lifecycle (20260626180000); 'trust' naming only
- verification_sessions — evidence_classification, ocr_execution_status, extraction_trust_status etc (20260618050000)
- zimra_declarations / cid_clearance_records / cvr_ownership_records / vid_inspections / stolen_vehicles — registry inputs read by the deprecated trustGraph engine only

**Services** (13)
- canonicalTrustService — sole legitimate trust source; exports getCanonicalTrust, getCanonicalTrustBatch (cache-only by construction), toPublicTrust (closed 10-field contract), refreshCanonicalTrust (THE one writer, INV-TRUST-2), buildCachePatch (refuses non-canonical), canonicalFromCache/classifyCache, publicTrustViolations, CALCULATION_VERSION, TRUST_EVALUATION_STATES/BANDS/CONFIDENCE/SOURCES
- trustDecisionService — getTrustDecision(vin), assembleDecision (pure, replayable INV-TRUST-4), toPublicDecision (strips private dimensions); score is transparent function of dimensions, AI advisory only
- trustFactWorkflowService — createTrustFactRequest, approveTrustFactRequest, rejectTrustFactRequest, revokeTrustFactRequest, listTrustFactReviewQueue, getTrustFactAuditTrail; PHASE_2A_TRUST_FACTS = vehicle_condition_category/passport_verified/inspection_ready
- trustPermissionService — canSetTrustFact(actor, fact, action, context); allow-lists: SOURCE_TRUST_FACTS (15 facts), GOVERNMENT_APPROVAL_FACTS, PARTSENTRY_PUBLIC_CARD_FACTS, FINANCE_FACTS, SUMMARY_FACTS — NO garage/service facts exist
- trustGraphService — deprecated calculateVehicleTrustScore/computeVehicleTrustScoreContext (70-baseline, registry bonuses, partsentry service-count bonus, evidence trust_score_impact sum); live caller only backend/tests/run-tests.js; still writes UNCLEARED stamp
- trustEnforcementEngine — mismatch penalties + marketplace quarantine (<60 suspends); writes trust_score with UNSTAMPED_TRUST_CACHE cleared stamps
- documentIntelligenceService — OCR approval +20 writer; clears stamps in same update
- vehicleFactResolver (evidence/) — resolveVehicleFacts: provenance disclosure, cannot move the score
- marketplaceTrustSummaryService / listingSummaryService — read-only projections of the canonical contract
- trustPresentationChangeProducer (PR #194, new) — emitTrustPresentationChange, reconcileTrustPresentation, trustPresentationFingerprint, materialTrustChanges, resolveCurrentVehicleOwner; fingerprint-idempotent, owner-only recipient, never a second writer
- passportTrustLens (PR #194, new) — buildPassportTrustLens, assertCanonicalTrustProjection; validate-and-relay only, never derives band/score
- escrowTrustService — Marketplace transaction lifecycle guard (naming overlap only)
- referralTrustReviewService — referral-programme reviewer trust, separate universe

**APIs** (9)
- GET /api/vehicles/:vin/trust-decision — trustDecisionRoutes.js, authorizeRole() (any authenticated); returns toPublicTrust(cache-only canonical, RECOMPUTE.NEVER) + role-stripped decision
- GET /api/vehicles/:vin/trust-decision/full — trustDecisionRoutes.js, authorizeRole(['admin','government','reviewer'])
- POST /api/verification/trust-facts/:vin/requests — trustFactRoutes.js, authorizeRole(['owner','dealer','admin','government'])
- GET /api/verification/review-queue — trustFactRoutes.js, authorizeRole(['admin','government'])
- PATCH /api/verification/trust-facts/:requestId/approve — trustFactRoutes.js, authorizeRole(['admin','government'])
- PATCH /api/verification/trust-facts/:requestId/reject — trustFactRoutes.js, authorizeRole(['admin','government'])
- PATCH /api/verification/trust-facts/:requestId/revoke — trustFactRoutes.js, authorizeRole(['admin','government'])
- GET /api/verification/audit-trail/:vin — trustFactRoutes.js, authorizeRole(['owner','dealer','admin','government'])
- evidence verify + reject handlers — vehiclesRoutes.js (:819, :914), admin/government; the ONLY production call sites of refreshCanonicalTrust (best-effort, review is durable fact, cache re-materializable)

**Events** (5)
- vehicle.trust.presentation_changed — PR #194 only; emitter trustPresentationChangeProducer (literal string at diff :22587) right after refreshCanonicalTrust's write; consumers communicationEventListeners.js → communicationNotificationService.js → R5 owner email (referenceVehicleTrustUpdate.js); transport domain_events outbox, dedupe key presentation_fingerprint (eventBusService map + DB trigger in 20260826120000)
- DOCUMENT_VERIFICATION_APPROVED — dispatchAutomationWebhook from documentIntelligenceService after OCR approval trust write
- trust_score_history inserts — trustGraphService/trustService/enforcementEngine/documentIntelligence record score transitions as rows, not bus events
- trust_audit_events inserts — trustFactWorkflowService via logAuditEvent; audit ledger, not a bus event
- on main there is NO trust change event at all — canonicalTrustService header/PR194 producer records this as R5_PRODUCER_GAP ('refreshCanonicalTrust... told nobody')

**RLS/policies** (4)
- trust_fact_requests — RLS ENABLED (20260604002000)
- trust_audit_events — RLS ENABLED (20260603233640)
- trust_score_history + rolling_integrity_checkpoints — RLS ENABLED (20260809100000)
- 20260624120000_vehicle_trust_security_hardening.sql — enables RLS + policies across the trust evidence universe: vehicle_evidence ('uploader or admin read'), vehicle_plate_history ('admin read'), evidence sets ('owner or admin read'), provenance ('admin or reviewer read'), ai_analysis_jobs/ai_observations, temporal_findings, disclosure_claims/conflicts, report_versions ('public share'/'owner read'/'admin read'), review_tasks/review_decisions ('admin or reviewer read'), disputes ('raiser read'), dispute_events, trust_change_log ('admin or reviewer read'); plus fallback 'authenticated read' policies for several tables

**Migrations** (11)
- database/migrations/20260603233640_governance_foundation_trust_audit_events.sql — trust_audit_events + RLS
- database/migrations/20260604002000_trust_fact_requests_phase2a.sql — trust_fact_requests + RLS
- database/migrations/20260618050000_verification_evidence_trust_columns.sql — verification_sessions evidence/trust status columns
- database/migrations/20260624120000_vehicle_trust_security_hardening.sql — RLS across trust evidence tables
- database/migrations/20260624150000_trust_change_log_immutability.sql — trust_change_log immutability
- database/migrations/20260626180000_escrow_trust_sessions.sql — escrow lifecycle tables (naming overlap only)
- database/migrations/20260808150000_mechanic_work_orders_convergence.sql — mechanic_work_orders/mechanic_parts tenant + cost columns (Service Network's likely substrate, plan 6.3)
- database/migrations/20260809100000_trust_side_tables.sql — trust_score_history, rolling_integrity_checkpoints + RLS
- database/migrations/20260810120000_trust_side_convergence.sql — converges legacy prod trust_score_history shape (proof-tested against run 31360753528 shape)
- database/migrations/20260817140000_issue164_trust_cache_provenance.sql — adds the six trust stamp columns to vehicles; NULL version deliberately demotes entire legacy population; partial index on trust_calculation_version
- PR #194: database/migrations/20260826120000_email_1_0_hardening.sql — R5-D1 adds vehicles.trust_presentation_announced_fingerprint + partial index + domain_events dedupe trigger branch for vehicle.trust.presentation_changed

**Tests** (17)
- backend/tests/issue164-phase3-trust-authority.test.js — THE permanent guard suite: closed public shape, replay reproducibility (INV-TRUST-4), zero evidence scores 0/insufficient_evidence not verified (INV-TRUST-3), stale/unversioned never published, batch==single (INV-TRUST-1), one stamping writer (INV-TRUST-2), fact resolver is provenance-not-score
- backend/tests/trust-decision.test.js — decision engine dimensions/score function
- backend/tests/trust-decision-integration.test.js — decision over real fetch path
- backend/tests/trust-fact-workflow.test.js — governed fact request/approve/reject/revoke lifecycle
- backend/tests/trust-governance.test.js — canSetTrustFact permission matrix
- backend/tests/trust-side-convergence.test.js — proof battery for trust_score_history/rolling_integrity_checkpoints legacy-shape migration
- backend/tests/issue164-canonical-trust-refresh-runner.test.js — locks the pinned single-VIN prod refresh runner
- backend/tests/issue164-trust-cutover-runner.test.js — locks the trust cutover runner
- backend/tests/trust-network-journey.test.js — end-to-end trust journey
- backend/tests/escrow-trust.test.js — escrow lifecycle (not Trust authority)
- backend/tests/referral-trust-review-phase7(.hardening).test.js — referral trust review
- web/src/pages/VehicleDetail.trust.test.tsx — vehicle detail renders canonical contract
- web/src/pages/dashboard/owner/OwnerDashboard.trust.test.tsx — owner dashboard trust rendering (modified by PR #194)
- web/e2e/trust-review-queue.spec.ts — review queue e2e
- PR #194: backend/tests/passport-v5-trust-lens.test.js — lens validates/relays, never derives
- PR #194: backend/tests/email-hardening-c3-trust-event-idempotency.test.js — event DB-idempotent on fingerprint
- PR #194: backend/tests/email-reference-r5-vehicle-trust-update.test.js — R5 email + pins TRUST_PRESENTATION_CHANGED_EVENT literal

**Contract gaps** (6)
- No approved Trust input contract exists for service activity: plan 14.2 says Service Network may only invoke the canonical workflow 'under an already-approved Trust input contract' — none is defined; the decision engine's dimensions (identity/completeness/coverage/conflicts/fraud/eligibility) read nothing from mechanic_work_orders or service records
- No garage/mechanic trust facts: trustPermissionService's SOURCE_TRUST_FACTS has no garage_identity_verified, mechanic_affiliation_confirmed, or any service-dimension fact — 14.3 dimensional wording ('Garage identity verified', 'Mechanic affiliation confirmed') has no governed backing fact today
- Plan 14.1 claim-state vocabulary ('garage stated', 'mechanic attributed', 'evidence backed', 'disputed', 'superseded') exists nowhere as a shared enum; nearest artifacts are PR #194 passportServicePartsProjection's SERVICE_AUTHORITIES ('professional_governed','owner_declared','partner_record','unknown') and trust_fact_requests.status ('superseded' used at trustFactWorkflowService:463)
- No general trust refresh job: the batch read is cache-only and the doc says 'the refresh job is what fills it', but the only production refresh is pinned to one VIN (UATPRD17830287622); 351 legacy rows deliberately unstamped — a Garage Directory listing vehicles will show not_evaluated for nearly all prod vehicles by design
- Trust is exclusively VIN-keyed: no trust/verification model for a garage or mechanic as a principal (reputationService is user reputation, separate); Garage 'identity verified' state needs a new governed home, not the vehicle trust cache
- No Service Case → Communications trust wording surface; TrustSafety.tsx (post-PR194) intentionally documents that no inspection network or certified-garage programme exists

**Likely conflicts with Service Network** (7)
- Invariant 4 hazard, exact location: trustGraphService.computeVehicleTrustScoreContext (~:377) already implements 'serviceCount >= 3 → baseScore += 5.0' from partsentry_logs — the precise service-activity-as-trust pattern the plan bans; it is deprecated (only backend/tests/run-tests.js calls it) but a Service Case completion handler copying or resurrecting it would violate Invariant 4 through an existing, importable function
- Sharpest wrong-wiring: trustGraphService.calculateVehicleTrustScore:473 updates vehicles.trust_score WITHOUT clearing the six stamp columns — after a legitimate refresh, such a write inherits the stamped calculation_version and PUBLISHES AS CANONICAL (documented as 'uncleared stamp' in canonicalTrustService header); any naive service-completion trust write via bare update({trust_score}) has the same effect — the unversioned-row guard only works when stamps are nulled in the SAME update (UNSTAMPED_TRUST_CACHE pattern)
- PR #194 side effect: refreshCanonicalTrust now emails the owner on material presentation change — wiring refresh into service completion (even harmlessly for the score) would generate owner trust emails per service event; opts.announce exists but disabling it silently defers announcements
- vehicles.trust_score column DEFAULT 80.0 — any Service Network path inserting vehicle rows (garage customer intake) must insert explicit trust_score: null like server.js listing creation, or it fabricates a score
- Naming overlap: escrowTrustService/escrow_trust_sessions/escrowTrustRoutes are Marketplace transaction lifecycle, not Trust — 'Service Network trust' naming must not blur further; also referralTrustReview* is yet another 'trust' universe
- Wording (14.3): web/src/data/mockData.ts:667 'Certified mechanics for all major brands' in mock garage data — reusing mock garage content in a Garage Directory violates 14.3; PR #194's TrustSafety.tsx rewrite deliberately deleted 'certified partner garages'/'master mechanics'/150-point-inspection claims — Foundation 1.0 must not reintroduce them
- trust_presentation_announced_fingerprint sits on vehicles (PR #194): new service-related vehicle-row writers must not clobber it; and any Service Network announce machinery should reuse this fingerprint/marker pattern rather than invent a parallel one

**Must reuse (do not duplicate)** (12)
- canonicalTrustService.getCanonicalTrust / getCanonicalTrustBatch / toPublicTrust (backend/services/trustDecision/canonicalTrustService.js) — the ONLY way any garage/service surface may display vehicle trust; batch is cache-only by construction for directory lists
- refreshCanonicalTrust (same file) — the only writer if a governed service fact is ever approved as a Trust input; never write vehicles.trust_score or its stamps directly
- trustFactWorkflowService + trustPermissionService (backend/services/trustGovernance/) — the governed request→review→approve→audit pipeline for ANY new fact class (e.g. a future garage-identity fact); extend canSetTrustFact allow-lists, do not bypass
- publicVehicleProjection (backend/utils/publicVehicleProjection.js) — strips raw trust_score; every public vehicle payload from Service Network must pass through it
- trustDecisionRoutes GET /api/vehicles/:vin/trust-decision — existing buyer-safe trust endpoint; reuse instead of a new trust read route
- passportServicePartsProjection.js (PR #194) — SERVICE_AUTHORITIES vocabulary ('professional_governed','owner_declared','partner_record','unknown') + projectWorkOrderServiceRecord; the plan §6.6 provenance vocabulary and Invariant 9 passport convergence must build on this, not a parallel projection
- passportTrustLens.js (PR #194) — validated trust presentation for passport surfaces; garage-facing passport views relay through it
- emitDomainEvent / domain_events outbox (backend/services/eventBus/eventBusService.js) — the transport for Service Event Contract (plan §8), with per-event dedupe keys
- trustPresentationChangeProducer (PR #194) — fingerprint-idempotency + durable-marker + terminal-vs-transient pattern to copy for service notifications; also the proof that announcing ≠ writing
- UNSTAMPED_TRUST_CACHE pattern (trustEnforcementEngine.js:19, documentIntelligenceService.js:19) — the mandatory stamp-clearing contract for any legacy-style writer (but prefer adding no writers at all)
- mechanic_work_orders table (20260808150000) — plan §6.3 says existing work orders are the substrate; Service Case must reference, not duplicate
- trust_audit_events via logAuditEvent (backend/services/auditLogger.js) — audit trail for any trust-adjacent governance action

**PR #194 delta** (11)
- backend/services/trustDecision/canonicalTrustService.js M — refreshCanonicalTrust gains post-write R5 announcement: reads previous canonical position BEFORE the write, emits via trustPresentationChangeProducer after, swallows announce failures, returns presentation verdict; opts.announce/previousRecord/tenantId added; still the one writer
- backend/services/trustDecision/trustPresentationChangeProducer.js A — new producer for vehicle.trust.presentation_changed: sha256 fingerprint of material public fields (excludes evaluated_at/vin), durable marker column is the authority, unknown-is-not-permission fail-closed, owner-only recipient via vehicles.owner_id resolved internally, reconcileTrustPresentation recovery path, TRUST_MARKER_STATES recorded/pending
- backend/services/passport/passportTrustLens.js A — passport presentation lens; hard-asserts the canonical 10-field contract, withholds score/band unless evaluated, never derives
- backend/services/passport/passportServicePartsProjection.js A — projects mechanic work orders into passport service records with SERVICE_AUTHORITIES provenance vocabulary and audience gating
- database/migrations/20260826120000_email_1_0_hardening.sql A — ADD vehicles.trust_presentation_announced_fingerprint + partial index; domain_events trigger computes dedupe key from presentation_fingerprint for the trust event (DB-level idempotency)
- backend/services/communication/emailExperience/referenceVehicleTrustUpdate.js A — R5 vehicle-trust-update owner email (evaluated/not_evaluated/stale/unavailable variants, previews in docs/communications/email-previews/)
- backend/services/communication/communicationEventListeners.js M + communicationNotificationService.js M — register and consume vehicle.trust.presentation_changed into the notification pipeline
- backend/services/eventBus/eventBusService.js M — dedupe-key mapping 'vehicle.trust.presentation_changed': ['presentation_fingerprint']
- web/src/pages/TrustSafety.tsx M — replaces fabricated verification story (CVR/ZINARA sync, 150-point inspection at 'certified partner garages', ECU tooling, crypto certificate) with truthful who-did-what stages; states provider_registry is empty and no inspection network exists
- backend/tests/email-hardening-c3-trust-event-idempotency.test.js A, email-reference-r5-vehicle-trust-update.test.js A (pins event literal == exported constant), passport-v5-trust-lens.test.js A; web/src/pages/dashboard/owner/OwnerDashboard.trust.test.tsx M
- docs/communications/EMAIL_1_0_MIGRATION_RUNBOOK.md A — records trust_presentation_announced_fingerprint ABSENT in prod, ADD COLUMN required before the announce path is live

**Notes:** WHERE 'service completed → trust up' would be wired WRONGLY, precisely: (1) resurrecting/importing trustGraphService.calculateVehicleTrustScore from a Service Case completion handler — it already contains the banned pattern (partsentry_logs>=3 → +5) AND writes vehicles.trust_score without clearing the six stamp columns, so its output inherits the previous refresh's calculation_version and publishes as canonical (the classifyCache unversioned-row guard is defeated whenever stamps are not nulled in the SAME update); (2) any direct update({trust_score}) from a service route — same stamp-inheritance defect; (3) adding a service fact to trustFactWorkflowService/trustPermissionService allow-lists without a governance review — approve() patches vehicles columns directly; (4) calling refreshCanonicalTrust on completion is score-safe (the decision engine reads no service records) but post-PR194 emails the owner per material change. GUARDS THAT EXIST: version-stamped cache with stale/unversioned withholding; buildCachePatch refusing non-canonical records; batch path structurally unable to recompute; refreshCanonicalTrust reachable in HTTP only from admin/government evidence review; publicVehicleProjection stripping raw trust_score; guard suite issue164-phase3-trust-authority.test.js locking all invariants; foreign writers clearing stamps via UNSTAMPED_TRUST_CACHE. Prod stamping state confirmed in-code: production-refresh-canonical-trust-uatprd.mjs pins TARGET_VIN UATPRD17830287622 as a module constant and asserts the other 351 rows stay byte-identical.

### Domain: intelligence

**Files** (26)
- [main] backend/routes/intelligenceRoutes.js — Milestone 3 visual/disclosure intelligence: 5 endpoints, public output strictly allowlisted (confirmed + public_summary only); mounted app.use(intelligenceRouter) at backend/server.js:327
- [main] backend/services/intelligence/disclosureConflict.js — seller claim extraction (regex CLAIM_RULES) + conflict classification; never auto-publishes, defaults reviewer_state pending_review
- [main] backend/services/intelligence/temporalComparison.js — per-component temporal change findings; SAME_VEHICLE_MIN=0.75 gate; cautious public summaries
- [main] backend/tests/intelligence-routes.test.js — locks public allowlist (non-privileged never see pending findings/raw model output)
- [main] backend/services/document-intelligence/documentIntelligenceRouter.js — separate 'document intelligence' namespace at /api/verification (server.js:292); unrelated to I0–I19 but shares the word
- [main] backend/services/eventBus/{eventBusService,listeners,eventWorker}.js — existing event/outbox infra; zero intelligence references
- [#194] backend/routes/intelligenceActivityRoutes.js — client activity batch ingestion + admin ingestion health
- [#194] backend/routes/intelligenceProjectionRoutes.js — ~20 role-scoped analytics/projection endpoints (I5/I7–I19)
- [#194] backend/routes/intelligenceRollupRoutes.js — I4 rollup execution endpoint (worker secret or proven admin) + freshness status
- [#194] backend/services/intelligence/activityEventTypes.js — canonical taxonomy schema_version 1: EVENT_VERSIONS, RESERVED_EVENT_TYPES, PRIVACY_CLASS, METADATA_ALLOWLIST/ENUMS/FORMATS, EXCLUSION_FLAGS, SELLER_FACING_EXCLUDED_FLAGS
- [#194] backend/services/intelligence/activityLedgerService.js — ingestion core: server-derived identity/scope (client values DROPPED and counted), clientIdempotencyKey, bot UA heuristic, 24h late-event clamp, computeExclusionFlags (self-traffic via resolveObjectScope), insertEvents, recordServerEvent, recordIngestionStats
- [#194] backend/services/intelligence/marketplaceActivityEmitters.js — every server-emitted marketplace observation; best-effort, never throws, never blocks domain write
- [#194] backend/services/intelligence/rollupService.js — reproducible UTC-day rollups (ROLLUP_CALCULATION_VERSION 'rollup@1'), upsert onConflict metric_date+id+calculation_version, run ledger intelligence_rollup_runs
- [#194] backend/services/intelligence/intelligenceProjectionService.js — availability envelope (metric/unavailable/rate), privacy floors MIN_CONVERSION_DENOMINATOR=20 / MIN_BENCHMARK_COHORT=8, resolveOwnedListings/assertListingOwnership/requireVerifiedTenant/requirePlatformAdmin; identity never leaves aggregates
- [#194] backend/services/intelligence/serviceIntelligenceService.js — I9 mechanic-person vs garage-tenant projections + frozen NOT_MEASURABLE registry; reads mechanic_work_orders, marketplace_inquiries (garage/mechanic_service_request), partsentry_logs, vehicles
- [#194] backend/services/intelligence/recommendationService.js — I17 next-best-action rules, ABSTAIN-first, evidenceFingerprint suppression via intelligence_recommendation_state
- [#194] backend/services/intelligence/aiIntelligenceContextService.js — I18 closed fact-set AI context (unmeasured facts stay present AS unmeasured) + validateAnswer() rejecting numbers not in context
- [#194] backend/services/intelligence/reportService.js — I19 weekly/monthly seller report + CSV export preserving unavailability semantics
- [#194] backend/services/intelligence/kpiCatalogue.js — I16 KPI catalogue (kpi_catalogue@1) served unauthenticated
- [#194] backend/services/intelligence/listingCompletenessService.js — I6 listing completeness scoring feeding recommendations
- [#194] backend/services/intelligence/commandCentreService.js — I16 admin command centre aggregation
- [#194] backend/services/intelligence/{financeIntelligenceService,insuranceIntelligenceService,governmentIntelligenceService,partsIntelligenceService,tradeIntelligenceService,referralIntelligenceService}.js — I10–I15 persona projections
- [#194] backend/services/referral/referralEngineService.js — adds buildVerifiedActorContext (G1/G4 forgery closure); main has only spoofable buildActorContext (line 57)
- [#194] backend/routes/referralRoutes.js — switched to buildVerifiedActorContext on validate/attribution paths
- [#194] web/src/components/intelligence/* (16 components + tests), web/src/lib/intelligenceActivity.ts + intelligenceDisplay.ts, web/src/components/marketplace/VehicleIntelligenceStory.tsx — entire web intelligence surface; ABSENT on main (verified)
- [#194] docs/intelligence/receipts/I0–I19 + SECURITY_CLOSURE_G1_G2_G3.md + manuals/* — programme receipts incl. I9_MECHANIC_GARAGE_PROJECTION_MODEL.md and I1 canonical metric/event contract

**Tables** (11)
- [main] ai_analysis_jobs — durable AI analysis job state machine (task_type/status CHECKs, attempts, result JSONB); 20260621140000
- [main] ai_observations — typed per-task AI outputs keyed to job_id; 20260621140000
- [main] temporal_findings — component-change findings, reviewer_state gate, public_summary vs internal_explanation split; 20260621140000
- [main] disclosure_claims / disclosure_conflicts — seller claim ledger + classified conflicts with correction_history; 20260621140000
- [#194] marketplace_activity_events — THE single analytical event store: schema_version, event_type (CHECK of 23), occurred_at_client vs clamped occurred_at, actor_scope, pseudonymous_session_key, internal-only authenticated_user_id/tenant_id/organization_id (server-derived), identity_erased_at tombstone, listing_id/vehicle_reference/object refs, exclusion_flags, unique idempotency key; 20260827120000 (diff only)
- [#194] intelligence_ingestion_stats — per-window ingest health counters (received/accepted/rejected/duplicate/flagged/opened_without_context/storage_failures); 20260827120000
- [#194] listing_daily_metrics — per-listing per-UTC-day rollup, upsert key metric_date+listing_id+calculation_version; 20260827130000
- [#194] seller_daily_metrics / tenant_daily_metrics / platform_daily_metrics — scope rollups (seller_user_id / tenant_id / platform); 20260827130000
- [#194] intelligence_rollup_runs — rollup run ledger (never blocks the rollup itself); 20260827130000
- [#194] intelligence_recommendation_state — I17 suppression/cooldown only (rule_key, subject, evidence_fingerprint, dismissed/acted/snoozed); recommendations always recomputed, never stored; 20260828120000
- READ-ONLY authorities consumed, never owned: mechanic_work_orders (20260808150000 on main), partsentry_logs (002_multi_tenant on main), marketplace_inquiries, vehicles, saved_vehicles, vehicle_reservations, message_threads

**Services** (13)
- [main] disclosureConflict.js — extractClaims/classifyConflict/persistClaims/persistConflict/applySellerResponse; advisory only, pending_review default
- [main] temporalComparison.js — classifyComponentChange/listTemporalFindings; SAME_VEHICLE_MIN=0.75 publication gate
- [#194] activityEventTypes.js — taxonomy authority: EVENT_TYPES, RESERVED_EVENT_TYPES, PRIVACY_CLASS, METADATA_ALLOWLIST, EXCLUSION_FLAGS, isClientEmittable
- [#194] activityLedgerService.js — ingestClientBatch, recordServerEvent, deriveActorContext, resolveObjectScope, computeExclusionFlags, clientIdempotencyKey, insertEvents, recordIngestionStats; MAX_EVENTS_PER_BATCH=50, MAX_BODY_BYTES=64KB, LATE_EVENT_WINDOW_MS=24h
- [#194] marketplaceActivityEmitters.js — emitSearchPerformed, emitListingOpened, emitListingSaved/Unsaved, emitInquiryCreated (+ price/publish/sold/reservation emitters); clientContextFrom, isPrefetch, normalizeSearchFilters, hashQueryText
- [#194] rollupService.js — rollupDay, rollupFreshness, computeListingMetrics/computeScopeMetrics/computePlatformMetrics, readInquiryAuthority/readReservationAuthority/readWatchlistSnapshot; ROLLUP_CALCULATION_VERSION='rollup@1'
- [#194] intelligenceProjectionService.js — getListingInsights, getSellerPulse, getDealerIntelligence, getAdminIntelligence, readListingGuidance; authority helpers assertListingOwnership/requireVerifiedTenant/requirePlatformAdmin; floors + AVAILABILITY envelope
- [#194] serviceIntelligenceService.js — getMechanicIntelligence (person scope, AuthorizationError without id), getGarageIntelligence (tenant scope), demandByVehicle, repeatCustomers, NOT_MEASURABLE registry; SERVICE_INTELLIGENCE_VERSION='service@1'
- [#194] recommendationService.js — RULES, evaluateSubject, evidenceFingerprint, loadState/recordEmission (idempotent on rule+subject+fingerprint), requireSubjectAccess; RECOMMENDATION_VERSION='next_best_action@1'
- [#194] aiIntelligenceContextService.js — buildAuthorizedContext (closed fact set, role-scoped), validateAnswer (rejects numbers absent from context); AI_CONTEXT_VERSION='ai_context@1'
- [#194] reportService.js — buildSellerReport, toCsv, resolvePeriod (weekly/monthly); unavailability survives export
- [#194] kpiCatalogue.js — KPI_CATALOGUE (listing_views, unique_visitors, inquiries, listing_completeness, lost_opportunity, trust_position, ...); kpi_catalogue@1
- [#194] listingCompletenessService.js (I6), commandCentreService.js (I16 getCommandCentre), finance/insurance/government/parts/trade/referral IntelligenceServices (I10–I15) — persona read-model projections

**APIs** (26)
- [main] POST /api/evidence/:evidenceId/analyze — backend/routes/intelligenceRoutes.js, authorizeRole(['admin','government'])
- [main] GET /api/vehicles/:vin/temporal-findings — intelligenceRoutes.js, optionalAuth() factory called; public gets only confirmed+public_summary allowlist
- [main] GET /api/vehicles/:vin/disclosure-conflicts — intelligenceRoutes.js, optionalAuth(); same public allowlist
- [main] POST /api/vehicles/:vin/disclosure-scan — intelligenceRoutes.js, authorizeRole(['admin','government'])
- [main] POST /api/disclosure-conflicts/:id/seller-response — intelligenceRoutes.js, authorizeRole(['owner','dealer','admin'])
- [#194] POST /api/intelligence/activity — intelligenceActivityRoutes.js, optionalAuth()+rateLimiter; client batch ingest (max 50 events / 64KB), identity/scope server-derived
- [#194] GET /api/admin/intelligence/ingestion-health — intelligenceActivityRoutes.js, authorizeRole(['admin'])
- [#194] GET /api/marketplace/my-listings/:vin/analytics — intelligenceProjectionRoutes.js, authorizeRole([]) any-authed + assertListingOwnership in service
- [#194] GET /api/marketplace/my-analytics — projectionRoutes, authorizeRole([]) (seller pulse)
- [#194] GET /api/dealer/analytics — projectionRoutes, authorizeRole(['dealer','admin']) + requireVerifiedTenant
- [#194] GET /api/admin/marketplace/intelligence — projectionRoutes, authorizeRole(['admin'])
- [#194] GET /api/government/intelligence — projectionRoutes, authorizeRole(['government','admin'])
- [#194] GET /api/mechanic/analytics — projectionRoutes, authorizeRole(['mechanic','admin']) (I9 person scope)
- [#194] GET /api/garage/analytics — projectionRoutes, authorizeRole(['mechanic','dealer','admin']) (I9 tenant scope)
- [#194] GET /api/insurance/demand-intelligence — authorizeRole(['insurance','admin'])
- [#194] GET /api/finance/demand-intelligence — authorizeRole(['admin','finance','bank'])
- [#194] GET /api/parts/intelligence — authorizeRole(['mechanic','admin']); /api/admin/parts/intelligence — admin
- [#194] GET /api/trade/intelligence — authorizeRole(['owner','dealer','admin'])
- [#194] GET /api/admin/referrals/intelligence — admin; GET /api/government/provenance-intelligence — government/admin
- [#194] GET /api/admin/intelligence/command-centre — admin (I16)
- [#194] GET /api/marketplace/my-recommendations — authorizeRole([]) (I17); GET /api/admin/intelligence/recommendations — admin
- [#194] GET /api/intelligence/assistant-context — authorizeRole([]) (I18 governed AI context)
- [#194] GET /api/intelligence/kpi-catalogue — NO auth middleware (static catalogue, deliberate)
- [#194] GET /api/marketplace/my-report — authorizeRole([]) (I19 weekly/monthly report + CSV)
- [#194] POST /api/internal/intelligence/rollup — intelligenceRollupRoutes.js, optionalAuth() then workerAuthorized (x-carup-worker-secret vs INTELLIGENCE_WORKER_SECRET, timingSafeEqual) OR adminAuthorized (rejects identityAsserted=true x-user-id fallback); max 31-day backfill
- [#194] GET /api/admin/intelligence/rollup-status — rollup freshness, admin-proven identity only

**Events** (10)
- [#194] marketplace_search_performed / marketplace_search_zero_results — emitted by backend/routes/marketplaceRoutes.js via emitSearchPerformed(req,{query,resultCount}); transport = direct best-effort insert into marketplace_activity_events (fire-and-forget .catch(()=>{}))
- [#194] marketplace_listing_opened — emitted by marketplaceRoutes.js detail handler via emitListingOpened; server-emitted but session-scoped (clientContextFrom(req)); prefetch filtered (isPrefetch)
- [#194] marketplace_listing_saved / marketplace_listing_unsaved — emitted by backend/services/marketplace/marketplaceSavedService.js via emitListingSaved/emitListingUnsaved
- [#194] marketplace_inquiry_created — emitted by backend/services/marketplace/marketplaceInquiryService.js via emitInquiryCreated(inserted,…); marketplace_inquiries stays the authority, event is observation only
- [#194] client-emitted set (POST /api/intelligence/activity): listing_impression, listing_engaged, inquiry_started, compare_added/removed/viewed, contact_clicked, listing_shared, inspection_requested + process_step_recorded (generic journey step, privacy class P1, metadata allowlist [process,step,outcome,elapsed_ms,validation_error_code]) — defined in activityEventTypes.js CLIENT_EMITTED
- [#194] server lifecycle set in enum: price_changed, listing_created/submitted/published/sold, reservation_started/completed — recordServerEvent in activityLedgerService.js with idempotencyMaterial derived from the authority row
- [#194] RESERVED_EVENT_TYPES (future, migration required to use): listing_paused, listing_archived, reservation_closed, listing_paid, purchase_confirmed, recommendation_served, recommendation_clicked — no service_* events reserved
- [#194] consumer: rollupService.rollupDay reads the day's ledger rows + authority tables (marketplace_inquiries, vehicle_reservations, saved_vehicles) into 4 daily-metrics tables; ONLY caller is POST /api/internal/intelligence/rollup — no scheduler/cron exists in the repo
- [main] eventBus (backend/services/eventBus/eventBusService.js, in-memory EventEmitter + domain_events/outbox_events tables from migrations 002/011) is NOT consumed by Intelligence — #194 deliberately bypasses it with direct ledger inserts
- Invariant 7 compliance: ledger migration header states saved_vehicles/marketplace_inquiries/message_threads/vehicles/escrow+reservations/trust services remain the authorities; Intelligence only counts (20260827120000 in pr194.diff)

**RLS/policies** (7)
- [main] ai_analysis_jobs/ai_observations/temporal_findings/disclosure_claims/disclosure_conflicts — RLS enabled, REVOKE ALL FROM anon (20260621140000 lines 140-150); backend reads via service-role client
- [#194] marketplace_activity_events — ENABLE + FORCE RLS, REVOKE ALL from anon/authenticated/PUBLIC, GRANT full CRUD to service_role only; no policies defined = deny-all except service_role bypass
- [#194] intelligence_ingestion_stats — FORCE RLS, service_role SELECT/INSERT/UPDATE only
- [#194] listing/seller/tenant/platform_daily_metrics + intelligence_rollup_runs — FORCE RLS + service_role-only applied via DO-loop EXECUTE over all five tables
- [#194] intelligence_recommendation_state — FORCE RLS + service_role-only (DO block)
- [#194] intelligence_erase_actor(TEXT), intelligence_purge_activity_events(TIMESTAMPTZ), intelligence_bump_ingestion_stats(...) — SECURITY DEFINER, search_path pinned, EXECUTE granted to service_role only; purge hard-fails inside the 24-month retention window
- Net effect: all authorization for Intelligence data is APPLICATION-layer (authorizeRole + projection service guards); Postgres roles other than service_role can touch nothing

**Migrations** (6)
- [main] database/migrations/20260621140000_ai_temporal_disclosure_intelligence.sql — ai_analysis_jobs (task/status state machine), ai_observations, temporal_findings, disclosure_claims, disclosure_conflicts; RLS enabled + anon revoked (lines 140-150)
- [#194 only] database/migrations/20260827120000_intelligence_activity_ledger.sql — marketplace_activity_events (single analytical event store, CHECK enum of 23 event types, actor_scope/platform/surface CHECKs, uq_mae_idempotency_key, 6 indexes), intelligence_ingestion_stats, intelligence_erase_actor(), intelligence_purge_activity_events() (refuses purge inside 24-month retention), RLS FORCE + service_role-only
- [#194 only] database/migrations/20260827130000_intelligence_rollups.sql — listing_daily_metrics, seller_daily_metrics, tenant_daily_metrics, platform_daily_metrics, intelligence_rollup_runs; RLS FORCE + service_role-only via DO loop
- [#194 only] database/migrations/20260827140000_intelligence_post_review_hardening.sql — recreates intelligence_erase_actor (tombstones authenticated_user_id + identity_erased_at) and adds intelligence_bump_ingestion_stats() SECURITY DEFINER upsert; all service_role-only
- [#194 only] database/migrations/20260828120000_intelligence_recommendations.sql — intelligence_recommendation_state (I17 suppression state only; unique on rule_key+subject_type+subject_id+evidence_fingerprint); RLS FORCE service_role-only; comment declares 'never the recommendation itself'
- Marker contract: all four #194 files start '-- +migrate Up' (per carup migration marker contract); they exist ONLY in pr194.diff, not on main (verified ls of database/migrations)

**Tests** (14)
- [main] backend/tests/intelligence-routes.test.js — locks Milestone-3 public allowlist: anonymous callers never see pending findings, internal_explanation, or raw model output
- [#194] intelligence-activity-ledger.test.js — ingestion contract: client identity/scope dropped, idempotency, batch caps, late clamp
- [#194] intelligence-marketplace-instrumentation.test.js — I3: emitters fire on search/open/save/inquiry and never break the domain write
- [#194] intelligence-rollups.test.js — rollup reproducibility/idempotence and authority reads
- [#194] intelligence-rollup-route-auth.test.js — worker-secret + proven-admin gate; x-user-id asserted identity rejected
- [#194] intelligence-projections.test.js — I5 privacy floors, ownership scoping, availability envelope
- [#194] intelligence-service-mechanic-garage.test.js — I9: mechanic scope never widens to tenant, garage scope never narrows to caller, NOT_MEASURABLE stays refused
- [#194] intelligence-recommendations.test.js — I17 abstain-first rules + fingerprint suppression
- [#194] intelligence-ai-context.test.js — I18 closed fact set + validateAnswer rejects invented numbers
- [#194] intelligence-reports.test.js — I19 export preserves unavailability; intelligence-listing-completeness.test.js — I6 scoring
- [#194] intelligence-command-centre.test.js, intelligence-finance/government/insurance/parts/referral/trade.test.js — persona projection contracts I10–I16
- [#194] intelligence-review-regressions.test.js — I6 post-review regression locks (incl. purge-inside-retention refusal assertion)
- [#194] intelligence-schema-contract.test.js — locks seller_id vs current_seller_id key discipline per table and that every table an Intelligence service reads exists
- [#194] security-closure-g1-g2-g3.test.js + security-closure-g4-referral-attribution.test.js — G-closures: verified actor context ignores every forgeable header; no ungated referral route builds actors from headers; tenant on validation events comes from the code row

**Contract gaps** (9)
- No service-domain events exist anywhere: the ledger enum, activityEventTypes.js, and emitters are 100% marketplace_*; S7 'service event/activity instrumentation' (PLAN.md:1633) needs new event types (migration + registry + emitter module) end to end
- No scheduler: rollupDay's only caller is the #194 HTTP endpoint gated by INTELLIGENCE_WORKER_SECRET; no cron/worker config exists in the repo, so daily metrics (and any future service metrics) go stale without an external trigger
- No I9 reconciliation artifact: plan 19.3 requires S0 to update the not-measurable registry to the final Foundation schema; NOT_MEASURABLE lives only inside #194's serviceIntelligenceService.js and still lists items 19.1 makes measurable (turnaround_time, cancellation_rate, service_category_demand, bookings)
- Nothing of I0–I19 is on main: main's whole intelligence layer is Milestone-3 visual/disclosure AI (2 services, 1 route file, 1 migration); every ledger/rollup/projection/recommendation/report capability Service Network wants to converge with is unmerged #194 code
- No service_cases/work-order coverage in rollups: rollupService reads only marketplace_inquiries, vehicle_reservations, saved_vehicles authorities; request-to-accept and completion elapsed-time metrics (19.1) have no source until Service Network writes authoritative timestamps and rollups learn to read them
- No branch attribution: 19.1 allows 'branch activity where branch attribution exists'; mechanic_work_orders columns read by I9 (id, vin, status, created_at, customer_id, mechanic_id, tenant_id, organization_id) carry no branch_id
- No response-time-from-Communications metric: 19.1 names it, but no #194 intelligence service reads message_threads/messages
- No Service Case / QR source-channel analytics: plan 20.4 source attribution has no landing place in the ledger (source_surface enum lacks any service/qr surface beyond 'external_link')
- Production DB gap: #194 intelligence migrations applied to staging only (PR #185 lane); prod lacks marketplace_activity_events and all rollup tables

**Likely conflicts with Service Network** (8)
- NAMING: plan §16 recommended boundary 'serviceIntelligence emitters' collides with #194's existing backend/services/intelligence/serviceIntelligenceService.js (an I9 READER, not an emitter); Service Network must pick a distinct name (e.g. serviceActivityEmitters mirroring marketplaceActivityEmitters.js)
- PLAN ASSUMES #194: PLAN.md §3 lists 'garage/mechanic Intelligence' as current-state truth to preserve, but I9 (serviceIntelligenceService, /api/mechanic/analytics, /api/garage/analytics) exists ONLY in unmerged #194 — Service Network built off main alone would find no Intelligence layer to converge with
- SCHEMA AUTHORITY: marketplace_activity_events event enum is a hard CHECK constraint (mae_event_type_valid, 23 marketplace_* types + process_step_recorded); S7 service events cannot be inserted without a new migration extending the CHECK plus activityEventTypes.js registry — RESERVED_EVENT_TYPES reserves 7 future marketplace types, zero service_* types
- I9 NOT_MEASURABLE registry (serviceIntelligenceService.js: bookings, booking_conversion, capacity_utilisation, team_performance, branch_performance, turnaround_time, cancellation_rate, service_category_demand) directly overlaps plan 19.1 'measurable after Foundation' (requests, accept/decline, request-to-accept time, category demand) — plan 19.3 mandates S0 reconciliation of this exact registry; plan §3.6 already flags the cancellation contradiction
- SCOPE SEMANTICS: I9 keys garage scope on tenant_id/organization_id and mechanic scope on mechanic_id from mechanic_work_orders; plan §6.4 assignment and Invariant 3 (garage vs mechanic principals) must map onto these same columns or I9 projections silently miss Service Network work
- INQUIRY VOCABULARY: serviceIntelligenceService counts demand from marketplace_inquiries with inquiry_type in ('garage_service_request','mechanic_service_request'); if Service Case creation moves requests out of marketplace_inquiries (plan §10.3 bridge), I9 demand metrics break unless re-pointed at service_cases
- ROLLUP CLOCK: #194 fixes UTC as the rollup day (rollupService dayBounds); any Service Network SLA metrics (request-to-accept elapsed) must adopt the same clock discipline or reconcile explicitly
- intelligence migrations in #194 were applied STAGING-only (PR #185 lane per memory); production Postgres has none of these tables — Service Network gating on prod metrics would fail

**Must reuse (do not duplicate)** (12)
- backend/services/intelligence/activityLedgerService.js recordServerEvent — the ONLY sanctioned way to write an observation; S7 service emitters must call it (idempotencyMaterial from the authority row), never insert into the ledger directly
- backend/services/intelligence/marketplaceActivityEmitters.js pattern — best-effort never-throw emitter module; clone as serviceActivityEmitters per plan §16 boundary instead of inventing a second transport
- backend/services/intelligence/activityEventTypes.js — single event taxonomy (versions, privacy class, metadata allowlist, exclusion flags); extend it + the mae_event_type_valid CHECK, do not create a parallel service-event registry
- backend/services/intelligence/rollupService.js — readAllPages, dayBounds (UTC), isCountable/isSelfTraffic, versioned idempotent upserts, intelligence_rollup_runs ledger; add service metrics as new computed columns/tables under the same calculation_version discipline
- backend/services/intelligence/intelligenceProjectionService.js — metric()/unavailable()/rate() availability envelope + MIN_CONVERSION_DENOMINATOR=20/MIN_BENCHMARK_COHORT=8 floors; the plan's 'no fake zeros' checklist item (PLAN.md:1951) is already implemented here
- backend/services/intelligence/serviceIntelligenceService.js — I9 mechanic-person/garage-tenant separation and NOT_MEASURABLE registry; S7 must UPDATE this module (19.3 reconciliation), not build a rival mechanic/garage analytics service
- backend/services/referral/referralEngineService.js buildVerifiedActorContext (#194) — proven-identity actor pattern (rejects x-user-id fallback via identityAsserted); reuse for QR/service-link source attribution (plan 20.4) so scan attribution cannot be forged
- intelligenceRollupRoutes.js workerAuthorized pattern (timingSafeEqual on INTELLIGENCE_WORKER_SECRET) — reuse for any internal service-network worker endpoint
- process_step_recorded event (P1, metadata allowlist process/step/outcome/elapsed_ms) — already covers generic journey instrumentation; service request/accept UI funnels may ride it before dedicated events exist
- intelligence_erase_actor / intelligence_purge_activity_events / intelligence_bump_ingestion_stats DB functions — governed erasure/retention/stats; service events stored in the same ledger inherit them for free
- optionalAuth()/authorizeRole() factories from backend/middleware/authMiddleware.js — optionalAuth is a FACTORY (must be called), a known footgun documented in #194 route comments
- backend/tests/intelligence-schema-contract.test.js (#194) — locks seller_id vs current_seller_id key discipline and that every read table exists; extend it when service tables join the read set

**PR #194 delta** (14)
- backend/routes/intelligenceActivityRoutes.js (A) — client activity ingestion + ingestion health
- backend/routes/intelligenceProjectionRoutes.js (A) — all role-scoped analytics endpoints I5–I19
- backend/routes/intelligenceRollupRoutes.js (A) — rollup trigger (worker secret/admin) + freshness
- backend/services/intelligence/ 15 new modules (A) — activityEventTypes, activityLedgerService, marketplaceActivityEmitters, rollupService, intelligenceProjectionService, serviceIntelligenceService (I9), recommendationService, aiIntelligenceContextService, reportService, kpiCatalogue, listingCompletenessService, commandCentreService, 6 persona services; main's 2 modules (disclosureConflict, temporalComparison) untouched
- backend/server.js (M) — imports + app.use of the 3 new intelligence routers
- backend/routes/marketplaceRoutes.js (M) — emitSearchPerformed on search, emitListingOpened on detail (fire-and-forget)
- backend/services/marketplace/marketplaceInquiryService.js (M) — emitInquiryCreated after insert
- backend/services/marketplace/marketplaceSavedService.js (M) — emitListingSaved/Unsaved
- backend/services/referral/referralEngineService.js (M) — adds buildVerifiedActorContext (ignores forgeable x-user-id/x-tenant-id headers); backend/routes/referralRoutes.js (M) uses it — the G1/G4 attribution-forgery closure
- database/migrations/ 4 new intelligence migrations (A) — activity ledger, rollups, post-review hardening, recommendations (none on main)
- backend/tests/ 19 new intelligence-*.test.js (A) + security-closure-g1-g2-g3.test.js + security-closure-g4-referral-attribution.test.js (A)
- web/src/components/intelligence/ 16 components + tests (A); web/src/lib/intelligenceActivity.ts + intelligenceDisplay.ts (A); VehicleIntelligenceStory.tsx (A) — main has zero web intelligence surface
- docs/intelligence/ receipts I0–I19 + G-closure + manuals + i0/i1 appendices (A)
- adjacent in same PR: 20260828133000_global_vehicle_taxonomy_s0.sql adds vehicles seller_description/body_style/make_taxon_id etc. — taxonomy domain but feeds listing-completeness evidence

**Notes:** Workspace verified read-only at /Users/shadreckmusarurwa/Project AI/carup-service-network. Clean split: MAIN's 'intelligence' = Milestone-3 visual/disclosure AI (advisory findings, pending_review default, public allowlist) and is orthogonal to the I0–I19 programme; EVERYTHING the Service Network plan means by 'Intelligence' (ledger, rollups, projections, I9 mechanic/garage, recommendations, AI context, reports) exists only in unmerged PR #194 (PR #185 lane folded in). Architecture is three-layer: observation ledger (marketplace_activity_events, service_role-only) -> reproducible UTC-day rollups (versioned, idempotent upserts) -> authorized projections with availability envelopes (unknown != zero, matching plan Invariant 10). Invariant 7 is already enforced in-code and in migration prose: Intelligence never writes business state; erasure/purge are governed SECURITY DEFINER functions. The single sharpest Pre-S0 decision: whether Foundation S7 extends the mae_event_type_valid CHECK with service_* events (migration + activityEventTypes registry + a new serviceActivityEmitters module patterned on marketplaceActivityEmitters) or reads Service Case authority tables directly in rollups — both paths exist as proven patterns in #194. S0 must also produce the I9 reconciliation (plan 19.3) against #194's NOT_MEASURABLE registry and decide the merge-order dependency: the plan's current-state assumptions (§3 'garage/mechanic Intelligence') are only true if #194 lands before Foundation work starts.

### Domain: owner-surfaces

**Files** (18)
- web/src/pages/dashboard/owner/MyGarage.tsx — owner vehicle grid at /dashboard/garage; fetchOwnedVehicles only; truthful stated values via ownerStatedValues; NO per-vehicle service entry point
- web/src/pages/dashboard/owner/ServiceHistory.tsx — owner service history at /dashboard/service-history; fetchOwnedVehicles + fetchServiceHistory; carries the exact truth debt plan 22.2 orders removed
- web/src/pages/dashboard/owner/VehicleProfile.tsx — per-VIN passport surface (/dashboard/garage/:id); Service History tab built from passportData.timeline split by id prefix workorder:/partsentry:; truthful 'Garage not recorded'/'—' cost
- web/src/pages/GarageDirectory.tsx — public /garages; deliberately honest empty state over a hardcoded empty array; zero API wiring, ready shell for governed registry
- web/src/pages/dashboard/mechanic/MechanicDashboard.tsx — stats/chart derived only from fetched work orders; create-work-order dialog; promise-chain loading pattern documented in-file
- web/src/pages/dashboard/mechanic/WorkOrders.tsx — list/create/complete/cancel work orders; optimistic update with rollback; keeps FULL DB id for PATCH; 'Unassigned' or mechanic-id-prefix label (no real assignment model)
- web/src/pages/dashboard/mechanic/ServiceLogs.tsx — VIN-keyed PartSentry log viewer + signed log recorder; ACTION_TYPES mirror DB CHECK
- web/src/pages/dashboard/mechanic/CustomerRecords.tsx — 100% hardcoded demo customers (4 invented people with phones/emails/spend); no API, no backend endpoint exists
- web/src/pages/dashboard/mechanic/PartsTracking.tsx — tenant parts inventory; on main still has fake 'Upload Invoice' (toast-only, no request), invented supplier 'Internal', invented minStock 5, 0-fallbacks — PR #194 rewrites all of this
- web/src/App.tsx — route registration: /garages public; owner routes under DashboardLayout role=owner; /mechanic{,/work-orders,/service-logs,/parts,/customers} under role=mechanic
- web/src/components/layout/DashboardLayout.tsx — sidebar rendered from featureRegistry through resolveFeatureVisibility + evaluateRouteAccess (sidebar visibility == direct-route decision)
- web/src/config/featureRegistry.ts — governed feature ids: owner.garage, owner.service-history, mechanic.overview/work-orders/service-logs/parts/customers, product.garages (public /garages, roles:[])
- web/src/config/navigationManifest.ts — mega-menu/mobile entries pointing at /garages, /dashboard/service-history, /mechanic/work-orders
- web/src/hooks/useCarUpApi.ts — 2932-line aggregate API hook; returns a NEW object literal every render (no useMemo) while loading/error state mutates — consumers MUST destructure the useCallback-stable functions
- web/src/lib/apiClient.ts — resolveApiBaseUrl(configured, hostname): configured → local /api → stable-staging → fail-closed UNPAIRED_PREVIEW sentinel → PRODUCTION default; plus CSRF/session core
- web/src/pages/dashboard/owner/ownerStatedValues.ts — truthful stated-value helpers (readOwnerTrustClaim fails closed; statedMileage/Price/Date/Count render missing as words, never 0)
- web/src/components/marketplace/ListingImage.tsx — truthful vehicle-image fallback (no stock-photo claims)
- web/src/components/layout/CompactBottomNav.tsx — PR #194 mobile bottom nav; role-aware account destination includes mechanic → /mechanic

**Tables** (4)
- vehicles — owner_id-filtered by /api/vehicles/me (select('*'); no media column, photos come from listing_media elsewhere)
- mechanic_work_orders — tenant_id-scoped work orders; vin FK; status CHECK 'In Progress'|'Completed'|'Cancelled'; ALSO the raw source of owner /service-history/me
- mechanic_parts — tenant_id-scoped parts inventory (workOrders/partsRoutes)
- partsentry_logs — signed part logs; action_type CHECK Replaced|Repaired|Inspected|Diagnosed; read per VIN

**Services** (3)
- web/src/hooks/useCarUpApi.ts — single frontend API authority for all these surfaces; per-endpoint useCallbacks over a shared request() that binds x-user-id/x-session-token/x-stakeholder-role/x-tenant-id + CSRF
- web/src/lib/apiClient.ts — framework-agnostic request core: resolveApiBaseUrl, CSRF token binding, SessionExpiredError/401 handling, extractApiErrorMessage
- web/src/config/featureRegistry.ts + lib feature-governance (resolveFeatureVisibility, evaluateRouteAccess) — nav and route access authority for every one of these pages

**APIs** (9)
- GET /api/vehicles/me — backend/server.js:2743, authorizeRole(['owner','dealer','admin']) (MyGarage, ServiceHistory)
- GET /api/service-history/me — backend/server.js:2833, authorizeRole(['owner','dealer','admin']); returns RAW mechanic_work_orders rows for owned VINs — no garage/provider join
- GET+POST /api/mechanic/work-orders — backend/routes/workOrdersRoutes.js, authorizeRole(['mechanic','admin']), tenant_id from req.userContext.tenantId
- PATCH /api/mechanic/work-orders/:id — workOrdersRoutes.js:59; tenant-scoped in the UPDATE (cross-tenant == 404); status + optional total_cost
- GET+POST /api/mechanic/parts — backend/routes/partsRoutes.js, tenant_id-scoped (PartsTracking)
- POST /api/partsentry/add — backend/server.js:1630, authorizeRole(['mechanic','owner','dealer','admin']); mechanic identity server-derived (ServiceLogs, owner PartSentry)
- GET /api/partsentry/:vin — backend/server.js:1658, optionalAuth() (ServiceLogs, VehicleProfile parts)
- GET /api/mechanic/analytics?window= — PR #194 fetchMechanicIntelligence for ServiceIntelligence scope=mechanic panel
- GET /api/passport/:vin family — via fetchVehiclePassport; timeline is VehicleProfile's only service-history source

**RLS/policies** (1)
- Not inspected (frontend recon); observed enforcement for these surfaces is app-layer: authorizeRole middleware + explicit .eq('tenant_id', req.userContext.tenantId) filters in workOrdersRoutes.js/partsRoutes.js via service-role client — do not assume DB RLS backs them

**Tests** (11)
- web/src/pages/dashboard/mechanic/WorkOrders.test.tsx — locks PATCH completion/cancel with FULL DB id and DB-legal status values ('In Progress'|'Completed'|'Cancelled')
- web/src/pages/dashboard/mechanic/ServiceLogs.test.tsx — locks DB CHECK action_type set, no fabricated seed logs, no client-chosen mechanic id
- web/src/pages/dashboard/owner/OwnerDashboard.truthfulness.test.tsx — fresh owner must never see prototype balances/trust/verified/sample docs
- web/src/pages/dashboard/owner/OwnerDashboard.trust.test.tsx + OwnerDashboard.identity.test.tsx — trust-claim and identity truth on the owner surface
- web/src/pages/dashboard/owner/VehicleProfile.claims.test.tsx — grounded claim badges on the per-VIN surface
- web/src/pages/dashboard/owner/PartSentry.test.tsx — owner PartSentry page contract
- web/src/components/layout/dashboardSidebar.visibility.test.ts — sidebar visibility must AGREE with direct-route decision (disabled/hidden/role-denied)
- web/src/lib/apiClient.test.ts — full resolveApiBaseUrl matrix (staging/preview/production/local) + CSRF binding + 401-vs-403 session semantics
- web/src/pages/dashboard/owner/MyListings.responsive.test.tsx — only responsive test in owner surfaces; nothing equivalent for mechanic pages
- PR #194 adds: web/src/pages/dashboard/mechanic/PartsTracking.test.tsx (locks error-vs-empty + no invented supplier/threshold/invoice) and web/src/pages/dashboard/owner/VehicleProfile.passport-v15.test.tsx
- NO test covers GarageDirectory.tsx or owner ServiceHistory.tsx

**Contract gaps** (12)
- No Service Request CTA, page, route, or API exists anywhere (grep 'Service Request|Book Service|service-request' → only a comment about the removed fake CTA in GarageDirectory.tsx)
- No Service Case concept anywhere: grep ServiceCase/service_case across web/src and backend returns zero hits — no case detail page, no case list, no case API
- GarageDirectory.tsx has no data source: hardcoded empty garages array, no directory endpoint, no governed garage registry to wire to (in-file comment says exactly this)
- No garage detail page and no garage queue (tenant intake) surface for plan 22.1/22.3
- No mechanic-assignment model or UI: WorkOrders renders 'Unassigned' or a synthetic label from a mechanic_id prefix; intake user vs assigned mechanic are not separated (plan 22.3)
- GET /api/service-history/me returns raw mechanic_work_orders with no provider identity — the frontend can only print the literal word 'Garage' (ServiceHistory.tsx renders a bare 'Garage' span)
- ServiceHistory.tsx truth debt plan 22.2 orders removed: hard-coded 'Next Service 500 km' tile, '$'+ (total_cost||0) prints $0 for cost-not-recorded, no provenance labels, no PartSentry links
- MyGarage.tsx has no truthful service entry point per vehicle (plan 22.2 'My Garage' requirement)
- CustomerRecords.tsx is pure demo data with NO backend endpoint (/mechanic/customers API does not exist) — plan needs owner-linked customer/case records instead
- No service link / QR surface exists in web (plan section 20)
- No mobile minimum-width or touch-target tests for mechanic or service surfaces (plan 22.4); only MyListings has a responsive test
- No web test coverage for GarageDirectory's empty-state contract or ServiceHistory's rendering

**Likely conflicts with Service Network** (6)
- Naming: 'My Garage' = the OWNER'S vehicle collection (/dashboard/garage, feature id owner.garage, nav-garage) while the plan's 'garage' = a service business — every new garage-identity surface must avoid this route/label/feature-id namespace
- Status vocabulary: mechanic_work_orders CHECK ('In Progress'|'Completed'|'Cancelled') plus lowercase legacy rows normalized in WorkOrders.tsx vs plan section 7's service lifecycle state machine — needs an explicit mapping since plan 22.3 says evolve WorkOrders, not replace it
- mechanic_work_orders is already BOTH the mechanic work-order store AND the owner service-history feed (/service-history/me) AND the passport 'workorder:' timeline source — a new service_records/case schema overlaps all three consumers at once
- featureRegistry 'product.garages' already owns route /garages (public, roles:[], header/footer placements) — the governed directory must take over this feature id/route, not add a parallel one
- PR #194 puts ServiceIntelligence (scope=mechanic, GET /mechanic/analytics) on MechanicDashboard — service-case KPIs must converge with that panel, not duplicate it
- PR #194 fully rewrites PartsTracking.tsx (nullable TrackedPart model, invoice control removed) — any Service Network edit to that file on top of main will conflict textually with #194

**Must reuse (do not duplicate)** (11)
- useCarUpApi request core (web/src/hooks/useCarUpApi.ts) — add service-network functions as per-endpoint useCallbacks there; consumers MUST destructure (the returned aggregate is a new object every render — confirmed: no useMemo on the return, loading/error state churns identity)
- resolveApiBaseUrl(import.meta.env.VITE_API_URL, window.location.hostname) (web/src/lib/apiClient.ts) — all 13 existing call sites pass both args and ZERO bare calls exist today (bare call returns PRODUCTION); new code must copy this exact pattern
- ownerStatedValues.ts helpers (readOwnerTrustClaim/statedMileage/statedPrice/statedDate/statedCount) — the canonical truthful-rendering vocabulary for owner surfaces
- featureRegistry + resolveFeatureVisibility + evaluateRouteAccess (web/src/config/featureRegistry.ts, DashboardLayout.tsx) — register every new page here so sidebar visibility and route access stay in lockstep; never hand-roll nav
- shadcn design system web/src/components/ui (card, badge, dialog, input, empty, tabs...) + card-shadow/hover-lift utility classes — plan 22 says propagate this language, not invent a workshop one
- WorkOrders.tsx page itself — plan 22.3: evolve this page (it already has tenant-scoped list/create/complete/cancel with optimistic rollback and full-DB-id discipline)
- Truthful empty/error-state patterns: GarageDirectory's honest empty card (data-testid garage-directory-empty), work-orders-empty/error split in MechanicDashboard, PR #194 PartsTracking outage-vs-empty distinction
- PartSentry endpoints (POST /partsentry/add with server-derived mechanic identity, GET /partsentry/:vin) and ServiceLogs.tsx for part-fitment records tied to service work
- VehicleProfile's passport-timeline convergence (workorder:/partsentry: id-prefix split) — service records shown to owners already flow through the passport timeline; extend that channel rather than a second feed
- ListingImage truthful image fallback for any vehicle imagery on service surfaces
- CompactBottomNav + PR #194's min-h-11 touch-target tab pattern for the plan 22.4 mobile requirement

**PR #194 delta** (11)
- web/src/pages/dashboard/mechanic/MechanicDashboard.tsx — adds <ServiceIntelligence scope="mechanic"> governed practitioner-intelligence panel (I9)
- web/src/pages/dashboard/mechanic/PartsTracking.tsx — truthfulness rewrite: removes the fake toast-only 'Upload Invoice', nullable TrackedPart (no invented supplier 'Internal', no invented minStock 5, no 0-fallbacks), outage distinguishable from empty shelf; adds PartsIntelligence
- web/src/pages/dashboard/mechanic/PartsTracking.test.tsx — NEW, locks the rewrite's contracts
- web/src/pages/dashboard/owner/VehicleProfile.tsx — loadPassport refactor, explicit empty service-history message ('No service records are available to CarUp for this vehicle'), min-h-11 touch-target tabs
- web/src/pages/dashboard/owner/VehicleProfile.passport-v15.test.tsx — NEW passport-v15 contract test
- web/src/pages/dashboard/owner/OwnerDashboard.tsx — adds MarketplacePulse, NextBestActions, PeriodicReport intelligence panels
- web/src/hooks/useCarUpApi.ts — adds ~15 intelligence fetchers incl. fetchMechanicIntelligence → GET /mechanic/analytics?window= and fetchPartsIntelligence → GET /parts/intelligence
- web/src/App.tsx — adds ActivityInstrumentation, /sell (GuestSell), /support, /security routes
- web/src/components/layout/CompactBottomNav.tsx — NEW mobile bottom nav; mechanic account destination /mechanic
- web/src/lib/apiClient.ts — comment-level change re Intelligence observation attribution
- UNTOUCHED by #194: MyGarage.tsx, ServiceHistory.tsx, GarageDirectory.tsx, WorkOrders.tsx, ServiceLogs.tsx, CustomerRecords.tsx, featureRegistry.ts, DashboardLayout.tsx

**Notes:** Two loudest truth-debt items for S0: CustomerRecords.tsx (four wholly invented customers with phone numbers and emails on a live mechanic surface, no backend at all) and ServiceHistory.tsx (hard-coded 'Next Service 500 km', provider rendered as the bare word 'Garage', $0 printed for unrecorded cost) — the latter is verbatim what plan 22.2 orders removed. GarageDirectory is already an honest empty shell awaiting the governed registry. The owner-visible service truth currently flows through TWO channels that must converge, not triplicate: /service-history/me (raw mechanic_work_orders) and the passport timeline (workorder:/partsentry: prefixes in VehicleProfile). All resolveApiBaseUrl call sites are currently safe (explicit env+hostname); the hazard is only for NEW code. useCarUpApi render-loop hazard confirmed structurally: the hook returns a fresh object literal each render with loading/error state churn — destructuring is mandatory and every existing page plus every test mock already follows it.

### Domain: events-outbox

**Files** (13)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/eventBusService.js — emitDomainEvent (transactional outbox write, memory re-emit, marketplace-inquiry idempotent recovery on main), publishMemoryEvent, memoryBroker EventEmitter
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/eventWorker.js — singleton EventWorker: pg.Pool poller, subscribe(), pollEvents() batch-10 FOR UPDATE SKIP LOCKED, MAX_OUTBOX_ATTEMPTS=5, dead_letter transition, reprocessDeadLetters() replay
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/listeners.js — registerDomainListeners: referral bridge consumer + legacy VEHICLE_RESERVED/PAYMENT_RECEIVED/ESCROW_CREATED audit-only listeners
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/automationWebhookService.js — dispatchAutomationWebhook to n8n, env-gated, fail-safe non-fatal
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/communicationEventListeners.js — COMMUNICATION_EVENT_TYPES closed list → orchestrator.handleDomainEvent, forwards RAW outbox record for event_id dedupe
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/server.js — lines 355-357: registerDomainListeners(eventWorker); registerCommunicationListeners(eventWorker); eventWorker.start(1000)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/communicationRoutes.js — /api/internal/events/process worker-secret-guarded serverless outbox drain (lines 26-100)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/communicationBaseRoutes.js — /api/internal/communications/process notification delivery drain
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js — exemplar event-sourced consumer: makeProjectionSubscriber, event.id idempotency, checkpoints
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/metrics.js — metricsHub.recordOutboxBatch/recordOutboxSuccess/recordOutboxFailure (lines 67-76)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplaceInquiryService.js — canonical app-side emitter (lines 141-247), deps-injectable emitDomainEvent
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/blockchain/blockchainService.js — addEvent(vin,...) writes blockchain_events + rolling_integrity_checkpoints: the Passport ledger channel, SEPARATE from domain_events
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/vercel.json — {} empty: no Vercel crons; drains are pg_cron-driven

**Tables** (9)
- domain_events — the single transactional outbox: id, event_type, payload jsonb, status(pending/processed/failed/dead_letter), attempts, error_log, tenant_id, created_at, dead_lettered_at, dedupe_key + dormant aggregate_type/aggregate_id/correlation_id/causation_id/available_at/processed_at/locked_at/locked_by; owning migration 011_phase6_schema.sql (+ 20260621170000, 20260623143000, 20260811132100)
- notification_queue — event-driven notification sink; dedupe_key UNIQUE since 20260817180000; event_id column stores originating domain_events.id; owning 002_add_notification_queue.sql
- trade_graph_projection_checkpoints — per-tenant consumer checkpoint (last_event_created_at), UNIQUE(tenant_id); 20260621140000
- trade_graph_processed_events — per-event consumer dedup ledger; 20260621140000
- trade_graph_dead_letters — consumer-side dead letters; 20260621140000
- blockchain_events + rolling_integrity_checkpoints — Passport/vehicle ledger (SEPARATE channel from domain_events), written via blockchainService.addEvent
- webhook_logs / message_delivery_attempts — communications delivery evidence tables (20260623143000)
- communication_reconciliation_work — PR #194 ONLY (20260826120000): sweep-lane work items recovering missed event emissions via triggers on users/vehicles
- vehicle_ownership_transfer_events — PR #194 ONLY (20260828203000): per-aggregate append-only event history ordered by (transfer_id, created_at, id)

**Services** (8)
- backend/services/eventBus/eventBusService.js — outbox emit authority: emitDomainEvent, publishMemoryEvent, memoryBroker; PR #194 adds deterministicEventIdentity export
- backend/services/eventBus/eventWorker.js — delivery authority: subscribe, start/stop, pollEvents, processEvent, reprocessDeadLetters, MAX_OUTBOX_ATTEMPTS=5; interval poller auto-disabled on Vercel (isVercelServerlessRuntime)
- backend/services/eventBus/listeners.js — registerDomainListeners: cross-domain compat/audit listeners; explicit doctrine that events are NOT authority for money/state (Issue #164 Phase 6 comments)
- backend/services/eventBus/automationWebhookService.js — dispatchAutomationWebhook: optional n8n fanout, ENABLE_AUTOMATION_WEBHOOKS-gated, never throws into the caller
- backend/services/communication/communicationEventListeners.js — registerCommunicationListeners: the event→notification bridge (one handler closure per COMMUNICATION_EVENT_TYPES entry → orchestrator.handleDomainEvent)
- backend/services/communication/communicationOrchestratorService.js — handleDomainEvent(eventRecord, pgClient, tenantId): notification policy/template resolution into notification_queue
- backend/services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js — event-sourced projector; documents the 4th-raw-record handler argument contract (event.id as idempotency key)
- backend/services/metrics.js — metricsHub outbox instrumentation (backlog gauge, success/failure counters)

**APIs** (2)
- GET+POST /api/internal/events/process — backend/routes/communicationRoutes.js:99-100 (processEventOutboxBatch), auth requireWorkerSecret Bearer CARUP_WORKER_SECRET; runs ONE bounded eventWorker poll cycle, returns {processed, backlog}
- GET+POST /api/internal/communications/process — backend/routes/communicationBaseRoutes.js:99-100 (processWorkerBatch), same requireWorkerSecret pattern; drains notification_queue delivery worker

**Events** (11)
- marketplace.inquiry.created — emitted by marketplaceInquiryService.js:224 AND by DB trigger trg_marketplace_inquiry_communication_outbox (20260811132100); consumed by communicationEventListeners; transport domain_events outbox, dedupe_key marketplace.inquiry.created:<inquiryId>
- marketplace.inquiry.referral_bridge_requested — emitter marketplaceInquiryService.js:247; consumer eventBus/listeners.js → marketplaceReferralBridge; payload minimized by migration 20260716033000
- marketplace.listing.moderated — emitter marketplaceModerationService.js; consumer communication orchestrator
- finance.application.status_changed / .approved / .declined — emitters financeService.js + financeRoutes.js (fire-and-forget .catch(()=>{})); consumer communication orchestrator
- identity.verification.decided — emitter identity/decisionRecorder.js; consumer communication orchestrator
- evidence.review.decided — emitter evidence/evidenceReviewNotifier.js; consumer communication orchestrator
- VEHICLE_RESERVED / PAYMENT_RECEIVED / ESCROW_CREATED — legacy SCREAMING_SNAKE compat events; consumers in eventBus/listeners.js are audit/informational only (VEHICLE_RESERVED → blockchain addEvent passport ledger); no state mutation by design (Issue #164 Phase 6)
- MARKETPLACE_PAYMENT_INITIATED/INSPECTION_PENDING/RELEASE_APPROVED/DISPUTED/CANCELLED + FUNDS_HELD/SETTLED/REFUNDED/FAILED/PAYMENT_FAILED — emitted transactionally INSIDE DB RPCs issue164_transition_session_atomic / issue164_record_payment_state_atomic (INSERT INTO domain_events in 20260819121000 etc.); on main NOTHING subscribes them (PR #194 adds subscriptions)
- diaspora safetrade events — emitter diasporaNotificationService.js (emitDomainEvent with variable eventType); trade-graph projector consumes via makeProjectionSubscriber (event.id = idempotency key + checkpoint)
- outbox:<eventType> — memoryBroker re-emit after outbox settlement (eventWorker.processEvent); plus publishMemoryEvent for non-durable realtime; automationWebhookService n8n webhook dispatch disabled by default (ENABLE_AUTOMATION_WEBHOOKS)
- PR #194 adds: user.email.verified (durable welcome work item, identity recipientUserId), vehicle.trust.presentation_changed (identity presentation_fingerprint), vehicle.ownership.transfer_started/_action_required/_state_changed/_completed (emitted inside transfer RPC transactions)

**RLS/policies** (3)
- domain_events — NO RLS enabled and NO policies in any migration (grep across database/migrations); readable/writable only via service-role Supabase client and direct pg pool; payload privacy rests on emitter discipline
- notification_queue — RLS enabled with notification_queue_user_read policy (recipient_user_id = auth.uid) in 20260623143000_omnichannel_communication_engine.sql; other comm tables (message_threads, messages, ...) RLS'd in same migration
- trade_graph_* consumer tables — created in 20260621140000_diaspora_phase10_trade_graph.sql (service-role projection tables)

**Migrations** (11)
- database/migrations/011_phase6_schema.sql — creates domain_events (id uuid, event_type, payload jsonb, status pending/processed/failed, attempts, error_log, tenant_id text, created_at) + idx_domain_events_pending partial index
- database/migrations/20260621170000_outbox_dead_letter.sql — adds dead_lettered_at + idx_domain_events_dead_letter; introduces terminal 'dead_letter' status (status is plain TEXT, no CHECK)
- database/migrations/20260623143000_omnichannel_communication_engine.sql — adds aggregate_type/aggregate_id/correlation_id/causation_id/dedupe_key/available_at/processed_at/locked_at/locked_by + idx_domain_events_dedupe + idx_domain_events_available (all DORMANT: unused by emitter/worker)
- database/migrations/20260811132100_communications_2_reliability_closure.sql — dedupe_key + unique idx_domain_events_dedupe_key + BEFORE INSERT trigger communication_domain_event_dedupe_key() + AFTER INSERT trigger on marketplace_inquiries writing domain_events in-transaction
- database/migrations/20260809120000_events_outbox_pg_cron.sql — pg_cron job carup-events-outbox-every-minute → pg_net POST to /api/internal/events/process, Vault-secret gated, fail-closed if pg_cron/pg_net missing
- database/migrations/20260626120000_communication_supabase_cron.sql — same pg_cron/Vault architecture for /api/internal/communications/process delivery worker
- database/migrations/20260716033000_referral_bridge_outbox_payload_minimization.sql — minimize_referral_bridge_outbox_payload(): PII-stripping precedent for outbox payloads + irreversible redaction of existing rows
- database/migrations/20260817180000_notification_dedupe_uniqueness.sql — unique notification_queue.dedupe_key: DB-enforced one-intent-one-send downstream of events
- database/migrations/20260621140000_diaspora_phase10_trade_graph.sql — trade_graph_projection_checkpoints (per-tenant), trade_graph_processed_events, trade_graph_dead_letters: consumer-side idempotency exemplar
- database/migrations/20260819110000/120000/121000/124000/125000/126000 (issue164 phase6) — DB RPCs INSERT INTO domain_events inside the mutating transaction (MARKETPLACE_* stage/outcome events): the transactional-emit pattern plan sec 8 mandates
- database/migrations/002_add_notification_queue.sql — notification_queue table (event-driven notification sink)

**Tests** (10)
- backend/tests/outbox-dead-letter.test.js — locks attempts escalation, dead_letter transition + dead_lettered_at stamp, pre-threshold retry stays pending, reprocessDeadLetters filters
- backend/tests/communication-event-coverage.test.js — CI gate: every COMMUNICATION_EVENT_TYPES entry must have a literal emitter under backend/services|routes; also covers /api/internal/events/process route pair + notification policies
- backend/tests/communications-2-marketplace-outbox-hardening.test.js — locks marketplace.inquiry.created idempotent emit/recovery through createInquiry
- backend/tests/communication-outbox-dedupe.test.js — locks listener registration + notification dedupe via injected fakeWorker/services
- backend/tests/communication-engine.test.js — locks that registerCommunicationListeners subscribes the same handler closure per event type; orchestrator handling
- backend/tests/diaspora-safetrade-outbox.test.js — locks diaspora event emission through the outbox
- backend/tests/issue164-phase6-event-side-effect-containment.test.js — locks that domain events CANNOT mutate transaction/escrow state (events-are-not-authority doctrine)
- backend/tests/referral-marketplace-inquiry-lead-bridge.test.js — locks referral bridge consumer + minimized payload contract
- PR #194: backend/tests/email-hardening-c3-trust-event-idempotency.test.js + email-hardening-durability-scheduler.test.js — pin deterministicEventIdentity JS registry ↔ SQL communication_domain_event_dedupe_key() parity (both read 20260826120000_email_1_0_hardening.sql)
- PR #194: backend/tests/email-hardening-r1-welcome-durability.test.js — locks user.email.verified durable-welcome semantics via /api/internal/communications/process

**Contract gaps** (11)
- No service.* event namespace exists anywhere (full emitDomainEvent call-site inventory: marketplace/finance/identity/evidence/diaspora only) — plan sec 8's service.case.*, service.work_order.*, service.mechanic.*, service.mileage/part/evidence.*, service.work.* namespace is entirely greenfield
- No occurred_at field: domain_events has only created_at (insert time); plan envelope requires occurred_at distinct from persistence time — needs payload convention or new column
- No first-class envelope population: aggregate_type/aggregate_id/correlation_id/causation_id columns exist (20260623143000) but emitDomainEvent never writes them; plan's service_case_id/vin/work_order_id/actor_user_id identifiers currently have nowhere structured to live except JSON payload
- No per-aggregate ordering guarantee: poller orders globally by created_at ASC but a failed event returns to pending and can be overtaken by later events for the same aggregate; plan lifecycle transitions (requested→accepted→completed) need consumer-side tolerance or an ordering mechanism
- Handlers run inside the poller's shared batch transaction (eventWorker.pollEvents BEGIN..COMMIT over up to 10 events); one handler error rolls back status updates of the whole batch on transaction failure — long-running service-event handlers (notifications, projections) amplify this; no per-event transaction isolation
- Consumer idempotency is per-consumer, not generic: at-least-once delivery with retries means every service.* handler must be idempotent itself (patterns exist: notification_queue.dedupe_key unique 20260817180000; trade_graph_processed_events) — no shared processed-events ledger for new consumers
- Producer idempotency is a closed allow-list: on main only marketplace.inquiry.created recovers from duplicate insert; every deduplicatable service.* event needs BOTH a communication_domain_event_dedupe_key() trigger branch AND (post-#194) a DETERMINISTIC_EVENT_IDENTITY_FIELDS entry
- No event schema versioning: no version column on domain_events, no envelope version convention (only navigation_analytics_events has schema_version — different table)
- No RLS on domain_events: grep of all migrations finds zero policies/grants on it; payload privacy is enforced only by emitter discipline (referral minimization precedent 20260716033000) — service payload rules (plan sec 8 no-PII) need the same treatment
- pg_cron events drain is per-environment activation via Vault secrets (CARUP_EVENTS_ENDPOINT_URL + CARUP_WORKER_SECRET) — service events inherit whatever drain cadence exists; no new infra needed but staging/production activation state must be verified, not assumed
- Interval poller is OFF on Vercel serverless (isVercelServerlessRuntime guard) — local/dedicated only; service-event latency in deployed envs = pg_cron minute cadence

**Likely conflicts with Service Network** (7)
- Naming split: plan's dot-lowercase service.case.* matches marketplace.inquiry.created / vehicle.ownership.transfer_* convention, but the CURRENT canonical marketplace authority emits SCREAMING_SNAKE (MARKETPLACE_PAYMENT_INITIATED etc. from issue164 RPCs, PR #194 subscribes them) — plan sec 8 says 'one canonical namespace, no duplicate synonyms'; S0 must pick dot-lowercase and not mirror the RPC style
- File-collision with PR #194: it rewrites backend/services/eventBus/eventBusService.js (deterministicEventIdentity registry) and communicationEventListeners.js (16 new subscriptions); Service Network eventing built on main@ba208963 will conflict — must build on the #194 registry form
- Dedupe function ownership: public.communication_domain_event_dedupe_key() is defined in 20260811132100 and REDEFINED by PR #194's 20260826120000_email_1_0_hardening.sql; adding service.* dedupe branches means a third CREATE OR REPLACE — land-order with #194 must be settled or the later migration silently drops the other's branches
- Idempotency is dual-registration: DB trigger branch AND JS DETERMINISTIC_EVENT_IDENTITY_FIELDS must agree per event type (tests pin parity in #194: email-hardening-c3-trust-event-idempotency.test.js, email-hardening-durability-scheduler.test.js); a service.* event registered in only one place turns recovery into insert failure
- Schema overlap: omnichannel migration 20260623143000 added aggregate_type/aggregate_id/correlation_id/causation_id/available_at/processed_at/locked_at/locked_by to domain_events but NEITHER emitDomainEvent nor eventWorker uses them (insert = event_type,payload,status,attempts,tenant_id; poll = status+attempts only) — plan-envelope fields must not be 'added' twice; decide populate-dormant-columns vs payload-carried
- Two overlapping unique dedupe indexes exist on domain_events(dedupe_key): idx_domain_events_dedupe (20260623143000) and idx_domain_events_dedupe_key (20260811132100) — error-message matching in isDedupeUniqueViolation greps only the latter's name
- communication-event-coverage.test.js gate: every COMMUNICATION_EVENT_TYPES entry must have a literal emitter under backend/services|routes — service.* notification events (plan 15.4) must add emitter+subscription together or CI fails

**Must reuse (do not duplicate)** (13)
- emitDomainEvent(pgClient,...) in backend/services/eventBus/eventBusService.js — the ONLY app-side durable emit path; pass the transaction's pg client for atomic emit (plan sec 8 'preferably transactionally')
- DB-side transactional emit pattern — INSERT INTO domain_events inside the mutating RPC/trigger (database/migrations/20260819121000_issue164_phase6_atomic_session_actions.sql, 20260811132100 marketplace trigger); service case RPCs should emit the same way
- eventWorker.subscribe + registerDomainListeners/registerCommunicationListeners wiring in backend/server.js:355-357 — add a registerServiceNetworkListeners there; NEVER a second poller (singleton eventWorker, FOR UPDATE SKIP LOCKED already multi-worker safe)
- pg_cron→pg_net→/api/internal/events/process drain (20260809120000 + backend/routes/communicationRoutes.js:26-100 requireWorkerSecret) — service events ride the existing minute drain; no new cron, no vercel.json cron (backend/vercel.json is {})
- Dead-letter + replay: MAX_OUTBOX_ATTEMPTS/dead_letter status/reprocessDeadLetters() in eventWorker.js — do not invent a service-specific retry ladder
- Idempotency stack: dedupe_key + idx_domain_events_dedupe_key + communication_domain_event_dedupe_key() trigger + (post-#194) DETERMINISTIC_EVENT_IDENTITY_FIELDS — register service.* deterministic identities in both, with a parity test like email-hardening-c3-trust-event-idempotency.test.js
- COMMUNICATION_EVENT_TYPES + orchestrator.handleDomainEvent (backend/services/communication/communicationEventListeners.js) for plan 15.4 service notifications — subscription list is gated by communication-event-coverage.test.js (emitter must exist)
- notification_queue.dedupe_key uniqueness (20260817180000) keyed on outbox event_id — downstream one-event-one-notification; always forward the raw outbox record (4th handler arg)
- Consumer-side idempotency exemplar for any service projection: trade_graph_processed_events + trade_graph_projection_checkpoints + makeProjectionSubscriber (backend/services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js)
- Payload minimization precedent (20260716033000) for plan sec 8 no-PII rule — identifiers + controlled hints only
- Correlation context: asyncStore.run({correlationId, tenantId}) around handlers (eventWorker.processEvent) + metricsHub outbox metrics (backend/services/metrics.js:67-76) — free observability if events go through the worker
- memoryBroker / publishMemoryEvent for realtime-only fanout and outbox:<type> settlement signals — not a durability substitute
- Passport history channel stays blockchainService.addEvent (blockchain_events) — service completion facts that must appear in Passport go through that authority, not via a duplicate ledger

**PR #194 delta** (9)
- backend/services/eventBus/eventBusService.js — replaces marketplace-only idempotency with exported deterministicEventIdentity() + frozen DETERMINISTIC_EVENT_IDENTITY_FIELDS registry {marketplace.inquiry.created, vehicle.trust.presentation_changed, user.email.verified}; duplicate recovery now looks up by dedupe_key for new types (marketplace keeps payload-contains lookup for historical NULL-key rows)
- backend/services/communication/communicationEventListeners.js — COMMUNICATION_EVENT_TYPES grows by 16: ten MARKETPLACE_* stage/outcome events (finally subscribing the issue164 RPC emissions), vehicle.trust.presentation_changed, four vehicle.ownership.transfer_* events, user.email.verified
- database/migrations/20260826120000_email_1_0_hardening.sql (A) — CREATE OR REPLACE communication_domain_event_dedupe_key() adding user.email.verified:<recipient> + trust-presentation dedupe branches; adds communication_reconciliation_work table + enqueue triggers on users/vehicles (sweep lane recovering missed event emissions); REVOKE/grant hygiene on trigger functions
- database/migrations/20260828203000_passport_ownership_transfer_authority.sql (A) — vehicle_ownership_transfer_events per-aggregate append-only event table (indexed transfer_id, created_at, id) + transfer RPCs emit vehicle.ownership.transfer_* into domain_events transactionally
- database/migrations/20260828220000_passport_ownership_transfer_communications.sql (A) — notification wiring for the transfer events
- New emitters: user.email.verified (EMAIL_VERIFIED_EVENT constant; verification route now writes durable outbox event instead of inline welcome send) and vehicle.trust.presentation_changed (TRUST_PRESENTATION_CHANGED_EVENT, emitted with pgClient, fingerprint-idempotent)
- backend/tests/email-hardening-c3-trust-event-idempotency.test.js, email-hardening-durability-scheduler.test.js, email-hardening-r1-welcome-durability.test.js (A) — pin the JS identity registry to the SQL dedupe function (both reference 20260826120000_email_1_0_hardening.sql) and drive POST /api/internal/communications/process as the production entry point
- docs/intelligence/receipts/i0-appendices/C-event-emission-inventory.md (A) — written inventory of event emission across the codebase
- eventWorker.js itself is UNTOUCHED by #194 (name-status shows only eventBusService.js modified under eventBus/)

**Notes:** Transport summary Service Network must target: write-side emitDomainEvent(pgClient, type, payload, tenantId) with the caller's pg client for transactional emit (or DB-side INSERT INTO domain_events inside RPCs/triggers, the pattern issue164 and PR #194 passport transfers use); read-side eventWorker.subscribe(type, handler(payload, pgClient, tenantId, rawEvent)) registered at server.js:355-357; delivery is at-least-once, globally created_at-ordered batches of 10 under FOR UPDATE SKIP LOCKED, 5 attempts then dead_letter with operator replay; deployed drain is pg_cron→pg_net→/api/internal/events/process each minute. Plan sec 8 read fully: its envelope (event id/type/service_case_id/vin/garage_tenant_id/work_order_id/actor_user_id/occurred_at) maps cleanly onto the DORMANT omnichannel columns (aggregate_id, correlation_id, available_at...) — activating those columns in emitDomainEvent is the lowest-conflict way to satisfy it, but that touches the exact file PR #194 rewrites, so S0 must sequence after #194 or cherry-pick its registry. PR #194 is the closest prior art for the whole plan-sec-8 shape: transactional DB-side emit + deterministic dedupe identity + subscription + reconciliation sweep (communication_reconciliation_work) for missed emissions; vehicle_ownership_transfer_events (per-aggregate append-only, ordered by id) is its answer to ordering — service_case events likely need the same per-case event table alongside broadcast domain_events. All claims grounded in files opened/grepped in /Users/shadreckmusarurwa/Project AI/carup-service-network and the pr194.diff.

### Domain: migrations-tests

**Files** (18)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/db/migrationParser.js — SINGLE canonical migration parser; fail-loud MigrationIntegrityError codes (MISSING_UP_MARKER, EMPTY_UP_SECTION, DOWN_BEFORE_UP, DUPLICATE_UP/DOWN_MARKER, NON_MIGRATION_FILE, AMBIGUOUS_VERSION, PROVENANCE_PIN_BROKEN, RETIRED_MIGRATION); version = FULL filename, not timestamp prefix
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/db/migrate.js — LOCAL SQLite-only runner (backend/db/carup.db, table schema_migrations); never touches Postgres; canonical PG ledger is supabase_migrations.schema_migrations
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/db/supabase.js — service_role supabase-js client; module-scope dotenv.config() is the env inheritance vector for the whole backend suite; applies testDatabaseContainment
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/db/testDatabaseContainment.js — Issue #164 Phase 8 guard: strips production DB creds inherited from a dev machine's .env when NODE_ENV=test
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/tests/helpers/mockSupabase.js — shared in-memory supabase-js builder mock (32 test files import it); UNIQUE_INDEXES registry makes 23505 races testable; supports rpc impls + fault injection
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/tests/migration-integrity.test.js — globs ALL database/migrations/*.sql and enforces the marker contract repo-wide (>100 files sanity floor)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/database/test/migration_pglite_check.mjs — PGlite (PG17 WASM) Up→Down-reverse→re-Up chain over an EXPLICIT NEW_MIGRATIONS list (ends 20260810120000_trust_side_convergence.sql); Supabase-compat bootstrap (roles, auth.uid stub, prerequisite tables)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/.github/workflows/ci.yml — the PR-gating validate job; single source of the backend test env contract
- /Users/shadreckmusarurwa/Project AI/carup-service-network/scripts/lint-baseline-gate.mjs — lints base AND head, fails only on net-new path::ruleId::severity counts (main carries lint debt)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/scripts/cr1-secret-scan.mjs — BLOCKING credential scan (matches eyJ-style JWTs; use goldenTestTokens.mjs runtime-built fixtures instead of literals)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/tests/realpg/README.md — 5 standalone embedded-postgres proofs (FOR UPDATE SKIP LOCKED concurrency, 27-table ACL, RLS); NOT in CI, own package.json (embedded-postgres + pg)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/playwright.config.ts — testDir tests/agents (32 specs), testIgnore diaspora-staging-browser, webServer localhost:5173
- /Users/shadreckmusarurwa/Project AI/carup-service-network/playwright.staging.config.ts — deployed-staging acceptance (specs 32-37) with STAGING_EXPECTED_BUNDLE hash pinning so acceptance can never run against a stale deploy
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/playwright.config.ts — separate web/e2e suite (PLAYWRIGHT_BASE_URL or localhost:5173)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/vite.config.ts — vitest config: jsdom, globals, setupFiles ./src/test/setup.ts, excludes e2e/**; 104 web unit test files
- /Users/shadreckmusarurwa/Project AI/carup-service-network/web/src/test/setup.ts — jest-dom, crypto.randomUUID polyfill, act()-warning suppression
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/tests/helpers/goldenTestTokens.mjs — runtime-built unsigned JWT fixtures that survive the CR-1 scanner
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/tests/helpers/ — also diasporaRpcReference.js, schedulerRpcModel.js, googleDriveFixtures.js etc. (RPC reference models mirrored from SQL)

**Tables** (3)
- supabase_migrations.schema_migrations — the ONLY canonical Postgres migration ledger; never public.schema_migrations (migration-integrity.test.js asserts the runner never references that name)
- schema_migrations (SQLite, backend/db/carup.db) — local dev ledger of backend/db/migrate.js; not Postgres
- database/migrations/ — 141 files; supabase_schema.sql is an enumerated NON_MIGRATION_FILE; provenance-pinned unmarked files (e.g. 20260619201406_production_access_containment.sql) are sha256-pinned and must NEVER be edited or marker-repaired; 009_phase4_schema.sql is RETIRED_UNAPPLIABLE

**Services** (3)
- backend/db/migrationParser.js — exports parseMigrationSource, assertDeterministicVersions, deriveVersion, findTimestampPrefixCollisions, isNonMigrationFile/isProvenancePinned/isRetiredMigration + the frozen exemption registries (NON_MIGRATION_FILES, KNOWN_TIMESTAMP_PREFIX_COLLISIONS, PROVENANCE_PINNED_UNMARKED, RETIRED_UNAPPLIABLE)
- backend/tests/helpers/mockSupabase.js — createMockSupabase(seed, {rpc, faults}); the mock enforces only registered UNIQUE_INDEXES, so dedupe/idempotency paths are untestable until the new index is registered there
- database/test/*.mjs — 20 files: migration_pglite_check + 5 issue101 chain proofs (p0_hardening, parity, parity_then_p0_chain, public_keys_transition, post_cutover_certifier) + 11 diaspora_*_check (CI-globbed) + communications_2_provider_binding_check, mobile_certification_migration_check, referral_v1_lead_idempotency_migration_check (MANUAL-ONLY: referenced by no workflow and no wrapper test)

**RLS/policies** (1)
- No RLS policies owned by this domain; RLS proof PATTERN lives in database/test PGlite harnesses (SET ROLE anon/authenticated/service_role + has_*_privilege asserts) and backend/tests/realpg/* — plan 24.6 requires this for every new Service Network table

**Migrations** (6)
- Marker contract (verified by sampling 20260817120000, 20260819100000, 20260825090000 and PR #194's 5 sampled adds — all carry it): '-- +migrate Up' required, non-empty Up, at most one optional '-- +migrate Down' after Up; inline marker text in SQL literals is safe
- Filename contract: YYYYMMDDHHMMSS_snake_name.sql; version = full filename; a NEW timestamp-prefix collision fails migration-integrity unless added to KNOWN_TIMESTAMP_PREFIX_COLLISIONS (don't — pick a distinct timestamp)
- database/test/migration_pglite_check.mjs — its NEW_MIGRATIONS chain is FROZEN at the M1-M6 lineage through 20260810120000_trust_side_convergence.sql; migrations added since (incl. all 14 in PR #194) are NOT in it and instead prove themselves via dedicated PGlite-backed backend/tests/*.test.js wrappers
- 20260808150000_mechanic_work_orders_convergence.sql — in the PGlite chain; proves convergence over the divergent legacy 006_domain1.sql mechanic_work_orders/mechanic_parts shape (directly relevant to Service Network S4)
- PR #194 adds 14 migrations 20260826120000..20260829020000 (email_1_0_hardening, 4x intelligence, 3x global_vehicle_taxonomy, seller_s3_location_visibility, 2x passport_ownership_transfer, 3x issue158 custody) — Service Network timestamps must sort AFTER 20260829020000 (and after the in-flight 20260829040000_issue158_terminal_event_uniqueness on the #194 lane) to avoid prefix collisions
- Staging application pattern: dedicated workflow_dispatch gate per programme with immutable CANDIDATE_SHA env pin + branch assert + preflight-in-rollback-only-transaction → apply → verify (publication-gate-staging-migrations.yml on main; seller-s0/s3 gates in #194); add a SIBLING gate for Service Network, never mutate a certified one

**Tests** (11)
- backend/tests/migration-integrity.test.js — locks the marker/parse/version/provenance-pin/retired contract over EVERY *.sql in database/migrations (auto-glob: a new well-formed migration needs no registration to be parse-gated)
- backend/tests — 296 *.test.js files run as one glob: node --test backend/tests/*.test.js (ci.yml step 'Backend tests'); most use the in-memory mock, some boot PGlite inline (issue164-phase6-*-postgres, trust-side-convergence, issue-101-p0-hardening)
- database/test/migration_pglite_check.mjs — locks Up/Down/re-Up idempotency + catalog shape for the M1-M6 lineage against real PG semantics
- database/test/issue101_*.mjs (5 files, each an explicit ci.yml step so none can be silently dropped) — locks anon/authenticated denial, TRUNCATE removal, security_invoker views, staging parity, public_keys transition, post-cutover certifier self-falsification
- ci.yml diaspora glob step — runs all database/test/diaspora_*_check.mjs (currently 11); ZERO matches is an explicit failure; keeps going past one failure then fails once
- backend/tests/realpg/*.mjs — manual-only real-Postgres proofs for properties PGlite/mock can't show (two-connection SKIP LOCKED, BYPASSRLS service_role, PG17 MAINTAIN privilege)
- backend/tests/helpers/mockSupabase.js UNIQUE_INDEXES — the registry that makes constraint-race tests honest; mock deliberately mirrors real constraints including their bugs
- web: vitest (104 test files, jsdom) via npm run test:unit --workspace=web — run by referral-ci.yml and navigation-intelligence-ci.yml, NOT by root ci.yml
- Playwright: tests/agents (32 specs, local webServer), web/e2e (marketplace/homepage specs, grown by #194), staging specs 32-37 via playwright.staging.config.ts — none run in root ci.yml; navigation-intelligence-ci.yml runs selected agent specs
- backend/tests/issue164-phase8-test-database-containment.test.js — locks the production-.env containment behaviour
- backend/tests/cr1-credential-guards.test.js — locks the blocking secret-scan contract

**Contract gaps** (7)
- No Service Network test surface exists anywhere: zero service-case/garage-directory/service-link tests in backend/tests, database/test, web/src, tests/agents, web/e2e (only legacy tests/agents/03-garage-mechanic.spec.ts agent-QA)
- Plan §32 Golden A-H E2E journeys have no spec files; plan §33 'Service Network dedicated tests' gate does not exist — a dedicated workflow (pattern: #194's vehicle-passport-foundation-ci.yml) must be created
- Root ci.yml runs NO web vitest, NO Playwright, NO accessibility step — plan §33 requires Playwright/E2E + accessibility, so Service Network must wire these into its own CI lane rather than assume ci.yml covers them
- migration_pglite_check.mjs will NOT exercise new Service Network migrations (frozen explicit list); each new migration needs its own PGlite behavioural proof wired into CI
- mockSupabase.js UNIQUE_INDEXES has no service-network entries — idempotent bridge (plan 10.3) and duplicate-creation defense (plan §25) races are untestable in the mock until indexes are registered
- 3 database/test harnesses (communications_2_provider_binding, mobile_certification, referral_v1_lead_idempotency) run in NO workflow — precedent shows harnesses rot unless CI-wired; don't add a Service Network harness without wiring
- No exact-head certification runner exists for Service Network (plan §33: 'a passing earlier SHA does not certify the final receipt-bearing SHA'); the STAGING_EXPECTED_BUNDLE / CANDIDATE_SHA mechanisms exist but only for other programmes

**Likely conflicts with Service Network** (5)
- Timestamp namespace: PR #194 (unmerged) owns 20260826120000-20260829020000 plus in-flight 20260829040000; Service Network migrations authored against main before #194 merges risk prefix collisions and ordering inversions — pick timestamps after the #194 lane settles
- Naming: 'mechanic_work_orders'/'mechanic_parts' already have a convergence migration (20260808150000) with catalog shape locked by the PGlite chain and trust-side-convergence.test.js — Service Network S4 must extend that shape, not create service_work_orders parallel tables
- Two divergent CI env keys now exist: ci.yml uses test-service-role-key/test-anon-key/test-jwt-secret while #194's vehicle-passport-foundation-ci.yml uses passport-foundation-* values — a Service Network workflow must pick one contract deliberately (tests that hardcode expectations on either will diverge)
- Root package.json 'test' script (lint+build+playwright+agent-15-discovery) is NOT the CI contract — following it instead of ci.yml manufactures phantom failures (matches the backend-suite-env-contract memory: ~33 phantom failures without the ci.yml env)
- migration-integrity forbids editing provenance-pinned/retired migrations — any Service Network 'cleanup' touching 20260619* or 009_phase4_schema.sql breaks PROVENANCE_PIN_BROKEN sha256 checks

**Must reuse (do not duplicate)** (10)
- backend/db/migrationParser.js — parse every Service Network migration through it; never add a second parser (the whole module exists because divergent parsers made one file mean 'do nothing' and 'run everything' simultaneously)
- backend/tests/helpers/mockSupabase.js — extend UNIQUE_INDEXES for new service-network unique constraints instead of writing a new mock
- migration_pglite_check.mjs bootstrap pattern (roles anon/authenticated/service_role, auth.uid() stub, splitMigration Up/Down splitter) — copy for a service_network_migration_check harness
- #194's wrapper-test pattern (backend/tests/email-hardening-reconciliation-privileges.test.js shells out to database/test/email_reconciliation_privilege_check.mjs) — the proven way to get a standalone PGlite harness into the ci.yml backend glob without editing ci.yml
- scripts/lint-baseline-gate.mjs + LINT_BASE_REF — do not attempt a zero-error lint gate; main carries debt by design
- backend/tests/helpers/goldenTestTokens.mjs — runtime-built JWT fixtures; hardcoded eyJ literals fail the blocking cr1-secret-scan
- backend/db/testDatabaseContainment.js — inherited automatically via any import chain reaching backend/db/supabase.js; never bypass it with a direct createClient in tests
- Immutable CANDIDATE_SHA staging-gate workflow pattern (publication-gate-staging-migrations.yml on main; seller-s0-global-taxonomy-staging.yml in #194: pin SHA, assert checkout, preflight in rollback-only txn, apply, verify) for Service Network staging migration application
- playwright.staging.config.ts STAGING_EXPECTED_BUNDLE bundle-hash pinning + backend/scripts/staging-create-test-identities.mjs + tests/agents/staging-helpers.ts signIn for S10 exact-head staging certification
- backend/tests/realpg/ package pattern (embedded-postgres + pg, own package.json) for any Service Network property needing two real connections (e.g. concurrent acceptance races)

**PR #194 delta** (10)
- .github/workflows/vehicle-passport-foundation-ci.yml (A) — new PR-gating job running ~20 EXPLICITLY LISTED node --test files (passport-foundation-contract, v2-v13, v16 x4, partsentry-review-workflow, issue164-phase8-service-timeline-privacy, migration-integrity, issue-158-private-key-custody) with its own env key values (passport-foundation-*)
- .github/workflows/seller-s0-global-taxonomy-staging.yml (A) — immutable-candidate staging gate, CANDIDATE_SHA 7b2506870df4 pinned to feat/marketplace-reliability-reference-ux; preflight/apply/backfill/verify via backend/scripts/seller-s0-taxonomy-*.mjs
- .github/workflows/seller-s3-location-visibility-staging.yml (A) — same gate pattern for the S3 migration (preflight/apply/verify)
- .github/workflows/marketplace-reference-media-staging.yml (A) — staging apply/verify via backend/scripts/marketplace-reference-media-staging.mjs
- .github/workflows/marketplace-reference-regression.yml (A) — marketplace reference regression lane
- database/migrations: 14 added (20260826120000_email_1_0_hardening → 20260829020000_issue158_activation_boundary_hardening); all sampled files carry '-- +migrate Up'; NONE added to migration_pglite_check.mjs NEW_MIGRATIONS
- database/test/email_reconciliation_privilege_check.mjs (A) — new PGlite privilege proof, CI-wired via wrapper backend/tests/email-hardening-reconciliation-privileges.test.js (not via ci.yml edit)
- backend/tests: 107 files touched (mostly A: email-experience-*, email-hardening-*, email-reference-r1-r6, intelligence-*, global-vehicle-taxonomy-*, passport-v9..v16, check-constraint-vocabulary) — all picked up automatically by the ci.yml backend glob
- web/e2e: +marketplace-reference-ux.spec.ts, +marketplace-staging-certification.spec.ts; M homepage.spec.ts, marketplace-v1-flows.spec.ts
- UNTOUCHED by #194: ci.yml, migrationParser.js, migrate.js, mockSupabase.js, migration_pglite_check.mjs, lint-baseline-gate.mjs, root/staging/web playwright configs — the migrations-tests infrastructure itself is stable

**Notes:** Commands a Service Network phase must keep green (the ci.yml validate contract, run with env NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true): 1) node scripts/lint-baseline-gate.mjs (LINT_BASE_REF=origin/main; blocking on net-new errors AND warnings); 2) npx tsc --noEmit --project web/tsconfig.app.json; 3) npm run build; 4) node --test backend/tests/*.test.js; 5) node database/test/migration_pglite_check.mjs; 6) the five explicit issue101 harnesses (issue101_p0_hardening_check, issue101_parity_check, issue101_parity_then_p0_chain, issue101_public_keys_transition_check, issue101_post_cutover_certifier_check); 7) the database/test/diaspora_*_check.mjs glob (11 files, zero-match fails); 8) node scripts/cr1-secret-scan.mjs (blocking, in secret-scan job); plus after #194 merges, the vehicle-passport-foundation-ci.yml explicit list including node --test backend/tests/migration-integrity.test.js. Registering a NEW table/migration to satisfy migration-integrity: drop database/migrations/<distinct-timestamp>_<name>.sql with a single '-- +migrate Up', non-empty Up SQL, optional single '-- +migrate Down' AFTER Up — the integrity suite auto-globs it; no list edit needed unless you (wrongly) reuse a timestamp (KNOWN_TIMESTAMP_PREFIX_COLLISIONS), add a non-executable file (NON_MIGRATION_FILES), or touch pinned/retired files (forbidden). For real-PG behavioural proof, add a database/test harness and CI-wire it via a backend/tests wrapper .test.js (the #194 pattern) or an explicit workflow step; also register any new unique constraints in mockSupabase.js UNIQUE_INDEXES so backend idempotency tests can observe 23505. Staging application goes through a NEW sibling immutable-CANDIDATE_SHA workflow, never a mutated certified gate. apis/events are empty because this domain owns no HTTP surface or event emitters.

### Domain: pr194-cross

**Files** (35)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/eventBus/eventBusService.js — outbox emitter; #194 generalizes idempotent recovery via DETERMINISTIC_EVENT_IDENTITY_FIELDS + dedupe_key
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/communicationEventListeners.js — domain-event→notification subscription table; #194 adds ownership/trust/email-verified subscriptions
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/adapters/safeTradeDomainEventAdapter.js — NEW: single dialect-normalization + recipient-resolution boundary (pattern for a future service adapter)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/reconcileCommunicationDurability.js — NEW: drains trigger-fed communication_reconciliation_work queue; recovery is scheduled, never inferred
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/communication/emailExperience/ — NEW ~20 modules: canonical renderer, template registry, sender persona, recipient resolution, R1–R6 reference emails
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/intelligence/activityEventTypes.js — NEW: closed event taxonomy, client/server emitter split, per-type metadata allowlist
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/intelligence/activityLedgerService.js — NEW: governed ingestion into marketplace_activity_events (server derives identity/tenant, drops client-supplied)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/intelligence/serviceIntelligenceService.js — NEW: I9 mechanic(person)/garage(tenant) projections over mechanic_work_orders + garage_service_request inquiries; explicit NOT_MEASURABLE registry
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/intelligence/intelligenceProjectionService.js — NEW: AVAILABILITY/metric/rate/AuthorizationError shared projection helpers
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/intelligence/rollupService.js — NEW: daily rollup computation + readAllPages
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/intelligenceActivityRoutes.js — NEW: public bounded ingestion + admin ingestion-health
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/intelligenceProjectionRoutes.js — NEW: 18 role-gated projection endpoints incl. /api/mechanic/analytics and /api/garage/analytics
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/intelligenceRollupRoutes.js — NEW: internal rollup trigger + admin freshness
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/routes/passportOwnershipTransferRoutes.js — NEW: session-only transfer begin/transition/read with mandatory idempotency key
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/passport/passportOwnershipTransferService.js — NEW: beginOwnershipTransfer/transitionOwnershipTransfer/getOwnershipTransfer over atomic RPCs
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/passport/passportTransferStateMachine.js — NEW: V7 transfer state graph
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/passport/passportServicePartsProjection.js — NEW: V8 service/parts projection authority — projectWorkOrderServiceRecord whitelist + SERVICE_AUTHORITIES vocabulary
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/passport/passportCommunicationIntent.js — NEW: 8 communication-intent classes incl. service_maintenance + ownership_transfer; forbids transport keys in payloads
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/passport/passportContract.js — NEW: PASSPORT_AUDIENCES public/buyer/owner + visibility whitelist matrix
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/trustDecision/trustPresentationChangeProducer.js — NEW: R5 announce-after-write producer; refreshCanonicalTrust stays the ONE trust writer
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/trustDecision/canonicalTrustService.js — MODIFIED: refreshCanonicalTrust now reads previous record, announces presentation change, returns presentation field
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplaceInquiryService.js — MODIFIED: metadata allowlist widened (buyer_intent/safepay_requested/fitment_*), Intelligence observation on create
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplaceListingEligibility.js — MODIFIED: year bounds now from taxonomy vehicleYearBounds(), MIN_LISTING_YEAR constant removed
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/marketplace/marketplacePartsService.js — MODIFIED: part fitment claim vocabulary (taxonomy-versioned, no VIN/PII)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/taxonomy/vehicleTaxonomyService.js — NEW: resolves make/model/color/fuel/transmission/drivetrain/bodyStyle/year against shared catalog
- /Users/shadreckmusarurwa/Project AI/carup-service-network/shared/taxonomy/vehicle/catalog.json — NEW: carup-vehicle-taxonomy-1.0.0 canonical catalog (backend + web + mobile consume)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/blockchain/blockchainKeyCustodyService.js — NEW: HMAC-derived signing keys from CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET; custody generation commitment; no persisted private keys
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/blockchain/blockchainService.js — MODIFIED heavily (and still uncommitted edits in PR worktree): custody-generation-gated signing, DB-owned monotonic activation boundary
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/services/report/canonicalVehicleLifecycleService.js — NEW: the ONE public vehicle-lifecycle read model injected into vehiclesRoutes
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/utils/checkConstraintVocabulary.js — NEW: audits DB CHECK vocabularies against code expectations
- /Users/shadreckmusarurwa/Project AI/carup-service-network/backend/server.js — MODIFIED: mounts 4 new routers + taxonomy normalization + lifecycle builder
- /Users/shadreckmusarurwa/Project AI/carup-kimi/database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql — UNTRACKED in PR worktree only: terminal ledger uniqueness + recoverable terminal activation (not on branch head, not in pr194.diff)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md — the frozen registry plan §19.3 requires S0 to reconcile (records mechanic_work_orders = 0 rows in staging)
- /Users/shadreckmusarurwa/Project AI/carup-service-network/docs/vehicle-passport-lifecycle/receipts/V7_OWNERSHIP_TRANSFER_CERTIFICATION.md — transfer contract certification receipt
- /Users/shadreckmusarurwa/Project AI/carup-service-network/docs/security/PREEXISTING_USERS_TABLE_WRITE_PRIVILEGE.md — records staging anon/authenticated UPDATE grant on public.users (why public-table flags were rejected)

**Tables** (16)
- vehicle_ownership_transfers — governed transfer state machine; 9-state CHECK, unique active-per-VIN partial index, unique idempotency_key, version; 20260828203000
- vehicle_ownership_transfer_events — append-only transition audit (from_state/to_state/actor/payload); 20260828203000
- vehicle_ownership_history — gains transfer_id FK + unique partial index (one history row per transfer); 20260828203000
- marketplace_activity_events — single analytical observation ledger; unique idempotency_key, privacy_class, exclusion_flags, internal-only identity columns; 20260827120000
- listing_daily_metrics / seller_daily_metrics / tenant_daily_metrics / platform_daily_metrics — versioned derived rollups, never product-written; 20260827130000
- intelligence_rollup_runs — rollup run/freshness bookkeeping; 20260827130000
- intelligence_recommendation_state — seen/acted/dismissed suppression by rule+subject+evidence fingerprint; 20260828120000
- communication_reconciliation_work — service-only durable work queue, UNIQUE(work_type, subject_id), trigger-populated; 20260826120000
- domain_events — gains dedupe_key via trigger communication_domain_event_dedupe_key(); historical rows keep NULL; 20260826120000
- blockchain_custody_rollout — PREPARED/FINALIZED singleton + old_writers_drained + authorized_generation; 20260828210000/20260829003000
- public_keys — gains key_ref/key_version/custody_provider; active-key uniqueness + generation binding; 20260828210000 chain
- vehicles — gains make/model/body_style/fuel/transmission/drivetrain _taxon_id columns (20260828133000), trust_presentation_announced_fingerprint (20260826120000), listing_location_visibility widened to province_only (20260828160000), seller commercial-fact assertion columns with source/recorded_at
- vehicle_taxonomy_observations — governance queue for unresolved seller/import taxonomy values; 20260828133000
- communication_templates / communication_template_versions — gain ownership_transfer_v1 row, business_workflow='vehicle_ownership' (free TEXT column, no CHECK — 'service' value is open); 20260828220000
- mechanic_work_orders — pre-existing on main (006_domain1.sql, 20260808150000_mechanic_work_orders_convergence.sql); the authority I9 Intelligence and V8 Passport projection read; 0 rows in staging per I9 receipt
- marketplace_inquiries — pre-existing inquiry authority; no target-garage field exists (only metadata allowlist widened by #194)

**Services** (21)
- backend/services/eventBus/eventBusService.js — transactional outbox authority; deterministicEventIdentity, emitDomainEvent
- backend/services/communication/communicationOrchestratorService.js (+ factory/repository/listeners) — canonical Communications delivery authority; #194-modified
- backend/services/communication/adapters/safeTradeDomainEventAdapter.js — SafeTrade→Communications normalization boundary
- backend/services/communication/reconcileCommunicationDurability.js — durability reconciliation controller (exports reconcileCommunicationDurability)
- backend/services/communication/emailExperience/renderEmail.js + emailTemplateRegistry.js — canonical email rendering authority
- backend/services/intelligence/activityLedgerService.js — governed ingestion; server-derived identity/tenant
- backend/services/intelligence/serviceIntelligenceService.js — I9 mechanic/garage projections; SERVICE_INTELLIGENCE_VERSION 'service@1', NOT_MEASURABLE
- backend/services/intelligence/intelligenceProjectionService.js — shared authorization/availability/metric helpers
- backend/services/intelligence/rollupService.js — rollup computation; rollupDay/rollupFreshness/readAllPages
- backend/services/intelligence/marketplaceActivityEmitters.js — server-side emit helpers (emitSearchPerformed/emitListingOpened/emitInquiryCreated)
- backend/services/passport/passportOwnershipTransferService.js — beginOwnershipTransfer/transitionOwnershipTransfer/getOwnershipTransfer via atomic RPCs
- backend/services/passport/passportTransferStateMachine.js — V7 transfer state graph authority
- backend/services/passport/passportServicePartsProjection.js — V8 service/parts projection; projectWorkOrderServiceRecord
- backend/services/passport/passportCommunicationIntent.js — PASSPORT_COMMUNICATION_CLASSES incl. service_maintenance
- backend/services/passport/passportReadModelService.js + passportContract.js — assemblePassportReadModel, audience matrix
- backend/services/trustDecision/canonicalTrustService.js — the ONE Trust writer (refreshCanonicalTrust); returns presentation result
- backend/services/trustDecision/trustPresentationChangeProducer.js — emitTrustPresentationChange/reconcileTrustPresentation
- backend/services/marketplace/marketplaceInquiryService.js — createInquiry (inquiry authority incl. garage_service_request type)
- backend/services/taxonomy/vehicleTaxonomyService.js — normalizeVehicleTaxonomyInput, resolveVehicleMake/Model, vehicleYearBounds
- backend/services/blockchain/blockchainKeyCustodyService.js — custodyGeneration, derived signing keys; blockchainService.js consumes (still in flux)
- backend/services/report/canonicalVehicleLifecycleService.js — buildCanonicalVehicleLifecycle single lifecycle read model

**APIs** (13)
- POST /api/vehicles/:vin/ownership-transfers — backend/routes/passportOwnershipTransferRoutes.js, authorizeSessionRole([]) (real session only, x-user-id fallback rejected), x-idempotency-key header required
- GET /api/ownership-transfers/:transferId — backend/routes/passportOwnershipTransferRoutes.js, authorizeSessionRole([])
- PATCH /api/ownership-transfers/:transferId — backend/routes/passportOwnershipTransferRoutes.js, authorizeSessionRole([]); body carries state/reason/registry_authority/completion_reference
- POST /api/intelligence/activity — backend/routes/intelligenceActivityRoutes.js, rateLimiter + optionalAuth() (public bounded ingestion; server-emitted types rejected from clients)
- GET /api/admin/intelligence/ingestion-health — backend/routes/intelligenceActivityRoutes.js, authorizeRole(['admin'])
- POST /api/internal/intelligence/rollup — backend/routes/intelligenceRollupRoutes.js, optionalAuth + internal authorization checks
- GET /api/admin/intelligence/rollup-status — backend/routes/intelligenceRollupRoutes.js, authorizeRole(['admin'])
- GET /api/mechanic/analytics — backend/routes/intelligenceProjectionRoutes.js, authorizeRole(['mechanic','admin']) — I9 practitioner-scope projection
- GET /api/garage/analytics — backend/routes/intelligenceProjectionRoutes.js, authorizeRole(['mechanic','dealer','admin']) — I9 tenant-scope projection (refused when no verified tenant; never narrows to caller)
- GET /api/marketplace/my-listings/:vin/analytics, /api/marketplace/my-analytics, /api/dealer/analytics — intelligenceProjectionRoutes.js, authorizeRole role-scoped
- GET /api/admin/marketplace/intelligence, /api/government/intelligence, /api/insurance/demand-intelligence, /api/finance/demand-intelligence, /api/parts/intelligence, /api/trade/intelligence — intelligenceProjectionRoutes.js, role-gated
- GET /api/intelligence/kpi-catalogue, /api/intelligence/assistant-context, /api/marketplace/my-recommendations, /api/marketplace/my-report — intelligenceProjectionRoutes.js
- Marketplace search/detail/save/inquiry routes in backend/routes/marketplaceRoutes.js — now thread { req } into services for fire-and-forget Intelligence observation (signatures changed)

**Events** (9)
- vehicle.ownership.transfer_started / _action_required / _state_changed / _completed — produced via passport transfer service + passportCommunicationIntent, durable in domain_events outbox; newly SUBSCRIBED by communicationEventListeners.js (first subscription ever)
- vehicle.trust.presentation_changed — emitter backend/services/trustDecision/trustPresentationChangeProducer.js (runs inside refreshCanonicalTrust after the one canonical write); deterministic identity presentation_fingerprint; consumer communicationEventListeners (R5 email)
- user.email.verified — emitter backend/services/communication/producers/leadershipWelcomeProducer.js; deterministic identity recipientUserId (one welcome per account); consumer communicationEventListeners (R1)
- MARKETPLACE_PAYMENT_INITIATED, MARKETPLACE_FUNDS_HELD, MARKETPLACE_TRANSACTION_SETTLED + 7 more SafeTrade types — emitted by issue164 SQL atomics (payload has NO principal); backend/services/communication/adapters/safeTradeDomainEventAdapter.js is the single normalization boundary that looks up the recipient and canonical status from the session
- marketplace.inquiry.created — backend/services/marketplace/marketplaceInquiryService.js via emitDomainEvent; deterministic identity inquiryId/inquiry_id (legacy payload-contains lookup preserved for pre-dedupe rows)
- domain_events.dedupe_key — trigger communication_domain_event_dedupe_key() (20260826120000) stamps '<eventType>:<value>'; eventBusService recovers 23505 collisions by key; format pinned by test
- marketplace_activity_events taxonomy (23 types, schema_version 1) — CLIENT_EMITTED (impression/engaged/compare/contact/share/process_step) vs SERVER_EMITTED (search/opened/saved/inquiry_created/reservation/price_changed/listing lifecycle) in activityEventTypes.js; transport is the ledger TABLE, not domain_events
- RESERVED_EVENT_TYPES — marketplace_listing_paused/_archived, reservation_closed, listing_paid, purchase_confirmed, recommendation_served/_clicked declared reserved, gated on gap G10
- NO service.* domain events exist anywhere in #194 or main — plan §8 namespace (service.case.*, service.work_order.*, service.mechanic.*, service.work.*) is entirely unclaimed

**RLS/policies** (8)
- marketplace_activity_events — ENABLE + FORCE ROW LEVEL SECURITY, REVOKE ALL from anon/authenticated/PUBLIC, GRANT service_role only (20260827120000)
- listing/seller/tenant/platform_daily_metrics + intelligence_rollup_runs — same service_role-only pattern (20260827130000, hardened in 20260827140000)
- vehicle_ownership_transfers — RLS enabled, REVOKE anon/authenticated, GRANT service_role SELECT/INSERT/UPDATE (no DELETE — transfers are never erased) (20260828203000)
- vehicle_ownership_transfer_events — RLS enabled, service_role SELECT/INSERT only (append-only audit) (20260828203000)
- vehicle_taxonomy_observations — RLS enabled + explicit REVOKE from anon/authenticated: governance queue is not a public PostgREST surface (20260828133000)
- communication_reconciliation_work — RLS on + FORCE, every client privilege revoked; rows written only by DB triggers in-transaction (20260826120000)
- blockchain_custody_rollout — private DB control plane; runtime reads only via SECURITY DEFINER scalar blockchain_custody_rollout_state (20260828210000)
- Documented hazard: docs/security/PREEXISTING_USERS_TABLE_WRITE_PRIVILEGE.md — live staging grants anon/authenticated table-level UPDATE on public.users, which is why #194 rejected public-table boolean flags; Service Network tables must ship the REVOKE+FORCE pattern from day one

**Migrations** (16)
- database/migrations/20260826120000_email_1_0_hardening.sql — domain_events dedupe trigger (communication_domain_event_dedupe_key), communication_reconciliation_work + users/vehicles enqueue triggers, vehicles.trust_presentation_announced_fingerprint, email_reply_tokens v2 default
- database/migrations/20260827120000_intelligence_activity_ledger.sql — marketplace_activity_events observation ledger; FORCE RLS, service_role-only, unique idempotency_key, privacy classes, 24-month retention SQL
- database/migrations/20260827130000_intelligence_rollups.sql — listing/seller/tenant/platform_daily_metrics + intelligence_rollup_runs; derived, calculation_version-stamped, never product-written
- database/migrations/20260827140000_intelligence_post_review_hardening.sql — post-review ACL/constraint hardening for the ledger/rollups
- database/migrations/20260828120000_intelligence_recommendations.sql — intelligence_recommendation_state: suppression fingerprints only, never recommendation content
- database/migrations/20260828133000_global_vehicle_taxonomy_s0.sql — vehicles *_taxon_id columns + indexes + vehicle_taxonomy_observations governance queue (RLS + revoked); additive, raw values untouched
- database/migrations/20260828140000_global_vehicle_taxonomy_imports_s0.sql — taxonomy resolution for import pipelines
- database/migrations/20260828143000_global_vehicle_taxonomy_color_s0.sql — color dimension addition
- database/migrations/20260828160000_seller_s3_location_visibility_province_only.sql — widens vehicles.listing_location_visibility CHECK to public|withheld|province_only; pre/post digest guard proves no seller data rewritten
- database/migrations/20260828203000_passport_ownership_transfer_authority.sql — vehicle_ownership_transfers (9-state machine, unique active-per-VIN, idempotency), vehicle_ownership_transfer_events, vehicle_ownership_history.transfer_id, passport_begin/transition_ownership_transfer_atomic SECURITY DEFINER RPCs
- database/migrations/20260828210000_issue158_private_key_custody.sql — public_keys custody columns (key_ref/key_version/custody_provider) + blockchain_custody_rollout PREPARED singleton; destructive erase deferred to protected finalizer
- database/migrations/20260828220000_passport_ownership_transfer_communications.sql — ownership_transfer_v1 template under business_workflow='vehicle_ownership'; transactional + in-app only by policy
- database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql — NEW identity on purpose: generation authority upgrade for databases that recorded the monolithic 210000
- database/migrations/20260829020000_issue158_activation_boundary_hardening.sql — DB-owned per-stakeholder monotonic watermark; rotation boundary partitions key validity half-open [created_at, revoked_at) (still receiving uncommitted edits in PR worktree)
- database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql — UNCOMMITTED (PR worktree only): at-most-one terminal ledger event per signer + recoverable terminal re-issue; not on branch head
- database/scripts/issue158_mark_old_writers_drained.sql + issue158_private_key_custody_finalize.sql — manual protected custody finalization steps, not yet executed

**Tests** (19)
- backend/tests/passport-v16-ownership-authority.test.js — locks governed transfer authority (seller retirement on completion, no post-completion cancel)
- backend/tests/passport-v16-postgres-authorities.test.js — PG-level transfer + custody authority contract (still receiving uncommitted edits in PR worktree)
- backend/tests/passport-v7-ownership-transfer.test.js — V7 transfer state machine contract
- backend/tests/passport-v8-service-parts.test.js — V8 whitelist projection of work orders (free text/customer identity never projected)
- backend/tests/passport-v16-golden-lifecycle.test.js — end-to-end golden vehicle lifecycle certification
- backend/tests/intelligence-activity-ledger.test.js — pins JS taxonomy == DB CHECK == I1 receipt three ways
- backend/tests/intelligence-service-mechanic-garage.test.js — locks I9 mechanic-never-widens / garage-never-narrows + not-measurable registry
- backend/tests/intelligence-rollup-route-auth.test.js — rollup endpoint authorization
- backend/tests/intelligence-schema-contract.test.js — intelligence schema contract
- backend/tests/communication-event-coverage.test.js — every domain event must be mapped or explicitly excluded for Communications (gate for new service.* events)
- backend/tests/email-hardening-durability-scheduler.test.js — reconciliation queue drain + fault isolation semantics
- backend/tests/email-hardening-c3-trust-event-idempotency.test.js — trust presentation event dedupe
- backend/tests/issue-158-private-key-custody.test.js + issue-158-boundary-upgrade-postgres.test.js + issue-158-rotation-boundary.test.js — custody rollout/watermark/terminal-boundary contract (first two modified uncommitted in worktree)
- backend/tests/global-vehicle-taxonomy.test.js + -antifork + global-taxonomy-marketplace-filter — taxonomy resolution, anti-fork, marketplace filter binding
- backend/tests/marketplace-listing-eligibility.test.js — taxonomy-driven year bounds
- backend/tests/check-constraint-vocabulary.test.js — DB CHECK vocabularies pinned to code (any new service CHECK vocab must register)
- backend/tests/public-truth-hardening.test.js — buyer-safe public projection lock
- backend/tests/passport-v12-communications.test.js — passport communication intent contract (incl. transfer_action_required mapping)
- backend/tests/seller-location-province-only.test.js — S3 three-value visibility vocabulary

**Contract gaps** (10)
- issue158 custody chain is visibly STILL IN FLUX inside #194: database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql exists only as an UNTRACKED file in the PR worktree (/Users/shadreckmusarurwa/Project AI/carup-kimi), alongside uncommitted modifications to blockchainService.js, issue-158-boundary-upgrade-postgres.test.js, issue-158-private-key-custody.test.js, passport-v16-postgres-authorities.test.js, the 20260829020000 migration and issue158_private_key_custody_finalize.sql — branch head 24422686 does not contain the 4th migration
- pr194.diff snapshot lags origin/integration/vehicle-passport-v16-cert head: zero matches for commit 24422686's terminal-event content — issue158 claims must be re-verified against the branch, not the diff
- Custody FINALIZED state not reached: destructive legacy-key erase lives in manual protected scripts (issue158_mark_old_writers_drained.sql, issue158_private_key_custody_finalize.sql) that have not run; rollout singleton sits PREPARED
- Ownership-transfer notifications are deliberately transactional/in-app only 'until canonical recipient-address enrichment exists for policy-driven notifications' (20260828220000) — the same enrichment gap will constrain Service Network notification channels (§15.3/15.4)
- Every #194 migration (email hardening, intelligence x4, taxonomy x3, seller S3, passport transfer x2, custody x3) is explicitly STAGING-ONLY pending owner production approval — production schema will lack all these tables at S0
- RESERVED_EVENT_TYPES (listing paused/archived, reservation_closed, purchase_confirmed, recommendation events) are declared but gated on gap G10 (vehicles.publication_status lacks those states) — the activity taxonomy is deliberately unfinished
- I9 was certified against an EMPTY authority — the receipt records mechanic_work_orders: 0 rows in staging, one garage_service_request inquiry — so real Service Network facts will materially re-open the mechanic/garage projections and the not-measurable registry
- No 'service' business_workflow value, template, or thread convention exists anywhere in #194 or main (business_workflow is free TEXT, default 'growth'; #194 establishes only 'vehicle_ownership') — plan §15.1 binding is greenfield
- No service.* domain-event namespace exists in domain_events emitters or communicationEventListeners — plan §8 contract entirely unimplemented
- Marketplace inquiry schema still has no target-garage/provider-tenant field (allowlist gained buyer_intent/fitment keys only) — plan §10.2 'smallest truthful additive bridge' remains an open S0 design decision

**Likely conflicts with Service Network** (19)
- backend/server.js — #194 mounts intelligenceActivity/Projection/Rollup + passportOwnershipTransfer routers and injects lifecycleBuilder; Service Network S1–S8 mounts serviceCase routes in the same block
- backend/services/eventBus/eventBusService.js — DETERMINISTIC_EVENT_IDENTITY_FIELDS is a closed registry pinned byte-for-byte to communication_domain_event_dedupe_key() in 20260826120000; adding service.* idempotent events edits both sides
- backend/services/communication/communicationEventListeners.js — #194 rewrote the subscription/policy table (ownership + trust + email events); §15.4 service notification subscriptions land in the same structures
- backend/tests/communication-event-coverage.test.js — modified by #194; every new service.* domain event must be mapped or explicitly excluded there or CI fails
- backend/services/marketplace/marketplaceInquiryService.js — §10.2 target-garage bridge edits createInquiry, which #194 already changed (metadata allowlist widened, emitInquiryCreated added, 4th deps arg { req })
- backend/routes/marketplaceRoutes.js — #194 threaded { req } through search/detail/save/inquiry handlers; garage_service_request routing edits collide
- backend/services/intelligence/serviceIntelligenceService.js — the I9 NOT_MEASURABLE registry lives here and plan §19.3 requires S0 to update it; same-file edits guaranteed
- backend/services/intelligence/activityEventTypes.js — taxonomy is 3-way pinned (JS / DB CHECK in 20260827120000 / I1 receipt) by intelligence-activity-ledger.test.js; adding service telemetry needs a synchronized 3-way change
- backend/services/passport/passportServicePartsProjection.js — plan §11 richer service history extends this exact V8 authority file
- backend/routes/vehiclesRoutes.js — #194 added the canonicalVehicleLifecycleService lifecycle read model + availability-stated collection reads; service-history surfacing converges here
- shared/types/index.ts + shared/types/marketplace.ts — modified by #194; Service Network shared types land in the same files
- web/src/App.tsx + web/src/components/layout/MainLayout.tsx — #194 added public routes (Security/Support/GuestSell) and CompactBottomNav; Garage Directory routes/nav collide
- database/migrations timestamp ordering — #194 occupies 20260826120000–20260829020000 (plus an uncommitted 20260829040000); Service Network migrations must stamp strictly after the final custody migration or replay order breaks
- Naming: /api/garage/analytics exists with roles ['mechanic','dealer','admin'] — consistent with plan §9.2 (no global garage role) but the 'garage' API namespace is now partially claimed by Intelligence
- 'service' namespace already claimed twice in different senses: passportCommunicationIntent class 'service_maintenance' and SERVICE_INTELLIGENCE_VERSION 'service@1'; Service Case vocabulary must not collide
- vehicle_ownership_transfers state vocabulary (initiated/under_review/complete/disputed/cancelled…) overlaps plan §6.2 Service Case status words — keep CHECK vocabularies table-scoped (checkConstraintVocabulary.js now audits these)
- web/vercel.json + web/preview-backend-pairing.json — #194 pins exact-SHA frontend/backend staging pairing (commits a1826911, 0d2dc17a); Service Network staging gates must re-pin, not inherit
- backend/services/communication/communicationOrchestratorService.js — modified by #194; service-workflow orchestration touches the same module
- backend/utils/publicVehicleProjection.js + vehicleMediaProjection.js — modified by #194 and locked by public-truth-hardening.test.js; public service-history projection edits the same guarded files

**Must reuse (do not duplicate)** (20)
- backend/services/eventBus/eventBusService.js emitDomainEvent + deterministicEventIdentity — service.* events go through this outbox; idempotent service events extend DETERMINISTIC_EVENT_IDENTITY_FIELDS in lockstep with the DB dedupe trigger
- backend/services/communication/adapters/safeTradeDomainEventAdapter.js — the adapter PATTERN (single normalization boundary, DB recipient lookup, frozen dialect map) for a service domain-event→notification adapter
- backend/services/communication/communicationEventListeners.js — subscribe service notification events here (§15.4); do not build a second listener
- communication_templates/communication_template_versions INSERT pattern from database/migrations/20260828220000 — service workflow templates ride the existing thread/template model, no new messages table (§15.1)
- backend/services/passport/passportServicePartsProjection.js projectWorkOrderServiceRecord + SERVICE_AUTHORITIES vocabulary — extend this V8 authority for richer service history (§11), never fork it
- backend/services/passport/passportCommunicationIntent.js — 'service_maintenance' class already reserved; reuse the transport-key firewall for service intents
- backend/services/passport/passportContract.js PASSPORT_AUDIENCES/PASSPORT_VISIBILITY — audience whitelist matrix for public/buyer/owner service projections (§11.1)
- backend/services/intelligence/serviceIntelligenceService.js + docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md — plan §19.3 requires updating THIS registry in place; /api/mechanic/analytics and /api/garage/analytics already exist
- backend/services/intelligence/activityEventTypes.js discipline — client/server emitter split + per-type metadata allowlist for any service telemetry; extend the pinned 3-way taxonomy, do not create a parallel ledger
- backend/services/intelligence/rollupService.js readAllPages + intelligenceProjectionService.js AVAILABILITY/metric/rate helpers — for service metrics rollups/projections
- backend/services/taxonomy/vehicleTaxonomyService.js + shared/taxonomy/vehicle/catalog.json — make/model/year resolution for service records and Garage Directory filters; never re-derive vocabularies
- Existing inquiry vocabulary — inquiry_type 'garage_service_request' (recognized on main, plan §10) and SERVICE_INQUIRY_TYPES set; the §10.2 bridge builds on marketplace_inquiries, not a new intake table
- backend/routes/passportOwnershipTransferRoutes.js precedent — authorizeSessionRole([]) (x-user-id fallback rejected) + mandatory x-idempotency-key for every consequential service write
- database/migrations/20260828203000 as the structural template for service_cases — state-machine table + append-only events table + SECURITY DEFINER atomic transition RPC + partial unique index for the single active case (§7, §10.3 idempotent bridge)
- RLS template from #194 migrations — ENABLE+FORCE RLS, REVOKE anon/authenticated/PUBLIC, GRANT service_role, sequence grants — for every new service table
- backend/services/trustDecision/canonicalTrustService.js refreshCanonicalTrust — the ONLY path that may move Trust (§14.2); trustPresentationChangeProducer shows the announce-after-single-write pattern
- backend/services/communication/reconcileCommunicationDurability.js + communication_reconciliation_work — trigger-fed durable recovery pattern for required conversation bindings (§15.5 recoverable receipt, not pretended success)
- backend/middleware/authMiddleware.js — authorizeRole/authorizeSessionRole/optionalAuth factories (optionalAuth is a FACTORY — must be invoked, a #194 route comment records the hang caused by passing it bare)
- backend/services/report/canonicalVehicleLifecycleService.js — the single buyer-safe lifecycle read model; service history must feed it rather than fork a per-surface story
- Migration marker contract — every #194 migration carries '-- +migrate Up', idempotent DDL, and a Down section; new-identity-migration convention (never edit a published file) demonstrated by 20260829003000/20260829020000

**PR #194 delta** (24)
- Communications: backend/services/communication/adapters/safeTradeDomainEventAdapter.js — the single dialect-normalization boundary; resolves recipient from the canonical session because emitter payloads carry no principal; the template for any future service domain-event adapter
- Communications: backend/services/communication/communicationEventListeners.js — first-ever subscriptions for vehicle.ownership.transfer_{started,action_required,state_changed,completed}, vehicle.trust.presentation_changed, user.email.verified
- Communications: database/migrations/20260826120000_email_1_0_hardening.sql — domain_events.dedupe_key trigger + communication_reconciliation_work trigger-fed recovery queue + trust announcement fingerprint column
- Communications: backend/services/communication/reconcileCommunicationDurability.js — scheduled durability reconciler; work rows created by DB triggers in the same transaction as the state change
- Communications: backend/services/communication/emailExperience/* — canonical email renderer/registry/persona/recipient-resolution; R1–R6 reference emails frozen with runtime previews
- Intelligence: database/migrations/20260827120000_intelligence_activity_ledger.sql — marketplace_activity_events single analytical store; identity columns internal-only, server-derived; authority tables explicitly named as un-overridable
- Intelligence: backend/services/intelligence/activityEventTypes.js — closed 23-type taxonomy, CLIENT_EMITTED vs SERVER_EMITTED, per-type metadata allowlist, reserved types gated on G10
- Intelligence: backend/services/intelligence/serviceIntelligenceService.js — I9: mechanic projection never widens to tenant, garage projection never narrows to caller; SERVICE_INQUIRY_TYPES={garage_service_request,mechanic_service_request}; NOT_MEASURABLE registry (bookings, capacity, team/branch performance…) returned with reasons
- Intelligence: backend/routes/intelligenceProjectionRoutes.js — /api/mechanic/analytics + /api/garage/analytics live now; 20260827130000 rollups + 20260828120000 recommendation suppression
- Passport: database/migrations/20260828203000_passport_ownership_transfer_authority.sql — governed transfer writer beneath certified V7: state machine + append-only events + atomic begin/transition RPCs; completion atomically retires seller authority and seals history (commits 80cd6067, f864552f, 89a12da2)
- Passport: backend/routes/passportOwnershipTransferRoutes.js + passportOwnershipTransferService.js — session-only, idempotency-key-mandatory transfer API
- Passport: backend/services/passport/passportServicePartsProjection.js — V8 service/parts projection authority: whitelist projection of mechanic_work_orders, SERVICE_AUTHORITIES={professional_governed,owner_declared,partner_record,unknown}, free text and customer identity never projected
- Passport: backend/services/passport/passportCommunicationIntent.js — communication intents as classes ('service_maintenance' reserved) with transport-key firewall; database/migrations/20260828220000 pins ownership_transfer_v1 template (in-app/transactional only)
- Passport: ownership notifications redact counterparty IDs (commit d4a87e9a) — privacy precedent every service notification must follow
- Trust: backend/services/trustDecision/trustPresentationChangeProducer.js + canonicalTrustService.js — refreshCanonicalTrust remains the ONE trust writer and now announces audience-safe presentation changes post-write with a durable fingerprint marker
- Marketplace: backend/services/marketplace/marketplaceInquiryService.js — metadata allowlist gains buyer_intent/safepay_requested/fitment_* keys; createInquiry emits Intelligence observation via new 4th deps arg
- Marketplace: backend/services/marketplace/marketplaceListingEligibility.js — year bounds sourced from taxonomy catalog (vehicleYearBounds), hardcoded 1980 removed; marketplacePartsService gains taxonomy-versioned fitment claims
- Marketplace: media items gain synthetic_demo flag (marketplaceListingDetailService) + marketplace-reference media fixtures/workflows
- EventBus: backend/services/eventBus/eventBusService.js — deterministicEventIdentity() closed registry {marketplace.inquiry.created, vehicle.trust.presentation_changed, user.email.verified} with dedupe-key 23505 recovery pinned to the DB trigger format
- Seller/taxonomy: shared/taxonomy/vehicle/catalog.json + backend/services/taxonomy/vehicleTaxonomyService.js + 3 S0 migrations — global vehicle taxonomy with vehicles.*_taxon_id, governance observation queue, staging backfill runners
- Seller: database/migrations/20260828160000 — listing_location_visibility gains province_only (privacy widening, digest-guarded no-rewrite)
- issue158: 20260828210000 (prepare: custody columns + PREPARED rollout singleton) → 20260829003000 (generation authority upgrade) → 20260829020000 (DB-owned monotonic activation watermark) + blockchainKeyCustodyService (HMAC-derived keys, master secret env, no persisted private material) + manual drain/finalize scripts
- Server: backend/server.js mounts intelligence x3 + passport transfer routers; vehiclesRoutes gains the canonicalVehicleLifecycleService single lifecycle read model with availability-stated reads (error never collapses to clean-history [])
- Staging: web/preview-backend-pairing.json + vercel.json pin exact frontend SHA to exact backend (commits 0d2dc17a, a1826911) — pairing is proven, not assumed

**Notes:** Branch origin/integration/vehicle-passport-v16-cert is 596 commits ahead of main (ba208963); head 24422686 (2026-08-29 15:03 +0900). The pr194.diff snapshot lags that head (it lacks commit 24422686's terminal-event content), and the PR worktree at /Users/shadreckmusarurwa/Project AI/carup-kimi carries further uncommitted issue158 work including an untracked 4th custody migration — so of the six contract surfaces Service Network waits on, five (Communications/email, Intelligence, Passport ownership transfer, Marketplace instrumentation+reference, Seller taxonomy/S3) are finalized-and-committed with certification receipts, while the issue158 custody chain is the one contract visibly still moving. Everything #194 ships is staging-only by explicit migration policy; production activation is separately owner-gated (plan Invariant 13 holds). The plan's §10/§11/§14/§15/§19 bindings all have concrete, already-landed anchor points listed in reuse; the two genuinely open S0 design questions are the marketplace target-garage bridge field (§10.2) and the 'service' business_workflow + service.* event namespace, both of which are absent from #194 by design rather than in conflict with it.

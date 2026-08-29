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

Reconnaissance runs as 13 parallel read-only domain readers. Status at this commit:

| Domain | Status |
|---|---|
| auth-tenant | ✅ complete (below) |
| garage-mechanic | ✅ complete (below) |
| marketplace | ✅ complete (below) |
| vehicle-ownership | ✅ complete (below) |
| communications | ✅ complete (below) |
| email-whatsapp | ✅ complete (below) |
| passport-evidence | ✅ complete (below) |
| partsentry-workorders | 🔄 re-running (hit session usage limit; resumed 17:13 JST) |
| trust | 🔄 re-running |
| intelligence | 🔄 re-running |
| owner-surfaces | 🔄 re-running |
| events-outbox | 🔄 re-running |
| pr194-cross | 🔄 re-running |

This receipt is committed incrementally so completed evidence is durable; the remaining
domains land as an append-only follow-up commit on this same branch. No S1+ implementation
begins before the S0 authority freeze receipt, which requires all 13 domains.

## 7. Completed domain findings

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

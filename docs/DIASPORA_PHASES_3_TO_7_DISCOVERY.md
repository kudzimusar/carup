# Diaspora Trade OS — Phases 3–7 Discovery Audit

> Authoritative implementation contract: `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`
> Program branch: `claude/diaspora-phases-3-7-program`
> Base: `main` @ `3ac2ff23a60f545bbafed8d4d256277209f3adf9` (Phase 2C merge)

This document records the discovery audit performed before implementation. The headline finding is
that **the Phase 3–7 database tables already exist** (created by the Phase 1B foundation migration),
so the bulk of the remaining work is the **service → route → frontend → test** vertical slices, not
new schema. Additive migrations are used only where a genuine gap is found.

## 1. Confirmed Reusable Surfaces

### Backend conventions
- **Supabase client**: `backend/db/supabase.js` exports a singleton service-role `supabase` client
  (bypasses RLS; server-only). Newer services (e.g. `diasporaWorkbookPersistenceService.js`) accept
  an injectable client via `options.supabaseClient || supabase` — **the pattern new Phase 3–7
  services adopt**, enabling service-level unit tests with a mock client.
- **Auth**: `backend/middleware/authMiddleware.js` → `authorizeRole(allowedRoles = [])`. Sets
  `req.userContext = { id, userId, role, effectiveRole, baseRole, platformRole, tenantRole, tenantId,
  isVerified }`. `platformRole`/`baseRole` are server-derived and never client-spoofable; the
  `x-stakeholder-role` header only sets the *requested* role and cannot escalate.
- **Authorization helpers**: `backend/services/diaspora/diasporaAuthorization.js` provides
  `requireUserContext`, `isPlatformAdmin`, `isPlatformReviewer`, `isTenantAdminForRecord`,
  `isOrderOwner`, `assertCanReadImportOrder`, `canManageLogistics`, etc. Reused across phases.
- **Errors**: `backend/utils/errors.js` → `CarUpError` base + `ValidationError(400)`,
  `UnauthorizedError(401)`, `ForbiddenError(403)`, `NotFoundError(404)`, `DatabaseError(500)`.
  Central handler `backend/middleware/errorMiddleware.js` emits `{ success:false, error:{ code,
  message, timestamp, requestId } }`; success responses use `{ data }`.
- **Audit**: `backend/services/diaspora/diasporaAuditService.js` → `writeDiasporaAudit({ importOrderId,
  actorId, tenantId, action, resourceType, resourceId, previousState, newState, metadata, req })`
  writes a cryptographically sealed row to `diaspora_import_audit_log` (`buildAuditSeal` = SHA-256).
  New services append audit through the **injected client** via a shared helper so audit is testable.
- **Correlation**: `backend/middleware/correlationMiddleware.js` sets `req.requestId` /
  `req.correlationId` from `x-request-id` / `x-correlation-id`.
- **Routing**: `backend/routes/diasporaRoutes.js` is mounted at `/api/diaspora` (server.js:194) and
  sub-mounts feature routers with `router.use(...)` (e.g. `router.use(diasporaWorkbookRouter)`). New
  phase routers follow the same sub-mount pattern.
- **Backend test harness**: `node:test` + `node:assert/strict`. Two patterns exist: (a) HTTP route
  tests that override `supabase.from` via `Object.defineProperty` and drive the real router; (b)
  service-level tests with a mock client (`createMockSupabaseClient`). New phases use **(b)** for
  service logic and `node --test backend/tests/<file>` for focused runs.

### Frontend conventions
- **Pages**: `web/src/pages/diaspora/*`. Phase 2C pages `DiasporaWorkbookDryRun.tsx` and
  `DiasporaWorkbookOperatorConsole.tsx` are the canonical templates: `useAuth()` role-gating against
  an `allowedOperatorRoles` set; `useCarUpApi()` for data; `useState`-driven loading/error/empty;
  `data-testid` everywhere; shadcn UI primitives.
- **API hook**: `web/src/hooks/useCarUpApi.ts` — `request<T>(path, options)` attaches identity
  headers and unwraps `{ data }` in each typed method. Naming: `fetch*`/`create*`/`update*`/`run*`.
- **Types**: `web/src/types/index.ts` — existing `Diaspora*` interfaces; new phase types added here.
- **Feature registry**: `web/src/config/featureRegistry.ts` — `FeatureRegistryItem { id, label, route,
  domain, roles, placements, requiresAuth, icon }`. The route-validation test
  (`featureRegistry.route-validation.test.ts`) requires every active (`!isPlanned && !isHidden`)
  entry's `route` to exist as a `<Route path>` in `App.tsx`, with no duplicate active routes.
- **Routing**: `web/src/App.tsx` declares diaspora routes under `<MainLayout />`; components self-gate.
- **E2E harness**: `web/e2e/*diaspora*` — `loginAs` seeds `localStorage` `carup_user`/`carup_token`
  via `addInitScript`; `fulfillJson` mocks `page.context().route('**/api/...')` with CORS + OPTIONS;
  `/api/auth/me` and `/api/security/csrf-token` are stubbed. Contract assertions inspect POST payloads.
- **UI primitives available**: Button, Badge, Alert, Card, Table, Textarea, Input, Select, Dialog,
  Tabs, Label, Separator, Progress, Skeleton (under `web/src/components/ui/`).

## 2. Schema Findings (tables already present)

From `database/migrations/013_diaspora_trade_schema.sql`,
`014_diaspora_rls_recursion_fix.sql`, and
`20260611061849_diaspora_trade_os_phase1b_foundation.sql`:

| Concept | Table | Status |
| --- | --- | --- |
| Trade profiles | `diaspora_trade_profiles` | exists |
| Import/buyer orders | `diaspora_import_orders` | exists |
| Quotes | `diaspora_import_quotes` | exists (status: DRAFT/ISSUED/ACCEPTED/REJECTED/EXPIRED) |
| Trade documents | `diaspora_trade_documents` (+ extractions/verifications) | exists |
| Containers | `diaspora_container_shipments` (volume capacity cols + CHECKs) | exists |
| Cargo reservations | `diaspora_cargo_reservations` | exists |
| Shipments | `diaspora_shipments` (+ stage events) | exists |
| Compliance | `diaspora_compliance_reviews` | exists |
| Payments | `diaspora_payment_milestones` | exists |
| Reputation | `diaspora_reputation_records` | exists |
| **Stock items** | `diaspora_stock_items` | **exists (Phase 1B)** |
| **Stock ledger** | `diaspora_stock_ledger` | **exists (Phase 1B, audit_lock default true)** |
| **Supply documents** | `diaspora_supply_documents` | **exists (Phase 1B)** |
| **Buyer order documents** | `diaspora_order_documents` | **exists (Phase 1B)** |
| **AI commands** | `diaspora_ai_commands` | **exists (Phase 1B)** |
| **Drive connections** | `diaspora_drive_connections` | **exists (Phase 1B; credential_reference only)** |
| **Drive files** | `diaspora_drive_files` | **exists (Phase 1B)** |
| Workbook batches/rows | `diaspora_workbook_import_batches` / `_rows` | exists |
| Audit log | `diaspora_import_audit_log` (sealed) | exists |

Conventions: UUID PK `gen_random_uuid()`; nullable `tenant_id`; `created_by`/`updated_by` TEXT;
`created_at`/`updated_at`/`deleted_at` TIMESTAMPTZ; JSONB `metadata`; CHECK-constrained status cols;
RLS enabled with SECURITY DEFINER helpers. Migrations applied via custom Node scripts in `scripts/`
(no Supabase CLI). **No production application is performed by this program.**

## 3. Gaps

### Schema gaps (minimal)
- `diaspora_stock_ledger` has no explicit `idempotency_key` column. **Plan**: additive migration adds
  a nullable `idempotency_key` + partial unique index `(stock_item_id, idempotency_key)` so repeated
  movement submissions are de-duplicated. Backwards-compatible.
- No dedicated AI-command audit table; reuse `diaspora_import_audit_log` with `resource_type =
  'diaspora_ai_command'`.
- Otherwise the Phase 1B tables cover stock, supply docs, order documents, AI, and Drive.

### Route gaps (the real work)
No service/route layer exists yet for: stock + ledger, supply documents, buyer-order/RFQ flow +
matching, AI command pipeline, container marketplace capacity API, or Drive provider. These are built
in Phases 3–7 respectively.

### Security gaps to enforce in new code
- Stock availability must derive from ledger (`quantity_on_hand` / `quantity_reserved` mutated only
  through ledger append in a read-modify-write guarded by idempotency).
- All new list/detail/mutation endpoints must scope by tenant + ownership/participant.
- AI must never directly mutate domain records; execution re-validates permission + risk + approval.
- Container reservation approval must re-check capacity server-side and reject overfill.
- Drive must never return token material; tokens live behind a `credential_reference` + env config.

## 4. Migration Plan
- `database/migrations/20260620xxxxxx_diaspora_phase3_stock_ledger_idempotency.sql` — additive:
  `idempotency_key` column + partial unique index on `diaspora_stock_ledger`. Includes rollback notes.
  **Not applied to production**; staging apply steps listed in the PR.
- No other migrations anticipated; existing tables are sufficient. If a genuine gap appears mid-phase
  it will be an additive, backwards-compatible migration with rollback notes, never destructive.

## 5. Phase Dependency Map
- Phase 3 (stock + supply docs) is foundational: ledger + availability feed Phase 4 matching and
  Phase 5 AI draft actions and Phase 6 reservation linkage.
- Phase 4 (buyer orders/RFQ) depends on stock availability (Phase 3) for matching; reuses
  `diaspora_import_orders` + `diaspora_import_quotes` extended with RFQ state in `metadata`.
- Phase 5 (AI) depends on Phases 3–4 domain services as execution adapters (low-risk → draft only).
- Phase 6 (container co-loading) extends existing container/reservation services with authoritative
  capacity math; mostly independent of 3–5 but links reservations to orders.
- Phase 7 (Drive) is independent and provider-abstracted; links files to orders/stock/documents.

## 6. Explicit Non-Goals (this program)
- No production Supabase mutation; no destructive SQL; no migration applied to production.
- No XLSX parsing/generation (Phase 2C remains JSON-only); Drive export covers truthful JSON/report
  artifacts only. Binary workbook→Drive parity recorded as a prerequisite for a later phase.
- No automatic payment/escrow release, compliance approval, document verification, shipment
  completion, reputation creation, or customs override. High-risk AI stays queued/blocked.
- No Phase 8–10 (Subscription Gate, SafeTrade, Trade Graph) — only entitlement hook seams.
- No changes to Navigation Intelligence, Vehicle Evidence, Mobile Identity, PartSentry, or unrelated
  marketplace/mobile/deploy config. `stash@{0}` untouched. Unrelated untracked artifacts not staged.

## 7. Recommended Implementation Order
1. Phase 3 — stock ledger + stock service + supply documents (+ idempotency migration).
2. Phase 4 — buyer orders/RFQ publication + deterministic matching + quote acceptance.
3. Phase 5 — AI command pipeline with risk tiers + approval gates (high-risk blocked).
4. Phase 6 — container marketplace capacity rules + concurrency-safe approval.
5. Phase 7 — Drive provider abstraction + mocked Google Drive flows behind a feature flag.
6. Final regression (route validation, tsc, Playwright, build) + ledger/handoff docs; keep PR draft.

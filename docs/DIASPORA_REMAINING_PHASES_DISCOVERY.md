# Diaspora Remaining Phases — Discovery (Wave 0/1)

> Canonical contract: `docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`
> (directive branch `docs/claude-diaspora-remaining-phases-production-directive`).
> This document records the verified starting truth and the cross-track discovery that the
> remaining program (R0, Track W, Track D, Phase 8, Phase 9, Phase 10, Gate P) builds on.
> It is **descriptive truth**, updated as discovery deepens. No implementation claims here.

Generated during Wave 0/1. Findings come from read-only inspection of the program branch
`claude/diaspora-phases-8-10-production-program` (worktree), HEAD `5996227` = PR #81 head.

---

## 0. Program baseline (verified)

| Item | Verified value |
| --- | --- |
| `origin/main` | `c25b094` (`docs(marketplace): record v1 MVP closeout`) |
| PR #81 | OPEN, **draft**, base `main`, head `5996227b67202c42c97eff5576dc2dc09390d512`, `MERGEABLE` |
| PR #81 scope | 69 files, diaspora-scoped (`backend/services/diaspora`, `database/migrations`, `backend/routes`, `web/src/pages/diaspora`, `docs`, tests). Only shared/integration file touched outside diaspora dirs: `web/src/config/featureRegistry.ts` (expected per §7.2). |
| Program branch | `claude/diaspora-phases-8-10-production-program`, created from `origin/claude/diaspora-phases-3-7-program` |
| Worktree | `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10` (isolated; primary checkout `…/carup-kimi` stays on unrelated `codex/navigation-intelligence-blueprint-completion` with its own uncommitted nav WIP — untouched) |
| Staging Supabase | `eoyenigwevnxwwhyhaer` (authorized) |
| Production Supabase | `vhmnajoeicasaigiophh` (**FORBIDDEN** until explicit release authorization) |
| Latest migration | `20260621094000_diaspora_h7_rpc_execute_grants.sql` |
| Diaspora backend tests | 20 × `backend/tests/diaspora-*.test.js` (node `--test`) + `backend/tests/staging/diaspora-staging-integration.test.js` |
| Diaspora e2e | 11 × `web/e2e/diaspora-*.spec.ts` (Playwright) |

### Workstream isolation (must not be modified)
Navigation Intelligence, Vehicle Evidence, Mobile Identity, PartSentry, unrelated marketplace
redesigns, unrelated mobile work, unrelated Vercel projects, unrelated historical stashes.
`stash@{0}` (`phase-7c WIP: mobile verification result UI`) must remain unapplied/unpopped.

---

## 1. RELEASE GATE R0 — Phases 3–7 readiness

### 1.1 H9 staging concurrency evidence — **SKIPPED, not PASSED**
The `staging-integration` job in `.github/workflows/diaspora-phases-3-7-validation.yml`
is secret-gated:

```
- name: Staging integration (gated on secrets)
  env: { STAGING_DATABASE_URL: ${{ secrets.DIASPORA_STAGING_DATABASE_URL }} }
  run: |
    if [ -z "$STAGING_DATABASE_URL" ]; then
      echo 'skipped — secrets unavailable (DIASPORA_STAGING_DATABASE_URL not configured)'
    else
      node --test backend/tests/staging/diaspora-staging-integration.test.js
    fi
```

The latest PR #81 run (`27890263887`, job `82532453941`) log literally prints
`skipped — secrets unavailable (DIASPORA_STAGING_DATABASE_URL not configured)` and exits 0
in ~34s. **The H9 concurrency tests (stock, quote acceptance, container approval) did NOT run.**
Per §10.2 this is `SKIPPED — SECRET UNAVAILABLE`, never `PASSED`.

- H9 concurrency harness exists: `backend/tests/staging/diaspora-staging-integration.test.js`
  + `backend/tests/diaspora-h9-harness.test.js`.
- Atomic RPCs exist and are unit/mock-tested: `diaspora_append_stock_movement_atomic` (H1),
  `diaspora_accept_quote_atomic` (H2), `diaspora_approve_cargo_reservation_atomic` (H3).
- Service-role RPC grants applied additively: `20260621094000_diaspora_h7_rpc_execute_grants.sql`
  (REVOKE from anon/authenticated, GRANT EXECUTE to `service_role`).

**R0 requirement:** run the staging integration test against authorized staging
`eoyenigwevnxwwhyhaer` with the `DIASPORA_STAGING_DATABASE_URL` secret set, capture the run ID,
and record PASSED with the four sub-tests proven. This needs the staging secret (external boundary).

### 1.2 H10 final readiness
Not yet formally evidenced. R0 DoD (§10.4): PR #81 merged with evidence, **or** explicitly
accepted as a reviewed dependency of the stacked program branch. Default chosen for the program:
**accept PR #81 as a reviewed dependency** so Phases 8–10 proceed stacked; final merge stays with the user.

### 1.3 Credential incident — **CRITICAL, open** (see Risk Register CR-1)
Tracked scripts contain hardcoded `postgresql://…:<password>@…` URIs and reference the forbidden
production project ref `vhmnajoeicasaigiophh`. Git history shows ≥6 commits touching such blobs.
Containment started on main (`20260619201406_production_access_containment.sql`,
`20260620232827_issue77_access_containment_followup.sql`, PR #83) but hardcoded values remain in
the tree. Affected file groups (names only; **no secret values are reproduced anywhere**):
`backend/scripts/*.js`, `scripts/*.js`, `database/seeds/*.sql`, a few test utils.
Full remediation (rotate credentials, env-var replacement, history purge, force re-clone) is an
external approval boundary — the production DB owner must rotate. Code-side env-var replacement and
expanded secret scanning are in-program.

---

## 2. COMPLETION TRACK W — XLSX workbook contract

**Current state: Phase 2C JSON-only intake.** No XLSX/spreadsheet library in any `package.json`
(root/backend/web). Binary template generation and export are explicitly deferred in code.

### Reusable foundation (strong)
- Routes: `backend/routes/diasporaWorkbookRoutes.js` (`/dry-run`, `/template-schema`,
  `/download-template` → `{downloadReady:false}`, `/export` → deferred ValidationError).
- Validation: `diasporaWorkbookValidationService.js` (cell/row diagnostics, max 5000 rows/sheet,
  500 error-sample cap, status enums, numeric/date/cross-ref checks).
- Diagnostics: `diasporaWorkbookPersistenceService.js#buildWorkbookRowDiagnostics`
  (ACCEPTED/WARNING/REJECTED + actionType), chunked inserts (500/chunk).
- Execution: `diasporaWorkbookImportExecutionService.js` (Phase 1F **draft-only**; idempotent via
  `rowAlreadyExecuted`; never overwrites stock directly — stock changes must go through ledger RPC).
- State machine: `backend/constants/diaspora/diasporaWorkbookImportStatuses.js`
  (DRY_RUN→VALIDATED→READY_FOR_REVIEW→IMPORTING_DRAFTS→IMPORTED_DRAFTS / FAILED_DRAFT_IMPORT).
- Idempotency: `diaspora_workbook_import_batches` UNIQUE `(tenant_id, uploaded_by, idempotency_key)`.
- UI: `web/src/pages/diaspora/DiasporaWorkbookDryRun.tsx` (JSON paste/upload),
  `DiasporaWorkbookOperatorConsole.tsx` (read-only operator console).

### Missing for full .xlsx contract
XLSX dependency (evaluate `exceljs` vs `xlsx`/SheetJS — license + maintenance + streaming);
multipart upload handler; XLSX→normalized-rows parser; normalized-state→XLSX generator;
template generation (validation lists, protected/hidden reference sheets, example rows, schema
version, privacy warning); **formula-injection neutralization on export** (`= + @ -` / tab / CR
prefixes); filename normalization; MIME/size/sheet/row/cell bounds + zip-bomb guard; `.xlsm`
rejection; export redaction + stable-ID round-trip; Drive-save hook (Track D).

---

## 3. COMPLETION TRACK D — Google Drive

**Current state: scaffold / activation-ready, fail-closed.** This matches §18's permitted
"production-disabled, activation-ready boundary" when credentials are unavailable.

- Provider abstraction: `backend/services/diaspora/drive/driveProvider.js` (interface +
  fully-implemented in-memory `MockDriveProvider`) and `googleDriveProvider.js` where
  `buildAuthorizationUrl()` is real/offline but `exchangeAuthorizationCode/refreshAccessToken/
  revoke/ensureFolder/uploadFile/getMetadata` throw `EXTERNAL_ACTIVATION_REQUIRED`.
- OAuth state security (production-grade): `diasporaDriveSyncService.js` — HMAC-SHA256 signed state
  `{userId,tenantId,nonce,iat,exp}`, timing-safe verify, user binding, 10-min expiry, one-time
  nonce (`consumed_at IS NULL`), replay rejection. Prod requires `DIASPORA_DRIVE_STATE_SECRET`
  (no fallback); dev/test fallback only.
- Token storage: **tokens never persisted**; only opaque `credential_reference` in
  `diaspora_drive_connections`. `sanitizeConnection/sanitizeFile` strip secrets from API output.
  No hardcoded-key anti-pattern. A real vault binding is required before live activation.
- Activation states distinguished: disabled / not-configured / configured-not-connected / active /
  revoked / disconnected / mock. `assertDriveProductionSafety()` blocks mock in production.
- File metadata: `diaspora_drive_files` binds connection/tenant/entity/checksum/sync status.
  Folder model `CarUp Trade/{Buyer Orders, Seller Stock, Import/Export Documents, Invoices,
  Bills of Lading, Compliance, Payment Proof, Completed Orders}` present in constants.
- Tests: `backend/tests/diaspora-drive.test.js` (scopes, state expiry/replay, cross-user reject,
  token redaction, revoked, idempotent upload, prod-mock-prohibition, missing-state-secret) and
  `web/e2e/diaspora-drive-connections.spec.ts`.

**Missing for live:** real Google API calls in the stubbed methods + a secret-vault binding for
exchanged tokens (external: Google OAuth credentials + approved vault). Keep production-disabled.

---

## 4. PHASE 8 — Subscription Gate

**Current state: no diaspora entitlement/quota/plan-catalog system. Build required; reuse identity/tenant/payment primitives.**

### Reusable
- `tenant_billing` (`002_multi_tenant_and_auth_schema.sql`: `plan_tier`, `stripe_customer_id`,
  `status`) and `users.subscription` (Free/Premium/Enterprise/System) — thin, must be superseded
  by a real plan catalog, not duplicated.
- Webhook pattern: `backend/services/payment/paymentRouter.js` (HMAC verify, 5-min anti-replay,
  idempotency by unique `reference`) — model for billing-webhook idempotency.
- Identity/tenant: `authMiddleware.js` (server-derived role + `x-tenant-id` → `tenant_users`),
  `domain_events` outbox for lifecycle events, `auditLogger.js`.

### Missing (Phase 8 build)
Plan catalog (config-driven, not hardcoded), subscriptions + lifecycle states (trialing/active/
past_due/grace/paused/cancelled/expired/incomplete/suspended), entitlement registry (boolean/int-
quota/date/tenant/user), usage meters + atomic reservation (reserve→commit/release, billing-period
boundaries, no double count on retry), `diasporaEntitlementService.js` (resolve plan/entitlements,
check feature/quota, reserve/commit/release, explain denial, audited admin override), billing
provider **adapter** (sandbox/manual default; live disabled), Phase 8 API + webhooks + UI.

### Open product decision (PD-1)
Subscription granularity: per-user (`users.subscription`) vs per-tenant (`tenant_billing.plan_tier`)
vs both. Default proposed: **tenant-scoped plan with per-user role entitlements**, configurable.

---

## 5. PHASE 9 — SafeTrade

**Current state: rich domain to connect to; SafeTrade assurance layer absent.**

### Existing domain (connect, don't duplicate) — `013_diaspora_trade_schema.sql` + phase1b + H1–H3
Orders `diaspora_import_orders` (23-state DAG, `diasporaStatuses.js`), quotes
`diaspora_import_quotes` + `diaspora_accept_quote_atomic`, stock + immutable ledger +
`diaspora_append_stock_movement_atomic`, container/cargo `diaspora_container_shipments`/
`diaspora_cargo_reservations` + `diaspora_approve_cargo_reservation_atomic`, shipments
`diaspora_shipments` + `diaspora_shipment_stage_events`, compliance `diaspora_compliance_reviews`,
documents `diaspora_trade_documents` (+extractions/verifications) + `vehicle_government_documents`,
reputation `diaspora_trade_profiles`/`diaspora_reputation_records`,
**`diaspora_payment_milestones` (schema-only — no service)**.
Patterns: critical/best-effort audit (`diasporaServiceUtils.js`, `diasporaAuditService.js`),
server-derived role guards (`diasporaAuthorization.js`), idempotency keys.

### Missing (Phase 9 build)
Canonical SafeTrade transaction entity + explicit reviewed state machine + transition table
(actor/entitlement/payment/document/compliance/shipment conditions, audit, idempotency, rollback);
eligibility engine (explainable blockers); payment milestones service over the existing table
(amounts reconcile to total); **payment provider abstraction with sandbox/fake default — real money
disabled**; release policy engine (eligible/blockers/evidence/policy-version/timestamp,
reviewer approval for high-risk); compliance/document/shipment gates wired to existing services;
dispute flow; delivery confirmation + reputation-eligibility **event** (no auto reputation writes);
API + UI with explicit "sandbox / not live" labels.

### Non-negotiables
No real money/escrow release; no auto compliance approval; no auto shipment/delivery completion;
no auto reputation; critical transitions must fail atomically when audit cannot be written.

---

## 6. PHASE 10 — Trade Graph Intelligence

**Current state: event/outbox + AI boundary exist; graph projection absent. Postgres-first, no graph DB.**

### Reusable
- Outbox: `domain_events` (`011_phase6_schema.sql`) + `eventBus/eventWorker.js` (singleton,
  `FOR UPDATE SKIP LOCKED`, subscriber model, attempts/retry, correlation context). Extend; do not
  build a second event system.
- Audit source: `diaspora_import_audit_log` (previous/new state JSONB, tenant, seal) as a
  verification/compliance source; `domain_events` as the **primary** idempotent projection source.
- AI boundary (model to preserve): `diasporaAiCommandService.js` — AI proposes (DRAFT/AWAITING),
  HIGH-risk blocked on execute, never mutates authoritative state directly; `source_command_id` FK
  links executions to commands.
- Postgres capabilities present: JSONB, RLS, composite indexes, triggers, cryptographic seals.
  Recursive CTEs / materialized views not yet used — available for graph traversal/summaries.

### Missing (Phase 10 build)
`trade_graph_nodes` + `trade_graph_edges` (tenant-scoped, RLS, soft-delete, unique constraints);
canonical `diasporaEventTypes` enum; projection service (idempotent consumption of `domain_events`,
replay, rebuild, dead-letter visibility, versioned projection, tenant partitioning); explainable
query service (neighborhood/path/blocker/match, recursive CTEs, source references + reasons);
intelligence aggregates + AI-ready redacted read context; admin-only rate-limited auditable rebuild;
dashboards with evidence drawer + freshness + accessible non-visual representation;
domain services emit structured events (not just audit).

---

## 7. Cross-cutting conventions (all new work must follow)

- **Migrations:** `NNN_*.sql` or `YYYYMMDDHHMMSS_*.sql`; `-- +migrate Up/Down`; RLS via
  `diaspora_trade_os_can_access_row`; `SECURITY DEFINER` + `SET search_path='public'`;
  `REVOKE … FROM PUBLIC`, grant `authenticated`/`service_role` only; apply only to staging
  `eoyenigwevnxwwhyhaer`; run advisors after.
- **Audit:** `appendCriticalAudit` (fail-loud) for security/state-critical; `appendBestEffortAudit`
  (fail-silent) for telemetry — never conflate. SHA256 seals.
- **Idempotency:** key checked inside RPC transaction; conflicting reuse rejected; replay returns
  `idempotentReplay:true`.
- **Authz:** `authorizeRole()` middleware, server-derived roles, tenant scoping; no header-trusted roles.
- **Feature flags:** env-driven constants (e.g. `diasporaDriveConstants.js`), fail-closed in prod.
- **CI:** secret-scan guard, migration sanity (Up/Down), `node --test` backend, tsc, route
  validation, Playwright, secret-gated staging integration **reported as skipped, never passed**.
- **Secrets:** env-only; `env.example` placeholders; no hardcoded credentials.

---

## 8. External approval boundaries surfaced (Section 85)

| ID | Boundary | Needed from user |
| --- | --- | --- |
| CR-1 | Production DB credential leak in historical scripts | Rotate credentials; approve history purge + force re-clone |
| EB-1 | Staging integration / H9 proof | Set `DIASPORA_STAGING_DATABASE_URL` secret for authorized staging |
| EB-2 | Live Google Drive | Google OAuth credentials + approved secret vault |
| EB-3 | Live billing (Phase 8) | Approved billing provider + credentials + webhook E2E |
| EB-4 | Real-money SafeTrade (Phase 9) | Legal/compliance sign-off + payment provider + credentials |
| EB-5 | Production migration / deploy | Explicit release authorization (prod `vhmnajoeicasaigiophh` forbidden until then) |
| PD-1 | Phase 8 subscription granularity | Confirm per-tenant vs per-user vs both |

All independent code/test/sandbox work continues regardless of these (Agent Continuity Rule).

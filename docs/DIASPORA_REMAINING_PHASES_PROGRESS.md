# Diaspora Remaining Phases — Progress Ledger

> **Integration-owned file (§7.2).** Only the Program Integrator edits this serially.
> Canonical contract: `docs/CLAUDE_CODE_DIASPORA_REMAINING_PHASES_TO_PRODUCTION_MASTER_DIRECTIVE.md`.
> No milestone may rely on hidden chat memory — state lives here.

## Program coordinates

| Field | Value |
| --- | --- |
| Program branch | `claude/diaspora-phases-8-10-production-program` |
| Base branch | `claude/diaspora-phases-3-7-program` (PR #81), head `5996227` |
| `origin/main` at start | `c25b094` |
| Worktree | `/Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10` (isolated) |
| Stacked draft PR | **#90** (draft) → base `claude/diaspora-phases-3-7-program` — https://github.com/kudzimusar/carup/pull/90 |
| Status legend | `PASSED` / `FAILED` / `SKIPPED — SECRET UNAVAILABLE` / `NOT RUN` / `PENDING` |

### Independent CI evidence (PR #90, `Diaspora Phases 3-7 Validation` workflow)
| Run ID | Covers | backend-and-build | playwright | staging-integration |
| --- | --- | --- | --- | --- |
| `27898630625` | through M2 (Phase 8 enforcement/API) | PASSED | PASSED | SKIPPED — SECRET UNAVAILABLE |
| `27899597609` | through M-W1 (XLSX foundation; `npm ci` w/ new exceljs lock) | PASSED | PASSED | SKIPPED — SECRET UNAVAILABLE |

Note: Vercel preview deploys report `fail` due to an **account build-rate-limit** ("retry in 24h"),
not a code failure — GitHub Actions is the gating CI and is green. H9 staging concurrency proof
still requires `DIASPORA_STAGING_DATABASE_URL` (EB-1); the skip is reported distinctly per §10.2.

## Wave/track status overview

| Track | Owner role | Status |
| --- | --- | --- |
| R0 — Phases 3–7 release readiness | B (Release Gate & Security) | Discovery done; H9 = `SKIPPED — SECRET UNAVAILABLE`; needs staging secret |
| Track W — XLSX workbook | C (Workbook/Drive) | **Foundation COMPLETE** (exceljs; template gen + base64 upload dry-run reusing JSON validation + export + formula-injection safety + upload security); routes mounted; live import still draft-only |
| Track D — Google Drive | C (Workbook/Drive) | Activation-ready scaffold verified; keep prod-disabled |
| Phase 8 — Entitlements | D | **M1 foundation + M2 backend enforcement/API/webhook COMPLETE** (enforcement flag default OFF); UI = M3 pending; staging proof needs EB-1 |
| Phase 9 — SafeTrade | E | **Design COMPLETE** (durable: docs/DIASPORA_PHASE9_SAFETRADE_DESIGN.md) + **schema/state-machine foundation built & on PR #90**; services/routes/tests **PENDING** (build interrupted by session limit ~2026-06-21, resets 22:00 Asia/Tokyo) |
| Phase 10 — Trade Graph | F | **Design COMPLETE** (durable: docs/DIASPORA_PHASE10_TRADE_GRAPH_DESIGN.md — schema + projection + explainable queries + AI/redaction/API + build-ready synthesis); build not started |
| Gate P — Production readiness | A + B | Docs scaffolded; not started |

---

## Program decisions (user-confirmed 2026-06-21)
- **PD-1 RESOLVED:** subscription granularity = **tenant plan + per-user entitlements**
  (tenant-scoped subscription/quotas; users get role-based entitlements within the plan; per-user
  overrides supported). Plan catalog must be config-driven.
- **Pace:** build autonomously, milestone-by-milestone, **do not stop**; optimize for reaching
  production. Each verified vertical slice commits to PR #90.
- **Hard guardrails reaffirmed:** production Supabase `vhmnajoeicasaigiophh` forbidden until explicit
  release authorization (EB-5); no merge automation; external providers stay sandbox/disabled
  (EB-1 staging secret, CR-1 rotation, EB-2/3/4 not yet granted) — build fail-closed around them.

## Milestone log

### M0 — Wave 0 baseline (COMPLETE)
- **Objective:** Establish isolated program branch, durable docs, stacked draft PR, agent ownership.
- **Assigned:** Agent A (Program Integrator).
- **Repository findings:** PR #81 diaspora-scoped (69 files); only shared file touched is
  `web/src/config/featureRegistry.ts`. No unrelated workstream changes in PR #81.
- **Schema findings:** latest migration `20260621094000_diaspora_h7_rpc_execute_grants.sql`;
  full inventory in Discovery §0/§7.
- **Files changed (this milestone):** `docs/DIASPORA_REMAINING_PHASES_DISCOVERY.md`,
  `docs/DIASPORA_REMAINING_PHASES_PROGRESS.md`, `docs/DIASPORA_REMAINING_PHASES_RISK_REGISTER.md`,
  `docs/DIASPORA_PRODUCTION_READINESS_MATRIX.md`, `docs/DIASPORA_PRODUCTION_RELEASE_RUNBOOK.md`,
  `docs/DIASPORA_PRODUCTION_ROLLBACK_RUNBOOK.md`.
- **Migrations:** none.
- **Routes / UI routes:** none.
- **Security decisions:** isolate via worktree (no nav/stash leakage); accept PR #81 as reviewed
  dependency for stacking; treat credential leak (CR-1) as a release-blocking external boundary.
- **Tests:** none added this milestone.
- **CI run IDs:** PR #81 latest `27890263887` — `backend-and-build` PASSED, `playwright` PASSED,
  `staging-integration` **SKIPPED — SECRET UNAVAILABLE** (log-confirmed), Vercel previews green.
- **Staging evidence:** none yet (H9 needs `DIASPORA_STAGING_DATABASE_URL`).
- **Known limitations:** implementation waves 2–7 not started.
- **Blockers:** none for M0.
- **Commit SHA:** `c1e62c8` (baseline docs); ledger PR-coordinate update follows.
- **PR:** #90 (draft) opened targeting `claude/diaspora-phases-3-7-program`.
- **Next milestone:** M1 — Wave 2 entry. Recommended first vertical slice: **Phase 8 entitlement
  foundation** (plan catalog + `diasporaEntitlementService` + one enforced feature end-to-end with
  atomic quota), because §83 sequences "Phase 8 entitlement service and schema first" and Tracks W/
  Drive/SafeTrade all depend on entitlement checks. Parallel-safe: Track W XLSX dependency decision
  + prototype (no shared-file edits). Blocked-on-external: R0 H9 (EB-1), live Drive (EB-2).

---

### M1 — Phase 8 entitlement foundation (COMPLETE) — Wave 2
- **Objective:** Data + service foundation for tenant-plan + per-user entitlements with atomic quotas
  and a sandbox billing abstraction. No route/UI wiring yet (M2), enforcement flag default OFF.
- **Assigned:** Agent D (Phase 8), integrated + independently verified by Agent A.
- **Files changed:**
  - `database/migrations/20260621120000_diaspora_phase8_subscription_entitlements.sql` (NEW)
  - `backend/constants/diaspora/diasporaEntitlements.js` (NEW — FEATURE_KEYS, PLAN_CATALOG, states)
  - `backend/constants/diaspora/diasporaBillingConstants.js` (NEW — fail-closed flags)
  - `backend/services/diaspora/billing/billingProvider.js` (NEW — sandbox + activation-gated live)
  - `backend/services/diaspora/diasporaEntitlementService.js` (NEW)
  - `backend/tests/diaspora-entitlements.test.js` (NEW — 19 tests)
  - `backend/tests/helpers/diasporaRpcReference.js` (MOD — added `diaspora_reserve_usage_atomic` JS ref)
- **Migrations:** 1 created (`20260621120000…`). 6 tables (plans, subscriptions, user overrides,
  usage meters, usage reservations, billing provider events) + atomic RPC
  `diaspora_reserve_usage_atomic`. All RLS-enabled, REVOKE PUBLIC, GRANT authenticated/service_role,
  RPC EXECUTE → service_role only, SECURITY DEFINER + `search_path='public'`, Up/Down present.
  **NOT applied to any database** (staging apply deferred to integration agent + advisors).
- **Routes / UI:** none this milestone (deferred to M2; route file is integration-owned).
- **Security decisions:** server-side only; `appendCriticalAudit` for admin override + quota
  commit/release; never trust client roles; enforcement gated behind `DIASPORA_SUBSCRIPTION_ENFORCEMENT`
  (default OFF) so no existing flow breaks; live billing fail-closed (`EXTERNAL_ACTIVATION_REQUIRED`).
- **Tests (independently re-run by Agent A):** `diaspora-entitlements` **19/19 pass**;
  `diaspora-rfq` regression **14/14 pass**; full `diaspora-*.test.js` suite **326 tests, 319 pass,
  0 fail, 7 skipped** (staging-gated).
- **CI run IDs:** to be produced by PR #90 CI on push.
- **Staging evidence:** none yet (atomic reserve concurrency proof needs EB-1 staging secret;
  unit tests stub the RPC mirroring the SQL, per the H1–H3 convention).
- **Known limitations:** RPC stubbed in unit tests (real row-lock concurrency proven later in
  staging); no enforcement wired to live features yet.
- **Blockers:** EB-1 (staging proof). None blocking M2 code.
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** M2 — wire entitlement checks into real diaspora operations (stock publish,
  RFQ create/respond, workbook bulk import, AI execute, container reserve) behind the enforcement
  flag + Phase 8 API/webhook + UI; in parallel, M-W1 = XLSX dependency decision + parser prototype.

### M2 — Phase 8 enforcement + subscription API + webhook (COMPLETE, backend) — Wave 3
- **Objective:** Enforce entitlements on real domain operations + ship the Phase 8 subscription API
  and idempotent billing webhook. Backend only (UI = M3).
- **Assigned:** Agent D (build), Agent A (serial integration of shared route/server files + verify).
- **Files changed:**
  - `backend/services/diaspora/diasporaEntitlementGuard.js` (NEW — flag-gated `requireFeature`,
    `reserveQuotaForFeature`, `withEntitlement` reserve→run→commit/release).
  - `backend/routes/diasporaSubscriptionRoutes.js` (NEW — plans/status/entitlements/usage +
    sandbox checkout/portal/change-plan/cancel + idempotent signature-verified webhook).
  - `backend/services/diaspora/diasporaSupplyDocumentService.js` (MOD — `publishSupplyDocument`
    wrapped: feature `diaspora.stock.publish` + quota `diaspora.stock.max_items`).
  - `backend/services/diaspora/diasporaBuyerOrderService.js` (MOD — `publishRfq` wrapped: feature
    `diaspora.rfq.create` + quota `diaspora.rfq.max_open`, after idempotent re-publish guard).
  - `backend/routes/diasporaRoutes.js` (MOD, **integration-owned** — mounted subscription router at
    `/subscription`).
  - `backend/server.js` (MOD, **integration-owned** — capture `req.rawBody` for webhook HMAC).
  - `backend/tests/diaspora-subscription-routes.test.js` (NEW — 15), `backend/tests/diaspora-entitlement-enforcement.test.js` (NEW — 8).
- **Routes:** `/api/diaspora/subscription/{plans,status,entitlements,usage,checkout,portal,change-plan,cancel,webhook}`.
- **Security decisions:** enforcement gated by `DIASPORA_SUBSCRIPTION_ENFORCEMENT` (default OFF →
  byte-identical existing behavior, proven); webhook verifies signature + idempotent on
  `(provider,event_id)` + never trusts client status; sandbox billing only (live fail-closed).
- **Tests (independently re-run by Agent A):** new Phase 8 tests **23/23 pass**; full
  `diaspora-*.test.js` suite **349 tests, 342 pass, 0 fail, 7 skipped** after integration;
  `node --check` clean on `diasporaRoutes.js` + `server.js` + `diasporaSubscriptionRoutes.js`.
- **Staging evidence:** none yet (atomic quota concurrency proof needs EB-1).
- **Known limitations:** UI not built (M3); webhook idempotency proven via mock select (real DB
  unique constraint exercised in staging later); enforcement wired on 2 ops (stock publish, RFQ
  create) — remaining ops (workbook bulk import, AI execute, container reserve, drive, API) wired in
  a later milestone alongside their tracks.
- **Blockers:** EB-1 (staging proof). None blocking next milestones.
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** M3 — Phase 8 frontend (plan comparison, status, usage dashboard, upgrade flow,
  feature-lock explanations) + e2e; and Track W XLSX foundation (parallel).

### M-W1 — XLSX workbook foundation (COMPLETE) — Wave 2 (Track W)
- **Objective:** Real .xlsx template generation, upload parsing (reusing the existing JSON dry-run
  validation), and export with formula-injection safety + upload security.
- **Assigned:** Agent C (build), Agent A (exceljs dependency add + serial router mount + verify).
- **Dependency added (Agent A):** `exceljs@^4.4.0` (backend workspace) — lockfile change purely
  additive (769 insertions, 0 deletions).
- **Files changed:**
  - `backend/constants/diaspora/diasporaWorkbookTemplates.js` (NEW — config-driven template catalog).
  - `backend/services/diaspora/workbook/diasporaWorkbookXlsxService.js` (NEW — generateTemplate /
    parseWorkbook / exportWorkbook; formula cells read as values, never evaluated).
  - `backend/services/diaspora/workbook/diasporaWorkbookUploadSecurity.js` (NEW — MIME/ext allowlist,
    size/sheet/row/cell bounds, filename normalization, formula neutralizer, sha256).
  - `backend/routes/diasporaWorkbookXlsxRoutes.js` (NEW — template.xlsx download, base64 xlsx dry-run
    reusing `runAndPersistDiasporaWorkbookDryRun`, export).
  - `backend/routes/diasporaRoutes.js` (MOD, **integration-owned** — mounted xlsx router).
  - `backend/tests/diaspora-workbook-xlsx.test.js` (NEW — 24 tests).
- **Security decisions:** parser outputs the EXACT existing normalized shape `{templateType, sheets}`
  → no fork of the validated dry-run path; **never overwrites stock / never bypasses gates** (live
  import remains draft-only as before); formula injection neutralized on export (`= + @ - \t \r` →
  leading `'`); `.xlsm`/`.xls` rejected; bounds maxBytes 10MB / 12 sheets / 5000 rows / 200k cells.
- **Tests (independently re-run by Agent A):** xlsx **24/24**; workbook regression **22/22**; full
  `diaspora-*.test.js` suite **373 tests, 366 pass, 0 fail, 7 skipped**; route-auth regression 8/8;
  `node --check` clean on mounted routes.
- **Known limitations:** base64-in-JSON upload (multipart/streaming for very large files = future
  work, bounded by 10MB pre-parse check); `normalizeWorkbookTemplateType` still maps supplier/
  container_reservation → enterprise for validation (owned by existing validator, not forked);
  live XLSX import execution still intentionally disabled (Phase 1C draft-only).
- **Blockers:** none. (Drive export-to-xlsx wiring waits on Track D live activation EB-2.)
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** Phase 8 M3 frontend; then Phase 9 SafeTrade foundation (Wave 4).

### M-S1 — Phase 9 SafeTrade design + schema/state-machine foundation (PARTIAL) — Wave 4
- **Objective:** SafeTrade backend via design→build→adversarial-verify workflow. **Design + build
  stage 1 landed; stages 2–4 + verify were cut off by a platform session limit** (resets 22:00
  Asia/Tokyo). No data loss — designs preserved durably.
- **Assigned:** workflow `wf_e1c66e58-9b4` (Agent E ownership); Agent A integrating.
- **Files committed:**
  - `docs/DIASPORA_PHASE9_SAFETRADE_DESIGN.md` (NEW — full buildable spec: state machine + transition
    table, schema/migration, eligibility + release policy, milestones + sandbox payment provider).
  - `backend/constants/diaspora/diasporaSafeTradeStatuses.js` (NEW — SAFETRADE_STATES, transition
    table, risk tiers, money-movement guards, escrow-held states, canDispatch/assertDispatchAllowed).
  - `backend/constants/diaspora/diasporaSafeTradeConstants.js` (NEW — fail-closed flags
    `isSafeTradeEnabled`/`assertSafeTradeProductionSafety`, milestone types, policy version,
    reconciliation tolerance, provider selection; live throws `EXTERNAL_ACTIVATION_REQUIRED`).
  - `database/migrations/20260621130000_diaspora_phase9_safetrade.sql` (NEW — 3 tables, RLS via
    helper, REVOKE PUBLIC, service_role grants, search_path, Up/Down; **NOT applied to any DB**).
- **Security decisions:** sandbox-only payments; high-risk release needs reviewer approval; critical
  transitions audit atomically; everything behind `DIASPORA_SAFETRADE_ENABLED` (OFF). Router NOT yet
  created/mounted; foundation is inert (no imports) until services land.
- **Tests:** none yet (stage 4 cut off). Constants pass `node --check` + ESM import smoke; migration
  passes sanity (Up/Down, RLS×3, REVOKE PUBLIC×3, 0 PUBLIC grants, search_path, service_role×6). Full
  diaspora suite unaffected (new files imported nowhere yet) — last green 373/366.
- **Blockers:** **platform session limit** (resets 22:00 Asia/Tokyo) halted subagents.
- **RESUME PLAN (after reset):** re-run the Phase 9 workflow build stages 2–4 + verify (the design
  doc is the input; build stage 1 already on disk/committed). Then mount the router, run tests + CI,
  commit. Then complete Phase 10 design (queries/AI-API/synthesis) and build.
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** resume Phase 9 build (services/eligibility/release-policy/milestones/disputes/
  delivery/routes/tests) → integrate; then Phase 10.

## Agent ownership (Section 7)

| Agent | Owns | Branch/worktree |
| --- | --- | --- |
| A — Program Integrator | branch strategy, shared-file integration, migration ordering, CI/release gates, PR body, this ledger | program branch |
| B — Release Gate & Security | R0 H9/H10, credential incident, authz review, secret scan, readiness checklist | `claude/diaspora-r0-release-gates` |
| C — Workbook/XLSX & Drive | XLSX parse/gen/template/export, Drive provider + OAuth/vault boundary | `claude/diaspora-workbook-drive-completion` |
| D — Phase 8 Entitlements | plans, entitlements, quotas, metering, billing abstraction, UI/tests | `claude/diaspora-phase8-entitlements` |
| E — Phase 9 SafeTrade | state machine, milestones, gates, disputes, delivery, sandbox provider | `claude/diaspora-phase9-safetrade` |
| F — Phase 10 Trade Graph | event model, projection, queries, dashboards, AI-ready reads | `claude/diaspora-phase10-trade-graph` |
| G — Frontend/A11y/E2E | routes/pages, accessibility, error/loading/empty states, Playwright | `claude/diaspora-e2e-production-readiness` |

**Integration-owned shared files (no concurrent specialist edits):**
`backend/routes/diasporaRoutes.js`, `web/src/App.tsx`, `web/src/config/featureRegistry.ts`,
`web/src/hooks/useCarUpApi.ts`, `web/src/types/index.ts`, `package.json`, `package-lock.json`,
`.github/workflows/*`, this file, `docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md`.

## Commit structure (recommended, §84)
`docs: establish remaining diaspora program baseline` → `fix: complete diaspora phases 3 to 7
release evidence` → `feat: add diaspora xlsx workbook contract` → … (see directive §84). Do not
squash milestone history until final review policy is decided.

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
| Phase 9 — SafeTrade | E | **Backend COMPLETE** — 7 services, atomic RPCs, 2 migrations, routes mounted, 47 tests; adversarial-reviewed (1 HIGH + 1 MED fixed, rest tracked as ST-3); sandbox-only/fail-closed. UI (M-S2) + staging proof (EB-1) pending |
| Phase 10 — Trade Graph | F | **Backend COMPLETE & CLOSED (Gate T10)** — build + 4 adversarial fix rounds + holistic review (CRITICAL+HIGH+MED fixed) + final re-review **PASS (HIGH=0)**. Router mounted scoped at `/trade-graph`; route-shadowing proven; full suite **590/583/0-fail/7-skip**. UI (UI-10) + staging proof (EB-1) pending |
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

### M-S2 — Phase 9 SafeTrade backend complete (build + adversarial verify + fixes) — Wave 4
- **Objective:** Complete SafeTrade backend (services/disputes/delivery/routes/tests) from the
  committed design, adversarially verify, fix blocking findings, integrate.
- **Assigned:** workflow `wf_68e17071-0a6` (build+verify) + fix agent; Agent A integrated/verified.
- **Files committed (this milestone):**
  - `backend/services/diaspora/safetrade/` (7 services: payment provider sandbox, transaction,
    eligibility, milestone, release-policy, dispute, delivery).
  - `backend/routes/diasporaSafeTradeRoutes.js` (NEW; mounted) — §48 endpoints, gated by
    `isSafeTradeEnabled()`.
  - `backend/tests/diaspora-safetrade.test.js` (NEW — 47 tests), `backend/tests/helpers/diasporaSafeTradeRpcReference.js` (NEW — JS RPC refs mirroring SQL).
  - `database/migrations/20260621131000_diaspora_phase9_safetrade_disputes.sql` (NEW — disputes/
    evidence/delivery tables), and FIX-2 grant tightening + RPC evaluator guard into the foundation
    migration `20260621130000`.
  - `backend/routes/diasporaRoutes.js` (MOD, **integration-owned** — mounted SafeTrade router).
- **Adversarial review (4 dims):** money-safety PASS, state/audit PASS, tenant/authz PASS, reuse/gates
  found **1 HIGH** (seller could set buyer delivery gate via `transition()`) — **FIXED** (ST-1) — and
  a money-path **MED** (forgeable release evaluation) — **FIXED** (ST-2). Remaining lower-severity
  items tracked as **ST-3** (close before EB-4 live payment).
- **Security decisions:** sandbox-only payments (live → `EXTERNAL_ACTIVATION_REQUIRED` at 4 layers);
  high-risk release needs reviewer approval + held milestone; critical transitions audit atomically
  in-RPC; no auto reputation (delivery emits eligibility event only); behind `DIASPORA_SAFETRADE_ENABLED`
  (OFF). RPCs SECURITY DEFINER + service_role-only EXECUTE + search_path; release-evaluations write =
  service_role only.
- **Tests (independently re-run by Agent A):** safetrade **47/47**; route-auth + safetrade **55/55**;
  full `diaspora-*.test.js` suite **420 tests, 413 pass, 0 fail, 7 skipped**; `node --check` clean.
- **Blockers:** EB-1 (staging concurrency proof of the SafeTrade RPCs). None blocking next milestones.
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** Phase 10 build (design ready), then Phase 8/9/10 UIs + e2e, Drive hardening,
  Wave 6 integration + adversarial review, Wave 7 readiness/runbooks + final §87 report.

### M10 — Phase 10 Trade Graph backend, Gate T10 closure (COMPLETE) — Wave 5
- **Objective:** Tenant-safe, event-derived, AI-redacted Trade Graph (Postgres node/edge), built from
  the committed design, hardened through adversarial review until HIGH=0, mounted, route-shadowing
  proven, full suite green.
- **Assigned:** workflows (build + 4 fix rounds + holistic review) under Agent F; Agent A integrated.

**Files (all NEW unless noted):**
- migration `database/migrations/20260621140000_diaspora_phase10_trade_graph.sql` — 7 tables
  (trade_graph_nodes, _edges, _projection_checkpoints, _processed_events, _dead_letters, _rebuilds,
  _materialized_summaries) + RPCs (record_checkpoint, request_rebuild). RLS×7, REVOKE PUBLIC×9,
  0 PUBLIC grants, search_path, service_role-only writes. **NOT applied to any DB.**
- `backend/constants/diaspora/diasporaTradeGraphConstants.js` (event/node/edge enums, projection
  mapping incl. SafeTrade, redaction policy + TOKENIZED_ID fields, `isTradeGraphEnabled` flag).
- `backend/services/diaspora/tradegraph/{diasporaTradeGraphProjectionService,diasporaTradeGraphService,
  diasporaTradeIntelligenceService,diasporaTradeGraphRedaction}.js`.
- `backend/routes/diasporaTradeGraphRoutes.js` (§60 API; gate scoped; NOT self-mounted).
- `backend/routes/diasporaRoutes.js` (MOD, **integration-owned** — mounted at `/trade-graph`).
- tests: `diaspora-trade-graph{,-constants,-projection,-queries,-redaction,-route-isolation}.test.js`
  + helper `diasporaTradeGraphRpcReference.js`.

**Adversarial review rounds (actual outputs, not "expected zero"):**
| Round | Scope | Result |
| --- | --- | --- |
| 1 (build verify, 4 dims) | tenant / projection / redaction / no-write-bypass | **6 HIGH**: tenant 2 (neighbor-tenant JOIN; RLS-bypass app-layer), projection 3 (no soft-delete; dead-letter in aborted txn; event.id not delivered), redaction 1 (raw node.data/edge.metadata). no-write-bypass PASS. |
| 2 (fix+reverify) | tenant / projection / redaction | tenant **PASS**; redaction **2 HIGH** (participant-id fields unredacted; match-explanation raw seller_id) + 1 MED (region prefix); projection re-verify died (infra). |
| 3 (fix+reverify) | redaction / projection | redaction **1 HIGH** (participant-node entityId == raw id); projection **1 HIGH** (subscriber wrapper loses event.id). |
| 4 (fix+reverify) | redaction / projection | redaction **PASS**; projection **1 HIGH** (catch-and-continue on Postgres-aborted txn — no SAVEPOINT). |
| 5 (savepoint fix+reverify) | projection | projection **PASS** (SAVEPOINT isolation, load-bearing negative controls). |
| Gate-T10 required tests | nested/array redaction, AI-payload capture, crash/replay, route-authz | **caught + fixed** a real leak: `document_id`/record-id fields unredacted → folded into TOKENIZED_ID (recursive). |
| Holistic review | all dimensions | **FAIL**: **1 CRITICAL** (SOFT_DELETE_EDGE SQL `$6/$7` vs 6 params — revocation throws on real PG; mock masked it), **1 HIGH** (rebuild middleware admitted tenant-admin), **1 MED** (doc-id naming). |
| Fixes + 29-query param audit | binding + auth + naming | CRITICAL fixed ($5/$6 + mock binds by real `$N`) + only-mismatch confirmed via audit; HIGH fixed (platform-only middleware + route + service checks); MED fixed (TOKENIZED_ID rename). |
| **Final re-review** | all dimensions | **VERDICT: PASS — 0 HIGH/CRITICAL**, all prior closed, no regressions. |

**Closure evidence (mandatory order):**
- Targeted suites then together: graph suite **158/158**.
- Full Diaspora suite **pre-mount: 578 / 571 pass / 0 fail / 7 skip**.
- Router mounted serially by Agent A at `/trade-graph` (gate scoped to prefix — NOT a blanket
  diaspora-root guard; the SafeTrade lesson applied).
- Full Diaspora suite **post-mount: 590 / 583 pass / 0 fail / 7 skip** (no regression = no shadowing).
- **Route-shadowing regression** `diaspora-trade-graph-route-isolation.test.js` **12/12**: with the
  flag OFF, stock/RFQ/buyer-orders/AI/containers/reservations/shipments/OCR-documents/subscription/
  workbook AND SafeTrade all reach their own handlers; `/trade-graph/*` is inert (404).
- **Projection replay/crash evidence:** crash-between-receipt-and-completion test (fault before the
  processed-ledger insert) proves the event stays retryable + replay converges to the clean-run graph
  (content-addressable equality); out-of-order + duplicate delivery converge; per-event SAVEPOINT
  isolates a poisoned event so following events still project.
- **PII-to-AI-boundary capture:** test captures the exact `structuredContextForAi` payload, deep-
  serializes it, asserts NO raw participant id / email / phone / address / document id present (only
  `PARTICIPANT:<token>` / `[REDACTED]` / `[REGION]`). Nested-object/array adversarial redaction proven.
- `node --check` clean on all changed backend files; `git diff --check` clean; migration sanity pass.
- **Feature flag:** `DIASPORA_TRADE_GRAPH` default **OFF** (fails closed, scoped to `/trade-graph`).
- **External boundaries inactive:** migration not applied to any DB; real-Postgres validation of SQL
  binding + SAVEPOINT semantics is an **EB-1 staging gate** (in-memory mock models them behaviorally).
- **Residual (risk register TG-1):** real-Postgres confirmation of SQL parameter binding / SAVEPOINT
  rollback / FOR UPDATE SKIP LOCKED is a staging-verification item; durable dead-letter pool + the
  optional eventWorker subscriber wiring are integrator steps (the supported driver is the self-
  contained `projectPendingEvents`, which owns event.id).
- **Commit SHA:** _(filled on commit)_.
- **Next milestone:** master-plan reconciliation matrix → UI-8 (subscription) → UI-9 (SafeTrade) →
  UI-10 (Trade Graph dashboard).

### UI-8 — Phase 8 subscription experience (COMPLETE) — Wave 6 (frontend)
Truth audit done (Step 0). Gate S8-A (mutation authorization) committed `cf8498f`. Frontend built +
verified. **Evidence:** tsc (web) clean; route-validation **7/7**; subscription unit tests **55/55**
(run from web/, the `@`-alias config); production build EXIT 0; **e2e 18/18** (flag-on dev server);
existing CI diaspora specs + new spec **37/37** (flag-on, no regression); full backend suite
**607/600/0-fail/7-skip**; adversarial UI review **VERDICT PASS** (sandbox truthfulness, no PII/internal
leakage, 7 denial categories, backend-authoritative manager visibility, truthful plan/usage, flag
fail-closed, full a11y, duplicate-submit prevention). CI workflow updated (flag-on dev server + spec
added). Integration-owned edits (by Integrator): types/index.ts (8 contracts), useCarUpApi.ts (8
hooks), App.tsx (route), featureRegistry.ts (flag-gated entry), .github/workflows (dev-server flag +
spec). Non-integration: page + 5 components + helpers + subscriptionFlag.ts + e2e + unit tests +
DashboardLayout icon. Commits: `cf8498f` (S8-A), feat + docs (this milestone).

**Gate S8-A — subscription mutation authorization matrix (server-derived roles only):**
| Endpoint | Access | Permitted | Denied |
| --- | --- | --- | --- |
| GET plans/status/entitlements/usage | read | any authenticated **member of the verified tenant** (middleware 403s non-member x-tenant-id) | unauthenticated; non-member tenant |
| POST checkout/portal/change-plan/cancel | manage | **platform admin/super_admin** (PLATFORM_ADMIN_ROLES) OR **same-tenant tenant admin** (TENANT_ADMIN_ROLES: admin/administrator/tenant_admin) | ordinary members (manager/dealer/mechanic/buyer/seller/bank/government); **platform/government reviewers**; spoofed x-stakeholder-role; cross-tenant; missing tenant |
| POST webhook | provider-signed | valid HMAC signature only (no user-role gate) | bad/missing signature (400) |

Helper `assertCanManageSubscription(userContext, tenantId)` in `diasporaAuthorization.js` (+ predicate
`canManageSubscription`). Cross-tenant denied (target must equal caller's verified tenant unless platform
admin). Structured 403 (`code: SUBSCRIPTION_MANAGEMENT_FORBIDDEN`); no internal ids/stack/secrets leaked.
**Tests:** `diaspora-subscription-authz.test.js` **17/17** (read access; tenant-admin + platform-admin
manage; each management action denied for ordinary member; reviewer denied; spoofed role denied;
cross-tenant denied; missing-tenant denied; webhook valid/bad signature; predicate unit matrix).
Full diaspora suite **607/600/0-fail/7-skipped**.

**UI-8 implementation matrix (frontend, to build):**
| Capability | API | Read roles | Mutation roles | Route | Flag | Component | Test | A11y |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plan comparison | GET /plans | member | — | /diaspora/subscription | `VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED` (off) | PlanComparison | unit+e2e | headings, no color-only |
| Current subscription | GET /status | member | — | same | same | SubscriptionStatusCard | unit+e2e | status text not color-only |
| Usage dashboard | GET /usage | member | — | same | same | UsageDashboard | unit+e2e | accessible quota text + progress |
| Effective entitlements | GET /entitlements | member | — | same | same | (within status/usage) | unit | labelled |
| Explainable denial | (all 4xx) | member | — | same | same | EntitlementDenialPanel | unit+e2e | aria-live, safe fields only |
| Checkout (sandbox) | POST /checkout | — | manager | same | same | SubscriptionActions | unit+e2e | focus, confirm, dup-prevent |
| Portal (sandbox) | POST /portal | — | manager | same | same | SubscriptionActions | unit+e2e | as above |
| Change plan | POST /change-plan | — | manager | same | same | SubscriptionActions | unit+e2e | confirm intent |
| Cancel (at period end) | POST /cancel | — | manager | same | same | SubscriptionActions | unit+e2e | confirm + at-period-end note |

(manager = subscription manager: platform admin or same-tenant tenant admin.) Management controls render
only for managers; **backend remains authoritative even when buttons hidden**. Sandbox wording mandatory;
no "payment succeeded/charged/live" claims.

### UI-9 — Phase 9 SafeTrade experience (COMPLETE) — Wave 6 (frontend)
**Evidence:** Gate S9-A committed `9f7224d` (authz ALL-CORRECT, `dealer` tightened, typed-403, 41
tests). Frontend: tsc clean; route-validation 7/7; unit **11/11**; build EXIT 0; **e2e 10/10** (9 +
1 flaky-recovered, flag-on dev server); full backend suite **648/641/0-fail/7-skip**; forbidden
custodial-phrase scan clean; non-custodial wording + dispute-evidence privacy + available-actions-only
rendering + sandbox confirmation + 403 state all e2e-verified (adversarial verification via e2e +
forbidden-phrase scan given agent rate-limits). CI workflow updated (SafeTrade flag + spec). Two
debugging fixes during integration: the interrupted agent's broken types (`*/` inside a JSDoc comment)
and an infinite re-render loop (effect depended on the fresh-each-render `useCarUpApi()` object →
depend on stable primitives). Integration-owned edits by the Integrator; components/pages/flag/tests
non-integration. Commits: `9f7224d` (Gate S9-A), feat + docs (this milestone).

Truth audit (Step 0). Backend exists; this milestone adds Gate S9-A (action-authz verification +
route tightening), a server-derived available-actions projection, and the frontend. The frontend
must NOT duplicate the 16-state transition table — it renders server-derived available actions only.
**Non-custodial:** UI must never claim CarUp holds/receives/auto-releases real funds; sandbox only.

**SafeTrade route × authorization matrix (server-derived; service is the authoritative boundary):**
| Endpoint | Purpose | Route mw | Service authority | Scope | Money-sim | Confirm |
| --- | --- | --- | --- | --- | --- | --- |
| GET /safetrade | list cases | auth | participant or privileged | tenant+participant | — | — |
| GET /:id | case detail | auth | assertCanAccess (participant/privileged) | same | — | — |
| GET /:id/timeline | audit timeline | auth | access-scoped | same | — | — |
| GET /:id/eligibility | eligibility verdict | auth | access-scoped (role-safe blockers) | same | — | — |
| GET /:id/milestones | milestone list | auth | access-scoped | same | — | — |
| GET /:id/disputes | dispute list | auth | access-scoped; evidence visibility-scoped | same | — | — |
| POST /safetrade | create txn | auth | buyer/authorized + entitlement `diaspora.safetrade.create`; idempotent | order owner+tenant | — | yes |
| POST /:id/commit | canonical transition | auth | **transition table actorRoles** (BUYER/SELLER/REVIEWER/ADMIN/SYSTEM) enforced; source-state + conditions + dispute + live gate | participant/privileged per action | sandbox via milestone ops | yes |
| POST /:id/milestones | define/record milestone | auth | access-scoped; money ops sandbox-only, reviewer-gated for release | participant/privileged | sandbox hold/capture/release/refund | yes |
| POST /:id/evaluate-release | record release policy eval | **reviewerAuth (incl. dealer ← tighten)** | isPlatformReviewer/admin only (service) | privileged | no money move | yes |
| POST /:id/request-release | request release | auth | participant/privileged; needs held milestone | participant | no (request only) | yes |
| POST /:id/approve-release | approve sandbox release | **reviewerAuth (incl. dealer ← tighten)** | privileged + prior passing eval (evaluated_by reviewer) + high-risk approval | privileged | sandbox release | yes (high-risk warn) |
| POST /:id/cancel | cancel txn | auth | participant authority; blocked past held-funds boundary | participant/privileged | — | yes |
| POST /:id/disputes | open dispute | auth | participant of an eligible txn | participant | hold | yes |
| POST /disputes/:id/evidence | add evidence | auth | authorized participant/reviewer; visibility-scoped | participant/reviewer | — | yes |
| POST /disputes/:id/resolve | resolve dispute | **reviewerAuth (incl. dealer ← tighten)** | isPlatformReviewer/admin only (service) | privileged | sandbox refund/release/cancel | yes |
| POST /payment-webhook | provider sync | none (signature) | signature-authorized; idempotent | — | sandbox | EXCLUDED from UI |

**Gate S9-A targets:** (a) tighten `reviewerAuth` on SafeTrade reviewer routes to drop `dealer`
(service already excludes it — defense-in-depth + route tests); (b) add server-derived
`available-actions` projection (no UI duplication of the transition table); (c) Gate S9-A authz test
suite (~19 cases). UI frontend then renders from available-actions + the role-safe reads only.
Frontend flag `VITE_DIASPORA_SAFETRADE_UI_ENABLED` (default OFF, fail-closed; distinct from backend
`DIASPORA_SAFETRADE_ENABLED` and live-payment).

**Gate S9-A — RESULT (PASSED):** independent audit found the service authority **ALL-CORRECT** (no
genuine gap). Corrections applied: (1) route `reviewerAuth` tightened to drop `dealer` (aligns route
exactly to the service `isPrivileged` boundary; release/resolve = platform reviewer/admin only); (2)
`assertSafeTradeProductionSafety()` now throws a typed **403 `EXTERNAL_ACTIVATION_REQUIRED`** (was a
plain 500) so a live-payment refusal surfaces as the truthful "external-activation-unavailable" denial
— money still never moves. New server-derived **available-actions** projection
`diasporaSafeTradeAvailableActions.js` (`computeAvailableActions`, route `GET /safetrade/:id/available-actions`)
returns only safe metadata (actionKey/labelKey/permitted/disabledReasonCode/confirmationRequired/
reviewerRequired/sandboxOnly/requiredEvidenceCategories) — no raw ids/secrets/risk-scores/SQL; the UI
renders from this (no transition-table duplication). **Tests:** available-actions **19**, authz Gate
S9-A **22**, existing safetrade **47**; full diaspora suite **648/641/0-fail/7-skip**.

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

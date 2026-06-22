# Diaspora Master-Plan Reconciliation Matrix

> Truth-to-paper reconciliation against the canonical directive, performed after Phase 10 backend
> closure (Gate T10). This matrix — not narrative — is the acceptance checklist for the remaining
> program. Status: **COMPLETE** / **PARTIAL** / **DEFERRED** / **BLOCKED**.
> Program branch `claude/diaspora-phases-8-10-production-program` (PR #90, draft, stacked on #81).
> No migration applied to any DB. All high-risk external actions feature-flagged OFF / fail-closed.

Legend for "Migration": *created* = SQL authored, NOT applied to any database (staging apply is EB-1).

---

## Track W — XLSX Workbook Contract

| Row | Status | Files | Tests | Flag | Migration | Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XLSX contract / dependency | COMPLETE | `backend/package.json` (exceljs ^4.4.0) | — | `DIASPORA_XLSX_ENABLED` (off) | n/a | CI `npm ci` green | — | done |
| Template generation | COMPLETE | `workbook/diasporaWorkbookXlsxService.js`, `constants/diaspora/diasporaWorkbookTemplates.js` | `diaspora-workbook-xlsx.test.js` (24) | as above | n/a | validation dropdowns, hidden/protected reference sheet, instructions+privacy, example rows | — | done |
| Parser | COMPLETE | `diasporaWorkbookXlsxService.js#parseWorkbook` | same | — | n/a | outputs exact existing `{templateType,sheets}` shape → reuses JSON validation; formulas read as values; bounds | — | done |
| Export safety | COMPLETE | `diasporaWorkbookXlsxService.js#exportWorkbook`, `diasporaWorkbookUploadSecurity.js` | same | — | n/a | formula-injection neutralization (`= + @ - \t \r`→`'`); redaction; stable IDs | — | done |
| Import workflow | PARTIAL | `diasporaWorkbookXlsxRoutes.js` (mounted) | same | — | n/a | base64 dry-run reuses `runAndPersistDiasporaWorkbookDryRun`; **import stays draft-only** (Phase 1C invariant) | live import execution behind approval; multipart/streaming for very large files | later |
| Entitlement enforcement | DEFERRED | (key `diaspora.workbook.bulk_import` exists in `diasporaEntitlements.js`) | — | `DIASPORA_SUBSCRIPTION_ENFORCEMENT` (off) | n/a | **not wired** to the XLSX path (grep confirms) | wire `requireFeature`/quota into the XLSX dry-run/import boundary | UI-8 follow-up / Wave 6 |
| UI | PARTIAL | `web/src/pages/diaspora/DiasporaWorkbookDryRun.tsx`, `DiasporaWorkbookOperatorConsole.tsx` | `web/e2e/diaspora-workbook-*.spec.ts` (2) | — | n/a | JSON dry-run + operator console exist (Phase 2C) | XLSX download button + .xlsx upload UI | later |
| Tests | COMPLETE | as above | 24 backend + 2 e2e | — | n/a | round-trip, oversized, .xlsm reject, dup detect, formula neutralize | real large-file perf (Gate P) | — |

---

## Track D — Google Drive

| Row | Status | Files | Tests | Flag | Migration | Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Provider abstraction | COMPLETE (scaffold) | `drive/driveProvider.js`, `drive/googleDriveProvider.js` | `diaspora-drive.test.js` | `DIASPORA_DRIVE_ENABLED` (off) | existing (phase1b) | interface + Mock provider; Google live methods throw `EXTERNAL_ACTIVATION_REQUIRED` | implement real Google API calls (needs creds, EB-2) | Drive-hardening wave |
| OAuth / state protection | COMPLETE | `diasporaDriveSyncService.js`, `constants/diaspora/diasporaDriveConstants.js` | same | — | existing | signed state, user/tenant binding, 10-min expiry, one-time nonce, replay reject; prod requires state secret | — | done |
| Secret/token storage boundary | COMPLETE (fail-closed) | same | same | — | existing | tokens **never persisted** (opaque `credential_reference` only); sanitizers strip secrets | bind a real vault before live (EB-2) | Drive-hardening wave |
| Upload/export integration | PARTIAL | drive service + file metadata table | same | — | existing | mock upload + metadata bind (user/tenant/entity/checksum/sync) | wire XLSX export-to-Drive once Drive live | Drive-hardening wave |
| Disabled/live behaviour | COMPLETE | `diasporaDriveConstants.js#assertDriveProductionSafety` | same | — | existing | mock blocked in prod; activation states distinguished | — | done |
| Entitlement enforcement | DEFERRED | (keys `diaspora.drive.connect/export` exist) | — | enforcement flag (off) | — | **not wired** at Drive op boundaries | add `requireFeature` at connect/export | Drive-hardening wave |
| Tests | PARTIAL | `diaspora-drive.test.js`, `web/e2e/diaspora-drive-connections.spec.ts` | scopes/state/replay/redaction/revoked/idempotent/prod-mock | — | — | strong unit coverage | live sandbox E2E when creds provided | Drive-hardening wave |

---

## Phase 8 — Subscription Gate

| Row | Status | Files | Tests | Flag | Migration | Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Schema | COMPLETE | `migrations/20260621120000_…subscription_entitlements.sql` | — | — | **created** (not applied) | 6 tables + atomic `diaspora_reserve_usage_atomic` RPC; RLS/grants/search_path | apply to staging (EB-1) | done/closed |
| Entitlement service | COMPLETE | `diasporaEntitlementService.js`, `constants/diaspora/diasporaEntitlements.js` | `diaspora-entitlements.test.js` (19) | — | — | tenant-plan + per-user; checkFeature/checkQuota/reserve/commit/release/explainDenial/admin-override | — | done |
| Quotas | COMPLETE | same + RPC | same + `diaspora-entitlement-enforcement.test.js` (8) | — | — | atomic reserve→commit/release; idempotent; failed op frees quota | real-PG concurrency (EB-1) | done |
| Operation enforcement | PARTIAL | `diasporaEntitlementGuard.js`; wired in `diasporaSupplyDocumentService` (stock.publish), `diasporaBuyerOrderService` (rfq.create), `diasporaSafeTradeTransactionService` (safetrade.create) | enforcement tests | `DIASPORA_SUBSCRIPTION_ENFORCEMENT` (off) | — | enforced on 3 ops, byte-identical when flag off | wire remaining ops (workbook bulk import, AI execute, container reserve, drive, API) | Wave 6 |
| Subscription API | COMPLETE | `routes/diasporaSubscriptionRoutes.js` (mounted) | `diaspora-subscription-routes.test.js` (15) | — | — | plans/status/entitlements/usage + checkout/portal/change/cancel (sandbox) | — | done |
| Webhook | COMPLETE | same + `server.js` rawBody | same | `DIASPORA_BILLING_LIVE` (off) | — | signature-verified, idempotent on (provider,event_id), syncs subscription; never trusts client status | live provider (EB-3) | done (sandbox) |
| Frontend | **COMPLETE** | `web/src/pages/diaspora/DiasporaSubscription.tsx` + `components/diaspora/subscription/{PlanComparison,SubscriptionStatusCard,UsageDashboard,EntitlementDenialPanel,SubscriptionActions}.tsx` + helpers + `config/subscriptionFlag.ts`; integration: types(8)/hooks(8)/App route/featureRegistry | unit **55** | `VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED` (off, fail-closed) | n/a | plan comparison (API-driven), status, usage, 7-category explainable denials, sandbox-only actions, full a11y; adversarial UI review PASS | wire entitlement enforcement to more ops (separate) | UI-8 done |
| E2E | **COMPLETE** | `web/e2e/diaspora-subscription.spec.ts` (mocked API) + CI workflow (flag-on dev server + spec added) | **18/18** | as above | n/a | 22 scenarios incl. synthetic Free, sandbox state, usage/unlimited, quota/feature denials, read-only member, manager controls, direct-403, confirmations, dup-prevent, failure/missing-tenant states, sandbox wording, keyboard, aria-live, flag-off, siblings unaffected | — | UI-8 done |
| Staging / concurrency proof | BLOCKED | `tests/staging/…` harness | — | — | — | needs `DIASPORA_STAGING_DATABASE_URL` | run atomic-quota concurrency on staging | EB-1 |

---

## Phase 9 — SafeTrade

| Row | Status | Files | Tests | Flag | Migration | Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| State machine | COMPLETE | `constants/diaspora/diasporaSafeTradeStatuses.js`, `safetrade/diasporaSafeTradeTransactionService.js` | `diaspora-safetrade.test.js` (47) | `DIASPORA_SAFETRADE_ENABLED` (off) | **created** (130000) | transition table; atomic transition RPC; CRITICAL audit in-txn | apply to staging (EB-1) | done |
| Milestones | COMPLETE | `safetrade/diasporaSafeTradeMilestoneService.js` | same | — | created | reconcile to total; idempotent sandbox hold/capture/release/refund | — | done |
| Assurance gates | COMPLETE | eligibility + release-policy services | same | — | created | explainable blockers w/ evidence refs; held-payment + passed-policy required; high-risk reviewer approval | — | done |
| Disputes | COMPLETE | `safetrade/diasporaSafeTradeDisputeService.js` | same | — | created (131000) | create/evidence/assign/resolve; opening a dispute holds + blocks release | — | done |
| Delivery confirmation | COMPLETE | `safetrade/diasporaSafeTradeDeliveryService.js` | same | — | created | **buyer-only** confirm (ST-1 fix); emits reputation-**eligibility** event only (no reputation write) | — | done |
| Payment-provider boundary | COMPLETE (sandbox) | `safetrade/safeTradePaymentProvider.js` | same | `DIASPORA_SAFETRADE_LIVE_PAYMENT` (off) | — | sandbox only; live throws `EXTERNAL_ACTIVATION_REQUIRED` at 4 layers | legal+provider+creds (EB-4) | done (sandbox) |
| Routes | COMPLETE | `routes/diasporaSafeTradeRoutes.js` (mounted, gate scoped `/safetrade`) | same | — | — | §48 endpoints; route-shadowing fixed (deb0b3c) | — | done |
| Frontend | **COMPLETE** | `web/src/pages/diaspora/DiasporaSafeTrade{,Detail}.tsx` + `components/diaspora/safetrade/{SafeTradeAssuranceNotice,StatusBanner,Timeline,EligibilityPanel,Milestones,Actions,Disputes}.tsx` + helpers + `config/safeTradeFlag.ts`; integration: 16 types/17 hooks (allowlisted `SafeTradeCommitEvent`)/App routes/registry | unit **11** | `VITE_DIASPORA_SAFETRADE_UI_ENABLED` (off, fail-closed) | n/a | case list+detail; canonical timeline; eligibility blockers; sandbox milestones; **actions rendered only from server-derived available-actions**; reviewer/participant separation + high-risk; dispute privacy (visibleEvidence); **non-custodial wording**; full a11y; forbidden-phrase scan clean | UI-9 done |
| E2E | **COMPLETE** | `web/e2e/diaspora-safetrade.spec.ts` (mocked) + CI workflow (flag-on dev server + spec) | **10/10** (9 + 1 flaky-recovered) | as above | n/a | list/detail render, timeline, non-custodial wording, buyer vs reviewer action visibility, NEEDS_REVIEWER/NEEDS_EVALUATION disabled reasons, sandbox confirmation, dispute private-evidence hidden, 403 access state, keyboard/focus, siblings unaffected | UI-9 done |
| Residual hardening | TRACKED | — | — | — | — | risk **ST-3** (auxiliary audit-after-commit; single-actor approval; webhook in-memory dedup) | close before EB-4 live payment | Wave 6 / pre-EB-4 |

---

## Phase 10 — Trade Graph Intelligence

| Row | Status | Files | Tests | Flag | Migration | Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Event model | COMPLETE | `constants/diaspora/diasporaTradeGraphConstants.js` | `diaspora-trade-graph-constants.test.js` (14) | `DIASPORA_TRADE_GRAPH` (off) | **created** (140000) | canonical event/node/edge enums + mapping incl. SafeTrade | — | done |
| Graph schema | COMPLETE | migration 140000 | — | — | created (not applied) | 7 tables, RLS×7, REVOKE PUBLIC×9, 0 PUBLIC grants, service_role writes | apply to staging (EB-1) | done |
| Projections | COMPLETE | `tradegraph/diasporaTradeGraphProjectionService.js` | `diaspora-trade-graph-projection.test.js` (33) | — | created | idempotent (dedup by event id); self-contained `projectPendingEvents`; SAVEPOINT isolation; durable dead-letters | — | done |
| Replay / recovery | COMPLETE | same | same | — | — | crash-before-completion → retryable; replay converges (content-addressable); out-of-order+duplicate deterministic; admin rebuild | real-PG validation (TG-1/EB-1) | done |
| Tenant isolation | COMPLETE | `tradegraph/diasporaTradeGraphService.js`, `…IntelligenceService.js` | `diaspora-trade-graph-queries.test.js` | — | — | neighbor-tenant re-assertion on every traversal JOIN; server-derived tenant; adversarial PASS | — | done |
| PII redaction | COMPLETE | `tradegraph/diasporaTradeGraphRedaction.js` | `diaspora-trade-graph-redaction.test.js` | — | — | recursive nested/array; participant ids + document ids tokenized; entityId pseudonymized; **AI payload capture proves raw PII absent** | — | done |
| AI-safe reads | COMPLETE | `…IntelligenceService.js#structuredContextForAi` | same | `DIASPORA_AI_GRAPH_INSIGHTS` (off) | — | redacted context only; AI never writes edges (holistic review confirmed) | — | done |
| Routes | COMPLETE | `routes/diasporaTradeGraphRoutes.js` (mounted `/trade-graph`, gate scoped) | `diaspora-trade-graph.test.js`, `…-route-isolation.test.js` (12) | — | — | §60 endpoints; admin-only rate-limited rebuild; **route-shadowing proven** | — | done |
| Frontend / dashboard | DEFERRED | — | — | — | — | none | tenant-scoped summary / provenance / blocker+match panels / projection status / **AI-safe redacted only, no raw PII** / a11y | **UI-10** |
| E2E | DEFERRED | — | — | — | — | none | dashboard e2e | **UI-10** |

---

## Gate P — Production Readiness

| Row | Status | Files / Evidence | Remaining | Milestone |
| --- | --- | --- | --- | --- |
| Migrations | PARTIAL | 4 created (120000/130000/131000/140000), all additive + Up/Down; **none applied** | apply to staging in order; advisors | EB-1 / Wave 7 |
| Security | PARTIAL | per-phase adversarial reviews done (Phase 9 ST-1/ST-2 fixed; Phase 10 CRITICAL+HIGH fixed, holistic PASS); **CR-1 credential leak OPEN** | Wave 6 cross-phase adversarial review; CR-1 rotation+history purge | Wave 6 / CR-1 |
| Accessibility | PARTIAL | **UI-8 + UI-9 a11y done** (headings, labels, keyboard, focus return, aria-live action status, no color-only, accessible timeline/quota/milestone text, reduced-motion) | a11y for UI-10 | UI waves |
| Observability | PARTIAL | correlation IDs + critical audit present; projection lag / dead-letter / webhook-failure / quota-anomaly alerts designed in runbooks | implement metrics + alerts + dashboards | Wave 7 |
| Performance | DEFERRED | graph perf budgets in design; bounded-depth CTEs + materialized summaries | large-tenant graph + workbook + quota load tests | Wave 7 |
| Staging proof | BLOCKED | harness exists; H9 + atomic-quota + graph projection need a DB | set `DIASPORA_STAGING_DATABASE_URL`, run, label `SKIPPED — SECRET UNAVAILABLE` until then | EB-1 |
| Release runbook | COMPLETE | `DIASPORA_PRODUCTION_RELEASE_RUNBOOK.md` (+ Trade Graph activation steps) | rehearse | Wave 7 |
| Rollback runbook | COMPLETE | `DIASPORA_PRODUCTION_ROLLBACK_RUNBOOK.md` (+ Trade Graph rollback) | rehearse | Wave 7 |
| Known external boundaries | COMPLETE (documented) | CR-1, EB-1..EB-5, PD-1(resolved); see Discovery §8 + Risk Register | activation only on explicit approval | — |

---

## External boundaries still inactive (no change without explicit approval)
CR-1 (credential rotation + history purge), EB-1 (staging secret → H9 + quota + graph proofs),
EB-2 (Drive OAuth + vault), EB-3 (live billing), EB-4 (real-money SafeTrade + legal),
EB-5 (production migration/deploy). PR #90 stays draft; no merge.

## Next milestones (acceptance order)
**UI-8** Phase 8 subscription UI → **UI-9** Phase 9 SafeTrade UI → **UI-10** Phase 10 Trade Graph
dashboard (separate coherent commits) → Drive hardening → Wave 6 integration review → Wave 7 readiness
→ final directive report. Integration-owned web files (`App.tsx`, `featureRegistry.ts`, `useCarUpApi.ts`,
`types/index.ts`) serialized by the Program Integrator.

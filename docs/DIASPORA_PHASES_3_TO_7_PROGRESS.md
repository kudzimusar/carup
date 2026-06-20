# Diaspora Trade OS — Phases 3–7 Progress Ledger

> Durable session memory. Updated after every milestone commit so another agent can resume without
> guessing. Directive: `docs/CLAUDE_CODE_DIASPORA_PHASES_3_TO_7_MASTER_DIRECTIVE.md`.

- **Program branch**: `claude/diaspora-phases-3-7-program`
- **Base**: `main` @ `3ac2ff23a60f545bbafed8d4d256277209f3adf9` (Phase 2C)
- **PR**: _draft, opened after baseline commit_
- **Production Supabase touched**: NO
- **`stash@{0}` touched**: NO
- **Unrelated workstreams touched**: NO

## Status Summary

| Phase | Title | State |
| --- | --- | --- |
| Discovery | Audit + ledger + draft PR | DONE (baseline) |
| 3 | Online Stock & Supply Documents | CODE-COMPLETE |
| 4 | Buyer Orders & Reverse RFQ | CODE-COMPLETE |
| 5 | AI Command Hardening | CODE-COMPLETE |
| 6 | Container Co-Loading | NOT STARTED |
| 7 | Google Drive Integration | NOT STARTED |

State legend: NOT STARTED · IN PROGRESS · CODE-COMPLETE · CODE-COMPLETE PENDING EXTERNAL ACTIVATION · BLOCKED · DONE.

---

## Milestone: Discovery Baseline

- **Objective**: Verify baseline, create program branch, audit reusable surfaces and schema, open
  draft PR.
- **Repository findings**: See `docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md`. Phase 3–7 tables already
  exist (Phase 1B foundation migration); remaining work is service/route/frontend/test layers.
- **Schema findings**: All target tables present; only additive `idempotency_key` on
  `diaspora_stock_ledger` anticipated.
- **Files changed**: `docs/DIASPORA_PHASES_3_TO_7_DISCOVERY.md`,
  `docs/DIASPORA_PHASES_3_TO_7_PROGRESS.md`, `docs/CARUP_WORKSTREAM_SEPARATION_AND_HANDOFF.md`
  (Phase 2C reconciled to merged).
- **Migration status**: none yet.
- **Endpoints**: none yet.
- **Frontend routes**: none yet.
- **Tests run**: n/a (docs only).
- **Known limitations**: none.
- **Blockers**: none.
- **Commit SHA**: _set on commit_.
- **Next milestone**: Phase 3 — stock ledger + supply documents.

---

## Milestone: Phase 3 — Online Stock & Supply Documents

- **Objective**: Seller-facing, ledger-backed stock + controlled supply-document publication.
- **Repository findings**: Tables `diaspora_stock_items`, `diaspora_stock_ledger`,
  `diaspora_supply_documents` already exist (Phase 1B). No existing service/route layer; built here.
- **Schema findings / migration**: additive migration
  `database/migrations/20260620120000_diaspora_phase3_stock_ledger_idempotency.sql` adds
  `idempotency_key` + partial unique index `(stock_item_id, idempotency_key)` and a time index.
  **Not applied to production.**
- **Files changed**:
  - `backend/tests/helpers/mockSupabase.js` (shared in-memory mock client)
  - `backend/services/diaspora/diasporaServiceUtils.js` (resolveClient + sealed appendAudit)
  - `backend/constants/diaspora/diasporaStockConstants.js`
  - `backend/services/diaspora/diasporaStockLedgerService.js`
  - `backend/services/diaspora/diasporaStockService.js`
  - `backend/services/diaspora/diasporaSupplyDocumentService.js`
  - `backend/routes/diasporaStockRoutes.js` (+ mounted in `backend/routes/diasporaRoutes.js`)
  - `backend/tests/diaspora-stock.test.js`
  - `web/src/types/index.ts` (stock/supply types)
  - `web/src/hooks/useCarUpApi.ts` (11 stock/supply methods)
  - `web/src/lib/apiClient.ts` (normalize nested `{error:{message}}` → actionable copy)
  - `web/src/pages/diaspora/DiasporaStockManager.tsx`
  - `web/src/App.tsx` (`/diaspora/stock`), `web/src/config/featureRegistry.ts` (`diaspora.stock-manager`)
  - `web/e2e/diaspora-stock-supply.spec.ts`
- **Endpoints added**: `GET/POST /api/diaspora/stock`, `GET/PATCH /api/diaspora/stock/:id`,
  `GET/POST /api/diaspora/stock/:id/ledger`, `POST /api/diaspora/stock/:id/reserve`,
  `POST /api/diaspora/stock/:id/release-reservation`, `GET/POST /api/diaspora/supply-documents`,
  `GET/PATCH /api/diaspora/supply-documents/:id`, `POST .../publish`, `POST .../unpublish`.
- **Frontend routes added**: `/diaspora/stock` (roles dealer/admin + platform/reviewer at runtime).
- **Security/integrity**: tenant + ownership scoping on every endpoint; quantities change only via
  ledger; available never negative; reservations bounded by availability; idempotent movements;
  ADJUST_WITH_APPROVAL gated to reviewer/admin + approval metadata; sealed audit on every mutation.
- **Tests run / results**: backend `node --test backend/tests/diaspora-stock.test.js` → 12/12 pass;
  e2e `diaspora-stock-supply.spec.ts` → 3/3 pass; tsc OK; route-validation 7/7; Phase 2C regression
  18/18; `npm run build` OK (existing chunk-size warning only).
- **Known limitations**: balances are transactionally maintained on the item row from ledger events
  (not recomputed per-read); concurrency relies on Supabase row updates (acceptable for current load).
- **Blockers**: none.
- **Commit SHA**: _set on commit_.
- **Next milestone**: Phase 4 — Buyer Orders & Reverse RFQ.

## Milestone: Phase 4 — Buyer Orders & Reverse RFQ

- **Objective**: Buyer demand documents, deterministic matching, seller RFQ responses, transactional
  + idempotent single-quote acceptance.
- **Repository findings / schema**: Reuses `diaspora_import_orders` + `diaspora_import_quotes`. RFQ
  lifecycle stored in `metadata.rfq` (additive, no migration). Quote logical SUBMITTED maps to DB
  `ISSUED` to satisfy the existing CHECK constraint.
- **Files changed**:
  - `backend/constants/diaspora/diasporaRfqConstants.js`
  - `backend/services/diaspora/diasporaDemandSupplyMatchingService.js` (explainable scoring)
  - `backend/services/diaspora/diasporaBuyerOrderService.js`
  - `backend/services/diaspora/diasporaRfqService.js`
  - `backend/routes/diasporaBuyerOrderRoutes.js` (+ mounted in `diasporaRoutes.js`)
  - `backend/tests/diaspora-rfq.test.js`
  - `web/src/types/index.ts`, `web/src/hooks/useCarUpApi.ts`
  - `web/src/pages/diaspora/DiasporaReverseRfq.tsx`
  - `web/src/App.tsx` (`/diaspora/rfq`), `web/src/config/featureRegistry.ts` (`diaspora.reverse-rfq`)
  - `web/e2e/diaspora-reverse-rfq.spec.ts`
- **Endpoints added**: `GET/POST /api/diaspora/buyer-orders`, `GET/PATCH /buyer-orders/:id`,
  `POST /buyer-orders/:id/publish-rfq`, `GET /buyer-orders/:id/matches`,
  `POST /buyer-orders/:id/quotes`, `POST /buyer-orders/:id/accept-quote`, `GET /rfqs`,
  `PATCH /quotes/:id`, `POST /quotes/:id/submit`, `POST /quotes/:id/withdraw`.
- **Frontend routes added**: `/diaspora/rfq` (owner/dealer/admin; runtime buyer/seller split).
- **Security/integrity**: buyers see only own orders; sellers see only published RFQs (not own);
  matching excludes unavailable/private stock; quote submit idempotent on key; acceptance is
  transactional (rejects siblings) + idempotent; only DRAFT quotes editable; sealed audit on
  publish/accept/submit. No payment-release/compliance controls exposed.
- **Tests run / results**: backend `diaspora-rfq.test.js` → 11/11 pass; e2e
  `diaspora-reverse-rfq.spec.ts` → 4/4 pass; tsc OK; route-validation 7/7; build OK.
- **Known limitations**: matching is deterministic over published stock (no AI scoring, by design);
  participant-table access not used here (buyer/tenant/reviewer scoping instead).
- **Blockers**: none.
- **Commit SHA**: _set on commit_.
- **Next milestone**: Phase 5 — AI Command Hardening.

## Milestone: Phase 5 — AI Command Hardening

- **Objective**: Controlled AI command pipeline — text → draft action with risk gates; high-risk
  execution blocked; AI never directly mutates domain records.
- **Repository findings / schema**: `diaspora_ai_commands` exists (Phase 1B). No migration needed.
- **Files changed**:
  - `backend/constants/diaspora/diasporaAiConstants.js` (risk tiers, intent catalogue)
  - `backend/services/diaspora/diasporaAiIntentParser.js` (deterministic parser)
  - `backend/services/diaspora/diasporaAiCommandService.js` (pipeline + execution adapter)
  - `backend/routes/diasporaAiCommandRoutes.js` (+ mounted in `diasporaRoutes.js`)
  - `backend/tests/diaspora-ai-command.test.js`
  - `web/src/types/index.ts`, `web/src/hooks/useCarUpApi.ts`
  - `web/src/pages/diaspora/DiasporaAiCommandCenter.tsx`
  - `web/src/App.tsx` (`/diaspora/ai-commands`), `web/src/config/featureRegistry.ts` (`diaspora.ai-command-center`)
  - `web/e2e/diaspora-ai-command-center.spec.ts`
- **Endpoints added**: `POST /api/diaspora/ai-commands/parse`, `POST/GET /ai-commands`,
  `GET /ai-commands/:id`, `POST /ai-commands/:id/{confirm,approve,reject,execute}`.
- **Frontend routes added**: `/diaspora/ai-commands` (dealer/admin/government).
- **Security/integrity**: LOW → draft-only auto; MEDIUM → confirmation required; HIGH → reviewer
  approval but **execution always blocked** (even when approved). Execution re-validates
  permission/risk/gate (never parse-time auth). Low-confidence/ambiguous → NEEDS_REVIEW (cannot
  execute). Duplicate fingerprint de-dupe. RESERVE_STOCK executes only via the ledger (no direct
  quantity write). AI cannot release escrow / approve compliance / verify documents / complete
  shipments / override ledger. Tenant + requester isolation. Sealed audit at every step.
- **Tests run / results**: backend `diaspora-ai-command.test.js` → 12/12 pass; e2e
  `diaspora-ai-command-center.spec.ts` → 5/5 pass; tsc OK; route-validation 7/7; build OK.
- **Known limitations**: deterministic keyword parser only (LLM adapter seam documented, not wired);
  voice input is reported as unavailable (text-only this phase, per directive §21).
- **Blockers**: none.
- **Commit SHA**: _set on commit_.
- **Next milestone**: Phase 6 — Container Co-Loading.

## Milestone: Phase 6 — Container Co-Loading
_pending_

## Milestone: Phase 7 — Google Drive Integration
_pending_

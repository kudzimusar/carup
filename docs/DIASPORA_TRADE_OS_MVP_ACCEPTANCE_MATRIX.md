# Diaspora Trade OS — MVP Acceptance Matrix

> Truth audit of the CarUp Diaspora Trade OS against **real routes + services + DB tables/RPCs + tests**,
> not docs/constants/placeholders. Established by 5 read-only code audits over PR #90 head `92bbc32`
> (worktree `claude/diaspora-phases-8-10-production-program`, stacked on PR #81).
>
> **Status legend:** `COMPLETE` (real, wired, tested end-to-end) · `PARTIAL` (backend real+tested but no/partial
> UI, or a real gap in one link) · `MISSING` · `DEFERRED` (intentionally post-MVP) · `EXTERNAL` (external
> activation required — EB-1…EB-5).
> A row is **never** COMPLETE on the strength of a constant/migration/placeholder alone.
>
> **Cross-cutting evidence columns (apply to every backend row):**
> - **Migration:** all Diaspora tables/RPCs ship in `database/migrations/` (see `DIASPORA_TRADE_OS_MIGRATION_LEDGER.md`); **none applied to any DB by this program.**
> - **Staging evidence:** `BLOCKED — SECRET UNAVAILABLE (EB-1)` for every row (H9 staging integration is `SKIPPED — SECRET UNAVAILABLE`).
> - **Production evidence:** `NOT APPLIED (EB-5)` for every row (prod Supabase `vhmnajoeicasaigiophh` forbidden until explicit release authorization).

## A. Core commerce chain

| # | Capability | Status | Route (file:line) | Service (file:line) | Table / RPC | Frontend | Test evidence | Flag |
|---|---|---|---|---|---|---|---|---|
| 1 | Buyer trade profile | PARTIAL | `diasporaRoutes.js:134,142` | `diasporaTradeProfileService.js` create/get/verify | `diaspora_trade_profiles` (013) | **none** (no dedicated hook/page) | `diaspora-workflow`, `diaspora-supabase-integration` | — |
| 2 | Seller/supplier trade profile | PARTIAL | `diasporaRoutes.js:134,138,144` | `diasporaTradeProfileService.js` verify/suspend | `diaspora_trade_profiles` | **none** | same | — |
| 3 | Vehicle import request | COMPLETE | `diasporaRoutes.js:82`; `diasporaBuyerOrderRoutes.js:34` | `createImportOrder` :36 / `createBuyerOrder` :52 | `diaspora_import_orders` (013) | `NewDiasporaImportOrder` `/diaspora/imports/new` | `diaspora-rfq`, `diaspora-workflow`, **integrated 30** | — |
| 4 | Parts request | COMPLETE | `diasporaBuyerOrderRoutes.js:34` | `createBuyerOrder` (order_type=parts) :52 | `diaspora_import_orders` | `DiasporaReverseRfq` | `diaspora-rfq`, e2e `diaspora-reverse-rfq`, **integrated 31** | — |
| 5 | Seller stock | **PARTIAL** | create `diasporaStockRoutes.js:37`; **no publish route** | `createStockItem` :27 (compat fields real) | `diaspora_stock_items` (`publication_status` hard-set `PRIVATE` :69) | `DiasporaStockManager` (create; **no publish control**) | `diaspora-stock`; **integrated 31** | — |
| 6 | Supply document | COMPLETE | `diasporaStockRoutes.js:78,93` | `diasporaSupplyDocumentService` (state machine + gate) | `diaspora_supply_documents` | `DiasporaStockManager:353` | `diaspora-stock:133` | — |
| 7 | Reverse RFQ | COMPLETE | `diasporaBuyerOrderRoutes.js:43` | `publishRfq` :153 | `diaspora_import_orders.metadata.rfq` | `DiasporaReverseRfq:108` | `diaspora-rfq`, e2e; **integrated 30/31** | — |
| 8 | Seller quotation | COMPLETE | `diasporaBuyerOrderRoutes.js:54` | `createQuote` :48 | `diaspora_import_quotes` | `DiasporaReverseRfq:132` | `diaspora-rfq`, e2e; **integrated 30/31** | — |
| 9 | Quote acceptance (atomic) | COMPLETE | `diasporaBuyerOrderRoutes.js:49` | `acceptQuote` :195 → RPC | **RPC** `diaspora_accept_quote_atomic` | `DiasporaReverseRfq:120` | `diaspora-rfq:104-184`; **integrated 30/31** | — |
| 10 | Stock reservation (ledger) | COMPLETE | `diasporaStockRoutes.js:62,57` | `reserveStock` :180 → `appendStockMovement` :139 | **RPC** `diaspora_append_stock_movement_atomic` | `DiasporaStockManager:129` | `diaspora-stock`, H1 tests; **integrated 31** | — |
| 11 | Payment milestones | PARTIAL | `diasporaRoutes.js:121,283` | `addPaymentMilestone` :212 | `diaspora_payment_milestones` (013) | **none** (nested read only) | `diaspora-workflow`, `diaspora-supabase-integration` | — |

## B. Documents, logistics, compliance, identity

| # | Capability | Status | Route (file:line) | Service (file:line) | Table / RPC | Frontend | Test evidence |
|---|---|---|---|---|---|---|---|
| 12 | Document upload | COMPLETE | `diasporaRoutes.js:103,154` | `createTradeDocument` :49 | `diaspora_trade_documents` (013) | `DiasporaImportDocuments` | `diaspora-supabase-integration`, `diaspora-ocr-route` |
| 13 | OCR | COMPLETE | `diasporaRoutes.js:160` (reviewerAuth) | `DocumentIntelligenceService.extractDocumentData`; `recordDocumentExtraction` :129 | `diaspora_trade_document_extractions` | `runDiasporaOcr` hook | **`diaspora-ocr-route`** |
| 14 | Document verification | COMPLETE | `diasporaRoutes.js:245-248` (reviewerAuth) | `verifyTradeDocument` :153 / reject :179 | `diaspora_trade_document_verifications` | verify/reject hooks | `diaspora-supabase-integration` |
| 15 | Container listing | COMPLETE | `diasporaContainerMarketplaceRoutes.js:27` | `createContainer` :97 | `diaspora_container_shipments` (013) | `DiasporaContainerMarketplace` | `diaspora-container-marketplace` |
| 16 | Cargo reservation | COMPLETE | `diasporaContainerMarketplaceRoutes.js:39` | `requestReservation` :150 | `diaspora_cargo_reservations` | `DiasporaContainerMarketplace` | `diaspora-container-marketplace`; **integrated 30/31** |
| 17 | Reservation approval (overfill guard) | COMPLETE | `diasporaContainerMarketplaceRoutes.js:45` | `approveReservation` :209 → RPC | **RPC** `diaspora_approve_cargo_reservation_atomic` (overfill guard) | `approveDiasporaMarketplaceReservation` hook | `diaspora-container-marketplace` (overfill); **integrated 30/31** — *caveat: legacy non-atomic path `diasporaRoutes.js:264` skips the recheck* |
| 18 | Shipment creation | COMPLETE | `diasporaRoutes.js:270` | `createShipment` :29 (logistics authz) | `diaspora_shipments` (013) | `DiasporaImportShipment` | `diaspora-logistics-auth` |
| 19 | Shipment stage timeline | COMPLETE | `diasporaRoutes.js:273,272` | `updateShipmentStage` :107 / `getShipmentTimeline` :139 | `diaspora_shipment_stage_events` | `DiasporaImportShipment` (client-derived timeline) | e2e `diaspora-shipment`, `diaspora-logistics-auth` — *caveat: UI does not consume the stage-events endpoint* |
| 20 | Compliance review | PARTIAL | `diasporaRoutes.js:277-280` (reviewerAuth) | `createComplianceReview` :8 / `updateComplianceReview` :48 | `diaspora_compliance_reviews` (013) | `DiasporaComplianceAdmin` **read-only** (no approve action) | `diaspora-supabase-integration` |
| 21 | Government-document footprint | PARTIAL | `diasporaRoutes.js:129` | `getGovernmentFootprint` :39 | `vehicle_government_documents` (013) | **none** | `diaspora-workflow` |
| 22 | Zimbabwe Ready gate | COMPLETE | `diasporaRoutes.js:112` (stages PATCH) | **gate** `assertZimbabweReadyPrerequisites` :56-67 (invoked :100-102) | `vehicle_government_documents`; transition table | (stages PATCH not in hook → not buyer-driveable) | **`diaspora-workflow:116-119`; integrated 30 (contract)** |
| 23 | Vehicle import record | PARTIAL | `diasporaRoutes.js:125` (reviewerAuth) | `linkVehicleImportRecord` :239 (VERIFIED guard :243) | `vehicle_import_records` (013) | **none** | `diaspora-workflow:134-138`; **integrated 30 (contract)** |
| 24 | VIN/chassis linkage | PARTIAL | (via #23) | `linkVehicleImportRecord` sets `linked_vehicle_vin`/`vehicle_vin`/`chassis` :267 | `diaspora_import_orders.linked_vehicle_vin` → `vehicles.vin` | **none** | `diaspora-workflow`; **integrated 30 (contract)** |
| 25 | Local CarUp vehicle identity handoff | **PARTIAL** (DEFERRED for the evidence write) | — | VIN foreign-key association only | FK → `vehicles.vin` | **none** | **none** — *the single genuine integration gap: no evidence/passport-timeline/ownership write from the import flow* |

## C. Passports, events, workbook, cross-cutting

| # | Capability | Status | Evidence (file:line) | Frontend | Test |
|---|---|---|---|---|---|
| 26 | Order Passport | PARTIAL | backend `getImportOrder` :98-111 joins 8 tables; audit `diasporaRoutes.js:117` | `DiasporaImportDetail` renders ~3/12 sections; audit not surfaced | nested reads |
| 27 | Stock Passport | MISSING (consolidated view) | `getStockItem` :130 flat select; ledger `:191` | `DiasporaStockManager` ops console (quantity history yes; no passport, provenance thin) | e2e `diaspora-stock-supply` |
| 28 | Notifications | COMPLETE | `diasporaNotificationService.js:8,42` | `notification_queue` reads | indirect (caveat: `/diaspora/notifications` returns *preferences*) |
| 29 | Audit trail | COMPLETE | `diasporaAuditService.js:12` `writeDiasporaAudit` (SHA-256 seal); ~20 write sites | reads exist; not surfaced in order UI | **`diaspora-audit-policy`**; seal asserted in `diaspora-stock`, integrated 31 |
| 30 | Reputation eligibility/outcome | COMPLETE | eligibility emit `...DeliveryService.js:340` (N4, never auto-writes); `createReputationRecord` `diasporaReputationService.js:5` | legacy read | `diaspora-safetrade:382,401` (asserts NO auto-write) |
| 31 | Workbook template | COMPLETE | `GET /workbook/template.xlsx` → `generateTemplate` `diasporaWorkbookXlsxService.js:114` (real exceljs) | — | `diaspora-workbook-xlsx:110` |
| 32 | XLSX parser | COMPLETE | `parseWorkbook` :203 (`exceljs` `workbook.xlsx.load`) | — | `diaspora-workbook-xlsx:175` |
| 33 | Workbook dry-run | COMPLETE | `validateDiasporaWorkbookDryRun` :438 (`wroteToDatabase:false`) | — | `diaspora-workbook:296,565` |
| 34 | Confirmed import / truthful deferral | **DEFERRED** | `importDiasporaWorkbook` :19-29 **throws by design**; `execute-drafts` is draft-only + direct inserts + no atomic rollback | — | `diaspora-workbook:630` (asserts reject) — **Classification B (Dry-Run MVP)** |
| 35 | Workbook export | PARTIAL | `exportWorkbook` :341 renders caller rows; DB-sourced export throws deferred | — | `diaspora-workbook-xlsx` |
| 36 | Tenant isolation | COMPLETE | RLS `013:503`, `014:51`; server-derived tenant `authMiddleware.js:88-100` | — | `diaspora-trade-graph-route-isolation`, `diaspora-stock`, `issue77-access-containment-followup` |
| 37 | Role authorization | COMPLETE | `authorizeRole()` `authMiddleware.js:38-134` on every mutation | hidden-controls convenience only | `auth-middleware`, `diaspora-route-authorization`, `diaspora-safetrade-authz` |
| 38 | Idempotency | COMPLETE | stock/safetrade unique keys + RPC `IDEMPOTENCY_CONFLICT` | — | `diaspora-stock:80`, `diaspora-safetrade:423`, integrated 31 |
| 39 | Rollback/recovery | PARTIAL | atomic `SECURITY DEFINER` RPCs for money/state; **workbook draft path not atomic**; migrations forward-only (many no down script) | — | `diaspora-safetrade`, `diaspora-stock` |
| 40 | SafeTrade sandbox assurance | COMPLETE | `assertSafeTradeProductionSafety()` 403 `EXTERNAL_ACTIVATION_REQUIRED`; `SAFETRADE_APPROVED_LIVE_PROVIDERS=[]`; DB CHECK `live_payment=false` | UI-9 (flag OFF, non-custodial) + ST-4B | `diaspora-safetrade` (sandbox-only, no real provider) |

## Summary counts (40 rows)

- **COMPLETE:** 22 — rows 3,4,6,7,8,9,10,12,13,14,15,16,17,18,19,22,28,29,30,31,32,33,36,37,38,40 *(backend real + tested; several also fully wired in the UI)*.
- **PARTIAL:** 11 — 1,2,5,11,20,21,23,24,25,26,35,39 *(backend real but UI absent, or one real gap in the link)*.
- **MISSING:** 1 — 27 (Stock Passport consolidated view).
- **DEFERRED:** 1 — 34 (confirmed workbook import; Dry-Run MVP = classification **B**).
- **EXTERNAL (all rows, deploy dimension):** staging `BLOCKED (EB-1)`, production `NOT APPLIED (EB-5)`.

## Genuine gaps blocking full end-to-end (minimal-build backlog)

1. **Row 5 — stock publication path (backend):** `publication_status` can never leave `PRIVATE`, so demand↔supply matching never surfaces API-created stock. Smallest fix: a controlled publish route/service transition (reviewer/owner authz), not a schema change.
2. **Row 25 — vehicle identity → CarUp evidence/ownership handoff (backend):** the import flow only sets a VIN FK; no `vehicle_evidence`/passport-timeline/ownership write. Central to the stated objective; DEFERRED pending the ownership-layer integration.
3. **Rows 26/27 — Order/Stock Passport read pages (frontend):** compose from existing endpoints (`getImportOrder` + government-footprint + audit + shipment-timeline + reputation for Order; `getStockItem` + ledger + supply-docs + trade-profile for Stock). Photos + stock dispute/provenance need new schema → defer those sections.
4. **Rows 1,2,11,20,21,23,24 — per-step UI:** backend complete + tested; no dedicated UI. Build minimal read/action controls only as the journey requires (directive C/D), not a dashboard.
5. **Row 39 — workbook draft executor atomicity + down-migrations** (close before EB-4/EB-5).

The **integrated MVP journeys** (`backend/tests/diaspora-trade-os-{vehicle-import,parts-flow}.test.js`) are the primary acceptance gates and are **green**; they prove the money/logistics/ledger core against real services + atomic RPCs.

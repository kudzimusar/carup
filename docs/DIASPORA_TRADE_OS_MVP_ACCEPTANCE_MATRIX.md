# Diaspora Trade OS — MVP Acceptance Matrix

> Truth audit of the CarUp Diaspora Trade OS against **real routes + services + DB tables/RPCs + tests** —
> never a constant/migration/placeholder. Re-baselined at the Final Functional Closure (PR #90 stacked on
> PR #81, both main-reconciled after the Trust OS cutover).
>
> **Implementation status** (exactly one per row): `COMPLETE` · `PARTIAL` · `MISSING` · `DEFERRED FOR MVP` ·
> `EXTERNAL ACTIVATION REQUIRED`. Deployment evidence lives in **separate columns** and never substitutes
> for implementation status.
> **Evidence columns:** *Code* = route/service/table (file:line); *Local test* = suite proving it in CI;
> *Staging* = deployed-staging proof; *Prod* = production proof. Staging is `BLOCKED (EB-1)` and production
> `NOT APPLIED (EB-5)` for every row until those boundaries are lifted — that is deployment state, not
> implementation state.

## Status count (exactly 40)

| Status | Count | Rows |
|---|---|---|
| COMPLETE | **34** | 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 36, 37, 38, 40 |
| PARTIAL | **5** | 1, 2, 11, 35, 39 |
| MISSING | **0** | — |
| DEFERRED FOR MVP | **1** | 34 |
| EXTERNAL ACTIVATION REQUIRED | **0** | — (external boundaries EB-1…EB-5 gate *deployment*, tracked in the evidence columns) |
| **Total** | **40** | |

Previous revision miscounted its own row assignments (its lists actually covered all 40: 26/12/1/1); this
revision recounts and reflects the closure work: rows 5, 20, 21, 23, 24, 25, 26, 27 moved to COMPLETE.

## A. Core commerce chain

| # | Capability | Status | Code evidence | Local test | Staging | Prod |
|---|---|---|---|---|---|---|
| 1 | Buyer trade profile | PARTIAL | `diasporaRoutes.js:134,142`; `diasporaTradeProfileService.js`; `diaspora_trade_profiles` (013). No management UI (accepted — not on the required journeys; profile read feeds Stock Passport) | `diaspora-workflow`, `diaspora-supabase-integration` | BLOCKED (EB-1) | NOT APPLIED (EB-5) |
| 2 | Seller/supplier trade profile | PARTIAL | as row 1 + verify/suspend `diasporaRoutes.js:143-144` (reviewer) | same | BLOCKED | NOT APPLIED |
| 3 | Vehicle import request | COMPLETE | `diasporaRoutes.js:82` / `diasporaBuyerOrderRoutes.js:34`; `createImportOrder`/`createBuyerOrder`; `diaspora_import_orders` + UI `NewDiasporaImportOrder` | `diaspora-rfq`, `diaspora-workflow`, **journey 30** | BLOCKED | NOT APPLIED |
| 4 | Parts request | COMPLETE | `diasporaBuyerOrderRoutes.js:34` (order_type=parts); UI `DiasporaReverseRfq` | `diaspora-rfq`, e2e reverse-rfq, **journey 31** | BLOCKED | NOT APPLIED |
| 5 | Seller stock (publish lifecycle) | **COMPLETE** | create `diasporaStockRoutes.js:37`; **publish/unpublish `diasporaStockRoutes.js` POST /stock/:id/publish|unpublish → `publishStockItem`/`unpublishStockItem` (`diasporaStockService.js:221,300`)**; PRIVATE→PUBLISHED→UNPUBLISHED transitions; required-field + available-quantity + supply-doc gates; idempotent; audit `STOCK_ITEM_PUBLISHED`; UI publish/unpublish in `DiasporaStockManager` | **`diaspora-stock-publication` (12)**, `diaspora-stock`, **journey 31** | BLOCKED | NOT APPLIED |
| 6 | Supply document | COMPLETE | `diasporaStockRoutes.js:78,93`; `diasporaSupplyDocumentService.js`; UI StockManager | `diaspora-stock:133` | BLOCKED | NOT APPLIED |
| 7 | Reverse RFQ | COMPLETE | `diasporaBuyerOrderRoutes.js:43` `publishRfq`; UI ReverseRfq | `diaspora-rfq`, **journeys 30/31** | BLOCKED | NOT APPLIED |
| 8 | Seller quotation | COMPLETE | `diasporaBuyerOrderRoutes.js:54` `createQuote`; UI ReverseRfq | `diaspora-rfq`, **journeys 30/31** | BLOCKED | NOT APPLIED |
| 9 | Quote acceptance (atomic) | COMPLETE | `diasporaBuyerOrderRoutes.js:49` → RPC `diaspora_accept_quote_atomic`; UI ReverseRfq | `diaspora-rfq:104-184`, **journeys 30/31** | BLOCKED | NOT APPLIED |
| 10 | Stock reservation (ledger) | COMPLETE | `diasporaStockRoutes.js:62,57` → RPC `diaspora_append_stock_movement_atomic`; UI StockManager | `diaspora-stock`, H1, **journey 31** | BLOCKED | NOT APPLIED |
| 11 | Payment milestones | PARTIAL | `diasporaRoutes.js:121,283` `addPaymentMilestone`; read-only display in Order Passport §6; no create UI (accepted — not on required journey lists) | `diaspora-workflow`, `diaspora-supabase-integration` | BLOCKED | NOT APPLIED |

## B. Documents, logistics, compliance, identity

| # | Capability | Status | Code evidence | Local test | Staging | Prod |
|---|---|---|---|---|---|---|
| 12 | Document upload | COMPLETE | `diasporaRoutes.js:103,154`; UI `DiasporaImportDocuments` | `diaspora-supabase-integration`, `diaspora-ocr-route` | BLOCKED | NOT APPLIED |
| 13 | OCR | COMPLETE | `diasporaRoutes.js:160` (reviewer) → DocumentIntelligence | **`diaspora-ocr-route`** | BLOCKED | NOT APPLIED |
| 14 | Document verification | COMPLETE | `diasporaRoutes.js:245-248`; UI verify/reject | `diaspora-supabase-integration` | BLOCKED | NOT APPLIED |
| 15 | Container listing | COMPLETE | marketplace routes; UI ContainerMarketplace | `diaspora-container-marketplace` | BLOCKED | NOT APPLIED |
| 16 | Cargo reservation | COMPLETE | `requestReservation`; UI | same + **journeys 30/31** | BLOCKED | NOT APPLIED |
| 17 | Reservation approval (overfill guard) | COMPLETE | RPC `diaspora_approve_cargo_reservation_atomic`; UI approve. *Caveat: legacy non-atomic path `diasporaRoutes.js:264` remains (marketplace path is the guarded one)* | overfill tests, **journeys 30/31** | BLOCKED | NOT APPLIED |
| 18 | Shipment creation | COMPLETE | `diasporaRoutes.js:270`; UI ImportShipment | `diaspora-logistics-auth` | BLOCKED | NOT APPLIED |
| 19 | Shipment stage timeline | COMPLETE | `updateShipmentStage`/`getShipmentTimeline`; stage-event timeline now rendered in Order Passport §8 | e2e shipment + **passports e2e** | BLOCKED | NOT APPLIED |
| 20 | Compliance review | **COMPLETE** | routes `:277-280` (create/approve/flag); **UI approve/flag/create added to `DiasporaComplianceAdmin`** | `diaspora-supabase-integration`; vitest/tsc on controls | BLOCKED | NOT APPLIED |
| 21 | Government-document footprint | **COMPLETE** | `diasporaRoutes.js:129` `getGovernmentFootprint`; **rendered in Order Passport §9 ("X of Y required verified")** | `diaspora-workflow` + **passports e2e** | BLOCKED | NOT APPLIED |
| 22 | Zimbabwe Ready gate | COMPLETE | `assertZimbabweReadyPrerequisites` (`diasporaWorkflowService.js:56`, invoked :100); **operable via reviewer action (stages PATCH)**; only inbound edge INSURANCE_PENDING | `diaspora-workflow:116`, **journey 30 (contract)** | BLOCKED | NOT APPLIED |
| 23 | Vehicle import record | **COMPLETE** | `diasporaRoutes.js:104` (VERIFIED guard `diasporaImportOrderService.js:243`); **reviewer link UI added; displayed in Order Passport §10** | `diaspora-workflow:134`, **journey 30** | BLOCKED | NOT APPLIED |
| 24 | VIN/chassis linkage | **COMPLETE** | `linked_vehicle_vin` set on link + handoff; chassis-only supported (chassis-as-vin) | `diaspora-workflow`, **`diaspora-ownership-handoff`** | BLOCKED | NOT APPLIED |
| 25 | Local CarUp vehicle identity handoff | **COMPLETE** | **`diasporaOwnershipHandoffService.js` + POST/GET `/import-orders/:id/ownership-handoff`**: ZIMBABWE_READY + verified-docs + VERIFIED-record + VIN/chassis preconditions; resolve-or-create canonical `vehicles` row (truthful minimum: status Pending, publication draft, import_source diaspora_import — no title/customs/roadworthiness claims); links order+record+vehicle; immutable per-VIN `blockchain_events` timeline event `CROSS_BORDER_OWNERSHIP_HANDOFF` (hash-chained, safe provenance only); idempotent; VIN-conflict 409; critical audit + notification; reviewer UI + passport display | **`diaspora-ownership-handoff` (13)** | BLOCKED | NOT APPLIED |

## C. Passports, events, workbook, cross-cutting

| # | Capability | Status | Code evidence | Local test | Staging | Prod |
|---|---|---|---|---|---|---|
| 26 | Order Passport | **COMPLETE** (minimal, read-only) | **`DiasporaOrderPassport.tsx` @ /diaspora/imports/:id/passport** — 12 sections: identity/state + Zimbabwe-Ready indicator, participants, request, quotations (accepted highlighted), documents, payment milestones (non-custodial note), cargo reservation, shipment + stage-event timeline, compliance + gov footprint, vehicle record + ownership handoff, disputes (SafeTrade note — post-MVP on this page), audit (cap 50). Backbone = order aggregate; enrichments best-effort | **`diaspora-passports` e2e (10)**, tsc | BLOCKED | NOT APPLIED |
| 27 | Stock Passport | **COMPLETE** (minimal, read-only) | **`DiasporaStockPassport.tsx` @ /diaspora/stock/:id/passport** — identity + publication/verification/export badges, seller profile, provenance (origin + supply doc), compatibility, price, balances + full ledger history, photos marked post-MVP (no schema), matches note | **`diaspora-passports` e2e**, tsc | BLOCKED | NOT APPLIED |
| 28 | Notifications | COMPLETE | `diasporaNotificationService.js:8,42`; `notification_queue` (+ handoff notification) | indirect + `diaspora-ownership-handoff` | BLOCKED | NOT APPLIED |
| 29 | Audit trail | COMPLETE | `diasporaAuditService.js:12` (SHA-256 seal); ~20 write sites; **now rendered in Order Passport §12** | **`diaspora-audit-policy`**, journeys | BLOCKED | NOT APPLIED |
| 30 | Reputation eligibility/outcome | COMPLETE | N4 eligibility emit (never auto-writes); `diasporaReputationService.js` | `diaspora-safetrade:382,401` | BLOCKED | NOT APPLIED |
| 31 | Workbook template | COMPLETE | `generateTemplate` (exceljs binary) | `diaspora-workbook-xlsx:110` | BLOCKED | NOT APPLIED |
| 32 | XLSX parser | COMPLETE | `parseWorkbook` (exceljs, limits enforced) | `diaspora-workbook-xlsx:175` | BLOCKED | NOT APPLIED |
| 33 | Workbook dry-run | COMPLETE | `validateDiasporaWorkbookDryRun` (`wroteToDatabase:false`); UI states "Live trade-table writes remain disabled" | `diaspora-workbook:296,565` | BLOCKED | NOT APPLIED |
| 34 | Confirmed import / truthful deferral | **DEFERRED FOR MVP** | `importDiasporaWorkbook` throws by design; `execute-drafts` = draft-only staging (no domain services, no atomic rollback). **Classification B (Dry-Run MVP) retained at closure** | `diaspora-workbook:630` asserts reject | BLOCKED | NOT APPLIED |
| 35 | Workbook export | PARTIAL | `exportWorkbook` renders caller rows (injection-neutralized); DB-sourced export deferred | `diaspora-workbook-xlsx` | BLOCKED | NOT APPLIED |
| 36 | Tenant isolation | COMPLETE | RLS (013/014/phase1b helpers) + server-derived tenant (`authMiddleware.js:88-100`) | isolation suites + cross-tenant denials in publication/handoff tests | BLOCKED | NOT APPLIED |
| 37 | Role authorization | COMPLETE | `authorizeRole()` server-side on every mutation; services enforce finer boundaries (publish = creator/reviewer; handoff = reviewer/tenant-admin) | authz suites + new tests | BLOCKED | NOT APPLIED |
| 38 | Idempotency | COMPLETE | unique keys + RPC `IDEMPOTENCY_CONFLICT`; publication + handoff idempotent replays | stock/safetrade/publication/handoff tests | BLOCKED | NOT APPLIED |
| 39 | Rollback/recovery | PARTIAL | atomic SECURITY DEFINER RPCs for money/state; handoff validates-before-write; workbook draft executor still non-atomic; several migrations forward-only | safetrade/stock rollback tests | BLOCKED | NOT APPLIED |
| 40 | SafeTrade sandbox assurance | COMPLETE | typed-403 `EXTERNAL_ACTIVATION_REQUIRED`; empty approved-provider allowlist; DB CHECK `live_payment=false`; UI-9 + ST-4B server-redacted evidence read | `diaspora-safetrade` (55) + authz (22) + available-actions (19) | BLOCKED | NOT APPLIED |

## P1 release-blocker adjudication (closure directive §2)

| Candidate | Classification | Evidence & disposition |
|---|---|---|
| **A — stock cannot leave PRIVATE** | **P1 RELEASE BLOCKER → RESOLVED** | Was: `publication_status` hard-set PRIVATE + protected; matcher filters `PUBLISHED` → matching structurally dead on the real path. Fixed by the publication lifecycle (row 5); journey 31 + 12 publication tests prove published supply enters matching and private supply does not. |
| **B — no ownership/evidence handoff** | **P1 RELEASE BLOCKER → RESOLVED** | Was: VIN foreign key only; the product objective's final link ("durable CarUp ownership, provenance and audit record") absent. Fixed by row 25 (service + routes + evidence event + UI); 13 tests. |
| **C — backend-complete actions with no UI** | **P1 for journey-required actions → RESOLVED; remainder ACCEPTED MVP LIMITATION** | Journey-required and now operable: seller assignment, compliance approve/flag/create, Zimbabwe Ready, import-record link, ownership handoff, supply publish/unpublish (quotation, acceptance, document verification, reservation approval, shipment transition, ledger reservation already had UI). Accepted (not journey-required): trade-profile management UI (rows 1-2), payment-milestone create UI (row 11) — operator/API paths exist and reads render in the passport. |
| **D — Order Passport incomplete** | **P1 RELEASE BLOCKER → RESOLVED** | Minimal read-only consolidated view shipped (row 26); disputes section is a SafeTrade pointer (post-MVP on this page by design). |
| **E — Stock Passport missing** | **P1 RELEASE BLOCKER → RESOLVED** | Minimal read-only consolidated view shipped (row 27); photos post-MVP (no photo schema — not added just to complete the passport, per directive). |

**Remaining accepted limitations (all named, none hidden):** trade-profile + milestone-create UI (rows 1/2/11);
DB-sourced workbook export (row 35); workbook confirmed import (row 34, classification B); workbook draft-executor
atomicity + forward-only migrations (row 39, close before EB-4/EB-5); legacy non-atomic reservation-approval path
(row 17 caveat); Order Passport dispute section is a SafeTrade pointer.

## User-operability gate (closure directive §6)

| Step | Backend endpoint | Role | UI before | Journey-required | Action taken |
|---|---|---|---|---|---|
| Seller assignment | POST /import-orders/:id/assign-seller | auth (service-checked) | none | vehicle: YES | **Added** (reviewer actions, order detail) |
| Compliance review | POST /compliance, /:id/approve, /:id/flag | reviewer | read-only list | vehicle: YES | **Added** approve/flag/create |
| Zimbabwe Ready | PATCH /import-orders/:id/stages | auth + gate | none | vehicle: YES | **Added** (reviewer action; server gate message surfaced) |
| Import-record link | POST /import-orders/:id/vehicle-import-record | reviewer | none | vehicle: YES | **Added** (reviewer action) |
| Ownership handoff | POST/GET /import-orders/:id/ownership-handoff | reviewer (service-enforced) | n/a (new) | vehicle: YES | **Added** (reviewer action + passport status) |
| Supply publication | POST /stock/:id/publish, /unpublish | seller/reviewer | none | parts: YES | **Added** (stock manager) |
| Gov footprint view | GET /import-orders/:id/government-footprint | auth | none | vehicle: YES (visibility) | **Added** (passport §9) |
| Trade-profile mgmt | POST /trade-profiles(/verify/suspend) | auth/reviewer | none | NO | none — ACCEPTED (API path) |
| Payment-milestone create | POST /import-orders/:id/payment-milestones | auth | none | NO | none — ACCEPTED (read-only in passport) |
| RFQ response / acceptance / ledger reservation / reservation approval / shipment transition | existing | — | already operable | YES | none needed |

The **integrated journeys** (`backend/tests/diaspora-trade-os-{vehicle-import,parts-flow}.test.js`) remain the
primary code-level acceptance gates and are green; **deployed-staging** journey proof is gated on EB-1.

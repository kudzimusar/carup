# Vehicle Trust OS — Product Integration Gap Report (Phase 10)

**Branch:** `integration/vehicle-trust-os-product-activation` (from release head `3fb1650`)
**Date (UTC):** 2026-06-26 · **Method:** read-only audit of backend routes/services + web + mobile.
**Deferred blocker (recorded, NOT remediated here):** committed production DB credentials (Gate 15)
— production cutover stays blocked; out of scope for this task.

## Backend API surface (Vehicle Trust) — present
Mounted routers: `vehicles`, `evidenceCatalog`, `ingestion`, `intelligence`, `report`,
`governance`, `trustFact`, `featureGovernance`, `marketplaceAdmin`. Key endpoints:
- Taxonomy/sources: `GET /api/evidence/taxonomy`, `/api/evidence/sources`
- Evidence: `POST /api/vehicles/:vin/evidence/upload`, `GET /api/vehicles/:vin/evidence`, review/verify/reject, `GET /api/evidence/review`
- **Extractions (OCR): `POST /api/vehicles/:vin/evidence/:evidenceId/extractions`, `GET /api/vehicles/:vin/extractions`, `PATCH /api/vehicles/:vin/extractions/:id/review`** (+ `extractionService`, `completenessEvaluator`)
- **Completeness: `GET /api/vehicles/:vin/completeness`** — deterministic publication gate (blocking + advisory gaps)
- Provenance, evidence-sets; ingestion jobs + identity queue; temporal-findings/disclosure; report + versions + share; governance review-queue/decisions/disputes; trust-fact workflow.
- **Admin marketplace moderation:** `GET/PATCH /api/admin/marketplace/listings/:id/{approve,reject,suppress,request-evidence,flag-risk,clear-risk}`, inquiries, analytics, AI moderation summary.

## Classification matrix

### Web (`web/src`)
| Feature | Files | Class | Endpoint(s) |
|---|---|---|---|
| Evidence upload (taxonomy/subtype/mileage/components/visibility) | EvidenceUploadModal.tsx | **fully connected** | POST evidence/upload, GET taxonomy |
| Admin evidence review (+ AI fraud/VIN-mismatch + OCR extractions) | dashboard/admin/EvidenceReview.tsx | **fully connected** | GET evidence/review; PATCH verify/reject; ExtractionReviewPanel |
| Trust-fact review queue (+ audit trail, redaction) | dashboard/shared/TrustReviewQueue.tsx | **fully connected** | review-queue; trust-facts approve/reject/revoke; audit-trail |
| Governance review queue (4 task types, 6 decisions) | dashboard/shared/GovernanceReviewQueue.tsx | **fully connected** | GET/POST governance review-queue/decisions |
| Disputes | components/DisputePanel.tsx | **fully connected** | GET/POST disputes |
| Buyer vehicle detail + passport + verification metrics (separate concepts, no generic "verified" badge) | pages/VehicleDetail.tsx | **fully connected** | marketplace detail, passport, temporal, disclosure, report |
| Marketplace trust summary (backend-governed badges) | marketplace/TrustSummaryPanel.tsx | **fully connected** | from marketplace detail |
| Vehicle history report (completeness, limitations, alerts, mileage, timeline, evidence index) | components/VehicleHistoryReport.tsx | **fully connected** | GET report, versions, share |
| Life-stage timeline / temporal / disclosure panels | VehicleLifeStageTimeline, VehicleTemporalComparison, VehicleDisclosurePanel | **fully connected** | as above |
| **OCR extraction state UI (states, per-field confidence, mismatch review)** | components/ExtractionReviewPanel.tsx | **fully connected** | GET extractions, PATCH extractions/:id/review |
| **Seller/dealer onboarding (identity fields, draft, publication gating + completeness panel)** | dashboard/owner/SellVehicle.tsx + components/VehicleCompletenessPanel.tsx | **fully connected** | POST /vehicles/add, GET /vehicles/:vin/completeness |
| **Admin marketplace moderation** | dashboard/admin/MarketplaceModeration.tsx | **fully connected** | GET/PATCH /api/admin/marketplace/listings/...; /inquiries; /analytics; AI moderation summary |
| Marketplace browse / Landing / directories | Marketplace.tsx, Landing.tsx, *Directory.tsx | **mock-only** | use mockData (out of Vehicle-Trust scope; cosmetic only) |

### Mobile (`mobile/`)
| Feature | Class | Note |
|---|---|---|
| Auth bootstrap before protected nav | **fully connected** | loading gate in `_layout.tsx`; SecureStore + biometric |
| Buyer trust passport + explanation | **fully connected** | `vehicle/[vin].tsx` renders backend `trust_summary` (no local trust math) |
| Marketplace browse + inquiry | **fully connected** | `(tabs)/marketplace.tsx` |
| Owner garage + odometer OCR scan | **fully connected** | `(tabs)/garage.tsx` → `/api/ai/ocr` |
| KYC identity verification + OCR states | **fully connected** | `(auth)/verification/*` (queued/processing/needs_review/verified/rejected) |
| Document capture (camera) + progress | **partially connected** | capture screens; progress simulated; base64 not streamed multipart |
| Offline upload retry queue | **partially connected / MISSING** | UI messaging only; no durable queue |
| **Logout clears sensitive verification state** | **fully connected** | verification store cleared on logout (`authStore.ts`) |
| Seller/dealer vehicle creation | **missing** | no mobile create screen — post-MVP roadmap |
| Admin review | **missing** | admin role exists; no routes — post-MVP roadmap |
| Missing-document checklist / publication status | **missing** | post-MVP roadmap |
| Feature governance (fail-closed) | **fully connected** | `NativeFeatureBoundary` + `featureGovernanceStore` |

## Implemented in this task
1. **Phase 11 — Seller completeness panel**: `VehicleCompletenessPanel.tsx` + `fetchVehicleCompleteness` hook added to `useCarUpApi.ts` + `VehicleCompleteness` types added to `types/index.ts`. After draft save, `SellVehicle.tsx` shows the panel (requirements, completeness %, blocking/pending gaps, upload link) instead of immediately navigating away.
2. **Phase 12 — OCR extraction review UI**: `ExtractionReviewPanel.tsx` + hook methods already completed in prior commit.
3. **Phase 13 — Admin marketplace moderation**: `MarketplaceModeration.tsx` already fully connected (gap report initially understated this).
4. **Phase 16 — Mobile logout state**: verification store cleared on logout, already done in prior commit.

## Remaining work (roadmap — post-MVP unless noted)
See `REMAINING_KEY_FEATURES_ROADMAP.md`. Hard production-cutover blockers:
1. Credential rotation (Gate 15 — MUST resolve before production cutover).
2. Staging interactive deploy + UAT (requires Vercel deploy access).

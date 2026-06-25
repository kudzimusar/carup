# Vehicle Trust OS — Product Integration Gap Report (Phase 10)

**Branch:** `integration/vehicle-trust-os-product-activation` (from release head `3fb1650`)
**Date (UTC):** 2026-06-25 · **Method:** read-only audit of backend routes/services + web + mobile.
**Deferred blocker (recorded, NOT remediated here):** committed production DB credentials (Gate 15)
— production cutover stays blocked; out of scope for this task.

## Backend API surface (Vehicle Trust) — present
Mounted routers: `vehicles`, `evidenceCatalog`, `ingestion`, `intelligence`, `report`,
`governance`, `trustFact`, `featureGovernance`. Key endpoints:
- Taxonomy/sources: `GET /api/evidence/taxonomy`, `/api/evidence/sources`
- Evidence: `POST /api/vehicles/:vin/evidence/upload`, `GET /api/vehicles/:vin/evidence`, review/verify/reject, `GET /api/evidence/review`
- **Extractions (OCR): `POST /api/vehicles/:vin/evidence/:evidenceId/extractions`, `GET /api/vehicles/:vin/extractions`, `PATCH /api/vehicles/:vin/extractions/:id/review`** (+ `extractionService`, `completenessEvaluator`)
- Provenance, evidence-sets; ingestion jobs + identity queue; temporal-findings/disclosure; report + versions + share; governance review-queue/decisions/disputes; trust-fact workflow.

## Classification matrix

### Web (`web/src`)
| Feature | Files | Class | Endpoint(s) |
|---|---|---|---|
| Evidence upload (taxonomy/subtype/mileage/components/visibility) | EvidenceUploadModal.tsx | **fully connected** | POST evidence/upload, GET taxonomy |
| Admin evidence review (+ AI fraud/VIN-mismatch) | dashboard/admin/EvidenceReview.tsx | **fully connected** | GET evidence/review; PATCH verify/reject |
| Trust-fact review queue (+ audit trail, redaction) | dashboard/shared/TrustReviewQueue.tsx | **fully connected** | review-queue; trust-facts approve/reject/revoke; audit-trail |
| Governance review queue (4 task types, 6 decisions) | dashboard/shared/GovernanceReviewQueue.tsx | **fully connected** | GET/POST governance review-queue/decisions |
| Disputes | components/DisputePanel.tsx | **fully connected** | GET/POST disputes |
| Buyer vehicle detail + passport + verification metrics (separate concepts, no generic "verified" badge) | pages/VehicleDetail.tsx | **fully connected** | marketplace detail, passport, temporal, disclosure, report |
| Marketplace trust summary (backend-governed badges) | marketplace/TrustSummaryPanel.tsx | **fully connected** | from marketplace detail |
| Vehicle history report (completeness, limitations, alerts, mileage, timeline, evidence index) | components/VehicleHistoryReport.tsx | **fully connected** | GET report, versions, share |
| Life-stage timeline / temporal / disclosure panels | VehicleLifeStageTimeline, VehicleTemporalComparison, VehicleDisclosurePanel | **fully connected** | as above |
| Seller/dealer onboarding (identity fields, draft, publication gating) | dashboard/owner/SellVehicle.tsx | **partially connected** | POST /vehicles/add, media upload; **no OCR surface**; location fixtures only |
| **OCR extraction state UI (states, per-field confidence, mismatch review)** | — | **backend-only → MISSING UI** | extractions endpoints exist; no web client/methods/screen |
| Marketplace admin moderation actions | (routes exist) | **backend-only** | /admin/marketplace/... not exposed in admin UI |
| Marketplace browse / Landing / directories | Marketplace.tsx, Landing.tsx, *Directory.tsx | **mock-only** | use mockData (out of Vehicle-Trust scope) |

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
| Logout clears sensitive verification state | **GAP (security)** | verification store (captured doc images/OCR PII) not cleared on logout |
| Seller/dealer vehicle creation | **missing** | no mobile create screen |
| Admin review | **missing** | admin role exists; no routes |
| Missing-document checklist / publication status | **missing** | — |
| Feature governance (fail-closed) | **fully connected** | `NativeFeatureBoundary` + `featureGovernanceStore` |

## Approved MVP gaps to implement in THIS task (feasible, backend-ready, testable)
1. **Phase 12 — Web OCR extraction-review UI** (highest value; backend complete): API client methods + types + an admin/reviewer extraction panel showing processing/match/review states, per-field confidence, identity mismatch, and confirm/reject/amend/waive (never overwriting original evidence; AI value never shown as official verified fact).
2. **Phase 16 — Mobile logout sensitive-state clear**: clear the verification store (captured document images + OCR PII) on logout.

## Larger remaining work (roadmap, not this task)
Mobile seller creation + admin review + persistent offline queue; web marketplace admin moderation UI;
seller-onboarding completeness panel polish; **Phase 19 real staging deploy + UAT** (requires Vercel
deploy access not available in this environment); production cutover (blocked on credential rotation).
See `REMAINING_KEY_FEATURES_ROADMAP.md`.

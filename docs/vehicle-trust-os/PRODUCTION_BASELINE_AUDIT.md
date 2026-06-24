# Production Baseline Audit — Core Vehicle Trust OS MVP

**Document status:** Phase 0 verified baseline  
**Date:** 2026-06-24  
**Branch:** `release/core-vehicle-trust-os-mvp`  
**Release branch HEAD:** `7527f3108fb07056ce2f2a7f7b07a604edcadbf5`  
**Production main HEAD:** `6f1bc8551f328179ef7610fbdfe09e1740304b84`  
**PR #98 branch:** `origin/integration/vehicle-life-m1-m6`  
**PR #98 HEAD:** `bf504c352e0a8e3ac000fe624692dcc90e75bb58`  
**Production Supabase:** `vhmnajoeicasaigiophh`  
**Staging Supabase:** `eoyenigwevnxwwhyhaer`

---

## 1. Release Branch State

The `release/core-vehicle-trust-os-mvp` branch is **1 commit ahead of `origin/main`**.  
The single commit adds the canonical release plan document.  
**PR #98 (M1–M6) has NOT been integrated into the release branch yet.**

---

## 2. Database Tables — Production Main (`main` SHA `6f1bc855`)

### 2.1 Vehicle Trust tables confirmed present in migrations

| Table | Migration file | RLS enabled |
|---|---|---|
| `vehicles` | `supabase_schema.sql` | Not verified in migration |
| `vehicle_ownership_history` | `supabase_schema.sql` | Not verified in migration |
| `insurance_records` | `supabase_schema.sql` | Not verified in migration |
| `vehicle_evidence` | `014_passport_evidence_architecture.sql` | **NO — no `ENABLE ROW LEVEL` found** |
| `vehicle_documents` | `012_storage_and_media_schema.sql` | **NO — no `ENABLE ROW LEVEL` found** |
| `vehicle_plate_history` | `013_zimbabwe_plate_and_owner_privacy.sql` | **NO — no `ENABLE ROW LEVEL` found** |
| `vehicle_import_records` | `013_diaspora_trade_schema.sql` | Not verified in migration |
| `vehicle_government_documents` | `013_diaspora_trade_schema.sql` | Not verified in migration |
| `vehicle_listings` | `004_add_tamper_proofing.sql` | Not verified in migration |
| `vehicle_listing_summaries` | `20260603132036_marketplace_listing_summary_infra.sql` | Not verified in migration |
| `ocr_documents` | `004_add_tamper_proofing.sql` | Not verified in migration |
| `stolen_vehicles` | `004_add_tamper_proofing.sql` | Not verified in migration |
| `trust_score_history` | `004_add_tamper_proofing.sql` | Not verified in migration |
| `trust_audit_events` | `20260603233640_governance_foundation_trust_audit_events.sql` | Not verified in migration |
| `registry_verifications` | `009_phase4_schema.sql` | Not verified in migration |
| `verification_sessions` | `20260605042424_verification_sessions_phase7b.sql` | Not verified in migration |
| `zimra_declarations` | Referenced but rows = 0 | Unknown |
| `cvr_ownership_records` | Referenced but rows = 0 | Unknown |
| `vid_inspections` | Referenced but rows = 0 | Unknown |
| `cid_clearance_records` | Referenced but rows = 0 | Unknown |
| `zinara_licensing_records` | Referenced but rows = 0 | Unknown |

### 2.2 Confirmed RLS gaps on main

- `vehicle_documents` — no `ENABLE ROW LEVEL SECURITY` in `012_storage_and_media_schema.sql`
- `vehicle_plate_history` — no `ENABLE ROW LEVEL SECURITY` in `013_zimbabwe_plate_and_owner_privacy.sql`
- `vehicle_evidence` — no `ENABLE ROW LEVEL SECURITY` in `014_passport_evidence_architecture.sql`

### 2.3 Production data counts (last audit, 2026-06-24)

| Table | Row count |
|---|---:|
| `vehicles` | 338 |
| `vehicle_ownership_history` | 98 |
| `insurance_records` | 161 |
| `ocr_documents` | 385 |
| `verification_sessions` | 9 |
| `registry_verifications` | 3 |
| `trust_audit_events` | 259 |
| `trust_score_history` | 411 |
| `stolen_vehicles` | 1 |
| `vehicle_evidence` | 0 |
| `vehicle_documents` | 0 |
| `vehicle_government_documents` | 0 |
| `vehicle_import_records` | 0 |
| `vehicle_listings` | 0 |
| `vehicle_listing_summaries` | 0 |
| `vehicle_plate_history` | 0 |

---

## 3. M1–M6 Tables — Present ONLY in PR #98 Branch

None of the following tables exist in `main` or staging. They are defined in the 6 M1–M6 migrations in `integration/vehicle-life-m1-m6` only:

| Table | Migration |
|---|---|
| `evidence_class_taxonomy` | M1 — `20260621120000_vehicle_life_evidence_taxonomy_provenance.sql` |
| `evidence_sources` | M1 |
| `evidence_sets` | M1 |
| `evidence_provenance_events` | M1 |
| `ingestion_jobs` | M2 — `20260621130000_external_source_ingestion.sql` |
| `source_records` | M2 |
| `vehicle_identity_candidates` | M2 |
| `listing_snapshots` | M2 |
| `ai_analysis_jobs` | M3 — `20260621140000_ai_temporal_disclosure_intelligence.sql` |
| `ai_observations` | M3 |
| `temporal_findings` | M3 |
| `disclosure_claims` | M3 |
| `disclosure_conflicts` | M3 |
| `report_versions` | M4 — `20260621150000_report_versions.sql` |
| `review_tasks` | M5 — `20260621160000_governance_disputes_corrections.sql` |
| `review_decisions` | M5 |
| `disputes` | M5 |
| `dispute_events` | M5 |
| `trust_change_log` | M5 |

---

## 4. Security Issues Identified in PR #98 Migrations

### 4.1 Broad authenticated `USING (true)` READ policies

These must be narrowed before staging deployment (Phase 2):

| Table | Migration | Policy name |
|---|---|---|
| `evidence_sets` | M1 | `evidence sets authenticated read` |
| `evidence_provenance_events` | M1 | `provenance authenticated read` |
| `ingestion_jobs` | M2 | `ingestion jobs authenticated read` |
| `source_records` | M2 | `source records authenticated read` |
| `vehicle_identity_candidates` | M2 | `identity candidates authenticated read` |
| `listing_snapshots` | M2 | `listing snapshots authenticated read` |
| `ai_analysis_jobs` | M3 | `ai jobs authenticated read` |
| `ai_observations` | M3 | `ai obs authenticated read` |
| `temporal_findings` | M3 | `temporal findings authenticated read` |
| `disclosure_claims` | M3 | `disclosure claims authenticated read` |
| `disclosure_conflicts` | M3 | `disclosure conflicts authenticated read` |
| `report_versions` | M4 | `report versions authenticated read` |
| `review_tasks` | M5 | `review tasks authenticated read` |
| `review_decisions` | M5 | `review decisions authenticated read` |
| `disputes` | M5 | `disputes authenticated read` |
| `dispute_events` | M5 | `dispute events authenticated read` |
| `trust_change_log` | M5 | `trust change log authenticated read` |

### 4.2 Provenance deletion risks (`ON DELETE CASCADE`)

These cascade deletes can destroy audit trails when evidence or vehicles are deleted:

| Child table | Foreign key | Cascade risk |
|---|---|---|
| `evidence_sets.vin` | `→ vehicles(vin)` | Deleting vehicle erases all evidence sets |
| `evidence_provenance_events.evidence_id` | `→ vehicle_evidence(id)` | Deleting evidence erases provenance chain |
| `vehicle_identity_candidates.source_record_id` | `→ source_records(id)` | Cascade from source record |
| `ai_observations.evidence_id` | `→ vehicle_evidence(id)` | Deleting evidence erases AI observations |
| `disclosure_conflicts.claim_id` | `→ disclosure_claims(id)` | Cascade from claim |
| `report_versions.vin` | `→ vehicles(vin)` | Deleting vehicle erases report history |

### 4.3 RLS gaps on existing main tables

These tables need RLS enabled before any Vehicle Trust data is stored (Phase 2):

- `vehicle_evidence`
- `vehicle_documents`  
- `vehicle_plate_history`

---

## 5. Backend Services and Routes — Current `main`

### 5.1 Routes present on main

| Route file | Vehicle Trust relevance |
|---|---|
| `vehiclesRoutes.js` | Evidence upload, verify, reject, evidence timeline |
| `trustFactRoutes.js` | Trust facts workflow |
| `complianceRoutes.js` | Government compliance |
| `identityVerificationRoutes.js` | Identity checks |
| `marketplaceRoutes.js` | Listings, trust summaries |
| `adminRoutes.js` | Admin evidence review |

### 5.2 Routes present ONLY in PR #98

| Route file | Phase |
|---|---|
| `evidenceCatalogRoutes.js` | M1 |
| `ingestionRoutes.js` | M2 |
| `intelligenceRoutes.js` | M3 |
| `reportRoutes.js` | M4 |
| `governanceRoutes.js` | M5 |

### 5.3 Services present on main

| Service path | Description |
|---|---|
| `services/evidence/evidenceService.js` | Core evidence upload, verification, rejection |
| `services/trustGraph/trustGraphService.js` | Trust score calculation |
| `services/marketplace/listingSummaryService.js` | Listing summaries |
| `services/marketplace/marketplaceTrustSummaryService.js` | Trust summary for marketplace |
| `services/auditLogger.js` | Audit event logging |
| `services/trust-service/` | Trust service layer |
| `services/trustGovernance/` | Trust governance |

### 5.4 Services present ONLY in PR #98

| Service path | Milestone |
|---|---|
| `services/evidence/evidenceTaxonomy.js` | M1 |
| `services/evidence/evidenceSetService.js` | M1 |
| `services/evidence/provenanceService.js` | M1 |
| `services/evidence/sourceRegistryService.js` | M1 |
| `services/evidence/perceptualHash.js` | M1 |
| `services/ingestion/ingestionService.js` | M2 |
| `services/ingestion/identityResolution.js` | M2 |
| `services/ingestion/listingSnapshotService.js` | M2 |
| `services/ingestion/sourceProvider.js` | M2 |
| `services/ingestion/registerAdapters.js` | M2 |
| `services/ingestion/adapters/sandboxJpAuctionAdapter.js` | M2 |
| `services/ai/analysisJobService.js` | M3 |
| `services/ai/analysisProvider.js` | M3 |
| `services/ai/similarityService.js` | M3 |
| `services/intelligence/temporalComparison.js` | M3 |
| `services/intelligence/disclosureConflict.js` | M3 |
| `services/report/reportService.js` | M4 |
| `services/governance/governanceService.js` | M5 |
| `services/governance/disputeService.js` | M5 |
| `middleware/rateLimitStore.js` | M6 |

---

## 6. Web Pages and Components

### 6.1 Present on main

| File | Vehicle Trust relevance |
|---|---|
| `web/src/pages/dashboard/owner/SellVehicle.tsx` | Listing form — **missing engine/chassis/plate fields** |
| `web/src/pages/dashboard/owner/VehicleProfile.tsx` | Vehicle passport |
| `web/src/pages/VehicleDetail.tsx` | Buyer vehicle detail |
| `web/src/pages/Marketplace.tsx` | Marketplace with trust cards |
| `web/src/components/EvidenceUploadModal.tsx` | Evidence upload |
| `web/src/pages/dashboard/admin/EvidenceReview.tsx` | Admin evidence review |

### 6.2 Confirmed gap in `SellVehicle.tsx`

`grep -c "engine_number|chassis_number|plate" SellVehicle.tsx` → **0**  
Engine number, chassis number and plate/temp-ID are NOT sent by the listing form.

### 6.3 Present ONLY in PR #98

| File | Milestone |
|---|---|
| `web/src/components/VehicleLifeStageTimeline.tsx` | M1 |
| `web/src/components/VehicleHistoryReport.tsx` | M4 |
| `web/src/components/VehicleTemporalComparison.tsx` | M3 |
| `web/src/components/VehicleDisclosurePanel.tsx` | M3 |
| `web/src/components/DisputePanel.tsx` | M5 |
| `web/src/pages/SharedReport.tsx` | M4 |
| `web/src/pages/dashboard/shared/GovernanceReviewQueue.tsx` | M5 |

---

## 7. Tests

### 7.1 Vehicle Trust tests present on main (`release` branch)

| Test file | Domain |
|---|---|
| `backend/tests/evidence-api.test.js` | Evidence API |
| `backend/tests/evidence-ai-fraud.test.js` | Evidence + AI |
| `backend/tests/evidence-validation.test.js` | Evidence validation |
| `backend/tests/trust-fact-workflow.test.js` | Trust facts |
| `backend/tests/trust-governance.test.js` | Trust governance |
| `backend/tests/vehicle-create-eligibility.test.js` | Vehicle creation |
| `backend/tests/vehicle-status.test.js` | Vehicle status |
| `backend/tests/marketplace-listing-eligibility.test.js` | Listing eligibility |
| `backend/tests/marketplace-listing-summary.test.js` | Listing summaries |
| `backend/tests/marketplace-v1-spine.test.js` | Marketplace spine |

### 7.2 Tests present ONLY in PR #98

| Test file | Milestone |
|---|---|
| `backend/tests/vehicle-life-taxonomy.test.js` | M1 |
| `backend/tests/evidence-catalog-routes.test.js` | M1 |
| `backend/tests/ingestion-framework.test.js` | M2 |
| `backend/tests/ingestion-routes.test.js` | M2 |
| `backend/tests/ai-temporal-disclosure.test.js` | M3 |
| `backend/tests/intelligence-routes.test.js` | M3 |
| `backend/tests/vehicle-report.test.js` | M4 |
| `backend/tests/governance-workflow.test.js` | M5 |
| `backend/tests/governance-routes.test.js` | M5 |
| `backend/tests/outbox-dead-letter.test.js` | M6 |
| `backend/tests/rate-limit-store.test.js` | M6 |
| `backend/tests/qa-backend-blockers.test.js` | M6 integration |
| `backend/tests/golden-journey.test.js` | All milestones |
| `database/test/migration_pglite_check.mjs` | Migrations |

---

## 8. Known Gaps — Current Main vs MVP Requirements

| # | MVP Requirement | Current State | Blocks |
|---|---|---|---|
| 1 | Engine, chassis, plate in listing form | `SellVehicle.tsx` has none | Phase 4 |
| 2 | `vehicle_documents` RLS enabled | Not enabled in migration | Phase 2 |
| 3 | `vehicle_plate_history` RLS enabled | Not enabled in migration | Phase 2 |
| 4 | `vehicle_evidence` RLS enabled | Not enabled in migration | Phase 2 |
| 5 | M1–M6 tables in staging | Not deployed | Phase 7 |
| 6 | OCR field-level comparison with match/mismatch | Not present on main | Phase 3 |
| 7 | Document completeness evaluator | Not present on main | Phase 4 |
| 8 | Listing publication lifecycle (draft→publishable) | Not enforced | Phase 4 |
| 9 | Source-specific trust badges (not generic "Verified") | Not confirmed | Phase 5 |
| 10 | Insufficient-evidence state | Not confirmed | Phase 5 |
| 11 | Durable audit for trust-changing decisions | Partially (best-effort catches exist) | Phase 6 |
| 12 | Append-only provenance/report-version enforcement | Not present on main | Phase 6 |
| 13 | Broad `USING (true)` policies in M1–M6 | Present in all 5 operational migrations | Phase 2 |
| 14 | Provenance `ON DELETE CASCADE` chains | Present in M1, M3, M4 | Phase 2 |

---

## 9. PR #98 Integration Summary

- **Changed files:** 92
- **Net insertions:** +11,549 / −70
- **State:** Open draft, NOT merged, stale vs current main
- **Conflicts expected in:** `backend/routes/vehiclesRoutes.js`, `web/src/types/index.ts`, `web/src/pages/VehicleDetail.tsx`, `web/src/hooks/useCarUpApi.ts`, `web/src/components/EvidenceUploadModal.tsx`, `web/src/pages/dashboard/owner/VehicleProfile.tsx`, `backend/server.js`
- **PR #98 qualification evidence:** 195/195 tests, migration apply/down/reapply, golden journey A–P, role/privacy checks (documented in `docs/vehicle-life-intelligence/INTEGRATION_FINAL_REPORT.md`)

---

## 10. Phase 0 Exit Assessment

| Check | Status |
|---|---|
| Release branch isolated from main | PASS — 1 commit ahead, clean |
| PR #98 branch available | PASS — `origin/integration/vehicle-life-m1-m6` at `bf504c35` |
| Security issues documented | PASS — 17 broad policies, 6 cascade FK risks |
| RLS gaps on existing tables documented | PASS — 3 tables identified |
| Overlap between main and PR #98 documented | PASS — 7 conflicting files identified |
| Production not changed | PASS — read-only audit only |
| PRODUCTION_BASELINE_AUDIT.md created | PASS |

**Phase 0 exit: COMPLETE**  
**Next phase:** Phase 1 — Integrate PR #98 into `release/core-vehicle-trust-os-mvp`

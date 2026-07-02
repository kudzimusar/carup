# CarUp Core Vehicle Trust OS — MVP Integration and Release Plan

**Document status:** Canonical implementation and release reference  
**Repository:** `kudzimusar/carup`  
**Working branch:** `release/core-vehicle-trust-os-mvp`  
**Vehicle Life source:** PR #98 — `integration/vehicle-life-m1-m6`  
**Production Supabase:** `vhmnajoeicasaigiophh`  
**Staging Supabase:** `eoyenigwevnxwwhyhaer`  
**Last consolidated audit date:** 2026-06-24  

> **Agent instruction:** Read this document before planning, coding, migrating, testing, reviewing, or releasing the Core Vehicle Trust OS. Treat it as the scope and safety contract. Update it only when verified repository or environment evidence changes. Do not expand the feature beyond the MVP defined here.

---

## 1. Objective

Complete and release the **CarUp Core Vehicle Trust OS MVP** as one integrated system.

This is the core product identity of CarUp. It is not a document-upload add-on and it is not another open-ended feature programme.

The MVP must connect every public vehicle listing to a canonical vehicle record and an explainable Zimbabwe-focused trust layer covering:

1. vehicle identity;
2. ownership continuity;
3. government/compliance evidence;
4. vehicle documents and OCR;
5. fraud and inconsistency signals;
6. human review and auditability;
7. buyer-facing trust explanations;
8. seller/dealer missing-document guidance;
9. marketplace publication controls;
10. continuity through resale and relisting.

The programme must finish with one tested, migration-safe release candidate. Do not add unrelated features while completing it.

---

## 2. Verified Baseline

### 2.1 What already exists on current production `main`

The current application already contains substantial Vehicle Trust foundations:

- canonical VIN-based `vehicles` records;
- plate, chassis, engine, registration, temporary-ID and owner fields;
- ownership-history records;
- insurance records;
- stolen-vehicle records;
- government-registry table structures;
- evidence upload and secure storage;
- SHA-256 checksums;
- role-based evidence upload rules;
- AI-assisted evidence inspection;
- evidence approval/rejection;
- trust-score recalculation;
- trust-score history;
- trust audit events;
- vehicle passport page;
- buyer-facing evidence timeline/gallery;
- marketplace trust summaries;
- marketplace trust badges and filters;
- admin evidence-review UI;
- odometer rollback checking;
- duplicate normalized-plate checking;
- plate risk and quarantine rules;
- timeline readers for ZIMRA, CVR, VID, CID, ZINARA, insurance, service and ownership events.

### 2.2 Production data reality at the last audit

The production database contained:

| Table or domain | Rows |
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
| `zimra_declarations` | 0 |
| `cvr_ownership_records` | 0 |
| `vid_inspections` | 0 |
| `cid_clearance_records` | 0 |
| `zinara_licensing_records` | 0 |

This proves the architecture is partly present, but it does **not** prove a fully operating Zimbabwe trust registry for production listings.

### 2.3 PR #98 state

PR #98 is the consolidated Vehicle Life Intelligence M1–M6 implementation.

- State: open
- Draft: yes
- Merged: no
- Head branch: `integration/vehicle-life-m1-m6`
- Head SHA at the last audit: `bf504c352e0a8e3ac000fe624692dcc90e75bb58`
- Changed files: 92
- Commits: 26
- Historical qualification evidence: 195/195 tests, migration apply/down/reapply in isolated PostgreSQL/PGlite, golden journey, role/privacy checks.

Do not merge PR #98 directly without reconciling it with the latest `main`, applying security corrections, testing on actual Supabase staging and obtaining explicit owner approval.

### 2.4 M1–M6 tables not yet deployed

At the last environment audit, these tables existed in the PR #98 migrations but did not exist in staging or production:

- `evidence_class_taxonomy`
- `evidence_sources`
- `evidence_sets`
- `evidence_provenance_events`
- `ingestion_jobs`
- `source_records`
- `vehicle_identity_candidates`
- `listing_snapshots`
- `ai_analysis_jobs`
- `ai_observations`
- `temporal_findings`
- `disclosure_claims`
- `disclosure_conflicts`
- `report_versions`
- `review_tasks`
- `review_decisions`
- `disputes`
- `dispute_events`
- `trust_change_log`

Therefore, M1–M6 is **built in code but not deployed as an operating database system**.

---

## 3. MVP Definition of Done

The Core Vehicle Trust OS MVP is complete only when all of the following are true.

### 3.1 Canonical vehicle and listing relationship

- Every public listing belongs to one canonical VIN vehicle.
- VIN is the stable vehicle identity across resale and relisting.
- Plate, chassis, engine and registration identifiers are stored where available.
- Duplicate VIN is structurally prevented.
- Duplicate or conflicting plate/chassis/engine identity is flagged for review.

### 3.2 Vehicle-document relationship

- Every vehicle document/evidence record has a real foreign-key relationship to a vehicle.
- The original uploaded asset remains attached and retrievable according to visibility rules.
- Checksums and source metadata are retained.
- Corrections supersede earlier records rather than silently overwriting history.

### 3.3 OCR and field-level comparison

- OCR output is normalized into typed field-level records.
- Every extracted field stores a confidence score.
- Extracted VIN, plate, chassis, engine, owner, registration and document identifiers can be compared with the canonical vehicle.
- Match, mismatch, missing-reference and inconclusive states are persisted.
- Human review can confirm, reject, amend or request more information.
- OCR/AI never approves a vehicle, document or trust fact automatically.

### 3.4 Government and compliance evidence

The MVP must support the following categories:

- ZIMRA customs/import duty;
- CVR registration/blue book ownership;
- ZINARA road licence;
- VID roadworthiness;
- CID/police clearance and stolen check;
- insurance;
- import port/date;
- customs/duty-payment proof.

Each category must be honestly classified as one of:

- source-connected;
- CarUp document-reviewed;
- pending review;
- rejected;
- missing;
- expired;
- not applicable.

A manually uploaded and human-reviewed official document is acceptable for MVP. It must not be described as a live agency API verification unless a real source adapter proves that claim.

### 3.5 Separate trust, completeness, confidence and risk

The public and administrative contracts must not collapse these into one number.

Expose separately:

- `trust_score`;
- `evidence_completeness`;
- `confidence_level`;
- `risk_status`;
- `risk_reasons`;
- `missing_requirements`;
- `verification_status`.

A vehicle with little evidence must show **Insufficient evidence** or equivalent conservative language rather than appearing normally trusted merely because the score starts from a baseline.

### 3.6 Seller/dealer workflow

- Seller/dealer can create a draft vehicle/listing.
- Seller/dealer sees required, present, pending, verified, rejected, expired and missing records.
- Seller/dealer can upload missing evidence.
- The system explains what blocks publication.
- Engine number collected by the listing form is actually sent and stored.
- Chassis, plate/temp-ID and import status are included in the listing workflow.

### 3.7 Buyer workflow

- Vehicle card displays only governed, source-specific trust claims.
- Vehicle detail displays trust score, completeness, confidence, risk reasons and missing evidence.
- Buyer can understand why the vehicle is trusted, incomplete or risky.
- Generic “Verified” must not imply that all compliance categories are verified.
- Private/internal OCR, AI, actor, IP, reviewer or source-credential data never reaches the buyer.

### 3.8 Publication lifecycle

Implement and enforce a lifecycle equivalent to:

```text
draft
→ identity_complete
→ documents_submitted
→ review_pending
→ publishable
→ published
```

Incomplete vehicles may be saved as drafts. They must not be publicly represented as fully trusted.

### 3.9 Continuity and immutability

- Ownership transfer adds to the existing VIN passport.
- Relisting reuses the same VIN history.
- Evidence provenance is append-only.
- Review decisions are append-only.
- Report versions are immutable.
- Audit events cannot be silently lost.
- Deleting an evidence asset must not cascade-delete its provenance history.

### 3.10 Release qualification

- All migrations apply to actual staging Supabase.
- RLS and grants are proven with role/tenant tests.
- One complete golden vehicle passes end to end.
- TypeScript, backend, migration, web build and Playwright tests pass.
- A release PR is opened and stops before merge.
- Production is changed only after explicit owner authorization.

---

## 4. Explicit Non-Goals for MVP

The following must not delay the MVP:

- perfect AI accuracy;
- full production-scale visual similarity processing;
- live integrations with every Zimbabwe government agency;
- automatic government decisions;
- automatic police clearance approval;
- all insurers or auction providers;
- fully automated legal conclusions;
- unrelated marketplace, referral, finance or navigation expansion;
- visual redesign not required for the trust workflow.

These are post-MVP workstreams.

---

## 5. Safety and Governance Rules

1. Never run destructive or unreviewed migrations on production.
2. Never run migration files containing both Up and Down sections with plain `psql -f`.
3. Use the marker-aware migration runner.
4. Never expose service-role secrets in client code, logs, fixtures, reports or commits.
5. Never use `npm audit fix --force` as part of this programme.
6. Never reduce lint/security rules merely to make CI green.
7. Never call fixture/manual-review records “live government verification”.
8. Never allow raw AI confidence to change trust directly.
9. Never allow a critical trust mutation to succeed while its required audit event is silently lost.
10. Never merge to `main` or deploy/migrate production without explicit owner approval.
11. Commit only intended files.
12. Preserve current Marketplace, Navigation Intelligence, authentication, security and production hotfixes while integrating PR #98.

---

## 6. Known Risks Requiring Correction

### 6.1 Broad RLS policies in PR #98

PR #98 uses authenticated `USING (true)` read policies on several operational or sensitive tables. Before staging deployment, review and narrow access for:

- `ingestion_jobs`;
- `source_records`;
- `vehicle_identity_candidates`;
- `listing_snapshots`;
- `ai_analysis_jobs`;
- `ai_observations`;
- `temporal_findings`;
- `disclosure_claims`;
- `disclosure_conflicts`;
- `review_tasks`;
- `review_decisions`;
- `disputes`;
- `dispute_events`;
- `trust_change_log`;
- `evidence_provenance_events`.

Raw operational, AI, governance, reviewer, actor and IP data should normally be service-role/API mediated or strictly role/tenant/vehicle scoped.

### 6.2 Existing tables requiring RLS/grant review

The last production audit reported RLS disabled on:

- `vehicle_documents`;
- `vehicle_plate_history`.

Enable suitable RLS and audit grants before relying on direct Supabase access.

### 6.3 Provenance deletion risk

PR #98 links provenance to evidence with cascading deletion. Preserve provenance when assets are removed or superseded. Prefer restrictive deletion or a retained tombstone rather than `ON DELETE CASCADE` for the audit chain.

### 6.4 Trust baseline risk

The current trust calculation begins from a baseline score. A vehicle with minimal evidence can therefore appear more trusted than its evidence justifies. Separate trust from completeness/confidence and add an insufficient-evidence state.

### 6.5 Generic verification claims

Do not allow plate verification, a police flag field or a generic legacy `isVerified` value to produce a broad “Verified vehicle” claim. Use source-specific claims.

### 6.6 Listing bypass

The current listing flow can submit a vehicle without the complete identity and document workflow. It must become a draft/publishability workflow rather than an immediate trusted-publication workflow.

### 6.7 Best-effort audit

Some current routes catch audit errors and continue. For trust-changing decisions, use a database transaction or durable outbox so the mutation and audit record cannot diverge silently.

### 6.8 Unproven blockchain language

Use **tamper-evident CarUp audit ledger** unless an independently verifiable blockchain network transaction is actually available.

### 6.9 Placeholder seller data

Remove hard-coded seller phone/identity fallbacks from production buyer views.

---

## 7. Execution Plan

## Phase 0 — Re-establish Truth and Isolation

1. Use the existing branch `release/core-vehicle-trust-os-mvp`.
2. Resolve the latest `origin/main` SHA at execution time.
3. Create or attach an isolated worktree for this branch.
4. Confirm the worktree is clean.
5. Compare current `main` with PR #98.
6. Inventory every relevant migration, table, route, service, type, page and test.
7. Update this document only with verified deltas.
8. Create `docs/vehicle-trust-os/PRODUCTION_BASELINE_AUDIT.md` with dated evidence.
9. Do not change production.

**Phase exit:** current-main/PR-overlap report and clean isolated branch.

## Phase 1 — Integrate PR #98 into the Release Branch

Integrate the complete PR #98 tree into `release/core-vehicle-trust-os-mvp`.

Preserve the union of:

- current Marketplace v1;
- Navigation Intelligence;
- current authentication/session behaviour;
- current security containment;
- current audit hotfixes;
- current Vehicle Trust routes and services;
- all M1–M6 implementation.

Resolve conflicts deliberately. Do not discard tests, routes, migrations or authorization rules simply to make the merge pass.

Create:

- `docs/vehicle-trust-os/PR98_INTEGRATION_CONFLICT_REPORT.md`;
- exact source-commit provenance for every integrated milestone;
- a list of intentionally excluded files, if any, with justification.

**Phase exit:** integrated tree builds far enough to run migrations/tests; no unresolved conflict markers.

## Phase 2 — Database Security Remediation

Before applying M1–M6 to staging:

1. Replace broad authenticated-read policies with service-role/API mediation or scoped policies.
2. Enable and test RLS on `vehicle_documents` and `vehicle_plate_history`.
3. Review grants separately from policies.
4. Prevent evidence deletion from erasing provenance.
5. Add appropriate foreign keys for review tasks, decisions, disputes and trust-change records.
6. Pin `search_path` on security-sensitive functions.
7. Add database tests proving:
   - anon denied;
   - unrelated authenticated user denied;
   - cross-tenant denied;
   - owner receives only allowed own records;
   - dealer receives only allowed tenant records;
   - admin/government/reviewer permissions are explicit;
   - service-role operations work.

Create:

- `docs/vehicle-trust-os/RLS_AND_GRANT_MATRIX.md`.

**Phase exit:** no broad sensitive-table access; automated authorization matrix passes.

## Phase 3 — Strict Vehicle Document and OCR Contract

Use `ai_observations` if it can fully satisfy the following contract. Otherwise add an additive table such as `vehicle_document_extractions`.

Required fields:

- `id`;
- `evidence_id`;
- `vin`;
- `document_type`;
- `field_name`;
- `raw_value`;
- `normalized_value`;
- `confidence`;
- `compared_vehicle_field`;
- `expected_value`;
- `match_status` (`match`, `mismatch`, `missing_reference`, `inconclusive`);
- `mismatch_reason`;
- `review_status`;
- `reviewed_by`;
- `reviewed_at`;
- `created_at`.

Requirements:

- retain the original asset;
- retain provider/model/provenance;
- never overwrite the document with extracted data;
- never auto-approve from AI confidence;
- add strict TypeScript types;
- replace `Record<string, any>` in the Vehicle Evidence/OCR contract;
- persist mismatch findings for human review.

**Phase exit:** field-level extraction and mismatch tests pass.

## Phase 4 — Document Completeness and Publication Gate

Implement a deterministic requirements evaluator.

### Core identity

- VIN;
- chassis number;
- engine number;
- plate or temporary ID.

### Ownership

- CVR/registration evidence;
- ownership-transfer evidence where applicable.

### Imported vehicle

- import record;
- customs entry;
- duty-payment proof.

### Road use

- VID evidence;
- ZINARA status;
- insurance;
- CID/stolen check.

Return each requirement as:

- required;
- present;
- pending review;
- verified;
- rejected;
- expired;
- missing;
- not applicable.

Return aggregate fields:

- completeness percentage;
- confidence level;
- blocking requirements;
- advisory requirements;
- publishable boolean;
- safe public explanation.

Change listing behaviour so incomplete records can be saved as drafts but cannot be represented as fully trusted/publicly verified.

Fix the listing form:

- send `engine_number`;
- add chassis number;
- add plate/temp-ID;
- add import status;
- connect uploads to the evidence/document workflow;
- show missing requirements;
- use backend-confirmed publishability;
- do not display “now live” unless publication actually succeeded.

**Phase exit:** listing lifecycle and missing-document tests pass.

## Phase 5 — Trust Explanation and Public-Claim Remediation

1. Replace broad “Verified” claims with source-specific claims:
   - plate verified;
   - ownership reviewed;
   - duty document reviewed;
   - VID reviewed;
   - CID record reviewed;
   - insurance on file;
   - passport/evidence completeness state.
2. Do not let plate verification imply whole-vehicle verification.
3. Show trust score, completeness, confidence and risk separately.
4. Show insufficient evidence conservatively.
5. Remove unproven blockchain language.
6. Remove placeholder seller contact/identity fallbacks.
7. Preserve cautious buyer language.
8. Ensure public serializers strip internal explanations, raw model output, reviewer-private notes, source credentials, actor IDs and IP addresses.

**Phase exit:** marketplace card/detail and privacy tests pass.

## Phase 6 — Audit, Review and Immutability

Ensure durable audit events for:

- evidence uploaded;
- OCR/extraction completed;
- mismatch detected;
- reviewer opened;
- approved;
- rejected;
- requested more information;
- trust changed;
- listing became publishable;
- listing was blocked;
- ownership transferred;
- evidence corrected/superseded;
- dispute opened/responded/resolved;
- report version created/revoked/corrected.

For critical trust mutations, use:

- one database transaction; or
- a durable transactional outbox.

Do not use best-effort audit for trust-changing decisions.

Prove append-only/immutability behaviour for:

- provenance events;
- review decisions;
- dispute events;
- trust changes;
- listing snapshots;
- report snapshots.

**Phase exit:** mutation/audit atomicity and immutability tests pass.

## Phase 7 — Staging Migration

Target staging only:

```text
eoyenigwevnxwwhyhaer
```

Use the marker-aware migration runner. Never use plain `psql -f` on Up/Down migration files.

Apply the six M1–M6 migrations and all required hardening/additive migrations in dependency order.

Verify:

- migration ledger;
- all expected tables/views;
- foreign keys;
- constraints;
- indexes;
- triggers;
- RLS enabled state;
- policies;
- grants;
- append-only enforcement;
- down/reapply in isolated PostgreSQL/PGlite;
- no production mutation.

Create:

- `docs/vehicle-trust-os/STAGING_MIGRATION_REPORT.md`.

**Phase exit:** actual Supabase staging schema and authorization checks pass.

## Phase 8 — Golden Vehicle MVP Journey

Create clearly labelled staging fixtures only.

Prove one complete vehicle journey:

1. create canonical vehicle;
2. store VIN/chassis/engine/plate or temp-ID;
3. create import record;
4. upload customs/duty document;
5. run OCR/extraction;
6. compare VIN/plate/chassis/engine;
7. deliberately produce one mismatch;
8. route mismatch to human review;
9. reject, correct or supersede it;
10. upload CVR/ownership proof;
11. upload VID proof;
12. record ZINARA status;
13. record CID/stolen result;
14. attach insurance;
15. calculate completeness, confidence, risk and trust;
16. block publication before minimum policy passes;
17. publish after requirements pass;
18. display governed card claims;
19. display buyer explanations;
20. display seller missing-document checklist;
21. transfer ownership;
22. relist the same VIN;
23. confirm previous passport history remains;
24. create report version 1;
25. correct/supersede evidence;
26. create report version 2;
27. confirm version 1 remains immutable;
28. confirm public/private and cross-tenant boundaries.

Government fixtures/manual documents must be labelled accurately. They are not live government API confirmations.

Create:

- `docs/vehicle-trust-os/GOLDEN_VEHICLE_EVIDENCE_REPORT.md`.

**Phase exit:** golden journey passes with no skipped critical steps.

## Phase 9 — Full Test and Quality Gate

Run and report exact results for:

- migration apply/down/reapply;
- backend Vehicle Trust suites;
- evidence upload/review;
- OCR normalization and mismatch;
- AI advisory-only behaviour;
- RLS/auth matrix;
- trust/completeness/confidence calculation;
- listing publishability;
- ownership continuity;
- provenance immutability;
- report-version immutability;
- governance/disputes;
- marketplace cards/detail;
- seller missing-document prompts;
- TypeScript web;
- TypeScript mobile where affected;
- Vite production build;
- Playwright golden journey;
- `git diff --check`;
- source and artifact secret scan;
- changed-code lint gate;
- full lint debt reported separately rather than hidden.

Do not report skipped tests as passed.

Create:

- `docs/vehicle-trust-os/RELEASE_QUALIFICATION_REPORT.md`.

**Phase exit:** all MVP-critical checks pass or exact blockers are documented.

## Phase 10 — Release Pull Request

1. Commit only intended files.
2. Push `release/core-vehicle-trust-os-mvp`.
3. Open one release PR to `main`.
4. Include:
   - production baseline audit;
   - PR #98 integration provenance;
   - conflict-resolution report;
   - migration report;
   - RLS/grant matrix;
   - golden vehicle evidence;
   - exact test counts;
   - production migration runbook;
   - rollback/forward-fix plan;
   - post-MVP deferred work.
5. Do not merge.
6. Do not deploy or migrate production.
7. Stop for explicit owner authorization.

**Phase exit:** release PR ready for owner review.

## Phase 11 — Production Cutover, Only After Explicit Authorization

Production target:

```text
vhmnajoeicasaigiophh
```

After the owner explicitly authorizes production cutover:

1. confirm current release PR head and approval;
2. confirm production backup/recovery point;
3. confirm migration plan and target ref;
4. apply approved migrations in dependency order;
5. verify schema, policies, grants, functions, indexes and triggers;
6. merge the approved release PR to `main`;
7. verify backend and web deployments;
8. run production-safe, clearly labelled smoke tests;
9. verify one real public listing never receives unsupported trust claims;
10. verify logs, errors, audit events and rollback triggers;
11. publish final release evidence.

Stop or roll back/disable publication if any of the following occur:

- cross-tenant exposure;
- incorrect VIN/evidence attachment;
- private evidence leak;
- incomplete vehicle marked verified/publishable;
- unexplained trust score;
- missing required audit event;
- migration inconsistency;
- repeated backend 5xx;
- public claim implying unsupported live government verification.

---

## 8. Principal Files and Components

### Database migrations

- `database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql`
- `database/migrations/20260621130000_external_source_ingestion.sql`
- `database/migrations/20260621140000_ai_temporal_disclosure_intelligence.sql`
- `database/migrations/20260621150000_report_versions.sql`
- `database/migrations/20260621160000_governance_disputes_corrections.sql`
- `database/migrations/20260621170000_outbox_dead_letter.sql` or the exact integrated M6 filename
- new security/OCR/completeness migrations created by this release

### Existing tables to reconcile

- `vehicles`
- `vehicle_documents`
- `vehicle_evidence`
- `vehicle_government_documents`
- `vehicle_import_records`
- `vehicle_ownership_history`
- `vehicle_plate_history`
- `ocr_documents`
- `verification_sessions`
- `verification_ocr_provenance`
- `registry_verifications`
- `insurance_records`
- `stolen_vehicles`
- `trust_score_history`
- `trust_audit_events`
- `vehicle_listings`
- `vehicle_listing_summaries`
- `zimra_declarations`
- `cvr_ownership_records`
- `vid_inspections`
- `cid_clearance_records`
- `zinara_licensing_records`

### Backend

- `backend/routes/vehiclesRoutes.js`
- `backend/routes/evidenceCatalogRoutes.js`
- `backend/routes/ingestionRoutes.js`
- `backend/routes/intelligenceRoutes.js`
- `backend/routes/reportRoutes.js`
- `backend/routes/governanceRoutes.js`
- `backend/services/evidence/evidenceService.js`
- `backend/services/evidence/*`
- `backend/services/trustGraph/trustGraphService.js`
- `backend/services/marketplace/listingSummaryService.js`
- `backend/services/marketplace/marketplaceTrustSummaryService.js`
- `backend/services/ingestion/*`
- `backend/services/intelligence/*`
- `backend/services/report/*`
- `backend/services/governance/*`
- `backend/services/eventBus/*`
- `backend/services/auditLogger.js`

### Shared and web types

- `shared/types/marketplace.ts`
- `web/src/types/index.ts`
- relevant API request/response types

### Web

- `web/src/pages/dashboard/owner/SellVehicle.tsx`
- `web/src/pages/dashboard/owner/VehicleProfile.tsx`
- `web/src/components/EvidenceUploadModal.tsx`
- `web/src/pages/dashboard/admin/EvidenceReview.tsx`
- `web/src/pages/dashboard/shared/TrustReviewQueue.tsx`
- `web/src/pages/dashboard/shared/GovernanceReviewQueue.tsx`
- `web/src/pages/Marketplace.tsx`
- `web/src/pages/VehicleDetail.tsx`
- `web/src/components/marketplace/TrustSummaryPanel.tsx`
- PR #98 history/report/disclosure/temporal components
- `web/src/hooks/useCarUpApi.ts`

### Tests

- `database/test/migration_pglite_check.mjs`
- `backend/tests/evidence-*.test.js`
- `backend/tests/vehicle-life-*.test.js`
- `backend/tests/golden-journey.test.js`
- `backend/tests/governance-*.test.js`
- `backend/tests/marketplace-*.test.js`
- `web/e2e/evidence-timeline.spec.ts`
- `web/e2e/vehicle-detail.spec.ts`
- `web/e2e/plate-privacy.spec.ts`
- new completeness, OCR mismatch, listing gate and ownership-continuity tests

---

## 9. Required Release Artifacts

The release is not review-ready until the branch contains:

- this canonical plan;
- `PRODUCTION_BASELINE_AUDIT.md`;
- `PR98_INTEGRATION_CONFLICT_REPORT.md`;
- `RLS_AND_GRANT_MATRIX.md`;
- `STAGING_MIGRATION_REPORT.md`;
- `GOLDEN_VEHICLE_EVIDENCE_REPORT.md`;
- `RELEASE_QUALIFICATION_REPORT.md`;
- production migration runbook;
- rollback/forward-fix plan;
- post-MVP deferred backlog.

Each report must contain commands, exact counts, environment target and commit SHA. Avoid unsupported completion percentages.

---

## 10. Agent Operating Loop

Use this loop throughout implementation:

```text
1. Read this plan.
2. Inspect current branch, main, PR #98 and environment truth.
3. Select only the next incomplete MVP phase.
4. State the exact acceptance criteria for that phase.
5. Implement the minimum change satisfying those criteria.
6. Run focused tests.
7. Run relevant regression tests.
8. Inspect the diff for unrelated changes and secrets.
9. Update the corresponding evidence document.
10. Commit only intended files.
11. Continue to the next phase.
12. Stop before merge or production mutation unless the owner explicitly authorizes it.
```

When blocked, report:

- exact blocker;
- affected file/table/environment;
- evidence;
- minimum corrective action;
- whether it blocks staging, merge or production.

Do not create new feature phases merely because improvements are possible.

---

## 11. Final Status Vocabulary

At the end of any agent run, use exactly one of these classifications:

```text
NOT READY — VEHICLE TRUST BLOCKERS REMAIN
```

```text
READY FOR OWNER-APPROVED VEHICLE TRUST PRODUCTION CUTOVER
```

```text
VEHICLE TRUST OS MVP LIVE — PRODUCTION SMOKE GREEN
```

Never report the MVP as live when only local, CI or staging tests have passed.

---

## 12. Immediate Next Action

Continue on `release/core-vehicle-trust-os-mvp` with **Phase 0**:

1. resolve the latest `main` and PR #98 heads;
2. create the isolated worktree;
3. produce the current overlap/baseline audit;
4. integrate PR #98 deliberately;
5. stop feature expansion;
6. proceed through the numbered gates until one release PR is ready for owner review.

The objective is a working, united MVP—not perfection and not another growing backlog outside production.

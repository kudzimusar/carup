# Milestone 0 — Discovery & Gap Audit (Code-Derived)

**Program:** CarUp Vehicle Life Intelligence & CarVertical-Parity (Master Plan PR #89)
**Audit method:** 5 parallel read-only domain audits (database, evidence/storage/import, AI/document-intelligence, frontend/mobile, governance/infra) + direct verification of key migrations and the test harness.
**Status of this document:** Authoritative current-state snapshot as of the start of implementation. Section 3 of the master plan requires this before broad implementation begins.

> Scope correction (per master plan §1.3): navigation work is a **subordinate** sub-plan. This program is the Vehicle Life Intelligence product. Navigation completion ≠ this program.

---

## 1. Current-State Architecture (as built)

```
Monorepo (npm workspaces): web · backend · mobile · shared
│
├── web/         Vite + React 19 + React Router v7 + Radix UI + Tailwind + TanStack Query
│                Feature-registry-driven nav. API via useCarUpApi() hook (VITE_API_URL).
│
├── backend/     Express (server.js) → routes/ → services/ → db/supabase.js (service_role)
│                Durable transactional outbox (eventBus/eventWorker.js, domain_events,
│                FOR UPDATE SKIP LOCKED, attempts<5). In-memory rate limiting.
│                Security middleware (CSP/CSRF/CORS). Metrics hub. Correlation IDs.
│                Structured logger with secret redaction.
│                AI: Gemini 2.5 Flash LIVE for OCR/doc-intelligence; vision = MOCK.
│
├── database/    Raw SQL migrations (database/migrations/), numbered 001–016 then
│                timestamp-prefixed YYYYMMDDHHMMSS_*.sql. Supabase Postgres. RLS enforced.
│
└── mobile/      Expo Router + React Native + NativeWind + TanStack Query.

Deploy: Vercel (web: carup / carup-staging; backend: carup-backend*). Supabase managed PG.
CI: only two workflow_dispatch workflows (diaspora live validation). No PR-gating CI.
```

### Migration naming convention (verified)
- Legacy: `NNN_descriptive_name.sql` (001–016).
- Current: `YYYYMMDDHHMMSS_slug.sql` (14-digit UTC timestamp). **All new migrations use this format.**
- Format: `-- +migrate Up` … `-- +migrate Down` (reversible). Idempotent (`IF NOT EXISTS`, `IF EXISTS`).

### Test harness (verified)
- **Runnable unit/integration pattern:** `node --test backend/tests/*.test.js`. Tests monkeypatch `supabase.from` with an in-memory chainable builder + mock `supabase.storage`, then drive **real Express routers over HTTP**. Self-contained; no live DB needed. This is the pattern all new M1 backend tests follow.
- **Integration suite:** `node backend/tests/run-tests.js` expects a seeded Supabase — **must never run against production** (master plan §19).
- **Frontend:** `npx tsc --noEmit --project web/tsconfig.app.json`, `npm run build`, Playwright (`npm run test:qa`).
- **Baseline confirmed green:** existing evidence tests pass 12/12 in the M1 worktree before any change.

---

## 2. Entity Map vs. Master-Plan Cross-Cutting Data Model (§14)

| Target entity (plan §14) | Status | Backing table(s) / note |
|---|---|---|
| vehicles | ✅ Implemented | `vehicles` (supabase_schema + 013 plate identity + 20260603 condition flags) |
| vehicle_identity_history | 🟡 Partial | `vehicle_plate_history` (plate only); no full identity-event table |
| vehicle_timeline_events | 🟡 Derived (no table) | **No dedicated table.** `vehicle_evidence.timeline_event_id` is a nullable text pointer to registry events; timeline is derived from evidence + registry events |
| vehicle_evidence | ✅ Implemented | `vehicle_evidence` (014 + 015): checksum, 13-type CHECK, 4 visibility levels, RLS |
| evidence_assets | 🟡 Partial | Asset fields live inline on `vehicle_evidence`; no separate asset table / parent-asset lineage |
| evidence_sets | ❌ Missing | **M1 target** |
| evidence_sources | ❌ Missing (free-text only) | `source_name`/`source_reference` columns exist but unpopulated; no registry. **M1 target** |
| evidence_provenance_events | 🟡 Partial | General `trust_audit_events` exists; no evidence-scoped immutable chain-of-custody. **M1 target** |
| ingestion_jobs | ❌ Missing | **M2 target** |
| source_records | ❌ Missing | **M2 target** |
| listing_snapshots | 🟡 Partial (not versioned) | `vehicle_listing_summaries` is overwrite-in-place denormalized; no immutable snapshots. **M2 target** |
| inspection_records | 🟡 Partial | spread across `partsentry_logs`, `vehicle_government_documents` |
| mileage_observations | 🟡 Partial | `partsentry_logs.mileage`, odometer evidence; no dedicated series. **M3/M4** |
| ownership_transfer_records | 🟡 Partial | `vehicle_ownership_history` |
| ai_analysis_jobs | 🟡 Partial | `ai_fraud_scans` (point-in-time); no durable job state machine. **M3 target** |
| ai_observations | ✅ Implemented | `ai_fraud_scans`, `diaspora_trade_document_extractions`, evidence `metadata.ai_analysis` |
| temporal_findings | ❌ Missing | **M3 target** |
| disclosure_claims | ❌ Missing | **M3 target** |
| disclosure_conflicts | ❌ Missing | **M3 target** |
| review_tasks | 🟡 Partial | `trust_fact_requests`, `diaspora_compliance_reviews`; no unified queue. **M5 target** |
| review_decisions | ✅ Implemented | `trust_audit_events` + reviewer fields |
| disputes | 🟡 Partial | scattered (`safepay_escrows.dispute_reason`, `marketplace_listing_reports`); no lifecycle. **M5 target** |
| report_versions | ❌ Missing | **M4 target** |
| audit_events | ✅ Implemented | `trust_audit_events`, `diaspora_import_audit_log` (crypto seal), `system_audit_logs` |

---

## 3. Implemented / Partial / Missing by Milestone (deliverable matrix)

### Milestone 1 — Evidence product model (taxonomy + provenance)
| Deliverable | Status | Evidence |
|---|---|---|
| 8 life-stage classes | 🟡 Partial | 13 flat `evidence_type` values; no class layer (`015:30-44`) |
| Subtypes + validation | 🟡 Partial | type CHECK exists; no class/subtype matrix |
| Legacy compat | ✅ Base present | additive migrations preserved legacy via backfill pattern (015) |
| Evidence sets | ❌ Missing | — |
| Source registry | ❌ Missing | free-text only |
| Provenance fields | 🟡 Partial | uploader/captured/uploaded/verified present; missing source_id, received_at, perceptual_hash, parent asset, transformation history, checksum_algorithm |
| Cryptographic checksum | ✅ Implemented | SHA-256 `checksumForBuffer` (`evidenceService.js:94`) |
| Perceptual hash | ❌ Missing | exact-checksum dedup only |
| Immutable chain-of-custody | 🟡 Partial | `trust_audit_events` exists but not evidence-scoped/append-only-locked |
| Timeline shows stage/date/source/verification | 🟡 Partial | timeline icons exist; no 8-class life-stage UI |
| Public/private serialization | ✅ Implemented | AI metadata stripped for non-admin (`vehiclesRoutes.js:390-398`) + RLS |

### Milestone 2 — Ingestion: ❌ mostly Missing (provider interface, ingestion_jobs, identity resolution, immutable listing snapshots, sandbox adapters, partner onboarding). `importService.js` is ZIMRA-duty only.

### Milestone 3 — AI/temporal/disclosure: 🟡 Foundations only. Gemini LIVE for OCR; vision MOCK; AI correctly advisory (verified by `evidence-ai-fraud.test.js`). Missing: durable analysis jobs, per-task typed analysis, perceptual/near-dup similarity, same-vehicle validation, temporal comparison, component-change findings, disclosure claim extraction + conflict engine, evaluation suite.

### Milestone 4 — Buyer report: 🟡 Data shown scattered on `VehicleDetail.tsx`; no dedicated report, completeness model, before/after comparison UI, sharing/versioning.

### Milestone 5 — Governance: 🟡 Strong base. Server-side roles (`authMiddleware.js`), trust-fact request/review/approve/reject/revoke workflow, immutable audit, **AI cannot mutate trust** (verified). Missing: disputes/correction lifecycle, amend/request-more/inconclusive/escalate, unified review queues, public disputed/superseded safety, `vehicles.trust_score` field governance.

### Milestone 6 — Infra/release: 🟡 Mixed. Durable outbox ✅, observability/metrics 🟡 (no alerts). Missing: PR-gating CI, secret/dependency scanning, deployment ADR, distributed rate limiting, outbox DLQ, WAF/DDoS config, backups + restore test, DR plan, golden datasets, staging pilot.

---

## 4. Conflict & Dependency Register

**Open PRs (14 total) — overlap assessment vs. this program:**
- #89 master plan (docs only) — this program's source of truth.
- #11 partsentry approval, #58 diaspora read scoping, #72 phase-7c verification, #76 RC1, #66 mobile nav, #81/#90 diaspora, #85/#86/#87/#88 docs+referral.
- **No open PR touches the evidence taxonomy / provenance / temporal-AI surface.** Lowest-conflict files for M1: `vehicle_evidence` schema + `services/evidence/*` + new tables. **Conflict risk for M1: LOW.**
- Caution: `vehiclesRoutes.js` is large and touched by several flows — M1 edits there must be additive and minimal.

**Dependency order (hard):** M1 (taxonomy+provenance) → M2 (ingestion uses provenance/sources/sets) → M3 (AI consumes evidence+sets; temporal needs sets+same-vehicle) → M4 (report renders M1–M3 outputs) → M5 (governs all findings) → M6 (operates all of it). M5 governance primitives partially reusable earlier (trust-fact workflow).

**Reuse mandates (do NOT duplicate):** `vehicle_evidence`, `trust_audit_events`, `trust_fact_*` workflow, dual-bucket storage + EXIF strip + signed URLs, `checksumForBuffer`, `metrics` hub, `eventWorker` outbox, `authMiddleware`, feature registry, `EvidenceUploadModal`/`EvidenceReview`/`TrustReviewQueue`/`PremiumEvidenceGallery`.

---

## 5. Proposed Milestone PR Sequence (per master plan §18)

| PR | Branch | Scope | Base |
|---|---|---|---|
| M1 | `feat/vehicle-life-m1-taxonomy-provenance` | 8-class taxonomy, subtypes, evidence sets, source registry, provenance fields, perceptual-hash abstraction, immutable chain-of-custody, taxonomy/sources APIs, upload+timeline UI | `main` |
| M2 | `feat/vehicle-life-m2-ingestion` | provider interface, durable ingestion_jobs, identity resolution queue, immutable listing snapshots, sandbox adapters, partner onboarding | M1 |
| M3A | `feat/vehicle-life-m3a-ai-jobs` | durable analysis jobs + per-task typed providers (live+mock) + similarity + evaluation | M2 |
| M3B | `feat/vehicle-life-m3b-temporal` | temporal comparison + component-change findings + before/after UI | M3A |
| M3C | `feat/vehicle-life-m3c-disclosure` | claim extraction + conflict engine + seller response | M3B |
| M4 | `feat/vehicle-life-m4-report` | buyer history report + completeness + sharing/versioning | M3C |
| M5 | `feat/vehicle-life-m5-governance` | disputes/correction/adjudication + unified queues + trust separation | M4 |
| M6A | `feat/vehicle-life-m6a-infra` | CI gates, deployment ADR, distributed rate limiting, DLQ, secrets, WAF, backups/DR docs | M5 |
| M6B | `feat/vehicle-life-m6b-validation` | golden datasets, E2E, security/resilience, staging pilot, release evidence | M6A |

**Authorization boundary (master plan §7, §18):** No implementation PR is merged, and no production deploy occurs, without the user explicitly stating `merge this PR now`. PR #89 is not merged by agents.

---

## 6. Key risks surfaced by the audit
1. `vehicle_evidence` lacks `tenant_id`-scoped RLS for evidence (vehicle-scoped only) — cross-tenant leak risk if ownership bug. (Hardening candidate.)
2. `checksum` has no algorithm marker; `image_hash` legacy column overlaps. (M1 adds `checksum_algorithm`.)
3. Perceptual hashing constrained by available libs (only `pngjs`; no sharp/jimp) — abstraction with honest format limits, not an overstated claim.
4. In-memory rate limiting fails across instances (M6).
5. No PR-gating CI — regressions can land unblocked (M6).
6. `securityMiddleware` JWT fallback uses service-role key when `JWT_SECRET` absent — fix in M5/M6.

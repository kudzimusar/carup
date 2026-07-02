# Vehicle Trust OS — Staging Migration Report

**Date (UTC):** 2026-06-25T06:11Z
**Target project:** `eoyenigwevnxwwhyhaer` (STAGING) — `https://eoyenigwevnxwwhyhaer.supabase.co`
**Engine:** PostgreSQL 17.6 · Session Pooler `aws-1-ap-southeast-2.pooler.supabase.com:5432`
**Runner:** `database/scripts/apply_migrations_staging.mjs` (Up sections only, per-migration transaction, **stop on first SQL error**)
**Production (`sfhtlzcgrnrdznhvdrbn`, "production-os"):** NOT touched. `supabase db push` NOT used. MCP `apply_migration` NOT used.

## Pre-flight (no schema changes)
- `SUPABASE_URL` and `SUPABASE_DB_URL` both resolve to `eoyenigwevnxwwhyhaer`; production id absent from `.env.staging`.
- Removed a stale duplicate `SUPABASE_DB_URL` placeholder line so exactly one (real) value remained.
- Live connect verified: PostgreSQL 17.6, db `postgres`; **0 of 19** target tables present pre-apply; **113** total public tables (prerequisite base schema present).
- Dry-run validated all 10 migration files extract valid `+migrate Up` sections.

## Migrations applied (10 / 10 OK · 0 failed · 0 missing)
| # | Migration | Result |
|---|---|---|
| 1 | 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql | ✓ OK |
| 2 | 20260621130000_external_source_ingestion.sql | ✓ OK |
| 3 | 20260621140000_ai_temporal_disclosure_intelligence.sql | ✓ OK |
| 4 | 20260621150000_report_versions.sql | ✓ OK |
| 5 | 20260621160000_governance_disputes_corrections.sql | ✓ OK |
| 6 | 20260621170000_outbox_dead_letter.sql | ✓ OK |
| 7 | 20260624120000_vehicle_trust_security_hardening.sql | ✓ OK |
| 8 | 20260624130000_vehicle_document_extractions.sql | ✓ OK |
| 9 | 20260624140000_listing_publication_lifecycle.sql | ✓ OK |
| 10 | 20260624150000_trust_change_log_immutability.sql | ✓ OK |

## 1. Tables verified — 20 / 20 present
`evidence_class_taxonomy, evidence_sources, evidence_sets, evidence_provenance_events,
ingestion_jobs, source_records, vehicle_identity_candidates, listing_snapshots,
ai_analysis_jobs, ai_observations, temporal_findings, disclosure_claims, disclosure_conflicts,
report_versions, review_tasks, review_decisions, disputes, dispute_events, trust_change_log,
vehicle_document_extractions` — 0 missing.

Also verified:
- View `evidence_sources_public` ✓
- New `vehicles` columns from publication lifecycle: `publication_status`, `temp_plate_id` ✓
- Seed data: `evidence_class_taxonomy` = 59 rows, `evidence_sources` = 5 rows ✓

## 2. RLS / policies / grants / triggers
**RLS enabled (21 tables):** all 20 Vehicle Trust OS tables that require it + the hardened
`vehicle_plate_history` and `vehicle_evidence`. (`evidence_class_taxonomy` is intentionally
RLS-off public reference catalog.)

**Service-role-only lockdown (RLS enabled, no policy — by design):**
`ai_analysis_jobs, ingestion_jobs, source_records, vehicle_identity_candidates, listing_snapshots,
evidence_sources`. The Phase 2 hardening migration deliberately drops the permissive
`authenticated read USING(true)` policies on the ingestion/internal tables and revokes
`ai_analysis_jobs` to `service_role`; `evidence_sources` base table is service-role only with the
public surface exposed via `evidence_sources_public`. (The re-grant statements live in each
migration's `+migrate Down` section, which the runner never executes.)

**Policies present (governed read where intended):** `vehicle_evidence` (4), `report_versions` (3),
`vehicle_document_extractions` (2), and 1 each on `ai_observations, disclosure_claims,
disclosure_conflicts, dispute_events, disputes, evidence_provenance_events, evidence_sets,
review_decisions, review_tasks, temporal_findings, trust_change_log, vehicle_plate_history`.

**Append-only / guard triggers (12 present):**
`trg_provenance_no_update/_no_delete`, `trg_listing_snapshot_no_update/_no_delete`,
`trg_report_version_guard`, `review_decisions_no_update/_no_delete`,
`dispute_events_no_update/_no_delete`, `trust_change_log_no_update/_no_delete`,
`trg_extraction_no_content_update`.

**Anon exposure check:** no anon access to any restricted intelligence/ingestion/governance table
(RLS denies anon — `anon_restricted_leak = []`).

## Security note (pre-existing staging posture, NOT from these migrations)
The staging project applies broad default privileges: `anon` holds full DML on **94** public
tables, including pre-existing `users`, `vehicles`, `vehicle_evidence`. The Vehicle Trust OS
migrations grant only `SELECT`; the breadth is the staging environment's default-privilege
configuration. It is **mitigated by RLS** on all sensitive Vehicle Trust OS tables. The one
RLS-off Vehicle Trust OS table, `evidence_class_taxonomy`, is non-sensitive reference catalog.
**Recommendation (platform, out of scope for this migration):** review staging default privileges
(`anon`/`authenticated`) before any staging→prod promotion; consider RLS on reference tables if
anon-write is a concern.

## Result
**Staging migration: SUCCESS.** All 10 Vehicle Trust OS migrations applied to `eoyenigwevnxwwhyhaer`;
all expected tables, view, columns, RLS, policies, grants, triggers, and seeds verified. Production
untouched. Proceeding to Phase 8 (golden vehicle journey).

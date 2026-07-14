# Database Migration Reconciliation

> Generated: 2026-06-19 (updated 2026-06-19 after staging migration)
> PR: #72 — phase-7c-native-verification-production-loop

---

## Migration Infrastructure

The repository uses a custom Node.js migration engine (`backend/db/migrate.js`) with a
`schema_migrations` tracking table in SQLite. However, the Supabase PostgreSQL project
uses Supabase's own migration history via `supabase_migrations.schema_migrations`.

**Key split**: Many numbered migrations (001–015) are SQLite-flavored and were never
designed for Supabase. The timestamp-prefixed files (202606...) are Postgres-native
and represent the target Supabase schema.

---

## Production (`vhmnajoeicasaigiophh`)

### Migrations Recorded by Supabase

The production Supabase migration history is **incomplete** because many schema changes
were applied manually via the SQL editor rather than through Supabase migrations:

| Migration | Status | Notes |
|-----------|--------|-------|
| `20260603233640_governance_foundation_trust_audit_events.sql` | Applied | Manually via SQL editor. `trust_audit_events` table exists with rows. |
| `20260604002000_trust_fact_requests_phase2a.sql` | Applied | Manually via SQL editor. `trust_fact_requests` table exists. |
| `20260605042424_verification_sessions_phase7b.sql` | Applied | Manually via SQL editor. `verification_sessions` exists with data. |
| `20260613000000_phase7b_supabase_auth_and_identity.sql` | Applied | Applied manually. `user_sessions`, `login_attempts`, `ocr_documents` exist. |
| `20260613020000_verification_admin_review.sql` | Applied | Manually. `review_decision`, `retry_reason`, `liveness_status` columns present. |
| `20260618030000_verification_ocr_provenance.sql` | Applied | Manually. `verification_ocr_provenance` table exists. |
| `20260618040000_verification_case_management.sql` | NOT applied | Missing `workflow_phase`, `final_disposition`, `primary_reason_code`, etc. on `verification_sessions`. `verification_assessments` and `verification_decisions` tables absent. |
| `20260618050000_verification_evidence_trust_columns.sql` | NOT applied | Missing `evidence_classification`, `ocr_execution_status`, etc. on `verification_sessions`. |

### Schema Objects Without Recorded Migration

- `users` — pre-dates all migration tracking (legacy)
- `vehicles`, `vehicle_evidence` — created via older SQLite-to-Postgres port
- `storage.buckets` with `ocr-documents` bucket — created manually
- Various Diaspora tables (phase 1b foundation) — applied manually
- Marketplace listing summary infrastructure — applied manually

### Known Manual SQL Applied

- `trust_audit_events` table and RLS
- `trust_fact_requests` table and RLS
- `verification_sessions` table and all Phase 7B columns
- `verification_admin_review` columns
- `verification_ocr_provenance` table
- `ocr-documents` storage bucket

### Current State

- **27 public tables without RLS** — many are reference/operational data
- `verification_sessions` has RLS enabled and properly restricted to service_role
- `trust_audit_events` has RLS enabled and properly restricted
- **Two Phase 7C migrations NOT yet applied** (case management + evidence trust columns)

---

## Staging (`eoyenigwevnxwwhyhaer`)

### Migrations Recorded by Supabase

Staging migration history was incomplete before the Phase 7B/7C identity chain was
applied via the connected Supabase integration. The following migrations are now
recorded in the staging `supabase_migrations.schema_migrations` table:

| Migration | Applied At | Notes |
|-----------|-----------|-------|
| `20260603233640_governance_foundation_trust_audit_events.sql` | Pre-existing | `trust_audit_events` existed before this task with rows. |
| `20260619013321_phase7b_supabase_auth_and_identity` | 2026-06-19 | First migration of the identity chain. |
| `20260619013422_verification_admin_review_columns` | 2026-06-19 | Admin review columns on `verification_sessions`. The status-check constraint alignment was applied as a separate operation after the main migration because the Supabase integration split the DDL. |
| `20260619013448_phase7c_ocr_provenance` | 2026-06-19 | OCR provenance audit table. |
| `20260619013505_verification_case_management` | 2026-06-19 | Case management: assessments, decisions, workflow columns. |
| `20260619013517_verification_evidence_trust_columns` | 2026-06-19 | Evidence/trust snapshot columns. |

### Verified Post-Migration State

| Check | Result |
|-------|--------|
| `users` | PRESENT — 13 rows preserved |
| `user_sessions` | PRESENT — 8 rows preserved |
| `login_attempts` | PRESENT |
| `ocr_documents` | PRESENT |
| `verification_sessions` | PRESENT — accepts `retry_requested` status |
| `trust_audit_events` | PRESENT — 6 rows preserved, structurally compatible |
| `verification_ocr_provenance` | PRESENT |
| `verification_assessments` | PRESENT |
| `verification_decisions` | PRESENT |
| `ocr-documents` bucket | PRESENT — private |
| `pgcrypto` extension | PRESENT |
| RLS on identity/verification tables | ENABLED |
| `anon` direct access on new tables | DENIED |
| `authenticated` direct access on new tables | DENIED |
| `service_role` access on new tables | GRANTED |

### Staging State After Migration

- All 9 required base tables exist (`users`, `user_sessions`, `login_attempts`,
  `ocr_documents`, `verification_sessions`, `trust_audit_events`,
  `verification_ocr_provenance`, `verification_assessments`, `verification_decisions`)
- All 16 `verification_sessions` columns verified present with correct types
- Foreign keys target compatible columns
- Indexes exist on all expected columns
- RLS enabled on all Phase 7B/7C identity and verification tables
- `ocr-documents` bucket is private
- 39 public tables still have RLS disabled (no existing policies were changed)

---

## Schema Drift Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `trust_audit_events` in staging has rows; replaying the CREATE TABLE would fail | Low | Use `CREATE TABLE IF NOT EXISTS` in all migrations |
| Older numbered migrations (001–015) contain SQLite syntax incompatible with Postgres | High | Never run these against Supabase; use timestamp-prefixed Postgres-native files |
| Manual SQL applied in production without repo migration record | Medium | Document each manual change; file additive migration if refinement needed |
| Staging and production have diverged | Medium | Staging now includes all 5 identity migrations; production still missing the final 2 case-management migrations |
| `supabase_migrations.schema_migrations` timestamps between migrations in staging do not match the repository file timestamps | Low | Migration content is identical; only the recording timestamp differs because the Supabase integration assigned its own timestamps during application |
| Status-check constraint was applied as a separate operation after admin-review columns in staging | Low | The migration file `20260613020000` includes both the column addition and the constraint change in one file; the Supabase integration split them. No behavioural difference |

---

## Recommended Future Migration Policy

1. **Every DDL change has one repository migration file.**
   - No manual SQL in the Supabase SQL editor without preserving the SQL as a migration.
   - All migrations must be timestamp-prefixed and Postgres-native.

2. **Staging first, then production.**
   - Apply every migration to staging. Verify. Run preflight + verification.
   - Owner acceptance sign-off before production application.

3. **Schema verification after every migration run.**
   - Run `scripts/verify-phase7c-staging-schema.mjs` after applying.
   - Capture pre/post row counts for tables with data.

4. **Production application follows the same chain.**
   - Use the same verified migration files.
   - Apply with explicit authorization only.
   - Verify row preservation.

5. **Migration version recorded.**
   - Record the migration version (filename timestamp) after successful application.
   - Do not modify or insert into `supabase_migrations.schema_migrations` manually.

6. **Rollback/recovery note.**
   - Every additive migration must document its rollback SQL in comments.
   - Migrations that cannot be rolled back must state so explicitly.

7. **No unsolicited cross-domain migrations.**
   - Do not apply marketplace, Diaspora, referral, finance, or registry migrations
     as part of a verification/auth PR.

---

## Approved Migration Chain (PR #72)

```
Order  File                                                    Purpose
─────  ───────────────────────────────────────────────────────  ──────────────────────────────────
  1    database/migrations/20260613000000_phase7b_supabase_    Supabase auth (user_sessions,
       auth_and_identity.sql                                   login_attempts, ocr_documents,
                                                               verification_sessions, bucket)
  2    database/migrations/20260613020000_verification_admin_  Admin review columns on
       review.sql                                              verification_sessions
  3    database/migrations/20260618030000_verification_ocr_    OCR provenance audit table
       provenance.sql
  4    database/migrations/20260618040000_verification_case_   Case management (assessments,
       management.sql                                          decisions, workflow columns)
  5    database/migrations/20260618050000_verification_        Evidence trust columns on
       evidence_trust_columns.sql                              verification_sessions
```

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Skip replaying `20260603233640_governance_foundation_trust_audit_events.sql` against staging | `trust_audit_events` already exists in staging with data; the repository migration is structurally compatible |
| Do not replay `20260604002000_trust_fact_requests_phase2a.sql` | Not part of the Phase 7B/7C identity chain; `trust_fact_requests` is a governance Phase 2A concern |
| Apply identity chain in strict order | Each migration builds on the previous (e.g., `verification_sessions` must exist before admin review columns, OCR provenance FKs, and case management tables) |
| Backend tests set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` before dynamic import | The `db/supabase.js` module eagerly validates env vars at import time; dynamic import with env preset is the established pattern |

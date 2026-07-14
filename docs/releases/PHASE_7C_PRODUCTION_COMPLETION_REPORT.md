# Phase 7C — Production Cutover Completion Report

Executed 2026-07-14 under the owner authorization phrase
`AUTHORIZE PHASE 7C PRODUCTION CUTOVER`. Scope: apply the two missing
migrations, promote the app tier, run bounded internal-account verification.
Providers kept disabled; no real customer documents used.

## Migrations applied (production `vhmnajoeicasaigiophh`)
Applied in ONE transaction with an in-transaction row-count gate (auto-rollback
on any change); both are additive + `IF NOT EXISTS`-idempotent.
- `20260618040000_verification_case_management.sql` — sha256 `bec9f67a…3ab2b6`
- `20260618050000_verification_evidence_trust_columns.sql` — sha256 `0e19346e…6b4bed4`
(01 and 03 were already present in production — safe no-ops, not re-run.)

PITR restore point (pre-cutover last WAL archive): **2026-07-14T13:11:49.756Z**.

## Row-count integrity (across the migration)
| Table | Before | After | Δ from migration |
|---|--:|--:|---|
| verification_sessions | 9 | 9 | 0 |
| users | 27 | 27 | 0 |
| trust_audit_events | 826 | 826 | 0 |

Data fingerprints (verification_sessions + users) **identical** before/after —
no existing row altered. NOTE: `trust_audit_events` read 826 at cutover (not the
preflight's 746) due to normal production audit growth **before** the migration;
the migration itself changed nothing.

## New objects verified
- `verification_assessments` — 19 cols, 5 indexes, RLS **on**, FK `…_session_id_fkey`
- `verification_decisions` — 16 cols, 7 indexes, RLS **on**, FK `…_session_id_fkey`, has `idempotency_key`
- `verification_sessions` +9 cols (workflow_phase, final_disposition, primary_reason_code, next_actor, required_action, action_due_at, notification_status, notification_attempted_at TIMESTAMPTZ, version default 1) and +5 cols (evidence_classification, ocr_execution_status, extraction_trust_status, identity_binding_status, selfie_check_status)
- RLS confirmed **on** for verification_sessions/_ocr_provenance/_assessments/_decisions (server-owned deny-by-default model intact).

## Deployments promoted (main `afb96a3f4`)
- Backend → `dpl_6NuCm3VxcnZ8YC87XrJY1NMuZZhY` (`carup-backend.vercel.app`); health 200, supabase healthy, `ocrProviders` all false, 7C routes live (`/latest`, `/admin/...`).
- Frontend → `dpl_HkkfLXWVBc5R4rpPNW5QpfgoroHV` (`carup.vercel.app`); HTTP 200.

## Standing rollback deployments (SHA `0277fd45f`)
- Frontend `dpl_Gig8j6RyLzF1UdatarcjYqx7kZ14` · Backend `dpl_BJyvv3qhMQ7oSAn2fX9bbiKemgkT`
- Rollback command: `vercel promote <that-deployment>` (or `vercel rollback`); DB is additive → forward-fix only, never drop the new objects.

## Bounded production verification (internal test accounts, controlled non-document)
18/19 API assertions PASS; the one miss was a test response-key mismatch — the
production DB authoritatively confirms the audit/decision trail. Verified on
production session `d07016fe-f99b-4493-9074-b26f06fd138f`:
- created → controlled non-document evidence submitted → **never verified** → Manual Review Required;
- admin Request Resubmission → **reviewer reason reaches the applicant** (retry_requested);
- resubmit → admin **reject** → applicant sees **Rejected**;
- rejected applicant **blocked before document selection/camera** (`/latest` terminal; new session 403);
- admin **reopen** (Request Resubmission) → applicant entry **restored** (new session 201);
- admin queue loads with **correct applicant name/email**;
- **audit chain complete** (DB): 3 verification_decisions (request_resubmission → reject → request_resubmission), 2 verification_assessments, events SESSION_CREATED/IMAGE_UPLOADED/SUBMITTED/EVIDENCE_INVALID/RETRY_REQUESTED×2/REJECTED;
- **no cross-user exposure**: session owned by the test applicant; applicant blocked from admin API (403); unauthenticated blocked (401).

## Fail-closed posture (confirmed unchanged)
GEMINI_API_KEY absent; `ocrProviders` all false; automatic approval unavailable
(approve is policy-blocked without a trusted classifier); no external providers;
no live capability flags changed; no real customer documents used.

## Test cleanup — COMPLETED (owner-authorized, 2026-07-14)
Removed under `AUTHORIZE PHASE 7C PRODUCTION TEST CLEANUP` in ONE guarded
transaction (auto-rollback guards on every count). Read-only dependency scan
first confirmed a test-only footprint across all 103 users-FK tables (no genuine
customer records). Deleted: 2 verification_sessions (cascaded 2 assessments +
3 decisions + 0 provenance), 9 user_sessions, 9 login_attempts, 2 users
(`prod-gate2-applicant@internal.carup.test`, `prod-gate2-admin@internal.carup.test`).
Post-cleanup: users **29→27**, verification_sessions **11→9**, 0 orphans, RLS
still on all four verification tables, **trust_audit_events preserved** (Phase 7C
audit chain untouched), frontend 200, backend UP, providers disabled.

## Result
**PASS** — Phase 7C is live in production (schema + app tier), fail-closed, with
verified end-to-end verification governance and a standing app-tier rollback.

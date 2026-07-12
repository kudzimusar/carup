# Phase 7C — Production Cutover Runbook

Release PR: **#115** (`release/phase7c-verification-production`)
Production Supabase: `vhmnajoeicasaigiophh` — **NO step below may run before the exact
authorization phrase:** `AUTHORIZE PHASE 7C PRODUCTION CUTOVER`

## Preconditions (verify all before requesting authorization)

- [ ] PR #115 merged into `main` (post owner Gate 2 PASS + owner merge approval)
- [ ] CI green on the merge commit on `main`
- [ ] Owner device Gate 2 recorded PASS in `docs/reports/PHASE_7C_STAGING_ACCEPTANCE_REPORT.md`
- [ ] P0 = 0, P1 = 0 open defects
- [ ] Production DB backup / point-in-time restore point confirmed (Supabase dashboard → Backups)
- [ ] Current production backend + web deployment IDs recorded (rollback targets)
- [ ] `GEMINI_API_KEY` present in production backend env (approve path requires a live classifier)
- [ ] Production env references `vhmnajoeicasaigiophh` only; no localhost/dev fallback; storage bucket private

## Migration order (additive; sha256 in PHASE_7C_GATE2_CLOSURE_AND_PRODUCTION_PLAN.md)

Read-only inventory first (`scripts/phase7c-staging-preflight.mjs` pattern pointed at
production via SUPABASE_PROJECT_REF/SUPABASE_DB_URL — note: the apply script
**hard-refuses** the production ref by design; production application is a
deliberate, manual, owner-supervised run of the same 5 files in this order):

1. `20260613000000_phase7b_supabase_auth_and_identity.sql`
2. `20260613020000_verification_admin_review.sql`
3. `20260618030000_verification_ocr_provenance.sql`
4. `20260618040000_verification_case_management.sql`
5. `20260618050000_verification_evidence_trust_columns.sql`

All are `IF NOT EXISTS`-additive: no DROP/DELETE/TRUNCATE; existing rows untouched.
Post-apply: run the verify script equivalent against production; confirm row counts
unchanged for `users`, `user_sessions`, `trust_audit_events`.

## Deployment order

1. **Backend first** (`carup-backend` → production). Verify `/api/health` 200,
   `supabase.status: healthy`, correct project binding.
2. **Web admin** (`carup` → production). Verify `/admin/verification` 200 and the
   bundle targets the production backend.
3. **Mobile**: production update via the established Expo release channel only —
   no store submission unless explicitly authorized.

## Bounded production smoke (internal test account ONLY — never real customer documents)

login → session create → controlled submission → admin case visible →
signed preview (200, `no-store`, expiry) → request resubmission → mobile/API refresh
truthful → resubmit → decision → audit chain rows present → unauthorized 401/403 →
non-document fails closed (no false approval).

## Rollback triggers & actions

Triggers: migration failure · auth failure spike · sessions cannot be created ·
cross-user exposure · preview leakage · false approval · wrong mobile status ·
audit write failures · error-rate spike.

Actions:
- **App**: redeploy last known-good backend + web deployment IDs (recorded above).
- **DB**: forward-fix only; migrations are additive — do NOT drop columns/tables;
  evidence/audit/decision data must never be deleted.
- **Mobile**: roll back the update channel; never ship an untested emergency binary.

## Actors & duration

Executor: release engineer (this loop) after the owner speaks the authorization
phrase. Owner: authorizes, observes smoke, holds rollback veto. Expected duration:
30–45 min including smoke; observation window per goal directive after cutover.

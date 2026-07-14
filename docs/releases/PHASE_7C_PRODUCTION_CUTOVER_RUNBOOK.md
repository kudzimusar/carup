# Phase 7C — Production Cutover Runbook

Release PR: **#115** (`release/phase7c-verification-production`)
Production Supabase: `vhmnajoeicasaigiophh` — **NO step below may run before the exact
authorization phrase:** `AUTHORIZE PHASE 7C PRODUCTION CUTOVER`

## Preconditions (verify all before requesting authorization)

- [ ] PR #115 merged into `main` (post owner Gate 2 PASS + owner merge approval)
- [ ] CI green on the merge commit on `main`
- [x] Owner device Gate 2 recorded PASS (2026-07-14) in `docs/reports/PHASE_7C_STAGING_ACCEPTANCE_REPORT.md`
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

---

## App-tier production rollback — EXECUTED 2026-07-14 (owner-authorized)

The merge of PR #114 into `main` (`afb96a3f4`) triggered Vercel's git-integration
to auto-deploy the app tier to **production** (production branch = `main`). The
owner authorized an immediate **app-tier-only** rollback — explicitly NOT a
Phase 7C database cutover. Executed with `vercel rollback` (reassigns the
production alias only; deletes nothing; no DB/provider/kill-switch changes).

### Frontend — `carup`
| | |
|---|---|
| Rolled back FROM | `dpl_HkkfLXWVBc5R4rpPNW5QpfgoroHV` · SHA `afb96a3f4` · `carup-1bmel9qme-pay-pass-project.vercel.app` |
| Rolled back TO (known-good) | `dpl_Gig8j6RyLzF1UdatarcjYqx7kZ14` · SHA `0277fd45f` · `carup-hn60rbomk-pay-pass-project.vercel.app` |
| `carup.vercel.app` now points to | `dpl_Gig8j6RyLzF1UdatarcjYqx7kZ14` (confirmed via Vercel alias API) |
| Result | `Success! carup was rolled back` · `vercel rollback status` = Success |

### Backend — `carup-backend`
| | |
|---|---|
| Rolled back FROM | `dpl_6NuCm3VxcnZ8YC87XrJY1NMuZZhY` · SHA `afb96a3f4` · `carup-backend-e12oc7xhl-pay-pass-project.vercel.app` |
| Rolled back TO (known-good) | `dpl_BJyvv3qhMQ7oSAn2fX9bbiKemgkT` · SHA `0277fd45f` · `carup-backend-qklxnk9gn-pay-pass-project.vercel.app` |
| `carup-backend.vercel.app` now points to | `dpl_BJyvv3qhMQ7oSAn2fX9bbiKemgkT` (confirmed via Vercel alias API) |
| Result | `Success! carup-backend was rolled back` · `vercel rollback status` = Success |

Timestamps (UTC): rollback window 2026-07-14T06:38:50Z → 06:39:33Z (each ~2s).
Previous production (before merge) and restored SHA are the SAME: **`0277fd45f`**
(prior `main`). The merge SHA `afb96a3f4` remains on `main`; its deployments were
NOT deleted, only de-aliased from production.

### Post-rollback verification
- Frontend `carup.vercel.app` → HTTP 200.
- Backend `carup-backend.vercel.app/api/health` → 200 (`status: UP`, supabase `healthy`, outboxBacklog 0).
- Read-only production smoke: **8/8 PASS** (homepage, health, csrf-token,
  marketplace listings/parts/services/categories, `auth/me` correctly 401).
- `ocrProviders` all `false` — Gemini/Groq/OpenRouter/Moonshot NOT activated.
- **Production database UNTOUCHED:** no migrations, no DDL, no writes were run
  against production Supabase `vhmnajoeicasaigiophh` (this environment has no
  production DB access; all Phase 7C DDL was staging-only `eoyenigwevnxwwhyhaer`).
- **Staging UNCHANGED:** `carup-backend-staging` on the Phase 7C release, health
  UP / supabase healthy — not affected by the rollback.

### Readiness checklist for a later CONTROLLED Phase 7C production cutover
Production app tier is restored to pre-7C `0277fd45f`; `main` carries the merged
7C code (`afb96a3f4`). A future controlled cutover (gated by the exact phrase
`AUTHORIZE PHASE 7C PRODUCTION CUTOVER`) must, IN ORDER:
1. Confirm a production DB backup / restore point.
2. Apply the 4 Phase 7C migrations to `vhmnajoeicasaigiophh` (admin_review →
   ocr_provenance → case_management → evidence_trust_columns; sha256 manifest in
   `PHASE_7C_GATE2_CLOSURE_AND_PRODUCTION_PLAN.md`) and verify objects/rows.
3. Provision production `GEMINI_API_KEY` (approve path) if approved.
4. Re-promote the `main`/`afb96a3f4` (or newer) production deployments of
   `carup` + `carup-backend` — backend first, then frontend.
5. Run the bounded production verification (internal test account only; never
   real customer documents), confirm audit chain + truthful mobile status.
6. Rollback trigger stays available: `vercel rollback` back to `0277fd45f`.

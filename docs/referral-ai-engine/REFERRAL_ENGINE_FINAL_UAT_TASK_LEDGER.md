# Referral Engine — Final UAT Release Task Ledger

Execution branch: `feat/referral-final-uat-release`
Plan: `docs/referral-ai-engine/REFERRAL_ENGINE_FINAL_UAT_RELEASE_GOAL_LOOP.md`
Plan commit brought onto branch: `8045c8d`
Started: 2026-06-21

## Environment gate (decisive)

- Staging ref required by plan: `eoyenigwevnxwwhyhaer` (UAT only).
- Production-looking ref (must NOT be used for UAT): `vhmnajoeicasaigiophh`.
- `backend/.env.uat.local`: **ABSENT** locally.
- Staging service-role / Supabase / UAT env vars in shell: **NONE present**.
- Seed script `backend/scripts/seed-uat-referral-users.mjs`: present.

**Consequence:** Per plan "valid early-stop conditions" → *staging secret unavailable locally*.
Live-staging phases (F1 live auth gate, F2 admin UAT, F3 owner UAT, F4 mobile UAT)
cannot be executed without fabricating evidence, which the plan forbids.
All independent non-staging work is completed first, per plan.

## Phase ledger

| Phase | Scope | Status | Notes |
|-------|-------|--------|-------|
| Setup | Branch + plan doc | DONE | `feat/referral-final-uat-release` from `main`, plan committed `cc81c44` |
| F1 (code) | Login.tsx readable inline error alert + tests | DONE | 11 tests green, tsc 0; commit `ec84381` |
| F1 (live) | Staging login + auth-boundary proof | BLOCKED | Needs staging service-role secret |
| F2 | Admin web UAT (campaign/codes/coupons/leads/imports/marketing/trust) | BLOCKED | Needs live staging |
| F3 | Owner reward loop + dispute | BLOCKED | Needs live staging |
| F4 | Mobile UAT | BLOCKED | Needs live staging + device/emulator |
| F5 | Defect remediation loop | DONE (independent) | D1 login UX, D2 test-encoding; no critical/high in independent scope |
| F6 | Release-candidate regression (local) | DONE | All local suites green (see totals); referral journey e2e BLOCKED (needs staging) |
| F7 | Release evidence docs | DONE (drafts) | UAT report + production-readiness + rollback runbook committed |
| G | Production promotion | NOT STARTED | Requires explicit owner approval (out of scope) |

## Automated regression totals (commit 5dada67)

- web `tsc -p web/tsconfig.app.json --noEmit`: exit 0, 0 errors
- web `test:unit` (vitest): **139 passed / 0 failed**, 14 files
- mobile `ts:check`: exit 0, 0 errors
- backend referral `node --test` suites (17): **145 passed / 0 failed / 0 skipped**
- backend full custom harness: exit 0, 36/36 numbered tests, 92 ✅
- web `build`: exit 0, 2588 modules, dist emitted
- Discrete tests passing: **284** (139 web + 145 backend) + full backend harness + 2 tsc checks. 0 failures. 0 suites blocked on missing staging (all DB-touching backend suites self-mock).

## Real referral artifacts (verified)

- Migration: `database/migrations/016_referral_engine_phase1.sql` (9 tables, RLS on, idempotent, no Down block)
- Backend routes: `backend/routes/referralRoutes.js` mounted at `/api/referrals`
- Reward choke point: `createWalletTransaction` in `backend/services/referral/referralEngineService.js`
- Web routes: `web/src/App.tsx` (7 referral routes), nav in `web/src/config/featureRegistry.ts`

## Updates log
- 2026-06-21: Setup complete; staging-secret blocker confirmed; independent work started.
- 2026-06-21: F1 login-UX fix + 11 tests committed (`ec84381`). Web + backend + mobile regression all green (284 discrete tests, 0 failures). F7 docs (UAT report, production readiness, rollback runbook) drafted. F1-live/F2/F3/F4 remain BLOCKED on staging secret.

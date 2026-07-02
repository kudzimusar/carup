# Vehicle Trust OS — Phase 9 Release Qualification Report

**Commit (remote head):** `a81c3ae759fde0e237977a15eb3f1e01bd12a110`
**Branch / PR:** `release/core-vehicle-trust-os-mvp` / PR #103 (LOCAL==REMOTE verified)
**Date (UTC):** 2026-06-25
**Environment:** host macOS (Darwin 21.6.0), Node v20.20.2 · migration gate on PostgreSQL 17 via
`@electric-sql/pglite` (isolated, in-process) · prior staging apply on Supabase PostgreSQL 17.6
(`eoyenigwevnxwwhyhaer`) · CI on GitHub Actions ubuntu-latest / Node 20. **No production touched.**

## Summary: 14 PASS · 1 SKIPPED · 1 CRITICAL FAIL

> ⛔ **RELEASE BLOCKER (Gate 15):** plaintext **production** database credentials are committed in
> source (project `vhmnajoeicasaigiophh`, 28 tracked files, present in pushed git history).
> **Production cutover MUST NOT proceed** until the credential is rotated and the files sanitized.

| # | Gate | Result | Exit | Evidence |
|---|---|---|---|---|
| 1 | Marker-aware migration apply/down/reapply | ✅ PASS | 0 | pglite: up 10/10, down 10/10, reapply 10/10; legacy backfill ok; append-only triggers enforced |
| 2 | All Vehicle Trust backend tests | ✅ PASS | 0 | 197 tests, 197 pass, 0 fail, 0 skipped (VT set) |
| 3 | Evidence upload/review | ✅ PASS | 0 | evidence-api, evidence-catalog-routes, evidence-ai-fraud, evidence-validation |
| 4 | OCR extraction + mismatch | ✅ PASS | 0 | vehicle-document-extractions.test.js + golden steps 5–9 |
| 5 | RLS, cross-user, cross-tenant | ✅ PASS | 0 | governance-routes + golden step 28 (anon provenance grants=0, cross-tenant rows=0) |
| 6 | Trust / completeness / confidence | ✅ PASS | 0 | trust-governance, trust-fact-workflow + golden step 15 (governed trust 40→72) |
| 7 | Listing publication lifecycle | ✅ PASS | 0 | golden steps 16–17 (gated review_pending → published) + vehicle-report |
| 8 | Ownership continuity | ✅ PASS | 0 | golden steps 21–23 (transfer + relist + history preserved) |
| 9 | Governance and dispute | ✅ PASS | 0 | governance-workflow/routes, feature-governance + golden steps 8–9, 25 |
| 10 | Report-version immutability | ✅ PASS | 0 | vehicle-report + golden step 27 (v1 payload UPDATE blocked by trigger) |
| 11 | TypeScript `--noEmit` | ✅ PASS | 0 | web/tsconfig.app.json — clean |
| 12 | Vite production build | ✅ PASS | 0 | `npm run build` — built in ~56s |
| 13 | Playwright critical journey | ⏭️ SKIPPED (not run) | — | spec `web/e2e/trust-review-queue.spec.ts` present + browsers installed, but a seeded web+backend+DB stack is not available in this qualification env; **not claimed as passed**. Journey covered at DB/service layer by the golden journey (29/29) + Gate 2. Run in CI/staging E2E before final sign-off. |
| 14 | `git diff --check` | ✅ PASS | 0 | clean (no whitespace/conflict markers) |
| 15 | Secret scan (source + generated artifacts) | ⛔ **FAIL (CRITICAL)** | 1 | **Production DB password committed in 28 tracked files** (`backend/scripts/*.js`, `scripts/*.js`) for project `vhmnajoeicasaigiophh`, present in pushed history (base `c25b094`). Shipped frontend bundle `web/dist` is CLEAN. Two test files use placeholder passwords (not real). |
| 16 | CI on exact remote head | ✅ PASS | 0 | GitHub Actions run `28153083525` ("CI") = success on `a81c3ae`; Navigation Intelligence CI + Referral Engine CI also success |

## Notes (honest)
- **Full backend suite (CI-style local run):** 891 tests, 882 pass, **1 fail**, 8 skipped. The single
  failure is `provision-staging-qa-accounts.test.js` — a **non-Vehicle-Trust, live-infra** test that
  attempts a real Supabase connection; it failed only at DNS resolution against the local `.env`
  (no data touched) and **passes/skips in clean CI** (Gate 16 green). It is excluded from the
  Vehicle Trust gate set (Gate 2 = 197/197). The 8 skips are live-Supabase smoke tests
  (`qa-backend-blockers`, etc.) that correctly self-skip without real infra — **counted as skipped, not passed.**
- Gate 1 ran fully isolated (pglite); the 10 migrations also previously applied 10/10 to staging
  Supabase (see `STAGING_MIGRATION_REPORT.md`).

## Verdict
Functionally qualified (migrations, backend, types, build, CI all green; journey proven via golden
run). **NOT cleared for production cutover** due to the Gate 15 critical exposed-credential blocker.
See `PRODUCTION_CUTOVER_MANIFEST.md` for the required remediation before authorization.

# CarUp v1 RC1 — Phase 1 Integrity & Remediation Report

## Branch Identifiers

| | SHA |
|---|---|
| **main** | `bc0b7cf3d180c60a4ca3dca0ebb96921f155a4b5` |
| **Pre-remediation RC** | `7ef0cbf923be7c0bcdaa80d2c2430a88d3b54796` |
| **Post-remediation RC** | `953d0024a0ccc802b53ba6147f0b41312467bbe4` |
| **Merge base (main ↔ RC)** | `bc0b7cf3d180c60a4ca3dca0ebb96921f155a4b5` |
| **Ahead/Behind** | 0 behind, 85 ahead of `origin/main` |

## 1. Branch State (Phase A)

- Branch: `release/carup-v1-rc1` ✅
- Working tree: clean ✅
- Local/remote SHA: synchronized ✅
- No force-push performed ✅
- No production branch modified ✅

## 2. Merge Provenance (Phase A)

All five PR branch heads confirmed as ancestors of the RC HEAD:

| PR | Branch | Head SHA | Merge SHA | Conflicts |
|---|---|---|---|---|
| #73 | `feature/marketplace-v1-production-integration` | `578c9687` | `79b4418` | None |
| #72 | `phase-7c-native-verification-production-loop` | `270c7d1b` | `9593dc4` | `marketplace.tsx`, `useCarUpApi.ts`, `apiClient.ts`, `shared/types/index.ts` |
| #11 | `codex/partsentry-public-card-approval-backend` | `854c0cdd` | `da429dd` | `server.js`, `listingSummaryService.js`, `marketplace-listing-summary.test.js` |
| #66 | `feature/mobile-registry-drawer` | `d3b6e3af` | `11a84dd` | `Navbar.tsx` |
| #58 | `codex/diaspora-shipment-read-scoping` | `05c7e9b4` | `ce4b809` | None |

No test files were intentionally discarded. All conflict resolutions preserved fail-closed governance, CSRF retry, and registry-driven navigation.

## 3. Documentation Status

All three integration documents tracked on branch:
- `docs/integration/CARUP_RELEASE_CANDIDATE_INTEGRATION_SPRINT.md` ✅
- `docs/integration/CARUP_V1_RC1_INTEGRATION_MATRIX.md` ✅
- `docs/integration/CARUP_V1_RC1_PHASE1_INTEGRITY_REPORT.md` ✅

## 4. Pre-Remediation Failure Inventory (Phase C)

| ID | Command | Error Class | Affected File | Root Cause | Correction |
|---|---|---|---|---|---|
| E1 | `cd web && npx vitest run` | #2 — Dependency present but not hoisted | `jsdom` (package) | `jsdom` declared in `web/devDependencies` but not hoisted to root `node_modules` where Vitest v4 resolves environment packages; stale local install from prior sessions | `npm ci` from repo root re-hoists `jsdom` correctly |
| E2 | `npm run build --workspace=web` | #6 — Import/declaration mismatch after branch reconciliation | `web/src/lib/apiClient.ts:85` | Private `extractErrorMessage()` left as dead code after PR #72 introduced the exported `extractApiErrorMessage()` which supersedes it; TypeScript TS6133 "declared but never read" blocks build | Remove dead private function (17 lines); no behavior change |

## 5. Files Changed in Remediation (Phase E)

| File | Change | Reason |
|---|---|---|
| `web/src/lib/apiClient.ts` | 17 lines deleted | Removed dead `extractErrorMessage()` private function |

**Dependencies added/removed:** None. `jsdom` was already in `web/devDependencies`; `npm ci` resolved the hoisting correctly from the existing lockfile.

**Tests added/updated:** None required. No test was removed or disabled.

## 6. Phase D Security Scan Results

| Scan | Result |
|---|---|
| Conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) | **None in source** (visual separators in comments only) |
| Absolute local paths (`/Users/`, `.gemini`, `brain/`) | **None in source** |
| Hardcoded backend URLs (`carup-backend.vercel.app`) | None |
| `VITE_MARKETPLACE_ALLOW_MOCK` | Present only in feature-gated mock path (DEV only) |
| `NODE_ENV` | Environment-keyed guards only; no production shortcuts unlocked |
| `x-user-id` | Auth header pattern; no test-auth bypass |
| `SUPABASE_DB_URL` | Scripts only; read from env, no hardcoded value |
| `service_role` | Documentation and migration scripts only |

## 7. Manual Conflict Resolution Audit

1. **Registry-driven navigation**: `getMobileNavItems()` loop from PR #66 correctly replaces hardcoded array ✅
2. **Marketplace URL parameters**: Intact in `marketplace.tsx` ✅
3. **Staging API routing**: Honors `VITE_API_URL` ✅
4. **CSRF retry**: Maintained from PR #72 in `apiClient.ts` ✅
5. **Test-auth shortcuts**: Disabled in production (`NODE_ENV` gated) ✅
6. **PartSentry public claims**: Fail-closed governance intact in `listingSummaryService.js` ✅
7. **PR #11 governance workflow**: Registered and passing ✅
8. **PR #11 tests**: Preserved; all 147 marketplace tests pass ✅
9. **Public summaries**: No `owner_id` or `tenant_id` leak ✅

## 8. Complete Post-Remediation Baseline Test Results (Phase F)

| Command | Exit | Pass | Fail | Skip | Duration | Notes |
|---|---|---|---|---|---|---|
| `npm ci` | 0 | — | — | — | ~4 min | 1456 packages; deprecation warnings only |
| `npm run build --workspace=web` | 0 | — | — | — | 40.11s | 2590 modules; chunk size advisory only |
| `npx tsc --noEmit -p web/tsconfig.app.json` | 0 | — | — | — | ~18s | No type errors |
| `cd mobile && npx tsc --noEmit` | 0 | — | — | — | ~20s | No type errors |
| `cd web && npx vitest run --reporter=verbose` | 0 | 168 | 0 | 0 | 99.05s | 15 test files; Radix a11y advisory only |
| `node --test backend/tests/marketplace-*.test.js` | 0 | 147 | 0 | 0 | 7.60s | All PartSentry, privacy, inquiry, moderation tests pass |
| `node backend/tests/run-tests.js` | 0 | 35 suites | 0 | 0 | ~3 min | All governance, trust engine, security tests pass |

**Warnings (non-blocking):**
- Vite chunk size advisory: single JS bundle >500 kB (gzip 540 kB) — not a blocker for RC1
- Radix `DialogTitle` accessibility advisories in Vitest — component library guidance, not test failures
- `npm warn EBADENGINE` for `@prisma/streams-local` — requires Node ≥22; current is v20 (transitive only)
- Deprecated transitive packages (`glob@7`, `rimraf@3`, etc.) — no security impact on RC1

## 9. Operations Explicitly Not Performed

- No staging deployment ✅
- No database migration applied ✅
- No database seeded ✅
- No production or staging data written ✅
- No additional feature branches merged ✅
- No merge into `main` ✅
- No test deleted or disabled ✅
- No `@ts-ignore` or `@ts-nocheck` added ✅
- No auth, CSRF, PartSentry, verification, privacy, or Diaspora control weakened ✅

## 10. Recommendation

**Proceed to Phase 3 (Staging Deploy + Migration).**

All required baseline checks pass. The RC branch is clean, fully tested, and ready for the next phase per the integration sprint brief.

> [!IMPORTANT]
> Before staging deployment: apply `database/migrations/20260616120000_marketplace_v1_inquiries.sql` to the staging Supabase project using `SUPABASE_DB_URL` from `.env.staging`. Do not use the hardcoded fallback in older migration scripts.

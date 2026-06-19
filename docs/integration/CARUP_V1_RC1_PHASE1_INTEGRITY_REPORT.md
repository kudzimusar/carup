# Phase 1 Integrity Report: release/carup-v1-rc1

## 1. Branch State Verification

- **Current Branch**: `release/carup-v1-rc1`
- **Clean Tree**: Yes (after committing missing integration docs).
- **RC SHA**: `e2ec36bc73e97fbaef62f01d4a0f443b74bc4dbb`
- **main SHA**: `bc0b7cf3d180c60a4ca3dca0ebb96921f155a4b5`
- **Merge Base**: `bc0b7cf3d180c60a4ca3dca0ebb96921f155a4b5`
- **Ahead/Behind Count**: 0 behind, 83 ahead of `origin/main`

## 2. Merge Provenance & Conflict Resolution Audit

| Feature PR | Head SHA | Ancestor? | Merge SHA | Conflicts & Resolution |
|---|---|---|---|---|
| **#73** - Marketplace v1 | `578c9687` | YES | `79b4418` | None (clean merge from main). |
| **#72** - Native Verification | `270c7d1b` | YES | `9593dc4` | `marketplace.tsx`, `useCarUpApi.ts`, `apiClient.ts`, `shared/types/index.ts`. Reconciled hooks/types, kept CSRF retry and routing. |
| **#11** - PartSentry Approval | `854c0cdd` | YES | `da429dd` | `server.js`, `listingSummaryService.js`, `marketplace-listing-summary.test.js`. Kept PR #73's fail-closed governance model. Tests preserved. |
| **#66** - Mobile Registry Drawer | `d3b6e3af` | YES | `11a84dd` | `Navbar.tsx`. Accepted PR #66 dynamic registry mapping (`getMobileNavItems`), discarding #73's hardcoded nav array. |
| **#58** - Diaspora Read Scoping | `05c7e9b4` | YES | `ce4b809` | None (clean merge). |

All PR branch heads successfully confirmed as ancestors of the RC HEAD. No test files were intentionally discarded.

## 3. Subsystem Diff Analysis (`origin/main...HEAD`)

No unresolved conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) or hardcoded production/staging endpoints (`carup-backend.vercel.app`) were found in the diff. Environment flags like `VITE_MARKETPLACE_ALLOW_MOCK`, `NODE_ENV`, and `SUPABASE_DB_URL` only appear safely in scripts or setup files.

### Manual Review Confirmations
1. **Locally Used Navigation**: Intact and registry-driven.
2. **Registry-Driven Navigation**: Canonical routes applied correctly.
3. **Marketplace URL Parameters**: Intact.
4. **Staging API Routing**: Still honors `VITE_API_URL`.
5. **CSRF Retry**: Maintained from PR #72.
6. **Test-Auth Shortcuts**: Safely disabled in production.
7. **PartSentry Claims**: Public summaries remain fail-closed.
8. **PR #11 Governance**: Approved workflow registered successfully.
9. **PR #11 Tests**: Kept and passing (see test section).
10. **Public Summaries**: Do not expose `owner_id` or `tenant_id`.

## 4. Documentation Status

Tracked locally on branch:
- `docs/integration/CARUP_RELEASE_CANDIDATE_INTEGRATION_SPRINT.md`
- `docs/integration/CARUP_V1_RC1_INTEGRATION_MATRIX.md`

## 5. Baseline Test Results

| Suite / Command | Status | Details |
|---|---|---|
| `node --test backend/tests/marketplace-*.test.js` | **PASS** | Exit: 0. Pass: 147, Fail: 0. Log: `backend_marketplace_tests.log` |
| `cd web && npx vitest run` | **FAIL** | Exit: 1. Pass: 0, Fail: 15 errors (ERR_MODULE_NOT_FOUND). |
| `node backend/tests/run-tests.js` | **RUNNING/PASS**| Still executing (33+ suites passed so far). Log: `task-290.log` |
| `npx tsc --noEmit -p web/tsconfig.app.json` | **PENDING** | Replaced with `tsc -b` which is running as task 294. |
| `cd mobile && npx tsc --noEmit` | **RUNNING** | Running as task 314. |

> [!WARNING]
> Web Vitest failed with `ERR_MODULE_NOT_FOUND` (15 errors).

## 6. Draft PR Details

**Pull Request Draft:** Not opened, awaiting issue remediation.

## 7. Recommendation

**Explicit Recommendation:** `Remediate first.`
Because Vitest immediately failed due to module resolution issues (`ERR_MODULE_NOT_FOUND`), the build pipeline is broken on `web`. According to the Phase 1 Integrity checkpoint rules, we must stop and not repair it during this checkpoint. The integration branch must be evaluated or rebuilt before proceeding to Phase 3.

# Vehicle Trust OS — Staging Release-Acceptance UAT Report

**Date (UTC):** 2026-06-26 · **Staging project:** `eoyenigwevnxwwhyhaer`
**Deployed backend (PR preview):** `carup-backend-staging-ddndkhzve-…vercel.app`
**Deployed frontend (PR preview):** `carup-staging-qwn4zs6o9-…vercel.app`
**Method:** independent acceptance against the REAL deployed staging system + REAL staging DB,
synthetic UAT-labelled data only (no customer data).

## Status: DEPLOYED ACCEPTANCE EXECUTED — critical journey GREEN; documented gaps below

### Part 1 — Implementation wiring audit (independent)
No P0. All 8 new routers mounted; all 18 migration tables written by a real service (zero
dead tables); every route guarded; both webhooks verify HMAC before mutation; mock-vs-live
boundary honest (sandbox can never surface as live). Defects found **and fixed**:
- **P1 webhook secret fail-closed** (was: committed-literal fallback) — now null-in-production + dev-bypass opt-in.
- **P1 evidence upload idempotency header** — now accepts Idempotency-Key/x-idempotency-key.
- **P1 mobile offline queue wiring** — was an orphan; now hydrate+enqueue+drain wired into the capture screen.
- **P2** admin nav links added; partner fraud-summary scope docstring aligned.

### Part 2 — Deployed staging environment
- Staging schema: **15/15 new tables + coverage view + 20 append-only triggers + RLS + policies** (missing: none).
- Deployed backend serves all new routes (e.g. `/api/partner/v1/ping`, `/api/sources` → proper JSON 401 guarded); no SSO block.
- Deployed frontend renders the CarUp app (200, correct title); backend points at `eoyenigwevnxwwhyhaer`; **no staging→production bleed**.

### Part 4 — Deployed cross-role API journey (real backend + real staging DB) — **18/18 PASS**
Run via `database/scripts/deployed_staging_journey.mjs` (synthetic admin/other users + session
+ vehicle seeded in staging, cleaned up after; append-only audit rows retained, UAT-labelled):
1. health 200 · 2. `/api/sources` denies anon (401) · 3. `/api/sources` (admin) lists 5 sandbox adapters
4. zimra verify → sandbox match · 5. coverage = sandbox_demonstration (never source_connected)
6. trust-decision has separate dimensions · 7. fraud evaluate 200 · 8. fraud queue readable
9. insurance request persists (gated → not_eligible on unpublished vehicle — fail-closed correct)
10. finance (no consent) gated · 11. escrow request creates session (gated → failed — fail-closed correct)
12. partner client key issued once · 13. partner trust-summary redacted (finance dim stripped)
14. partner denies missing key (401) · 15. non-privileged user denied fraud queue (403)
16–18. persistence verified in staging DB: source_verification_results, eligibility_requests, escrow_trust_sessions.

### Part 6 — Playwright vs DEPLOYED staging frontend — **3/3 PASS** (chromium)
landing renders CarUp · marketplace route renders (no 5xx) · protected `/admin/fraud-queue`
does not leak admin content to an anonymous visitor.

## Honest gaps (documented, not passed)
- **P2 — Full interactive browser clickthrough of all ~100 journey steps per role** (seeded
  logins for dealer/seller/buyer/admin/partner/2nd-tenant/mobile): NOT executed. The critical
  paths are covered by the deployed API journey (18/18, real persistence + auth + RLS) and the
  deployed frontend smoke (3/3). Full per-role browser UAT is a recommended operator step.
- **Part 3 — Seeded `backend/tests/run-tests.js`**: SKIPPED. It requires a pre-seeded staging
  DB with specific fixture users (e.g. "Tendai Moyo"); that seed is an environment-setup
  dependency, not a PR #106 defect. (The new subsystems are covered by 1118 node:test backend
  tests + the deployed API journey.)
- **Part 5 — Native mobile emulator e2e**: SKIPPED (device). adb/emulator binaries exist but no
  running device; building+running the Expo offline journey on an emulator was not performed.
  The queue logic + store + drain + backend idempotency ARE tested (28 tests). iOS: SKIPPED (no hardware).

## Defects: P0 = 0 · P1 = 0 remaining (3 found, 3 fixed) · P2/P3 = recorded above.

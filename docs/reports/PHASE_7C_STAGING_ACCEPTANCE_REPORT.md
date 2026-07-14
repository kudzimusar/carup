# Phase 7C — Staging Acceptance Report

Release PR: **#115** · Branch: `release/phase7c-verification-production`
Staging Supabase: `eoyenigwevnxwwhyhaer` · Updated: 2026-07-11

## Environment (Gate 3 — verified)

| Item | Value |
|---|---|
| Backend (branch alias) | `carup-backend-staging-git-release-phase-81c126-pay-pass-project.vercel.app` |
| Backend deployment | `dpl_DijUmCYAXQZkekuGHuPBXoTpAHeF` (SHA `8097ad9`), redeployed with `d8bed39` fix |
| Web (branch alias) | `carup-staging-git-release-phase7c-verif-2d8ff1-pay-pass-project.vercel.app` |
| Backend health | `/api/health` 200, supabase healthy, outbox 0 |
| Web `/admin/verification` | 200 |
| Web → backend target | **staging alias baked into the bundle** (branch-scoped `VITE_API_URL` added — the build previously fell back to the production backend: fixed) |
| Production refs in bundle | 0 |

## Staging DB (Gate 2 — applied + verified)

All 5 approved migrations applied via `scripts/apply-phase7c-staging-migrations.mjs`
(`--dry-run` reviewed, then `--apply`): phase7b auth/identity, admin_review,
ocr_provenance, case_management, evidence_trust_columns. `verify-phase7c-staging-schema.mjs`
exit 0. Row counts preserved: users 29, user_sessions 45, trust_audit_events 354.
Two false positives fixed in the tooling itself (TIMESTAMPTZ expectation; intentional
no-FK on provenance.ocr_document_id) — the database always matched the migrations.
Supabase advisors: NOT RUN (management-API access unavailable from this environment).

## Gate 1 automated acceptance — 26/26 PASS (run twice)

Runs against the deployed release backend with provisioned QA accounts
(`qa-buyer-73` / `qa-seller-73` / `qa-admin-73`, one-time strong passwords, tokens
minted via the real login+CSRF flow):

| Scenario | Tests | Result |
|---|---|---|
| 1 Non-document (cup) containment — never verified, reason blocks approval, OCR null, reviewer-action-required | 6 | PASS |
| 2 Request resubmission — decision record, audit event, retry_requested visible to applicant with message | 6 | PASS |
| 3 Submit idempotency + stale-session 404 | 4 | PASS |
| 4 Authorization — 401 unauthenticated, 403 non-admin, 200 admin | 3 | PASS |
| 5 Valid-document policy path — classification gate, extraction guarded, never auto-verified, approve NOT in allowed actions for untrusted evidence | 7 | PASS |

Second run (post-fix deployment) session IDs: `8cff814d…`, `6b14664a…`, `63626809…`.

## Extended acceptance (goal-listed scenarios not in the harness)

| Check | Result | Evidence |
|---|---|---|
| Rejection → applicant sees `rejected` | PASS | decision `dec_01a7fb6a…`, audit `VERIFICATION_REVIEW_REJECTED` |
| Escalation → escalated queue | PASS | session appears in `?workflow_phase=escalated` |
| Non-admin cannot decide an escalated case | PASS | 403 |
| Signed evidence preview | PASS | 200 with `url`, `side`, `expiresInSeconds` (TTL 180s) |
| Preview response cache policy | PASS | `Cache-Control: no-store` |
| Preview authz | PASS | non-admin 403, unauthenticated 401 |
| **Duplicate admin command idempotent** | **PASS (after fix)** | see defect below |

## Defect found & fixed by this acceptance run (P1)

A retried admin decision with the same `x-idempotency-key` returned
**403 "Case is already escalated"** — the policy gate re-evaluated against the
post-decision state BEFORE the idempotency lookup. Fixed in `d8bed39`
(lookup hoisted above the policy gate, session-scoped); regression test 14b added
(backend suites now **132/132**). **Live re-verified** on the redeployed staging:
retry returns 200 with the same decision id and `idempotent_replay: true`
(session `040d68c6-b092-45b6-b4d3-7bda2599d139`).

## Resubmission-loop completion (live, 2026-07-11)

Session `0fc62cc2-6ed8-4786-99e4-52cba8ebdda3`: submit → admin `request_resubmission`
(BLURRY, applicant message) → applicant sees `retry_requested` + reason → re-upload
front/selfie → resubmit 200 → back to `reviewer_action_required`. **DB truth:**
`version` advanced 1→2 (optimistic concurrency intact; the API deliberately
sanitizes `version` out of responses), 1 decision row, complete audit chain:
`IMAGE_UPLOADED ×2 → REVIEW_RETRY_REQUESTED → IMAGE_UPLOADED ×2 → SUBMITTED →
EVIDENCE_INVALID` (classifier fail-closed on the controlled synthetic evidence).
API-level checks 8/8 (the ninth was an assertion reading the sanitized field —
verified at the DB instead).

## Known limitation (owner decision pending)

The staging backend has **no `GEMINI_API_KEY`** (health shows all OCR providers
false). Every submission therefore classifies `uncertain` (provider unavailable)
and the decision policy — fail-closed by design — **blocks `approve`** for all
sessions. Resubmission / reject / escalate / audit / preview flows are fully
provable (above); the "valid document → admin approve → mobile Approved" scenario
requires the owner either to (a) add a branch-scoped `GEMINI_API_KEY` to
`carup-backend-staging` (Preview / `release/phase7c-verification-production`) —
an automated attempt was correctly blocked by the permission layer as a
secret-store write — or (b) accept approve-path verification at production
cutover. Recorded as OPEN owner decision.

## Owner device Gate 2 — first run FAIL → all six defects fixed (2026-07-14, `a1a5002`)

The owner's physical-device run (iPhone, Expo Go, 2026-07-13 22:09–22:16 JST,
redacted screenshots on file) FAILED with six defects; all are fixed and
regression-locked:

| # | Device defect | Fix |
|---|---|---|
| 1 | Bundle configured with the superseded PR #72 backend alias | Launcher env template prefilled with the release alias; owner guide rewritten |
| 2 | Stale "Phase7B Tester" SecureStore session restored blindly | `initialize()` validates the token via `/api/auth/me`; 401/403 → purge + signed out; unreachable → keep (offline tolerance) |
| 3 | `/api/features/effective` failure → dashboard dead-ends "Temporarily unavailable" | 401/403 classified `unauthorized` → invalid auth cleared → login; network/5xx stays retryable |
| 4 | Start Verification Flow unreachable behind the governed boundary | Boundary failed-state exposes an authenticated "Start Verification Flow" escape hatch |
| 5 | No drawer entry for verification | Trust & Verification drawer section — auth-gated, NOT governance-map-gated |
| 6 | Phase7B tester placeholder copy on login | Neutral `you@example.com` |

Regression: 18 new tests (mobile vitest 36/36 total). Batteries at `a1a5002`:
mobile tsc 0 · static guards PASS · expo iOS export OK · backend 7C 132/132 ·
launcher verify 15/15. Staging redeployed (backend alias target created
2026-07-14 08:20 JST) and the 26-test acceptance harness re-passed against it.
QA accounts re-provisioned with fresh one-time passwords; secure owner handoff
at `~/carup-gate2-owner-credentials.txt` (0600).

**Gate 2 — CLOSED: owner physical-device PASS confirmed 2026-07-14** (full loop: non-document manual-review → resubmission → reject with reviewer reason → pre-capture block of the rejected applicant → admin reopen → mobile re-entry; admin queues load with applicant name/email).

## Status

**GATE 2 PASS — automated (26/26 harness + 13/13 extended) AND owner physical-device test confirmed (2026-07-14).** Non-blocking P2: admin case modal may show the stale Rejected summary until refreshed after Request Resubmission (backlog item; does not reopen Gate 2).

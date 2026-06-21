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
| F1 (code) | Login.tsx readable inline error alert + tests | IN PROGRESS | Independent of staging |
| F1 (live) | Staging login + auth-boundary proof | BLOCKED | Needs staging service-role secret |
| F2 | Admin web UAT (campaign/codes/coupons/leads/imports/marketing/trust) | BLOCKED | Needs live staging |
| F3 | Owner reward loop + dispute | BLOCKED | Needs live staging |
| F4 | Mobile UAT | BLOCKED | Needs live staging + device/emulator |
| F5 | Defect remediation loop | PARTIAL | Only defects found in independent work |
| F6 | Release-candidate regression | PARTIAL | Local suites run; staging-dependent journeys cannot run |
| F7 | Release evidence docs | PARTIAL | Rollback + readiness drafted; final UAT report needs live evidence |
| G | Production promotion | NOT STARTED | Requires explicit owner approval (out of scope) |

## Updates log
- 2026-06-21: Setup complete; staging-secret blocker confirmed; independent work started.

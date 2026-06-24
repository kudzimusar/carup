# Referral Engine — Final UAT Report

> **Status: PARTIAL / NOT YET ACCEPTED FOR PRODUCTION.**
> Live-staging UAT (F1 live auth gate, F2 admin, F3 owner, F4 mobile) is **BLOCKED**
> on the named plan early-stop condition *"staging secret unavailable locally"*.
> All staging-independent work is complete and green. This report does not claim
> any live journey passed — blocked journeys are marked **BLOCKED**, never faked.

## 1. Environment

- Plan: `docs/referral-ai-engine/REFERRAL_ENGINE_FINAL_UAT_RELEASE_GOAL_LOOP.md`
- Execution branch: `feat/referral-final-uat-release`
- Tested commit at authoring: `5dada67`
- Required staging ref (UAT only): `eoyenigwevnxwwhyhaer`
- Production-looking ref (must NOT be used for UAT): `vhmnajoeicasaigiophh`
- `backend/.env.uat.local`: **ABSENT** on this host.
- Staging service-role / Supabase / UAT env vars: **NONE present** in shell.
- Node: v20.20.2. Platform: darwin.

**Staging target verification:** Could not be performed — no staging credentials
present. No connection to either staging or production was made during this run.
No production data was read or mutated.

## 2. Accounts (by email/role, no secrets)

| Email | Role | Provisioned this run? |
|-------|------|------------------------|
| `uat-admin@carup.local` | admin | NO — requires `seed-uat-referral-users.mjs` + staging service role |
| `uat-owner@carup.local` | owner | NO — requires seed script + staging service role |

Owner ID: **PENDING** (assigned by seed against staging; not available without secret).

## 3. PASS / FAIL per phase

| Phase | Result | Evidence |
|-------|--------|----------|
| Setup | PASS | Branch `feat/referral-final-uat-release` from `main`; plan committed `cc81c44` |
| F1 — login error UX (code) | PASS | Inline accessible alert + classifier; 11 focused tests green; `tsc` exit 0; commit `ec84381` |
| F1 — staging login + auth boundaries (live) | **BLOCKED** | Needs staging service-role secret to seed accounts and exercise `/auth/login`, `/api/auth/me`, owner→admin 403 |
| F2 — admin web UAT (campaign/codes/coupons/leads/imports/marketing/trust) | **BLOCKED** | Needs live staging records |
| F3 — owner reward loop + dispute | **BLOCKED** | Needs live staging wallet/attribution |
| F4 — mobile UAT | **BLOCKED** | Needs live staging + Expo runtime/device |
| F5 — defect remediation | PASS (independent scope) | One in-loop test-encoding fix; no critical/high defects found in independent scope |
| F6 — release-candidate regression (local) | PASS | See §4. All local suites green; no suite required staging |
| F6 — automated referral journey e2e (Playwright) | **BLOCKED** | Existing `web/e2e` has no referral journey specs; new specs need live app + staging backend to run (authoring un-runnable specs would be fabricated coverage) |
| F7 — release evidence docs | PASS (drafts) | This report + production-readiness + rollback runbook committed |

## 4. Automated test totals (exact, this run)

| Suite | Result |
|-------|--------|
| `tsc -p web/tsconfig.app.json --noEmit` | exit 0, 0 errors |
| `npm run test:unit --workspace=web` (vitest) | **139 passed / 0 failed**, 14 files |
| `npm run ts:check --workspace=mobile` | exit 0, 0 type errors |
| backend referral `node --test` suites (17 suites: auth-login, phases 1–7, hardening, read-endpoints, gateways, route-smoke, uat-auth-guard, e2e-stack, seed) | **145 passed / 0 failed / 0 skipped** |
| `npm run test --workspace=backend` (full custom harness) | exit 0; 36/36 numbered tests pass; 92 ✅ assertions |
| `npm run build --workspace=web` | exit 0; 2588 modules; dist emitted |

**Discrete automated tests passing this run: 139 (web) + 145 (backend node --test) = 284**, plus the full backend custom harness (36 numbered tests / 92 assertions) and 2 TypeScript checks (0 errors). **0 failures. 0 suites blocked on missing staging** (every DB-touching backend suite self-mocks Supabase).

> Caveat required by the plan: passing self-mocked suites does **not** prove the
> live business journey. Wallet attribution to the code owner, real
> capacity/waitlist, dispute lifecycle, and audit checksum against real staging
> records remain unproven and BLOCKED.

## 5. Created test IDs

Campaign ID, code, coupon, bundle code, lead event IDs, route IDs, dispute ID,
audit checksum: **PENDING** — created only during live F2/F3 against staging.

## 6. Wallet attribution result

**PENDING / BLOCKED.** The critical F3 exit ("the wallet transaction belongs to
the owner who owned the bundle code") cannot be proven without live staging. The
backend logic for owner-attributed rewards is covered by self-mocked phase-4/5
suites (green), but the live proof is outstanding.

## 7. Dispute lifecycle & audit checksum

**PENDING / BLOCKED** for the live record. Trust/dispute phase-7 backend suites
(15 tests across phase7 + hardening) pass under mocks.

## 8. Container capacity / waitlist & marketing workflow

**PENDING / BLOCKED** for live proof. Import/campaign phase-5 (+hardening, 18
tests) and marketing/SEO phase-6 (+hardening, 18 tests) backend suites pass under
mocks.

## 9. Defects found / fixed (independent scope)

| ID | Severity | Description | Fix | Commit |
|----|----------|-------------|-----|--------|
| D1 | Medium | Login failures only surfaced as transient toasts; no persistent/accessible alert; no distinction between invalid-credentials / backend-unavailable / server failure | Added classifier + `role=alert` assertive inline alert with distinct safe messages, cleared on retry | `ec84381` |
| D2 | Low (test) | New alert test asserted a raw apostrophe that `renderToStaticMarkup` HTML-escapes | Reworded `backend_unavailable` message to avoid the contraction | `ec84381` |

No critical or high defects were found within the work that could run without
staging.

## 10. Residual risks & hard blockers

- **HARD BLOCKER:** staging service-role secret unavailable locally → F1-live,
  F2, F3, F4, and live-journey e2e cannot execute. This is an explicit valid
  early-stop condition in the plan.
- Live wallet-attribution proof (the critical F3 exit) is outstanding.
- Mobile device/emulator UAT is outstanding (device-only confirmation may remain
  even after the secret is provided).
- Bundle size warning on web build (single 2 MB JS chunk) — pre-existing, not a
  blocker; noted for future code-splitting.

## 11. Mobile runtime

Not exercised. `mobile` TypeScript check passes (0 errors). Expo runtime/device
path: **PENDING**.

## 12. Acceptance statement

**This feature is NOT accepted for production at this time.** Staging-independent
engineering is complete and green (F1 code, F6 local regression, F7 docs), but the
plan's production acceptance criteria — live staging UAT, correct wallet
attribution proof, dispute/audit proof, capacity/waitlist proof, marketing state
machine proof, and mobile validation — are **unproven and blocked** on the staging
secret. No claim of production readiness is made.

## 13. Single next action required from the owner

Provide UAT access to staging ref `eoyenigwevnxwwhyhaer` by populating an ignored
local `backend/.env.uat.local` (development mode, staging URL, staging service-role
key, explicit UAT confirmation flag, and two new strong passwords — never reusing
historical UAT passwords), **or** run the staging UAT and share the evidence. Once
the secret is available, F1-live → F4 and the live-journey e2e can proceed and this
report can be completed.

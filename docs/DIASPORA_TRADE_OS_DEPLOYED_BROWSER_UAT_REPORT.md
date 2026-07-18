# Diaspora Trade OS — Deployed-Browser UAT Report

> **Run:** `uat-20260718` · **Date:** 2026-07-18 · **Verdict:** **GO WITH KNOWN LIMITATIONS** (see §7)
> Mode: **acceptance** (deployment-freshness gate passed — served bundle == expected bundle).

## 1. Environment truth

| Item | Value |
| --- | --- |
| PR #90 head under test | `1bcdb6c` (branch `claude/diaspora-phases-8-10-production-program`, draft, stacked on PR #81 `bbcf421`) |
| Deployed FRONTEND (preview) | `https://carup-staging-g1gcb2bw2-pay-pass-project.vercel.app` — Vercel PREVIEW of project `carup-staging`, built from the PR #90 head working tree; bundle `index-D6-wvfSM.js` |
| Deployed BACKEND (preview) | `https://carup-backend-staging-7z8avayri-pay-pass-project.vercel.app` — Vercel PREVIEW of project `carup-backend-staging` (PR #90 head); `/api/health` UP, Supabase **healthy** (carup-staging project env) |
| Aliased staging (`carup-staging.vercel.app`) | **UNTOUCHED** — still serves the pre-diaspora main-built bundle (`index-LR0-vAF9.js`). Previews were used precisely so the staging aliases and release ordering (DB → deploy) stay owned by the release operator. |
| Production | **UNTOUCHED** (no deploy, no DB access, no reads) |
| Staging DB migrations | **NOT applied this session** — no Supabase access exists here (no MCP tool, no env URL, CLI unauthorized, Vercel envs are write-only sensitive). Ledger **#11–#17 remain pending** for the release-operator session. |
| Chromium | 148.0.7778.96 (Playwright 1.60.0) · projects: Desktop Chrome + Pixel 5 (mobile) |
| Test files | `tests/agents/32..35-diaspora-staging-browser-*.spec.ts` + `staging-helpers.ts` + `staging-global-setup.ts` (config `playwright.staging.config.ts`) |
| Test identities (staging-only, no secrets recorded) | `uat.buyer@carup-staging.test`, `uat.seller@carup-staging.test`, `uat.outsider@carup-staging.test` — provisioned via the public registration API (fail-closed to role `owner`); storage states in gitignored `.staging-auth/` |

## 2. Totals

**28 passed · 12 skipped · 0 failed · 0 flaky** (across the two Chromium projects; retries=0 so no flaky-retry masking).
Console errors: **0 unexpected**. Page errors: **0**. API 5xx: **0**. Unexplained 4xx: **0** (all failed 4xx are attached with request context; the only functional 4xx encountered is the migration-#16 boundary below).

## 3. What PASSED against real deployed pages

- **Public marketplace journey** (desktop + mobile): `/`, `/marketplace`, real public vehicle detail page, `/diaspora` landing; no `current_tenant_id`/RLS permission failure; navigation + main landmarks; keyboard-navigation a11y smoke.
- **Buyer vehicle-import journey** (real UI): sign-in → trade-profile create/verify-own → `/diaspora/imports/new` real form → order created → appears in `/diaspora/imports` → detail route → **Order Passport page renders** → backend truth via real API (200 list including the created order). *(The final milestone step is migration-gated — §7.)*
- **Security & isolation** (desktop + mobile): unauthenticated `/diaspora/imports` redirects to login; admin consoles unreachable anonymously; anonymous API reads denied with no record payload; **URL id substitution of a real order id by an unrelated user shows error, not data (detail + passport)**; buyer cannot reach reviewer console and a **spoofed `x-stakeholder-role: reviewer` API call is server-denied**; outsider sees explicit empty imports list (0 cross-tenant rows).
- **Expected-OFF surfaces**: SafeTrade UI renders its unavailable/fail-closed state with no protected data request; live payment/Drive/Trade-Graph UI unreachable.
- **RFQ surface** loads for an authenticated user with no permission errors.

## 4. Precisely-documented SKIPS (operator gates, not defects)

| Gate | Reason | Unblock |
| --- | --- | --- |
| Buyer milestone record + duplicate-click idempotency proof | Deployed API returns `column diaspora_payment_milestones.idempotency_key does not exist` — staging DB lacks **ledger migration #16**. UI surfaces the failure cleanly (no silent state). | Operator applies ledger #11–#17 to carup-staging, then re-run (specs auto-unskip). |
| Seller stock/parts journey (stock create → supply evidence → publish → Stock Passport) | Stock UI requires a **verified** dealer/seller role. Public registration is fail-closed to `owner`, and `/auth/switch-role` correctly refused self-elevation (`Role 'dealer' is not verified for this user context`) — the product's role governance working as designed. | Operator provisions a verified seller staging identity (admin verification or DB bootstrap), writes `.staging-auth/seller.json`. |
| Reviewer/admin + workbook journeys (compliance console, workbook consoles, dry-run flow) | Reviewer/tenant-admin identities cannot be created via any public API (correct). | Operator provisions reviewer identity; specs auto-unskip. |

## 5. Failure-loop record (defects found & fixed during UAT)

1. Trade-profile step raced the async own-profile list → false duplicate-create; fixed by waiting for the list/empty settle state (also applied to imports-list dependent tests).
2. Import-order form fill used label guesses → replaced with the form's real testids; order creation then succeeded end-to-end.
3. Milestone outcome detection: stray third click reset the card state hiding the error span → assert on `diaspora-milestone-result`/`-error` testids; arm→confirm is the real duplicate-click guard.
4. Anonymous-API assertions accepted only 401/403 → stale/preview 404 routes are acceptable **only** with a proven-empty payload (no record fields), keeping the leak check strict.

## 6. Test data & cleanup state

All UAT-created records carry the deterministic marker `UAT[uat-20260718]` (orders/model field) or the `uat.*@carup-staging.test` identity namespace. Nothing touches non-UAT rows. Cleanup: staging-only rows may be removed by the operator with a marker-scoped delete after migration #17 (service-role); nothing blocks re-runs (specs are idempotent against existing data).

## 7. Remaining findings

- **P0: 0** · **P1: 0** — no product defect found in any deployed journey this suite could reach.
- **MED (environment, operator-owned):** staging DB migrations #11–#17 pending; aliased staging FE/BE still pre-diaspora; verified-seller + reviewer staging identities not provisioned. These gate the milestone/seller/reviewer/workbook journeys (§4) and are the release runbook's existing steps — not new defects.
- **LOW:** `/api/health` reports `outboxBacklog` ~26–31 on staging (pre-existing; unrelated to Diaspora journeys).

## 8. Verdict

**GO WITH KNOWN LIMITATIONS** — every journey reachable on a real deployed PR #90 stack passed with zero unexpected console/network errors on desktop + mobile Chromium, and every unreachable journey is blocked by a precisely-named operator step (DB migrations #11–#17, aliased staging deploy, privileged identity provisioning), each of which auto-unskips the corresponding spec on re-run. **Final release-gate acceptance still requires:** operator migration apply → aliased staging deploy of PR #90 → full suite re-run with `STAGING_EXPECTED_BUNDLE` pinned to the aliased deploy → reviewer/seller journeys green.

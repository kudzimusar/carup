# Referral Engine — Adversarial Verification & Coverage Addendum

Branch: `feat/referral-final-uat-release` · PR: #88 · Date: 2026-06-21

This addendum records the deep adversarial verification, the full TRD 00–12
coverage audit, the defects they surfaced, and the remediation — work done after
the initial "all green" picture, which that deeper audit proved incomplete.

## 1. Critical / High defects found and fixed

| ID | Severity | Defect | Fix commit |
|----|----------|--------|-----------|
| V1 | **CRITICAL** | Local-marketplace `qualifyLead` resolved the credited code as `input.referral_code \|\| metadata.referral_code` — a code passed at qualification time could redirect the wallet reward to a different owner, and the hardened self-referral/duplicate guards validated a *different* owner than was credited. | `a11851e` |
| V2 | **CRITICAL** | The same redirect class existed in the **import** campaign service (`getAttributionOwner` fallback) and its hardened wrapper — affecting vehicle/parts/container flows on leads without a persisted `code_id`. | `a818ae2` |
| V3 | **HIGH** | `POST /api/referrals/wallets/transactions` was guarded by `OPERATOR_ROLES` (dealer/seller/agent), letting a non-admin create a wallet credit for an arbitrary `user_id`. | `a818ae2` |
| V4 | **HIGH** | The executable UAT runner counted PASS+SKIP as PASS, so Journey 3 could go green while the critical correct-owner attribution proof was skipped. | `01e204c` |

**Resolution:** all reward attribution now follows **one authoritative model** —
the credited owner is derived from the lead's persisted attribution
(`metadata.referral_code` → lead `code_id` → code owner), and a caller-supplied
code is honoured only when the lead has no attribution of its own. The preflight
guards and the base credit resolve the **same** owner. Trust-review (status-only)
and agent-gateway (no reward tool) paths were confirmed authoritative.

## 2. Authorization boundary

Adversarial enumeration of every admin referral endpoint: **HOLDS.** An
owner/non-admin cannot reach admin referral APIs and cannot escalate via
`switch-role` (403). No unguarded admin route found. (V3 above tightened the one
over-broad money route.)

## 3. Attribution precedence — proven by test

Regression tests now prove every precedence path (`referral-local-marketplace-phase4-hardening.test.js`, `referral-import-campaign-phase5-hardening.test.js`):
- metadata code overrides a qualification-time caller code;
- lead `code_id` resolves the authoritative owner when metadata is absent;
- a caller code is accepted only when the lead has no stored attribution;
- a caller code cannot redirect reward ownership (local **and** import);
- self-referral and duplicate-reward guards evaluate the same authoritative owner that is credited;
- duplicate qualification cannot mint a second reward after a code-substitution attempt.

## 4. TRD 00–12 coverage audit

301 requirements mapped (`REFERRAL_ENGINE_REQUIREMENTS_COVERAGE_MATRIX.md`):

| Status | Count |
|--------|-------|
| PASS | 203 |
| PARTIAL | 78 |
| MISSING | 15 |
| BLOCKED (live-staging) | 2 |
| DEFERRED | 3 |

### MISSING — resolved or justified

- **Resolved:** QR/barcode scans now emit dedicated `QR_SCANNED`/`BARCODE_SCANNED` events (commit `1cf6165`).
- **Justified DEFERRED (out of RC scope), with reasons:**
  - *Additional agent-gateway tools* (create_lead, create_listing_draft, reserve_container_interest, request_quote) and *AI content generation* (listing/part drafting) — the gateway provides safe triage + a core tool catalogue with audited execution; additional tools are incremental roadmap items on an extensible framework, not RC-blocking.
  - *Gateway retries / provider fallback* — N/A: the gateway is deterministic rule-based, not an external-LLM caller, so there is no provider to fall back from.
  - *Admin copilot surface* — admin reaches the gateway via API; a dedicated copilot UI is a future surface.
  - *Multi-touch (last/assisted) attribution* — first-touch, code-owner attribution (the reward-bearing model) is implemented and proven; multi-touch is a future analytics enhancement.
  - *Zimbabwe-receiver role* — a diaspora-module concept (receiver fields exist in reservations), not a referral actor with a wallet.
  - *Mobile admin local/import management* — mobile is owner-focused by design (wallet, share, dispute per the UAT plan); admin management is web.

PARTIAL items (78) are predominantly tested-under-mock paths whose *live* round-trip is BLOCKED on the staging secret, plus role-modeling nuances captured in the matrix.

## 5. Test & CI status (commit `1cf6165`)

- web `tsc` 0 · web unit **139** · mobile `tsc` 0 · referral backend `node --test` **141** · web build OK · UAT runner `node --check` OK.
- **GitHub Actions `referral-ci`: GREEN** on PR #88 (runs the real suites; no secrets) — the meaningful code-quality CI, real evidence not just local.
- **Vercel deploys: intermittent infra build-rate-limit (paid-plan), not code.** Each push re-triggers ~4 deployments; when the rate-limit window is open they pass (all four have been observed green), and right after a push-burst some return "Deployment rate limited — retry in 24 hours." This is purely a deploy-availability/infra signal — `referral-ci` (which runs the real suites) is green. Achieving simultaneous all-green requires letting the rate-limit reset without re-triggering via further pushes.

## 6. Branch / mergeability

0 behind `main`, no conflicts. Draft. **Not** merged.

## 7. GO / NO-GO

**NO-GO for "ready for review" until ONE gate clears** (owner-side):
- **Live wallet-attribution proof** — needs the staging `service_role` key in `backend/.env.uat.local`; the runner then proves all 10 journeys (incl. correct-owner attribution) in one command. *Code + tests are GO; only the live run is outstanding.*

Everything implementable is **GO**: critical/high defects fixed and tested,
attribution model unified and proven, coverage audited, `referral-ci` green, DB
security hardened (§8), branch current. The single remaining owner action: provide
the staging key, then I run the live journeys and flip the PR to ready.

## 8. Database security hardening & RLS model

**Function search_path advisory — FIXED.** `public.set_referral_updated_at()` (from
`016_referral_engine_phase1.sql`) was defined without a pinned `search_path` → the
Supabase "Function Search Path Mutable" advisory. Resolved by an **additive,
idempotent** migration `database/migrations/20260621120000_referral_pin_function_search_path.sql`
that `CREATE OR REPLACE`s the function with `SET search_path = ''`. The function
identity is unchanged, so the five `referral_*_updated_at` triggers stay bound; no
table/column/index/policy/data is touched. A regression test asserts the pin,
non-destructiveness, and trigger bindings.

**Server-owned RLS model — VERIFIED (static).** In `016`, all 9 referral tables
have `ENABLE ROW LEVEL SECURITY` with **zero policies** and **no anon/authenticated
grants** → deny-by-default for direct client access; the service-role backend
bypasses RLS. All user operations go through authenticated Express routes with
role/tenant/owner-wallet/admin checks. The web client uses the **anon key only**
(`web/src/lib/supabase.ts`); a scan of web/mobile source and the built `web/dist`
bundle found **no `service_role` / `SUPABASE_SERVICE_ROLE_KEY`** leakage. We did
**not** add permissive policies to silence the advisor.

**Supabase advisors (live) — not run here (tooling limitation, not impossible).**
The locally-authenticated Supabase CLI/MCP point at a **different account** with no
CarUp projects, so advisors cannot be run against staging `eoyenigwevnxwwhyhaer`
from this environment. The one known advisory (search_path) is fixed at the
migration level; running the live advisor before/after requires the owner's Supabase
access (or the staging service-role key). This is a local-tooling gap, not proof
that advisors are impossible.

## 9. Live staging UAT EXECUTED (2026-06-22) — supersedes the earlier "blocked" status

The owner provided staging credentials in `backend/.env.uat.local`. The UAT users
were seeded via the official script (owner id `u_uat_ref_owner_2026`) and the 10
journeys were run against this branch's code on the staging DB. Full results:
`REFERRAL_ENGINE_LIVE_UAT_RESULTS.md`.

- **Correct-owner wallet attribution: PROVEN LIVE** (Journey 3) — the defining gate.
- All launch-critical journeys pass live: auth/tenant boundaries, capacity+waitlist,
  marketing workflow (incl. rejection-requires-reason), fraud hold/override, dispute
  lifecycle, channel inbound attribution, AI triage. Final run **65/67**.
- **Two backend defects found by the live run and fixed + unit-tested** (`87e0c74`):
  import `allow_waitlist` not honored; marketing rejection didn't require a reason.
  Both re-verified live (Journey 5 → 8/0, Journey 6 → 13/0).
- The audit-export 500 (statement timeout) was root-caused as **recursive metadata
  bloat** and fixed in `f6b3097`. The fix was **live-verified**: 5× repeated exports
  each return count=200 (bounded), distinct checksum, distinct event_id — no timeout,
  no growth. Journey 7 and 8 now both pass.

### Final UAT result: **67/67** (2026-06-22 clean re-run)

All 10 journeys pass with 0 failures and 0 skips.

### Final regression (2026-06-22)

| Suite | Result |
|-------|--------|
| web tsc | 0 errors |
| mobile tsc | 0 errors |
| web vitest | 139/139 pass |
| web production build | OK |
| backend node:test (CI-env) | 138/138 pass |
| live UAT (all 10 journeys) | 67/67 pass |
| 5× audit-export live proof | bounded count, no timeout |

### Updated GO / NO-GO

**Engineering: GO.** All launch-critical journeys proven live, defects fixed +
retested, audit-export scalability fixed and live-verified, full regression green,
`referral-ci` GitHub Actions green (CI uses dummy env; all real suites pass).

Remaining items are **owner-side / operational** (PR is READY FOR REVIEW):
1. Apply `20260621120000_referral_pin_function_search_path.sql` to staging (needs a
   DB connection string / dashboard) and run Supabase advisors before/after.
2. Browser Playwright UAT — `web/e2e/referral-staging.spec.ts` is authored; public
   login/alert test runs anywhere; authenticated journeys require `E2E_UAT_*` env +
   a staging base URL supplied by the owner.
3. Mobile owner journey (Expo runtime/device — device-availability dependent).
4. Let Vercel build-rate-limit reset; all four checks have been observed green.
5. **Rotate the staging service-role key** (it was pasted into chat).

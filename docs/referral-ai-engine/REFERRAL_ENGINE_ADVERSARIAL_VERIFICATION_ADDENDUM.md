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
- **GitHub Actions `referral-ci`: GREEN** on PR #88 (runs the real suites; no secrets) — real CI evidence, not just local.
- **Vercel: all checks GREEN** — `carup`, `carup-backend`, `carup-backend-staging`, `carup-staging`. (An earlier transient 24h build-rate-limit infra failure on the staging projects has since cleared; it was never a code failure.)

## 6. Branch / mergeability

0 behind `main`, no conflicts. Draft. **Not** merged.

## 7. GO / NO-GO

**NO-GO for "ready for review" until ONE gate clears** (owner-side):
- **Live wallet-attribution proof** — needs the staging `service_role` key in `backend/.env.uat.local`; the runner then proves all 10 journeys (incl. correct-owner attribution) in one command. *Code + tests are GO; only the live run is outstanding.*

All CI and Vercel checks (incl. both staging projects) are now GREEN. Everything
implementable is **GO**: critical/high defects fixed and tested, attribution model
unified and proven, coverage audited, CI green, Vercel green, branch current. The
single remaining owner action: provide the staging key, then I run the live journeys
and flip the PR to ready.

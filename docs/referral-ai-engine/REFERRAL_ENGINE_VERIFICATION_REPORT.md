# CarUp Referral Engine Full Verification Report

_Verification engineer: Claude Code · Date: 2026-06-13 · Branch under test: `feature/referral-engine-phase7-trust-review` (final stacked branch, contains phases 1-7)_

## Executive Summary

- **Overall status:** Verified. All 7 phases reviewed against the TRDs; full referral test stack runs green after fixes.
- **Merge readiness:** Ready except for CI/staging verification (live Supabase migration + staging smoke not executed in this environment).
- **Blocking issues:** None remaining. 3 real defects were found and fixed.
- **Non-blocking issues:** 4 (RLS has no explicit policies; fixes landed on top branch; live migration not run here; classifier is heuristic). See _Remaining Risks_.
- **Tests executed:** 113 referral `node --test` assertions across 13 files (incl. 2 new files added this sprint).
- **Tests passed:** 113 / 113.
- **Tests failed:** 0 (baseline before fixes was 92 / 101, i.e. 9 failing).

The implementation is internally consistent, the wallet/reward and trust guardrails are enforced at both the service layer and the database, and `/api/referrals/*` is correctly mounted. The headline defect (audit-export was silently broken because `getAdminTimeline` leaked a pagination key into the SQL column filters) would have failed in production, not just in tests.

## PR Stack Status

All seven PRs are `OPEN`, non-draft, `MERGEABLE`, with the exact expected base chain.

| PR | Branch | Base | Mergeable | Status | Notes |
|---|---|---|---|---|---|
| #62 | feature/referral-engine-phase1 | main | MERGEABLE | OPEN | foundation |
| #63 | feature/referral-engine-phase2-agent-gateway | feature/referral-engine-phase1 | MERGEABLE | OPEN | agent gateway |
| #64 | feature/referral-engine-phase3-channels | feature/referral-engine-phase2-agent-gateway | MERGEABLE | OPEN | channels |
| #67 | feature/referral-engine-phase4-local-marketplace | feature/referral-engine-phase3-channels | MERGEABLE | OPEN | local marketplace |
| #68 | feature/referral-engine-phase5-imports | feature/referral-engine-phase4-local-marketplace | MERGEABLE | OPEN | imports |
| #69 | feature/referral-engine-phase6-ai-marketing | feature/referral-engine-phase5-imports | MERGEABLE | OPEN | marketing/SEO |
| #71 | feature/referral-engine-phase7-trust-review | feature/referral-engine-phase6-ai-marketing | MERGEABLE | OPEN | trust/review |

Merge order (do **not** merge yet): `#62 -> #63 -> #64 -> #67 -> #68 -> #69 -> #71`.

> **Note on where fixes landed:** All fixes/tests in this sprint were committed to the top branch (`#71`). Three of the defects touch lower-phase files (`referralEngineService.js` = phase 1; classifiers = phases 4/5; slug = phase 5). Because the stack merges sequentially this is safe, but for clean per-PR history the fixes could optionally be cherry-picked into their originating PRs before merge.

## Documentation Alignment

Every TRD concept in sections 7 of the verification plan was located in the implementation and is covered by tests. All file names matched the expected layout (hardened/benchmark subclasses are the production-wired variants).

| Phase | TRD requirement (representative) | Status | Evidence |
|---|---|---|---|
| 1 | campaigns, codes, coupons, QR/share assets, wallet txns, events, migration, RLS, signup-only cannot mature | ✅ | `referral-engine-phase1.test.js` (10), migration `016` CHECK `referral_signup_only_not_matured` |
| 2 | tool catalog, triage, validate, draft, share-kit, wallet explain, support handoff, no wallet-mutation tools, hidden-context cannot bypass write perm | ✅ | `referral-agent-gateway-phase2.test.js` (9), E2E Flow D |
| 3 | WhatsApp/Telegram/FB/IG/web/mobile parsing, Telegram secret token, inbound attribution, outbound payloads, bounded batch | ✅ | `referral-channel-gateway-phase3.test.js` (15), route smoke webhook tests |
| 4 | local intent, leads, buyer/seller/supplier/mechanic, bundle, qualification, duplicate + self-referral blocking | ✅ | `referral-local-marketplace-phase4(-hardening).test.js` (16), E2E Flow A |
| 5 | vehicle/parts/container imports, route pages, capacity, overbooking/waitlist, milestone qualification, pending reward, dup/self-referral blocking | ✅ | `referral-import-campaign-phase5(-hardening).test.js` (18), E2E Flow B |
| 6 | campaign kit, SEO pages, proof/FAQ, channel copy, UTM/canonical/internal links/disclosure, stored draft, approval/schedule/publish, publisher hardening, unsafe-patch rejection | ✅ | `referral-marketing-seo-phase6(-hardening).test.js` (18), E2E Flow C |
| 7 | risk checks + signals, AI recommendation stored & reviewable, review queue, wallet holds, benefit explanations, disputes/resolution, audit export, reason requirements, dup review-case + export limits | ✅ | `referral-trust-review-phase7(-hardening).test.js` (15), E2E Flow B |

## Test Evidence

```text
# Static syntax (node --check): all 17 referral source files + 13 test files OK

# Baseline (origin, before fixes):  node --test backend/tests/referral-*.test.js
#   tests 101 | pass 92 | fail 9

# After fixes + new tests:          node --test backend/tests/referral-*.test.js
#   tests 113 | pass 113 | fail 0

# Per-phase (post-fix), in dependency order:
#   phase1 10/10  phase2 9/9  phase3 15/15  phase4 11/11  phase4-hardening 5/5
#   phase5 12/12  phase5-hardening 6/6  phase6 10/10  phase6-hardening 8/8
#   phase7 8/8    phase7-hardening 7/7
#   e2e-stack 4/4 (flows A-D)   route-smoke 8/8 (60+ routes mounted + auth behaviour)
```

`/api/referrals/*` mount path: `server.js` → `promotionsRouter` → `promotionsRoutes.js` mounts `router.use('/api/referrals', referralRouter)` → `referralRoutes.js` default-exports `createReferralRouter()`. The route-smoke test asserts all 60+ documented routes are registered.

> **Backend workspace command:** `npm run test --workspace=backend` runs `backend/tests/run-tests.js`, a **separate live-Supabase platform integration suite** (blockchain, odometer, escrow, etc.). It does **not** cover the referral engine. The referral engine's tests are the `node --test backend/tests/referral-*.test.js` files used throughout this report.

## Defects Found and Fixed

| # | Defect | Root cause | Fix | Test | Commit |
|---|---|---|---|---|---|
| 1 | **Trust audit export returned 0 events** (and would error in production) | `getAdminTimeline(filters)` passed the whole `filters` object — including the `limit` pagination key — as column-equality filters. The Supabase repo's `applyFilters` would emit `.eq('limit', N)` against a non-existent column; in-memory repos matched zero rows. | Destructure `limit` out of the column filters; pass it only as a query option. | `referral-trust-review-phase7.test.js` (audit export), E2E Flow B | a287420 |
| 2 | **Intent misclassification** — "buy/import a Toyota Aqua" classified as `general_marketplace` / `container_space` | Classifiers required the literal word `car`/`vehicle` and had no make/model lexicon; a request like "repair my car" was also misread as a purchase. | Added a make/model regex (Toyota/Honda/Nissan/…, Aqua/Fit/Hilux/…); moved service/parts intent ahead of generic buy/sell. | `referral-local-marketplace-phase4.test.js` + `referral-import-campaign-phase5.test.js` (intent tests) | a287420 |
| 3 | **Campaign slug collision** for two bundles created in the same millisecond | `buildCollisionResistantSlug` appended the timestamp+counter uniqueness suffix **before** `slugify()`'s 80-char truncation, so a long descriptive prefix pushed the suffix off the end → identical slugs → violates `UNIQUE (tenant_id, slug)` on `referral_campaigns`. | Build the descriptive part, truncate it, **then** append a base-36 timestamp + monotonic counter so the suffix always survives. | `referral-import-campaign-phase5-hardening.test.js` (monotonic slug) | a287420 |

### Test corrections (5 brittle source-grep markers — corrected, not weakened)

These assertions grepped the source for literal strings that drifted when the implementation was refactored. In every case the route declarations and the actual security/wiring **behaviour** were still asserted and verified; the markers were re-pointed at the real location, and behavioural coverage was added on top (route-smoke + E2E).

- **phase 3** — Telegram secret env var is consumed by the parser helper (`isValidTelegramWebhookSecret`), so it is asserted in the parser file, not the route file. CSRF-bypass is matched in the security middleware via an escaped-slash RegExp (`\/api\/referrals\/channels\/…`), so the assertion now uses the escaped form.
- **phase 4 / 5 / 6** — the router instantiates the hardened/benchmark subclasses (`ReferralLocalMarketplaceHardenedService`, `ReferralImportCampaignBenchmarkService`, `ReferralMarketingSeoBenchmarkService`), each of which `extends` the named base service. The wiring marker now matches the class actually used.

### New regression / E2E coverage added

- `backend/tests/referral-engine-e2e-stack.test.js` — flows A (local), B (import + trust hold/dispute/audit), C (marketing publish + patch safety), D (agent gateway safety). (commit db37898)
- `backend/tests/referral-engine-route-smoke.test.js` — 60+ route mount proof + public/protected/webhook-secret auth behaviour over real HTTP. (commit 647b2b8)

## Migration & RLS (static review of `016_referral_engine_phase1.sql`)

- ✅ All 9 referral tables exist and match `REFERRAL_TABLES`.
- ✅ RLS `ENABLE`d on all 9 tables (deny-by-default; access is mediated by the backend service-role client + route-level `authorizeRole`).
- ✅ Indexes cover campaign/code/event/wallet/coupon/share-asset lookup paths (incl. `referral_events(code_id, occurred_at DESC)`).
- ✅ Unique constraints: `referral_campaigns(tenant_id, slug)`, `referral_codes.code`, `referral_coupons.code`, `referral_coupon_redemptions(coupon_id, redeemer_user_id)` + `(idempotency_key)`, `referral_wallets.user_id`.
- ✅ Wallet status CHECK exactly matches `WALLET_TRANSACTION_STATUSES` (`created, pending, eligible, approved, payable, paid_or_applied, held, rejected`).
- ✅ DB-level signup guardrail `referral_signup_only_not_matured` forbids signup-sourced rewards from reaching any payable state — defense-in-depth with the service guard.
- ✅ `occurred_at` column + FKs (`ON DELETE SET NULL`/`CASCADE`) + `updated_at` triggers present.
- ⚠️ RLS is enabled but **no explicit policies** are defined (see Remaining Risks).

Live migration execution / table introspection was **not** run in this verification environment; the review above is static.

## Security, Wallet & Reward Safety (sections 13-14)

- Public code validation (`/validate`, `/codes/:code`) is intentionally public; wallet read (`/wallets/:userId`) requires auth and is self/admin scoped; `/wallets/transactions/:id/status` (direct transition) is **admin-only**; trust decisions require trust/compliance/admin roles; marketing publish requires marketing-manager/admin.
- Webhook routes require a valid channel secret (or Telegram secret token); `x-user-id` fallback is gated to `test`/`development`/`local` via `isUserIdFallbackAllowed`. CSRF is bypassed only for the four social webhook paths.
- Agent Gateway exposes **no** wallet-mutation tool; a hidden `context.persist` cannot bypass operator permission (both verified behaviourally in E2E Flow D and the phase-2 tests).
- Wallet maturity is a forward-only state machine (`WALLET_ALLOWED_TRANSITIONS`) enforced in `transitionWalletTransaction`; signup-only cannot mature (service + DB); self-referral and duplicate-milestone rewards are blocked in the hardened local/import services; a rejected review case transitions the wallet to the terminal `rejected` state (cannot become payable).

## Channel / Marketing / Trust Safety (sections 15-17)

- **Channels:** Telegram `/start` + callback, WhatsApp text/button/interactive, FB/IG message + postback, web/mobile chat all normalize; unknown channels and malformed payloads are rejected (ValidationError / 400), and webhook batches are size-bounded. (phase-3 + route-smoke)
- **Marketing:** drafts stored before publication; disclosure cannot be removed and SEO attribution cannot be overwritten via patch; non-`http(s)` base URLs rejected; publishing requires the approve→schedule→publish workflow; non-marketing actors blocked; channel names normalize and unsupported channels are rejected. (phase-6 + E2E Flow C)
- **Trust/audit:** duplicate review cases blocked; holds and allow/hold/reject decisions require reasons; benefit explanations use the latest risk check deterministically; cross-user benefit view/dispute is forbidden; disputes require reasons and a resolved outcome; audit export enforces a row limit, returns a checksum, and records itself. (phase-7 + E2E Flow B)

## Remaining Risks

1. **RLS without policies (non-blocking).** With RLS enabled and no policies, the tables are deny-by-default to anon/authenticated keys; the backend works because it uses the service-role key. This is a safe posture _as long as_ all access stays server-mediated. If any future surface queries these tables with a non-service-role key, explicit RLS policies must be authored first.
2. **Fixes landed on the top branch only (non-blocking).** Defects 1-3 touch phase-1/4/5 files but were committed on `#71`. Acceptable for sequential merge; cherry-pick into originating PRs if per-PR purity is desired.
3. **Live migration/staging not executed here (process).** `016` is statically validated; it has not been applied to a live/staging Supabase as part of this verification.
4. **Intent classifier is heuristic (low).** The make/model lexicon covers common Zimbabwe-market cases but is not exhaustive; this is a triage signal with operator/human review downstream, so misses degrade gracefully to `general_marketplace`/`container_space`.

## UI Readiness

The backend now supports the planned surfaces: campaign/code/coupon admin, QR/share-kit panels, wallet benefit-status views (with human-readable `explainBenefitStatus`), local lead views, import route/capacity pages, container-space status, channel share-kit screens, the AI marketing draft review queue (draft→approve→schedule→publish), the trust/fraud review queue, the dispute center, and the audit-export panel (checksum + recorded). Every API returns structured, attribution-preserving JSON suitable for these views.

## Merge Recommendation

**Ready except for CI/staging verification.** All code-level verification is green (113/113 referral assertions, full route mount + auth proof, migration/RLS/security/wallet/trust reviews complete, 3 real defects fixed with regression coverage). Before the sequential merge, run the migration on staging and let CI run the referral `node --test` suite.

## Exact Next Commands

```bash
# 1. Re-run the full referral verification locally
node --test backend/tests/referral-*.test.js

# 2. (staging) apply the phase-1 migration and confirm tables/RLS/constraints
#    e.g. via your Supabase migration tooling against the staging project
#    then table/constraint introspection on referral_* tables

# 3. When merge is approved (do each, then re-run tests before the next):
gh pr merge 62 --merge && gh pr merge 63 --merge && gh pr merge 64 --merge \
  && gh pr merge 67 --merge && gh pr merge 68 --merge && gh pr merge 69 --merge \
  && gh pr merge 71 --merge
#    After each merge, retarget/rebase the next PR if GitHub does not do so automatically.
```

_No PRs were merged. No code was pushed. Fixes and new tests are committed locally on `feature/referral-engine-phase7-trust-review` (3 commits ahead of origin: a287420, db37898, 647b2b8)._

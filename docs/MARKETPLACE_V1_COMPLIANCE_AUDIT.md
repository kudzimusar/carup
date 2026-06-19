# Marketplace v1 — Strict Completion Audit (PR #73)

**Audited branch:** `feature/marketplace-v1-production-integration`
**Plan (source of truth):** `docs/CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md` — the version now on `main` (1225 lines, §§0–33). Audited against its **§28 Tests & Acceptance**, **§29 Required Implementation Order**, **§30 Non-Negotiable Safety & Quality**, and contract §§3,5,6,11–17,22–25.

> **Doc-version note:** the branch had originally moved an *earlier* 1642-line variant of the plan into `docs/`. `main` independently added the canonical version (commit `28f3805`). The add/add conflict was resolved **in favour of `main`'s canonical doc**; this audit is against that canonical doc. There is **no §34** in either version (the requested "§34 Final Definition of Done" maps to §28 Acceptance + §3 Boundary).

## A. Review findings — RESOLVED

| # | Finding (source) | Status | Proof |
|---|---|---|---|
| Mergeability | GitHub `mergeable=CONFLICTING` (docs add/add) | **FIXED** → `mergeable=MERGEABLE` | Merged `origin/main`, resolved doc conflict toward main (`cf96c5e`); `gh pr view 73` now `MERGEABLE` |
| P1 (Codex) | Signed-in inquiries discarded buyer contact → seller sees “Buyer”, no reply address; mobile sends none | **FIXED** | `marketplaceInquiryService.js` preserves submitted contact + enriches missing fields from `users` profile (`lookupUserContact`); surfaced only to owning seller/admin. Test: *“signed-in inquiry enriches buyer contact… (P1)”* |
| P2 (Codex) | Admin detail 404'd suppressed/rejected/flagged listings (used public-visibility filter) | **FIXED** | `marketplaceListingDetailService.js` admin audience applies **only** the fixture guard; `public_status` reflects true governed status. Tests: *“admin listing detail can read a suppressed listing (P2)”*, *“admin detail still 404s a fixture”* |

## B. Compliance Matrix

| Requirement | Plan § | Implemented | Files | Tests | Gaps / risks | Fix before merge |
|---|---|---|---|---|---|---|
| Public listings API (sanitized) | §5,§10,§28 | **Yes** | `listingSummaryService.js`, `marketplaceRoutes.js` | `marketplace-listing-summary`, `marketplace-cards.spec` | none | — |
| Listing detail API (sanitized, 404 non-public) | §10,§28 | **Yes** | `marketplaceListingDetailService.js` | spine: detail privacy/404 + P2 | none | — |
| Inquiry API (+referral context, guest validation) | §14,§28 | **Yes** | `marketplaceInquiryService.js`, `marketplaceRoutes.js` (rateLimiter) | spine inquiry tests, `marketplace-v1-flows.spec` | none | — |
| Admin moderation API (approve/reject/suppress/request-evidence/flag/clear + audit) | §24,§28 | **Yes** | `marketplaceModerationService.js`, `marketplaceAdminRoutes.js` | spine moderation tests | separate "high-risk seller"/"reported listings" sub-queues are filters, not distinct tabs | — (acceptance met) |
| Trust-badge suppression (backend-generated) | §6,§30 | **Yes** | `marketplaceTrustSummaryService.js`, `listingSummaryService.js` | spine trust tests; `marketplace-parts.spec` (suppressed badge not rendered) | §6 field-name superset added (`public_copy`/`safe_public_claims`/`verification_status`) | — |
| Suspicious listing suppression | §6,§19,§30 | **Yes** | `listingSummaryService.summarizePartSentry` (fail-closed), trust summary risk mapping | spine: unknown-suspicion suppression | none | — |
| PartSentry public-card suppression (ports #11) | §6,§11,§30 | **Yes** | `summarizePartSentry` (public_card_eligible + non-suspicious + not self-approved) | spine PartSentry tests | write-side approval workflow still in PR #11 | — (read-side correct) |
| Backend-driven verification labels | §6,§30 | **Yes** | `marketplaceTrustSummaryService.buildVerificationSummary` | spine verification test | per-seller identity bridge (PR #72 Workstream G) deferred | — |
| Referral event emission (no rewards in marketplace) | §15,§30 | **Yes** | `marketplaceReferralBridgeService.js` | spine referral-bridge tests, `marketplace-v1-flows.spec` | none | — |
| Diaspora/import/container inquiry types (no shipment data) | §16,§17,§30 | **Yes** | `marketplaceEventTypes.js`, `marketplaceInquiryService.js` (metadata allow-list) | spine diaspora inquiry test | shipment data blocked at-rest | — |
| Guest inquiry validation / rate-limit | §14,§28 | **Yes** | `marketplaceRoutes.js` `inquiryLimiter`, service validation | spine guest-contact test | none | — |
| Parts Marketplace v1 (governed cards + inquiry) | §3,§11,§28 | **Partial (gated v1)** | `marketplacePartsService.js`, `MarketplaceCategoryPage.tsx`, routes | `marketplace-parts.spec` (cards render + suppression), spine parts governance | **No parts-for-sale inventory backend exists**; surface is governed + gated onboarding; browse/search-by-spec deferred | Documented limitation (per §3 “placeholder intentionally gated”) |
| Garage/Service Marketplace v1 | §3,§12,§28 | **Partial (gated v1)** | `marketplacePartsService.js`, `MarketplaceCategoryPage.tsx` | `marketplace-parts.spec` pattern | No provider-listing backend; governed gated surface + service inquiry | Documented limitation |
| Web marketplace page / cards / URL params | §10,§28 | **Yes** | `Marketplace.tsx` | `marketplace-cards.spec`, `marketplace-url-params.spec` (20) | none | — |
| Listing detail page (trust/all-in/inquiry/safety) | §10,§18,§28 | **Yes** | `VehicleDetail.tsx`, `TrustSummaryPanel/AllInPricePanel/SafetyWarnings/InquiryModal` | tsc + manual; flows mock detail | detail page not e2e-asserted (heavy passport mocks) | — |
| Save listing (server-backed) | §21,§28 | **Yes** | `marketplaceSavedService.js`, `useCarUpApi` | spine save round-trip + 23505 idempotency | none | — |
| Compare flow | §21,§28 | **Yes** | `MarketplaceCompare.tsx` | `marketplace-v1-flows.spec` compare | none | — |
| Trust badges from backend only / suppressed not rendered | §6,§28,§30 | **Yes** | `TrustSummaryPanel.tsx`, parts card | `marketplace-parts.spec` | none | — |
| Navigation routes reachable (registry) | §23,§28 | **Yes** | `featureRegistry.ts` (+parts/services entries), `App.tsx`, header links | `featureRegistry.route-validation` (vitest 79), `navbar-coverage/deeplinks` (10) | none | — |
| Admin moderation page (command center) | §24,§28 | **Yes** | `dashboard/admin/MarketplaceModeration.tsx` | tsc; mocked manual | not e2e-asserted | — |
| Seller listing management + inquiries | §25 | **Partial** | `SellerInquiriesCard.tsx` in `MyListings.tsx`; existing create/edit/status | tsc | AI listing-builder + submit-for-review not wired into the create form (backend AI endpoint exists) | Optional pre-merge |
| AI builder / buyer assistant / trust / price (advisory, fallback) | §7–§9,§18 | **Yes** | `marketplaceAiAssistantService.js`, `BuyerAssistantDrawer.tsx` | spine AI fallback tests | never throws; `ai_unavailable` surfaced | — |
| All-in price contract + UI | §18 | **Yes** | `marketplacePricingService.js`, `AllInPricePanel.tsx` | spine pricing tests | none | — |
| Mobile browse/detail/inquiry parity (same API) | §22,§28 | **Yes** | `mobile/utils/marketplaceApi.ts`, `(tabs)/marketplace.tsx`, `vehicle/[vin].tsx` | mobile `tsc --noEmit` (0 errors) | **no mobile e2e harness in repo** — verified by tsc + manual reasoning, not automated e2e (documented per §28) | — |
| SafePay-ready transaction contract | §27 | **Yes (contract)** | `MarketplaceTransactionIntent` in detail | type-level | intentionally contract-only | — |
| Verified-reviews foundation | §20 | **Partial (contract)** | seller summary fields; verified_reviews_count | — | write-flow deferred per §20 | Documented |

## C. Additive-integration verification (no overhaul / no removal)

- Diff vs `main`: **all new code is additive** — new sibling service/route/page/component files; existing services extended in place (`listingSummaryService` hardened with backward-compatible `summarizePartSentry`; all prior assertions preserved — 62 original marketplace tests still pass).
- **No existing CarUp functionality removed or replaced.** Marketplace/nav/referral/Diaspora/PartSentry/verification/admin foundations are consumed via their existing contracts (referral via `recordReferralEvent`; saves via `saved_vehicles`; audit via `trust_audit_events`; nav via Feature Registry).
- **One non-functional stub upgraded, not removed:** the mobile `Secure Purchase` dead-end (it only `router.push`'d back) became a working `Express Interest` inquiry. Documented; SafePay escrow remains deferred.
- No Feature Registry / verification / evidence / referral / PartSentry / admin foundation bypassed.

## D. Open-PR boundary verification

- **#11 PartSentry:** read-side suppression in PR #73 is correct & fail-closed (allowlist of non-suspicious states; self-approval excluded; `public_card_eligible` required). **Write-side governance still depends on PR #11.**
- **#72 Verification:** badges/labels are backend-truth only; the frontend renders only supplied claims; per-seller identity bridge deferred.
- **#66 Registry nav:** marketplace routes registered in the Feature Registry (incl. new parts/services); no hardcoded marketplace nav added where the registry pattern applies.
- **#58 Diaspora:** marketplace never reads shipment/container by-id; diaspora inquiries persist **no** shipment fields (metadata allow-list enforces at-rest).

## E. Migration status

- File: `database/migrations/20260616120000_marketplace_v1_inquiries.sql` (confirmed present) — creates `marketplace_inquiries` + `marketplace_listing_reports`, RLS enabled, `anon`/`authenticated` REVOKED, `service_role` only, indexed; idempotent (`to_regclass` + `IF NOT EXISTS`).
- **How to apply:** via the project's Supabase migration path (`scripts/` deploy / `run-sql.js`). **Not auto-applied** (per “do not merge automatically” + safe-ops).
- **Works before migration:** all read paths (listings, detail, trust/pricing/compare, recommendations, categories, parts/services), AI advisory, referral emission, saved listings (`saved_vehicles` is pre-existing).
- **Does NOT persist before migration:** inquiry creation, admin/seller inquiry lists, listing reports.
- **Degrades safely:** admin analytics returns zeroed inquiry metrics with a note; admin inquiries tab shows “migration not applied”; `SellerInquiriesCard` renders nothing on error; inquiry POST returns a clear `DatabaseError` rather than corrupting state.

## F. Tests re-run (§28 minimum commands)

```text
node backend/tests/run-tests.js                         -> exit 0 (ALL GOVERNANCE/INTEGRATION/TRUST PASSED)
node --test backend/tests/marketplace-*.test.js         -> 134 pass / 0 fail
npm run build --workspace=web                           -> built, exit 0
npx tsc --noEmit --project web/tsconfig.app.json        -> exit 0
cd mobile && npx tsc --noEmit                           -> exit 0 (0 errors)
cd web && npx vitest run                                -> 79 pass (registry<->route validation incl.)
playwright marketplace-cards + marketplace-url-params   -> 20 pass (incl. seller-PII safety)
playwright navbar-coverage                              -> 3 pass (10 with navbar-deeplinks)
playwright marketplace-v1-flows (inquiry+referral, compare+trust)  -> 2 pass
playwright marketplace-parts (parts cards render + suppressed badge NOT rendered + empty gate) -> 2 pass
```
Environment note: there is no automated **mobile** e2e harness in the repo; mobile parity is verified by `tsc` + code inspection, not Detox/e2e (documented per §28).

## G. Final Status

**A — READY FOR HUMAN QA**, with explicitly documented gated-v1 limitations.

Rationale: every **§28 acceptance line** is satisfied and test-proven; both PR review findings (P1, P2) are fixed and regression-tested; **mergeability is resolved** (`MERGEABLE`); §30 non-negotiable safety rules hold (verified by multi-agent review + tests). The remaining items are **plan-permitted** (§3 “prepared by contracts / placeholder intentionally gated”): Parts & Garage marketplaces ship as **governed gated surfaces** (no inventory backend exists to overhaul), the seller AI-builder/submit-review UI and verified-review write-flow are deferred contracts, and mobile is verified without an e2e harness. The migration must be applied to Supabase before inquiry persistence is live.

If the reviewer treats full parts/garage browse (inventory) as mandatory for v1 rather than gated, downgrade to **B — PARTIAL** on those two rows only.

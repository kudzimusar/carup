# Marketplace v1 — Production Integration Sprint

Completes a production-testable **AI-governed trust marketplace** as the commercial integration layer of the existing CarUp system. **Strictly additive** — extends current marketplace UI, listing-summary services, Feature Registry, referral engine, verification/evidence, PartSentry governance, Diaspora/import work, admin moderation, web and mobile apps. No existing functionality removed or replaced (one non-functional mobile "Secure Purchase" stub was upgraded into a working inquiry, documented below).

## Summary
End-to-end core loop now works: seller listing (existing) → backend validates eligibility (existing) → backend generates **trust/verification/risk/pricing summaries** (new, governed) → admin approves/rejects/suppresses/requests-evidence/flags (new) → public users browse/detail/save/share/compare (new + existing) → buyer submits inquiry/quote (new) → **referral attribution captured & emitted** (new bridge over existing engine) → mobile consumes the **same** API (new) → Diaspora/import/container create **safe inquiries** with no shipment data (new) → tests prove the flow.

## Open-PR reconciliation (not merged — per instructions)
- **#11 PartSentry public-card** — *marketplace-critical*. We **ported its read-side suppression intent** into the live path (no merge dependency): `summarizePartSentry` now requires `public_card_eligible` **AND** non-suspicious (`watch`/`flagged` or any unknown value suppress, fail-closed) **AND** not self-approved. #11 still supplies the governed write/approval workflow — recommend merging it for that.
- **#72 verification** — *consume-contract*. `verification_summary` derives only from backend truth; never invents "verified". Per-seller identity→`passport_verified` bridge (Workstream G) documented as deferred.
- **#66 mobile drawer** — *consume-contract*. Marketplace mobile nav uses the Feature Registry contract.
- **#58 Diaspora shipment scoping** — *honored*. Marketplace never reads shipment/container by-id; diaspora inquiries store **no** shipment fields (enforced at-rest via metadata allow-list).

## Implementation Summary
- **Backend**: new services — listing detail, trust/verification summary, pricing (all-in cost), inquiry, referral bridge, saved, compare/recommendations/categories, moderation, analytics, AI advisory; extended `marketplaceRoutes.js` + new `marketplaceAdminRoutes.js`; `optionalAuth` middleware. Hardened `summarizePartSentry` (PR #11 suppression, fail-closed).
- **Web**: `TrustSummaryPanel`, `AllInPricePanel`, `SafetyWarnings`, `InquiryModal`, `BuyerAssistantDrawer`, `SellerInquiriesCard`, `MarketplaceCompare` page, referral-capture util; wired into `Marketplace`, `VehicleDetail`, admin `MarketplaceModeration` (command center), owner `MyListings`; `useCarUpApi` extended.
- **Mobile**: `marketplaceApi.ts` (same contract, CSRF/auth/base-url plumbing); list switched off legacy `/api/vehicles` to `/api/marketplace/listings`; detail shows backend trust summary + working inquiry.
- **Admin**: analytics + governed moderation actions (approve/reject/suppress/request-evidence/flag-risk/clear-risk with required reasons) + inquiry management + AI moderation summary; trust_audit_events sink.
- **AI**: listing-draft, buyer-assistant, price-estimate, share-copy, moderation-summary — advisory only, deterministic fallback, never throws, `ai_unavailable` surfaced honestly; governed tags never come from AI.
- **Referral**: marketplace EMITS events via `recordReferralEvent`; never mints/transitions rewards.
- **Diaspora**: import/container/diaspora inquiry types create safe leads only.
- **PartSentry/Trust**: backend-generated badges; frontend renders only supplied claims.

## Database / Migration Notes
- New idempotent migration `database/migrations/20260616120000_marketplace_v1_inquiries.sql`: `marketplace_inquiries` + `marketplace_listing_reports` (RLS enabled, `anon`/`authenticated` REVOKED, `service_role` only, indexed). **Not auto-applied** — apply via the project's Supabase `scripts/` path before the inquiry/admin-inquiry endpoints operate on live data (analytics + admin inquiries degrade gracefully until then). Reuses existing `saved_vehicles`, `referral_events`, `trust_audit_events` (no duplicate tables). Rollback notes in the migration header.

## Security & Privacy Guarantees
- Public APIs expose sanitized summaries only — never `owner_id`/`tenant_id`/guest contact/`seller_id`/`mechanic_id`/signatures/raw trust-score internals/admin `decision_notes`.
- Trust badges are backend-generated; PartSentry claims suppressed unless governed + non-suspicious + not self-approved (fail-closed).
- **Adversarial review (multi-agent) ran on the backend spine; all 7 confirmed findings fixed**, incl. a **high-severity privilege-escalation**: marketplace moderation/inquiry-admin now re-check the server-derived **platform role** (not the header-derived effective role), so a tenant-scoped `x-stakeholder-role` elevation cannot gain global cross-tenant power. Also: inquiry metadata allow-listed; `listInquiriesForAdmin` service-layer authz; `patchInquiry` 404 correctness; `saveListing` unique-violation idempotency.
- Diaspora/import/container inquiries persist **no** shipment/container data.
- Admin/seller routes require auth (`authorizeRole`) + independent service-layer re-check (fail-closed); inquiry POST is guest-allowed, rate-limited, and cannot spoof `seller_id`/`buyer_id`.

## Test Results
```bash
node backend/tests/run-tests.js            # ALL GOVERNANCE/INTEGRATION/TRUST TESTS PASSED — exit 0
node --test backend/tests/marketplace-*.test.js   # 130 pass / 0 fail (incl. 40 new spine + hardening)
npm run build --workspace=web              # ✓ built — exit 0
npx tsc --noEmit -p web/tsconfig.app.json  # exit 0
cd mobile && npx tsc --noEmit              # exit 0 (0 errors)
cd web && npx vitest run                   # 79 pass (incl. registry<->route validation)
# Playwright (chromium, mocked API):
#   e2e/marketplace-cards + marketplace-url-params  -> 20 pass (incl. seller-PII safety)
#   e2e/navbar-coverage + navbar-deeplinks           -> 10 pass
#   e2e/marketplace-v1-flows (NEW)                    -> 2 pass (inquiry+referral, compare+trust)
```

## Known Limitations / Deferred Work
- Full SafePay escrow settlement, wallet payout automation, government/CID/ZIMRA workflows, full logistics tracking, full AI auto-negotiation, dealer subscription billing — **deferred**; contracts are future-ready (`MarketplaceTransactionIntent`, pricing/all-in fields).
- Per-seller identity→`passport_verified` bridge (PR #72 Workstream G) deferred; `verification_summary.identity_status` defaults conservative (`unverified`).
- Parts/services are **inquiry-driven** in v1 (no dedicated parts listing backend yet); PartSentry governance fully enforced on vehicle parts.
- `marketplace_inquiries`/`marketplace_listing_reports` migration must be applied to the live Supabase before inquiry persistence works end-to-end (endpoints + UI degrade gracefully until then). New AI endpoints fall back deterministically when no AI provider key is configured.
- AI price/moderation are advisory only; never auto-approve or change visibility.

## Manual QA Checklist
- [ ] Public marketplace browse (filters/search/quick-chips still work)
- [ ] Listing detail shows backend trust summary + all-in price + safety warnings
- [ ] Inquiry submission (guest + logged-in); seller sees it in My Listings
- [ ] Save listing (server-backed)
- [ ] Compare 2–4 listings → comparison table with trust badges
- [ ] Referral URL (`?ref=&campaign=`) captured and attached to inquiry
- [ ] Admin: approve/suppress/reject/flag/clear/request-evidence (reasons enforced) + analytics + inquiries
- [ ] Parts governance: suspicious/ineligible PartSentry claims suppressed on cards
- [ ] Diaspora/import inquiry creates a lead with no shipment data
- [ ] Mobile: browse / detail trust summary / Express Interest inquiry
- [ ] Apply migration `20260616120000_marketplace_v1_inquiries.sql` to Supabase

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

# CarUp Kimi Marketplace v1 Completion Sprint

**Repository:** `kudzimusar/carup`  
**Authoritative repo path:** `docs/CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md`  
**Working branch target for implementation:** `feature/marketplace-v1-production-integration`  
**Document purpose:** This is the execution brief for Claude Code to use with `/goal` and `/loop` until the CarUp Kimi Marketplace v1 is implemented, tested, and ready for PR review.  
**Scope boundary:** Work only inside the CarUp Kimi repository. Do not use or modify any unrelated repository, product, or project.

---

## 0. Executive Objective

CarUp Kimi Marketplace must become the central commercial layer of the CarUp system, not just a listing page.

The goal is to complete a production-testable **Marketplace v1** where buyers can browse, trust, inquire, compare, and act on real marketplace listings, while sellers, dealers, suppliers, garages, operators, and admins can manage listings through governed backend workflows.

CarUp should compete beyond traditional marketplaces by becoming an **AI-governed trust marketplace** for:

1. vehicles,
2. spare parts,
3. garages/mechanics,
4. dealers,
5. import requests,
6. container-space interest,
7. diaspora automotive trade,
8. referral-driven sales,
9. evidence-backed vehicle/parts trust,
10. AI-assisted buying, selling, moderation, and pricing.

The UI already exists in early form. The job is not to create a random new UI. The job is to upgrade the existing marketplace into a benchmark-grade product experience while wiring it into the current backend, trust, referral, navigation, mobile, and Diaspora foundations.

---

## 1. Current Known Build State

Before changing code, Claude must inspect the repository and confirm the current state.

Expected existing areas to inspect:

```text
web/src/pages/Marketplace.tsx
mobile/app/(tabs)/marketplace.tsx
backend/routes/marketplaceRoutes.js
backend/services/marketplace/listingSummaryService.js
backend/services/marketplace/marketplaceListingEligibility.js
backend/services/marketplace/marketplaceClassificationRules.js
backend/services/marketplace/marketplaceBackfill.js
backend/services/marketplace/navCoverageService.js
web/src/pages/dashboard/admin/MarketplaceModeration.tsx
web/src/lib/marketplaceParams.ts
database/migrations/20260603132036_marketplace_listing_summary_infra.sql
web/e2e/marketplace-cards.spec.ts
web/e2e/marketplace-url-params.spec.ts
```

Also inspect related systems:

```text
Feature Registry / route guard / navigation files
Referral engine backend and docs
Diaspora/import routes and docs
Verification admin/session flow
Vehicle evidence/passport/trust services
PartSentry governance PR/workflow files if present
Saved cars / buyer dashboard files
Owner/dealer listing dashboard files
Mobile marketplace and mobile navigation files
Shared types
Backend test runner
Playwright config and marketplace tests
```

---

## 2. Open PR Awareness and Integration Order

Claude must inspect current open PRs before implementation. Do not blindly duplicate work.

Priority PRs to inspect:

### PR #11 — PartSentry public-card approval backend workflow

Marketplace-critical. It governs whether PartSentry signals are allowed to influence public marketplace cards.

Required behavior for Marketplace v1:

```text
No public card can show PartSentry Checked, Verified Parts, repair-history confidence, or parts provenance claims unless backend public-card eligibility permits it.
Suspicious PartSentry records must suppress public trust claims.
Frontend must never invent PartSentry trust labels.
```

### PR #72 — Verification admin review loop and mobile status refresh

Important for backend-truth verification badges.

Required behavior for Marketplace v1:

```text
Marketplace verification badges must be backend-generated.
Frontend must not claim seller/dealer/identity/vehicle verification unless backend summary says so.
Mobile must consume persisted verification status, not local assumptions.
```

### PR #66 — Registry-driven mobile hamburger drawer

Important for mobile-web discoverability.

Required behavior for Marketplace v1:

```text
Marketplace routes must be discoverable through the Feature Registry / navigation model.
Do not create disconnected hardcoded marketplace routes unless temporarily required and documented.
```

### PR #58 — Diaspora shipment by-id read access hardening

Important if Marketplace exposes import/container/shipment detail data.

Required behavior for Marketplace v1:

```text
Diaspora/import/container marketplace flows should be inquiry/campaign based in v1.
Do not expose sensitive shipment details unless access-control rules are verified.
```

---

## 3. Marketplace Product Boundary

Marketplace v1 should be a completed commercial loop, not every future CarUp feature.

### Marketplace v1 includes

```text
Public vehicle marketplace
Public parts marketplace v1
Garage/service provider marketplace v1
Dealer/supplier profiles
Marketplace listing detail pages
Marketplace inquiry/quote request system
Referral-aware marketplace events
Diaspora/import/container inquiry flows
Admin moderation command center
Seller/owner/dealer listing management
Buyer saved listings and activity basics
AI listing builder
AI buyer assistant entry points
AI trust summary
AI price intelligence placeholder/contract
Fraud/risk suppression rules
Mobile browse/detail/inquiry parity
Tests and acceptance gates
```

### Marketplace v1 does not include full completion of

```text
Full SafePay escrow settlement
Full logistics tracking exchange
Full government/CID/ZIMRA workflows
Full wallet payout automation
Full AI negotiation agent
Full dealer subscription billing
Full 360/AR media system
Full native seller capture workflow if backend is not ready
```

These must be prepared by contracts, not fully implemented in this sprint.

---

## 4. Benchmark-Beating Positioning

CarUp should not simply copy Autotrader, Cars.com, Carvana, or Carwow.

Global platforms are strong at listings, saved searches, dealer tools, car research, finance, reviews, and e-commerce workflows. CarUp must compete through a stronger trust and AI layer.

CarUp Marketplace positioning:

```text
CarUp is an AI-governed trust marketplace for vehicles, parts, services, and diaspora automotive trade.
```

Benchmark-beating capabilities to build into v1:

1. AI Listing Builder.
2. AI Buyer Assistant.
3. AI Trust Summary.
4. Evidence-backed marketplace badges.
5. PartSentry-governed parts marketplace.
6. Transparent all-in pricing.
7. Diaspora landed-cost intelligence.
8. Referral-aware social commerce.
9. Verified-only reviews foundation.
10. Fraud/scam detection by design.
11. Mobile guided photo/evidence capture contract.
12. Admin AI moderation copilot contract.
13. Marketplace analytics command center.
14. SafePay-ready transaction contract.
15. Vehicle + parts + garage + import ecosystem in one marketplace.

---

## 5. Canonical Marketplace Listing Contract

Create or formalize a single marketplace listing DTO/shared type used by backend, web, and mobile.

Required listing shape:

```ts
export type MarketplaceListingType =
  | 'vehicle'
  | 'part'
  | 'service'
  | 'dealer_stock'
  | 'import_request'
  | 'container_space'
  | 'diaspora_request';

export type MarketplacePublicStatus =
  | 'draft'
  | 'pending_review'
  | 'public'
  | 'suppressed'
  | 'rejected'
  | 'archived';

export type MarketplaceRiskStatus =
  | 'clear'
  | 'watch'
  | 'flagged'
  | 'blocked';

export interface MarketplaceListingSummary {
  id: string;
  listing_type: MarketplaceListingType;
  source_type: string;
  title: string;
  description?: string;
  price?: number | null;
  currency?: string | null;
  location?: string | null;
  country?: string | null;
  seller_id?: string | null;
  seller_type?: 'private' | 'dealer' | 'supplier' | 'garage' | 'operator' | 'admin';
  seller_summary?: MarketplaceSellerSummary | null;
  vehicle_summary?: MarketplaceVehicleSummary | null;
  part_summary?: MarketplacePartSummary | null;
  service_summary?: MarketplaceServiceSummary | null;
  import_summary?: MarketplaceImportSummary | null;
  diaspora_summary?: MarketplaceDiasporaSummary | null;
  media?: MarketplaceMediaAsset[];
  trust_summary: MarketplaceTrustSummary;
  verification_summary: MarketplaceVerificationSummary;
  pricing_summary?: MarketplacePricingSummary | null;
  referral_context?: MarketplaceReferralContext | null;
  public_status: MarketplacePublicStatus;
  moderation_status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'suppressed';
  risk_status: MarketplaceRiskStatus;
  created_at: string;
  updated_at: string;
}
```

Rules:

```text
Backend owns this contract.
Web and mobile consume this contract.
Cards and detail pages do not calculate trust independently.
All public marketplace surfaces must use sanitized public DTOs.
Private evidence, documents, internal risk details, and raw AI logs must not leak.
```

---

## 6. Public Trust Summary Contract

Create backend-generated `MarketplaceTrustSummary`.

Required shape:

```ts
export interface MarketplaceTrustSummary {
  trust_badges: string[];
  trust_score?: number | null;
  public_copy: string;
  evidence_status: 'none' | 'partial' | 'available' | 'verified';
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected' | 'manual_review';
  partsentry_public_status?: 'not_applicable' | 'eligible' | 'not_eligible' | 'suppressed' | 'suspicious';
  suspicion_status?: 'clear' | 'watch' | 'flagged';
  risk_flags_public?: string[];
  safe_public_claims: string[];
}
```

Rules:

```text
Frontend must not invent trust badges.
Frontend displays only backend-provided trust_badges, safe_public_claims, and public_copy.
Suspicious, unapproved, or blocked records must suppress badges.
PartSentry claims require PR #11-style eligibility.
Verification claims require backend verification truth.
```

---

## 7. AI Listing Builder

Add an AI-assisted listing builder workflow.

Minimum v1 behavior:

```text
Input: seller-entered fields, existing vehicle data, part data, media metadata, evidence status.
Output: draft title, short description, long description, suggested category, suggested tags, missing fields, pricing hints, public-claim warnings.
```

Backend/service responsibilities:

```text
Create service boundary for AI listing generation.
Do not block listing creation if AI provider is unavailable.
Return deterministic fallback suggestions.
Log AI-generated content as draft/reviewable, not automatically trusted.
Never let AI create verification claims that backend trust does not permit.
```

UI responsibilities:

```text
Seller can accept, edit, or reject AI suggestions.
Seller sees missing evidence checklist.
Seller sees warnings for prohibited or unsupported claims.
Admin can see AI-generated public copy during moderation.
```

---

## 8. AI Buyer Assistant

Add AI buyer assistant entry points.

Minimum v1 behavior:

```text
Buyer can ask questions about a listing.
Assistant explains trust summary in plain language.
Assistant compares visible listing facts.
Assistant recommends inspection/import quote where appropriate.
Assistant must not expose private data.
Assistant must not guarantee legal, financial, or mechanical condition.
```

Example UI entry points:

```text
Ask AI about this car
Compare with saved listings
Explain this trust badge
Estimate full cost
Is this good for Zimbabwe roads?
What questions should I ask the seller?
```

---

## 9. AI Trust Summary and Risk Explanation

Create backend-controlled AI trust explanation, using only safe facts.

Admin view may include internal risk reasons.
Public view must include sanitized explanation only.

Public examples:

```text
This listing has verified vehicle evidence and no active public risk flags.
This listing is pending additional evidence before trust badges can be shown.
This parts listing has not yet been approved for public PartSentry claims.
```

Admin examples:

```text
Listing suppressed because seller identity is pending and PartSentry suspicion_status is flagged.
Listing requires more evidence because odometer image is missing and VIN evidence is incomplete.
```

---

## 10. Vehicle Marketplace Upgrade

Upgrade existing marketplace UI into a premium vehicle marketplace.

Required public vehicle features:

```text
Vehicle listing cards
Vehicle detail page
Image gallery
Make/model/year/mileage/fuel/transmission/body filters
Price and currency display
Location/country display
Seller/dealer summary
Trust summary
Evidence/passport summary
Save listing
Compare listing
Share listing
Inquiry/request quote
Request inspection
Request import quote
Referral code capture
AI assistant entry point
Related listings
Safety warnings
```

Detail page sections:

```text
Hero gallery
Title, price, location
All-in price estimate block
Trust and evidence summary
Vehicle specs
Seller/dealer profile card
AI explanation
Inquiry form
Referral/share tools
Related vehicles
Public safety guidance
```

---

## 11. Parts Marketplace v1

Build a governed parts marketplace.

Required parts features:

```text
Browse parts
Search/filter parts by category, condition, compatibility, seller, location, price/quote-required
Part detail page
Supplier/dealer profile summary
PartSentry public-card status
Provenance/evidence status where available
Inquiry/request quote
Referral/share link
Suspicious-claim suppression
Admin review integration
```

Rules:

```text
Do not show Verified Parts unless backend allows it.
Do not show PartSentry Checked unless public-card eligibility is true.
Suspicion watch/flagged suppresses public trust claims.
Listing images alone do not prove parts provenance.
```

---

## 12. Garage and Service Marketplace v1

Build a basic service provider marketplace.

Required service features:

```text
Garage/mechanic public cards
Service categories
Location
Verified status if available
Inspection capability
Request service/inspection inquiry
Verified-only review foundation
Admin approval/suspension
```

Do not build full scheduling/payment automation unless already safe.

---

## 13. Dealer, Supplier, Operator, and Seller Profiles

Each listing must have a public seller profile summary.

Required fields:

```text
display_name
seller_type
verification_status
location
response_rate
completed_transactions_count
verified_reviews_count
active_listings_count
risk_status_public
joined_at
```

Rules:

```text
No private documents.
No raw identity data.
No internal risk logs.
No private phone/email unless intentionally public and safe.
```

---

## 14. Marketplace Inquiry System

Create or complete structured inquiry flow.

Inquiry types:

```text
vehicle_purchase_interest
vehicle_inspection_request
part_quote_request
garage_service_request
import_quote_request
container_space_interest
dealer_stock_request
sell_my_car_request
trade_in_request
```

Inquiry shape:

```ts
export interface MarketplaceInquiry {
  id: string;
  listing_id?: string | null;
  buyer_id?: string | null;
  guest_contact?: MarketplaceGuestContact | null;
  seller_id?: string | null;
  inquiry_type: string;
  message?: string | null;
  referral_code?: string | null;
  campaign_code?: string | null;
  source_channel?: string | null;
  status: 'new' | 'assigned' | 'contacted' | 'qualified' | 'closed' | 'spam' | 'rejected';
  assigned_operator?: string | null;
  created_at: string;
  updated_at: string;
}
```

Rules:

```text
Every buyer action must create a durable inquiry.
Guest inquiries must be rate-limited and sanitized.
Referral/campaign codes must be preserved.
High-risk inquiries should be visible to admin/operator.
```

---

## 15. Referral-Aware Marketplace

Marketplace must emit referral-compatible events. Referral engine calculates attribution/rewards; marketplace does not.

Events to emit:

```text
marketplace_listing_viewed
marketplace_listing_saved
marketplace_listing_shared
marketplace_inquiry_created
marketplace_quote_requested
marketplace_inspection_requested
marketplace_import_interest_created
marketplace_container_space_interest_created
marketplace_service_booked
marketplace_purchase_confirmed
```

Rules:

```text
Capture referral_code from URL, QR, share link, or campaign code.
Attach referral context to inquiry.
Do not directly approve rewards from marketplace events.
Referral trust/fraud layer decides reward release, hold, dispute, or rejection.
```

---

## 16. Diaspora and Import Marketplace Flows

For v1, Diaspora/import/container must be inquiry-driven, not full logistics trading.

Required flows:

```text
Buy from Japan
Import to Zimbabwe
Request landed cost
Reserve container interest
Ask operator
Share with family abroad
Diaspora buyer quote request
```

Inquiry types:

```text
import_quote_request
container_space_interest
diaspora_vehicle_request
diaspora_parts_request
family_purchase_support
```

Rules:

```text
Do not expose sensitive shipment details unless access-control rules are verified.
Use operator qualification status rather than public logistics details.
Show estimates as estimates, not guarantees.
```

---

## 17. Container-Space Marketplace Lite

Build demand capture only.

Required fields:

```text
origin_country
origin_city
destination_country
destination_city
estimated_departure_window
capacity_label
operator_summary
price_or_quote_required
campaign_code
referral_code
status
```

Required UI:

```text
Container-space interest card
Route/campaign landing page
Reserve interest form
Operator follow-up status
Referral/share controls
```

---

## 18. Price Intelligence and All-In Cost Display

Create price intelligence contract and UI block.

Required display:

```text
Base listing price
Inspection estimate
Local transport estimate
Export/import estimate
Container/shipping estimate
Documentation estimate
Service fee estimate
Referral discount if applicable
Estimated total
Price confidence
```

Rules:

```text
Clearly label estimates.
Do not pretend uncertain fees are final.
Support local and diaspora price views.
Warn when price looks unrealistic or incomplete.
```

---

## 19. Fraud, Scam, and Risk Controls

Add marketplace risk model.

Risk statuses:

```text
clear
watch
flagged
blocked
```

Risk signals to support:

```text
duplicate listing
suspicious price
stolen/reused image suspicion
fake seller pattern
mismatched VIN/plate/chassis data
suspicious parts claim
repeated referral abuse
fake review suspicion
unusual inquiry pattern
external-link scam attempt
WhatsApp/contact mismatch
high-risk seller behavior
```

Required behavior:

```text
Blocked listings are not public.
Flagged listings require admin review.
Watch listings may remain public only if public claims are safe.
Risk reasons visible to admin, sanitized to public.
```

---

## 20. Verified Reviews Foundation

Do not allow open anonymous marketplace reviews.

Review eligibility should require a real event:

```text
completed inquiry
completed inspection
completed purchase
completed service
completed import/container transaction
```

Review labels:

```text
Verified buyer
Verified service customer
Verified import customer
Verified parts buyer
```

Admin must be able to suppress suspicious reviews.

---

## 21. Saved Listings, Alerts, and Compare

Required buyer features:

```text
Save listing
Unsave listing
Saved listings page integration
Compare two or more listings
Saved search placeholder/contract
Price drop alert placeholder/contract
Trust improved alert placeholder/contract
Similar listing alert placeholder/contract
```

Compare should show:

```text
price
total estimated cost
mileage/condition
trust summary
evidence status
seller status
import readiness
parts availability
inspection availability
AI recommendation
```

---

## 22. Mobile Marketplace Parity

Mobile must consume the same API as web.

Required mobile v1:

```text
Browse listings
Search/filter basics
Listing detail
Trust summary
Inquiry/request quote
Save listing
Referral link capture
AI buyer assistant entry point
```

Rules:

```text
Do not build separate mobile marketplace logic.
Do not invent mobile-only verification status.
Mobile uses backend listing summaries.
```

---

## 23. Navigation and Feature Registry Integration

Marketplace routes must be registered and discoverable.

Routes to support:

```text
/marketplace
/marketplace/vehicles
/marketplace/parts
/marketplace/services
/marketplace/imports
/marketplace/listing/:id
/dashboard/owner/listings
/dashboard/buyer/marketplace
/dashboard/admin/marketplace
```

Required behavior:

```text
Public navigation shows marketplace.
Mobile web navigation shows marketplace.
Dashboard navigation exposes relevant marketplace routes by role.
Route guard/Feature Registry rules are respected.
Navbar coverage tests are updated.
```

---

## 24. Marketplace Moderation Command Center

Upgrade admin marketplace moderation.

Admin queues:

```text
Pending listings
Suppressed listings
Flagged listings
Suspicious inquiries
High-risk sellers
Parts needing PartSentry review
Diaspora inquiries needing operator action
Reported listings
```

Admin actions:

```text
approve listing
reject listing
suppress listing
request more evidence
flag seller
flag listing
review AI risk reasons
review public trust summary
review PartSentry status
review price warnings
review user reports
view audit history
```

Rules:

```text
Every admin decision must be audited.
Rejection/suppression should require reason.
Seller should see actionable reason, not internal risk details.
```

---

## 25. Seller / Owner / Dealer Listing Dashboard

Required seller dashboard features:

```text
Create listing
Edit listing
Submit for review
See approval status
See public listing
See inquiries
View AI suggestions
Fix missing evidence
View performance stats
Pause/archive listing
```

Required status explanations:

```text
Draft: missing required fields.
Pending review: admin/moderation not complete.
Rejected: show seller-safe reason.
Suppressed: show seller-safe reason.
Public: listing visible.
Archived: not visible.
```

---

## 26. SEO and Social Commerce

Marketplace must be shareable and referral-ready.

Add or prepare:

```text
Listing metadata
Open Graph title/description/image
Structured listing data where safe
Location-based landing page contract
Vehicle make/model page contract
Parts category page contract
Diaspora route page contract
WhatsApp share text
Telegram/Facebook/X share text
QR/referral link support
```

AI generated content must remain reviewable and editable.

---

## 27. SafePay-Ready Transaction Contract

Do not build full escrow unless existing infrastructure is ready. Prepare the contract.

Fields:

```text
transaction_intent_id
payment_readiness_status
escrow_required
deposit_allowed
operator_review_required
fraud_hold_status
```

Rules:

```text
Marketplace inquiry can become transaction intent later.
High-risk listings cannot proceed to payment readiness.
SafePay labels must not appear as active unless supported by backend status.
```

---

## 28. Tests and Acceptance Criteria

Marketplace v1 is not done until these are satisfied.

### Backend tests

```text
GET /api/marketplace/listings returns sanitized public listings.
GET /api/marketplace/listings/:id returns sanitized public detail.
POST /api/marketplace/inquiries creates inquiry and preserves referral context.
Admin moderation route approves/rejects/suppresses listing.
Suspicious listing suppression works.
PartSentry public-card suppression works.
Verification labels are backend-driven.
Referral event emission works.
Diaspora/import inquiry types work.
Guest inquiry validation/rate-limit path works where available.
```

### Web tests

```text
Marketplace page loads.
Vehicle cards render.
Parts cards render.
URL params/filter behavior works.
Listing detail page works.
Inquiry form works.
Save listing works.
Compare flow works or placeholder is intentionally gated.
Trust badges render from backend data.
Suppressed badges do not render.
Navigation routes are reachable.
Admin moderation page works.
```

### Mobile tests

```text
Marketplace tab loads.
Listings render from API/mock service.
Listing detail opens.
Inquiry action is reachable.
Trust summary visible.
Referral code is preserved where route/deep link supports it.
```

### Minimum commands to run

Adapt as needed based on repo scripts.

```bash
node backend/tests/run-tests.js
npm run build
npm run build --workspace=web
npx tsc --noEmit --project web/tsconfig.app.json
npx playwright test web/e2e/marketplace-cards.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/marketplace-url-params.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/navbar-coverage.spec.ts --config=web/playwright.config.ts --project=chromium
```

If a command cannot run due environment limits, document exact failure and the reason.

---

## 29. Required Implementation Order

Claude must follow this order unless code inspection proves a better dependency order.

```text
1. Inspect main and open PRs #11, #72, #66, #58.
2. Confirm marketplace files and existing services.
3. Define/extend shared marketplace types.
4. Implement canonical listing summary/public DTO contract.
5. Implement or harden public listing APIs.
6. Implement inquiry API and referral event emission.
7. Implement admin moderation actions and audit trail.
8. Upgrade public web marketplace and listing detail UI.
9. Add parts marketplace v1 with PartSentry-governed badges.
10. Add garage/service marketplace v1.
11. Add Diaspora/import/container inquiry flows.
12. Add seller/owner/dealer listing management.
13. Add buyer saved/compare/inquiry activity basics.
14. Add AI listing builder and AI buyer assistant service boundaries with safe fallbacks.
15. Add price intelligence/all-in cost contract and UI.
16. Add mobile marketplace browse/detail/inquiry parity.
17. Integrate Feature Registry/navigation.
18. Add/extend backend, web, mobile, and Playwright tests.
19. Run verification commands.
20. Open PR with full report.
```

---

## 30. Non-Negotiable Safety and Quality Rules

```text
Do not leak private evidence/documents.
Do not show unapproved trust badges.
Do not show PartSentry claims without public-card eligibility.
Do not calculate rewards in marketplace code.
Do not expose sensitive Diaspora shipment details in v1.
Do not create duplicate marketplace logic for mobile.
Do not hardcode navigation if Feature Registry has the correct pattern.
Do not skip tests.
Do not merge automatically.
```

---

## 31. Claude Code `/goal` Prompt

Use this exact `/goal` prompt:

```text
/goal
You are working only in the CarUp Kimi repository: kudzimusar/carup.

Use docs/CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md as the authoritative execution brief.

Goal: Complete Marketplace v1 as a production-testable AI-governed trust marketplace that connects vehicles, parts, garages/services, dealer/supplier profiles, Diaspora/import/container inquiries, referral attribution, backend trust summaries, admin moderation, public web UI, and native mobile browse/detail/inquiry parity.

This is not UI polish. This is a production integration sprint.

Before coding, inspect current main and open PRs #11, #72, #66, and #58. PR #11 is marketplace-critical because it governs PartSentry public-card eligibility and public trust claims.

Implement the core marketplace loop:

seller creates/manages listing
→ backend validates listing eligibility
→ backend generates trust/risk summary
→ admin approves/rejects/suppresses
→ public users browse/detail/save/share/compare
→ buyer submits inquiry/quote request
→ referral attribution is captured
→ mobile consumes the same API
→ Diaspora/import/container flows create safe inquiries
→ tests prove the flow works.

Respect existing architecture: Feature Registry, route guards, listing summary services, referral engine, evidence/trust services, verification flows, and mobile app structure.

Do not merge automatically. Open a PR with implementation summary, files changed, migrations, security/privacy guarantees, test results, known limitations, and manual QA checklist.
```

---

## 32. Claude Code `/loop` Prompt

Use this exact `/loop` prompt:

```text
/loop
Continue implementing Marketplace v1 from docs/CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md until every acceptance criterion in section 28 is satisfied or until you hit a hard blocker that requires human decision.

Each loop must:

1. Inspect current git status and latest changed files.
2. State the current marketplace sub-goal.
3. Implement the smallest complete vertical slice needed next.
4. Run the relevant tests for that slice.
5. Fix failures before moving on.
6. Update or add tests when behavior changes.
7. Keep backend, web, shared types, mobile, and docs aligned.
8. Preserve safety rules: no private data leaks, no unapproved trust badges, no unsupported PartSentry claims, no referral reward calculations in marketplace code, no sensitive Diaspora shipment exposure.
9. Commit logical chunks with clear messages.
10. Stop only when Marketplace v1 acceptance criteria are met or a blocker is documented.

After each loop, report:

- What changed.
- Files touched.
- Tests run and results.
- Remaining acceptance criteria.
- Blockers or risks.
- Next loop target.

Do not merge automatically.
```

---

## 33. PR Body Template Claude Must Use

```markdown
# Marketplace v1 Production Integration Sprint

## Summary
- Completed Marketplace v1 as a production-testable AI-governed trust marketplace.
- Connected public web, mobile, backend listing APIs, inquiries, referral attribution, trust summaries, admin moderation, and Diaspora/import/container inquiry flows.

## Current State Before This PR

## Implementation Summary

## Files Changed

## Database / Migration Notes

## API Changes

## Web UI Changes

## Mobile Changes

## AI Layer Changes

## Trust / Verification / PartSentry Guarantees

## Referral / Diaspora Integration

## Security and Privacy Guarantees

## Tests Run

## Known Limitations

## Manual QA Checklist

## Follow-Up Work
```

---

## 34. Final Definition of Done

Marketplace v1 is complete only when this is true:

```text
A buyer can browse marketplace listings, open detail pages, understand backend-governed trust, save/compare/share, and submit an inquiry.

A seller/dealer/supplier can create or manage a listing and understand why it is draft, pending, public, rejected, suppressed, or archived.

An admin can approve, reject, suppress, and audit marketplace listings and risky activity.

Parts listings cannot show unsafe PartSentry claims.

Verification and trust labels are backend-generated.

Referral codes attach to marketplace actions.

Diaspora/import/container flows capture demand safely as inquiries.

Mobile consumes the same marketplace contract as web.

Tests prove the core behavior.
```

This is the benchmark for the sprint. Anything less is not complete.

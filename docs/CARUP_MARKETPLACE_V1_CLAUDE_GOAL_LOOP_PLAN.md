# CarUp Kimi Marketplace v1 Completion Sprint

**Repository:** `kudzimusar/carup`  
**Working branch target:** `feature/marketplace-v1-production-integration`  
**Document purpose:** This is the execution brief for Claude Code to use with `/goal` and `/loop` until the CarUp Kimi Marketplace v1 is implemented, tested, and ready for PR review.  
**Scope boundary:** Work only inside the CarUp Kimi repository. Do not use or modify any unrelated repository, product, or project.

---

## 0. Executive Objective

CarUp Kimi Marketplace must become the central commercial layer of the CarUp system, not just a listing page.

The goal is to complete a production-testable **Marketplace v1** where buyers can browse, trust, inquire, compare, and act on real marketplace listings, while sellers, dealers, suppliers, garages, operators, and admins can manage listings through governed backend workflows.

CarUp should compete beyond traditional marketplaces by becoming an **AI-governed trust marketplace** for:

1. vehicles,
2. parts,
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

This is marketplace-critical. It controls when PartSentry data can affect public marketplace cards. Parts marketplace work must not expose “Verified Parts,” “PartSentry Checked,” or repair-history claims unless backend governance permits it.

Required action:

1. Inspect PR #11.
2. Determine whether it is merged, mergeable, stale, or conflicting.
3. If not merged, either:
   - build this marketplace branch on top of it, or
   - port/reconcile its marketplace-critical logic into the new branch.
4. Ensure public-card eligibility, suspicion status, and trust badge suppression are enforced server-side.

### PR #72 — Admin verification review loop and mobile status refresh

This matters because marketplace verification badges must depend on backend truth, not frontend assumptions.

Required action:

1. Inspect PR #72.
2. If merged, use its backend verification status contract.
3. If not merged, design marketplace verification summaries to gracefully consume current backend truth and avoid fake verified claims.

### PR #66 — Registry-driven mobile hamburger drawer

This affects marketplace discoverability on mobile web.

Required action:

1. Inspect PR #66.
2. Ensure marketplace routes are registered through the existing Feature Registry/navigation system where possible.
3. Avoid random hardcoded marketplace links unless the existing architecture requires a temporary adapter.

### PR #58 — Diaspora shipment read access hardening

This matters if marketplace exposes import/shipment/container-space data.

Required action:

1. Inspect PR #58.
2. For Marketplace v1, do not expose sensitive shipment details.
3. Connect Diaspora to marketplace through inquiry and campaign flows first.

---

## 3. Definition of Marketplace v1 Completion

Marketplace v1 is complete when the following production-testable loop works:

```text
Seller/dealer/supplier/operator creates or exposes listing
→ Backend validates minimum public data
→ Backend calculates listing summary, trust summary, risk status, and public eligibility
→ Admin can approve/reject/suppress/request evidence
→ Public users can browse listings
→ Public users can open detail pages
→ Public users can save, share, compare, and inquire/request quote
→ Referral code/campaign attribution is captured
→ Marketplace emits structured events for referral/reward systems
→ Buyer/operator/admin dashboards can see marketplace activity
→ Mobile can browse, view detail, and inquire using the same backend contract
→ Tests verify backend, web, mobile smoke, navigation, trust suppression, and inquiry flows
```

Do **not** attempt to complete all final CarUp economy features in this sprint.

Explicitly defer full implementations of:

```text
full SafePay escrow settlement
wallet payout automation
government/CID/ZIMRA workflows
complete logistics tracking
complete AI auto-negotiation
full garage certification economy
full dealer subscription billing
full autonomous fraud resolution
full 360/AR inspection capture
```

However, the marketplace contracts must be future-ready for these.

---

## 4. Product Positioning: How CarUp Beats Benchmark Marketplaces

Traditional global automotive marketplaces are strong at listings, search, saved listings, dealer pages, financing tools, reviews, and basic buyer/seller flows.

CarUp must beat them by becoming:

```text
An AI-governed trust marketplace for vehicles, parts, services, and diaspora automotive trade.
```

CarUp’s benchmark-beating features:

1. AI Listing Builder.
2. AI Buyer Assistant.
3. AI Seller Copilot.
4. AI Admin Moderation Copilot.
5. AI Trust Summary.
6. AI Price Intelligence.
7. Transparent all-in price/l landed-cost estimate.
8. Evidence-backed vehicle trust badges.
9. PartSentry-governed parts marketplace.
10. Verified-only reviews.
11. Referral-aware social commerce.
12. Diaspora import inquiry flows.
13. Container-space interest flows.
14. Mobile guided photo/evidence capture readiness.
15. Fraud/scam detection by design.
16. Marketplace analytics command center.
17. SafePay-ready transaction intent contract.
18. One ecosystem for vehicles, parts, services, import, and referral-led trade.

---

## 5. Architectural Principle

Marketplace must be the integration spine.

Do not build Marketplace v1 as an isolated page.

Use this mental model:

```text
Feature Registry / Navigation
        ↓
Marketplace API
        ↓
Listing Summary + Eligibility + Trust/Risk Rules
        ↓
Public Web + Native Mobile
        ↓
Inquiry / Quote / Save / Share / Compare
        ↓
Referral Event + Campaign Attribution
        ↓
Admin Moderation + Trust Review + Operator Follow-up
```

Each related module connects through contracts:

```text
Navigation brings users in.
Marketplace manages listings and inquiries.
Verification/evidence/PartSentry provide trust.
Referral records attribution and rewards.
Mobile consumes the same API.
Diaspora connects through import/container inquiries.
Admin moderation controls what becomes public.
```

---

## 6. Core Data Contracts

Claude must inspect existing schema first and avoid unnecessary duplication. If tables already exist, extend them safely. If new tables are needed, create migrations with RLS-safe patterns.

### 6.1 Canonical Marketplace Listing Contract

Every public marketplace item should resolve to this shape, even if stored across multiple source tables:

```ts
export type MarketplaceListingType =
  | 'vehicle'
  | 'part'
  | 'service'
  | 'garage'
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
  source_id: string;
  title: string;
  description?: string;
  short_description?: string;
  price?: number;
  currency?: string;
  price_mode?: 'fixed' | 'negotiable' | 'quote_required' | 'estimate';
  location?: string;
  country?: string;
  seller_id?: string;
  seller_type?: 'private_seller' | 'dealer' | 'supplier' | 'garage' | 'operator' | 'admin';
  seller_summary?: MarketplaceSellerSummary;
  vehicle_summary?: MarketplaceVehicleSummary;
  part_summary?: MarketplacePartSummary;
  service_summary?: MarketplaceServiceSummary;
  import_summary?: MarketplaceImportSummary;
  diaspora_summary?: MarketplaceDiasporaSummary;
  media?: MarketplaceMedia[];
  trust_summary: MarketplaceTrustSummary;
  verification_summary: MarketplaceVerificationSummary;
  pricing_summary?: MarketplacePricingSummary;
  referral_context?: MarketplaceReferralContext;
  public_status: MarketplacePublicStatus;
  moderation_status?: string;
  risk_status: MarketplaceRiskStatus;
  risk_reasons?: string[];
  created_at: string;
  updated_at: string;
}
```

### 6.2 Seller Summary Contract

```ts
export interface MarketplaceSellerSummary {
  id: string;
  display_name: string;
  seller_type: 'private_seller' | 'dealer' | 'supplier' | 'garage' | 'operator';
  location?: string;
  country?: string;
  verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
  response_rate?: number;
  completed_transactions?: number;
  verified_reviews_count?: number;
  active_listings_count?: number;
  joined_at?: string;
  risk_status?: MarketplaceRiskStatus;
}
```

### 6.3 Trust Summary Contract

The frontend must not invent trust badges. Backend decides.

```ts
export interface MarketplaceTrustSummary {
  trust_badges: string[];
  public_badge_copy: string[];
  evidence_status?: 'none' | 'partial' | 'verified' | 'review_required';
  vehicle_passport_available?: boolean;
  identity_verified?: boolean;
  dealer_verified?: boolean;
  partsentry_public_status?: 'not_applicable' | 'eligible' | 'ineligible' | 'review_required' | 'suppressed';
  suspicion_status?: 'clear' | 'watch' | 'flagged';
  risk_status: MarketplaceRiskStatus;
  risk_reasons?: string[];
  safe_public_copy?: string;
  admin_explanation?: string;
}
```

### 6.4 Verification Summary Contract

```ts
export interface MarketplaceVerificationSummary {
  seller_verified: boolean;
  identity_status?: 'unverified' | 'pending_review' | 'verified' | 'rejected';
  vehicle_evidence_verified?: boolean;
  part_provenance_verified?: boolean;
  inspection_available?: boolean;
  inspection_verified?: boolean;
  verification_notes_public?: string[];
}
```

### 6.5 Pricing Summary Contract

```ts
export interface MarketplacePricingSummary {
  asking_price?: number;
  currency?: string;
  estimated_fair_min?: number;
  estimated_fair_max?: number;
  price_confidence?: 'low' | 'medium' | 'high';
  inspection_estimate?: number;
  local_transport_estimate?: number;
  export_import_estimate?: number;
  container_shipping_estimate?: number;
  documentation_estimate?: number;
  service_fee_estimate?: number;
  referral_discount_estimate?: number;
  estimated_total?: number;
  price_warnings?: string[];
}
```

### 6.6 Inquiry Contract

Every buyer action should become a structured inquiry.

```ts
export type MarketplaceInquiryType =
  | 'vehicle_purchase_interest'
  | 'vehicle_inspection_request'
  | 'part_quote_request'
  | 'garage_service_request'
  | 'import_quote_request'
  | 'container_space_interest'
  | 'dealer_stock_request'
  | 'sell_my_car_request'
  | 'trade_in_request'
  | 'diaspora_vehicle_request'
  | 'diaspora_parts_request'
  | 'family_purchase_support';

export interface MarketplaceInquiry {
  id: string;
  listing_id?: string;
  buyer_id?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  seller_id?: string;
  inquiry_type: MarketplaceInquiryType;
  message?: string;
  referral_code?: string;
  campaign_code?: string;
  source_channel?: 'web' | 'mobile' | 'whatsapp' | 'telegram' | 'facebook' | 'qr' | 'operator';
  status: 'new' | 'assigned' | 'contacted' | 'qualified' | 'closed' | 'spam' | 'rejected';
  assigned_operator?: string;
  risk_status?: MarketplaceRiskStatus;
  created_at: string;
  updated_at: string;
}
```

### 6.7 Referral Event Contract

Marketplace emits events. Referral engine calculates rewards.

```ts
export interface MarketplaceReferralEvent {
  event_type:
    | 'marketplace_listing_viewed'
    | 'marketplace_inquiry_created'
    | 'marketplace_quote_requested'
    | 'marketplace_inspection_requested'
    | 'marketplace_listing_paid'
    | 'marketplace_purchase_confirmed'
    | 'marketplace_service_booked'
    | 'marketplace_import_interest_created'
    | 'marketplace_container_space_interest_created';
  listing_id?: string;
  inquiry_id?: string;
  referral_code?: string;
  campaign_id?: string;
  actor_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}
```

---

## 7. Backend API Requirements

Claude must inspect existing routes and avoid breaking existing payloads. If routes already exist, extend them compatibly.

Minimum public APIs:

```text
GET    /api/marketplace/listings
GET    /api/marketplace/listings/:id
GET    /api/marketplace/categories
POST   /api/marketplace/inquiries
POST   /api/marketplace/listings/:id/save
DELETE /api/marketplace/listings/:id/save
GET    /api/marketplace/saved
POST   /api/marketplace/compare
GET    /api/marketplace/recommendations
```

Minimum seller/dealer/supplier APIs:

```text
GET    /api/marketplace/my-listings
POST   /api/marketplace/my-listings
PATCH  /api/marketplace/my-listings/:id
POST   /api/marketplace/my-listings/:id/submit-review
POST   /api/marketplace/my-listings/:id/pause
POST   /api/marketplace/my-listings/:id/archive
GET    /api/marketplace/my-listings/:id/inquiries
```

Minimum admin APIs:

```text
GET    /api/admin/marketplace/listings
GET    /api/admin/marketplace/listings/:id
PATCH  /api/admin/marketplace/listings/:id/approve
PATCH  /api/admin/marketplace/listings/:id/reject
PATCH  /api/admin/marketplace/listings/:id/suppress
PATCH  /api/admin/marketplace/listings/:id/request-evidence
PATCH  /api/admin/marketplace/listings/:id/flag-risk
GET    /api/admin/marketplace/inquiries
PATCH  /api/admin/marketplace/inquiries/:id/assign
PATCH  /api/admin/marketplace/inquiries/:id/status
GET    /api/admin/marketplace/analytics
```

AI-assist APIs may be implemented as backend services and route endpoints only if existing AI patterns support it safely:

```text
POST /api/marketplace/ai/listing-draft
POST /api/marketplace/ai/buyer-assistant
POST /api/marketplace/ai/price-estimate
POST /api/admin/marketplace/ai/moderation-summary
POST /api/marketplace/ai/share-copy
```

If AI provider integration is not fully configured, provide deterministic fallback behavior and clear `ai_unavailable` states. Never make the app fail because AI is unavailable.

---

## 8. Backend Service Requirements

Implement or extend services for:

```text
marketplaceListingService
marketplaceListingSummaryService
marketplaceEligibilityService
marketplaceInquiryService
marketplaceModerationService
marketplaceReferralBridgeService
marketplaceRecommendationService
marketplacePricingService
marketplaceRiskService
marketplaceAiAssistantService
marketplaceAnalyticsService
marketplaceSavedListingService
marketplaceCompareService
```

Do not create excessive services if equivalent services already exist. Prefer extending existing marketplace services.

Required backend behavior:

1. Public listing responses must only include safe public fields.
2. Private identity documents, private evidence URLs, raw OCR data, and raw AI risk metadata must not leak to public APIs.
3. Trust badges must be backend-generated.
4. PartSentry labels must be suppressed unless public-card eligibility allows them.
5. Suspicious/watch/flagged listings must suppress risky public claims.
6. Admin routes must require admin/reviewer/operator roles as appropriate.
7. Seller routes must require ownership or role access.
8. Referral codes must be captured but not blindly rewarded.
9. Diaspora/import/container-space flows must create inquiries, not expose sensitive shipment data.
10. AI endpoints must be advisory. Backend rules decide final status.

---

## 9. Marketplace AI Foundation

AI must be foundational, but not unsafe. It must assist; backend rules govern.

### 9.1 AI Listing Builder

Features:

1. Generate title.
2. Generate short description.
3. Generate detailed description.
4. Recommend category.
5. Recommend tags.
6. Detect missing fields.
7. Detect risky claims.
8. Suggest fair price range.
9. Generate buyer-facing summary.
10. Generate WhatsApp/social sharing copy.
11. Provide seller checklist.

Fallback:

If AI unavailable, return a deterministic template and missing-field checklist.

### 9.2 AI Buyer Assistant

Features:

1. Understand user intent.
2. Recommend listings based on budget, location, use case, and trust preference.
3. Explain trust badges.
4. Compare listings.
5. Suggest inspection.
6. Estimate landed-cost components.
7. Warn about risk factors.
8. Recommend parts/service availability.

Fallback:

If AI unavailable, provide rule-based recommendations from filters.

### 9.3 AI Price Intelligence

Features:

1. Fair price range.
2. Price confidence.
3. Unrealistic price warning.
4. Inspection estimate.
5. Local transport estimate.
6. Export/import estimate.
7. Container/shipping estimate.
8. Documentation estimate.
9. Estimated total cost.

Fallback:

Use configured static estimate bands and mark confidence as `low`.

### 9.4 AI Trust Summary

Features:

1. Explain why listing is trustworthy or risky.
2. Explain missing evidence.
3. Explain what badge means.
4. Generate public-safe trust copy.
5. Generate admin-only risk explanation.

Rules:

1. AI cannot create verification status.
2. AI cannot approve listings.
3. AI cannot override risk suppression.
4. AI cannot expose private data.

### 9.5 AI Admin Moderation Copilot

Features:

1. Summarize listing risk.
2. Summarize missing evidence.
3. Explain public badge eligibility.
4. Suggest moderation action.
5. Draft seller feedback.
6. Detect suspicious referral patterns.
7. Identify hidden fee risk or misleading price copy.

Rules:

Admin decision remains human/backend governed.

### 9.6 AI Seller Copilot

Features:

1. Explain why listing is pending.
2. Explain what evidence is missing.
3. Suggest better images.
4. Rewrite description.
5. Suggest price improvements.
6. Generate social/referral copy.
7. Warn against banned claims.

---

## 10. UI/UX Requirements

The UI already exists. Upgrade it to become CarUp benchmark-grade.

### 10.1 Public Marketplace Home

Sections:

1. Hero: “AI-governed vehicle, parts, and import marketplace.”
2. Search bar with natural-language and structured filters.
3. Category tabs:
   - Vehicles
   - Parts
   - Garages & Services
   - Dealers
   - Import to Zimbabwe
   - Container Space
4. Trust-first filter chips:
   - Verified seller
   - Evidence available
   - Inspection available
   - PartSentry eligible
   - Import-ready
   - Referral discount
5. Featured listings.
6. AI recommendations.
7. Diaspora trade cards.
8. Safety/trust explanation.
9. Referral CTA.
10. Seller CTA.

### 10.2 Listing Cards

Each card should show:

```text
title
primary image
price / quote-required
location
seller type
trust badges
risk-safe public copy
key specs
save button
compare checkbox
share button
inquiry CTA
```

Do not show trust badges unless backend supplies them.

### 10.3 Listing Detail Page

Sections:

```text
Hero image/gallery
Title, price, location
Trust summary
AI explanation
Seller/dealer profile card
Vehicle/part/service specs
Evidence/passport summary
Pricing transparency
All-in cost estimate
Inquiry/request quote form
Referral/share tools
Related listings
Safety warnings
Admin-only moderation panel when admin
```

### 10.4 Inquiry Modal/Form

Fields:

```text
name
email
phone
message
inquiry type
preferred contact channel
country/location
referral code hidden/preserved
campaign code hidden/preserved
```

Logged-in users should have prefilled profile fields where safe.

### 10.5 Compare Tool

Users can compare up to 3 or 4 listings.

Compare:

```text
price
estimated total cost
mileage/year/specs
trust badges
evidence status
seller status
inspection availability
import readiness
parts availability
AI verdict
```

### 10.6 Buyer Dashboard

Add or connect:

1. saved listings,
2. saved searches,
3. inquiries,
4. quote requests,
5. inspection requests,
6. import requests,
7. referral discounts,
8. AI buying notes.

### 10.7 Seller/Owner/Dealer Dashboard

Add or connect:

1. create listing,
2. edit listing,
3. AI listing builder,
4. submit for review,
5. status tracker,
6. evidence checklist,
7. inquiries,
8. listing performance,
9. pause/archive listing,
10. share/referral tools.

### 10.8 Admin Marketplace Command Center

Upgrade existing moderation page to show:

1. pending listings,
2. suppressed listings,
3. rejected listings,
4. flagged listings,
5. suspicious inquiries,
6. PartSentry review status,
7. price warnings,
8. seller risk,
9. referral abuse signals,
10. Diaspora/import inquiries needing operator follow-up,
11. AI moderation summary,
12. audit trail.

Admin actions:

```text
approve
reject
suppress
request evidence
flag risk
clear risk
assign inquiry
mark inquiry status
view audit trail
```

---

## 11. Vehicle Marketplace Requirements

Vehicle marketplace must support:

1. browse vehicles,
2. filter by make/model/year/price/location/mileage/fuel/transmission/body type,
3. listing detail,
4. seller/dealer card,
5. evidence/passport summary,
6. trust badges,
7. AI explanation,
8. all-in price estimate,
9. inquiry/request quote,
10. save listing,
11. compare listing,
12. share listing,
13. request inspection,
14. request import quote,
15. referral attribution.

Minimum data quality before public:

```text
title
price or quote-required
location
seller
make/model/year or acceptable fallback
at least one image
public status approved
risk status not blocked
```

---

## 12. Parts Marketplace Requirements

Parts marketplace must support:

1. browse parts,
2. part category,
3. vehicle compatibility where available,
4. condition status,
5. price or quote-required,
6. supplier/dealer profile,
7. evidence/provenance summary,
8. PartSentry public-card status,
9. suspicious-parts suppression,
10. inquiry/request quote,
11. share/referral code,
12. admin review connection.

Minimum data quality before public:

```text
part name
category
condition
seller/supplier
price or quote-required
compatibility if known
public status approved
risk status not blocked
PartSentry public-card approval where verified claims appear
```

Important rule:

```text
Never show “Verified Parts”, “PartSentry Checked”, or repair-history public claims unless backend governance explicitly allows it.
```

---

## 13. Garage and Service Marketplace Requirements

Service marketplace v1 should be basic but useful.

Support:

1. garage/mechanic profile cards,
2. service categories,
3. location,
4. verified status,
5. inspection capability,
6. request inspection/service,
7. verified-only reviews where transaction data exists,
8. admin approval/suspension.

Do not attempt full booking/payment automation unless existing infrastructure is ready.

---

## 14. Diaspora and Import Marketplace Requirements

Diaspora must connect through inquiry flows first.

Support marketplace entry points:

1. “Buy from Japan.”
2. “Import to Zimbabwe.”
3. “Request landed cost.”
4. “Reserve container interest.”
5. “Ask operator.”
6. “Share with family abroad.”
7. “Diaspora buyer quote request.”

Inquiry types:

```text
import_quote_request
container_space_interest
diaspora_vehicle_request
diaspora_parts_request
family_purchase_support
```

Do not expose private shipment data or sensitive operator data in public marketplace pages.

---

## 15. Container-Space Marketplace Lite

Container-space v1 is demand capture, not full logistics trading.

Support:

1. container-space interest cards,
2. route/campaign page,
3. origin/destination,
4. estimated departure window,
5. available capacity indicator if safe,
6. inquiry form,
7. referral code,
8. operator qualification status.

Do not build full cargo booking/settlement unless already supported safely.

---

## 16. Referral Integration Requirements

Marketplace must capture referral context from URLs and preserve it through actions.

Supported URL params:

```text
ref
referral_code
campaign
campaign_code
source
utm_source
utm_medium
utm_campaign
```

Marketplace actions should emit referral-compatible events:

```text
marketplace_listing_viewed
marketplace_inquiry_created
marketplace_quote_requested
marketplace_inspection_requested
marketplace_import_interest_created
marketplace_container_space_interest_created
```

Rules:

1. Marketplace records events.
2. Referral engine calculates rewards.
3. Marketplace does not directly release rewards.
4. Suspicious referral patterns should create review flags.
5. Referral codes should be visible enough for users to trust discounts, but not exploitable.

---

## 17. Navigation and Feature Registry Requirements

Marketplace must be discoverable through existing navigation architecture.

Routes to register or verify:

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

Navigation requirements:

1. Public homepage links.
2. Desktop navbar links.
3. Mobile web drawer links where available.
4. Dashboard route access.
5. Footer links.
6. Deep-link route tests.
7. No dead links.

Prefer Feature Registry routes over hardcoded routes.

---

## 18. Native Mobile Marketplace Requirements

Mobile must consume the same backend API as web.

Mobile v1 supports:

1. browse listings,
2. search/filter,
3. listing detail,
4. trust summary,
5. inquiry/request quote,
6. save listing,
7. referral link capture,
8. AI buyer assistant entry point,
9. basic Diaspora/import inquiry entry.

Mobile should not invent trust statuses or duplicate business logic.

Future-ready mobile seller flow:

1. AI guided photo capture,
2. image quality checks,
3. missing angle checklist,
4. evidence upload guidance,
5. AI draft listing generation.

If full seller mobile flow is too large, implement contracts and UI placeholder but ensure browse/detail/inquiry works.

---

## 19. Marketplace Trust, Safety, and Privacy Rules

Mandatory rules:

1. Public APIs expose safe public fields only.
2. Never expose raw identity documents.
3. Never expose private evidence URLs.
4. Never expose raw OCR data.
5. Never expose internal AI fraud metadata publicly.
6. Never let frontend invent verified badges.
7. Suppress suspicious listing claims.
8. Suppress PartSentry claims unless governed.
9. Require admin approval for public visibility where applicable.
10. Log moderation decisions.
11. Show public safety warnings.
12. Prevent external-link scam patterns where possible.

Public warnings:

```text
Do not pay outside CarUp.
Use verified inquiry flow.
Inspection is recommended.
Import estimates are provisional.
Public badges are evidence-based.
Report suspicious listings.
```

---

## 20. Verified Reviews and Reputation

Only allow verified reviews from real events.

Review eligibility sources:

1. completed inquiry,
2. completed inspection,
3. completed purchase,
4. completed service,
5. completed import/container transaction,
6. completed parts transaction.

Review display labels:

```text
Verified buyer
Verified service customer
Verified import customer
Verified parts buyer
```

Admin must be able to suppress suspicious reviews.

If full reviews are too large for v1, implement the data contract and visible placeholders, then defer write flow.

---

## 21. Saved Listings, Alerts, and Buyer Memory

Implement or connect:

1. save listing,
2. unsave listing,
3. saved listings page,
4. saved search contract,
5. price drop alert contract,
6. trust-improved alert contract,
7. similar listing alert contract,
8. import estimate changed alert contract.

If full notification delivery is too large, persist saved listings and define alert contracts.

---

## 22. Marketplace Analytics

Admin analytics should include:

```text
total listings
public listings
pending listings
suppressed listings
rejected listings
inquiries
quote requests
inspection requests
import inquiries
container-space interests
referral-attributed inquiries
high-risk listings
high-risk sellers
most viewed categories
most saved listings
buyer conversion rate
seller response rate
diaspora demand
parts demand
```

Analytics can be simple aggregated queries for v1.

---

## 23. SEO and Social Commerce

Marketplace should support shareable public listing URLs and referral URLs.

SEO/social requirements:

1. listing metadata,
2. Open Graph title/description/image,
3. category landing metadata,
4. vehicle make/model page metadata where feasible,
5. parts category metadata,
6. import route metadata,
7. WhatsApp share text,
8. Telegram share text,
9. Facebook share text,
10. QR-friendly share URL.

AI should generate social copy where available, with deterministic fallback.

---

## 24. SafePay-Ready Contract

Do not implement full SafePay unless existing infrastructure is ready, but make marketplace transaction-intent-ready.

Fields:

```text
transaction_intent_id
payment_readiness_status
escrow_required
deposit_allowed
operator_review_required
fraud_hold_status
```

Marketplace inquiries and quote requests should be convertible to future SafePay transaction intents.

---

## 25. Database/Migration Requirements

Claude must inspect current migrations first.

Potential tables/extensions if not present:

```text
marketplace_listings
marketplace_listing_summaries
marketplace_inquiries
marketplace_saved_listings
marketplace_listing_reports
marketplace_moderation_events
marketplace_referral_events
marketplace_price_estimates
marketplace_ai_assist_logs
marketplace_compare_sessions
marketplace_alerts
```

Do not create duplicate tables if equivalent tables already exist.

Migration rules:

1. Use idempotent-safe migration patterns where practical.
2. Preserve existing data.
3. Add indexes for listing type, status, seller, source, price, location, created_at.
4. Apply RLS where relevant.
5. Service-role-only tables for internal AI/risk/moderation logs.
6. Public access only through backend routes or safe database views.
7. Include rollback notes in PR body.

---

## 26. Implementation Phases for Claude `/loop`

### Loop 1 — Discovery and PR reconciliation

Tasks:

1. Pull latest main.
2. Inspect open PRs #11, #72, #66, #58.
3. Inspect existing marketplace files.
4. Inspect Feature Registry/navigation.
5. Inspect referral engine APIs/events.
6. Inspect mobile marketplace.
7. Inspect Diaspora/import flows.
8. Inspect evidence/verification/PartSentry logic.
9. Produce a short internal implementation map in the PR description or a doc.

Exit criteria:

```text
Current marketplace state is understood.
No duplicate work planned.
PR #11 handling strategy is decided.
```

### Loop 2 — Marketplace contracts and backend spine

Tasks:

1. Define shared marketplace types.
2. Create/extend database migrations.
3. Implement listing summary contract.
4. Implement eligibility/public-status rules.
5. Implement inquiry contract.
6. Implement referral event bridge.
7. Implement safe public response shape.
8. Add backend tests for contracts and eligibility.

Exit criteria:

```text
Backend can return safe marketplace listing summaries and create inquiries.
Trust badges are backend-generated.
Suspicious and unapproved claims are suppressed.
```

### Loop 3 — Public marketplace web upgrade

Tasks:

1. Upgrade existing Marketplace page.
2. Add category tabs.
3. Add filters/search.
4. Add listing cards.
5. Add listing detail route.
6. Add inquiry modal/form.
7. Add save/share/compare.
8. Add trust summary display.
9. Add AI buyer assistant entry points with fallback.
10. Add Diaspora/import cards.

Exit criteria:

```text
Public web users can browse, open details, save/share/compare, and inquire.
```

### Loop 4 — Seller/dealer and admin workflows

Tasks:

1. Add or connect seller listing dashboard.
2. Add AI listing builder.
3. Add status checklist.
4. Add submit-for-review flow.
5. Upgrade admin MarketplaceModeration page.
6. Add moderation actions.
7. Add AI moderation summary/fallback.
8. Add audit log display.

Exit criteria:

```text
Sellers can manage listings.
Admins can approve/reject/suppress/request evidence.
Public listings are governed.
```

### Loop 5 — Parts, services, and Diaspora verticals

Tasks:

1. Add parts marketplace category and detail support.
2. Enforce PartSentry governance.
3. Add garage/service category support.
4. Add import inquiry flows.
5. Add container-space interest flows.
6. Add operator-facing inquiry visibility where safe.

Exit criteria:

```text
Vehicles, parts, services, import, and container-space interest are supported as marketplace categories without unsafe logistics exposure.
```

### Loop 6 — Mobile parity

Tasks:

1. Upgrade mobile marketplace tab.
2. Use same backend APIs.
3. Add browse/detail/inquiry.
4. Add trust summary display.
5. Add referral capture.
6. Add basic save/share.
7. Add AI assistant entry/fallback.

Exit criteria:

```text
Mobile can browse, view details, and inquire using the same marketplace contract.
```

### Loop 7 — Analytics, SEO, safety, and polish

Tasks:

1. Add marketplace analytics.
2. Add SEO/social metadata.
3. Add safety warnings.
4. Add report listing flow.
5. Add verified-review contract or placeholder.
6. Add all-in price display.
7. Add responsive/premium UI polish.
8. Check accessibility basics.

Exit criteria:

```text
Marketplace looks and behaves like a benchmark-grade product surface.
```

### Loop 8 — Tests and acceptance hardening

Tasks:

1. Run backend tests.
2. Add/extend marketplace backend tests.
3. Run web build.
4. Run TypeScript checks.
5. Run existing marketplace Playwright tests.
6. Add listing detail/inquiry tests.
7. Add navigation route tests.
8. Add trust suppression tests.
9. Add referral event tests.
10. Add mobile smoke test where feasible.
11. Fix failures.
12. Update PR body with results.

Exit criteria:

```text
All required tests pass or known limitations are clearly documented.
Marketplace v1 is ready for review.
```

---

## 27. Required Tests

Backend tests:

```text
marketplace listing list API
marketplace listing detail API
marketplace inquiry create API
marketplace moderation approve/reject/suppress
marketplace save/unsave
marketplace compare
marketplace referral event emission
trust badge suppression
PartSentry public-card suppression
suspicious listing suppression
Diaspora inquiry creation without shipment data leak
admin authorization
seller ownership authorization
```

Web tests:

```text
marketplace cards render
marketplace URL params persist
marketplace filters work
listing detail opens
inquiry form submits
save listing works
compare listing works
referral URL captured
trust badges render only when supplied
safety warnings render
navigation deep links work
```

Mobile tests/smoke:

```text
mobile marketplace tab loads
mobile listing list renders
mobile listing detail opens
mobile inquiry path works or is safely stubbed
mobile trust summary displays backend data
```

Command examples to run or adapt:

```bash
node backend/tests/run-tests.js
npm run build
npm run build --workspace=web
npx tsc --noEmit --project web/tsconfig.app.json
npx playwright test web/e2e/marketplace-cards.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/marketplace-url-params.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/navbar-coverage.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/navbar-deeplinks.spec.ts --config=web/playwright.config.ts --project=chromium
```

Adjust commands to the repository’s actual workspace scripts.

---

## 28. Acceptance Criteria

Marketplace v1 is acceptable only when:

1. Public marketplace page is upgraded and usable.
2. Listing detail page exists.
3. Users can submit inquiries/request quotes.
4. Listings show backend-generated trust summaries.
5. Suspicious/unapproved claims are suppressed.
6. Parts marketplace respects PartSentry governance.
7. Referral attribution is captured on marketplace actions.
8. Diaspora/import/container flows create inquiries without exposing sensitive shipment data.
9. Seller/dealer listing management exists or is safely connected to existing owner/dealer pages.
10. Admin moderation can approve/reject/suppress listings.
11. Mobile marketplace can browse/detail/inquire or has clear implemented parity for core flows.
12. Navigation routes are registered and tested.
13. Backend tests pass.
14. Web build passes.
15. TypeScript checks pass.
16. Existing marketplace Playwright tests pass or are updated legitimately.
17. PR body documents files changed, tests, migration notes, security/privacy guarantees, and known limitations.

---

## 29. Non-Negotiable Engineering Rules

1. Work only in `kudzimusar/carup`.
2. Do not mix in other projects.
3. Do not break existing routes without migration adapters.
4. Do not expose private trust/evidence/identity data publicly.
5. Do not let frontend invent verification/trust labels.
6. Do not show PartSentry claims without backend public-card eligibility.
7. Do not implement fake AI success when AI provider is unavailable.
8. Do not reward referrals directly from marketplace code.
9. Do not expose sensitive Diaspora shipment data in public marketplace.
10. Do not merge automatically.
11. Commit changes logically.
12. Leave a clear PR body and testing record.

---

## 30. Suggested PR Body Template

```markdown
# Marketplace v1 Production Integration Sprint

## Summary
- Completed Marketplace v1 as an AI-governed commercial layer for vehicles, parts, services, import inquiries, container-space interest, and referral-attributed inquiries.

## Current State Before This PR
- Existing marketplace page/routes/services/tests found:
  - ...

## Implementation Summary
- Backend:
- Web:
- Mobile:
- Admin:
- AI:
- Referral:
- Diaspora:
- PartSentry/Trust:

## Files Changed
- ...

## Database / Migration Notes
- ...

## Security and Privacy Guarantees
- No private evidence URLs exposed publicly.
- No raw OCR/AI fraud metadata exposed publicly.
- Trust badges generated backend-side.
- PartSentry claims suppressed unless public-card eligible.
- Admin/seller routes protected.

## Test Results
```bash
node backend/tests/run-tests.js
...
```

## Known Limitations / Deferred Work
- Full SafePay escrow settlement deferred.
- Wallet payout automation deferred.
- Full logistics tracking deferred.
- Full AI auto-negotiation deferred.

## Manual QA Checklist
- [ ] Public marketplace browse
- [ ] Listing detail
- [ ] Inquiry submission
- [ ] Save listing
- [ ] Compare listings
- [ ] Referral URL capture
- [ ] Admin moderation
- [ ] Seller listing management
- [ ] Parts governance suppression
- [ ] Mobile browse/detail/inquiry
```

---

## 31. Claude `/goal` Prompt

Use this as the `/goal` input:

```text
/goal Build CarUp Kimi Marketplace v1 as a production-testable AI-governed trust marketplace inside only the `kudzimusar/carup` repository. Treat marketplace as the central commercial integration spine connecting existing marketplace UI, backend listing-summary/eligibility services, Feature Registry/navigation, referral attribution, PartSentry governance, verification/evidence trust, native mobile marketplace, and Diaspora/import inquiry flows.

Complete the core marketplace loop end-to-end: public users can browse listings, open listing detail pages, see backend-generated trust summaries, save/share/compare listings, and submit inquiries or quote requests. Sellers/dealers/suppliers can create or manage listings and submit them for review. Admins can approve, reject, suppress, request evidence, review risk, and monitor marketplace inquiries. Parts marketplace must respect PartSentry public-card eligibility. Referral codes/campaigns must be captured and emitted as events, but rewards must remain owned by the referral engine. Diaspora/import/container flows should be implemented as inquiry flows, not full logistics trading.

Make the marketplace AI foundational: add AI listing builder, AI buyer assistant, AI seller copilot, AI admin moderation summary, AI trust explanation, AI price/all-in-cost estimate, and AI share-copy generation where the existing architecture supports it. If AI provider integration is unavailable, implement deterministic fallback behavior and visible `ai_unavailable` states without breaking the product.

Do not implement full SafePay escrow, wallet payout automation, government/CID/ZIMRA flows, full logistics tracking, full AI auto-negotiation, or dealer subscription billing in this sprint. Make the contracts future-ready only.

Before coding, inspect open PRs #11, #72, #66, and #58 and reconcile their marketplace impact. PR #11 is marketplace-critical for PartSentry public-card governance. Use existing routes, services, migrations, tests, Feature Registry patterns, and UI components where possible. Do not duplicate existing systems unnecessarily.

Acceptance requires backend tests, web build, TypeScript checks, marketplace Playwright tests, navigation/deep-link tests, trust suppression tests, referral event tests, and a clear PR body with files changed, migrations, security/privacy guarantees, test results, and known limitations. Do not merge automatically.
```

---

## 32. Claude `/loop` Prompt

Use this after setting the goal:

```text
/loop Continue implementing the CarUp Marketplace v1 Completion Sprint until the acceptance criteria are met. Work in disciplined loops:

1. Discover current marketplace, navigation, referral, mobile, verification, PartSentry, and Diaspora code. Inspect PRs #11, #72, #66, and #58. Decide how to reconcile PR #11 before parts marketplace trust claims are exposed.

2. Implement or extend the canonical marketplace contracts, database migrations, listing summary, public eligibility, trust/risk suppression, inquiry model, referral event bridge, saved listings, compare, and analytics services.

3. Upgrade the public web marketplace UI into a benchmark-grade experience: category tabs, filters, premium listing cards, listing detail page, trust summary, AI buyer assistant, all-in price estimate, inquiry form, save/share/compare, safety warnings, and Diaspora/import entry points.

4. Add seller/dealer/supplier listing management: create/edit listing, AI listing builder, evidence checklist, submit for review, status tracking, inquiries, pause/archive, and share/referral tools.

5. Upgrade admin marketplace moderation into a command center: pending/flagged/suppressed listings, approve/reject/suppress/request evidence, AI moderation summary, PartSentry governance state, risk reasons, referral abuse indicators, Diaspora inquiries, analytics, and audit trail.

6. Implement vehicles, parts, garages/services, import requests, and container-space interest as marketplace categories. Parts must obey PartSentry public-card eligibility and suspicious-claim suppression. Diaspora/import/container flows must create inquiries without exposing sensitive shipment data.

7. Upgrade native mobile marketplace to consume the same backend APIs for browse, detail, trust summary, inquiry, save/share, referral capture, and AI assistant entry point. Do not create separate mobile marketplace business logic.

8. Add SEO/social/referral share support, verified-review contract or placeholder, reporting, safety warnings, and SafePay-ready transaction intent fields where appropriate.

9. Run and fix tests: backend tests, web build, TypeScript checks, marketplace Playwright tests, navigation/deep-link tests, trust suppression tests, referral event tests, and mobile smoke checks where feasible.

10. Stop only when the marketplace v1 acceptance criteria pass or when a blocker is documented with exact file paths, failing commands, and the smallest next corrective action.

After each loop, summarize what changed, what tests passed/failed, what remains, and the next loop target. Keep commits logical and update the PR body as implementation evidence. Do not merge automatically.
```

---

## 33. Final Instruction to Claude

This is not a cosmetic marketplace enhancement. This is a production integration sprint.

The final output must make CarUp Marketplace feel like the central product layer of the system:

```text
AI-guided buying.
AI-assisted selling.
Backend-governed trust.
Evidence-backed public claims.
PartSentry-safe parts listings.
Referral-aware growth.
Diaspora-ready trade flows.
Mobile-ready consumption.
Admin-controlled public visibility.
```

Finish the core loop first. Defer advanced economy features only where necessary, but leave contracts ready for them.

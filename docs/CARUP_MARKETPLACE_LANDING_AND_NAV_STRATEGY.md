# CarUp Marketplace Landing and Navigation Strategy

## Phase 1 Homepage Scope

Phase 1 converts the public homepage into a marketplace-first landing page while using only existing frontend code, existing mock vehicle data, and existing routes.

The routed homepage is `web/src/pages/Landing.tsx`, served at `/`. The unused `web/src/pages/Home.tsx` remains untouched.

Phase 1 goals:

- Show that CarUp is a verified automotive marketplace for Zimbabwe.
- Let buyers start shopping from the homepage.
- Let users verify a car by plate, VIN, or chassis through the existing Vehicle Detail/Passport route.
- Let sellers start the current seller handoff without creating a fake public `/sell` route.
- Keep CarUp's trust differentiation visible: Passport, plate identity, owner privacy, trust score, SafePay, and evidence timeline.

Phase 1 routes:

| Intent | Current Route | Notes |
|---|---|---|
| Buy cars | `/marketplace` | Existing marketplace surface. |
| Search / verify | `/search` | Existing mock-backed search surface. |
| Open Passport | `/marketplace/:identifier` | Existing Vehicle Detail route performs passport lookup. |
| Start selling | `/register` or `/dashboard/sell-vehicle` | Public seller route does not exist yet. |
| Dealers | `/dealers` | Existing public directory. |
| Garages | `/garages` | Existing public directory. |
| Insurance | `/insurance` | Existing public directory. |
| Pricing | `/pricing` | Existing public pricing page. |

Phase 1 does not add `/buy`, `/sell`, `/verify`, `/finance`, or `/how-it-works` routes.

## Navigation Strategy

The public nav should lead with marketplace actions:

| Label | Route | Phase 1 Status |
|---|---|---|
| Buy Cars | `/marketplace` | Active |
| Verify | `/search` | Active, with current mock limitations |
| Dealers | `/dealers` | Active |
| Garages | `/garages` | Active |
| Insurance | `/insurance` | Active |
| Pricing | `/pricing` | Active |
| Sell | `/register` or `/dashboard/sell-vehicle` | CTA/handoff, not a public route |

Footer product language should mirror the same strategy: Buy Cars, Verify Vehicle, Dealers, Garages, Insurance, and Pricing.

## Homepage Visual Polish & Seller Conversion Sprint

This sprint adjusts the first viewport so the homepage reads as a balanced marketplace, not only a buyer search page. The hero now gives equal visual weight to Buy a Car, Sell My Car, and Verify a Car while preserving the existing frontend-only route handoffs.

Seller above-the-fold requirement:

- A persistent seller callout appears in the hero even when the Buy tab is active.
- Copy: "Selling your car?" and "Start with your plate or VIN and create a trusted Passport listing."
- CTA: "Start Selling"
- Route: `/register` for public users, with `/dashboard/sell-vehicle` preserved only through the existing authenticated handoff.
- No `/sell` route is introduced.

Final hero copy:

- Headline: "Find Verified Cars. Sell With Confidence."
- Subheadline: "CarUp helps buyers and sellers build trust with vehicle Passports, plate checks, owner privacy, trust scores, and evidence-backed timelines."

Final nav recommendation:

| Label | Route | Purpose |
|---|---|---|
| Buy Cars | `/marketplace` | Primary buyer marketplace. |
| Verify | `/search` | Current public verification/search entry. |
| Dealers | `/dealers` | Dealer discovery. |
| Garages | `/garages` | Garage discovery. |
| Insurance | `/insurance` | Insurance discovery. |
| Pricing | `/pricing` | Pricing page. |
| Sell Your Car | `/register` | Strong orange seller CTA and public handoff. |

Final homepage section order:

1. Hero: Buy / Sell / Verify
2. Thin trust strip
3. Featured verified cars
4. Sell with a Passport
5. Verify before you buy
6. Popular Zimbabwe categories
7. How CarUp works
8. Why CarUp is safer

Visual polish decisions:

- Use one main white/glass hero action panel.
- Use flatter tab styling with equal Buy, Sell, and Verify actions.
- Keep one large featured vehicle card on the right.
- Replace boxed trust cards with a thin trust strip.
- Move category chips below the hero/trust strip so they do not dominate the first viewport.
- Use only existing vehicle images and continue linking featured cards to VIN-based Passport routes.

Phase 2 remains backend category/tag and search/ranking work. Canonical condition categories, marketplace tags, listing summary fields, featured listing queries, and backend-supported category search should not be implemented in this frontend polish sprint.

## Navigation, Parts Commerce & PartSentry Strategy

This sprint corrects the public navigation architecture so CarUp reads as a verified automotive commerce platform, not only a vehicle listing site.

Why Sell must be top-level:

- Selling is a primary commercial intent, equal to buying and verification.
- Sellers need a visible handoff into the existing `/register` or authenticated `/dashboard/sell-vehicle` flow.
- There is still no public `/sell` route, so all public seller links route safely to existing handoffs.

Why Insurance and Pricing move to More:

- Insurance and Pricing are useful support pages, but they are not the highest-intent buying, selling, parts, or verification actions.
- Keeping them in More frees top-nav space for Parts and PartSentry.
- Existing routes remain intact: `/insurance` and `/pricing`.

Buy dropdown structure:

- Vehicles: Shop All Cars, Brand New Cars, Recently Imported, Locally Used, Second Hand Cars, Dealer Verified Cars, Passport Verified Cars.
- Popular Categories: SUVs, Pickups, Hatchbacks, Sedans, Toyota, Honda, Mazda, Under $5,000, Under $10,000.
- Buyer Tools: Verify Before You Buy, View Vehicle Passport, Compare Trust Scores, PartSentry Checked Vehicles.
- Trust Guide: Brand New vs Imported vs Locally Used, and how to check a vehicle Passport before paying.

Sell dropdown structure:

- Sell Vehicles: Sell Your Car, Create Vehicle Passport, Dealer Listing, Sell as Private Owner.
- Seller Tools: Start with Plate / VIN, Upload Vehicle Evidence, Add Service History, SafePay / Reservation Ready.
- Sell Parts & Accessories: Sell Car Parts, Sell Accessories, Mechanic / Garage Parts Listing.
- Seller Guide: How to sell with a verified Passport, and how PartSentry protects honest sellers.

Verify dropdown structure:

- Vehicle Verification: Verify by Plate, VIN, Chassis, or open a Vehicle Passport.
- Trust Checks: ownership privacy, evidence timeline, duty/CID signals where available, and mileage signals.
- PartSentry Verification: part history, repair logs, swapped parts, and stolen/suspicious parts checks.

Parts dropdown structure:

- Buy Parts: Browse Car Parts, Verified Parts, Engines, Gearboxes, ECUs, Body Panels, Lights, Tyres & Wheels, Batteries, Accessories.
- Sell Parts: Sell a Part, List Accessories, Garage Parts Inventory, Mechanic Parts Catalog.
- PartSentry: Verify Part Origin, Check Repair History, Report Stolen Part, Link Part to Vehicle Passport, Mechanic Work Orders.
- Parts Trust Guide: how PartSentry protects parts buyers and why verified parts matter when buying used cars.

What PartSentry does:

PartSentry helps identify swapped, stolen, or undocumented parts by connecting repair logs, work orders, mechanics, and parts history to the vehicle Passport.

Why PartSentry is core to CarUp:

- Vehicle trust does not stop at ownership and plate history.
- Repairs, replacement parts, work orders, and mechanic logs affect resale confidence.
- Parts commerce needs a trust layer so buyers and honest sellers can distinguish documented parts from suspicious parts.

Where PartSentry appears now:

- Top-level `Parts` navigation.
- Buy, Sell, Verify, and Parts dropdown language.
- Homepage trust strip and "Why CarUp is safer" section.
- Marketplace category strip.
- Marketplace listing cards only when explicit PartSentry data exists.
- `/search` copy as a verification entry point for vehicle or part history.

Phase 2B remains:

- Public Parts Marketplace route and inventory browsing.
- Canonical PartSentry public lookup route.
- Backend-supported parts categories, parts listings, work orders, repair logs, suspicious/stolen part reporting, and search/ranking.
- Real listing summary fields for PartSentry, evidence count, verified parts, and repair history.

Public Parts Marketplace remains future work unless a dedicated `/parts` route and supporting data/API are approved.

## Marketplace Category, PartSentry & Verified Listing Cards Sprint

Implemented marketplace card changes:

- Listing cards show image, make/model/year, price, location, mileage, condition/category labels, trust score, verification badge, plate status where available, seller/dealer type, and a View Passport CTA.
- Marketplace card links use `/marketplace/:vin` whenever VIN exists.
- Private owner names and phone numbers are not shown on marketplace listing cards.
- Marketplace search now includes make, model, location, VIN, plate number, normalized plate number, chassis number, condition, category, seller name/type, and PartSentry text only when current data provides it.
- A visible marketplace category strip appears near the top of `/marketplace`.
- Existing API data remains the primary source, with existing mock vehicles used as a frontend fallback when local API fetches are unavailable.

Safely derived labels:

- Brand New: from `condition === "New"`.
- Second Hand: from `condition === "Used"`.
- Dealer Verified: from dealer/dealership seller context plus current verification, or `Certified Pre-Owned`.
- Duty Cleared: from `duty_paid === true`.
- Low Mileage: frontend-derived from mileage at or below 50,000 km. This does not imply verified mileage.
- Recently Imported / Fresh Import: from an explicit import source when present.
- Locally Used: from explicit Zimbabwe registration country when present.

Backend-dependent labels:

- Passport Verified requires a real `passport_verified` style listing summary field.
- Evidence Available requires evidence count or evidence summary on the listing payload.
- PartSentry Checked requires explicit PartSentry data.
- Repair History Available requires service or repair records on the listing payload.
- Verified Parts requires explicit parts verification data.

PartSentry display rules:

- The navigation and homepage can explain PartSentry as a CarUp trust product.
- Marketplace card badges only display `PartSentry Checked` when the listing data includes an explicit PartSentry signal.
- Search text only includes PartSentry terms when current listing card data includes PartSentry or repair-history signals.

No fake evidence rule:

- Listing images are not evidence.
- Cards do not show `Evidence Available` unless evidence count or evidence summary data exists.

No fake PartSentry status rule:

- Cards do not show `PartSentry Checked`, `Repair History Available`, or `Verified Parts` unless corresponding data exists.
- Public Parts Marketplace and backend category/search/ranking remain Phase 2B.

## Zimbabwe Category Model

The intended marketplace category model is:

- Brand New
- Recently Imported
- Fresh Import
- Locally Used
- Second Hand
- Dealer Verified
- Passport Verified

In Phase 1, these are frontend quick-entry labels and homepage discovery chips only. They are not canonical backend filters yet.

## Phase 2 Backend Category/Tag Scope

Phase 2 should define the durable data model and search behavior for category and trust tags.

Recommended backend/category work:

- Add a canonical `vehicle_condition_category` model for Brand New, Recently Imported, Fresh Import, Locally Used, Second Hand, and unknown/fallback cases.
- Add canonical marketplace tags for Passport Verified, Plate Verified, Dealer Verified, Duty Cleared, ZIMRA Verified, CID Clear, Low Mileage, SafePay Ready, Inspection Ready, and Recent Service.
- Add card-ready listing summaries for `trust_score`, `plate_verified`, `passport_verified`, verified evidence count, seller type, and dealer verification.
- Add backend-supported search/ranking across make, model, location, price, mileage, plate, VIN, chassis, trust score, evidence count, category, and tags.
- Add a featured verified vehicles endpoint or query contract so the homepage can stop using mock data.

## Backend Category, PartSentry & Listing Summary Infrastructure Sprint

Implemented infrastructure direction:

- Added a canonical `vehicles.vehicle_condition_category` field with `brand_new`, `recently_imported`, `locally_used`, `second_hand`, `certified_dealer`, and `unknown`.
- Added explicit backend fields for `passport_verified`, `zimra_verified`, `safe_pay_ready`, and `inspection_ready` so marketplace cards do not infer those claims from unrelated data.
- Added explicit PartSentry public-card fields on `partsentry_logs`: `verification_status`, `part_verification_status`, `suspicion_status`, and `public_card_eligible`.
- Added `vehicle_listing_summaries` as the future materialized listing-card table with RLS-enabled public reads for marketplace-visible statuses.
- Added `GET /api/marketplace/listings` as the public card-summary endpoint. It computes summaries live from `vehicles`, public verified `vehicle_evidence`, public-eligible `partsentry_logs`, `vehicle_ownership_history`, and `listing_images` where available.
- Added frontend hook support through `fetchMarketplaceListings()`. `/marketplace` now tries the summary endpoint first, falls back to the existing `/api/vehicles` endpoint, and finally falls back to local mock data.

Privacy rules implemented in the summary contract:

- Private sellers are returned as `Private seller`.
- Public listing summaries do not return seller phone numbers, emails, owner ids, or private user names.
- Dealer names are only eligible when dealer context exists and `public_seller_display_enabled` is true; otherwise the safe label is `Verified dealer`.

Trust-signal rules implemented in the summary contract:

- `Evidence Available` is backed only by verified `vehicle_evidence` rows with `visibility_level = "public_safe"`.
- `PartSentry Checked` requires explicit public-card eligibility plus `verification_status = "verified"`.
- `Verified Parts` requires explicit public-card eligibility plus `part_verification_status = "verified"`.
- `Passport Verified`, `ZIMRA Verified`, `SafePay Ready`, and `Inspection Ready` require explicit backend fields.
- Listing images remain listing media only. They are not treated as evidence.

Hybrid summary recommendation:

- Phase 2B can continue with live computation while the data volume is small.
- The `vehicle_listing_summaries` table should become the materialized source once write-side refresh jobs are added for vehicle, evidence, PartSentry, ownership, and image changes.
- Search/ranking can initially filter the computed summaries, then move to indexed summary-table reads using `marketplace_tags` and `search_vector`.

Deferred backend work:

- Refresh workers or database triggers that maintain `vehicle_listing_summaries`.
- Admin/dealer workflows to set `passport_verified`, `zimra_verified`, `safe_pay_ready`, `inspection_ready`, and canonical condition category.
- Dedicated public Parts Marketplace route and parts inventory API.
- Verified parts provenance beyond explicit PartSentry verification fields.
- Advanced search ranking, pagination cursors, and featured-listing scoring.

## Evidence and Image Policy

Phase 1 uses existing local listing images from `web/src/data/mockData.ts` and `/images/vehicles`.

Listing images are not Evidence Vault proof. Do not display them as verified historical evidence, import evidence, inspection proof, or government-approved proof unless the data explicitly supports that claim.

Generated imagery is not used in Phase 1.

## Test Strategy

Phase 1 homepage coverage should verify:

- The new homepage headline loads.
- Buy, Verify, and Sell tabs switch.
- Buy search routes to the current marketplace/search surface.
- Verify lookup routes to `/marketplace/:identifier`.
- Sell lookup routes to the current seller handoff.
- Featured vehicle cards link to `/marketplace/:vin`, not mock IDs.
- Popular search chips render.
- The trust strip renders.
- Private owner names and phone numbers from mock vehicles do not appear on the homepage.

Target verification commands:

```bash
npm run build --workspace=web
npx playwright test web/e2e/homepage.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/plate-privacy.spec.ts --config=web/playwright.config.ts --project=chromium
npx playwright test web/e2e/evidence-timeline.spec.ts --config=web/playwright.config.ts --project=chromium
```

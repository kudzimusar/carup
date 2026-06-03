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

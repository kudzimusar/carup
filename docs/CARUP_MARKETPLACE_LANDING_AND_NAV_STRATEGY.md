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

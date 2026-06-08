# CarUp Real Listing Eligibility Contract

The shared, pure definition of what makes a vehicle a **real, public, marketplace-eligible** listing.

- Helper: [`backend/services/marketplace/marketplaceListingEligibility.js`](../backend/services/marketplace/marketplaceListingEligibility.js)
- Tests: [`backend/tests/marketplace-listing-eligibility.test.js`](../backend/tests/marketplace-listing-eligibility.test.js)
- Reuses the merged fixture detector `getFixtureExclusion()` (one source of truth for "is this a fixture").

## 1. Why this exists

The public marketplace now hides seed/demo/integration fixtures by default (PR #39), so production
returns **0 listings** until real inventory exists. Before onboarding real listings — and before
wiring any category nav links — we need one place that decides whether a row is a genuine listing
or junk. This module is that contract. It is **pure and read-only**: it makes no DB writes and is
not yet wired into the creation endpoint (see §5).

## 2. Minimum real listing contract

A vehicle is **marketplace-eligible** only when **all** hold (`getListingEligibility(v).eligible === true`):

| Rule | Requirement | Reason code on failure |
|---|---|---|
| VIN | 17 chars, `[A-HJ-NPR-Z0-9]`, no `I/O/Q`, no `_`, no synthetic prefix | `invalid_vin_format` |
| Not a fixture | `getFixtureExclusion(v) === null` | `fixture_excluded` |
| Make / Model | non-empty, not a placeholder (`Test`, `demo`, …) | `placeholder_make` / `placeholder_model` |
| Year | integer in `[1980, currentYear+1]` | `invalid_year` |
| Price | `> 0` | `invalid_price` |
| Status | public (`Available` / `Reserved`, via `isPublicVehicleStatus`) | `non_public_status` |
| Ownership (private) | real non-seed `owner_id` | `missing_owner_for_private_listing` / `seed_owner_id` |
| Ownership (dealer) | real non-default `tenant_id` | `missing_tenant_for_dealer_listing` / `seed_tenant_id` |
| Import source | local-safe/absent OR a real import source; never poisoned junk | `invalid_import_source` |
| Registration country | present | `missing_registration_country` |
| Seller type | known (`Private Owner` / `Dealer` / `Dealership`) | `unknown_seller_type` |

`getListingEligibility(vehicle, { maxYear? })` returns `{ eligible, reasons[], warnings[], normalized }`.
`assertMarketplaceEligible()` throws a `MARKETPLACE_INELIGIBLE` error (with `.reasons`) when ineligible.

## 3. Four distinct states (do not conflate)

- **Fixture / demo / test data** — synthetic/invalid VIN, seed `owner_id` (`u3`), nil/default
  `tenant_id`. Detected by `getFixtureExclusion`; **never** eligible; hidden from public marketplace.
- **Incomplete listing** — a would-be real row missing required fields or with placeholders
  (`make='Test'`, `price<=0`, no registration country). Ineligible until completed.
- **Eligible public listing** — passes every rule above. Appears in the public marketplace and is a
  valid candidate for classification (condition category).
- **Governed trust claim** — `passport_verified`, `partsentry_checked`, `vehicle_condition_category`
  (`brand_new`/`second_hand`), ZIMRA/CID, etc. These are **separate** and are **not** granted by
  eligibility (see §4).

## 4. Eligibility does NOT grant trust claims

Being a real, eligible listing only means "this is a genuine vehicle that may appear publicly." It
does **not** assert anything verified. In particular it never sets or implies:

- `passport_verified` — requires a governed trust-fact approval over verified evidence.
- `partsentry_checked` — requires verified PartSentry review + public-card eligibility.
- `brand_new` / `second_hand` — governed condition claims, never auto-inferred.

Only `locally_used` / `recently_imported` are auto-classifiable, and only **after** a row is eligible
(real) — see the classification rules + backfill machinery. Keep listing eligibility and trust claims
strictly separate.

## 5. How `POST /api/vehicles/add` should use this (next phase — not wired here)

Intended integration (a later, separately reviewed PR):

```js
import { assertMarketplaceEligible } from '../services/marketplace/marketplaceListingEligibility.js';
// inside the handler, after assembling the candidate row (owner_id/tenant_id from auth context):
assertMarketplaceEligible(candidate); // -> 400 with reasons[] when ineligible
```

Alongside the guard, the creation flow should also:
- **set `owner_id`** for private sellers (currently left NULL),
- **accept a validated `import_source`** instead of hardcoding `'Local'` (so real imports →
  `recently_imported`),
- keep `status='Available'` only for eligible rows,
- reject fixture/test VINs at creation so they never enter production.

This is deliberately **not** done in this PR — the helper + tests + contract land first; the route
wiring (which changes creation behavior in a large file) is the next phase.

## 6. How real inventory unlocks nav links

1. Onboard real listings (private/dealer/import) that pass this contract.
2. Run the read-only classification dry-run → category coverage on **real** data.
3. When a category/tag reaches **≥ 3** real, eligible listings, it clears the coverage gate.
4. Only then wire that category/tag's Buy-menu nav link (the Phase 2.1 pattern), one per proven
   target. Until then, links stay deferred.

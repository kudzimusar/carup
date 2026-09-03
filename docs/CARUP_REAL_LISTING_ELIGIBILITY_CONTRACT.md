# CarUp Real Listing Eligibility Contract

The shared, pure definition of what makes a vehicle a **real, public, marketplace-eligible** listing.

- Helper: [`backend/services/marketplace/marketplaceListingEligibility.js`](../backend/services/marketplace/marketplaceListingEligibility.js)
- Tests: [`backend/tests/marketplace-listing-eligibility.test.js`](../backend/tests/marketplace-listing-eligibility.test.js)
- Reuses the merged fixture detector `getFixtureExclusion()` (one source of truth for "is this a fixture").

> **Corrected 2026-09-03 (Operations Control Plane closure).** Two rows of the table in §2 had
> drifted from the helper and were reconciled against the code:
>
> - **Vehicle identifier** — the doc said "17 chars, `[A-HJ-NPR-Z0-9]`, no `I/O/Q`". The helper's
>   rule is `VALID_VEHICLE_IDENTIFIER_RE = /^[A-Z0-9-]{12,17}$/i`: documented import frame/chassis
>   identifiers are valid alongside ISO VINs. The live counter-example is the real UAT vehicle
>   `GFC27-027051` (12 characters, hyphenated) — a published Japanese import that the stale rule
>   would have declared ineligible. CarUp never fabricates a 17-character VIN for an import.
> - **Registration country** — the doc listed a blocking `missing_registration_country` reason code.
>   That code was removed from the helper because it could never fire, and absence is now the
>   non-blocking warning `registration_country_absent`: the column is nullable, so "not known" is
>   recordable and must not refuse a legitimate sale.

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
| Vehicle identifier | **12–17 chars**, `[A-Z0-9-]`, no synthetic prefix (`vin`/`test`/`demo`/`seed`/…) | `invalid_vin_format` |
| Not a fixture | `getFixtureExclusion(v) === null` | `fixture_excluded` |
| Make / Model | non-empty, not a placeholder (`Test`, `demo`, …) | `placeholder_make` / `placeholder_model` |
| Year | integer in `[1980, currentYear+1]` | `invalid_year` |
| Price | `> 0` | `invalid_price` |
| Status | public (`Available` / `Reserved`, via `isPublicVehicleStatus`) | `non_public_status` |
| Ownership (private) | real non-seed `owner_id` | `missing_owner_for_private_listing` / `seed_owner_id` |
| Ownership (dealer) | real non-default `tenant_id` | `missing_tenant_for_dealer_listing` / `seed_tenant_id` |
| Import source | local-safe/absent OR a real import source; never poisoned junk | `invalid_import_source` |
| Registration country | absence is a WARNING, not ineligibility — the column is nullable, so "not known" is recordable | warning `registration_country_absent` |
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

## 5. How `POST /api/vehicles/add` uses this (WIRED)

The route builds the exact candidate row, validates it, and rejects ineligible input **before** insert:

```js
const candidate = buildVehicleListingCandidate({ body: req.body, userContext: req.userContext });
const eligibility = getListingEligibility(candidate);
if (!eligibility.eligible) {
  return res.status(400).json({ error: 'Listing is not marketplace-eligible', reasons: eligibility.reasons });
}
// ... existing duplicate-VIN 409 check, then insert FROM the candidate
```

Ownership mapping (`buildVehicleListingCandidate`, from `req.userContext.role`):
- **owner** → `owner_id = userContext.id`, `tenant_id = null`, `current_seller_type = 'Private Owner'`.
- **dealer** → `tenant_id = userContext.tenantId`, `owner_id = null`, `current_seller_type = 'Dealer'`.
- **admin/other** → `owner_id`/`tenant_id`/`current_seller_type` from the body (tenant falls back to
  context). With no real owner *and* no real tenant, eligibility rejects it (no orphan public listings).

Other behavior:
- `owner_id` is now **set on `vehicles`** for private listings (previously left NULL).
- `import_source` is taken from the request body and validated; it defaults to `'Local'` **only when
  omitted** (so real imports → `recently_imported`). `'Test'`/junk is rejected.
- `registration_country` defaults to `'ZW'` (the existing DB default) only when omitted.
- `status` stays `'Available'`; the **duplicate-VIN 409** and `authorizeRole` behavior are unchanged.

**Known limitation (admin/dealer):** a dealer using the only seeded tenant (`…0001`) is correctly
rejected (`seed_tenant_id`) — real dealer onboarding needs a real, non-default tenant. Admins must
supply explicit owner/tenant context or the listing is rejected as an orphan.

## 6. How real inventory unlocks nav links

1. Onboard real listings (private/dealer/import) that pass this contract.
2. Run the read-only classification dry-run → category coverage on **real** data.
3. When a category/tag reaches **≥ 3** real, eligible listings, it clears the coverage gate.
4. Only then wire that category/tag's Buy-menu nav link (the Phase 2.1 pattern), one per proven
   target. Until then, links stay deferred.

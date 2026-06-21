# Navigation Intelligence — Marketplace Truth & Coverage

> **Scope notice — read first.** This document covers **only** the **Marketplace Navigation Truth & Coverage subsystem** — a single dependency of the larger CarUp Navigation Intelligence system, not the system itself. It specifies Marketplace URL truth/coverage behavior: the query-parameter contract (`q`/`make`/`category`/`tag`/`minPrice`/`maxPrice`/`sort`), fixture exclusion, real-listing eligibility, and coverage-gated navigation.
>
> The **full Navigation Intelligence system** — the desktop top-nav, footer, mobile web navigation, route boundaries, feature lifecycle/rollout governance, and the admin **Feature Governance Console** — is specified in the master plan at [`docs/implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md`](../implementation-plans/CARUP_NAVIGATION_INTELLIGENCE_BLUEPRINT_COMPLETION_PLAN.md) and the architecture document at [`docs/navigation-intelligence/CARUP_NAVIGATION_INTELLIGENCE_ARCHITECTURE.md`](../navigation-intelligence/CARUP_NAVIGATION_INTELLIGENCE_ARCHITECTURE.md). Those documents are the source of truth for the system as a whole.
>
> Where this file says **"completed"**, that status refers **only to the Marketplace coverage substrate** documented here — not to the broader Navigation Intelligence system, which is still being implemented.

Navigation Intelligence is a completed CarUp system capability that ensures marketplace navigation reflects actual eligible inventory rather than fixture, demo, seed, or unsupported data.

---

## 1. Purpose

Navigation Intelligence ensures that every navigation link, category, and tag in the CarUp marketplace is backed by real, eligible inventory in the current environment.

**Governing rule:**

> Navigation → real filters → real marketplace data → real user trust

A Marketplace category or tag must not be promoted unless the current environment has enough eligible inventory to support it. If a category lacks sufficient inventory, the navigation link defers gracefully rather than leading users to empty results.

---

## 2. Business Objective

Navigation Intelligence prevents:

- **Empty category pages** — users clicking a category and finding zero results
- **Misleading navigation** — links that imply availability where none exists
- **Fixture-inflated coverage** — seed/demo/test data artificially activating categories
- **Fake inventory promotion** — navigation suggesting vehicles that are not real listings
- **Inconsistent staging and production behavior** — categories active in staging but empty in production
- **Loss of marketplace trust** — users losing confidence in the platform's reliability

---

## 3. Marketplace URL Contract

The Marketplace supports the following query parameters:

| Parameter | Purpose |
|-----------|---------|
| `q` | Free-text search |
| `make` | Filter by vehicle make |
| `category` | Filter by marketplace category |
| `tag` | Filter by marketplace tag |
| `minPrice` | Minimum price filter |
| `maxPrice` | Maximum price filter |
| `sort` | Sort order |

Active-filter chips render in the Marketplace UI for each applied filter. All filters synchronize bidirectionally with the URL — applying a filter updates the URL, and loading a URL with query parameters activates the corresponding filters and chips.

---

## 4. Fixture Exclusion

Fixture, demo, test, and integration vehicles are **excluded from public Marketplace results by default**.

### Fixture Indicators

| Indicator | Description |
|-----------|-------------|
| Synthetic VIN prefixes | VINs beginning with known test prefixes |
| Invalid VIN structure | VINs that fail format or check-digit validation |
| Seed owner IDs | Owner IDs associated with seed/demo accounts |
| Default or nil tenant IDs | Tenant IDs that are null, default, or placeholder values |
| Test or invalid import sources | Import sources flagged as test, demo, or integration |

### MARKETPLACE_SHOW_FIXTURES

`MARKETPLACE_SHOW_FIXTURES` is an explicit development/demo override that, when enabled, includes fixture data in Marketplace results.

**This flag must not normally be enabled in production.** It exists solely for local development and demo environments where fixture data visibility is required for testing.

---

## 5. Listing Eligibility

The production listing eligibility contract validates every vehicle before it appears in the public Marketplace. Vehicle creation enforces eligibility before insertion.

### Validation Outcomes

| Outcome | Description |
|---------|-------------|
| `invalid_vin_format` | VIN fails format or check-digit validation |
| `fixture_excluded` | Vehicle matches fixture detection rules |
| `placeholder_make` | Make field contains a placeholder or default value |
| `placeholder_model` | Model field contains a placeholder or default value |
| `invalid_year` | Year is outside the valid range |
| `invalid_price` | Price is zero, negative, or unreasonable |
| `non_public_status` | Vehicle status is not set to public/active |
| `missing_owner_for_private_listing` | Private listing has no associated owner |
| `seed_owner_id` | Owner ID matches a known seed/demo account |
| `missing_tenant_for_dealer_listing` | Dealer listing has no associated tenant |
| `seed_tenant_id` | Tenant ID matches a known seed/demo tenant |
| `invalid_import_source` | Import source is flagged as test or integration |
| `missing_registration_country` | No registration country specified |
| `unknown_seller_type` | Seller type cannot be determined |

---

## 6. Classification System

### Safe Automatic Categories

These categories can be automatically assigned by the classification system:

| Category | Description |
|----------|-------------|
| `locally_used` | Vehicle registered and used in the local market |
| `recently_imported` | Vehicle imported within a defined recent timeframe |

### Governed or Deferred Classifications

These categories require trusted evidence pipelines and must **not** be assigned by unsafe heuristics or generic backfill:

| Category | Status |
|----------|--------|
| `passport_verified` | Requires identity verification evidence |
| `partsentry_checked` | Requires PartSentry inspection evidence |
| `brand_new` | Requires dealer/manufacturer source evidence |
| `second_hand` | Requires ownership history evidence |

---

## 7. Coverage Gate

### Endpoint

```
GET /api/marketplace/nav-coverage
```

The coverage gate endpoint:

- Derives coverage from the **same public Marketplace truth rules** used for search results
- Excludes fixture data
- Returns counts and active states per category
- Exposes **no owner or tenant PII**
- Uses a **promotion threshold of 3** — a category becomes active only when at least 3 eligible listings exist

The frontend uses coverage data to activate or defer navigation links by environment.

### Locally Used Behavior

| Condition | Navigation Behavior |
|-----------|-------------------|
| Eligible count ≥ 3 | Link becomes `/marketplace?category=locally_used` |
| Eligible count < 3 | Link defers to `/marketplace` (no category filter) |

---

## 8. Environment Routing

### Shared Frontend API Base URL Resolver

The frontend uses a shared utility to determine the API base URL. The resolution precedence is:

1. **`VITE_API_URL`** — when explicitly configured (highest priority)
2. **`/api`** — for `localhost`, `127.0.0.1`, or `0.0.0.0` (local development)
3. **Production backend fallback** — default for deployed environments

### Current Environment Endpoints

| Environment | Frontend | Backend |
|-------------|----------|---------|
| **Production** | `https://carup.vercel.app` | `https://carup-backend.vercel.app/api` |
| **Staging** | `https://carup-staging.vercel.app` | `https://carup-backend-aca7.vercel.app/api` |

### Resolved Vercel Routing Issue

The staging environment previously referenced:

```
https://carup-backend-staging.vercel.app/api
```

This endpoint was **invalid**. The corrected Production-scoped `VITE_API_URL` for the `carup-staging` Vercel project is:

```
https://carup-backend-aca7.vercel.app/api
```

This was resolved in [PR #48](https://github.com/kudzimusar/carup/pull/48).

---

## 9. Verified Staging Behavior

The following controlled staging proof was completed:

1. **Three eligible Local/ZW private-owner listings** were created in staging.
2. All three were **fixture-safe** — they passed every fixture exclusion check.
3. Classification dry-run selected **exactly the three intended rows**.
4. Only those rows were updated to `locally_used`.
5. Marketplace category total became **3**.
6. Nav coverage became **count: 3, active: true**.
7. "Locally Used Cars" linked to `/marketplace?category=locally_used`.

### Staging QA VINs

The following VINs were used as controlled staging QA records. They are **not verified real-world inventory** — they are synthetic test identifiers used exclusively for staging QA validation.

| VIN | Purpose |
|-----|---------|
| `1HGBH41JXMN109186` | Staging QA — locally used classification test |
| `2T1BURHE8JC123456` | Staging QA — locally used classification test |
| `3N1AB7AP5KY123456` | Staging QA — locally used classification test |

---

## 10. Verified Production Behavior

During the production audit:

- Public production Marketplace total was **0**.
- `locally_used` coverage was **count: 0, active: false**.
- Production correctly deferred "Locally Used Cars" to `/marketplace` (no category filter).
- Production frontend correctly used the production backend.
- Fixture records remained **hidden**.

**This is correct truth-first behavior, not a feature failure.** The navigation accurately reflects that no eligible locally-used inventory exists in production. When real eligible inventory is onboarded, the navigation will activate automatically.

---

## 11. Production QA Status

A temporary production activation/deactivation test remains a **release-checklist item** rather than an engineering blocker. The Navigation Intelligence engineering is complete.

### Optional Controlled Production QA Cycle

1. Authenticate as an approved production owner.
2. Create exactly **three** temporary eligible QA listings.
3. Verify Marketplace total.
4. Run read-only classification dry-run.
5. Confirm exactly the approved VINs are selected.
6. Classify only those approved VINs as `locally_used`.
7. Verify nav coverage becomes active.
8. Verify the production navigation link activates.
9. Archive or remove the same temporary QA listings.
10. Verify Marketplace and nav coverage return to their baseline.

**This cycle requires explicit production-write authorization.**

---

## 12. Security and Privacy

| Rule | Enforcement |
|------|-------------|
| Public listing summaries must not expose `owner_id` | Enforced in listing summary serialization |
| Public listing summaries must not expose `tenant_id` | Enforced in listing summary serialization |
| Production listing creation requires authenticated ownership context | Enforced by auth middleware |
| Production CSRF protection must remain enabled | Enforced by CSRF middleware |
| Staging shortcuts must not be enabled in production | Gated by environment checks |
| Fixture visibility must remain disabled by default | `MARKETPLACE_SHOW_FIXTURES` defaults to `false` |

---

## 13. Implementation History

The following PRs constitute the Navigation Intelligence implementation. Titles and numbers are verified against GitHub.

| PR | Title | Branch |
|----|-------|--------|
| [#16](https://github.com/kudzimusar/carup/pull/16) | feat(marketplace): Phase 1 — URL Intelligence & Responsive Discovery | `feature/marketplace-url-intelligence-phase1` |
| [#18](https://github.com/kudzimusar/carup/pull/18) | feat(nav): Phase 2 — minimal truthful Buy-menu deep-links | `feature/marketplace-nav-deeplinks-phase2` |
| [#24](https://github.com/kudzimusar/carup/pull/24) | feat(nav): Phase 2.1 — Dealer Verified Cars deep-link | `feature/dealer-verified-deeplink` |
| [#25](https://github.com/kudzimusar/carup/pull/25) | chore(marketplace): Phase 1.1 — URL intelligence cleanup | `feature/marketplace-url-cleanup-phase11` |
| [#29](https://github.com/kudzimusar/carup/pull/29) | feat(marketplace): classification dry-run for truthful nav backfill | `feature/marketplace-classification-dryrun` |
| [#35](https://github.com/kudzimusar/carup/pull/35) | feat(marketplace): safe-bucket classification backfill machinery | `feature/marketplace-classification-backfill` |
| [#37](https://github.com/kudzimusar/carup/pull/37) | feat(marketplace): exclude seed/demo/integration fixtures from classification + backfill | `feature/fixture-exclusion-hardening` |
| [#39](https://github.com/kudzimusar/carup/pull/39) | feat(marketplace): hide fixture listings from public marketplace by default | `feature/marketplace-hide-fixtures` |
| [#40](https://github.com/kudzimusar/carup/pull/40) | feat(marketplace): add real listing eligibility contract | `feature/real-listing-eligibility` |
| [#41](https://github.com/kudzimusar/carup/pull/41) | feat(marketplace): enforce real listing eligibility on vehicle creation | `feature/vehicle-create-eligibility` |
| [#42](https://github.com/kudzimusar/carup/pull/42) | test(marketplace): add real inventory onboarding fixture coverage | `feature/real-inventory-fixture` |
| [#46](https://github.com/kudzimusar/carup/pull/46) | feat(nav): add data-driven marketplace coverage gate | `feature/nav-coverage-gate` |
| [#48](https://github.com/kudzimusar/carup/pull/48) | fix(web): honor VITE_API_URL for staging backend routing | `fix/honor-vite-api-url` |

---

## 14. Definition of Done

### Completed ✅

- [x] Marketplace URL contract implemented
- [x] Fixture exclusion implemented
- [x] Public fixture hiding implemented
- [x] Listing eligibility enforced
- [x] Staging onboarding path proven
- [x] Classification dry-run proven
- [x] Guarded classification proven
- [x] Coverage endpoint implemented
- [x] Staging navigation activation verified
- [x] Production truthful deferral verified
- [x] Environment routing verified
- [x] Documentation completed

### Optional Pre-Launch Verification

- [ ] Controlled production activation/deactivation QA — optional pre-launch verification

This optional production QA item is a release-checklist verification step, not unfinished Navigation Intelligence engineering.

---

## 15. Known Limitations and Future Enhancements

- **Production categories remain deferred** until real eligible production inventory exists. This is correct truth-first behavior.
- **Governed tags** (e.g., `passport_verified`, `partsentry_checked`) require their own trusted evidence pipelines before activation.
- **Parts & Accessories navigation** requires a separate data model and eligibility contract.
- **Additional categories** must use coverage gates rather than hardcoded activation.
- **Threshold configuration** may later become environment-specific or category-specific.
- **Monitoring** may later alert when an active category falls below its promotion threshold.

# CarUp v1 RC1 — Staging Validation Report

**Date:** 2026-06-20
**Branch:** `release/carup-v1-rc1`
**Draft PR:** #76

## Staging target

All database verification in this checkpoint used the authenticated Supabase project named `carup-staging`, project ref `eoyenigwevnxwwhyhaer`, status `ACTIVE_HEALTHY`.

No production database was queried or modified.

## Marketplace migration state

The required Marketplace v1 tables already exist in staging:

- `public.marketplace_inquiries`
- `public.marketplace_listing_reports`

The migration was therefore not re-applied.

Verified:

- RLS enabled on both tables.
- No direct `anon` table privileges.
- No direct `authenticated` table privileges.
- Expected service-role access is present.
- Primary keys, indexes, and validation constraints are present.

Current staging row counts:

- `marketplace_inquiries`: 14
- `marketplace_listing_reports`: 0

## Marketplace QA dataset

The staging `vehicles` table contains nine available records.

Initial contract coverage:

- Toyota: 3
- Price <= USD 5,000: 0
- Price <= USD 10,000: 4
- `locally_used`: 5
- Trust-score range: 50.00 to 96.80

To make the `maxPrice=5000` route visibly testable, one controlled staging QA record was adjusted:

- VIN: `2T1BURHE8JC123456`
- Vehicle: 2017 Honda Fit
- Previous QA price: USD 7,800
- Current QA price: USD 4,500
- Rows affected: 1

Updated contract coverage:

- `maxPrice=5000`: 1 source record
- `maxPrice=10000`: 4 source records
- `q=Toyota`: 3 source records
- `category=locally_used`: 5 source records
- `sort=trust`: differentiated scores are available

Public API counts may be lower because fixture and listing-eligibility rules are expected to remove synthetic or ineligible records.

## RC preview surfaces

Frontend preview:

`https://carup-staging-git-release-carup-v1-rc1-pay-pass-project.vercel.app`

Backend preview:

`https://carup-backend-staging-git-release-carup-v1-rc1-pay-pass-project.vercel.app`

Use the RC preview frontend for Product Owner testing until stable staging is explicitly aligned to the RC branch.

## Required visible tests

- `/marketplace?maxPrice=5000`
- `/marketplace?maxPrice=10000`
- `/marketplace?sort=trust`
- `/marketplace?q=Toyota`
- `/marketplace?category=locally_used`

For each route verify page load, active filter state, visible result correctness, refresh persistence, browser back/forward behavior, honest empty states, and absence of private identifiers.

## Existing automated baseline

- Web build: passed
- Web TypeScript: passed
- Mobile TypeScript: passed
- Web Vitest: 168 passed
- Marketplace backend tests: 147 passed
- Backend governance/integration suite: 35 suites passed

## Remaining acceptance work

Browser and Playwright validation is still required for filtering, detail, inquiry, referral, saved vehicles, comparison, seller inquiries, admin moderation, Parts/Services routes, and Diaspora inquiry safety.

## Recommendation

Proceed to RC preview UAT and integrated browser testing.

Do not merge PR #76 yet.
Do not mark PR #76 ready for final review yet.

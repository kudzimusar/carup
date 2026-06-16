# Marketplace v1 — Implementation Map (Loop 1 Discovery Output)

Branch: `feature/marketplace-v1-production-integration` (base `main`).
Authoritative brief: `CARUP_MARKETPLACE_V1_CLAUDE_GOAL_LOOP_PLAN.md`.

## Baseline (main, before any change)

- Web tsc (`web/tsconfig.app.json`): **clean (exit 0)**.
- Backend suite (`node backend/tests/run-tests.js`): **green** ("ALL GOVERNANCE, INTEGRATION, & TRUST ENGINE TESTS PASSED", 35 tests, live Supabase).
- Monorepo: `web` (Vite+React+react-router), `mobile` (Expo/RN), `shared` (types/schemas/api), `backend` (Express + Supabase **service_role** client → RLS bypassed, authz MUST live in the service layer).

## Open-PR reconciliation (do NOT auto-merge — per brief)

| PR | Title | State | Decision | Rationale |
|----|-------|-------|----------|-----------|
| **#11** | PartSentry public-card approval backend | OPEN, CONFLICTING (server.js wiring only) | **Port suppression intent** (no merge dep) | #11 adds the governed *write* path (`partsentryReviewService`) + a stricter read-side suppression. Main's `summarizePartSentry` uses a **looser** check that ignores `suspicion_status`/self-approval. We harden the public read path to route through the existing strict `partsentryCheckedStatus()` predicate so suppressed/suspicious/self-approved parts can NEVER surface — independent of the merge. PR body recommends #11 still merge for the approval workflow. |
| **#72** | Phase 7C admin verification loop | OPEN, review-only | **Consume contract** | `seller_verified := identity status === 'verified'`; never invent verified client-side. Its `shared/types/verificationStatus.ts` is branch-only, so v1 builds `verification_summary` from main's governed vehicle signals (`passport_verified`, evidence, plate, zimra) and documents the identity→`passport_verified` bridge (Workstream G) as a known limitation. |
| **#66** | Registry-driven mobile drawer | OPEN, auto-merges clean | **Consume contract** | Register marketplace routes as `FeatureRegistryItem`s; do not duplicate nav logic. |
| **#58** | Diaspora shipment read scoping | OPEN, additive | **Honor contract** | Never expose shipment/container sensitive fields publicly. Marketplace Diaspora/import/container flows create lightweight **inquiries** only — they never read by-id shipment/container data. |

## Current state vs v1 gap (what exists / what is missing)

**Backend marketplace = read-only.** Only `GET /api/marketplace/listings` and `GET /api/marketplace/nav-coverage`.
Missing (to build): listing **detail** endpoint, **inquiries**, **save/saved**, **compare**, **recommendations** (marketplace-scoped), **my-listings** management, **admin moderation**, **analytics**, **AI** advisory endpoints, structured **trust_summary / verification_summary / pricing_summary**, **referral-event bridge**, **diaspora inquiry** flows.

**Web:** browse grid (`Marketplace.tsx`), detail (`/marketplace/:id` → `VehicleDetail.tsx`), admin moderation (`MarketplaceModeration.tsx`). No inquiry form, no compare; save is localStorage-only. API via `useCarUpApi()` + `apiClient.ts` (CSRF/auth/401).

**Mobile:** thin list+detail; uses **legacy** `GET /api/vehicles` (PII risk), hardcoded `localhost:5001`, stub purchase, no inquiry.

## Reuse decisions (no duplication)

- **Sanitized projection:** `buildMarketplaceListingSummary()` is the single public shape — every new endpoint returns summaries, never raw `vehicles(*)`.
- **Fixture/public-status hiding:** reuse `filterVisibleVehicles()` / `getFixtureExclusion()` on every new public read.
- **PartSentry suppression:** reuse `partsentryCheckedStatus()` (strict governed predicate) inside `summarizePartSentry`.
- **Saved listings:** reuse existing `saved_vehicles` table; expose under `/api/marketplace/...`, return summaries.
- **Referral attribution:** emit via `ReferralEngineService.recordReferralEvent` (table `referral_events`); marketplace **never** mints/transitions wallet rewards. No new reward table.
- **Moderation audit:** reuse `trust_audit_events` immutable sink + vehicle `status` for approve/suppress.
- **AI fallback:** mirror `documentIntelligenceService`/`evidenceService` advisory-degradation (`ai_unavailable`, never throw, never block).
- **Auth:** `authorizeRole([...])` → `req.userContext`. Errors: `ValidationError/ForbiddenError/NotFoundError`. Abuse: `rateLimiter()`.

## New tables (authored as idempotent migrations; applied via `scripts/` Supabase path — NOT auto-applied)

- `marketplace_inquiries` — buyer leads (vehicle/part/service/import/container/diaspora). RLS, service-role write, indexes on listing/seller/status/type/created_at.
- `marketplace_listing_reports` — public "report this listing" flow.

> **Dual-DB note:** `backend/db/migrate.js` is SQLite; production schema is Postgres/Supabase applied via `scripts/`. New migrations follow the Postgres+RLS convention and are **documented for manual apply**; tests are hermetic (`buildMockSupabase`) and do not require the live table.

## Privacy invariants (enforced server-side, asserted in tests)

1. Public APIs expose summary fields only — never `owner_id`, `tenant_id`, raw evidence URLs, OCR, mechanic_id, signatures, AI fraud internals, raw trust-score components, or admin `decision_notes`.
2. Trust badges are backend-generated; the frontend renders only what the backend supplies.
3. PartSentry claims suppressed unless `public_card_eligible && suspicion ∈ {none,cleared} && verified && not self-approved`.
4. Diaspora/import/container → inquiries only; no shipment/container sensitive fields.
5. Referral codes captured + emitted as events; rewards stay owned by the referral engine.

## Loop plan → acceptance-criteria mapping

- **Loop 2** backend spine → criteria 2,3,4,5,6,7,8,10,13.
- **Loop 3** public web → 1,2,3,4,5.
- **Loop 4** seller + admin → 9,10.
- **Loop 5** verticals (parts/services/diaspora) → 5,6,8.
- **Loop 6** mobile parity → 11.
- **Loop 7** analytics/SEO/safety/polish → 1.
- **Loop 8** tests + PR → 12,13,14,15,16,17.

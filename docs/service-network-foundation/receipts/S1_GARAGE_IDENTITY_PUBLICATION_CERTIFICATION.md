# S1 — Governed Garage Identity and Publication — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S1 builds

Governed garage identity and publication, replacing the empty `GarageDirectory.tsx`
placeholder with a real registry. Plan §6.5, §22.1, S1.

**Schema** — `20260904120000_service_network_s1_garage_identity.sql` (additive, timestamp
after the whole #194 lane):
- `garage_public_profiles` — PK `tenant_id` (one profile per garage tenant), UNIQUE `slug`,
  `publication_status` CHECK draft|published|unpublished, `contact_policy` CHECK
  in_app_only|phone_public, structured `service_categories`, `verification_dimensions` JSONB
  defaulting `{}`, `public_media`, `published_at`.
- `garage_branches` — the branch model for the ACTIVE `tenants` universe, UNIQUE(tenant_id, name).

Both: `ENABLE` + `FORCE ROW LEVEL SECURITY`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`,
`GRANT … TO service_role`, **zero policies** (S0 template — the backend runs as service_role and
the runtime boundary is app-level tenant scoping; the permissive `tenant_id IS NULL` idiom from
`tenant_vehicles_isolation` is deliberately not copied).

**Service** — `backend/services/serviceNetwork/garageDirectoryService.js`: public directory/detail
reads, tenant-scoped profile upsert, publish/unpublish transitions, branch create/deactivate.

**Routes** — `backend/routes/garageDirectoryRoutes.js`, mounted in `server.js`. Public reads
unauthenticated; garage writes `authorizeRole(['mechanic','dealer','admin'])` with the tenant
derived from `req.userContext` (membership-verified), never from a client parameter. Routes
validate and delegate only (plan §23).

**Web** — `GarageDirectory.tsx` (now registry-backed) and new `GarageDetail.tsx` at `/garages/:slug`.

## 2. Authority decisions honoured

| S0 rule | How S1 satisfies it |
|---|---|
| Garage = ACTIVE `tenants` universe | FK `tenant_id → tenants(id)`; legacy `organizations/*` untouched |
| No duplicate garage universe | Sibling projection tables; `tenants` itself not widened |
| No invented facts | No ratings/hours columns exist; `verification_dimensions` defaults `{}` and has **no client writer** (rejected at the service boundary) |
| Internal tenant ids are not public identity | Public projection is an allow-list; `slug` is the public identity — a test asserts the tenant UUID appears in no field |
| Unknown ≠ zero (Invariant 10) | PartSentry participation is DERIVED from `partsentry_logs` at read time; when unreadable it returns `available:false, recorded_repairs:null` — never `0` |
| No duplicate authority | PartSentry participation is never stored here |
| Tenant scoping is app-level | Every write filters `.eq('tenant_id', verified)`; branch deactivation scopes inside the UPDATE so cross-tenant reads as 404 (`workOrdersRoutes` idiom) |
| Truthful publication | `publish` refuses until display_name + ≥1 structured capability + location_city exist |
| Publication state is an explicit transition | `publication_status` cannot be set through profile upsert |
| History is not destroyed | Unpublish flips state; the record survives |

## 3. Verification — commands and results

Environment: exact `ci.yml` contract (`NODE_ENV=test`, test Supabase/JWT placeholders, `ALLOW_OCR_MOCK=true`).

| Gate | Command | Result |
|---|---|---|
| S1 migration proof (real PostgreSQL) | `node database/test/service_network_s1_check.mjs` | **PASS** — 24 checks: FORCE RLS, zero policies, real `has_table_privilege()` for anon/authenticated/service_role, FK rejection, CHECK rejection of invented states, 23505 on slug + one-profile-per-tenant + duplicate branch, Down/re-Up round trip |
| S1 authority contracts | `node --test backend/tests/service-network-s1-garage-identity.test.js` | **PASS** — 14/14 |
| Web directory truth contract | `npx vitest run src/pages/GarageDirectory.test.tsx` (in `web/`) | **PASS** — 5/5 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4367 tests, **4346 pass, 0 fail**, 21 skipped, 48 suites (baseline 4352/0 fail → +15 new tests, zero regressions) |
| Full web suite | `npx vitest run` (in `web/`) | **PASS** — 106 files, 1097 tests |
| Web typecheck | `npx tsc --noEmit --project web/tsconfig.app.json` | **PASS** — zero diagnostics |
| Migration integrity | `node --test backend/tests/migration-integrity.test.js` | **PASS** — 24/24 (marker contract satisfied) |
| Existing migration chain | `node database/test/migration_pglite_check.mjs` | **PASS** — 0 up/down failures |

The S1 migration proof is wired into CI through
`backend/tests/service-network-s1-garage-identity-migration.test.js`, which shells out to the
standalone harness (the #194 wrapper-test pattern) so `node --test backend/tests/*.test.js` — and
therefore the existing `ci.yml` step — runs it on every build. No unwired harness was added.

## 4. Defects found and fixed during S1

1. **`mockSupabase` had no `count` support.** `select(cols, { count:'exact', head:true })` silently
   returned `count: undefined`, which a service reading `count ?? 0` turns into a fabricated zero —
   precisely the "unknown is not zero" failure real Supabase would never produce. The mock now models
   `count`/`head` (opt-in, so existing tests are unaffected), and the derived-count test proves the
   degraded path returns `null`.
2. **PGlite teardown made the harness exit code nondeterministic.** The harness printed every check
   as OK and still exited `100` under load, failing the CI wrapper. Fixed with an explicit
   `await db.close()` + `process.exit(0)`, matching the repo's existing harness idiom. Without this
   the gate's verdict depended on interpreter teardown rather than on the checks.
3. **Truthful-failure gap in the directory UI.** A failed fetch would have rendered the "no garages
   listed" empty state — a load failure asserting an empty registry. The page now distinguishes
   loading / failed / empty, and a test locks that a failure never renders the empty claim.

## 5. Frozen S1 vocabulary

`GARAGE_SERVICE_CATEGORIES` (closed, app-validated): general_service, engine, transmission, brakes,
suspension, electrical, diagnostics, bodywork, tyres, air_conditioning, exhaust, other.

## 6. Deliberately NOT in S1

Ratings, reviews, opening hours, booking/appointments, service requests (S2), a garage-side onboarding
or membership-invitation API (S0 gap: no tenant provisioning path exists — garage tenants remain
seeded out of band), and any verification writer. `verification_dimensions` therefore renders as
"CarUp has not verified this garage" for every garage, which is the truthful state.

## 7. `[#194-sensitive]` items for the rebase

- The `/api/garage/*` namespace is shared with #194's Intelligence analytics — S1 uses distinct
  paths (`/api/garage/profile`, `/api/garage/branches`) and must be re-checked after rebase.
- `web/src/App.tsx` route registration collides with #194's public-route additions.
- `backend/server.js` router mounting collides with #194's router block.
- Directory trust display (deferred to a later phase) must use `canonicalTrustService` batch reads.

**S1 is complete and green. S2 (Canonical Service Case Foundation) is next.**

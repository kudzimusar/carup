# S0 Certification Receipt — Vehicle Taxonomy & Seller Contract Foundation

**Programme:** Seller Journey 1.0
**Phase:** S0 — Vehicle Taxonomy & Seller Contract Foundation (PREREQUISITE)
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code (implementer role per PR #182 handoff, 2026-08-28T05:00:36Z)

---

## 1. Exact-head reconciliation at certification time

| Surface | Exact state |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` (unchanged since phase start) |
| **Certified candidate — PR #182 head** | `4d7b94fc8bd7c8e0b22658239cb8376a01a39e7e` — Draft, MERGEABLE |
| Immutable S0 staging-gate candidate | `7b2506870df48a87d92f0c2fc6ca1a38e3040f6e` |
| Communications PR #183 | `507530aadff17ec8aa4830d3cb392efda6876031` — Draft |
| Intelligence PR #185 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` — Draft |
| Seller docs PR #186 | `a6e5acad5aac5d4d00e2f4ec2e2211e921e51580` at receipt authoring |
| Execution-plan PR #181 | Open (two-source-write-lane freeze in force) |

**Drift check (gated S0 surface):** `git diff 7b250687..4d7b94fc` over the three S0 migrations, `seller-s0-taxonomy-staging.mjs`, `seller-s0-taxonomy-backfill.mjs`, `shared/taxonomy/`, and `backend/services/taxonomy/` is **empty**. The immutable staging candidate and the certified head are identical across the entire gated S0 surface; commits after `7b250687` are Home/Marketplace presentation, semantic-selector, year-bound-convergence and a11y work.

## 2. Lane compliance

No third source-write lane was opened. All S0 runtime work was implemented **inside PR #182**, which owns the Seller/taxonomy/Marketplace surfaces (`vehicleTaxonomy.ts`, `GuestSell.tsx`, `SellVehicle.tsx`, Marketplace filter contracts, Home, Verify, Vehicle Detail). #183 (Communications) and #185 (Intelligence) code was not modified. This receipt lives in the documentation lane (PR #186).

## 3. What S0 delivered (live at the certified head)

- **Platform-owned canonical source:** `shared/taxonomy/vehicle/catalog.json`, version `carup-global-vehicle-taxonomy@1.0.0` — 43 makes, 212 models, dimensions: bodyStyles=16, colors=16, fuelTypes=9, transmissions=7, drivetrains=5, sellerConditions=3, yearPolicy `{technicalMin: 1886, maxOffsetFromCurrentYear: 1}`; consumed via `shared/taxonomy/vehicle/index.ts`.
- **Server-authoritative normalization:** `backend/services/taxonomy/vehicleTaxonomyService.js` resolves make/model/year/colour/fuel/transmission/drivetrain/body-style/seller-condition to honest authority states — `canonical`, `alias_match`, `unrecognized`, `not_recorded` — always preserving the raw value and never fabricating a canonical mapping.
- **Web compatibility façade:** `web/src/data/vehicleTaxonomy.ts` re-exports the shared contract; no web-local taxonomy authority remains.
- **Seller persistence contract closed (S0-P0-04/05/06/08):** `POST /api/vehicles/add` now persists `seller_description`, `seller_features`, `body_style`, `seller_stated_condition`, drivetrain, plus taxonomy columns (`taxonomy_version`, `make_taxon_id`, `model_taxon_id`, `color_taxon_id`, `fuel_taxon_id`, `transmission_taxon_id`, `drivetrain_taxon_id`). Body style and seller-stated condition never write the governed `vehicle_condition_category`. The authenticated Sell `year: '2020'` default is removed (year initializes empty).
- **One year policy (S0-P0-01):** `vehicleYearBounds()` / `vehicleYearOptions()` from the global contract drive authenticated Sell and Marketplace; listing eligibility converges on the same global year bounds (commits `3c6ef738`, `b588d18d`).
- **Fuel/transmission vocabulary parity (S0-P0-02/03):** Sell and Marketplace direct filters consume the same canonical dimension vocabularies; the Marketplace facet pipeline asserts taxonomy-aware Body Style/Fuel/Transmission matchers before sort/limit (`49f1ff0f`).
- **Cross-surface convergence:** Home/Landing shortcuts, Verify browse (`VehicleSearch.tsx`), Imports/Diaspora (`DiasporaTrade.tsx` — canonical autocomplete via `VEHICLE_MAKES`/`modelsForMake` with free-text raw preservation), and mobile Marketplace (`mobile/app/(tabs)/marketplace.tsx` imports `@shared/taxonomy/vehicle`; hardcoded five-make list removed) all derive from the one global contract.
- **Anti-fork enforcement:** `backend/tests/global-vehicle-taxonomy-antifork.test.js` permanently asserts that GuestSell, SellVehicle, Marketplace, mobile Marketplace, Verify and Diaspora do not maintain local taxonomy lists and that backend/web/mobile all read the shared catalog. Reverse RFQ deliberately deferred unchanged until its consumer migration (`99ab7344`).
- **Staging schema:** three staging-only migrations in the reviewed ledger — `20260828133000_global_vehicle_taxonomy_s0.sql`, `20260828140000_global_vehicle_taxonomy_imports_s0.sql`, `20260828143000_global_vehicle_taxonomy_color_s0.sql` — applied and independently verified by the immutable-candidate gate.

## 4. Staging evidence (Seller S0 Global Taxonomy Staging Gate)

Workflow `seller-s0-global-taxonomy-staging.yml`, run **33145416641** (head `4d7b94fc`), job `preflight-apply-verify` — **success**. The gate checks out only the immutable candidate `7b250687`; no arbitrary ref or SQL input exists. Sequence: rollback-only preflight → reviewed apply + independent schema verification → deterministic exact/approved-alias backfill → read-only post-apply verify.

Artifact `seller-s0-global-taxonomy-staging-7b2506870df48a87d92f0c2fc6ca1a38e3040f6e`:

- **Staging receipt** (`mode: verify`, generated 2026-08-28T05:41:43Z, staging ref `eoyenigwevnxwwhyhaer`): `schema.ok: true`, `missing_vehicle_columns: []`, `missing_import_columns: []`, `observations_table_present: true`, all three S0 migrations present in the ledger.
- **Backfill receipt** (`status: PASS`, generated 2026-08-28T05:41:19Z): vehicles total 38 — fixture_skipped 25, updated 13, make_mapped 12, model_mapped 9, year_valid 13, color_mapped 6, fuel_mapped 12, transmission_mapped 12, drivetrain_mapped 9; unresolved preserved honestly (make 1, model 4, colour 6). Imports total 91 — updated 91, make_mapped 62, model_mapped 1, year_valid 62, unresolved preserved (make 29, model 61). Invariants: `raw_vehicle_values_rewritten: false`, `fixture_rows_skipped: 25`, `unknown_values_preserved: true`, `exact_or_approved_alias_only: true`.

## 5. CI evidence at the certified head `4d7b94fc`

All workflows completed **success** on this exact SHA:

| Workflow | Run |
|---|---|
| CI (Lint · Types · Build · Tests, secret scan, dependency audit) | 33145416645 |
| Seller S0 Global Taxonomy Staging Gate | 33145416641 |
| Marketplace Reference Media Staging Apply (exact-head reference + staging certification) | 33145416604 |
| Backend/build/Playwright/staging-integration (Diaspora Phases 3–7 Validation) | 33145416617 |
| Communication Command Center CI | 33145416620 |
| Navigation Intelligence CI | 33145416637 |
| Referral Engine CI | 33145416651 |
| Vercel — carup, carup-backend, carup-backend-staging, carup-staging | all READY |

S0-relevant suites in-tree: `vehicleTaxonomy.test.ts`, `global-vehicle-taxonomy.test.js`, `global-vehicle-taxonomy-antifork.test.js`, `global-taxonomy-marketplace-filter.test.js`, `seller-global-taxonomy-persistence.test.js`, `seller-s0-taxonomy-backfill.test.js`, `seller-s0-taxonomy-staging-runner.test.js`.

## 6. Exit-gate disposition (plan §15 / S0 spec §15)

Every S0 exit criterion is PASS at the certified head, with two boundary dispositions recorded:

1. **Intelligence alias grouping** — Intelligence implementation is #185-owned. S0 delivers the platform contract and the observation seam (staging `vehicle_taxonomy` observations table present; taxonomy columns queryable). Grouping Intelligence metrics through canonical mapping is the S9 pairing obligation inside the Intelligence integration boundary, not an S0 runtime change in this lane. No competing taxonomy exists in #182-owned code — enforced by the anti-fork suite.
2. **Communications** — no provider-specific seller logic was added; the Communications boundary remains #183/Communications-2.0-owned, exactly as the plan freezes it.

Deferred by design (recorded, not S0 blockers): media primacy UX (S0-P0-09 → S4), location-visibility seller choice (S0-P0-10 → S3), Reverse RFQ consumer migration (deliberately unchanged until its own migration), production migrations (staging-only in S0; production activation requires owner authority).

## 7. Decision

> **S0 — PASS** at PR #182 exact head `4d7b94fc8bd7c8e0b22658239cb8376a01a39e7e`, with staging proof at immutable candidate `7b2506870df48a87d92f0c2fc6ca1a38e3040f6e` (bitwise-identical gated surface).

Any future feature needing vehicle taxonomy must consume or extend `shared/taxonomy/vehicle/` — never recreate taxonomy locally.

**Next phase:** S1 — Seller Entry & Vehicle Identification, beginning with the mandatory pre-phase live-head reconciliation and an audit of S1 requirements already satisfied ahead of schedule (guest draft handoff already partially live in `SellVehicle.tsx`).

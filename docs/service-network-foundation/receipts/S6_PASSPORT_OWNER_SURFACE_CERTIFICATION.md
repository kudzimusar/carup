# S6 — Vehicle Passport and Owner Surface Convergence — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S6 builds

The **owner** projection of service history (plan §11.2, §22.2), assembled from the source
records S2–S5 established — not stored as a second copy, and not a second timeline
(Invariant 9).

- `backend/services/serviceNetwork/ownerServiceHistoryService.js` — the projection.
- `GET /api/service-history/me` now returns it. The endpoint previously returned raw
  `mechanic_work_orders` rows, which is *why* the UI had nothing truthful to render.
  All original row fields are preserved so existing consumers keep working.
- `web/src/pages/dashboard/owner/ServiceHistory.tsx` — rewritten against the projection.

**No new migration.** S6 is a projection phase; it adds no table and no column.

## 2. The four truth debts, retired

Plan §3.4 records four specific debts on this surface. Each is removed at the source —
the projection reports a fact or reports it as absent — and locked by a test.

| Debt (plan §3.4) | Before | After |
|---|---|---|
| "Next Service — 500 km" | Hard-coded tile; no authority supports it | **Removed.** The projection never emits a next-service field, and a test asserts the payload and the page contain no such prediction |
| Cost rendered as zero | `${service.total_cost \|\| 0}` printed `$0` for unrecorded cost | `cost: { recorded:false, amount:null }` → the page prints **"Cost not recorded"**. An amount stored *without* a currency is also not displayable as money |
| Generic "Garage" | Literal string stood in for provider identity | Provider comes from the governed `garage_public_profiles` projection; an unknown provider reads **"Provider not recorded"**, and a published garage links to its page |
| Assumed USD | `$` prefix on every figure | The recorded ISO-4217 currency is rendered (e.g. `ZWG 250`). **Totals refuse to sum across currencies** and report "Multiple currencies" instead |

Two further honesty fixes fell out of the same work: unrecorded services are **excluded**
from the spend total with the exclusion stated ("1 service with no cost recorded"), and a
failed load now reports a loading failure rather than rendering an empty history.

## 3. Authority decisions honoured

| Rule | How S6 satisfies it |
|---|---|
| Passport projects; source records stay authoritative (Invariant 9) | The owner view is assembled at read time from work orders + service records; nothing is copied into a second store, and no third timeline is created |
| Unknown is not zero (Invariant 10) | Absent cost, absent provider, absent provenance and absent mileage are each reported as absent — never as `0`, `"Garage"` or a guess |
| Mileage is an observation (§13.1) | The latest reading is surfaced as "observed", with its source; it is never presented as the canonical odometer |
| Provenance is stated (§6.6) | Rendered from `service_authority`; with no service record the label is **"Source not recorded"**, never anything implying verification |
| Money (§24.4) | Currency always accompanies an amount; cross-currency sums are refused rather than silently added |
| Timestamps (§24.5) | Display prefers `performed_at`/`completed_at` over `created_at` — the real service time, not the row-creation time |
| Owner scoping | Only the requesting owner's vehicles are included — asserted by test |

## 4. Verification — commands and results

| Gate | Command | Result |
|---|---|---|
| Owner projection contracts | `node --test backend/tests/service-network-s6-owner-history.test.js` | **PASS** — 12/12 |
| Owner surface truth contract | `npx vitest run src/pages/dashboard/owner/ServiceHistory.test.tsx` (in `web/`) | **PASS** — 10/10 |
| Web typecheck | `npx tsc --noEmit --project web/tsconfig.app.json` | **PASS** — zero diagnostics |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4441 tests, **4420 pass, 0 fail**, 21 skipped. S5 baseline 4429/0 → +12, **zero regressions** |
| Full web suite | `npx vitest run` (in `web/`) | **PASS** — 107 files, **1107 tests, 0 fail** (was 106/1097) → +10, **zero regressions** |

## 5. Defect found during S6

The first run of the new web tests failed seven of ten with an empty `<body />`: several
tests queried the DOM without ever rendering the component. That was a fault in the tests,
not the page — fixed by rendering in each case. Worth recording because a test that queries
an unrendered tree fails loudly here, but the same mistake inverted (asserting absence
without rendering) would have **passed vacuously** and proven nothing about the truth debts.

## 6. Deliberately NOT in S6

Public/buyer Passport projection of service history (that remains Passport's authority, and
`[#194-sensitive]` — #194 formalises `passportServicePartsProjection`/`passportLifecycleTimeline`
as the V8 modules to extend after rebase); My Garage per-vehicle service entry points and the
garage-side queue UI (S9); Intelligence instrumentation (S7); and any exposure of
`work_performed` free text on a public surface.

## 7. `[#194-sensitive]` items for the rebase

- Public service history must extend #194's `passportServicePartsProjection` (and its frozen
  `SERVICE_AUTHORITIES` set), never fork a parallel projection — S5's vocabulary is a superset
  designed for exactly that extension.
- `backend/routes/vehiclesRoutes.js` gains #194's `canonicalVehicleLifecycleService` read model;
  owner service history should feed that single lifecycle story rather than diverge from it.

# I8 — Dealer Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Authority layer:** the tenant-grain rollups (I4) read through the tenant-scoped projection (I5)
**Status:** complete. Every dealer fabrication the I0 audit catalogued is removed and pinned by a regression test.

---

## What shipped

| Artefact | Path |
|---|---|
| Component | `web/src/components/intelligence/DealerIntelligence.tsx` |
| Fetcher | `web/src/hooks/useCarUpApi.ts` (`fetchDealerIntelligence`) |
| Tests | `web/src/components/intelligence/DealerIntelligence.test.tsx` (27 tests) |
| Rewritten | `SalesAnalytics.tsx` |
| Repaired | `DealerDashboard.tsx`, `Promotions.tsx`, `Inventory.tsx` |

The component reads `/api/dealer/analytics`, whose tenant is resolved from **verified session membership** — the fetcher takes one argument, the window, and a test asserts that. There is no tenant parameter for a dealer to pass or for a surface to get wrong.

---

## Each I0 finding, and what replaced it

**No platform-wide inventory masquerading as dealer inventory.** `DealerDashboard` counted `fetchVehicles()` — the *public, platform-wide, publication-gated* list — and labelled it "Total Inventory", then filtered other dealers' cars by location into "branch stock". It now reads `fetchDealerInventory()` (tenant-scoped, `/api/vehicles/inventory`), which already existed; the dashboard was simply calling the wrong one. A failed read reports "Not available" rather than a count of zero.

**Static SalesAnalytics values removed, not restyled.** The page initialised Total Revenue, Units Sold and Avg. Sale Price to hardcoded six-figure constants shown identically to every dealer; "replaced" them from the public platform-wide list (which excludes sold vehicles, so the sold computation was structurally near-zero either way); printed literal green/red movement badges with no prior period computed; published a customer-satisfaction figure although **CarUp has no rating system anywhere**; and drew a monthly-sales bar chart and category pie from static arrays no fetch ever touched. The page is now the governed tenant projection.

**No mock promotions concatenated into real data.** Three fabricated campaigns were the *initial state* and were then concatenated into successful API results — so every dealer saw two "active" promotions with 245 and 189 views that did not exist, and a dealer with one real promotion saw four. The seed is gone; a successful read *replaces*, and a failed read says "This is not an empty list."

**No fabricated ratings, deltas, ROI or campaign performance.** The "Total Views 434" and "Click Rate 12.2%" tiles were literals — the sum of the mock rows and a rate with no numerator or denominator. CarUp records no promotion impression or click at all, so both tiles now read "Not tracked", and per-row counts say so too rather than printing `0`. `Promotion.views`/`clicks` became optional in the type, because a required `number` forced every call site to invent a zero.

**No fake zeros on failed reads.** Dealer inventory, promotions, and the intelligence panel each distinguish "could not be read" from "there is nothing here". The dealer Inventory empty state now says "Inventory could not be loaded — this is not an empty inventory" when the read failed.

**Sale and conversion metrics only from authoritative transaction state.** CarUp holds **no authoritative record of a dealer's completed sales** — the tenant rollup has none, and inferring sales from disappearing public listings is precisely what the plan forbids. So no revenue, units-sold or average-sale figure is shown, and the absence is *stated* in its own block rather than omitted. Omission invites someone to fill the gap back in with an estimate; naming it is what stops the fabricated figure returning. A test asserts no currency amount appears anywhere in the rendered component.

**Canonical Trust semantics preserved.** The dealer Inventory row rendered `vehicle.trustScore` — a camelCase field the endpoint does not return, which displayed as "Trust: " followed by nothing, and which would have bypassed the canonical trust projection mandated by #164. It is removed along with `viewCount`, `condition` and `isVerified`, which were equally absent. The hardcoded Unsplash stock photograph of somebody else's car is replaced by an honest "No photo", and an unrecorded status is "Status not recorded" rather than an invented "Available".

**`active_listings` is deliberately not shown.** In the rollup it counts listings that had *activity* that day, not listings a dealer has active. Publishing it under that name would be a quiet lie, so real inventory comes from the tenant-scoped endpoint and is labelled for what it is.

---

## A real bug this work surfaced

Three of the dealer tests failed with an escaping error that no `try`/`catch` could stop. The cause was in the test file, and worth recording: `beforeEach(() => fetchDealerIntelligence.mockReset())` **implicitly returns the mock**, and vitest treats a function returned from `beforeEach` as a *teardown callback* — so the runner invoked the mock after every test, outside any handler, surfacing its rejection as an unhandled error. A block body fixes it.

Chasing it produced a genuine hardening that stayed: all three Intelligence components now guard the fetcher call itself in `try`/`catch` (a fetcher that throws *synchronously* would previously have escaped the promise `.catch` and broken the host surface) and use the two-argument `then(ok, err)` form so the rejection handler binds in the same tick as the fulfilment one.

---

## Evidence

- **27 dealer tests** pass: component behaviour, tenant scoping with no tenant parameter, the named sales absence, three failure modes — plus **source-level assertions** that each removed literal cannot return. Source assertions are the right tool for "this must not exist": a rendering test would only prove it is not visible today.
- **Full web suite: 109 files / 1,184 tests / 0 failures.** Typecheck clean; production build succeeds.
- `git merge-tree` against PR #182: **0 conflicts** (that lane owns no dealer file).

## Note on what dealers will see initially

Impressions and views populate only once I3's client-side card instrumentation lands (sequenced behind PR #182) and a rollup has run. Until then these read as genuine zeros or as "Not available", and the `as of` line and coverage note make which one it is visible rather than mysterious.

**I8 is complete. Next: I9 (Mechanic & Garage Intelligence).**

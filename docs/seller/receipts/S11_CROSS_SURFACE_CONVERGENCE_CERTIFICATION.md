# S11 Certification Receipt — Cross-Surface Convergence

**Programme:** Seller Journey 1.0
**Phase:** S11 — Home / Marketplace / Verify Convergence
**Decision:** **PASS**
**Certified:** 2026-08-28
**Certifying implementer:** Claude Code

---

## 1. Exact-head reconciliation

| Surface | State |
|---|---|
| Canonical `main` | `ba208963d863654157335189c60f587cbe330041` |
| **PR #182 (write lane)** | `dd17593c` at S11 certification |
| Communications PR #183 / Intelligence PR #185 | untouched |

No migration, no schema change, **and no production change at all** — see §4.

## 2. What already held, and was not duplicated

Issue #164's permanent-invariant suite already pins a large part of convergence:

- **INV-1** — one VIN yields one identical public trust projection wherever it is read;
- **INV-5** — one listing-media contract serves both the card and the detail gallery;
- **INV-6** — listing photos and verified evidence are key-disjoint blocks;
- **INV-13** — Landing/Home reads the canonical marketplace listing contract, not a second source;
- **INV-3 / INV-4** — private identifiers stripped; absent values stay absent and a recorded zero stays a fact.

S11 is not a second copy of those.

## 3. What was NOT covered — the actual gap

The governed facts **this programme added** had no convergence proof:

- **body style** and **seller-stated condition** (S0/S2) — new columns, newly public;
- **seller description** and **features** (S2) — dead keys on Vehicle Detail until this programme fixed the projection;
- **location visibility including `province_only`** (S3) — a vocabulary that did not exist before;
- **explicit cover-photo semantics** (S4) — primacy is a seller's choice, not a position;
- publication status and not-recorded semantics across both projections.

## 4. Method — behavioural, not source-matching

One vehicle row is pushed through the **real** projections each surface uses:

| Surface | Projection exercised |
|---|---|
| Marketplace card, Home | `buildMarketplaceListingSummary` |
| Vehicle Detail, Verify, Passport | `toPublicVehicle` + `toListingClaims` |

The governed facts are then compared **field by field**. A per-page interpretation shows up here as a failing assertion rather than as a support ticket.

**Convergence holds today: all 14 checks pass with no production change.** That is the finding — the shared-projection architecture the earlier phases built means the new fields converged by construction. The value of this suite is that it now *stays* that way.

### Proven

| Dimension | Assertion |
|---|---|
| Canonical make/model/year/body style | identical on both projections |
| Seller-stated vs governed classification | `seller_stated_condition` and `vehicle_condition_category` remain distinct, neither answering for the other |
| Description / features | agree wherever published |
| Mileage, price, currency | agree; an absent one is **null on both**, never zero |
| Currency without provenance | published by neither |
| Seller identity | an unpublished identity is withheld on both |
| Location visibility | all three values agree; the card never names a place the passport withheld — including the city under `province_only` |
| Publication status / availability | agree |
| Cover media | an explicit seller cover is primary **whatever its position**; with none chosen the state is `first_published`, never `seller_primary` |
| Not-recorded semantics | "looked and found none" (`none`) stays distinct from "never looked" (`not_loaded`) |
| Trust | the raw `trust_score` column reaches no public projection; an unconsulted authority publishes `null`, not 0 |
| Evidence privacy | no `match_status`, `review_status`, `normalized_value`, `mismatch_reason` or `reconciliation` on any buyer surface |
| Private identity | owner/tenant ids, engine, chassis and plate numbers appear on neither |

## 5. Two fixture corrections — the contract moved to nothing

Two media assertions initially failed. Both were **my fixtures**, not the code:

1. `listing_images` rows are read from `image_url`, not `url`.
2. An item is published only with an **opaque UUID identity**. The grammar cannot express a bucket path — that regex *is* the "never a private locator" guarantee, mechanically. A fixture with a friendly id (`img-a`) has every row refused before the sort runs, so it proves nothing about ordering.

The fixtures moved to the real row shape. Nothing in the contract was relaxed to accommodate a test.

## 6. Evidence at `dd17593c`

| Check | Result |
|---|---|
| `seller-cross-surface-convergence` | **14/14 passed** |
| **Full backend suite** (CI env contract) | **4451 pass / 0 fail** (30 skipped) |
| **CI at this head — all ten workflows** | **success**, including Marketplace Reference Regression (exact-head + unmocked staging certification) |

## 7. Decision

> **S11 — PASS.** One CarUp for one vehicle across Seller → Marketplace → Home → Vehicle Detail → Verify → Passport, proven by running a single row through the real projections rather than by inspecting each page's source. Convergence held without a production change; it is now guarded.

# I5 — Authorization and Privacy Projections

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Implements:** `I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md` §6 (privacy classes, audiences) and §8 (availability contract), reading the I4 rollups
**Status:** complete — the read side of Intelligence, with its boundaries proven.

---

## What shipped

| Artefact | Path |
|---|---|
| Projection service | `backend/services/intelligence/intelligenceProjectionService.js` |
| Routes | `backend/routes/intelligenceProjectionRoutes.js` (mounted in `backend/server.js`) |
| Tests | `backend/tests/intelligence-projections.test.js` (30 tests) |

| Endpoint | Audience | Scope source |
|---|---|---|
| `GET /api/marketplace/my-listings/:vin/analytics` | seller/owner | ownership proven by query |
| `GET /api/marketplace/my-analytics` | seller/owner | listings the caller actually owns |
| `GET /api/dealer/analytics` | dealer | verified tenant membership on the session |
| `GET /api/admin/marketplace/intelligence` | platform admin | platform grain |
| `GET /api/government/intelligence` | institutional | purpose-limited; **no commercial behaviour** |

---

## The four rules, and how each is enforced

**1. Scope is proven, never asserted.** There is deliberately no seller, tenant or organization parameter anywhere in these routes — a test asserts their absence in source. A seller's listings are resolved by querying which listings they own; a dealer's tenant comes from verified session membership and `requireVerifiedTenant` refuses rather than falling back to platform scope. The I0 audit found the opposite pattern already in the codebase (gap G3: referral admin listings prefer a client-supplied `tenant_id` over the verified one, reachable by a plain `dealer`), and that is the shape of every cross-tenant analytics leak.

**2. Aggregates, not identities.** A seller learns that 30 unique shoppers viewed their listing; they never learn who. No projection returns an actor id, session key, or any row-level behavioural record — asserted by serializing every payload and searching for the forbidden fields. Identity becomes visible only through a declared lead, which `marketplace_inquiries` already models.

**3. Unavailable is never zero.** Every metric leaves the service inside an availability envelope (`value` / `insufficient_data` / `unavailable` / `not_applicable`), so a client cannot render an unavailable number as `0` without ignoring the envelope. An uncomputed rollup, a failed run, or an unreadable table all produce `unavailable` with a reason and the message "These figures are NOT zero." A seller with no listings gets "Publish a vehicle to start receiving Marketplace insights", not a wall of zeros. This is the direct remedy for the fake-zero defect catalogued across a dozen existing surfaces in I0 §3.

**4. Government is not a super-admin.** The institutional projection returns **no** views, saves, searches, impressions or shopper counts — a test proves each term is absent from the payload — and states honestly that institutional intelligence requires a governed data-sharing contract and an active authoritative integration, neither of which exists (every relevant integration is `BUILT-BUT-INACTIVE` per I0 §7). The admin route is gated `['admin']` alone; a test reads the route source and asserts `government` does not appear in that gate.

### Supporting decisions

- **Denial is not-found, not forbidden.** A distinct 403 on someone else's listing would confirm that the VIN exists and belongs to another seller, turning the analytics endpoint into an ownership oracle. Missing and foreign listings return an identical 404, asserted by comparing both error objects.
- **Window uniques are not summed.** Daily rollups cannot tell whether the same shopper returned on three days, so a window-level unique is reported as the peak day with `basis: 'peak_day'` stated in the payload — rather than publishing an inflated sum that claims more people than the busiest day can support.
- **`net_watchlist` is the latest authority snapshot**, not a sum of daily snapshots, which would invent saves that never existed.
- **Rates are withheld below a denominator of 20** (`insufficient_data`), so no headline percentage is computed from three visits. Raw counts are still shown.
- **Only 7/30/90 windows are honoured** — an arbitrary window would silently change what a metric means while still calling itself the same metric.
- **`coverage` states days-with-data vs days-requested**, so an honest zero is distinguishable from a gap in measurement.
- **Self-traffic never appears in a seller-facing payload**; it exists in the rollup for operators only.

---

## Evidence

### Authorization and privacy tests — 30/30 pass
Boundary coverage: own-listing allowed; another seller's listing refused; denial indistinguishable from not-found; anonymous refused before any read; tenant colleague allowed; other-tenant dealer refused; dealer intelligence returning tenant-a's 40 views while tenant-b's planted 999s never appear; tenant-less dealer refused; platform-admin gate rejecting seller, dealer **and** government; institutional payload containing none of views/saves/searches/impressions/unique_shoppers; seller refused the institutional route; no viewer identity in any payload; uncomputed/failed/unreadable rollups all reporting unavailable; no-listings guidance; genuine zero still a value; rates withheld on thin traffic; window totals adding while uniques do not; watchlist as latest snapshot; shares kept separate; self-traffic absent; coverage reported; unmet demand surfaced; window whitelist; contiguous window dates; routes mounted; **no scope parameter in any route**; admin route excludes government.

### Full backend regression — 4,461 tests, 0 failures
Under the `ci.yml` env contract. 4,440 pass, 21 pre-existing skips.

---

## Gap register movement

| Gap | Status |
|---|---|
| **G5** (government holds platform-wide commercial analytics) | **closed for Intelligence** — the new admin route excludes `government`, and the institutional projection exposes no behavioural data. The pre-existing `/api/admin/marketplace/analytics` endpoint still carries the old `['admin','government']` gate; it belongs to the marketplace lane and is left untouched here, but it is now the only remaining instance and is re-flagged for the owner |
| G3 (client-supplied tenant preferred over verified) | unchanged in the referral lane; **not reproduced** in Intelligence — no route accepts a scope parameter |
| G1 (unauthenticated referral event ingestion) | still open; Intelligence deliberately does not depend on the referral stream for view or demand data |

---

## Deliberate limitations

- **Benchmarks are not implemented yet.** `MIN_BENCHMARK_COHORT` is defined but no comparison cohort is computed: a benchmark requires the impression data that is blocked behind PR #182, and the contract forbids showing a percentile without cohort size and methodology.
- **Partner projections are not implemented.** No real partner exists (I0: `partner_clients` holds only UAT artifacts, prod rows revoked), so a partner endpoint would have no genuine consumer.
- **No surface consumes these endpoints yet.** I7/I8 build the seller and dealer experiences; the projections exist first so no surface can be built against unscoped data.
- **Numbers will read as genuine zeros until instrumentation is complete** (impressions await I3b's card call sites, reservations await their service wiring). `coverage` and `source_event_count` make that visible rather than mysterious.

---

## I5 gate statement

The phase's required tests — seller cannot access another seller, dealer cannot access another tenant, government receives only purpose-limited data, admin permissions are scoped — pass, and the "no scope parameter exists" property is asserted against the route source rather than inferred. Every metric carries an availability state, so no consumer can render missing data as zero.

**I5 is complete. The programme continues into I6 (Listing Readiness and Lost Opportunity).**

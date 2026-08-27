# I4 — Rollups and Read Models

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Implements:** `I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md` §7 metric registry, on the I2 ledger and I3 instrumentation
**Status:** complete — source implemented, staging migration applied, reconciliation and governance proven.

---

## What shipped

| Artefact | Path |
|---|---|
| Migration | `database/migrations/20260827130000_intelligence_rollups.sql` |
| Rollup service | `backend/services/intelligence/rollupService.js` |
| Tests | `backend/tests/intelligence-rollups.test.js` (19 tests) |

Four grains — `listing_daily_metrics`, `seller_daily_metrics`, `tenant_daily_metrics`, `platform_daily_metrics` — plus `intelligence_rollup_runs`, the execution ledger that makes staleness detectable.

---

## The three rules that shape the arithmetic

**1. Reproducible, not incremental.** A rollup row is a pure function of (that day's ledger rows, the authoritative tables, the calculation version). `rollupDay` rebuilds a day from scratch and upserts on the natural key, so re-running after late events arrive **converges** rather than double-counting — and a definition fixed today can be applied to history by simply re-running it.

**2. Uniques do not sum.** One shopper who viewed three of a dealer's cars is one person. Seller and tenant uniques are computed across that scope's entire inventory, never by adding per-listing uniques. This is the single most common way a "unique visitors" number becomes a lie, so it has a dedicated test that first computes the naive sum (3) and then asserts the correct answer (1).

**3. Authority wins.** `inquiries`, `inspections`, `reservations` and `net_watchlist` are read from `marketplace_inquiries`, `vehicle_reservations` and `saved_vehicles` — not counted from events. The ledger explains how a shopper arrived; it does not get to decide how many leads a seller has. `spam` and `rejected` inquiries are excluded from the headline lead count per the contract.

### Supporting decisions

- **Tables, not views.** A view recomputes silently under changing definitions and cannot record *which* definition produced a number. Every row here carries its `calculation_version`, and the natural key includes it, so two versions coexist and a surface can never blend them.
- **Not a second source of truth.** CarUp already dropped `vehicle_listing_summaries` (`20260818100000`) because a dormant read model invites divergence. These rollups are always recomputable from the ledger, never written by product code, and stamped with the window they cover — so a stale rollup is *detectable* rather than merely wrong.
- **Shares are never summed.** `shares_confirmed` and `shares_initiated` are separate columns with no combined field, because a completed share and an opened share sheet are different claims.
- **Self-traffic is excluded from every seller-facing number** but surfaced as `self_traffic_views`, so a dealer refreshing their own listing never inflates their reported demand while an operator can still see that it happened.
- **A wrong phone clock is not a bot.** `clock_skew_adjusted` excludes nothing; `bot_suspect`, `staff`, `fixture` and `late_beyond_window` do.
- **Failure is loud.** `rollupDay` returns `ok: false` on error and marks the run `failed`, so a surface renders `unavailable` rather than reading a partially-written day as truth. `rollupFreshness` answers `never_computed` / `last_run_failed` / `computed_at`, which is what lets a dashboard say "as of 04:00" instead of presenting a stale number as current.

---

## Evidence

### Reconciliation tests — 19/19 pass
Known event sets in, exact counts out. Covering: exclusion semantics (bot/staff/fixture/late excluded; clock-skew and self-traffic not excluded at the base layer); session-based uniqueness surviving the anonymous→authenticated boundary; a listing grain reproducing 11 known events exactly; self-traffic removed from views but reported separately; bot traffic removed from every seller-facing number while raw events still reconcile; confirmed/initiated shares kept apart with no combined field; genuine zeros for a listing with no activity; **the naive per-listing unique sum (3) vs the correct scope unique (1)**; platform uniques counting one shopper once across search/browse/save; zero-result searches as their own signal; half-open UTC day bounds; a full four-grain rollup with spam excluded and `net_watchlist` read from the authority; re-run convergence; a listing with an authoritative lead but zero behavioural events still getting a row; a failed rollup reporting failure instead of writing a partial day; freshness reporting unavailable rather than implying a quiet market; and migration governance.

### Full backend regression — 4,431 tests, 0 failures
Under the `ci.yml` env contract. 4,410 pass, 21 pre-existing skips.

### Migration harness — PASS
`migration_pglite_check.mjs` against real PostgreSQL: `overall: PASS`, empty up/down/re-up failure lists, exit 0 — with both I2 and I4 migrations present.

### Live staging proof
Migration applied as `intelligence_rollups`. Verified against the live database:

| Check | Live result |
|---|---|
| Grants to `anon`/`authenticated`/`PUBLIC` on all 5 tables | `(none)` |
| RLS enabled **and** forced | 5 of 5 tables |
| A rollup claiming 5 unique viewers on 2 views | **rejected** by CHECK |
| A second row for the same (day, listing, version) | **rejected** by UNIQUE |
| Two calculation versions for the same day | **accepted** — they coexist without blending |

Proof rows deleted; all rollup tables and the ledger are back to **0 rows**.

---

## Deliberate limitations

- **Reservations are per-listing only.** Seller and tenant reservation columns are `0` pending the reservation-service instrumentation deferred in I3; a column that would be silently wrong is left explicitly at zero rather than approximated from another grain.
- **No scheduler yet.** `rollupDay` is invocable but not scheduled. Scheduling belongs with the projections that consume it (I5) so freshness guarantees and read paths ship together rather than a job producing rows nothing reads.
- **Impression-based metrics stay empty until I3b's card call sites land** (blocked on PR #182). The rollup computes them correctly; there is simply no impression data yet, and that shows as a genuine zero with `source_event_count` to prove it.
- **Nothing is displayed yet.** I5 builds the authorized projections; no stakeholder surface reads these tables until audience scoping exists.

---

## I4 gate statement

Reproducible calculation, reconciliation tests, calculation versions, and clear no-data/unavailable states — the phase's contract requirements — are implemented and proven, including against the live staging database. Rollups are derived state with zero client access; every number traces back to controlled events or to a named authority table.

**I4 is complete. The programme continues into I5 (authorization and privacy projections).**
